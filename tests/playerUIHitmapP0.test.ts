import { describe, it, expect, afterEach } from 'vitest';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { PlayerViewportTransform } from '../src/platform/playerViewport';
import { createWebCore } from '../src/platform/web';
import { bindPlatformCore } from '../src/platform/context';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { getInventory } from '../src/core/partInventory';
import { registry } from '../src/core/content';
import type { PlayerUIState } from '../src/ui/playerUI';

const ZERO = { left: 0, right: 0, top: 0, bottom: 0 };

/** 记录真实 ctx 变换（setTransform）的假 2D context——用于捕获 host 实际使用的设备变换。 */
function makeCaptureCtx() {
  let t: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
  const stack: typeof t[] = [];
  const base: Record<string | symbol, unknown> = {
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      t = [a, b, c, d, e, f];
    },
    resetTransform: () => {
      t = [1, 0, 0, 1, 0, 0];
    },
    save: () => stack.push(t),
    restore: () => {
      const v = stack.pop();
      if (v) t = v;
    },
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arcTo: () => {},
    arc: () => {},
    rect: () => {},
    fill: () => {},
    stroke: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    clearRect: () => {},
    fillText: () => {},
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    get lastTransform() {
      return t;
    },
  };
  return new Proxy(base, {
    get: (o, k) => (k in o ? (o as Record<string | symbol, unknown>)[k] : () => {}),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D & { lastTransform: readonly number[] };
}

function makeFakeCanvas() {
  const ctx = makeCaptureCtx();
  const style: Record<string, string> = {};
  const canvas = {
    getContext: () => ctx,
    width: 0,
    height: 0,
    clientWidth: 0,
    clientHeight: 0,
    style,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLCanvasElement;
  return { canvas, ctx, style };
}

function bindMockPlatform(opts: {
  vp: { w: number; h: number; dpr: number };
  capturePointer: (h: (x: number, y: number) => void) => void;
}): void {
  const core = createWebCore();
  bindPlatformCore({
    ...core,
    createViewport: () => ({
      surface: () => ({ width: opts.vp.w, height: opts.vp.h, devicePixelRatio: opts.vp.dpr, now: () => 0 }),
      onResize: () => {},
      safeInsets: () => ZERO,
    }),
    input: {
      ...core.input,
      bindPointer: (_t: EventTarget, h: (x: number, y: number) => void) => opts.capturePointer(h),
    },
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
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
    progress: { coin: 0, rating: 0 },
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

/** 计算 host 使用的 scale/ox/oy（与 resolveLayoutProfile + ensureSize 同公式），用于把命中区
 *  布局坐标换算到 host「实际绘制」的设备中心——再除 DPR 得到 CSS 坐标，喂给真实 pointer 链路。 */
function hostTransform(cssW: number, cssH: number, phoneLogical: boolean) {
  const W = phoneLogical ? 844 : cssW;
  const H = phoneLogical ? 390 : cssH;
  const isCompact = H < 600 && W / H >= 1.5; // isCompactLandscape
  const isMobile = phoneLogical ? true : isCompact;
  if (isMobile) return { scale: 1, ox: 0, oy: 0 };
  const scale = Math.min(cssW / 1280, cssH / 720);
  const ox = (cssW - 1280 * scale) / 2;
  const oy = (cssH - 720 * scale) / 2;
  return { scale, ox, oy };
}

describe('F-PLAYER-UI-HITMAP-P0｜可见绘制与命中区共享同一变换', () => {
  let captured: ((x: number, y: number) => void) | null = null;
  afterEach(() => {
    bindPlatformCore(createWebCore());
    captured = null;
  });

  it('T1. 桌面（scale≠1）点击控件「可见中心」命中该控件；ctx 仅 DPR 不二次缩放', () => {
    const dpr = 1;
    const cssW = 1920;
    const cssH = 1008;
    bindMockPlatform({ vp: { w: 844, h: 390, dpr }, capturePointer: (h) => (captured = h) });
    const { canvas, ctx } = makeFakeCanvas();
    const parent = { clientWidth: cssW, clientHeight: cssH, appendChild: () => {} } as unknown as HTMLElement;
    const host = new CanvasPlayerUIHost(canvas, { phoneLogical: false });
    host.mount(parent);
    host.render(garageState());

    // 守卫：ctx 变换 x 轴 scale 必须等于 DPR（不再乘 this.scale → 二次缩放）
    const t = ctx.lastTransform;
    expect(t[0], 'ctx x-scale = DPR（不二次乘 scale）').toBeCloseTo(dpr, 6);

    // 取一个稳定控件（装配台槽位 chip）
    const areas = host.getHitAreasForTest();
    const target = areas.find((a) => a.id.startsWith('chip:'));
    expect(target, '装配台 chip 命中区存在').toBeTruthy();
    if (!target) return;

    // 用 host 实际使用的 transform，把命中区中心换算到「真实绘制的可见 CSS 坐标」
    const { scale, ox, oy } = hostTransform(cssW, cssH, false);
    const ux = ox + (target.x + target.w / 2) * scale;
    const uy = oy + (target.y + target.h / 2) * scale;
    const devX = t[0] * ux + t[2] * uy + t[4];
    const devY = t[1] * ux + t[3] * uy + t[5];
    const clickX = devX / dpr;
    const clickY = devY / dpr;

    // 点击可见中心 → 应命中该控件（onToggleGarageSlot）
    let toggled = '';
    host.setActions(
      new Proxy(
        {},
        { get: (_o, prop) => (..._a: unknown[]) => { toggled = String(prop); } },
      ) as unknown as Parameters<typeof host.setActions>[0],
    );
    expect(captured, 'pointer handler 已绑定').not.toBeNull();
    captured!(clickX, clickY);
    expect(toggled, '点击可见控件中心命中 onToggleGarageSlot').toBe('onToggleGarageSlot');

    // 空白区（远离任何控件）不得误触发
    toggled = '';
    captured!(5, 5);
    expect(toggled, '点击空白区不触发任何控件').toBe('');
  });

  it('T2. 玩家模式（scale=1）点击首页「车库」可见中心进入车库（零回归）', () => {
    const dpr = 2;
    bindMockPlatform({ vp: { w: 844, h: 390, dpr }, capturePointer: (h) => (captured = h) });
    const { canvas, ctx } = makeFakeCanvas();
    const parent = { clientWidth: 1920, clientHeight: 1008, appendChild: () => {} } as unknown as HTMLElement;
    const vp = new PlayerViewportTransform();
    vp.update(1920, 1008, dpr);
    const host = new CanvasPlayerUIHost(canvas, { phoneLogical: true, viewportTransform: vp });
    host.mount(parent);
    host.render(garageState());

    const t = ctx.lastTransform;
    expect(t[0], '玩家模式 ctx x-scale = DPR').toBeCloseTo(dpr, 6);

    const areas = host.getHitAreasForTest();
    const target = areas.find((a) => a.id === 'home-garage');
    expect(target, 'home-garage 命中区存在').toBeTruthy();
    if (!target) return;

    // 玩家模式 scale=1, ox=0：可见中心 = 命中区中心
    const { scale, ox, oy } = hostTransform(1920, 1008, true);
    const ux = ox + (target.x + target.w / 2) * scale;
    const uy = oy + (target.y + target.h / 2) * scale;
    const devX = t[0] * ux + t[2] * uy + t[4];
    const devY = t[1] * ux + t[3] * uy + t[5];
    const clickX = devX / dpr;
    const clickY = devY / dpr;

    captured!(clickX, clickY);
    expect((host as unknown as { metaPage: string }).metaPage, '点击车库可见中心进入 garage').toBe('garage');
  });
});
