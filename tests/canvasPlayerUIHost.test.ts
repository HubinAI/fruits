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
import type { PlayerUIState, PlayerUIActions } from '../src/ui/playerUI';

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

/**
 * F-NAV-ACTION-OWNERSHIP-P0：正式首页（Mobile 横屏）验收环境——旧「Garage 点 cta-find」
 * 契约已删除（Garage/Backpack/More 无寻找对手）；寻找对手只属首页，用真实横屏首页验收。
 */
function makeHomeEnv(vp: { w: number; h: number }): {
  host: CanvasPlayerUIHost;
  render: (over?: Partial<PlayerUIState>) => void;
  click: (id: string) => void;
  fired: Record<string, string[]>;
} {
  let captured: ((x: number, y: number) => void) | null = null;
  const core = createWebCore();
  bindPlatformCore({
    ...core,
    createViewport: () => ({
      surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 }),
      onResize: () => {},
      safeInsets: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
    }),
    input: { bindClick: () => {}, bindPointer: (_t: EventTarget, h: (x: number, y: number) => void) => { captured = h; } },
  } as Parameters<typeof bindPlatformCore>[0]);
  const canvas = { getContext: () => makeStubCtx(), width: vp.w, height: vp.h, style: undefined } as unknown as HTMLCanvasElement;
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas();
  const fired: Record<string, string[]> = {};
  host.setActions({ onFindOpponent: () => void (fired['find'] = [...(fired['find'] ?? []), 'x']) } as unknown as PlayerUIActions);
  return {
    host,
    render: (over: Partial<PlayerUIState> = {}) => void host.render({ ...garageState(), ...over }),
    click: (id: string) => {
      const a = host.getHitAreasForTest().find((x) => x.id === id);
      expect(a, `应存在命中区 ${id}`).toBeTruthy();
      expect(captured).toBeTruthy();
      captured!(a!.x + a!.w / 2, a!.y + a!.h / 2);
    },
    fired,
  };
}

