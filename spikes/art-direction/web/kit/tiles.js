import { LEVEL } from './bake.js';
import { Builder, hashString, linear, mix, shade } from './builder.js';

// 地表、水面、河岸和线路。线路都是覆盖层，画在地表之上，所以斜路可以越过格子的角。

const BLEED = 0.013;
const WATER_Y = -0.13;
const BED_Y = -0.24;

export const DIRECTIONS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** 四个角的高度做双线性插值。corners 依次是 (-,-)、(+,-)、(+,+)、(-,+) 四个角，单位是层。 */
function heightAt([a, b, c, d], x, z) {
  const u = x + 0.5;
  const v = z + 0.5;
  return (a * (1 - u) * (1 - v) + b * u * (1 - v) + c * u * v + d * (1 - u) * v) * LEVEL;
}

function grid(n, fn) {
  const rows = [];
  for (let j = 0; j <= n; j += 1) {
    const row = [];
    for (let i = 0; i <= n; i += 1) row.push(fn(i, j, i === 0 || i === n || j === 0 || j === n));
    rows.push(row);
  }
  return rows;
}

function mesh(b, rows, colorOf) {
  const n = rows.length - 1;
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = rows[j][i];
      const c = rows[j][i + 1];
      const d = rows[j + 1][i + 1];
      const e = rows[j + 1][i];
      if ((i + j) % 2 === 0) {
        b.poly([a, e, d], colorOf(a, e, d), [0, 1, 0]);
        b.poly([a, d, c], colorOf(a, d, c), [0, 1, 0]);
      } else {
        b.poly([a, e, c], colorOf(a, e, c), [0, 1, 0]);
        b.poly([e, d, c], colorOf(e, d, c), [0, 1, 0]);
      }
    }
  }
}

function outward(value, border) {
  if (!border) return value;
  if (value <= -0.499) return value - BLEED;
  if (value >= 0.499) return value + BLEED;
  return value;
}

function faceNormal(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  const sign = ny < 0 ? -1 : 1;
  return [(nx / length) * sign, (ny / length) * sign, (nz / length) * sign];
}

/** 坡面朝向太阳时提亮，背光时压暗。缓坡的光照差很小，不加强就看不出高度；亮面减半，免得发荧光。 */
function relief(P, a, b, c) {
  const [nx, , nz] = faceNormal(a, b, c);
  const [sx, , sz] = P.sun.direction;
  const facing = (nx * sx + nz * sz) / Math.hypot(sx, sz);
  return 1 + facing * P.ground.relief * (facing > 0 ? 0.5 : 1);
}

/** 边界顶点不抖动，保证相邻格的边完全重合；内部顶点抖动出低多边形的碎面。 */
export function buildGround(corners, surface, P, seed) {
  const b = new Builder(seed);
  const base = linear(P.ground[surface]);
  const sloped = new Set(corners).size > 1;
  const n = 3;
  const rows = grid(n, (i, j, border) => {
    let x = i / n - 0.5;
    let z = j / n - 0.5;
    const y = heightAt(corners, x, z);
    if (border) return [outward(x, true), y, outward(z, true)];
    x += (b.random() - 0.5) * 0.14;
    z += (b.random() - 0.5) * 0.14;
    return [x, y + (b.random() - 0.5) * 0.024, z];
  });
  mesh(b, rows, (p, q, r) => {
    const tone = sloped ? 0.985 + b.random() * 0.03 : 0.97 + b.random() * 0.06;
    return shade(base, sloped ? tone * relief(P, p, q, r) : tone);
  });
  return b;
}

/** 给平地加一点花草和小石头，让大片草地不单调。 */
export function buildMeadow(P, seed) {
  const b = new Builder(seed);
  const leaf = linear(P.tree.leaf[1]);
  const flower = [linear(P.tree.autumn), linear('#ffffff'), linear(P.zones.residential[2])];
  for (let i = 0; i < 7; i += 1) {
    const x = (b.random() - 0.5) * 0.8;
    const z = (b.random() - 0.5) * 0.8;
    if (b.random() < 0.55) {
      b.blob(x, 0.012, z, 0.028, 0.018, 0.028, shade(leaf, 0.9 + b.random() * 0.2));
    } else {
      b.cylinder(x, 0, z, 0.012, 0.004, 0.022, 4, flower[Math.floor(b.random() * 3)]);
    }
  }
  return b;
}

