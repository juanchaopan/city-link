import { Builder, hashString, linear, mix, shade } from './builder.js';
import { waterLevel } from './tiles.js';

// 建筑、树和车。都是参数化的小模型：同一个函数换种子就能得到不同的外形，这是素材数量能撑住的关键。

const FLOOR = 0.15;

function pick(list, random) {
  return list[Math.floor(random() * list.length) % list.length];
}

function lot(b, color, size = 0.92) {
  b.box(0, 0, 0, size, 0.022, size, color, { px: shade(color, 0.86), pz: shade(color, 0.92) });
}

function paneColor(b, P) {
  if (P.window.litRatio > 0 && b.random() < P.window.litRatio) {
    return { color: linear(P.window.lit), glow: true };
  }
  return { color: linear(P.window.day), glow: false };
}

/** 在 +x 和 +z 两个可见的墙面上开窗。墙的中心在原点，sx、sz 是墙体尺寸。 */
function windowsPlusX(b, sx, sz, y0, floors, columns, P, size = 0.5, spacing = FLOOR) {
  const paneW = (sz / columns) * size;
  const paneH = spacing * 0.5;
  const px = sx / 2 + 0.003;
  for (let f = 0; f < floors; f += 1) {
    for (let c = 0; c < columns; c += 1) {
      const z = -sz / 2 + (sz / columns) * (c + 0.5);
      const y = y0 + spacing * (f + 0.3);
      const { color, glow } = paneColor(b, P);
      b.poly([[px, y, z - paneW / 2], [px, y, z + paneW / 2], [px, y + paneH, z + paneW / 2], [px, y + paneH, z - paneW / 2]], color, [1, 0, 0], glow);
    }
  }
}

