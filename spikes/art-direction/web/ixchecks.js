import { LEVEL } from './kit/bake.js';
import { CLASS, compose, MASK, readerOf, spriteOf } from './roadscene.js';
import { createFleet } from './sim/fleet.js';
import { mainlineOf, piersOf, template } from './sim/interchange.js';
import { ROAD_SPEC } from './sim/network.js';
import { MAIN_LANE } from './sim/rampline.js';
import { sceneItems } from './sim/sceneitems.js';
import { randomFrom } from './townrender.js';

// 立交验收的检查项，几何和成品各查一遍。成品的像素读的是真实烘焙拼出来的遮罩，地面路和立交都在。
// 同高相交：两条路在平面上重叠，高度差又不够，只有合流分流的那几段可以这样。
// 桥墩：底部的点读地面路的遮罩，匝道用几何算，比桥墩顶低得多的路面才算在桥墩下面。
// 侧面：相机看得见的一侧，路面边下方读到透明就是缝。走向接近屏幕竖直的边，侧面在屏幕上只有一两个像素宽，
// 取整就会读到外面，这种边跳过。走向按路面边算，渐变段的边和中心线不平行。
// 转角：中心线相邻两段的夹角，车走的线也一样查。
// 开到主线：车走的线每一点都要是车道，读到路缘或路肩就是被挡住了；车道和主线车道之间不能隔着路缘。
// 这两项都是在成品上读的，被头顶的桥盖住的点读到的是桥，不算数，所以先把这些点去掉。
// 车在匝道上：车中心到路面中线从遮罩上量，不用车自己的路径，免得和实现犯同一个错。

const CLEAR_LEVELS = 1;
const MAX_TURN = 8;
const STEP = 0.04;
const SIDE_DROPS = [0.02, 0.035];
const SIDE_MIN = 0.1;
const FACING = 0.35;
const SCAN = 0.32;
const SCAN_STEP = 0.01;
const MAX_CAR_OFFSET = 0.08;
const DT = 0.05;
const BRIDGE_ABOVE = 0.45;
const BRIDGE_REACH = 34;

export const rounded = (value) => Math.round(value * 100) / 100;

function worldOfRamp(ramp, cx, cy) {
  return ramp.center.map(([x, z, h], i) => ({
    x: x + cx + 0.5,
    z: z + cy + 0.5,
    h,
    half: (ramp.band[i].l + ramp.band[i].r) / 2,
    shared: ramp.shared.some(([a, c]) => ramp.stations[i] >= a && ramp.stations[i] <= c),
  }));
}

function denseLine({ points, half }, cx, cy) {
  const [[ax, az, ah = 0], [bx, bz]] = [points[0], points[points.length - 1]];
  const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.1);
  const out = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    out.push({
      x: ax + (bx - ax) * t + cx + 0.5,
      z: az + (bz - az) * t + cy + 0.5,
      h: ah,
      half,
      shared: false,
    });
  }
  return out;
}

/** 不合流的路在同一高度重叠的采样点数。 */
function sameLevel({ name, cx, cy }, ramps) {
  const lines = ramps.map((ramp) => worldOfRamp(ramp, cx, cy));
  const main = mainlineOf(name);
  const mainLine =
    main.length > 0 ? denseLine({ points: main, half: ROAD_SPEC.express.deck / 2 }, cx, cy) : [];
  const ground = template(name).ground.map((line) => denseLine(line, cx, cy));
  const others = (index) => [...lines.filter((_, j) => j > index), mainLine, ...ground];
  const result = { levelCrossings: 0, examples: [] };
  lines.forEach((line, index) => {
    for (const other of others(index)) {
      for (const a of line) {
        if (a.shared) continue;
        const hit = other.find(
          (b) =>
            !b.shared &&
            Math.hypot(a.x - b.x, a.z - b.z) < a.half + b.half - 0.03 &&
            Math.abs(a.h - b.h) < CLEAR_LEVELS,
        );
        if (!hit) continue;
        result.levelCrossings += 1;
        if (result.examples.length < 4)
          result.examples.push(['同高', ramps[index].name, rounded(a.x), rounded(a.z), rounded(a.h)]);
      }
    }
  });
  return result;
}

