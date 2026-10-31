// 切坡路基的像素检查，纯 node，不开浏览器：把全图坡路的路基几何按 2:1 等距投影到像素格上，
// 逐列数挡墙和填方有多高。一列和下一列的高度不能突变，路基的两端要收到 0。
// 硬截断时相邻两列能差约 30 像素，这个检查抓的就是这种竖直的断口。
import { mkdirSync, writeFileSync } from 'node:fs';
import { LEVEL } from '../web/kit/bake.js';
import { palettes } from '../web/kit/palettes.js';
import { buildSlopeRoad, LAYER } from '../web/kit/tiles.js';
import { generateCity } from '../web/sim/city.js';
import { roadSprites } from '../web/sim/roadsprites.js';
import { createCanvas } from './raster.js';

const N = 64;
const MAX_JUMP = 3;
const MAX_END_HEIGHT = 2;
const SCALE = 128 / Math.SQRT2;
const ELEVATION = Math.PI / 6;

const city = generateCity(N, 11);
const { roads, cornersOf, isFlat, levelOf, isWater } = city;
const sprites = roadSprites({ N, roads, cornersOf, isFlat, levelOf, isWater, gates: city.plan.gates });

const project = (x, y, z) => [Math.round((x - z) * 64), Math.round((x + z) * 32 - y * SCALE * Math.cos(ELEVATION))];

/** 一条连续坡段上所有路基三角形的投影，按列记录被覆盖的像素。 */
function columnsOf(cells) {
  const columns = new Map();
  for (const id of cells) {
    const x = id % N;
    const y = Math.floor(id / N);
    const level = levelOf(x, y);
    const corners = cornersOf(x, y).map((value) => value - level);
    const b = buildSlopeRoad(roads.get(id), corners, sprites.grades.get(id), palettes.sunny, LAYER.walk).build();
    const { positions } = b;
    for (let i = 0; i < positions.length; i += 9) {
      const points = [0, 3, 6].map((k) => project(positions[i + k] + x, positions[i + k + 1] + level * LEVEL, positions[i + k + 2] + y));
      const minX = Math.min(...points.map((p) => p[0]));
      const maxX = Math.max(...points.map((p) => p[0]));
      const minY = Math.min(...points.map((p) => p[1]));
      const maxY = Math.max(...points.map((p) => p[1]));
      const edge = (a, c, px, py) => (c[0] - a[0]) * (py - a[1]) - (c[1] - a[1]) * (px - a[0]);
      const area = edge(points[0], points[1], points[2][0], points[2][1]);
      if (area === 0) continue;
      const sign = Math.sign(area);
      for (let px = minX; px <= maxX; px += 1) {
        for (let py = minY; py <= maxY; py += 1) {
          const inside = edge(points[0], points[1], px, py) * sign >= 0 && edge(points[1], points[2], px, py) * sign >= 0 && edge(points[2], points[0], px, py) * sign >= 0;
          if (!inside) continue;
          if (!columns.has(px)) columns.set(px, new Set());
          columns.get(px).add(py);
        }
      }
    }
  }
  return columns;
}

/** 把相邻的坡路格连成一段：只有路基的格子才算，平直的纵坡没有挡墙，不用查。 */
function runsOf() {
  const cells = [...sprites.grades.keys()].sort((a, b) => a - b);
  const seen = new Set();
  const runs = [];
  for (const start of cells) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    const run = [];
    while (stack.length > 0) {
      const id = stack.pop();
      run.push(id);
      const x = id % N;
      const y = Math.floor(id / N);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const next = (y + dy) * N + x + dx;
        if (sprites.grades.has(next) && !seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    runs.push(run);
  }
  return runs;
}

const report = [];
let worstJump = 0;
let worstEnd = 0;
const canvasRows = [];
for (const run of runsOf()) {
  const columns = columnsOf(run);
  if (columns.size === 0) continue;
  const keys = [...columns.keys()].sort((a, b) => a - b);
  const heights = keys.map((key) => columns.get(key).size);
  let jump = 0;
  for (let i = 1; i < keys.length; i += 1) {
    const gap = keys[i] - keys[i - 1];
    jump = Math.max(jump, Math.abs(heights[i] - heights[i - 1]) / gap);
  }
  const ends = Math.max(heights[0], heights[heights.length - 1]);
  worstJump = Math.max(worstJump, jump);
  worstEnd = Math.max(worstEnd, ends);
  report.push({ cells: run.length, columns: keys.length, tallest: Math.max(...heights), jump: Math.round(jump * 10) / 10, ends });
  canvasRows.push({ keys, heights });
}

mkdirSync('out', { recursive: true });
const pass = worstJump <= MAX_JUMP && worstEnd <= MAX_END_HEIGHT;
writeFileSync('out/slope-report.json', JSON.stringify({ pass, maxJump: MAX_JUMP, maxEndHeight: MAX_END_HEIGHT, worstJump, worstEnd, runs: report }, null, 2));

const width = 1000;
const rowHeight = 90;
const chart = createCanvas(width, rowHeight * Math.max(1, canvasRows.length), [255, 255, 255]);
canvasRows.forEach(({ keys, heights }, row) => {
  const span = keys[keys.length - 1] - keys[0] || 1;
  keys.forEach((key, i) => {
    const px = ((key - keys[0]) / span) * (width - 20) + 10;
    chart.rect(px, rowHeight * (row + 1) - 6 - heights[i], 2, heights[i], [120, 130, 140]);
  });
});
writeFileSync('out/r7-slope-profile.png', chart.png());

console.log(pass ? '通过' : '不通过', '最大相邻列突变', worstJump.toFixed(1), '像素/列，上限', MAX_JUMP, '；两端高度', worstEnd, '像素，上限', MAX_END_HEIGHT);
for (const row of report) console.log(JSON.stringify(row));
if (!pass) process.exitCode = 1;
