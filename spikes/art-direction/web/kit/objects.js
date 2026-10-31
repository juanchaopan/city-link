import { Builder, hashString, linear, mix, shade } from './builder.js';
import { waterLevel } from './tiles.js';
import { QUADRANTS } from '../sim/combos.js';
import { polygonArea } from '../sim/network.js';

// 标准风格的建筑生成器。规格名字决定占地，这里决定外观。
// 一个地块是一个物业：楼、停车场、绿化画在同一张图里，看起来是设计好的一整套。

const FLOOR = 0.15;
const LOT_Y = 0.02;
const HALF_DIAGONAL = Math.SQRT1_2;
const LOT_SHRINK = 0.07;
const EDGE = 0.16;
const MIN_COURT = 0.5;
const STREET_WING = 2;
const ROW_HOUSE = 0.5;
const ROW_PITCH = 0.62;
const ROW_MIN_LEGS = 4;
const ROW_CORNER = ROW_HOUSE * 0.354;
const MAX_TOWER = 1.3;
const GREEN_ROOF_AREA = 2.5;

function pick(list, random) {
  return list[Math.floor(random() * list.length) % list.length];
}

/** 凸多边形的每条边和它朝外的单位法线。 */
export function edgesOf(points) {
  const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const cz = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  return points.map(([x0, z0], i) => {
    const [x1, z1] = points[(i + 1) % points.length];
    const length = Math.hypot(x1 - x0, z1 - z0);
    const flip = (x0 - cx) * (z1 - z0) + (z0 - cz) * (x0 - x1) < 0 ? -1 : 1;
    return {
      x0,
      z0,
      x1,
      z1,
      nx: (flip * (z1 - z0)) / length,
      nz: (flip * (x0 - x1)) / length,
      length,
    };
  });
}

/** 朝向相机的边。走向和视线平行的边是 0，这种墙在屏幕上只是一条线。 */
export function facesCamera({ nx, nz }) {
  return nx + nz > 0.01;
}

/** 多边形向自己的重心缩放，k 大于 1 时向外扩。 */
export function scaled(points, k) {
  const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const cz = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  return points.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k]);
}

export function plate(b, points, color) {
  b.poly(
    points.map(([x, z]) => [x, LOT_Y, z]),
    color,
  );
  for (const { x0, z0, x1, z1, nx, nz } of edgesOf(points)) {
    b.poly(
      [
        [x0, 0, z0],
        [x1, 0, z1],
        [x1, LOT_Y, z1],
        [x0, LOT_Y, z0],
      ],
      shade(color, 0.86),
      [nx, 0, nz],
    );
  }
}

export function rectangle(cx, cz, sx, sz) {
  return [
    [cx - sx / 2, cz - sz / 2],
    [cx + sx / 2, cz - sz / 2],
    [cx + sx / 2, cz + sz / 2],
    [cx - sx / 2, cz + sz / 2],
  ];
}

function flat(b, points, y, color) {
  b.poly(
    points.map(([x, z]) => [x, y, z]),
    color,
  );
}

function visibleX(b, sign) {
  const [dx, , dz] = b.direction([sign, 0, 0]);
  return dx + dz > 0.01;
}

function visibleZ(b, sign) {
  const [dx, , dz] = b.direction([0, 0, sign]);
  return dx + dz > 0.01;
}

function pane(b, points, normal, P, solidColor) {
  const lit = P.window.litRatio > 0 && b.random() < P.window.litRatio;
  if (P.window.layer || !lit) b.poly(points, solidColor ?? linear(P.window.day), normal);
  if (lit) b.poly(points, linear(P.window.lit), normal, true);
}

/** 四面开窗，只给朝向相机的面画，所以旋转 45° 的楼也能用同一个函数。 */
export function windows(b, sx, sz, y0, floors, P, spacing = FLOOR, size = 0.52, cell = 0.13) {
  const paneH = spacing * 0.5;
  for (const sign of [1, -1]) {
    if (visibleX(b, sign)) {
      const px = (sign * sx) / 2 + sign * 0.003;
      const columns = Math.max(1, Math.round(sz / cell));
      const w = (sz / columns) * size;
      for (let f = 0; f < floors; f += 1) {
        for (let c = 0; c < columns; c += 1) {
          const z = -sz / 2 + (sz / columns) * (c + 0.5);
          const y = y0 + spacing * (f + 0.3);
          pane(
            b,
            [
              [px, y, z - w / 2],
              [px, y, z + w / 2],
              [px, y + paneH, z + w / 2],
              [px, y + paneH, z - w / 2],
            ],
            [sign, 0, 0],
            P,
          );
        }
      }
    }
    if (visibleZ(b, sign)) {
      const pz = (sign * sz) / 2 + sign * 0.003;
      const columns = Math.max(1, Math.round(sx / cell));
      const w = (sx / columns) * size;
      for (let f = 0; f < floors; f += 1) {
        for (let c = 0; c < columns; c += 1) {
          const x = -sx / 2 + (sx / columns) * (c + 0.5);
          const y = y0 + spacing * (f + 0.3);
          pane(
            b,
            [
              [x - w / 2, y, pz],
              [x + w / 2, y, pz],
              [x + w / 2, y + paneH, pz],
              [x - w / 2, y + paneH, pz],
            ],
            [0, 0, sign],
            P,
          );
        }
      }
    }
  }
}

/** 沿一条任意走向的墙开窗。skip 是不开窗的底层数，底商的玻璃橱窗占着这几层。 */
function edgeWindows(b, edge, y0, floors, P, spacing, skip) {
  const { x0, z0, x1, z1, nx, nz, length } = edge;
  const columns = Math.max(1, Math.round(length / 0.16));
  const half = 0.26 / columns;
  const at = (t, y) => [x0 + (x1 - x0) * t + nx * 0.003, y, z0 + (z1 - z0) * t + nz * 0.003];
  for (let f = skip; f < floors; f += 1) {
    const y = y0 + spacing * (f + 0.3);
    const top = y + spacing * 0.5;
    for (let c = 0; c < columns; c += 1) {
      const t = (c + 0.5) / columns;
      pane(
        b,
        [at(t - half, y), at(t + half, y), at(t + half, top), at(t - half, top)],
        [nx, 0, nz],
        P,
      );
    }
  }
}

/** 凸多边形的楼身，地块是什么形状楼就是什么形状。朝相机的墙按楼层开窗，斜墙也一样。 */
export function prism(b, points, y0, floors, wall, roof, P, { spacing = FLOOR, skip = 0 } = {}) {
  const y1 = y0 + floors * spacing;
  b.poly(
    points.map(([x, z]) => [x, y1, z]),
    roof,
  );
  for (const edge of edgesOf(points)) {
    const { x0, z0, x1, z1, nx, nz } = edge;
    b.poly(
      [
        [x0, y0, z0],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z0],
      ],
      wall,
      [nx, 0, nz],
    );
    if (facesCamera(edge)) edgeWindows(b, edge, y0, floors, P, spacing, skip);
  }
}

/** 底层一圈玻璃橱窗和条纹雨棚，只画朝相机的边。 */
export function shopFront(b, points, y0, P, accent) {
  const glass = linear(P.wall.glass);
  const white = linear('#ffffff');
  for (const edge of edgesOf(points).filter(facesCamera)) {
    const { x0, z0, x1, z1, nx, nz, length } = edge;
    const at = (t, y, out) => [x0 + (x1 - x0) * t + nx * out, y, z0 + (z1 - z0) * t + nz * out];
    const inset = Math.min(0.03 / length, 0.2);
    b.poly(
      [
        at(inset, y0 + 0.012, 0.004),
        at(1 - inset, y0 + 0.012, 0.004),
        at(1 - inset, y0 + 0.1, 0.004),
        at(inset, y0 + 0.1, 0.004),
      ],
      glass,
      [nx, 0, nz],
    );
    const stripes = Math.max(4, Math.round(length / 0.09));
    for (let i = 0; i < stripes; i += 1) {
      const t0 = i / stripes;
      const t1 = (i + 1) / stripes;
      b.poly(
        [
          at(t0, y0 + 0.13, 0),
          at(t1, y0 + 0.13, 0),
          at(t1, y0 + 0.098, 0.07),
          at(t0, y0 + 0.098, 0.07),
        ],
        i % 2 === 0 ? accent : white,
        [nx, 1, nz],
      );
    }
  }
}

