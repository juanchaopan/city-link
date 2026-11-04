# 服务端：实现大纲

给开发 `apps/server` 用，按模块写每件事怎么做、读写哪些表。表结构、字段和同步的完整步骤以 `data-model.md` 为准，规则以 `game-design.md` 为准；两边不一致时以设计稿为准，并回来改这份大纲。费用估算见 `data-model.md` 第 15 节，要核实的平台规则和合规项见 `game-design.md` 第 15 节和 `data-model.md` 第 16 节。

总体：

- `game` 云函数用 `action` 路由，模块是 identity、world、terrain、city、trade、ops，外加定时触发的 `tick`。激励广告的回调也是 `game` 的一个动作（adCallback），经 HTTP 访问服务对外，要在 1 秒内回包。
- 规则和核对的计算放在 `libs/sim`，服务端只做读写和编排。
- `game` 超时 60 秒；一个每分钟的定时触发器。ops_switch 和配置在函数实例里缓存 60 秒。

## 1. 身份和账号

- **登录**：`enter` 从云函数上下文拿 openid → 读 player_openid（`_id` 是 openid 加盐的哈希）→ 没有就在一个事务里建 player 和 player_openid；两台设备同时第一次进入时撞 `_id` 的一方改为重读。player.last_online_at 日期变了才写。
- **进入城市**：生成 session_id 写进 city；响应带服务端时间、城市文档里手机要的字段、save_file 和 save_seq、sync_seq、city_inbox、还没计入的 credit、今天各用途还剩几次、配置版本。save_seq 比 sync_seq 落后时，手机走重建基线（`data-model.md` 第 7 节）。
- **开新城**：前提是 player.city_id 为空。一个事务里写 slot、player，新建 city、city_summary、city_inbox、credit_counter 和开局资金的 credit；邻居、信、快照放进“城市入住”任务。取名先过内容安全，服务不可用时用默认名。
- **一人一城**：靠 player.city_id 为空这个条件；另一台设备的事务失败后进入已经建好的那座。
- **两台设备**：同步带 session_id，和 city.session_id 不一致就返回“会话过期”。
- **注销**：player.status 改成注销中，走一个分段接力的“注销”任务：先走“城市结束”，再删历史城市的 city、快照、信、好友关系、邀请、留位、slot_offer、订阅次数、sync_audit、player_openid，ad_grant 和 free_grant 去掉 player_id，最后删 player。
- **管理和机器人**：没有 openid 的调用必须带 HMAC 签名，密钥放环境变量，签名里写操作者是维护者还是哪个机器人。

## 2. 位置分配

- **数据**：slot 有 order_key（国家、地区、位置三级序号拼成）和 free 标志，索引 (free, order_key)。
- **开局预览**：按 (free, order_key) 取前 10 条，在代码里跳过别人有效的留位，取第一个，写一条 slot_offer。换位置要先看视频（ad_grant 已确认），从顺序最前面的约 4 个空位里按 terrain_score 加权抽一个。看过的位置用 slot.held_by、held_until、held_for 留 30 分钟，每人有效留位最多 3 个（和邀请合计）。
- **抢位置**：开新城的事务里以“slot.city_id 为空，并且没有别人的有效留位”为条件写入；失败就提示“这个位置刚被占了”，自动换成下一个空位。
- **邀请**：玩家点哪个空位上的“＋”就留哪个，写 invitation 和 slot.held_by（held_for 是邀请），到卡片过期为止。新玩家从分享卡片的启动参数带邀请码进来：位置还留着就直接给他，跳过预览和换位置；已被占就按顺序分配，开局画面上提示。已注册的玩家点卡片，只建一条好友申请。
- **开地区**：job_queue 的“开地区”任务，每段生成几个位置的地形文件，最后把 region 设为开放。当前地区还剩 4 个空位时预生成下一个地区；当前国家只剩最后一个地区可开时，预生成下一个国家。城市结束时，地区从已满回到开放。

## 3. 同步

- **频率**：手机在线时每 2 分钟一次，间隔在 ops_switch 里；退后台时再发一次。手机保证同一时刻只有一个同步在路上。
- **请求**：batch_id、session_id、sync_seq、变了的楼、分区、道路和设施、城市摘要的原始量、资金和经验、计入到哪条 credit、刚上传的存档头（save_seq、哈希、资金）、穿城路线的拥堵系数。超过平台的请求包上限就分批发。
- **服务端流程**：按 `data-model.md` 第 7 节的步骤做，要点是：
  1. 读 city 核会话；batch_id 等于 last_batch_id 就直接返回 last_batch_result。
  2. 读 city_inbox，下载已核数据文件。
  3. 用 `libs/sim` 增量核这次的变化：开工时刻夹在“上次同步时刻”和“这次收到时刻”之间；按配置价格算建造费下限。
  4. 算资金、税、经验的上下限，核不上就截断，得出调整量。
  5. 和上次同步的间隔超过离线门槛（10 分钟，机器人城市 60 分钟）就建 offline_claim 和离线收益的 credit。
  6. 路网图、铁路图或 ports_version 变了，就重判本城的接口；顺带检查期限和破产。
  7. 过路费满 1 小时转成一笔 credit；有“已确认、还没执行”的 ad_grant 就执行（第 6 节）。
  8. 上传新的已核数据文件，以“status 是在用、sync_seq 还是读到的值”为条件更新 city（同时写 last_batch_result）；失败就删掉刚传的文件，3 秒内重来一次，再失败返回“请重试”。成功后删旧的已核数据文件。
  9. city_summary 只在三种情况下写：国家日历进入新游戏日后的第一次同步；影响别人的字段变了；城市结束。sync_audit 每个游戏日写一行。
