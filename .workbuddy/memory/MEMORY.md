# Fruits - Runtime Memory Index (compact)

Full archive: `.workbuddy/memory/archive/MEMORY_FULL_2026-09-05.md`
Daily: `.workbuddy/memory/YYYY-MM-DD.md` | Handoffs at repo root
Authority: `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md`

## 1. Identity
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果`
- Branch `foundation-02-wechat` (no new mainline)；实验分支 `prototype-portrait-battle-lab`（PBL-F0 竖屏实验台，可整块删除）
- R2.1 (体验 FAIL 基线)=`8fbac75`；memory=`ff6a20d`/`9df1eab`
- Last delivery: PBL-G1 A/B 对照门禁（`gate.ts` + Lab `Gate 下一步` 面板；审计 6 组合 0 差异；
  6 步顺序 A×3 ready / B×3 blocked；切场零残留）。PBL-A1 = `2ee47bb`；PBL-B1 **触发停止条件 0 行代码**；
  主线上一交付 R3 `1bb35d7`
- Details -> archive / daily logs / handoff docs

## 2. Rules
- 1 Queue = 1 problem; no silent scope creep.
- Investigate/reproduce FIRST; modify after root cause locked.
- tech pass != landed in runtime != real human experience pass.
- User owns experience; don't ask user for complex tech logs.
- Commands standalone; end reply: state what user must reply.
- PC recording normal; phone recording only for major module nodes.
- Stop after each Queue; never auto-continue.

## 3. Git/build safety
- `git stash` FORBIDDEN. git anomaly -> `scripts/repo-health.js` first.
- NO reset --hard / checkout -- / delete .git / hand-edit refs / force-push delivered.
- Single-feature commit+push; verify local=remote SHA.
- RC needs clean HEAD; badge/rc-build.json/runtimeInfo/HEAD 4-way equal.
- Memory merges into feature commit; NO standalone memory commit.
- PBL Lab 隔离不变量（F1 起收紧为**单向**）：反向硬约束 = 正式 src/ 全树 + 正式入口 + 4 个正式构建配置 0 引用 `portraitBattleLab|portrait-lab`（R22b/R23 守卫）；正向白名单 = Lab 只允许 import 只读纯模块（`core/content`/`core/buildSnapshot`/`core/buildValidator`/`core/types`/`player/opponentPool`/`platform/playerViewport`/`lab/buildEditorModel`），禁止任何 Runtime/DOM/平台/物理模块（R22a 守卫）。Lab 只走 `build:portrait-lab`→`dist-portrait-lab/`。
- vitest: cwd 盘符大写 `/D/…`；全量 `--pool=vmForks --maxWorkers=1`.

## 4. Stable contracts
- DPR applied exactly once (logical->backing); no double multiply.
- Viewport resume only via `syncWechatViewport`; no 2nd sizing path.
- safe-area/capsule + hitArea in logical coords (stage 844x390).
- E2E handles only under `__E2E_INTERNAL_HANDLE__`; RC/web excluded.
- hitArea & draw rects share one layout source (`computeFusionLayout`).
- E2E hitArea bounds = logical stage, NOT CSS viewport.
- 结果层 z 序（后注册先命中）：页控件 < dismiss(空白关) < `fusion-result-card`(点卡 no-op)。

## 5. Current truth
- R3 delivered `1bb35d7`：合成页星级选择（方案C）落地——星级行动态生成/默认星级规则①②③/单星卡/fusionSlots `{defId,star}` 对象化/轻确认/满星查看态/dismiss 定位产物星级。
- 全量 vitest 1741/1741；tsc 0；三端构建 OK；bundle-clean rc/wechat/e2e PASS；repo-health 9/9；E2E R3 128/128 + ux_r2 160/160 + feedback_r21 184/184；RC 四方一致（dirty=false）。
- ⚠️ infra：bash cwd `/d/…`（小写）→ vitest 模块图 context.ts 双实例 → setup 绑定丢失 → 持久化测试静默假失败；必须 `/D/…` 大写。排查法：setup 哨兵 + `isPlatformCoreBound()` 对照。
- R2.2 电脑录屏体验已确认通过（O1「新获得」文字/O2「点击空白处继续」对比度 = 非阻塞优化项，未开 R2.3）。
- iOS 未验证。

## 5.1 PBL-F0（竖屏战场实验台）
- 独立入口 `portrait-lab.html` + `src/lab/portraitBattleLab/`（constants/state/layout/lab/main）+ `vite.portrait-lab.config.ts`；逻辑基准竖屏 390×844、固定摄像机（复用 `PlayerViewportTransform(390,844)`，零改共享码）；自绘占位舞台，不接正式 Battle Runtime。
- 状态机：Arena A/B、Loadout 西瓜重炮/香蕉冲锋锤、Encounter 追猎者/远程炮台/3轻敌人、Start（幂等）/Reset；running 中切选择项→回 idle。
- 门禁：targeted 25/25、E2E 35/35（1280×720@1 + 700×900@1.5，真实点击+真实 getImageData，dpr=1 像素面积精确 4200/9216/7840）、全量 vitest 1766/1766、tsc 0、三端构建 EXIT 0、bundle-clean PASS、repo-health 9/9。
- 正式代码 0 修改（仅 .gitignore +1 行、package.json +2 script）。

## 5.2 PBL-F1（共享 Loadout / Encounter + Spawn 流程）
- 用户口径裁决：**①** = Loadout 只引用正式库真实存在的件；`履带`→`heavyWheel`（adapted）、`LightSwarm3`→正式模板 `OPP-14` ×3、`磁铁`/`护盾` 正式库不存在 → **unavailable，不引入、不造数值**（`testData.ts` 模块加载时动态校验，将来正式库补上会立刻抛错）。
- 三条正式映射原则：Loadout = 正式 `BuildDraft`；敌人 = 正式 `OPPONENT_TEMPLATES`（`OPP-16` 追猎者 / `OPP-03` 远程炮台 / `OPP-14` 三轻敌人）；数值一律 `buildSnapshotFromDraft`→`validateSnapshot`→`resolveSnapshot`，Lab 零手写数值。
- 新增 `/` 改：`testData.ts`(新) `entities.ts`(新, SpawnPlan+实体/弹丸容器) `scene.ts`(新, 由正式 collider 组装场景) `layout.ts`(分层绘制面积账本 `paintedAreas`) `state.ts`(state 持有 run) `lab.ts`(HUD 带 + 分层绘制)。
- 关键不变量：`buildSpawnPlan(loadout, encounter)` **无 arena 入参** → A/B 必然共用同一基础数据；`plan.baseKey` 指纹只含 HP/质量/能量/伤害/CD/弹丸，不含 arena/team/序号。
- ⚠️ 实测踩坑：HUD 缺口提示文字若用 `#ffd35a`（与 Arena 层同色）→ 文字抗锯齿像素被 E2E 分类器误计 → arena 虚增 ~310px。修法 = 提示色改 `#ff5ee0`（与所有分层色 RGB 互斥）+ E2E 统计区排除 HUD 带（y<140），并加 F1-R25 守卫「HUD 带内不得出现任何分层几何」。
- 门禁：targeted 51/51（F0 26 + F1 25）、E2E 64/64（精确账本：初始 A/西瓜/追猎者 = arena 4200 / playerBody 8360 / playerPart 800 / enemyBody 7618 / enemyPart 1560）、全量 vitest 1792/1792、tsc 0、三端构建 EXIT 0、bundle-clean PASS、repo-health 9/9。正式源码 0 修改。

