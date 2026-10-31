// 验收检查：地块生成器的确定性、面积和容量、地块不压路、街区划分、物业出入口、立交和路网连通、公共服务覆盖、
// 地铁规则、交通守恒、遮挡顺序、风格包回退，以及四级道路样张。这些都是纯计算，不需要显卡，用 node 直接运行。
// 容量规则、物业出入口和立交的检查不通过时退出码是 1。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { polygonArea, polygonDistance, ROAD_SPEC, worldPolylines } from '../web/sim/network.js';
import { atomPolygon, capacityTable, generateParcels, publicLandReport, RATE } from '../web/sim/parcels.js';
import { atomTable, specOf } from '../web/sim/partition.js';
import { generateCity } from '../web/sim/city.js';
import { intersectionRule, templateFootprint, templateNames } from '../web/sim/interchange.js';
import { metroCheck } from '../web/sim/metro.js';
import { countViolations, prepareItems, sortByDepth } from '../web/sim/order.js';
import { generateRoadDemo } from '../web/sim/roaddemo.js';
import { buildGraph, componentsOf, computeTraffic } from '../web/sim/traffic.js';
import { activeFestival, resolveDecoration, resolveSpec, resolveStyle } from '../web/sim/packs.js';

const SIZES = [32, 64];
const report = {};
const problems = [];

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
    if (row.use === 'fallow' || row.shape === 'green' || row.shape === 'service' || row.shape === 'public') {
      if (row.capacity !== 0) wrong += 1;
      continue;
    }
    if (row.density !== RATE[row.zone][row.level] * 4) wrong += 1;
  }
  return { rows: table.length, rowsNotProportional: wrong };
}

/**
 * 物业的出入口。容量大于 0 的地块和公共服务都算物业：必须有出入口、出入口紧贴地块、
 * 接的是普通道路（不是快速路和高速）、并且沿路网能走到城市的主路网。绿地和公园不是物业，不查。
 */
function accessCheck(city) {
  const { N, roads } = city;
  const { parcels, atomOwner } = city.parcels;
  const localRoads = new Map([...roads.entries()].filter(([, entry]) => entry.road));
  const graph = buildGraph(localRoads, N);
  const { component, sizes } = componentsOf(graph);
  const main = sizes.indexOf(Math.max(...sizes));
  const atomsOf = new Map();
  atomOwner.forEach((owner, atom) => {
    if (owner < 0) return;
    if (!atomsOf.has(owner)) atomsOf.set(owner, []);
    atomsOf.get(owner).push(atom);
  });
  const result = { properties: 0, noEntrance: 0, notTouchingRoad: 0, onExpressOrHighway: 0, unreachable: 0, greenWithCapacity: 0 };
  let farthest = 0;
  for (const parcel of parcels) {
    if (parcel.shape === 'green' && (parcel.capacity !== 0 || parcel.access >= 0)) result.greenWithCapacity += 1;
    if (parcel.capacity === 0 && parcel.shape !== 'service') continue;
    result.properties += 1;
    if (parcel.access < 0) {
      result.noEntrance += 1;
      continue;
    }
    const entry = roads.get(parcel.access);
    if (!entry.road) {
      result.onExpressOrHighway += 1;
      continue;
    }
    if (component[graph.index.get(parcel.access)] !== main) result.unreachable += 1;
    const x = (parcel.access % N) + 0.5;
    const y = Math.floor(parcel.access / N) + 0.5;
    let nearest = Infinity;
    for (const atom of atomsOf.get(parcel.id) ?? []) {
      for (const [px, py] of atomPolygon(atom, N)) nearest = Math.min(nearest, Math.hypot(px - x, py - y));
    }
    farthest = Math.max(farthest, nearest);
    if (nearest > 1.3) result.notTouchingRoad += 1;
  }
  return { ...result, farthestEntrance: farthest };
}

