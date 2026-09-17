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
 *   2) 根目录 portrait-lab.html、run-page.html、next-run.html、encounter-lab.html
 *   3) 根目录 vite.portrait-lab.config.ts
 *   4) tests/portraitBattleLab.test.ts、tests/portraitBattleLabF1.test.ts、
 *      tests/portraitBattleLabA1.test.ts、tests/portraitBattleLabG1.test.ts、
 *      tests/portraitRunPage.test.ts、tests/portraitRunBattle.test.ts、
 *      tests/portraitNextRunValidation.test.ts、tests/portraitEncounterLab.test.ts、
 *      tests/_e2e_portrait_battle_lab.cjs、tests/_e2e_run_page.cjs、
 *      tests/_e2e_next_run.cjs、tests/_e2e_encounter_lab.cjs、
 *      tests/_e2e_prp_default_entry.cjs
 *   5) package.json 中 dev:run-page / dev:next-run / dev:encounter-lab / dev:debug-lab /
 *      build:portrait-lab / e2e:portrait-lab / e2e:run-page / e2e:next-run /
 *      e2e:encounter-lab / e2e:default-entry 等 script
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
