import { Baker } from './kit/bake.js';
import { Builder } from './kit/builder.js';
import { bakeKey } from './kit/catalog.js';
import { palettes } from './kit/palettes.js';
import { roadMesh as legacyMesh } from './kit/roadshader.legacy.js';
import { heightAt } from './kit/tiles.js';
import { traceRoads } from './sim/city.js';
import { cellPaths, spokesOf } from './sim/network.js';
import { roadSprites, roadTag } from './sim/roadsprites.js';

// 路面验收用的场景：把路面按游戏里的方式烘焙成精灵，再按游戏里的层序拼到一张画布上。
// mode 为 legacy 时用保留的旧着色器和逐格绘制的旧层序，用来证明检查抓得到用户报告过的错误。

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

const PAD = 420;
const baker = new Baker();
const cache = new Map();

function canvasOf(sprite) {
  const canvas = new OffscreenCanvas(sprite.w, sprite.h);
  canvas.getContext('2d').putImageData(new ImageData(sprite.data, sprite.w, sprite.h), 0, 0);
  return { canvas, ax: sprite.ax, ay: sprite.ay };
}

function spriteOf(key, palette) {
  const id = `${palette.id}|${key}`;
  if (!cache.has(id)) {
    baker.usePalette(palette);
    cache.set(id, canvasOf(bakeKey(baker, key, palette).result));
  }
  return cache.get(id);
}

/** 旧版本的一格路：一张精灵里同时画人行道和车道，断头路用圆头收尾。 */
function legacySprite(entry, palette, deckHeightOf) {
  const id = `${palette.id}|legacy|${entry.tag}|${entry.shape ?? ''}`;
  if (!cache.has(id)) {
    baker.usePalette(palette);
    const mask = entry.road | entry.highway;
    const paths = cellPaths(entry.road, entry.highway, entry.arterial).map((path) => (spokesOf(mask).length === 1 ? { ...path, clipStart: false } : path));
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

export function worldOf({ N, draw, heights, water = [], gates = [], linked = false }) {
  const { roads, walk } = traceRoads(N);
  draw(walk);
  const corners = (x, y) => (heights ? [heights(x, y), heights(x + 1, y), heights(x + 1, y + 1), heights(x, y + 1)] : [0, 0, 0, 0]);
  const levelOf = (x, y) => Math.min(...corners(x, y));
  const isFlat = (x, y) => new Set(corners(x, y)).size === 1;
  const waterSet = new Set(water);
  const isWater = (x, y) => waterSet.has(y * N + x);
  const sprites = roadSprites({ N, roads, cornersOf: corners, isFlat, levelOf, isWater, gates, linked });
  return { N, roads, sprites, cornersOf: corners, levelOf, isFlat, isWater, gates, linked };
}

export function worldOfCity(city, linked) {
  const { N, roads, cornersOf, levelOf, isFlat, isWater, plan } = city;
  const sprites = roadSprites({ N, roads, cornersOf, isFlat, levelOf, isWater, gates: plan.gates, linked });
  return { N, roads, sprites, cornersOf, levelOf, isFlat, isWater, gates: plan.gates, linked };
}

/** 画布坐标：格子中心 (px, py)、高度 level 对应的画布像素。 */
export function placer(N) {
  const originX = N * 64 + PAD;
  const originY = PAD;
  return {
    width: N * 128 + PAD * 2,
    height: N * 64 + PAD * 2,
    at: (px, py, level) => [originX + (px - py) * 64, originY + (px + py - 1) * 32 - level * 32],
  };
}

export function compose(world, palette, mode, { withGround }) {
  const { N, sprites } = world;
  const place = placer(N);
  const canvas = new OffscreenCanvas(place.width, place.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const stamp = (sprite, x, y, level) => {
    const [sx, sy] = place.at(x + 0.5, y + 0.5, level);
    context.drawImage(sprite.canvas, Math.round(sx - sprite.ax), Math.round(sy - sprite.ay));
  };
  if (withGround) {
    for (let y = 0; y < N; y += 1) {
      for (let x = 0; x < N; x += 1) {
        const level = world.levelOf(x, y);
        const shape = world.cornersOf(x, y).map((v) => v - level).join('');
        const key = world.isWater(x, y) ? 'w-0' : `g-${String(Math.min(3, level))}-${shape}-${String((x * 7 + y * 13) % 3)}`;
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
      if (world.isWater(x, y)) continue;
      const entry = sprites.cells.get(id);
      const level = world.levelOf(x, y);
      const corners = world.cornersOf(x, y).map((v) => v - level);
      const flat = world.isFlat(x, y);
      const deck = flat ? null : (px, pz) => heightAt(corners, px, pz);
      stamp(legacySprite({ ...entry, tag: roadTag(entry), shape: flat ? '' : corners.join('') }, palette, deck), x, y, level);
    }
  } else {
    for (const list of [sprites.walks, sprites.curbs, sprites.decks]) {
      for (const { key, x, y, level } of list) stamp(spriteOf(key, palette), x, y, level);
    }
  }
  for (const { key, x, y, level } of sprites.neighbors) stamp(spriteOf(key, palette), x, y, level);
  for (const { key, x, y } of sprites.bridges) stamp(spriteOf(key, palette), x, y, 0);
  if (withGround) for (const { key, x, y, level } of sprites.planned) stamp(spriteOf(key, palette), x, y, level);
  return { canvas, context, place };
}
