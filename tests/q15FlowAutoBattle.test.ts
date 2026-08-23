/**
 * Queue Q15-FLOW-R1-ATOMIC｜匹配完成直接开战 —— 最小回归护栏（源码级断言）。
 *
 * main.ts 含 DOM/canvas/音频副作用，无法在 node 环境导入；本测试以源码级断言守护
 * 「goToMatchPreview 隐藏复核条 + 250ms 自动调用现有 startBattleWithReady + 状态 guard」，
 * 防止将来误删自动开战链 / 让「调整配置 / 开始战斗」重现 / 复制第二套 READY-Battle 逻辑。
 * 纯只读，不新增 dependency / production hook。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAIN = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');

/** 取函数体（到下一个 '\nfunction ' 为止；goToMatchPreview/renderMatchInfo 同级） */
function fnBody(name: string): string {
  const start = MAIN.indexOf(`function ${name}(`);
  expect(start, `main.ts 应包含 function ${name}(`).toBeGreaterThan(-1);
  const next = MAIN.indexOf('\nfunction ', start + 10);
  return MAIN.slice(start, next === -1 ? undefined : next);
}

describe('Q15-FLOW-R1-ATOMIC 匹配完成直接开战', () => {
  const preview = fnBody('goToMatchPreview');

  it('goToMatchPreview 内隐藏 matchBar（正常流程不再出现 调整配置/开始战斗）', () => {
    // F-WX-3：matchBar 显隐收进 PlayerUIHost（matchBarHidden 状态驱动）；
    // goToMatchPreview 设置 matchBarHidden=true 保证复核条永不闪现（行为与旧直接
    // matchBar.style.display='none' 等价，但 DOM 不再散落 main.ts）。
    expect(preview).toContain('matchBarHidden = true');
    const host = readFileSync(
      fileURLToPath(new URL('../src/ui/webDomPlayerUIHost.ts', import.meta.url)),
      'utf8',
    );
    expect(host).toContain(`state.matchBarHidden ? 'none' : vis.matchBar`);
  });

  it('约 250ms 后自动调用现有 startBattleWithReady（不复制第二套 READY/Battle 逻辑）', () => {
    expect(preview).toContain('startBattleWithReady()');
    expect(preview).toContain('}, 250);');
  });

  it('自动启动带 guard：仅 matchPreview + editing 才启动，否则 no-op', () => {
    expect(preview).toMatch(
      /playerPhase\s*!==\s*'matchPreview'\s*\|\|\s*battleState\s*!==\s*'editing'/,
    );
  });

  it('startBattleWithReady 仍是单一现有实现（未被复制）', () => {
    const matches = MAIN.match(/function startBattleWithReady\(/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('Result「下一场」仍复用 startMatching（自然变为 下一场→Matching→锁定→自动开战）', () => {
    const next = fnBody('nextMatch');
    expect(next).toContain('startMatching()');
  });

  it('Result「调整配置」仍回 Garage（onResultAdjust 接线不变；首轮引导在此结束）', () => {
    // F-WX-3：按钮接线收进 Host（btnAdjust → onResultAdjust action）；
    // 「完成首轮引导 + 回 Garage」判定仍在 main.ts（onResultAdjust），
    // 不得退化为直接 adjustConfig（那会跳过完成引导的判定）。
    expect(MAIN).toMatch(
      /onResultAdjust:\s*\(\)\s*=>\s*\{[\s\S]*?\bcompleteOnboarding\(\);[\s\S]*?\badjustConfig\(\);/,
    );
    const host = readFileSync(
      fileURLToPath(new URL('../src/ui/webDomPlayerUIHost.ts', import.meta.url)),
      'utf8',
    );
    expect(host).toMatch(
      /btnAdjust\.onclick\s*=\s*\(\)\s*=>\s*this\.actions\?\.onResultAdjust\(\);/,
    );
  });
});
