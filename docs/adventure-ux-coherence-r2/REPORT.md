# FRUITS-ADVENTURE-UX-COHERENCE-R2｜同场景连续冒险 + 产品级卡片 · 交付报告

> 基线 `a9111f7`（R1 一屏式结构）　分支 `prototype-portrait-battle-lab`
>
> **本轮定位**：R1 的**结构**保留（一屏四段 + 自动推进不动），修的是 R1 被真人预验收否掉的三件事
> —— 空间割裂、卡片挤压、非战斗没车；同时**把 R1 越界的玩法改动恢复原状**。

---

## 1. 为什么 R1 会被否（不是审美，是三处结构没做完）

| 真人否定点 | R1 的真实原因（代码事实） |
|---|---|
| 战斗是蓝色竞技场，事件是棕色荒原 | 战斗背景来自 `renderer.drawBattleArena()`（程序化：蓝天空 + 看台 + 聚光灯）；非战斗由 `advPage.drawAdventureBackdrop()` **另画**一套棕色渐变山脉。**两条完全独立的绘制路径**，R1 只把色温调近，属于「同一个坐标假装同一处」 |
| 卡片文字截断/挤压/重叠 | `drawChoiceCard` 把「名称 + 收益 + 代价」全塞在**同一行**，逼得字号只有 13/12px，收益与代价还要左右抢宽度；卡片高度按可用空间均分（n=2 → 118px，n=3 → 78px），三行文字被压到 26px 行距 |
| 非战斗没有战车 | 非战斗时没有 `RunBattleRuntime`，Renderer 不画车 ⇒ 舞台上只有文字 + 背景，画面退化为「空背景 + 标题」 |
| R1 改了玩法规则 | `EVENT_BUFF_POOL` 从 3 项扩到 7 项；`ADV_EXCLUDED_BUILD_IDS` 从 `['fastReload']` 加了 `tripleLoad` |

---

## 2. 必改 1：统一真实舞台（同函数、同素材，不是同坐标）

### 机制

```
              ┌─────────────────────────────────────────┐
              │ Renderer.drawAdventureSceneBackdrop()   │  ← 唯一场景绘制函数
              │ Renderer.drawAdventureSceneGround()     │  ← 唯一地面绘制函数
              └───────────────┬─────────────────────────┘
        ┌─────────────────────┴─────────────────────┐
   战斗（离屏 renderer.render）              非战斗（页面画布 advPage.drawStage）
   · 天空区：drawAdventureSceneBackdrop     · 背景：drawSceneBackdrop →
   · 地面：drawBattleArena(platformOnly)      Renderer.drawAdventureSceneBackdrop
                                            · 地面：drawSceneGround →
                                              Renderer.drawAdventureSceneGround
```

- `RunBattleView.setSceneBackdrop(img)` 把 **P0 的 `battle_bg.png`** 注入 Renderer；
  `advPage` 在 `ui.load()` 完成时调用 `syncSceneBackdrop()`（唯一接线点）。
- 战斗侧：`battleBackdrop` 为真且已注入 ⇒ 天空区改用场景图，**不再调用** `drawBattleArena`
  的天空/看台/聚光灯；只保留 `platformOnly` 地面层。
- 非战斗侧：**不再自绘任何东西**，直接调 Renderer 的同一对函数。
- 未注入（普通 Run / 其它 Lab 页 / 素材缺失）⇒ 战斗走原 `drawBattleArena`，非战斗走同族回落
  ⇒ **零回归**，且两边**同时**降级，不会出现「一半有图一半没图」。

### 关键修复：远景背景必须与相机解耦

战斗侧原本拿 `gy = sy(arena.groundY)`（随 F4/F6 自适应镜头每帧变化）当背景绘制高度，
于是远景被镜头一起推拉 —— 实测战斗帧与事件帧最佳对齐色差 **35.9（>15 即判为不同画面）**。
改为用**固定地平线** `viewHeight × 0.62` 作背景基准（远景本就不该跟随相机位移），
战斗平台仍用 `gy`（车辆站立位置必须与物理一致）。

