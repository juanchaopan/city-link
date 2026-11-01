import { buildObject } from './kit/objects.js';
import { palettes } from './kit/palettes.js';
import { JUNCTION_CASES } from './junctioncases.js';
import { CLASS, readPoints, worldOf, worldOfCity } from './roadscene.js';
import { generateCity, specKey } from './sim/city.js';
import { createFleet, roadAngle, spriteAngle, wrapAngle } from './sim/fleet.js';
import { unitOf } from './sim/junctions.js';
import { clearLots } from './sim/lotclear.js';
import { cellPaths, DIRECTIONS, ROAD_SPEC } from './sim/network.js';
import { generateParcels, ZONE } from './sim/parcels.js';
import { cornerHeight } from './sim/surface.js';
import { computeTraffic } from './sim/traffic.js';
import { pngData, randomFrom, renderTown } from './townrender.js';

// 路口验收：看成品。场景按游戏流程生成，路面按真实烘焙拼到遮罩上，灯杆、斑马线端点、车脚点和地块的地面轮廓
// 都换算成屏幕像素，直接读那个像素属于哪一层，不靠几何推断。
// 要读的点先收齐，再由 readPoints 分块拼遮罩逐块读：128 城整张拼不下，这样每次只拼一块。
// 地块的地面轮廓是建筑模型里贴地的三角形（地台和铺装），楼身不算，高楼挡住后面的路是正常的。
// 停车检查量的是车身：停够 IDLE 秒的车，车头、车中、车尾三点都不能落在斑马线、路口或大路口的连接段里。
// 斑马线的端点落在人行道和路面的分界上，那一个像素是两层的混色，所以读它周围一圈，有一个像素在人行道上就算到了。
// 坡路的边缘高差：角点按四分之一层存，一层 32 像素，地形最多有 8 像素的取整误差，上限定 6 像素，
// 超过这个数才是看得见的竖面；腾空的路是几十像素，分得开。
// 灯面朝向：逐个信号灯，灯面法线要和这个进口的车驶来的方向相反。第 7 轮所有灯都用同一张朝左的精灵，
// oldFacingOff 按那个朝向算一遍，证明这项检查抓得到。

const CASE_SIZE = 16;
const CITY_SIZE = 128;
const RUN_STEPS = 900;
const SAMPLE_EVERY = 30;
const DT = 0.05;
const GROUND_Y = 0.03;
const GROUND_STEP = 0.05;
const SLOPE_SAMPLE = 0.25;
const MAX_HEADING = 8;
const MAX_FACE_PIXELS = 6;
const CORE_MARGIN = 0.05;
const IDLE = 1;
const OLD_LAMP_DIRECTION = 4;
const FACING_MATCH = 0.99;

function caseParcels(world) {
  const { N, roads } = world;
  const zones = new Uint8Array(N * N).fill(ZONE.commercial);
  const density = new Uint8Array(N * N).fill(1);
  const reserved = new Set(world.rings.flatMap(({ cells }) => [...cells]));
  const result = generateParcels({
    N,
    roads,
    water: new Set(),
    slopes: new Set(),
    zones,
    density,
    seed: 11,
    reserved,
  });
  clearLots(result.parcels, world.junctions.field);
  return result;
}

function townOf(entry) {
  const world = worldOf({ N: CASE_SIZE, ...entry });
  const parcels = entry.lots ? caseParcels(world) : null;
  const objects = (parcels?.parcels ?? [])
    .filter((parcel) => parcel.shape !== 'field' && parcel.use !== 'bare')
    .map((parcel) => ({
      key: specKey(parcel),
      px: parcel.px,
      py: parcel.py,
      level: 0,
      footprint: parcel.polygon,
    }));
  const traffic = computeTraffic([], world.roads, CASE_SIZE);
  return { ...world, objects, traffic, lanes: [] };
}

function townOfCity(city) {
  return { ...worldOfCity(city), objects: city.objects, traffic: city.traffic, lanes: [] };
}

