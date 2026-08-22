/**
 * Queue Q15-UI-R2-RECOVER｜玩家 Shell 可见性回归（纯函数层，node 环境）。
 *
 * 覆盖根因 Bug：5 个元素 CSS 默认 display:none（matchBar 默认 flex），
 * 显示分支绝不能用 ''（会回退 CSS 的 none → 元素永远不可见）。
 * 这里直接断言 computePlayerShellVisibility 在三种玩家阶段返回的明确 display，
 * 并加一条「任何 visible 值都不是 ''」的回归护栏。
 */
import { describe, it, expect } from 'vitest';
import { computePlayerShellVisibility, type PlayerShellVisibility } from '../src/ui/playerShell';

describe('Q15-UI-R2-RECOVER 玩家 Shell 可见性', () => {
  it('Garage：我的战车 + Dock 可见，Matching/MatchPreview 元素隐藏', () => {
    const v = computePlayerShellVisibility('build', 'editing', 'garage');
    expect(v.playerTop).toBe('flex'); // 「我的战车」可见
    expect(v.garageDock).toBe('flex'); // 底部 Dock（含「寻找对手」）可见
    expect(v.matchingVs).toBe('none');
    expect(v.matchInfo).toBe('none');
    expect(v.matchBar).toBe('none');
  });

  it('Matching：我的战车 + 中央 VS 可见，Dock/MatchPreview 元素隐藏', () => {
    const v = computePlayerShellVisibility('build', 'editing', 'matching');
    expect(v.playerTop).toBe('flex');
    expect(v.garageDock).toBe('none');
    expect(v.matchingVs).toBe('block'); // 中央 VS 可见
    expect(v.matchInfo).toBe('none');
    expect(v.matchBar).toBe('none');
  });

  it('MatchPreview：我的战车 + 信息层 + 复核条可见，Dock/VS 隐藏', () => {
    const v = computePlayerShellVisibility('build', 'editing', 'matchPreview');
    expect(v.playerTop).toBe('flex');
    expect(v.garageDock).toBe('none');
    expect(v.matchingVs).toBe('none');
    expect(v.matchInfo).toBe('flex'); // 我的战车 VS 对手 信息层可见
    expect(v.matchBar).toBe('flex'); // 调整配置 / 开始战斗 可见
  });

  it('回归护栏：任何可见值都不允许空字符串（防止回退 CSS display:none）', () => {
    const phases = ['garage', 'matching', 'matchPreview'] as const;
    for (const p of phases) {
      const v = computePlayerShellVisibility('build', 'editing', p);
      for (const key of Object.keys(v) as Array<keyof PlayerShellVisibility>) {
        expect(v[key], `阶段 ${p} 的 ${key} 不应为 ''（会回退 CSS none）`).not.toBe('');
      }
    }
  });

  it('非玩家态隐藏整个 Shell：Scenario / Fighting / Ended 全部 none', () => {
    expect(computePlayerShellVisibility('scenario', 'editing', 'garage')).toEqual({
      playerTop: 'none',
      garageDock: 'none',
      matchingVs: 'none',
      matchInfo: 'none',
      matchBar: 'none',
    });
    expect(computePlayerShellVisibility('build', 'fighting', 'matchPreview')).toEqual({
      playerTop: 'none',
      garageDock: 'none',
      matchingVs: 'none',
      matchInfo: 'none',
      matchBar: 'none',
    });
    expect(computePlayerShellVisibility('build', 'ended', 'matchPreview')).toEqual({
      playerTop: 'none',
      garageDock: 'none',
      matchingVs: 'none',
      matchInfo: 'none',
      matchBar: 'none',
    });
  });
});
