// 路面验收：在有显卡的无头 Chrome 里跑渲染遮罩检查，当前版本和保留的旧版本各跑一遍，
// 输出 out/road-report.json、out/r6-road-sheet.png 和 out/r6-road-sheet-legacy.png。
// 当前版本有错误时退出码是 1；旧版本抓不到用户报告的错误时退出码也是 1，说明检查本身失效了。
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startServer } from './serve.js';

const PORT = 4185;

mkdirSync('out', { recursive: true });
const server = await startServer(PORT);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.error('页面错误', error));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('404')) console.error(message.text());
});
await page.goto(`http://localhost:${String(PORT)}/web/roadcheck.html`);
await page.waitForFunction(() => window.checkReady === true, null, { timeout: 60000 });

const write = (file, dataUrl) => writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
const report = {};
const columns = ['walkInDeck', 'deckHole', 'deckOutside', 'walkHole', 'overshoot', 'capOvershoot', 'sharpCorners', 'corners', 'wobblePixels', 'samples'];
for (const mode of ['current', 'legacy']) {
  const started = Date.now();
  const rows = await page.evaluate((m) => window.runChecks(m), mode);
  report[mode] = rows;
  console.log(mode, `${String(Math.round((Date.now() - started) / 1000))} 秒`);
  console.log(['类型', '变体', ...columns, '结果'].join('\t'));
  for (const row of rows) {
    console.log([row.name, row.variants, ...columns.map((key) => row[key]), row.pass ? '通过' : '不通过'].join('\t'));
  }
  if (mode === 'current') {
    for (const row of rows.filter((entry) => !entry.pass)) console.log(row.name, JSON.stringify(row.examples));
  }
  const sheet = await page.evaluate(([m, r]) => window.renderSheet(m, r), [mode, rows]);
  write(mode === 'current' ? 'out/r6-road-sheet.png' : 'out/r6-road-sheet-legacy.png', sheet);
}
writeFileSync('out/road-report.json', JSON.stringify(report, null, 2));
await browser.close();
server.close();

const failed = report.current.filter((row) => !row.pass).map((row) => row.name);
const caught = report.legacy.reduce((total, row) => total + row.walkInDeck, 0);
const caps = report.legacy.reduce((total, row) => total + row.capOvershoot, 0);
console.log('当前版本不通过的类型', failed.length === 0 ? '无' : failed.join('、'));
console.log('旧版本车道内人行道像素', caught, '圆头像素', caps);
if (failed.length > 0 || caught === 0 || caps === 0) process.exitCode = 1;
