import { lightAt } from './junctions.js';
import { DIRECTIONS, spokesOf } from './network.js';
import { RING } from './roundabout.js';
import { signalPoles } from './sceneitems.js';

// 车流和红绿灯的模拟。这是纯视觉层：只读路段的负载比，不写任何东西，经济和拥堵的结算完全不知道它的存在。
// 这里不依赖图形库，所以检查脚本可以不开画面直接跑；画车是 web/vehicles.js 的事。
// 车只在视野内生成，出了视野就回收；路段负载越高，这一段该有的车越多，总数不超过 cap。
// full 为真时不看负载，视野里一直保持 cap 辆车，测帧率时才真的是这么多车。
//
// 车走的每一点高度都取路面实际高度，坡上、高地和桥上都贴路。
// 车身方向：heading 是车身在屏幕上的角度，跟着路面走向平滑变化，平滑量按走过的距离算，所以快慢车都一样；
// 精灵选最接近 heading 的那张，差的角度由运行时旋转补上，上坡车头抬起，弯道也跟着路，换精灵时车身不跳。
//
// 过路口：车按车身长度停在停车线后面。放行要同时满足绿灯和出口放得下自己，否则绿灯也不进，所以不会堵在路口里。
// 过了停车线的车一路开走，全红时间按最长的通过路线算好，够它们清空。
//
// 环岛：车在斑马线外的让行线前看环上有没有车过来，没有才进；进环后逆时针绕到选定的出口。
//
// 匝道：每条 lane 带一组限速系数，弯急坡陡的地方车慢下来。上下匝道的概率跟着分配到这条匝道的流量走。
//
// 排队：车在每一段的尽头都看下一段的队尾，格子接格子、匝道接地面路、匝道并主线、环岛接出口都一样。
// 下一段排满时车在这一段的头上等，不会叠在下一段的起点上。入口匝道的头上排满时，路过的车不上匝道，接着往前开。
//
// 公交：经过站台的车停在格子中央，车门对着人行道上的站台，停够时间再走。后面的车在它后面等。

const SPEED = { road: 1.1, arterial: 1.5, highway: 2.2, express: 2.2, ramp: 1.4 };
const LANE_OFFSET = { road: 0.115, arterial: 0.25, highway: 0.29, express: 0.29, ramp: 0 };
export const BUS_LENGTH = 0.36;
export const CAR_LENGTH = 0.2;
const CLEARANCE = 0.08;
const STOP_MARGIN = 0.02;
const RAMP_CHANCE = 0.35;
const TURNS = 10;
const VIEW_MARGIN = 240;
const TILE_HALF_W = 64;
const TILE_HALF_H = 32;
const LEVEL_PIXELS = 32;
const SLOW = 0.4;
const STRAIGHT_WEIGHT = 2.5;
const HEADING_REACH = 0.03;
const CHORD = 0.04;
const LANE_STEPS = 6;
const RING_ENTRY = 0.34;
const RING_WATCH = 1.1;
const RING_STEPS = 24;
const RING_APRON = 1.62;
const SPAWN_GAP = 0.5;
const BUS_SHARE = 0.06;
const BUS_DWELL = 2.5;
const BAY_MARGIN = 0.03;
const ARRIVAL_CHORD = 0.05;

function unitDirection(dir) {
  const [dx, dy] = DIRECTIONS[dir];
  const length = Math.hypot(dx, dy);
  return [dx / length, dy / length];
}

function kindOf(entry, dir) {
  const bit = 1 << dir;
  if (entry.highway & bit) return 'highway';
  return (entry.arterial ?? 0) & bit ? 'arterial' : 'road';
}

function screenAt(px, py, level) {
  return { sx: (px - py) * TILE_HALF_W, sy: (px + py - 1) * TILE_HALF_H - level * LEVEL_PIXELS };
}

