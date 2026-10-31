import { CanvasTextMetrics, Container, Graphics, Sprite, Text } from 'pixi.js';

// 主界面。视觉母题来自规划局的桌面：底部工具条是一把比例尺，建造面板是从比例尺上抽出来的绘图纸，城市等级是一枚红色公章。

CanvasTextMetrics.METRICS_STRING = '|ÉqÅ国';
CanvasTextMetrics.BASELINE_SYMBOL = '国';

export const hudThemes = {
  sunny: { paper: '#f3f7f4', paperLine: '#d5e2df', ink: '#1f3a4d', muted: '#5f7683', seal: '#c8372d', mark: '#f2c230', markInk: '#1f3a4d', ruler: '#e6d3a6', rulerInk: '#4a3a1e', good: '#2d8f62' },
  maquette: { paper: '#fbfaf5', paperLine: '#dfe4df', ink: '#2c3a42', muted: '#74828a', seal: '#c8372d', mark: '#2c3a42', markInk: '#fbfaf5', ruler: '#e5e0d2', rulerInk: '#2c3a42', good: '#3f8f6a' },
  dusk: { paper: '#2b2b48', paperLine: '#40406a', ink: '#f6ead8', muted: '#b3adc8', seal: '#ef6a5c', mark: '#ffc76a', markInk: '#2b2b48', ruler: '#453a5c', rulerInk: '#f6ead8', good: '#7fd0a0' },
};

const FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

/** 设计令牌。真机顶部避开刘海和胶囊，底部避开 Home 指示条。 */
export const layoutTokens = {
  safeTop: 54,
  capsuleWidth: 96,
  safeBottom: 34,
  space: { xs: 4, s: 8, m: 12, l: 16, xl: 24 },
  radius: { sheet: 4, chip: 10, tab: 2 },
  fontSize: { caption: 11, label: 13, body: 15, value: 16, title: 20 },
};

const { safeTop, capsuleWidth, safeBottom, space, radius, fontSize } = layoutTokens;

function text(content, size, fill, options = {}) {
  return new Text({
    text: content,
    resolution: 3,
    style: { fontFamily: FONT, fontSize: size, fill, padding: 4, ...options },
  });
}

function dropShadow(g, x, y, w, h, r, alpha) {
  g.roundRect(x, y + 3, w, h, r).fill({ color: '#000000', alpha });
}

/** 红色公章：城市等级。全屏唯一的红色，所以一眼能看到。 */
function seal(theme, level) {
  const root = new Container();
  const g = new Graphics();
  const size = 46;
  const c = size / 2;
  g.circle(c, c, c - 2).stroke({ color: theme.seal, width: 2.4 });
  g.circle(c, c, c - 5).stroke({ color: theme.seal, width: 0.8 });
  const star = [];
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 4.4 : 1.9;
    star.push(c + Math.cos(a) * r, 11.5 + Math.sin(a) * r);
  }
  g.poly(star).fill(theme.seal);
  root.addChild(g);
  const number = text(level, 12.5, theme.seal, { fontWeight: '800' });
  number.anchor.set(0.5);
  number.position.set(c, 23.5);
  const label = text('城市', 8, theme.seal, { fontWeight: '700', letterSpacing: 2 });
  label.anchor.set(0.5);
  label.position.set(c + 1, 35);
  root.addChild(number, label);
  root.pivot.set(c, c);
  root.rotation = -0.12;
  return root;
}

