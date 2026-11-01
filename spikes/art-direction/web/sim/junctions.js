import { cellLane, laneKind } from './lanes.js';
import { DIRECTIONS, ROAD_SPEC, spokesOf } from './network.js';
import { roadField } from './roadfield.js';

// 路口规划。纯逻辑，素材、车流和检查都读这一份，所以画出来的斑马线、灯杆和车停的位置永远一致。
//
// 进口的几何：沿每条腿从路口中心往外走，第一处两侧都已经离开别的路面、路缘的转弯也已经结束、又还在自己的人行道上的
// 位置放斑马线，斑马线外面紧贴着停车线，停车线右侧的人行道上立灯杆。45° 夹角的腿退到两条路真正分开的地方，
// 退让距离超过一格时就退到下一格，灯杆这时落在两条路之间的尖角岛上。
//
// 路口合并：两个路口之间的直路段不超过 MERGE_LINKS 格时算一个大路口，连接段上不画斑马线、不放灯，只在外圈进口放，
// 整组共用一套信号，车过了停车线就一路通过，不会被困在中间。
//
// 进出连线表：每条进口到每条别的外圈腿走哪条线，线就是车走的车道中线。靠右行驶，线在相邻格之间切线连续。
//
// 信号：相对的两条路一组，不成对的路单独一组。一组里两条路对向放行，对向的左转会穿过对面的直行，
// 同一相位内车线不能相交，所以线相交的走向排到紧接着的下一相。一相是绿灯、黄灯和全红清空。
// 全红时长按这组路口里最长的通过路线算，红灯亮时已经进路口的车来得及开走。
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
const CURB_STRAIGHT = 0.008;
const MERGE_LINKS = 2;
const LANE_GAP = 0.1;
const TURN_ORDER = { straight: 0, right: 1, left: 2 };

export const GREEN = 4;
export const YELLOW = 1;
const CLEAR_SPEED = 1.1;
const CLEAR_MARGIN = 0.4;

export function unitOf(dir) {
  const [dx, dy] = DIRECTIONS[dir];
  const length = Math.hypot(dx, dy);
  return [dx / length, dy / length, length];
}

function isNode(entry) {
  return !entry.highway && spokesOf(entry.road).length >= 3;
}

const cellStep = (id, dir, N) => {
  const [dx, dy] = DIRECTIONS[dir];
  return (Math.floor(id / N) + dy) * N + (id % N) + dx;
};

/** 两个路口之间的直路段不超过 MERGE_LINKS 格的，并成一组。 */
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
  const follow = (id, dir) => {
    const passed = [];
    let next = cellStep(id, dir, N);
    for (let step = 0; step <= MERGE_LINKS; step += 1) {
      const entry = roads.get(next);
      if (!entry) return;
      if (parent.has(next)) {
        join(id, next);
        for (const cell of passed) links.add(cell);
        return;
      }
      if (skip.has(next)) return;
      const spokes = spokesOf(entry.road);
      if (spokes.length !== 2 || !spokes.includes(dir)) return;
      passed.push(next);
      next = cellStep(next, dir, N);
    }
  };
  for (const id of nodes) for (const dir of spokesOf(roads.get(id).road)) follow(id, dir);
  const groups = new Map();
  for (const id of nodes) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  }
  return { groups: [...groups.values()], links };
}

/**
 * 沿腿往外走，找第一处放得下斑马线的位置：两端都在人行道上，整条斑马线宽度内都离开了别的路面。
 * 直路段上斑马线的端点到路面边正好是 END_OUTSIDE，圆角和别的路面都会让这个距离变小，所以这一条同时管住了
 * 「路缘转弯结束之后」和「45° 夹角退到两路真正分开处」。
 */
