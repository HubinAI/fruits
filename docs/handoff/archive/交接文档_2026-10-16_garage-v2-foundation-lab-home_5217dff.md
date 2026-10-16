# 交接文档｜Garage 2.0 品质底座 + 隔离布局 Lab + 正式首页极简化

- 日期：2026-10-16
- 分支：`prototype-portrait-battle-lab`
- 起点：`56aa253`（上一窗口链尾 = UX 感知三连 handoff）
- 终点：**`5217dff`**（memory log；功能链尾 = `30a4176`）
- 覆盖：**5 个功能 Queue / 5 个功能 commit + 4 个 memory log commit**，工作区 clean，全部已 push（local=remote 一致）

| # | SHA | Queue | 一句话 |
|---|---|---|---|
| 1 | `0a5485b` | GARAGE-V2-QUALITY-FOUNDATION-R1 | 品质/实例模型 + 纯逻辑五合一事务（Foundation，审计 + 22 测） |
| 2 | `c945453` | GARAGE-V2-LEDGER-COHERENCE-R1 | 实例恒等性 + 双账本写桥 + 装备真实落盘（RED→GREEN 8 测） |
| 3 | `6880db0` | GARAGE-V2-INVENTORY-LAYOUT-LAB-R1 | **Garage 2.0 布局 Lab（存储完全隔离）** |
| 4 | `30a4176` | HOME-V2-MINIMAL-R1 | **正式首页极简化**（零件清单 → 产品首页） |
| - | `ef8a586` / `eef7921` / `5217dff` + 1 | memory log ×4 | 交付记录 |

---

## 1. 各 Queue 核心事实（新窗口必读）

### Queue 1 = `GARAGE-V2-QUALITY-FOUNDATION-R1`（`0a5485b`）

- **审计**：`docs/garage-v2/G2-AUDIT.md`（全 file:line 实证）。四套拥有模型：
  Functional = `ownedParts.v2` 堆叠 ★1..5；Movement = 同 key 单档（`MOVEMENT_STAR=1`，`wheelStd` 不进库存）；
  Gadget = 同 key 单档；Body = `ownedBodies.v1` **id 数组（无数量）**。
- **装备引用**：weapon = `(frontMass, functionalStars)`；body = `bodyDefId`；
  movement = `frontWheelDefId`/`rearWheelDefId` **两个独立字段**；gadget = `gadgetDefId`。
- **前后轮裁定**：正式契约（`MovementDef=WheelDef`、hardpoint 无 kind 限制、同 defId 可双装）
  ⇒ 前后轮是**同一类 Movement 的两个独立槽位**；品质「同部位」**不区分** rear/front，装备保护按槽位。
- **新模块** `src/product/garageV2Quality.ts`：`QUALITY_TIERS` 七档（白绿蓝紫橙红彩，彩封顶）、
  `ItemInstance`（instanceId/defId/slot/quality/consumable/lockedReason）、
  `projectItemInstances`（旧堆叠 → 逐件确定性投影 `q1:<defId>:<star>:<n>`）、
  `fuseQualityFive`（主件 + 4 件同部位同品质**可不同 defId** → 主件 defId 下一品质）。
- **停止条款已执行**：`STAR_DAMAGE_MAX_STAR=5` 夹取 + Movement/Gadget/Body 无星级通道 ⇒
  **7 档品质未接正式 Run 战斗**（缺口与三方案 α降维/β扩曲线/γ独立字段见审计 §G）。
- **Body 缺口**：无数量模型 ⇒ 不开品质消耗（`body-not-consumable`），仅投影展示。

### Queue 2 = `GARAGE-V2-LEDGER-COHERENCE-R1`（`c945453`）

修 Foundation 审查发现的**三类一致性问题**（RED→GREEN，`tests/garageV2LedgerCoherence.test.ts` 8 条）：

- **RED 复现**：① 消费非尾号 ID 实际消失的是尾号（实例身份漂移）；② 账本记数量 ⇒ 消耗后领奖旧 id 复活/复用；
  ③ fuse 只写账本 ⇒ 旧 Garage 仍看到已耗材料（双账本）+ `equippedUpgraded` 只是布尔未落盘；
  ④ 旧 ★2..★5 投影为与初始白同权的可消耗件。
