import { Baker } from './kit/bake.js';
import { Builder } from './kit/builder.js';
import { bakeKey } from './kit/catalog.js';
import { palettes } from './kit/palettes.js';
import { roadMesh as legacyMesh } from './kit/roadshader.legacy.js';
import { heightAt } from './kit/tiles.js';
import { traceRoads } from './sim/city.js';
import { cellPaths, spokesOf } from './sim/network.js';
import { roadTag } from './sim/roadsprites.js';
import { shapeOf } from './sim/surface.js';
import { roadWorld, terrainOf } from './sim/terrainworld.js';

// 路面验收用的场景：把路面按游戏里的方式烘焙成精灵，再按游戏里的层序拼到一张画布上。
// mode 为 legacy 时用保留的旧着色器和逐格绘制的旧层序，用来证明检查抓得到用户报告过的错误。
// region 只拼地图的一块，查局部时不用付整张地图的内存；块外 REGION_MARGIN 格以内的精灵也画，块边上的像素才完整。
// 128×128 整张拼不下：画布超过浏览器的上限，像素也有六百兆。regionsOf 把地图切成 64 格见方的块，检查一块一块读。
// world.low 是贴地的匝道路面，和路面同一层，画在车道上面。world.covered 是立交、环岛这些结构占的格子，
// 路在这些格子里由结构接着画，不是断头。
// 拼图的大画布全程只有一张：改尺寸时旧的像素立刻释放，不等垃圾回收。上一次 compose 的结果读完再拼下一张。
// 精灵的画布都留在内存里，不上显卡：它们只被画到大画布上，放显卡只会多占一份，还要来回传。

/** 遮罩配色：车道红、人行道绿、路缘蓝、标线黄，其余路基构件是灰，一个像素属于哪一层是读出来的。 */
export const MASK = {
  ...palettes.sunny,
  id: 'mask',
  grade: { saturation: 1, contrast: 1 },
  window: { ...palettes.sunny.window, layer: false },
  road: {
    ...palettes.sunny.road,
    asphalt: '#ff0000',
    highway: '#ff0000',
    walk: '#00ff00',
    shoulder: '#00ff00',
    curb: '#0000ff',
    line: '#ffff00',
    median: '#ffff00',
    rail: '#808080',
    bridge: '#808080',
    wall: '#808080',
    fill: '#808080',
  },
};

export const CLASS = { empty: 0, deck: 1, walk: 2, curb: 3, other: 4 };
export const REGION_TILE = 64;
const REGION_MARGIN = 3;

/** 标线是红加绿，混在车道上还是车道；只有蓝色分量明显或者绿色压过红色才算别的层。 */
export function classify(r, g, b, a) {
  if (a < 128) return CLASS.empty;
  if (r > 60 && b < r * 0.35 && g < r * 1.25) return CLASS.deck;
  if (g > 60 && r < g * 0.35 && b < g * 0.35) return CLASS.walk;
  if (b > 60 && r < b * 0.35 && g < b * 0.35) return CLASS.curb;
  return CLASS.other;
}

/** 整张画布的读取函数，读一次像素，之后按坐标查层。 */
export function readerOf(context, width, height) {
  const { data } = context.getImageData(0, 0, width, height);
  return (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return CLASS.empty;
    const i = (y * width + x) * 4;
    return classify(data[i], data[i + 1], data[i + 2], data[i + 3]);
  };
}

/** 地图切成的块，每块 [x0, y0, x1, y1]，不超过 REGION_TILE 格见方。 */
export function regionsOf(N, tile = REGION_TILE) {
  const regions = [];
  for (let y = 0; y < N; y += tile) {
    for (let x = 0; x < N; x += tile) {
      regions.push([x, y, Math.min(N, x + tile), Math.min(N, y + tile)]);
    }
  }
  return regions;
}