const RESULT_STATE: PlayerUIState = {
  ...garageState(),
  battleState: 'ended',
  result: { winner: 'A', hpA: 80, hpB: 0 },
  reward: { kind: 'functional', name: '炮', starStr: '★', cat: '武器', countAfter: 2 },
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
      onFuse: (_d?: string, _s?: number) => void (fired['fuse'] = [...(fired['fuse'] ?? []), 'x']),
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

  it('首页（Mobile 横屏）：点「寻找对手」home-find-opponent → onFindOpponent（输入经 bindPointer）', () => {
    // F-NAV-ACTION-OWNERSHIP-P0：旧「Garage 点 cta-find」契约已删除（Garage/Backpack/More
    // 无寻找对手）；寻找对手只属正式首页——用 Mobile 横屏首页环境验收
    const env = makeHomeEnv({ w: 844, h: 390 });
    env.render();
    env.click('home-find-opponent');
    expect(env.fired['find']).toHaveLength(1);
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

  it('Garage：背包合成 → onFuse（规则在 runtime，Host 只派发）', () => {
    // Garage 首屏无旧「合成」入口（合成迁入背包页）
    host.render(garageState());
    expect(host.getHitAreasForTest().map((a) => a.id)).not.toContain('merge');
    // 给足 1★ 副本 → 进入背包 → 选中 cannon → 点合成 → onFuse 派发
    const inv = getInventory();
    inv['cannon'] = { one: 6, two: 0 }; // 未装备 1★ 副本 ≥5 → 可合成
    host.render(garageState({ inventory: inv, progress: { coin: 500, rating: 0 } }));
    click('nav:backpack');
    click('backpack-select:cannon');
    click('backpack-fuse');
    expect(fired['fuse']).toHaveLength(1);
  });

  it('F-META-5｜Result Modal：点「下一场」→ onResultNext；点「调整配置」→ onResultAdjust', () => {
    host.render(RESULT_STATE);
    expect(host.getHitAreasForTest().some((a) => a.id === 'modal-primary'), '结算 Modal 出现').toBe(true);
    click('modal-primary');
    expect(fired['next']).toHaveLength(1);
  });

  it('F-META-5｜Result Modal：调整配置 → onResultAdjust（次按钮）', () => {
    host.render(RESULT_STATE);
    click('modal-secondary');
    expect(fired['resultAdjust']).toHaveLength(1);
  });

  it('F-UX-3C｜Result Modal：广告可用时奖励区内有「额外…看广告」入口 → onClaimRewardAd（不关闭）', () => {
    host.render(RESULT_STATE);
    click('modal-ad');
    expect(fired['reward']).toHaveLength(1);
    expect(host.getHitAreasForTest().some((a) => a.id === 'modal-ad'), '广告入口仍在（不关闭）').toBe(true);
    // F-UX-3C：底部只剩两个流程决策（无第三个同级按钮）
    const ids = host.getHitAreasForTest().map((a) => a.id);
    expect(ids).not.toContain('modal-tertiary');
    expect(ids).toContain('modal-secondary');
    expect(ids).toContain('modal-primary');
  });

  it('F-UX-3C｜Result Modal：广告不可用时不注册 modal-ad 命中区；无广告时底部仍两决策', () => {
    host.render({ ...RESULT_STATE, rewardAdAvailable: false });
    const ids = host.getHitAreasForTest().map((a) => a.id);
    expect(ids).not.toContain('modal-ad');
    expect(ids).toContain('modal-primary');
    expect(ids).toContain('modal-secondary');
  });

  it('Matching：只画 VS，无命中区（纯表现）', () => {
    host.render(garageState({ playerPhase: 'matching' }));
    expect(host.getHitAreasForTest()).toHaveLength(0);
  });

  it('F-META-UX3｜Matching 连续画面：搜索与锁定均无按钮/无空白交互层；锁定状态渲染不抛', () => {
    // 搜索中：无命中区（车辆由 renderer previewFixed 绘制，UI 只加标注 + 扫描占位）
    host.render(garageState({ playerPhase: 'matching' }));
    expect(host.getHitAreasForTest()).toHaveLength(0);
    // 已锁定（正常流程 matchBarHidden=true）：同一画面无「开始战斗」按钮（禁止新增确认步骤）
    expect(() =>
      host.render(
        garageState({
          playerPhase: 'matchPreview',
          matchBarHidden: true,
          opponent: { bodyName: '香蕉车', parts: [], drive: '前进' },
        }),
      ),
    ).not.toThrow();
    expect(host.getHitAreasForTest(), 'matchPreview 正常流程无开始战斗按钮').toHaveLength(0);
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
  let host: CanvasPlayerUIHost;
  let fired: Record<string, string[]> = {};
  /** 微信画布：物理像素 + 2D ctx + 无 style（无 DOM） */
  let wxCanvas: HTMLCanvasElement;

  beforeEach(() => {
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
        bindPointer: () => {},
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
      onFuse: (_d?: string, _s?: number) => void (fired['fuse'] = [...(fired['fuse'] ?? []), 'x']),
      onResetProgress: () => {},
    });
  });

  afterEach(() => {
    bindPlatformCore(createWebCore());
  });

  it('Mobile 横屏（mountCanvas）：物理坐标命中首页 home-find-opponent → onFindOpponent（验收 viewport）', () => {
    // F-NAV-ACTION-OWNERSHIP-P0：微信输入验收从「Garage cta-find」改为「首页 home-find-opponent」
    const env = makeHomeEnv({ w: 750, h: 390 });
    env.render();
    expect(() => env.render()).not.toThrow();
    env.click('home-find-opponent');
    expect(env.fired['find']).toHaveLength(1);
  });

  it('不同 viewport（828×390）：渲染 + 命中不随分辨率漂移（验收多 viewport）', () => {
    const env = makeHomeEnv({ w: 828, h: 390 });
    env.render();
    expect(() => env.render({ playerPhase: 'matching' })).not.toThrow();
    env.render(); // 回到首页（matching 无 home-find-opponent 命中区）
    env.click('home-find-opponent');
    expect(env.fired['find']).toHaveLength(1);
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
      /if \(state\.result\) \{\s*\n\s*\/\/ F-META-5[^\n]*\n\s*if \(!this\.isMobile\) this\.drawResult\(state\);\s*\n\s*\} else \{\s*\n\s*if \(this\.lastFrame\) this\.drawHud\(this\.lastFrame\);/,
    );
  });
});
