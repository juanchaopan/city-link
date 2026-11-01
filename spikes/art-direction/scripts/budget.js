// 按实测的每类精灵面积和 PNG 压缩率，推算全部素材的数量、图集和纹理内存。
// 比较两种做法：每种外观整张烘焙，和底座、楼身、屋顶分开的模块拼装。外观数是规格的倍数，所以推算不依赖具体风格。
// 示例城市里没有斜向物业时，这一类的面积按直角物业算。
import { readFileSync, writeFileSync } from 'node:fs';

const gen = JSON.parse(readFileSync('out/gen-report.json', 'utf8'));
const PACKING = 0.7;
const MIPMAP = 1.33;
const LOOKS = 7;
const ZONES = 3;
const FOOTPRINTS = { axis: 9, diagonal: 8, triangle: 12 };
const PROPERTIES_AT_64 = 200;

const groups = gen.sunny.groups;
const average = (name, fallback = name) => {
  const group = groups[name] ?? groups[fallback];
  return group.pixels / group.count;
};
const pngPerPixel =
  gen.dayOnly.pngBytes /
  Object.values(gen.dayOnly.groups).reduce((sum, group) => sum + group.pixels, 0);
const glowFactor = gen.sunny.pngBytes / gen.dayOnly.pngBytes;

const shared = [
  { name: '地表、水面和河岸', count: 120, area: average('地表') },
  { name: '路面三层', count: 3 * 180, area: average('线路') },
  { name: '立交和高架', count: groups['立交'].count + groups['高架'].count, area: average('立交') },
  { name: '公共服务', count: 18, area: average('公共服务') },
  { name: '公共设施', count: groups['公共设施'].count, area: average('公共设施') },
  { name: '信号灯', count: groups['信号灯'].count, area: average('信号灯') },
  { name: '小品、树、车', count: 140, area: average('树') / 2 },
];

function totals(label, rows) {
  const count = rows.reduce((sum, row) => sum + row.count, 0);
  const pixels = rows.reduce((sum, row) => sum + row.count * row.area, 0);
  return {
    label,
    count,
    pixels,
    pngMb: (pixels * pngPerPixel * glowFactor) / 1048576,
    textureMb: ((pixels / PACKING) * 4 * MIPMAP) / 1048576,
    rows,
  };
}

const whole = totals(`整张烘焙：每规格每分区 ${String(LOOKS)} 种外观`, [
  ...shared,
  { name: '直角物业', count: FOOTPRINTS.axis * ZONES * LOOKS, area: average('直角物业') },
  {
    name: '斜向物业',
    count: FOOTPRINTS.diagonal * ZONES * LOOKS,
    area: average('斜向物业', '直角物业'),
  },
  { name: '大三角物业', count: FOOTPRINTS.triangle * ZONES * LOOKS, area: average('大三角物业') },
]);

const moduleRows = [
  {
    name: '底座：每个占地规格 3 种',
    count: (FOOTPRINTS.axis + FOOTPRINTS.diagonal + FOOTPRINTS.triangle) * 3,
    area: average('模块·底座'),
  },
  {
    name: '楼身：6 种楼型 × 5 种层数 × 3 档大小（配色用运行时染色）',
    count: 6 * 5 * 3,
    area: average('模块·楼身'),
  },
  { name: '屋顶：3 种 × 3 档大小', count: 9, area: average('模块·屋顶') },
];
const modular = totals('模块拼装：底座、楼身、屋顶分开', [...shared, ...moduleRows]);

const spritesPerProperty = { whole: 2, modular: 5 };
const onScreen = {
  whole: PROPERTIES_AT_64 * spritesPerProperty.whole,
  modular: PROPERTIES_AT_64 * spritesPerProperty.modular,
};

const report = {
  pngPerPixel,
  looks: LOOKS,
  whole,
  modular,
  moduleRows,
  onScreen,
  sample: {
    sunny: gen.sunny.pngBytes,
    dayOnly: gen.dayOnly.pngBytes,
    dusk: gen.dusk.pngBytes,
  },
};
writeFileSync('out/budget-report.json', JSON.stringify(report, null, 2));
const summary = (entry) => ({
  count: entry.count,
  pngMb: Number(entry.pngMb.toFixed(1)),
  textureMb: Number(entry.textureMb.toFixed(0)),
});
console.log('整张烘焙', JSON.stringify(summary(whole)));
console.log('模块拼装', JSON.stringify(summary(modular)));
console.log('同屏精灵', JSON.stringify(onScreen));
console.log(
  '样本',
  JSON.stringify({
    sunnyMb: gen.sunny.pngBytes / 1048576,
    dayOnlyMb: gen.dayOnly.pngBytes / 1048576,
    duskMb: gen.dusk.pngBytes / 1048576,
  }),
);
