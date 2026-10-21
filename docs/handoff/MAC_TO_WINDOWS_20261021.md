# Mac → Windows 迁移交接（2026-10-21）

> **本文档是 2026-10-21 的权威交接口径。** `docs/handoff/CURRENT_STATE.md`（2026-10-03）、
> `docs/handoff/NEW-WINDOW-PROMPT.md`（2026-10-16）、根目录 `最强水果_*` 系列均为**历史记录**，
> 与本文冲突时以本文 + `git log` 为准。
>
> 本文件只做**迁移交接**，不包含任何新功能、不改规则/数值/UI/战斗/存档。

---

## 0. 一页速览

| 项 | 值 |
|---|---|
| GitHub 仓库 | `HubinAI/fruits`（`git@github.com:HubinAI/fruits.git` / `https://github.com/HubinAI/fruits`） |
| 研发分支 | `prototype-portrait-battle-lab` |
| **最新提交（交接点）** | **`dbc5b8a42d2ee9ad643820efa5cd0bec2e8f9a13`**（短 `dbc5b8a`） |
| 提交标题 | `GARAGE-V2-FUSE-MODAL-R1：合成改为装备页之上的居中弹窗（返回装备移到底部）` |
| 交接前工作区 | clean（`git status --porcelain` 空） |
| local / remote | 一致（`origin/prototype-portrait-battle-lab` = `dbc5b8a`） |
| 跟踪文件数 / 体积 | 675（交接前基线）→ **677**（含本文档与当日 memory）/ 约 15 MB |
| 运行时 | **Node >= 24.0.0**（`package.json:engines`）、npm、TypeScript、Vite、vitest、playwright-core |
| 正式产物 | H5：`dist-pages/`（`base=/fruits/`）；微信小游戏：`dist-wechat/`（微信开发者工具导入） |
| 生产与 main | **未部署 GitHub Pages、未合并 main** —— 交接时保持此状态 |

**两句话结论**
1. 工程代码、资源、测试、配置**全部已入库**，Windows 直接 `git clone` 即可复现；`dist-*` 与
   `node_modules/` 按设计不入库（`.gitignore`），首次 clone 需自行构建。
2. **无迁移阻断**，唯一硬性前置是 Node 24 + 首次构建；历史失败测试已在 §7 逐条登记，
   不得当作已修复。

---

## 1. Windows 接管步骤（15 分钟）

PowerShell（在任意工作目录）：

```powershell
git clone git@github.com:HubinAI/fruits.git
cd fruits
git checkout prototype-portrait-battle-lab
git rev-parse HEAD            # 期望 dbc5b8a42d2ee9ad643820efa5cd0bec2e8f9a13
git status --porcelain        # 期望无输出

# 本仓库没有 .gitattributes；为避免 CRLF 自动转换，建议一次性关掉自动换行
git config core.autocrlf false

# Node 必须 >= 24（package.json engines）
node -v
npm ci                         # 用 package-lock.json 精确复现
npx playwright-core install chromium   # 可选：Windows 上通常直接用系统 Edge（见 §9）
```

验证（按顺序，均应为绿）：

```powershell
npm run typecheck                    # tsc --noEmit
npm run build:pages                  # 正式 H5 产物 dist-pages/
npm run build:portrait-lab           # E2E 依赖的产物 dist-portrait-lab/
node tests/_e2e_garage_v2_formal_slice.cjs   # 正式 Garage 2.0 + 首页/合成/换装，140/140
npm run dev:home                     # 本地起 5173，打开 /home.html 手看
```

> ⚠️ `npm run dev` 的根路径 `/` 会被 `build/branchDevEntry.ts` 重写到原型页；
> **正式 H5 首页请直接访问 `/home.html`**（或 `npm run dev:home`）。

---

## 2. 工程结构 / 关键入口

