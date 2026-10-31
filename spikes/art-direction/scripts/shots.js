// 生成样张截图、拼缝检查和帧率测量。
// 用法：node scripts/shots.js [截图名前缀...]；SEAM=1 时只跑拼缝和露底检查，FPS=1 时只测帧率，SOFT=1 时用软件渲染。
// BIG=1 时只测 128×128 的地图，这个尺寸不是现有规格，只是量一量。
// 截图脚本用自己的端口，不影响 4180 上正在运行的页面。
// 每个场景开一个新页面并关掉上一个，图集纹理才会释放，连续跑几十个场景内存不会累积。
// 显卡测帧率时关掉垂直同步和帧率上限，否则所有用例都只读得出屏幕刷新率。软件渲染不关，它不关上限也到不了刷新率，
// 关了以后帧会成批提交，中位数失真。带 full=1 的用例屏幕里一直保持满额的车。
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startServer } from './serve.js';

const PORT = process.env.SOFT ? 4184 : 4183;
const filter = process.argv.slice(2);
const base = 'n=64&controls=0&warm=200';
const demo = 'scene=interchange&controls=0&warm=200';
const views = [
  { name: 'r6-overview', query: `${base}&zoom=0.078` },
  { name: 'r6-overview-night', query: `${base}&zoom=0.078&t=22` },
  { name: 'r6-center', query: `${base}&zoom=0.3&x=31&y=30` },
  { name: 'r6-detail', query: `${base}&zoom=0.55&x=30&y=31` },
  { name: 'r6-avenue', query: `${base}&zoom=0.42&x=28&y=32` },
  { name: 'r6-farm', query: `${base}&zoom=0.3&x=26&y=56` },
  { name: 'r6-cut', query: `${base}&zoom=0.62&x=57&y=38` },
  { name: 'r6-junction', query: `${base}&zoom=0.62&x=24&y=38` },
  { name: 'r6-gate-planned', query: `${base}&zoom=0.5&x=62&y=7` },
  { name: 'r6-gate-linked', query: `${base}&zoom=0.5&x=63&y=8&linked=1` },
  { name: 'r6-gate-road-linked', query: `${base}&zoom=0.5&x=34&y=63&linked=1` },
  { name: 'r6-ui', query: `${base}&zoom=0.42&x=31&y=33&ui=1` },
  { name: 'r6-traffic', query: `${base}&view=traffic&zoom=0.095&x=31&y=30` },
  { name: 'r6-coverage', query: `${base}&view=coverage&zoom=0.095&x=31&y=30` },
  { name: 'r6-metro', query: `${base}&view=metro&zoom=0.16&x=31&y=30` },
  { name: 'r6-time-dawn', query: `${base}&zoom=0.3&x=31&y=30&t=6.5` },
  { name: 'r6-time-noon', query: `${base}&zoom=0.3&x=31&y=30&t=12` },
  { name: 'r6-time-dusk', query: `${base}&zoom=0.3&x=31&y=30&t=18.6` },
  { name: 'r6-time-night', query: `${base}&zoom=0.3&x=31&y=30&t=23` },
  { name: 'r6-cars-night', query: `${base}&zoom=0.55&x=30&y=31&t=22&cars=300` },
  { name: 'r6-ix-overview', query: `${demo}&zoom=0.1` },
  { name: 'r6-ix-cloverleaf', query: `${demo}&zoom=0.26&x=14&y=9` },
  { name: 'r6-ix-trumpet', query: `${demo}&zoom=0.26&x=30&y=10` },
  { name: 'r6-ix-diamond', query: `${demo}&zoom=0.36&x=30&y=28` },
  { name: 'r6-ix-viaduct', query: `${demo}&zoom=0.5&x=30&y=19` },
  { name: 'r6-ix-taper', query: `${demo}&zoom=0.6&x=40&y=28` },
  { name: 'r7-tee', query: `${base}&zoom=0.26&x=33&y=8` },
  { name: 'r7-tee-cars', query: `${base}&zoom=0.42&x=34&y=9&cars=300` },
  { name: 'r7-tee-night', query: `${base}&zoom=0.26&x=33&y=8&t=22&cars=300` },
  { name: 'r7-full-600', query: `${base}&zoom=0.42&x=31&y=30&cars=600&full=1&warm=300` },
].filter((view) => filter.length === 0 || filter.some((prefix) => view.name.startsWith(prefix)));

const UNCAPPED = ['--disable-gpu-vsync', '--disable-frame-rate-limit'];
const GPU = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
const SOFTWARE = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];
const gpuArgs = process.env.FPS ? [...GPU, ...UNCAPPED] : GPU;

