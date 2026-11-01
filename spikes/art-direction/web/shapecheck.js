import {
  bodyOf,
  carsCheck,
  checkFacing,
  coreOf,
  crossingsCheck,
  inJunction,
  linkCellsOf,
  polesCheck,
} from './junctioncheck.js';
import { CLASS, readPoints, worldOf } from './roadscene.js';
import { hasAcuteAngle, shapeCases, shapeClass, spacingCases } from './shapecases.js';
import { BUS_LENGTH, createFleet } from './sim/fleet.js';
import { movementsConflict, unitOf } from './sim/junctions.js';
import { LANE_OFFSET } from './sim/lanes.js';
import { computeTraffic } from './sim/traffic.js';
import { pasteCrop, pngData, randomFrom, renderTown } from './townrender.js';

// 路口穷举验收：219 种摆法加四车道的代表组合，每个都按游戏流程生成，逐项查。
// 灯杆、斑马线端点、停车线和车线都换算到真实烘焙的遮罩上读像素，车线相交、相位分组和连线表只看规划数据。
// 车线走的是车真实走的线：线的中心和两侧各半个车宽都要在车道上，所以急转弯切出路面时查得出来。
// 停车线读的是进口车道的中线：路中间可能是环岛腿上的分隔岛。
// 间距试验用同一组检查，再跑车流量排队：全公交和混合车流各一遍。

const CAR_HALF = 0.05;
const MAX_JOINT_TURN = 0.7;
const CURB_TOLERANCE = 0.012;
const END_OUTSIDE = 0.05;
const STOP_GAP_LIMIT = 0.07;
const SHAPE_STEPS = 500;
const SPACING_STEPS = 2400;
const SPACING_CARS = 40;
const SAMPLE_EVERY = 20;
const DT = 0.05;
const CLEARANCE = 0.08;

export const SHAPE_FAILURES = [
  'wrongControl',
  'polesOnDeck',
  'polesOffRoad',
  'poleWrongSide',
  'poleAfterStop',
  'facingOff',
  'missingCrossings',
  'crossingEndsOff',
  'crossingOnCurve',
  'stopLineOff',
  'stopLineGap',
  'missingMovements',
  'laneConflicts',
  'pairSplit',
  'turnJumps',
  'linesOffRoad',
  'carsOffRoad',
  'stoppedInJunction',
];

function townOf(entry) {
  const world = worldOf(entry);
  const traffic = computeTraffic([], world.roads, entry.N);
  return { ...world, objects: [], traffic, lanes: [] };
}

/** 3、4 条路用红绿灯，5 条以上用环岛。 */
function controlCheck(town, entry) {
  if (!entry.legs) return 0;
  const signals = town.junctions.clusters.length;
  const rings = town.rings.length;
  return entry.legs >= 5
    ? Number(rings !== 1 || signals !== 0)
    : Number(rings !== 0 || signals !== 1);
}

/** 灯杆在进路右侧、停车线之前；停车线紧贴斑马线；路缘转弯已经结束。 */
function geometryCheck({ junctions }) {
  const { field, clusters, legs } = junctions;
  const result = { poleWrongSide: 0, poleAfterStop: 0, crossingOnCurve: 0, stopLineGap: 0 };
  for (const { legs: signalLegs } of clusters) {
    for (const { pole, stopLine, x, y, dir } of signalLegs) {
      if (!pole) continue;
      const [ux, uy] = unitOf(dir);
      const along = (pole.px - x) * ux + (pole.py - y) * uy;
      const side = (pole.px - x) * uy - (pole.py - y) * ux;
      if (side <= 0) result.poleWrongSide += 1;
      if (along < stopLine.station) result.poleAfterStop += 1;
    }
  }
  for (const { crossing, stopLine } of legs) {
    if (!crossing) continue;
    const gap = stopLine.station - crossing.far;
    if (gap < 0 || gap > STOP_GAP_LIMIT) result.stopLineGap += 1;
    for (const [px, py] of crossing.ends) {
      if (field.deck(px, py) < END_OUTSIDE - CURB_TOLERANCE) result.crossingOnCurve += 1;
    }
  }
  return result;
}

