// 各组效果图共用的机位、示例数据和几样常画的东西。
// 底图是美术探针的 64 格城市（正式地图是 256 格）：环形高速沿北边和西边，河从西向东穿过城市南部
// （x=20 处河在 y=50 到 53，x=30 处在 47 到 49，x=40 处在 45 到 47）。
// 示例数据前后一致：玩家的城市“青川市”在“临江地区”（4×4 共 16 个位置），地区名和城市名不重名，头像都是系统动物头像。
export const q = ({ zoom = 0.32, x = 36, y = 38, view = '', t = 12, extra = '' } = {}) =>
  `n=64&controls=0&warm=240&icons=1&zoom=${zoom}&x=${x}&y=${y}&t=${t}${view ? `&view=${view}` : ''}${extra}`;
export const MAIN = q();
/** 只有地形、没有路和楼的底图：开局预览和 1 级空城用。 */
export const BARE = (opts = {}) => q({ ...opts, extra: `&cars=0&icons=0&seam=1&backdrop=%23b9d3dc${opts.extra ?? ''}` });
export const NB = {
  e: { name: '北岭', av: '🐻' },
  s: { name: '江屿市', av: '🦊' },
  n: { name: '云港市', av: '🐧' },
  w: { name: '桃溪', av: '🐯' },
};
export const ME = { name: '青川市', av: '🐨', region: '临江地区', climate: '🌤️ 温和' };
export const scrimNote = '点小卡外面的地图：只关掉小卡，回到主界面；这一下不会点到地图上的东西';

export function base(a, opts = {}) {
  a.hud(opts.hud);
  a.dock(opts.dock);
}

/** 工地：斜纹地块加一个进度环，返回进度环的屏幕位置。 */
export function site(a, p, progress = 0.6) {
  a.svg(a.parcelShape(p, 'fill="url(#hatch)" fill-opacity=".85" stroke="#7a5a10" stroke-width="2"'));
  const [cx, cy] = a.P(p.px, p.py);
  const r = 16;
  const len = 2 * Math.PI * r;
  a.svg(`<circle cx="${cx}" cy="${cy - 18}" r="${r}" fill="rgba(13,36,46,.85)" stroke="#e9c46a" stroke-width="2"/><circle cx="${cx}" cy="${cy - 18}" r="${r - 4}" fill="none" stroke="#7ee08a" stroke-width="5" stroke-dasharray="${len * progress * 0.75} ${len}" transform="rotate(-90 ${cx} ${cy - 18})"/><text x="${cx}" y="${cy - 13}" text-anchor="middle" font-size="14">🏗️</text>`);
  return [cx, cy - 18];
}

export const built = (p) => p.level >= 2;
export const circleIcon = (e, col) => `<span class="emo" style="display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#fff;border:2px solid ${col};font-size:16px">${e}</span>`;

/** 每栋楼里一个淡色粗扁箭头，指向离它最近的路。 */
export function entranceArrows(a) {
  for (const p of a.parcels.filter((x) => x.zone >= 1 && x.zone <= 3)) {
    const r = a.roadNear(p.px, p.py);
    if (!r) continue;
    let dx = r[0] + 0.5 - p.px;
    let dy = r[1] + 0.5 - p.py;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    const tip = [p.px + dx * 0.75, p.py + dy * 0.75];
    const l = [p.px - dx * 0.3 - dy * 0.55, p.py - dy * 0.3 + dx * 0.55];
    const rr = [p.px - dx * 0.3 + dy * 0.55, p.py - dy * 0.3 - dx * 0.55];
    a.svg(a.poly([tip, l, rr], 'fill="rgba(255,255,255,.55)" stroke="rgba(19,48,61,.35)" stroke-width="1.2"'));
  }
}

/** 线头期限的小签：金色光环 + 天数；最后一天写小时、变橙。 */
export const ddl = (text, last = false) => `<span class="ddl ${last ? 'last' : ''}">${text}</span>`;

/** 标注用的“几种状态”虚线框，放在画面上方便一张图说清几种样子。 */
export function states(a, title, rows, style) {
  return a.add(`<div class="states" style="${style}"><span class="lbl">${title}</span>${rows.map(([k, v]) => `<div class="st">${k ? `<em>${k}</em>` : ''}${v}</div>`).join('')}</div>`);
}

