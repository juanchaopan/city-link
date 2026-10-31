import { DIRECTIONS, spokesOf } from './network.js';

// 把路网变成要画的精灵。纯函数，生成城市和路面检查共用同一份逻辑。
// 全图分三层绘制：先是所有人行道，再是所有路缘，最后是所有车道。

const number = (value) => String(Math.round(value * 1000)).replace('-', 'n');

function opposite(spokes) {
  return spokes.length === 2 && (spokes[0] + 4) % 8 === spokes[1];
}

/** 路穿过格子一条边的位置，地形高度是这条边两端（斜向时是那个角）的平均。 */
function boundaryHeight(corners, dir) {
  const ids = [[1, 2], [2], [2, 3], [3], [0, 3], [0], [0, 1], [1]][dir];
  return ids.reduce((sum, id) => sum + corners[id], 0) / ids.length;
}

/**
 * 连续坡段的纵坡。一条直路穿过若干格坡地时，路面从起点到终点匀速升降，
 * 每格只存两端高度和切线，两头切线为 0，所以和平地的路平滑相接。
 */
function gradeRuns({ N, cells, cornersOf, isFlat, levelOf }) {
  const grades = new Map();
  const straightAlong = (id, spokes) => {
    const entry = cells.get(id);
    if (!entry) return false;
    const own = spokesOf(entry.road | entry.highway);
    const sameKind = !(entry.road && entry.highway);
    return sameKind && opposite(own) && own[0] === spokes[0];
  };
  const sloped = (id) => !isFlat(id % N, Math.floor(id / N));
  const step = (id, dir) => {
    const [dx, dy] = DIRECTIONS[dir];
    const x = id % N;
    const y = Math.floor(id / N);
    const nx = x + dx;
    const ny = y + dy;
    return nx >= 0 && ny >= 0 && nx < N && ny < N ? ny * N + nx : -1;
  };
  for (const id of [...cells.keys()].sort((a, b) => a - b)) {
    if (grades.has(id) || !sloped(id)) continue;
    const { road, highway } = cells.get(id);
    const spokes = spokesOf(road | highway);
    if (!straightAlong(id, spokes)) continue;
    const run = [id];
    for (
      let next = step(id, spokes[0]);
      next >= 0 && sloped(next) && straightAlong(next, spokes);
      next = step(next, spokes[0])
    )
      run.unshift(next);
    for (
      let next = step(id, spokes[1]);
      next >= 0 && sloped(next) && straightAlong(next, spokes);
      next = step(next, spokes[1])
    )
      run.push(next);
    const heightAtEnd = (cell, dir) => {
      const x = cell % N;
      const y = Math.floor(cell / N);
      return boundaryHeight(cornersOf(x, y), dir);
    };
    const from = heightAtEnd(run[0], spokes[0]);
    const to = heightAtEnd(run[run.length - 1], spokes[1]);
    const count = run.length;
    const slope = (to - from) / count;
    run.forEach((cell, i) => {
      const level = levelOf(cell % N, Math.floor(cell / N));
      grades.set(cell, [
        from + slope * i - level,
        from + slope * (i + 1) - level,
        i === 0 ? 0 : slope,
        i === count - 1 ? 0 : slope,
      ]);
    });
  }
  return grades;
}

/** 精灵名字里的路网部分：普通路、高速两组方向位；有四车道时普通路后面跟它的方向位。 */
export function roadTag({ road, highway, arterial = 0 }) {
  const local = arterial ? `${road.toString(16)}_${arterial.toString(16)}` : road.toString(16);
  return `${local}-${highway.toString(16)}`;
}

/** 输入路网，输出三层路面、桥和地形信息之外的一切路面精灵。gates 是地图边界上的连接点。 */
export function roadSprites({
  N,
  roads,
  cornersOf,
  isFlat,
  levelOf,
  isWater,
  gates = [],
  linked = false,
}) {
  const cells = new Map([...roads.entries()].map(([id, entry]) => [id, { ...entry }]));
  const planned = [];
  const neighbors = [];
  for (const gate of gates) {
    const id = gate.y * N + gate.x;
    if (linked) {
      const entry = cells.get(id);
      entry[gate.kind === 'highway' ? 'highway' : 'road'] |= 1 << ((gate.inward + 4) % 8);
      neighbors.push({ key: `nb-${gate.axis}-${gate.kind}`, x: gate.x, y: gate.y, level: 0 });
    } else {
      planned.push({
        key: `gate-${gate.kind}-${String(gate.inward)}`,
        x: gate.x,
        y: gate.y,
        level: 0,
      });
    }
  }
  const grades = gradeRuns({ N, cells, cornersOf, isFlat, levelOf });
  const walks = [];
  const curbs = [];
  const decks = [];
  const bridges = [];
  for (const id of [...cells.keys()].sort((a, b) => a - b)) {
    const entry = cells.get(id);
    const x = id % N;
    const y = Math.floor(id / N);
    const tag = roadTag(entry);
    if (isWater(x, y)) {
      if (spokesOf(entry.road | entry.highway).length === 2)
        bridges.push({ key: `br-${tag}`, x, y });
      continue;
    }
    const level = levelOf(x, y);
    if (isFlat(x, y)) {
      walks.push({ key: `rw-${tag}`, x, y, level });
      curbs.push({ key: `rc-${tag}`, x, y, level });
      decks.push({ key: `rd-${tag}`, x, y, level });
    } else {
      const shape = cornersOf(x, y)
        .map((v) => v - level)
        .join('');
      const grade = grades.get(id);
      const suffix = grade ? `-${grade.map(number).join('_')}` : '';
      walks.push({ key: `srw-${tag}-${shape}${suffix}`, x, y, level });
      curbs.push({ key: `src-${tag}-${shape}${suffix}`, x, y, level });
      decks.push({ key: `srd-${tag}-${shape}${suffix}`, x, y, level });
    }
  }
  return { walks, curbs, decks, bridges, planned, neighbors, grades, cells };
}