export function tree(b, x, z, P, scale = 1, y = LOT_Y) {
  const leaf = linear(pick(P.tree.leaf, b.random));
  const trunk = linear(P.tree.trunk);
  const h = (0.1 + b.random() * 0.05) * scale;
  b.cylinder(x, y, z, 0.018 * scale, 0.012 * scale, h, 5, trunk);
  const r = (0.09 + b.random() * 0.04) * scale;
  b.blob(x, y + h + r * 0.7, z, r, r * 1.1, r, leaf);
  if (b.random() < 0.6)
    b.blob(
      x + r * 0.5,
      y + h + r * 0.3,
      z + r * 0.4,
      r * 0.65,
      r * 0.65,
      r * 0.65,
      shade(leaf, 1.08),
    );
}

function pine(b, x, z, P, scale = 1) {
  const leaf = linear(pick(P.tree.pine, b.random));
  const trunk = linear(P.tree.trunk);
  b.cylinder(x, 0, z, 0.016 * scale, 0.012 * scale, 0.07 * scale, 5, trunk);
  for (let i = 0; i < 3; i += 1) {
    const r = (0.1 - i * 0.022) * scale;
    b.cylinder(x, (0.06 + i * 0.075) * scale, z, r, 0, 0.14 * scale, 6, shade(leaf, 1 + i * 0.07));
  }
}

function roofClutter(b, y, sx, sz, P) {
  const concrete = linear(P.wall.concrete);
  for (let i = 0; i < 3; i += 1) {
    const x = (b.random() - 0.5) * sx * 0.6;
    const z = (b.random() - 0.5) * sz * 0.6;
    b.box(
      x,
      y,
      z,
      0.06 + b.random() * 0.06,
      0.03 + b.random() * 0.04,
      0.06 + b.random() * 0.06,
      shade(concrete, 0.9 + b.random() * 0.15),
    );
  }
}

/** 停车场：沥青地面、白色车位线和几辆车。 */
function parking(b, cx, cz, sx, sz, P, along = 'x') {
  const asphalt = linear(P.road.yard);
  const line = linear(P.road.line);
  flat(b, rectangle(cx, cz, sx, sz), LOT_Y + 0.003, asphalt);
  const across = along === 'x' ? sx : sz;
  const bays = Math.max(2, Math.floor(across / 0.11));
  const pitch = across / bays;
  const other = along === 'x' ? sz : sx;
  const deep = other * 0.34;
  for (const row of [-1, 1]) {
    for (let i = 0; i <= bays; i += 1) {
      const t = -across / 2 + i * pitch;
      const u = row * (other / 2 - deep / 2);
      const [x, z, w, d] =
        along === 'x' ? [cx + t, cz + u, 0.007, deep] : [cx + u, cz + t, deep, 0.007];
      flat(b, rectangle(x, z, w, d), LOT_Y + 0.005, line);
      if (i < bays && b.random() < 0.4) {
        const color = linear(pick(P.cars, b.random));
        const [px, pz, carX, carZ] =
          along === 'x' ? [x + pitch / 2, z, 0.052, 0.098] : [x, z + pitch / 2, 0.098, 0.052];
        b.box(px, LOT_Y + 0.006, pz, carX, 0.022, carZ, color);
        b.box(px, LOT_Y + 0.028, pz, carX * 0.8, 0.014, carZ * 0.55, linear(P.window.day), {
          top: color,
        });
      }
    }
  }
}

function garden(b, cx, cz, sx, sz, P, trees = 3) {
  const lawn = shade(linear(P.ground.lawn), 1.04);
  flat(b, rectangle(cx, cz, sx, sz), LOT_Y + 0.002, lawn);
  flat(b, rectangle(cx, cz, sx * 0.08, sz), LOT_Y + 0.004, linear(P.road.walk));
  for (let i = 0; i < trees; i += 1) {
    tree(
      b,
      cx + (b.random() - 0.5) * sx * 0.8,
      cz + (b.random() - 0.5) * sz * 0.8,
      P,
      0.75 + b.random() * 0.3,
    );
  }
}

function yard(b, cx, cz, sx, sz, P) {
  flat(b, rectangle(cx, cz, sx, sz), LOT_Y + 0.003, linear(P.road.yard));
  const colors = [P.road.rail, P.zones.commercial[0], P.zones.commercial[3], P.zones.farm[2]];
  const count = Math.max(2, Math.floor((sx * sz) / 0.09));
  for (let i = 0; i < count; i += 1) {
    const x = cx + (b.random() - 0.5) * sx * 0.72;
    const z = cz + (b.random() - 0.5) * sz * 0.72;
    b.box(x, LOT_Y + 0.004, z, 0.16, 0.075, 0.075, linear(pick(colors, b.random)));
  }
}

function cottage(c, P, wall, roof, sx, sz, h, axis) {
  c.box(0, 0, 0, sx, h, sz, wall);
  c.gable(0, h, 0, sx, sz, 0.15, roof, wall, axis, 0.03);
  windows(c, sx, sz, 0.02, Math.max(1, Math.round(h / 0.11)), P, 0.11, 0.4, 0.17);
  c.box(sx * 0.2, h + 0.05, -sz * 0.1, 0.05, 0.13, 0.05, linear(P.wall.brick));
}

function houseAt(b, px, pz, index, P) {
  const wall = linear([P.wall.warm, P.wall.cool, P.wall.brick][index % 3]);
  const roof = linear(P.zones.residential[index % P.zones.residential.length]);
  const h = FLOOR * (index % 3 === 2 ? 2 : 1.35);
  b.at(px, LOT_Y, pz, 0, (c) =>
    cottage(c, P, wall, roof, 0.46, 0.4, h, index % 2 === 0 ? 'x' : 'z'),
  );
}

function houseGroup(b, sx, sz, P, seed) {
  const countX = Math.max(1, Math.round(sx / 0.95));
  const countZ = Math.max(1, Math.round(sz / 0.95));
  for (let j = 0; j < countZ; j += 1) {
    for (let i = 0; i < countX; i += 1) {
      const px = -sx / 2 + (sx / countX) * (i + 0.5) - 0.05;
      const pz = -sz / 2 + (sz / countZ) * (j + 0.5) - 0.05;
      houseAt(b, px, pz, seed + i * 3 + j * 5, P);
      tree(b, px + 0.33, pz + 0.3, P, 0.75);
    }
  }
}

export function slab(b, cx, cz, sx, sz, floors, wall, accent, P) {
  const h = floors * FLOOR;
  b.at(cx, LOT_Y, cz, 0, (c) => {
    c.box(0, 0, 0, sx, h, sz, wall, { top: shade(wall, 0.9) });
    windows(c, sx, sz, 0, floors, P);
    for (let f = 1; f < floors; f += 2)
      c.box(0, f * FLOOR - 0.008, 0, sx + 0.02, 0.012, sz + 0.02, accent);
    c.box(0, h, 0, sx + 0.024, 0.018, sz + 0.024, accent);
    roofClutter(c, h + 0.018, sx, sz, P);
  });
}

export function glassTower(b, cx, cz, sx, sz, floors, seed, P) {
  const glass = linear(P.wall.glass);
  const dark = linear(P.wall.glassDark);
  const frame = linear(seed % 2 === 0 ? P.wall.cool : P.wall.concrete);
  const accent = linear(P.zones.commercial[seed % P.zones.commercial.length]);
  b.at(cx, LOT_Y, cz, 0, (c) => {
    let y = 0;
    const tiers =
      seed % 2 === 0
        ? [
            [1, 0.35],
            [0.8, 0.45],
            [0.58, 0.2],
          ]
        : [[1, 1]];
    for (const [scale, share] of tiers) {
      const w = sx * scale;
      const d = sz * scale;
      const count = Math.max(2, Math.round(floors * share));
      const h = count * FLOOR * 0.82;
      c.box(0, y, 0, w, h, d, glass, { top: frame, px: dark, pz: glass });
      for (let f = 0; f <= count; f += 1)
        c.box(0, y + f * FLOOR * 0.82 - 0.005, 0, w + 0.006, 0.01, d + 0.006, frame);
      const pillars = 4;
      for (let i = 1; i < pillars; i += 1) {
        const t = -0.5 + i / pillars;
        c.box(w * t, y, 0, 0.012, h, d + 0.006, frame);
        c.box(0, y, d * t, w + 0.006, h, 0.012, frame);
      }
      windows(c, w, d, y, count, P, FLOOR * 0.82, 0.7, 0.16);
      y += h;
    }
    c.box(0, y, 0, sx * 0.3, 0.08, sz * 0.3, accent);
    c.cylinder(0, y + 0.08, 0, 0.012, 0.004, 0.24, 4, linear(P.road.rail));
  });
}

