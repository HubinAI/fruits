/**
 * PBL-F0 / PBL-F1｜竖屏战场实验台（Portrait Battle Lab）基础常量与 id 契约。
 *
 * PRP-F0 起本目录同时承载两个原型（仍在同一块可整块删除的实验目录内）：
 *   - **PRP｜Portrait Run Prototype** —— 玩家页面 `run-page.html`
 *     （`runPage*.ts` / `runMain.ts` / `runVehicleAssets.ts`：单一 Run Page +
 *      五状态切换 + 自然语言冒险记录 + 真实车辆 sprite + 选择浮层）；
 *     ⚠️ PRP-F1 起，中部舞台的**遭遇/战斗/结果**三个阶段接入的是
 *     **旧正式左右侧视 Planck 战斗本身**（`runBattleRuntime.ts` = 正式
 *     `PlanckBattleOrchestrator` 的薄适配；`runBattleView.ts` = 正式 `Renderer` +
 *     固定远摄相机 + 舞台带贴图）。PRP 在战斗里只负责：生命周期接线 / camera transform /
 *     clip / HP 展示 / result → Run Page state，**不含任何 gameplay 数值或演出脚本**。
 *   - **PBL｜Portrait Battle Lab** —— **DEBUG ONLY** control area `portrait-lab.html`
 *     （`lab.ts` / `main.ts` / `arenaA.ts` / `gate.ts` …：Arena / Loadout / Encounter / Gate）。
 *   两者共享本文件的竖屏 390×844 基准与 F1 测试数据，但玩家页面**不引用**任何 Debug 控制器。
 *
 * ⚠️ PRP-R1-ACTUAL-RUNTIME-ENTRY-LAYOUT-FIX：玩家体验入口**只有** `run-page.html` 一个；
 *    `portrait-lab.html` 是开发/调试面（页面右上角有 DEBUG ONLY 角标、标题写明非体验入口），
 *    对应 npm script 已从 `dev:portrait-lab` 改名为 `dev:debug-lab`，防止再被当作体验入口打开。
 *
 * PBL-F1 起本实验台允许**只读引用**正式内容库来建立 A/B 共用的测试数据
 * （见 testData.ts / entities.ts）：Lab 不复制、不覆盖任何平衡数值，
 * 所有 HP / 伤害 / CD / 射程 / 质量 / 能量一律由正式 registry 解析得出。
 * 反向仍然严格禁止：正式 Home / Garage / Matching / Battle / Result 与四个正式
 * 构建入口 0 引用本目录（tests/portraitBattleLab*.test.ts 的隔离守卫）。
 *
 * 逻辑基准：竖屏 390×844（宽×高），固定摄像机（无动态 reframe）。
 *
 * 删除清单（整块移除本实验）：
 *   1) 本目录 src/lab/portraitBattleLab/（全部文件）
 *   2) 根目录 portrait-lab.html、run-page.html、next-run.html、encounter-lab.html、
 *      validation-hub.html、content-batch.html
 *      ⚠️ PRODUCT-LOOP-R1-A 起，实验分支上又多了两个**产品**层面的文件，
 *         它们**不在**本目录内，也不属于本实验台的删除范围（删的是实验台，
 *         不是产品）：根目录 `home.html` + `src/product/` + `tests/productLoopHomeGarage.test.ts`
 *         + `tests/_e2e_product_home.cjs`。它们只复用正式存档与正式美术，不引用本目录。
 *   3) 根目录 vite.portrait-lab.config.ts
 *   4) tests/portraitBattleLab.test.ts、tests/portraitBattleLabF1.test.ts、
 *      tests/portraitBattleLabA1.test.ts、tests/portraitBattleLabG1.test.ts、
 *      tests/portraitRunPage.test.ts、tests/portraitRunBattle.test.ts、
 *      tests/portraitNextRunValidation.test.ts、tests/portraitEncounterLab.test.ts、
 *      tests/portraitValidationHub.test.ts、tests/portraitContentBatch.test.ts、
 *      tests/portraitLightSwarmExperience.test.ts、
 *      tests/_e2e_portrait_battle_lab.cjs、tests/_e2e_run_page.cjs、
 *      tests/_e2e_next_run.cjs、tests/_e2e_encounter_lab.cjs、
 *      tests/_e2e_validation_hub.cjs、
 *      tests/_e2e_prp_default_entry.cjs
 *   5) package.json 中 dev:run-page / dev:next-run / dev:encounter-lab / dev:validation /
 *      dev:content-batch / dev:debug-lab / build:portrait-lab / e2e:portrait-lab /
 *      e2e:run-page / e2e:next-run / e2e:encounter-lab / e2e:validation-hub /
 *      e2e:default-entry 等 script
 *   6) .gitignore 中 dist-portrait-lab/ 一行
 * 正式玩法 / 物理 / 数值 / Garage / Fusion / R4 / Meta / 存档 / 经济均不在删除影响面内。
 *
 * ⚠️ PRP-R3 起本目录只**只读**引用正式车辆美术（`assets/visuals/*.png`）与正式
 *   纯几何换算 `battle/battleContract.visualWorldTransform`；两者都是共享真源，
 *   删除本目录**不得**牵动它们（正式玩法路径 0 引用本目录，见 R22b/R23）。
 */

