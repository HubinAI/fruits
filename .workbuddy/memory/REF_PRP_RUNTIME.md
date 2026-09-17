# REF｜PRP Runtime 细节参考（MEMORY.md 的展开版）

> 本文件是 `MEMORY.md` 的**细节层**：记忆索引只留「不变量 + 陷阱 + 下一步」，具体字段 / 参数 /
> 实测换算放在这里。改动相关代码前读本文件对应小节；**每次交付后同步更新两处**。

---

## A. 正式战斗参数（PRP-F1）

- `runBattleRuntime.ts` / `runBattleView.ts`：在离屏 canvas 上**零修改复用**正式 `Renderer` + `drawImage` 合成。
- world **1600×900** / groundY **700** / spawnA `{400,640,1}` / spawnB `{1200,640,−1}`（中心距 800）/
  Cannon `cd 1000 · muzzle 8 · dmg 80 · R 10 · mass 1 · recoil 30`。
  **PRP 构造传空 config `{}`（零覆盖）** —— 任何数值差异都只来自 Run-local overlay。
- ⚠️ probe 坐标系**不对称**：`'idle'` 用绝对坐标；`'battle'` 用带内相对坐标（像素采样要 +`bands.stage.y`）。
- ⚠️ 车辆 sprite 特征色必须做**色族匹配**（tol 16）；菠萝没有 PNG → 由正式 Renderer 程序化绘制并与天空混合
  → 判据用**三色互斥**（西瓜 / 菠萝 / 香蕉交叉命中必须为 0）。
- 验证对手 = **`ProtoRusher`**（`R1-RUSH-02` 菠萝冲刺车，敌 HP 1000）；**演示三场全部用它**。
  ⚠️ **选型普查必须走生产同构链路**（漏掉 `RunBuildAbilities` 会低估压力）。

## B. 正式 Battle Camera（PRP-R5）——可感知性的第一约束

- 口径 = 逐帧 `reframe(snap,'battle',{phase})` → 私有 `battleCam` → `render()` 内逐帧 `applyBattleFollow`；
  节奏 `shouldReframeBattleCamera = phase !== lastPhase || phase === 'Active'`。
- `applyBattleFollow` = 取**双方 envelope** → `midX` 居中 + `offsetX` 0.2/帧平滑 + 世界左界 clamp（x=0 不露白）
  + `offsetY` 补偿使地面线恒定。
- ⚠️ **头号陷阱**：相机跟的是**双方中点** ⇒ **玩家与敌车的位移互相抵消**：
  「玩家被后坐推退」+「敌车冲刺前进」≈ 不变 ⇒ **屏幕位移 ≈ 0，哪怕世界位移很大**。
  ⇒ 任何「让玩家/敌方看起来在移动」的设计，**必须先算相机追平后的净量**，别拿世界 px 当判据。
- viewport adapter：离屏视口 = 舞台带 + inset×2 = **502×358** → 正式安全区**恰好等于**舞台带
  390×302（原点 56,28）。
- ⚠️ 视图层**绝不写** `this.renderer.transform =`（非 Active 的逐帧 reframe 会与 `applyBattleFollow` 拉扯）。
- ⚠️ 结束态（`result !== null`）**不再 reframe、不再重画离屏战场** → 保住「RESULT = 战场冻结」。
- ⚠️ **`Warning` 阶段相机按设计冻结**（只有 Active 逐帧 reframe），而车辆仍在运动 & 物理仍在推进
  → 任何「全程都要在带内」的断言必须**分阶段**写（Active 严格；其余阶段只允许贴墙的亚像素溢出）。
- **判定正式行为要查测试，别信注释**：正式相机口径唯一定义在 `tests/battleDynamicFramingR21.test.ts`。

## C. 强化接缝（F2 → BUILD-01 → BUILD-01-R1/R2/R3）

