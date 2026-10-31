'use strict';

const fs = require('fs');
const path = require('path');
const { makeRng } = require('./core');
const { createCluster, generate } = require('./terrain');
const { signature, STEP, OPPOSITE } = require('./skeleton');
const { verifySeams, verifyNetwork } = require('./verify');
const { fill, shuffle } = require('./run');
const { drawCluster } = require('./draw');
const OPT = require('./params');

const N = 64;
const LEVELS = 3;
const SEARCH_LIMIT = 400;
const OPEN_FILL = 20;
const OUT = path.join(__dirname, 'out');

const isOuter = (side, sx, sy) => (side === 'W' && sx === 0) || (side === 'E' && sx === 7) || (side === 'N' && sy === 0) || (side === 'S' && sy === 7);
const outerSides = (sx, sy) => ['W', 'E', 'N', 'S'].filter((side) => isOuter(side, sx, sy));

// 位置要和旧城市的外边界类型相同，贴着外边界时四条外边都要一样，否则角上的退坡对不上。
function sameBoundary(source, target) {
  const a = outerSides(source.sx, source.sy);
  const b = outerSides(target.sx, target.sy);
  if (a.join() !== b.join()) return false;
  if (a.length === 0) return true;
  return ['W', 'E', 'N', 'S'].every((side) => source.edges[side] === target.edges[side]);
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

function candidates(cluster, source, wanted) {
  const out = [];
  for (let sy = 0; sy < 8; sy++) {
    for (let sx = 0; sx < 8; sx++) {
      if (signature(cluster.skeleton.slots[sy * 8 + sx]) !== wanted) continue;
      if (!clearAround(cluster, sx, sy)) continue;
      if (sameBoundary(source, { sx, sy, edges: cluster.edges })) out.push([sx, sy]);
    }
  }
  return out;
}

// 把骨架上这个位置的四个边界口改成旧城市的偏移，四周没有地形，所以改动不影响任何已生成的城市。
function adopt(cluster, sx, sy, sides, terrain) {
  for (const side of Object.keys(sides)) {
    const { offset } = sides[side];
    cluster.skeleton.slots[sy * 8 + sx].sides[side].offset = offset;
    if (isOuter(side, sx, sy)) continue;
    const nx = sx + STEP[side][0];
    const ny = sy + STEP[side][1];
    cluster.skeleton.slots[ny * 8 + nx].sides[OPPOSITE[side]].offset = offset;
  }
  cluster.slots[sy * 8 + sx] = { ...terrain, sx, sy };
}

function main() {
  const report = {
    sources: 0, placed: 0, signatures: {}, placedInOpen: 0, placedInNew: 0, searchMax: 0, searchMean: 0,
    generateFailures: 0, failureReasons: {}, seams: {}, mainSlots: 0, mainReached: 0, mouths: 0, mouthsBroken: 0,
    clustersVerified: 0, unplaced: 0, unplacedSignatures: {},
  };
  const rng = makeRng(0x2468);
  let searches = 0;
  let drawn = false;
  const sources = [];
  for (let seed = 1; seed <= 4; seed++) sources.push(fill(seed, N, LEVELS, OPT).cluster);
  let nextSeed = 5000;
  for (const source of sources) {
    const picks = shuffle([...Array(64).keys()], rng).slice(0, 15);
    for (const index of picks) {
      const terrain = source.slots[index];
      if (!terrain) continue;
      report.sources++;
      const wanted = signature(source.skeleton.slots[index]);
      report.signatures[wanted] = (report.signatures[wanted] || 0) + 1;
      const from = { sx: index % 8, sy: (index / 8) | 0, edges: source.edges };

      // 先试已占用约三成的开放城市群，再试新建城市群，新建时可以换种子。
      let cluster = fill(nextSeed++, N, LEVELS, OPT, OPEN_FILL).cluster;
      let spots = candidates(cluster, from, wanted);
      let way = 'open';
      if (spots.length === 0) {
        way = 'new';
        let tries = 0;
        for (; tries < SEARCH_LIMIT && spots.length === 0; tries++) {
          cluster = createCluster(nextSeed++, N, LEVELS, OPT);
          spots = candidates(cluster, from, wanted);
        }
        report.searchMax = Math.max(report.searchMax, tries);
        searches += tries;
        if (spots.length === 0) {
          report.unplaced++;
          report.unplacedSignatures[wanted] = (report.unplacedSignatures[wanted] || 0) + 1;
          continue;
        }
      }
      const [sx, sy] = spots[(rng() * spots.length) | 0];
      adopt(cluster, sx, sy, source.skeleton.slots[index].sides, terrain);
      report.placed++;
      if (way === 'open') report.placedInOpen++;
      else report.placedInNew++;

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
      report.mainSlots += network.mainSlots;
      report.mainReached += network.mainReached;
      report.mouths += network.mouths;
      report.mouthsBroken += network.mouthsBroken;
      report.clustersVerified++;
      if (!drawn) {
        fs.mkdirSync(OUT, { recursive: true });
        drawCluster(path.join(OUT, 'returning.png'), cluster, 2);
        drawn = true;
      }
    }
  }
  report.searchMean = Number((searches / Math.max(1, report.placedInNew + report.unplaced)).toFixed(1));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'returning.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 1));
}

main();
