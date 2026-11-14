// 顶部四个数的小卡：C1 至 C5，以及钱的下钻 C2。
import { q, MAIN, BARE, base, scrimNote, earlyCity } from './screens-common.js';
import { modeTop } from './parts-b.js';

const EDU = '<div class="stack"><i style="flex:15;background:#c7c2b8"></i><i style="flex:45;background:#9ccf6a"></i><i style="flex:30;background:#2a9d8f"></i><i style="flex:10;background:#3b5ba9"></i></div>';
const C = { res: '#7cc576', com: '#6fa8dc', ind: '#f2c94c', farm: '#c49a6c', toll: '#8fd0c4', other: '#d8cdb4', road: '#c9ccd0', svc: '#a7d3d9', util: '#f6d06a', bus: '#f7b98a', prize: '#e6c3f0' };
const UTIL = '<span style="display:inline-flex;font-size:13px;letter-spacing:-3px">💧⚡🔥</span>';
const EMPTY_CASE = '<svg class="ico" style="width:24px;height:24px" viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2.5" fill="none" stroke="#7a5520" stroke-width="2.2"/><path d="M9 7V5h6v2" fill="none" stroke="#7a5520" stroke-width="2.2"/></svg>';

const curveSvg = (vals, { zero = null, line = null } = {}) => {
  const max = Math.max(...vals.map(Math.abs), 1);
  const y = (v) => (zero === null ? 44 - (v / max) * 40 : zero - (v / max) * 24);
  const pts = vals.map((v, i) => `${(i * 300) / 23},${y(v).toFixed(1)}`).join(' ');
  const last = ((vals.length - 1) * 300) / 23;
  const base0 = zero === null ? 44 : zero;
  return `<svg viewBox="0 0 300 48" style="width:100%;height:48px;display:block">${zero !== null ? `<line x1="0" x2="300" y1="${zero}" y2="${zero}" stroke="#b39456" stroke-width="1" />` : ''}${line !== null ? `<line x1="0" x2="300" y1="${line}" y2="${line}" stroke="#f08a24" stroke-width="2.5" stroke-dasharray="7 5"/>` : ''}<polyline fill="rgba(31,127,146,.15)" stroke="none" points="0,${base0} ${pts} ${last},${base0}"/><polyline fill="none" stroke="#1f7f92" stroke-width="3" points="${pts}"/></svg>`;
};
const bar = (lab, segs, minis = [], flex = 1) => `<div class="row"><span class="lab">${lab}</span><div class="seg emo" style="flex:${flex}">${segs.map(([e, f, c]) => `<span style="flex:${f};background:${c}">${e}</span>`).join('')}</div>${flex < 1 ? `<span style="flex:${(1 - flex).toFixed(2)}"></span>` : ''}</div>${minis.length ? `<div class="minis emo">${minis.map(([e, t, c]) => `<span style="background:${c}">${e} ${t}</span>`).join('')}</div>` : ''}`;
const taxRow = (icon, col, on) => `<div class="row"><span class="emo" style="width:36px;height:36px;flex:none;border-radius:50%;display:grid;place-items:center;font-size:20px;background:${col};border:2px solid #7a5520">${icon}</span><div class="segctl"><i class="lo ${on === 0 ? 'on' : ''}">低</i><i class="mid ${on === 1 ? 'on' : ''}">正常</i><i class="hi ${on === 2 ? 'on' : ''}">高</i></div></div>`;
const UP = [12, 14, 13, 15, 17, 16, 18, 21, 20, 22, 24, 23, 25, 24, 26, 27, 26, 28, 30, 29, 31, 33, 32, 34];

function moneyCard(a, { head, curve, income, expense, taxes, button }) {
  return a.panel('card', head, `${curve}${income}${expense}<div class="taxlab" style="margin:10px 0 2px;font-size:12px;font-weight:900;color:#7a5a30">税率</div>${taxes}<div style="margin-top:10px">${button}</div>`);
}

