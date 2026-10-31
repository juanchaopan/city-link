import { polygonDistance, worldPolylines } from './network.js';
import { placeServices } from './services.js';
import { RATE, ZONE } from './zones.js';

// 地块生成器。输入路网和分区，输出地块和建筑规格，同样的输入一定得到同样的结果。
// 纯函数，不依赖图形库、时间和全局随机数，以后放进 libs/sim 给两端共用。它只认规格，不认风格。
//
// 土地的最小单位是"原子"：每格被两条对角线分成 4 个小三角，每个面积正好 0.25。
// 所有地块都是原子的并集，所以面积永远是 0.25 的整数倍，没有舍入误差。
// 容量 = 原子数 × 该分区该等级的费率。任何形状都没有办法用更少的面积拿到同样的容量。
//
// 一个地块就是一个物业：一个出入口、一份容量。楼、停车场和绿化都画在同一个物业里，不增加容量。
// 形状完整优先：先让三角形空地整块成为一个物业，再排斜向带和直角地块，最后才用小三角收边。

export { RATE, ZONE };

const AXIS_SPECS = [
  [3, 3],
  [2, 3],
  [3, 2],
  [2, 2],
  [1, 3],
  [3, 1],
  [1, 2],
  [2, 1],
  [1, 1],
];

const PUBLIC_SPECS = [
  [3, 3],
  [2, 3],
  [3, 2],
  [2, 2],
  [2, 1],
  [1, 2],
  [1, 1],
];

const TRIANGLE_LEGS = [4, 3, 2];
const LOT_INSET = 0.05;
const CLEARANCE = 0.02;

function mix(seed, a, b) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ a, 0xc2b2ae35);
  h = Math.imul(h ^ b, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x165667b1);
  return (h ^ (h >>> 13)) >>> 0;
}

export function atomPolygon(id, N) {
  const q = id & 3;
  const cell = id >> 2;
  const x = cell % N;
  const y = Math.floor(cell / N);
  const center = [x + 0.5, y + 0.5];
  const corners = [
    [x, y],
    [x + 1, y],
    [x + 1, y + 1],
    [x, y + 1],
  ];
  return [corners[q], corners[(q + 1) % 4], center];
}

function atomCentroid(id, N) {
  const [a, b, c] = atomPolygon(id, N);
  return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
}

/** 不被路压到、不在水里和坡上的原子才能建设。 */
function freeAtoms({ N, roads, water, slopes }) {
  const lines = worldPolylines(roads, N);
  const byCell = new Map();
  for (const line of lines) {
    if (!byCell.has(line.cell)) byCell.set(line.cell, []);
    byCell.get(line.cell).push(line);
  }
  const free = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const cell = y * N + x;
      if (water.has(cell) || slopes.has(cell) || roads.has(cell)) continue;
      const nearby = [];
      for (let j = y - 2; j <= y + 2; j += 1) {
        for (let i = x - 2; i <= x + 2; i += 1) {
          if (i >= 0 && j >= 0 && i < N && j < N) nearby.push(...(byCell.get(j * N + i) ?? []));
        }
      }
      for (let q = 0; q < 4; q += 1) {
        const id = cell * 4 + q;
        const polygon = atomPolygon(id, N);
        if (
          nearby.every((line) => polygonDistance(polygon, line.points) >= line.half + CLEARANCE)
        ) {
          free[id] = 1;
        }
      }
    }
  }
  return free;
}

function atomsInRect(N, u0, u1, v0, v1) {
  const atoms = [];
  const minX = Math.floor((u0 + v0) / 2) - 2;
  const maxX = Math.ceil((u1 + v1) / 2) + 2;
  const minY = Math.floor((u0 - v1) / 2) - 2;
  const maxY = Math.ceil((u1 - v0) / 2) + 2;
  for (let y = Math.max(0, minY); y <= Math.min(N - 1, maxY); y += 1) {
    for (let x = Math.max(0, minX); x <= Math.min(N - 1, maxX); x += 1) {
      for (let q = 0; q < 4; q += 1) {
        const id = (y * N + x) * 4 + q;
        const [cx, cy] = atomCentroid(id, N);
        const u = cx + cy;
        const v = cx - cy;
        if (u > u0 && u < u1 && v > v0 && v < v1) atoms.push(id);
      }
    }
  }
  return atoms;
}

const QUADRANTS = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