- **接缝 = Run-local overlay registry**（复用正式既有范式）：`createRegistry()` 造副本 → 注册 `run.mod.<id>`
  → 本局快照武器 `defId` 重映射。正式 `content.ts` / registry 单例 / `ContactRouter` / `Orchestrator` **零修改**。
- 两层 Build：改武器的项按选择顺序**浅合并** `behaviorParams`；能力类项**不改武器 def**
  （`affectsWeapon:false`、`behaviorParams:{}`、`runBuildDefId` 返回 null）。
  第二层条件池 `RUN_LAYER2_POOLS`（每层 3 选 1，由第一层决定）：
  `heavyShell → [kineticBurst, emergencyRepair, fastReload]`、`twinCannon → [tripleLoad, …]`、
  `fastReload → [heavyShell, twinCannon, emergencyRepair]`（**通用转向池，无专属联动**）。
- 第一层冻结值（**真人已通过，不得再调**）：重型弹头 `radius 16/mass 4/recoil 90`（damage 不动）/
  双联炮 `burstRounds 2/burstIntervalMs 100` / 快速装填 `cooldownMs 650`。
- 能力类接缝：`PlanckBattleOrchestrator.onCombatEvent`（公开订阅口）+ `WeaponFireEvent` / `DamageEvent`
  （正式既有；含 `worldDirection` / `worldPosition` / `relativeVelocity` / `damageSource` / `contactPoint`）
  + `world.applyLinearImpulse(body, impulse, point)`（`point` = **世界作用点**）。
- ⚠️ **冲量在步边界施加**：回调只入队 → `RunBattleRuntime.step()` 在 `orchestrator.step` **之前** `flush()`；
  `result` 非空时丢弃（保住「RESULT = 战场冻结」）⇒ 冲量落在**下一次** `rt.step`（`dvx` 要比 `next − base`）。
  **计数点必须放在 `flush()` 的真实施加处**（被 `isFinished` 丢弃的那批不计），与 `kineticHits` 同一纪律。
- ⚠️ `world.getLinearVelocity(body)` 在开火帧跃变 ≈ +0.02 → **看不到冲量；位置差分才可靠**。
  实测换算 `Δv ≈ 冲量 / 200`（世界 px/帧）⇒ 110 冲量 = 基础后坐 30 的 **3.67×**。
- **跨战斗耐久**：`PlanckVehicle.hp` 可写、`maxHp` 独立 → **只写 `hp`**。
  ⚠️ `initialPlayerHp` 必须是**构造时捕获的 readonly 字段**，不能是实时读 `vehicleA.hp` 的 getter。
- **关键缺口**：`FunctionalInstall` **只有 `star`、没有 `overrides`**（Movement 有）→ 将来「运行期改 Weapon
  任意字段」的最小 Foundation 补正 = 补 `overrides?: Partial<FunctionalPartDef>`。
- ⚠️ **胜负余量极窄 + 强混沌**（同一参数下末场残血非单调：60→506 / 80→582 / 100→614 / 110→554 / 120→622）
  → 只适合「方向可见」验证，**不适合数值微调对比**。
- 逐轮证伪出来的物理结论（R1 → R2 → R3 → R4）：
  1. **作用在质心 → 只产生平动 → 被相机追平**（世界 +20.7px → 带内 1~4px；R2 复现退 20~32px → 带内 3~5px）
     ⇒ 想被看见必须**换作用点或换通道**，不是加力。
  2. **扭矩是唯一相机追不平的通道，但重的玩家车几乎不转**：决定性实验 3000 冲量 → 一步 −4.56°；
     换算到 110~450 只有 **0~1.2°** ⇒ 玩家侧不能靠扭矩（轻的敌车可以，R1 动能爆发就是这么过的）。
  3. **改成「每 N 发蓄满一次」= 引入不可见状态 ⇒ 真人判失败**（R2 的 450 物理生效但读不出因果）
     ⇒ **自然因果优先于幅度**：一炮一后坐 ≫ 每 3 发一次强后坐。
  4. **自然因果也不够 —— 当对象是「重的自己」时，再怎么简化因果都读不出来**（R3 的 110 一炮一后坐
     仍然三版全败）⇒ **最终改判：换作用对象**（推敌车），而不是继续在玩家侧调数值 / 加 VFX。
