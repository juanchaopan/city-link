import { ROAD_SPEC } from './network.js';
import { ELEVATED, MAIN_LANE, makeRamp, plainRamp, SIDE_LANE, stationsOf } from './rampline.js';
import { SIDE_DIAMOND } from './sidediamond.js';

// 立交的线形。坐标相对中心格的中心，x 向东，z 向南，高度的单位是层。
// 约定快速路走高架，沿 z 方向穿过模板中心；高速和干道在地面沿 x 方向。靠右行驶：
// 向南的车在快速路西侧，向东的车在高速南侧。
// footprint 是占地，含匝道的外缘；ground 是从模板下面穿过的地面路，桥墩要避开；pads 是接地面路的平铺路面。
// 不合流的两条路一定不在同一高度相交，合流和分流都发生在主线右侧的平行车道上。

const ARTERIAL_LANE = 0.25;
const TEE_FOOT = 3.5;
const TEE_CELL_END = 4.49;
const TEE_LOOP = 1.2;
const TEE_STEM = 0.175;
const TEE_TAPER = 0.89;
const DIAMOND_STUB = 3;
const DIAMOND_TAPER = 0.7;
const DIAMOND_PARALLEL = 0.45;
const SPUR_END = 2.5;
const SPUR_HALF = 0.2;
const SPUR_RADIUS = 1.4;

/** 把折线的角磨圆，两端的点不动。 */
function rounded(points, passes = 2) {
  let line = points;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = [line[0]];
    for (let i = 0; i < line.length - 1; i += 1) {
      const [ax, az] = line[i];
      const [bx, bz] = line[i + 1];
      if (i > 0) next.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25]);
      if (i < line.length - 2) next.push([ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    next.push(line[line.length - 1]);
    line = next;
  }
  return line;
}

/** 给一条平面折线配上高度：两端缓和，中间匀速爬升。 */
function risen(points, h0, h1) {
  const along = stationsOf(points);
  const total = along[along.length - 1];
  return points.map(([x, z], i) => {
    const t = along[i] / total;
    return [x, z, h0 + (h1 - h0) * (t * t * (3 - 2 * t))];
  });
}

function arc(cx, cz, r, from, to, steps = 18) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = from + ((to - from) * i) / steps;
    points.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return points;
}

function rotate([x, z, h], quarter) {
  let px = x;
  let pz = z;
  for (let i = 0; i < quarter; i += 1) [px, pz] = [-pz, px];
  return [px, pz, h];
}

/** 四份里只写第 0 份。旋转奇数次后，这条匝道的起点在高架上、终点在地面，高度要翻过来。 */
function turned(points, quarter) {
  return points.map((point) => {
    const [x, z, h] = rotate(point, quarter);
    return [x, z, quarter % 2 === 0 ? h : ELEVATED - h];
  });
}

/** 外侧斜匝道：向东的高速右转向南上快速路。 */
function outerRamp(quarter, extent) {
  const inner = extent - 1;
  return turned(
    risen(
      rounded([
        [-extent, MAIN_LANE],
        [-inner, MAIN_LANE + 0.5],
        [-1.5, inner],
        [-MAIN_LANE, extent - 0.2],
      ]),
      0,
      ELEVATED,
    ),
    quarter,
  );
}

/** 环形匝道：向东的高速过了桥，右转绕一圈，向北上快速路。 */
function cloverleafLoop(quarter) {
  const c = 2 + MAIN_LANE;
  return turned(risen(arc(c, c, 2, -Math.PI / 2, Math.PI, 18), 0, ELEVATED), quarter);
}

/**
 * 丁字形：四车道到头接高速，没有快速路主线。四条匝道的一头在高速上，另一头在四车道的头上。
 * 右转的两条贴地；左转的两条并成一座双幅桥跨过高速，一条进喇叭环，一条绕到环外。
 * 四车道在桥头分成两幅，外侧车道顺着贴地匝道离开，内侧车道上桥。贴地匝道离开之前，桥头这一侧不画路肩。
 */
