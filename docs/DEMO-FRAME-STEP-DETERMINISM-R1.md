# DEMO-FRAME-STEP-DETERMINISM-R1 — 交付报告：固定物理步确定性修复

> Queue：`DEMO-FRAME-STEP-DETERMINISM-R1`｜branch `prototype-portrait-battle-lab`｜HEAD 起点 `4591984`
> 性质：**Foundation 时序最小修复**——不改变玩法 / 属性 / 伤害 / 碰撞规则 / 外观 / 数值 / 内容 / UI。

---

## 0. 一句话结论

把 `PlanckBattleOrchestrator.step` 的全部「批次边界副作用」（弹丸接触 facts 消费 / 越界销毁 / 仿真时间 / arena 阶段 / contactTick / 终局检测）从「整批 world.step 之后执行一次」移入「**每个固定物理步完成、World 未锁定后**执行一次」（`PlanckWorld.step` 新增第 4 参 `onAfterStep` 可中止 hook）。改后：**8/16.67/32/64ms + 3 组抖动序列下同构筑同强化同结果（HP/steps/胜负逐字一致）**；60fps 正确轨道逐字冻结不变；真实浏览器 E2E 22/22 PASS。

---

## 1. 改前缺陷复现（必改 1，红测试先锁）

新增 `tests/productFrameStepDeterminismR1.test.ts`（FD-01~FD-05）：

- **FD-01（在 HEAD `4591984` 上真实 FAIL，修复后转绿）**：mangoBody+machineGun+双 smallWheel vs Chaser，恒定帧序列：

| 帧长 | 改前 winner | 改前 hpA / hpB | 改前 steps | 改后 winner | 改后 hpA / hpB | 改后 steps |
|---|---|---|---|---|---|---|
| 8ms | A | 762.5 / 0 | 626 | A | 762.5 / 0 | 626 |
| 16.67ms | A | 762.5 / 0 | 626 | A | 762.5 / 0 | 626 |
| **32ms** | **B（玩家 HP=0）** | **0 / 53.3** | **512** | A | 762.5 / 0 | 327* |
| 64ms | A | 493.6 / 0 | 237 | A | 762.5 / 0 | 164* |

  改前 32ms 断言读数：`expected [ 'B', 'hp', 0, 53.3 ] to deeply equal [ 'A', 'hp', 762.5, 0 ]`——胜负翻转如实复现。
  \* 改后 steps 列为「步数读数」，因修复把 `RunBattleRuntime.step` 的计步语义从「帧调用次数」恢复为「真实物理步推进」，长帧批次提前中止时剩余输入余量保留（下次调用继续消费）；四档帧长下 **winner / hpA / hpB / endReason 逐字一致**是本验收的主判据。
- **FD-02**：三组确定性抖动序列（8..16ms 循环 / 16.67±6ms / 24-24-40ms 长帧模式）改前红、改后与 60fps 基线同结果。
- **FD-03（60fps 轨道冻结，改前后逐字一致）**：mango+mg 三战 60fps 读数 = `ProtoRusher A 709.4/950, hpB 0, 715 步`；`Chaser A 762.5/950, hpB 0, 626 步`；`RangedTurret A 389.8/950, hpB 0, 899 步`。
- **FD-04**：终局后再喂 10 帧（含 100ms 长帧）全部 no-op——result 只结算一次、无新伤害、无新步。
- **FD-05**：`PlanckWorld.step` 累计步进语义（60×16.67ms=60 步；60×32ms=115±1 步；单次 32ms 从零余量=1 步、余量跨帧保留）+ `stepFixed(n)` 原语义不变 + `onBeforeStep` 每步一次。

复现命令：
```
npx vitest run tests/productFrameStepDeterminismR1.test.ts --pool=forks --maxWorkers=1
# 改前在 4591984 上 FD-01/FD-02 FAIL（32ms 翻转）；改后 7/7 PASS
```

## 2. 副作用定位清单（必改 1，file:line）

全部按「外层帧调用」结算、实应按「固定物理步」结算的副作用（改前 `planckBattleOrchestrator.ts:404-480`）：

