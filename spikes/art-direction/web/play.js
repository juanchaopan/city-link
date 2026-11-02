import { Application, Color, Container, Graphics } from 'pixi.js';
import { generateCity } from './sim/city.js';
import { generateRoadDemo } from './sim/roaddemo.js';
import { resolveStyle } from './sim/packs.js';
import { createServiceIcons } from './serviceicons.js';
import { createTrafficView } from './trafficview.js';
import { createVehicles } from './vehicles.js';
import { coverageView, metroView } from './views.js';
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

// 可以操作的样张：拖动、双指或滚轮缩放、时间滑块、交通、公共服务和地铁三个视图，
// 以及四级道路的立交场景。车流和红绿灯是纯视觉层，不改变任何结算结果。
// 默认是 128×128 的城市，默认缩放按视口算，整张地图完整放进竖屏；n=64 是对比用的小城。
// 缩小到 CAR_MIN_ZOOM 以下是鸟瞰，车只有几个像素大，这时不画车也不模拟车流；交通视图的箭头同理。
// 城市视图鸟瞰时不显示公共服务图标，公共服务视图一直显示。

const params = new URLSearchParams(location.search);
const sceneName = params.get('scene') ?? 'city';
const mode = params.get('mode') ?? 'layer';
const seam = params.get('seam') === '1';
const seamBackground = params.get('backdrop');
const view = params.get('view') ?? 'city';
const publicLayout = params.get('public') ?? 'spread';
const hudOn = params.get('ui') === '1';
const controlsOn = params.get('controls') !== '0';
const iconsOn = params.get('icons') !== '0';
const carCap = Number(params.get('cars') ?? 300);
const carsFull = params.get('full') === '1';
const stress = Number(params.get('stress') ?? 1);
const DEFAULT_SIZE = 128;
const FIT_MARGIN = 24;
const MIN_ZOOM = 0.03;
const MAX_ZOOM = 1.4;
const TAP_DISTANCE = 6;
const CAR_MIN_ZOOM = 0.2;
const ICON_MIN_ZOOM = 0.2;

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
    : generateCity(Number(params.get('n') ?? DEFAULT_SIZE), 11, publicLayout);
const { N } = city;
const atlas = await loadAtlas(style.atlas);
const layers = seam ? ['ground'] : ['ground', 'overlays', 'objects'];
const bare = params.get('bare') === '1';
const scene = buildWorld(atlas, city, {
  layers,
  dynamicTint: mode === 'layer',
  palette,
  bare,
  stress,
});
const vehicles =
  !seam && carCap > 0 && atlas.frames['car-0-0']
    ? createVehicles(atlas, city, scene, { cap: carCap, full: carsFull })
    : null;

