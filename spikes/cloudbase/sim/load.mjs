// 用真实的结算实现跑虚拟时间：模拟玩家会话和定时任务，统计云函数和数据库调用，再折算成一个月。
// 用法：node sim/load.mjs <variant> <dau> [days]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryDb } from '../src/db.mjs';
import { SYSTEM, shardOf, sync, timerTick } from '../src/settlement.mjs';
import { PLAN, bill } from './pricing.mjs';
import { VARIANTS } from './variants.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MINUTE = 60e3;
const DAY = 86400e3;

// 全部假设集中在这里，SPIKE.md 逐条列出。
export const ASSUME = {
  retentionD1: 0.35,
  retentionD7: 0.15,
  retentionHorizonDays: 180,
  replaceAfterDays: 30,
  seedDays: 90,
  sessionMinutesMin: 4,
  sessionMinutesMax: 12,
  secondSessionChance: 0.6,
  thirdSessionChance: 0.2,
  newPlayerSessionMinutes: 10,
  hourlyShare: [1, 0.6, 0.3, 0.2, 0.2, 0.3, 0.8, 1.5, 2, 2, 2, 2.2, 3.5, 3, 2.2, 2, 2, 2.5, 3.5, 5, 6, 6, 5, 2.5],
  linksPerCity: 3,
  neighbourLinkShare: 0.6,
  crossClusterLinkShare: 0.1,
  viaProbability: 0.5,
  syncWithOpsShare: 0.7,
  fnBaseMs: 60,
  dbCallMs: 12,
  fnMemoryGb: 0.25,
  layoutKb: 10,
  terrainKb: 0.6,
  ledgerKb: 1,
  routeKb: 0.3,
  assetPackMb: 12,
  assetFilesPerInstall: 20,
  assetStoredGb: 0.1,
  assetUpdatesPerMonth: 2,
  updatedPlayerShare: 0.3,
};

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const exponent = Math.log(ASSUME.retentionD1 / ASSUME.retentionD7) / Math.log(7);
const retention = (age) => (age <= 0 ? 1 : age > ASSUME.retentionHorizonDays ? 0 : ASSUME.retentionD1 * age ** -exponent);

// 被替换的玩家不再回来，所以每个安装实际贡献的活跃天数要用同样的规则算。
export function installsFor(dau) {
  const random = mulberry(7);
  const cohort = 20000;
  let activeDays = 0;
  for (let i = 0; i < cohort; i++) {
    let last = 0;
    activeDays++;
    for (let age = 1; age <= ASSUME.retentionHorizonDays; age++) {
      if (random() < retention(age)) {
        last = age;
        activeDays++;
      } else if (age - last > ASSUME.replaceAfterDays) {
        break;
      }
    }
  }
  return dau / (activeDays / cohort);
}

class World {
  constructor(cfg, seed) {
    this.cfg = cfg;
    this.random = mulberry(seed);
    this.db = new MemoryDb({ clone: false });
    this.db.defineIndex('routes', 'homeCluster');
    this.db.defineIndex('clusters', 'shard');
    this.clock = { t: 0 };
    this.now = () => this.clock.t;
    this.players = [];
    this.vacant = [];
    this.clusterCount = 0;
    this.slotsLeft = 0;
    this.linkId = 0;
    this.members = new Map();
    this.linksOf = new Map();
    this.fnCalls = 0;
    this.gbs = 0;
    this.counts = { sync: 0, settleOnSync: 0, enter: 0, timerInvocations: 0, clusterSettles: 0 };
    this.dbBy = { sync: 0, timer: 0, enter: 0, retire: 0 };
    this.second = new Uint32Array(86400);
    this.secondFn = new Uint32Array(86400);
    this.peakDb = 0;
    this.peakFn = 0;
    this.lastActiveInCluster = new Map();
    this.lastActiveCity = new Map();
  }

