// 效果图的绘图工具：把格子坐标换成屏幕坐标，在地图上画着色、圆圈、路线，再拼出顶栏、底栏、气泡、面板。
export const ZONE = { R: 1, C: 2, I: 3, FARM: 4, PUBLIC: 5 };

/** 几个表情符号里没有的图标，按 ui-map 第 1 节的图标表画成小 SVG，随文字大小缩放。 */
export const ICON = {
  offline: '<svg class="ico" viewBox="0 0 24 24"><path d="M2.5 9.5a14 14 0 0 1 19 0M6 13a9 9 0 0 1 12 0M9.5 16.5a4 4 0 0 1 5 0" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="20" r="1.8" fill="currentColor"/><path d="M4 3.5l16 17" stroke="#ff6a5a" stroke-width="3" stroke-linecap="round"/></svg>',
  brokenLink: '<svg class="ico" viewBox="0 0 24 24"><path d="M10 8H7.5a4 4 0 0 0 0 8H10M14 8h2.5a4 4 0 0 1 0 8H14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M12 4v3M12 17v3M8.5 5.5l1.5 2M15.5 5.5l-1.5 2" stroke="#ff6a5a" stroke-width="2.2" stroke-linecap="round"/></svg>',
  spinner: '<span class="spin"></span>',
  carRoute: '<svg class="ico" viewBox="0 0 24 24"><path d="M3 20c4-1 4-6 9-7s5-6 9-8" fill="none" stroke="#f2b62f" stroke-width="2.4" stroke-dasharray="3 2.5" stroke-linecap="round"/><rect x="2" y="13" width="11" height="6" rx="2" fill="currentColor"/><circle cx="5" cy="19.5" r="1.6" fill="#13303d"/><circle cx="10" cy="19.5" r="1.6" fill="#13303d"/></svg>',
};

