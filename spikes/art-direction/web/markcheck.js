import { JUNCTION_CASES } from './junctioncases.js';
import {
  CLASS,
  classify,
  compose,
  insideRegion,
  MASK,
  regionsOf,
  spriteOf,
  worldOf,
  worldOfCity,
} from './roadscene.js';
import { shapeCases } from './shapecases.js';
import { generateCity } from './sim/city.js';
import { unitOf } from './sim/junctions.js';
import { ROAD_SPEC } from './sim/network.js';
import { RING } from './sim/roundabout.js';

// 停车线验收：车道线和中心线在停车线外缘结束，停车线以内只有斑马线和停车线本身。
// 路面按真实烘焙拼到遮罩上（标线是黄色），路面标记按游戏的顺序画在上面，逐个像素换回世界坐标，
// 落在某条腿从路口一侧到停车线内缘、车行道以内的像素，除去斑马线带和停车线，不能是标线色：
// 标线可以接到停车线外缘，精灵取整和边上的混色落在停车线的厚度里，不算越过。
// 信号路口从路口中心查起，环岛从环路外缘查起。车行道边上一个像素是路面和路缘的混色，横向留 EDGE。
// 另查路面标记有没有画到路外：几何上离开车行道 EDGE 以上、标记不透明、底下的遮罩也不是车道的像素。
// 一个屏幕像素在斜方向上跨 0.02 格左右，车行道边上那一个像素两边都沾，不算。
// 区域和停车线的厚度在这里各写一份，不读 sim/blanks.js：检查不跟实现共用一个可能写错的数。

const CASE_SIZE = 16;
const CITY_SIZE = 128;
const STOP_DEPTH = 0.018;
const RING_EDGE = RING + 0.26;
const EDGE = 0.02;
const MARK_MARGIN = 0.015;
const NEAR_LEGS = 4;
const OFF_DECK_REACH = 0.06;

const isLine = (r, g, b) => r > 180 && g > 150 && b < 110;

function spanOf(leg, ringIds) {
  const from = ringIds.has(leg.node) ? RING_EDGE : 0;
  return { from, to: leg.stopLine.station - STOP_DEPTH / 2 };
}

/** 沿腿的距离和横向偏移，横向正方向是车朝路口开时的左边。 */
function localOf(leg, px, py) {
  const [ux, uy] = unitOf(leg.dir);
  const dx = px - leg.x;
  const dy = py - leg.y;
  return [dx * ux + dy * uy, -dx * uy + dy * ux];
}

/** 这一点在斑马线带或停车线上，留 MARK_MARGIN 的边，标记边上的混色不算。 */
function onMark(legs, px, py) {
  return legs.some((leg) => {
    const [d, v] = localOf(leg, px, py);
    const half = ROAD_SPEC[leg.kind].deck / 2;
    const { near, far } = leg.crossing;
    const s = leg.stopLine.station;
    const inBand =
      d > near - MARK_MARGIN && d < far + MARK_MARGIN && Math.abs(v) < half + MARK_MARGIN;
    const inStop =
      Math.abs(d - s) < STOP_DEPTH / 2 + MARK_MARGIN && v > -half - MARK_MARGIN && v < MARK_MARGIN;
    return inBand || inStop;
  });
}

function stampMarks(world, place, region, layer) {
  const context = layer.getContext('2d', { willReadFrequently: true });
  context.clearRect(0, 0, layer.width, layer.height);
  const [x0, y0, x1, y1] = region;
  const drawn = [x0 - 3, y0 - 3, x1 + 3, y1 + 3];
  for (const { key, x, y, level } of world.marks) {
    if (!insideRegion(drawn, Math.floor(x + 0.5), Math.floor(y + 0.5))) continue;
    const sprite = spriteOf(key, MASK);
    const [sx, sy] = place.at(x + 0.5, y + 0.5, level);
    context.drawImage(sprite.canvas, Math.round(sx - sprite.ax), Math.round(sy - sprite.ay));
  }
  return context;
}

/** 一条腿要读的画布矩形。 */
function boxOf(leg, span, place) {
  const [ux, uy] = unitOf(leg.dir);
  const half = ROAD_SPEC[leg.kind].deck / 2 + OFF_DECK_REACH;
  const corners = [span.from, span.to].flatMap((d) =>
    [-half, half].map((v) =>
      place.at(leg.x + ux * d - uy * v, leg.y + uy * d + ux * v, leg.stopLine.level),
    ),
  );
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const left = Math.floor(Math.min(...xs)) - 1;
  const top = Math.floor(Math.min(...ys)) - 1;
  return {
    left,
    top,
    width: Math.ceil(Math.max(...xs)) + 2 - left,
    height: Math.ceil(Math.max(...ys)) + 2 - top,
  };
}

