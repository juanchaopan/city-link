'use strict';

const { globalMasks, channelMask, flood, DIR8 } = require('./verify');
const { tileShape, SHAPE_AXIS, BRIDGE_SPAN } = require('./roads');
const { STEP } = require('./skeleton');

const FOUR = DIR8.slice(0, 4);

// 骨架上的干流路径：运行时大多数位置还没有地形，路线只能按这张图算。
function skeletonPath(skeleton, from, to) {
  const parent = new Map([[from, -1]]);
  const queue = [from];
  while (queue.length) {
    const index = queue.shift();
    if (index === to) break;
    const x = index % 8;
    const y = (index / 8) | 0;
    const sides = skeleton.slots[index].sides;
    for (const side of Object.keys(sides)) {
      if (sides[side].kind !== 'main') continue;
      const next = (y + STEP[side][1]) * 8 + x + STEP[side][0];
      if (!parent.has(next)) {
        parent.set(next, index);
        queue.push(next);
      }
    }
  }
  if (!parent.has(to)) return null;
  const path = [];
  for (let at = to; at !== -1; at = parent.get(at)) path.push(at);
  return path.reverse();
}

function shipPath(channel, G, start, goal) {
  const parent = new Int32Array(G * G).fill(-2);
  const queue = [start];
  parent[start] = -1;
  for (let head = 0; head < queue.length; head++) {
    const g = queue[head];
    if (g === goal) break;
    const x = g % G;
    const y = (g / G) | 0;
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
      const n = ny * G + nx;
      if (channel[n] && parent[n] === -2) {
        parent[n] = g;
        queue.push(n);
      }
    }
  }
  if (parent[goal] === -2) return null;
  const path = [];
  for (let g = goal; g !== -1; g = parent[g]) path.push(g);
  return path.reverse();
}

// 从骨架的干流边界口出发，得到真正和干流相连的通航水面，孤立的湖不算。
function mainChannel(cluster, channel, G) {
  const { N, skeleton } = cluster;
  const starts = [];
  for (const index of skeleton.mainSlots) {
    const sx = index % 8;
    const sy = (index / 8) | 0;
    const sides = skeleton.slots[index].sides;
    for (const side of Object.keys(sides)) {
      if (sides[side].kind !== 'main') continue;
      const { offset } = sides[side];
      const [x, y] = side === 'W' ? [2, offset] : side === 'E' ? [N - 3, offset] : side === 'N' ? [offset, 2] : [offset, N - 3];
      starts.push((sy * N + y) * G + sx * N + x);
    }
  }
  return flood(channel, G, starts, DIR8);
}