/** 灯杆底部要落在人行道或路缘上。落在车道上是最坏的情况，落到路外说明高度或位置错了。 */
export function polesCheck(fleet) {
  const points = fleet.signals.map(({ px, py, level }) => ({ px, py, level }));
  return {
    points,
    tally(found) {
      const result = { poles: points.length, polesOnDeck: 0, polesOffRoad: 0, examples: [] };
      found.forEach((value, index) => {
        if (value === CLASS.walk || value === CLASS.curb) return;
        if (value === CLASS.deck) result.polesOnDeck += 1;
        else result.polesOffRoad += 1;
        const { px, py, level } = points[index];
        if (result.examples.length < 4) result.examples.push(['灯杆', px, py, level, value]);
      });
      return result;
    },
  };
}

/** 灯面法线和来车方向：来车方向从路口的腿算，不用灯自己的朝向字段。 */
export function checkFacing(town, fleet) {
  const result = { facingChecked: 0, facingOff: 0, oldFacingOff: 0, examples: [] };
  const facing = (dir) => {
    const [dx, dy] = DIRECTIONS[dir];
    const length = Math.hypot(dx, dy);
    return [dx / length, dy / length];
  };
  for (const pole of fleet.signals) {
    const leg = town.junctions.legs.find(
      ({ pole: own }) => own && own.px === pole.px && own.py === pole.py,
    );
    const [ax, ay] = [leg.stopLine.px - leg.x, leg.stopLine.py - leg.y];
    const length = Math.hypot(ax, ay);
    const toward = [ax / length, ay / length];
    const [fx, fy] = facing(Number(pole.key.split('-')[1]));
    const [ox, oy] = facing(OLD_LAMP_DIRECTION);
    result.facingChecked += 1;
    if (fx * toward[0] + fy * toward[1] < FACING_MATCH) {
      result.facingOff += 1;
      if (result.examples.length < 4) result.examples.push(['灯面', pole.key, pole.px, pole.py]);
    }
    if (ox * toward[0] + oy * toward[1] < FACING_MATCH) result.oldFacingOff += 1;
  }
  return result;
}

/** 逐条腿核对：每条腿一条斑马线，两端都在人行道上。少一条就算不通过，环岛的腿也一样。 */
export function crossingsCheck(town) {
  const { legs } = town.junctions;
  const points = [];
  const base = { legs: legs.length, crossings: 0, missingCrossings: 0, examples: [] };
  for (const { crossing, node, dir } of legs) {
    if (!crossing) {
      base.missingCrossings += 1;
      if (base.examples.length < 4) base.examples.push(['缺斑马线', node, dir]);
      continue;
    }
    base.crossings += 1;
    for (const [px, py] of crossing.ends)
      points.push({ px, py, level: crossing.level, around: true, node, dir });
  }
  return {
    points,
    tally(found) {
      const result = { ...base, crossingEndsOff: 0, interiorCrossings: 0 };
      found.forEach((onSidewalk, index) => {
        if (onSidewalk) return;
        result.crossingEndsOff += 1;
        const { node, dir, px, py } = points[index];
        if (result.examples.length < 4) result.examples.push(['端点', node, dir, px, py]);
      });
      return result;
    },
  };
}

/** 这一点在斑马线上，或者在路口中心到斑马线之间。 */
export function inJunction(x, y, legs, core) {
  for (const leg of legs) {
    if (!leg.crossing) continue;
    const [ux, uy] = unitOf(leg.dir);
    const dx = x - leg.x;
    const dy = y - leg.y;
    const along = dx * ux + dy * uy;
    const side = Math.abs(-dx * uy + dy * ux);
    if (
      side < leg.crossing.half &&
      along > leg.crossing.near - CORE_MARGIN &&
      along < leg.crossing.far + CORE_MARGIN
    )
      return true;
  }
  return core.some(([[cx, cy], reach]) => Math.hypot(x - cx, y - cy) < reach);
}

/** 每个路口的中心区：半径取这个路口最近的斑马线。 */
export function coreOf(legs) {
  const reach = new Map();
  for (const leg of legs) {
    if (!leg.crossing) continue;
    const key = `${String(leg.x)},${String(leg.y)}`;
    const entry = reach.get(key) ?? [[leg.x, leg.y], Infinity];
    entry[1] = Math.min(entry[1], leg.crossing.near);
    reach.set(key, entry);
  }
  return [...reach.values()];
}

