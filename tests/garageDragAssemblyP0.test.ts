import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { computeMobileGarageLayout } from '../src/ui/mobileGarageLayout';
import { resolveLayoutProfile } from '../src/ui/layoutProfile';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { WechatInput } from '../src/platform/wechat/input';
import { makeStarterDraft, buildSnapshotFromDraft, EMPTY_SLOT } from '../src/lab/buildEditorModel';
import { defaultInventory } from '../src/core/partInventory';
import { registry } from '../src/core/content';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import type { PlayerUIState, PlayerUIActions } from '../src/ui/playerUI';
import type { SafeInsets } from '../src/platform/types';

/**
 * F-GARAGE-DRAG-ASSEMBLY-P0｜底部部件 → 真实挂点 拖放装配（targeted）
 *
 * T1  状态机 7 态：partPressed → draggingPart → hoveringValidMount → completed（+无效态）。
 * T2  方向锁：横滑 → stripScrolling（本次手势不装备）；垂直上移 ≥8px → draggingPart。
 * T3  落点取【最近】兼容挂点（Must#6：不是数组第一个）。
 * T4  DPR1 与 DPR1.5 落点一致（logical 坐标同源）。
 * T5  一次 pointerup 只触发一次装备回调（Forbidden）。
 * T6  无效释放（车辆空白处）→ 无装备、配置不变。
 * T7  超载：兼容挂点红环 → 松开不装备，装配带显示超载差值（Must#11）。
 * T8  未获得部件不能进入有效拖动（按下显示锁定原因）。
 * T9  车身卡拖到车辆主体区域（stageRect）→ 切换车身（Must#12）。
 * T10 点击备用路径：多挂点 → armed（不自动装默认挂点）；点挂点后装备（Must#15）。
 * T11 pointercancel / 系统取消 → 清理 ghost，配置不变（Must#10）。
 * T12 WeChat touch start/move/end/cancel 走同一状态机（Must#2）。
 * T13 挂点视觉半径与释放判定半径同源（Must#7）。
 * T14 「空」拖到已装备挂点 → 只移除该挂点部件（Acceptance F）。
 */
const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };
const STORAGE_V2 = 'strongfruit.ownedParts.v2';
/**
 * 主视口：mobile profile（与 F-GARAGE-CENTER-STAGE-P0 门禁一致；1920 会走 Desktop dock）。
 * 战斗分类 13 张卡超出可视宽 → enterGarage 把卡带滚到末尾，使后半段卡片完全可见
 * （只有完全可见的卡才注册命中区，与视觉一致）。
 */
const VP = { w: 844, h: 390 };

type HardPt = { id: string; kind: 'movement' | 'functional'; x: number; y: number; occupied: boolean };

function garageState(hps: HardPt[], over: Partial<PlayerUIState> = {}): PlayerUIState {
  return {
    uiMode: 'build',
    battleState: 'editing',
    playerPhase: 'garage',
    draft: makeStarterDraft('boxBody', registry),
    draftValid: true,
    blockReason: null,
    garageSelected: 'front',
    inventory: defaultInventory(),
    progress: { coin: 0, rating: 0 },
    onboarding: 'done',
    resetDevVisible: false,
    opponent: null,
    matchBarHidden: true,
    hardpointScreenPts: hps,
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

/** Renderer 真实挂点（Garage previewSolo 取景；与玩家所见同源，不虚构坐标） */
function realHardpoints(vp: { w: number; h: number }, dpr = 1): HardPt[] {
  const canvas = {
    getContext: () => new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true }),
    width: Math.round(vp.w * dpr),
    height: Math.round(vp.h * dpr),
    clientWidth: vp.w,
    clientHeight: vp.h,
  } as unknown as HTMLCanvasElement;
  const o = new PlanckBattleOrchestrator(
    buildSnapshotFromDraft(makeStarterDraft('boxBody', registry), registry, 'a'),
    buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'b'),
    registry,
    { autoDrive: true },
    true,
  );
  const r = new Renderer(canvas, new VisualRegistry(), {
    width: Math.round(vp.w * dpr),
    height: Math.round(vp.h * dpr),
    devicePixelRatio: dpr,
  } as never);
  const snap = o.getRenderSnapshot();
  r.resize(snap.arena.width, o.arena.config.height);
  const profile = resolveLayoutProfile(vp.w, vp.h);
  const l = computeMobileGarageLayout(vp, INSETS, profile);
  r.reframe(snap, 'previewSolo', { framingRect: { ...l.stageRect, mode: 'garage' } });
  return r.getVehicleHardpointScreenPts(snap, 'a');
}

