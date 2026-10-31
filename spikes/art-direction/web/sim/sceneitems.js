import { sortByDepth } from './order.js';

// 场景里静态物体的绘制顺序，画面和检查用同一份。建筑、灯杆、桥墩和桥面都在这一串里，路面不在。

const POLE_HALF = 0.03;
const SIGNAL_LENGTH = 0.05;

function screenOf(px, py, level) {
  return { sx: (px - py) * 64, sy: (px + py - 1) * 32 - level * 32 };
}

/** 全部信号灯。dir 是所管进口的方向，灯面朝这个方向，迎着驶来的车。 */
export function signalPoles(clusters) {
  return clusters.flatMap(({ legs, signal }) =>
    legs
      .filter((leg) => leg.pole)
      .map((leg) => {
        const { px, py, level } = leg.pole;
        return {
          key: `pole-${String(leg.dir)}`,
          dir: leg.dir,
          px,
          py,
          level,
          base: 0,
          signal,
          phase: legs.indexOf(leg),
          footprint: [
            [px - POLE_HALF, py - SIGNAL_LENGTH],
            [px + POLE_HALF, py - SIGNAL_LENGTH],
            [px + POLE_HALF, py + SIGNAL_LENGTH],
            [px - POLE_HALF, py + SIGNAL_LENGTH],
          ],
        };
      }),
  );
}

/** 物体在屏幕上的范围，frameOf 按名字查精灵的尺寸和锚点。 */
export function boxOf(object, frameOf) {
  const { sx, sy } = screenOf(object.px, object.py, object.level);
  const frame = frameOf(object.key);
  return {
    left: sx - frame.ax,
    right: sx - frame.ax + frame.w,
    top: sy - frame.ay,
    bottom: sy - frame.ay + frame.h,
  };
}

/** 排好的静态物体。 */
export function sceneItems(city, frameOf) {
  const poles = signalPoles(city.junctions?.clusters ?? []);
  const items = [...city.objects, ...poles].map((object) => ({
    ...object,
    ...boxOf(object, frameOf),
  }));
  return sortByDepth(items);
}