export function roundTower(b, cx, cz, r, floors, seed, P) {
  const glass = linear(P.wall.glass);
  const dark = linear(P.wall.glassDark);
  const frame = linear(P.wall.cool);
  let y = LOT_Y;
  b.cylinder(cx, y, cz, r + 0.06, r + 0.06, FLOOR, 10, frame);
  y += FLOOR;
  for (let f = 0; f < floors; f += 1) {
    const size = r - f * 0.006;
    b.cylinder(cx, y, cz, size, size, FLOOR * 0.68, 10, f % 2 === 0 ? glass : dark, frame);
    y += FLOOR * 0.68;
    b.cylinder(cx, y, cz, size + 0.008, size + 0.008, 0.012, 10, frame);
    y += 0.012;
  }
  b.cylinder(cx, y, cz, r * 0.5, 0, 0.1, 10, linear(P.zones.commercial[seed % 4]));
}

export function shopHall(b, cx, cz, sx, sz, floors, seed, P) {
  const wall = linear([P.wall.warm, P.wall.cool, P.wall.brick][seed % 3]);
  const accent = linear(P.zones.commercial[seed % P.zones.commercial.length]);
  const white = linear('#ffffff');
  const h = FLOOR * floors;
  b.at(cx, LOT_Y, cz, 0, (c) => {
    c.box(0, 0, 0, sx, h, sz, wall);
    const glass = linear(P.wall.glass);
    c.box(0, 0.005, sz / 2 - 0.002, sx - 0.06, 0.1, 0.008, glass);
    c.box(sx / 2 - 0.002, 0.005, 0, 0.008, 0.1, sz - 0.06, glass);
    const stripes = Math.max(4, Math.round(sx / 0.09));
    for (let i = 0; i < stripes; i += 1) {
      const color = i % 2 === 0 ? accent : white;
      const x0 = -sx / 2 + (sx / stripes) * i;
      const x1 = x0 + sx / stripes;
      c.poly(
        [
          [x0, 0.135, sz / 2],
          [x1, 0.135, sz / 2],
          [x1, 0.098, sz / 2 + 0.07],
          [x0, 0.098, sz / 2 + 0.07],
        ],
        color,
        [0, 1, 1],
      );
    }
    const rows = Math.max(4, Math.round(sz / 0.09));
    for (let i = 0; i < rows; i += 1) {
      const color = i % 2 === 0 ? accent : white;
      const z0 = -sz / 2 + (sz / rows) * i;
      const z1 = z0 + sz / rows;
      c.poly(
        [
          [sx / 2, 0.135, z0],
          [sx / 2, 0.135, z1],
          [sx / 2 + 0.07, 0.098, z1],
          [sx / 2 + 0.07, 0.098, z0],
        ],
        color,
        [1, 1, 0],
      );
    }
    if (floors > 1) windows(c, sx, sz, 0.17, floors - 1, P, FLOOR, 0.6, 0.15);
    c.box(0, h, 0, sx + 0.02, 0.02, sz + 0.02, shade(wall, 0.9));
    c.box(-sx * 0.1, h + 0.02, sz / 2 - 0.06, sx * 0.6, 0.1, 0.02, accent);
    roofClutter(c, h + 0.02, sx, sz * 0.6, P);
  });
}

function chimney(b, x, z, y, P) {
  const red = linear(P.road.rail);
  const white = linear('#f2f0ea');
  for (let i = 0; i < 4; i += 1) {
    b.cylinder(
      x,
      y + i * 0.13,
      z,
      0.055 - i * 0.005,
      0.05 - i * 0.005,
      0.13,
      7,
      i % 2 === 0 ? red : white,
    );
  }
}

function sawtooth(b, cx, cz, sx, sz, seed, P) {
  const wall = linear(P.zones.industrial[seed % P.zones.industrial.length]);
  const roof = linear(P.wall.concrete);
  const h = 0.2;
  b.at(cx, LOT_Y, cz, 0, (c) => {
    c.box(0, 0, 0, sx, h, sz, wall);
    const teeth = Math.max(2, Math.round(sx / 0.2));
    const width = sx / teeth;
    for (let i = 0; i < teeth; i += 1) {
      const x0 = -sx / 2 + width * i;
      const x1 = x0 + width;
      const rise = 0.09;
      c.poly(
        [
          [x0, h, -sz / 2],
          [x1, h + rise, -sz / 2],
          [x1, h + rise, sz / 2],
          [x0, h, sz / 2],
        ],
        roof,
        [-1, 2, 0],
      );
      c.poly(
        [
          [x1, h, -sz / 2],
          [x1, h + rise, -sz / 2],
          [x1, h + rise, sz / 2],
          [x1, h, sz / 2],
        ],
        linear(P.wall.glass),
        [1, 0, 0],
      );
      c.poly(
        [
          [x0, h, sz / 2],
          [x1, h, sz / 2],
          [x1, h + rise, sz / 2],
        ],
        wall,
        [0, 0, 1],
      );
    }
    windows(c, sx, sz, 0.04, 1, P, 0.18, 0.6, 0.18);
  });
  chimney(b, cx - sx * 0.4, cz - sz * 0.42, LOT_Y, P);
}

export function wallOf(seed, P) {
  return [
    linear(P.wall.warm),
    linear(P.wall.cool),
    mix(linear(P.wall.brick), linear(P.wall.warm), 0.5),
    linear(P.wall.concrete),
  ][seed % 4];
}

/** 大地块是一整套：楼在后面，前面朝路的一侧是停车场、庭院或堆场。 */
function composeRect(b, sx, sz, zone, level, seed, P) {
  const wide = sx >= sz;
  const large = sx * sz >= 1.5;
  const share = large ? 0.62 : 1;
  const bodyX = wide ? sx * share : sx;
  const bodyZ = wide ? sz : sz * share;
  const offsetX = wide ? -(sx - bodyX) / 2 : 0;
  const offsetZ = wide ? 0 : -(sz - bodyZ) / 2;
  const restX = wide ? sx - bodyX : sx;
  const restZ = wide ? sz : sz - bodyZ;
  const restCX = wide ? sx / 2 - restX / 2 : 0;
  const restCZ = wide ? 0 : sz / 2 - restZ / 2;
  const inset = 0.06;
  const w = bodyX - inset * 2;
  const d = bodyZ - inset * 2;
  if (zone === 'r') {
    if (level === 1) houseGroup(b, sx, sz, P, seed);
    else {
      const accent = linear(P.zones.residential[seed % P.zones.residential.length]);
      slab(
        b,
        offsetX,
        offsetZ,
        Math.max(0.4, w * 0.86),
        Math.max(0.4, d * 0.86),
        level === 2 ? 4 + (seed % 3) : 9 + (seed % 3) * 2,
        wallOf(seed, P),
        accent,
        P,
      );
    }
  } else if (zone === 'c') {
    if (level === 3) {
      if (seed % 3 === 2)
        roundTower(b, offsetX, offsetZ, Math.min(w, d) * 0.42, 12 + (seed % 4), seed, P);
      else glassTower(b, offsetX, offsetZ, w * 0.8, d * 0.8, 12 + (seed % 3) * 3, seed, P);
    } else shopHall(b, offsetX, offsetZ, w, d, level === 1 ? 2 : 3, seed, P);
  } else sawtooth(b, offsetX, offsetZ, w, d, seed, P);
  if (!large) {
    if (zone !== 'r' || level !== 1) tree(b, sx / 2 - 0.1, sz / 2 - 0.1, P, 0.6);
    return;
  }
  if (zone === 'r' && level === 1) return;
  const pad = 0.04;
  if (zone === 'i') yard(b, restCX, restCZ, restX - pad, restZ - pad, P);
  else if (zone === 'c') parking(b, restCX, restCZ, restX - pad, restZ - pad, P, wide ? 'z' : 'x');
  else garden(b, restCX, restCZ, restX - pad, restZ - pad, P, 3 + Math.floor(restX * restZ * 4));
}

