import { JUNCTION_CASES } from './junctioncases.js';
import { palettes } from './kit/palettes.js';
import { compose, MASK, worldOf } from './roadscene.js';
import { generateCity } from './sim/city.js';
import { spokesOf } from './sim/network.js';
import { roadWorld } from './sim/terrainworld.js';
import { pngData } from './townrender.js';

// 车行道干净度验收：路面内部除了路面色不能有别的东西。
// 用一套专门的配色烘焙路面：人行道和路缘是白色，路面标线和路面同色，所以路面上剩下的任何颜色都是漏出来的。
// 斑马线和停车线是单独的精灵，这里不画。路面内部按距离场取，离路面边 INSET 以内的像素是正常的抗锯齿，不查。
// 逐点读真实烘焙拼出来的像素，和这一格路面的主色比亮度，差超过 MAX_DIFFERENCE 就算一个脏像素。
// 下层透上来的像素是不透明的，所以半透明和透明的点不算：断头路的平头在距离场里是圆头，那一圈没有路面。
// 环岛整个是一张精灵，在标记层，导流岛是设计好的，环岛占的格子和它外面一圈不查，地图的边不查。
// 路口全部组合：验收样例，加上默认城市里每一种不同的路口。城市里的路口切成一小块单独拼，整张遮罩内存不够。

const MAX_DIFFERENCE = 2;
const OPAQUE = 250;
const INSET = 0.035;
const EDGE = 0.6;
const STEP = 0.0075;
const REACH = 2;
const CASE_SIZE = 16;
const CITY_SIZE = 128;
const CUT = 4;
const CUT_SIZE = CUT * 2 + 1;

const LEAK = {
  ...MASK,
  id: 'leak',
  road: {
    ...MASK.road,
    asphalt: '#646b76',
    highway: '#646b76',
    line: '#646b76',
    median: '#646b76',
    walk: '#ffffff',
    shoulder: '#ffffff',
    curb: '#ffffff',
  },
};

const luminance = (data, i) => data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;

