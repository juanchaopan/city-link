// 大三角物业的占地检查，纯 node，不开浏览器：把物业里所有楼顶投影回地面，量楼盖住了地块的多少，
// 以及地块上最大的一块空地有多大。树不算楼，所以用树冠填空地过不了这个检查。
// 结果写到 out/lot-report.json，不合格时退出码是 1。
import { mkdirSync, writeFileSync } from 'node:fs';
import { Builder } from '../web/kit/builder.js';
import { buildObject } from '../web/kit/objects.js';
import { palettes } from '../web/kit/palettes.js';
import { QUADRANTS } from '../web/sim/combos.js';

const MIN_COVERAGE = 0.45;
const MAX_EMPTY_RADIUS = 1;
const ROOF_Y = 0.1;
const STEP = 0.05;
const LEGS = [2, 3, 4, 5, 6];
const ZONES = ['r', 'c', 'i'];
const LEVELS = [1, 2, 3];
const VARIANTS = [0, 1];

Builder.prototype.blob = () => {};

function insideTriangle([ax, az], [bx, bz], [cx, cz], x, z) {
  const d0 = (bx - ax) * (z - az) - (bz - az) * (x - ax);
  const d1 = (cx - bx) * (z - bz) - (cz - bz) * (x - bx);
  const d2 = (ax - cx) * (z - cz) - (az - cz) * (x - cx);
  return (d0 >= 0 && d1 >= 0 && d2 >= 0) || (d0 <= 0 && d1 <= 0 && d2 <= 0);
}

/** 地块里的格点，u、v 从直角顶点量起。 */
function lotSamples(legs, q) {
  const [sx, sz] = QUADRANTS[q];
  const samples = [];
  for (let u = STEP / 2; u < legs; u += STEP) {
    for (let v = STEP / 2; u + v < legs; v += STEP) {
      samples.push({ x: -sx * (legs / 2) + sx * u, z: -sz * (legs / 2) + sz * v, covered: false });
    }
  }
  return samples;
}

function roofsOf(positions) {
  const roofs = [];
  for (let i = 0; i < positions.length; i += 9) {
    const [ay, by, cy] = [positions[i + 1], positions[i + 4], positions[i + 7]];
    if (Math.min(ay, by, cy) < ROOF_Y) continue;
    const a = [positions[i], positions[i + 2]];
    const b = [positions[i + 3], positions[i + 5]];
    const c = [positions[i + 6], positions[i + 8]];
    if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 1e-6) roofs.push([a, b, c]);
  }
  return roofs;
}

/** 空地上离楼最远的一点到楼的距离，就是能放进这块空地的最大圆的半径。 */
function emptyRadius(samples) {
  const empty = samples.filter((sample) => !sample.covered);
  const walls = samples.filter((sample) => sample.covered);
  let radius = 0;
  for (const point of empty) {
    let nearest = Infinity;
    for (const wall of walls) nearest = Math.min(nearest, Math.hypot(wall.x - point.x, wall.z - point.z));
    radius = Math.max(radius, nearest);
  }
  return radius;
}

function measure(name, legs, q) {
  const samples = lotSamples(legs, q);
  for (const triangle of roofsOf(buildObject(name, palettes.sunny).positions)) {
    const xs = triangle.map((p) => p[0]);
    const zs = triangle.map((p) => p[1]);
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    for (const sample of samples) {
      if (sample.covered || sample.x < x0 || sample.x > x1 || sample.z < z0 || sample.z > z1) continue;
      if (insideTriangle(...triangle, sample.x, sample.z)) sample.covered = true;
    }
  }
  const covered = samples.filter((sample) => sample.covered).length;
  return { name, coverage: covered / samples.length, emptyRadius: covered === 0 ? legs : emptyRadius(samples) };
}

const rows = [];
for (const zone of ZONES) {
  for (const level of LEVELS) {
    for (const legs of LEGS) {
      for (const variant of VARIANTS) rows.push(measure(`Q-${zone}${String(level)}-${String(legs)}-${String(legs % 4)}-${String(variant)}`, legs, legs % 4));
    }
  }
}

const failures = rows.filter((row) => row.coverage < MIN_COVERAGE || row.emptyRadius > MAX_EMPTY_RADIUS);
const coverages = rows.map((row) => row.coverage).sort((a, b) => a - b);
const summary = {
  specs: rows.length,
  failures: failures.length,
  minCoverage: coverages[0],
  medianCoverage: coverages[Math.floor(coverages.length / 2)],
  maxEmptyRadius: Math.max(...rows.map((row) => row.emptyRadius)),
};
mkdirSync('out', { recursive: true });
writeFileSync('out/lot-report.json', JSON.stringify({ ...summary, limits: { MIN_COVERAGE, MAX_EMPTY_RADIUS }, rows }, null, 2));
console.log(failures.length === 0 ? '通过' : '不通过', JSON.stringify(summary));
for (const row of failures.slice(0, 8)) console.log(row.name, row.coverage.toFixed(2), row.emptyRadius.toFixed(2));
if (failures.length > 0) process.exitCode = 1;
