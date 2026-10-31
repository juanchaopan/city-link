// 路面验收：在有显卡的无头 Chrome 里跑渲染遮罩检查，当前版本和保留的旧版本各跑一遍，再查高架和立交，
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
await page.waitForFunction(
  () => window.checkReady === true && window.runLaneChecks !== undefined,
  null,
  { timeout: 60000 },
);

const write = (file, dataUrl) => writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
const report = {};
const columns = [
  'walkInDeck',
  'deckHole',
  'deckOutside',
  'walkHole',
  'overshoot',
  'capOvershoot',
  'sharpCorners',
  'corners',
  'wobblePixels',
  'samples',
];
const sheets = {};
for (const mode of ['current', 'legacy']) {
  const started = Date.now();
  const rows = await page.evaluate((m) => window.runChecks(m), mode);
  report[mode] = rows;
  console.log(mode, `${String(Math.round((Date.now() - started) / 1000))} 秒`);
  console.log(['类型', '变体', ...columns, '结果'].join('\t'));
  for (const row of rows) {
    console.log(
      [
        row.name,
        row.variants,
        ...columns.map((key) => row[key]),
        row.pass ? '通过' : '不通过',
      ].join('\t'),
    );
  }
  if (mode === 'current') {
    for (const row of rows.filter((entry) => !entry.pass))
      console.log(row.name, JSON.stringify(row.examples));
  }
  sheets[mode] = await page.evaluate(([m, r]) => window.renderSheet(m, r), [mode, rows]);
}

const lanes = await page.evaluate(() => window.runLaneChecks());
report.lanes = lanes;
console.log('高架和立交');
for (const row of lanes.rows)
  console.log(
    [row.name, row.lanes, row.samples, row.holes, row.side, row.pass ? '通过' : '不通过'].join(
      '\t',
    ),
  );
console.log(JSON.stringify(lanes.footprints));
const laneSheet = await page.evaluate((rows) => window.renderLaneSheet(rows), lanes.rows);

/** 路面分类样张下面接上立交样张，拼成一张。 */
const stitched = await page.evaluate(
  async ([top, bottom]) => {
    const load = async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    };
    const [a, b] = await Promise.all([load(top), load(bottom)]);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(a.width, b.width);
    canvas.height = a.height + b.height;
    const context = canvas.getContext('2d');
    context.drawImage(a, 0, 0);
    context.drawImage(b, 0, a.height);
    return canvas.toDataURL('image/png');
  },
  [sheets.current, laneSheet],
);
write('out/r6-road-sheet.png', stitched);
write('out/r6-road-sheet-legacy.png', sheets.legacy);

writeFileSync('out/road-report.json', JSON.stringify(report, null, 2));
await browser.close();
server.close();

const failed = [...report.current, ...lanes.rows].filter((row) => !row.pass).map((row) => row.name);
const caught = report.legacy.reduce((total, row) => total + row.walkInDeck, 0);
const caps = report.legacy.reduce((total, row) => total + row.capOvershoot, 0);
console.log('当前版本不通过的类型', failed.length === 0 ? '无' : failed.join('、'));
console.log('旧版本车道内人行道像素', caught, '圆头像素', caps);
if (failed.length > 0 || caught === 0 || caps === 0) process.exitCode = 1;