function propertyB(b, name, P) {
  const [, zoneLevel, size, orient, variant] = name.split('-');
  const zone = zoneLevel[0];
  const level = Number(zoneLevel[1]);
  const [spanU, spanV] = size.split('x').map(Number);
  const seed = (hashString(name) % 97) + Number(variant);
  const lotColor = linear(zone === 'r' ? P.ground.lawn : zone === 'c' ? P.road.walk : P.road.yard);
  const unit = orient === 'a' ? 1 : HALF_DIAGONAL;
  const sx = spanU * unit - 0.1;
  const sz = spanV * unit - 0.1;
  const rotation = orient === 'a' ? 0 : -Math.PI / 4;
  b.at(0, 0, 0, rotation, (c) => {
    plate(c, rectangle(0, 0, sx, sz), lotColor);
    composeRect(c, sx - 0.04, sz - 0.04, zone, level, seed, P);
  });
}

/** 大三角地块的局部坐标：u、v 从直角顶点沿两条直角边量起。 */
export function triangleFrame(legs, q) {
  const [sx, sz] = QUADRANTS[q];
  const half = legs / 2;
  return { sx, sz, toLocal: (u, v) => [-sx * half + sx * u, -sz * half + sz * v] };
}

function triangleOutline(legs, q) {
  const { toLocal } = triangleFrame(legs, q);
  const far = legs - LOT_SHRINK * 2.4;
  return [toLocal(LOT_SHRINK, LOT_SHRINK), toLocal(far, LOT_SHRINK), toLocal(LOT_SHRINK, far)];
}

/** 三角地块的地台。 */
export function triangleLot(b, legs, q, color) {
  plate(b, triangleOutline(legs, q), color);
}

/**
 * 大三角地块上的楼形，都是 u、v 坐标。outer 是贴着三条边的整块楼形；地块够大时再切成三翼，
 * 中间留一个院子，wings 依次是两条直角边和斜边上的一翼。院子太小时只用 outer，不留一条缝。
 */
export function triangleBlock(legs) {
  const wing = Math.max(0.5, legs * 0.2);
  const slope = legs - EDGE * Math.SQRT2;
  const outer = [
    [EDGE, EDGE],
    [slope - EDGE, EDGE],
    [EDGE, slope - EDGE],
  ];
  const near = EDGE + wing;
  const far = slope - wing * Math.SQRT2 - near;
  const inradius = (slope - 2 * EDGE) * (1 - Math.SQRT1_2);
  const shape = { wing, slope, outer, inradius, incenter: EDGE + inradius };
  if (far - near < MIN_COURT) return { ...shape, court: null, wings: [outer] };
  const [ca, cb, cc] = [
    [near, near],
    [far, near],
    [near, far],
  ];
  const [oa, ob, oc] = outer;
  return {
    ...shape,
    court: [ca, cb, cc],
    wings: [
      [oa, ob, cb, ca],
      [oa, ca, cc, oc],
      [ob, oc, cc, cb],
    ],
  };
}

/** 多边形里随机取几个点，先按扇形分块再取，三角形和四边形都能用。 */
function scatter(b, points, count) {
  const [ax, az] = points[0];
  const spots = [];
  for (let i = 0; i < count; i += 1) {
    const fan = 1 + Math.floor(b.random() * (points.length - 2));
    const [cx, cz] = points[fan];
    const [dx, dz] = points[fan + 1];
    const r0 = Math.sqrt(b.random());
    const r1 = b.random();
    spots.push([
      ax * (1 - r0) + cx * r0 * (1 - r1) + dx * r0 * r1,
      az * (1 - r0) + cz * r0 * (1 - r1) + dz * r0 * r1,
    ]);
  }
  return spots;
}

/** 楼顶一圈压顶，是环形的，屋面本身露在中间。 */
function parapet(b, points, y, accent) {
  const inner = scaled(points, 0.96);
  const top = y + 0.016;
  edgesOf(points).forEach(({ x0, z0, x1, z1, nx, nz }, i) => {
    const j = (i + 1) % points.length;
    b.poly(
      [
        [x0, top, z0],
        [x1, top, z1],
        [inner[j][0], top, inner[j][1]],
        [inner[i][0], top, inner[i][1]],
      ],
      accent,
    );
    b.poly(
      [
        [x0, y, z0],
        [x1, y, z1],
        [x1, top, z1],
        [x0, top, z0],
      ],
      shade(accent, 0.9),
      [nx, 0, nz],
    );
  });
}

/** 屋面上的设备箱，面积够大时中间还有一块屋顶花园。 */
function roofTop(b, points, y, P) {
  const inner = scaled(points, 0.8);
  const area = polygonArea(points);
  const concrete = linear(P.wall.concrete);
  if (area >= GREEN_ROOF_AREA) {
    const patch = scaled(points, 0.5);
    flat(b, patch, y + 0.004, linear(P.ground.lawn));
    for (const [x, z] of scatter(b, patch, 2 + Math.floor(area / 3)))
      tree(b, x, z, P, 0.6, y + 0.004);
  }
  for (const [x, z] of scatter(b, inner, Math.min(10, 2 + Math.floor(area)))) {
    b.box(
      x,
      y,
      z,
      0.06 + b.random() * 0.06,
      0.03 + b.random() * 0.04,
      0.06 + b.random() * 0.06,
      shade(concrete, 0.9 + b.random() * 0.15),
    );
  }
}

function wingBlock(b, points, y0, floors, wall, accent, P, skip = 0) {
  const top = y0 + floors * FLOOR;
  prism(b, points, y0, floors, wall, shade(wall, 0.9), P, { skip });
  parapet(b, points, top, accent);
  roofTop(b, points, top, P);
}

/** 整块的楼：下面占满楼形，上面几层退台。 */
function terraced(b, points, low, high, wall, accent, P, skip = 0) {
  if (high === low) {
    wingBlock(b, points, LOT_Y, low, wall, accent, P, skip);
    return;
  }
  prism(b, points, LOT_Y, low, wall, shade(wall, 0.9), P, { skip });
  parapet(b, points, LOT_Y + low * FLOOR, accent);
  wingBlock(b, scaled(points, 0.62), LOT_Y + low * FLOOR, high - low, shade(wall, 0.96), accent, P);
}

/** 院子。住宅是草地和树，商业是停车场，工业是堆场。 */
function courtyard(b, points, zone, P) {
  flat(b, points, LOT_Y + 0.003, linear(zone === 'r' ? P.ground.lawn : P.road.yard));
  const colors = [P.road.rail, P.zones.commercial[0], P.zones.commercial[3], P.zones.farm[2]];
  for (const [x, z] of scatter(
    b,
    scaled(points, 0.72),
    Math.max(2, Math.floor(polygonArea(points) * 3)),
  )) {
    if (zone === 'r') tree(b, x, z, P, 0.8);
    else if (zone === 'c') {
      const color = linear(pick(P.cars, b.random));
      b.box(x, LOT_Y + 0.006, z, 0.098, 0.022, 0.052, color);
      b.box(x, LOT_Y + 0.028, z, 0.055, 0.014, 0.042, linear(P.window.day), { top: color });
    } else b.box(x, LOT_Y + 0.004, z, 0.16, 0.075, 0.075, linear(pick(colors, b.random)));
  }
}

/**
 * 低密度住宅：连排的小楼一行行平行于斜边，地块多大就摆多少行，每行均分这一行的长度，两头都顶到地块的尖角。
 * 斜行排到头后直角一角还剩一块方地，放一栋正向的房子，这个角就不空着。
 */
