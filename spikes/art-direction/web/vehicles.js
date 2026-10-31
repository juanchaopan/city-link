import { Particle, ParticleContainer, Rectangle } from 'pixi.js';
import { createFleet } from './sim/fleet.js';
import { screenOf } from './world.js';

// 把车流和红绿灯画出来。模拟在 sim/fleet.js，这里只管粒子。
// 地面的车画在物体层下面，所以楼能挡住身后的车；高架和匝道上的车画在物体层上面。

const LIGHTS = { green: 0x45e07a, yellow: 0xffc832, red: 0xff4438 };
const HIGH_CAP = 120;

function pool(atlas, count, area) {
  const key = 'car-0-0';
  const frame = atlas.frames[key];
  const container = new ParticleContainer({
    texture: atlas.textures[key],
    dynamicProperties: { position: true, rotation: false, uvs: true, vertex: true, color: true },
  });
  const free = [];
  for (let i = 0; i < count; i += 1) {
    const particle = new Particle({
      texture: atlas.textures[key],
      x: -1e5,
      y: -1e5,
      anchorX: frame.ax / frame.w,
      anchorY: frame.ay / frame.h,
    });
    particle.alpha = 0;
    container.addParticle(particle);
    free.push(particle);
  }
  container.boundsArea = area;
  return { container, free };
}

function hide(particle) {
  particle.alpha = 0;
  particle.x = -1e5;
}

export function createVehicles(atlas, city, scene, { cap, full = false }) {
  const { N } = city;
  const highCap = Math.min(HIGH_CAP, cap);
  const fleet = createFleet(city, { cap, full, highCap });
  const area = new Rectangle(-N * 80, -400, N * 160, N * 80 + 800);
  const groundPool = pool(atlas, (cap + 8) * 2, area);
  const highPool = pool(atlas, (highCap + 8) * 2, area);
  scene.world.addChildAt(groundPool.container, 1);
  scene.world.addChild(highPool.container);

  const staticParticle = (key, sx, sy) => {
    const frame = atlas.frames[key];
    return new Particle({
      texture: atlas.textures[key],
      x: sx,
      y: sy,
      anchorX: frame.ax / frame.w,
      anchorY: frame.ay / frame.h,
    });
  };
  const staticLayer = (key) => {
    const layer = new ParticleContainer({
      texture: atlas.textures[key],
      dynamicProperties: {
        position: false,
        rotation: false,
        uvs: false,
        vertex: false,
        color: true,
      },
    });
    layer.boundsArea = area;
    return layer;
  };
  const poleLayer = staticLayer('pole');
  const lampLayer = staticLayer('lamp');
  const poleParticles = [];
  const lamps = fleet.signals.map((signal) => {
    const { sx, sy } = screenOf(signal.px, signal.py, signal.level);
    const pole = staticParticle('pole', sx, sy);
    const particle = staticParticle('lamp', sx, sy);
    poleLayer.addParticle(pole);
    lampLayer.addParticle(particle);
    poleParticles.push(pole);
    return { signal, particle };
  });
  if (lamps.length > 0) {
    scene.world.addChildAt(poleLayer, 2);
    scene.world.addChildAt(lampLayer, 3);
  }

  let glow = 0;
  let tint = 0xffffff;
  const poolOf = (high) => (high ? highPool : groundPool);
  const release = (slot) => {
    hide(slot.body);
    hide(slot.light);
    poolOf(slot.high).free.push(slot.body, slot.light);
  };
  const acquire = (high) => {
    const { free } = poolOf(high);
    return { high, body: free.pop(), light: free.pop() };
  };

  const draw = (car) => {
    if (!car.slot || car.slot.high !== car.high) {
      if (car.slot) release(car.slot);
      car.slot = acquire(car.high);
    }
    const { sx, sy } = screenOf(car.x, car.y, car.h);
    const key = car.bus
      ? `bus-${String(car.rotation)}`
      : `car-${String(car.color)}-${String(car.rotation)}`;
    const { body, light } = car.slot;
    const frame = atlas.frames[key];
    body.texture = atlas.textures[key];
    body.anchorX = frame.ax / frame.w;
    body.anchorY = frame.ay / frame.h;
    body.x = sx;
    body.y = sy;
    body.alpha = 1;
    body.tint = tint;
    const glowKey = `${key}~g`;
    if (glow > 0.02 && atlas.frames[glowKey]) {
      const lit = atlas.frames[glowKey];
      light.texture = atlas.textures[glowKey];
      light.anchorX = lit.ax / lit.w;
      light.anchorY = lit.ay / lit.h;
      light.x = sx;
      light.y = sy;
      light.alpha = glow;
    } else hide(light);
  };

  return {
    step(dt) {
      fleet.step(dt);
      for (const car of fleet.removed.splice(0)) if (car.slot) release(car.slot);
      for (const car of fleet.cars) if (car.x !== undefined) draw(car);
      for (const { signal, particle } of lamps) particle.tint = LIGHTS[fleet.lightOf(signal)];
    },
    setView: fleet.setView,
    setTime(nextTint, nextGlow) {
      tint = nextTint;
      glow = nextGlow;
      for (const particle of poleParticles) particle.tint = tint;
    },
    count: fleet.count,
    wanted: fleet.wanted,
    signals: lamps.length,
    stopped: fleet.stopped,
  };
}
