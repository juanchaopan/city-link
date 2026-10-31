// 汇总各方案的模拟结果，写 out/summary.json 并打印表格。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
const rows = [];
for (const file of readdirSync(out)) {
  if (!file.startsWith('load-')) continue;
  const { result: r } = JSON.parse(readFileSync(join(out, file), 'utf8'));
  rows.push({
    variant: r.variant,
    dau: r.targetDau,
    measuredDau: r.measuredDau,
    days: r.days,
    cities: r.cities,
    clusters: r.clusters,
    dbMillionsPerMonth: Math.round(r.calls.dbPerMonth / 1e5) / 10,
    fromSync: Math.round(r.calls.dbFromSyncPerMonth / 1e5) / 10,
    fromTimer: Math.round(r.calls.dbFromTimerPerMonth / 1e5) / 10,
    fnThousandsPerMonth: Math.round(r.calls.fnPerMonth / 1e3),
    dbPerSync: r.dbCallsPerSync,
    peakDbPerSecond: r.peak.dbPerSecond,
    peakFnPerSecond: r.peak.fnPerSecond,
    peakOnline: r.peak.onlineSessions,
    points: r.billing.pointsPerMonth,
    yuan: r.billing.yuanPerMonth,
    fitsPlan: r.billing.fitsPlan,
    cdnPoints: r.billing.items.cdn,
    dbGb: r.storage.dbGb,
  });
}
rows.sort((a, b) => a.dau - b.dau || b.yuan - a.yuan);
writeFileSync(join(out, 'summary.json'), JSON.stringify(rows, null, 2));
console.table(rows.map(({ variant, dau, dbMillionsPerMonth, fromSync, fromTimer, dbPerSync, peakDbPerSecond, peakOnline, points, yuan }) => ({
  variant,
  dau,
  dbMillionsPerMonth,
  fromSync,
  fromTimer,
  dbPerSync,
  peakDbPerSecond,
  peakOnline,
  points,
  yuan,
})));
