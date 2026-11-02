import { convexHull, convexOverlap } from './geometry.js';
import { compareDepth, eachBin, overlapBoxes, prepareItem, topological } from './order.js';

// 每帧的绘制顺序。静态物体（建筑、灯杆、桥墩、桥面）两两之间的先后只算一次；车是动的，每帧和视野里的静态物体
// 一起重新做一次拓扑排序，车和静态物体、车和车都按同一条比较规则连边，所以每一对的先后都成立，
// 不会出现车被前面的车推到一个盖住路边灯杆的位置。
// 只排视野里的静态物体：视野外的既不画也不参与比较。没有车的时候直接用静态序列里视野内的那一段，
// 一个拓扑序的子序列还是拓扑序。
// 车和车按车身占地两两比，长车不会因为中心点靠前就盖住前面的短车；匝道上的车高度连续变化，比较结果自然跟着变。
//
// 车和桥面按画出来的样子比：立交的桥面块在接缝处比占地多画一截，用画出来的范围 painted；
// 车身画出来比占地低一点（vehicles.js 的 BODY_DROP），朝观众挪了 SPRITE_DROP，车身连同挪过的车身一起算。
// 车压着的桥面都要先画。这件事不交给视线比较：几条视线会漏掉只压住一角的情况，弯道上桥面一块叠一块，
// 漏掉一块，车就被它切掉一角。所以先看两个凸多边形有没有重叠，重叠就是桥面先画，不重叠再按视线比。
// 车只可能压着比自己低不到 ON_DECK 的桥面：接缝前坡上的车比邻块的最低点略低，这是多画的那一截和车身前探的范围
// 在最陡的坡上能差出的高度。贴地开过匝道脚旁边的车比匝道块低得多，它在匝道块身后，按视线排。
// 车身前面、顶不比车底高的桥面不排：这种桥面连护栏在内都在车身下方，屏幕上碰不到车身，排了只会和别的规则成环。
// 并口的匝道块盖着主线的路肩，按规则排在主线后面；主线上的车贴着并口开过时压在匝道块的边上，匝道块要先画，
// 车又在前面那块主线身后，三样东西就成了环，放行谁都画错：放行车，车被匝道的路面切掉一边；放行匝道块，
// 主线的路缘线画在并口上，有车经过时出现，车走了又消失。
// 排序成环时沿前驱找到真正的环，先放行只被别的车挡着的车，没有再放行环上最靠后的；成环的次数每帧报告出来，
// 遮挡检查要求它是 0。

const BODY_HALF_WIDTH = 0.06;
const BODY_HEIGHT = 0.3;
const CAR_TOP = 44;
const CAR_BOTTOM = 18;
const CAR_SIDE = 44;
const LANE_LIFT = 0.02;
const SPRITE_DROP = 0.047;
const ON_DECK = 0.15;
const BELOW_BODY = 0.05;

/** 车身的占地：沿车头方向的矩形。drawn 是画出来的车身，比较桥面时用。 */
export function carItem(car, halfLength, screen) {
  const { x, y, h, dx, dy } = car;
  const nx = -dy * BODY_HALF_WIDTH;
  const ny = dx * BODY_HALF_WIDTH;
  const ax = dx * halfLength;
  const ay = dy * halfLength;
  const { sx, sy } = screen(x, y, h);
  const footprint = [
    [x - ax - nx, y - ay - ny],
    [x + ax - nx, y + ay - ny],
    [x + ax + nx, y + ay + ny],
    [x - ax + nx, y - ay + ny],
  ];
  const box = {
    car,
    base: h + LANE_LIFT,
    peak: h + BODY_HEIGHT,
    left: sx - CAR_SIDE,
    right: sx + CAR_SIDE,
    top: sy - CAR_TOP,
    bottom: sy + CAR_BOTTOM,
  };
  const dropped = footprint.map(([px, py]) => [px + SPRITE_DROP, py + SPRITE_DROP]);
  return {
    ...prepareItem({ ...box, footprint }),
    drawn: prepareItem({ ...box, footprint: convexHull([...footprint, ...dropped]) }),
  };
}