function inspectLeg({ leg, span, near, field, place, base, marks, result }) {
  const box = boxOf(leg, span, place);
  const below = base.getImageData(box.left, box.top, box.width, box.height).data;
  const above = marks.getImageData(box.left, box.top, box.width, box.height).data;
  const [ox, oy0] = place.at(0, 0, 0);
  const oy = oy0 + 32 - leg.stopLine.level * 32;
  const half = ROAD_SPEC[leg.kind].deck / 2;
  let lines = 0;
  let first = null;
  for (let j = 0; j < box.height; j += 1) {
    for (let i = 0; i < box.width; i += 1) {
      const a = (box.left + i + 0.5 - ox) / 64;
      const b = (box.top + j + 0.5 - oy) / 32 + 1;
      const px = (a + b) / 2;
      const py = (b - a) / 2;
      const [d, v] = localOf(leg, px, py);
      if (d < span.from || d > span.to) continue;
      const k = (j * box.width + i) * 4;
      const painted = above[k + 3] >= 128;
      const own = painted ? above : below;
      if (painted && Math.abs(v) <= half + OFF_DECK_REACH && field.deck(px, py) > EDGE) {
        const under = classify(below[k], below[k + 1], below[k + 2], below[k + 3]);
        if (under !== CLASS.deck) {
          result.paintedOffDeck += 1;
          if (result.offDeckExamples.length < 4)
            result.offDeckExamples.push([
              leg.x,
              leg.y,
              leg.dir,
              leg.kind,
              d.toFixed(3),
              v.toFixed(3),
            ]);
        }
      }
      if (Math.abs(v) > half - EDGE || field.deck(px, py) > -EDGE) continue;
      if (!isLine(own[k], own[k + 1], own[k + 2]) || onMark(near, px, py)) continue;
      lines += 1;
      first ??= [Math.round(d * 1000) / 1000, Math.round(v * 1000) / 1000];
    }
  }
  result.legs += 1;
  if (lines === 0) return;
  result.linePixels += lines;
  result.legsWithLines += 1;
  if (result.examples.length < 6)
    result.examples.push([leg.x, leg.y, leg.dir, leg.kind, lines, ...first]);
}

function inspect(world) {
  const { N, junctions } = world;
  const { field } = junctions;
  const ringIds = new Set(world.rings.map(({ id }) => id));
  const legs = junctions.legs.filter((leg) => leg.crossing);
  const result = {
    legs: 0,
    linePixels: 0,
    legsWithLines: 0,
    paintedOffDeck: 0,
    examples: [],
    offDeckExamples: [],
  };
  for (const region of regionsOf(N)) {
    const own = legs.filter((leg) => insideRegion(region, Math.floor(leg.x), Math.floor(leg.y)));
    if (own.length === 0) continue;
    const { canvas, context, place } = compose(world, MASK, 'current', {
      withGround: false,
      region,
    });
    const layer = new OffscreenCanvas(canvas.width, canvas.height);
    const marks = stampMarks(world, place, region, layer);
    for (const leg of own) {
      const near = legs.filter((other) => Math.hypot(other.x - leg.x, other.y - leg.y) < NEAR_LEGS);
      const span = spanOf(leg, ringIds);
      inspectLeg({ leg, span, near, field, place, base: context, marks, result });
    }
  }
  return result;
}

const add = (total, part) => {
  for (const key of ['legs', 'linePixels', 'legsWithLines', 'paintedOffDeck'])
    total[key] += part[key];
  total.examples.push(...part.examples.slice(0, 6 - total.examples.length));
  total.offDeckExamples.push(...part.offDeckExamples.slice(0, 4 - total.offDeckExamples.length));
  return total;
};

window.runMarkChecks = ({ shapes = true, city = true } = {}) => {
  const rows = JUNCTION_CASES.map((entry) => ({
    name: entry.name,
    ...inspect(worldOf({ N: CASE_SIZE, ...entry })),
  }));
  if (shapes) {
    const total = {
      legs: 0,
      linePixels: 0,
      legsWithLines: 0,
      paintedOffDeck: 0,
      examples: [],
      offDeckExamples: [],
    };
    const cases = shapeCases();
    for (const entry of cases) add(total, inspect(worldOf(entry)));
    rows.push({ name: `穷举 ${String(cases.length)} 个场景`, ...total });
  }
  if (city) {
    rows.push({
      name: `全图 ${String(CITY_SIZE)}×${String(CITY_SIZE)}`,
      ...inspect(worldOfCity(generateCity(CITY_SIZE))),
    });
  }
  for (const row of rows) row.pass = row.linePixels === 0 && row.paintedOffDeck === 0;
  return rows;
};

window.markReady = true;
