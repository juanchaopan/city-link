// 按类别统计图集面积和压缩率，再推算全部素材的数量和大小。
import { readFileSync, statSync, writeFileSync } from 'node:fs';

const ids = ['sunny', 'maquette', 'dusk'];
const GROUPS = {
  g: '地表',
  m: '地表',
  w: '河岸水面',
  b: '河岸水面',
  sk: '底座',
  r: '线路',
  rs: '线路',
  br: '线路',
  car: '车船',
  bus: '车船',
  boat: '车船',
  dock: '码头',
  forest: '树',
};
const PACKING = 0.7;
const plan = [
  { name: '地形、线路和水运（ADR 估算）', count: 277, per: '线路' },
  { name: '高速互通口', count: 24, per: '线路' },
  { name: '分区建筑：4 类 × 3 档 × 4 种', count: 48, per: '建筑' },
  { name: '公共服务、水电、车站、机场、港口', count: 40, per: '建筑' },
  { name: '树和车船', count: 40, per: '树' },
];

const report = {};
for (const id of ids) {
  const frames = JSON.parse(readFileSync(`out/atlas-${id}.json`, 'utf8'));
  const groups = {};
  let pixels = 0;
  for (const [key, frame] of Object.entries(frames)) {
    const name = GROUPS[key.split('-')[0]] ?? '建筑';
    const group = (groups[name] ??= { count: 0, pixels: 0 });
    group.count += 1;
    group.pixels += frame.w * frame.h;
    pixels += frame.w * frame.h;
  }
  const bytes = statSync(`out/atlas-${id}.png`).size;
  const bytesPerPixel = bytes / pixels;
  const rows = plan.map(({ name, count, per }) => {
    const sample = groups[per];
    const area = count * (sample.pixels / sample.count);
    return { name, count, pixels: area, mb: (area * bytesPerPixel) / 1048576 };
  });
  const totalMb = rows.reduce((sum, row) => sum + row.mb, 0);
  const totalPixels = rows.reduce((sum, row) => sum + row.pixels, 0);
  report[id] = {
    sprites: Object.keys(frames).length,
    pngMb: bytes / 1048576,
    atlasPixels: pixels,
    bytesPerPixel,
    groups,
    estimate: rows,
    totalCount: rows.reduce((sum, row) => sum + row.count, 0),
    totalMb,
    textureMb: ((totalPixels / PACKING) * 4 * 1.33) / 1048576,
    textureMbHalfRes: ((totalPixels / PACKING / 4) * 4 * 1.33) / 1048576,
  };
  console.log(
    id,
    JSON.stringify({
      sprites: report[id].sprites,
      pngMb: report[id].pngMb.toFixed(2),
      totalCount: report[id].totalCount,
      totalMb: totalMb.toFixed(1),
      textureMb: report[id].textureMb.toFixed(0),
      textureMbHalfRes: report[id].textureMbHalfRes.toFixed(0),
    }),
  );
}
writeFileSync('out/budget-report.json', JSON.stringify(report, null, 2));
