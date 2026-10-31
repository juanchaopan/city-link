import { chooseLooks, repeatedNeighbors } from './appearance.js';
import { COMBOS, modulesOf } from './combos.js';
import { DIRECTIONS } from './network.js';
import { metroPlan } from './metro.js';
import { generateParcels, ZONE } from './parcels.js';
import { roadSprites } from './roadsprites.js';
import { coverageOf } from './services.js';
import { computeTraffic } from './traffic.js';

// 写死的示例城市：高度、河流、路网和分区都是确定的。地块和建筑规格全部由地块生成器长出来。
// 这里只输出规格，不知道风格。规格到素材的映射在风格包里。

function hash2(seed, x, y) {
  let h = Math.imul(x * 374761393 + y * 668265263 + seed, 1274126177);
  h ^= h >>> 15;
  return (Math.imul(h, 1540483477) >>> 0) / 4294967296;
}

function valueNoise(seed) {
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

/** 台地：边是直线的矩形土丘。四周是连续的直坡，一格升一层，路穿过时切坡路基才连成一整段。 */
function mound(x, y, [x0, y0, x1, y1], peak) {
  const margin = Math.min(x - x0, x1 - x, y - y0, y1 - y);
  return Math.max(0, Math.min(peak, margin + 1));
}

function terrain(N, s, riverAt, protect) {
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
    for (const [x, y] of [[i, 0], [i, N], [0, i], [N, i]]) h[corner(x, y)] = 0;
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

/** 街区宽度 3、4、5 交替。行线取列线的镜像，斜大道就正好穿过每个街区的两个角，切出整块的大三角。 */
export function buildRoads(N, s, center, riverAt) {
  const { roads, walk } = traceRoads(N);

  const steps = N > 32 ? [5, 4, 6, 5, 4, 6, 5] : [5, 4, 6, 5];
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
  const bridgeColumn = columns.reduce((best, x) => (Math.abs(x - center) < Math.abs(best - center) ? x : best), columns[0]);
  const mainRow = usableRows[Math.floor(usableRows.length / 2)];

  for (const x of columns) if (x !== bridgeColumn) walk('road', [[x, top], [x, south]]);
  for (const y of usableRows) if (y !== mainRow) walk('road', [[left, y], [right, y]]);
  walk('arterial', [[bridgeColumn, top], [bridgeColumn, south]]);
  walk('arterial', [[left, mainRow], [right, mainRow]]);

  const mirrored = columns.map((x) => top + (right - x));
  const start = columns.findIndex((_, i) => mirrored[i] <= south);
  walk('road', [[columns[start], mirrored[start]], [right, mirrored[columns.length - 1]]]);

  // 第二条斜路不过街区的角，切出梯形和五边形的街区，地块划分要靠切分才能解决。
  const avenueStart = columns[1];
  const avenueLength = Math.min(right - avenueStart, south - top);
  walk('road', [[avenueStart, top], [avenueStart + avenueLength, top + avenueLength]]);

  const ringRow = top - 2;
  const ringColumn = left - 2;
  walk('highway', [[N - 1, ringRow], [ringColumn + 2, ringRow], [ringColumn, ringRow + 2], [ringColumn, N - 1]]);
  walk('road', [[bridgeColumn, south], [bridgeColumn, N - 1]]);

  // 切坡路基：路沿 (+1, -1) 方向斜穿台地朝南的直坡。这个方向在屏幕上接近水平，
  // 上坡一侧的挡墙正对相机，下坡一侧的填方也看得见，并且一路走到台地顶上。
  const climbFrom = [27 * s, south];
  const climbTo = [climbFrom[0] + 3 * s, south - 3 * s];
  walk('road', [[right, south], climbFrom, climbTo]);
  const directRow = usableRows[Math.max(0, usableRows.length - 3)];
  walk('road', [[right, directRow], [climbTo[0], directRow]]);
  walk('road', [climbTo, [climbTo[0], directRow]]);
  const gates = [
    { x: N - 1, y: ringRow, kind: 'highway', inward: 4, axis: 'x' },
    { x: ringColumn, y: N - 1, kind: 'highway', inward: 6, axis: 'z' },
    { x: bridgeColumn, y: N - 1, kind: 'road', inward: 6, axis: 'z' },
  ];
  return { roads, columns, rows: usableRows, top, left, right, south, ringRow, ringColumn, climbFrom, climbTo, gates };
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

function bits(list) {
  return list.map((v) => (v ? '1' : '0')).join('');
}

const ZONE_LETTER = { [ZONE.residential]: 'r', [ZONE.commercial]: 'c', [ZONE.industrial]: 'i' };

/** 物业规格的名字。它决定占地和玩法，换风格时这个名字不变。 */
export function specKey(parcel) {
  const letter = ZONE_LETTER[parcel.zone];
  const size = `${String(parcel.spanU)}x${String(parcel.spanV)}`;
  if (parcel.shape === 'bigTriangle') return `Q-${letter}${String(parcel.level)}-${String(parcel.spanU)}-${parcel.orient}-${String(parcel.variant)}`;
  if (parcel.shape === 'farmhouse') return `farmhouse-${String(parcel.variant)}`;
  if (parcel.shape === 'triangle') return `t-${parcel.use}-${parcel.orient}-${String(parcel.variant)}`;
  if (parcel.shape === 'green') return parcel.use === 'lawn' ? `P-park-1x1-${String(parcel.variant)}` : `t-${parcel.use}-${parcel.orient}-${String(parcel.variant)}`;
  if (parcel.shape === 'service') return `S-${parcel.use}-${size}`;
  if (parcel.shape === 'public') return `P-${parcel.use}-${size}-${String(parcel.variant)}`;
  return `B-${letter}${String(parcel.level)}-${size}-${parcel.orient}-${String(parcel.variant)}`;
}

/** 占地规格，节日装饰层按它分组，和分区、等级、风格都无关。 */
export function footprintKey(parcel) {
  if (parcel.shape === 'bigTriangle') return `Q${String(parcel.spanU)}-${parcel.orient}`;
  if (parcel.shape === 'diagonal') return `D${String(parcel.spanU)}x${String(parcel.spanV)}-${parcel.orient}`;
  if (parcel.shape === 'triangle' || parcel.shape === 'green') return null;
  return `R${String(parcel.spanU)}x${String(parcel.spanV)}`;
}

/** 节日只装饰关键位置：公共服务、广场和市中心的高层商业，其余地块保持原样。 */
function isFestive(parcel) {
  if (parcel.shape === 'service' || parcel.use === 'plaza') return true;
  return parcel.zone === ZONE.commercial && parcel.level === 3 && parcel.shape !== 'triangle';
}

/** 走模块拼装的物业：2×2 的直角地块和直角边 3 格的大三角地块，中高密度的住宅和商业。 */
function modularSize(parcel) {
  if (parcel.zone !== ZONE.residential && parcel.zone !== ZONE.commercial) return null;
  if (parcel.level < 2) return null;
  if (parcel.shape === 'rect' && parcel.spanU === 2 && parcel.spanV === 2) return '2x2';
  if (parcel.shape === 'bigTriangle' && parcel.spanU === 3) return 'Q3';
  return null;
}

export function generateCity(N, seed = 11, publicLayout = 'spread', linked = false) {
  const s = N / 32;
  const center = Math.round(N / 2);
  const riverAt = (x) => Math.round(center + 9 * s + 2 * s * Math.sin((x / N) * Math.PI * 2 + 0.7));
  const plan = buildRoads(N, s, center, riverAt);
  const { roads, right, south, ringRow, ringColumn } = plan;
  const { h, water, corner } = terrain(N, s, riverAt, (flatten) => {
    for (let y = ringRow - 1; y <= south + 1; y += 1) {
      for (let x = ringColumn - 1; x <= right + 1; x += 1) flatten(x, y, 0);
    }
  });

  const cornersOf = (x, y) => [h[corner(x, y)], h[corner(x + 1, y)], h[corner(x + 1, y + 1)], h[corner(x, y + 1)]];
  const levelOf = (x, y) => Math.min(...cornersOf(x, y));
  const isFlat = (x, y) => new Set(cornersOf(x, y)).size === 1;
  const isWater = (x, y) => x >= 0 && y >= 0 && x < N && y < N && water.has(y * N + x);

  const slopes = new Set();
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) if (!isFlat(x, y)) slopes.add(y * N + x);
  }
  const usable = (x, y) => x > 0 && y > 0 && x < N - 1 && y < N - 1 && !water.has(y * N + x) && isFlat(x, y);
  const { zones, density } = makeZones(N, s, center, riverAt, plan, usable, publicLayout);
  const result = generateParcels({ N, roads, water, slopes, zones, density, seed });
  const traffic = computeTraffic(result.parcels, roads, N);
  const coverage = coverageOf(result.parcels, result.services, roads, N);

  // 外观在规格之外单独选，同规格的相邻物业不重复；外观不影响面积、容量和结算。
  const buildings = result.parcels.filter((parcel) => parcel.shape === 'rect' || parcel.shape === 'diagonal' || parcel.shape === 'bigTriangle');
  const lookBefore = repeatedNeighbors(buildings, (parcel) => parcel.variant);
  const looks = chooseLooks(buildings, seed, (parcel) => (modularSize(parcel) ? COMBOS.length : 2));
  for (const parcel of buildings) if (!modularSize(parcel)) parcel.variant = looks.get(parcel.id);
  const lookAfter = repeatedNeighbors(buildings, (parcel) => looks.get(parcel.id));

  const ground = [];
  const overlays = [];
  const objects = [];

  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const level = levelOf(x, y);
      if (isWater(x, y)) {
        ground.push({ key: `w-${String((x * 3 + y * 5) % 3)}`, x, y, level: 0 });
      } else {
        const sides = [isWater(x - 1, y), isWater(x + 1, y), isWater(x, y - 1), isWater(x, y + 1)];
        const diag = [isWater(x - 1, y - 1), isWater(x + 1, y - 1), isWater(x + 1, y + 1), isWater(x - 1, y + 1)];
        if (sides.some(Boolean) || diag.some(Boolean)) {
          ground.push({ key: `b-${bits(sides)}-${bits(diag)}`, x, y, level: 0 });
        } else {
          const shape = cornersOf(x, y).map((v) => v - level).join('');
          ground.push({ key: `g-${String(Math.min(3, level))}-${shape}-${String((x * 7 + y * 13) % 3)}`, x, y, level });
        }
      }
      if (x === N - 1) ground.push({ key: `sk-x-${isWater(x, y) ? '1' : '0'}`, x, y, level: 0 });
      if (y === N - 1) ground.push({ key: `sk-z-${isWater(x, y) ? '1' : '0'}`, x, y, level: 0 });
    }
  }

  const cellSquare = (x, y) => [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
  const addObject = (key, px, py, level, footprint, extra = {}) => objects.push({ key, px, py, level, footprint, ...extra });

  const sprites = roadSprites({ N, roads, cornersOf, isFlat, levelOf, isWater, gates: plan.gates, linked });
  for (const { key, x, y } of sprites.bridges) addObject(key, x + 0.5, y + 0.5, 0, cellSquare(x, y));
  for (const { key, x, y, level } of sprites.planned) addObject(key, x + 0.5, y + 0.5, level, cellSquare(x, y));

  const crops = valueNoise(41);
  for (const parcel of result.parcels) {
    const level = levelOf(Math.floor(parcel.px), Math.floor(parcel.py));
    if (parcel.shape === 'field') {
      for (const id of parcel.cells) {
        const x = id % N;
        const y = Math.floor(id / N);
        const crop = Math.floor(crops(x / 6, y / 6) * 5) % 4;
        const axis = crops(x / 9 + 7, y / 9) < 0.5 ? 'x' : 'z';
        overlays.push({ key: `f-${String(crop)}-${axis}`, x, y, level: levelOf(x, y) });
      }
    } else {
      const size = modularSize(parcel);
      const modules = size ? modulesOf(COMBOS[looks.get(parcel.id)], size, Number(parcel.orient) || 0) : null;
      addObject(specKey(parcel), parcel.px, parcel.py, level, parcel.polygon, { footprintKey: footprintKey(parcel), parcel: parcel.id, festive: isFestive(parcel), modules });
    }
  }

  const noise = valueNoise(11);
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const id = y * N + x;
      if (water.has(id) || roads.has(id)) continue;
      if ([0, 1, 2, 3].some((q) => result.atomOwner[id * 4 + q] >= 0)) continue;
      const level = levelOf(x, y);
      const flat = isFlat(x, y);
      const nearRoad = DIRECTIONS.some(([dx, dy]) => roads.has((y + dy) * N + x + dx)) || [-2, 2].some((d) => roads.has(y * N + x + d) || roads.has((y + d) * N + x));
      const wooded = noise(x / 4 + 9, y / 4 + 3);
      if ((wooded > 0.5 || (level > 0 && wooded > 0.32)) && !nearRoad) {
        const lift = flat ? level : cornersOf(x, y).reduce((a, b) => a + b, 0) / 4;
        addObject(`forest-${String((x + y) % 4)}-${String(3 + Math.floor(wooded * 6))}`, x + 0.5, y + 0.5, lift, cellSquare(x, y));
      } else if (flat && !nearRoad && (x * 5 + y * 3) % 4 === 0) {
        overlays.push({ key: `m-${String((x + y) % 3)}`, x, y, level });
      }
    }
  }

  for (let x = 2; x < N - 2; x += Math.round(9 * s)) {
    const r = riverAt(x);
    if (!roads.has(r * N + x)) addObject(`boat-${x % 2 === 0 ? '0' : '4'}`, x + 0.5, r + 0.5, 0, cellSquare(x, r));
  }
  const dockX = Math.round(center + 6 * s) + 1;
  addObject('dock-0', dockX + 0.5, riverAt(dockX) - 0.5, 0, cellSquare(dockX, riverAt(dockX) - 1));

  return {
    N,
    ground,
    overlays,
    objects,
    walks: sprites.walks,
    curbs: sprites.curbs,
    decks: sprites.decks,
    neighbors: sprites.neighbors,
    roadCells: sprites.cells,
    grades: sprites.grades,
    parcels: result,
    traffic,
    coverage,
    metro: metroPlan(plan),
    roads,
    water,
    slopes,
    zones,
    density,
    plan,
    levelOf,
    cornersOf,
    isFlat,
    isWater,
    looks: { before: lookBefore, after: lookAfter, modular: objects.filter((object) => object.modules).length },
  };
}

export function keysOf(city) {
  const keys = [...city.ground, ...city.overlays, ...city.walks, ...city.curbs, ...city.decks, ...city.neighbors, ...city.objects].map((entry) => entry.key);
  for (const object of city.objects) for (const part of object.modules ?? []) keys.push(part.key);
  return keys;
}