/** 车和一块静态物体谁先画。桥面先看车有没有压着它画出来的范围，再看它是不是车身前面、顶不比车底高的桥面。 */
function carAgainst(statics, drawnDecks, other, item) {
  const deck = drawnDecks[other];
  if (!deck) return compareDepth(statics[other], item);
  const { drawn } = item;
  if (drawn.base >= deck.base - ON_DECK && convexOverlap(deck.footprint, drawn.footprint))
    return -1;
  const order = compareDepth(deck, drawn);
  return order > 0 && deck.peak <= drawn.base + BELOW_BODY ? 0 : order;
}

/** statics 是排好序的静态物体。order 返回这一帧要画的全部物体，车已经插在正确的位置上，以及成环放行的次数。 */
export function createDrawList(statics) {
  const size = statics.length;
  const bins = new Map();
  statics.forEach((item, index) => {
    eachBin(item, (key) => {
      if (!bins.has(key)) bins.set(key, []);
      bins.get(key).push(index);
    });
  });
  const staticAfter = statics.map(() => []);
  const seen = new Int32Array(size);
  let tick = 0;
  statics.forEach((item, index) => {
    tick += 1;
    eachBin(item, (key) => {
      for (const other of bins.get(key)) {
        if (other <= index || seen[other] === tick) continue;
        seen[other] = tick;
        if (!overlapBoxes(item, statics[other])) continue;
        const order = compareDepth(item, statics[other]);
        if (order < 0) staticAfter[index].push(other);
        else if (order > 0) staticAfter[other].push(index);
      }
    });
  });
  const drawnDecks = statics.map((item) => {
    if (!item.deck) return null;
    return item.painted ? prepareItem({ ...item, footprint: item.painted }) : item;
  });

  const everything = new Uint8Array(size).fill(1);

  /** visible[i] 不为 0 的静态物体参与这一帧。 */
  const order = (cars, visible = everything) => {
    if (cars.length === 0) {
      return { sequence: statics.filter((_, index) => visible[index]), cycles: 0 };
    }
    const local = new Int32Array(size).fill(-1);
    const items = [];
    for (let index = 0; index < size; index += 1) {
      if (!visible[index]) continue;
      local[index] = items.length;
      items.push(statics[index]);
    }
    const firstCar = items.length;
    items.push(...cars);
    const after = items.map(() => []);
    const blockers = new Int32Array(items.length);
    const link = (before, next) => {
      after[before].push(next);
      blockers[next] += 1;
    };
    for (let index = 0; index < size; index += 1) {
      if (!visible[index]) continue;
      for (const other of staticAfter[index]) {
        if (visible[other]) link(local[index], local[other]);
      }
    }
    const carBins = new Map();
    cars.forEach((item, offset) => {
      const self = firstCar + offset;
      tick += 1;
      eachBin(item, (key) => {
        for (const other of bins.get(key) ?? []) {
          if (!visible[other] || seen[other] === tick) continue;
          seen[other] = tick;
          if (!overlapBoxes(item, statics[other])) continue;
          const result = carAgainst(statics, drawnDecks, other, item);
          if (result < 0) link(local[other], self);
          else if (result > 0) link(self, local[other]);
        }
        const list = carBins.get(key);
        if (!list) {
          carBins.set(key, [self]);
          return;
        }
        for (const other of list) {
          if (!overlapBoxes(item, items[other])) continue;
          const result = compareDepth(items[other], item);
          if (result < 0 && !after[other].includes(self)) link(other, self);
          else if (result > 0 && !after[self].includes(other)) link(self, other);
        }
        list.push(self);
      });
    });
    const { order: indices, cycles } = topological(items, after, blockers);
    return { sequence: indices.map((index) => items[index]), cycles };
  };

  return { order };
}