function teeRamps() {
  const groundFoot = { l: 0.08, r: 0.08, sl: 0, sr: 0.08, blend: 1.2, hold: 0.6 };
  const stemFoot = {
    l: 0.18,
    r: ROAD_SPEC.arterial.deck / 2 - TEE_STEM,
    sl: 0,
    sr: 0,
    blend: 1.1,
    hold: 5.4,
    holdRight: 1.6,
    lane: TEE_STEM - ARTERIAL_LANE,
  };
  const extend = [ARTERIAL_LANE, TEE_CELL_END];
  const loopX = -TEE_STEM - 2 * TEE_LOOP;
  const loopTop = -SIDE_LANE - 2 * TEE_LOOP;
  return [
    makeRamp({
      name: '东转南',
      way: [
        [-5.49, SIDE_LANE],
        [-1.7, SIDE_LANE],
        [-ARTERIAL_LANE, 3.1],
        [-ARTERIAL_LANE, TEE_FOOT],
      ],
      radii: [1.5, 1.2],
      grade: [[0, 0]],
      first: { main: { taper: TEE_TAPER, parallel: 1.8 } },
      last: { foot: groundFoot },
    }),
    makeRamp({
      name: '北转东',
      way: [
        [ARTERIAL_LANE, TEE_FOOT],
        [ARTERIAL_LANE, 3.1],
        [1.7, SIDE_LANE],
        [5.5, SIDE_LANE],
      ],
      radii: [1.2, 1.5],
      grade: [[0, 0]],
      first: { foot: { ...groundFoot, extend } },
      last: { main: { taper: TEE_TAPER, parallel: 1.8 } },
    }),
    makeRamp({
      name: '西转南',
      way: [
        [2.49, -SIDE_LANE],
        [loopX, -SIDE_LANE],
        [loopX, loopTop],
        [-TEE_STEM, loopTop],
        [-TEE_STEM, TEE_FOOT],
      ],
      radii: [TEE_LOOP, TEE_LOOP, TEE_LOOP],
      grade: [
        [3.9, 0],
        [9.3, ELEVATED],
        [11.95, ELEVATED],
        [-0.2, 0],
      ],
      first: { main: { taper: TEE_TAPER, parallel: 2.9 } },
      last: { foot: stemFoot },
    }),
    makeRamp({
      name: '北转西',
      way: [
        [TEE_STEM, TEE_FOOT],
        [TEE_STEM, -3.75],
        [-3.1, -3.75],
        [-3.1, -SIDE_LANE],
        [-5.51, -SIDE_LANE],
      ],
      radii: [1.63, 1.63, 0.9],
      grade: [
        [0.2, 0],
        [2.8, ELEVATED],
        [8.2, ELEVATED],
        [12.6, 0],
      ],
      first: { foot: { ...stemFoot, extend } },
      last: { main: { taper: TEE_TAPER, parallel: 0.6 } },
    }),
  ];
}

/** 菱形匝道从主线到短街的线形。sx、sz 是象限，s 是短街的 x，nearEnd 是接短街的那一头。 */
function diamondWay(sx, sz, s, nearEnd) {
  return [
    [sx * SIDE_LANE, sz * 5],
    [sx * SIDE_LANE, sz * 3.2],
    [sx * s, sz * 2.4],
    [sx * s, nearEnd],
  ];
}

const DIAMOND_MAIN = { taper: DIAMOND_TAPER, parallel: DIAMOND_PARALLEL };
const DIAMOND_FOOT = { l: 0.33, r: 0.33, sl: 0.08, sr: 0.08, blend: 1.2, lane: -ARTERIAL_LANE };
const DIAMOND_RADII = [0.9, 0.9];
const DESCEND = [
  [1.15, ELEVATED],
  [-0.1, 0],
];
const ASCEND = [
  [0.1, 0],
  [-1.15, ELEVATED],
];

function diamondExit(name, sx, sz, nearEnd) {
  return makeRamp({
    name,
    way: diamondWay(sx, sz, DIAMOND_STUB, nearEnd),
    radii: DIAMOND_RADII,
    grade: DESCEND,
    first: { main: DIAMOND_MAIN },
    last: { foot: DIAMOND_FOOT },
  });
}

function diamondEntrance(name, sx, sz, nearEnd) {
  return makeRamp({
    name,
    way: diamondWay(sx, sz, DIAMOND_STUB, nearEnd).reverse(),
    radii: DIAMOND_RADII,
    grade: ASCEND,
    first: { foot: DIAMOND_FOOT },
    last: { main: DIAMOND_MAIN },
  });
}

/** 菱形：四条匝道落到两条短街上，短街和干道是两个信号路口。匝道从主线右侧的平行车道分出，下到短街的头上。 */
function diamondRamps() {
  return [
    diamondExit('南向出口', -1, -1, -1.5),
    diamondEntrance('南向入口', -1, 1, 1.5),
    diamondExit('北向出口', 1, 1, 1.49),
    diamondEntrance('北向入口', 1, -1, -1.51),
  ];
}

/** 快速路的头：高速右转下来变成向南的车道，向北的车道右转并上高速，主线从这里开始。 */
function spurRamps() {
  const foot = {
    l: SPUR_HALF,
    r: SPUR_HALF,
    sl: 0,
    sr: 0.05,
    blend: 0.6,
    lane: SPUR_HALF - MAIN_LANE,
    tone: 1,
  };
  const main = { taper: TEE_TAPER, parallel: 1.3 };
  return [
    makeRamp({
      name: '东转南',
      way: [
        [-4.49, SIDE_LANE],
        [-SPUR_HALF, SIDE_LANE],
        [-SPUR_HALF, SPUR_END],
      ],
      radii: [SPUR_RADIUS],
      grade: [[0, 0]],
      first: { main },
      last: { foot },
    }),
    makeRamp({
      name: '北转东',
      way: [
        [SPUR_HALF, SPUR_END],
        [SPUR_HALF, SIDE_LANE],
        [4.5, SIDE_LANE],
      ],
      radii: [SPUR_RADIUS],
      grade: [[0, 0]],
      first: { foot },
      last: { main },
    }),
  ];
}