function statusCard(theme, width) {
  const root = new Container();
  const g = new Graphics();
  const nameHeight = 40;
  const nameWidth = width - space.l * 2 - capsuleWidth;
  const statsY = safeTop + nameHeight + 2;
  const statsHeight = 42;
  const statsWidth = width - space.l * 2;
  dropShadow(g, space.l, safeTop, nameWidth, nameHeight, radius.sheet, 0.12);
  dropShadow(g, space.l, statsY, statsWidth, statsHeight, radius.sheet, 0.12);
  g.roundRect(space.l, safeTop, nameWidth, nameHeight + 6, radius.sheet).fill(theme.paper);
  g.roundRect(space.l, statsY, statsWidth, statsHeight, radius.sheet).fill(theme.paper);
  const divider = space.l + statsWidth * 0.5;
  g.moveTo(divider, statsY + 9).lineTo(divider, statsY + statsHeight - 9).stroke({ color: theme.paperLine, width: 1 });
  root.addChild(g);

  const name = text('青禾市', fontSize.title, theme.ink, { fontWeight: '700' });
  name.position.set(space.l + space.m, safeTop + 6);
  const dot = new Graphics();
  dot.circle(0, 0, 3.5).fill(theme.good);
  dot.position.set(space.l + 92, safeTop + 21);
  const sync = text('已同步', fontSize.caption, theme.muted);
  sync.position.set(space.l + 100, safeTop + 13);
  root.addChild(name, dot, sync);

  const stamp = seal(theme, '三级');
  stamp.position.set(space.l + nameWidth - 34, safeTop + 21);
  const money = text('¥128,400', fontSize.value, theme.ink, { fontWeight: '700' });
  money.position.set(space.l + space.m, statsY + 1);
  const income = text('每分钟多 1,240', fontSize.caption, theme.good);
  income.position.set(space.l + space.m, statsY + 21);
  const people = text('3,260 人', fontSize.value, theme.ink, { fontWeight: '700' });
  people.position.set(divider + space.m, statsY + 1);
  const vacant = text('还能住下 180 人', fontSize.caption, theme.muted);
  vacant.position.set(divider + space.m, statsY + 21);
  root.addChild(money, income, people, vacant, stamp);
  return root;
}

function thumbnail(atlas, key, maxWidth, maxHeight) {
  const sprite = new Sprite(atlas.textures[key]);
  const frame = atlas.frames[key];
  sprite.scale.set(Math.min(maxWidth / frame.w, maxHeight / frame.h));
  sprite.anchor.set(0.5);
  return sprite;
}

function item(atlas, theme, { key, title, price, selected }, width) {
  const root = new Container();
  const h = 92;
  if (selected) {
    const g = new Graphics();
    g.roundRect(0, 0, width, h, radius.tab).fill(theme.mark);
    root.addChild(g);
  }
  const picture = thumbnail(atlas, key, width - 10, 42);
  picture.position.set(width / 2, 27);
  const fill = selected ? theme.markInk : theme.ink;
  const label = text(title, fontSize.label, fill, { fontWeight: '600' });
  label.anchor.set(0.5, 0);
  label.position.set(width / 2, 50);
  const cost = text(price, fontSize.caption, selected ? theme.markInk : theme.muted);
  cost.anchor.set(0.5, 0);
  cost.position.set(width / 2, 69);
  root.addChild(picture, label, cost);
  return root;
}

const SHEET_ITEMS = [
  { key: 'r-road-11', title: '普通道路', price: '每格 ¥20', selected: true },
  { key: 'r-road-22', title: '斜向道路', price: '每格 ¥28' },
  { key: 'r-highway-11', title: '高速公路', price: '每格 ¥120' },
  { key: 'br-road-11', title: '桥', price: '每格 ¥80' },
];

function sheet(atlas, theme, width, bottom) {
  const root = new Container();
  const h = 136;
  const x = space.s;
  const w = width - space.s * 2;
  const y = bottom - h;
  const g = new Graphics();
  dropShadow(g, x, y - 4, w, h + 4, radius.sheet, 0.16);
  g.roundRect(x, y, w, h + 4, radius.sheet).fill(theme.paper);
  for (let i = 14; i < w; i += 14) g.moveTo(x + i, y).lineTo(x + i, y + h);
  for (let j = 14; j < h; j += 14) g.moveTo(x, y + j).lineTo(x + w, y + j);
  g.stroke({ color: theme.paperLine, width: 0.5, alpha: 0.55 });
  root.addChild(g);

  const title = text('修路', fontSize.body, theme.ink, { fontWeight: '700' });
  title.position.set(x + space.m, y + space.xs);
  const hint = text('从起点拖到终点，可以走八个方向', fontSize.caption, theme.muted);
  hint.position.set(x + 52, y + space.xs + 4);
  root.addChild(title, hint);

  const itemWidth = (w - space.m * 2 - space.s * 3) / 4;
  SHEET_ITEMS.forEach((entry, index) => {
    const view = item(atlas, theme, entry, itemWidth);
    view.position.set(x + space.m + index * (itemWidth + space.s), y + 32);
    root.addChild(view);
  });
  return root;
}

