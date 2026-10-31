'use strict';

const DIR8 = [
  [0, -1], [1, 0], [0, 1], [-1, 0],
  [1, -1], [1, 1], [-1, 1], [-1, -1],
];
const BRIDGE_SPAN = 5;

function isOuter(side, sx, sy) {
  return (side === 'W' && sx === 0) || (side === 'E' && sx === 7) || (side === 'N' && sy === 0) || (side === 'S' && sy === 7);
}

function tileShape(h, V, x, y) {
  const a = h[y * V + x];
  const b = h[y * V + x + 1];
  const c = h[(y + 1) * V + x + 1];
  const d = h[(y + 1) * V + x];
  const lowest = Math.min(a, b, c, d);
  return ((a - lowest) << 3) | ((b - lowest) << 2) | ((c - lowest) << 1) | (d - lowest);
}

const SHAPE_AXIS = {
  0: { kind: 'flat', axes: [] },
  12: { kind: 'ramp', axes: [0] },
  3: { kind: 'ramp', axes: [0] },
  9: { kind: 'ramp', axes: [1] },
  6: { kind: 'ramp', axes: [1] },
  8: { kind: 'corner', axes: [3] },
  2: { kind: 'corner', axes: [3] },
  4: { kind: 'corner', axes: [2] },
  1: { kind: 'corner', axes: [2] },
  14: { kind: 'corner', axes: [2] },
  11: { kind: 'corner', axes: [2] },
  13: { kind: 'corner', axes: [3] },
  7: { kind: 'corner', axes: [3] },
  10: { kind: 'saddle', axes: [] },
  5: { kind: 'saddle', axes: [] },
};
const AXIS_OF_DIR = [0, 1, 0, 1, 2, 3, 2, 3];

function connectionTiles(cluster, sx, sy) {
  const { N } = cluster;
  const mid = N >> 1;
  const list = [];
  if (!isOuter('W', sx, sy)) list.push([0, mid]);
  if (!isOuter('E', sx, sy)) list.push([N - 1, mid]);
  if (!isOuter('N', sx, sy)) list.push([mid, 0]);
  if (!isOuter('S', sx, sy)) list.push([mid, N - 1]);
  return list;
}

// 路网按“方向 + 地块”做广度优先搜索。除鞍形地块外，所有坡地都能走八个方向，切坡路基负责把路面放平。
function roadSearch(terrain, rule) {
  const { N, h, water } = terrain;
  const V = N + 1;
  const states = N * N * 8;
  const parent = new Int32Array(states).fill(-2);
  const queue = new Int32Array(states);
  let head = 0;
  let tail = 0;
  const center = (N / 2) | 0;
  const start = center * N + center;
  const shapeOf = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) shapeOf[y * N + x] = tileShape(h, V, x, y);
  const canEnter = (t) => {
    if (water[t]) return false;
    const shape = SHAPE_AXIS[shapeOf[t]];
    return Boolean(shape) && shape.kind !== 'saddle';
  };
  for (let d = 0; d < 8; d++) {
    const s = start * 8 + d;
    parent[s] = -1;
    queue[tail++] = s;
  }
  while (head < tail) {
    const s = queue[head++];
    const t = (s / 8) | 0;
    const d = s % 8;
    const x = t % N;
    const y = (t / N) | 0;
    const flatHere = SHAPE_AXIS[shapeOf[t]].kind === 'flat';
    for (let nd = 0; nd < 8; nd++) {
      if (!flatHere && nd !== d) continue;
      const dx = DIR8[nd][0];
      const dy = DIR8[nd][1];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const nt = ny * N + nx;
      if (water[nt]) {
        if (!rule.bridge) continue;
        let span = 1;
        let bx = nx + dx;
        let by = ny + dy;
        while (span < BRIDGE_SPAN && bx >= 0 && by >= 0 && bx < N && by < N && water[by * N + bx]) {
          span++;
          bx += dx;
          by += dy;
        }
        if (bx < 0 || by < 0 || bx >= N || by >= N || water[by * N + bx]) continue;
        const landing = by * N + bx;
        if (!canEnter(landing)) continue;
        const ns = landing * 8 + nd;
        if (parent[ns] === -2) {
          parent[ns] = s;
          queue[tail++] = ns;
        }
        continue;
      }
      if (!canEnter(nt)) continue;
      if (nd >= 4) {
        const sideA = ny * N + x;
        const sideB = y * N + nx;
        if (water[sideA] || water[sideB]) continue;
      }
      const ns = nt * 8 + nd;
      if (parent[ns] === -2) {
        parent[ns] = s;
        queue[tail++] = ns;
      }
    }
  }
  return { parent, shapeOf };
}

function pathPieces(search, target, N, pieces) {
  let best = -1;
  for (let d = 0; d < 8; d++) {
    if (search.parent[target * 8 + d] !== -2) {
      best = target * 8 + d;
      break;
    }
  }
  if (best < 0) return false;
  for (let s = best; s >= 0; s = search.parent[s]) {
    const t = (s / 8) | 0;
    const d = s % 8;
    const kind = SHAPE_AXIS[search.shapeOf[t]].kind;
    const key = `${kind}:${d >= 4 ? 'diagonal' : 'straight'}:${search.shapeOf[t]}:${AXIS_OF_DIR[d]}`;
    pieces[key] = (pieces[key] || 0) + 1;
    const p = search.parent[s];
    if (p >= 0) {
      const pt = (p / 8) | 0;
      const gap = Math.max(Math.abs(pt % N - t % N), Math.abs(((pt / N) | 0) - ((t / N) | 0)));
      if (gap > 1) {
        const bridgeKey = `bridge:${AXIS_OF_DIR[d]}`;
        pieces[bridgeKey] = (pieces[bridgeKey] || 0) + 1;
      }
    }
  }
  return true;
}

function measure(terrain, cluster) {
  const { N, h, water, forest, mineral } = terrain;
  const V = N + 1;
  let flat = 0;
  let forestTiles = 0;
  let waterTiles = 0;
  let hillTiles = 0;
  let mineralTiles = 0;
  const shapes = {};
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const t = y * N + x;
      const shape = tileShape(h, V, x, y);
      shapes[shape] = (shapes[shape] || 0) + 1;
      if (water[t]) {
        waterTiles++;
        continue;
      }
      if (shape === 0) flat++;
      if (forest[t]) forestTiles++;
      if (mineral[t]) mineralTiles++;
      if (h[y * V + x] >= 2) hillTiles++;
    }
  }
  const area = N * N;
  const targets = connectionTiles(cluster, terrain.sx, terrain.sy);
  const noBridge = roadSearch(terrain, { bridge: false });
  const withBridge = roadSearch(terrain, { bridge: true });
  const pieces = {};
  let reachNoBridge = 0;
  let reachBridge = 0;
  for (const [x, y] of targets) {
    const t = y * N + x;
    if (pathPieces(noBridge, t, N, {})) reachNoBridge++;
    if (pathPieces(withBridge, t, N, pieces)) reachBridge++;
  }
  return {
    buildable: flat / area,
    water: waterTiles / area,
    forest: forestTiles / area,
    hill: hillTiles / area,
    mineral: mineralTiles / area,
    slope: (area - waterTiles - flat) / area,
    shapes,
    pieces,
    targets: targets.length,
    reachNoBridge,
    reachBridge,
    anyRoad: targets.length === 0 || reachNoBridge > 0,
    allRoad: reachBridge === targets.length,
  };
}

module.exports = { tileShape, measure, roadSearch, connectionTiles, SHAPE_AXIS, BRIDGE_SPAN };
