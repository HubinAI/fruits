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

## I. PRP-VALIDATION-HUB-R1 验证中心（独立入口 `validation-hub.html`）

### I.1 三个入口（唯一数据源 = `validationHub.ts` 的 `VALIDATION_HUB_ENTRIES`）

| 顺序 | id | label | 页面 | 对应 Queue | 后备命令 |
|---|---|---|---|---|---|
| 1 | `fullRun` | Full Run | `run-page.html` | `PRP-RUN-02-FULL-RUN-VERTICAL-SLICE` | `npm run dev:run-page` |
| 2 | `nextRun` | Next Run | `next-run.html` | `PRP-M2-NEXT-RUN-SEED-VALIDATION` | `npm run dev:next-run` |
| 3 | `encounterBatch` | Encounter Batch | `encounter-lab.html` | `PRP-M3-ENCOUNTER-BATCH-01` | `npm run dev:encounter-lab` |

⚠️ `fullRun` 指向的 `run-page.html` **就是玩家正式页面本身**（= `build/branchDevEntry.ts` 的
`BRANCH_DEFAULT_DEV_ENTRY`，即根路径重写的目标文件）。Hub **不复制、不包裹、不改写**它，
也不给它注入任何控件；三个入口页面对本 Queue **零改动**。

### I.2 切换 = 整页导航（有意选择，不是做不到）

- 卡片是**真实 `<a href="./<page>">`**：点击 = 浏览器加载那个入口页面**本身**（可中键 / 可复制链接）。
- 旧文档随之销毁 ⇒ 上一项的 `RunBattleRuntime` / 弹丸 / 接触记录 / RAF / resize 监听器 /
  Run-local state 一起消失。实测（E2E V18–V24）：先真的打一场（`serial=1`、`steps>0`、`contact=true`），
  切走再切回后 `fresh === null`、`runtimeActive === false`、`runtimeSerial === 0`、
  `disposedCount === 0`、`rounds.length === 0`、画布 **1** 块；点一次只建一个运行时（`serial` 严格 +1）。
- **不做**「在 Hub 里 `new RunPage(...)` 再切控制器」：① Full Run 就不再等于玩家页面（丢保真度）；
  ② 要复制一套宿主逻辑（两套口径）；③ `RunPage` / `EncounterLab` 虽有 `dispose()`，但文档销毁
  是**更强**的清理保证（宿主忘不掉）。
- **代价**：入口页面里**没有**「返回验证中心」按钮 —— 加它就要改正式玩家页面
  ⇒ 返回 = 浏览器后退（`Alt + ←`，Hub 页脚写明）。

### I.3 「上次进入」标记

`sessionStorage['prp-validation-hub:last-entry']`，**只指路不判定**（只认表内 id；非法 / 残留值
当「没来过」；storage 被禁用或抛异常一律静默退化）。⚠️ 必须在 **`pageshow`** 里重读：
后退可能触发 bfcache 恢复（脚本不重跑），只在 boot 读一次会永远停在旧值。

### I.4 探针（E2E 依赖）

`window.__VALIDATIONHUB__.probe()` → `title` / `lead` /
`entries[]`（`id` / `label` / `zhLabel` / `queueId` / `verifies` / `href` / `pageFile` / `command`）/
`lastEntry` / `nextEntry` / `cardCount` / `canvasCount`（**恒 0**）。
E2E 端口 **8159**（run-page 8156 / next-run 8157 / encounter-lab 8158）。

### I.5 Hub 是纯导航（产物实测）

`assets/validation-hub-*.js` 约 **3.4KB**，0 处 `planck` / `PlanckBattleOrchestrator` /
`contactRouter` / `damageResolver` / `playerGameRuntime` / `canvasPlayerUIHost` /
`webDomPlayerUIHost` / `renderer` / `visualRegistry` 符号；Hub 只加载自己的 chunk
（+ Vite 的 `modulepreload-polyfill`），**不捎带任何战斗 chunk**（E2E I3/I4）。

---

## J. PRP-RUN-02-R1 维修分支修正（脚本数据接线，运行时细节）

### J.1 缺陷与根因（file:line）

真人完整 Run 录像：`DAY 4` 选「维修」→ `DAY 5` **只有叙事** → `DAY 6` Battle →
`DAY 7` Final ⇒ 整局只有 1 个 Buff。

根因**不在状态机**，在**脚本数据**：