function waterPlane(b, P) {
  const deep = linear(P.water.deep);
  const mid = linear(P.water.mid);
  const n = 3;
  const rows = grid(n, (i, j, border) => {
    const x = i / n - 0.5;
    const z = j / n - 0.5;
    if (border) return [outward(x, true), WATER_Y, outward(z, true)];
    return [x + (b.random() - 0.5) * 0.12, WATER_Y, z + (b.random() - 0.5) * 0.12];
  });
  mesh(b, rows, () => mix(deep, mid, b.random() * 0.4));
}

function ripples(b, P) {
  const light = linear(P.water.light);
  for (let i = 0; i < 2; i += 1) {
    const x = (b.random() - 0.5) * 0.6;
    const z = (b.random() - 0.5) * 0.6;
    const length = 0.08 + b.random() * 0.1;
    b.poly(
      [
        [x - length, WATER_Y + 0.002, z + length * 0.2],
        [x, WATER_Y + 0.002, z - 0.01],
        [x + length, WATER_Y + 0.002, z - length * 0.2],
        [x, WATER_Y + 0.002, z + 0.01],
      ],
      light,
    );
  }
}

export function buildWater(P, seed) {
  const b = new Builder(seed);
  waterPlane(b, P);
  ripples(b, P);
  return b;
}

/** 两条距离的平滑最小值：两边都临水的凸角因此变圆，河岸不再是直角台阶。 */
function softMin(a, c, k = 0.14) {
  if (a >= 1 && c >= 1) return Math.min(a, c);
  return -k * Math.log(Math.exp(-a / k) + Math.exp(-c / k));
}

/** sides 依次是 -x、+x、-z、+z 四条边是否临水；cornersMask 是四个角是否临水。 */
export function buildBank(sides, cornersMask, P, seed) {
  const b = new Builder(seed);
  waterPlane(b, P);
  const grass = linear(P.ground.grass0);
  const sand = linear(P.ground.sand);
  const wet = linear(P.ground.wetSand);
  const foam = linear(P.water.light);
  const reach = 0.3;
  const points = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  const distance = (x, z) => {
    let d = 2;
    if (sides[0]) d = softMin(d, x + 0.5);
    if (sides[1]) d = softMin(d, 0.5 - x);
    if (sides[2]) d = softMin(d, z + 0.5);
    if (sides[3]) d = softMin(d, 0.5 - z);
    for (let i = 0; i < 4; i += 1) {
      if (cornersMask[i]) d = softMin(d, Math.hypot(x - points[i][0], z - points[i][1]) * 0.86);
    }
    return Math.max(0, d);
  };
  const n = 14;
  const rows = grid(n, (i, j, border) => {
    const x = i / n - 0.5;
    const z = j / n - 0.5;
    const t = Math.min(1, distance(x, z) / reach);
    const y = BED_Y + (0 - BED_Y) * Math.sin((t * Math.PI) / 2) ** 0.8;
    return [outward(x, border), y, outward(z, border)];
  });
  mesh(b, rows, (p, q, r) => {
    const y = (p[1] + q[1] + r[1]) / 3;
    if (y > -0.012) return shade(grass, 0.97 + b.random() * 0.06);
    if (y > -0.085) return shade(sand, 0.97 + b.random() * 0.05);
    if (y > WATER_Y + 0.004) return wet;
    return foam;
  });
  return b;
}

