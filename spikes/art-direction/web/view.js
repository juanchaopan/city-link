import { Graphics } from 'pixi.js';
import { buildWorld, createApp, loadAtlas, screenOf } from './city.js';
import { LEVEL_PIXELS, TILE_HALF_H, TILE_HALF_W } from './constants.js';
import { palettes } from './kit/palettes.js';

const params = new URLSearchParams(location.search);
const paletteId = params.get('palette') ?? 'sunny';
const N = Number(params.get('n') ?? 32);
const zoom = Number(params.get('zoom') ?? 0.5);
const focusX = Number(params.get('x') ?? N / 2);
const focusY = Number(params.get('y') ?? N / 2);
const seam = params.get('seam') === '1';
const layers = seam ? ['ground'] : ['ground', 'overlays', 'objects'];

const palette = palettes[paletteId];
const background = seam ? '#ff00ff' : palette.backdrop;
const app = await createApp(document.getElementById('game'), background);
const atlas = await loadAtlas(paletteId);
const { world, count } = buildWorld(atlas, N, layers);

/** 沙盘摆在画着等距格线的规划桌上，脚下有一圈影子。 */
function table() {
  const g = new Graphics();
  const size = (N + 40) * TILE_HALF_W;
  const step = 8;
  for (let i = -40; i <= N + 40; i += step) {
    g.moveTo((i + 40) * TILE_HALF_W, (i - 40) * TILE_HALF_H).lineTo((i - N - 40) * TILE_HALF_W, (i + N + 40) * TILE_HALF_H);
    g.moveTo((-40 - i) * TILE_HALF_W, (i - 40) * TILE_HALF_H).lineTo((N + 40 - i) * TILE_HALF_W, (N + 40 + i) * TILE_HALF_H);
  }
  g.stroke({ color: palette.table.line, width: 6 });
  const drop = LEVEL_PIXELS * 1.6;
  g.poly([
    0, -TILE_HALF_H + drop,
    N * TILE_HALF_W + 34, N * TILE_HALF_H - TILE_HALF_H + drop + 12,
    0, N * 2 * TILE_HALF_H - TILE_HALF_H + drop + 42,
    -N * TILE_HALF_W - 34, N * TILE_HALF_H - TILE_HALF_H + drop + 12,
  ]).fill({ color: palette.table.shadow, alpha: 0.55 });
  void size;
  return g;
}

if (!seam) world.addChildAt(table(), 0);

const { sx, sy } = screenOf(focusX, focusY, 0);
world.scale.set(zoom);
world.position.set(window.innerWidth / 2 - sx * zoom, window.innerHeight / 2 - sy * zoom);
app.stage.addChild(world);

if (params.get('ui') === '1') {
  const { createHud } = await import('./hud.js');
  app.stage.addChild(await createHud({ atlas, palette, width: window.innerWidth, height: window.innerHeight }));
}

window.sceneStats = { sprites: count.sprites, atlas: [atlas.width, atlas.height] };

window.measureFps = (seconds) =>
  new Promise((resolve) => {
    const deltas = [];
    let previous = performance.now();
    const started = previous;
    const pan = (time) => {
      const now = performance.now();
      deltas.push(now - previous);
      previous = now;
      world.position.x += Math.sin(time / 300) * 2;
      world.position.y += Math.cos(time / 400) * 2;
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
