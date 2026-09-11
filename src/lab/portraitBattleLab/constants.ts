/**
 * PBL-F0-PORTRAIT-BATTLE-LAB-FOUNDATION｜竖屏战场实验台（Portrait Battle Lab）常量目录。
 *
 * 这是一个**独立、可整块删除**的实验环境：本目录只服务 Arena A / B 对照验证的
 * 「入口 + 状态切换」，不实现任何真实 A/B 战斗规则，不接入正式 Battle Runtime，
 * 也不被正式 Home / Garage / Matching / Battle / Result 引用。
 *
 * 逻辑基准：竖屏 390×844（宽×高），固定摄像机（无动态 reframe）。
 *
 * 删除清单（整块移除本实验）：
 *   1) 本目录 src/lab/portraitBattleLab/（全部文件）
 *   2) 根目录 portrait-lab.html
 *   3) 根目录 vite.portrait-lab.config.ts
 *   4) tests/portraitBattleLab.test.ts、tests/_e2e_portrait_battle_lab.cjs
 *   5) package.json 中 dev:portrait-lab / build:portrait-lab 两条 script
 *   6) .gitignore 中 dist-portrait-lab/ 一行
 * 正式玩法 / 物理 / 数值 / Garage / Fusion / R4 / Meta / 存档 / 经济均不在删除影响面内。
 */

/** 竖屏逻辑舞台宽（逻辑 px）—— Lab 全部布局与占位几何的唯一坐标基准。 */
export const PORTRAIT_LOGICAL_W = 390;

/** 竖屏逻辑舞台高（逻辑 px）。 */
export const PORTRAIT_LOGICAL_H = 844;

/** Arena 标识（本 Queue 仅 A / B 两个占位）。 */
export type LabArenaId = 'A' | 'B';

export interface LabArenaDef {
  readonly id: LabArenaId;
  readonly label: string;
  /** 占位说明 —— Arena A/B 的真实规则属于后续 Queue，本 Queue 不实现。 */
  readonly note: string;
}

/** Arena 占位目录（对照 A / B；本 Queue 只做切换，不实现规则）。 */
export const LAB_ARENAS: readonly LabArenaDef[] = [
  { id: 'A', label: 'Arena A', note: '占位 · 待定义' },
  { id: 'B', label: 'Arena B', note: '占位 · 待定义' },
];

export interface LabLoadoutDef {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  /** 占位车辆轮廓（仅 Lab 表现用；不读正式 Build / Content / 库存）。 */
  readonly body: { readonly w: number; readonly h: number };
}

/** Loadout 占位目录（真实 Build 装配不在本 Queue 范围；仅切换标签 + 占位轮廓）。 */
export const LAB_LOADOUTS: readonly LabLoadoutDef[] = [
  { id: 'watermelon-cannon', label: '西瓜重炮', note: '占位 · 宽体', body: { w: 140, h: 56 } },
  { id: 'banana-hammer', label: '香蕉冲锋锤', note: '占位 · 高体', body: { w: 90, h: 96 } },
];

export interface LabEncounterDef {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  /** 占位标记数量（表现层标记数；不代表任何真实生成 / AI 逻辑）。 */
  readonly enemyCount: number;
  /** 占位标记边长（逻辑 px）。 */
  readonly markerSize: number;
  /** 占位标记离地高度（逻辑 px）—— 远程炮台抬高以在视觉上区别于地面目标。 */
  readonly markerLift: number;
}

/** Encounter 占位目录（真实敌人 AI / 生成 / 波次不在本 Queue 范围）。 */
export const LAB_ENCOUNTERS: readonly LabEncounterDef[] = [
  { id: 'stalker', label: '追猎者', note: '占位 · 单目标', enemyCount: 1, markerSize: 96, markerLift: 0 },
  { id: 'turret', label: '远程炮台', note: '占位 · 固定点', enemyCount: 1, markerSize: 76, markerLift: 120 },
  { id: 'three-light', label: '3 轻敌人', note: '占位 · 三目标', enemyCount: 3, markerSize: 52, markerLift: 0 },
];

/** Lab 初始选择（实验台自身的默认值；与正式玩法默认值无任何耦合）。 */
export const LAB_DEFAULTS: {
  readonly arena: LabArenaId;
  readonly loadout: string;
  readonly encounter: string;
} = {
  arena: 'A',
  loadout: LAB_LOADOUTS[0].id,
  encounter: LAB_ENCOUNTERS[0].id,
};
