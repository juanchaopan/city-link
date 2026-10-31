import '@pixi/layout';
import { LayoutContainer } from '@pixi/layout/components';
import { Button } from '@pixi/ui';
import {
  autoDetectRenderer,
  Container,
  ImageSource,
  Particle,
  ParticleContainer,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
import city from '../../data/city.json';
import atlas from '../../data/atlas.json';

const TW = 64;
const TH = 32;
const LEVEL_H = 16;
const SURFACES = ['grass', 'grass', 'hill', 'rock'];

function textures(source) {
  const map = {};
  for (const [name, f] of Object.entries(atlas)) {
    map[name] = new Texture({ source, frame: new Rectangle(f.x, f.y, f.w, f.h) });
  }
  return map;
}

function placements() {
  const { N, level, shape, water, forest, mineral, roads, buildings } = city;
  const list = [];
  const order = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) order.push([x, y]);
  order.sort((a, b) => a[0] + a[1] - b[0] - b[1] || a[0] - b[0]);
  for (const [x, y] of order) {
    const t = y * N + x;
    const sx = (x - y) * (TW / 2);
    const sy = (x + y) * (TH / 2) - level[t] * LEVEL_H;
    const ground = water[t] ? 'water' : `ground-${SURFACES[level[t]]}-${shape[t] > 14 ? 0 : shape[t]}`;
    list.push({ name: ground, x: sx - 32, y: sy - 16 });
    if (mineral[t]) list.push({ name: 'mineral', x: sx - 32, y: sy - 16 });
    for (let dir = 0; dir < 8; dir++) {
      if (roads[t] & (1 << dir)) list.push({ name: `road-${dir}`, x: sx - 32, y: sy - 16 });
    }
    if (buildings[t]) list.push({ name: `building-${buildings[t]}`, x: sx - 32, y: sy - 64 });
    else if (forest[t] && !roads[t]) list.push({ name: 'forest', x: sx - 32, y: sy - 32 });
  }
  return list;
}

function buildWorld(tex, mode) {
  const items = placements();
  if (mode === 'sprite') {
    const world = new Container();
    for (const item of items) {
      const sprite = new Sprite(tex[item.name]);
      sprite.position.set(item.x, item.y);
      world.addChild(sprite);
    }
    return { world, count: items.length };
  }
  const world = new ParticleContainer({
    dynamicProperties: { position: false, vertex: false, rotation: false, uvs: false, color: false },
    texture: tex.water,
  });
  for (const item of items) {
    world.addParticle(new Particle({ texture: tex[item.name], x: item.x, y: item.y }));
  }
  world.boundsArea = new Rectangle(-2100, -100, 4200, 2300);
  world.update();
  return { world, count: items.length };
}

function roadGraph() {
  const { N, roads } = city;
  const nodes = [];
  const index = new Int32Array(N * N).fill(-1);
  for (let t = 0; t < N * N; t++) {
    if (roads[t]) {
      index[t] = nodes.length;
      nodes.push(t);
    }
  }
  const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
  const adjacency = nodes.map((t) => {
    const x = t % N;
    const y = (t / N) | 0;
    const out = [];
    for (let d = 0; d < 8; d++) {
      if (!(roads[t] & (1 << d))) continue;
      const nt = (y + dirs[d][1]) * N + x + dirs[d][0];
      if (index[nt] >= 0) out.push(index[nt]);
    }
    return out;
  });
  return { adjacency, size: nodes.length };
}

// 按 1 秒一轮、分摊到每帧的方式代替路网流量模拟的 CPU 负担。
function createFlowLoad(graph, sourcesPerSecond) {
  const parent = new Int32Array(graph.size);
  const flow = new Float32Array(graph.size);
  const queue = new Int32Array(graph.size);
  let done = 0;
  let cycleStart = 0;
  return (now) => {
    if (now - cycleStart >= 1000) {
      cycleStart = now;
      done = 0;
    }
    const target = Math.min(sourcesPerSecond, Math.ceil(((now - cycleStart) / 1000) * sourcesPerSecond));
    while (done < target) {
      const source = (done * 97) % graph.size;
      parent.fill(-1);
      parent[source] = source;
      let head = 0;
      let tail = 0;
      queue[tail++] = source;
      while (head < tail) {
        const n = queue[head++];
        for (const next of graph.adjacency[n]) {
          if (parent[next] < 0) {
            parent[next] = n;
            queue[tail++] = next;
          }
        }
      }
      for (let i = tail - 1; i > 0; i--) flow[parent[queue[i]]] += flow[queue[i]] * 0.5 + 1;
      done++;
    }
  };
}

function createUi(onPress) {
  const panel = new LayoutContainer({
    layout: {
      width: '100%',
      height: 72,
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'center',
      backgroundColor: 0x20242c,
    },
  });
  const makeButton = (label) => {
    const view = new LayoutContainer({
      layout: { width: 96, height: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: 0x2e6fd8, borderRadius: 8 },
    });
    const text = new Text({ text: label, style: { fill: 0xffffff, fontSize: 18 } });
    text.layout = true;
    view.addChild(text);
    const button = new Button(view);
    button.onPress.connect(() => onPress(label));
    return view;
  };
  const buttons = ['修路', '分区', '贸易'].map(makeButton);
  panel.addChild(...buttons);
  return { panel, buttons };
}

