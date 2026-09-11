/**
 * PBL-F0 / PBL-F1｜竖屏战场实验台（Portrait Battle Lab）基础常量与 id 契约。
 *
 * 这是一个**独立、可整块删除**的实验环境（Arena A / B 对照验证共用同一入口）。
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
 *   2) 根目录 portrait-lab.html
 *   3) 根目录 vite.portrait-lab.config.ts
 *   4) tests/portraitBattleLab.test.ts、tests/portraitBattleLabF1.test.ts、
 *      tests/_e2e_portrait_battle_lab.cjs
 *   5) package.json 中 dev:portrait-lab / build:portrait-lab 两条 script
 *   6) .gitignore 中 dist-portrait-lab/ 一行
 * 正式玩法 / 物理 / 数值 / Garage / Fusion / R4 / Meta / 存档 / 经济均不在删除影响面内。
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
 * PBL-F1｜三套共享 Encounter 的规范 id（A / B 共用同一套）。
 * 中文展示名见 testData.ts（追猎者 / 远程炮台 / 3 轻敌人）。
 */
export type LabEncounterId = 'Chaser' | 'RangedTurret' | 'LightSwarm3';

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
