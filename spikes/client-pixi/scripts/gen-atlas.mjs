import fs from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const result = await page.evaluate(() => {
  const W = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = W;
  const ctx = canvas.getContext('2d');
  const frames = {};
  let cx = 0;
  let cy = 0;
  let rowH = 0;
  const place = (name, w, h, draw) => {
    if (cx + w > W) {
      cx = 0;
      cy += rowH + 2;
      rowH = 0;
    }
    ctx.save();
    ctx.translate(cx, cy);
    draw(ctx, w, h);
    ctx.restore();
    frames[name] = { x: cx, y: cy, w, h };
    cx += w + 2;
    rowH = Math.max(rowH, h);
  };
  const surfaces = { grass: '#7fae5b', hill: '#a98f62', rock: '#b9b2a6' };
  const corners = (shape) => [(shape >> 3) & 1, (shape >> 2) & 1, (shape >> 1) & 1, shape & 1];
  for (const [name, colour] of Object.entries(surfaces)) {
    for (let shape = 0; shape < 15; shape++) {
      place(`ground-${name}-${shape}`, 64, 48, (c) => {
        const [a, b, cc, d] = corners(shape);
        const top = [32, 16 - a * 16];
        const right = [64, 32 - b * 16];
        const bottom = [32, 48 - cc * 16];
        const left = [0, 32 - d * 16];
        c.beginPath();
        c.moveTo(...top);
        c.lineTo(...right);
        c.lineTo(...bottom);
        c.lineTo(...left);
        c.closePath();
        c.fillStyle = colour;
        c.fill();
        c.fillStyle = `rgba(0,0,0,${0.03 * ((a + b - cc - d + 2) % 4)})`;
        c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.08)';
        c.stroke();
      });
    }
  }
  place('water', 64, 48, (c) => {
    c.beginPath();
    c.moveTo(32, 16);
    c.lineTo(64, 32);
    c.lineTo(32, 48);
    c.lineTo(0, 32);
    c.closePath();
    c.fillStyle = '#4a90c2';
    c.fill();
  });
  place('forest', 64, 64, (c) => {
    for (const [x, y] of [[24, 34], [40, 38], [32, 44]]) {
      c.beginPath();
      c.moveTo(x, y - 24);
      c.lineTo(x + 9, y);
      c.lineTo(x - 9, y);
      c.closePath();
      c.fillStyle = '#2f6b3a';
      c.fill();
    }
  });
  place('mineral', 64, 48, (c) => {
    c.fillStyle = '#6a5ca8';
    c.fillRect(22, 28, 8, 6);
    c.fillRect(36, 32, 8, 6);
  });
  const arms = [[32, 16], [64, 32], [32, 48], [0, 32], [48, 24], [48, 40], [16, 40], [16, 24]];
  arms.forEach(([x, y], index) => {
    place(`road-${index}`, 64, 48, (c) => {
      c.strokeStyle = '#55565c';
      c.lineWidth = 9;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(32, 32);
      c.lineTo(x, y);
      c.stroke();
    });
  });
  const palette = ['#d98c6a', '#cfc38f', '#8fb1cf', '#b58ac4', '#e0d9c8', '#9fb784', '#c9a36b', '#7f8fa8'];
  for (let i = 0; i < 16; i++) {
    const height = 24 + (i % 8) * 8;
    place(`building-${i + 1}`, 64, 96, (c) => {
      const base = 80;
      const colour = palette[i % palette.length];
      c.fillStyle = colour;
      c.beginPath();
      c.moveTo(12, base - height);
      c.lineTo(32, base - height + 10);
      c.lineTo(32, base + 10);
      c.lineTo(12, base);
      c.closePath();
      c.fill();
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fill();
      c.fillStyle = colour;
      c.beginPath();
      c.moveTo(52, base - height);
      c.lineTo(32, base - height + 10);
      c.lineTo(32, base + 10);
      c.lineTo(52, base);
      c.closePath();
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.15)';
      c.beginPath();
      c.moveTo(32, base - height - 10);
      c.lineTo(52, base - height);
      c.lineTo(32, base - height + 10);
      c.lineTo(12, base - height);
      c.closePath();
      c.fill();
    });
  }
  place('car', 16, 12, (c) => {
    c.fillStyle = '#e0483e';
    c.fillRect(2, 2, 12, 8);
  });
  place('ui-button', 160, 56, (c, w, h) => {
    c.fillStyle = '#2e6fd8';
    c.fillRect(0, 0, w, h);
  });
  return { png: canvas.toDataURL('image/png'), frames, used: cy + rowH };
});
await browser.close();
fs.mkdirSync('data/assets', { recursive: true });
fs.writeFileSync('data/assets/atlas.png', Buffer.from(result.png.split(',')[1], 'base64'));
fs.writeFileSync('data/atlas.json', JSON.stringify(result.frames));
console.log(JSON.stringify({ frames: Object.keys(result.frames).length, usedHeight: result.used }));
