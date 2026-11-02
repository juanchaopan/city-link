// 按玩家真实看到的画面验收：手机竖屏视口，默认缩放或高架、立交的近景。node scripts/screencheck.js [views|cars]
// views：play.html?n=128 默认缩放下，公共服务图标互不压住、绿黄红覆盖色没被盖掉，地铁线有几个像素粗。
// 读的是粒子实际的屏幕大小和画面像素，不是常量：常量写着多大不算数。地铁线沿法线数像素，取中位数，站点不算进粗细。
// cars：高架和立交上的车，同一帧画三遍：只画车、只画桥面、车和桥面按真实顺序一起画。
// 车身的实心像素在第三遍里变成了桥面的颜色，就是被桥面切了；边缘的半透明像素不算。
// 车在屏幕上落在更高一层的桥面底下时被盖住是对的，这种车不算。楼和灯杆不画，它们挡车由 occlusion.js 查。
// 写 out/screen-report.json，不通过时退出码是 1。
// REPLACE="文件@原文@替换" 在页面加载时改一处源码，换行隔开多处，用来证明检查能失败。
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startServer } from './serve.js';
import { generateCity } from '../web/sim/city.js';

const PORT = 4197;
const SIZE = 128;
const VIEWPORT = { width: 390, height: 844 };
const PIXEL_RATIO = 2;
const MIN_COVERAGE_KEPT = 0.75;
const MIN_LINE_PIXELS = 2.5;
const LINE_SAMPLES = 41;
const CAR_ZOOM = 0.7;
const CAR_SAMPLES = 8;
const CAR_BOX = 20;
const CUT_SHARE = 0.08;
const ON_DECK = 0.2;
const ABOVE = 0.6;
const CAR_SLACK = 0.22;
const REPORT = process.env.REPORT ?? 'out/screen-report.json';

const steps = process.argv[2] ? [process.argv[2]] : ['views', 'cars'];
const replacements = (process.env.REPLACE ?? '')
  .split('\n')
  .filter(Boolean)
  .map((item) => item.split('@'));

mkdirSync('out', { recursive: true });
const server = await startServer(PORT);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: PIXEL_RATIO,
});
const errors = [];

async function open(query) {
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  for (const file of new Set(replacements.map(([name]) => name))) {
    await page.route(`**/web/${file}*`, async (route) => {
      const response = await route.fetch();
      let body = await response.text();
      for (const [name, from, to] of replacements) {
        if (name !== file) continue;
        if (!body.includes(from)) throw new Error(`${file} 里没有 ${from}`);
        body = body.split(from).join(to);
      }
      await route.fulfill({ response, body });
    });
  }
  await page.goto(`http://localhost:${String(PORT)}/web/play.html?${query}`, { timeout: 300000 });
  await page.waitForSelector('html[data-ready="true"]', { state: 'attached', timeout: 300000 });
  return page;
}