/** 竖屏逻辑舞台宽（逻辑 px）—— Lab 全部布局与占位几何的唯一坐标基准。 */
export const PORTRAIT_LOGICAL_W = 390;

/** 竖屏逻辑舞台高（逻辑 px）。 */
export const PORTRAIT_LOGICAL_H = 844;

/** Arena 标识（A / B 对照）。 */
export type LabArenaId = 'A' | 'B';

export interface LabArenaDef {
  readonly id: LabArenaId;
  readonly label: string;
  /** 空间模型的真实实现属于 PBL-A1 / PBL-B1；本实验台只负责「同一入口切换」。 */
  readonly note: string;
}

export const LAB_ARENAS: readonly LabArenaDef[] = [
  { id: 'A', label: 'Arena A', note: '纵向俯视 · PBL-A1 实现' },
  { id: 'B', label: 'Arena B', note: '侧视平地 · PBL-B1 实现' },
];

/**
 * PBL-F1｜两套共享 Test Loadout 的规范 id（A / B 共用同一套）。
 * 中文展示名见 testData.ts（西瓜重炮 / 香蕉冲锋锤）。
 */
export type LabLoadoutId = 'WatermelonHeavyCannon' | 'BananaChargeHammer';

/**
 * PBL-F1｜共享 Encounter 的规范 id（A / B 共用同一套）。
 * 中文展示名见 testData.ts（追猎者 / 远程炮台 / 3 轻敌人 / 菠萝冲刺车）。
 *
 * `ProtoRusher` = PRP-RUN-R1 的 **Build Prototype Encounter**（见 testData.ts 的说明）。
 *
 * ⚠️ PRP-RUN-02：新增三套**单敌** Encounter（`PineappleFireBrute` / `PineappleSawRusher` /
 *    `BananaRodLaser`），全部只是**既有正式对手模板**的引用（OPP-29 / OPP-31 / OPP-20），
 *    用来给固定 Run Script 组成四场压力阶梯 —— **没有新增敌人、没有改任何数值**。
 *    为什么不复用既有的 `Chaser` / `RangedTurret` / `LightSwarm3`：见 testData.ts 的普查注释
 *    （`Chaser` 在部分 Build 下会一击必杀、`RangedTurret` 对基础 Build 必杀、
 *     `LightSwarm3` 的展示名写明「3 个敌人」而 Run Page 战斗只能容纳 1 个敌人）。
 *
 * ⚠️ PRP-M3：新增**遭遇验证台**入口 `encounter-lab.html`（`encounterLab*.ts`），
 *    它从下表里固定挑三套做集中对照（`ProtoRusher` / `Chaser` / `RangedTurret`，
 *    见 `encounterValidation.ts` 的 `ENCOUNTER_BATCH_IDS`）—— **不新增敌人、不改任何定义、
 *    不做平衡**；同一个玩家车（`WatermelonHeavyCannon`）只换对手。
 *
 * ⚠️ PRP-VALIDATION-HUB-R1：新增**验证中心**入口 `validation-hub.html`
 *    （`validationHub.ts` = 三个入口的唯一数据源；`validationHubMain.ts` = 页面壳）。
 *    它把 `run-page.html` / `next-run.html` / `encounter-lab.html` 三个验证入口摆到一页上，
 *    **只做导航**：页面上没有画布、不显示任何运行期数据，也不向任何入口页面注入控件
 *    （切换 = 整页导航到入口页面本身，旧验证的一切随文档销毁）。
 *    ⚠️ 它**不**拥有新的战斗 / 物理 / 数值；删除本目录时它一起消失，不影响任何正式路径。
 *
 * ⚠️ PRP-M3-CONTENT-BATCH-01：新增**内容批次验证台**入口 `content-batch.html`
 *    （`contentBatch.ts` = 纯逻辑层；`contentBatchMain.ts` = 页面壳，**没有画布**）。
 *    三项内容：多单位轻敌群 / 废弃修理站 / 路边改装件。**不开发任何 Foundation**：
 *    两项非战斗事件只改「现有耐久 / 现有 Build」（维修量沿用 `EMERGENCY_REPAIR_FRACTION`、
 *    候选池沿用 `runLateralPoolDefs`）。
 *    ⚠️ 第 1 项（多单位）如实标记 **BLOCK**：正式 `PlanckBattleOrchestrator` 硬编码两车
 *    （`vehicleA` / `vehicleB`）、胜负只有 A / B 两方，而 `runBattleRuntime.ts` 只取
 *    `plan.enemies[0]` —— 多单位进不了「真实 Battle Runtime」；本 Queue 不为此新建多车宿主。
 *
 * ⚠️ PBL-M3-LIGHT-SWARM-EXPERIENCE-VALIDATION-R1：Content A 的 BLOCK 之后，真人裁决为
 *    「先用**已经存在**的 Arena A 真实多实体能力验证体验是否值得正式开发」。
 *    ⇒ 本目录**不新建 Runtime、不新建页面**，只在 Lab 工具栏加一个**一键验证入口**
 *    （`PBL_LIGHT_SWARM_VALIDATION`，见文件末尾），复用的全部是既有能力：
 *    `PlanckWorld` / `createPlanckVehicle(instance-exclusive)` / `ContactRouter` /
 *    `DamageResolver` / 正式 `BehaviorRegistry` 武器行为 + 既有 `LightSwarm3`（`count: 3`）。
 *    ⚠️ 页面标记 `EXPERIENCE VALIDATION ONLY` / 非正式 Run Runtime（见 `lab.ts` 的验证条幅）；
 *    Lab 页面本来就是 DEBUG ONLY，本入口**不得**被当作正式 Run Runtime 的证据。
 */
