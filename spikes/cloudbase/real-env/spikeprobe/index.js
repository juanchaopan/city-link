// 在真实云环境里验证 ADR-0005 判据和结算依赖的数据库语义。探针用完就删掉函数和 spike_ 开头的集合。
const cloud = require('wx-server-sdk');
const { createCluster, generate } = require('./terrain');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const COLL = 'spike_probe';

const moduleLoadedAt = Date.now();
let invocations = 0;

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

async function timed(count, fn) {
  const samples = [];
  for (let i = 0; i < count; i++) {
    const start = Date.now();
    await fn(i);
    samples.push(Date.now() - start);
  }
  return { count, p50: percentile(samples, 50), p95: percentile(samples, 95), max: Math.max(...samples) };
}

// 结算入账依赖：带条件的单文档更新是原子的，并发时只有符合条件的次数生效。
async function atomicCondition() {
  const id = `atomic-${Date.now()}`;
  await db.collection(COLL).add({ data: { _id: id, n: 0 } });
  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      db.collection(COLL).where({ _id: id, n: _.lt(5) }).update({ data: { n: _.inc(1) } }),
    ),
  );
  const { data } = await db.collection(COLL).doc(id).get();
  return { expected: 5, final: data.n, updated: results.reduce((sum, r) => sum + r.stats.updated, 0) };
}

// 结算单提交依赖：相同编号并发写入时只有一个成功。
async function uniqueInsert() {
  const id = `batch-${Date.now()}`;
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => db.collection(COLL).add({ data: { _id: id, seq: 1 } })),
  );
  return { expectedSuccess: 1, success: results.filter((r) => r.status === 'fulfilled').length };
}

async function latency() {
  const id = `latency-${Date.now()}`;
  await db.collection(COLL).add({ data: { _id: id, n: 0, group: id } });
  return {
    read: await timed(50, () => db.collection(COLL).doc(id).get()),
    write: await timed(50, () => db.collection(COLL).doc(id).update({ data: { n: _.inc(1) } })),
    latest: await timed(50, () => db.collection(COLL).where({ group: id }).orderBy('n', 'desc').limit(1).get()),
  };
}

async function terrain(count) {
  const cluster = createCluster(Date.now() % 100000, 64, 3);
  const options = {
    plateau: 0.14, low: 0.3, high: 0.64, peak: 0.78, forest: 0.68, mineralChance: 0.5, riverChance: 0.8,
    lakeChance: 0.4, lakeMin: 0.05, lakeSpread: 0.05, buildableFloor: 0.45, cornerPad: true, diagonalRamp: true,
  };
  return timed(count, (i) => generate(cluster, i % 8, Math.floor(i / 8), options));
}

// 只占用很短时间，让并发压测能测出环境和函数的上限。
async function ping() {
  await db.collection(COLL).limit(1).get();
  return { ok: true };
}

exports.main = async (event) => {
  invocations += 1;
  const cold = invocations === 1;
  const start = Date.now();
  const action = event.action ?? 'all';
  const result = {};
  if (action === 'ping') result.ping = await ping();
  if (action === 'all' || action === 'atomic') result.atomic = await atomicCondition();
  if (action === 'all' || action === 'unique') result.unique = await uniqueInsert();
  if (action === 'all' || action === 'latency') result.latency = await latency();
  if (action === 'all' || action === 'terrain') result.terrain = await terrain(event.count ?? 20);
  return { cold, sinceModuleLoadMs: start - moduleLoadedAt, totalMs: Date.now() - start, ...result };
};
