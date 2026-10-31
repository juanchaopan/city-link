'use strict';
// 模拟层：在没有 DOM、禁止 eval 的 Worker 里提供微信 API。它不是微信，只用来发现依赖 DOM 的代码。
const native = {
  importScripts: self.importScripts.bind(self),
  fetch: self.fetch.bind(self),
  createImageBitmap: self.createImageBitmap.bind(self),
  raf: self.requestAnimationFrame.bind(self),
  caf: self.cancelAnimationFrame.bind(self),
  post: self.postMessage.bind(self),
  performance: self.performance,
  WebAssembly: self.WebAssembly,
  OffscreenCanvas: self.OffscreenCanvas,
  gl1: self.WebGLRenderingContext.prototype,
  gl2: self.WebGL2RenderingContext.prototype,
  offscreen: self.OffscreenCanvas.prototype,
  Function: self.Function,
};

const HIDE = [
  'document', 'window', 'navigator', 'location', 'fetch', 'XMLHttpRequest', 'WebSocket', 'Worker', 'SharedWorker',
  'OffscreenCanvas', 'OffscreenCanvasRenderingContext2D', 'ImageBitmap', 'ImageBitmapRenderingContext',
  'createImageBitmap', 'ImageData', 'WebAssembly', 'importScripts', 'indexedDB', 'caches', 'FileReader', 'Blob',
  'File', 'URL', 'URLSearchParams', 'TextDecoder', 'TextEncoder', 'AbortController', 'Event', 'EventTarget',
  'CustomEvent', 'MessageChannel', 'BroadcastChannel', 'performance', 'Performance', 'PointerEvent', 'MouseEvent',
  'TouchEvent', 'WebGLRenderingContext', 'WebGL2RenderingContext', 'requestAnimationFrame', 'cancelAnimationFrame',
  'FontFace', 'fonts', 'Path2D', 'structuredClone', 'crypto', 'Notification', 'origin', 'isSecureContext', 'self',
  'WorkerGlobalScope', 'DedicatedWorkerGlobalScope', 'addEventListener', 'removeEventListener', 'dispatchEvent',
];

function hideGlobals() {
  for (const name of HIDE) {
    let target = globalThis;
    while (target) {
      if (Object.prototype.hasOwnProperty.call(target, name)) {
        try {
          delete target[name];
        } catch {
          // 不可删除时由 env 消息报告
        }
      }
      target = Object.getPrototypeOf(target);
    }
  }
}

function unwrap(args) {
  return args.map((a) => (a && a.__bitmap ? a.__bitmap : a));
}

function patchWebGL(config) {
  for (const proto of [native.gl1, native.gl2]) {
    for (const method of ['texImage2D', 'texSubImage2D']) {
      const original = proto[method];
      proto[method] = function patched(...args) {
        return original.apply(this, unwrap(args));
      };
    }
  }
  const getContext = native.offscreen.getContext;
  native.offscreen.getContext = function patched(type, attrs) {
    if (config.webgl === 1 && type === 'webgl2') return null;
    return getContext.call(this, type, attrs);
  };
}

function installWx(config, mainCanvas) {
  const handlers = { start: [], move: [], end: [], cancel: [] };
  let first = true;
  const base = config.base;
  const wxApi = {
    getWindowInfo: () => ({ windowWidth: config.width, windowHeight: config.height, pixelRatio: config.dpr }),
    createCanvas() {
      if (first) {
        first = false;
        return mainCanvas;
      }
      return new native.OffscreenCanvas(1, 1);
    },
    createImage() {
      const image = {
        width: 0,
        height: 0,
        onload: null,
        onerror: null,
        __bitmap: null,
        set src(path) {
          native.fetch(base + path).then((r) => {
            if (!r.ok) throw new Error(`404 ${path}`);
            return r.blob();
          }).then((blob) => native.createImageBitmap(blob, { premultiplyAlpha: 'none' })).then((bitmap) => {
            image.__bitmap = bitmap;
            image.width = bitmap.width;
            image.height = bitmap.height;
            image.onload?.();
          }).catch((e) => image.onerror?.({ errMsg: String(e) }));
        },
      };
      return image;
    },
    getPerformance: () => ({ now: () => native.performance.now() * 1000 }),
    request: () => {
      throw new Error('wx.request is not expected in this spike');
    },
    onTouchStart: (fn) => handlers.start.push(fn),
    onTouchMove: (fn) => handlers.move.push(fn),
    onTouchEnd: (fn) => handlers.end.push(fn),
    onTouchCancel: (fn) => handlers.cancel.push(fn),
  };
  globalThis.wx = wxApi;
  globalThis.GameGlobal = globalThis;
  globalThis.WXWebAssembly = {
    Memory: native.WebAssembly.Memory,
    Table: native.WebAssembly.Table,
    Global: native.WebAssembly.Global,
    instantiate(path, imports) {
      if (typeof path !== 'string' || !/\.wasm(\.br)?$/.test(path)) {
        return Promise.reject(new Error('WXWebAssembly.instantiate only accepts a package path'));
      }
      return native.fetch(base + path).then((r) => r.arrayBuffer()).then((bytes) => native.WebAssembly.instantiate(bytes, imports));
    },
  };
  return handlers;
}

