import { DIRECTIONS, spokesOf } from './sim/network.js';

// 路口穷举验收的场景。路只有 8 个方向，3 到 8 条路的路口一共 219 种摆法，每种都生成一块小城。
// 两车道和四车道的混合取代表组合：3、4 条路的路口查全部四车道，再查一对相对的路是四车道（没有相对的路时第一条是四车道）；
// 5 条路以上查全部四车道。
// 形状分类把旋转和镜像算一类，一共 24 类，样张每类一张。
// 间距场景：gap 是两个路口之间隔着几格路，gap 为 0 就是紧贴的两个路口。环岛接路口时 gap 从环岛 5×5 的边算。

const C = 8;
const SIZE = 16;
const LEG_REACH = 6;
const SPACING_SIZE = 24;
const SPACING_ROW = 12;
const SPACING_START = 10;
const RING_HALF = 2;

const bitsOf = (mask) => spokesOf(mask);

function legKinds(mask, variant) {
  const spokes = bitsOf(mask);
  if (variant === 'road') return new Map(spokes.map((dir) => [dir, 'road']));
  if (variant === 'arterial') return new Map(spokes.map((dir) => [dir, 'arterial']));
  const first = spokes.find((dir) => spokes.includes((dir + 4) % 8)) ?? spokes[0];
  const pair = new Set([first, (first + 4) % 8]);
  return new Map(spokes.map((dir) => [dir, pair.has(dir) ? 'arterial' : 'road']));
}

function shapeCase(mask, variant) {
  const kinds = legKinds(mask, variant);
  return {
    name: `${mask.toString(16).padStart(2, '0')}·${variant}`,
    mask,
    variant,
    legs: kinds.size,
    N: SIZE,
    focus: [C, C],
    draw: (walk) => {
      for (const [dir, kind] of kinds) {
        const [dx, dy] = DIRECTIONS[dir];
        walk(kind, [
          [C, C],
          [C + dx * LEG_REACH, C + dy * LEG_REACH],
        ]);
      }
    },
  };
}

/** 全部场景：219 种两车道的摆法在前，四车道的代表组合在后。 */
export function shapeCases() {
  const masks = Array.from({ length: 255 }, (_, i) => i + 1).filter(
    (mask) => bitsOf(mask).length >= 3,
  );
  const plain = masks.map((mask) => shapeCase(mask, 'road'));
  const wide = masks.flatMap((mask) =>
    bitsOf(mask).length <= 4
      ? [shapeCase(mask, 'arterial'), shapeCase(mask, 'pair')]
      : [shapeCase(mask, 'arterial')],
  );
  return [...plain, ...wide];
}

const rotate = (mask, turns) => ((mask << turns) | (mask >> (8 - turns))) & 255;

function mirror(mask) {
  let out = 0;
  for (let dir = 0; dir < 8; dir += 1) if (mask & (1 << dir)) out |= 1 << ((8 - dir) % 8);
  return out;
}

/** 旋转和镜像之后最小的方向位，同一类的摆法这个数相同。 */
export function shapeClass(mask) {
  let best = 255;
  for (let turns = 0; turns < 8; turns += 1) {
    best = Math.min(best, rotate(mask, turns), rotate(mirror(mask), turns));
  }
  return best;
}

/** 有 45° 夹角的摆法最容易出错，样张单独放大。 */
export const hasAcuteAngle = (mask) => (mask & rotate(mask, 1)) !== 0;

const row = (walk) =>
  walk('road', [
    [2, SPACING_ROW],
    [SPACING_SIZE - 3, SPACING_ROW],
  ]);
const column = (walk, x, from = 2, to = SPACING_SIZE - 3) =>
  walk('road', [
    [x, from],
    [x, to],
  ]);

const SPACINGS = {
  十字接十字: (gap) => (walk) => {
    row(walk);
    column(walk, SPACING_START);
    column(walk, SPACING_START + gap + 1);
  },
  十字接丁字: (gap) => (walk) => {
    row(walk);
    column(walk, SPACING_START);
    column(walk, SPACING_START + gap + 1, SPACING_ROW);
  },
  斜路路口: (gap) => (walk) => {
    row(walk);
    walk('road', [
      [SPACING_START - 8, SPACING_ROW - 8],
      [SPACING_START + 8, SPACING_ROW + 8],
    ]);
    column(walk, SPACING_START + gap + 1);
  },
  环岛接路口: (gap) => (walk) => {
    row(walk);
    column(walk, SPACING_START);
    walk('road', [
      [SPACING_START, SPACING_ROW],
      [SPACING_START + 8, SPACING_ROW + 8],
    ]);
    column(walk, SPACING_START + RING_HALF + gap + 1);
  },
};

/** 间距场景：每种形状隔 1、2、3 格。 */
export function spacingCases(gaps = [1, 2, 3]) {
  return Object.entries(SPACINGS).flatMap(([shape, build]) =>
    gaps.map((gap) => ({
      name: `${shape}·隔 ${String(gap)} 格`,
      shape,
      gap,
      N: SPACING_SIZE,
      focus: [SPACING_START + Math.ceil(gap / 2), SPACING_ROW],
      draw: build(gap),
    })),
  );
}
