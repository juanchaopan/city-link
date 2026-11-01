// 遮挡顺序验收：同屏的车、公交、灯杆、建筑、桥墩和桥面，算出谁应该在前，再和绘制顺序比对。
// 纯计算，不开浏览器，要先有 out/atlas-sunny.json 提供精灵尺寸。node scripts/occlusion.js [车数] [地图边长]
// 判断前后的函数写在这里，和排序用的 compareDepth 分开：平面上沿视线方向取几条线，看谁离相机近；
// 平面上重叠时，一边是桥面就是上下两层，低的在后面；都不是桥面时，高差不到一层只是车身探进了路边物体的占地一角，
// 按这条视线上的前后算。靠后物体最低的像素在靠前物体最高的像素上方时，投影碰不到，这条视线不投票，
// 只叠着两个像素也算碰不到。
// 车和桥面在平面上重叠、车比桥面的最低点只低一点时，车压在接缝上，这一对两种画法都对，不计入。
// 车脚下的桥面和另一块桥面在同一层并且在平面上重叠（匝道盖住主线的路肩）时，车跟着自己脚下的桥面走，
// 它和另一块桥面的先后由两块桥面的先后决定，不单独判。
// 同一批车再按第 7 轮的分层规则排一遍（地面的车、灯杆、物体、匝道上的车各画一层，层内不排序），证明检查抓得到错序。
// 车流用固定的随机数种子，同一份代码每次的结果一样。
// 输出 out/occlusion-report.json，按物体种类分别统计重叠对和错序数。
import { readFileSync, writeFileSync } from 'node:fs';
import { generateCity } from '../web/sim/city.js';
import { carItem, createDrawList } from '../web/sim/drawlist.js';
import { createFleet } from '../web/sim/fleet.js';
import { overlapBoxes } from '../web/sim/order.js';
import { sceneItems } from '../web/sim/sceneitems.js';

const cars = Number(process.argv[2] ?? 600);
const size = Number(process.argv[3] ?? 64);
const STEPS = 1200;
const SAMPLE_EVERY = 60;
const DT = 0.05;
const RAYS = 7;
const EPS = 1e-6;
const CELL = 256;
const SEAM_GAP = 0.3;
const SAME_LEVEL = 0.6;
const TWO_PIXELS = 0.06;
const SEED = 7;
const MODULUS = 2147483647;

const frames = JSON.parse(readFileSync('out/atlas-sunny.json', 'utf8'));
const city = generateCity(size);
const { sorted, cycles } = sceneItems(city, (key) => frames[key]);
const screen = (px, py, level) => ({ sx: (px - py) * 64, sy: (px + py - 1) * 32 - level * 32 });

function seeded() {
  let state = SEED;
  return () => {
    state = (state * 16807) % MODULUS;
    return state / MODULUS;
  };
}

function kindOf(item) {
  if (item.car) return item.car.bus ? '公交' : '车';
  if (item.signal !== undefined) return '灯杆';
  if (/^(ixp|ev)-/.test(item.key)) return '桥面';
  if (item.key.startsWith('pr-')) return '桥墩';
  if (/^(B|Q|S|P|t|farmhouse|ms|bs|forest)/.test(item.key)) return '建筑';
  return '其他';
}

/** 多边形在一条视线上的区间。视线是 x - y = v 这条线，沿线的坐标是 x + y。 */
function rangeOn(polygon, v) {
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % polygon.length];
    const va = ax - ay;
    const vb = bx - by;
    if ((va - v) * (vb - v) > 0) continue;
    const t = Math.abs(vb - va) < EPS ? 0 : (v - va) / (vb - va);
    const u = ax + ay + (bx + by - ax - ay) * t;
    low = Math.min(low, u);
    high = Math.max(high, u);
  }
  return [low, high];
}

const floorOf = (item) => item.base ?? 0;

/** 两个多边形在平面上有没有重叠：沿几条视线看区间。 */
function overlapInPlan(a, b) {
  const va = a.footprint.map(([x, y]) => x - y);
  const vb = b.footprint.map(([x, y]) => x - y);
  const low = Math.max(Math.min(...va), Math.min(...vb));
  const high = Math.min(Math.max(...va), Math.max(...vb));
  if (high - low < 1e-3) return false;
  for (let i = 1; i <= RAYS; i += 1) {
    const v = low + ((high - low) * i) / (RAYS + 1);
    const [a0, a1] = rangeOn(a.footprint, v);
    const [b0, b1] = rangeOn(b.footprint, v);
    if (a1 > b0 + EPS && b1 > a0 + EPS) return true;
  }
  return false;
}

/** 这一对是车压在桥面接缝上。 */
function onSeam(a, b) {
  const [car, deck] = a.car ? [a, b] : [b, a];
  return Boolean(car.car && deck.deck) && Math.abs(floorOf(deck) - floorOf(car)) < SEAM_GAP;
}

/** 车脚下的桥面：同一层、平面上重叠的桥面。 */
function deckUnder(car) {
  return sorted.find(
    (item) =>
      item.deck && Math.abs(floorOf(item) - floorOf(car)) < SEAM_GAP && overlapInPlan(item, car),
  );
}

/** 车跟着脚下的桥面走：脚下的桥面和这块桥面同层并且重叠，先后由桥面之间决定。 */
function followsOwnDeck(a, b) {
  const [car, deck] = a.car ? [a, b] : [b, a];
  if (!car.car || !deck.deck) return false;
  const own = deckUnder(car);
  return Boolean(
    own &&
      own !== deck &&
      Math.abs(floorOf(own) - floorOf(deck)) < SAME_LEVEL &&
      overlapInPlan(own, deck),
  );
}

