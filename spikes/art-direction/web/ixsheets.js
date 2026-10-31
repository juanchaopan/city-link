import { palettes } from './kit/palettes.js';
import { IX_SCENES, ixTown } from './ixscenes.js';
import { pasteCrop, pngData, renderTown } from './townrender.js';

// 立交验收的样张：每种立交一张全景加四张放大，匝道开口两种放大倍数，匝道上的车。

const PANEL = { w: 760, h: 500 };

function blank(width, height) {
  const sheet = new OffscreenCanvas(width, height);
  const context = sheet.getContext('2d');
  context.fillStyle = '#20303a';
  context.fillRect(0, 0, width, height);
  return { sheet, context };
}

window.renderIxSheet = (name) => {
  const entry = ixTown(name);
  const { canvas, place } = renderTown(entry.town, { cars: 60 });
  const { sheet, context } = blank(PANEL.w * 3 + 40, PANEL.h * 2 + 30);
  const centerOf = ([x, z]) => place.at(entry.cx + 0.5 + x, entry.cy + 0.5 + z, 0);
  const whole = { x: 10, y: 10, w: PANEL.w, h: PANEL.h * 2 + 10 };
  pasteCrop(context, canvas, centerOf([0, 0]), whole, 0.56, `${name} 全景`);
  Object.entries(entry.spots).forEach(([label, spot], index) => {
    const box = {
      x: 20 + PANEL.w + (index % 2) * (PANEL.w + 10),
      y: 10 + Math.floor(index / 2) * (PANEL.h + 10),
      w: PANEL.w,
      h: PANEL.h,
    };
    pasteCrop(context, canvas, centerOf(spot), box, 1.6, label);
  });
  return pngData(sheet);
};

/** 匝道开口的两种放大：同一处开口 2 倍和 4 倍。 */
window.renderMergeSheet = () => {
  const names = Object.keys(IX_SCENES);
  const { sheet, context } = blank(
    PANEL.w * 4 + 50,
    PANEL.h * names.length + 10 * (names.length + 1),
  );
  names.forEach((name, row) => {
    const entry = ixTown(name);
    const { canvas, place } = renderTown(entry.town, { cars: 30, palette: palettes.sunny });
    const level = name === 'diamond' ? 1.5 : 0;
    const centerOf = ([x, z]) => place.at(entry.cx + 0.5 + x, entry.cy + 0.5 + z, level);
    const list = [
      ['分流', 2],
      ['分流', 4],
      ['合流', 2],
      ['合流', 4],
    ];
    list.forEach(([label, scale], index) => {
      const box = {
        x: 10 + index * (PANEL.w + 10),
        y: 10 + row * (PANEL.h + 10),
        w: PANEL.w,
        h: PANEL.h,
      };
      const title = `${name} ${label} ${String(scale)} 倍`;
      pasteCrop(context, canvas, centerOf(entry.spots[label]), box, scale, title);
    });
  });
  return pngData(sheet);
};

/** 匝道上的车：上坡、下坡和弯道。 */
window.renderRampCars = () => {
  const entry = ixTown('tee');
  const { canvas, place } = renderTown(entry.town, { cars: 120, warm: 900 });
  const spots = [
    ['上坡：四车道上桥', [0.2, 2], 0.4],
    ['下坡：绕环下到高速', [-3.4, -1.4], 0.3],
    ['弯道：环形匝道', [-1.4, -3], 0.8],
  ];
  const { sheet, context } = blank(PANEL.w * 3 + 40, PANEL.h + 20);
  spots.forEach(([label, [x, z], h], index) => {
    const box = { x: 10 + index * (PANEL.w + 10), y: 10, w: PANEL.w, h: PANEL.h };
    const center = place.at(entry.cx + 0.5 + x, entry.cy + 0.5 + z, h);
    pasteCrop(context, canvas, center, box, 2.5, label);
  });
  return pngData(sheet);
};
