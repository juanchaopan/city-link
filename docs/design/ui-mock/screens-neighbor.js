// 邻居和边界接口：G1 至 G6。边界外一律是邻居的灰色画面；线头的期限是金色光环加天数的小签。
import { q, NB, base, ddl, states } from './screens-common.js';
import { modeTop, coBack, confirm, price, deadline, navyTag, grey, nbName, port, goldNet, brokenAt, OFFLINE } from './parts-b.js';

const ring = (col, { dash = false, glow = false } = {}) => `<svg width="34" height="34" viewBox="0 0 34 34" style="flex:none">${glow ? '<circle cx="17" cy="17" r="15" fill="none" stroke="#f2b62f" stroke-width="3" opacity=".6"/>' : ''}<circle cx="17" cy="17" r="10" fill="#fff" stroke="${col}" stroke-width="3" ${dash ? 'stroke-dasharray="4 3"' : ''}/></svg>`;
const OLDSTUB = '<span class="emo" style="display:inline-grid;place-items:center;width:22px;height:22px;border-radius:6px;background:#d9d4c8;border:1.5px solid #8a8a8a;font-size:12px;filter:grayscale(1)">🛤️</span>';
const pill = (html) => `<span class="cap emo" style="padding:0 10px;height:26px;font-size:13px">${html}</span>`;
const portTitle = (k, line) => `<div class="t emo">${NB[k].av} ${NB[k].name} · ${line}</div>`;
/** 北边云港市修到边界的铁路线头：G2、G2b、G2c、G2d、G3 都对着它。 */
const NORTH_RAIL = { lines: [{ kind: 'rail', pts: [[30, 0], [30, -60]] }] };
const NORTH = (zoom) => q({ zoom, x: 32, y: 3 });
/** 东边北岭的灰色画面：G4 和 G4b 用。 */
const EAST_TOWN = { lines: [{ kind: 'highway', pts: [[64, 7.5], [124, 7.5]] }, { kind: 'highway', pts: [[76, 7.5], [76, 60]] }, { kind: 'river', pts: [[64, 51.5], [124, 56]] }, { kind: 'rail', pts: [[64, 44], [96, 44], [96, 70]] }] };
const eastAvatar = (a, glow = false) => a.label(80, 26, `<span class="cap emo" style="padding:0 14px 0 40px;height:36px;font-size:16px;${glow ? 'box-shadow:0 0 0 3px #ffd76a' : ''}"><span class="ic" style="width:42px;height:42px;font-size:24px">${NB.e.av}</span>${NB.e.name} · Lv6</span>`);
/** 四边的邻居：东北岭、南江屿市（另一个地区）、北云港市、西桃溪（刚建的城市，保护期）。 */
function fourSides(a) {
  grey(a, 'e', { lines: [{ kind: 'highway', pts: [[64, 7.5], [124, 7.5]] }, { kind: 'river', pts: [[64, 51.5], [124, 54]] }, { kind: 'rail', pts: [[64, 44], [100, 44]] }] });
  grey(a, 'w', { lines: [{ kind: 'river', pts: [[-60, 50], [0, 53]] }] });
  grey(a, 'n', { lines: [{ kind: 'rail', pts: [[28, 0], [28, -60]] }, { kind: 'highway', pts: [[46, 0], [46, -60]] }] });
  grey(a, 's', { lines: [{ kind: 'highway', pts: [[12.5, 64], [12.5, 124]] }, { kind: 'rail', pts: [[50, 64], [50, 124]] }] });
}
const boat = (a, x, y) => a.label(x, y, '<span class="emo" style="display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.9);border:2px solid #2f86c4;font-size:15px">⛵</span>');
const STATES_AT = 'left:8px;top:160px';