/** 大路口连接段的格子：车不能停在这里。 */
export function linkCellsOf({ clusters }) {
  const cells = new Set();
  for (const { cells: all, nodes } of clusters) {
    for (const cell of all) if (!nodes.includes(cell)) cells.add(cell);
  }
  return cells;
}

/** 车身的头、中、尾三点。 */
export function bodyOf(fleet, car) {
  const half = fleet.lengthOf(car) / 2;
  const angle = roadAngle(car.path, car.s);
  const dx = Math.cos(angle) / 64 / 2 + Math.sin(angle) / 32 / 2;
  const dy = Math.sin(angle) / 32 / 2 - Math.cos(angle) / 64 / 2;
  const scale = half / Math.hypot(dx, dy);
  return [-1, 0, 1].map((d) => [car.x + dx * scale * d, car.y + dy * scale * d]);
}

/** 让车流跑一段时间，抽样记下车脚点，红灯时停着的车按车身查是不是停在路口里。 */
export function carsCheck(town, { cap = 80, steps = RUN_STEPS, busShare } = {}) {
  const fleet = createFleet(town, { cap, full: true, random: randomFrom(7), busShare });
  const { N, junctions } = town;
  const { legs } = junctions;
  const core = coreOf(legs);
  const links = linkCellsOf(junctions);
  const onLink = ([x, y]) => links.has(Math.floor(y) * N + Math.floor(x));
  const points = [];
  const base = { stoppedSamples: 0, stoppedInJunction: 0, examples: [] };
  for (let i = 0; i < steps; i += 1) {
    fleet.step(DT);
    if (i % SAMPLE_EVERY !== SAMPLE_EVERY - 1) continue;
    for (const car of fleet.cars) {
      if (car.x === undefined || car.high) continue;
      points.push({ px: car.x, py: car.y, level: car.h });
      if (car.idle < IDLE) continue;
      base.stoppedSamples += 1;
      const body = bodyOf(fleet, car);
      if (body.some((point) => onLink(point) || inJunction(point[0], point[1], legs, core))) {
        base.stoppedInJunction += 1;
        if (base.examples.length < 4) base.examples.push(['停车', car.x, car.y, car.bus]);
      }
    }
  }
  return {
    points,
    tally(found) {
      const result = { ...base, carSamples: points.length, carsOffRoad: 0 };
      found.forEach((value, index) => {
        if (value === CLASS.deck) return;
        result.carsOffRoad += 1;
        const { px, py, level } = points[index];
        if (result.examples.length < 4) result.examples.push(['车脚', px, py, level, value]);
      });
      return result;
    },
  };
}

const groundCache = new Map();

/** 物业的地面轮廓：模型里贴地的三角形，在局部坐标里铺一层采样点。 */
function groundSamples(key) {
  if (!groundCache.has(key)) {
    const { positions } = buildObject(key, palettes.sunny);
    const samples = [];
    for (let i = 0; i < positions.length; i += 9) {
      const points = [0, 3, 6].map((k) => [
        positions[i + k],
        positions[i + k + 1],
        positions[i + k + 2],
      ]);
      if (points.some(([, y]) => y > GROUND_Y)) continue;
      const [a, b, c] = points;
      const longest = Math.max(
        Math.hypot(b[0] - a[0], b[2] - a[2]),
        Math.hypot(c[0] - a[0], c[2] - a[2]),
      );
      const steps = Math.max(1, Math.ceil(longest / GROUND_STEP));
      for (let u = 0; u <= steps; u += 1) {
        for (let v = 0; v <= steps - u; v += 1) {
          const s = u / steps;
          const t = v / steps;
          samples.push([
            a[0] + (b[0] - a[0]) * s + (c[0] - a[0]) * t,
            a[2] + (b[2] - a[2]) * s + (c[2] - a[2]) * t,
          ]);
        }
      }
    }
    groundCache.set(key, samples);
  }
  return groundCache.get(key);
}

