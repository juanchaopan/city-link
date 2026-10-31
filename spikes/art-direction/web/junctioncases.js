// 路口验收的场景。每格都是一小块城市：路、灯杆、斑马线和车都按真实流程生成。
// focus 是样张裁剪的中心格。

const c = 8;
const size = 16;
const row = (y) => [
  [1, y],
  [size - 2, y],
];
const column = (x) => [
  [x, 1],
  [x, size - 2],
];
const toward = (dx, dy, reach = 6) => [
  [c, c],
  [c + dx * reach, c + dy * reach],
];
const legs = (list) => (w) => {
  for (const [dx, dy] of list) w('road', toward(dx, dy));
};
const LEGS = {
  five: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1]],
  six: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]],
  seven: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1]],
  eight: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]],
};

export const JUNCTION_CASES = [
  { name: 'T 字', focus: [c, c], draw: (w) => { w('road', row(c)); w('road', toward(0, 1)); } },
  { name: '十字', focus: [c, c], draw: (w) => { w('road', row(c)); w('road', column(c)); } },
  { name: '四车道十字', focus: [c, c], draw: (w) => { w('arterial', row(c)); w('road', column(c)); } },
  { name: '45° 的 T', focus: [c, c], draw: (w) => { w('road', row(c)); w('road', toward(1, 1)); } },
  { name: '直斜交叉', focus: [c, c], draw: (w) => { w('road', row(c)); w('road', [[2, 2], [14, 14]]); } },
  { name: '五向', focus: [c, c], draw: legs(LEGS.five) },
  { name: '六向', focus: [c, c], draw: legs(LEGS.six) },
  { name: '七向', focus: [c, c], draw: legs(LEGS.seven) },
  { name: '八向', focus: [c, c], draw: legs(LEGS.eight) },
  {
    name: '相邻路口',
    focus: [c, c],
    draw: (w) => {
      w('road', row(c));
      w('road', column(c));
      w('road', row(c + 1));
    },
  },
  {
    name: '高地上的路口',
    focus: [c, c],
    heights: (x, y) => Math.max(0, Math.min(2, Math.min(x - 2, 14 - x, y - 2, 14 - y))),
    draw: (w) => { w('road', [[4, c], [12, c]]); w('road', [[c, 4], [c, 12]]); },
  },
  {
    name: '坡上的路',
    focus: [c, c],
    heights: (x) => Math.max(0, Math.min(3, x - 6)),
    draw: (w) => w('road', row(c)),
  },
  {
    name: '斜穿坡的路',
    focus: [c, c],
    heights: (x, y) => Math.max(0, Math.min(3, 12 - y)),
    draw: (w) => w('road', [[3, 13], [13, 3]]),
  },
  {
    name: '锐角小三角地块',
    focus: [c, c],
    lots: true,
    draw: (w) => { w('road', row(c)); w('road', toward(1, 1)); w('road', toward(1, -1)); },
  },
];
