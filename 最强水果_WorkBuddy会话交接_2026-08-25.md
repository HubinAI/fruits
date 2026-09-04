# 《最强水果》WorkBuddy 会话交接（2026-08-25 12:30）

> 本文件是会话交接包：新窗口接手时先读本文件 + 项目基线
> `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md`（V1.0）。
> 详细逐队列日志见 `.workbuddy/memory/2026-08-25.md`（今日全部 F-UX-3 / F-HOME 队列）。

---

## 0. 核心定位（判断机制是否保留的唯一标准）

极简策略 + 事前组装 + 自动物理战斗。
玩家循环：「我觉得这样能赢 → 看它自己打 → 原来问题在这 → 改一下再试」。
**每个机制必须让玩家做出不同的下一步动作，否则不保留。**

指令优先级：①最新明确的单次执行指令（最高）②稳定项目边界 ③历史草稿。
方案漂移红线、三层验收（技术正确 → 方案落地 → 实际体验成立）见基线文件。

---

## 1. 当前 Git 状态（接手先确认）

| 项 | 值 |
|---|---|
| 分支 | `foundation-02-wechat`（微信小游戏移植主线） |
| HEAD | `def50148a78f168201541ccabb501ab13d1d4161`（= 远端 ls-remote 已确认） |
| dist-wechat 内嵌 SHA | `def50148a78f168201541ccabb501ab13d1d4161`（三路一致） |
| 工作区未提交 | 仅 `.workbuddy/memory/2026-08-25.md`（已含今日日志）与本交接 MD（非生产） |
| git 身份 | 本仓库 `xiaoyue <xiaoyue@local>`（**新会话需 `git config user.name/email` 重新设置**） |
| push 通道 | SSH `git@github.com:HubinAI/fruits.git` |

## 2. 今日完成 Queue 总览（8 条，全部 commit + push + 三路 SHA 验证）

| Queue | commit | 内容 |
|---|---|---|
| F-UX-3B | `f446e5e` | Battle 去UI化：mobile-short HUD 只留 HP 条（删 A/B/数字/战斗中，Warning/Closing 才中央提示+Closing 倒计时）；compact battle Active 薄地面构图（底部锚定+insetBottom 12 → 地面 30%→13-15%） |
| F-UX-3C | `716e89e` | Result 减少决策密度：底部只留 [调整配置][下一场]，广告改奖励区 adRow 小型入口，删「获得」标题行 |
| F-UX-3-GATE | `716e89e`（不变） | 收口验收：tsc 0 / 918 tests / 双构建 |
| F-HOME-1 | `17377dd` | 主界面信息架构重做：正式首页（metaPage 加 'home'），homeLayout.ts 唯一布局源，背景渐变+光晕+远山 |
| F-HOME-2 | `aa49afe` | 寻找对手主交互：Matching 每帧重绘+扫描动效，CTA short 40→48 全页最显眼 |
| F-HOME-3 | `a446e52` | 车辆可点 + 随机气泡 tips（HOME_TIPS 20 条） |
| F-HOME-4 | `9c7b0b8` | 辅助入口正式化：宝箱 4 槽状态占位（HOME_CHEST_STATES）、个人信息头像+段位、排行榜/战令/宝箱开 large 占位页 |
| F-HOME-5 | `def5014` | 车库与首页解耦收口：首页命中区白名单 10 入口、零组装残留 |
| F-HOME-GATE | `def5014`（不变） | 收口验收：tsc 0 / 931 tests / 双构建 / 三路 SHA |

## 3. 当前架构关键现状（新窗口必须知道）