```
fruits/
├─ home.html                 ← 正式 H5 首页（竖版 390×844 逻辑舞台）
├─ run-page.html             ← 正式 H5 冒险页（战斗 + 结算 + 领奖）
├─ index.html                ← 旧横屏实验入口（非产品主线）
├─ *-lab.html                ← 各验证 Lab（portrait-lab / garage-v2-lab / height-line-lab …）
├─ src/
│  ├─ product/      (22)     ← 正式 H5 产品层：首页、Garage 2.0、装备、库存、奖励、成长
│  ├─ core/         (18)     ← 品质/快照/校验/存档/内容定义（数值真源）
│  ├─ battle/        (32)    ← 战斗运行时、武器行为、ContactRouter（伤害落点）
│  ├─ physics/       (3)     ← Planck 物理封装
│  ├─ render/        (5)     ← Canvas 渲染
│  ├─ player/        (1)     ← Gameplay Runtime（Web/微信共用）
│  ├─ platform/     (20)     ← Web / 微信平台适配（输入、存储、生命周期、viewport）
│  ├─ presentation/  (6)     ← 表现层（HUD 等）
│  ├─ ui/            (9)     ← UI 基件
│  ├─ game/          (2)     ← 局流程编排
│  ├─ lab/          (46)     ← 实验/验证 Lab（Garage V2 布局 Lab 在 garageV2Lab.ts）
│  └─ main.ts                ← 旧横屏入口（非产品主线）
├─ wechat/                   ← 微信小游戏入口（game.ts / game.json / project.config.json）
├─ tests/          (335)     ← vitest（*.test.ts）+ 真实浏览器 E2E（_e2e_*.cjs）
├─ assets/visuals/ (5)       ← 正式视觉素材（车身/加农/锤/pushRod PNG）
├─ build/                    ← 构建插件（runtimeInfo 注入 SHA、dev 入口重写）
├─ scripts/                  ← 微信 RC / RCA / dev 脚本
├─ docs/                     ← 交接、Garage 2.0 设计、已知问题、验收截图
└─ vite.*.config.ts          ← 五套构建：默认 / e2e / pages / portrait-lab / wechat
```

**关键入口对照**

| 入口 | 文件 | 说明 |
|---|---|---|
| 正式 H5 首页 | `home.html` → `src/product/homeMain.ts` → `homePage.ts` | 极简首页 + Garage 2.0 + 页面骨架 |
| 正式 H5 冒险 | `run-page.html` → `src/lab/portraitBattleLab/runMain.ts` | 战斗 / 结算 / 领奖回首页 |
| Garage 2.0 界面 | `src/product/garageV2View.ts` | 五槽、4 列背包、前后轮二选一、合成弹窗 |
| Garage 2.0 事务 | `src/product/garageV2Quality.ts` | 实例投影、五合一、品质件穿戴 |
| 品质倍率真源 | `src/core/installQuality.ts` | 七档表 + `applyInstallTier`（不双乘） |
| 品质账本真源 | `src/core/qualityLedger.ts` | 唯一账本（core 不依赖 product） |
| 快照 / 存档 | `src/core/buildSnapshot.ts`、`buildPersistence.ts`、`buildValidator.ts` | 卡片读数 = 战斗读数；加载时账本校验 |
| 伤害落点（冻结） | `src/battle/contactRouter.ts` | `:688` baseDamage / `:996` projectileDamage |
| 微信小游戏 | `wechat/game.ts` | Canvas 上屏 + CanvasPlayerUIHost + 同一份 Gameplay |

---

## 3. 构建 / 测试命令（Windows 可直接照抄）

### 开发态

| 命令 | 用途 |
|---|---|
| `npm run dev:home` | 正式 H5 首页（`/home.html`） |
| `npm run dev:run-page` | 正式冒险页 |
| `npm run dev:garage-v2-lab` | Garage 2.0 布局 Lab（**存储完全隔离**，不碰正式存档） |
| `npm run dev:height-line-lab` / `dev:encounter-lab` / `dev:gadget-lab` / `dev:next-run` | 其它验证 Lab |
| `npm run dev:legacy` | 旧横屏实验入口（非产品主线） |

> dev 端口固定 5173 且 `strictPort`：被占用会**直接失败**，不会自动换端口（防止录到旧版本）。

### 构建

| 命令 | 产物 | 说明 |
|---|---|---|
| `npm run build:pages` | `dist-pages/` | 正式 H5（`base=/fruits/`，多入口 home + run-page + index） |
| `npm run build:portrait-lab` | `dist-portrait-lab/` | E2E / Lab 产物（Garage V2 E2E 读这里） |
| `npm run build` | `dist/` | 旧横屏入口 |
| `npm run build:wechat` | `dist-wechat/` | 微信小游戏（开发者工具导入此目录） |
| `npm run build:wechat:rc` / `:rca` | RC 候选包 / RCA 诊断包 | 带构建期 SHA 注入 |

### 测试

