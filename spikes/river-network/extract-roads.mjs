import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const source = execFileSync('git', ['show', 'archive/spike-terrain:spikes/terrain/terrain.js'], { encoding: 'utf8' });
const lines = source.split(/\r?\n/);
const body = lines.slice(454, 650).join('\n');
const head = `'use strict';

const DIR8 = [
  [0, -1], [1, 0], [0, 1], [-1, 0],
  [1, -1], [1, 1], [-1, 1], [-1, -1],
];
const BRIDGE_SPAN = 5;

function isOuter(side, sx, sy) {
  return (side === 'W' && sx === 0) || (side === 'E' && sx === 7) || (side === 'N' && sy === 0) || (side === 'S' && sy === 7);
}

`;
writeFileSync(new URL('./roads.js', import.meta.url), `${head}${body}\n\nmodule.exports = { tileShape, measure, roadSearch, connectionTiles, SHAPE_AXIS };\n`);
