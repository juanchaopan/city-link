// 建造、点地图、视图、邻居几组效果图共用的小部件：建造模式和视图的顶条、确认按钮、灰色的邻居画面、
// 边界接口和它的小签、贴在图上的几种状态的小样。
// 顶部三行：第一行在胶囊左边（.modebar：返回和工具名），第二行是资金（建造模式）或分项（视图），
// 建造模式里的密度、需求条这类小按钮放第三行。
import { ICON } from './api.js';
import { NB, ddl } from './screens-common.js';

/** 第二行的上沿（状态栏 47 + 第一行 52）：建造模式放资金，视图放分项。 */
export const ROW2 = 99;
/** 第三行的上沿：建造模式里资金下面的密度、模板这类小按钮。 */
export const ROW3 = 147;

/**
 * 建造模式和视图的顶条：左上返回、工具名（点了换工具）。
 * 建造模式顶部只留资金一格，画在第二行（和 B4 等画面同一个位置）；视图不放资金（money: null）。
 */
export function modeTop(a, { icon, name, drop = true, money = '48,203', neg = false } = {}) {
  const bar = a.add(`<div class="modebar" style="flex-wrap:nowrap"><div class="back">‹</div><div class="title emo" style="min-width:0">${icon} ${name}${drop ? ' <span style="font-size:11px">▾</span>' : ''}</div></div>`);
  if (money !== null) a.hud({ only: 'money', money, neg });
  const caps = document.querySelectorAll('.res .cap.money');
  return { bar, back: bar.querySelector('.back'), title: bar.querySelector('.title'), money: money === null ? null : caps[caps.length - 1] };
}
/** 标注放在返回按钮右下，不盖住按钮。 */
export const coBack = (a, n, top) => a.coAt(n, top.back, top.back.offsetWidth + 6, top.back.offsetHeight + 4);

/** 顶条下面的一行小按钮：视图的分项放第二行，建造模式的密度放第三行。 */
export const row2 = (a, html, top = ROW2) => a.add(`<div class="emo" style="position:absolute;left:8px;right:8px;top:${top}px;display:flex;gap:6px;align-items:center">${html}</div>`);
/** 分项按钮：图标是圆的，写字的（“全部”“低”）是胶囊形。 */
const hasText = (s) => /[一-鿿]/.test(s);
export const subBtn = (html, { on = false, lock = 0 } = {}) => {
  const txt = hasText(html);
  return `<div class="sub ${on ? 'on' : ''} ${txt ? 'txt' : ''}" style="${lock ? 'filter:grayscale(1);opacity:.6' : ''}">${lock ? `🔒${txt ? html : ''}` : html}</div>`;
};

export const confirm = (a, { ok = true } = {}) => a.add(`<div class="confirm"><div class="no">✕</div><div class="ok ${ok ? '' : 'dis'}">✓</div></div>`);

/** 价格气泡：贴在格子上的点，默认在点的上方，左右不出屏幕。 */
export function price(a, x, y, html, { dx = 0, dy = 0, below = false } = {}) {
  const [sx, sy] = a.P(x, y);
  const el = a.add(`<div class="price emo" style="left:${sx + dx}px;top:${sy + dy}px;${below ? 'transform:translate(-50%,14px)' : ''}">${html}</div>`);
  const r = el.getBoundingClientRect();
  if (r.left < 8) el.style.left = `${sx + dx + 8 - r.left}px`;
  if (r.right > a.W - 8) el.style.left = `${sx + dx - (r.right - a.W + 8)}px`;
  return el;
}

/** 浮在地图上的小签，以 (sx, sy) 为左边中点（anchor 可改成 right、center），左右不出屏幕。 */
export function chip(a, sx, sy, html, { anchor = 'left', style = '' } = {}) {
  const el = a.add(`<div class="emo" style="position:absolute;left:${sx}px;top:${sy}px;display:flex;align-items:center;gap:4px;${style}">${html}</div>`);
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const left = anchor === 'right' ? sx - w : anchor === 'center' ? sx - w / 2 : sx;
  el.style.left = `${Math.max(6, Math.min(a.W - w - 6, left))}px`;
  el.style.top = `${sy - h / 2}px`;
  return el;
}
/** 线头期限的小签：金色光环 + 天数；最后一天写小时、变橙。 */
export const deadline = (a, sx, sy, text, opts = {}) => chip(a, sx, sy, ddl(text, opts.last), opts);
/** 深青底的一般小签。 */
export const navyTag = (a, sx, sy, html, opts = {}) => chip(a, sx, sy, `<span class="cap emo" style="padding:0 10px;height:26px;font-size:13px">${html}</span>`, opts);