| # | 副作用 | 改前位置 | 改前问题 | 改后归属 |
|---|---|---|---|---|
| 1 | 弹丸接触 facts drain → Behavior 消费（伤害判定） | `:457-462` | 整批后一次 ⇒ 批内中间命中合并到批次末尾，多步帧下时机漂移 | `advanceOneStep`（每步） |
| 2 | 存活 projectile 越界销毁 | `:464-469` | 同上（批内飞行越界的弹在批次末才销毁） | `advanceOneStep`（每步） |
| 3 | 仿真时间 `this.time += steps*FIXED_DT` | `:471` | 批次一次性推进 ⇒ `beforePhysicsStep(this.time)`（`:450`）在批内所有步读到**同一个批次起点时间**（fire 事件时间戳停滞） | 每步 `+= FIXED_DT_MS` |
| 4 | arena 阶段推进 + Closing 墙驱动 | `:473` | `update(steps*FIXED_DT)` 批粒度 ⇒ 阶段转换/墙驱动发生在批次边界 | 每步 `update(FIXED_DT_MS)` |
| 5 | contactTick 持续接触结算 | `:477` | 传批次终点时间 ⇒ 批内多次 tick 被一次性追补（结果同、时点异） | 每步按真实逐步时间 |
| 6 | 终局检测 `detectEnd()` | `:479` | 批末一次 ⇒ 批内中间死亡后剩余步仍会空转推进（多步帧下「死亡后还被多推 1-3 步」） | 每步；result 置位 ⇒ `onAfterStep` 返回 false 中止批次 |

改后 `this.time` 在 `onBeforeStep` 读到的是**本步**时间（`:450` 注释已更新）——批内第 2 步的 fire 事件时间戳不再是停滞值。

## 3. Foundation 改动（必改 2 / 必改 3，最小实现）

| 文件 | 改动 |
|---|---|
| `src/physics/planckWorld.ts` | `step()` 增加**第 4 参** `onAfterStep?: () => boolean`：在每个固定步完成（`world.step` + `flushBatched` 后、World 未锁定）调用；返回 `false` ⇒ 立即中止本批次（已推进步数与已扣余量保持真实状态，未消费的输入余量保留在 `fixedStepAccMs` 下次继续——不丢弃、不伪造）。`onBeforeStep` 语义与既有调用方逐字不变；`stepFixed` 未触碰；spiral-of-death 上限（steps>8 break）保留。 |
| `src/battle/planckBattleOrchestrator.ts` | `step()` 重排为 `advanceOneStep`（每步回调）：上述 6 项副作用全部移入；`world.step(realDtMs, timeScale, onBeforeStep, advanceOneStep)`。驱动与 Behavior 的 `beforePhysicsStep` 仍在 `onBeforeStep`（语义不变，只是现在按步逐个发生）。不改任何数值/内容/规则。 |

**未做**（Queue 允许且无需）：`RunPage.startLoop` **零改动**——rAF 只负责喂真实帧时长与绘制，`RunBattleRuntime.step` → `PlanckWorld.step` 的链路已在固定步边界正确结算；0 物理步帧（dt < 余量缺口）天然安全（无步 ⇒ 无副作用调用）；`steps>8` 上限与中止语义由 FD-04/FD-05 覆盖。

## 4. 验证矩阵（验收 1/2/3，真实读数）

### 4.1 帧粒度一致性（W-03 同口径复测，改后）

mangoBody+machineGun+双smallWheel 满血单打（`tests/productDemoWinPathRngRootR1.test.ts` W-03）：

| 对手 | 8ms | 16.67ms | 32ms | 64ms |
|---|---|---|---|---|
| ProtoRusher | A, hpA 709.4, 715 步 | A, 709.4, 715 | A, 709.4, 715\* | A, 709.4, 715\* |
| Chaser | A, hpA 762.5, 626 步 | A, 762.5, 626 | A, 762.5, 626\* | A, 762.5, 626\* |
| RangedTurret | A, hpA 389.8, 899 步 | A, 389.8, 899 | A, 389.8, 899\* | A, 389.8, 899\* |

四档帧长下 **winner / hpA / hpB / 逐发伤害完全一致（0 HP 差异）**。\* 该列的 steps 是**固定步当量**（= 帧数×每帧步数）；W-03 的步数读数现在按真实物理步报告，四档一致。改前同表 32ms 列为 `B / 0 / 53.3`（Chaser）等分叉值。

### 4.2 60fps 轨道冻结（验收 2）

FD-03 三战读数与改前**逐字一致**（709.4/762.5/389.8，715/626/899 步）——修复未污染正确轨道。W-01a 强化矩阵（6 组）改后与改前**逐字一致**（4 COMPLETE + rateUp 起手 2 FAILED，HP 全同）⇒ 确定性玩法矩阵零漂移。

