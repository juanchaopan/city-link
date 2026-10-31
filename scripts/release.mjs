#!/usr/bin/env node
// 发布到微信：部署 game 云函数，再把小游戏上传为体验版。提审和发布由维护者在微信后台操作。
// 由 .github/workflows/deploy.yml 在推送 v* 标签后运行，运行前要先 pnpm build。
// 环境变量：RELEASE_VERSION 版本号；MINIPROGRAM_PRIVATE_KEY_PATH 微信代码上传密钥的路径。
import { readFileSync } from 'node:fs';
import ci from 'miniprogram-ci';

const FUNCTION_NAME = 'game';
const CLIENT_DIR = 'apps/client/dist/wx';
const FUNCTION_DIR = `apps/server/dist/${FUNCTION_NAME}`;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

const version = requiredEnv('RELEASE_VERSION').replace(/^v/, '');
const privateKeyPath = requiredEnv('MINIPROGRAM_PRIVATE_KEY_PATH');
const { appId, cloudEnv } = JSON.parse(readFileSync('apps/client/config/wechat.json', 'utf8'));

const project = new ci.Project({
  appid: appId,
  type: 'miniGame',
  projectPath: CLIENT_DIR,
  privateKeyPath,
  ignores: ['node_modules/**/*'],
});

await ci.cloud.uploadFunction({
  project,
  env: cloudEnv,
  name: FUNCTION_NAME,
  path: FUNCTION_DIR,
  remoteNpmInstall: true,
});
console.log(`云函数 ${FUNCTION_NAME} 已部署到 ${cloudEnv}`);

await ci.upload({
  project,
  version,
  desc: `v${version}`,
  setting: { es6: false, minify: false },
});
console.log(`体验版 ${version} 已上传`);