type Env = {
  host: CanvasPlayerUIHost;
  gh: { down(x: number, y: number): void; move(x: number, y: number): void; up(x: number, y: number, cancelled?: boolean): void };
  areas: () => ReadonlyArray<{ id: string; x: number; y: number; w: number; h: number }>;
  calls: { pick: string[]; selectSlot: string[]; toggleSlot: string[] };
  drag: () => { phase: string | null; hoverHp: string | null; armed: boolean; overload: boolean } | null;
  notice: () => string | null;
  /** 按布局计算某张卡中心（未获得卡不注册 hitArea，只能用布局定位） */
  cardCenter: (v: string, st: PlayerUIState) => { x: number; y: number; w: number } | null;
  /** 当前帧卡片带 rect（可见性判定） */
  rowRect: () => { x: number; y: number; w: number; h: number } | null;
  /** 诊断：bindGesture 是否已被调用（平台/桩是否提供手势能力） */
  gestureBound: () => boolean;
};

/** 构建 host + 手势驱动（优先 bindGesture，与真实 Web / WeChat 路径一致） */
function mountEnv(
  vp: { w: number; h: number },
  opts: { inventory?: Record<string, { one: number; two: number }>; input?: unknown; dpr?: number } = {},
): Env {
  const core = createWebCore();
  // WebStorage 在无 localStorage 环境静默降级（getItem→null），故用内存桩注入库存，
  // 使 canEquipPart（装备守卫）在测试中真实生效。
  const mem = new Map<string, string>();
  if (opts.inventory) mem.set(STORAGE_V2, JSON.stringify({ version: 2, ...opts.inventory }));
  const handlers: { onDown?: (x: number, y: number) => void; onMove?: (x: number, y: number) => void; onUp?: (x: number, y: number, c: boolean) => void } = {};
  const dpr = opts.dpr ?? 1;
  bindPlatformCore({
    ...core,
    storage: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
    },
    input: ((opts.input ?? {
      bindClick: () => {},
      bindPointer: () => {},
      bindGesture: (_t: EventTarget, hs: { onDown: (x: number, y: number) => void; onMove: (x: number, y: number) => void; onUp: (x: number, y: number, c: boolean) => void }) => {
        handlers.onDown = hs.onDown;
        handlers.onMove = hs.onMove;
        handlers.onUp = hs.onUp;
      },
    }) as never),
    createViewport: () => ({
      surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: dpr, now: () => 0 }),
      onResize: () => {},
      safeInsets: () => INSETS,
    }),
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  const canvas = {
    getContext: () => new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true }),
    width: vp.w,
    height: vp.h,
    style: undefined,
  } as unknown as HTMLCanvasElement;
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas();
  const calls = { pick: [] as string[], selectSlot: [] as string[], toggleSlot: [] as string[] };
  const actions: PlayerUIActions = {
    onToggleGarageSlot: (k) => calls.toggleSlot.push(k),
    selectGarageSlot: (k) => calls.selectSlot.push(k),
    onPickGarageOption: (v) => calls.pick.push(v),
    onFindOpponent: () => {},
    onMatchAdjust: () => {},
    onStartBattle: () => {},
    onResultAdjust: () => {},
    onResultNext: () => {},
    onClaimRewardAd: () => {},
    onFuseCategory: () => null,
    onResetProgress: () => {},
    // F-GARAGE-CENTER-STAGE-P0：导航/背景切换（桩需提供，host 用 ?.() 双可选调用）
    setGarageBackdrop: () => {},
    reframeCamera: () => {},
  };
  host.setActions(actions);
  return {
    host,
    gh: {
      down: (x, y) => handlers.onDown!(x, y),
      move: (x, y) => handlers.onMove!(x, y),
      up: (x, y, cancelled = false) => handlers.onUp!(x, y, cancelled),
    },
    areas: () => host.getHitAreasForTest(),
    calls,
    drag: () => {
      const d = (host as unknown as { garageDrag: { phase: string; hoverHp: string | null; armed: boolean; overload: boolean } | null }).garageDrag;
      return d ? { phase: d.phase, hoverHp: d.hoverHp, armed: d.armed, overload: d.overload } : null;
    },
    notice: () => (host as unknown as { garageDragNotice: string | null }).garageDragNotice,
    cardCenter: (v, st) => {
      const row = (host as unknown as { stripCardRow: { x: number; y: number; w: number; h: number } | null })
        .stripCardRow;
      if (!row || !st.draft) return null;
      const lay = (
        host as unknown as {
          garageStripCardLayout(
            s: PlayerUIState,
            d: unknown,
            r: unknown,
          ): { opts: Array<{ v: string }>; startX: number; cardW: number; gap: number } | null;
        }
      ).garageStripCardLayout.call(host, st, st.draft, row);
      if (!lay) return null;
      let cx = lay.startX;
      for (const c of lay.opts) {
        if (c.v === v) return { x: cx + lay.cardW / 2, y: row.y + row.h / 2, w: lay.cardW };
        cx += lay.cardW + lay.gap;
      }
      return null;
    },
    rowRect: () =>
      (host as unknown as { stripCardRow: { x: number; y: number; w: number; h: number } | null }).stripCardRow,
    gestureBound: () => !!handlers.onDown,
  };
}

