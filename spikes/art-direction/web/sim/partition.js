import { WEIGHTS } from './partition-weights.js';

// 街区划分。输入一片连通的空地（一组原子），输出把它分成物业的方案。纯函数，结果只取决于输入。
//
// 做法是递归切分：一块地如果正好是某个规格的完整形状并且贴路，就整块成为一个物业，不再切；
// 否则沿 0°、45°、90° 的格线枚举切法，分别解出每一边，再把结果组合起来打分。
// 一刀下去至少有一边是能用的完整规格（这一刀把它"切下来"）；地比最大的规格还大时，中线附近的切法也算。
// 切法按切下来的块从大到小尝试，预算用完时已经试过的都是更好的切法。
// 同一块地只解一次，每块地只保留得分最高的几种方案往上传，所以枚举量是可控的。
//
// 淘汰规则：切出来的块不贴普通道路、或者不是任何规格的形状，都不能成为物业。
// 这些原子记入 residual，排名时 residual 优先比较，只有所有切法都留下空地时才会用到这个兜底。

export const RECT_SPECS = [[3, 3], [2, 3], [3, 2], [2, 2], [1, 3], [3, 1], [1, 2], [2, 1], [1, 1]];
export const TRIANGLE_LEGS = [4, 3, 2, 1];
const DIAGONAL_SPANS = [3, 2, 1];
const QUADRANTS = [[1, 1], [-1, 1], [-1, -1], [1, -1]];

const KEEP = 5;
const MIN_FRONT = 0.7;
const MAX_REGION = 72;
const LARGEST_SPEC_ATOMS = 36;
const BLOCK_BUDGET = 3000;

/** 每个原子的形心和相邻原子，全部预先算好。原子的三条边都落在格线或对角线上。 */
export function atomTable(N) {
  const count = N * N * 4;
  const cx = new Float32Array(count);
  const cy = new Float32Array(count);
  const shape = new Array(count);
  const links = new Array(count);
  for (let id = 0; id < count; id += 1) {
    const q = id & 3;
    const cell = id >> 2;
    const x = cell % N;
    const y = Math.floor(cell / N);
    const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
    const a = corners[q];
    const b = corners[(q + 1) % 4];
    cx[id] = (a[0] + b[0] + x + 0.5) / 3;
    cy[id] = (a[1] + b[1] + y + 0.5) / 3;
    shape[id] = [a, b, [x + 0.5, y + 0.5]];
    const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][q];
    const nx = x + dx;
    const ny = y + dy;
    const inner = [cell * 4 + ((q + 1) % 4), cell * 4 + ((q + 3) % 4)];
    links[id] = nx < 0 || ny < 0 || nx >= N || ny >= N ? inner : [...inner, (ny * N + nx) * 4 + ((q + 2) % 4)];
  }
  return { cx, cy, neighbors: (id) => links[id], vertices: (id) => shape[id] };
}

function bounds(region, table) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const id of region) {
    for (const [x, y] of table.vertices(id)) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const u = x + y;
      const v = x - y;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }
  return { minX, maxX, minY, maxY, minU, maxU, minV, maxV };
}

/** 这块地是不是某个规格的完整形状。规格表以外的形状返回 null。 */
export function specOf(region, table) {
  const { minX, maxX, minY, maxY, minU, maxU, minV, maxV } = bounds(region, table);
  const w = maxX - minX;
  const h = maxY - minY;
  if (region.length === w * h * 4 && RECT_SPECS.some(([a, b]) => a === w && b === h)) {
    return { shape: 'rect', x: minX, y: minY, w, h, regular: Math.sqrt(Math.min(w, h) / Math.max(w, h)) };
  }
  const du = maxU - minU;
  const dv = maxV - minV;
  if (region.length === du * dv * 2 && du * dv >= 2 && DIAGONAL_SPANS.includes(du) && DIAGONAL_SPANS.includes(dv)) {
    return { shape: 'diagonal', u0: minU, u1: maxU, v0: minV, v1: maxV, regular: Math.sqrt(Math.min(du, dv) / Math.max(du, dv)) * 0.95 };
  }
  if (w === h && TRIANGLE_LEGS.includes(w) && region.length === 2 * w * w) {
    for (let q = 0; q < 4; q += 1) {
      const [sx, sy] = QUADRANTS[q];
      const x = sx > 0 ? minX : maxX;
      const y = sy > 0 ? minY : maxY;
      const inside = region.every((id) => (table.cx[id] - x) * sx + (table.cy[id] - y) * sy < w);
      if (inside) return { shape: 'triangle', x, y, q, legs: w, regular: w === 1 ? 0.45 : 0.8 };
    }
  }
  return null;
}