const OWNS_GROUND = /^(B|Q|S|P|t|farmhouse)(-|$)/;

function lotsCheck(town) {
  const points = [];
  const lots = [];
  for (const { key, px, py, level } of town.objects) {
    if (!OWNS_GROUND.test(key)) continue;
    const lot = { key, px, py, hits: 0 };
    lots.push(lot);
    for (const [u, v] of groundSamples(key)) points.push({ px: px + u, py: py + v, level, lot });
  }
  return {
    points,
    tally(found) {
      found.forEach((value, index) => {
        if (value === CLASS.deck || value === CLASS.walk || value === CLASS.curb)
          points[index].lot.hits += 1;
      });
      const result = { lots: lots.length, lotsOnRoad: 0, lotPixels: 0, examples: [] };
      for (const { key, px, py, hits } of lots) {
        if (hits === 0) continue;
        result.lotsOnRoad += 1;
        result.lotPixels += hits;
        if (result.examples.length < 4) result.examples.push(['地块压路', key, px, py, hits]);
      }
      return result;
    },
  };
}

/** 坡路的路面边缘到地面的高差，单位是屏幕像素。路贴在地上时这个数很小，腾空时就是一道看得见的竖面。 */
function checkHang(town) {
  const { N, sprites, cornersOf, surface } = town;
  const groundAt = (px, py) => {
    const x = Math.floor(px);
    const y = Math.floor(py);
    return cornerHeight(cornersOf(x, y), px - x, py - y);
  };
  const result = { slopeCells: sprites.grades.size, worstHang: 0, hangingEdges: 0 };
  for (const id of sprites.grades.keys()) {
    const entry = sprites.cells.get(id);
    if (!entry) continue;
    const x = id % N;
    const y = Math.floor(id / N);
    const [path] = cellPaths(entry.road, entry.highway, entry.arterial);
    const [a, c] = [path.points[0], path.points[path.points.length - 1]];
    const length = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const nx = -(c[1] - a[1]) / length;
    const nz = (c[0] - a[0]) / length;
    const half = ROAD_SPEC[path.kind].walk / 2 + 0.04;
    for (let t = 0; t <= 1; t += SLOPE_SAMPLE) {
      const px = x + 0.5 + a[0] + (c[0] - a[0]) * t;
      const py = y + 0.5 + a[1] + (c[1] - a[1]) * t;
      const deck = surface(px, py);
      for (const side of [1, -1]) {
        const gap = Math.abs(deck - groundAt(px + nx * side * half, py + nz * side * half)) * 32;
        result.worstHang = Math.max(result.worstHang, gap);
        if (gap > MAX_FACE_PIXELS) result.hangingEdges += 1;
      }
    }
  }
  result.worstHang = Math.round(result.worstHang * 10) / 10;
  return result;
}

function checkHeading(town) {
  const fleet = createFleet(town, { cap: 80, full: true, random: randomFrom(9) });
  const result = { headingSamples: 0, headingOff: 0, worstHeading: 0 };
  for (let i = 0; i < RUN_STEPS; i += 1) {
    fleet.step(DT);
    if (i % SAMPLE_EVERY !== SAMPLE_EVERY - 1) continue;
    for (const car of fleet.cars) {
      if (car.x === undefined || car.speed < 0.02) continue;
      const body = spriteAngle(car.rotation) + car.tilt;
      const road = roadAngle(car.path, Math.min(car.s, car.path.length));
      const error = (Math.abs(wrapAngle(road - body)) * 180) / Math.PI;
      result.headingSamples += 1;
      result.worstHeading = Math.max(result.worstHeading, error);
      if (error > MAX_HEADING) result.headingOff += 1;
    }
  }
  result.worstHeading = Math.round(result.worstHeading * 10) / 10;
  return result;
}

