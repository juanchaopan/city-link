import { DIRECTIONS } from './network.js';
import { ZONE } from './parcels.js';
import { viaductRoute } from './viaduct.js';

// 示例城市写死的布局：地形、河流、路网和分区。城市生成的流程在 city.js。

const BLOCKS_SMALL = [5, 4, 6, 5];
const BLOCKS = [5, 4, 6, 5, 4, 6, 5];
const LARGE_REPEAT = 3;

function hash2(seed, x, y) {
  let h = Math.imul(x * 374761393 + y * 668265263 + seed, 1274126177);
  h ^= h >>> 15;
  return (Math.imul(h, 1540483477) >>> 0) / 4294967296;
}

export function valueNoise(seed) {
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const top = hash2(seed, ix, iy) * (1 - fx) + hash2(seed, ix + 1, iy) * fx;
    const bottom = hash2(seed, ix, iy + 1) * (1 - fx) + hash2(seed, ix + 1, iy + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
}

/** 台地：边是直线的矩形土丘。四周是连续的直坡，一格升一层。 */
function mound(x, y, [x0, y0, x1, y1], peak) {
  const margin = Math.min(x - x0, x1 - x, y - y0, y1 - y);
  return Math.max(0, Math.min(peak, margin + 1));
}

export function terrain(N, s, riverAt, protect) {
  const corner = (x, y) => y * (N + 1) + x;
  const h = new Int8Array((N + 1) * (N + 1));
  const mounds = [
    { rect: [26 * s, 6 * s, 36 * s, 20 * s], peak: Math.min(3, 1 + s) },
    { rect: [-3 * s, -3 * s, 5 * s, 4 * s], peak: 3 },
    { rect: [17 * s, -3 * s, 33 * s, 2 * s], peak: 2 },
  ];
  for (let y = 0; y <= N; y += 1) {
    for (let x = 0; x <= N; x += 1) {
      for (const { rect, peak } of mounds) {
        h[corner(x, y)] = Math.max(h[corner(x, y)], mound(x, y, rect, peak));
      }
    }
  }
  const flatten = (x, y, radius) => {
    for (let j = y - radius; j <= y + 1 + radius; j += 1) {
      for (let i = x - radius; i <= x + 1 + radius; i += 1) {
        if (i >= 0 && j >= 0 && i <= N && j <= N) h[corner(i, j)] = 0;
      }
    }
  };
  const water = new Set();
  for (let x = 0; x < N; x += 1) {
    const r = riverAt(x);
    const next = x + 1 < N ? riverAt(x + 1) : r;
    for (let y = Math.min(r, next) - 1; y <= Math.max(r, next) + 1; y += 1) water.add(y * N + x);
  }
  for (const id of water) flatten(id % N, Math.floor(id / N), 1);
  for (let i = 0; i <= N; i += 1) {
    for (const [x, y] of [
      [i, 0],
      [i, N],
      [0, i],
      [N, i],
    ])
      h[corner(x, y)] = 0;
  }
  protect(flatten);

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
  return { h, water, corner };
}

/** 按折线铺路。沿途每格记下通向相邻格的方向。arterial 是 road 的子集，标出其中的双向四车道。 */
export function traceRoads(N) {
  const roads = new Map();
  const link = (kind, x, y, dir) => {
    const id = y * N + x;
    const entry = roads.get(id) ?? { road: 0, highway: 0, arterial: 0 };
    const bit = 1 << dir;
    if (kind === 'highway') entry.highway |= bit;
    else entry.road |= bit;
    if (kind === 'arterial') entry.arterial |= bit;
    roads.set(id, entry);
  };
  const walk = (kind, points) => {
    for (let i = 0; i < points.length - 1; i += 1) {
      let [x, y] = points[i];
      const [tx, ty] = points[i + 1];
      while (x !== tx || y !== ty) {
        const sx = Math.sign(tx - x);
        const sy = Math.sign(ty - y);
        const dir = DIRECTIONS.findIndex(([a, b]) => a === sx && b === sy);
        link(kind, x, y, dir);
        x += sx;
        y += sy;
        link(kind, x, y, (dir + 4) % 8);
      }
    }
  };
  return { roads, walk };
}

/** 街区宽度的序列。比 64 更大的图把序列重复几遍，路网的密度不变，城区跟着变大。 */
function blockSteps(N) {
  if (N <= 32) return BLOCKS_SMALL;
  if (N <= 64) return BLOCKS;
  return Array.from({ length: LARGE_REPEAT }, () => BLOCKS).flat();
}

/**
 * 街区宽度 3、4、5 交替。行线取列线的镜像，斜大道就正好穿过每个街区的两个角，切出整块的大三角。
 * 大地图上高速离城区留出丁字立交的进深，南北向的四车道主干伸到立交，路网从这里上高速；
 * 一条高架快速路从高速南下穿过城区。小地图放不下这两样，高速只从城边经过。
 */
export function buildRoads(N, s, center, riverAt) {
  const { roads, walk } = traceRoads(N);

  const steps = blockSteps(N);
  const width = steps.reduce((a, b) => a + b, 0);
  const left = center - Math.round(width / 2);
  const columns = [left];
  for (const step of steps) columns.push(columns[columns.length - 1] + step);
  const top = Math.max(4, center - Math.round(width / 2) - (N > 32 ? 2 : 0));
  const rows = columns.map((x) => top + (columns[columns.length - 1] - x));
  rows.reverse();
  const usableRows = rows.filter((y) => y < riverAt(center) - 2);
  const south = usableRows[usableRows.length - 1];
  const right = columns[columns.length - 1];
  const bridgeColumn = columns.reduce(
    (best, x) => (Math.abs(x - center) < Math.abs(best - center) ? x : best),
    columns[0],
  );
  const mainRow = usableRows[Math.floor(usableRows.length / 2)];
  const linked = N > 32;

  for (const x of columns)
    if (x !== bridgeColumn)
      walk('road', [
        [x, top],
        [x, south],
      ]);
  for (const y of usableRows)
    if (y !== mainRow)
      walk('road', [
        [left, y],
        [right, y],
      ]);
  walk('arterial', [
    [bridgeColumn, linked ? top - 1 : top],
    [bridgeColumn, south],
  ]);
  walk('arterial', [
    [left, mainRow],
    [right, mainRow],
  ]);

  const mirrored = columns.map((x) => top + (right - x));
  const start = columns.findIndex((_, i) => mirrored[i] <= south);
  walk('road', [
    [columns[start], mirrored[start]],
    [right, mirrored[columns.length - 1]],
  ]);

  // 第二条斜路不过街区的角，切出梯形和五边形的街区，地块划分要靠切分才能解决。
  const avenueStart = columns[1];
  const avenueLength = Math.min(right - avenueStart, south - top);
  walk('road', [
    [avenueStart, top],
    [avenueStart + avenueLength, top + avenueLength],
  ]);

  const ringRow = linked ? top - 5 : top - 2;
  const ringColumn = left - 2;
  walk('highway', [
    [N - 1, ringRow],
    [ringColumn + 2, ringRow],
    [ringColumn, ringRow + 2],
    [ringColumn, N - 1],
  ]);
  walk('road', [
    [bridgeColumn, south],
    [bridgeColumn, N - 1],
  ]);

  // 上台地的路：沿 (+1, -1) 方向斜穿朝南的直坡。这个方向在屏幕上接近水平，地形顺着路面抬起，路贴在地上。
  // 斜路最多爬到直通路下面一行，再用一小段直路接上去：爬过头三条路会在坡上夹出小三角，
  // 正好爬到那一行又和直通路成一个回头的锐角。
  const directRow = usableRows[Math.max(0, usableRows.length - 3)];
  const climbFrom = [27 * s, south];
  const rise = Math.min(3 * s, south - directRow - 1);
  const climbTo = [climbFrom[0] + rise, south - rise];
  walk('road', [[right, south], climbFrom, climbTo]);
  walk('road', [
    [right, directRow],
    [climbTo[0], directRow],
  ]);
  walk('road', [climbTo, [climbTo[0], directRow]]);
  const gates = [
    { x: N - 1, y: ringRow, kind: 'highway', inward: 4, axis: 'x' },
    { x: ringColumn, y: N - 1, kind: 'highway', inward: 6, axis: 'z' },
    { x: bridgeColumn, y: N - 1, kind: 'road', inward: 6, axis: 'z' },
  ];
  const interchange = linked ? { name: 'tee', cx: bridgeColumn, cy: ringRow } : null;
  const viaduct = linked ? viaductRoute(columns, usableRows, ringRow) : null;
  if (viaduct) for (const stub of viaduct.stubs) walk('arterial', stub);
  return {
    roads,
    columns,
    rows: usableRows,
    top,
    left,
    right,
    south,
    ringRow,
    ringColumn,
    climbFrom,
    climbTo,
    gates,
    interchange,
    viaduct,
  };
}

/** 公共用地的街区。spread 时分散在城市各处，concentrated 时全挤在一个角上，用来对比盲区。 */
function publicBlocks(plan, layout, avenueLine) {
  const { columns, rows } = plan;
  const blocks = [];
  for (let i = 0; i < columns.length - 1; i += 1) {
    for (let j = 0; j < rows.length - 1; j += 1) {
      const x0 = columns[i] + 1;
      const x1 = columns[i + 1] - 1;
      const y0 = rows[j] + 1;
      const y1 = rows[j + 1] - 1;
      const distance = Math.abs((x0 + x1) / 2 + (y0 + y1) / 2 - avenueLine) / Math.SQRT2;
      if (distance > Math.max(x1 - x0, y1 - y0) * 0.9 + 1) blocks.push({ x0, x1, y0, y1, i, j });
    }
  }
  if (layout === 'concentrated') return blocks.slice(0, 2);
  return blocks.filter((_, index) => index % 3 === 0);
}

export function makeZones(N, s, center, riverAt, plan, isUsable, publicLayout) {
  const zones = new Uint8Array(N * N);
  const density = new Uint8Array(N * N);
  const noise = valueNoise(21);
  const { left, right, top, south, ringColumn } = plan;
  const avenueLine = left + south;
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const id = y * N + x;
      if (!isUsable(x, y)) continue;
      const d = Math.hypot(x - center, y - center) / (N / 2);
      const avenue = Math.abs(x + y - avenueLine) / Math.SQRT2;
      const inCity = x >= ringColumn - 1 && x <= right + 1 && y >= top - 1 && y <= south + 2;
      if (y > riverAt(x) + 1) {
        zones[id] = ZONE.farm;
        density[id] = 1;
      } else if (inCity) {
        if (x > center + 3 * s && y > center + 1 * s && avenue >= 4 * s) {
          zones[id] = ZONE.industrial;
          density[id] = d < 0.42 ? 2 : 3;
        } else if (avenue < 4 * s) {
          zones[id] = ZONE.commercial;
          density[id] = d < 0.2 ? 3 : d < 0.4 ? 2 : 1;
        } else {
          zones[id] = noise(x / 5, y / 5) < 0.28 ? ZONE.commercial : ZONE.residential;
          density[id] = d < 0.3 ? 3 : d < 0.5 ? 2 : 1;
        }
      } else if (x > right + 1 && y < plan.climbTo[1]) {
        zones[id] = ZONE.residential;
        density[id] = 1;
      }
    }
  }
  for (const { x0, x1, y0, y1 } of publicBlocks(plan, publicLayout, avenueLine)) {
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (isUsable(x, y)) {
          zones[y * N + x] = ZONE.public;
          density[y * N + x] = 1;
        }
      }
    }
  }
  return { zones, density };
}