/** 一格里从 from 方向进来、往 to 方向出去的车道中线。靠右行驶，所以进出都偏向各自行进方向的右侧。 */
function cellLane(x, y, from, to, kind) {
  const [fx, fy] = unitDirection(from);
  const [tx, ty] = unitDirection(to);
  const offset = LANE_OFFSET[kind];
  const cx = x + 0.5;
  const cy = y + 0.5;
  const reachFrom = Math.hypot(...DIRECTIONS[from]) / 2;
  const reachTo = Math.hypot(...DIRECTIONS[to]) / 2;
  const start = [cx + fx * reachFrom + fy * offset, cy + fy * reachFrom - fx * offset];
  const end = [cx + tx * reachTo - ty * offset, cy + ty * reachTo + tx * offset];
  const points = [];
  if (Math.abs(fx * tx + fy * ty + 1) < 1e-6) {
    for (let i = 0; i <= LANE_STEPS; i += 1) {
      const t = i / LANE_STEPS;
      points.push([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]);
    }
    return points;
  }
  const control = [cx + (fy - ty) * offset, cy + (tx - fx) * offset];
  for (let i = 0; i <= TURNS; i += 1) {
    const t = i / TURNS;
    const a = (1 - t) * (1 - t);
    const b = 2 * t * (1 - t);
    const c = t * t;
    points.push([
      a * start[0] + b * control[0] + c * end[0],
      a * start[1] + b * control[1] + c * end[1],
    ]);
  }
  return points;
}

function measured(points) {
  const along = [0];
  for (let i = 1; i < points.length; i += 1) {
    along.push(
      along[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]),
    );
  }
  return { points, along, length: along[along.length - 1] };
}

export function pointAt(path, s) {
  const { points, along } = path;
  let i = 0;
  while (i < points.length - 2 && along[i + 1] < s) i += 1;
  const span = along[i + 1] - along[i] || 1;
  const t = Math.max(0, Math.min(1, (s - along[i]) / span));
  const [ax, ay, ah] = points[i];
  const [bx, by, bh] = points[i + 1];
  return {
    x: ax + (bx - ax) * t,
    y: ay + (by - ay) * t,
    h: ah + (bh - ah) * t,
    index: i,
  };
}

/** 一个地面方向在屏幕上的角度。 */
function screenAngle(dx, dy, dh) {
  return Math.atan2((dx + dy) * TILE_HALF_H - dh * LEVEL_PIXELS, (dx - dy) * TILE_HALF_W);
}

/** 路面在这一点的屏幕走向，用前后一小段的弦算，折线的拐点上不会跳。 */
export function roadAngle(path, s) {
  const a = pointAt(path, Math.max(0, s - CHORD));
  const b = pointAt(path, Math.min(path.length, s + CHORD));
  return screenAngle(b.x - a.x, b.y - a.y, b.h - a.h);
}

/** 第 r 张精灵的车头在屏幕上的角度。 */
export function spriteAngle(rotation) {
  const angle = (rotation * Math.PI) / 4;
  return screenAngle(Math.cos(angle), -Math.sin(angle), 0);
}

export const wrapAngle = (value) => Math.atan2(Math.sin(value), Math.cos(value));

/** 屏幕上最接近这个角度的精灵。 */
function nearestSprite(heading) {
  let best = 0;
  let gap = Infinity;
  for (let rotation = 0; rotation < 8; rotation += 1) {
    const difference = Math.abs(wrapAngle(heading - spriteAngle(rotation)));
    if (difference < gap) {
      gap = difference;
      best = rotation;
    }
  }
  return best;
}

/** 八个方向里最接近车尾朝向的一个，车从匝道下来进入路网时，就算是从这一边进的格子。 */
function backwardDirection(hx, hy) {
  let from = 0;
  let best = -2;
  DIRECTIONS.forEach((_, dir) => {
    const [dx, dy] = unitDirection(dir);
    const facing = -(dx * hx + dy * hy) / Math.hypot(hx, hy);
    if (facing > best) {
      best = facing;
      from = dir;
    }
  });
  return from;
}

/** 车走完这条 lane 时是从哪一边进的下一格。 */
function arrivalOf(path) {
  const end = pointAt(path, path.length);
  const before = pointAt(path, path.length - ARRIVAL_CHORD);
  return backwardDirection(end.x - before.x, end.y - before.y);
}

