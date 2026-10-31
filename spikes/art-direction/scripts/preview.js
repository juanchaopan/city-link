// 不开浏览器的几何预览：用软件光栅把程序建模的三角形按 2:1 等距画出来，内存紧张、开不了烘焙时看形体用。
// 没有投影、抗锯齿和路面着色器，颜色也不等于成品，只用来判断楼的形状和占地。真实效果以 shots.js 的截图为准。
// node scripts/preview.js lots          out/r7-lots-preview.png：大三角物业的各种规格
// node scripts/preview.js modules       out/r7-modules-preview.png：Q3 的模块拼装
import { writeFileSync } from 'node:fs';
import { buildModule } from '../web/kit/modules.js';
import { buildObject } from '../web/kit/objects.js';
import { palettes } from '../web/kit/palettes.js';
import { COMBOS, modulesOf } from '../web/sim/combos.js';
import { createCanvas } from './raster.js';

const P = palettes.sunny;
const SCALE = 128 / Math.SQRT2;
const ELEVATION = Math.PI / 6;
const LIFT = 16;
const SKY = [143, 192, 112];
const SUN = [0.5, 0.75, 0.42];

const gamma = (value) => Math.round(255 * Math.min(1, Math.max(0, value)) ** (1 / 2.2));

function surface(width, height) {
  const canvas = createCanvas(width, height, SKY);
  const depth = new Float64Array(width * height).fill(-Infinity);
  const draw = (triangle, color) => {
    const [a, b, c] = triangle;
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (area === 0) return;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const w0 = ((b[0] - x) * (c[1] - y) - (b[1] - y) * (c[0] - x)) / area;
        const w1 = ((c[0] - x) * (a[1] - y) - (c[1] - y) * (a[0] - x)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.001 || w1 < -0.001 || w2 < -0.001) continue;
        const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
        if (z > depth[y * width + x]) {
          depth[y * width + x] = z;
          canvas.put(x, y, color);
        }
      }
    }
  };
  return { canvas, draw };
}

function stamp({ draw }, builder, ox, oy) {
  const { positions, colors } = builder;
  const view = (i) => {
    const [x, y, z] = [positions[i], positions[i + 1], positions[i + 2]];
    return [ox + (x - z) * 64, oy + (x + z) * 32 - y * SCALE * Math.cos(ELEVATION), (x + z) * 0.61 + y * 0.5];
  };
  for (let i = 0; i < positions.length; i += 9) {
    const ux = positions[i + 3] - positions[i];
    const uy = positions[i + 4] - positions[i + 1];
    const uz = positions[i + 5] - positions[i + 2];
    const vx = positions[i + 6] - positions[i];
    const vy = positions[i + 7] - positions[i + 1];
    const vz = positions[i + 8] - positions[i + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    const light = 0.62 + 0.5 * Math.max(0, (nx * SUN[0] + ny * SUN[1] + nz * SUN[2]) / length);
    draw([view(i), view(i + 3), view(i + 6)], [gamma(colors[i] * light), gamma(colors[i + 1] * light), gamma(colors[i + 2] * light)]);
  }
}

function lots() {
  const rows = [
    ['r1-5', 'r1-4', 'r1-3', 'r2-4', 'r2-3', 'r2-2'],
    ['r3-4', 'r3-3', 'c1-4', 'c1-3', 'c2-4', 'c2-3'],
    ['c3-4', 'c3-3', 'i2-4', 'i2-3', 'i3-4', 'i3-2'],
  ];
  const cellW = 620;
  const cellH = 520;
  const sheet = surface(cellW * 6, cellH * rows.length * 2);
  rows.forEach((row, rowIndex) => {
    row.forEach((spec, column) => {
      for (const variant of [0, 1]) {
        const [zoneLevel, legs] = spec.split('-');
        const q = (column + rowIndex + variant) % 4;
        const object = buildObject(`Q-${zoneLevel}-${legs}-${String(q)}-${String(variant)}`, P);
        stamp(sheet, object, column * cellW + cellW / 2, (rowIndex * 2 + variant) * cellH + cellH * 0.62);
      }
    });
  });
  return { path: 'out/r7-lots-preview.png', canvas: sheet.canvas };
}

function modules() {
  const cellW = 420;
  const cellH = 480;
  const sheet = surface(cellW * COMBOS.length, cellH * 2);
  [0, 1].forEach((q, row) => {
    COMBOS.forEach((combo, column) => {
      for (const { key, lift, dx, dy } of modulesOf(combo, 'Q3', q)) {
        const ox = column * cellW + cellW / 2 + (dx - dy) * 64;
        const oy = row * cellH + cellH * 0.72 + (dx + dy) * 32 - lift * LIFT;
        stamp(sheet, buildModule(key, P), ox, oy);
      }
    });
  });
  return { path: 'out/r7-modules-preview.png', canvas: sheet.canvas };
}

const { path, canvas } = (process.argv[2] === 'modules' ? modules : lots)();
writeFileSync(path, canvas.png());
console.log(path);
