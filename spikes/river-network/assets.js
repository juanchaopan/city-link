'use strict';

const fs = require('fs');
const path = require('path');
const { fill } = require('./run');
const { tileShape, SHAPE_AXIS } = require('./roads');
const { globalMasks, channelMask } = require('./verify');
const OPT = require('./params');

const N = 64;
const G = N * 8;
const OUT = path.join(__dirname, 'out');

// 统计生成结果里实际出现的形状，给素材估算提供依据。这里只数组合，不画图。
function main() {
  const dual = {};
  const blob = {};
  const coastDual = {};
  const axisShapes = {};
  const bankOnSlope = { flat: 0, slope: 0 };
  let riverEnds = 0;
  let junctions = 0;
  let mouths = 0;
  let lakesTiles = 0;
  const clusters = 8;
  for (let seed = 1; seed <= clusters; seed++) {
    const { cluster } = fill(seed, N, 3, OPT);
    const { water, coast } = globalMasks(cluster);
    const channel = channelMask(water, coast, G);
    const land = (x, y) => (x < 0 || y < 0 || x >= G || y >= G ? 0 : water[y * G + x]);
    const inner = (x, y) => (x < 0 || y < 0 || x >= G || y >= G ? 0 : water[y * G + x] && !coast[y * G + x] ? 1 : 0);
    for (let y = 0; y < G - 1; y++) {
      for (let x = 0; x < G - 1; x++) {
        const corners = `${land(x, y)}${land(x + 1, y)}${land(x, y + 1)}${land(x + 1, y + 1)}`;
        const touchesCoast = coast[y * G + x] || coast[y * G + x + 1] || coast[(y + 1) * G + x] || coast[(y + 1) * G + x + 1];
        if (touchesCoast) coastDual[corners] = (coastDual[corners] || 0) + 1;
        else dual[corners] = (dual[corners] || 0) + 1;
      }
    }
    for (let y = 1; y < G - 1; y++) {
      for (let x = 1; x < G - 1; x++) {
        const g = y * G + x;
        if (!water[g] || coast[g]) continue;
        let mask = 0;
        let bit = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (land(x + dx, y + dy)) mask |= 1 << bit;
            bit++;
          }
        }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) count += inner(x + dx, y + dy);
        blob[mask] = (blob[mask] || 0) + 1;
        if (count === 1) riverEnds++;
        if (count >= 3 && !channel[g]) junctions++;
        if (channel[g]) lakesTiles++;
      }
    }
    for (let index = 0; index < 64; index++) {
      const slot = cluster.slots[index];
      const V = N + 1;
      for (const side of Object.keys(cluster.skeleton.slots[index].sides)) {
        if (cluster.skeleton.slots[index].sides[side].kind === 'coast') mouths++;
      }
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const t = y * N + x;
          const shape = tileShape(slot.h, V, x, y);
          if (slot.water[t]) continue;
          const kind = SHAPE_AXIS[shape].kind;
          axisShapes[kind] = (axisShapes[kind] || 0) + 1;
          const nearWater = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
            const nx = x + dx;
            const ny = y + dy;
            return nx >= 0 && ny >= 0 && nx < N && ny < N && slot.water[ny * N + nx];
          });
          if (nearWater) bankOnSlope[kind === 'flat' ? 'flat' : 'slope']++;
        }
      }
    }
  }
  const results = JSON.parse(fs.readFileSync(path.join(OUT, 'results.json'), 'utf8'));
  const pieces = results.stats.roadPieces;
  const slopeUse = {};
  for (const [key, count] of Object.entries(pieces)) {
    const [kind, style, shape, axis] = key.split(':');
    if (kind === 'ramp' || kind === 'corner') {
      const expected = SHAPE_AXIS[shape].axes.includes(Number(axis));
      const label = expected ? 'existingPiece' : 'needsRoadbed';
      slopeUse[label] = slopeUse[label] || { uses: 0, combos: 0 };
      slopeUse[label].uses += count;
      slopeUse[label].combos++;
      slopeUse[`${kind}:${style}`] = (slopeUse[`${kind}:${style}`] || 0) + count;
    }
  }
  const report = {
    clusters,
    riverDualPatterns: Object.keys(dual).length,
    coastDualPatterns: Object.keys(coastDual).length,
    blobPatternsSeen: Object.keys(blob).length,
    riverEnds,
    junctionTiles: junctions,
    mouths,
    channelTiles: lakesTiles,
    landShapes: axisShapes,
    bankOnSlope,
    slopeRoadUse1920Cities: slopeUse,
  };
  fs.writeFileSync(path.join(OUT, 'assets.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 1));
}

main();
