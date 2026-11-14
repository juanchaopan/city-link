# 界面效果图的生成代码

`../ui-screens/` 里的 110 张效果图都由这里的代码生成。要改图，改这里的页面定义，重出对应的图，再提交图；不要直接改图片。

## 怎么组成

| 文件 | 作用 |
|---|---|
| `screens.js` | 全部页面的清单，按编号排序；同一编号在几个分组里都有时只留前面的 |
| `screens-start.js`、`screens-system.js`、`screens-hud.js`、`screens-build.js`、`screens-map.js`、`screens-neighbor.js`、`screens-world.js` | 各组页面的定义：编号、标题、从哪来、右边的说明、手机画面怎么画 |
| `screens-common.js`、`parts-b.js`、`api.js` | 各页面共用的零件和画图接口 |
| `kit.css` | 界面的样式：金边、羊皮纸面板、按钮、徽章、标注 |
| `probe-64.png` | 美术探针的整城截图，城市卡片和参观缩略图用它做底（`kit.css` 的 `.thumbimg`） |
| `outer.html` | 整张图的版式：左边手机画面，右边说明 |
| `inner.html` | 手机画面：先让探针画出城市，再按页面定义叠界面 |
| `server.mjs`、`shoot.mjs` | 静态服务和逐张截图 |

## 怎么出图

底图是美术探针（`spikes/art-direction`）画的 2.5D 低多边形城市。探针的代码在标签 `archive/spike-art-direction` 里，不在 main 上。

1. 把探针取出到仓库外的一个目录，装依赖：
   ```
   git worktree add ../city-link-art-spike archive/spike-art-direction
   cd ../city-link-art-spike/spikes/art-direction
   pnpm install
   ```
2. 在仓库根目录的 `docs/design/ui-mock/` 里出图：
   ```
   cd docs/design/ui-mock
   SPIKE_DIR=<上面那个 spikes/art-direction 的路径> OUT_DIR=../ui-screens node shoot.mjs B1 G2
   ```
   参数是编号或编号前缀，不写就出全部。前缀会把同前缀的图一起出（`B1` 也会出 `B1a`、`B1n`、`B1o`），出完把不打算改的图用 `git restore` 还原。出图要显卡加速的 Chromium，一张约几秒到几十秒；一次别出太多张，内存紧时 Chromium 会被系统杀掉。
3. 出图的默认值是 1.25 倍、JPEG 质量 75，进仓库的图都按默认值出；`SCALE`、`QUALITY`、`PORT` 可以用环境变量改。
4. 出完用 `git worktree remove` 清掉探针目录；只删本地副本，标签和远端分支保留。

只有没画车的底图（开局预览、1 级空城）每次出图的字节完全一样；画了车的地图每次会不一样，所以不能用逐字节比较判断一张图改没改。只重出改过页面定义的图，别的图不要碰。

## 改图的规则

- 画面里的规则、数值、名称以 `../game-design.md`、`../data-model.md`、`../catalog.md`、`../ui-map.md` 为准，图和文档对不上时改这里的页面定义。
- 改了某张图的编号、来路或去向时，同步看 `../ui-map.md` 里对这张图的引用。
- 深青底金边的圆圈、小签和金色虚线框是标注，红底白字的圆点才是游戏里的红点。
