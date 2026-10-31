import { cellPaths } from './network.js';

// 地形和路面的高度，单位是层。素材、车流、灯杆和检查都用这一份，画出来的路和车走的路才是同一个高度。
// 角点高度按四分之一层取整，一层 32 像素，四分之一层是 8 像素，所以地面仍然落在整数像素上。

const SHAPE_STEP = 4;

export const smooth = (t) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/**
 * 四个角的高度插值，u、v 从格子一角量起，都在 0 到 1 之间。插值用平滑曲线，格子边界处的坡度正好是 0，
 * 所以坡到平地的过渡是连续的，不会出现一条折线。corners 依次是 (-,-)、(+,-)、(+,+)、(-,+)。
 */
export function cornerHeight([a, b, c, d], u, v) {
  const su = smooth(u);
  const sv = smooth(v);
  return a * (1 - su) * (1 - sv) + b * su * (1 - sv) + c * su * sv + d * (1 - su) * sv;
}

/** 同样四个角的线性外推。路基的边会伸到邻格，这时用坡面的延长线，相邻两格算出来的才是同一个面。 */
export function cornerPlane([a, b, c, d], u, v) {
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * u * v + d * (1 - u) * v;
}

/** 一格坡路的路面高度，单位是层。grade 是两端高度和两端切线。 */
export function hermite([h0, h1, m0, m1], t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * h0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * h1 + (t3 - t2) * m1
  );
}

/** 精灵名字里的地形形状：四个角相对最低角的高度，每个角一位十六进制，单位是四分之一层。 */
export function shapeOf(corners, level) {
  return corners.map((value) => Math.round((value - level) * SHAPE_STEP).toString(16)).join('');
}

export function cornersOfShape(text) {
  return [...text].map((digit) => parseInt(digit, 16) / SHAPE_STEP);
}

export function roundToShape(value) {
  return Math.round(value * SHAPE_STEP) / SHAPE_STEP;
}

/** 路面中线的参数：点到这一格直路两端连线上的位置，0 到 1。 */
function alongPath(points, px, py) {
  const [a, c] = [points[0], points[points.length - 1]];
  const dx = c[0] - a[0];
  const dy = c[1] - a[1];
  const t = ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy);
  return Math.max(0, Math.min(1, t));
}

/**
 * 地面坐标上的路面高度。平地是这一格的高度；连续坡段按整段纵坡；其余坡上的格子路面贴着地形。
 * 桥格的高度是 0，和桥面精灵一致。
 */
export function surfaceOf({ N, roads, cornersOf, levelOf, isFlat, isWater, grades }) {
  return (px, py) => {
    const x = Math.max(0, Math.min(N - 1, Math.floor(px)));
    const y = Math.max(0, Math.min(N - 1, Math.floor(py)));
    if (isWater(x, y)) return 0;
    const level = levelOf(x, y);
    if (isFlat(x, y)) return level;
    const u = px - x;
    const v = py - y;
    const grade = grades.get(y * N + x);
    if (!grade) return cornerHeight(cornersOf(x, y), u, v);
    const { road, highway, arterial } = roads.get(y * N + x);
    const [{ points }] = cellPaths(road, highway, arterial);
    return level + hermite(grade, alongPath(points, u - 0.5, v - 0.5));
  };
}
