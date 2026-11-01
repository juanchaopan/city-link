// 街区划分的增量计算测量，纯 node，不开浏览器。node scripts/replan.js [地图边长]
// 先冷启动划分一遍，再在地图中部画一条横穿全城的新路重新划分：有缓存时只重算原子或沿街变了的街区，
// 按每批 BUDGET_MS 的预算分批跑。报告冷启动、重算的街区数、单块最坏耗时、总耗时和批数，写到 out/replan-report.json。
import { writeFileSync } from 'node:fs';
import { generateCity } from '../web/sim/city.js';
import { generateParcels } from '../web/sim/parcels.js';
import { createPartitioner } from '../web/sim/partition.js';

const N = Number(process.argv[2] ?? 128);
const BUDGET_MS = 8;
const EAST = 1 << 0;
const WEST = 1 << 4;

const city = generateCity(N);
const inputOf = (roads) => ({
  N,
  roads,
  water: city.water,
  slopes: city.slopes,
  zones: city.zones,
  density: city.density,
  seed: 11,
  reserved: city.reserved,
});

/** 在地图中部画一条横穿全城的两车道：已有的路格加上东西两个方向位，别的格新开。 */
function withNewRoad(roads) {
  const next = new Map([...roads.entries()].map(([id, entry]) => [id, { ...entry }]));
  const row = Math.round(N / 2) + 3;
  for (let x = 1; x < N - 1; x += 1) {
    const id = row * N + x;
    const entry = next.get(id) ?? { road: 0, highway: 0, arterial: 0 };
    entry.road |= (x > 1 ? WEST : 0) | (x < N - 2 ? EAST : 0);
    next.set(id, entry);
  }
  return next;
}

function timed(label, run) {
  const started = performance.now();
  const value = run();
  return { label, ms: Math.round(performance.now() - started), value };
}

const partitioner = createPartitioner();
const cold = timed('冷启动', () => generateParcels({ ...inputOf(city.roads), partitioner }));
const changed = withNewRoad(city.roads);
const warm = timed('改路后', () =>
  generateParcels({ ...inputOf(changed), partitioner, budgetMs: BUDGET_MS }),
);
const fresh = timed('改路后不用缓存', () => generateParcels(inputOf(changed)));

const summary = (entry) => {
  const { stats } = entry.value.partition;
  return {
    totalMs: entry.ms,
    partitionMs: Math.round(stats.millis),
    blocks: stats.blocks,
    cachedBlocks: stats.cachedBlocks,
    solvedBlocks: stats.solvedBlocks,
    worstBlockMs: Math.round(stats.worstBlockMs * 10) / 10,
    batches: stats.batches,
    parcels: entry.value.parcels.length,
  };
};
const report = {
  N,
  budgetMs: BUDGET_MS,
  cold: summary(cold),
  replan: summary(warm),
  replanWithoutCache: summary(fresh),
  samePartition:
    JSON.stringify(warm.value.parcels.map((p) => [p.shape, p.px, p.py])) ===
    JSON.stringify(fresh.value.parcels.map((p) => [p.shape, p.px, p.py])),
};
writeFileSync(`out/replan-report-${String(N)}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
