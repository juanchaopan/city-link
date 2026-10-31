'use strict';

const { MinHeap } = require('./core');

const STUB = 7;
const NEIGHBORS = [
  [0, -1, 1], [1, 0, 1], [0, 1, 1], [-1, 0, 1],
  [1, -1, 1.414], [1, 1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
];

function stubPoints(side, offset, N) {
  const points = [];
  for (let d = 0; d <= STUB; d++) {
    if (side === 'W') points.push([d, offset]);
    if (side === 'E') points.push([N - 1 - d, offset]);
    if (side === 'N') points.push([offset, d]);
    if (side === 'S') points.push([offset, N - 1 - d]);
  }
  return points;
}

function chaikin(points, iterations) {
  let list = points;
  for (let it = 0; it < iterations; it++) {
    const next = [list[0]];
    for (let i = 0; i < list.length - 1; i++) {
      const [ax, ay] = list[i];
      const [bx, by] = list[i + 1];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
      next.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    next.push(list[list.length - 1]);
    list = next;
  }
  return list;
}

function resample(points, step) {
  const out = [points[0]];
  let carry = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const length = Math.hypot(bx - ax, by - ay);
    let at = step - carry;
    while (at <= length) {
      const t = at / length;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      at += step;
    }
    carry = (carry + length) % step;
  }
  out.push(points[points.length - 1]);
  return out;
}

function dijkstra(N, start, free, cost, isGoal) {
  const dist = new Float32Array(N * N).fill(Infinity);
  const from = new Int32Array(N * N).fill(-1);
  const heap = new MinHeap();
  const s = start[1] * N + start[0];
  dist[s] = 0;
  heap.push(0, s);
  while (heap.size) {
    const t = heap.pop();
    const x = t % N;
    const y = (t / N) | 0;
    if (t !== s && isGoal(x, y)) {
      const path = [];
      for (let p = t; p !== -1; p = from[p]) path.push([p % N, (p / N) | 0]);
      return path.reverse();
    }
    for (const [dx, dy, weight] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const nt = ny * N + nx;
      if (!free(nx, ny) && !isGoal(nx, ny)) continue;
      const next = dist[t] + cost(nx, ny) * weight;
      if (next < dist[nt]) {
        dist[nt] = next;
        from[nt] = t;
        heap.push(next, nt);
      }
    }
  }
  return null;
}

// 把河道画进城市：干流、支流和湖泊都写入 ctx.water，返回中心线。
function carveRivers(ctx) {
  const { N, sides, rng, canBeWater, blocked, water, pinTile, meander, originX, originY, opt } = ctx;
  const tid = (x, y) => y * N + x;
  const band = (x, y) => Math.min(x, y, N - 1 - x, N - 1 - y);

  const nogo = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (blocked[tid(x, y)] || band(x, y) < 4 || !canBeWater(x, y)) nogo[tid(x, y)] = 1;
    }
  }
  const margin = opt.routeMargin;
  const freeGrid = new Uint8Array(N * N).fill(1);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (!nogo[tid(x, y)]) continue;
      for (let dy = -margin; dy <= margin; dy++) {
        for (let dx = -margin; dx <= margin; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < N && ny < N) freeGrid[tid(nx, ny)] = 0;
        }
      }
    }
  }
  const free = (x, y) => freeGrid[tid(x, y)] === 1;
  const cost = (x, y) => {
    const n = meander(originX + x, originY + y);
    const hug = 1 + 3 * Math.abs(n - 0.5) * 2;
    return hug * hug;
  };

  const stamp = (x, y, radius) => {
    const cx = Math.round(x);
    const cy = Math.round(y);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || py < 0 || px >= N || py >= N) continue;
        if (blocked[tid(px, py)] || !canBeWater(px, py)) return false;
        water[tid(px, py)] = 1;
        pinTile(px, py, 0);
      }
    }
    return true;
  };

  const lines = [];
  const paint = (points, kind) => {
    const smooth = chaikin(points, 3);
    const samples = resample(smooth, 0.4);
    let lastX = null;
    let lastY = null;
    for (const [x, y] of samples) {
      const tx = Math.round(x);
      const ty = Math.round(y);
      if (kind === 'main') {
        if (!stamp(x, y, 1)) return false;
      } else {
        // 支流要 4 邻接，斜着走时补一格。
        if (lastX !== null && tx !== lastX && ty !== lastY && !stamp(tx, lastY, 0)) return false;
        if (!stamp(tx, ty, 0)) return false;
      }
      lastX = tx;
      lastY = ty;
    }
    lines.push({ kind, points: smooth });
    return true;
  };

  const lake = (cx, cy, radius) => {
    const p = [rng() * 6.28, rng() * 6.28, rng() * 6.28];
    const stretch = 0.7 + rng() * 0.6;
    const turn = rng() * 3.14;
    const reach = Math.ceil(radius * 2);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= N || y >= N || band(x, y) < 3) continue;
        const u = dx * Math.cos(turn) + dy * Math.sin(turn);
        const v = (-dx * Math.sin(turn) + dy * Math.cos(turn)) * (1 + stretch);
        const angle = Math.atan2(v, u);
        const r = radius * (1 + 0.32 * Math.sin(2 * angle + p[0]) + 0.2 * Math.sin(3 * angle + p[1]) + 0.12 * Math.sin(5 * angle + p[2]));
        if (Math.hypot(u, v) > r) continue;
        if (blocked[tid(x, y)] || !canBeWater(x, y)) continue;
        water[tid(x, y)] = 1;
        pinTile(x, y, 0);
      }
    }
  };

  const route = (from, goal, avoid) => {
    const allowed = avoid ? (x, y) => free(x, y) && !avoid(x, y) : free;
    return dijkstra(N, from, allowed, cost, goal);
  };

  const interiorPoint = (ax, ay, minDistance) => {
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < 40; i++) {
      const x = 10 + ((rng() * (N - 20)) | 0);
      const y = 10 + ((rng() * (N - 20)) | 0);
      if (!free(x, y)) continue;
      const d = Math.hypot(x - ax, y - ay);
      if (d < minDistance) continue;
      const score = d * (0.5 + rng());
      if (score > bestScore) {
        bestScore = score;
        best = [x, y];
      }
    }
    return best;
  };

  // 两点之间绕一个偏离直线的路点，让河道形成大弯。
  const connectTwo = (a, b) => {
    const [ax, ay] = a[a.length - 1];
    const [bx, by] = b[b.length - 1];
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const length = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / length;
    const ny = (bx - ax) / length;
    let way = null;
    for (let tries = 0; tries < 8 && !way; tries++) {
      const swing = (opt.swingMin + rng() * opt.swingSpread) * (rng() < 0.5 ? -1 : 1);
      const wx = Math.round(mx + nx * swing);
      const wy = Math.round(my + ny * swing);
      if (wx >= 0 && wy >= 0 && wx < N && wy < N && free(wx, wy)) way = [wx, wy];
    }
    if (!way) {
      const direct = route([ax, ay], (x, y) => x === bx && y === by);
      return direct ? [...a, ...direct.slice(1), ...[...b].reverse().slice(1)] : null;
    }
    const first = route([ax, ay], (x, y) => x === way[0] && y === way[1]);
    if (!first) return null;
    const used = new Uint8Array(N * N);
    for (const [x, y] of first) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const px = x + dx;
          const py = y + dy;
          if (px >= 0 && py >= 0 && px < N && py < N && Math.hypot(px - way[0], py - way[1]) > 5) used[tid(px, py)] = 1;
        }
      }
    }
    const second = route(way, (x, y) => x === bx && y === by, (x, y) => used[tid(x, y)] === 1);
    if (!second) return null;
    return [...a, ...first.slice(1), ...second.slice(1), ...[...b].reverse().slice(1)];
  };

  const toNetwork = (stub) => {
    const end = stub[stub.length - 1];
    const path = route(end, (x, y) => water[tid(x, y)] === 1 && band(x, y) >= 4);
    return path ? [...stub, ...path.slice(1)] : null;
  };

  const mains = [];
  const tribs = [];
  for (const side of Object.keys(sides)) {
    const entry = sides[side];
    const stub = stubPoints(side, entry.offset, N);
    if (entry.kind === 'trib') tribs.push(stub);
    else mains.push(stub);
  }

  if (mains.length === 1) {
    const stub = mains[0];
    const end = stub[stub.length - 1];
    const target = interiorPoint(end[0], end[1], 14);
    if (!target) return { ok: false };
    const path = route(end, (x, y) => x === target[0] && y === target[1]);
    if (!path) return { ok: false };
    if (!paint([...stub, ...path.slice(1)], 'main')) return { ok: false };
    lake(target[0], target[1], opt.sourceLakeMin + rng() * opt.sourceLakeSpread);
  } else if (mains.length >= 2) {
    const whole = connectTwo(mains[0], mains[1]);
    if (!whole || !paint(whole, 'main')) return { ok: false };
    for (let i = 2; i < mains.length; i++) {
      const line = toNetwork(mains[i]);
      if (!line || !paint(line, 'main')) return { ok: false };
    }
  }

  let remaining = tribs;
  if (mains.length === 0 && tribs.length >= 2) {
    const whole = connectTwo(tribs[0], tribs[1]);
    if (!whole || !paint(whole, 'trib')) return { ok: false };
    remaining = tribs.slice(2);
  } else if (mains.length === 0 && tribs.length === 1) {
    const stub = tribs[0];
    const end = stub[stub.length - 1];
    const target = interiorPoint(end[0], end[1], 16);
    if (!target) return { ok: false };
    const path = route(end, (x, y) => x === target[0] && y === target[1]);
    if (!path || !paint([...stub, ...path.slice(1)], 'trib')) return { ok: false };
    if (rng() < 0.5) lake(target[0], target[1], 3 + rng() * 2);
    remaining = [];
  }
  for (const stub of remaining) {
    const line = toNetwork(stub);
    if (!line || !paint(line, 'trib')) return { ok: false };
  }

  if (rng() < opt.lakeChance) {
    const target = interiorPoint(N / 2, N / 2, 14);
    if (target) lake(target[0], target[1], opt.lakeMin + rng() * opt.lakeSpread);
  }
  return { ok: true, lines };
}

module.exports = { carveRivers };
