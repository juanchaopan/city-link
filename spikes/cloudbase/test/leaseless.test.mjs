// 收紧方案的安全性：去掉租约、定时任务只结算活跃连接时，账目仍然不重复不丢失。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Crash, MemoryDb } from '../src/db.mjs';
import { HOUR, SYSTEM, settleCluster, sync, timerTick } from '../src/settlement.mjs';

const START = 1_000_000;
const RATES = [
  ['l1', 'c1', 'a', 'b', ['m'], 100],
  ['l2', 'c1', 'b', 'a', [], 60],
  ['l3', 'c1', 'a', 'x', [SYSTEM], 30],
  ['l4', 'c2', 'x', SYSTEM, [], 20],
];

function makeWorld() {
  const db = new MemoryDb();
  db.defineIndex('routes', 'homeCluster');
  db.defineIndex('clusters', 'shard');
  const clock = { t: START };
  for (const id of ['c1', 'c2']) db.seed('clusters', { id, shard: 0, leaseOwner: null, leaseUntil: 0 });
  for (const [id, clusterId, foreignHomes] of [['a', 'c1', []], ['b', 'c1', []], ['m', 'c1', []], ['x', 'c2', ['c1']]]) {
    db.seed('cities', { id, clusterId, funds: 1_000_000, goods: { steel: 1_000_000 }, appliedSeq: {}, opSeq: 0, foreignHomes });
  }
  for (const [id, homeCluster, seller, buyer, via, ratePerHour] of RATES) {
    db.seed('routes', { id, homeCluster, seller, buyer, via, goods: 'steel', ratePerHour, price: 10, toll: 1, createdAt: START });
  }
  return { db, clock, now: () => clock.t };
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function check(world, seed) {
  const { db } = world;
  const expected = new Map();
  let sink = 0;
  const delivered = {};
  for (const batch of db.all('settlements')) {
    sink += batch.sink;
    for (const delta of batch.deltas) expected.set(delta.cityId, (expected.get(delta.cityId) ?? 0) + delta.funds);
    for (const [id, qty] of Object.entries(batch.perLink)) delivered[id] = (delivered[id] ?? 0) + qty;
  }
  let total = 0;
  for (const city of db.all('cities')) {
    const spent = city.spent ?? 0;
    assert.equal(city.funds + spent, 1_000_000 + (expected.get(city.id) ?? 0), `种子 ${seed} 城市 ${city.id} 的账不对`);
    total += city.funds + spent;
  }
  assert.equal(total + sink, 4_000_000, `种子 ${seed} 资金不守恒`);
  const hours = (world.clock.t - START) / HOUR;
  for (const [id, , , , , rate] of RATES) {
    assert.ok(Math.abs((delivered[id] ?? 0) - rate * hours) <= 1, `种子 ${seed} 连接 ${id} 交付量不对`);
  }
}

test('没有租约：并发、崩溃、停顿混合 2000 次，没有重复也没有丢失', async () => {
  for (let seed = 1; seed <= 2000; seed++) {
    const world = makeWorld();
    const random = rng(seed);
    const crashRate = 0.02 + random() * 0.08;
    let opSeq = 0;
    world.db.hook = async () => {
      if (random() < 0.4) await new Promise((resolve) => setImmediate(resolve));
      if (random() < crashRate) throw new Crash('random');
    };
    const quiet = (promise) => promise.catch((error) => assert.ok(error instanceof Crash));
    const rounds = 3 + Math.floor(random() * 5);
    for (let round = 0; round < rounds; round++) {
      world.clock.t += Math.floor(random() * HOUR);
      const tasks = [quiet(timerTick(world.db, { now: world.now, minute: 0, owner: 't', leaseless: true }))];
      for (const cityId of ['a', 'b', 'x']) {
        if (random() < 0.7) {
          opSeq += 1;
          tasks.push(quiet(sync(world.db, { now: world.now, cityId, opSeq, ops: [{ cost: 7 }], owner: 's', leaseless: true })));
        }
      }
      await Promise.all(tasks);
    }
    world.db.hook = null;
    for (const id of ['c1', 'c2']) await settleCluster(world.db, id, { now: world.now, owner: 'd', leaseless: true });
    check(world, seed);
  }
});

test('定时任务只结算活跃连接：跳过的时间差在下次结算时补齐，一点不少', async () => {
  for (let seed = 1; seed <= 500; seed++) {
    const world = makeWorld();
    const random = rng(seed);
    const rounds = 5 + Math.floor(random() * 10);
    for (let round = 0; round < rounds; round++) {
      world.clock.t += Math.floor(random() * HOUR);
      const active = new Set(['a', 'b', 'm', 'x'].filter(() => random() < 0.3));
      const linkFilter = (link) => active.has(link.seller) || active.has(link.buyer);
      await timerTick(world.db, { now: world.now, minute: 0, owner: 't', leaseless: true, linkFilter });
    }
    for (const id of ['c1', 'c2']) await settleCluster(world.db, id, { now: world.now, owner: 'd', leaseless: true });
    check(world, seed);
  }
});