/** 直角在 (x, y) 的等腰直角三角形，两条腰沿格线，斜边沿 45°。返回它包含的原子。 */
function triangleAtoms(N, x, y, q, legs) {
  const [sx, sy] = QUADRANTS[q];
  const atoms = [];
  for (let j = 0; j < legs; j += 1) {
    for (let i = 0; i < legs - j; i += 1) {
      const cx = sx > 0 ? x + i : x - 1 - i;
      const cy = sy > 0 ? y + j : y - 1 - j;
      if (cx < 0 || cy < 0 || cx >= N || cy >= N) return null;
      const base = (cy * N + cx) * 4;
      const whole = i + j < legs - 1;
      for (let a = 0; a < 4; a += 1) {
        const [ax, ay] = atomCentroid(base + a, N);
        const distance = (ax - x) * sx + (ay - y) * sy;
        if (whole || distance < legs) atoms.push(base + a);
      }
    }
  }
  return atoms;
}

/** 三条边外侧的原子有多少还空着。空地真的是三角形时，外侧几乎都是路或别的东西。 */
function outsideOpenRatio(N, x, y, q, legs, isOpen) {
  const [sx, sy] = QUADRANTS[q];
  const samples = [];
  for (let t = 0; t < legs * 2; t += 1) {
    const f = (t + 0.5) / 2;
    samples.push([x + sx * f, y - sy * 0.3]);
    samples.push([x - sx * 0.3, y + sy * f]);
    samples.push([x + sx * (legs - f + 0.3), y + sy * (f + 0.3)]);
  }
  let open = 0;
  for (const [px, py] of samples) {
    const cx = Math.floor(px);
    const cy = Math.floor(py);
    if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
    const fx = px - cx - 0.5;
    const fy = py - cy - 0.5;
    const a = Math.abs(fx) > Math.abs(fy) ? (fx > 0 ? 1 : 3) : fy > 0 ? 2 : 0;
    if (isOpen((cy * N + cx) * 4 + a)) open += 1;
  }
  return open / samples.length;
}

/** 一块地里占多数的分区。分区线穿过时，整块归多数分区，不为了分区把地切碎。 */
function majorityZone(atoms, zoneAt) {
  const counts = new Map();
  for (const atom of atoms) {
    const zone = zoneAt(atom);
    counts.set(zone, (counts.get(zone) ?? 0) + 1);
  }
  let best = ZONE.none;
  let bestCount = 0;
  for (const zone of [...counts.keys()].sort((a, b) => a - b)) {
    if (counts.get(zone) > bestCount) {
      best = zone;
      bestCount = counts.get(zone);
    }
  }
  return best;
}

function triangleLands(N, isOpen, zoneAt) {
  const lands = [];
  const taken = new Set();
  for (const legs of TRIANGLE_LEGS) {
    for (let y = 0; y <= N; y += 1) {
      for (let x = 0; x <= N; x += 1) {
        for (let q = 0; q < 4; q += 1) {
          const atoms = triangleAtoms(N, x, y, q, legs);
          if (!atoms || atoms.length !== legs * legs * 2) continue;
          if (!atoms.every(isOpen) || atoms.some((atom) => taken.has(atom))) continue;
          if (outsideOpenRatio(N, x, y, q, legs, isOpen) > 0.3) continue;
          const zone = majorityZone(atoms, zoneAt);
          if (zone === ZONE.none || zone === ZONE.farm || zone === ZONE.public) continue;
          for (const atom of atoms) taken.add(atom);
          lands.push({ x, y, q, legs, atoms, zone });
        }
      }
    }
  }
  return lands;
}

function trianglePolygon(x, y, q, legs) {
  const [sx, sy] = QUADRANTS[q];
  const points = [
    [x, y],
    [x + sx * legs, y],
    [x, y + sy * legs],
  ];
  const hypotenuse = legs * Math.SQRT2;
  const perimeter = legs * 2 + hypotenuse;
  const incenter = [
    (points[0][0] * hypotenuse + points[1][0] * legs + points[2][0] * legs) / perimeter,
    (points[0][1] * hypotenuse + points[1][1] * legs + points[2][1] * legs) / perimeter,
  ];
  const inradius = (legs * legs) / perimeter;
  const scale = (inradius - LOT_INSET) / inradius;
  return points.map(([px, py]) => [
    incenter[0] + (px - incenter[0]) * scale,
    incenter[1] + (py - incenter[1]) * scale,
  ]);
}

