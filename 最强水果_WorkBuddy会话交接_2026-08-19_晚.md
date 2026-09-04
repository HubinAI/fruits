# 《最强水果》WorkBuddy 会话交接（2026-08-19 22:18）

> 本文件是会话交接包：新窗口接手时先读本文件 + 项目基线
> `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md`（V1.0）。
> 详细逐队列日志见 `.workbuddy/memory/2026-08-19.md`。

---

## 0. 核心定位（判断机制是否保留的唯一标准）

极简策略 + 事前组装 + 自动物理战斗。
玩家循环：「我觉得这样能赢 → 看它自己打 → 原来问题在这 → 改一下再试」。
**每个机制必须让玩家做出不同的下一步动作，否则不保留。**

指令优先级：①最新明确的单次执行指令（最高）②稳定项目边界 ③历史草稿。

---

## 1. 当前 Git 状态（接手先确认）

| 项 | 值 |
|---|---|
| 分支 | `foundation-02-canonical`（**顶层名**，commit ref 自动落盘） |
| HEAD | `c1e0d6c2e9e53bd14273fc6872821884074be59b`（= 远端，upstream 已同步） |
| HEAD^ | `254e4ac8b38061f8e31157067f921cf49720adbc` |
| 旧分支 | `feature/foundation-02-canonical` 仍 = `d0411fb`（已弃用，**勿删**） |
| 工作区未提交 | 仅 `.workbuddy/memory/`、4 个诊断测试、交接 MD（全非生产，勿动） |

## 2. 环境惯例（必须遵守，否则踩坑）

1. **Node**：必须 managed 24.x —— `export PATH="/c/Program Files/nodejs:$PATH"`（默认 22.22.2 不满足 engines）。
2. **vitest**：所有命令必须带 `--pool=vmThreads --maxWorkers=1`，否则 `reading 'config'` 误报全失败。
3. **scoped tsc**（不跑全量，镜像项目 strict）：
   ```
   node ./node_modules/typescript/bin/tsc --noEmit --strict --ignoreConfig --target ES2020 --module ESNext --moduleResolution bundler --lib ES2020,DOM,DOM.Iterable --skipLibCheck --allowImportingTsExtensions --resolveJsonModule --isolatedModules --esModuleInterop --allowSyntheticDefaultImports --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch --noImplicitOverride --types vite/client <目标文件...>
   ```
4. **git push**：origin 已切 SSH（`git@github.com:HubinAI/fruits.git`，经 `~/.ssh/config` 走 `ssh.github.com:443`，本网络 HTTPS 443 被墙）。push 后 `refs/remotes/origin/...` 追踪 ref 常不落盘（环境 bug）→ 按惯例补实：
   `mkdir -p .git/refs/remotes/origin && printf '%s\n' <HEAD> > .git/refs/remotes/origin/foundation-02-canonical`
5. **git commit**：顶层分支（无 `/`）自动落盘；**含 `/` 的 ref 写入被环境静默拦截**（勿用 `feature/` 前缀分支名；旧分支勿再 commit）。
6. **中文路径伪影**：`git status` 把 `planck` 显示为 `plank`（无 c）；真实文件名始终有 c。
7. **提交流程**（每次队列收尾）：
   精确 `git add` 目标文件 → `git diff --cached --name-only` 核对严格范围 → `git -c commit.gpgsign=false commit -m "..."` → `git rev-parse HEAD/HEAD^` 验证 parent → `git push origin foundation-02-canonical` → `git ls-remote origin foundation-02-canonical` 验证远端 = 本地 → 补 tracking ref。

## 3. 已完成队列轨迹（全部已提交 + push 到 foundation-02-canonical）

