import { Particle, ParticleContainer, Rectangle } from 'pixi.js';
import { DIRECTIONS, ROAD_SPEC, spokesOf } from './sim/network.js';
import { screenOf } from './world.js';

// 动态车流和红绿灯。这是纯视觉层：只读路段的负载比，不写任何东西，经济和拥堵的结算完全不知道它的存在。
// 车只在屏幕内生成，出了屏幕就回收；路段负载越高，这一段该有的车越多，总数不超过 cap。
// 地面的车画在物体层下面，所以楼能挡住身后的车；高架和匝道上的车画在物体层上面。

const CYCLE_GREEN = 5.5;
const CYCLE_YELLOW = 1;
const CYCLE_RED = 0.8;
const PHASE = CYCLE_GREEN + CYCLE_YELLOW + CYCLE_RED;
const SPEED = { road: 1.1, arterial: 1.5, highway: 2.2, express: 2.2, ramp: 1.4 };
const LANE_OFFSET = { road: 0.115, arterial: 0.17, highway: 0.2, express: 0.2, ramp: 0 };
const GAP = 0.3;
const RAMP_CHANCE = 0.35;
const LIGHTS = { green: 0x45e07a, yellow: 0xffc832, red: 0xff4438 };
const TURNS = 6;

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
  if (Math.abs(fx * tx + fy * ty + 1) < 1e-6) return [[...start, 0], [...end, 0]];
  const control = [cx + (fy - ty) * offset, cy + (tx - fx) * offset];
  const points = [];
  for (let i = 0; i <= TURNS; i += 1) {
    const t = i / TURNS;
    const a = (1 - t) * (1 - t);
    const b = 2 * t * (1 - t);
    const c = t * t;
    points.push([a * start[0] + b * control[0] + c * end[0], a * start[1] + b * control[1] + c * end[1], 0]);
  }
  return points;
}