/** 低多边形的方块楼：footprint 是格子坐标，h 是屏幕上的高度（像素）。只画看得见的顶面和两个侧面。 */
export function isoBox(a, x, y, w, d, h, [top, left, right]) {
  const c = [[x, y], [x + w, y], [x + w, y + d], [x, y + d]].map(([gx, gy]) => a.P(gx, gy));
  const up = c.map(([sx, sy]) => [sx, sy - h]);
  const pt = (list) => list.map((v) => v.map((n) => n.toFixed(1)).join(',')).join(' ');
  a.svg(`<polygon points="${pt([c[3], c[2], up[2], up[3]])}" fill="${left}" stroke="rgba(0,0,0,.25)" stroke-width=".8"/><polygon points="${pt([c[1], c[2], up[2], up[1]])}" fill="${right}" stroke="rgba(0,0,0,.25)" stroke-width=".8"/><polygon points="${pt(up)}" fill="${top}" stroke="rgba(0,0,0,.25)" stroke-width=".8"/>`);
}

/** 一段直路：从 (x0, y0) 到 (x1, y1) 的格子，宽一格，中间一条白虚线；ghost 为真时画成虚影。 */
export function isoRoad(a, x0, y0, x1, y1, ghost = false) {
  const xa = Math.min(x0, x1);
  const xb = Math.max(x0, x1) + 1;
  const ya = Math.min(y0, y1);
  const yb = Math.max(y0, y1) + 1;
  const fill = ghost ? 'fill="rgba(255,255,255,.35)" stroke="#fff3a8" stroke-width="2.5" stroke-dasharray="8 6"' : 'fill="#8b9196" stroke="#5f666b" stroke-width="1"';
  a.svg(a.poly([[xa, ya], [xb, ya], [xb, yb], [xa, yb]], fill));
  const mid = x0 === x1 ? [[x0 + 0.5, ya], [x0 + 0.5, yb]] : [[xa, y0 + 0.5], [xb, y0 + 0.5]];
  if (!ghost) a.svg(a.line(mid, 'stroke="#f4f4ee" stroke-width="1.5" stroke-dasharray="5 5"'));
}

const HOUSE = ['#b7e4a5', '#7fbf6a', '#5f9e50'];
const SHOP = ['#a9cdf2', '#6fa3dc', '#4d7fb8'];
const FACTORY = ['#f3d98a', '#d9b44a', '#b48f2c'];
/**
 * 1 级的空城，在河北岸：第一批路、几栋一星住宅和商店、一座工厂、挨着河的水厂和电厂。
 * stage 控制画到哪一步：0 什么都没有，1 有路，2 加水厂电厂，3 加分区，4 楼长出来。
 */
export function earlyCity(a, stage = 4) {
  if (stage >= 1) {
    isoRoad(a, 16, 41, 42, 41);
    isoRoad(a, 30, 33, 30, 40);
    isoRoad(a, 23, 42, 23, 46);
  }
  if (stage >= 2) {
    isoBox(a, 22, 47.2, 2.4, 1.6, 16, ['#cfe8f2', '#8fbfd4', '#6a9fb8']);
    a.label(23.2, 48, '<span class="emo" style="font-size:16px">💧</span>');
    isoBox(a, 37, 42.4, 2, 1.6, 22, ['#d9d9d9', '#a8a8a8', '#8a8a8a']);
    a.label(38, 43.2, '<span class="emo" style="font-size:16px">⚡</span>');
  }
  if (stage >= 3) {
    for (const [x, y, w, d, col] of [[17.8, 38.2, 11, 2.6, 'rgba(92,184,92,.35)'], [31.2, 38.2, 6.4, 2.6, 'rgba(92,184,92,.35)'], [31.2, 42.2, 5, 2, 'rgba(232,185,35,.4)']]) a.svg(a.poly([[x, y], [x + w, y], [x + w, y + d], [x, y + d]], `fill="${col}" stroke="rgba(255,255,255,.7)" stroke-width="1.2"`));
  }
  if (stage >= 4) {
    for (const x of [18.4, 20.6, 22.8, 25, 27.2]) isoBox(a, x, 38.9, 1.5, 1.5, 12, HOUSE);
    for (const x of [31.5, 33.7, 35.9]) isoBox(a, x, 38.9, 1.5, 1.5, 14, x > 35 ? SHOP : HOUSE);
    isoBox(a, 31.6, 42.4, 2.6, 1.5, 14, FACTORY);
  }
}