### 3.1 首页（playerPhase='garage' 且 metaPage='home' 默认）
- 布局源：`src/ui/homeLayout.ts` `computeHomeLayout(viewport, insets, profile)` → topBar/vehicle/cta/assist + chestSlot(i)，全 rect 由 available 反推、safe 内无例外、short 更紧凑（topBar 30 / vehicle 反推 / cta 48 / assist 36）。
- 命中区白名单（10）：`cta-find` + `home-vehicle`（车辆气泡 tips）+ `home-garage/home-rank/home-pass` + `home-profile` + `home-chest-0..3`。
- 导航：`home-garage`→配置页（metaPage='garage'，原 Garage：4 配置入口 + CTA + 顶栏「‹ 首页」nav:home + 背包/更多小按钮）；`home-rank/home-pass/home-chest-N/home-profile`→large 占位页 Modal；`nav:garage`（背包/更多返回）→ Home；render 离局复位 metaPage='home'。
- 车辆气泡 tips：`HOME_TIPS`（20 条导出常量），点击车辆随机 1 条；dispatch 非 home-vehicle 点击统一清 `vehicleTip`（点别处关闭）。
- 宝箱状态占位：`HOME_CHEST_STATES = ['claimable','timing','timing','empty']`（可领取金边/计时进度条/空槽暗色+槽盖）。
- 匹配动效：`renderBattleFrame` 在 playerPhase matching/matchPreview 时**每帧强制重绘**（动画驱动前提）；`drawMatchingContinuum` 搜索分支 nowMs 扫描线+脉冲。匹配链（runtime 既有）：CTA→startMatching（候选快切 220/480/780ms）→goToMatchPreview（250ms）→startBattleWithReady（READY→Battle）约 1.3s。

### 3.2 车库/背包/更多（metaPage）
- `garage`：drawGarageMetaPage（panel 4 配置入口 + CTA）+ drawMobileTopBar（金币/段位/能量 + 顶栏 nav:home/nav:backpack/nav:more 小按钮）。
- `backpack`/`more`：既有（合成走 Modal、More 2×2 功能卡 + 设置子页）。
- Desktop（1280×720）：保持旧 Dock（drawGarageDock 未动，不受 metaPage 影响）。

### 3.3 Battle（3B 遗留约束，重要）
- **「车辆至少放大 30%」数学不可达**：scale 被 corridor 宽度 996 锁死（420×210 scale=0.4217），spawn 400/1200 + 固定 corridor [315,1295] + 双方完整入画三重硬约束。已交付构图级放大（地面 30%→13-15%、底部锚定、战斗带 86→121px）。解锁需后续 Queue 决策（拉近 spawn / 允许开局裁切 / 动态构图，均被 3B 禁止）。
- 360×180/390×195 受既有 `MIN_CONTENT_SCALE=0.4` 下限钳制（w<400 corridor 数学放不下，预存行为非 3B 引入）→ battleDeUx3B 完整入画断言限定 w≥400。

### 3.4 Result（3C）
- 底部仅 [调整配置][下一场]（modal-secondary/modal-primary）；广告在奖励区 `modal-ad`（额外 +50金币 · 看广告，矮于决策按钮）；部件卡无「获得」标题行；short large 卡片高 0.86（420×210 留白）。

## 4. 环境惯例（必须遵守，否则踩坑）

1. **Node**：managed `C:/Users/62520/.workbuddy/binaries/node/versions/22.22.2/node.exe`（vitest/tsc/vite 全用它）。
2. **vitest**：所有命令必须带 `--pool=vmThreads --maxWorkers=1`，否则 `reading 'config'` 误报全失败（vitest 4.1.10 / Node 24 Windows 双实例故障）：
   `node node_modules/vitest/vitest.mjs run tests/<file> --pool=vmThreads --maxWorkers=1`
3. **tsc**：`node node_modules/typescript/bin/tsc --noEmit`（全量，无 scoped 子集时用它）。
4. **构建**：Web `node node_modules/vite/bin/vite.js build`；WeChat `-c vite.wechat.config.ts`。构建后必须验证 dist-wechat/game.js 内嵌 `_virtual_runtime_info_default` sha = local HEAD。
5. **git ref 写入不可靠（重要）**：commit 后分支 ref 常不落盘；`git update-ref`/`git branch -f` 也静默失败。可靠恢复：`mkdir -p .git/refs/heads/<branch> && printf '%s\n' <full-sha> > .git/refs/heads/<branch>`，commit 后必须 `git log` 验证。push 后 `git ls-remote origin foundation-02-wechat` 对比。
6. **中文路径伪影**：git status 把 `planck` 显示为 `plank`；真实文件名始终 `planck`。中文路径 Read 工具偶发失败 → Bash cat 兜底。
7. **三路 SHA 硬验收**：local HEAD = remote = dist-wechat 内嵌；stale-recording 陷阱：Dev Server 未重启时录制可能滞后。
8. **微信预览**：Devtools 默认打开 `dist-wechat/`；`npm run build:wechat:rca` 开启 dev-only `[WX-*]` 诊断日志（PROD 零日志）。

