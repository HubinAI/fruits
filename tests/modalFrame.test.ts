import { describe, it, expect } from 'vitest';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { getInventory } from '../src/core/partInventory';
import type { SafeInsets } from '../src/platform/types';
import type { PlayerUIState } from '../src/ui/playerUI';

/**
 * F-META-4｜通用 Modal / Popup Foundation：
 * 1. 打开时底层按钮不可点（遮罩拦截）；2. 主/次按钮命中正确；
 * 3. 关闭后页面状态不丢；4. 621×351 / 844×390 正常。
 */

function makeStubCtx(): CanvasRenderingContext2D {
  return new Proxy({} as CanvasRenderingContext2D, {
    get: () => () => ({ width: 0 }),
    set: () => true,
  });
}

interface HostEnv {
  host: CanvasPlayerUIHost;
  pointer: (x: number, y: number) => void;
  areas: () => ReturnType<CanvasPlayerUIHost['getHitAreasForTest']>;
  fired: Record<string, number>;
}

function makeHost(vp: { w: number; h: number }, insets: SafeInsets): HostEnv {
  let captured: ((x: number, y: number) => void) | null = null;
  const fired: Record<string, number> = {};
  const core = createWebCore();
  bindPlatformCore({
    ...core,
    input: {
      bindClick: () => {},
      bindPointer: (_t: EventTarget, h: (x: number, y: number) => void) => {
        captured = h;
      },
    },
    createViewport: () => ({
      surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 }),
      onResize: () => {},
      safeInsets: () => insets,
    }),
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  const canvas = {
    getContext: () => makeStubCtx(),
    width: vp.w,
    height: vp.h,
    style: undefined,
  } as unknown as HTMLCanvasElement;
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas();
  const rec = (k: string) => (v: string) => void (fired[k] = (fired[k] ?? 0) + (v ? 1 : 1));
  host.setActions({
    onToggleGarageSlot: rec('toggle'),
    onFindOpponent: rec('find'),
  } as never);
  return {
    host,
    pointer: (x, y) => captured!(x, y),
    areas: () => host.getHitAreasForTest(),
    fired,
  };
}

function state(over: Partial<PlayerUIState> = {}): PlayerUIState {
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

function click(env: HostEnv, id: string): void {
  const a = env.areas().find((x) => x.id === id);
  expect(a, `应有 ${id}`).toBeTruthy();
  env.pointer(a!.x + a!.w / 2, a!.y + a!.h / 2);
}

const VIEWPORTS = [
  { w: 621, h: 351 },
  { w: 844, h: 390 },
];
const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };

