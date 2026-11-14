# 详细设计

这里是《城市首席规划师》开发时照着做的设计：游戏规则、数据、建筑目录、界面和两端的实现大纲。需求条目在 `docs/product/requirements.md`，架构在 `docs/architecture/overview.md`。

## 文档

| 文件 | 内容 | 状态 |
|---|---|---|
| `game-design.md` | 怎么玩：世界结构、地图上的对象、各系统的规则和因果、经济、升级、时间和离线、社交、通知 | 已确认（2026-11-14） |
| `data-model.md` | 数据怎么存：世界、玩家和城市、存档、已核数据、边界接口和货运、入账和校验、站内信、更新节拍、成本估算 | 草稿（2026-11-04） |
| `catalog.md` | 分区里长出什么、楼的尺寸表、奖励建筑、公共和特殊建筑 | 草稿（2026-11-04） |
| `ui-map.md` | 玩家能看到的全部页面、跳转、界面原则 | 2026-11-04，每个页面都配了效果图 |
| `sim-impl.md` | 共用规则 `libs/sim` 的实现大纲 | 开发前总审的实现大纲 |
| `server-impl.md` | 服务端 `game` 云函数各模块的实现大纲 | 开发前总审的实现大纲 |
| `ui-screens/` | 110 张界面效果图，按页面编号命名 | 由 `ui-mock/` 生成 |
| `ui-mock/` | 效果图的生成代码，改图改这里再重出 | 见目录里的 README |
| `canvas/` | 开工设计画布的源文件：页面清单、字段、状态、数据 | 见目录里的 README |

文档之间对不上时以 `game-design.md` 为准，再回来改其他文档。数值（价格、门槛、半径、费率、红线、系数）统一放在 `docs/product/open-questions.md` 的 Q-006。

## 页面索引

页面编号的第一个字母是分组，带小写字母的编号（比如 B2b、G2a）是同一个页面的别的状态或分项。每张图怎么看见 `ui-map.md` 开头的“怎么看效果图”，页面之间怎么跳见 `ui-map.md` 第 2 节。

### A 开局（`ui-map.md` 第 3 节；规则见 `game-design.md` 第 2 节“位置怎么分配”、第 3 节）

| 编号 | 页面 | 效果图 |
|---|---|---|
| A1 | 开局：位置预览 | `ui-screens/A1.jpg` |
| A1b | 开局：换过位置以后 | `ui-screens/A1b.jpg` |
| A2 | 开局：给城市取名 | `ui-screens/A2.jpg` |
| A3 | 新手引导：第 1 到 3 步 | `ui-screens/A3.jpg` |
| A3b | 新手引导：第 4、5 步 | `ui-screens/A3b.jpg` |
| A3c | 新手引导：第 1 步画路 | `ui-screens/A3c.jpg` |

### B 主界面和偶尔出现的时刻（`ui-map.md` 第 4 节；B5 也见第 3 节）

| 编号 | 页面 | 效果图 |
|---|---|---|
| B1 | 主界面 | `ui-screens/B1.jpg` |
| B1a | 主界面：1 级的空城 | `ui-screens/B1a.jpg` |
| B1n | 主界面：夜里 | `ui-screens/B1n.jpg` |
| B1o | 没网时打开游戏 | `ui-screens/B1o.jpg` |
| B2 | 打开游戏：离线收益 | `ui-screens/B2.jpg` |
| B2b | 离线收益：离开不到 8 小时 | `ui-screens/B2b.jpg` |
| B2c | 离线收益：翻倍以后 | `ui-screens/B2c.jpg` |
| B2d | 离线收益：广告不可用 | `ui-screens/B2d.jpg` |
| B3 | 升级仪式 | `ui-screens/B3.jpg` |
| B3b | 升级仪式：没有升级奖励 | `ui-screens/B3b.jpg` |
| B4 | 资金为负和破产保护 | `ui-screens/B4.jpg` |
| B5 | 微信订阅授权 | `ui-screens/B5.jpg` |
| B6a | 看视频领钱：到账中 | `ui-screens/B6a.jpg` |
| B6b | 看视频领钱：广告不可用 | `ui-screens/B6b.jpg` |

