import { LEVEL } from './bake.js';
import { Builder, hashString, linear, mix, shade } from './builder.js';
import { LAYER, roadMesh } from './roadshader.js';
import { cellPaths, DIRECTIONS, ROAD_SPEC, spokeEnd, spokesOf } from '../sim/network.js';
import { cornerHeight, cornerPlane, hermite, smooth } from '../sim/surface.js';

// 地表、水面、河岸、线路和农田。线路分三层绘制：全图先画人行道，再画路缘，最后画车道。
// cell 是一格路网：road、highway 两组方向位，arterial 标出 road 里的双向四车道。

const BLEED = 0.013;
const WATER_Y = -0.13;
const BED_Y = -0.24;
const EMBANKMENT_WIDTH = 0.2;
const EMBANKMENT_FADE = 0.9;
const FACE_MIN = 0.06;

export { DIRECTIONS, hermite, LAYER };

/** 四个角的高度插值，单位是世界坐标，x、z 相对格子中心。 */
export function heightAt(corners, x, z) {
  return cornerHeight(corners, x + 0.5, z + 0.5) * LEVEL;
}

function planeAt(corners, x, z) {
  return cornerPlane(corners, x + 0.5, z + 0.5) * LEVEL;
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
  const points = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
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
      b.poly(
        [
          [0.5, y0, a * m],
          [0.5, y0, c * m],
          [0.5, y1, c * m],
          [0.5, y1, a * m],
        ],
        color,
        hint,
      );
    } else {
      b.poly(
        [
          [a * m, y0, 0.5],
          [c * m, y0, 0.5],
          [c * m, y1, 0.5],
          [a * m, y1, 0.5],
        ],
        color,
        hint,
      );
    }
  };
  span(-1, 1, -0.16, top, water ? waterSide : soil);
  span(-1, 1, -0.5, -0.16, face);
  span(-1, 1, -0.54, -0.5, dark);
  return b;
}

