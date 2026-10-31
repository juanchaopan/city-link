// 模块拼装实验的样张：2×2 地块和直角边 3 格的大三角地块，各用八种组合拼出来，白天一排、夜里一排。
// 输出 out/r6-modules.png。
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startServer } from './serve.js';

const PORT = 4187;
const server = await startServer(PORT);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.error('页面错误', error));
await page.goto(`http://localhost:${String(PORT)}/web/bake.html`);
await page.waitForFunction(() => window.bakerReady === true);

const url = await page.evaluate(async () => {
  const { Baker } = await import('/web/kit/bake.js');
  const { bakeKey } = await import('/web/kit/catalog.js');
  const { palettes } = await import('/web/kit/palettes.js');
  const { COMBOS, modulesOf } = await import('/web/sim/combos.js');
  const baker = new Baker();
  const palette = palettes.sunny;
  baker.usePalette(palette);
  const cache = new Map();
  const toCanvas = (sprite) => {
    const canvas = new OffscreenCanvas(sprite.w, sprite.h);
    canvas.getContext('2d').putImageData(new ImageData(sprite.data, sprite.w, sprite.h), 0, 0);
    return { canvas, ax: sprite.ax, ay: sprite.ay };
  };
  const sprite = (key) => {
    if (!cache.has(key)) {
      const { result } = bakeKey(baker, key, palette);
      cache.set(key, { body: toCanvas(result), glow: result.glow ? toCanvas(result.glow) : null });
    }
    return cache.get(key);
  };
  const cellW = 420;
  const cellH = 460;
  const rows = [
    ['2x2', 0],
    ['Q3', 0],
    ['Q3', 1],
  ];
  const sheet = new OffscreenCanvas(cellW * COMBOS.length, cellH * rows.length * 2);
  const context = sheet.getContext('2d');
  context.fillStyle = '#8fc070';
  context.fillRect(0, 0, sheet.width, sheet.height / 2);
  context.fillStyle = '#26325a';
  context.fillRect(0, sheet.height / 2, sheet.width, sheet.height / 2);
  rows.forEach(([size, q], rowIndex) => {
    COMBOS.forEach((combo, comboIndex) => {
      for (const night of [false, true]) {
        const ox = comboIndex * cellW + cellW / 2;
        const oy = (rowIndex + (night ? rows.length : 0)) * cellH + cellH * 0.72;
        for (const { key, lift, dx, dy } of modulesOf(combo, size, q)) {
          const { body, glow } = sprite(key);
          const sx = ox + (dx - dy) * 64;
          const sy = oy + (dx + dy) * 32 - lift * 16;
          context.filter = night ? 'brightness(0.32) saturate(0.8)' : 'none';
          context.drawImage(body.canvas, Math.round(sx - body.ax), Math.round(sy - body.ay));
          context.filter = 'none';
          if (night && glow)
            context.drawImage(glow.canvas, Math.round(sx - glow.ax), Math.round(sy - glow.ay));
        }
      }
    });
  });
  const blob = await sheet.convertToBlob({ type: 'image/png' });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
});
writeFileSync('out/r6-modules.png', Buffer.from(url.split(',')[1], 'base64'));
await browser.close();
server.close();