function jointTurns(points) {
  let jumps = 0;
  for (let k = 2; k < points.length; k += 1) {
    const [ax, ay] = points[k - 2];
    const [bx, by] = points[k - 1];
    const [cx, cy] = points[k];
    if (Math.hypot(cx - bx, cy - by) < 1e-6 || Math.hypot(bx - ax, by - ay) < 1e-6) continue;
    const change = Math.atan2(cy - by, cx - bx) - Math.atan2(by - ay, bx - ax);
    if (Math.abs(Math.atan2(Math.sin(change), Math.cos(change))) > MAX_JOINT_TURN) jumps += 1;
  }
  return jumps;
}

/** 连线表：每条进路都能到别的每条外圈腿；同一相位里不同进路的线不相交；相对的两条路有共同的相位。 */
function movementsCheck({ junctions }) {
  const result = {
    movements: 0,
    phases: 0,
    missingMovements: 0,
    laneConflicts: 0,
    pairSplit: 0,
    turnJumps: 0,
  };
  for (const { legs, movements, phaseCount } of junctions.clusters) {
    result.movements += movements.length;
    result.phases = Math.max(result.phases, phaseCount);
    for (const leg of legs) {
      const reached = new Set(movements.filter((m) => m.leg === leg).map((m) => m.exit));
      result.missingMovements += legs.length - 1 - reached.size;
      const partner = legs.find(
        (other) => other.node === leg.node && other.dir === (leg.dir + 4) % 8,
      );
      if (partner && !leg.phases.some((phase) => partner.phases.includes(phase)))
        result.pairSplit += 1;
    }
    for (let i = 0; i < movements.length; i += 1) {
      for (let j = i + 1; j < movements.length; j += 1) {
        const [a, b] = [movements[i], movements[j]];
        if (a.phase === b.phase && movementsConflict(a, b)) result.laneConflicts += 1;
      }
    }
    for (const { points } of movements) result.turnJumps += jointTurns(points);
  }
  return result;
}

/** 每条线的中心和两侧半个车宽都要在车道上。 */
function linesCheck({ junctions, surface }) {
  const points = [];
  for (const { movements } of junctions.clusters) {
    for (const { points: line } of movements) {
      for (let k = 1; k < line.length - 1; k += 1) {
        const [ax, ay] = line[k - 1];
        const [bx, by] = line[k + 1];
        const length = Math.hypot(bx - ax, by - ay) || 1;
        const [nx, ny] = [-(by - ay) / length, (bx - ax) / length];
        for (const side of [-1, 0, 1]) {
          const px = line[k][0] + nx * side * CAR_HALF;
          const py = line[k][1] + ny * side * CAR_HALF;
          points.push({ px, py, level: surface(px, py) });
        }
      }
    }
  }
  return {
    points,
    tally(found) {
      const result = { lineSamples: points.length, linesOffRoad: 0, examples: [] };
      found.forEach((value, index) => {
        if (value === CLASS.deck) return;
        result.linesOffRoad += 1;
        const { px, py } = points[index];
        if (result.examples.length < 4) result.examples.push(['车线', px, py, value]);
      });
      return result;
    },
  };
}

/** 每条进路的车道走到停车线时还在车道上。 */
function stopLinesCheck({ junctions }) {
  const legs = junctions.legs.filter(({ stopLine }) => stopLine);
  const points = legs.map(({ stopLine: { px, py, level }, dir, kind }) => {
    const [ux, uy] = unitOf(dir);
    const offset = LANE_OFFSET[kind];
    return { px: px + uy * offset, py: py - ux * offset, level };
  });
  return {
    points,
    tally: (found) => ({
      stopLineOff: found.filter((value) => value !== CLASS.deck).length,
    }),
  };
}