### C 顶部的四个数（`ui-map.md` 第 5 节；规则见 `game-design.md` 第 10、11 节）

| 编号 | 页面 | 效果图 |
|---|---|---|
| C1 | 钱的小卡 | `ui-screens/C1.jpg` |
| C1a | 钱的小卡：1 级 | `ui-screens/C1a.jpg` |
| C1b | 钱的小卡：资金为负 | `ui-screens/C1b.jpg` |
| C2 | 钱从哪来：住宅税 | `ui-screens/C2.jpg` |
| C2a | 钱花在哪：道路维护费 | `ui-screens/C2a.jpg` |
| C2b | 钱从哪来：过路费 | `ui-screens/C2b.jpg` |
| C3 | 人口小卡 | `ui-screens/C3.jpg` |
| C4 | 满意度小卡 | `ui-screens/C4.jpg` |
| C5 | 等级小卡（满级） | `ui-screens/C5.jpg` |

### D 建造（`ui-map.md` 第 6 节；规则见 `game-design.md` 第 4、5、6、8 节）

| 编号 | 页面 | 效果图 |
|---|---|---|
| D1 | 建造托盘：道路和铁路 | `ui-screens/D1.jpg` |
| D1b | 建造托盘的“新”：点过以后消失 | `ui-screens/D1b.jpg` |
| D2 | 建造托盘：奖励建筑 | `ui-screens/D2.jpg` |
| D2b | 奖励建筑卡片的几种样子 | `ui-screens/D2b.jpg` |
| D3 | 画路（松手以后） | `ui-screens/D3.jpg` |
| D3b | 画到边界修线头 | `ui-screens/D3b.jpg` |
| D3c | 修线头：这条边接不了，或线没连到主路网 | `ui-screens/D3c.jpg` |
| D4 | 画路碰到高速公路：匝道自动出现 | `ui-screens/D4.jpg` |
| D4b | 匝道接上邻居修来的高速公路 | `ui-screens/D4b.jpg` |
| D5 | 划区 | `ui-screens/D5.jpg` |
| D6 | 放公共服务 | `ui-screens/D6.jpg` |
| D7 | 确认以后：10 秒撤销，接着画 | `ui-screens/D7.jpg` |
| D8 | 工地气泡：加速和取消 | `ui-screens/D8.jpg` |
| D9 | 拆除：点一下选中 | `ui-screens/D9.jpg` |
| D9b | 拆除：拖动一次选好几样 | `ui-screens/D9b.jpg` |
| D10 | 拆通往邻居的那一段：按住确认 | `ui-screens/D10.jpg` |
| D11 | 铁路：画线、放货运站和客运站 | `ui-screens/D11.jpg` |
| D12 | 高速公路：地面、高架、立交 | `ui-screens/D12.jpg` |
| D13 | 公交线：放站、成环、删站 | `ui-screens/D13.jpg` |
| D14 | 地铁：地面变淡，画线放站 | `ui-screens/D14.jpg` |
| D15 | 其他建造工具的样子 | `ui-screens/D15.jpg` |

### E 点地图上的东西（`ui-map.md` 第 7 节）

| 编号 | 页面 | 效果图 |
|---|---|---|
| E1 | 点住宅 | `ui-screens/E1.jpg` |
| E2 | 点工业或办公 | `ui-screens/E2.jpg` |
| E3 | 点路段 | `ui-screens/E3.jpg` |
| E4 | 点公共服务建筑 | `ui-screens/E4.jpg` |
| E5 | 车流去向（下钻一层） | `ui-screens/E5.jpg` |
| E6 | 点农田 | `ui-screens/E6.jpg` |
| E7 | 点水厂、电厂、燃气厂 | `ui-screens/E7.jpg` |
| E8 | 点路口 | `ui-screens/E8.jpg` |
| E9 | 点公交站或地铁站 | `ui-screens/E9.jpg` |
| E10 | 点码头、机场、国际港 | `ui-screens/E10.jpg` |
| E11 | 点奖励建筑 | `ui-screens/E11.jpg` |
| E12 | 其余几种气泡 | `ui-screens/E12.jpg` |

