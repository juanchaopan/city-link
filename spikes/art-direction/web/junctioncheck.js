import { buildObject } from './kit/objects.js';
import { palettes } from './kit/palettes.js';
import { JUNCTION_CASES } from './junctioncases.js';
import { CLASS, compose, MASK, readerOf, spriteOf, worldOf, worldOfCity } from './roadscene.js';
import { footprintKey, generateCity, specKey } from './sim/city.js';
import { createFleet } from './sim/fleet.js';
import { crossingsOf, junctionLegs } from './sim/crossings.js';
import { cellPaths, DIRECTIONS, ROAD_SPEC, spokesOf } from './sim/network.js';
import { generateParcels, ZONE } from './sim/parcels.js';
import { computeTraffic } from './sim/traffic.js';

// 路口验收：看成品。场景按游戏流程生成，路面按真实烘焙拼到一张遮罩上，灯杆、斑马线端点、车脚点和地块的地面轮廓
// 都换算成屏幕像素，直接读那个像素属于哪一层，不靠几何推断。
// 地块的地面轮廓是建筑模型里贴地的三角形（地台和铺装），楼身不算，高楼挡住后面的路是正常的。

const CASE_SIZE = 16;
const RUN_STEPS = 700;
const SAMPLE_EVERY = 35;
const DT = 0.05;
const GROUND_Y = 0.03;
const GROUND_STEP = 0.05;
const SLOPE_SAMPLE = 0.25;
const MAX_HEADING = 8;
const MAX_FACE_PIXELS = 4;
const JUNCTION_REACH = 1.3;

/** 可重复的随机数，同一个场景每次跑的结果一样。 */
function randomFrom(seed) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

function caseParcels(world) {
  const { N, roads } = world;
  const zones = new Uint8Array(N * N).fill(ZONE.commercial);
  const density = new Uint8Array(N * N).fill(1);
  return generateParcels({ N, roads, water: new Set(), slopes: new Set(), zones, density, seed: 11 });
}

function townOf(entry) {
  const world = worldOf({ N: CASE_SIZE, ...entry });
  const parcels = entry.lots ? caseParcels(world) : null;
  const objects = (parcels?.parcels ?? [])
    .filter((parcel) => parcel.shape !== 'field')
    .map((parcel) => ({
      key: specKey(parcel),
      px: parcel.px,
      py: parcel.py,
      level: 0,
      footprintKey: footprintKey(parcel),
    }));
  const traffic = computeTraffic([], world.roads, CASE_SIZE);
  return { ...world, objects, traffic, lanes: [] };
}

function townOfCity(city) {
  return { ...worldOfCity(city, false), objects: city.objects, traffic: city.traffic, lanes: [] };
}

function cellOf(point, N) {
  return Math.floor(point[1]) * N + Math.floor(point[0]);
}

/** 灯杆底部要落在人行道或路缘上。落在车道上是最坏的情况，落到路外说明高度或位置错了。 */
function checkPoles(fleet, scene) {
  const result = { poles: fleet.signals.length, polesOnDeck: 0, polesOffRoad: 0, examples: [] };
  for (const { px, py, level } of fleet.signals) {
    const [sx, sy] = scene.place.at(px, py, level);
    const found = scene.read(Math.round(sx), Math.round(sy));
    if (found === CLASS.walk || found === CLASS.curb) continue;
    if (found === CLASS.deck) result.polesOnDeck += 1;
    else result.polesOffRoad += 1;
    if (result.examples.length < 4) result.examples.push(['灯杆', px, py, level, found]);
  }
  return result;
}

/** 逐条腿核对：每条腿一条斑马线，两端都在人行道上，中间是车道。少一条就算不通过。 */
function checkCrossings(town, scene) {
  const { crossings, interior } = crossingsOf(town);
  const legs = junctionLegs(town);
  const result = {
    legs: legs.length,
    crossings: crossings.length,
    missingCrossings: 0,
    crossingEndsOff: 0,
    interiorCrossings: interior,
    examples: [],
  };
  const has = new Set(crossings.map(({ junction, dir }) => `${String(junction)}:${String(dir)}`));
  for (const { junction, dir } of legs) {
    if (has.has(`${String(junction)}:${String(dir)}`)) continue;
    result.missingCrossings += 1;
    if (result.examples.length < 4) result.examples.push(['缺斑马线', junction, dir]);
  }
  for (const { ends, level, junction, dir } of crossings) {
    for (const [px, py] of ends) {
      const [sx, sy] = scene.place.at(px, py, level);
      const found = scene.read(Math.round(sx), Math.round(sy));
      if (found === CLASS.walk || found === CLASS.curb) continue;
      result.crossingEndsOff += 1;
      if (result.examples.length < 4) result.examples.push(['端点', junction, dir, px, py, found]);
    }
  }
  return result;
}