function cloverleafRamps() {
  const extent = 7.8;
  return [
    ['东转南', outerRamp(0, extent)],
    ['南转西', outerRamp(1, extent)],
    ['西转北', outerRamp(2, extent)],
    ['北转东', outerRamp(3, extent)],
    ['东转北', cloverleafLoop(0)],
    ['南转东', cloverleafLoop(1)],
    ['西转南', cloverleafLoop(2)],
    ['北转西', cloverleafLoop(3)],
  ].map(([name, points]) => plainRamp(name, points));
}

function trumpetRamps() {
  const extent = 7.8;
  const loopX = -2 - MAIN_LANE;
  const loopZ = -2.4;
  const westToSouth = risen(
    [
      ...arc(loopX, loopZ, 2, Math.PI / 2, Math.PI, 8),
      ...arc(loopX, loopZ, 2, Math.PI, 2 * Math.PI, 14).slice(1),
      [-MAIN_LANE, 1],
    ],
    0,
    ELEVATED,
  );
  const northToWest = risen(
    [
      [MAIN_LANE, 1],
      [MAIN_LANE, -3],
      ...arc(-2.4, -3, 2.62, 0, -Math.PI, 16),
      [-7.6, -2.2],
      [-extent, -MAIN_LANE],
    ],
    ELEVATED,
    0,
  );
  return [
    ['东转南', outerRamp(0, extent)],
    ['北转东', outerRamp(3, extent)],
    ['西转南', westToSouth],
    ['北转西', northToWest],
  ].map(([name, points]) => plainRamp(name, points));
}

const row = (z, kind) => ({
  points: [
    [-14, z, 0],
    [14, z, 0],
  ],
  half: ROAD_SPEC[kind].walk / 2,
});
const column = (x, z0, z1, kind) => ({
  points: [
    [x, z0, 0],
    [x, z1, 0],
  ],
  half: ROAD_SPEC[kind].walk / 2,
});

/** 接地面路的平铺路面：沿 z 方向，宽度、路肩和颜色从 a 过渡到 c。 */
function pad(z0, z1, a, c) {
  const steps = 6;
  const points = [];
  const band = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const half = a.half + (c.half - a.half) * t;
    const shoulder = a.shoulder + (c.shoulder - a.shoulder) * t;
    points.push([0, z0 + (z1 - z0) * t, 0]);
    band.push({
      l: half,
      r: half,
      sl: shoulder,
      sr: shoulder,
      tone: a.tone + (c.tone - a.tone) * t,
      dash: false,
    });
  }
  return { points, band };
}

const ARTERIAL_END = {
  half: ROAD_SPEC.arterial.deck / 2,
  shoulder: (ROAD_SPEC.arterial.walk - ROAD_SPEC.arterial.deck) / 2,
  tone: 0,
};
const EXPRESS_END = {
  half: ROAD_SPEC.express.deck / 2,
  shoulder: (ROAD_SPEC.express.walk - ROAD_SPEC.express.deck) / 2,
  tone: 1,
};

export const TEMPLATES = {
  diamond: {
    footprint: [-3, -5, 3, 5],
    mainline: [
      [0, -5.5],
      [0, 5.5],
    ],
    stubs: [-DIAMOND_STUB, DIAMOND_STUB],
    pads: [],
    ground: [
      row(0, 'arterial'),
      column(-DIAMOND_STUB, -2, 2, 'arterial'),
      column(DIAMOND_STUB, -2, 2, 'arterial'),
    ],
    ramps: diamondRamps,
  },
  cloverleaf: {
    footprint: [-8, -8, 8, 8],
    mainline: [
      [0, -8.5],
      [0, 8.5],
    ],
    stubs: [],
    pads: [],
    ground: [row(0, 'highway')],
    ramps: cloverleafRamps,
  },
  trumpet: {
    footprint: [-8, -6, 8, 8],
    mainline: [
      [0, 1],
      [0, 8.5],
    ],
    stubs: [],
    pads: [],
    ground: [row(0, 'highway')],
    ramps: trumpetRamps,
  },
  tee: {
    footprint: [-5, -4, 5, 4],
    mainline: [],
    stubs: [],
    pads: [pad(4.1, TEE_FOOT - 0.1, ARTERIAL_END, ARTERIAL_END)],
    ground: [row(0, 'highway'), column(0, TEE_FOOT, 12, 'arterial')],
    ramps: teeRamps,
  },
  /** 高架快速路中段的半边菱形，下面穿过的路是默认城市里这一段的路。 */
  sidediamond: SIDE_DIAMOND,
  spur: {
    footprint: [-5, 0, 4, 2],
    mainline: [],
    stubs: [],
    pads: [],
    ground: [row(0, 'highway')],
    ramps: spurRamps,
  },
  /** 快速路落地以后收成四车道：主线到这一格结束，宽度、路肩和颜色都过渡到干道。 */
  expressfoot: {
    footprint: [0, 0, 0, 0],
    mainline: [],
    stubs: [],
    pads: [pad(-0.5, 0.1, EXPRESS_END, ARTERIAL_END)],
    ground: [],
    ramps: () => [],
  },
};
