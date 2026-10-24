# FRUITS-ADVENTURE-UX-CONTINUITY-R1｜一屏式冒险重构 · 交付报告

> 基线 `49dc670`（F6 镜头稳定性）　分支 `prototype-portrait-battle-lab`
> 结论先行：**结构从「四页轮播」变成「一屏四段」**；非决策阶段的主操作从 **26 次降到 11 次**，
> **22 个纯信息阶段零点击**；同一 390×844 画面里战斗、事件、奖励、战报共享同一个舞台与同一张叙事卡。

---

## 1. 用户否定的真实原因（对照 PLAN 与录像）

PLAN 里的两条结论，我用代码与实测都复核过：

| PLAN 判断 | 代码事实（R1 前） | 是否成立 |
|---|---|---|
| 战斗/事件/奖励被拆成多个独立场景 | `advPage.draw()` 按 phase 分支：`EVENT_DONE`→「宝箱页」、`RESULT`→「战报页+收缩舞台」、其余→「王座厅页」 | ✅ |
| 反复点击「继续」 | `advActionLabel()` 对 `RESULT`/`EVENT_DONE` 返回「继续」；`EVENT` 返回「遭遇敌人」 | ✅ |
| 战斗舞台在切换时变形 | `RESULT` 把舞台带从 `648` 缩到 `468`（`RESULT_STAGE`），等于换了一套取景基准 | ✅（这正是 F6 报告里「切场跳变」的结构性成因之一） |

**根因不是视觉细节，是版面结构 + 推进语义。** R1 两处一起改。

---

## 2. 结构改造：四段恒定骨架

新的 `advLayout.ts`（新增文件，纯几何 + 九宫格，可单测）：

| 段 | 区域 | 内容 | 是否恒定 |
|---|---|---|---|
| ① TOP | `0..92` | DAY 进度 + 全程进度条 + 实时耐久 + 装备来源 | **恒定**（任何阶段都不消失） |
| ② STAGE | `92..470`（390×378） | **同一冒险舞台**：战斗实时 / 战报定格帧 / 事件与敌情把车留在场上 | **高度恒定** |
| ③ NARRATIVE | `470..744` | **固定叙事区**：事件、奖励、战报依次写入同一张浅色卡；决策时就地换成选项卡 | **恒定** |
| ④ ACTION | `744..844` | 底部唯一主操作；**纯信息阶段不画按钮** | **恒定** |

关键决策与理由：

- **舞台高度恒定是硬约束**（不是审美）。F1（等比合成）与 F6（逐帧平滑）的读数都以「舞台带尺寸不变」
  为前提。R1 前 `RESULT` 会改带高，等于让同一场战斗在切换瞬间换基准；R1 后全阶段一律 390×378。
- **决策卡搬进叙事区**，不再全屏遮罩。上方战场始终可见，对应 PLAN「覆在同一舞台上」的要求，
  同时避免遮挡战斗画面。
- **取消王座厅独立页**：`blitThroneRoom()` 已删除。非战斗阶段改用 `drawAdventureBackdrop()`
  自绘**同一片荒原**（同一地平线高度、同一冷暖对比），保证「战斗 ↔ 事件」切换时玩家看到的是同一个地方。

---

## 3. 推进语义：纯信息阶段自动承接

`advState.ts` 新增两个纯函数（UI / E2E / vitest 同源）：

```ts
advNeedsPlayer(s)   // IDLE / EVENT_CHOICE / CHOICE / COMPLETE / FAILED ⇒ true
advInfoPhase(s)     // 严格互补：BATTLE / EVENT / RESULT / EVENT_DONE
advAutoAdvance(s, ctx, script)   // 只推进 EVENT → BATTLE、RESULT → next、EVENT_DONE → next
```

纪律（写进代码注释，也有测试守着）：

