import { DIRECTIONS, ROAD_SPEC, spokesOf } from './network.js';

// 车流和红绿灯的模拟。这是纯视觉层：只读路段的负载比，不写任何东西，经济和拥堵的结算完全不知道它的存在。
// 这里不依赖图形库，所以检查脚本可以不开画面直接跑；画车是 web/vehicles.js 的事。
// 车只在视野内生成，出了视野就回收；路段负载越高，这一段该有的车越多，总数不超过 cap。
// full 为真时不看负载，视野里一直保持 cap 辆车，测帧率时才真的是这么多车。

const CYCLE_GREEN = 5.5;
const CYCLE_YELLOW = 1;
const CYCLE_RED = 0.8;
const PHASE = CYCLE_GREEN + CYCLE_YELLOW + CYCLE_RED;
const SPEED = { road: 1.1, arterial: 1.5, highway: 2.2, express: 2.2, ramp: 1.4 };
const LANE_OFFSET = { road: 0.115, arterial: 0.17, highway: 0.2, express: 0.2, ramp: 0 };
const GAP = 0.3;
const RAMP_CHANCE = 0.35;
const TURNS = 6;
const VIEW_MARGIN = 240;
const TILE_HALF_W = 64;
const TILE_HALF_H = 32;
const LEVEL_PIXELS = 32;

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
  if (Math.abs(fx * tx + fy * ty + 1) < 1e-6)
    return [
      [...start, 0],
      [...end, 0],
    ];
  const control = [cx + (fy - ty) * offset, cy + (tx - fx) * offset];
  const points = [];
  for (let i = 0; i <= TURNS; i += 1) {
    const t = i / TURNS;
    const a = (1 - t) * (1 - t);
    const b = 2 * t * (1 - t);
    const c = t * t;
    points.push([
      a * start[0] + b * control[0] + c * end[0],
      a * start[1] + b * control[1] + c * end[1],
      0,
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

function pointAt(path, s) {
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
    hx: bx - ax,
    hy: by - ay,
    index: i,
  };
}

/** 车身朝向的八个方向。精灵的第 r 张朝向是局部 +x 旋转 r×45°，屏幕上 y 向下。 */
function rotationOf(hx, hy) {
  const angle = Math.atan2(-hy, hx);
  return ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
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

export function createFleet(city, { cap, full = false, highCap = 120, random = Math.random }) {
  const { N, roads, lanes = [] } = city;
  const load = new Map();
  for (const edge of city.traffic.edges) {
    load.set(`${String(edge.from)}:${String(edge.to)}`, edge.ratio);
    load.set(`${String(edge.to)}:${String(edge.from)}`, edge.ratio);
  }
  const laneById = new Map(
    lanes.map((lane) => [lane.id, { ...lane, path: measured(lane.points) }]),
  );
  const lanesFrom = new Map();
  for (const lane of laneById.values()) {
    if (lane.fromCell === undefined) continue;
    if (!lanesFrom.has(lane.fromCell)) lanesFrom.set(lane.fromCell, []);
    lanesFrom.get(lane.fromCell).push(lane);
  }

  const junctions = new Map();
  for (const [id, entry] of roads) {
    if (entry.highway) continue;
    const spokes = spokesOf(entry.road);
    if (spokes.length < 3) continue;
    const axes = [...new Set(spokes.map((dir) => dir % 4))];
    junctions.set(id, { axes, offset: (id * 37) % 11 });
  }

  const phaseOf = (junction, axis, time) => {
    const count = junction.axes.length;
    const position = (time + junction.offset) % (PHASE * count);
    const index = Math.floor(position / PHASE);
    if (junction.axes[index] !== axis) return 'red';
    const local = position - index * PHASE;
    if (local < CYCLE_GREEN) return 'green';
    return local < CYCLE_GREEN + CYCLE_YELLOW ? 'yellow' : 'red';
  };

  const signals = [];
  for (const [id, junction] of junctions) {
    const x = id % N;
    const y = Math.floor(id / N);
    const entry = roads.get(id);
    for (const dir of spokesOf(entry.road)) {
      const [dx, dy] = unitDirection(dir);
      const half = ROAD_SPEC[kindOf(entry, dir)].walk / 2 - 0.03;
      signals.push({
        px: x + 0.5 + dx * 0.46 + dy * half,
        py: y + 0.5 + dy * 0.46 - dx * half,
        level: 0,
        junction,
        axis: dir % 4,
      });
    }
  }

  let time = 0;
  let viewBox = { left: -1e6, right: 1e6, top: -1e6, bottom: 1e6 };
  let visibleEdges = [];
  let visibleLanes = [];
  let wanted = 0;
  let refreshIn = 0;
  const cars = [];
  const removed = [];
  const countHigh = () => cars.reduce((sum, car) => sum + (car.high ? 1 : 0), 0);

  const enterCell = (car, cell, from) => {
    const entry = roads.get(cell);
    const x = cell % N;
    const y = Math.floor(cell / N);
    const spokes = spokesOf(entry.road | entry.highway).filter((dir) => dir !== from);
    const heading = unitDirection((from + 4) % 8);
    const ramps = lanesFrom.get(cell)?.filter((lane) => {
      const { hx, hy } = pointAt(lane.path, 0);
      return (hx * heading[0] + hy * heading[1]) / Math.hypot(hx, hy) > 0.2;
    });
    if (ramps?.length > 0 && (spokes.length === 0 || random() < RAMP_CHANCE)) {
      car.mode = 'lane';
      car.lane = ramps[Math.floor(random() * ramps.length)];
      car.path = car.lane.path;
      car.s = 0;
      car.key = car.lane.id;
      return true;
    }
    if (spokes.length === 0) return false;
    const weights = spokes.map((dir) => {
      const [dx, dy] = DIRECTIONS[dir];
      const next = (y + dy) * N + x + dx;
      if (!roads.has(next)) return 0;
      const straight = dir === (from + 4) % 8 ? 2.5 : 1;
      return straight * (0.15 + (load.get(`${String(cell)}:${String(next)}`) ?? 0));
    });
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return false;
    let roll = random() * total;
    let to = spokes[0];
    for (let i = 0; i < spokes.length; i += 1) {
      roll -= weights[i];
      if (roll <= 0) {
        to = spokes[i];
        break;
      }
    }
    const kind = kindOf(entry, to);
    car.mode = 'cell';
    car.cell = cell;
    car.from = from;
    car.to = to;
    car.kind = kind;
    car.path = measured(cellLane(x, y, from, to, kind));
    car.s = 0;
    car.key = `${String(cell)}:${String(from)}`;
    return true;
  };

  const newCar = () => ({
    color: Math.floor(random() * 4),
    speed: 0,
    s: 0,
    top: 1 + random() * 0.2,
    bus: false,
    high: false,
  });

  const spawnOnEdge = (edge) => {
    const forward = random() < 0.5;
    const cell = forward ? edge.from : edge.to;
    const from = forward ? (edge.dir + 4) % 8 : edge.dir;
    const car = { ...newCar(), bus: random() < 0.06 };
    if (!enterCell(car, cell, from)) return;
    car.s = random() * car.path.length * 0.6;
    cars.push(car);
  };

  const spawnOnLane = (lane) => {
    if (countHigh() >= highCap) return;
    cars.push({
      ...newCar(),
      high: true,
      mode: 'lane',
      lane,
      path: lane.path,
      s: random() * lane.path.length,
      key: lane.id,
    });
  };

  const refreshView = () => {
    const inView = ({ sx, sy }) =>
      sx > viewBox.left && sx < viewBox.right && sy > viewBox.top && sy < viewBox.bottom;
    visibleEdges = city.traffic.edges.filter(
      (edge) =>
        edge.kind !== 'ramp' &&
        inView(screenAt((edge.from % N) + 0.5, Math.floor(edge.from / N) + 0.5, 0)),
    );
    visibleLanes = [...laneById.values()].filter((lane) =>
      lane.points.some(([x, y, h]) => inView(screenAt(x, y, h))),
    );
    const demand =
      visibleEdges.reduce((sum, edge) => sum + 0.18 + edge.ratio * 1.6, 0) +
      visibleLanes.reduce((sum, lane) => sum + lane.path.length * 0.12, 0);
    wanted = full ? cap : Math.min(cap, Math.round(demand));
  };

  const finishPath = (car) => {
    if (car.mode === 'lane') {
      const { lane } = car;
      if (lane.merge) {
        const main = laneById.get(lane.merge.lane);
        car.lane = main;
        car.path = main.path;
        car.s = main.path.along[lane.merge.at];
        car.key = main.id;
        return true;
      }
      if (lane.toCell !== undefined) {
        const end = pointAt(lane.path, lane.path.length);
        return enterCell(car, lane.toCell, backwardDirection(end.hx, end.hy));
      }
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

  /** 车到了路口停止线前面要不要停。只看下一格是不是信号路口，以及自己这个方向是不是绿灯。 */
  const mustStop = (car) => {
    if (car.mode !== 'cell') return false;
    const [dx, dy] = DIRECTIONS[car.to];
    const next = (Math.floor(car.cell / N) + dy) * N + (car.cell % N) + dx;
    const junction = junctions.get(next);
    if (!junction) return false;
    const state = phaseOf(junction, car.to % 4, time);
    return state !== 'green';
  };

  const remove = (index) => {
    removed.push(cars[index]);
    cars.splice(index, 1);
  };

  const follow = (car, room) => {
    const limit = SPEED[car.mode === 'lane' ? car.lane.kind : car.kind] * car.top;
    car.speed = Math.max(0, Math.min(limit, room * 5));
  };

  const takeExit = (car) => {
    const { index } = pointAt(car.path, car.s);
    for (const exit of car.lane.exits) {
      if (exit.at !== index || car.passed?.has(exit.lane) || car.s <= car.path.along[exit.at]) continue;
      (car.passed ??= new Set()).add(exit.lane);
      if (random() < RAMP_CHANCE) {
        const ramp = laneById.get(exit.lane);
        car.lane = ramp;
        car.path = ramp.path;
        car.s = 0;
        car.key = ramp.id;
        car.passed = null;
        return;
      }
    }
  };

  const step = (dt) => {
    time += dt;
    refreshIn -= dt;
    if (refreshIn <= 0) {
      refreshView();
      refreshIn = 0.5;
    }
    const groups = new Map();
    for (const car of cars) {
      if (!groups.has(car.key)) groups.set(car.key, []);
      groups.get(car.key).push(car);
    }
    for (const group of groups.values()) group.sort((a, b) => b.s - a.s);
    for (const group of groups.values()) {
      group.forEach((car, index) => {
        let room = Infinity;
        if (index > 0) room = group[index - 1].s - car.s - GAP;
        if (mustStop(car)) room = Math.min(room, car.path.length - car.s - 0.02);
        follow(car, room);
        car.s += car.speed * dt;
      });
    }
    for (let i = cars.length - 1; i >= 0; i -= 1) {
      const car = cars[i];
      if (car.mode === 'lane' && car.lane.exits.length > 0) takeExit(car);
      let alive = true;
      if (car.s >= car.path.length) alive = finishPath(car);
      if (alive) {
        const spot = pointAt(car.path, Math.min(car.s, car.path.length));
        const { sx, sy } = screenAt(spot.x, spot.y, spot.h);
        alive =
          sx > viewBox.left - VIEW_MARGIN &&
          sx < viewBox.right + VIEW_MARGIN &&
          sy > viewBox.top - VIEW_MARGIN &&
          sy < viewBox.bottom + VIEW_MARGIN;
        car.x = spot.x;
        car.y = spot.y;
        car.h = spot.h;
        car.rotation = rotationOf(spot.hx, spot.hy);
        car.high = car.mode === 'lane';
      }
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
    lightOf: ({ junction, axis }) => phaseOf(junction, axis, time),
    setView(box) {
      viewBox = box;
      refreshIn = 0;
    },
    count: () => cars.length,
    wanted: () => wanted,
    stopped: () => cars.filter((car) => car.speed < 0.02).length,
  };
}
