// 街区划分的对比图和检查，纯 node，不开浏览器。
// out/r6-partition-before-after.png：上排是一块被斜路切过的街区的最终划分，下排是候选切法，从左到右按名次排，得分在 out/partition-report.json。
// out/r6-partition-map.png：全图俯视。
// 颜色：蓝是直角地块，橙是大三角，绿是斜向条带，粉是小三角，紫是公共服务，浅绿是绿地和公园，黄是农田，红是兜底。
// 被斜路切过的方正街区，第一名不能含斜向条带，块数不超过 MAX_PIECES，否则退出码是 1。
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateCity } from '../web/sim/city.js';
import { atomPolygon } from '../web/sim/parcels.js';
import { atomTable, specOf } from '../web/sim/partition.js';
import { createCanvas } from './raster.js';

const N = 64;
const MAX_PIECES = 4;
const COMPACT_SIDE = 3;
const LONG_DIAGONAL = 2;
const WHITE = [255, 255, 255];
const LAND = [238, 242, 240];
const ROAD = [107, 114, 128];
const HIGHWAY = [75, 85, 99];
const LINE = [31, 41, 55];
const LEFTOVER = [248, 113, 113];
const COLORS = {
  rect: [127, 178, 217],
  bigTriangle: [224, 163, 92],
  diagonal: [154, 208, 127],
  triangle: [217, 127, 143],
  green: [185, 216, 160],
  service: [201, 160, 220],
  public: [207, 227, 192],
  field: [234, 223, 154],
  farmhouse: [201, 143, 106],
};

const city = generateCity(N, 11);
const { partition, parcels, atomOwner } = city.parcels;
const table = atomTable(N);

const groupsOf = (owner, list) => {
  const groups = new Map();
  owner.forEach((id, atom) => {
    if (id < 0) return;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(atomPolygon(atom, N));
  });
  return [...groups.entries()].map(([id, atoms]) => ({ shape: list[id].shape, atoms }));
};

