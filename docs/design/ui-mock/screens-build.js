// 建造：D1 至 D15。建造模式顶部只留资金一格（第二行），左上返回先回 D1、再回地图。
import { q, MAIN, NB, base, site, built, isoRoad } from './screens-common.js';
import { ROW3, modeTop, coBack, row2, subBtn, confirm, price, deadline, grey, nbName, port, goldNet, brokenAt, OFFLINE, SPIN, inset, mini } from './parts-b.js';

const ZC = { R: '#5fbf5a', C: '#3f8fd6', I: '#f2c94c', F: '#a8743a' };
/** 托盘的类别：道路和铁路、分区、公共服务、水电燃气、公交地铁、港口机场、公园和垃圾、奖励建筑。盾牌只给派出所，公共服务用 🏛️。 */
const CATS = ['🛣️', '🏘️', '🏛️', '<span style="font-size:11px;line-height:1.05;text-align:center">💧⚡<br>🔥</span>', '🚌', '⚓', '🌳', '🏆'];
const catRow = (on, dots = []) =>
  `<div class="cats emo" style="gap:4px">${CATS.map((e, i) => `<div class="cat ${i === on ? 'on' : ''}" style="flex:1;width:auto;position:relative">${e}${dots.includes(i) ? '<i style="position:absolute;right:2px;top:2px;width:9px;height:9px;border-radius:50%;background:radial-gradient(circle at 40% 30%,#fff6c8,#f2b62f);border:1px solid #8a5a0c"></i>' : ''}</div>`).join('')}<div class="cat sep"></div><div class="cat" style="flex:1;width:auto">🚜</div></div>`;

/** 卡片左上角的“?”：进帮助页里讲这样东西的那一页。和羊皮纸卡片同色系，不和标注混。 */
const HELP = '<i class="help" style="width:16px;height:16px;border-radius:50%;display:grid;place-items:center;background:#fff6dc;color:#7a5520;border:1.5px solid #b8873a;font:900 11px/1 sans-serif;font-style:normal;z-index:1">?</i>';
/** 托盘里的一张卡片：lock 锁住（照样写价格）、done 城里已有、ring 在建进度、nw 新解锁、gold 奖励建筑的金色底。 */
function card({ e, n, p, u, lock, nw, done, ring, gold }, w = 82) {
  const pic = `<div class="pic emo" style="${lock ? 'filter:grayscale(1);opacity:.55;' : ''}${gold ? 'background:radial-gradient(circle at 50% 35%,#fff1b8,#e0a83a)' : ''}">${e}</div>`;
  const ringSvg = ring ? `<svg width="40" height="40" viewBox="0 0 40 40" style="position:absolute;left:50%;top:9px;margin-left:-20px"><circle cx="20" cy="20" r="16" fill="rgba(13,36,46,.75)"/><circle cx="20" cy="20" r="13" fill="none" stroke="#7ee08a" stroke-width="5" stroke-dasharray="${81.7 * ring} 82" transform="rotate(-90 20 20)"/><text x="20" y="25" text-anchor="middle" font-size="13">🏗️</text></svg>` : '';
  const foot = done ? '<small>城里已有</small>' : `<span class="price emo">🪙¥${p}</span><small>${u}</small>`;
  const marks = `${HELP}${lock ? `<i class="emo" style="position:absolute;left:50%;top:14px;margin-left:-13px;font-size:22px;font-style:normal">🔒</i><small style="color:#8a5a0c;font-weight:900">Lv${lock}</small>` : ''}${nw ? '<i class="new">新</i>' : ''}${done ? '<i class="done">✓</i>' : ''}`;
  return `<div class="item" style="width:${w}px;${done ? 'filter:grayscale(.85);opacity:.78' : ''}">${pic}${ringSvg}<b style="${w < 70 ? 'font-size:11px' : ''}">${n}</b>${foot}${marks}</div>`;
}
const tray = (a, items, on, dots, w) => a.panel('tray', '', `<div class="items" style="gap:6px">${items.map((it) => card(it, w)).join('')}</div>${catRow(on, dots)}`, 'left:15px;right:15px');
/** 托盘打开时顶部只留资金一格，和建造模式一样画在第二行。 */
function moneyOnly(a, money = '48,203') {
  a.hud({ only: 'money', money });
  return document.querySelector('.res .cap.money');
}
/** 标注放在卡片正上方，不盖住卡片上的字和角标。 */
const coAbove = (a, n, el) => a.coAt(n, el, el.offsetWidth / 2, -18);

/**
 * 4 级青川市的奖励建筑托盘（D2、D2b 同一套）：市政厅城里已有，体育场在建，动物园新解锁，植物园能造，物流园 5 级。
 * 4 级解锁的中央公园、植物园、动物园里，植物园已经点过，“新”只剩动物园。
 */
const REWARDS = [
  { e: '🏛️', n: '市政厅', done: true },
  { e: '🏟️', n: '体育场', p: '5,000', u: '−¥50/天', ring: 0.55 },
  { e: '🦁', n: '动物园', p: '4,500', u: '−¥45/天', nw: true },
  { e: '🌺', n: '植物园', p: '2,500', u: '−¥20/天' },
  { e: '🚚', n: '物流园', p: '6,000', u: '−¥60/天', lock: 5 },
  { e: '♻️', n: '环保中心', done: true },
  { e: '📚', n: '图书馆', p: '2,200', u: '−¥25/天' },
].map((it) => ({ ...it, gold: true }));

/** 横平竖直的一段格子：x0..x1、y0..y1，四边往里收 inset。 */
const rect = (a, x0, y0, x1, y1, attrs, inset = 0.15) => a.poly([[x0 + inset, y0 + inset], [x1 + 1 - inset, y0 + inset], [x1 + 1 - inset, y1 + 1 - inset], [x0 + inset, y1 + 1 - inset]], attrs);
const GHOST = 'fill="rgba(42,143,168,.62)" stroke="#fff" stroke-width="2" stroke-dasharray="6 4"';
const RED = 'fill="rgba(229,51,42,.42)" stroke="#e5332a" stroke-width="2.5"';
/** 铁路虚影：一条带枕木的青色带子。 */
function railGhost(a, pts) {
  a.svg(a.line(pts, 'stroke="rgba(42,143,168,.7)" stroke-width="16" stroke-linecap="round"'));
  a.svg(a.line(pts, 'stroke="#13303d" stroke-width="10" stroke-dasharray="2 5"'));
  a.svg(a.line(pts, 'stroke="#fff" stroke-width="2" stroke-dasharray="6 4"'));
}
/** 已经建成的铁路：深灰路基加浅色枕木。 */
function railBuilt(a, pts) {
  a.svg(a.line(pts, 'stroke="#5b5f63" stroke-width="11" stroke-linecap="round"') + a.line(pts, 'stroke="#e8e2d0" stroke-width="3" stroke-dasharray="2 5"'));
}
/** 发光的匝道或立交虚影。 */
function glow(a, pts) {
  a.svg(a.line(pts, 'stroke="#fff3a8" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"'));
  a.svg(a.line(pts, 'stroke="rgba(255,214,90,.95)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"'));
  a.svg(a.line(pts, 'stroke="#a8741c" stroke-width="2" stroke-dasharray="5 4"'));
}
/** 松手后两端的把手。 */
function handle(a, x, y) {
  const [sx, sy] = a.P(x, y);
  a.svg(`<circle cx="${sx}" cy="${sy}" r="13" fill="#fff" stroke="#2a8fa8" stroke-width="4"/><circle cx="${sx}" cy="${sy}" r="4" fill="#2a8fa8"/>`);
  return [sx, sy];
}
/** 虚影上左右滑换模板的小条，选中的那一档金色。 */
const swiper = (opts, on, size = 13) => `<div class="emo" style="display:flex;align-items:center;gap:4px;padding:4px 6px;border-radius:20px;background:rgba(13,36,46,.9);border:2px solid #ffd76a;color:#ffeab0;font-weight:900;font-size:${size}px;white-space:nowrap"><span>‹</span>${opts.map((o, i) => `<span style="padding:5px 10px;border-radius:14px;${i === on ? 'background:linear-gradient(#ffe48a,#e09a14);color:#4a2c00' : 'opacity:.6'}">${o}</span>`).join('')}<span>›</span></div>`;
const finger = (a, sx, sy, extra = '') => a.add(`<div class="emo" style="position:absolute;left:${sx}px;top:${sy}px;font-size:30px;filter:drop-shadow(0 2px 2px rgba(0,0,0,.5))">👆${extra}</div>`);
const hits = (a, test) => a.parcels.filter((p) => p.zone >= 1 && p.zone <= 3 && test(p));
const levy = (list) => `<span class="emo">🏠×${list.length}　👥${list.length * 42}</span>`;
const capMini = (money, extra = '') => `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span class="cap" style="height:26px;padding:0 8px 0 26px;font-size:13px"><span class="ic emo" style="width:28px;height:28px;font-size:15px;left:-4px;top:-3px">🪙</span>${money}</span>${extra}</div>`;
const lineDot = (col) => `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${col};border:2px solid #fff"></span>`;
/** 地铁已有线路的颜色：橙棕、蓝、绿。红色只留给坏的状态。 */
const METRO = ['#b5651d', '#2a8fd6', '#3fa75a'];
/** 同一条线上挨着（一格以内）的两个站只画前一个，免得叠成一个像换乘站的大圈。 */
const metroStations = (lines) => lines.map((l) => l.stations.filter((s, i) => !l.stations.slice(0, i).some((t) => Math.hypot(t[0] - s[0], t[1] - s[1]) <= 1.5)));
/**
 * list 里落在画面中间（避开顶部三行和底部按钮）的那些里，屏幕上离 (tx, ty) 最近的一个，返回它的屏幕位置。
 * 元素是带 px、py 的楼，或 [x, y] 格子。标注要指着画面里看得见的东西。
 */
