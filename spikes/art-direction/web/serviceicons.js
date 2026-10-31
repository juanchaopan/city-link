import { Particle, ParticleContainer, Rectangle } from 'pixi.js';
import { screenOf } from './world.js';

// 公共服务的图标牌。图标在建筑上空，屏幕大小基本不变：全图时放大到认得出来，放大看时缩小，不抢建筑的戏。
// 只有公共服务有图标，普通物业没有，所以它本身就是公共服务的标记。

const SCREEN_SIZE = 26;
const MIN_SCALE = 0.42;

export function createServiceIcons(atlas, city) {
  const { N, icons = [] } = city;
  const layer = new ParticleContainer({
    texture: atlas.textures[`si-${icons[0]?.use ?? 'hospital'}`],
    dynamicProperties: { position: false, rotation: false, uvs: false, vertex: true, color: false },
  });
  layer.boundsArea = new Rectangle(-N * 80, -400, N * 160, N * 80 + 800);
  const particles = icons.map(({ key, px, py, level }) => {
    const { sx, sy } = screenOf(px, py, level);
    const frame = atlas.frames[key];
    const particle = new Particle({
      texture: atlas.textures[key],
      x: sx,
      y: sy,
      anchorX: frame.ax / frame.w,
      anchorY: frame.ay / frame.h,
    });
    layer.addParticle(particle);
    return { particle, size: frame.w };
  });
  const setZoom = (zoom) => {
    for (const { particle, size } of particles) {
      const scale = Math.max(MIN_SCALE, SCREEN_SIZE / size / zoom);
      particle.scaleX = scale;
      particle.scaleY = scale;
    }
  };
  return { layer, setZoom, count: particles.length };
}
