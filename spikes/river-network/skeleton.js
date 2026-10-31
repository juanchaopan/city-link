'use strict';

const { makeRng } = require('./core');

const STEP = { W: [-1, 0], E: [1, 0], N: [0, -1], S: [0, 1] };
const OPPOSITE = { W: 'E', E: 'W', N: 'S', S: 'N' };
const LEFT = { W: 'S', S: 'E', E: 'N', N: 'W' };
const RIGHT = { W: 'N', N: 'E', E: 'S', S: 'W' };
const OFFSET_RANGES = [[8, 21], [43, 55]];

const inBounds = (x, y) => x >= 0 && y >= 0 && x < 8 && y < 8;
const key = (x, y) => y * 8 + x;

function randomOffset(rng) {
  const range = OFFSET_RANGES[rng() < 0.5 ? 0 : 1];
  return range[0] + ((rng() * (range[1] - range[0] + 1)) | 0);
}

// 骨架是位置图上的一棵树：slots[位置].sides 记录这个位置哪条边有河穿过、偏移和类型。
function createSkeleton(seed, edges, opt) {
  const rng = makeRng(seed ^ 0x13579b);
  const slots = Array.from({ length: 64 }, () => ({ sides: {}, kind: 'none' }));
  const main = new Set();
  const degree = (index) => Object.keys(slots[index].sides).length;
  const connect = (x, y, side, kind) => {
    const [dx, dy] = STEP[side];
    const offset = randomOffset(rng);
    slots[key(x, y)].sides[side] = { offset, kind };
    slots[key(x + dx, y + dy)].sides[OPPOSITE[side]] = { offset, kind };
  };

  // 新节点不贴着已有河段，否则树会折回来，看起来像回环。
  const clear = (x, y, fromX, fromY, set) => {
    for (const side of Object.keys(STEP)) {
      const nx = x + STEP[side][0];
      const ny = y + STEP[side][1];
      if (!inBounds(nx, ny) || (nx === fromX && ny === fromY)) continue;
      if (set.has(key(nx, ny))) return false;
    }
    return true;
  };

  const walk = (startX, startY, heading, length) => {
    let x = startX;
    let y = startY;
    let dir = heading;
    let walked = 0;
    for (let i = 0; i < length; i++) {
      const roll = rng();
      const preferred = roll < 0.55 ? [dir, LEFT[dir], RIGHT[dir]] : roll < 0.78 ? [LEFT[dir], dir, RIGHT[dir]] : [RIGHT[dir], dir, LEFT[dir]];
      let moved = false;
      for (const side of preferred) {
        const nx = x + STEP[side][0];
        const ny = y + STEP[side][1];
        if (!inBounds(nx, ny) || main.has(key(nx, ny)) || !clear(nx, ny, x, y, main)) continue;
        if (degree(key(x, y)) >= 3) continue;
        connect(x, y, side, 'main');
        main.add(key(nx, ny));
        x = nx;
        y = ny;
        dir = side;
        moved = true;
        walked++;
        break;
      }
      if (!moved) break;
    }
    return walked;
  };

  const coastSides = Object.keys(edges).filter((side) => edges[side] === 'coast');
  let startX;
  let startY;
  let heading;
  if (coastSides.length > 0) {
    const side = coastSides[(rng() * coastSides.length) | 0];
    const along = 2 + ((rng() * 4) | 0);
    startX = side === 'W' ? 0 : side === 'E' ? 7 : along;
    startY = side === 'N' ? 0 : side === 'S' ? 7 : along;
    heading = OPPOSITE[side];
    slots[key(startX, startY)].sides[side] = { offset: randomOffset(rng), kind: 'coast' };
  } else {
    startX = 2 + ((rng() * 4) | 0);
    startY = 2 + ((rng() * 4) | 0);
    heading = ['W', 'E', 'N', 'S'][(rng() * 4) | 0];
  }
  main.add(key(startX, startY));
  walk(startX, startY, heading, 9 + ((rng() * 4) | 0));

  const mainTarget = Math.round(64 * opt.mainShare);
  for (let tries = 0; tries < 200 && main.size < mainTarget; tries++) {
    const list = [...main];
    const index = list[(rng() * list.length) | 0];
    if (degree(index) >= 3) continue;
    const side = ['W', 'E', 'N', 'S'][(rng() * 4) | 0];
    if (slots[index].sides[side]) continue;
    walk(index % 8, (index / 8) | 0, side, 2 + ((rng() * 4) | 0));
  }

  // 支流从已有河道向没有河的位置逐格延伸。
  const covered = new Set(main);
  const riverTarget = Math.round(64 * opt.riverShare);
  for (let tries = 0; tries < 400 && covered.size < riverTarget; tries++) {
    const list = [...covered];
    const index = list[(rng() * list.length) | 0];
    if (degree(index) >= 3) continue;
    const x = index % 8;
    const y = (index / 8) | 0;
    const side = ['W', 'E', 'N', 'S'][(rng() * 4) | 0];
    const nx = x + STEP[side][0];
    const ny = y + STEP[side][1];
    if (!inBounds(nx, ny) || covered.has(key(nx, ny))) continue;
    connect(x, y, side, 'trib');
    covered.add(key(nx, ny));
  }

  for (const index of covered) slots[index].kind = main.has(index) ? 'main' : 'trib';
  return { seed, slots, mainSlots: [...main], riverSlots: covered.size };
}

// 回归城市需要的签名：哪些边有河、什么类型。
function signature(slot) {
  return ['W', 'E', 'N', 'S'].map((side) => (slot.sides[side] ? slot.sides[side].kind[0] : '-')).join('');
}

module.exports = { createSkeleton, signature, STEP, OPPOSITE };