mkdirSync('out', { recursive: true });
const server = await startServer(PORT);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: process.env.SOFT ? SOFTWARE : gpuArgs,
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: process.env.SOFT ? 1.5 : 3,
});
let page = null;

async function open(query) {
  await page?.close();
  page = await context.newPage();
  page.on('pageerror', (error) => console.error('页面错误', error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('404'))
      console.error(message.text());
  });
  await page.goto(`http://localhost:${String(PORT)}/web/play.html?${query}`);
  await page.waitForSelector('html[data-ready="true"]', { state: 'attached', timeout: 180000 });
  await page.waitForTimeout(700);
}

/** 把截图读回像素，在页面里逐点统计。 */
async function pixelStats(viewZoom, focus, measure) {
  const shot = await page.screenshot({ type: 'png' });
  return page.evaluate(
    async ([base64, zoom, [fx, fy], body]) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context2d = canvas.getContext('2d');
      context2d.drawImage(image, 0, 0);
      const { data } = context2d.getImageData(0, 0, image.width, image.height);
      const dpr = 3;
      const originX = (fx - fy) * 64;
      const originY = (fx + fy) * 32;
      const toGround = (px, py) => {
        const sx = (px / dpr - 195) / zoom + originX;
        const sy = (py / dpr - 422) / zoom + originY;
        return [(sx / 64 + sy / 32 + 1) / 2, (sy / 32 - sx / 64 + 1) / 2];
      };
      const run = new Function('data', 'width', 'height', 'toGround', body);
      return run(data, image.width, image.height, toGround);
    },
    [shot.toString('base64'), viewZoom, focus, measure],
  );
}

const COUNT_MAGENTA = `
  let solid = 0, tinted = 0, inside = 0;
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const [gx, gy] = toGround(px, py);
      if (gx < 1 || gy < 1 || gx > 31 || gy > 31) continue;
      inside += 1;
      const i = (py * width + px) * 4;
      const red = data[i] - data[i + 1];
      const blue = data[i + 2] - data[i + 1];
      if (red > 90 && blue > 90) solid += 1;
      else if (red > 40 && blue > 40) tinted += 1;
    }
  }
  return { solid, tinted, inside };
`;

// 网格线：格子边上的像素比格子中间亮。只看城西纯草地的范围，沿格线取样和格子中心比较。
const GRID_CONTRAST = `
  let edge = 0, edgeCount = 0, middle = 0, middleCount = 0;
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const [gx, gy] = toGround(px, py);
      if (gx < 2 || gy < 12 || gx > 10 || gy > 40) continue;
      const fx = gx - Math.floor(gx);
      const fy = gy - Math.floor(gy);
      const near = Math.min(fx, 1 - fx, fy, 1 - fy);
      const i = (py * width + px) * 4;
      const lum = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
      if (near < 0.06) { edge += lum; edgeCount += 1; }
      else if (near > 0.3) { middle += lum; middleCount += 1; }
    }
  }
  return { edge: edge / edgeCount, middle: middle / middleCount, contrast: edge / edgeCount - middle / middleCount };
`;

/** 露底检查：背景设成品红，只画地表，统计城市内部露出品红的像素。白天和夜里、垫底和不垫底都跑。 */
async function seamCheck() {
  const rows = [];
  for (const hour of [12, 22]) {
    for (const bare of [true, false]) {
      for (const zoom of [0.078, 0.25, 0.5, 1, 2]) {
        await open(
          `n=32&controls=0&cars=0&zoom=${String(zoom)}&x=15&y=14&seam=1&t=${String(hour)}&bare=${bare ? '1' : '0'}`,
        );
        const result = await pixelStats(zoom, [15.5, 14.5], COUNT_MAGENTA);
        rows.push({ hour, bare, zoom, ...result });
        console.log(hour, bare ? '不垫底' : '垫底', 'zoom', zoom, JSON.stringify(result));
      }
    }
  }
  return rows;
}

/** 网格线检查：全图缩小到游戏最小倍率，夜里比较格线和格子中间的亮度差。 */
async function gridCheck() {
  const rows = [];
  for (const hour of [12, 22]) {
    await open(`n=64&controls=0&cars=0&zoom=0.078&t=${String(hour)}`);
    const result = await pixelStats(0.078, [32.5, 32.5], GRID_CONTRAST);
    rows.push({ hour, ...result });
    console.log('网格', hour, JSON.stringify(result));
  }
  return rows;
}

