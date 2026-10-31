'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createCluster, generate, verifyCluster, makeRng } = require('./terrain');

const OUT = path.join(__dirname, 'out');
const BASE = {
  plateau: 0.14,
  low: 0.3,
  high: 0.64,
  peak: 0.78,
  forest: 0.68,
  mineralChance: 0.5,
  riverChance: 0.8,
  lakeChance: 0.4,
  lakeMin: 0.05,
  lakeSpread: 0.05,
  buildableFloor: 0.45,
  cornerPad: true,
  diagonalRamp: true,
};

function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function fillCluster(seed, N, maxLevel, opt) {
  const cluster = createCluster(seed, N, maxLevel);
  const order = shuffle([...Array(64).keys()], makeRng(seed ^ 0x5bd1e995));
  const records = [];
  for (const index of order) {
    const started = process.hrtime.bigint();
    const result = generate(cluster, index % 8, (index / 8) | 0, opt);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    records.push({ ms, result, index });
  }
  return { cluster, records };
}

function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function experiment(name, clusters, N, maxLevel, opt) {
  const stats = {
    name, N, maxLevel, clusters, cities: 0, hardFailures: 0, failureReasons: {}, retried: 0, attemptsMax: 0, seams: {},
  };
  const metrics = [];
  const times = [];
  const shapes = {};
  const pieces = {};
  let sample = null;
  for (let seed = 1; seed <= clusters; seed++) {
    const { cluster, records } = fillCluster(seed, N, maxLevel, opt);
    if (!sample) sample = cluster;
    for (const { ms, result } of records) {
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
      for (const [k, v] of Object.entries(m.shapes)) shapes[k] = (shapes[k] || 0) + v;
      for (const [k, v] of Object.entries(m.pieces)) pieces[k] = (pieces[k] || 0) + v;
    }
    const seams = verifyCluster(cluster);
    for (const key of Object.keys(seams)) stats.seams[key] = (stats.seams[key] || 0) + seams[key];
  }
  stats.forestSeamRate = round(stats.seams.forestSeam / Math.max(1, stats.seams.seamTiles));
  stats.riverNearBorderRate = round(stats.seams.riverNearBorder / Math.max(1, stats.seams.riverTiles));
  const pick = (key) => metrics.map((m) => m[key]);
  const summary = (key) => ({
    mean: round(pick(key).reduce((a, b) => a + b, 0) / Math.max(1, metrics.length)),
    p05: round(quantile(pick(key), 0.05)),
    min: round(Math.min(...pick(key))),
  });
  stats.buildable = summary('buildable');
  stats.slope = summary('slope');
  stats.water = summary('water');
  stats.hill = summary('hill');
  stats.forest = summary('forest');
  stats.mineral = summary('mineral');
  stats.firstTradeFail = metrics.filter((m) => !m.anyRoad).length;
  stats.connectFail = metrics.filter((m) => !m.allRoad).length;
  stats.ms = { p50: round(quantile(times, 0.5), 2), p95: round(quantile(times, 0.95), 2), max: round(Math.max(...times), 2) };
  stats.shapes = shapes;
  stats.pieces = pieces;
  return { stats, sample };
}

function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function writePng(file, width, height, rgb) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

function drawCluster(file, cluster, scale) {
  const { N } = cluster;
  const size = N * 8 * scale;
  const rgb = Buffer.alloc(size * size * 3);
  const ground = [[150, 190, 110], [120, 170, 90], [165, 150, 105], [205, 195, 180]];
  for (let sy = 0; sy < 8; sy++) {
    for (let sx = 0; sx < 8; sx++) {
      const slot = cluster.slots[sy * 8 + sx];
      if (!slot) continue;
      const V = N + 1;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const t = y * N + x;
          const level = slot.h[y * V + x];
          const shade = (level - slot.h[(y + 1) * V + x + 1]) * 22;
          let colour = ground[level].map((c) => Math.max(0, Math.min(255, c + shade)));
          if (slot.forest[t]) colour = colour.map((c, i) => c * (i === 1 ? 0.72 : 0.5));
          if (slot.mineral[t]) colour = [200, 80, 70];
          if (slot.water[t]) colour = [60, 120, 200];
          for (let py = 0; py < scale; py++) {
            for (let px = 0; px < scale; px++) {
              const ox = (sx * N + x) * scale + px;
              const oy = (sy * N + y) * scale + py;
              const i = (oy * size + ox) * 3;
              rgb[i] = colour[0];
              rgb[i + 1] = colour[1];
              rgb[i + 2] = colour[2];
            }
          }
        }
      }
    }
  }
  writePng(file, size, size, rgb);
}

function storage(cluster) {
  const sizes = cluster.slots.filter(Boolean).map((slot) => {
    const raw = Buffer.concat([Buffer.from(slot.h.buffer), Buffer.from(slot.water.buffer), Buffer.from(slot.forest.buffer), Buffer.from(slot.mineral.buffer)]);
    return { raw: raw.length, gzip: zlib.gzipSync(raw).length };
  });
  return {
    rawBytes: sizes[0].raw,
    gzipBytesMean: Math.round(sizes.reduce((a, s) => a + s.gzip, 0) / sizes.length),
    gzipBytesMax: Math.max(...sizes.map((s) => s.gzip)),
  };
}

function pieceSummary(pieces) {
  const groups = { 'flat:straight': 0, 'flat:diagonal': 0, ramp: 0, corner: 0, bridge: 0 };
  const distinct = { ramp: new Set(), corner: new Set(), bridge: new Set() };
  for (const [key, count] of Object.entries(pieces)) {
    const [kind, style, shape] = key.split(':');
    if (kind === 'flat') groups[`flat:${style}`] += count;
    if (kind === 'ramp') {
      groups.ramp += count;
      distinct.ramp.add(shape);
    }
    if (kind === 'corner') {
      groups.corner += count;
      distinct.corner.add(shape);
    }
    if (kind === 'bridge') {
      groups.bridge += count;
      distinct.bridge.add(style);
    }
  }
  return {
    uses: groups,
    distinctRamps: distinct.ramp.size,
    distinctCorners: distinct.corner.size,
    distinctBridgeAxes: distinct.bridge.size,
  };
}

function main() {
  const mode = process.argv[2] || 'quick';
  const main64 = mode === 'full' ? 30 : 3;
  const compare = mode === 'full' ? 15 : 2;
  const sized = mode === 'full' ? 6 : 1;
  fs.mkdirSync(OUT, { recursive: true });
  const results = { node: process.version, base: BASE, runs: [] };

  const record = (name, clusters, N, maxLevel, override, draw) => {
    const { stats, sample } = experiment(name, clusters, N, maxLevel, { ...BASE, ...override });
    stats.storage = storage(sample);
    stats.pieceSummary = pieceSummary(stats.pieces);
    results.runs.push(stats);
    const { shapes, pieces, ...brief } = stats;
    console.log(JSON.stringify(brief));
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    if (draw) drawCluster(path.join(OUT, `cluster-${name}.png`), sample, 2);
  };

  record('L3-pad', main64, 64, 2, {}, true);
  record('L4-pad', main64, 64, 3, {}, true);
  record('L3-straight-only', compare, 64, 2, { diagonalRamp: false }, false);
  record('L4-straight-only', compare, 64, 3, { diagonalRamp: false }, false);
  record('L3-N96', sized, 96, 2, {}, false);
  record('L3-N128', sized, 128, 2, {}, false);
}

main();