/** 红灯时停着的车：车身不能压进路口里的其他路，也不能压在斑马线上。 */
function stoppedInJunction(car, town, bands) {
  const { N, roads } = town;
  const cell = cellOf([car.x, car.y], N);
  for (const band of bands) {
    if (Math.abs(band.x - car.x) > JUNCTION_REACH || Math.abs(band.y - car.y) > JUNCTION_REACH) continue;
    if (Math.hypot(band.x - car.x, band.y - car.y) < band.reach) return true;
  }
  void cell;
  void roads;
  return false;
}

/** 让车流跑一段时间，抽样检查车脚点和停着的车。 */
function checkCars(town, scene) {
  const fleet = createFleet(town, { cap: 80, full: true, random: randomFrom(7) });
  const bands = junctionLegs(town).reduce((list, { x, y, core }) => {
    list.push({ x, y, reach: core });
    return list;
  }, []);
  const result = { carSamples: 0, carsOffRoad: 0, stoppedSamples: 0, stoppedInJunction: 0, examples: [] };
  for (let i = 0; i < RUN_STEPS; i += 1) {
    fleet.step(DT);
    if (i % SAMPLE_EVERY !== SAMPLE_EVERY - 1) continue;
    for (const car of fleet.cars) {
      if (car.x === undefined || car.high) continue;
      const [sx, sy] = scene.place.at(car.x, car.y, car.h);
      const found = scene.read(Math.round(sx), Math.round(sy));
      result.carSamples += 1;
      if (found !== CLASS.deck) {
        result.carsOffRoad += 1;
        if (result.examples.length < 4) result.examples.push(['车脚', car.x, car.y, car.h, found]);
      }
      if (car.waiting ?? car.speed < 0.02) {
        result.stoppedSamples += 1;
        if (stoppedInJunction(car, town, bands)) {
          result.stoppedInJunction += 1;
          if (result.examples.length < 4) result.examples.push(['停车', car.x, car.y]);
        }
      }
    }
  }
  return result;
}

const groundCache = new Map();

/** 物业的地面轮廓：模型里贴地的三角形，在局部坐标里铺一层采样点。 */
function groundSamples(key) {
  if (!groundCache.has(key)) {
    const { positions } = buildObject(key, palettes.sunny);
    const samples = [];
    for (let i = 0; i < positions.length; i += 9) {
      const points = [0, 3, 6].map((k) => [positions[i + k], positions[i + k + 1], positions[i + k + 2]]);
      if (points.some(([, y]) => y > GROUND_Y)) continue;
      const [a, b, c] = points;
      const longest = Math.max(Math.hypot(b[0] - a[0], b[2] - a[2]), Math.hypot(c[0] - a[0], c[2] - a[2]));
      const steps = Math.max(1, Math.ceil(longest / GROUND_STEP));
      for (let u = 0; u <= steps; u += 1) {
        for (let v = 0; v <= steps - u; v += 1) {
          const s = u / steps;
          const t = v / steps;
          samples.push([a[0] + (b[0] - a[0]) * s + (c[0] - a[0]) * t, a[2] + (b[2] - a[2]) * s + (c[2] - a[2]) * t]);
        }
      }
    }
    groundCache.set(key, samples);
  }
  return groundCache.get(key);
}

const OWNS_GROUND = /^(B|Q|S|P|t|farmhouse)(-|$)/;

