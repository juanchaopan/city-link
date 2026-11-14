// 站内信、地区和全国、参观、我的城市和设置：H1 至 H2、I1 至 I3、J1 至 J4。
import { q, BARE, NB, ME, ddl, states, regionSvg, EMPTY_NEAR, thumb } from './screens-common.js';

const built = (p) => p.level >= 2;
const screenTop = (a, title, right = '') => a.add(`<div class="screen"><div class="top"><div class="back">‹</div><div class="title emo">${title}</div>${right}</div><div class="body" id="sb"></div></div>`);
const mailRow = ([e, l1, l2, act, cls = '']) => `<div class="mail ${cls}"><span class="e emo">${e}</span><span class="l1 emo">${l1}</span><span class="l2">${l2}<span class="grow"></span>${act}</span></div>`;

/** “看看”的灰色画面只有地形、河和干线。机位带上穿城的河。 */
const LOOK = BARE({ zoom: 0.22, x: 30, y: 40 });
/**
 * 灰色画面：底图只画地形，再画云港市（5 级，修不了高速）的干线：一条铁路从城里修到南边和青川市相邻的边界，
 * 和 H1“云港市的铁路对着你”对得上。边界画一条白虚线。
 */
function lookGrey(a) {
  document.getElementById('game').style.filter = 'grayscale(1) brightness(1.05) contrast(.85)';
  const rail = [[8, 10], [44, 46], [44, 64]];
  a.svg(a.line(rail, 'stroke="#5f6461" stroke-width="7" stroke-linejoin="round"'));
  a.svg(a.line(rail, 'stroke="#d9dcda" stroke-width="5" stroke-dasharray="2 6"'));
  a.svg(a.line([[28, 64], [62, 64]], 'stroke="#ffffff" stroke-width="3" stroke-dasharray="10 7" opacity=".9"'));
  const [ex, ey] = a.P(44, 64, 0);
  a.svg(`<circle cx="${ex}" cy="${ey}" r="9" fill="#e8e8e8" stroke="#5f6461" stroke-width="3"/>`);
}

/** 还没进游戏的受邀人没有游戏头像：留位画统一的灰色人形。 */
const personSlot = (x, y) => `<circle cx="${x}" cy="${y - 6}" r="17" fill="#d6d6d6" stroke="#8a8a8a" stroke-width="2" stroke-dasharray="4 3"/><circle cx="${x}" cy="${y - 12}" r="5" fill="#9a9a9a"/><path d="M${x - 9} ${y + 4} a9 8 0 0 1 18 0 z" fill="#9a9a9a"/>`;

/** 地区地图铺满中间；返回位置 → 屏幕坐标。reserved 里的空位画成留给邀请的灰色人形，其余空位的 ＋ 变灰。 */
function regionScreen(a, { title = `🏰 ${ME.region} · ${ME.climate}`, reserved = [] } = {}) {
  screenTop(a, title);
  const { svg, at } = regionSvg({ cw: 58, ox: 195, oy: 285 });
  let extra = '';
  for (const [c, r] of EMPTY_NEAR) {
    const [x, y] = at(c, r);
    const res = reserved.find((v) => v.c === c && v.r === r);
    if (res) extra += `${personSlot(x, y)}<rect x="${x - 26}" y="${y + 14}" width="52" height="18" rx="9" fill="#13303d" stroke="#e9c46a"/><text x="${x}" y="${y + 27}" text-anchor="middle" font-size="12" font-weight="800" fill="#ffeab0">${res.days}</text>`;
    else extra += `<circle cx="${x}" cy="${y}" r="17" fill="${reserved.length ? 'rgba(220,220,220,.9)' : 'rgba(255,255,255,.92)'}" stroke="${reserved.length ? '#8a8a8a' : '#a8741c'}" stroke-dasharray="4 3" stroke-width="2"/><text x="${x}" y="${y + 7}" text-anchor="middle" font-size="22" font-weight="900" fill="${reserved.length ? '#8a8a8a' : '#a8741c'}">+</text>`;
  }
  a.add(`<svg viewBox="0 0 390 844" width="390" height="844" style="position:absolute;inset:0">${svg}${extra}</svg>`);
  return at;
}