const INCOME = bar('收', [['🏠', 40, C.res], ['🏭', 28, C.ind], ['🏬', 20, C.com], ['⋯', 6, C.other]], [['🌾', '+¥40', C.farm], ['🚚', '+¥35', C.toll]]);
const EXPENSE = bar('支', [['🛣️', 30, C.road], ['🏛️', 38, C.svc], [UTIL, 26, C.util], ['⋯', 6, C.other]], [['🚌', '−¥30', C.bus], ['🏆', '−¥18', C.prize]], 0.7);
const TAXES = [['🏠', C.res, 1], ['🏬', C.com, 1], ['🏭', C.ind, 2], ['🌾', C.farm, 0]].map(([e, c, on]) => taxRow(e, c, on)).join('');

/** 下钻画面的顶条：和视图一样，左上返回（回到 C1）加一个小签写看的是哪一项，不放资金。 */
const drillTop = (a, title) => modeTop(a, { icon: '', name: title, drop: false, money: null }).bar;
const goldLegend = (icon) => `<div class="legend"><span class="emo">${icon}</span>少<i style="background:#fbe7a6"></i><i style="background:#f2c14e"></i><i style="background:#c98a10"></i>多</div>`;
const gold = (k) => `rgba(${Math.round(250 - k * 50)},${Math.round(225 - k * 90)},${Math.round(140 - k * 120)},.85)`;

