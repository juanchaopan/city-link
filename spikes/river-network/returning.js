'use strict';

const fs = require('fs');
const path = require('path');
const { makeRng } = require('./core');
const { createCluster, generate } = require('./terrain');
const { signature } = require('./skeleton');
const { verifySeams, verifyNetwork } = require('./verify');
const { fill, shuffle } = require('./run');
const { drawCluster } = require('./draw');
const { bestSpot, adopt } = require('./placement');
const OPT = require('./params');

const N = 64;
const LEVELS = 3;
const OUT = path.join(__dirname, 'out');
const OPEN_LISTED = 8;
const SEARCH_LIMIT = 50;

// 新玩家优先放在真人旁边，所以开放城市群里的占用是连成片的；随机散布只作对照。
function occupancy(rng, count, pattern) {
  if (pattern === 'random') return shuffle([...Array(64).keys()], rng).slice(0, count);
  const taken = [(rng() * 64) | 0];
  while (taken.length < count) {
    const options = [];
    for (const index of taken) {
      const x = index % 8;
      const y = (index / 8) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const next = ny * 8 + nx;
        if (nx >= 0 && ny >= 0 && nx < 8 && ny < 8 && !taken.includes(next)) options.push(next);
      }
    }
    taken.push(options[(rng() * options.length) | 0]);
  }
  return taken;
}

function openCluster(seed, rng, share, pattern) {
  const cluster = createCluster(seed, N, LEVELS, OPT);
  const taken = occupancy(rng, Math.round(64 * share), pattern);
  for (const index of taken) cluster.slots[index] = true;
  return { cluster, taken };
}

// 只看骨架：全部 1920 座城市，在不同占用率下有多少能回到开放城市群。
function placementStats() {
  const rng = makeRng(0x7755);
  const sources = [];
  for (let seed = 1; seed <= 30; seed++) sources.push(createCluster(seed, N, LEVELS, OPT));
  const out = [];
  for (const pattern of ['contiguous', 'random']) {
    for (const share of [0.1, 0.3, 0.5, 0.7]) {
      const pool = [];
      for (let i = 0; i < 40; i++) pool.push(openCluster(20000 + i * 7, rng, share, pattern).cluster);
      for (const listed of [1, 3, OPEN_LISTED]) {
        let placed = 0;
        let cost = 0;
        for (const source of sources) {
          for (let index = 0; index < 64; index++) {
            const from = { sx: index % 8, sy: (index / 8) | 0, edges: source.edges };
            const sides = source.skeleton.slots[index].sides;
            for (let k = 0; k < listed; k++) {
              const spot = bestSpot(pool[(index * 3 + k * 11 + source.seed * 5) % pool.length], from, sides);
              if (spot) {
                placed++;
                cost += spot.cost;
                break;
              }
            }
          }
        }
        out.push({
          pattern, share, listed, placedInOpen: placed, of: 1920, rate: Number((placed / 1920).toFixed(3)), meanEdgesChanged: Number((cost / Math.max(1, placed)).toFixed(2)),
        });
        console.log(JSON.stringify(out[out.length - 1]));
      }
    }
  }
  return out;
}

