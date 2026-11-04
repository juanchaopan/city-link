import { unitOf } from './junctions.js';
import { ROAD_SPEC } from './network.js';
import { RING } from './roundabout.js';

// 停车线以内只有斑马线：车道线和中心线在停车线外缘结束，不进斑马线，也不进路口。
// 路面精灵按估出来的退让距离画线，和斑马线、停车线的真实位置对不上，所以每条腿从路口一侧到停车线外缘
// 铺一段路面色的底，盖掉这一段里的全部标线，斑马线和停车线画在底的上面。
// 信号路口从路口中心铺起，路口里本来就没有标线；环岛从环路外缘铺起，环路和中央绿岛不能盖。
// 底按腿的车行道宽度铺，两边各收进 BLANK_INSET：车行道从路口中心一直到停车线都是这个宽度，
// 收进的一点留给路面和路缘交界的混色像素，底不会盖到路缘上；车行道边上没有标线。
// 底只有几种长度，按长到短拼满这一段，最后一块和停车线外缘对齐，几块之间重叠也没关系：都是路面色。
// 每块底都标 under：画的时候全城的底先画完，再画斑马线和停车线，相邻路口的底盖不到别的腿的标记。

export const STOP_DEPTH = 0.018;
export const BLANK_LENGTHS = [1, 0.5, 0.25];
export const BLANK_INSET = 0.012;
const RING_EDGE = RING + 0.26;
const EPSILON = 1e-6;

/** 把 [from, to] 用几种长度的块拼满，返回每块的长度序号和中心。 */
export function coverSpan(from, to) {
  const pieces = [];
  let start = from;
  while (to - start > EPSILON) {
    const room = to - start;
    const length = BLANK_LENGTHS.find((value) => value <= room + EPSILON) ?? BLANK_LENGTHS.at(-1);
    const begin = Math.min(start, to - length);
    pieces.push({ index: BLANK_LENGTHS.indexOf(length), centre: begin + length / 2 });
    start = begin + length;
  }
  return pieces;
}

/** 一条腿要清空的一段：沿腿的起止距离。 */
export function blankSpan(leg, fromRing) {
  return { from: fromRing ? RING_EDGE : 0, to: leg.stopLine.station + STOP_DEPTH / 2 };
}

/** 全部腿的底块，带上世界坐标、半宽和朝向，精灵和检查都读这一份。 */
export function blankPieces({ clusters, ringLegs }) {
  const legs = [
    ...clusters.flatMap(({ legs: own }) => own).map((leg) => ({ leg, fromRing: false })),
    ...ringLegs.map((leg) => ({ leg, fromRing: true })),
  ];
  return legs.flatMap(({ leg, fromRing }) => {
    if (!leg.crossing) return [];
    const [ux, uy] = unitOf(leg.dir);
    const { from, to } = blankSpan(leg, fromRing);
    return coverSpan(from, to).map(({ index, centre }) => ({
      key: `xb-${leg.kind}-${String(leg.dir % 4)}-${String(index)}`,
      px: leg.x + ux * centre,
      py: leg.y + uy * centre,
      level: leg.stopLine.level,
      length: BLANK_LENGTHS[index],
      half: ROAD_SPEC[leg.kind].deck / 2 - BLANK_INSET,
      dir: leg.dir,
    }));
  });
}

/** 底块的精灵，排在斑马线和停车线前面。 */
export function blankSprites(junctions) {
  return blankPieces(junctions).map(({ key, px, py, level }) => ({
    key,
    x: px - 0.5,
    y: py - 0.5,
    level,
    under: true,
  }));
}
