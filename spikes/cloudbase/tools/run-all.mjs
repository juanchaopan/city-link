// 依次跑各方案。1 万日活的稳态每天差别不大，只跑 7 天再折算成一个月。
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const runs = process.argv.slice(2).map((spec) => spec.split(':'));

for (const [variant, dau, days] of runs) {
  const result = spawnSync(process.execPath, [join(root, 'sim', 'load.mjs'), variant, dau, days], { encoding: 'utf8' });
  console.log(result.status, variant, dau, days, result.stdout.trim().slice(0, 700), result.stderr.trim().slice(0, 300));
}