## 5.3 PBL-A1 先查 → 触发停止（0 行代码）→ 已由 PBL-F2 解除
- R1｜正式战斗层「每队至多一辆车」：`ContactRouter.findVehicleByTeam`（private）是 Impact/Weapon/Projectile/Grounded/hazard 全部路径的反查依据 → 多实体同场必然**静默错记伤害**（全落到第一个同队车）。`PlanckBattleOrchestrator` 只暴露 `vehicleA`/`vehicleB` 且构造即 `new ContactRouter([A,B])` → 无法扩多敌。
- R2｜敌人↔敌人物理碰撞被双重锁死：`createPlanckVehicle` 将 `vehicleMask/vehicleGroup(team)` 烘进全车 fixture——同队 mask **排除己方车辆类别** 且同队同负 group；`PlanckWorld` **无**运行期 fixture 过滤器变更 API。实证：同队两车同坐标步进 1s 后位移 0px、仍完全重叠。
- R3｜`PlanckBattleOrchestrator` 不可用于 Arena A：硬编码重力 `{0,10}` + 无条件 `PlanckArenaRuntime`（phases/刺墙/hazard）且无开关 → 与「俯视/无缩圈/无边界伤害」冲突。
- 设计外使用提示：`drivePlanckVehicle` 电机开关含 `w.grounded`（`planckMovement.ts:65`），该值只由 `ContactRouter.handleGrounded` 维护；无重力俯视场恒 false → Arena A 需 Lab 自供 `grounded` 或自建 topdown 驱动适配（PBL-G1 明文允许 Movement/Physics Adapter 差异）。