function glyph(kind, cx, cy, color) {
  const g = new Graphics();
  const stroke = { color, width: 2, cap: 'round', join: 'round' };
  if (kind === 'road') {
    g.moveTo(cx - 11, cy + 8).lineTo(cx - 5, cy - 8).moveTo(cx + 11, cy + 8).lineTo(cx + 5, cy - 8).stroke(stroke);
    g.moveTo(cx, cy + 7).lineTo(cx, cy + 3).moveTo(cx, cy - 2).lineTo(cx, cy - 6).stroke(stroke);
  } else if (kind === 'zone') {
    g.rect(cx - 9, cy - 8, 7, 7).rect(cx + 2, cy - 8, 7, 7).rect(cx - 9, cy + 2, 7, 7).stroke(stroke);
    g.rect(cx + 2, cy + 2, 7, 7).fill(color);
  } else if (kind === 'bus') {
    g.roundRect(cx - 10, cy - 8, 20, 13, 3).stroke(stroke);
    g.moveTo(cx - 10, cy - 2).lineTo(cx + 10, cy - 2).stroke(stroke);
    g.circle(cx - 5, cy + 7, 2).circle(cx + 5, cy + 7, 2).fill(color);
  } else {
    g.moveTo(cx - 10, cy - 4).lineTo(cx + 8, cy - 4).moveTo(cx + 4, cy - 8).lineTo(cx + 9, cy - 4).lineTo(cx + 4, cy).stroke(stroke);
    g.moveTo(cx + 10, cy + 4).lineTo(cx - 8, cy + 4).moveTo(cx - 4, cy).lineTo(cx - 9, cy + 4).lineTo(cx - 4, cy + 8).stroke(stroke);
  }
  return g;
}

const TOOLS = [
  { name: '道路', glyph: 'road', active: true },
  { name: '分区', glyph: 'zone' },
  { name: '公交', glyph: 'bus' },
  { name: '贸易', glyph: 'trade' },
];

/** 比例尺：上沿是 500 米的刻度，选中的工具是一个凸起的纸片，把绘图纸接到比例尺上。 */
function ruler(theme, width, height) {
  const root = new Container();
  const h = 54;
  const y = height - safeBottom - h;
  const g = new Graphics();
  dropShadow(g, 0, y - 5, width, h + safeBottom + 5, 0, 0.18);
  g.rect(0, y, width, h + safeBottom).fill(theme.ruler);
  root.addChild(g);

  const ticks = new Graphics();
  const step = width / 50;
  for (let i = 0; i <= 50; i += 1) {
    const length = i % 10 === 0 ? 12 : i % 5 === 0 ? 8 : 4;
    ticks.moveTo(i * step, y).lineTo(i * step, y + length);
  }
  ticks.stroke({ color: theme.rulerInk, width: 1, alpha: 0.7 });
  root.addChild(ticks);

  const toolWidth = width / 4;
  TOOLS.forEach((tool, index) => {
    const cx = toolWidth * (index + 0.5);
    if (tool.active) {
      const tab = new Graphics();
      tab.rect(cx - 34, y - 4, 68, h + 6).fill(theme.paper);
      root.addChild(tab);
    }
    const color = tool.active ? theme.ink : theme.rulerInk;
    root.addChild(glyph(tool.glyph, cx, y + 20, color));
    const label = text(tool.name, fontSize.label, color, { fontWeight: tool.active ? '700' : '500' });
    label.anchor.set(0.5, 0);
    label.position.set(cx, y + 31);
    root.addChild(label);
  });
  return { root, top: y };
}

export async function createHud({ atlas, palette, width, height }) {
  const theme = hudThemes[palette.id];
  const root = new Container();
  const bar = ruler(theme, width, height);
  root.addChild(statusCard(theme, width));
  root.addChild(sheet(atlas, theme, width, bar.top));
  root.addChild(bar.root);
  return root;
}
