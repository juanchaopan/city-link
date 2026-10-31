// 征收。地铁站、公共用地、新修的路落到已有建筑上时走同一个流程：
// 先算出要拆几栋楼、影响多少人、要付多少钱，玩家确认后才生效；居民在一个游戏日内陆续搬走，楼拆掉以后再建。
// 连体物业是一个地块，压到一格就整块处理。费用是临时值，等经济数值定了再改。

export const COMPENSATION = { perPerson: 12, perCell: 40 };
export const MOVE_OUT_DAYS = 1;

/** 压到这些格子的物业，一块地算一栋。 */
export function affectedParcels(cells, parcels) {
  const wanted = new Set(cells);
  return parcels.filter(
    ({ cells: own = [], capacity }) => capacity > 0 && own.some((cell) => wanted.has(cell)),
  );
}

/** 确认之前给玩家看的账：拆几栋、影响多少人、付多少钱。 */
export function quote(cells, parcels) {
  const buildings = affectedParcels(cells, parcels);
  const people = buildings.reduce((sum, { capacity }) => sum + capacity, 0);
  const land = buildings.reduce((sum, { cells: own = [] }) => sum + own.length, 0);
  return {
    buildings: buildings.length,
    people,
    cells: land,
    cost: people * COMPENSATION.perPerson + land * COMPENSATION.perCell,
    parcels: buildings.map(({ id }) => id),
  };
}

/** 确认以后的进度：day 是确认后过了几个游戏日，返回还住着多少人、楼拆了没有、能不能开工。 */
export function progressAt(account, day) {
  const moved = Math.min(1, day / MOVE_OUT_DAYS);
  return {
    remaining: Math.round(account.people * (1 - moved)),
    demolished: moved >= 1,
    canBuild: moved >= 1,
  };
}
