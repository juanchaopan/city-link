// 只跑高架和立交的遮罩检查，比完整的路面验收快得多，调模板时用。
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
const { rows } = await page.evaluate(() => window.runLaneChecks());
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
await browser.close();
server.close();
