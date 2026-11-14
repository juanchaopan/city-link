# 开工设计画布的源文件

这里是设计画布（Design 类型的 Artifact）的全部源文件。画布在 claude.ai 上的地址是 https://claude.ai/artifact/3ehhHyUbPXFu16nNQoBfn7 。仓库里的文件和它发布的内容一致。

## 文件

- `project/canvas.json`：画布的索引，记录六个画板的位置、大小和顺序。
- `project/Main.dc.html`：总览，各区域的开工状态、写代码前要补的事。
- `project/Screens.dc.html`：页面清单，每个页面的编号、形式、从哪进、去哪。
- `project/Decisions.dc.html`：待拍板的决定和它们的状态。
- `project/Fields.dc.html`：输入页的字段规格和按住的按钮。
- `project/States.dc.html`：异步操作的状态（同步、看视频、修线头、期限、建造、离线、破产、等待和失败）。
- `project/Data.dc.html`：每个页面读写哪些数据、调哪个接口。

## 内容的依据

页面和规则以 `docs/design/` 下的 ui-map.md、game-design.md、data-model.md、catalog.md 为准。画布只是把它们整理成开工用的清单，两边不一致时以这些文档为准，并回来改画布。

## 重新发布

画布内容改了以后，在 `project/` 下修改对应的文件，然后用 Artifact 工具发布到同一个地址，`root` 指向本目录，`file_path` 指向改过的文件。`project/support.js` 是平台提供的运行时文件，不在本目录里，不要手动加入。
