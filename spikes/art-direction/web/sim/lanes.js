import { DIRECTIONS } from './network.js';

// 一格里的车道中线。车流和路口的进出连线表用同一份，表里写的线就是车走的线。
// 进来的一头按进来那条路的车道偏移，出去的一头按出去那条路的车道偏移：
// 两车道转进四车道时进来的一头还在两车道的车道上，不会因为出口宽就挪到进口路的路缘上。
// 转弯的控制点是两条车道线的交点，45° 的弯里车道才和路面中线平行。
// 夹角 45° 的急弯里交点可能贴着起点，甚至落到起点后面，二次曲线会一下拐死或者先倒退。
// 这时用三次曲线，先开到路口中间再绕回来，两头的切线照样对齐车道，点也取得更密。

export const LANE_OFFSET = { road: 0.115, arterial: 0.25, highway: 0.29, express: 0.29, ramp: 0 };
const TURNS = 10;
const TIGHT_TURNS = 32;
const LANE_STEPS = 6;
const CUBIC_REACH = 0.9;
const BALANCE = 0.35;

export function unitDirection(dir) {
  const [dx, dy] = DIRECTIONS[dir];
  const length = Math.hypot(dx, dy);
  return [dx / length, dy / length];
}

/** 这一格朝 dir 方向的路是哪一级。 */
export function laneKind(entry, dir) {
  const bit = 1 << dir;
  if (entry.highway & bit) return 'highway';
  return (entry.arterial ?? 0) & bit ? 'arterial' : 'road';
}

/** 两条车道线的交点，相对格子中心。normalA、normalB 是单位法向，掉头时两条线平行，取两个偏移的和。 */
function laneCorner(normalA, offsetA, normalB, offsetB) {
  const cosine = normalA[0] * normalB[0] + normalA[1] * normalB[1];
  const parallel = 1 - cosine * cosine < 1e-6;
  const a = parallel ? offsetA : (offsetA - offsetB * cosine) / (1 - cosine * cosine);
  const b = parallel ? offsetB : (offsetB - offsetA * cosine) / (1 - cosine * cosine);
  return [normalA[0] * a + normalB[0] * b, normalA[1] * a + normalB[1] * b];
}

function quadraticLane(start, control, end) {
  const points = [];
  for (let i = 0; i <= TURNS; i += 1) {
    const t = i / TURNS;
    const a = (1 - t) * (1 - t);
    const b = 2 * t * (1 - t);
    const c = t * t;
    points.push([
      a * start[0] + b * control[0] + c * end[0],
      a * start[1] + b * control[1] + c * end[1],
    ]);
  }
  return points;
}

function cubicLane(start, first, second, end) {
  const points = [];
  for (let i = 0; i <= TIGHT_TURNS; i += 1) {
    const t = i / TIGHT_TURNS;
    const s = 1 - t;
    const weights = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
    points.push(
      [0, 1].map(
        (axis) =>
          weights[0] * start[axis] +
          weights[1] * first[axis] +
          weights[2] * second[axis] +
          weights[3] * end[axis],
      ),
    );
  }
  return points;
}

/**
 * 一格里从 from 方向进来、往 to 方向出去的车道中线。靠右行驶，所以进出都偏向各自行进方向的右侧，
 * 偏移量各按进来那条路和出去那条路算。
 */
export function cellLane(x, y, from, to, fromKind, toKind) {
  const [fx, fy] = unitDirection(from);
  const [tx, ty] = unitDirection(to);
  const offsetFrom = LANE_OFFSET[fromKind];
  const offsetTo = LANE_OFFSET[toKind];
  const cx = x + 0.5;
  const cy = y + 0.5;
  const reachFrom = Math.hypot(...DIRECTIONS[from]) / 2;
  const reachTo = Math.hypot(...DIRECTIONS[to]) / 2;
  const start = [cx + fx * reachFrom + fy * offsetFrom, cy + fy * reachFrom - fx * offsetFrom];
  const end = [cx + tx * reachTo - ty * offsetTo, cy + ty * reachTo + tx * offsetTo];
  if (Math.abs(fx * tx + fy * ty + 1) < 1e-6) {
    const points = [];
    for (let i = 0; i <= LANE_STEPS; i += 1) {
      const t = i / LANE_STEPS;
      points.push([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]);
    }
    return points;
  }
  const corner = laneCorner([fy, -fx], offsetFrom, [-ty, tx], offsetTo);
  const control = [cx + corner[0], cy + corner[1]];
  const lead = -(control[0] - start[0]) * fx - (control[1] - start[1]) * fy;
  const trail = (end[0] - control[0]) * tx + (end[1] - control[1]) * ty;
  if (Math.min(lead, trail) >= BALANCE * Math.max(lead, trail))
    return quadraticLane(start, control, end);
  return cubicLane(
    start,
    [start[0] - fx * CUBIC_REACH, start[1] - fy * CUBIC_REACH],
    [end[0] - tx * CUBIC_REACH, end[1] - ty * CUBIC_REACH],
    end,
  );
}
