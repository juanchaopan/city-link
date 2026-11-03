import { entryOffset, lightAt } from './junctions.js';
import {
  cellLane,
  hasInnerLane,
  INNER_OFFSET,
  laneKind,
  LANE_OFFSET,
  unitDirection,
} from './lanes.js';
import { DIRECTIONS, spokesOf } from './network.js';
import { RING } from './roundabout.js';
import { signalPoles } from './sceneitems.js';
import { distanceToEnd, inStretch, sharedStretches } from './sharedlanes.js';

// 车流和红绿灯的模拟。这是纯视觉层：只读路段的负载比，不写任何东西，经济和拥堵的结算完全不知道它的存在。
// 这里不依赖图形库，所以检查脚本可以不开画面直接跑；画车是 web/vehicles.js 的事。
// 车只在视野内生成，出了视野就回收；路段负载越高，这一段该有的车越多，总数不超过 cap。
// full 为真时不看负载，视野里一直保持 cap 辆车，测帧率时才真的是这么多车。
//
// 车走的每一点高度都取路面实际高度，坡上、高地和桥上都贴路。
// 车身方向：heading 是车身在屏幕上的角度，跟着路面走向平滑变化，平滑量按走过的距离算，所以快慢车都一样；
// 精灵选最接近 heading 的那张，差的角度由运行时旋转补上，上坡车头抬起，弯道也跟着路，换精灵时车身不跳。
//
// 过路口：车按车身长度停在停车线后面。车选好走向后等这条线的相位，放行要同时满足绿灯和出口放得下自己，
// 否则绿灯也不进，所以不会堵在路口里。过了停车线的车一路开走，全红时间按最长的通过路线算好，够它们清空。
// 两车道的进口只有一条车道，排头的车等自己的相位时后面的车跟着等。
// 车在停车线前一格就选好走向，停车线离格口太近停不下时就在前一格停：绿灯时才开进停车格，排头的车开进路口
// 让行还没过让行点时，后面的车不管直行还是右转都在停车线后等，不跟进路口、不穿过它；stopOrder 记下到停车线的先后。
// 四车道的进口有左转专用道：左转的车横移到内侧车道，在路口里也单独排一队
// （队名多一个 :L），直行的车从旁边过；专用道的灯是保护左转相。横移的那一格前半段两条队还并着，互相跟车。
// 让行：两车道的左转和直行同相放行，左转车开进路口，在和对向直行相交之前停下来等空档，
// 对向的车还在路口里、或者在停车线前亮着绿灯，就等；没有了才通过。让谁、在哪让，连线表（junctions.js）里写好。
// 出口放不放得下要数整段路：下一个路口的停车线之前的路段长度，减去这段路上所有的车和已经放行、正开往这个出口的车。
// 只看出口附近有没有慢车不够，同一个绿灯里先走的车还在跑，等它们排上去，路口就堵了。
// 路段中间生成的车也算数：路段放不下时不在这一段生成。新车的落点按平面距离避开所有车，前一格的队尾也算。
//
// 环岛：车在斑马线外的让行线前看环上有没有车过来，没有才进；出口到下一个路口停车线的那段路也要放得下自己，
// 放不下就在让行线前等，环上不会被堵死。进环后逆时针绕到选定的出口。
// 环上跟车按角度量，刚切进来、刚切出去的车车身还有一截在环上，也算在前车里。
// 环岛的车从 5×5 的边上开始算一条通过路线，按进口分队；驶向这个进口的车看的是这支队的队尾，不是格子的队。
// 出环的车从 5×5 的边进外面那一格，进格的方向是出口臂的反方向：臂的方向是从环心向外指的。
//
// 匝道：每条 lane 带一组限速系数，弯急坡陡的地方车慢下来。上下匝道的概率跟着分配到这条匝道的流量走。
// 两条 lane 共用一段路面时这一段算一支队，见 sharedlanes.js。
// 匝道落到地面路上的那一格只有一条路从这里出去，进来的方向没有路，车道偏移按出去的那条路算，车从匝道
// 开到格子里不会横着跳一下。
//
// 排队：车在每一段的尽头都看下一段的队尾，格子接格子、匝道接地面路、匝道并主线、环岛接出口都一样。
// 下一段排满时车在这一段的头上等，不会叠在下一段的起点上。
// 上匝道要看匝道头上共用路面的那一段：分岔口的出口匝道头上和主线贴在一起，匝道排满时队尾退到这一段，
// 主线上的直行车就跟在队尾后面等。所以匝道上的车要排得下、并且排在共用段之外，路过的车才上匝道；
// 排不下就接着往前开。共用段上也不生成车。
//
// 公交：经过站台的车停在格子中央，车门对着人行道上的站台，停够时间再走。后面的车在它后面等。