function checkLots(town, scene) {
  const result = { lots: 0, lotsOnRoad: 0, lotPixels: 0, examples: [] };
  for (const { key, px, py, level } of town.objects) {
    if (!OWNS_GROUND.test(key)) continue;
    result.lots += 1;
    let hits = 0;
    for (const [u, v] of groundSamples(key)) {
      const [sx, sy] = scene.place.at(px + u, py + v, level);
      const found = scene.read(Math.round(sx), Math.round(sy));
      if (found === CLASS.deck || found === CLASS.walk || found === CLASS.curb) hits += 1;
    }
    if (hits > 0) {
      result.lotsOnRoad += 1;
      result.lotPixels += hits;
      if (result.examples.length < 4) result.examples.push(['地块压路', key, px, py, hits]);
    }
  }
  return result;
}

/** 坡路的路面边缘到地面的高差，单位是屏幕像素。路贴在地上时这个数很小，腾空时就是一道看得见的竖面。 */
function checkHang(town) {
  const { N, sprites, cornersOf, levelOf } = town;
  const result = { slopeCells: sprites.grades.size, worstHang: 0, hangingEdges: 0 };
  const planeAt = ([a, b, c, d], u, v) => a * (1 - u) * (1 - v) + b * u * (1 - v) + c * u * v + d * (1 - u) * v;
  for (const [id, grade] of sprites.grades) {
    const x = id % N;
    const y = Math.floor(id / N);
    const { road, highway, arterial } = sprites.cells.get(id);
    const [path] = cellPaths(road, highway, arterial);
    const [a, c] = [path.points[0], path.points[path.points.length - 1]];
    const length = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const nx = -(c[1] - a[1]) / length;
    const nz = (c[0] - a[0]) / length;
    const half = ROAD_SPEC[path.kind].walk / 2 + 0.04;
    const corners = cornersOf(x, y);
    for (let t = 0; t <= 1; t += SLOPE_SAMPLE) {
      const [h0, h1, m0, m1] = grade;
      const t2 = t * t;
      const t3 = t2 * t;
      const deck = levelOf(x, y) + (2 * t3 - 3 * t2 + 1) * h0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * h1 + (t3 - t2) * m1;
      for (const side of [1, -1]) {
        const u = a[0] + (c[0] - a[0]) * t + nx * side * half + 0.5;
        const v = a[1] + (c[1] - a[1]) * t + nz * side * half + 0.5;
        const gap = Math.abs(deck - planeAt(corners, u, v)) * 32;
        result.worstHang = Math.max(result.worstHang, gap);
        if (gap > MAX_FACE_PIXELS) result.hangingEdges += 1;
      }
    }
  }
  result.worstHang = Math.round(result.worstHang * 10) / 10;
  return result;
}

function screenVector(dx, dy, dh) {
  return [(dx - dy) * 64, (dx + dy) * 32 - dh * 32];
}

function tangentOf(car) {
  const { points, along } = car.path;
  let i = 0;
  while (i < points.length - 2 && along[i + 1] < car.s) i += 1;
  return [points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1], points[i + 1][2] - points[i][2]];
}

/** 车身精灵在屏幕上的朝向和路面切线的夹角，度。 */
function headingError(car) {
  const angle = (car.rotation * Math.PI) / 4;
  const [ax, ay] = screenVector(Math.cos(angle), -Math.sin(angle), 0);
  const [dx, dy, dh] = tangentOf(car);
  const [bx, by] = screenVector(dx, dy, dh);
  const body = Math.atan2(ay, ax) + (car.tilt ?? 0);
  const road = Math.atan2(by, bx);
  let difference = Math.abs(road - body) % (Math.PI * 2);
  if (difference > Math.PI) difference = Math.PI * 2 - difference;
  return (difference * 180) / Math.PI;
}

function checkHeading(town) {
  const fleet = createFleet(town, { cap: 80, full: true, random: randomFrom(9) });
  const result = { headingSamples: 0, headingOff: 0, worstHeading: 0 };
  for (let i = 0; i < RUN_STEPS; i += 1) {
    fleet.step(DT);
    if (i % SAMPLE_EVERY !== SAMPLE_EVERY - 1) continue;
    for (const car of fleet.cars) {
      if (car.x === undefined || car.speed < 0.02 || !car.path) continue;
      const error = headingError(car);
      result.headingSamples += 1;
      result.worstHeading = Math.max(result.worstHeading, error);
      if (error > MAX_HEADING) result.headingOff += 1;
    }
  }
  result.worstHeading = Math.round(result.worstHeading * 10) / 10;
  return result;
}