### 实测结果（`_audit_sequence.py`，同一局连续 7 帧）

| 帧 | 阶段 | 地平线 | 舞台平均亮度 | 车辆绿色像素 |
|---|---|---|---|---|
| seq-01 | EVENT_CHOICE | **326** | 92.1 | 5472 |
| seq-02 | EVENT_DONE | **326** | 92.1 | 5472 |
| seq-03 | EVENT | **326** | 92.7 | 5472 |
| seq-04 | BATTLE | **330** | 116.4 | 1884（镜头拉近，车部分出框） |
| seq-05 | RESULT | **361** | 125.9 | 6276 |
| seq-06 | CHOICE | **326** | 92.2 | 5472 |
| seq-07 | FAILED | **326** | 91.7 | 5472 |

- **非战斗 5 帧地平线完全一致（326）、互相色差 0–3.5** ⇒ 同一场景（不是调色接近，是同一张图的同一次换算）。
- **战斗 330**（+4px）⇒ 镜头在交战时会小幅上移，属 F4/F6 的正常取景。
- **RESULT 361**（+35px）⇒ F6 的「沿用末帧取景」会裁掉一部分，**这是 F6 的设计目标**
  （消除切场缩放跳变），本轮不动它 —— 为了画面整齐去破坏 F6 是倒退。
- 亮度 92 → 116/126：场景图叠了一层**暖色补光**（同函数，两边都生效），消除「暗板」观感。

---

## 3. 必改 1 补充：非战斗也要有战车（验收 3）

`advPage.drawIdleVehicle()` 用**正式车辆美术**（`body_watermelon` + `part_cannon`，
与战斗同一批 PNG，经 `RunBattleView.vehicleImage()` 只读取用）拼出待机战车：

- 车体宽 150px（与战斗远景观感接近，实测战斗帧车约 130–188px）；
- 车轮压在地平线上（`groundY = b.y + b.h*0.62`，与地面层同一条线）；
- 车底有接地阴影（径向渐变压扁 0.22），让车「站」在地上而不是浮着；
- 炮管贴车体右上、炮口朝右（与战斗同朝向）。

**实测**：非战斗帧绿色车体像素 **5472**、包围盒 y=[246,322]（正好压在地平线 326 之上）⇒
「非战斗阶段战车有清晰视觉存在感」是像素级可验证的事实，不是文案。

---

## 4. 必改 2：卡片重排（不靠缩字号塞字）

### 旧 vs 新

```
旧（一行三栏，13/12px，收益与代价抢宽）        新（三行结构化，19/14/14px）
┌────────────────────────────────────┐      ┌────────────────────────────────────┐
│[icon] 名称   收益 xxx   代价 ——    │      │[icon]  名称                  （19px）│
└────────────────────────────────────┘      │        收益  恢复耐久          （14px）│
                                            │        代价  ——                （14px）│
                                            └────────────────────────────────────┘
```

- 名称**独占一行**，可用宽度 = 卡片宽 − 图标列(40) − 内边距(28) = **282px @390**；
- 收益/代价**各占一行**，固定 34px 标签列，**不再左右分栏抢宽**；
- 字号下限：名称 19px、信息行 14px（不再为塞字缩到 12/13px）；
- caveat（满耐久等特例）挂在代价行右侧，放不下就**不画**（绝不压字）。

### 卡片高度

`uxOptionRects` 改为「先充分利用、再受上限约束、最后严格夹紧」：

| n | 卡片高 | 说明 |
|---|---|---|
| 2（事件二选一） | 128 | 三行有充裕行距 |
| 3（强化三选一） | 100 | 仍高于可读下限 |
| 4（极端） | 按空间收缩 gap→h，**严格不溢出** | 实测修掉一个真实溢出缺陷（旧算法会压到 y=778 > 744） |

> 那个溢出缺陷是 `adventureContinuityR1.test.ts` 里「选项卡全部落在叙事区内」这条断言抓到的
> —— 说明这条几何断言确实在守东西，不是形式主义。