## 5.4 PBL-F2 多实体 Foundation（受控版 C，已交付）
- 用户裁决受控版 C：允许改 Battle/Physics 底层「每队 1 辆车」假设，仅限 `prototype-portrait-battle-lab`，不改正式 1v1 流程、不改 Arena/刺墙/Match/Flow、不合回主线。
- `contactRouter.ts`：`resolveVehicle(vehicleId, team)` 规则 = ①vehicleId 唯一命中→该实例；②否则该 team 恰好 1 辆→返回它（旧语义，1v1 等价）；③否则 **undefined 安全跳过**（绝不落到第一个同队车）。全部反查 + Impact/Weapon/activeTick/hazard 的 key 改实例粒度；`projectileHitMeta` 增 `projVehicleId/defVehicleId/defKey`。**DamageEvent source/target 仍是 team → 事件契约零变化。**
- `planckVehicleAssembly.ts`：新增 `PlanckVehicleCollisionPolicy`（`team-exclusive` 缺省=正式语义 / `instance-exclusive`）+ 导出 `resolveVehicleCollisionFilter`；`createPlanckVehicle` 追加**可选第 6 参** → 现有调用点零改动。
- ⚠️ **实例 group 必须避开正式 projectile 占用的 -1/-2**（`weaponProjectile.ts:93`/`cannonBehavior.ts:222`/`laserBehavior.ts:228`），否则出现「某辆敌车对弹丸免疫」的静默 bug → 取 `-(100+i)`。
- 门禁：新测试 7/7（先红 4 failed→后绿）；既有 Contact/Impact/Weapon/Projectile 10 文件 45/45（与改前基线一致）；全量 196 files/1799 passed（基线 195/1792）；tsc 0；五路构建 EXIT 0；bundle-clean 五路 PASS；repo-health 9/9；Lab E2E 64/64。
- 边界（诚实）：Matter 路径 `vehicleAssembly.ts` 的同类硬编码**未改**（生产/微信走 Planck；Matter 无多实体消费者）；`PlanckBattleOrchestrator` 未改造仍严格 1v1，多实体装配由 Lab/测试侧组合 `PlanckWorld + createPlanckVehicle + ContactRouter`。
- ⚠️ 全量 vitest 首跑 `garageFusionResultInteractionR22.test.ts` 9 处 5s 超时 = `vmForks + maxWorkers=1` 负载抖动（该文件与本次改动无引用路径；单跑 11/11、全量重跑全绿），**非回归**；vitest 未设 testTimeout（默认 5s）。