function windowsPlusZ(b, sx, sz, y0, floors, columns, P, size = 0.5, spacing = FLOOR) {
  const paneW = (sx / columns) * size;
  const paneH = spacing * 0.5;
  const pz = sz / 2 + 0.003;
  for (let f = 0; f < floors; f += 1) {
    for (let c = 0; c < columns; c += 1) {
      const x = -sx / 2 + (sx / columns) * (c + 0.5);
      const y = y0 + spacing * (f + 0.3);
      const { color, glow } = paneColor(b, P);
      b.poly([[x - paneW / 2, y, pz], [x + paneW / 2, y, pz], [x + paneW / 2, y + paneH, pz], [x - paneW / 2, y + paneH, pz]], color, [0, 0, 1], glow);
    }
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

function tree(b, x, z, P, scale = 1) {
  const leaf = linear(pick(P.tree.leaf, b.random));
  const trunk = linear(P.tree.trunk);
  const h = (0.1 + b.random() * 0.05) * scale;
  b.cylinder(x, 0, z, 0.018 * scale, 0.012 * scale, h, 5, trunk);
  const r = (0.09 + b.random() * 0.04) * scale;
  b.blob(x, h + r * 0.7, z, r, r * 1.1, r, leaf);
  if (b.random() < 0.6) b.blob(x + r * 0.5, h + r * 0.3, z + r * 0.4, r * 0.65, r * 0.65, r * 0.65, shade(leaf, 1.08));
}

function pine(b, x, z, P, scale = 1) {
  const leaf = linear(pick(P.tree.pine, b.random));
  const trunk = linear(P.tree.trunk);
  b.cylinder(x, 0, z, 0.016 * scale, 0.012 * scale, 0.07 * scale, 5, trunk);
  const tiers = 3;
  for (let i = 0; i < tiers; i += 1) {
    const r = (0.1 - i * 0.022) * scale;
    b.cylinder(x, (0.06 + i * 0.075) * scale, z, r, 0, 0.14 * scale, 6, shade(leaf, 1 + i * 0.07));
  }
}

function hedge(b, x, z, sx, sz, P) {
  b.box(x, 0.022, z, sx, 0.035, sz, shade(linear(P.tree.leaf[0]), 0.95));
}

function cottage(c, P, seed, wall, roof, sx, sz, h, axis) {
  c.box(0, 0, 0, sx, h, sz, wall);
  c.gable(0, h, 0, sx, sz, 0.16, roof, wall, axis, 0.03);
  windowsPlusX(c, sx, sz, 0.02, Math.round(h / 0.11), 2, P, 0.4, 0.11);
  windowsPlusZ(c, sx, sz, 0.02, Math.round(h / 0.11), 2, P, 0.4, 0.11);
  c.box(sx * 0.2, h + 0.05, -sz * 0.1, 0.05, 0.13, 0.05, linear(P.wall.brick));
  c.poly([[-0.03, 0.002, sz / 2 + 0.004], [0.04, 0.002, sz / 2 + 0.004], [0.04, 0.09, sz / 2 + 0.004], [-0.03, 0.09, sz / 2 + 0.004]], shade(roof, 0.7), [0, 0, 1]);
}

function house(b, P, seed) {
  const walls = [P.wall.warm, P.wall.cool, P.wall.brick];
  const wall = linear(walls[seed % 3]);
  const roof = linear(P.zones.residential[seed % P.zones.residential.length]);
  lot(b, linear(P.ground.lawn));
  const axis = seed % 2 === 0 ? 'x' : 'z';
  const sx = 0.42 + b.random() * 0.1;
  const sz = 0.38 + b.random() * 0.08;
  const h = FLOOR * (seed % 3 === 2 ? 2 : 1.35);
  b.at(-0.08, 0.022, -0.08, 0, (c) => cottage(c, P, seed, wall, roof, sx, sz, h, axis));
  if (seed % 3 === 1) {
    b.at(0.26, 0.022, -0.16, 0, (c) => {
      c.box(0, 0, 0, 0.2, 0.09, 0.26, wall);
      c.gable(0, 0.09, 0, 0.2, 0.26, 0.07, roof, wall, 'z', 0.015);
    });
  }
  b.box(-0.08, 0.022, 0.27, 0.07, 0.004, 0.3, linear(P.road.walk));
  tree(b, 0.3, 0.3, P, 0.8);
  if (seed % 2 === 1) hedge(b, 0.06, 0.41, 0.74, 0.04, P);
  else tree(b, 0.32, -0.3, P, 0.7);
}

function apartment(b, P, seed) {
  const wall = linear([P.wall.warm, P.wall.cool, P.wall.concrete, P.wall.brick][seed % 4]);
  const accent = linear(P.zones.residential[seed % P.zones.residential.length]);
  lot(b, linear(seed % 2 === 0 ? P.road.walk : P.ground.lawn));
  const floors = 3 + ((seed * 3) % 5);
  const wide = seed % 2 === 0;
  const sx = wide ? 0.68 : 0.46;
  const sz = wide ? 0.42 : 0.64;
  const h = floors * FLOOR;
  b.at(-0.02, 0.022, -0.04, 0, (c) => {
    c.box(0, 0, 0, sx, h, sz, wall, { top: shade(wall, 0.9) });
    windowsPlusX(c, sx, sz, 0, floors, wide ? 3 : 5, P);
    windowsPlusZ(c, sx, sz, 0, floors, wide ? 5 : 3, P);
    for (let f = 1; f < floors; f += 1) {
      if (seed % 3 !== 1) c.box(0, f * FLOOR - 0.008, sz / 2 + 0.016, sx * 0.86, 0.014, 0.034, accent);
      else c.box(sx / 2 + 0.016, f * FLOOR - 0.008, 0, 0.034, 0.014, sz * 0.86, accent);
    }
    if (seed % 4 === 3) {
      c.box(0, h, 0, sx + 0.03, 0.016, sz + 0.03, accent);
      c.box(0, h + 0.016, 0, sx * 0.6, FLOOR, sz * 0.7, wall, { top: accent });
    } else {
      c.box(0, h, 0, sx + 0.024, 0.018, sz + 0.024, accent);
      roofClutter(c, h + 0.018, sx, sz, P);
    }
  });
  if (seed % 2 === 0) hedge(b, 0.03, 0.34, 0.66, 0.035, P);
  tree(b, 0.38, 0.38, P, 0.65);
  tree(b, -0.36, 0.38, P, 0.55);
}

function shop(b, P, seed) {
  const wall = linear([P.wall.warm, P.wall.cool, P.wall.brick][seed % 3]);
  const accent = linear(P.zones.commercial[seed % P.zones.commercial.length]);
  const white = linear('#ffffff');
  lot(b, linear(P.road.walk));
  const sx = 0.7;
  const sz = 0.64;
  const h = FLOOR * (2 + (seed % 2));
  b.at(0, 0.022, -0.04, 0, (c) => {
    c.box(0, 0, 0, sx, h, sz, wall);
    const glass = linear(P.wall.glass);
    const lit = { glow: P.window.litRatio > 0 };
    const glassColor = lit.glow ? linear(P.window.lit) : glass;
    c.box(0, 0.005, sz / 2 - 0.002, sx - 0.08, 0.1, 0.008, glassColor, lit);
    c.box(sx / 2 - 0.002, 0.005, 0, 0.008, 0.1, sz - 0.08, glassColor, lit);
    for (let i = 0; i < 7; i += 1) {
      const color = i % 2 === 0 ? accent : white;
      const x = -sx / 2 + (sx / 7) * (i + 0.5);
      c.poly([[x - sx / 14, 0.135, sz / 2], [x + sx / 14, 0.135, sz / 2], [x + sx / 14, 0.098, sz / 2 + 0.07], [x - sx / 14, 0.098, sz / 2 + 0.07]], color, [0, 1, 1]);
    }
    for (let i = 0; i < 6; i += 1) {
      const color = i % 2 === 0 ? accent : white;
      const z = -sz / 2 + (sz / 6) * (i + 0.5);
      c.poly([[sx / 2, 0.135, z - sz / 12], [sx / 2, 0.135, z + sz / 12], [sx / 2 + 0.07, 0.098, z + sz / 12], [sx / 2 + 0.07, 0.098, z - sz / 12]], color, [1, 1, 0]);
    }
    if (h > FLOOR * 2.4) windowsPlusX(c, sx, sz, 0.17, 1, 4, P, 0.55);
    windowsPlusZ(c, sx, sz, 0.17, Math.round((h - 0.17) / FLOOR), 4, P, 0.55);
    c.box(0, h, 0, sx + 0.02, 0.02, sz + 0.02, shade(wall, 0.9));
    c.box(-0.06, h + 0.02, 0.26, 0.42, 0.11, 0.02, accent, { px: accent });
    c.box(0.18, h + 0.02, -0.12, 0.13, 0.06, 0.13, linear(P.wall.concrete));
  });
}

function litStrips(b, y, floors, sx, sz, P) {
  if (P.window.litRatio <= 0) return;
  for (let f = 0; f < floors; f += 1) {
    const fy = y + f * FLOOR * 0.82;
    for (let k = 0; k < 4; k += 1) {
      if (b.random() < P.window.litRatio * 0.8) {
        b.box(sx * (-0.3 + k * 0.2), fy + 0.03, sz / 2 + 0.003, sx * 0.14, 0.06, 0.004, linear(P.window.lit), { glow: true });
      }
      if (b.random() < P.window.litRatio * 0.8) {
        b.box(sx / 2 + 0.003, fy + 0.03, sz * (-0.3 + k * 0.2), 0.004, 0.06, sz * 0.14, linear(P.window.lit), { glow: true });
      }
    }
  }
}

function glassTier(b, y, sx, sz, floors, frame, P) {
  const glass = linear(P.wall.glass);
  const dark = linear(P.wall.glassDark);
  const h = floors * FLOOR * 0.82;
  b.box(0, y, 0, sx, h, sz, glass, { top: frame, px: dark, pz: glass });
  const lines = 5;
  for (let i = 1; i < lines; i += 1) {
    const t = -0.5 + i / lines;
    b.box(sx * t, y, sz / 2 + 0.002, 0.012, h, 0.006, frame);
    b.box(sx / 2 + 0.002, y, sz * t, 0.006, h, 0.012, frame);
  }
  for (let f = 0; f < floors; f += 1) b.box(0, y + f * FLOOR * 0.82, 0, sx + 0.006, 0.01, sz + 0.006, frame);
  litStrips(b, y, floors, sx, sz, P);
  return y + h;
}

function officeStepped(b, P, seed, frame) {
  let y = 0.022;
  const tiers = [[0.72, 0.68, 3], [0.6, 0.56, 6 + (seed % 3) * 2], [0.42, 0.4, 3 + (seed % 2) * 3]];
  for (const [sx, sz, floors] of tiers) {
    y = glassTier(b, y, sx, sz, floors, frame, P);
    b.box(0, y, 0, sx + 0.012, 0.016, sz + 0.012, frame);
    y += 0.016;
  }
  const accent = linear(P.zones.commercial[seed % P.zones.commercial.length]);
  b.box(0, y, 0, 0.2, 0.09, 0.2, accent);
  b.cylinder(0, y + 0.09, 0, 0.012, 0.004, 0.26, 4, linear(P.road.rail));
}

function officeSlab(b, P, seed, frame) {
  const sx = 0.34;
  const sz = 0.74;
  const top = glassTier(b, 0.022, sx, sz, 7 + (seed % 3) * 2, frame, P);
  b.box(0, top, 0, sx + 0.014, 0.02, sz + 0.014, linear(P.zones.commercial[seed % 4]));
  roofClutter(b, top + 0.02, sx, sz, P);
  b.box(0.27, 0.022, 0, 0.2, FLOOR * 2, 0.74, linear(P.wall.concrete), { top: linear(P.ground.lawn) });
}

function officeRound(b, P, seed, frame) {
  const glass = linear(P.wall.glass);
  const dark = linear(P.wall.glassDark);
  const floors = 8 + (seed % 3) * 2;
  const sides = 10;
  const r = 0.3;
  let y = 0.022;
  b.cylinder(0, y, 0, r + 0.06, r + 0.06, FLOOR * 1.2, sides, frame);
  y += FLOOR * 1.2;
  for (let f = 0; f < floors; f += 1) {
    const taper = r - f * 0.008;
    b.cylinder(0, y, 0, taper, taper, FLOOR * 0.68, sides, f % 2 === 0 ? glass : dark, frame);
    y += FLOOR * 0.68;
    b.cylinder(0, y, 0, taper + 0.008, taper + 0.008, 0.012, sides, frame);
    y += 0.012;
  }
  b.cylinder(0, y, 0, 0.14, 0, 0.1, sides, linear(P.zones.commercial[seed % 4]));
  if (P.window.litRatio > 0) litStrips(b, 0.2, floors, r * 1.2, r * 1.2, P);
}

function office(b, P, seed) {
  const frame = linear(seed % 2 === 0 ? P.wall.cool : P.wall.concrete);
  lot(b, linear(P.road.walk));
  const style = seed % 3;
  if (style === 0) officeStepped(b, P, seed, frame);
  else if (style === 1) officeSlab(b, P, seed, frame);
  else officeRound(b, P, seed, frame);
}

function factory(b, P, seed) {
  const wall = linear(P.zones.industrial[seed % P.zones.industrial.length]);
  const roof = linear(P.wall.concrete);
  lot(b, linear(P.road.yard));
  const sx = 0.68;
  const sz = 0.56;
  const h = 0.2;
  b.at(0, 0.022, 0.06, 0, (c) => {
    c.box(0, 0, 0, sx, h, sz, wall);
    const teeth = 4;
    const width = sx / teeth;
    for (let i = 0; i < teeth; i += 1) {
      const x0 = -sx / 2 + width * i;
      const x1 = x0 + width;
      const rise = 0.09;
      c.poly([[x0, h, -sz / 2], [x1, h + rise, -sz / 2], [x1, h + rise, sz / 2], [x0, h, sz / 2]], roof, [-1, 2, 0]);
      c.poly([[x1, h, -sz / 2], [x1, h + rise, -sz / 2], [x1, h + rise, sz / 2], [x1, h, sz / 2]], linear(P.wall.glass), [1, 0, 0]);
      c.poly([[x0, h, sz / 2], [x1, h, sz / 2], [x1, h + rise, sz / 2]], wall, [0, 0, 1]);
    }
    c.poly([[0.1, 0.002, sz / 2 + 0.003], [0.27, 0.002, sz / 2 + 0.003], [0.27, 0.13, sz / 2 + 0.003], [0.1, 0.13, sz / 2 + 0.003]], shade(wall, 0.65), [0, 0, 1]);
    windowsPlusX(c, sx, sz, 0.04, 1, 4, P, 0.6, 0.18);
    windowsPlusZ(c, sx * 0.5, sz, 0.04, 1, 3, P, 0.6, 0.18);
  });
  const red = linear(P.road.rail);
  const white = linear('#f2f0ea');
  const stackX = seed % 2 === 0 ? -0.28 : 0.26;
  for (let i = 0; i < 4; i += 1) {
    b.cylinder(stackX, 0.02 + i * 0.13, -0.32, 0.06 - i * 0.006, 0.054 - i * 0.006, 0.13, 7, i % 2 === 0 ? red : white);
  }
  if (seed % 2 === 0) {
    b.cylinder(0.22, 0.02, -0.34, 0.075, 0.075, 0.15, 8, linear(P.wall.cool), linear(P.wall.concrete));
    b.cylinder(0.06, 0.02, -0.34, 0.06, 0.06, 0.12, 8, linear(P.wall.cool), linear(P.wall.concrete));
  }
}

function warehouse(b, P, seed) {
  const wall = linear(P.zones.industrial[(seed + 1) % P.zones.industrial.length]);
  lot(b, linear(P.road.yard));
  b.at(-0.12, 0.022, -0.1, 0, (c) => {
    const sx = 0.46;
    const sz = 0.56;
    c.box(0, 0, 0, sx, 0.2, sz, wall);
    c.gable(0, 0.2, 0, sx, sz, 0.08, linear(P.wall.concrete), wall, 'z', 0.015);
    for (let i = 0; i < 3; i += 1) {
      const z = -sz / 2 + (sz / 3) * (i + 0.5);
      c.poly([[sx / 2 + 0.003, 0.002, z - 0.05], [sx / 2 + 0.003, 0.002, z + 0.05], [sx / 2 + 0.003, 0.12, z + 0.05], [sx / 2 + 0.003, 0.12, z - 0.05]], shade(wall, 0.68), [1, 0, 0]);
    }
  });
  const colors = [P.road.rail, P.zones.commercial[0], P.zones.commercial[3], P.zones.farm[2]];
  const places = [[0.31, -0.28], [0.31, -0.04], [0.31, 0.2], [0.03, 0.34]];
  places.forEach(([x, z], i) => {
    const color = linear(colors[(i + seed) % colors.length]);
    const along = i === 3;
    b.box(x, 0.022, z, along ? 0.2 : 0.09, 0.085, along ? 0.09 : 0.2, color);
    if ((i + seed) % 2 === 0) {
      b.box(x, 0.107, z, along ? 0.2 : 0.09, 0.085, along ? 0.09 : 0.2, linear(colors[(i + seed + 1) % colors.length]));
    }
  });
}

function fieldRows(b, x, z, sx, sz, rows, soil, crop) {
  const width = sz / rows;
  for (let i = 0; i < rows; i += 1) {
    const rz = z - sz / 2 + width * (i + 0.5);
    b.box(x, 0.022, rz, sx, 0.006, width, soil);
    b.box(x, 0.028, rz, sx * 0.97, 0.022, width * 0.56, shade(crop, 0.94 + (i % 2) * 0.08));
  }
}

function farm(b, P, seed) {
  const soil = linear(P.ground.soil);
  const crops = [P.zones.farm[1], P.tree.leaf[1], P.tree.autumn];
  lot(b, linear(P.ground.lawn));
  if (seed % 2 === 0) {
    fieldRows(b, 0, 0.14, 0.84, 0.56, 6, soil, linear(crops[seed % 3]));
    b.at(-0.16, 0.022, -0.27, 0, (c) => {
      const red = linear(P.zones.farm[0]);
      c.box(0, 0, 0, 0.34, 0.12, 0.2, red);
      c.gable(0, 0.12, 0, 0.34, 0.2, 0.09, linear(P.wall.warm), red, 'x', 0.015);
      c.poly([[0.17 + 0.003, 0.002, -0.04], [0.17 + 0.003, 0.002, 0.04], [0.17 + 0.003, 0.09, 0.04], [0.17 + 0.003, 0.09, -0.04]], linear(P.wall.warm), [1, 0, 0]);
    });
    b.cylinder(0.24, 0.022, -0.27, 0.07, 0.07, 0.24, 8, linear(P.wall.cool), linear(P.wall.concrete));
    b.cylinder(0.24, 0.262, -0.27, 0.075, 0, 0.07, 8, linear(P.zones.farm[0]));
  } else {
    fieldRows(b, -0.21, -0.2, 0.4, 0.44, 4, soil, linear(crops[0]));
    fieldRows(b, 0.21, -0.2, 0.4, 0.44, 4, soil, linear(crops[1]));
    const glass = mix(linear(P.wall.glass), linear('#ffffff'), 0.35);
    b.at(0, 0.022, 0.24, 0, (c) => {
      c.box(0, 0, 0, 0.74, 0.07, 0.3, glass, { px: shade(glass, 0.96) });
      c.gable(0, 0.07, 0, 0.74, 0.3, 0.09, glass, glass, 'x', 0.005);
      for (let i = 0; i <= 6; i += 1) {
        c.box(-0.37 + i * 0.123, 0.0, 0.151, 0.008, 0.075, 0.004, linear(P.wall.cool));
      }
    });
  }
}

function park(b, P, seed) {
  lot(b, linear(P.ground.lawn));
  const path = linear(P.road.walk);
  b.box(0, 0.022, 0, 0.88, 0.004, 0.08, path);
  b.box(0, 0.022, 0, 0.08, 0.004, 0.88, path);
  b.cylinder(0, 0.022, 0, 0.17, 0.17, 0.008, 10, path);
  if (seed % 2 === 0) {
    b.cylinder(0, 0.03, 0, 0.11, 0.11, 0.03, 10, linear(P.wall.concrete), linear(P.water.mid));
    b.cylinder(0, 0.05, 0, 0.02, 0.01, 0.09, 6, linear(P.wall.cool));
  } else {
    b.cylinder(0, 0.03, 0, 0.05, 0.04, 0.05, 6, linear(P.wall.concrete));
    b.cylinder(0, 0.08, 0, 0.016, 0.012, 0.12, 5, linear(P.tree.autumn));
  }
  for (const [x, z] of [[-0.26, -0.26], [0.26, -0.26], [-0.26, 0.26], [0.26, 0.26]]) {
    tree(b, x + (b.random() - 0.5) * 0.06, z + (b.random() - 0.5) * 0.06, P, 1.05);
  }
}

/** 市政厅：城市中心的地标，低矮的穹顶和整圈柱廊让它从高楼里跳出来。 */
function hall(b, P) {
  const stone = linear(P.wall.warm);
  const dome = linear(P.zones.commercial[3]);
  lot(b, linear(P.road.walk));
  b.box(0, 0.022, 0, 0.74, 0.03, 0.74, shade(stone, 0.95));
  b.box(0, 0.052, 0, 0.66, 0.2, 0.66, stone, { px: shade(stone, 0.97) });
  for (let i = 0; i < 7; i += 1) {
    const t = -0.3 + i * 0.1;
    b.cylinder(t, 0.052, 0.345, 0.014, 0.014, 0.2, 6, linear(P.wall.cool));
    b.cylinder(0.345, 0.052, t, 0.014, 0.014, 0.2, 6, linear(P.wall.cool));
  }
  b.box(0, 0.252, 0, 0.72, 0.024, 0.72, shade(stone, 1.03));
  b.box(0, 0.276, 0, 0.42, 0.09, 0.42, stone);
  const rings = 5;
  for (let i = 0; i < rings; i += 1) {
    const a0 = (i / rings) * (Math.PI / 2);
    const a1 = ((i + 1) / rings) * (Math.PI / 2);
    const r0 = Math.cos(a0) * 0.2;
    const r1 = Math.cos(a1) * 0.2;
    const y0 = 0.366 + Math.sin(a0) * 0.2;
    const y1 = 0.366 + Math.sin(a1) * 0.2;
    b.cylinder(0, y0, 0, r0, Math.max(r1, 0.001), y1 - y0, 12, shade(dome, 1 - i * 0.02));
  }
  b.cylinder(0, 0.566, 0, 0.012, 0.004, 0.14, 5, linear(P.road.rail));
}

function forest(b, P, seed, density) {
  for (let i = 0; i < density; i += 1) {
    const x = (b.random() - 0.5) * 0.82;
    const z = (b.random() - 0.5) * 0.82;
    if (seed % 2 === 0) pine(b, x, z, P, 0.85 + b.random() * 0.5);
    else tree(b, x, z, P, 0.85 + b.random() * 0.5);
  }
}

function car(b, P, seed, rotation) {
  const body = linear(P.cars[seed % P.cars.length]);
  const glass = linear(P.window.day);
  const wheel = linear('#2f3238');
  b.at(0, 0.03, 0, rotation, (c) => {
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
  b.at(0, 0.03, 0, rotation, (c) => {
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

const BUILDERS = {
  house,
  apartment,
  shop,
  office,
  factory,
  warehouse,
  farm,
  park,
  hall,
};

/** 物体的名字形如 house-3、forest-1-6、car-2-0。 */
export function buildObject(name, P) {
  const [kind, a, c] = name.split('-');
  const seed = Number(a ?? 0);
  const b = new Builder(hashString(name));
  if (kind in BUILDERS) BUILDERS[kind](b, P, seed);
  else if (kind === 'forest') forest(b, P, seed, Number(c ?? 5));
  else if (kind === 'car') car(b, P, seed, (Number(c ?? 0) * Math.PI) / 4);
  else if (kind === 'bus') bus(b, P, (seed * Math.PI) / 4);
  else if (kind === 'boat') boat(b, P, (seed * Math.PI) / 4);
  else if (kind === 'dock') dock(b, P);
  else throw new Error(`没有这种物体：${name}`);
  return b;
}