### 实测（真实 `measureText`，非估算）

`_e2e_text_fit_r2.cjs` 在页面里用与绘制**同一字体栈**量全部 16 个选项：

| 项 | 名称宽/可用 | 收益宽/可用 | 结论 |
|---|---|---|---|
| 最长名称「用耐久换改装」 | 114 / 282 | — | ✅ |
| 最长收益「炮弹更重，撞击和后坐都更明显」 | — | **196 / 248** | ✅ |
| 其余全部 | ≤ 76 | ≤ 168 | ✅ |

**截断 0 项**（`clipped: 0`，见 `evidence/text-fit.json`）。

---

## 5. 必改 4：恢复 R1 越界的规则改动（**这是本轮的重点交付之一**）

| 项 | R1（越界） | R2（已恢复） | 证据 |
|---|---|---|---|
| 事件奖励池 | `RUN_GENERIC_CHOICE_POOL` + `twinCannon/tripleLoad/heavyShell/kineticBurst`（7 项） | **`[...RUN_GENERIC_CHOICE_POOL]`（3 项：damageUp/rateUp/emergencyRepair）** | `advScript.ts:166` |
| BUILD 排除项 | `['fastReload', 'tripleLoad']` | **`['fastReload']`（与 R1 之前一致）** | `advState.ts:123` |
| 事件候选过滤 | 额外套用 `ADV_EXCLUDED_BUILD_IDS` | **只按「是否已拥有」过滤**（R1 之前口径） | `advState.ts` `applyEffect` |

**未改**：抽取结构、候选顺序、发放数量、耐久取舍、任何战斗数值与物理。

### 恢复后暴露的独立问题 → 待决策 Bug（不暗改）

恢复原口径后，真实物理下的通关分布回到 **16 胜 / 8 败（24 个 scan 种子 ≈ 67%）**，
但结构性问题是：**事件只发 3 项通用强化，而第 6 场门槛敌与终点在 headless 下的实测需要
`twinCannon + kineticBurst`**（只靠通用池拿不到），一旦 BUILD 的 `layer2` 池因「需先有 layer1」
被跳过，成长链就断。

**这属于玩法/难度范畴，本轮按 Queue 要求：记录为待决策 Bug，绝不用改随机奖励来解决视觉验收。**

> 待决策 Bug 清单（交玩法轮次决定）：
> 1. 事件池仅 3 项是否足以支撑 7 场成长曲线（**建议**：要么扩池，要么下调门槛敌数值，要么保证 layer1 必出）。
> 2. `tripleLoad` 与 `twinCannon` 叠加的 DPS 崩塌（实测对**最弱敌**也必败；HEAD `49dc670` 可复现，既存缺陷）。
> 3. `layer2` 池需先拥有 `layer1` 主路线，BUILD 节点可能因池空被跳过（R3 起既有设计）。

---

## 6. 门控结果

| 门控 | 结果 | 说明 |
|---|---|---|
| `tsc --noEmit` | **0 错误** | |
| `adventureContinuityR1.test.ts` | **15/15** | 含「选项卡不越界」，抓到一个真实溢出缺陷并修掉 |
| `adventureCameraStabilityF6.test.ts` | **15/15** | 背景改动未破坏镜头平滑 |
| `adventureBattleViewAspect.test.ts` | **10/10** | F1 等比不变 |
| `run_adventure_seed.test.ts` | 14/14 | |
| `adventureTopDurability.test.ts` | 6/6 | |
| E2E `_e2e_adventure_battle_frame.cjs`（F1） | **11/11** | |
| E2E `_e2e_adventure_hp_bar.cjs`（F2） | **13/13** | |
| E2E `_e2e_adventure_build_feedback.cjs`（F3） | **15/15** | 见下「测试假设同步」 |
| E2E `_e2e_adventure_camera_f4.cjs`（F4） | **37/37** | |
| E2E `_e2e_adventure_camera_f6.cjs`（F6） | **12/12** | |
| E2E `_e2e_adventure_camera_diag_d2.cjs`（D2） | **13/13** | |
| E2E `_e2e_adventure.cjs`（R4 胜/败/复玩） | **23/23** | 败局种子按恢复后的规则重新标定 |
| E2E `_e2e_adventure_experience_review_r1.cjs` | **17/17** | |
| E2E `_e2e_adventure_continuity_r1.cjs` | 12/13 | 唯一失败是「scan-4 全胜」——**恢复原口径后的真实难度结果**，已在 §5 记为待决策 Bug |
| E2E `_e2e_coherence_r2.cjs`（新增，连续流程） | 通过 | 7 帧连续序列 + 0 截断 |
| E2E `_e2e_text_fit_r2.cjs`（新增，文字可读性） | **0 截断** | 真实 measureText |

