import { LEVEL } from './bake.js';
import { Builder, hashString, linear, shade } from './builder.js';
import { tree } from './objects.js';
import { LAYER, roadMesh } from './roadshader.js';
import { DIRECTIONS, ROAD_SPEC, spokesOf } from '../sim/network.js';
import { RING } from '../sim/roundabout.js';

// 路面上的标记和环岛。斑马线和停车线单独成一层，画在车道上面，位置由 sim/junctions.js 算好，
// 所以它们可以退到下一格，不受路面精灵的格子限制。

const MARK_Y = 0.006;
const CROSSING = 0.09;
const STRIPE = 0.036;
const STOP_DEPTH = 0.018;
const ISLAND_RADIUS = 0.9;
const ISLAND_Y = 0.05;
const SPLITTER_FROM = 1.52;
const SPLITTER_TO = 1.86;
const SPLITTER_WIDTH = 0.1;
const EDGE_FOOT = 0.03;
const FLOWER_RING = 0.62;

function rotationOf(dir) {
  const [dx, dz] = DIRECTIONS[dir];
  return Math.atan2(-dz, dx);
}

function quad(c, x0, x1, v0, v1, color) {
  c.poly(
    [
      [x0, MARK_Y, v0],
      [x1, MARK_Y, v0],
      [x1, MARK_Y, v1],
      [x0, MARK_Y, v1],
    ],
    color,
  );
}

/** 斑马线：一条条平行于路的白条，铺满整个车行道。dir 只分四个朝向，两头对称。 */
export function buildCrossing(kind, dir, P) {
  const b = new Builder(hashString(`crossing${kind}${String(dir)}`));
  const half = ROAD_SPEC[kind].deck / 2;
  const color = linear(P.road.line);
  const count = Math.floor((half * 2) / (STRIPE * 2));
  const pitch = (half * 2) / count;
  b.at(0, 0, 0, rotationOf(dir), (c) => {
    for (let i = 0; i < count; i += 1) {
      const v = -half + pitch * (i + 0.25);
      quad(c, -CROSSING / 2, CROSSING / 2, v, v + pitch / 2, color);
    }
  });
  return b;
}

/** 停车线：只画在进口方向的右半幅。dir 是腿朝外的方向，车朝路口开，它的右边是局部 -z。 */
export function buildStopLine(kind, dir, P) {
  const b = new Builder(hashString(`stop${kind}${String(dir)}`));
  const half = ROAD_SPEC[kind].deck / 2;
  const color = linear(P.road.line);
  b.at(0, 0, 0, rotationOf(dir), (c) => quad(c, -STOP_DEPTH / 2, STOP_DEPTH / 2, -half + 0.01, -0.01, color));
  return b;
}

function ringPaths(mask, arterial) {
  return spokesOf(mask).map((dir) => {
    const [dx, dz] = DIRECTIONS[dir];
    const length = Math.hypot(dx, dz);
    const reach = 2.5 * length;
    return {
      points: [
        [(dx / length) * RING, (dz / length) * RING],
        [(dx / length) * reach, (dz / length) * reach],
      ],
      kind: arterial & (1 << dir) ? 'arterial' : 'road',
      clipStart: false,
      clipEnd: true,
      cross: -1,
      chained: true,
    };
  });
}

function ringIsland(b, P) {
  const curb = linear(P.road.curb);
  const grass = linear(P.ground.lawn);
  b.cylinder(0, 0, 0, ISLAND_RADIUS + EDGE_FOOT, ISLAND_RADIUS, ISLAND_Y, 24, curb, grass);
  const inner = shade(grass, 1.06);
  b.cylinder(0, ISLAND_Y, 0, FLOWER_RING, FLOWER_RING - 0.06, 0.012, 18, inner);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    tree(b, Math.cos(a) * 0.42, Math.sin(a) * 0.42, P, 0.85, ISLAND_Y);
  }
  b.cylinder(0, ISLAND_Y, 0, 0.1, 0.08, 0.28, 8, linear(P.wall.concrete));
}

function splitter(b, dir, P) {
  const [dx, dz] = DIRECTIONS[dir];
  const curb = linear(P.road.curb);
  const top = linear(P.road.walk);
  b.at(0, 0, 0, Math.atan2(-dz, dx), (c) => {
    const y = 0.022;
    const w = SPLITTER_WIDTH / 2;
    const shape = [
      [SPLITTER_FROM, 0],
      [SPLITTER_TO, -w],
      [SPLITTER_TO, w],
    ];
    c.poly(shape.map(([x, z]) => [x, y, z]), top);
    for (let i = 0; i < 3; i += 1) {
      const [ax, az] = shape[i];
      const [bx, bz] = shape[(i + 1) % 3];
      c.poly(
        [
          [ax, 0, az],
          [bx, 0, bz],
          [bx, y, bz],
          [ax, y, az],
        ],
        curb,
        [(ax + bx) / 2 - 1.7, 0, (az + bz) / 2],
      );
    }
  });
}

/** 环岛：路面是距离场，环路和进口平滑相接；中央绿岛和分隔岛是低多边形。 */
export function buildRoundabout(mask, arterial, P) {
  const build = () => {
    const b = new Builder(hashString(`ring${String(mask)}`));
    ringIsland(b, P);
    for (const dir of spokesOf(mask)) splitter(b, dir, P);
    return b;
  };
  const ring = { radius: RING, walk: 0.36, deck: 0.26 };
  return {
    build,
    extra: () => [roadMesh(ringPaths(mask, arterial), P, null, LAYER.both, 7.4, 120, ring)],
  };
}

export const markHeight = MARK_Y / LEVEL;
