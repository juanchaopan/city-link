import { Builder, hashString, linear, mix, shade } from './builder.js';
import { plate, rectangle, tree, wallOf, windows } from './objects.js';
import { bodyOffset, steppedTiers } from '../sim/combos.js';

// 模块拼装实验。一栋楼不再烘焙成一整张图，而是底座（地块和底商）、楼身、屋顶三张精灵叠起来，运行时按组合取用。
// 大小：2x2 是两格见方的直角地块，Q3 是直角边 3 格的大三角地块，方向由底座决定，楼身和屋顶不分方向。

const MODULE_FLOOR = 1 / Math.sqrt(6) / 2;
const BODY_SIZE = 1.1;
const LOT_LIFT = 0.02;
const QUADRANTS = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
const TRIANGLE_LEGS = 3;

const PODIUMS = {
  /** 沿街底商：通长的玻璃橱窗和雨棚。 */
  shops(b, sx, sz, P) {
    const glass = linear(P.wall.glass);
    const accent = linear(P.zones.commercial[0]);
    b.box(0, LOT_LIFT, 0, sx, MODULE_FLOOR - LOT_LIFT, sz, linear(P.wall.warm));
    b.box(0, 0.03, sz / 2 + 0.002, sx - 0.08, MODULE_FLOOR - 0.06, 0.006, glass);
    b.box(sx / 2 + 0.002, 0.03, 0, 0.006, MODULE_FLOOR - 0.06, sz - 0.08, glass);
    b.box(0, MODULE_FLOOR - 0.03, sz / 2 + 0.03, sx, 0.016, 0.07, accent);
    b.box(sx / 2 + 0.03, MODULE_FLOOR - 0.03, 0, 0.07, 0.016, sz, accent);
  },
  /** 架空层：一圈柱子，楼像是站在柱子上。 */
  pilotis(b, sx, sz, P) {
    const concrete = linear(P.wall.concrete);
    b.box(0, LOT_LIFT, 0, sx * 0.5, MODULE_FLOOR - LOT_LIFT, sz * 0.5, shade(concrete, 0.7));
    const step = sx / 3;
    for (let i = 0; i <= 3; i += 1) {
      for (const [x, z] of [[-sx / 2 + i * step, sz / 2], [sx / 2, -sz / 2 + i * step], [-sx / 2 + i * step, -sz / 2], [-sx / 2, -sz / 2 + i * step]]) {
        b.box(x, LOT_LIFT, z, 0.05, MODULE_FLOOR - LOT_LIFT, 0.05, concrete);
      }
    }
  },
  /** 大堂：石材基座，正中一个玻璃门厅。 */
  lobby(b, sx, sz, P) {
    b.box(0, LOT_LIFT, 0, sx, MODULE_FLOOR - LOT_LIFT, sz, linear(P.wall.brick));
    b.box(0, 0.03, sz / 2 + 0.03, sx * 0.34, MODULE_FLOOR * 0.8, 0.06, linear(P.wall.glass));
    b.box(0, MODULE_FLOOR * 0.82, sz / 2 + 0.05, sx * 0.42, 0.018, 0.12, linear(P.wall.cool));
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

function triangleLot(b, q, P) {
  const [sx, sz] = QUADRANTS[q];
  const half = TRIANGLE_LEGS / 2;
  const toLocal = (u, v) => [-sx * half + sx * u, -sz * half + sz * v];
  plate(b, [toLocal(0.07, 0.07), toLocal(TRIANGLE_LEGS - 0.17, 0.07), toLocal(0.07, TRIANGLE_LEGS - 0.17)], linear(P.road.walk));
  for (let i = 0; i < 5; i += 1) {
    const t = (i + 0.7) / 6;
    const [x, z] = toLocal(2.7 * t + 0.03, 2.7 * (1 - t) + 0.03);
    tree(b, x, z, P, 0.7);
  }
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
    if (size === '2x2') plate(b, rectangle(0, 0, 1.9, 1.9), linear(P.road.walk));
    else triangleLot(b, Number(q), P);
    const [ox, oz] = bodyOffset(size, Number(q));
    b.at(ox, 0, oz, 0, (c) => PODIUMS[kind](c, 1.24, 1.24, P));
  } else if (parts[0] === 'Mb') {
    const [, kind, floors, tone] = parts;
    BODIES[kind](b, Number(floors), TONES[Number(tone)](P), linear(P.zones.commercial[Number(tone) % 4]), P);
  } else ROOFS[parts[1]](b, P);
  return b;
}