export type LabEncounterId =
  | 'Chaser'
  | 'RangedTurret'
  | 'LightSwarm3'
  | 'ProtoRusher'
  | 'PineappleFireBrute'
  | 'PineappleSawRusher'
  | 'BananaRodLaser';

/** Lab 初始选择（实验台自身默认值；与正式玩法默认值无任何耦合）。 */
export const LAB_DEFAULTS: {
  readonly arena: LabArenaId;
  readonly loadout: LabLoadoutId;
  readonly encounter: LabEncounterId;
} = {
  arena: 'A',
  loadout: 'WatermelonHeavyCannon',
  encounter: 'Chaser',
};

/* ==========================================================================
 * PBL-M3-LIGHT-SWARM-EXPERIENCE-VALIDATION-R1｜体验验证组合（**唯一数据源**）
 *
 * 目标只有一个：用 Arena A **已经存在**的真实多实体能力，验证「3 个弱敌同时出现」
 * 这个体验是否值得正式开发 —— **不是**补正式 1vN 能力。
 *
 * 本 Queue 的硬边界（写进代码，避免以后被当成正式能力）：
 *   - 页面 = DEBUG 的 `portrait-lab.html`（本文件上文已声明其非玩家入口身份）；
 *   - 复用 `LightSwarm3`（`testData.ts`：正式模板 OPP-14 × 3，**不新增敌人、不改任何数值**）；
 *   - 玩家固定 `WatermelonHeavyCannon`，**第一轮无 Buff**（Lab 无 Modifier 层 → 天然无强化）；
 *   - 不修改 `planckBattleOrchestrator` / `runBattleRuntime`；不做 N 方正式胜负；
 *     不做正式 Camera 适配；不接 Run；不新增 Foundation（Queue 原文禁止清单）。
 *
 * ⚠️ 可选 A/B（第二个玩家 `Twin Cannon`）**本轮未做** —— 如实披露，不静默省略：
 *    `twinCannon` 是 Run 的**第一层强化**（`runModifiers.ts:95` 的 `Layer1ModifierId`，
 *    效果 = `burstRounds 1→2` + `burstIntervalMs 0→100`），**不是可装配部件** ——
 *    在正式内容库里查无此件（`src/core` / `src/player` / `src/game` / `src/ui` 全域 0 命中）。
 *    Lab 的 `LAB_LOADOUTS` 是 `BuildDraft`（部件级），**没有 Modifier / Buff 层**；
 *    要在 Arena A 复现「多发」只能给 Lab 新增 Modifier 覆盖入口 = 新增能力
 *    （等于在 Lab 里重建一套 `runModifiers` 语义）⇒ 按 Queue 原文
 *    「如果需要额外重构，则不要做，保持单玩家版本」。
 * ========================================================================== */

