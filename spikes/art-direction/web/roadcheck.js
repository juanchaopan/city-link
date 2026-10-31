import { LEVEL } from './kit/bake.js';
import { palettes } from './kit/palettes.js';
import { heightAt, hermite } from './kit/tiles.js';
import { CASES } from './roadcases.js';
import { compose, MASK, worldOf, worldOfCity } from './roadscene.js';
import { generateCity } from './sim/city.js';
import { cellPaths, DIRECTIONS, ROAD_SPEC, spokesOf } from './sim/network.js';

// 路面验收：拼好的路面逐像素核对。沿每条路采样，按几何算出这个点应该是车道、人行道还是路外，
// 再和遮罩配色下读出来的层比较。边界两侧留一点容差，容差以内的像素不计。
// 陡坡在屏幕上被压扁，1 像素的取整就对应较大的横向距离，所以坡路的容差放宽，车道内的判断不放宽。
// 桥头的栏杆会挡住靠近相机一侧的一点路面，挡墙压顶和人行道同色，这两处按遮挡处理，不算错误。

const CLASS = { empty: 0, deck: 1, walk: 2, curb: 3, other: 4 };
const MARGIN = 0.03;
const SLOPE_MARGIN = 0.1;
const FILLET_ZONE = 1.5;

/** 标线是红加绿，混在车道上还是车道；只有蓝色分量明显或者绿色压过红色才算别的层。 */
function classify(r, g, b, a) {
  if (a < 128) return CLASS.empty;
  if (r > 60 && b < r * 0.35 && g < r * 1.25) return CLASS.deck;
  if (g > 60 && r < g * 0.35 && b < g * 0.35) return CLASS.walk;
  if (b > 60 && r < b * 0.35 && g < b * 0.35) return CLASS.curb;
  return CLASS.other;
}

const isRoadClass = (value) => value >= CLASS.deck && value <= CLASS.curb;

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function lineDistance(line, px, py) {
  let best = Infinity;
  for (let i = 0; i < line.points.length - 1; i += 1) {
    const [ax, ay] = line.points[i];
    const [bx, by] = line.points[i + 1];
    best = Math.min(best, segmentDistance(px, py, ax, ay, bx, by));
  }
  return best;
}

/** 每条路中线的世界坐标和路面高度函数，高度决定采样点落在画面的哪个像素上。 */
function linesOf(world, mode) {
  const { N, sprites } = world;
  const lines = [];
  for (const id of [...sprites.cells.keys()].sort((a, b) => a - b)) {
    const { road, highway } = sprites.cells.get(id);
    const x = id % N;
    const y = Math.floor(id / N);
    const inWater = world.isWater(x, y);
    const bridge = inWater || world.isWater(x - 1, y) || world.isWater(x + 1, y) || world.isWater(x, y - 1) || world.isWater(x, y + 1);
    const level = inWater ? 0 : world.levelOf(x, y);
    const corners = world.cornersOf(x, y).map((v) => v - level);
    const flat = world.isFlat(x, y);
    const grade = mode === 'legacy' ? null : sprites.grades.get(id);
    const free = spokesOf(road | highway).length === 1;
    for (const path of cellPaths(road, highway)) {
      const points = path.points.map(([px, py]) => [px + x + 0.5, py + y + 0.5]);
      const [a, c] = [points[0], points[points.length - 1]];
      const heightOf = (px, py) => {
        if (flat) return level;
        if (grade) {
          const dx = c[0] - a[0];
          const dy = c[1] - a[1];
          const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy)));
          return level + hermite(grade, t);
        }
        return level + heightAt(corners, px - x - 0.5, py - y - 0.5) / LEVEL;
      };
      lines.push({ cell: id, kind: path.kind, points, heightOf, free, bridge, flat, walk: ROAD_SPEC[path.kind].walk / 2, deck: ROAD_SPEC[path.kind].deck / 2 });
    }
  }
  if (world.linked) {
    for (const gate of world.gates) {
      const [dx, dy] = DIRECTIONS[(gate.inward + 4) % 8];
      const a = [gate.x + 0.5 + dx * 0.5, gate.y + 0.5 + dy * 0.5];
      const c = [a[0] + dx * 1.2, a[1] + dy * 1.2];
      const spec = ROAD_SPEC[gate.kind];
      lines.push({ cell: -1, kind: gate.kind, points: [a, c], heightOf: () => 0, free: false, bridge: false, flat: true, walk: spec.walk / 2, deck: spec.deck / 2 });
    }
  }
  return lines;
}

