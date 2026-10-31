import * as THREE from 'three';
import { LEVEL } from './bake.js';
import { Builder, hashString, linear, mix, shade } from './builder.js';
import { roadMesh } from './roadshader.js';
import { cellPaths, DIRECTIONS, ROAD_SPEC, spokeEnd, spokesOf } from '../sim/network.js';

// 地表、水面、河岸、线路和农田。线路都是覆盖层，画在地表之上，所以斜路可以越过格子的角。

const BLEED = 0.013;
const WATER_Y = -0.13;
const BED_Y = -0.24;

export { DIRECTIONS };

const smooth = (t) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/**
 * 四个角的高度插值，单位是世界坐标。插值用平滑曲线，格子边界处的坡度正好是 0，
 * 所以坡到平地的过渡是连续的，不会出现一条折线。corners 依次是 (-,-)、(+,-)、(+,+)、(-,+)。
 */
function heightAt([a, b, c, d], x, z) {
  const u = smooth(x + 0.5);
  const v = smooth(z + 0.5);
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

/** 地表颜色随实际高度连续变化，层和层之间没有色带。 */
function surfaceColor(P, height) {
  const stops = [P.ground.grass0, P.ground.grass1, P.ground.grass2, P.ground.rock];
  const t = Math.max(0, Math.min(2.999, height));
  const low = Math.floor(t);
  return mix(linear(stops[low]), linear(stops[low + 1]), t - low);
}

/** 边界顶点不抖动，保证相邻格的边完全重合；内部顶点抖动出低多边形的碎面。 */
export function buildGround(corners, level, P, seed) {
  const b = new Builder(seed);
  const sloped = new Set(corners).size > 1;
  const n = sloped ? 6 : 3;
  const jitter = sloped ? 0.05 : 0.14;
  const rows = grid(n, (i, j, border) => {
    let x = i / n - 0.5;
    let z = j / n - 0.5;
    const y = heightAt(corners, x, z);
    if (border) return [outward(x, true), y, outward(z, true)];
    x += (b.random() - 0.5) * jitter;
    z += (b.random() - 0.5) * jitter;
    return [x, heightAt(corners, x, z) + (sloped ? 0 : (b.random() - 0.5) * 0.024), z];
  });
  mesh(b, rows, (p, q, r) => {
    const tone = sloped ? 0.99 + b.random() * 0.02 : 0.97 + b.random() * 0.06;
    const base = surfaceColor(P, level + (p[1] + q[1] + r[1]) / 3 / LEVEL);
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
  const middle = linear(P.water.mid);
  const n = 3;
  const rows = grid(n, (i, j, border) => {
    const x = i / n - 0.5;
    const z = j / n - 0.5;
    if (border) return [outward(x, true), WATER_Y, outward(z, true)];
    return [x + (b.random() - 0.5) * 0.12, WATER_Y, z + (b.random() - 0.5) * 0.12];
  });
  mesh(b, rows, () => mix(deep, middle, b.random() * 0.4));
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

export function buildRoad(road, highway, P) {
  const paths = cellPaths(road, highway);
  return { build: () => new Builder(1), extra: () => [roadMesh(paths, P, null)] };
}

function pointOnPath(points, t) {
  const [a, c] = [points[0], points[points.length - 1]];
  return [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
}

function nearestAlong(points, x, z) {
  const [a, c] = [points[0], points[points.length - 1]];
  const dx = c[0] - a[0];
  const dz = c[1] - a[1];
  const t = ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz);
  return Math.max(0, Math.min(1, t));
}

/**
 * 坡上的路。路面高度取中线处的地形，横向保持水平，高处用挡墙接地形，低处用填方接地形。
 * 只有穿过格子的直路才有路基；坡上不转弯，这是 ADR-0001 的规则。
 */
export function buildSlopeRoad(road, highway, corners, P) {
  const paths = cellPaths(road, highway);
  const main = paths[0];
  const straight = paths.length === 1 && main.points.length === 2;
  const terrain = (x, z) => heightAt(corners, x, z);
  const deckHeight = straight
    ? (x, z) => {
        const [px, pz] = pointOnPath(main.points, nearestAlong(main.points, x, z));
        return terrain(px, pz);
      }
    : terrain;

  const build = () => {
    const b = new Builder(hashString(`${String(road)}${String(highway)}${corners.join('')}`));
    if (!straight) return b;
    const wall = linear(P.road.wall);
    const coping = linear(P.road.walk);
    const fill = linear(P.road.fill);
    const halfWidth = ROAD_SPEC[main.kind].walk / 2;
    const [a, c] = main.points;
    const dx = c[0] - a[0];
    const dz = c[1] - a[1];
    const length = Math.hypot(dx, dz);
    const nx = -dz / length;
    const nz = dx / length;
    const steps = 18;
    for (const side of [1, -1]) {
      for (let i = 0; i < steps; i += 1) {
        const [x0, z0] = pointOnPath(main.points, i / steps);
        const [x1, z1] = pointOnPath(main.points, (i + 1) / steps);
        const deck0 = terrain(x0, z0);
        const deck1 = terrain(x1, z1);
        const e0 = [x0 + nx * side * halfWidth, deck0, z0 + nz * side * halfWidth];
        const e1 = [x1 + nx * side * halfWidth, deck1, z1 + nz * side * halfWidth];
        const g0 = terrain(e0[0], e0[2]);
        const g1 = terrain(e1[0], e1[2]);
        const delta = (g0 - deck0 + g1 - deck1) / 2;
        if (Math.abs(delta) < 0.003) continue;
        if (delta > 0) {
          const face = shade(wall, Math.floor(i / 3) % 2 === 0 ? 0.94 : 1);
          b.poly([e0, e1, [e1[0], g1, e1[2]], [e0[0], g0, e0[2]]], face, [-nx * side, 0, -nz * side]);
          b.poly(
            [
              [e0[0], g0, e0[2]],
              [e1[0], g1, e1[2]],
              [e1[0], g1 + 0.012, e1[2]],
              [e0[0], g0 + 0.012, e0[2]],
            ],
            coping,
            [-nx * side, 0, -nz * side],
          );
        } else {
          const reach0 = (deck0 - g0) * 1.7;
          const reach1 = (deck1 - g1) * 1.7;
          const o0 = [e0[0] + nx * side * reach0, 0, e0[2] + nz * side * reach0];
          const o1 = [e1[0] + nx * side * reach1, 0, e1[2] + nz * side * reach1];
          o0[1] = terrain(o0[0], o0[2]) + 0.002;
          o1[1] = terrain(o1[0], o1[2]) + 0.002;
          b.poly([e0, e1, o1, o0], shade(mix(fill, linear(P.ground.grass1), 0.28), 0.98 + (i % 2) * 0.04), [nx * side, 0.6, nz * side]);
        }
      }
    }
    return b;
  };
  return { build, extra: () => [roadMesh(paths, P, deckHeight)] };
}

export function buildBridge(road, highway, P) {
  const paths = cellPaths(road, highway);
  const spokes = spokesOf(road | highway);
  const kind = highway ? 'highway' : 'road';
  const build = () => {
    const b = new Builder(hashString(`b${String(road)}${String(highway)}`));
    const deckColor = linear(P.road.bridge);
    const rail = linear(P.road.rail);
    const pier = linear(P.road.wall);
    const a = spokeEnd(spokes[0]);
    const c = spokeEnd(spokes[1]);
    const dx = c[0] - a[0];
    const dz = c[1] - a[1];
    const length = Math.hypot(dx, dz);
    const nx = -dz / length;
    const nz = dx / length;
    const half = ROAD_SPEC[kind].walk / 2 + 0.02;
    const corner = (t, side, y) => [a[0] + dx * t + nx * side * half, y, a[1] + dz * t + nz * side * half];
    b.poly([corner(0, 1, -0.05), corner(1, 1, -0.05), corner(1, 1, 0), corner(0, 1, 0)], deckColor, [nx, 0, nz]);
    b.poly([corner(0, -1, -0.05), corner(1, -1, -0.05), corner(1, -1, 0), corner(0, -1, 0)], deckColor, [-nx, 0, -nz]);
    for (const side of [1, -1]) {
      for (let i = 0; i <= 6; i += 1) {
        const [x, y, z] = corner(i / 6, side * 0.98, 0);
        b.box(x, y, z, 0.016, 0.085, 0.016, shade(rail, 0.85));
      }
      b.poly([corner(0, side * 0.98, 0.085), corner(1, side * 0.98, 0.085), corner(1, side * 0.98, 0.1), corner(0, side * 0.98, 0.1)], rail, [nx * side, 0, nz * side]);
    }
    for (const side of [0.62, -0.62]) {
      const [x, , z] = corner(0.5, side, 0);
      b.cylinder(x, WATER_Y - 0.01, z, 0.045, 0.04, 0.09, 6, pier);
    }
    return b;
  };
  return { build, extra: () => [roadMesh(paths, P, null)] };
}

const CROPS = ['wheat', 'greens', 'rape', 'furrow'];

/** 农田是连续的：垄线贯穿格子边界，相邻地块之间没有田埂和底板。 */
export function buildField(crop, axis, P, seed) {
  const b = new Builder(seed);
  const colors = { wheat: P.field.wheat, greens: P.field.greens, rape: P.field.rape, furrow: P.field.furrow };
  const color = linear(colors[CROPS[crop]]);
  const soil = linear(P.field.soil);
  const rows = 5;
  const span = 0.5 + BLEED;
  const width = 1 / rows;
  const rect = (x0, x1, z0, z1, y, c) => {
    const flip = axis === 'z';
    const p = (u, v, h) => (flip ? [v, h, u] : [u, h, v]);
    b.poly([p(x0, z0, y), p(x1, z0, y), p(x1, z1, y), p(x0, z1, y)], c);
  };
  for (let i = 0; i < rows; i += 1) {
    const z0 = -0.5 + width * i;
    const z1 = z0 + width;
    const a = i === 0 ? -span : z0;
    const c = i === rows - 1 ? span : z1;
    rect(-span, span, a, c, 0.004, soil);
    const tone = 0.95 + b.random() * 0.1;
    rect(-span, span, z0 + width * 0.16, z1 - width * 0.16, 0.022, shade(color, tone));
    const side = shade(color, tone * 0.78);
    const y0 = 0.004;
    const y1 = 0.022;
    const zFront = z1 - width * 0.16;
    if (axis === 'x') b.poly([[-span, y0, zFront], [span, y0, zFront], [span, y1, zFront], [-span, y1, zFront]], side, [0, 0, 1]);
    else b.poly([[zFront, y0, -span], [zFront, y0, span], [zFront, y1, span], [zFront, y1, -span]], side, [1, 0, 0]);
  }
  return b;
}

export const waterLevel = WATER_Y;
export { THREE };
