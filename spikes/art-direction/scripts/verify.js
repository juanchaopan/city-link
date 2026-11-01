// 验收检查：地块生成器的确定性、面积和容量、地块不压路、街区划分、物业出入口、立交和路网连通、公共服务覆盖、
// 地铁规则、公交站、交通分配、遮挡顺序、风格包回退，以及四级道路样张。这些都是纯计算，不需要显卡，用 node 直接运行。
// 容量规则、物业出入口、立交、地铁和公交站的检查不通过时退出码是 1。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { palettes } from '../web/kit/palettes.js';
import { polygonArea, polygonDistance, ROAD_SPEC, worldPolylines } from '../web/sim/network.js';
import {
  atomPolygon,
  capacityTable,
  generateParcels,
  publicLandReport,
  RATE,
} from '../web/sim/parcels.js';
import { atomTable, specOf } from '../web/sim/partition.js';
import { generateCity } from '../web/sim/city.js';
import { quote, progressAt } from '../web/sim/expropriate.js';
import { intersectionRule, templateFootprint, templateNames } from '../web/sim/interchange.js';
import { MIN_RADIUS, metroCheck, railLine, tightestRadius } from '../web/sim/metro.js';
import { countViolations, prepareItem, sortByDepth } from '../web/sim/order.js';
import { generateRoadDemo } from '../web/sim/roaddemo.js';
import { buildGraph, componentsOf, computeTraffic } from '../web/sim/traffic.js';
import { activeFestival, resolveDecoration, resolveSpec, resolveStyle } from '../web/sim/packs.js';

