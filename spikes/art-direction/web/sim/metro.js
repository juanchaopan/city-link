// 地铁示例。每条线独立，是一根线或一个环，不分叉。
// 两条线相交时，只有两条线都在交点设站才是换乘站；否则只是从地下穿过。

const COLORS = ['#d9413a', '#2f7fd1', '#e0a100'];

function cellsAlong(points) {
  const cells = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    let [x, y] = points[i];
    const [tx, ty] = points[i + 1];
    cells.push([x, y]);
    while (x !== tx || y !== ty) {
      x += Math.sign(tx - x);
      y += Math.sign(ty - y);
      if (x !== tx || y !== ty) cells.push([x, y]);
    }
  }
  cells.push(points[points.length - 1]);
  return cells;
}

function degreeCheck(line) {
  const links = new Map();
  const add = (a, b) => {
    const key = a.join(',');
    if (!links.has(key)) links.set(key, new Set());
    links.get(key).add(b.join(','));
  };
  const cells = cellsAlong(line.points);
  for (let i = 0; i < cells.length - 1; i += 1) {
    add(cells[i], cells[i + 1]);
    add(cells[i + 1], cells[i]);
  }
  return [...links.values()].every((set) => set.size <= 2);
}

export function metroPlan(plan) {
  const { columns, rows } = plan;
  const c = (i) => columns[Math.min(i, columns.length - 1)];
  const r = (i) => rows[Math.min(i, rows.length - 1)];
  const west = columns[0] - 1;
  const east = columns[columns.length - 1] + 1;
  const ringWest = c(2) + 1;
  const ringEast = c(4);
  const ringNorth = r(0);
  const ringSouth = r(2);

  const lines = [
    {
      id: 1,
      name: '1 号线',
      color: COLORS[0],
      loop: false,
      points: [
        [west, r(1)],
        [east, r(1)],
      ],
      stations: [
        [west, r(1)],
        [c(1), r(1)],
        [ringWest, r(1)],
        [east, r(1)],
      ],
    },
    {
      id: 2,
      name: '2 号线',
      color: COLORS[1],
      loop: true,
      points: [
        [ringWest, ringNorth],
        [ringEast, ringNorth],
        [ringEast, ringSouth],
        [ringWest, ringSouth],
        [ringWest, ringNorth],
      ],
      stations: [
        [ringWest, ringNorth],
        [ringEast, ringNorth],
        [ringEast, ringSouth],
        [ringWest, ringSouth],
        [ringWest, r(1)],
      ],
    },
    {
      id: 3,
      name: '3 号线',
      color: COLORS[2],
      loop: false,
      points: [
        [c(1), r(0) - 1],
        [c(1), r(rows.length - 1) + 1],
      ],
      stations: [
        [c(1), r(0) - 1],
        [c(1), r(1)],
        [c(1), r(rows.length - 1) + 1],
      ],
    },
  ];

  const crossings = [];
  for (let a = 0; a < lines.length; a += 1) {
    for (let b = a + 1; b < lines.length; b += 1) {
      const cellsB = new Set(cellsAlong(lines[b].points).map((cell) => cell.join(',')));
      const seen = new Set();
      for (const cell of cellsAlong(lines[a].points)) {
        const key = cell.join(',');
        if (!cellsB.has(key) || seen.has(key)) continue;
        seen.add(key);
        const hasStation = (line) => line.stations.some((s) => s.join(',') === key);
        crossings.push({
          x: cell[0],
          y: cell[1],
          lines: [lines[a].id, lines[b].id],
          interchange: hasStation(lines[a]) && hasStation(lines[b]),
        });
      }
    }
  }
  return { lines, crossings };
}

export function metroCheck({ lines, crossings }) {
  return {
    lines: lines.length,
    branching: lines.filter((line) => !degreeCheck(line)).map((line) => line.id),
    loops: lines.filter((line) => line.loop).length,
    interchanges: crossings.filter((crossing) => crossing.interchange).length,
    passThroughs: crossings.filter((crossing) => !crossing.interchange).length,
  };
}
