/**
 * F-WX-5｜装配预览（Garage / Matching / MatchPreview）共享配置。
 *
 * Web（PhysicsLab.loadCustomPreview）与微信（WechatBattleHost.loadCustomPreview）
 * 复用同一份预览 BattleConfig，保证两个平台的装配预览视觉/语义完全一致；
 * 禁止两份独立配置漂移（Q06-UX-R2-FIX 近距出生位语义见 physicsLab 注释）。
 */
import type { BattleConfig } from './battleContract';

/** 装配预览专用：planck 引擎 + autoDrive:false（不驱动、Behavior 不运行，只显示组装）；
 *  近距出生位让完整 A+B 不裁切前提下自然放大（y=640 沿用正式地面语义）。 */
export const PREVIEW_BATTLE_CONFIG: BattleConfig = {
  autoDrive: false,
  engine: 'planck',
  spawnA: { x: 620, y: 640, facing: 1 },
  spawnB: { x: 980, y: 640, facing: -1 },
};
