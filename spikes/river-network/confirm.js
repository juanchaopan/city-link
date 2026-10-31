'use strict';

const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { fill } = require('./run');
const { lineLook } = require('./verify');
const OPT = require('./params');

const N = 64;
const SCALE = 3;
const OUT = path.join(__dirname, 'out');
const STRAIGHT_MARK = 26;
const MARK_RADIUS = 20;

function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function writePng(file, width, height, rgb) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// 整群确认图：城市格线较淡；品红圈是明显直角，黄线是长度超过阈值的直段。
function main() {
  let chosen = null;
  for (let seed = 1; seed <= 30 && !chosen; seed++) {
    const { edges } = fill(seed, N, 3, OPT, 0).cluster;
    if (Object.values(edges).filter((type) => type === 'coast').length >= 2) chosen = seed;
  }
  const { cluster } = fill(chosen, N, 3, OPT);
  const size = N * 8 * SCALE;
  const rgb = Buffer.alloc(size * size * 3);
  const put = (x, y, colour) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= size || py >= size) return;
    const i = (py * size + px) * 3;
    rgb[i] = colour[0];
    rgb[i + 1] = colour[1];
    rgb[i + 2] = colour[2];
  };
  const ground = [[150, 190, 110], [120, 170, 90], [165, 150, 105], [205, 195, 180]];
  const V = N + 1;
  for (let sy = 0; sy < 8; sy++) {
    for (let sx = 0; sx < 8; sx++) {
      const slot = cluster.slots[sy * 8 + sx];
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const t = y * N + x;
          const level = slot.h[y * V + x];
          const shade = (level - slot.h[(y + 1) * V + x + 1]) * 22;
          let colour = ground[level].map((c) => Math.max(0, Math.min(255, c + shade)));
          if (slot.forest[t]) colour = colour.map((c, i) => c * (i === 1 ? 0.72 : 0.5));
          if (slot.mineral[t]) colour = [200, 80, 70];
          if (slot.water[t]) colour = slot.coast[t] ? [30, 80, 150] : [60, 120, 200];
          if (x === 0 || y === 0) colour = colour.map((c) => c * 0.82);
          for (let py = 0; py < SCALE; py++) {
            for (let px = 0; px < SCALE; px++) put((sx * N + x) * SCALE + px, (sy * N + y) * SCALE + py, colour);
          }
        }
      }
    }
  }
  let sharp = 0;
  let longStraight = 0;
  for (let sy = 0; sy < 8; sy++) {
    for (let sx = 0; sx < 8; sx++) {
      const slot = cluster.slots[sy * 8 + sx];
      for (const line of slot.lines) {
        const look = lineLook(line.points);
        if (look.straight >= STRAIGHT_MARK) {
          longStraight++;
          for (const [x, y] of look.straightPoints) {
            for (let dy = -2; dy <= 2; dy++) {
              for (let dx = -2; dx <= 2; dx++) put((sx * N + x) * SCALE + dx, (sy * N + y) * SCALE + dy, [255, 225, 30]);
            }
          }
        }
        for (const [x, y] of look.sharpAt) {
          sharp++;
          for (let a = 0; a < 160; a++) {
            const angle = (a / 160) * 6.283;
            for (let r = MARK_RADIUS - 2; r <= MARK_RADIUS + 2; r++) {
              put((sx * N + x) * SCALE + Math.cos(angle) * r, (sy * N + y) * SCALE + Math.sin(angle) * r, [235, 40, 200]);
            }
          }
        }
      }
    }
  }
  writePng(path.join(OUT, 'confirm.png'), size, size, rgb);
  console.log(JSON.stringify({ seed: chosen, edges: cluster.edges, mainSlots: cluster.skeleton.mainSlots.length, sharp, longStraight, straightMark: STRAIGHT_MARK }));
}

main();