export const NEIGHBOR = [
  {
    id: 'G1', title: '邻居和边界接口', from: 'B1 缩小到全城档（或点右下角 🎯）',
    query: q({ zoom: 0.07, x: 33, y: 35, extra: '&cars=0' }),
    notes: ['每条边中点的外侧写着邻居的头像和名字；边界外是邻居的灰色画面', '两边都接好的接口：实线绿圈，车或火车一直在过；每个接口的点击区有 44 px', '对着你的线头：金色光环一圈圈往外扩，旁边“剩 N 天”的金色小签 → 点它 G2', '期限还没开始：金环不扩，小签写“排队中”“保护期后”或“Lv7 后”（G2a）', '你已开工接：金环停住，旁边一个进度环（G2b）', '你修出去、等对方接：灰色虚线圈加“⋯” → G6', '刚建的城市：名字旁一个嫩芽和保护期剩几天，期间谁都不能往那边修', '跨地区的口岸：圈外一个地区的小标记。河流进出城市的地方只画小船，河跨地区也没有口岸标记', '框里是另外几种样子：对着空白、空白但有旧线头、最后一天、两边都没接好'],
    draw(a) {
      fourSides(a);
      base(a);
      const ne = nbName(a, 'e', 'e');
      nbName(a, 's', 's');
      nbName(a, 'n', 'n');
      const nw = nbName(a, 'w', 'w', { extra: ' <span style="font-size:12px;color:#b9f5a0">🌱 2 天</span>' });
      const ok = port(a, 64, 7.5, '🛤️', 'ok', { hit: true, r: 13 });
      const so = port(a, 12.5, 64, '🛤️', 'ok', { r: 13 });
      const reg = navyTag(a, so[0], so[1] + 26, '🏳️ 云川地区', { anchor: 'center' });
      const th = port(a, 28, -0.5, '🚆', 'theirs', { r: 13 });
      const d1 = deadline(a, th[0] - 36, th[1], '剩 5 天', { anchor: 'right' });
      const wt = port(a, 46, -0.5, '🛤️', 'wait', { r: 13 });
      const d2 = navyTag(a, wt[0] + 26, wt[1], '排队中');
      const fz = port(a, 50, 64.5, '🚆', 'frozen', { r: 13, progress: 0.4 });
      const mn = port(a, 64.5, 44, '🚆', 'mine', { r: 13 });
      const dots = navyTag(a, mn[0] + 22, mn[1], '⋯');
      boat(a, -0.6, 53);
      boat(a, 64.6, 52);
      const box = states(a, '另外几种', [
        ['对着空白', ring('#8a9a9f', { dash: true })],
        ['旧线头', `${ring('#8a9a9f', { dash: true })}${OLDSTUB}`],
        ['最后一天', `${ring('#f2b62f', { glow: true })}${ddl('剩 9 时', true)}`],
        ['都没接好', `${ring('#f2b62f', { glow: true })}<span style="color:#ffd76a">｜</span>${ring('#f2b62f', { glow: true })}`],
      ], 'left:8px;bottom:140px;width:186px');
      a.coAt(1, ne, ne.offsetWidth + 6, 0);
      a.co(2, ok[0] + 26, ok[1] - 20);
      a.coAt(3, d1, -14, 14);
      a.coAt(4, d2, d2.offsetWidth + 12, 14);
      a.co(5, fz[0] + 30, fz[1] - 4);
      a.coAt(6, dots, dots.offsetWidth + 12, 14);
      a.coAt(7, nw, nw.offsetWidth + 6, 0);
      a.coAt(8, reg, reg.offsetWidth + 12, 14);
      a.coAt(9, box, box.offsetWidth - 8, 0);
    },
  },
  {
    id: 'G2', title: '对着你的线头', from: 'G1 点金色光环；站内信 H1 点“去看看”；或第 1、3、6 天的微信服务通知',
    query: q({ zoom: 0.22, x: 34, y: 6 }),
    notes: ['气泡：邻居、线路类型、剩几天。期限是金色，最后一天写小时、变橙；7 天到了还没接好，这座城市结束。期限到之前开工就算赶上', '你城里人口最多的那片路网描一圈淡金光：接到这片才算接好', '“去接上”按对面是什么拿起工具：铁路线头拿起货运站（G3），高速线头拿起两车道（D4b）；没有同意和拒绝按钮，钱不够看视频补', '对面是匝道或货运站时要用高速公路或铁路接：等级不够写“Lv7 后”，按钮灰', '边界外是邻居的灰色画面', '要断开只能拆（D10），对方也拆了接口才消失'],
    draw(a) {
      goldNet(a);
      grey(a, 'n', NORTH_RAIL);
      base(a);
      port(a, 30, -0.3, '🚆', 'theirs');
      const b = a.bubble(30, -0.3, `${portTitle('n', '🚆 铁路')}<div style="margin-top:6px">${ddl('剩 5 天')}</div><div class="bb">${a.btn('🚉 去接上', 'green')}</div>`, { below: true });
      const box = states(a, '另外两种', [['最后一天', ddl('剩 9 时', true)], ['等级不够', a.btn('Lv7 后', 'gray')]], 'left:8px;bottom:150px;width:200px');
      const nm = nbName(a, 'n', 'n', { at: [24, -5] });
      a.coAt(1, b.querySelector('.ddl'), b.querySelector('.ddl').offsetWidth + 12, 10);
      a.co(2, ...a.P(26, 17.5));
      a.coAt(3, b.querySelector('.btn'), b.querySelector('.btn').offsetWidth + 12, 18);
      a.coAt(4, box, box.offsetWidth - 8, 0);
      a.coAt(5, nm, -14, 15);
      a.co(6, 300, 660);
    },
  },
  {
    id: 'G2a', title: '对着你的线头：期限还没开始', from: 'G1 点不扩的金色光环',
    query: q({ zoom: 0.26, x: 60, y: 23 }),
    notes: ['期限还没开始时金环不往外扩，小签写原因', '这个例子是排队中：一座城一次只走一个期限，云港市的铁路线头正在走（剩 5 天），北岭的这一个排在后面；前一个接好才开始，到时也是完整的 7 天', '另外两种原因：你的城市还在保护期（保护期后），或接它要用的东西你还造不了（Lv7 后）', '排队中也可以先去接'],
    draw(a) {
      goldNet(a);
      grey(a, 'e', { lines: [{ kind: 'highway', pts: [[64, 24.5], [124, 24.5]] }, { kind: 'highway', pts: [[64, 7.5], [124, 7.5]] }] });
      base(a);
      const pt = port(a, 64.4, 24.5, '🛤️', 'wait');
      const b = a.bubble(64.4, 24.5, `${portTitle('e', '🛤️ 高速')}<div style="margin-top:6px">${pill('排队中')}</div><div class="bb">${a.btn('🛣️ 去接上', 'green')}</div>`, { below: true });
      const box = states(a, '另外两种原因', [['保护期', pill('🌱 保护期后')], ['等级', pill('Lv7 后')]], `${STATES_AT};width:210px`);
      nbName(a, 'e', 'e', { at: [69, 18] });
      a.co(1, pt[0] - 26, pt[1] - 22);
      a.coAt(2, b.querySelector('.cap'), b.querySelector('.cap').offsetWidth + 12, 12);
      a.coAt(3, box, box.offsetWidth - 8, 0);
      a.coAt(4, b.querySelector('.btn'), b.querySelector('.btn').offsetWidth + 12, 18);
    },
  },
  {
    id: 'G2b', title: '对着你的线头：已经开工，期限冻结', from: 'G2 点“去接上”并确认以后；再点光环',
    query: NORTH(0.36),
    notes: ['开工确认时服务端核过方案：完工后会接好，才记下开工', '金环停住，旁边一个进度环；期限冻结，不再倒数', '气泡写开工进度和剩余工期；冻结最多到“开工 + 工期 + 1 小时”', '中途取消工程（点线头旁的工地，D8），恢复原来的期限；完工后光环变成绿圈，镜头上闪一下'],
    draw(a) {
      grey(a, 'n', NORTH_RAIL);
      a.svg(a.poly([[29.5, 0.2], [31.5, 0.2], [31.5, 1.2], [29.5, 1.2]], 'fill="url(#hatch)" fill-opacity=".85" stroke="#7a5a10" stroke-width="2"'));
      base(a);
      const pt = port(a, 30, -0.4, '🚆', 'frozen', { progress: 0.45 });
      const b = a.bubble(30, -0.4, `${portTitle('n', '🚆 铁路')}<div class="emo" style="margin-top:6px;font-weight:800;font-size:13px">🏗️ 货运站 · 期限冻结</div><div class="meter"><i style="width:45%;background:linear-gradient(#8de07c,#2f8f3a)"></i></div><div style="margin-top:4px;font-weight:800;font-size:14px" class="emo">⏱ 0:42</div>`, { below: true });
      a.coAt(1, b, b.offsetWidth + 12, 20);
      a.co(2, pt[0] + 30, pt[1] - 22);
      a.coAt(3, b.querySelector('.meter'), b.querySelector('.meter').offsetWidth + 12, 4);
      a.co(4, 60, 600);
    },
  },
  {
    id: 'G2c', title: '对着你的线头：没网', from: 'G1 点金色光环（手机没网）',
    query: NORTH(0.3),
    notes: ['没网时城市名旁一个断网图标，要联网的按钮都置灰', '期限照常显示', '“去接上”置灰，带断网图标：修线头和接线头都要联网', '恢复联网后自动同步，不弹窗'],
    draw(a) {
      grey(a, 'n', NORTH_RAIL);
      base(a, { hud: { offline: true }, dock: { offline: true } });
      port(a, 30, -0.3, '🚆', 'theirs');
      const b = a.bubble(30, -0.3, `${portTitle('n', '🚆 铁路')}<div style="margin-top:6px">${ddl('剩 5 天')}</div><div class="bb"><span class="btn gray">🚉 去接上 ${OFFLINE}</span></div>`, { below: true });
      const np = document.querySelector('.nameplate');
      if (np) a.coAt(1, np, np.offsetWidth + 4, 12);
      a.coAt(2, b.querySelector('.ddl'), b.querySelector('.ddl').offsetWidth + 12, 10);
      a.coAt(3, b.querySelector('.btn'), b.querySelector('.btn').offsetWidth + 12, 18);
      a.co(4, 60, 640);
    },
  },
  {
    id: 'G2d', title: '去接上：方案接了也不算接好', from: 'G2 点“去接上”，货运站放得离主路网太远',
    query: NORTH(0.4),
    notes: ['货运站放在线头旁边，但它连不到你城里人口最多的那片路网：虚影上一个断链图标', '人口最多的那片路网描淡金光，往这片接才算接好', '✓ 仍然可以点，钱是你自己的；接好要把这一站和金光那片用路连起来', '边界外是邻居的灰色画面；左上返回回 G2'],
    draw(a) {
      goldNet(a, (x, y) => y >= 12);
      grey(a, 'n', NORTH_RAIL);
      for (const [x, y] of [[29, 0], [30, 0], [31, 0], [29, 1], [30, 1], [31, 1]]) a.svg(a.cellDiamond(x, y, 'fill="rgba(255,214,90,.5)" stroke="#fff3a8" stroke-width="2"'));
      a.svg(a.poly([[29.5, 0.2], [31.5, 0.2], [31.5, 1.2], [29.5, 1.2]], 'fill="rgba(255,255,255,.9)" stroke="#2a8fa8" stroke-width="3"'));
      a.label(30.5, 0.7, '<span class="emo" style="font-size:22px">🚉</span>');
      port(a, 30, -0.4, '🚆', 'theirs', { r: 13 });
      const lk = brokenAt(a, 32.6, 1.4);
      const top = modeTop(a, { icon: '🚉', name: '货运站' });
      price(a, 31, 1.2, '<span class="g">¥1,800</span> · 每天 −¥40', { dy: 80, below: true });
      const cf = confirm(a);
      a.coAt(1, lk, 38, 0);
      a.co(2, ...a.P(26, 12.5));
      a.coAt(3, cf, cf.offsetWidth - 20, -14);
      coBack(a, 4, top);
    },
  },
  {
    id: 'G3', title: '去接上：放货运站', from: 'G2 点“去接上”（对着你的是铁路线头）',
    query: NORTH(0.42),
    notes: ['直接进入建造模式，工具已经是货运站；左上返回回 G2', '只有线头旁边能接的格子发亮；修线头的一方修到边界时，服务端已经检查过这几格在你这边能造', '虚影落在楼上就走征收，哪怕要拆房子也得接', '价格气泡和确认；钱不够时看视频补（B4）。接好以后光环停下，线头变成绿圈，火车开始过', '边界外是邻居城市的灰色画面'],
    draw(a) {
      grey(a, 'n', NORTH_RAIL);
      for (const [x, y] of [[29, 0], [30, 0], [31, 0], [29, 1], [30, 1], [31, 1]]) a.svg(a.cellDiamond(x, y, 'fill="rgba(255,214,90,.55)" stroke="#fff3a8" stroke-width="2"'));
      a.svg(a.poly([[29.5, 0.2], [31.5, 0.2], [31.5, 1.2], [29.5, 1.2]], 'fill="rgba(255,255,255,.9)" stroke="#2a8fa8" stroke-width="3"'));
      a.label(30.5, 0.7, '<span class="emo" style="font-size:24px">🚉</span>');
      port(a, 30, -0.4, '🚆', 'theirs', { r: 13 });
      const top = modeTop(a, { icon: '🚉', name: '货运站' });
      const pr = price(a, 31, 2.2, '<span class="g">¥1,800</span> · 每天 −¥40<br><span class="emo">🏠×1　👥38</span>', { dy: 70, below: true });
      confirm(a);
      const nm = nbName(a, 'n', 'n', { at: [24, -5] });
      coBack(a, 1, top);
      a.co(2, ...a.P(28.6, 1.8));
      a.co(3, ...a.P(31.8, 0.2));
      a.coAt(4, pr, -14, 10);
      a.coAt(5, nm, nm.offsetWidth + 6, 0);
    },
  },
  {
    id: 'G4', title: '看邻居（灰色画面）', from: '把地图拖过边界',
    query: q({ zoom: 0.11, x: 70, y: 24, extra: '&cars=0' }),
    notes: ['边界外是邻居城市的灰色画面：只有地形、河、铁路、高速公路，是对方最近一次同步的样子', '邻居的头像和名字浮在中间；点头像冒气泡（G4b）：加好友、已申请，是好友时多一个“实地参观”（I3）', '高速公路从边界穿过去，两边各管各的', '最多拖到露出邻居一半（金色虚线），再往外回弹'],
    draw(a) {
      grey(a, 'e', EAST_TOWN);
      const av = eastAvatar(a);
      base(a);
      const [hx, hy] = a.P(96, 24);
      a.svg(`<line x1="${hx}" y1="${hy - 60}" x2="${hx}" y2="${hy + 60}" stroke="#ffd76a" stroke-width="3" stroke-dasharray="8 6" opacity=".9"/>`);
      a.co(1, ...a.P(86, 40));
      a.coAt(2, av, av.offsetWidth + 6, 0);
      a.co(3, ...a.P(66, 7.5));
      a.co(4, hx + 16, hy - 40);
    },
  },
  {
    id: 'G4b', title: '看邻居：点头像', from: 'G4 点邻居的头像；或参观模式顶部条右边的头像',
    query: q({ zoom: 0.11, x: 70, y: 24, extra: '&cars=0' }),
    notes: ['头像、名字、等级', '不是好友：“加好友”（青色）；点了变成灰色的“已申请”', '已经是好友：多一个“实地参观”（绿色）→ I3 参观模式，彩色画面', '参观模式顶部条右边的头像，点了也是这个气泡'],
    draw(a) {
      grey(a, 'e', EAST_TOWN);
      eastAvatar(a, true);
      base(a);
      const b = a.bubble(80, 26, `<div class="t emo"><span style="font-size:22px">${NB.e.av}</span> ${NB.e.name} · Lv6</div><div class="bb">${a.btn('加好友', 'blue')}</div>`, { lift: 26 });
      const box = states(a, '另外两种', [['已申请', a.btn('已申请', 'gray')], ['是好友', a.btn('实地参观', 'green')]], 'left:8px;bottom:150px;width:210px');
      a.coAt(1, b, b.offsetWidth + 12, 16);
      a.coAt(2, b.querySelector('.btn'), b.querySelector('.btn').offsetWidth + 12, 18);
      a.coAt(3, box, box.offsetWidth - 8, 0);
      a.co(4, 300, 540);
    },
  },
  {
    id: 'G5', title: '点两边都接好的接口', from: 'G1 点实线绿圈',
    query: q({ zoom: 0.36, x: 58, y: 12 }),
    notes: ['邻居、线路类型；绿圈是两边都接好了', '每天经过这里的货', '每天收的过路费（别人的货穿城而过时才有，过路费只是零头）', '没有按钮；要断开只能拆（D10）'],
    draw(a) {
      grey(a, 'e', { lines: [{ kind: 'highway', pts: [[64, 7.5], [124, 7.5]] }] });
      base(a);
      port(a, 64, 7.5, '🛤️', 'ok');
      const b = a.bubble(64, 7.5, `${portTitle('e', '🛤️ 高速 <span style="color:#2f8f3a">●</span>')}<div style="margin-top:6px;font-weight:800;font-size:14px" class="emo">📦 每天 340</div><div style="margin-top:6px"><span class="cap emo" style="padding:0 10px 0 6px;height:28px;font-size:13px"><span style="display:inline-grid;place-items:center;height:20px;padding:0 6px;border-radius:6px;background:#ffd76a;color:#4a2c00;font-size:11px;font-weight:900">过路</span>+¥180/天</span></div>`, { below: true });
      a.coAt(1, b, b.offsetWidth + 12, 16);
      a.coAt(2, b, b.offsetWidth + 12, 50);
      a.coAt(3, b, b.offsetWidth + 12, 84);
      a.co(4, 60, 640);
    },
  },
  {
    id: 'G6', title: '点你修出去的“⋯”接口', from: 'G1 点灰色虚线圈',
    query: q({ zoom: 0.36, x: 58, y: 40 }),
    notes: ['邻居头像、线路类型', '对方那边的状态小签：剩几天、保护期后、排队中、开工进度；这里是“剩 4 天”', '对着空白的接口：气泡写“空白位置，有人入住后算请求”', '空白位置上还有旧线头时，多画一个旧线头的小图标', '你这边没有按钮；不想要了就拆（D10）'],
    draw(a) {
      grey(a, 'e', { lines: [{ kind: 'rail', pts: [[64, 44], [124, 44]] }, { kind: 'river', pts: [[64, 51.5], [124, 54]] }] });
      base(a);
      const pt = port(a, 64.5, 44, '🚆', 'mine');
      navyTag(a, pt[0] + 22, pt[1], '⋯');
      const b = a.bubble(64.5, 44, `${portTitle('e', '🚆 铁路 ⋯')}<div style="margin-top:6px;display:flex;align-items:center;gap:6px;font-size:13px;font-weight:800;color:#7a5a30">对方 ${ddl('剩 4 天')}</div>`, { lift: 24 });
      const box = states(a, '对着空白', [['空白', `${ring('#8a9a9f', { dash: true })}<span style="font-size:12px">空白位置，有人入住后算请求</span>`], ['旧线头', `${ring('#8a9a9f', { dash: true })}${OLDSTUB}`]], 'left:8px;bottom:150px;width:300px');
      const rows = box.querySelectorAll('.st');
      a.coAt(1, b, b.offsetWidth + 12, 14);
      a.coAt(2, b.querySelector('.ddl'), b.querySelector('.ddl').offsetWidth + 12, 10);
      a.coAt(3, rows[0], rows[0].offsetWidth + 6, 14);
      a.coAt(4, rows[1], 150, 14);
      a.co(5, 330, 560);
    },
  },
];