| 命令 | 说明 |
|---|---|
| `npm run typecheck` | `tsc --noEmit`（提交前必过） |
| `npx vitest run --pool=forks --maxWorkers=1 <file...>` | **推荐口径**：逐文件串行，避免 OOM |
| `node tests/_e2e_garage_v2_formal_slice.cjs` | 正式 Garage 2.0 + 合成弹窗（**140/140**，需先 `build:portrait-lab`） |
| `node tests/_e2e_product_loop.cjs` | 产品闭环：两局真实打完 + 领奖 + 库存累积（**55/55**，同样读 `dist-portrait-lab/`） |
| `node tests/_e2e_fresh_account_slice.cjs` | 新账号全链（**22/22**） |
| `node tests/_e2e_demo_continuous_run.cjs` | 三局连续（**22/22**，约 5 分钟，建议后台跑） |

> E2E **必须串行**：每个脚本自带固定端口（如 Garage V2 用 8742），并行会互相抢端口。
> 浏览器统一走 `tests/_browser_launch.cjs`（唯一启动入口，Windows 默认系统 Edge，
> 也可 `npx playwright-core install chromium` 后用 bundled chromium）。

---

## 4. 已经完成并验收的产品能力（H5 正式链）

| # | 能力 | 状态 | 证据 |
|---|---|---|---|
| 1 | **极简正式首页**（`home.html`，无参数即正式版） | 完成 | `HOME-V2-MINIMAL-R1`（`30a4176`）+ `GARAGE-V2-DEFAULT-CUTOVER-R1`（`ad8a34f`） |
| 2 | **Garage 2.0 主打入口**：五槽（车身 / 武器 / 辅助 / 前轮 / 后轮）+ 4 列大图标背包 + 底部【返回首页】恒在画面内 | 完成 | `garageV2View.ts`、E2E 140/140 |
| 3 | **七档品质**（白→彩）真实影响战斗 | 完成 | `installQuality.ts`；白 80 → 彩 200（cannon 实测） |
| 4 | **五合一合成**（同部位 + 同品质 ≥5 → 主件升一档），同页居中弹窗 | 完成 | `fuseQualityFive`；弹窗 352×574，底部【返回装备】 |
| 5 | **品质件真实穿戴**（武器 / 轮组 / 推进器），落盘 + 重载 + Run 生效 | 完成 | `equipQualityProduct`；绿炮第一发真实 100 |
| 6 | **出战 → 结算 → 领奖 → 回首页** 完整循环 | 完成 | `runReward.ts`（`ADVENTURE_HREF` / `HOME_HREF`）、`e2e:product-loop` 55/55 |
| 7 | 旧星级 Garage 保留为兼容入口 `?garageLegacy=1` | 完成 | `homePage.ts:897-901` |
| 8 | 新账号空档 → 首战 → 首奖 全链 | 完成 | `e2e:fresh-account-slice` 22/22 |

**七档品质口径（冻结，禁改顺序与倍率）**

```
white 1.00 / green 1.25 / blue 1.50 / purple 1.75 / orange 2.00 / red 2.25 / chrome 2.50
```
- **不双乘**：安装件同时带 star 与 quality 时，quality **替代** star 的伤害倍率，不相乘。
- **单属性裁定**：Weapon = 伤害；Movement = `driveTorque`；Gadget（仅 thruster）= `thrustImpulse`。
- **卡片读数 = 战斗读数**：`buildSnapshot.tierDamageOf` 与 Runtime 同源。
- 品质数据流：`BuildDraft.functionalQualities / movementQualities / gadgetQuality`
  → `buildSnapshotFromDraft` → `applyRunModifiersToSnapshot` → `resolveSnapshot` → `contactRouter.ts:688/996`。

---

## 5. 五合一 / 库存 / 存档的不可违反语义

- 合成资格：**同部位 + 同品质 + 可用实例 ≥ 5**（可不同 `defId`），产出 = **主件 defId** 的下一品质一件。
- 不参与合成：Body（无数量模型）、旧 ★2..★5（`legacy-star-locked`）、装备中（`lockedReason='equipped'`）、
  彩品质（封顶）、非推进类 Gadget（无品质实效通道）。
- 实例绑定：`BuildDraft.equippedQualityInstances` 记录**具体实例 id**（`qv2:*`），
  加载时与账本逐条校验，幽灵绑定 ⇒ 整份存档作废（不静默修复）。