## 5.5 PBL-A1 纵向俯视物理竞技场 A（已交付）
- 全部在 Lab 目录内，**正式代码 0 修改**：`arenaA.ts`（新，1136 行：空间/俯视驱动/脱困/真实几何 SAT/运行时）、`arenaScene.ts`（新，真实快照→分层矩形）、`tests/portraitBattleLabA1.test.ts`（新，24 用例）；改 `lab.ts`（running 时长驻真实运行时 + rAF 推进 + probe）、`entities.ts`（暴露 `snapshot`）、`scene.ts`（注释：A 分支已非 Lab 场景来源）。
- 空间：`ARENA_A_BOUNDS={minX:12, minY:152, maxX:378, maxY:812}`（左/右**让出墙厚 12**、顶墙在 HUD 带下留 `ARENA_A_HUD_CLEARANCE=8`）、零重力、四边静态墙 `restitution 0.05`、hazard `{0,0}`、墙无 OwnerTag → 无刺墙/缩圈/边界伤害。**修掉两个真实缺陷**：①墙伸出舞台 2px 被裁 → 渲染像素≠账本；②顶墙落进 HUD 排除区 → arena 像素少 1560。
- 驱动：**不调用 `drivePlanckVehicle`**、不伪造 `grounded`、不写速度/位置；平移 = 真实 `applyLinearImpulse`（COM、`J=mass×Δv`），转向 = COM±halfWheelbase **等大反向力偶**；能力全由真实轮组 def 推导。实测开火方向 vs 车身前向偏差 0.0021 rad。脱困用**净位移窗口**（瞬时速度检测不触发）。
- 关键口径：`DamageEvent.target` 仍是 **TeamId**（实例不可从事件读）→ A1-20 用逐帧差分 + 伤害守恒 + 「enemy-2 必须掉血」判据；**Cannon 渲染快照无 `velocity`** → 改用 `weaponFire.worldDirection`；`rotatePlanckVehicle` 是**相对**旋转；`driveTopdownVehicle(throttle=0)` 不施加冲量；`SpawnedEntity` 字段是 `entityId`；穿透容差 16px（实测最深 -12.47 @ 相对速度 18px/step 的首次高速对撞）。
- 门禁：targeted 77/77（A1 24 + F0 28 + F1 25）；全量 **197 files / 1825 passed**（= F2 基线 1799 + 24 + R22a-2/R22a-3）；tsc 0；五路构建 EXIT 0；bundle-clean wechat/e2e/lab PASS（未跑 rc 模式：需 clean HEAD 的发布流程）；Lab E2E **84/84**（Arena A 账本 `arena=25200`）；repo-health 9/9。
- 边界：未改 Orchestrator / 正式 1v1 / 平衡数值 / 磁铁·护盾·履带 / Day·Roguelike·Build / Camera 缩放 / 视觉 polish；俯视驱动+边界+hazard=0 全收敛在 `arenaA.ts`（无第二套隐藏物理语义）。

## 5.5 PBL-B1 竖屏侧视 Arena B → **停止条件触发，未实现（0 行代码）**
- 核心实测：竖屏舞台 390 宽，左右实体边界各 12 → 横向接敌轴仅 **366 px**。共享测试车**整车真实 collider 外接框**：`WatermelonHeavyCannon` 205 / `BananaChargeHammer` 249 / `Chaser`(OPP-16) 249 / `RangedTurret`(OPP-03) 205 / `LightSwarm3` 单车(OPP-14) 207.6。
- 1v1 总宽 **410–498**（舞台宽 ×1.13–1.36，缺口 44–132）；1v3 总宽 **828–872**（×2.20–2.32）。**最大分离出生仍互嵌 52–140 px；静止解算后残余 43–124；真实战斗 5s 后仍 46–125**（残余 ≈ 总宽 − 可活动区 = 几何硬约束，非解算失败）。即使忽略武器前伸，`Banana/Chaser` 车身本身仍 +18 放不下。
- 判定：这是「车体放不下」而非「开局贴脸」（后者按 Queue 应保留为结论）。出路全部被禁或无效 → 命中停止条件。
- **未来若重开 B，唯一可行方向 = 放宽「固定竖屏摄像机/不加镜头处理」或「Lab-only 缩小车」——两者都需用户先改边界，不得自行扩大范围。**
- 技术结论（可省一次调研）：B 的正式侧视链路 Lab 内可直接复用且**无需 Lab-local 驱动适配**（`PlanckWorld({0,10})` + 静态 ground/左右墙 + `settlePlanckVehicleToRestPose` + `drivePlanckVehicle` + `ContactRouter.handlePlanckContact` 真实维护 `wheel.grounded` → motor 门控闭合 + `BehaviorRegistry`）；⚠️ 禁复用 `PlanckArenaRuntime`（无条件建左右 Closing 刺墙 + hazard，**无开关**）。