/** 沙盘的边：模型的底座，临水的地方能看到水的截面。 */
export function buildSkirt(axis, water, P) {
  const b = new Builder(5);
  const top = water ? WATER_Y : 0;
  const soil = linear(P.ground.soil);
  const face = linear(P.ground.plinth);
  const dark = linear(P.ground.plinthDark);
  const waterSide = linear(P.water.deep);
  const hint = axis === 'x' ? [1, 0, 0] : [0, 0, 1];
  const span = (a, c, y0, y1, color) => {
    const m = 0.5 + BLEED;
    if (axis === 'x') {
      b.poly([[0.5, y0, a * m], [0.5, y0, c * m], [0.5, y1, c * m], [0.5, y1, a * m]], color, hint);
    } else {
      b.poly([[a * m, y0, 0.5], [c * m, y0, 0.5], [c * m, y1, 0.5], [a * m, y1, 0.5]], color, hint);
    }
  };
  span(-1, 1, -0.16, top, water ? waterSide : soil);
  span(-1, 1, -0.5, -0.16, face);
  span(-1, 1, -0.54, -0.5, dark);
  return b;
}

function ribbonEdges(path, width) {
  const edges = [];
  for (let i = 0; i < path.length; i += 1) {
    const before = path[Math.max(0, i - 1)];
    const after = path[Math.min(path.length - 1, i + 1)];
    const dx = after[0] - before[0];
    const dz = after[2] - before[2];
    const length = Math.hypot(dx, dz) || 1;
    const nx = -dz / length;
    const nz = dx / length;
    let scale = 1;
    if (i > 0 && i < path.length - 1) {
      const ax = path[i][0] - before[0];
      const az = path[i][2] - before[2];
      const al = Math.hypot(ax, az) || 1;
      const miter = Math.abs((-az / al) * nx + (ax / al) * nz);
      scale = 1 / Math.max(miter, 0.5);
    }
    const half = (width / 2) * scale;
    const [x, y, z] = path[i];
    edges.push({
      left: [x + nx * half, y, z + nz * half],
      right: [x - nx * half, y, z - nz * half],
    });
  }
  return edges;
}

/** 沿路径的带状路面，lift 是路面高出路径的高度，同时画出两侧的立面。 */
function ribbon(b, path, width, lift, color) {
  const edges = ribbonEdges(path, width);
  for (let i = 0; i < edges.length - 1; i += 1) {
    const { left: l0, right: r0 } = edges[i];
    const { left: l1, right: r1 } = edges[i + 1];
    const up = (p) => [p[0], p[1] + lift, p[2]];
    b.poly([up(l0), up(l1), up(r1), up(r0)], color);
    b.poly([l0, l1, up(l1), up(l0)], shade(color, 0.82), [l0[0] - r0[0], 0, l0[2] - r0[2]]);
    b.poly([r0, r1, up(r1), up(r0)], shade(color, 0.82), [r0[0] - l0[0], 0, r0[2] - l0[2]]);
  }
}

function dashes(b, path, width, y, color, period = 0.3, fill = 0.55) {
  let travelled = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    const [x0, y0, z0] = path[i];
    const [x1, y1, z1] = path[i + 1];
    const length = Math.hypot(x1 - x0, z1 - z0);
    const count = Math.max(1, Math.round(length * 4));
    for (let k = 0; k < count; k += 1) {
      const t0 = k / count;
      const t1 = (k + 1) / count;
      const middle = travelled + ((t0 + t1) / 2) * length;
      if ((middle / period) % 1 < fill) {
        const a = [x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0 + y, z0 + (z1 - z0) * t0];
        const c = [x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1 + y, z0 + (z1 - z0) * t1];
        ribbonFlat(b, [a, c], width, color);
      }
    }
    travelled += length;
  }
}

function ribbonFlat(b, path, width, color) {
  const edges = ribbonEdges(path, width);
  for (let i = 0; i < edges.length - 1; i += 1) {
    b.poly([edges[i].left, edges[i + 1].left, edges[i + 1].right, edges[i].right], color);
  }
}

function spokeEnd(dir) {
  const [dx, dz] = DIRECTIONS[dir];
  return [dx * 0.5, dz * 0.5];
}

function offsetPath(path, offset) {
  return ribbonEdges(path, Math.abs(offset) * 2).map((edge) => (offset > 0 ? edge.left : edge.right));
}

function bezierPath(a, c, heightOf) {
  const steps = 7;
  const path = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = (1 - t) * (1 - t) * a[0] + t * t * c[0];
    const z = (1 - t) * (1 - t) * a[1] + t * t * c[1];
    path.push([x, heightOf(x, z), z]);
  }
  return path;
}

