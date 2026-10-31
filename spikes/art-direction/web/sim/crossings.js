import { cellPaths, DIRECTIONS, ROAD_SPEC, spokesOf } from './network.js';

// 现有规则下的斑马线清单，检查用。斑马线画在路面着色器里，只有退让距离小于 0.39 格的腿才有。

const LIMIT = 0.39;
const BAND = 0.09;
const OUTSIDE = 0.03;

function isJunction(entry) {
  return spokesOf(entry.road | entry.highway).length >= 3 && !entry.highway;
}

function unit(dir) {
  const [dx, dy] = DIRECTIONS[dir];
  const length = Math.hypot(dx, dy);
  return [dx / length, dy / length];
}

export function junctionLegs({ N, roads }) {
  const legs = [];
  for (const [id, entry] of roads) {
    if (!isJunction(entry)) continue;
    const x = (id % N) + 0.5;
    const y = Math.floor(id / N) + 0.5;
    for (const dir of spokesOf(entry.road)) legs.push({ junction: id, dir, x, y, core: 0.42 });
  }
  return legs;
}

export function crossingsOf({ N, roads, levelOf }) {
  const crossings = [];
  let interior = 0;
  for (const [id, entry] of roads) {
    if (!isJunction(entry)) continue;
    const cx = (id % N) + 0.5;
    const cy = Math.floor(id / N) + 0.5;
    const spokes = spokesOf(entry.road);
    cellPaths(entry.road, entry.highway, entry.arterial).forEach((path, index) => {
      if (path.cross <= 0 || path.cross >= LIMIT) return;
      const dir = spokes[index];
      const [dx, dy] = unit(dir);
      const half = ROAD_SPEC[path.kind].deck / 2 + OUTSIDE;
      const station = path.cross + BAND / 2;
      const [mx, my] = [cx + dx * station, cy + dy * station];
      const next = (Math.floor(cy) + DIRECTIONS[dir][1]) * N + Math.floor(cx) + DIRECTIONS[dir][0];
      const nextEntry = roads.get(next);
      if (nextEntry && isJunction(nextEntry)) interior += 1;
      crossings.push({
        junction: id,
        dir,
        level: levelOf(id % N, Math.floor(id / N)),
        ends: [
          [mx - dy * half, my + dx * half],
          [mx + dy * half, my - dx * half],
        ],
      });
    });
  }
  return { crossings, interior };
}
