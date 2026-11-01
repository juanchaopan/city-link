import { sortByDepth } from './order.js';

// 场景里静态物体的绘制顺序，画面和检查用同一份。建筑、灯杆、桥墩和桥面都在这一串里，路面不在。

const POLE_HALF = 0.02;
const DECK = /^(ixp|ev)-/;
const MAIN_DECK = /^ev-/;
const PIER = /^pr-/;
const LEVEL_PIXELS = 32;

function screenOf(px, py, level) {
  return { sx: (px - py) * 64, sy: (px + py - 1) * 32 - level * 32 };
}

/** 全部信号灯。dir 是所管进口的方向，灯面朝这个方向，迎着驶来的车。占地是杆子本身，悬臂在车的头顶上。phase 是这根灯放行的相位表。 */
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
          base: level,
          signal,
          phase: leg.phases,
          footprint: [
            [px - POLE_HALF, py - POLE_HALF],
            [px + POLE_HALF, py - POLE_HALF],
            [px + POLE_HALF, py + POLE_HALF],
            [px - POLE_HALF, py + POLE_HALF],
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

/** 物体的顶有多高，单位是层。精灵顶到锚点的距离减去地块最靠后一角的距离，算出来只会偏高，偏高时只是少用一条规则。 */
function peakOf(object, frameOf) {
  const center = object.px + object.py;
  const back = Math.min(...object.footprint.map(([x, y]) => x + y));
  const rise = frameOf(object.key).ay - (center - back) * LEVEL_PIXELS;
  return object.level + Math.max(0, rise) / LEVEL_PIXELS;
}

/** 排好的静态物体。deck、main、pier 标出桥面、主线和桥墩，比较规则和别的物体不同；没写底的物体立在它所在的地面上。 */
export function sceneItems(city, frameOf) {
  const poles = signalPoles(city.junctions?.clusters ?? []);
  const items = [...city.objects, ...poles].map((object) => ({
    ...object,
    deck: DECK.test(object.key),
    main: object.main ?? MAIN_DECK.test(object.key),
    pier: PIER.test(object.key),
    base: object.base ?? object.level,
    peak: object.peak ?? peakOf(object, frameOf),
    ...boxOf(object, frameOf),
  }));
  return sortByDepth(items);
}