function junctionsOf(world) {
  const { N, sprites } = world;
  const list = [];
  for (const [id, { road, highway }] of sprites.cells) {
    const spokes = spokesOf(road | highway);
    const mixed = spokes.length === 2 && road && highway;
    if (spokes.length >= 3 || mixed) list.push({ x: (id % N) + 0.5, y: Math.floor(id / N) + 0.5, spokes, road, highway });
  }
  return list;
}

function readPixels(context, width, height) {
  const { data } = context.getImageData(0, 0, width, height);
  return (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return CLASS.empty;
    const i = (y * width + x) * 4;
    return classify(data[i], data[i + 1], data[i + 2], data[i + 3]);
  };
}

const bucketKey = (x, y) => Math.floor(x / 2) * 4096 + Math.floor(y / 2);

function bucketsOf(lines) {
  const buckets = new Map();
  lines.forEach((line, index) => {
    const seen = new Set();
    for (const [px, py] of line.points) {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const key = bucketKey(px + dx * 2, py + dy * 2);
          if (seen.has(key)) continue;
          seen.add(key);
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(index);
        }
      }
    }
  });
  return buckets;
}

function inspect(world, mode) {
  const { canvas, context, place } = compose(world, MASK, mode, { withGround: false });
  const read = readPixels(context, canvas.width, canvas.height);
  const lines = linesOf(world, mode);
  const buckets = bucketsOf(lines);
  const junctions = junctionsOf(world);
  const nearJunction = (px, py) => junctions.some((junction) => Math.abs(junction.x - px) < FILLET_ZONE && Math.abs(junction.y - py) < FILLET_ZONE && Math.hypot(junction.x - px, junction.y - py) < FILLET_ZONE);
  const marks = {
    walkInDeck: new Map(),
    deckHole: new Map(),
    deckOutside: new Map(),
    walkHole: new Map(),
    overshoot: new Map(),
    capOvershoot: new Map(),
  };
  const mark = (name, x, y, px, py, found) => marks[name].set(y * canvas.width + x, [Math.round(px * 100) / 100, Math.round(py * 100) / 100, found]);
  let samples = 0;
  for (const line of lines) {
    for (let k = 0; k < line.points.length - 1; k += 1) {
      const [ax, ay] = line.points[k];
      const [bx, by] = line.points[k + 1];
      const length = Math.hypot(bx - ax, by - ay);
      const tx = (bx - ax) / length;
      const ty = (by - ay) / length;
      const stations = Math.max(1, Math.round(length / 0.02));
      const firstStation = line.free ? Math.ceil(MARGIN / 0.02) + 1 : 0;
      for (let s = firstStation; s <= stations; s += 1) {
        const t = (s / stations) * length;
        for (let v = -(line.walk + 0.12); v <= line.walk + 0.12; v += 0.015) {
          const px = ax + tx * t - ty * v;
          const py = ay + ty * t + tx * v;
          const others = buckets.get(bucketKey(px, py)) ?? [];
          let inDeck = false;
          let deckEdge = false;
          let inWalk = false;
          let walkEdge = false;
          for (const index of others) {
            const other = lines[index];
            const margin = other.flat ? MARGIN : SLOPE_MARGIN;
            const d = lineDistance(other, px, py);
            if (d < other.deck - margin) inDeck = true;
            else if (d <= other.deck + margin) deckEdge = true;
            else if (d < other.walk - margin) inWalk = true;
            else if (d <= other.walk + margin) walkEdge = true;
          }
          if (deckEdge && !inDeck) continue;
          const level = line.heightOf(ax + tx * t, ay + ty * t);
          const [sx, sy] = place.at(px, py, level);
          const x = Math.round(sx);
          const y = Math.round(sy);
          const found = read(x, y);
          samples += 1;
          if (inDeck) {
            if (found === CLASS.walk || found === CLASS.curb) mark('walkInDeck', x, y, px, py, found);
            else if (found === CLASS.empty || (found === CLASS.other && !line.bridge)) mark('deckHole', x, y, px, py, found);
          } else if (inWalk && !walkEdge) {
            if (nearJunction(px, py)) continue;
            if (found === CLASS.deck) mark('deckOutside', x, y, px, py, found);
            else if (found === CLASS.empty) mark('walkHole', x, y, px, py, found);
          } else if (!walkEdge) {
            if (nearJunction(px, py)) continue;
            if (isRoadClass(found) && !(found === CLASS.walk && !line.flat)) mark('overshoot', x, y, px, py, found);
          }
        }
      }
    }
  }

  // 断头路：平切线外面不能有路面。旧版本的圆头会越过这条线。
  for (const [id, { road, highway }] of world.sprites.cells) {
    const spokes = spokesOf(road | highway);
    if (spokes.length !== 1 || world.isWater(id % world.N, Math.floor(id / world.N))) continue;
    const [dx, dy] = DIRECTIONS[(spokes[0] + 4) % 8];
    const length = Math.hypot(dx, dy);
    const half = ROAD_SPEC[highway ? 'highway' : 'road'].walk / 2;
    const cx = (id % world.N) + 0.5;
    const cy = Math.floor(id / world.N) + 0.5;
    for (let u = 0.035; u < half + 0.1; u += 0.01) {
      for (let v = -half; v <= half; v += 0.01) {
        const px = cx + (dx * u - dy * v) / length;
        const py = cy + (dy * u + dx * v) / length;
        const [sx, sy] = place.at(px, py, world.levelOf(id % world.N, Math.floor(id / world.N)));
        const x = Math.round(sx);
        const y = Math.round(sy);
        const found = read(x, y);
        if (isRoadClass(found)) mark('capOvershoot', x, y, px, py, found);
      }
    }
  }

  // 路口的每个夹角都要有圆角：夹角尖点外侧一点仍然是路面。
  let corners = 0;
  let sharp = 0;
  const sharpList = [];
  for (const junction of junctions) {
    const { spokes } = junction;
    for (let i = 0; i < spokes.length; i += 1) {
      const a = spokes[i];
      const c = spokes[(i + 1) % spokes.length];
      const gap = (c - a + 8) % 8 || 8;
      if (gap >= 4) continue;
      const kindOf = (dir) => (junction.highway & (1 << dir) ? 'highway' : 'road');
      if (kindOf(a) !== kindOf(c)) continue;
      const half = ROAD_SPEC[kindOf(a)].deck / 2;
      const angle = (gap * Math.PI) / 4;
      const middle = ((a + gap / 2) * Math.PI) / 4;
      const distance = half / Math.sin(angle / 2) + 0.02;
      const px = junction.x + Math.cos(middle) * distance;
      const py = junction.y + Math.sin(middle) * distance;
      const [sx, sy] = place.at(px, py, 0);
      corners += 1;
      const found = read(Math.round(sx), Math.round(sy));
      if (found !== CLASS.deck) {
        sharp += 1;
        sharpList.push([Math.round(px * 100) / 100, Math.round(py * 100) / 100, found, a, c]);
      }
    }
  }

  const examples = {};
  for (const [name, map] of Object.entries(marks)) examples[name] = [...map.values()].slice(0, 6);
  examples.sharp = sharpList.slice(0, 6);

  return {
    samples,
    walkInDeck: marks.walkInDeck.size,
    deckHole: marks.deckHole.size,
    deckOutside: marks.deckOutside.size,
    walkHole: marks.walkHole.size,
    overshoot: marks.overshoot.size,
    capOvershoot: marks.capOvershoot.size,
    corners,
    sharpCorners: sharp,
    wobblePixels: gradeReport(world, mode),
    examples,
  };
}