function checkPiers({ name, cx, cy }, ramps, ground) {
  const result = { piers: 0, piersOnRoad: 0, examples: [] };
  for (const { x, z, h, line } of piersOf(name)) {
    result.piers += 1;
    const [sx, sy] = ground.place.at(x + cx + 0.5, z + cy + 0.5, 0);
    const found = ground.read(Math.round(sx), Math.round(sy));
    let onRoad = found === CLASS.deck || found === CLASS.walk || found === CLASS.curb;
    for (const other of ramps) {
      other.center.forEach(([ox, oz, oh], i) => {
        const { l, r, sr } = other.band[i];
        if (oh < h - 0.3 && Math.hypot(ox - x, oz - z) < (l + r) / 2 + sr) onRoad = true;
      });
    }
    if (onRoad) {
      result.piersOnRoad += 1;
      if (result.examples.length < 4) result.examples.push(['桥墩', line, rounded(x), rounded(z)]);
    }
  }
  return result;
}

function turnsOf(points) {
  let worst = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [ax, az] = points[i - 1];
    const [mx, mz] = points[i];
    const [bx, bz] = points[i + 1];
    const u = Math.atan2(mz - az, mx - ax);
    const v = Math.atan2(bz - mz, bx - mx);
    worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(v - u), Math.cos(v - u))));
  }
  return (worst * 180) / Math.PI;
}

function checkTurns(ramps) {
  const worstOf = ({ center, points }) => Math.max(turnsOf(center), turnsOf(points));
  const over = ramps.filter((ramp) => worstOf(ramp) > MAX_TURN);
  return {
    worstTurn: ramps.length > 0 ? Math.round(Math.max(...ramps.map(worstOf)) * 10) / 10 : 0,
    sharpRamps: over.length,
    examples: over.slice(0, 4).map(({ name }) => ['转角', name]),
  };
}

/** 路面一侧的边线，x、z 相对模板中心。side 为 1 是左边，-1 是右边。 */
function edgeLine({ center, band }, side) {
  return center.map(([x, z], i) => {
    const before = center[Math.max(0, i - 1)];
    const after = center[Math.min(center.length - 1, i + 1)];
    const length = Math.hypot(after[0] - before[0], after[1] - before[1]);
    const nx = (after[1] - before[1]) / length;
    const nz = -(after[0] - before[0]) / length;
    const width = side > 0 ? band[i].l + band[i].sl : band[i].r + band[i].sr;
    return [x + nx * side * width, z + nz * side * width];
  });
}

/** 相机看得见的侧面，路面边下方读不到东西就是缝。 */
function checkSides({ cx, cy }, ramps, scene) {
  const result = { sideSamples: 0, sideGaps: 0, examples: [] };
  for (const ramp of ramps) {
    for (const side of [1, -1]) {
      const edge = edgeLine(ramp, side);
      for (let i = 1; i < edge.length - 1; i += 1) {
        const h = ramp.center[i][2];
        if (h * LEVEL < SIDE_MIN) continue;
        const dx = edge[i + 1][0] - edge[i - 1][0];
        const dz = edge[i + 1][1] - edge[i - 1][1];
        const length = Math.hypot(dx, dz);
        if (length < 1e-6 || ((dz - dx) / length) * side < FACING) continue;
        const [px, pz] = [edge[i][0] + cx + 0.5, edge[i][1] + cy + 0.5];
        const reads = SIDE_DROPS.map((drop) => {
          const [sx, sy] = scene.place.at(px, pz, h - drop / LEVEL);
          return scene.read(Math.round(sx), Math.round(sy));
        });
        result.sideSamples += 1;
        if (reads.some((found) => found !== CLASS.empty)) continue;
        result.sideGaps += 1;
        if (result.examples.length < 4)
          result.examples.push(['侧面', ramp.name, i, side, rounded(h), rounded(px), rounded(pz)]);
      }
    }
  }
  return result;
}