function terraceRows(lot) {
  const { b, plan, sx, sz, toLocal, seed, P } = lot;
  const rotation = Math.atan2(sz, sx);
  const clearance = EDGE + ROW_CORNER;
  const house = (x, z, index, turn) => {
    const wall = linear([P.wall.warm, P.wall.cool, P.wall.brick][index % 3]);
    const roof = linear(P.zones.residential[index % P.zones.residential.length]);
    b.at(x, LOT_Y, z, turn, (c) =>
      cottage(c, P, wall, roof, ROW_HOUSE, ROW_HOUSE * 0.96, FLOOR * 1.6, 'z'),
    );
  };
  let line = plan.slope - (ROW_HOUSE / 2) * Math.SQRT2;
  let row = 0;
  let last = line;
  while ((line - 2 * clearance) * Math.SQRT2 >= ROW_HOUSE) {
    const span = (line - 2 * clearance) * Math.SQRT2;
    const count = Math.floor(span / ROW_HOUSE);
    const pitch = span / count;
    for (let i = 0; i < count; i += 1) {
      const along = ((i + 0.5 - count / 2) * pitch) / Math.SQRT2;
      const [x, z] = toLocal(line / 2 + along, line / 2 - along);
      house(x, z, seed + row + i, rotation);
    }
    last = line;
    line -= ROW_PITCH * Math.SQRT2;
    row += 1;
  }
  if (last - ROW_CORNER * Math.SQRT2 >= 2 * (EDGE + ROW_HOUSE)) {
    const middle = EDGE + ROW_HOUSE / 2;
    const [x, z] = toLocal(middle, middle);
    house(x, z, seed + row, 0);
  }
}

/** 住宅是连体的院落楼。变体 0 沿斜边的一翼加高，变体 1 在直角一角起一座塔。 */
function residentialBlock(lot) {
  const { b, plan, legs, place, level, variant, seed, P } = lot;
  if (level === 1 && variant === 0 && legs >= ROW_MIN_LEGS) {
    terraceRows(lot);
    return;
  }
  const low = [2, 4 + (seed % 2), 6 + (seed % 3)][level - 1];
  const high = low + [0, 2, 5][level - 1];
  const wall = wallOf(seed, P);
  const accent = linear(P.zones.residential[seed % 4]);
  if (!plan.court) {
    terraced(b, place(plan.outer), low, high, wall, accent, P);
    return;
  }
  plan.wings.forEach((wing, index) => {
    const top = variant === 0 && index === STREET_WING ? high : low;
    terraced(b, place(wing), low, top, shade(wall, 1 - index * 0.03), accent, P);
  });
  courtyard(b, place(plan.court), 'r', P);
  if (variant === 1 && high > low) {
    const near = EDGE + plan.wing;
    const corner = [
      [EDGE, EDGE],
      [near, EDGE],
      [near, near],
      [EDGE, near],
    ];
    wingBlock(b, place(corner), LOT_Y + low * FLOOR, high - low + 3, shade(wall, 0.96), accent, P);
  }
}

/** 高层商业的塔楼站在裙房顶上，塔身放在三角形的内切圆里，大地块沿斜边站两座。 */
function towersOn(lot, y) {
  const { b, plan, legs, toLocal, variant, seed, P } = lot;
  const side = Math.min(MAX_TOWER, plan.inradius * 1.3);
  const twin = legs >= 4;
  const shift = legs * 0.12;
  for (const sign of twin ? [-1, 1] : [0]) {
    const [x, z] = toLocal(plan.incenter + sign * shift, plan.incenter - sign * shift);
    const floors = 11 + ((seed + sign + 1) % 6);
    b.at(0, y, 0, 0, (c) => {
      if (variant === 1 && !twin) roundTower(c, x, z, side * 0.46, floors, seed, P);
      else glassTower(c, x, z, side, side, floors, seed, P);
    });
  }
}

/** 商业是占满地块的裙房，沿街一圈底商。变体 1 中间留一个停车院，地块太小时留不出院子就还是整块。 */
function commercialBlock(lot) {
  const { b, plan, place, level, variant, seed, P } = lot;
  const wall = wallOf(seed, P);
  const accent = linear(P.zones.commercial[seed % P.zones.commercial.length]);
  const low = [2, 2, 3][level - 1];
  const high = [2, 3, 3][level - 1];
  if (variant === 1 && plan.court) {
    for (const wing of plan.wings) {
      wingBlock(b, place(wing), LOT_Y, high, wall, accent, P, 1);
      shopFront(b, place(wing), LOT_Y, P, accent);
    }
    courtyard(b, place(plan.court), 'c', P);
  } else {
    terraced(b, place(plan.outer), low, high, wall, accent, P, 1);
    shopFront(b, place(plan.outer), LOT_Y, P, accent);
  }
  if (level === 3) towersOn(lot, high * FLOOR);
}

/** 厂房的锯齿屋顶，一排排铺满楼形。屋脊总在世界 +z 一侧，玻璃才朝着相机。 */
function sawRoof(lot, y) {
  const { b, plan, sz, toLocal, P } = lot;
  const roof = linear(P.wall.concrete);
  const glass = linear(P.wall.glass);
  const pitch = 0.34;
  const rise = 0.075;
  const start = EDGE + 0.03;
  const point = (u, v, h) => {
    const [x, z] = toLocal(u, v);
    return [x, h, z];
  };
  for (let v = start; ; v += pitch) {
    const end = plan.slope - v - pitch - 0.03;
    if (end - start < 0.2) return;
    const [ridge, valley] = sz > 0 ? [v + pitch, v] : [v, v + pitch];
    b.poly(
      [
        point(start, ridge, y + rise),
        point(end, ridge, y + rise),
        point(end, valley, y),
        point(start, valley, y),
      ],
      roof,
    );
    b.poly(
      [
        point(start, ridge, y),
        point(end, ridge, y),
        point(end, ridge, y + rise),
        point(start, ridge, y + rise),
      ],
      glass,
      [0, 0, 1],
    );
  }
}

/** 工业是占满地块的厂房。变体 1 留出堆场，天窗开在三翼的屋顶上。 */
function industrialBlock(lot) {
  const { b, plan, place, toLocal, variant, seed, P } = lot;
  const wall = linear(P.zones.industrial[seed % P.zones.industrial.length]);
  const roof = linear(P.wall.concrete);
  const floors = 2;
  const top = LOT_Y + floors * FLOOR;
  const open = variant === 1 && plan.court;
  for (const part of open ? plan.wings : [plan.outer]) {
    prism(b, place(part), LOT_Y, floors, wall, roof, P, { skip: 1 });
    if (open) flat(b, scaled(place(part), 0.6), top + 0.002, linear(P.wall.glass));
  }
  if (open) courtyard(b, place(plan.court), 'i', P);
  else sawRoof(lot, top);
  const [x, z] = toLocal(EDGE + 0.14, EDGE + 0.14);
  chimney(b, x, z, top, P);
}

const TRIANGLE_MASSES = { r: residentialBlock, c: commercialBlock, i: industrialBlock };

/** 大三角形物业。楼形就是地块的形状：三翼连体围出院子，或者整块裙房，容量由规格决定，这里只管外观。 */
function propertyQ(b, name, P) {
  const [, zoneLevel, legsText, orient, variantText] = name.split('-');
  const zone = zoneLevel[0];
  const legs = Number(legsText);
  const variant = Number(variantText);
  const { sx, sz, toLocal } = triangleFrame(legs, Number(orient));
  triangleLot(
    b,
    legs,
    Number(orient),
    linear(zone === 'r' ? P.ground.lawn : zone === 'c' ? P.road.walk : P.road.yard),
  );
  TRIANGLE_MASSES[zone]({
    b,
    P,
    sx,
    sz,
    legs,
    toLocal,
    variant,
    level: Number(zoneLevel[1]),
    seed: (hashString(name) % 97) + variant,
    plan: triangleBlock(legs),
    place: (points) => points.map(([u, v]) => toLocal(u, v)),
  });
}

function lotFor(b, sx, sz, color) {
  plate(b, rectangle(0, 0, sx, sz), color);
}

