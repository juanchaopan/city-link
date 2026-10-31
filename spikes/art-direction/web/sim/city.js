import { chooseLooks, repeatedNeighbors } from './appearance.js';
import { buildRoads, makeZones, terrain, traceRoads, valueNoise } from './citymap.js';
import { COMBOS, modulesOf } from './combos.js';
import { interchangeLand, parkingObject, zoneShops } from './innerland.js';
import {
  connectRamps,
  footprintCells,
  rampLinks,
  templateGreens,
  templateParts,
} from './interchange.js';
import { clearLots } from './lotclear.js';
import { DIRECTIONS } from './network.js';
import { metroPlan, placeHalls } from './metro.js';
import { generateParcels, ZONE } from './parcels.js';
import { ringFootprint } from './roundabout.js';
import { coverageOf, SERVICES } from './services.js';
import { shapeOf } from './surface.js';
import { roadWorld, terrainOf } from './terrainworld.js';
import { computeTraffic } from './traffic.js';
import { busStops } from './transit.js';
import { viaductWorld } from './viaduct.js';

// 示例城市的生成流程：布局来自 citymap.js，地块和建筑规格全部由地块生成器长出来。
// 这里只输出规格，不知道风格。规格到素材的映射在风格包里。

export { traceRoads };

const RAMP_CHANCE_FLOOR = 0.1;
const RAMP_CHANCE_SCALE = 2;
const RAMP_CHANCE_CEILING = 0.7;
const ICON_LIFT = 1.4;

function bits(list) {
  return list.map((v) => (v ? '1' : '0')).join('');
}

const ZONE_LETTER = { [ZONE.residential]: 'r', [ZONE.commercial]: 'c', [ZONE.industrial]: 'i' };

/** 物业规格的名字。它决定占地和玩法，换风格时这个名字不变。 */
export function specKey(parcel) {
  const letter = ZONE_LETTER[parcel.zone];
  const size = `${String(parcel.spanU)}x${String(parcel.spanV)}`;
  if (parcel.shape === 'bigTriangle')
    return `Q-${letter}${String(parcel.level)}-${String(parcel.spanU)}-${parcel.orient}-${String(parcel.variant)}`;
  if (parcel.shape === 'farmhouse') return `farmhouse-${String(parcel.variant)}`;
  // 地块的朝向按直角所在的象限数，小三角的精灵按四个角点数，两边差一位。
  if (parcel.shape === 'triangle')
    return `t-${parcel.use}-${String((Number(parcel.orient) + 3) % 4)}-${String(parcel.variant)}`;
  if (parcel.shape === 'green')
    return parcel.use === 'lawn'
      ? `P-park-1x1-${String(parcel.variant)}`
      : `t-${parcel.use}-${parcel.orient}-${String(parcel.variant)}`;
  if (parcel.shape === 'service') return `S-${parcel.use}-${size}`;
  if (parcel.shape === 'public') return `P-${parcel.use}-${size}-${String(parcel.variant)}`;
  return `B-${letter}${String(parcel.level)}-${size}-${parcel.orient}-${String(parcel.variant)}`;
}

/** 走模块拼装的物业：2×2 的直角地块和直角边 3 格的大三角地块，中高密度的住宅和商业。 */
function modularSize(parcel) {
  if (parcel.zone !== ZONE.residential && parcel.zone !== ZONE.commercial) return null;
  if (parcel.level < 2) return null;
  if (parcel.shape === 'rect' && parcel.spanU === 2 && parcel.spanV === 2) return '2x2';
  if (parcel.shape === 'bigTriangle' && parcel.spanU === 3) return 'Q3';
  return null;
}