// 分析一个填满的城市群：岸线、码头位置、内河路线，以及桥会不会截断干流。
function analyzePorts(cluster, rng, pairs) {
  const { N, skeleton } = cluster;
  const V = N + 1;
  const { G, water, coast } = globalMasks(cluster);
  const allChannel = channelMask(water, coast, G);
  const connected = mainChannel(cluster, allChannel, G);
  const navigable = new Uint8Array(G * G);
  let isolatedChannel = 0;
  for (let g = 0; g < G * G; g++) {
    if (allChannel[g] && !connected[g]) isolatedChannel++;
    if (!connected[g]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) navigable[g + dy * G + dx] = 1;
  }

  const stats = [];
  const sites = new Map();
  const bridges = [];
  for (const index of skeleton.mainSlots) {
    const sx = index % 8;
    const sy = (index / 8) | 0;
    const slot = cluster.slots[index];
    const landAt = (x, y) => x >= 0 && y >= 0 && x < N && y < N && !slot.water[y * N + x];
    const flatAt = (x, y) => landAt(x, y) && tileShape(slot.h, V, x, y) === 0;
    let bank = 0;
    const list = [];
    const spans = [];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (!landAt(x, y)) continue;
        const gx = sx * N + x;
        const gy = sy * N + y;
        let onBank = false;
        for (const [dx, dy] of FOUR) {
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx < 0 || ny < 0 || nx >= G || ny >= G || !navigable[ny * G + nx]) continue;
          if (flatAt(x, y)) onBank = true;
          // 码头占 3×2 平地，长边贴岸，正前方要能进入通航水域。
          const px = -dy;
          const py = dx;
          let fits = true;
          for (let a = -1; a <= 1 && fits; a++) {
            for (let b = 0; b <= 1; b++) {
              if (!flatAt(x + px * a - dx * b, y + py * a - dy * b)) {
                fits = false;
                break;
              }
            }
          }
          if (fits) {
            for (let d = 1; d <= 3; d++) {
              const cx = gx + dx * d;
              const cy = gy + dy * d;
              if (cx >= 0 && cy >= 0 && cx < G && cy < G && connected[cy * G + cx]) {
                list.push(cy * G + cx);
                break;
              }
            }
          }
        }
        if (onBank) bank++;
        const shape = SHAPE_AXIS[tileShape(slot.h, V, x, y)];
        if (shape.kind === 'saddle') continue;
        for (const [dx, dy] of DIR8) {
          let step = 1;
          let bx = x + dx;
          let by = y + dy;
          const tiles = [];
          while (step <= BRIDGE_SPAN && bx >= 0 && by >= 0 && bx < N && by < N && slot.water[by * N + bx]) {
            tiles.push((sy * N + by) * G + sx * N + bx);
            step++;
            bx += dx;
            by += dy;
          }
          if (tiles.length === 0 || bx < 0 || by < 0 || bx >= N || by >= N || slot.water[by * N + bx]) continue;
          if (SHAPE_AXIS[tileShape(slot.h, V, bx, by)].kind === 'saddle') continue;
          if (tiles.some((g) => connected[g])) spans.push(tiles);
        }
      }
    }
    stats.push({ index, bank, sites: list.length, bridges: spans.length });
    sites.set(index, list);
    for (let i = 0; i < 2 && spans.length; i++) bridges.push(spans[(rng() * spans.length) | 0]);
  }

  let routes = 0;
  let failed = 0;
  let slotMismatch = 0;
  let lengthSum = 0;
  let lengthMax = 0;
  let viaSum = 0;
  const usable = skeleton.mainSlots.filter((index) => sites.get(index).length > 0);
  for (let i = 0; i < pairs && usable.length > 1; i++) {
    const a = usable[(rng() * usable.length) | 0];
    let b = usable[(rng() * usable.length) | 0];
    if (a === b) b = usable[(usable.indexOf(a) + 1) % usable.length];
    const listA = sites.get(a);
    const listB = sites.get(b);
    const start = listA[(rng() * listA.length) | 0];
    const goal = listB[(rng() * listB.length) | 0];
    const path = shipPath(connected, G, start, goal);
    routes++;
    if (!path) {
      failed++;
      continue;
    }
    lengthSum += path.length;
    lengthMax = Math.max(lengthMax, path.length);
    const slots = [];
    for (const g of path) {
      const slot = (((g / G) | 0) / N | 0) * 8 + ((g % G) / N | 0);
      if (slots[slots.length - 1] !== slot) slots.push(slot);
    }
    viaSum += Math.max(0, slots.length - 2);
    const expected = skeletonPath(skeleton, a, b);
    if (!expected || expected.join() !== slots.join()) slotMismatch++;
  }

  // 桥不进入通航格判定；这里对比桥会挡船时会发生什么。
  const start = usable.length ? [sites.get(usable[0])[0]] : [];
  const reachedSlots = (mask) => {
    const seen = flood(mask, G, start, DIR8);
    let count = 0;
    for (const index of skeleton.mainSlots) {
      if (sites.get(index).some((g) => seen[g])) count++;
    }
    return count;
  };
  const withBridges = connected.slice();
  for (const tiles of bridges) for (const g of tiles) withBridges[g] = 0;
  return {
    stats,
    routes,
    failed,
    slotMismatch,
    lengthSum,
    lengthMax,
    viaSum,
    mainWithSites: usable.length,
    mainReachedOpen: start.length ? reachedSlots(connected) : 0,
    mainReachedIfBridgesBlock: start.length ? reachedSlots(withBridges) : 0,
    bridgesPlaced: bridges.length,
    isolatedChannel,
  };
}

module.exports = { analyzePorts };