function inspect(entry, town, carOptions) {
  const fleet = createFleet(town, { cap: 1, random: randomFrom(3) });
  const readers = [
    polesCheck(fleet),
    crossingsCheck(town),
    stopLinesCheck(town),
    linesCheck(town),
    carsCheck(town, carOptions),
  ];
  const found = readPoints(
    town,
    readers.flatMap((reader) => reader.points),
  );
  let offset = 0;
  const parts = readers.map((reader) => {
    const slice = found.slice(offset, offset + reader.points.length);
    offset += reader.points.length;
    return reader.tally(slice);
  });
  parts.push(checkFacing(town, fleet), geometryCheck(town), movementsCheck(town));
  const row = Object.assign({}, ...parts);
  row.wrongControl = controlCheck(town, entry);
  row.examples = parts.flatMap((part) => part.examples ?? []).slice(0, 6);
  row.errors = SHAPE_FAILURES.reduce((sum, key) => sum + row[key], 0);
  return row;
}

const compact = (row) =>
  Object.fromEntries(
    Object.entries(row).filter(([key]) => !['draw', 'heights', 'focus'].includes(key)),
  );

/** 一批穷举场景。scripts/shapes.js 分批调，页面不会一次跑几分钟。 */
window.runShapeBatch = (start, count) =>
  shapeCases()
    .slice(start, start + count)
    .map((entry) => {
      const row = inspect(entry, townOf(entry), { cap: 24, steps: SHAPE_STEPS });
      return compact({ ...entry, ...row });
    });

window.shapeCount = () => shapeCases().length;

/** 车流量排队：跑一段时间，记下堵在路口里的样本、平均车速和停在连接段的样本。 */
function queueRun(town, busShare) {
  const fleet = createFleet(town, {
    cap: SPACING_CARS,
    full: true,
    random: randomFrom(11),
    busShare,
  });
  const { N, junctions } = town;
  const core = coreOf(junctions.legs);
  const links = linkCellsOf(junctions);
  const result = { samples: 0, blocked: 0, stopped: 0, speed: 0, inLink: 0 };
  for (let i = 0; i < SPACING_STEPS; i += 1) {
    fleet.step(DT);
    if (i % SAMPLE_EVERY !== SAMPLE_EVERY - 1) continue;
    for (const car of fleet.cars) {
      if (car.x === undefined) continue;
      result.samples += 1;
      result.speed += car.speed;
      if (car.idle < 1) continue;
      result.stopped += 1;
      const body = bodyOf(fleet, car);
      if (body.some(([x, y]) => inJunction(x, y, junctions.legs, core))) result.blocked += 1;
      if (body.some(([x, y]) => links.has(Math.floor(y) * N + Math.floor(x)))) result.inLink += 1;
    }
  }
  result.speed = Math.round((result.speed / Math.max(1, result.samples)) * 100) / 100;
  return result;
}

/** 两个分开的路口之间能排几辆公交：前一个路口的斑马线外到后一个路口的停车线。合并成大路口时没有这段。 */
function queueRoom({ junctions }) {
  const { clusters } = junctions;
  if (clusters.length < 2) return { room: 0, buses: 0, merged: true };
  const legs = clusters.flatMap(({ legs: own }) => own);
  let room = Infinity;
  for (const a of legs) {
    for (const b of legs) {
      if (a.dir !== 0 || b.dir !== 4 || a.y !== b.y || b.x <= a.x || !a.crossing || !b.crossing)
        continue;
      room = Math.min(room, b.x - a.x - a.crossing.far - b.stopLine.station);
    }
  }
  if (room === Infinity) return { room: 0, buses: 0, merged: false };
  return {
    room: Math.round(room * 100) / 100,
    buses: Math.max(0, Math.floor((room + CLEARANCE) / (BUS_LENGTH + CLEARANCE))),
    merged: false,
  };
}

/** 环岛出口到路口停车线之间能排几辆公交。 */
function ringRoom({ rings, junctions }) {
  const [ring] = rings;
  const leg = junctions.clusters
    .flatMap(({ legs }) => legs)
    .find(({ dir, y, crossing }) => dir === 4 && y === ring?.cy && crossing);
  const arm = ring?.arms.find(({ dir }) => dir === 0);
  if (!leg || !arm) return null;
  const room = leg.x - ring.cx - arm.leg.crossing.far - leg.stopLine.station;
  return {
    room: Math.round(room * 100) / 100,
    buses: Math.max(0, Math.floor((room + CLEARANCE) / (BUS_LENGTH + CLEARANCE))),
    merged: false,
  };
}

