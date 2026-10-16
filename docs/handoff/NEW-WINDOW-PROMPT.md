# 新窗口对话指令 · Garage 2.0 品质底座 + 隔离 Lab + 极简首页交接

> 用法：新开窗口后，把下面「---」之间的内容**整段粘贴为第一条消息**。

---

## 上下文

我在做《最强水果》微信小游戏的 **Battle Runtime / 玩法层**（仓库 `HubinAI/fruits`，分支 `prototype-portrait-battle-lab`）。

上一窗口刚完成 **Garage 2.0 品质底座 + 隔离布局 Lab + 正式首页极简化**（4 个功能 Queue / 4 个功能 commit），
最终 SHA **`5217dff`**（功能链尾 `30a4176`），工作区 clean，全部已 push（local=remote 一致）：

| # | SHA | Queue | 一句话 |
|---|---|---|---|
| 1 | `0a5485b` | GARAGE-V2-QUALITY-FOUNDATION-R1 | 品质/实例模型 + 纯逻辑五合一事务（Foundation，含 file:line 审计） |
| 2 | `c945453` | GARAGE-V2-LEDGER-COHERENCE-R1 | 实例恒等性 + 双账本写桥 + 装备真实落盘 |
| 3 | `6880db0` | GARAGE-V2-INVENTORY-LAYOUT-LAB-R1 | **Garage 2.0 布局 Lab（存储完全隔离）** |
| 4 | `30a4176` | HOME-V2-MINIMAL-R1 | **正式首页极简化**（零件清单 → 产品首页） |

### 当前 Garage V2 数据形态（必读）

新模块 `src/product/garageV2Quality.ts`（**纯逻辑，未接正式 UI**）：

- `QUALITY_TIERS` 七档：white/green/blue/purple/orange/red/chrome（**彩封顶**），`nextQuality` / `isMaxQuality`；
- `ItemInstance`（instanceId / defId / slot / quality / consumable / lockedReason）；
  `projectItemInstances(effectiveInventory(draft), draft)` = 旧堆叠 → **逐件确定性投影**
  （`q1:<defId>:<star>:<n>`；消耗后**不复活**已耗 id；旧 ★2..★5 ⇒ `legacy-star-locked` 不可消耗）；
- `fuseQualityFive({ mainInstanceId, materialInstanceIds, draft })`：主件 + **恰 4 件**
  同部位 + 同品质（**可不同 defId**）五件互异实例 → 主件 defId 的**下一品质**一件；
  失败零写盘；成功一次原子保存；**写桥**把本次消耗 delta 同步扣进 `ownedParts.v2`；
  Weapon 装备档被合空 → 走 `validateSnapshot` 校验后 `savePlayerBuild` **真实落盘**；
  Movement/Gadget 装备中最后一件 → **拒绝**；
- `effectiveInventory(draft)` = B/C UI **唯一库存读口**（写桥后 `raw === effective`，双账本已消除）；
- `equipQualityProduct(productId, draft)` → **恒返回 `{ ok: false, reason: 'run-not-wired' }`**
  （7 档品质未接正式 Run 战斗，**不得假装可穿戴**）；
- 独立偏差账本 key `strongfruit.garageV2Ledger.v1`（v2 形状：`{ consumedIds[], highWatermark, synced }`；
  v1 数量读入自动升级）。

**前后轮裁定（已定）**：正式契约下前后轮是**同一类 Movement 的两个独立槽位** ⇒
品质「同部位」**不区分** rear/front，装备保护按槽位。

**Body 缺口（未解）**：`ownedBodies.v1` 是 id 数组**无数量** ⇒ 不开品质消耗
（`body-not-consumable`），「5 台车身合 1」需重新设计。

### B｜Garage 2.0 布局 Lab（`6880db0`，可整块删除）

- **实际入口**：`npm run dev:garage-v2-lab`（或 `npm run build:portrait-lab` 后开
  `dist-portrait-lab/garage-v2-lab.html`）。
- 三件套：`garage-v2-lab.html` + `src/product/garageV2LabMain.ts` + `src/product/garageV2Lab.ts`；
  构建**只**登记 `vite.portrait-lab.config.ts`（有 GV2L-02 守卫禁 pages/主配置引用）。
- 布局（390×844）：中上战车预览（正式 sprite 同源）/ 左右五槽（车身·武器·辅助 | 前轮·后轮）/
  下方背包 4 列（<375px 3 列、≥430px 5 列）/ 【合成】在背包标题右上（有合格组才红点数量）/ 底部仅返回。
- 格子 = `partIcon` 图形 + 品质边框（`--q` 七档 CSS）+ 部位角标（武/身/轮/辅）；
  **无名字 / 无数量 / 无星级 / 不堆叠**（名字只进 `title` 与弹窗）。
- ⚠️⚠️ **存储隔离范式**：入口壳在 **import 任何业务模块之前** `bindPlatformCore(<内存 Map 后端>)`
  ⇒ 一切 storage 读写落内存，真 localStorage **零接触**（E2E canary 逐字节验证）。

### C｜正式极简首页（`30a4176`）