function onScreen(a, list, tx, ty, m = 36) {
  const at = (p) => (Array.isArray(p) ? a.P(p[0] + 0.5, p[1] + 0.5) : a.P(p.px, p.py));
  const seen = list.map(at).filter(([sx, sy]) => sx > m && sx < a.W - m && sy > 190 && sy < a.H - 150);
  seen.sort((u, v) => Math.hypot(u[0] - tx, u[1] - ty) - Math.hypot(v[0] - tx, v[1] - ty));
  return seen[0] ?? null;
}
const roadCells = (a) => [...a.city.roads].filter(([, v]) => !v.highway).map(([id]) => [id % a.N, Math.floor(id / a.N)]);

export const BUILD = [
  {
    id: 'D1', title: '建造托盘：道路和铁路', from: 'B1 点建造',
    query: MAIN,
    notes: ['顶部只留资金一格，别的收起，免得挡住地图', '这一类的卡片：图标、造价、每天维护费，角上一个“?”进帮助页；选一张进入建造模式（D3 画路、D11 铁路、D12 高速）', '锁住的卡片照样写价格；点了冒“Lv7 解锁”小签', '卡片可以左右滑。这一类的顺序：两车道、四车道、高速公路、铁路线、货运站、客运站', '类别：道路和铁路、分区、公共服务、水电燃气、公交地铁、港口机场、公园和垃圾、奖励建筑（奖杯）', '推土机单独在最右 → D9 拆除', '点托盘外面：收起托盘回到 B1。匝道和立交不在托盘里，画路时自动出现（D4、D12）'],
    draw(a) {
      a.dock({ on: 'build', buildDot: false });
      const m = moneyOnly(a);
      const t = tray(a, [{ e: '🛣️', n: '两车道', p: '20/格', u: '−¥1/格·天' }, { e: '🛣️', n: '四车道', p: '45/格', u: '−¥2/格·天' }, { e: '🛤️', n: '高速公路', p: '400/格', u: '−¥12/格·天', lock: 7 }, { e: '🚆', n: '铁路线', p: '60/格', u: '−¥3/格·天' }, { e: '🚉', n: '货运站', p: '1,800', u: '−¥40/天' }, { e: '🚏', n: '客运站', p: '2,400', u: '−¥50/天' }], 0);
      const its = t.querySelectorAll('.item');
      const r = its[2].getBoundingClientRect();
      const tip = a.add(`<div class="tip emo" style="left:${r.left + r.width / 2}px;top:${r.top - 34}px;transform:translateX(-50%);font-size:13px;padding:5px 10px">🔒 Lv7 解锁</div>`);
      a.coAt(1, m, m.offsetWidth + 16, 14);
      a.coAt(2, its[0], 6, -16);
      a.coAt(3, tip, tip.offsetWidth + 14, 12);
      a.coAt(4, its[3], its[3].offsetWidth - 4, -16);
      a.coAt(5, t.querySelector('.cats'), 10, -6);
      const cats = t.querySelectorAll('.cat');
      a.coAt(6, cats[cats.length - 1], 18, -8);
      a.co(7, 200, 330);
    },
  },
  {
    id: 'D1b', title: '建造托盘的“新”：点过以后消失', from: 'B3 升级以后点建造（例子是升到 4 级）',
    query: MAIN,
    notes: ['卡片上的“新”字：新解锁、还没点过这张卡', '类别按钮上的金色小点：这一类里还有带“新”的卡片。4 级解锁了医院、燃气厂、公交、公园和三座奖励建筑，这几类都有小点', '建造按钮上的金色小星：托盘里还有带“新”的卡片；红点只留给待处理', '点过这张卡，“新”字消失；这一类的“新”都点过了，类别上的小点消失；托盘里的“新”都没了，建造按钮上的小星才消失', '视图托盘的按钮也用同样的小点；“新”按城记，每座新城从头来'],
    draw(a) {
      a.dock({ on: 'build', buildDot: true });
      moneyOnly(a);
      const t = tray(a, [{ e: '🛡️', n: '派出所', p: '1,200', u: '−¥30/天' }, { e: '🚒', n: '消防站', p: '1,500', u: '−¥35/天' }, { e: '🏥', n: '医院', p: '3,000', u: '−¥80/天', nw: true }, { e: '🏫', n: '小学', p: '1,400', u: '−¥30/天' }, { e: '🎓', n: '中学', p: '2,000', u: '−¥45/天' }], 2, [2, 3, 4, 6, 7]);
      const its = t.querySelectorAll('.item');
      const cats = t.querySelectorAll('.cat');
      const before = card({ e: '🏥', n: '医院', p: '3,000', u: '−¥80/天', nw: true });
      const after = card({ e: '🏥', n: '医院', p: '3,000', u: '−¥80/天' });
      const box = inset(a, { left: 30, top: 180, width: 330, title: '点过医院这张卡前后', body: `<div style="display:flex;align-items:center;gap:10px;justify-content:center">${before}<span style="font-size:24px;font-weight:900;color:#ffd76a">→</span>${after}<div style="font-size:12px;line-height:1.5;width:100px">公共服务类别 🏛️ 上的金点：这一类没有“新”了就消失</div></div>` });
      const view = document.querySelector('.db.view');
      a.coAt(1, its[2], its[2].offsetWidth + 3, -20);
      a.coAt(2, cats[4], 30, -10);
      a.coAt(3, document.querySelector('.db.build'), -6, 6);
      a.coAt(4, box, box.offsetWidth - 6, 8);
      a.coAt(5, view, view.offsetWidth + 4, 6);
    },
  },
  {
    id: 'D2', title: '建造托盘：奖励建筑', from: 'D1 点类别里的 🏆',
    query: MAIN,
    notes: ['城里已有的打勾、变灰，每种只能造一座', '新解锁的带“新”字', '卡片上的价格和维护费；有条件的（紧挨河、湖或山）放的时候只在满足条件的地方发亮', '左右滑看更多'],
    draw(a) {
      base(a, { dock: { on: 'build' } });
      const t = tray(a, REWARDS, 7, [7], 64);
      const its = t.querySelectorAll('.item');
      coAbove(a, 1, its[0]);
      coAbove(a, 2, its[2]);
      coAbove(a, 3, its[3]);
      coAbove(a, 4, its[4]);
    },
  },
  {
    id: 'D2b', title: '奖励建筑卡片的几种样子', from: 'D1 点类别里的 🏆（例子是 4 级的城市）',
    query: MAIN,
    notes: ['城里已经有的：打勾、变灰；拆了以后恢复', '在建的：卡片上一个进度环', '新解锁的带“新”字', '能造的：价格和每天维护费。带地形条件的（紧挨河、湖或山）每座城市都造得了，卡片不因地形变灰，放的时候只在满足条件的地方发亮；只显示本气候能造的', '还没解锁的：锁和等级，照样写价格', '奖励建筑的类别是奖杯；卡片可以左右滑'],
    draw(a) {
      a.dock({ on: 'build', buildDot: true });
      moneyOnly(a);
      const t = tray(a, REWARDS, 7, [7], 64);
      const its = t.querySelectorAll('.item');
      for (let i = 0; i < 5; i += 1) coAbove(a, i + 1, its[i]);
      a.coAt(6, t.querySelectorAll('.cat')[7], 18, -10);
    },
  },
  {
    id: 'D3', title: '画路（松手以后）', from: 'D1 选两车道或四车道',
    query: q({ zoom: 0.42, x: 33, y: 36 }),
    notes: ['左上返回：先回到 D1，再返回回到地图；没确认的一笔直接丢掉。点工具名换工具', '建造模式顶部只留资金一格，在第二行', '手指拖动，吸附八个方向；拖动时路面按负荷淡淡着色，松手后收起', '松手后两端出把手：拖把手改长短，或从端点接着拉一段，一起算价', '每个新路口冒一个推荐图标（三四条路是红绿灯，五条以上是环岛）；点它在红绿灯和环岛之间切换', '价格气泡：造价、每天维护费；要征收时写几栋、多少人，这些楼描红', '✕ 丢掉这一笔；✓ 确认 → D7，确认后留在建造模式接着画。钱不够时 ✓ 变灰，气泡写差多少（B4）'],
    draw(a) {
      const y = 37;
      const hit = hits(a, (p) => p.px > 25.5 && p.px < 37.5 && Math.abs(p.py - y - 0.5) < 1.1);
      for (const p of hit) a.svg(a.parcelShape(p, RED));
      a.svg(rect(a, 26, y, 36, y, GHOST));
      handle(a, 26.1, y + 0.5);
      const h2 = handle(a, 36.9, y + 0.5);
      const pick = [];
      for (const x of [29, 34]) {
        const [sx, sy] = a.P(x + 0.5, y + 0.5);
        pick.push(a.add(`<div class="picker emo" style="left:${sx}px;top:${sy - 6}px"><div class="on" style="width:44px;height:44px">🚦</div></div>`));
      }
      const top = modeTop(a, { icon: '🛣️', name: '两车道' });
      const pr = price(a, 31.5, y, `<span class="g">¥220</span> · 每天 −¥11<br>${levy(hit)}`, { dx: 40, dy: 120, below: true });
      const cf = confirm(a);
      coBack(a, 1, top);
      a.coAt(2, top.money, top.money.offsetWidth + 14, 14);
      a.co(3, ...a.P(31.5, y + 1.6));
      a.co(4, h2[0] + 4, h2[1] - 28);
      a.coAt(5, pick[1], pick[1].offsetWidth + 12, 8);
      a.coAt(6, pr, -14, 10);
      a.coAt(7, cf, -14, 30);
    },
  },
  {
    id: 'D3b', title: '画到边界修线头', from: 'D11 画铁路（或 D12 画高速）拉到城市边上',
    query: q({ zoom: 0.44, x: 60, y: 38 }),
    notes: ['边界外是邻居城市的灰色画面（G4）；邻居的名字在这条边的中点外侧', '虚影第一次拉到离边界几格以内时问服务端一次，虚影末端转圈；这一笔里记住结果', '能接的边界格发亮', '不能接的变灰，带禁止图标（对面是水、陡坡、邻居的设施或干线旁边）', '没网时边界不发亮，✓ 变灰，资金旁一个断网图标', '被对方抢先：工地变回空地，资金回到确认前的数，旁边飘“+¥N”（已付的全额退回），镜头飞到对方的接口打开 G2', '确认后这段完工时，线头就是对北岭的请求：对方 7 天内要接上'],
    draw(a) {
      grey(a, 'e', { lines: [{ kind: 'highway', pts: [[64, 7.5], [124, 7.5]] }, { kind: 'river', pts: [[64, 51.5], [124, 54]] }] });
      for (let y = 30; y <= 49; y += 1) {
        const ok = y >= 33 && y <= 43;
        a.svg(a.cellDiamond(63, y, ok ? 'fill="rgba(255,214,90,.75)" stroke="#fff3a8" stroke-width="2"' : 'fill="rgba(120,120,120,.6)" stroke="#ddd" stroke-width="1"'));
      }
      for (const y of [45, 48]) a.label(63.5, y + 0.5, '<span class="emo" style="font-size:14px">🚫</span>');
      railGhost(a, [[50.5, 39.5], [63.6, 39.5]]);
      const [ex, ey] = a.P(63.6, 39.5);
      a.add(`<div style="position:absolute;left:${ex - 18}px;top:${ey - 18}px;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:rgba(13,36,46,.85);border:2px solid #ffd76a;color:#ffd76a">${SPIN}</div>`);
      const nm = nbName(a, 'e', 'e', { at: [70, 44] });
      modeTop(a, { icon: '🚆', name: '铁路线' });
      price(a, 55, 39.5, '<span class="g">¥840</span> · 每天 −¥42', { dy: 16, below: true });
      confirm(a);
      const off = inset(a, { left: 8, top: 150, width: 176, title: '没网时', body: `${capMini('48,203', OFFLINE)}${mini({ cols: 9, rows: 5, cw: 9, cells: [0, 1, 2, 3, 4].map((y) => [8, y, '#bbb']), lines: [[[[1, 2.5], [8.9, 2.5]], 'stroke="#2a8fa8" stroke-width="5" stroke-dasharray="4 3"']] })}<div style="display:flex;justify-content:flex-end;margin-top:2px"><span style="width:30px;height:30px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:900;background:#999;border:2px solid #e9c46a">✓</span></div>` });
      const lost = inset(a, { left: 196, top: 150, width: 186, title: '被对方抢先', body: `${capMini('48,203', '<b style="color:#8de07c;font-size:15px">+¥840</b>')}${mini({ cols: 9, rows: 5, cw: 9, icons: [[8.6, 2.5, '🎯', 13]], cells: [[8, 2, '#ffe48a']] })}<div style="font-size:12px;color:#ffeab0">虚影和工地消失，镜头飞到对方的接口 → G2</div>` });
      a.coAt(1, nm, -14, 15);
      a.co(2, ex + 24, ey - 24);
      a.co(3, ...a.P(62.2, 35));
      a.co(4, ...a.P(62.2, 46.5));
      a.coAt(5, off, off.offsetWidth - 8, 8);
      a.coAt(6, lost, lost.offsetWidth - 8, 8);
      a.co(7, ex - 4, ey + 32);
    },
  },
  {
    id: 'D3c', title: '修线头：这条边接不了，或线没连到主路网', from: 'D3b 把线头拉到边界',
    query: q({ zoom: 0.36, x: 56.9, y: 19.2 }),
    notes: ['线没连到人口最多的那片路网（这里的货运站在一段孤立的路上）：服务端不让修，边界不发亮，虚影上一个断链图标', '人口最多的那片路网描一圈淡金光：把站和这片连起来，边界才发亮', '✓ 变灰，点不了：一格孤头逼不了邻居', '整条边都不能接时，边上画原因：嫩芽和天数是对方在保护期', '已有接口的圈闪一下：这对邻居之间已经有这种接口', '时钟加天数：冷却期，拆掉没人接的线头后几天内不能再往这边修'],
    draw(a) {
      goldNet(a);
      grey(a, 'e', { lines: [{ kind: 'highway', pts: [[64, 7.5], [124, 7.5]] }] });
      a.svg(rect(a, 53, 21, 58, 21, 'fill="#7c8288" stroke="#4a4f53" stroke-width="1.5"', 0.1));
      a.svg(rect(a, 57, 19, 58, 20, 'fill="rgba(255,255,255,.88)" stroke="#2a8fa8" stroke-width="3"', 0.05));
      a.label(58, 20, '<span class="emo" style="font-size:22px">🚉</span>');
      railGhost(a, [[59, 20], [63.6, 20]]);
      const lk = brokenAt(a, 61.3, 20);
      modeTop(a, { icon: '🚆', name: '铁路线' });
      price(a, 61.5, 19.5, '<span class="g">¥300</span> · 每天 −¥15', { dy: -60 });
      const cf = confirm(a, { ok: false });
      const row = (label, edge) => `<div style="display:flex;align-items:center;gap:8px;margin:4px 0">${mini({ cols: 2, rows: 6, cw: 8, width: '62px', cells: [0, 1, 2, 3, 4, 5].map((i) => [1, i, '#bbb']), icons: [[1.5, 3, edge, 14]] })}<div style="flex:1">${label}</div></div>`;
      const box = inset(a, { left: 8, top: 520, width: 200, title: '整条边都不能接时', body: `${row('<span class="cap emo" style="height:26px;padding:0 8px;font-size:13px;background:#2f6b3a">🌱 剩 2 天</span>', '🌱')}${row('<span style="display:inline-block;width:26px;height:26px;border-radius:50%;border:3px solid #3fa75a;box-shadow:0 0 0 5px rgba(126,224,138,.45)"></span> 一闪', '◯')}${row('<span class="cap emo" style="height:26px;padding:0 8px;font-size:13px">🕒 3 天</span>', '🕒')}` });
      const rows = box.querySelectorAll(':scope > div > div');
      const isolated = (x, y) => y === 21 && x >= 53 && x <= 58;
      const net = onScreen(a, roadCells(a).filter(([x, y]) => !isolated(x, y)), 150, 300);
      a.coAt(1, lk, 38, 0);
      if (net) a.co(2, ...net);
      a.coAt(3, cf.lastElementChild, cf.lastElementChild.offsetWidth - 10, -14);
      rows.forEach((r, i) => a.coAt(4 + i, r, r.offsetWidth - 6, 14));
    },
  },
  {
    id: 'D4', title: '画路碰到高速公路：匝道自动出现', from: 'D3 把路拉到高速公路边上',
    query: q({ zoom: 0.6, x: 24, y: 7 }),
    notes: ['两车道或四车道拉到高速公路边上', '松手时自动冒出一段发光的匝道虚影，方向由系统按松手的方向选；不在菜单里，几级都能接', '价格气泡把匝道一起算进去', '边界外是邻居城市的灰色画面（G4）', '和路一起确认；碰到水和陡坡时匝道虚影变灰、不弹出'],
    draw(a) {
      grey(a, 'n', { lines: [{ kind: 'highway', pts: [[40.5, 0], [40.5, -60]] }] });
      a.svg(rect(a, 26, 8, 26, 11, GHOST));
      glow(a, [[26.5, 8.3], [26.9, 7.95], [27.6, 7.75], [29.5, 7.7]]);
      handle(a, 26.5, 11.9);
      modeTop(a, { icon: '🛣️', name: '两车道' });
      const pr = price(a, 26, 11, '<span class="g">¥80 + 匝道 ¥300</span><br>每天 −¥14', { dx: 90, dy: 30, below: true });
      const cf = confirm(a);
      const nm = nbName(a, 'n', 'n', { at: [26, -3] });
      a.co(1, ...a.P(25.4, 10.2));
      const [rx, ry] = a.P(27.6, 7.75);
      a.co(2, rx + 6, ry - 24);
      a.coAt(3, pr, -14, 10);
      a.coAt(4, nm, -14, 15);
      a.coAt(5, cf, -14, 30);
    },
  },
  {
    id: 'D4b', title: '匝道接上邻居修来的高速公路', from: 'G2 点“去接上”（对着你的是高速线头）',
    query: q({ zoom: 0.42, x: 42, y: 59 }),
    notes: ['边界外：江屿市修到边界的高速公路，金色光环和“剩 5 天”', '“去接上”直接拿起两车道：从城里的路拉到线头边上', '松手时自动冒出匝道，接到对方的线头上；自己还没解锁高速公路（7 级）也能接', '价格气泡含匝道；要征收时照样描红', '✓ 确认就算开工，期限冻结（G2b）；完工后光环停下，变成绿圈'],
    draw(a) {
      grey(a, 's', { lines: [{ kind: 'highway', pts: [[48.5, 64], [48.5, 124]] }, { kind: 'highway', pts: [[12.5, 64], [12.5, 124]] }] });
      a.svg(rect(a, 35, 60, 46, 60, GHOST));
      glow(a, [[46.6, 60.5], [47.6, 60.8], [48.3, 61.6], [48.5, 63.9]]);
      handle(a, 35.1, 60.5);
      const pt = port(a, 48.5, 64.3, '🛤️', 'theirs');
      const dl = deadline(a, pt[0] + 34, pt[1] + 8, '剩 5 天');
      modeTop(a, { icon: '🛣️', name: '两车道' });
      const pr = price(a, 41, 60, '<span class="g">¥240 + 匝道 ¥300</span> · 每天 −¥16', { dx: 40, dy: -10 });
      const cf = confirm(a);
      a.coAt(1, dl, dl.offsetWidth + 6, 0);
      a.co(2, ...a.P(38, 61.4));
      a.co(3, ...a.P(47, 62.6));
      a.coAt(4, pr, -14, 10);
      a.coAt(5, cf, -14, 30);
    },
  },
  {
    id: 'D5', title: '划区', from: 'D1 → 分区类 → 住宅、商业、工业或农业',
    query: q({ zoom: 0.38, x: 26, y: 37 }),
    notes: ['资金下面一行选密度上限：低、中、高（高密度 6 级解锁，锁着点了冒“Lv6 解锁”）；农业没有这一排', '刷子从一点拖到另一点，拉出贴着路的矩形；虚影是这一类的固定颜色：住宅绿、商业蓝、工业黄、农业棕', '刷在另一类的楼上就是改规划：被换掉的楼描红，价格气泡写征收几栋、多少人', '右边四根需求条，同样四色，只用长短表示需求；只在拿起刷子时出现', '坡上的格子画淡，那里不长楼', '✓ 确认以后楼几分钟内慢慢长出来。取消分区用推土机点楼，拆的是“分区 + 楼”（D9）'],
    draw(a) {
      const [c1, r1, c2, r2] = [24, 33, 28, 37];
      const cells = [];
      for (let y = r1; y <= r2; y += 1) for (let x = c1; x <= c2; x += 1) if (!a.isRoad(x, y)) cells.push([x, y]);
      for (const [x, y] of cells) a.svg(a.cellDiamond(x, y, `fill="${ZC.R}" fill-opacity="${x === c2 && y === r2 ? 0.25 : 0.75}" stroke="rgba(255,255,255,.8)" stroke-width="1"`));
      a.svg(rect(a, c1, r1, c2, r2, 'fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="8 5"', 0));
      const hit = hits(a, (p) => p.zone !== 1 && p.px >= c1 && p.px <= c2 + 1 && p.py >= r1 && p.py <= r2 + 1);
      for (const p of hit) a.svg(a.parcelShape(p, 'fill="none" stroke="#e5332a" stroke-width="3"'));
      modeTop(a, { icon: '<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:#5fbf5a;border:2px solid #fff"></span>', name: '住宅' });
      const dens = row2(a, `${subBtn('低')}${subBtn('中', { on: true })}${subBtn('高', { lock: 6 })}`, ROW3);
      const dem = a.add(`<div class="demand emo">${[['🏠', 80, ZC.R], ['🏬', 45, ZC.C], ['🏭', 22, ZC.I], ['🌾', 55, ZC.F]].map(([e, v, c]) => `<div><div class="col"><i style="height:${v}%;background:${c}"></i></div>${e}</div>`).join('')}</div>`);
      const pr = price(a, c2 + 1, r1, `<span class="g">¥${cells.length * 6}</span><br>${levy(hit)}`, { dy: -6 });
      const cf = confirm(a);
      a.coAt(1, dens.lastElementChild, dens.lastElementChild.offsetWidth + 12, 20);
      a.co(2, ...a.P(c1 + 0.6, r2 + 0.6));
      a.coAt(3, pr, -14, 10);
      a.coAt(4, dem, -14, 20);
      a.co(5, ...a.P(c2 + 0.5, r2 + 0.5));
      a.coAt(6, cf, -14, 30);
    },
  },
  {
    id: 'D6', title: '放公共服务', from: 'D1 → 公共服务类 → 选一种',
    query: q({ zoom: 0.36, x: 28, y: 33 }),
    notes: ['自动打开这种服务的覆盖视图：覆盖到的住宅青绿，没覆盖的橙色一闪一闪', '点一下放下虚影，按在虚影上再拖是微调；同时画出覆盖圈', '门自动朝最近的路，不旋转', '落在楼上：这些楼描红，走征收；放不了的地方虚影变灰', '价格气泡；钱不够时 ✓ 变灰，写差多少（B4）', '顶部只留资金一格；左上返回回 D1'],
    draw(a) {
      a.fade(0.5);
      const hosp = a.parcels.filter((p) => p.zone === 5 && p.use === 'hospital');
      for (const h of hosp) a.svg(a.ring(h.px, h.py, 8, 'fill="rgba(42,143,168,.10)" stroke="#2a8fa8" stroke-width="2" stroke-dasharray="8 6"'));
      const covered = (p) => hosp.some((h) => Math.hypot(h.px - p.px, h.py - p.py) <= 8);
      for (const p of a.parcels.filter((x) => x.zone === 1)) a.svg(a.parcelShape(p, covered(p) ? 'fill="rgba(42,157,143,.75)"' : 'fill="rgba(240,120,60,.85)" stroke="#fff" stroke-width="1.5"'));
      const [cx, cy] = [26, 30];
      const hit = hits(a, (p) => p.px > cx - 0.3 && p.px < cx + 2.3 && p.py > cy - 0.3 && p.py < cy + 2.3);
      for (const p of hit) a.svg(a.parcelShape(p, RED));
      a.svg(a.ring(cx + 1, cy + 1, 8, 'fill="rgba(255,214,90,.15)" stroke="#ffd76a" stroke-width="3" stroke-dasharray="10 6"'));
      a.svg(rect(a, cx, cy, cx + 1, cy + 1, 'fill="rgba(255,255,255,.9)" stroke="#2a8fa8" stroke-width="3"', 0));
      a.label(cx + 1, cy + 1, '<span class="emo" style="font-size:26px">🏥</span>');
      const door = [[cx + 1, cy + 2], [cx + 1, cy + 2.9]];
      a.svg(a.line(door, 'stroke="#13303d" stroke-width="5" stroke-linecap="round"') + a.line(door, 'stroke="#ffd76a" stroke-width="3" stroke-linecap="round"'));
      const [hx, hy] = a.P(cx + 2.2, cy + 1.6);
      finger(a, hx, hy, '<span style="font-size:14px;color:#fff;font-weight:900;text-shadow:0 1px 2px #000">⇆</span>');
      const top = modeTop(a, { icon: '🏥', name: '医院' });
      const pr = price(a, cx + 1, cy, `<span class="g">¥3,000</span> · 每天 −¥80<br>${levy(hit)}`, { dy: -22 });
      a.add('<div class="legend"><span class="emo">🏥</span><i style="background:#2a9d8f"></i><i style="background:#f0783c"></i></div>');
      confirm(a);
      const miss = onScreen(a, a.parcels.filter((p) => p.zone === 1 && !covered(p)), 90, 600);
      if (miss) a.co(1, miss[0] + 16, miss[1] - 16);
      a.co(2, ...a.P(cx + 6.5, cy + 6.5));
      a.co(3, ...a.P(cx + 1.8, cy + 3.2));
      if (hit[0]) a.co(4, ...a.P(hit[0].px - 0.6, hit[0].py - 0.6));
      a.coAt(5, pr, -14, 10);
      coBack(a, 6, top);
    },
  },
  {
    id: 'D7', title: '确认以后：10 秒撤销，接着画', from: 'D3、D5、D6 点 ✓',
    query: q({ zoom: 0.32, x: 32.5, y: 36.5 }),
    notes: ['刚确认的这一笔变成工地，开始施工；被征收的楼慢慢搬空、变淡', '撤销按钮倒数 10 秒：点了全额退款、按原样恢复。只对最后一笔', '前面确认的一笔：撤销已经过了，只能在工地上取消（D8）', '确认后留在建造模式，工具还拿在手上，可以接着画下一笔', '倒数完之前按钮一直在，退出建造模式也在'],
    draw(a) {
      a.svg(rect(a, 26, 37, 36, 37, 'fill="url(#hatch)" fill-opacity=".85" stroke="#7a5a10" stroke-width="2"'));
      a.svg(rect(a, 24, 33, 24, 36, 'fill="url(#hatch)" fill-opacity=".55" stroke="#7a5a10" stroke-width="2"'));
      const hit = hits(a, (p) => p.px > 25.5 && p.px < 37.5 && Math.abs(p.py - 37.5) < 1.1);
      for (const p of hit) a.svg(a.parcelShape(p, 'fill="rgba(255,255,255,.6)" stroke="#bbb" stroke-width="1.5"'));
      a.svg(rect(a, 37, 37, 40, 37, 'fill="rgba(42,143,168,.35)" stroke="#fff" stroke-width="2" stroke-dasharray="6 4"'));
      const [fx, fy] = a.P(40.5, 37.8);
      finger(a, fx - 6, fy - 4);
      modeTop(a, { icon: '🛣️', name: '两车道', money: '47,983' });
      const u = a.add('<div class="undo"><span class="cnt">7</span>撤销</div>');
      const [nx, ny] = a.P(31, 38);
      a.co(1, nx, ny + 18);
      a.coAt(2, u, u.offsetWidth + 14, 14);
      const [px, py] = a.P(24.5, 34);
      a.co(3, px - 24, py);
      a.co(4, fx + 6, fy + 52);
      a.co(5, 60, 700);
    },
  },
  {
    id: 'D8', title: '工地气泡：加速和取消', from: '点地图上任何一个在建的工程',
    query: MAIN,
    notes: ['工程名、进度条、剩余时间（1 小时以上写“1 时 12 分”，以下写“06:00”）。这里是在建的体育场，工期 10 分钟、做了四成', '看视频加速：剩余不到 30 分钟写“立即完成”（图里的样子），否则写“−30 分钟”', '取消：红色，按住约 1 秒，按钮里的进度走满才取消；写退回多少钱（没建的那部分）', '自己长的楼也有进度环，但气泡里没有这两个按钮', '点气泡外面：先关掉气泡，这一下不会点到地图上的东西'],
    draw(a) {
      const p = a.near(1, 33, 41);
      site(a, p, 0.4);
      base(a);
      const b = a.bubble(p.px, p.py, `<div class="t emo">🏗️ 体育场</div><div class="meter"><i style="width:40%;background:linear-gradient(#8de07c,#2f8f3a)"></i></div><div style="margin-top:4px;font-weight:800;font-size:14px" class="emo">⏱ 06:00</div><div class="bb">${a.btn('立即完成', '', true)}<span class="btn red hold"><i class="fill" style="width:45%"></i><span>按住 退 ¥3,000</span></span></div>`, { lift: 30 });
      const bs = b.querySelectorAll('.btn');
      a.coAt(1, b, b.offsetWidth - 14, 40);
      a.coAt(2, bs[0], 24, bs[0].offsetHeight + 16);
      a.coAt(3, bs[1], bs[1].offsetWidth - 24, bs[1].offsetHeight + 16);
      a.co(4, 40, 640);
      a.co(5, 330, 560);
    },
  },
  {
    id: 'D9', title: '拆除：点一下选中', from: 'D1 点推土机',
    query: q({ zoom: 0.42, x: 32, y: 36 }),
    notes: ['拆除模式：点一下只是选中，描红', '点楼选中的是这栋楼的分区格，拆的是“分区 + 楼”，这也是取消分区的办法；点路选中两个路口之间的一段', '气泡画出它是什么、住着多少人', '“拆”按一下就拆；10 秒内可以撤销（同 D7），撤销之前拆的东西照旧起作用', '拖动可以一次选好几样 → D9b'],
    draw(a) {
      const p = a.near(1, 32, 35, built);
      a.svg(a.parcelShape(p, 'fill="rgba(229,51,42,.35)" stroke="#e5332a" stroke-width="3.5" stroke-dasharray="7 4"'));
      modeTop(a, { icon: '🚜', name: '拆除', drop: false });
      const b = a.bubble(p.px, p.py, `<div class="t emo">🏠 住宅 + 分区</div><div style="margin-top:4px;font-weight:800;font-size:14px" class="emo">👥 46</div><div class="bb">${a.btn('拆', 'red')}</div>`, { lift: 20 });
      a.co(1, ...a.P(p.px - 0.9, p.py + 0.6));
      a.coAt(2, b, -14, 16);
      a.coAt(3, b, -14, 46);
      a.coAt(4, b.querySelector('.btn'), b.querySelector('.btn').offsetWidth + 14, 16);
      a.co(5, 60, 700);
    },
  },
  {
    id: 'D9b', title: '拆除：拖动一次选好几样', from: 'D9 在地图上拖',
    query: q({ zoom: 0.4, x: 27, y: 33 }),
    notes: ['沿路拖：选中连续的几段路（两个路口之间算一段）', '气泡写选了几段；拆的路让楼失去门口的路时，这些楼一起描红，拆后慢慢搬空', '在分区上拖出矩形：选中里面的分区和楼，一起拆', '选中的一次拆完，10 秒内一起撤销'],
    draw(a) {
      a.svg(rect(a, 19, 32, 34, 32, 'fill="rgba(229,51,42,.5)" stroke="#e5332a" stroke-width="3"', 0));
      const cut = hits(a, (p) => p.px > 19 && p.px < 34 && Math.abs(p.py - 31.5) < 0.8 && !a.isRoad(Math.floor(p.px), Math.floor(p.py) - 1));
      for (const p of cut.slice(0, 2)) a.svg(a.parcelShape(p, 'fill="rgba(229,51,42,.18)" stroke="#e5332a" stroke-width="2" stroke-dasharray="5 4"'));
      for (const x of [19, 23, 29, 34]) a.svg(a.cellDiamond(x, 32, 'fill="none" stroke="#fff" stroke-width="2"'));
      const [fx, fy] = a.P(34.4, 32.8);
      finger(a, fx - 8, fy - 4);
      modeTop(a, { icon: '🚜', name: '拆除', drop: false });
      const b = a.bubble(26.5, 32.5, `<div class="t emo">🛣️ 3 段路</div><div style="margin-top:4px;font-weight:800;font-size:14px" class="emo">🏠×2　👥 88</div><div class="bb">${a.btn('拆', 'red')}</div>`, { lift: 16 });
      const box = inset(a, { left: 8, top: 600, width: 200, title: '在分区上拖出矩形', body: mini({ cols: 10, rows: 7, cw: 9, cells: [[2, 1, ZC.R], [3, 1, ZC.R], [4, 1, ZC.R], [2, 2, ZC.R], [3, 2, ZC.R], [4, 2, ZC.R], [2, 3, ZC.C], [3, 3, ZC.C], [4, 3, ZC.C], [6, 2, ZC.R], [7, 2, ZC.R]], lines: [[[[1.8, 0.8], [5.2, 0.8], [5.2, 4.2], [1.8, 4.2], [1.8, 0.8]], 'stroke="#e5332a" stroke-width="2.5" stroke-dasharray="4 3"']], icons: [[3.5, 2.5, '🏠', 11], [5.4, 4.6, '👆', 13]] }) });
      a.co(1, ...a.P(21, 33.4));
      a.coAt(2, b, -14, 30);
      a.coAt(3, box, box.offsetWidth - 8, 8);
      a.coAt(4, b.querySelector('.btn'), b.querySelector('.btn').offsetWidth + 14, 16);
    },
  },
  {
    id: 'D10', title: '拆通往邻居的那一段：按住确认', from: 'D9 点到修到边界的高速、匝道、铁路或货运站',
    query: q({ zoom: 0.5, x: 62, y: 11 }),
    notes: ['选中的是连着邻居的那一段；边界外是邻居的灰色画面（G4）。这个例子是接在北岭高速线头上的匝道', '气泡里的小图画拆了以后的样子：北岭的高速线头还对着你，你这边亮起金色光环和“7 天”，要在 7 天内接回来', '对方那头没有线头、或者对面已是空白：接口直接消失', '对方正在接你：对方完工以后，你要接回来', '这三种“拆”都要按住约 1 秒，进度走满才拆；拆边界段要联网，10 秒内可以撤销'],
    draw(a) {
      grey(a, 'e', { lines: [{ kind: 'highway', pts: [[64, 7.5], [124, 7.5]] }] });
      isoRoad(a, 61, 11, 61, 20);
      const ramp = [[63.95, 7.6], [62.9, 8.1], [61.9, 9.1], [61.5, 10.3], [61.5, 11.2]];
      a.svg(a.line(ramp, 'stroke="#e5332a" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" opacity=".55"') + a.line(ramp, 'stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="6 4"'));
      nbName(a, 'e', 'e', { at: [70, 14] });
      modeTop(a, { icon: '🚜', name: '拆除', drop: false });
      const after = `<div class="mini emo" style="grid-template-columns:1fr auto 1fr"><span style="position:relative">🏙️<i style="position:absolute;left:50%;top:-10px;transform:translateX(-50%);font-style:normal"><span class="ddl" style="font-size:11px">7 天</span></i></span><span class="cut">✂</span><span>${NB.e.av}🛤️</span></div>`;
      const b = a.bubble(62.4, 8.7, `<div class="t emo">🛣️ 匝道 · 通往 ${NB.e.av}</div>${after}<div class="bb"><span class="btn red hold"><i class="fill" style="width:62%"></i><span>按住 拆</span></span></div>`, { below: true });
      const cases = (body) => `<div style="display:flex;align-items:center;gap:6px;font-size:22px" class="emo">${body}</div>`;
      const c2 = inset(a, { left: 8, top: 150, width: 176, title: '对方没有线头', body: cases('🏙️ <span style="font-size:13px;color:#ff9f93;font-weight:900">✂</span> <span style="font-size:13px;color:#ddd">接口消失</span>') });
      const c3 = inset(a, { left: 192, top: 150, width: 190, title: '对方正在接你', body: cases(`🏙️ <span style="font-size:13px;color:#ff9f93;font-weight:900">✂</span> ${NB.e.av}<span style="font-size:12px;color:#ffeab0">🏗️ 完工后你要接回来</span>`) });
      const [rx, ry] = a.P(62.9, 8.1);
      a.co(1, rx + 10, ry - 26);
      a.coAt(2, b.querySelector('.mini'), -14, 14);
      a.coAt(3, c2, c2.offsetWidth - 8, 8);
      a.coAt(4, c3, c3.offsetWidth - 8, 8);
      a.coAt(5, b.querySelector('.btn'), b.querySelector('.btn').offsetWidth + 14, 18);
    },
  },
  {
    id: 'D11', title: '铁路：画线、放货运站和客运站', from: 'D1 选铁路线、货运站或客运站（3 级解锁）',
    query: q({ zoom: 0.36, x: 51.2, y: 38.8 }),
    notes: ['铁路线和画路一样拖，吸附八个方向；过坡、过河自动修坡道和桥。这里是从建好的铁路接着往北拉一段', '和道路相交处自动做平交道口；碰到地面高速公路自动修跨线桥', '货运站放在铁路线上：本城的货从这里装车', '客运站也放在铁路线上；没接上邻居的铁路网时，站上一个断链图标，外地客人来不了', '修到边界就是线头（D3b）；接邻居铁路线头的货运站可以单独放在边界旁（G3）', '价格气泡：新拉的这一段的造价和每天维护费'],
    draw(a) {
      a.svg(rect(a, 51, 40, 53, 41, 'fill="url(#hatch)" fill-opacity=".85" stroke="#7a5a10" stroke-width="2"', 0.05));
      a.svg(rect(a, 51, 44, 53, 45, 'fill="rgba(255,255,255,.88)" stroke="#2a8fa8" stroke-width="3"', 0.05));
      railBuilt(a, [[52.5, 39.5], [52.5, 46.8]]);
      railGhost(a, [[52.5, 33.5], [52.5, 39.5]]);
      const [kx, ky] = a.P(52.5, 42.5);
      a.svg(`<g transform="translate(${kx} ${ky})"><rect x="-13" y="-13" width="26" height="26" rx="6" fill="#fff" stroke="#13303d" stroke-width="2"/><path d="M-7 -7 L7 7 M7 -7 L-7 7" stroke="#d2a01c" stroke-width="4"/></g>`);
      a.label(52, 41, '<span class="emo" style="font-size:24px">🚉</span>');
      a.label(52, 44.8, '<span class="emo" style="font-size:22px">🚏</span>');
      const lk = brokenAt(a, 53.8, 44);
      const top = handle(a, 52.5, 33.5);
      handle(a, 52.5, 39.5);
      modeTop(a, { icon: '🚆', name: '铁路线' });
      const pr = price(a, 52.5, 34.5, '<span class="g">¥360</span> · 每天 −¥18', { dx: -70, dy: -10 });
      confirm(a);
      a.co(1, ...a.P(51.2, 36.6));
      a.co(2, kx + 26, ky - 4);
      a.co(3, ...a.P(50.4, 40.4));
      a.coAt(4, lk, 38, 4);
      a.co(5, top[0] - 6, top[1] - 30);
      a.coAt(6, pr, -14, 10);
    },
  },
  {
    id: 'D12', title: '高速公路：地面、高架、立交', from: 'D1 选高速公路（7 级解锁）',
    query: q({ zoom: 0.36, x: 22, y: 30 }),
    notes: ['高速公路和画路一样拖；虚影上的小条左右滑，在地面和高架之间换', '高架贵，但不割断城市：下面只能有道路，压到的楼描红走征收', '和另一条高速公路相交时自动套用立交模板，也是左右滑换几种', '画过普通路时：地面高速自动修跨线桥，高架从上面过，都不平交', '修到边界就是线头（D3b），每对邻居最多一个高速接口', '价格气泡：造价、每天维护费；要征收时写几栋、多少人'],
    draw(a) {
      const [y0, y1] = [29, 30];
      const under = hits(a, (p) => p.px > 13 && p.px < 41 && p.py > y0 - 0.2 && p.py < y1 + 1.2);
      for (const p of under) a.svg(a.parcelShape(p, RED));
      a.svg(rect(a, 13, y0, 40, y1, 'fill="rgba(0,0,0,.25)"', 0.05));
      a.svg(`<g transform="translate(0 -16)">${rect(a, 13, y0, 40, y1, 'fill="rgba(42,143,168,.7)" stroke="#fff" stroke-width="2.5" stroke-dasharray="8 5"', 0.05)}</g>`);
      for (let x = 15; x <= 39; x += 4) {
        const [px, py] = a.P(x, y1);
        a.svg(`<rect x="${px - 3}" y="${py - 16}" width="6" height="16" fill="#5b6266"/>`);
      }
      glow(a, [[12.5, 26.5], [11.2, 28], [11.5, 29.6], [13, 30.2], [12.5, 31.5], [12.5, 33]]);
      glow(a, [[13.2, 29.6], [12.6, 28.4], [12.5, 26.8]]);
      const [tx, ty] = a.P(24, y0 + 1);
      const sw = a.add(`<div style="position:absolute;left:${tx}px;top:${ty - 44}px;transform:translate(-50%,-50%)">${swiper(['地面', '高架'], 1)}</div>`);
      const [, iy0] = a.P(12, 27.5);
      const sw2 = a.add(`<div style="position:absolute;left:8px;top:${Math.max(150, iy0 - 70)}px">${swiper(['喇叭', '苜蓿叶'], 0, 12)}</div>`);
      modeTop(a, { icon: '🛤️', name: '高速公路', money: '186,400' });
      const pr = price(a, 36, y1 + 1, `<span class="g">¥18,400</span> · 每天 −¥320<br>${levy(under)}`, { dy: 30, below: true });
      confirm(a);
      a.coAt(1, sw, sw.offsetWidth + 12, 12);
      const red = onScreen(a, under, 200, 470);
      if (red) a.co(2, red[0], red[1] + 14);
      a.coAt(3, sw2, sw2.offsetWidth + 12, 12);
      a.co(4, ...a.P(23.5, y1 + 1.6));
      let end = null;
      for (let x = 40; x > 13 && !end; x -= 0.5) {
        const [sx, sy] = a.P(x, y0);
        if (sx < a.W - 40) end = [sx, sy];
      }
      if (end) a.co(5, end[0], end[1] - 46);
      a.coAt(6, pr, -14, 10);
    },
  },
  {
    id: 'D13', title: '公交线：放站、成环、删站', from: 'D1 → 公交地铁类 → 公交线（4 级解锁）；或 E9 点“改线路”',
    query: q({ zoom: 0.28, x: 24.5, y: 28 }),
    notes: ['依次点路面放站，系统沿最短的路连起来；公交线不走高速公路和匝道', '点回第一站就成了环线，第一站描金', '点已经放好的站，删掉这一站，线路重新连', '点空处结束这条线', '顶部写线路颜色；价格只有每天的维护费，按站数和线路长度算'],
    draw(a) {
      const stops = [[19.5, 23.5], [29.5, 23.5], [29.5, 32.5], [19.5, 32.5]];
      const loop = [...stops, stops[0]];
      for (let i = 0; i < loop.length - 1; i += 1) {
        const seg = a.simplify(a.roadPath(loop[i], loop[i + 1]));
        a.svg(a.line(seg, 'stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"') + a.line(seg, `stroke="#e07a1f" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" ${i === loop.length - 2 ? 'stroke-dasharray="10 6"' : ''}`));
      }
      stops.forEach(([x, y], i) => {
        const [sx, sy] = a.P(x, y);
        a.svg(`<circle cx="${sx}" cy="${sy}" r="${i === 0 ? 16 : 12}" fill="#fff" stroke="${i === 0 ? '#ffd76a' : '#e07a1f'}" stroke-width="${i === 0 ? 5 : 3.5}"/><text x="${sx}" y="${sy + 5}" text-anchor="middle" font-size="14">🚌</text>`);
      });
      const [dx, dy] = a.P(24.5, 32.5);
      a.svg(`<circle cx="${dx}" cy="${dy}" r="12" fill="#eee" stroke="#888" stroke-width="3" stroke-dasharray="4 3"/><text x="${dx}" y="${dy + 5}" text-anchor="middle" font-size="15" font-weight="900" fill="#777">×</text>`);
      const [ex, ey] = a.P(25, 27);
      finger(a, ex, ey);
      const top = modeTop(a, { icon: lineDot('#e07a1f'), name: '公交 2 号线' });
      price(a, 29.5, 23.5, '每天 <span class="g">−¥64</span> · 4 站', { dy: -16 });
      confirm(a);
      const [s3x, s3y] = a.P(...stops[2]);
      a.co(1, s3x + 24, s3y + 12);
      const [s1x, s1y] = a.P(...stops[0]);
      a.co(2, s1x - 26, s1y - 16);
      a.co(3, dx + 22, dy + 14);
      a.co(4, ex + 40, ey + 10);
      a.coAt(5, top.title, top.title.offsetWidth + 10, 14);
    },
  },
  {
    id: 'D14', title: '地铁：地面变淡，画线放站', from: 'D1 → 公交地铁类 → 地铁线（6 级解锁）；或 E9 点“改线路”',
    query: q({ zoom: 0.3, x: 25, y: 38 }),
    notes: ['地面变淡，露出地下已有的线路；每条线一种颜色', '拖出新线，点格子放站；一条线是一根线或一个环，不分叉', '和已有的线交叉处自动成换乘站，画成大白圈', '站占格子，落在楼上时描红走征收；线路从楼下穿过不用征收，但经过的楼环境减分', '价格气泡；地铁不堵，维护费按站数和长度算'],
    draw(a) {
      a.fade(0.22);
      a.svg(`<rect x="0" y="0" width="${a.W}" height="${a.H}" fill="rgba(10,20,40,.35)"/>`);
      const lines = a.city.metro.lines;
      for (const [i, l] of lines.entries()) a.svg(a.line(l.points, `stroke="${METRO[i]}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity=".85"`));
      const kept = metroStations(lines);
      const seen = new Map();
      for (const st of kept) for (const s of st) { const k = s.join(','); seen.set(k, (seen.get(k) ?? 0) + 1); }
      for (const [k, n] of seen) { const [x, y] = k.split(',').map(Number); const [sx, sy] = a.P(x, y); a.svg(`<circle cx="${sx}" cy="${sy}" r="${n > 1 ? 10 : 6}" fill="#fff" stroke="#13303d" stroke-width="2.5"/>`); }
      const nl = [[14, 38.5], [44, 38.5]];
      a.svg(a.line(nl, 'stroke="#fff" stroke-width="13" stroke-linecap="round"') + a.line(nl, 'stroke="#9b59d0" stroke-width="9" stroke-linecap="round" stroke-dasharray="14 7"'));
      for (const [x, y] of [[14.5, 38.5], [25, 38.5], [36, 38.5], [43.5, 38.5]]) { const [sx, sy] = a.P(x, y); a.svg(`<circle cx="${sx}" cy="${sy}" r="7" fill="#fff" stroke="#9b59d0" stroke-width="3"/>`); }
      const [tx, ty] = a.P(19, 38.5);
      a.svg(`<circle cx="${tx}" cy="${ty}" r="12" fill="#fff" stroke="#13303d" stroke-width="3"/><circle cx="${tx}" cy="${ty}" r="17" fill="none" stroke="#ffd76a" stroke-width="3" opacity=".8"/>`);
      const hp = a.near(2, 36, 39);
      if (hp) a.svg(a.parcelShape(hp, RED));
      modeTop(a, { icon: lineDot('#9b59d0'), name: '地铁 4 号线' });
      const pr = price(a, 36, 38.5, '<span class="g">¥9,600</span> · 每天 −¥140<br><span class="emo">🏠×1　👥40</span>', { dy: -110 });
      confirm(a);
      const old = onScreen(a, kept.flat().map(([px, py]) => ({ px, py })), 250, 260);
      if (old) a.co(1, old[0] + 18, old[1] - 18);
      a.co(2, ...a.P(28, 40.4));
      a.co(3, tx + 24, ty - 18);
      if (hp) a.co(4, ...a.P(hp.px + 1.2, hp.py + 1.2));
      a.coAt(5, pr, -14, 10);
    },
  },
  {
    id: 'D15', title: '其他建造工具的样子', from: 'D1 选公园、垃圾用地、清森林、厂；或者把一样东西画在原来的上面',
    query: q({ zoom: 0.3, x: 32, y: 34 }),
    notes: ['公园：刷子划区，系统按面积和位置长出小游园、街心公园或湖滨步道', '垃圾处理用地：刷子划区，挨着已有的划就并成一块，容量变大', '清森林：刷子刷过森林，按格算价，每格几秒；画路、放东西落在森林上时，价格和工期里含清森林', '桥和坡：画路过河自动修桥，过坡自动修坡道，价格气泡一起算', '往高一档密度重刷：选“中”刷在低密度上，只写差价', '换等级：四车道画在两车道上、二级厂放在一级厂上，都只写差价；厂占地变大时多出来的格子描红走征收；往低写“不退款”', '水厂、码头、国际港：只有满足条件的格子发亮（水厂只在水边）', '换种类（水厂换地下水厂、火电换风电）：直接放在原来的上面，按新造算价'],
    draw(a) {
      a.fade(0.35);
      modeTop(a, { icon: '🌳', name: '公园' });
      const items = [
        ['公园刷子', { cells: [[2, 1, '#7fcf6a'], [3, 1, '#7fcf6a'], [2, 2, '#7fcf6a'], [3, 2, '#7fcf6a'], [4, 2, '#7fcf6a']], icons: [[3.2, 2, '🌳', 15]] }, '¥40/格 · −¥1/格·天'],
        ['垃圾处理用地', { cells: [[1, 1, '#b08a5a'], [2, 1, '#b08a5a'], [1, 2, '#b08a5a'], [2, 2, '#b08a5a'], [3, 1, '#c9a978', 'stroke="#fff" stroke-dasharray="2 2"'], [3, 2, '#c9a978', 'stroke="#fff" stroke-dasharray="2 2"']], icons: [[2, 2, '♻️', 14]] }, '并成一块 · 容量 +1,200 人'],
        ['清森林', { cells: [[2, 1, '#e8a85a'], [3, 1, '#e8a85a'], [2, 2, '#e8a85a'], [3, 2, '#e8a85a']], icons: [[1.2, 3, '🌲', 13], [2.5, 1.5, '🌲', 13], [3.5, 2.5, '🌲', 13], [4.6, 1.2, '🌲', 13]] }, '¥8/格 · 工期 00:20'],
        ['桥和坡', { cells: [0, 1, 2, 3, 4, 5, 6].map((x) => [x, 3, '#6fb6d6']), lines: [[[[3.5, 0], [3.5, 5]], 'stroke="#2a8fa8" stroke-width="5" stroke-dasharray="4 3"']], icons: [[3.6, 3.2, '🌉', 14]] }, '路 ¥80 + 桥 ¥600'],
        ['往中密度重刷', { cells: [[1, 1, ZC.R], [2, 1, ZC.R], [3, 1, ZC.R], [1, 2, ZC.R], [2, 2, ZC.R], [3, 2, ZC.R]], icons: [[2.5, 2, '中', 13]] }, '只写差价 ¥18'],
        ['换等级（路）', { cells: [0, 1, 2, 3, 4, 5, 6].map((x) => [x, 2, '#c9ccd0', 'stroke="#fff" stroke-width="1"']), lines: [[[[0, 2.5], [7, 2.5]], 'stroke="#2a8fa8" stroke-width="7" stroke-dasharray="5 3"']], icons: [[3.5, 1.3, '四', 13]] }, '四车道 · 只写差价 ¥25/格'],
        ['水厂只在水边发亮', { cells: [...[0, 1, 2, 3, 4, 5, 6].map((x) => [x, 4, '#6fb6d6']), ...[1, 2, 3, 4, 5].map((x) => [x, 3, '#ffe27a', 'stroke="#fff" stroke-width="1"'])], icons: [[3.5, 2.6, '💧Ⅰ', 12]] }, '别处的虚影变灰'],
        ['水厂换地下水厂', { cells: [[2, 1, '#9fd0f0'], [3, 1, '#9fd0f0'], [2, 2, '#9fd0f0'], [3, 2, '#9fd0f0']], icons: [[3, 2, '💧Ⅰ', 12]] }, '按新造算价 ¥1,600'],
      ];
      items.forEach(([t, m, cap], i) => {
        const left = i % 2 === 0 ? 8 : 200;
        const topY = 144 + Math.floor(i / 2) * 168;
        const el = inset(a, { left, top: topY, width: 182, title: t, body: `${mini({ cols: 7, rows: 5, cw: 11, ...m })}<div class="emo" style="margin-top:2px;font-weight:800;color:#ffeab0">${cap}</div>` });
        a.coAt(i + 1, el, el.offsetWidth - 8, 8);
      });
    },
  },
];
