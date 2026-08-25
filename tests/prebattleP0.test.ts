/**
 * F-PREBATTLE-P0｜删除战前重复 UI（Mobile 正式玩家流程）：
 *
 * 真人录像暴露：matchPreview 同时出现「对手已锁定 / READY / 开战！/ VS / MatchBar / 驱动信息」
 * —— 根因是新 Matching 连续页（drawMatchingContinuum）与旧 readyOverlay / matchBar / drawPlayerTop
 * 同时绘制。
 *
 * 验收（逐帧）：
 * 1. Mobile Matching：只出现一次「正在寻找对手…」；无任何帧出现 READY / 开战！/ 调整配置 / 开始战斗。
 * 2. Mobile Locked（matchPreview）：只出现一次「对手已锁定」；无「正在寻找对手」；无 MatchBar（即便
 *    matchBarHidden=false 也不显示）；无 READY / 开战！。
 * 3. Mobile 在 readyOverlayVisible 帧：绝不出现 READY / 开战！（覆盖层被 gate 掉），连续页状态仍在。
 * 4. Desktop/Test 回归：旧 UI 全部保留（顶部状态条 + matchBar + READY/开战 均仍绘制）——证明只改 Mobile。
 *
 * 用 stub canvas（Proxy ctx）捕获 fillText，直接建模逐帧文字，不依赖真实浏览器。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { getInventory } from '../src/core/partInventory';
import type { SafeInsets } from '../src/platform/types';
import type { PlayerUIState } from '../src/ui/playerUI';

const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };

function makeRecCtx(): { ctx: CanvasRenderingContext2D; texts: string[] } {
  const texts: string[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, prop) => {
      if (prop === 'fillText') return (s: string): void => void texts.push(String(s));
      return () => ({ width: 0 });
    },
    set: () => true,
  });
  return { ctx, texts };
}

function garageState(over: Partial<PlayerUIState> = {}): PlayerUIState {
  return {
    uiMode: 'build',
    battleState: 'editing',
    playerPhase: 'garage',
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
    result: null,
    reward: null,
    economy: null,
    resultOnboardingVisible: false,
    rewardAdAvailable: false,
    rewardAdClaimed: false,
    readyOverlayVisible: false,
    ...over,
  };
}

function makeRecHost(vp: { w: number; h: number }): {
  host: CanvasPlayerUIHost;
  texts: () => string[];
} {
  const { ctx, texts } = makeRecCtx();
  const core = createWebCore();
  bindPlatformCore({
    ...core,
    input: { bindClick: () => {}, bindPointer: () => {} },
    createViewport: () => ({
      surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 }),
      onResize: () => {},
      safeInsets: () => INSETS,
    }),
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  const canvas = {
    getContext: () => ctx,
    width: vp.w,
    height: vp.h,
    style: undefined,
  } as unknown as HTMLCanvasElement;
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas();
  host.setActions({} as never);
  return { host, texts: () => texts };
}

/** 统计某帧绘制中出现该文字的次数（精确匹配，含全角/标点） */
function count(texts: string[], target: string): number {
  return texts.filter((s) => s === target).length;
}

function assertNoLegacyOverlay(texts: string[], label: string): void {
  expect(count(texts, 'READY'), `${label}：不应出现 READY`).toBe(0);
  expect(count(texts, '开战！'), `${label}：不应出现 开战！`).toBe(0);
  expect(texts.some((s) => s === '调整配置'), `${label}：不应出现 调整配置 (MatchBar)`).toBe(false);
  expect(texts.some((s) => s === '开始战斗'), `${label}：不应出现 开始战斗 (MatchBar)`).toBe(false);
}

