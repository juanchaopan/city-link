import { clearCells } from './interchange.js';
import { ZONE } from './zones.js';

// 立交圈内的用地。占地里路面没有压到、又连得到普通路的格子不算立交，还给城市：
// 每片放一个停车场，其余按低密度商业交给地块生成器，长出来的就是小物业。
// 匝道、高速和快速路都不在普通路里，这两样的出入口只会接到双向两车道或双向四车道上。
// 连不到普通路的格子进不去车，留作绿地。

const SIDES = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const PARKING_SPECS = [
  [2, 2],
  [2, 1],
  [1, 2],
];

/** 这一格贴着的普通路：side 是路在哪一侧，access 是路格。 */
function frontOf(id, roads, N) {
  const x = id % N;
  const y = Math.floor(id / N);
  for (let side = 0; side < SIDES.length; side += 1) {
    const [dx, dy] = SIDES[side];
    const [i, j] = [x + dx, y + dy];
    if (i >= 0 && j >= 0 && i < N && j < N && roads.get(j * N + i)?.road)
      return { side, access: j * N + i };
  }
  return null;
}

/** 从贴普通路的格子往里连成片，碰不到普通路的格子不算。 */
function regionsOf({ name, cx, cy }, roads, N) {
  const land = new Set(
    clearCells(name)
      .map(([x, z]) => [cx + x, cy + z])
      .filter(([x, y]) => x >= 0 && y >= 0 && x < N && y < N && !roads.has(y * N + x))
      .map(([x, y]) => y * N + x),
  );
  const seen = new Set();
  const regions = [];
  for (const start of [...land].filter((id) => frontOf(id, roads, N))) {
    if (seen.has(start)) continue;
    seen.add(start);
    const region = [start];
    for (let head = 0; head < region.length; head += 1) {
      const id = region[head];
      for (const [dx, dy] of SIDES) {
        const next = id + dy * N + dx;
        if (land.has(next) && !seen.has(next)) {
          seen.add(next);
          region.push(next);
        }
      }
    }
    regions.push(region);
  }
  return regions;
}

function rectCells(id, w, h, N) {
  const cells = [];
  for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) cells.push(id + j * N + i);
  return cells;
}

/**
 * 片区里贴普通路、又在片区之内的一块，取离立交中心最近的，停车场挨着匝道，小物业留给外侧。
 * 先试大的规格；片区不比这个规格大时放不下物业，这个规格不用。
 */
function parkingIn(region, { cx, cy }, roads, N) {
  const member = new Set(region);
  for (const [w, h] of PARKING_SPECS) {
    if (region.length <= w * h) continue;
    let best = null;
    let bestDistance = Infinity;
    for (const id of region) {
      const x = id % N;
      const y = Math.floor(id / N);
      const cells = rectCells(id, w, h, N);
      if (!cells.every((cell) => member.has(cell))) continue;
      const front = cells.map((cell) => frontOf(cell, roads, N)).find(Boolean);
      if (!front) continue;
      const distance = Math.hypot(x + w / 2 - cx - 0.5, y + h / 2 - cy - 0.5);
      if (distance < bestDistance) {
        best = { x, y, w, h, cells, ...front };
        bestDistance = distance;
      }
    }
    if (best) return best;
  }
  return null;
}

/** placed 是落到地图上的模板。taken 是全部用地，shops 是留给地块生成器的格子，parking 是停车场。 */
export function interchangeLand(placed, roads, N) {
  const taken = new Set();
  const shops = [];
  const parking = [];
  for (const entry of placed) {
    for (const region of regionsOf(entry, roads, N)) {
      const lot = parkingIn(region, entry, roads, N);
      if (lot) parking.push(lot);
      for (const id of region) {
        taken.add(id);
        if (!lot?.cells.includes(id)) shops.push(id);
      }
    }
  }
  return { taken, shops, parking };
}

/** 留给小物业的格子划成低密度商业。 */
export function zoneShops({ shops }, zones, density) {
  for (const id of shops) {
    zones[id] = ZONE.commercial;
    density[id] = 1;
  }
}

/** 停车场是一个物体，没有容量。名字里的朝向是出入口对着哪一侧。 */
export function parkingObject({ x, y, w, h, side, access }) {
  return {
    key: `P-parking-${String(w)}x${String(h)}-${String(side)}`,
    px: x + w / 2,
    py: y + h / 2,
    level: 0,
    access,
    footprint: [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
  };
}
