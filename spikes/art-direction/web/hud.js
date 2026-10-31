import { CanvasTextMetrics, Container, Graphics, Sprite, Text } from 'pixi.js';

// 主界面。视觉母题来自规划局的桌面：底部工具条是一把比例尺，建造面板是一张绘图纸，城市等级是一枚红色公章。

CanvasTextMetrics.METRICS_STRING = '|ÉqÅ国';
CanvasTextMetrics.BASELINE_SYMBOL = '国';

export const hudThemes = {
  sunny: { paper: '#f3f7f4', paperLine: '#d5e2df', ink: '#1f3a4d', muted: '#5f7683', seal: '#c8372d', mark: '#f2c230', markInk: '#1f3a4d', ruler: '#f2c230', rulerInk: '#3a3218', good: '#2d8f62' },
  maquette: { paper: '#fbfaf5', paperLine: '#dfe4df', ink: '#2c3a42', muted: '#74828a', seal: '#c8372d', mark: '#2c3a42', markInk: '#fbfaf5', ruler: '#fbfaf5', rulerInk: '#2c3a42', good: '#3f8f6a' },
  dusk: { paper: '#2b2b48', paperLine: '#40406a', ink: '#f6ead8', muted: '#b3adc8', seal: '#e2574c', mark: '#ffc76a', markInk: '#2b2b48', ruler: '#ffc76a', rulerInk: '#3a2a18', good: '#7fd0a0' },
};

const FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

/** 设计令牌。真机顶部避开刘海和胶囊，底部避开 Home 指示条。 */
export const layoutTokens = {
  safeTop: 59,
  capsuleBottom: 88,
  safeBottom: 34,
  space: { xs: 4, s: 8, m: 12, l: 16, xl: 24 },
  radius: { sheet: 4, chip: 10, tab: 2 },
  fontSize: { caption: 11, label: 13, body: 15, value: 17, title: 22 },
};

const { safeTop, safeBottom, space, radius, fontSize } = layoutTokens;

function text(content, size, fill, options = {}) {
  return new Text({
    text: content,
    resolution: 3,
    style: { fontFamily: FONT, fontSize: size, fill, padding: 4, ...options },
  });
}

function shadowUnder(g, x, y, w, h, r, color, alpha) {
  g.roundRect(x, y + 3, w, h, r).fill({ color, alpha });
}

/** 红色公章：城市等级。这是全屏唯一的强调色，所以一眼能看到。 */
function seal(theme, level) {
  const root = new Container();
  const g = new Graphics();
  const size = 54;
  const c = size / 2;
  g.circle(c, c, c - 2).stroke({ color: theme.seal, width: 3 });
  g.circle(c, c, c - 6).stroke({ color: theme.seal, width: 1 });
  const star = [];
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 5 : 2.2;
    star.push(c + Math.cos(a) * r, 13 + Math.sin(a) * r);
  }
  g.poly(star).fill(theme.seal);
  root.addChild(g);
  const number = text(level, 15, theme.seal, { fontWeight: '800' });
  number.anchor.set(0.5);
  number.position.set(c, 28);
  const label = text('城市', 9, theme.seal, { fontWeight: '700', letterSpacing: 2 });
  label.anchor.set(0.5);
  label.position.set(c + 1, 42);
  root.addChild(number, label);
  root.rotation = -0.1;
  return root;
}

function nameplate(theme, width) {
  const root = new Container();
  const g = new Graphics();
  const y = safeTop;
  const h = 62;
  const w = width - space.l * 2 - 96;
  shadowUnder(g, space.l, y, w, h, radius.sheet, '#000000', 0.14);
  g.roundRect(space.l, y, w, h, radius.sheet).fill(theme.paper);
  root.addChild(g);

  const name = text('青禾市', fontSize.title, theme.ink, { fontWeight: '700' });
  name.position.set(space.l + space.m, y + 7);
  const sync = new Graphics();
  sync.circle(0, 0, 3.5).fill(theme.good);
  sync.position.set(space.l + space.m + 4, y + 47);
  const syncText = text('已同步', fontSize.caption, theme.muted);
  syncText.position.set(space.l + space.m + 12, y + 39);
  root.addChild(name, sync, syncText);

  const stamp = seal(theme, '三级');
  stamp.position.set(space.l + w - 60, y + 6);
  root.addChild(stamp);
  return root;
}

