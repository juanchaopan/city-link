---
paths:
  - 'libs/**'
---

# 共用库规范：protocol、sim、terrain

这三个库在手机和云函数两端运行，客户端预测和服务端校验必须用同一份代码。来源：ADR-0001、ADR-0002、ADR-0009。

## 依赖

由 `pnpm arch` 强制：

- `libs/protocol` 和 `libs/terrain` 不依赖其他库，`libs/sim` 只依赖 `libs/protocol`。
- 共用库不依赖 apps、Pixi 和云开发 SDK。
- TypeScript 配置里没有 DOM 和 Node 的类型，所以 `window`、`process`、`console` 用了就会报错。

## 写法

- `sim` 和 `terrain` 只放纯函数：输入相同，输出就相同。不读时间、不用 `Math.random`，时间和随机种子都作为参数传入，否则两端的结果会不一致。
- 地形的结果只由种子和相邻城市决定，同样的输入必须生成完全相同的地形。
- 规则数值放在 `libs/sim`，用命名常量，随版本发布。
- 协议变更时更新 `PROTOCOL_VERSION`。服务端要兼容当前和上一版，所以字段先加后删。
- 微信禁止动态生成代码，所以 `libs/protocol` 关闭了 zod 的 JIT，不要去掉。

## 测试

- 用 Vitest，这里的代码最容易测，新规则都要有测试。
- 用固定种子断言确定的结果。地形和结算要加不变量测试，例如资金守恒、相邻边界连续。
