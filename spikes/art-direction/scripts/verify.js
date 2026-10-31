// 验收检查：地块生成器的确定性、面积和容量、地块不压路、大地块是否完整、公共服务覆盖、地铁规则、
// 交通守恒、遮挡顺序、风格包回退。这些都是纯计算，不需要显卡，用 node 直接运行。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { polygonArea, polygonDistance, worldPolylines } from '../web/sim/network.js';
import { capacityTable, generateParcels, publicLandReport, RATE, triangleLandReport } from '../web/sim/parcels.js';
import { generateCity } from '../web/sim/city.js';
import { metroCheck } from '../web/sim/metro.js';
import { countViolations, prepareItems, sortByDepth } from '../web/sim/order.js';
import { computeTraffic } from '../web/sim/traffic.js';
import { activeFestival, resolveDecoration, resolveSpec, resolveStyle } from '../web/sim/packs.js';

const SIZES = [32, 64];
const report = {};

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function parcelsOf(city) {
  return city.parcels.parcels.map(({ cells, ...parcel }) => ({ ...parcel, cells: cells?.length ?? 0 }));
}

function roadClearance(city) {
  const lines = worldPolylines(city.roads, city.N);
  let smallest = Infinity;
  let overlaps = 0;
  let checked = 0;
  for (const parcel of city.parcels.parcels) {
    if (!parcel.polygon) continue;
    checked += 1;
    for (const line of lines) {
      const margin = polygonDistance(parcel.polygon, line.points) - line.half;
      smallest = Math.min(smallest, margin);
      if (margin < 0) overlaps += 1;
    }
  }
  return { checked, overlaps, smallestMargin: smallest };
}

function areaCheck(city) {
  const { parcels, buildableAtoms, usedAtoms, atomOwner, free } = city.parcels;
  const sum = parcels.reduce((total, parcel) => total + parcel.atoms, 0);
  let outside = 0;
  atomOwner.forEach((owner, atom) => {
    if (owner >= 0 && free[atom] === 0) outside += 1;
  });
  let polygonMismatch = 0;
  for (const parcel of parcels) {
    if (parcel.polygon && polygonArea(parcel.polygon) > parcel.area + 1e-9) polygonMismatch += 1;
  }
  return {
    buildableArea: buildableAtoms / 4,
    parcelArea: sum / 4,
    overlappingAtoms: sum - usedAtoms,
    atomsOutsideBuildable: outside,
    polygonLargerThanParcel: polygonMismatch,
    usage: sum / buildableAtoms,
  };
}

function capacityCheck(table) {
  let wrong = 0;
  for (const row of table) {
    if (row.use === 'garden' || row.use === 'parking' || row.shape === 'service' || row.shape === 'public') {
      if (row.capacity !== 0) wrong += 1;
      continue;
    }
    if (row.density !== RATE[row.zone][row.level] * 4) wrong += 1;
  }
  return { rows: table.length, rowsNotProportional: wrong };
}

function screenBox(item) {
  const sx = (item.px - item.py) * 64;
  const sy = (item.px + item.py - 1) * 32 - item.level * 32;
  const halfW = Math.max(...item.footprint.map(([x, y]) => Math.abs((x - y) * 64 - (item.px - item.py) * 64))) + 8;
  const halfH = Math.max(...item.footprint.map(([x, y]) => Math.abs((x + y - item.px - item.py) * 32))) + 8;
  const tall = /^[BQS]-/.test(item.key) ? 460 : item.key.startsWith('forest') ? 90 : 60;
  return { left: sx - halfW, right: sx + halfW, top: sy - halfH - tall, bottom: sy + halfH };
}

function orderCheck(city) {
  const items = city.objects.map((object) => ({ ...object, ...screenBox(object) }));
  const { sorted, cycles } = sortByDepth(items);
  const byCenter = prepareItems(items).sort((a, b) => a.px + a.py - b.px - b.py);
  return {
    items: items.length,
    cycles,
    violations: countViolations(sorted),
    violationsIfSortedByCenter: countViolations(byCenter),
  };
}