/** 滚动到某张卡完全可见（按布局判定，不依赖 hitArea——未获得卡不注册命中区） */
function scrollToValue(env: Env, st: PlayerUIState, v: string): { x: number; y: number } | null {
  const scroll = env.host as unknown as { garageStripScroll: number };
  for (let s = 0; s <= 4200; s += 140) {
    scroll.garageStripScroll = s;
    env.host.render(st);
    const c = env.cardCenter(v, st);
    const row = env.rowRect()!;
    if (c && c.x - c.w / 2 >= row.x - 0.5 && c.x + c.w / 2 <= row.x + row.w + 0.5) {
      return { x: c.x, y: c.y };
    }
  }
  return null;
}

/** 进入 Garage 装配页：设置分类 → 渲染一帧（建立 hitAreas / stripCardRow / 挂点） */
function enterGarage(
  env: Env,
  hps: HardPt[],
  over: Partial<PlayerUIState> = {},
  cat: 'body' | 'move' | 'combat' = 'combat',
  /** 需要完全可见（注册命中区）的卡片 id；给出则横向滚动到它可见 */
  cardId?: string,
): PlayerUIState {
  const st = garageState(hps, over);
  // metaPage 默认 'home'（正式首页）→ 先经真实点击进入装配页（metaPage='garage'）
  env.host.render(st);
  const home = env.areas().find((a) => a.id === 'home-garage');
  if (home) {
    env.gh.down(home.x + home.w / 2, home.y + home.h / 2);
    env.gh.up(home.x + home.w / 2, home.y + home.h / 2);
  }
  (env.host as unknown as { garageCategory: 'body' | 'move' | 'combat' }).garageCategory = cat;
  // playerPhase='garage' + metaPage='garage' → isStripGestureTarget() 成立
  env.host.render(st);
  if (cardId) {
    // 战斗分类卡带超宽（23 张）→ 横向滚动到目标卡完全可见（只有完全可见的卡注册命中区）
    const scroll = env.host as unknown as { garageStripScroll: number };
    for (let s = 0; s <= 4200; s += 140) {
      scroll.garageStripScroll = s;
      env.host.render(st);
      if (env.areas().some((a) => a.id === cardId)) return st;
    }
  }
  return st;
}

/** 从某张卡片向上拖到目标点（分段 move，模拟真实指针流） */
function dragCard(env: Env, cardId: string, to: { x: number; y: number }): void {
  const card = env.areas().find((a) => a.id === cardId)!;
  const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
  env.gh.down(from.x, from.y);
  env.gh.move(from.x, from.y - 5);
  env.gh.move(from.x, from.y - 12); // dy ≤ -8 且 |dy| > |dx| → draggingPart
  env.gh.move(to.x, to.y);
  env.gh.up(to.x, to.y);
}

