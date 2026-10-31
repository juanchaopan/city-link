import { Application, Container, Graphics, Text } from 'pixi.js';
import { generateCity } from './sim/city.js';
import { resolveStyle } from './sim/packs.js';
import { ZONE } from './sim/zones.js';
import { DIRECTIONS } from './sim/network.js';
import { SERVICES } from './sim/services.js';
import { applyTime, buildWorld, loadAtlas, screenOf, TILE_HALF_H, TILE_HALF_W } from './world.js';
import { palettes } from './kit/palettes.js';

// 可以操作的样张：拖动、双指或滚轮缩放、时间滑块，以及交通、公共服务和地铁三个视图。

const params = new URLSearchParams(location.search);
const N = Number(params.get('n') ?? 64);
const mode = params.get('mode') ?? 'layer';
const seam = params.get('seam') === '1';
const festivalOn = params.get('festival') === '1';
const view = params.get('view') ?? 'city';
const publicLayout = params.get('public') ?? 'spread';
const hudOn = params.get('ui') === '1';
const controlsOn = params.get('controls') !== '0';

// 风格解析和存档无关：缺包时退回标准风格。样张里只装了标准风格。
const installedStyles = { standard: { id: 'standard', atlas: 'sunny' } };
const style = resolveStyle(installedStyles, params.get('style') ?? 'standard');
const palette = palettes[style.atlas];

const app = new Application();
await app.init({
  canvas: document.getElementById('game'),
  width: window.innerWidth,
  height: window.innerHeight,
  resolution: window.devicePixelRatio,
  autoDensity: true,
  antialias: false,
  backgroundColor: seam ? '#ff00ff' : palette.backdrop,
  preference: 'webgl',
  hello: false,
});

const city = generateCity(N, 11, publicLayout);
const atlas = await loadAtlas(style.atlas, festivalOn ? 'national-day' : null);
const layers = seam ? ['ground'] : ['ground', 'overlays', 'objects'];
const scene = buildWorld(atlas, city, { layers, festival: festivalOn, dynamicTint: mode === 'layer' });

const camera = new Container();
camera.addChild(scene.world);
let second = null;
if (mode === 'atlas2') {
  const duskAtlas = await loadAtlas('dusk', null);
  second = buildWorld(duskAtlas, city, { layers, festival: false, dynamicTint: false });
  second.world.alpha = 0;
  camera.addChild(second.world);
}

function table() {
  const g = new Graphics();
  const margin = 60;
  const step = 8;
  for (let i = -margin; i <= N + margin; i += step) {
    g.moveTo((i + margin) * TILE_HALF_W, (i - margin) * TILE_HALF_H).lineTo((i - N - margin) * TILE_HALF_W, (i + N + margin) * TILE_HALF_H);
    g.moveTo((-margin - i) * TILE_HALF_W, (i - margin) * TILE_HALF_H).lineTo((N + margin - i) * TILE_HALF_W, (N + margin + i) * TILE_HALF_H);
  }
  g.stroke({ color: palette.table.line, width: 6 });
  const drop = 52;
  g.poly([
    0, -TILE_HALF_H + drop,
    N * TILE_HALF_W + 34, N * TILE_HALF_H - TILE_HALF_H + drop + 12,
    0, N * 2 * TILE_HALF_H - TILE_HALF_H + drop + 42,
    -N * TILE_HALF_W - 34, N * TILE_HALF_H - TILE_HALF_H + drop + 12,
  ]).fill({ color: palette.table.shadow, alpha: 0.55 });
  return g;
}

if (!seam) camera.addChildAt(table(), 0);

const ground = (px, py) => {
  const level = city.levelOf(Math.min(N - 1, Math.max(0, Math.floor(px))), Math.min(N - 1, Math.max(0, Math.floor(py))));
  return screenOf(px, py, level);
};

function trafficView() {
  const g = new Graphics();
  for (const edge of city.traffic.edges) {
    const a = ground((edge.from % N) + 0.5, Math.floor(edge.from / N) + 0.5);
    const c = ground((edge.to % N) + 0.5, Math.floor(edge.to / N) + 0.5);
    const load = Math.min(1, edge.ratio / 0.8);
    const color = load < 0.5 ? (Math.round(90 + 330 * load) << 16) | (190 << 8) | 90 : (240 << 16) | (Math.round(200 - 340 * (load - 0.5)) << 8) | 60;
    g.moveTo(a.sx, a.sy).lineTo(c.sx, c.sy).stroke({ color, width: 8 + load * 34, cap: 'round' });
  }
  for (const parcel of city.parcels.parcels) {
    if (parcel.access < 0 || parcel.capacity === 0 || parcel.shape === 'field') continue;
    const from = ground(parcel.px, parcel.py);
    const to = ground((parcel.access % N) + 0.5, Math.floor(parcel.access / N) + 0.5);
    g.moveTo(from.sx, from.sy).lineTo(to.sx, to.sy).stroke({ color: 0xffffff, width: 3, alpha: 0.55 });
    g.circle(from.sx, from.sy, 7).fill({ color: 0x1f3a4d, alpha: 0.8 });
  }
  return g;
}