describe('F-META-4｜通用 Modal / Popup Foundation', () => {
  it('验收1｜打开时底层按钮不可点（遮罩拦截）；Modal 按钮可点', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(state());
    // 打开 Modal（不接业务：仅标题/内容/按钮）
    let primaryHit = 0;
    env.host.showModal({
      title: '测试弹窗',
      body: ['第一行内容', '第二行内容'],
      primary: '确定',
      secondary: '取消',
      onPrimary: () => void (primaryHit += 1),
    });
    // Modal 元素存在
    expect(env.areas().some((a) => a.id === 'modal-primary'), '主按钮出现').toBe(true);
    expect(env.areas().some((a) => a.id === 'modal-secondary'), '次按钮出现').toBe(true);
    expect(env.areas().some((a) => a.id === 'modal-veil'), '遮罩出现').toBe(true);
    // 底层按钮仍注册（渲染层在）但不可命中——点 entry:body / cta-find 中心 → 无 action 派发
    const entry = env.areas().find((a) => a.id === 'entry:body');
    expect(entry, '底层按钮仍绘制').toBeTruthy();
    if (entry) env.pointer(entry.x + entry.w / 2, entry.y + entry.h / 2);
    const cta = env.areas().find((a) => a.id === 'cta-find');
    if (cta) env.pointer(cta.x + cta.w / 2, cta.y + cta.h / 2);
    const dispatched = Object.keys(env.fired).filter((k) => env.fired[k] > 0);
    expect(dispatched, '底层点击被遮罩拦截（无 action 派发）').toHaveLength(0);
    // Modal 主按钮可点
    click(env, 'modal-primary');
    expect(primaryHit, '主按钮回调触发').toBe(1);
  });

  it('验收2｜主/次按钮命中正确：主按钮回调 + 关闭；次按钮回调 + 关闭', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(state());
    // 次按钮关闭路径
    let secondaryHit = 0;
    env.host.showModal({
      title: 'T',
      body: ['b'],
      primary: 'P',
      secondary: 'S',
      onSecondary: () => void (secondaryHit += 1),
    });
    click(env, 'modal-secondary');
    expect(secondaryHit, '次按钮回调触发').toBe(1);
    expect(env.areas().some((a) => a.id === 'modal-veil'), '关闭后遮罩消失').toBe(false);
    // 主按钮关闭路径
    let primaryHit = 0;
    env.host.showModal({
      title: 'T2',
      body: [],
      primary: 'OK',
      onPrimary: () => void (primaryHit += 1),
    });
    expect(env.areas().some((a) => a.id === 'modal-secondary'), '无次按钮时不出现').toBe(false);
    click(env, 'modal-primary');
    expect(primaryHit, '主按钮回调触发').toBe(1);
    expect(env.areas().some((a) => a.id === 'modal-primary'), '关闭后主按钮消失').toBe(false);
  });

  it('验收3｜关闭后页面状态不丢：展开的配置选项面板保持', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(state());
    // 展开车身选项（garageSelected=body → options 面板）
    env.host.render(state({ garageSelected: 'body' }));
    expect(env.areas().some((a) => a.id.startsWith('opt:')), '选项面板展开').toBe(true);
    const optBefore = env.areas().filter((a) => a.id.startsWith('opt:')).length;
    // 打开并关闭 Modal
    env.host.showModal({ title: 'T', body: ['b'], primary: 'OK' });
    click(env, 'modal-primary');
    // 页面状态不丢：选项面板仍在（garageSelected 保持）
    expect(env.areas().filter((a) => a.id.startsWith('opt:')).length, '关闭后选项面板保持').toBe(optBefore);
    expect(env.areas().some((a) => a.id === 'panel-back'), '面板返回按钮仍在').toBe(true);
  });

  it('验收4｜621×351 / 844×390 正常：Modal 卡片与按钮全在屏内', () => {
    for (const vp of VIEWPORTS) {
      const env = makeHost(vp, INSETS);
      env.host.render(state());
      env.host.showModal({ title: '奖励提示', body: ['获得了新部件', '合成 2★ 成功'], primary: '确定', secondary: '稍后' });
      for (const id of ['modal-veil', 'modal-primary', 'modal-secondary']) {
        const a = env.areas().find((x) => x.id === id);
        expect(a, `${vp.w}×${vp.h} 应有 ${id}`).toBeTruthy();
        expect(a!.x, `${id} x ≥0`).toBeGreaterThanOrEqual(0);
        expect(a!.x + a!.w, `${id} 右缘 ≤ 屏宽`).toBeLessThanOrEqual(vp.w);
        expect(a!.y, `${id} y ≥0`).toBeGreaterThanOrEqual(0);
        expect(a!.y + a!.h, `${id} 底缘 ≤ 屏高`).toBeLessThanOrEqual(vp.h);
      }
      // 主/次按钮不重叠（命中正确）
      const p = env.areas().find((x) => x.id === 'modal-primary')!;
      const s = env.areas().find((x) => x.id === 'modal-secondary')!;
      expect(p.x, '主按钮在次按钮右侧').toBeGreaterThanOrEqual(s.x + s.w);
      expect(p.h, '按钮高 ≥52').toBeGreaterThanOrEqual(52);
    }
  });

  it('F-META-UX4｜Result 三层结算：rewardRows + partCard 结构下按钮全在屏内、无领取步骤', () => {
    for (const vp of VIEWPORTS) {
      const env = makeHost(vp, INSETS);
      env.host.render(
        state({
          playerPhase: 'matchPreview',
          battleState: 'ended',
          result: { winner: 'A', hpA: 100, hpB: 0 },
          reward: { name: '榴莲炮', starStr: '★★', cat: 'weapon', countAfter: 2 },
          economy: { coinDelta: 50, ratingDelta: 12, tierLabel: '青铜', rating: 212, coin: 150 },
        }),
      );
      // 主（下一场）/ 次（调整配置）明确；无额外「领取奖励」步骤按钮
      expect(env.areas().some((a) => a.id === 'modal-primary'), '主按钮（下一场）').toBe(true);
      expect(env.areas().some((a) => a.id === 'modal-secondary'), '次按钮（调整配置）').toBe(true);
      const modalIds = env
        .areas()
        .filter((a) => a.id.startsWith('modal-'))
        .map((a) => a.id)
        .sort();
      expect(modalIds, `${vp.w}×${vp.h} 仅主/次/遮罩（无领取确认等额外按钮）`).toEqual(['modal-primary', 'modal-secondary', 'modal-veil']);
      // 三层结构下按钮全在屏内、主在次右
      const p = env.areas().find((x) => x.id === 'modal-primary')!;
      const s = env.areas().find((x) => x.id === 'modal-secondary')!;
      expect(p.x, '主按钮在次按钮右侧').toBeGreaterThanOrEqual(s.x + s.w);
      for (const a of [p, s]) {
        expect(a.x, '按钮 x ≥0').toBeGreaterThanOrEqual(0);
        expect(a.x + a.w, '按钮右缘 ≤ 屏宽').toBeLessThanOrEqual(vp.w);
        expect(a.y, '按钮 y ≥0').toBeGreaterThanOrEqual(0);
        expect(a.y + a.h, '按钮底缘 ≤ 屏高').toBeLessThanOrEqual(vp.h);
      }
    }
  });

  it('F-UX-2D｜Result 大尺寸档：showResultModal 传 large；drawModal 按 viewport 比例放大；按钮贴底', () => {
    const src = require('fs').readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    const resultMethod = src.slice(src.indexOf('private showResultModal'), src.indexOf('showModal(spec: ModalSpec): void'));
    expect(resultMethod, 'Result 走大尺寸档').toContain('large: true');
    const modalMethod = src.slice(src.indexOf('private drawModal'), src.indexOf('private drawReadyOverlay'));
    expect(modalMethod).toContain('const large = !!spec.large');
    // normal：宽 ×0.78（70~80%）、高 ×0.62（60~75%）；short：宽 ×0.9 / 高 ×0.82（safe 用满留边距）
    expect(modalMethod).toContain('0.78');
    expect(modalMethod).toContain('0.62');
    expect(modalMethod).toContain('0.9');
    expect(modalMethod).toContain('0.82');
    // 按钮行贴卡片底部（明确最终决策层）
    expect(modalMethod).toContain('const by = large ? cy + cardH - pad - btnH : yy + 2;');
  });

  it('F-UX-2D｜Result large 在 621×351 / 844×390 下按钮全在屏内且明显放大（一屏决策层）', () => {
    for (const vp of VIEWPORTS) {
      const env = makeHost(vp, INSETS);
      env.host.render(
        state({
          playerPhase: 'matchPreview',
          battleState: 'ended',
          result: { winner: 'A', hpA: 100, hpB: 0 },
          reward: { name: '榴莲炮', starStr: '★★', cat: 'weapon', countAfter: 2 },
          economy: { coinDelta: 50, ratingDelta: 12, tierLabel: '青铜', rating: 212, coin: 150 },
        }),
      );
      const p = env.areas().find((x) => x.id === 'modal-primary')!;
      const s = env.areas().find((x) => x.id === 'modal-secondary')!;
      // 两个下一步按钮清楚（主在次右、均屏内、高 ≥36）
      expect(p.x, '主按钮在次按钮右侧').toBeGreaterThanOrEqual(s.x + s.w);
      expect(p.h, '主按钮高 ≥36').toBeGreaterThanOrEqual(36);
      for (const a of [p, s]) {
        expect(a.x + a.w, `${vp.w}×${vp.h} 按钮右缘 ≤ 屏宽`).toBeLessThanOrEqual(vp.w);
        expect(a.y + a.h, `${vp.w}×${vp.h} 按钮底缘 ≤ 屏高`).toBeLessThanOrEqual(vp.h);
      }
    }
  });
});
