import { piecesOf } from './ixpieces.js';
import { DIRECTIONS, ROAD_SPEC } from './network.js';
import { pierSpots } from './piers.js';
import { ELEVATED, MAIN_LANE, stationsOf } from './rampline.js';
import { TEMPLATES } from './ramptemplates.js';

// 立交的规则和接线。玩家只画线，路线相交时系统按相交道路的等级自动选一个模板：
//   同级普通路 → 平交路口（信号灯）
//   快速路 × 双向四车道 → 菱形（diamond）
//   高速 × 快速路（穿过）→ 苜蓿叶（cloverleaf）
//   高速 × 快速路（到头）→ 喇叭形（trumpet）
//   高速 × 双向四车道（到头）→ 丁字形（tee），普通城市的四车道主干就从这里上高速
// 匝道只接高速、快速路和双向四车道，双向两车道不能直接上匝道。模板的线形在 ramptemplates.js。
// 占地里路面没有压到的格子分两种：连得到普通路的是可以建设的用地，见 innerland.js；连不到的放绿地。

export { ELEVATED };
export const LANE = MAIN_LANE;

const PIER_HALF = 0.07;
const PIER_ANGLES = 12;
const FREE_CLEARANCE = 0.75;
const GREEN_VARIANTS = 2;
const LOT_MARGIN = 0.02;
const SAMPLE_STEP = 0.25;

const INTERSECTION_RULES = {
  'road|road': 'signal',
  'arterial|road': 'signal',
  'arterial|arterial': 'signal',
  'arterial|express': 'diamond',
  'express|road': 'forbidden',
  'express|highway': 'cloverleaf',
  'highway|road': 'forbidden',
  'arterial|highway': 'tee',
};

/** 两种路相交时用哪种做法。forbidden 表示这两级路不能直接相接。 */
export function intersectionRule(a, b, endsHere = false) {
  const key = [a, b].sort().join('|');
  const rule = INTERSECTION_RULES[key] ?? 'forbidden';
  return rule === 'cloverleaf' && endsHere ? 'trumpet' : rule;
}

export function template(name) {
  return TEMPLATES[name];
}

export function templateNames() {
  return Object.keys(TEMPLATES);
}

/** 一格高架精灵的名字。高度是层，名字里写百分之一层。 */
export function viaductKey(h0, h1) {
  return `ev-z-${String(Math.round(h0 * 100))}-${String(Math.round(h1 * 100))}`;
}

/** 主线的中心线，带高度。丁字形没有主线。 */
export function mainlineOf(name) {
  const { mainline } = TEMPLATES[name];
  if (mainline.length === 0) return [];
  const [[ax, az], [bx, bz]] = mainline;
  const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5);
  const out = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    out.push([ax + (bx - ax) * t, az + (bz - az) * t, ELEVATED]);
  }
  return out;
}

const pierCache = new Map();

/** 模板的全部桥墩。主线和匝道一起选位，这样桥墩不会落在任何一条更低的路面上。 */
export function piersOf(name) {
  if (pierCache.has(name)) return pierCache.get(name);
  const main = mainlineOf(name);
  const lines = TEMPLATES[name].ramps().map(({ name: id, center }) => ({
    id,
    points: center,
    wide: 0.34,
    spacing: 1.5,
    half: ROAD_SPEC.ramp.walk / 2,
  }));
  if (main.length > 0)
    lines.unshift({
      id: 'main',
      points: main,
      wide: 0.8,
      spacing: 1.3,
      half: ROAD_SPEC.express.walk / 2,
    });
  const surfaces = [
    ...lines,
    ...TEMPLATES[name].ground.map((ground, index) => ({ id: `ground${String(index)}`, ...ground })),
  ];
  const piers = lines.flatMap((line) => pierSpots(line, surfaces));
  pierCache.set(name, piers);
  return piers;
}

/** 一条直线上按固定步长取的点，half 是这条路面的半宽。 */
function sampled([ax, az], [bx, bz], half) {
  const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / SAMPLE_STEP);
  return Array.from({ length: steps + 1 }, (_, i) => ({
    x: ax + ((bx - ax) * i) / steps,
    z: az + ((bz - az) * i) / steps,
    half,
  }));
}