| 队列 | Commit | 内容 |
|---|---|---|
| B17B（A1/A2/A3/T/V/S） | `1c3c8fb`（feature 分支时代） | 引擎中立 Render 合同 + Matter/Planck getRenderSnapshot + Renderer 解耦 + physicsLab engine selector + 入口测试 |
| Q02-F1 | （并入 d0411fb 前） | PlanckWorld destroyBody / applyLinearImpulse / bullet-CCD（Projectile 基础） |
| Q02-F2/F2R1 | （同上） | ContactRouter projectile 路由 + 实例级去重（drain facts） |
| Q02-C2/C1A/C1B | （同上） | cannon Content + CannonBehavior（固定冷却发射/recoil）+ projectile 生命周期销毁 |
| Q02-C3A/C3B | （同上） | BattleRenderSnapshot.projectiles + Renderer 绘制 |
| Q02-C4 | （同上） | Cannon 三场景（Hit/Recoil/Angle） |
| Q02-M | （门禁 PASS） | 12 文件 63/63 全量回归 |
| GIT-A/B | `d0411fb`（用户手动提交 Q02）→ 顶层分支迁移 | SSH 全链路验证；正式分支迁移为顶层 `foundation-02-canonical` |
| Q02-CAM-R1/R2/S | `9d9a072` | 固定镜头（安全区 + primary-fire 合并）+ 提交 |
| LAB-DEBUG-UX | `88d9f71` | Debug 默认全关 + 一键关闭 |
| Q02-EXP-R1 | `45d951c` | Cannon 参数放大（radius 10/speed 8/recoil 30）+ Cannon-Hit 距离 750 |
| Q03-F1 | `879d33d` | Revolute angle + limit（Hammer 基础） |
| Q03-F2 | `5184340` | hammer Content + Revolute 装配分支 |
| Q03-C1 | `a4e4971` | HammerBehavior Wind-up→Swing→Recover |
| Q03-C2 | `8a111f5` | Hammer 三场景（Hit/Miss/Reaction） |
| Q03-C1R1 | `2ef3f3d` | Revolute limit 真实接入（物理弧） |
| Q03-C2R1 | `550c965` | Hammer 场景固定弧回归测试 |
| Q04-F1 | `131d52b` | Prismatic 四件套（create/translation/motor/limit） |
| Q04-F2 | `cde39b7` | pushRod Content + Prismatic 装配分支 |
| Q04-C1 | `eb53654` | PushRodBehavior Extend→Hold→Retract |
| Q04-C2 | `b012bca` | Push Rod 三场景（Light/Heavy/Reaction） |
| Q05-F1 | `5f9758d` | liftRoller Content + Revolute 装配（circle radius 24） |
| Q05-C1 | `9d3dd55` | LiftRollerBehavior continuous motor（顶起/grounded 翻转） |
| Q05-V1 | `254e4ac` | Renderer circle 径向线（旋转可感知） |
| Q05-C2 | `c1e0d6c`（当前 HEAD） | Lift Roller 三场景（Light/Posture/Grounded） |

## 4. 生产文件地图（当前 Behavior 体系）

- **装配分支**（`planckVehicleAssembly.ts` part 段）：
  - Revolute：`hammer` / `liftRoller`（hammer=摆锤，liftRoller=continuous roller）
  - Prismatic：`pushRod`（axis = facing 前方本地轴）
  - Weld：其余（ram / cannon / 普通 gadget）
- **Behavior**（orchestrator 统一 onBeforeStep 插入口，无第二套生命周期）：
  - `cannonBehavior`（冷却发射+recoil+projectile 销毁）
  - `hammerBehavior`（limit 真实物理弧 + 状态机）
  - `pushRodBehavior`（Prismatic limit 伸缩循环）
  - `liftRollerBehavior`（continuous motor，无状态机）
