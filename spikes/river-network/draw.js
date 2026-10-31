'use strict';

const fs = require('fs');
const zlib = require('zlib');

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
  for (let y = 0; y < height; y++) {
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

function drawCluster(file, cluster, scale) {
  const { N } = cluster;
  const size = N * 8 * scale;
  const rgb = Buffer.alloc(size * size * 3);
  const ground = [[150, 190, 110], [120, 170, 90], [165, 150, 105], [205, 195, 180]];
  for (let sy = 0; sy < 8; sy++) {
    for (let sx = 0; sx < 8; sx++) {
      const slot = cluster.slots[sy * 8 + sx];
      if (!slot) continue;
      const V = N + 1;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const t = y * N + x;
          const level = slot.h[y * V + x];
          const shade = (level - slot.h[(y + 1) * V + x + 1]) * 22;
          let colour = ground[level].map((c) => Math.max(0, Math.min(255, c + shade)));
          if (slot.forest[t]) colour = colour.map((c, i) => c * (i === 1 ? 0.72 : 0.5));
          if (slot.mineral[t]) colour = [200, 80, 70];
          if (slot.water[t]) colour = slot.coast[t] ? [30, 80, 150] : [60, 120, 200];
          for (let py = 0; py < scale; py++) {
            for (let px = 0; px < scale; px++) {
              const ox = (sx * N + x) * scale + px;
              const oy = (sy * N + y) * scale + py;
              const i = (oy * size + ox) * 3;
              rgb[i] = colour[0];
              rgb[i + 1] = colour[1];
              rgb[i + 2] = colour[2];
            }
          }
        }
      }
    }
  }
  writePng(file, size, size, rgb);
}

module.exports = { drawCluster };
