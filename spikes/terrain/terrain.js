'use strict';

const SIDES = {
  W: { dx: -1, dy: 0 },
  E: { dx: 1, dy: 0 },
  N: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
};
const DIR8 = [
  [0, -1], [1, 0], [0, 1], [-1, 0],
  [1, -1], [1, 1], [-1, 1], [-1, -1],
];
const CONNECT_LEVEL = 1;
const PAD_HALF = 2;
const MAX_ATTEMPTS = 8;
const BRIDGE_SPAN = 5;

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise(size, cell, rng) {
  const gridSize = Math.ceil(size / cell) + 2;
  const grid = new Float32Array(gridSize * gridSize);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = x / cell;
    const gy = y / cell;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = smooth(gx - ix);
    const fy = smooth(gy - iy);
    const at = (px, py) => grid[py * gridSize + px];
    const top = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx;
    const bottom = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
}

// 按切比雪夫距离把约束向四周传播：sign=-1 求下界，sign=1 求上界。
function propagate(field, V, sign) {
  const relax = (i, j) => {
    const limit = field[j] + sign;
    if (sign > 0 ? limit < field[i] : limit > field[i]) field[i] = limit;
  };
  for (let y = 0; y < V; y++) {
    for (let x = 0; x < V; x++) {
      const i = y * V + x;
      if (x > 0) relax(i, i - 1);
      if (y > 0) relax(i, i - V);
      if (x > 0 && y > 0) relax(i, i - V - 1);
      if (x < V - 1 && y > 0) relax(i, i - V + 1);
    }
  }
  for (let y = V - 1; y >= 0; y--) {
    for (let x = V - 1; x >= 0; x--) {
      const i = y * V + x;
      if (x < V - 1) relax(i, i + 1);
      if (y < V - 1) relax(i, i + V);
      if (x < V - 1 && y < V - 1) relax(i, i + V + 1);
      if (x > 0 && y < V - 1) relax(i, i + V - 1);
    }
  }
}

function bounds(pins, V, maxLevel) {
  const lower = new Int16Array(V * V).fill(-100);
  const upper = new Int16Array(V * V).fill(100);
  for (let i = 0; i < pins.length; i++) {
    if (pins[i] >= 0) {
      lower[i] = pins[i];
      upper[i] = pins[i];
    }
  }
  propagate(lower, V, -1);
  propagate(upper, V, 1);
  for (let i = 0; i < lower.length; i++) {
    if (lower[i] < 0) lower[i] = 0;
    if (upper[i] > maxLevel) upper[i] = maxLevel;
  }
  return { lower, upper };
}

function createCluster(seed, N, maxLevel) {
  const rng = makeRng(seed);
  const edges = {};
  for (const side of Object.keys(SIDES)) edges[side] = rng() < 0.5 ? 'coast' : 'mountain';
  return { seed, N, maxLevel, edges, slots: new Array(64).fill(null) };
}

function slotAt(cluster, sx, sy) {
  if (sx < 0 || sy < 0 || sx > 7 || sy > 7) return null;
  return cluster.slots[sy * 8 + sx];
}

function isOuter(side, sx, sy) {
  return (side === 'W' && sx === 0) || (side === 'E' && sx === 7) || (side === 'N' && sy === 0) || (side === 'S' && sy === 7);
}

function sideVertices(side, N) {
  const out = [];
  for (let i = 0; i <= N; i++) {
    if (side === 'W') out.push([0, i]);
    if (side === 'E') out.push([N, i]);
    if (side === 'N') out.push([i, 0]);
    if (side === 'S') out.push([i, N]);
  }
  return out;
}

