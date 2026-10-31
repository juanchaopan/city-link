'use strict';

const { makeRng, valueNoise, propagate, bounds } = require('./core');
const { createSkeleton } = require('./skeleton');
const { carveRivers } = require('./rivers');
const { measure } = require('./roads');

const SIDES = {
  W: { dx: -1, dy: 0 },
  E: { dx: 1, dy: 0 },
  N: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
};
const CONNECT_LEVEL = 1;
const PAD_HALF = 2;
const MAX_ATTEMPTS = 8;

function createCluster(seed, N, maxLevel, opt) {
  const rng = makeRng(seed);
  const edges = {};
  for (const side of Object.keys(SIDES)) edges[side] = rng() < 0.5 ? 'coast' : 'mountain';
  const size = N * 8 + 1;
  const cell = Math.max(10, (N / 3.5) | 0);
  return {
    seed,
    N,
    maxLevel,
    edges,
    slots: new Array(64).fill(null),
    skeleton: createSkeleton(seed, edges, opt),
    heightA: valueNoise(size, cell, rng),
    heightB: valueNoise(size, (cell / 2.5) | 0 || 4, rng),
    forestNoise: valueNoise(size, Math.max(6, (N / 7) | 0), rng),
    meander: valueNoise(size, opt.meanderCell, rng),
  };
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

function chebyshevDistance(mask, N) {
  const dist = new Int16Array(N * N).fill(32000);
  const queue = [];
  for (let t = 0; t < mask.length; t++) {
    if (mask[t]) {
      dist[t] = 0;
      queue.push(t);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const t = queue[head];
    const x = t % N;
    const y = (t / N) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const nt = ny * N + nx;
        if (dist[nt] > dist[t] + 1) {
          dist[nt] = dist[t] + 1;
          queue.push(nt);
        }
      }
    }
  }
  return dist;
}