- `kineticBurst`：命中点冲量 `KINETIC_BURST_GAIN = 28`；上界由**既有不变量**夹住
  （40/48 会真越界 417/402 + 单帧瞬转 116°；32/36 把第三场残血砸到 ≈8%）→ **不要再调**。
- `runImpactVfx.ts`：纯几何 / 无 DOM / 无时间源（node 可冻结断言）；触发 = `kineticHits` **计数增加**、
  位置 = `lastKineticHit`（与冲量作用点**同源**）。⚠️ `impactMark` **过期即清空**；
  绘制在 `blit` 之后、**分带线之前** + `clip` 到舞台带 → 不污染入账面积。

## D. PRP-RUN-R1 三场连锁

- `finishRunBattle` 先算 `battlesCompleted` 再判 `playerHp <= 0` → 直接 `FAILED`（**不经过 RESULT**）；
  `FAILED` 下 `pressRunAction` 唯一动作 = `createRunPageState()`；`runCarriedPlayerHp` 在「上一场已结束」时
  **恒返回一个数**（死亡 → 0，绝不伪装成满耐久）。`runPhase` 6 值；`runStartsNewRun()` 是
  「继续当前 Run」vs「重新开始」的唯一判据。
- ⚠️ 两条「测量口径失效」教训（换对手时暴露）：①「后坐让车身净后移」只在重型对手下成立
  → 改**质量无关**的「开火帧位移凹陷」；②「整场最负 vx」量到的是**接触推挤**（最负值落在非开火帧）。

## E. PRP-BUILD-01 收口：快速装填专属二层（**已废弃，不要再试**）

- **状态 = 当前设计假设已否决**，不是「待后续优化」。
  将来若重新设计，**作为新的内容假设处理**，不要在这三条上继续加力。
- 失败记录（真人多轮验收，逐版都比上一版更简单）：

  | 版本 | 机制 | 被判失败的原因 |
  |---|---|---|
  | R2-1 | `反冲蓄能` **前向接敌补偿** | 与「快速装填」语义矛盾，读不出关联 |
  | R2-2 | **3 发蓄能**后强后坐（450） | 多了一层**玩家看不见的累计状态**（看不到「2/3」） |
  | R3 | **每炮**强后坐（110） | 因果已最简，但对象是**重的玩家自己**，且相机追平 |
  | R4 | `压制射击` **推敌车**（300） | 换了作用对象仍不够可感知 |

- **跨 R2~R4 证伪出来的物理结论**（换任何「让玩家自车后退」的设计前先读这里）：
  1. **作用在质心 → 纯平动 → 被相机追平**（世界 +20.7px → 屏幕 4px；R2 复现 20~32px → 带内 3~5px）
     ⇒ 想被看见必须**换作用点或换通道**，不是加力。
  2. **扭矩是唯一相机追不平的通道，但重的玩家车几乎不转**：3000 冲量 → 一步 −4.56°；
     换算到 110~450 只有 **0~1.2°**（轻的敌车可以 —— R1 动能爆发就是这么过的）。
  3. **「每 N 发蓄满一次」= 引入不可见状态 ⇒ 必判失败** ⇒ **自然因果优先于幅度**。
  4. **自然因果也不够 —— 当对象是「重的自己」时，再怎么简化因果都读不出来**
     （R3 的一炮一后坐仍然三版全败）⇒ 最终只能**换作用对象**。
  5. **换成推敌车也只是「好一档」，不是解决**：相机同样跟随敌车 ⇒ 屏幕位移仍 ≈
     世界位移一半 × 舞台缩放（中位 35 世界 px ≈ 8~10 舞台 px）。**真人仍判失败。**
