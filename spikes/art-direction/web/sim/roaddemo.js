import { interchangeLand, parkingObject, zoneShops } from './innerland.js';
import {
  connectRamps,
  ELEVATED,
  footprintCells,
  LANE,
  pierObject,
  rampLinks,
  template,
  templateGreens,
  templateParts,
  viaductKey,
} from './interchange.js';
import { specKey, traceRoads } from './city.js';
import { generateParcels, ZONE } from './parcels.js';
import { ringFootprint } from './roundabout.js';
import { roadWorld } from './terrainworld.js';
import { computeTraffic } from './traffic.js';

// 四级道路样张：一块平地上放齐三种快速路立交、一段高架、四车道接两车道的过渡，周围用普通路和物业填满。
// 丁字形立交不在这里，普通城市的默认场景里就有一个。
// 地面的路走普通路网；快速路主线和匝道是 lanes，每条 lane 是一串 [x, y, h]，车沿着它走。
// lane 和地面路网的衔接点写在 fromCell / toCell 上，lane 之间的并入和驶出写在 merge / exits 上。

const N = 48;
const HIGHWAY_ROW = 9;
const ARTERIAL_ROW = 28;
const STREET_ROWS = [19, 38];
const STREET_COLUMNS = [23, 38];
const EXPRESS_A = 14;
const EXPRESS_B = 30;
const DESCENT_START = 41;
const DESCENT_END = 44.5;
const GROUND_ROW = 44;
const PIER_MIN = 0.55;

/** 高架主线：向南、向北各一条 lane，高度沿 y 变化。 */
function expressLanes(x, y0, y1, heightAt) {
  const line = (offset, from, to) => {
    const points = [];
    const step = from < to ? 1 : -1;
    for (let y = from; step > 0 ? y <= to : y >= to; y += step)
      points.push([x + 0.5 + offset, y + 0.5, heightAt(y + 0.5)]);
    return points;
  };
  return {
    south: { id: `s${String(x)}`, kind: 'express', points: line(-LANE, y0, y1), exits: [] },
    north: { id: `n${String(x)}`, kind: 'express', points: line(LANE, y1, y0), exits: [] },
  };
}

function demoRoads() {
  const { roads, walk } = traceRoads(N);
  walk('highway', [
    [0, HIGHWAY_ROW],
    [N - 1, HIGHWAY_ROW],
  ]);
  walk('arterial', [
    [0, ARTERIAL_ROW],
    [40, ARTERIAL_ROW],
  ]);
  walk('road', [
    [40, ARTERIAL_ROW],
    [N - 1, ARTERIAL_ROW],
  ]);
  for (const y of STREET_ROWS)
    walk('road', [
      [20, y],
      [N - 1, y],
    ]);
  for (const x of STREET_COLUMNS)
    walk('road', [
      [x, STREET_ROWS[0]],
      [x, STREET_ROWS[1]],
    ]);
  for (const cx of [EXPRESS_A, EXPRESS_B]) {
    for (const stub of template('diamond').stubs)
      walk('arterial', [
        [cx + stub, ARTERIAL_ROW - 2],
        [cx + stub, ARTERIAL_ROW + 2],
      ]);
  }
  walk('highway', [
    [EXPRESS_B, GROUND_ROW],
    [EXPRESS_B, N - 1],
  ]);
  return roads;
}

const square = (x, y) => [
  [x, y],
  [x + 1, y],
  [x + 1, y + 1],
  [x, y + 1],
];

function demoGround() {
  const ground = [];
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      ground.push({ key: `g-0-0000-${String((x * 7 + y * 13) % 3)}`, x, y, level: 0 });
      if (x === N - 1) ground.push({ key: 'sk-x-0', x, y, level: 0 });
      if (y === N - 1) ground.push({ key: 'sk-z-0', x, y, level: 0 });
    }
  }
  return ground;
}

/** 高架主线的格子：桥面一格一个物体，路格里不立桥墩，隔一格立一根。 */
function viaductObjects(viaducts, roads) {
  const objects = [];
  for (const { x, y, h0, h1 } of viaducts) {
    objects.push({
      key: viaductKey(h0, h1),
      px: x + 0.5,
      py: y + 0.5,
      level: 0,
      base: Math.min(h0, h1),
      footprint: square(x, y),
    });
    const middle = (h0 + h1) / 2;
    if (!roads.has(y * N + x) && y % 2 === 0 && middle >= PIER_MIN)
      objects.push(pierObject({ x: 0, z: 0, h: middle, nx: 1, nz: 0 }, x, y));
  }
  return objects;
}

