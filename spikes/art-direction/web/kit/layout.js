import { rng } from './builder.js';
import { DIRECTIONS } from './tiles.js';

// 写死的示例城市：高度、河流、路网和分区都是确定的，只用来检验素材拼起来的效果。

function valueNoise(seed) {
  const random = rng(seed);
  const table = new Float32Array(4096).map(() => random());
  const at = (x, y) => table[Math.abs(Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) % 4096];
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const top = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx;
    const bottom = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
}

function bitsString(list) {
  return list.map((v) => (v ? '1' : '0')).join('');
}

function spokesOf(mask) {
  const spokes = [];
  for (let d = 0; d < 8; d += 1) if (mask & (1 << d)) spokes.push(d);
  return spokes;
}

/** 台地：边是直线的矩形土丘，一层坡一层平，直坡上才能检验 45° 斜路的切坡路基。 */
function mound(x, y, [x0, y0, x1, y1], peak) {
  const margin = Math.min(x - x0, x1 - x, y - y0, y1 - y);
  return Math.max(0, Math.min(peak, Math.floor(margin / 2) + 1));
}

export function makeLayout(N, seed = 11) {
  const center = Math.round(N / 2);
  const s = N / 32;
  const noise = valueNoise(seed);
  const random = rng(seed * 7 + 3);
  const corner = (x, y) => y * (N + 1) + x;
  const h = new Int8Array((N + 1) * (N + 1));
  const riverAt = (x) => Math.round(center + 8 * s + 2 * s * Math.sin((x / N) * Math.PI * 2 + 0.7));

  const mounds = [
    { rect: [25 * s, 2 * s, 33 * s, 20 * s], peak: 3 },
    { rect: [-3 * s, -3 * s, 7 * s, 5 * s], peak: 3 },
    { rect: [19 * s, -3 * s, 33 * s, 5 * s], peak: 2 },
  ];
  for (let y = 0; y <= N; y += 1) {
    for (let x = 0; x <= N; x += 1) {
      for (const { rect, peak } of mounds) {
        h[corner(x, y)] = Math.max(h[corner(x, y)], mound(x, y, rect, peak));
      }
    }
  }

  const water = new Set();
  const cell = (x, y) => y * N + x;
  for (let x = 0; x < N; x += 1) {
    const r = riverAt(x);
    const next = x + 1 < N ? riverAt(x + 1) : r;
    for (let y = Math.min(r, next) - 1; y <= Math.max(r, next) + 1; y += 1) water.add(cell(x, y));
  }

  const flatten = (x, y, radius) => {
    for (let j = y - radius; j <= y + 1 + radius; j += 1) {
      for (let i = x - radius; i <= x + 1 + radius; i += 1) {
        if (i >= 0 && j >= 0 && i <= N && j <= N) h[corner(i, j)] = 0;
      }
    }
  };
  for (const id of water) flatten(id % N, Math.floor(id / N), 1);
  for (let i = 0; i <= N; i += 1) {
    for (const [x, y] of [[i, 0], [i, N], [0, i], [N, i]]) h[corner(x, y)] = 0;
  }

  const reach = Math.round(8 * s);
  const lines = [];
  for (let v = -reach; v <= reach; v += 4) lines.push(center + v);
  const top = lines[0];
  const left = lines[0];
  const right = lines[lines.length - 1];
  const south = lines.findLast((v) => v < riverAt(center) - 2);
  const ringRow = top - 2;
  const ringColumn = left - 2;
  for (let y = ringRow - 1; y <= south + 1; y += 1) {
    for (let x = ringColumn - 1; x <= right + 1; x += 1) flatten(x, y, 0);
  }

  for (let round = 0; round < N * 2; round += 1) {
    let changed = false;
    for (let y = 0; y <= N; y += 1) {
      for (let x = 0; x <= N; x += 1) {
        for (const [dx, dy] of DIRECTIONS) {
          const a = x + dx;
          const b = y + dy;
          if (a < 0 || b < 0 || a > N || b > N) continue;
          if (h[corner(x, y)] > h[corner(a, b)] + 1) {
            h[corner(x, y)] = h[corner(a, b)] + 1;
            changed = true;
          }
        }
      }
    }
    for (let y = 0; y < N; y += 1) {
      for (let x = 0; x < N; x += 1) {
        const ids = [corner(x, y), corner(x + 1, y), corner(x + 1, y + 1), corner(x, y + 1)];
        const v = ids.map((id) => h[id]);
        if (v[0] === v[2] && v[1] === v[3] && v[0] !== v[1]) {
          const low = Math.min(v[0], v[1]);
          for (const id of ids) if (h[id] === low) h[id] = low + 1;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const cornersOf = (x, y) => [
    h[corner(x, y)],
    h[corner(x + 1, y)],
    h[corner(x + 1, y + 1)],
    h[corner(x, y + 1)],
  ];
  const levelOf = (x, y) => Math.min(...cornersOf(x, y));
  const isFlat = (x, y) => new Set(cornersOf(x, y)).size === 1;
  const isWater = (x, y) => water.has(cell(x, y));

  const links = new Map();
  const link = (type, x, y, dir) => {
    const id = cell(x, y);
    const entry = links.get(id) ?? { type, mask: 0 };
    if (type === 'highway') entry.type = 'highway';
    entry.mask |= 1 << dir;
    links.set(id, entry);
  };
  const walk = (type, points) => {
    for (let i = 0; i < points.length - 1; i += 1) {
      let [x, y] = points[i];
      const [tx, ty] = points[i + 1];
      while (x !== tx || y !== ty) {
        const sx = Math.sign(tx - x);
        const sy = Math.sign(ty - y);
        const dir = DIRECTIONS.findIndex(([a, b]) => a === sx && b === sy);
        link(type, x, y, dir);
        x += sx;
        y += sy;
        link(type, x, y, (dir + 4) % 8);
      }
    }
  };

  for (const x of lines) walk('road', [[x, top], [x, south]]);
  for (const y of lines.filter((v) => v <= south)) walk('road', [[left, y], [right, y]]);
  walk('road', [[left, top], [left + 4, top + 4]]);

  walk('highway', [[N - 1, ringRow], [ringColumn + 2, ringRow], [ringColumn, ringRow + 2], [ringColumn, N - 1]]);
  walk('road', [[center, south], [center, N - 3]]);
  walk('road', [[left, center], [ringColumn, center]]);

  // 两条上坡路：一条顺坡直上，一条 45° 斜穿直坡，后者就是 ADR-0001 的切坡路基。
  walk('road', [[right, center - 6], [Math.min(N - 2, right + 6), center - 6]]);
  const climbStart = [right, center - 2];
  const climb = Math.round(3 * s);
  walk('road', [climbStart, [climbStart[0] + climb, climbStart[1] + climb]]);

  const ground = [];
  const overlays = [];
  const objects = [];
  const addObject = (key, x, y, level) => objects.push({ key, x, y, level });
  const seedPick = (kind, count, x, y) =>
    `${kind}-${Math.abs(Math.imul(x * 31 + y * 17 + 5, 2654435761) >> 7) % count}`;

  const districtBuilding = (x, y) => {
    const d = Math.hypot(x - center, y - center) / (N / 2);
    const roll = random();
    if (y > riverAt(x)) return roll < 0.55 ? seedPick('farm', 4, x, y) : seedPick('house', 6, x, y);
    if (x > center + 2 * s && y > center + 1 * s) {
      return roll < 0.6 ? seedPick('factory', 4, x, y) : seedPick('warehouse', 2, x, y);
    }
    if (d < 0.2) {
      if (roll < 0.42) return seedPick('office', 9, x, y);
      if (roll < 0.72) return seedPick('shop', 4, x, y);
      return roll < 0.86 ? seedPick('apartment', 8, x, y) : seedPick('park', 2, x, y);
    }
    if (d < 0.42) {
      if (roll < 0.45) return seedPick('apartment', 8, x, y);
      if (roll < 0.68) return seedPick('shop', 4, x, y);
      return roll < 0.8 ? seedPick('park', 2, x, y) : seedPick('house', 6, x, y);
    }
    return roll < 0.82 ? seedPick('house', 6, x, y) : seedPick('apartment', 8, x, y);
  };

  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const level = levelOf(x, y);
      if (isWater(x, y)) {
        ground.push({ key: `w-${(x * 3 + y * 5) % 3}`, x, y, level: 0 });
      } else {
        const sides = [x > 0 && isWater(x - 1, y), x < N - 1 && isWater(x + 1, y), y > 0 && isWater(x, y - 1), y < N - 1 && isWater(x, y + 1)];
        const diag = [
          x > 0 && y > 0 && isWater(x - 1, y - 1),
          x < N - 1 && y > 0 && isWater(x + 1, y - 1),
          x < N - 1 && y < N - 1 && isWater(x + 1, y + 1),
          x > 0 && y < N - 1 && isWater(x - 1, y + 1),
        ];
        if (sides.some(Boolean) || diag.some(Boolean)) {
          ground.push({ key: `b-${bitsString(sides)}-${bitsString(diag)}`, x, y, level: 0 });
        } else {
          const shape = cornersOf(x, y).map((v) => v - level).join('');
          const surface = ['grass0', 'grass1', 'grass2', 'rock'][Math.min(3, level)];
          ground.push({ key: `g-${surface}-${shape}-${(x * 7 + y * 13) % 3}`, x, y, level });
        }
      }
      if (x === N - 1) ground.push({ key: `sk-x-${isWater(x, y) ? 1 : 0}`, x, y, level: 0 });
      if (y === N - 1) ground.push({ key: `sk-z-${isWater(x, y) ? 1 : 0}`, x, y, level: 0 });
    }
  }

  const roadCar = (x, y, mask, level) => {
    const spokes = spokesOf(mask);
    if (spokes.length !== 2 || (spokes[0] + 4) % 8 !== spokes[1]) return;
    if (random() > 0.3) return;
    const dir = random() < 0.5 ? spokes[0] : spokes[1];
    const axis = Math.min(dir, (dir + 4) % 8);
    const [dx, dz] = DIRECTIONS[dir];
    const length = Math.hypot(dx, dz);
    const ox = (-dz / length) * 0.12;
    const oz = (dx / length) * 0.12;
    const kind = random() < 0.12 ? `bus-${(8 - axis) % 8}` : `car-${Math.floor(random() * 4)}-${(8 - axis) % 8}`;
    addObject(kind, x + ox, y + oz, level);
  };

  for (const [id, { type, mask }] of links) {
    const x = id % N;
    const y = Math.floor(id / N);
    const spokes = spokesOf(mask);
    if (isWater(x, y)) {
      if (spokes.length === 2) addObject(`br-${type}-${mask.toString(16)}`, x, y, 0);
      continue;
    }
    const level = levelOf(x, y);
    if (isFlat(x, y)) {
      overlays.push({ key: `r-${type}-${mask.toString(16)}`, x, y, level });
      roadCar(x, y, mask, level);
    } else {
      const shape = cornersOf(x, y).map((v) => v - level).join('');
      overlays.push({ key: `rs-${type}-${shape}-${mask.toString(16)}`, x, y, level });
    }
  }

  const hallCell = cell(center + 2, center - 2);
  const nearRoad = (x, y) => DIRECTIONS.some(([dx, dy]) => links.has(cell(x + dx, y + dy)));
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      if (isWater(x, y) || links.has(cell(x, y))) continue;
      const level = levelOf(x, y);
      const flat = isFlat(x, y);
      const wooded = noise(x / 4 + 9, y / 4 + 3);
      if (cell(x, y) === hallCell) {
        addObject('hall-0', x, y, 0);
      } else if (flat && level === 0 && nearRoad(x, y) && x > 1 && y > 1 && x < N - 2 && y < N - 2) {
        addObject(districtBuilding(x, y), x, y, 0);
      } else if (flat && level === 0 && y > riverAt(x) + 3 && wooded < 0.55) {
        addObject(seedPick('farm', 4, x, y), x, y, 0);
      } else if (wooded > 0.5 || (level > 0 && wooded > 0.3 && !nearRoad(x, y))) {
        const density = 3 + Math.floor(wooded * 6);
        const lift = flat ? level : cornersOf(x, y).reduce((a, b) => a + b, 0) / 4;
        addObject(`forest-${(x + y) % 4}-${density}`, x, y, lift);
      } else if (flat && (x * 5 + y * 3) % 4 === 0) {
        overlays.push({ key: `m-${(x + y) % 3}`, x, y, level });
      }
    }
  }

  for (let x = 2; x < N - 2; x += Math.round(9 * s)) {
    addObject(`boat-${x % 2 === 0 ? 0 : 4}`, x, riverAt(x), 0);
  }
  const dockX = Math.round(center + 6 * s);
  addObject('dock-0', dockX, riverAt(dockX) - 1, 0);

  objects.sort((a, b) => a.x + a.y - (b.x + b.y));
  return { N, ground, overlays, objects, keys: [...ground, ...overlays, ...objects].map((e) => e.key) };
}
