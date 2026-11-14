#!/usr/bin/env node
// SessionStart 钩子：把这个克隆的 git 钩子目录指向仓库里提交的 .githooks，这样 .githooks/commit-msg 会在每次提交时检查提交信息。
// core.hooksPath 存在每个克隆自己的 git 配置里，不会跟着仓库走，所以新克隆、另一台机器和云端会话一开始都没有它。
// Claude Code 在每次会话开始时运行本脚本：第一次把值设上，之后什么都不输出。
// 克隆里已经把钩子目录用在别处（比如 .husky）时不去改它，只提示出来。
// 它不会拦住会话：输出的内容会作为上下文交给 Claude，退出码始终是 0。
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const HOOKS_DIR = '.githooks';
const PUSH_CHECK = 'node .github/scripts/check-commit-message.mjs --range origin/<目标分支>..HEAD';
const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function git(...args) {
  try {
    return {
      ok: true,
      out: execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    };
  } catch (error) {
    return { ok: false, out: String(error.stderr || error.message).trim() };
  }
}

function main() {
  const root = git('rev-parse', '--show-toplevel');
  if (!root.ok || !existsSync(join(root.out, HOOKS_DIR, 'commit-msg'))) return;

  const configured = git('config', '--get', 'core.hooksPath');
  const current = configured.ok ? configured.out : '';
  if (current !== '' && resolve(root.out, current) === resolve(root.out, HOOKS_DIR)) return;

  if (current !== '') {
    console.log(
      `这个克隆的 core.hooksPath 是 "${current}"，所以 ${HOOKS_DIR}/commit-msg 不会在提交时检查提交信息。` +
        `每次提交之后、每次推送之前运行 ${PUSH_CHECK}，并告诉用户：可以把他们的钩子挪进 ` +
        `${HOOKS_DIR}，再运行 git config core.hooksPath ${HOOKS_DIR}`,
    );
    return;
  }

  const set = git('config', 'core.hooksPath', HOOKS_DIR);
  console.log(
    set.ok
      ? `已把这个克隆的 core.hooksPath 设为 ${HOOKS_DIR}，${HOOKS_DIR}/commit-msg 会检查每次提交的提交信息。`
      : `没能设置 core.hooksPath（${set.out}），所以提交时不检查提交信息。每次提交之后、每次推送之前运行 ${PUSH_CHECK}，` +
          `并请用户运行：git config core.hooksPath ${HOOKS_DIR}`,
  );
}

main();