function evalStatus() {
  try {
    new native.Function('return 1')();
    return 'allowed';
  } catch (e) {
    return `blocked: ${e.name}`;
  }
}

self.onmessage = (event) => {
  const { type, config, canvas } = event.data;
  if (type !== 'boot') return;
  const post = native.post;
  patchWebGL(config);
  const handlers = installWx(config, canvas);
  const status = evalStatus();
  const importScript = native.importScripts;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const touches = (identifier, x, y) => ({ identifier, clientX: x, clientY: y, pageX: x, pageY: y });
  const emit = (kind, changed, all) => {
    for (const fn of handlers[kind]) fn({ changedTouches: changed, touches: all, timeStamp: Date.now() });
  };

  const gesture = async (game, probe) => {
    const before = { x: game.state.x, y: game.state.y, zoom: game.state.zoom };
    const a = touches(1, 200, 300);
    emit('start', [a], [a]);
    for (let i = 1; i <= 5; i++) {
      const moved = touches(1, 200 + i * 12, 300 + i * 6);
      emit('move', [moved], [moved]);
      await wait(16);
    }
    emit('end', [touches(1, 260, 330)], []);
    const afterDrag = { x: game.state.x, y: game.state.y };
    const p1 = touches(1, 150, 400);
    const p2 = touches(2, 250, 400);
    emit('start', [p1], [p1]);
    emit('start', [p2], [p1, p2]);
    for (let i = 1; i <= 5; i++) {
      const m1 = touches(1, 150 - i * 10, 400);
      const m2 = touches(2, 250 + i * 10, 400);
      emit('move', [m1, m2], [m1, m2]);
      await wait(16);
    }
    emit('end', [touches(1, 100, 400)], [touches(2, 300, 400)]);
    emit('end', [touches(2, 300, 400)], []);
    const afterPinch = game.state.zoom;
    const px = probe.button.x + probe.button.w / 2;
    const py = probe.button.y + probe.button.h / 2;
    const tap = touches(3, px, py);
    emit('start', [tap], [tap]);
    await wait(30);
    emit('end', [tap], []);
    await wait(60);
    return {
      dragMoved: afterDrag.x !== before.x && afterDrag.y !== before.y,
      pinchZoomed: afterPinch > before.zoom,
      tapPresses: [...game.presses],
      tapPoint: [px, py],
      before,
      afterDrag,
      afterPinch,
    };
  };

  globalThis.__spikeOptions = { mode: config.mode, webglVersion: config.webgl };
  globalThis.__onGameError = (error) => post({ type: 'error', message: String(error?.stack ?? error), evalStatus: status });
  globalThis.__onGameReady = async (game) => {
    try {
      await wait(800);
      const probe = game.probe();
      const input = await gesture(game, probe);
      const scene = { sprites: game.count };
      game.startRecording();
      await wait(config.recordMs ?? 3000);
      const frames = game.stopRecording();
      post({ type: 'ready', probe, input, scene, evalStatus: status, frames });
    } catch (error) {
      post({ type: 'error', message: String(error?.stack ?? error), evalStatus: status });
    }
  };

  hideGlobals();
  globalThis.requestAnimationFrame = native.raf;
  globalThis.cancelAnimationFrame = native.caf;
  const missing = HIDE.filter((name) => !name.endsWith('AnimationFrame') && typeof globalThis[name] !== 'undefined');
  post({ type: 'env', missing, evalStatus: status });
  try {
    importScript(`${config.base}game.js`);
  } catch (error) {
    post({ type: 'error', message: `load: ${error?.stack ?? error}`, evalStatus: status });
  }
};
