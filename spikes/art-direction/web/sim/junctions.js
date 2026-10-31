import { DIRECTIONS, ROAD_SPEC, spokesOf } from './network.js';
import { roadField } from './roadfield.js';

// 路口规划。纯逻辑，素材、车流和检查都读这一份，所以画出来的斑马线、灯杆和车停的位置永远一致。
//
// 进口的几何：沿每条腿从路口中心往外走，第一处两侧都已经离开别的路面、又还在自己的人行道上的位置放斑马线，
// 斑马线外面是停车线，停车线右侧的人行道上立灯杆。45° 夹角的腿退让距离超过一格时就退到下一格。
//
// 路口合并：两个路口之间的连接段不超过 1 格时算一个大路口，连接段上不画斑马线、不放灯，只在外圈进口放，
// 整组共用一套信号，车过了停车线就一路通过，不会被困在中间。
//
// 信号：每个进口单独一相，同一时刻只有一个进口放行，所以直行和对向左转不会互相穿过。代价是一个周期长一些。
// 一相是绿灯、黄灯和全红清空。全红时长按这组路口里最长的通过路线算，红灯亮时已经进路口的车来得及开走。
//
// 5 条腿及以上的路口不用信号灯，改成环岛，见 roundabout.js。环岛的每条腿也有斑马线，让行线在斑马线外面，
// 车在斑马线外等，看环上没车才一路开进去，不会停在斑马线上。放不下环岛的路口退回信号灯。

const MIN_STATION = 0.3;
const RING_STATION = 1.62;
const STATION_STEP = 0.02;
const MAX_STATION = 2.6;
const CROSSING = 0.09;
const STOP_GAP = 0.05;
const POLE_GAP = 0.03;
const DECK_MARGIN = 0.012;
const END_OUTSIDE = 0.05;

export const GREEN = 4;
export const YELLOW = 1;
const CLEAR_SPEED = 1.1;
const CLEAR_MARGIN = 0.4;

export function unitOf(dir) {
  const [dx, dy] = DIRECTIONS[dir];
  const length = Math.hypot(dx, dy);
  return [dx / length, dy / length, length];
}

function kindOf(entry, dir) {
  return (entry.arterial ?? 0) & (1 << dir) ? 'arterial' : 'road';
}

function isNode(entry) {
  return !entry.highway && spokesOf(entry.road).length >= 3;
}

const cellStep = (id, dir, N) => {
  const [dx, dy] = DIRECTIONS[dir];
  return (Math.floor(id / N) + dy) * N + (id % N) + dx;
};

/** 两个路口之间连接段不超过一格的，并成一组。 */
function clusterNodes(roads, N, skip) {
  const nodes = [...roads.keys()]
    .filter((id) => isNode(roads.get(id)) && !skip.has(id))
    .sort((a, b) => a - b);
  const parent = new Map(nodes.map((id) => [id, id]));
  const find = (id) => (parent.get(id) === id ? id : find(parent.get(id)));
  const links = new Set();
  const join = (a, b) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const id of nodes) {
    for (const dir of spokesOf(roads.get(id).road)) {
      const next = cellStep(id, dir, N);
      const entry = roads.get(next);
      if (!entry) continue;
      if (parent.has(next)) {
        join(id, next);
        continue;
      }
      const after = cellStep(next, dir, N);
      if (parent.has(after) && spokesOf(entry.road).length === 2) {
        join(id, after);
        links.add(next);
      }
    }
  }
  const groups = new Map();
  for (const id of nodes) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  }
  return { groups: [...groups.values()], links };
}

/** 沿腿往外走，找第一处放得下斑马线的位置：两端都在人行道上，整条斑马线宽度内都离开了别的路面。 */
function crossingStation(field, x, y, dir, kind, from) {
  const [ux, uy] = unitOf(dir);
  const half = ROAD_SPEC[kind].deck / 2 + END_OUTSIDE;
  const clear = (s) =>
    [-1, 1].every((side) => {
      const px = x + ux * s - uy * side * half;
      const py = y + uy * s + ux * side * half;
      return field.deck(px, py) > DECK_MARGIN && field.walk(px, py) < 0;
    });
  for (let s = from; s < MAX_STATION; s += STATION_STEP) {
    if (clear(s) && clear(s + CROSSING) && clear(s + CROSSING + STOP_GAP + POLE_GAP)) return s;
  }
  return null;
}

/** 一条外圈的腿：斑马线、停车线和灯杆的位置都从这里算。 */
function legOf({ field, node, dir, kind, N, levelAt, from = MIN_STATION }) {
  const x = (node % N) + 0.5;
  const y = Math.floor(node / N) + 0.5;
  const station = crossingStation(field, x, y, dir, kind, from);
  if (station === null) return { node, dir, kind, x, y, crossing: null };
  const [ux, uy] = unitOf(dir);
  const spec = ROAD_SPEC[kind];
  const middle = station + CROSSING / 2;
  const half = spec.deck / 2 + END_OUTSIDE;
  const [mx, my] = [x + ux * middle, y + uy * middle];
  const stop = station + CROSSING + STOP_GAP;
  const side = (spec.deck + spec.walk) / 4;
  const pole = [x + ux * (stop + POLE_GAP) + uy * side, y + uy * (stop + POLE_GAP) - ux * side];
  return {
    node,
    dir,
    kind,
    x,
    y,
    crossing: {
      px: mx,
      py: my,
      level: levelAt(mx, my),
      half,
      ends: [
        [mx - uy * half, my + ux * half],
        [mx + uy * half, my - ux * half],
      ],
      near: station,
      far: station + CROSSING,
    },
    stopLine: {
      px: x + ux * stop,
      py: y + uy * stop,
      level: levelAt(x + ux * stop, y + uy * stop),
      station: stop,
    },
    pole: { px: pole[0], py: pole[1], level: levelAt(pole[0], pole[1]) },
  };
}

