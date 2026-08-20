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
];
