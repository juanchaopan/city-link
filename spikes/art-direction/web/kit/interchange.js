import { LEVEL } from './bake.js';
import { Builder, hashString, linear, shade } from './builder.js';
import { LAYER, roadMesh } from './roadshader.js';
import { ELEVATED, template } from '../sim/interchange.js';
import { ROAD_SPEC } from '../sim/network.js';

// 高架和立交的精灵。路面还是距离场，只是抬到半空；桥墩和梁画成低多边形，这样才有投影。
// 一个立交的所有匝道画在一张图里，这张图是物体层的一个物体，和建筑一起排遮挡顺序。

const RAMP_RESOLUTION = 200;
const CHUNK_SEGMENTS = 5;

function pierAt(b, x, z, top, wide, P) {
  const concrete = linear(P.road.wall);
  b.box(x, 0, z, 0.1, top - 0.05, 0.1, shade(concrete, 0.92));
  b.box(x, top - 0.09, z, wide, 0.05, 0.14, concrete);
}

function along(points) {
  const out = [0];
  for (let i = 1; i < points.length; i += 1) {
    out.push(out[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return out;
}

/** 水平面上离折线最近的点，它的高度就是这块路面的高度。 */
function heightOnLine(points, x, z) {
  let best = Infinity;
  let height = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, az, ah] = points[i];
    const [bx, bz, bh] = points[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
    if (d < best) {
      best = d;
      height = ah + (bh - ah) * t;
    }
  }
  return height * LEVEL;
}

/** 梁：路面下面一条薄薄的侧边，让高架看起来有厚度。 */
function beam(b, points, halfWidth, P) {
  const color = shade(linear(P.road.wall), 0.9);
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, az, ah] = points[i];
    const [bx, bz, bh] = points[i + 1];
    if (ah < 0.15 && bh < 0.15) continue;
    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.hypot(dx, dz);
    const nx = -dz / length;
    const nz = dx / length;
    for (const side of [1, -1]) {
      const px = nx * side * halfWidth;
      const pz = nz * side * halfWidth;
      const ay = ah * LEVEL;
      const by = bh * LEVEL;
      b.poly([[ax + px, ay - 0.05, az + pz], [bx + px, by - 0.05, bz + pz], [bx + px, by, bz + pz], [ax + px, ay, az + pz]], color, [nx * side, 0, nz * side]);
    }
  }
}

/**
 * 路面。着色器的裁剪面是按整条路算的，环形匝道转过 270° 时，终点的裁剪面会切掉环的另一半，
 * 所以长路面切成短段，每段的转角都不大，段和段之间靠裁剪面的一点重叠接上。
 */
function deckMesh(points, kind, P, span) {
  const flat = points.map(([x, z]) => [x, z]);
  const paths = [];
  for (let i = 0; i < flat.length - 1; i += CHUNK_SEGMENTS) {
    paths.push({ points: flat.slice(i, Math.min(flat.length, i + CHUNK_SEGMENTS + 1)), kind, clipStart: true, clipEnd: true, cross: -1, chained: true });
  }
  return roadMesh(paths, P, (x, z) => heightOnLine(points, x, z), LAYER.both, span, RAMP_RESOLUTION);
}

function piersAlong(b, points, wide, P, spacing = 1.3) {
  const distance = along(points);
  const total = distance[distance.length - 1];
  for (let s = spacing / 2; s < total; s += spacing) {
    let i = 0;
    while (i < points.length - 2 && distance[i + 1] < s) i += 1;
    const t = (s - distance[i]) / (distance[i + 1] - distance[i] || 1);
    const x = points[i][0] + (points[i + 1][0] - points[i][0]) * t;
    const z = points[i][1] + (points[i + 1][1] - points[i][1]) * t;
    const h = (points[i][2] + (points[i + 1][2] - points[i][2]) * t) * LEVEL;
    if (h > 0.24) pierAt(b, x, z, h, wide, P);
  }
}

/** 一格高架。h0、h1 是这一格两端的路面高度（层），可以是坡。axis 是走向，下方的地面可以通路。 */
export function buildViaduct(axis, h0, h1, P) {
  const points = axis === 'x' ? [[-0.5, 0, h0], [0.5, 0, h1]] : [[0, -0.5, h0], [0, 0.5, h1]];
  const halfWidth = ROAD_SPEC.express.walk / 2;
  const build = () => {
    const b = new Builder(hashString(`viaduct${axis}${String(h0)}${String(h1)}`));
    beam(b, points, halfWidth, P);
    const middle = ((h0 + h1) / 2) * LEVEL;
    if (middle > 0.24) {
      const concrete = linear(P.road.wall);
      b.box(0, 0, 0, 0.12, middle - 0.05, 0.12, shade(concrete, 0.92));
      b.box(0, middle - 0.09, 0, axis === 'x' ? 0.14 : 0.8, 0.05, axis === 'x' ? 0.8 : 0.14, concrete);
    }
    return b;
  };
  return { build, extra: () => [deckMesh(points, 'express', P, 3.6)] };
}

/** 整个立交：高架主线、全部匝道和桥墩。 */
export function buildInterchange(name, P) {
  const shape = template(name);
  const main = shape.mainline.map(([x, z]) => [x, z, ELEVATED]);
  const ramps = shape.ramps();
  const [x0, z0, x1, z1] = shape.footprint;
  const span = Math.max(x1 - x0, z1 - z0) + 6;
  const build = () => {
    const b = new Builder(hashString(`interchange${name}`));
    beam(b, main, ROAD_SPEC.express.walk / 2, P);
    piersAlong(b, main, 0.8, P);
    for (const { points } of ramps) {
      beam(b, points, ROAD_SPEC.ramp.walk / 2, P);
      piersAlong(b, points, 0.34, P, 1.6);
    }
    return b;
  };
  const extra = () => [deckMesh(main, 'express', P, span), ...ramps.map(({ points }) => deckMesh(points, 'ramp', P, span))];
  return { build, extra };
}

/** 车头灯照在路面上的光斑，画在发光层上，夜里才显示。rotation 和车身的朝向一样。 */
export function addHeadlightBeam(b, rotation, reach, P) {
  const lamp = linear(P.window.lit);
  b.at(0, 0.004, 0, (rotation * Math.PI) / 4, (c) => {
    c.poly([[reach, 0, -0.05], [reach + 0.17, 0, -0.1], [reach + 0.17, 0, 0.1], [reach, 0, 0.05]], shade(lamp, 0.55), [0, 1, 0], true);
  });
}
