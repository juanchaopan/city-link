// 点地图上的东西（E1 至 E12）和视图（F0 至 F8 及分项）。
// 示例城市是 4 级：气泡里的星级、品种和奖励建筑都不超过 4 级能有的（工业、商业最高二星，粮食一星）。
import { q, MAIN, NB, base, built, circleIcon, isoBox } from './screens-common.js';
import { ROW2, modeTop, coBack, row2, subBtn, carBtn, tri, grey, nbName, port, chip, navyTag, BROKEN } from './parts-b.js';

const EDU_COL = ['#c7c2b8', '#9ccf6a', '#2a9d8f', '#3b5ba9'];
const EDU = `<div class="stack" style="margin-top:8px">${[15, 45, 30, 10].map((v, i) => `<i style="flex:${v};background:${EDU_COL[i]}"></i>`).join('')}</div>`;
const SEL = 'fill="rgba(255,236,150,.35)" stroke="#ffd76a" stroke-width="3"';
const big = (html) => `<div style="margin-top:4px;font-weight:800;font-size:14px" class="emo">${html}</div>`;
/** 失业：空公文包（只画轮廓）；岗位是实心的公文包。 */
const NO_JOB = '<svg class="ico" viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M9 8V6.2A1.2 1.2 0 0 1 10.2 5h3.6A1.2 1.2 0 0 1 15 6.2V8" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>';
const SUBS_SVC = ['🛡️', '🚒', '🏥', '🏫', '♻️'];
const SUBS_POP = ['👥', '💼', '🎓', NO_JOB, '🛒'];
/** 公共服务这一组的图标，和 C1、C4 里的一样；盾牌只表示派出所。 */
const SVC = '🏛️';
/** 水、电、燃气三样的组合图标：公用事业。 */
const UTIL = '<span style="font-size:12px;letter-spacing:-1px;white-space:nowrap">💧⚡🔥</span>';
/** 气泡是点地图冒出来的浮层，和小卡分开说。 */
const bubbleNote = '点气泡外面的地图：只关掉气泡，回到主界面；这一下不会点到地图上的东西';
/** 污染图标放在深色小圆里，羊皮纸底上也看得清。 */
const SMOG = '<span style="display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#5f4b36;font-size:13px;vertical-align:middle">💨</span>';
/** 空心星旁的邻居头像：灰色虚线圈，头像不去色，点了打开货运视图。 */
const NB_CHAN = `<span class="chan" style="filter:none;background:#fff;width:28px;height:28px;font-size:16px">${NB.e.av}</span>`;
/** 地铁线的颜色：橙棕、蓝、绿。红色只留给坏的状态。 */
const METRO = ['#b5651d', '#2a8fd6', '#3fa75a'];

/** 标注放在元素左边；左边没地方时放右边。 */
function side(a, n, el, dy = 14) {
  const r = el.getBoundingClientRect();
  return r.left > 30 ? a.co(n, r.left - 14, r.top + dy) : a.co(n, r.right + 14, r.top + dy);
}
/** 离 (x, y) 最近的一个。 */
const nearest = (list, x, y) => [...list].sort((m, n) => Math.hypot(m.px - x, m.py - y) - Math.hypot(n.px - x, n.py - y))[0];
/** 屏幕上的点是否在画面中间：避开顶部两行和底部图例。 */
const inView = (a, [sx, sy], m = 36) => sx > m && sx < a.W - m && sy > 170 && sy < a.H - 110;
/**
 * list 里落在画面中间的那些里，屏幕上离 (tx, ty) 最近的一个，返回它的屏幕位置。
 * 元素是带 px、py 的楼，或 [x, y] 格子中心。标注要指着画面里看得见的东西。
 */
function onScreen(a, list, tx, ty) {
  const at = (p) => (Array.isArray(p) ? a.P(p[0], p[1]) : a.P(p.px, p.py));
  const seen = list.map(at).filter((s) => inView(a, s));
  seen.sort((u, v) => Math.hypot(u[0] - tx, u[1] - ty) - Math.hypot(v[0] - tx, v[1] - ty));
  return seen[0] ?? null;
}
/** 把折线按段细分，返回屏幕上的点，用来找路线在哪里出画面。 */
function screenSamples(a, line) {
  const out = [];
  for (let i = 0; i < line.length - 1; i += 1)
    for (let k = 0; k < 20; k += 1) {
      const t = k / 20;
      out.push(a.P(line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t));
    }
  return out;
}
/**
 * 被点的那一片农田：从 (x0, y0) 起，同一种作物、四邻相连、离起点不超过 3 格的格子。
 * 底图只记每格种什么，不记哪几格是一片，这里按“同作物连成的一块”取一片，大小落在 4×4 到 7×7。
 */
function farmField(a, x0, y0) {
  const crop = new Map(a.city.overlays.filter((v) => v.key.startsWith('f-')).map((o) => [`${o.x},${o.y}`, o.key.split('-')[1]]));
  const kind = crop.get(`${x0},${y0}`);
  const seen = new Set([`${x0},${y0}`]);
  const queue = [[x0, y0]];
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const [nx, ny] = [x + dx, y + dy];
      const k = `${nx},${ny}`;
      if (!seen.has(k) && crop.get(k) === kind && Math.abs(nx - x0) <= 3 && Math.abs(ny - y0) <= 3) {
        seen.add(k);
        queue.push([nx, ny]);
      }
    }
  }
  return [...seen].map((k) => k.split(',').map(Number));
}
/** 一组格子只描外轮廓：每格的四条边里，挨着组外的那几条画出来。 */
function outline(a, cells, attrs) {
  const set = new Set(cells.map((c) => c.join(',')));
  for (const [x, y] of cells)
    for (const [dx, dy, p, r] of [[0, -1, [x, y], [x + 1, y]], [1, 0, [x + 1, y], [x + 1, y + 1]], [0, 1, [x, y + 1], [x + 1, y + 1]], [-1, 0, [x, y], [x, y + 1]]])
      if (!set.has(`${x + dx},${y + dy}`)) a.svg(a.line([p, r], attrs));
}
/** 视图的顶条：返回、视图名带 ▾（点了展开小托盘切视图）；第二行分项，on 是选中的那个。 */
function viewTop(a, icon, name, subs = null, on = 0) {
  const top = modeTop(a, { icon, name, money: null });
  const row = subs ? row2(a, `<span style="width:50px;flex:none"></span>${subs.map((e, i) => subBtn(e, { on: i === on })).join('')}`) : null;
  return { ...top, row, sub: (i) => row.children[i + 1] };
}
/** 车流线：深色描边的金色光带，粗细分三档。 */
const flow = (a, pts, w) => a.svg(a.line(pts, `stroke="#13303d" stroke-width="${w + 5}" stroke-linecap="round" stroke-linejoin="round" opacity=".7"`) + a.line(pts, `stroke="#ffd34d" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`) + a.line(pts, 'stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-dasharray="6 10"'));
const TOLL = '<span style="display:inline-grid;place-items:center;height:20px;padding:0 6px;border-radius:6px;background:#ffd76a;color:#4a2c00;font-size:11px;font-weight:900">过路</span>';
const tollTag = (text) => `<span class="cap emo" style="padding:0 10px 0 6px;height:28px;font-size:13px">${TOLL}${text}</span>`;
const lineDot = (col) => `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${col};border:2px solid #fff;box-shadow:0 0 0 1px #8a5a0c"></span>`;
const BUS = [[19.5, 23.5], [29.5, 23.5], [29.5, 32.5], [19.5, 32.5]];

