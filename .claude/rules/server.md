---
paths:
  - 'apps/server/**'
---

# 云函数规范：server

来源：ADR-0002、ADR-0005、ADR-0006 和 typescript-eslint 推荐规则。格式由 Prettier 负责，类型和常见问题由 TypeScript 严格模式和 ESLint 检查，分层由 dependency-cruiser（根目录 `.dependency-cruiser.cjs`，`pnpm arch`）检查；这里写需要判断的部分。

## 分层

只有一个 `game` 云函数，内部按模块分：

```
apps/server/src/
├── handler/              入口路由、身份、校验、限流
├── modules/<模块>/
│   ├── service/          业务规则
│   ├── repository/       数据访问接口，只有接口没有实现
│   └── index.ts          模块对外的公开接口
├── adapters/
│   ├── cloudbase/        云开发实现，只有这里能用 wx-server-sdk
│   └── memory/           内存实现，给本地、PR 预览和测试用
├── app.ts                组装模块
├── index.ts              云函数入口
└── memory.ts             内存后端入口
```

模块有 `identity`、`world`、`terrain`、`city`、`trade`、`ops`，各自拥有的集合见 `docs/architecture/overview.md`。

由 `pnpm arch` 强制：

- handler 只调用模块公开接口和 `libs/protocol`，不访问 repository 和 adapters。
- service 不依赖 handler 和 adapters，通过 repository 接口访问数据。
- repository 只定义接口。adapters 实现接口，不依赖 service 和 handler。
- 模块之间只能通过对方的 `index.ts` 调用，不直接读写其他模块的集合。
- `src/memory.ts` 能到达的代码也会在浏览器里运行，不能用 Node 专有 API。

## 输入和错误

- 外部输入在 handler 里用 `libs/protocol` 的 schema 校验，校验后的类型再往里传。不用 `any`。
- 错误码定义在 `libs/protocol`，可重试和不可重试分开。未知错误只返回 `requestId`，细节写进日志。
- 身份只取云函数上下文的 openid，不信任客户端传来的身份。
- 每个 Promise 都要 await 或显式处理。

## 数据和一致性

- 强一致的数据（位置占用、航线名额、结算单提交、玩家扣款）用条件更新或事务，并写测试覆盖重复执行。
- 邀请、航线和结算使用幂等键，操作日志使用递增序号，重跑不能重复入账。
- 文档结构变更按 `schemaVersion` 读取时兼容旧格式，字段先加后删，分两次发布。
- 数据库调用直接决定月费。新增调用要估算日活 1000 和 1 万时的调用量，能合并的读写就合并。

## 运行

- 函数是无状态的，进程内不保存请求之间的状态，只有带过期时间的配置缓存可以例外。
- 每个请求写一条结构化日志，带 `requestId`；不打印 openid 以外的个人信息和任何密钥。
- 配置从云函数环境变量读取，启动时校验。
- 部署命令不会改函数超时，默认是 3 秒。部署新函数后要在控制台把 `game` 的超时调到 `cloud/config.json` 写的值。

## 测试

- 用 Vitest。service 用内存 repository 测业务逻辑；handler 用 `createRouter` 加假的 service 测路由和错误处理。
- 内存实现测不出平台问题。涉及条件更新、事务和索引的改动，发布前要在真实云环境验证。
