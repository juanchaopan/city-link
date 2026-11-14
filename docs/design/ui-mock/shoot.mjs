// 逐张出图：SPIKE_DIR=<美术探针目录> node shoot.mjs [编号前缀...]，输出到 OUT_DIR（默认 ./out）。
// PORT 默认 4193，两个出图任务同时跑时各用一个端口。SCALE 和 QUALITY 控制图的像素倍数和 JPEG 质量，
// 默认 1.25 倍、质量 75，一张约 100 到 200 KB，进仓库的图都按默认值出。
// Playwright 取自探针目录自己的依赖，这里不另装。
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { startServer } from './server.mjs';
import { SCREENS } from './screens.js';

if (!process.env.SPIKE_DIR) {
  throw new Error('请设置 SPIKE_DIR，指向美术探针的 spikes/art-direction 目录，做法见 README.md');
}
const spikeDir = path.resolve(process.env.SPIKE_DIR);
const { chromium } = createRequire(path.join(spikeDir, 'package.json'))('playwright');

const filter = process.argv.slice(2);
const outDir = process.env.OUT_DIR ?? 'out';
const port = Number(process.env.PORT ?? 4193);
const scale = Number(process.env.SCALE ?? 1.25);
const quality = Number(process.env.QUALITY ?? 75);
mkdirSync(outDir, { recursive: true });
const server = await startServer(port, spikeDir);
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const list = SCREENS.filter((s) => filter.length === 0 || filter.some((f) => s.id === f || s.id.startsWith(f)));
for (const s of list) {
  const page = await browser.newPage({ viewport: { width: 780, height: 884 }, deviceScaleFactor: scale });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${String(port)}/mock/outer.html?s=${s.id}`);
  try {
    await page.waitForFunction(() => document.getElementById('f').contentDocument?.documentElement?.dataset.done === 'true', null, { timeout: 180000 });
    await page.screenshot({ path: path.join(outDir, `${s.id}.jpg`), type: 'jpeg', quality });
    console.log(s.id, 'ok', errors.length ? errors.join(' | ') : '');
  } catch (e) {
    console.log(s.id, 'FAILED', errors.join(' | '), e.message.split('\n')[0]);
  }
  await page.close();
}
await browser.close();
server.close();
