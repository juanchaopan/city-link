import { ROAD_SPEC } from './network.js';

// 匝道的几何。中心线是直线加圆弧，切线处处连续；路面宽度沿中心线变化，所以合流段的路面能和主线并在一起。
// 车走的线（points）和路面中心线（center）不是一条：车在渐变段和平行车道的全长上慢慢横移，并进主线的车道。
// 右行规则下主线永远在匝道左侧，所以路面的宽度分左右：l、r 是中心线到两侧路面边的距离，可以是负数；
// sl、sr 是两侧路肩的宽度。接主线的一侧路肩为 0，路面盖住主线的边线和路肩，这就是开口。

export const ELEVATED = 1.5;
export const MAIN_LANE = 0.29;
export const SIDE_LANE = 0.58;
export const RAMP_STEP = 0.1;

const HALF = ROAD_SPEC.ramp.deck / 2;
const SHOULDER = (ROAD_SPEC.ramp.walk - ROAD_SPEC.ramp.deck) / 2;
const MAIN_EDGE = ROAD_SPEC.highway.deck / 2;
const OPEN_EDGE = 0.36;
const LEAVE = 0.6;
const SHARE_MARGIN = 0.6;
const PLAIN_SHARE = 1.5;
const EASE = 0.25;
const CURVE_REFERENCE = 2;
const SLOPE_DROP = 0.8;
const MIN_SPEED = 0.45;
const SPEED_WINDOW = 3;

const clamp = (t) => Math.max(0, Math.min(1, t));
const smooth = (t) => {
  const v = clamp(t);
  return v * v * (3 - 2 * v);
};
const lerp = (a, b, t) => a + (b - a) * t;

function unit(a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const length = Math.hypot(dx, dz);
  return [dx / length, dz / length];
}

const angleBetween = (u, v) => Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));

/** 折线倒圆角：radii[i] 是第 i+1 个折点的半径。相邻折点的切线长之和不能超过两点距离。 */
export function filleted(waypoints, radii) {
  const points = [waypoints[0]];
  const lineTo = (to) => {
    const from = points[points.length - 1];
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (length < 1e-6) return;
    const steps = Math.max(1, Math.ceil(length / RAMP_STEP));
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      points.push([lerp(from[0], to[0], t), lerp(from[1], to[1], t)]);
    }
  };
  for (let i = 1; i < waypoints.length - 1; i += 1) {
    const corner = waypoints[i];
    const a = unit(waypoints[i - 1], corner);
    const b = unit(corner, waypoints[i + 1]);
    const angle = angleBetween(a, b);
    if (angle < 1e-6) continue;
    const radius = radii[i - 1];
    const tangent = radius * Math.tan(angle / 2);
    lineTo([corner[0] - a[0] * tangent, corner[1] - a[1] * tangent]);
    const entry = points[points.length - 1];
    const sign = Math.sign(a[0] * b[1] - a[1] * b[0]);
    const center = [entry[0] - a[1] * sign * radius, entry[1] + a[0] * sign * radius];
    const start = Math.atan2(entry[1] - center[1], entry[0] - center[0]);
    const steps = Math.ceil((radius * angle) / RAMP_STEP);
    for (let k = 1; k <= steps; k += 1) {
      const phase = start + (sign * angle * k) / steps;
      points.push([center[0] + Math.cos(phase) * radius, center[1] + Math.sin(phase) * radius]);
    }
  }
  lineTo(waypoints[waypoints.length - 1]);
  return points;
}

export function stationsOf(points) {
  const along = [0];
  for (let i = 1; i < points.length; i += 1) {
    along.push(
      along[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]),
    );
  }
  return along;
}

/** 中段匀速爬升，两头用抛物线接平，峰值坡度只比平均值高三分之一。 */
export function ease(t) {
  const v = clamp(t);
  const peak = 2 * EASE * (1 - EASE);
  if (v < EASE) return (v * v) / peak;
  if (v < 1 - EASE) return (v - EASE / 2) / (1 - EASE);
  return 1 - ((1 - v) * (1 - v)) / peak;
}

/** 给中心线配高度。stops 是 [里程, 高度]，里程是负数时从终点往回量。 */
function graded(points, stops) {
  const along = stationsOf(points);
  const total = along[along.length - 1];
  const marks = stops.map(([s, h]) => [s < 0 ? total + s : s, h]);
  return points.map(([x, z], i) => {
    const s = along[i];
    if (s <= marks[0][0]) return [x, z, marks[0][1]];
    for (let k = 0; k < marks.length - 1; k += 1) {
      const [s0, h0] = marks[k];
      const [s1, h1] = marks[k + 1];
      if (s <= s1) return [x, z, lerp(h0, h1, ease((s - s0) / (s1 - s0)))];
    }
    return [x, z, marks[marks.length - 1][1]];
  });
}

/** 接主线的一端：先是渐变段，路面从无到有；再是平行车道；离开时路面收回标准宽度，路肩才长出来。 */
function applyMain(band, { taper, parallel }, d) {
  const open = taper + parallel;
  const leave = smooth((d - open) / LEAVE);
  band.l = lerp(SIDE_LANE - OPEN_EDGE, band.l, leave);
  band.sl = lerp(0, band.sl, smooth((d - open - LEAVE) / LEAVE));
  band.dash = band.dash || d < open;
  if (d < taper) band.r = lerp(MAIN_EDGE - SIDE_LANE, band.r, smooth(d / taper));
}

/**
 * 接地面路或主线起点的一端：宽度和路肩从端头的尺寸过渡到匝道的尺寸。
 * 接地面路时路面颜色也从沥青过渡到快速路；tone 为 1 表示端头本来就是快速路的颜色。
 */
