// 在有显卡的无头 Chrome 里烘焙全部配色的图集，写到 out/。
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startServer } from './serve.js';

const PORT = 4181;
const argv = process.argv.slice(2);
const palettes = argv.length > 0 ? argv : ['sunny', 'maquette', 'dusk'];

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
  if (message.type() === 'error') console.error(message.text());
});
await page.goto(`http://localhost:${PORT}/web/bake.html`);
await page.waitForFunction(() => window.bakerReady === true);

const keys = await page.evaluate(() => window.keysFor([32, 64]));
const report = {};
for (const id of palettes) {
  const { png, frames, stats } = await page.evaluate(
    ([paletteId, list]) => window.bakeAtlas(paletteId, list),
    [id, keys],
  );
  const file = `out/atlas-${id}.png`;
  writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
  writeFileSync(`out/atlas-${id}.json`, JSON.stringify(frames));
  report[id] = { ...stats, pngBytes: statSync(file).size };
  console.log(id, stats.count, '张', Math.round(stats.bakeMs), '毫秒', statSync(file).size, '字节', `${stats.width}×${stats.height}`);
  for (const [name, { count, ms }] of Object.entries(stats.groups)) {
    console.log(`  ${name}：${count} 张，每张 ${Math.round(ms / count)} 毫秒`);
  }
}
writeFileSync('out/gen-report.json', JSON.stringify(report, null, 2));
await browser.close();
server.close();
