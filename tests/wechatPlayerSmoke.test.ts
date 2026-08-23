/**
 * F-WX-5｜微信玩家闭环 platform smoke（headless，等价微信环境）。
 *
 * 在 fake wx 全局（createCanvas / storage / rAF / onTouchStart / onHide / onShow）下
 * 动态 import 真实微信入口 wechat/game.ts（复用 F-WX-2.1 bootstrap-wechat 绑定），
 * 驱动真实 PlanckBattleOrchestrator + Renderer + CanvasPlayerUIHost + PlayerGameRuntime，
 * 验证：
 * 1. 完整玩家闭环：Garage→(触摸 CTA)→Matching→MatchPreview→Battle→Result→Reward→
 *    Garage→再战（验收 2）；
 * 2. 持久化落 fake wx storage（验收 3 WeChat Storage）；全程无 localStorage（验收 6 无 Web fallback）；
 * 3. 后台→前台：onHide 暂停循环调度、onShow 恢复（验收 3）；
 * 4. 刷新/重进恢复：新模块实例从微信 storage 恢复 Build（验收 3）。
 *
 * 本沙箱无法启动微信开发者工具，实机项以本 smoke + bundle 静态分析间接验证（如实报告）。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

const BUILD_KEY = 'strongfruit.playerBuild.v1';
const INV_KEY_V2 = 'strongfruit.ownedParts.v2';
const PROG_KEY = 'strongfruit.playerProgress.v1';

/** 零实现 2D 上下文桩（所有方法 noop；所有属性 set 静默成功） */
function makeStubCtx(): CanvasRenderingContext2D {
  const handler = {
    get: () => () => ({ width: 0 }),
    set: () => true,
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}

/** 微信显示画布桩：物理像素尺寸 + 2D ctx（无 DOM style） */
function makeStubCanvas(w: number, h: number): HTMLCanvasElement {
  const ctx = makeStubCtx();
  return {
    getContext: () => ctx,
    clientWidth: w,
    clientHeight: h,
    width: w,
    height: h,
  } as unknown as HTMLCanvasElement;
}

function makeFakeWx() {
  const store = new Map<string, unknown>();
  const rafCallbacks: Array<(t: number) => void> = [];
  let touchHandler: ((e: unknown) => void) | null = null;
  let hideHandler: (() => void) | null = null;
  let showHandler: (() => void) | null = null;
  let nextRaf = 1;
  const canvas = makeStubCanvas(750, 1334); // 竖屏物理像素（safeArea 类 viewport 变化在 host 测试覆盖）
  const wx = {
    getSystemInfoSync: () => ({ pixelRatio: 2, windowWidth: 750, windowHeight: 1334 }),
    createCanvas: () => canvas,
    getStorageSync: (k: string) => (store.has(k) ? store.get(k) : null),
    setStorageSync: (k: string, v: unknown) => void store.set(k, v),
    removeStorageSync: (k: string) => void store.delete(k),
    requestAnimationFrame: (cb: (t: number) => void) => {
      rafCallbacks.push(cb);
      return nextRaf++;
    },
    cancelAnimationFrame: () => {
      rafCallbacks.length = 0;
    },
    onTouchStart: (cb: (e: unknown) => void) => {
      touchHandler = cb;
    },
    onHide: (cb: () => void) => {
      hideHandler = cb;
    },
    onShow: (cb: () => void) => {
      showHandler = cb;
    },
  };
  return {
    wx,
    store,
    rafCallbacks,
    canvas,
    touch: () => touchHandler,
    hide: () => hideHandler,
    show: () => showHandler,
  };
}

/** 驱动一帧：弹出 rAF 回调并执行 */
function driveFrame(fake: ReturnType<typeof makeFakeWx>, now: number): void {
  const cb = fake.rafCallbacks.shift();
  if (cb) cb(now);
}

/** CanvasHost 逻辑坐标 → 微信物理像素坐标（与 ensureSize 同源换算） */
function toPhysical(canvas: HTMLCanvasElement, lx: number, ly: number): { x: number; y: number } {
  const w = Math.max(1, canvas.width);
  const h = Math.max(1, canvas.height);
  const scale = Math.min(w / 1280, h / 720);
  const ox = (w - 1280 * scale) / 2;
  const oy = (h - 720 * scale) / 2;
  return { x: ox + lx * scale, y: oy + ly * scale };
}

describe('F-WX-5 WeChat 玩家闭环 platform smoke（headless）', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).wx;
    delete (globalThis as any).localStorage;
  });

  it('完整玩家闭环 + 触摸输入 + 微信存储 + 后台/前台 + 再战（验收 2/3/6）', async () => {
    vi.useFakeTimers();
    const fake = makeFakeWx();
    (globalThis as any).wx = fake.wx;
    delete (globalThis as any).localStorage; // 全程无 Web storage 可用 → 任何 Web fallback 都会失败
    vi.resetModules(); // 复现「启动时首次求值」时序（bootstrap-wechat 先于业务模块）

    const mod = await import('../wechat/game');
    const runtime = mod.runtime;

    // —— 启动：新账号 → Garage（验收 2 起点）——
    expect(runtime.uiMode).toBe('build');
    expect(runtime.playerPhase).toBe('garage');
    expect(runtime.draftA.bodyDefId).toBe('watermelonBody');
    expect(fake.store.has(BUILD_KEY)).toBe(true); // 存档落微信 storage
    expect((globalThis as any).localStorage).toBeUndefined(); // 无 Web fallback（验收 6）

    // —— 触摸输入经 Platform Input Adapter：点「寻找对手」CTA ——
    const hitAreas = mod.uiHost.getHitAreasForTest();
    const cta = hitAreas.find((a) => a.id === 'cta-find');
    expect(cta).toBeDefined(); // Garage Dock CTA 已注册命中区
    const p = toPhysical(fake.canvas, cta!.x + cta!.w / 2, cta!.y + cta!.h / 2);
    fake.touch()!({ touches: [{ clientX: p.x, clientY: p.y }] });
    expect(runtime.playerPhase).toBe('matching'); // 触摸 → Action → Gameplay command 全链路

    // —— Matching 候选 ~1.0s → MatchPreview（250ms 自动开战）→ READY → 开战 ——
    vi.advanceTimersByTime(1010 + 250 + 600);
    expect(runtime.battleState).toBe('fighting');

    // —— 真实 Planck Battle 推进（≈18s，最多 26.6s 兜底）——
    let now = 0;
    let ticks = 0;
    while (runtime.battleState !== 'ended' && ticks < 1600) {
      now += 16.7;
      runtime.tick(now); // 直接驱动 runtime（rAF 队列由后台/前台用例验证）
      ticks++;
    }
    expect(runtime.battleState).toBe('ended'); // 状态机收敛（不卡死）
    expect(ticks).toBeGreaterThan(60 * 10); // 战斗真实持续 ≥10s（等价 Canvas 连续运行）

    // —— Reward / Economy 落微信 storage（验收 3 WeChat Storage）——
    const invRaw = fake.store.get(INV_KEY_V2);
    const progRaw = fake.store.get(PROG_KEY);
    expect(invRaw).toBeDefined(); // 奖励自动入库
    expect(progRaw).toBeDefined(); // 金币/段位结算
    const inv = JSON.parse(String(invRaw)) as { __v?: number; [k: string]: unknown };
    const totalParts = Object.keys(inv).filter((k) => k !== '__v').length;
    expect(totalParts).toBeGreaterThan(0);

    // —— Result「调整配置」→ Garage（闭环）——
    runtime.actions.onResultAdjust();
    expect(runtime.playerPhase).toBe('garage');
    expect(runtime.battleState).toBe('editing');

    // —— 再战：下一场 → Matching → Battle → Ended（验收 2 循环）——
    runtime.actions.onFindOpponent();
    expect(runtime.playerPhase).toBe('matching');
    vi.advanceTimersByTime(1010 + 250 + 600);
    expect(runtime.battleState).toBe('fighting');
    ticks = 0;
    while (runtime.battleState !== 'ended' && ticks < 1600) {
      now += 16.7;
      runtime.tick(now);
      ticks++;
    }
    expect(runtime.battleState).toBe('ended'); // 第二场正常结束

    // —— 后台→前台：onHide 暂停调度，onShow 恢复（验收 3）——
    const rafBefore = fake.rafCallbacks.length;
    fake.hide()!(); // onHide → running=false + cancelAnimationFrame
    expect(fake.rafCallbacks.length).toBe(0);
    driveFrame(fake, now); // 暂停期间 rAF 队列为空：无新帧
    expect(fake.rafCallbacks.length).toBe(0); // 无 hidden 期调度泄漏
    fake.show()!(); // onShow → resetClock + 恢复调度
    expect(fake.rafCallbacks.length).toBeGreaterThan(0); // 恢复后重新排队
    driveFrame(fake, now + 16.7);
    expect(fake.rafCallbacks.length).toBeGreaterThan(0); // 帧循环继续
    void rafBefore;
  });

  it('刷新/重进恢复：新模块实例从微信 storage 恢复 Build（验收 3）', async () => {
    vi.useFakeTimers();
    const fake = makeFakeWx();
    (globalThis as any).wx = fake.wx;
    vi.resetModules();
    const mod1 = await import('../wechat/game');
    // 装配变更 → 落微信 storage
    mod1.runtime.actions.onToggleGarageSlot('body');
    mod1.runtime.actions.onPickGarageOption('coconutBody');
    expect(mod1.runtime.draftA.bodyDefId).toBe('coconutBody');
    expect(String(fake.store.get(BUILD_KEY))).toContain('coconutBody');

    // 「刷新」= 全新模块注册表再次启动微信入口（同一 wx storage）
    vi.resetModules();
    const mod2 = await import('../wechat/game');
    expect(mod2.runtime.draftA.bodyDefId).toBe('coconutBody'); // 从微信 storage 恢复
    expect(mod2.runtime.playerPhase).toBe('garage'); // 恢复后正常进 Garage
  });
});
