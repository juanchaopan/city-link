import { Builder, hashString, linear, shade } from './builder.js';

// 公共设施的小物件：公共服务的图标牌、公交站和地铁站厅。
// 图标是立在空中的圆牌，平面朝着相机，颜色是公共服务专用色，普通物业不用这些颜色。
// 它只用于公共服务，运行时按缩放保持屏幕大小，全图时也认得出来。

const RIGHT = [Math.SQRT1_2, 0, -Math.SQRT1_2];
const UP_SCALE = 1 / Math.cos(Math.PI / 6);
const BADGE = 0.34;
const RING = 0.04;
const SIDES = 20;

/** 朝向相机的平面上的一点，u 向右，v 向上。 */
const onBadge = (u, v, depth = 0) => [
  RIGHT[0] * u + depth,
  v * UP_SCALE + depth,
  RIGHT[2] * u + depth,
];

function disc(b, radius, color, depth) {
  const points = [];
  for (let i = 0; i < SIDES; i += 1) {
    const a = (i / SIDES) * Math.PI * 2;
    points.push(onBadge(Math.cos(a) * radius, Math.sin(a) * radius, depth));
  }
  b.poly(points, color, [1, 0.4, 1]);
}

function shape(b, points, color) {
  b.poly(
    points.map(([u, v]) => onBadge(u * BADGE, v * BADGE, 0.02)),
    color,
    [1, 0.4, 1],
  );
}

const GLYPHS = {
  hospital(b, white) {
    shape(
      b,
      [
        [-0.14, -0.55],
        [0.14, -0.55],
        [0.14, 0.55],
        [-0.14, 0.55],
      ],
      white,
    );
    shape(
      b,
      [
        [-0.55, -0.14],
        [0.55, -0.14],
        [0.55, 0.14],
        [-0.55, 0.14],
      ],
      white,
    );
  },
  school(b, white) {
    shape(
      b,
      [
        [-0.55, 0.1],
        [0, 0.5],
        [0.55, 0.1],
        [0, -0.3],
      ],
      white,
    );
    shape(
      b,
      [
        [-0.3, -0.05],
        [0.3, -0.05],
        [0.3, -0.42],
        [-0.3, -0.42],
      ],
      white,
    );
  },
  police(b, white) {
    shape(
      b,
      [
        [-0.45, 0.5],
        [0.45, 0.5],
        [0.45, -0.05],
        [0, -0.58],
        [-0.45, -0.05],
      ],
      white,
    );
  },
  fire(b, white) {
    shape(
      b,
      [
        [0, 0.62],
        [0.42, -0.05],
        [0.26, -0.5],
        [-0.26, -0.5],
        [-0.42, -0.05],
      ],
      white,
    );
  },
  water(b, white) {
    shape(
      b,
      [
        [0, 0.62],
        [0.4, -0.05],
        [0.3, -0.42],
        [0, -0.55],
        [-0.3, -0.42],
        [-0.4, -0.05],
      ],
      white,
    );
  },
  power(b, white) {
    shape(
      b,
      [
        [0.12, 0.6],
        [-0.36, -0.08],
        [0.02, -0.08],
        [-0.12, -0.6],
        [0.36, 0.08],
        [-0.02, 0.08],
      ],
      white,
    );
  },
};

export function buildServiceIcon(use, P) {
  const b = new Builder(hashString(`icon${use}`));
  const color = linear(P.service[use]);
  disc(b, BADGE + RING, linear('#ffffff'), 0);
  disc(b, BADGE, color, 0.01);
  GLYPHS[use](b, linear('#ffffff'));
  return b;
}

/** 公交站：人行道上一块长条雨棚，两根立柱，一头一块站牌。dir 是车的行驶方向。 */
export function buildBusStop(dir, P) {
  const b = new Builder(hashString(`bus-stop${String(dir)}`));
  const steel = linear(P.wall.glassDark);
  const roof = linear(P.service.bus);
  const sign = linear('#ffffff');
  const rotation = (-dir * Math.PI) / 4;
  b.at(0, 0, 0, rotation, (c) => {
    c.box(-0.11, 0, 0, 0.012, 0.1, 0.012, steel);
    c.box(0.11, 0, 0, 0.012, 0.1, 0.012, steel);
    c.box(0, 0.1, 0, 0.3, 0.012, 0.07, roof);
    c.box(0.17, 0, 0, 0.014, 0.15, 0.014, steel);
    c.box(0.17, 0.13, 0, 0.05, 0.05, 0.012, sign);
  });
  return b;
}

/** 地铁站厅：占一格，玻璃雨棚下面是下行的楼梯，入口朝向 side 指的路。 */
export function buildMetroHall(side, P) {
  const b = new Builder(hashString(`metro-hall${String(side)}`));
  const paving = linear(P.road.walk);
  const glass = linear(P.wall.glass);
  const frame = linear(P.wall.glassDark);
  const sign = linear(P.service.metro);
  const white = linear('#ffffff');
  const rotation = (-side * Math.PI) / 2;
  b.box(0, 0, 0, 0.92, 0.012, 0.92, paving);
  b.at(0, 0.012, 0, rotation, (c) => {
    c.box(-0.08, 0, 0, 0.56, 0.2, 0.56, glass, { top: shade(frame, 1.1), pz: frame });
    c.box(-0.08, 0.2, 0, 0.62, 0.03, 0.62, sign);
    for (let i = 0; i < 4; i += 1) {
      c.box(
        0.22 + i * 0.045,
        0,
        0,
        0.045,
        0.02 + (3 - i) * 0.012,
        0.24,
        shade(paving, 0.9 - i * 0.05),
      );
    }
    c.box(0.3, 0, 0.34, 0.03, 0.34, 0.03, frame);
    c.box(0.3, 0.3, 0.34, 0.11, 0.11, 0.02, sign);
    c.box(0.3, 0.33, 0.352, 0.06, 0.05, 0.004, white);
  });
  return b;
}