export function generateRoadDemo(seed = 11) {
  const roads = demoRoads();
  const flat = {
    cornersOf: () => [0, 0, 0, 0],
    levelOf: () => 0,
    isFlat: () => true,
    isWater: () => false,
  };
  const road = roadWorld({ N, roads, ...flat, gates: [], linked: false });
  const { sprites, rings } = road;

  const placed = [
    { name: 'cloverleaf', cx: EXPRESS_A, cy: HIGHWAY_ROW },
    { name: 'trumpet', cx: EXPRESS_B, cy: HIGHWAY_ROW },
    { name: 'diamond', cx: EXPRESS_A, cy: ARTERIAL_ROW },
    { name: 'diamond', cx: EXPRESS_B, cy: ARTERIAL_ROW },
  ];
  const reserved = new Set(rings.flatMap((ring) => ringFootprint(ring, N)));
  for (const { name, cx, cy } of placed) {
    for (const [x, y] of footprintCells(name, cx, cy, N)) reserved.add(y * N + x);
  }
  const covered = (x, y) =>
    placed.some(({ name, cx, cy }) => {
      const [x0, z0, x1, z1] = template(name).footprint;
      return x >= cx + x0 && x <= cx + x1 && y >= cy + z0 && y <= cy + z1;
    });

  const descent = (y) => {
    if (y <= DESCENT_START) return ELEVATED;
    if (y >= DESCENT_END) return 0;
    return (ELEVATED * (DESCENT_END - y)) / (DESCENT_END - DESCENT_START);
  };
  const viaducts = [];
  const addViaducts = (x, top, bottom, heightAt) => {
    for (let y = top; y <= bottom; y += 1) {
      if (covered(x, y)) continue;
      reserved.add(y * N + x);
      viaducts.push({ x, y, h0: heightAt(y), h1: heightAt(y + 1) });
    }
  };
  addViaducts(EXPRESS_A, 0, N - 1, () => ELEVATED);
  addViaducts(EXPRESS_B, HIGHWAY_ROW + 8, GROUND_ROW, descent);

  const lanes = [];
  const mainA = expressLanes(EXPRESS_A, 0, N - 1, () => ELEVATED);
  const mainB = expressLanes(EXPRESS_B, HIGHWAY_ROW + 1, N - 1, descent);
  lanes.push(mainA.south, mainA.north, mainB.south, mainB.north);
  for (const { name, cx, cy } of placed)
    connectRamps({ name, cx, cy, N, main: cx === EXPRESS_A ? mainA : mainB, lanes });
  for (const lane of lanes) lane.exits.sort((a, b) => a.at - b.at);
  const links = rampLinks(lanes);

  const land = interchangeLand(placed, roads, N);
  for (const id of land.shops) reserved.delete(id);
  const zones = new Uint8Array(N * N);
  const density = new Uint8Array(N * N);
  for (let y = 12; y < N - 1; y += 1) {
    for (let x = 18; x < N - 1; x += 1) {
      if (reserved.has(y * N + x) || roads.has(y * N + x)) continue;
      zones[y * N + x] = y < ARTERIAL_ROW ? ZONE.residential : ZONE.commercial;
      density[y * N + x] = 1 + ((x + y) % 2);
    }
  }
  zoneShops(land, zones, density);
  const result = generateParcels({
    N,
    roads,
    water: new Set(),
    slopes: new Set(),
    zones,
    density,
    seed,
    reserved,
  });
  const traffic = computeTraffic(result.parcels, roads, N, links);

  const parts = placed.map(({ name, cx, cy }) => templateParts(name, cx, cy));
  const objects = [
    ...parts.flatMap(({ high }) => high),
    ...land.parking.map(parkingObject),
    ...placed.flatMap(({ name, cx, cy }) =>
      templateGreens(name, cx, cy, { roads, N, taken: land.taken }),
    ),
    ...viaductObjects(viaducts, roads),
  ];
  for (const parcel of result.parcels) {
    if (parcel.shape === 'field') continue;
    objects.push({
      key: specKey(parcel),
      px: parcel.px,
      py: parcel.py,
      level: 0,
      footprint: parcel.polygon,
      parcel: parcel.id,
    });
  }
  return {
    N,
    ground: demoGround(),
    overlays: [],
    objects,
    icons: [],
    walks: sprites.walks,
    curbs: sprites.curbs,
    decks: [...sprites.decks, ...parts.flatMap(({ low }) => low)],
    marks: road.marks,
    surface: road.surface,
    rings,
    junctions: road.junctions,
    lanes,
    links,
    parcels: result,
    traffic,
    roads,
    reserved,
    interchangeLand: land,
    ...flat,
    plan: { gates: [] },
    coverage: { rows: [], blindShare: 0 },
    metro: { lines: [], crossings: [], halls: [] },
  };
}
