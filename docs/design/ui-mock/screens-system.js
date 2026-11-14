// 加载、隐私、设备和版本、断网、空状态和等待：L、N、S 组和 K2。
import { ICON } from './api.js';
import { MAIN, ME, base, states, thumb, regionSvg } from './screens-common.js';

const LOGO = '<div style="text-align:center;font-weight:900;font-size:34px;letter-spacing:3px;color:#fff3c4;-webkit-text-stroke:1.5px #6b4308;text-shadow:0 4px 0 #6b4308,0 0 18px rgba(255,214,90,.7)">城市首席规划师</div>';
const SKY = 'position:absolute;inset:0;background:linear-gradient(#7fc8e6 0%,#bfe6f2 45%,#2f6f86 46%,#12303c 100%)';

function loadingBack(a, pct, line) {
  a.add(`<div style="${SKY}"></div>`);
  const logo = a.add(`<div style="position:absolute;left:0;right:0;top:120px">${LOGO}<div style="text-align:center;color:#13303d;font-weight:800;font-size:14px;margin-top:8px">在地区里建一座城，和邻居连成贸易网</div></div>`);
  a.add(`<div style="position:absolute;left:30px;right:30px;top:250px;height:300px;border-radius:24px;overflow:hidden;border:4px solid #e9c46a;box-shadow:0 0 0 3px #5a3a12,0 16px 30px rgba(0,0,0,.4)">${thumb('height:100%;border:0;border-radius:0;background-size:150%')}</div>`);
  const bar = a.add(`<div style="position:absolute;left:40px;right:40px;top:600px;text-align:center"><div class="xp" style="height:18px"><i style="width:${pct}%"></i></div><div style="color:#ffeab0;font-weight:800;font-size:14px;margin-top:10px">${line}</div></div>`);
  return { logo, bar };
}

/** 微信聊天界面自己的状态栏：没有游戏的胶囊。 */
const wxStatusBar = (a) => a.add('<div style="position:absolute;left:0;right:0;top:0;height:47px;display:flex;align-items:center;justify-content:space-between;padding:4px 30px 0 34px;font:700 15px/1 sans-serif;color:#111;z-index:90"><span>9:41</span><span>5G ▮</span></div><div style="position:absolute;left:50%;top:0;width:156px;height:31px;transform:translateX(-50%);background:#000;border-radius:0 0 18px 18px;z-index:91"></div>');

