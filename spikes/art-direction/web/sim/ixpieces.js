import { convexHull } from './geometry.js';
import { ROAD_SPEC } from './network.js';
import { TEMPLATES } from './ramptemplates.js';
import { ELEVATED } from './rampline.js';

// 把一个立交切成一块块小精灵，每块都能单独参加遮挡排序。整张画成一张时，车和灯杆没法插到匝道中间去。
// 贴地的路面按格子合成一块，画在路面层，所有物体都在它上面。
// 离地的路面按「一条线在一格里的一段」切，每段是一个物体，有自己的占地和高度。
// 相邻两块在接缝处多画两个节点，互相盖住，不留透明的缝。多画的部分不算占地 outline：桥面之间的先后按格子分，
// 算上它们，相邻的几块主线和匝道就排成了环。但车和桥面比较时要看画出来的范围 painted：
// 车开到接缝附近时脚下已经是隔壁那块画出来的路面，只看占地，车会排在那一块前面，被多画的部分切掉半个车身。
// 主线的节点要密：节点稀了多画的部分太长，主线的路肩会盖到隔壁格的匝道上。
// 平行车道的路面盖在主线的路肩上，所以同高时匝道排在主线后面画，main 标出主线的块。

const LOW = 0.2;
const RAMP_ABOVE = 0.01;
const MAIN_STEP = 0.1;
const SEAM_OVERLAP = 2;

function mainlinePoints(name) {
  const { mainline } = TEMPLATES[name];
  if (mainline.length === 0) return [];
  const [[ax, az], [bx, bz]] = mainline;
  const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / MAIN_STEP);
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
    const band = main.map(() => ({
      l: half,
      r: half,
      sl: shoulder,
      sr: shoulder,
      tone: 1,
      dash: false,
    }));
    lines.push({ kind: 'main', center: main, band });
  }
  for (const { points, band } of shape.pads) lines.push({ kind: 'pad', center: points, band });
  const ramps = shape.ramps().map(({ center, band }) => ({ kind: 'ramp', center, band }));
  ramps.sort(
    (a, c) => Math.max(...c.center.map((p) => p[2])) - Math.max(...a.center.map((p) => p[2])),
  );
  lines.push(...ramps);
  return lines;
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

const cellOfSegment = (a, c) => [Math.round((a[0] + c[0]) / 2), Math.round((a[1] + c[1]) / 2)];

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

/** 一段线实际画出来的节点范围，两头各多 SEAM_OVERLAP 个节点。 */
function paintedRange(line, { from, to }) {
  return [Math.max(0, from - SEAM_OVERLAP), Math.min(line.center.length - 1, to + SEAM_OVERLAP)];
}

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
    const painted = [];
    let base = Infinity;
    for (const span of piece.spans) {
      const line = lines[span.line];
      const [first, last] = paintedRange(line, span);
      for (let i = first; i <= last; i += 1) painted.push(...edgePoints(line, i));
      for (let i = span.from; i <= span.to; i += 1) {
        outline.push(...edgePoints(line, i));
        base = Math.min(base, line.center[i][2]);
      }
    }
    piece.outline = convexHull(outline);
    piece.painted = convexHull(painted);
    const { kind } = lines[piece.spans[0].line];
    piece.main = kind === 'main';
    piece.base = base + (kind === 'ramp' ? RAMP_ABOVE : 0);
  }
  pieceCache.set(name, pieces);
  return pieces;
}

/** 一段线要画的帧：framesOf 算好的帧里取实际画出来的范围。 */
export const paintedFrames = (frames, line, span) => {
  const [first, last] = paintedRange(line, span);
  return frames.slice(first, last + 1);
};