/** 坡段的路面相对两端连线的最大起伏（像素）。路面平直时这个数接近 0，跟着地形走时就是 S 形小弯。 */
function gradeReport(world, mode) {
  const lines = linesOf(world, mode);
  let worst = 0;
  const { N, sprites } = world;
  const seen = new Set();
  for (const id of sprites.grades.keys()) {
    if (seen.has(id)) continue;
    const { road, highway } = sprites.cells.get(id);
    const forward = DIRECTIONS[spokesOf(road | highway)[1]];
    const step = forward[1] * N + forward[0];
    let start = id;
    while (sprites.grades.has(start - step)) start -= step;
    const profile = [];
    for (let at = start; sprites.grades.has(at); at += step) {
      seen.add(at);
      const line = lines.find((entry) => entry.cell === at);
      const [a, c] = [line.points[0], line.points[line.points.length - 1]];
      for (let t = 0; t <= 1; t += 0.05) profile.push(line.heightOf(a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t));
    }
    const first = profile[0];
    const last = profile[profile.length - 1];
    profile.forEach((value, i) => {
      const expected = first + ((last - first) * i) / (profile.length - 1);
      worst = Math.max(worst, Math.abs(value - expected) * 32);
    });
  }
  return Math.round(worst * 10) / 10;
}

