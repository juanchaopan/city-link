// 平面上凸多边形的两个基本运算，立交切块、绘制顺序和检查脚本共用。

/** 凸包，单调链法。 */
export function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const point of list) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], point) <= 0)
        out.pop();
      out.push(point);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/** polygon 的某条边的法线上，p 和 q 的投影分得开。 */
function separated(p, q, polygon) {
  for (let i = 0; i < polygon.length; i += 1) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % polygon.length];
    const nx = by - ay;
    const ny = ax - bx;
    const project = (list) => list.map(([x, y]) => x * nx + y * ny);
    const a = project(p);
    const b = project(q);
    if (Math.max(...a) <= Math.min(...b) || Math.max(...b) <= Math.min(...a)) return true;
  }
  return false;
}

/** 分离轴：两个凸多边形在所有边的法线上都有重叠才算相交，只碰到边不算。 */
export const convexOverlap = (p, q) => !separated(p, q, p) && !separated(p, q, q);
