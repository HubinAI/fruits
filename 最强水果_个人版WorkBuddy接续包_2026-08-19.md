# 《最强水果》个人版 WorkBuddy 接续包

更新时间：2026-08-19  
用途：把企业版 WorkBuddy 已形成的项目记忆、当前代码基线和执行规范迁移到个人版 WorkBuddy。  
原则：本文件用于接管现状，不得据此重新讨论已冻结规则，也不得重复已经完成的队列。

---

## 1. 当前唯一执行入口

- GitHub 仓库：`HubinAI/fruits`
- 工作分支：`feature/foundation-02-canonical`
- 当前已验证远程提交：`8a705e7959e5a41bbf50bc385277999efd3749c0`
- 提交标题：`feat(physics): add Planck body transform bounds`
- 对应里程碑：`Queue F-02M-B16AS` 已提交完成
- 下一条未执行任务：`Queue F-02M-B16B`
- `B16B` 在旧电脑上没有执行，也没有遗留生产代码或测试改动。

重要：仓库默认分支 `dev` 明显落后，禁止从 `dev` 继续开发。个人版 WorkBuddy 必须先切到上述 feature 分支并核对 HEAD。

---

## 2. 新电脑环境基线

当前项目依赖合同：

- Node：`>=24.0.0`；旧环境正式使用 `v24.18.0`
- npm：旧环境 Node 24 自带 `11.6.0`
- Planck：精确 `1.4.3`
- Matter.js：`^0.20.0`
- Vite：`^8.2.1`
- Vitest：`^4.1.10`
- TypeScript：`^7.0.2`

新电脑建议初始化：

```bash
git fetch origin
git switch feature/foundation-02-canonical
git pull --ff-only origin feature/foundation-02-canonical
node --version
npm --version
npm ci
```

必须确认：

```bash
git rev-parse HEAD
git rev-parse origin/feature/foundation-02-canonical
git status --short
```

预期两个 SHA 相同，工作区无生产代码改动。

---

## 3. 已冻结的产品与战斗规则

以下规则已经形成共识，不得重新从零讨论：

1. 核心体验是极简策略、战前装配、物理自动战斗。
2. 车辆四类部件：`Body / Movement / Weapon / Gadget`。
3. `Weapon` 与 `Gadget` 共用功能挂点；没有独立 Gadget 槽。
4. `Energy` 是装配预算；`Mass` 进入物理模拟，不设硬性总重量上限。
5. 战斗为 2D 侧视物理场，强调可解释的因果关系。
6. 禁止随机伤害、暴击、闪避等破坏物理可解释性的机制。
7. `Force/Posture` 与 `Damage` 两条通道独立；Gadget 不允许直接伤害。
8. 自动战斗只做简单趋近，不做自动瞄准和自动距离控制。
9. Arena 阶段固定为 `Active -> Warning -> Closing -> End`。
10. 验收顺序固定：存在性 -> 可感知 -> 可理解 -> 可决策。只有真实试玩能通过最后一层。
11. 不恢复已放弃的旧设计，也不以“临时方便”为由增加未批准能力。

---

## 4. 物理 Foundation 已冻结合同

### 4.1 双引擎单位

- 游戏层使用 px、px/step、rad/step。
- Planck 层使用 m、m/s、rad/s。
- `100px = 1m`。
- `1px/step = 0.6m/s`。
- `1rad/step = 60rad/s`。
- 屏幕坐标 Y 向下；Planck 重力注释与测试均以 Y-down 语义为准。

### 4.2 固定步

- 固定物理频率：60 Hz。
- Matter 与 Planck 都采用“累加值 + 微小容差 >= 固定步”的语义。
- jitter `[34,33,33] x 10 = 1000ms` 必须精确推进 60 步。
- 长帧 catch-up 上限沿用原语义：最多 9 次迭代。
- 单帧推进前的回调顺序不能改变。

### 4.3 Planck 封装边界

