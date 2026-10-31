import { Builder, hashString, linear, mix, shade } from './builder.js';
import { waterLevel } from './tiles.js';

// 标准风格的建筑生成器。规格名字决定占地，这里决定外观。
// 一个地块是一个物业：楼、停车场、绿化画在同一张图里，看起来是设计好的一整套。

const FLOOR = 0.15;
const LOT_Y = 0.02;
const HALF_DIAGONAL = Math.SQRT1_2;

function pick(list, random) {
  return list[Math.floor(random() * list.length) % list.length];
}

function plate(b, points, color) {
  const top = points.map(([x, z]) => [x, LOT_Y, z]);
  b.poly(top, color);
  for (let i = 0; i < points.length; i += 1) {
    const [x0, z0] = points[i];
    const [x1, z1] = points[(i + 1) % points.length];
    const nx = z1 - z0;
    const nz = x0 - x1;
    const centerX = points.reduce((sum, p) => sum + p[0], 0) / points.length;
    const centerZ = points.reduce((sum, p) => sum + p[1], 0) / points.length;
    const flip = (x0 - centerX) * nx + (z0 - centerZ) * nz < 0 ? -1 : 1;
    b.poly([[x0, 0, z0], [x1, 0, z1], [x1, LOT_Y, z1], [x0, LOT_Y, z0]], shade(color, 0.86), [nx * flip, 0, nz * flip]);
  }
}

function rectangle(cx, cz, sx, sz) {
  return [
    [cx - sx / 2, cz - sz / 2],
    [cx + sx / 2, cz - sz / 2],
    [cx + sx / 2, cz + sz / 2],
    [cx - sx / 2, cz + sz / 2],
  ];
}

function flat(b, points, y, color) {
  b.poly(points.map(([x, z]) => [x, y, z]), color);
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
function windows(b, sx, sz, y0, floors, P, spacing = FLOOR, size = 0.52, cell = 0.13) {
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
          pane(b, [[px, y, z - w / 2], [px, y, z + w / 2], [px, y + paneH, z + w / 2], [px, y + paneH, z - w / 2]], [sign, 0, 0], P);
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
          pane(b, [[x - w / 2, y, pz], [x + w / 2, y, pz], [x + w / 2, y + paneH, pz], [x - w / 2, y + paneH, pz]], [0, 0, sign], P);
        }
      }
    }
  }
}

function tree(b, x, z, P, scale = 1, y = LOT_Y) {
  const leaf = linear(pick(P.tree.leaf, b.random));
  const trunk = linear(P.tree.trunk);
  const h = (0.1 + b.random() * 0.05) * scale;
  b.cylinder(x, y, z, 0.018 * scale, 0.012 * scale, h, 5, trunk);
  const r = (0.09 + b.random() * 0.04) * scale;
  b.blob(x, y + h + r * 0.7, z, r, r * 1.1, r, leaf);
  if (b.random() < 0.6) b.blob(x + r * 0.5, y + h + r * 0.3, z + r * 0.4, r * 0.65, r * 0.65, r * 0.65, shade(leaf, 1.08));
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
    b.box(x, y, z, 0.06 + b.random() * 0.06, 0.03 + b.random() * 0.04, 0.06 + b.random() * 0.06, shade(concrete, 0.9 + b.random() * 0.15));
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
  const deep = (along === 'x' ? sz : sx) * 0.34;
  const other = along === 'x' ? sz : sx;
  for (const row of [-1, 1]) {
    for (let i = 0; i <= bays; i += 1) {
      const t = -across / 2 + i * pitch;
      const u = row * (other / 2 - deep / 2);
      const [x, z, w, d] = along === 'x' ? [cx + t, cz + u, 0.007, deep] : [cx + u, cz + t, deep, 0.007];
      flat(b, rectangle(x, z, w, d), LOT_Y + 0.005, line);
      if (i < bays && b.random() < 0.4) {
        const color = linear(pick(P.cars, b.random));
        const [px, pz, carX, carZ] = along === 'x' ? [x + pitch / 2, z, 0.052, 0.098] : [x, z + pitch / 2, 0.098, 0.052];
        b.box(px, LOT_Y + 0.006, pz, carX, 0.022, carZ, color);
        b.box(px, LOT_Y + 0.028, pz, carX * 0.8, 0.014, carZ * 0.55, linear(P.window.day), { top: color });
      }
    }
  }
}

