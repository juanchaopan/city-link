import { cellPaths, ROAD_SPEC, spokesOf } from './network.js';

// 路面占地的距离场，和着色器算的是同一件事：每条路的中线距离，加上路口夹角里的圆角。
// 地块、灯杆和斑马线都要知道路面实际到哪里，只看中线加半宽会漏掉圆角，锐角处的圆角能多出去好几成。

const RAY_LENGTH = 1.5;
const WALK_ROUND = 0.24;
const DECK_ROUND = 0.36;
const REACH = 2;

export const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

function segment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** 路口各方向的延长线。对向且同宽的两个方向合成一条穿过中心的直线。 */
export function junctionRays(paths) {
  if (paths.length < 2 || paths[0].chained) return [];
  const rays = paths.map((entry) => {
    const spec = ROAD_SPEC[entry.kind];
    const [ex, ez] = entry.points[entry.points.length - 1];
    const length = Math.hypot(ex, ez);
    return {
      dx: ex / length,
      dz: ez / length,
      walk: spec.walk / 2,
      deck: spec.deck / 2,
      back: 0,
      merged: false,
    };
  });
  rays.forEach((ray, i) => {
    if (ray.merged) return;
    for (let j = i + 1; j < rays.length; j += 1) {
      const other = rays[j];
      const opposite = Math.hypot(ray.dx + other.dx, ray.dz + other.dz) < 1e-6;
      if (!other.merged && opposite && other.walk === ray.walk) {
        ray.back = RAY_LENGTH;
        other.merged = true;
      }
    }
  });
  return rays.filter((ray) => !ray.merged);
}

/** 每一格的路面描述，只算一次。 */
function cellShape(entry, x, y) {
  const paths = cellPaths(entry.road, entry.highway, entry.arterial);
  const lines = paths.map((path) => ({
    walk: (ROAD_SPEC[path.kind].walk) / 2,
    deck: (ROAD_SPEC[path.kind].deck) / 2,
    points: path.points.map(([px, py]) => [px + x + 0.5, py + y + 0.5]),
  }));
  const rays = spokesOf(entry.road | entry.highway).length >= 3 ? junctionRays(paths) : [];
  return { lines, rays, cx: x + 0.5, cy: y + 0.5 };
}

function shapeDistance({ lines, rays, cx, cy }, px, py) {
  let walk = Infinity;
  let deck = Infinity;
  for (const line of lines) {
    let d = Infinity;
    for (let i = 0; i < line.points.length - 1; i += 1) {
      const [ax, ay] = line.points[i];
      const [bx, by] = line.points[i + 1];
      d = Math.min(d, segment(px, py, ax, ay, bx, by));
    }
    walk = Math.min(walk, d - line.walk);
    deck = Math.min(deck, d - line.deck);
  }
  if (rays.length > 1) {
    let roundWalk = 1e3;
    let roundDeck = 1e3;
    const ox = px - cx;
    const oy = py - cy;
    for (const ray of rays) {
      const t = Math.max(-ray.back, Math.min(RAY_LENGTH, ox * ray.dx + oy * ray.dz));
      const d = Math.hypot(ox - ray.dx * t, oy - ray.dz * t);
      roundWalk = smin(roundWalk, d - ray.walk, WALK_ROUND);
      roundDeck = smin(roundDeck, d - ray.deck, DECK_ROUND);
    }
    walk = Math.min(walk, roundWalk);
    deck = Math.min(deck, roundDeck);
  }
  return [walk, deck];
}

/** 全城路面的距离场。walk(x, y)、deck(x, y) 小于 0 表示这一点在人行道外缘或车道边缘以内。 */
export function roadField(roads, N, roundabouts = []) {
  const shapes = new Map();
  const shapeOf = (id) => {
    if (!shapes.has(id)) shapes.set(id, cellShape(roads.get(id), id % N, Math.floor(id / N)));
    return shapes.get(id);
  };
  const distance = (px, py, index) => {
    let best = Infinity;
    const x = Math.floor(px);
    const y = Math.floor(py);
    for (let j = y - REACH; j <= y + REACH; j += 1) {
      for (let i = x - REACH; i <= x + REACH; i += 1) {
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        const id = j * N + i;
        if (roads.has(id)) best = Math.min(best, shapeDistance(shapeOf(id), px, py)[index]);
      }
    }
    for (const ring of roundabouts) best = Math.min(best, ring.distance(px, py)[index]);
    return best;
  };
  return { walk: (px, py) => distance(px, py, 0), deck: (px, py) => distance(px, py, 1) };
}
