import { ELEVATED, LANE, template } from './interchange.js';
import { footprintKey, specKey, traceRoads } from './city.js';
import { generateParcels, ZONE } from './parcels.js';
import { roadSprites } from './roadsprites.js';
import { computeTraffic } from './traffic.js';

// 四级道路样张：一块平地上放齐三种立交、一段高架、四车道接两车道的过渡，周围用普通路和物业填满。
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

function worldRamp(points, cx, cy) {
  return points.map(([x, z, h]) => [x + cx + 0.5, z + cy + 0.5, h]);
}

function reserveTemplate(reserved, name, cx, cy) {
  const [x0, z0, x1, z1] = template(name).footprint;
  for (let y = cy + z0; y <= cy + z1; y += 1) {
    for (let x = cx + x0; x <= cx + x1; x += 1) {
      if (x >= 0 && y >= 0 && x < N && y < N) reserved.add(y * N + x);
    }
  }
}

function cellOfPoint(x, y) {
  return Math.floor(y) * N + Math.floor(x);
}

/** 高架主线：向南、向北各一条 lane，高度沿 y 变化。 */
function expressLanes(x, y0, y1, heightAt) {
  const line = (offset, from, to) => {
    const points = [];
    const step = from < to ? 1 : -1;
    for (let y = from; step > 0 ? y <= to : y >= to; y += step) points.push([x + 0.5 + offset, y + 0.5, heightAt(y + 0.5)]);
    return points;
  };
  return {
    south: { id: `s${String(x)}`, kind: 'express', points: line(-LANE, y0, y1), exits: [] },
    north: { id: `n${String(x)}`, kind: 'express', points: line(LANE, y1, y0), exits: [] },
  };
}

function station(lane, x, y) {
  let best = 0;
  let bestDistance = Infinity;
  lane.points.forEach(([px, py], i) => {
    const d = Math.hypot(px - x, py - y);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}

/** 把模板的匝道接到主线和地面路网上：端点高度为 0 的一头接地面，在高架上的一头接主线。 */
function connectRamps(name, cx, cy, mainSouth, mainNorth, lanes) {
  template(name).ramps().forEach((ramp, index) => {
    const points = worldRamp(ramp.points, cx, cy);
    const first = points[0];
    const last = points[points.length - 1];
    const lane = { id: `${name}${String(cx)}-${String(index)}`, kind: 'ramp', points, exits: [] };
    if (first[2] < 0.5) lane.fromCell = cellOfPoint(first[0], first[1]);
    else {
      const main = first[0] < cx + 0.5 ? mainSouth : mainNorth;
      main.exits.push({ at: station(main, first[0], first[1]), lane: lane.id });
    }
    if (last[2] < 0.5) lane.toCell = cellOfPoint(last[0], last[1]);
    else {
      const main = last[0] < cx + 0.5 ? mainSouth : mainNorth;
      lane.merge = { lane: main.id, at: station(main, last[0], last[1]) };
    }
    lanes.push(lane);
  });
}

export function generateRoadDemo(seed = 11) {
  const { roads, walk } = traceRoads(N);
  walk('highway', [[0, HIGHWAY_ROW], [N - 1, HIGHWAY_ROW]]);
  walk('arterial', [[0, ARTERIAL_ROW], [40, ARTERIAL_ROW]]);
  walk('road', [[40, ARTERIAL_ROW], [N - 1, ARTERIAL_ROW]]);
  for (const y of STREET_ROWS) walk('road', [[20, y], [N - 1, y]]);
  for (const x of STREET_COLUMNS) walk('road', [[x, STREET_ROWS[0]], [x, STREET_ROWS[1]]]);
  for (const cx of [EXPRESS_A, EXPRESS_B]) {
    for (const stub of template('diamond').stubs) walk('road', [[cx + stub, ARTERIAL_ROW - 2], [cx + stub, ARTERIAL_ROW + 2]]);
  }
  walk('highway', [[EXPRESS_B, GROUND_ROW], [EXPRESS_B, N - 1]]);

  const placed = [
    ['cloverleaf', EXPRESS_A, HIGHWAY_ROW],
    ['trumpet', EXPRESS_B, HIGHWAY_ROW],
    ['diamond', EXPRESS_A, ARTERIAL_ROW],
    ['diamond', EXPRESS_B, ARTERIAL_ROW],
  ];
  const reserved = new Set();
  for (const [name, cx, cy] of placed) reserveTemplate(reserved, name, cx, cy);
  const covered = (x, y) => placed.some(([name, cx, cy]) => {
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
  for (const [name, cx, cy] of placed) {
    const [south, north] = cx === EXPRESS_A ? [mainA.south, mainA.north] : [mainB.south, mainB.north];
    connectRamps(name, cx, cy, south, north, lanes);
  }
  for (const lane of lanes) lane.exits.sort((a, b) => a.at - b.at);

  const zones = new Uint8Array(N * N);
  const density = new Uint8Array(N * N);
  for (let y = 12; y < N - 1; y += 1) {
    for (let x = 18; x < N - 1; x += 1) {
      if (reserved.has(y * N + x) || roads.has(y * N + x)) continue;
      zones[y * N + x] = y < ARTERIAL_ROW ? ZONE.residential : ZONE.commercial;
      density[y * N + x] = 1 + ((x + y) % 2);
    }
  }
  const flat = () => [0, 0, 0, 0];
  const result = generateParcels({ N, roads, water: new Set(), slopes: new Set(), zones, density, seed, reserved });
  const traffic = computeTraffic(result.parcels, roads, N);
  const sprites = roadSprites({ N, roads, cornersOf: flat, isFlat: () => true, levelOf: () => 0, isWater: () => false });

  const ground = [];
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      ground.push({ key: `g-0-0000-${String((x * 7 + y * 13) % 3)}`, x, y, level: 0 });
      if (x === N - 1) ground.push({ key: 'sk-x-0', x, y, level: 0 });
      if (y === N - 1) ground.push({ key: 'sk-z-0', x, y, level: 0 });
    }
  }
  const objects = [];
  const square = (x, y) => [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
  for (const [name, cx, cy] of placed) {
    const [x0, z0, x1, z1] = template(name).footprint;
    objects.push({
      key: `ix-${name}`,
      px: cx + 0.5,
      py: cy + 0.5,
      level: 0,
      footprint: [[cx + x0, cy + z0], [cx + x1 + 1, cy + z0], [cx + x1 + 1, cy + z1 + 1], [cx + x0, cy + z1 + 1]],
    });
  }
  for (const { x, y, h0, h1 } of viaducts) {
    objects.push({ key: `ev-z-${String(Math.round(h0 * 100))}-${String(Math.round(h1 * 100))}`, px: x + 0.5, py: y + 0.5, level: 0, footprint: square(x, y) });
  }
  for (const parcel of result.parcels) {
    if (parcel.shape === 'field') continue;
    objects.push({ key: specKey(parcel), px: parcel.px, py: parcel.py, level: 0, footprint: parcel.polygon, footprintKey: footprintKey(parcel), parcel: parcel.id, festive: false });
  }
  return {
    N,
    ground,
    overlays: [],
    objects,
    walks: sprites.walks,
    curbs: sprites.curbs,
    decks: sprites.decks,
    neighbors: [],
    lanes,
    parcels: result,
    traffic,
    roads,
    reserved,
    levelOf: () => 0,
    plan: { gates: [] },
    coverage: { rows: [], blindShare: 0 },
    metro: { lines: [], crossings: [] },
  };
}
