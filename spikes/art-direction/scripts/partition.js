// 街区划分的对比图：同一块地修复前后的切法，以及候选切法和得分。输出 out/r6-partition-before-after.png，
// 全图的俯视划分图 out/r6-partition-map.png，数字写进 out/partition-report.json。
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { generateCity } from '../web/sim/city.js';
import { atomPolygon } from '../web/sim/parcels.js';
import { generateParcels as legacyParcels } from '../web/sim/parcels.legacy.js';

const N = 64;
const city = generateCity(N, 11);
const input = { N, roads: city.roads, water: city.water, slopes: city.slopes, zones: city.zones, density: city.density, seed: 11 };
const before = legacyParcels(input);
const { partition, parcels, atomOwner } = city.parcels;

const COLORS = { rect: '#7fb2d9', bigTriangle: '#e0a35c', diagonal: '#9ad07f', triangle: '#d97f8f', green: '#b9d8a0', service: '#c9a0dc', public: '#cfe3c0', field: '#eadf9a', farmhouse: '#c98f6a' };

const polygonsOf = (owner, list) => {
  const groups = new Map();
  owner.forEach((id, atom) => {
    if (id < 0) return;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(atomPolygon(atom, N));
  });
  return [...groups.entries()].map(([id, atoms]) => ({ id, shape: list[id].shape, use: list[id].use ?? '', atoms }));
};

const newParts = polygonsOf(atomOwner, parcels);
const oldParts = polygonsOf(before.atomOwner, before.parcels);
const roadCells = [...city.roads.keys()].map((id) => [id % N, Math.floor(id / N), city.roads.get(id).road ? 0 : 1]);

// 对比用的地：一块被斜路切过的街区，修复前它就是被切成三角和平行四边形的那种地。
const detail = partition.details
  .filter((entry) => entry.candidates.length >= 3 && entry.candidates[0].pieces.length >= 3 && entry.candidates[0].pieces.some((piece) => piece.spec.shape === 'diagonal'))
  .sort((a, b) => b.atoms.length - a.atoms.length || a.atoms[0] - b.atoms[0])[0];
const member = new Set(detail.atoms);
const cells = detail.atoms.map((atom) => atom >> 2);
const box = [Math.min(...cells.map((c) => c % N)) - 2, Math.min(...cells.map((c) => Math.floor(c / N))) - 2, Math.max(...cells.map((c) => c % N)) + 3, Math.max(...cells.map((c) => Math.floor(c / N))) + 3];
const candidates = detail.candidates.map((candidate, rank) => ({
  rank: rank + 1,
  cuts: candidate.cuts,
  residual: candidate.residual,
  score: candidate.score,
  pieces: candidate.pieces.map((piece) => ({ shape: piece.spec.shape, area: piece.atoms.length / 4, front: Math.round(piece.front * 10) / 10, atoms: piece.atoms.map((atom) => atomPolygon(atom, N)) })),
  leftover: candidate.residualAtoms.map((atom) => atomPolygon(atom, N)),
}));

const parcelsOfBlock = (owner, list) => {
  const ids = new Set(detail.atoms.map((atom) => owner[atom]).filter((id) => id >= 0));
  return [...ids].sort((a, b) => a - b).map((id) => {
    const atoms = [];
    owner.forEach((value, atom) => {
      if (value === id) atoms.push(atomPolygon(atom, N));
    });
    return { shape: list[id].shape, use: list[id].use ?? '', area: list[id].area, access: list[id].access, atoms };
  });
};

const reportDetail = {
  blockAtoms: detail.atoms.length,
  box,
  before: parcelsOfBlock(before.atomOwner, before.parcels).map(({ shape, use, area }) => ({ shape, use, area })),
  after: parcelsOfBlock(atomOwner, parcels).map(({ shape, use, area }) => ({ shape, use, area })),
  candidates: candidates.map(({ rank, cuts, residual, score, pieces }) => ({ rank, cuts, residual, score, pieces: pieces.map(({ shape, area, front }) => ({ shape, area, front })) })),
};