| 位置 | 修前 | 修后 |
|---|---|---|
| `runScript.ts` `d4-durability.branch` | `{ repair: 'd5-tend', upgrade: 'd5-choice2' }` | **不变** |
| `runScript.ts` `d5-tend.next` | `'d6-battle3'` ← **缺陷** | `'d5-choice2'` |

`runPageState.ts` 的 `resolveDurability` 与 `chooseRunBuff` **都是纯 `next` 驱动、
零分支特判**（`presentNode(advanced, node.branch[choice], ctx)` / `node.next`）
⇒ 修正 = **一行数据改动**，两分支在 `d5-choice2` 汇合。

### J.2 修正后图结构

```
d4-durability ─┬─ repair  → d5-tend(EVENT · DAY 5 叙事) ──next──┐
               └─ upgrade → d5-choice2(CHOICE · DAY 5) ←────────┴─ 汇合
```

节点数 **9**（`d1`…`d7`, 含 `d5-tend`）。**唯一分支节点 = `d4-durability`**，
两条 `branch` 指向不同节点；`next` 链**互不重复**（汇合改由 `branch` 提供）。

> ⚠️ 修前 `next` 目标集合 size = 长度 − 1（图里有一个汇合点）；
> 修后断言必须改为 `size === targets.length` —— **这是收紧守卫，不是放宽**。

### J.3 两条分支修后唯一差别 = 耐久

维修分支不再「少一个 Buff」——它在 `d5-choice2` 拿到与「继续改装」**同一份**第二层。
⇒ 机会成本被降为**只有那一段耐久**（实测重炮路线约 275 点）。
**待裁决**：若 Queue 原意是「继续改装额外多拿一次强化」，须**新增节点** ⇒
违反「不增加新事件／冻结两层结构」⇒ **单开 Queue，禁止顺手改**。

### J.4 四条真实物理路线重测（Node 端确定性，口径 = 显式实测更新）

| 第一层 + 第二层 | ① ② ③ ④ 终局耐久 | ③ ④ 开局耐久 |
|---|---|---|
| `heavyShell+kineticBurst` | 919 / 688 / 678 / 472 | 963 / 953 |
| `twinCannon+tripleLoad` | 919 / 907 / 891 / 602 | 1100 / 1084 |
| `fastReload+twinCannon` | 919 / 908 / 1023 / 778 | 1100 / 1100 |

修前 ③④ 为 `834/618` · `935/618` · `879/590` —— **两值全变**（维修分支现在多打两场，
且这两场带上两层）。三条路线**全部 COMPLETE**（无 FAILED）。
`FROZEN_REPAIR` 是 `tests/portraitRunPage.test.ts` 里的冻结表，改接线**必须同步重测**。

### J.5 门禁实测（本轮）

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错 |
| `tests/portraitRunPage.test.ts` | **63/63 PASS**（10.84s） |
| 全量 vitest | **206 文件 / 2015 用例 PASS** |
| `_e2e_run_page.cjs` | **485/485 PASS** |
| 其余五条 E2E | 47/47 · 47/47 · 148/148 · 42/42 · 79/79 |
| 冻结区 `git diff --stat -- src/{core,physics,render,player,platform,battle,ui,game}` | **空** |

### J.6 RP-F2-02 的 timeout（不是产品缺陷）

一条用例跑 **6 条真实物理路线**（2 分支 × 3 路线 = 24 场），实测 **7.2s** > vitest 默认 5s。
⇒ 显式 `}, 60000);`（与 `tests/portraitBattleLabA1.test.ts` 同口径）。
**先确认不是并发污染**（本项目 vitest 必须独占机器，并发时无关文件也会报 5s 超时）。

### J.7 E2E 新增段落的 page 归属纪律

`_e2e_run_page.cjs` 的 `runViewport` 里的 `page` 会被后续 14 段（开火节奏）继续消费。
**中途推进它 ⇒ 后续段用过期 rect 点击 ⇒ 90s `waitForFunction` 超时假红**。
本轮 12b 段（维修分支）用 `browser.newContext()` 另开 `rpage`，段尾 `await rctx.close();`。
⇒ 规则：E2E 里**重活一律独立 context/page**，不要借用序贯段落的主 `page`。

### J.8 账本口径（本轮两处）

- 卡片**强调条**在卡片顶部（`runChoiceBarRect`）、正文在 `card.y + 72`
  ⇒ 改卡片 `note` 文案**不影响** `cardBar` 账面。
