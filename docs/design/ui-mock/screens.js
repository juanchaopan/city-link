// 全部效果图，按页面编号的顺序出图。同一个编号在几个分组里都有时，只留排在前面的那个。
import { START } from './screens-start.js';
import { SYSTEM } from './screens-system.js';
import { HUD } from './screens-hud.js';
import { BUILD } from './screens-build.js';
import { MAP } from './screens-map.js';
import { NEIGHBOR } from './screens-neighbor.js';
import { WORLD } from './screens-world.js';

const all = [...START, ...SYSTEM, ...HUD, ...BUILD, ...MAP, ...NEIGHBOR, ...WORLD];
const seen = new Set();

export const SCREENS = all.filter((s) => {
  if (seen.has(s.id)) return false;
  seen.add(s.id);
  return true;
});