/** 好友一排：都是已经进游戏的玩家，头像不和地区里别的玩家重复。 */
function friendsRow(a) {
  const fr = a.add(`<div class="friends emo" style="position:absolute;left:10px;right:96px;bottom:calc(var(--sab) + 8px)"><span class="lbl">好友</span>${[['🐻', '北岭'], ['🐼', '鹿鸣'], ['🦔', '栗子'], ['🐳', '海生']].map(([e, n]) => `<div class="av">${e}<small>${n}</small></div>`).join('')}</div>`);
  const nat = a.add('<div style="position:absolute;right:10px;bottom:calc(var(--sab) + 12px)"><span class="btn blue" style="width:76px;height:62px;flex-direction:column;gap:0;font-size:13px"><span class="emo" style="font-size:22px">🗺️</span>全国</span></div>');
  return { fr, nat };
}

const banner = (a, inner) => a.add(`<div class="banner emo"><div class="back">‹</div>${inner}</div>`);

/** 帮助页的示意图：城里的货运站、一条铁路修到边界，边界上的接口。 */
const RAIL_HELP = `<svg viewBox="0 0 340 150" width="100%" height="150" style="display:block;border-radius:10px;border:2px solid #1f4a5c;background:#b3d48b">
  <path d="M0 128 C80 112 160 140 240 122 S320 112 340 118 L340 150 L0 150 Z" fill="#5aa7d0"/>
  <rect x="290" y="0" width="50" height="150" fill="rgba(255,255,255,.28)"/>
  <line x1="290" y1="0" x2="290" y2="150" stroke="#fff3c4" stroke-width="3" stroke-dasharray="9 6"/>
  <text x="315" y="20" text-anchor="middle" font-size="11" font-weight="900" fill="#13303d">邻居</text>
  ${[[40, 22], [70, 30], [130, 18], [160, 30]].map(([x, y]) => `<rect x="${x}" y="${y}" width="22" height="18" rx="2" fill="#e9e1cc" stroke="#8b6526"/>`).join('')}
  <rect x="34" y="62" width="64" height="34" rx="4" fill="#d9d4c8" stroke="#5f6461" stroke-width="2"/>
  <text x="66" y="86" text-anchor="middle" font-size="18">🚉</text>
  <line x1="98" y1="79" x2="290" y2="79" stroke="#6b5a4a" stroke-width="7"/>
  <line x1="98" y1="79" x2="290" y2="79" stroke="#e9e1cc" stroke-width="5" stroke-dasharray="2 7"/>
  <circle cx="290" cy="79" r="15" fill="none" stroke="#f2b62f" stroke-width="3" opacity=".6"/>
  <circle cx="290" cy="79" r="9" fill="#fff3d1" stroke="#f2b62f" stroke-width="3"/>
  <text x="66" y="112" text-anchor="middle" font-size="11" font-weight="900" fill="#13303d">货运站</text>
  <text x="250" y="104" text-anchor="middle" font-size="11" font-weight="900" fill="#13303d">边界接口</text>
</svg>`;