- **删除清单**（`PRP-BUILD-01-CLOSEOUT-AND-FREEZE`，无兼容分支、无死代码）：
  id `recoilCharge` / `strongRecoil` / `suppressionShot`；常量 `RECOIL_CHARGE_THRESHOLD` /
  `RECOIL_CHARGE_IMPULSE` / `STRONG_RECOIL_IMPULSE` / `SUPPRESSION_SHOT_IMPULSE`；
  字段 `charge` / `chargesSpent` / `chargeThreshold` / `recoilKicks` / `lastRecoilImpulse` /
  `strongRecoil` / `suppressionShot` / `suppressionHits` / `lastSuppressionImpulse`；
  开火点 `lastFireX/lastFireY`；图标分支 + 颜色键 `iconRecoil`/`iconSuppress`；
  E2E 采样键 `buffIconSuppress`/`iconSuppress`。**正式 Cannon 自带 recoil 原样未动。**
- ⚠️ **清理时最容易误删的「共享接缝」**（它们同时服务动能爆发，**必须保留**）：
  `weaponFire` 方向记录（`lastFireDirX/Y` + `hasFireDir`）、`damage` 命中入口条件
  （`damageSource==='weapon' && source==='A' && target==='B' && behavior==='cannon'`）、
  `RunAbilityPorts` 五端口（`subscribe` / `isFinished` / `facingOf` / `projectileMass` / `applyImpulse`）、
  `flush()` 的**步边界施加**纪律。
- ⚠️ 测试侧同样要区分：**专属**用例删掉，但**共享接缝**用例改为驱动 `kineticBurst`
  （合成事件注入四条禁止路径 / Reset 无残留），**不是一起删**。
- 冻结字面量（`tests/portraitRunPage.test.ts` RP-F2-14，三条路线的三场残血）：
  `heavyShell+kineticBurst = [843, 714, 430]` · `twinCannon+tripleLoad = [843, 678, 470]` ·
  `fastReload+twinCannon = [843, 622, 546]`。

## F. PRP-RUN-02 整局竖切：脚本 / 状态机 / 事件（运行时细节）

### F.1 固定脚本（`runScript.ts`）

| 节点 | kind | DAY | Encounter（Lab 引用 → 正式模板） |
|---|---|---|---|
| `d1-start` | EVENT | 1 | — |
| `d2-battle1` | BATTLE | 2 | `PineappleFireBrute` → OPP-29 |
| `d2-choice1` | CHOICE | 2 | 第一层固定三选一 |
| `d3-battle2` | BATTLE | 3 | `PineappleSawRusher` → OPP-31 |
| `d4-durability` | DURABILITY | 4 | 维修 / 继续改装（`branch`） |
| `d5-tend` \| `d5-choice2` | EVENT \| CHOICE | 5 | 互斥分支（维修 → EVENT / 改装 → 第二层池） |
| `d6-battle3` | BATTLE | 6 | `ProtoRusher` → R1-RUSH-02 |
| `d7-final` | FINAL | 7 | `BananaRodLaser` → OPP-20（`next: null`） |

派生常量：`RUN_FIRST_DAY=1` / `RUN_TOTAL_DAYS=7` / `RUN_TOTAL_BATTLES=4` / `RUN_TOTAL_CHOICES=2`。
查询：`runScriptNode`（未知 → `null`）/ `requireRunScriptNode`（未知 → **抛错**）/
`runScriptBattleNodes` / `runScriptKindSequence` / `runDurabilityBranchNodeId`。
`RUN_DURABILITY_EVENT` 携带标题 / 两个动作 / 两句分支叙事（**文案的唯一来源**）。

### F.2 状态机（`runPageState.ts`）关键口径

- 八态：`IDLE | EVENT | BATTLE | RESULT | CHOICE | DURABILITY | COMPLETE | FAILED`。
- `nodeId` = 唯一进度锚点；`battle` 记录里 `playerHp` 是**本场开局耐久**的权威值。
- 新局（`createRunPageState`）**不走 `goPhase`** ⇒ `phaseTrail=[phase]` / `transitions=0` / `revision=0`。
  初始日志 = `DAY 1` + `d1-start.beat`（**3 行**）。