function stats(theme, width) {
  const root = new Container();
  const y = safeTop + 62 + space.s;
  const g = new Graphics();
  const w = width - space.l * 2;
  const h = 46;
  shadowUnder(g, space.l, y, w, h, radius.sheet, '#000000', 0.12);
  g.roundRect(space.l, y, w, h, radius.sheet).fill(theme.paper);
  g.moveTo(space.l + w * 0.56, y + 10).lineTo(space.l + w * 0.56, y + h - 10).stroke({ color: theme.paperLine, width: 1 });
  root.addChild(g);

  const money = text('¥128,400', fontSize.value, theme.ink, { fontWeight: '700' });
  money.position.set(space.l + space.m, y + 3);
  const income = text('每分钟 +1,240', fontSize.caption, theme.good);
  income.position.set(space.l + space.m, y + 25);
  const people = text('3,260', fontSize.value, theme.ink, { fontWeight: '700' });
  people.position.set(space.l + w * 0.56 + space.m, y + 3);
  const peopleLabel = text('人口，住房还空 180', fontSize.caption, theme.muted);
  peopleLabel.position.set(space.l + w * 0.56 + space.m, y + 25);
  root.addChild(money, income, people, peopleLabel);
  return root;
}

function thumbnail(atlas, key, size) {
  const sprite = new Sprite(atlas.textures[key]);
  const frame = atlas.frames[key];
  const scale = Math.min(size / frame.w, size / frame.h);
  sprite.scale.set(scale);
  sprite.anchor.set(0.5);
  return sprite;
}

function item(atlas, theme, { key, title, price, selected }, width) {
  const root = new Container();
  const g = new Graphics();
  const h = 112;
  if (selected) {
    g.roundRect(0, 0, width, h, radius.tab).fill(theme.mark);
  }
  root.addChild(g);
  const picture = thumbnail(atlas, key, width - 8);
  picture.position.set(width / 2, 42);
  root.addChild(picture);
  const fill = selected ? theme.markInk : theme.ink;
  const label = text(title, fontSize.label, fill, { fontWeight: '600' });
  label.anchor.set(0.5, 0);
  label.position.set(width / 2, 70);
  const cost = text(price, fontSize.caption, selected ? theme.markInk : theme.muted);
  cost.anchor.set(0.5, 0);
  cost.position.set(width / 2, 90);
  root.addChild(label, cost);
  return root;
}

function sheet(atlas, theme, width, bottom) {
  const root = new Container();
  const h = 168;
  const x = space.m;
  const w = width - space.m * 2;
  const y = bottom - h;
  const g = new Graphics();
  shadowUnder(g, x, y, w, h, radius.sheet, '#000000', 0.18);
  g.roundRect(x, y, w, h, radius.sheet).fill(theme.paper);
  for (let i = 14; i < w; i += 14) g.moveTo(x + i, y).lineTo(x + i, y + h);
  for (let j = 14; j < h; j += 14) g.moveTo(x, y + j).lineTo(x + w, y + j);
  g.stroke({ color: theme.paperLine, width: 0.5, alpha: 0.6 });
  root.addChild(g);

  const title = text('修路', fontSize.body, theme.ink, { fontWeight: '700' });
  title.position.set(x + space.m, y + space.s);
  const hint = text('手指从起点拖到终点，能走八个方向', fontSize.caption, theme.muted);
  hint.position.set(x + 52, y + space.s + 4);
  root.addChild(title, hint);

  const entries = [
    { key: 'r-road-11', title: '普通道路', price: '¥20 每格', selected: true },
    { key: 'r-road-22', title: '斜向道路', price: '¥28 每格' },
    { key: 'r-highway-11', title: '高速公路', price: '¥120 每格' },
    { key: 'br-road-11', title: '桥', price: '¥80 每格' },
  ];
  const itemWidth = (w - space.m * 2 - space.s * 3) / 4;
  entries.forEach((entry, index) => {
    const view = item(atlas, theme, entry, itemWidth);
    view.position.set(x + space.m + index * (itemWidth + space.s), y + 40);
    root.addChild(view);
  });
  return root;
}