## 5. 本轮坑与教训（新窗口避免重踩）

- **vitest `expect(ids).not.toContain(x, msg)` 不支持第二参**（TS2554）→ 改 `expect(ids.includes(x), msg).toBe(false)`。
- **recording ctx texts 是累积的**：断言「返回后气泡关闭」用新增切片 `texts.slice(before)`，不能全量断言。
- **rating 段位分级**：tierOf(rating)：0-99 青铜 / 100-199 白银 / 200-299 黄金 / 300+ 钻石——测试里 rating 200 是「黄金」不是「青铜」。
- **full vitest 能抓 targeted 漏网**：F-UX-REVIEW-1 的 input.ts NaN bug + pagesPreview 守卫过期都是 full run 才暴露；每个 Queue 收尾建议跑 full vitest。
- **build:wechat:rca 门控**：PROD 构建注入 `__WX_DEBUG__=false` → `[WX-*]` 日志编译期消失，不要用 Web 构建冒充微信验证。

## 6. 待办 / 下一步

- **Q6 待命**（用户将下发下一 Queue）。
- 历史遗留设计项：**coconutBody（椰子车身，短沉重）**（任务 #12，Q19 时挂起）——Content 层新车身，不在 UX 批次范围，如用户要求可做。
- 3B「车辆放大 30%」解锁建议（需用户决策）：拉近 spawn / 允许开局轻微裁切 / 动态构图。
- 任务清单有若干历史残留 in_progress/pending 标记（#26/#80 实已完成、#12/#27 等为设计遗留），如用户要求可清理。

---

## 7. 新窗口交接对话指令（复制到新 WorkBuddy 会话第一条消息）

```
接手《最强水果》项目（微信小游戏移植，分支 foundation-02-wechat）。

【第一步】读以下文件：
1. D:\0818new\最强水果\最强水果_WorkBuddy会话交接_2026-08-25.md（本交接包，含环境惯例/坑/待办）
2. D:\0818new\最强水果\最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md（项目基线 V1.0）
3. D:\0818new\最强水果\.workbuddy\memory\2026-08-25.md（今日逐队列日志）

【第二步】确认状态（必须三路一致）：
- git -C D:/0818new/最强水果 rev-parse HEAD
- git -C D:/0818new/最强水果 ls-remote origin foundation-02-wechat
- dist-wechat/game.js 内嵌 _virtual_runtime_info_default.sha
当前应为 def50148a78f168201541ccabb501ab13d1d4161；git 身份需重设：
  git config user.name "xiaoyue" && git config user.email "xiaoyue@local"

【环境铁律】
- vitest 必须带 --pool=vmThreads --maxWorkers=1（否则 reading 'config' 误报全失败）
- tsc: node node_modules/typescript/bin/tsc --noEmit
- 构建: vite build / vite build -c vite.wechat.config.ts；commit 后 git log 验证 ref 落盘，push 后 ls-remote 对比
- 改动规则：先查后改、单 commit + push、每条 Queue 完成后 stop-and-wait 等真机回执

【当前状态】Home 批次（F-HOME-1~5 + GATE）已完成并 push。等待你的下一条 Queue（此前停在 Q6 待命）。
【禁止】不要顺手改 Battle/Result/Gameplay/Physics；不要用 Web 构建冒充微信验证；不要伪造环境。
```

---

_交接生成时间：2026-08-25 12:30（GMT+8）。本文件与 `.workbuddy/memory/2026-08-25.md` 为同一日双记录，新窗口以本文件为速查、以 memory 日志为明细。_
