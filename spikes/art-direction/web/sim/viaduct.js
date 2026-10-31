import {
  connectRamps,
  ELEVATED,
  footprintCells,
  LANE,
  pierObject,
  template,
  templateParts,
  viaductKey,
} from './interchange.js';
import { ease, stationsOf } from './rampline.js';
import { approachHeight } from './ramptemplates.js';

// 默认城市里的高架快速路。快速路分地面和高架两种形态，同等级、同运力，造价不同；形态只影响造价和画法。
// 这一条从高速南下：高速上两条匝道落到快速路的头上，一段引道爬上高架，贴着一条南北街在街区里穿过城区，
// 跨过沿途的街道、一个路口和一条东西向的路，再落回地面，收成四车道接进下一条横街的信号路口。
// 主线占一列格子，桥墩立在路格之外，所以车行道和人行道上都没有桥墩。
// 东侧有一对匝道落到短街上，短街和横街做成信号路口；西侧紧贴南北街，放不下南向匝道，南向只在两头进出。
// 车道不进路网，建筑接不到快速路，只能从匝道进出。

/** 造价系数，每格，相对地面四车道。临时值，等经济数值定了再改。 */
export const EXPRESS_COST = { ground: 2, elevated: 6 };

const RAMP_ROW = 2;
const TERMINAL_ROW = 4;
const LANE_STEP = 0.5;
const DESCENT_START = 4;
const DESCENT_LENGTH = 3;
const FOOT_LANE = 0.25;
const PIER_MIN = 0.55;
const PIER_GAP = 2;
const LOW = 0.2;

/** 路线：x 是主线所在的列，紧贴第三条南北街的东边；row 是有匝道的横街，terminal 是落地接入的横街。 */
export function viaductRoute(columns, rows, ringRow) {
  const x = columns[2] + 1;
  const row = rows[RAMP_ROW];
  const terminal = rows[TERMINAL_ROW];
  return {
    x,
    row,
    top: ringRow,
    start: ringRow + 3,
    terminal,
    stubs: [
      [
        [x + 2, row - 2],
        [x + 2, row + 2],
      ],
      [
        [x, terminal - 1],
        [x, terminal],
      ],
    ],
  };
}

/** 主线这一点的高度：头上是引道，尾上是落地的坡，中间是高架。 */
function heightAt({ top, terminal }, y) {
  const down = ease((y - (terminal - DESCENT_START)) / DESCENT_LENGTH);
  return Math.min(approachHeight(y - top - 0.5), ELEVATED * (1 - down));
}

function square(x, y) {
  return [
    [x, y],
    [x + 1, y],
    [x + 1, y + 1],
    [x, y + 1],
  ];
}

function expressLine(id, route, offset, from, to) {
  const points = [];
  const direction = Math.sign(to - from);
  for (let y = from; (y - to) * direction <= 0; y += direction * LANE_STEP)
    points.push([route.x + 0.5 + offset, y, heightAt(route, y)]);
  return { id, kind: 'express', points, exits: [] };
}

/** 主线的两条 lane。尾上那一格接四车道，车道偏移收到四车道的外侧车道。 */
function mainLanes(route, N) {
  const { x, start, terminal } = route;
  const footCell = (terminal - 1) * N + x;
  const south = expressLine(`vs${String(x)}`, route, -LANE, start, terminal - 1);
  south.points[south.points.length - 1][0] = x + 0.5 - FOOT_LANE;
  south.toCell = footCell;
  const north = expressLine(`vn${String(x)}`, route, LANE, terminal - 1, start);
  north.points.unshift([x + 0.5 + FOOT_LANE, terminal - 0.51, 0]);
  north.fromCell = footCell;
  return { south, north };
}

