import fs from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

const images = await page.evaluate(() => {
  const ROAD = 0.42;
  const SLOPE_STARTS = [3, 6];

  // 坡带 1 格宽、高差 1 层，和 ADR-0001 的直坡一致。front 朝向镜头，是最容易看出侧倾的方向。
  const rise = (u) => {
    if (u < 3) return 0;
    if (u < 4) return u - 3;
    if (u < 6) return 1;
    if (u < 7) return 1 + (u - 6);
    return 2;
  };

  function scene(variant, orientation, face, S) {
    const W = 215 * S;
    const H = 170 * S;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const c = canvas.getContext('2d');
    c.fillStyle = '#dfe7ec';
    c.fillRect(0, 0, W, H);
    const ground = (x) => (face === 'back' ? rise(x) : rise(10 - x));
    const ox = W / 2 + (orientation === 'A' ? 0 : -15 * S);
    const oy = 8 * S;
    const project = (x, y, z) => [ox + (x - y) * 16 * S, oy + (x + y) * 8 * S - (z - 1) * 8 * S];
    const poly = (points, fill, stroke) => {
      c.beginPath();
      points.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p)));
      c.closePath();
      c.fillStyle = fill;
      c.fill();
      if (stroke) {
        c.strokeStyle = stroke;
        c.stroke();
      }
    };

    const cells = [];
    for (let y = 0; y < 10; y += 0.5) for (let x = 0; x < 10; x += 0.5) cells.push([x, y]);
    cells.sort((a, b) => a[0] + a[1] - b[0] - b[1]);
    const shade = face === 'back' ? '#a7c47f' : '#5f8c43';
    for (const [x, y] of cells) {
      const q = [[x, y], [x + 0.5, y], [x + 0.5, y + 0.5], [x, y + 0.5]].map(([a, b]) => project(a, b, ground(a)));
      const slope = ground(x + 0.5) !== ground(x);
      poly(q, slope ? shade : '#7fae5b', Number.isInteger(x) && Number.isInteger(y) ? 'rgba(0,0,0,0.08)' : null);
    }

    const start = orientation === 'A' ? [1.5, 1.5] : [1.5, 8.5];
    const direction = orientation === 'A' ? [1, 1] : [1, -1];
    const length = 7;
    const unit = [direction[0] / Math.SQRT2, direction[1] / Math.SQRT2];
    const normal = [-unit[1], unit[0]];
    const half = ROAD / 2;
    const at = (t) => [start[0] + direction[0] * t, start[1] + direction[1] * t];

    const quad = (a, b, heights) => {
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const n = [-(b[1] - a[1]) / d, (b[0] - a[0]) / d];
      const left = (p) => [p[0] + n[0] * half, p[1] + n[1] * half];
      const right = (p) => [p[0] - n[0] * half, p[1] - n[1] * half];
      return [left(a), left(b), right(b), right(a)].map(([x, y], i) => project(x, y, heights(x, y, i)));
    };

    const car = (x, y, tilt) => {
      const len = 0.17;
      const wid = 0.1;
      const corner = (a, b, lift) => {
        const px = x + tilt.u[0] * a + tilt.n[0] * b;
        const py = y + tilt.u[1] * a + tilt.n[1] * b;
        return project(px, py, tilt.z(px, py) + lift);
      };
      const roof = [corner(-len, -wid, 0.28), corner(len, -wid, 0.28), corner(len, wid, 0.28), corner(-len, wid, 0.28)];
      const base = [corner(-len, -wid, 0.04), corner(len, -wid, 0.04), corner(len, wid, 0.04), corner(-len, wid, 0.04)];
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        poly([base[i], base[j], roof[j], roof[i]], '#a92f27', '#7a1f1a');
      }
      poly(roof, '#e0483e', '#7a1f1a');
    };

    if (variant === 'camber' || variant === 'bench') {
      const steps = [];
      for (let t = 0; t < length; t += 0.05) steps.push(t);
      for (const t of steps) {
        const a = at(t);
        const b = at(t + 0.05);
        if (variant === 'camber') {
          poly(quad(a, b, (x) => ground(x)), '#55565c');
          continue;
        }
        const zc = (ground(a[0]) + ground(b[0])) / 2;
        for (const sign of [1, -1]) {
          const e = (p, extra) => [p[0] + normal[0] * (half + extra) * sign, p[1] + normal[1] * (half + extra) * sign];
          const gz = ground(e([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 0)[0]);
          if (Math.abs(gz - zc) < 0.01) continue;
          const cut = gz > zc;
          const spread = cut ? 0.06 : 0.24;
          const fa = e(a, spread);
          const fb = e(b, spread);
          poly([project(...e(a, 0), zc), project(...e(b, 0), zc), project(...fb, ground(fb[0])), project(...fa, ground(fa[0]))], cut ? '#8c8578' : '#a08e63');
        }
        poly(quad(a, b, () => zc), '#55565c');
      }
      for (let t = 0.2; t < length; t += 0.5) {
        const a = at(t);
        const b = at(t + 0.2);
        c.strokeStyle = '#f2e9b0';
        c.lineWidth = S / 2;
        c.beginPath();
        c.moveTo(...project(...a, ground(a[0])));
        c.lineTo(...project(...b, ground(b[0])));
        c.stroke();
      }
      const position = at(face === 'back' ? 2 : 2);
      const surface = variant === 'camber' ? (x) => ground(x) : () => ground(position[0]);
      car(position[0], position[1], { n: normal, u: unit, z: surface });
    } else {
      // 折线画法：斜路进入坡带前折成直线，直着过坡，再折回 45°，全程没有横向倾斜。
      const path = [[...start]];
      let p = [...start];
      for (const u of SLOPE_STARTS) {
        const before = [u, p[1] + direction[1] * (u - p[0])];
        const after = [u + 1, before[1]];
        path.push(before, after);
        p = after;
      }
      path.push([start[0] + length, p[1] + direction[1] * (start[0] + length - p[0])]);
      for (let i = 0; i + 1 < path.length; i++) {
        const from = path[i];
        const to = path[i + 1];
        const count = Math.max(1, Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.05));
        for (let k = 0; k < count; k++) {
          const a = [from[0] + (to[0] - from[0]) * (k / count), from[1] + (to[1] - from[1]) * (k / count)];
          const b = [from[0] + (to[0] - from[0]) * ((k + 1) / count), from[1] + (to[1] - from[1]) * ((k + 1) / count)];
          poly(quad(a, b, (x, y, i2) => (i2 === 0 || i2 === 3 ? ground(a[0]) : ground(b[0]))), '#55565c');
        }
      }
      car(3.5, path[1][1], { n: [0, 1], u: [1, 0], z: (x) => ground(x) });
    }
    return canvas;
  }

  const LABELS = {
    camber: 'A 路面贴坡：一边高一边低',
    bench: 'B 切坡路基：路面水平，挡墙和填方接地形',
    zigzag: 'C 折线过坡：进坡前折成直坡，不侧倾',
  };
  const VARIANTS = ['camber', 'bench', 'zigzag'];
  const ROWS = [['front', 'A'], ['front', 'B'], ['back', 'A'], ['back', 'B']];
  const out = {};
  const sheet = (S, name) => {
    const w = 215 * S;
    const h = 170 * S;
    const canvas = document.createElement('canvas');
    canvas.width = w * 3;
    canvas.height = h * ROWS.length + 60;
    const s = canvas.getContext('2d');
    s.fillStyle = '#ffffff';
    s.fillRect(0, 0, canvas.width, canvas.height);
    s.fillStyle = '#10131a';
    s.font = `${S >= 3 ? 26 : 18}px sans-serif`;
    VARIANTS.forEach((variant, column) => {
      s.fillText(LABELS[variant], column * w + 16, 38);
      ROWS.forEach(([face, orientation], row) => {
        const scenery = scene(variant, orientation, face, S);
        s.drawImage(scenery, column * w, 60 + row * h);
        if (S >= 3) out[`q014-${variant}-${face}-${orientation}`] = scenery.toDataURL('image/png');
      });
    });
    out[name] = canvas.toDataURL('image/png');
  };
  sheet(4, 'q014-sheet');
  sheet(2, 'q014-sheet-game-scale');
  return out;
});

await browser.close();
for (const [name, url] of Object.entries(images)) {
  fs.writeFileSync(`out/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
}
console.log(Object.keys(images).length);