export const MAP = [
  {
    id: 'E1', title: '点住宅', from: 'B1 点一栋住宅',
    query: q({ zoom: 0.36, x: 44, y: 26 }),
    notes: ['品种名（多层公寓、平房这类）、星（住户收入）和表情', '住了多少人', '五种服务（派出所是盾牌）和水、电、燃气：亮着是有，暗着是没有；垃圾是全城的，不在单栋楼的气泡里', '学历四色条：没上学、小学、中学、大学', '右下角“车 + 路线”：看这栋楼的车去哪 → E5', '改规划、征收不在气泡里：拿工具直接画在上面（D5）', bubbleNote],
    draw(a) {
      const p = a.near(1, 47, 30, built);
      a.svg(a.parcelShape(p, SEL));
      base(a);
      const b = a.bubble(p.px, p.py, `<div class="t emo">🏠 多层公寓 ${a.stars(2, 2)} <span style="margin-left:auto">😀</span></div>${big('👥 46')}<div class="svc emo">${['🛡️', '🚒', '🏥', '🏫', '🎓', '|', '💧', '⚡', '🔥'].map((e, i) => (e === '|' ? '<span style="width:1px;background:#c99a3e;margin:0 2px"></span>' : `<span class="${i === 4 ? 'off' : ''}">${e}</span>`)).join('')}</div>${EDU}<div class="bb">${carBtn()}</div>`, { lift: 24 });
      side(a, 1, b, 16);
      side(a, 2, b, 46);
      side(a, 3, b.querySelector('.svc'), 10);
      side(a, 4, b.querySelector('.stack'), 6);
      const cb = b.querySelector('.btn');
      a.coAt(5, cb, -16, cb.offsetHeight / 2);
      a.co(6, 60, 640);
      a.co(7, 300, 660);
    },
  },
  {
    id: 'E2', title: '点工业或办公', from: 'B1 点一栋工业、办公或商场',
    query: q({ zoom: 0.4, x: 45, y: 40 }),
    notes: ['品种名（食品厂、律师事务所这类）和星：实心星是卖得出去的档，空心星是有本事但没通道或没需求；4 级最高二星', '空心星旁一个灰色虚线圈，画着缺的那种通道（按码头、铁路、飞机取第一种还没造、对这一星有用的，框里的样子）；点它打开建造托盘里那张卡片', '都造了还空心时画邻居头像：这座城码头和铁路都有了，4 级还没有机场，所以画北岭的头像；点了打开货运视图（F7）', '岗位用了多少；工业多一个污染图标', '一句销往哪里：二星没卖出去时只卖本市，有了通道写“销往某某地区”', '右下角“车 + 路线”：看它的车去哪 → E5'],
    draw(a) {
      const p = a.near(3, 44, 41);
      a.svg(a.parcelShape(p, SEL));
      base(a);
      const b = a.bubble(p.px, p.py, `<div class="t emo">🏭 食品厂 ${a.stars(2, 1)}${NB_CHAN}</div>${big(`💼 112 / 130 · ${SMOG}`)}<div style="margin-top:4px;color:#7a5a30;font-weight:700;font-size:13px">只卖本市</div><div class="bb">${carBtn()}</div>`, { lift: 30 });
      const alt = a.add(`<div class="states" style="left:12px;top:560px;width:220px"><span class="lbl">缺一种通道时</span><div class="st emo" style="font-size:15px">🏭 ${a.stars(2, 1)}<span class="chan">⚓</span></div></div>`);
      side(a, 1, b, 16);
      a.coAt(2, alt, alt.offsetWidth - 8, 8);
      const ch = b.querySelector('.chan');
      a.coAt(3, ch, ch.offsetWidth + 14, 4);
      side(a, 4, b, 50);
      side(a, 5, b, 76);
      const cb = b.querySelector('.btn');
      a.coAt(6, cb, -16, cb.offsetHeight / 2);
    },
  },
  {
    id: 'E3', title: '点路段', from: 'B1 点一段路',
    query: MAIN,
    notes: ['车道和负荷：一根会变色的条', '右下角“车 + 路线”：看经过这段路的车从哪来、到哪去 → E5', '升级道路不在这里：选四车道直接画在两车道上（同 D3），价格只写差价'],
    draw(a) {
      const r = a.roadNear(34, 36);
      a.svg(a.cellDiamond(r[0], r[1], 'fill="rgba(255,236,150,.5)" stroke="#ffd76a" stroke-width="3"'));
      base(a);
      const b = a.bubble(r[0] + 0.5, r[1] + 0.5, `<div class="t emo">🛣️ 四车道</div><div class="meter"><i style="width:82%;background:linear-gradient(#ff8a6a,#d2473a)"></i></div><div class="bb">${carBtn()}</div>`, { lift: 10 });
      side(a, 1, b.querySelector('.meter'), 6);
      const cb = b.querySelector('.btn');
      a.coAt(2, cb, -16, cb.offsetHeight / 2);
      a.co(3, 60, 640);
    },
  },
  {
    id: 'E4', title: '点公共服务建筑', from: 'B1 点派出所、消防站、医院、学校',
    query: q({ zoom: 0.32, x: 42, y: 36 }),
    notes: ['覆盖了多少人、每天的维护费', '金色虚线的覆盖圈画在地图上', '这一种服务的预算三档，和 C1 的税率拨钮同样式；改的是全城这一种服务，只改花多少钱和满意度加多少，不改半径', '拨动时全城同种建筑一起冒表情', bubbleNote],
    draw(a) {
      const hosp = a.parcels.filter((p) => p.zone === 5 && p.use === 'hospital');
      const h = hosp.find((p) => Math.hypot(p.px - 37, p.py - 37) < 3) ?? a.near(5, 37, 37);
      a.svg(a.ring(h.px, h.py, 8, 'fill="rgba(255,214,90,.12)" stroke="#ffd76a" stroke-width="3.5" stroke-dasharray="10 7"'));
      a.svg(a.parcelShape(h, SEL));
      const others = hosp.filter((x) => x !== h);
      const faces = others.map((o) => [o, a.label(o.px, o.py - 1.2, '<span class="emo" style="font-size:22px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))">🙂</span>')]);
      base(a);
      const b = a.bubble(h.px, h.py, `<div class="t emo">🏥 医院</div>${big('👥 2,140 · 每天 −¥80')}<div class="row" style="margin:8px 0 0"><span class="emo" style="font-size:18px">💰</span>${tri(1)}</div>`, { lift: 30 });
      side(a, 1, b, 44);
      a.co(2, ...a.P(h.px + 6.5, h.py + 3));
      a.coAt(3, b.querySelector('.tri'), b.querySelector('.tri').offsetWidth + 14, 16);
      const face = faces.find(([o]) => o === nearest(others, 47, 35));
      if (face) a.coAt(4, face[1], -16, 4);
      a.co(5, 300, 660);
    },
  },
  {
    id: 'E5', title: '车流去向（下钻一层）', from: 'E1、E2、E3 点右下角“车 + 路线”',
    query: q({ view: 'traffic', zoom: 0.26, x: 34, y: 34 }),
    notes: ['左上返回：回到原来的气泡（E1、E2 或 E3），不是直接回地图；这一层点楼不响应', '小签写着看的是谁的车', '这栋楼的车走哪些路：金色光带，粗细分三档，越粗车越多', '其余是交通视图的样子（路按负荷着色）'],
    draw(a) {
      const p = a.near(1, 34, 39, built);
      const paths = [[19, 27], [44, 41], [34, 13]].map((e) => a.simplify(a.roadPath([p.px, p.py], e)));
      paths.forEach((pts, i) => flow(a, pts, [12, 8, 4][i]));
      a.svg(a.parcelShape(p, 'fill="#ffd76a" stroke="#fff" stroke-width="3"'));
      const top = modeTop(a, { icon: '<span style="font-size:18px">🚗</span>', name: '这栋住宅的车', drop: false, money: null });
      coBack(a, 1, top);
      a.coAt(2, top.title, top.title.offsetWidth - 10, top.title.offsetHeight + 12);
      const thick = screenSamples(a, paths[0]).filter((s) => inView(a, s, 40));
      const m = thick[Math.floor(thick.length / 2)];
      if (m) a.co(3, m[0] + 4, m[1] - 20);
      a.co(4, ...a.P(52, 42.5));
    },
  },
  {
    id: 'E6', title: '点农田', from: 'B1 点一片农田',
    query: q({ zoom: 0.42, x: 33, y: 54 }),
    notes: ['品种和星：稻田属于粮食，只有一星；农业最高两星，造了农业科技园后部分类别到三星', '每天的产量', '没有按钮', '被点的这一片农田描金边，旁边的几片不描'],
    draw(a) {
      const fx = a.parcels.find((p) => p.zone === 4) ?? { px: 33.5, py: 52.5 };
      const field = farmField(a, Math.floor(fx.px), Math.floor(fx.py));
      for (const [x, y] of field) a.svg(a.cellDiamond(x, y, 'fill="rgba(255,236,150,.3)"'));
      outline(a, field, 'stroke="#ffd76a" stroke-width="3.5" stroke-linecap="round"');
      base(a);
      const b = a.bubble(fx.px, fx.py, `<div class="t emo">🌾 稻田 ${a.stars(1, 1)}</div>${big('📦 每天 120')}`, { lift: 20 });
      side(a, 1, b, 16);
      side(a, 2, b, 46);
      a.coAt(3, b, b.offsetWidth + 14, 30);
      const low = field.reduce((m, c) => (c[0] + c[1] > m[0] + m[1] ? c : m));
      const [ex, ey] = a.P(low[0] + 1, low[1] + 1);
      a.co(4, ex, ey + 14);
    },
  },
  {
    id: 'E7', title: '点水厂、电厂、燃气厂', from: 'B1 点一座厂',
    query: q({ zoom: 0.3, x: 38, y: 31 }),
    notes: ['种类和级别：厂房加罗马数字。这座在城中间、不挨水面，是地下水厂；挨着河、湖、海的才是普通水厂', '用了多少：一根条，不写数，满了变红', '它供应到的楼一起亮起来（同一片路网里离它近的先供）', '没有按钮；换等级、换种类拿工具直接放在上面（D15）'],
    draw(a) {
      a.fade(0.55);
      const w = a.parcels.find((p) => p.use === 'water');
      const lit = a.parcels.filter((x) => x.zone >= 1 && x.zone <= 3 && Math.hypot(x.px - w.px, x.py - w.py) < 13);
      for (const p of lit) a.svg(a.parcelShape(p, 'fill="rgba(70,150,214,.75)" stroke="#d6efff" stroke-width="1"'));
      a.svg(a.parcelShape(w, SEL));
      base(a);
      const b = a.bubble(w.px, w.py, `<div class="t emo">💧 地下水厂 <span style="display:inline-flex;align-items:center;gap:2px;padding:0 6px;border-radius:8px;background:#e6d4a6;font-size:13px">🏭<b style="font-family:serif">Ⅰ</b></span></div><div class="meter"><i style="width:72%;background:linear-gradient(#9fd6f5,#2f86c4)"></i></div>`, { lift: 24 });
      side(a, 1, b, 16);
      side(a, 2, b.querySelector('.meter'), 4);
      const one = nearest(lit, w.px - 2, w.py + 6);
      if (one) a.co(3, ...a.P(one.px, one.py));
      a.coAt(4, b, 20, b.offsetHeight + 16);
    },
  },
  {
    id: 'E8', title: '点路口', from: 'B1 点一个路口',
    query: MAIN,
    notes: ['现在是红绿灯还是环岛', '换成另一种：画面上的路口跟着换，按新造算价', '三四条路默认红绿灯，五条以上默认环岛'],
    draw(a) {
      const [jx, jy] = [34, 32];
      a.svg(a.cellDiamond(jx, jy, 'fill="rgba(255,236,150,.5)" stroke="#ffd76a" stroke-width="3"'));
      base(a);
      const b = a.bubble(jx + 0.5, jy + 0.5, `<div class="t emo">🚦 红绿灯</div><div class="bb">${a.btn('换成 ⭕ 环岛', 'blue')}</div>`, { lift: 10 });
      side(a, 1, b, 16);
      a.coAt(2, b.querySelector('.btn'), b.querySelector('.btn').offsetWidth + 14, 16);
      a.co(3, 60, 640);
    },
  },
  {
    id: 'E9', title: '点公交站或地铁站', from: 'B1 点一个公交站或地铁站',
    query: q({ zoom: 0.28, x: 24.5, y: 28 }),
    notes: ['线路颜色、每天坐车的人', '整条线路高亮', '改线路：进 D13（公交）或 D14（地铁）', '拆掉整条线：红色，按住约 1 秒'],
    draw(a) {
      a.fade(0.6);
      const loop = [...BUS, BUS[0]];
      for (let i = 0; i < loop.length - 1; i += 1) {
        const seg = a.simplify(a.roadPath(loop[i], loop[i + 1]));
        a.svg(a.line(seg, 'stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"') + a.line(seg, 'stroke="#e07a1f" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"'));
      }
      for (const [x, y] of BUS) { const [sx, sy] = a.P(x, y); a.svg(`<circle cx="${sx}" cy="${sy}" r="11" fill="#fff" stroke="#e07a1f" stroke-width="3.5"/><text x="${sx}" y="${sy + 5}" text-anchor="middle" font-size="13">🚌</text>`); }
      const stop = BUS[2];
      const [sx, sy] = a.P(...stop);
      a.svg(`<circle cx="${sx}" cy="${sy}" r="17" fill="none" stroke="#ffd76a" stroke-width="4"/>`);
      base(a);
      const b = a.bubble(...stop, `<div class="t emo">${lineDot('#e07a1f')} 公交 2 号线</div>${big('👥 每天 640')}<div class="bb">${a.btn('改线路', 'blue')}<span class="btn red hold"><i class="fill" style="width:30%"></i><span>按住 拆线</span></span></div>`, { lift: 18 });
      const bs = b.querySelectorAll('.btn');
      side(a, 1, b, 30);
      const [lx, ly] = a.P(...BUS[3]);
      a.co(2, lx + 18, ly + 22);
      a.coAt(3, bs[0], 20, bs[0].offsetHeight + 14);
      a.coAt(4, bs[1], bs[1].offsetWidth - 20, bs[1].offsetHeight + 14);
    },
  },
  {
    id: 'E10', title: '点码头、机场、国际港', from: 'B1 点内河码头（机场、国际港同样）',
    query: q({ zoom: 0.3, x: 44, y: 44 }),
    notes: ['每天进出的货：一个小柱状图，出、进两根', '每天收的过路费：别人的货从你的码头出去，你收过路费', '经过它的货运线路画在地图上：水运沿着河', '没有按钮'],
    draw(a) {
      a.fade(0.6);
      const dock = [45.5, 45.2];
      a.svg(a.line([[8, 53.5], [20, 52], [30, 48.5], [40, 46.3], dock], 'stroke="#2f86c4" stroke-width="7" stroke-linecap="round" stroke-dasharray="12 7"'));
      a.svg(a.line([dock, [52, 48.5], [60, 51.5], [64, 52.5]], 'stroke="#2f86c4" stroke-width="11" stroke-linecap="round" stroke-dasharray="14 8"'));
      a.svg(a.line([[44.5, 41], [45, 43.5], dock], 'stroke="#e07a3f" stroke-width="6" stroke-linecap="round" stroke-dasharray="10 6"'));
      a.label(...dock, circleIcon('⚓', '#2f86c4'));
      const [dx, dy] = a.P(...dock);
      a.svg(`<circle cx="${dx}" cy="${dy}" r="22" fill="none" stroke="#ffd76a" stroke-width="3.5"/>`);
      base(a);
      const bars = `<div style="display:flex;align-items:flex-end;gap:10px;height:56px;margin-top:6px;padding:0 6px;border-bottom:2px solid #7a5520">${[['出', 120, '#e07a3f'], ['进', 45, '#2f86c4']].map(([, v, c]) => `<div style="display:grid;justify-items:center;gap:2px;font-size:12px;font-weight:800"><span>${v}</span><i style="display:block;width:26px;height:${v / 3}px;background:${c};border-radius:4px 4px 0 0"></i></div>`).join('')}<span style="font-size:12px;color:#7a5a30;margin-left:auto">📦/天</span></div>`;
      const b = a.bubble(...dock, `<div class="t emo">⚓ 内河码头</div>${bars}<div style="margin-top:6px">${tollTag('+¥95/天')}</div>`, { lift: 26 });
      side(a, 1, b, 50);
      side(a, 2, b.querySelector('.cap'), 8);
      a.co(3, ...a.P(54, 48.6));
      a.coAt(4, b, b.offsetWidth / 2, -16);
    },
  },
  {
    id: 'E11', title: '点奖励建筑', from: 'B1 点一座奖励建筑',
    query: q({ zoom: 0.36, x: 26, y: 44 }),
    notes: ['奖杯和名字', '作用画成图标：体育场是“全城住户更满意”', '每天的维护费；带游客的多一行每天来多少人', '作用或代价按固定半径算的，把范围画在地图上：湿地公园的作用，体育场、物流园、游乐场的噪音，动物园的气味；这里是建成以后的体育场，画它的噪音范围', '没有按钮'],
    draw(a) {
      const area = [[22.5, 44], [25.5, 44], [25.5, 47], [22.5, 47]];
      a.svg(a.poly(area, 'fill="rgba(170,175,160,.9)" stroke="#ffd76a" stroke-width="3"'));
      a.label(24, 45.5, '<span class="emo" style="font-size:24px">🏟️</span>');
      a.svg(a.ring(24, 45.5, 7, 'fill="rgba(122,74,26,.10)" stroke="#7a4a1a" stroke-width="3" stroke-dasharray="10 6"'));
      base(a);
      const b = a.bubble(24, 44.5, `<div class="t emo">🏆 体育场</div><div class="emo" style="margin-top:6px;font-size:18px;display:flex;align-items:center;gap:4px">🏙️ → 😀</div>${big('每天 −¥50')}`, { lift: 20 });
      side(a, 1, b, 16);
      side(a, 2, b, 46);
      side(a, 3, b, 76);
      a.co(4, ...a.P(30.5, 47.5));
      a.coAt(5, b, b.offsetWidth / 2, -16);
    },
  },
  {
    id: 'E12', title: '其余几种气泡', from: 'B1 点公园、垃圾处理用地、铁路、车站、划了区没长楼的格子',
    query: MAIN,
    notes: ['公园：环境加多少用一根短条、每天维护费；地图上描出公园的轮廓和环境范围', '垃圾处理用地：一个容量环，处理了多少人、还能处理多少；全城的垃圾用地一起描边', '铁路线段：每天过多少趟货车；连到的站一起亮', '货运站：每天装卸的货；经过它的货运线路画出来', '客运站：每天上下车的人；没接上邻居的铁路网时一个断链图标', '划了区没长楼的格子：缺什么画什么（缺路、缺水、缺电、需求短）；什么都不缺时一个小工地图标，楼正在来的路上', '一张图摆了六种，游戏里一次只出一个气泡'],
    draw(a) {
      a.fade(0.45);
      const ring = (p) => `<svg width="46" height="46" viewBox="0 0 46 46"><circle cx="23" cy="23" r="18" fill="none" stroke="#d9c38f" stroke-width="7"/><circle cx="23" cy="23" r="18" fill="none" stroke="#8a6a3a" stroke-width="7" stroke-dasharray="${113 * p} 113" transform="rotate(-90 23 23)"/><text x="23" y="28" text-anchor="middle" font-size="15">♻️</text></svg>`;
      const miss = (e) => `<span style="position:relative;display:inline-grid;place-items:center;width:30px;height:30px;border-radius:8px;background:#fff;border:2px solid #c99a3e">${e}<i style="position:absolute;left:3px;right:3px;top:13px;height:3px;background:#8a8a8a;transform:rotate(-35deg)"></i></span>`;
      const cards = [
        ['🌳 公园', '<div class="emo" style="margin-top:4px;display:flex;align-items:center;gap:6px;font-weight:800;font-size:14px">🌿<div class="meter" style="flex:0 0 44px;margin:0"><i style="width:40%;background:linear-gradient(#a6e39a,#3fa75a)"></i></div>每天 −¥10</div>'],
        ['♻️ 垃圾处理用地', `<div style="display:flex;align-items:center;gap:8px;margin-top:4px">${ring(0.8)}<b style="font-size:13px">3,200 / 4,000 人</b></div>`],
        ['🚆 铁路', big('🚂 每天 18 趟')],
        ['🚉 货运站', big('📦 每天 240')],
        ['🚏 客运站', `<div style="display:flex;align-items:center;gap:8px;margin-top:4px" class="emo"><b style="font-size:14px">👥 每天 0</b>${BROKEN}</div>`],
        ['▦ 住宅用地', `<div class="emo" style="display:flex;gap:6px;margin-top:6px;font-size:16px">${miss('🛣️')}${miss('💧')}${miss('⚡')}<span style="display:inline-grid;place-items:center;width:30px;height:30px;border-radius:8px;background:#fff;border:2px solid #c99a3e">📉</span></div>`],
      ];
      base(a);
      cards.forEach(([t, body], i) => {
        const left = i % 2 === 0 ? 14 : 202;
        const topY = 240 + Math.floor(i / 2) * 136;
        const el = a.add(`<div class="bubble" style="left:${left}px;top:${topY}px;transform:none;min-width:0;width:174px"><div class="t emo">${t}</div>${body}</div>`);
        a.coAt(i + 1, el, el.offsetWidth - 10, -6);
      });
      a.co(7, 200, 660);
    },
  },
  {
    id: 'F0', title: '视图托盘', from: 'B1 点视图',
    query: MAIN,
    notes: ['八个视图，选一个 → F1 至 F8', '没解锁的灰掉，写解锁等级', '点托盘外面：收起，回到 B1'],
    draw(a) {
      base(a, { dock: { on: 'view' } });
      const v = [['🚗', '交通'], [SVC, '公共服务'], [UTIL, '水电燃气'], ['👥', '人口岗位'], ['🙂', '满意度'], ['🌿', '环境'], ['📦', '货运'], ['🚇', '地铁', 6]];
      const t = a.panel('tray', '视图', `<div class="views emo">${v.map(([e, n, lv]) => `<div class="vbtn ${lv ? 'lock' : ''}"><span>${lv ? '🔒' : e}</span>${n}${lv ? `<small style="font-size:10px">Lv${lv}</small>` : ''}</div>`).join('')}</div>`);
      a.coAt(1, t.querySelector('.vbtn'), 4, 4);
      a.coAt(2, t.querySelectorAll('.vbtn')[7], 70, 4);
      a.co(3, 200, 300);
    },
  },
  {
    id: 'F1', title: '视图：交通', from: 'F0 选交通；或 C4 点通勤',
    query: q({ view: 'traffic', zoom: 0.3, x: 32, y: 33 }),
    notes: ['左上返回：回到进来的那一层（F0 视图托盘，或 C4）；点视图名展开小托盘，直接切到别的视图', '分项：全部、公交客流（4 级）、货运', '路按负荷着色，绿到红越来越堵；路上的小箭头是车流', '楼里的淡色粗扁箭头只在放大到街道档、或点了这栋楼时显示，指向它出入口所在的路', '图例只有色块', '点路或楼照样冒气泡，气泡先写负荷'],
    draw(a) {
      const p = a.near(2, 30, 36, built);
      const r = a.roadNear(p.px, p.py);
      const d = Math.hypot(r[0] + 0.5 - p.px, r[1] + 0.5 - p.py) || 1;
      const [ux, uy] = [(r[0] + 0.5 - p.px) / d, (r[1] + 0.5 - p.py) / d];
      a.svg(a.parcelShape(p, SEL));
      a.svg(a.poly([[p.px + ux * 0.9, p.py + uy * 0.9], [p.px - uy * 0.6, p.py + ux * 0.6], [p.px + uy * 0.6, p.py - ux * 0.6]], 'fill="rgba(255,255,255,.85)" stroke="#13303d" stroke-width="2"'));
      const top = viewTop(a, '🚗', '交通', ['全部', '🚌', '🚚']);
      const leg = a.add('<div class="legend"><i style="background:#4fb06a"></i><i style="background:#f2b632"></i><i style="background:#e0533d"></i></div>');
      const b = a.bubble(p.px, p.py, '<div class="t emo">🏬 商业</div><div class="meter"><i style="width:64%;background:linear-gradient(#ffd27a,#f2b632)"></i></div>', { lift: 24 });
      coBack(a, 1, top);
      a.coAt(2, top.sub(2), top.sub(2).offsetWidth + 12, 20);
      a.co(3, ...a.P(34, 27.5));
      a.co(4, ...a.P(p.px - 1, p.py + 1));
      a.coAt(5, leg, leg.offsetWidth + 12, 16);
      side(a, 6, b, 30);
    },
  },
  {
    id: 'F2', title: '视图：公共服务（医院）', from: 'F0 选公共服务；或 C4 点公共服务',
    query: q({ zoom: 0.22, x: 27, y: 35 }),
    notes: ['分项：警察、消防、医院、学校、垃圾；一次只看一种', '覆盖圈', '覆盖到的住宅是青绿色；没覆盖的是橙色，一闪一闪，一眼看出该往哪放', '学校分三种颜色：没有学校、只有小学、都有'],
    draw(a) {
      a.fade(0.4);
      const hosp = a.parcels.filter((p) => p.zone === 5 && p.use === 'hospital');
      for (const h of hosp) a.svg(a.ring(h.px, h.py, 8, 'fill="rgba(42,143,168,.10)" stroke="#2a8fa8" stroke-width="2.5" stroke-dasharray="8 6"'));
      const miss = [];
      for (const p of a.parcels.filter((x) => x.zone === 1)) {
        const ok = hosp.some((h) => Math.hypot(h.px - p.px, h.py - p.py) <= 8);
        if (!ok) miss.push(p);
        a.svg(a.parcelShape(p, ok ? 'fill="rgba(42,157,143,.8)"' : 'fill="rgba(240,120,60,.9)" stroke="#fff" stroke-width="1.5"'));
      }
      for (const h of hosp) a.label(h.px, h.py, circleIcon('🏥', '#2a8fa8'));
      const top = viewTop(a, SVC, '公共服务', SUBS_SVC, 2);
      a.add('<div class="legend"><span class="emo">🏥</span><i style="background:#2a9d8f"></i><i style="background:#f0783c"></i></div>');
      a.coAt(1, top.sub(4), top.sub(4).offsetWidth + 6, -2);
      a.co(2, ...a.P(hosp[0].px + 6, hosp[0].py + 4));
      const m = onScreen(a, miss, 195, 520);
      if (m) a.co(3, m[0] + 18, m[1] - 18);
      a.coAt(4, top.sub(3), 22, 52);
    },
  },
  {
    id: 'F2a', title: '视图：公共服务的学校分项', from: 'F2 点分项里的学校；或 C4 点服务',
    query: q({ zoom: 0.22, x: 32, y: 30 }),
    notes: ['分项选学校：小学和中学一起看', '三种颜色：橙色是没有学校，黄色是只有小学，青绿是小学和中学都有；橙色一闪一闪', '小学和中学各画各的覆盖圈；中学只对已经有小学覆盖的住户起作用，只在中学圈里的住户还是橙色', '图例三个色块'],
    draw(a) {
      a.fade(0.4);
      const schools = a.parcels.filter((p) => p.zone === 5 && p.use === 'school');
      const mid = nearest(schools, 48, 37);
      const pris = schools.filter((s) => s !== mid);
      for (const s of pris) a.svg(a.ring(s.px, s.py, 8, 'fill="rgba(156,207,106,.10)" stroke="#7fb24a" stroke-width="2.5" stroke-dasharray="8 6"'));
      a.svg(a.ring(mid.px, mid.py, 11, 'fill="none" stroke="#2a8fa8" stroke-width="2.5" stroke-dasharray="3 5"'));
      const none = [];
      for (const p of a.parcels.filter((x) => x.zone === 1)) {
        const pri = pris.some((s) => Math.hypot(s.px - p.px, s.py - p.py) <= 8);
        const both = pri && Math.hypot(mid.px - p.px, mid.py - p.py) <= 11;
        if (!pri) none.push(p);
        a.svg(a.parcelShape(p, both ? 'fill="rgba(42,157,143,.85)"' : pri ? 'fill="rgba(242,201,76,.9)"' : 'fill="rgba(240,120,60,.9)" stroke="#fff" stroke-width="1.5"'));
      }
      for (const s of schools) a.label(s.px, s.py, circleIcon(s === mid ? '🎓' : '🏫', '#2a8fa8'));
      const top = viewTop(a, SVC, '公共服务', SUBS_SVC, 3);
      const leg = a.add('<div class="legend"><span class="emo">🏫</span><i style="background:#f0783c"></i><i style="background:#f2c94c"></i><i style="background:#2a9d8f"></i></div>');
      a.coAt(1, top.sub(3), top.sub(3).offsetWidth + 6, -2);
      const n = onScreen(a, none, 160, 230);
      if (n) a.co(2, n[0] + 18, n[1] - 18);
      a.co(3, ...a.P(mid.px - 7.8, mid.py + 7.8));
      a.coAt(4, leg, leg.offsetWidth + 12, 16);
    },
  },
  {
    id: 'F2b', title: '视图：公共服务的垃圾分项', from: 'F2 点分项里的垃圾；或 C4 点垃圾',
    query: q({ zoom: 0.24, x: 44, y: 30 }),
    notes: ['分项选垃圾', '左上一根全城处理率的条：处理了多少人 / 全城多少人，只画条长，不写数', '每块垃圾处理用地一个容量环；用地不分片、不管距离，连上路就处理全城', '处理不够时，全城住宅一起淡橙色一闪一闪（不挑楼，按比例一起扣分）'],
    draw(a) {
      a.fade(0.45);
      for (const p of a.parcels.filter((x) => x.zone === 1)) a.svg(a.parcelShape(p, 'fill="rgba(240,150,90,.55)" stroke="#fff" stroke-width="1"'));
      const lots = [[53, 25, 55, 27, 0.95], [54, 35, 55, 36, 1]];
      const rings = [];
      for (const [x0, y0, x1, y1, p] of lots) {
        a.svg(a.poly([[x0, y0], [x1 + 1, y0], [x1 + 1, y1 + 1], [x0, y1 + 1]], 'fill="#b08a5a" stroke="#5a3a12" stroke-width="2"'));
        const [cx, cy] = a.P((x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2);
        const len = 2 * Math.PI * 20;
        a.svg(`<circle cx="${cx}" cy="${cy - 26}" r="20" fill="rgba(255,255,255,.92)" stroke="#d9c38f" stroke-width="7"/><circle cx="${cx}" cy="${cy - 26}" r="20" fill="none" stroke="${p >= 1 ? '#e07a3f' : '#8a6a3a'}" stroke-width="7" stroke-dasharray="${len * p} ${len}" transform="rotate(-90 ${cx} ${cy - 26})"/><text x="${cx}" y="${cy - 21}" text-anchor="middle" font-size="14">♻️</text>`);
        rings.push([cx, cy - 26]);
      }
      const top = viewTop(a, SVC, '公共服务', SUBS_SVC, 4);
      const rate = a.add(`<div class="emo" style="position:absolute;left:10px;top:${ROW2 + 54}px;width:200px;display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:12px;background:rgba(13,36,46,.88);border:1.5px solid #ffd76a;color:#fff;font-weight:800;font-size:13px">♻️<div class="meter" style="flex:1;margin:0"><i style="width:82%;background:linear-gradient(#ffcf8a,#e07a3f)"></i></div></div>`);
      a.coAt(1, top.sub(4), top.sub(4).offsetWidth + 6, -2);
      a.coAt(2, rate, rate.offsetWidth + 12, 16);
      const shown = rings.find(([sx]) => sx > 40 && sx < a.W - 70) ?? rings[0];
      a.co(3, shown[0] - 34, shown[1] - 10);
      const r = a.near(1, 46, 30);
      a.co(4, ...a.P(r.px, r.py));
    },
  },
  {
    id: 'F3', title: '视图：水电燃气', from: 'F0 选水电燃气；或 C4 点水电燃气',
    query: q({ zoom: 0.24, x: 34, y: 33 }),
    notes: ['三根进度条浮在地图上，颜色固定：水蓝、电黄、燃气橙；满了外框变红', '有供应的楼着蓝色；断了的楼变灰、一闪一闪，楼头上冒缺的那样的小图标。这里燃气不够，只有住宅要燃气，所以离燃气厂最远的那片住宅先停', '厂的位置一圈圈往外扩；城中间这座水厂不挨水面，是地下水厂', '三样画在同一张图上，不分页'],
    draw(a) {
      a.fade(0.4);
      const gas = [21.6, 25.1];
      const grays = [];
      for (const p of a.parcels.filter((x) => x.zone >= 1 && x.zone <= 3)) {
        if (p.zone === 1 && p.py >= 40 && p.px < 40) {
          grays.push(p);
          a.svg(a.parcelShape(p, 'fill="rgba(160,168,172,.95)" stroke="#fff" stroke-width="1.5"'));
          a.label(p.px, p.py - 0.8, '<span class="emo" style="display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#fff;border:2px solid #e07a3f;font-size:12px">🔥</span>');
        } else a.svg(a.parcelShape(p, 'fill="rgba(70,150,214,.8)"'));
      }
      isoBox(a, gas[0] - 1, gas[1] - 0.9, 2, 1.8, 18, ['#f6d6b4', '#d99a6a', '#b87a4a']);
      const plants = [...a.parcels.filter((p) => p.zone === 5 && (p.use === 'power' || p.use === 'water')).map((p) => [p.px, p.py, p.use === 'power' ? '⚡' : '💧']), [...gas, '🔥']];
      for (const [x, y, e] of plants) {
        a.svg(a.ring(x, y, 2.5, 'fill="none" stroke="#1f6fa3" stroke-width="3"') + a.ring(x, y, 4, 'fill="none" stroke="#1f6fa3" stroke-width="2" opacity=".5"'));
        a.label(x, y, circleIcon(e, '#1f6fa3'));
      }
      const water = plants.find((p) => p[2] === '💧');
      const [wx, wy] = a.P(water[0], water[1]);
      a.tag('地下水厂', wx, wy - 44);
      viewTop(a, UTIL, '水电燃气');
      const fb = a.add(`<div class="floatbars emo" style="top:${ROW2}px">${[['💧', 72, '#5aa9d6'], ['⚡', 91, '#f2c94c'], ['🔥', 100, '#f08a3c']].map(([e, p, c]) => `<div style="${p >= 100 ? 'border-color:#e5332a;box-shadow:0 0 0 2px #e5332a' : ''}">${e}<div class="meter"><i style="width:${p}%;background:${c}"></i></div></div>`).join('')}</div>`);
      a.coAt(1, fb, -14, 20);
      const g = onScreen(a, grays, 90, 470);
      if (g) a.co(2, g[0] + 18, g[1] - 24);
      const [gx, gy] = a.P(...gas);
      a.co(3, gx - 40, gy - 20);
      a.co(4, 60, 700);
    },
  },
  {
    id: 'F4', title: '视图：人口和岗位', from: 'F0 选人口岗位；或 C3 点小卡',
    query: q({ zoom: 0.26, x: 32, y: 32 }),
    notes: ['分项：人口、岗位、学历、失业（空公文包）、商场', '人口：每栋住宅上一根小柱子，越高住得越多', '人口小卡的缩小版浮在角上；人人都找工作，没找到岗位的就是失业，所以失业不少于人口减岗位', '点楼照样冒气泡'],
    draw(a) {
      a.fade(0.45);
      for (const p of a.parcels.filter((x) => x.zone === 1)) {
        const [x, y] = a.P(p.px, p.py);
        const h = Math.min(56, 12 + (p.capacity ?? 20) / 2);
        a.svg(`<rect x="${x - 5}" y="${y - h}" width="10" height="${h}" rx="2" fill="#e07a3f" stroke="#fff" stroke-width="1.5"/><ellipse cx="${x}" cy="${y - h}" rx="5" ry="2" fill="#f4a26c"/>`);
      }
      const top = viewTop(a, '👥', '人口岗位', SUBS_POP, 0);
      const card = a.panel('', '', `<div class="emo" style="font-weight:900;display:flex;align-items:center;gap:4px">👥 8,450 · 💼 8,330 · ${NO_JOB} 120</div>${EDU}`, 'left:10px;right:110px;bottom:18px;padding:8px 10px');
      a.coAt(1, top.sub(4), top.sub(4).offsetWidth + 6, -2);
      const p = a.near(1, 30, 30);
      a.co(2, ...a.P(p.px, p.py));
      a.coAt(3, card, 0, 0);
      a.co(4, 330, 650);
    },
  },
  {
    id: 'F4a', title: '视图：人口的学历分项', from: 'F4 点分项里的学历',
    query: q({ zoom: 0.26, x: 30, y: 30 }),
    notes: ['分项选学历', '每栋住宅按住户的学历着色：灰是没上学，浅绿小学，青绿中学，深蓝大学（按这栋楼人最多的一档）', '人口小卡的缩小版浮在角上，学历四色条和地图同色', '图例四个色块'],
    draw(a) {
      a.fade(0.4);
      for (const p of a.parcels.filter((x) => x.zone === 1)) {
        const k = Math.min(3, Math.max(0, Math.floor((48 - Math.hypot(p.px - 32, p.py - 30) * 2) / 12) + (p.id % 2)));
        a.svg(a.parcelShape(p, `fill="${EDU_COL[k]}" fill-opacity=".92" stroke="#fff" stroke-width="1"`));
      }
      const top = viewTop(a, '👥', '人口岗位', SUBS_POP, 2);
      const card = a.panel('', '', `<div class="emo" style="font-weight:900;font-size:14px">👥 8,450</div>${EDU}`, 'left:10px;right:140px;bottom:52px;padding:8px 10px');
      const leg = a.add(`<div class="legend" style="left:auto;right:10px">${EDU_COL.map((c) => `<i style="background:${c};width:16px"></i>`).join('')}</div>`);
      a.coAt(1, top.sub(2), top.sub(2).offsetWidth + 6, -2);
      const p = a.near(1, 30, 26);
      a.co(2, ...a.P(p.px, p.py));
      a.coAt(3, card, card.offsetWidth - 10, -6);
      a.coAt(4, leg, leg.offsetWidth / 2, -16);
    },
  },
  {
    id: 'F4b', title: '视图：人口的商场分项', from: 'F4 点分项里的商场；或 C4 点购物',
    query: q({ zoom: 0.24, x: 30, y: 28 }),
    notes: ['分项选商场', '商场按星着色：星越高颜色越深，楼头上写几星（4 级最高二星）', '就近有商场的住宅青绿；没有的橙色，一闪一闪。“就近”只看住宅门口几格内有没有商场，不看星级', '居民按收入档先去同星级的商场，满了往低一星溢出；这一步按全城算，不按距离、不按路网分片'],
    draw(a) {
      a.fade(0.4);
      const shops = a.parcels.filter((p) => p.use === 'shop');
      const big2 = a.parcels.filter((p) => p.zone === 2 && p.level >= 3).filter((_, i) => i % 3 === 0);
      const malls = [...shops, ...big2];
      const tone = ['#f2c56a', '#b8650c'];
      const starOf = (m) => (big2.includes(m) ? 2 : 1);
      for (const m of malls) a.svg(a.parcelShape(m, `fill="${tone[starOf(m) - 1]}" stroke="#5a3a12" stroke-width="1.5"`));
      const tags = big2.map((m) => a.label(m.px, m.py - 0.8, '<span style="font-size:11px;font-weight:900;color:#5a3a12;background:#fff8d6;border-radius:6px;padding:0 4px;border:1px solid #c99a3e">★★</span>'));
      const far = [];
      for (const p of a.parcels.filter((x) => x.zone === 1)) {
        const ok = malls.some((m) => Math.hypot(m.px - p.px, m.py - p.py) <= 9);
        if (!ok) far.push(p);
        a.svg(a.parcelShape(p, ok ? 'fill="rgba(42,157,143,.8)"' : 'fill="rgba(240,120,60,.9)" stroke="#fff" stroke-width="1.5"'));
      }
      const top = viewTop(a, '👥', '人口岗位', SUBS_POP, 4);
      a.add(`<div class="legend"><span class="emo">🛒</span>${tone.map((c) => `<i style="background:${c};width:18px"></i>`).join('')}<span style="width:6px"></span><i style="background:#2a9d8f;width:18px"></i><i style="background:#f0783c;width:18px"></i></div>`);
      a.coAt(1, top.sub(4), top.sub(4).offsetWidth + 6, -2);
      if (tags[0]) a.coAt(2, tags[0], -16, 8);
      const f = nearest(far, 30, 28);
      if (f) a.co(3, ...a.P(f.px, f.py));
      a.co(4, 300, 640);
    },
  },
  {
    id: 'F5', title: '视图：满意度', from: 'F0 选满意度',
    query: q({ zoom: 0.3, x: 32, y: 34 }),
    notes: ['每栋住宅头上一个表情，颜色跟着表情', '五档五色：很好、好、一般、差、很差；最差一档用深橙，不用红', '不显示分数，也不写原因；看原因就去对应的视图（C4 点因素）'],
    draw(a) {
      a.fade(0.45);
      const faces = ['😀', '🙂', '😐', '😟', '😫'];
      const cols = ['#2e9e4f', '#8bc34a', '#f2c94c', '#f0a040', '#d9661f'];
      const mix = [1, 0, 1, 2, 1, 1, 3, 1, 0, 2, 1, 4];
      for (const p of a.parcels.filter((x) => x.zone === 1)) {
        const k = mix[p.id % mix.length];
        a.svg(a.parcelShape(p, `fill="${cols[k]}" fill-opacity=".8"`));
        a.label(p.px, p.py, `<span class="emo" style="font-size:18px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.5))">${faces[k]}</span>`);
      }
      const top = viewTop(a, '🙂', '满意度');
      const p = a.near(1, 32, 34);
      a.co(1, ...a.P(p.px, p.py - 1));
      const leg = a.add(`<div class="legend emo">${faces.map((f, i) => `<span style="display:grid;justify-items:center;gap:2px">${f}<i style="width:22px;height:6px;border-radius:3px;background:${cols[i]}"></i></span>`).join('')}</div>`);
      a.coAt(2, leg, leg.offsetWidth + 12, 16);
      a.coAt(3, top.title, top.title.offsetWidth + 10, 18);
    },
  },
  {
    id: 'F6', title: '视图：环境', from: 'F0 选环境；或 C4 点环境',
    query: q({ zoom: 0.24, x: 36, y: 36 }),
    notes: ['从绿到褐着色：越绿环境越好', '污染、噪音、尾气的来源一圈圈往外扩（工厂、电厂、拥堵的路）', '公园、水边、森林让周围变绿'],
    draw(a) {
      a.fade(0.45);
      const bad = a.parcels.filter((p) => p.zone === 3 || p.use === 'power');
      const parks = a.parcels.filter((p) => p.use === 'park');
      const riverY = (x) => (x < 30 ? 51.5 - (x - 20) * 0.35 : 48 - (x - 30) * 0.2);
      const env = (p) => {
        let e = 0.62;
        for (const s of bad) e -= Math.max(0, 0.42 - Math.hypot(s.px - p.px, s.py - p.py) / 14);
        e += Math.max(0, ...parks.map((g) => 0.45 - Math.hypot(g.px - p.px, g.py - p.py) / 10));
        e += Math.max(0, 0.5 - Math.abs(riverY(p.px) - p.py) / 12);
        return Math.max(0, Math.min(1, e));
      };
      const nearGreen = (p) => parks.some((g) => Math.hypot(g.px - p.px, g.py - p.py) < 3.5) || Math.abs(riverY(p.px) - p.py) < 5;
      const lots = a.parcels.filter((x) => x.zone >= 1 && x.zone <= 3).map((p) => [p, env(p)]);
      for (const [p, e] of lots) a.svg(a.parcelShape(p, `fill="hsl(${30 + e * 90} 60% ${42 + e * 10}%)" fill-opacity=".85"`));
      for (const s of bad.slice(0, 5)) a.svg(a.ring(s.px, s.py, 3, 'fill="none" stroke="#7a4a1a" stroke-width="3" opacity=".8"') + a.ring(s.px, s.py, 5, 'fill="none" stroke="#7a4a1a" stroke-width="2" opacity=".4"'));
      viewTop(a, '🌿', '环境');
      a.add('<div class="legend"><span class="emo">🌿</span><i style="background:hsl(120 60% 52%)"></i><i style="background:hsl(75 60% 47%)"></i><i style="background:hsl(30 60% 42%)"></i></div>');
      const mid = onScreen(a, lots.filter(([, e]) => e > 0.4 && e < 0.65).map(([p]) => p), 200, 330);
      if (mid) a.co(1, mid[0] + 16, mid[1] - 16);
      a.co(2, ...a.P(bad[0].px + 3, bad[0].py));
      const lush = onScreen(a, lots.filter(([p, e]) => e >= 0.75 && nearGreen(p)).map(([p]) => p), 100, 430);
      if (lush) a.co(3, lush[0] - 16, lush[1] - 16);
    },
  },
  {
    id: 'F7', title: '视图：货运', from: 'F0 选货运；或 E2 点邻居头像',
    query: q({ zoom: 0.08, x: 43, y: 19 }),
    notes: ['分项：全部、公路、铁路、水运、航空', '货从楼流向出口：流动的箭头，越粗货越多；公路橙色、水运蓝色', '出口旁只写去哪', '有别人的货穿过的码头和接口上，用“过路”图标写每天收的过路费；穿城要从一个接口进、另一个接口出，只有一个接口的那种线收不到', '邻居的名字在每条边中点的外侧；边界外是邻居的灰色画面', '水运沿着穿城的河，谁也挡不住，但卖得便宜'],
    draw(a) {
      grey(a, 'e', { lines: [{ kind: 'highway', pts: [[64, 7.5], [124, 7.5]] }, { kind: 'river', pts: [[64, 52], [124, 56]] }] });
      grey(a, 's', { lines: [] });
      grey(a, 'n', { lines: [] });
      grey(a, 'w', { lines: [{ kind: 'river', pts: [[-60, 50], [0, 53]] }] });
      a.fade(0.5);
      const ind = a.near(3, 45, 41);
      const road = [[ind.px, ind.py], [44.5, ind.py], [44.5, 32.5], [49.5, 32.5], [49.5, 12.5], [63.5, 7.5]];
      const feeder = a.simplify(a.roadPath([30, 34], [44, 33]));
      a.svg(a.line(feeder, 'stroke="#e07a3f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="8 6"'));
      a.svg(a.line(road, 'stroke="#e07a3f" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="12 7"'));
      const dock = [45.5, 45.2];
      a.svg(a.line([[ind.px, ind.py], [ind.px - 0.5, 43.5], dock], 'stroke="#2f86c4" stroke-width="5" stroke-linecap="round" stroke-dasharray="8 6"'));
      a.svg(a.line([[8, 53.5], [20, 52], [30, 48.5], [40, 46.3], dock], 'stroke="#2f86c4" stroke-width="4" stroke-linecap="round" stroke-dasharray="7 6" opacity=".8"'));
      a.svg(a.line([dock, [52, 48.5], [60, 51.5], [63.9, 52.5]], 'stroke="#2f86c4" stroke-width="9" stroke-linecap="round" stroke-dasharray="12 7"'));
      a.label(...dock, circleIcon('⚓', '#2f86c4'));
      const p1 = port(a, 64, 7.5, '🛤️', 'ok', { r: 12 });
      const ex1 = navyTag(a, p1[0] - 22, p1[1] - 2, `→ ${NB.e.av} ${NB.e.name}`, { anchor: 'right' });
      const [rx, ry] = a.P(63.9, 52.5);
      navyTag(a, rx + 14, ry + 14, `→ ⛴️ ${NB.e.av} ${NB.e.name}`);
      const [kx, ky] = a.P(...dock);
      const t1 = chip(a, kx + 18, ky + 20, tollTag('+¥95/天'));
      const ne = nbName(a, 'e', 'e', { at: [67, 22] });
      nbName(a, 's', 's', { at: [60, 67] });
      nbName(a, 'n', 'n');
      nbName(a, 'w', 'w', { at: [-3, 10] });
      const top = viewTop(a, '📦', '货运', ['全部', '🚚', '🚆', '⛴️', '✈️']);
      a.coAt(1, top.sub(4), top.sub(4).offsetWidth + 6, -2);
      const mid = screenSamples(a, road).filter(([sx, sy]) => sx > 30 && sx < a.W - 30 && sy > 190 && sy < a.H - 80 && Math.hypot(sx - p1[0], sy - p1[1]) > 90);
      const m = mid[Math.floor(mid.length / 2)] ?? [200, 400];
      a.co(2, m[0] + 14, m[1] - 4);
      a.coAt(3, ex1, -14, 14);
      a.coAt(4, t1, t1.offsetWidth + 12, 14);
      a.coAt(5, ne, -14, 15);
      const [wx, wy] = a.P(55, 49.6);
      a.co(6, wx, wy + 16);
    },
  },
  {
    id: 'F8', title: '视图：地铁', from: 'F0 选地铁（6 级解锁）',
    query: q({ zoom: 0.17, x: 31, y: 30 }),
    notes: ['地面变暗，露出地下的线路', '每条线一个颜色，一根线或一个环，不分叉', '站是白圈；两条线相交的站画成一个大白圈，不写字', '点站 → 线路高亮，气泡写每天坐车的人数'],
    draw(a) {
      a.fade(0.25);
      a.svg(`<rect x="0" y="0" width="${a.W}" height="${a.H}" fill="rgba(10,20,40,.35)"/>`);
      const lines = a.city.metro.lines;
      for (const [i, l] of lines.entries()) a.svg(a.line(l.points, `stroke="${METRO[i]}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"`));
      const seen = new Map();
      for (const l of lines) {
        const kept = l.stations.filter((s, i) => !l.stations.slice(0, i).some((t) => Math.hypot(t[0] - s[0], t[1] - s[1]) <= 1.5));
        for (const s of kept) { const k = s.join(','); seen.set(k, (seen.get(k) ?? 0) + 1); }
      }
      for (const [k, n] of seen) { const [x, y] = k.split(',').map(Number); const [sx, sy] = a.P(x, y); a.svg(`<circle cx="${sx}" cy="${sy}" r="${n > 1 ? 11 : 7}" fill="#fff" stroke="#13303d" stroke-width="3"/>`); }
      viewTop(a, '🚇', '地铁');
      a.co(1, 60, 700);
      a.co(2, ...a.P(19, 16));
      const inter = [...seen].find(([, n]) => n > 1);
      if (inter) { const [sx, sy] = a.P(...inter[0].split(',').map(Number)); a.co(3, sx + 18, sy - 16); }
      a.co(4, ...a.P(38, 32));
    },
  },
];