function groundEntries(N, { levelOf, cornersOf, isWater }) {
  const ground = [];
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const level = levelOf(x, y);
      if (isWater(x, y)) {
        ground.push({ key: `w-${String((x * 3 + y * 5) % 3)}`, x, y, level: 0 });
      } else {
        const sides = [isWater(x - 1, y), isWater(x + 1, y), isWater(x, y - 1), isWater(x, y + 1)];
        const diag = [
          isWater(x - 1, y - 1),
          isWater(x + 1, y - 1),
          isWater(x + 1, y + 1),
          isWater(x - 1, y + 1),
        ];
        if (sides.some(Boolean) || diag.some(Boolean)) {
          ground.push({ key: `b-${bits(sides)}-${bits(diag)}`, x, y, level: 0 });
        } else {
          const shape = shapeOf(cornersOf(x, y), level);
          ground.push({
            key: `g-${String(Math.min(3, level))}-${shape}-${String((x * 7 + y * 13) % 3)}`,
            x,
            y,
            level,
          });
        }
      }
      if (x === N - 1) ground.push({ key: `sk-x-${isWater(x, y) ? '1' : '0'}`, x, y, level: 0 });
      if (y === N - 1) ground.push({ key: `sk-z-${isWater(x, y) ? '1' : '0'}`, x, y, level: 0 });
    }
  }
  return ground;
}

const cellSquare = (x, y) => [
  [x, y],
  [x + 1, y],
  [x + 1, y + 1],
  [x, y + 1],
];

/** 把分配到的流量写回车道：负载比决定这条车道上该有多少车，也决定车上下匝道的概率。 */
function applyFlows(lanes, traffic) {
  for (const lane of lanes) {
    lane.ratio = traffic.laneRatios.get(lane.id) ?? 0;
    if (lane.kind !== 'ramp') continue;
    const chance = RAMP_CHANCE_FLOOR + lane.ratio * RAMP_CHANCE_SCALE;
    lane.chance = Math.min(RAMP_CHANCE_CEILING, chance);
  }
}

/** 公共服务的图标牌，运行时按缩放保持屏幕大小。 */
function serviceIcons(parcels) {
  const uses = new Set(SERVICES.map(({ id }) => id));
  return parcels
    .filter(({ shape, use }) => shape === 'service' && uses.has(use))
    .map(({ use, px, py }) => ({ key: `si-${use}`, use, px, py, level: ICON_LIFT }));
}