/** 模板全部路面的采样点。主线的路肩悬在半空，地块可以挨到它下面，所以按车行道算。 */
function surfaceSamples(name) {
  const { ramps, ground } = TEMPLATES[name];
  const samples = ramps().flatMap(({ center, band }) =>
    center.map(([x, z], i) => ({
      x,
      z,
      half: Math.max(band[i].l + band[i].sl, band[i].r + band[i].sr),
    })),
  );
  const main = mainlineOf(name);
  if (main.length > 0)
    samples.push(...sampled(main[0], main[main.length - 1], ROAD_SPEC.express.deck / 2));
  for (const { points, half } of ground)
    samples.push(...sampled(points[0], points[points.length - 1], half));
  return samples;
}

/** 占地里和所有路面采样点都满足 isClear 的格子。 */
function cellsWhere(name, isClear) {
  const samples = surfaceSamples(name);
  const [x0, z0, x1, z1] = TEMPLATES[name].footprint;
  const cells = [];
  for (let z = z0; z <= z1; z += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (samples.every((sample) => isClear(sample, x, z))) cells.push([x, z]);
    }
  }
  return cells;
}

/** 中心离路面足够远的格子，放绿地，边角可以被匝道的路肩擦到。 */
export function freeCells(name) {
  return cellsWhere(name, (p, x, z) => Math.hypot(p.x - x, p.z - z) > FREE_CLEARANCE);
}

/** 整格都不碰路面的格子，放得下有地台的物业。 */
export function clearCells(name) {
  return cellsWhere(name, (p, x, z) => {
    const dx = Math.max(0, Math.abs(p.x - x) - 0.5);
    const dz = Math.max(0, Math.abs(p.z - z) - 0.5);
    return Math.hypot(dx, dz) >= p.half + LOT_MARGIN;
  });
}

/** 模板的占地，格数和面积。usable 是圈内空地的格数。 */
export function templateFootprint(name) {
  const [x0, z0, x1, z1] = TEMPLATES[name].footprint;
  const w = x1 - x0 + 1;
  const h = z1 - z0 + 1;
  return {
    w,
    h,
    cells: w * h,
    usable: freeCells(name).length,
    ramps: TEMPLATES[name].ramps().length,
  };
}

/** 模板占地的格子，超出地图的部分不算。 */
export function footprintCells(name, cx, cy, N) {
  const [x0, z0, x1, z1] = TEMPLATES[name].footprint;
  const cells = [];
  for (let y = cy + z0; y <= cy + z1; y += 1) {
    for (let x = cx + x0; x <= cx + x1; x += 1) {
      if (x >= 0 && y >= 0 && x < N && y < N) cells.push([x, y]);
    }
  }
  return cells;
}

/** 桥墩精灵的名字：高度到十分之一层，横梁方向到 15°。 */
function pierKey(h, nx, nz) {
  const angle = ((Math.atan2(nz, nx) % Math.PI) + Math.PI) % Math.PI;
  const index = Math.round((angle / Math.PI) * PIER_ANGLES) % PIER_ANGLES;
  return `pr-${String(Math.round(h * 10))}-${String(index)}`;
}

/** 一根桥墩是一个单独的物体，x、z 相对格子中心 (cx, cy)。 */
export function pierObject({ x, z, h, nx, nz }, cx, cy, wide = 0.8) {
  const px = x + cx + 0.5;
  const py = z + cy + 0.5;
  return {
    key: pierKey(h, nx, nz),
    wide,
    px,
    py,
    level: 0,
    base: 0,
    footprint: [
      [px - PIER_HALF, py - PIER_HALF],
      [px + PIER_HALF, py - PIER_HALF],
      [px + PIER_HALF, py + PIER_HALF],
      [px - PIER_HALF, py + PIER_HALF],
    ],
  };
}

