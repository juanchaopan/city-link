// 128×128 试验，只测量，不改任何规格。node --max-old-space-size=900 scripts/big.js
// 量生成时间、街区划分时间、物体和精灵数、堆内存、存档大小的估算，写到 out/big-report.json。
// 帧率在浏览器里量：先用 BIG=1 node scripts/gen.js sunny 烘进 128 用到的精灵，再 BIG=1 FPS=1 node scripts/shots.js。
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { generateCity, keysOf } from '../web/sim/city.js';

const SIZES = [64, 128];
const VIEW_WIDTH = 390;
const VIEW_HEIGHT = 844;
const DEFAULT_ZOOM = { 64: 0.078, 128: 0.04 };

/** 存档里要留的东西：路网、分区和物业，别的都能重新生成。 */
function saveBytes(city) {
  const state = {
    roads: [...city.roads.entries()].map(([id, { road, highway, arterial }]) => [
      id,
      road,
      highway,
      arterial,
    ]),
    parcels: city.parcels.parcels.map((parcel) => [
      parcel.id,
      parcel.zone,
      parcel.level,
      parcel.shape,
      parcel.use,
      parcel.spanU,
      parcel.spanV,
      parcel.orient,
      parcel.variant,
    ]),
  };
  const zones = Buffer.from(city.zones);
  const text = Buffer.from(JSON.stringify(state));
  return {
    rawKb: Math.round((text.length + zones.length) / 1024),
    gzipKb: Math.round(deflateSync(Buffer.concat([text, zones])).length / 1024),
  };
}

/** 默认视野里的精灵数：地面、路面和物体，按屏幕范围数。 */
function spritesInView(city, zoom) {
  const halfW = VIEW_WIDTH / 2 / zoom;
  const halfH = VIEW_HEIGHT / 2 / zoom;
  const center = city.N / 2;
  const inView = (x, y) =>
    Math.abs((x - y) * 64) < halfW && Math.abs((x + y - 2 * center) * 32) < halfH;
  const cells = [
    ...city.ground,
    ...city.overlays,
    ...city.walks,
    ...city.curbs,
    ...city.decks,
    ...city.marks,
  ];
  const ground = cells.filter(({ x, y }) => inView(x, y)).length;
  const objects = city.objects.reduce(
    (sum, { px, py, modules }) => sum + (inView(px, py) ? (modules?.length ?? 1) : 0),
    0,
  );
  return { ground, objects, total: ground + objects };
}

const report = {};
for (const N of SIZES) {
  globalThis.gc?.();
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  const city = generateCity(N);
  const ms = performance.now() - started;
  const { stats } = city.parcels.partition;
  report[N] = {
    generateMs: Math.round(ms),
    partitionMs: Math.round(stats.millis),
    enumerated: stats.enumerated,
    heapMb: Math.round((process.memoryUsage().heapUsed - before) / 1048576),
    parcels: city.parcels.parcels.length,
    roads: city.roads.size,
    objects: city.objects.length,
    junctions: city.junctions.clusters.length,
    rings: city.rings.length,
    blockedRings: city.blockedRings.length,
    distinctSprites: new Set(keysOf(city)).size,
    view: spritesInView(city, DEFAULT_ZOOM[N]),
    save: saveBytes(city),
  };
  console.log(N, JSON.stringify(report[N]));
}
writeFileSync('out/big-report.json', JSON.stringify(report, null, 2));