function attemptGenerate(cluster, sx, sy, seed, opt) {
  const { N, maxLevel } = cluster;
  const V = N + 1;
  const rng = makeRng(seed);
  const pins = new Int8Array(V * V).fill(-1);
  const water = new Uint8Array(N * N);
  const blocked = new Uint8Array(N * N);
  let pinConflicts = 0;
  const vid = (x, y) => y * V + x;
  const tid = (x, y) => y * N + x;
  const pin = (x, y, level) => {
    const i = vid(x, y);
    if (pins[i] >= 0 && pins[i] !== level) pinConflicts++;
    else pins[i] = level;
  };
  const pinTile = (x, y, level) => {
    pin(x, y, level);
    pin(x + 1, y, level);
    pin(x, y + 1, level);
    pin(x + 1, y + 1, level);
  };

  const inbound = [];
  const west = slotAt(cluster, sx - 1, sy);
  const east = slotAt(cluster, sx + 1, sy);
  const north = slotAt(cluster, sx, sy - 1);
  const south = slotAt(cluster, sx, sy + 1);
  for (let i = 0; i <= N; i++) {
    if (west) pin(0, i, west.h[vid(N, i)]);
    if (east) pin(N, i, east.h[vid(0, i)]);
    if (north) pin(i, 0, north.h[vid(i, N)]);
    if (south) pin(i, N, south.h[vid(i, 0)]);
  }
  for (let i = 0; i < N; i++) {
    if (west && west.water[tid(N - 1, i)]) inbound.push(tid(0, i));
    if (east && east.water[tid(0, i)]) inbound.push(tid(N - 1, i));
    if (north && north.water[tid(i, N - 1)]) inbound.push(tid(i, 0));
    if (south && south.water[tid(i, 0)]) inbound.push(tid(i, N - 1));
  }
  const corners = [
    [slotAt(cluster, sx - 1, sy - 1), N, N, 0, 0],
    [slotAt(cluster, sx + 1, sy - 1), 0, N, N, 0],
    [slotAt(cluster, sx - 1, sy + 1), N, 0, 0, N],
    [slotAt(cluster, sx + 1, sy + 1), 0, 0, N, N],
  ];
  for (const [slot, fromX, fromY, toX, toY] of corners) {
    if (slot) pin(toX, toY, slot.h[vid(fromX, fromY)]);
  }

  for (const side of Object.keys(SIDES)) {
    if (!isOuter(side, sx, sy)) continue;
    const type = cluster.edges[side];
    sideVertices(side, N).forEach(([x, y]) => {
      if (type === 'coast') {
        pin(x, y, 0);
      } else {
        const gx = sx * N + x;
        const gy = sy * N + y;
        const size = 8 * N;
        const along = side === 'W' || side === 'E' ? gy : gx;
        const startSide = side === 'W' || side === 'E' ? 'N' : 'W';
        const endSide = side === 'W' || side === 'E' ? 'S' : 'E';
        let level = maxLevel;
        if (cluster.edges[startSide] === 'coast') level = Math.min(level, along);
        if (cluster.edges[endSide] === 'coast') level = Math.min(level, size - along);
        pin(x, y, level);
      }
    });
  }
  for (const side of Object.keys(SIDES)) {
    if (!isOuter(side, sx, sy) || cluster.edges[side] !== 'coast') continue;
    for (let i = 0; i < N; i++) {
      const [x, y] = side === 'W' ? [0, i] : side === 'E' ? [N - 1, i] : side === 'N' ? [i, 0] : [i, N - 1];
      water[tid(x, y)] = 1;
      pinTile(x, y, 0);
    }
  }

  const mid = N >> 1;
  for (const side of Object.keys(SIDES)) {
    if (isOuter(side, sx, sy)) continue;
    for (let a = mid - PAD_HALF; a <= mid + PAD_HALF; a++) {
      for (let b = 0; b <= 2; b++) {
        const [x, y] = side === 'W' ? [b, a] : side === 'E' ? [N - b, a] : side === 'N' ? [a, b] : [a, N - b];
        pin(x, y, CONNECT_LEVEL);
      }
    }
    for (let a = mid - PAD_HALF - 3; a < mid + PAD_HALF + 3; a++) {
      for (let b = 0; b < 4; b++) {
        const [x, y] = side === 'W' ? [b, a] : side === 'E' ? [N - 1 - b, a] : side === 'N' ? [a, b] : [a, N - 1 - b];
        blocked[tid(x, y)] = 1;
      }
    }
  }

  const center = (N / 2) | 0;
  const radius = Math.max(4, (N * opt.plateau) | 0);
  for (let y = 0; y < V; y++) {
    for (let x = 0; x < V; x++) {
      const distance = Math.hypot(x - center, y - center);
      if (distance <= radius) pin(x, y, CONNECT_LEVEL);
      if (distance <= radius + 2 && x < N && y < N) blocked[tid(x, y)] = 1;
    }
  }

  const noiseCell = Math.max(10, (N / 3.5) | 0);
  const noiseA = valueNoise(V, noiseCell, rng);
  const noiseB = valueNoise(V, (noiseCell / 2.5) | 0 || 4, rng);
  const heightAt = (x, y) => {
    const n = noiseA(x, y) * 0.8 + noiseB(x, y) * 0.2;
    if (n < opt.low) return 0;
    if (maxLevel >= 2 && n >= opt.high) {
      if (maxLevel >= 3 && n >= opt.peak) return 3;
      return 2;
    }
    return 1;
  };

  if (opt.cornerPad) {
    let range = bounds(pins, V, maxLevel);
    const padCorner = (cx, cy, stepX, stepY) => {
      const i = vid(cx, cy);
      let level = pins[i];
      if (level < 0) {
        level = Math.min(range.upper[i], Math.max(range.lower[i], heightAt(cx, cy)));
        pin(cx, cy, level);
      }
      pin(cx + stepX, cy, level);
      pin(cx, cy + stepY, level);
      range = bounds(pins, V, maxLevel);
    };
    padCorner(0, 0, 1, 1);
    padCorner(N, 0, -1, 1);
    padCorner(0, N, 1, -1);
    padCorner(N, N, -1, -1);
  }

  for (let i = 0; i < inbound.length; i++) {
    const t = inbound[i];
    water[t] = 1;
    pinTile(t % N, (t / N) | 0, 0);
  }

  let rivers = inbound.slice();
  const freeSides = Object.keys(SIDES).filter((side) => {
    const s = SIDES[side];
    if (isOuter(side, sx, sy)) return cluster.edges[side] === 'coast';
    return !slotAt(cluster, sx + s.dx, sy + s.dy);
  });
  if (rivers.length === 0 && freeSides.length >= 2 && rng() < opt.riverChance) {
    const startSide = freeSides[(rng() * freeSides.length) | 0];
    if (!isOuter(startSide, sx, sy)) {
      const a = 6 + ((rng() * (N - 12)) | 0);
      const [x, y] = startSide === 'W' ? [0, a] : startSide === 'E' ? [N - 1, a] : startSide === 'N' ? [a, 0] : [a, N - 1];
      if (!blocked[tid(x, y)]) rivers = [tid(x, y)];
    }
  }

  let lower = bounds(pins, V, maxLevel).lower;
  const canBeWater = (x, y) => lower[vid(x, y)] <= 0 && lower[vid(x + 1, y)] <= 0
    && lower[vid(x, y + 1)] <= 0 && lower[vid(x + 1, y + 1)] <= 0;
  const onBorder = (x, y) => x === 0 || y === 0 || x === N - 1 || y === N - 1;
  const exitOk = (x, y) => {
    for (const side of freeSides) {
      const onSide = (side === 'W' && x === 0) || (side === 'E' && x === N - 1) || (side === 'N' && y === 0) || (side === 'S' && y === N - 1);
      if (!onSide) continue;
      const along = side === 'W' || side === 'E' ? y : x;
      if (along >= 4 && along < N - 4) return true;
    }
    return false;
  };

  let deadEnds = 0;
  rivers.forEach((source, index) => {
    const dist = new Float32Array(N * N).fill(Infinity);
    const from = new Int32Array(N * N).fill(-1);
    const done = new Uint8Array(N * N);
    const open = [source];
    dist[source] = 0;
    const weight = new Float32Array(N * N);
    for (let i = 0; i < weight.length; i++) weight[i] = 1 + rng() * 2;
    const reachable = [];
    let found = -1;
    while (open.length) {
      let best = 0;
      for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[best]]) best = i;
      const t = open[best];
      open[best] = open[open.length - 1];
      open.pop();
      if (done[t]) continue;
      done[t] = 1;
      const x = t % N;
      const y = (t / N) | 0;
      if (t !== source) {
        reachable.push(t);
        const merged = index > 0 && water[t];
        const exits = onBorder(x, y) && exitOk(x, y)
          && Math.abs(x - source % N) + Math.abs(y - ((source / N) | 0)) > N / 3;
        if (merged || exits) {
          found = t;
          break;
        }
      }
      for (let d = 0; d < 4; d++) {
        const nx = x + DIR8[d][0];
        const ny = y + DIR8[d][1];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const nt = tid(nx, ny);
        if (done[nt] || blocked[nt] || !canBeWater(nx, ny)) continue;
        if (onBorder(nx, ny) && !exitOk(nx, ny)) continue;
        const next = dist[t] + weight[nt];
        if (next < dist[nt]) {
          dist[nt] = next;
          from[nt] = t;
          open.push(nt);
        }
      }
    }
    let lake = false;
    if (found < 0) {
      const interior = reachable.filter((t) => !onBorder(t % N, (t / N) | 0));
      if (interior.length === 0) {
        deadEnds++;
        return;
      }
      found = interior[(interior.length * (0.6 + rng() * 0.4)) | 0];
      lake = true;
    }
    for (let t = found; t !== -1; t = from[t]) {
      water[t] = 1;
      pinTile(t % N, (t / N) | 0, 0);
    }
    lower = bounds(pins, V, maxLevel).lower;
    if (lake) {
      const lx = found % N;
      const ly = (found / N) | 0;
      const size = 2 + ((rng() * 3) | 0);
      for (let y = ly - size; y <= ly + size; y++) {
        for (let x = lx - size; x <= lx + size; x++) {
          if (x <= 0 || y <= 0 || x >= N - 1 || y >= N - 1) continue;
          if (Math.hypot(x - lx, y - ly) > size || blocked[tid(x, y)] || !canBeWater(x, y)) continue;
          water[tid(x, y)] = 1;
          pinTile(x, y, 0);
        }
      }
      lower = bounds(pins, V, maxLevel).lower;
    }
  });

  const range = bounds(pins, V, maxLevel);
  let infeasible = pinConflicts;
  for (let i = 0; i < pins.length; i++) {
    if (range.lower[i] > range.upper[i]) infeasible++;
  }
  if (infeasible > 0 || deadEnds > 0) {
    return { ok: false, reason: pinConflicts > 0 ? 'pin' : deadEnds > 0 ? 'deadEnd' : 'bound' };
  }

  const h = new Int8Array(V * V);
  for (let y = 0; y < V; y++) {
    for (let x = 0; x < V; x++) {
      const i = vid(x, y);
      h[i] = pins[i] >= 0 ? pins[i] : Math.min(range.upper[i], Math.max(range.lower[i], heightAt(x, y)));
    }
  }
  propagate(h, V, 1);

  const forest = new Uint8Array(N * N);
  const mineral = new Uint8Array(N * N);
  const noiseForest = valueNoise(N, Math.max(6, (N / 7) | 0), rng);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (!water[tid(x, y)] && noiseForest(x, y) > opt.forest && !blocked[tid(x, y)]) forest[tid(x, y)] = 1;
    }
  }
  if (rng() < opt.mineralChance) {
    const size = 2 + ((rng() * 2) | 0);
    const mx = 6 + ((rng() * (N - 12)) | 0);
    const my = 6 + ((rng() * (N - 12)) | 0);
    for (let y = my - size; y <= my + size; y++) {
      for (let x = mx - size; x <= mx + size; x++) {
        if (!water[tid(x, y)] && Math.hypot(x - mx, y - my) <= size) mineral[tid(x, y)] = 1;
      }
    }
  }

  const terrain = { N, h, water, forest, mineral, sx, sy, seed };
  terrain.metrics = measure(terrain, cluster, opt);
  if (terrain.metrics.buildable < opt.buildableFloor) return { ok: false, reason: 'buildable', terrain };
  if (!terrain.metrics.anyRoad) return { ok: false, reason: 'firstTrade', terrain };
  if (!terrain.metrics.allRoad) return { ok: false, reason: 'connect', terrain };
  return { ok: true, terrain };
}