const boundsOf = (atoms) => {
  const cells = atoms.map((atom) => atom >> 2);
  const xs = cells.map((cell) => cell % N);
  const ys = cells.map((cell) => Math.floor(cell / N));
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

/** 这块地沿 45° 的外边有多长。原子的前两个邻居隔着对角线，邻居不在地里，这条边就是地的斜边。 */
function diagonalEdge(atoms) {
  const member = new Set(atoms);
  let length = 0;
  for (const atom of atoms) {
    for (const other of table.neighbors(atom).slice(0, 2))
      if (!member.has(other)) length += Math.SQRT1_2;
  }
  return length;
}

/**
 * 被斜路切过的方正街区：外接框每边至少 COMPACT_SIDE 格，并且有一条长斜边。
 * 判断只看这块地的形状，不看切分结果，所以检查不会因为挑地而自己通过；能整块成为物业的地不用切，不算。
 */
const needsCutting = ({ atoms }) => {
  if (specOf(atoms, table)) return false;
  const [x0, y0, x1, y1] = boundsOf(atoms);
  return Math.min(x1 - x0 + 1, y1 - y0 + 1) >= COMPACT_SIDE && diagonalEdge(atoms) >= LONG_DIAGONAL;
};
const cutBlocks = partition.details.filter(needsCutting);
const failures = cutBlocks.filter((entry) => {
  const { pieces } = entry.candidates[0];
  return pieces.length > MAX_PIECES || pieces.some((piece) => piece.spec.shape === 'diagonal');
});

const detail = [...cutBlocks].sort(
  (a, b) => diagonalEdge(b.atoms) - diagonalEdge(a.atoms) || a.atoms[0] - b.atoms[0],
)[0];
const [cx0, cy0, cx1, cy1] = boundsOf(detail.atoms);
const box = [cx0 - 2, cy0 - 2, cx1 + 3, cy1 + 3];

const parcelsOfBlock = () => {
  const ids = new Set(detail.atoms.map((atom) => atomOwner[atom]).filter((id) => id >= 0));
  return [...ids]
    .sort((a, b) => a - b)
    .map((id) => {
      const atoms = [];
      atomOwner.forEach((value, atom) => {
        if (value === id) atoms.push(atomPolygon(atom, N));
      });
      return {
        shape: parcels[id].shape,
        use: parcels[id].use ?? '',
        area: parcels[id].area,
        atoms,
      };
    });
};
const block = parcelsOfBlock();

const reportDetail = {
  blockAtoms: detail.atoms.length,
  box,
  pieces: block.map(({ shape, use, area }) => ({ shape, use, area })),
  candidates: detail.candidates.map((candidate, rank) => ({
    rank: rank + 1,
    cuts: candidate.cuts,
    residual: candidate.residual,
    score: candidate.score,
    pieces: candidate.pieces.map((piece) => ({
      shape: piece.spec.shape,
      area: piece.atoms.length / 4,
      front: Math.round(piece.front * 10) / 10,
    })),
  })),
};

const shapeNames = (entry) =>
  entry.candidates[0].pieces
    .map((piece) => piece.spec.shape)
    .sort()
    .join('+');
const check = {
  blocksChecked: cutBlocks.length,
  failures: failures.length,
  maxPieces: MAX_PIECES,
  shapes: cutBlocks.map(shapeNames),
};
const shapeCounts = {};
for (const parcel of parcels) {
  const key = `${parcel.shape} ${String(parcel.spanU)}x${String(parcel.spanV)}`;
  shapeCounts[key] = (shapeCounts[key] ?? 0) + 1;
}
mkdirSync('out', { recursive: true });
writeFileSync(
  'out/partition-report.json',
  JSON.stringify(
    {
      stats: partition.stats,
      blockAtoms: partition.blockAtoms,
      residualAtoms: partition.residual.length,
      check,
      shapeCounts,
      detail: reportDetail,
    },
    null,
    2,
  ),
);

function drawAtoms(canvas, atoms, color, scale, ox, oy) {
  const at = ([x, y]) => [ox + x * scale, oy + y * scale];
  for (const [a, b, c] of atoms) canvas.triangle(at(a), at(b), at(c), color);
}

function outline(canvas, atoms, scale, ox, oy) {
  const edges = new Map();
  for (const atom of atoms) {
    for (let i = 0; i < 3; i += 1) {
      const a = atom[i];
      const b = atom[(i + 1) % 3];
      const key = [String(a), String(b)].sort().join('|');
      edges.set(key, edges.has(key) ? null : [a, b]);
    }
  }
  for (const edge of edges.values()) {
    if (edge)
      canvas.line(
        [ox + edge[0][0] * scale, oy + edge[0][1] * scale],
        [ox + edge[1][0] * scale, oy + edge[1][1] * scale],
        LINE,
      );
  }
}

function drawRoads(canvas, scale, ox, oy, [x0, y0, x1, y1]) {
  for (const [id, entry] of city.roads) {
    const x = id % N;
    const y = Math.floor(id / N);
    if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
    canvas.rect(ox + x * scale, oy + y * scale, scale, scale, entry.road ? ROAD : HIGHWAY);
  }
}

function panel(canvas, pieces, px, py, scale, area) {
  const [x0, y0, x1, y1] = area;
  const ox = px - x0 * scale;
  const oy = py - y0 * scale;
  canvas.rect(px, py, (x1 - x0) * scale, (y1 - y0) * scale, LAND);
  drawRoads(canvas, scale, ox, oy, area);
  for (const piece of pieces) {
    drawAtoms(canvas, piece.atoms, COLORS[piece.shape] ?? [221, 221, 221], scale, ox, oy);
    outline(canvas, piece.atoms, scale, ox, oy);
  }
}

const [bx0, by0, bx1, by1] = box;
const big = Math.floor(420 / Math.max(bx1 - bx0, by1 - by0));
const small = Math.floor(232 / Math.max(bx1 - bx0, by1 - by0));
const sheet = createCanvas(1280, 60 + (by1 - by0) * (big + small), WHITE);
panel(sheet, block, 20, 20, big, box);
detail.candidates.forEach((candidate, index) => {
  const px = 20 + index * ((bx1 - bx0) * small + 12);
  const py = 40 + (by1 - by0) * big;
  const pieces = candidate.pieces.map((piece) => ({
    shape: piece.spec.shape,
    atoms: piece.atoms.map((atom) => atomPolygon(atom, N)),
  }));
  panel(sheet, pieces, px, py, small, box);
  drawAtoms(
    sheet,
    candidate.residualAtoms.map((atom) => atomPolygon(atom, N)),
    LEFTOVER,
    small,
    px - bx0 * small,
    py - by0 * small,
  );
});
writeFileSync('out/r6-partition-before-after.png', sheet.png());

const scale = 18;
const map = createCanvas(N * scale + 40, N * scale + 40, WHITE);
panel(map, groupsOf(atomOwner, parcels), 20, 20, scale, [0, 0, N, N]);
writeFileSync('out/r6-partition-map.png', map.png());

console.log(
  JSON.stringify(partition.stats),
  '兜底占比',
  partition.residual.length / partition.blockAtoms,
);
console.log('被斜路切过的方正街区', cutBlocks.length, '不合格', failures.length);
console.log(check.shapes.join(' | '));
console.log('划分', JSON.stringify(reportDetail.pieces.map((p) => `${p.shape}${String(p.area)}`)));
console.log(
  '候选',
  reportDetail.candidates
    .map(
      (c) =>
        `${String(c.rank)}:${c.score.total.toFixed(3)}/${String(c.pieces.length)}块/${c.pieces.map((p) => p.shape).join(',')}`,
    )
    .join(' '),
);
if (failures.length > 0) process.exitCode = 1;
