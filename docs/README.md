# 项目文档

这些文档是项目的"共同记忆"。AI 每次做事前先读相关的部分，做完后更新它们；人随时可以读、可以改。

| 位置 | 内容 | 由谁维护 |
|---|---|---|
| `product/vision.md` | 产品愿景：给谁用、解决什么问题、怎样算成功、范围和约束 | /kickoff 创建，/change 更新 |
| `product/requirements.md` | 需求条目（REQ-xxx）：用户故事和验收标准 | /kickoff 或 /onboard 创建，/change 更新 |
| `product/glossary.md` | 业务术语表 | /kickoff 创建，/change 更新 |
| `product/open-questions.md` | 还没定下来的问题 | 各阶段都会更新 |
| `architecture/overview.md` | 架构：分层、组件、部署、数据、故障处理 | /architect 或 /onboard 创建，/architect 更新 |
| `architecture/tech-debt.md` | 技术债和质量基线 | /onboard 创建，处理一项更新一项 |
| `adr/` | 架构决策记录，每个重要决策一个文件 | /architect、/spike 新增 |
| `design/` | 详细设计：一批类、接口、模块要重新设计时的方案 | /change 新增 |
| `roadmap.md` | 里程碑和 issue 列表，进度以 GitHub issue 为准 | /roadmap 创建，/change 更新 |
| `changes/` | 较大变更的记录：变了什么、为什么、影响了哪些文档和代码 | /change 新增 |

## 约定

- 需求编号 REQ-001 起，架构决策编号 ADR-0001 起。编号不复用：作废的条目保留并标注"已废弃"，写明被哪一条替代。
- 文档和代码一样通过 PR 修改。
- 文档和代码对不上时，先弄清哪个是对的，再一起改好。
- 从代码或文档推断出来、还没经用户确认的内容，来源标为"推断"。