export async function createGame(platform, options = {}) {
  const { width, height, resolution } = platform.size();
  const canvas = platform.mainCanvas();
  const renderer = await autoDetectRenderer({
    preference: 'webgl',
    skipExtensionImports: true,
    canvas,
    width,
    height,
    resolution,
    antialias: false,
    backgroundColor: 0x8fbad6,
    preferWebGLVersion: options.webglVersion ?? 2,
    hello: false,
    layout: { autoUpdate: true, enableDebug: false },
  });
  const image = await platform.loadImage('assets/atlas.png');
  const source = new ImageSource({ resource: image, scaleMode: 'linear', autoGenerateMipmaps: false });
  const tex = textures(source);
  const stage = new Container();
  stage.eventMode = 'static';
  stage.hitArea = new Rectangle(0, 0, width, height);
  const { world, count } = buildWorld(tex, options.mode ?? 'particle');
  const camera = new Container();
  camera.addChild(world);
  stage.addChild(camera);

  const cars = new ParticleContainer({
    dynamicProperties: { position: true, vertex: false, rotation: false, uvs: false, color: false },
    texture: tex.car,
  });
  const carList = [];
  for (let i = 0; i < 300; i++) {
    const p = new Particle({ texture: tex.car, x: 0, y: 0 });
    carList.push({ p, u: (i * 37) % 1000, line: i % 16 });
    cars.addParticle(p);
  }
  cars.boundsArea = new Rectangle(-2100, -100, 4200, 2300);
  camera.addChild(cars);

  const hud = new Container();
  hud.layout = { width, height, flexDirection: 'column', justifyContent: 'space-between' };
  const label = new Text({ text: '首席规划师 探针 0 fps', style: { fill: 0x10131a, fontSize: 16, fontFamily: 'sans-serif' } });
  label.layout = { margin: 12 };
  const presses = [];
  const ui = createUi((name) => presses.push(name));
  hud.addChild(label, ui.panel);
  stage.addChild(hud);

  const state = { zoom: Math.min(width / 2200, 1), x: width / 2, y: 40, scripted: false, frames: [] };
  const applyCamera = () => {
    camera.scale.set(state.zoom);
    camera.position.set(state.x, state.y);
  };
  applyCamera();

  const pointers = new Map();
  let pinch = 0;
  stage.on('pointerdown', (e) => pointers.set(e.pointerId, { x: e.global.x, y: e.global.y }));
  stage.on('globalpointermove', (e) => {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    if (pointers.size === 1) {
      state.x += e.global.x - last.x;
      state.y += e.global.y - last.y;
    } else if (pointers.size === 2) {
      last.x = e.global.x;
      last.y = e.global.y;
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) state.zoom = Math.max(0.15, Math.min(2.5, state.zoom * (distance / pinch)));
      pinch = distance;
    }
    last.x = e.global.x;
    last.y = e.global.y;
    applyCamera();
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    pinch = 0;
  };
  stage.on('pointerup', release);
  stage.on('pointerupoutside', release);

  const flowLoad = createFlowLoad(roadGraph(), options.flowSources ?? 64);
  let previous = platform.now();
  let lastLabel = 0;
  const started = previous;

  function frame() {
    const now = platform.now();
    const dt = now - previous;
    previous = now;
    const t0 = platform.now();
    flowLoad(now - started);
    for (const car of carList) {
      car.u = (car.u + dt * 0.06) % 1000;
      const along = (car.u / 1000) * 63;
      const fixed = 4 + (car.line % 8) * 8;
      const [x, y] = car.line < 8 ? [along, fixed] : [fixed, along];
      car.p.x = (x - y) * 32 - 8;
      car.p.y = (x + y) * 16 - 6;
    }
    if (state.scripted) {
      const s = (now - state.scriptStart) / 1000;
      state.zoom = 0.45 + 0.35 * Math.sin(s * 0.9);
      state.x = width / 2 + Math.sin(s * 0.6) * 700 * state.zoom;
      state.y = height / 3 - 900 * state.zoom * (0.5 + 0.5 * Math.cos(s * 0.4));
      applyCamera();
    }
    if (now - lastLabel > 1000) {
      lastLabel = now;
      label.text = `首席规划师 探针 ${(1000 / Math.max(dt, 1)).toFixed(0)} fps`;
    }
    const t1 = platform.now();
    renderer.render(stage);
    const t2 = platform.now();
    if (state.recording) state.frames.push({ dt, sim: t1 - t0, render: t2 - t1 });
    platform.raf(frame);
  }
  platform.raf(frame);

  return {
    renderer,
    stage,
    state,
    presses,
    ui,
    count,
    canvas,
    startRecording() {
      state.frames = [];
      state.recording = true;
      state.scripted = true;
      state.scriptStart = platform.now();
    },
    stopRecording() {
      state.recording = false;
      state.scripted = false;
      return state.frames;
    },
    probe() {
      const gl = renderer.gl;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const panelBounds = ui.panel.getBounds();
      const buttonBounds = ui.buttons[1].getBounds();
      return {
        webGLVersion: renderer.context.webGLVersion,
        glRenderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        textBounds: { w: label.width, h: label.height },
        labelText: label.text,
        panel: { x: panelBounds.x, y: panelBounds.y, w: panelBounds.width, h: panelBounds.height },
        button: { x: buttonBounds.x, y: buttonBounds.y, w: buttonBounds.width, h: buttonBounds.height },
      };
    },
  };
}
