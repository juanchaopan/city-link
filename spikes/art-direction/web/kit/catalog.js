import { buildObject } from './objects.js';
import {
  buildBank,
  buildBridge,
  buildGround,
  buildMeadow,
  buildRoad,
  buildSkirt,
  buildSlopeRoad,
  buildWater,
  waterLevel,
} from './tiles.js';
import { hashString } from './builder.js';

// 精灵的名字决定它的画法，生成器只需要知道名字。类别用来分别统计数量和耗时。

function spokes(hex) {
  const mask = parseInt(hex, 16);
  const list = [];
  for (let d = 0; d < 8; d += 1) if (mask & (1 << d)) list.push(d);
  return list;
}

const flags = (text) => [...text].map((c) => c === '1');

export function specFor(key, P) {
  const parts = key.split('-');
  const kind = parts[0];
  const seed = hashString(key);
  if (kind === 'g') {
    const corners = [...parts[2]].map(Number);
    return { group: '地表', w: 160, h: 170, anchorY: 110, lit: false, build: () => buildGround(corners, parts[1], P, seed) };
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
  if (kind === 'r') {
    return { group: '线路', w: 280, h: 190, anchorY: 95, lit: false, build: () => buildRoad(parts[1], spokes(parts[2]), P) };
  }
  if (kind === 'rs') {
    const corners = [...parts[2]].map(Number);
    return { group: '坡上线路', w: 320, h: 300, anchorY: 170, lit: false, build: () => buildSlopeRoad(parts[1], corners, spokes(parts[3]), P) };
  }
  if (kind === 'br') {
    return { group: '桥', w: 320, h: 240, anchorY: 110, shadow: true, groundY: waterLevel, reach: 2, build: () => buildBridge(parts[1], spokes(parts[2]), P) };
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
  return { group: '建筑', w: 420, h: 600, anchorY: 480, shadow: true, reach: 2.4, build: () => buildObject(key, P) };
}

/** 一批不进示例城市、但要进图集的精灵，主界面的缩略图用。 */
export const EXTRA_KEYS = ['r-road-11', 'r-highway-11', 'r-road-22', 'br-road-11', 'house-0', 'shop-0', 'factory-0', 'farm-0'];