function components(atoms, table) {
  const member = new Set(atoms);
  const seen = new Set();
  const groups = [];
  for (const start of atoms) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    const group = [];
    while (stack.length > 0) {
      const id = stack.pop();
      group.push(id);
      for (const next of table.neighbors(id)) {
        if (member.has(next) && !seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    group.sort((a, b) => a - b);
    groups.push(group);
  }
  return groups.sort((a, b) => a[0] - b[0]);
}

/** 一块地上所有可用的切线，固定顺序：竖线、横线、两个方向的斜线。middle 标出靠近中线的切线。 */
function cutLines(region, table) {
  const { minX, maxX, minY, maxY, minU, maxU, minV, maxV } = bounds(region, table);
  const lines = [];
  const add = (axis, low, high) => {
    const center = (low + high) / 2;
    for (let k = low + 1; k < high; k += 1) lines.push({ axis, k, middle: Math.abs(k - center) <= 1 });
  };
  add('x', minX, maxX);
  add('y', minY, maxY);
  add('u', minU, maxU);
  add('v', minV, maxV);
  return lines;
}

function sideOf(line, id, table) {
  const x = table.cx[id];
  const y = table.cy[id];
  if (line.axis === 'x') return x < line.k;
  if (line.axis === 'y') return y < line.k;
  if (line.axis === 'u') return x + y < line.k;
  return x - y < line.k;
}

/** 五项打分：块更大（平均面积相对最大规格）、更规整、切得更少、沿街更均匀、斜路边用斜向物业。 */
function scoreOf(candidate, totalAtoms) {
  const { pieces, cuts } = candidate;
  if (pieces.length === 0) return { total: 0, size: 0, regular: 0, cuts: 0, even: 0, diagonal: 0 };
  let covered = 0;
  let regular = 0;
  let minFront = Infinity;
  let maxFront = 0;
  let diagonalFront = 0;
  let diagonalServed = 0;
  for (const piece of pieces) {
    covered += piece.atoms.length;
    regular += (piece.atoms.length / totalAtoms) * piece.spec.regular;
    minFront = Math.min(minFront, piece.front);
    maxFront = Math.max(maxFront, piece.front);
    diagonalFront += piece.diagonalFront;
    if (piece.spec.shape === 'diagonal') diagonalServed += piece.diagonalFront;
  }
  const parts = {
    size: Math.min(1, covered / pieces.length / LARGEST_SPEC_ATOMS),
    regular,
    cuts: 1 / (1 + cuts),
    even: minFront / maxFront,
    diagonal: diagonalFront > 0 ? diagonalServed / diagonalFront : 1,
  };
  let total = 0;
  for (const key of Object.keys(WEIGHTS)) total += parts[key] * WEIGHTS[key];
  return { total, ...parts };
}

function rank(a, b) {
  return a.residual - b.residual || b.score.total - a.score.total || (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0);
}

function signatureOf(pieces, residual) {
  const body = pieces.map((piece) => `${String(piece.atoms[0])}:${String(piece.atoms.length)}:${piece.spec.shape}`).sort().join('|');
  return residual > 0 ? `${body}#${String(residual)}` : body;
}

/** 解一块连通的空地，返回按排名排好的候选方案。 */
function solveBlock(block, table, front, diagonalFront, stats) {
  const memo = new Map();
  const leaves = new Map();
  let spent = 0;

  /** 一块地作为完整物业是否成立。结果缓存起来，切线判断时要反复用。 */
  const leafOf = (region) => {
    const key = region.join(',');
    if (leaves.has(key)) return leaves.get(key);
    const spec = specOf(region, table);
    let total = 0;
    let diagonal = 0;
    for (const id of region) {
      total += front[id];
      diagonal += diagonalFront[id];
    }
    const piece = spec && total >= MIN_FRONT ? { atoms: region, spec, front: total, diagonalFront: diagonal } : null;
    const entry = { key, spec, frontage: total, piece };
    leaves.set(key, entry);
    return entry;
  };

  const finish = (region, list) => {
    const seen = new Set();
    const unique = [];
    for (const candidate of list) {
      if (seen.has(candidate.signature)) continue;
      seen.add(candidate.signature);
      candidate.score = scoreOf(candidate, region.length);
      unique.push(candidate);
    }
    unique.sort(rank);
    return unique.slice(0, KEEP);
  };

  /** 一块地所有合格的切法，切下来的完整块越大越靠前。 */
  const cutsOf = (region) => {
    const seen = new Set();
    const cuts = [];
    cutLines(region, table).forEach((line, order) => {
      const left = [];
      const right = [];
      for (const id of region) (sideOf(line, id, table) ? left : right).push(id);
      if (left.length === 0 || right.length === 0) return;
      const parts = [...components(left, table), ...components(right, table)].sort((a, b) => a[0] - b[0]);
      const key = parts.map((part) => `${String(part[0])}:${String(part.length)}`).join('|');
      if (seen.has(key)) return;
      seen.add(key);
      let peeled = 0;
      for (const part of parts) if (leafOf(part).piece) peeled = Math.max(peeled, part.length);
      if (peeled === 0 && !(line.middle && region.length > LARGEST_SPEC_ATOMS)) return;
      cuts.push({ line, parts, peeled, order });
    });
    return cuts.sort((a, b) => b.peeled - a.peeled || a.order - b.order);
  };

  const solve = (region) => {
    const info = leafOf(region);
    if (memo.has(info.key)) return memo.get(info.key);
    if (info.piece) {
      const candidate = { pieces: [info.piece], residual: 0, residualAtoms: [], cuts: 0, signature: signatureOf([info.piece], 0), lines: [] };
      const list = finish(region, [candidate]);
      memo.set(info.key, list);
      return list;
    }
    const empty = { pieces: [], residual: region.length, residualAtoms: region, cuts: 0, signature: `#${String(region[0])}:${String(region.length)}`, lines: [] };
    const options = [empty];
    if (info.frontage > 0) {
      for (const { line, parts } of cutsOf(region)) {
        if (spent >= BLOCK_BUDGET) break;
        spent += 1;
        stats.enumerated += 1;
        for (const part of parts) {
          const entry = leafOf(part);
          if (entry.piece) continue;
          if (entry.spec || entry.frontage === 0) stats.noFrontage += 1;
          else stats.noSpec += 1;
        }
        let combined = [{ pieces: [], residual: 0, residualAtoms: [], cuts: parts.length - 1, lines: [line] }];
        for (const part of parts) {
          const solved = solve(part);
          const next = [];
          for (const base of combined) {
            for (const option of solved) {
              const pieces = [...base.pieces, ...option.pieces];
              const residual = base.residual + option.residual;
              next.push({
                pieces,
                residual,
                residualAtoms: [...base.residualAtoms, ...option.residualAtoms],
                cuts: base.cuts + option.cuts,
                lines: [...base.lines, ...option.lines],
                signature: signatureOf(pieces, residual),
              });
            }
          }
          combined = finish(region, next);
        }
        options.push(...combined);
      }
    }
    const list = finish(region, options);
    memo.set(info.key, list);
    return list;
  };

  return solve(block);
}

/** 太大的空地先沿中线对半分，分到动态规划算得动的大小。这种切分也算在切割次数里。 */
function halve(region, table) {
  if (region.length <= MAX_REGION) return [region];
  const { minX, maxX, minY, maxY } = bounds(region, table);
  const line = maxX - minX >= maxY - minY ? { axis: 'x', k: Math.floor((minX + maxX) / 2) } : { axis: 'y', k: Math.floor((minY + maxY) / 2) };
  const left = [];
  const right = [];
  for (const id of region) (sideOf(line, id, table) ? left : right).push(id);
  return [...components(left, table), ...components(right, table)].flatMap((part) => halve(part, table));
}

/**
 * 把一组原子分成物业。front[atom] 是这个原子贴普通道路的边长，diagonalFront 是其中贴斜路的部分。
 * 返回物业、兜底的原子和统计；details 记录每块地的前几名候选，画对比图时用。
 */
export function partitionLand(atoms, table, front, diagonalFront) {
  const stats = { enumerated: 0, noFrontage: 0, noSpec: 0, blocks: 0, wholeBlocks: 0, millis: 0 };
  const started = performance.now();
  const pieces = [];
  const residual = [];
  const details = [];
  for (const whole of components(atoms, table)) {
    for (const block of halve(whole, table)) {
      stats.blocks += 1;
      const candidates = solveBlock(block, table, front, diagonalFront, stats);
      const best = candidates[0];
      if (best.cuts === 0 && best.pieces.length === 1) stats.wholeBlocks += 1;
      pieces.push(...best.pieces);
      residual.push(...best.residualAtoms);
      details.push({ atoms: block, candidates });
    }
  }
  stats.millis = performance.now() - started;
  return { pieces, residual, stats, details };
}