- 浮层整页遮罩判据 = `ledgerExpect({ masked: N })`，`N` 是**卡片数**不是系数
  （三张卡 ⇒ `masked: 3`），与既有 `R35` / `R52f` 同口径。
  ⚠️ R2 之后 E2E 里的旧 `R52f` = 现在的 **`R52j`**（R52 家族的重编号见 §K.6）。

---

## K. PRP-RUN-02-R2 让「维修 vs 继续改装」成为真实取舍（脚本数据 + 池种类声明）

### K.1 缺陷（真人验收，file:line 口径）

`PRP-RUN-02-R1` 修正后两条分支**都**到达 `d5-choice2`（DAY 5 第二层）⇒ 当时
`src/lab/portraitBattleLab/runScript.ts` 的 `d4-durability.branch = { repair: 'd5-tend',
upgrade: 'd5-choice2' }` 意味着：

| 分支 | 耐久 | 第二层 | 净结果 |
|---|---|---|---|
| repair | +275（按缺口截断） | 有 | 严格占优 |
| upgrade | 不回 | 同一个 | **没有任何独有回报** |

⇒ 「维修**严格支配**继续改装」，DAY 4 的取舍不是取舍。**根因不是数值**，是
upgrade 分支在结构上**没有换到任何东西**。

### K.2 设计定稿：池的**种类**由 CHOICE 节点声明（不是按次数数数）

修正前的 `runChoicePool` 按 `s.buffs.length` 数数（0 → 一层 / 1 → 二层 / ≥2 → 空）。
一旦加进「横向改装」这一选（`buffs.length === 1` 时发生），它会**必然**被误判成第二层。

⇒ 唯一与项目哲学（节点驱动、零散落分支、禁 `if (day === X)`）一致的修法：
**节点声明池种类**。

- `runScript.ts`：`export type RunChoicePoolKind = 'layer1' | 'lateral' | 'layer2'`；
  `RunScriptNode.choicePool?: RunChoicePoolKind`（`d2-choice1 = 'layer1'`、
  `d4-lateral = 'lateral'`、`d5-choice2 = 'layer2'`）。
- `runPageState.ts`：`runChoicePoolKind(s)` 读当前节点的声明（非 CHOICE → `null`）；
  `runChoicePoolLayer(s)` = `kind === 'layer2' ? 2 : 1`（横向是**一层内容** ⇒ 1）。
- `runPage.ts` 探针：`choicePoolLayer` 由 `s.buffs.length + 1` 改为读上面的函数，
  并新增 `choicePoolKind`（数据层原值，E2E 直接断言「这里是横向，不是第二层」）。
- ⇒ `runPageState.ts` 的**推进逻辑仍然零分支特判**：它不知道「现在第几选」，只知道
  「当前节点要哪一种池」。

### K.3 图结构（十节点）

```
d1-start(1) → d2-battle1(2) → d2-choice1(2 · layer1) → d3-battle2(3)
  → d4-durability(4) ─┬─ repair  → d5-tend(EVENT · DAY5) ────────┐
                      └─ upgrade → d4-lateral(CHOICE · DAY4 横向) ┴→ d5-choice2(5 · layer2)
  → d6-battle3(6) → d7-final(7) → RUN COMPLETE / FAILED
```

- ⚠️ **`d4-lateral` 与 `d4-durability` 同为 DAY 4**：`presentNode` 只在 `node.day !== s.day`
  时追加 `DAY n` 行 ⇒ 进入 `d4-lateral` **不会**多出一行 `DAY 4`（实测日志：`DAY 4` 一次，
  紧跟耐久事件行、横向节点 beat、横向选项行，然后才是 `DAY 5`）。
- 唯一汇合点仍是 `d5-choice2`，恰好两个前驱 `[d4-lateral, d5-tend]`。
- ⚠️ `RUN_TOTAL_CHOICES` = CHOICE 节点数 = **3**；但**单条分支拿不满**：
  维修分支 2 项、改装分支 3 项 —— 这就是「构筑数量优势」的结构口径。

### K.4 横向池（必改 1 的逐字落地）

`runModifiers.ts` 新增：`isLayer1Modifier(id)` / `runLayer1PoolDefs()` /
`runLateralPoolDefs(owned)` = `RUN_LAYER1_POOL` 减去 `owned`（`owned` 传**全部** Build id）。

