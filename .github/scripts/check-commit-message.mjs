#!/usr/bin/env node
// 检查提交信息是否符合 Conventional Commits：<类型>(<范围>)!: <描述>
// 本地由 .githooks/commit-msg 调用：node check-commit-message.mjs --file <提交信息文件>
// CI 检查 PR 的全部提交：node check-commit-message.mjs --range <base>..<head>
// 合并提交和 git 生成的 Revert 提交不检查。fixup!、squash! 提交本地允许（之后要整理掉），CI 里不允许。
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
];
const MAX_HEADER_LENGTH = 100;
const HEADER = new RegExp(`^(${TYPES.join('|')})(\\([^()\\s][^()]*\\))?!?: \\S`);
const EXAMPLE = 'feat(auth): 支持邮箱登录 (#12)';

function check(message, { allowFixups }) {
  const lines = message.split(/\r?\n/).filter((line) => !line.startsWith('#'));
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  const header = (lines[0] ?? '').trim();

  if (header === '') return '提交信息是空的';
  if (/^Merge /.test(header) || /^Revert "/.test(header)) return null;
  if (/^(fixup|squash|amend)! /.test(header)) {
    return allowFixups ? null : 'fixup!/squash! 提交要在合并前整理掉';
  }
  if (!HEADER.test(header)) {
    return `第一行要写成 "<类型>(<范围>): <描述>"，类型可选 ${TYPES.join('、')}，例如：${EXAMPLE}`;
  }
  if ([...header].length > MAX_HEADER_LENGTH) return `第一行超过了 ${MAX_HEADER_LENGTH} 个字符`;
  if (lines.length > 1 && lines[1].trim() !== '') return '第一行和正文之间要空一行';
  return null;
}

const [mode, value] = process.argv.slice(2);
const failures = [];

if (mode === '--file' && value) {
  const error = check(readFileSync(value, 'utf8'), { allowFixups: true });
  if (error) failures.push({ id: '本次提交', error });
} else if (mode === '--range' && value) {
  const log = execFileSync('git', ['log', '--format=%H%x00%B%x1e', value], { encoding: 'utf8' });
  for (const record of log.split('\x1e')) {
    const [hash, body] = record.replace(/^\s+/, '').split('\x00');
    if (!hash) continue;
    const error = check(body ?? '', { allowFixups: false });
    if (error) failures.push({ id: hash.slice(0, 8), error, header: (body ?? '').split('\n')[0] });
  }
} else {
  console.error('用法：check-commit-message.mjs --file <提交信息文件> | --range <base>..<head>');
  process.exit(1);
}

if (failures.length > 0) {
  for (const { id, error, header } of failures) {
    console.error(`✗ ${id}${header ? `「${header}」` : ''}：${error}`);
  }
  process.exit(1);
}
