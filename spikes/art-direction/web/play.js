import { Application, Color, Container, Graphics, Text } from 'pixi.js';
import { generateCity } from './sim/city.js';
import { generateRoadDemo } from './sim/roaddemo.js';
import { resolveStyle } from './sim/packs.js';
import { SERVICES } from './sim/services.js';
import { createVehicles } from './vehicles.js';
import {
  applyTime,
  buildWorld,
  loadAtlas,
  multiplyColor,
  screenOf,
  TILE_HALF_H,
  TILE_HALF_W,
} from './world.js';
import { palettes } from './kit/palettes.js';

// 可以操作的样张：拖动、双指或滚轮缩放、时间滑块、交通、公共服务和地铁三个视图、和邻城打通的开关，
// 以及四级道路的立交场景。车流和红绿灯是纯视觉层，不改变任何结算结果。

const params = new URLSearchParams(location.search);
const sceneName = params.get('scene') ?? 'city';
const mode = params.get('mode') ?? 'layer';
const seam = params.get('seam') === '1';
const seamBackground = params.get('backdrop');
const festivalOn = params.get('festival') === '1';
const linked = params.get('linked') === '1';
const view = params.get('view') ?? 'city';
const publicLayout = params.get('public') ?? 'spread';
const hudOn = params.get('ui') === '1';
const controlsOn = params.get('controls') !== '0';
const carCap = Number(params.get('cars') ?? 300);
const stress = Number(params.get('stress') ?? 1);

// 风格解析和存档无关：缺包时退回标准风格。样张里只装了标准风格。
const installedStyles = { standard: { id: 'standard', atlas: 'sunny' } };
const style = resolveStyle(installedStyles, params.get('style') ?? 'standard');
const palette = palettes[style.atlas];
const backdrop = new Color(palette.backdrop).toNumber();

const app = new Application();
await app.init({
  canvas: document.getElementById('game'),
  width: window.innerWidth,
  height: window.innerHeight,
  resolution: window.devicePixelRatio,
  autoDensity: true,
  antialias: false,
  backgroundColor: seam ? (seamBackground ?? '#ff00ff') : palette.backdrop,
  preference: 'webgl',
  hello: false,
});

const city =
  sceneName === 'interchange'
    ? generateRoadDemo()
    : generateCity(Number(params.get('n') ?? 64), 11, publicLayout, linked);
const { N } = city;
const atlas = await loadAtlas(style.atlas, festivalOn ? 'national-day' : null);
const layers = seam ? ['ground'] : ['ground', 'overlays', 'objects'];
const bare = params.get('bare') === '1';
const scene = buildWorld(atlas, city, {
  layers,
  festival: festivalOn,
  dynamicTint: mode === 'layer',
  palette,
  bare,
  stress,
});
const vehicles =
  !seam && carCap > 0 && atlas.frames.lamp
    ? createVehicles(atlas, city, scene, { cap: carCap })
    : null;

const camera = new Container();
camera.addChild(scene.world);
let second = null;
if (mode === 'atlas2') {
  const duskAtlas = await loadAtlas('dusk', null);
  second = buildWorld(duskAtlas, city, {
    layers,
    festival: false,
    dynamicTint: false,
    palette: palettes.dusk,
  });
  second.world.alpha = 0;
  camera.addChild(second.world);
}

function table() {
  const g = new Graphics();
  const margin = 60;
  const step = 8;
  for (let i = -margin; i <= N + margin; i += step) {
    g.moveTo((i + margin) * TILE_HALF_W, (i - margin) * TILE_HALF_H).lineTo(
      (i - N - margin) * TILE_HALF_W,
      (i + N + margin) * TILE_HALF_H,
    );
    g.moveTo((-margin - i) * TILE_HALF_W, (i - margin) * TILE_HALF_H).lineTo(
      (N + margin - i) * TILE_HALF_W,
      (N + margin + i) * TILE_HALF_H,
    );
  }
  g.stroke({ color: palette.table.line, width: 6 });
  const drop = 52;
  g.poly([
    0,
    -TILE_HALF_H + drop,
    N * TILE_HALF_W + 34,
    N * TILE_HALF_H - TILE_HALF_H + drop + 12,
    0,
    N * 2 * TILE_HALF_H - TILE_HALF_H + drop + 42,
    -N * TILE_HALF_W - 34,
    N * TILE_HALF_H - TILE_HALF_H + drop + 12,
  ]).fill({ color: palette.table.shadow, alpha: 0.55 });
  return g;
}

