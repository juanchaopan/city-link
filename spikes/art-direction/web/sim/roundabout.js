import { DIRECTIONS, ROAD_SPEC, spokesOf } from './network.js';
import { smin } from './roadfield.js';

// 环岛。5 条腿及以上的路口不设信号灯，改成环岛：中央绿岛，车逆时针绕行，进环让行。
//
// 占地：以路口格为中心 5×5 共 25 格。这 25 格不长地块，地块生成器把它当保留地，路面由一张环岛精灵画。
// 环路中线半径 RING 格，车道半宽 0.26，人行道到 1.56 格，每条腿从环路出来直到 5×5 的边，腿上有分隔岛和斑马线。
//
// 放不下时的退让：5×5 里只能有这个路口自己的腿，不能有别的路、水面或坡地。放不下就不改环岛，
// 这个路口退回信号灯，每条腿仍然有斑马线和灯杆，结果记在 blocked 里，由玩家调整路网。
// 示例城市 64×64 和 32×32 的 5 条腿以上路口全部放得下。

export const RING = 1.2;
const RING_DECK = 0.26;
const RING_WALK = 0.36;
const ROUND = 0.3;
const HALF = 2;
const MIN_SPOKES = 5;

function segment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function fits({ N, roads, isFlat, isWater, x, y, spokes }) {
  for (let j = y - HALF; j <= y + HALF; j += 1) {
    for (let i = x - HALF; i <= x + HALF; i += 1) {
      if (i < 0 || j < 0 || i >= N || j >= N || isWater(i, j) || !isFlat(i, j)) return false;
      if (i === x && j === y) continue;
      const entry = roads.get(j * N + i);
      if (!entry) continue;
      const dx = i - x;
      const dy = j - y;
      const onLine = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
      const dir = DIRECTIONS.findIndex(([a, b]) => a === Math.sign(dx) && b === Math.sign(dy));
      if (!onLine || !spokes.includes(dir)) return false;
      const own = spokesOf(entry.road | entry.highway);
      if (own.length !== 2 || !own.includes(dir)) return false;
    }
  }
  return true;
}

function ringOf({ N, roads, x, y, spokes, entry }) {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const cells = new Set();
  for (let j = y - HALF; j <= y + HALF; j += 1) {
    for (let i = x - HALF; i <= x + HALF; i += 1) if (roads.has(j * N + i)) cells.add(j * N + i);
  }
  const arms = spokes.map((dir) => {
    const [dx, dy] = DIRECTIONS[dir];
    const length = Math.hypot(dx, dy);
    const reach = (HALF + 0.5) * length;
    const kind = (entry.arterial ?? 0) & (1 << dir) ? 'arterial' : 'road';
    const ux = dx / length;
    const uy = dy / length;
    return {
      dir,
      kind,
      ux,
      uy,
      reach,
      angle: Math.atan2(uy, ux),
      gate: (y + dy * HALF) * N + x + dx * HALF,
      outside: (y + dy * (HALF + 1)) * N + x + dx * (HALF + 1),
      from: [cx + ux * RING, cy + uy * RING],
      to: [cx + ux * reach, cy + uy * reach],
    };
  });
  const distance = (px, py) => {
    const ring = Math.abs(Math.hypot(px - cx, py - cy) - RING);
    let walk = ring - RING_WALK;
    let deck = ring - RING_DECK;
    for (const { kind, from, to } of arms) {
      const d = segment(px, py, from[0], from[1], to[0], to[1]);
      walk = smin(walk, d - ROAD_SPEC[kind].walk / 2, ROUND);
      deck = smin(deck, d - ROAD_SPEC[kind].deck / 2, ROUND);
    }
    return [walk, deck];
  };
  return { id: y * N + x, x, y, cx, cy, cells, arms, distance };
}

/** 找出要改成环岛的路口，算好占地。blocked 是腿太多却放不下的路口。 */
export function planRoundabouts({ N, roads, isFlat, isWater }) {
  const rings = [];
  const blocked = [];
  for (const id of [...roads.keys()].sort((a, b) => a - b)) {
    const entry = roads.get(id);
    if (entry.highway) continue;
    const spokes = spokesOf(entry.road);
    if (spokes.length < MIN_SPOKES) continue;
    const x = id % N;
    const y = Math.floor(id / N);
    if (fits({ N, roads, isFlat, isWater, x, y, spokes }))
      rings.push(ringOf({ N, roads, x, y, spokes, entry }));
    else blocked.push(id);
  }
  return { rings, blocked };
}

/** 环岛精灵的名字：普通路方向位，有四车道时跟着四车道的方向位。 */
export function ringKey(ring, roads) {
  const entry = roads.get(ring.id);
  return `rb-${entry.road.toString(16)}-${(entry.arterial ?? 0).toString(16)}`;
}

/** 环岛保留的格子：5×5 全部。 */
export function ringFootprint({ x, y }, N) {
  const cells = [];
  for (let j = y - HALF; j <= y + HALF; j += 1) {
    for (let i = x - HALF; i <= x + HALF; i += 1) cells.push(j * N + i);
  }
  return cells;
}
