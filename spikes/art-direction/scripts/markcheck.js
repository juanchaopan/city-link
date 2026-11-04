// 停车线验收：车道线和中心线在停车线外缘结束，停车线以内只有斑马线；路面标记不画到路外。
// 查 15 类路口样例、路口穷举的全部场景和 128 全图，输出 out/mark-report.json，不通过时退出码是 1。
// NO_SHAPES=1 不查穷举，NO_CITY=1 不查全图。第一个参数是报告的文件名。
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startServer } from './serve.js';

const PORT = 4191;
const reportName = process.argv[2] ?? 'mark-report';

mkdirSync('out', { recursive: true });
const server = await startServer(PORT);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.error('页面错误', error));
await page.goto(`http://localhost:${String(PORT)}/web/markcheck.html`);
await page.waitForFunction(() => window.markReady === true, null, { timeout: 60000 });
const rows = await page.evaluate((options) => window.runMarkChecks(options), {
  shapes: !process.env.NO_SHAPES,
  city: !process.env.NO_CITY,
});
const columns = ['legs', 'linePixels', 'legsWithLines', 'paintedOffDeck'];
console.log(['类型', ...columns, '结果'].join('\t'));
for (const row of rows) {
  console.log(
    [row.name, ...columns.map((key) => row[key]), row.pass ? '通过' : '不通过'].join('\t'),
  );
  if (!row.pass)
    console.log('  ', JSON.stringify([row.examples, row.offDeckExamples]).slice(0, 400));
}
const totals = Object.fromEntries(
  columns.map((key) => [key, rows.reduce((sum, row) => sum + row[key], 0)]),
);
console.log('合计', JSON.stringify(totals));
writeFileSync(`out/${reportName}.json`, JSON.stringify({ totals, rows }, null, 2));
await browser.close();
server.close();
if (rows.some((row) => !row.pass)) process.exitCode = 1;
