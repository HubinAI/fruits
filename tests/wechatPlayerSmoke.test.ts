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

/** 微信显示画布桩：物理像素尺寸 + 2D ctx（无 DOM style）；rec 存在时记录 drawImage 调用 */
function makeStubCanvas(
  w: number,
  h: number,
  rec?: Array<{ src: unknown; w: number; h: number }>,
): HTMLCanvasElement {
  const ctx = rec
    ? (new Proxy({} as CanvasRenderingContext2D, {
        get: (_t, k) => {
          if (k === 'drawImage') {
            return (src: unknown, _dx: number, _dy: number, dw?: number, dh?: number) => {
              rec.push({ src, w: dw ?? 0, h: dh ?? 0 });
            };
          }
          return () => ({ width: 0 });
        },
        set: () => true,
      }) as unknown as CanvasRenderingContext2D)
    : makeStubCtx();
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
  const drawImages: Array<{ src: unknown; w: number; h: number }> = [];
  let touchHandler: ((e: unknown) => void) | null = null;
  let hideHandler: (() => void) | null = null;
  let showHandler: (() => void) | null = null;
  let nextRaf = 1;
  let createCount = 0;
  // F-WX-P0：第一次 createCanvas = 唯一上屏 canvas（screenCanvas，记录 drawImage）；
  // 后续 createCanvas = offscreen（uiCanvas），不得假设自动叠层。
  const screenCanvas = makeStubCanvas(750, 1334, drawImages);
  const uiCanvas = makeStubCanvas(750, 1334);
  const wx = {
    // F-WX-P0-INPUT：真实微信坐标语义——windowWidth/Height 是逻辑 px（= canvas.width/pixelRatio）。
    // fake canvas 750×1334 物理（dpr=2）→ 逻辑 375×667；保持与 WechatInput 归一化（比例=1）一致。
    getSystemInfoSync: () => ({ pixelRatio: 2, windowWidth: 375, windowHeight: 667 }),
    createCanvas: () => {
      createCount++;
      return createCount === 1 ? screenCanvas : uiCanvas;
    },
    // F-BATTLE-READABILITY-R1：微信图片加载（game.ts 注册 Content 视觉；stub 不触发
    // onload → 视觉灰盒 fallback，headless 不影响战斗流程）
    createImage: () => ({
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      src: '',
    }),
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
    canvas: screenCanvas,
    uiCanvas,
    drawImages,
    get createCount() {
      return createCount; // 活引用：game.ts 调用 createCanvas 后实时更新
    },
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

/** CanvasHost 布局坐标 → 微信触摸输入坐标（逻辑 px；与 mountCanvas 的 cssW=canvas/dpr 同源） */
function toPhysical(canvas: HTMLCanvasElement, dpr: number, lx: number, ly: number): { x: number; y: number } {
  const w = Math.max(1, canvas.width / dpr);
  const h = Math.max(1, canvas.height / dpr);
  const scale = Math.min(w / 1280, h / 720);
  const ox = (w - 1280 * scale) / 2;
  const oy = (h - 720 * scale) / 2;
  return { x: ox + lx * scale, y: oy + ly * scale };
}

describe('F-WX-5 WeChat 玩家闭环 platform smoke（headless）', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as any).wx;
    delete (globalThis as any).localStorage;
  });

  it('完整玩家闭环 + 触摸输入 + 微信存储 + 后台/前台 + 再战（验收 2/3/6）', async () => {
    vi.useFakeTimers();
    // F-WX-P0-INPUT：固定随机对手（pickOpponentForTier 用 Math.random）——避免特定
    // 对手组合战斗超 1600 tick 兜底导致非确定性失败（852 全量回归实测偶发）。
    vi.spyOn(Math, 'random').mockReturnValue(0.42);
    const fake = makeFakeWx();
    (globalThis as any).wx = fake.wx;
    delete (globalThis as any).localStorage; // 全程无 Web storage 可用 → 任何 Web fallback 都会失败
    vi.resetModules(); // 复现「启动时首次求值」时序（bootstrap-wechat 先于业务模块）

    const mod = await import('../wechat/game');
    const runtime = mod.runtime;

    // —— F-WX-P0：Canvas 合成链（真实 Runtime 规则）——
    // 1) 第一次 createCanvas = 唯一上屏 canvas；2) 第二 canvas 是 offscreen（不假设自动上屏）
    expect(fake.createCount).toBeGreaterThanOrEqual(2);
    expect(mod.screenCanvas).toBe(fake.canvas); // game.ts 用第一个 canvas 作 screenCanvas
    expect(mod.uiCanvas).toBe(fake.uiCanvas); // 第二个 canvas 作 UI offscreen
    expect(mod.screenCanvas).not.toBe(mod.uiCanvas);
    // 3) uiCanvas 尺寸显式同步 screenCanvas 物理像素
    expect(mod.uiCanvas.width).toBe(mod.screenCanvas.width);
    expect(mod.uiCanvas.height).toBe(mod.screenCanvas.height);
    // 启动尚未驱动帧 → 尚无合成（证明 composite 只在 frame 内）
    expect(fake.drawImages.length).toBe(0);

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
    const p = toPhysical(fake.canvas, 2, cta!.x + cta!.w / 2, cta!.y + cta!.h / 2); // fake wx pixelRatio=2
    fake.touch()!({ touches: [{ clientX: p.x, clientY: p.y }] });
    expect(runtime.playerPhase).toBe('matching'); // 触摸 → Action → Gameplay command 全链路

    // —— Matching 候选 1.42s → MatchPreview（700ms 锁定稳定）→ READY → 开战 ——
    // （F-MATCH-FRAME-R2：Lock 停留延长到 600–800ms，给玩家看清锁定对手；
    //  F-MATCH-DEMO-R1：搜索总时长 1.42s ∈ [1.2,1.8]s，候选 4 个显示）。
    vi.advanceTimersByTime(1420 + 700 + 600);
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
    vi.advanceTimersByTime(1420 + 700 + 600);
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
    // F-WX-P0：frame 最后阶段执行 UI composite——screenCtx.drawImage(uiCanvas) 作为最后一层
    expect(fake.drawImages.length).toBeGreaterThan(0); // composite 已执行
    expect(fake.drawImages[fake.drawImages.length - 1].src).toBe(fake.uiCanvas); // 合成源 = UI offscreen
    expect(fake.drawImages[fake.drawImages.length - 1].w).toBe(fake.uiCanvas.width); // 全尺寸 1:1
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
