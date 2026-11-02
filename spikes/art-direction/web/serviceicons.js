import { Particle, ParticleContainer, Rectangle } from 'pixi.js';
import { screenOf } from './world.js';

// 公共服务的图标牌。图标在建筑上空，屏幕大小基本不变：放大看时缩小，不抢建筑的戏。
// 只有公共服务有图标，普通物业没有，所以它本身就是公共服务的标记。
// 全城视角下几十张图标会盖住城市，所以城市视图缩小到 minZoom 以下不显示，公共服务视图一直显示，鸟瞰时换小一号。
// 缩小时相邻的图标会叠在一起，每次换缩放都做一遍避让：屏幕上叠着的两张沿连线推开，推到不叠为止，
// 每张最多离开自己的建筑 MAX_DRIFT 个图标那么远；放大后图标之间本来就有距离，位置回到建筑正上方。

const SCREEN_SIZE = 26;
const OVERVIEW_SIZE = 14;
const OVERVIEW_ZOOM = 0.2;
const MIN_SCALE = 0.42;
const MAX_DRIFT = 3;
const ROUNDS = 24;

const screenSize = (zoom) => (zoom < OVERVIEW_ZOOM ? OVERVIEW_SIZE : SCREEN_SIZE);

export function createServiceIcons(atlas, city, { minZoom = 0 } = {}) {
  const { N, icons = [] } = city;
  const layer = new ParticleContainer({
    texture: atlas.textures[`si-${icons[0]?.use ?? 'hospital'}`],
    dynamicProperties: { position: true, rotation: false, uvs: false, vertex: true, color: false },
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
    return { particle, size: frame.w, sx, sy };
  });

  /** 屏幕坐标下推开叠着的图标。返回每张图标的屏幕位置。 */
  const spread = (zoom) => {
    const size = screenSize(zoom);
    const spots = particles.map(({ sx, sy }) => ({ x: sx * zoom, y: sy * zoom }));
    const limit = size * MAX_DRIFT;
    for (let round = 0; round < ROUNDS; round += 1) {
      let moved = false;
      for (let i = 0; i < spots.length; i += 1) {
        for (let j = i + 1; j < spots.length; j += 1) {
          const dx = spots[j].x - spots[i].x;
          const dy = spots[j].y - spots[i].y;
          const distance = Math.hypot(dx, dy) || 0.01;
          const overlap = size - distance;
          if (overlap <= 0) continue;
          const ux = distance < 0.02 ? 1 : dx / distance;
          const uy = distance < 0.02 ? 0 : dy / distance;
          spots[i].x -= (ux * overlap) / 2;
          spots[i].y -= (uy * overlap) / 2;
          spots[j].x += (ux * overlap) / 2;
          spots[j].y += (uy * overlap) / 2;
          moved = true;
        }
      }
      for (let i = 0; i < spots.length; i += 1) {
        const ox = particles[i].sx * zoom;
        const oy = particles[i].sy * zoom;
        const away = Math.hypot(spots[i].x - ox, spots[i].y - oy);
        if (away > limit) {
          spots[i].x = ox + ((spots[i].x - ox) * limit) / away;
          spots[i].y = oy + ((spots[i].y - oy) * limit) / away;
        }
      }
      if (!moved) break;
    }
    return spots;
  };

  const setZoom = (zoom) => {
    layer.visible = zoom >= minZoom;
    if (!layer.visible) return;
    const spots = spread(zoom);
    particles.forEach(({ particle, size }, index) => {
      const scale = Math.max(
        MIN_SCALE * (screenSize(zoom) / SCREEN_SIZE),
        screenSize(zoom) / size / zoom,
      );
      particle.scaleX = scale;
      particle.scaleY = scale;
      particle.x = spots[index].x / zoom;
      particle.y = spots[index].y / zoom;
    });
    layer.update();
  };

  /** 屏幕上两两之间最近的距离，检查避让用。 */
  const nearest = (zoom) => {
    const spots = spread(zoom);
    let best = Infinity;
    for (let i = 0; i < spots.length; i += 1) {
      for (let j = i + 1; j < spots.length; j += 1)
        best = Math.min(best, Math.hypot(spots[j].x - spots[i].x, spots[j].y - spots[i].y));
    }
    return best;
  };

  return { layer, setZoom, nearest, count: particles.length, size: SCREEN_SIZE };
}