/** 这个屏幕点上方压着一座桥：比这一点高出不少的路面投影到附近。 */
function bridgesOver(lanes, ramps, entry, scene) {
  const { cx, cy } = entry;
  const lanePoints = lanes.flatMap(({ points }) => points);
  const rampPoints = ramps.flatMap(({ center }) =>
    center.map(([x, z, h]) => [x + cx + 0.5, z + cy + 0.5, h]),
  );
  const high = [...lanePoints, ...rampPoints].map(([x, z, h]) => {
    const [sx, sy] = scene.place.at(x, z, h);
    return { sx, sy, h };
  });
  return (sx, sy, h) =>
    high.some(
      (point) =>
        point.h > h + BRIDGE_ABOVE && Math.hypot(point.sx - sx, point.sy - sy) < BRIDGE_REACH,
    );
}

/** 沿车走的线读遮罩，读到路缘或路肩就是挡住了，读到透明就是断了。 */
function checkDrive(lanes, scene, covered) {
  const result = { driveSamples: 0, driveBlocked: 0, driveHoles: 0, examples: [] };
  for (const { points, id } of lanes) {
    for (let i = 0; i < points.length - 1; i += 1) {
      const [ax, ay, ah] = points[i];
      const [bx, by, bh] = points[i + 1];
      const steps = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / STEP));
      for (let s = 0; s < steps; s += 1) {
        const t = s / steps;
        const px = ax + (bx - ax) * t;
        const py = ay + (by - ay) * t;
        const h = ah + (bh - ah) * t;
        const [sx, sy] = scene.place.at(px, py, h);
        if (covered(sx, sy, h)) continue;
        const found = scene.read(Math.round(sx), Math.round(sy));
        result.driveSamples += 1;
        if (found === CLASS.empty) result.driveHoles += 1;
        if (found === CLASS.walk || found === CLASS.curb) result.driveBlocked += 1;
        if (found !== CLASS.deck && found !== CLASS.other && result.examples.length < 4)
          result.examples.push(['开到主线', id, rounded(px), rounded(py), found]);
      }
    }
  }
  return result;
}

/** 平行车道上的车和主线车道之间：横着走一遍，不能隔着路缘或路肩。 */
function checkOpenings({ cx, cy, axis }, ramps, scene, covered) {
  const result = { openingSamples: 0, curbInOpening: 0, examples: [] };
  const [ax, az] = axis(0);
  const alongX = az === cy + 0.5;
  for (const ramp of ramps) {
    const drive = ramp.points.slice(-ramp.center.length);
    for (const [from, to] of ramp.mains ?? []) {
      drive.forEach(([x, z, h], i) => {
        if (ramp.stations[i] < from || ramp.stations[i] > to) return;
        const [wx, wz] = [x + cx + 0.5, z + cy + 0.5];
        const target = alongX ? [wx, az] : [ax, wz];
        const distance = Math.hypot(wx - target[0], wz - target[1]);
        for (let d = 0; d < distance - MAIN_LANE; d += SCAN_STEP) {
          const px = wx + ((target[0] - wx) * d) / distance;
          const pz = wz + ((target[1] - wz) * d) / distance;
          const [sx, sy] = scene.place.at(px, pz, h);
          if (covered(sx, sy, h)) continue;
          const found = scene.read(Math.round(sx), Math.round(sy));
          result.openingSamples += 1;
          if (found !== CLASS.walk && found !== CLASS.curb) continue;
          result.curbInOpening += 1;
          if (result.examples.length < 4)
            result.examples.push(['开口', ramp.name, rounded(px), rounded(pz), found]);
        }
      });
    }
  }
  return result;
}

