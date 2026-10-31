// 遮挡顺序。多格建筑和斜向建筑不能简单按中心点排序：一栋长楼的中心可能比它身后的小楼更靠前。
// 物体都是竖直立在地面上的凸棱柱，互不重叠，沿视线方向 (1, 1) 看，"谁在谁后面"的关系没有环，
// 所以两两比较后做一次拓扑排序就是正确的绘制顺序。

const EPS = 1e-6;

function viewCoordinates(polygon) {
  return polygon.map(([x, y]) => [x + y, x - y]);
}

/** 凸多边形在某个 v 上的 u 区间。 */
function spanAt(points, v) {
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const [u0, v0] = points[i];
    const [u1, v1] = points[(i + 1) % points.length];
    if ((v0 <= v && v <= v1) || (v1 <= v && v <= v0)) {
      if (Math.abs(v1 - v0) < EPS) {
        low = Math.min(low, u0, u1);
        high = Math.max(high, u0, u1);
      } else {
        const u = u0 + ((v - v0) / (v1 - v0)) * (u1 - u0);
        low = Math.min(low, u);
        high = Math.max(high, u);
      }
    }
  }
  return [low, high];
}

/** A 必须先画就返回 -1，B 必须先画就返回 1，两者在屏幕上不重叠或无法比较时返回 0。 */
export function compareDepth(a, b) {
  const lowV = Math.max(a.minV, b.minV);
  const highV = Math.min(a.maxV, b.maxV);
  if (lowV >= highV - EPS) return 0;
  const middle = (lowV + highV) / 2;
  const spanA = spanAt(a.view, middle);
  const spanB = spanAt(b.view, middle);
  if (spanA[1] <= spanB[0] + EPS) return -1;
  if (spanB[1] <= spanA[0] + EPS) return 1;
  return (spanA[0] + spanA[1]) / 2 < (spanB[0] + spanB[1]) / 2 ? -1 : 1;
}

export function prepareItems(items) {
  return items.map((item) => {
    const view = viewCoordinates(item.footprint);
    const us = view.map((p) => p[0]);
    const vs = view.map((p) => p[1]);
    return {
      ...item,
      view,
      depth: us.reduce((sum, u) => sum + u, 0) / us.length,
      minV: Math.min(...vs),
      maxV: Math.max(...vs),
    };
  });
}

function overlapBoxes(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** 用屏幕网格只比较可能重叠的物体。 */
function candidatePairs(items) {
  const CELL = 256;
  const bins = new Map();
  items.forEach((item, index) => {
    const x0 = Math.floor(item.left / CELL);
    const x1 = Math.floor(item.right / CELL);
    const y0 = Math.floor(item.top / CELL);
    const y1 = Math.floor(item.bottom / CELL);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const key = `${String(x)},${String(y)}`;
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key).push(index);
      }
    }
  });
  const pairs = new Set();
  const size = items.length;
  for (const list of bins.values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = Math.min(list[i], list[j]);
        const b = Math.max(list[i], list[j]);
        pairs.add(a * size + b);
      }
    }
  }
  return pairs;
}

export function sortByDepth(rawItems) {
  const items = prepareItems(rawItems);
  const size = items.length;
  const after = items.map(() => []);
  const blockers = new Int32Array(size);
  for (const pair of candidatePairs(items)) {
    const a = Math.floor(pair / size);
    const b = pair % size;
    if (!overlapBoxes(items[a], items[b])) continue;
    const order = compareDepth(items[a], items[b]);
    if (order < 0) {
      after[a].push(b);
      blockers[b] += 1;
    } else if (order > 0) {
      after[b].push(a);
      blockers[a] += 1;
    }
  }

  const ready = [];
  const insert = (index) => {
    let low = 0;
    let high = ready.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      const other = ready[middle];
      const later =
        items[other].depth > items[index].depth ||
        (items[other].depth === items[index].depth && other > index);
      if (later) high = middle;
      else low = middle + 1;
    }
    ready.splice(low, 0, index);
  };
  blockers.forEach((count, index) => {
    if (count === 0) insert(index);
  });
  const order = [];
  while (ready.length > 0) {
    const index = ready.shift();
    order.push(index);
    for (const next of after[index]) {
      blockers[next] -= 1;
      if (blockers[next] === 0) insert(next);
    }
  }
  const cycles = size - order.length;
  if (cycles > 0) {
    const placed = new Set(order);
    for (let i = 0; i < size; i += 1) if (!placed.has(i)) order.push(i);
  }
  return { sorted: order.map((index) => items[index]), cycles };
}

/** 逐对核对绘制顺序。独立于排序逻辑，用全部物体两两比较。 */
export function countViolations(sequence) {
  let violations = 0;
  for (let i = 0; i < sequence.length; i += 1) {
    for (let j = i + 1; j < sequence.length; j += 1) {
      if (overlapBoxes(sequence[i], sequence[j]) && compareDepth(sequence[i], sequence[j]) > 0) {
        violations += 1;
      }
    }
  }
  return violations;
}
