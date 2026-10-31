import { ROAD_SPEC } from './network.js';
import { TEMPLATES } from './ramptemplates.js';
import { ELEVATED } from './rampline.js';

// 把一个立交切成一块块小精灵，每块都能单独参加遮挡排序。整张画成一张时，车和灯杆没法插到匝道中间去。
// 贴地的路面按格子合成一块，画在路面层，所有物体都在它上面。
// 离地的路面按「一条线在一格里的一段」切，每段是一个物体，有自己的占地和高度。
// 相邻两块在接缝处多画一小段，互相盖住，不留透明的缝。
// 平行车道的路面盖在主线的路肩上，所以同高时匝道排在主线后面画。

const LOW = 0.2;
const RAMP_ABOVE = 0.01;

function mainlinePoints(name) {
  const { mainline } = TEMPLATES[name];
  if (mainline.length === 0) return [];
  const [[ax, az], [bx, bz]] = mainline;
  const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5);
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push([ax + (bx - ax) * t, az + (bz - az) * t, ELEVATED]);
  }
  return points;
}

/** 模板里的全部线：主线、匝道和接地面路的平铺路面。order 是绘制的先后，贴地的匝道抬得最高。 */
export function linesOf(name) {
  const shape = TEMPLATES[name];
  const lines = [];
  const main = mainlinePoints(name);
  const half = ROAD_SPEC.express.deck / 2;
  const shoulder = (ROAD_SPEC.express.walk - ROAD_SPEC.express.deck) / 2;
  if (main.length > 0) {
    const band = main.map(() => ({ l: half, r: half, sl: shoulder, sr: shoulder, tone: 1, dash: false }));
    lines.push({ kind: 'main', center: main, band });
  }
  for (const { points, band } of shape.pads) lines.push({ kind: 'pad', center: points, band });
  const ramps = shape.ramps().map(({ center, band }) => ({ kind: 'ramp', center, band }));
  ramps.sort((a, c) => Math.max(...c.center.map((p) => p[2])) - Math.max(...a.center.map((p) => p[2])));
  lines.push(...ramps);
  return lines;
}

/** 平面上的凸包，单调链法。 */
function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const point of list) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], point) <= 0) out.pop();
      out.push(point);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

function edgePoints(line, i) {
  const { center, band } = line;
  const [x, z] = center[i];
  const before = center[Math.max(0, i - 1)];
  const after = center[Math.min(center.length - 1, i + 1)];
  const length = Math.hypot(after[0] - before[0], after[1] - before[1]) || 1;
  const nx = (after[1] - before[1]) / length;
  const nz = -(after[0] - before[0]) / length;
  const { l, r, sl, sr } = band[i];
  return [
    [x + nx * (l + sl), z + nz * (l + sl)],
    [x - nx * (r + sr), z - nz * (r + sr)],
  ];
}

const cellOfSegment = (a, c) => [
  Math.round((a[0] + c[0]) / 2),
  Math.round((a[1] + c[1]) / 2),
];

/** 切成连续的段：一段在同一格里，高度属于同一层。 */
function runsOf(line, index) {
  const runs = [];
  let run = null;
  for (let i = 0; i < line.center.length - 1; i += 1) {
    const a = line.center[i];
    const c = line.center[i + 1];
    const cell = cellOfSegment(a, c);
    const low = Math.max(a[2], c[2]) < LOW;
    if (!run || run.cell[0] !== cell[0] || run.cell[1] !== cell[1] || run.low !== low) {
      run = { line: index, from: i, to: i, cell, low };
      runs.push(run);
    }
    run.to = i + 1;
  }
  return runs;
}

const pieceCache = new Map();

/** 模板切成的全部小块。low 的块同一格合成一块，spans 是这一块包含的线段。 */
export function piecesOf(name) {
  if (pieceCache.has(name)) return pieceCache.get(name);
  const lines = linesOf(name);
  const runs = lines.flatMap(runsOf);
  const lowCells = new Map();
  const pieces = [];
  for (const run of runs) {
    const id = `${String(run.cell[0])},${String(run.cell[1])}`;
    if (run.low && lowCells.has(id)) {
      lowCells.get(id).spans.push(run);
      continue;
    }
    const piece = { cell: run.cell, low: run.low, spans: [run] };
    if (run.low) lowCells.set(id, piece);
    pieces.push(piece);
  }
  for (const piece of pieces) {
    const outline = [];
    let base = Infinity;
    for (const { line, from, to } of piece.spans) {
      for (let i = from; i <= to; i += 1) {
        outline.push(...edgePoints(lines[line], i));
        base = Math.min(base, lines[line].center[i][2]);
      }
    }
    piece.outline = convexHull(outline);
    const above = lines[piece.spans[0].line].kind === 'ramp' ? RAMP_ABOVE : 0;
    piece.base = base + above;
  }
  pieceCache.set(name, pieces);
  return pieces;
}
