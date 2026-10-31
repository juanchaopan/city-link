// 不开浏览器的几何预览：用软件光栅把程序建模的三角形按 2:1 等距画出来，内存紧张、开不了烘焙时看形体用。
// 没有投影、抗锯齿和路面着色器，地面没有起伏，颜色也不等于成品，只用来判断形体和占地。真实效果以 shots.js 的截图为准。
// node scripts/preview.js lots          out/r7-lots-preview.png：大三角物业的各种规格
// node scripts/preview.js modules       out/r7-modules-preview.png：Q3 的模块拼装
// node scripts/preview.js tee           out/r7-tee-preview.png：普通城市里的丁字立交
// node scripts/preview.js center        out/r7-center-preview.png：市中心，斜路两边的大三角
import { writeFileSync } from 'node:fs';
import { LEVEL } from '../web/kit/bake.js';
import { Builder, linear } from '../web/kit/builder.js';
import { interchangeFrame } from '../web/kit/interchange.js';
import { buildModule } from '../web/kit/modules.js';
import { buildObject } from '../web/kit/objects.js';
import { palettes } from '../web/kit/palettes.js';
import { generateCity } from '../web/sim/city.js';
import { COMBOS, modulesOf } from '../web/sim/combos.js';
import { ROAD_SPEC, worldPolylines } from '../web/sim/network.js';
import { createCanvas } from './raster.js';

const P = palettes.sunny;
const N = 64;
const SCALE = 128 / Math.SQRT2;
const ELEVATION = Math.PI / 6;
const LIFT = 16;
const SKY = [143, 192, 112];
const SUN = [0.5, 0.75, 0.42];
const ROAD_COLOR = { road: '#8b909a', arterial: '#6f747e', highway: '#4f545e', express: '#4f545e', ramp: '#4a4f58' };

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

/** 把一个物体按世界位置 [x, y, z] 画上去。ox、oy 是世界原点在画布上的像素位置。 */
function stamp({ draw }, builder, ox, oy, [wx, wy, wz] = [0, 0, 0]) {
  const { positions, colors } = builder;
  const view = (i) => {
    const x = positions[i] + wx;
    const y = positions[i + 1] + wy;
    const z = positions[i + 2] + wz;
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

/** 一条折线的路面，每段一个四边形。点是 [x, y, h]，h 是层数。 */
function ribbon(b, points, half, color) {
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, az, ah = 0] = points[i];
    const [cx, cz, ch = 0] = points[i + 1];
    const length = Math.hypot(cx - ax, cz - az) || 1;
    const nx = (-(cz - az) / length) * half;
    const nz = ((cx - ax) / length) * half;
    const lift = 0.004 + ah * LEVEL;
    const next = 0.004 + ch * LEVEL;
    b.poly([[ax + nx, lift, az + nz], [cx + nx, next, cz + nz], [cx - nx, next, cz - nz], [ax - nx, lift, az - nz]], color);
  }
}

function cityView(name, [fx, fy], width, height) {
  const city = generateCity(N);
  const sheet = surface(width, height);
  const ox = width / 2 - (fx - fy) * 64;
  const oy = height / 2 - (fx + fy) * 32;
  const inView = (px, py) => Math.abs((px - py - (fx - fy)) * 64) < width / 2 + 300 && Math.abs((px + py - (fx + fy)) * 32) < height / 2 + 300;

  const roads = new Builder(1);
  for (const { points, half, kind, cell } of worldPolylines(city.roads, N)) {
    if (inView(cell % N, Math.floor(cell / N))) ribbon(roads, points, half, linear(ROAD_COLOR[kind]));
  }
  stamp(sheet, roads, ox, oy);

  for (const { key, px, py, level, modules: parts } of city.objects) {
    if (!inView(px, py) || /^(ix|ev|br|gate|boat|dock)/.test(key)) continue;
    for (const part of parts ?? []) {
      const lift = level * LEVEL + (part.lift * LEVEL) / 2;
      stamp(sheet, buildModule(part.key, P), ox, oy, [px + part.dx, lift, py + part.dy]);
    }
    if (!parts) stamp(sheet, buildObject(key, P), ox, oy, [px, level * LEVEL, py]);
  }

  const { interchange } = city.plan;
  if (interchange) {
    const decks = new Builder(2);
    for (const { points } of city.lanes) ribbon(decks, points, ROAD_SPEC.ramp.deck / 2, linear(ROAD_COLOR.ramp));
    stamp(sheet, decks, ox, oy);
    stamp(sheet, interchangeFrame(interchange.name, P), ox, oy, [interchange.cx + 0.5, 0, interchange.cy + 0.5]);
  }
  return { path: `out/r7-${name}-preview.png`, canvas: sheet.canvas };
}

const MODES = {
  lots,
  modules,
  tee: () => cityView('tee', [33, 8], 2200, 1300),
  center: () => cityView('center', [31, 30], 2000, 2400),
};
const { path, canvas } = MODES[process.argv[2] ?? 'lots']();
writeFileSync(path, canvas.png());
console.log(path);