- `lockedReason` 语义 = **能否被合成分解**，**不是**能否穿戴（红/彩品质可正常穿戴）。
- 存档键（浏览器 localStorage）：`strongfruit.playerBuild.v1`（装备）、
  `strongfruit.ownedParts.v2`（拥有件）、`strongfruit.profileClaims.v1`（领奖幂等）、
  `strongfruit.garageV2Ledger.v1`（品质账本）。

---

## 6. H5 与微信小游戏是**两套 UI**，不得混同

| 维度 | 正式 H5 | 微信小游戏 |
|---|---|---|
| 入口 | `home.html` / `run-page.html` | `wechat/game.ts`（`dist-wechat/`） |
| UI 实现 | **DOM + CSS**（`.ph-*` / `.g2-*`，逻辑舞台 390×844） | **Canvas 2D 上屏**（`CanvasPlayerUIHost`，离屏合成） |
| Garage | **Garage 2.0**（五槽 / 单件背包 / 品质五合一） | **旧 Canvas Garage**（装配 / 合成 / 金币段位），**没有** Garage 2.0 界面 |
| 共享 | 数值、`core`、`battle`、`player` Gameplay Runtime | 同上（同一份，不复制） |
| 平台适配 | `platform/web*` | `platform/wechat*`（含 lifecycle / viewport / storage） |
| 验证手段 | 真实浏览器 E2E（playwright-core） | 微信开发者工具 + 真机（H5 E2E **不覆盖**微信） |

> **迁移注意**：本轮所有 UI 改动都只作用于 H5 DOM 层。改 `home.html` / `garageV2View.ts`
> 对微信 Canvas UI **零影响**；反过来，也**不能**用 H5 的验收结论声称微信端通过。

---

## 7. 已知技术限制与**历史未通过项**（不得写成通过）

### 7.1 vitest 预存红（18 条，闭集）

**provenance**：在 `HEAD` 独立 worktree 逐字复现后登记为基线；最近一次全量核对为
2026-10-18/19（`2f99b88` 前后），**本次迁移交接未重跑全量**。这些是历史债务，**不是**本轮引入。

```
T20、R22a、F1-R1、F1-R2、G1-05、R2-09、R2-10、LSE-04、LSE-21、
NR-14、RC-06b、RC-06c、RP-21、RP-27、H-05、EB-04、PC-14、PR-27
```
- 其中 `PC-14` / `PR-27`（`tests/productLoopRunReward.test.ts`）在 2026-10-19 的
  `ad8a34f` 与 `2f99b88` 两次独立运行中均复现 2 条失败。
- `PL-26` 曾登记为红，已随白名单补齐修复（19 → 18）。
- **判红纪律**：先建 HEAD 独立 worktree 复现，确认是预存红再记账；真缺陷必须拆独立 Bug Queue，
  禁止与当前 Queue 混并。

### 7.2 浏览器 E2E 陈旧族

| 脚本 | 现状 | 根因 |
|---|---|---|
| `e2e:product-home`（`_e2e_product_home.cjs`） | **10 条 FAIL** | `5e9abe6` 后首页极简化删除旧 DOM（如 `phHomeMovement`），断言未同步 |
| `e2e:next-run`（`_e2e_next_run.cjs`） | 崩溃（期望 3 槽、实际 4） | 第 5 槽 / 隐藏锤改动后用例未更新 |
| `e2e:product-star-power` / `product-reseed` / `product-reward` / `next-run-continuity` | 未逐个复核，疑同族 | 同上（`76faafc` 移除隐藏锤 + 新增槽位） |

建议：Windows 侧若要动这几条，**单独开 1 个 Queue** 统一刷新，不要夹在产品改动里。

### 7.3 产品事实性限制（**不是 bug，禁改数值**）

- **默认车打不赢**：`watermelonBody + cannon + 缺省轮` 在终局 RangedTurret 控距下 `FAILED`；
  可通关配置需换 `mangoBody + 双 smallWheel`。这是**引导 / 可玩性议题**，不是数值 bug。
  自然起点 cannon★1 胜率 4/5、machineGun 1/5 ⇒ ★2 需连续 4 胜。
- **权威可通关矩阵**：28 组 COMPLETE / 11 底盘（cannon 1、flamethrower 1、machineGun 4、
  shotgun 4、laser 1；hammer / rammer 0）。
- **品质件结构性限制**：Body 品质件不可穿（Body 无数量模型，`body-not-consumable`）；
  非推进类 Gadget 品质件无数值通道；`pushRod` 无品质支持。
- **旧 ★2..★5** 一律 `legacy-star-locked`，不可参与五合一。
- **桌面不专属布局**：1440×900 下 `.ph-frame` 按高度 contain 缩放（逻辑仍 390），两侧留黑。