const tableLayer = seam ? null : table();
if (tableLayer) camera.addChildAt(tableLayer, 0);

const ground = (px, py) => {
  const level = city.levelOf(
    Math.min(N - 1, Math.max(0, Math.floor(px))),
    Math.min(N - 1, Math.max(0, Math.floor(py))),
  );
  return screenOf(px, py, level);
};

function label(text, x, y, size, anchorY = 0) {
  const item = new Text({
    text,
    resolution: 2,
    style: {
      fontFamily: 'Microsoft YaHei',
      fontSize: size,
      fontWeight: '700',
      fill: '#ffffff',
      stroke: { color: '#1f3a4d', width: size / 5 },
    },
  });
  item.anchor.set(0.5, anchorY);
  item.position.set(x, y);
  return item;
}

function loadColor(load) {
  if (load < 0.5) return (Math.round(70 + 340 * load) << 16) | (190 << 8) | 90;
  return (235 << 16) | (Math.round(190 - 340 * (load - 0.5)) << 8) | 50;
}

function trafficView() {
  scene.world.alpha = 0.55;
  const g = new Graphics();
  for (const edge of city.traffic.edges) {
    const a = ground((edge.from % N) + 0.5, Math.floor(edge.from / N) + 0.5);
    const c = ground((edge.to % N) + 0.5, Math.floor(edge.to / N) + 0.5);
    const load = Math.min(1, edge.ratio / 0.8);
    g.moveTo(a.sx, a.sy)
      .lineTo(c.sx, c.sy)
      .stroke({ color: loadColor(load), width: 16 + load * 44, cap: 'round' });
  }
  for (const parcel of city.parcels.parcels) {
    if (
      parcel.access < 0 ||
      parcel.capacity === 0 ||
      parcel.shape === 'field' ||
      parcel.shape === 'farmhouse'
    )
      continue;
    const from = ground(parcel.px, parcel.py);
    const to = ground((parcel.access % N) + 0.5, Math.floor(parcel.access / N) + 0.5);
    g.moveTo(from.sx, from.sy)
      .lineTo(to.sx, to.sy)
      .stroke({ color: 0x1f3a4d, width: 4, alpha: 0.7 });
    g.circle(from.sx, from.sy, 10).fill(0x1f3a4d);
  }
  return g;
}

const SERVICE_COLORS = {
  hospital: 0x2e9e6b,
  school: 0xd9744a,
  police: 0x2f5fa8,
  fire: 0xd6372f,
  water: 0x3a9fc8,
  power: 0xe0a92e,
};

function coverageView() {
  scene.world.alpha = 0.4;
  const g = new Graphics();
  const missing = new Map(city.coverage.rows.map((row) => [row.parcel, row.missing.length]));
  for (const parcel of city.parcels.parcels) {
    if (!parcel.polygon || !missing.has(parcel.id)) continue;
    const count = missing.get(parcel.id);
    const color =
      count === 0 ? 0x2fae6c : count === 1 ? 0xf0c040 : count === 2 ? 0xf08a3c : 0xe03c34;
    const points = parcel.polygon.flatMap(([px, py]) => {
      const { sx, sy } = ground(px, py);
      return [sx, sy];
    });
    g.poly(points).fill({ color, alpha: 0.9 });
  }
  for (const parcel of city.parcels.parcels) {
    if (parcel.shape !== 'service') continue;
    const { sx, sy } = ground(parcel.px, parcel.py);
    g.circle(sx, sy, 40).fill(SERVICE_COLORS[parcel.use]).stroke({ color: 0xffffff, width: 7 });
    const name = SERVICES.find((service) => service.id === parcel.use).name;
    g.addChild(label(name, sx, sy + 44, 52));
  }
  return g;
}

function metroView() {
  scene.world.alpha = 0.22;
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
    badge.circle(head.sx, head.sy - 74, 50).fill(line.color);
    g.addChild(badge);
    g.addChild(label(String(line.id), head.sx, head.sy - 74, 64, 0.5));
  }
  for (const crossing of city.metro.crossings) {
    const { sx, sy } = at([crossing.x, crossing.y]);
    if (crossing.interchange) {
      g.circle(sx, sy, 40).fill(0xffffff).stroke({ color: 0x1f3a4d, width: 12 });
      g.circle(sx, sy, 16).fill(0x1f3a4d);
    }
    g.addChild(label(crossing.interchange ? '换乘站' : '穿过，不设站', sx, sy + 48, 46));
  }
  return g;
}