function crossingStation(field, x, y, dir, kind, from) {
  const [ux, uy] = unitOf(dir);
  const half = ROAD_SPEC[kind].deck / 2 + END_OUTSIDE;
  const clear = (s) =>
    [-1, 1].every((side) => {
      const px = x + ux * s - uy * side * half;
      const py = y + uy * s + ux * side * half;
      const edge = field.deck(px, py);
      return edge > DECK_MARGIN && edge > END_OUTSIDE - CURB_STRAIGHT && field.walk(px, py) < 0;
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

/** 从一个进口出发的全部通过路线：每条路线是一串方向，终点是另一条外圈的腿。到同一条腿只留最短的一条。 */
function routesFrom(start, cells, legsByNode, roads, N) {
  const shortest = new Map();
  const walk = (cell, from, dirs, seen) => {
    const entry = roads.get(cell);
    for (const dir of spokesOf(entry.road)) {
      if (dir === from) continue;
      const leg = legsByNode.get(`${String(cell)}:${String(dir)}`);
      if (leg) {
        const known = shortest.get(leg);
        if (leg !== start && (!known || known.dirs.length > dirs.length + 1))
          shortest.set(leg, { dirs: [...dirs, dir], exit: leg });
        continue;
      }
      const next = cellStep(cell, dir, N);
      if (!cells.has(next) || seen.has(next)) continue;
      walk(next, (dir + 4) % 8, [...dirs, dir], new Set([...seen, next]));
    }
  };
  walk(start.node, start.dir, [], new Set([start.node]));
  return [...shortest.values()];
}

/** 这条路线相对进口是直行、右转还是左转，地图 y 朝南，靠右行驶时右转的叉积是正的。 */
function turnOf(leg, { dirs }) {
  const [hx, hy] = unitOf((leg.dir + 4) % 8);
  const [ex, ey] = unitOf(dirs[dirs.length - 1]);
  const side = hx * ey - hy * ex;
  if (Math.abs(side) < 1e-6 && hx * ex + hy * ey > 0) return 'straight';
  return side > 0 ? 'right' : 'left';
}

/** 路线的车道中线，从进路口的第一格走到出路口的最后一格。 */
function routeLine(leg, { dirs }, roads, N) {
  const points = [];
  let cell = leg.node;
  let from = leg.dir;
  for (const dir of dirs) {
    const entry = roads.get(cell);
    const x = cell % N;
    const y = Math.floor(cell / N);
    points.push(...cellLane(x, y, from, dir, laneKind(entry, from), laneKind(entry, dir)));
    from = (dir + 4) % 8;
    cell = cellStep(cell, dir, N);
  }
  return points;
}

/** 两段折线的最短距离，只比折线的节点，节点足够密。 */
function lineGap(a, b) {
  let best = Infinity;
  for (const [ax, ay] of a) {
    for (const [bx, by] of b) best = Math.min(best, Math.hypot(ax - bx, ay - by));
  }
  return best;
}

/** 从不同进口来的两条线靠得比一辆车还近就算相交，并进同一条出口也算。 */
export const movementsConflict = (a, b) =>
  a.leg !== b.leg && lineGap(a.points, b.points) < LANE_GAP;

/** 进路分组：相对的两条路一组，优先同一个路口，大路口里同一条直线上的也算；不成对的路单独一组。 */
function legGroups(legs, N) {
  const used = new Set();
  const onLine = (a, b) => {
    const dx = (a.node % N) - (b.node % N);
    const dy = Math.floor(a.node / N) - Math.floor(b.node / N);
    const [ux, uy] = unitOf(a.dir);
    return Math.abs(dx * uy - dy * ux) < 1e-6;
  };
  const groups = [];
  for (const leg of legs) {
    if (used.has(leg)) continue;
    used.add(leg);
    const others = legs.filter((other) => !used.has(other) && other.dir === (leg.dir + 4) % 8);
    const partner =
      others.find((other) => other.node === leg.node) ?? others.find((other) => onLine(leg, other));
    if (partner) used.add(partner);
    groups.push(partner ? [leg, partner] : [leg]);
  }
  return groups;
}

/** 把一组进路的线分进若干相：只过一个路口的线在前，其中直行和右转在前，同一相里的线互不相交。 */
function stagesOfGroup(movements) {
  const stages = [];
  const ordered = [...movements].sort(
    (a, b) => a.dirs.length - b.dirs.length || TURN_ORDER[a.turn] - TURN_ORDER[b.turn],
  );
  for (const movement of ordered) {
    const stage = stages.find((list) => !list.some((m) => movementsConflict(m, movement)));
    if (stage) stage.push(movement);
    else stages.push([movement]);
  }
  return stages;
}

/** 全组路口的相位。给每条线写上相位号，给每条腿写上它放行的相位。 */
function assignPhases(legs, movements, N) {
  const stages = legGroups(legs, N).flatMap((group) =>
    stagesOfGroup(movements.filter((movement) => group.includes(movement.leg))),
  );
  stages.forEach((stage, phase) => {
    for (const movement of stage) movement.phase = phase;
  });
  for (const leg of legs) {
    leg.phases = [
      ...new Set(movements.filter((m) => m.leg === leg).map(({ phase }) => phase)),
    ].sort((a, b) => a - b);
  }
  return stages.length;
}

/** 一组路口的信号：全红时长按最长的通过路线算。 */
function signalOf(id, count, movements) {
  const longest = Math.max(
    1,
    ...movements.map(({ dirs }) => dirs.reduce((sum, dir) => sum + unitOf(dir)[2], 0)),
  );
  const clear = longest / CLEAR_SPEED + CLEAR_MARGIN;
  const stage = GREEN + YELLOW + clear;
  return { id, stage, clear, cycle: stage * Math.max(1, count), offset: (id * 37) % 11 };
}

/** 这一组路口此刻给这些相位的灯色。 */
export function lightAt(signal, phases, time) {
  const position = (time + signal.offset) % signal.cycle;
  const index = Math.floor(position / signal.stage);
  if (!phases.includes(index)) return 'red';
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

/** 一组路口：外圈的腿、进出连线表、相位和停车表。 */
function clusterOf({ nodes, links, roads, N, field, surface, stops }) {
  const cells = new Set(nodes);
  for (const id of nodes) {
    for (const dir of spokesOf(roads.get(id).road)) {
      let next = cellStep(id, dir, N);
      while (links.has(next)) {
        cells.add(next);
        next = cellStep(next, dir, N);
      }
    }
  }
  const legs = [];
  for (const node of nodes) {
    for (const dir of spokesOf(roads.get(node).road)) {
      if (cells.has(cellStep(node, dir, N))) continue;
      const kind = laneKind(roads.get(node), dir);
      legs.push(legOf({ field, node, dir, kind, N, levelAt: surface }));
    }
  }
  const legsByNode = new Map(legs.map((leg) => [`${String(leg.node)}:${String(leg.dir)}`, leg]));
  const movements = legs.flatMap((leg) =>
    routesFrom(leg, cells, legsByNode, roads, N).map((route) => ({
      ...route,
      leg,
      turn: turnOf(leg, route),
      points: routeLine(leg, route, roads, N),
    })),
  );
  const count = assignPhases(legs, movements, N);
  const signal = signalOf(nodes[0], count, movements);
  for (const leg of legs) {
    if (!leg.crossing) continue;
    const { key, cell, distance } = stopEntry(leg, N);
    const routes = movements.filter((movement) => movement.leg === leg);
    stops.set(key, { leg, phases: leg.phases, signal, cell, distance, routes });
  }
  return { id: nodes[0], nodes, cells, legs, signal, movements, phaseCount: count };
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
  const stops = new Map();
  const clusters = groups.map((nodes) =>
    clusterOf({ nodes, links, roads, N, field, surface, stops }),
  );
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