/** 公共服务视图：有图标和没图标各画一帧，比较覆盖色的像素留下多少。 */
async function coverageCheck() {
  const page = await open(`n=${String(SIZE)}&view=coverage&cars=0`);
  const stats = await page.evaluate(() => window.viewStats());
  const kept = await page.evaluate(() => {
    const { app, scene } = window.playParts;
    const COLORS = [
      [0x2f, 0xae, 0x6c],
      [0xf0, 0xc0, 0x40],
      [0xf0, 0x8a, 0x3c],
      [0xe0, 0x3c, 0x34],
    ];
    const { gl } = app.renderer;
    const [width, height] = [gl.drawingBufferWidth, gl.drawingBufferHeight];
    const read = () => {
      app.render();
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const near = (pixels, i, [r, g, b], tolerance) =>
      Math.abs(pixels[i] - r) < tolerance &&
      Math.abs(pixels[i + 1] - g) < tolerance &&
      Math.abs(pixels[i + 2] - b) < tolerance;
    const iconLayer = scene.world.parent.children.at(-1);
    const withIcons = read();
    iconLayer.visible = false;
    const without = read();
    iconLayer.visible = true;
    let colored = 0;
    let same = 0;
    for (let i = 0; i < without.length; i += 4) {
      if (!COLORS.some((color) => near(without, i, color, 44))) continue;
      colored += 1;
      if (near(withIcons, i, [without[i], without[i + 1], without[i + 2]], 10)) same += 1;
    }
    return { colored, same };
  });
  await page.screenshot({ path: 'out/screen-coverage.png' });
  await page.close();
  return { ...stats, coverageKept: kept.same / kept.colored, coloredPixels: kept.colored };
}

/** 线上等距取几个点：世界坐标下的位置和单位法线。 */
function lineSamples(path) {
  const screen = path.map(([x, y]) => [(x - y) * 64, (x + y - 1) * 32]);
  const along = [0];
  for (let i = 1; i < screen.length; i += 1) {
    along.push(
      along[i - 1] + Math.hypot(screen[i][0] - screen[i - 1][0], screen[i][1] - screen[i - 1][1]),
    );
  }
  const total = along[along.length - 1];
  const samples = [];
  for (let k = 1; k <= LINE_SAMPLES; k += 1) {
    const target = (total * k) / (LINE_SAMPLES + 1);
    let i = 1;
    while (i < screen.length - 1 && along[i] < target) i += 1;
    const [ax, ay] = screen[i - 1];
    const [bx, by] = screen[i];
    const span = along[i] - along[i - 1] || 1;
    const t = (target - along[i - 1]) / span;
    samples.push({
      x: ax + (bx - ax) * t,
      y: ay + (by - ay) * t,
      nx: -(by - ay) / span,
      ny: (bx - ax) / span,
    });
  }
  return samples;
}

/** 地铁视图：每个取样点沿法线数线色的像素，取中位数，就是画出来的粗细。 */
const measureLines = ({ lines, ratio }) => {
  const { app, scene } = window.playParts;
  const camera = scene.world.parent;
  const { gl } = app.renderer;
  const [width, height] = [gl.drawingBufferWidth, gl.drawingBufferHeight];
  app.render();
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const REACH = 12 * ratio;
  return lines.map(({ color, samples }) => {
    const [r, g, b] = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
    const widths = samples.map(({ x, y, nx, ny }) => {
      const px = (x * camera.scale.x + camera.position.x) * ratio;
      const py = (y * camera.scale.y + camera.position.y) * ratio;
      let count = 0;
      for (let step = -REACH; step <= REACH; step += 1) {
        const qx = Math.round(px + nx * step);
        const qy = Math.round(py + ny * step);
        const i = ((height - 1 - qy) * width + qx) * 4;
        const close =
          Math.abs(pixels[i] - r) < 60 &&
          Math.abs(pixels[i + 1] - g) < 60 &&
          Math.abs(pixels[i + 2] - b) < 60;
        if (close) count += 1;
      }
      return count / ratio;
    });
    return widths.sort((p, q) => p - q)[Math.floor(widths.length / 2)];
  });
};

async function metroCheck(city) {
  const page = await open(`n=${String(SIZE)}&view=metro&cars=0`);
  const lines = city.metro.lines.map(({ id, color, path }) => ({
    id,
    color: Number.parseInt(color.slice(1), 16),
    samples: lineSamples(path),
  }));
  const widths = await page.evaluate(measureLines, { lines, ratio: PIXEL_RATIO });
  await page.screenshot({ path: 'out/screen-metro.png' });
  await page.close();
  return lines.map(({ id }, index) => ({ id, width: widths[index] }));
}

/** 一帧里每辆桥上的车有多少实心像素变成了桥面的颜色。 */
const measureCuts = ({ onDeck, box, ratio }) => {
  const { app, atlas, scene, vehicles } = window.playParts;
  const layer = scene.world.children.at(-1);
  const camera = scene.world.parent;
  const keyOf = new Map(Object.entries(atlas.textures).map(([key, texture]) => [texture, key]));
  const isDeck = (particle) => /^(ixp|ev)-/.test(keyOf.get(particle.texture) ?? '');
  const { gl } = app.renderer;
  const [width, height] = [gl.drawingBufferWidth, gl.drawingBufferHeight];
  const read = (list) => {
    layer.particleChildren = list;
    layer.update();
    app.render();
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  };
  const full = layer.particleChildren;
  const cars = vehicles.cars.filter((car) => car.slot && car.h > onDeck);
  const bodies = new Set(cars.map((car) => car.slot.body));
  scene.groundLayer.visible = false;
  camera.children[0].visible = false;
  const alone = read(full.filter((particle) => bodies.has(particle)));
  const deckOnly = read(full.filter((particle) => isDeck(particle)));
  const together = read(full.filter((particle) => bodies.has(particle) || isDeck(particle)));
  scene.groundLayer.visible = true;
  camera.children[0].visible = true;
  layer.particleChildren = full;
  layer.update();
  const differs = (a, i, b, j, tolerance) =>
    Math.abs(a[i] - b[j]) > tolerance ||
    Math.abs(a[i + 1] - b[j + 1]) > tolerance ||
    Math.abs(a[i + 2] - b[j + 2]) > tolerance;
  return cars.map((car) => {
    const px = Math.round((car.slot.body.x * camera.scale.x + camera.position.x) * ratio);
    const py = Math.round((car.slot.body.y * camera.scale.y + camera.position.y) * ratio);
    let body = 0;
    let cut = 0;
    for (let y = Math.max(0, py - box); y < Math.min(height, py + box); y += 1) {
      for (let x = Math.max(0, px - box); x < Math.min(width, px + box); x += 1) {
        const i = ((height - 1 - y) * width + x) * 4;
        if (!differs(alone, i, alone, 0, 70) || !differs(alone, i, deckOnly, i, 70)) continue;
        body += 1;
        if (!differs(together, i, deckOnly, i, 12)) cut += 1;
      }
    }
    return { x: car.x, y: car.y, h: car.h, body, cut, px: px / ratio, py: py / ratio };
  });
};

const pointInside = (polygon, x, y) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[j];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
};

