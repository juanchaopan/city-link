import { Container, Graphics, Particle, ParticleContainer } from 'pixi.js';
import { DIRECTIONS, ROAD_SPEC, spokesOf } from './sim/network.js';
import { parcelRoutes } from './sim/traffic.js';

// 交通视图。路面按负荷染色，宽度就是路面宽度，形状贴着真实路形；高速、快速路、高架和匝道都在，高架画在它真实的高度上。
// 箭头沿着每个方向流动，流速表示拥堵：不堵时跑得快，接近饱和时几乎不动。箭头是一批粒子，全城一起动。
// 点一个物业才显示它的门到路的箭头，并把它的车走的路描出来，平时路面上没有这些线。

const LANE_OFFSET = { road: 0.115, arterial: 0.25, highway: 0.29 };
const FULL_LOAD = 0.8;
const FLOW_SPEED = 1.3;
const FLOW_MIN = 0.12;
const ARROW_SIZE = [34, 22];
const CHUNK = 1;
const HIGHLIGHT = 0xffffff;
const DOOR = 0x1f3a4d;
const HIGHLIGHT_ALPHA = 0.9;

function loadColor(ratio) {
  const load = Math.min(1, ratio / FULL_LOAD);
  if (load < 0.5) return (Math.round(70 + 340 * load) << 16) | (190 << 8) | 90;
  return (235 << 16) | (Math.round(190 - 340 * (load - 0.5)) << 8) | 50;
}

const flowSpeed = (ratio) => FLOW_SPEED * Math.max(FLOW_MIN, 1 - Math.min(1, ratio / FULL_LOAD));

/** 主线的一条车道占半幅路面，匝道就是一条车道。 */
const laneHalf = ({ kind }) => ROAD_SPEC[kind].deck / (kind === 'ramp' ? 2 : 4);

function arrowTexture(renderer) {
  const [w, h] = ARROW_SIZE;
  const g = new Graphics();
  g.poly([0, 0, w * 0.55, h / 2, 0, h, w * 0.3, h / 2]).fill(0xffffff);
  g.poly([w * 0.45, 0, w, h / 2, w * 0.45, h, w * 0.75, h / 2]).fill(0xffffff);
  return renderer.generateTexture(g);
}

function cellCenter(id, N) {
  return [(id % N) + 0.5, Math.floor(id / N) + 0.5];
}