  newClusterId() {
    this.clusterCount++;
    const id = `c${this.clusterCount}`;
    this.db.seed('clusters', { id, shard: shardOf(id), leaseOwner: null, leaseUntil: 0 });
    this.members.set(id, new Set());
    this.slotsLeft = 64;
    return id;
  }

  place() {
    if (this.vacant.length > 0) return this.vacant.pop();
    if (this.slotsLeft === 0) this.newClusterId();
    this.slotsLeft--;
    return `c${this.clusterCount}`;
  }

  track(cityId, linkId) {
    if (cityId === SYSTEM) return;
    if (!this.linksOf.has(cityId)) this.linksOf.set(cityId, new Set());
    this.linksOf.get(cityId).add(linkId);
  }

  async addLinks(city, clusterId, at, counted) {
    const peers = [...this.members.get(clusterId)];
    for (let i = 0; i < ASSUME.linksPerCity; i++) {
      const roll = this.random();
      let peer = SYSTEM;
      let home = clusterId;
      if (roll < ASSUME.crossClusterLinkShare && this.players.length > 10) {
        const other = this.players[Math.floor(this.random() * this.players.length)];
        if (other.cityId !== city && !other.gone) {
          peer = other.cityId;
          home = other.clusterId;
        }
      } else if (roll < ASSUME.crossClusterLinkShare + ASSUME.neighbourLinkShare && peers.length > 0) {
        peer = peers[Math.floor(this.random() * peers.length)];
      }
      const via = [];
      if (this.random() < ASSUME.viaProbability) {
        via.push(peers.length > 0 && this.random() < 0.5 ? peers[Math.floor(this.random() * peers.length)] : SYSTEM);
      }
      const seller = this.random() < 0.5 ? city : peer;
      const buyer = seller === city ? peer : city;
      const link = {
        id: `l${++this.linkId}`,
        homeCluster: home,
        seller,
        buyer,
        via: via.filter((v) => v !== seller && v !== buyer),
        goods: 'g',
        ratePerHour: 20,
        price: 10,
        toll: 1,
        createdAt: at,
      };
      if (home !== clusterId) this.db.peek('cities', city).foreignHomes.push(home);
      this.track(seller, link.id);
      this.track(buyer, link.id);
      for (const v of link.via) this.track(v, link.id);
      if (counted) await this.db.insert('routes', link);
      else this.db.seed('routes', link);
    }
  }

  async createCity(player, counted) {
    const clusterId = this.place();
    player.clusterId = clusterId;
    player.cityId = `p${player.id}`;
    const at = this.clock.t;
    const city = {
      id: player.cityId,
      clusterId,
      funds: 1e12,
      goods: { g: 1e12 },
      appliedSeq: {},
      opSeq: 0,
      foreignHomes: [],
      spent: 0,
    };
    if (counted) await this.db.insert('cities', city);
    else this.db.seed('cities', city);
    if (this.cfg.splitLayout) {
      if (counted) await this.db.insert('layouts', { id: player.cityId, opSeq: 0 });
      else this.db.seed('layouts', { id: player.cityId, opSeq: 0 });
    }
    await this.addLinks(player.cityId, clusterId, at, counted);
    this.members.get(clusterId).add(player.cityId);
  }

  // 被替换的城市：线路全部删除，位置回到空位。
  async retire(player) {
    const before = this.db.calls;
    player.gone = true;
    this.members.get(player.clusterId).delete(player.cityId);
    this.vacant.push(player.clusterId);
    const links = this.linksOf.get(player.cityId) ?? [];
    for (const id of links) await this.db.remove('routes', id);
    this.linksOf.delete(player.cityId);
    await this.db.update('cities', player.cityId, () => true, () => {});
    this.dbBy.retire += this.db.calls - before;
  }

  tally(calls, second, fnCount) {
    this.fnCalls += fnCount;
    const ms = ASSUME.fnBaseMs + calls * ASSUME.dbCallMs;
    this.gbs += ASSUME.fnMemoryGb * (Math.ceil(ms / 100) / 10) * fnCount;
    this.second[second] += calls;
    this.secondFn[second] += fnCount;
  }

