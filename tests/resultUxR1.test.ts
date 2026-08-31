/**
 * F-RESULT-UX-R1｜结算页信息层级与再战主路径验收。
 *
 * 仅重构展示层级（数据/功能/流程不变）：
 * 1. 胜利=绿、失败=红 语义标题（第一眼知道输赢）；
 * 2. 部件卡去掉整框表格线（改用极淡顶部分隔线）；
 * 3. 360×180 极限短屏结算 Modal 不溢出 safe 区（按钮行在 safe 底缘内）；
 * 4. 顺序：胜/负 → 金币·段位（rewardRows）→ 部件（partCard）→ 广告(奖励区内弱化) → 主/次决策按钮；
 * 5. F-LOSS-ADJUST-REMATCH-LOOP-P0｜Must#3：主/次按胜负切换（战败主=调整配置；胜利主=下一场，在右），广告在奖励区内部且弱于决策。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { getInventory } from '../src/core/partInventory';
import type { PlayerUIState, PlayerUIActions } from '../src/ui/playerUI';
import type { SafeInsets } from '../src/platform/types';

const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };

function makeStubCtx(): CanvasRenderingContext2D {
  return new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true });
}

function makeHost(vp: { w: number; h: number }) {
  let captured: ((x: number, y: number) => void) | null = null;
  const core = createWebCore();
  bindPlatformCore({
    ...core,
    input: { bindClick: () => {}, bindPointer: (_t: EventTarget, h: (x: number, y: number) => void) => { captured = h; } },
    createViewport: () => ({
      surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 }),
      onResize: () => {},
      safeInsets: () => INSETS,
    }),
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  const canvas = { getContext: () => makeStubCtx(), width: vp.w, height: vp.h, style: undefined } as unknown as HTMLCanvasElement;
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas();
  host.setActions({} as unknown as PlayerUIActions);
  return { host, pointer: (x: number, y: number) => captured!(x, y) };
}

function resultState(over: Partial<PlayerUIState> = {}): PlayerUIState {
  return {
    uiMode: 'build',
    battleState: 'ended',
    playerPhase: 'matchPreview',
    draft: makeStarterDraft('boxBody', registry),
    draftValid: true,
    blockReason: null,
    garageSelected: null,
    inventory: getInventory(),
    progress: { coin: 100, rating: 200 },
    onboarding: 'done',
    resetDevVisible: false,
    opponent: null,
    matchBarHidden: true,
    result: { winner: 'A', hpA: 90, hpB: 0 },
    reward: { name: '榴莲炮', starStr: '★★', cat: 'weapon', countAfter: 2 },
    economy: { coinDelta: 50, ratingDelta: 12, tierLabel: '青铜', rating: 212, coin: 150 },
    resultOnboardingVisible: true,
    rewardAdAvailable: true,
    rewardAdClaimed: false,
    readyOverlayVisible: false,
    ...over,
  };
}

function areasOf(host: CanvasPlayerUIHost) {
  return host.getHitAreasForTest();
}

describe('F-RESULT-UX-R1｜结算页信息层级与再战主路径', () => {
  it('源码守卫：标题语义色调 + 部件卡去整框（F-RESULT-UX-R1）', () => {
    const src = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    const resultModalIdx = src.indexOf('private showResultModal');
    const resultMethod = src.slice(resultModalIdx, src.indexOf('showModal(spec: ModalSpec): void'));
    expect(resultMethod, '胜利传 green 色调').toContain("titleTone: isWin ? 'green' : 'red'");
    const modalMethod = src.slice(src.indexOf('private drawModal'), src.indexOf('private drawReadyOverlay'));
    expect(modalMethod, '标题按 titleTone 着色（green→V.win / red→V.lose；语义同旧 C.green/C.red）').toContain(
      "const titleColor = spec.titleTone === 'green' ? V.win : spec.titleTone === 'red' ? V.lose : V.textPrimary;",
    );
    // 部件卡：不再用 C.border 整框；改用极淡顶部分隔线（V.borderSoft）
    expect(modalMethod, '部件卡去除整框表格线').not.toContain('this.rect(cx + pad, yy, pw, ph, C.cardBg, C.border, 1)');
    expect(modalMethod, '部件卡改极淡顶部分隔线').toContain('V.borderSoft');
    // 顺序：rewardRows（金币/段位）→ partCard → adRow 内层 → primary/secondary
    expect(resultMethod).toContain("label: '金币'");
    expect(resultMethod).toContain("label: '段位'");
    expect(resultMethod).toContain('partCard');
    // F-LOSS-ADJUST-REMATCH-LOOP-P0｜Must#3：主/次按钮按胜负切换（战败主=调整配置；胜利主=下一场）
    expect(resultMethod).toContain("primary: isWin ? '下一场' : '调整配置'");
    expect(resultMethod).toContain("secondary: isWin ? '调整配置' : '下一场'");
    expect(resultMethod).toContain('adRow');
  });

  it('360×180 极限短屏：结算 Modal 不溢出 safe 区（按钮行在 safe 底缘内）', () => {
    const vp = { w: 360, h: 180 };
    const env = makeHost(vp);
    env.host.render(resultState());
    const ar = areasOf(env.host);
    const primary = ar.find((a) => a.id === 'modal-primary')!;
    const secondary = ar.find((a) => a.id === 'modal-secondary')!;
    const safeBottom = vp.h - INSETS.bottom;
    for (const a of [primary, secondary]) {
      expect(a.y, `${a.id} y ≥ safeTop`).toBeGreaterThanOrEqual(INSETS.top);
      expect(a.y + a.h, `${a.id} 底缘 ≤ safe 底 ${safeBottom}`).toBeLessThanOrEqual(safeBottom);
      expect(a.h, `${a.id} 高 ≥36（可点）`).toBeGreaterThanOrEqual(36);
    }
    // 主在次右（win 态：下一场为主；F-LOSS-ADJUST-REMATCH-LOOP-P0 后主/次按胜负切换，位置不变）
    expect(primary.x, '下一场在调整配置右侧').toBeGreaterThan(secondary.x + secondary.w);
  });

  it('420×210 / 621×351：放大档保留留白且全部按钮 safe 内', () => {
    for (const vp of [{ w: 420, h: 210 }, { w: 621, h: 351 }]) {
      const env = makeHost(vp);
      env.host.render(resultState());
      const ar = areasOf(env.host);
      const primary = ar.find((a) => a.id === 'modal-primary')!;
      const secondary = ar.find((a) => a.id === 'modal-secondary')!;
      const safeBottom = vp.h - INSETS.bottom;
      for (const a of [primary, secondary]) {
        expect(a.y + a.h, `${vp.w}×${vp.h} 底缘 ≤ safe 底`).toBeLessThanOrEqual(safeBottom);
        expect(a.x + a.w, `${vp.w}×${vp.h} 右缘 ≤ 屏宽`).toBeLessThanOrEqual(vp.w);
      }
      expect(primary.x, '下一场在右').toBeGreaterThan(secondary.x + secondary.w);
    }
  });

  it('广告入口在奖励区内部且弱于决策按钮（不新增底部第三按钮）', () => {
    const vp = { w: 621, h: 351 };
    const env = makeHost(vp);
    env.host.render(resultState());
    const ar = areasOf(env.host);
    expect(ar.some((a) => a.id === 'modal-tertiary'), '无第三个同级底部按钮').toBe(false);
    const ad = ar.find((a) => a.id === 'modal-ad')!;
    const primary = ar.find((a) => a.id === 'modal-primary')!;
    expect(ad, '广告小型入口存在').toBeTruthy();
    expect(ad.h, '广告入口矮于决策按钮（弱化）').toBeLessThan(primary.h);
    expect(ad.y + ad.h, '广告入口在决策行上方（奖励区内）').toBeLessThanOrEqual(primary.y);
  });
});
