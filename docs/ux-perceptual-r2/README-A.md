# UX-PERCEPTUAL-R2 · Queue A：UX-RUN-STATUS-PRESENCE-R2

> 分支 `prototype-portrait-battle-lab`｜base HEAD `5b23064`（UX-VIDEO-BATCH-R1 之后）
> 独立 Commit A（本目录截图 = 本 Queue 的真实浏览器取证，非真人录屏）

## 1. 问题（用户 2026-10-14 录屏 + GPT 生产构建截图复核，逐字）

① 局内参照《卡皮巴拉》在**中间显眼位置**展示战车攻击/血量；
② R1 已做功能，但 GPT 独立用 390×844 正式生产构建截图复核：
   **攻击 20 / 耐久 950/950 仍是屏幕左上 DAY 下方的小字（y≈44–70）**，不够可感知。

只修这一项感知缺口，优先显著差异，不做 10% 微调。

## 2. 调查（先查后改）

### 2.1 面板放哪：实测碰撞，不是猜

用真实浏览器（Playwright + 生产构建）在 390×844 下逐帧采样
（`/tmp/ux_r2a_measure*.cjs`，数据落 `/tmp/ux-r2a-recs.json`）：

| 候选区 | 实测结论 |
|---|---|
| 建议区 x70..320 / y100..160（战场偏上） | **不可用**：敌军（Chaser 跳起）车顶最高到 band 相对 y=23 ≈ 页面 y≈103，与建议区真实重叠（b2 战斗 289 采样里高位样本在 x≈145–245） |
| 战场带底部 page y296..372 | **可用**：0/289 战车重叠；亮像素（轮-地接触点火花）全部 ≤ y305；战斗相位**不登记** ground/road 进像素账本（`runPageScene.ts` 账本口径）⇒ 面板对账本零影响 |
| IDLE 相位 | 面板整体隐藏（`statusHud.visible=false`）⇒ 不遮待机车辆 |

⇒ 定案：**面板放战场带底部、水平居中**（比建议区更靠下，但这是实测唯一无碰撞区；
   「中间显眼」由「大数字 + 长血条 + 高对比底色」达成，而不是靠挤进战场上部）。

### 2.2 R1 的两个真实缺陷（本轮一并修）

1. **感知失败**：HUD 缩在顶部 80px 带内（44–70px），数字 17px、血条 96×10；
2. **图标让位过度**：R1 为给 HUD 腾行把强化图标 30→22px 并右移 ⇒
   `e2e:run-page` 在 HEAD 上**16 个预存红**（期望 30×30 净色 756，实际 22×22 净色 340）。
   本轮恢复图标 pre-R1 几何（30px / x=16 / y=44 左对齐）⇒ 16 红全绿（453/453 PASS）。

## 3. 改了什么（src/lab/portraitBattleLab/）

### 3.1 `runPageLayout.ts`

- 删除 `RUN_STATUS_HUD` / `runHpBarRect` / `runHpBarFillW` / `runAtkGroupX`（顶部行几何）；
- 新增 **`RUN_STATUS_PANEL`**（战场带底部、水平居中）：

  ```ts
  export const RUN_STATUS_PANEL = {
    y: 308, h: 66, w: 250, pad: 14,
    barW: 132, barH: 12, gap: 12,
  } as const;
  // runStatusPanelRect()   → 水平居中（(390−250)/2 = 70）
  // runStatusAtkX()        → 攻击大数字区 x（血条右侧）
  ```

- `RUN_BUFF_ICON` 恢复 **pre-R1**：`{ size: 30, gap: 8, x: 16, y: 44 }` 左对齐
  （`runBuffIconRects` 回到改前口径；DAY 行下就是图标行，与改前逐像素一致）。

### 3.2 `runPage.ts`

- 删除 `drawStatusHud`（顶部小字版）；新增 **`drawStatusPanel`**：
  - 攻击：**32px 大数字** + 「攻击」标签 + 主武名（小字）；
  - 耐久：`当前/上限` + **132×12 长血条**（前景按真实比例，≤25% 转 `hpLow` 红）；
  - 面板底 = 半透明深底 + 1px 描边（`#1b2432` 系 + `dayAccent` 描边）⇒ 与战场高对比；
  - **所有用色与入账色 RGB 互斥** ⇒ 像素账本零影响（`emptyRunLayerAreas` 守卫不变）。
- `draw()` 在战斗层之后、动作按钮之前画面板；`overlayOpenNow()`（CHOICE/结算浮层）
  期间**不画**（探针 `statusHud.visible=false`）；IDLE 相位同样不画。