export function buildRoad(cell, P, layer) {
  const paths = cellPaths(cell.road, cell.highway, cell.arterial);
  return { build: () => new Builder(1), extra: () => [roadMesh(paths, P, null, layer)] };
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
 * 坡段两端的路基渐变。切线为 0 的一头是坡段的端点，路在那里回到平地，
 * 挡墙和填方要在这一格里收到 0，否则会带着整段的高度竖直截断。
 */
function embankmentFade([, , m0, m1], t) {
  const atStart = m0 === 0 ? smooth(t / EMBANKMENT_FADE) : 1;
  const atEnd = m1 === 0 ? smooth((1 - t) / EMBANKMENT_FADE) : 1;
  return Math.min(atStart, atEnd);
}

/**
 * 坡上的路。整段路的纵坡由 grade 给定，路面平直，不跟着地形起伏，屏幕上也就不会走出 S 形。
 * 地形已经顺着路面抬起或压低（sim/sculpt.js），路贴在地上，两侧通常什么都不用画。
 * 只有高差实在放不下土坡时才留下路基：靠山一侧是矮挡墙，靠外一侧是等宽的填方。
 * 相机只看得见朝南、朝东的挡墙，背对相机的一侧不画，否则墙面会盖住路面。
 */
export function buildSlopeRoad(cell, corners, grade, P, layer) {
  const paths = cellPaths(cell.road, cell.highway, cell.arterial);
  const main = paths[0];
  const straight = paths.length === 1 && main.points.length === 2 && grade;
  const terrain = (x, z) => heightAt(corners, x, z);
  const hillside = (x, z) => planeAt(corners, x, z);
  const deckAt = (t) => hermite(grade, t) * LEVEL;
  const deckHeight = straight ? (x, z) => deckAt(nearestAlong(main.points, x, z)) : terrain;

  const build = () => {
    const b = new Builder(
      hashString(`${String(cell.road)}${String(cell.highway)}${corners.join('')}`),
    );
    if (!straight || layer !== LAYER.walk) return b;
    const wall = linear(P.road.wall);
    const coping = shade(wall, 1.12);
    const fill = mix(linear(P.road.fill), linear(P.ground.grass1), 0.3);
    const halfWidth = ROAD_SPEC[main.kind].walk / 2;
    const [a, c] = main.points;
    const dx = c[0] - a[0];
    const dz = c[1] - a[1];
    const length = Math.hypot(dx, dz);
    const nx = -dz / length;
    const nz = dx / length;
    const steps = 20;
    const edge = (t, side) => {
      const [x, z] = pointOnPath(main.points, t);
      const deck = deckAt(t);
      const point = [x + nx * side * halfWidth, deck, z + nz * side * halfWidth];
      const fade = embankmentFade(grade, t);
      return { point, fade, ground: deck + (hillside(point[0], point[2]) - deck) * fade };
    };
    /** 路基外缘：宽度跟着渐变收窄，外缘的高度落在坡面上，收到 0 时和路面边重合。 */
    const toe = ({ point, fade }, side) => {
      const out = EMBANKMENT_WIDTH * fade;
      const x = point[0] + nx * side * out;
      const z = point[2] + nz * side * out;
      const slope = Math.min(point[1], hillside(x, z) + 0.002);
      return [x, point[1] + (slope - point[1]) * fade, z];
    };
    for (const side of [1, -1]) {
      const wallVisible = (nx + nz) * side < -0.01;
      for (let i = 0; i < steps; i += 1) {
        const e0 = edge(i / steps, side);
        const e1 = edge((i + 1) / steps, side);
        const d0 = e0.ground - e0.point[1];
        const d1 = e1.ground - e1.point[1];
        const p0 = e0.point;
        const p1 = e1.point;
        if (wallVisible && (d0 > FACE_MIN || d1 > FACE_MIN)) {
          const top0 = Math.max(p0[1], e0.ground);
          const top1 = Math.max(p1[1], e1.ground);
          const face = shade(wall, Math.floor(i / 4) % 2 === 0 ? 0.95 : 1);
          b.poly([p0, p1, [p1[0], top1, p1[2]], [p0[0], top0, p0[2]]], face, [
            -nx * side,
            0,
            -nz * side,
          ]);
          const cap0 = 0.012 * e0.fade;
          const cap1 = 0.012 * e1.fade;
          b.poly(
            [
              [p0[0], top0, p0[2]],
              [p1[0], top1, p1[2]],
              [p1[0], top1 + cap1, p1[2]],
              [p0[0], top0 + cap0, p0[2]],
            ],
            coping,
            [-nx * side, 0, -nz * side],
          );
        }
        if (!wallVisible && (d0 < -FACE_MIN || d1 < -FACE_MIN)) {
          b.poly([p0, p1, toe(e1, side), toe(e0, side)], shade(fill, 0.98 + (Math.floor(i / 4) % 2) * 0.03), [
            nx * side,
            0.6,
            nz * side,
          ]);
        }
      }
    }
    return b;
  };
  return { build, extra: () => [roadMesh(paths, P, deckHeight, layer)] };
}

export function buildBridge(cell, P) {
  const paths = cellPaths(cell.road, cell.highway, cell.arterial);
  const spokes = spokesOf(cell.road | cell.highway);
  const kind = paths[0].kind;
  const build = () => {
    const b = new Builder(hashString(`b${String(cell.road)}${String(cell.highway)}`));
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
    const corner = (t, side, y) => [
      a[0] + dx * t + nx * side * half,
      y,
      a[1] + dz * t + nz * side * half,
    ];
    b.poly([corner(0, 1, -0.05), corner(1, 1, -0.05), corner(1, 1, 0), corner(0, 1, 0)], deckColor, [
      nx,
      0,
      nz,
    ]);
    b.poly(
      [corner(0, -1, -0.05), corner(1, -1, -0.05), corner(1, -1, 0), corner(0, -1, 0)],
      deckColor,
      [-nx, 0, -nz],
    );
    for (const side of [1, -1]) {
      for (let i = 0; i <= 6; i += 1) {
        const [x, y, z] = corner(i / 6, side * 0.98, 0);
        b.box(x, y, z, 0.016, 0.085, 0.016, shade(rail, 0.85));
      }
      b.poly(
        [
          corner(0, side * 0.98, 0.085),
          corner(1, side * 0.98, 0.085),
          corner(1, side * 0.98, 0.1),
          corner(0, side * 0.98, 0.1),
        ],
        rail,
        [nx * side, 0, nz * side],
      );
    }
    for (const side of [0.62, -0.62]) {
      const [x, , z] = corner(0.5, side, 0);
      b.cylinder(x, WATER_Y - 0.01, z, 0.045, 0.04, 0.09, 6, pier);
    }
    return b;
  };
  return { build, extra: () => [roadMesh(paths, P, null, LAYER.both)] };
}

/**
 * 还没打通的道路收尾。inward 是路来的方向：路面在格子中心平切，
 * 前方是一道红白路障和三只锥桶，路障后面到地图边缘是预留路面的虚线。
 */
export function buildPlannedEnd(kind, inward, P) {
  const b = new Builder(hashString(`gate${kind}${String(inward)}`));
  const [ox, oz] = DIRECTIONS[(inward + 4) % 8];
  const length = Math.hypot(ox, oz);
  const rotation = Math.atan2(-oz, ox);
  const halfDeck = ROAD_SPEC[kind].deck / 2;
  const reach = length / 2;
  const dashColor = linear(P.road.plan);
  const red = linear(P.road.rail);
  const white = linear('#f6f3ea');
  b.at(0, 0, 0, rotation, (c) => {
    for (const v of [-halfDeck, halfDeck]) {
      for (let x = 0.1; x + 0.07 < reach; x += 0.13) {
        c.poly(
          [
            [x, 0.006, v - 0.012],
            [x + 0.08, 0.006, v - 0.012],
            [x + 0.08, 0.006, v + 0.012],
            [x, 0.006, v + 0.012],
          ],
          dashColor,
        );
      }
    }
    const stripes = Math.max(4, Math.round((halfDeck * 2) / 0.09));
    const width = (halfDeck * 2 + 0.04) / stripes;
    for (const height of [0.075, 0.125]) {
      for (let i = 0; i < stripes; i += 1) {
        const v = -halfDeck - 0.02 + width * (i + 0.5);
        c.box(0.03, height, v, 0.02, 0.034, width, i % 2 === 0 ? red : white);
      }
    }
    for (const v of [-halfDeck - 0.01, 0, halfDeck + 0.01])
      c.box(0.03, 0, v, 0.024, 0.16, 0.024, shade(white, 0.86));
    for (const v of [-halfDeck * 0.55, 0, halfDeck * 0.55]) {
      c.cylinder(0.17, 0, v, 0.034, 0.002, 0.095, 6, linear(P.road.plan));
      c.cylinder(0.17, 0.038, v, 0.021, 0.015, 0.016, 6, white);
    }
  });
  return b;
}

const CROPS = ['wheat', 'greens', 'rape', 'furrow'];

/** 农田是连续的：垄线贯穿格子边界，相邻地块之间没有田埂和底板。 */
export function buildField(crop, axis, P, seed) {
  const b = new Builder(seed);
  const colors = {
    wheat: P.field.wheat,
    greens: P.field.greens,
    rape: P.field.rape,
    furrow: P.field.furrow,
  };
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
    if (axis === 'x')
      b.poly(
        [
          [-span, y0, zFront],
          [span, y0, zFront],
          [span, y1, zFront],
          [-span, y1, zFront],
        ],
        side,
        [0, 0, 1],
      );
    else
      b.poly(
        [
          [zFront, y0, -span],
          [zFront, y0, span],
          [zFront, y1, span],
          [zFront, y1, -span],
        ],
        side,
        [1, 0, 0],
      );
  }
  return b;
}

export const waterLevel = WATER_Y;
