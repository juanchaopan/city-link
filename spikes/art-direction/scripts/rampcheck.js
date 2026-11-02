// 匝道坡度、挡墙和立交圈内用地的验收，纯计算，不开浏览器。node scripts/rampcheck.js [报告名]，不通过时退出码是 1。
// 坡度：交付的四种模板的每条匝道和默认城市的主线，半格窗口内的最大坡度不超过 MAX_GRADE。
// 挡墙：匝道落地的一头，路面贴地的那几段归到路面层，它们的挡墙要由挨着的离地块画，离地的线段一段都不能漏；
// 漏掉就是墙在两层之间断开，离地块的尽头出现一道竖直的切口。
// 用地：物业和停车场的出入口是普通路；物业、停车场都不压车走的线，线上的点直接读 lanes，不用生成用地时的判定。
// 三项都带反例：一条 2.6 格爬满桥面的坡，一块放在匝道上的停车场，以及贴地块自己画墙的分层做法，检查必须把它们抓出来。
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateCity } from '../web/sim/city.js';
import { template, templateFootprint } from '../web/sim/interchange.js';
import { unwalledSegments } from '../web/sim/ixpieces.js';
import { polygonArea } from '../web/sim/network.js';
import { ease, ELEVATED, MAX_GRADE, peakGrade } from '../web/sim/rampline.js';
import { generateRoadDemo } from '../web/sim/roaddemo.js';

const reportName = process.argv[2] ?? 'ramp-report';
const DELIVERED = ['tee', 'diamond', 'spur', 'sidediamond'];
const TOO_SHORT = 2.6;
const ROUND = 1000;
const percent = (value) => Math.round(value * ROUND) / 10;

function gradeRows(city) {
  const rows = DELIVERED.flatMap((name) =>
    template(name)
      .ramps()
      .map((ramp) => ({ name: `${name}·${ramp.name}`, peak: peakGrade(ramp.center) })),
  );
  for (const lane of city.lanes.filter(({ kind }) => kind === 'express'))
    rows.push({ name: `主线·${lane.id}`, peak: peakGrade(lane.points) });
  return rows.map(({ name, peak }) => ({ name, percent: percent(peak), pass: peak <= MAX_GRADE }));
}

/** 每种模板的匝道里没有离地块画墙的线段数，以及贴地块自己画墙时的数。 */
function wallRows() {
  return DELIVERED.map((name) => {
    const unwalled = unwalledSegments(name);
    return { name, unwalled, layered: unwalledSegments(name, false), pass: unwalled === 0 };
  });
}

/** 射线法判断点在不在多边形里。 */
function inside([x, y], polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[j];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) hit = !hit;
  }
  return hit;
}

/** 落在贴地路面上的地块数。立交的车道、高架在头顶经过的不算。 */
function lotsOnLanes(lots, lanes) {
  const low = lanes.flatMap(({ points }) => points).filter(([, , h]) => h < 1);
  return lots.filter(({ polygon }) => low.some((point) => inside(point, polygon))).length;
}

function landOf(city) {
  const { N, roads, interchangeLand: land } = city;
  const parking = land.parking.map(({ x, y, w, h, access }) => ({
    access,
    polygon: [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
  }));
  const shops = new Set(land.shops);
  const parcels = city.parcels.parcels.filter(
    (parcel) =>
      parcel.polygon &&
      parcel.capacity > 0 &&
      shops.has(Math.floor(parcel.py - 0.01) * N + Math.floor(parcel.px - 0.01)),
  );
  const ordinary = (id) => Boolean(roads.get(id)?.road);
  const row = {
    parking: parking.length,
    parkingCells: parking.reduce((sum, lot) => sum + polygonArea(lot.polygon), 0),
    shopCells: land.shops.length,
    parcels: parcels.length,
    capacity: parcels.reduce((sum, parcel) => sum + parcel.capacity, 0),
    parkingBadAccess: parking.filter((lot) => !ordinary(lot.access)).length,
    parcelsBadAccess: parcels.filter((parcel) => !ordinary(parcel.access)).length,
    lotsOnLanes: lotsOnLanes([...parking, ...parcels], city.lanes),
  };
  return { ...row, pass: row.parkingBadAccess + row.parcelsBadAccess + row.lotsOnLanes === 0 };
}

const city = generateCity(64);
const demo = generateRoadDemo();
const grades = gradeRows(city);
const walls = wallRows();
const land = { 默认城市: landOf(city), 四级道路样张: landOf(demo) };

const tooSteep = Array.from({ length: 27 }, (_, i) => {
  const s = i * 0.1;
  return [0, s, ELEVATED * ease(s / TOO_SHORT)];
});
const lane = city.lanes.find(({ id }) => id.startsWith('tee'));
const [ax, ay] = lane.points[Math.floor(lane.points.length / 2)];
const onRamp = [
  [ax - 1, ay - 1],
  [ax + 1, ay - 1],
  [ax + 1, ay + 1],
  [ax - 1, ay + 1],
];
const proof = {
  steepGradePercent: percent(peakGrade(tooSteep)),
  steepCaught: peakGrade(tooSteep) > MAX_GRADE,
  lotOnRampCaught: lotsOnLanes([{ polygon: onRamp }], city.lanes) === 1,
  layeredWallsCaught: walls.every((row) => row.layered > 0),
};
const footprints = Object.fromEntries(DELIVERED.map((name) => [name, templateFootprint(name)]));

for (const { name, percent: value, pass } of grades)
  console.log(`${name}\t${String(value)}%\t${pass ? '通过' : '不通过'}`);
console.log('上限', `${String(percent(MAX_GRADE))}%`);
for (const { name, unwalled, layered, pass } of walls)
  console.log(
    `挡墙 ${name}\t漏 ${String(unwalled)} 段，分层画时漏 ${String(layered)} 段\t${pass ? '通过' : '不通过'}`,
  );
console.log('用地', JSON.stringify(land));
console.log('占地', JSON.stringify(footprints));
console.log('反例', JSON.stringify(proof));

const pass =
  grades.every((row) => row.pass) &&
  walls.every((row) => row.pass) &&
  Object.values(land).every((row) => row.pass) &&
  proof.steepCaught &&
  proof.lotOnRampCaught &&
  proof.layeredWallsCaught;
mkdirSync('out', { recursive: true });
writeFileSync(
  `out/${reportName}.json`,
  JSON.stringify({ grades, walls, land, footprints, proof, pass }, null, 2),
);
console.log(pass ? '检查全部通过' : '不通过');
if (!pass) process.exitCode = 1;