const SPEED = { road: 1.1, arterial: 1.5, highway: 2.2, express: 2.2, ramp: 1.4 };
export const BUS_LENGTH = 0.36;
export const CAR_LENGTH = 0.2;
const CLEARANCE = 0.08;
const STOP_MARGIN = 0.02;
const RAMP_CHANCE = 0.35;
const VIEW_MARGIN = 240;
const TILE_HALF_W = 64;
const TILE_HALF_H = 32;
const LEVEL_PIXELS = 32;
const SLOW = 0.4;
const STRAIGHT_WEIGHT = 2.5;
const HEADING_REACH = 0.03;
const CHORD = 0.04;
const RING_ENTRY = 0.34;
const RING_WATCH = 1.1;
const RING_STEPS = 24;
const RING_APRON = 1.62;
const SPAWN_GAP = 0.5;
const BUS_SHARE = 0.06;
const BUS_DWELL = 2.5;
const BAY_MARGIN = 0.03;
const ARRIVAL_CHORD = 0.05;
const MAX_LINK_CELLS = 6;
const LEFT_LANE = ':L';
const LANE_CHANGE_REACH = 0.6;

function screenAt(px, py, level) {
  return { sx: (px - py) * TILE_HALF_W, sy: (px + py - 1) * TILE_HALF_H - level * LEVEL_PIXELS };
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
  const stretches = sharedStretches([...laneById.values()], pointAt);
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
  let stopCounter = 0;
  const cars = [];
  const removed = [];
  const countHigh = () => cars.reduce((sum, car) => sum + (car.high ? 1 : 0), 0);

  const lengthOf = (car) => (car.bus ? BUS_LENGTH : CAR_LENGTH);
  const bodyRoom = (car) => lengthOf(car) + CLEARANCE;
  const rampChance = (lane) => lane.chance ?? RAMP_CHANCE;
  const queued = (key) => [...(groups.get(key) ?? []), ...(groups.get(key + LEFT_LANE) ?? [])];

  /** 出口外面到下一个路口停车线的这段路：有哪几队，多长。直着走几格没遇到停车线时是 null。 */
  const linkAfter = (exit) => {
    const [dx, dy] = DIRECTIONS[exit.dir];
    const step = Math.hypot(dx, dy);
    const back = (exit.dir + 4) % 8;
    const keys = new Set();
    for (let k = 1; k <= MAX_LINK_CELLS; k += 1) {
      const cell = (Math.floor(exit.node / N) + dy * k) * N + (exit.node % N) + dx * k;
      if (!roads.has(cell)) return null;
      const key = `${String(cell)}:${String(back)}`;
      keys.add(key);
      const stop = stops.get(key);
      if (stop) {
        const room = (k - 0.5) * step + stop.distance - exit.crossing.far - CLEARANCE;
        return { keys, room };
      }
    }
    return null;
  };

  const exitLinks = new Map();
  const exitOfKey = new Map();
  const exitLegs = [
    ...clusters.flatMap(({ legs }) => legs),
    ...rings.flatMap(({ arms }) => arms.map(({ leg }) => leg)),
  ];
  for (const leg of exitLegs) {
    const link = leg?.crossing ? linkAfter(leg) : null;
    if (!link) continue;
    exitLinks.set(leg, link);
    for (const key of link.keys) exitOfKey.set(key, leg);
  }

  /** 这辆车要从哪条腿出路口：环岛的车记的是出口臂，臂上挂着腿。 */
  const exitLegOf = (car) => (car.mode === 'ring' ? car.exit?.leg : car.exit);

  /** 出口这段路连同已经放行、还没开上这段路的车，还放得下这辆车吗。前一格绿灯放进停车格的车也算已经放行。 */
  const linkFree = (car, exit) => {
    const link = exitLinks.get(exit);
    if (!link) return true;
    let taken = bodyRoom(car);
    for (const key of link.keys) {
      for (const other of queued(key)) if (other !== car) taken += bodyRoom(other);
    }
    for (const other of cars) {
      if (other === car || !(other.cleared || other.released)) continue;
      if ((other.released ? other.pending?.exit : exitLegOf(other)) !== exit) continue;
      if (!link.keys.has(other.key)) taken += bodyRoom(other);
    }
    return taken <= link.room;
  };

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

  const ringQueueKey = (ring, arm) => `${String(ring.id)}:${String(arm.dir)}`;

  /** 从 from 方向进这一格的车排哪一队：环岛的门口格按进口臂分队，别的格按格子和方向。 */
  const queueKeyOf = (cell, from) => {
    const ring = ringOfCell.get(cell);
    if (!ring) return `${String(cell)}:${String(from)}`;
    const arm = ring.arms.find(({ gate }) => gate === cell);
    return arm ? ringQueueKey(ring, arm) : null;
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
    car.key = ringQueueKey(ring, arm);
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

  /** 匝道的头上放得下这辆车，并且它能排到共用路面之外：共用路面时另一条 lane 上的车也算。 */
  const laneOpen = (car, lane) => {
    const stretch = stretches.find(({ fromTail, reach }) => !fromTail && reach.has(lane));
    const need = stretch?.reach.get(lane) ?? 0;
    const onLane = (other) => other.mode === 'lane' && other.lane === lane;
    const queue = cars.filter(
      (other) => onLane(other) || (stretch !== undefined && inStretch(stretch, other)),
    );
    const ahead = (other) => (onLane(other) ? other.s : distanceToEnd(stretch, other));
    return queue.every(
      (other) => ahead(other) - (lengthOf(car) + lengthOf(other)) / 2 - CLEARANCE >= need,
    );
  };

  /** 在这个进口选一条通过路线，直行的机会大一些。 */
  const pickRoute = (stop) => {
    const straight = (stop.leg.dir + 4) % 8;
    return weighted(stop.routes, ({ dirs }) =>
      dirs.length === 1 && dirs[0] === straight ? STRAIGHT_WEIGHT : 1,
    );
  };

  /** 到了停车线那一格：记下走向、相位和车道，左转专用道的车从这里起单独排队。前一格绿灯放进来的车直接放行。 */
  const takeStop = (car, stop) => {
    const pick = car.pending ?? pickRoute(stop);
    car.pending = null;
    car.stop = stop;
    car.stopOrder = stopCounter += 1;
    car.cleared = car.released === true && !yielderAhead(car, stop);
    car.clearedOn = car.cleared ? 'green' : null;
    car.released = false;
    car.route = pick ? [...pick.dirs] : null;
    car.exit = pick?.exit ?? null;
    car.phases = pick ? [pick.phase] : stop.phases;
    car.movement = pick ?? null;
    car.turnLane = pick?.lane ?? 'through';
    car.inJunction = false;
    car.progress = 0;
    car.committed = false;
  };

  /** 下一格是停车格时，在这一格就选好走向；有左转专用道的路上左转的车横移到内侧车道。 */
  const planAhead = (car, cell, from, to) => {
    const [dx, dy] = DIRECTIONS[to];
    const next = (Math.floor(cell / N) + dy) * N + (cell % N) + dx;
    const ahead = stops.get(`${String(next)}:${String((to + 4) % 8)}`);
    car.ahead = ahead ?? null;
    if (!ahead || clusterCells.has(cell)) return null;
    car.pending = pickRoute(ahead);
    return hasInnerLane(ahead.leg.kind) && car.pending?.lane === 'left' ? 'left' : null;
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
    const own = spokesOf(entry.road | entry.highway);
    const spokes = own.filter((dir) => dir !== from);
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
    if (stop) takeStop(car, stop);
    else if (car.movement && !clusterCells.has(cell)) {
      car.movement = null;
      car.turnLane = 'through';
      car.inJunction = false;
    }
    const inJunction = car.movement !== null && clusterCells.has(cell);
    if (inJunction) {
      car.progress = car.inJunction ? car.progress + car.path.length : 0;
      car.inJunction = true;
    }
    let to = null;
    if (inJunction && car.route?.length > 0) to = car.route.shift();
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
    const kind = laneKind(entry, to);
    const fromKind = own.includes(from) ? laneKind(entry, from) : kind;
    const inner = car.onInner === true && hasInnerLane(fromKind);
    const offsetFrom = inner ? INNER_OFFSET[fromKind] : LANE_OFFSET[fromKind];
    let offsetTo = LANE_OFFSET[kind];
    let leftLane = car.movement !== null && car.turnLane === 'left';
    if (!car.movement && planAhead(car, cell, from, to) === 'left') {
      offsetTo = INNER_OFFSET[kind];
      leftLane = true;
    } else if (leftLane && !inJunction && hasInnerLane(kind)) offsetTo = INNER_OFFSET[kind];
    car.onInner = offsetTo !== LANE_OFFSET[kind];
    car.mode = 'cell';
    car.cell = cell;
    car.from = from;
    car.to = to;
    car.kind = kind;
    car.path = measured(
      cellLane(x, y, from, to, offsetFrom, offsetTo).map(([px, py]) => [px, py, surface(px, py)]),
    );
    car.s = 0;
    car.key = `${String(cell)}:${String(from)}${leftLane ? LEFT_LANE : ''}`;
    car.bay = car.bus ? (busStopAt.get(`${String(cell)}:${String(from)}`) ?? null) : null;
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
    yielding: false,
    dwell: 0,
    bay: null,
    movement: null,
    pending: null,
    turnLane: 'through',
    inJunction: false,
    onInner: false,
    ahead: null,
    released: false,
  });

  /** 停车格在下一格时，这一格里停车线前留给车身的最后一段：落在这里的新车连停都停不住。 */
  const beforeStop = (car) =>
    car.ahead === null ||
    car.path.length - car.s + car.ahead.distance >= lengthOf(car) / 2 + STOP_MARGIN;

  /** 车只生成在路段中间：路口、环岛和停车线那一格不生成，也不生成在别的车身上或停车线上，路段放不下时不生成。 */
  const spawnOnEdge = (edge) => {
    const forward = random() < 0.5;
    const cell = forward ? edge.from : edge.to;
    const from = forward ? (edge.dir + 4) % 8 : edge.dir;
    const entry = roads.get(cell);
    if (spokesOf(entry.road | entry.highway).length !== 2) return;
    if (ringOfCell.has(cell) || clusterCells.has(cell) || stopCells.has(cell)) return;
    const car = newCar(random() < busShare);
    if (!enterCell(car, cell, from)) return;
    const exit = exitOfKey.get(car.key);
    if (exit && !linkFree(car, exit)) return;
    car.s = random() * car.path.length;
    if (beforeStop(car) && !crowdedAt(car)) cars.push(car);
  };

  /** 新车的落点周围 SPAWN_GAP 以内不能有别的车：平面上量，前一格队尾、下一格排头和同一帧刚生成的车都算。 */
  const crowdedAt = (car) => {
    const spot = (other) =>
      other.x === undefined ? pointAt(other.path, Math.min(other.s, other.path.length)) : other;
    const { x, y, h } = spot(car);
    return cars.some((other) => {
      const { x: ox, y: oy, h: oh } = spot(other);
      return Math.abs(oh - h) < SPAWN_GAP && Math.hypot(ox - x, oy - y) < SPAWN_GAP;
    });
  };

  const spawnOnLane = (lane) => {
    if (countHigh() >= highCap) return;
    const car = newCar(false);
    boardLane(car, lane, random() * lane.path.length);
    if (crowdedAt(car) || stretches.some((stretch) => inStretch(stretch, car))) return;
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
      return enterCell(car, outside, (dir + 4) % 8);
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

  /** 出口放得下自己吗：到下一个路口的路段要放得下，出口斑马线外面要留出一个车身，那里有慢车就不进。 */
  const exitFree = (car, exit = car.exit) => {
    if (!exit?.crossing) return true;
    if (!linkFree(car, exit)) return false;
    const step = Math.hypot(...DIRECTIONS[exit.dir]);
    const need = exit.crossing.far + lengthOf(car) + CLEARANCE;
    const [dx, dy] = DIRECTIONS[exit.dir];
    const back = (exit.dir + 4) % 8;
    for (let k = 1; (k - 0.5) * step < need; k += 1) {
      const cell = (Math.floor(exit.node / N) + dy * k) * N + (exit.node % N) + dx * k;
      for (const other of queued(`${String(cell)}:${String(back)}`)) {
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
  /** 车身还有一部分在环上：刚切进来和刚切出去的车都算，环上的后车要给它们留车身。 */
  const touchingRing = (car) => {
    if (car.mode !== 'ring') return false;
    const reach = lengthOf(car) + CLEARANCE;
    return car.s >= car.trip.enter - reach && car.s <= car.trip.leave + reach;
  };

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
    if (busy || !linkFree(car, car.exit.leg)) {
      car.waiting = true;
      return limit - car.s;
    }
    if (car.s > limit - 0.06) car.cleared = true;
    return Infinity;
  };

  /**
   * 这个进口排在前面的车要在路口里让行、还没过让行点：后面的车不跟进去。
   * 先到停车线的排在前面；都还没到停车线时，同一格里里程大的在前面，选好的走向在 pending 里。
   */
  const yielderAhead = (car, stop) =>
    cars.some((other) => {
      if (other === car) return false;
      if (other.stop === stop) {
        const ahead = car.stop !== stop || other.stopOrder < car.stopOrder;
        return ahead && !other.committed && (other.movement?.yields?.length ?? 0) > 0;
      }
      if (car.stop === stop || other.ahead !== stop || other.key !== car.key) return false;
      return other.s > car.s && (other.pending?.yields.length ?? 0) > 0;
    });

  /** 停车格在下一格：绿灯、出口放得下、前车不在路口里让行，才开进去；否则在停车线后等，哪怕停车线在下一格。 */
  const roomBeforeStop = (car) => {
    const { ahead, pending } = car;
    if (!ahead || !pending || car.released) return Infinity;
    const phases = [pending.phase];
    const go =
      lightAt(ahead.signal, phases, time) === 'green' &&
      exitFree(car, pending.exit) &&
      !yielderAhead(car, ahead);
    if (go) {
      car.released = true;
      return Infinity;
    }
    car.waiting = true;
    return car.path.length - car.s + ahead.distance - lengthOf(car) / 2 - STOP_MARGIN;
  };

  /** 停车线前的判断。返回还能往前走多远，没有停车线或者已经放行时是无穷。 */
  const roomToStop = (car) => {
    car.waiting = false;
    if (car.mode === 'ring') return roomToYield(car);
    if (car.mode !== 'cell') return Infinity;
    if (!car.stop || car.stop.cell !== car.cell) return roomBeforeStop(car);
    if (car.cleared) return Infinity;
    const limit = car.stop.distance - lengthOf(car) / 2 - STOP_MARGIN;
    const go =
      lightAt(car.stop.signal, car.phases, time) === 'green' &&
      exitFree(car) &&
      !yielderAhead(car, car.stop);
    if (go) {
      car.cleared = true;
      car.clearedOn = 'green';
      return Infinity;
    }
    if (car.s > limit + 0.02) {
      car.cleared = true;
      car.clearedOn = 'forced';
      return Infinity;
    }
    car.waiting = true;
    return limit - car.s;
  };

  /** 对方线上的这辆车还没过冲突点：在路口里没开过去，或者在停车线前已经放行、灯还是绿的。 */
  const approaching = (other, otherAt) => {
    if (other.inJunction) {
      return other.progress + other.s < otherAt + lengthOf(other) / 2 + CLEARANCE;
    }
    if (!other.stop || other.cell !== other.stop.cell) return false;
    return other.cleared || lightAt(other.stop.signal, other.phases, time) === 'green';
  };

  /** 路口里的让行：让行点之前看该让的线上有没有车要来，有就在让行点等，没有就过。 */
  const roomToGap = (car) => {
    const yields = car.movement?.yields;
    if (!car.inJunction || car.committed || !yields?.length) return Infinity;
    const station = car.progress + car.s;
    const limit = Math.min(...yields.map(({ at }) => at)) - lengthOf(car) / 2 - STOP_MARGIN;
    if (station > limit + 0.02) {
      car.committed = true;
      return Infinity;
    }
    const blocked = yields.some(({ movement, otherAt }) =>
      cars.some(
        (other) => other !== car && other.movement === movement && approaching(other, otherAt),
      ),
    );
    if (!blocked) {
      if (station > limit - 0.06) car.committed = true;
      return Infinity;
    }
    car.yielding = true;
    return limit - station;
  };

  /** 公交到站：开到格子中央停下，停够时间再走。 */
  const roomToBay = (car, dt) => {
    if (car.mode !== 'cell' || !car.bay || car.dwell <= 0) return Infinity;
    const room = car.path.length / 2 - car.s;
    if (room < -BAY_MARGIN) return Infinity;
    if (room < BAY_MARGIN) car.dwell -= dt;
    return room;
  };

  /** 环上前车的距离，按角度量。刚出环的车按它离开的方向接着量，车身还在环上时后车不会追尾。 */
  const roomOnRing = (car) => {
    if (!touchingRing(car) || car.s > car.trip.leave) return Infinity;
    const own = ringAngleOf(car);
    let room = Infinity;
    for (const other of cars) {
      if (other === car || other.ring !== car.ring || !touchingRing(other)) continue;
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

  /** 共用路面上的每支队：按到共用端点的距离排好，每辆车看排在它前面的那辆。 */
  const roomsInStretches = () => {
    const rooms = new Map();
    for (const stretch of stretches) {
      const ahead = stretch.fromTail ? 1 : -1;
      const queue = cars
        .filter((car) => inStretch(stretch, car))
        .sort((a, b) => ahead * (distanceToEnd(stretch, a) - distanceToEnd(stretch, b)));
      queue.forEach((car, index) => {
        if (index === 0) return;
        const leader = queue[index - 1];
        const gap = Math.abs(distanceToEnd(stretch, leader) - distanceToEnd(stretch, car));
        const room = gap - (lengthOf(car) + lengthOf(leader)) / 2 - CLEARANCE;
        rooms.set(car, Math.min(rooms.get(car) ?? Infinity, room));
      });
    }
    return rooms;
  };

  /** 走完这一段接的是哪一队：key 是队的名字，start 是接上这一队的里程。 */
  const nextQueue = (car) => {
    if (car.mode === 'ring') {
      const { outside, dir } = car.exit;
      const key = queueKeyOf(outside, (dir + 4) % 8);
      return key === null ? null : { key, start: 0 };
    }
    if (car.mode === 'cell') {
      const [dx, dy] = DIRECTIONS[car.to];
      const next = (Math.floor(car.cell / N) + dy) * N + (car.cell % N) + dx;
      const key = queueKeyOf(next, (car.to + 4) % 8);
      if (key === null) return null;
      const left =
        !ringOfCell.has(next) &&
        car.key.endsWith(LEFT_LANE) &&
        (car.route?.length > 0 || !car.inJunction);
      return { key: `${key}${left ? LEFT_LANE : ''}`, start: 0 };
    }
    const { merge, toCell, arrival } = car.lane;
    if (merge) {
      const main = laneById.get(merge.lane);
      return { key: main.id, start: main.path.along[merge.at] };
    }
    if (toCell === undefined) return null;
    const key = queueKeyOf(toCell, arrival);
    return key === null ? null : { key, start: 0 };
  };

  /** 横移那一格的前半段：左转道的车和外侧车道的车还并在一起，谁在前就跟谁。 */
  const roomInLaneChange = (car) => {
    if (car.mode !== 'cell' || car.inJunction || car.s >= LANE_CHANGE_REACH) return Infinity;
    const left = car.key.endsWith(LEFT_LANE);
    const other = left ? car.key.slice(0, -LEFT_LANE.length) : car.key + LEFT_LANE;
    let room = Infinity;
    for (const mate of groups.get(other) ?? []) {
      if (mate.s <= car.s || mate.s >= LANE_CHANGE_REACH + lengthOf(mate)) continue;
      room = Math.min(room, mate.s - car.s - (lengthOf(car) + lengthOf(mate)) / 2 - CLEARANCE);
    }
    return room;
  };

  /** 队伍按里程从大到小排，起点之后最靠后的一辆就是队尾；found 为真的才算。 */
  const tailOf = (key, start, found) => {
    let last = null;
    for (const other of groups.get(key) ?? []) if (other.s >= start && found(other)) last = other;
    return last;
  };

  /** 下一段排尾的车，跨段时也不能撞上去。下一格是横移那一格时，另一条队前半段的车也算队尾。 */
  const roomToNextQueue = (car) => {
    const next = nextQueue(car);
    if (!next) return Infinity;
    const sibling = next.key.endsWith(LEFT_LANE)
      ? next.key.slice(0, -LEFT_LANE.length)
      : next.key + LEFT_LANE;
    const tails = [
      tailOf(next.key, next.start, () => true),
      tailOf(sibling, next.start, (other) => !other.inJunction && other.s < LANE_CHANGE_REACH),
    ];
    let room = Infinity;
    for (const last of tails) {
      if (!last) continue;
      const ahead = car.path.length - car.s + last.s - next.start;
      room = Math.min(room, ahead - (lengthOf(car) + lengthOf(last)) / 2 - CLEARANCE);
    }
    return room;
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
    const shared = roomsInStretches();
    for (const group of groups.values()) {
      group.forEach((car, index) => {
        car.yielding = false;
        const leader = index > 0 ? group[index - 1] : null;
        let room = roomToNextQueue(car);
        if (leader !== null) {
          room = Math.min(
            room,
            leader.s - car.s - (lengthOf(leader) + lengthOf(car)) / 2 - CLEARANCE,
          );
        }
        room = Math.min(
          room,
          shared.get(car) ?? Infinity,
          roomInLaneChange(car),
          roomToStop(car),
          roomToGap(car),
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
    time: () => time,
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