describe('F-PREBATTLE-P0｜Mobile 战前重复 UI 删除（逐帧文字断言）', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
  });

  it('1. Mobile Matching：只出现一次「正在寻找对手…」，无任何旧 overlay（READY/开战/MatchBar）', () => {
    const env = makeRecHost({ w: 420, h: 210 }); // mobile-short
    env.host.render(garageState({ playerPhase: 'matching' }));
    const texts = env.texts();
    expect(count(texts, '正在寻找对手…'), 'Matching 只出现一次「正在寻找对手…」').toBe(1);
    expect(texts.some((s) => s === '对手已锁定'), 'Matching 不应出现「对手已锁定」').toBe(false);
    // 信息减法：搜索只有一套状态文字（无重复「扫描对手中」）；无左右大标签；无驱动 pill
    expect(texts.some((s) => s === '扫描对手中…'), 'Matching 不应出现重复「扫描对手中」').toBe(false);
    expect(texts.some((s) => s === '我方车'), 'Matching 不应出现「我方车」大标签').toBe(false);
    expect(texts.some((s) => s === '对手'), 'Matching 不应出现「对手」大标签').toBe(false);
    expect(texts.some((s) => s.includes('驱动')), 'Matching 不应出现驱动 pill').toBe(false);
    assertNoLegacyOverlay(texts, 'Matching');
    expect(env.host.getHitAreasForTest(), 'Matching 无命中区（纯表现，无 MatchBar 按钮）').toHaveLength(0);
  });

  it('2. Mobile Locked（matchPreview）：只出现一次「对手已锁定」，无正在寻找/无 MatchBar', () => {
    const env = makeRecHost({ w: 844, h: 390 }); // mobile-normal
    env.host.render(
      garageState({
        playerPhase: 'matchPreview',
        matchBarHidden: true,
        opponent: { bodyName: '香蕉车', parts: ['炮'], drive: '前进' },
      }),
    );
    const texts = env.texts();
    expect(count(texts, '对手已锁定'), 'Locked 只出现一次「对手已锁定」').toBe(1);
    expect(texts.some((s) => s === '正在寻找对手…'), 'Locked 不应出现「正在寻找对手…」').toBe(false);
    // 信息减法：Locked 无驱动 pill、无左右大标签、无重复扫描文字
    expect(texts.some((s) => s.includes('驱动')), 'Locked 不应出现驱动 pill').toBe(false);
    expect(texts.some((s) => s === '我方车'), 'Locked 不应出现「我方车」大标签').toBe(false);
    expect(texts.some((s) => s === '对手'), 'Locked 不应出现「对手」大标签').toBe(false);
    expect(texts.some((s) => s === '扫描对手中…'), 'Locked 不应出现「扫描对手中」').toBe(false);
    assertNoLegacyOverlay(texts, 'Locked');
    expect(env.host.getHitAreasForTest(), 'Locked 正常流程无 MatchBar 按钮').toHaveLength(0);
  });

  it('3. Mobile Locked 即便 matchBarHidden=false 也不显示 MatchBar（禁止新增确认按钮）', () => {
    const env = makeRecHost({ w: 932, h: 430 }); // mobile-normal
    env.host.render(
      garageState({
        playerPhase: 'matchPreview',
        matchBarHidden: false, // 即便状态说“显示复核条”，Mobile 也不绘制
        opponent: { bodyName: '西瓜车', parts: [], drive: '停驻' },
      }),
    );
    const texts = env.texts();
    expect(count(texts, '对手已锁定')).toBe(1);
    assertNoLegacyOverlay(texts, 'Locked(matchBarHidden=false)');
    // 信息减法即便 matchBarHidden=false 也成立：无驱动 pill / 无大标签 / 无重复扫描文字
    expect(texts.some((s) => s.includes('驱动')), 'Locked(matchBarHidden=false) 不应出现驱动 pill').toBe(false);
    expect(texts.some((s) => s === '我方车'), 'Locked(matchBarHidden=false) 不应出现「我方车」大标签').toBe(false);
    expect(texts.some((s) => s === '对手'), 'Locked(matchBarHidden=false) 不应出现「对手」大标签').toBe(false);
    const ids = env.host.getHitAreasForTest().map((a) => a.id);
    expect(ids).not.toContain('match-adjust');
    expect(ids).not.toContain('match-start');
  });

  it('4. Mobile readyOverlayVisible 帧：绝不出现 READY / 开战！（覆盖层被 gate），连续页状态仍在', () => {
    const env = makeRecHost({ w: 420, h: 210 });
    env.host.render(
      garageState({
        playerPhase: 'matchPreview',
        readyOverlayVisible: true,
        opponent: { bodyName: '香蕉车', parts: ['炮'], drive: '前进' },
      }),
    );
    const texts = env.texts();
    expect(count(texts, 'READY'), 'Mobile ready 过渡帧不应出现 READY').toBe(0);
    expect(count(texts, '开战！'), 'Mobile ready 过渡帧不应出现 开战！').toBe(0);
    // 连续页仍在：锁定状态唯一出现，对手信息仍在（对手名称）；无驱动 pill / 无重复扫描文字
    expect(count(texts, '对手已锁定'), 'ready 过渡帧连续页仍显示唯一「对手已锁定」').toBe(1);
    expect(texts.some((s) => s.includes('驱动')), 'ready 过渡帧不应出现驱动 pill').toBe(false);
    expect(texts.some((s) => s === '扫描对手中…'), 'ready 过渡帧不应出现「扫描对手中」').toBe(false);
  });

  it('5. Desktop/Test 回归：旧 UI 全部保留（顶部状态条 + MatchBar + READY/开战 仍绘制）', () => {
    const env = makeRecHost({ w: 1280, h: 720 }); // desktop
    // matching：旧顶部状态条 + 连续页中央状态 → 「正在寻找对手…」出现 2 次（Desktop 允许保留旧 UI）
    env.host.render(garageState({ playerPhase: 'matching' }));
    expect(count(env.texts(), '正在寻找对手…'), 'Desktop matching 保留旧顶部状态条（2 次）').toBe(2);

    // matchPreview + matchBarHidden=false：MatchBar（调整配置/开始战斗）仍出现且可命中
    env.host.render(
      garageState({
        playerPhase: 'matchPreview',
        matchBarHidden: false,
        opponent: { bodyName: '香蕉车', parts: ['炮'], drive: '前进' },
      }),
    );
    const t2 = env.texts();
    expect(count(t2, '对手已锁定'), 'Desktop Locked 旧顶部状态条 + 连续页 = 2 次').toBe(2);
    expect(t2.some((s) => s === '调整配置'), 'Desktop 仍显示 MatchBar 调整配置').toBe(true);
    expect(t2.some((s) => s === '开始战斗'), 'Desktop 仍显示 MatchBar 开始战斗').toBe(true);
    const ids = env.host.getHitAreasForTest().map((a) => a.id);
    expect(ids).toContain('match-adjust');
    expect(ids).toContain('match-start');

    // readyOverlayVisible：READY / 开战！ 仍绘制（Desktop/Test 保留）
    env.host.render(
      garageState({
        playerPhase: 'matchPreview',
        readyOverlayVisible: true,
        opponent: { bodyName: '香蕉车', parts: ['炮'], drive: '前进' },
      }),
    );
    const t3 = env.texts();
    expect(count(t3, 'READY'), 'Desktop 仍显示 READY 过渡').toBe(1);
    expect(count(t3, '开战！'), 'Desktop 仍显示 开战！').toBe(1);
  });

  it('6. 源码守卫：draw() 中三处旧 UI 均经 !this.isMobile gate（防回归）', () => {
    const src = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    const drawStart = src.indexOf('private draw(): void');
    const drawEnd = src.indexOf('private ensureSize');
    const draw = src.slice(drawStart, drawEnd === -1 ? src.length : drawEnd);
    expect(draw, 'matching/matchPreview 顶部状态条经 !isMobile gate').toContain('if (!this.isMobile) this.drawPlayerTop(');
    expect(draw, 'matchBar 经 !isMobile && !matchBarHidden gate').toContain('if (!this.isMobile && !state.matchBarHidden) this.drawMatchBar();');
    expect(draw, 'READY 覆盖层经 !isMobile gate').toContain('if (state.readyOverlayVisible && !this.isMobile) this.drawReadyOverlay();');
    // 连续页仍是唯一始终绘制的战前页面（两分支都调用）
    expect(draw.match(/this\.drawMatchingContinuum\(state\)/g)?.length, 'matching+matchPreview 均调用 drawMatchingContinuum').toBe(2);
  });
});
