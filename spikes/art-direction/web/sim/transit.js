import { DIRECTIONS, ROAD_SPEC, spokesOf } from './network.js';

// 公交站。站在人行道上，不占格子：站牌和雨棚画在路面边的人行道上，公交车就停在最靠边的车道上，车门对着站台。
// 站点沿干道和主要街道每隔几格设一对，两个方向各一个，都在路段中间的直路上，离路口远，排队不会堵到路口。

const SPACING = 7;
const SHELTER = [0.3, 0.06];

/** 路中线到人行道中线的距离。 */
function sidewalkOffset(kind) {
  const { deck, walk } = ROAD_SPEC[kind];
  return (deck + walk) / 4;
}

function straightDirs(entry) {
  const spokes = spokesOf(entry.road | entry.highway);
  if (spokes.length !== 2 || (spokes[0] + 4) % 8 !== spokes[1]) return null;
  return spokes[0] % 2 === 0 ? spokes : null;
}

/** 一个方向的站：dir 是车的行驶方向，站在行驶方向的右侧。 */
function stopOf(id, dir, kind, N) {
  const x = (id % N) + 0.5;
  const y = Math.floor(id / N) + 0.5;
  const [ux, uy] = DIRECTIONS[dir];
  const side = sidewalkOffset(kind);
  const px = x - uy * side;
  const py = y + ux * side;
  const [along, across] = SHELTER;
  const corner = (a, c) => [px + ux * a * along - uy * c * across, py + uy * a * along + ux * c * across];
  return {
    key: `bs-${String(dir)}`,
    cell: id,
    from: (dir + 4) % 8,
    px,
    py,
    level: 0,
    base: 0,
    footprint: [corner(-0.5, -0.5), corner(0.5, -0.5), corner(0.5, 0.5), corner(-0.5, 0.5)],
  };
}

export function busStops({ N, roads, junctions, isFlat }) {
  const { clusters = [], stops = new Map() } = junctions;
  const busy = new Set(clusters.flatMap(({ cells }) => [...cells]));
  for (const { cell } of stops.values()) busy.add(cell);
  const list = [];
  const lastOn = new Map();
  for (const id of [...roads.keys()].sort((a, b) => a - b)) {
    const entry = roads.get(id);
    if (entry.highway) continue;
    const dirs = straightDirs(entry);
    const x = id % N;
    const y = Math.floor(id / N);
    if (!dirs || busy.has(id) || !isFlat(x, y)) continue;
    const horizontal = dirs.includes(0);
    const line = horizontal ? `r${String(y)}` : `c${String(x)}`;
    const place = horizontal ? x : y;
    if (place - (lastOn.get(line) ?? -SPACING) < SPACING) continue;
    lastOn.set(line, place);
    const kind = entry.arterial ? 'arterial' : 'road';
    for (const dir of dirs) list.push(stopOf(id, dir, kind, N));
  }
  return list;
}