- **修实**：
  - **账本 v2**：`ConsumedRecord = { consumedIds: 具体实例 id[], highWatermark, synced }`；
    v1 数量读入自动升级（前 N 序号已耗，`synced=false`）——旧账本不丢；
  - **投影序号空间双口径**：`synced=true`（fuse 写桥已扣 raw）⇒ 幸存 + 已耗；非 synced ⇒ 原始数；
    两口径都**不复活**已耗 id；
  - **写桥（双账本消除）**：fuse 成功把**本次新消耗 delta** 同步扣进 `ownedParts.v2`
    （单调递减、精确守恒，QV-33 逐档验证）⇒ `effectiveInventory() === playerInventory()`；
  - **装备真实落盘**：Weapon 装备档被合空 → `validateSnapshot` 校验后 `savePlayerBuild` 真写
    `playerBuild.v1`（非布尔冒充）；Movement/Gadget 装备中最后一件 → **仍拒绝零副作用**；
  - **新 API**：`effectiveInventory(draft)`（B/C UI 唯一库存读口）+ `equipQualityProduct(productId, draft)`
    → 显式返回 `'run-not-wired'`（**不假成功**）。
- **B 队列接入契约**：`docs/garage-v2/COH-API.md`。

### Queue 3 = `GARAGE-V2-INVENTORY-LAYOUT-LAB-R1`（`6880db0`）

- **实际入口**：`npm run dev:garage-v2-lab`（或 `npm run build:portrait-lab` 后直接开
  `dist-portrait-lab/garage-v2-lab.html`）。
- 三件套（可整块删除）：`garage-v2-lab.html` + `src/product/garageV2LabMain.ts` + `src/product/garageV2Lab.ts`；
  构建**只**登记在 `vite.portrait-lab.config.ts`（**不进** `vite.pages.config` / 主配置 / 正式首页入口）。
- **布局**（用户拍板结构，390×844）：中上真实战车预览（正式 sprite 同源）→ 左右五穿戴槽
  （车身·武器·辅助 | 前轮·后轮）→ 下方背包 4 列（<375px 3 列 / ≥430px 5 列）→
  【合成】按钮在背包标题右上（有合格组才红点数量）→ 底部仅返回。
- **格子**：`partIcon` 图形 + 品质边框（`--q` 白绿蓝紫橙红彩 7 档 CSS）+ 微型部位角标（武/身/轮/辅）；
  **不显示**名字/数量/星级/不堆叠（名字只进 `title` 与弹窗）。
- **交互**：点材料/槽 → 「当前装备 / 背包选中」双图形对比；`legacy-star-locked` /
  `body-not-consumable` / 未接 Run 的品质件**直白置灰说明，不返回假"换装成功"**；
  【合成】只列 同部位+同品质 ≥5 组（排除 body/锁定/彩封顶），选主件 → 确定性取其余 4 件 →
  产物外形 + 下一品质即时可见 → 一键确认真实调 `fuseQualityFive`。
- ⚠️⚠️ **存储隔离范式（可复用）**：入口 `garageV2LabMain.ts` 在 **import 任何业务模块之前**
  `bindPlatformCore(<内存 Map 后端>)` ⇒ 库存/账本/Build 全落内存，**真 localStorage 零接触**。
  E2E canary 实测：预置 `ownedParts.v2='{"CANARY":{one:9}}'` → 全程操作后**逐字节不变**。
- 守卫 `tests/garageV2LabGuard.test.ts` 3/3（GV2L-01 入口隔离顺序 / GV2L-02 构建隔离 / GV2L-03 视觉契约）。

### Queue 4 = `HOME-V2-MINIMAL-R1`（`30a4176`）

- **正式生产入口**：`npm run build:pages` → `dist-pages/home.html`（开发 `npm run dev:home`）。
- **renderHome 收敛为**：`.ph-screen` 层次背景（radial + linear 叠加）+ 中央 `phHomeCar`
  （`vehiclePreviewLayout` 零画布）+ 一行车身名 → 纵向行动区：`ph-home-start`（62px 亮黄，
  **唯一主 CTA**）+ `ph-home-garage`（48px 弱化）。主 CTA 实测 `y=670 / h=62` ⇒ 390×844 无滚动可点。
- **结构性退役**（同信息 Garage 仍可见）：`ph-stat` 数值行 / `ph-sec`+`ph-slots` 已装备列表 /
  `phHomeGrowth` / `phHomeMovement` / 4 段 `ph-note` 说明文字。
