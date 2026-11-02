import { Builder, hashString, linear, shade } from './builder.js';
import { drawMainFrames, drawPier, drawRampFrames, drawSurfaceFrames, framesOf } from './ribbon.js';
import { linesOf, paintedFrames, piecesOf } from '../sim/ixpieces.js';

// 高架和立交的精灵。路面、侧面和桥墩都是多边形。
// 立交切成小块，每块是一张精灵；高架一格一张，桥墩单独一张，车才能插到桥面和桥墩中间。

const RAMP_LIFT = 0.003;
const LIFT_STEP = 0.002;
const VIADUCT_STEPS = 4;
const VIADUCT_REACH = 0.008;
const CROSS_ANGLE = Math.PI / 12;

/** 一格高架。h0、h1 是这一格两端的路面高度（层），可以是坡。 */
export function buildViaduct(axis, h0, h1, P) {
  const end = 0.5 + VIADUCT_REACH;
  const points = [];
  for (let i = 0; i <= VIADUCT_STEPS; i += 1) {
    const t = i / VIADUCT_STEPS;
    const along = -end + 2 * end * t;
    const h = h0 + (h1 - h0) * t;
    points.push(axis === 'x' ? [along, 0, h] : [0, along, h]);
  }
  const band = points.map(() => ({ l: 0.4, r: 0.4, sl: 0.05, sr: 0.05, tone: 1, dash: false }));
  const build = () => {
    const b = new Builder(hashString(`viaduct${axis}${String(h0)}${String(h1)}`));
    drawMainFrames(b, framesOf(points, band), P);
    return b;
  };
  return { build };
}

/** 一根桥墩。height 是十分之一层，angle 是横梁方向，每份 15°，wide 是横梁宽度，主线宽、匝道窄。 */
export function buildPierSprite(height, angle, wide, P) {
  const a = angle * CROSS_ANGLE;
  const b = new Builder(hashString(`pier${String(height)}${String(angle)}${String(wide)}`));
  drawPier(b, { x: 0, z: 0, h: height / 10, wide, nx: Math.cos(a), nz: Math.sin(a) }, P);
  return b;
}

/** 立交的一小块。线段两头多画几节，和相邻的块互相盖住。 */
export function buildPiece(name, index, P) {
  const piece = piecesOf(name)[index];
  const lines = linesOf(name);
  const [ox, oz] = piece.cell;
  const build = () => {
    const b = new Builder(hashString(`piece${name}${String(index)}`));
    for (const span of piece.spans) {
      const line = lines[span.line];
      const lift = RAMP_LIFT + LIFT_STEP * span.line;
      const frames = paintedFrames(framesOf(line.center, line.band, lift), line, span).map(
        (frame) => ({ ...frame, x: frame.x - ox, z: frame.z - oz }),
      );
      if (line.kind === 'main') drawMainFrames(b, frames, P);
      else if (line.kind === 'pad') drawSurfaceFrames(b, frames, P);
      else drawRampFrames(b, frames, P);
    }
    return b;
  };
  return { build, low: piece.low };
}

/** 车头灯照在路面上的光斑，画在发光层上，夜里才显示。rotation 和车身的朝向一样。 */
export function addHeadlightBeam(b, rotation, reach, P) {
  const lamp = linear(P.window.lit);
  b.at(0, 0.004, 0, (rotation * Math.PI) / 4, (c) => {
    c.poly(
      [
        [reach, 0, -0.05],
        [reach + 0.17, 0, -0.1],
        [reach + 0.17, 0, 0.1],
        [reach, 0, 0.05],
      ],
      shade(lamp, 0.55),
      [0, 1, 0],
      true,
    );
  });
}
