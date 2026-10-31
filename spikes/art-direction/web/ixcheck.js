import { FAILURES, inspectEntry, maskScenes, rounded } from './ixchecks.js';
import { IX_SCENES, ixTown } from './ixscenes.js';
import './ixsheets.js';
import { CLASS, worldOfCity } from './roadscene.js';
import { generateCity } from './sim/city.js';
import { ELEVATED, template } from './sim/interchange.js';

// 立交验收的入口。模板在一块平地上单独查；默认城市只拼高架和丁字立交所在的那一块，整张遮罩内存不够。
// 默认城市里丁字立交、高架的头和中段的匝道走同一组检查，主线另外逐格查：
// 桥墩底部不在路面上，路格里不立桥墩，跨街时净空够，主线下面没有物业。

const MIN_CLEARANCE = 1;
const CITY_MARGIN = 7;

function checkViaductCells(city, scene) {
  const { N, viaduct, parcels } = city;
  const result = {
    cells: viaduct.cells.length,
    piersOnRoad: 0,
    lowOverRoad: 0,
    lotsUnder: 0,
    examples: [],
  };
  for (const { x, y, h0, h1, pier } of viaduct.cells) {
    const onRoad = city.roads.has(y * N + x);
    if (onRoad && Math.min(h0, h1) < MIN_CLEARANCE) {
      result.lowOverRoad += 1;
      result.examples.push(['净空', x, y, rounded(h0), rounded(h1)]);
    }
    if (!pier) continue;
    const [sx, sy] = scene.place.at(x + 0.5, y + 0.5, 0);
    if (onRoad || scene.read(Math.round(sx), Math.round(sy)) !== CLASS.empty) {
      result.piersOnRoad += 1;
      result.examples.push(['主线桥墩', x, y]);
    }
  }
  const main = new Set(viaduct.cells.map(({ x, y }) => y * N + x));
  for (const parcel of parcels.parcels) {
    if ((parcel.cells ?? []).some((cell) => main.has(cell))) result.lotsUnder += 1;
  }
  return result;
}

function cityEntries() {
  const city = generateCity(64);
  const town = {
    ...worldOfCity(city, false),
    objects: city.objects.filter(({ key }) => /^(ixp|ev|pr)-/.test(key)),
    low: city.lowDecks,
    traffic: city.traffic,
    lanes: city.lanes,
    busStops: city.busStops,
  };
  const { x, row, top, terminal } = city.viaduct.route;
  const { interchange } = city.plan;
  const region = [
    x - CITY_MARGIN,
    top - CITY_MARGIN,
    interchange.cx + CITY_MARGIN,
    terminal + CITY_MARGIN,
  ];
  const scenes = maskScenes(town, region);
  const lanesOf = (prefix) => city.lanes.filter(({ id }) => id.startsWith(prefix));
  const entries = [
    {
      name: 'sidediamond',
      cx: x,
      cy: row,
      town,
      axis: (y) => [x + 0.5, y, ELEVATED],
      lanes: [...lanesOf('sidediamond'), ...lanesOf('vs'), ...lanesOf('vn')],
    },
    {
      name: 'spur',
      cx: x,
      cy: top,
      town,
      axis: (px) => [px, top + 0.5, 0],
      lanes: lanesOf('spur'),
    },
    {
      name: 'tee',
      cx: interchange.cx,
      cy: interchange.cy,
      town,
      axis: (px) => [px, interchange.cy + 0.5, 0],
      lanes: lanesOf('tee'),
    },
  ];
  return { city, entries, scenes };
}

window.runIxChecks = () => {
  const rows = Object.keys(IX_SCENES).map((name) => {
    const entry = ixTown(name);
    return { name, ...inspectEntry(entry, template(name).ramps(), maskScenes(entry.town)) };
  });
  return { rows, cells: null, failures: FAILURES };
};

window.runIxCity = () => {
  const { city, entries, scenes } = cityEntries();
  const rows = entries.map((entry) => ({
    name: `默认城市·${entry.name}`,
    ...inspectEntry(entry, template(entry.name).ramps(), scenes),
  }));
  return { rows, cells: checkViaductCells(city, scenes.ground), failures: FAILURES };
};

window.ixReady = true;
