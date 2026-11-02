import { Particle } from 'pixi.js';
import { carItem } from './sim/drawlist.js';
import { createFleet } from './sim/fleet.js';
import { screenOf } from './world.js';

// 把车流和红绿灯画出来。模拟在 sim/fleet.js，这里只管粒子。
// 车不分图层：每帧按车身占地和高度插进场景的绘制序列，路口里的车、桥下的车和匝道上的车都走同一条规则。
// 精灵只有 8 个方向，运行时再旋转到路面走向，这样不用多烘焙精灵，上坡、下坡和弯道都对得上。
// 精灵的锚点在车轮接地点，车身比它高，画面上看车偏向路的一侧，所以往下挪半个车身，车看起来走在车道中间。
// 缩小到鸟瞰比例时不画车：视野设到地图外面，车流在一帧里全部回收，之后不再模拟，静态物体照常画。

const LIGHTS = { green: 0x45e07a, yellow: 0xffc832, red: 0xff4438 };
const HIGH_CAP = 120;
const NOWHERE = { left: 1e9, right: 1e9 + 1, top: 1e9, bottom: 1e9 + 1 };
export const BODY_DROP = 3;

function newParticle(atlas) {
  const key = 'car-0-0';
  const frame = atlas.frames[key];
  return new Particle({
    texture: atlas.textures[key],
    x: -1e5,
    y: -1e5,
    anchorX: frame.ax / frame.w,
    anchorY: frame.ay / frame.h,
  });
}

export function createVehicles(atlas, city, scene, { cap, full = false }) {
  const highCap = Math.min(HIGH_CAP, cap);
  const fleet = createFleet(city, { cap, full, highCap });
  const free = [];
  for (let i = 0; i < (cap + 16) * 2; i += 1) free.push(newParticle(atlas));

  let glow = 0;
  let tint = 0xffffff;
  let frameMs = 0;
  let shown = true;

  const setSprite = (particle, key, sx, sy, rotation) => {
    const frame = atlas.frames[key];
    particle.texture = atlas.textures[key];
    particle.anchorX = frame.ax / frame.w;
    particle.anchorY = frame.ay / frame.h;
    particle.x = sx;
    particle.y = sy + BODY_DROP;
    particle.rotation = rotation;
  };

  const draw = (car) => {
    car.slot ??= { body: free.pop(), light: free.pop() };
    const { sx, sy } = screenOf(car.x, car.y, car.h);
    const key = car.bus
      ? `bus-${String(car.rotation)}`
      : `car-${String(car.color)}-${String(car.rotation)}`;
    const { body, light } = car.slot;
    setSprite(body, key, sx, sy, car.tilt);
    body.tint = tint;
    const item = carItem(car, fleet.lengthOf(car) / 2, screenOf);
    item.particles = [body];
    const glowKey = `${key}~g`;
    if (glow > 0.02 && atlas.frames[glowKey]) {
      setSprite(light, glowKey, sx, sy, car.tilt);
      light.alpha = glow;
      item.particles.push(light);
    }
    return item;
  };

  return {
    step(dt) {
      if (!shown && fleet.count() === 0) return;
      fleet.step(dt);
      for (const car of fleet.removed.splice(0)) {
        if (car.slot) free.push(car.slot.body, car.slot.light);
      }
      const started = performance.now();
      const items = fleet.cars.filter((car) => car.x !== undefined).map(draw);
      scene.compose(items);
      frameMs = performance.now() - started;
      for (const { signal, phase, particle } of scene.lamps) {
        particle.tint = LIGHTS[fleet.lightOf({ signal, phase })];
      }
    },
    /** box 为空时是鸟瞰：车全部回收，之后这一层只画静态物体。 */
    setView(box) {
      shown = Boolean(box);
      fleet.setView(box ?? NOWHERE);
      if (!shown) scene.compose([]);
    },
    setTime(nextTint, nextGlow) {
      tint = nextTint;
      glow = nextGlow;
    },
    cars: fleet.cars,
    count: fleet.count,
    wanted: fleet.wanted,
    signals: fleet.signals.length,
    stopped: fleet.stopped,
    sortMs: () => frameMs,
  };
}