- 每条日志行数（实测，E2E 冻结）：fresh 3 → `d2-battle1` IDLE 5 → EVENT 7 → RESULT 10 →
  CHOICE 10 → 选完 13 → … → `COMPLETE` **38**。
- **carry 语义**：`carriedHp` 只写 `hp`，不动 `maxHp`；`carried=0` 被忽略（画面上不会开出 0 血）；
  `runCarriedPlayerHp` = `min(maxHp, max(0, playerHp) + max(0, repairBonus))`，**窗口见 §5.6 警告**。
- 终局：`FINAL` 节点打完 → `COMPLETE`（4 行收束）；`playerHp <= 0` → `FAILED`（2 行，不经过 RESULT）。
  两个终态下唯一动作 = 重新开始（`RUN_RESTART_LABEL`）/ 完成（`RUN_COMPLETE_LABEL='完成本次冒险'`）。

### F.3 浮层（CHOICE 与 DURABILITY 共用）

- 卡片几何 = `runChoiceCardRects(卡片数)`（**2 张也成立**：整体居中）；图标盒 = `runChoiceIconRect`；
  卡面/描边**不入面积账本**，只有顶部强调条入账：`cardBar = 卡片数 × 1240`
  （⇒ 掩码账本必须带**卡片数**，不能只传布尔）。
- `drawOverlay` 是唯一绘制入口；标题走 **`overlayTitleNow()`**
  （种子浮层 → 「带走一项改装」/ DURABILITY → `runDurabilityTitle()` = 「停下来，还是继续改装？」/
  CHOICE → 「选择一项改装」）。
  ⚠️ PRP-M2 起**不存在** `overlayTitle(state)` 这类直读 state 的版本 —— 见 §G 的「Now 访问器」。
- 图标色（8 个，两两互斥）：`heavyShell #ffb066` / `twinCannon #ffd166` / `fastReload #7fd6a0` /
  `kineticBurst #c98cf0` / `tripleLoad #79c0ea` / `emergencyRepair #5fd0c0` /
  `repair #e07a9a`（扳手）/ `upgrade #a8b45c`（齿轮）。
- 主动作标签：`做个决定`（DURABILITY）/ `完成本次冒险`（COMPLETE）/ `重新开始冒险`（两终态）。

### F.4 探针新增字段（E2E 依赖）

- `nodeId` / `nodeKind` / `encounterId` / `battleTotal` / `complete` / `failed`；
- `durabilityOpen` / `durabilityChosen` / `overlayOpen` / `overlayTitle` / `overlayOptions[]`（含 `rect` + `iconRect`）；
- `battleWorld.playerProjectiles`（**只数玩家 A 方**；`projectiles` 是全场口径）。
- **已删**的旧口径：`verificationComplete`（终局判据改由 `complete` / `failed` / `nodeId` 回答）。
  `choiceOptions`（含 `rect` / `iconRect`）**保留** = CHOICE 候选池口径。

## G. PRP-M2 下一局种子验证（独立入口，运行时细节）

### G.1 入口 / 选项

- **页面**：`next-run.html`（独立 html）+ `src/lab/portraitBattleLab/nextRunMain.ts`；
  构建在 `vite.portrait-lab.config.ts` 的第三个 input（`'next-run': 'next-run.html'`）。
- **命令**：`npm run dev:next-run`（`vite --open=/next-run.html`）/ `npm run e2e:next-run`。
  ⚠️ `npm run dev` **一个字节都没变**（根路径仍只重写到玩家页面；`branchDevEntry.ts` 不含 `next-run`）。
- **构造项**（`RunPageOptions`，全部可选；不传 = RUN-02 默认完整 Run）：
  `priorRun`（起点状态）/ `seedOptions`（非空 = 开启验证流程）/ `stopAfterFirstBattle`。
