// 风格包和节日包的解析。纯函数：只决定每个规格该用哪张素材，不碰玩法数据。
// 风格只换外观：地块、容量、出入口和路段负担都在 parcels.js 和 traffic.js 里算，这里拿不到也改不了。

export const STANDARD_STYLE = 'standard';

/** 玩家选的风格缺失时退回标准风格，存档里的选择不动。 */
export function resolveStyle(installed, wanted) {
  return installed[wanted] ?? installed[STANDARD_STYLE];
}

/** 某个规格的素材：风格没有提供时用标准风格同一规格的素材。 */
export function resolveSpec(style, standard, spec) {
  if (style.specs.includes(spec)) return { style: style.id, spec };
  if (standard.specs.includes(spec)) return { style: standard.id, spec };
  return null;
}

/** 今天生效的节日。日期按城市所在国家的时区算，不写进存档，所以节日结束自动恢复。 */
export function activeFestival(calendar, month, day) {
  const today = month * 100 + day;
  return calendar.find(({ from, to }) => today >= from && today <= to) ?? null;
}

/**
 * 某个占地规格的装饰层。依次找：风格专属的节日层、通用节日层。
 * 都没有时返回 null，建筑照常显示，只是没有装饰。
 */
export function resolveDecoration(festival, styleId, footprint) {
  if (!festival) return null;
  const own = festival.styles?.[styleId];
  if (own?.footprints.includes(footprint)) return { pack: styleId, footprint };
  if (festival.generic.footprints.includes(footprint)) return { pack: 'generic', footprint };
  return null;
}
