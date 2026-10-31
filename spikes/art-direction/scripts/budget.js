// 按实测的每类精灵面积和 PNG 压缩率，推算全部素材的数量、图集和纹理内存。
import { readFileSync, writeFileSync } from 'node:fs';

const gen = JSON.parse(readFileSync('out/gen-report.json', 'utf8'));
const PACKING = 0.7;
const MIPMAP = 1.33;
const PAGE = 2048;

const groups = gen.sunny.groups;
const average = (name) => groups[name].pixels / groups[name].count;
const pngPerPixel =
  gen.dayOnly.pngBytes /
  Object.entries(gen.dayOnly.groups).reduce((sum, [, group]) => sum + group.pixels, 0);

const footprints = { axis: 9, diagonal: 12, triangle: 12 };
const zones = 3;

function plan(levels, variants, label) {
  const rows = [
    { name: '地形、线路和水运（ADR 估算）', count: 277, area: average('线路') },
    { name: '高速互通口', count: 24, area: average('线路') * 2 },
    { name: `直角物业：9 规格 × ${String(zones)} 分区 × ${String(levels)} 等级 × ${String(variants)} 变体`, count: footprints.axis * zones * levels * variants, area: average('直角物业') },
    { name: `斜向物业：12 规格朝向 × ${String(zones)} × ${String(levels)} × ${String(variants)}`, count: footprints.diagonal * zones * levels * variants, area: average('斜向物业') },
    { name: `大三角物业：3 尺寸 × 4 朝向 × ${String(zones)} × ${String(levels)} × ${String(variants)}`, count: footprints.triangle * zones * levels * variants, area: average('大三角物业') },
    { name: '小三角、公园广场、农田', count: 60, area: average('小三角') },
    { name: '公共服务：6 种 × 3 规格', count: 18, area: average('公共服务') },
    { name: '车站、机场、港口（估算）', count: 40, area: average('公共服务') * 1.4 },
    { name: '树和车船', count: 40, area: average('树') },
  ];
  const count = rows.reduce((sum, row) => sum + row.count, 0);
  const pixels = rows.reduce((sum, row) => sum + row.count * row.area, 0);
  const glowShare = gen.sunny.pngBytes / gen.dayOnly.pngBytes;
  const pngMb = (pixels * pngPerPixel * glowShare) / 1048576;
  const pages = Math.ceil(pixels / PACKING / (PAGE * PAGE));
  return {
    label,
    count,
    pixels,
    pngMb,
    pages2048: pages,
    textureMb: ((pixels / PACKING) * 4 * MIPMAP) / 1048576,
    rows,
  };
}

const full = plan(3, 3, '完整组合');
const pruned = plan(2, 2, '裁剪组合：每个规格只保留合理等级，2 个变体');

// 模块拼装：墙面、屋顶、地块铺装拆成部件，运行时一栋楼由多个精灵组成。
const buildings = 1349;
const piecesPerBuilding = 9;
const pieceCount = 420;
const pieceArea = 900;
const modular = {
  label: '模块拼装（推算，没有制作）',
  count: 277 + 24 + 60 + 58 + 40 + pieceCount,
  pixels:
    (277 + 24) * average('线路') +
    60 * average('小三角') +
    58 * average('公共服务') +
    40 * average('树') +
    pieceCount * pieceArea,
  extraSpritesAt64: buildings * (piecesPerBuilding - 1),
};
modular.pngMb = (modular.pixels * pngPerPixel) / 1048576;
modular.textureMb = ((modular.pixels / PACKING) * 4 * MIPMAP) / 1048576;

// 放大发虚：高清层只给建筑和近景，放在单独的包里，只有放大时才下载。
const hires = {
  doubleEverythingPngMb: pruned.pngMb * 3,
  doubleEverythingTextureMb: pruned.textureMb * 4,
  buildingsOnlyPngMb: pruned.pngMb * 0.75 * 3,
  sharpZoomNow: 0.5,
  sharpZoomDoubled: 1,
};

const report = { pngPerPixel, full, pruned, modular, hires, sample: { sunny: gen.sunny.pngBytes, dayOnly: gen.dayOnly.pngBytes, dusk: gen.dusk.pngBytes, festival: gen.festival } };
writeFileSync('out/budget-report.json', JSON.stringify(report, null, 2));
const summary = (entry) => ({ count: entry.count, pngMb: Number(entry.pngMb.toFixed(1)), textureMb: Number(entry.textureMb.toFixed(0)), pages2048: entry.pages2048 });
console.log('完整组合', JSON.stringify(summary(full)));
console.log('裁剪组合', JSON.stringify(summary(pruned)));
console.log('模块拼装', JSON.stringify({ ...summary(modular), extraSprites: modular.extraSpritesAt64 }));
console.log('高清', JSON.stringify(hires));
console.log('样本', JSON.stringify({ sunnyMb: gen.sunny.pngBytes / 1048576, dayOnlyMb: gen.dayOnly.pngBytes / 1048576, duskMb: gen.dusk.pngBytes / 1048576, festivalKb: gen.festival.pngBytes / 1024, festivalCount: gen.festival.count }));