### F 视图（`ui-map.md` 第 8 节）

| 编号 | 页面 | 效果图 |
|---|---|---|
| F0 | 视图托盘 | `ui-screens/F0.jpg` |
| F1 | 视图：交通 | `ui-screens/F1.jpg` |
| F2 | 视图：公共服务（医院） | `ui-screens/F2.jpg` |
| F2a | 视图：公共服务的学校分项 | `ui-screens/F2a.jpg` |
| F2b | 视图：公共服务的垃圾分项 | `ui-screens/F2b.jpg` |
| F3 | 视图：水电燃气 | `ui-screens/F3.jpg` |
| F4 | 视图：人口和岗位 | `ui-screens/F4.jpg` |
| F4a | 视图：人口的学历分项 | `ui-screens/F4a.jpg` |
| F4b | 视图：人口的商场分项 | `ui-screens/F4b.jpg` |
| F5 | 视图：满意度 | `ui-screens/F5.jpg` |
| F6 | 视图：环境 | `ui-screens/F6.jpg` |
| F7 | 视图：货运 | `ui-screens/F7.jpg` |
| F8 | 视图：地铁 | `ui-screens/F8.jpg` |

### G 邻居和边界接口（`ui-map.md` 第 9 节；规则见 `game-design.md` 第 9 节“和邻居连通”）

| 编号 | 页面 | 效果图 |
|---|---|---|
| G1 | 邻居和边界接口 | `ui-screens/G1.jpg` |
| G2 | 对着你的线头 | `ui-screens/G2.jpg` |
| G2a | 对着你的线头：期限还没开始 | `ui-screens/G2a.jpg` |
| G2b | 对着你的线头：已经开工，期限冻结 | `ui-screens/G2b.jpg` |
| G2c | 对着你的线头：没网 | `ui-screens/G2c.jpg` |
| G2d | 去接上：方案接了也不算接好 | `ui-screens/G2d.jpg` |
| G3 | 去接上：放货运站 | `ui-screens/G3.jpg` |
| G4 | 看邻居（灰色画面） | `ui-screens/G4.jpg` |
| G4b | 看邻居：点头像 | `ui-screens/G4b.jpg` |
| G5 | 点两边都接好的接口 | `ui-screens/G5.jpg` |
| G6 | 点你修出去的“⋯”接口 | `ui-screens/G6.jpg` |

### H 站内信（`ui-map.md` 第 10 节；规则见 `game-design.md` 第 14 节）

| 编号 | 页面 | 效果图 |
|---|---|---|
| H1 | 站内信：待处理 | `ui-screens/H1.jpg` |
| H2 | 站内信：通知 | `ui-screens/H2.jpg` |

### I 地区、全国和参观（`ui-map.md` 第 11 节；规则见 `game-design.md` 第 2、13 节）

| 编号 | 页面 | 效果图 |
|---|---|---|
| I1 | 地区地图 | `ui-screens/I1.jpg` |
| I1b | 地区地图：留给邀请的空位 | `ui-screens/I1b.jpg` |
| I2 | 全国 | `ui-screens/I2.jpg` |
| I3 | 参观模式：实地参观好友 | `ui-screens/I3.jpg` |
| I3a | 参观模式：“看看”的灰色画面 | `ui-screens/I3a.jpg` |
| I3b | 参观模式：历史城市 | `ui-screens/I3b.jpg` |
| I3c | 参观模式：点对方头像 | `ui-screens/I3c.jpg` |

### J 我的城市和设置（`ui-map.md` 第 12 节）

| 编号 | 页面 | 效果图 |
|---|---|---|
| J1 | 我的城市 | `ui-screens/J1.jpg` |
| J2 | 设置 | `ui-screens/J2.jpg` |
| J3 | 账号 | `ui-screens/J3.jpg` |
| J4 | 帮助页 | `ui-screens/J4.jpg` |

### K 城市结束（`ui-map.md` 第 3、4 节；规则见 `game-design.md` 第 2 节“城市的结束和历史城市”）