const SERVICE_COLORS = { hospital: 0x2e9e6b, school: 0xd9744a, police: 0x2f5fa8, fire: 0xd6372f, water: 0x3a9fc8, power: 0xe0a92e };

function coverageView() {
  const g = new Graphics();
  const missing = new Map(city.coverage.rows.map((row) => [row.parcel, row.missing.length]));
  for (const parcel of city.parcels.parcels) {
    if (!parcel.polygon || !missing.has(parcel.id)) continue;
    const count = missing.get(parcel.id);
    const color = count === 0 ? 0x2fae6c : count === 1 ? 0xf0c040 : count === 2 ? 0xf08a3c : 0xe03c34;
    const points = parcel.polygon.flatMap(([px, py]) => {
      const { sx, sy } = ground(px, py);
      return [sx, sy];
    });
    g.poly(points).fill({ color, alpha: 0.72 });
  }
  for (const parcel of city.parcels.parcels) {
    if (parcel.shape !== 'service') continue;
    const { sx, sy } = ground(parcel.px, parcel.py);
    g.circle(sx, sy - 20, 34).fill(SERVICE_COLORS[parcel.use]).stroke({ color: 0xffffff, width: 6 });
    const name = SERVICES.find((service) => service.id === parcel.use).name;
    const label = new Text({ text: name, resolution: 2, style: { fontFamily: 'Microsoft YaHei', fontSize: 34, fontWeight: '700', fill: '#ffffff', stroke: { color: '#1f3a4d', width: 6 } } });
    label.anchor.set(0.5, 0);
    label.position.set(sx, sy + 18);
    g.addChild(label);
  }
  return g;
}

function metroView() {
  const g = new Graphics();
  const at = ([x, y]) => screenOf(x + 0.5, y + 0.5, 0);
  for (const line of city.metro.lines) {
    const start = at(line.points[0]);
    g.moveTo(start.sx, start.sy);
    for (const point of line.points.slice(1)) {
      const { sx, sy } = at(point);
      g.lineTo(sx, sy);
    }
    g.stroke({ color: line.color, width: 26, join: 'round', cap: 'round' });
  }
  for (const line of city.metro.lines) {
    for (const station of line.stations) {
      const { sx, sy } = at(station);
      g.circle(sx, sy, 24).fill(0xffffff).stroke({ color: line.color, width: 10 });
    }
    const head = at(line.points[0]);
    const badge = new Graphics();
    badge.circle(head.sx, head.sy - 70, 44).fill(line.color);
    g.addChild(badge);
    const label = new Text({ text: String(line.id), resolution: 2, style: { fontFamily: 'Microsoft YaHei', fontSize: 56, fontWeight: '800', fill: '#ffffff' } });
    label.anchor.set(0.5);
    label.position.set(head.sx, head.sy - 70);
    g.addChild(label);
  }
  for (const crossing of city.metro.crossings) {
    const { sx, sy } = at([crossing.x, crossing.y]);
    if (crossing.interchange) {
      g.circle(sx, sy, 40).fill(0xffffff).stroke({ color: 0x1f3a4d, width: 12 });
      g.circle(sx, sy, 16).fill(0x1f3a4d);
    }
    const text = crossing.interchange ? '换乘站' : '穿过，不设站';
    const label = new Text({ text, resolution: 2, style: { fontFamily: 'Microsoft YaHei', fontSize: 40, fontWeight: '700', fill: '#ffffff', stroke: { color: '#1f3a4d', width: 8 } } });
    label.anchor.set(0.5, 0);
    label.position.set(sx, sy + 46);
    g.addChild(label);
  }
  return g;
}

const views = { traffic: trafficView, coverage: coverageView, metro: metroView };
if (views[view]) {
  if (view === 'metro') scene.world.alpha = 0.22;
  camera.addChild(views[view]());
}
app.stage.addChild(camera);

let zoom = Number(params.get('zoom') ?? (N === 64 ? 0.078 : 0.145));
let focusX = Number(params.get('x') ?? N / 2);
let focusY = Number(params.get('y') ?? N / 2);
let offset = { x: 0, y: 0 };