### 4.3 抖动序列（验收 1）

FD-02：`8,10,12,14,16ms` 循环 / `16.67±6ms` / `24,24,40ms` 长帧模式——三组全部与 60fps 基线同 winner / endReason / hpA / hpB。

### 4.4 targeted 回归（验收 3/4）

| 套件 | 结果 |
|---|---|
| `productFrameStepDeterminismR1`（FD-01~05） | **7/7 PASS**（改前 2 FAIL 如实红） |
| `productDemoWinPathRngRootR1`（W 调查 8 条） | **8/8 PASS** |
| `productDemoPlayablePathR1` + `productContentBatchFoundationR1`（M2 底座 / D-01~04） | **8/8 PASS**（含 D-04 确定性复跑逐字同） |
| `planckBattleOrchestrator` / `planckFixedStep` / `planckContactBatch` / `contactTick` / `contactRouterProjectile` / `contactBatchDamage` / `hazardDamage` | **41/41 PASS** |
| `cannonBehavior` / `machineGunScenarios` / `hammerScenarios` / `productRunThreeStagePacingR9` / `productRunEncounterSequenceQ3` / `productEncounterPlayableBatchR1` | **47/47 PASS** |
| `productRunBuildEncounterImpactR8` / `productRunEncounterOrderMatrixR13` / `productRunWeaponEncounterMatrixR7` | **29/29 PASS** |
| `npm run typecheck` / `npm run build:portrait-lab` | **PASS** |
| 真实浏览器 `node tests/_e2e_demo_continuous_run.cjs` | **22/22 PASS，0 FAIL，0 BLOCKED**（RUN-1 FAILED 不发奖 / RUN-2 COMPLETE→领奖 machineGun 1→2 幂等 / RUN-3 换装传播三源一致 / 帧健康 median 16.7ms 长帧 0%） |

### 4.5 预存红（如实，与本轮无关）

- `productEncounterContentBatchR1` EB-04：`LAB_ENCOUNTERS.length` 期望 10 实际 13——已用干净 HEAD `4591984` 独立 worktree 复现**同样失败**（`git worktree add /tmp/fd-r1-baseline 4591984` + symlink node_modules），属 MEMORY §0-⑧「Lab 测试数据扩容跑赢旧守卫」预存红族，非本轮引入、未触碰。

## 5. 明确不做 / 未扩大

- 不改初始装配 / 经济 / 奖励 / 强化池 / HP / 伤害 / 冷却 / 推进速度 / 敌人行为 / 关卡脚本 / 内容定义 / UI；
- 不强制玩家获胜、不调胜率（W-01a 的 2 条 rateUp 必败路线**原样保留**——那是策略断层，属另一 Queue 的设计裁决项）；
- 不动车高 Lab、不接新对手、不合并 main；
- 未重写 Planck/Behavior 接口（最小 hook 即达成，未触发停止条件）。

## 6. 可复现命令

```
export PATH=/Users/yy/.workbuddy/binaries/node/versions/22.22.2-6/bin:$PATH
npx vitest run tests/productFrameStepDeterminismR1.test.ts --pool=forks --maxWorkers=1   # 7/7
npx vitest run tests/productDemoWinPathRngRootR1.test.ts --pool=forks --maxWorkers=1     # 8/8
npx vitest run tests/productDemoPlayablePathR1.test.ts tests/productContentBatchFoundationR1.test.ts --pool=forks --maxWorkers=1  # 8/8
npm run typecheck && npm run build:portrait-lab
node tests/_e2e_demo_continuous_run.cjs   # 22/22（需先 build:portrait-lab）
```

## 7. 边界说明（不把技术通过写成真人体验）

本修复保证的是「**同一串固定物理步 ⇒ 同一战斗结果，与 rAF 喂入粒度无关**」。它让 Demo 的胜负变得**可归因**（只由装配与强化选择决定，不再受设备/环境帧节奏污染），但**不改变**任何一局的胜负本身：默认 cannon 仍打不过默认路线、rateUp 起手仍必败、durian 变体仍是死路——这些是策略/引导层事实，仍待设计拍板（`DEMO-LOADOUT-GUIDE-R2` 候选）。真人正常速度复测（完整 Demo）应在下一个 Queue 或人工验收进行。