- 当前 `twinCannon` → 候选 `['heavyShell', 'fastReload']`（二选一）；
- **不提供** `emergencyRepair`（它属第二层，不在一层池里）；
- **不重复**已拥有的一层；
- ⇒ **不新增任何 Buff / 数值**（必改 1）。`RUN_LAYER2_POOLS` 一字未动（必改 2）。

### K.5 全池统一去重（验收 4「无重复 Modifier」）与其代价

`runChoicePool` 的三种池都 `dedupeOwned(defs, runBuildIds(s))`。副作用（**已接受，须上报**）：

- 改装分支**先横拿**的那一项若落在第二层条件池里，第二层池会**自动少一项**
  （例：双联路线横拿 `heavyShell` ⇒ 二层池 3 → 2 项）；
- 本轮 E2E 主走查刻意横拿 `fastReload`（不落在双联的二层池里）⇒ 保持 **3 张卡**，
  于是「第二次池 = 三项条件池」这条 R1 证据得以原样保留；去重本身由
  `RP-F2-07`（池 = 声明池 − 已拥有）与 `R52i`（池里不含已拥有项）显式断言。

### K.6 E2E 重编号（`tests/_e2e_run_page.cjs` 11c 段）

R52 家族由「直接到第二层」改为「横向 → 第二层」两步：

| 新标 | 内容 |
|---|---|
| `R52` | 点「继续改装」→ `d4-lateral`（DAY 4 · `choicePoolKind === 'lateral'`） |
| `R52b` | 横向候选 = 另外两个一层（`['heavyShell','fastReload']`），不含 `emergencyRepair`、不含已拥有 |
| `R52c` | 不回耐久（与第二场结束逐字节相同）+ 横向项尚未进 Build（`buffs.length === 1`） |
| `R52d`/`R52e` | 横向浮层 **2 张卡**账本 + 卡片图标（复用同一套几何，**零 UI 改动** = 必改 4） |
| `R52f`/`R52g` | 横向之后照样进入 `d5-choice2`（DAY 5 · `layer2`）+ 池由最初主路线决定 |
| `R52h`/`R52i` | 双联条件池三项 + 池不含任何已拥有 Modifier |
| `R52j`/`R52k` | 第二层浮层 **3 张卡**账本 + 图标（= 旧 `R52f`/`R52g`） |
| `R58h`（新增） | 浏览器终局耐久与 Node 实测表**逐值相等**（357 = 32%） |

下游按三层 Build 改写：`R53` / `R53b` / `R53c`（`chip = 144 × 3 = 432`）/ `R54b` /
`R56b` / `R56c` / `R57c` / `R58c`（`logCount` 38 → **40**）/ `R58d` / `R58f` /
`R58g`（轨迹多一个 `CHOICE`，21 项：`…DURABILITY→CHOICE→CHOICE→IDLE…`）。
**12b 段（维修分支）零改动** —— 它本就不经 `d4-lateral`（`R64b` 落在 `d5-tend` 即证据）。

### K.7 显式实测重测（口径 = 实测更新，不是就地重算）

维修分支（`FROZEN_REPAIR`，**逐值不变** = 必改 3「恢复值完全不动」的机器证据）：

| 路线 | ① ② ③ ④ | 终局 |
|---|---|---|
| heavyShell+kineticBurst | 919 / 688 / 678 / 472 | COMPLETE |
| twinCannon+tripleLoad | 919 / 907 / 891 / 602 | COMPLETE |
| fastReload+twinCannon | 919 / 908 / 1023 / 778 | COMPLETE |

改装分支（`FROZEN_UPGRADE`，横向池第一项：重炮→双联 · 双联→重弹 · 快装→重弹）：

| 路线 | ① ② ③ ④ | 终局 |
|---|---|---|
| heavyShell+kineticBurst | 919 / 688 / **489 / 167** | COMPLETE（R1 时代此路线是 FAILED） |
| twinCannon+tripleLoad | 919 / 907 / **907 / 0** | **FAILED** |
| fastReload+twinCannon | 919 / 908 / **170 / 0** | **FAILED** |

E2E 主走查组合（`FROZEN_UPGRADE_E2E`，双联 + 横向**快装** + 三连装填）
= `[919, 907, 839, 357]`，整局日志 **40** 行；浏览器实测 `357.43`（32%）⇒ 与 Node 一致。

