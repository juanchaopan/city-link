---
description: 先自检、简化和本地审查，再开 PR：运行 CLAUDE.md 里的自检命令，做一轮简化审查，运行本地 code-review 和 security-review 以及提交信息检查，问题处理完后按模板创建 PR 并开启自动合并
---

把当前改动整理成一个能审查的 PR。按顺序做。每一步都汇报真实的结果，不要只说"已完成"：通过，或者失败的行和输出的最后几行。长输出要过滤（`<命令> 2>&1 | tail -n 30`），不要整段打印。

1. **分支**：读 CLAUDE.md「分支与提交」，确定这个改动的目标分支（GitHub Flow 是 main；Git Flow 下，普通改动是 develop，hotfix 是 main）。如果当前就在目标分支或其他受保护的分支上，按命名规则新建分支。工作区里有和这次任务无关的改动时，先问我怎么处理。运行 `git fetch origin`，再运行 `git config core.hooksPath`：它没有输出 `.githooks` 时，告诉我本地的提交信息钩子没开，建议我运行一次 `! git config core.hooksPath .githooks`；不管开没开都继续，第 6 步会自己检查每条提交信息。
2. **自检**：对改到的每个组件，依次运行 CLAUDE.md「自检命令」里的命令，再在仓库根目录运行 `npx jscpd .`。刚好在现在这些文件上已经通过的命令不重跑。有失败就修，修完从头再跑，直到全部通过。如果改了界面，截图和设计稿对照一下（用户确认过的效果图在 `docs/design/ui-screens/`）。
3. **简化**：用 Skill 工具运行 `simplify`，检查这次改动有没有可以复用的已有代码、多余的抽象、重复的逻辑，以及读起来像打补丁的地方（见 CLAUDE.md「写代码的方式」）。改了代码就回到第 2 步。
4. **代码审查**：用 Skill 工具运行 `code-review`，审查当前分支相对目标分支的改动。每条意见要么修掉，要么说明为什么不修。修过代码就回到第 2 步。
5. **安全审查**：用 Skill 工具运行 `security-review`，每条意见同样处理。
6. **整理提交**：
   - 检查 `git log origin/<目标分支>..HEAD`。每个提交只做一件事、不夹带无关改动；重构和功能改动分在不同的提交里。还没提交的改动，按逻辑拆成几个提交。
   - 运行 `node .github/scripts/check-commit-message.mjs --range origin/<目标分支>..HEAD`。它用的规则和 CI 的 `commit-lint` 完全一样（类型、格式、第一行不超过 100 个字符、第一行和正文之间空一行、不留 fixup! 提交），不管本地钩子开没开都一样。不要用肉眼判断来代替它。
   - 推送之前把它报出的每个提交改好：最后一个提交用 `git commit --amend -m "<信息>"`；更早的提交用在那里停住的变基：`GIT_SEQUENCE_EDITOR="sed -i.bak -e 's/^pick <短哈希>/edit <短哈希>/'" git rebase -i origin/<目标分支>`，再 `git commit --amend -m "<信息>"` 和 `git rebase --continue`。改完重新运行检查，直到通过。
   - 已经在远端的历史不改写：后续改动用新提交，分支用合并来跟上目标分支。已经推送的提交没通过检查时，停下来问我：是改写这个分支的提交并用 `git push --force-with-lease` 推送，还是把工作挪到新分支和新 PR。
7. **推送并创建 PR**：推送分支，用 `gh pr create --base <目标分支>`。正文按 `.github/pull_request_template.md` 的结构填写：
   - 改了什么、为什么：一两句话说清意图；对应 issue 写 `Closes #<编号>`。
   - Testing：第 2 步实际运行的命令和结果摘要；哪些重型测试种类在本地跑了、哪些留给 CI，以及原因；改了界面的，把实现出来的画面和用户确认过的效果图并排附上，改的是已有画面的再附改动前的截图。
   - Risk：对照 `.github/risk-rules.txt` 判断低、中、高，写出理由。
   - How to revert：怎么撤回；涉及数据或配置的，写清楚怎么恢复。
   - 检查清单不要勾，留给我自己确认后勾。
8. **开启自动合并**：按 CLAUDE.md 的合并方式运行 `gh pr merge <编号> --auto --merge`（合并方式是 squash 或 rebase 时换成对应参数）。GitHub 会在所有检查通过、评论线程处理完之后自动合并。
9. **汇报**：给出 PR 链接和风险等级。如果是中风险或高风险，提醒我先亲自读完 diff，确认没问题后再给 PR 加 `human-reviewed` 标签，加上后会自动合并。

之后每次往这个分支推送（修审查意见、把目标分支合进来），都先运行第 6 步的提交信息检查。

$ARGUMENTS
