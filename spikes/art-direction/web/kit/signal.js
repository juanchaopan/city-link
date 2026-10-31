import { Builder, hashString, linear } from './builder.js';
import { DIRECTIONS } from '../sim/network.js';

// 信号灯。dir 是这根灯所管进口的方向，从路口指向来车，灯面朝这个方向，迎着驶来的车。
// 灯杆立在进口右侧的路边，一根悬臂伸到车道上方，灯头挂在悬臂的头上。八个方向各一张。
// 灯面是单独一张白色精灵，运行时染成红、黄、绿；灯面背对相机的方向没有这一张，从背后看只有灯箱。

const POLE_HEIGHT = 0.3;
const ARM = 0.16;
const ARM_STEPS = 6;
const HEAD = [0.06, 0.13, 0.06];
const FACE_REACH = 0.032;
const FACE_RADIUS = 0.02;

function directionOf(dir) {
  const [dx, dz] = DIRECTIONS[dir];
  const length = Math.hypot(dx, dz);
  return [dx / length, dz / length];
}

/** 悬臂头相对灯杆的位置：朝路中间，也就是从来车方向看的左边。 */
function headOf(dir) {
  const [ux, uz] = directionOf(dir);
  return [-uz * ARM, ux * ARM];
}

export function buildPole(dir, P) {
  const b = new Builder(hashString(`pole${String(dir)}`));
  const steel = linear(P.wall.glassDark);
  const [ux, uz] = directionOf(dir);
  const [hx, hz] = headOf(dir);
  b.cylinder(0, 0, 0, 0.013, 0.011, POLE_HEIGHT, 6, steel);
  for (let i = 0; i <= ARM_STEPS; i += 1) {
    const t = i / ARM_STEPS;
    b.box(hx * t, POLE_HEIGHT - 0.012, hz * t, 0.016, 0.014, 0.016, steel);
  }
  const [sx, sy, sz] = HEAD;
  b.at(hx, POLE_HEIGHT - sy, hz, Math.atan2(-uz, ux), (c) => {
    c.box(0, 0, 0, sx, sy, sz, linear('#2f3238'));
  });
  return b;
}

/** 灯面看得见的方向：灯面法线朝着相机一侧。 */
export function faceVisible(dir) {
  const [ux, uz] = directionOf(dir);
  return ux + uz > 0.1;
}

export function buildLamp(dir) {
  const b = new Builder(hashString(`lamp${String(dir)}`));
  const [ux, uz] = directionOf(dir);
  const [hx, hz] = headOf(dir);
  const x = hx + ux * FACE_REACH;
  const z = hz + uz * FACE_REACH;
  const y = POLE_HEIGHT - HEAD[1] / 2;
  b.blob(x, y, z, FACE_RADIUS, FACE_RADIUS, FACE_RADIUS, linear('#ffffff'), 0);
  return b;
}