- 探针 `statusHud` 改为 `{ hp, hpMax, atk, atkWeaponDefId, visible, panel, hpBar, hpBarFillW }`：
  - `hp`：战斗中 = `s.battle.playerHp/playerHpMax`；否则 `runCarriedPlayerHp(s) ?? ctx.playerHpMax`；
  - `atk`：`weaponMainDamage(applyStarTier(composePlayerRunWeaponDef(...)))`（与 R1 同源链，零新规则）；
  - `hpBar`/`hpBarFillW`：E2E 可断言「像素前景宽 == 声明宽」。

## 4. 真源纪律（未动）

物理 / HP / 伤害 / 强化 / Run 行为 / 对手 / 初始配置 / 战斗 Runtime **一字未改**；
攻击数字仍是主武单次伤害（同一合成链纯函数复算），耐久仍是真实受击读数。

## 5. 验证

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ |
| `npm run build` / `build:pages` / `build:portrait-lab` | ✅ |
| `vitest portraitRunPage.test.ts` | ✅ 仅 RP-21/RP-27 两个**预存红**（干净 HEAD worktree 同红复现） |
| 全量 `vitest run` | 21 failed / 2939 passed ⇒ **全部 21 个在干净 HEAD worktree 逐字同红**（清单见下） |
| `e2e:run-hud`（重写） | ✅ **13/13**（新几何 + 真实像素 + 双视口 + 车不遮挡采样） |
| `e2e:run-page` | ✅ **453/453**（HEAD 16 个图标预存红被几何恢复修掉） |
| `e2e:pages-smoke` / `e2e:demo-continuous-run`（M5） | 见 commit message |

### 5.1 截图（390×844 + 窄桌面，真实生产构建）

- `A-run-390-battle.png` — 390×844 战斗中：面板居中在战场带底部，
  攻击 32px 大数字 + `25/120` 真实读数、耐久 `1040/1100` + 长血条；
- `A-run-desktop-battle.png` — 窄桌面（1280×720@1.5）：同样居中醒目；
- 两图均实测：战车 / 弹道 / 命中不被面板遮挡（0/289 重叠）。

### 5.2 `e2e:run-hud` 新断言（不删测，全真源）

- H-01 HUD 读数真源：hp/atk 与探针 / 存档一致（受击后 hp 1100→1040 实时变）；
- H-02 BATTLE 期间持续可读（面板 visible=true 且跨帧读数变化）；
- H-03 攻击 = 主武单次伤害（=== playerWeapons[0].damage）；
- H-04 血条像素取证：前景精确色像素宽 == 声明 `hpBarFillW`（±2px，`getImageData` 真实像素）；
- H-05 血条与攻击数字区不重叠（扫中心单行，非面积）；
- H-06 面板在战场带内、水平居中（`(390−250)/2`）；
- H-07 CHOICE 浮层期间面板消失（visible=false + 面板专属底色像素 0）；
- H-08 跨两场战斗战车不遮挡面板（289 帧 bbox 采样，0 重叠）；
- H-09 双视口截图（390×844 + 1280×720@1.5）；
- H-10 结算 / 3 选一 / 触摸区无遮挡（探针 + 区域扫描）；
- H-11~13 真实受击 / 升级读数正确 + 无 JS 错误。

### 5.3 全量 21 个失败 = HEAD 预存红（worktree 逐字复现，非本轮引入）

`playerRewardAcquisitionR1 T20`、`portraitBattleLab R22a`、`portraitBattleLabF1 F1-R1/F1-R2`、
`portraitBattleLabG1 G1-05`、`portraitDefaultEntry R2-09/R2-10`、`portraitLightSwarmExperience LSE-04/LSE-21`、
`portraitNextRunValidation NR-14`、`portraitRunKineticImpact RC-06b/RC-06c`、`portraitRunPage RP-21/RP-27`、
`portraitValidationHub H-05`、`productEncounterContentBatchR1 EB-04`、`productLoopHomeGarage PL-26`、
`productLoopRunReward PC-14/PR-27`。
（PR-27 的禁词 `weaponMainDamage` 是上一轮 R1 引入 runPage.ts 所致，同样在干净 HEAD 复现；
  建议独立队列 `E2E-STALE-ROUTES-REFRESH-R1` 统一刷新，不混入本 Queue。）

## 6. 明确未做（诚实披露）

- **未部署**（本 Queue 禁止项遵守）；
- 面板位置是「实测唯一无碰撞区」而非 Queue 建议的 y100..160（该区与跳起敌军真实重叠，
  数据在 §2.1）——这是**有证据的偏离**，不是微调；
- 真人体验结果（是否「像卡皮巴拉一样显眼」）需真人验收，本节只给技术结果。
