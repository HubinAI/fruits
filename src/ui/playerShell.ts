/**
 * Q15-UI-R2-RECOVER：玩家 Shell 可见性纯决策（与 DOM 解耦，便于单测）。
 *
 * 关键 Bug 背景：这 5 个元素在 CSS 中默认 `display:none`（playerTop / garageDock /
 * matchingVs / matchInfo），matchBar 默认 `display:flex`（className=start-bar）。
 * 显示时若用 `style.display = ''`，会**移除内联样式并回退到 CSS 的 none**，
 * 导致元素永远不可见（真人录像即「只有车 + 开发工具」）。
 *
 * 因此本模块所有「显示」分支都返回**明确 display 字符串**，绝不返回 ''。
 */

export type UiMode = 'build' | 'scenario';
export type BattleState = 'editing' | 'fighting' | 'ended';
export type PlayerPhase = 'garage' | 'matching' | 'matchPreview';

export interface PlayerShellVisibility {
  /** 顶部状态条（我的战车 / 正在寻找对手… / 对手已找到） */
  playerTop: string;
  /** 底部装配 Dock（槽位 chip + 能量 + 寻找对手 CTA），仅 Garage */
  garageDock: string;
  /** 中央 VS 大字，仅 Matching */
  matchingVs: string;
  /** 我的战车 VS 对手 信息层，仅 MatchPreview */
  matchInfo: string;
  /** 调整配置 / 开始战斗 复核条，仅 MatchPreview */
  matchBar: string;
}

/**
 * 计算玩家 Shell 5 个元素的 display。
 * 玩家 Shell 仅在「装配编辑态」（uiMode=build 且 battleState=editing）可见；
 * Fighting/Ended 由战场 + Battle HUD + 结算卡接管；Scenario 由开发工具接管。
 */
export function computePlayerShellVisibility(
  uiMode: UiMode,
  battleState: BattleState,
  playerPhase: PlayerPhase,
): PlayerShellVisibility {
  const devView = uiMode === 'scenario';
  const inPlayer = !devView && battleState === 'editing';

  return {
    // playerTop：flex 横向居中（CSS align/justify 已配置）
    playerTop: inPlayer ? 'flex' : 'none',
    // garageDock：flex 纵向列（CSS flex-direction:column 已配置），仅 Garage
    garageDock: inPlayer && playerPhase === 'garage' ? 'flex' : 'none',
    // matchingVs：block（绝对定位居中，不需 flex 子布局）
    matchingVs: inPlayer && playerPhase === 'matching' ? 'block' : 'none',
    // matchInfo：flex 居中（CSS align/justify 已配置）
    matchInfo: inPlayer && playerPhase === 'matchPreview' ? 'flex' : 'none',
    // matchBar：flex 横向居中（CSS justify/align 已配置）
    matchBar: inPlayer && playerPhase === 'matchPreview' ? 'flex' : 'none',
  };
}