- `pressAdventureAction()` 在 `EVENT / RESULT / EVENT_DONE` 上**变成 no-op**（返回同引用）；
- `advAutoAdvance()` 在决策点上**也是 no-op** ⇒ 调用方可以无脑调用，它自己保证不越过玩家决定；
- **推进走的是同一段代码**：`advAutoAdvance` 的 EVENT→BATTLE 分支与 R1 前
  `pressAdventureAction(EVENT)` 逐字段一致 ⇒ 经济与结果等价（§5 有 20 种子逐字段比对）；
- 停留时长：EVENT→BATTLE 1000 ms，RESULT→next 1200 ms，EVENT_DONE→next 1200 ms
  （只影响「让玩家读完」，不影响任何结算）；
- 复玩安全：`autoToken` 自增作废过期回调，`startNewRun` / dispose / 手动推进都会作废，
  旧局计时器不可能推进新局。

---

## 4. 美术：复用 PLAN 点名的 P0 素材 + 九宫格

素材（全部来自 `D:\1020卡皮巴拉\unpacked_1.9.3`，复制到 **gitignored** 的 `public/adventure-ui/`）：

| 新 id | 源文件 | 尺寸 | 九宫格边距 L/T/R/B | 用途 |
|---|---|---|---|---|
| `text_card_bg` | `atlasraft/battle_event_text_bg.png` | 182×164 | 23 / 10 / 23 / 23 | 叙事卡 + 决策卡底板（浅色米白，深色文字） |
| `event_bar_bg` | `atlasraft/battlenew_event_bg.png` | 1048×164 | 27 / 27 / 26 / 9 | 强边框事件条（备用） |
| `btn_green` | `atlasraft/btn_green.png` | 65×118 | 21 / 16 / 21 / 21 | 底部主操作按钮 |
| `btn_yellow` | `atlasraft/btn_yellow.png` | 65×118 | 21 / 16 / 21 / 21 | 备用强调 |
| `event_line` | `atlasraft/event_line.png` | 30×10 | 6 / 3 / 10 / 3 | 叙事卡分隔线（单轴拉伸） |
| `btn_chat` | `atlasraft/battle_event_btn_chat.png` | 185×102 | 41 / 32 / 21 / 34 | 备用（圆头图标按钮） |

**边距是量出来的，不是目测**：`docs/adventure-ux-continuity-r1/_probe_nine_slice.py` 沿对角线找
第一处 `alpha≥200` 的像素，取四角半径 + 2px 余量（产物 `nine_slice_insets.json` 可复算）。

> 实测记录（为什么不能用「找纯色带」的通用扫描）：这批素材是带高光/渐变/投影的立体按钮，
> 不存在 1px 级纯色带；通用扫描给出过 `L524/R523` 这种荒谬值（v4 与 v3 各试一次）。
> 最终采用只依赖 alpha 外轮廓的圆角弧线法 —— 对这类素材稳定。

`drawNineSlice()` 保证**四角源/目标尺寸 1:1**（角落不变形），目标过小时按比例收缩不产生负宽高；
`drawContain()` 保证图标/宝箱等比不拉伸。两者都有几何断言（§6 单测 3 条）。

---

## 5. 效果：连续性 + 等价性

### 5.1 连续性（E2E `_e2e_adventure_continuity_r1.cjs`，正常速度真实点击，scan-4）

| 指标 | R1 前（P0 基线） | R1 后 | 说明 |
|---|---|---|---|
| 主操作点击 | **26 次** | **11 次** | 省掉的就是 EVENT/RESULT/EVENT_DONE 上的「继续」 |
| 纯信息阶段数 | — | **22 个** | 全部零点击（等待自动承接） |
| 自动承接次数 | 0（不存在） | **22** | 与信息阶段数 1:1 对得上 |
| 选择点击（真实决策） | 8 次 | 24 次 | 选择次数上升是因为整局更长（R1 前 scan-4 在 6 场就失败） |
| 舞台带尺寸种类 | 2 种（648 / 468） | **1 种（390×378）** | 无整页换场 |
| 叙事区常驻率 | — | **100.0%** | 事件/奖励/战报同屏承接 |
| 假按钮点击 | — | **0** | 纯信息阶段不画按钮 |
| 素材加载 | — | **36/36，0 失败，0 素材 404** | |
| 终态 | FAILED（P0 时代 6 场） | **COMPLETE（DAY 26）** | |
| 复玩入口 | — | 新种子新开局 ✅ | |