export const HUD = [
  {
    id: 'C1', title: '钱的小卡', from: 'B1 点资金',
    query: MAIN,
    notes: ['每小时净收入和最近 24 个游戏小时的曲线', '收入一根条：四类税和过路费，按来源分段；点一段 → C2', '太小的段并成“⋯其他”，条下一排同色小按钮，点了一样下钻', '支出一根条：只有维护费（道路、公共服务、水电燃气、公交地铁、奖励建筑）；建造、视频资金和奖励都不进；点一段 → C2a', '四类税率，各三档“低 正常 高”，颜色区分；拨动时地图上的楼冒小表情或小箭头。市政厅造好以前只有一个拨钮（C1a）', '看视频领钱（金色带 ▶）→ B6a；广告不可用 → B6b', scrimNote],
    draw(a) {
      base(a);
      const c = moneyCard(a, { head: '<span class="emo">💰</span> 每小时 +¥1,250', curve: curveSvg(UP), income: INCOME, expense: EXPENSE, taxes: TAXES, button: a.btn('看视频领 ¥3,600', 'wide', true) });
      const r = c.getBoundingClientRect();
      const rows = c.querySelectorAll('.row');
      const minis = c.querySelectorAll('.minis');
      a.co(1, r.right - 30, r.top + 62);
      a.coAt(2, rows[0], 50, 4);
      a.coAt(3, minis[0], minis[0].offsetWidth + 10, 12);
      a.coAt(4, rows[1], 50, 4);
      a.coAt(5, c.querySelector('.taxlab'), 44, 8);
      a.coAt(6, c.querySelector('.btn'), 10, 6);
      a.co(7, 200, r.bottom + 40);
    },
  },
  {
    id: 'C1a', title: '钱的小卡：1 级', from: 'B1 点资金（1 级的城市）',
    query: BARE({ zoom: 0.32, x: 30, y: 42 }),
    notes: ['曲线只画已经有的几个小时，空的部分不画', '收入只有已经有税的一类（住宅）', '支出只有道路和水电', '市政厅造好以前只有一个税率拨钮，四类一起调', '看视频领钱照常'],
    draw(a) {
      earlyCity(a, 4);
      base(a, { hud: { level: 1, money: '3,260', pop: '64', xp: 0.35, mail: 0, sprout: '剩 3 天' } });
      const short = [3, 4, 4, 5, 6, 7];
      const c = moneyCard(a, {
        head: '<span class="emo">💰</span> 每小时 +¥85',
        curve: `<svg viewBox="0 0 300 48" style="width:100%;height:48px;display:block"><polyline fill="rgba(31,127,146,.15)" stroke="none" points="${short.map((v, i) => `${i * 13},${44 - v * 5}`).join(' ')} 65,44 0,44"/><polyline fill="none" stroke="#1f7f92" stroke-width="3" points="${short.map((v, i) => `${i * 13},${44 - v * 5}`).join(' ')}"/></svg>`,
        income: bar('收', [['🏠 住宅', 1, C.res]]),
        expense: bar('支', [['🛣️', 40, C.road], [UTIL, 60, C.util]], [], 0.45),
        taxes: `<div class="row"><span class="emo" style="width:36px;height:36px;flex:none;border-radius:50%;display:grid;place-items:center;font-size:18px;background:#e6d4a6;border:2px solid #7a5520">🪙</span><div class="segctl"><i class="lo">低</i><i class="mid on">正常</i><i class="hi">高</i></div></div>`,
        button: a.btn('看视频领 ¥600', 'wide', true),
      });
      const rows = c.querySelectorAll('.row');
      a.coAt(1, c.querySelector('svg'), 80, 10);
      a.coAt(2, rows[0], 60, 4);
      a.coAt(3, rows[1], 60, 4);
      a.coAt(4, c.querySelector('.taxlab'), 44, 8);
      a.coAt(5, c.querySelector('.btn'), 10, 6);
    },
  },
  {
    id: 'C1b', title: '钱的小卡：资金为负', from: 'B1 点资金（资金低于零，或已经在破产保护里）',
    query: MAIN,
    notes: ['顶部资金变灰，破产保护时旁边沙漏和现实时间的倒计时', '每小时净收入为负，灰色 ▼', '曲线掉到零以下；橙色虚线是红线（不写数字），资金不能低于它', '低于红线进入破产保护时，虚线旁加一个沙漏', '支出比收入长；调低支出（拆、调预算）和调高税照样能做', '看视频领钱补回来'],
    draw(a) {
      base(a, { hud: { neg: true, trend: 'down' } });
      const down = [14, 12, 11, 9, 8, 6, 4, 3, 1, -1, -3, -4, -6, -8, -9, -11, -12, -14, -15, -16, -17, -18, -19, -20];
      const c = moneyCard(a, {
        head: '<span class="emo">💰</span> 每小时 −¥320 <span style="color:#aab4b8;font-size:13px">▼</span>',
        curve: `<div style="position:relative">${curveSvg(down, { zero: 20, line: 40 })}<span class="emo" style="position:absolute;right:-4px;top:28px;font-size:16px">⏳</span></div>`,
        income: bar('收', [['🏠', 40, C.res], ['🏭', 30, C.ind], ['🏬', 20, C.com], ['⋯', 10, C.other]], [], 0.62),
        expense: bar('支', [['🛣️', 30, C.road], ['🏛️', 38, C.svc], [UTIL, 26, C.util], ['⋯', 6, C.other]]),
        taxes: TAXES,
        button: a.btn('看视频领 ¥3,600', 'wide', true),
      });
      const r = c.getBoundingClientRect();
      const rows = c.querySelectorAll('.row');
      a.coAt(1, document.querySelector('.cap .hg'), 30, 26);
      a.coAt(2, c.querySelector('.head'), 150, 4);
      a.co(3, r.left + 120, r.top + 86);
      a.co(4, r.right - 40, r.top + 82);
      a.coAt(5, rows[1], 50, 4);
      a.coAt(6, c.querySelector('.btn'), 10, 6);
    },
  },
  {
    id: 'C2', title: '钱从哪来：住宅税', from: 'C1 点收入条上的“住宅”一段',
    query: q({ zoom: 0.22, x: 32, y: 32 }),
    notes: ['左上返回：只回到 C1 钱的小卡（这里没有“点外面回地图”）', '小签写看的是哪一项和每小时多少；和视图一样不放资金', '交住宅税的楼按交得多少用金色深浅着色，越深交得越多；地图其余部分变淡。红色只留给征收', '点楼照样冒气泡；点空地不响应', '图例：金色三档'],
    draw(a) {
      a.fade(0.45);
      for (const p of a.parcels.filter((x) => x.zone === 1)) a.svg(a.parcelShape(p, `fill="${gold(((p.id * 37) % 100) / 100)}" stroke="#a8741c" stroke-width="1.2"`));
      const bar2 = drillTop(a, '🏠 住宅税 · 每小时 +¥425');
      const lg = a.add(goldLegend('🏠'));
      const p = a.near(1, 30, 30, (x) => x.level >= 2);
      a.svg(a.parcelShape(p, 'fill="none" stroke="#fff3a8" stroke-width="3"'));
      const b = a.bubble(p.px, p.py, `<div class="t emo">🏠 住宅 ${a.stars(2, 2)}</div><div style="margin-top:4px;font-weight:800" class="emo">👥 52　🪙 +¥4/小时</div>`, { lift: 16 });
      a.coAt(1, bar2.firstElementChild, 0, 40);
      a.coAt(2, bar2.lastElementChild, 160, 0);
      a.co(3, ...a.P(40, 26));
      a.coAt(4, b, b.offsetWidth - 14, 10);
      a.coAt(5, lg, lg.offsetWidth, 0);
    },
  },
  {
    id: 'C2a', title: '钱花在哪：道路维护费', from: 'C1 点支出条上的“道路”一段',
    query: q({ zoom: 0.22, x: 32, y: 32 }),
    notes: ['左上返回 → C1', '小签写这一项每小时花多少，支出用“−”', '贡献这一项的东西（这里是路）用金色深浅着色：高速和四车道花得多，颜色深', '点一段路冒路的气泡；点空地不响应', '公共服务、水电燃气、公交地铁、奖励建筑同样做法：着色的是对应的建筑'],
    draw(a) {
      a.fade(0.45);
      for (const [id, v] of a.city.roads) a.svg(a.cellDiamond(id % a.N, Math.floor(id / a.N), `fill="${gold(v.highway ? 0.95 : 0.25 + (id % 3) * 0.2)}"`));
      const bar2 = drillTop(a, '🛣️ 道路 · 每小时 −¥310');
      const lg = a.add(goldLegend('🛣️'));
      a.coAt(1, bar2.firstElementChild, 0, 40);
      a.coAt(2, bar2.lastElementChild, 160, 0);
      a.co(3, ...a.P(4, 20));
      a.co(4, ...a.P(30, 34));
      a.coAt(5, lg, lg.offsetWidth, 0);
    },
  },
  {
    id: 'C2b', title: '钱从哪来：过路费', from: 'C1 点收入里的“过路费”小按钮',
    query: q({ zoom: 0.046, x: 32, y: 32, extra: '&cars=0' }),
    notes: ['左上返回 → C1', '镜头拉到全城档，看得见四边的接口', '有别人的货穿过的接口和码头亮金色，旁边写每小时收多少；颜色越深收得越多', '水运过路费只在地区内收；河的出入口照样标出来', '点一个接口冒 G5 的气泡（每天多少货、多少过路费）'],
    draw(a) {
      a.fade(0.5);
      const ports = [[64.4, 7.5, '🛣️', 0.9, '+¥18'], [12.5, 64.4, '🛣️', 0.5, '+¥9'], [28, -0.4, '🚆', 0.3, '+¥5'], [-0.4, 53, '⛴️', 0.7, '+¥12'], [64.4, 46.5, '⛴️', 0.45, '+¥6']];
      const pos = ports.map(([x, y, e, k, t]) => {
        const [sx, sy] = a.P(x, y, 0);
        a.svg(`<circle cx="${sx}" cy="${sy}" r="22" fill="${gold(k)}" opacity=".55"/><circle cx="${sx}" cy="${sy}" r="14" fill="#fff" stroke="${gold(k)}" stroke-width="4"/><text x="${sx}" y="${sy + 5}" text-anchor="middle" font-size="14">${e}</text>`);
        return a.add(`<div class="cap" style="position:absolute;left:${Math.min(sx - 20, 320)}px;top:${sy - 52}px;height:24px;padding:0 8px;font-size:13px">${t}</div>`);
      });
      const bar2 = drillTop(a, '🚚 过路费 · 每小时 +¥50');
      const lg = a.add(goldLegend('🚚'));
      a.coAt(1, bar2.firstElementChild, 0, 40);
      a.co(2, 195, 330);
      a.coAt(3, pos[0], -16, 12);
      a.coAt(4, pos[3], pos[3].offsetWidth + 14, 12);
      a.coAt(5, lg, lg.offsetWidth, 0);
    },
  },
  {
    id: 'C3', title: '人口小卡', from: 'B1 点人口',
    query: MAIN,
    notes: ['人口和这一小时的变化', '学历四色条：没上学、小学、中学、大学', '从一星到当前星级上限，每星一行（4 级上限是二星）：上面是有这档学历的人，下面是这档岗位；人多岗位少就该划区，岗位多人少就是缺人才', '失业的人数，用空公文包', '只有右下“看地图 ›”能点 → F4 人口和岗位视图', scrimNote],
    draw(a) {
      base(a);
      const c = a.panel('card', '<span class="emo">👥</span> 8,450 <span style="color:#7ee08a;font-size:13px">+32/小时</span>', `<div class="row"><span class="lab emo">🎓</span>${EDU}</div>
        ${[[1, 92, 70], [2, 60, 66]].map(([s, p, j]) => `<div class="row"><span class="stars" style="width:52px">${'★'.repeat(s)}</span><div style="flex:1;display:grid;gap:6px"><div class="duo emo"><span style="font-size:20px">👥</span><i style="width:${p}%;background:#e07a3f"></i></div><div class="duo emo"><span style="font-size:20px">💼</span><i style="width:${j}%;background:#3b5ba9"></i></div></div></div>`).join('')}
        <div class="row" style="font-weight:900;font-size:16px">${EMPTY_CASE} 120<span style="flex:1"></span>${a.btn('看地图 ›', 'blue small')}</div>`);
      const rows = c.querySelectorAll('.row');
      a.coAt(1, c, c.offsetWidth - 40, 18);
      a.coAt(2, rows[0], 30, 0);
      a.coAt(3, rows[1], 60, 0);
      a.coAt(4, rows[3], 10, 30);
      a.coAt(5, c.querySelector('.btn'), 10, 4);
      a.co(6, 200, c.getBoundingClientRect().bottom + 40);
    },
  },
  {
    id: 'C4', title: '满意度小卡', from: 'B1 点表情',
    query: MAIN,
    notes: ['中间是全城的表情和一个固定的词，五档：很好、好、一般、差、很差；不显示分数', '一圈因素；还没解锁的服务不出现。小签（标注）写点了去哪：服务 F2、水电燃气 F3、垃圾 F2 垃圾分项、通勤 F1、环境 F6、工作 F4 失业、购物 F4 商场、税 C1；奖励建筑不能点', '绿色 ▲ 加分、红色 ▼ 减分，没有箭头是不影响；箭头三档：12、18、24 像素', '通勤用“时钟 + 车”；水电燃气是三样的组合图标', scrimNote],
    draw(a) {
      base(a);
      const f = [['🏛️', 'up', 2, 'F2'], [UTIL, 'up', 1, 'F3'], ['♻️', '', 0, 'F2 垃圾'], ['🚗<i style="position:absolute;left:4px;top:2px;font-size:14px;font-style:normal">⏱️</i>', 'down', 3, 'F1'], ['🌳', 'up', 1, 'F6'], ['💼', '', 0, 'F4 失业'], ['🛒', 'up', 2, 'F4 商场'], ['💰', 'down', 1, 'C1'], ['🏆', 'up', 1, '不能点']];
      const c = a.panel('card', '满意度', `<div style="position:relative;height:290px">${f.map(([e, d, s], i) => { const an = -Math.PI / 2 + (i * 2 * Math.PI) / f.length; return `<div class="emo fac" style="position:absolute;left:${50 + 38 * Math.cos(an)}%;top:${48 + 38 * Math.sin(an)}%;transform:translate(-50%,-50%);width:54px;height:54px;border-radius:50%;display:grid;place-items:center;font-size:24px;background:radial-gradient(circle at 40% 30%,#fffaf0,#e2cc96);border:2px solid #8b6526;box-shadow:0 2px 4px rgba(0,0,0,.3)">${e}${d ? `<i style="position:absolute;right:-8px;bottom:-6px;font-style:normal;font-weight:900;font-size:${6 + s * 6}px;line-height:1;color:${d === 'up' ? '#2f8f3a' : '#d2473a'};text-shadow:0 1px 0 #fff">${d === 'up' ? '▲' : '▼'}</i>` : ''}</div>`; }).join('')}<div class="emo" style="position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);font-size:64px">🙂</div><div style="position:absolute;left:50%;top:60%;transform:translateX(-50%);font-weight:900;font-size:18px;color:#2f8f3a">好</div></div>`);
      const facs = c.querySelectorAll('.fac');
      facs.forEach((el, i) => { const r = el.getBoundingClientRect(); a.tag(f[i][3], r.left + r.width / 2, r.bottom + 2); });
      const r = c.getBoundingClientRect();
      a.co(1, r.left + r.width / 2 + 46, r.top + 150);
      a.coAt(2, facs[0], -10, 10);
      a.coAt(3, facs[3], -14, 40);
      a.coAt(4, facs[3], 66, 12);
      a.co(5, 200, r.bottom + 40);
    },
  },
  {
    id: 'C5', title: '等级小卡（满级）', from: 'B1 点城市徽章（经验没满时）；图里是 10 级满级的样子',
    query: MAIN,
    notes: ['满级时经验条金色满格；经验照样累计，记第一次够上每一级的时刻', '没满级时这一行是“下一级要解锁的东西”，灰色图标；满级时是这一级已经解锁的', '点一个图标冒小签写名字，小签上一个“?”进帮助页（J4）', '满级多一个“开新城” → K2 结束确认（要先结束这座城）', '经验满了（没满级）徽章发光，再点徽章是 B3；没网时徽章旁一个断线图标，不能升级', scrimNote],
    draw(a) {
      base(a, { hud: { level: 10, xp: 1 } });
      const c = a.panel('card', '等级 Lv10 · 已满级', `<div class="row"><b>Lv10</b><div class="xp max"><i style="width:100%"></i></div><b class="emo">👑</b></div><div style="text-align:center;font-size:12px;color:#7a5a30;margin:-2px 0 10px">经验 1,286,400</div><div class="tiles emo" style="justify-content:center">${['🚢', '🗼', '🏢', '🏖️'].map((e) => `<div class="tile got">${e}</div>`).join('')}</div><div style="margin-top:44px">${a.btn('开新城', 'blue wide')}</div>`);
      const tiles = c.querySelectorAll('.tile');
      const t = tiles[0].getBoundingClientRect();
      const tip = a.add(`<div class="tip" style="left:${t.left - 4}px;top:${t.bottom + 6}px">国际港 <i class="help">?</i></div>`);
      a.coAt(1, c.querySelector('.xp'), 120, 0);
      a.coAt(2, tiles[3], 40, 0);
      a.coAt(3, tip, tip.offsetWidth, 4);
      a.coAt(4, c.querySelector('.btn'), 10, 6);
      a.coAt(5, document.querySelector('.emblem'), 60, 60);
      a.co(6, 200, c.getBoundingClientRect().bottom + 40);
    },
  },
];