function garden(b, cx, cz, sx, sz, P, trees = 3) {
  const lawn = shade(linear(P.ground.lawn), 1.04);
  flat(b, rectangle(cx, cz, sx, sz), LOT_Y + 0.002, lawn);
  flat(b, rectangle(cx, cz, sx * 0.08, sz), LOT_Y + 0.004, linear(P.road.walk));
  for (let i = 0; i < trees; i += 1) {
    tree(b, cx + (b.random() - 0.5) * sx * 0.8, cz + (b.random() - 0.5) * sz * 0.8, P, 0.75 + b.random() * 0.3);
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

function houseGroup(b, sx, sz, P, seed) {
  const countX = Math.max(1, Math.round(sx / 0.95));
  const countZ = Math.max(1, Math.round(sz / 0.95));
  for (let j = 0; j < countZ; j += 1) {
    for (let i = 0; i < countX; i += 1) {
      const px = -sx / 2 + (sx / countX) * (i + 0.5) - 0.05;
      const pz = -sz / 2 + (sz / countZ) * (j + 0.5) - 0.05;
      const index = seed + i * 3 + j * 5;
      const wall = linear([P.wall.warm, P.wall.cool, P.wall.brick][index % 3]);
      const roof = linear(P.zones.residential[index % P.zones.residential.length]);
      const h = FLOOR * (index % 3 === 2 ? 2 : 1.35);
      b.at(px, LOT_Y, pz, 0, (c) => cottage(c, P, wall, roof, 0.46, 0.4, h, index % 2 === 0 ? 'x' : 'z'));
      tree(b, px + 0.33, pz + 0.3, P, 0.75);
    }
  }
}

function slab(b, cx, cz, sx, sz, floors, wall, accent, P) {
  const h = floors * FLOOR;
  b.at(cx, LOT_Y, cz, 0, (c) => {
    c.box(0, 0, 0, sx, h, sz, wall, { top: shade(wall, 0.9) });
    windows(c, sx, sz, 0, floors, P);
    for (let f = 1; f < floors; f += 2) c.box(0, f * FLOOR - 0.008, 0, sx + 0.02, 0.012, sz + 0.02, accent);
    c.box(0, h, 0, sx + 0.024, 0.018, sz + 0.024, accent);
    roofClutter(c, h + 0.018, sx, sz, P);
  });
}

function glassTower(b, cx, cz, sx, sz, floors, seed, P) {
  const glass = linear(P.wall.glass);
  const dark = linear(P.wall.glassDark);
  const frame = linear(seed % 2 === 0 ? P.wall.cool : P.wall.concrete);
  const accent = linear(P.zones.commercial[seed % P.zones.commercial.length]);
  b.at(cx, LOT_Y, cz, 0, (c) => {
    let y = 0;
    const tiers = seed % 2 === 0 ? [[1, 0.35], [0.8, 0.45], [0.58, 0.2]] : [[1, 1]];
    for (const [scale, share] of tiers) {
      const w = sx * scale;
      const d = sz * scale;
      const count = Math.max(2, Math.round(floors * share));
      const h = count * FLOOR * 0.82;
      c.box(0, y, 0, w, h, d, glass, { top: frame, px: dark, pz: glass });
      for (let f = 0; f <= count; f += 1) c.box(0, y + f * FLOOR * 0.82 - 0.005, 0, w + 0.006, 0.01, d + 0.006, frame);
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

function roundTower(b, cx, cz, r, floors, seed, P) {
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

function shopHall(b, cx, cz, sx, sz, floors, seed, P) {
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
      c.poly([[x0, 0.135, sz / 2], [x1, 0.135, sz / 2], [x1, 0.098, sz / 2 + 0.07], [x0, 0.098, sz / 2 + 0.07]], color, [0, 1, 1]);
    }
    const rows = Math.max(4, Math.round(sz / 0.09));
    for (let i = 0; i < rows; i += 1) {
      const color = i % 2 === 0 ? accent : white;
      const z0 = -sz / 2 + (sz / rows) * i;
      const z1 = z0 + sz / rows;
      c.poly([[sx / 2, 0.135, z0], [sx / 2, 0.135, z1], [sx / 2 + 0.07, 0.098, z1], [sx / 2 + 0.07, 0.098, z0]], color, [1, 1, 0]);
    }
    if (floors > 1) windows(c, sx, sz, 0.17, floors - 1, P, FLOOR, 0.6, 0.15);
    c.box(0, h, 0, sx + 0.02, 0.02, sz + 0.02, shade(wall, 0.9));
    c.box(-sx * 0.1, h + 0.02, sz / 2 - 0.06, sx * 0.6, 0.1, 0.02, accent);
    roofClutter(c, h + 0.02, sx, sz * 0.6, P);
  });
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
      c.poly([[x0, h, -sz / 2], [x1, h + rise, -sz / 2], [x1, h + rise, sz / 2], [x0, h, sz / 2]], roof, [-1, 2, 0]);
      c.poly([[x1, h, -sz / 2], [x1, h + rise, -sz / 2], [x1, h + rise, sz / 2], [x1, h, sz / 2]], linear(P.wall.glass), [1, 0, 0]);
      c.poly([[x0, h, sz / 2], [x1, h, sz / 2], [x1, h + rise, sz / 2]], wall, [0, 0, 1]);
    }
    windows(c, sx, sz, 0.04, 1, P, 0.18, 0.6, 0.18);
  });
  const red = linear(P.road.rail);
  const white = linear('#f2f0ea');
  for (let i = 0; i < 4; i += 1) {
    b.cylinder(cx - sx * 0.4, LOT_Y + i * 0.13, cz - sz * 0.42, 0.055 - i * 0.005, 0.05 - i * 0.005, 0.13, 7, i % 2 === 0 ? red : white);
  }
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
      const walls = [linear(P.wall.warm), linear(P.wall.cool), linear(P.wall.concrete), mix(linear(P.wall.brick), linear(P.wall.warm), 0.5)];
      const accent = linear(P.zones.residential[seed % P.zones.residential.length]);
      slab(b, offsetX, offsetZ, Math.max(0.4, w), Math.max(0.4, d), level === 2 ? 4 + seed % 3 : 9 + (seed % 3) * 2, walls[seed % 4], accent, P);
    }
  } else if (zone === 'c') {
    if (level === 3) {
      if (seed % 3 === 2) roundTower(b, offsetX, offsetZ, Math.min(w, d) * 0.42, 12 + seed % 4, seed, P);
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
  const seed = hashString(name) % 97 + Number(variant);
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

const QUADRANTS = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

/** 大三角形物业：楼贴着两条直角边，用停车场、庭院和树把斜边一侧填满。 */
function propertyQ(b, name, P) {
  const [, zoneLevel, legsText, orient, variant] = name.split('-');
  const zone = zoneLevel[0];
  const level = Number(zoneLevel[1]);
  const legs = Number(legsText);
  const [sx, sz] = QUADRANTS[Number(orient)];
  const seed = hashString(name) % 97 + Number(variant);
  const half = legs / 2;
  const toLocal = (u, v) => [-sx * half + sx * u, -sz * half + sz * v];
  const shrink = 0.07;
  const corners = [toLocal(shrink, shrink), toLocal(legs - shrink * 2.4, shrink), toLocal(shrink, legs - shrink * 2.4)];
  const lotColor = linear(zone === 'r' ? P.ground.lawn : zone === 'c' ? P.road.walk : P.road.yard);
  plate(b, corners, lotColor);

  const arm = legs * 0.27;
  const reach = legs * 0.66;
  const wall = linear([P.wall.warm, P.wall.cool, P.wall.concrete][seed % 3]);
  const accent = linear(zone === 'r' ? P.zones.residential[seed % 4] : P.zones.commercial[seed % 4]);
  const margin = 0.14;
  const floors = zone === 'i' ? 2 : level === 1 ? 3 : level === 2 ? 5 : 8;
  const h = floors * FLOOR;
  const box = (u0, u1, v0, v1) => {
    const [ax, az] = toLocal(u0, v0);
    const [cx, cz] = toLocal(u1, v1);
    return { x: (ax + cx) / 2, z: (az + cz) / 2, w: Math.abs(cx - ax), d: Math.abs(cz - az) };
  };
  const wing = (part, height) => {
    b.at(part.x, LOT_Y, part.z, 0, (c) => {
      c.box(0, 0, 0, part.w, height, part.d, wall, { top: shade(wall, 0.92) });
      windows(c, part.w, part.d, 0, Math.round(height / FLOOR), P);
      c.box(0, height, 0, part.w + 0.02, 0.016, part.d + 0.02, accent);
    });
  };
  const useL = Number(variant) === 0 || legs >= 3;
  if (useL) {
    const armU = box(margin, margin + reach, margin, margin + arm);
    const armV = box(margin, margin + arm, margin + arm, margin + reach);
    // 先画后面的翼楼，绘制顺序只影响重叠部分，这里两翼不重叠。
    wing(armU, h);
    wing(armV, h);
    b.at(armU.x, LOT_Y + h + 0.016, armU.z, 0, (c) => roofClutter(c, 0, armU.w, armU.d, P));
  } else {
    wing(box(margin, margin + reach * 0.62, margin, margin + reach * 0.62), h * 1.3);
  }

  // 斜边一侧的外场：停车场或庭院，外圈一条绿化带沿着斜边。
  const inner = margin + arm + 0.06;
  const steps = Math.max(2, Math.floor((legs - inner * 2) / 0.32));
  const hedge = legs - 0.34;
  for (let i = 0; i <= steps + 2; i += 1) {
    const t = (i + 0.4) / (steps + 3);
    const [tx, tz] = toLocal(hedge * t + 0.06, hedge * (1 - t) + 0.06);
    if (legs * t > inner * 0.5) tree(b, tx, tz, P, 0.72 + b.random() * 0.2);
  }
  const yardLow = inner;
  const yardHigh = legs - 0.5;
  const yardSpan = yardHigh - yardLow;
  if (yardSpan > 0.25) {
    const corner = toLocal(yardLow, yardLow);
    const [cx, cz] = [corner[0] + (sx * yardSpan) / 3, corner[1] + (sz * yardSpan) / 3];
    const side = yardSpan * 0.62;
    if (zone === 'c') parking(b, cx, cz, side, side, P, 'x');
    else if (zone === 'i') yard(b, cx, cz, side, side, P);
    else {
      flat(b, rectangle(cx, cz, side, side), LOT_Y + 0.003, shade(linear(P.ground.lawn), 1.05));
      flat(b, rectangle(cx, cz, side * 0.12, side), LOT_Y + 0.005, linear(P.road.walk));
      flat(b, rectangle(cx, cz, side, side * 0.12), LOT_Y + 0.005, linear(P.road.walk));
      b.cylinder(cx, LOT_Y + 0.004, cz, 0.1, 0.1, 0.025, 8, linear(P.wall.concrete), linear(P.water.mid));
    }
  }
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
      c.poly([[x - 0.07, 0.002, bz / 2 + 0.003], [x + 0.07, 0.002, bz / 2 + 0.003], [x + 0.07, 0.17, bz / 2 + 0.003], [x - 0.07, 0.17, bz / 2 + 0.003]], red, [0, 0, 1]);
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
  for (const [x, z] of [[-0.27, -0.25], [0.2, -0.25], [-0.27, 0.22]]) {
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
  for (const [x, z] of [[-0.25, -0.26], [0.2, -0.26]]) {
    b.cylinder(x * sx, LOT_Y, z * sz, r, r * 0.68, 0.34, 12, concrete, shade(concrete, 0.5));
    b.cylinder(x * sx, LOT_Y + 0.34, z * sz, r * 0.68, r * 0.8, 0.12, 12, shade(concrete, 1.04), shade(concrete, 0.5));
  }
  b.at(-sx * 0.1, LOT_Y, sz * 0.26, 0, (c) => {
    c.box(0, 0, 0, sx * 0.6, FLOOR * 2, sz * 0.3, linear(P.wall.cool));
    windows(c, sx * 0.6, sz * 0.3, 0.03, 2, P);
    c.box(0, FLOOR * 2, 0, sx * 0.6 + 0.02, 0.02, sz * 0.3 + 0.02, linear(P.service.power));
  });
  const red = linear(P.road.rail);
  for (let i = 0; i < 4; i += 1) {
    b.cylinder(sx * 0.38, LOT_Y + i * 0.14, sz * 0.3, 0.045, 0.04, 0.14, 7, i % 2 === 0 ? red : linear('#f2f0ea'));
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
    for (let x = -sx / 2 + step; x < sx / 2; x += step) flat(b, rectangle(x, 0, 0.006, sz), LOT_Y + 0.002, linear(P.wall.concrete));
    for (let z = -sz / 2 + step; z < sz / 2; z += step) flat(b, rectangle(0, z, sx, 0.006), LOT_Y + 0.002, linear(P.wall.concrete));
    b.cylinder(0, LOT_Y, 0, 0.16, 0.16, 0.035, 10, linear(P.wall.concrete), linear(P.water.mid));
    b.cylinder(0, LOT_Y + 0.03, 0, 0.02, 0.012, 0.11, 6, linear(P.wall.cool));
    for (const [x, z] of [[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32]]) tree(b, x * sx, z * sz, P, 0.7);
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

/** 半格三角：小店、花园、停车场和收边的小块农田。 */
function smallTriangle(b, name, P) {
  const [, use, orient] = name.split('-');
  const q = Number(orient);
  const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  const points = [corners[q], corners[(q + 1) % 4], corners[(q + 2) % 4]];
  const cx = (points[0][0] + points[1][0] + points[2][0]) / 3;
  const cz = (points[0][1] + points[1][1] + points[2][1]) / 3;
  const inner = points.map(([x, z]) => [x + (cx - x) * 0.14, z + (cz - z) * 0.14]);
  if (use === 'parking') {
    plate(b, inner, linear(P.road.yard));
    b.box(cx * 0.8, LOT_Y, cz * 0.8, 0.1, 0.024, 0.052, linear(pick(P.cars, b.random)));
  } else if (use === 'shop') {
    plate(b, inner, linear(P.road.walk));
    b.at(cx * 0.95, LOT_Y, cz * 0.95, 0, (c) => {
      c.box(0, 0, 0, 0.22, 0.13, 0.2, linear(P.wall.warm), { top: linear(P.zones.commercial[q % 4]) });
      windows(c, 0.22, 0.2, 0.02, 1, P, 0.13, 0.6, 0.11);
    });
  } else if (use === 'crop') {
    plate(b, inner, linear(P.field.greens));
  } else {
    plate(b, inner, linear(P.ground.lawn));
    tree(b, cx, cz, P, 0.8);
    b.blob(cx * 0.4, LOT_Y + 0.02, cz * 1.2, 0.05, 0.03, 0.05, linear(P.tree.leaf[1]));
  }
}

function farmhouse(b, P, seed) {
  plate(b, rectangle(0, 0, 0.9, 0.9), shade(linear(P.ground.lawn), 0.98));
  b.at(-0.1, LOT_Y, -0.12, 0, (c) => {
    const red = linear(P.zones.farm[0]);
    c.box(0, 0, 0, 0.42, 0.13, 0.26, red);
    c.gable(0, 0.13, 0, 0.42, 0.26, 0.1, linear(P.wall.warm), red, 'x', 0.015);
    c.poly([[0.213, 0.002, -0.05], [0.213, 0.002, 0.05], [0.213, 0.1, 0.05], [0.213, 0.1, -0.05]], linear(P.wall.warm), [1, 0, 0]);
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

function car(b, P, seed, rotation) {
  const body = linear(P.cars[seed % P.cars.length]);
  const glass = linear(P.window.day);
  const wheel = linear('#2f3238');
  b.at(0, 0.002, 0, rotation, (c) => {
    c.box(0, 0.018, 0, 0.2, 0.04, 0.1, body);
    c.box(-0.012, 0.058, 0, 0.11, 0.032, 0.088, glass, { top: body });
    for (const [x, z] of [[0.06, 0.05], [-0.06, 0.05], [0.06, -0.05], [-0.06, -0.05]]) {
      c.box(x, 0, z, 0.038, 0.024, 0.012, wheel);
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
  });
}

function boat(b, P, rotation) {
  const hull = linear(P.wall.cool);
  const stripe = linear(P.road.rail);
  b.at(0, waterLevel, 0, rotation, (c) => {
    c.poly([[-0.3, 0.05, -0.08], [0.2, 0.05, -0.08], [0.32, 0.05, 0], [0.2, 0.05, 0.08], [-0.3, 0.05, 0.08]], linear(P.wood));
    c.poly([[-0.3, 0, 0.08], [0.2, 0, 0.08], [0.2, 0.05, 0.08], [-0.3, 0.05, 0.08]], stripe, [0, 0, 1]);
    c.poly([[0.2, 0, 0.08], [0.32, 0, 0], [0.32, 0.05, 0], [0.2, 0.05, 0.08]], stripe, [1, 0, 1]);
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
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => [
      (s * u * axisU[0] + t * v * axisV[0]) / 2,
      (s * u * axisU[1] + t * v * axisV[1]) / 2,
    ]);
  }
  const [sx, sz] = QUADRANTS[Number(orient)];
  const half = first / 2;
  const shrink = 0.07;
  return [
    [-sx * half + sx * shrink, -sz * half + sz * shrink],
    [-sx * half + sx * (first - shrink * 2.4), -sz * half + sz * shrink],
    [-sx * half + sx * shrink, -sz * half + sz * (first - shrink * 2.4)],
  ];
}

/**
 * 节日装饰层。每种占地规格一张，沿朝向相机的地块边缘放灯笼杆、彩旗串和红绸。
 * 它只依赖占地，不依赖分区、等级和风格，所以任何风格都能直接叠加。不用任何国家标志。
 */
export function buildFestival(footprint, P) {
  const b = new Builder(hashString(footprint));
  const polygon = polygonOfFootprint(footprint);
  const center = polygon.reduce((sum, [x, z]) => [sum[0] + x / polygon.length, sum[1] + z / polygon.length], [0, 0]);
  const red = linear(P.festival.red);
  const gold = linear(P.festival.gold);
  const colors = P.festival.bunting.map(linear);
  const poleHeight = 0.26;
  for (let i = 0; i < polygon.length; i += 1) {
    const [x0, z0] = polygon[i];
    const [x1, z1] = polygon[(i + 1) % polygon.length];
    const mx = (x0 + x1) / 2 - center[0];
    const mz = (z0 + z1) / 2 - center[1];
    let nx = z1 - z0;
    let nz = x0 - x1;
    if (nx * mx + nz * mz < 0) {
      nx = -nx;
      nz = -nz;
    }
    if (nx + nz <= 0.01) continue;
    const length = Math.hypot(x1 - x0, z1 - z0);
    const spans = Math.max(1, Math.round(length / 0.62));
    for (let s = 0; s <= spans; s += 1) {
      const t = s / spans;
      const px = x0 + (x1 - x0) * t;
      const pz = z0 + (z1 - z0) * t;
      b.cylinder(px, LOT_Y, pz, 0.008, 0.006, poleHeight, 5, gold);
      b.blob(px, LOT_Y + poleHeight - 0.03, pz, 0.036, 0.046, 0.036, red, 0.02);
      b.box(px, LOT_Y + poleHeight - 0.085, pz, 0.012, 0.018, 0.012, gold);
      if (s === spans) continue;
      const flags = 5;
      const qx = x0 + ((x1 - x0) * (s + 1)) / spans;
      const qz = z0 + ((z1 - z0) * (s + 1)) / spans;
      for (let f = 0; f < flags; f += 1) {
        const a = (f + 0.15) / flags;
        const c = (f + 0.85) / flags;
        const middle = (a + c) / 2;
        const sag = (u) => 4 * u * (1 - u) * 0.05;
        const top = LOT_Y + poleHeight - 0.05;
        const ax = px + (qx - px) * a;
        const az = pz + (qz - pz) * a;
        const cx = px + (qx - px) * c;
        const cz = pz + (qz - pz) * c;
        const mxx = px + (qx - px) * middle;
        const mzz = pz + (qz - pz) * middle;
        b.poly([[ax, top - sag(a), az], [cx, top - sag(c), cz], [mxx, top - sag(middle) - 0.05, mzz]], colors[(s + f) % colors.length], [nx, 0, nz]);
      }
    }
    // 红绸：沿地块边缘的一条低矮绸带。
    b.poly([[x0, LOT_Y + 0.05, z0], [x1, LOT_Y + 0.05, z1], [x1, LOT_Y + 0.078, z1], [x0, LOT_Y + 0.078, z0]], red, [nx, 0, nz]);
  }
  return b;
}
