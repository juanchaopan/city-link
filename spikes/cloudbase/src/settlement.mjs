// ADR-0006 的最小实现：城市群租约、结算单提交、逐城入账、定时分片和在线结算。
// leaseless 模式去掉租约，只靠结算单编号唯一防止重复，用来比较调用量。
export const HOUR = 3600e3;
export const SYSTEM = 'system';
export const LEASE_TTL = 30e3;

export function shardOf(clusterId) {
  let hash = 0;
  for (let i = 0; i < clusterId.length; i++) hash = (hash * 31 + clusterId.charCodeAt(i)) | 0;
  return Math.abs(hash) % 60;
}

export async function acquireLease(db, clusterId, owner, now) {
  return db.update(
    'clusters',
    clusterId,
    (c) => c.leaseUntil <= now,
    (c) => {
      c.leaseOwner = owner;
      c.leaseUntil = now + LEASE_TTL;
    },
  );
}

export async function releaseLease(db, clusterId, owner) {
  return db.update(
    'clusters',
    clusterId,
    (c) => c.leaseOwner === owner,
    (c) => {
      c.leaseOwner = null;
      c.leaseUntil = 0;
    },
  );
}

function bump(deltas, cityId, funds, goods, qty) {
  if (cityId === SYSTEM) return;
  if (!deltas.has(cityId)) deltas.set(cityId, { cityId, funds: 0, goods: {} });
  const delta = deltas.get(cityId);
  delta.funds += funds;
  if (goods) delta.goods[goods] = (delta.goods[goods] ?? 0) + qty;
}

// 按时间差计算连接的成交量，成交量受库存和买方资金限制。
export function computeBatch(links, ledgers, cursors, now) {
  const deltas = new Map();
  const nextCursors = {};
  const perLink = {};
  const funds = new Map();
  const stock = new Map();
  const fundsOf = (id) => {
    if (id === SYSTEM) return Infinity;
    if (!funds.has(id)) funds.set(id, ledgers.get(id)?.funds ?? 0);
    return funds.get(id);
  };
  const stockOf = (id, goods) => {
    if (id === SYSTEM) return Infinity;
    const key = `${id}/${goods}`;
    if (!stock.has(key)) stock.set(key, ledgers.get(id)?.goods[goods] ?? 0);
    return stock.get(key);
  };
  let sink = 0;
  for (const link of links) {
    const from = cursors[link.id] ?? link.createdAt;
    const elapsed = now - from;
    if (elapsed <= 0) continue;
    const due = Math.floor((link.ratePerHour * elapsed) / HOUR);
    if (due <= 0) continue;
    const unitCost = link.price + link.toll * link.via.length;
    const affordable = Math.floor(fundsOf(link.buyer) / unitCost);
    const qty = Math.max(0, Math.min(due, stockOf(link.seller, link.goods), affordable));
    // 库存或资金不足时，没有成交的部分作废，不累积到下次。
    nextCursors[link.id] = qty === due ? from + (due * HOUR) / link.ratePerHour : now;
    if (qty === 0) continue;
    perLink[link.id] = qty;
    const paid = qty * unitCost;
    bump(deltas, link.buyer, -paid, link.goods, qty);
    bump(deltas, link.seller, qty * link.price, link.goods, -qty);
    for (const via of link.via) bump(deltas, via, qty * link.toll, null, 0);
    if (link.buyer === SYSTEM) sink -= paid;
    if (link.seller === SYSTEM) sink += qty * link.price;
    sink += qty * link.toll * link.via.filter((via) => via === SYSTEM).length;
    if (link.buyer !== SYSTEM) funds.set(link.buyer, fundsOf(link.buyer) - paid);
    if (link.seller !== SYSTEM) stock.set(`${link.seller}/${link.goods}`, stockOf(link.seller, link.goods) - qty);
  }
  return { deltas: [...deltas.values()], nextCursors, perLink, sink };
}

