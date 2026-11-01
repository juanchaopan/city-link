import {
  Container,
  Graphics,
  ImageSource,
  Particle,
  ParticleContainer,
  Rectangle,
  Texture,
} from 'pixi.js';
import { createDrawList } from './sim/drawlist.js';
import { sceneItems } from './sim/sceneitems.js';

// 把图集和城市数据拼成 Pixi 场景。
// 地面分层绘制：地表、田块、人行道、路缘、车道、路面标记，路面的层序保证人行道不会盖到车道上。
// 路面以上的东西都在一串粒子里，按遮挡顺序画：建筑、灯杆、桥墩、桥面和车用同一条规则比较，
// 所以灯杆不会被路面盖住，车从桥下穿过时被桥面挡住，车绕到楼后面时被楼挡住。
// 这一串每帧重排，全部粒子共用一张图集，只有一次绘制调用；视野外的物体不进这一串。
// 亮窗紧跟在所属建筑后面。模块拼装的物业由几张精灵叠成，从下往上画，每张抬高整数像素。

const CHUNK = 16;
const VIEW_PADDING = 300;
const MODULE_FLOOR_LEVELS = 0.5;
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

function batchContainer(particles, area) {
  const container = new ParticleContainer({
    texture: particles[0].texture,
    dynamicProperties: {
      position: false,
      rotation: false,
      uvs: false,
      vertex: false,
      color: false,
    },
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
    .map(([key, list]) => ({
      order: key
        .split(',')
        .map(Number)
        .reduce((a, b) => a + b, 0),
      list,
    }))
    .sort((a, b) => a.order - b.order);
}

/**
 * 地表下面垫一张同色的底。地表精灵在低层 mip 上边缘是半透明的，
 * 没有这张底，缩小全图时格子之间就会透出桌面，夜里桌面比地面亮，看起来就是一张网格。
 */
function underlay(city, palette) {
  const { N, ground } = city;
  const g = new Graphics();
  const colorOf = new Map();
  for (const entry of ground) {
    if (entry.key.startsWith('sk')) continue;
    colorOf.set(
      entry.y * N + entry.x,
      entry.key.startsWith('w-') ? palette.water.deep : palette.ground.grass0,
    );
  }
  for (let y = 0; y < N; y += 1) {
    let start = 0;
    for (let x = 1; x <= N; x += 1) {
      if (x < N && colorOf.get(y * N + x) === colorOf.get(y * N + start)) continue;
      const a = screenOf(start, y, 0);
      const b = screenOf(x, y, 0);
      const c = screenOf(x, y + 1, 0);
      const d = screenOf(start, y + 1, 0);
      g.poly([a.sx, a.sy - 2, b.sx + 3, b.sy, c.sx, c.sy + 2, d.sx - 3, d.sy]).fill(
        colorOf.get(y * N + start),
      );
      start = x;
    }
  }
  return g;
}

/** 一个物体的全部粒子：楼身、模块和亮窗。 */
function particlesOf(atlas, object, { dynamicTint, stress, bodies, lit }) {
  const particles = [];
  const addSprite = (key, sx, sy) => {
    const body = particleFor(atlas, key, sx, sy);
    bodies.push(body);
    particles.push(body);
    const glowKey = `${key}~g`;
    if (dynamicTint && atlas.frames[glowKey]) {
      const glow = particleFor(atlas, glowKey, sx, sy);
      glow.alpha = 0;
      lit.push(glow);
      particles.push(glow);
    }
  };
  const parts = object.modules ?? [{ key: object.key, lift: 0, dx: 0, dy: 0 }];
  for (const { key, lift, dx, dy } of parts) {
    const { sx, sy } = screenOf(
      object.px + dx,
      object.py + dy,
      object.level + lift * MODULE_FLOOR_LEVELS,
    );
    addSprite(key, sx, sy);
  }
  if (stress > 1 && object.parcel !== undefined && !object.modules) {
    const { sx, sy } = screenOf(object.px, object.py, object.level);
    for (let i = 1; i < stress; i += 1) addSprite(object.key, sx, sy);
  }
  return particles;
}

/** 路面以上的场景：一串按遮挡顺序排好的粒子，车每帧插进去。 */
function sceneLayerOf(atlas, city, options) {
  const { sorted, cycles } = sceneItems(city, (key) => atlas.frames[key]);
  const entries = sorted.map((item) => ({
    item,
    particles: particlesOf(atlas, item, options),
    visible: true,
  }));
  const lamps = [];
  for (const { item, particles } of entries) {
    if (item.signal === undefined) continue;
    const key = `lamp-${String(item.dir)}`;
    if (!atlas.frames[key]) continue;
    const { sx, sy } = screenOf(item.px, item.py, item.level);
    const particle = particleFor(atlas, key, sx, sy);
    particles.push(particle);
    lamps.push({ signal: item.signal, phase: item.phase, particle });
  }
  const texture = atlas.textures[Object.keys(atlas.textures)[0]];
  const layer = new ParticleContainer({
    texture,
    dynamicProperties: { position: true, rotation: true, uvs: true, vertex: true, color: true },
  });
  layer.boundsArea = options.area;
  const drawList = createDrawList(sorted);

  const compose = (cars) => {
    const placed = drawList.placeCars(cars);
    const list = [];
    let next = 0;
    for (let i = 0; i < entries.length; i += 1) {
      while (next < placed.length && placed[next].slot <= i) {
        list.push(...placed[next].particles);
        next += 1;
      }
      if (entries[i].visible) list.push(...entries[i].particles);
    }
    while (next < placed.length) {
      list.push(...placed[next].particles);
      next += 1;
    }
    layer.particleChildren = list;
    layer.update();
  };

  const setView = ({ left, right, top, bottom }) => {
    for (const entry of entries) {
      const { item } = entry;
      entry.visible =
        item.left < right + VIEW_PADDING &&
        item.right > left - VIEW_PADDING &&
        item.top < bottom + VIEW_PADDING &&
        item.bottom > top - VIEW_PADDING;
    }
  };

  return { layer, compose, setView, lamps, cycles };
}

/**
 * 拼出一个世界。dynamicTint 为真时物体的颜色逐粒子更新，亮窗才能不受夜色影响。
 * bare 为真时不垫底，露底检查用它看精灵本身有没有缝。
 * stress 大于 1 时每个物业多画几遍，用来量全城都走模块拼装时的开销。
 */
export function buildWorld(
  atlas,
  city,
  { layers, dynamicTint, palette, bare = false, stress = 1 },
) {
  const { N } = city;
  const area = new Rectangle(-N * 80, -400, N * 160, N * 80 + 800);
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
      groundLayer.addChild(batchContainer(particles, area));
      count.sprites += particles.length;
    }
  };
  if (layers.includes('ground')) {
    if (!bare) groundLayer.addChild(underlay(city, palette));
    addCells(city.ground);
  }
  if (layers.includes('overlays')) {
    addCells(city.overlays);
    addCells(city.walks);
    addCells(city.curbs);
    addCells(city.decks);
    addCells(city.marks);
  }

  const world = new Container();
  world.addChild(groundLayer);
  if (!layers.includes('objects')) {
    const idle = () => {};
    return { world, groundLayer, bodies, lit, count, lamps: [], compose: idle, setView: idle };
  }
  const scene = sceneLayerOf(atlas, city, { dynamicTint, stress, area, bodies, lit });
  world.addChild(scene.layer);
  count.sprites += bodies.length + lit.length;
  scene.compose([]);
  return {
    world,
    groundLayer,
    bodies,
    lit,
    count,
    lamps: scene.lamps,
    compose: scene.compose,
    setView: scene.setView,
    cycles: scene.cycles,
  };
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

/** 两个颜色相乘，和 tint 作用在精灵上的效果一样，背景和地面才会一起变暗。 */
export function multiplyColor(a, b) {
  const channel = (shift) =>
    Math.round((((a >> shift) & 255) * ((b >> shift) & 255)) / 255) << shift;
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
