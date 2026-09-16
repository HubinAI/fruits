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
  `fastReload → [suppressionShot, …]`。
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

## E. PRP-BUILD-01-R4 压制射击（最新交付）

- ⚠️ **结构性改判：换作用对象，不是调数值。** `强力后坐` **三版全败**：
  `反冲蓄能前推` → `3 发蓄能后强后坐` → `每炮强后坐`。Runtime 侧全部真实生效，
  失败点在**通道本身** —— 整条机制都在推**玩家自己**（车重：3000 冲量仅 4.56° 转动）且相机追平。
  ⇒ **整条 recoil 二层机制删除，不再通过数值 / VFX / Camera 挽救**（无兼容分支）。
- 新口径 = **压制射击 suppressionShot**：**每一次真实炮弹命中敌车** → 沿本次弹道方向一次中等击退；
  作用点 = 本次命中**自己的**真实 `contactPoint`。`SUPPRESSION_SHOT_IMPULSE = 300`。
  入口唯一：`damageSource === 'weapon' && source === 'A' && target === 'B' && behavior === 'cannon'`。
  无开炮即触发 / 无定时器 / 无累计层数 / 无「第 N 发」/ 无固定周期。
- **删除清单**：导出 `STRONG_RECOIL_IMPULSE` / `RECOIL_CHARGE_IMPULSE` / `RECOIL_CHARGE_THRESHOLD`；
  字段 `strongRecoil` / `recoilKicks` / `lastRecoilImpulse` / `charge` / `chargeThreshold` / `chargesSpent`；
  `lastFireX/lastFireY`（作用点改为命中点，不再需要开火点）；图标分支与 E2E 采样键 `iconRecoil`。
  **正式 Cannon 自带 recoil 原样未动。**
- ⚠️ **`damage` 事件不带弹道方向**：只有 `contactPoint` / `contactNormal` / `relativeVelocity`；
  `contactNormal` 是**撞击面法线**（斜撞会读成横向）⇒ 方向复用本次 `weaponFire.worldDirection`。
- ⚠️ **`soloA: true` 下敌人仍会被命中**（实测 4 次）⇒ **不能做「miss 不触发」判据**。
  正确做法 = **合成事件注入**直测 `RunBuildAbilities(ports, build)`（记录型假端口，纯逻辑确定性），
  可逐条否掉四条禁止路径（开炮无命中 / 非 weapon 来源 / 反向命中 / 非 cannon）。
- 与 `kineticBurst` 的区分（**同一入口、两种语义**）：
  动能爆发 = `KINETIC_BURST_GAIN × 弹丸质量 × 相对速度` = **单次强冲击**（一炮轰飞）；
  压制射击 = 定值 300 = **多次小冲击**（单发只顿一下），靠 650ms 高频炮击重复。
- 粗档扫描（真实 Runtime，冻结）：

  | 冲击 | 每命中顶回中位 | 单发最大 | 敌车最大 x | 贴近远端墙 | 玩家挨打 | 步数 | 平均伤害 |
  |---|---|---|---|---|---|---|---|
  | 0（A 基线） | 0.2 | 3.5 | 1200 | 0 帧 | **23 次** | 586 | 76.9 |
  | 250 | 39.5 | 50.4 | 1259 | 0 帧 | 17 次 | 586 | 76.9 |
  | **300（选定）** | **35.0** | **61.6** | **1336** | **0 帧** | **7 次** | **588** | **76.9** |
  | 350 | 39.9 | 71.6 | 1412 | 0 帧 | 4 次 | 592 | 76.9 |
  | 450 | 43.5 | 89.7 | 1512 | 0 帧 | 3 次 | 703 | 76.9 |
  | **K（动能爆发）** | **76.5** | **121.3** | **1535**（右缘 1626 > 1600） | **258 帧** | 16 次 | 1021 | 79.6 |

  选 300 = 六条验收全满足里的**最低档**（可感知 175× / 挨打 −70% / 单发最大仅 K 的 51% /
  nearWall 0 帧 / `minGap` 仍为负 / 平均伤害与 A 组**完全相同**）。**未做 10% 级微调。**
- ⚠️ **相机对敌车同样追平** ⇒ 屏幕位移仍 ≈ 世界位移一半 × 舞台缩放（中位 35 世界 px ≈ 8~10 舞台 px，
  敌车宽约 90px 即约 39%）→ 是否够可感知**交真人裁决**。
  ⚠️ 对照事实：`kineticBurst` 自己会把敌车顶到远端墙（`enemyMaxX 1535` / 258 帧）——
  **既有现象，不是本 Queue 缺陷，未处理。**
- 冻结字面量 `FROZEN['fastReload+suppressionShot'] = [843, 622, 582]`（`tests/portraitRunPage.test.ts` RP-F2-14）。
