import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Crash, MemoryDb } from '../src/db.mjs';
import { HOUR, LEASE_TTL, SYSTEM, applyBatch, settleCluster, sync, timerTick } from '../src/settlement.mjs';

const START = 1_000_000;

function makeWorld() {
  const db = new MemoryDb();
  db.defineIndex('routes', 'homeCluster');
  db.defineIndex('clusters', 'shard');
  const clock = { t: START };
  for (const id of ['c1', 'c2']) db.seed('clusters', { id, shard: 0, leaseOwner: null, leaseUntil: 0 });
  const city = (id, clusterId, extra = {}) =>
    db.seed('cities', {
      id,
      clusterId,
      funds: 1_000_000,
      goods: { steel: 1_000_000, food: 1_000_000 },
      appliedSeq: {},
      opSeq: 0,
      ...extra,
    });
  city('a', 'c1');
  city('b', 'c1');
  city('m', 'c1');
  city('x', 'c2', { foreignHomes: ['c1'] });
  const link = (id, homeCluster, seller, buyer, via, ratePerHour) =>
    db.seed('routes', { id, homeCluster, seller, buyer, via, goods: 'steel', ratePerHour, price: 10, toll: 1, createdAt: START });
  link('l1', 'c1', 'a', 'b', ['m'], 100);
  link('l2', 'c1', 'b', 'a', [], 60);
  link('l3', 'c1', 'a', 'x', [SYSTEM], 30);
  link('l4', 'c2', 'x', SYSTEM, [], 20);
  return { db, clock, now: () => clock.t };
}

function totals(db) {
  const cities = db.all('cities');
  const batches = db.all('settlements');
  return {
    funds: cities.reduce((sum, c) => sum + c.funds, 0),
    spent: cities.reduce((sum, c) => sum + (c.spent ?? 0), 0),
    sink: batches.reduce((sum, b) => sum + b.sink, 0),
  };
}

// 每座城市的最终余额必须等于初始值加上全部结算单里它的变化，一笔不多一笔不少。
function assertLedgersMatchBatches(db) {
  const expected = new Map();
  for (const batch of db.all('settlements')) {
    for (const delta of batch.deltas) expected.set(delta.cityId, (expected.get(delta.cityId) ?? 0) + delta.funds);
  }
  for (const city of db.all('cities')) {
    assert.equal(city.funds + (city.spent ?? 0), 1_000_000 + (expected.get(city.id) ?? 0), `城市 ${city.id} 的账不对`);
  }
  const total = totals(db);
  assert.equal(total.funds + total.spent + total.sink, 4_000_000, '资金总量不守恒');
}

function deliveredByLink(db) {
  const out = {};
  for (const batch of db.all('settlements')) {
    for (const [id, qty] of Object.entries(batch.perLink)) out[id] = (out[id] ?? 0) + qty;
  }
  return out;
}

function assertDeliveredExactly(db, hours) {
  const delivered = deliveredByLink(db);
  assert.equal(delivered.l1, Math.floor(100 * hours));
  assert.equal(delivered.l2, Math.floor(60 * hours));
  assert.equal(delivered.l3, Math.floor(30 * hours));
  assert.equal(delivered.l4, Math.floor(20 * hours));
}

async function drain(world) {
  world.clock.t += LEASE_TTL + 1;
  world.db.hook = null;
  for (const id of ['c1', 'c2']) {
    const result = await settleCluster(world.db, id, { now: world.now, owner: 'drain' });
    assert.equal(result.status, 'ok');
  }
}

function crashOn(db, predicate) {
  let fired = false;
  db.hook = async (phase, op) => {
    if (!fired && predicate(phase, op)) {
      fired = true;
      throw new Crash(`${phase} ${op}`);
    }
  };
}

test('正常结算：钱、货和过路费都正确，途经城市收到过路费', async () => {
  const world = makeWorld();
  world.clock.t += HOUR;
  await settleCluster(world.db, 'c1', { now: world.now, owner: 't' });
  const b = world.db.peek('cities', 'b');
  const m = world.db.peek('cities', 'm');
  assert.equal(b.funds, 1_000_000 - 100 * 11 + 60 * 10);
  assert.equal(b.goods.steel, 1_000_000 + 100 - 60);
  assert.equal(m.funds, 1_000_000 + 100);
});

test('提交后崩溃：结算单已写入但没有入账，下次补做且只入账一次', async () => {
  const world = makeWorld();
  world.clock.t += HOUR;
  crashOn(world.db, (phase, op) => phase === 'after' && op === 'insert:settlements');
  await assert.rejects(settleCluster(world.db, 'c1', { now: world.now, owner: 't' }), Crash);
  assert.equal(world.db.peek('cities', 'b').funds, 1_000_000);
  world.clock.t = START + 2 * HOUR;
  await drain(world);
  world.clock.t = START + 3 * HOUR;
  await settleCluster(world.db, 'c1', { now: world.now, owner: 't2' });
  await settleCluster(world.db, 'c2', { now: world.now, owner: 't2' });
  assertLedgersMatchBatches(world.db);
  assertDeliveredExactly(world.db, 3);
});

test('入账一半崩溃：已入账的城市不重复，没入账的城市补上', async () => {
  const world = makeWorld();
  world.clock.t += HOUR;
  let seen = 0;
  crashOn(world.db, (phase, op) => phase === 'before' && op === 'update:cities' && ++seen === 2);
  await assert.rejects(settleCluster(world.db, 'c1', { now: world.now, owner: 't' }), Crash);
  await drain(world);
  assertLedgersMatchBatches(world.db);
});

