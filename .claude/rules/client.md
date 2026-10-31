---
paths:
  - 'apps/client/**'
---

# PixiJS 小游戏规范：client

来源：ADR-0003、ADR-0004、ADR-0008 和探针的真机结果。格式由 Prettier 负责，类型和常见问题由 TypeScript 严格模式和 ESLint 检查，分层由 dependency-cruiser（根目录 `.dependency-cruiser.cjs`，`pnpm arch`）检查；这里写需要判断的部分。

## 分层

```
apps/client/
├── src/
│   ├── platform/      微信和网页适配：画布、输入、存储、网络、分享
│   │   ├── types.ts   上层唯一能依赖的接口
│   │   ├── web/
│   │   └── wx/
│   ├── net/           调用接口、操作日志、离线队列
│   ├── game/          本地城市状态、模拟循环、交互流程
│   ├── render/        Pixi 分块绘制地图、建筑和线路
│   ├── ui/            面板和按钮
│   ├── gallery/       效果页，只进网页版
│   ├── app.ts         组装各层
│   ├── main.web.ts    网页入口
│   └── main.wx.ts     微信入口
├── vite/              微信构建目标
├── e2e/               截图回归
└── config/wechat.json AppID 和云环境
```

由 `pnpm arch` 和 `pnpm lint` 强制：

- 依赖方向：`ui` → `render` → `game` → `net` → `platform`。`render` 也可以直接用 `platform`，`ui` 不能直接用 `net` 和 `platform`。
- `game` 不依赖 Pixi，这样模拟可以脱离画面运行和测试。它只用 `libs/terrain` 的类型。
- `platform` 只依赖 `libs/protocol`；`web` 和 `wx` 互不依赖，只共用 `types.ts`。
- `wx`、`document`、`window` 这些全局对象只能出现在 `platform/`、`main.*.ts` 和 `gallery/`。
- 内存后端 `@city-link/server/memory` 只能由 `main.web.ts` 和 `gallery/` 引用，不能进微信包。

## 微信环境

这些都是真实环境踩过的，改相关代码时要在开发者工具或真机上验证，网页版发现不了：

- 不能动态生成代码。依赖库如果用 `new Function` 或 `eval`，要找到它的关闭开关；Pixi 靠入口的 `pixi.js/unsafe-eval`，zod 靠 `libs/protocol` 里的 `jitless`。
- wasm 只能从代码包路径加载，见 `vite/wx-target.ts` 和 `vite/yoga-load.wx.js`。升级 `yoga-layout` 或 `@pixi/layout` 后要重新验证。
- `platform/wx/env.ts` 必须最先执行，因为它要在导入 Pixi 之前补全局对象。
- 主包不超过 4MB，构建时检查；素材放云存储，不进主包。
- 顶部避开刘海和胶囊按钮，底部避开 Home 指示条，都从 `platform.safeInsets()` 取。
- 新增依赖前，确认它不访问 DOM，并在微信模拟器里跑一遍。

## 绘制和性能

- 地图按 16×16 分块，用 ParticleContainer 绘制。不要给每个地块或车辆单独建 Sprite，探针显示这样只有约 4 帧。
- 模拟按固定步长运行，渲染按帧读取只读状态，两者分开。路网计算按帧分摊，每帧最多 2 毫秒。
- `render` 只读 `game` 的状态，修改状态都走 `game` 的函数。
- 不用的纹理和容器要销毁。切换场景后检查对象数量有没有回落。
- 坐标、尺寸和格子大小用命名常量，不写魔法数字。

## 界面

- 颜色、字号、间距和圆角只用 `ui/tokens.ts` 里的令牌。
- 文字用 `ui/text.ts` 的 `createText`，它修正了中文下沿被切掉的问题。
- 布局用 `@pixi/layout`，按钮用 `@pixi/ui`。
- 新的素材、组件和状态都要加进效果页 `src/gallery/`，这样才有截图回归。

## 数据

- 服务端返回的数据在 `net` 层用 `libs/protocol` 的 schema 校验，校验后才往上传。
- 资金、商品、等级、地形和贸易由服务端决定，客户端只做预测和展示。
- 规则数值放在 `libs/sim`，不在客户端写死。

## 测试

- `game`、`net` 用 Vitest 测，不依赖 Pixi；用假的 `CallGame` 代替服务端。
- 画面用效果页截图回归：`pnpm visual`。外观是有意改的时候运行 `pnpm visual:update`，把新基准图和代码一起提交，并在 PR 里写明变化。两个命令都要 Docker 正在运行。
- 网页截图不代表微信真机。改了 `platform/wx`、`vite/` 或升级 Pixi 时，要用 `pnpm --filter @city-link/client build:wx` 构建，再用开发者工具打开 `apps/client/dist/wx` 验证。
