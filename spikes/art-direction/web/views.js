import { Color, Container, Graphics, Text } from 'pixi.js';
import { palettes } from './kit/palettes.js';
import { SERVICES } from './sim/services.js';
import { screenOf } from './world.js';

// 公共服务和地铁两个视图：在变暗的城市上盖一层图。交通视图在 trafficview.js。
// 公共服务的颜色直接取配色表里的专用色，和建筑、图标牌是同一个颜色。
// 全图时 128 城只有手机宽，世界尺寸的线和字都不到一个像素，所以地铁的线、站和字按屏幕像素保底；
// 公共服务的名字这时连不成字，只会变成杂点，缩小到 LABEL_MIN_ZOOM 以下不显示。

const serviceColor = (use) => new Color(palettes.sunny.service[use]).toNumber();

const LABEL_MIN_ZOOM = 0.15;
const LINE_WIDTH = 26;
const LINE_PIXELS = 3;
const STATION_RADIUS = 24;
const STATION_PIXELS = 3;
const INTERCHANGE_RADIUS = 40;
const INTERCHANGE_PIXELS = 7;
const BADGE_RADIUS = 50;
const BADGE_PIXELS = 9;
const BADGE_FONT = 64;
const BADGE_FONT_PIXELS = 12;
const NAME_FONT = 46;
const NAME_FONT_PIXELS = 11;
const PASS_LABEL_MIN_ZOOM = 0.1;

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
  const root = new Container();
  const areas = new Graphics();
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
    areas.poly(points).fill({ color, alpha: 0.9 });
  }
  const names = new Graphics();
  for (const parcel of city.parcels.parcels) {
    if (parcel.shape !== 'service') continue;
    const { sx, sy } = ground(parcel.px, parcel.py);
    names.circle(sx, sy, 40).fill(serviceColor(parcel.use)).stroke({ color: 0xffffff, width: 7 });
    const name = SERVICES.find((service) => service.id === parcel.use).name;
    names.addChild(label(name, sx, sy + 44, 52));
  }
  root.addChild(areas, names);
  return {
    root,
    setZoom(zoom) {
      names.visible = zoom >= LABEL_MIN_ZOOM;
    },
  };
}

/** 世界单位下的大小：放大时用自己的尺寸，缩小时不小于 pixels 个屏幕像素。 */
const atLeast = (own, pixels, zoom) => Math.max(own, pixels / zoom);

/** 线路图和实际走线是同一条线：直接画线路的圆弧走线。 */
export function metroView(city) {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const at = ([x, y]) => screenOf(x, y, 0);
  const crossings = city.metro.crossings.map((crossing) => ({
    ...at([crossing.x + 0.5, crossing.y + 0.5]),
    interchange: crossing.interchange,
    name: label(crossing.interchange ? '换乘站' : '穿过，不设站', 0, 0, NAME_FONT),
  }));
  const badges = city.metro.lines.map((line) => ({
    line,
    head: at(line.path[0]),
    number: label(String(line.id), 0, 0, BADGE_FONT, 0.5),
  }));
  const texts = new Container();
  texts.addChild(...badges.map(({ number }) => number), ...crossings.map(({ name }) => name));
  root.addChild(texts);

  const drawLines = (zoom) => {
    for (const line of city.metro.lines) {
      const start = at(line.path[0]);
      g.moveTo(start.sx, start.sy);
      for (const point of line.path.slice(1)) {
        const { sx, sy } = at(point);
        g.lineTo(sx, sy);
      }
      g.stroke({
        color: line.color,
        width: atLeast(LINE_WIDTH, LINE_PIXELS, zoom),
        join: 'round',
        cap: 'round',
      });
    }
  };

  const drawStations = (zoom) => {
    const radius = atLeast(STATION_RADIUS, STATION_PIXELS, zoom);
    for (const line of city.metro.lines) {
      for (const platform of line.platforms) {
        const { sx, sy } = at(platform);
        g.circle(sx, sy, radius)
          .fill(0xffffff)
          .stroke({ color: line.color, width: radius * 0.4 });
      }
    }
  };

  const drawBadges = (zoom) => {
    const radius = atLeast(BADGE_RADIUS, BADGE_PIXELS, zoom);
    const scale = atLeast(1, BADGE_FONT_PIXELS / BADGE_FONT, zoom);
    for (const { line, head, number } of badges) {
      const y = head.sy - radius * 1.5;
      g.circle(head.sx, y, radius).fill(line.color);
      number.scale.set(scale);
      number.position.set(head.sx, y);
    }
  };

  const drawCrossings = (zoom) => {
    const radius = atLeast(INTERCHANGE_RADIUS, INTERCHANGE_PIXELS, zoom);
    const scale = atLeast(1, NAME_FONT_PIXELS / NAME_FONT, zoom);
    for (const { sx, sy, interchange, name } of crossings) {
      if (interchange) {
        g.circle(sx, sy, radius)
          .fill(0xffffff)
          .stroke({ color: 0x1f3a4d, width: radius * 0.3 });
        g.circle(sx, sy, radius * 0.4).fill(0x1f3a4d);
      }
      name.visible = interchange || zoom >= PASS_LABEL_MIN_ZOOM;
      name.scale.set(scale);
      name.position.set(sx, sy + radius * 1.2);
    }
  };

  let drawn = 0;
  return {
    root,
    /** 拖动地图时缩放没变，不用重画。 */
    setZoom(zoom) {
      if (zoom === drawn) return;
      drawn = zoom;
      g.clear();
      drawLines(zoom);
      drawStations(zoom);
      drawBadges(zoom);
      drawCrossings(zoom);
    },
  };
}
