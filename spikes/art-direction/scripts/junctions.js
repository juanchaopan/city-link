// 路口验收：在无头 Chrome 里用真实渲染的遮罩检查灯杆、斑马线、车脚点、停车位置、地块的地面轮廓和坡路，
// 输出 out/junction-report.json、out/r8-junction-sheet.png 和 out/r8-slope.png。
// NO_CITY=1 时跳过全图，只查样例；不通过时退出码是 1。第一个参数是报告的文件名。
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startServer } from './serve.js';

const PORT = 4188;
const reportName = process.argv[2] ?? 'junction-report';

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
await page.goto(`http://localhost:${String(PORT)}/web/junctioncheck.html`);
await page.waitForFunction(() => window.junctionReady === true, null, { timeout: 60000 });

const write = (file, data) => writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
const { rows, failures } = await page.evaluate(
  (withCity) => window.runJunctionChecks(withCity),
  !process.env.NO_CITY,
);
console.log(['类型', ...failures, '结果'].join('\t'));
for (const row of rows) {
  console.log([row.name, ...failures.map((key) => row[key]), row.pass ? '通过' : '不通过'].join('\t'));
  if (!row.pass) console.log('  ', JSON.stringify(row.examples).slice(0, 300));
}
const totals = Object.fromEntries(
  failures.map((key) => [key, rows.reduce((sum, row) => sum + row[key], 0)]),
);
console.log('合计', JSON.stringify(totals));
writeFileSync(`out/${reportName}.json`, JSON.stringify({ totals, rows }, null, 2));
write('out/r8-junction-sheet.png', await page.evaluate((list) => window.renderJunctionSheet(list), rows));
write('out/r8-slope.png', await page.evaluate((list) => window.renderSlopeSheet(list), rows));
await browser.close();
server.close();
if (rows.some((row) => !row.pass)) process.exitCode = 1;
