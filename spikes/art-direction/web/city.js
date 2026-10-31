import {
  Application,
  Container,
  ImageSource,
  Particle,
  ParticleContainer,
  Rectangle,
  Texture,
} from 'pixi.js';
import { LEVEL_PIXELS, TILE_HALF_H, TILE_HALF_W } from './constants.js';
import { makeLayout } from './kit/layout.js';

const CHUNK = 16;

export function screenOf(x, y, level) {
  return { sx: (x - y) * TILE_HALF_W, sy: (x + y) * TILE_HALF_H - level * LEVEL_PIXELS };
}

async function loadImage(url) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

export async function loadAtlas(id) {
  const [image, frames] = await Promise.all([
    loadImage(`/out/atlas-${id}.png`),
    fetch(`/out/atlas-${id}.json`).then((r) => r.json()),
  ]);
  const source = new ImageSource({
    resource: image,
    autoGenerateMipmaps: true,
    scaleMode: 'linear',
    mipmapFilter: 'linear',
    maxAnisotropy: 4,
  });
  const textures = {};
  for (const [key, frame] of Object.entries(frames)) {
    textures[key] = new Texture({
      source,
      frame: new Rectangle(frame.x, frame.y, frame.w, frame.h),
    });
  }
  return { source, frames, textures, width: image.width, height: image.height };
}

function chunkContainer(atlas, entries) {
  const first = atlas.textures[entries[0].key];
  const container = new ParticleContainer({
    texture: first,
    dynamicProperties: { position: false, rotation: false, uvs: false, vertex: false, color: false },
  });
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entry of entries) {
    const frame = atlas.frames[entry.key];
    const { sx, sy } = screenOf(entry.x, entry.y, entry.level);
    container.addParticle(
      new Particle({
        texture: atlas.textures[entry.key],
        x: sx,
        y: sy,
        anchorX: frame.ax / frame.w,
        anchorY: frame.ay / frame.h,
      }),
    );
    minX = Math.min(minX, sx - frame.ax);
    minY = Math.min(minY, sy - frame.ay);
    maxX = Math.max(maxX, sx - frame.ax + frame.w);
    maxY = Math.max(maxY, sy - frame.ay + frame.h);
  }
  container.boundsArea = new Rectangle(minX, minY, maxX - minX, maxY - minY);
  return container;
}

function byChunk(entries) {
  const chunks = new Map();
  for (const entry of entries) {
    const key = `${Math.floor(entry.x / CHUNK)},${Math.floor(entry.y / CHUNK)}`;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(entry);
  }
  return [...chunks.entries()]
    .map(([key, list]) => ({ order: key.split(',').map(Number).reduce((a, b) => a + b, 0), list }))
    .sort((a, b) => a.order - b.order);
}

function diagonalBands(entries) {
  const bands = new Map();
  for (const entry of entries) {
    const band = Math.floor((entry.x + entry.y) / CHUNK);
    if (!bands.has(band)) bands.set(band, []);
    bands.get(band).push(entry);
  }
  return [...bands.keys()].sort((a, b) => a - b).map((band) => bands.get(band));
}

/** 按图层拼出整座城。layers 用来做拼缝检查时只画地表。 */
export function buildWorld(atlas, N, layers = ['ground', 'overlays', 'objects']) {
  const layout = makeLayout(N);
  const world = new Container();
  const count = { sprites: 0 };
  if (layers.includes('ground')) {
    for (const { list } of byChunk(layout.ground)) {
      world.addChild(chunkContainer(atlas, list));
      count.sprites += list.length;
    }
  }
  if (layers.includes('overlays')) {
    for (const { list } of byChunk(layout.overlays)) {
      world.addChild(chunkContainer(atlas, list));
      count.sprites += list.length;
    }
  }
  if (layers.includes('objects')) {
    for (const list of diagonalBands(layout.objects)) {
      world.addChild(chunkContainer(atlas, list));
      count.sprites += list.length;
    }
  }
  return { world, layout, count };
}

export async function createApp(canvas, background) {
  const app = new Application();
  await app.init({
    canvas,
    width: window.innerWidth,
    height: window.innerHeight,
    resolution: window.devicePixelRatio,
    autoDensity: true,
    antialias: false,
    backgroundColor: background,
    preference: 'webgl',
    hello: false,
  });
  return app;
}
