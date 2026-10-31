# AGENTS.md

给 AI 编程助手（Claude Code、Codex、Cursor、GitHub Copilot 等）的入口说明。不管用哪个工具，开始改动之前先读：

1. `CLAUDE.md`：组件、自检命令、代码规范、写代码的方式、分支和提交规则。文件名是 CLAUDE，内容对所有工具通用。
2. `.claude/rules/` 下和要改的目录对应的规范（每个文件开头的 `paths` 写着它管哪些目录），包括必须遵守的分层规则。
3. `REVIEW.md`：PR 会按它审查。
4. `docs/README.md`：需求、架构、设计、决策记录和路线图的索引。

所有改动通过 PR 合并。合并前必须通过 CI（测试、lint、架构检查、重复代码检查、提交信息检查）和审查；中、高风险的改动还需要维护者人工确认。