### 5.2 等价性（`adventureContinuityR1.test.ts`，20 个种子）

同一脚本、同一选择，**「旧路径：每步按继续」与「新路径：纯信息自动承接」逐字段比对**：
`phase / day / buffs / carriedHp / battlesCompleted / battlesWon / eventResult / 全部日志文本`
全部相等 ⇒ 自动承接没有丢失任何真实奖励与状态结算。

---

## 6. 门控结果

| 门控 | 结果 |
|---|---|
| `tsc --noEmit` | **干净（0 错误）** |
| `adventureContinuityR1.test.ts`（新增） | **15/15** |
| `run_adventure_seed.test.ts` | 14/14 |
| `adventureTopDurability.test.ts` | 6/6 |
| `adventureBuildFeedback.test.ts` | 7/7 |
| `adventureCameraStabilityF6.test.ts`（F6 不退化） | **15/15** |
| `adventureBattleViewAspect.test.ts`（F1 不退化） | 10/10 |
| `adventureRepairValue.test.ts`（F5 不退化） | 15/15 |
| E2E `_e2e_adventure.cjs`（R4 胜/败/复玩） | **23/23** |
| E2E `_e2e_adventure_battle_frame.cjs`（F1） | **11/11**（像素宽高比偏差 **0.00%**） |
| E2E `_e2e_adventure_hp_bar.cjs`（F2） | **13/13** |
| E2E `_e2e_adventure_build_feedback.cjs`（F3） | **16/16** |
| E2E `_e2e_adventure_camera_f4.cjs`（F4） | **37/37** |
| E2E `_e2e_adventure_camera_f6.cjs`（F6） | **12/12**（主体屏宽 Δ **1.98%**、车底屏幕 Y Δ **0.7px**、RESULT Δpx **−0.0%**） |
| E2E `_e2e_adventure_camera_diag_d2.cjs`（D2） | **13/13** |
| E2E `_e2e_adventure_experience_review_r1.cjs` | **13/13** |
| E2E `_e2e_adventure_continuity_r1.cjs`（新增，胜局） | **13/13** |

---

## 7. 必须上报的三件事（都不是 R1 引入，但 R1 撞上了）

### 7.1 `tripleLoad` 存在**既存 DPS 崩塌**，已进入冒险策展排除项

headless 实测（演示装载，1100 耐久，`damageUp+rateUp+kineticBurst+heavyShell` 基础上）：

| 组合 | ProtoRusher（最弱敌） | ExtendedHeavyContact（终点） |
|---|---|---|
| `+ twinCannon` | **胜**（剩 978，maxShells=2） | **胜**（剩 409） |
| `+ twinCannon + tripleLoad` | **败**（1100→0，maxShells=3） | **败**（882 步归零） |

**在 HEAD `49dc670` 上用独立 worktree 复现，数字完全相同**（`A/978/866` vs `B/0/991`）
⇒ 与本 Queue 无关。但冒险整局必经 FINAL，发放它等于给玩家一条「拿到即必败」的死局，
故与既有的 `fastReload` 同列 `ADV_EXCLUDED_BUILD_IDS`。

> 真正的修复（炮管数/加载数的射出协调）属**物理与武器数值**，本 Queue 明令禁止改动，
> 这里只做奖励池策展并立此备查。**建议单开 Bug Queue**。

### 7.2 事件奖励池扩展到 7 项（为了修复「结构上不可能通关」）

R1 在真实浏览器里用「优先拿强化」的正常玩家策略跑 scan-4 时暴露：原事件池只有
`damageUp/rateUp/emergencyRepair` 三项，而第 6 场门槛敌与终点在 headless 下的实测是：

