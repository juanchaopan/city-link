import { Graphics, Text } from 'pixi.js';
import { SERVICES } from './sim/services.js';
import { screenOf } from './world.js';

// 公共服务和地铁两个视图：在变暗的城市上盖一层图。交通视图在 trafficview.js。

const SERVICE_COLORS = {
  hospital: 0x00b37a,
  school: 0xff7a1a,
  police: 0x1248c8,
  fire: 0xff1f1f,
  water: 0x00a8e8,
  power: 0xffc400,
};

export function label(text, x, y, size, anchorY = 0) {
  const item = new Text({
    text,
    resolution: 2,
    style: {
      fontFamily: 'Microsoft YaHei',
      fontSize: size,
      fontWeight: '700',
      fill: '#ffffff',
      stroke: { color: '#1f3a4d', width: size / 5 },
    },
  });
  item.anchor.set(0.5, anchorY);
  item.position.set(x, y);
  return item;
}

export function coverageView(city, ground) {
  const g = new Graphics();
  const missing = new Map(city.coverage.rows.map((row) => [row.parcel, row.missing.length]));
  for (const parcel of city.parcels.parcels) {
    if (!parcel.polygon || !missing.has(parcel.id)) continue;
    const count = missing.get(parcel.id);
    const color =
      count === 0 ? 0x2fae6c : count === 1 ? 0xf0c040 : count === 2 ? 0xf08a3c : 0xe03c34;
    const points = parcel.polygon.flatMap(([px, py]) => {
      const { sx, sy } = ground(px, py);
      return [sx, sy];
    });
    g.poly(points).fill({ color, alpha: 0.9 });
  }
  for (const parcel of city.parcels.parcels) {
    if (parcel.shape !== 'service') continue;
    const { sx, sy } = ground(parcel.px, parcel.py);
    g.circle(sx, sy, 40).fill(SERVICE_COLORS[parcel.use]).stroke({ color: 0xffffff, width: 7 });
    const name = SERVICES.find((service) => service.id === parcel.use).name;
    g.addChild(label(name, sx, sy + 44, 52));
  }
  return g;
}

/** 线路图和实际走线是同一条线：直接画线路的圆弧走线。 */
export function metroView(city) {
  const g = new Graphics();
  const at = ([x, y]) => screenOf(x, y, 0);
  for (const line of city.metro.lines) {
    const start = at(line.path[0]);
    g.moveTo(start.sx, start.sy);
    for (const point of line.path.slice(1)) {
      const { sx, sy } = at(point);
      g.lineTo(sx, sy);
    }
    g.stroke({ color: line.color, width: 26, join: 'round', cap: 'round' });
  }
  for (const line of city.metro.lines) {
    for (const platform of line.platforms) {
      const { sx, sy } = at(platform);
      g.circle(sx, sy, 24).fill(0xffffff).stroke({ color: line.color, width: 10 });
    }
    const head = at(line.path[0]);
    const badge = new Graphics();
    badge.circle(head.sx, head.sy - 74, 50).fill(line.color);
    g.addChild(badge);
    g.addChild(label(String(line.id), head.sx, head.sy - 74, 64, 0.5));
  }
  for (const crossing of city.metro.crossings) {
    const { sx, sy } = at([crossing.x + 0.5, crossing.y + 0.5]);
    if (crossing.interchange) {
      g.circle(sx, sy, 40).fill(0xffffff).stroke({ color: 0x1f3a4d, width: 12 });
      g.circle(sx, sy, 16).fill(0x1f3a4d);
    }
    g.addChild(label(crossing.interchange ? '换乘站' : '穿过，不设站', sx, sy + 48, 46));
  }
  return g;
}
