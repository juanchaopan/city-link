// 负载模拟比较的方案。adr 是 ADR-0006 和 overview.md 写的做法，其余是探针里试的收紧方案。
const adr = {
  settleEveryMs: 0,
  syncOnlyIfDirty: false,
  splitLayout: true,
  timerEveryMinutes: 1,
  timerActiveOnly: false,
  activeWindowMs: 3600e3,
  timerLinksActiveOnly: false,
  leaseless: false,
  skipFinalRead: false,
};

const trimmed = {
  ...adr,
  syncOnlyIfDirty: true,
  splitLayout: false,
  timerEveryMinutes: 5,
  timerActiveOnly: true,
  leaseless: true,
  skipFinalRead: true,
};

export const VARIANTS = {
  adr,
  // 保留每分钟即时到账，只减少每次调用的开销。
  trimmed,
  // 在线结算放宽到 5 分钟，首次进入和退出时仍然结算。
  trimmed5m: { ...trimmed, settleEveryMs: 300e3 },
  // 定时任务只结算一端活跃的连接，其余时间差留到下次。
  activeLinks: { ...trimmed, settleEveryMs: 300e3, timerLinksActiveOnly: true },
  // 用户否决过的纯惰性结算，只作成本对照。
  lazyReference: { ...trimmed, settleEveryMs: 300e3, timerEveryMinutes: 0 },
};