/** 从遮罩上量这一点所在路面的左右边，返回路面中线到这一点的距离。 */
function deckCenterOffset(scene, x, y, h, nx, ny) {
  const reach = (sign) => {
    for (let d = SCAN_STEP; d < SCAN; d += SCAN_STEP) {
      const [sx, sy] = scene.place.at(x + nx * sign * d, y + ny * sign * d, h);
      if (scene.read(Math.round(sx), Math.round(sy)) !== CLASS.deck) return d;
    }
    return null;
  };
  const left = reach(1);
  const right = reach(-1);
  return left === null || right === null ? null : Math.abs(left - right) / 2;
}

/** 匝道上的车：车中心到路面中线的距离。合流分流段车本来就在横移，不算。 */
function checkCars({ town, lanes }, scene) {
  const fleet = createFleet(town, { cap: 60, full: true, random: randomFrom(13) });
  const wanted = lanes ? new Set(lanes.map(({ id }) => id)) : null;
  const result = { carSamples: 0, carsOffCenter: 0, worstCarOffset: 0, examples: [] };
  for (let step = 0; step < 900; step += 1) {
    fleet.step(DT);
    if (step % 30 !== 29) continue;
    for (const car of fleet.cars) {
      if (car.mode !== 'lane' || car.x === undefined || car.lane.kind !== 'ramp') continue;
      if (wanted && !wanted.has(car.lane.id)) continue;
      const index = Math.max(0, car.path.along.findIndex((s) => s >= car.s) - 1);
      if (car.lane.free?.[index]) continue;
      const a = car.lane.points[index];
      const c = car.lane.points[Math.min(car.lane.points.length - 1, index + 1)];
      const length = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      const nx = (c[1] - a[1]) / length;
      const ny = -(c[0] - a[0]) / length;
      const offset = deckCenterOffset(scene, car.x, car.y, car.h, nx, ny);
      if (offset === null) continue;
      result.carSamples += 1;
      result.worstCarOffset = Math.max(result.worstCarOffset, rounded(offset));
      if (offset <= MAX_CAR_OFFSET) continue;
      result.carsOffCenter += 1;
      if (result.examples.length < 4)
        result.examples.push(['车偏', car.lane.id, rounded(car.x), rounded(car.y), rounded(offset)]);
    }
  }
  return result;
}

/** 两张遮罩：只有路面层的，和按遮挡顺序盖上桥面、桥墩的。region 不为空时只拼这一块。 */
export function maskScenes(town, region) {
  const base = compose(town, MASK, 'current', { withGround: false, region });
  const ground = {
    read: readerOf(base.context, base.canvas.width, base.canvas.height),
    place: base.place,
  };
  const frameOf = (key) => {
    const { canvas, ax, ay } = spriteOf(key, MASK);
    return { w: canvas.width, h: canvas.height, ax, ay };
  };
  const { sorted } = sceneItems({ objects: town.objects }, frameOf);
  for (const { key, px, py, level } of sorted) {
    const sprite = spriteOf(key, MASK);
    const [sx, sy] = base.place.at(px, py, level);
    base.context.drawImage(sprite.canvas, Math.round(sx - sprite.ax), Math.round(sy - sprite.ay));
  }
  const read = readerOf(base.context, base.canvas.width, base.canvas.height);
  return { ground, full: { read, place: base.place } };
}

export const FAILURES = [
  'levelCrossings',
  'piersOnRoad',
  'sharpRamps',
  'sideGaps',
  'driveBlocked',
  'driveHoles',
  'curbInOpening',
  'carsOffCenter',
];

export function inspectEntry(entry, ramps, scenes) {
  const { ground, full } = scenes;
  const lanes = entry.lanes ?? entry.town.lanes;
  const covered = bridgesOver(entry.town.lanes, ramps, entry, full);
  const parts = [
    sameLevel(entry, ramps),
    checkPiers(entry, ramps, ground),
    checkTurns(ramps),
    checkSides(entry, ramps, full),
    checkDrive(lanes, full, covered),
    checkOpenings(entry, ramps, full, covered),
    checkCars(entry, full),
  ];
  const row = Object.assign({}, ...parts);
  row.examples = parts.flatMap((part) => part.examples ?? []).slice(0, 12);
  row.pass = FAILURES.every((key) => row[key] === 0);
  return row;
}