- **契约一字未动**：`open-garage`（视图切换零跳转）、`start-run`（可执行 = `<a href>` 由
  `adventureHrefNow()` **实时**产出 ⇒ 与 Garage 换装同源，实测换机枪后 `href` 含 `machineGun`；
  不可执行 = **无 href** 的 disabled 按钮）、挂载时 `claimRunReward` 一次 + 重读 draft/inv、
  `openGrowthSession(draft)` 先于任何库存落盘、`renderHeader` 仍带 `claimNotice`。
- 守卫 `tests/homeV2MinimalGuard.test.ts` 4/4（HV2-01 结构收敛 / 02 契约保留 / 03 领奖+新手链路 / 04 CSS 层级）。

---

## 2. 守卫契约变更表（全部「同步非放宽」，变更记录写在测试内）

| 守卫 | 文件 | 变更 | 理由 |
|---|---|---|---|
| QV-03 | `garageV2QualityFoundation.test.ts` | v1 数量账本升级语义 ⇒ 前 N 序号已耗、剩余 = 后段 id | 账本 v2 实例化 |
| QV-20/30 | 同上 | 账本断言改 v2 形状（具体 id 列表 + 高水位 + `synced`） | 同上 |
| QV-33 | 同上 | 「旧 key 逐字节不变」⇒「旧 key 变化**恰好等于消耗 delta**，未涉及档位不变」 | 写桥引入（双账本消除） |
| PL-26 | `productLoopHomeGarage.test.ts` | +`garageV2Quality.ts` / +`garageV2Lab.ts` import 闭集 | 新模块登记 |
| PS-01 | `productMovementProductLoopSurface.test.ts` | 「首页画出 Movement 摘要」⇒「首页**不得**再画；Garage 侧真源/遍历/标签表不变；`open-garage` 入口仍在」 | HOME-V2-MINIMAL 契约 |
| GS-01/05/09b/10/14/15/16/20/22+MVR-11 | `productGarageMobileInteraction.test.ts` | （上一窗口，本窗口未动）弹窗契约 + 全页零拖拽 + `↑↓` 只许真实差值 | 见上一窗口交接 |

### 新增守卫（本窗口）
- `tests/garageV2LedgerCoherence.test.ts` 8/8（R1a/R2a/R2b/R3a-d/R4a，RED→GREEN）
- `tests/garageV2QualityFoundation.test.ts` 22/22
- `tests/garageV2LabGuard.test.ts` 3/3
- `tests/homeV2MinimalGuard.test.ts` 4/4

---

## 3. 回归基线（判红必读）

- **全量 vitest `18 failed` = 预存红闭集**（与本窗口起点基线**逐字一致**，`diff` 为空 `IDENTICAL-18`）。
  清单：T20、R22a、F1-R1/R2、G1-05、R2-09/10、LSE-04/21、NR-14、RC-06b/c、RP-21/27、H-05、EB-04、PC-14、PR-27
  （`PL-26` 已于本窗口第一轮**登记修复**，故从 19 降到 18）。
  ⇒ **判红必先建 HEAD 独立 worktree 复现**（`git worktree add /tmp/x HEAD` + symlink node_modules），否则记错账。
- **本窗口全绿**：pages-smoke 11/11、product-loop 55/55、demo-continuous-run 22/22（帧健康 0% 长帧）、
  fresh-slice 22/22；typecheck + `build` + `build:pages` + `build:portrait-lab` 全绿。
- ⚠️ `product-loop` / `fresh-slice` / `demo-continuous-run` / `run-hud` / `pages-smoke` 的装配 helper
  **已同步**「点卡 → `[data-ph-action="modal-replace"]`」闭环；合成路径 =
  `[data-ph-action="fuse-entry"]` → `.ph-modal-card [data-ph-action="fuse"]`。

---

## 4. ⚠️ 环境与陷阱（踩过，新窗口必读）

```bash
cd /Users/yy/Documents/workbuddy/fruits
git rev-parse HEAD origin/prototype-portrait-battle-lab   # 应同为 5217dff
```

1. **GitHub SSH 22 端口在本机被网络阻断**（`Connection closed by 198.18.0.80 port 22`）。
   可行推法（已验证 local=remote）：
   ```bash
   git -c url."ssh://git@ssh.github.com:443/".insteadOf="git@github.com:" push origin prototype-portrait-battle-lab
   ```
   （`ssh -T -p 443 git@ssh.github.com` 认证成功；HTTPS `ls-remote` 亦可达。**不要改仓库 git config**。）
