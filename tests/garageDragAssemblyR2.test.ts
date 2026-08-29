import { describe, it, expect } from 'vitest';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { defaultInventory } from '../src/core/partInventory';
import { registry } from '../src/core/content';
import { V } from '../src/ui/visualTokens';
import type { PlayerUIState, PlayerUIActions } from '../src/ui/playerUI';
import type { SafeInsets, PointerGestureHandlers } from '../src/platform/types';

/**
 * F-GARAGE-TOUCH-ASSEMBLY-R2｜拖装连续性 + 挂点吸附反馈收敛（targeted）
 *
 * 调查先行（Must#1 逐帧状态链）：既有状态机（F-GARAGE-DRAG-ASSEMBLY-P0 / CONTINUITY-R1）
 * 已实现方向锁 / ghost 连续 / 吸附 / 替换 / 空白处取消 / 装备灰态。本 R2 真实缺口有二：
 *   ① Must#4：拖动态 drawVehicleHardpoints 对【每个兼容挂点】都画粗蓝环、对【每个已占用兼容挂点】
 *      都画白色虚线外环 → 「挂点圆圈 + 占用虚线同时出现」反馈过杂，玩家无法判断应松手何处。
 *   ② Must#8：cancelInteraction() 全仓库无调用方；installDragSafetyNet 在微信（typeof window==='undefined'）
 *      直接 return，onHide 不清理手势状态 → 切后台后手势残留。
 *
 * T1  拖动态「只最近的一个有效挂点」为吸附目标：远端 hoverHp=null；移到 rear→'rear'；移到 front→'front'。
 * T2  渲染去噪（Must#4）：远端帧零金色环、旧粗蓝环(rgba(150,205,255,0.95))消失、两兼容挂点均弱提示；
 *      最近帧恰 1 个金色吸附环、其余兼容挂点弱提示。
 * T3  切后台清理（Must#8）：平台生命周期 hidden → garageDrag 归零（覆盖微信 onHide）。
 * T4  离开 Garage 清理（Must#8）：render(playerPhase!=='garage') 时拖动态归零。
 */
const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };
const VP = { w: 844, h: 390 };

type HardPt = { id: string; kind: 'movement' | 'functional'; x: number; y: number; occupied: boolean };

const HPS: HardPt[] = [
  { id: 'rear', kind: 'movement', x: 280, y: 181, occupied: true },
  { id: 'front', kind: 'movement', x: 560, y: 181, occupied: true },
  { id: 'top', kind: 'functional', x: 420, y: 120, occupied: false },
];

function garageState(over: Partial<PlayerUIState> = {}): PlayerUIState {
  return {
    uiMode: 'build',
    battleState: 'editing',
    playerPhase: 'garage',
    draft: makeStarterDraft('boxBody', registry),
    draftValid: true,
    blockReason: null,
    garageSelected: 'frontWheel',
    inventory: defaultInventory(),
    progress: { coin: 0, rating: 0 },
    onboarding: 'done',
    resetDevVisible: false,
    opponent: null,
    matchBarHidden: true,
    hardpointScreenPts: HPS,
    result: null,
    reward: null,
    economy: null,
    resultOnboardingVisible: false,
    rewardAdClaimed: false,
    rewardAdAvailable: false,
    readyOverlayVisible: false,
    ...over,
  };
}

type Handlers = Required<Pick<PointerGestureHandlers, 'onDown' | 'onMove' | 'onUp'>> &
  Pick<PointerGestureHandlers, 'captureOnDown' | 'preventDefaultOnMove'>;

type Env = {
  host: CanvasPlayerUIHost;
  gh: {
    down(x: number, y: number, meta?: { pointerId?: number | null; pointerType?: string | null }): void;
    move(x: number, y: number): void;
    up(x: number, y: number, cancelled?: boolean): void;
  };
  areas: () => ReadonlyArray<{ id: string; x: number; y: number; w: number; h: number }>;
  drag: () => { phase: string; x: number; y: number; pointerId: number | null; pointerType: string | null; hoverHp: string | null } | null;
  ops: Array<{ type: string; r?: number; strokeStyle: string; fillStyle?: string }>;
  hiddenCb: () => ((hidden: boolean) => void) | null;
};

