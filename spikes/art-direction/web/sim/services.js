import { buildGraph, shortestPaths } from './traffic.js';
import { ZONE } from './zones.js';

// 公共服务由系统自动建。玩家只画公共用地，不放建筑，也不做水管和电线。
// 选址：每次找出当前覆盖最差的住宅，选离它道路距离最近、能放下的位置。
// 位置的优先级：先用公共用地，没有时用连着道路且未划分的空地；永远不占已划分区和已有建筑的地。
// 两处都没有时记一条"缺少用地"，由界面提示玩家。

export const SERVICES = [
  {
    id: 'hospital',
    name: '医院',
    radius: 18,
    specs: [
      [3, 3],
      [2, 3],
      [3, 2],
    ],
  },
  {
    id: 'school',
    name: '学校',
    radius: 13,
    specs: [
      [3, 3],
      [2, 3],
      [3, 2],
      [2, 2],
    ],
  },
  {
    id: 'police',
    name: '警察局',
    radius: 14,
    specs: [
      [2, 2],
      [1, 2],
      [2, 1],
    ],
  },
  {
    id: 'fire',
    name: '消防站',
    radius: 14,
    specs: [
      [2, 2],
      [1, 2],
      [2, 1],
    ],
  },
  {
    id: 'water',
    name: '水厂',
    radius: 60,
    specs: [
      [3, 3],
      [2, 3],
      [3, 2],
    ],
  },
  {
    id: 'power',
    name: '电厂',
    radius: 60,
    specs: [
      [3, 3],
      [2, 3],
      [3, 2],
    ],
  },
];

const MAX_INSTANCES = 8;

function sitesFor(service, { N, zones, cellOpen, nearRoad }, wantedZone) {
  const sites = [];
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      for (const [w, h] of service.specs) {
        let fits = nearRoad(x, y, w, h);
        for (let j = y; fits && j < y + h; j += 1) {
          for (let i = x; fits && i < x + w; i += 1) {
            fits = cellOpen(i, j) && zones[j * N + i] === wantedZone;
          }
        }
        if (fits) sites.push({ x, y, w, h, wantedZone });
      }
    }
  }
  return sites;
}

function roadNode(site, graph, N) {
  let best = -1;
  let bestDistance = Infinity;
  for (let y = site.y - 2; y < site.y + site.h + 2; y += 1) {
    for (let x = site.x - 2; x < site.x + site.w + 2; x += 1) {
      const node = graph.index.get(y * N + x);
      if (node === undefined) continue;
      const distance = Math.hypot(x + 0.5 - site.x - site.w / 2, y + 0.5 - site.y - site.h / 2);
      if (distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
  }
  return best;
}

function nearestSite(sites, fromWorst, graph, N) {
  let best = null;
  let bestDistance = Infinity;
  for (const site of sites) {
    const node = roadNode(site, graph, N);
    if (node < 0) continue;
    const distance = fromWorst[node];
    const area = site.w * site.h;
    if (
      distance < bestDistance - 1e-9 ||
      (best && Math.abs(distance - bestDistance) < 1e-9 && area > best.w * best.h)
    ) {
      best = { ...site, node };
      bestDistance = distance;
    }
  }
  return { best, bestDistance };
}

/** 依次为每种服务选址。返回选中的位置，shortages 属性是缺少用地的记录。 */
export function placeServices(input, tools, parcels) {
  const { N, roads } = input;
  const graph = buildGraph(roads, N);
  const demand = new Map();
  for (const parcel of parcels) {
    if (parcel.zone !== ZONE.residential || parcel.access < 0) continue;
    const node = graph.index.get(parcel.access);
    demand.set(node, (demand.get(node) ?? 0) + parcel.capacity);
  }
  const demandNodes = [...demand.keys()].sort((a, b) => a - b);
  const context = { ...tools, N, zones: input.zones };
  const placed = [];
  const shortages = [];

  for (const service of SERVICES) {
    const sources = [];
    for (let round = 0; round < MAX_INSTANCES; round += 1) {
      const reach = sources.length > 0 ? shortestPaths(graph, sources, true).distance : null;
      let worst = -1;
      let worstScore = -1;
      for (const node of demandNodes) {
        const distance = reach ? reach[node] : 1000;
        if (reach && distance <= service.radius) continue;
        const score = (Number.isFinite(distance) ? distance : 1000) * 1000 + demand.get(node);
        if (score > worstScore) {
          worstScore = score;
          worst = node;
        }
      }
      if (worst < 0) break;
      const fromWorst = shortestPaths(graph, [worst], true).distance;
      let choice = nearestSite(sitesFor(service, context, ZONE.public), fromWorst, graph, N);
      let tier = 'public';
      if (!choice.best) {
        choice = nearestSite(sitesFor(service, context, ZONE.none), fromWorst, graph, N);
        tier = 'unzoned';
      }
      if (!choice.best) {
        shortages.push({ service: service.id, name: service.name });
        break;
      }
      if (reach && reach[worst] <= choice.bestDistance) break;
      tools.placeService(service, choice.best);
      sources.push(choice.best.node);
      placed.push({ service: service.id, node: choice.best.node, tier });
    }
  }
  placed.shortages = shortages;
  return placed;
}

/** 每个住宅地块能被哪些服务覆盖。盲区是至少缺一种服务的住宅。 */
export function coverageOf(parcels, placed, roads, N) {
  const graph = buildGraph(roads, N);
  const reachByService = new Map();
  for (const service of SERVICES) {
    const sources = placed
      .filter((entry) => entry.service === service.id)
      .map((entry) => entry.node);
    reachByService.set(
      service.id,
      sources.length > 0 ? shortestPaths(graph, sources, true).distance : null,
    );
  }
  const rows = [];
  let population = 0;
  let blind = 0;
  const missingByService = Object.fromEntries(SERVICES.map((service) => [service.id, 0]));
  for (const parcel of parcels) {
    if (parcel.zone !== ZONE.residential || parcel.access < 0) continue;
    const node = graph.index.get(parcel.access);
    const missing = SERVICES.filter((service) => {
      const reach = reachByService.get(service.id);
      return !reach || reach[node] > service.radius;
    }).map((service) => service.id);
    population += parcel.capacity;
    if (missing.length > 0) blind += parcel.capacity;
    for (const id of missing) missingByService[id] += parcel.capacity;
    rows.push({ parcel: parcel.id, missing });
  }
  return {
    rows,
    population,
    blind,
    blindShare: population > 0 ? blind / population : 0,
    missingByService,
  };
}
