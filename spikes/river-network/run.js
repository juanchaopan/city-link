'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { makeRng } = require('./core');
const { createCluster, generate } = require('./terrain');
const { verifySeams, verifyNetwork, lineLook } = require('./verify');
const { drawCluster } = require('./draw');
const OPT = require('./params');

const OUT = path.join(__dirname, 'out');

function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function fill(seed, N, maxLevel, opt, limit = 64) {
  const started = process.hrtime.bigint();
  const cluster = createCluster(seed, N, maxLevel, opt);
  const createMs = Number(process.hrtime.bigint() - started) / 1e6;
  const order = shuffle([...Array(64).keys()], makeRng(seed ^ 0x5bd1e995)).slice(0, limit);
  const records = [];
  for (const index of order) {
    const t0 = process.hrtime.bigint();
    const result = generate(cluster, index % 8, (index / 8) | 0, opt);
    records.push({ index, ms: Number(process.hrtime.bigint() - t0) / 1e6, result });
  }
  return { cluster, records, createMs };
}

const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
};
const round = (value, digits = 3) => Number(value.toFixed(digits));
const mean = (values) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

function run(name, clusters, N, maxLevel, opt, draw) {
  const stats = {
    name, N, maxLevel, clusters, cities: 0, hardFailures: 0, failureReasons: {}, retried: 0, attemptsMax: 0,
  };
  const seams = {};
  const times = [];
  const creates = [];
  const coverage = [];
  const skeletonBytes = [];
  const network = { mainSlots: 0, mainReached: 0, mouths: 0, mouthsBroken: 0 };
  const groups = { main: [], trib: [], none: [] };
  const metrics = [];
  const look = { main: { tiles: 0, sharp: 0, loops: 0, straight: [] }, trib: { tiles: 0, sharp: 0, loops: 0, straight: [] } };
  let sample = null;
  let second = null;
  for (let seed = 1; seed <= clusters; seed++) {
    const { cluster, records, createMs } = fill(seed, N, maxLevel, opt);
    creates.push(createMs);
    skeletonBytes.push(JSON.stringify(cluster.skeleton.slots.map((s) => s.sides)).length);
    if (!sample) sample = cluster;
    else if (!second && cluster.skeleton.mainSlots.length > 25) second = cluster;
    for (const { ms, result, index } of records) {
      times.push(ms);
      stats.cities++;
      stats.attemptsMax = Math.max(stats.attemptsMax, result.attempts);
      for (const [reason, count] of Object.entries(result.failures)) {
        stats.failureReasons[reason] = (stats.failureReasons[reason] || 0) + count;
      }
      if (!result.ok) {
        stats.hardFailures++;
        continue;
      }
      if (result.attempts > 1) stats.retried++;
      const m = result.terrain.metrics;
      metrics.push(m);
      groups[cluster.skeleton.slots[index].kind].push(m);
      for (const line of result.terrain.lines) {
        const l = lineLook(line.points);
        const target = look[line.kind];
        target.tiles += l.tiles;
        target.sharp += l.sharp;
        target.loops += l.loops;
        target.straight.push(l.straight);
      }
    }
    const s = verifySeams(cluster);
    for (const key of Object.keys(s)) seams[key] = (seams[key] || 0) + s[key];
    const n = verifyNetwork(cluster);
    coverage.push(n.coverage);
    for (const key of Object.keys(network)) network[key] += n[key];
  }
  const pick = (list, key) => list.map((m) => m[key]);
  const summary = (list, key) => (list.length ? {
    mean: round(mean(pick(list, key))), p05: round(quantile(pick(list, key), 0.05)), min: round(Math.min(...pick(list, key))),
  } : null);
  const lookSummary = (entry) => ({
    tiles: entry.tiles,
    sharp: entry.sharp,
    loops: entry.loops,
    sharpPer100: round(entry.sharp / Math.max(1, entry.tiles) * 100, 2),
    straightP50: quantile(entry.straight, 0.5),
    straightP95: quantile(entry.straight, 0.95),
    straightMax: Math.max(...entry.straight),
  });
  Object.assign(stats, {
    seams,
    coverage: { mean: round(mean(coverage)), min: round(Math.min(...coverage)) },
    network,
    buildable: summary(metrics, 'buildable'),
    water: summary(metrics, 'water'),
    hill: summary(metrics, 'hill'),
    forest: summary(metrics, 'forest'),
    mineral: summary(metrics, 'mineral'),
    slope: summary(metrics, 'slope'),
    byKind: {
      main: { count: groups.main.length, buildable: summary(groups.main, 'buildable'), water: summary(groups.main, 'water') },
      trib: { count: groups.trib.length, buildable: summary(groups.trib, 'buildable'), water: summary(groups.trib, 'water') },
      none: { count: groups.none.length, buildable: summary(groups.none, 'buildable'), water: summary(groups.none, 'water') },
    },
    firstTradeFail: metrics.filter((m) => !m.anyRoad).length,
    connectFail: metrics.filter((m) => !m.allRoad).length,
    ms: { p50: round(quantile(times, 0.5), 2), p95: round(quantile(times, 0.95), 2), max: round(Math.max(...times), 2) },
    createMs: { mean: round(mean(creates), 2), max: round(Math.max(...creates), 2) },
    skeletonJsonBytes: { mean: Math.round(mean(skeletonBytes)), max: Math.max(...skeletonBytes) },
    look: { main: lookSummary(look.main), trib: lookSummary(look.trib) },
  });
  if (draw) {
    fs.mkdirSync(OUT, { recursive: true });
    drawCluster(path.join(OUT, `${name}-a.png`), sample, 2);
    if (second) drawCluster(path.join(OUT, `${name}-b.png`), second, 2);
  }
  return { stats, sample };
}

function storage(cluster) {
  const sizes = cluster.slots.filter(Boolean).map((slot) => zlib.gzipSync(Buffer.concat([
    Buffer.from(slot.h.buffer), Buffer.from(slot.water.buffer), Buffer.from(slot.forest.buffer), Buffer.from(slot.mineral.buffer),
  ])).length);
  return { gzipMean: Math.round(mean(sizes)), gzipMax: Math.max(...sizes) };
}

function main() {
  const mode = process.argv[2] || 'quick';
  const clusters = mode === 'full' ? 30 : 3;
  const { stats, sample } = run('cluster', clusters, 64, 3, OPT, true);
  stats.storage = storage(sample);
  if (mode === 'full') {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ node: process.version, opt: OPT, stats }, null, 2));
  }
  console.log(JSON.stringify(stats, null, 1));
}

if (require.main === module) main();

module.exports = { run, fill, shuffle };