export function makeApi({ city, N, camera, screenOf, TILE_HALF_W, TILE_HALF_H }) {
  const ov = document.getElementById('ov');
  const ui = document.getElementById('ui');
  const sys = document.getElementById('sys');
  const W = window.innerWidth;
  const H = window.innerHeight;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const levelAt = (x, y) => (city && x >= 0 && y >= 0 && x < N && y < N ? city.levelOf(Math.floor(x), Math.floor(y)) : 0);

  /** 格子坐标 → 屏幕坐标（CSS 像素）。 */
  const P = (x, y, level) => {
    const { sx, sy } = screenOf(x, y, level ?? levelAt(x, y));
    return [camera.position.x + sx * camera.scale.x, camera.position.y + sy * camera.scale.y];
  };
  const pts = (list) => list.map(([x, y]) => P(x, y).map((v) => v.toFixed(1)).join(',')).join(' ');
  const parcels = city ? city.parcels.parcels.filter((p) => p.polygon) : [];
  const dist = (p, x, y) => Math.hypot(p.px - x, p.py - y);
  const near = (zone, x, y, test = () => true) => parcels.filter((p) => p.zone === zone && test(p)).sort((a, b) => dist(a, x, y) - dist(b, x, y))[0];
  const roadSet = city ? city.roads : new Set();
  const isRoad = (x, y) => x >= 0 && y >= 0 && x < N && y < N && roadSet.has(y * N + x);
  function roadNear(x, y) {
    let best = null;
    for (let r = 0; r < 12 && !best; r += 1)
      for (let dy = -r; dy <= r; dy += 1)
        for (let dx = -r; dx <= r; dx += 1)
          if (!best && isRoad(Math.round(x) + dx, Math.round(y) + dy)) best = [Math.round(x) + dx, Math.round(y) + dy];
    return best;
  }
  /** 沿路网找一条最短的路，返回格子中心点。 */
  function roadPath(from, to) {
    const a = roadNear(...from);
    const b = roadNear(...to);
    const key = ([x, y]) => y * N + x;
    const prev = new Map([[key(a), null]]);
    const queue = [a];
    while (queue.length) {
      const c = queue.shift();
      if (c[0] === b[0] && c[1] === b[1]) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = [c[0] + dx, c[1] + dy];
        if (isRoad(...n) && !prev.has(key(n))) { prev.set(key(n), c); queue.push(n); }
      }
    }
    const out = [];
    for (let c = b; c; c = prev.get(key(c))) out.push([c[0] + 0.5, c[1] + 0.5]);
    return out.reverse();
  }
  const simplify = (line) => line.filter((p, i) => i === 0 || i === line.length - 1 || (line[i - 1][0] - p[0]) * (line[i + 1][1] - p[1]) !== (line[i - 1][1] - p[1]) * (line[i + 1][0] - p[0]));

  const svg = (html) => ov.insertAdjacentHTML('beforeend', html);
  const add = (html) => { ui.insertAdjacentHTML('beforeend', html); return ui.lastElementChild; };
  const fade = (alpha) => { if (window.playParts) window.playParts.scene.world.alpha = alpha; };

  const poly = (list, attrs) => `<polygon points="${pts(list)}" ${attrs}/>`;
  const parcelShape = (p, attrs) => poly(p.polygon, attrs);
  const line = (list, attrs) => `<polyline points="${pts(list)}" fill="none" ${attrs}/>`;
  /** 格子空间里半径 r 的圆，投到屏幕上是扁椭圆。 */
  const ring = (x, y, r, attrs) => {
    const [cx, cy] = P(x, y);
    const k = camera.scale.x;
    return `<ellipse cx="${cx}" cy="${cy}" rx="${r * TILE_HALF_W * Math.SQRT2 * k}" ry="${r * TILE_HALF_H * Math.SQRT2 * k}" ${attrs}/>`;
  };
  const cellDiamond = (x, y, attrs) => poly([[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]], attrs);
  const label = (x, y, html, cls = '') => { const [sx, sy] = P(x, y); return add(`<div class="${cls}" style="position:absolute;left:${sx}px;top:${sy}px;transform:translate(-50%,-50%)">${html}</div>`); };

  /** 气泡：尖角指着格子上的点，靠近顶部的两行时翻到下面，左右不出屏幕。 */
  function bubble(x, y, html, { below, lift = 0 } = {}) {
    const [sx, sy0] = P(x, y);
    const sy = sy0 - lift;
    const el = add(`<div class="bubble">${html}</div>`);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const flip = below ?? sy - h - 20 < 180;
    const left = clamp(sx, w / 2 + 8, W - w / 2 - 8);
    el.classList.toggle('below', flip);
    el.style.left = `${left}px`;
    el.style.top = `${flip ? sy0 + 6 : sy}px`;
    el.style.setProperty('--tip', `${clamp(w / 2 + sx - left, 18, w - 18)}px`);
    return el;
  }
  const co = (n, sx, sy) => add(`<div class="co" style="left:${sx}px;top:${sy}px">${n}</div>`);
  const coAt = (n, el, dx = 0, dy = 0) => { const r = el.getBoundingClientRect(); return co(n, r.left + dx, r.top + dy); };
  /** 标注用的小签（深青底金边），写这个东西点了去哪。 */
  const tag = (text, sx, sy) => add(`<div class="cotag" style="left:${sx}px;top:${sy}px">${text}</div>`);

  /** 系统的东西：刘海（默认）或挖孔、状态栏文字深浅、底部横条深浅。 */
  function chrome({ hole = false, dark = false, hide = false } = {}) {
    sys.innerHTML = hide ? '' : `${hole ? '<div class="hole"></div>' : '<div class="notch"></div>'}<div class="sb ${dark ? 'dark' : ''}"><span>9:41</span><span class="r"><span>▮▮▮▯</span><span>5G</span><span class="bat"></span></span></div><div class="capsule"><span>•••</span><i></i><span><b></b></span></div><div class="homebar ${dark ? 'dark' : ''}"></div>`;
  }

  const offBadge = (cls = 'offb') => `<span class="${cls}">${ICON.offline}</span>`;

  /**
   * 顶部两行。第一行：徽章、城市名（保护期嫩芽、断网图标）和游戏时间，右边让给胶囊；
   * 第二行：资金、人口、表情；信封和“我的城市”竖排在胶囊下面。
   * only: 'money' 时只画资金一格（建造模式等顶部只留资金的画面）。
   */
  function hud({ money = '48,203', neg = false, hg, full = false, xp = 0.72, level = 4, mail = 3, cityDot = false, name = '青川市', clock = '☀ 14:00', trend = null, pending = null, offline = false, sprout = null, pop = '8,450', face = '🙂', word = '好', plus = true, only = null } = {}) {
    const hourglass = hg === undefined ? (neg ? '11 时 42 分' : null) : hg;
    const moneyCap = `<div class="cap money ${neg ? 'neg' : ''}"><span class="ic emo">🪙</span><b>${neg ? '-1,820' : money}</b>${trend === 'down' ? '<span class="tr down">▼</span>' : ''}${hourglass ? `<span class="hg emo">⏳ ${hourglass}</span>` : ''}${pending ?? ''}${plus ? `<span class="plus ${offline ? 'dis' : ''}">${offline ? ICON.offline : '+'}</span>` : ''}</div>`;
    if (only === 'money') {
      add(`<div class="res">${moneyCap}</div>`);
      return;
    }
    const len = 2 * Math.PI * 29;
    add(`<div class="emblem ${full ? 'full' : ''}"><div class="pic emo">🏙️</div><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" fill="none" stroke="#0d2733" stroke-width="6"/><circle cx="32" cy="32" r="29" fill="none" stroke="${full ? '#fff1b8' : '#e9c46a'}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${len * Math.min(1, xp)} ${len}" transform="rotate(-90 32 32)"/></svg><div class="lvl">${level}</div>${offline && full ? offBadge('off') : ''}</div>`);
    add(`<div class="nameplate"><span class="n1"><b>${name}</b>${sprout ? `<span class="sprout emo">🌱 ${sprout}</span>` : ''}${offline ? offBadge('offn') : ''}</span><small class="emo">${clock}</small></div>`);
    add(`<div class="topright"><div class="sq emo ${offline ? 'dis' : ''}">✉️${mail && !offline ? `<i class="badge">${mail}</i>` : ''}${offline ? offBadge() : ''}</div><div class="sq emo">📖${cityDot ? '<i class="badge dot"></i>' : ''}</div></div>`);
    add(`<div class="res">${moneyCap}<div class="cap"><span class="ic emo">👥</span><b>${pop}</b></div><div class="cap face"><span class="ic emo">${face}</span><span class="word">${word}</span></div></div>`);
  }
  /** 底部三个大按钮和回到全城。建造按钮上的金色小星表示托盘里有带“新”的卡片。 */
  function dock({ on = null, buildDot = true, offline = false } = {}) {
    add(`<div class="home emo">🎯</div>`);
    add(`<div class="dock"><div class="db build ${on === 'build' ? 'on' : ''}"><div class="ring emo">🔨</div><em>建造</em>${buildDot ? '<i class="newstar">★</i>' : ''}</div><div class="db view ${on === 'view' ? 'on' : ''}"><div class="ring emo">🗺️</div><em>视图</em></div><div class="db region ${on === 'region' ? 'on' : ''} ${offline ? 'dis' : ''}"><div class="ring emo">🏰</div><em>地区</em>${offline ? offBadge() : ''}</div></div>`);
  }
  const panel = (cls, head, body, style = '') => add(`<div class="panel ${cls}" style="${style}">${head ? `<div class="head">${head}</div>` : ''}${body}</div>`);
  const btn = (text, cls = '', video = false) => `<span class="btn ${cls}">${video ? '<span class="vid">▶</span>' : ''}${text}</span>`;
  const stars = (n, solid) => `<span class="stars">${'★'.repeat(solid)}<s>${'★'.repeat(n - solid)}</s></span>`;

  chrome();
  return { city, N, W, H, P, pts, parcels, near, roadNear, roadPath, simplify, isRoad, levelAt, svg, add, fade, poly, parcelShape, line, ring, cellDiamond, label, bubble, co, coAt, tag, chrome, hud, dock, panel, btn, stars, ICON, ZONE, TILE_HALF_W, TILE_HALF_H };
}