describe('F-GARAGE-DRAG-ASSEMBLY-P0｜底部部件 → 真实挂点 拖放装配', () => {
  afterEach(() => {
    const core = createWebCore();
    core.storage.removeItem?.(STORAGE_V2);
    bindPlatformCore(core);
  });

  it('T1. 状态机 7 态：partPressed → draggingPart → hoveringValidMount → completed', () => {
    const hps = realHardpoints(VP);
    const env = mountEnv(VP, { inventory: { thruster: { one: 1, two: 0 } } });
    enterGarage(env, hps, {}, 'combat', 'opt:thruster@1');
    const hp = hps.find((p) => p.kind === 'functional' && p.id === 'top')!;
    const card = env.areas().find((a) => a.id === 'opt:thruster@1')!;
    expect(card, 'thruster 卡片存在').toBeTruthy();
    const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };

    env.gh.down(from.x, from.y);
    expect(env.drag()?.phase, '按下 → partPressed').toBe('partPressed');
    env.gh.move(from.x, from.y - 12);
    expect(env.drag()?.phase, '向上拖 → draggingPart').toBe('draggingPart');
    env.gh.move(hp.x, hp.y);
    expect(env.drag()?.phase, '悬停兼容挂点 → hoveringValidMount').toBe('hoveringValidMount');
    expect(env.drag()?.hoverHp, 'hover 挂点 = top').toBe('top');
    env.gh.move(hp.x, hp.y - 300); // 远离所有挂点
    expect(env.drag()?.phase, '离开挂点 → draggingPart').toBe('draggingPart');
    env.gh.move(hp.x, hp.y);
    env.gh.up(hp.x, hp.y);
    expect(env.drag(), '松开后状态机复位（completed）').toBeNull();
  });

  it('T2. 方向锁：横滑 → stripScrolling 且不装备；垂直上移 → draggingPart（Must#16）', () => {
    const hps = realHardpoints(VP);
    const env = mountEnv(VP, { inventory: { thruster: { one: 1, two: 0 } } });
    enterGarage(env, hps, {}, 'combat', 'opt:thruster@1');
    const card = env.areas().find((a) => a.id === 'opt:thruster@1')!;
    const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };

    // 横向滑动 → stripScrolling
    env.gh.down(from.x, from.y);
    env.gh.move(from.x - 6, from.y);
    env.gh.move(from.x - 20, from.y);
    expect(env.drag()?.phase, '横滑 → stripScrolling').toBe('stripScrolling');
    const hp = hps.find((p) => p.kind === 'functional')!;
    env.gh.up(hp.x, hp.y); // 即使松在挂点上也不装备
    expect(env.calls.pick.length, 'stripScrolling 本次手势不装备').toBe(0);

    // 垂直上移 → draggingPart
    env.gh.down(from.x, from.y);
    env.gh.move(from.x + 2, from.y - 14);
    expect(env.drag()?.phase, '垂直上移 → draggingPart').toBe('draggingPart');
    env.gh.up(from.x, from.y - 14); // 落在空白处 → 不装备
    expect(env.calls.pick.length, '无效释放不装备').toBe(0);
  });

  it('T3. 落点取【最近】兼容挂点，而非数组第一个（Must#6）', () => {
    const hps = realHardpoints(VP);
    const env = mountEnv(VP, { inventory: { thruster: { one: 1, two: 0 } } });
    enterGarage(env, hps, {}, 'combat', 'opt:thruster@1');
    const func = hps.filter((p) => p.kind === 'functional');
    expect(func.length, 'boxBody 有 4 个 functional 挂点').toBeGreaterThanOrEqual(2);
    const card = env.areas().find((a) => a.id === 'opt:thruster@1')!;
    const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
    // 依次悬停每个 functional 挂点，断言 hoverHp 恒等于指针最近者
    for (const target of func) {
      env.gh.down(from.x, from.y);
      env.gh.move(from.x, from.y - 12);
      env.gh.move(target.x, target.y);
      const nearest = func.reduce((best, p) =>
        Math.hypot(target.x - p.x, target.y - p.y) < Math.hypot(target.x - best.x, target.y - best.y) ? p : best,
      );
      expect(env.drag()?.hoverHp, `悬停 (${target.x.toFixed(0)},${target.y.toFixed(0)}) → 最近挂点 ${nearest.id}`).toBe(nearest.id);
      env.gh.up(target.x, target.y, true); // cancel，不提交
    }
  });

  it('T4. DPR1 与 DPR1.5 落点一致（logical 坐标同源；不因 DPR 产生偏移）', () => {
    const hp1 = realHardpoints(VP, 1);
    const hp15 = realHardpoints(VP, 1.5);
    // Renderer 输出 logical 坐标：DPR1 vs DPR1.5 差 <1px（F-CROSSLAYER-RECT-DPR-P0 已统一）
    for (const a of hp1) {
      const b = hp15.find((p) => p.id === a.id && p.kind === a.kind)!;
      expect(b, `挂点 ${a.id} 在两种 DPR 下均存在`).toBeTruthy();
      expect(Math.abs(a.x - b.x), `挂点 ${a.id} x 跨 DPR 差 <1px`).toBeLessThan(1);
      expect(Math.abs(a.y - b.y), `挂点 ${a.id} y 跨 DPR 差 <1px`).toBeLessThan(1);
    }
    // 同一 logical 拖动序列 → DPR1 与 DPR1.5 两种环境命中同一挂点
    const results: string[] = [];
    for (const [vp, hps, dpr] of [
      [VP, hp1, 1],
      [{ ...VP }, hp15, 1.5],
    ] as const) {
      const env = mountEnv(vp, { inventory: { thruster: { one: 1, two: 0 } }, dpr });
      enterGarage(env, hps, {}, 'combat', 'opt:thruster@1');
      const target = hps.find((p) => p.kind === 'functional' && p.id === 'top')!;
      // 用 DPR1 的挂点逻辑坐标作为拖动落点，断言命中同一 id
      const probe = hp1.find((p) => p.id === 'top' && p.kind === 'functional')!;
      const card = env.areas().find((a) => a.id === 'opt:thruster@1')!;
      const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
      env.gh.down(from.x, from.y);
      env.gh.move(from.x, from.y - 12);
      env.gh.move(target.x, target.y);
      results.push(env.drag()?.hoverHp ?? 'none');
      env.gh.up(target.x, target.y, true);
      expect(probe.id, 'probe 挂点 id').toBe('top');
    }
    expect(results[0], 'DPR1 命中 top').toBe('top');
    expect(results[1], '1920 视口命中 top（与 DPR1 一致）').toBe('top');
  });

  it('T5. 一次 pointerup 只触发一次装备回调（Forbidden：不得两次）', () => {
    const hps = realHardpoints(VP);
    const env = mountEnv(VP, { inventory: { thruster: { one: 1, two: 0 } } });
    enterGarage(env, hps, {}, 'combat', 'opt:thruster@1');
    const hp = hps.find((p) => p.kind === 'functional' && p.id === 'top')!;
    const card = env.areas().find((a) => a.id === 'opt:thruster@1')!;
    const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
    env.gh.down(from.x, from.y);
    env.gh.move(from.x, from.y - 12);
    env.gh.move(hp.x, hp.y);
    env.gh.up(hp.x, hp.y);
    // 同一手势再补一次 up（模拟事件重复派发）
    env.gh.up(hp.x, hp.y);
    expect(env.calls.pick.length, '装备回调恰好 1 次').toBe(1);
    expect(env.calls.pick[0], '装备值 = thruster@1').toBe('thruster@1');
    expect(env.calls.selectSlot[0], '先切槽到目标挂点').toBe('top');
    expect(env.calls.pick.length, '补发 up（落入 hp-sel 点击）后仍只装备 1 次').toBe(1);
  });

  it('T6. 无效释放（车辆空白处）→ 无装备、状态清理（Must#10）', () => {
    const hps = realHardpoints(VP);
    const env = mountEnv(VP, { inventory: { thruster: { one: 1, two: 0 } } });
    enterGarage(env, hps, {}, 'combat', 'opt:thruster@1');
    // 舞台内但远离所有挂点（挂点多在车身轮廓上，取舞台左上角内侧）
    const stage = computeMobileGarageLayout(VP, INSETS, resolveLayoutProfile(VP.w, VP.h)).stageRect;
    const blank = { x: stage.x + 8, y: stage.y + 8 };
    const nearestDist = Math.min(...hps.map((p) => Math.hypot(blank.x - p.x, blank.y - p.y)));
    expect(nearestDist, '取样点确实远离所有挂点（>28px）').toBeGreaterThan(28);
    dragCard(env, 'opt:thruster@1', blank);
    expect(env.calls.pick.length, '空白释放不装备').toBe(0);
    expect(env.drag(), 'ghost 与拖动状态已清理').toBeNull();
  });

  it('T7. 超载：兼容挂点红环 → 松开不装备，装配带显示超载差值（Must#11）', () => {
    // boxBody capacity=100；starter 已用 75（pushRod20+cannon30+hammer25）；shotgun 30 → 105 超载
    const hps = realHardpoints(VP);
    const env = mountEnv(VP, { inventory: { shotgun: { one: 1, two: 0 } } });
    enterGarage(env, hps, {}, 'combat', 'opt:shotgun@1');
    // 目标 = rear（starter 该挂点为空，纯新增 30 能量 → 75+30=105 > 容量 100 → 超载）
    const hp = hps.find((p) => p.kind === 'functional' && p.id === 'rear')!;
    expect(hp.occupied, 'rear 挂点当前为空（纯新增，非替换）').toBe(false);
    const card = env.areas().find((a) => a.id === 'opt:shotgun@1')!;
    expect(card, 'shotgun 卡片可拖（库存已注入）').toBeTruthy();
    const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
    env.gh.down(from.x, from.y);
    env.gh.move(from.x, from.y - 12);
    env.gh.move(hp.x, hp.y);
    expect(env.drag()?.phase, '超载悬停 → hoveringInvalidMount').toBe('hoveringInvalidMount');
    expect(env.drag()?.overload, 'overload 标志为真（红环）').toBe(true);
    env.gh.up(hp.x, hp.y);
    expect(env.calls.pick.length, '超载不装备（未先装备再回滚）').toBe(0);
    expect(env.notice(), '装配带显示超载差值').toMatch(/^超载 \+\d+$/);
    expect(env.drag(), '状态已清理').toBeNull();
  });

  it('T8. 未获得部件不能进入有效拖动，按下显示锁定原因（Must#11）', () => {
    const hps = realHardpoints(VP);
    const env = mountEnv(VP); // 默认库存无 thruster → locked
    const st = enterGarage(env, hps, {}, 'combat');
    // 未获得的卡不注册 hitArea（button 对 disabled 跳过命中注册）→ 按布局坐标定位
    const from = scrollToValue(env, st, 'thruster@1')!;
    expect(from, 'thruster 卡片可定位（默认库存未获得）').toBeTruthy();
    env.gh.down(from.x, from.y);
    env.gh.move(from.x, from.y - 12);
    expect(env.drag()?.phase, 'locked 卡不进入 draggingPart').toBe('partPressed');
    env.gh.up(from.x, from.y - 12);
    expect(env.calls.pick.length, '未获得不装备').toBe(0);
    expect(env.notice(), '显示锁定原因').toBe('未获得该部件');
  });

  it('T9. 车身卡拖到车辆主体区域（stageRect）→ 切换车身（Must#12）', () => {
    const hps = realHardpoints(VP);
    const env = mountEnv(VP);
    enterGarage(env, hps, { garageSelected: 'body' }, 'body');
    const stage = computeMobileGarageLayout(VP, INSETS, resolveLayoutProfile(VP.w, VP.h)).stageRect;
    const card = env.areas().find((a) => a.id === 'opt:bananaBody')!;
    expect(card, '车身卡存在').toBeTruthy();
    dragCard(env, 'opt:bananaBody', { x: stage.x + stage.w / 2, y: stage.y + stage.h / 2 });
    expect(env.calls.pick.length, '拖到车辆主体 → 切换车身').toBe(1);
    expect(env.calls.pick[0], '切换为 bananaBody').toBe('bananaBody');
  });

  it('T10. 点击备用路径：多挂点 → armed（不自动装默认挂点）；点挂点后装备（Must#15）', () => {
    const hps = realHardpoints(VP);
    const env = mountEnv(VP, { inventory: { thruster: { one: 1, two: 0 } } });
    enterGarage(env, hps, {}, 'combat', 'opt:thruster@1');
    const card = env.areas().find((a) => a.id === 'opt:thruster@1')!;
    const cx = card.x + card.w / 2;
    const cy = card.y + card.h / 2;
    // 单击（位移 <8px）→ armed，不装备
    env.gh.down(cx, cy);
    env.gh.up(cx, cy);
    expect(env.calls.pick.length, '多挂点时单击不自动装备').toBe(0);
    expect(env.drag()?.armed, '进入 armed（兼容挂点点亮）').toBe(true);
    // 点一个真实挂点 → 装备到该挂点
    const hp = hps.find((p) => p.kind === 'functional' && p.id === 'rear')!;
    const hit = env.areas().find((a) => a.id === `hp-sel:${hp.id}`)!;
    expect(hit, 'hp-sel 点击区与挂点视觉同源').toBeTruthy();
    env.gh.down(hit.x + hit.w / 2, hit.y + hit.h / 2);
    env.gh.up(hit.x + hit.w / 2, hit.y + hit.h / 2);
    expect(env.calls.pick.length, '点挂点后装备 1 次').toBe(1);
    expect(env.calls.selectSlot[env.calls.selectSlot.length - 1], '装备到 rear 挂点').toBe('rear');
    // 切换分类取消 armed
    const env2 = mountEnv(VP, { inventory: { thruster: { one: 1, two: 0 } } });
    enterGarage(env2, hps, {}, 'combat', 'opt:thruster@1');
    const c2 = env2.areas().find((a) => a.id === 'opt:thruster@1')!;
    env2.gh.down(c2.x + c2.w / 2, c2.y + c2.h / 2);
    env2.gh.up(c2.x + c2.w / 2, c2.y + c2.h / 2);
    expect(env2.drag()?.armed, 'armed 已建立').toBe(true);
    const catTab = env2.areas().find((a) => a.id === 'garage-cat:move')!;
    env2.gh.down(catTab.x + catTab.w / 2, catTab.y + catTab.h / 2);
    env2.gh.up(catTab.x + catTab.w / 2, catTab.y + catTab.h / 2);
    expect(env2.drag(), '切换分类取消 armed').toBeNull();
  });

  it('T11. pointercancel / 系统取消 → 清理 ghost 且不装备（Must#10）', () => {
    const hps = realHardpoints(VP);
    const env = mountEnv(VP, { inventory: { thruster: { one: 1, two: 0 } } });
    enterGarage(env, hps, {}, 'combat', 'opt:thruster@1');
    const hp = hps.find((p) => p.kind === 'functional' && p.id === 'top')!;
    const card = env.areas().find((a) => a.id === 'opt:thruster@1')!;
    const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
    env.gh.down(from.x, from.y);
    env.gh.move(from.x, from.y - 12);
    env.gh.move(hp.x, hp.y);
    expect(env.drag()?.phase, '悬停有效挂点').toBe('hoveringValidMount');
    env.gh.up(hp.x, hp.y, true); // 系统取消
    expect(env.calls.pick.length, '取消不装备').toBe(0);
    expect(env.drag(), 'ghost 与状态已清理').toBeNull();
  });

  it('T12. WeChat touch start/move/end/cancel 走同一状态机（Must#2）', () => {
    const hps = realHardpoints(VP);
    const touches: Record<string, (e: unknown) => void> = {};
    const wx = {
      getSystemInfoSync: () => ({ pixelRatio: 1, windowWidth: 844, windowHeight: 390 }),
      onTouchStart: (fn: (e: unknown) => void) => {
        touches.start = fn;
      },
      onTouchMove: (fn: (e: unknown) => void) => {
        touches.move = fn;
      },
      onTouchEnd: (fn: (e: unknown) => void) => {
        touches.end = fn;
      },
      onTouchCancel: (fn: (e: unknown) => void) => {
        touches.cancel = fn;
      },
    };
    (globalThis as { wx?: unknown }).wx = wx;
    const env = mountEnv(VP, { inventory: { thruster: { one: 1, two: 0 } }, input: new WechatInput() });
    // host 直连 WechatInput（不经 mountEnv 的 bindGesture 桩）→ 触摸回调已注册到 wx 桩
    expect(typeof touches.start, 'wx.onTouchStart 已注册').toBe('function');
    expect(typeof touches.move, 'wx.onTouchMove 已注册').toBe('function');
    expect(typeof touches.end, 'wx.onTouchEnd 已注册').toBe('function');
    expect(typeof touches.cancel, 'wx.onTouchCancel 已注册').toBe('function');
    const ev = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });
    // 让 enterGarage 内部的「点击进入装配页」也走真实触摸事件
    (env.gh as unknown as { down: (x: number, y: number) => void }).down = (x, y) => touches.start!(ev(x, y));
    (env.gh as unknown as { up: (x: number, y: number, c?: boolean) => void }).up = (x, y, c?: boolean) =>
      c ? touches.cancel!(ev(x, y)) : touches.end!(ev(x, y));
    enterGarage(env, hps, {}, 'combat', 'opt:thruster@1');
    const hp = hps.find((p) => p.kind === 'functional' && p.id === 'top')!;
    const card = env.areas().find((a) => a.id === 'opt:thruster@1')!;
    const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
    touches.start!(ev(from.x, from.y));
    expect(env.drag()?.phase, 'touchstart → partPressed').toBe('partPressed');
    touches.move!(ev(from.x, from.y - 12));
    expect(env.drag()?.phase, 'touchmove 向上 → draggingPart').toBe('draggingPart');
    touches.move!(ev(hp.x, hp.y));
    expect(env.drag()?.hoverHp, 'touchmove 到挂点 → hover').toBe('top');
    touches.end!(ev(hp.x, hp.y));
    expect(env.calls.pick.length, 'touchend 在有效挂点 → 装备 1 次').toBe(1);
    // touchcancel 清理
    const c2 = env.areas().find((a) => a.id === 'opt:thruster@1')!;
    touches.start!(ev(c2.x + c2.w / 2, c2.y + c2.h / 2));
    touches.move!(ev(c2.x + c2.w / 2, c2.y + c2.h / 2 - 12));
    touches.cancel!(ev(c2.x + c2.w / 2, c2.y + c2.h / 2 - 12));
    expect(env.calls.pick.length, 'touchcancel 不装备').toBe(1);
    expect(env.drag(), 'touchcancel 清理状态').toBeNull();
    delete (globalThis as { wx?: unknown }).wx;
  });

  it('T13. 挂点视觉半径与释放判定半径同源（Must#7：进圆环必判定成功）', () => {
    const env = mountEnv(VP);
    const r = (env.host as unknown as { garageMountRadius(): { ring: number; release: number } }).garageMountRadius.call(env.host);
    expect(r.release, '释放半径 22~28 logical px').toBeGreaterThanOrEqual(22);
    expect(r.release, '释放半径 ≤28').toBeLessThanOrEqual(28);
    expect(r.release, '释放半径不小于视觉圆环（进圆环必成功）').toBeGreaterThanOrEqual(r.ring);
    // 420×210 收紧但不得小于可见圆环
    const tiny = mountEnv({ w: 420, h: 210 });
    const rt = (tiny.host as unknown as { garageMountRadius(): { ring: number; release: number } }).garageMountRadius.call(tiny.host);
    expect(rt.release, '小屏收紧后仍 ≥22').toBeGreaterThanOrEqual(22);
    expect(rt.release, '小屏释放半径 ≥ 圆环').toBeGreaterThanOrEqual(rt.ring);
    // 源码守卫：视觉与判定均取自同一 garageMountRadius
    const src = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    expect(src, '落点判定使用 garageMountRadius').toContain('const { release } = this.garageMountRadius();');
    expect(src, '挂点绘制使用 garageMountRadius').toContain('const { ring } = this.garageMountRadius();');
  });

  it('T14. 「空」拖到已装备挂点 → 只移除该挂点部件（Acceptance F）', () => {
    const hps = realHardpoints(VP);
    const env = mountEnv(VP);
    enterGarage(env, hps, {}, 'combat', `opt:${EMPTY_SLOT}`); // 「空」卡在卡带首位（s=0 即完全可见）
    const card = env.areas().find((a) => a.id === `opt:${EMPTY_SLOT}`)!;
    expect(card, '「空」卡片存在（永远可拖）').toBeTruthy();
    // top 挂点已装备 hammer（starter draft）
    const hp = hps.find((p) => p.kind === 'functional' && p.id === 'top')!;
    expect(hp.occupied, 'top 挂点当前已占用').toBe(true);
    dragCard(env, `opt:${EMPTY_SLOT}`, { x: hp.x, y: hp.y });
    expect(env.calls.pick.length, '卸下 1 次').toBe(1);
    expect(env.calls.pick[0], '值为空槽').toBe(EMPTY_SLOT);
    expect(env.calls.selectSlot[env.calls.selectSlot.length - 1], '只作用于 top 挂点').toBe('top');
  });
});