function applyCamera() {
  const { sx, sy } = screenOf(focusX + 0.5, focusY + 0.5, 0);
  camera.scale.set(zoom);
  camera.position.set(window.innerWidth / 2 - sx * zoom + offset.x, window.innerHeight / 2 - sy * zoom + offset.y);
}
applyCamera();

let hour = Number(params.get('t') ?? 12);
function setTime(next) {
  hour = next;
  const state = applyTime(scene, hour);
  if (second) {
    const fade = Math.min(1, Math.max(0, state.glow * 1.25));
    second.world.alpha = fade;
    second.groundLayer.tint = hour > 8 && hour < 20 ? 0xffffff : 0x8088c0;
    second.objectLayer.tint = hour > 8 && hour < 20 ? 0xffffff : 0x8088c0;
  }
  const label = document.getElementById('clock');
  if (label) label.textContent = `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;
}
setTime(hour);

if (hudOn) {
  const { createHud } = await import('./hud.js');
  app.stage.addChild(await createHud({ atlas, palette, width: window.innerWidth, height: window.innerHeight }));
}

// 拖动和缩放。
const pointers = new Map();
let pinch = null;
const canvas = app.canvas;
const zoomAt = (factor, cx, cy) => {
  const next = Math.max(0.05, Math.min(1.4, zoom * factor));
  const ratio = next / zoom;
  offset.x = cx - window.innerWidth / 2 - (cx - window.innerWidth / 2 - offset.x) * ratio;
  offset.y = cy - window.innerHeight / 2 - (cy - window.innerHeight / 2 - offset.y) * ratio;
  zoom = next;
  applyCamera();
};
canvas.addEventListener('pointerdown', (event) => {
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  const last = pointers.get(event.pointerId);
  if (!last) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 1) {
    offset.x += event.clientX - last.x;
    offset.y += event.clientY - last.y;
    applyCamera();
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) zoomAt(distance / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
    pinch = distance;
  }
});
const release = (event) => {
  pointers.delete(event.pointerId);
  pinch = null;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  zoomAt(event.deltaY < 0 ? 1.12 : 0.89, event.clientX, event.clientY);
}, { passive: false });

// 控制面板。游戏 1 天是现实 24 分钟；快放时 1 秒走 1 小时。
const panel = document.getElementById('controls');
if (panel && controlsOn) {
  panel.hidden = false;
  const slider = document.getElementById('time');
  slider.value = String(hour);
  slider.addEventListener('input', () => setTime(Number(slider.value)));
  let playing = false;
  const play = document.getElementById('play');
  play.addEventListener('click', () => {
    playing = !playing;
    play.textContent = playing ? '暂停' : '快放一天';
  });
  app.ticker.add((ticker) => {
    if (!playing) return;
    setTime((hour + ticker.deltaMS / 1000) % 24);
    slider.value = String(hour);
  });
  const select = document.getElementById('view');
  select.value = view;
  select.addEventListener('change', () => {
    const url = new URL(location.href);
    url.searchParams.set('view', select.value);
    location.href = url.toString();
  });
  const festival = document.getElementById('festival');
  festival.checked = festivalOn;
  festival.addEventListener('change', () => {
    const url = new URL(location.href);
    url.searchParams.set('festival', festival.checked ? '1' : '0');
    location.href = url.toString();
  });
}

window.sceneStats = {
  sprites: scene.count.sprites + (second?.count.sprites ?? 0),
  atlas: [atlas.width, atlas.height],
  zone: Object.keys(ZONE).length,
  directions: DIRECTIONS.length,
};

window.setHour = setTime;

window.measureFps = (seconds, cycleDay) =>
  new Promise((resolve) => {
    const deltas = [];
    let previous = performance.now();
    const started = previous;
    const pan = (time) => {
      const now = performance.now();
      deltas.push(now - previous);
      previous = now;
      offset.x += Math.sin(time / 300) * 2;
      offset.y += Math.cos(time / 400) * 2;
      applyCamera();
      if (cycleDay) setTime(((now - started) / 250) % 24);
      if (now - started < seconds * 1000) requestAnimationFrame(pan);
      else {
        const sorted = deltas.slice(5).sort((a, b) => a - b);
        const at = (q) => sorted[Math.floor(sorted.length * q)];
        resolve({ frames: sorted.length, p50fps: 1000 / at(0.5), p95fps: 1000 / at(0.95), worstFps: 1000 / sorted[sorted.length - 1] });
      }
    };
    requestAnimationFrame(pan);
  });

document.documentElement.dataset.ready = 'true';
