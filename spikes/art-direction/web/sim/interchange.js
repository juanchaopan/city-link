// 立交模板。玩家只画线，路线相交时系统按相交道路的等级自动选一个模板：
//   同级普通路 → 平交路口（信号灯）
//   快速路 × 双向四车道 → 菱形（diamond）
//   高速 × 快速路（穿过）→ 苜蓿叶（cloverleaf）
//   高速 × 快速路（到头）→ 喇叭形（trumpet）
//   高速 × 双向四车道（到头）→ 丁字形（tee），普通城市的四车道主干就从这里上高速
// 匝道只接高速、快速路和双向四车道，双向两车道不能直接上匝道。
// 模板占固定大小的地：footprint 是相对中心格的范围，含匝道的外缘。这块地不能再建物业。
// 约定快速路走高架，沿 z 方向穿过模板中心；高速和干道在地面沿 x 方向。靠右行驶：
// 向南的车在快速路西侧（x - LANE），向东的车在高速南侧（z + LANE）。
// 匝道的点是 [x, z, h]，坐标相对中心格的中心，h 是层数。

export const ELEVATED = 2;
export const LANE = 0.22;

const ARTERIAL_LANE = 0.17;
const TEE_FOOT = 4.5;
const TEE_LAND = 3.6;
const TEE_BRIDGE = 1;

const INTERSECTION_RULES = {
  'road|road': 'signal',
  'arterial|road': 'signal',
  'arterial|arterial': 'signal',
  'arterial|express': 'diamond',
  'express|road': 'forbidden',
  'express|highway': 'cloverleaf',
  'highway|road': 'forbidden',
  'arterial|highway': 'tee',
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

/** 两点之间等分成几段，高度曲线才有足够的点。 */
function straight([ax, az], [bx, bz], steps = 8) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) points.push([ax + ((bx - ax) * i) / steps, az + ((bz - az) * i) / steps]);
  return points;
}