## 5.6 PBL-G1 A/B 对照门禁（已交付）
- ⚠️ 前提纠偏：Queue 写「A/B Runtime 已存在」→ **对 B 不成立**（B1 停止，Arena B 只是 F1 占位舞台）。故 G1 的 A/B 对照只对 A 成立。
- 新增 `src/lab/portraitBattleLab/gate.ts`（纯逻辑，无 DOM/fs）：`PBL_ALLOWED_ARENA_DIFFERENCES`（恰好 3 类：arena-geometry / physics-interpretation / movement-adapter，每类带落点文件+符号）、`auditSharedCombatData()`（6 组合，全部战斗数值用**正式链路独立重算**逐字段比对 → 0 差异）、`PBL_ARENA_RUNTIMES`（**可用性唯一来源**，目前只有 A）、`gateStepPlan()`、`gateResidue()`、`gateSummary()`。
- 关键设计：**Arena B 的 blocked 是「派生」而非写死** —— 哪天 B 真实现，只需把运行时加进 `PBL_ARENA_RUNTIMES`，blocked→ready 自动生效；blocked 时 `plan=null`（绝不伪造可运行的 B 战斗），Lab 不 Start。
- Lab：`Gate 下一步`（按 Queue 6 步固定顺序切配置 → 立刻核对零残留 → 有运行时才 Start）/`Gate 清空`；DOM 面板（**必须在 canvas 之外**，否则污染 E2E 分层像素分类）；probe 增 `gate`；Reset 一并清游标。第 5/6 步 Queue 未写 Loadout → 沿用香蕉冲锋锤并在 `assumed` 显式暴露。
- 守卫：G1-04「arena 键控数值表」登记制（目前仅 `ARENA_PILLAR_H`，新增未登记表即失败）；G1-06 **反向验证**（就地改写 HP/CD/质量必须被抓出，证明审计非空转）；G1-07 共享数据文件 `entities.ts`/`testData.ts` 剥注释后 **0 处 arena 字面量**。
- 门禁：G1 18/18；Lab targeted 95/95；相关回归 30 files/138；全量 **198 files / 1843 passed**（基线 197/1825 +1 文件 +18）；tsc 0；五路构建 EXIT 0；bundle-clean 三路 PASS；E2E **148/148**（84→148，+64）；repo-health 9/9。正式源码 0 修改。

## 6. Next action
- NEXT: PBL-F0→F1→F2→A1→B1(停止)→**G1(已交付)** 序列**全部执行完毕**，用户明令「完成后停止全部开发」→
  **停等回执**，不得自行开 Build / Roguelike 下一阶段。B1 三选项（B1-A 确认停止 / B1-B 放宽镜头边界 /
  B1-C Lab-only 缩小车）仍未裁决 —— 只有选 B1-B 或 B1-C 才可能让 Arena B 存在，届时把运行时加进
  `PBL_ARENA_RUNTIMES` 即自动解除 G1 的 3 个 blocked 步骤。
- Low-prio: KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01; mobile drive slot (F-GARAGE-TOUCH-ASSEMBLY-R2); strip-scroll no clamp; O1/O2 非阻塞优化项。
