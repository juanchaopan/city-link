import { Baker } from './kit/bake.js';
import { bakeKey } from './kit/catalog.js';
import { palettes } from './kit/palettes.js';
import { MASK, placer } from './roadscene.js';
import { generateCity } from './sim/city.js';
import { generateRoadDemo } from './sim/roaddemo.js';
import { template, templateFootprint, templateNames } from './sim/interchange.js';
import { ROAD_SPEC } from './sim/network.js';

// 四级道路的验收：高架主线、匝道和地面路网在同一张遮罩图上核对。
// 车要走的每条 lane，中线和车道两侧都必须落在车道像素上；高架下面的地面路也要连续，说明下方可以通路。
// 被更高的路面盖住的地方读出来还是车道，被桥墩挡住的地方是灰色，这两种都不算断。
// 匝道并入主线的一段路肩会压在匝道上，两端各留两格不查路肩；地面路被高架的路肩盖住也属于遮挡。
// 样张放着三种快速路立交，丁字形立交在普通城市里，查的是真实城市路网上的那一个。

const END_ZONE = 2;
const EDGE_MARGIN = 0.07;
const TOWN_SIZE = 64;
const TOWN_MARGIN = 10;

const baker = new Baker();
const cache = new Map();

function spriteOf(key, palette) {
  const id = `${palette.id}|${key}`;
  if (!cache.has(id)) {
    baker.usePalette(palette);
    const { result } = bakeKey(baker, key, palette);
    const canvas = new OffscreenCanvas(result.w, result.h);
    canvas.getContext('2d').putImageData(new ImageData(result.data, result.w, result.h), 0, 0);
    cache.set(id, { canvas, ax: result.ax, ay: result.ay });
  }
  return cache.get(id);
}

function compose(city, palette, withGround, within = () => true) {
  const place = placer(city.N);
  const canvas = new OffscreenCanvas(place.width, place.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const stamp = (key, px, py, level) => {
    const sprite = spriteOf(key, palette);
    const [sx, sy] = place.at(px, py, level);
    context.drawImage(sprite.canvas, Math.round(sx - sprite.ax), Math.round(sy - sprite.ay));
  };
  if (withGround)
    for (const { key, x, y, level } of city.ground) stamp(key, x + 0.5, y + 0.5, level);
  for (const list of [city.walks, city.curbs, city.decks]) {
    for (const { key, x, y, level } of list) if (within(x, y)) stamp(key, x + 0.5, y + 0.5, level);
  }
  const lifted = city.objects.filter(
    ({ key }) => withGround || key.startsWith('ix-') || key.startsWith('ev-'),
  );
  for (const { key, px, py, level } of [...lifted].sort((a, b) => a.px + a.py - b.px - b.py))
    stamp(key, px, py, level);
  return { canvas, context, place };
}

function pixelClass(data, width, x, y) {
  const i = (y * width + x) * 4;
  if (data[i + 3] < 128) return 'empty';
  const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
  if (r > 60 && b < r * 0.35 && g < r * 1.25) return 'deck';
  if ((g > 60 && r < g * 0.35 && b < g * 0.35) || (b > 60 && r < b * 0.35 && g < b * 0.35))
    return 'side';
  return 'other';
}

function inspectLane(lane, read, place, offsets, sideCounts) {
  const result = { samples: 0, holes: 0, side: 0, examples: [] };
  const { points } = lane;
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1)
    total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  let walked = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, ay, ah] = points[i];
    const [bx, by, bh] = points[i + 1];
    const length = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.round(length / 0.04));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const h = ah + (bh - ah) * t;
      const station = walked + length * t;
      const inEndZone = station < END_ZONE || station > total - END_ZONE;
      for (const offset of offsets) {
        const px = x - ((by - ay) / length) * offset;
        const py = y + ((bx - ax) / length) * offset;
        const [sx, sy] = place.at(px, py, h);
        const found = read(Math.round(sx), Math.round(sy));
        result.samples += 1;
        if (found === 'empty') {
          result.holes += 1;
          if (result.examples.length < 4)
            result.examples.push([
              Math.round(px * 10) / 10,
              Math.round(py * 10) / 10,
              Math.round(h * 10) / 10,
              found,
            ]);
        } else if (found === 'side' && sideCounts && !inEndZone) {
          result.side += 1;
          if (result.examples.length < 4)
            result.examples.push([
              Math.round(px * 10) / 10,
              Math.round(py * 10) / 10,
              Math.round(h * 10) / 10,
              found,
            ]);
        }
      }
    }
    walked += length;
  }
  return result;
}

