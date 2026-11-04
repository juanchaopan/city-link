import { blankSprites } from './blanks.js';
import { junctionPlan, markSprites } from './junctions.js';
import { planRoundabouts } from './roundabout.js';
import { roadSprites } from './roadsprites.js';
import { sculptTerrain } from './sculpt.js';
import { surfaceOf } from './surface.js';

// 从原始地形和路网走到能画、能跑的世界：地形让路、改环岛、切路面精灵、算路面高度、规划路口。
// 城市生成和验收场景走同一条流程，检查看到的就是游戏里的样子。
// 路面标记的顺序就是画的顺序：停车线以内的路面色底在前，斑马线和停车线在后。

/** 地形让路。corner(x, y) 是原来的角点高度，返回改过的高度和用它查询的函数。 */
export function terrainOf({ N, roads, corner, isWater }) {
  const cornersAt = (read) => (x, y) => [
    read(x, y),
    read(x + 1, y),
    read(x + 1, y + 1),
    read(x, y + 1),
  ];
  const before = cornersAt(corner);
  const heights = sculptTerrain({
    N,
    roads,
    corner,
    cornersOf: before,
    levelOf: (x, y) => Math.min(...before(x, y)),
    isFlat: (x, y) => new Set(before(x, y)).size === 1,
    isWater,
  });
  const cornersOf = cornersAt((x, y) => heights[y * (N + 1) + x]);
  return {
    heights,
    cornersOf,
    levelOf: (x, y) => Math.min(...cornersOf(x, y)),
    isFlat: (x, y) => new Set(cornersOf(x, y)).size === 1,
  };
}

/** 路面精灵、路面高度和路口规划。gates 是地图边界上规划中的连接点，地图外没有数据，所以路在这里收尾。 */
export function roadWorld({ N, roads, cornersOf, levelOf, isFlat, isWater, gates }) {
  const { rings, blocked } = planRoundabouts({ N, roads, isFlat, isWater });
  const sprites = roadSprites({ N, roads, cornersOf, isFlat, levelOf, isWater, gates, rings });
  const surface = surfaceOf({
    N,
    roads,
    cornersOf,
    levelOf,
    isFlat,
    isWater,
    grades: sprites.grades,
  });
  const junctions = junctionPlan({ N, roads, surface, rings });
  return {
    sprites,
    surface,
    rings,
    blockedRings: blocked,
    junctions,
    marks: [...blankSprites(junctions), ...markSprites(junctions.legs)],
  };
}
