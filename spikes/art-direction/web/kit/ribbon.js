import { LEVEL } from './bake.js';
import { linear, mix, shade } from './builder.js';

// 带状路面：沿中心线铺多边形，匝道和高架都用它。侧面和路面边共用同一组顶点，分段再多也不会裂缝；
// 拐点的顶点沿角平分线外推，两侧的边都是连续的折线。路面宽度逐点变化，合流段的路面就是一条收窄的带子。
// 一个横断面从左到右：路肩、路缘、路面、路缘、路肩。路肩宽度为 0 的一侧是开口，不画路缘，也不画护栏。

const CURB = 0.016;
const BEAM = 0.05;
const SOLID_BELOW = 0.22;
const RAIL = 0.02;
const RAIL_FROM = 0.05;
const RAIL_RANGE = 0.12;
const EDGE_INSET = 0.03;
const LINE = 0.012;
const DASH_PERIOD = 0.25;
const DASH_ON = 0.3;
const MAIN_DASH = 0.205;
const MAIN_EDGE = 0.37;
const MEDIAN = 0.026;
const FULL_SHOULDER = 0.05;

const clamp = (t) => Math.max(0, Math.min(1, t));

/** 每个点的法线沿角平分线，长度按转角放大，两侧的边到中心线的距离才是准的。 */
export function framesOf(center, band, lift = 0) {
  let travelled = 0;
  return center.map(([x, z, h], i) => {
    const before = center[Math.max(0, i - 1)];
    const after = center[Math.min(center.length - 1, i + 1)];
    const [ax, az] = before;
    const [mx, mz] = center[i];
    const [bx, bz] = after;
    const inLength = Math.hypot(mx - ax, mz - az) || 1;
    const outLength = Math.hypot(bx - mx, bz - mz) || 1;
    const inN = i === 0 ? null : [(mz - az) / inLength, -(mx - ax) / inLength];
    const outN = i === center.length - 1 ? null : [(bz - mz) / outLength, -(bx - mx) / outLength];
    const first = inN ?? outN;
    const second = outN ?? inN;
    let nx = first[0] + second[0];
    let nz = first[1] + second[1];
    const size = Math.hypot(nx, nz) || 1;
    nx /= size;
    nz /= size;
    const scale = 1 / Math.max(0.5, nx * first[0] + nz * first[1]);
    if (i > 0) travelled += inLength;
    return { x, z, y: h * LEVEL + lift, nx: nx * scale, nz: nz * scale, s: travelled, ...band[i] };
  });
}

const at = (frame, lateral, up = 0) => [
  frame.x + frame.nx * lateral,
  frame.y + up,
  frame.z + frame.nz * lateral,
];

/** 两条横向位置之间铺一条带子。a、c 是从帧取横向位置的函数，colorOf 取颜色。 */
function strip(b, frames, a, c, colorOf, up = 0, keep = () => true) {
  for (let i = 0; i < frames.length - 1; i += 1) {
    const f0 = frames[i];
    const f1 = frames[i + 1];
    if (!keep(f0, f1)) continue;
    const near = Math.abs(a(f0) - c(f0));
    const far = Math.abs(a(f1) - c(f1));
    if (near < 1e-4 && far < 1e-4) continue;
    b.poly([at(f0, a(f0), up), at(f1, a(f1), up), at(f1, c(f1), up), at(f0, c(f0), up)], colorOf(f0));
  }
}

function surfaceColors(P) {
  const asphalt = linear(P.road.asphalt);
  const highway = linear(P.road.highway);
  const walk = linear(P.road.walk);
  const shoulder = linear(P.road.shoulder);
  return {
    deck: (f) => mix(asphalt, highway, f.tone),
    side: (f) => mix(walk, shoulder, f.tone),
    curb: linear(P.road.curb),
    line: linear(P.road.line),
    median: linear(P.road.median),
  };
}

export function drawSurfaceFrames(b, frames, P) {
  const color = surfaceColors(P);
  const curbOf = (width) => Math.min(CURB, width);
  strip(b, frames, (f) => f.l, (f) => -f.r, color.deck);
  strip(b, frames, (f) => f.l, (f) => f.l + curbOf(f.sl), () => color.curb);
  strip(b, frames, (f) => f.l + curbOf(f.sl), (f) => f.l + f.sl, color.side);
  strip(b, frames, (f) => -f.r, (f) => -f.r - curbOf(f.sr), () => color.curb);
  strip(b, frames, (f) => -f.r - curbOf(f.sr), (f) => -f.r - f.sr, color.side);
}

