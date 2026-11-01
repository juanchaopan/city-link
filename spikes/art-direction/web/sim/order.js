// 遮挡顺序。多格建筑和斜向建筑不能简单按中心点排序：一栋长楼的中心可能比它身后的小楼更靠前。
// 物体都是竖直立在地面上的凸棱柱，沿视线方向 (1, 1) 看，平面上分得开的两个物体，靠近观众的后画。
// 平面上重叠的只有上下两层：高架和它下面的路、车和它脚下的桥面，这时低的先画。
// 相邻的两块桥面在接缝处互相盖住一点，它们不是上下两层，高度差也只是同一段坡上的高差，这种按前后排；
// 否则下坡朝着观众的桥面会要求低的先画，和前后关系相反，排序就成了环。
// 主线和旁边的匝道不是上下两层时，匝道在哪一侧都排在主线后面，路面才盖得住主线的路肩。
// 车和桥面比别的物体多两条规则。平面上靠后的物体投影整个在靠前物体的上方时，两者在屏幕上碰不到，这一对不排：
// 桥上的车和它前面的桥墩、桥下的车和它后面的桥面、桥下的公交站和桥面都是这样，硬排只会和别的物体抢位置。
// 车压在两块桥面的接缝上时算在桥面上：桥面的高度取这一块的最低点，坡上的车可能比邻块的最低点略低。
// 车很短，一条视线判断不出它是不是钻到桥下，也判断不出投影碰不碰得到，所以这种比较看三条视线。
// 车插进静态序列时只有下限：排在它身后的物体之后。要让这个位置也在它前面的物体之前，静态序列就得这样排：
// 同时可以画的物体，先画最靠后的边更靠后的，一栋长楼只要后边在车后面就排在车前面的小物体之前；
// 车能从下面穿过的桥面能多晚就多晚，只有必须盖在桥面上的物体才排到它后面，桥下的车才有位置。
// base 是物体的底，peak 是物体的顶，单位都是层；视线坐标 u 一格 32 像素，和一层一样高，所以两者能直接相减。
// left、right、top、bottom 是屏幕范围。
// 这些关系没有环，所以两两比较后做一次拓扑排序就是正确的绘制顺序。

const EPS = 1e-6;
const CELL = 256;
const STACKED = 0.6;
const ON_DECK = 0.3;
const OVERHEAD = 1;
const DECK_DELAY = 1000;

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

const baseOf = (item) => item.base ?? 0;
const onDeck = (deck, other) => deck.deck && other.car && baseOf(other) > baseOf(deck) - ON_DECK;
const sameLevelDecks = (a, b) =>
  a.deck && b.deck && Math.abs(baseOf(a) - baseOf(b)) < STACKED;

/** 平面上靠后的 behind，最低的像素也在 front 最高的像素上方。没有高度数据的物体不算。 */
function clearOf(behind, spanBehind, front, spanFront) {
  const bottom = spanBehind[1] - baseOf(behind);
  return bottom <= spanFront[0] - (front.peak ?? Infinity);
}

/** 平面上重叠的两个物体谁先画。 */
function stackedOrder(a, b, spanA, spanB) {
  if (onDeck(a, b)) return -1;
  if (onDeck(b, a)) return 1;
  const gap = Math.abs(baseOf(a) - baseOf(b));
  if (gap > EPS && !sameLevelDecks(a, b)) return baseOf(a) < baseOf(b) ? -1 : 1;
  return (spanA[0] + spanA[1]) / 2 < (spanB[0] + spanB[1]) / 2 ? -1 : 1;
}

const overlapping = (spanA, spanB) => spanA[1] > spanB[0] + EPS && spanB[1] > spanA[0] + EPS;

/** 三条视线都分得开、投影都碰不到才不排。 */
function acrossLevels(a, b, middle, quarter, aFirst) {
  let clear = true;
  for (const v of [middle - quarter, middle, middle + quarter]) {
    const spanA = spanAt(a.view, v);
    const spanB = spanAt(b.view, v);
    if (overlapping(spanA, spanB)) return stackedOrder(a, b, spanA, spanB);
    clear &&= aFirst ? clearOf(a, spanA, b, spanB) : clearOf(b, spanB, a, spanA);
  }
  if (clear) return 0;
  return aFirst ? -1 : 1;
}

/** 这一对用得上「投影碰不到」：一边是桥面或车，两辆车、两块桥面都要不在同一层。 */
function mayMissEachOther(a, b) {
  if (a.car && b.car) return Math.abs(baseOf(a) - baseOf(b)) > ON_DECK;
  if (a.deck && b.deck) return !sameLevelDecks(a, b);
  return Boolean(a.car || b.car || a.deck || b.deck);
}

/** A 必须先画就返回 -1，B 必须先画就返回 1，两者在屏幕上不重叠或无法比较时返回 0。 */
export function compareDepth(a, b) {
  const lowV = Math.max(a.minV, b.minV);
  const highV = Math.min(a.maxV, b.maxV);
  if (lowV >= highV - EPS) return 0;
  if (sameLevelDecks(a, b) && a.main !== b.main) return a.main ? -1 : 1;
  const middle = (lowV + highV) / 2;
  const spanA = spanAt(a.view, middle);
  const spanB = spanAt(b.view, middle);
  if (overlapping(spanA, spanB)) return stackedOrder(a, b, spanA, spanB);
  const aFirst = spanA[1] <= spanB[0] + EPS;
  if (mayMissEachOther(a, b)) return acrossLevels(a, b, middle, (highV - lowV) / 4, aFirst);
  return aFirst ? -1 : 1;
}

/** 给物体算好比较要用的视线坐标。footprint 是平面上的凸多边形，depth 是拓扑排序里并列时的先后。 */
export function prepareItem(item) {
  const view = viewCoordinates(item.footprint);
  let back = Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [u, v] of view) {
    back = Math.min(back, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const depth = back + (item.deck && baseOf(item) >= OVERHEAD ? DECK_DELAY : 0);
  return { ...item, view, depth, minV, maxV };
}

export function overlapBoxes(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** 屏幕网格：一个物体落在哪几个格子里。 */
export function eachBin(item, visit) {
  const x0 = Math.floor(item.left / CELL);
  const x1 = Math.floor(item.right / CELL);
  const y0 = Math.floor(item.top / CELL);
  const y1 = Math.floor(item.bottom / CELL);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) visit((x + 2048) * 8192 + y + 2048);
  }
}

/** 用屏幕网格只比较可能重叠的物体。 */
function candidatePairs(items) {
  const bins = new Map();
  items.forEach((item, index) => {
    eachBin(item, (key) => {
      if (!bins.has(key)) bins.set(key, []);
      bins.get(key).push(index);
    });
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

/** 拓扑排序。after[i] 是必须画在 i 后面的物体，blockers[i] 是 i 前面还没画的物体数；同时可以画的先画靠后的。 */
export function topological(items, after, blockers) {
  const size = items.length;
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
  return { order, cycles };
}

export function sortByDepth(rawItems) {
  const items = rawItems.map(prepareItem);
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
  const { order, cycles } = topological(items, after, blockers);
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
