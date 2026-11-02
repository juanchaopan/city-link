// 匝道和高架上的车身不能叠在一起。纯计算，不开浏览器。node scripts/rampcars.js [地图边长]
// 车流开到两处立交的视野里，每隔一段时间取一帧，同一层上的两辆车按车身矩形判断平面上有没有重叠。
// 判断只看车的位置和朝向，不看车流里跟车用的里程，所以两条 lane 共用路面时叠在一起也抓得到。
// 写 out/rampcars-report.json，不通过时退出码是 1。
import { writeFileSync } from 'node:fs';
import { generateCity } from '../web/sim/city.js';
import { createFleet } from '../web/sim/fleet.js';

const size = Number(process.argv[2] ?? 128);
const CARS = 300;
const STEPS = 2400;
const WARM = 300;
const SAMPLE_EVERY = 20;
const DT = 0.05;
const HALF_WIDTH = 0.06;
const NEAR = 0.5;
const SAME_LEVEL = 0.25;
const SEED = 7;
const MODULUS = 2147483647;
const VIEW_WIDE = 300;
const VIEW_TALL = 600;

function seeded() {
  let state = SEED;
  return () => {
    state = (state * 16807) % MODULUS;
    return state / MODULUS;
  };
}

function bodyOf(car, length) {
  const half = length / 2;
  const nx = -car.dy * HALF_WIDTH;
  const ny = car.dx * HALF_WIDTH;
  const ax = car.dx * half;
  const ay = car.dy * half;
  return [
    [car.x - ax - nx, car.y - ay - ny],
    [car.x + ax - nx, car.y + ay - ny],
    [car.x + ax + nx, car.y + ay + ny],
    [car.x - ax + nx, car.y - ay + ny],
  ];
}

/** 分离轴：两个凸四边形在所有边的法线上都有重叠才算相交。 */
function bodiesOverlap(p, q) {
  for (const polygon of [p, q]) {
    for (let i = 0; i < polygon.length; i += 1) {
      const [ax, ay] = polygon[i];
      const [bx, by] = polygon[(i + 1) % polygon.length];
      const nx = by - ay;
      const ny = ax - bx;
      const project = (list) => list.map(([x, y]) => x * nx + y * ny);
      const a = project(p);
      const b = project(q);
      if (Math.max(...a) <= Math.min(...b) || Math.max(...b) <= Math.min(...a)) return false;
    }
  }
  return true;
}

function audit(city, name, x, y) {
  const fleet = createFleet(city, { cap: CARS, full: true, highCap: 120, random: seeded() });
  const sx = (x - y) * 64;
  const sy = (x + y) * 32;
  fleet.setView({
    left: sx - VIEW_WIDE,
    right: sx + VIEW_WIDE,
    top: sy - VIEW_TALL,
    bottom: sy + VIEW_TALL,
  });
  const pairs = {};
  let overlaps = 0;
  let samples = 0;
  let laneCars = 0;
  for (let step = 0; step < STEPS; step += 1) {
    fleet.step(DT);
    if (step < WARM || step % SAMPLE_EVERY !== 0) continue;
    samples += 1;
    const cars = fleet.cars.filter((car) => car.x !== undefined && car.mode === 'lane');
    laneCars += cars.length;
    for (let i = 0; i < cars.length; i += 1) {
      for (let j = i + 1; j < cars.length; j += 1) {
        const [a, b] = [cars[i], cars[j]];
        if (Math.hypot(a.x - b.x, a.y - b.y) > NEAR || Math.abs(a.h - b.h) > SAME_LEVEL) continue;
        if (!bodiesOverlap(bodyOf(a, fleet.lengthOf(a)), bodyOf(b, fleet.lengthOf(b)))) continue;
        overlaps += 1;
        const key = [a.lane.id, b.lane.id].sort().join(' 和 ');
        pairs[key] = (pairs[key] ?? 0) + 1;
      }
    }
  }
  return { name, samples, laneCars, overlaps, pairs };
}

const city = generateCity(size);
const { x, row } = city.viaduct.route;
const { cx, cy } = city.plan.interchange;
const sites = [audit(city, '丁字立交', cx, cy), audit(city, '高架', x, row)];
const report = { size, sites, overlaps: sites.reduce((sum, site) => sum + site.overlaps, 0) };
writeFileSync('out/rampcars-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
if (report.overlaps > 0) process.exitCode = 1;