⚠️ **判据迁移**：R1 用「重炮路线：维修完成 / 改装失败」演示「耐久决定结局」；
R2 给改装补了一项后该路线**活着**（167 = 15%）⇒ 这个对照改由**双联路线**承担
（维修 602 完成 / 改装归零 FAILED）。判据强度不变，只是换了路线。

### K.8 M2 脚手架的连带修正（`nextRunValidation.ts`，冻结项的最小跟随）

`buildPriorCompletedRun` 是「确定性快进」脚手架（A 类，非真人路径）。
若沿用 `PRIOR_RUN_DURABILITY = 'upgrade'`，R2 会让它多经 `d4-lateral` ⇒ 多拿一项
⇒ `priorRunSummary.build` 由 2 项变 3 项 ⇒ M2 已验收的可观测输出变化、E2E 断言破裂。

⇒ 改为 **`'repair'`**：路径与内容**完全不变**
（`d2-choice1` → 耐久事件 → `d5-tend` → `d5-choice2`）⇒ `priorRunSummary` 逐字段保持原值、
**M2 单测 16/16 零改动通过**。

**代价（如实记录）**：`repair` 会累计 `repairBonus`，而 `runCarriedPlayerHp` 把它叠加到
真实剩血上 ⇒ `runCarriedPlayerHp(prior)` 从此报告「剩血 + 275」（实测 416 = 141 + 275）。
⚠️ `priorRunSummary.durabilityPercent` 读 `battle.playerHp`（真实战果）**不受影响**；
现有断言只要求它是「一个明显不是满耐久的数」⇒ 当前**不改变任何结论**。
⚠️ 将来若有人断言 `runCarriedPlayerHp(prior) === prior.battle.playerHp`，会在这里踩坑。

### K.9 本轮改实现的两条守卫「收紧而非放宽」

1. `RP-RUN-02-01`：R1 的「`next` 目标集合互不重复」在 R2 后必然失效（两条分支都经 `next`
   汇入 `d5-choice2`）⇒ 收紧为**入度分析**：全脚本**唯一汇合点** = `d5-choice2`，
   恰好两个前驱 `[d4-lateral, d5-tend]`，其余节点单前驱。
2. `RP-22b`：R1 的「汇合后两分支账面逐字段相同」必然不成立（改装多一个图标）
   ⇒ 收紧为「除 `buffIcon`/`buffChip` 外逐字段相同，且差额**恰好** 756 / 144」。

### K.10 门禁实测（本轮）

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | **0 错** |
| `tests/portraitRunPage.test.ts` | **66/66 PASS** |
| `tests/portraitNextRunValidation.test.ts` | **16/16 PASS（零改动）** |
| 全量 vitest（`--pool=vmForks --maxWorkers=1`） | **206 文件 / 2017 用例 PASS** |
| `_e2e_run_page.cjs` | **503/503 PASS** |
| `_e2e_next_run.cjs` | 47/47 |
| `_e2e_portrait_battle_lab.cjs` | 148/148 |
| `_e2e_encounter_lab.cjs` | 47/47 |
| `_e2e_validation_hub.cjs` | 42/42 |
| `_e2e_prp_default_entry.cjs` | 79/79 |
| 冻结区 `git diff --stat` | **空** |

⚠️ **首轮 run-page 4 FAIL（13 段）**：`_e2e_run_page.cjs` 的动能爆发感知链原本用
`chooseById('upgrade') → chooseById('kineticBurst')`；R2 之后 `upgrade` 先落 `d4-lateral`，
`kineticBurst` 不在横向池里 ⇒ `chooseById` 返回 `null` ⇒ R63/R64/R65/R66 四条 FAIL
（实测 0 次命中 / 0 个环 / 0 位移）。**修法 = 该段改走维修分支**
（同样到达 `d5-choice2`、第二层池一致 ⇒ Build 仍是 `[heavyShell, kineticBurst]`
= `FROZEN_REPAIR` 那条路线，感知链阈值口径**一字不改**）。修后实测：
11 次真实命中 · 有环帧 115 · 位置不符 0 · 年龄越界 0 · 环峰值 2 · 位移峰值 66.02px · 冲量 1310.72。
⇒ 教训：**改分支图后，凡是用 `chooseById(id)` 按 id 选卡的段落都要重新核对「那一步现在落在哪个节点」**。

交付：`09ee631`（基线 `de5885e`，11 文件 / +1294 −303）；交接文档 =
`交接文档_2026-09-18_PRP-RUN-02-R2-MAKE-DURABILITY-CHOICE-REAL.md`（本地件）。