- **三个种子**（`NEXT_RUN_SEEDS`，顺序 = 第一层既有顺序）：`heavyShell` 重炮开局 /
  `twinCannon` 双联开局 / `fastReload` 快装开局。种子**不复用第二层**、不新增奖励。

### G.2 流程与状态机接线

- `RUN COMPLETE` 时先点唯一主动作 → **打开种子浮层**（不是开默认新局）；
  选中 → `createSeededNewRun(ctx, id)` → **全新状态对象**（旧战场运行时先 `endBattle()` 释放）。
- 新 Run 第一场由宿主在 **EVENT 那一刻**取 `runCarriedPlayerHp`（新局 → `null` → 满耐久）。
- 第一场结束（`battlesCompleted >= 1`）→ `validationDone = true` → 主动作不可用 + 文案
  `下一局验证完成`；`onPointerDown` 在 `validationDone` 时**直接 return**。
- ⚠️ 验证判定**不要求赢**：`RESULT` 与 `FAILED` 都算「第一场结束」。

### G.3 「Now 访问器」纪律（本轮最大陷阱）

页面渲染 / 命中 / 探针 / 账本**四处必须读同一个本帧口径**：

| 访问器 | 语义 |
|---|---|
| `overlayOpenNow()` / `overlayCardsNow()` / `overlayTitleNow()` | 种子浮层优先，其次 state 的 CHOICE / DURABILITY |
| `actionEnabledNow()` / `actionLabelNow()` | 验证停止态强制「不可用 + 终点文案」，否则 = 既有口径 |

- ⚠️ `runOverlayCards(` 在 `runPage.ts` 里**只允许有一个调用点**（在 `overlayCardsNow()` 内部）；
  绘制 / 命中 / 探针三处都必须经 `overlayCardsNow()`（`RP-RUN-02-05` 守卫机器钉死）。
- ⚠️ `layeredShapes()`：种子浮层时**只**返回 `cardBar`（整页遮罩 ⇒ 底层几何不带精确色）；
  验证停止态过滤 `actionBar`（按钮真的不可用 ⇒ 强调条不在画面上）。
- 种子浮层**复用 CHOICE 卡片几何**（`runChoiceCardRects` / `runChoiceIconRect` / `runChoiceBarRect`），
  `cardBar` 面积恒 `3 × 1240`；图标复用既有第一层矢量图标（不新增图标）。

### G.4 探针新增字段（E2E 依赖）

`nextRunValidation` / `seedSelectOpen` / `seedOptions[]`（`id` `title` `note` `rect` `iconRect`）/
`seedChosen` / `priorRun`（摘要：`nodeId` `day` `battlesCompleted` `build` `durabilityPercent` `complete`）/
`validationComplete`。

### G.5 三个种子的第一场实测结局（真机四视口，真实物理）

| seed | 结局 | 剩余耐久 | 步数 |
|---|---|---|---|
| heavyShell | RESULT | **13 / 1100** | 1018 |
| twinCannon | RESULT | **1009 / 1100** | 727 |
| fastReload | RESULT | **919 / 1100** | 710 |

⚠️ **重炮开局几乎濒死**（1.2%），战斗也更长 ⇒ 「三个种子难度不等价」是本轮待裁决项。
**禁止**改第一层数值（已冻结）。另：`heavyShell` 的 `recoil 90`（基础 30）是首要怀疑对象。

## H. PRP-M3 遭遇验证台（独立入口 `encounter-lab.html`，运行时细节）

Content Batch：**只换对手，不换车、不换战场、不调数值**。

### H.1 固定批次（唯一来源 `encounterValidation.ts`）

`ENCOUNTER_BATCH_IDS = ['ProtoRusher', 'Chaser', 'RangedTurret']`；label / 正式模板 id /
count **一律从 `testData.LAB_ENCOUNTERS` 读现成的条目**（不复制中文名、不新写 id）。