/** 地区的 4×4 个位置。c 往东、r 往南；青川市在 (1, 1)，四个邻居和 NB 对得上。 */
export const SLOTS = [
  { c: 1, r: 1, name: '青川市', lv: 4, me: true },
  { c: 2, r: 1, name: '北岭', lv: 8, av: '🐻', friend: true },
  { c: 1, r: 2, name: '江屿市', lv: 3, av: '🦊' },
  { c: 1, r: 0, name: '云港市', lv: 5, av: '🐧' },
  { c: 0, r: 1, name: '桃溪', lv: 6, av: '🐯' },
  { c: 3, r: 0, name: '石门', lv: 7, av: '🐺' },
  { c: 3, r: 1, name: '白沙', lv: 3, av: '🦉' },
  { c: 2, r: 3, name: '鹿鸣', lv: 8, av: '🐼', friend: true },
  { c: 3, r: 2, name: '柳岸', lv: 2, av: '🐸' },
  { c: 0, r: 3, name: '长汀', lv: 5, av: '🐮' },
];
/** 紧挨青川市（含斜角）的空位：邀请好友的 ＋ 画在这里。 */
export const EMPTY_NEAR = [[0, 0], [2, 0], [2, 2], [0, 2]];

/**
 * 画一张地区地图（SVG 字符串）：中间 4×4 是本地区，外面一圈是邻近地区，淡一些。
 * cw 是一个位置菱形的半宽（像素），原点 (ox, oy) 是 (0, 0) 位置的上顶点。
 * 返回 svg 字符串和把位置换成屏幕坐标的函数 at(c, r)（位置中心）。
 */
