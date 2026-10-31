import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCluster, generate, tileShape } = require('./vendor/terrain.cjs');

const OPT = {
  plateau: 0.14, low: 0.3, high: 0.64, peak: 0.78, forest: 0.68, mineralChance: 0.5, riverChance: 0.8,
  lakeChance: 0.4, lakeMin: 0.05, lakeSpread: 0.05, buildableFloor: 0.45, cornerPad: true, diagonalRamp: true,
};
const N = 64;
let generated;
let cluster;
for (let seed = 1; seed < 60 && !generated; seed++) {
  cluster = createCluster(seed, N, 3);
  const attempt = generate(cluster, 3, 3, OPT);
  if (attempt.ok && Math.max(...attempt.terrain.h) >= 3) generated = attempt;
}
const { h, water, forest, mineral } = generated.terrain;
const V = N + 1;
const id = (x, y) => y * N + x;

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
const roads = new Uint8Array(N * N);
const passable = (x, y) => x >= 0 && y >= 0 && x < N && y < N && !water[id(x, y)];

function line(x0, y0, dir, length) {
  let x = x0;
  let y = y0;
  for (let i = 0; i < length; i++) {
    const nx = x + DIRS[dir][0];
    const ny = y + DIRS[dir][1];
    if (!passable(x, y) || !passable(nx, ny)) return;
    roads[id(x, y)] |= 1 << dir;
    roads[id(nx, ny)] |= 1 << ((dir + 2) % 4 + (dir >= 4 ? 4 : 0));
    x = nx;
    y = ny;
  }
}

for (let i = 4; i < N; i += 8) {
  line(0, i, 1, N - 1);
  line(i, 0, 2, N - 1);
}
line(0, N - 1, 4, N - 1);
line(0, 0, 5, N - 1);

const level = new Uint8Array(N * N);
const shape = new Uint8Array(N * N);
const buildings = new Uint8Array(N * N);
let roadTiles = 0;
let buildingCount = 0;
let hash = 12345;
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const t = id(x, y);
    const a = h[y * V + x];
    const b = h[y * V + x + 1];
    const c = h[(y + 1) * V + x + 1];
    const d = h[(y + 1) * V + x];
    level[t] = Math.min(a, b, c, d);
    shape[t] = tileShape(h, V, x, y);
    if (roads[t]) roadTiles++;
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    if (!roads[t] && !water[t] && shape[t] === 0) {
      buildings[t] = 1 + (hash >> 8) % 16;
      buildingCount++;
    }
  }
}

fs.writeFileSync('data/city.json', JSON.stringify({
  N,
  level: Array.from(level),
  shape: Array.from(shape),
  water: Array.from(water),
  forest: Array.from(forest),
  mineral: Array.from(mineral),
  roads: Array.from(roads),
  buildings: Array.from(buildings),
}));
console.log(JSON.stringify({ N, roadTiles, buildingCount, maxLevel: Math.max(...level) }));
