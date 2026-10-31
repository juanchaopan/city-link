import { hashString } from './builder.js';
import { buildFestival, buildObject } from './objects.js';
import {
  buildBank,
  buildBridge,
  buildField,
  buildGround,
  buildMeadow,
  buildNeighbor,
  buildPlannedEnd,
  buildRoad,
  buildSkirt,
  buildSlopeRoad,
  buildWater,
  fadeNeighbor,
  LAYER,
  waterLevel,
} from './tiles.js';

// 精灵的名字决定它的画法，生成器只需要知道名字。类别用来分别统计数量和耗时。
// 路面名字：rw、rc、rd 是人行道、路缘、车道三层，r 是三层合一，只用于界面缩略图；坡上的路加前缀 s。

const flags = (text) => [...text].map((c) => c === '1');

function box(span, tall) {
  const w = Math.ceil((span * 128 + 240) / 40) * 40;
  const below = Math.ceil((span * 40 + 80) / 40) * 40;
  const above = Math.ceil((span * 40 + tall) / 40) * 40;
  return { w, h: above + below, anchorY: above };
}

function propertyBox(key) {
  const parts = key.split('-');
  if (parts[0] === 'Q') {
    const legs = Number(parts[2]);
    return { group: '大三角物业', span: legs, tall: 340 };
  }
  if (parts[0] === 'S' || parts[0] === 'P') {
    const [w, h] = parts[2].split('x').map(Number);
    return { group: parts[0] === 'S' ? '公共服务' : '公园广场', span: Math.max(w, h), tall: 280 };
  }
  const [w, h] = parts[2].split('x').map(Number);
  const unit = parts[3] === 'a' ? 1 : 0.72;
  return { group: parts[3] === 'a' ? '直角物业' : '斜向物业', span: Math.max(w, h) * unit + 0.6, tall: 420 };
}

const ROAD_LAYERS = { r: LAYER.both, rw: LAYER.walk, rc: LAYER.curb, rd: LAYER.deck, srw: LAYER.walk, src: LAYER.curb, srd: LAYER.deck };

const gradeOf = (text) => text.split('_').map((value) => Number(value.replace('n', '-')) / 1000);

export function specFor(key, P) {
  const parts = key.split('-');
  const kind = parts[0];
  const seed = hashString(key);
  if (kind === 'g') {
    const corners = [...parts[2]].map(Number);
    return { group: '地表', w: 160, h: 170, anchorY: 110, lit: false, build: () => buildGround(corners, Number(parts[1]), P, seed) };
  }
  if (kind === 'w') {
    return { group: '水面和河岸', w: 160, h: 130, anchorY: 60, lit: false, build: () => buildWater(P, seed) };
  }
  if (kind === 'b') {
    return { group: '水面和河岸', w: 160, h: 150, anchorY: 60, lit: false, build: () => buildBank(flags(parts[1]), flags(parts[2]), P, seed) };
  }
  if (kind === 'sk') {
    return { group: '沙盘底座', w: 160, h: 170, anchorY: 60, lit: false, build: () => buildSkirt(parts[1], parts[2] === '1', P) };
  }
  if (kind === 'm') {
    return { group: '地表', w: 160, h: 120, anchorY: 60, lit: false, build: () => buildMeadow(P, seed) };
  }
  if (kind === 'f') {
    return { group: '农田', w: 160, h: 120, anchorY: 60, lit: false, build: () => buildField(Number(parts[1]), parts[2], P, seed) };
  }
  if (kind === 'r' || kind === 'rw' || kind === 'rc' || kind === 'rd') {
    const { build, extra } = buildRoad(parseInt(parts[1], 16), parseInt(parts[2], 16), P, ROAD_LAYERS[kind]);
    return { group: '线路', w: 400, h: 260, anchorY: 130, lit: false, build, extra };
  }
  if (kind === 'srw' || kind === 'src' || kind === 'srd') {
    const corners = [...parts[3]].map(Number);
    const grade = parts[4] ? gradeOf(parts[4]) : null;
    const { build, extra } = buildSlopeRoad(parseInt(parts[1], 16), parseInt(parts[2], 16), corners, grade, P, ROAD_LAYERS[kind]);
    return { group: '坡上线路', w: 400, h: 340, anchorY: 200, lit: false, build, extra };
  }
  if (kind === 'br') {
    const { build, extra } = buildBridge(parseInt(parts[1], 16), parseInt(parts[2], 16), P);
    return { group: '桥', w: 320, h: 240, anchorY: 110, shadow: true, groundY: waterLevel, reach: 2, build, extra };
  }
  if (kind === 'gate') {
    return { group: '道路收尾', w: 240, h: 200, anchorY: 110, shadow: true, reach: 1.2, build: () => buildPlannedEnd(parts[1], Number(parts[2]), P) };
  }
  if (kind === 'nb') {
    const { build, extra } = buildNeighbor(parts[1], parts[2], P);
    return { group: '邻城', w: 1100, h: 800, anchorY: 340, lit: false, build, extra, fade: (sprite) => fadeNeighbor(sprite, parts[1]) };
  }
  if (kind === 'car' || kind === 'bus') {
    return { group: '车船', w: 120, h: 90, anchorY: 50, shadow: true, reach: 1.2, build: () => buildObject(key, P) };
  }
  if (kind === 'boat') {
    return { group: '车船', w: 220, h: 160, anchorY: 80, shadow: true, groundY: waterLevel, reach: 1.5, build: () => buildObject(key, P) };
  }
  if (kind === 'dock') {
    return { group: '码头', w: 320, h: 260, anchorY: 170, shadow: true, groundY: waterLevel, reach: 2, build: () => buildObject(key, P) };
  }
  if (kind === 'forest') {
    return { group: '树', w: 340, h: 330, anchorY: 220, shadow: true, reach: 2, build: () => buildObject(key, P) };
  }
  if (kind === 'fx') {
    const footprint = key.slice(3);
    const span = Number(/\d+/.exec(footprint)[0]);
    const second = Number(/x(\d+)/.exec(footprint)?.[1] ?? span);
    const size = box(Math.max(span, second) + 0.6, 120);
    return { group: '节日层', ...size, lit: false, build: () => buildFestival(footprint, P) };
  }
  if (kind === 't' || kind === 'farmhouse') {
    return { group: kind === 't' ? '小三角' : '农舍', w: 340, h: 400, anchorY: 280, shadow: true, reach: 2, build: () => buildObject(key, P) };
  }
  const { group, span, tall } = propertyBox(key);
  return { group, ...box(span, tall), shadow: true, reach: 2.2 + span * 0.8, build: () => buildObject(key, P) };
}

/** 烘焙一张精灵，包含只有裁好之后才能做的后处理。 */
export function bakeKey(baker, key, P) {
  const spec = specFor(key, P);
  const result = baker.bake(spec);
  return { spec, result: spec.fade ? spec.fade(result) : result };
}

/** 一批不进示例城市、但要进图集的精灵，主界面的缩略图用。 */
export const EXTRA_KEYS = ['r-11-0', 'r-0-11', 'r-22-0', 'br-11-0'];
