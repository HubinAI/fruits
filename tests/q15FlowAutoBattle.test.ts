/**
 * Queue Q15-FLOW-R1-ATOMIC｜匹配完成直接开战 —— 最小回归护栏（源码级断言）。
 *
 * F-WX-5：正常玩家 Gameplay 流程已从 main.ts 抽到平台中立 PlayerGameRuntime
 * （src/game/playerGameRuntime.ts，Web/微信双入口共用）。本测试断言目标同步迁移到该文件，
 * 守护「goToMatchPreview 隐藏复核条 + 700ms 自动调用现有 startBattleWithReady + 状态 guard」，
 * 防止将来误删自动开战链 / 让「调整配置 / 开始战斗」重现 / 复制第二套 READY-Battle 逻辑；
 * 同时守卫 main.ts 不再包含玩家流程函数（防回退）。
 * 纯只读，不新增 dependency / production hook。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAIN = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
const RUNTIME = readFileSync(
  fileURLToPath(new URL('../src/game/playerGameRuntime.ts', import.meta.url)),
  'utf8',
);

describe('Q15-FLOW-R1-ATOMIC 匹配完成直接开战（PlayerGameRuntime）', () => {
  it('goToMatchPreview 内隐藏 matchBar（正常流程不再出现 调整配置/开始战斗）', () => {
    // F-WX-3/5：matchBar 显隐收进 Host（matchBarHidden 状态驱动）；runtime.goToMatchPreview
    // 设置 matchBarHidden=true 保证复核条永不闪现。
    expect(RUNTIME).toContain('matchBarHidden = true');
    const host = readFileSync(
      fileURLToPath(new URL('../src/ui/webDomPlayerUIHost.ts', import.meta.url)),
      'utf8',
    );
    expect(host).toContain(`state.matchBarHidden ? 'none' : vis.matchBar`);
  });

  it('约 700ms 后自动调用现有 startBattleWithReady（不复制第二套 READY/Battle 逻辑）', () => {
    // goToMatchPreview 内：startBattleWithReady() 出现在 setTimeout(..., 700) 中
    // （F-MATCH-FRAME-R2：Lock 停留延长到 600–800ms，给玩家看清锁定对手）。
    expect(RUNTIME).toMatch(/startBattleWithReady\(\);[\s\S]*?\}, 700\);/);
    expect(RUNTIME).toContain('}, 700);');
  });

  it('自动启动带 guard：仅 matchPreview + editing 才启动，否则 no-op', () => {
    expect(RUNTIME).toMatch(
      /playerPhaseInternal\s*!==\s*'matchPreview'\s*\|\|\s*this\.battleStateInternal\s*!==\s*'editing'/,
    );
  });

  it('startBattleWithReady 仍是单一现有实现（未被复制）', () => {
    const matches = RUNTIME.match(/private startBattleWithReady\(/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(MAIN).not.toContain('function startBattleWithReady('); // main.ts 不再持有流程实现
  });

  it('Result「下一场」仍复用 startMatching（自然变为 下一场→Matching→锁定→自动开战）', () => {
    expect(RUNTIME).toMatch(/private async nextMatch[\s\S]*?startMatching\(\)/);
  });

  it('Result「调整配置」仍回 Garage（onResultAdjust 接线不变；首轮引导在此结束）', () => {
    // 「完成首轮引导 + 回 Garage」判定在 PlayerGameRuntime（onResultAdjust），
    // 不得退化为直接 adjustConfig（那会跳过完成引导的判定）。
    expect(RUNTIME).toMatch(
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

  it('main.ts 不再包含玩家流程函数（流程唯一实现位于 PlayerGameRuntime）', () => {
    expect(MAIN).not.toMatch(
      /function (goToMatchPreview|startMatching|startBattleWithReady|nextMatch|finalizeBattleResult|adjustConfig)/,
    );
  });
});
