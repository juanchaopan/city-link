import { DIRECTIONS, spokesOf } from './network.js';
import { ZONE } from './zones.js';

// 道路负担。每个地块的出入口接到一个路段，流量只算到路段，不模拟单辆车。
// 住宅是出行的起点，商业和工业是终点：起点的出行量按终点容量除以距离平方分配，沿最短路累加到每个路段。
// 最短路按行程时间算，快速路和高速的单位时间短，所以路程长的出行自己就会绕到快路上去，
// 只有走不了多远的出行才留在街道上。上下快路要经过匝道，匝道是路网图里的边，流量同样累加上去。
// 地图边上的出入口也是起点：外面来的车从这里进城，出行量按全城终点容量的一个比例算，高速上的车主要是它们。
// 容量、单位时间和这个比例都是临时值，等交通结算定了再改。

const CAPACITY = { road: 900, arterial: 1800, express: 3000, highway: 3600, ramp: 1500 };
const SPEED = { road: 1, arterial: 0.8, express: 0.35, highway: 0.3, ramp: 0.7 };
const EXTERNAL_SHARE = 0.25;
const MIN_SHARE = 0.03;

/**
 * 路网图。节点是有路的格子，边是相邻格之间的路段。links 是立交匝道和快速路主线，
 * 一条 link 是一条边，两端不一定相邻，也可以是主线上不对应格子的节点，所以高速、快速路和城市路网只有带上它们才是连通的。
 */
export function buildGraph(roads, N, links = []) {
  const ends = links.flatMap(({ from, to }) => [from, to]);
  const nodes = [...new Set([...roads.keys(), ...ends])].sort((a, b) => a - b);
  const index = new Map(nodes.map((id, i) => [id, i]));
  const edges = [];
  const adjacency = nodes.map(() => []);
  const addEdge = (edge) => {
    const i = index.get(edge.from);
    const j = index.get(edge.to);
    const number = edges.length;
    edges.push(edge);
    adjacency[i].push({ to: j, edge: number });
    adjacency[j].push({ to: i, edge: number });
  };
  nodes.forEach((id, i) => {
    const cell = roads.get(id);
    if (!cell) return;
    const { road, highway, arterial = 0 } = cell;
    const x = id % N;
    const y = Math.floor(id / N);
    for (const dir of spokesOf(road | highway)) {
      const [dx, dy] = DIRECTIONS[dir];
      const other = (y + dy) * N + x + dx;
      if (!roads.has(other) || index.get(other) < i) continue;
      const bit = 1 << dir;
      const kind = highway & bit ? 'highway' : arterial & bit ? 'arterial' : 'road';
      const length = Math.hypot(dx, dy);
      addEdge({ from: id, to: other, dir, kind, length, load: 0, cost: length * SPEED[kind] });
    }
  });
  for (const { from, to, length, kind = 'ramp', lanes = [] } of links)
    addEdge({ from, to, kind, length, load: 0, cost: length * SPEED[kind], lanes });
  return { nodes, index, edges, adjacency };
}

/** 路网分成几块互不相通的部分，返回每个节点所在的块和各块的大小。 */
export function componentsOf(graph) {
  const component = new Int32Array(graph.nodes.length).fill(-1);
  const sizes = [];
  graph.nodes.forEach((_, start) => {
    if (component[start] >= 0) return;
    const label = sizes.length;
    const stack = [start];
    component[start] = label;
    let size = 0;
    while (stack.length > 0) {
      const node = stack.pop();
      size += 1;
      for (const { to } of graph.adjacency[node]) {
        if (component[to] < 0) {
          component[to] = label;
          stack.push(to);
        }
      }
    }
    sizes.push(size);
  });
  return { component, sizes };
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

/** 每条 lane 的负载比：lane 所在路段里最大的那个。 */
function laneRatios(edges) {
  const ratios = new Map();
  for (const { lanes = [], ratio } of edges) {
    for (const id of lanes) ratios.set(id, Math.max(ratios.get(id) ?? 0, ratio));
  }
  return ratios;
}

/** gates 是地图边上出入口所在的路格。 */
export function computeTraffic(parcels, roads, N, links = [], gates = []) {
  const graph = buildGraph(roads, N, links);
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
  const sinkTotal = [...sinks.values()].reduce((sum, capacity) => sum + capacity, 0);
  for (const gate of gates) {
    const node = graph.index.get(gate);
    const trips = (sinkTotal * EXTERNAL_SHARE) / gates.length;
    sources.set(node, (sources.get(node) ?? 0) + trips);
  }

  const sinkList = [...sinks.entries()].sort((a, b) => a[0] - b[0]);
  const sourceList = [...sources.entries()].sort((a, b) => a[0] - b[0]);
  const trees = sinkList.map(([node]) => shortestPaths(graph, [node]));
  let generated = 0;
  let assigned = 0;
  for (const [node, trips] of sourceList) {
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
  return {
    edges,
    generated,
    assigned,
    unreachable,
    sources: sources.size,
    sinks: sinks.size,
    laneRatios: laneRatios(edges),
    graph,
    sinkList,
    sourceList,
  };
}

/**
 * 一个物业的车走哪些路：住宅的车去各个终点，商业和工业的车来自各个住宅，权重和分配时一样。
 * 返回份额不小的路段，edge 是路段，share 是这个物业的车有多少走这里。
 */
export function parcelRoutes(traffic, parcel) {
  const { graph, sinkList, sourceList, edges } = traffic;
  const node = graph.index.get(parcel.access);
  const others = parcel.zone === ZONE.residential ? sinkList : sourceList;
  const tree = shortestPaths(graph, [node]);
  const usage = new Map();
  const weights = others.map(([target, amount]) => {
    const d = tree.distance[target];
    return Number.isFinite(d) ? amount / (d + 4) ** 2 : 0;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  others.forEach(([target], i) => {
    let at = target;
    while (tree.through[at] >= 0) {
      const edge = tree.through[at];
      usage.set(edge, (usage.get(edge) ?? 0) + weights[i] / total);
      at = tree.previous[at];
    }
  });
  return [...usage.entries()]
    .filter(([, share]) => share >= MIN_SHARE)
    .map(([edge, share]) => ({ edge: edges[edge], share }));
}
