'use strict';

// 找出单次生成的耗时来自算法、垃圾回收还是机器负载。必须在 terrain.js 加载前换掉函数。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PerformanceObserver } = require('perf_hooks');
const rivers = require('./rivers');
const roads = require('./roads');

const clock = { carve: 0, measure: 0 };
const originalCarve = rivers.carveRivers;
const originalMeasure = roads.measure;
rivers.carveRivers = (ctx) => {
  const t0 = process.hrtime.bigint();
  const result = originalCarve(ctx);
  clock.carve += Number(process.hrtime.bigint() - t0) / 1e6;
  return result;
};
roads.measure = (...args) => {
  const t0 = process.hrtime.bigint();
  const result = originalMeasure(...args);
  clock.measure += Number(process.hrtime.bigint() - t0) / 1e6;
  return result;
};

const { createCluster, generate } = require('./terrain');
const { makeRng } = require('./core');
const OPT = require('./params');

const N = 64;
const OUT = path.join(__dirname, 'out');
const CLUSTERS = 30;
const REPEATS = 3;

const gc = [];
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) gc.push({ at: entry.startTime, ms: entry.duration });
}).observe({ entryTypes: ['gc'] });

function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
};
const round = (value) => Number(value.toFixed(2));

async function pass(index) {
  const records = [];
  const started = performance.now();
  for (let seed = 1; seed <= CLUSTERS; seed++) {
    const cluster = createCluster(seed, N, 3, OPT);
    const order = shuffle([...Array(64).keys()], makeRng(seed ^ 0x5bd1e995));
    for (const slot of order) {
      clock.carve = 0;
      clock.measure = 0;
      const at = performance.now();
      const result = generate(cluster, slot % 8, (slot / 8) | 0, OPT);
      const ms = performance.now() - at;
      records.push({
        pass: index, seed, slot, ms, carve: clock.carve, measure: clock.measure, attempts: result.attempts, at,
      });
    }
    // 让性能观察器有机会把这段时间的垃圾回收记录交出来。
    await new Promise((resolve) => { setImmediate(resolve); });
  }
  return { records, seconds: (performance.now() - started) / 1000 };
}

async function main() {
  const passes = [];
  for (let i = 0; i < REPEATS; i++) passes.push(await pass(i));
  await new Promise((resolve) => { setTimeout(resolve, 200); });

  const summarize = ({ records, seconds }) => {
    const times = records.map((r) => r.ms);
    const carve = records.map((r) => r.carve);
    const measure = records.map((r) => r.measure);
    return {
      seconds: round(seconds),
      p50: round(quantile(times, 0.5)),
      p95: round(quantile(times, 0.95)),
      p99: round(quantile(times, 0.99)),
      max: round(Math.max(...times)),
      carveP95: round(quantile(carve, 0.95)),
      carveMax: round(Math.max(...carve)),
      measureP95: round(quantile(measure, 0.95)),
      measureMax: round(Math.max(...measure)),
    };
  };
  const slowest = passes.flatMap((p) => p.records).sort((a, b) => b.ms - a.ms).slice(0, 12).map((r) => {
    const others = passes.map((p) => round(p.records.find((o) => o.seed === r.seed && o.slot === r.slot).ms));
    const overlap = gc.filter((g) => g.at + g.ms >= r.at && g.at <= r.at + r.ms);
    return {
      pass: r.pass,
      seed: r.seed,
      slot: r.slot,
      ms: round(r.ms),
      carve: round(r.carve),
      measure: round(r.measure),
      attempts: r.attempts,
      samePassesMs: others,
      gcOverlapMs: round(overlap.reduce((a, g) => a + g.ms, 0)),
    };
  });
  const report = {
    node: process.version,
    cpus: os.cpus().length,
    loadavg: os.loadavg(),
    passes: passes.map(summarize),
    gc: { count: gc.length, totalMs: round(gc.reduce((a, g) => a + g.ms, 0)), maxMs: round(Math.max(0, ...gc.map((g) => g.ms))) },
    slowest,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'profile.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 1));
}

main();
