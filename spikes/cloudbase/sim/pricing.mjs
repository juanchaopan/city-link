// 资源点价格，来自 out/docs/switchGuide.txt 和 out/docs/tencentPrice.txt。
export const PLAN = { yuan: 19.9, points: 40000, envQps: 500 };
export const RATE = {
  dbCallPer10k: 200,
  fnCallPer10k: 13.3,
  fnGbs: 0.11108,
  dbGbDay: 40,
  storageGbDay: 3.94,
  storageRequestPer10k: 10,
  cdnGb: 210,
};

export function bill({ dbCalls, fnCalls, gbs, dbGb, assetGb, assetRequests, cdnGb, days }) {
  const items = {
    dbCalls: (dbCalls / 1e4) * RATE.dbCallPer10k,
    fnCalls: (fnCalls / 1e4) * RATE.fnCallPer10k,
    fnGbs: gbs * RATE.fnGbs,
    dbCapacity: dbGb * days * RATE.dbGbDay,
    assetStorage: assetGb * days * RATE.storageGbDay,
    assetRequests: (assetRequests / 1e4) * RATE.storageRequestPer10k,
    cdn: cdnGb * RATE.cdnGb,
  };
  const points = Object.values(items).reduce((sum, value) => sum + value, 0);
  const scale = 30 / days;
  const monthly = points * scale;
  return {
    items: Object.fromEntries(Object.entries(items).map(([k, v]) => [k, Math.round(v * scale)])),
    pointsPerMonth: Math.round(monthly),
    yuanPerMonth: Math.round((PLAN.yuan + Math.max(0, monthly - PLAN.points) / 1000) * 100) / 100,
    fitsPlan: monthly <= PLAN.points,
  };
}
