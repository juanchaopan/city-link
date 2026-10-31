'use strict';

// 对照实验：同样的生成代码，在 CPU 被占满时单次耗时的尾部会到多少。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { fill } = require('./run');
const OPT = require('./params');

const CLUSTERS = 10;
const OUT = path.join(__dirname, 'out');

const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
};

function pass() {
  const times = [];
  for (let seed = 1; seed <= CLUSTERS; seed++) {
    for (const record of fill(seed, 64, 3, OPT).records) times.push(record.ms);
  }
  return {
    cities: times.length,
    p50: Number(quantile(times, 0.5).toFixed(2)),
    p95: Number(quantile(times, 0.95).toFixed(2)),
    max: Number(Math.max(...times).toFixed(2)),
    over200ms: times.filter((ms) => ms > 200).length,
  };
}

async function main() {
  pass();
  const quiet = pass();
  const burners = [];
  const count = os.cpus().length * 3;
  for (let i = 0; i < count; i++) {
    burners.push(spawn(process.execPath, ['-e', 'for(;;){let a=[];for(let i=0;i<1e5;i++)a.push(i*i)}'], { stdio: 'ignore' }));
  }
  await new Promise((resolve) => { setTimeout(resolve, 2000); });
  const loaded = pass();
  for (const burner of burners) burner.kill();
  const report = { burners: count, quiet, loaded };
  fs.writeFileSync(path.join(OUT, 'contention.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 1));
}

main();