const COUNTERS = ['samples', 'walkInDeck', 'deckHole', 'deckOutside', 'walkHole', 'overshoot', 'capOvershoot', 'corners', 'sharpCorners'];

function add(total, result) {
  for (const key of COUNTERS) total[key] = (total[key] ?? 0) + result[key];
  total.wobblePixels = Math.max(total.wobblePixels ?? 0, result.wobblePixels);
  total.variants = (total.variants ?? 0) + 1;
  for (const [name, list] of Object.entries(result.examples)) {
    total.examples ??= {};
    total.examples[name] = [...(total.examples[name] ?? []), ...list].slice(0, 6);
  }
  return total;
}

function errorCount(row) {
  return row.walkInDeck + row.deckHole + row.deckOutside + row.walkHole + row.overshoot + row.capOvershoot + row.sharpCorners;
}

window.runChecks = (mode) => {
  const rows = [];
  for (const entry of CASES) {
    const total = {};
    for (const variant of entry.variants) add(total, inspect(worldOf(variant), mode));
    rows.push({ name: entry.name, ...total, pass: errorCount(total) === 0 });
  }
  for (const linked of [false, true]) {
    const city = generateCity(64, 11, 'spread', linked);
    const total = add({}, inspect(worldOfCity(city, linked), mode));
    rows.push({ name: linked ? '全图 64×64·已打通' : '全图 64×64·未打通', ...total, pass: errorCount(total) === 0 });
  }
  return rows;
};

/** 每类一张 2 倍放大的裁剪，用真实配色，标上类型名和检查结果。 */
window.renderSheet = (mode, results) => {
  const columns = 4;
  const cropW = 360;
  const cropH = 230;
  const scale = 2;
  const labelH = 44;
  const rows = Math.ceil(CASES.length / columns);
  const sheet = new OffscreenCanvas(columns * (cropW * scale + 12) + 12, rows * (cropH * scale + labelH + 12) + 12);
  const context = sheet.getContext('2d');
  context.fillStyle = '#20303a';
  context.fillRect(0, 0, sheet.width, sheet.height);
  CASES.forEach((entry, index) => {
    const variant = entry.variants[entry.sheetVariant ?? 0];
    const world = worldOf(variant);
    const { canvas, place } = compose(world, palettes.sunny, mode, { withGround: true });
    const [sx, sy] = place.at(entry.focus[0] + 0.5, entry.focus[1] + 0.5, 0);
    const col = index % columns;
    const line = Math.floor(index / columns);
    const dx = 12 + col * (cropW * scale + 12);
    const dy = 12 + line * (cropH * scale + labelH + 12);
    context.imageSmoothingEnabled = false;
    context.drawImage(canvas, sx - cropW / 2, sy - cropH / 2, cropW, cropH, dx, dy + labelH, cropW * scale, cropH * scale);
    const result = results.find((r) => r.name === entry.name);
    context.fillStyle = result.pass ? '#7fe0a0' : '#ff8a70';
    context.font = '700 26px "Microsoft YaHei"';
    context.fillText(`${entry.name}（${String(result.variants)} 种） ${result.pass ? '通过' : `错误 ${String(errorCount(result))}`}`, dx + 4, dy + 32);
  });
  return sheet.convertToBlob({ type: 'image/png' }).then((blob) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  }));
};

window.checkReady = true;
