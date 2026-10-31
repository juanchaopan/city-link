import { Container, ImageSource, Particle, ParticleContainer, Rectangle, Texture } from 'pixi.js';
import { sortByDepth } from './sim/order.js';

// 把图集和城市数据拼成 Pixi 场景。
// 物体按拓扑排序后的顺序画；亮窗和节日层紧跟在所属建筑后面，都在同一张纹理上，不增加换纹理的次数。

const CHUNK = 16;
const BATCH = 3000;
export const TILE_HALF_W = 64;
export const TILE_HALF_H = 32;
export const LEVEL_PIXELS = 32;

/** 地面坐标到屏幕像素。px、py 是格角坐标，格子 (x, y) 的中心是 (x+0.5, y+0.5)。 */
export function screenOf(px, py, level) {
  return { sx: (px - py) * TILE_HALF_W, sy: (px + py - 1) * TILE_HALF_H - level * LEVEL_PIXELS };
}

async function loadImage(url) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

/** 节日层画进主图集下方预留的区域，所以开节日不用多一张纹理，结束后重新载入图集就恢复。 */
export async function loadAtlas(id, festival) {
  const [image, frames] = await Promise.all([
    loadImage(`/out/atlas-${id}.png`),
    fetch(`/out/atlas-${id}.json`).then((r) => r.json()),
  ]);
  const merged = { ...frames };
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  if (festival) {
    const [overlay, overlayFrames] = await Promise.all([
      loadImage(`/out/festival-${festival}.png`),
      fetch(`/out/festival-${festival}.json`).then((r) => r.json()),
    ]);
    canvas.height = image.height + overlay.height;
    canvas.getContext('2d').drawImage(overlay, 0, image.height);
    for (const [key, frame] of Object.entries(overlayFrames)) {
      merged[key] = { ...frame, y: frame.y + image.height };
    }
  }
  canvas.getContext('2d').drawImage(image, 0, 0);
  const source = new ImageSource({
    resource: canvas,
    autoGenerateMipmaps: true,
    scaleMode: 'linear',
    mipmapFilter: 'linear',
    maxAnisotropy: 4,
  });
  const textures = {};
  for (const [key, frame] of Object.entries(merged)) {
    textures[key] = new Texture({ source, frame: new Rectangle(frame.x, frame.y, frame.w, frame.h) });
  }
  return { source, frames: merged, textures, width: canvas.width, height: canvas.height };
}

function particleFor(atlas, key, sx, sy) {
  const frame = atlas.frames[key];
  return new Particle({
    texture: atlas.textures[key],
    x: sx,
    y: sy,
    anchorX: frame.ax / frame.w,
    anchorY: frame.ay / frame.h,
  });
}

function batchContainer(atlas, particles, dynamicColor, area) {
  const container = new ParticleContainer({
    texture: particles[0].texture,
    dynamicProperties: { position: false, rotation: false, uvs: false, vertex: false, color: dynamicColor },
  });
  for (const particle of particles) container.addParticle(particle);
  container.boundsArea = area;
  return container;
}

function byChunk(entries) {
  const chunks = new Map();
  for (const entry of entries) {
    const key = `${String(Math.floor(entry.x / CHUNK))},${String(Math.floor(entry.y / CHUNK))}`;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(entry);
  }
  return [...chunks.entries()]
    .map(([key, list]) => ({ order: key.split(',').map(Number).reduce((a, b) => a + b, 0), list }))
    .sort((a, b) => a.order - b.order);
}

function screenBox(atlas, object) {
  const { sx, sy } = screenOf(object.px, object.py, object.level);
  const frame = atlas.frames[object.key];
  return {
    left: sx - frame.ax,
    right: sx - frame.ax + frame.w,
    top: sy - frame.ay,
    bottom: sy - frame.ay + frame.h,
  };
}

/** 拼出一个世界。dynamicTint 为真时物体的颜色逐粒子更新，亮窗才能不受夜色影响。 */
export function buildWorld(atlas, city, { layers, festival, dynamicTint }) {
  const { N } = city;
  const area = new Rectangle(-N * 80, -200, N * 160, N * 80 + 400);
  const groundLayer = new Container();
  const lit = [];
  const bodies = [];
  const count = { sprites: 0 };

  const addCells = (entries) => {
    for (const { list } of byChunk(entries)) {
      const particles = list.map((entry) => {
        const { sx, sy } = screenOf(entry.x + 0.5, entry.y + 0.5, entry.level);
        return particleFor(atlas, entry.key, sx, sy);
      });
      groundLayer.addChild(batchContainer(atlas, particles, false, area));
      count.sprites += particles.length;
    }
  };
  if (layers.includes('ground')) addCells(city.ground);
  if (layers.includes('overlays')) addCells(city.overlays);

  const objectLayer = new Container();
  if (layers.includes('objects')) {
    const items = city.objects.map((object) => ({ ...object, ...screenBox(atlas, object) }));
    const { sorted } = sortByDepth(items);
    let current = [];
    const flush = () => {
      if (current.length === 0) return;
      objectLayer.addChild(batchContainer(atlas, current, dynamicTint, area));
      current = [];
    };
    for (const object of sorted) {
      const { sx, sy } = screenOf(object.px, object.py, object.level);
      const body = particleFor(atlas, object.key, sx, sy);
      bodies.push(body);
      current.push(body);
      const glowKey = `${object.key}~g`;
      if (dynamicTint && atlas.frames[glowKey]) {
        const glow = particleFor(atlas, glowKey, sx, sy);
        glow.alpha = 0;
        lit.push(glow);
        current.push(glow);
      }
      const decoration = `fx-${object.footprintKey}`;
      if (festival && object.footprintKey && atlas.frames[decoration]) {
        const layer = particleFor(atlas, decoration, sx, sy);
        bodies.push(layer);
        current.push(layer);
      }
      if (current.length >= BATCH) flush();
    }
    flush();
    count.sprites += bodies.length + lit.length;
  }

  const world = new Container();
  world.addChild(groundLayer, objectLayer);
  return { world, groundLayer, objectLayer, bodies, lit, count };
}

const KEYFRAMES = [
  [0, 0x39457e, 1],
  [5, 0x39457e, 1],
  [6.5, 0xffa98c, 0.6],
  [8, 0xfff0e0, 0],
  [12, 0xffffff, 0],
  [17, 0xfff2df, 0],
  [18.5, 0xff9a6c, 0.25],
  [19.7, 0x8a6aa8, 0.85],
  [21, 0x39457e, 1],
  [24, 0x39457e, 1],
];

function lerpColor(a, b, t) {
  const channel = (shift) => {
    const from = (a >> shift) & 255;
    const to = (b >> shift) & 255;
    return Math.round(from + (to - from) * t) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

/** 一天里任意时刻的整体色调和亮窗强度，关键帧之间线性过渡，所以是连续的。 */
export function dayState(hour) {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 0; i < KEYFRAMES.length - 1; i += 1) {
    const [h0, c0, g0] = KEYFRAMES[i];
    const [h1, c1, g1] = KEYFRAMES[i + 1];
    if (h >= h0 && h <= h1) {
      const t = (h - h0) / (h1 - h0);
      return { tint: lerpColor(c0, c1, t), glow: g0 + (g1 - g0) * t };
    }
  }
  return { tint: 0xffffff, glow: 0 };
}

export function applyTime(scene, hour) {
  const { tint, glow } = dayState(hour);
  scene.groundLayer.tint = tint;
  for (const body of scene.bodies) body.tint = tint;
  for (const particle of scene.lit) particle.alpha = glow;
  return { tint, glow };
}