/** 一条环岛通过路线：进口直行，切入环路，逆时针绕到出口，再切出去。车逆时针，所以角度一路减小。 */
function ringRoute(ring, entry, exit, surface) {
  const { cx, cy } = ring;
  const lane = (arm, side, station) => {
    const value = LANE_OFFSET[arm.kind] * side;
    return [cx + arm.ux * station - arm.uy * value, cy + arm.uy * station + arm.ux * value];
  };
  const start = entry.angle - RING_ENTRY;
  let end = exit.angle + RING_ENTRY;
  while (end >= start - 0.2) end -= Math.PI * 2;
  const on = (angle) => [cx + Math.cos(angle) * RING, cy + Math.sin(angle) * RING];
  const points = [
    lane(entry, -1, entry.reach),
    lane(entry, -1, entry.leg.stopLine.station),
    lane(entry, -1, RING_APRON),
    on(start + 0.05),
  ];
  const steps = Math.max(RING_STEPS, Math.ceil(((start - end) / Math.PI) * RING_STEPS));
  for (let i = 0; i <= steps; i += 1) points.push(on(start + ((end - start) * i) / steps));
  points.push(lane(exit, 1, RING_APRON), lane(exit, 1, exit.reach));
  const path = measured(points.map(([x, y]) => [x, y, surface(x, y)]));
  return {
    path,
    start,
    end,
    yieldAt: path.along[1],
    enter: path.along[3],
    leave: path.along[path.along.length - 3],
  };
}