function serviceHospital(b, sx, sz, P) {
  lotFor(b, sx, sz, linear(P.road.walk));
  const wall = linear('#f7f7f4');
  const accent = linear(P.service.hospital);
  const bx = sx * 0.62;
  const bz = sz * 0.5;
  const h = FLOOR * 5;
  b.at(-sx * 0.14, LOT_Y, -sz * 0.18, 0, (c) => {
    c.box(0, 0, 0, bx, h, bz, wall);
    windows(c, bx, bz, 0, 5, P);
    c.box(0, 0, bz / 2 + 0.01, bx * 0.34, FLOOR * 1.4, 0.05, accent);
    c.box(0, h, 0, bx + 0.02, 0.018, bz + 0.02, accent);
    const size = Math.min(bx, bz) * 0.3;
    c.box(0, h + 0.018, 0, size, 0.012, size * 0.32, linear('#ffffff'));
    c.box(0, h + 0.03, 0, size, 0.006, size * 0.32, accent);
    c.box(0, h + 0.03, 0, size * 0.32, 0.006, size, accent);
  });
  parking(b, sx * 0.3, sz * 0.18, sx * 0.34, sz * 0.5, P, 'z');
  garden(b, -sx * 0.14, sz * 0.32, sx * 0.62, sz * 0.26, P, 3);
}

function serviceSchool(b, sx, sz, P) {
  lotFor(b, sx, sz, linear(P.ground.lawn));
  const wall = linear(P.wall.warm);
  const roof = linear(P.service.school);
  const bx = sx * 0.34;
  const bz = sz * 0.84;
  b.at(-sx * 0.28, LOT_Y, 0, 0, (c) => {
    c.box(0, 0, 0, bx, FLOOR * 3, bz, wall);
    windows(c, bx, bz, 0, 3, P);
    c.gable(0, FLOOR * 3, 0, bx, bz, 0.12, roof, wall, 'z', 0.02);
  });
  const trackX = sx * 0.52;
  const trackZ = sz * 0.76;
  const cx = sx * 0.2;
  flat(b, rectangle(cx, 0, trackX, trackZ), LOT_Y + 0.003, linear(P.service.track));
  flat(b, rectangle(cx, 0, trackX * 0.68, trackZ * 0.68), LOT_Y + 0.005, linear(P.ground.lawn));
  flat(b, rectangle(cx, 0, 0.01, trackZ * 0.68), LOT_Y + 0.007, linear('#ffffff'));
}

function servicePolice(b, sx, sz, P) {
  lotFor(b, sx, sz, linear(P.road.yard));
  const wall = linear(P.wall.cool);
  const stripe = linear(P.service.police);
  const bx = sx * 0.72;
  const bz = sz * 0.5;
  b.at(0, LOT_Y, -sz * 0.18, 0, (c) => {
    c.box(0, 0, 0, bx, FLOOR * 3, bz, wall);
    windows(c, bx, bz, 0.02, 3, P);
    c.box(0, FLOOR * 3, 0, bx + 0.02, 0.03, bz + 0.02, stripe);
    c.box(0, FLOOR * 1.9, 0, bx + 0.012, 0.024, bz + 0.012, stripe);
  });
  for (const offset of [-0.2, 0, 0.2]) {
    const x = offset * sx;
    b.box(x, LOT_Y + 0.004, sz * 0.26, 0.09, 0.024, 0.18, linear('#ffffff'));
    b.box(x, LOT_Y + 0.028, sz * 0.26, 0.08, 0.016, 0.09, stripe);
  }
}

function serviceFire(b, sx, sz, P) {
  lotFor(b, sx, sz, linear(P.road.yard));
  const red = linear(P.service.fire);
  const wall = linear(P.wall.warm);
  const bx = sx * 0.76;
  const bz = sz * 0.54;
  b.at(-sx * 0.04, LOT_Y, -sz * 0.14, 0, (c) => {
    c.box(0, 0, 0, bx, FLOOR * 2.4, bz, wall);
    c.box(0, FLOOR * 2.4, 0, bx + 0.02, 0.024, bz + 0.02, red);
    const doors = Math.max(2, Math.round(bx / 0.2));
    for (let i = 0; i < doors; i += 1) {
      const x = -bx / 2 + (bx / doors) * (i + 0.5);
      c.poly(
        [
          [x - 0.07, 0.002, bz / 2 + 0.003],
          [x + 0.07, 0.002, bz / 2 + 0.003],
          [x + 0.07, 0.17, bz / 2 + 0.003],
          [x - 0.07, 0.17, bz / 2 + 0.003],
        ],
        red,
        [0, 0, 1],
      );
    }
    windows(c, bx, bz, 0.2, 1, P, FLOOR, 0.5, 0.2);
  });
  b.at(sx * 0.36, LOT_Y, -sz * 0.34, 0, (c) => {
    c.box(0, 0, 0, 0.13, 0.62, 0.13, wall, { top: red });
    windows(c, 0.13, 0.13, 0.1, 3, P, 0.17, 0.5, 0.13);
  });
  b.box(0, LOT_Y + 0.004, sz * 0.33, 0.28, 0.06, 0.1, red, { top: shade(red, 1.12) });
}

function serviceWater(b, sx, sz, P) {
  lotFor(b, sx, sz, linear(P.ground.lawn));
  const concrete = linear(P.wall.concrete);
  const water = linear(P.water.mid);
  const r = Math.min(sx, sz) * 0.2;
  for (const [x, z] of [
    [-0.27, -0.25],
    [0.2, -0.25],
    [-0.27, 0.22],
  ]) {
    b.cylinder(x * sx, LOT_Y, z * sz, r, r, 0.07, 12, concrete, water);
    b.box(x * sx, LOT_Y + 0.072, z * sz, r * 1.7, 0.012, 0.014, linear(P.wall.cool));
  }
  b.at(sx * 0.22, LOT_Y, sz * 0.24, 0, (c) => {
    c.box(0, 0, 0, sx * 0.34, FLOOR * 1.6, sz * 0.3, linear(P.wall.cool));
    windows(c, sx * 0.34, sz * 0.3, 0.02, 2, P);
    c.box(0, FLOOR * 1.6, 0, sx * 0.34 + 0.02, 0.02, sz * 0.3 + 0.02, linear(P.service.water));
  });
}

function servicePower(b, sx, sz, P) {
  lotFor(b, sx, sz, linear(P.road.yard));
  const concrete = linear(P.wall.concrete);
  const r = Math.min(sx, sz) * 0.21;
  for (const [x, z] of [
    [-0.25, -0.26],
    [0.2, -0.26],
  ]) {
    b.cylinder(x * sx, LOT_Y, z * sz, r, r * 0.68, 0.34, 12, concrete, shade(concrete, 0.5));
    b.cylinder(
      x * sx,
      LOT_Y + 0.34,
      z * sz,
      r * 0.68,
      r * 0.8,
      0.12,
      12,
      shade(concrete, 1.04),
      shade(concrete, 0.5),
    );
  }
  b.at(-sx * 0.1, LOT_Y, sz * 0.26, 0, (c) => {
    c.box(0, 0, 0, sx * 0.6, FLOOR * 2, sz * 0.3, linear(P.wall.cool));
    windows(c, sx * 0.6, sz * 0.3, 0.03, 2, P);
    c.box(0, FLOOR * 2, 0, sx * 0.6 + 0.02, 0.02, sz * 0.3 + 0.02, linear(P.service.power));
  });
  const red = linear(P.road.rail);
  for (let i = 0; i < 4; i += 1) {
    b.cylinder(
      sx * 0.38,
      LOT_Y + i * 0.14,
      sz * 0.3,
      0.045,
      0.04,
      0.14,
      7,
      i % 2 === 0 ? red : linear('#f2f0ea'),
    );
  }
}

const SERVICE_BUILDERS = {
  hospital: serviceHospital,
  school: serviceSchool,
  police: servicePolice,
  fire: serviceFire,
  water: serviceWater,
  power: servicePower,
};