function propertyCheck(city) {
  const { parcels, services } = city.parcels;
  const counts = {};
  for (const parcel of parcels) counts[parcel.shape] = (counts[parcel.shape] ?? 0) + 1;
  const kinds = {};
  for (const { service } of services) kinds[service] = (kinds[service] ?? 0) + 1;
  return {
    counts,
    largeProperties: parcels.filter((parcel) => parcel.area >= 2).length,
    withoutEntrance: parcels.filter((parcel) => parcel.access < 0).length,
    services: kinds,
  };
}

function styleCheck() {
  const standard = { id: 'standard', specs: ['B-r1-1x1-a-0', 'B-c2-2x2-a-0'] };
  const classic = { id: 'classic', specs: ['B-r1-1x1-a-0'] };
  const installed = { standard, classic };
  const festival = {
    id: 'national-day',
    from: 1001,
    to: 1007,
    generic: { footprints: ['R1x1', 'R2x2'] },
    styles: { classic: { footprints: ['R1x1'] } },
  };
  return {
    missingStyleFallsBack: resolveStyle(installed, 'nothing').id === 'standard',
    missingSpecFallsBack: resolveSpec(classic, standard, 'B-c2-2x2-a-0')?.style === 'standard',
    unknownSpecIsEmpty: resolveSpec(classic, standard, 'B-x9-9x9-a-0') === null,
    festivalActiveOnDate: activeFestival([festival], 10, 3)?.id === 'national-day',
    festivalEndsByItself: activeFestival([festival], 10, 8) === null,
    ownDecorationWins: resolveDecoration(festival, 'classic', 'R1x1')?.pack === 'classic',
    decorationFallsBack: resolveDecoration(festival, 'classic', 'R2x2')?.pack === 'generic',
    noDecorationIsSafe: resolveDecoration(festival, 'classic', 'D9x9-u') === null,
    noFestivalIsSafe: resolveDecoration(null, 'classic', 'R1x1') === null,
  };
}

for (const N of SIZES) {
  const started = performance.now();
  const city = generateCity(N);
  const elapsed = performance.now() - started;
  const again = generateCity(N);
  const concentrated = generateCity(N, 11, 'concentrated');
  const reshuffled = generateParcels({
    N,
    roads: new Map([...city.roads.entries()].reverse()),
    water: new Set([...city.water].reverse()),
    slopes: new Set([...city.slopes].reverse()),
    zones: city.zones,
    density: city.density,
    seed: 11,
  });
  const table = capacityTable(city.parcels.parcels);
  const { traffic } = city;
  const repeat = computeTraffic(city.parcels.parcels, city.roads, N);
  const shape = (list) => list.map((p) => [p.shape, p.px, p.py, p.capacity, p.access]);
  report[N] = {
    generateMs: Math.round(elapsed),
    parcels: city.parcels.parcels.length,
    hash: digest(parcelsOf(city)),
    sameOnSecondRun: digest(parcelsOf(city)) === digest(parcelsOf(again)),
    sameWithShuffledInput: digest(shape(city.parcels.parcels)) === digest(shape(reshuffled.parcels)),
    area: areaCheck(city),
    capacity: capacityCheck(table),
    capacityTable: table,
    triangles: triangleLandReport(city.parcels, N, city.zones),
    properties: propertyCheck(city),
    publicLand: publicLandReport(city.parcels, N, city.zones),
    coverage: {
      spread: { population: city.coverage.population, blindShare: city.coverage.blindShare, missing: city.coverage.missingByService },
      concentrated: { population: concentrated.coverage.population, blindShare: concentrated.coverage.blindShare, missing: concentrated.coverage.missingByService },
    },
    metro: metroCheck(city.metro),
    roads: roadClearance(city),
    traffic: {
      segments: traffic.edges.length,
      generated: traffic.generated,
      assigned: traffic.assigned,
      unreachable: traffic.unreachable,
      overloaded: traffic.edges.filter((edge) => edge.ratio > 1).length,
      busiest: Math.max(...traffic.edges.map((edge) => edge.ratio)),
      deterministic: digest(traffic.edges) === digest(repeat.edges),
    },
    order: orderCheck(city),
  };
  console.log(N, JSON.stringify({ ...report[N], capacityTable: undefined }));
}

report.styles = styleCheck();
console.log(JSON.stringify(report.styles));
mkdirSync('out', { recursive: true });
writeFileSync('out/verify-report.json', JSON.stringify(report, null, 2));