/** 四项要读像素的检查先收点，一起分块读，再各自计数；另外三项只看几何。 */
function inspect(town) {
  const fleet = createFleet(town, { cap: 1, random: randomFrom(3) });
  const readers = [polesCheck(fleet), crossingsCheck(town), carsCheck(town), lotsCheck(town)];
  const points = readers.flatMap((reader) => reader.points);
  const found = readPoints(town, points);
  let offset = 0;
  const parts = readers.map((reader) => {
    const slice = found.slice(offset, offset + reader.points.length);
    offset += reader.points.length;
    return reader.tally(slice);
  });
  parts.push(checkFacing(town, fleet), checkHang(town), checkHeading(town));
  const row = Object.assign({}, ...parts);
  row.rings = town.rings.length;
  row.examples = parts.flatMap((part) => part.examples ?? []).slice(0, 8);
  return row;
}

const FAILURES = [
  'polesOnDeck',
  'polesOffRoad',
  'facingOff',
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
  if (withCity) {
    rows.push({
      name: `全图 ${String(CITY_SIZE)}×${String(CITY_SIZE)}`,
      ...inspect(townOfCity(generateCity(CITY_SIZE))),
    });
  }
  for (const row of rows) row.pass = FAILURES.every((key) => row[key] === 0);
  return { rows, failures: FAILURES };
};

window.renderJunctionSheet = (rows) => {
  const columns = 4;
  const cropW = 620;
  const cropH = 420;
  const labelH = 44;
  const lines = Math.ceil(JUNCTION_CASES.length / columns);
  const sheet = new OffscreenCanvas(
    columns * (cropW + 12) + 12,
    lines * (cropH + labelH + 12) + 12,
  );
  const context = sheet.getContext('2d');
  context.fillStyle = '#20303a';
  context.fillRect(0, 0, sheet.width, sheet.height);
  JUNCTION_CASES.forEach((entry, index) => {
    const { canvas, place } = renderTown(townOf(entry), {
      cars: 40,
      busShare: entry.buses ? 1 : undefined,
    });
    const [sx, sy] = place.at(entry.focus[0] + 0.5, entry.focus[1] + 0.5, 0);
    const dx = 12 + (index % columns) * (cropW + 12);
    const dy = 12 + Math.floor(index / columns) * (cropH + labelH + 12);
    context.drawImage(
      canvas,
      sx - cropW / 2,
      sy - cropH / 2,
      cropW,
      cropH,
      dx,
      dy + labelH,
      cropW,
      cropH,
    );
    const row = rows.find((item) => item.name === entry.name);
    context.fillStyle = row?.pass ? '#7fe0a0' : '#ff8a70';
    context.font = '700 26px "Microsoft YaHei"';
    context.fillText(`${entry.name} ${row?.pass ? '通过' : '不通过'}`, dx + 4, dy + 32);
  });
  return pngData(sheet);
};

/** 坡路的放大图：地面、路和车都是真实渲染。 */
window.renderSlopeSheet = (rows) => {
  const slopes = JUNCTION_CASES.filter((entry) => entry.heights);
  const cropW = 780;
  const cropH = 520;
  const labelH = 44;
  const sheet = new OffscreenCanvas(slopes.length * (cropW + 12) + 12, cropH + labelH + 24);
  const context = sheet.getContext('2d');
  context.fillStyle = '#20303a';
  context.fillRect(0, 0, sheet.width, sheet.height);
  slopes.forEach((entry, index) => {
    const { canvas, place } = renderTown(townOf(entry), { cars: 40 });
    const [sx, sy] = place.at(entry.focus[0] + 0.5, entry.focus[1] + 0.5, 1);
    const dx = 12 + index * (cropW + 12);
    const scale = 1.5;
    context.imageSmoothingEnabled = false;
    context.drawImage(
      canvas,
      sx - cropW / scale / 2,
      sy - cropH / scale / 2,
      cropW / scale,
      cropH / scale,
      dx,
      12 + labelH,
      cropW,
      cropH,
    );
    const row = rows.find((item) => item.name === entry.name);
    context.fillStyle = row?.pass ? '#7fe0a0' : '#ff8a70';
    context.font = '700 26px "Microsoft YaHei"';
    context.fillText(
      `${entry.name}：最大高差 ${String(row?.worstHang)} 像素，${row?.pass ? '通过' : '不通过'}`,
      dx + 4,
      44,
    );
  });
  return pngData(sheet);
};

window.junctionReady = true;