  rollSeconds() {
    for (let i = 0; i < 86400; i++) {
      if (this.second[i] > this.peakDb) this.peakDb = this.second[i];
      if (this.secondFn[i] > this.peakFn) this.peakFn = this.secondFn[i];
    }
    this.second.fill(0);
    this.secondFn.fill(0);
  }

  // 新玩家进入：租约、位置、相邻地形、写地形、账本、线路。
  async enter(player, second) {
    const before = this.db.calls;
    await this.db.update('clusters', this.vacant.at(-1) ?? `c${this.clusterCount}`, () => true, () => {});
    await this.createCity(player, true);
    await this.db.get('clusters', player.clusterId);
    await this.db.getMany('terrains', []);
    await this.db.insert('terrains', { id: player.cityId });
    await this.db.update('clusters', player.clusterId, () => true, () => {});
    this.counts.enter++;
    this.dbBy.enter += this.db.calls - before;
    this.tally(this.db.calls - before, second, 1);
    this.lastActiveCity.set(player.cityId, this.clock.t);
  }

  async playerSync(player, session, second, last) {
    const { cfg } = this;
    const { state } = session;
    session.tick = (session.tick ?? 0) + 1;
    state.pendingOps = (state.pendingOps ?? 0) + (this.random() < ASSUME.syncWithOpsShare ? 1 : 0);
    const onSchedule = session.tick % cfg.syncEveryMinutes === 0;
    if (!session.first && !last && !onSchedule) return;
    const dirty = state.pendingOps > 0;
    const elapsed = this.clock.t - state.settledAt;
    const dueSettle = cfg.settleEveryMs === 0 || session.first || (cfg.settleOnLast && last) || elapsed >= cfg.settleEveryMs;
    if (cfg.syncOnlyIfDirty && !dirty && !dueSettle && !last) return;
    const before = this.db.calls;
    if (dirty) state.opSeq++;
    state.pendingOps = 0;
    if (cfg.splitLayout) await this.db.get('layouts', player.cityId);
    const known = cfg.knownCity && !session.first ? this.db.peek('cities', player.cityId) : null;
    await sync(this.db, {
      now: this.now,
      cityId: player.cityId,
      opSeq: state.opSeq + state.base,
      ops: dirty ? [{ cost: 1 }] : [],
      settle: dueSettle,
      owner: `s${player.id}`,
      leaseless: cfg.leaseless,
      skipFinalRead: cfg.skipFinalRead,
      known,
    });
    if (cfg.splitLayout && dirty) await this.db.update('layouts', player.cityId, () => true, () => {});
    if (dueSettle) {
      state.settledAt = this.clock.t;
      this.counts.settleOnSync++;
    }
    this.counts.sync++;
    this.dbBy.sync += this.db.calls - before;
    this.tally(this.db.calls - before, second, 1);
    this.lastActiveInCluster.set(player.clusterId, this.clock.t);
    this.lastActiveCity.set(player.cityId, this.clock.t);
  }

  async tick(minute) {
    const { cfg } = this;
    if (!cfg.timerEveryMinutes || minute % cfg.timerEveryMinutes !== 0) return;
    const before = this.db.calls;
    const isActive = (id) => this.clock.t - (this.lastActiveCity.get(id) ?? -Infinity) <= cfg.activeWindowMs;
    const linkFilter = cfg.timerLinksActiveOnly ? (l) => isActive(l.seller) || isActive(l.buyer) : null;
    let settled = 0;
    for (let offset = 0; offset < cfg.timerEveryMinutes; offset++) {
      settled += await timerTick(this.db, {
        now: this.now,
        minute: minute + offset,
        owner: 'timer',
        leaseless: cfg.leaseless,
        linkFilter,
        skip: (cluster) =>
          cfg.timerActiveOnly && this.clock.t - (this.lastActiveInCluster.get(cluster.id) ?? -Infinity) > cfg.activeWindowMs,
      });
    }
    this.counts.timerInvocations++;
    this.counts.clusterSettles += settled;
    const calls = this.db.calls - before;
    this.dbBy.timer += calls;
    // 定时任务的数据库调用在这一分钟内顺序执行。
    const base = (Math.floor(this.clock.t / MINUTE) % 1440) * 60;
    const perSecond = Math.ceil(calls / 60);
    for (let i = 0; i < 60; i++) this.second[base + i] += perSecond;
    this.tally(0, base, 1);
    this.gbs += ASSUME.fnMemoryGb * ((calls * ASSUME.dbCallMs) / 1000);
  }
}

