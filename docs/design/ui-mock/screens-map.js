// 点地图上的东西（E1 至 E12）和视图（F0 至 F8 及分项）。
import { q, MAIN, NB, base, built, circleIcon, scrimNote } from './screens-common.js';
import { ROW2, modeTop, coBack, row2, subBtn, carBtn, tri, grey, nbName, port, BROKEN } from './parts-b.js';

const EDU_COL = ['#c7c2b8', '#9ccf6a', '#2a9d8f', '#3b5ba9'];
const EDU = `<div class="stack" style="margin-top:8px">${[15, 45, 30, 10].map((v, i) => `<i style="flex:${v};background:${EDU_COL[i]}"></i>`).join('')}</div>`;
const SEL = 'fill="rgba(255,236,150,.35)" stroke="#ffd76a" stroke-width="3"';
const big = (html) => `<div style="margin-top:4px;font-weight:800;font-size:14px" class="emo">${html}</div>`;
const SUBS_SVC = ['🛡️', '🚒', '🏥', '🏫', '♻️'];
const SUBS_POP = ['👥', '💼', '🎓', '🙅', '🛒'];

/** 标注放在元素左边；左边没地方时放右边。 */
function side(a, n, el, dy = 14) {
  const r = el.getBoundingClientRect();
  return r.left > 30 ? a.co(n, r.left - 14, r.top + dy) : a.co(n, r.right + 14, r.top + dy);
}
/** 离 (x, y) 最近的一个。 */
const nearest = (list, x, y) => [...list].sort((m, n) => Math.hypot(m.px - x, m.py - y) - Math.hypot(n.px - x, n.py - y))[0];
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
/** 视图的顶条：返回、视图名（点了展开小托盘切视图）；第二行分项，on 是选中的那个。 */
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
    notes: ['住宅、星（住户收入）和表情', '住了多少人', '五种服务（派出所是盾牌）和水、电、燃气：亮着是有，暗着是没有；垃圾是全城的，不在单栋楼的气泡里', '学历四色条：没上学、小学、中学、大学', '右下角“车 + 路线”：看这栋楼的车去哪 → E5', '改规划、征收不在气泡里：拿工具直接画在上面（D5）', scrimNote],
    draw(a) {
      const p = a.near(1, 47, 30, built);
      a.svg(a.parcelShape(p, SEL));
      base(a);
      const b = a.bubble(p.px, p.py, `<div class="t emo">🏠 住宅 ${a.stars(2, 2)} <span style="margin-left:auto">😀</span></div>${big('👥 46')}<div class="svc emo">${['🛡️', '🚒', '🏥', '🏫', '🎓', '|', '💧', '⚡', '🔥'].map((e, i) => (e === '|' ? '<span style="width:1px;background:#c99a3e;margin:0 2px"></span>' : `<span class="${i === 4 ? 'off' : ''}">${e}</span>`)).join('')}</div>${EDU}<div class="bb">${carBtn()}</div>`, { lift: 24 });
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
    notes: ['类别和星：实心星是卖得出去的档，空心星是有本事但没通道或没需求', '空心星旁一个灰色虚线圈，画着缺的那种通道（按码头、铁路、飞机取第一种还没造、对这一星有用的）；点它打开建造托盘里那张卡片', '都造了还空心时画邻居头像：点了打开货运视图（F7）', '岗位用了多少；工业多一个污染图标', '一句“销往某某地区”', '右下角“车 + 路线”：看它的车去哪 → E5'],
    draw(a) {
      const p = a.near(3, 44, 41);
      a.svg(a.parcelShape(p, SEL));
      base(a);
      const b = a.bubble(p.px, p.py, `<div class="t emo">🏭 消费品 ${a.stars(3, 2)}<span class="chan">⚓</span></div>${big('💼 112 / 130 · 💨')}<div style="margin-top:4px;color:#7a5a30;font-weight:700;font-size:13px">销往临江地区</div><div class="bb">${carBtn()}</div>`, { lift: 30 });
      const alt = a.add(`<div class="states" style="left:12px;top:560px;width:220px"><span class="lbl">都造了还空心时</span><div class="st emo" style="font-size:15px">🏭 ${a.stars(3, 2)}<span style="display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#fff;border:2px dashed #8a8a8a;font-size:16px">${NB.e.av}</span></div></div>`);
      side(a, 1, b, 16);
      a.coAt(2, b.querySelector('.chan'), b.querySelector('.chan').offsetWidth + 14, 4);
      a.coAt(3, alt, alt.offsetWidth - 8, 8);
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
    query: MAIN,
    notes: ['覆盖了多少人、每天的维护费', '金色虚线的覆盖圈画在地图上', '这一种服务的预算三档，和 C1 的税率拨钮同样式；改的是全城这一种服务，只改花多少钱和满意度加多少，不改半径', '拨动时全城同种建筑一起冒表情', scrimNote],
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
      if (face) a.coAt(4, face[1], face[1].offsetWidth + 10, 0);
      a.co(5, 300, 660);
    },
  },
  {
    id: 'E5', title: '车流去向（下钻一层）', from: 'E1、E2、E3 点右下角“车 + 路线”',
    query: q({ view: 'traffic', zoom: 0.26, x: 34, y: 34 }),
    notes: ['左上返回：回到原来的气泡（E1、E2 或 E3），不是直接回地图；这一层点楼不响应', '小签写着看的是谁的车', '这栋楼的车走哪些路：金色光带，粗细分三档，越粗车越多', '其余是交通视图的样子（路按负荷着色）'],
    draw(a) {
      const p = a.near(1, 34, 39, built);
      [[19, 27], [44, 41], [34, 13]].forEach((e, i) => flow(a, a.simplify(a.roadPath([p.px, p.py], e)), [12, 8, 4][i]));
      a.svg(a.parcelShape(p, 'fill="#ffd76a" stroke="#fff" stroke-width="3"'));
      const top = modeTop(a, { icon: '<span style="font-size:18px">🚗</span>', name: '这栋住宅的车', drop: false, money: null });
      coBack(a, 1, top);
      a.coAt(2, top.title, top.title.offsetWidth - 10, top.title.offsetHeight + 12);
      a.co(3, ...a.P(26, 33));
      a.co(4, 60, 700);
    },
  },
  {
    id: 'E6', title: '点农田', from: 'B1 点一片农田',
    query: q({ zoom: 0.42, x: 33, y: 54 }),
    notes: ['作物和星：农业最高两星，造了农业科技园后部分类别到三星', '每天的产量', '没有按钮', '整片农田的轮廓描金'],
    draw(a) {
      for (const o of a.city.overlays.filter((v) => v.key.startsWith('f-'))) a.svg(a.cellDiamond(o.x, o.y, 'fill="rgba(255,236,150,.25)" stroke="#ffd76a" stroke-width="1.5"'));
      base(a);
      const fx = a.parcels.find((p) => p.zone === 4) ?? { px: 33.5, py: 52.5 };
      const b = a.bubble(fx.px, fx.py, `<div class="t emo">🌾 稻田 ${a.stars(2, 1)}</div>${big('📦 每天 120')}`, { lift: 20 });
      side(a, 1, b, 16);
      side(a, 2, b, 46);
      a.coAt(3, b, b.offsetWidth + 14, 30);
      a.co(4, ...a.P(37, 57));
    },
  },
  {
    id: 'E7', title: '点水厂、电厂、燃气厂', from: 'B1 点一座厂',
    query: q({ zoom: 0.3, x: 38, y: 31 }),
    notes: ['种类和级别：厂房加罗马数字', '用了多少：满了条变红', '它供应到的楼一起亮起来（同一片路网里离它近的先供）', '没有按钮；换等级、换种类拿工具直接放在上面（D15）'],
    draw(a) {
      a.fade(0.55);
      const w = a.parcels.find((p) => p.use === 'water');
      const lit = a.parcels.filter((x) => x.zone >= 1 && x.zone <= 3 && Math.hypot(x.px - w.px, x.py - w.py) < 13);
      for (const p of lit) a.svg(a.parcelShape(p, 'fill="rgba(70,150,214,.75)" stroke="#d6efff" stroke-width="1"'));
      a.svg(a.parcelShape(w, SEL));
      base(a);
      const b = a.bubble(w.px, w.py, `<div class="t emo">💧 水厂 <span style="display:inline-flex;align-items:center;gap:2px;padding:0 6px;border-radius:8px;background:#e6d4a6;font-size:13px">🏭<b style="font-family:serif">Ⅰ</b></span></div><div class="meter"><i style="width:72%;background:linear-gradient(#9fd6f5,#2f86c4)"></i></div>${big('用了 72%')}`, { lift: 24 });
      side(a, 1, b, 16);
      side(a, 2, b.querySelector('.meter'), 4);
      const one = nearest(lit, w.px - 2, w.py + 6);
      if (one) a.co(3, ...a.P(one.px, one.py));
      a.coAt(4, b, b.offsetWidth + 14, 30);
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
    query: q({ zoom: 0.34, x: 25, y: 28 }),
    notes: ['线路颜色、每天坐车的人', '整条线路高亮', '改线路：进 D13（公交）或 D14（地铁）', '拆掉整条线：红色，按住约 1 秒'],
    draw(a) {
      a.fade(0.6);
      const loop = [...BUS, BUS[0]];
      for (let i = 0; i < loop.length - 1; i += 1) {
        const seg = a.simplify(a.roadPath(loop[i], loop[i + 1]));
        a.svg(a.line(seg, 'stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"') + a.line(seg, 'stroke="#e07a1f" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"'));
      }
      for (const [x, y] of BUS) { const [sx, sy] = a.P(x, y); a.svg(`<circle cx="${sx}" cy="${sy}" r="11" fill="#fff" stroke="#e07a1f" stroke-width="3.5"/><text x="${sx}" y="${sy + 5}" text-anchor="middle" font-size="13">🚌</text>`); }
      const [sx, sy] = a.P(...BUS[3]);
      a.svg(`<circle cx="${sx}" cy="${sy}" r="17" fill="none" stroke="#ffd76a" stroke-width="4"/>`);
      base(a);
      const b = a.bubble(...BUS[3], `<div class="t emo">${lineDot('#e07a1f')} 公交 2 号线</div>${big('👥 每天 640')}<div class="bb">${a.btn('改线路', 'blue')}<span class="btn red hold"><i class="fill" style="width:30%"></i><span>按住 拆线</span></span></div>`, { lift: 16 });
      const bs = b.querySelectorAll('.btn');
      side(a, 1, b, 30);
      a.co(2, ...a.P(24.5, 22.2));
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
      a.coAt(4, b, b.offsetWidth + 14, 20);
    },
  },
  {
    id: 'E11', title: '点奖励建筑', from: 'B1 点一座奖励建筑',
    query: q({ zoom: 0.36, x: 26, y: 44 }),
    notes: ['奖杯和名字', '作用画成图标：湿地公园是“周边工业污染清零”', '每天的维护费；带游客的多一行每天来多少人', '有范围的（只有湿地公园）把范围画在地图上', '没有按钮'],
    draw(a) {
      const area = [[23, 44], [27, 44], [27.5, 47.5], [23, 47.8]];
      a.svg(a.poly(area, 'fill="rgba(110,190,120,.85)" stroke="#ffd76a" stroke-width="3"'));
      a.label(25, 46, '<span class="emo" style="font-size:24px">🦢</span>');
      a.svg(a.ring(25, 46, 7, 'fill="rgba(126,224,138,.12)" stroke="#7ee08a" stroke-width="3" stroke-dasharray="10 6"'));
      base(a);
      const b = a.bubble(25, 45, `<div class="t emo">🏆 湿地公园</div><div class="emo" style="margin-top:6px;font-size:18px;display:flex;align-items:center;gap:4px">🏭💨 → <b style="font-size:15px">0</b></div>${big('每天 −¥60')}`, { lift: 20 });
      side(a, 1, b, 16);
      side(a, 2, b, 46);
      side(a, 3, b, 76);
      a.co(4, ...a.P(31, 48));
      a.coAt(5, b, b.offsetWidth + 14, 30);
    },
  },
  {
    id: 'E12', title: '其余几种气泡', from: 'B1 点公园、垃圾处理用地、铁路、车站、划了区没长楼的格子',
    query: MAIN,
    notes: ['公园：环境加分、每天维护费；地图上描出公园的轮廓和环境范围', '垃圾处理用地：一个容量环，处理了多少、还能处理多少；全城的垃圾用地一起描边', '铁路线段：每天过多少趟货车；连到的站一起亮', '货运站：每天装卸的货；经过它的货运线路画出来', '客运站：每天上下车的人；没接上邻居的铁路网时一个断链图标', '划了区没长楼的格子：缺什么画什么（缺路、缺水、缺电、需求短）；什么都不缺时一个小工地图标，楼正在来的路上', '一张图摆了六种，游戏里一次只出一个气泡'],
    draw(a) {
      a.fade(0.45);
      const ring = (p) => `<svg width="46" height="46" viewBox="0 0 46 46"><circle cx="23" cy="23" r="18" fill="none" stroke="#d9c38f" stroke-width="7"/><circle cx="23" cy="23" r="18" fill="none" stroke="#8a6a3a" stroke-width="7" stroke-dasharray="${113 * p} 113" transform="rotate(-90 23 23)"/><text x="23" y="27" text-anchor="middle" font-size="12" font-weight="900" fill="#5a3a12">${Math.round(p * 100)}%</text></svg>`;
      const miss = (e) => `<span style="position:relative;display:inline-grid;place-items:center;width:30px;height:30px;border-radius:8px;background:#fff;border:2px solid #c99a3e">${e}<i style="position:absolute;left:3px;right:3px;top:13px;height:3px;background:#8a8a8a;transform:rotate(-35deg)"></i></span>`;
      const cards = [
        ['🌳 公园', big('🌿 +3 · 每天 −¥10')],
        ['♻️ 垃圾处理用地', `<div style="display:flex;align-items:center;gap:8px;margin-top:4px">${ring(0.8)}<b style="font-size:13px">3,200 / 4,000 人</b></div>`],
        ['🛤️ 铁路', big('🚂 每天 18 趟')],
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
      const v = [['🚗', '交通'], ['🚓', '公共服务'], ['💧', '水电燃气'], ['👥', '人口岗位'], ['🙂', '满意度'], ['🌿', '环境'], ['📦', '货运'], ['🚇', '地铁', 6]];
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
    query: q({ zoom: 0.22, x: 32, y: 32 }),
    notes: ['分项：警察、消防、医院、学校、垃圾；一次只看一种', '覆盖圈', '覆盖到的住宅是青绿色；没覆盖的是橙色，一闪一闪，一眼看出该往哪放', '学校分三种颜色：没有学校、只有小学、都有'],
    draw(a) {
      a.fade(0.4);
      const hosp = a.parcels.filter((p) => p.zone === 5 && p.use === 'hospital');
      for (const h of hosp) a.svg(a.ring(h.px, h.py, 8, 'fill="rgba(42,143,168,.10)" stroke="#2a8fa8" stroke-width="2.5" stroke-dasharray="8 6"'));
      let miss = null;
      for (const p of a.parcels.filter((x) => x.zone === 1)) {
        const ok = hosp.some((h) => Math.hypot(h.px - p.px, h.py - p.py) <= 8);
        if (!ok && !miss) miss = p;
        a.svg(a.parcelShape(p, ok ? 'fill="rgba(42,157,143,.8)"' : 'fill="rgba(240,120,60,.9)" stroke="#fff" stroke-width="1.5"'));
      }
      for (const h of hosp) a.label(h.px, h.py, circleIcon('🏥', '#2a8fa8'));
      const bar = a.add('<div class="modebar"><div class="back">‹</div><div class="title emo">🚓 公共服务</div><div class="subs emo"><div class="sub">🚓</div><div class="sub">🚒</div><div class="sub on">🏥</div><div class="sub">🏫</div><div class="sub">♻️</div></div></div>');
      a.add('<div class="legend"><span class="emo">🏥</span><i style="background:#2a9d8f"></i><i style="background:#f0783c"></i></div>');
      a.coAt(1, bar.querySelector('.subs .sub'), -6, -4);
      a.co(2, ...a.P(hosp[0].px + 6, hosp[0].py + 4));
      if (miss) a.co(3, ...a.P(miss.px, miss.py));
      a.coAt(4, bar.querySelectorAll('.sub')[3], 34, 0);
    },
  },
  {
    id: 'F2a', title: '视图：公共服务的学校分项', from: 'F2 点分项里的学校；或 C4 点服务',
    query: q({ zoom: 0.22, x: 32, y: 30 }),
    notes: ['分项选学校：小学和中学一起看', '三种颜色：橙色是没有学校，黄色是只有小学，青绿是小学和中学都有；橙色一闪一闪', '小学和中学各画各的覆盖圈；中学只对已经有小学覆盖的住户起作用', '图例三个色块'],
    draw(a) {
      a.fade(0.4);
      const schools = a.parcels.filter((p) => p.zone === 5 && p.use === 'school');
      const mids = schools.filter((_, i) => i % 2 === 0);
      for (const s of schools) a.svg(a.ring(s.px, s.py, 8, 'fill="rgba(156,207,106,.10)" stroke="#7fb24a" stroke-width="2.5" stroke-dasharray="8 6"'));
      for (const s of mids) a.svg(a.ring(s.px, s.py, 11, 'fill="none" stroke="#2a8fa8" stroke-width="2.5" stroke-dasharray="3 5"'));
      const none = [];
      for (const p of a.parcels.filter((x) => x.zone === 1)) {
        const pri = schools.some((s) => Math.hypot(s.px - p.px, s.py - p.py) <= 8);
        const mid = pri && mids.some((s) => Math.hypot(s.px - p.px, s.py - p.py) <= 11);
        if (!pri) none.push(p);
        a.svg(a.parcelShape(p, mid ? 'fill="rgba(42,157,143,.85)"' : pri ? 'fill="rgba(242,201,76,.9)"' : 'fill="rgba(240,120,60,.9)" stroke="#fff" stroke-width="1.5"'));
      }
      for (const s of schools) a.label(s.px, s.py, circleIcon(mids.includes(s) ? '🎓' : '🏫', '#2a8fa8'));
      const top = viewTop(a, '🛡️', '公共服务', SUBS_SVC, 3);
      const leg = a.add('<div class="legend"><span class="emo">🏫</span><i style="background:#f0783c"></i><i style="background:#f2c94c"></i><i style="background:#2a9d8f"></i></div>');
      a.coAt(1, top.sub(3), top.sub(3).offsetWidth + 6, -2);
      const n = nearest(none, 32, 30);
      if (n) a.co(2, ...a.P(n.px, n.py));
      a.co(3, ...a.P(mids[0].px + 9, mids[0].py + 5));
      a.coAt(4, leg, leg.offsetWidth + 12, 16);
    },
  },
  {
    id: 'F2b', title: '视图：公共服务的垃圾分项', from: 'F2 点分项里的垃圾；或 C4 点垃圾',
    query: q({ zoom: 0.24, x: 44, y: 30 }),
    notes: ['分项选垃圾', '左上一根全城处理率的条：处理了多少人 / 全城多少人', '每块垃圾处理用地一个容量环；用地不分片、不管距离，连上路就处理全城', '处理不够时，全城住宅一起淡橙色一闪一闪（不挑楼，按比例一起扣分）'],
    draw(a) {
      a.fade(0.45);
      for (const p of a.parcels.filter((x) => x.zone === 1)) a.svg(a.parcelShape(p, 'fill="rgba(240,150,90,.55)" stroke="#fff" stroke-width="1"'));
      const lots = [[53, 25, 55, 27, 0.95], [54, 35, 55, 36, 1]];
      let first = null;
      for (const [x0, y0, x1, y1, p] of lots) {
        a.svg(a.poly([[x0, y0], [x1 + 1, y0], [x1 + 1, y1 + 1], [x0, y1 + 1]], 'fill="#b08a5a" stroke="#5a3a12" stroke-width="2"'));
        const [cx, cy] = a.P((x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2);
        const len = 2 * Math.PI * 20;
        a.svg(`<circle cx="${cx}" cy="${cy - 26}" r="20" fill="rgba(255,255,255,.92)" stroke="#d9c38f" stroke-width="7"/><circle cx="${cx}" cy="${cy - 26}" r="20" fill="none" stroke="${p >= 1 ? '#e07a3f' : '#8a6a3a'}" stroke-width="7" stroke-dasharray="${len * p} ${len}" transform="rotate(-90 ${cx} ${cy - 26})"/><text x="${cx}" y="${cy - 21}" text-anchor="middle" font-size="14">♻️</text>`);
        first ??= [cx, cy - 26];
      }
      const top = viewTop(a, '🛡️', '公共服务', SUBS_SVC, 4);
      const rate = a.add(`<div class="emo" style="position:absolute;left:10px;top:${ROW2 + 54}px;width:200px;display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:12px;background:rgba(13,36,46,.88);border:1.5px solid #ffd76a;color:#fff;font-weight:800;font-size:13px">♻️<div class="meter" style="flex:1;margin:0"><i style="width:82%;background:linear-gradient(#ffcf8a,#e07a3f)"></i></div>82%</div>`);
      a.coAt(1, top.sub(4), top.sub(4).offsetWidth + 6, -2);
      a.coAt(2, rate, rate.offsetWidth + 12, 16);
      a.co(3, first[0] + 30, first[1]);
      const r = a.near(1, 46, 30);
      a.co(4, ...a.P(r.px, r.py));
    },
  },
  {
    id: 'F3', title: '视图：水电燃气', from: 'F0 选水电燃气；或 C4 点水电燃气',
    query: q({ zoom: 0.24, x: 34, y: 33 }),
    notes: ['三根进度条浮在地图上，颜色固定：水蓝、电黄、燃气橙；满了外框变红', '有供应的楼着蓝色；断了的楼变灰、一闪一闪，楼头上冒缺的那样的小图标（离厂最远的先停）', '厂的位置一圈圈往外扩', '三样画在同一张图上，不分页'],
    draw(a) {
      a.fade(0.4);
      let gray = null;
      for (const p of a.parcels.filter((x) => x.zone >= 1 && x.zone <= 3)) {
        const off = p.px > 44 && p.py > 36;
        if (off) {
          gray ??= p;
          a.svg(a.parcelShape(p, 'fill="rgba(160,168,172,.95)" stroke="#fff" stroke-width="1.5"'));
          if (p.id % 2 === 0) a.label(p.px, p.py - 0.8, '<span class="emo" style="display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#fff;border:2px solid #e07a3f;font-size:12px">🔥</span>');
        } else a.svg(a.parcelShape(p, 'fill="rgba(70,150,214,.8)"'));
      }
      const plants = a.parcels.filter((p) => p.zone === 5 && (p.use === 'power' || p.use === 'water'));
      for (const p of plants) {
        a.svg(a.ring(p.px, p.py, 2.5, 'fill="none" stroke="#1f6fa3" stroke-width="3"') + a.ring(p.px, p.py, 4, 'fill="none" stroke="#1f6fa3" stroke-width="2" opacity=".5"'));
        a.label(p.px, p.py, circleIcon(p.use === 'power' ? '⚡' : '💧', '#1f6fa3'));
      }
      viewTop(a, '<span style="font-size:13px">💧⚡🔥</span>', '水电燃气');
      const fb = a.add(`<div class="floatbars emo" style="top:${ROW2}px">${[['💧', 72, '#5aa9d6'], ['⚡', 91, '#f2c94c'], ['🔥', 100, '#f08a3c']].map(([e, p, c]) => `<div style="${p >= 100 ? 'border-color:#e5332a;box-shadow:0 0 0 2px #e5332a' : ''}">${e}<div class="meter"><i style="width:${p}%;background:${c}"></i></div></div>`).join('')}</div>`);
      a.coAt(1, fb, -14, 20);
      if (gray) a.co(2, ...a.P(gray.px - 0.6, gray.py + 0.6));
      if (plants[0]) a.co(3, ...a.P(plants[0].px + 2, plants[0].py + 2));
      a.co(4, 60, 700);
    },
  },
  {
    id: 'F4', title: '视图：人口和岗位', from: 'F0 选人口岗位；或 C3 点小卡',
    query: q({ zoom: 0.26, x: 32, y: 32 }),
    notes: ['分项：人口、岗位、学历、失业、商场', '人口：每栋住宅上一根小柱子，越高住得越多', '人口小卡的缩小版浮在角上', '点楼照样冒气泡'],
    draw(a) {
      a.fade(0.45);
      for (const p of a.parcels.filter((x) => x.zone === 1)) {
        const [x, y] = a.P(p.px, p.py);
        const h = Math.min(56, 12 + (p.capacity ?? 20) / 2);
        a.svg(`<rect x="${x - 5}" y="${y - h}" width="10" height="${h}" rx="2" fill="#e07a3f" stroke="#fff" stroke-width="1.5"/><ellipse cx="${x}" cy="${y - h}" rx="5" ry="2" fill="#f4a26c"/>`);
      }
      const bar = a.add('<div class="modebar"><div class="back">‹</div><div class="title emo">👥 人口岗位</div><div class="subs emo"><div class="sub on">👥</div><div class="sub">💼</div><div class="sub">🎓</div><div class="sub">🙅</div><div class="sub">🛒</div></div></div>');
      const mini = a.panel('', '', `<div class="emo" style="font-weight:900">👥 8,450 · 💼 7,900 · 🙅 120</div>${EDU}`, 'left:10px;right:110px;bottom:18px;padding:8px 10px');
      a.coAt(1, bar.querySelector('.subs .sub'), -6, -4);
      const p = a.near(1, 30, 30);
      a.co(2, ...a.P(p.px, p.py));
      a.coAt(3, mini, 0, 0);
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
      const card = a.panel('', '', `<div class="emo" style="font-weight:900;font-size:14px">👥 8,450</div>${EDU}`, 'left:10px;right:110px;bottom:52px;padding:8px 10px');
      const leg = a.add(`<div class="legend" style="left:auto;right:10px">${EDU_COL.map((c) => `<i style="background:${c};width:16px"></i>`).join('')}</div>`);
      a.coAt(1, top.sub(2), top.sub(2).offsetWidth + 6, -2);
      const p = a.near(1, 30, 26);
      a.co(2, ...a.P(p.px, p.py));
      a.coAt(3, card, card.offsetWidth - 10, -6);
      a.coAt(4, leg, -14, 16);
    },
  },
  {
    id: 'F4b', title: '视图：人口的商场分项', from: 'F4 点分项里的商场；或 C4 点购物',
    query: q({ zoom: 0.24, x: 30, y: 28 }),
    notes: ['分项选商场', '商场按星着色：星越高颜色越深，楼头上写几星', '就近有商场的住宅青绿；没有的橙色，一闪一闪', '居民买东西按收入档找同档的商场，所以高收入住户附近要有高星商场'],
    draw(a) {
      a.fade(0.4);
      const shops = a.parcels.filter((p) => p.use === 'shop');
      const big3 = a.parcels.filter((p) => p.zone === 2 && p.level >= 3).filter((_, i) => i % 3 === 0);
      const malls = [...shops, ...big3];
      const tone = ['#f6d98a', '#e9a93a', '#c77412', '#8a4a06'];
      for (const m of malls) a.svg(a.parcelShape(m, `fill="${tone[Math.min(4, Math.max(1, m.level)) - 1]}" stroke="#5a3a12" stroke-width="1.5"`));
      for (const m of big3) a.label(m.px, m.py - 0.8, `<span style="font-size:11px;font-weight:900;color:#5a3a12;background:#fff8d6;border-radius:6px;padding:0 4px;border:1px solid #c99a3e">${'★'.repeat(Math.min(4, m.level))}</span>`);
      const far = [];
      for (const p of a.parcels.filter((x) => x.zone === 1)) {
        const ok = malls.some((m) => Math.hypot(m.px - p.px, m.py - p.py) <= 9);
        if (!ok) far.push(p);
        a.svg(a.parcelShape(p, ok ? 'fill="rgba(42,157,143,.8)"' : 'fill="rgba(240,120,60,.9)" stroke="#fff" stroke-width="1.5"'));
      }
      const top = viewTop(a, '👥', '人口岗位', SUBS_POP, 4);
      a.add(`<div class="legend"><span class="emo">🛒</span>${tone.map((c) => `<i style="background:${c};width:18px"></i>`).join('')}<span style="width:6px"></span><i style="background:#2a9d8f;width:18px"></i><i style="background:#f0783c;width:18px"></i></div>`);
      a.coAt(1, top.sub(4), top.sub(4).offsetWidth + 6, -2);
      const m = big3[0] ?? malls[0];
      a.co(2, ...a.P(m.px + 1, m.py));
      const f = nearest(far, 30, 28);
      if (f) a.co(3, ...a.P(f.px, f.py));
      a.co(4, 300, 640);
    },
  },
  {
    id: 'F5', title: '视图：满意度', from: 'F0 选满意度；或 C4 点奖励建筑',
    query: q({ zoom: 0.3, x: 32, y: 34 }),
    notes: ['每栋住宅头上一个表情，颜色跟着表情', '五档五色：很好、好、一般、差、很差；最差一档用深橙，不用红', '不显示分数，也不写原因；看原因就去对应的视图（C4 点因素）'],
    draw(a) {
      a.fade(0.45);
      const faces = ['😀', '🙂', '😐', '😟', '😫'];
      const cols = ['#2e9e4f', '#8bc34a', '#f2c94c', '#f0a040', '#d9661f'];
      for (const p of a.parcels.filter((x) => x.zone === 1)) {
        const k = [0, 1, 1, 2, 3, 4, 1][(p.id * 7) % 7];
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
      for (const p of a.parcels.filter((x) => x.zone >= 1 && x.zone <= 3)) {
        let e = 0.75;
        for (const s of bad) e -= Math.max(0, 0.4 - Math.hypot(s.px - p.px, s.py - p.py) / 16);
        if (p.py > 40) e += 0.15;
        e = Math.max(0, Math.min(1, e));
        a.svg(a.parcelShape(p, `fill="hsl(${30 + e * 90} 60% ${42 + e * 10}%)" fill-opacity=".85"`));
      }
      for (const s of bad.slice(0, 5)) a.svg(a.ring(s.px, s.py, 3, 'fill="none" stroke="#7a4a1a" stroke-width="3" opacity=".8"') + a.ring(s.px, s.py, 5, 'fill="none" stroke="#7a4a1a" stroke-width="2" opacity=".4"'));
      a.add('<div class="modebar"><div class="back">‹</div><div class="title emo">🌿 环境</div></div>');
      a.add('<div class="legend"><span class="emo">🌿</span><i style="background:hsl(120 60% 52%)"></i><i style="background:hsl(75 60% 47%)"></i><i style="background:hsl(30 60% 42%)"></i></div>');
      const g = a.parcels.find((p) => p.zone === 1 && p.py > 38);
      if (g) a.co(1, ...a.P(g.px, g.py));
      a.co(2, ...a.P(bad[0].px + 3, bad[0].py));
      a.co(3, ...a.P(30, 46));
    },
  },
  {
    id: 'F7', title: '视图：货运', from: 'F0 选货运；或 E2 点邻居头像',
    query: q({ zoom: 0.09, x: 34, y: 30 }),
    notes: ['分项：全部、公路、铁路、水运、航空', '货从楼流向出口：流动的箭头，越粗货越多；公路橙色、水运蓝色', '出口旁只写去哪', '有别人的货穿过的接口和码头上，用“过路”图标写每天收的过路费', '邻居的名字在每条边中点的外侧；边界外是邻居的灰色画面', '水运沿着穿城的河，谁也挡不住，但卖得便宜'],
    draw(a) {
      grey(a, 'e', { lines: [{ kind: 'highway', pts: [[64, 7.5], [124, 7.5]] }, { kind: 'river', pts: [[64, 52], [124, 56]] }] });
      grey(a, 's', { lines: [{ kind: 'highway', pts: [[12.5, 64], [12.5, 124]] }] });
      grey(a, 'n', { lines: [] });
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
      port(a, 12.5, 64, '🛤️', 'ok', { r: 12 });
      const ex1 = a.add(`<div class="cap emo" style="position:absolute;left:${Math.min(p1[0] - 190, a.W - 200)}px;top:${p1[1] - 14}px;padding:0 10px;height:28px;font-size:13px">→ ${NB.e.av} ${NB.e.name}</div>`);
      const t1 = a.add(`<div style="position:absolute;left:${Math.min(p1[0] - 190, a.W - 200)}px;top:${p1[1] + 20}px">${tollTag('+¥180/天')}</div>`);
      const [rx, ry] = a.P(63.9, 52.5);
      a.add(`<div class="cap emo" style="position:absolute;left:${Math.min(rx - 20, a.W - 150)}px;top:${ry + 14}px;padding:0 10px;height:28px;font-size:13px">→ ⛴️ ${NB.e.av} ${NB.e.name}</div>`);
      const [kx, ky] = a.P(...dock);
      a.add(`<div style="position:absolute;left:${kx - 60}px;top:${ky + 18}px">${tollTag('+¥95/天')}</div>`);
      const ne = nbName(a, 'e', 'e');
      nbName(a, 's', 's');
      nbName(a, 'n', 'n');
      const top = viewTop(a, '📦', '货运', ['全部', '🚚', '🚆', '⛴️', '✈️']);
      a.coAt(1, top.sub(4), top.sub(4).offsetWidth + 6, -2);
      const mid = screenSamples(a, road).filter(([sx, sy]) => sx > 20 && sx < a.W - 20 && sy > 170 && sy < a.H - 60);
      const m = mid[Math.floor(mid.length / 2)] ?? [200, 400];
      a.co(2, m[0] + 12, m[1]);
      a.coAt(3, ex1, -14, 14);
      a.coAt(4, t1, -14, 14);
      a.coAt(5, ne, ne.offsetWidth + 6, 0);
      a.co(6, ...a.P(26, 51));
    },
  },
  {
    id: 'F8', title: '视图：地铁', from: 'F0 选地铁（6 级解锁）',
    query: q({ zoom: 0.17, x: 31, y: 30 }),
    notes: ['地面变暗，露出地下的线路', '每条线一个颜色，一根线或一个环，不分叉', '站是白圈；两条线相交的站画成一个大白圈，不写字', '点站 → 线路高亮，气泡写每天坐车的人数'],
    draw(a) {
      a.fade(0.25);
      a.svg(`<rect x="0" y="0" width="${a.W}" height="${a.H}" fill="rgba(10,20,40,.35)"/>`);
      const colors = ['#e5332a', '#2a8fd6', '#3fa75a'];
      for (const [i, l] of a.city.metro.lines.entries()) a.svg(a.line(l.points, `stroke="${colors[i]}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"`));
      const seen = new Map();
      for (const l of a.city.metro.lines) for (const s of l.stations) { const k = s.join(','); seen.set(k, (seen.get(k) ?? 0) + 1); }
      for (const [k, n] of seen) { const [x, y] = k.split(',').map(Number); const [sx, sy] = a.P(x, y); a.svg(`<circle cx="${sx}" cy="${sy}" r="${n > 1 ? 11 : 7}" fill="#fff" stroke="#13303d" stroke-width="3"/>`); }
      a.add('<div class="modebar"><div class="back">‹</div><div class="title emo">🚇 地铁</div></div>');
      a.co(1, 60, 700);
      a.co(2, ...a.P(19, 16));
      const inter = [...seen].find(([, n]) => n > 1);
      if (inter) { const [sx, sy] = a.P(...inter[0].split(',').map(Number)); a.co(3, sx + 18, sy - 16); }
      a.co(4, ...a.P(38, 32));
    },
  },
];