function publicLand(b, use, sx, sz, P) {
  if (use === 'plaza') {
    lotFor(b, sx, sz, linear(P.road.walk));
    const step = 0.2;
    for (let x = -sx / 2 + step; x < sx / 2; x += step)
      flat(b, rectangle(x, 0, 0.006, sz), LOT_Y + 0.002, linear(P.wall.concrete));
    for (let z = -sz / 2 + step; z < sz / 2; z += step)
      flat(b, rectangle(0, z, sx, 0.006), LOT_Y + 0.002, linear(P.wall.concrete));
    b.cylinder(0, LOT_Y, 0, 0.16, 0.16, 0.035, 10, linear(P.wall.concrete), linear(P.water.mid));
    b.cylinder(0, LOT_Y + 0.03, 0, 0.02, 0.012, 0.11, 6, linear(P.wall.cool));
    for (const [x, z] of [
      [-0.32, -0.32],
      [0.32, -0.32],
      [-0.32, 0.32],
      [0.32, 0.32],
    ])
      tree(b, x * sx, z * sz, P, 0.7);
  } else {
    lotFor(b, sx, sz, linear(P.ground.lawn));
    flat(b, rectangle(0, 0, sx, 0.07), LOT_Y + 0.003, linear(P.road.walk));
    flat(b, rectangle(0, 0, 0.07, sz), LOT_Y + 0.003, linear(P.road.walk));
    const count = 3 + Math.floor(sx * sz * 3);
    for (let i = 0; i < count; i += 1) {
      const x = (b.random() - 0.5) * sx * 0.86;
      const z = (b.random() - 0.5) * sz * 0.86;
      if (Math.abs(x) > 0.07 && Math.abs(z) > 0.07) tree(b, x, z, P, 0.8 + b.random() * 0.4);
    }
  }
}

/** 收边的小品。这些都不是建筑：没有容量，也没有出入口，只是让边角不空着。 */
const SMALL_FEATURES = {
  flower(b, x, z, P) {
    const colors = [P.tree.autumn, P.zones.residential[0], '#ffffff', P.zones.residential[3]];
    for (let i = 0; i < 9; i += 1) {
      const px = x + (b.random() - 0.5) * 0.3;
      const pz = z + (b.random() - 0.5) * 0.24;
      b.blob(px, LOT_Y + 0.014, pz, 0.026, 0.02, 0.026, linear(colors[i % colors.length]));
    }
  },
  bench(b, x, z, P) {
    const wood = linear(P.wood);
    for (const offset of [-0.09, 0.09]) {
      b.box(x + offset, LOT_Y, z, 0.13, 0.03, 0.05, wood);
      b.box(x + offset, LOT_Y + 0.03, z - 0.022, 0.13, 0.034, 0.008, shade(wood, 0.86));
    }
    b.cylinder(x + 0.2, LOT_Y, z - 0.03, 0.012, 0.01, 0.11, 5, linear(P.wall.concrete));
    b.blob(x + 0.2, LOT_Y + 0.125, z - 0.03, 0.022, 0.022, 0.022, linear(P.window.lit));
  },
  pond(b, x, z, P) {
    b.cylinder(x, LOT_Y, z, 0.17, 0.16, 0.012, 9, linear(P.wall.concrete), linear(P.water.mid));
    b.blob(x + 0.06, LOT_Y + 0.016, z - 0.03, 0.03, 0.008, 0.024, linear(P.tree.leaf[1]));
    b.blob(x - 0.07, LOT_Y + 0.016, z + 0.05, 0.022, 0.008, 0.02, linear(P.tree.leaf[0]));
  },
  statue(b, x, z, P) {
    b.box(x, LOT_Y, z, 0.14, 0.05, 0.14, linear(P.wall.concrete));
    b.box(x, LOT_Y + 0.05, z, 0.09, 0.04, 0.09, shade(linear(P.wall.concrete), 0.92));
    b.cylinder(x, LOT_Y + 0.09, z, 0.03, 0.018, 0.11, 6, linear(P.wall.glassDark));
    b.blob(x, LOT_Y + 0.215, z, 0.024, 0.024, 0.024, linear(P.wall.glassDark));
  },
  rocks(b, x, z, P) {
    const stone = linear(P.wall.concrete);
    b.blob(x - 0.06, LOT_Y + 0.03, z, 0.075, 0.05, 0.06, stone);
    b.blob(x + 0.07, LOT_Y + 0.02, z + 0.04, 0.05, 0.034, 0.05, shade(stone, 0.9));
    b.blob(x + 0.02, LOT_Y + 0.02, z - 0.07, 0.04, 0.028, 0.04, shade(stone, 1.06));
    tree(b, x + 0.14, z - 0.1, P, 0.5);
  },
  pavilion(b, x, z, P) {
    const wood = linear(P.wood);
    for (const [dx, dz] of [
      [-0.09, -0.09],
      [0.09, -0.09],
      [0.09, 0.09],
      [-0.09, 0.09],
    ]) {
      b.box(x + dx, LOT_Y, z + dz, 0.014, 0.12, 0.014, wood);
    }
    b.cylinder(x, LOT_Y + 0.12, z, 0.17, 0, 0.09, 6, linear(P.zones.residential[0]));
  },
};

/** 半格三角。shop 是贴路的小店，其余是收边的绿地和小品。 */
function smallTriangle(b, name, P) {
  const [, use, orient] = name.split('-');
  const q = Number(orient);
  const corners = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
  const points = [corners[q], corners[(q + 1) % 4], corners[(q + 2) % 4]];
  const cx = (points[0][0] + points[1][0] + points[2][0]) / 3;
  const cz = (points[0][1] + points[1][1] + points[2][1]) / 3;
  const inner = points.map(([x, z]) => [x + (cx - x) * 0.14, z + (cz - z) * 0.14]);
  if (use === 'shop') {
    plate(b, inner, linear(P.road.walk));
    b.at(cx * 0.95, LOT_Y, cz * 0.95, 0, (c) => {
      c.box(0, 0, 0, 0.22, 0.13, 0.2, linear(P.wall.warm), {
        top: linear(P.zones.commercial[q % 4]),
      });
      windows(c, 0.22, 0.2, 0.02, 1, P, 0.13, 0.6, 0.11);
    });
    return;
  }
  plate(b, inner, linear(P.ground.lawn));
  SMALL_FEATURES[use](b, cx, cz, P);
}

function farmhouse(b, P, seed) {
  plate(b, rectangle(0, 0, 0.9, 0.9), shade(linear(P.ground.lawn), 0.98));
  b.at(-0.1, LOT_Y, -0.12, 0, (c) => {
    const red = linear(P.zones.farm[0]);
    c.box(0, 0, 0, 0.42, 0.13, 0.26, red);
    c.gable(0, 0.13, 0, 0.42, 0.26, 0.1, linear(P.wall.warm), red, 'x', 0.015);
    c.poly(
      [
        [0.213, 0.002, -0.05],
        [0.213, 0.002, 0.05],
        [0.213, 0.1, 0.05],
        [0.213, 0.1, -0.05],
      ],
      linear(P.wall.warm),
      [1, 0, 0],
    );
  });
  b.cylinder(0.28, LOT_Y, -0.22, 0.07, 0.07, 0.24, 8, linear(P.wall.cool), linear(P.wall.concrete));
  b.cylinder(0.28, LOT_Y + 0.24, -0.22, 0.075, 0, 0.07, 8, linear(P.zones.farm[0]));
  tree(b, -0.3, 0.3, P, 0.9);
  if (seed > 0) tree(b, 0.25, 0.28, P, 0.8);
}

function forest(b, P, seed, density) {
  for (let i = 0; i < density; i += 1) {
    const x = (b.random() - 0.5) * 0.82;
    const z = (b.random() - 0.5) * 0.82;
    if (seed % 2 === 0) pine(b, x, z, P, 0.85 + b.random() * 0.5);
    else tree(b, x, z, P, 0.85 + b.random() * 0.5, 0);
  }
}

/** 车头灯画在发光层上，夜里单独显示。 */
function car(b, P, seed, rotation) {
  const body = linear(P.cars[seed % P.cars.length]);
  const glass = linear(P.window.day);
  const wheel = linear('#2f3238');
  b.at(0, 0.002, 0, rotation, (c) => {
    c.box(0, 0.018, 0, 0.2, 0.04, 0.1, body);
    c.box(-0.012, 0.058, 0, 0.11, 0.032, 0.088, glass, { top: body });
    for (const [x, z] of [
      [0.06, 0.05],
      [-0.06, 0.05],
      [0.06, -0.05],
      [-0.06, -0.05],
    ]) {
      c.box(x, 0, z, 0.038, 0.024, 0.012, wheel);
    }
    const lamp = linear(P.window.lit);
    const tail = linear(P.road.rail);
    for (const z of [-0.032, 0.032]) {
      c.box(0.102, 0.024, z, 0.008, 0.016, 0.02, lamp, { glow: true });
      c.box(-0.102, 0.024, z, 0.008, 0.016, 0.02, tail, { glow: true });
    }
  });
}