export async function run(variantName, dau, days = 30, seed = 1) {
  const cfg = VARIANTS[variantName];
  const world = new World(cfg, seed);
  const installs = installsFor(dau);
  const started = Date.now();

  // 先铺好稳态人口：之前 seedDays 天安装的玩家，不计调用量。
  let nextId = 0;
  for (let day = -ASSUME.seedDays; day < 0; day++) {
    const count = Math.round(installs);
    for (let i = 0; i < count; i++) {
      const player = { id: nextId++, joinDay: day, lastActive: day, gone: false, opSeq: 0 };
      let replaced = false;
      for (let d = day + 1; d < 0; d++) {
        if (world.random() < retention(d - day)) player.lastActive = d;
        else if (d - player.lastActive > ASSUME.replaceAfterDays) replaced = true;
        if (replaced) break;
      }
      if (replaced) continue;
      world.clock.t = day * DAY;
      await world.createCity(player, false);
      world.players.push(player);
    }
  }

  const total = ASSUME.hourlyShare.reduce((sum, v) => sum + v, 0);
  const pickMinute = () => {
    let roll = world.random() * total;
    for (let hour = 0; hour < 24; hour++) {
      roll -= ASSUME.hourlyShare[hour];
      if (roll <= 0) return hour * 60 + Math.floor(world.random() * 60);
    }
    return 1200;
  };

  world.db.calls = 0;
  world.db.reads = 0;
  world.db.writes = 0;
  let peakOnline = 0;
  let activeSum = 0;

  for (let day = 0; day < days; day++) {
    world.clock.t = day * DAY;
    const buckets = Array.from({ length: 1441 }, () => []);
    const schedule = (player) => {
      const sessions = 1 + (world.random() < ASSUME.secondSessionChance ? 1 : 0) + (world.random() < ASSUME.thirdSessionChance ? 1 : 0);
      const span = ASSUME.sessionMinutesMax - ASSUME.sessionMinutesMin + 1;
      for (let s = 0; s < sessions; s++) {
        buckets[pickMinute()].push({
          player,
          left: ASSUME.sessionMinutesMin + Math.floor(world.random() * span),
          first: true,
          state: { opSeq: 0, base: player.opSeq, settledAt: -Infinity },
        });
      }
    };
    let active = 0;
    const alive = [];
    for (const player of world.players) {
      if (player.gone) continue;
      if (world.random() < retention(day - player.joinDay)) {
        player.lastActive = day;
        active++;
        schedule(player);
      } else if (day - player.lastActive > ASSUME.replaceAfterDays) {
        await world.retire(player);
        continue;
      }
      alive.push(player);
    }
    world.players = alive;
    const count = Math.round(installs);
    for (let i = 0; i < count; i++) {
      const player = { id: nextId++, joinDay: day, lastActive: day, gone: false, opSeq: 0 };
      buckets[pickMinute()].push({
        player,
        left: ASSUME.newPlayerSessionMinutes,
        first: true,
        enter: true,
        state: { opSeq: 0, base: 0, settledAt: -Infinity },
      });
      active++;
    }
    activeSum += active;
    for (let minute = 0; minute < 1440; minute++) {
      world.clock.t = day * DAY + minute * MINUTE;
      await world.tick(minute);
      const sessions = buckets[minute];
      if (sessions.length > peakOnline) peakOnline = sessions.length;
      for (const session of sessions) {
        const second = minute * 60 + Math.floor(world.random() * 60);
        if (session.enter) {
          await world.enter(session.player, second);
          world.players.push(session.player);
          session.enter = false;
          session.first = false;
          session.state.settledAt = world.clock.t;
        } else {
          await world.playerSync(session.player, session, second, session.left <= 1);
          session.first = false;
        }
        session.player.opSeq = session.state.base + session.state.opSeq;
        session.left -= 1;
        if (session.left > 0 && minute < 1439) buckets[minute + 1].push(session);
      }
    }
    world.rollSeconds();
  }

  const { db } = world;
  const cities = db.coll('cities').size;
  const routes = db.coll('routes').size;
  const sample = [...db.coll('settlements').values()].slice(-200);
  const avgBatchKb = sample.reduce((sum, b) => sum + JSON.stringify(b).length, 0) / Math.max(1, sample.length) / 1024;
  const batchesPerDay = db.coll('settlements').size / days;
  const dbGb =
    (cities * (ASSUME.layoutKb + ASSUME.terrainKb + ASSUME.ledgerKb) +
      routes * ASSUME.routeKb +
      batchesPerDay * 7 * avgBatchKb) /
    1024 ** 2;
  const newInstalls = Math.round(installs) * days;
  const updateDownloads = dau * ASSUME.updatedPlayerShare * ASSUME.assetUpdatesPerMonth * (days / 30);
  const cdnGb = ((newInstalls + updateDownloads) * ASSUME.assetPackMb) / 1024;

  const billing = bill({
    dbCalls: db.calls,
    fnCalls: world.fnCalls,
    gbs: world.gbs,
    dbGb,
    assetGb: ASSUME.assetStoredGb,
    assetRequests: newInstalls * ASSUME.assetFilesPerInstall,
    cdnGb,
    days,
  });
  const perMonth = (value) => Math.round((value * 30) / days);
  return {
    variant: variantName,
    config: cfg,
    targetDau: dau,
    days,
    measuredDau: Math.round(activeSum / days),
    installsPerDay: Math.round(installs),
    cities,
    clusters: world.clusterCount,
    routes,
    calls: {
      fnPerMonth: perMonth(world.fnCalls),
      dbPerMonth: perMonth(db.calls),
      dbReadsPerMonth: perMonth(db.reads),
      dbWritesPerMonth: perMonth(db.writes),
      dbFromSyncPerMonth: perMonth(world.dbBy.sync),
      dbFromTimerPerMonth: perMonth(world.dbBy.timer),
      dbFromEnterPerMonth: perMonth(world.dbBy.enter),
      dbFromRetirePerMonth: perMonth(world.dbBy.retire),
      fnGbsPerMonth: perMonth(world.gbs),
    },
    counts: world.counts,
    dbCallsPerSync: Math.round((world.dbBy.sync / Math.max(1, world.counts.sync)) * 10) / 10,
    dbCallsPerClusterSettle: Math.round((world.dbBy.timer / Math.max(1, world.counts.clusterSettles)) * 10) / 10,
    peak: { dbPerSecond: world.peakDb, fnPerSecond: world.peakFn, onlineSessions: peakOnline },
    planEnvQps: PLAN.envQps,
    storage: { dbGb: Math.round(dbGb * 100) / 100, avgBatchKb: Math.round(avgBatchKb * 10) / 10 },
    billing,
    wallSeconds: Math.round((Date.now() - started) / 1000),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [variant, dau, days] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4] ?? 30)];
  const result = await run(variant, dau, days);
  mkdirSync(join(here, '..', 'out'), { recursive: true });
  writeFileSync(join(here, '..', 'out', `load-${variant}-${dau}.json`), JSON.stringify({ assumptions: ASSUME, result }, null, 2));
  console.log(JSON.stringify({ ...result, config: undefined }));
}
