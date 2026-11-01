import { interchangeLand, parkingObject } from './sim/innerland.js';
import { worldOf } from './roadscene.js';
import {
  connectRamps,
  ELEVATED,
  footprintCells,
  LANE,
  pierObject,
  rampLinks,
  template,
  templateGreens,
  templateParts,
  viaductKey,
} from './sim/interchange.js';
import { computeTraffic } from './sim/traffic.js';

// 立交验收的场景：一块平地上只放一个立交，路和车都按真实流程走。圈内没有地块生成器，留给小物业的格子放绿地。
// spots 是样张放大的位置，坐标相对立交中心。

const N = 30;
const CENTER = 15;

function teeTown() {
  const cx = CENTER;
  const cy = 11;
  const world = worldOf({
    N,
    draw: (walk) => {
      walk('highway', [
        [0, cy],
        [N - 1, cy],
      ]);
      walk('arterial', [
        [cx, cy + 4],
        [cx, N - 2],
      ]);
      walk('road', [
        [cx - 8, cy + 5],
        [cx + 8, cy + 5],
      ]);
    },
  });
  const lanes = [];
  connectRamps({ name: 'tee', cx, cy, N, lanes });
  const { low, high } = templateParts('tee', cx, cy);
  return {
    world,
    lanes,
    cx,
    cy,
    low,
    objects: high,
    axis: (x) => [x, cy + 0.5, 0],
    spots: {
      分流: [-4, 0.6],
      合流: [4, 0.6],
      跨路桥墩: [0, 0],
      弯道: [-1.4, -2.6],
    },
  };
}

function expressLanes(x) {
  const line = (offset, from, to) => {
    const points = [];
    const step = from < to ? 1 : -1;
    for (let y = from; step > 0 ? y <= to : y >= to; y += step)
      points.push([x + 0.5 + offset, y + 0.5, ELEVATED]);
    return points;
  };
  return {
    south: { id: `s${String(x)}`, kind: 'express', points: line(-LANE, 0, N - 1), exits: [] },
    north: { id: `n${String(x)}`, kind: 'express', points: line(LANE, N - 1, 0), exits: [] },
  };
}

function diamondTown() {
  const cx = CENTER;
  const cy = CENTER;
  const world = worldOf({
    N,
    draw: (walk) => {
      walk('arterial', [
        [0, cy],
        [N - 1, cy],
      ]);
      for (const stub of template('diamond').stubs)
        walk('arterial', [
          [cx + stub, cy - 2],
          [cx + stub, cy + 2],
        ]);
    },
  });
  const main = expressLanes(cx);
  const lanes = [main.south, main.north];
  connectRamps({ name: 'diamond', cx, cy, N, main, lanes });
  for (const lane of lanes) lane.exits.sort((a, b) => a.at - b.at);
  const covered = new Set(footprintCells('diamond', cx, cy, N).map(([x, y]) => y * N + x));
  const { low, high } = templateParts('diamond', cx, cy);
  const objects = [...high];
  for (let y = 0; y < N; y += 1) {
    if (covered.has(y * N + cx)) continue;
    objects.push({
      key: viaductKey(ELEVATED, ELEVATED),
      px: cx + 0.5,
      py: y + 0.5,
      level: 0,
      base: ELEVATED,
      footprint: [
        [cx, y],
        [cx + 1, y],
        [cx + 1, y + 1],
        [cx, y + 1],
      ],
    });
    if (y % 2 === 0) objects.push(pierObject({ x: 0, z: 0, h: ELEVATED, nx: 1, nz: 0 }, cx, y));
  }
  return {
    world,
    lanes,
    cx,
    cy,
    low,
    objects,
    axis: (y) => [cx + 0.5, y, ELEVATED],
    spots: {
      分流: [-0.6, -4.4],
      合流: [-0.6, 4.4],
      跨路桥墩: [0, 0],
      弯道: [-2, -3],
    },
  };
}

export const IX_SCENES = { tee: teeTown, diamond: diamondTown };

/** 圈内的停车场和绿地。 */
function innerObjects(name, cx, cy, roads) {
  const land = interchangeLand([{ name, cx, cy }], roads, N);
  const taken = new Set(land.parking.flatMap(({ cells }) => cells));
  return [...land.parking.map(parkingObject), ...templateGreens(name, cx, cy, { roads, N, taken })];
}

export function ixTown(name) {
  const scene = IX_SCENES[name]();
  const { world, lanes, objects, low, cx, cy } = scene;
  const links = rampLinks(lanes);
  const traffic = computeTraffic([], world.roads, N, links);
  const town = {
    ...world,
    objects: [...objects, ...innerObjects(name, cx, cy, world.roads)],
    low,
    traffic,
    lanes,
    links,
  };
  return { town, name, cx, cy, spots: scene.spots, axis: scene.axis };
}