function straightPath(a, c, heightOf, steps = 6) {
  const path = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = a[0] + (c[0] - a[0]) * t;
    const z = a[1] + (c[1] - a[1]) * t;
    path.push([x, heightOf(x, z), z]);
  }
  return path;
}

function roadPaths(spokes, heightOf) {
  if (spokes.length === 1) {
    return [straightPath([0, 0], spokeEnd(spokes[0]), heightOf, 3)];
  }
  if (spokes.length === 2) {
    const a = spokeEnd(spokes[0]);
    const c = spokeEnd(spokes[1]);
    const opposite = (spokes[0] + 4) % 8 === spokes[1];
    return [opposite ? straightPath(a, c, heightOf) : bezierPath(a, c, heightOf)];
  }
  return spokes.map((dir) => straightPath([0, 0], spokeEnd(dir), heightOf, 3));
}

function hub(b, radius, y, thickness, color) {
  const sides = 8;
  const ring = [];
  for (let i = 0; i < sides; i += 1) {
    const a = ((i + 0.5) / sides) * Math.PI * 2;
    ring.push([Math.cos(a) * radius, y + thickness, Math.sin(a) * radius]);
  }
  b.poly(ring, color);
}

/** 路口每个方向一条斑马线。 */
function crosswalk(b, dir, width, y, color) {
  const [dx, dz] = DIRECTIONS[dir];
  const length = Math.hypot(dx, dz);
  const ux = dx / length;
  const uz = dz / length;
  const stripes = 5;
  const distance = 0.33;
  for (let i = 0; i < stripes; i += 1) {
    const t = (i + 0.5) / stripes - 0.5;
    const cx = ux * distance - uz * t * width;
    const cz = uz * distance + ux * t * width;
    const half = (width / stripes) * 0.3;
    b.poly(
      [
        [cx - ux * 0.05 - uz * half, y, cz - uz * 0.05 + ux * half],
        [cx + ux * 0.05 - uz * half, y, cz + uz * 0.05 + ux * half],
        [cx + ux * 0.05 + uz * half, y, cz + uz * 0.05 - ux * half],
        [cx - ux * 0.05 + uz * half, y, cz - uz * 0.05 - ux * half],
      ],
      color,
    );
  }
}

export const ROADS = {
  road: { walk: 0.66, deck: 0.46, line: 0.014 },
  highway: { walk: 0.9, deck: 0.8, line: 0.012 },
};

function layHighwayMarks(b, paths, junction, P) {
  const line = linear(P.road.line);
  for (const path of paths) {
    const inner = junction ? path.slice(2) : path;
    ribbon(b, inner.map((p) => [p[0], p[1] + 0.03, p[2]]), 0.05, 0.012, linear(P.road.median));
    for (const side of [0.2, -0.2]) {
      dashes(b, offsetPath(inner, side), 0.016, 0.032, line, 0.24, 0.5);
    }
    for (const side of [0.375, -0.375]) {
      ribbonFlat(b, offsetPath(inner, side).map((p) => [p[0], p[1] + 0.032, p[2]]), 0.012, line);
    }
  }
}

function layRoad(b, type, spokes, P, heightOf) {
  const spec = ROADS[type];
  const highway = type === 'highway';
  const asphalt = linear(highway ? P.road.highway : P.road.asphalt);
  const walk = linear(highway ? P.road.shoulder : P.road.walk);
  const line = linear(P.road.line);
  const paths = roadPaths(spokes, heightOf);
  const junction = spokes.length > 2;

  for (const path of paths) ribbon(b, path, spec.walk, 0.022, walk);
  if (junction) hub(b, spec.walk * 0.56, heightOf(0, 0), 0.022, walk);
  for (const path of paths) ribbon(b, path, spec.deck, 0.03, asphalt);
  if (junction) hub(b, spec.deck * 0.56, heightOf(0, 0), 0.03, asphalt);

  if (highway) {
    layHighwayMarks(b, paths, junction, P);
    return;
  }
  for (const path of paths) {
    const inner = junction ? path.slice(3) : path;
    dashes(b, inner, spec.line, 0.032, line);
  }
  if (junction) {
    for (const dir of spokes) crosswalk(b, dir, spec.deck * 0.86, heightOf(0, 0) + 0.032, line);
  }
}

