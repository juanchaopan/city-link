// 车行道干净度验收：路面内部除了路面色不能有别的颜色。输出 out/deck-report.json 和放大样张 out/r8-deck-zoom.png。
// node scripts/deckcheck.js [报告名]。NO_CITY=1 时只查验收样例，NO_SHEET=1 时不出样张。有脏像素时退出码是 1。
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startServer } from './serve.js';

const PORT = 4191;
const reportName = process.argv[2] ?? 'deck-report';

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
await page.goto(`http://localhost:${String(PORT)}/web/deckcheck.html`);
await page.waitForFunction(() => window.deckReady === true, null, { timeout: 60000 });

const { rows, threshold, inset } = await page.evaluate(
  (withCity) => window.runDeckChecks(withCity),
  !process.env.NO_CITY,
);
console.log(`亮度差上限 ${String(threshold)}（0 到 255），离路面边 ${String(inset)} 格以内不查`);
for (const row of rows) {
  console.log(
    [
      row.name,
      row.nodes,
      row.samples,
      row.dirty,
      row.worst,
      row.dirty > 0 ? JSON.stringify(row.examples) : '',
    ].join('\t'),
  );
}
const dirty = rows.reduce((sum, row) => sum + row.dirty, 0);
console.log('组合', rows.length, '脏像素合计', dirty);
writeFileSync(`out/${reportName}.json`, JSON.stringify({ threshold, inset, dirty, rows }, null, 2));
if (!process.env.NO_SHEET) {
  const data = await page.evaluate(() => window.renderDeckZoom());
  writeFileSync('out/r8-deck-zoom.png', Buffer.from(data.split(',')[1], 'base64'));
}
await browser.close();
server.close();
if (dirty > 0) process.exitCode = 1;