const camera = new Container();
camera.addChild(scene.world);
let second = null;
if (mode === 'atlas2') {
  const duskAtlas = await loadAtlas('dusk');
  second = buildWorld(duskAtlas, city, {
    layers,
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

const LEGENDS = {
  traffic:
    '路面的颜色是负荷，绿到红越来越堵；箭头是车流，跑得越慢越堵。点一个物业看它的车走哪些路。',
  coverage: `绿：六种服务都到位；黄、橙、红：缺 1、2、3 种以上。住宅盲区 ${String(Math.round(city.coverage.blindShare * 100))}%。${city.parcels.services.shortages.length > 0 ? `缺少用地：${[...new Set(city.parcels.services.shortages.map((item) => item.name))].join('、')}` : ''}`,
  metro: '三条线，两个换乘站，一处穿过不设站。每条线是一根线或一个环，不分叉。',
};

const SCENE_ALPHA = { traffic: 0.45, coverage: 0.4, metro: 0.22 };
const trafficView =
  view === 'traffic' ? createTrafficView({ city, renderer: app.renderer, screenOf }) : null;
if (trafficView) {
  camera.addChild(trafficView.root);
  app.ticker.add((ticker) => trafficView.step(Math.min(0.05, ticker.deltaMS / 1000)));
}
if (view === 'coverage') camera.addChild(coverageView(city, ground));
if (view === 'metro') camera.addChild(metroView(city));
if (SCENE_ALPHA[view]) scene.world.alpha = SCENE_ALPHA[view];
const icons =
  iconsOn && !seam && city.icons?.length > 0 && view !== 'traffic' && view !== 'metro'
    ? createServiceIcons(atlas, city, { minZoom: view === 'coverage' ? 0 : ICON_MIN_ZOOM })
    : null;
if (icons) camera.addChild(icons.layer);
app.stage.addChild(camera);
const legend = document.getElementById('legend');
if (legend && LEGENDS[view]) {
  legend.hidden = false;
  legend.textContent = LEGENDS[view];
}

/** 整张地图放进视口的缩放。菱形地图宽 N 格、高半格一层，左右上下各留一点边。 */
function fitZoom() {
  const width = window.innerWidth - FIT_MARGIN * 2;
  const height = window.innerHeight - FIT_MARGIN * 2;
  return Math.min(width / (N * TILE_HALF_W * 2), height / (N * TILE_HALF_H * 2));
}

const smallestZoom = Math.min(MIN_ZOOM, fitZoom());
let zoom = Number(params.get('zoom') ?? fitZoom());
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
  const box = {
    left: -camera.position.x / zoom,
    right: (window.innerWidth - camera.position.x) / zoom,
    top: -camera.position.y / zoom,
    bottom: (window.innerHeight - camera.position.y) / zoom,
  };
  scene.setView(box);
  vehicles?.setView(zoom >= CAR_MIN_ZOOM ? box : null);
  icons?.setZoom(zoom);
  trafficView?.setZoom(zoom);
  if (!vehicles) scene.compose([]);
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
    for (const body of second.bodies) body.tint = tint;
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

/** 屏幕上一点对应的地面坐标，按零层算。 */
function groundAt(clientX, clientY) {
  const wx = (clientX - camera.position.x) / zoom;
  const wy = (clientY - camera.position.y) / zoom;
  const difference = wx / TILE_HALF_W;
  const sum = wy / TILE_HALF_H + 1;
  return [(sum + difference) / 2, (sum - difference) / 2];
}

function insidePolygon(polygon, x, y) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[j];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/** 选中这一点上的物业，返回它的车走的路段数。 */
function pickParcel(px, py) {
  const parcel = city.parcels.parcels.find(
    ({ polygon, capacity }) => polygon && capacity > 0 && insidePolygon(polygon, px, py),
  );
  return trafficView?.select(parcel)?.length ?? null;
}
window.pickParcel = pickParcel;

// 拖动和缩放。
const pointers = new Map();
let pinch = null;
let pressed = null;
const canvas = app.canvas;
const zoomAt = (factor, cx, cy) => {
  const next = Math.max(smallestZoom, Math.min(MAX_ZOOM, zoom * factor));
  const ratio = next / zoom;
  offset.x = cx - window.innerWidth / 2 - (cx - window.innerWidth / 2 - offset.x) * ratio;
  offset.y = cy - window.innerHeight / 2 - (cy - window.innerHeight / 2 - offset.y) * ratio;
  zoom = next;
  applyCamera();
};
canvas.addEventListener('pointerdown', (event) => {
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  pressed = { x: event.clientX, y: event.clientY };
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
canvas.addEventListener('pointerup', (event) => {
  const tapped =
    pressed &&
    pointers.size === 1 &&
    Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < TAP_DISTANCE;
  release(event);
  if (tapped && trafficView) pickParcel(...groundAt(event.clientX, event.clientY));
});
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
}

/** 实际在用的显卡。笔记本有两块显卡，帧率要写清楚是哪一块跑的。 */
function rendererName() {
  const { gl } = app.renderer;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
}

window.sceneStats = {
  sprites: scene.count.sprites + (second?.count.sprites ?? 0),
  atlas: [atlas.width, atlas.height],
  gpu: rendererName(),
  arrows: trafficView?.arrowCount ?? 0,
  icons: icons?.count ?? 0,
};
window.viewStats = () => ({
  zoom,
  arrowsShown: trafficView?.arrowsShown() ?? 0,
  iconGap: icons ? icons.nearest(zoom) : null,
  iconSize: icons?.size ?? null,
  iconsVisible: icons ? icons.layer.visible : false,
  staticsInView: scene.inView(),
});
window.trafficStats = () =>
  vehicles
    ? {
        cars: vehicles.count(),
        wanted: vehicles.wanted(),
        stopped: vehicles.stopped(),
        signals: vehicles.signals,
        sortMs: vehicles.sortMs(),
        staticsInView: scene.inView(),
      }
    : null;

window.setHour = setTime;
window.setZoom = (next) => zoomAt(next / zoom, window.innerWidth / 2, window.innerHeight / 2);
window.panBy = (dx, dy) => {
  offset.x += dx;
  offset.y += dy;
  applyCamera();
};

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