function greenObject(x, y, variant) {
  return {
    key: `P-park-1x1-${String(variant % GREEN_VARIANTS)}`,
    px: x + 0.5,
    py: y + 0.5,
    level: 0,
    footprint: [
      [x, y],
      [x + 1, y],
      [x + 1, y + 1],
      [x, y + 1],
    ],
  };
}

/** 圈内的绿地。模板只知道自己的路，城市里还有别的路从占地里穿过，压着路和挨着路的格子不放；taken 是已经有用途的格子。 */
export function templateGreens(name, cx, cy, { roads, N, taken }) {
  const open = (x, y) => {
    const id = y * N + x;
    return (
      !taken.has(id) &&
      !roads.has(id) &&
      DIRECTIONS.every(([dx, dy]) => !roads.has((y + dy) * N + x + dx))
    );
  };
  return freeCells(name)
    .map(([x, z], index) => ({ x: cx + x, y: cy + z, index }))
    .filter(({ x, y }) => x >= 0 && y >= 0 && x < N && y < N && open(x, y))
    .map(({ x, y, index }) => greenObject(x, y, index));
}

/** 立交落到地图上：low 是路面层的精灵，high 是参加遮挡排序的路面块和桥墩。 */
export function templateParts(name, cx, cy) {
  const low = [];
  const high = [];
  piecesOf(name).forEach((piece, index) => {
    const key = `ixp-${name}-${String(index)}`;
    const x = cx + piece.cell[0];
    const y = cy + piece.cell[1];
    if (piece.low) low.push({ key, x, y, level: 0 });
    else
      high.push({
        key,
        px: x + 0.5,
        py: y + 0.5,
        level: 0,
        base: piece.base,
        footprint: piece.outline.map(([a, b]) => [a + cx + 0.5, b + cy + 0.5]),
      });
  });
  for (const pier of piersOf(name)) high.push(pierObject(pier, cx, cy));
  return { low, high };
}

function station(lane, x, y) {
  let best = 0;
  let bestDistance = Infinity;
  lane.points.forEach(([px, py], i) => {
    const d = Math.hypot(px - x, py - y);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}

/**
 * 把模板的匝道接到主线和地面路网上：端点高度为 0 的一头接地面，在高架上的一头接主线。
 * main 是快速路主线的两条 lane；模板没有主线时不传，它的匝道两头都在地面。
 * spine 逐条匝道写明它是主线的延续：from 是流进这条匝道的主线，to 是这条匝道流进的主线。
 */
export function connectRamps({ name, cx, cy, N, main, lanes, spine = [] }) {
  const cellOf = ([x, y]) => Math.floor(y) * N + Math.floor(x);
  template(name)
    .ramps()
    .forEach((ramp, index) => {
      const points = ramp.points.map(([x, z, h]) => [x + cx + 0.5, z + cy + 0.5, h]);
      const first = points[0];
      const last = points[points.length - 1];
      const mainOf = ([x]) => (x < cx + 0.5 ? main.south : main.north);
      const lane = {
        id: `${name}${String(cx)}-${String(index)}`,
        kind: 'ramp',
        points,
        exits: [],
        speeds: ramp.speeds,
        free: ramp.free,
      };
      const flow = spine[index];
      if (flow?.from) flow.from.merge = { lane: lane.id, at: 0 };
      else if (first[2] < 0.5) lane.fromCell = cellOf(first);
      else {
        const line = mainOf(first);
        line.exits.push({ at: station(line, first[0], first[1]), lane: lane.id });
      }
      if (flow?.to) lane.merge = { lane: flow.to.id, at: 0 };
      else if (last[2] < 0.5) lane.toCell = cellOf(last);
      else {
        const line = mainOf(last);
        lane.merge = { lane: line.id, at: station(line, last[0], last[1]) };
      }
      lanes.push(lane);
    });
}

/** 两头都在地面路网上的匝道，在路网图里是一条边，路网就靠它连起来。 */
export function rampLinks(lanes) {
  return lanes
    .filter(({ fromCell, toCell }) => fromCell !== undefined && toCell !== undefined)
    .map(({ id, fromCell, toCell, points }) => ({
      from: fromCell,
      to: toCell,
      length: stationsOf(points).pop(),
      lanes: [id],
    }));
}
