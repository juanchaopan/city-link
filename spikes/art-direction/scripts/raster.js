// 不用浏览器的小画布：填三角形、画线、编码 PNG。只给不需要真实烘焙的俯视图和几何检查用。
import { deflateSync } from 'node:zlib';

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.from(type, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head, data])));
  return Buffer.concat([length, head, data, crc]);
}

export function createCanvas(width, height, [r, g, b]) {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  const put = (x, y, [cr, cg, cb]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 3;
    data[i] = cr;
    data[i + 1] = cg;
    data[i + 2] = cb;
  };
  return {
    width,
    height,
    put,
    rect(x0, y0, w, h, color) {
      for (let y = Math.round(y0); y < Math.round(y0 + h); y += 1) {
        for (let x = Math.round(x0); x < Math.round(x0 + w); x += 1) put(x, y, color);
      }
    },
    triangle(a, b2, c, color) {
      const minX = Math.floor(Math.min(a[0], b2[0], c[0]));
      const maxX = Math.ceil(Math.max(a[0], b2[0], c[0]));
      const minY = Math.floor(Math.min(a[1], b2[1], c[1]));
      const maxY = Math.ceil(Math.max(a[1], b2[1], c[1]));
      const edge = (p, q, x, y) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
      const area = edge(a, b2, c[0], c[1]);
      if (area === 0) return;
      const sign = Math.sign(area);
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const px = x + 0.5;
          const py = y + 0.5;
          if (edge(a, b2, px, py) * sign >= 0 && edge(b2, c, px, py) * sign >= 0 && edge(c, a, px, py) * sign >= 0) put(x, y, color);
        }
      }
    },
    line(a, c, color, thickness = 2) {
      const steps = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1])));
      for (let i = 0; i <= steps; i += 1) {
        const x = a[0] + ((c[0] - a[0]) * i) / steps;
        const y = a[1] + ((c[1] - a[1]) * i) / steps;
        this.rect(x - thickness / 2, y - thickness / 2, thickness, thickness, color);
      }
    },
    png() {
      const stride = width * 3 + 1;
      const raw = Buffer.alloc(stride * height);
      for (let y = 0; y < height; y += 1) {
        raw[y * stride] = 0;
        raw.set(data.subarray(y * width * 3, (y + 1) * width * 3), y * stride + 1);
      }
      const header = Buffer.alloc(13);
      header.writeUInt32BE(width, 0);
      header.writeUInt32BE(height, 4);
      header[8] = 8;
      header[9] = 2;
      return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
    },
  };
}
