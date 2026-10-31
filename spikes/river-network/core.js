'use strict';

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

class MinHeap {
  constructor() {
    this.keys = [];
    this.values = [];
  }

  push(key, value) {
    const { keys, values } = this;
    let i = keys.length;
    keys.push(key);
    values.push(value);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      values[i] = values[p];
      i = p;
    }
    keys[i] = key;
    values[i] = value;
  }

  pop() {
    const { keys, values } = this;
    const top = values[0];
    const key = keys.pop();
    const value = values.pop();
    const size = keys.length;
    if (size > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= size) break;
        if (c + 1 < size && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        values[i] = values[c];
        i = c;
      }
      keys[i] = key;
      values[i] = value;
    }
    return top;
  }

  get size() {
    return this.keys.length;
  }
}

module.exports = { makeRng, valueNoise, propagate, bounds, MinHeap };