/** 邻居那一侧的灰色画面：只有地形、河、铁路、高速公路。side 是 e、w、n、s；blank 是没人的空白位置。 */
function greyDefs(a) {
  if (document.getElementById('gcity')) return;
  a.svg('<defs><pattern id="gcity" width="18" height="12" patternUnits="userSpaceOnUse"><rect width="18" height="12" fill="#c3c8c4"/><rect x="2" y="2" width="7" height="6" fill="#a9aeaa"/><rect x="11" y="5" width="5" height="5" fill="#b4b9b5"/></pattern><pattern id="gfog" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#d3dccd"/><circle cx="3" cy="3" r="1.2" fill="#bcc8b6"/></pattern></defs>');
}
const SIDE = {
  e: (N, d) => [[N, -d], [N + d, -d], [N + d, N + d], [N, N + d]],
  w: (N, d) => [[-d, -d], [0, -d], [0, N + d], [-d, N + d]],
  n: (N, d) => [[0, -d], [N, -d], [N, 0], [0, 0]],
  s: (N, d) => [[0, N], [N, N], [N, N + d], [0, N + d]],
};
export function grey(a, side, { blank = false, lines = [] } = {}) {
  greyDefs(a);
  a.svg(a.poly(SIDE[side](a.N, 60), `fill="url(#${blank ? 'gfog' : 'gcity'})" stroke="#8a908c" stroke-width="2"`));
  for (const { kind, pts } of lines) {
    if (kind === 'river') a.svg(a.line(pts, 'stroke="#9fb4bf" stroke-width="16" stroke-linecap="round"'));
    if (kind === 'highway') a.svg(a.line(pts, 'stroke="#7f8581" stroke-width="10" stroke-linecap="round"'));
    if (kind === 'rail') a.svg(a.line(pts, 'stroke="#6b706c" stroke-width="6"') + a.line(pts, 'stroke="#dfe2de" stroke-width="2" stroke-dasharray="2 5"'));
  }
}

/** 邻居的名字和头像，放在这条边中点的外侧；靠近屏幕边时往里挪，不被裁掉。 */
const MID = { e: (N) => [N + 3, N / 2], w: (N) => [-3, N / 2], n: (N) => [N / 2, -3], s: (N) => [N / 2, N + 3] };
export function edgeName(a, side, { name, av, extra = '', blank = false, at } = {}) {
  const [x, y] = at ?? MID[side](a.N);
  const html = blank
    ? '<span class="cap" style="padding:0 12px;height:30px;background:rgba(90,100,96,.85);border-color:#ccc;color:#eee">空白</span>'
    : `<span class="cap emo" style="padding:0 12px 0 34px;height:30px"><span class="ic">${av}</span>${name}${extra}</span>`;
  const el = a.label(x, y, html);
  const r = el.getBoundingClientRect();
  const left = parseFloat(el.style.left);
  if (r.left < 10) el.style.left = `${left + 10 - r.left}px`;
  else if (r.right > a.W - 10) el.style.left = `${left - (r.right - a.W + 10)}px`;
  return el;
}
export const nbName = (a, side, k, opts = {}) => edgeName(a, side, { ...NB[k], ...opts });

/**
 * 边界接口。st：ok 两边接好（绿实线）、mine 你修出去等对方（灰虚线，配“⋯”）、blank 对着空白（灰虚线）、
 * theirs 对着你、期限在走（金色光环往外扩）、wait 期限没开始（金环不扩）、frozen 已开工（金环停住加进度环）。
 * 点击区 44 px：hit 时把它画出来。
 */
export function port(a, x, y, e, st, { hit = false, progress = 0.4, r = 16 } = {}) {
  const [sx, sy] = a.P(x, y);
  let s = '';
  if (hit) s += `<circle cx="${sx}" cy="${sy}" r="22" fill="rgba(255,255,255,.22)" stroke="rgba(255,255,255,.7)" stroke-width="1.2" stroke-dasharray="2 3"/>`;
  if (st === 'theirs') s += `<circle cx="${sx}" cy="${sy}" r="${r + 9}" fill="none" stroke="#f2b62f" stroke-width="4" opacity=".75"/><circle cx="${sx}" cy="${sy}" r="${r + 19}" fill="none" stroke="#f2b62f" stroke-width="3" opacity=".35"/>`;
  if (st === 'wait' || st === 'frozen') s += `<circle cx="${sx}" cy="${sy}" r="${r + 7}" fill="none" stroke="#e9c46a" stroke-width="3" opacity=".85"/>`;
  const col = { ok: '#3fa75a', mine: '#8a9a9f', blank: '#8a9a9f', theirs: '#f2b62f', wait: '#e9c46a', frozen: '#e9c46a' }[st];
  const dash = st === 'mine' || st === 'blank' ? 'stroke-dasharray="5 4"' : '';
  const fill = st === 'theirs' || st === 'wait' || st === 'frozen' ? '#fff3d1' : '#fff';
  s += `<circle cx="${sx}" cy="${sy}" r="${r}" fill="${fill}" stroke="${col}" stroke-width="3.5" ${dash}/><text x="${sx}" y="${sy + r * 0.38}" text-anchor="middle" font-size="${r}">${e}</text>`;
  if (st === 'frozen') {
    const rr = r + 7;
    const len = 2 * Math.PI * rr;
    s += `<circle cx="${sx}" cy="${sy}" r="${rr}" fill="none" stroke="#3fa75a" stroke-width="5" stroke-dasharray="${len * progress} ${len}" transform="rotate(-90 ${sx} ${sy})"/>`;
  }
  a.svg(s);
  return [sx, sy];
}