export async function applyBatch(db, batch) {
  for (const delta of batch.deltas) {
    await db.update(
      'cities',
      delta.cityId,
      (city) => (city.appliedSeq[batch.clusterId] ?? 0) < batch.seq,
      (city) => {
        city.funds += delta.funds;
        for (const [goods, qty] of Object.entries(delta.goods)) city.goods[goods] = (city.goods[goods] ?? 0) + qty;
        city.appliedSeq[batch.clusterId] = batch.seq;
      },
    );
  }
  await db.update(
    'settlements',
    batch.id,
    (doc) => !doc.done,
    (doc) => {
      doc.done = true;
    },
  );
}

// 结算一个城市群。onlyCity 给定时只结算这座城市的连接，用于玩家同步。
// linkFilter 让定时任务跳过两端都不活跃的连接，它们的时间差留到下次结算。
export async function settleCluster(db, clusterId, { now, owner, onlyCity = null, leaseless = false, linkFilter = null }) {
  if (!leaseless) {
    const got = await acquireLease(db, clusterId, owner, now());
    if (!got) return { status: 'busy' };
  }
  const finish = async (result) => {
    if (!leaseless) await releaseLease(db, clusterId, owner);
    return result;
  };
  const latest = await db.latestSeq('settlements', clusterId);
  if (latest && !latest.done) await applyBatch(db, latest);

  const allLinks = await db.findBy('routes', 'homeCluster', clusterId);
  let links = allLinks;
  if (onlyCity) links = links.filter((l) => l.seller === onlyCity || l.buyer === onlyCity || l.via.includes(onlyCity));
  if (linkFilter) links = links.filter(linkFilter);
  if (links.length === 0) return finish({ status: 'ok', batch: null });
  const cityIds = new Set();
  for (const link of links) {
    if (link.seller !== SYSTEM) cityIds.add(link.seller);
    if (link.buyer !== SYSTEM) cityIds.add(link.buyer);
  }
  const ledgers = new Map();
  if (cityIds.size > 0) {
    for (const doc of await db.getMany('cities', [...cityIds])) ledgers.set(doc.id, doc);
  }
  const cursors = latest?.cursors ?? {};
  const at = now();
  const { deltas, nextCursors, perLink, sink } = computeBatch(links, ledgers, cursors, at);
  if (Object.keys(nextCursors).length === 0) return finish({ status: 'ok', batch: null });

  const seq = (latest?.seq ?? 0) + 1;
  const batch = {
    id: `${clusterId}:${seq}`,
    clusterId,
    seq,
    at,
    deltas,
    perLink,
    sink,
    cursors: { ...cursors, ...nextCursors },
    done: false,
  };
  const committed = await db.insert('settlements', batch, clusterId);
  if (!committed) return finish({ status: 'lost-race' });
  await applyBatch(db, batch);
  return finish({ status: 'ok', batch });
}

// 定时任务：每分钟处理一个分片，一小时走完全部城市群。
export async function timerTick(db, { now, minute, owner, skip = () => false, leaseless = false, linkFilter = null }) {
  const clusters = await db.findBy('clusters', 'shard', minute % 60);
  let settled = 0;
  for (const cluster of clusters) {
    if (skip(cluster)) continue;
    await settleCluster(db, cluster.id, { now, owner: `${owner}:${cluster.id}`, leaseless, linkFilter });
    settled++;
  }
  return settled;
}

// 玩家同步：建造操作按序号幂等，之后结算本城。
export async function sync(db, { now, cityId, opSeq, ops, settle = true, owner, leaseless = false, skipFinalRead = false }) {
  const cost = ops.reduce((sum, op) => sum + op.cost, 0);
  const city = await db.get('cities', cityId);
  let rejected = false;
  if (ops.length > 0 && opSeq > city.opSeq) {
    const applied = await db.update(
      'cities',
      cityId,
      (doc) => doc.opSeq < opSeq && doc.funds >= cost,
      (doc) => {
        doc.funds -= cost;
        doc.opSeq = opSeq;
        doc.spent = (doc.spent ?? 0) + cost;
      },
    );
    rejected = !applied;
  }
  if (settle) {
    const homes = new Set([city.clusterId, ...(city.foreignHomes ?? [])]);
    for (const clusterId of homes) {
      await settleCluster(db, clusterId, { now, owner, onlyCity: cityId, leaseless });
    }
  }
  return { rejected, ledger: skipFinalRead ? null : await db.get('cities', cityId) };
}