| build | BurnSaw | HeavyContact |
|---|---|---|
| `[]` | 败（615 步归零） | — |
| `damageUp+rateUp+heavyShell` | 败（625 步归零） | — |
| `twinCannon+damageUp+rateUp` | 胜（剩 443） | 败（391 步归零） |
| `twinCannon+damageUp+rateUp+kineticBurst` | 胜（剩 1012） | **胜（剩 352）** |

⇒ **只靠 3 项通用池结构上不可能通关**：通关需要 twinCannon + kineticBurst，而它们原本只在
BUILD 节点（layer1/layer2），一旦 BUILD 因池空被跳过（layer2 需先有 layer1 是既有设计），成长链就断。

修订：事件池加入 `twinCannon / tripleLoad / heavyShell / kineticBurst`（其中 tripleLoad 随后被 7.1 排除）。
**不改**：抽取概率结构、发放数量（仍一次一项）、耐久取舍、任何战斗数值。
`applyEffect` 的「取第一个未拥有候选」保证不重复发放。

### 7.3 真实物理下的难度分布（实测，供后续平衡参考）

24 个 `scan-*` 种子、真实物理 headless 全跑：**15 胜 / 9 败**（≈63% 通关）。
败局分布在第 3–6 场（如 `scan-1` DAY16 4/5、`scan-6` DAY8 2/3）。
R4 E2E 的败局种子因此从 `adv-r3-C`（现在能通关）换成 `scan-1`，依据写在代码注释里。

---

## 8. 仍未解决的问题（诚实披露）

1. **`emergencyRepair` 在常规路径里几乎拿不到**：F5 的 `advRepairHasRealValue` 要求
   「净贡献 > 0」才投放；满耐久开局 + 紧随阶段整备会把它完全顶回 ⇒ 整局可能一次都不出现。
   这是 F5 的**正确设计**（杜绝无效选择），代价是 F3 那一条「维修真实修理量」的 E2E 断言
   在本种子上变成**未覆盖项**（机制本身由 `adventureRepairValue.test.ts` 15/15 覆盖）。
2. **BUILD 节点可能因池空被跳过**（`layer2` 需先有 `layer1` 主路线）。这是 R3 起的既有设计，
   R1 未动；但配合 7.2 的池扩展后，玩家「该拿强化却没拿到」的体感仍需观察。
3. **`layer2` 专属强化（如 kineticBurst）无法做「同一 BUILD 节点」的前后对照** ⇒
   体验评审脚本的攻击强化对照只保留 twinCannon / heavyShell 两项（已如实写在脚本注释）。
4. **本次未做真人观感验证**（Queue 要求先过 GPT 视觉预验收）。我这一侧能做的是像素级版面审计
   （`_audit_layout.py`：四带填充、暗底占比、空洞检测、浅色卡占比），无法替代真人「爽不爽」的判断。

---

## 9. 证据与可复算

| 文件 | 说明 |
|---|---|
| `evidence/r1-win-*.png` | 正常速度关键帧（事件选择 / 结果 / 事件 / 战斗 / 战报 / 改装 / 通关 / 复玩） |
| `evidence/continuity-win.json` | 逐阶段轨迹（含血量、buff、胜负、主操作口径） |
| `evidence/layout_audit.json` | 每张截图的四带填充率、暗底占比、空洞坐标、浅色卡占比 |
| `_audit_layout.py` | 上述审计脚本（可对任意 390×844 截图重跑） |
| `_probe_nine_slice.py` / `nine_slice_insets.json` | 九宫格边距量取（可复算） |
| `_probe_assets.py` / `_probe_structure.py` | 素材透明边勘察 + 结构字符图（选型依据） |

复跑命令：

```bash
npm run build:portrait-lab
node tests/_e2e_adventure_continuity_r1.cjs              # 胜局 + 连续性
ADV_R1_LOSS=1 node tests/_e2e_adventure_continuity_r1.cjs # 败局分支
python docs/adventure-ux-continuity-r1/_audit_layout.py   # 版面审计
```
