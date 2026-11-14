// 开局、主界面和偶尔出现的时刻：A1 至 A3、B1 至 B6、K1。
import { ICON } from './api.js';
import { q, MAIN, BARE, ME, NB, base, site, ddl, states, earlyCity, isoRoad, regionMini, scrimNote } from './screens-common.js';
import { cityMoneyCard } from './screens-hud.js';
import { modeTop } from './parts-b.js';

const steps = (n, done = n - 1) => `<div class="steps">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= done ? 'ok' : i === n ? 'on' : ''}"></i>`).join('')}</div>`;
const coach = (a, top, n, text) => a.add(`<div class="coach" style="top:${top}px"><span class="who emo">👷</span><span class="grow">第 ${n} 步 / 5　${text}${steps(n)}</span></div>`);
/** 刚建好的 1 级城（还在保护期）的顶部数据。 */
const L1 = { level: 1, money: '5,000', pop: '0', xp: 0.04, mail: 0, sprout: '剩 3 天', face: '😐', word: '一般' };
const EARLY = BARE({ zoom: 0.32, x: 30, y: 42 });
const PREVIEW = BARE({ zoom: 0.046, x: 32, y: 32 });

/** 开局预览上的地形补充：湖和森林。这块位置在内陆，没有海岸。 */
function terrainExtras(a) {
  a.svg(a.ring(12, 16, 5, 'fill="#5aa7d0" stroke="#e6f4fa" stroke-width="2"'));
  for (let i = 0; i < 40; i += 1) {
    const x = 40 + ((i * 7) % 17) + (i % 3) * 0.5;
    const y = 6 + ((i * 5) % 13);
    const [sx, sy] = a.P(x, y);
    a.svg(`<polygon points="${sx},${sy - 10} ${sx + 4.5},${sy} ${sx - 4.5},${sy}" fill="#3f7f45" stroke="#2c5e33" stroke-width=".8"/>`);
  }
}

/**
 * 边界上留下的旧线头：金色光环不扩散，小签写“保护期后要接”。
 * 画在东边北岭（8 级，修得了高速）那一侧，位置和 G1 东边的高速接口一样。
 */
function oldStub(a) {
  const [sx, sy] = a.P(64.4, 7.5, 0);
  a.svg(`<circle cx="${sx}" cy="${sy}" r="15" fill="none" stroke="#f2b62f" stroke-width="3" opacity=".6"/><circle cx="${sx}" cy="${sy}" r="9" fill="#fff3d1" stroke="#f2b62f" stroke-width="3"/><text x="${sx}" y="${sy + 4}" text-anchor="middle" font-size="10">🛤️</text>`);
  return a.add(`<div style="position:absolute;right:${a.W - sx + 20}px;top:${sy - 11}px">${ddl(`🛤️ ${NB.e.av} 高速旧线头 · 保护期后要接`)}</div>`);
}

/** 预览的顶部：标题、位置标签，胶囊下方的地区小缩略图用金框标出 me 这一格。 */
function previewTop(a, back, me) {
  a.add(`<div class="modebar">${back ? '<div class="back">‹</div>' : ''}<div class="title" style="flex:1;justify-content:center">选一块地方</div></div>`);
  const tags = a.add(`<div style="position:absolute;left:10px;top:104px;display:grid;gap:8px;justify-items:start">${['🏞️ 内陆', `${ME.climate}`, '⛰️ 有山 · 🌲 有森林', '🛶 能通航的河'].map((t) => `<span class="cap emo" style="padding:0 10px;height:30px;font-size:14px">${t}</span>`).join('')}</div>`);
  const mini = regionMini(a, me);
  return { tags, mini };
}

/** 升级仪式里图标飞走的虚线：画在光芒背景上面。 */
const flyPaths = (a, paths) => a.add(`<svg style="position:absolute;inset:0" width="390" height="844">${paths.map((d) => `<path d="${d}" fill="none" stroke="#fff3b0" stroke-width="4" stroke-dasharray="2 9" stroke-linecap="round"/>`).join('')}</svg>`);

/** mail 是奖励飞进信封以后的红点数。 */
function ceremony(a, level, items, mail) {
  a.add('<div class="rays"></div>');
  a.hud({ level: level - 1, full: true, xp: 1, mail });
  document.querySelector('.res').remove();
  document.querySelector('.nameplate').remove();
  document.querySelectorAll('.topright .sq')[1].remove();
  const lv = a.add(`<div class="lvbig"><div class="rib">城市升级</div><div class="num">${level}</div></div>`);
  const unl = a.add(`<div class="unl">${items.map(([e, n]) => `<div><span class="emo">${e}</span>${n}</div>`).join('')}</div>`);
  const tip = a.add('<div style="position:absolute;left:0;right:0;bottom:70px;text-align:center;font-weight:900;color:#5a3a00;font-size:15px">点任意处继续</div>');
  return { lv, unl, tip, tiles: unl.querySelectorAll('span.emo'), em: document.querySelector('.emblem').getBoundingClientRect() };
}

const moment = (a, body) => {
  base(a);
  a.add('<div class="dim"></div>');
  return a.panel('moment', '欢迎回来', body);
};
const AWAY_LONG = '<div class="mtx emo">离开了 9 时 30 分　<span class="chipcity">🧊 只补算 8 小时</span></div>';
const TOLL_PAID = '<div class="mtx emo" style="margin-top:8px">🚚 过路费 +¥420 已到账</div>';
/** 翻倍的章：好事用金色底、深棕字，和看视频按钮同一组金色。 */
const DOUBLE_STAMP = '<span style="position:absolute;right:-58px;top:2px;transform:rotate(14deg);font-size:20px;color:#4a2c00;background:linear-gradient(#ffe48a,#f2b62f 60%,#d18c12);border:2px solid #8a5a0c;border-radius:10px;padding:0 8px;text-shadow:none;box-shadow:0 2px 0 #6b4308">×2</span>';

/** 站内信的一行，和 H1 的排法一样：图标、标题，第二行是金额或说明和按钮。 */
const mailRow = ([e, l1, l2, act, cls = '']) => `<div class="mail ${cls}"><span class="e emo">${e}</span><span class="l1 emo">${l1}</span><span class="l2">${l2}<span class="grow"></span>${act}</span></div>`;

export const START = [
  {
    id: 'A1', title: '开局：位置预览', from: '第一次进游戏（隐私指引 L2 之后）；K1 点“开新城”。被邀请进来的朋友跳过这一步，直接到 A2',
    query: PREVIEW,
    notes: ['位置类型和气候；保证有一条能通航的河从这块地上穿过', '整块地不裁切：山、河、湖、森林（沿海的位置还有海岸），还没有任何建筑', '胶囊下方靠右：本地区 4×4 的小缩略图，金框是这块位置，小方块是已经有人的位置', '位置上原来留下的线头画在边界上，写明是哪种线（图里是北岭的高速），标“保护期后要接”', '这块位置给你留 30 分钟', '看视频换一个：只在顺序最前面的约 4 个空位里换（新玩家按地形加权）；换过以后和广告不可用见 A1b', '就这里（绿色） → A2 取名。第一次进游戏没有返回；从 K1 开新城进来时左上有返回，回 K1'],
    draw(a) {
      terrainExtras(a);
      const { tags, mini } = previewTop(a, false, [1, 1]);
      const stub = oldStub(a);
      const keep = a.add('<div style="position:absolute;left:0;right:0;bottom:112px;text-align:center"><span class="cap emo" style="display:inline-flex;padding:0 12px;height:30px;font-size:14px">⏱ 这块位置给你留 29:12</span></div>');
      const btns = a.add(`<div style="position:absolute;left:16px;right:16px;bottom:calc(var(--sab) + 12px);display:flex;gap:10px">${a.btn('换一个', 'wide', true)}${a.btn('就这里', 'green wide')}</div>`);
      a.coAt(1, tags, 4, 4);
      a.co(2, ...a.P(12, 22));
      a.coAt(3, mini, 4, 70);
      a.coAt(4, stub, -6, 10);
      a.coAt(5, keep.firstElementChild, 0, 4);
      a.coAt(6, btns.firstElementChild, 10, 4);
      a.coAt(7, btns.lastElementChild, 10, 4);
    },
  },
  {
    id: 'A1b', title: '开局：换过位置以后', from: 'A1 看过视频换了位置；或进来时原来的位置已被别人占了；或从 K1 开新城进来',
    query: PREVIEW,
    notes: ['从 K1 开新城进来：左上有返回，回 K1', '进来时原来的位置被别人占了：自动换成下一个空位，顶部写一句话；小缩略图的金框跟着换到新位置，原来的位置变成别人的城', '最近看过的位置（最多 3 个），角上写还留几分钟；点一个免费切回', '广告不可用：按钮写“换一个 · 今天还剩 N 次”，不带 ▶；用完变灰（图里是用完的样子）', '就这里 → A2；开新城时 A2 的输入框先填好上一座城市的名字'],
    draw(a) {
      terrainExtras(a);
      const { mini } = previewTop(a, true, [2, 2]);
      const top = a.add('<div class="toast emo" style="top:calc(var(--sat) + 54px);left:10px;right:128px;transform:none;white-space:normal;background:rgba(122,74,0,.92)">原来的位置被占了，换成了下一个空位</div>');
      const thumbs = ['linear-gradient(160deg,#a7cf8f 0 45%,#4f9cc9 45% 55%,#b3d48b 55%)', 'linear-gradient(120deg,#9cc27c 0 30%,#bfdc98 30% 62%,#3d8fc4 62% 68%,#b3d48b 68%)', 'linear-gradient(200deg,#b3d48b 0 40%,#3d8fc4 40% 47%,#8cbf78 47%)'];
      const recent = a.add(`<div style="position:absolute;left:12px;right:12px;bottom:110px;display:flex;gap:8px">${['正在看', '剩 24 分', '剩 11 分'].map((t, i) => `<div class="citycard ${i === 0 ? 'cur' : ''}" style="flex:1;padding:4px"><div class="thumb" style="height:62px;background:${thumbs[i]}"></div><small class="emo" style="position:absolute;right:6px;top:6px;background:#13303d;color:#ffeab0;border-radius:8px;padding:0 6px">${i ? `⏱ ${t}` : t}</small></div>`).join('')}</div>`);
      const btns = a.add(`<div style="position:absolute;left:16px;right:16px;bottom:calc(var(--sab) + 12px);display:flex;gap:10px">${a.btn('换一个 <span class="cnt">今天还剩 0 次</span>', 'gray wide')}${a.btn('就这里', 'green wide')}</div>`);
      a.coAt(1, document.querySelector('.back'), 0, 40);
      a.coAt(2, top, top.offsetWidth - 14, 0);
      a.coAt(2, mini, 4, 70);
      a.coAt(3, recent.children[1], 10, 10);
      a.coAt(4, btns.firstElementChild, 10, 4);
      a.coAt(5, btns.lastElementChild, 10, 4);
    },
  },
  {
    id: 'A2', title: '开局：给城市取名', from: 'A1 点“就这里”；被邀请进来的朋友直接到这里（S3）', map: false,
    notes: ['左上返回 → A1', '最多 12 个字，表情按一个字算；只过内容安全检查', '骰子：随机起一个名字', '键盘弹起时卡片上移，输入框和按钮都在键盘上面', '开始建设 → A3 新手引导；虚线框里是其他样子：没通过描红加一行小字、空名不能点、等待转圈、开新城时先填好上一座的名字；被邀请进来时顶部一行“你在〈邀请人〉旁边”'],
    draw(a) {
      a.add('<div class="screen"><div class="top"><div class="back">‹</div><div class="title">给城市取名</div></div></div>');
      const box = a.panel('', '你的城市叫什么？', `<div style="display:flex;gap:8px;margin:6px 0 4px"><div class="namebox emo">青川市🌸<span class="caret"></span></div><div class="sq emo" style="width:52px;height:52px;font-size:28px">🎲</div></div><div style="text-align:right;font-size:12px;color:#7a5a30;margin:0 0 10px">4 / 12</div>${a.btn('开始建设', 'green wide')}`, 'left:16px;right:16px;top:118px');
      const st = states(a, '其他样子', [
        ['没通过', '<div class="namebox bad" style="height:36px;font-size:15px;flex:0 0 120px">发财城</div><span class="errline emo" style="margin:0;color:#ff9f93">⚠️ 换一个名字</span>'],
        ['空名', a.btn('开始建设', 'gray off')],
        ['等待', a.btn(`${ICON.spinner} 开始建设`, 'green')],
        ['开新城', '<div class="namebox" style="height:36px;font-size:15px;flex:0 0 120px">青川市<span class="caret" style="height:18px"></span></div><span style="color:#cfe6ee">先填好上一座的名字</span>'],
        ['被邀请', `<span class="toast emo" style="position:static;transform:none;display:inline-block;padding:4px 12px;background:rgba(63,167,90,.9)">你在 ${NB.e.av} ${NB.e.name} 旁边</span><span style="color:#cfe6ee">顶部一行</span>`],
      ], 'left:16px;right:16px;top:322px');
      a.add('<div class="kbd"><div class="cand"><span>青川</span><span>青川市</span><span>清川</span><span>🌸</span><span>🌊</span></div>' + [['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'], ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'], ['⇧', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '⌫']].map((r) => `<div class="kr">${r.map((k) => `<span>${k}</span>`).join('')}</div>`).join('') + '<div class="kr"><span class="w">123</span><span class="w">😀</span><span class="sp">空格</span><span class="go">完成</span></div></div>');
      a.coAt(1, document.querySelector('.back'), 0, 40);
      a.coAt(2, box, box.offsetWidth - 70, 112);
      a.coAt(3, box, box.offsetWidth - 22, 46);
      a.coAt(4, document.querySelector('.kbd'), 20, 4);
      a.coAt(5, st, st.offsetWidth - 20, 0);
    },
  },
  {
    id: 'A3', title: '新手引导：第 1 到 3 步', from: 'A2 开始建设；每座新城都出现；中途关掉游戏，下次从没完成的那一步接着走',
    query: EARLY,
    notes: ['背景是 1 级的空城；遮住别的东西，只挖空当前要点的按钮', '向导一句话，带步数和五段进度：修路 → 造水厂电厂 → 划住宅和工业 → 看楼长出来、收第一笔税 → 升 2 级', '手指动画示范怎么点；每一下点击和等待都有显示', '胶囊下方一直有“跳过”；点了先问一次（图里是问的样子）', '整个引导结束时：镜头拉远，一条船顺着这条穿城的河开过去，同时请求微信订阅授权（B5）'],
    draw(a) {
      base(a, { hud: L1 });
      const b = document.querySelector('.db.build .ring').getBoundingClientRect();
      const spot = a.add(`<div class="spot" style="left:${b.left - 8}px;top:${b.top - 8}px;width:${b.width + 16}px;height:${b.height + 16}px"></div>`);
      const card = coach(a, b.top - 150, 1, '先修一条路，楼要贴着路才长得出来');
      const hand = a.add(`<div class="hand emo" style="left:${b.left + 30}px;top:${b.top + 22}px">👆</div>`);
      const skip = a.add('<div class="skip">跳过</div>');
      const ask = a.panel('', '', `<div style="font-weight:900;color:var(--brown);font-size:15px">跳过新手引导？</div><div style="font-size:13px;color:#7a5a30;margin:4px 0 10px">设置里可以重看</div><div style="display:flex;gap:8px">${a.btn('接着学', 'green small')}${a.btn('跳过', 'blue small')}</div>`, 'right:8px;top:140px;width:200px');
      const [rx, ry] = a.P(30, 48.2);
      const boat = a.add(`<div class="emo" style="position:absolute;left:${rx - 14}px;top:${ry - 16}px;font-size:26px;opacity:.85">⛴️</div>`);
      a.coAt(1, spot, 0, 0);
      a.coAt(2, card, 10, 4);
      a.coAt(3, hand, 30, 10);
      a.coAt(4, ask, 0, 20);
      a.coAt(5, boat, 40, 4);
      a.coAt(4, skip, -10, 4);
    },
  },
  {
    id: 'A3b', title: '新手引导：第 4、5 步', from: 'A3 第 3 步完成',
    query: EARLY,
    notes: ['第 4、5 步不遮罩，可以自由建造', '徽章下面一个目标小签：楼长出来 → 收到第一笔税 → 升 2 级，完成的打勾', '徽章发光（经验满了）时手指再出来指它；点了是升级仪式（B3）', '第 5 步：这个玩家第一次到 2 级时领升级奖励；第二座城起没有奖励，升级仪式结束就算完成（B3b）', '胶囊下方的“跳过”一直在'],
    draw(a) {
      earlyCity(a);
      const [tx, ty] = a.P(23, 39);
      a.svg(`<text x="${tx}" y="${ty - 26}" font-size="16">🪙</text><text x="${tx + 18}" y="${ty - 28}" font-size="13" font-weight="900" fill="#ffe48a" stroke="#4a2c00" stroke-width="3" paint-order="stroke">+12</text>`);
      base(a, { hud: { ...L1, xp: 1, full: true, money: '3,260', pop: '64', face: '🙂', word: '好' } });
      const goal = a.add('<div class="goal emo" style="left:8px;top:170px"><span class="g ok">🏠 ✓</span>›<span class="g ok">🪙 ✓</span>›<span class="g now">Lv2 ○</span></div>');
      const hand = a.add('<div class="hand emo" style="left:22px;top:118px">👆</div>');
      const card = coach(a, 560, 5, '经验满了，点徽章升到 2 级');
      card.style.padding = '8px 12px';
      const skip = a.add('<div class="skip">跳过</div>');
      a.co(1, tx + 50, ty - 10);
      a.coAt(2, goal, goal.offsetWidth, 4);
      a.coAt(3, hand, 46, 20);
      a.coAt(4, card, 10, 4);
      a.coAt(5, skip, -10, 4);
    },
  },
  {
    id: 'A3c', title: '新手引导：第 1 步画路', from: 'A3 第 1 步点了建造、选了两车道',
    query: BARE({ zoom: 0.36, x: 28, y: 42 }),
    notes: ['在离通航河最近的平地上画一条推荐路线的虚影；遮罩只挖空这一条', '手指沿虚影示范拖动', '画到别处也算完成，不强迫照着画', '建造模式的顶条：返回和工具名在第一行（胶囊左边），资金一格在第二行；左上返回回到建造托盘', '第 2 步同样遮罩，只让沿河的格子发亮（水厂要挨着水）'],
    draw(a) {
      isoRoad(a, 20, 43, 36, 43, true);
      const [x1, y1] = a.P(20, 43.5);
      const [x2, y2] = a.P(37, 43.5);
      const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const top = modeTop(a, { icon: '🛣️', name: '两车道', drop: false, money: L1.money });
      a.add(`<div class="spot" style="left:${cx - len / 2 - 24}px;top:${cy - 36}px;width:${len + 48}px;height:72px;transform:rotate(${ang}deg)"></div>`);
      const hx = x1 + (x2 - x1) * 0.45;
      const hy = y1 + (y2 - y1) * 0.45;
      a.add(`<svg style="position:absolute;inset:0" width="390" height="844"><path d="M${x1} ${y1} L${hx} ${hy}" stroke="#ffd76a" stroke-width="6" stroke-linecap="round" opacity=".9"/></svg>`);
      const hand = a.add(`<div class="hand emo" style="left:${hx - 12}px;top:${hy - 4}px">👆</div>`);
      const card = coach(a, 600, 1, '沿着虚线拖一条路；画到别处也算');
      a.add('<div class="skip">跳过</div>');
      a.co(1, x2 - 10, y2 - 34);
      a.coAt(2, hand, 36, 10);
      a.coAt(3, card, 10, 4);
      a.coAt(4, top.back, 0, 40);
      const [rx, ry] = a.P(30, 48);
      a.co(5, rx, ry);
    },
  },
  {
    id: 'B1', title: '主界面', from: '打开游戏（离线收益收下之后）；所有浮层关掉以后都回到这里',
    query: MAIN,
    notes: ['城市徽章：中间是等级，外圈金色是经验；经验满了整圈发光（图里的样子），点了是 B3 升级仪式，没满点了是 C5 等级小卡', '城市名和游戏时间（点时间冒“第 N 年 N 月 N 日”）；保护期内城市名旁多一个嫩芽写剩几天（样子见 B1a），4 级的青川市早过了保护期；第一行在胶囊左边，12 个字的城市名也放得下', '站内信，红点只数待处理 → H1', '我的城市 → J1；和信封一起竖排在胶囊下面', '资金（顶部不带 ¥，超过 99,999 写“12.5万”）；最近一个游戏小时净收入为负时旁边多一个灰色 ▼（图里是正的，不画）；＋ 看视频领钱 → C1', '人口 → C3', '满意度表情和一个词 → C4', '在建工程的进度环 → D8', '建造；金色小星是托盘里还有带“新”的卡片（红点只留给待处理） → D1', '视图 → F0', '地区 → I1', '回到全城档、城市中心（G1）'],
    draw(a) {
      const p = a.near(1, 33, 41);
      const [sx, sy] = site(a, p);
      base(a, { hud: { full: true, xp: 1 } });
      const np = document.querySelector('.nameplate');
      a.coAt(1, document.querySelector('.emblem'), 4, 4);
      a.coAt(2, np, np.offsetWidth - 4, 6);
      a.coAt(3, document.querySelector('.topright .sq'), -10, 30);
      a.coAt(4, document.querySelectorAll('.topright .sq')[1], -10, 30);
      const caps = document.querySelectorAll('.cap');
      a.coAt(5, caps[0], 50, 42);
      a.coAt(6, caps[1], 40, 42);
      a.coAt(7, caps[2], 12, 42);
      a.co(8, sx + 22, sy - 14);
      const dbs = document.querySelectorAll('.db');
      a.coAt(9, dbs[0], 4, 10);
      a.coAt(10, dbs[1], 4, 10);
      a.coAt(11, dbs[2], 4, 10);
      a.coAt(12, document.querySelector('.home'), 0, 0);
    },
  },
  {
    id: 'B1o', title: '没网时打开游戏', from: '打开游戏时没网，手机上有存档（没有存档就停在 L1 出“重试”）',
    query: MAIN,
    notes: ['用手机上的存档进主界面，城市名旁一个断线图标；城市照常在本地跑', '要联网的按钮置灰并带同一个断线图标：站内信、看视频领钱、地区，还有升级（徽章发光也点不了）', '建造、视图照常能用；修接拆线头、撤销线头、改名、好友、参观要联网', '联网后自动同步，不弹窗；离开超过 10 分钟的，同步拿到离线记录后补出 B2（等没有浮层、没在画东西时）。图里是挖孔屏的顶部'],
    draw(a) {
      a.chrome({ hole: true });
      base(a, { hud: { offline: true, full: true, xp: 1 }, dock: { offline: true } });
      a.coAt(1, document.querySelector('.nameplate .offn'), 34, 10);
      a.coAt(2, document.querySelector('.topright .sq'), -12, 22);
      a.coAt(2, document.querySelector('.db.region'), 70, 10);
      a.coAt(2, document.querySelector('.cap .plus'), 22, 34);
      a.coAt(2, document.querySelector('.emblem'), 4, 4);
      a.coAt(3, document.querySelector('.db.build'), 4, 10);
      a.co(4, 195, 420);
    },
  },
  {
    id: 'B1n', title: '主界面：夜里', from: '游戏时间到了晚上（游戏里一天是现实 24 分钟）',
    query: q({ t: 21.5 }),
    notes: ['夜里只把画面调暗、楼和路灯亮起来；界面和白天（B1）一样', '城市名下的游戏时间换成月亮', '视图打开时一律用白天光照', '挖孔屏的顶部：状态栏里只有一个小孔，第一行照样放在胶囊左边'],
    draw(a) {
      a.chrome({ hole: true });
      base(a, { hud: { clock: '🌙 21:30' } });
      const clock = document.querySelector('.nameplate small');
      a.co(1, 200, 420);
      a.coAt(2, clock, clock.offsetWidth + 24, 6);
      a.coAt(3, document.querySelector('.db.view'), 4, 10);
      a.co(4, 222, 20);
    },
  },
  {
    id: 'B1a', title: '主界面：1 级的空城', from: '跳过新手引导以后（走完引导的城市已经升到 2 级）；每座新城都从 1 级开始',
    query: EARLY,
    notes: ['城里还什么都没有，大片空地，河从城市中间穿过；只有 1 级就能造的东西可用', '人口是 0、资金是开局的数；保护期嫩芽写剩几天，期间谁都不能往你这边修', '经验环还很短', '托盘里的东西都是新的，建造按钮上一直有金色小星，直到每张卡点过一次'],
    draw(a) {
      a.chrome({ hole: true });
      base(a, { hud: L1 });
      a.co(1, ...a.P(26, 36));
      a.coAt(2, document.querySelector('.nameplate .sprout'), 30, 30);
      a.coAt(3, document.querySelector('.emblem'), 4, 4);
      a.coAt(4, document.querySelector('.db.build'), 4, 10);
    },
  },
  {
    id: 'B2', title: '打开游戏：离线收益', from: '打开游戏，离开超过 10 分钟（离线补算的进度条走完以后）',
    query: MAIN,
    notes: ['离开了多久；离开超过 8 小时时画出冻结的小图标：只补算 8 小时', '离线期间的税，数字从零往上滚；下面小一号灰字是维护费', '过路费单列，已经在结算时到账，不翻倍', '看视频翻倍（只能一次）', '看视频延长补算几小时（只能一次）；离开不到 8 小时没有这个按钮（B2b）', '收下（绿色）→ B1；离线期间升了星的楼在地图上一起闪一下；这时顺便请求订阅授权（B5）'],
    draw(a) {
      const m = moment(a, `${AWAY_LONG}<div class="chest emo">💰</div><div class="big">¥3,640</div><div class="sub2">维护费 −¥1,120</div>${TOLL_PAID}<div style="display:flex;gap:8px;margin-top:14px">${a.btn('翻倍', 'wide', true)}${a.btn('延长 2 小时', 'wide', true)}</div><div style="margin-top:10px">${a.btn('收下', 'green wide')}</div>`);
      const txt = m.querySelectorAll('.mtx');
      const chip = txt[0].querySelector('.chipcity');
      a.coAt(1, chip, chip.offsetWidth + 4, -8);
      a.coAt(2, m.querySelector('.big'), m.offsetWidth / 2 + 90, 24);
      a.coAt(3, txt[1], txt[1].offsetWidth / 2 + 110, 8);
      const bs = m.querySelectorAll('.btn');
      a.coAt(4, bs[0], 6, 6);
      a.coAt(5, bs[1], 6, 6);
      a.coAt(6, bs[2], 20, 8);
    },
  },
  {
    id: 'B2b', title: '离线收益：离开不到 8 小时', from: '打开游戏，离开 10 分钟到 8 小时',
    query: MAIN,
    notes: ['离开了多久；不到 8 小时，没有冻结图标', '税和维护费', '只有翻倍，没有延长按钮', '收下 → B1'],
    draw(a) {
      const m = moment(a, `<div class="mtx">离开了 3 时 12 分</div><div class="chest emo">💰</div><div class="big">¥1,280</div><div class="sub2">维护费 −¥410</div><div style="margin-top:14px">${a.btn('翻倍', 'wide', true)}</div><div style="margin-top:10px">${a.btn('收下', 'green wide')}</div>`);
      const bs = m.querySelectorAll('.btn');
      a.coAt(1, m.querySelector('.mtx'), m.querySelector('.mtx').offsetWidth / 2 + 70, 8);
      a.coAt(2, m.querySelector('.big'), m.offsetWidth / 2 + 90, 24);
      a.coAt(3, bs[0], 6, 6);
      a.coAt(4, bs[1], 20, 8);
    },
  },
  {
    id: 'B2c', title: '离线收益：翻倍以后', from: 'B2 看完翻倍的视频',
    query: MAIN,
    notes: ['税滚到两倍，旁边盖一个金色的“×2”章', '维护费是手机真正扣掉的钱，翻倍时不变', '翻倍只能一次：翻倍按钮消失', '过路费不翻倍', '延长还在，可以再看一次；延长出来的税也自动翻倍', '收下 → B1'],
    draw(a) {
      const m = moment(a, `${AWAY_LONG}<div class="chest emo">💰</div><div class="big" style="position:relative;display:inline-block">¥7,280${DOUBLE_STAMP}</div><div class="sub2">维护费 −¥1,120</div>${TOLL_PAID}<div style="margin-top:14px">${a.btn('延长 2 小时', 'wide', true)}</div><div style="margin-top:10px">${a.btn('收下', 'green wide')}</div>`);
      const bs = m.querySelectorAll('.btn');
      const sub = m.querySelector('.sub2');
      const txt = m.querySelectorAll('.mtx');
      a.coAt(1, m.querySelector('.big span'), 40, 0);
      a.coAt(2, sub, sub.offsetWidth / 2 + 80, -2);
      a.coAt(3, bs[0], 6, 6);
      a.coAt(4, txt[1], txt[1].offsetWidth / 2 + 110, 8);
      a.coAt(5, bs[0], bs[0].offsetWidth - 30, 6);
      a.coAt(6, bs[1], 20, 8);
    },
  },
  {
    id: 'B2d', title: '离线收益：广告不可用', from: '打开游戏时广告服务没开通或拉不到广告',
    query: MAIN,
    notes: ['看视频的按钮变成直接领取：不带 ▶，写今天还剩几次', '次数用完变灰；次数和金额在运营配置里，广告恢复后变回看视频', '按钮点下变转圈，不能连点（虚线框）', '收下 → B1'],
    draw(a) {
      const m = moment(a, `${AWAY_LONG}<div class="chest emo">💰</div><div class="big">¥3,640</div><div class="sub2">维护费 −¥1,120</div>${TOLL_PAID}<div style="display:grid;gap:8px;margin-top:14px">${a.btn('直接翻倍 <span class="cnt">今天还剩 2 次</span>', 'wide')}${a.btn('直接延长 2 小时 <span class="cnt">今天还剩 0 次</span>', 'gray wide off')}</div><div style="margin-top:10px">${a.btn('收下', 'green wide')}</div>`);
      const bs = m.querySelectorAll('.btn');
      a.coAt(1, bs[0], 6, 6);
      a.coAt(2, bs[1], 6, 6);
      const st = states(a, '点下以后', [['等回应', a.btn(`${ICON.spinner} 直接翻倍`, '')]], 'left:40px;right:40px;bottom:60px');
      a.coAt(3, st, st.offsetWidth - 20, 0);
      a.coAt(4, bs[2], 20, 8);
    },
  },
  {
    id: 'B3', title: '升级仪式', from: 'B1 经验满了，徽章发光，点徽章（要联网）',
    map: false,
    notes: ['新等级的数字从上面落下来，3 秒以内', '只亮解锁配置里标了“仪式里展示”的、现在就用得上的东西，其余放在 C5 里', '星级上限解锁时，星的图标飞向左上的徽章', '这个玩家第一次到这一级：最后一个图标是升级奖励，飞进信封，红点 +1（图里从 3 变成 4；H1 领取，可以看视频翻倍）', '点任意处 → B1；新东西在建造托盘里带“新”字'],
    draw(a) {
      const { lv, unl, tip, tiles, em } = ceremony(a, 5, [['⭐', '三星'], ['🌬️', '风电'], ['☀️', '太阳能'], ['🏭<b style="position:absolute;right:4px;bottom:0;font:900 13px/1 serif;color:#5a3a0c">Ⅱ</b>', '二级厂'], ['🏆', '物流园'], ['🎁', '升级奖励']], 4);
      const s0 = tiles[0].getBoundingClientRect();
      const s5 = tiles[5].getBoundingClientRect();
      const env = document.querySelector('.topright .sq').getBoundingClientRect();
      flyPaths(a, [`M${s0.left + 20} ${s0.top} C ${s0.left - 20} 300, 60 200, ${em.left + 32} ${em.bottom + 4}`, `M${s5.left + 30} ${s5.top} C ${s5.left + 60} 340, 380 260, ${env.left + 22} ${env.bottom + 4}`]);
      a.add(`<div class="emo" style="position:absolute;left:30px;top:150px;font-size:26px;filter:drop-shadow(0 0 6px #fff)">⭐</div><div class="emo" style="position:absolute;left:${env.left - 8}px;top:${env.bottom + 30}px;font-size:24px;filter:drop-shadow(0 0 6px #fff)">🎁</div>`);
      a.coAt(1, lv.querySelector('.num'), 140, 30);
      a.coAt(2, unl, 4, 4);
      a.co(3, 34, 200);
      a.coAt(4, document.querySelector('.topright .sq'), -10, 40);
      a.coAt(5, tip, 100, 0);
    },
  },
  {
    id: 'B3b', title: '升级仪式：没有升级奖励', from: 'B1 点发光的徽章，这一级的奖励在以前的城市领过了（第二座城起）',
    map: false,
    notes: ['新等级落下，解锁的东西照常亮出来', '星级上限解锁照样飞向徽章', '没有奖励：不飞信封、红点不加；底下一行小字说明', '点任意处 → B1'],
    draw(a) {
      const { lv, tip, tiles, em } = ceremony(a, 3, [['⭐', '二星'], ['🏘️', '中密度'], ['🚆', '铁路']], 0);
      const s0 = tiles[0].getBoundingClientRect();
      flyPaths(a, [`M${s0.left + 20} ${s0.top} C ${s0.left - 30} 300, 60 200, ${em.left + 32} ${em.bottom + 4}`]);
      const note = a.add('<div style="position:absolute;left:0;right:0;top:600px;text-align:center;font-weight:800;color:#6b4300;font-size:13px">升级奖励在第一座城市领过了</div>');
      a.coAt(1, lv.querySelector('.num'), 120, 30);
      a.co(2, 40, 220);
      a.coAt(3, note, 60, 8);
      a.coAt(4, tip, 100, 0);
    },
  },
  {
    id: 'B4', title: '资金为负和破产保护', from: '资金低于零时一直是这个样子；低于红线时多一个沙漏倒计时。图里是在建造模式放派出所',
    query: MAIN,
    notes: ['资金变灰；破产保护时资金格右下角挂一个沙漏和倒计时（现实时间），不另占位置；沙漏只表示破产保护；地图不标红、不弹窗；离红线多远看 C1（C1b）', '钱不够的东西：价格气泡写差多少；▶ 看视频补钱，按钮写这次能补多少，看完更新差多少（广告不可用时直接领取，每天限次）', '确认按钮变灰；拆除、征收、调税、调预算照样能做', '建造模式的顶条：返回和工具名在第一行（胶囊左边），资金一格在第二行；派出所用盾牌图标'],
    draw(a) {
      const top = modeTop(a, { icon: '🛡️', name: '派出所', money: '-1,820', neg: true });
      const cx = 34;
      const cy = 40;
      a.svg(a.poly([[cx, cy], [cx + 2, cy], [cx + 2, cy + 2], [cx, cy + 2]], 'fill="rgba(255,255,255,.75)" stroke="#2a8fa8" stroke-width="3"'));
      a.svg(a.ring(cx + 1, cy + 1, 7, 'fill="rgba(42,143,168,.12)" stroke="#2a8fa8" stroke-width="2" stroke-dasharray="8 6"'));
      const [sx, sy] = a.P(cx + 1, cy);
      const price = a.add(`<div class="price" style="left:${sx}px;top:${sy}px"><span class="g">¥900</span> · 每天 −¥30<br><span class="r">差 ¥2,720</span> <span class="btn small" style="min-height:28px"><span class="vid">▶</span>+¥3,600</span></div>`);
      const cf = a.add('<div class="confirm"><div class="no">✕</div><div class="ok dis">✓</div></div>');
      const vb = price.querySelector('.btn');
      const hg = top.money.querySelector('.hg');
      a.coAt(1, hg, hg.offsetWidth + 16, 8);
      a.coAt(2, vb, vb.offsetWidth + 22, 14);
      a.coAt(3, cf.lastElementChild, 4, 4);
      a.coAt(4, top.title, top.title.offsetWidth + 12, 12);
    },
  },
  {
    id: 'B5', title: '微信订阅授权', from: '玩家自己点按钮的时刻：引导结束、升级奖励点“领取”、第一次造码头或货运站、收下离线收益',
    map: false,
    notes: ['订阅消息只能在玩家点按钮时请求，所以挑这些一定会点的时刻提前要，攒几次授权；图里是在站内信（H1）里点了升级奖励的“领取”', '只发两件要紧事：有线头对着你（第 1、3、6 天各一次）、破产保护快到期', '玩家拒绝了也不影响游戏，下次同样的时刻再问；设置里可以手动再授权（J2）'],
    draw(a) {
      const rows = [
        ['🚆', `${NB.n.av} ${NB.n.name}的铁路对着你`, ddl('剩 5 天'), a.btn('去看看', 'blue')],
        ['👤', `${NB.w.av} ${NB.w.name}想加你为好友`, '', `${a.btn('✕', 'gray')}${a.btn('✓', 'green')}`],
        ['🎁', '升到 4 级的奖励', '<b style="color:#7a4a00">¥5,000</b>', `${a.btn('翻倍', '', true)}${a.btn('领取', 'green')}`],
        ['🎁', '升到 3 级的奖励', '¥3,000', '<span>已领取</span>', 'done'],
      ];
      a.add(`<div class="screen"><div class="top"><div class="back">‹</div><div class="title emo">✉️ 站内信</div><div style="width:44px"></div></div><div class="tabs"><div class="on">待处理 3</div><div>通知<i class="gd"></i></div></div><div class="body">${rows.map(mailRow).join('')}</div></div>`);
      a.add('<div class="dim" style="background:rgba(0,0,0,.45)"></div>');
      const sh = a.add('<div class="wxsheet"><div class="app"><i></i>城市首席规划师 申请</div><h3>向你发送下列消息</h3><div class="opt">邻居的线头等你接上<span class="chk">✓</span></div><div class="opt">破产保护快到期<span class="chk">✓</span></div><div class="keep"><i></i>总是保持以上选择，不再询问</div><div class="acts"><span>取消</span><span class="ok">允许</span></div></div>');
      a.coAt(1, sh, 20, 10);
      a.coAt(2, sh.querySelector('.opt'), sh.offsetWidth - 60, 0);
      a.coAt(3, sh.querySelector('.acts'), 40, 0);
    },
  },
  {
    id: 'B6a', title: '看视频领钱：到账中', from: 'C1 点“看视频领钱”，视频看完回到地图',
    query: MAIN,
    notes: ['到账中：资金数字后面一个小转圈，不另占位置，人口和满意度照常显示；金币从下面飞进资金，旁边飘一下这次的金额；服务端确认了才变成能花的钱', '确认没来就淡出，不弹窗；视频中途关掉什么都没有', '到账中的钱还不能花：这时造东西按原来的资金算'],
    draw(a) {
      base(a, { hud: { pending: `<span class="pend">${ICON.spinner}</span>` } });
      const cap = document.querySelector('.cap.money').getBoundingClientRect();
      a.svg(`<path d="M195 560 C150 420 120 300 ${cap.left + 40} ${cap.bottom + 6}" fill="none" stroke="#fff3b0" stroke-width="3" stroke-dasharray="2 8" stroke-linecap="round"/>`);
      for (const [x, y, s] of [[186, 520, 26], [150, 420, 22], [124, 320, 20], [cap.left + 46, cap.bottom + 30, 16]]) a.add(`<div class="emo" style="position:absolute;left:${x}px;top:${y}px;font-size:${s}px;filter:drop-shadow(0 0 6px #ffe48a)">🪙</div>`);
      a.add(`<div style="position:absolute;left:${cap.left + 70}px;top:${cap.bottom + 30}px;font-weight:900;font-size:16px;color:#ffe48a;text-shadow:0 0 3px #4a2c00,0 2px 0 #4a2c00">+¥3,600</div>`);
      const pend = document.querySelector('.cap .pend');
      a.coAt(1, pend, pend.offsetWidth / 2, 40);
      a.co(2, 220, 440);
      a.co(3, 160, 300);
    },
  },
  {
    id: 'B6b', title: '看视频领钱：广告不可用', from: 'C1 里广告服务还没开通，或拉不到广告',
    query: MAIN,
    notes: ['小卡和 C1 一样，只是底部按钮变成“直接领取”，不带 ▶，写今天还剩几次', '用完变灰；点下变转圈，不能连点（虚线框里是这两种样子）', '加速、翻倍、延长、换位置一样按天限次；次数和金额在运营配置里，广告恢复以后变回看视频', scrimNote],
    draw(a) {
      const c = cityMoneyCard(a, a.btn('直接领取 ¥3,600 <span class="cnt">今天还剩 2 次</span>', 'wide'));
      const cb = c.getBoundingClientRect();
      const st = states(a, '其他样子', [['用完', a.btn('直接领取 <span class="cnt">今天还剩 0 次</span>', 'gray off')], ['点下', a.btn(`${ICON.spinner} 直接领取`, '')]], `left:30px;right:44px;top:${cb.bottom + 20}px`);
      a.coAt(1, c.querySelector('.btn'), 10, 6);
      a.coAt(2, st, st.offsetWidth - 20, 0);
      a.coAt(3, c, c.offsetWidth - 20, 20);
      a.co(4, 372, st.getBoundingClientRect().top + 56);
    },
  },
  {
    id: 'K1', title: '城市结束', from: '打开游戏时城市已经结束；或刚在 K2 结束了城市；或玩着的时候同步返回城市已结束（丢掉没确认的虚影、关掉浮层，直接盖上来）。没有城市时它就是首页',
    query: q({ zoom: 0.14, x: 32, y: 32, extra: '&cars=0' }),
    notes: ['城市最后一眼的全景，变成灰色', '一个原因图标加一行短语（唯一写原因的地方）：线头期限光环“邻居的线头 7 天没接上”、⏳“资金在红线以下过了 12 小时”、💤“30 天没有打开游戏”、🏚️“你结束了这座城市”', '开新城 → A1（返回回 K1）；城市名留在新城的取名框里', '看历史城市 → J1；这座城市已经在里面，只能看，可以永久删除', '每次打开游戏都停在这里，直到点“开新城”'],
    draw(a) {
      document.getElementById('game').style.filter = 'grayscale(1) brightness(.9)';
      a.add('<div class="dim" style="background:rgba(6,16,20,.35)"></div>');
      const m = a.panel('moment', `${ME.name}结束了`, `<div style="display:grid;place-items:center;margin:6px 0"><svg width="70" height="70" viewBox="0 0 70 70"><circle cx="35" cy="35" r="32" fill="none" stroke="#f2b62f" stroke-width="3" opacity=".4"/><circle cx="35" cy="35" r="24" fill="none" stroke="#f2b62f" stroke-width="4" opacity=".7"/><circle cx="35" cy="35" r="15" fill="#fff3d1" stroke="#f2b62f" stroke-width="4"/><text x="35" y="41" text-anchor="middle" font-size="16">🚆</text></svg></div><div style="font-weight:900;color:var(--brown);font-size:16px">邻居的线头 7 天没接上</div><div class="mtx" style="margin-top:6px">2026-11-10 · Lv4 · 8,450 人</div><div style="display:grid;gap:10px;margin-top:16px">${a.btn('开新城', 'green wide')}${a.btn('看历史城市', 'blue wide')}</div>`, 'top:60%');
      a.co(1, 60, 200);
      a.coAt(2, m.querySelector('svg'), 80, 20);
      const bs = m.querySelectorAll('.btn');
      a.coAt(3, bs[0], 10, 6);
      a.coAt(4, bs[1], 10, 6);
      a.co(5, 330, 200);
    },
  },
];
