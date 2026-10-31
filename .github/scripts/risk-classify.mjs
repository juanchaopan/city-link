#!/usr/bin/env node
// 给 PR 定风险等级，并判断这次提交是否已有人工确认。
// 在 GitHub Actions 里运行：读取 PR 改动的文件，对照 .github/risk-rules.txt 得出 low / medium / high，
// 打上对应的 risk:* 标签。人工确认只对看过的那次提交有效，所以 PR 收到新提交时不算已确认，并撤掉 human-reviewed 标签。
// 发布 PR（release/* 分支）一律算高风险；同一仓库里从 main 或 master 回合并的 PR 算低风险。
// 来自 fork 和 Dependabot 的 PR 拿到的令牌是只读的：这时只定级、不改标签，判断结果照样输出。
// 结果写入 GITHUB_OUTPUT 的 tier 和 approved，供后面的 job 使用。
//
// 在本地检验规则：node .github/scripts/risk-classify.mjs --dry-run [--head <分支名>] <文件路径> ...
import { readFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'risk-rules.txt');
const APPROVAL_LABEL = 'human-reviewed';
const LABELS = {
  'risk:low': { color: '0e8a16', description: '低风险：自动检查通过即可合并' },
  'risk:medium': { color: 'fbca04', description: '中风险：需要人工确认' },
  'risk:high': { color: 'b60205', description: '高风险：需要人工仔细确认' },
  [APPROVAL_LABEL]: { color: '5319e7', description: '我已亲自看过这次提交的改动' },
};

function globToRegExp(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*' && pattern[i + 2] === '/') {
      source += '(?:.*/)?';
      i += 2;
    } else if (c === '*' && pattern[i + 1] === '*') {
      source += '.*';
      i += 1;
    } else if (c === '*') {
      source += '[^/]*';
    } else if (c === '?') {
      source += '[^/]';
    } else {
      source += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

function loadRules() {
  const rules = { high: [], low: [] };
  let section = null;
  for (const raw of readFileSync(RULES_FILE, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(/^\[(high|low)\]$/);
    if (header) {
      section = header[1];
    } else if (!section) {
      throw new Error(`risk-rules.txt：「${line}」不在 [high] 或 [low] 下面`);
    } else {
      rules[section].push({ pattern: line, re: globToRegExp(line) });
    }
  }
  return rules;
}

function classify(files, rules, { headRef = '', sameRepo = true } = {}) {
  if (headRef.startsWith('release/')) {
    return { tier: 'high', reasons: [`发布 PR（${headRef}）：合并就是发布，需要你确认`] };
  }
  if (sameRepo && (headRef === 'main' || headRef === 'master')) {
    return { tier: 'low', reasons: [`从 ${headRef} 回合并：内容已经在 ${headRef} 上审查过`] };
  }
  const match = (file, list) => list.find((rule) => rule.re.test(file));
  const high = files.flatMap((file) => {
    const rule = match(file, rules.high);
    return rule ? [`${file}（命中 ${rule.pattern}）`] : [];
  });
  if (high.length > 0) return { tier: 'high', reasons: high };
  const notLow = files.filter((file) => !match(file, rules.low));
  if (notLow.length === 0) return { tier: 'low', reasons: ['所有改动都在 [low] 路径内'] };
  return { tier: 'medium', reasons: notLow.map((file) => `${file}（不在 [low] 路径内）`) };
}

const rules = loadRules();

if (process.argv[2] === '--dry-run') {
  const args = process.argv.slice(3);
  const headIndex = args.indexOf('--head');
  const headRef = headIndex >= 0 ? args.splice(headIndex, 2)[1] : '';
  const { tier, reasons } = classify(args, rules, { headRef });
  console.log([tier, ...reasons.map((reason) => `  ${reason}`)].join('\n'));
  process.exit(0);
}

const { REPO, PR_NUMBER, EVENT_ACTION, HEAD_REF, HEAD_REPO, GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } =
  process.env;
const gh = (...args) =>
  execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const lines = (text) => text.split('\n').filter(Boolean);
const issue = `repos/${REPO}/issues/${PR_NUMBER}`;

const files = lines(
  gh('api', `repos/${REPO}/pulls/${PR_NUMBER}/files`, '--paginate', '--jq', '.[].filename'),
);
const labels = lines(gh('api', `${issue}/labels`, '--paginate', '--jq', '.[].name'));
const { tier, reasons } = classify(files, rules, {
  headRef: HEAD_REF ?? '',
  sameRepo: HEAD_REPO === REPO,
});
const tierLabel = `risk:${tier}`;
const newCommit = EVENT_ACTION === 'synchronize';
const approved = labels.includes(APPROVAL_LABEL) && !newCommit;

function syncLabels() {
  for (const [name, { color, description }] of Object.entries(LABELS)) {
    gh(
      'label',
      'create',
      name,
      '--repo',
      REPO,
      '--color',
      color,
      '--description',
      description,
      '--force',
    );
  }
  const removeLabel = (name) =>
    gh('api', '--method', 'DELETE', `${issue}/labels/${encodeURIComponent(name)}`);
  for (const name of labels.filter((name) => name.startsWith('risk:') && name !== tierLabel))
    removeLabel(name);
  if (!labels.includes(tierLabel))
    gh('api', '--method', 'POST', `${issue}/labels`, '-f', `labels[]=${tierLabel}`);
  if (newCommit && labels.includes(APPROVAL_LABEL)) {
    removeLabel(APPROVAL_LABEL);
    gh(
      'api',
      '--method',
      'POST',
      `${issue}/comments`,
      '-f',
      `body=PR 有了新提交，\`${APPROVAL_LABEL}\` 标签已自动撤掉。看过新的改动后，请重新加上。`,
    );
  }
}

let labelNote = '';
try {
  syncLabels();
} catch (error) {
  labelNote = `令牌没有写权限（来自 fork 或 Dependabot 的 PR），没有更新标签：${String(error.stderr ?? error.message).trim()}`;
  console.warn(labelNote);
}

appendFileSync(GITHUB_OUTPUT, `tier=${tier}\napproved=${approved}\n`);
appendFileSync(
  GITHUB_STEP_SUMMARY,
  [
    `### 风险等级：${tier}`,
    '',
    ...reasons.slice(0, 50).map((reason) => `- ${reason}`),
    '',
    `人工确认：${tier === 'low' ? '不需要' : approved ? '已确认' : `尚未确认（需要 ${APPROVAL_LABEL} 标签${newCommit ? '，有新提交时要重新加' : ''}）`}`,
    labelNote ? `\n${labelNote}` : '',
    '',
  ].join('\n'),
);