window.runSpacing = (gaps) =>
  spacingCases(gaps).map((entry) => {
    const town = townOf(entry);
    const buses = inspect(entry, town, { cap: SPACING_CARS, busShare: 1, steps: 900 });
    const mixed = inspect(entry, town, { cap: SPACING_CARS, steps: 900 });
    const { clusters } = town.junctions;
    return {
      ...compact(entry),
      clusters: clusters.length,
      rings: town.rings.length,
      phases: Math.max(0, ...clusters.map(({ phaseCount }) => phaseCount)),
      cycle: Math.round(Math.max(0, ...clusters.map((c) => c.signal.cycle)) * 10) / 10,
      room: ringRoom(town) ?? queueRoom(town),
      errors: { buses: buses.errors, mixed: mixed.errors },
      examples: [...buses.examples, ...mixed.examples].slice(0, 6),
      stoppedInJunction: { buses: buses.stoppedInJunction, mixed: mixed.stoppedInJunction },
      runBuses: queueRun(town, 1),
      runMixed: queueRun(town),
    };
  });

function panel(context, town, focus, box, scale, label, options) {
  const { canvas, place } = renderTown(town, options);
  const center = place.at(focus[0] + 0.5, focus[1] + 0.5, 0);
  pasteCrop(context, canvas, center, box, scale, label);
}

function sheetOf(columns, lines, width, height) {
  const sheet = new OffscreenCanvas(columns * (width + 8) + 8, lines * (height + 8) + 8);
  const context = sheet.getContext('2d');
  context.fillStyle = '#20303a';
  context.fillRect(0, 0, sheet.width, sheet.height);
  const boxAt = (index) => ({
    x: 8 + (index % columns) * (width + 8),
    y: 8 + Math.floor(index / columns) * (height + 8),
    w: width,
    h: height,
  });
  return { sheet, context, boxAt };
}

/** 每类形状一张，再把含 45° 夹角的几类放大。 */
window.renderShapeSheet = (rows) => {
  const plain = shapeCases().filter(({ variant }) => variant === 'road');
  const seen = new Map();
  for (const entry of plain) {
    const key = shapeClass(entry.mask);
    if (!seen.has(key)) seen.set(key, entry);
  }
  const classes = [...seen.values()];
  const acute = classes.filter(({ mask, legs }) => legs <= 4 && hasAcuteAngle(mask));
  const total = classes.length + acute.length;
  const { sheet, context, boxAt } = sheetOf(6, Math.ceil(total / 6), 420, 320);
  [...classes, ...acute].forEach((entry, index) => {
    const zoom = index >= classes.length;
    const row = rows.find(({ name }) => name === entry.name);
    const label = `${entry.name}${zoom ? ' 放大' : ''} 错 ${String(row?.errors ?? '?')}`;
    panel(context, townOf(entry), entry.focus, boxAt(index), zoom ? 2 : 0.75, label, { cars: 16 });
  });
  return pngData(sheet);
};

/** 每种形状每种间距一张，全公交，再把隔 1 格的放大。 */
window.renderSpacingSheet = (rows) => {
  const cases = spacingCases();
  const close = cases.filter(({ gap }) => gap === 1);
  const { sheet, context, boxAt } = sheetOf(4, 4, 520, 380);
  [...cases, ...close].forEach((entry, index) => {
    const zoom = index >= cases.length;
    const row = rows.find(({ name }) => name === entry.name);
    const label = `${entry.name}${zoom ? ' 放大' : ''} 错 ${String(row?.errors.buses ?? '?')}`;
    panel(context, townOf(entry), entry.focus, boxAt(index), zoom ? 1.6 : 0.8, label, {
      cars: SPACING_CARS,
      busShare: 1,
      warm: 700,
    });
  });
  return pngData(sheet);
};

window.shapeReady = true;
