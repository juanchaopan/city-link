import { spokesOf } from './network.js';
import { gradeRuns } from './roadsprites.js';
import { roundToShape, smooth } from './surface.js';

// 地形让路：连续坡段经过的地方，地面顺着路面抬起或压低，路就贴在地上，两侧不需要挡墙和竖面。
// 路面两侧 SHOULDER 格以内的地面和路面同高，再往外是一道土坡，按 BANK_SLOPE 层每格收回原来的地形。
// 土坡最宽 MAX_BANK 格，高差大到放不下时才会留下路基，这时 buildSlopeRoad 才画矮挡墙。
// 土坡算完再抹平两遍，否则相邻角点的土坡宽度不一样，坡面上会有坑洼。
// 水边和坡段以外的路格不动，它们的高度是定好的。

const SHOULDER = 0.8;
const BANK_SLOPE = 0.6;
const MAX_BANK = 3.5;
const REACH = SHOULDER + MAX_BANK;
const STATIONS = 8;
const BLUR_PASSES = 2;
const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function runSamples({ N, roads, grades, levelOf }) {
  const samples = [];
  for (const [id, grade] of grades) {
    const x = id % N;
    const y = Math.floor(id / N);
    const { road, highway } = roads.get(id);
    const [a, c] = spokesOf(road | highway);
    const end = (dir) => {
      const dx = [1, 1, 0, -1, -1, -1, 0, 1][dir];
      const dy = [0, 1, 1, 1, 0, -1, -1, -1][dir];
      return [x + 0.5 + dx * 0.5, y + 0.5 + dy * 0.5];
    };
    const [from, to] = [end(a), end(c)];
    const level = levelOf(x, y);
    for (let i = 0; i <= STATIONS; i += 1) {
      const t = i / STATIONS;
      samples.push({
        x: from[0] + (to[0] - from[0]) * t,
        y: from[1] + (to[1] - from[1]) * t,
        height: level + grade[0] + (grade[1] - grade[0]) * t,
      });
    }
  }
  return samples;
}

/** 这个角点动不得：挨着水，或者挨着坡段以外的路。 */
function fixedCorners({ N, roads, grades, isWater }) {
  const fixed = new Set();
  const mark = (x, y) => {
    for (const [i, j] of [
      [x, y],
      [x + 1, y],
      [x + 1, y + 1],
      [x, y + 1],
    ])
      fixed.add(j * (N + 1) + i);
  };
  for (const id of roads.keys()) if (!grades.has(id)) mark(id % N, Math.floor(id / N));
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) if (isWater(x, y)) mark(x, y);
  }
  return fixed;
}

/** 土坡上的角点和四邻取平均，路肩以内和动不得的角点不动。 */
function blurBanks(heights, banks, N) {
  const width = N + 1;
  for (let pass = 0; pass < BLUR_PASSES; pass += 1) {
    const next = new Map();
    for (const id of banks) {
      const x = id % width;
      const y = Math.floor(id / width);
      let sum = heights[id];
      let count = 1;
      for (const [dx, dy] of STEPS) {
        const i = x + dx;
        const j = y + dy;
        if (i < 0 || j < 0 || i > N || j > N) continue;
        sum += heights[j * width + i];
        count += 1;
      }
      next.set(id, sum / count);
    }
    for (const [id, value] of next) heights[id] = value;
  }
}

/**
 * 输入地形，返回顺着路面改过的角点高度。corner(x, y) 是原来的高度，没有坡路时原样返回。
 * cornersOf、levelOf、isFlat 按原地形，用来算坡段。
 */
export function sculptTerrain({ N, roads, corner, cornersOf, levelOf, isFlat, isWater }) {
  const grades = gradeRuns({ N, cells: roads, cornersOf, isFlat, levelOf });
  const heights = new Float32Array((N + 1) * (N + 1));
  for (let y = 0; y <= N; y += 1) {
    for (let x = 0; x <= N; x += 1) heights[y * (N + 1) + x] = corner(x, y);
  }
  if (grades.size === 0) return heights;
  const samples = runSamples({ N, roads, grades, levelOf });
  const fixed = fixedCorners({ N, roads, grades, isWater });
  const x0 = Math.floor(Math.min(...samples.map((s) => s.x)) - REACH);
  const x1 = Math.ceil(Math.max(...samples.map((s) => s.x)) + REACH);
  const y0 = Math.floor(Math.min(...samples.map((s) => s.y)) - REACH);
  const y1 = Math.ceil(Math.max(...samples.map((s) => s.y)) + REACH);
  const banks = [];
  for (let y = Math.max(0, y0); y <= Math.min(N, y1); y += 1) {
    for (let x = Math.max(0, x0); x <= Math.min(N, x1); x += 1) {
      const id = y * (N + 1) + x;
      if (fixed.has(id)) continue;
      let nearest = Infinity;
      let height = 0;
      for (const sample of samples) {
        const distance = Math.hypot(sample.x - x, sample.y - y);
        if (distance < nearest) {
          nearest = distance;
          height = sample.height;
        }
      }
      if (nearest > REACH) continue;
      const original = heights[id];
      const bank = Math.min(MAX_BANK, Math.max(1, Math.abs(height - original) / BANK_SLOPE));
      heights[id] = height + (original - height) * smooth((nearest - SHOULDER) / bank);
      if (nearest > SHOULDER) banks.push(id);
    }
  }
  blurBanks(heights, banks, N);
  for (let y = Math.max(0, y0); y <= Math.min(N, y1); y += 1) {
    for (let x = Math.max(0, x0); x <= Math.min(N, x1); x += 1) {
      const id = y * (N + 1) + x;
      if (!fixed.has(id)) heights[id] = roundToShape(heights[id]);
    }
  }
  return heights;
}
