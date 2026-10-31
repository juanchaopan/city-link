import { DIRECTIONS, spokesOf } from './network.js';
import { ZONE } from './zones.js';

// 道路负担。每个地块的出入口接到一个路段，流量只算到路段，不模拟单辆车。
// 住宅是出行的起点，商业和工业是终点：起点的出行量按终点容量除以距离平方分配，沿最短路累加到每个路段。

const CAPACITY = { road: 900, highway: 3600 };
const SPEED = { road: 1, highway: 0.5 };

export function buildGraph(roads, N) {
  const nodes = [...roads.keys()].sort((a, b) => a - b);
  const index = new Map(nodes.map((id, i) => [id, i]));
  const edges = [];
  const adjacency = nodes.map(() => []);
  nodes.forEach((id, i) => {
    const { road, highway } = roads.get(id);
    const x = id % N;
    const y = Math.floor(id / N);
    for (const dir of spokesOf(road | highway)) {
      const [dx, dy] = DIRECTIONS[dir];
      const other = (y + dy) * N + x + dx;
      if (!index.has(other)) continue;
      const j = index.get(other);
      if (j < i) continue;
      const kind = highway & (1 << dir) ? 'highway' : 'road';
      const length = Math.hypot(dx, dy);
      const edge = { from: id, to: other, kind, length, load: 0, cost: length * SPEED[kind] };
      const number = edges.length;
      edges.push(edge);
      adjacency[i].push({ to: j, edge: number });
      adjacency[j].push({ to: i, edge: number });
    }
  });
  return { nodes, index, edges, adjacency };
}

/** 从一个或多个起点出发的最短路。byLength 为真时按路程算，否则按行程时间算。 */
export function shortestPaths(graph, sources, byLength = false) {
  const count = graph.nodes.length;
  const distance = new Float64Array(count).fill(Infinity);
  const through = new Int32Array(count).fill(-1);
  const previous = new Int32Array(count).fill(-1);
  const heap = [];
  const push = (entry) => {
    heap.push(entry);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const a = i * 2 + 1;
        const b = a + 1;
        let smallest = i;
        if (a < heap.length && heap[a][0] < heap[smallest][0]) smallest = a;
        if (b < heap.length && heap[b][0] < heap[smallest][0]) smallest = b;
        if (smallest === i) break;
        [heap[smallest], heap[i]] = [heap[i], heap[smallest]];
        i = smallest;
      }
    }
    return top;
  };
  for (const source of sources) {
    distance[source] = 0;
    push([0, source]);
  }
  while (heap.length > 0) {
    const [d, node] = pop();
    if (d > distance[node]) continue;
    for (const { to, edge } of graph.adjacency[node]) {
      const step = byLength ? graph.edges[edge].length : graph.edges[edge].cost;
      const next = d + step;
      if (next < distance[to]) {
        distance[to] = next;
        through[to] = edge;
        previous[to] = node;
        push([next, to]);
      }
    }
  }
  return { distance, through, previous };
}

export function computeTraffic(parcels, roads, N) {
  const graph = buildGraph(roads, N);
  const sources = new Map();
  const sinks = new Map();
  let unreachable = 0;
  for (const parcel of parcels) {
    if (parcel.access < 0 || parcel.capacity === 0) {
      if (parcel.access < 0 && parcel.capacity > 0) unreachable += 1;
      continue;
    }
    const node = graph.index.get(parcel.access);
    if (parcel.zone === ZONE.residential) {
      sources.set(node, (sources.get(node) ?? 0) + parcel.capacity);
    } else if (parcel.zone === ZONE.commercial || parcel.zone === ZONE.industrial) {
      sinks.set(node, (sinks.get(node) ?? 0) + parcel.capacity);
    }
  }

  const sinkList = [...sinks.entries()].sort((a, b) => a[0] - b[0]);
  const trees = sinkList.map(([node]) => shortestPaths(graph, [node]));
  let generated = 0;
  let assigned = 0;
  for (const [node, trips] of [...sources.entries()].sort((a, b) => a[0] - b[0])) {
    generated += trips;
    const weights = sinkList.map(([, capacity], i) => {
      const d = trees[i].distance[node];
      return Number.isFinite(d) ? capacity / (d + 4) ** 2 : 0;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    weights.forEach((weight, i) => {
      if (weight === 0) return;
      const share = (trips * weight) / total;
      assigned += share;
      let at = node;
      while (trees[i].through[at] >= 0) {
        graph.edges[trees[i].through[at]].load += share;
        at = trees[i].previous[at];
      }
    });
  }

  const edges = graph.edges.map((edge) => ({
    ...edge,
    capacity: CAPACITY[edge.kind],
    ratio: edge.load / CAPACITY[edge.kind],
  }));
  return { edges, generated, assigned, unreachable, sources: sources.size, sinks: sinks.size };
}