/** 一张遮罩图上的查询：读像素的函数和坐标换算。 */
function sceneOf(composed) {
  const { canvas, context, place } = composed;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  return { read: (x, y) => pixelClass(data, canvas.width, x, y), place };
}

window.runLaneChecks = () => {
  const city = generateRoadDemo();
  const demo = sceneOf(compose(city, MASK, false));
  const rows = [];
  const total = (name, lanes, scene, sideCounts = true) => {
    const sum = { samples: 0, holes: 0, side: 0 };
    const examples = [];
    for (const lane of lanes) {
      const half = ROAD_SPEC[lane.kind].deck / 2 - EDGE_MARGIN;
      const result = inspectLane(
        lane,
        scene.read,
        scene.place,
        lane.kind === 'ramp' ? [0, -half, half] : [0],
        sideCounts,
      );
      for (const key of Object.keys(sum)) sum[key] += result[key];
      examples.push(...result.examples);
    }
    rows.push({
      name,
      lanes: lanes.length,
      ...sum,
      pass: sum.holes === 0 && sum.side === 0,
      examples: examples.slice(0, 6),
    });
  };
  total(
    '快速路主线',
    city.lanes.filter((lane) => lane.kind === 'express'),
    demo,
  );
  for (const name of templateNames()) {
    const lanes = city.lanes.filter((lane) => lane.id.startsWith(name));
    if (lanes.length > 0) total(`立交·${name}`, lanes, demo);
  }
  const under = [
    [
      [26, 19.5, 0],
      [34, 19.5, 0],
    ],
    [
      [10, 28.5, 0],
      [18, 28.5, 0],
    ],
    [
      [26, 38.5, 0],
      [34, 38.5, 0],
    ],
  ];
  total(
    '高架下方的地面路',
    under.map((points) => ({ kind: 'road', points })),
    demo,
    false,
  );

  const town = generateCity(TOWN_SIZE);
  const { cx, cy } = town.plan.interchange;
  const near = (x, y) => Math.abs(x - cx) <= TOWN_MARGIN && Math.abs(y - cy) <= TOWN_MARGIN;
  total(
    `普通城市·${town.plan.interchange.name}`,
    town.lanes,
    sceneOf(compose(town, MASK, false, near)),
  );

  const footprints = templateNames().map((name) => ({
    name,
    ...templateFootprint(name),
    bbox: template(name).footprint,
  }));
  return { rows, footprints };
};

const VIEWS = [
  { name: '苜蓿叶立交（高速×快速路）', center: [14, 9], span: 1100 },
  { name: '喇叭形立交（高速接快速路）', center: [30, 10], span: 1100 },
  { name: '菱形立交（快速路×四车道）', center: [30, 28], span: 860 },
  { name: '高架，下方地面可通路', center: [30, 19], span: 560 },
];

window.renderLaneSheet = (rows) => {
  const city = generateRoadDemo();
  const { canvas, place } = compose(city, palettes.sunny, true);
  const panelW = 720;
  const panelH = 460;
  const labelH = 44;
  const sheet = new OffscreenCanvas(VIEWS.length * (panelW + 12) + 12, panelH + labelH + 24);
  const context = sheet.getContext('2d');
  context.fillStyle = '#20303a';
  context.fillRect(0, 0, sheet.width, sheet.height);
  VIEWS.forEach(({ name, center, span }, index) => {
    const [sx, sy] = place.at(center[0] + 0.5, center[1] + 0.5, 0);
    const height = (span * panelH) / panelW;
    const dx = 12 + index * (panelW + 12);
    context.drawImage(
      canvas,
      sx - span / 2,
      sy - height / 2,
      span,
      height,
      dx,
      12 + labelH,
      panelW,
      panelH,
    );
    context.fillStyle = rows.every((row) => row.pass) ? '#7fe0a0' : '#ff8a70';
    context.font = '700 26px "Microsoft YaHei"';
    context.fillText(name, dx + 4, 44);
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
