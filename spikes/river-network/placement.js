'use strict';

const { STEP, OPPOSITE } = require('./skeleton');

const SIDES = ['W', 'E', 'N', 'S'];
const MIN_RIVER_SLOTS = Math.ceil(64 * 0.7);
const MAX_NEIGHBOUR_DEGREE = 3;

const isOuter = (side, sx, sy) => (side === 'W' && sx === 0) || (side === 'E' && sx === 7) || (side === 'N' && sy === 0) || (side === 'S' && sy === 7);
const outerSides = (sx, sy) => SIDES.filter((side) => isOuter(side, sx, sy));

// 贴外边界的城市自带海岸带或山边，所以只能回到同类外边界上。
function sameBoundary(source, target) {
  const a = outerSides(source.sx, source.sy);
  const b = outerSides(target.sx, target.sy);
  if (a.join() !== b.join()) return false;
  return a.every((side) => source.edges[side] === target.edges[side]);
}

function clearAround(cluster, sx, sy) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = sx + dx;
      const y = sy + dy;
      if (x >= 0 && y >= 0 && x < 8 && y < 8 && cluster.slots[y * 8 + x]) return false;
    }
  }
  return true;
}

const isMainKind = (kind) => kind === 'main' || kind === 'coast';

// 河网规则：干流位置彼此连通，每个有河的位置都连到干流网，至少 70% 的位置有河。
function networkValid(sidesBySlot) {
  const mains = [];
  const rivers = [];
  for (let i = 0; i < 64; i++) {
    const kinds = Object.values(sidesBySlot[i]).map((entry) => entry.kind);
    if (kinds.length) rivers.push(i);
    if (kinds.some(isMainKind)) mains.push(i);
  }
  if (rivers.length < MIN_RIVER_SLOTS || mains.length === 0) return false;
  const walk = (starts, allowTrib) => {
    const seen = new Set(starts);
    const queue = [...starts];
    while (queue.length) {
      const index = queue.pop();
      const x = index % 8;
      const y = (index / 8) | 0;
      for (const side of Object.keys(sidesBySlot[index])) {
        const entry = sidesBySlot[index][side];
        if (entry.kind === 'coast' || (!allowTrib && entry.kind !== 'main')) continue;
        const next = (y + STEP[side][1]) * 8 + x + STEP[side][0];
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  };
  if (walk([mains[0]], false).size !== mains.length) return false;
  return walk(mains, true).size === rivers.length;
}

// 试着把一个位置四条边改成回归城市的河流接口。周围 8 个位置都没有地形，改动只碰骨架。
function evaluate(cluster, sx, sy, citySides) {
  const index = sy * 8 + sx;
  const copy = cluster.skeleton.slots.map((slot) => ({ ...slot.sides }));
  let cost = 0;
  for (const side of SIDES) {
    const want = citySides[side];
    const have = copy[index][side];
    if ((want && !have) || (!want && have) || (want && have && want.kind !== have.kind)) cost++;
    if (want) copy[index][side] = want;
    else delete copy[index][side];
    if (isOuter(side, sx, sy)) continue;
    const nx = sx + STEP[side][0];
    const ny = sy + STEP[side][1];
    const neighbour = ny * 8 + nx;
    if (want) copy[neighbour][OPPOSITE[side]] = want;
    else delete copy[neighbour][OPPOSITE[side]];
    if (Object.keys(copy[neighbour]).length > MAX_NEIGHBOUR_DEGREE) return null;
  }
  return networkValid(copy) ? { sx, sy, cost, copy } : null;
}

function bestSpot(cluster, source, citySides) {
  let best = null;
  for (let sy = 0; sy < 8; sy++) {
    for (let sx = 0; sx < 8; sx++) {
      if (!clearAround(cluster, sx, sy)) continue;
      if (!sameBoundary(source, { sx, sy, edges: cluster.edges })) continue;
      const result = evaluate(cluster, sx, sy, citySides);
      if (result && (!best || result.cost < best.cost)) best = result;
    }
  }
  return best;
}

function adopt(cluster, spot, terrain) {
  const { skeleton } = cluster;
  const main = [];
  let rivers = 0;
  for (let i = 0; i < 64; i++) {
    skeleton.slots[i].sides = spot.copy[i];
    const kinds = Object.values(spot.copy[i]).map((entry) => entry.kind);
    if (kinds.some(isMainKind)) main.push(i);
    if (kinds.length) rivers++;
    skeleton.slots[i].kind = kinds.some(isMainKind) ? 'main' : kinds.length ? 'trib' : 'none';
  }
  skeleton.mainSlots = main;
  skeleton.riverSlots = rivers;
  cluster.slots[spot.sy * 8 + spot.sx] = { ...terrain, sx: spot.sx, sy: spot.sy };
}

module.exports = { bestSpot, adopt, clearAround, sameBoundary };
