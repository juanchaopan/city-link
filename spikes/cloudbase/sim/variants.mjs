// 负载模拟比较的方案。adr 是 ADR-0006 和 overview.md 写的做法，其余是探针里试的收紧方案。
const adr = {
  settleEveryMs: 0,
  syncEveryMinutes: 1,
  settleOnLast: false,
  syncOnlyIfDirty: false,
  splitLayout: true,
  timerEveryMinutes: 1,
  timerActiveOnly: false,
  activeWindowMs: 3600e3,
  timerLinksActiveOnly: false,
  leaseless: false,
  skipFinalRead: false,
  knownCity: false,
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
  // 在线结算放宽到 5 分钟，首次进入时仍然结算。
  trimmed5m: { ...trimmed, settleEveryMs: 300e3 },
  // 定时任务只结算一端活跃的连接，其余时间差留到下次。
  activeLinks: { ...trimmed, settleEveryMs: 300e3, timerLinksActiveOnly: true },
  // 同步放宽到 3 分钟，只在进入和退出时结算，定时任务仍然每小时走一遍活跃连接。
  frugal: {
    ...trimmed,
    settleEveryMs: Infinity,
    settleOnLast: true,
    syncEveryMinutes: 3,
    knownCity: true,
    timerLinksActiveOnly: true,
  },
  // 用户否决过的纯惰性结算，只作成本对照。
  lazyReference: { ...trimmed, settleEveryMs: 300e3, timerEveryMinutes: 0 },
  frugalLazyReference: {
    ...trimmed,
    settleEveryMs: Infinity,
    settleOnLast: true,
    syncEveryMinutes: 3,
    knownCity: true,
    timerEveryMinutes: 0,
  },
};
