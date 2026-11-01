import { compareDepth, eachBin, overlapBoxes, prepareItem, topological } from './order.js';

// 每帧的绘制顺序。静态物体（建筑、灯杆、桥墩、桥面）两两之间的先后只算一次；车是动的，每帧和视野里的静态物体
// 一起重新做一次拓扑排序，车和静态物体、车和车都按同一条比较规则连边，所以每一对的先后都成立，
// 不会出现车被前面的车推到一个盖住路边灯杆的位置。
// 只排视野里的静态物体：视野外的既不画也不参与比较。没有车的时候直接用静态序列里视野内的那一段，
// 一个拓扑序的子序列还是拓扑序。
// 车和车按车身占地两两比，长车不会因为中心点靠前就盖住前面的短车；匝道上的车高度连续变化，比较结果自然跟着变。

const BODY_HALF_WIDTH = 0.06;
const BODY_HEIGHT = 0.3;
const CAR_TOP = 44;
const CAR_BOTTOM = 18;
const CAR_SIDE = 44;
const LANE_LIFT = 0.02;

/** 车身的占地：沿车头方向的矩形。 */
export function carItem(car, halfLength, screen) {
  const { x, y, h, dx, dy } = car;
  const nx = -dy * BODY_HALF_WIDTH;
  const ny = dx * BODY_HALF_WIDTH;
  const ax = dx * halfLength;
  const ay = dy * halfLength;
  const { sx, sy } = screen(x, y, h);
  return prepareItem({
    car,
    footprint: [
      [x - ax - nx, y - ay - ny],
      [x + ax - nx, y + ay - ny],
      [x + ax + nx, y + ay + ny],
      [x - ax + nx, y - ay + ny],
    ],
    base: h + LANE_LIFT,
    peak: h + BODY_HEIGHT,
    left: sx - CAR_SIDE,
    right: sx + CAR_SIDE,
    top: sy - CAR_TOP,
    bottom: sy + CAR_BOTTOM,
  });
}

/** statics 是排好序的静态物体。order 返回这一帧要画的全部物体，车已经插在正确的位置上。 */
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

  const everything = new Uint8Array(size).fill(1);

  /** visible[i] 不为 0 的静态物体参与这一帧。 */
  const order = (cars, visible = everything) => {
    if (cars.length === 0) return statics.filter((_, index) => visible[index]);
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
          const result = compareDepth(statics[other], item);
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
    return topological(items, after, blockers).order.map((index) => items[index]);
  };

  return { order };
}