- **引擎中立**：`battleContract.ts`（BattleRenderSnapshot：arena/vehicles/projectiles?/RenderCircle.angle）；`physicsLab.ts` selector（`config.engine==='planck'` → Planck，其余 Matter）；`renderer.ts`（只消费 Snapshot，circle 径向线 Q05-V1）。
- **关键实测结论**（已固化日志）：
  - Planck limit 高压力穿透 ~0.103 rad（Revolute）/ motor 撞限位余量 ~0.03 rad；
  - `getPrismaticTranslation` = 沿 axis 的带符号位移（dot(axis, displacement)）；
  - Lift Roller 从侧面顶 B 轮（roller 比 B 轮底低，无法正下方顶起）；Grounded 序列 `11→10→11`；
  - 出生重叠会把带轮 B 推滚出作用范围（Hammer spawnB 620+ 打空 / Push Rod 同理）；
  - Cannon muzzleSpeed 8 下弹道命中上限 ~100px（重力 0.28px/step² 下落）。

## 5. 测试矩阵（全部通过，Node 24 + vmThreads）

| 测试文件 | 用例 | 覆盖 |
|---|---|---|
| planckWorldRevoluteLimit / planckWorldPrismatic | 5 / 6 | Revolute/Prismatic Foundation |
| hammerAssembly / cannonBehavior / cannonScenarios | 4 / 6 / 4 | Hammer/Cannon 装配+行为+场景 |
| hammerBehavior / hammerScenarios | 6 / 4 | 状态机 + limit 物理弧 + 场景 |
| pushRodAssembly / pushRodBehavior / pushRodScenarios | 6 / 4 / 4 | Push Rod 全链 |
| liftRollerAssembly / liftRollerBehavior / liftRollerScenarios | 4 / 4 / 4 | Lift Roller 全链 |
| rendererCircleRotation / rendererProjectile / projectileRenderSnapshot | 3 / 3 / 3 | Renderer |
| physicsLabEngine / planckBattleOrchestrator / contentCannon / labDebugDefaults | 6 / 9 / 4 / 4 | 入口/合同/内容/UI |
| contactRouterProjectile / planckWorldProjectileFoundation / battleContract / foundationCanonical / baselineDrive | 6 / 7 / 7 / 5 / 3 | 基础回归 |

## 6. 未提交 / 遗留项（勿动，除非用户明确授权）

- `.workbuddy/memory/MEMORY.md`（有 GCM 凭据记忆修正，更早未提交）
- `.workbuddy/memory/2026-08-17/18/19.md`（会话日志，追加式）
- 4 个诊断测试：`wheelStiffnessDiagnostic` / `wheelHardAxleDiagnostic`（废弃方案残留）、`planckDriveCalibration` / `planckRevoluteSpike`（POC 残留）——待清理，未授权勿删
- `最强水果_个人版WorkBuddy接续包_2026-08-19.md`（更早接续包）

## 7. 下一步候选（按惯例需用户指令）

1. **Q05 合并门禁**（推荐，类似 Q02-M）：全量显式测试清单 + scoped tsc + diff 范围核查 + git ref 健康检查；
2. 新武器/机制队列（如 Ram 强化、Gadget 复合、多武器车等）；
3. 清理：4 个诊断测试 + memory 整理（需用户授权）。

## 8. 交接指令（可直接粘贴给新会话）

```
请先读 D:\0818new\最强水果\ 下的：
1. 最强水果_WorkBuddy会话交接_2026-08-19_晚.md（本文件）
2. 最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md（长期基线）
3. .workbuddy/memory/2026-08-19.md（逐队列详细日志）

确认环境：
- 分支 foundation-02-canonical，HEAD=c1e0d6c（远端已同步）
- Node 用 managed 24.x（export PATH="/c/Program Files/nodejs:$PATH"）
- vitest 一律 --pool=vmThreads --maxWorkers=1
- push 走 SSH（origin 已配置）；push 后补 tracking ref

当前无进行中任务。等待用户下达下一队列指令；
若用户要求 Q05 合并门禁，按 Q02-M 模式执行（显式测试清单、
scoped tsc --ignoreConfig、diff 范围核查、git ref 健康检查，只报告不修复）。
```