function tileShape(h, V, x, y) {
  const a = h[y * V + x];
  const b = h[y * V + x + 1];
  const c = h[(y + 1) * V + x + 1];
  const d = h[(y + 1) * V + x];
  const lowest = Math.min(a, b, c, d);
  const mask = ((a - lowest) << 3) | ((b - lowest) << 2) | ((c - lowest) << 1) | (d - lowest);
  return mask;
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

// 路网按“方向 + 地块”做广度优先搜索，返回能到达的地块和到达每个地块的路径。
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
  const canEnter = (t, d) => {
    if (water[t]) return false;
    const shape = SHAPE_AXIS[shapeOf[t]];
    if (!shape || shape.kind === 'saddle') return false;
    if (shape.kind === 'flat') return true;
    if (d >= 4) return rule.diagonalRamp && shape.kind === 'corner' && shape.axes.includes(AXIS_OF_DIR[d]);
    return shape.kind === 'ramp' && shape.axes.includes(AXIS_OF_DIR[d]);
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
        if (!canEnter(landing, nd)) continue;
        const ns = landing * 8 + nd;
        if (parent[ns] === -2) {
          parent[ns] = s;
          queue[tail++] = ns;
        }
        continue;
      }
      if (!canEnter(nt, nd)) continue;
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
        const key2 = `bridge:${AXIS_OF_DIR[d]}`;
        pieces[key2] = (pieces[key2] || 0) + 1;
      }
    }
  }
  return true;
}