| 编号 | 页面 | 效果图 |
|---|---|---|
| K1 | 城市结束 | `ui-screens/K1.jpg` |
| K2 | 结束确认 | `ui-screens/K2.jpg` |

### L 加载和隐私（`ui-map.md` 第 3 节）

| 编号 | 页面 | 效果图 |
|---|---|---|
| L1 | 加载页 | `ui-screens/L1.jpg` |
| L2 | 隐私指引和用户协议 | `ui-screens/L2.jpg` |

### N 盖在上面的系统页面（`ui-map.md` 第 4 节；规则见 `game-design.md` 第 12 节）

| 编号 | 页面 | 效果图 |
|---|---|---|
| N1 | 在另一台设备上打开了 | `ui-screens/N1.jpg` |
| N2 | 版本更新 | `ui-screens/N2.jpg` |
| N3 | 断网和维护 | `ui-screens/N3.jpg` |

### S 各页面共用的样子

| 编号 | 页面 | 效果图 | 设计章节 |
|---|---|---|---|
| S1 | 空状态（几处拼在一张图上） | `ui-screens/S1.jpg` | `ui-map.md` 第 13 节 |
| S2 | 名字被判违规 | `ui-screens/S2.jpg` | `ui-map.md` 第 4、13 节 |
| S3 | 邀请好友 | `ui-screens/S3.jpg` | `ui-map.md` 第 11 节 |
| S4 | 等待和失败（通用的样子） | `ui-screens/S4.jpg` | `ui-map.md` 第 1 节“等待和失败” |

## 需求覆盖表

每条需求对应的设计章节和页面。GD 是 `game-design.md`，DM 是 `data-model.md`，CT 是 `catalog.md`，UI 是 `ui-map.md`，SI 是 `sim-impl.md`，SV 是 `server-impl.md`。

