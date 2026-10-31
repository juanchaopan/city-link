#!/usr/bin/env node
// 给 AI 审查员打分：把过去真实出过 bug 的改动（以及确认没问题的改动）重新交给审查员，
// 统计它抓到了多少 bug、在干净的改动上误报了多少。改了 REVIEW.md、CLAUDE.md 或换了模型后跑一次，
// 分数没有上升就撤回那次修改。每次的结果追加到 evals/results.jsonl。
//
// 用法：node evals/run-review-evals.mjs [案例 id ...]
// 环境变量：EVAL_MODEL 指定模型；EVAL_LINE_TOLERANCE 行号允许的偏差，默认 10。
import { readFileSync, readdirSync, appendFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const evalsDir = dirname(fileURLToPath(import.meta.url));
const casesDir = join(evalsDir, 'review-cases');
const resultsFile = join(evalsDir, 'results.jsonl');
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const lineTolerance = Number(process.env.EVAL_LINE_TOLERANCE ?? 10);
const model = process.env.EVAL_MODEL;
const maxBuffer = 64 * 1024 * 1024;

function parseCase(path) {
  const text = readFileSync(path, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error(`${path}：开头缺少 --- 包起来的元数据`);
  const meta = { expect: 'bug' };
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^(\w+):\s*(.*)$/);
    if (field) meta[field[1]] = field[2].trim();
  }
  if (!meta.id) throw new Error(`${path}：缺少 id`);
  if (!['bug', 'clean'].includes(meta.expect))
    throw new Error(`${path}：expect 只能是 bug 或 clean`);
  if (meta.expect === 'bug' && !(meta.file && meta.line))
    throw new Error(`${path}：bug 案例需要 file 和 line`);
  return meta;
}

function diffFor(c) {
  const options = { cwd: repoRoot, encoding: 'utf8', maxBuffer };
  if (c.pr) return execFileSync('gh', ['pr', 'diff', c.pr], options);
  if (c.base && c.head) return execFileSync('git', ['diff', c.base, c.head], options);
  throw new Error('需要 pr，或者同时提供 base 和 head');
}

function readRepoFile(name) {
  const path = join(repoRoot, name);
  return existsSync(path) ? readFileSync(path, 'utf8') : '（无）';
}

function buildPrompt(diff) {
  return [
    '你是这个项目的代码审查员。下面是项目规范（CLAUDE.md）、审查标准（REVIEW.md）和一段待审查的 diff。',
    '找出这段 diff 引入的真实问题，按 REVIEW.md 的要求判断严重程度。',
    '只输出一个 JSON 数组，不要输出任何其他文字。每个元素的格式：',
    '{"file": "相对仓库根目录的路径", "line": 改动后文件中的行号, "severity": "Important" | "Nit" | "Pre-existing", "summary": "一句话说明"}',
    '没有问题就输出 []。',
    '',
    '=== CLAUDE.md ===',
    readRepoFile('CLAUDE.md'),
    '',
    '=== REVIEW.md ===',
    readRepoFile('REVIEW.md'),
    '',
    '=== diff ===',
    diff,
  ].join('\n');
}

function runClaude(args, input) {
  const options = { input, cwd: repoRoot, encoding: 'utf8', maxBuffer };
  // Windows 上的 claude 可能是 .cmd 包装脚本，只能经由 shell 启动，所以把参数加引号拼成一条命令。
  if (process.platform === 'win32') {
    return spawnSync(['claude', ...args.map((arg) => `"${arg}"`)].join(' '), {
      ...options,
      shell: true,
    });
  }
  return spawnSync('claude', args, options);
}

function review(prompt) {
  const result = runClaude(
    ['-p', '--output-format', 'json', ...(model ? ['--model', model] : [])],
    prompt,
  );
  if (result.status !== 0) throw new Error(`claude 运行失败：${result.stderr || result.stdout}`);
  const text = JSON.parse(result.stdout).result ?? '';
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error(`审查员没有返回 JSON 数组：${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1));
}

const normalizePath = (path) => String(path).replaceAll('\\', '/').replace(/^\.\//, '');

function score(c, findings) {
  const important = findings.filter((f) => f.severity === 'Important');
  if (c.expect === 'clean') {
    return { pass: important.length === 0, detail: `${important.length} 条 Important 误报` };
  }
  const hit = important.find(
    (f) =>
      normalizePath(f.file) === normalizePath(c.file) &&
      Math.abs(Number(f.line) - Number(c.line)) <= lineTolerance,
  );
  return {
    pass: Boolean(hit),
    detail: hit
      ? hit.summary
      : `没有在 ${c.file}:${c.line} 附近报 Important（共 ${findings.length} 条意见）`,
  };
}

const only = new Set(process.argv.slice(2));
const cases = readdirSync(casesDir)
  .filter((name) => name.endsWith('.md') && !name.startsWith('_'))
  .map((name) => parseCase(join(casesDir, name)))
  .filter((c) => only.size === 0 || only.has(c.id));

if (cases.length === 0) {
  console.log('evals/review-cases/ 里还没有案例。复制 _template.md 写一个。');
  process.exit(0);
}

const rows = [];
for (const c of cases) {
  let row;
  try {
    row = { id: c.id, expect: c.expect, ...score(c, review(buildPrompt(diffFor(c)))) };
  } catch (error) {
    row = { id: c.id, expect: c.expect, pass: false, detail: `出错：${error.message}` };
  }
  rows.push(row);
  console.log(`${row.pass ? '✓' : '✗'} ${row.id} [${row.expect}] ${row.detail}`);
}

const bugRows = rows.filter((r) => r.expect === 'bug');
const cleanRows = rows.filter((r) => r.expect === 'clean');
const caught = bugRows.filter((r) => r.pass).length;
const quiet = cleanRows.filter((r) => r.pass).length;
console.log(
  `\n抓到 bug：${caught}/${bugRows.length}　干净改动没有误报：${quiet}/${cleanRows.length}`,
);

const reviewMd = join(repoRoot, 'REVIEW.md');
appendFileSync(
  resultsFile,
  `${JSON.stringify({
    date: new Date().toISOString(),
    model: model ?? 'default',
    reviewMd: existsSync(reviewMd)
      ? execFileSync('git', ['hash-object', reviewMd], { encoding: 'utf8' }).trim()
      : null,
    caught,
    bugs: bugRows.length,
    quiet,
    cleans: cleanRows.length,
    failed: rows.filter((r) => !r.pass).map((r) => r.id),
  })}\n`,
);
