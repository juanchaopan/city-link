// 路网的几何定义。纯函数，不依赖图形库，客户端和服务端以后可以共用。
// 坐标约定：格子 (x, y) 占 [x, x+1] × [y, y+1]，格子中心是 (x+0.5, y+0.5)。

export const DIRECTIONS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

// 四级道路加匝道。access 表示建筑能不能直接接这种路；不能接的路只从匝道或互通进出。
export const ROAD_SPEC = {
  road: { walk: 0.66, deck: 0.46, lanes: 2, access: true },
  arterial: { walk: 0.82, deck: 0.66, lanes: 4, access: true },
  express: { walk: 0.9, deck: 0.8, lanes: 4, access: false },
  highway: { walk: 0.9, deck: 0.8, lanes: 6, access: false },
  ramp: { walk: 0.46, deck: 0.36, lanes: 1, access: false },
};

export function spokesOf(mask) {
  const spokes = [];
  for (let d = 0; d < 8; d += 1) if (mask & (1 << d)) spokes.push(d);
  return spokes;
}

export function spokeEnd(dir) {
  const [dx, dy] = DIRECTIONS[dir];
  return [dx * 0.5, dy * 0.5];
}

function bezier(a, c, steps = 8) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push([(1 - t) * (1 - t) * a[0] + t * t * c[0], (1 - t) * (1 - t) * a[1] + t * t * c[1]]);
  }
  return points;
}

/** 两条线路相交的最小夹角决定斑马线退到路口多远的地方。 */
function crossDistance(dir, spokes, walk) {
  let smallest = Math.PI;
  for (const other of spokes) {
    if (other === dir) continue;
    const steps = Math.min((other - dir + 8) % 8, (dir - other + 8) % 8);
    smallest = Math.min(smallest, (steps * Math.PI) / 4);
  }
  return walk / 2 / Math.tan(smallest / 2) + 0.04;
}

/** 四车道接两车道：一格之内分段收窄，每段的宽度单独给，边线是连续的斜线。 */
function taperPath(start, end, fromKind, toKind) {
  const steps = 8;
  const from = ROAD_SPEC[fromKind];
  const to = ROAD_SPEC[toKind];
  const points = [];
  const widths = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]);
  }
  for (let i = 0; i < steps; i += 1) {
    const t = (i + 0.5) / steps;
    const eased = t * t * (3 - 2 * t);
    widths.push({
      walk: from.walk + (to.walk - from.walk) * eased,
      deck: from.deck + (to.deck - from.deck) * eased,
    });
  }
  return { points, kind: fromKind, widths, clipStart: true, clipEnd: true, cross: -1 };
}

/**
 * 一格里的路面中线，坐标相对格子中心。
 * 两个方向的路连成一条线：对向是直线，转弯用二次贝塞尔，切线正好是两端的方向，所以和相邻格平滑相接。
 * 三个方向以上是路口，每个方向一条从中心出发的线。
 * 只有一个方向的格子是断头路，起点用平切，路面不会以圆头结束。
 * arterialMask 是 roadMask 里属于双向四车道的方向。
 */
export function cellPaths(roadMask, highwayMask, arterialMask = 0) {
  const mask = roadMask | highwayMask;
  const spokes = spokesOf(mask);
  const kindOf = (dir) => {
    if (highwayMask & (1 << dir)) return 'highway';
    return arterialMask & (1 << dir) ? 'arterial' : 'road';
  };
  if (spokes.length === 2) {
    const [a, c] = spokes;
    const start = spokeEnd(a);
    const end = spokeEnd(c);
    const straight = (a + 4) % 8 === c;
    if (kindOf(a) === kindOf(c)) {
      return [
        {
          points: straight ? [start, end] : bezier(start, end),
          kind: kindOf(a),
          clipStart: true,
          clipEnd: true,
          cross: -1,
        },
      ];
    }
    const local = (dir) => kindOf(dir) !== 'highway';
    if (straight && local(a) && local(c)) return [taperPath(start, end, kindOf(a), kindOf(c))];
  }
  return spokes.map((dir) => {
    const kind = kindOf(dir);
    const cross = spokes.length > 1 ? crossDistance(dir, spokes, ROAD_SPEC[kind].walk) : -1;
    return {
      points: [[0, 0], spokeEnd(dir)],
      kind,
      clipStart: spokes.length === 1,
      clipEnd: true,
      cross,
    };
  });
}

/** 全图的路面中线，用于检查地块有没有压到路上。 */
export function worldPolylines(roads, N) {
  const lines = [];
  for (const id of [...roads.keys()].sort((a, b) => a - b)) {
    const { road, highway, arterial = 0 } = roads.get(id);
    const x = id % N;
    const y = Math.floor(id / N);
    for (const path of cellPaths(road, highway, arterial)) {
      lines.push({
        cell: id,
        kind: path.kind,
        half: ROAD_SPEC[path.kind].walk / 2,
        points: path.points.map(([px, py]) => [px + x + 0.5, py + y + 0.5]),
      });
    }
  }
  return lines;
}

function pointSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function cross(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function segmentsCross(a, b, c, d) {
  const d1 = cross(a[0], a[1], b[0], b[1], c[0], c[1]);
  const d2 = cross(a[0], a[1], b[0], b[1], d[0], d[1]);
  const d3 = cross(c[0], c[1], d[0], d[1], a[0], a[1]);
  const d4 = cross(c[0], c[1], d[0], d[1], b[0], b[1]);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** 两条线段的最短距离。 */
export function segmentDistance(a, b, c, d) {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(
    pointSegment(a[0], a[1], c[0], c[1], d[0], d[1]),
    pointSegment(b[0], b[1], c[0], c[1], d[0], d[1]),
    pointSegment(c[0], c[1], a[0], a[1], b[0], b[1]),
    pointSegment(d[0], d[1], a[0], a[1], b[0], b[1]),
  );
}

function pointInConvex(point, polygon) {
  let sign = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const value = cross(a[0], a[1], b[0], b[1], point[0], point[1]);
    if (value === 0) continue;
    if (sign === 0) sign = Math.sign(value);
    else if (Math.sign(value) !== sign) return false;
  }
  return true;
}

/** 凸多边形到折线的最短距离，折线穿过或落在多边形里时是 0。 */
export function polygonDistance(polygon, points) {
  let best = Infinity;
  for (const point of points) if (pointInConvex(point, polygon)) return 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    for (let j = 0; j < points.length - 1; j += 1) {
      best = Math.min(best, segmentDistance(a, b, points[j], points[j + 1]));
      if (best === 0) return 0;
    }
  }
  return best;
}

export function polygonInConvex(inner, outer) {
  return inner.every((point) => pointInConvex(point, outer));
}

export function polygonArea(polygon) {
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}
