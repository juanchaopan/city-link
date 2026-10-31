export const ZONE = { none: 0, residential: 1, commercial: 2, industrial: 3, farm: 4, public: 5 };

/** 每个原子的容量。每格 4 个原子，所以一格的容量是这里的 4 倍。公共用地不产生人口和商业容量。 */
export const RATE = {
  [ZONE.residential]: [0, 2, 6, 12],
  [ZONE.commercial]: [0, 1, 3, 6],
  [ZONE.industrial]: [0, 2, 3, 4],
  [ZONE.farm]: [0, 1, 1, 1],
  [ZONE.public]: [0, 0, 0, 0],
};
