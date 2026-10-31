// 在有显卡的无头 Chrome 里烘焙图集，写到 out/，并生成风格包和节日包的清单。
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { COMBOS } from '../web/sim/combos.js';
import { startServer } from './serve.js';

const PORT = 4181;
const argv = process.argv.slice(2);
const palettes = argv.length > 0 ? argv : ['sunny', 'dusk', 'dayOnly'];

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
await page.goto(`http://localhost:${String(PORT)}/web/bake.html`);
await page.waitForFunction(() => window.bakerReady === true);

const { keys, footprints } = await page.evaluate(() => window.keysFor([32, 64]));
const report = {};
const write = (file, data) => {
  writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
  return statSync(file).size;
};
for (const id of palettes) {
  const { png, frames, stats } = await page.evaluate(([paletteId, list]) => window.bakeAtlas(paletteId, list), [id, keys]);
  const pngBytes = write(`out/atlas-${id}.png`, png);
  writeFileSync(`out/atlas-${id}.json`, JSON.stringify(frames));
  report[id] = { ...stats, pngBytes };
  console.log(id, stats.count, '张，', stats.frames, '帧', Math.round(stats.bakeMs), '毫秒', pngBytes, '字节', `${String(stats.width)}×${String(stats.height)}`);
  for (const [name, { count, ms }] of Object.entries(stats.groups)) {
    console.log(`  ${name}：${String(count)} 张，每张 ${String(Math.round(ms / count))} 毫秒`);
  }
}

const festival = await page.evaluate(([paletteId, list]) => window.bakeFestival(paletteId, list), ['sunny', footprints]);
const festivalBytes = write('out/festival-national-day.png', festival.png);
writeFileSync('out/festival-national-day.json', JSON.stringify(festival.frames));
report.festival = { ...festival.stats, pngBytes: festivalBytes };
console.log('节日层', festival.stats.count, '张', festivalBytes, '字节', `${String(festival.stats.width)}×${String(festival.stats.height)}`);

// 风格包的规格约定：specs 是整张烘焙的规格；parts 是模块，combos 是模块的组合，同一规格可以有很多组合。
// 风格包可以只提供一部分：缺的规格退回标准风格。节日层只认占地规格，不认外观，所以两种做法都能叠加。
writeFileSync(
  'out/style-standard.json',
  JSON.stringify(
    {
      formatVersion: 2,
      id: 'standard',
      name: '标准',
      tileWidth: 128,
      atlases: [{ image: 'atlas-sunny.png', frames: 'atlas-sunny.json' }],
      specs: keys.filter((key) => /^(B|Q|S|P|t|farmhouse)-/.test(key)),
      parts: keys.filter((key) => /^M[pbr]-/.test(key)),
      combos: { '2x2': COMBOS, Q3: COMBOS },
      festivalOverrides: {},
      fallback: null,
    },
    null,
    2,
  ),
);
writeFileSync(
  'out/festival-national-day-pack.json',
  JSON.stringify(
    {
      formatVersion: 1,
      id: 'national-day',
      name: '国庆',
      from: 1001,
      to: 1007,
      timezone: 'country',
      generic: { image: 'festival-national-day.png', frames: 'festival-national-day.json', footprints },
      styles: {},
    },
    null,
    2,
  ),
);
writeFileSync('out/gen-report.json', JSON.stringify(report, null, 2));
await browser.close();
server.close();