/** 从一个进口出发的全部通过路线：每条路线是一串方向，终点是另一条外圈的腿。 */
function routesFrom(start, cells, legsByNode, roads, N) {
  const routes = [];
  const walk = (cell, from, dirs, seen) => {
    const entry = roads.get(cell);
    for (const dir of spokesOf(entry.road)) {
      if (dir === from) continue;
      const leg = legsByNode.get(`${String(cell)}:${String(dir)}`);
      if (leg) {
        if (leg !== start) routes.push({ dirs: [...dirs, dir], exit: leg });
        continue;
      }
      const next = cellStep(cell, dir, N);
      if (!cells.has(next) || seen.has(next)) continue;
      walk(next, (dir + 4) % 8, [...dirs, dir], new Set([...seen, next]));
    }
  };
  walk(start.node, start.dir, [], new Set([start.node]));
  return routes;
}

/** 一组路口的信号：每个进口一相，全红时长按最长的通过路线算。 */
function signalOf(id, legs, routes) {
  const longest = Math.max(
    1,
    ...routes.map(({ dirs }) => dirs.reduce((sum, dir) => sum + unitOf(dir)[2], 0)),
  );
  const clear = longest / CLEAR_SPEED + CLEAR_MARGIN;
  const stage = GREEN + YELLOW + clear;
  return { id, stage, clear, cycle: stage * legs.length, offset: (id * 37) % 11 };
}

/** 这一组路口此刻给这个进口的灯色。 */
export function lightAt(signal, phase, time) {
  const position = (time + signal.offset) % signal.cycle;
  const index = Math.floor(position / signal.stage);
  if (index !== phase) return 'red';
  const local = position - index * signal.stage;
  if (local < GREEN) return 'green';
  return local < GREEN + YELLOW ? 'yellow' : 'red';
}

/**
 * 进口的停车线落在哪一格。沿腿往外数格子，distance 是车从这一格的入口走到停车线的距离。
 * key 是 格子:车进来的方向，车流按它查自己前面有没有停车线。
 */
function stopEntry(leg, N) {
  const [, , step] = unitOf(leg.dir);
  const { station } = leg.stopLine;
  const index = Math.round(station / step);
  let cell = leg.node;
  for (let i = 0; i < index; i += 1) cell = cellStep(cell, leg.dir, N);
  return {
    key: `${String(cell)}:${String(leg.dir)}`,
    cell,
    distance: index * step + step / 2 - station,
  };
}

/**
 * 全城的路口规划。rings 是已经改成环岛的路口，它们的路面从普通路网里拿掉，腿由这里补上斑马线和让行线。
 * 返回信号路口组、全部外圈的腿、路面距离场，以及车流查询用的停车表。
 */
export function junctionPlan({ N, roads, surface, rings = [] }) {
  const ringCells = new Set(rings.flatMap(({ cells }) => [...cells]));
  const open = new Map([...roads].filter(([id]) => !ringCells.has(id)));
  const field = roadField(open, N, rings);
  const { groups, links } = clusterNodes(roads, N, ringCells);
  const clusters = [];
  const stops = new Map();
  for (const nodes of groups) {
    const cells = new Set(nodes);
    for (const id of nodes) {
      for (const dir of spokesOf(roads.get(id).road)) {
        const next = cellStep(id, dir, N);
        if (links.has(next)) cells.add(next);
      }
    }
    const legs = [];
    for (const node of nodes) {
      for (const dir of spokesOf(roads.get(node).road)) {
        if (cells.has(cellStep(node, dir, N))) continue;
        const kind = kindOf(roads.get(node), dir);
        legs.push(legOf({ field, node, dir, kind, N, levelAt: surface }));
      }
    }
    const legsByNode = new Map(legs.map((leg) => [`${String(leg.node)}:${String(leg.dir)}`, leg]));
    const routes = legs.map((leg) => routesFrom(leg, cells, legsByNode, roads, N));
    const signal = signalOf(nodes[0], legs, routes.flat());
    legs.forEach((leg, phase) => {
      if (!leg.crossing) return;
      const { key, cell, distance } = stopEntry(leg, N);
      stops.set(key, { leg, phase, signal, cell, distance, routes: routes[phase] });
    });
    clusters.push({ id: nodes[0], nodes, cells, legs, signal });
  }
  const ringLegs = rings.flatMap((ring) =>
    ring.arms.map((arm) => {
      const leg = legOf({
        field,
        node: ring.id,
        dir: arm.dir,
        kind: arm.kind,
        N,
        levelAt: surface,
        from: RING_STATION,
      });
      arm.leg = leg;
      return leg;
    }),
  );
  return {
    clusters,
    stops,
    ringLegs,
    field,
    legs: [...clusters.flatMap(({ legs }) => legs), ...ringLegs],
  };
}

/** 斑马线和停车线的精灵。 */
export function markSprites(legs) {
  const marks = [];
  const add = (key, { px, py, level }) => marks.push({ key, x: px - 0.5, y: py - 0.5, level });
  for (const leg of legs) {
    if (!leg.crossing) continue;
    add(`xw-${leg.kind}-${String(leg.dir % 4)}`, leg.crossing);
    add(`sl-${leg.kind}-${String(leg.dir)}`, leg.stopLine);
  }
  return marks;
}