- **响应**：服务端时间、新的 sync_seq、调整量、收件箱、新的 credit、各用途今天还剩几次、游戏日期、广告的结果。
- **手机侧**：离线队列按批次保存，断网时指数退避重试；调整量静默计入，资金按秒平滑过去。错误码按 `data-model.md` 第 10 节处理。

## 4. 邻居和线头

- **当场确认的操作**：修到边界、接线头、拆边界段、撤销线头，都是“同步 + 操作”合成一个请求。服务端先核完这批变化，再做检查。
- **修到边界的检查**：读对方位置的地形摘要、对方的已核数据文件和 border_pair；对方还在保护期就拒绝。通过就在事务里以 version 为条件写接口对象：cell、本侧 head 和 head_since，对方那一侧 state 设为“等待开始”。后到的一方收到“改接对方的接口”，工程全额退款。
- **接好的判定**：同步时只重判本城接口清单里的那几份 border_pair，在已核路网上判断：经匝道、立交或货运站连到人口最多的那片，或者连到另一个接好的接口。人口换片要连续两次才算没接好，用 split_strikes 计数。状态有变化才写，同时给对方的收件箱加一。
- **期限**：存储和判定按 `data-model.md` 第 9 节：每侧有 state、deadline、freeze_until、remaining；border_pair 顶层有 next_due_at；city 有 running_port，一座城同一时刻只有一个期限在走。每分钟的 tick 按 next_due_at 查到期的：该开始的开始，冻结到期的改回在走，该通知的发通知，过了 1 小时宽限还没接好的，在事务里再读一遍确认，然后启动“城市结束”任务。暂停开关关闭时，把暂停的时长加到所有在走的期限上，重算 next_due_at。
- **开工接线**：方案在已核路网加方案上确认完工后会接好，才写 connect_construction 和 connect_finish，state 改成冻结；tick 到 connect_finish 时直接置为接好。
- **城市结束的清理**：按 `data-model.md` 第 8 节的步骤接力。

## 5. 地区结算和全国、外国市场

- **触发**：tick 查 `region.next_settle_at ≤ 现在` 的地区，每次最多处理约 40 秒的量。处理一个地区前，先以“next_settle_at 还是读到的值”为条件把它加一个游戏日，这就是租约。
- **一次结算**（细节见 `data-model.md` 第 9 节）：
  1. 一次查询读出本地区的 city_summary（最多 16 条）；8 小时内一座都没上线就结束。
  2. 读最新一份 national_demand 和 foreign_market，不等，同一次触发里缓存。
  3. 用 verified_supply 截断 export_supply，排除不在市场里和已结束的城市。
  4. 在内存里分配：先本地区（在城市图上找最短路，选路代价含过路费、拥堵和折扣，水运按河网走），再全国，再外国。
  5. 写 region_result（`_id` 是“地区_游戏日”，写入就是提交点）。
  6. 对收费城市的 city_inbox.toll_pending 原子加，一个游戏日不超过它 tax_per_game_day 的 10%。
- **全国汇总**：tick 按国家日历，在第 D 天结束后半个游戏日，用 `_id` 批量读本国各地区第 D 天的 region_result，写 national_demand。外国市场的需求上限由每日维护任务按有国际机场或国际港的城市数更新。
- **读写量和时长**：一次地区结算约 5 次读写，国家汇总每国每游戏日 2 次。16 座城的分配在毫秒级，主要花在数据库往返（每次约 30 毫秒），一个地区约 0.2 到 0.3 秒，一分钟能处理 100 个以上的地区。
- **跳过规则**：8 小时内没有城市上线的地区跳过；本地区摘要没变、全国汇总也没变时，只发过路费，不写结果。

## 6. 入账和激励广告