/** 斜路所在的直线：沿 u 走的路 v 不变，沿 v 走的路 u 不变。 */
function diagonalRuns(roads, N) {
  const runs = new Map();
  const add = (axis, line, from, to) => {
    const key = `${axis}${String(line)}`;
    const entry = runs.get(key) ?? { axis, line, spans: [] };
    entry.spans.push([from, to]);
    runs.set(key, entry);
  };
  for (const id of [...roads.keys()].sort((a, b) => a - b)) {
    const mask = roads.get(id).road | roads.get(id).highway;
    const x = id % N;
    const y = Math.floor(id / N);
    if (mask & (1 << 1)) add('u', x - y, x + y + 1, x + y + 3);
    if (mask & (1 << 3)) add('v', x + y + 1, x - y - 2, x - y);
  }
  const result = [];
  for (const key of [...runs.keys()].sort()) {
    const { axis, line, spans } = runs.get(key);
    spans.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const span of spans) {
      const last = merged[merged.length - 1];
      if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
      else merged.push([...span]);
    }
    for (const [from, to] of merged) result.push({ axis, line, from, to });
  }
  return result;
}

function rectPolygon(x, y, w, h, inset) {
  return [
    [x + inset, y + inset],
    [x + w - inset, y + inset],
    [x + w - inset, y + h - inset],
    [x + inset, y + h - inset],
  ];
}

function uvPoint(u, v) {
  return [(u + v) / 2, (u - v) / 2];
}

function uvPolygon(u0, u1, v0, v1, inset) {
  const d = inset * Math.SQRT2;
  return [
    uvPoint(u0 + d, v0 + d),
    uvPoint(u1 - d, v0 + d),
    uvPoint(u1 - d, v1 - d),
    uvPoint(u0 + d, v1 - d),
  ];
}

function nearestRoad(roads, N, points) {
  let best = -1;
  let bestDistance = Infinity;
  for (const id of [...roads.keys()].sort((a, b) => a - b)) {
    const x = id % N;
    const y = Math.floor(id / N);
    for (const [px, py] of points) {
      const distance = Math.hypot(x + 0.5 - px, y + 0.5 - py);
      if (distance < bestDistance - 1e-9) {
        best = id;
        bestDistance = distance;
      }
    }
  }
  return best;
}

function capacityOf(atoms, zone, level) {
  return atoms * RATE[zone][level];
}

function cellAtoms(x, y, w, h, N) {
  const atoms = [];
  for (let j = y; j < y + h; j += 1) {
    for (let i = x; i < x + w; i += 1) {
      const base = (j * N + i) * 4;
      atoms.push(base, base + 1, base + 2, base + 3);
    }
  }
  return atoms;
}

function placeTriangles({ N, seed }, tools) {
  const { open, zoneAt, levelAt, claim } = tools;
  for (const land of triangleLands(N, open, zoneAt)) {
    const { x, y, q, legs, atoms, zone } = land;
    const [sx, sy] = QUADRANTS[q];
    const level = levelAt(atoms[Math.floor(atoms.length / 2)]);
    claim(atoms, {
      shape: 'bigTriangle',
      orient: String(q),
      spanU: legs,
      spanV: legs,
      zone,
      level,
      variant: mix(seed, x, y) % 2,
      px: x + (sx * legs) / 2,
      py: y + (sy * legs) / 2,
      polygon: trianglePolygon(x, y, q, legs),
      capacity: capacityOf(atoms.length, zone, level),
    });
  }
}

