import { filleted, stationsOf } from './rampline.js';

// 地铁示例。每条线独立，是一根线或一个环，不分叉。
// 两条线相交时，只有两条线都在交点设站才是换乘站；否则只是从地下穿过。
// 隧道有最小转弯半径，这是物理限制：线路图和实际走线是同一条线，玩家画的折线自动倒成这个半径的圆弧；
// 折线太短放不下圆弧时记下来提示玩家，不能悄悄画一个急弯。
// 车站在地下，地面有一个占一格的站厅，放在线路旁边的路边，入口朝向人行道。

export const MIN_RADIUS = 2;

const COLORS = ['#d9413a', '#2f7fd1', '#e0a100'];
const HALL_SPOTS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];
const SIDES = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/** 折线倒圆弧。放不下圆弧的拐角记在 tight 里，这一处用放得下的最大半径，线路仍然是连续的。 */
export function railLine(points, loop, radius = MIN_RADIUS) {
  const way = points.map(([x, y]) => [x + 0.5, y + 0.5]);
  const corners = loop ? way.slice(0, -1) : way.slice(1, -1);
  const tight = [];
  const count = corners.length;
  const radii = corners.map((corner, i) => {
    const before = loop ? corners[(i + count - 1) % count] : way[i];
    const after = loop ? corners[(i + 1) % count] : way[i + 2];
    const inLength = Math.hypot(corner[0] - before[0], corner[1] - before[1]);
    const outLength = Math.hypot(after[0] - corner[0], after[1] - corner[1]);
    const a = (corner[0] - before[0]) / inLength;
    const b = (corner[1] - before[1]) / inLength;
    const c = (after[0] - corner[0]) / outLength;
    const d = (after[1] - corner[1]) / outLength;
    const half = Math.acos(Math.max(-1, Math.min(1, a * c + b * d))) / 2;
    if (half < 1e-6) return radius;
    const room = Math.min(inLength, outLength) / 2;
    const largest = room / Math.tan(half);
    if (largest < radius) tight.push({ corner: points[i], largest });
    return Math.min(radius, largest);
  });
  if (!loop) return { path: filleted(way, radii), tight };
  const start = [(way[0][0] + way[1][0]) / 2, (way[0][1] + way[1][1]) / 2];
  const opened = [start, ...way.slice(1, -1), way[0], start];
  const rotated = [...radii.slice(1), radii[0]];
  return { path: filleted(opened, rotated), tight };
}

function cellsAlong(points) {
  const cells = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    let [x, y] = points[i];
    const [tx, ty] = points[i + 1];
    cells.push([x, y]);
    while (x !== tx || y !== ty) {
      x += Math.sign(tx - x);
      y += Math.sign(ty - y);
      if (x !== tx || y !== ty) cells.push([x, y]);
    }
  }
  cells.push(points[points.length - 1]);
  return cells;
}

function degreeCheck(line) {
  const links = new Map();
  const add = (a, b) => {
    const key = a.join(',');
    if (!links.has(key)) links.set(key, new Set());
    links.get(key).add(b.join(','));
  };
  const cells = cellsAlong(line.points);
  for (let i = 0; i < cells.length - 1; i += 1) {
    add(cells[i], cells[i + 1]);
    add(cells[i + 1], cells[i]);
  }
  return [...links.values()].every((set) => set.size <= 2);
}

/** 车站落在线路上：取线路上离折线上这一点最近的点。 */
function snapToLine(path, [x, y]) {
  let best = path[0];
  let distance = Infinity;
  for (const point of path) {
    const d = Math.hypot(point[0] - x - 0.5, point[1] - y - 0.5);
    if (d < distance) {
      distance = d;
      best = point;
    }
  }
  return best;
}