function verifyOne(report, item, rng, nextSeed) {
  const { terrain, sides, from, tag } = item;
  report.sources++;
  report.signatures[tag] = (report.signatures[tag] || 0) + 1;
  let cluster = null;
  let taken = [];
  let spot = null;
  let openShare = null;
  for (let k = 0; k < OPEN_LISTED && !spot; k++) {
    const candidate = openCluster(nextSeed(), rng, 0.3, 'contiguous');
    spot = bestSpot(candidate.cluster, from, sides);
    if (spot) {
      ({ cluster, taken } = candidate);
      openShare = k + 1;
    }
  }
  if (spot) {
    report.placedInOpen++;
    report.openTries[openShare] = (report.openTries[openShare] || 0) + 1;
    // 占位换成真实地形：这些位置都不在回归城市周围，骨架改动影响不到它们。
    const saved = [...taken];
    for (const index of saved) cluster.slots[index] = null;
    for (const index of saved) {
      const result = generate(cluster, index % 8, (index / 8) | 0, OPT);
      if (!result.ok) report.generateFailures++;
    }
  } else {
    let tries = 0;
    while (tries < SEARCH_LIMIT && !spot) {
      tries++;
      cluster = createCluster(nextSeed(), N, LEVELS, OPT);
      spot = bestSpot(cluster, from, sides);
    }
    report.searchMax = Math.max(report.searchMax, tries);
    if (!spot) {
      report.unplaced++;
      report.unplacedTags[tag] = (report.unplacedTags[tag] || 0) + 1;
      return null;
    }
    report.placedInNew++;
  }
  report.placed++;
  report.edgesChanged += spot.cost;
  adopt(cluster, spot, terrain);
  for (const slot of shuffle([...Array(64).keys()], rng)) {
    if (cluster.slots[slot]) continue;
    const result = generate(cluster, slot % 8, (slot / 8) | 0, OPT);
    for (const [reason, count] of Object.entries(result.failures)) {
      report.failureReasons[reason] = (report.failureReasons[reason] || 0) + count;
    }
    if (!result.ok) report.generateFailures++;
  }
  const seams = verifySeams(cluster);
  for (const key of Object.keys(seams)) report.seams[key] = (report.seams[key] || 0) + seams[key];
  const network = verifyNetwork(cluster);
  report.minCoverage = Math.min(report.minCoverage, network.coverage);
  for (const key of ['mainSlots', 'mainReached', 'mouths', 'mouthsBroken']) report[key] += network[key];
  report.clustersVerified++;
  return cluster;
}

function newReport() {
  return {
    sources: 0, placed: 0, placedInOpen: 0, placedInNew: 0, openTries: {}, searchMax: 0, edgesChanged: 0, signatures: {},
    unplaced: 0, unplacedTags: {}, generateFailures: 0, failureReasons: {}, seams: {}, minCoverage: 1,
    mainSlots: 0, mainReached: 0, mouths: 0, mouthsBroken: 0, clustersVerified: 0,
  };
}

function cityItem(source, index) {
  return {
    terrain: source.slots[index],
    sides: source.skeleton.slots[index].sides,
    from: { sx: index % 8, sy: (index / 8) | 0, edges: source.edges },
    tag: signature(source.skeleton.slots[index]),
  };
}

function verifySamples() {
  const rng = makeRng(0x2468);
  let seed = 50000;
  const nextSeed = () => seed++;
  const sources = [];
  for (let s = 1; s <= 8; s++) sources.push(fill(s, N, LEVELS, OPT).cluster);

  const sample = newReport();
  for (const source of sources.slice(0, 4)) {
    for (const index of shuffle([...Array(64).keys()], makeRng(source.seed * 97)).slice(0, 15)) {
      const cluster = verifyOne(sample, cityItem(source, index), rng, nextSeed);
      if (cluster && sample.placed === 1) drawCluster(path.join(OUT, 'returning.png'), cluster, 2);
    }
  }
  console.log(JSON.stringify(sample));

  // 再把出现过的每种签名和外边界组合都放一遍，覆盖少见的情况，t-t- 也在其中。
  const seen = new Map();
  for (const source of sources) {
    for (let index = 0; index < 64; index++) {
      const item = cityItem(source, index);
      const outer = `${item.from.sx === 0 ? 'W' : item.from.sx === 7 ? 'E' : ''}${item.from.sy === 0 ? 'N' : item.from.sy === 7 ? 'S' : ''}`;
      const key = `${item.tag}|${outer}`;
      if (!seen.has(key)) seen.set(key, item);
    }
  }
  const every = newReport();
  every.combinations = seen.size;
  for (const item of seen.values()) verifyOne(every, item, rng, nextSeed);
  console.log(JSON.stringify(every));
  return { sample, every };
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const mode = process.argv[2] || 'verify';
  const file = path.join(OUT, 'returning.json');
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const result = mode === 'stats' ? { ...previous, placementStats: placementStats() } : { ...previous, ...verifySamples() };
  delete result.sources;
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
}

main();