function modeOf(values) {
  const counts = new Map();
  for (const value of values) {
    const key = Math.round(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

function nodesOf({ N, roads }) {
  const nodes = [...roads.keys()].filter((id) => {
    const { road, highway } = roads.get(id);
    return spokesOf(road | highway).length >= 3;
  });
  return nodes.map((id) => [id % N, Math.floor(id / N)]);
}

/** 环岛占的格子，再往外扩一圈。 */
function ringZone({ N, rings }) {
  const zone = new Set();
  for (const { cells } of rings) {
    for (const cell of cells) {
      const x = cell % N;
      const y = Math.floor(cell / N);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) zone.add((y + dy) * N + x + dx);
      }
    }
  }
  return zone;
}

/** 一个路口周围的路面内部，逐点比亮度。 */
function inspectNode(world, data, width, height, place, [cx, cy]) {
  const { N } = world;
  const { field } = world.junctions;
  const skip = ringZone(world);
  const samples = [];
  for (let px = Math.max(EDGE, cx - REACH); px < Math.min(N - EDGE, cx + 1 + REACH); px += STEP) {
    for (let py = Math.max(EDGE, cy - REACH); py < Math.min(N - EDGE, cy + 1 + REACH); py += STEP) {
      if (field.deck(px, py) > -INSET) continue;
      if (skip.has(Math.floor(py) * N + Math.floor(px))) continue;
      const [sx, sy] = place.at(px, py, world.surface(px, py));
      const x = Math.round(sx);
      const y = Math.round(sy);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = (y * width + x) * 4;
      if (data[i + 3] < OPAQUE) continue;
      samples.push([px, py, luminance(data, i)]);
    }
  }
  const main = modeOf(samples.map(([, , value]) => value));
  const dirty = samples.filter(([, , value]) => Math.abs(value - main) > MAX_DIFFERENCE);
  return {
    samples: samples.length,
    dirty: dirty.length,
    worst: dirty.reduce((worst, [, , value]) => Math.max(worst, Math.abs(value - main)), 0),
    examples: dirty
      .slice(0, 3)
      .map(([px, py, value]) => [
        Math.round(px * 100) / 100,
        Math.round(py * 100) / 100,
        Math.round(value),
      ]),
  };
}

function inspectWorld(name, world) {
  const { canvas, context, place } = compose(world, LEAK, 'current', { withGround: false });
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const rows = nodesOf(world).map((node) =>
    inspectNode(world, data, canvas.width, canvas.height, place, node),
  );
  return {
    name,
    nodes: rows.length,
    samples: rows.reduce((sum, row) => sum + row.samples, 0),
    dirty: rows.reduce((sum, row) => sum + row.dirty, 0),
    worst: Math.round(Math.max(0, ...rows.map((row) => row.worst))),
    examples: rows.flatMap((row) => row.examples).slice(0, 4),
  };
}

/** 从城市里切一小块路网，坐标搬到一张小图上。cells 相同的路口只查一次。 */
function cutRoads(city, cx, cy) {
  const { N, roads } = city;
  const sub = new Map();
  for (let y = cy - CUT; y <= cy + CUT; y += 1) {
    for (let x = cx - CUT; x <= cx + CUT; x += 1) {
      const entry = roads.get(y * N + x);
      if (entry) sub.set((y - cy + CUT) * CUT_SIZE + (x - cx + CUT), entry);
    }
  }
  return sub;
}

function cityCases(city) {
  const seen = new Map();
  for (const [x, y] of nodesOf(city)) {
    const roads = cutRoads(city, x, y);
    const key = [...roads.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(
        ([id, { road, highway, arterial }]) =>
          `${String(id)}:${String(road)}:${String(highway)}:${String(arterial)}`,
      )
      .join('|');
    if (!seen.has(key)) seen.set(key, { roads, x, y });
  }
  return [...seen.values()];
}

function worldOfCut(roads) {
  const flat = {
    cornersOf: () => [0, 0, 0, 0],
    levelOf: () => 0,
    isFlat: () => true,
    isWater: () => false,
  };
  const road = roadWorld({ N: CUT_SIZE, roads, ...flat, gates: [] });
  return { N: CUT_SIZE, roads, ...road, ...flat };
}

window.runDeckChecks = (withCity = true) => {
  const rows = JUNCTION_CASES.filter((entry) => !entry.heights).map((entry) =>
    inspectWorld(entry.name, worldOf({ N: CASE_SIZE, ...entry })),
  );
  if (withCity) {
    for (const { roads, x, y } of cityCases(generateCity(CITY_SIZE))) {
      rows.push(inspectWorld(`城市路口 ${String(x)},${String(y)}`, worldOfCut(roads)));
    }
  }
  return { rows, threshold: MAX_DIFFERENCE, inset: INSET };
};

/** 真实配色的路口放大到能看清单个像素：没有标线和车，只看路面本身。 */
window.renderDeckZoom = () => {
  const entries = JUNCTION_CASES.filter((entry) => !entry.heights);
  const columns = 3;
  const panelW = 660;
  const panelH = 420;
  const scale = 6;
  const lines = Math.ceil(entries.length / columns);
  const sheet = new OffscreenCanvas(columns * (panelW + 8) + 8, lines * (panelH + 8) + 8);
  const paint = sheet.getContext('2d');
  paint.fillStyle = '#20303a';
  paint.fillRect(0, 0, sheet.width, sheet.height);
  entries.forEach((entry, index) => {
    const world = worldOf({ N: CASE_SIZE, ...entry });
    const { canvas, place } = compose(world, palettes.sunny, 'current', { withGround: true });
    const [sx, sy] = place.at(entry.focus[0] + 0.5, entry.focus[1] + 0.5, 0);
    const x = 8 + (index % columns) * (panelW + 8);
    const y = 8 + Math.floor(index / columns) * (panelH + 8);
    paint.imageSmoothingEnabled = false;
    paint.drawImage(
      canvas,
      sx - panelW / scale / 2,
      sy - panelH / scale / 2,
      panelW / scale,
      panelH / scale,
      x,
      y,
      panelW,
      panelH,
    );
    paint.fillStyle = '#ffffff';
    paint.font = '700 22px "Microsoft YaHei"';
    paint.fillText(entry.name, x + 8, y + 28);
  });
  return pngData(sheet);
};

window.deckReady = true;