- **正式生产入口**：`npm run build:pages` → `dist-pages/home.html`（开发 `npm run dev:home`）。
- 首页 = 层次背景（`.ph-screen` radial+linear）+ 中央真实战车（`phHomeCar`）+ 一行车身名
  → 纵向：`ph-home-start`（62px 亮黄，**唯一主 CTA**，实测 y=670 无滚动可点）+
  `ph-home-garage`（48px 弱化）。
- **已结构性退役**（同信息 Garage 仍可见）：`ph-stat` 数值行 / `ph-sec`+`ph-slots` 已装备列表 /
  `phHomeGrowth` / `phHomeMovement` / 4 段 `ph-note`。⇒ **不要再找首页 Movement 摘要**。
- **契约一字未动**：`open-garage` / `start-run`（可执行 = `<a href>` 由 `adventureHrefNow()`
  **实时**产出 ⇒ 与 Garage 换装同源；不可执行 = 无 href 的 disabled 按钮）、
  挂载时 `claimRunReward` 一次 + 重读 draft/inv、`openGrowthSession(draft)` 先于库存落盘。

### 本轮守卫契约变更（全部「同步非放宽」，明细见交接文档 §2）

QV-03/20/30/33（账本 v2 + 写桥守恒）、PL-26（+2 新模块登记）、
PS-01（首页不再画 Movement 摘要；可确认性迁到唯一入口 Garage）。
新增守卫：`garageV2LedgerCoherence` 8/8、`garageV2LabGuard` 3/3、`homeV2MinimalGuard` 4/4。

### 回归基线（判红必读）

- 全量 vitest **18 failed = 预存红闭集**（与起点基线**逐字一致** `IDENTICAL-18`）：
  T20、R22a、F1-R1/R2、G1-05、R2-09/10、LSE-04/21、NR-14、RC-06b/c、RP-21/27、H-05、EB-04、PC-14、PR-27
  （`PL-26` 已在本窗口第一轮登记修复，19 → 18）。
  ⇒ **判红必先建 HEAD 独立 worktree 复现**，否则记错账。
- 本轮全绿：pages-smoke 11/11、product-loop 55/55、demo-continuous-run 22/22（帧健康 0% 长帧）、
  fresh-slice 22/22；tsc + 三构建全绿。

### 环境与陷阱

```bash
cd /Users/yy/Documents/workbuddy/fruits
git rev-parse HEAD origin/prototype-portrait-battle-lab   # 应同为 5217dff
```

- ⚠️⚠️ **GitHub SSH 22 端口在本机被阻断**（`Connection closed by 198.18.0.80 port 22`）。
  推法（已验证）：
  ```bash
  git -c url."ssh://git@ssh.github.com:443/".insteadOf="git@github.com:" push origin prototype-portrait-battle-lab
  ```
  **不要改仓库 git config**。
- vitest 用 `--pool=vmThreads`；E2E 端口不可复用 ⇒ **串行跑**；长 E2E 后台跑（M5 ≈ 5 分钟）。
- ⚠️ 网格列必须写 `repeat(N, minmax(0, 1fr))`（写 `1fr` 会被 min-content 撑爆）；
  `partIconNode` 返回 **`.ph-part-icon`** ⇒ 新页面 CSS 要显式选择它。
- ⚠️ 合成候选组 key = `slot|quality`（**不看 defId**）⇒ 跨 defId 合并成组是规则本身。
- ⚠️ 弹窗卡片选择器用 **`.ph-modal-card`**（类），不是 `[data-ph-modal-card]`；Lab 探针前缀 `[data-g2-*]`。
- ⚠️ E2E 装配闭环 = 「点卡 → `[data-ph-action="modal-replace"]`」；合成 =
  `[data-ph-action="fuse-entry"]` → `.ph-modal-card [data-ph-action="fuse"]`。
- Movement：缺省轮 = `wheelStd`（不进库存）；真实轮组 = `smallWheel`/`largeWheel`/`heavyWheel`。
- 取证截图放独立目录（`e2e:run-hud` 会重拍 `docs/ux-perceptual-r2/A-run-*.png`）。
- 禁改：局内 HUD / Run / 物理 / 武器伤害（局内已冻结）、部件定义、初始库存、奖励投放、
  旧 5合1 规则、品质强度曲线；不引入 4合1 / 宝石 / 品质锁 / 洗炼 / 商店 / 虚构战力。

### 未完成（不冒充完成）

1. **正式 Garage V2 接入未做** —— 必须等「**七档品质真的能穿戴并影响 Run**」独立验收；
   `equipQualityProduct` 仍 `run-not-wired`。**Lab 完成 ≠ 正式体验完成。**
2. **7 档品质 ↔ Run 战斗强度映射**未拍板（α 降维 / β 扩曲线 / γ 独立字段，见 `docs/garage-v2/G2-AUDIT.md` §G）。
3. Body 无数量模型不开消耗；旧 ★2..★5 仍 `legacy-star-locked`。
4. 未部署 Pages、未合并 main。

**完整交接文档**：`docs/handoff/archive/交接文档_2026-10-16_garage-v2-foundation-lab-home_5217dff.md`
（含 4 个 Queue 明细、守卫变更表、18 预存红清单、10 条环境陷阱、验收入口速查）

**请等我下发下一个 Queue 指令，不要自动开工。**

---