- **写一笔 credit**：一个事务里读 credit_counter → 写 credit（`_id` 是“来源:source_id”，撞了说明已经入过，直接成功返回）→ next_seq 加一 → 收件箱的 credit_seq 改成新值。
- **手机侧**：按 seq 顺序计入，下一次同步回报 credits_applied。
- **视频，分三步**：
  1. 手机调 `ad.begin`，建 ad_grant（每个玩家同一时刻只有一条待确认）。然后调 `setServerSideVerificationData({ userId: player_id, customData: ad_grant 编号 })`，再 show()。基础库低于 3.10.3 时走直接领取。
  2. 微信回调 adCallback：Token、timestamp、nonce、encrypt 排序拼接后做 SHA-256 验签，用 EncodingAESKey 做 AES-256-CBC 解密，Token 和 EncodingAESKey 放环境变量。以“ad_grant 是待确认、player_id 等于 user_id”为条件改成已确认，写 transaction_id，回 is_valid。不读别的文档；微信重试时按 transaction_id 返回同样的结果。配置地址时的 GET 校验原样回 echostr。
  3. 执行奖励：这个玩家的下一次请求（同步、进入或任何操作），或者 tick（已确认超过 2 分钟还没执行的），按用途执行：领资金写 credit；加速改工程的 finish_at 并记进 city；翻倍和延长在事务里置位，再写 credit；换位置换出新的 slot_offer；结束城市启动结束任务。执行完置 executed_at，手机在响应里拿到结果。
- **退路**：回调地址做不到时，按前端 onClose 的“看完了”执行，每种用途按天限次，次数和直接领取共用一套配置。
- **直接领取**：ops_switch 开着时可用；free_grant 的 `_id` 是“玩家_用途_日期_第几次”，插入撞了就试下一个，超过当天次数就拒绝。
- **离线收益**：建 offline_claim 时一起写离线收益的 credit；翻倍和延长按 `data-model.md` 第 10 节的防重键。
- **升级**：`level.up` 以“level 还是 L、经验够了”为条件改 city.level。player.levels_rewarded 里没有这一级时，在同一个事务里写奖励和信。领取时写 credit；翻倍要先看视频。
- **清理**：每天删 7 天前已计入的 credit：按 created_at 查，再按 seq ≤ credits_applied 批量删。

## 7. 站内信、订阅通知和定时任务

- **信**：mail 按玩家建，写信时给收信玩家当前城市的收件箱 mail_version 加一。没有城市的玩家，进入游戏时直接读信。线头的信在期限开始时生成或原地更新，接好时写 resolved_at。每日维护删 30 天前已读、已解决的信。
- **订阅通知**：手机在引导结束、领取升级奖励、第一次造码头或货运站、收下离线收益这四个时刻调 requestSubscribeMessage，结果报给服务端，累加订阅额度。每小时的通知任务按 `game-design.md` 第 14 节挑要发的（每个玩家每天最多一条），用云调用 subscribeMessage.send 发送，要在 config.json 里声明云调用权限。发送失败按额度用完处理。
- **tick（每分钟）**，依次做下面几件事，总共做满约 40 秒就停：
  1. 到期的接口期限（按 next_due_at）。
  2. 地区结算（按 next_settle_at）。
  3. 国家汇总。
  4. 已确认超过 2 分钟还没执行的 ad_grant。
  5. job_queue 里待做的分段任务：城市结束、城市入住、开地区、注销、每日维护。按 (state, lease_until) 查，以条件更新取租约，游标写进 payload。
  6. 每小时第 0 分钟跑通知任务；每天 04:00 建当天的维护任务，`_id` 带日期，防止重复建。
- **每日维护**：30 天没上线的玩家的城市结束；180 天没上线的玩家的历史城市删除；过期的站内信、留位和 slot_offer；7 天前已计入的 credit；归档 90 天前删除的城市的入账记录；外国市场的需求上限；对账（city、slot、player、border_pair 互相指向是否一致）。

## 8. 机器人

- **身份**：player.kind 是机器人，走管理通道的 HMAC 签名。统计和费用报表排除它们；“30 天没上线”对它们照常适用（它们一直在同步）。
- **运行**：`tools/bots` 在 GitHub 定时任务里每 30 分钟跑一次（也可以在维护者的电脑上跑），用云开发的 Node SDK 调用 `game`。每个机器人：
  1. 下载存档；
  2. 用 `libs/sim` 把经过的游戏时间逐小时模拟完；
  3. 规划器操作；
  4. 同步一次；
  5. 上传存档。
- **服务端**：机器人城市的离线门槛放宽到 60 分钟；收到好友申请过一段随机时间自动同意。
- **规划器**（按规则，不用 AI）：
  - 在可建地上铺方格路网；
  - 按需求条划区，先住宅和工业，有商业需求再划商业；
  - 按覆盖缺口放水电和公共服务；
  - 2 级造码头；3 级往每个机器人邻居修铁路，并接所有对着自己的线头（发现就接，不让期限走完）；
  - 7 级修高速到口岸；8、9、10 级造机场和港；
  - 税率一直用“正常”；
  - 不看视频，钱不够就等税。
- **数据**：机器人和真人用同一套表，靠 kind 区分。内测世界在正式发布前整体清空，国家从 1 重新生成。
