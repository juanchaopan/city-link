// 省掉同步前的读取后，幂等只靠条件更新，重发和并发都不能重复扣钱。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryDb } from '../src/db.mjs';
import { sync } from '../src/settlement.mjs';

function makeDb() {
  const db = new MemoryDb();
  db.defineIndex('routes', 'homeCluster');
  db.seed('clusters', { id: 'c1', shard: 0, leaseOwner: null, leaseUntil: 0 });
  db.seed('cities', { id: 'a', clusterId: 'c1', funds: 1000, goods: {}, appliedSeq: {}, opSeq: 0, foreignHomes: [] });
  return db;
}

const request = (db) => ({
  now: () => 0,
  cityId: 'a',
  opSeq: 1,
  ops: [{ cost: 100 }],
  settle: false,
  owner: 's',
  leaseless: true,
  skipFinalRead: true,
  known: { clusterId: 'c1', foreignHomes: [] },
  db,
});

test('不读取直接更新：重发只扣一次', async () => {
  const db = makeDb();
  await sync(db, request(db));
  await sync(db, request(db));
  assert.equal(db.peek('cities', 'a').funds, 900);
});

test('不读取直接更新：并发只扣一次', async () => {
  const db = makeDb();
  db.hook = async () => {
    await new Promise((resolve) => setImmediate(resolve));
  };
  await Promise.all([sync(db, request(db)), sync(db, request(db)), sync(db, request(db))]);
  assert.equal(db.peek('cities', 'a').funds, 900);
});

test('资金不足时拒绝，不扣钱', async () => {
  const db = makeDb();
  const result = await sync(db, { ...request(db), ops: [{ cost: 5000 }] });
  assert.equal(result.rejected, true);
  assert.equal(db.peek('cities', 'a').funds, 1000);
});