function measure(terrain, cluster, opt) {
  const { N, h, water, forest, mineral } = terrain;
  const V = N + 1;
  let flat = 0;
  let flatBuildable = 0;
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
      const isFlat = shape === 0;
      if (isFlat) flat++;
      if (isFlat) flatBuildable++;
      if (forest[t]) forestTiles++;
      if (mineral[t]) mineralTiles++;
      if (h[y * V + x] >= 2) hillTiles++;
    }
  }
  const area = N * N;
  const targets = connectionTiles(cluster, terrain.sx, terrain.sy);
  const noBridge = roadSearch(terrain, { diagonalRamp: opt.diagonalRamp, bridge: false });
  const withBridge = roadSearch(terrain, { diagonalRamp: opt.diagonalRamp, bridge: true });
  const pieces = {};
  let reachNoBridge = 0;
  let reachBridge = 0;
  for (const [x, y] of targets) {
    const t = y * N + x;
    if (pathPieces(noBridge, t, N, {})) reachNoBridge++;
    if (pathPieces(withBridge, t, N, pieces)) reachBridge++;
  }
  return {
    buildable: flatBuildable / area,
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

function generate(cluster, sx, sy, opt) {
  const failures = {};
  let last = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const seed = (cluster.seed * 1009 + (sy * 8 + sx) * 31 + attempt * 7919) >>> 0;
    const result = attemptGenerate(cluster, sx, sy, seed, opt);
    if (result.ok) {
      cluster.slots[sy * 8 + sx] = result.terrain;
      return { ok: true, attempts: attempt + 1, failures, terrain: result.terrain };
    }
    failures[result.reason] = (failures[result.reason] || 0) + 1;
    last = result;
  }
  return { ok: false, attempts: MAX_ATTEMPTS, failures, last };
}