/** 屏幕上这辆车落在更高一层的桥面底下：往视线方向推到那层桥面的高度再看占地。 */
function underHigherDeck(car, decks) {
  return decks.some(({ footprint, base }) => {
    if (base < car.h + ABOVE) return false;
    const push = (base - car.h) / 2;
    return [-CAR_SLACK, 0, CAR_SLACK].some((slack) =>
      [-CAR_SLACK, 0, CAR_SLACK].some((side) =>
        pointInside(footprint, car.x + push + slack + side, car.y + push + slack - side),
      ),
    );
  });
}

async function carSite(name, x, y, decks) {
  const page = await open(
    `n=${String(SIZE)}&controls=0&zoom=${String(CAR_ZOOM)}&x=${String(x)}&y=${String(y)}&cars=300&full=1&warm=300`,
  );
  let cars = 0;
  const cuts = [];
  for (let sample = 0; sample < CAR_SAMPLES; sample += 1) {
    await page.waitForTimeout(700);
    const rows = await page.evaluate(measureCuts, {
      onDeck: ON_DECK,
      box: Math.round(CAR_BOX * PIXEL_RATIO * CAR_ZOOM),
      ratio: PIXEL_RATIO,
    });
    for (const row of rows) {
      if (row.body === 0) continue;
      cars += 1;
      if (row.cut / row.body > CUT_SHARE && !underHigherDeck(row, decks)) cuts.push(row);
    }
  }
  await page.close();
  return { name, cars, cut: cuts.length, examples: cuts.slice(0, 4) };
}

const report = {};
const city = generateCity(SIZE);
if (steps.includes('views')) {
  report.coverage = await coverageCheck();
  report.metro = await metroCheck(city);
}
if (steps.includes('cars')) {
  const decks = city.objects.filter(({ key }) => /^(ixp|ev)-/.test(key));
  const { x, row } = city.viaduct.route;
  const { cx, cy } = city.plan.interchange;
  report.cars = [
    await carSite('高架', x + 1, row, decks),
    await carSite('丁字立交', cx, cy + 1, decks),
  ];
}
await browser.close();
server.close();

const failures = [];
if (report.coverage) {
  const { iconSize, iconOverlaps, iconsVisible, coverageKept } = report.coverage;
  if (!iconsVisible) failures.push('公共服务图标没有显示');
  if (iconOverlaps > 0)
    failures.push(`图标互相压住 ${String(iconOverlaps)} 对，大小 ${String(iconSize)}`);
  if (coverageKept < MIN_COVERAGE_KEPT)
    failures.push(`覆盖色只留下 ${String(Math.round(coverageKept * 100))}%`);
}
for (const { id, width } of report.metro ?? []) {
  if (width < MIN_LINE_PIXELS)
    failures.push(`地铁 ${String(id)} 号线只有 ${width.toFixed(1)} 像素粗`);
}
for (const { name, cut } of report.cars ?? []) {
  if (cut > 0) failures.push(`${name}上 ${String(cut)} 辆车被桥面切掉`);
}
failures.push(...errors);
const output = { ...report, failures };
writeFileSync(REPORT, JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 1));
if (failures.length > 0) process.exitCode = 1;