/** 路面边线。平行车道的主线一侧画虚线，车看得出这里可以并线；外侧边线在渐变段的尖上正好接到主线的边线。 */
function drawRampLines(b, frames, P) {
  const { line } = surfaceColors(P);
  const up = 0.002;
  const hasLine = (f0) => f0.tone > 0.5 && f0.l + f0.r > EDGE_INSET * 1.2;
  strip(
    b,
    frames,
    (f) => -f.r + EDGE_INSET - LINE / 2,
    (f) => -f.r + EDGE_INSET + LINE / 2,
    () => line,
    up,
    (f0, f1) => hasLine(f0) && hasLine(f1),
  );
  strip(
    b,
    frames,
    (f) => f.l - EDGE_INSET - LINE / 2,
    (f) => f.l - EDGE_INSET + LINE / 2,
    () => line,
    up,
    (f0, f1) =>
      hasLine(f0) &&
      hasLine(f1) &&
      (!f0.dash || (f0.s / DASH_PERIOD) % 1 < DASH_ON * 2) &&
      f0.dash === f1.dash,
  );
}

/** 主线的标线：中央分隔、车道虚线和边线，和地面的高速一样。 */
function drawMainLines(b, frames, P) {
  const { line, median } = surfaceColors(P);
  const up = 0.002;
  const band = (lateral, half, color, keep) =>
    strip(b, frames, () => lateral - half, () => lateral + half, () => color, up, keep);
  const dashed = (f0) => (f0.s / DASH_PERIOD) % 1 < DASH_ON;
  band(0, MEDIAN, median);
  for (const side of [1, -1]) {
    band(side * MAIN_DASH, LINE / 2, line, dashed);
    band(side * MAIN_EDGE, LINE / 2, line);
  }
}

const bottomOf = (y) => (y < SOLID_BELOW ? 0 : y - BEAM);
const railOf = (f, width) =>
  RAIL * clamp((f.y - RAIL_FROM) / RAIL_RANGE) * clamp(width / FULL_SHOULDER);

/** 一侧的侧面。低处是实心的挡墙，高处是一道梁；开口的一侧没有护栏。 */
function drawSide(b, frames, side, P) {
  const wall = shade(linear(P.road.wall), 0.9);
  const inner = shade(linear(P.road.wall), 1.02);
  const edgeOf = (f) => (side > 0 ? f.l + f.sl : -f.r - f.sr);
  const widthOf = (f) => (side > 0 ? f.sl : f.sr);
  for (let i = 0; i < frames.length - 1; i += 1) {
    const f0 = frames[i];
    const f1 = frames[i + 1];
    if (f0.y < 0.006 && f1.y < 0.006) continue;
    const top0 = at(f0, edgeOf(f0), railOf(f0, widthOf(f0)));
    const top1 = at(f1, edgeOf(f1), railOf(f1, widthOf(f1)));
    const low0 = at(f0, edgeOf(f0));
    const low1 = at(f1, edgeOf(f1));
    const outward = [(f0.nx + f1.nx) * side, 0, (f0.nz + f1.nz) * side];
    b.poly(
      [
        [low0[0], bottomOf(f0.y), low0[2]],
        [low1[0], bottomOf(f1.y), low1[2]],
        top1,
        top0,
      ],
      wall,
      outward,
    );
    if (top0[1] > low0[1] + 1e-4 || top1[1] > low1[1] + 1e-4)
      b.poly([low0, low1, top1, top0], inner, [-outward[0], 0, -outward[2]]);
  }
}

function drawSolid(b, frames, P) {
  drawSide(b, frames, 1, P);
  drawSide(b, frames, -1, P);
}

export function drawRampFrames(b, frames, P) {
  drawSurfaceFrames(b, frames, P);
  drawRampLines(b, frames, P);
  drawSolid(b, frames, P);
}

export function drawMainFrames(b, frames, P) {
  drawSurfaceFrames(b, frames, P);
  drawMainLines(b, frames, P);
  drawSolid(b, frames, P);
}

/** 桥墩：一根柱子，顶上一道横梁，横梁垂直于路面走向。 */
export function drawPier(b, { x, z, h, wide, nx, nz }, P) {
  const concrete = linear(P.road.wall);
  const top = h * LEVEL;
  b.at(x, 0, z, Math.atan2(-nz, nx), (c) => {
    c.box(0, 0, 0, 0.1, top - 0.05, 0.1, shade(concrete, 0.92));
    c.box(0, top - 0.09, 0, wide, 0.05, 0.14, concrete);
  });
}
