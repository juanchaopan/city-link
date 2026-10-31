// 模块拼装的组合表。一栋楼由底座、楼身、屋顶三个模块叠成，这里只有名字和位置，没有画法，地块生成和风格包都可以用。
// 楼身一层是半个地形层（16 像素），所以模块之间永远错不开。

/** 八种明显不同的组合。楼型、底座、屋顶、层数都变，配色只是最后一层变化。 */
export const COMBOS = [
  { podium: 'shops', body: 'slab', roof: 'plant', floors: 6, tone: 0 },
  { podium: 'lobby', body: 'tower', roof: 'crown', floors: 11, tone: 1 },
  { podium: 'pilotis', body: 'ell', roof: 'garden', floors: 5, tone: 2 },
  { podium: 'shops', body: 'twin', roof: 'plant', floors: 8, tone: 3 },
  { podium: 'lobby', body: 'stepped', roof: 'crown', floors: 10, tone: 0 },
  { podium: 'pilotis', body: 'drum', roof: 'garden', floors: 9, tone: 1 },
  { podium: 'shops', body: 'stepped', roof: 'garden', floors: 7, tone: 2 },
  { podium: 'lobby', body: 'ell', roof: 'plant', floors: 7, tone: 3 },
];

const QUADRANTS = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
const STEPPED_SHARES = [0.45, 0.35, 0.2];
const ROOF_OFFSET = { ell: [-0.35, -0.35], twin: [-0.33, 0] };

/** 退台楼每一段的层数。三段的层数都取整，所以总层数不一定正好等于给定的层数。 */
export function steppedTiers(floors) {
  return STEPPED_SHARES.map((share) => Math.max(1, Math.round(floors * share)));
}

/** 大三角地块上楼的中心相对物业中心的偏移。楼身压向直角一侧，斜边一侧留作绿化。 */
export function bodyOffset(size, q) {
  if (size === '2x2') return [0, 0];
  const [sx, sz] = QUADRANTS[q];
  return [-sx * 0.42, -sz * 0.42];
}

/** 一栋楼由哪些模块组成。lift 是这个模块相对地面抬高的楼层数，dx、dy 是地面上的偏移。 */
export function modulesOf(combo, size, q) {
  const [dx, dy] = bodyOffset(size, q);
  const { podium, body, roof, floors, tone } = combo;
  const top = body === 'stepped' ? steppedTiers(floors).reduce((a, b) => a + b, 0) : floors;
  const [rx, ry] = ROOF_OFFSET[body] ?? [0, 0];
  return [
    { key: `Mp-${size}-${String(size === '2x2' ? 0 : q)}-${podium}`, lift: 0, dx: 0, dy: 0 },
    { key: `Mb-${body}-${String(floors)}-${String(tone)}`, lift: 1, dx, dy },
    { key: `Mr-${roof}`, lift: 1 + top, dx: dx + rx, dy: dy + ry },
  ];
}