function placeDiagonalBands({ N, roads, seed }, tools) {
  const { open, zoneAt, levelAt, claim } = tools;
  for (const { axis, line, from, to } of diagonalRuns(roads, N)) {
    for (const side of [1, -1]) {
      let t = from;
      while (t < to) {
        const roll = mix(seed, line * 7 + t, side + 3);
        const lengths = [
          [2, 3, 1],
          [3, 2, 1],
          [1, 2, 3],
        ][roll % 3];
        const depths = [
          [2, 3, 1],
          [3, 2, 1],
          [2, 1, 3],
        ][(roll >>> 8) % 3];
        let placed = false;
        for (const depth of depths) {
          for (const length of lengths) {
            if (t + length > to) continue;
            const near = line + side;
            const far = line + side * (1 + depth);
            const [c0, c1] = side > 0 ? [near, far] : [far, near];
            const [u0, u1, v0, v1] =
              axis === 'u' ? [t, t + length, c0, c1] : [c0, c1, t, t + length];
            const atoms = atomsInRect(N, u0, u1, v0, v1);
            if (atoms.length !== length * depth * 2 || !atoms.every(open)) continue;
            const zone = zoneAt(atoms[0]);
            if (zone === ZONE.none || zone === ZONE.farm || zone === ZONE.public) continue;
            if (!atoms.every((a) => zoneAt(a) === zone)) continue;
            const level = levelAt(atoms[0]);
            const center = uvPoint((u0 + u1) / 2, (v0 + v1) / 2);
            claim(atoms, {
              shape: 'diagonal',
              orient: axis,
              spanU: u1 - u0,
              spanV: v1 - v0,
              zone,
              level,
              variant: (roll >>> 16) % 2,
              px: center[0],
              py: center[1],
              polygon: uvPolygon(u0, u1, v0, v1, LOT_INSET),
              capacity: capacityOf(atoms.length, zone, level),
            });
            t += length;
            placed = true;
            break;
          }
          if (placed) break;
        }
        if (!placed) t += 1;
      }
    }
  }
}

function placeRectangles({ N, zones, density, seed }, tools) {
  const { cellOpen, nearRoad, claim } = tools;
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      if (!cellOpen(x, y)) continue;
      const zone = zones[y * N + x];
      if (zone === ZONE.none || zone === ZONE.farm || zone === ZONE.public) continue;
      const roll = mix(seed, x, y);
      // 形状完整优先：大规格排在前面，放不下才退到小规格。
      for (let k = 0; k < AXIS_SPECS.length; k += 1) {
        const [w, h] = AXIS_SPECS[k];
        if (k < 4 && ((roll >>> k) & 3) === 0) continue;
        let fits = nearRoad(x, y, w, h);
        for (let j = y; fits && j < y + h; j += 1) {
          for (let i = x; fits && i < x + w; i += 1) {
            fits = cellOpen(i, j) && zones[j * N + i] === zone;
          }
        }
        if (!fits) continue;
        const atoms = cellAtoms(x, y, w, h, N);
        const level = density[y * N + x] || 1;
        claim(atoms, {
          shape: 'rect',
          orient: 'a',
          spanU: w,
          spanV: h,
          zone,
          level,
          variant: (roll >>> 12) % 2,
          px: x + w / 2,
          py: y + h / 2,
          polygon: rectPolygon(x, y, w, h, LOT_INSET),
          capacity: capacityOf(atoms.length, zone, level),
        });
        break;
      }
    }
  }
}

function placeFarmland({ N, zones, seed }, tools) {
  const { cellOpen, claim } = tools;
  const fieldCells = new Set();
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      if (cellOpen(x, y) && zones[y * N + x] === ZONE.farm) fieldCells.add(y * N + x);
    }
  }
  const farmhouses = [...fieldCells].filter((cell) => {
    const x = cell % N;
    const y = Math.floor(cell / N);
    return x % 7 === 3 && y % 6 === 2 && mix(seed, x, y) % 4 !== 0;
  });
  for (const cell of farmhouses) {
    const x = cell % N;
    const y = Math.floor(cell / N);
    fieldCells.delete(cell);
    claim(cellAtoms(x, y, 1, 1, N), {
      shape: 'farmhouse',
      orient: 'a',
      spanU: 1,
      spanV: 1,
      zone: ZONE.farm,
      level: 1,
      variant: mix(seed, x, y) % 3,
      px: x + 0.5,
      py: y + 0.5,
      polygon: rectPolygon(x, y, 1, 1, LOT_INSET),
      capacity: capacityOf(4, ZONE.farm, 1),
    });
  }
  const seen = new Set();
  for (const start of [...fieldCells].sort((a, b) => a - b)) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    const cells = [];
    while (stack.length > 0) {
      const cell = stack.pop();
      cells.push(cell);
      const x = cell % N;
      const y = Math.floor(cell / N);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const next = (y + dy) * N + x + dx;
        if (x + dx >= 0 && x + dx < N && fieldCells.has(next) && !seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    cells.sort((a, b) => a - b);
    const atoms = cells.flatMap((c) => [c * 4, c * 4 + 1, c * 4 + 2, c * 4 + 3]);
    const middle = cells[Math.floor(cells.length / 2)];
    claim(atoms, {
      shape: 'field',
      orient: 'a',
      spanU: 0,
      spanV: 0,
      zone: ZONE.farm,
      level: 1,
      variant: 0,
      px: (middle % N) + 0.5,
      py: Math.floor(middle / N) + 0.5,
      accessFrom: cells.map((c) => [(c % N) + 0.5, Math.floor(c / N) + 0.5]),
      polygon: null,
      cells,
      capacity: capacityOf(atoms.length, ZONE.farm, 1),
    });
  }
}