export function createTrafficView({ city, renderer, screenOf }) {
  const { N, traffic, lanes = [] } = city;
  const heightAt = (x, y) => city.surface(x, y);
  const screen = (x, y, h = heightAt(x, y)) => {
    const { sx, sy } = screenOf(x, y, h);
    return [sx, sy];
  };
  const root = new Container();
  const deck = new Graphics();
  const marks = new Graphics();
  root.addChild(deck);

  /** 一段路面：a、b 是 [x, y, h]，half 是半宽，四个角分别换算成屏幕坐标。 */
  const quad = (g, a, b, half, color, alpha = 1) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = (-(b[1] - a[1]) / length) * half;
    const ny = ((b[0] - a[0]) / length) * half;
    const corners = [
      screen(a[0] + nx, a[1] + ny, a[2]),
      screen(b[0] + nx, b[1] + ny, b[2]),
      screen(b[0] - nx, b[1] - ny, b[2]),
      screen(a[0] - nx, a[1] - ny, a[2]),
    ];
    g.poly(corners.flat()).fill({ color, alpha });
  };

  const paintLine = (g, points, half, color, alpha) => {
    for (let i = 0; i < points.length - 1; i += 1)
      quad(g, points[i], points[i + 1], half, color, alpha);
  };

  const edgeLine = (edge) => {
    const a = cellCenter(edge.from, N);
    const b = cellCenter(edge.to, N);
    return [
      [...a, heightAt(...a)],
      [...b, heightAt(...b)],
    ];
  };
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const groundEdges = traffic.edges.filter((edge) => !edge.lanes);
  for (const edge of groundEdges)
    paintLine(deck, edgeLine(edge), ROAD_SPEC[edge.kind].deck / 2, loadColor(edge.ratio));
  for (const lane of lanes)
    paintLine(deck, lane.points, laneHalf(lane), loadColor(lane.ratio ?? 0));

  /** 路口格子填一块，几条路的颜色取其中最堵的。 */
  for (const id of city.roads.keys()) {
    const { road, highway } = city.roads.get(id);
    if (spokesOf(road | highway).length < 3) continue;
    const touching = groundEdges.filter(({ from, to }) => from === id || to === id);
    const worst = Math.max(...touching.map(({ ratio }) => ratio), 0);
    const [x, y] = cellCenter(id, N);
    const corners = DIRECTIONS.map(([dx, dy]) => {
      const length = Math.hypot(dx, dy);
      return screen(x + (dx / length) * 0.4, y + (dy / length) * 0.4);
    });
    deck.poly(corners.flat()).fill(loadColor(worst));
  }

  const tracks = [];
  const addTrack = (points, ratio) => {
    const flat = points.map(([x, y, h]) => screen(x, y, h));
    const along = [0];
    for (let i = 1; i < points.length; i += 1) {
      const [ax, ay] = points[i - 1];
      const [bx, by] = points[i];
      along.push(along[i - 1] + Math.hypot(bx - ax, by - ay));
    }
    const length = along[along.length - 1];
    tracks.push({
      points: flat,
      along,
      length,
      rate: flowSpeed(ratio) / length,
      phase: Math.random(),
    });
  };
  for (const edge of groundEdges) {
    const [a, b] = edgeLine(edge);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const offset = LANE_OFFSET[edge.kind];
    const nx = (-(b[1] - a[1]) / length) * offset;
    const ny = ((b[0] - a[0]) / length) * offset;
    addTrack(
      [
        [a[0] + nx, a[1] + ny, a[2]],
        [b[0] + nx, b[1] + ny, b[2]],
      ],
      edge.ratio,
    );
    addTrack(
      [
        [b[0] - nx, b[1] - ny, b[2]],
        [a[0] - nx, a[1] - ny, a[2]],
      ],
      edge.ratio,
    );
  }
  for (const lane of lanes) {
    let start = 0;
    let travelled = 0;
    for (let i = 1; i < lane.points.length; i += 1) {
      const [ax, ay] = lane.points[i - 1];
      const [bx, by] = lane.points[i];
      travelled += Math.hypot(bx - ax, by - ay);
      if (travelled >= CHUNK || i === lane.points.length - 1) {
        addTrack(lane.points.slice(start, i + 1), lane.ratio ?? 0);
        start = i;
        travelled = 0;
      }
    }
  }

  const texture = arrowTexture(renderer);
  const arrows = new ParticleContainer({
    texture,
    dynamicProperties: { position: true, rotation: true, uvs: false, vertex: false, color: false },
  });
  arrows.boundsArea = deck.getLocalBounds().rectangle;
  for (const track of tracks) {
    track.particle = new Particle({ texture, anchorX: 0.5, anchorY: 0.5 });
    arrows.addParticle(track.particle);
  }
  root.addChild(arrows, marks);

  const placeArrow = (track) => {
    const s = track.phase * track.length;
    let i = 0;
    while (i < track.points.length - 2 && track.along[i + 1] < s) i += 1;
    const [ax, ay] = track.points[i];
    const [bx, by] = track.points[i + 1];
    const t = (s - track.along[i]) / (track.along[i + 1] - track.along[i] || 1);
    track.particle.x = ax + (bx - ax) * t;
    track.particle.y = ay + (by - ay) * t;
    track.particle.rotation = Math.atan2(by - ay, bx - ax);
  };

  const step = (dt) => {
    for (const track of tracks) {
      track.phase = (track.phase + track.rate * dt) % 1;
      placeArrow(track);
    }
  };
  step(0);

  /** 点中一个物业：门到路的箭头，加上它的车走的路。没点中时清掉。 */
  const select = (parcel) => {
    marks.clear();
    if (!parcel || parcel.access < 0) return null;
    const routes = parcelRoutes(traffic, parcel);
    for (const { edge, share } of routes) {
      const alpha = HIGHLIGHT_ALPHA * Math.min(1, 0.35 + share);
      if (edge.lanes) {
        for (const id of edge.lanes) {
          const lane = laneById.get(id);
          if (lane) paintLine(marks, lane.points, laneHalf(lane) / 2, HIGHLIGHT, alpha);
        }
      } else paintLine(marks, edgeLine(edge), ROAD_SPEC[edge.kind].deck / 4, HIGHLIGHT, alpha);
    }
    const [dx, dy] = cellCenter(parcel.access, N);
    const from = screen(parcel.px, parcel.py);
    const to = screen(dx, dy);
    marks
      .moveTo(...from)
      .lineTo(...to)
      .stroke({ color: DOOR, width: 8 });
    marks.circle(...from, 14).fill(DOOR);
    return routes;
  };

  return { root, step, select, arrowCount: tracks.length };
}
