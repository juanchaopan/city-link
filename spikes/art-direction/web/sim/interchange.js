// 立交模板。玩家只画线，路线相交时系统按相交道路的等级自动选一个模板：
//   同级普通路 → 平交路口（信号灯）
//   快速路 × 双向四车道 → 菱形（diamond）
//   高速 × 快速路（穿过）→ 苜蓿叶（cloverleaf）
//   高速 × 快速路（到头）→ 喇叭形（trumpet）
// 模板占固定大小的地：footprint 是相对中心格的范围，含匝道的外缘。这块地不能再建物业。
// 约定快速路走高架，沿 z 方向穿过模板中心；高速和干道在地面沿 x 方向。靠右行驶：
// 向南的车在快速路西侧（x - LANE），向东的车在高速南侧（z + LANE）。
// 匝道的点是 [x, z, h]，坐标相对中心格的中心，h 是层数。

export const ELEVATED = 2;
export const LANE = 0.22;

const INTERSECTION_RULES = {
  'road|road': 'signal',
  'arterial|road': 'signal',
  'arterial|arterial': 'signal',
  'arterial|express': 'diamond',
  'express|road': 'forbidden',
  'express|highway': 'cloverleaf',
  'highway|road': 'forbidden',
  'arterial|highway': 'forbidden',
};

/** 两种路相交时用哪种做法。forbidden 表示这两级路不能直接相接。 */
export function intersectionRule(a, b, endsHere = false) {
  const key = [a, b].sort().join('|');
  const rule = INTERSECTION_RULES[key] ?? 'forbidden';
  return rule === 'cloverleaf' && endsHere ? 'trumpet' : rule;
}

function lengths(points) {
  const out = [0];
  for (let i = 1; i < points.length; i += 1) {
    out.push(out[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return out;
}

/** 把折线的角磨圆，两端的点不动，匝道和主线的接点就不变。 */
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
function graded(points, h0, h1) {
  const along = lengths(points);
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
  return turned(graded(rounded([[-extent, LANE], [-inner, LANE + 0.5], [-1.5, inner], [-LANE, extent - 0.2]]), 0, ELEVATED), quarter);
}

/** 环形匝道：向东的高速过了桥，右转绕一圈，向北上快速路。 */
function cloverleafLoop(quarter) {
  const c = 2 + LANE;
  return turned(graded(arc(c, c, 2, -Math.PI / 2, Math.PI, 18), 0, ELEVATED), quarter);
}

const TEMPLATES = {
  /** 快速路在高架上，干道从下面穿过。四条匝道落到两条短街上，短街在干道上做成两个信号路口。 */
  diamond: {
    footprint: [-4, -7, 4, 7],
    mainline: [[0, -7.5], [0, 7.5]],
    stubs: [-3, 3],
    ramps() {
      const descend = (sign, zSign, down) => {
        const high = [sign * (LANE + 0.1), zSign * 6.8];
        const middle = [sign * 1.7, zSign * 4.8];
        const foot = [sign * 3, zSign * 3];
        const end = [sign * 3, zSign * 2];
        const line = graded(rounded([high, middle, foot, end]), ELEVATED, 0);
        return down ? line : line.slice().reverse();
      };
      return [
        { name: '南向出口', points: descend(-1, -1, true) },
        { name: '南向入口', points: descend(-1, 1, false) },
        { name: '北向出口', points: descend(1, 1, true) },
        { name: '北向入口', points: descend(1, -1, false) },
      ];
    },
  },
  /** 高速在地面，快速路在高架。四条外侧匝道管右转，四个环管左转。 */
  cloverleaf: {
    footprint: [-8, -8, 8, 8],
    mainline: [[0, -8.5], [0, 8.5]],
    stubs: [],
    ramps() {
      const extent = 7.8;
      return [
        { name: '东转南', points: outerRamp(0, extent) },
        { name: '南转西', points: outerRamp(1, extent) },
        { name: '西转北', points: outerRamp(2, extent) },
        { name: '北转东', points: outerRamp(3, extent) },
        { name: '东转北', points: cloverleafLoop(0) },
        { name: '南转东', points: cloverleafLoop(1) },
        { name: '西转南', points: cloverleafLoop(2) },
        { name: '北转西', points: cloverleafLoop(3) },
      ];
    },
  },
  /** 快速路到头接高速。环形匝道和包在外面的匝道组成喇叭口，南边两条斜匝道管右转。 */
  trumpet: {
    footprint: [-8, -6, 8, 8],
    mainline: [[0, 1], [0, 8.5]],
    stubs: [],
    ramps() {
      const extent = 7.8;
      const loopX = -2 - LANE;
      const loopZ = -2.4;
      const westToSouth = graded(
        [...arc(loopX, loopZ, 2, Math.PI / 2, Math.PI, 8), ...arc(loopX, loopZ, 2, Math.PI, 2 * Math.PI, 14).slice(1), [-LANE, 1]],
        0,
        ELEVATED,
      );
      const northToWest = graded(
        [[LANE, 1], [LANE, -3], ...arc(-2.4, -3, 2.62, 0, -Math.PI, 16), [-7.6, -2.2], [-extent, -LANE]],
        ELEVATED,
        0,
      );
      return [
        { name: '东转南', points: outerRamp(0, extent) },
        { name: '北转东', points: outerRamp(3, extent) },
        { name: '西转南', points: westToSouth },
        { name: '北转西', points: northToWest },
      ];
    },
  },
};

export function template(name) {
  return TEMPLATES[name];
}

export function templateNames() {
  return Object.keys(TEMPLATES);
}

/** 模板的占地，格数和面积。素材张数：每个模板一张高架和匝道的精灵，地面部分用普通路面精灵。 */
export function templateFootprint(name) {
  const [x0, z0, x1, z1] = TEMPLATES[name].footprint;
  const w = x1 - x0 + 1;
  const h = z1 - z0 + 1;
  return { w, h, cells: w * h, ramps: TEMPLATES[name].ramps().length };
}