/** 公共用地没用完的部分长成小公园和广场，不留空格。 */
function fillPublicLand({ N, zones, seed }, tools) {
  const { cellOpen, nearRoad, claim } = tools;
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      if (!cellOpen(x, y) || zones[y * N + x] !== ZONE.public) continue;
      for (const [w, h] of PUBLIC_SPECS) {
        let fits = true;
        for (let j = y; fits && j < y + h; j += 1) {
          for (let i = x; fits && i < x + w; i += 1) {
            fits = cellOpen(i, j) && zones[j * N + i] === ZONE.public;
          }
        }
        if (!fits) continue;
        const use = nearRoad(x, y, w, h) && mix(seed, x, y) % 3 === 0 ? 'plaza' : 'park';
        claim(cellAtoms(x, y, w, h, N), {
          shape: 'public',
          orient: 'a',
          spanU: w,
          spanV: h,
          use,
          zone: ZONE.public,
          level: 1,
          variant: mix(seed, y, x) % 2,
          px: x + w / 2,
          py: y + h / 2,
          polygon: rectPolygon(x, y, w, h, LOT_INSET),
          capacity: 0,
        });
        break;
      }
    }
  }
}

/** 收边：只处理残缺的格子。整格空地不切成小三角，留作绿地。 */
function placeSmallTriangles({ N, zones, seed }, tools) {
  const { open, cellOpen, claim } = tools;
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const base = (y * N + x) * 4;
      const zone = zones[y * N + x];
      if (zone === ZONE.none || cellOpen(x, y)) continue;
      for (let q = 0; q < 4; q += 1) {
        const a = base + q;
        const b = base + ((q + 1) % 4);
        if (!open(a) || !open(b)) continue;
        const corners = [
          [x, y],
          [x + 1, y],
          [x + 1, y + 1],
          [x, y + 1],
        ];
        const polygon = [corners[q], corners[(q + 1) % 4], corners[(q + 2) % 4]];
        const center = [
          (polygon[0][0] + polygon[1][0] + polygon[2][0]) / 3,
          (polygon[0][1] + polygon[1][1] + polygon[2][1]) / 3,
        ];
        const inner = polygon.map(([px, py]) => [
          px + (center[0] - px) * 0.14,
          py + (center[1] - py) * 0.14,
        ]);
        const roll = mix(seed, x * 3 + q, y);
        const farm = zone === ZONE.farm;
        const publicLand = zone === ZONE.public;
        const kinds =
          zone === ZONE.commercial
            ? ['shop', 'parking', 'shop']
            : zone === ZONE.residential
              ? ['garden', 'shop', 'parking']
              : ['parking', 'garden', 'parking'];
        const use = farm ? 'crop' : publicLand ? 'garden' : kinds[roll % 3];
        const earns = use === 'shop' || use === 'crop';
        const earnZone = farm ? ZONE.farm : ZONE.commercial;
        claim([a, b], {
          shape: 'triangle',
          orient: String(q),
          spanU: 1,
          spanV: 1,
          use,
          zone: earns ? earnZone : zone,
          level: 1,
          variant: (roll >>> 9) % 2,
          px: x + 0.5,
          py: y + 0.5,
          polygon: inner,
          capacity: earns ? capacityOf(2, earnZone, 1) : 0,
        });
      }
    }
  }
}