### 测试假设同步（都是「规则恢复」的必然结果，不是功能退化）

- **F3**：`kineticBurst` 只由 layer2 供给、事件池已恢复 3 项 ⇒ 「驱动到 kineticBurst」在常规流程
  **不可达**。旧脚本里那两条断言改为**如实记录不可达**（不设恒真断言假装通过）；
  「双联炮 2 发」改为**条件断言**（只有本局真持有 twinCannon 时才要求），
  该能力的完整证明仍由 ① 段（专门驱动到 twinCannon）承担。
- **R4 败局种子**：`scan-1` 在恢复后的规则与 R4 策略下已能通关 ⇒ 重新用**与 R4 完全相同的选卡策略**
  标定 24 个种子（16 胜 / 8 败），选 `scan-21`（DAY 15、第 5 场被打穿）。

---

## 7. 证据（真实连续画面）

`evidence/seq-01..07-*.png` —— **同一局、正常速度、真实点击** 的连续 7 帧：

| 文件 | 阶段 | 说明 |
|---|---|---|
| `seq-01-event_choice.png` | EVENT_CHOICE | 事件二选一（新三行卡） |
| `seq-02-event_done.png` | EVENT_DONE | 自动承接（无需点击） |
| `seq-03-event.png` | EVENT | 敌情（同上场景） |
| `seq-04-battle.png` | BATTLE | 战斗（同一场景 + 地平线 330） |
| `seq-05-result.png` | RESULT | 战报（F6 沿用末帧取景） |
| `seq-06-choice.png` | CHOICE | 强化三选一 |
| `seq-07-failed.png` | FAILED | 终局（同场景常驻） |

配套读数：
- `sequence.json`：逐帧阶段/天数 + 计数器（主操作 9 次、选择 8 次、纯信息阶段等待 17 次、0 页面错误）+ 8 组卡片测量
- `sequence-audit.json`：逐帧地平线/亮度/车辆像素/对齐色差
- `text-fit.json`：16 个选项的真实 measureText 结果

复跑：

```bash
npm run build:portrait-lab
node tests/_e2e_coherence_r2.cjs          # 连续 7 帧 + 卡片测量
node tests/_e2e_text_fit_r2.cjs           # 文字 0 截断
python docs/adventure-ux-coherence-r2/_audit_sequence.py   # 同场景客观校验
node tests/_e2e_adventure.cjs             # R4 胜/败/复玩
```

---

## 8. 仍未解决 / 诚实披露

1. **RESULT 帧地平线比事件帧低 35px**：这是 F6「沿用末帧取景」的必然结果（为了消除切场缩放跳变）。
   本轮选择**保留 F6 正确性**，不为了画面对齐去破坏它。
2. **战斗帧车辆绿色像素 1884 < 非战斗 5472**：交战时相机拉近，车有一部分出框/被敌方遮挡。
   这是 F4 自适应的预期行为（放大交战主体），不是车消失。
3. **本轮只做客观像素/文本审计，没有真人的「好不好看」判断**。我能给出的是：
   同场景（地平线 326 一致、非战斗互相色差 0–3.5）、0 文字截断、非战斗 5472 个车体像素、
   亮度 92→116/126。**是否达到产品级观感，仍需 GPT 视觉预验收拍板。**
4. 待决策 Bug 3 条见 §5，本轮**未**通过任何方式绕过。
