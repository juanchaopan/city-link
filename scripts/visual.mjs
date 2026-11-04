#!/usr/bin/env node
// 视觉回归测试。基准图和操作系统、字体有关，所以统一在 Playwright 官方镜像里生成和比对。
// 仓库复制到容器里运行，避免容器碰到本机的 node_modules；基准图和差异图再复制回来。
// 镜像里的 Node 版本跟着镜像走，不一定带 corepack，所以按根目录 packageManager 写的版本用 npm 装 pnpm。
// 用法：node scripts/visual.mjs            和基准图比对
//       node scripts/visual.mjs --update   重新生成基准图
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CLIENT = 'apps/client';
const update = process.argv.includes('--update');
const { packageManager } = JSON.parse(readFileSync('package.json', 'utf8'));
const { devDependencies } = JSON.parse(readFileSync(`${CLIENT}/package.json`, 'utf8'));
const image = `mcr.microsoft.com/playwright:v${devDependencies['@playwright/test']}-noble`;

const inContainer = `
set -e
mkdir -p /work
tar -C /repo --exclude=node_modules --exclude=dist --exclude=.git --exclude=.claude -cf - . | tar -C /work -xf -
cd /work
npm install -g --silent ${packageManager}
CI=1 pnpm install --frozen-lockfile --ignore-scripts
pnpm rebuild esbuild
status=0
pnpm --filter @city-link/client visual ${update ? '--update-snapshots' : ''} || status=$?
rm -rf /repo/${CLIENT}/test-results
if [ -d ${CLIENT}/test-results ]; then cp -r ${CLIENT}/test-results /repo/${CLIENT}/test-results; fi
${update ? `cp -r ${CLIENT}/e2e/. /repo/${CLIENT}/e2e/` : ''}
exit $status
`;

const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--ipc=host',
    '-e',
    'CI=1',
    '-v',
    `${path.resolve('.')}:/repo`,
    '-v',
    'city-link-pnpm-store:/root/.local/share/pnpm/store',
    image,
    'sh',
    '-c',
    inContainer,
  ],
  { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
);

process.exit(result.status ?? 1);
