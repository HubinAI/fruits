/**
 * F-DEV-1：玩家 Build 部件选项唯一数据源（独立模块，供 UI 与测试共用）。
 * 装配页挂点选择区只允许从这里取值。
 *
 * Q10-B：玩家侧统一中文名（炮/锤/推杆）；内部 defId 不变。
 * Q11-R1：正式接入 Q11 部件（刺/镭射）——与炮/锤/推杆同一套挂点选择、
 * Energy、Validator、Preview 流程（无专属槽）。
 * Q11-A-CLOSE：固定被动楔铲连续多轮真人验收失败（对方前轮/前置部件
 * 优先阻挡楔面，「钻底盘→明显抬升」核心体验不稳定成立）→ 退出正式
 * Build。registry / Q11 专用 Scenario / 测试代码保留为 archived
 * prototype（content.ts wedgeShovel 与 polygon/collision 能力未删）。
 */
import { EMPTY_SLOT } from '../lab/buildEditorModel';

export interface PartOption {
  v: string;
  t: string;
}

export const PART_OPTIONS: PartOption[] = [
  { v: EMPTY_SLOT, t: '空' },
  { v: 'cannon', t: '炮' },
  { v: 'hammer', t: '锤' },
  { v: 'pushRod', t: '推杆' },
  { v: 'spear', t: '刺' },
  { v: 'laser', t: '镭射' },
  // Q12-A-HOLD（prototype/hold）：冲撞头（ramHead）暂退正式 Build。
  //   技术成立，但真人录像无独立动作/明显物理结果，与普通车头碰撞差异太弱；
  //   故从玩家装配页移除。registry / Q12-A Scenario / Contact Runtime / 测试保留，
  //   标记 prototype/hold，不修改其底层 ram Contact 能力，方便以后重做冲撞类内容。
  // Q12-B-CLOSE（prototype/hold）：举升臂（lifter）退出正式 Build。
  //   真人正常速度下对手仅轻微短暂抬头，「机械臂→明显举起对手」战斗作用不成立；
  //   故从玩家装配页移除。registry / LifterBehavior / Q12-B Scenario / 测试保留，
  //   标记 prototype/hold；底层 Revolute Gadget 能力不修改，供后续机制复用。
  // Q12-C：伸缩冲锤 Weapon（Prismatic 伸出撞击，真实 Contact 伤害）
  { v: 'rammer', t: '冲锤' },
];
