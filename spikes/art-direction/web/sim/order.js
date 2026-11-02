// 遮挡顺序。多格建筑和斜向建筑不能简单按中心点排序：一栋长楼的中心可能比它身后的小楼更靠前。
// 物体都是竖直立在地面上的凸棱柱，沿视线方向 (1, 1) 看，平面上分得开的两个物体，靠近观众的后画。
// 平面上重叠的只有上下两层：高架和它下面的路、车和它脚下的桥面，这时低的先画。
// 相邻的两块桥面在接缝处互相盖住一点，它们不是上下两层，高度差也只是同一段坡上的高差，这种按前后排；
// 否则下坡朝着观众的桥面会要求低的先画，和前后关系相反，排序就成了环。
// 车贴着路边的物体走过时，车身的一角会探进站牌或楼的占地一点点，这不是上下两层：高差不到一层的两样东西
// 都不是桥面时按前后排，车在站牌后面就先画车。
// 主线和旁边的匝道不是上下两层、平面上又叠在一起时，匝道在哪一侧都排在主线后面，路面才盖得住主线的路肩；
// 分岔口两块桥面可能只叠着一角，所以这种比较看三条视线。三条都分得开的两块按前后排，
// 匝道在主线身后的一段不会被硬排到主线前面。
// 桥墩的顶在桥面下面，屏幕上碰得到的同一层桥面都排在桥墩后面。桥墩的占地只算墩身，横梁比占地宽，所以这条规则不看占地。
// 车和桥面比别的物体多两条规则。平面上靠后的物体投影整个在靠前物体的上方时，两者在屏幕上碰不到，这一对不排：
// 桥上的车和它前面的桥墩、桥下的车和它后面的桥面、桥下的公交站和桥面都是这样，硬排只会和别的物体抢位置。
// 车压在两块桥面的接缝上时算在桥面上：桥面的高度取这一块的最低点，坡上的车可能比邻块的最低点略低。
// 车很短，一条视线判断不出它是不是钻到桥下，也判断不出投影碰不碰得到，所以这种比较看三条视线。
// base 是物体的底，peak 是物体的顶，单位都是层；视线坐标 u 一格 32 像素，和一层一样高，所以两者能直接相减。
// left、right、top、bottom 是屏幕范围。
// 这些关系基本没有环，两两比较后做一次拓扑排序就是绘制顺序；同时可以画的物体，先画最靠后的边更靠后的。
// 立交里挤在一起的几块桥面、桥墩和车偶尔成环，这时只放行环上的一个再接着排。
// 不在环上、只是排在环后面的物体不放行：桥上的车排在一块成环的桥面后面，先放行它，车就画在桥面底下了。
// 环上先放行只被别的车挡着的车：车和车的先后错了，最多是两辆车互相压住一角；放行一块桥面或者压在桥面上的车，
// 就是整块路面或整辆车画错层。没有这样的车时放行环上最靠后的。环的个数照常报告。

const EPS = 1e-6;
const CELL = 256;
const STACKED = 0.6;
const ON_DECK = 0.3;

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
const pierUnder = (pier, deck) => pier.pier && deck.deck && baseOf(deck) > pier.peak - ON_DECK;
const sameLevelDecks = (a, b) => a.deck && b.deck && Math.abs(baseOf(a) - baseOf(b)) < STACKED;
const mainAndRamp = (a, b) => sameLevelDecks(a, b) && a.main !== b.main;

/** 平面上靠后的 behind，最低的像素也在 front 最高的像素上方。没有高度数据的物体不算。 */
function clearOf(behind, spanBehind, front, spanFront) {
  const bottom = spanBehind[1] - baseOf(behind);
  return bottom <= spanFront[0] - (front.peak ?? Infinity);
}