/** 立交占地里不能有地块和树；匝道的地面一头只能接高速和四车道，不能接两车道。 */
function reservedCheck(city) {
  const { N, reserved, roads, lanes, objects } = city;
  let parcelsOnReserved = 0;
  city.parcels.atomOwner.forEach((owner, atom) => {
    if (owner >= 0 && reserved.has(atom >> 2)) parcelsOnReserved += 1;
  });
  const forestsOnReserved = objects.filter(({ key, px, py }) => key.startsWith('forest') && reserved.has(Math.floor(py) * N + Math.floor(px))).length;
  const rampEnds = lanes.flatMap((lane) => [lane.fromCell, lane.toCell]).filter((cell) => cell !== undefined);
  const rampsOnStreet = rampEnds.filter((cell) => {
    const entry = roads.get(cell);
    return !entry || !(entry.highway || entry.arterial);
  }).length;
  return { reservedCells: reserved.size, parcelsOnReserved, forestsOnReserved, rampEnds: rampEnds.length, rampsOnStreet };
}

/** 普通城市的路网要靠匝道连成一张：去掉匝道，高速和城市路网就是分开的两块。 */
function connectionCheck(city) {
  const { N, roads, links, plan, traffic } = city;
  const road = [...roads.entries()];
  const graph = buildGraph(roads, N, links);
  const { component } = componentsOf(graph);
  const labelsOf = (test) => new Set(road.filter(([, entry]) => test(entry)).map(([id]) => component[graph.index.get(id)]));
  const highway = labelsOf((entry) => entry.highway);
  const arterial = labelsOf((entry) => entry.arterial);
  return {
    interchange: plan.interchange?.name ?? null,
    links: links.length,
    partsWithoutRamps: componentsOf(buildGraph(roads, N)).sizes.length,
    partsWithRamps: componentsOf(graph).sizes.length,
    highwayMeetsArterial: [...highway].some((label) => arterial.has(label)),
    rampTrafficSegments: traffic.edges.filter((edge) => edge.kind === 'ramp').length,
  };
}

function partitionCheck(city) {
  const { partition, parcels } = city.parcels;
  const table = atomTable(city.N);
  const properties = parcels.filter((parcel) => parcel.front !== undefined);
  const diagonalTotal = properties.reduce((sum, parcel) => sum + parcel.diagonalFront, 0);
  const onDiagonal = (shape) => properties.filter((parcel) => parcel.shape === shape).reduce((sum, parcel) => sum + parcel.diagonalFront, 0);
  const triangleBlocks = partition.details.filter(({ atoms }) => specOf(atoms, table)?.shape === 'triangle');
  return {
    ...partition.stats,
    blockAtoms: partition.blockAtoms,
    residualAtoms: partition.residual.length,
    fallbackShare: partition.residual.length / partition.blockAtoms,
    piecesWithoutRoad: properties.filter((parcel) => parcel.front < 0.7).length,
    piecesWithoutSpec: partition.pieces.filter((piece) => !specOf(piece.atoms, table)).length,
    triangleBlocks: triangleBlocks.length,
    triangleBlocksWhole: triangleBlocks.filter(({ candidates }) => candidates[0].pieces.length === 1).length,
    diagonalFrontage: diagonalTotal,
    diagonalFrontageOnBands: onDiagonal('diagonal'),
    diagonalFrontageOnTriangles: onDiagonal('bigTriangle'),
    bandSizes: [...new Set(properties.filter((parcel) => parcel.shape === 'diagonal').map((parcel) => `${String(parcel.spanU)}x${String(parcel.spanV)}`))].sort(),
  };
}