export const insideRegion = ([x0, y0, x1, y1], x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;

const PAD = 420;
const baker = new Baker();
const cache = new Map();
const stage = new OffscreenCanvas(1, 1);
const stageContext = stage.getContext('2d', { willReadFrequently: true });

function canvasOf(sprite) {
  const canvas = new OffscreenCanvas(sprite.w, sprite.h);
  canvas
    .getContext('2d', { willReadFrequently: true })
    .putImageData(new ImageData(sprite.data, sprite.w, sprite.h), 0, 0);
  return { canvas, ax: sprite.ax, ay: sprite.ay };
}

export function spriteOf(key, palette) {
  const id = `${palette.id}|${key}`;
  if (!cache.has(id)) {
    baker.usePalette(palette);
    cache.set(id, canvasOf(bakeKey(baker, key, palette).result));
  }
  return cache.get(id);
}

/** 排序要用的精灵尺寸。 */
export const frameOf = (palette) => (key) => {
  const { canvas, ax, ay } = spriteOf(key, palette);
  return { w: canvas.width, h: canvas.height, ax, ay };
};

/** 旧版本的一格路：一张精灵里同时画人行道和车道，断头路用圆头收尾。 */
function legacySprite(entry, palette, deckHeightOf) {
  const id = `${palette.id}|legacy|${entry.tag}|${entry.shape ?? ''}`;
  if (!cache.has(id)) {
    baker.usePalette(palette);
    const mask = entry.road | entry.highway;
    const paths = cellPaths(entry.road, entry.highway, entry.arterial).map((path) =>
      spokesOf(mask).length === 1 ? { ...path, clipStart: false } : path,
    );
    const spec = {
      w: 400,
      h: 340,
      anchorY: 200,
      lit: false,
      build: () => new Builder(1),
      extra: () => [legacyMesh(paths, palette, deckHeightOf)],
    };
    cache.set(id, canvasOf(baker.bake(spec)));
  }
  return cache.get(id);
}

export function worldOf({ N, draw, heights, water = [], gates = [] }) {
  const { roads, walk } = traceRoads(N);
  draw(walk);
  const waterSet = new Set(water);
  const isWater = (x, y) => waterSet.has(y * N + x);
  const corner = heights ?? (() => 0);
  const { cornersOf, levelOf, isFlat } = terrainOf({ N, roads, corner, isWater });
  const road = roadWorld({ N, roads, cornersOf, levelOf, isFlat, isWater, gates });
  return { N, roads, ...road, cornersOf, levelOf, isFlat, isWater, gates, covered: new Set() };
}

export function worldOfCity(city) {
  const { N, roads, cornersOf, levelOf, isFlat, isWater, plan, reserved } = city;
  const { gates } = plan;
  const road = roadWorld({ N, roads, cornersOf, levelOf, isFlat, isWater, gates });
  return { N, roads, ...road, cornersOf, levelOf, isFlat, isWater, gates, covered: reserved };
}

/** 画布坐标：格子中心 (px, py)、高度 level 对应的画布像素。region 是 [x0, y0, x1, y1]，默认整张地图。 */
export function placer(N, region = [0, 0, N, N]) {
  const [x0, y0, x1, y1] = region;
  const left = (x0 - y1) * 64;
  const right = (x1 - y0) * 64;
  const top = (x0 + y0 - 1) * 32;
  const bottom = (x1 + y1) * 32;
  const originX = PAD - left;
  const originY = PAD - top;
  return {
    width: right - left + PAD * 2,
    height: bottom - top + PAD * 2,
    at: (px, py, level) => [originX + (px - py) * 64, originY + (px + py - 1) * 32 - level * 32],
  };
}

export function compose(world, palette, mode, { withGround, region }) {
  const { N, sprites, low = [] } = world;
  const place = placer(N, region);
  stage.width = place.width;
  stage.height = place.height;
  const canvas = stage;
  const context = stageContext;
  const [x0, y0, x1, y1] = region ?? [0, 0, N, N];
  const drawn = [x0 - REGION_MARGIN, y0 - REGION_MARGIN, x1 + REGION_MARGIN, y1 + REGION_MARGIN];
  const inside = (x, y) => insideRegion(drawn, x, y);
  const stamp = (sprite, x, y, level) => {
    const [sx, sy] = place.at(x + 0.5, y + 0.5, level);
    context.drawImage(sprite.canvas, Math.round(sx - sprite.ax), Math.round(sy - sprite.ay));
  };
  if (withGround) {
    for (let y = Math.max(0, drawn[1]); y < Math.min(N, drawn[3]); y += 1) {
      for (let x = Math.max(0, drawn[0]); x < Math.min(N, drawn[2]); x += 1) {
        const level = world.levelOf(x, y);
        const shape = shapeOf(world.cornersOf(x, y), level);
        const key = world.isWater(x, y)
          ? 'w-0'
          : `g-${String(Math.min(3, level))}-${shape}-${String((x * 7 + y * 13) % 3)}`;
        stamp(spriteOf(key, palette), x, y, world.isWater(x, y) ? 0 : level);
      }
    }
  }
  if (mode === 'legacy') {
    const chunkOrder = [...sprites.cells.keys()].sort((a, b) => {
      const chunk = (id) => Math.floor((id % N) / 16) + Math.floor(Math.floor(id / N) / 16);
      return chunk(a) - chunk(b) || a - b;
    });
    for (const id of chunkOrder) {
      const x = id % N;
      const y = Math.floor(id / N);
      if (world.isWater(x, y) || !inside(x, y)) continue;
      const entry = sprites.cells.get(id);
      const level = world.levelOf(x, y);
      const corners = world.cornersOf(x, y).map((v) => v - level);
      const flat = world.isFlat(x, y);
      const deck = flat ? null : (px, pz) => heightAt(corners, px, pz);
      stamp(
        legacySprite(
          { ...entry, tag: roadTag(entry), shape: flat ? '' : corners.join('') },
          palette,
          deck,
        ),
        x,
        y,
        level,
      );
    }
  } else {
    for (const list of [sprites.walks, sprites.curbs, sprites.decks, low]) {
      for (const { key, x, y, level } of list) {
        if (inside(x, y)) stamp(spriteOf(key, palette), x, y, level);
      }
    }
  }
  for (const { key, x, y } of sprites.bridges) {
    if (inside(x, y)) stamp(spriteOf(key, palette), x, y, 0);
  }
  if (withGround) {
    for (const { key, x, y, level } of sprites.planned) {
      if (inside(x, y)) stamp(spriteOf(key, palette), x, y, level);
    }
  }
  return { canvas, context, place };
}

/**
 * 读一批世界坐标上的像素层：地图一块一块拼遮罩，每块只读落在这一块里的点，返回和 points 等长的结果。
 * around 为真的点读它周围一圈，有一个像素在人行道或路缘上就返回 true。
 */
export function readPoints(world, points, { withGround = false } = {}) {
  const { N } = world;
  const found = new Array(points.length).fill(CLASS.empty);
  for (const region of regionsOf(N)) {
    const indices = [];
    points.forEach((point, index) => {
      if (insideRegion(region, Math.floor(point.px), Math.floor(point.py))) indices.push(index);
    });
    if (indices.length === 0) continue;
    const { canvas, context, place } = compose(world, MASK, 'current', { withGround, region });
    const read = readerOf(context, canvas.width, canvas.height);
    for (const index of indices) {
      const { px, py, level, around } = points[index];
      const [sx, sy] = place.at(px, py, level);
      const x = Math.round(sx);
      const y = Math.round(sy);
      if (!around) {
        found[index] = read(x, y);
        continue;
      }
      let onSidewalk = false;
      for (let dy = -1; dy <= 1 && !onSidewalk; dy += 1) {
        for (let dx = -1; dx <= 1 && !onSidewalk; dx += 1) {
          const value = read(x + dx, y + dy);
          onSidewalk = value === CLASS.walk || value === CLASS.curb;
        }
      }
      found[index] = onSidewalk;
    }
  }
  return found;
}