/** 比例尺：上沿刻度从 0 到 500 米，四个工具落在刻度上。 */
function ruler(theme, width, height) {
  const root = new Container();
  const h = 70;
  const y = height - safeBottom - h - space.s;
  const g = new Graphics();
  shadowUnder(g, 0, y, width, h + safeBottom + space.s + 6, 0, '#000000', 0.2);
  g.rect(0, y, width, h + safeBottom + space.s + 4).fill(theme.ruler);
  root.addChild(g);

  const ticks = new Graphics();
  const step = width / 50;
  for (let i = 0; i <= 50; i += 1) {
    const major = i % 10 === 0;
    const middle = i % 5 === 0;
    const length = major ? 13 : middle ? 9 : 5;
    ticks.moveTo(i * step, y).lineTo(i * step, y + length);
  }
  ticks.stroke({ color: theme.rulerInk, width: 1, alpha: 0.75 });
  root.addChild(ticks);

  const tools = [
    { name: '道路', glyph: 'road', active: true },
    { name: '分区', glyph: 'zone' },
    { name: '公交', glyph: 'bus' },
    { name: '贸易', glyph: 'trade' },
  ];
  const toolWidth = width / 4;
  tools.forEach((tool, index) => {
    const cx = toolWidth * (index + 0.5);
    const view = new Container();
    if (tool.active) {
      const tab = new Graphics();
      tab.rect(cx - 36, y - 10, 72, h + 10).fill(theme.paper);
      view.addChild(tab);
    }
    const color = tool.active ? theme.ink : theme.rulerInk;
    view.addChild(glyph(tool.glyph, cx, y + 26, color));
    const label = text(tool.name, fontSize.label, color, { fontWeight: tool.active ? '700' : '500' });
    label.anchor.set(0.5, 0);
    label.position.set(cx, y + 42);
    view.addChild(label);
    root.addChild(view);
  });
  return { root, top: y };
}

function glyph(kind, cx, cy, color) {
  const g = new Graphics();
  const stroke = { color, width: 2, cap: 'round', join: 'round' };
  if (kind === 'road') {
    g.moveTo(cx - 12, cy + 9).lineTo(cx - 5, cy - 9).moveTo(cx + 12, cy + 9).lineTo(cx + 5, cy - 9).stroke(stroke);
    g.moveTo(cx, cy + 8).lineTo(cx, cy + 3).moveTo(cx, cy - 2).lineTo(cx, cy - 7).stroke(stroke);
  } else if (kind === 'zone') {
    g.rect(cx - 10, cy - 8, 8, 8).rect(cx + 2, cy - 8, 8, 8).rect(cx - 10, cy + 2, 8, 8).stroke(stroke);
    g.rect(cx + 2, cy + 2, 8, 8).fill(color);
  } else if (kind === 'bus') {
    g.roundRect(cx - 11, cy - 9, 22, 15, 3).stroke(stroke);
    g.moveTo(cx - 11, cy - 2).lineTo(cx + 11, cy - 2).stroke(stroke);
    g.circle(cx - 6, cy + 8, 2).circle(cx + 6, cy + 8, 2).fill(color);
  } else {
    g.moveTo(cx - 11, cy - 4).lineTo(cx + 9, cy - 4).moveTo(cx + 4, cy - 9).lineTo(cx + 10, cy - 4).lineTo(cx + 4, cy + 1).stroke(stroke);
    g.moveTo(cx + 11, cy + 5).lineTo(cx - 9, cy + 5).moveTo(cx - 4, cy).lineTo(cx - 10, cy + 5).lineTo(cx - 4, cy + 10).stroke(stroke);
  }
  return g;
}

export async function createHud({ atlas, palette, width, height }) {
  const theme = hudThemes[palette.id];
  const root = new Container();
  const bar = ruler(theme, width, height);
  root.addChild(nameplate(theme, width), stats(theme, width));
  root.addChild(sheet(atlas, theme, width, bar.top - space.s - 4));
  root.addChild(bar.root);
  return root;
}