export function regionSvg({ cw = 50, ox = 195, oy = 60, mini = false, me = [1, 1], dim = [] } = {}) {
  const ch = cw / 2;
  const iso = (c, r) => [ox + (c - r) * cw, oy + (c + r) * ch];
  const at = (c, r) => { const [x, y] = iso(c, r); return [x, y + ch]; };
  const dia = (c, r) => { const [x, y] = iso(c, r); return `${x},${y} ${x + cw},${y + ch} ${x},${y + 2 * ch} ${x - cw},${y + ch}`; };
  let s = '';
  const lo = mini ? 0 : -2;
  const hi = mini ? 4 : 6;
  for (let r = lo; r < hi; r += 1) for (let c = lo; c < hi; c += 1) {
    const inside = c >= 0 && r >= 0 && c < 4 && r < 4;
    const sea = c >= 4 && r >= 2;
    const hill = (c <= 0 && r <= 0) || (c === 3 && r === 0);
    const forest = (c === 0 && r === 3) || (c === 3 && r === 2);
    const fill = sea ? '#78b9d8' : hill ? '#a7c486' : forest ? '#8cbf78' : (c + r) % 2 ? '#bfdc98' : '#b3d48b';
    s += `<polygon points="${dia(c, r)}" fill="${fill}" stroke="${inside ? '#86a96b' : '#a9c48f'}" stroke-width="1" opacity="${inside ? 1 : 0.45}"/>`;
  }
  const edge = [iso(0, 0), iso(4, 0), iso(4, 4), iso(0, 4)].map(([x, y]) => `${x},${y}`).join(' ');
  if (!mini) s += `<polygon points="${edge}" fill="none" stroke="#fff3c4" stroke-width="3" stroke-dasharray="10 6"/>`;
  const riv = [[-1.5, 1.4], [0.3, 1.6], [1.2, 2.2], [2.1, 2.6], [3.2, 2.4], [4.4, 2.8]].map(([c, r]) => iso(c, r).map((v, i) => v + (i ? ch : 0)).join(',')).join(' ');
  s += `<polyline points="${riv}" fill="none" stroke="#3d8fc4" stroke-width="${mini ? 3 : 7}" stroke-linejoin="round" stroke-linecap="round"/>`;
  if (mini) {
    for (const { c, r } of SLOTS) { const [x, y] = at(c, r); s += `<rect x="${x - 4}" y="${y - 5}" width="8" height="7" fill="#e7e2d6" stroke="#8a8270" stroke-width=".8"/>`; }
    const [mx, my] = at(...me);
    s += `<polygon points="${dia(...me)}" fill="rgba(255,215,106,.55)" stroke="#ffd76a" stroke-width="2.5"/><circle cx="${mx}" cy="${my}" r="4" fill="#d2473a" stroke="#fff" stroke-width="1.5"/>`;
    return { svg: s, at, iso };
  }
  for (const [c1, r1, c2, r2, col, w] of [[1, 1, 2, 1, '#7f8682', 5], [1, 1, 1, 0, '#7a5a3a', 4], [1, 1, 1, 2, '#7f8682', 5], [2, 1, 3, 1, '#7f8682', 5], [3, 0, 3, 1, '#7a5a3a', 4]]) {
    const [x1, y1] = at(c1, r1);
    const [x2, y2] = at(c2, r2);
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${w}" stroke-linecap="round" ${col === '#7a5a3a' ? 'stroke-dasharray="7 4"' : ''}/>`;
  }
  for (const { c, r, name, lv, me: mine, av } of SLOTS) {
    const [x, y] = at(c, r);
    const hgt = 8 + lv * 3;
    const col = mine ? ['#5fb3c9', '#2a7f95', '#1d6577'] : dim.includes(name) ? ['#c9c9c9', '#a5a5a5', '#8c8c8c'] : ['#f2ede0', '#cfc6b0', '#b3aa94'];
    if (mine) s += `<polygon points="${dia(c, r)}" fill="rgba(255,215,106,.35)" stroke="#ffd76a" stroke-width="4"/>`;
    for (const [dx, k] of [[-12, 0.6], [-3, 1], [7, 0.75], [15, 0.45]]) {
      const h = hgt * k;
      const bx = x + dx;
      s += `<polygon points="${bx - 4},${y - h} ${bx},${y - h - 2.5} ${bx + 4},${y - h} ${bx + 4},${y + 2} ${bx},${y + 4} ${bx - 4},${y + 2}" fill="${col[0]}" stroke="${col[2]}" stroke-width=".8"/><polygon points="${bx},${y - h - 2.5} ${bx + 4},${y - h} ${bx + 4},${y + 2} ${bx},${y + 4}" fill="${col[1]}"/>`;
    }
    s += `<text x="${x}" y="${y + 20}" text-anchor="middle" font-size="13" font-weight="900" fill="#13303d" stroke="#fff" stroke-width="3" paint-order="stroke">${name}</text>`;
    if (av) s += `<circle cx="${x + 22}" cy="${y - hgt - 2}" r="11" fill="#f6dd8c" stroke="#5a3a0c" stroke-width="1.5"/><text x="${x + 22}" y="${y - hgt + 3}" text-anchor="middle" font-size="13">${av}</text>`;
  }
  return { svg: s, at, iso, dia };
}

/** 胶囊下方靠右的地区小缩略图（4×4），标出这块位置在哪。 */
export function regionMini(a, me = [1, 1], top = 98) {
  const { svg } = regionSvg({ cw: 13, ox: 56, oy: 6, mini: true, me });
  return a.add(`<div style="position:absolute;right:8px;top:${top}px;width:112px;padding:4px 0 2px;border-radius:12px;background:rgba(13,36,46,.85);border:1.5px solid var(--gold);text-align:center"><svg viewBox="0 0 112 64" width="112" height="64">${svg}</svg><div style="color:#ffeab0;font-size:12px;font-weight:800">${ME.region}</div></div>`);
}

/** 用美术探针整城截图做的缩略图（城市卡片、参观缩略图）。 */
export const thumb = (style = '', cls = '') => `<div class="thumb thumbimg ${cls}" style="${style}"></div>`;