function screenBox(item) {
  const sx = (item.px - item.py) * 64;
  const sy = (item.px + item.py - 1) * 32 - item.level * 32;
  const halfW = Math.max(...item.footprint.map(([x, y]) => Math.abs((x - y) * 64 - (item.px - item.py) * 64))) + 8;
  const halfH = Math.max(...item.footprint.map(([x, y]) => Math.abs((x + y - item.px - item.py) * 32))) + 8;
  const tall = /^[BQS]-/.test(item.key) ? 460 : /^(ix|ev)-/.test(item.key) ? 120 : item.key.startsWith('forest') ? 90 : 60;
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

/** 四级道路样张：物业不进立交占地、不接快速路，高架和建筑的遮挡顺序正确，相交规则符合设计。 */
function roadDemoCheck() {
  const city = generateRoadDemo();
  const rules = {
    streetStreet: intersectionRule('road', 'road'),
    arterialStreet: intersectionRule('arterial', 'road'),
    expressArterial: intersectionRule('express', 'arterial'),
    highwayExpressThrough: intersectionRule('highway', 'express'),
    highwayExpressEnds: intersectionRule('highway', 'express', true),
    highwayArterial: intersectionRule('highway', 'arterial'),
    highwayStreet: intersectionRule('highway', 'road'),
  };
  return {
    parcels: city.parcels.parcels.length,
    lanes: city.lanes.length,
    ramps: city.lanes.filter((lane) => lane.kind === 'ramp').length,
    reserved: reservedCheck(city),
    access: accessCheck(city),
    order: orderCheck(city),
    capacity: capacityCheck(capacityTable(city.parcels.parcels)),
    rules,
    templates: Object.fromEntries(templateNames().map((name) => [name, templateFootprint(name)])),
    kinds: Object.fromEntries(Object.entries(ROAD_SPEC).map(([name, spec]) => [name, { lanes: spec.lanes, access: spec.access }])),
  };
}

/** 这一组检查里不该出现的数。label 写进失败清单，排查时直接看到是哪一项。 */
function expectZero(label, values) {
  for (const [name, value] of Object.entries(values)) if (value !== 0) problems.push(`${label}.${name}=${String(value)}`);
}

function judge(label, { capacity, access, reserved }) {
  expectZero(`${label}.capacity`, { rowsNotProportional: capacity.rowsNotProportional });
  expectZero(`${label}.access`, { noEntrance: access.noEntrance, notTouchingRoad: access.notTouchingRoad, onExpressOrHighway: access.onExpressOrHighway, unreachable: access.unreachable });
  expectZero(`${label}.reserved`, { parcelsOnReserved: reserved.parcelsOnReserved, forestsOnReserved: reserved.forestsOnReserved, rampsOnStreet: reserved.rampsOnStreet });
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
    reserved: new Set([...city.reserved].reverse()),
  });
  const table = capacityTable(city.parcels.parcels);
  const { traffic } = city;
  const repeat = computeTraffic(city.parcels.parcels, city.roads, N, city.links);
  const shape = (list) => list.filter((p) => p.shape !== 'x').map((p) => [p.shape, p.px, p.py, p.capacity, p.access]);
  report[N] = {
    generateMs: Math.round(elapsed),
    parcels: city.parcels.parcels.length,
    hash: digest(parcelsOf(city)),
    sameOnSecondRun: digest(parcelsOf(city)) === digest(parcelsOf(again)),
    sameWithShuffledInput: digest(shape(city.parcels.parcels)) === digest(shape(reshuffled.parcels)),
    area: areaCheck(city),
    capacity: capacityCheck(table),
    capacityTable: table,
    access: accessCheck(city),
    reserved: reservedCheck(city),
    connection: connectionCheck(city),
    partition: partitionCheck(city),
    looks: city.looks,
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
  judge(String(N), report[N]);
  if (N > 32) {
    const { connection } = report[N];
    if (connection.partsWithRamps !== 1 || !connection.highwayMeetsArterial) problems.push(`${String(N)}.connection=${JSON.stringify(connection)}`);
  }
  console.log(N, JSON.stringify({ ...report[N], capacityTable: undefined }));
}

report.roadDemo = roadDemoCheck();
judge('demo', report.roadDemo);
console.log('demo', JSON.stringify(report.roadDemo));
report.styles = styleCheck();
console.log(JSON.stringify(report.styles));
report.problems = problems;
mkdirSync('out', { recursive: true });
writeFileSync('out/verify-report.json', JSON.stringify(report, null, 2));
console.log(problems.length === 0 ? '检查全部通过' : `不通过：${problems.join('；')}`);
if (problems.length > 0) process.exitCode = 1;