### 7.4 微信侧已知问题

- `KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01`（`docs/KNOWN-ISSUES.md`）：iOS 冷启动后首页车辆可能缺失 /
  Garage 车辆缩至极小。单元测试绿、**真机未通过**，属临时降级，重启条件见该文档。
- 沙箱/CI **无法**启动微信开发者工具，微信相关验收必须真机或人工在工具内完成。

---

## 8. 产品方向（2026-10-21 口径）

### 正在研究：方向 B —— 尚未立项开发

- **形态**：**竖屏**；一次完整冒险 **超过 3 分钟**；由**多段短物理战斗串联**（而非单场定胜负）。
- **当前状态**：**仅方向研究，未立项、无实现代码、无排期**。
  Windows 接手后若继续，必须先出「方向 B 原型方案 + 验收口径」，再谈代码；
  **不要**把方向 B 的假设塞进现有单场 Run。
- 现有正式闭环（单场 Run + 领奖）**保持可用**，是方向 B 的可复用底座。

### 暂停中：真人 PVP

- **暂停开发，但不删除现有代码与设计**。
- 现状：仓库内**没有**实时 PVP 运行时；Matching 是**本地随机 PVE 对手**（不是联网匹配）。
- 纪律：不得以「暂停」为由删除 Matching / 对手生成 / 相关设计文档；恢复时需独立立项。

---

## 9. Windows 接手时的冻结范围（红线）

**数值与规则（禁改）**
- 七档品质顺序与倍率（1.00…2.50）、不双乘语义、单属性裁定（伤害 / driveTorque / thrustImpulse）。
- 合成资格与 `fuseQualityFive` 事务、装备事务、库存与领奖幂等。
- 物理 / 伤害 / 质量 / 速度 / 能量；旧 ★1..★5 上限；初始库存；
  奖励投放口径（`rewardChoiceIdsFor` = 本局实际装备的主武器，恒 0 或 1 条候选 —— **不是**固定 cannon）。
- 存档格式与迁移（`strongfruit.*` 四个键）；旧 `fuseStack` / 旧经济。

**界面与入口（禁改）**
- 极简首页布局（`HOME-V2-MINIMAL-R1`）；`?garageLegacy=1` 旧 Garage 兼容入口。
- Garage 2.0 已验收的交互结构：4 列大图标、背包标题「背包 / 点一件·换成它 / 合成」三段布局、
  【返回首页】恒在画面内、合成 = 装备页之上的居中弹窗（底部【返回装备】）、前后轮二选一。
- H5 与微信两套 UI **不得合并实现**、不得用一套的验收代表另一套。

**流程（禁做）**
- 不部署 GitHub Pages、不合并 `main` / `dev`、不强制推送。
- 不 `git stash`（临时补丁请放仓库外 temp 目录）。
- 每轮改动的边界取证必做：
  ```bash
  git diff --stat -- src/{core,battle,physics,render,player,platform,game,presentation,ui}
  git diff --exit-code -- src/core/content.ts src/battle/contactRouter.ts
  ```
- 新增 `src/product/` 模块必须在 `tests/productLoopHomeGarage.test.ts` 的 **PL-26 白名单**登记（闭集）。

---

## 10. 后续研究事项（候选，均**未立项**）

1. **方向 B 原型**：竖屏、>3 分钟完整冒险、短物理战斗串联（先方案后代码）。
2. **Body 数量模型**：Body 无「件数」概念 ⇒ 品质 Body 无法穿戴、无法合成；需独立设计决策。
3. **旧 ★2..★5 的去向**：当前只能 `legacy-star-locked` 占位，需设计转换/回收路径。
4. **产品引导**：默认车打不赢是体验事实，需引导或开局配置建议（禁止直接改数值）。
5. **陈旧 E2E 刷新**（§7.2）：单独 1 个 Queue，逐条对齐新 DOM。
6. **内容铺量**：`CONTENT-BATCH-EXPANSION-R2` / `CONTENT-ENCOUNTER-PLAYABLE-BATCH-R2`
   （注意每批须同步 3 处 `LAB_ENCOUNTERS` 计数守卫）。
7. **微信侧 Garage 2.0 对齐**：目前微信仍是旧 Canvas Garage，属独立议题。

---

## 11. 环境陷阱（Mac 已踩，Windows 请直接遵守）