export const SYSTEM = [
  {
    id: 'L1', title: '加载页', from: '每次打开游戏',
    map: false,
    notes: ['游戏名和城市小插画', '进度条；恢复存档时多一句“正在恢复你的城市”', '没网、手机上有存档：直接用本地存档进 B1（B1o）；没有存档：停在这里，断线图标加“重试”（虚线框）', '健康游戏忠告和适龄提示是否必须显示待核实，先留位置', '加载完：第一次 → L2 隐私指引；有城市 → B1 或 B2；城市已结束 → K1'],
    draw(a) {
      const { logo, bar } = loadingBack(a, 68, '正在恢复你的城市… 68%');
      const st = states(a, '没网又没有存档', [['', `<span style="font-size:20px">${ICON.offline}</span><span style="flex:1">连不上服务器</span>${a.btn('重试', 'green small')}`]], 'left:30px;right:30px;top:690px');
      const foot = a.add('<div style="position:absolute;left:0;right:0;bottom:calc(var(--sab) + 2px);text-align:center;color:#9fc3cf;font-size:12px">健康游戏忠告 · 适龄提示（待核实）</div>');
      a.coAt(1, logo, 30, 60);
      a.coAt(2, bar, bar.offsetWidth - 10, 30);
      a.coAt(3, st, st.offsetWidth - 20, 0);
      a.coAt(4, foot, 60, 0);
      a.co(5, 330, 270);
    },
  },
  {
    id: 'L2', title: '隐私指引和用户协议', from: 'L1 加载完，第一次进游戏（在 A1 之前）；隐私指引更新后再出一次',
    map: false,
    notes: ['微信要求的隐私弹窗：说明收集什么、做什么用（openid 和城市存档、广告组件的设备信息、订阅消息）；头像和昵称在游戏里挑，不读取微信的', '两份全文点了打开', '同意 → A1 位置预览（有城市的进 B1）', '拒绝：不能进游戏，停在加载页，弹窗可以重新打开（虚线框）'],
    draw(a) {
      loadingBack(a, 100, '加载完成');
      a.add('<div class="dim"></div>');
      const m = a.panel('moment', '用户隐私保护指引', `<div style="text-align:left;font-size:14px;line-height:1.6;color:#5a3a12">开始前请读一读 <a style="color:#1f7f92;font-weight:900">《用户隐私保护指引》</a>和<a style="color:#1f7f92;font-weight:900">《用户协议》</a>。我们用你的微信身份标识（openid）保存城市存档、在不同手机上同步；广告组件会收集设备信息；你允许以后才发订阅消息。头像和昵称在游戏里挑，不读取微信头像和昵称。</div><div style="display:flex;gap:10px;margin-top:16px">${a.btn('拒绝', 'gray wide')}${a.btn('同意', 'green wide')}</div>`, 'top:46%');
      const st = states(a, '拒绝以后', [['', `<span style="flex:1">要同意才能进游戏</span>${a.btn('再看一次', 'blue small')}`]], 'left:30px;right:30px;bottom:calc(var(--sab) + 40px)');
      const bs = m.querySelectorAll('.btn');
      a.coAt(1, m, 16, 12);
      a.coAt(2, m.querySelector('a'), 40, -18);
      a.coAt(3, bs[1], 10, 6);
      a.coAt(4, bs[0], 10, 6);
      a.coAt(4, st, st.offsetWidth - 20, 0);
    },
  },
  {
    id: 'N1', title: '在另一台设备上打开了', from: '同步或重新拿会话时发现这座城市在别的设备上打开过（切后台超过 5 分钟回来也会检查）',
    map: false,
    notes: ['整屏盖住地图，不能关', '告诉玩家这台上没同步的操作丢了', '只有一个按钮：在这台继续，点了重新拉存档 → B1'],
    draw(a) {
      a.add('<div class="screen"></div>');
      const box = a.add(`<div style="position:absolute;left:24px;right:24px;top:220px;text-align:center"><div class="emo" style="font-size:64px">📱<span style="font-size:36px;vertical-align:middle;margin:0 8px">⇄</span>📱</div><div style="color:#ffeab0;font-weight:900;font-size:20px;margin-top:12px">在另一台设备上打开了</div><div style="color:#cfe6ee;font-size:14px;margin-top:10px;line-height:1.6">这台设备上还没同步的操作已经丢了</div></div>`);
      const btn = a.add(`<div style="position:absolute;left:40px;right:40px;bottom:calc(var(--sab) + 60px)">${a.btn('在这台继续', 'green wide')}</div>`);
      a.coAt(1, box, 10, 0);
      a.coAt(2, box.lastElementChild, 20, 0);
      a.coAt(3, btn, 20, 6);
    },
  },
  {
    id: 'N2', title: '版本更新', from: '打开游戏或玩的时候发现有新版本（排在隐私和授权之后）',
    query: MAIN,
    notes: ['小卡：新版本准备好了，只有“重启”；关不掉，重启后回到这里', '协议不兼容（旧版本连不上服务端）时是整屏，同样只有“重启”（虚线框）', 'wx.getUpdateManager 的行为待核实'],
    draw(a) {
      base(a);
      a.add('<div class="dim"></div>');
      const m = a.panel('moment', '新版本准备好了', `<div class="chest emo">🔄</div><div class="mtx">重启一下就能用</div><div style="margin-top:14px">${a.btn('重启', 'green wide')}</div>`, 'top:38%');
      const st = a.add(`<div class="states" style="left:60px;right:60px;top:560px;height:220px;background:radial-gradient(circle at 50% 0%,#2f6f86,#12303c 70%)"><span class="lbl">协议不兼容时</span><div class="emo" style="text-align:center;padding-top:30px;color:#ffeab0;font-weight:900;font-size:16px">🔄 这个版本太旧了</div><div style="text-align:center;color:#cfe6ee;font-size:13px;margin-top:6px">重启后自动更新</div><div style="margin:20px 20px 0">${a.btn('重启', 'green wide')}</div></div>`);
      a.coAt(1, m, 16, 12);
      a.coAt(2, st, st.offsetWidth - 20, 0);
      a.co(3, 340, 760);
    },
  },
  {
    id: 'N3', title: '断网和维护', from: '玩着的时候断网；或服务器维护',
    query: MAIN,
    notes: ['顶部城市名旁一个断线图标', '服务器维护时顶部一条“维护中，预计 HH:MM 结束”', '要联网的按钮置灰并带同一个断线图标（这里是看视频领钱）；本地能做的照常', '恢复后自动同步，不弹窗；本地算的钱换成服务端的数时按秒平滑跳过去'],
    draw(a) {
      base(a, { hud: { offline: true, mail: 2 }, dock: { offline: true } });
      const mt = a.add('<div class="maint" style="right:60px">🛠️ 维护中，预计 03:00 结束</div>');
      const c = a.panel('card', '<span class="emo">💰</span> 每小时 +¥1,250', `<div class="row" style="justify-content:center;color:#7a5a30;font-weight:800">现在连不上服务器</div>${a.btn(`${ICON.offline} 看视频领 ¥3,600`, 'gray wide off')}`, 'top:186px');
      a.coAt(1, document.querySelector('.nameplate .offn'), 34, 10);
      a.coAt(2, mt, 10, 4);
      a.coAt(3, c.querySelector('.btn'), 10, 6);
      a.co(4, 195, 480);
    },
  },
  {
    id: 'S1', title: '空状态（几处拼在一张图上）', from: '各页面没有内容时',
    map: false,
    notes: ['没有好友：地区地图底部一排头像的位置放“＋ 邀请好友”', '没有历史城市：J1 下半放一张小插画', '站内信空：小插画', '全国只有一个地区：只画这一个，别处是雾；你的位置用金框标出', 'F2 没有任何服务：全城橙色，图例照常', '1 级的 C3：只有一星一行；空图表不画（C1 见 C1a）'],
    draw(a) {
      a.add('<div class="screen"></div>');
      const box = (x, y, w, h, title, inner) => a.add(`<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:14px;border:2px solid #4d7f8f;background:rgba(255,255,255,.05);overflow:hidden"><div style="padding:4px 10px;color:#ffd76a;font-size:12px;font-weight:900;background:#13303d">${title}</div>${inner}</div>`);
      const b1 = box(10, 100, 370, 96, '地区地图：没有好友', '<div class="friends emo" style="margin:10px"><span class="lbl">好友</span><span class="btn green small">＋ 邀请好友</span></div>');
      const b2 = box(10, 210, 180, 170, 'J1：没有历史城市', '<div class="illus"><span class="pic emo">🏞️</span>还没有结束过的城市</div>');
      const b3 = box(200, 210, 180, 170, '站内信：空', '<div class="illus"><span class="pic emo">📭</span>信都处理完了</div>');
      // 共用的小地区图在你的位置上另画一个红点；红点只留给待处理，这里只留金框。
      const svg = regionSvg({ cw: 20, ox: 90, oy: 20, mini: true, me: [1, 1] }).svg.replace(/<circle[^>]*fill="#d2473a"[^>]*\/>/, '');
      const b4 = box(10, 394, 180, 190, '全国：只有一个地区', `<svg viewBox="0 0 180 160" width="180" height="160"><defs><radialGradient id="fog"><stop offset="40%" stop-color="#cfd8dc" stop-opacity="0"/><stop offset="100%" stop-color="#e8eef0"/></radialGradient></defs><rect width="180" height="160" fill="#dfe6e8"/><g transform="translate(0,30)">${svg}</g><rect width="180" height="160" fill="url(#fog)"/></svg>`);
      const b5 = box(200, 394, 180, 190, 'F2：没有任何服务', `<div style="position:relative;height:166px">${thumb('position:absolute;inset:0;height:auto;border:0;border-radius:0;filter:grayscale(.6)')}<div style="position:absolute;inset:0;background:rgba(240,138,36,.55)"></div><div class="legend" style="left:6px;bottom:6px;padding:4px 6px"><i style="background:#3fa75a;width:16px"></i><i style="background:#f2c94c;width:16px"></i><i style="background:#f08a24;width:16px"></i></div></div>`);
      const b6 = box(10, 598, 370, 150, 'C3：1 级', '<div class="panel" style="position:relative;margin:8px;padding:8px 10px"><div class="row" style="margin:2px 0"><span class="emo">👥 64</span></div><div class="row"><span class="stars" style="width:30px">★</span><div style="flex:1;display:grid;gap:4px"><div class="duo emo"><span>👥</span><i style="width:60%;background:#e07a3f"></i></div><div class="duo emo"><span>💼</span><i style="width:48%;background:#3b5ba9"></i></div></div></div></div>');
      [b1, b2, b3, b4, b5, b6].forEach((b, i) => a.coAt(i + 1, b, b.offsetWidth - 16, 12));
    },
  },
  {
    id: 'S2', title: '名字被判违规', from: '城市名或昵称事后被判违规（同步时服务端告知）；排在 K1、B2 之后',
    query: MAIN,
    notes: ['改好之前城市名显示“某某的城市”（用头像动物名）', '必须改名的卡片，沿用 A2 的输入卡片；没有关闭按钮，点外面也关不掉', '这次改名免费，不占 30 天的改名间隔', '提交后同样过内容安全检查；不通过时描红（A2 的样子）'],
    draw(a) {
      base(a, { hud: { name: '考拉的城市' } });
      a.add('<div class="dim"></div>');
      const box = a.panel('', '城市名要改一下', `<div style="font-size:14px;color:#5a3a12;margin-bottom:8px">原来的名字没通过检查，换一个吧</div><div style="display:flex;gap:8px;margin:6px 0 4px"><div class="namebox" style="color:#b0a080;font-weight:700;font-size:18px">输入新名字<span class="caret"></span></div><div class="sq emo" style="width:52px;height:52px;font-size:28px">🎲</div></div><div style="text-align:right;font-size:12px;color:#7a5a30;margin:0 0 10px">0 / 12</div>${a.btn('免费改名', 'green wide')}`, 'left:16px;right:16px;top:260px');
      a.coAt(1, document.querySelector('.nameplate b'), 60, 30);
      a.coAt(2, box, box.offsetWidth - 20, 14);
      a.coAt(3, box.querySelector('.btn'), 10, 6);
      a.coAt(4, box.querySelector('.namebox'), 10, 6);
    },
  },
  {
    id: 'S3', title: '邀请好友', from: 'I1 点紧挨你的空位上的 ＋',
    map: false,
    notes: ['微信分享卡片：谁邀请、来做邻居，配一张城市图；点卡片打开游戏', '收到的人跳过位置预览，直接到取名（A2）；A2 顶部一行“你在〈邀请人〉旁边”。位置被占了时，顶部换成 A1b 那句话', '空位已经留给他（I1b），剩几天写在地区地图上'],
    draw(a) {
      a.chrome({ hide: true });
      a.add('<div style="position:absolute;inset:0;background:#ededed"></div>');
      wxStatusBar(a);
      a.add('<div style="position:absolute;left:0;right:0;top:47px;height:48px;display:flex;align-items:center;justify-content:center;font:600 17px/1 sans-serif;color:#111;border-bottom:1px solid #d6d6d6">小兔</div>');
      const card = a.add(`<div style="position:absolute;right:66px;top:130px;width:230px;background:#fff;border-radius:8px;padding:10px;box-shadow:0 1px 2px rgba(0,0,0,.1);font-family:sans-serif"><div class="emo" style="font-size:15px;color:#111;margin-bottom:8px">${ME.av} ${ME.name}邀请你来做邻居</div>${thumb('height:150px;border-radius:4px;border:0;background-size:160%')}<div style="font-size:12px;color:#888;margin-top:8px;border-top:1px solid #eee;padding-top:6px">◎ 城市首席规划师</div></div>`);
      a.add(`<div class="emo" style="position:absolute;right:14px;top:130px;width:42px;height:42px;border-radius:6px;background:#f6dd8c;display:grid;place-items:center;font-size:26px">${ME.av}</div>`);
      const inset = a.add(`<div class="states" style="left:20px;right:20px;top:470px;background:radial-gradient(circle at 50% 0%,#2f6f86,#12303c 70%)"><span class="lbl">收到的人点开以后：A2 的顶部</span><div class="toast emo" style="position:static;transform:none;display:inline-block;margin:4px 0 10px;background:rgba(63,167,90,.9)">你在 ${ME.av} ${ME.name} 旁边</div><div class="panel" style="position:relative;padding:10px"><div class="head" style="margin:-10px -10px 8px">你的城市叫什么？</div><div style="display:flex;gap:8px"><div class="namebox" style="height:44px;font-size:18px">小兔镇<span class="caret"></span></div><div class="sq emo" style="width:44px;height:44px">🎲</div></div></div></div>`);
      a.add('<div style="position:absolute;left:0;right:0;bottom:0;height:90px;padding:10px 12px 0;background:#f7f7f7;border-top:1px solid #ddd;display:flex;gap:10px;align-items:flex-start"><span style="width:30px;height:30px;border-radius:50%;border:1.5px solid #333"></span><span style="flex:1;height:36px;border-radius:6px;background:#fff"></span><span style="width:30px;height:30px;border-radius:50%;border:1.5px solid #333"></span></div>');
      a.coAt(1, card, 10, 10);
      a.coAt(2, inset.querySelector('.toast'), 10, 4);
      a.coAt(3, inset, inset.offsetWidth - 20, 0);
    },
  },
  {
    id: 'S4', title: '等待和失败（通用的样子）', from: '要等服务端的整屏和按钮：地区、全国、站内信、参观、领取、修接线头等',
    map: false,
    notes: ['整屏先画骨架（灰色的块），不弹窗', '超过 1 秒还没来，中间出转圈', '失败：中间一个断线图标加“重试”；10 秒没有回应按失败处理', '按钮点下变转圈，不能再点', '按钮失败：抖一下回原样，旁边一个图标说明原因（断线、被拒的原因图标）'],
    draw(a) {
      a.add('<div class="screen"><div class="top"><div class="back">‹</div><div class="title emo">✉️ 站内信</div></div><div class="tabs"><div class="on">待处理</div><div>通知</div></div><div class="body" id="sb"></div></div>');
      document.getElementById('sb').innerHTML = [0, 1, 2].map(() => '<div style="display:grid;grid-template-columns:46px 1fr;gap:8px 10px;padding:10px 12px;margin-bottom:8px;border-radius:12px;background:rgba(255,255,255,.06)"><div class="skel" style="grid-row:span 2;height:46px"></div><div class="skel" style="height:16px;width:70%"></div><div class="skel" style="height:12px;width:45%"></div></div>').join('');
      const sp = a.add('<div style="position:absolute;left:50%;top:330px;transform:translateX(-50%);color:#ffd76a"><span class="spin big"></span></div>');
      const st = states(a, '失败和按钮', [
        ['整屏失败', `<span style="font-size:22px;color:#cfe6ee">${ICON.offline}</span>${a.btn('重试', 'green small')}`],
        ['点下', a.btn(`${ICON.spinner} 领取`, 'green small')],
        ['失败', `<span style="display:inline-flex;transform:translateX(-4px)">${a.btn('领取', 'green small')}</span><span style="color:#ffb3a8;font-size:20px">${ICON.offline}</span><span style="color:#cfe6ee">抖一下回原样</span>`],
      ], 'left:20px;right:20px;top:470px');
      const rows = st.querySelectorAll('.st');
      a.co(1, 40, 210);
      a.coAt(2, sp, 50, 10);
      a.coAt(3, rows[0], rows[0].offsetWidth - 10, 8);
      a.coAt(4, rows[1], rows[1].offsetWidth - 10, 8);
      a.coAt(5, rows[2], rows[2].offsetWidth - 10, 8);
    },
  },
  {
    id: 'K2', title: '结束确认', from: 'C5 满级点“开新城”；J2 点“结束这座城市”',
    map: false,
    notes: ['左上返回：回到来的地方，什么都不改', '这座城市的缩略图，旁边一块 Lv1 的空地：新城从 1 级开始', '只有名字牌跟过去；等级和资金的图标划掉', '红色按钮按住约 1 秒（按住时有进度），然后看一次视频；视频没看完按钮回原样', '广告不可用时按住就结束，不限次数（虚线框）', '结束后这座城市进历史城市，去 K1'],
    draw(a) {
      a.add('<div class="screen"><div class="top"><div class="back">‹</div><div class="title emo">🏚️ 结束这座城市</div></div><div class="body" id="sb"></div></div>');
      document.getElementById('sb').innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-top:20px"><div class="citycard" style="flex:1">${thumb('height:120px')}<b>${ME.name}</b><small>Lv4 · 8,450 人</small></div><div style="color:#ffd76a;font-size:28px;font-weight:900">→</div><div class="citycard" style="flex:1"><div class="thumb" style="height:120px;background:linear-gradient(160deg,#b3d48b 0 55%,#3d8fc4 55% 62%,#a7cf8f 62%)"></div><b>新城</b><small>Lv1 · 空地</small></div></div><div class="panel" style="position:relative;margin-top:20px"><div style="font-weight:900;color:var(--brown);font-size:15px;margin-bottom:10px">带到新城的</div><div style="display:flex;gap:18px;align-items:center;justify-content:center;font-size:15px;font-weight:900"><span class="chipcity" style="font-size:15px;padding:6px 10px">🏷️ ${ME.name} ✓</span><span class="xout emo" style="font-size:26px">🏅</span><span class="xout emo" style="font-size:26px">🪙</span></div></div>`;
      const hold = a.add(`<div style="position:absolute;left:24px;right:24px;bottom:calc(var(--sab) + 150px);text-align:center"><span class="btn red wide hold" style="min-height:58px;font-size:17px"><i class="fill" style="width:45%"></i><span><span class="vid">▶</span> 按住结束</span></span><div style="color:#cfe6ee;font-size:13px;margin-top:8px">按住约 1 秒，再看一次视频</div></div>`);
      const st = states(a, '广告不可用时', [['', '<span class="btn red small">按住结束</span><span style="color:#cfe6ee">按住就结束，不限次数</span>']], 'left:24px;right:24px;bottom:calc(var(--sab) + 30px)');
      const cards = document.querySelectorAll('.citycard');
      a.coAt(1, document.querySelector('.back'), 0, 40);
      a.coAt(2, cards[1], cards[1].offsetWidth - 16, 14);
      a.coAt(3, document.querySelector('.xout'), 40, 0);
      a.coAt(4, hold.querySelector('.btn'), 10, 6);
      a.coAt(5, st, st.offsetWidth - 20, 0);
      a.coAt(6, hold.lastElementChild, hold.lastElementChild.offsetWidth - 20, 4);
    },
  },
];
