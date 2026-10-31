import { ROAD_SPEC } from './network.js';
import { ELEVATED, makeRamp, SIDE_LANE } from './rampline.js';

// 高架快速路中段的半边菱形。中心格在横街和主线的交点上，东侧一条短街穿过横街；
// 向北的车从南边的街区下到短街，再从北边的街区上去。南边的街区只有 3 格深，匝道要在街区里落地，
// 所以出口的线形比入口紧，坡也陡一些。主线在 z = 4 跨过东西向的干道。
// 匝道的中心线落在短街向北的车道上，车不用再横移一次，端头的路面向左铺满整条短街。

export const SIDE_STUB = 2;

const LANE = 0.25;
const FOOT = { l: 0.33 + LANE, r: 0.33 - LANE, sl: 0.08, sr: 0.08, blend: 1.3 };
const MAIN = { taper: 0.7, parallel: 0.45 };

export function sideDiamondRamps() {
  const s = SIDE_STUB + LANE;
  return [
    makeRamp({
      name: '北向出口',
      way: [
        [SIDE_LANE, 4.5],
        [SIDE_LANE, 2.75],
        [s, 2],
        [s, 1.49],
      ],
      radii: [0.8, 0.8],
      grade: [
        [1.25, ELEVATED],
        [-0.05, 0],
      ],
      first: { main: MAIN },
      last: { foot: FOOT },
    }),
    makeRamp({
      name: '北向入口',
      way: [
        [s, -1.51],
        [s, -2.4],
        [SIDE_LANE, -3.2],
        [SIDE_LANE, -5],
      ],
      radii: [0.9, 0.9],
      grade: [
        [0.1, 0],
        [-1.15, ELEVATED],
      ],
      first: { foot: FOOT },
      last: { main: MAIN },
    }),
  ];
}

const row = (z, kind) => ({
  points: [
    [-14, z, 0],
    [14, z, 0],
  ],
  half: ROAD_SPEC[kind].walk / 2,
});

export const SIDE_DIAMOND = {
  footprint: [0, -5, 2, 4],
  mainline: [
    [0, -5.5],
    [0, 4.5],
  ],
  stubs: [SIDE_STUB],
  pads: [],
  ground: [
    row(0, 'road'),
    row(4, 'arterial'),
    {
      points: [
        [-1, -7, 0],
        [-1, 7, 0],
      ],
      half: ROAD_SPEC.road.walk / 2,
    },
    {
      points: [
        [SIDE_STUB, -2, 0],
        [SIDE_STUB, 2, 0],
      ],
      half: ROAD_SPEC.arterial.walk / 2,
    },
  ],
  ramps: sideDiamondRamps,
};
