// 生成样张截图、拼缝检查和帧率测量。
// 用法：node scripts/shots.js [截图名前缀...]；SEAM=1 时只跑拼缝检查，FPS=1 时只测帧率。
// 截图脚本用自己的端口，不影响 4180 上正在运行的页面。
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startServer } from './serve.js';

const PORT = 4183;
const filter = process.argv.slice(2);
const base = 'n=64&controls=0';
const views = [
  { name: 'r4-overview', query: `${base}&zoom=0.078` },
  { name: 'r4-center', query: `${base}&zoom=0.3&x=31&y=30` },
  { name: 'r4-detail', query: `${base}&zoom=0.55&x=30&y=31` },
  { name: 'r4-triangle', query: `${base}&zoom=0.6&x=25&y=36` },
  { name: 'r4-triangle-commerce', query: `${base}&zoom=0.6&x=36&y=26` },
  { name: 'r4-farm', query: `${base}&zoom=0.3&x=26&y=56` },
  { name: 'r4-cut', query: `${base}&zoom=0.62&x=57&y=38` },
  { name: 'r4-slope', query: `${base}&zoom=0.34&x=54&y=30` },
  { name: 'r4-junction', query: `${base}&zoom=0.8&x=29&y=27` },
  { name: 'r4-ui', query: `${base}&zoom=0.42&x=31&y=33&ui=1` },
  { name: 'r4-traffic', query: `${base}&view=traffic&zoom=0.11` },
  { name: 'r4-coverage', query: `${base}&view=coverage&zoom=0.1` },
  { name: 'r4-coverage-concentrated', query: `${base}&view=coverage&zoom=0.1&public=concentrated` },
  { name: 'r4-metro', query: `${base}&view=metro&zoom=0.11` },
  { name: 'r4-festival', query: `${base}&festival=1&zoom=0.42&x=30&y=31` },
  { name: 'r4-time-dawn', query: `${base}&zoom=0.3&x=31&y=30&t=6.5` },
  { name: 'r4-time-noon', query: `${base}&zoom=0.3&x=31&y=30&t=12` },
  { name: 'r4-time-dusk', query: `${base}&zoom=0.3&x=31&y=30&t=18.6` },
  { name: 'r4-time-night', query: `${base}&zoom=0.3&x=31&y=30&t=23` },
  { name: 'r4-time-night-two-atlases', query: `${base}&zoom=0.3&x=31&y=30&t=23&mode=atlas2` },
].filter((view) => filter.length === 0 || filter.some((prefix) => view.name.startsWith(prefix)));

mkdirSync('out', { recursive: true });
const server = await startServer(PORT);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
});
const page = await context.newPage();
page.on('pageerror', (error) => console.error('页面错误', error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('404')) console.error(message.text());
});

async function open(query) {
  await page.goto(`http://localhost:${String(PORT)}/web/play.html?${query}`);
  await page.waitForSelector('html[data-ready="true"]', { state: 'attached', timeout: 90000 });
  await page.waitForTimeout(700);
}

/** 拼缝检查：背景设成品红，只画地表，统计城市内部露出品红的像素。 */
async function seamCheck() {
  const rows = [];
  for (const zoom of [0.25, 0.3333, 0.5, 0.75, 1, 2]) {
    await open(`n=32&controls=0&zoom=${String(zoom)}&x=15&y=14&seam=1`);
    const shot = await page.screenshot({ type: 'png' });
    const result = await page.evaluate(
      async ([base64, viewZoom]) => {
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
        const focusX = 15 - 14;
        const focusY = 15 + 14 + 0;
        let solid = 0;
        let tinted = 0;
        let inside = 0;
        for (let py = 0; py < image.height; py += 1) {
          for (let px = 0; px < image.width; px += 1) {
            const sx = (px / dpr - 195) / viewZoom + focusX * 64;
            const sy = (py / dpr - 422) / viewZoom + focusY * 32;
            const gx = (sx / 64 + sy / 32) / 2;
            const gy = (sy / 32 - sx / 64) / 2;
            if (gx < 1 || gy < 1 || gx > 31 || gy > 31) continue;
            inside += 1;
            const i = (py * image.width + px) * 4;
            const red = data[i] - data[i + 1];
            const blue = data[i + 2] - data[i + 1];
            if (red > 90 && blue > 90) solid += 1;
            else if (red > 40 && blue > 40) tinted += 1;
          }
        }
        return { solid, tinted, inside };
      },
      [shot.toString('base64'), zoom],
    );
    rows.push({ zoom, ...result });
    console.log('zoom', zoom, JSON.stringify(result));
  }
  return rows;
}

const report = {};
if (process.env.SEAM) {
  report.seams = await seamCheck();
  writeFileSync('out/seam-report.json', JSON.stringify(report, null, 2));
} else if (process.env.FPS) {
  const cases = [
    { name: '全图，白天', query: 'n=64&controls=0&zoom=0.078', cycle: false },
    { name: '游戏视角，白天', query: 'n=64&controls=0&zoom=0.42&x=31&y=30', cycle: false },
    { name: '单图集加亮窗层，连续变换时间', query: 'n=64&controls=0&zoom=0.3&x=31&y=30&t=20', cycle: true },
    { name: '两套图集叠加，黄昏混合中', query: 'n=64&controls=0&zoom=0.3&x=31&y=30&t=19&mode=atlas2', cycle: false },
    { name: '节日叠加层', query: 'n=64&controls=0&zoom=0.3&x=31&y=30&festival=1', cycle: false },
  ];
  for (const { name, query, cycle } of cases) {
    await open(query);
    const stats = await page.evaluate(() => window.sceneStats);
    const fps = await page.evaluate((flag) => window.measureFps(6, flag), cycle);
    report[name] = { sprites: stats.sprites, atlas: stats.atlas, ...fps };
    console.log(name, JSON.stringify(report[name]));
  }
  writeFileSync('out/fps-report.json', JSON.stringify(report, null, 2));
} else {
  for (const view of views) {
    await open(view.query);
    await page.screenshot({ path: `out/${view.name}.png` });
  }
}

await browser.close();
server.close();
