# 城市首席规划师（CityLink）

一款微信小游戏：每位玩家在城市群里经营一座城市，规划道路、公交地铁、铁路机场和分区，再和其他城市做贸易。

需求和架构见 [docs/README.md](docs/README.md)。

## 目录

| 目录            | 内容                                       |
| --------------- | ------------------------------------------ |
| `apps/client`   | 小游戏客户端，PixiJS，构建出网页版和微信版 |
| `apps/server`   | `game` 云函数，微信云开发                  |
| `libs/protocol` | 接口定义和协议版本                         |
| `libs/sim`      | 两端共用的规则                             |
| `libs/terrain`  | 地形和河网生成                             |

## 本地开发

需要 Node.js 24 和 pnpm（`corepack enable` 后自动使用仓库指定的版本）。

```
pnpm install
pnpm dev
```

打开终端里显示的地址就能运行网页版，后端是浏览器里的内存实现，不需要云环境。效果页在 `/gallery.html`。

## 自检

```
pnpm format      # 格式化
pnpm lint        # ESLint
pnpm arch        # 架构检查
pnpm typecheck   # 类型检查
pnpm test        # 单元测试
pnpm build       # 构建网页版、微信版和云函数
pnpm visual      # 截图回归，需要 Docker
```

外观是有意改的时候，运行 `pnpm visual:update` 更新基准图。

## 微信版

```
pnpm --filter @city-link/client build:wx
```

用微信开发者工具打开 `apps/client/dist/wx`。AppID 和云环境在 `apps/client/config/wechat.json`。

发布：推送 `v*` 标签后，流水线部署云函数并上传体验版，提审和发布在微信后台手动操作。
