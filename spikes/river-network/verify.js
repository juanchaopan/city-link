'use strict';

const DIR8 = [
  [0, -1], [1, 0], [0, 1], [-1, 0],
  [1, -1], [1, 1], [-1, 1], [-1, -1],
];

const slotAt = (cluster, sx, sy) => (sx < 0 || sy < 0 || sx > 7 || sy > 7 ? null : cluster.slots[sy * 8 + sx]);

// 与生成代码无关的独立检查：只读最终地形和骨架的边界口。
function verifySeams(cluster) {
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

function globalMasks(cluster) {
  const { N } = cluster;
  const G = N * 8;
  const water = new Uint8Array(G * G);
  const coast = new Uint8Array(G * G);
  for (let sy = 0; sy < 8; sy++) {
    for (let sx = 0; sx < 8; sx++) {
      const slot = slotAt(cluster, sx, sy);
      if (!slot) continue;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const g = (sy * N + y) * G + sx * N + x;
          water[g] = slot.water[y * N + x];
          coast[g] = slot.coast[y * N + x];
        }
      }
    }
  }
  return { G, water, coast };
}

function flood(mask, G, starts, dirs) {
  const seen = new Uint8Array(G * G);
  const queue = [];
  for (const s of starts) {
    if (mask[s] && !seen[s]) {
      seen[s] = 1;
      queue.push(s);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const g = queue[head];
    const x = g % G;
    const y = (g / G) | 0;
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
      const n = ny * G + nx;
      if (mask[n] && !seen[n]) {
        seen[n] = 1;
        queue.push(n);
      }
    }
  }
  return seen;
}

// 通航格：以它为中心的 3×3 全是水。河运只算内河，海岸带不算。
function channelMask(water, coast, G) {
  const channel = new Uint8Array(G * G);
  for (let y = 1; y < G - 1; y++) {
    for (let x = 1; x < G - 1; x++) {
      let all = true;
      for (let dy = -1; dy <= 1 && all; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const g = (y + dy) * G + x + dx;
          if (!water[g] || coast[g]) {
            all = false;
            break;
          }
        }
      }
      if (all) channel[y * G + x] = 1;
    }
  }
  return channel;
}

// 只有不是海岸的水穿过共享边界才算有河，这一步不读骨架。
function riverSlotsFromTerrain(cluster) {
  const { N } = cluster;
  const has = new Uint8Array(64);
  for (let sy = 0; sy < 8; sy++) {
    for (let sx = 0; sx < 8; sx++) {
      const slot = slotAt(cluster, sx, sy);
      if (!slot) continue;
      const land = (x, y) => slot.water[y * N + x] && !slot.coast[y * N + x];
      for (let i = 0; i < N; i++) {
        if ((sx > 0 && land(0, i)) || (sx < 7 && land(N - 1, i)) || (sy > 0 && land(i, 0)) || (sy < 7 && land(i, N - 1))) {
          has[sy * 8 + sx] = 1;
          break;
        }
      }
    }
  }
  return has;
}

function verifyNetwork(cluster) {
  const { N, skeleton } = cluster;
  const { G, water, coast } = globalMasks(cluster);
  const channel = channelMask(water, coast, G);
  const has = riverSlotsFromTerrain(cluster);
  const coverage = has.reduce((a, b) => a + b, 0) / 64;

  const mainSlots = skeleton.mainSlots;
  const inSlot = (index) => {
    const out = [];
    const sx = index % 8;
    const sy = (index / 8) | 0;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const g = (sy * N + y) * G + sx * N + x;
        if (channel[g]) out.push(g);
      }
    }
    return out;
  };
  const counts = new Map();
  let startSlot = null;
  for (const index of mainSlots) {
    const tiles = inSlot(index);
    counts.set(index, tiles);
    if (startSlot === null && tiles.length) startSlot = index;
  }
  const seen = startSlot === null ? new Uint8Array(G * G) : flood(channel, G, counts.get(startSlot), DIR8);
  let mainReached = 0;
  for (const index of mainSlots) {
    if (counts.get(index).some((g) => seen[g])) mainReached++;
  }

  // 河流不断：从干流出发，4 邻接走水，所有非海岸的边界口都要走得到。
  const riverMask = new Uint8Array(G * G);
  for (let g = 0; g < G * G; g++) riverMask[g] = water[g] && !coast[g] ? 1 : 0;
  const starts = [];
  for (let g = 0; g < G * G; g++) if (channel[g] && seen[g]) starts.push(g);
  const reach = flood(riverMask, G, starts, DIR8.slice(0, 4));
  let mouths = 0;
  let mouthsBroken = 0;
  for (let sy = 0; sy < 8; sy++) {
    for (let sx = 0; sx < 8; sx++) {
      const sides = skeleton.slots[sy * 8 + sx].sides;
      for (const side of Object.keys(sides)) {
        if (sides[side].kind === 'coast') continue;
        const { offset } = sides[side];
        const [x, y] = side === 'W' ? [0, offset] : side === 'E' ? [N - 1, offset] : side === 'N' ? [offset, 0] : [offset, N - 1];
        mouths++;
        if (!reach[(sy * N + y) * G + sx * N + x]) mouthsBroken++;
      }
    }
  }
  return {
    coverage, mainSlots: mainSlots.length, mainReached, mouths, mouthsBroken, has,
  };
}

// 观感指标按定义在中心线上计算，不看生成过程。
function lineLook(points) {
  const samples = [];
  let last = null;
  for (const p of points) {
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= 1) {
      samples.push(p);
      last = p;
    }
  }
  let sharp = 0;
  let loops = 0;
  let inSharp = false;
  const sharpAt = [];
  for (let i = 4; i < samples.length - 4; i++) {
    const [ax, ay] = samples[i - 4];
    const [bx, by] = samples[i];
    const [cx, cy] = samples[i + 4];
    const u = [bx - ax, by - ay];
    const v = [cx - bx, cy - by];
    const dot = (u[0] * v[0] + u[1] * v[1]) / ((Math.hypot(...u) * Math.hypot(...v)) || 1);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
    if (angle > 70) {
      if (!inSharp) {
        sharp++;
        sharpAt.push([bx, by]);
      }
      inSharp = true;
    } else {
      inSharp = false;
    }
  }
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 24; j < samples.length; j++) {
      if (Math.hypot(samples[i][0] - samples[j][0], samples[i][1] - samples[j][1]) < 7) {
        loops++;
        i = j;
        break;
      }
    }
  }
  let straight = 0;
  let start = 0;
  let straightFrom = 0;
  let straightTo = 0;
  for (let i = 2; i < samples.length; i++) {
    const [ax, ay] = samples[start];
    const [bx, by] = samples[i];
    const length = Math.hypot(bx - ax, by - ay) || 1;
    let far = 0;
    for (let k = start + 1; k < i; k++) {
      const d = Math.abs((bx - ax) * (ay - samples[k][1]) - (ax - samples[k][0]) * (by - ay)) / length;
      if (d > far) far = d;
    }
    if (far > 1) start = i - 1;
    if (i - start > straight) {
      straight = i - start;
      straightFrom = start;
      straightTo = i;
    }
  }
  return {
    tiles: samples.length, sharp, loops, straight, sharpAt, straightPoints: samples.slice(straightFrom, straightTo + 1),
  };
}

module.exports = {
  verifySeams, verifyNetwork, lineLook, globalMasks, channelMask, flood, DIR8,
};