/** 接起几段带高度的线，相邻两段共用的端点只留一个。 */
function joined(...parts) {
  return parts.flatMap((part, index) => (index === 0 ? part : part.slice(1)));
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

/** 向西的高速绕环到高架，跨过高速，落回地面并入向南的四车道。 */
function teeLoopSouth() {
  const c = -2 - LANE;
  const climb = graded([[-1.51, -LANE], ...arc(c, c, 2, Math.PI / 2, 2 * Math.PI, 22), [-LANE, -TEE_BRIDGE]], 0, ELEVATED);
  const bridge = straight([-LANE, -TEE_BRIDGE], [-LANE, TEE_BRIDGE], 4).map(([x, z]) => [x, z, ELEVATED]);
  const landing = graded(straight([-LANE, TEE_BRIDGE], [-ARTERIAL_LANE, TEE_LAND]), ELEVATED, 0);
  return joined(climb, bridge, landing, [[-ARTERIAL_LANE, TEE_LAND, 0], [-ARTERIAL_LANE, TEE_FOOT, 0]]);
}

/** 向北的四车道爬上高架，跨过高速，绕到环的外面，落回地面并入向西的高速。 */
function teeLoopWest() {
  const rise = graded(straight([ARTERIAL_LANE, TEE_LAND], [LANE, TEE_BRIDGE]), 0, ELEVATED);
  const bridge = straight([LANE, TEE_BRIDGE], [LANE, -2.6], 6).map(([x, z]) => [x, z, ELEVATED]);
  const around = graded(rounded([...arc(-2.4, -2.6, 2.62, 0, -Math.PI, 16), [-5.02, -1.4], [-5.6, -0.5], [-6.6, -LANE], [-7.51, -LANE]], 1), ELEVATED, 0);
  return joined([[ARTERIAL_LANE, TEE_FOOT - 0.01, 0], [ARTERIAL_LANE, TEE_LAND, 0]], rise, bridge, around);
}

const TEMPLATES = {
  /** 快速路在高架上，干道从下面穿过。四条匝道落到两条短街上，短街也是四车道，在干道上做成两个信号路口。 */
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
  /**
   * 四车道到头接高速。没有快速路主线：四条匝道的一头在高速上，另一头在四车道的头上。
   * 右转的两条贴地，左转的两条各绕半个喇叭，在高架上跨过高速。
   * 匝道的端点都压在格子边界上，车从普通路网上下匝道时位置是连续的。
   */
  tee: {
    footprint: [-8, -6, 8, 4],
    mainline: [],
    stubs: [],
    ramps() {
      const side = ARTERIAL_LANE;
      const eastToSouth = rounded([[-8.49, LANE], [-7, 0.24], [-3, 1.6], [-1, 3.1], [-side, 4], [-side, TEE_FOOT]]);
      const northToEast = rounded([[side, TEE_FOOT - 0.01], [side, 4], [1, 3.1], [3, 1.6], [7, 0.24], [8.5, LANE]]);
      return [
        { name: '东转南', points: eastToSouth.map(([x, z]) => [x, z, 0]) },
        { name: '北转东', points: northToEast.map(([x, z]) => [x, z, 0]) },
        { name: '西转南', points: teeLoopSouth() },
        { name: '北转西', points: teeLoopWest() },
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

/** 模板占地的格子，超出地图的部分不算。 */
export function footprintCells(name, cx, cy, N) {
  const [x0, z0, x1, z1] = TEMPLATES[name].footprint;
  const cells = [];
  for (let y = cy + z0; y <= cy + z1; y += 1) {
    for (let x = cx + x0; x <= cx + x1; x += 1) {
      if (x >= 0 && y >= 0 && x < N && y < N) cells.push([x, y]);
    }
  }
  return cells;
}

/** 立交在地图上的物体：一张精灵，占地就是模板的范围。 */
export function templateObject(name, cx, cy) {
  const [x0, z0, x1, z1] = TEMPLATES[name].footprint;
  return {
    key: `ix-${name}`,
    px: cx + 0.5,
    py: cy + 0.5,
    level: 0,
    footprint: [[cx + x0, cy + z0], [cx + x1 + 1, cy + z0], [cx + x1 + 1, cy + z1 + 1], [cx + x0, cy + z1 + 1]],
  };
}

function station(lane, x, y) {
  let best = 0;
  let bestDistance = Infinity;
  lane.points.forEach(([px, py], i) => {
    const d = Math.hypot(px - x, py - y);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}

/**
 * 把模板的匝道接到主线和地面路网上：端点高度为 0 的一头接地面，在高架上的一头接主线。
 * main 是快速路主线的两条 lane；模板没有主线时不传，它的匝道两头都在地面。
 */
export function connectRamps({ name, cx, cy, N, main, lanes }) {
  const cellOf = ([x, y]) => Math.floor(y) * N + Math.floor(x);
  template(name).ramps().forEach((ramp, index) => {
    const points = ramp.points.map(([x, z, h]) => [x + cx + 0.5, z + cy + 0.5, h]);
    const first = points[0];
    const last = points[points.length - 1];
    const mainOf = ([x]) => (x < cx + 0.5 ? main.south : main.north);
    const lane = { id: `${name}${String(cx)}-${String(index)}`, kind: 'ramp', points, exits: [] };
    if (first[2] < 0.5) lane.fromCell = cellOf(first);
    else {
      const line = mainOf(first);
      line.exits.push({ at: station(line, first[0], first[1]), lane: lane.id });
    }
    if (last[2] < 0.5) lane.toCell = cellOf(last);
    else {
      const line = mainOf(last);
      lane.merge = { lane: line.id, at: station(line, last[0], last[1]) };
    }
    lanes.push(lane);
  });
}

/** 两头都在地面路网上的匝道，在路网图里是一条边，路网就靠它连起来。 */
export function rampLinks(lanes) {
  return lanes
    .filter(({ fromCell, toCell }) => fromCell !== undefined && toCell !== undefined)
    .map(({ fromCell, toCell, points }) => ({ from: fromCell, to: toCell, length: lengths(points).pop() }));
}
