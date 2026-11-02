import { cellLane, hasInnerLane, INNER_OFFSET, laneKind, LANE_OFFSET } from './lanes.js';
import { DIRECTIONS, ROAD_SPEC, spokesOf } from './network.js';
import { roadField } from './roadfield.js';

// 路口规划。纯逻辑，素材、车流和检查都读这一份，所以画出来的斑马线、灯杆和车停的位置永远一致。
//
// 进口的几何：沿每条腿从路口中心往外走，第一处两侧都已经离开别的路面、路缘的转弯也已经结束、又还在自己的人行道上的
// 位置放斑马线，斑马线外面紧贴着停车线，停车线右侧的人行道上立灯杆。45° 夹角的腿退到两条路真正分开的地方，
// 退让距离超过一格时就退到下一格，灯杆这时落在两条路之间的尖角岛上。
//
// 路口合并：相邻或只隔 MERGE_LINKS 格的两个路口算一个大路口，连接段上不画斑马线、不放灯，只在外圈进口放，
// 整组共用一套信号，车过了停车线就一路通过，不会被困在中间。隔得更远的路口各自独立：连接段放得下排队的车，
// 分开放行比合并车速高。
//
// 进出连线表：每条进口到每条别的外圈腿走哪条线，线就是车走的车道中线。靠右行驶，线在相邻格之间切线连续。
//
// 车道：两车道的路一个方向只有一条车道，所有走向排同一条队；四车道的路靠中线的内侧车道是左转专用道，
// 左转的线从内侧车道进路口（lane 为 left），直行和右转走外侧车道（lane 为 through）。
//
// 信号：相对的两条路一组，不成对的路单独一组。每组先有一相放行全部走向，左转在这一相里让行：
// 两车道的路没有左转专用道，也就没有左转专用灯，左转车和直行车一起放行，左转车开到路口里等对向直行的空档。
// 同一相里相交的两条线，直行优先于右转、右转优先于左转，让路的一方记下它要让谁、在线上的哪一点之前让（yields）。
// 四车道的左转有专用道，才另设保护左转相，排在这一组放行相的后面，保护相里的线互不相交。
// 一相是绿灯、黄灯和全红清空。全红时长按这组路口里最长的通过路线算，红灯亮时已经进路口的车来得及开走；
// 在路口里让行的左转车等对向的车过完才走，有让行的路口全红再加上它从让行点通过的那一段。
// 每条腿的灯按车道分：phases 是外侧车道（直行和右转）放行的相，leftPhases 是左转专用道放行的相，
// 灯亮绿就是这条车道的排头能走。
//
// 5 条腿及以上的路口不用信号灯，改成环岛，见 roundabout.js。环岛的每条腿也有斑马线，让行线在斑马线外面，
// 车在斑马线外等，看环上没车才一路开进去，不会停在斑马线上。放不下环岛的路口退回信号灯。

const MIN_STATION = 0.3;
const RING_STATION = 1.62;
const STATION_STEP = 0.02;
const MAX_STATION = 2.6;
export const CROSSING = 0.09;
export const STOP_GAP = 0.05;
const POLE_GAP = 0.03;
const DECK_MARGIN = 0.012;
const END_OUTSIDE = 0.05;
const CURB_STRAIGHT = 0.008;
const MERGE_LINKS = 1;
const LANE_GAP = 0.1;
const TURN_ORDER = { straight: 0, right: 1, left: 2 };

export const GREEN = 4;
export const YELLOW = 1;
const CLEAR_SPEED = 1.1;
const CLEAR_MARGIN = 0.4;
const YIELD_CLEAR = 0.8;

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

/** 相邻或只隔 MERGE_LINKS 格的路口并成一组。 */
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

/** 这条路线从进口的哪条车道进路口：有左转专用道的路上左转走内侧车道。 */
function laneOf(leg, turn) {
  return turn === 'left' && hasInnerLane(leg.kind) ? 'left' : 'through';
}

/** 进路口第一格的进口偏移：左转专用道在内侧。 */
export function entryOffset(kind, lane) {
  return lane === 'left' ? INNER_OFFSET[kind] : LANE_OFFSET[kind];
}

