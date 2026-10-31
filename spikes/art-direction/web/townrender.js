import { palettes } from './kit/palettes.js';
import { compose, spriteOf } from './roadscene.js';
import { carItem, createDrawList, mergedSequence } from './sim/drawlist.js';
import { createFleet } from './sim/fleet.js';
import { sceneItems } from './sim/sceneitems.js';

// 验收样张共用的成品渲染：地面、路面、标记，然后是建筑、灯杆、桥面和车，这一段的顺序和游戏里同一套算法。

const DT = 0.05;
const LIGHTS = { green: '#45e07a', yellow: '#ffc832', red: '#ff4438' };
const LAST_LIT_DIRECTION = 2;

/** 可重复的随机数，同一个场景每次跑的结果一样。 */
export function randomFrom(seed) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

function carKey(car) {
  return `${car.bus ? 'bus' : `car-${String(car.color)}`}-${String(car.rotation)}`;
}

const screenOf = (px, py, level) => ({
  sx: (px - py) * 64,
  sy: (px + py - 1) * 32 - level * 32,
});

const frameOf = (palette) => (key) => {
  const { canvas, ax, ay } = spriteOf(key, palette);
  return { w: canvas.width, h: canvas.height, ax, ay };
};

/** 白色灯面染成当前的灯色。 */
function tinted(sprite, color) {
  const canvas = new OffscreenCanvas(sprite.canvas.width, sprite.canvas.height);
  const context = canvas.getContext('2d');
  context.drawImage(sprite.canvas, 0, 0);
  context.globalCompositeOperation = 'multiply';
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(sprite.canvas, 0, 0);
  return { canvas, ax: sprite.ax, ay: sprite.ay };
}

export function renderTown(town, { palette = palettes.sunny, cars = 40, warm = 500, busShare } = {}) {
  const { canvas, context, place } = compose(town, palette, 'current', { withGround: true });
  const draw = (sprite, px, py, level, tilt = 0) => {
    const [sx, sy] = place.at(px, py, level);
    context.save();
    context.translate(Math.round(sx), Math.round(sy));
    context.rotate(tilt);
    context.drawImage(sprite.canvas, -sprite.ax, -sprite.ay);
    context.restore();
  };
  const stamp = (key, px, py, level, tilt) => draw(spriteOf(key, palette), px, py, level, tilt);
  for (const { key, x, y, level } of town.marks) stamp(key, x + 0.5, y + 0.5, level);

  const fleet = createFleet(town, { cap: cars, full: true, random: randomFrom(5), busShare });
  for (let i = 0; i < warm; i += 1) fleet.step(DT);
  const { sorted } = sceneItems(town, frameOf(palette));
  const list = createDrawList(sorted);
  const items = fleet.cars
    .filter((car) => car.x !== undefined)
    .map((car) => carItem(car, fleet.lengthOf(car) / 2, screenOf));
  for (const item of mergedSequence(sorted, list.placeCars(items))) {
    if (item.car) {
      const { car } = item;
      stamp(carKey(car), car.x, car.y, car.h, car.tilt);
    } else {
      stamp(item.key, item.px, item.py, item.level);
      if (item.signal !== undefined && item.dir <= LAST_LIT_DIRECTION) {
        const lamp = spriteOf(`lamp-${String(item.dir)}`, palette);
        draw(tinted(lamp, LIGHTS[fleet.lightOf(item)]), item.px, item.py, item.level);
      }
    }
  }
  return { canvas, place };
}

export function pngData(sheet) {
  return sheet.convertToBlob({ type: 'image/png' }).then(
    (blob) =>
      new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      }),
  );
}

/** 从成品里裁一块放大贴到样张上，上面写一行字。 */
export function pasteCrop(context, source, [sx, sy], box, scale, label) {
  const { x, y, w, h } = box;
  context.imageSmoothingEnabled = false;
  context.drawImage(source, sx - w / scale / 2, sy - h / scale / 2, w / scale, h / scale, x, y, w, h);
  context.fillStyle = '#ffffff';
  context.font = '700 24px "Microsoft YaHei"';
  context.fillText(label, x + 8, y + 30);
}