| id | 正式模板 | 车身 | HP | drive | 验证目标 |
|---|---|---|---|---|---|
| `ProtoRusher` | `R1-RUSH-02` | `pineappleBody` | 1000 | forward | 快速接敌 / 近身压力 |
| `Chaser` | `OPP-16` | `bananaBody` | 900 | forward | 持续追击 / 重型接触压力 |
| `RangedTurret` | `OPP-03` | `watermelonBody` | 1100 | **stationary** | 远程输出 / 接近压力 |

玩家恒为 `ENCOUNTER_LAB_LOADOUT_ID = RUN_DEMO_LOADOUT_ID`（= `WatermelonHeavyCannon`）。

### H.2 一场战斗的建立（与 Run Page 同一条正式链路）

`new RunBattleRuntime({ encounterId })` —— **不传 build / 不传 carriedHp** ⇒ 空 Build（无 Run
Buff）+ 满耐久 + 正式 spawn。三套共用：world 1600×900 / groundY 700 / spawn 400·1200 / sep 800 /
`playerHpMax 1100`。**窗口变化时只换 `encounterId`**，其余一个字不改。

### H.3 ⚠️ 清理语义的真相（本项目最容易写错的一条）

`PlanckBattleOrchestrator.dispose()` = **只丢弃引用**（`PlanckWorld` 无显式销毁）⇒
被释放的实例在内存里**仍然可以被继续 `step`**（实测：dispose 后再 step，240 → 241 步）。
因此「切换前一场必须完全 cleanup」**不靠对象变惰性**，靠**宿主生命周期**：
`select()` 必须 `disposeRuntime()`（内部 `runtime.dispose()` + `runtime = null`）→ `new RunBattleRuntime(...)`；
循环 `tick` 在 `this.runtime === null` 时立刻 `rafHandle = 0` 退出。
E2E 判据 = **新实例的开局读数干净**（不是「旧实例不动了」）。

### H.4 开局读数（残留判据的口径）

在**任何物理推进之前**采集并固化（RAF 一启动就前进，页面上抓不到第二遍）：
`steps 0 · timeMs 0 · projectiles 0 · contact/impact/damage 全 false · buildIds [] ·
initialPlayerHp == playerHpMax · spawnAx 400 / spawnBx 1200 / sep 800 · gapWorld > 0`。
`contact/impact/damage` 来自新增的只读 `RunBattleRuntime.contactResidue()`
（= 正式 `ContactRouter.debug` 的三条 last* 是否非空）。

### H.5 三套 Encounter 的实测结局（真机四视口，真实物理，同一玩家满耐久）

| Encounter | 步数 | 时长 | 玩家耐久 | 敌耐久 | winner |
|---|---|---|---|---|---|
| `ProtoRusher` | 835 | 14.0s | **843 / 1100** | 0 / 1000 | A |
| `Chaser` | 933 | 15.5s | **228 / 1100** | 0 / 900 | A |
| `RangedTurret` | 481 | 8.0s | **0 / 1100** | 619 / 1100 | B |

三条过程完全不同 ⇒ 三个敌人确实提出了三个不同的问题。
⚠️ `RangedTurret` 打死玩家 = **既有平衡事实**（历史已记「对基础 Build 必杀」）；
本 Queue **不做平衡**、**不改数值** —— 若将来要动，那是**新的设计假设**，单开 Queue。

### H.6 探针（E2E 依赖）

`window.__ENCOUNTERLAB__.probe()` → `title` / `lead` / `loadoutId` / `playerLabel` /
`playerHpMax` / `batch[]` / `controls[]` / `active` / `phase`（`idle|running|done`）/
`runtimeActive` / `runtimeSerial` / `disposedCount` / `resetCount` / `fresh` / `live` /
`rounds[]` / `screen` / `camera` / `canvas` / `assets`。
E2E 端口 **8158**（run-page 8156 / next-run 8157）。