function measured(points) {
  const along = [0];
  for (let i = 1; i < points.length; i += 1) {
    along.push(along[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
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
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, h: ah + (bh - ah) * t, hx: bx - ax, hy: by - ay, index: i };
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

function pool(atlas, count, area) {
  const key = 'car-0-0';
  const frame = atlas.frames[key];
  const container = new ParticleContainer({
    texture: atlas.textures[key],
    dynamicProperties: { position: true, rotation: false, uvs: true, vertex: true, color: true },
  });
  const slots = [];
  for (let i = 0; i < count; i += 1) {
    const particle = new Particle({ texture: atlas.textures[key], x: -1e5, y: -1e5, anchorX: frame.ax / frame.w, anchorY: frame.ay / frame.h });
    particle.alpha = 0;
    container.addParticle(particle);
    slots.push(particle);
  }
  container.boundsArea = area;
  return { container, slots, free: [...slots] };
}

function hide(particle) {
  particle.alpha = 0;
  particle.x = -1e5;
}

export function createVehicles(atlas, city, scene, { cap }) {
  const { N, roads, lanes = [] } = city;
  const area = new Rectangle(-N * 80, -400, N * 160, N * 80 + 800);
  const groundPool = pool(atlas, cap * 2, area);
  const highPool = pool(atlas, Math.min(240, cap * 2), area);
  scene.world.addChildAt(groundPool.container, 1);
  scene.world.addChild(highPool.container);

  const load = new Map();
  for (const edge of city.traffic.edges) {
    load.set(`${String(edge.from)}:${String(edge.to)}`, edge.ratio);
    load.set(`${String(edge.to)}:${String(edge.from)}`, edge.ratio);
  }
  const laneById = new Map(lanes.map((lane) => [lane.id, { ...lane, path: measured(lane.points) }]));
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

  const signalLamps = [];
  const poles = [];
  for (const [id, junction] of junctions) {
    const x = id % N;
    const y = Math.floor(id / N);
    const entry = roads.get(id);
    for (const dir of spokesOf(entry.road)) {
      const [dx, dy] = unitDirection(dir);
      const half = ROAD_SPEC[kindOf(entry, dir)].walk / 2 - 0.03;
      const px = x + 0.5 + dx * 0.46 + dy * half;
      const py = y + 0.5 + dy * 0.46 - dx * half;
      const { sx, sy } = screenOf(px, py, 0);
      poles.push({ sx, sy });
      signalLamps.push({ sx, sy, junction, axis: dir % 4 });
    }
  }
  const staticParticle = (key, sx, sy) => {
    const frame = atlas.frames[key];
    return new Particle({ texture: atlas.textures[key], x: sx, y: sy, anchorX: frame.ax / frame.w, anchorY: frame.ay / frame.h });
  };
  const poleLayer = new ParticleContainer({ texture: atlas.textures.pole, dynamicProperties: { position: false, rotation: false, uvs: false, vertex: false, color: true } });
  const lampLayer = new ParticleContainer({ texture: atlas.textures.lamp, dynamicProperties: { position: false, rotation: false, uvs: false, vertex: false, color: true } });
  poleLayer.boundsArea = area;
  lampLayer.boundsArea = area;
  const poleParticles = poles.map(({ sx, sy }) => {
    const particle = staticParticle('pole', sx, sy);
    poleLayer.addParticle(particle);
    return particle;
  });
  for (const lamp of signalLamps) {
    lamp.particle = staticParticle('lamp', lamp.sx, lamp.sy);
    lampLayer.addParticle(lamp.particle);
  }
  if (signalLamps.length > 0) {
    scene.world.addChildAt(poleLayer, 2);
    scene.world.addChildAt(lampLayer, 3);
  }

  let time = 0;
  let glow = 0;
  let tint = 0xffffff;
  let viewBox = { left: -1e6, right: 1e6, top: -1e6, bottom: 1e6 };
  let visibleEdges = [];
  let visibleLanes = [];
  let wanted = 0;
  let refreshIn = 0;
  const cars = [];

  const acquire = (high) => {
    const { free } = high ? highPool : groundPool;
    if (free.length < 2) return null;
    return { high, body: free.pop(), light: free.pop() };
  };
  const release = ({ high, body, light }) => {
    const { free } = high ? highPool : groundPool;
    hide(body);
    hide(light);
    free.push(body, light);
  };
  const place = (car, high) => {
    if (car.slot.high === high) return true;
    const next = acquire(high);
    if (!next) return false;
    release(car.slot);
    car.slot = next;
    return true;
  };

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
    if (ramps?.length > 0 && (spokes.length === 0 || Math.random() < RAMP_CHANCE)) {
      car.mode = 'lane';
      car.lane = ramps[Math.floor(Math.random() * ramps.length)];
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
    let roll = Math.random() * total;
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

  const spawnOnEdge = (edge) => {
    const forward = Math.random() < 0.5;
    const cell = forward ? edge.from : edge.to;
    const from = forward ? (edge.dir + 4) % 8 : edge.dir;
    const slot = acquire(false);
    if (!slot) return;
    const color = Math.floor(Math.random() * 4);
    const car = { slot, color, speed: 0, s: 0, top: 1 + Math.random() * 0.2, bus: Math.random() < 0.06 };
    if (!enterCell(car, cell, from)) {
      release(slot);
      return;
    }
    car.s = Math.random() * car.path.length * 0.6;
    cars.push(car);
  };

  const spawnOnLane = (lane) => {
    const slot = acquire(true);
    if (!slot) return;
    cars.push({
      slot,
      color: Math.floor(Math.random() * 4),
      speed: 0,
      top: 1 + Math.random() * 0.2,
      bus: false,
      mode: 'lane',
      lane,
      path: lane.path,
      s: Math.random() * lane.path.length,
      key: lane.id,
    });
  };

  const refreshView = () => {
    visibleEdges = city.traffic.edges.filter((edge) => {
      if (edge.kind === 'ramp') return false;
      const { sx, sy } = screenOf((edge.from % N) + 0.5, Math.floor(edge.from / N) + 0.5, 0);
      return sx > viewBox.left && sx < viewBox.right && sy > viewBox.top && sy < viewBox.bottom;
    });
    visibleLanes = [...laneById.values()].filter((lane) => lane.points.some(([x, y, h]) => {
      const { sx, sy } = screenOf(x, y, h);
      return sx > viewBox.left && sx < viewBox.right && sy > viewBox.top && sy < viewBox.bottom;
    }));
    const demand = visibleEdges.reduce((sum, edge) => sum + 0.18 + edge.ratio * 1.6, 0) + visibleLanes.reduce((sum, lane) => sum + lane.path.length * 0.12, 0);
    wanted = Math.min(cap, Math.round(demand));
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
        const limit = SPEED[car.mode === 'lane' ? car.lane.kind : car.kind] * car.top;
        let room = Infinity;
        if (index > 0) room = group[index - 1].s - car.s - GAP;
        const ahead = car.path.length - car.s;
        if (mustStop(car)) room = Math.min(room, ahead - 0.02);
        car.speed = Math.max(0, Math.min(limit, room * 5));
        car.s += car.speed * dt;
      });
    }
    for (let i = cars.length - 1; i >= 0; i -= 1) {
      const car = cars[i];
      let alive = true;
      if (car.mode === 'lane' && car.lane.exits.length > 0) {
        const { index } = pointAt(car.path, car.s);
        for (const exit of car.lane.exits) {
          if (exit.at === index && !car.passed?.has(exit.lane) && car.s > car.path.along[exit.at]) {
            (car.passed ??= new Set()).add(exit.lane);
            if (Math.random() < RAMP_CHANCE) {
              const ramp = laneById.get(exit.lane);
              car.lane = ramp;
              car.path = ramp.path;
              car.s = 0;
              car.key = ramp.id;
              car.passed = null;
              break;
            }
          }
        }
      }
      if (car.s >= car.path.length) alive = finishPath(car);
      if (alive) {
        const spot = pointAt(car.path, Math.min(car.s, car.path.length));
        const { sx, sy } = screenOf(spot.x, spot.y, spot.h);
        const margin = 240;
        alive = sx > viewBox.left - margin && sx < viewBox.right + margin && sy > viewBox.top - margin && sy < viewBox.bottom + margin;
        if (alive) {
          const onLane = car.mode === 'lane';
          if (!place(car, onLane)) alive = false;
        }
        if (alive) {
          const rotation = rotationOf(spot.hx, spot.hy);
          const key = car.bus ? `bus-${String(rotation)}` : `car-${String(car.color)}-${String(rotation)}`;
          const { body, light } = car.slot;
          const frame = atlas.frames[key];
          body.texture = atlas.textures[key];
          body.anchorX = frame.ax / frame.w;
          body.anchorY = frame.ay / frame.h;
          body.x = sx;
          body.y = sy;
          body.alpha = 1;
          body.tint = tint;
          const glowKey = `${key}~g`;
          if (glow > 0.02 && atlas.frames[glowKey]) {
            const lit = atlas.frames[glowKey];
            light.texture = atlas.textures[glowKey];
            light.anchorX = lit.ax / lit.w;
            light.anchorY = lit.ay / lit.h;
            light.x = sx;
            light.y = sy;
            light.alpha = glow;
          } else hide(light);
        }
      }
      if (!alive || cars.length > wanted + 8) {
        release(car.slot);
        cars.splice(i, 1);
      }
    }
    for (let i = 0; i < 8 && cars.length < wanted; i += 1) {
      const fromLane = visibleLanes.length > 0 && Math.random() < 0.3;
      if (fromLane) spawnOnLane(visibleLanes[Math.floor(Math.random() * visibleLanes.length)]);
      else if (visibleEdges.length > 0) spawnOnEdge(visibleEdges[Math.floor(Math.random() * visibleEdges.length)]);
    }
    for (const lamp of signalLamps) lamp.particle.tint = LIGHTS[phaseOf(lamp.junction, lamp.axis, time)];
  };

  return {
    step,
    setView(box) {
      viewBox = box;
      refreshIn = 0;
    },
    setTime(nextTint, nextGlow) {
      tint = nextTint;
      glow = nextGlow;
      for (const particle of poleParticles) particle.tint = tint;
    },
    count: () => cars.length,
    wanted: () => wanted,
    signals: signalLamps.length,
    stopped: () => cars.filter((car) => car.speed < 0.02).length,
  };
}
