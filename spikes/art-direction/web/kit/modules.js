import { Builder, hashString, linear, mix, shade } from './builder.js';
import { edgesOf, facesCamera, plate, prism, rectangle, scaled, shopFront, tree, triangleBlock, triangleFrame, triangleLot, wallOf, windows } from './objects.js';
import { steppedTiers } from '../sim/combos.js';

// 模块拼装实验。一栋楼不再烘焙成一整张图，而是底座（地块和底商）、楼身、屋顶三张精灵叠起来，运行时按组合取用。
// 大小：2x2 是两格见方的直角地块，Q3 是直角边 3 格的大三角地块，方向由底座决定，楼身和屋顶不分方向。
// 底座按地块的形状长：三角地块上的底座就是三角形，整块地由底座占满，楼身站在上面，露出来的屋面做成花池。

const MODULE_FLOOR = 1 / Math.sqrt(6) / 2;
const BODY_SIZE = 1.1;
const SQUARE_PODIUM = 1.24;
const LOT_LIFT = 0.02;
const TRIANGLE_LEGS = 3;
const COLUMN_GAP = 0.42;
const TERRACE_TREES = 5;

const podiumFloor = { spacing: MODULE_FLOOR - LOT_LIFT, skip: 1 };

const PODIUMS = {
  /** 沿街底商：通长的玻璃橱窗和雨棚。 */
  shops(b, points, P) {
    const wall = linear(P.wall.warm);
    prism(b, points, LOT_LIFT, 1, wall, wall, P, podiumFloor);
    shopFront(b, points, LOT_LIFT, P, linear(P.zones.commercial[0]));
  },
  /** 架空层：一圈柱子，楼像是站在柱子上。 */
  pilotis(b, points, P) {
    const concrete = linear(P.wall.concrete);
    prism(b, scaled(points, 0.5), LOT_LIFT, 1, shade(concrete, 0.7), shade(concrete, 0.7), P, podiumFloor);
    prism(b, points, MODULE_FLOOR - 0.03, 1, concrete, shade(concrete, 1.06), P, { spacing: 0.03, skip: 1 });
    for (const { x0, z0, x1, z1, length } of edgesOf(points)) {
      const count = Math.max(2, Math.round(length / COLUMN_GAP));
      for (let i = 0; i < count; i += 1) {
        const t = i / count;
        b.box(x0 + (x1 - x0) * t, LOT_LIFT, z0 + (z1 - z0) * t, 0.05, MODULE_FLOOR - LOT_LIFT, 0.05, concrete);
      }
    }
  },
  /** 大堂：石材基座，朝相机最正的一面开一个玻璃门厅。 */
  lobby(b, points, P) {
    const stone = linear(P.wall.brick);
    prism(b, points, LOT_LIFT, 1, stone, stone, P, podiumFloor);
    const front = edgesOf(points).filter(facesCamera).reduce((best, edge) => (edge.nx + edge.nz > best.nx + best.nz ? edge : best));
    const { x0, z0, x1, z1, nx, nz, length } = front;
    const half = Math.min(0.2, 0.4 / length);
    const at = (t, y, out) => [x0 + (x1 - x0) * (0.5 + t) + nx * out, y, z0 + (z1 - z0) * (0.5 + t) + nz * out];
    const hall = MODULE_FLOOR * 0.8;
    b.poly([at(-half, 0.03, 0.006), at(half, 0.03, 0.006), at(half, hall, 0.006), at(-half, hall, 0.006)], linear(P.wall.glass), [nx, 0, nz]);
    b.poly([at(-half * 1.2, hall + 0.01, 0), at(half * 1.2, hall + 0.01, 0), at(half * 1.2, hall + 0.01, 0.12), at(-half * 1.2, hall + 0.01, 0.12)], linear(P.wall.cool));
  },
};

