import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { WebInput } from '../src/platform/web/input';
import { WechatInput } from '../src/platform/wechat/input';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { defaultInventory } from '../src/core/partInventory';
import { registry } from '../src/core/content';
import { V } from '../src/ui/visualTokens';
import type { PlayerUIState, PlayerUIActions } from '../src/ui/playerUI';
import type { SafeInsets, PointerGestureHandlers } from '../src/platform/types';

/**
 * F-GARAGE-DRAG-CONTINUITY-R1｜拖装连续性与已装备卡片状态（targeted）
 *
 * 调查先行：真实事件链（tests/_trace_garage_drag.cjs，1920×1008@DPR1.5）显示——
 *   卡片(66,345) → 挂点(280,181)（dx=+214 / dy=-164，最自然的斜向拖）被判成
 *   stripScrolling，draggingFrames=0、capOps=0 → ghost 一帧不出现。
 * 根因：方向锁要求 ady > adx 严格成立；且 Web 端从未调用 setPointerCapture。
 *
 * T1  斜向拖动（|dx| ≥ |dy|）必须进入 draggingPart（核心回归，旧实现失败）
 * T2  向上累计 6px 进入 draggingPart（Must#4：5~7px）
 * T3  明显横滑 → stripScrolling 且本次手势不装备
 * T4  进入 draggingPart 后横向抖动不得退回 scrolling / cancelled（Must#4）
 * T5  判定用【从起点累计位移】：多次 2px 小步累计到 6px（Must#3）
 * T6  Web pointer capture：卡片按下 setPointerCapture，up 后 release（Must#1）
 * T7  capture 谓词：非卡片起点不捕获（不破坏其他页面输入）
 * T8  pointerId 随手势清空，下一次手势不继承（Must#11）
 * T9  触屏 ghost 上移 20 logical px，鼠标不上移（Must#6：16~24 / ≤4px）
 * T10 按下即重绘（Must#5：80ms 内反馈，不依赖定时器）
 * T11 WeChat touchend/touchcancel 取 changedTouches（真机契约，旧实现取 touches 为空 → onUp 丢失）
 * T12 已装备卡片四态：灰蓝（非亮蓝）+ 层级 locked < equipped < armed（Must 卡片状态 #1~#4）
 */
const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };
const VP = { w: 844, h: 390 };

type HardPt = { id: string; kind: 'movement' | 'functional'; x: number; y: number; occupied: boolean };

/** 稳定虚构挂点（本测试聚焦状态机/契约，落点几何由既有 garageDragAssemblyP0 用真实挂点覆盖） */
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
    // 'frontWheel' 属于 move 分类（garageSlotsFor: rearWheel/frontWheel/drive）——
    // 槽位与分类必须匹配，否则卡带只渲染引导文字、无 opt: 卡片
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
  captureCalls: Array<{ x: number; y: number; want: boolean }>;
  draws: () => number;
};