const SIZES = [32, 64];
const report = {};
const problems = [];
const MIN_COLOR_DISTANCE = 45;
const HALL_REACH = 1.6;
const SHORT_LEG = 3;

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function parcelsOf(city) {
  return city.parcels.parcels.map(({ cells, ...parcel }) => ({
    ...parcel,
    cells: cells?.length ?? 0,
  }));
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
    if (
      row.use === 'fallow' ||
      row.shape === 'green' ||
      row.shape === 'service' ||
      row.shape === 'public'
    ) {
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
  const result = {
    properties: 0,
    noEntrance: 0,
    notTouchingRoad: 0,
    onExpressOrHighway: 0,
    unreachable: 0,
    greenWithCapacity: 0,
  };
  let farthest = 0;
  for (const parcel of parcels) {
    if (parcel.shape === 'green' && (parcel.capacity !== 0 || parcel.access >= 0))
      result.greenWithCapacity += 1;
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
      for (const [px, py] of atomPolygon(atom, N))
        nearest = Math.min(nearest, Math.hypot(px - x, py - y));
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
  const forestsOnReserved = objects.filter(
    ({ key, px, py }) =>
      key.startsWith('forest') && reserved.has(Math.floor(py) * N + Math.floor(px)),
  ).length;
  const rampEnds = lanes
    .flatMap((lane) => [lane.fromCell, lane.toCell])
    .filter((cell) => cell !== undefined);
  const rampsOnStreet = rampEnds.filter((cell) => {
    const entry = roads.get(cell);
    return !entry || !(entry.highway || entry.arterial);
  }).length;
  return {
    reservedCells: reserved.size,
    parcelsOnReserved,
    forestsOnReserved,
    rampEnds: rampEnds.length,
    rampsOnStreet,
  };
}

/** 普通城市的路网要靠匝道连成一张：去掉匝道，高速和城市路网就是分开的两块。 */
function connectionCheck(city) {
  const { N, roads, links, plan, traffic } = city;
  const road = [...roads.entries()];
  const graph = buildGraph(roads, N, links);
  const { component } = componentsOf(graph);
  const labelsOf = (test) =>
    new Set(road.filter(([, entry]) => test(entry)).map(([id]) => component[graph.index.get(id)]));
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
  const onDiagonal = (shape) =>
    properties
      .filter((parcel) => parcel.shape === shape)
      .reduce((sum, parcel) => sum + parcel.diagonalFront, 0);
  const triangleBlocks = partition.details.filter(
    ({ atoms }) => specOf(atoms, table)?.shape === 'triangle',
  );
  return {
    ...partition.stats,
    blockAtoms: partition.blockAtoms,
    residualAtoms: partition.residual.length,
    fallbackShare: partition.residual.length / partition.blockAtoms,
    piecesWithoutRoad: properties.filter((parcel) => parcel.front < 0.7).length,
    piecesWithoutSpec: partition.pieces.filter((piece) => !specOf(piece.atoms, table)).length,
    triangleBlocks: triangleBlocks.length,
    triangleBlocksWhole: triangleBlocks.filter(
      ({ candidates }) => candidates[0].pieces.length === 1,
    ).length,
    diagonalFrontage: diagonalTotal,
    diagonalFrontageOnBands: onDiagonal('diagonal'),
    diagonalFrontageOnTriangles: onDiagonal('bigTriangle'),
    bandSizes: [
      ...new Set(
        properties
          .filter((parcel) => parcel.shape === 'diagonal')
          .map((parcel) => `${String(parcel.spanU)}x${String(parcel.spanV)}`),
      ),
    ].sort(),
  };
}

function screenBox(item) {
  const sx = (item.px - item.py) * 64;
  const sy = (item.px + item.py - 1) * 32 - item.level * 32;
  const halfW =
    Math.max(...item.footprint.map(([x, y]) => Math.abs((x - y) * 64 - (item.px - item.py) * 64))) +
    8;
  const halfH =
    Math.max(...item.footprint.map(([x, y]) => Math.abs((x + y - item.px - item.py) * 32))) + 8;
  const tall = /^[BQS]-/.test(item.key)
    ? 460
    : /^(ixp|ev|pr)-/.test(item.key)
      ? 120
      : item.key.startsWith('forest')
        ? 90
        : 60;
  return { left: sx - halfW, right: sx + halfW, top: sy - halfH - tall, bottom: sy + halfH };
}

function orderCheck(city) {
  const items = city.objects.map((object) => ({ ...object, ...screenBox(object) }));
  const { sorted, cycles } = sortByDepth(items);
  const byCenter = items.map(prepareItem).sort((a, b) => a.px + a.py - b.px - b.py);
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

function rgbOf(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/** 公共服务专用色和普通物业的分区颜色分得开：RGB 距离不小于上限。把分区色当服务色放进来，这一项就会失败。 */
function serviceColorCheck(P) {
  const zones = Object.values(P.zones).flat();
  const services = ['hospital', 'school', 'police', 'fire', 'water', 'power'].map(
    (id) => P.service[id],
  );
  let nearest = Infinity;
  for (const service of services) {
    for (const zone of zones) {
      const [a, b] = [rgbOf(service), rgbOf(zone)];
      nearest = Math.min(nearest, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
  }
  return { nearest: Math.round(nearest), tooClose: nearest < MIN_COLOR_DISTANCE ? 1 : 0 };
}

/** 地铁：线路的最小半径、站厅不重叠不压路，站厅在线路旁边。 */
function metroGeometryCheck(city) {
  const { N, roads, metro, reserved } = city;
  const hallCells = metro.halls.map(({ id }) => id);
  const linePoints = (hall) => {
    const line = metro.lines.find(({ id }) => id === hall.line);
    return Math.min(...line.path.map(([x, y]) => Math.hypot(x - hall.x - 0.5, y - hall.y - 0.5)));
  };
  const radii = metro.lines.map(({ path }) => tightestRadius(path));
  const brokenLine = railLine(
    [
      [0, 0],
      [SHORT_LEG, 0],
      [SHORT_LEG, 1],
    ],
    false,
  );
  return {
    tightestRadius: Math.min(...radii),
    linesBelowRadius: radii.filter((radius) => radius < MIN_RADIUS - 0.05).length,
    halls: metro.halls.length,
    hallsOverlapping: hallCells.length - new Set(hallCells).size,
    hallsOnRoad: hallCells.filter((id) => roads.has(id)).length,
    hallsOffLine: metro.halls.filter((hall) => linePoints(hall) > HALL_REACH).length,
    hallsOutsideReserved: hallCells.filter((id) => !reserved.has(id)).length,
    entrancesWithoutRoad: metro.halls.filter(({ x, y, side }) => {
      const [dx, dy] = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ][side];
      return !roads.has((y + dy) * N + x + dx);
    }).length,
    tightCorners: metro.lines.reduce((sum, { tight }) => sum + tight.length, 0),
    tightCornerCaught: brokenLine.tight.length > 0,
    polylineRadiusIsZero:
      tightestRadius(metro.lines[1].points.map(([x, y]) => [x, y])) === Infinity,
  };
}

/** 公交站：不占格子，站台在人行道上，地块和站台不重叠，和路口隔开。 */
function busStopCheck(city) {
  const { N, roads, busStops, parcels } = city;
  const cells = new Set(busStops.map(({ cell }) => cell));
  const onCell = parcels.atomOwner.reduce((sum, owner, atom) => {
    return sum + (owner >= 0 && cells.has(atom >> 2) ? 1 : 0);
  }, 0);
  const notOnRoad = busStops.filter(({ cell }) => !roads.has(cell)).length;
  const clusterCells = new Set(city.junctions.clusters.flatMap(({ cells: own }) => [...own]));
  const inJunction = busStops.filter(({ cell }) => clusterCells.has(cell)).length;
  return { stops: busStops.length, notOnRoad, inJunction, atomsTaken: onCell, cells: N };
}

/** 征收：账目按整块物业算，确认后一个游戏日搬完才能开工。 */
function expropriationCheck(city) {
  const { parcels } = city.parcels;
  const owner = parcels.find(({ capacity, cells }) => capacity > 0 && (cells?.length ?? 0) > 1);
  if (!owner) return { sample: null };
  const account = quote([owner.cells[0]], parcels);
  return {
    sample: account,
    wholeBlock: account.cells === owner.cells.length,
    halfwayRemaining: progressAt(account, 0.5).remaining,
    canBuildAtOnce: progressAt(account, 0).canBuild,
    canBuildAfterDay: progressAt(account, 1).canBuild,
  };
}

/** 快路上的负荷：长距离走快路，所以高速、快速路和匝道上都要有流量。 */
function assignmentCheck(city) {
  const byKind = {};
  for (const edge of city.traffic.edges) {
    const entry = (byKind[edge.kind] ??= { segments: 0, load: 0, busiest: 0 });
    entry.segments += 1;
    entry.load += edge.load * edge.length;
    entry.busiest = Math.max(entry.busiest, Math.round(edge.ratio * 100) / 100);
  }
  for (const entry of Object.values(byKind)) entry.load = Math.round(entry.load);
  return byKind;
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
    kinds: Object.fromEntries(
      Object.entries(ROAD_SPEC).map(([name, spec]) => [
        name,
        { lanes: spec.lanes, access: spec.access },
      ]),
    ),
  };
}

/** 这一组检查里不该出现的数。label 写进失败清单，排查时直接看到是哪一项。 */
function expectZero(label, values) {
  for (const [name, value] of Object.entries(values))
    if (value !== 0) problems.push(`${label}.${name}=${String(value)}`);
}

function judge(label, { capacity, access, reserved }) {
  expectZero(`${label}.capacity`, { rowsNotProportional: capacity.rowsNotProportional });
  expectZero(`${label}.access`, {
    noEntrance: access.noEntrance,
    notTouchingRoad: access.notTouchingRoad,
    onExpressOrHighway: access.onExpressOrHighway,
    unreachable: access.unreachable,
  });
  expectZero(`${label}.reserved`, {
    parcelsOnReserved: reserved.parcelsOnReserved,
    forestsOnReserved: reserved.forestsOnReserved,
    rampsOnStreet: reserved.rampsOnStreet,
  });
}

function judgeTransit(label, { metroGeometry, busStops: stops, serviceColors }) {
  expectZero(`${label}.metro`, {
    linesBelowRadius: metroGeometry.linesBelowRadius,
    hallsOverlapping: metroGeometry.hallsOverlapping,
    hallsOnRoad: metroGeometry.hallsOnRoad,
    hallsOffLine: metroGeometry.hallsOffLine,
    entrancesWithoutRoad: metroGeometry.entrancesWithoutRoad,
    tightCorners: metroGeometry.tightCorners,
  });
  expectZero(`${label}.busStops`, {
    notOnRoad: stops.notOnRoad,
    inJunction: stops.inJunction,
    atomsTaken: stops.atomsTaken,
  });
  expectZero(`${label}.colors`, { tooClose: serviceColors.tooClose });
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
  const repeat = computeTraffic(city.parcels.parcels, city.roads, N, city.links, city.gateCells);
  const shape = (list) =>
    list.filter((p) => p.shape !== 'x').map((p) => [p.shape, p.px, p.py, p.capacity, p.access]);
  report[N] = {
    generateMs: Math.round(elapsed),
    parcels: city.parcels.parcels.length,
    hash: digest(parcelsOf(city)),
    sameOnSecondRun: digest(parcelsOf(city)) === digest(parcelsOf(again)),
    sameWithShuffledInput:
      digest(shape(city.parcels.parcels)) === digest(shape(reshuffled.parcels)),
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
      spread: {
        population: city.coverage.population,
        blindShare: city.coverage.blindShare,
        missing: city.coverage.missingByService,
      },
      concentrated: {
        population: concentrated.coverage.population,
        blindShare: concentrated.coverage.blindShare,
        missing: concentrated.coverage.missingByService,
      },
    },
    metro: metroCheck(city.metro),
    metroGeometry: metroGeometryCheck(city),
    busStops: busStopCheck(city),
    serviceColors: serviceColorCheck(palettes.sunny),
    expropriation: expropriationCheck(city),
    assignment: assignmentCheck(city),
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
  judgeTransit(String(N), report[N]);
  if (N > 32) {
    const { connection } = report[N];
    if (connection.partsWithRamps !== 1 || !connection.highwayMeetsArterial)
      problems.push(`${String(N)}.connection=${JSON.stringify(connection)}`);
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