/** 平面上重叠的两个物体谁先画：上下两层时低的先画，不是上下两层时按这条视线上的前后。 */
function stackedOrder(a, b, spanA, spanB) {
  if (onDeck(a, b)) return -1;
  if (onDeck(b, a)) return 1;
  if (mainAndRamp(a, b)) return a.main ? -1 : 1;
  const gap = Math.abs(baseOf(a) - baseOf(b));
  const stacked = a.deck || b.deck ? gap > EPS && !sameLevelDecks(a, b) : gap > ON_DECK;
  if (stacked) return baseOf(a) < baseOf(b) ? -1 : 1;
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

/** 主线和匝道在中间那条视线上分得开，两边的视线上叠着一角时也算叠在一起。 */
function cornerOverlap(a, b, middle, quarter) {
  return [middle - quarter, middle + quarter].some((v) =>
    overlapping(spanAt(a.view, v), spanAt(b.view, v)),
  );
}

/** 这一对用得上「投影碰不到」：一边是桥面或车，两辆车、两块桥面都要不在同一层。 */
function mayMissEachOther(a, b) {
  if (a.car && b.car) return Math.abs(baseOf(a) - baseOf(b)) > ON_DECK;
  if (a.deck && b.deck) return !sameLevelDecks(a, b);
  return Boolean(a.car || b.car || a.deck || b.deck);
}

/** A 必须先画就返回 -1，B 必须先画就返回 1，两者在屏幕上不重叠或无法比较时返回 0。调用前已经确认屏幕范围相交。 */
export function compareDepth(a, b) {
  if (pierUnder(a, b)) return -1;
  if (pierUnder(b, a)) return 1;
  const lowV = Math.max(a.minV, b.minV);
  const highV = Math.min(a.maxV, b.maxV);
  if (lowV >= highV - EPS) return 0;
  const middle = (lowV + highV) / 2;
  const quarter = (highV - lowV) / 4;
  const spanA = spanAt(a.view, middle);
  const spanB = spanAt(b.view, middle);
  if (overlapping(spanA, spanB)) return stackedOrder(a, b, spanA, spanB);
  if (mainAndRamp(a, b) && cornerOverlap(a, b, middle, quarter)) return a.main ? -1 : 1;
  const aFirst = spanA[1] <= spanB[0] + EPS;
  if (mayMissEachOther(a, b)) return acrossLevels(a, b, middle, quarter, aFirst);
  return aFirst ? -1 : 1;
}

/** 给物体算好比较要用的视线坐标。footprint 是平面上的凸多边形，depth 是拓扑排序里并列时的先后。 */
export function prepareItem(item) {
  const view = viewCoordinates(item.footprint);
  let depth = Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [u, v] of view) {
    depth = Math.min(depth, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
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

/** 两两比较得到的先后关系：after[i] 是必须画在 i 后面的物体，blockers[i] 是 i 前面还没画的物体数。 */
export function constraintsOf(items) {
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
  return { after, blockers };
}

/** 卡住时环上的一个物体：从没画的物体出发，一直往还没画的前驱走，走回走过的物体就进了环。 */
function cycleMember(items, after, placed) {
  const before = items.map(() => []);
  after.forEach((list, index) => {
    if (placed[index]) return;
    for (const next of list) if (!placed[next]) before[next].push(index);
  });
  let current = placed.indexOf(0);
  const visited = new Map();
  const path = [];
  while (!visited.has(current)) {
    visited.set(current, path.length);
    path.push(current);
    current = before[current][0];
  }
  const ring = path.slice(visited.get(current));
  const blockedByCarsOnly = (index) =>
    items[index].car && before[index].every((other) => items[other].car);
  const weak = ring.filter(blockedByCarsOnly);
  const pool = weak.length > 0 ? weak : ring;
  return pool.reduce((best, index) => (items[index].depth < items[best].depth ? index : best));
}

/**
 * 拓扑排序。同时可以画的先画靠后的。
 * 没有物体可画而还有物体没画时就是环，放行环上的一个，cycles 数放行了几次。
 */
export function topological(items, after, blockers) {
  const size = items.length;
  const ready = [];
  const placed = new Uint8Array(size);
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
  let cycles = 0;
  while (order.length < size) {
    if (ready.length === 0) {
      cycles += 1;
      insert(cycleMember(items, after, placed));
    }
    const index = ready.shift();
    placed[index] = 1;
    order.push(index);
    for (const next of after[index]) {
      blockers[next] -= 1;
      if (blockers[next] === 0 && !placed[next]) insert(next);
    }
  }
  return { order, cycles };
}

export function sortByDepth(rawItems) {
  const items = rawItems.map(prepareItem);
  const { after, blockers } = constraintsOf(items);
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