function mountEnv(): Env {
  const core = createWebCore();
  const handlers: Partial<Handlers> = {};
  const captureCalls: Array<{ x: number; y: number; want: boolean }> = [];
  let drawCount = 0;
  bindPlatformCore({
    ...core,
    input: {
      bindClick: () => {},
      bindPointer: () => {},
      bindGesture: (
        _t: EventTarget,
        hs: PointerGestureHandlers,
      ) => {
        handlers.onDown = hs.onDown;
        handlers.onMove = hs.onMove;
        handlers.onUp = hs.onUp;
        // 记录 host 声明的 capture 谓词（真实 WebInput 据此决定是否 setPointerCapture）
        handlers.captureOnDown = (x: number, y: number) => {
          const want = hs.captureOnDown ? hs.captureOnDown(x, y) : false;
          captureCalls.push({ x, y, want });
          return want;
        };
        handlers.preventDefaultOnMove = hs.preventDefaultOnMove;
      },
    },
    createViewport: () => ({
      surface: () => ({ width: VP.w, height: VP.h, devicePixelRatio: 1, now: () => 0 }),
      onResize: () => {},
      safeInsets: () => INSETS,
    }),
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  const canvas = {
    getContext: () => new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true }),
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
  // 统计重绘次数（Must#5/6：进入 draggingPart 的同一帧必须重绘）
  const origDraw = (host as unknown as { draw: () => void }).draw.bind(host);
  (host as unknown as { draw: () => void }).draw = () => {
    drawCount++;
    origDraw();
  };
  return {
    host,
    gh: {
      // 真实 WebInput 的调用顺序：pointerdown → 先问 captureOnDown（决定是否 setPointerCapture）
      // → 再 onDown。测试桩必须复刻该顺序，否则 capture 谓词永远不被求值（漏测 Must#1）。
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
    captureCalls,
    draws: () => drawCount,
  };
}

/** 进入 Garage 装配页（经真实点击进入，与玩家路径一致）；分类须与所选槽匹配才渲染卡片 */
function enterGarage(env: Env, cat: 'body' | 'move' | 'combat' = 'move'): void {
  env.host.render(garageState());
  const home = env.areas().find((a) => a.id === 'home-garage');
  if (home) {
    env.gh.down(home.x + home.w / 2, home.y + home.h / 2);
    env.gh.up(home.x + home.w / 2, home.y + home.h / 2);
  }
  // 分类与 garageSelected('front' = movement 槽) 必须匹配，否则卡带只显示引导文字
  (env.host as unknown as { garageCategory: 'body' | 'move' | 'combat' }).garageCategory = cat;
  env.host.render(garageState());
}

function firstCard(env: Env): { id: string; x: number; y: number; w: number; h: number } {
  const c = env.areas().find((a) => a.id.startsWith('opt:') && a.id !== 'opt:');
  if (!c) throw new Error('无部件卡');
  return c;
}

function lum(hex: string): number {
  const h = hex.replace('#', '');
  return (parseInt(h.slice(0, 2), 16) + parseInt(h.slice(2, 4), 16) + parseInt(h.slice(4, 6), 16)) / 3;
}

describe('F-GARAGE-DRAG-CONTINUITY-R1｜拖装连续性与已装备卡片状态', () => {
  it('T1. 斜向拖动（|dx| ≥ |dy|）进入 draggingPart（核心回归：旧实现判成 stripScrolling）', () => {
    const env = mountEnv();
    enterGarage(env);
    const c = firstCard(env);
    const sx = c.x + c.w / 2;
    const sy = c.y + c.h / 2;
    env.gh.down(sx, sy);
    expect(env.drag()?.phase, '按下 → partPressed').toBe('partPressed');
    // 复刻真实录屏路径：dx=+214 / dy=-164（横向分量更大，但意图明确是拖向车辆）
    env.gh.move(sx + 214, sy - 164);
    expect(env.drag()?.phase, '斜向拖 → draggingPart（不是 stripScrolling）').toBe('draggingPart');
  });

  it('T2. 向上累计 6px 进入 draggingPart（Must#4：5~7px 阈值）', () => {
    const env = mountEnv();
    enterGarage(env);
    const c = firstCard(env);
    const sx = c.x + c.w / 2;
    const sy = c.y + c.h / 2;
    env.gh.down(sx, sy);
    env.gh.move(sx, sy - 5);
    expect(env.drag()?.phase, '5px 未达阈值 → 仍 partPressed').toBe('partPressed');
    env.gh.move(sx, sy - 6);
    expect(env.drag()?.phase, '6px 达阈值 → draggingPart').toBe('draggingPart');
  });

  it('T3. 明显横滑 → stripScrolling，且本次手势不装备（Must#10）', () => {
    const env = mountEnv();
    enterGarage(env);
    const c = firstCard(env);
    const sx = c.x + c.w / 2;
    const sy = c.y + c.h / 2;
    env.gh.down(sx, sy);
    env.gh.move(sx - 40, sy + 2); // 横向 -40，纵向仅 +2
    expect(env.drag()?.phase, '明显横滑 → stripScrolling').toBe('stripScrolling');
    // 继续滑到挂点上方再松开：不得装备
    env.gh.move(HPS[0].x, HPS[0].y);
    expect(env.drag()?.phase, 'stripScrolling 锁定，不再切换').toBe('stripScrolling');
    env.gh.up(HPS[0].x, HPS[0].y);
    expect(env.drag(), '松手后状态归零（无残留）').toBe(null);
  });

  it('T4. 进入 draggingPart 后横向抖动不得退回 scrolling / cancelled（Must#4）', () => {
    const env = mountEnv();
    enterGarage(env);
    const c = firstCard(env);
    const sx = c.x + c.w / 2;
    const sy = c.y + c.h / 2;
    env.gh.down(sx, sy);
    env.gh.move(sx + 6, sy - 10);
    expect(env.drag()?.phase).toBe('draggingPart');
    // 后续大幅横向抖动（真实手势必有）
    env.gh.move(sx + 80, sy - 12);
    expect(env.drag()?.phase, '横向抖动后仍是 draggingPart').toBe('draggingPart');
    env.gh.move(sx + 20, sy - 100);
    expect(env.drag()?.phase, '再回到纵向仍是 draggingPart').toBe('draggingPart');
  });

  it('T5. 判定用【从起点累计位移】，不是相邻两帧位移（Must#3）', () => {
    const env = mountEnv();
    enterGarage(env);
    const c = firstCard(env);
    const sx = c.x + c.w / 2;
    const sy = c.y + c.h / 2;
    env.gh.down(sx, sy);
    // 每次只移动 2px（单帧不足阈值），累计 3 次 = 6px → 应触发
    env.gh.move(sx, sy - 2);
    expect(env.drag()?.phase, '累计 2px 未触发').toBe('partPressed');
    env.gh.move(sx, sy - 4);
    expect(env.drag()?.phase, '累计 4px 未触发').toBe('partPressed');
    env.gh.move(sx, sy - 6);
    expect(env.drag()?.phase, '累计 6px 触发（证明用累计而非单帧）').toBe('draggingPart');
  });

  it('T6. Web pointer capture：卡片按下即捕获，up 后释放（Must#1）', () => {
    const ops: string[] = [];
    const captured = new Set<number>();
    const node = {
      addEventListener: () => {},
      setPointerCapture: (id: number) => {
        ops.push('set');
        captured.add(id);
      },
      releasePointerCapture: (id: number) => {
        ops.push('release');
        captured.delete(id);
      },
      hasPointerCapture: (id: number) => captured.has(id),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: VP.w, height: VP.h }),
      clientWidth: VP.w,
      clientHeight: VP.h,
    } as unknown as HTMLElement;
    const listeners: Record<string, Array<(ev: unknown) => void>> = {};
    (node as unknown as { addEventListener: (t: string, fn: (ev: unknown) => void) => void }).addEventListener = (
      t: string,
      fn: (ev: unknown) => void,
    ) => {
      (listeners[t] ||= []).push(fn);
    };
    const hadWindow = 'window' in globalThis;
    (globalThis as { window?: unknown }).window = { PointerEvent: function () {} };
    try {
      const calls: Array<{ x: number; y: number; cancelled: boolean }> = [];
      new WebInput().bindGesture(node, {
        onDown: () => {},
        onMove: () => {},
        onUp: (_x, _y, cancelled) => calls.push({ x: _x, y: _y, cancelled }),
        captureOnDown: () => true, // 模拟 host：卡片起点
      });
      const fire = (type: string, ev: unknown) => (listeners[type] || []).forEach((f) => f(ev));
      fire('pointerdown', { pointerId: 7, pointerType: 'mouse', clientX: 100, clientY: 200 });
      expect(ops, '按下 → setPointerCapture').toEqual(['set']);
      fire('pointermove', { pointerId: 7, pointerType: 'mouse', clientX: 140, clientY: 160 });
      fire('pointerup', { pointerId: 7, pointerType: 'mouse', clientX: 140, clientY: 160 });
      expect(ops, 'up → release（顺序完整）').toEqual(['set', 'release']);
      expect(captured.size, '释放后 capture 记账归零').toBe(0);
      expect(calls.length, 'up 只派发一次').toBe(1);
      // pointercancel 同样释放
      fire('pointerdown', { pointerId: 8, pointerType: 'mouse', clientX: 10, clientY: 10 });
      fire('pointercancel', { pointerId: 8, pointerType: 'mouse', clientX: 10, clientY: 10 });
      expect(ops, 'cancel → 同样释放').toEqual(['set', 'release', 'set', 'release']);
      expect(calls[1]?.cancelled, 'cancel 标记正确').toBe(true);
    } finally {
      if (!hadWindow) delete (globalThis as { window?: unknown }).window;
    }
  });

  it('T7. capture 谓词：仅卡片起点捕获（非卡片按下不破坏其他输入，Must#1）', () => {
    const env = mountEnv();
    enterGarage(env);
    const c = firstCard(env);
    env.captureCalls.length = 0;
    // 卡片中心按下 → 应请求 capture
    env.gh.down(c.x + c.w / 2, c.y + c.h / 2);
    const lastCard = env.captureCalls[env.captureCalls.length - 1];
    expect(lastCard?.want, '卡片起点 → 请求 capture').toBe(true);
    // 空白区域按下 → 不请求
    env.gh.down(VP.w - 8, 8);
    const lastBlank = env.captureCalls[env.captureCalls.length - 1];
    expect(lastBlank?.want, '空白区域 → 不 capture').toBe(false);
  });

  it('T8. pointerId 随手势清空，下一次不继承（Must#11）', () => {
    const env = mountEnv();
    enterGarage(env);
    const c = firstCard(env);
    const sx = c.x + c.w / 2;
    const sy = c.y + c.h / 2;
    env.gh.down(sx, sy, { pointerId: 11, pointerType: 'mouse' });
    expect(env.drag()?.pointerId, '记录本次 pointerId').toBe(11);
    env.gh.move(sx, sy - 30);
    env.gh.up(sx, sy - 30);
    expect(env.drag(), '手势结束 → 状态（含 pointerId）整体清空').toBe(null);
    // 下一次手势：pointerId 不同且不残留
    env.gh.down(sx, sy, { pointerId: 12, pointerType: 'mouse' });
    expect(env.drag()?.pointerId, '新手势用新 pointerId').toBe(12);
    expect(env.drag()?.phase, '新手势从 partPressed 正常开始').toBe('partPressed');
  });

  it('T9. 触屏 ghost 上移 20 logical px；鼠标不上移（Must#6：16~24 / ≤4px）', () => {
    const src = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    expect(src, '触屏抬升常量').toContain('GHOST_TOUCH_LIFT = 20');
    expect(src, '仅触屏抬升').toContain("if (!snapped && d.pointerType === 'touch')");
    expect(src, '抬升只作用于绘制（落点仍用真实指针）').toContain('落点判定仍用真实指针');
    // 源码守卫：抬升量在 Must#6 要求的 16~24 区间内
    const m = src.match(/GHOST_TOUCH_LIFT = (\d+)/);
    expect(m, '抬升量可解析').toBeTruthy();
    const lift = Number(m![1]);
    expect(lift >= 16 && lift <= 24, `抬升量 ${lift} 在 16~24`).toBe(true);
  });

  it('T10. 进入 draggingPart 的同一帧重绘（Must#5/6：ghost 从第一帧出现）', () => {
    const env = mountEnv();
    enterGarage(env);
    const c = firstCard(env);
    const sx = c.x + c.w / 2;
    const sy = c.y + c.h / 2;
    const before = env.draws();
    env.gh.down(sx, sy);
    expect(env.draws(), '按下即重绘（80ms 内反馈，不依赖定时器）').toBeGreaterThan(before);
    const beforeMove = env.draws();
    env.gh.move(sx + 6, sy - 10);
    expect(env.draws(), '进入 draggingPart 同一帧重绘 → ghost 立即出现').toBeGreaterThan(beforeMove);
  });

  it('T11. WeChat touchend/touchcancel 取 changedTouches（真机 onUp 契约）', () => {
    const ups: Array<{ x: number; y: number; cancelled: boolean }> = [];
    const moves: number[] = [];
    let prevented = 0;
    const wx = {
      onTouchStart: (cb: (e: unknown) => void) => {
        (wx as unknown as { _s: (e: unknown) => void })._s = cb;
      },
      onTouchMove: (cb: (e: unknown) => void) => {
        (wx as unknown as { _m: (e: unknown) => void })._m = cb;
      },
      onTouchEnd: (cb: (e: unknown) => void) => {
        (wx as unknown as { _e: (e: unknown) => void })._e = cb;
      },
      onTouchCancel: (cb: (e: unknown) => void) => {
        (wx as unknown as { _c: (e: unknown) => void })._c = cb;
      },
      getSystemInfoSync: () => ({ pixelRatio: 2, windowWidth: 844, windowHeight: 390 }),
    };
    (globalThis as { wx?: unknown }).wx = wx;
    try {
      let dragActive = false;
      new WechatInput().bindGesture({ width: 844, height: 390 } as unknown as EventTarget, {
        onDown: () => {},
        onMove: (x) => moves.push(x),
        onUp: (x, y, cancelled) => ups.push({ x, y, cancelled }),
        preventDefaultOnMove: () => dragActive,
      });
      const s = (wx as unknown as { _s: (e: unknown) => void })._s;
      const m = (wx as unknown as { _m: (e: unknown) => void })._m;
      const e = (wx as unknown as { _e: (e: unknown) => void })._e;
      const cc = (wx as unknown as { _c: (e: unknown) => void })._c;
      // 真机语义：touchend 时 touches 为空，离开的触点只在 changedTouches
      s({ touches: [{ clientX: 100, clientY: 300 }] });
      m({ touches: [{ clientX: 120, clientY: 280 }], preventDefault: () => prevented++ });
      e({ touches: [], changedTouches: [{ clientX: 120, clientY: 280 }] });
      expect(ups.length, 'touchend（touches 为空）仍派发 onUp').toBe(1);
      expect(ups[0]?.cancelled, 'touchend 非取消').toBe(false);
      // 拖动激活后才 preventDefault（不全局拦截）
      dragActive = true;
      s({ touches: [{ clientX: 100, clientY: 300 }] });
      m({ touches: [{ clientX: 140, clientY: 260 }], preventDefault: () => prevented++ });
      expect(prevented, '活跃拖动 → 阻止默认滚动').toBe(1);
      // touchcancel 同样取 changedTouches
      cc({ touches: [], changedTouches: [{ clientX: 140, clientY: 260 }] });
      expect(ups.length, 'touchcancel 派发 onUp').toBe(2);
      expect(ups[1]?.cancelled, 'touchcancel 标记取消').toBe(true);
    } finally {
      delete (globalThis as { wx?: unknown }).wx;
    }
  });

  it('T12. 卡片四态互斥：已装备灰蓝（非亮蓝）+ 层级 locked < equipped < armed', () => {
    const src = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    const cardStart = src.indexOf('private drawPartCard');
    const nextMethod = src.indexOf('\n  private ', cardStart + 10);
    const body = src.slice(cardStart, nextMethod > 0 ? nextMethod : cardStart + 2400);
    // Must#1：已装备不用亮蓝选中填充（旧实现传 active: equipped → C.blue）
    expect(body, '已装备走 equipped（不是 active）').toContain('equipped: equipped');
    expect(body, '已装备不复用亮蓝 active').not.toContain('active: equipped');
    // Must#3：armed 金色描边，与已装备灰态区分
    expect(body, 'armed 传 armed 标记').toContain('armed: isArmed');
    // Must#1：文字标签不可省略
    expect(body, '已装备文字标签').toContain("'已装备'");
    expect(body, '未获得文字标签').toContain("'未获得'");
    // 层级：未获得 必须比 已装备 更暗
    expect(lum(V.lockedFill), '未获得比已装备更暗').toBeLessThan(lum(V.equippedFill));
    // 已装备 = 中性低饱和灰蓝（蓝通道略高但不饱和：max-min 小 → 区别于亮蓝 C.blue）
    const eq = V.equippedFill.replace('#', '');
    const ch = [0, 2, 4].map((i) => parseInt(eq.slice(i, i + 2), 16));
    const r = ch[0];
    const b = ch[2];
    expect(b - r, '已装备为低饱和灰蓝（非高饱和亮蓝）').toBeLessThan(60);
    expect(lum(V.equippedFill), '已装备不是亮蓝（亮蓝 #2f7fff 亮度 ~150）').toBeLessThan(100);
    // armed 是金系（红 > 蓝），与灰蓝可一眼区分
    const armed = V.armedFill.match(/rgba\((\d+),\s*(\d+),\s*(\d+)/);
    expect(armed, 'armedFill 可解析').toBeTruthy();
    expect(Number(armed![1]), 'armed 偏暖金（R > B）').toBeGreaterThan(Number(armed![3]));
  });
});