function bus(b, P, rotation) {
  const body = linear(P.road.rail);
  const glass = linear(P.window.day);
  b.at(0, 0.002, 0, rotation, (c) => {
    c.box(0, 0.02, 0, 0.36, 0.09, 0.11, body, { top: linear('#ffffff') });
    c.box(0, 0.052, 0.056, 0.32, 0.032, 0.002, glass);
    c.box(0.181, 0.052, 0, 0.002, 0.032, 0.09, glass);
    for (const z of [-0.036, 0.036])
      c.box(0.183, 0.026, z, 0.006, 0.016, 0.02, linear(P.window.lit), { glow: true });
  });
}

function boat(b, P, rotation) {
  const hull = linear(P.wall.cool);
  const stripe = linear(P.road.rail);
  b.at(0, waterLevel, 0, rotation, (c) => {
    c.poly(
      [
        [-0.3, 0.05, -0.08],
        [0.2, 0.05, -0.08],
        [0.32, 0.05, 0],
        [0.2, 0.05, 0.08],
        [-0.3, 0.05, 0.08],
      ],
      linear(P.wood),
    );
    c.poly(
      [
        [-0.3, 0, 0.08],
        [0.2, 0, 0.08],
        [0.2, 0.05, 0.08],
        [-0.3, 0.05, 0.08],
      ],
      stripe,
      [0, 0, 1],
    );
    c.poly(
      [
        [0.2, 0, 0.08],
        [0.32, 0, 0],
        [0.32, 0.05, 0],
        [0.2, 0.05, 0.08],
      ],
      stripe,
      [1, 0, 1],
    );
    c.box(-0.16, 0.05, 0, 0.14, 0.09, 0.11, hull);
    c.box(0.06, 0.05, 0, 0.2, 0.07, 0.12, linear(P.zones.commercial[3]));
  });
}

function dock(b, P) {
  const wood = linear(P.wood);
  for (let i = 0; i < 5; i += 1) {
    const x = -0.4 + i * 0.2;
    b.box(x, -0.02, 0, 0.17, 0.03, 0.8, shade(wood, 0.95 + (i % 2) * 0.08));
    b.cylinder(x, waterLevel, 0.38, 0.02, 0.02, 0.14, 5, shade(wood, 0.75));
    b.cylinder(x, waterLevel, -0.38, 0.02, 0.02, 0.14, 5, shade(wood, 0.75));
  }
  const crane = linear(P.zones.commercial[3]);
  b.box(-0.14, 0.01, -0.12, 0.05, 0.42, 0.05, crane);
  b.box(0.04, 0.42, -0.12, 0.44, 0.04, 0.04, crane);
  b.box(0.2, 0.28, -0.12, 0.006, 0.14, 0.006, linear('#333333'));
  b.box(0.2, 0.25, -0.12, 0.08, 0.04, 0.06, linear(P.road.rail));
  b.box(-0.22, 0.01, 0.24, 0.14, 0.09, 0.1, linear(P.zones.commercial[0]));
  b.box(-0.04, 0.01, 0.24, 0.14, 0.09, 0.1, linear(P.road.rail));
}

/** 信号灯的灯杆和灯头。灯头是一个白点，运行时染成红、黄、绿。 */
function signalPole(b, P) {
  const steel = linear(P.wall.glassDark);
  b.cylinder(0, 0, 0, 0.012, 0.01, 0.2, 5, steel);
  b.box(0, 0.17, 0, 0.05, 0.05, 0.05, linear('#2f3238'));
}

function signalLamp(b) {
  b.blob(0, 0.195, 0.028, 0.018, 0.018, 0.012, linear('#ffffff'), 0);
}

/** 名字决定画法。B、Q、S、P、t 开头的是物业规格，其余是场景物体。 */
export function buildObject(name, P) {
  const parts = name.split('-');
  const kind = parts[0];
  const b = new Builder(hashString(name));
  if (kind === 'B') propertyB(b, name, P);
  else if (kind === 'Q') propertyQ(b, name, P);
  else if (kind === 'S') {
    const [w, h] = parts[2].split('x').map(Number);
    SERVICE_BUILDERS[parts[1]](b, w - 0.1, h - 0.1, P);
  } else if (kind === 'P') {
    const [w, h] = parts[2].split('x').map(Number);
    publicLand(b, parts[1], w - 0.1, h - 0.1, P);
  } else if (kind === 't') smallTriangle(b, name, P);
  else if (kind === 'farmhouse') farmhouse(b, P, Number(parts[1]));
  else if (kind === 'forest') forest(b, P, Number(parts[1]), Number(parts[2] ?? 5));
  else if (kind === 'car') car(b, P, Number(parts[1]), (Number(parts[2] ?? 0) * Math.PI) / 4);
  else if (kind === 'bus') bus(b, P, (Number(parts[1]) * Math.PI) / 4);
  else if (kind === 'boat') boat(b, P, (Number(parts[1]) * Math.PI) / 4);
  else if (kind === 'dock') dock(b, P);
  else if (kind === 'pole') signalPole(b, P);
  else if (kind === 'lamp') signalLamp(b);
  else throw new Error(`没有这种物体：${name}`);
  return b;
}

function polygonOfFootprint(footprint) {
  const match = /^([RDQ])(\d+)(?:x(\d+))?(?:-(\w+))?$/.exec(footprint);
  const [, type, a, c, orient] = match;
  const first = Number(a);
  const second = Number(c ?? a);
  const inset = 0.05;
  if (type === 'R') return rectangle(0, 0, first - inset * 2, second - inset * 2);
  if (type === 'D') {
    const u = first * HALF_DIAGONAL - inset * 2;
    const v = second * HALF_DIAGONAL - inset * 2;
    const axisU = [HALF_DIAGONAL, HALF_DIAGONAL];
    const axisV = [HALF_DIAGONAL, -HALF_DIAGONAL];
    return [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([s, t]) => [
      (s * u * axisU[0] + t * v * axisV[0]) / 2,
      (s * u * axisU[1] + t * v * axisV[1]) / 2,
    ]);
  }
  return triangleOutline(first, Number(orient));
}

/**
 * 节日装饰层。每种占地规格一张，只装饰地块最靠近相机的一条边：两端各一根灯笼杆，中间一条横幅。
 * 它只依赖占地，不依赖分区、等级和风格，所以任何风格都能直接叠加。不用任何国家标志。
 */
export function buildFestival(footprint, P) {
  const b = new Builder(hashString(footprint));
  const polygon = polygonOfFootprint(footprint);
  const red = linear(P.festival.red);
  const gold = linear(P.festival.gold);
  const poleHeight = 0.34;
  const front = edgesOf(polygon).reduce((best, edge) =>
    edge.nx + edge.nz > best.nx + best.nz ? edge : best,
  );
  const { x0, z0, x1, z1, nx, nz, length } = front;
  const inset = Math.min(0.14, length * 0.15) / length;
  const ax = x0 + (x1 - x0) * inset;
  const az = z0 + (z1 - z0) * inset;
  const cx = x1 - (x1 - x0) * inset;
  const cz = z1 - (z1 - z0) * inset;
  for (const [px, pz] of [
    [ax, az],
    [cx, cz],
  ]) {
    b.cylinder(px, LOT_Y, pz, 0.01, 0.008, poleHeight, 5, gold);
    b.blob(px, LOT_Y + poleHeight - 0.03, pz, 0.052, 0.064, 0.052, red, 0.02);
    b.box(px, LOT_Y + poleHeight - 0.11, pz, 0.016, 0.022, 0.016, gold);
  }
  const low = LOT_Y + poleHeight - 0.15;
  const high = LOT_Y + poleHeight - 0.09;
  b.poly(
    [
      [ax, low, az],
      [cx, low, cz],
      [cx, high, cz],
      [ax, high, az],
    ],
    red,
    [nx, 0, nz],
  );
  return b;
}
