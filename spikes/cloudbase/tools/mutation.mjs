// 变异测试：逐个改坏实现，确认故障注入测试能发现。复制到 out/mutants 下运行，不改源码。
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = join(root, 'out', 'mutants');

const mutants = [
  ['入账不检查结算单序号', 'src/settlement.mjs', '(city) => (city.appliedSeq[batch.clusterId] ?? 0) < batch.seq', '() => true'],
  ['不补做未完成的结算单', 'src/settlement.mjs', 'if (latest && !latest.done) await applyBatch(db, latest);', ''],
  ['提交不检查编号唯一', 'src/db.mjs', 'if (docs.has(doc.id)) return false;', ''],
  ['结算单游标不继承', 'src/settlement.mjs', 'cursors: { ...cursors, ...nextCursors },', 'cursors: nextCursors,'],
  ['同步不去重', 'src/settlement.mjs', '(doc) => doc.opSeq < opSeq && doc.funds >= cost', '(doc) => doc.funds >= cost'],
  ['同步读取后不判断序号', 'src/settlement.mjs', 'if (ops.length > 0 && opSeq > city.opSeq) {', 'if (ops.length > 0) {'],
  ['入账先写标记后写钱', 'src/settlement.mjs', 'city.funds += delta.funds;', ''],
  ['租约永远可抢', 'src/settlement.mjs', '(c) => c.leaseUntil <= now', '() => true'],
];

const results = [];
for (const [name, file, from, to] of mutants) {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  cpSync(join(root, 'src'), join(work, 'src'), { recursive: true });
  cpSync(join(root, 'test'), join(work, 'test'), { recursive: true });
  const target = join(work, file);
  const source = readFileSync(target, 'utf8');
  if (!source.includes(from)) throw new Error(`找不到要改的代码：${name}`);
  writeFileSync(target, source.replace(from, to));
  const run = spawnSync(process.execPath, ['--test', join(work, 'test', 'settlement.test.mjs')], {
    encoding: 'utf8',
    timeout: 120000,
  });
  const caught = run.status !== 0;
  const failed = (run.stdout.match(/^✖ .*$/gm) ?? []).filter((line) => !line.includes('failing')).length;
  results.push({ name, caught, failed });
  console.log(caught ? '抓到' : '没抓到', name, failed);
}
rmSync(work, { recursive: true, force: true });
writeFileSync(join(root, 'out', 'mutation.json'), JSON.stringify(results, null, 2));