const LEGENDS = {
  traffic: '线越粗越红，路段负担越重。黑点是物业，黑线连到它的出入口路段。',
  coverage: `绿：六种服务都到位；黄、橙、红：缺 1、2、3 种以上。住宅盲区 ${String(Math.round(city.coverage.blindShare * 100))}%。${city.parcels.services.shortages.length > 0 ? `缺少用地：${[...new Set(city.parcels.services.shortages.map((item) => item.name))].join('、')}` : ''}`,
  metro: '三条线，两个换乘站，一处穿过不设站。每条线是一根线或一个环，不分叉。',
};

const views = { traffic: trafficView, coverage: coverageView, metro: metroView };
if (views[view]) camera.addChild(views[view]());
app.stage.addChild(camera);
const legend = document.getElementById('legend');
if (legend && LEGENDS[view]) {
  legend.hidden = false;
  legend.textContent = LEGENDS[view];
}

let zoom = Number(params.get('zoom') ?? (N === 64 ? 0.078 : 0.145));
const focusX = Number(params.get('x') ?? N / 2);
const focusY = Number(params.get('y') ?? N / 2);
const offset = { x: 0, y: 0 };

function applyCamera() {
  const { sx, sy } = screenOf(focusX + 0.5, focusY + 0.5, 0);
  camera.scale.set(zoom);
  camera.position.set(
    window.innerWidth / 2 - sx * zoom + offset.x,
    window.innerHeight / 2 - sy * zoom + offset.y,
  );
  vehicles?.setView({
    left: -camera.position.x / zoom,
    right: (window.innerWidth - camera.position.x) / zoom,
    top: -camera.position.y / zoom,
    bottom: (window.innerHeight - camera.position.y) / zoom,
  });
}
applyCamera();

let hour = Number(params.get('t') ?? 12);
function setTime(next) {
  hour = next;
  const state = applyTime(scene, hour);
  vehicles?.setTime(state.tint, state.glow);
  if (!seam) {
    app.renderer.background.color = multiplyColor(backdrop, state.tint);
    tableLayer.tint = state.tint;
  }
  if (second) {
    second.world.alpha = Math.min(1, Math.max(0, state.glow * 1.25));
    const night = hour < 6 || hour > 20.5;
    const tint = night ? 0x7a82b8 : 0xffffff;
    second.groundLayer.tint = tint;
    second.objectLayer.tint = tint;
  }
  const clock = document.getElementById('clock');
  if (clock)
    clock.textContent = `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;
}
setTime(hour);

if (vehicles) {
  app.ticker.add((ticker) => vehicles.step(Math.min(0.05, ticker.deltaMS / 1000)));
  for (let i = 0; i < Number(params.get('warm') ?? 0); i += 1) vehicles.step(0.05);
}

if (hudOn) {
  const { createHud } = await import('./hud.js');
  app.stage.addChild(
    await createHud({ atlas, palette, width: window.innerWidth, height: window.innerHeight }),
  );
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
canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    zoomAt(event.deltaY < 0 ? 1.12 : 0.89, event.clientX, event.clientY);
  },
  { passive: false },
);

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
  const sceneSelect = document.getElementById('scene');
  sceneSelect.value = sceneName;
  sceneSelect.addEventListener('change', () => {
    const url = new URL(location.href);
    url.searchParams.set('scene', sceneSelect.value);
    url.searchParams.delete('x');
    url.searchParams.delete('y');
    url.searchParams.delete('zoom');
    location.href = url.toString();
  });
  const toggle = (id, name, value) => {
    const box = document.getElementById(id);
    box.checked = value;
    box.addEventListener('change', () => {
      const url = new URL(location.href);
      url.searchParams.set(name, box.checked ? '1' : '0');
      location.href = url.toString();
    });
  };
  toggle('festival', 'festival', festivalOn);
  toggle('linked', 'linked', linked);
}

window.sceneStats = {
  sprites: scene.count.sprites + (second?.count.sprites ?? 0),
  atlas: [atlas.width, atlas.height],
};
window.trafficStats = () =>
  vehicles
    ? {
        cars: vehicles.count(),
        wanted: vehicles.wanted(),
        stopped: vehicles.stopped(),
        signals: vehicles.signals,
      }
    : null;

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
        resolve({
          frames: sorted.length,
          p50fps: 1000 / at(0.5),
          p95fps: 1000 / at(0.95),
          worstFps: 1000 / sorted[sorted.length - 1],
        });
      }
    };
    requestAnimationFrame(pan);
  });

document.documentElement.dataset.ready = 'true';