/** 路线的车道中线，从进路口的第一格走到出路口的最后一格。 */
function routeLine(leg, { dirs }, lane, roads, N) {
  const points = [];
  let cell = leg.node;
  let from = leg.dir;
  dirs.forEach((dir, index) => {
    const entry = roads.get(cell);
    const x = cell % N;
    const y = Math.floor(cell / N);
    const fromKind = laneKind(entry, from);
    const offsetFrom = index === 0 ? entryOffset(fromKind, lane) : LANE_OFFSET[fromKind];
    points.push(...cellLane(x, y, from, dir, offsetFrom, LANE_OFFSET[laneKind(entry, dir)]));
    from = (dir + 4) % 8;
    cell = cellStep(cell, dir, N);
  });
  return points;
}

function stationsOf(points) {
  const along = [0];
  for (let i = 1; i < points.length; i += 1) {
    along.push(
      along[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]),
    );
  }
  return along;
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

/** 线 a 上第一个贴近线 b 的节点的里程。 */
function firstTouch(a, b) {
  const along = stationsOf(a.points);
  const index = a.points.findIndex(([ax, ay]) =>
    b.points.some(([bx, by]) => Math.hypot(ax - bx, ay - by) < LANE_GAP),
  );
  return along[Math.max(0, index)];
}

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

/** 同一相里相交的两条线谁优先：直行、右转、左转依次让，同类按连线表的先后。 */
function priorityOver(a, b, movements) {
  const order = TURN_ORDER[a.turn] - TURN_ORDER[b.turn];
  if (order !== 0) return order < 0;
  return movements.indexOf(a) < movements.indexOf(b);
}

/** 放行相里相交的线：让路的一方记下要让谁，以及自己线上的让行点和对方线上的冲突点。 */
function assignYields(stage, movements) {
  for (const movement of stage) movement.yields = [];
  for (let i = 0; i < stage.length; i += 1) {
    for (let j = i + 1; j < stage.length; j += 1) {
      const [a, b] = [stage[i], stage[j]];
      if (!movementsConflict(a, b)) continue;
      const [first, second] = priorityOver(a, b, movements) ? [a, b] : [b, a];
      second.yields.push({
        movement: first,
        at: firstTouch(second, first),
        otherAt: firstTouch(first, second),
      });
    }
  }
}

/**
 * 把一组进路的线分进若干相：第一相放行全部没有专用道的走向，相交的线靠让行解决；
 * 有专用道的左转排在后面的相里，同一相里的线互不相交。
 */
function stagesOfGroup(movements, all) {
  const permissive = [];
  const stages = [];
  const ordered = [...movements].sort(
    (a, b) => a.dirs.length - b.dirs.length || TURN_ORDER[a.turn] - TURN_ORDER[b.turn],
  );
  for (const movement of ordered) {
    if (movement.lane !== 'left') {
      permissive.push(movement);
      continue;
    }
    const stage = stages.find((list) => !list.some((m) => movementsConflict(m, movement)));
    if (stage) stage.push(movement);
    else stages.push([movement]);
  }
  assignYields(permissive, all);
  for (const stage of stages) for (const movement of stage) movement.yields = [];
  return permissive.length > 0 ? [permissive, ...stages] : stages;
}

/** 全组路口的相位。给每条线写上相位号，给每条腿写上两条车道各自放行的相位。 */
function assignPhases(legs, movements, N) {
  const stages = legGroups(legs, N).flatMap((group) =>
    stagesOfGroup(
      movements.filter((movement) => group.includes(movement.leg)),
      movements,
    ),
  );
  stages.forEach((stage, phase) => {
    for (const movement of stage) movement.phase = phase;
  });
  const phasesOf = (leg, lane) =>
    [
      ...new Set(
        movements.filter((m) => m.leg === leg && m.lane === lane).map(({ phase }) => phase),
      ),
    ].sort((a, b) => a - b);
  for (const leg of legs) {
    leg.phases = phasesOf(leg, 'through');
    leg.leftPhases = phasesOf(leg, 'left');
  }
  return stages.length;
}

/** 一组路口的信号：全红时长按最长的通过路线算；有让行的路口再加上让行车从让行点通过的那一段。 */
function signalOf(id, count, movements) {
  const longest = Math.max(
    1,
    ...movements.map(({ dirs }) => dirs.reduce((sum, dir) => sum + unitOf(dir)[2], 0)),
  );
  const yielding = movements.some(({ yields }) => yields.length > 0);
  const clear = (longest + (yielding ? YIELD_CLEAR : 0)) / CLEAR_SPEED + CLEAR_MARGIN;
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
    routesFrom(leg, cells, legsByNode, roads, N).map((route) => {
      const turn = turnOf(leg, route);
      const lane = laneOf(leg, turn);
      return { ...route, leg, turn, lane, points: routeLine(leg, route, lane, roads, N) };
    }),
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
