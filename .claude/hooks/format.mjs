#!/usr/bin/env node
// Claude Code 的 PostToolUse 钩子：Claude 每改完一个文件，运行 format.config.json 里对应规则的格式化和 lint 命令。
// 规则按扩展名和目录匹配：文件必须在规则的 dir 之内，几条都匹配时用 dir 最深的那条，
// 这样单仓库多组件时，每个组件用自己目录下的工具和配置。命令在规则的 dir 下运行。
// 格式化失败不拦截（多半是工具没装或文件类型不支持）；lint 不通过时以退出码 2 结束，
// Claude Code 会把错误输出交给 Claude，让它接着修。
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, relative, resolve, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const file = input.tool_input?.file_path;
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
const configPath = join(projectDir, '.claude', 'hooks', 'format.config.json');

if (!file || !existsSync(file) || !existsSync(configPath)) process.exit(0);

const inside = (dir, target) => {
  const rel = relative(dir, target);
  return !rel.startsWith('..') && !isAbsolute(rel);
};
if (!inside(projectDir, file)) process.exit(0);

const { rules = [] } = JSON.parse(readFileSync(configPath, 'utf8'));
const ext = extname(file).toLowerCase();
const match = rules
  .map((rule) => ({ rule, dir: resolve(projectDir, rule.dir ?? '.') }))
  .filter(({ rule, dir }) => rule.extensions.includes(ext) && inside(dir, file))
  .sort((a, b) => b.dir.length - a.dir.length)[0];
if (!match) process.exit(0);

const { rule, dir } = match;
const relFile = relative(dir, file).replaceAll('\\', '/');
const run = (command) =>
  spawnSync(command.replaceAll('{file}', `"${file}"`).replaceAll('{relfile}', `"${relFile}"`), {
    shell: true,
    cwd: dir,
    encoding: 'utf8',
  });

if (rule.format) run(rule.format);

if (rule.lint) {
  const result = run(rule.lint);
  if (result.status !== 0) {
    process.stderr.write(
      `${relative(projectDir, file)} 没有通过 lint（在 ${relative(projectDir, dir) || '.'} 下运行 ${rule.lint}）：\n` +
        `${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
    process.exit(2);
  }
}