export function createFleet(
  city,
  { cap, full = false, highCap = 120, random = Math.random, busShare = BUS_SHARE },
) {
  const { N, roads, surface, lanes = [], busStops = [] } = city;
  const { clusters = [], stops = new Map() } = city.junctions ?? {};
  const rings = city.rings ?? [];
  const load = new Map();
  for (const edge of city.traffic.edges) {
    load.set(`${String(edge.from)}:${String(edge.to)}`, edge.ratio);
    load.set(`${String(edge.to)}:${String(edge.from)}`, edge.ratio);
  }
  const laneById = new Map(
    lanes.map((lane) => {
      const path = measured(lane.points);
      return [lane.id, { ...lane, path, arrival: arrivalOf(path) }];
    }),
  );
  const lanesFrom = new Map();
  for (const lane of laneById.values()) {
    if (lane.fromCell === undefined) continue;
    if (!lanesFrom.has(lane.fromCell)) lanesFrom.set(lane.fromCell, []);
    lanesFrom.get(lane.fromCell).push(lane);
  }
  const clusterCells = new Set(clusters.flatMap(({ cells }) => [...cells]));
  const stopCells = new Set([...stops.values()].map(({ cell }) => cell));
  const ringOfCell = new Map();
  for (const ring of rings) for (const cell of ring.cells) ringOfCell.set(cell, ring);
  const busStopAt = new Map(
    busStops.map((stop) => [`${String(stop.cell)}:${String(stop.from)}`, stop]),
  );

  const signals = signalPoles(clusters);

  let time = 0;
  let viewBox = { left: -1e6, right: 1e6, top: -1e6, bottom: 1e6 };
  let visibleEdges = [];
  let visibleLanes = [];
  let wanted = 0;
  let refreshIn = 0;
  let groups = new Map();
  const cars = [];
  const removed = [];
  const countHigh = () => cars.reduce((sum, car) => sum + (car.high ? 1 : 0), 0);

  const lengthOf = (car) => (car.bus ? BUS_LENGTH : CAR_LENGTH);
  const rampChance = (lane) => lane.chance ?? RAMP_CHANCE;

  const weighted = (items, weightOf) => {
    const weights = items.map(weightOf);
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    let roll = random() * total;
    for (let i = 0; i < items.length; i += 1) {
      roll -= weights[i];
      if (roll <= 0) return items[i];
    }
    return items[items.length - 1];
  };

  const enterRing = (car, ring, arm) => {
    const exit = weighted(
      ring.arms.filter((other) => other !== arm && roads.has(other.outside)),
      () => 1,
    );
    if (!exit) return false;
    car.mode = 'ring';
    car.ring = ring;
    car.exit = exit;
    car.trip = ringRoute(ring, arm, exit, surface);
    car.path = car.trip.path;
    car.cleared = false;
    car.stop = null;
    car.s = 0;
    car.kind = 'road';
    car.key = `${String(ring.id)}:${String(arm.dir)}`;
    return true;
  };

  const boardLane = (car, lane, s = 0) => {
    car.mode = 'lane';
    car.lane = lane;
    car.path = lane.path;
    car.s = s;
    car.key = lane.id;
    car.stop = null;
    car.passed = null;
  };

  /** 匝道的头上放得下这辆车。 */
  const laneOpen = (car, lane) => {
    const queue = groups.get(lane.id);
    if (!queue || queue.length === 0) return true;
    const last = queue[queue.length - 1];
    return last.s - (lengthOf(car) + lengthOf(last)) / 2 >= CLEARANCE;
  };

  const enterCell = (car, cell, from) => {
    const ring = ringOfCell.get(cell);
    if (ring) {
      const arm = ring.arms.find(({ gate }) => gate === cell);
      return arm ? enterRing(car, ring, arm) : false;
    }
    const entry = roads.get(cell);
    const x = cell % N;
    const y = Math.floor(cell / N);
    const spokes = spokesOf(entry.road | entry.highway).filter((dir) => dir !== from);
    const heading = unitDirection((from + 4) % 8);
    const ramps = lanesFrom.get(cell)?.filter((lane) => {
      const { x: ax, y: ay } = pointAt(lane.path, 0);
      const { x: bx, y: by } = pointAt(lane.path, 0.05);
      const length = Math.hypot(bx - ax, by - ay);
      return ((bx - ax) * heading[0] + (by - ay) * heading[1]) / length > 0.2;
    });
    const open = ramps?.filter((lane) => laneOpen(car, lane));
    if (open?.length > 0) {
      const lane = weighted(open, (item) => Math.max(0.02, rampChance(item)));
      if (spokes.length === 0 || random() < rampChance(lane)) {
        boardLane(car, lane);
        return true;
      }
    }
    if (spokes.length === 0) return false;
    const stop = stops.get(`${String(cell)}:${String(from)}`) ?? null;
    if (stop) {
      car.stop = stop;
      car.cleared = false;
      const straight = (stop.leg.dir + 4) % 8;
      const pick = weighted(stop.routes, ({ dirs }) =>
        dirs.length === 1 && dirs[0] === straight ? STRAIGHT_WEIGHT : 1,
      );
      car.route = pick ? [...pick.dirs] : null;
      car.exit = pick?.exit ?? null;
    }
    let to = null;
    if (clusterCells.has(cell) && car.route?.length > 0) to = car.route.shift();
    if (to === null || !spokes.includes(to)) {
      to = weighted(spokes, (dir) => {
        const [dx, dy] = DIRECTIONS[dir];
        const next = (y + dy) * N + x + dx;
        if (!roads.has(next)) return 0;
        const straight = dir === (from + 4) % 8 ? STRAIGHT_WEIGHT : 1;
        return straight * (0.15 + (load.get(`${String(cell)}:${String(next)}`) ?? 0));
      });
    }
    if (to === null) return false;
    const kind = kindOf(entry, to);
    car.mode = 'cell';
    car.cell = cell;
    car.from = from;
    car.to = to;
    car.kind = kind;
    car.path = measured(
      cellLane(x, y, from, to, kind).map(([px, py]) => [px, py, surface(px, py)]),
    );
    car.s = 0;
    car.key = `${String(cell)}:${String(from)}`;
    car.bay = car.bus ? (busStopAt.get(car.key) ?? null) : null;
    car.dwell = car.bay ? BUS_DWELL : 0;
    return true;
  };

  const newCar = (bus) => ({
    color: Math.floor(random() * 4),
    speed: 0,
    s: 0,
    top: 1 + random() * 0.2,
    bus,
    high: false,
    tilt: 0,
    idle: 0,
    waiting: false,
    dwell: 0,
    bay: null,
  });

  /** 车只生成在路段中间：路口、环岛和停车线那一格不生成，也不生成在别的车身上。 */
  const spawnOnEdge = (edge) => {
    const forward = random() < 0.5;
    const cell = forward ? edge.from : edge.to;
    const from = forward ? (edge.dir + 4) % 8 : edge.dir;
    const entry = roads.get(cell);
    if (spokesOf(entry.road | entry.highway).length !== 2) return;
    if (ringOfCell.has(cell) || clusterCells.has(cell) || stopCells.has(cell)) return;
    const car = newCar(random() < busShare);
    if (!enterCell(car, cell, from)) return;
    car.s = random() * car.path.length;
    const crowded = groups.get(car.key)?.some((other) => Math.abs(other.s - car.s) < SPAWN_GAP);
    if (!crowded) cars.push(car);
  };

  const spawnOnLane = (lane) => {
    if (countHigh() >= highCap) return;
    const car = newCar(false);
    boardLane(car, lane, random() * lane.path.length);
    const crowded = groups.get(lane.id)?.some((other) => Math.abs(other.s - car.s) < SPAWN_GAP);
    if (crowded) return;
    car.high = true;
    cars.push(car);
  };

  const refreshView = () => {
    const inView = ({ sx, sy }) =>
      sx > viewBox.left && sx < viewBox.right && sy > viewBox.top && sy < viewBox.bottom;
    visibleEdges = city.traffic.edges.filter(
      (edge) =>
        edge.kind !== 'ramp' &&
        edge.kind !== 'express' &&
        inView(screenAt((edge.from % N) + 0.5, Math.floor(edge.from / N) + 0.5, 0)),
    );
    visibleLanes = [...laneById.values()].filter((lane) =>
      lane.points.some(([x, y, h]) => inView(screenAt(x, y, h))),
    );
    const demand =
      visibleEdges.reduce((sum, edge) => sum + 0.18 + edge.ratio * 1.6, 0) +
      visibleLanes.reduce((sum, lane) => sum + lane.path.length * (0.04 + (lane.ratio ?? 0.1)), 0);
    wanted = full ? cap : Math.min(cap, Math.round(demand));
  };

  const finishPath = (car) => {
    if (car.mode === 'ring') {
      car.ring = null;
      const { outside, dir } = car.exit;
      return enterCell(car, outside, dir);
    }
    if (car.mode === 'lane') {
      const { lane } = car;
      if (lane.merge) {
        const main = laneById.get(lane.merge.lane);
        boardLane(car, main, main.path.along[lane.merge.at]);
        return true;
      }
      if (lane.toCell !== undefined) return enterCell(car, lane.toCell, lane.arrival);
      return false;
    }
    const [dx, dy] = DIRECTIONS[car.to];
    const x = (car.cell % N) + dx;
    const y = Math.floor(car.cell / N) + dy;
    if (x < 0 || y < 0 || x >= N || y >= N) return false;
    const next = y * N + x;
    if (!roads.has(next)) return false;
    return enterCell(car, next, (car.to + 4) % 8);
  };

  const remove = (index) => {
    removed.push(cars[index]);
    cars.splice(index, 1);
  };

  /** 出口放得下自己吗：出口斑马线外面要留出一个车身，那里有慢车就不进。 */
  const exitFree = (car) => {
    const { exit } = car;
    if (!exit?.crossing) return true;
    const step = Math.hypot(...DIRECTIONS[exit.dir]);
    const need = exit.crossing.far + lengthOf(car) + CLEARANCE;
    const [dx, dy] = DIRECTIONS[exit.dir];
    const back = (exit.dir + 4) % 8;
    for (let k = 1; (k - 0.5) * step < need; k += 1) {
      const cell = (Math.floor(exit.node / N) + dy * k) * N + (exit.node % N) + dx * k;
      for (const other of groups.get(`${String(cell)}:${String(back)}`) ?? []) {
        if (other.speed >= SLOW) continue;
        if ((k - 0.5) * step + other.s - lengthOf(other) / 2 < need) return false;
      }
    }
    return true;
  };

  const ringAngleOf = (car) => {
    const { start, end, enter, leave } = car.trip;
    return start + ((end - start) * (car.s - enter)) / (leave - enter);
  };
  const onRing = (car) => car.mode === 'ring' && car.s >= car.trip.enter && car.s <= car.trip.leave;

  /** 环岛让行：环上有车快到进环点时在让行线后等。 */
  const roomToYield = (car) => {
    if (car.cleared) return Infinity;
    const limit = car.trip.yieldAt - lengthOf(car) / 2 - STOP_MARGIN;
    if (car.s > limit + 0.02) {
      car.cleared = true;
      return Infinity;
    }
    const busy = cars.some((other) => {
      if (other === car || other.ring !== car.ring) return false;
      if (other.mode !== 'ring' || other.s < other.trip.yieldAt) return false;
      if (!onRing(other)) return other.s < other.trip.enter && other.trip.start === car.trip.start;
      const gap = wrapAngle(ringAngleOf(other) - car.trip.start);
      return gap > -0.3 && gap < RING_WATCH;
    });
    if (busy) {
      car.waiting = true;
      return limit - car.s;
    }
    if (car.s > limit - 0.06) car.cleared = true;
    return Infinity;
  };

  /** 停车线前的判断。返回还能往前走多远，没有停车线或者已经放行时是无穷。 */
  const roomToStop = (car) => {
    car.waiting = false;
    if (car.mode === 'ring') return roomToYield(car);
    if (car.mode !== 'cell' || !car.stop || car.cleared || car.stop.cell !== car.cell)
      return Infinity;
    const limit = car.stop.distance - lengthOf(car) / 2 - STOP_MARGIN;
    const { signal, phase } = car.stop;
    if (lightAt(signal, phase, time) === 'green' && exitFree(car)) {
      car.cleared = true;
      return Infinity;
    }
    if (car.s > limit + 0.02) {
      car.cleared = true;
      return Infinity;
    }
    car.waiting = true;
    return limit - car.s;
  };

  /** 公交到站：开到格子中央停下，停够时间再走。 */
  const roomToBay = (car, dt) => {
    if (car.mode !== 'cell' || !car.bay || car.dwell <= 0) return Infinity;
    const room = car.path.length / 2 - car.s;
    if (room < -BAY_MARGIN) return Infinity;
    if (room < BAY_MARGIN) car.dwell -= dt;
    return room;
  };

  /** 环上前车的距离，按角度量。 */
  const roomOnRing = (car) => {
    if (!onRing(car)) return Infinity;
    const own = ringAngleOf(car);
    let room = Infinity;
    for (const other of cars) {
      if (other === car || other.ring !== car.ring || !onRing(other)) continue;
      const gap = wrapAngle(own - ringAngleOf(other));
      if (gap <= 0) continue;
      room = Math.min(room, gap * RING - (lengthOf(car) + lengthOf(other)) / 2 - CLEARANCE);
    }
    return room;
  };

  /** 离环的车走同一段出口路，从不同进口来的车在这里排成一队，按离出口端的距离比。 */
  const roomOnExit = (car) => {
    if (car.mode !== 'ring' || car.s < car.trip.leave - RING_WATCH) return Infinity;
    const remaining = car.path.length - car.s;
    let room = Infinity;
    for (const other of cars) {
      if (other === car || other.mode !== 'ring' || other.ring !== car.ring) continue;
      if (other.exit !== car.exit || other.s < other.trip.leave) continue;
      const gap = remaining - (other.path.length - other.s);
      if (gap <= 0) continue;
      room = Math.min(room, gap - (lengthOf(car) + lengthOf(other)) / 2 - CLEARANCE);
    }
    return room;
  };

  /** 走完这一段接的是哪一队：key 是队的名字，start 是接上这一队的里程。 */
  const nextQueue = (car) => {
    if (car.mode === 'ring') {
      const { outside, dir } = car.exit;
      return { key: `${String(outside)}:${String(dir)}`, start: 0 };
    }
    if (car.mode === 'cell') {
      const [dx, dy] = DIRECTIONS[car.to];
      const next = (Math.floor(car.cell / N) + dy) * N + (car.cell % N) + dx;
      return { key: `${String(next)}:${String((car.to + 4) % 8)}`, start: 0 };
    }
    const { merge, toCell, arrival } = car.lane;
    if (merge) {
      const main = laneById.get(merge.lane);
      return { key: main.id, start: main.path.along[merge.at] };
    }
    return toCell === undefined ? null : { key: `${String(toCell)}:${String(arrival)}`, start: 0 };
  };

  /** 下一段排尾的车，跨段时也不能撞上去。队伍按里程从大到小排，起点之后的最后一辆就是队尾。 */
  const roomToNextQueue = (car) => {
    const next = nextQueue(car);
    const queue = next && groups.get(next.key);
    if (!queue) return Infinity;
    let last = null;
    for (const other of queue) if (other.s >= next.start) last = other;
    if (!last) return Infinity;
    const ahead = car.path.length - car.s + last.s - next.start;
    return ahead - (lengthOf(car) + lengthOf(last)) / 2 - CLEARANCE;
  };

  const speedLimit = (car) => {
    if (car.mode !== 'lane') return SPEED[car.kind] * car.top;
    const { kind, speeds } = car.lane;
    const factor = speeds ? speeds[pointAt(car.path, car.s).index] : 1;
    return SPEED[kind] * car.top * factor;
  };

  const follow = (car, room) => {
    car.speed = Math.max(0, Math.min(speedLimit(car), room * 5));
  };

  const takeExit = (car) => {
    const { index } = pointAt(car.path, car.s);
    for (const exit of car.lane.exits) {
      if (exit.at !== index || car.passed?.has(exit.lane) || car.s <= car.path.along[exit.at])
        continue;
      (car.passed ??= new Set()).add(exit.lane);
      const ramp = laneById.get(exit.lane);
      if (random() < rampChance(ramp) && laneOpen(car, ramp)) {
        boardLane(car, ramp);
        return;
      }
    }
  };

  const place = (car, dt) => {
    const s = Math.min(car.s, car.path.length);
    const spot = pointAt(car.path, s);
    const { sx, sy } = screenAt(spot.x, spot.y, spot.h);
    car.x = spot.x;
    car.y = spot.y;
    car.h = spot.h;
    car.high = car.mode === 'lane';
    const a = pointAt(car.path, Math.max(0, s - CHORD));
    const b = pointAt(car.path, Math.min(car.path.length, s + CHORD));
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    car.dx = (b.x - a.x) / length;
    car.dy = (b.y - a.y) / length;
    const target = roadAngle(car.path, s);
    const blend = Math.min(1, (car.speed * dt) / HEADING_REACH);
    car.heading =
      car.heading === undefined ? target : car.heading + wrapAngle(target - car.heading) * blend;
    car.rotation = nearestSprite(car.heading);
    car.tilt = wrapAngle(car.heading - spriteAngle(car.rotation));
    return (
      sx > viewBox.left - VIEW_MARGIN &&
      sx < viewBox.right + VIEW_MARGIN &&
      sy > viewBox.top - VIEW_MARGIN &&
      sy < viewBox.bottom + VIEW_MARGIN
    );
  };

  const step = (dt) => {
    time += dt;
    refreshIn -= dt;
    if (refreshIn <= 0) {
      refreshView();
      refreshIn = 0.5;
    }
    groups = new Map();
    for (const car of cars) {
      if (!groups.has(car.key)) groups.set(car.key, []);
      groups.get(car.key).push(car);
    }
    for (const group of groups.values()) group.sort((a, b) => b.s - a.s);
    for (const group of groups.values()) {
      group.forEach((car, index) => {
        let room = roomToNextQueue(car);
        if (index > 0) {
          const leader = group[index - 1];
          room = Math.min(
            room,
            leader.s - car.s - (lengthOf(leader) + lengthOf(car)) / 2 - CLEARANCE,
          );
        }
        room = Math.min(
          room,
          roomToStop(car),
          roomOnRing(car),
          roomOnExit(car),
          roomToBay(car, dt),
        );
        follow(car, room);
        car.s += car.speed * dt;
        car.idle = car.speed < 0.02 ? car.idle + dt : 0;
      });
    }
    for (let i = cars.length - 1; i >= 0; i -= 1) {
      const car = cars[i];
      if (car.mode === 'lane' && car.lane.exits.length > 0) takeExit(car);
      let alive = true;
      if (car.s >= car.path.length) alive = finishPath(car);
      if (alive) alive = place(car, dt);
      if (!alive || cars.length > wanted + 8 || (car.high && countHigh() > highCap)) remove(i);
    }
    for (let i = 0; i < 8 && cars.length < wanted; i += 1) {
      const fromLane = visibleLanes.length > 0 && random() < 0.3;
      if (fromLane) spawnOnLane(visibleLanes[Math.floor(random() * visibleLanes.length)]);
      else if (visibleEdges.length > 0)
        spawnOnEdge(visibleEdges[Math.floor(random() * visibleEdges.length)]);
    }
  };

  return {
    step,
    cars,
    removed,
    signals,
    lengthOf,
    lightOf: ({ signal, phase }) => lightAt(signal, phase, time),
    setView(box) {
      viewBox = box;
      refreshIn = 0;
    },
    count: () => cars.length,
    wanted: () => wanted,
    stopped: () => cars.filter((car) => car.speed < 0.02).length,
  };
}