const data = {
  COLORS,
  N,
  box,
  roadCells,
  newParts,
  oldParts,
  oldBlock: parcelsOfBlock(before.atomOwner, before.parcels),
  newBlock: parcelsOfBlock(atomOwner, parcels),
  candidates,
  boundary: [...member].map((atom) => atomPolygon(atom, N)),
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.setContent('<canvas id="a"></canvas><canvas id="b"></canvas>');
const images = await page.evaluate((d) => {
  const drawPiece = (c, atoms, color, scale, ox, oy) => {
    c.fillStyle = color;
    c.strokeStyle = color;
    c.lineWidth = 0.6;
    for (const atom of atoms) {
      c.beginPath();
      atom.forEach(([x, y], i) => (i === 0 ? c.moveTo(ox + x * scale, oy + y * scale) : c.lineTo(ox + x * scale, oy + y * scale)));
      c.closePath();
      c.fill();
      c.stroke();
    }
  };
  const roads = (c, scale, ox, oy, [x0, y0, x1, y1]) => {
    for (const [x, y, highway] of d.roadCells) {
      if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
      c.fillStyle = highway ? '#4b5563' : '#6b7280';
      c.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
  };
  const outline = (c, atoms, scale, ox, oy) => {
    const edges = new Map();
    for (const atom of atoms) {
      for (let i = 0; i < 3; i += 1) {
        const a = atom[i];
        const b = atom[(i + 1) % 3];
        const key = [a, b].map(String).sort().join('|');
        edges.set(key, edges.has(key) ? null : [a, b]);
      }
    }
    c.strokeStyle = '#1f2937';
    c.lineWidth = 2;
    c.beginPath();
    for (const edge of edges.values()) {
      if (!edge) continue;
      c.moveTo(ox + edge[0][0] * scale, oy + edge[0][1] * scale);
      c.lineTo(ox + edge[1][0] * scale, oy + edge[1][1] * scale);
    }
    c.stroke();
  };
  const panel = (c, list, title, px, py, scale) => {
    const [x0, y0, x1, y1] = d.box;
    const ox = px - x0 * scale;
    const oy = py + 26 - y0 * scale;
    c.fillStyle = '#eef2f0';
    c.fillRect(px, py + 26, (x1 - x0) * scale, (y1 - y0) * scale);
    roads(c, scale, ox, oy, d.box);
    for (const piece of list) {
      drawPiece(c, piece.atoms, d.COLORS[piece.shape] ?? '#ddd', scale, ox, oy);
      outline(c, piece.atoms, scale, ox, oy);
    }
    c.fillStyle = '#111827';
    c.font = '700 17px "Microsoft YaHei"';
    c.fillText(title, px, py + 18);
  };

  const first = document.getElementById('a');
  const [x0, y0, x1, y1] = d.box;
  const big = Math.floor(420 / Math.max(x1 - x0, y1 - y0));
  const small = Math.floor(232 / Math.max(x1 - x0, y1 - y0));
  first.width = 1280;
  first.height = 120 + (y1 - y0) * big + (y1 - y0) * small + 170;
  const c = first.getContext('2d');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, first.width, first.height);
  panel(c, d.oldBlock, `修复前：${String(d.oldBlock.length)} 块`, 20, 10, big);
  panel(c, d.newBlock, `修复后：${String(d.newBlock.length)} 块`, 40 + (x1 - x0) * big, 10, big);
  const top = 60 + (y1 - y0) * big;
  d.candidates.forEach((candidate, index) => {
    const px = 20 + index * (Math.max(x1 - x0, 1) * small + 12);
    panel(c, candidate.pieces, `候选 ${String(candidate.rank)}：${candidate.score.total.toFixed(3)}`, px, top, small);
    const ox = px - x0 * small;
    const oy = top + 26 - y0 * small;
    drawPiece(c, candidate.leftover, '#f87171', small, ox, oy);
    c.fillStyle = '#374151';
    c.font = '13px "Microsoft YaHei"';
    const y = top + 26 + (y1 - y0) * small + 16;
    c.fillText(`块 ${String(candidate.pieces.length)}　切 ${String(candidate.cuts)}　兜底 ${String(candidate.residual / 4)}`, px, y);
    c.fillText(`大 ${candidate.score.size.toFixed(2)} 整 ${candidate.score.regular.toFixed(2)}`, px, y + 17);
    c.fillText(`刀 ${candidate.score.cuts.toFixed(2)} 匀 ${candidate.score.even.toFixed(2)} 斜 ${candidate.score.diagonal.toFixed(2)}`, px, y + 34);
  });

  const second = document.getElementById('b');
  const scale = 18;
  second.width = d.N * scale * 2 + 60;
  second.height = d.N * scale + 50;
  const m = second.getContext('2d');
  m.fillStyle = '#ffffff';
  m.fillRect(0, 0, second.width, second.height);
  const whole = [0, 0, d.N, d.N];
  const map = (list, title, px) => {
    m.fillStyle = '#eef2f0';
    m.fillRect(px, 30, d.N * scale, d.N * scale);
    roads(m, scale, px, 30, whole);
    for (const piece of list) {
      drawPiece(m, piece.atoms, d.COLORS[piece.shape] ?? '#ddd', scale, px, 30);
      outline(m, piece.atoms, scale, px, 30);
    }
    m.fillStyle = '#111827';
    m.font = '700 20px "Microsoft YaHei"';
    m.fillText(title, px, 22);
  };
  map(d.oldParts, '修复前', 20);
  map(d.newParts, '修复后', 40 + d.N * scale);
  return [first.toDataURL('image/png'), second.toDataURL('image/png')];
}, data);
await browser.close();

mkdirSync('out', { recursive: true });
const write = (file, url) => writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
write('out/r6-partition-before-after.png', images[0]);
write('out/r6-partition-map.png', images[1]);
const blocksCut = partition.details.filter((entry) => entry.candidates[0].cuts > 0).length;
writeFileSync('out/partition-report.json', JSON.stringify({ stats: partition.stats, blockAtoms: partition.blockAtoms, residualAtoms: partition.residual.length, blocksCut, detail: reportDetail }, null, 2));
console.log(JSON.stringify(partition.stats), '兜底占比', partition.residual.length / partition.blockAtoms);
console.log('修复后', JSON.stringify(reportDetail.after.map((p) => `${p.shape}${String(p.area)}`)));
console.log('修复前', JSON.stringify(reportDetail.before.map((p) => `${p.shape}${String(p.area)}`)));