export function generateCity(N, seed = 11, publicLayout = 'spread', linked = false) {
  const s = N / 32;
  const center = Math.round(N / 2);
  const riverAt = (x) => Math.round(center + 9 * s + 2 * s * Math.sin((x / N) * Math.PI * 2 + 0.7));
  const plan = buildRoads(N, s, center, riverAt);
  const { roads, right, south, ringRow, ringColumn, interchange, gates } = plan;
  const interchangeCells = interchange
    ? footprintCells(interchange.name, interchange.cx, interchange.cy, N)
    : [];
  const { h, water, corner } = terrain(N, s, riverAt, (flatten) => {
    for (let y = ringRow - 1; y <= south + 1; y += 1) {
      for (let x = ringColumn - 1; x <= right + 1; x += 1) flatten(x, y, 0);
    }
    for (const [x, y] of interchangeCells) flatten(x, y, 0);
  });
  const isWater = (x, y) => x >= 0 && y >= 0 && x < N && y < N && water.has(y * N + x);
  const { cornersOf, levelOf, isFlat } = terrainOf({
    N,
    roads,
    corner: (x, y) => h[corner(x, y)],
    isWater,
  });

  const slopes = new Set();
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) if (!isFlat(x, y)) slopes.add(y * N + x);
  }
  const road = roadWorld({ N, roads, cornersOf, levelOf, isFlat, isWater, gates, linked });
  const { sprites, surface, rings, blockedRings, junctions, marks } = road;
  const viaduct = plan.viaduct ? viaductWorld(plan.viaduct, roads, N) : null;
  const placed = [...(interchange ? [interchange] : []), ...(viaduct?.placed ?? [])];
  const land = interchangeLand(placed, roads, N);
  const reserved = new Set([
    ...interchangeCells.map(([x, y]) => y * N + x),
    ...rings.flatMap((ring) => ringFootprint(ring, N)),
    ...(viaduct?.reserved ?? []),
  ]);
  for (const id of land.shops) reserved.delete(id);
  const lanes = [];
  if (interchange) connectRamps({ ...interchange, N, lanes });
  if (viaduct) lanes.push(...viaduct.lanes);
  const links = [...rampLinks(lanes), ...(viaduct?.links ?? [])];

  const metro = metroPlan(plan);
  const isFree = (x, y) =>
    x > 0 &&
    y > 0 &&
    x < N - 1 &&
    y < N - 1 &&
    !roads.has(y * N + x) &&
    !reserved.has(y * N + x) &&
    !water.has(y * N + x) &&
    isFlat(x, y);
  for (const { id } of placeHalls(metro, { N, roads, isFree })) reserved.add(id);

  const usable = (x, y) =>
    x > 0 && y > 0 && x < N - 1 && y < N - 1 && !water.has(y * N + x) && isFlat(x, y);
  const { zones, density } = makeZones(N, s, center, riverAt, plan, usable, publicLayout);
  zoneShops(land, zones, density);
  const result = generateParcels({ N, roads, water, slopes, zones, density, seed, reserved });
  const clearedLots = clearLots(result.parcels, junctions.field);
  const gateCells = gates.map(({ x, y }) => y * N + x);
  const traffic = computeTraffic(result.parcels, roads, N, links, gateCells);
  applyFlows(lanes, traffic);
  const coverage = coverageOf(result.parcels, result.services, roads, N);

  // 外观在规格之外单独选，同规格的相邻物业不重复；外观不影响面积、容量和结算。
  const buildings = result.parcels.filter(
    (parcel) =>
      parcel.shape === 'rect' || parcel.shape === 'diagonal' || parcel.shape === 'bigTriangle',
  );
  const lookBefore = repeatedNeighbors(buildings, (parcel) => parcel.variant);
  const looks = chooseLooks(buildings, seed, (parcel) => (modularSize(parcel) ? COMBOS.length : 2));
  for (const parcel of buildings) if (!modularSize(parcel)) parcel.variant = looks.get(parcel.id);
  const lookAfter = repeatedNeighbors(buildings, (parcel) => looks.get(parcel.id));

  const ground = groundEntries(N, { levelOf, cornersOf, isWater });
  const overlays = [];
  const objects = [];
  const addObject = (key, px, py, level, footprint, extra = {}) =>
    objects.push({ key, px, py, level, footprint, ...extra });

  for (const { key, x, y } of sprites.bridges)
    addObject(key, x + 0.5, y + 0.5, 0, cellSquare(x, y));
  for (const { key, x, y, level } of sprites.planned)
    addObject(key, x + 0.5, y + 0.5, level, cellSquare(x, y));
  const teeParts = interchange
    ? templateParts(interchange.name, interchange.cx, interchange.cy)
    : { low: [], high: [] };
  const lowDecks = [...teeParts.low, ...(viaduct?.low ?? [])];
  objects.push(...teeParts.high, ...(viaduct?.objects ?? []));
  objects.push(...land.parking.map(parkingObject));
  for (const { name, cx, cy } of placed)
    objects.push(...templateGreens(name, cx, cy, { roads, N, taken: land.taken }));
  for (const { x, y, side } of metro.halls)
    addObject(`ms-${String(side)}`, x + 0.5, y + 0.5, levelOf(x, y), cellSquare(x, y));
  const stops = busStops({ N, roads, junctions, isFlat });
  objects.push(...stops);

  const crops = valueNoise(41);
  for (const parcel of result.parcels) {
    const level = levelOf(Math.floor(parcel.px), Math.floor(parcel.py));
    if (parcel.use === 'bare') continue;
    if (parcel.shape === 'field') {
      for (const id of parcel.cells) {
        const x = id % N;
        const y = Math.floor(id / N);
        const crop = Math.floor(crops(x / 6, y / 6) * 5) % 4;
        const axis = crops(x / 9 + 7, y / 9) < 0.5 ? 'x' : 'z';
        overlays.push({ key: `f-${String(crop)}-${axis}`, x, y, level: levelOf(x, y) });
      }
    } else {
      const size = modularSize(parcel);
      const modules = size
        ? modulesOf(COMBOS[looks.get(parcel.id)], size, Number(parcel.orient) || 0)
        : null;
      addObject(specKey(parcel), parcel.px, parcel.py, level, parcel.polygon, {
        parcel: parcel.id,
        modules,
      });
    }
  }

  const noise = valueNoise(11);
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const id = y * N + x;
      if (water.has(id) || roads.has(id) || reserved.has(id) || land.taken.has(id)) continue;
      if ([0, 1, 2, 3].some((q) => result.atomOwner[id * 4 + q] >= 0)) continue;
      const level = levelOf(x, y);
      const flat = isFlat(x, y);
      const nearRoad =
        DIRECTIONS.some(([dx, dy]) => roads.has((y + dy) * N + x + dx)) ||
        [-2, 2].some((d) => roads.has(y * N + x + d) || roads.has((y + d) * N + x));
      const wooded = noise(x / 4 + 9, y / 4 + 3);
      if ((wooded > 0.5 || (level > 0 && wooded > 0.32)) && !nearRoad) {
        const lift = flat ? level : cornersOf(x, y).reduce((a, b) => a + b, 0) / 4;
        addObject(
          `forest-${String((x + y) % 4)}-${String(3 + Math.floor(wooded * 6))}`,
          x + 0.5,
          y + 0.5,
          lift,
          cellSquare(x, y),
        );
      } else if (flat && !nearRoad && (x * 5 + y * 3) % 4 === 0) {
        overlays.push({ key: `m-${String((x + y) % 3)}`, x, y, level });
      }
    }
  }

  for (let x = 2; x < N - 2; x += Math.round(9 * s)) {
    const r = riverAt(x);
    if (!roads.has(r * N + x))
      addObject(`boat-${x % 2 === 0 ? '0' : '4'}`, x + 0.5, r + 0.5, 0, cellSquare(x, r));
  }
  const dockX = Math.round(center + 6 * s) + 1;
  addObject(
    'dock-0',
    dockX + 0.5,
    riverAt(dockX) - 0.5,
    0,
    cellSquare(dockX, riverAt(dockX) - 1),
  );

  return {
    N,
    ground,
    overlays,
    objects,
    icons: serviceIcons(result.parcels),
    walks: sprites.walks,
    curbs: sprites.curbs,
    decks: [...sprites.decks, ...lowDecks],
    lowDecks,
    marks,
    roadCells: sprites.cells,
    grades: sprites.grades,
    surface,
    rings,
    blockedRings,
    clearedLots,
    junctions,
    parcels: result,
    traffic,
    gateCells,
    coverage,
    metro,
    busStops: stops,
    roads,
    lanes,
    links,
    viaduct,
    interchangeLand: land,
    reserved,
    water,
    slopes,
    zones,
    density,
    plan,
    levelOf,
    cornersOf,
    isFlat,
    isWater,
    looks: {
      before: lookBefore,
      after: lookAfter,
      modular: objects.filter((object) => object.modules).length,
    },
  };
}

export function keysOf(city) {
  const keys = [
    ...city.ground,
    ...city.overlays,
    ...city.walks,
    ...city.curbs,
    ...city.decks,
    ...city.marks,
    ...city.objects,
  ].map((entry) => entry.key);
  for (const object of city.objects) for (const part of object.modules ?? []) keys.push(part.key);
  return keys;
}