/** 楼身都以中心为原点，从 y=0 长到 floors 层。不同楼型的体量不同，不只是换颜色。 */
const BODIES = {
  slab(b, floors, wall, accent, P) {
    const h = floors * MODULE_FLOOR;
    b.box(0, 0, 0, BODY_SIZE, h, BODY_SIZE * 0.56, wall);
    windows(b, BODY_SIZE, BODY_SIZE * 0.56, 0, floors, P, MODULE_FLOOR);
    b.box(BODY_SIZE / 2 + 0.008, 0, 0, 0.016, h, 0.2, accent);
  },
  tower(b, floors, wall, accent, P) {
    const h = floors * MODULE_FLOOR;
    b.box(0, 0, 0, BODY_SIZE * 0.62, h, BODY_SIZE * 0.62, wall);
    windows(b, BODY_SIZE * 0.62, BODY_SIZE * 0.62, 0, floors, P, MODULE_FLOOR);
    for (let f = 2; f < floors; f += 3) b.box(0, f * MODULE_FLOOR, 0, BODY_SIZE * 0.66, 0.014, BODY_SIZE * 0.66, accent);
  },
  ell(b, floors, wall, accent, P) {
    const h = floors * MODULE_FLOOR;
    const wing = BODY_SIZE * 0.36;
    b.at(0, 0, -BODY_SIZE * 0.32, 0, (c) => {
      c.box(0, 0, 0, BODY_SIZE, h, wing, wall);
      windows(c, BODY_SIZE, wing, 0, floors, P, MODULE_FLOOR);
    });
    b.at(-BODY_SIZE * 0.32, 0, BODY_SIZE * 0.18, 0, (c) => {
      c.box(0, 0, 0, wing, h, BODY_SIZE * 0.64, shade(wall, 0.96));
      windows(c, wing, BODY_SIZE * 0.64, 0, floors, P, MODULE_FLOOR);
    });
    b.box(-BODY_SIZE * 0.32, h - 0.02, -BODY_SIZE * 0.32, wing + 0.02, 0.02, wing + 0.02, accent);
  },
  twin(b, floors, wall, accent, P) {
    const h = floors * MODULE_FLOOR;
    const bar = BODY_SIZE * 0.34;
    for (const [x, tone] of [[-BODY_SIZE * 0.3, 1], [BODY_SIZE * 0.3, 0.94]]) {
      b.at(x, 0, 0, 0, (c) => {
        c.box(0, 0, 0, bar, h, BODY_SIZE * 0.86, shade(wall, tone));
        windows(c, bar, BODY_SIZE * 0.86, 0, floors, P, MODULE_FLOOR);
      });
    }
    b.box(0, MODULE_FLOOR * Math.floor(floors * 0.6), 0, BODY_SIZE * 0.3, MODULE_FLOOR, 0.14, accent);
  },
  stepped(b, floors, wall, accent, P) {
    let y = 0;
    const scales = [1, 0.74, 0.5];
    steppedTiers(floors).forEach((count, index) => {
      const size = BODY_SIZE * 0.8 * scales[index];
      b.at(0, y, 0, 0, (c) => {
        c.box(0, 0, 0, size, count * MODULE_FLOOR, size, wall);
        windows(c, size, size, 0, count, P, MODULE_FLOOR);
      });
      y += count * MODULE_FLOOR;
      b.box(0, y, 0, size + 0.02, 0.012, size + 0.02, accent);
    });
  },
  drum(b, floors, wall, accent) {
    const r = BODY_SIZE * 0.36;
    for (let f = 0; f < floors; f += 1) {
      b.cylinder(0, f * MODULE_FLOOR, 0, r, r, MODULE_FLOOR * 0.86, 12, f % 2 === 0 ? wall : shade(wall, 0.88));
      b.cylinder(0, f * MODULE_FLOOR + MODULE_FLOOR * 0.86, 0, r + 0.012, r + 0.012, MODULE_FLOOR * 0.14, 12, accent);
    }
  },
};

const ROOFS = {
  plant(b, P) {
    const concrete = linear(P.wall.concrete);
    b.box(-0.12, 0, -0.06, 0.2, 0.06, 0.14, concrete);
    b.box(0.14, 0, 0.08, 0.12, 0.09, 0.12, shade(concrete, 0.9));
  },
  garden(b, P) {
    b.box(0, 0, 0, 0.42, 0.012, 0.28, linear(P.ground.lawn));
    tree(b, -0.1, 0, P, 0.55, 0.012);
    tree(b, 0.12, 0.04, P, 0.5, 0.012);
  },
  crown(b, P) {
    b.cylinder(0, 0, 0, 0.2, 0.1, 0.14, 8, linear(P.zones.commercial[3]));
    b.cylinder(0, 0.14, 0, 0.012, 0.004, 0.2, 4, linear(P.road.rail));
  },
};

const TONES = [
  (P) => wallOf(0, P),
  (P) => wallOf(1, P),
  (P) => wallOf(2, P),
  (P) => mix(linear(P.wall.glass), linear(P.wall.cool), 0.5),
];

/** 三角底座楼身之外的屋面：沿最长的斜边一条花池和一排树。 */
function terrace(b, points, P) {
  const { x0, z0, x1, z1, nx, nz } = edgesOf(points).reduce((best, edge) => (edge.length > best.length ? edge : best));
  const at = (t, out) => [x0 + (x1 - x0) * t - nx * out, z0 + (z1 - z0) * t - nz * out];
  const strip = [at(0.16, 0.08), at(0.84, 0.08), at(0.84, 0.32), at(0.16, 0.32)];
  b.poly(strip.map(([x, z]) => [x, MODULE_FLOOR + 0.006, z]), linear(P.ground.lawn));
  for (let i = 0; i < TERRACE_TREES; i += 1) {
    const [x, z] = at(0.22 + (i * 0.56) / (TERRACE_TREES - 1), 0.2);
    tree(b, x, z, P, 0.62, MODULE_FLOOR + 0.006);
  }
}

/** 地台和这块地上的底座楼形，都是相对物业中心的坐标。 */
function lotOf(b, size, q, P) {
  const color = linear(P.road.walk);
  if (size === '2x2') {
    plate(b, rectangle(0, 0, 1.9, 1.9), color);
    return rectangle(0, 0, SQUARE_PODIUM, SQUARE_PODIUM);
  }
  triangleLot(b, TRIANGLE_LEGS, q, color);
  const { toLocal } = triangleFrame(TRIANGLE_LEGS, q);
  return triangleBlock(TRIANGLE_LEGS).outer.map(([u, v]) => toLocal(u, v));
}

/**
 * 模块的名字：
 *   Mp-大小-方向-底座种类
 *   Mb-楼型-层数-色调
 *   Mr-屋顶种类
 */
export function buildModule(name, P) {
  const parts = name.split('-');
  const b = new Builder(hashString(name));
  if (parts[0] === 'Mp') {
    const [, size, q, kind] = parts;
    const points = lotOf(b, size, Number(q), P);
    PODIUMS[kind](b, points, P);
    if (size !== '2x2') terrace(b, points, P);
  } else if (parts[0] === 'Mb') {
    const [, kind, floors, tone] = parts;
    BODIES[kind](b, Number(floors), TONES[Number(tone)](P), linear(P.zones.commercial[Number(tone) % 4]), P);
  } else ROOFS[parts[1]](b, P);
  return b;
}
