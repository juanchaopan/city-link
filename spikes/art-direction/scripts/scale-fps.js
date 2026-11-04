// 128 和 256 城市的帧率，口径和 FPS=1 node scripts/shots.js 一样：显卡渲染、关掉垂直同步，每个场景量 5 秒。
// 先 node scripts/gen.js sunny 烘图集（含 256 城用到的精灵），再 node scripts/scale-fps.js [边长...]，默认 128 和 256。
// 结果写到 out/scale-fps-<边长>.json，ADR-0010 的证据就是这两个文件。
// 城市在页面载入时生成，很费时间和内存，所以一座城只开两个页面：上限 300 辆的页面里依次量游戏视角、
// 半图缩小、默认视野和鸟瞰全图（缩小以后不画车），上限 100 辆的页面只量游戏视角。量完一个页面马上关掉。
// 场景按视野从小到大排：场景层只在视野超出上次留下的范围时才重新挑要画的物体，先大后小会沿用大视野的物体。
// 堆内存先做一次垃圾回收再读，读的是页面长期占着的内存，不含生成时的临时数据。
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startServer } from './serve.js';

const PORT = 4187;
const LOAD_TIMEOUT = 20 * 60 * 1000;
const SECONDS = 5;
const VIEW = { width: 390, height: 844 };
const FIT_MARGIN = 24;
const GAME_ZOOM = 0.42;
const HALF_ZOOM = 0.078;
const DEFAULT_ZOOM = { 128: 0.04, 256: 0.02 };
const sizes = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [128, 256];

/** 整张地图放进视口的缩放，和 play.js 的 fitZoom 一样。 */
function fitZoom(N) {
  return Math.min(
    (VIEW.width - FIT_MARGIN * 2) / (N * 128),
    (VIEW.height - FIT_MARGIN * 2) / (N * 64),
  );
}

function pagesFor(N) {
  const center = `x=${String(N / 2 - 2)}&y=${String(N / 2 - 4)}`;
  const game = `n=${String(N)}&controls=0&zoom=${String(GAME_ZOOM)}&${center}&warm=300&full=1`;
  return [
    {
      query: `${game}&cars=300`,
      scenes: [
        { name: '游戏视角，上限 300 辆', zoom: GAME_ZOOM },
        { name: '半图缩小，不画车', zoom: HALF_ZOOM },
        { name: '默认视野，不画车', zoom: DEFAULT_ZOOM[N] },
        { name: '鸟瞰全图（上限 300 辆，缩小后不画车）', zoom: fitZoom(N) },
      ],
    },
    { query: `${game}&cars=100`, scenes: [{ name: '游戏视角，上限 100 辆', zoom: GAME_ZOOM }] },
  ];
}

const heapMb = (page) =>
  page.evaluate(() => {
    window.gc?.();
    return Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576);
  });

async function measurePage(context, query, scenes, report, out) {
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('页面错误', error.message));
  const started = Date.now();
  await page.goto(`http://localhost:${String(PORT)}/web/play.html?${query}`, {
    timeout: LOAD_TIMEOUT,
  });
  await page.waitForSelector('html[data-ready="true"]', {
    state: 'attached',
    timeout: LOAD_TIMEOUT,
  });
  const loadSeconds = Math.round((Date.now() - started) / 1000);
  const { gpu, sprites, atlas } = await page.evaluate(() => window.sceneStats);
  for (const { name, zoom } of scenes) {
    await page.evaluate((next) => window.setZoom(next), zoom);
    await page.waitForTimeout(700);
    const fps = await page.evaluate((seconds) => window.measureFps(seconds, false), SECONDS);
    const cars = await page.evaluate(() => window.trafficStats());
    const view = await page.evaluate(() => window.viewStats());
    report[name] = {
      loadSeconds,
      heapMb: await heapMb(page),
      sprites,
      staticsInView: view.staticsInView,
      zoom: view.zoom,
      atlas,
      gpu,
      frames: fps.frames,
      p50fps: Math.round(fps.p50fps),
      p95fps: Math.round(fps.p95fps),
      worstFps: Math.round(fps.worstFps),
      cars: cars?.cars ?? 0,
      sortMs: cars?.sortMs ?? null,
    };
    console.log(name, JSON.stringify(report[name]));
    writeFileSync(out, JSON.stringify(report, null, 2));
  }
  await page.close();
}

const server = await startServer(PORT);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--use-angle=d3d11',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--disable-gpu-vsync',
    '--disable-frame-rate-limit',
    '--enable-precise-memory-info',
    '--js-flags=--expose-gc',
  ],
});
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 3 });
for (const N of sizes) {
  const report = {};
  const out = `out/scale-fps-${String(N)}.json`;
  for (const { query, scenes } of pagesFor(N)) {
    await measurePage(context, query, scenes, report, out);
  }
}
await browser.close();
server.close();
