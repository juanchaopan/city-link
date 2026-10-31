import 'pixi.js/webworker';
import 'pixi.js/events';
import { createGame } from '../game/game.js';

const params = new URLSearchParams(location.search);
const width = Number(params.get('w') ?? window.innerWidth);
const height = Number(params.get('h') ?? window.innerHeight);
const resolution = Number(params.get('dpr') ?? window.devicePixelRatio);
const canvas = document.getElementById('game');
canvas.style.width = `${width}px`;
canvas.style.height = `${height}px`;

const platform = {
  size: () => ({ width, height, resolution }),
  mainCanvas: () => canvas,
  now: () => performance.now(),
  raf: (fn) => requestAnimationFrame(fn),
  loadImage: (path) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = path;
  }),
};

createGame(platform, {
  mode: params.get('mode') ?? 'particle',
  flowSources: Number(params.get('flow') ?? 64),
}).then((game) => {
  window.__game = game;
  window.__ready = true;
}).catch((error) => {
  window.__error = String(error?.stack ?? error);
});