1. **Node 必须 ≥ 24**（`engines`）；用 `npm ci` 而不是 `npm install`，保证 lockfile 一致。
2. **无 `.gitattributes`** ⇒ 建议 `git config core.autocrlf false`，避免工作区换行符漂移导致
   `git status` 长期脏。
3. **构建产物全部被忽略**（`dist*/`、`node_modules/`、`*.log`、`.env*`、`outputs/`、`tmp/`）：
   全新 clone **没有** `dist-portrait-lab/`，任何 E2E 必须先 `npm run build:portrait-lab`。
4. **vitest 内存**：并行跑重型物理用例会 OOM（exit 137 / SIGKILL）。
   稳态口径 `--pool=forks --maxWorkers=1`，**逐文件串行**。
5. **E2E 串行**：每个脚本固定端口（Garage V2 = 8742），并行必冲突；长 E2E（三局连续 ≈5 分钟）建议后台跑。
6. **`page.click()` 会滚动**：断言「元素是否在画面内」必须用 `getBoundingClientRect()` +
   `page.mouse.click(中心)`，否则屏外元素被自动滚进来 ⇒ **假绿**（本项目踩过）。
7. **dev 端口 strict**：5173 被占用直接失败，不会自动换端口。
8. **构建 `emptyOutDir:false`**：产物目录不会清空，复验前请确认构建时间戳。
9. **浏览器启动**：只走 `tests/_browser_launch.cjs`（Windows 默认 Edge；macOS 需 bundled chromium）。
   禁止再在 E2E 里硬写 `channel:'msedge'` 或 `C:/Program Files/...` 路径。
10. **UI 断言要断可见尺寸**：只断「节点存在」曾导致按钮退化成 31×38 仍 PASS；
    涉及按钮请同时断 `width/height ≥ 44` 与父容器。

---

## 12. 本次交接的自检结论

| 验收项 | 结果 |
|---|---|
| 分支正确 | `prototype-portrait-battle-lab` ✅ |
| HEAD = 远端 | `dbc5b8a42d2ee9ad643820efa5cd0bec2e8f9a13` ✅（本轮交接提交在此之上，见 §13） |
| 工作区干净 | ✅（交接前 `git status --porcelain` 空） |
| 关键源码/资源/测试完整 | ✅ 675 个跟踪文件（交接前）→ **677**（含本文档 + 当日 memory）：`src` 169、`tests` 335、`assets` 5、`docs` 67、`scripts` 8、`build` 2、`wechat` 3；根级 5 套 vite 配置 + 11 个 HTML 入口全部 TRACKED |
| 未跟踪但必需的文件 | **无**（`git status --untracked-files=all` 为空；被忽略的仅 `node_modules/` 与 `dist*/`） |
| 敏感/大文件 | 无 `.env` / 密钥 / 令牌 / 本地存档 / APK 解包资料入库；最大跟踪文件 ≈369 KB |
| 迁移阻断 | **无**（前置：Node 24 + 首次构建 + 浏览器） |

**未同步内容（按设计，非遗漏）**
- `node_modules/`（依赖，`npm ci` 重建）
- `dist/`、`dist-pages/`、`dist-portrait-lab/`、`dist-wechat/`（构建产物，命令重建）
- 浏览器 `localStorage` 存档（本地玩家数据，**禁止**入库）
- 本地录屏 / 验证输出（`outputs/`、`tmp/`，`.gitignore` 覆盖）

---

## 13. 交接提交

本次交接产生的提交只包含 **本文件** + **当日 memory 记录**（`.workbuddy/memory/2026-10-21.md`
与 `MEMORY.md` 现状指针）；没有修改任何 `src/`、测试、构建配置或存档代码。

| 项 | 值 |
|---|---|
| 文档路径 | `docs/handoff/MAC_TO_WINDOWS_20261021.md` |
| 交接基线 HEAD | `dbc5b8a42d2ee9ad643820efa5cd0bec2e8f9a13` |
| 交接提交 | `3435990781a2799ec8c01f45a9f0a00185bd00b3`（短 `3435990`，`MAC-TO-WINDOWS-HANDOFF-R1`） |
| 本文件后续修订 | 见 `git log -- docs/handoff/MAC_TO_WINDOWS_20261021.md`（只修计数/表述，不改结论） |

Windows 侧接管后第一步：`git pull` → `npm ci` → `npm run typecheck` → `npm run build:pages`，
然后按 §3 跑 E2E 复核；确认绿后再开新 Queue。
