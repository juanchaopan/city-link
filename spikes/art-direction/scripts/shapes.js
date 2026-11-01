// 路口穷举验收和间距试验。node scripts/shapes.js [shapes|spacing|sheets]，不写参数全跑。
// shapes：219 种摆法加四车道代表组合，写 out/shape-report.json。不通过时退出码是 1。
// spacing：相邻路口隔 1、2、3 格的样例，写 out/spacing-report.json，SPACING_NAME 换报告名。
// sheets：out/r9-junction-shapes.png 和 out/r9-spacing.png，要先有两份报告。
// LIMIT=30 只跑前 30 个场景。REPLACE="文件|原文|替换" 在页面加载时改一处源码，分号隔开多处：
// 证明检查能失败、试不同的合并间距都用它，不动仓库里的代码。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startServer } from './serve.js';

const PORT = 4196;
const BATCH = 20;
const stepsWanted = process.argv[2] ? [process.argv[2]] : ['shapes', 'spacing', 'sheets'];
const limit = Number(process.env.LIMIT ?? Infinity);
const reportName = process.env.REPORT ?? 'shape-report';
const spacingName = process.env.SPACING_NAME ?? 'spacing-report';
const replacements = (process.env.REPLACE ?? '')
  .split(';')
  .filter(Boolean)
  .map((item) => item.split('|'));

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
for (const [file, from, to] of replacements) {
  await page.route(`**/web/${file}`, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    if (!source.includes(from)) throw new Error(`${file} 里没有 ${from}`);
    await route.fulfill({ response, body: source.split(from).join(to) });
  });
}
await page.goto(`http://localhost:${String(PORT)}/web/shapecheck.html`);
await page.waitForFunction(() => window.shapeReady === true, null, { timeout: 60000 });

const write = (file, data) => writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));

async function runShapes() {
  const total = Math.min(limit, await page.evaluate(() => window.shapeCount()));
  const rows = [];
  for (let start = 0; start < total; start += BATCH) {
    const batch = await page.evaluate(
      ([from, count]) => window.runShapeBatch(from, count),
      [start, Math.min(BATCH, total - start)],
    );
    rows.push(...batch);
    console.log(start + batch.length, '/', total, '错', rows.filter((row) => row.errors > 0).length);
  }
  const keys = Object.keys(rows[0]).filter((key) => typeof rows[0][key] === 'number');
  const totals = Object.fromEntries(
    keys.map((key) => [key, rows.reduce((sum, row) => sum + row[key], 0)]),
  );
  const failed = rows.filter((row) => row.errors > 0);
  console.log('合计', JSON.stringify(totals));
  console.log('最多相位', Math.max(...rows.map((row) => row.phases)));
  console.log('不通过', failed.length, '/', rows.length);
  for (const row of failed.slice(0, 12))
    console.log(row.name, row.errors, JSON.stringify(row.examples).slice(0, 200));
  writeFileSync(`out/${reportName}.json`, JSON.stringify({ totals, rows }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

async function runSpacing() {
  const rows = await page.evaluate(() => window.runSpacing());
  for (const row of rows) {
    console.log(
      [
        row.name,
        `大路口组 ${String(row.clusters)}`,
        `相位 ${String(row.phases)}`,
        `周期 ${String(row.cycle)}`,
        `排队 ${JSON.stringify(row.room)}`,
        `错 ${JSON.stringify(row.errors)}`,
        `公交 ${JSON.stringify(row.runBuses)}`,
        `混合 ${JSON.stringify(row.runMixed)}`,
      ].join(' | '),
    );
  }
  writeFileSync(`out/${spacingName}.json`, JSON.stringify(rows, null, 2));
}

async function runSheets() {
  const read = (name) =>
    existsSync(`out/${name}.json`) ? JSON.parse(readFileSync(`out/${name}.json`, 'utf8')) : null;
  const shapes = read(reportName)?.rows ?? [];
  const spacing = read(spacingName) ?? [];
  write(
    'out/r9-junction-shapes.png',
    await page.evaluate((rows) => window.renderShapeSheet(rows), shapes),
  );
  write('out/r9-spacing.png', await page.evaluate((rows) => window.renderSpacingSheet(rows), spacing));
}

const steps = { shapes: runShapes, spacing: runSpacing, sheets: runSheets };
for (const name of stepsWanted) await steps[name]();
await browser.close();
server.close();