/** 人口最多的那片路网描淡金光。 */
export function goldNet(a, test = () => true) {
  for (const [id, v] of a.city.roads) {
    if (v.highway) continue;
    const x = id % a.N;
    const y = Math.floor(id / a.N);
    if (test(x, y)) a.svg(a.cellDiamond(x, y, 'fill="rgba(255,214,90,.6)" stroke="rgba(255,243,168,.8)" stroke-width="1"'));
  }
}

/** 断链图标（连不上）放在白底小圆里，贴在地图上。 */
export const BROKEN = `<span style="display:inline-grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#fff;border:2.5px solid #8a5a0c;font-size:20px;color:#5a3a12">${ICON.brokenLink}</span>`;
export const brokenAt = (a, x, y) => a.label(x, y, BROKEN);
export const OFFLINE = `<span style="display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#5b6266;color:#fff;font-size:15px">${ICON.offline}</span>`;
export const SPIN = ICON.spinner;

/** 车 + 路线：气泡右下角的小按钮，看这栋楼或这段路的车去哪。 */
export const carBtn = () => `<span class="btn blue" style="flex:none;margin-left:auto;min-width:48px;min-height:44px;padding:4px 10px;font-size:24px">${ICON.carRoute}</span>`;

/** 三档拨钮，和 C1 的税率拨钮同样式：低、正常、高各一个颜色。 */
export function tri(on = 1, labels = ['低', '正常', '高']) {
  const cols = [['#cfeefa', '#2a8fa8'], ['#d9f5cf', '#3fa75a'], ['#ffe9b0', '#d18c12']];
  return `<span class="tri" style="display:inline-flex;border-radius:12px;overflow:hidden;border:2px solid #7a5520">${labels.map((l, i) => `<span style="min-width:46px;height:34px;display:grid;place-items:center;font-weight:900;font-size:14px;${i === on ? `background:${cols[i][1]};color:#fff;box-shadow:inset 0 2px 0 rgba(255,255,255,.4)` : `background:${cols[i][0]};color:#8a7a5a`}">${l}</span>`).join('')}</span>`;
}

/** 几种状态的小样：和 states 同一种深青底、金色虚线框，不是游戏界面；body 是 HTML，mini() 画一小块格子。 */
export function inset(a, { left, top, width = 170, title, body }) {
  return a.add(`<div class="states" style="left:${left}px;top:${top}px;width:${width}px;padding:16px 8px 8px"><span class="lbl">${title}</span><div style="margin-top:2px">${body}</div></div>`);
}

/** 一小块等轴格子：cells 着色，lines 画线，icons 放字或表情；返回 SVG 字符串。 */
export function mini({ cols = 8, rows = 6, cw = 10, cells = [], lines = [], icons = [], base = '#cfe6b0', width = '100%' }) {
  const ch = cw / 2;
  const ox = rows * cw;
  const oy = 4;
  const P = (x, y) => [ox + (x - y) * cw, oy + (x + y) * ch];
  const dia = (x, y, fill, extra = '') => {
    const pts = [P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)].map((p) => p.join(',')).join(' ');
    return `<polygon points="${pts}" fill="${fill}" stroke="rgba(0,0,0,.14)" stroke-width=".6" ${extra}/>`;
  };
  let s = '';
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) s += dia(x, y, base);
  for (const [x, y, fill, extra] of cells) s += dia(x, y, fill, extra);
  for (const [pts, attrs] of lines) s += `<polyline points="${pts.map(([x, y]) => P(x, y).join(',')).join(' ')}" fill="none" ${attrs}/>`;
  for (const [x, y, e, size = 12, col = '#13303d'] of icons) {
    const [px, py] = P(x, y);
    s += `<text x="${px}" y="${py + size / 3}" text-anchor="middle" font-size="${size}" font-weight="900" fill="${col}">${e}</text>`;
  }
  const w = (cols + rows) * cw;
  const h = (cols + rows) * ch + 8;
  return `<svg viewBox="0 0 ${w} ${h}" width="${width}" style="display:block">${s}</svg>`;
}