/** 这条视线上，靠后的物体最低的像素在靠前物体最高的像素上方。 */
const apart = (behind, behindEnd, front, frontStart) =>
  behindEnd - floorOf(behind) <= frontStart - (front.peak ?? Infinity) + TWO_PIXELS;

/** 平面上重叠的一条视线上谁先画：有桥面就低的先，否则高差不到一层按前后，高差够大低的先。 */
function stackedVote(a, b, [a0, a1], [b0, b1]) {
  const gap = Math.abs(floorOf(a) - floorOf(b));
  if (gap < EPS) return 0;
  if (a.deck || b.deck || gap > SEAM_GAP) return floorOf(a) < floorOf(b) ? -1 : 1;
  return (a0 + a1) / 2 < (b0 + b1) / 2 ? -1 : 1;
}

/** 谁应该先画：a 先返回 -1，b 先返回 1，平面上没有重叠的视线时返回 0。 */
function truth(a, b) {
  const va = a.footprint.map(([x, y]) => x - y);
  const vb = b.footprint.map(([x, y]) => x - y);
  const low = Math.max(Math.min(...va), Math.min(...vb));
  const high = Math.min(Math.max(...va), Math.max(...vb));
  if (high - low < 1e-3) return 0;
  let vote = 0;
  let stacked = false;
  for (let i = 1; i <= RAYS; i += 1) {
    const v = low + ((high - low) * i) / (RAYS + 1);
    const [a0, a1] = rangeOn(a.footprint, v);
    const [b0, b1] = rangeOn(b.footprint, v);
    if (a1 <= b0 + EPS) vote -= apart(a, a1, b, b0) ? 0 : 1;
    else if (b1 <= a0 + EPS) vote += apart(b, b1, a, a0) ? 0 : 1;
    else {
      stacked = true;
      vote += stackedVote(a, b, [a0, a1], [b0, b1]);
    }
  }
  if (stacked && onSeam(a, b)) return 0;
  if (followsOwnDeck(a, b)) return 0;
  return Math.sign(vote);
}

function binsOf(sequence) {
  const bins = new Map();
  sequence.forEach((item, index) => {
    for (let x = Math.floor(item.left / CELL); x <= Math.floor(item.right / CELL); x += 1) {
      for (let y = Math.floor(item.top / CELL); y <= Math.floor(item.bottom / CELL); y += 1) {
        const key = x * 100000 + y;
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key).push(index);
      }
    }
  });
  return bins;
}

function short(value) {
  return typeof value === 'number' ? Math.round(value * 100) / 100 : value;
}

function describe(item) {
  if (item.car) return ['车', item.car.x, item.car.y, item.car.h].map(short);
  return [item.key, item.px, item.py, item.base ?? 0, item.peak ?? 0].map(short);
}

/** 重叠对里错序的数量，按种类统计。两个都是静态物体的对只算灯杆和桥面。 */
function audit(sequence, tally, examples) {
  const seen = new Set();
  for (const list of binsOf(sequence).values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const first = Math.min(list[i], list[j]);
        const second = Math.max(list[i], list[j]);
        const pair = first * 100000 + second;
        if (seen.has(pair)) continue;
        seen.add(pair);
        const a = sequence[first];
        const b = sequence[second];
        const kinds = [kindOf(a), kindOf(b)].sort().join('-');
        if (!a.car && !b.car && kinds !== '桥面-灯杆' && kinds !== '桥墩-灯杆') continue;
        if (!overlapBoxes(a, b)) continue;
        const order = truth(a, b);
        if (order === 0) continue;
        const entry = (tally[kinds] ??= { pairs: 0, wrong: 0 });
        entry.pairs += 1;
        if (order > 0) {
          entry.wrong += 1;
          if (examples && examples.length < 12) examples.push([describe(a), describe(b)]);
        }
      }
    }
  }
}

/** 第 7 轮的分层：地面的车、灯杆、物体、匝道上的车，层内车的先后是模拟里的顺序。 */
function legacySequence(items) {
  const poles = sorted.filter((item) => item.signal !== undefined);
  const objects = sorted.filter((item) => item.signal === undefined);
  const ground = items.filter((item) => !item.car.high);
  const high = items.filter((item) => item.car.high);
  return [...ground, ...poles, ...objects, ...high];
}

const fleet = createFleet(city, {
  cap: cars,
  full: true,
  highCap: Math.min(120, cars),
  random: seeded(),
});
const list = createDrawList(sorted);
const current = {};
const legacy = {};
const examples = [];
let samples = 0;
let spent = 0;
let worst = 0;
for (let step = 0; step < STEPS; step += 1) {
  fleet.step(DT);
  const items = fleet.cars
    .filter((car) => car.x !== undefined)
    .map((car) => carItem(car, fleet.lengthOf(car) / 2, screen));
  const started = performance.now();
  const sequence = list.order(items);
  const ms = performance.now() - started;
  spent += ms;
  worst = Math.max(worst, ms);
  if (step % SAMPLE_EVERY !== SAMPLE_EVERY - 1) continue;
  samples += 1;
  audit(sequence, current, examples);
  audit(legacySequence(items), legacy);
}

const totals = (tally) => Object.values(tally).reduce((sum, { wrong }) => sum + wrong, 0);
const report = {
  cars,
  size,
  statics: sorted.length,
  cycles,
  samples,
  sortMsPerFrame: Math.round((spent / STEPS) * 100) / 100,
  sortMsWorst: Math.round(worst * 100) / 100,
  current,
  legacy,
  wrong: totals(current),
  legacyWrong: totals(legacy),
  examples,
};
writeFileSync('out/occlusion-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
if (report.wrong > 0 || cycles > 0) process.exitCode = 1;