/** 体验验证入口的声明式配置（页面 / 测试 / E2E 都从这一处读，不各写一份）。 */
export interface PblLightSwarmValidationDef {
  /** 归属 Queue（页面如实展示，避免与正式 Run Runtime 混淆）。 */
  readonly queueId: string;
  /** 一键进入的组合（全部是 Lab 既有 id，不做任何特殊化）。 */
  readonly arena: LabArenaId;
  readonly loadout: LabLoadoutId;
  readonly encounter: LabEncounterId;
  /** 入口按钮文案。 */
  readonly label: string;
  /** 页面必须明确标记的两行（Queue 必改 3）。 */
  readonly badgeTitle: string;
  readonly badgeSubtitle: string;
  /** 真人只回答这一个问题（Queue 原文）。 */
  readonly question: string;
  /** 可选 A/B 未做的如实披露（页面展示用；完整理由见上方注释）。 */
  readonly abNotDone: string;
}

export const PBL_LIGHT_SWARM_VALIDATION: PblLightSwarmValidationDef = {
  queueId: 'PBL-M3-LIGHT-SWARM-EXPERIENCE-VALIDATION-R1',
  arena: 'A',
  loadout: 'WatermelonHeavyCannon',
  encounter: 'LightSwarm3',
  label: '3 弱敌·体验验证',
  badgeTitle: 'EXPERIENCE VALIDATION ONLY',
  badgeSubtitle: '非正式 Run Runtime',
  question: '面对 3 个弱敌，战斗问题是否明显从「打赢一辆车」变成了「处理数量与拥挤」？',
  abNotDone:
    'A/B（Twin Cannon）未做：Lab 无 Modifier 层，twinCannon 是 Run 的第一层强化而非可装配部件 ⇒ 保持单玩家版本',
};
