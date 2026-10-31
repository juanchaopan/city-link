// 立交验收：同高相交、桥墩、侧面、转角、开到主线、匝道开口、匝道上的车，输出报告和样张。
// node scripts/ixcheck.js [报告名]。样张是 out/r8-ix-tee.png、r8-ix-diamond.png、r8-ramp-merge.png、r8-ramp-cars.png。
// CITY=1 时查默认城市里的立交和高架，主线另外逐格查桥墩、净空和主线下面的物业；这一轮遮罩大，单独跑。
// NO_SHEET=1 时不出样张。不通过时退出码是 1。
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startServer } from './serve.js';

const PORT = 4189;
const reportName = process.argv[2] ?? 'ix-report';

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
await page.goto(`http://localhost:${String(PORT)}/web/ixcheck.html`);
await page.waitForFunction(() => window.ixReady === true, null, { timeout: 60000 });

const write = (file, data) => writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
const { rows, cells, failures } = await page.evaluate((city) => {
  return city ? window.runIxCity() : window.runIxChecks();
}, Boolean(process.env.CITY));
console.log(['类型', ...failures, '结果'].join('\t'));
for (const row of rows) {
  console.log([row.name, ...failures.map((key) => row[key]), row.pass ? '通过' : '不通过'].join('\t'));
  const { piers, worstTurn, worstCarOffset, carSamples, sideSamples, driveSamples, openingSamples } = row;
  console.log(
    '  ',
    JSON.stringify({ piers, worstTurn, worstCarOffset, carSamples, sideSamples, driveSamples, openingSamples }),
  );
  if (!row.pass) console.log('  ', JSON.stringify(row.examples).slice(0, 600));
}
if (cells) console.log('高架主线', JSON.stringify(cells).slice(0, 400));
writeFileSync(`out/${reportName}.json`, JSON.stringify({ rows, cells }, null, 2));
if (!process.env.NO_SHEET && !process.env.CITY) {
  for (const name of ['tee', 'diamond'])
    write(`out/r8-ix-${name}.png`, await page.evaluate((id) => window.renderIxSheet(id), name));
  write('out/r8-ramp-merge.png', await page.evaluate(() => window.renderMergeSheet()));
  write('out/r8-ramp-cars.png', await page.evaluate(() => window.renderRampCars()));
}
await browser.close();
server.close();
const cellsFail = cells && (cells.piersOnRoad > 0 || cells.lowOverRoad > 0 || cells.lotsUnder > 0);
if (rows.some((row) => !row.pass) || cellsFail) process.exitCode = 1;
