'use strict';

const fs = require('fs');
const path = require('path');
const { createCluster, generate, makeRng, tileShape, SHAPE_AXIS } = require('./terrain');

const OPT = {
  plateau: 0.14, low: 0.3, high: 0.64, peak: 0.78, forest: 0.68, mineralChance: 0.5, riverChance: 0.8,
  lakeChance: 0.4, lakeMin: 0.05, lakeSpread: 0.05, buildableFloor: 0.45, cornerPad: true, diagonalRamp: false,
};
const STEPS = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
const BRIDGE_SPAN = 5;

// 最省素材的线路规则：平地八方向，坡上只走四向直坡道，桥只走正交方向。
function reachable(slot) {
  const { N, h, water } = slot;
  const V = N + 1;
  const kind = (t) => {
    const entry = SHAPE_AXIS[tileShape(h, V, t % N, (t / N) | 0)];
    return entry || { kind: 'steep', axes: [] };
  };
  const enter = (t, d) => {
    if (water[t]) return false;
    const shape = kind(t);
    if (shape.kind === 'flat') return true;
    return shape.kind === 'ramp' && d < 4 && shape.axes[0] === d % 2;
  };
  const seen = new Uint8Array(N * N * 8);
  const queue = [];
  const start = ((N / 2) | 0) * N + ((N / 2) | 0);
  for (let d = 0; d < 8; d++) {
    seen[start * 8 + d] = 1;
    queue.push(start * 8 + d);
  }
  const push = (t, d) => {
    if (!seen[t * 8 + d]) {
      seen[t * 8 + d] = 1;
      queue.push(t * 8 + d);
    }
  };
  for (let head = 0; head < queue.length; head++) {
    const s = queue[head];
    const t = (s / 8) | 0;
    const d = s % 8;
    const x = t % N;
    const y = (t / N) | 0;
    const flat = kind(t).kind === 'flat';
    for (let nd = 0; nd < 8; nd++) {
      if (!flat && nd !== d) continue;
      const nx = x + STEPS[nd][0];
      const ny = y + STEPS[nd][1];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const nt = ny * N + nx;
      if (!water[nt]) {
        if (!enter(nt, nd)) continue;
        if (nd >= 4 && (water[ny * N + x] || water[y * N + nx])) continue;
        push(nt, nd);
        continue;
      }
      if (nd >= 4) continue;
      let span = 1;
      let bx = nx + STEPS[nd][0];
      let by = ny + STEPS[nd][1];
      while (span < BRIDGE_SPAN && bx >= 0 && by >= 0 && bx < N && by < N && water[by * N + bx]) {
        span++;
        bx += STEPS[nd][0];
        by += STEPS[nd][1];
      }
      if (bx < 0 || by < 0 || bx >= N || by >= N || water[by * N + bx]) continue;
      const landing = by * N + bx;
      if (enter(landing, nd)) push(landing, nd);
    }
  }
  return (t) => {
    for (let d = 0; d < 8; d++) if (seen[t * 8 + d]) return true;
    return false;
  };
}

function run(N, maxLevel, clusters) {
  const result = { N, maxLevel, clusters, cities: 0, hardFailures: 0, strictConnectFail: 0, shapes: {} };
  for (let seed = 1; seed <= clusters; seed++) {
    const cluster = createCluster(seed, N, maxLevel);
    const order = [...Array(64).keys()];
    const rng = makeRng(seed ^ 0x5bd1e995);
    for (let i = order.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const index of order) {
      const sx = index % 8;
      const sy = (index / 8) | 0;
      const generated = generate(cluster, sx, sy, OPT);
      result.cities++;
      if (!generated.ok) {
        result.hardFailures++;
        continue;
      }
      const slot = generated.terrain;
      for (const [shape, count] of Object.entries(slot.metrics.shapes)) {
        result.shapes[shape] = (result.shapes[shape] || 0) + count;
      }
      const can = reachable(slot);
      const mid = N >> 1;
      const targets = [];
      if (sx > 0) targets.push(mid * N);
      if (sx < 7) targets.push(mid * N + N - 1);
      if (sy > 0) targets.push(mid);
      if (sy < 7) targets.push((N - 1) * N + mid);
      if (targets.some((t) => !can(t))) result.strictConnectFail++;
    }
  }
  return result;
}

const results = [run(64, 2, 15), run(64, 3, 15)];
for (const r of results) console.log(JSON.stringify(r));
fs.writeFileSync(path.join(__dirname, 'out', 'assets.json'), JSON.stringify(results, null, 2));