export function buildRoad(type, spokes, P) {
  const b = new Builder(hashString(`${type}${spokes.join('')}`));
  layRoad(b, type, spokes, P, () => 0);
  return b;
}

/** 坡上的路。路面高度取中线处的地形，横向保持水平，高处用挡墙接地形，低处用填方接地形。 */
export function buildSlopeRoad(type, corners, spokes, P) {
  const b = new Builder(hashString(`s${type}${corners.join('')}${spokes.join('')}`));
  const terrain = (x, z) => heightAt(corners, x, z);
  const spec = ROADS[type];
  const wall = linear(P.road.wall);
  const fill = linear(P.road.fill);
  const path = roadPaths(spokes, terrain)[0];
  const width = spec.walk / 2 + 0.015;

  for (const side of [offsetPath(path, width), offsetPath(path, -width)]) {
    for (let i = 0; i < side.length - 1; i += 1) {
      const p0 = side[i];
      const p1 = side[i + 1];
      const g0 = terrain(p0[0], p0[2]);
      const g1 = terrain(p1[0], p1[2]);
      const nx = p0[0] - path[i][0];
      const nz = p0[2] - path[i][2];
      const delta = (g0 + g1) / 2 - (p0[1] + p1[1]) / 2;
      if (Math.abs(delta) < 0.004) continue;
      const out = 1 / Math.hypot(nx, nz);
      if (delta > 0) {
        b.poly(
          [
            [p0[0], p0[1], p0[2]],
            [p1[0], p1[1], p1[2]],
            [p1[0], g1 + 0.012, p1[2]],
            [p0[0], g0 + 0.012, p0[2]],
          ],
          shade(wall, 0.96 + (i % 2) * 0.06),
          [-nx, 0, -nz],
        );
      } else {
        const push0 = (p0[1] - g0) * 1.5 * out;
        const push1 = (p1[1] - g1) * 1.5 * out;
        b.poly(
          [
            [p0[0], p0[1], p0[2]],
            [p1[0], p1[1], p1[2]],
            [p1[0] + nx * push1, g1 - 0.005, p1[2] + nz * push1],
            [p0[0] + nx * push0, g0 - 0.005, p0[2] + nz * push0],
          ],
          shade(fill, 0.95 + (i % 2) * 0.06),
          [nx, 0.6, nz],
        );
      }
    }
  }
  layRoad(b, type, spokes, P, terrain);
  return b;
}

export function buildBridge(type, spokes, P) {
  const b = new Builder(hashString(`b${type}${spokes.join('')}`));
  const deckColor = linear(P.road.bridge);
  const rail = linear(P.road.rail);
  const a = spokeEnd(spokes[0]);
  const c = spokeEnd(spokes[1]);
  const path = straightPath(a, c, () => 0.0);
  const spec = ROADS[type];
  const width = spec.walk + 0.02;
  ribbon(b, path.map((p) => [p[0], -0.05, p[2]]), width, 0.052, deckColor);
  layRoad(b, type, spokes, P, () => 0);
  for (const side of [width / 2 - 0.01, -width / 2 + 0.01]) {
    const edge = offsetPath(path, side);
    ribbon(b, edge.map((p) => [p[0], 0.085, p[2]]), 0.02, 0.012, rail);
    for (let i = 0; i < edge.length; i += 2) {
      b.box(edge[i][0], 0.0, edge[i][2], 0.018, 0.09, 0.018, shade(rail, 0.85));
    }
  }
  const pier = linear(P.road.wall);
  const across = offsetPath([path[3], path[4]], width * 0.34);
  const opposite = offsetPath([path[3], path[4]], -width * 0.34);
  for (const point of [across[0], opposite[0]]) {
    b.cylinder(point[0], WATER_Y - 0.01, point[2], 0.045, 0.04, 0.09, 6, pier);
  }
  return b;
}

export const waterLevel = WATER_Y;