test('回应丢失：入账已成功但调用方收到超时，重跑不会重复入账', async () => {
  const world = makeWorld();
  world.clock.t += HOUR;
  let seen = 0;
  crashOn(world.db, (phase, op) => phase === 'after' && op === 'update:cities' && ++seen === 1);
  await assert.rejects(settleCluster(world.db, 'c1', { now: world.now, owner: 't' }), Crash);
  await drain(world);
  assertLedgersMatchBatches(world.db);
});

test('重复执行：同一结算单重复入账，余额不变', async () => {
  const world = makeWorld();
  world.clock.t += HOUR;
  const { batch } = await settleCluster(world.db, 'c1', { now: world.now, owner: 't' });
  const before = structuredClone(world.db.peek('cities', 'b'));
  await applyBatch(world.db, batch);
  await applyBatch(world.db, batch);
  assert.deepEqual(world.db.peek('cities', 'b'), before);
  const again = await settleCluster(world.db, 'c1', { now: world.now, owner: 't' });
  assert.equal(again.batch, null);
  assertLedgersMatchBatches(world.db);
});

test('重复的同步请求只扣一次钱，重发不算拒绝', async () => {
  const world = makeWorld();
  const req = { now: world.now, cityId: 'a', opSeq: 1, ops: [{ cost: 500 }], settle: false, owner: 's' };
  await sync(world.db, req);
  const resend = await sync(world.db, req);
  assert.equal(resend.rejected, false);
  assert.equal(world.db.peek('cities', 'a').funds, 1_000_000 - 500);
});

test('并发的相同同步请求只扣一次钱', async () => {
  const world = makeWorld();
  world.db.hook = async () => {
    await new Promise((resolve) => setImmediate(resolve));
  };
  const req = { now: world.now, cityId: 'a', opSeq: 1, ops: [{ cost: 500 }], settle: false, owner: 's' };
  await Promise.all([sync(world.db, req), sync(world.db, req), sync(world.db, req)]);
  assert.equal(world.db.peek('cities', 'a').funds, 1_000_000 - 500);
});

test('租约过期：停顿的旧持有者醒来后提交失败，不会重复结算', async () => {
  const world = makeWorld();
  world.clock.t += HOUR;
  let pause;
  const paused = new Promise((resolve) => {
    pause = resolve;
  });
  let release;
  const woken = new Promise((resolve) => {
    release = resolve;
  });
  world.db.hook = async (phase, op) => {
    if (phase === 'before' && op === 'insert:settlements' && !world.stalled) {
      world.stalled = true;
      pause();
      await woken;
    }
  };
  const stale = settleCluster(world.db, 'c1', { now: world.now, owner: 'stale' });
  await paused;
  world.clock.t += LEASE_TTL + 1;
  const fresh = await settleCluster(world.db, 'c1', { now: world.now, owner: 'fresh' });
  assert.equal(fresh.status, 'ok');
  release();
  assert.equal((await stale).status, 'lost-race');
  assert.equal(world.db.all('settlements').length, 1);
  assertLedgersMatchBatches(world.db);
});

test('定时和在线同时运行：租约让其中一个退让，账目一致', async () => {
  const world = makeWorld();
  world.clock.t += HOUR;
  world.db.hook = async () => {
    await new Promise((resolve) => setImmediate(resolve));
  };
  const results = await Promise.all([
    timerTick(world.db, { now: world.now, minute: 0, owner: 'timer' }),
    sync(world.db, { now: world.now, cityId: 'a', opSeq: 1, ops: [], owner: 'online-a' }),
    sync(world.db, { now: world.now, cityId: 'x', opSeq: 1, ops: [], owner: 'online-x' }),
  ]);
  assert.equal(results.length, 3);
  await drain(world);
  assertLedgersMatchBatches(world.db);
  assertDeliveredExactly(world.db, 1);
});

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

test('随机调度：并发、崩溃、租约过期混合 2000 次，没有重复也没有丢失', async () => {
  for (let seed = 1; seed <= 2000; seed++) {
    const world = makeWorld();
    const random = rng(seed);
    const crashRate = 0.02 + random() * 0.08;
    let spends = 0;
    world.db.hook = async () => {
      if (random() < 0.3) await new Promise((resolve) => setImmediate(resolve));
      if (random() < 0.15) world.clock.t += Math.floor(random() * LEASE_TTL);
      if (random() < crashRate) throw new Crash('random');
    };
    const quiet = (promise) => promise.catch((error) => assert.ok(error instanceof Crash));
    const rounds = 3 + Math.floor(random() * 5);
    for (let round = 0; round < rounds; round++) {
      world.clock.t += Math.floor(random() * HOUR);
      const owner = (name) => `${name}:${seed}:${round}`;
      const tasks = [quiet(timerTick(world.db, { now: world.now, minute: 0, owner: owner('timer') }))];
      for (const cityId of ['a', 'b', 'x']) {
        if (random() < 0.7) {
          spends += 1;
          tasks.push(
            quiet(
              sync(world.db, {
                now: world.now,
                cityId,
                opSeq: spends,
                ops: [{ cost: 7 }],
                owner: owner(`online-${cityId}`),
              }),
            ),
          );
        }
      }
      await Promise.all(tasks);
    }
    const finalTime = world.clock.t + LEASE_TTL + 1;
    world.clock.t = finalTime;
    await drain(world);
    world.clock.t = finalTime + 2 * LEASE_TTL;
    await drain(world);
    assertLedgersMatchBatches(world.db);
    const hours = (world.clock.t - START) / HOUR;
    const delivered = deliveredByLink(world.db);
    for (const [id, rate] of [['l1', 100], ['l2', 60], ['l3', 30], ['l4', 20]]) {
      assert.ok(Math.abs((delivered[id] ?? 0) - rate * hours) <= 1, `种子 ${seed} 连接 ${id} 交付量不对`);
    }
  }
});
