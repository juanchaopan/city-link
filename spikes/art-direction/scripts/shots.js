// 生成样张截图、拼缝检查和帧率测量。
// 用法：node scripts/shots.js [配色...]；SEAM=1 时只跑拼缝检查，FPS=1 时只测帧率。
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startServer } from './serve.js';

const PORT = 4182;
const argv = process.argv.slice(2);
const palettes = argv.length > 0 ? argv : ['sunny', 'maquette', 'dusk'];
const views = [
  { name: 'overview', query: 'n=32&zoom=0.145' },
  { name: 'city', query: 'n=32&zoom=0.3&x=15&y=13' },
  { name: 'detail', query: 'n=32&zoom=0.55&x=16.5&y=16.5' },
  { name: 'river', query: 'n=32&zoom=0.55&x=16&y=23' },
  { name: 'slope', query: 'n=32&zoom=0.55&x=27&y=7' },
  { name: 'ui', query: 'n=32&zoom=0.42&x=15&y=14&ui=1' },
];

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
  await page.goto(`http://localhost:${PORT}/web/view.html?${query}`);
  await page.waitForSelector('html[data-ready="true"]', { state: 'attached', timeout: 60000 });
  await page.waitForTimeout(600);
}

/** 拼缝检查：背景设成品红，只画地表，统计城市内部露出品红的像素。 */
async function seamCheck(id) {
  const rows = [];
  for (const zoom of [0.25, 0.3333, 0.5, 0.75, 1, 2]) {
    await open(`palette=${id}&n=32&zoom=${zoom}&x=15&y=14&seam=1`);
    const shot = await page.screenshot({ type: 'png' });
    const magenta = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context2d = canvas.getContext('2d');
      context2d.drawImage(image, 0, 0);
      const { data } = context2d.getImageData(0, 0, image.width, image.height);
      let solid = 0;
      let tinted = 0;
      for (let i = 0; i < data.length; i += 4) {
        const pink = data[i] - data[i + 1] > 60 && data[i + 2] - data[i + 1] > 60;
        if (pink) solid += 1;
        else if (data[i] - data[i + 1] > 18 && data[i + 2] - data[i + 1] > 18) tinted += 1;
      }
      return { solid, tinted, total: data.length / 4 };
    }, shot.toString('base64'));
    rows.push({ zoom, ...magenta });
    console.log(id, 'zoom', zoom, JSON.stringify(magenta));
  }
  return rows;
}

const report = {};
if (process.env.SEAM) {
  for (const id of palettes) report[id] = await seamCheck(id);
  writeFileSync('out/seam-report.json', JSON.stringify(report, null, 2));
} else if (process.env.FPS) {
  for (const zoom of [0.145, 0.42]) {
    await open(`palette=${palettes[0]}&n=64&zoom=${zoom}&x=32&y=30`);
    const stats = await page.evaluate(() => window.sceneStats);
    const fps = await page.evaluate(() => window.measureFps(6));
    report[zoom] = { ...stats, ...fps };
    console.log(zoom, JSON.stringify(report[zoom]));
  }
  writeFileSync('out/fps-report.json', JSON.stringify(report, null, 2));
} else {
  for (const id of palettes) {
    for (const view of views) {
      await open(`palette=${id}&${view.query}`);
      await page.screenshot({ path: `out/${id}-${view.name}.png` });
    }
  }
}

await browser.close();
server.close();