export function generateParcels(input) {
  const { N, roads, water, slopes, zones, density } = input;
  const free = freeAtoms({ N, roads, water, slopes });
  const buildableAtoms = free.reduce((sum, value) => sum + value, 0);
  const used = new Int32Array(N * N * 4).fill(-1);
  const parcels = [];

  const open = (atom) => free[atom] === 1 && used[atom] < 0;
  const tools = {
    open,
    zoneAt: (atom) => zones[atom >> 2],
    levelAt: (atom) => density[atom >> 2] || 1,
    cellOpen(x, y) {
      if (x < 0 || y < 0 || x >= N || y >= N) return false;
      const base = (y * N + x) * 4;
      return open(base) && open(base + 1) && open(base + 2) && open(base + 3);
    },
    nearRoad(x, y, w, h) {
      for (let j = y - 1; j <= y + h; j += 1) {
        for (let i = x - 1; i <= x + w; i += 1) {
          if (i >= x && i < x + w && j >= y && j < y + h) continue;
          if (i >= 0 && j >= 0 && i < N && j < N && roads.has(j * N + i)) return true;
        }
      }
      return false;
    },
    claim(atoms, parcel) {
      const id = parcels.length;
      for (const atom of atoms) used[atom] = id;
      const { accessFrom, ...rest } = parcel;
      const access = nearestRoad(roads, N, accessFrom ?? [[parcel.px, parcel.py]]);
      parcels.push({ id, atoms: atoms.length, area: atoms.length / 4, access, ...rest });
    },
    placeService(service, { x, y, w, h }) {
      tools.claim(cellAtoms(x, y, w, h, N), {
        shape: 'service',
        orient: 'a',
        spanU: w,
        spanV: h,
        use: service.id,
        zone: ZONE.public,
        level: 1,
        variant: 0,
        px: x + w / 2,
        py: y + h / 2,
        polygon: rectPolygon(x, y, w, h, LOT_INSET),
        capacity: 0,
      });
    },
  };

  placeTriangles(input, tools);
  placeDiagonalBands(input, tools);
  placeRectangles(input, tools);
  placeFarmland(input, tools);
  const services = placeServices(input, tools, parcels);
  fillPublicLand(input, tools);
  placeSmallTriangles(input, tools);

  const usedAtoms = used.reduce((sum, value) => sum + (value >= 0 ? 1 : 0), 0);
  return { parcels, buildableAtoms, usedAtoms, atomOwner: used, free, services };
}

/**
 * 独立统计大三角形空地有没有被拆碎：只看可建设的土地，不看生成器是怎么放的。
 * 同一块三角形空地上只有一个物业算完整；出现正方形加小三角的拼法单独计数。
 */
export function triangleLandReport(result, N, zones) {
  const { free, atomOwner, parcels } = result;
  const lands = triangleLands(
    N,
    (atom) => free[atom] === 1,
    (atom) => zones[atom >> 2],
  );
  const summary = {
    lands: lands.length,
    complete: 0,
    fragmented: 0,
    squarePlusTriangles: 0,
    bySize: {},
  };
  for (const land of lands) {
    const owners = new Set(land.atoms.map((atom) => atomOwner[atom]));
    const complete = owners.size === 1 && !owners.has(-1);
    const size = (summary.bySize[land.legs] ??= { lands: 0, complete: 0 });
    size.lands += 1;
    if (complete) {
      summary.complete += 1;
      size.complete += 1;
    } else {
      summary.fragmented += 1;
      const shapes = [...owners].filter((owner) => owner >= 0).map((owner) => parcels[owner].shape);
      const small = shapes.filter((shape) => shape === 'triangle').length;
      if (shapes.includes('rect') && small >= 2) summary.squarePlusTriangles += 1;
    }
  }
  return summary;
}

/** 公共用地有没有空着的原子。 */
export function publicLandReport(result, N, zones) {
  const { free, atomOwner } = result;
  let total = 0;
  let empty = 0;
  for (let atom = 0; atom < free.length; atom += 1) {
    if (free[atom] === 1 && zones[atom >> 2] === ZONE.public) {
      total += 1;
      if (atomOwner[atom] < 0) empty += 1;
    }
  }
  void N;
  return { publicAtoms: total, emptyAtoms: empty };
}

/** 面积和容量表：同一分区同一等级，每单位面积的容量必须完全一样。 */
export function capacityTable(parcels) {
  const rows = new Map();
  for (const parcel of parcels) {
    const key = `${String(parcel.zone)}|${String(parcel.level)}|${parcel.shape}|${String(parcel.spanU)}x${String(parcel.spanV)}|${parcel.use ?? ''}`;
    const row = rows.get(key) ?? {
      zone: parcel.zone,
      level: parcel.level,
      shape: parcel.shape,
      size: `${String(parcel.spanU)}×${String(parcel.spanV)}`,
      use: parcel.use ?? '',
      count: 0,
      area: 0,
      capacity: 0,
    };
    row.count += 1;
    row.area += parcel.area;
    row.capacity += parcel.capacity;
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((row) => ({ ...row, density: row.capacity / row.area }))
    .sort((a, b) => a.zone - b.zone || a.level - b.level || a.shape.localeCompare(b.shape));
}