/** 记录 Canvas 2D 调用的轻量 ctx（同 Continuity 桩，但捕获 arc/stroke/fill 时的 strokeStyle） */
function makeRecordingCtx(): { ctx: unknown; ops: Env['ops'] } {
  const ops: Env['ops'] = [];
  let strokeStyle = '#000';
  let fillStyle = '#000';
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t: Record<string, unknown>, prop: string | symbol) {
      if (prop === 'strokeStyle') return strokeStyle;
      if (prop === 'fillStyle') return fillStyle;
      return (...args: unknown[]) => {
        if (prop === 'arc') ops.push({ type: 'arc', r: args[2] as number, strokeStyle });
        else if (prop === 'stroke') ops.push({ type: 'stroke', strokeStyle });
        else if (prop === 'fill') ops.push({ type: 'fill', strokeStyle, fillStyle });
        else if (prop === 'fillRect') ops.push({ type: 'fillRect', strokeStyle });
        else if (prop === 'strokeRect') ops.push({ type: 'strokeRect', strokeStyle });
        return { width: 0 };
      };
    },
    set(_t: Record<string, unknown>, prop: string | symbol, val: unknown) {
      if (prop === 'strokeStyle') strokeStyle = val as string;
      else if (prop === 'fillStyle') fillStyle = val as string;
      return true;
    },
  };
  return { ctx: new Proxy({}, handler), ops };
}

