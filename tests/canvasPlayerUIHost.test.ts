/**
 * F-WX-4｜CanvasPlayerUIHost 定向测试（headless）。
 *
 * 验证：Canvas UI 与 WebDomPlayerUIHost 消费同一 PlayerUIState/PlayerUIActions，
 * 且输入经 Platform Input Adapter（bindPointer）→ hit-test → 派发正确 Action。
 * 用 stub canvas（Proxy ctx）+ 捕获指针 handler 的 fake input + 1280×720 fake parent
 * （scale=1，逻辑坐标==指针坐标），不依赖真实浏览器。
 *
 * 只断言「绘制后点哪里触发哪个 Action」，不断言像素；Canvas Host 不决定任何游戏规则。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { getInventory } from '../src/core/partInventory';
import type { PlayerUIState } from '../src/ui/playerUI';

function makeStubCtx(): CanvasRenderingContext2D {
  const handler = {
    get: () => () => ({ width: 0 }),
    set: () => true,
  };
  return new Proxy({} as CanvasRenderingContext2D, handler);
}

function makeStubCanvas(): HTMLCanvasElement {
  return {
    getContext: () => makeStubCtx(),
    style: {},
    width: 0,
    height: 0,
  } as unknown as HTMLCanvasElement;
}

function makeFakeParent(): HTMLElement {
  return { clientWidth: 1280, clientHeight: 720, appendChild: () => {} } as unknown as HTMLElement;
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

const RESULT_STATE: PlayerUIState = {
  ...garageState(),
  battleState: 'ended',
  result: { winner: 'A', hpA: 80, hpB: 0 },
  reward: { name: '炮', starStr: '★', cat: '武器', countAfter: 2 },
  economy: { coinDelta: 100, ratingDelta: 10, tierLabel: '青铜', rating: 10, coin: 100 },
  resultOnboardingVisible: false,
  rewardAdAvailable: true,
  rewardAdClaimed: false,
};

describe('F-WX-4 CanvasPlayerUIHost', () => {
  let capturedPointer: ((x: number, y: number) => void) | null = null;
  let host: CanvasPlayerUIHost;
  let fired: Record<string, string[]> = {};

  beforeEach(() => {
    capturedPointer = null;
    fired = {};
    const core = createWebCore();
    bindPlatformCore({
      ...core,
      input: {
        bindClick: () => {},
        bindPointer: (_t: EventTarget, h: (x: number, y: number) => void) => {
          capturedPointer = h;
        },
      },
    } as Parameters<typeof bindPlatformCore>[0]);
    host = new CanvasPlayerUIHost(makeStubCanvas());
    host.mount(makeFakeParent());
    host.setActions({
      onToggleGarageSlot: (k) => void (fired['toggle'] = [...(fired['toggle'] ?? []), k]),
      onPickGarageOption: (v) => void (fired['pick'] = [...(fired['pick'] ?? []), v]),
      onFindOpponent: () => void (fired['find'] = [...(fired['find'] ?? []), 'x']),
      onMatchAdjust: () => void (fired['matchAdjust'] = [...(fired['matchAdjust'] ?? []), 'x']),
      onStartBattle: () => void (fired['startBattle'] = [...(fired['startBattle'] ?? []), 'x']),
      onResultAdjust: () => void (fired['resultAdjust'] = [...(fired['resultAdjust'] ?? []), 'x']),
      onResultNext: () => void (fired['next'] = [...(fired['next'] ?? []), 'x']),
      onClaimRewardAd: () => void (fired['reward'] = [...(fired['reward'] ?? []), 'x']),
      onMerge: () => void (fired['merge'] = [...(fired['merge'] ?? []), 'x']),
      onResetProgress: () => {},
    });
  });

  afterEach(() => {
    bindPlatformCore(createWebCore());
  });

  function click(id: string): void {
    const areas = host.getHitAreasForTest();
    const a = areas.find((x) => x.id === id);
    expect(a, `应存在命中区 ${id}`).toBeTruthy();
    expect(capturedPointer).toBeTruthy();
    capturedPointer!(a!.x + a!.w / 2, a!.y + a!.h / 2);
  }

  it('Garage：点「寻找对手」CTA → onFindOpponent（输入经 bindPointer）', () => {
    host.render(garageState());
    click('cta-find');
    expect(fired['find']).toHaveLength(1);
  });

  it('Garage：点 chip → onToggleGarageSlot(该槽位)', () => {
    host.render(garageState());
    click('chip:body');
    expect(fired['toggle']).toEqual(['body']);
    click('chip:frontWheel');
    expect(fired['toggle']).toEqual(['body', 'frontWheel']);
  });

  it('Garage：选中槽展开 → 点选项 → onPickGarageOption(该值)', () => {
    host.render(garageState({ garageSelected: 'body' }));
    click('opt:watermelonBody');
    expect(fired['pick']).toEqual(['watermelonBody']);
  });

  it('Garage：点合成 → onMerge（规则在 main.ts，Host 不决定）', () => {
    // 全新账号副本/金币不足 → 合成按钮禁用（不注册命中）；给足库存+金币后可用
    host.render(garageState());
    expect(host.getHitAreasForTest().map((a) => a.id)).not.toContain('merge');

    const inv = getInventory();
    inv['cannon'] = { one: 6, two: 0 }; // 未装备副本 ≥5 → 可合成
    host.render(garageState({ inventory: inv, progress: { coin: 500, rating: 0 } }));
    click('merge');
    expect(fired['merge']).toHaveLength(1);
  });

  it('Result：点「下一场」→ onResultNext；点「调整配置」→ onResultAdjust', () => {
    host.render(RESULT_STATE);
    click('result-next');
    expect(fired['next']).toHaveLength(1);
    click('result-adjust');
    expect(fired['resultAdjust']).toHaveLength(1);
  });

  it('Result：广告可用时显示「看广告领」→ onClaimRewardAd', () => {
    host.render(RESULT_STATE);
    click('reward-ad');
    expect(fired['reward']).toHaveLength(1);
  });

  it('Result：广告不可用时不注册 reward-ad 命中区', () => {
    host.render({ ...RESULT_STATE, rewardAdAvailable: false });
    const ids = host.getHitAreasForTest().map((a) => a.id);
    expect(ids).not.toContain('reward-ad');
    expect(ids).toContain('result-next');
  });

  it('Matching：只画 VS，无命中区（纯表现）', () => {
    host.render(garageState({ playerPhase: 'matching' }));
    expect(host.getHitAreasForTest()).toHaveLength(0);
  });

  it('MatchPreview：matchBarHidden=false 时显示 调整配置/开始战斗 → 派发 onMatchAdjust/onStartBattle', () => {
    const state = garageState({ playerPhase: 'matchPreview', matchBarHidden: false });
    host.render(state);
    click('match-adjust');
    expect(fired['matchAdjust']).toHaveLength(1);
    click('match-start');
    expect(fired['startBattle']).toHaveLength(1);
  });

  it('Battle HUD：renderBattleFrame(fighting) 不抛、无命中区（每帧只画）', () => {
    host.render({ ...garageState(), battleState: 'fighting' });
    expect(() =>
      host.renderBattleFrame({
        battleState: 'fighting',
        battleStatus: {
          phase: 'Active',
          sideA: { hp: 70, maxHp: 100 },
          sideB: { hp: 40, maxHp: 100 },
        },
        phaseCountdownText: null,
      }),
    ).not.toThrow();
    expect(host.getHitAreasForTest()).toHaveLength(0);
  });

  it('Scenario（DEV）：Canvas 隐藏且不挡指针（不进入 Canvas Host）', () => {
    const canvas = makeStubCanvas();
    const h = new CanvasPlayerUIHost(canvas);
    h.mount(makeFakeParent());
    h.render(garageState({ uiMode: 'scenario' }));
    expect(canvas.style.visibility).toBe('hidden');
    expect(canvas.style.pointerEvents).toBe('none');
  });

  it('正常玩家路径（Garage→Matching→Battle→Result→Garage）逐状态渲染不抛', () => {
    expect(() => {
      host.render(garageState());
      host.render(garageState({ playerPhase: 'matching' }));
      host.render(garageState({ playerPhase: 'matchPreview', matchBarHidden: true }));
      host.render({ ...garageState(), battleState: 'fighting' });
      host.renderBattleFrame({
        battleState: 'fighting',
        battleStatus: { phase: 'Warning', sideA: { hp: 50, maxHp: 100 }, sideB: { hp: 50, maxHp: 100 } },
        phaseCountdownText: '2',
      });
      host.render(RESULT_STATE);
      host.render(garageState());
    }).not.toThrow();
  });
});

describe('F-WX-5 CanvasPlayerUIHost mountCanvas（平台中立，无 DOM 容器）', () => {
  let capturedPointer: ((x: number, y: number) => void) | null = null;
  let host: CanvasPlayerUIHost;
  let fired: Record<string, string[]> = {};
  /** 微信画布：物理像素 + 2D ctx + 无 style（无 DOM） */
  let wxCanvas: HTMLCanvasElement;

  beforeEach(() => {
    capturedPointer = null;
    fired = {};
    const core = createWebCore();
    bindPlatformCore({
      ...core,
      // F-WX-6.1：注入固定 dpr=1 的 viewport，隔离其它测试对 globalThis.window
      // （devicePixelRatio）的污染——否则 mountCanvas 的 cssW/canvas.width/dpr 变化
      // 导致 host 内部 scale 与 tapPhysical 的固定换算失配（跨文件 flaky）。
      createViewport: () => ({
        surface: () => ({
          width: wxCanvas.width,
          height: wxCanvas.height,
          devicePixelRatio: 1,
          now: () => 0,
        }),
        onResize: () => {},
        safeInsets: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
      }),
      input: {
        bindClick: () => {},
        bindPointer: (_t: EventTarget, h: (x: number, y: number) => void) => {
          capturedPointer = h;
        },
      },
    } as Parameters<typeof bindPlatformCore>[0]);
    wxCanvas = {
      getContext: () => makeStubCtx(),
      width: 750,
      height: 1334,
      style: undefined, // 微信 canvas 无 DOM style
    } as unknown as HTMLCanvasElement;
    host = new CanvasPlayerUIHost(wxCanvas);
    host.mountCanvas(); // 平台中立挂载：不碰 style/appendChild
    host.setActions({
      onToggleGarageSlot: (k) => void (fired['toggle'] = [...(fired['toggle'] ?? []), k]),
      onPickGarageOption: (v) => void (fired['pick'] = [...(fired['pick'] ?? []), v]),
      onFindOpponent: () => void (fired['find'] = [...(fired['find'] ?? []), 'x']),
      onMatchAdjust: () => void (fired['matchAdjust'] = [...(fired['matchAdjust'] ?? []), 'x']),
      onStartBattle: () => void (fired['startBattle'] = [...(fired['startBattle'] ?? []), 'x']),
      onResultAdjust: () => void (fired['resultAdjust'] = [...(fired['resultAdjust'] ?? []), 'x']),
      onResultNext: () => void (fired['next'] = [...(fired['next'] ?? []), 'x']),
      onClaimRewardAd: () => void (fired['reward'] = [...(fired['reward'] ?? []), 'x']),
      onMerge: () => void (fired['merge'] = [...(fired['merge'] ?? []), 'x']),
      onResetProgress: () => {},
    });
  });

  afterEach(() => {
    bindPlatformCore(createWebCore());
  });

  /** 物理像素坐标点击（逻辑坐标按 ensureSize 同源换算） */
  function tapPhysical(id: string): void {
    const areas = host.getHitAreasForTest();
    const a = areas.find((x) => x.id === id);
    expect(a, `应存在命中区 ${id}`).toBeTruthy();
    expect(capturedPointer).toBeTruthy();
    const w = Math.max(1, wxCanvas.width);
    const h = Math.max(1, wxCanvas.height);
    const scale = Math.min(w / 1280, h / 720);
    const ox = (w - 1280 * scale) / 2;
    const oy = (h - 720 * scale) / 2;
    capturedPointer!(ox + (a!.x + a!.w / 2) * scale, oy + (a!.y + a!.h / 2) * scale);
  }

  it('750×1334：mountCanvas 渲染 + 物理坐标命中 CTA → onFindOpponent（验收 viewport）', () => {
    host.render(garageState());
    expect(() => host.render(garageState())).not.toThrow();
    tapPhysical('cta-find');
    expect(fired['find']).toHaveLength(1);
  });

  it('828×1792（不同 viewport）：渲染 + 命中不随分辨率漂移（验收多 viewport）', () => {
    wxCanvas.width = 828;
    wxCanvas.height = 1792;
    host.render(garageState());
    expect(() => host.render(garageState({ playerPhase: 'matching' }))).not.toThrow();
    host.render(garageState()); // 回到 Garage（matching 无 CTA 命中区）
    tapPhysical('cta-find');
    expect(fired['find']).toHaveLength(1);
  });

  it('无 style 的微信 canvas：战斗 HUD 渲染不抛（draw 内 style 守卫）', () => {
    host.render(garageState());
    expect(() => {
      host.render({ ...garageState(), battleState: 'fighting' });
      host.renderBattleFrame({
        battleState: 'fighting',
        battleStatus: { phase: 'Active', sideA: { hp: 100, maxHp: 100 }, sideB: { hp: 100, maxHp: 100 } },
        phaseCountdownText: null,
      });
    }).not.toThrow();
  });

  it('F-WX-8-C｜Result 出现后 HUD 自动降级隐藏（draw 内 result 优先分支，HUD 让位）', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { fileURLToPath } = require('node:url') as typeof import('node:url');
    const src = readFileSync(
      fileURLToPath(new URL('../src/ui/canvasPlayerUIHost.ts', import.meta.url)),
      'utf8',
    );
    // draw()：ended + result → 只画 Result（覆盖层独占），不再画 HUD
    expect(src).toMatch(
      /if \(state\.result\) \{\s*\n\s*this\.drawResult\(state\);\s*\n\s*\} else \{\s*\n\s*if \(this\.lastFrame\) this\.drawHud\(this\.lastFrame\);/,
    );
  });
});
