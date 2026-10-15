# UX-BLUESTAR-EQUIP-FUSE-SIMPLIFY-R1｜单一背包 + 弹窗化装备/合成（借《蔚蓝星球》因果）

## 用户问题

《永远的蔚蓝星球》真实录屏对照：图腾背包底部带红点的【合成】入口 → 弹窗只列系统整理好的
可合成组 → 底部统一确认；装备是「点格 → 当前/新装备对比 → 替换 → 真实数值反馈」。
本项目 Garage 虽有装备网格+合成页签+5 槽，仍让玩家做太多星级/材料管理；点格立即穿戴
缺少替换前的决策证据。局内 HUD 已认可，**局内全部冻结**。

## 交付（删步骤为先；只改 homePage.ts / home.html / E2E）

### 1. 单一背包主视图（必改 1）

- **删除**「装备/合成」双页签（`.ph-garage-tabs`）与常驻 5 空材料槽工作台
  （`.ph-fuse-bench` 全家）—— CSS 与 DOM 双侧结构性退役；
- Garage = 整车预览 + 5 真实槽位（2×2+gadget 跨行）+ 分类卡阵（唯一滚动容器）不变；
- **【合成】独立按钮**（`data-ph-action="fuse-entry"`）：只有存在 `fusable===true`
  （= `canFuseStack` 同判据）的合法组才渲染红点数量徽标（`.ph-fuse-btn-badge`，
  源码级条件渲染，不是 CSS 假点）；无合法组时普通「合成」照旧可点、从不 disabled。

### 2. 「当前/新装备」对比确认弹窗（必改 2）

- 点任一库存格（Weapon/Body/Front/Rear/Gadget，含「未装载」）**不再立即写装备** ——
  打开轻量遮罩弹窗：**当前装备 | 新装备** 双列图形+名称（复用 `partIcon.ts` 真图标）；
- 属性行 = **真实可计算对比**（全部来自读数层，页面零自算）：
  Weapon=攻击/能量（`damage`/`energyInUse`）、Body=耐久/质量/能量容量、
  Movement=轮径/质量/能耗、Gadget=能量；真实数值差用 `ph-cmp-up/down` 着色 + ↑↓
  （箭头只在真实比较上；▲▼ 评价式组件仍然全禁）；
- 【取消】零写盘；空槽/卸下显示【装备】/【卸下】；【替换】调既有 `equipWeapon/Body/
  Movement/Gadget` **一次**（唯一写入口）→ 弹窗关闭、预览同次刷新；
- 合法性失败由既有 `ph-note-bad` 如实展示、装配保持原样（写入口内部保证），不假成功。

### 3. 图腾式合成弹窗（必改 3）

- 点【合成】→ 弹窗**只列** `count>=5 且 star 未满级` 的组（与 `canFuseStack` 同判据）；
  每组 = 武器图形 + 短名称 + `★N → ★N+1` + 5 枚材料缩略图（`min(count,5)` 个满格）；
- **不画** ★1..★5 切换栏、**不显示** 4/5、1/5 等不可合成组、**无常驻 5 槽台**；
- 仅一组时自动选中；多组点选（`data-ph-fuse-option`）；底部唯一【合成升星】确认
  —— 只对选中组调 `playerGrowth.fuseStack` **一次 5→1**（不批量消耗其它组）；
- 成功即时刷新（合成后重读 `inv/draft`，红点/库存/已装备星级同次更新；无剩余组自动
  关弹窗回主视图）；失败如实说明（`lastFuse.reason/detail`）。

### 4. 复用与探针（必改 4）

- 复用 `partIcon`、`loadoutReading/weaponEntries/bodyReading/movementReading` 真源、
  既有 `equip*`/`fuseStack` 写入口 —— 零新经济、零新规则；
- 探针：新增 `garageModal`（'equip'|'fuse'|null）+ `data-ph-modal-*`（slot/def/row/delta）
  + `data-ph-fuse-option*`；`garageFuseEntry*` 三条读数语义保留（选择器换按钮）、
  全部 `data-ph-weapon/body/movement/gadget` 卡探针原样保留。

## 截图证据（真实浏览器 390×844，`docs/ux-bluestar-r1/`）

| 文件 | 内容 |
|---|---|
| `R1-backpack-main-390.png` | 单一背包主视图：预览+5 槽+卡阵+【合成①】红点按钮；无页签/无空槽台 |
| `R1-equip-confirm-390.png` | 装备确认弹窗：当前炮★1 vs 新锤★1（双图形）+ 攻击 80→90↑ / 能量 30→25↓ |
| `R1-equip-confirm-wheel-390.png` | 轮组对比弹窗（轮径/质量/能耗同值如实显示） |
| `R1-fuse-modal-390.png` | 合成弹窗：唯一 machineGun ★1→★2 组 + 5 枚缩略图 + 唯一确认 |
| `R1-after-fuse-390.png` | 合成后：弹窗关闭、红点归零 |
| `R1-equip-confirm-desktop.png` | 桌面窄视口同流程 |

## 回归（本地技术结果，真人体验待真人验收）

- `tsc --noEmit` / `build` / `build:pages` / `build:portrait-lab` 全绿；
- 单测：GS 29/29（GS-01/05/09b/10/14/15/16/20/22 判据同步为弹窗契约——记录在测试内，
  非放宽；`↑↓` 禁令收窄为「禁评价式 ▲▼/ph-delta」）、readability 16/16、gadget 绿；
- 全量 vitest 19 failed = **Queue 前基线逐字同红**（`diff` 为空，DIFF-EXIT=0）；
- E2E：`e2e:fusion-grid` 重写 **8/8**（红点/弹窗单组/真实合成/取消零写盘/替换写盘）、
  `e2e:product-loop` **55/55**、`e2e:fresh-account-slice` **22/22**（新增 E2b 弹窗自动选中）、
  `e2e:demo-continuous-run` **22/22**、`e2e:pages-smoke` **11/11**、`e2e:run-hud` **13/13**；
- E2E 同步：四处装配 helper（loop/slice/demo/run-hud/pages-smoke）改为
  「点卡 → modal-replace」新闭环；`_e2e_run_hud.cjs` 的 `clickSelector` 补
  `scrollIntoViewIfNeeded`（卡阵滚动容器内视口外卡，修复后的真实缺陷）。

## 禁止项核对

不改局内 HUD/Run/物理/武器伤害、部件定义、初始库存、奖励、星级与 5合1；
未引入 4合1/宝石/品质锁/洗炼/商店/虚构战力/新经济；未合并 main、未扩 UI 重构。