function applyFoot(band, foot, d) {
  const t = smooth(d / foot.blend);
  const heldLeft = smooth((d - (foot.hold ?? 0)) / foot.blend);
  const heldRight = smooth((d - (foot.holdRight ?? 0)) / foot.blend);
  band.l = lerp(foot.l, band.l, t);
  band.r = lerp(foot.r, band.r, t);
  band.sl = lerp(foot.sl, band.sl, heldLeft);
  band.sr = lerp(foot.sr, band.sr, heldRight);
  band.tone = Math.min(band.tone, lerp(foot.tone ?? 0, 1, t));
}

function bandAt(a, c, first, last) {
  const band = { l: HALF, r: HALF, sl: SHOULDER, sr: SHOULDER, tone: 1, dash: false };
  for (const [end, d] of [
    [first, a],
    [last, c],
  ]) {
    if (end?.main) applyMain(band, end.main, d);
    if (end?.foot) applyFoot(band, end.foot, d);
  }
  return band;
}

/** 这一端车道中线相对路面中心线向左偏多少。 */
function laneShift(end, d) {
  if (end?.main) {
    const reach = end.main.taper + end.main.parallel;
    return (SIDE_LANE - MAIN_LANE) * (1 - smooth(d / reach));
  }
  if (end?.foot?.lane) return end.foot.lane * (1 - smooth(d / end.foot.blend));
  return 0;
}

function leftNormal(center, i) {
  const a = center[Math.max(0, i - 1)];
  const c = center[Math.min(center.length - 1, i + 1)];
  const [dx, dz] = unit(a, c);
  return [dz, -dx];
}

function driveOf(center, along, first, last) {
  const total = along[along.length - 1];
  return center.map(([x, z, h], i) => {
    const [nx, nz] = leftNormal(center, i);
    const shift = laneShift(first, along[i]) + laneShift(last, total - along[i]);
    return [x + nx * shift, z + nz * shift, h];
  });
}

/** 每个点的限速系数：弯越急、坡越陡越慢。车速随半径的平方根变化，半径 2 格以上不减速。 */
export function laneSpeeds(points) {
  const along = stationsOf(points);
  return points.map((_, i) => {
    const a = Math.max(0, i - SPEED_WINDOW);
    const c = Math.min(points.length - 1, i + SPEED_WINDOW);
    const m = Math.floor((a + c) / 2);
    if (m === a || m === c) return 1;
    const turn = angleBetween(unit(points[a], points[m]), unit(points[m], points[c]));
    const reach = (along[c] - along[a]) / 2;
    const radius = turn < 1e-3 ? Infinity : reach / turn;
    const slope = Math.abs(points[c][2] - points[a][2]) / Math.sqrt(6) / (along[c] - along[a]);
    const curve = Math.min(1, Math.sqrt(radius / CURVE_REFERENCE));
    return Math.max(MIN_SPEED, curve * (1 - slope * SLOPE_DROP));
  });
}

/** 这一端和别的路面共用地面的长度：合流分流和接地面路的那几段，路面重叠是设计好的。 */
function sharedLength(end) {
  if (end?.main) return end.main.taper + end.main.parallel + 2 * LEAVE;
  if (end?.foot) return end.foot.blend + (end.foot.holdRight ?? 0) + SHARE_MARGIN;
  return 0;
}

function mainLength(end) {
  return end?.main ? end.main.taper + end.main.parallel : 0;
}

/**
 * 一条匝道。way、radii 是平面线形，grade 是高度，first、last 描述两端怎么接：
 * main 表示接主线（taper 是渐变段长，parallel 是平行车道长）；
 * foot 表示接地面路：l、r、sl、sr 是端头的宽度，blend 是过渡长度，hold、holdRight 是两侧路肩留到多远才恢复，
 * lane 是车道相对中心线向左的偏移，extend 是车从哪一点开始走，这一点在路面之外的地面路上。
 * 限速按路面中心线算，车在合流段横移不算弯。
 * shared 是两端和别的路面共用地面的里程段，mains 是平行车道的里程段，free 逐点标出车是否在这些段上。
 */
export function makeRamp({ name, way, radii, grade, first = null, last = null }) {
  const center = graded(filleted(way, radii), grade);
  const stations = stationsOf(center);
  const total = stations[stations.length - 1];
  const points = driveOf(center, stations, first, last);
  const speeds = laneSpeeds(center);
  const shared = [
    [0, sharedLength(first)],
    [total - sharedLength(last), total],
  ];
  const free = stations.map((s) => shared.some(([a, c]) => s >= a && s <= c));
  const extend = first?.foot?.extend;
  return {
    name,
    center,
    stations,
    band: stations.map((s) => bandAt(s, total - s, first, last)),
    points: extend ? [[...extend, center[0][2]], ...points] : points,
    speeds: extend ? [1, ...speeds] : speeds,
    free: extend ? [true, ...free] : free,
    shared,
    mains: [
      [0, mainLength(first)],
      [total - mainLength(last), total],
    ].filter(([a, c]) => c > a),
  };
}

/** 没有开口的匝道：中心线就是车走的线，宽度处处标准。 */
export function plainRamp(name, points) {
  const stations = stationsOf(points);
  const total = stations[stations.length - 1];
  const shared = [
    [0, PLAIN_SHARE],
    [total - PLAIN_SHARE, total],
  ];
  return {
    name,
    center: points,
    stations,
    band: points.map(() => bandAt(1e3, 1e3, null, null)),
    points,
    speeds: laneSpeeds(points),
    free: stations.map((s) => shared.some(([a, c]) => s >= a && s <= c)),
    shared,
    mains: [],
  };
}
