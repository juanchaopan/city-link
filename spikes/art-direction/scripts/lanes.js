// 只跑高架和立交的遮罩检查，比完整的路面验收快得多，调模板时用。不通过时退出码是 1，苜蓿叶和喇叭形不交付，不计入。
import { chromium } from 'playwright';
import { startServer } from './serve.js';

const PORT = 4186;
const server = await startServer(PORT);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.error('页面错误', error));
await page.goto(`http://localhost:${String(PORT)}/web/roadcheck.html`);
await page.waitForFunction(() => window.runLaneChecks !== undefined, null, { timeout: 60000 });
const { rows, pass } = await page.evaluate(() => window.runLaneChecks());
for (const row of rows)
  console.log(
    row.name,
    row.lanes,
    row.samples,
    row.holes,
    row.side,
    row.pass ? '通过' : '不通过',
    JSON.stringify(row.examples),
  );
console.log(pass ? '交付范围全部通过' : '交付范围不通过');
await browser.close();
server.close();
if (!pass) process.exitCode = 1;