function viaductCells(route, roads, N) {
  const { x, start, terminal, row } = route;
  const [, z0, , z1] = template('sidediamond').footprint;
  const cells = [];
  let sincePier = PIER_GAP;
  for (let y = start; y < terminal - 1; y += 1) {
    if (y >= row + z0 && y <= row + z1) {
      sincePier = 1;
      continue;
    }
    const h0 = heightAt(route, y);
    const h1 = heightAt(route, y + 1);
    const nextIsRoad = roads.has((y + 1) * N + x);
    const open = !roads.has(y * N + x) && (h0 + h1) / 2 >= PIER_MIN;
    const pier = open && (sincePier >= PIER_GAP || nextIsRoad);
    sincePier = pier ? 1 : sincePier + 1;
    cells.push({ x, y, h0, h1, pier });
  }
  return cells;
}

/** 路网图里的快速路：主线上接匝道的节点不是路格，编号排在全部格子之后。 */
function viaductLinks(route, lanes, N) {
  const { x, row, start, terminal } = route;
  const [topNode, entryNode, exitNode] = [0, 1, 2].map((i) => N * N + i);
  const [, z0, , z1] = template('sidediamond').footprint;
  const footCell = (terminal - 1) * N + x;
  const lengthOf = (lane) => stationsOf(lane.points).pop();
  const byName = (name) => lanes.filter((lane) => lane.id.startsWith(name));
  const [entryRamp, exitRamp] = byName('spur');
  const [offRamp, onRamp] = byName('sidediamond');
  const main = lanes.filter((lane) => lane.kind === 'express').map((lane) => lane.id);
  const entryY = row + z0;
  const exitY = row + z1 + 1;
  const ramp = (from, to, lane) => ({
    from,
    to,
    length: lengthOf(lane),
    kind: 'ramp',
    lanes: [lane.id],
  });
  const express = (from, to, length) => ({ from, to, length, kind: 'express', lanes: main });
  return [
    ramp(entryRamp.fromCell, topNode, entryRamp),
    ramp(topNode, exitRamp.toCell, exitRamp),
    express(topNode, entryNode, entryY - start),
    express(entryNode, exitNode, exitY - entryY),
    express(exitNode, footCell, terminal - 1 - exitY),
    ramp(exitNode, offRamp.toCell, offRamp),
    ramp(onRamp.fromCell, entryNode, onRamp),
  ];
}

/** 高架用到的全部东西：主线的格子和桥墩、匝道、车道、路网图的边和占地。 */
export function viaductWorld(route, roads, N) {
  const { x, top, row, terminal } = route;
  const main = mainLanes(route, N);
  const lanes = [main.south, main.north];
  connectRamps({
    name: 'spur',
    cx: x,
    cy: top,
    N,
    lanes,
    spine: [{ to: main.south }, { from: main.north }],
  });
  connectRamps({ name: 'sidediamond', cx: x, cy: row, N, main, lanes });
  main.north.exits.sort((a, b) => a.at - b.at);
  const cells = viaductCells(route, roads, N);
  const placed = [
    { name: 'spur', cx: x, cy: top },
    { name: 'sidediamond', cx: x, cy: row },
  ];
  const parts = [
    ...placed.map(({ name, cx, cy }) => templateParts(name, cx, cy)),
    templateParts('expressfoot', x, terminal - 1),
  ];
  const low = parts.flatMap((part) => part.low);
  const objects = parts.flatMap((part) => part.high);
  for (const { x: cx, y, h0, h1, pier } of cells) {
    const key = viaductKey(h0, h1);
    if (Math.max(h0, h1) < LOW) low.push({ key, x: cx, y, level: 0 });
    else
      objects.push({
        key,
        px: cx + 0.5,
        py: y + 0.5,
        level: 0,
        base: Math.min(h0, h1),
        footprint: square(cx, y),
      });
    if (pier) objects.push(pierObject({ x: 0, z: 0, h: (h0 + h1) / 2, nx: 1, nz: 0 }, cx, y));
  }
  const reserved = [
    ...placed.flatMap(({ name, cx, cy }) => footprintCells(name, cx, cy, N)),
    ...cells.map((cell) => [cell.x, cell.y]),
  ].map(([cx, cy]) => cy * N + cx);
  return { route, placed, cells, lanes, links: viaductLinks(route, lanes, N), low, objects, reserved };
}