// 与生成代码无关的独立检查：只读最终地形。
function verifyCluster(cluster) {
  const { N, maxLevel } = cluster;
  const V = N + 1;
  const problems = { heightSeam: 0, waterSeam: 0, slope: 0, waterLevel: 0, range: 0 };
  for (let sy = 0; sy < 8; sy++) {
    for (let sx = 0; sx < 8; sx++) {
      const slot = slotAt(cluster, sx, sy);
      if (!slot) continue;
      for (let y = 0; y < V; y++) {
        for (let x = 0; x < V; x++) {
          const value = slot.h[y * V + x];
          if (value < 0 || value > maxLevel) problems.range++;
          for (const [dx, dy] of DIR8) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= V || ny >= V) continue;
            if (Math.abs(value - slot.h[ny * V + nx]) > 1) problems.slope++;
          }
        }
      }
      for (let t = 0; t < N * N; t++) {
        if (!slot.water[t]) continue;
        const x = t % N;
        const y = (t / N) | 0;
        for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          if (slot.h[(y + oy) * V + x + ox] !== 0) problems.waterLevel++;
        }
      }
      const east = slotAt(cluster, sx + 1, sy);
      const south = slotAt(cluster, sx, sy + 1);
      for (let i = 0; i <= N; i++) {
        if (east && slot.h[i * V + N] !== east.h[i * V]) problems.heightSeam++;
        if (south && slot.h[N * V + i] !== south.h[i]) problems.heightSeam++;
      }
      for (let i = 0; i < N; i++) {
        if (east && slot.water[i * N + N - 1] !== east.water[i * N]) problems.waterSeam++;
        if (south && slot.water[(N - 1) * N + i] !== south.water[i]) problems.waterSeam++;
      }
    }
  }
  return problems;
}

module.exports = { createCluster, generate, verifyCluster, makeRng, tileShape, SHAPE_AXIS };