function fpsCases() {
  const game = 'n=64&controls=0&zoom=0.42&x=31&y=30&warm=300';
  const overview = 'n=64&controls=0&zoom=0.078&warm=300';
  const cases = [
    { name: '全图，白天，无车', query: 'n=64&controls=0&cars=0&zoom=0.078', cycle: false },
    { name: '游戏视角，白天，无车', query: `${game}&cars=0`, cycle: false },
    { name: '游戏视角，满额 300 辆', query: `${game}&cars=300&full=1`, cycle: false },
    { name: '游戏视角，满额 600 辆', query: `${game}&cars=600&full=1`, cycle: false },
    { name: '夜间车灯，满额 300 辆', query: `${game}&cars=300&full=1&t=22`, cycle: false },
    { name: '夜间车灯，满额 600 辆', query: `${game}&cars=600&full=1&t=22`, cycle: false },
    { name: '全图缩小，满额 600 辆', query: `${overview}&cars=600&full=1`, cycle: false },
    {
      name: '满城模块拼装（每物业 3 张），全图',
      query: 'n=64&controls=0&zoom=0.078&cars=0&stress=3',
      cycle: false,
    },
    {
      name: '满城模块拼装（每物业 3 张），游戏视角满额 300 辆',
      query: `${game}&cars=300&full=1&stress=3`,
      cycle: false,
    },
    {
      name: '满城模块拼装（每物业 3 张），游戏视角满额 600 辆，夜间',
      query: `${game}&cars=600&full=1&stress=3&t=22`,
      cycle: false,
    },
    {
      name: '立交场景，满额 300 辆',
      query: 'scene=interchange&controls=0&zoom=0.2&x=22&y=20&cars=300&full=1&warm=300',
      cycle: false,
    },
    {
      name: '普通城市的丁字立交，满额 300 辆',
      query: 'n=64&controls=0&zoom=0.26&x=33&y=8&cars=300&full=1&warm=300',
      cycle: false,
    },
    {
      name: '单图集加亮窗层，连续变换时间',
      query: 'n=64&controls=0&zoom=0.3&x=31&y=30&t=20&cars=300&full=1&warm=300',
      cycle: true,
    },
    {
      name: '交通视图，全城箭头',
      query: 'n=64&controls=0&view=traffic&zoom=0.095&x=31&y=28&cars=0',
      cycle: false,
    },
    { name: '公共服务图标，默认缩放', query: 'n=64&controls=0&cars=0', cycle: false },
    { name: '不画公共服务图标，默认缩放', query: 'n=64&controls=0&cars=0&icons=0', cycle: false },
  ];
  const big = 'n=128&controls=0&warm=100';
  const bigCases = [
    { name: '128，默认视野，无车', query: 'n=128&controls=0&cars=0', cycle: false },
    { name: '128，游戏视角，满额 300 辆', query: `${big}&zoom=0.42&x=62&y=60&cars=300&full=1`, cycle: false },
    { name: '128，游戏视角，满额 600 辆', query: `${big}&zoom=0.42&x=62&y=60&cars=600&full=1`, cycle: false },
    { name: '128，全图缩小，满额 600 辆', query: `${big}&zoom=0.04&cars=600&full=1`, cycle: false },
  ];
  return process.env.BIG ? bigCases : cases;
}

const report = {};
if (process.env.SEAM) {
  report.seams = await seamCheck();
  report.grid = await gridCheck();
  writeFileSync('out/seam-report.json', JSON.stringify(report, null, 2));
} else if (process.env.FPS) {
  for (const { name, query, cycle } of fpsCases()) {
    await open(query);
    const stats = await page.evaluate(() => window.sceneStats);
    const fps = await page.evaluate((flag) => window.measureFps(5, flag), cycle);
    const cars = await page.evaluate(() => window.trafficStats());
    report[name] = { gpu: stats.gpu, sprites: stats.sprites, atlas: stats.atlas, arrows: stats.arrows, icons: stats.icons, ...fps, cars };
    console.log(name, JSON.stringify(report[name]));
  }
  const prefix = process.env.BIG ? 'fps-big' : 'fps';
  writeFileSync(
    process.env.SOFT ? `out/${prefix}-soft-report.json` : `out/${prefix}-report.json`,
    JSON.stringify(report, null, 2),
  );
} else {
  for (const view of views) {
    await open(view.query);
    await page.screenshot({ path: `out/${view.name}.png` });
    const cars = await page.evaluate(() => window.trafficStats?.());
    console.log(view.name, JSON.stringify(cars));
  }
}

await browser.close();
server.close();