- 只有 `src/physics/planckWorld.ts` 可以直接导入 Planck。
- 对外只暴露不透明 `BodyHandle / JointHandle`。
- 禁止 `as any`、`as unknown`、native escape hatch 和跨 World handle。
- 所有单位换算集中在 `src/physics/units.ts`。

### 4.4 接触与伤害

- compound 接触必须使用 parent COM 速度，并计入接触点 `v + w x r`。
- batch 同步碰撞必须先完整收集，再按 batch 去重结算。
- Impact 阈值已正式标定为 `0.75`。
- Weapon 接触阈值已正式标定为 `0.5`。
- Impact 与 Weapon 可以在同次接触同时成立，但同批重复 pair 不得重复扣血。
- `DamageResolver` 和 `ContactRouter` 已改为引擎中立 `CombatVehicleState` 合同。

### 4.5 当前边界 API

`PlankWorld` 已具备：

- `setPosition(body, xPx, yPx)`：只改位置，不改角度、线速度、角速度。
- `getBounds(body)`：几何边界；polygon/box 排除 Planck collision skin。
- `getCollisionBounds(body)`：碰撞边界；保留 Planck polygon/box collision skin。
- 两者都按当前 transform 实时计算，不读取旧 broadphase AABB。

---

## 5. 企业版已完成里程碑摘要

### 5.1 Matter Foundation

- 修复 gravity.scale 标定与固定步顺序。
- 修复 compound sub-part Meta 传递。
- 修复 collision relativeVelocity 数据源。
- 完成 batch metadata 和 batch damage 去重。
- 完成 Impact/Weapon 阈值实测标定。

### 5.2 Planck Foundation A 系列

- 固化 Planck 1.4.3 与 Node 24 基线。
- 建立单位换算合同与最小 `PlankWorld` 内核。
- 完成 Revolute、重力、地面、接触桥接、friction、motor。
- 完成共享引擎中立车辆合同与 Arena 阶段时钟。

### 5.3 Planck Foundation B 系列

- 完成双轮 Revolute 车架稳定、水平运动和扰动恢复。
- 完成自然滚动、正式轮驱动与动力标定。
- 完成 `CombatVehicleState`、`DamageResolver`、`ContactRouter` 引擎中立化。
- 完成 Planck Arena 地基、ArenaRuntime、BattleResult 合同。
- 完成 Matter/Planck 固定步语义统一。
- 完成 `setPosition`、几何 bounds 与 collision bounds 合同。

最新完成节点是 `B16AS`。不要重复执行 A1 到 B16AS。

---

## 6. 未跟踪文件说明

旧企业版工作区长期保留过以下本地诊断文件，但它们没有进入提交，新电脑 clone 后不存在是正常现象：

- `.workbuddy/**` 记忆文件
- `tests/planckDriveCalibration.test.ts`
- `tests/planckRevoluteSpike.test.ts`
- `tests/wheelHardAxleDiagnostic.test.ts`
- `tests/wheelStiffnessDiagnostic.test.ts`

这些文件不属于生产基线。不要因为缺失而恢复、重建或提交，除非后续队列明确要求。

仓库内 `.workbuddy/memory/MEMORY.md` 只保存了较早的高层规则；以本接续包的当前 SHA 和 Planck 进展为最新事实。

---

## 7. WorkBuddy 执行规范

### 7.1 一条队列只做一个窄目标

每条队列必须明确：

- 唯一目标
- 允许改动的文件
- 禁止改动项
- 指定的 targeted tests
- 是否允许提交
- 失败时立即停止的条件

不得在单条队列中同时做大范围检索、实现、全量测试、构建、重构和提交。

### 7.2 可以多队列，但必须顺序执行

- 可以一次发送多个独立队列给 WorkBuddy 排队。
- 队列之间若存在代码依赖，后一个必须以前一个成功/提交为前置条件。
- 遇到警告、测试失败、类型错误、HEAD 不一致或 Git 异常时，立即停止后续队列并报告。
- 不得自动扩大修改范围或“顺便修复”。