function inspect(town) {
  const { canvas, context, place } = compose(town, MASK, 'current', { withGround: false });
  const read = readerOf(context, canvas.width, canvas.height);
  const scene = { read, place };
  const fleet = createFleet(town, { cap: 1, random: randomFrom(3) });
  const parts = [
    checkPoles(fleet, scene),
    checkCrossings(town, scene),
    checkCars(town, scene),
    checkLots(town, scene),
    checkHang(town),
    checkHeading(town),
  ];
  const row = Object.assign({}, ...parts);
  row.examples = parts.flatMap((part) => part.examples ?? []).slice(0, 8);
  return row;
}

const FAILURES = [
  'polesOnDeck',
  'polesOffRoad',
  'missingCrossings',
  'crossingEndsOff',
  'interiorCrossings',
  'carsOffRoad',
  'stoppedInJunction',
  'lotsOnRoad',
  'hangingEdges',
  'headingOff',
];

window.runJunctionChecks = (withCity = true) => {
  const rows = JUNCTION_CASES.map((entry) => ({ name: entry.name, ...inspect(townOf(entry)) }));
  if (withCity) rows.push({ name: '全图 64×64', ...inspect(townOfCity(generateCity(64))) });
  for (const row of rows) row.pass = FAILURES.every((key) => row[key] === 0);
  return { rows, failures: FAILURES };
};

/** 真实配色的成品：地面、路面、物业、灯杆和车，从下往上画。 */
function renderTown(town) {
  const { canvas, context, place } = compose(town, palettes.sunny, 'current', { withGround: true });
  const stamp = (key, px, py, level) => {
    const sprite = spriteOf(key, palettes.sunny);
    const [sx, sy] = place.at(px, py, level);
    context.drawImage(sprite.canvas, Math.round(sx - sprite.ax), Math.round(sy - sprite.ay));
  };
  for (const { key, x, y, level } of town.marks ?? []) stamp(key, x + 0.5, y + 0.5, level);
  const fleet = createFleet(town, { cap: 40, full: true, random: randomFrom(5) });
  for (let i = 0; i < 400; i += 1) fleet.step(DT);
  const objects = town.objects.map(({ key, px, py, level }) => ({ key, px, py, level }));
  const cars = fleet.cars
    .filter((car) => car.x !== undefined)
    .map((car) => ({
      key: `${car.bus ? 'bus' : `car-${String(car.color)}`}-${String(car.rotation)}`,
      px: car.x,
      py: car.y,
      level: car.h,
    }));
  const poles = fleet.signals.map(({ px, py, level }) => ({ key: 'pole', px, py, level }));
  for (const { key, px, py, level } of [...cars, ...poles, ...objects].sort((a, b) => a.px + a.py - b.px - b.py))
    stamp(key, px, py, level);
  return { canvas, place };
}

window.renderJunctionSheet = (rows) => {
  const columns = 4;
  const cropW = 620;
  const cropH = 420;
  const labelH = 44;
  const lines = Math.ceil(JUNCTION_CASES.length / columns);
  const sheet = new OffscreenCanvas(columns * (cropW + 12) + 12, lines * (cropH + labelH + 12) + 12);
  const context = sheet.getContext('2d');
  context.fillStyle = '#20303a';
  context.fillRect(0, 0, sheet.width, sheet.height);
  JUNCTION_CASES.forEach((entry, index) => {
    const { canvas, place } = renderTown(townOf(entry));
    const [sx, sy] = place.at(entry.focus[0] + 0.5, entry.focus[1] + 0.5, 0);
    const dx = 12 + (index % columns) * (cropW + 12);
    const dy = 12 + Math.floor(index / columns) * (cropH + labelH + 12);
    context.drawImage(canvas, sx - cropW / 2, sy - cropH / 2, cropW, cropH, dx, dy + labelH, cropW, cropH);
    const row = rows.find((item) => item.name === entry.name);
    context.fillStyle = row?.pass ? '#7fe0a0' : '#ff8a70';
    context.font = '700 26px "Microsoft YaHei"';
    context.fillText(`${entry.name} ${row?.pass ? '通过' : '不通过'}`, dx + 4, dy + 32);
  });
  return sheet.convertToBlob({ type: 'image/png' }).then(
    (blob) =>
      new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      }),
  );
};

void DIRECTIONS;
void spokesOf;
window.junctionReady = true;