function attemptGenerate(cluster, sx, sy, seed, attempt, opt) {
  const { N, maxLevel } = cluster;
  const V = N + 1;
  const rng = makeRng(seed);
  const pins = new Int8Array(V * V).fill(-1);
  const water = new Uint8Array(N * N);
  const coast = new Uint8Array(N * N);
  const blocked = new Uint8Array(N * N);
  let pinConflicts = 0;
  const vid = (x, y) => y * V + x;
  const tid = (x, y) => y * N + x;
  const originX = sx * N;
  const originY = sy * N;
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
  const corners = [
    [slotAt(cluster, sx - 1, sy - 1), N, N, 0, 0],
    [slotAt(cluster, sx + 1, sy - 1), 0, N, N, 0],
    [slotAt(cluster, sx - 1, sy + 1), N, 0, 0, N],
    [slotAt(cluster, sx + 1, sy + 1), 0, 0, N, N],
  ];
  for (const [slot, fromX, fromY, toX, toY] of corners) {
    if (slot) pin(toX, toY, slot.h[vid(fromX, fromY)]);
  }

  // 远山在和海岸相接的群角退到最低层，海岸带占一格宽，所以退坡比距离少一层。
  for (const side of Object.keys(SIDES)) {
    if (!isOuter(side, sx, sy)) continue;
    const type = cluster.edges[side];
    sideVertices(side, N).forEach(([x, y]) => {
      if (type === 'coast') {
        pin(x, y, 0);
      } else {
        const gx = originX + x;
        const gy = originY + y;
        const size = 8 * N;
        const along = side === 'W' || side === 'E' ? gy : gx;
        const startSide = side === 'W' || side === 'E' ? 'N' : 'W';
        const endSide = side === 'W' || side === 'E' ? 'S' : 'E';
        let level = maxLevel;
        if (cluster.edges[startSide] === 'coast') level = Math.min(level, Math.max(0, along - 1));
        if (cluster.edges[endSide] === 'coast') level = Math.min(level, Math.max(0, size - along - 1));
        pin(x, y, level);
      }
    });
  }
  for (const side of Object.keys(SIDES)) {
    if (!isOuter(side, sx, sy) || cluster.edges[side] !== 'coast') continue;
    for (let i = 0; i < N; i++) {
      const [x, y] = side === 'W' ? [0, i] : side === 'E' ? [N - 1, i] : side === 'N' ? [i, 0] : [i, N - 1];
      water[tid(x, y)] = 1;
      coast[tid(x, y)] = 1;
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

  const heightAt = (x, y) => {
    const gx = originX + x;
    const gy = originY + y;
    const n = cluster.heightA(gx, gy) * 0.8 + cluster.heightB(gx, gy) * 0.2;
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

  // 骨架决定的边界口无论邻居是否生成都先定下来，两边天然对齐。
  const sides = cluster.skeleton.slots[sy * 8 + sx].sides;
  for (const side of Object.keys(sides)) {
    const { offset, kind } = sides[side];
    const half = kind === 'trib' ? 0 : 1;
    for (let a = offset - half; a <= offset + half; a++) {
      for (let b = 0; b < 3; b++) {
        const [x, y] = side === 'W' ? [b, a] : side === 'E' ? [N - 1 - b, a] : side === 'N' ? [a, b] : [a, N - 1 - b];
        pinTile(x, y, 0);
      }
    }
  }

  const { lower } = bounds(pins, V, maxLevel);
  const canBeWater = (x, y) => lower[vid(x, y)] <= 0 && lower[vid(x + 1, y)] <= 0
    && lower[vid(x, y + 1)] <= 0 && lower[vid(x + 1, y + 1)] <= 0;

  const carved = carveRivers({
    N, sides, rng, canBeWater, blocked, water, pinTile, meander: cluster.meander, originX, originY, opt,
  });
  if (!carved.ok) return { ok: false, reason: 'route' };

  const range = bounds(pins, V, maxLevel);
  let infeasible = pinConflicts;
  for (let i = 0; i < pins.length; i++) {
    if (range.lower[i] > range.upper[i]) infeasible++;
  }
  if (infeasible > 0) return { ok: false, reason: pinConflicts > 0 ? 'pin' : 'bound' };

  // 河边是一条低地，建筑不至于全部落在坡上。
  const toWater = chebyshevDistance(water, N);
  const h = new Int8Array(V * V);
  for (let y = 0; y < V; y++) {
    for (let x = 0; x < V; x++) {
      const i = vid(x, y);
      if (pins[i] >= 0) {
        h[i] = pins[i];
      } else {
        const near = toWater[tid(Math.min(x, N - 1), Math.min(y, N - 1))] <= opt.valley;
        const want = near ? 0 : heightAt(x, y);
        h[i] = Math.min(range.upper[i], Math.max(range.lower[i], want));
      }
    }
  }
  propagate(h, V, 1);

  const forest = new Uint8Array(N * N);
  const mineral = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const t = tid(x, y);
      if (!water[t] && !blocked[t] && cluster.forestNoise(originX + x, originY + y) > opt.forest) forest[t] = 1;
    }
  }
  if (rng() < opt.mineralChance) {
    const patches = 2 + ((rng() * 2) | 0);
    for (let p = 0; p < patches; p++) {
      const size = Math.max(2, (N * (0.04 + rng() * 0.03)) | 0);
      const mx = 6 + ((rng() * (N - 12)) | 0);
      const my = 6 + ((rng() * (N - 12)) | 0);
      for (let y = my - size; y <= my + size; y++) {
        for (let x = mx - size; x <= mx + size; x++) {
          if (x >= 0 && y >= 0 && x < N && y < N && !water[tid(x, y)] && Math.hypot(x - mx, y - my) <= size) mineral[tid(x, y)] = 1;
        }
      }
    }
  }

  const terrain = { N, h, water, coast, forest, mineral, sx, sy, seed, lines: carved.lines };
  terrain.metrics = measure(terrain, cluster, opt);
  if (terrain.metrics.buildable < opt.buildableFloor) return { ok: false, reason: 'buildable', terrain };
  if (!terrain.metrics.anyRoad) return { ok: false, reason: 'firstTrade', terrain };
  if (!terrain.metrics.allRoad) return { ok: false, reason: 'connect', terrain };
  return { ok: true, terrain };
}

function generate(cluster, sx, sy, opt) {
  const failures = {};
  let last = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const seed = (cluster.seed * 1009 + (sy * 8 + sx) * 31 + attempt * 7919) >>> 0;
    const result = attemptGenerate(cluster, sx, sy, seed, attempt, opt);
    if (result.ok) {
      cluster.slots[sy * 8 + sx] = result.terrain;
      return { ok: true, attempts: attempt + 1, failures, terrain: result.terrain };
    }
    failures[result.reason] = (failures[result.reason] || 0) + 1;
    last = result;
  }
  return { ok: false, attempts: MAX_ATTEMPTS, failures, last };
}

module.exports = { createCluster, generate, slotAt, isOuter };