function mountEnv(): Env {
  const core = createWebCore();
  const handlers: Partial<Handlers> = {};
  let hiddenCb: ((hidden: boolean) => void) | null = null;
  bindPlatformCore({
    ...core,
    input: {
      bindClick: () => {},
      bindPointer: () => {},
      bindGesture: (_t: EventTarget, hs: PointerGestureHandlers) => {
        handlers.onDown = hs.onDown;
        handlers.onMove = hs.onMove;
        handlers.onUp = hs.onUp;
        handlers.captureOnDown = hs.captureOnDown;
        handlers.preventDefaultOnMove = hs.preventDefaultOnMove;
      },
    },
    createViewport: () => ({
      surface: () => ({ width: VP.w, height: VP.h, devicePixelRatio: 1, now: () => 0 }),
      onResize: () => {},
      safeInsets: () => INSETS,
    }),
    // Must#8：提供可捕获的 platform 生命周期（Web + 微信统一入口）
    lifecycle: {
      now: () => 0,
      requestAnimationFrame: () => 0,
      cancelAnimationFrame: () => {},
      onVisibilityChange: (cb: (hidden: boolean) => void) => {
        hiddenCb = cb;
      },
    },
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  const rec = makeRecordingCtx();
  const canvas = {
    getContext: () => rec.ctx,
    width: VP.w,
    height: VP.h,
    style: undefined,
  } as unknown as HTMLCanvasElement;
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas();
  host.setActions({
    onToggleGarageSlot: () => {},
    selectGarageSlot: () => {},
    onPickGarageOption: () => {},
    onFindOpponent: () => {},
    onMatchAdjust: () => {},
    onStartBattle: () => {},
    onResultAdjust: () => {},
    onResultNext: () => {},
    onClaimRewardAd: () => {},
    onMerge: () => {},
    onResetProgress: () => {},
    setGarageBackdrop: () => {},
    reframeCamera: () => {},
  } as unknown as PlayerUIActions);
  return {
    host,
    gh: {
      down: (x, y, meta) => {
        if (handlers.captureOnDown) handlers.captureOnDown(x, y);
        (handlers.onDown as Handlers['onDown'])(x, y, meta);
      },
      move: (x, y) => (handlers.onMove as Handlers['onMove'])(x, y),
      up: (x, y, cancelled = false) => (handlers.onUp as Handlers['onUp'])(x, y, cancelled),
    },
    areas: () => host.getHitAreasForTest(),
    drag: () => {
      const d = (host as unknown as {
        garageDrag: { phase: string; x: number; y: number; pointerId: number | null; pointerType: string | null; hoverHp: string | null } | null;
      }).garageDrag;
      return d ? { phase: d.phase, x: d.x, y: d.y, pointerId: d.pointerId, pointerType: d.pointerType, hoverHp: d.hoverHp } : null;
    },
    ops: rec.ops,
    hiddenCb: () => hiddenCb,
  };
}

function enterGarage(env: Env, cat: 'body' | 'move' | 'combat' = 'move'): void {
  env.host.render(garageState());
  const home = env.areas().find((a) => a.id === 'home-garage');
  if (home) {
    env.gh.down(home.x + home.w / 2, home.y + home.h / 2);
    env.gh.up(home.x + home.w / 2, home.y + home.h / 2);
  }
  (env.host as unknown as { garageCategory: 'body' | 'move' | 'combat' }).garageCategory = cat;
  env.host.render(garageState());
}

function firstCard(env: Env): { id: string; x: number; y: number; w: number; h: number } {
  const c = env.areas().find((a) => a.id.startsWith('opt:'));
  if (!c) throw new Error('无部件卡');
  return c;
}

function startDrag(env: Env): { x: number; y: number; w: number; h: number } {
  const card = firstCard(env);
  env.gh.down(card.x + card.w / 2, card.y + card.h / 2);
  env.gh.move(card.x + card.w / 2, card.y + card.h / 2 - 8); // 向上累计 8px → draggingPart
  expect(env.drag()?.phase, '进入 draggingPart').toBe('draggingPart');
  return card;
}

describe('F-GARAGE-TOUCH-ASSEMBLY-R2｜拖装连续性 + 挂点吸附反馈收敛', () => {
  it('T1. 拖动态只最近的一个有效挂点为吸附目标（hoverHp 单点切换）', () => {
    const env = mountEnv();
    enterGarage(env, 'move');
    startDrag(env);
    // 远端（两挂点连线中点）→ 无最近兼容挂点
    env.gh.move(420, 181);
    expect(env.drag()?.hoverHp, '远端：无吸附目标').toBeNull();
    expect(env.drag()?.phase).toBe('draggingPart');
    // 移到 rear 附近（release 半径内）→ 最近=rear
    env.gh.move(280, 179);
    expect(env.drag()?.hoverHp, '最近=rear').toBe('rear');
    // 移到 front 附近 → 最近切换为 front（仅一个目标）
    env.gh.move(560, 179);
    expect(env.drag()?.hoverHp, '最近切换=front').toBe('front');
    // 同时 rear/front 不得同时为 hover（只突出一个）
    env.gh.move(420, 181);
    expect(env.drag()?.hoverHp).toBeNull();
  });

  it('T2. 挂点渲染去噪（Must#4）：仅最近挂点金色，其余弱提示，旧粗蓝环消失', () => {
    const env = mountEnv();
    enterGarage(env, 'move');
    startDrag(env);
    // 仅统计「挂点环」量级的金色弧（r∈[12,22]）：排除 ghost 部件图标内更小的弧，避免误判
    const goldArcs = (): number =>
      env.ops.filter(
        (o) => o.type === 'arc' && o.strokeStyle === V.primary && (o.r ?? 0) >= 12 && (o.r ?? 0) <= 22,
      ).length;
    const weakArcs = (): number =>
      env.ops.filter((o) => o.type === 'arc' && o.strokeStyle === 'rgba(150,205,255,0.35)').length;
    const boldArcs = (): number =>
      env.ops.filter((o) => o.type === 'arc' && o.strokeStyle === 'rgba(150,205,255,0.95)').length;

    // 远端帧
    env.ops.length = 0;
    env.gh.move(420, 181);
    expect(goldArcs(), '远端：无金色吸附环').toBe(0);
    expect(boldArcs(), '远端：旧粗蓝环已移除（不再每个兼容挂点都画粗环）').toBe(0);
    expect(weakArcs(), '远端：两个兼容挂点均显弱提示').toBe(2);

    // 最近=rear 帧
    env.ops.length = 0;
    env.gh.move(280, 179);
    expect(env.drag()?.hoverHp).toBe('rear');
    expect(goldArcs(), '最近挂点：唯一金色吸附环').toBe(1);
    expect(weakArcs(), '最近挂点：其余兼容挂点弱提示').toBe(1);
    expect(boldArcs(), '最近挂点：不再画粗蓝环').toBe(0);
  });

  it('T3. 切后台清理（Must#8）：平台生命周期 hidden → garageDrag 归零', () => {
    const env = mountEnv();
    enterGarage(env, 'move');
    startDrag(env);
    const cb = env.hiddenCb();
    expect(cb, 'installDragSafetyNet 已订阅平台生命周期').not.toBeNull();
    cb!(true); // 模拟微信 onHide / Web visibilitychange(hidden)
    expect(env.drag(), '切后台后手势状态全部清理（idle/null）').toBeNull();
  });

  it('T4. 离开 Garage 清理（Must#8）：render(playerPhase!=="garage") 时拖动态归零', () => {
    const env = mountEnv();
    enterGarage(env, 'move');
    startDrag(env);
    env.host.render(garageState({ playerPhase: 'matching' }));
    expect(env.drag(), '离开 Garage 后手势状态归零').toBeNull();
  });
});