### 7.3 测试与资源约束

- 默认单 worker。
- 旧环境 Vitest 默认池偶发 `reading 'config'` 故障；统一优先使用：

```bash
npx vitest run <target-test-files> --pool=vmThreads --maxWorkers=1
```

- Vitest 4.1.10 CLI 不支持 `--minWorkers=1`，不得再传。
- 显式文件的 scoped TypeScript 检查要带 `--ignoreConfig`，否则会触发 TS5112：

```bash
./node_modules/.bin/tsc --noEmit --ignoreConfig --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck <files>
```

- 除非队列明确要求，不运行全量 test/build/dev，不启动常驻进程。

### 7.4 Git 纪律

- 每条实现队列开始前：本地 HEAD = 远程分支、index 为空。
- 实现队列默认“只实现、只测、不提交”。
- 审核通过后再发单独的 `S` 提交队列。
- 提交必须单父、文件范围严格、只提交本队列生产/测试文件。
- 新电脑应优先使用标准 `git add/commit/push`。
- 旧企业版曾发生 sandbox 无法写 ref 的环境故障；那不是项目逻辑。新环境若再次发生，立即停止并报告，不得手写 `.git/refs`、拼 dangling commit 或自行恢复。

---

## 8. 新 WorkBuddy 首次接管队列（先执行这一条）

```text
Queue MIGRATE-00｜个人版 WorkBuddy 只读接管核验

只做接管核验，不修改任何文件，不安装全局软件，不执行 Git 写入。

仓库：HubinAI/fruits
分支：feature/foundation-02-canonical
期望 HEAD：8a705e7959e5a41bbf50bc385277999efd3749c0

1. fetch 并切到指定分支，只允许 fast-forward。
2. 报告本地 HEAD、远程分支 SHA、git status --short。
3. 报告 node --version、npm --version，并确认 package.json：Node >=24、planck=1.4.3。
4. 仅在依赖缺失时执行 npm ci；不得升级依赖。
5. 仅运行：
   npx vitest run tests/plankBodyTransform.test.ts --pool=vmThreads --maxWorkers=1
6. 阅读本接续包与仓库中的 .workbuddy/memory/MEMORY.md。
7. 最终只报告：基线是否一致、测试结果、工作区是否干净、下一条应为 B16B。

任一 SHA/分支/依赖不一致，或出现 Git/测试警告，立即停止；不得修复、不得提交。
```

`MIGRATE-00` 通过后，再把原先未执行的 `Queue F-02M-B16B` 指令发送给个人版 WorkBuddy。不要凭队列编号自行猜测 B16B 范围。

---

## 9. 给个人版 WorkBuddy 的接管声明

```text
你正在接手《最强水果》已有工程，不是从零设计。

以 GitHub 分支 feature/foundation-02-canonical 和本接续包为事实源；当前基线 SHA 为 8a705e7959e5a41bbf50bc385277999efd3749c0。A1 至 B16AS 已完成，不得重复；B16B 尚未执行。

严格遵守“单条精简任务 + 多队列顺序执行”。每条任务只改指定文件、只跑 targeted tests、单 worker；任何警告立即停止。不得重新讨论冻结规则，不得主动扩大范围，不得恢复旧诊断文件，不得使用旧企业版的 Git ref 手工恢复方式。
```

---

## 10. 信息优先级

发生冲突时按以下顺序判断：

1. 当前 GitHub feature 分支的代码与提交历史。
2. 本接续包记录的最新状态和执行规则。
3. 仓库内 `.workbuddy/memory/MEMORY.md`。
4. 2026-08-17 的旧交接文档与历史截图，仅作为设计背景。

如果无法从当前代码和明确指令证明某个行为，先只读调查并报告，不得自行补全需求。
