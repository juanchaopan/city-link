import { palettes } from './kit/palettes.js';
import { maskScenes } from './ixchecks.js';
import { CLASS, compose, frameOf, MASK, spriteOf } from './roadscene.js';
import { generateCity } from './sim/city.js';
import { generateRoadDemo } from './sim/roaddemo.js';
import { template, templateFootprint, templateNames } from './sim/interchange.js';
import { ROAD_SPEC } from './sim/network.js';
import { sceneItems } from './sim/sceneitems.js';
import { pngData } from './townrender.js';

// 四级道路的验收：高架主线、匝道和地面路网在同一张遮罩图上核对。
// 车要走的每条 lane，中线和车道两侧都必须落在车道像素上；高架下面的地面路也要连续，说明下方可以通路。
// 被更高的路面盖住的地方读出来还是车道，被桥墩挡住的地方是灰色，这两种都不算断。
// 匝道并入主线的一段路肩会压在匝道上，两端各留两格不查路肩；地面路被高架的路肩盖住也属于遮挡。
// 样张放着三种快速路立交，苜蓿叶和喇叭形第一版不交付，它们的行只记录，不算通过与否。
// 丁字形立交在普通城市里，查的是真实城市路网上的那一个。

const END_ZONE = 2;
const EDGE_MARGIN = 0.07;
const TOWN_SIZE = 64;
const TOWN_MARGIN = 10;
const UNDELIVERED = new Set(['cloverleaf', 'trumpet']);
const STRUCTURES = /^(ixp|ev|pr)-/;

/** 样张和城市的路面已经摊平，这里包成拼图要的世界。 */
function worldOf(city) {
  const { walks, curbs, decks } = city;
  return { ...city, sprites: { walks, curbs, decks, bridges: [], planned: [] }, low: [] };
}

function maskOf(city, region) {
  const objects = city.objects.filter(({ key }) => STRUCTURES.test(key));
  return maskScenes({ ...worldOf(city), objects }, region).full;
}

function inspectLane(lane, { read, place }, offsets, sideCounts) {
  const result = { samples: 0, holes: 0, side: 0, examples: [] };
  const { points } = lane;
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1)
    total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  const note = (px, py, h, found) => {
    if (result.examples.length < 4)
      result.examples.push([
        Math.round(px * 10) / 10,
        Math.round(py * 10) / 10,
        Math.round(h * 10) / 10,
        found,
      ]);
  };
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
        if (found === CLASS.empty) {
          result.holes += 1;
          note(px, py, h, found);
        } else if ((found === CLASS.walk || found === CLASS.curb) && sideCounts && !inEndZone) {
          result.side += 1;
          note(px, py, h, found);
        }
      }
    }
    walked += length;
  }
  return result;
}

window.runLaneChecks = () => {
  const city = generateRoadDemo();
  const demo = maskOf(city);
  const rows = [];
  const total = (name, lanes, scene, sideCounts = true) => {
    const sum = { samples: 0, holes: 0, side: 0 };
    const examples = [];
    for (const lane of lanes) {
      const half = ROAD_SPEC[lane.kind].deck / 2 - EDGE_MARGIN;
      const offsets = lane.kind === 'ramp' ? [0, -half, half] : [0];
      const result = inspectLane(lane, scene, offsets, sideCounts);
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
  const region = [cx - TOWN_MARGIN, cy - TOWN_MARGIN, cx + TOWN_MARGIN, cy + TOWN_MARGIN];
  const lanes = town.lanes.filter(({ id }) => id.startsWith('tee'));
  total(`普通城市·${town.plan.interchange.name}`, lanes, maskOf(town, region));

  const footprints = templateNames().map((name) => ({
    name,
    ...templateFootprint(name),
    bbox: template(name).footprint,
  }));
  const counted = rows.filter(({ name }) => !UNDELIVERED.has(name.split('·')[1]));
  return { rows, footprints, pass: counted.every((row) => row.pass) };
};

const VIEWS = [
  { name: '苜蓿叶立交（未交付）', center: [14, 9], span: 1100 },
  { name: '喇叭形立交（未交付）', center: [30, 10], span: 1100 },
  { name: '菱形立交（快速路×四车道）', center: [30, 28], span: 860 },
  { name: '高架，下方地面可通路', center: [30, 19], span: 560 },
];

window.renderLaneSheet = (rows) => {
  const city = generateRoadDemo();
  const { canvas, context: paint, place } = compose(worldOf(city), palettes.sunny, 'current', {
    withGround: true,
  });
  const { sorted } = sceneItems({ objects: city.objects }, frameOf(palettes.sunny));
  for (const { key, px, py, level } of sorted) {
    const sprite = spriteOf(key, palettes.sunny);
    const [sx, sy] = place.at(px, py, level);
    paint.drawImage(sprite.canvas, Math.round(sx - sprite.ax), Math.round(sy - sprite.ay));
  }
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
  return pngData(sheet);
};