2. vitest 用 `--pool=vmThreads`；E2E 端口不可复用 ⇒ **串行跑**；长 E2E 后台跑（M5 ≈ 5 分钟）。
3. ⚠️ **CSS 陷阱（Lab 踩过）**：
   - 网格列必须写 `repeat(N, minmax(0, 1fr))` —— 写 `1fr` 会被按钮/图片 min-content 撑成 204px 溢出；
   - `partIconNode` 返回的是 **`.ph-part-icon`**（不是自定义类）⇒ 新页面 CSS 必须显式选择它，
     否则 sprite 会以**原始尺寸**绝对定位溢出容器。
4. ⚠️ **合成成组规则**：候选组 key = `slot|quality`（**不看 defId**）⇒ 同部位同品质跨 defId 会合并成一组
   （这是规则本身，不是 bug）。
5. ⚠️ **弹窗卡片选择器**用 `.ph-modal-card`（**类**），不是 `[data-ph-modal-card]`（该属性不存在）。
6. ⚠️ **弹窗按钮选择器**用 `[data-ph-action="close"]` / `[data-ph-action="modal-replace"]` /
   `[data-ph-action="fuse"]`；Lab 用 `[data-g2-*]` 前缀（与正式页隔离）。
7. ⚠️ **浏览器 E2E 跨 evaluate 的 locator 定位器怪癖**（本窗口踩过）：同一元素 `waitFor(visible)` 通过
   但 `boundingBox()` 超时、紧接 `querySelector` 返回 `null` 的现象出现过 ⇒ **Lab 冒烟改为单 evaluate
   原子段**（点击→断言→关闭全在页内一次执行）可绕过；正式 E2E 现有 helper 工作正常。
8. Movement 缺省轮 defId = `wheelStd`；真实轮组集合 = `smallWheel` / `largeWheel` / `heavyWheel`。
9. 取证截图放独立目录（`e2e:run-hud` 会重拍 `docs/ux-perceptual-r2/A-run-*.png`，别混放）。
10. **禁改**：局内 HUD / Run / 物理 / 武器伤害（局内已冻结）、部件定义、初始库存、奖励投放、
    星级与 5合1 旧规则、品质强度曲线；不引入 4合1 / 宝石 / 品质锁 / 洗炼 / 商店 / 虚构战力。

---

## 5. 未完成 / 阻塞（如实登记，不冒充完成）

1. **正式 Garage V2 接入未做** —— Queue 收口明确要求：必须等「**七档品质真的能穿戴并影响 Run**」
   的独立验收后再做。当前 `equipQualityProduct` 仍返回 `run-not-wired`，Lab 只演示受限交互。
   **Lab 完成 ≠ 正式体验完成。**
2. **7 档品质 ↔ 正式 Run 战斗强度映射**未拍板（三方案见 `docs/garage-v2/G2-AUDIT.md` §G）：
   α 品质降维映射 star / β 扩战斗曲线（`STAR_DAMAGE_MAX_STAR` 5→7）/ γ 独立品质字段。
   ⇒ 彩色格子**不代表**更强战斗。
3. **Body 无数量模型** ⇒ 不开品质消耗；「5 台车身合 1」需重新设计生成规则与战斗倍率。
4. **旧 ★2..★5 仍锁定**（`legacy-star-locked`），品质映射待设计决策。
5. 未部署 Pages、未合并 main。

---

## 6. 验收入口速查

| 要验什么 | 命令 / 路径 |
|---|---|
| Garage 2.0 布局 Lab | `npm run dev:garage-v2-lab` |
| 正式极简首页 | `npm run dev:home` → `dist-pages/home.html` |
| 正式 Run 页 | `npm run dev:run-page` |
| 品质底座单测 | `npx vitest run tests/garageV2QualityFoundation.test.ts tests/garageV2LedgerCoherence.test.ts` |
| Lab 隔离守卫 | `npx vitest run tests/garageV2LabGuard.test.ts` |
| 首页极简守卫 | `npx vitest run tests/homeV2MinimalGuard.test.ts` |
| 首页→Garage→Run 全链 E2E | `node tests/_e2e_product_loop.cjs` |
| 连续三局 M5 | `node tests/_e2e_demo_continuous_run.cjs` |
| Pages 冒烟 | `npm run e2e:pages-smoke` |
| B/C 截图与说明 | `docs/garage-v2/BATCH-BC-README.md` + `B-lab-*.png` / `C-home-*.png` |