export const WORLD = [
  {
    id: 'H1', title: '站内信：待处理', from: 'B1 点信封',
    map: false,
    notes: ['左上返回 → B1。站内信是唯一会列清单的地方', '两个页签；“待处理”的数字只数没处理的，信封上的红点也只数这一页；“通知”有未读时页签上一个灰色小点', '要接的线头：期限用金色光环 + 天数；“去看看”关掉整屏，镜头直接飞到接口，打开 G2。期限还没开始的线头不生成这封信', '好友申请：拒绝或同意', '升级奖励：看视频翻倍后领取，或直接领取；点领取时顺便请求订阅授权（B5）。奖励按玩家只发一次，这一级以前没到过才有', '领过的移到底部变灰'],
    draw(a) {
      screenTop(a, '✉️ 站内信');
      const sb = document.getElementById('sb');
      sb.insertAdjacentHTML('beforebegin', '<div class="tabs"><div class="on">待处理 3</div><div>通知<i class="gd"></i></div></div>');
      sb.innerHTML = [
        ['🚆', `${NB.n.av} ${NB.n.name}的铁路对着你`, ddl('剩 5 天'), a.btn('去看看', 'blue')],
        ['👤', `${NB.w.av} ${NB.w.name}想加你为好友`, '', `${a.btn('✕', 'gray')}${a.btn('✓', 'green')}`],
        ['🎁', '升到 4 级的奖励', '<b style="color:#7a4a00">¥5,000</b>', `${a.btn('翻倍', '', true)}${a.btn('领取', 'green')}`],
        ['🎁', '升到 3 级的奖励', '¥3,000', '<span>已领取</span>', 'done'],
      ].map(mailRow).join('');
      const mails = sb.querySelectorAll('.mail');
      a.coAt(1, document.querySelector('.back'), 0, 40);
      a.coAt(2, document.querySelectorAll('.tabs div')[1], 30, 0);
      a.coAt(3, mails[0].querySelector('.btn'), 0, 0);
      a.coAt(4, mails[1].querySelector('.btn'), 0, 0);
      a.coAt(5, mails[2].querySelector('.btn'), 0, 0);
      a.coAt(6, mails[3], mails[3].offsetWidth - 30, 10);
    },
  },
  {
    id: 'H2', title: '站内信：通知', from: 'H1 点“通知”页签',
    map: false,
    notes: ['每封一个图标、一行字（“铁路线完工”）和时间；工程完成只发工期超过 10 分钟的', '未读的左边一个点，字加粗；读过的变淡', '点了镜头飞到相关的地方，整屏关掉', '系统公告点了原地展开全文', '左上返回 → B1；信保留 30 天；空信箱是一张小插画（S1）'],
    draw(a) {
      screenTop(a, '✉️ 站内信');
      const sb = document.getElementById('sb');
      sb.insertAdjacentHTML('beforebegin', '<div class="tabs"><div>待处理 3</div><div class="on">通知</div></div>');
      sb.innerHTML = [
        ['🚆', '铁路线完工', '2 小时前', '', ''],
        ['💔', `${NB.s.av} ${NB.s.name}拆了他那头的铁路`, '昨天', '', ''],
        ['🤝', `${NB.s.av} ${NB.s.name}接好了你的铁路`, '2 天前', '', 'read'],
        ['🌱', '保护期明天结束', '3 天前', '', 'read'],
        ['📢', '系统公告：维护通知', '5 天前', '', 'read'],
      ].map(mailRow).join('') + '<div style="margin:-6px 0 8px;padding:10px 12px;border-radius:0 0 12px 12px;background:#f3ead2;border:2px solid #c99a3e;border-top:0;font-size:14px;color:#5a3a12;line-height:1.5">11 月 15 日 2:00 到 3:00 停服维护。维护期间城市照常在手机上运行，联网后自动同步。</div>';
      const mails = sb.querySelectorAll('.mail');
      mails[0].insertAdjacentHTML('afterbegin', '<i class="unread"></i>');
      mails[1].insertAdjacentHTML('afterbegin', '<i class="unread"></i>');
      a.coAt(1, mails[0], mails[0].offsetWidth - 30, 10);
      a.coAt(2, mails[0], -4, 8);
      a.coAt(3, mails[1], mails[1].offsetWidth - 30, 10);
      a.coAt(4, mails[4], mails[4].offsetWidth - 30, 30);
      a.coAt(5, document.querySelector('.back'), 0, 40);
    },
  },
  {
    id: 'I1', title: '地区地图', from: 'B1 点地区',
    map: false,
    notes: ['本地区 4×4 个位置铺满中间，可拖可缩放；按地形着色，河从地区里流过；虚线是地区边界，外面淡的是邻近地区的陆地（临江地区在内陆）', '城市画成小天际线，越高等级越高；城市名不小于 12 号，点击区按格子中心 44 px；你的城市金框，好友带头像，嫩芽是保护期', '连通的城市之间画线：灰色高速、棕色铁路、蓝色河；两边都接好才画（云港市的铁路还没接上，不画）', '点一座城市冒气泡：头像、名字、等级，“看看”（灰色画面）；不是好友的多一个“加好友”（已申请时写“已申请”），好友多一个“实地参观”', '紧挨你的空位上一个 ＋：邀请好友，调起微信分享卡片（S3）', '好友一排写昵称，不分地区；点头像冒出他现在的城市和历史城市，点一张去参观（I3）。图里两个浮层画在一起，游戏里一次只出一个', '右下“全国” → I2'],
    draw(a) {
      const at = regionScreen(a);
      const [bx, by] = at(1, 0);
      const b = a.add(`<div class="bubble"><div class="t emo">${NB.n.av} ${NB.n.name} · Lv5</div><div class="bb">${a.btn('👁 看看', 'blue')}${a.btn('加好友', 'green')}</div></div>`);
      b.style.left = `${bx}px`;
      b.style.top = `${by - 30}px`;
      const { fr, nat } = friendsRow(a);
      const av = fr.querySelector('.av').getBoundingClientRect();
      const pop = a.panel('', '', `<div style="display:flex;gap:8px">${[[`${NB.e.name} · Lv8`, '', '现在'], ['南湾 · Lv3', 'filter:grayscale(1)', '已结束']].map(([n, f, t]) => `<div style="width:120px"><div class="thumb thumbimg" style="height:70px;border-radius:8px;border:2px solid #1f4a5c;${f}"></div><div style="font-size:13px;font-weight:900;color:var(--brown);margin-top:4px">${n}</div><div style="font-size:12px;color:#7a5a30">${t}</div></div>`).join('')}</div>`, `left:10px;top:${av.top - 150}px;padding:8px`);
      const [mx, my] = at(1, 1);
      const [ex, ey] = at(2, 1);
      const [wx, wy] = at(3, 1);
      a.co(1, 40, 470);
      a.co(2, mx - 28, my - 18);
      a.co(3, ex + (wx - ex) * 0.6, ey + (wy - ey) * 0.6);
      a.coAt(4, b, b.offsetWidth - 16, 10);
      const [px, py] = at(2, 2);
      a.co(5, px + 24, py - 14);
      a.coAt(6, pop, pop.offsetWidth - 10, 0);
      a.coAt(7, nat, 0, 0);
    },
  },
  {
    id: 'I1b', title: '地区地图：留给邀请的空位', from: 'I1 邀请了好友、对方还没进来',
    map: false,
    notes: ['已经留给邀请的空位：灰色人形占位（对方还没进游戏，没有游戏头像）和剩几天，没有 ＋；对方点了卡片进来就住在这里', '每人 3 个留位；用完时其余的 ＋ 变灰', '点灰色的 ＋ 冒一个小签“3/3”，不能再邀请', '留位到期自动放开，变回 ＋'],
    draw(a) {
      const at = regionScreen(a, { reserved: [{ c: 2, r: 0, days: '剩 2 天' }, { c: 2, r: 2, days: '剩 5 天' }, { c: 0, r: 0, days: '剩 6 天' }] });
      friendsRow(a);
      const [gx, gy] = at(0, 2);
      const tip = a.add(`<div class="tip" style="left:${gx - 24}px;top:${gy + 22}px;padding:4px 10px">3/3</div>`);
      const [r1x, r1y] = at(2, 0);
      a.co(1, r1x + 30, r1y - 20);
      a.co(2, gx - 26, gy - 16);
      a.coAt(3, tip, tip.offsetWidth + 4, 4);
      const [r3x, r3y] = at(0, 0);
      a.co(4, r3x + 30, r3y - 20);
    },
  },
  {
    id: 'I2', title: '全国', from: 'I1 点右下“全国”',
    map: false,
    notes: ['整个国家：各地区的形状、名字和气候；全国河网流过每个地区', '你的地区描金边', '口岸：相邻地区的共享边中段，每条边 1 到 2 个；只有这几处能修高速和铁路过去', '只在真有海岸的地方画海；海外面是外国市场（系统模拟）', '点别的地区冒小签：地区名、气候、城市数', '左上返回 → I1'],
    draw(a) {
      screenTop(a, '🗺️ 全国');
      document.querySelector('.screen').style.background = 'radial-gradient(circle at 50% 30%,#efe3c4,#c9b48a)';
      const shapes = [['40,60 170,40 200,140 90,170', '北原 ❄️', '#e8eff4'], ['170,40 320,70 300,170 200,140', '松原 ❄️', '#e2ebf1'], ['90,170 200,140 220,280 80,300', '临江 🌤️', '#cfe6b0'], ['200,140 300,170 320,290 220,280', '云川 🌤️', '#d6eab8'], ['80,300 220,280 240,430 110,450', '南滨 ☀️', '#f2e2b0'], ['220,280 320,290 300,420 240,430', '海门 ☀️', '#f5e8c0']];
      const center = (p) => p.split(' ').map((v) => v.split(',').map(Number)).reduce((acc, [x, y], _, arr) => [acc[0] + x / arr.length, acc[1] + y / arr.length], [0, 0]);
      let s = '<path d="M320 70 L360 90 L390 90 L390 520 L120 520 L110 450 L240 430 L300 420 L320 290 L300 170 Z" fill="#6fb6d6"/><path d="M320 70 L300 170 L320 290 L300 420 L240 430 L110 450" fill="none" stroke="#e8d9a6" stroke-width="5"/>';
      s += shapes.map(([p, n, c]) => { const [x, y] = center(p); return `<polygon points="${p}" fill="${c}" stroke="#6b7a70" stroke-width="2.5"/><text x="${x}" y="${y}" text-anchor="middle" font-size="15" font-weight="900" fill="#13303d">${n}</text>`; }).join('');
      s += '<path d="M110 50 C150 150 140 220 160 300 S200 400 250 450" fill="none" stroke="#2f7fb4" stroke-width="6"/><path d="M290 80 C270 160 240 200 160 300" fill="none" stroke="#2f7fb4" stroke-width="4"/><path d="M248 183 C268 240 282 300 272 350 S292 410 334 444" fill="none" stroke="#2f7fb4" stroke-width="4"/>';
      s += '<polygon points="90,170 200,140 220,280 80,300" fill="none" stroke="#ffd76a" stroke-width="6"/>';
      // 口岸画在相邻两个地区共享边的中段：北原—松原、北原—临江、松原—云川、临江—云川（两个）、临江—南滨、云川—海门、南滨—海门。
      s += [[185, 90], [145, 155], [250, 155], [206, 182], [214, 238], [150, 290], [270, 285], [230, 355]].map(([x, y]) => `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" rx="3" fill="#fff" stroke="#7a5a3a" stroke-width="3" transform="rotate(45 ${x} ${y})"/>`).join('');
      s += '<text x="380" y="500" text-anchor="end" font-size="14" font-weight="900" fill="#fff">外国市场 →</text>';
      document.getElementById('sb').innerHTML = `<svg viewBox="0 0 390 530" width="370" style="display:block;margin:10px auto 0">${s}</svg>`;
      const r = document.querySelector('#sb svg').getBoundingClientRect();
      const k = r.width / 390;
      const tip = a.add(`<div class="tip emo" style="left:${r.left + 200 * k}px;top:${r.top + 80 * k}px;padding:6px 10px;flex-direction:column;align-items:flex-start;gap:2px"><b>松原</b><span>❄️ 寒冷 · 16 座城</span></div>`);
      a.co(1, r.left + 72 * k, r.top + 90 * k);
      a.co(2, r.left + 70 * k, r.top + 230 * k);
      a.co(3, r.left + 118 * k, r.top + 146 * k);
      a.co(4, r.left + 360 * k, r.top + 470 * k);
      a.coAt(5, tip, tip.offsetWidth, 4);
      a.coAt(6, document.querySelector('.back'), 0, 40);
    },
  },
  {
    id: 'I3', title: '参观模式：实地参观好友', from: 'I1 城市气泡点“实地参观”；I1 好友头像里的缩略图；G4 头像气泡',
    query: q({ zoom: 0.3, x: 28, y: 22 }),
    notes: ['顶部一条：左边返回（回到来的地方），中间写正在参观谁的城市；在胶囊左边', '右边是对方的头像，点了冒和 G4 一样的气泡（I3c）', '只能看，不能操作；顶部的数和底部的按钮都隐藏', '点楼照样冒气泡，但没有税、钱和按钮', '实地参观好友是彩色的；“看看”和历史城市用灰色画面（I3a、I3b）。参观读的是一份精简的只读快照'],
    draw(a) {
      const bar = banner(a, `<span>👁 正在参观 ${NB.e.name}</span><span class="avatar sm av">${NB.e.av}</span>`);
      const p = a.near(1, 28, 24, built);
      a.svg(a.parcelShape(p, 'fill="rgba(255,236,150,.35)" stroke="#ffd76a" stroke-width="3"'));
      const b = a.bubble(p.px, p.py, `<div class="t emo">🏠 住宅 ${a.stars(2, 2)} <span style="margin-left:auto">🙂</span></div><div style="margin-top:4px;font-weight:800" class="emo">👥 52</div>`, { lift: 20 });
      a.coAt(1, bar.querySelector('.back'), 0, 40);
      a.coAt(2, bar.querySelector('.avatar'), 30, 30);
      a.co(3, 195, 760);
      a.coAt(4, b, b.offsetWidth - 20, b.offsetHeight + 14);
      a.co(5, 40, 600);
    },
  },
  {
    id: 'I3a', title: '参观模式：“看看”的灰色画面', from: 'I1 城市气泡点“看看”（不是好友也能看）',
    query: LOOK,
    notes: ['灰色画面只有地形、河和干线（铁路、高速公路），是对方最近一次同步的样子；路和楼都不画。图里是云港市修到边界的铁路', '顶部一条：返回、看的是谁、对方头像（点了 → I3c）', '点地图没有气泡，只能拖和缩放', '顶部的数和底部的按钮都隐藏'],
    draw(a) {
      lookGrey(a);
      const bar = banner(a, `<span>👁 看看 ${NB.n.name}</span><span class="avatar sm av">${NB.n.av}</span>`);
      const name = bar.querySelector('span');
      a.co(1, 60, 400);
      a.coAt(2, name, name.offsetWidth / 2, 46);
      a.co(3, 250, 470);
      a.co(4, 195, 760);
    },
  },
  {
    id: 'I3b', title: '参观模式：历史城市', from: 'J1 历史城市的 👁',
    query: q({ zoom: 0.3, x: 32, y: 30, extra: '&cars=0' }),
    notes: ['结束那一刻的灰色画面', '顶部一条：返回 → J1；城市名、结束的日子和原因图标', '只能看；点楼没有气泡', '要永久删除回 J1 按住垃圾桶'],
    draw(a) {
      document.getElementById('game').style.filter = 'grayscale(1) sepia(.25) brightness(.95)';
      const bar = banner(a, '<span>南屿 · Lv3</span><span class="chipcity emo" style="margin-left:auto;font-size:12px">💤 2026-09-12</span>');
      a.co(1, 60, 400);
      a.coAt(2, bar.querySelector('.back'), 0, 40);
      a.coAt(2, bar.querySelector('.chipcity'), 20, 30);
      a.co(3, 220, 520);
      a.co(4, 195, 760);
    },
  },
  {
    id: 'I3c', title: '参观模式：点对方头像', from: 'I3、I3a 点顶部条右边的头像',
    query: LOOK,
    notes: ['头像的气泡：名字、等级和所在地区', '不是好友：“加好友”（绿色）；申请过了写“已申请”，不能再点', '是好友：多一个“实地参观”，换成彩色画面（I3）', '虚线框里是另外两种样子；I1 城市气泡上的“加好友”也是同样三种'],
    draw(a) {
      lookGrey(a);
      const bar = banner(a, `<span>👁 看看 ${NB.n.name}</span><span class="avatar sm av">${NB.n.av}</span>`);
      const av = bar.querySelector('.avatar').getBoundingClientRect();
      const b = a.add(`<div class="bubble below" style="left:${av.left - 70}px;top:${av.bottom + 4}px;--tip:150px"><div class="t emo">${NB.n.av} ${NB.n.name} · Lv5</div><div style="font-size:13px;color:#7a5a30;margin-top:2px">${ME.region}</div><div class="bb">${a.btn('加好友', 'green')}</div></div>`);
      const st = states(a, '另外两种', [['已申请', a.btn('已申请', 'gray off')], ['是好友', a.btn('实地参观', 'green')]], 'left:40px;right:40px;top:360px');
      const friendBtn = st.querySelectorAll('.st')[1].querySelector('.btn');
      a.coAt(1, b, -14, 16);
      a.coAt(2, b.querySelector('.btn'), 0, 0);
      a.coAt(3, friendBtn, friendBtn.offsetWidth + 18, friendBtn.offsetHeight / 2);
      a.coAt(4, st, st.offsetWidth - 20, 0);
    },
  },
  {
    id: 'J1', title: '我的城市', from: 'B1 点“我的城市”；K1 点“看历史城市”',
    map: false,
    notes: ['左上返回 → B1；没有正在经营的城市时（从 K1 进来）返回回 K1', '正在经营的这座城市：缩略图、名字和等级，点一下回到地图', '历史城市：灰色缩略图是结束那一刻的，写着哪天、因为什么结束（原因图标）', '👁 进入参观模式（I3b）', '🗑 按住约 1 秒永久删除（红色，按住时有进度）', '右下角齿轮 → J2 设置；没有历史城市时放一张小插画（S1）'],
    draw(a) {
      screenTop(a, '📖 我的城市');
      document.getElementById('sb').innerHTML = `<div class="sect">正在经营</div><div class="citycard cur" style="display:flex;gap:10px;align-items:center">${thumb('width:150px;height:96px;flex:none')}<div><b style="font-size:17px;margin:0">${ME.name}</b><small>Lv4 · 8,450 人</small><div style="margin-top:6px;font-size:13px;color:#7a5a30" class="emo">${ME.region}</div></div></div><div class="sect">历史城市</div><div class="citycards">${[['南屿', 'Lv3 · 💤 2026-09-12', 40], ['石湾', 'Lv2 · 🏚️ 2026-07-30', 0]].map(([n, s, f]) => `<div class="citycard hist">${thumb()}<b>${n}</b><small class="emo">${s}</small><div class="acts">${a.btn('👁', 'blue')}<span class="btn red hold"><i class="fill" style="width:${f}%"></i><span class="emo">🗑</span></span></div></div>`).join('')}</div>`;
      const gear = a.add('<div class="sq emo" style="position:absolute;right:16px;bottom:calc(var(--sab) + 16px);width:56px;height:56px;font-size:28px;border-radius:50%">⚙️</div>');
      const cards = document.querySelectorAll('.citycard');
      const eye = cards[1].querySelector('.btn');
      const hold = cards[1].querySelector('.hold');
      a.coAt(1, document.querySelector('.back'), 0, 40);
      a.coAt(2, cards[0], cards[0].offsetWidth - 20, 20);
      a.coAt(3, cards[1].querySelector('b'), cards[1].offsetWidth - 26, 2);
      a.coAt(4, eye, -4, eye.offsetHeight + 6);
      a.coAt(5, hold, hold.offsetWidth, -4);
      a.coAt(6, gear, 0, 0);
    },
  },
  {
    id: 'J2', title: '设置', from: 'J1 点右下齿轮',
    map: false,
    notes: ['声音三个开关放一行：背景音乐、环境声、按钮音效；震动跟按钮音效一个开关', '画质：流畅（帧率上限 30、分辨率降一档、街道档以外不画车和粒子）和标准；中端机默认流畅', '微信服务通知：再授权一次（订阅消息按次数发）', '改城市名沿用 A2 的输入卡片；开局取名不算改名，第一次改名免费（图里的样子）；之后距上次改名不到 30 天按钮写价格（见 Q-006），满 30 天写“免费”（虚线框）；青色是次要动作', '重看引导：在一块不存档的 1 级空地上自动演示五步，随时可关；帮助 → J4；账号 → J3', '结束这座城市：红色，点了进 K2 结束确认'],
    draw(a) {
      screenTop(a, '⚙️ 设置');
      const tg = (l, off = false) => `<span style="display:flex;align-items:center;gap:4px;font-size:13px"><span class="emo">${l}</span><span class="tog ${off ? 'off' : ''}"></span></span>`;
      document.getElementById('sb').innerHTML = [
        [`<span style="display:flex;gap:10px;flex:1;justify-content:space-between">${tg('🎵 音乐')}${tg('🌊 环境')}${tg('🔘 按钮', true)}</span>`, ''],
        ['<span class="grow emo">🖼️ 画质</span>', '<div class="segctl" style="flex:0 0 140px"><i class="mid on">流畅</i><i>标准</i></div>'],
        ['<span class="grow emo">🔔 微信服务通知</span>', a.btn('再授权一次', 'blue small')],
        [`<span class="grow emo">✏️ 城市名 <span class="sm">${ME.name}</span></span>`, a.btn('改名 · 免费', 'blue small')],
        ['<span class="grow emo">🎬 重看引导</span>', '<b>›</b>'],
        ['<span class="grow emo">❓ 帮助</span>', '<b>›</b>'],
        ['<span class="grow emo">👤 账号</span>', '<b>›</b>'],
        ['<span class="grow emo">🏚️ 结束这座城市</span>', a.btn('结束', 'red small')],
      ].map(([l, r]) => `<div class="setrow">${l}${r}</div>`).join('');
      const st = states(a, '改过名以后', [['不到 30 天', a.btn('改名 · ¥1,000', 'blue small')], ['满 30 天', a.btn('改名 · 免费', 'blue small')]], 'left:16px;right:16px;bottom:calc(var(--sab) + 12px)');
      const rows = document.querySelectorAll('.setrow');
      a.coAt(1, rows[0], 6, 6);
      a.coAt(2, rows[1], 6, 6);
      a.coAt(3, rows[2], 6, 6);
      a.coAt(4, rows[3].querySelector('.btn'), 0, 0);
      a.coAt(4, st, st.offsetWidth - 20, 0);
      a.coAt(5, rows[4], 6, 6);
      a.coAt(6, rows[7].querySelector('.btn'), 0, 0);
    },
  },
  {
    id: 'J3', title: '账号', from: 'J2 点“账号”',
    map: false,
    notes: ['昵称：默认是城市名，可以改，过内容安全检查；“改”是青色的次要动作', '头像只能从系统动物头像里选', '隐私指引、用户协议：打开全文', '注销账号：点了先出二次确认（虚线框），写清后果和时限（时限待核实）；红色按钮按住约 1 秒', '左上返回 → J2'],
    draw(a) {
      screenTop(a, '👤 账号');
      const animals = ['🐨', '🐻', '🐼', '🦊', '🐯', '🐧', '🐰', '🦁', '🐸', '🐮'];
      document.getElementById('sb').innerHTML = `<div class="setrow"><span class="avatar">${ME.av}</span><span class="grow">昵称 <span class="sm">${ME.name}</span></span>${a.btn('✏️ 改', 'blue small')}</div><div class="sect">选一个头像</div><div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;justify-items:center;padding:4px 0 8px">${animals.map((e, i) => `<span class="avatar emo" style="width:52px;height:52px;font-size:28px;${i === 0 ? 'box-shadow:0 0 0 3px #fff1b8,0 0 12px #ffd34d' : ''}">${e}</span>`).join('')}</div><div class="sect">其他</div>${['📄 隐私指引', '📜 用户协议'].map((t) => `<div class="setrow emo"><span class="grow">${t}</span><b>›</b></div>`).join('')}<div class="setrow emo" style="color:#b8301f"><span class="grow">注销账号</span><b>›</b></div>`;
      const m = a.add(`<div class="states" style="left:16px;right:16px;bottom:calc(var(--sab) + 6px)"><span class="lbl">点注销以后：二次确认</span><div style="font-weight:900;color:#ffeab0;font-size:15px">注销账号？</div><div style="font-size:13px;line-height:1.5;margin:4px 0 10px;color:#cfe6ee">城市、历史城市、好友和站内信都会删除，不能找回。提交后 <b style="color:#ffeab0">15 天</b>内重新登录可以撤回（时限待核实）。</div><div style="display:flex;gap:10px"><span class="btn red hold" style="flex:1"><i class="fill" style="width:35%"></i><span>按住注销</span></span>${a.btn('取消', 'blue')}</div></div>`);
      const rows = document.querySelectorAll('.setrow');
      a.coAt(1, rows[0], 6, 6);
      a.coAt(2, document.querySelector('.sect'), 10, 30);
      a.coAt(3, rows[1], rows[1].offsetWidth - 20, 6);
      a.coAt(4, rows[3], rows[3].offsetWidth - 20, 6);
      a.coAt(4, m.querySelector('.hold'), 10, 6);
      a.coAt(5, document.querySelector('.back'), 0, 40);
    },
  },
  {
    id: 'J4', title: '帮助页', from: 'J2 点“帮助”；等级小卡小签上的“?”；建造托盘卡片角上的“?”',
    map: false,
    notes: ['每个系统一页图解：一张示意图加三步，每步一个图标和一句话；铁路页的示意图是货运站、铁路和边界上的接口', '页内只讲怎么做，不讲数值；相关的页放在底下，点了翻过去', '从别处的“?”进来直接打开对应的一页；左上返回回到来的地方', '入口：等级小卡的小签、建造托盘卡片的左上角'],
    draw(a) {
      screenTop(a, '❓ 帮助 · 铁路');
      document.getElementById('sb').innerHTML = `<div class="panel" style="position:relative;padding:8px">${RAIL_HELP}<div style="display:grid;gap:8px;margin-top:10px">${[['🚆', '3 级起能修铁路，和画路一样拖'], ['🚉', '造货运站，本城的货从这里装车'], ['🤝', '把铁路修到边界接上邻居，货就能卖到别的城市']].map(([e, t], i) => `<div style="display:flex;gap:10px;align-items:center;font-size:14px;font-weight:800;color:var(--brown)"><span style="width:26px;height:26px;border-radius:50%;background:#13303d;color:#ffd76a;display:grid;place-items:center;font-size:13px;flex:none">${i + 1}</span><span class="emo" style="font-size:24px">${e}</span>${t}</div>`).join('')}</div><div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">${['货运站', '客运站', '边界接口'].map((t) => `<span class="btn blue small">${t} ›</span>`).join('')}</div></div>`;
      const ins = a.add(`<div class="states" style="left:16px;right:16px;bottom:calc(var(--sab) + 12px)"><span class="lbl">入口</span><div style="display:flex;gap:16px;align-items:center;justify-content:center"><span class="tip" style="position:static">铁路 <i class="help">?</i></span><div class="item" style="width:82px"><i class="help">?</i><div class="pic emo">🚉</div><b>货运站</b></div></div></div>`);
      const p = document.querySelector('#sb .panel');
      a.coAt(1, p, 10, 10);
      a.coAt(2, p.querySelector('.btn'), 0, 0);
      a.coAt(3, document.querySelector('.back'), 0, 40);
      a.coAt(4, ins, ins.offsetWidth - 20, 0);
    },
  },
];