| 需求 | 名称 | 设计章节 | 页面 |
|---|---|---|---|
| REQ-001 | 新手引导和十分钟升到 2 级 | GD 3；UI 3 | A3、A3b、A3c、B1a、B5 |
| REQ-002 | 微信登录、云存档和两台设备 | GD 12“两台设备”“存档”；DM 3、5、6；SV 1；UI 4 | L1、L2、N1 |
| REQ-003 | 八方向道路规划和拆除 | GD 4“拆除”、5“道路”；SI 2；UI 6 | D3、D4、D7、D9、D9b、E3、E8 |
| REQ-004 | 分区、楼的生长和星级 | GD 4“征收”、6；CT 2 到 6；SI 3、4；UI 6 | D5、E1、E2、E6、F4 |
| REQ-005 | 车流、拥堵和通勤 | GD 5“车流”、15；SI 5；UI 8 | E3、E5、E8、F1 |
| REQ-006 | 城市经济、税和资金为负 | GD 10；DM 10；UI 5 | C1、C1a、C1b、C2、C2a、C2b |
| REQ-007 | 城市等级、经验和解锁 | GD 6“升降星和密度”、11；SI 10；UI 4、5 | B3、B3b、C5、D1b |
| REQ-008 | 公共服务和公用事业 | GD 7、8；CT 8；SI 6、7；UI 6、8 | D6、E4、E7、F2、F2a、F2b、F3、F5、F6 |
| REQ-009 | 公交线路 | GD 5“公交和地铁”；UI 6 | D13、E9 |
| REQ-010 | 地铁线路和地下视图 | GD 5“公交和地铁”；UI 6、8 | D14、E9、F8 |
| REQ-011 | 国家、地区和位置分配 | GD 2；DM 2；SV 2；UI 11 | A1、I1、I2 |
| REQ-012 | 系统城市（已废弃） | 被 GD 2“城市和空白位置”替代 | 无 |
| REQ-013 | 和邻居连通：接口、线头和期限 | GD 9“和邻居连通”；DM 9；SV 4；UI 9 | D3b、D3c、D4b、D10、G1、G2、G2a、G2b、G2c、G2d、G3、G5、G6 |
| REQ-014 | 货运和售出率 | GD 9“谁来买”“谁来算”“售出率”“运输方式”；DM 9；SV 5；SI 8 | E2、E10、F7 |
| REQ-015 | 穿城和过路费 | GD 9“运输方式”；DM 9、10 | C2b、F7 |
| REQ-016 | 机场 | GD 9“运输方式”；CT 8 | E10 |
| REQ-017 | 微信邀请和留位 | GD 2“留位”、13；UI 11 | S3、I1b |
| REQ-018 | 好友航线（已废弃） | 被 GD 13 替代，第一版没有好友航线 | 无 |
| REQ-019 | 离线结算 | GD 10“离线收益”、12；DM 10；SI 9 | B2、B2b、B2c、B2d |
| REQ-020 | 城市的结束、开新城和历史城市 | GD 2“一个人一座城市”“城市的结束和历史城市”；DM 8；UI 4、12 | K1、K2、J1、I3b |
| REQ-021 | 服务端校验和防作弊 | GD 9“防作弊”；DM 7、10；SV 3、6 | 无 |
| REQ-022 | 同步、断网和维护中 | GD 12；DM 14；SV 3；UI 4 | B1o、N3、S4 |
| REQ-023 | 好友、灰色浏览和实地参观 | GD 13；DM 12；UI 9“看邻居”、11 | G4、G4b、I3、I3a、I3c |
| REQ-024 | 账号注销和数据保留 | DM 8；UI 12 | J3 |
| REQ-025 | 城市名、昵称和内容安全 | GD 3；UI 3、13 | A2、S2 |
| REQ-026 | 合规上线 | GD 15“合规” | L2 |
| REQ-027 | 成本保护和激励视频 | GD 1、10“看视频的地方”；DM 10、15 | B2c、B6a、B6b、D8 |
| REQ-028 | 留存数据统计 | GD 3；DM 3 player（kind 区分真人和机器人）；留存的统计表设计稿还没有 | 无 |
| REQ-029 | 玩家实时聊天（以后） | 第一版不做 | 无 |
| REQ-030 | 联盟、俱乐部和竞赛（以后） | 第一版不做 | 无 |
| REQ-031 | 灾害和突发事件（以后） | 第一版不做，见 GD 7 | 无 |
| REQ-032 | 内购、抽卡和强制广告（以后） | 第一版不做 | 无 |
| REQ-033 | 开放地区时生成地形 | GD 2“河网”“地形由服务端生成”“每个位置的地形”、15；SI 1；DM 2 | A1 |
| REQ-034 | 地形影响造价和产业 | GD 2、4“坡和森林”、6、8；CT 5 到 7 | D15 |
| REQ-035 | 道路分级、高速公路和铁路 | GD 4“换等级”、5“道路”“铁路”；UI 6 | D1、D4、D11、D12 |
| REQ-036 | 内河码头和水运 | GD 2“河网”、9“运输方式” | E10、F7 |
| REQ-037 | 海港和跨群海运（已废弃） | 被 GD 9“运输方式”的国际港替代 | 无 |
| REQ-038 | 国际港和外国市场 | GD 9“出地区”“运输方式” | E10 |
| REQ-039 | 位置预览、看视频换位置和留位 | GD 2“位置怎么分配”、3；DM 3 slot_offer；UI 3 | A1、A1b |
| REQ-040 | 新城市保护期 | GD 3、9“和邻居连通” | A1、G1 |
| REQ-041 | 教育和升学 | GD 6“教育和人才”、12“离线回来”；SI 4 | F2a、F4a |
| REQ-042 | 外地客人 | GD 6“外地客人”；DM 6、9 | E11 |
| REQ-043 | 站内信 | GD 14；DM 13；UI 10 | H1、H2 |
| REQ-044 | 微信服务通知和订阅授权 | GD 14；SV 7 | B5 |
| REQ-045 | 奖励建筑 | GD 11；CT 7 | D2、D2b、E11 |
| REQ-046 | 工期、视频加速和撤销 | GD 4“工期”“拆除”；SI 10；UI 6 | D7、D8、D9 |
| REQ-047 | 破产保护 | GD 10“资金为负” | B4、C1b |
| REQ-048 | 内测世界和机器人城市 | GD 15“内测的规模和机器人”；DM 11；SV 8 | 无 |