export function metroPlan(plan) {
  const { columns, rows } = plan;
  const c = (i) => columns[Math.min(i, columns.length - 1)];
  const r = (i) => rows[Math.min(i, rows.length - 1)];
  const west = columns[0] - 1;
  const east = columns[columns.length - 1] + 1;
  const ringWest = c(2) + 1;
  const ringEast = c(4);
  const ringNorth = r(0);
  const ringSouth = r(2);

  const lines = [
    {
      id: 1,
      name: '1 号线',
      color: COLORS[0],
      loop: false,
      points: [
        [west, r(1)],
        [east, r(1)],
      ],
      stations: [
        [west, r(1)],
        [c(1), r(1)],
        [ringWest, r(1)],
        [east, r(1)],
      ],
    },
    {
      id: 2,
      name: '2 号线',
      color: COLORS[1],
      loop: true,
      points: [
        [ringWest, ringNorth],
        [ringEast, ringNorth],
        [ringEast, ringSouth],
        [ringWest, ringSouth],
        [ringWest, ringNorth],
      ],
      stations: [
        [ringWest + 3, ringNorth],
        [ringEast, ringNorth + 3],
        [ringEast - 3, ringSouth],
        [ringWest, ringNorth + 7],
        [ringWest, r(1)],
      ],
    },
    {
      id: 3,
      name: '3 号线',
      color: COLORS[2],
      loop: false,
      points: [
        [c(1), r(0) - 1],
        [c(1), r(rows.length - 1) + 1],
      ],
      stations: [
        [c(1), r(0) - 1],
        [c(1), r(1)],
        [c(1), r(rows.length - 1) + 1],
      ],
    },
  ].map((line) => {
    const { path, tight } = railLine(line.points, line.loop);
    return { ...line, path, tight, platforms: line.stations.map((s) => snapToLine(path, s)) };
  });

  const crossings = [];
  for (let a = 0; a < lines.length; a += 1) {
    for (let b = a + 1; b < lines.length; b += 1) {
      const cellsB = new Set(cellsAlong(lines[b].points).map((cell) => cell.join(',')));
      const seen = new Set();
      for (const cell of cellsAlong(lines[a].points)) {
        const key = cell.join(',');
        if (!cellsB.has(key) || seen.has(key)) continue;
        seen.add(key);
        const hasStation = (line) => line.stations.some((s) => s.join(',') === key);
        crossings.push({
          x: cell[0],
          y: cell[1],
          lines: [lines[a].id, lines[b].id],
          interchange: hasStation(lines[a]) && hasStation(lines[b]),
        });
      }
    }
  }
  return { lines, crossings, halls: [] };
}

/**
 * 站厅落到地面：线路车站的旁边找一格空地，入口朝向相邻的路。isFree 说这一格能不能用。
 * 空地都被建筑占了时，这一站走征收流程（expropriate.js），这里只在空地上放。
 */
export function placeHalls(metro, { N, roads, isFree }) {
  const taken = new Set();
  const halls = [];
  for (const line of metro.lines) {
    for (const [x, y] of line.stations) {
      const key = `${String(x)},${String(y)}`;
      if (taken.has(key)) continue;
      taken.add(key);
      for (const [dx, dy] of HALL_SPOTS) {
        const hx = x + dx;
        const hy = y + dy;
        const id = hy * N + hx;
        if (!isFree(hx, hy) || halls.some((hall) => hall.id === id)) continue;
        const side = SIDES.findIndex(([sx, sy]) => roads.has((hy + sy) * N + hx + sx));
        if (side < 0) continue;
        halls.push({ id, x: hx, y: hy, side, station: [x, y], line: line.id });
        break;
      }
    }
  }
  metro.halls = halls;
  return halls;
}

export function metroCheck({ lines, crossings }) {
  return {
    lines: lines.length,
    branching: lines.filter((line) => !degreeCheck(line)).map((line) => line.id),
    loops: lines.filter((line) => line.loop).length,
    interchanges: crossings.filter((crossing) => crossing.interchange).length,
    passThroughs: crossings.filter((crossing) => !crossing.interchange).length,
  };
}

/** 线路最急的地方：相邻三点算圆半径。 */
export function tightestRadius(path) {
  const along = stationsOf(path);
  let smallest = Infinity;
  for (let i = 2; i < path.length - 2; i += 1) {
    const [ax, ay] = path[i - 2];
    const [mx, my] = path[i];
    const [bx, by] = path[i + 2];
    const u = Math.atan2(my - ay, mx - ax);
    const v = Math.atan2(by - my, bx - mx);
    const turn = Math.abs(Math.atan2(Math.sin(v - u), Math.cos(v - u)));
    if (turn < 1e-3) continue;
    smallest = Math.min(smallest, (along[i + 2] - along[i - 2]) / 2 / turn);
  }
  return smallest;
}
