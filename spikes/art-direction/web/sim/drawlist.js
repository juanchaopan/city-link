import { compareDepth, eachBin, overlapBoxes, prepareItem, topological } from './order.js';

// 每帧的绘制顺序。静态物体（建筑、灯杆、桥墩、桥面）的先后只算一次；车是动的，每帧插进这串静态物体里。
// 一辆车和屏幕上压着它的静态物体逐个比：在它后面的都要先画，这决定它最早能排在第几位。
// 车和车按车身占地两两比，长车不会因为中心点靠前就盖住前面的短车；这个先后关系再把排位往后推。
// 所有物体都走同一条比较规则，匝道上的车高度连续变化，比较结果自然跟着变，不用切换图层。

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

export function createDrawList(statics) {
  const bins = new Map();
  statics.forEach((item, index) => {
    eachBin(item, (key) => {
      if (!bins.has(key)) bins.set(key, []);
      bins.get(key).push(index);
    });
  });
  const seen = new Int32Array(statics.length);
  let tick = 0;

  /** 这辆车最早能排在静态序列的第几位。 */
  const slotOf = (item) => {
    tick += 1;
    let low = 0;
    eachBin(item, (key) => {
      const list = bins.get(key);
      if (!list) return;
      for (const index of list) {
        if (seen[index] === tick) continue;
        seen[index] = tick;
        const other = statics[index];
        if (overlapBoxes(item, other) && compareDepth(other, item) < 0) low = Math.max(low, index + 1);
      }
    });
    return low;
  };

  /** 车之间的先后。返回排好的车，每辆车带 slot：它排在第几个静态物体的前面。 */
  const placeCars = (cars) => {
    const size = cars.length;
    const after = cars.map(() => []);
    const blockers = new Int32Array(size);
    const carBins = new Map();
    cars.forEach((item, index) => {
      item.slot = slotOf(item);
      eachBin(item, (key) => {
        const list = carBins.get(key);
        if (!list) {
          carBins.set(key, [index]);
          return;
        }
        for (const other of list) {
          if (!overlapBoxes(item, cars[other])) continue;
          const order = compareDepth(cars[other], item);
          if (order < 0 && !after[other].includes(index)) {
            after[other].push(index);
            blockers[index] += 1;
          } else if (order > 0 && !after[index].includes(other)) {
            after[index].push(other);
            blockers[other] += 1;
          }
        }
        list.push(index);
      });
    });
    const { order } = topological(cars, after, blockers);
    order.forEach((index, rank) => {
      cars[index].rank = rank;
      for (const next of after[index]) cars[next].slot = Math.max(cars[next].slot, cars[index].slot);
    });
    return order.map((index) => cars[index]).sort((a, b) => a.slot - b.slot || a.rank - b.rank);
  };

  return { placeCars };
}

/** 静态序列和排好的车合成一串，给检查用。 */
export function mergedSequence(statics, cars) {
  const sequence = [];
  let next = 0;
  statics.forEach((item, index) => {
    while (next < cars.length && cars[next].slot <= index) {
      sequence.push(cars[next]);
      next += 1;
    }
    sequence.push(item);
  });
  while (next < cars.length) {
    sequence.push(cars[next]);
    next += 1;
  }
  return sequence;
}
