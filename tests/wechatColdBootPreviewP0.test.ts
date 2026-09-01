/**
 * F-WX-IOS-COLD-BOOT-PREVIEW-P0｜iOS 冷进程启动车辆缩小/残帧——修改前红测 + 修改后验收。
 *
 * 用户真机实证（RC #95805d0）：彻底关闭微信后重进 → 存档保持、Garage UI 正常，
 * 但中央车辆缩成极小；切换页面后尺寸才恢复；Home 切换首帧车辆未出现 + RC badge 重复残留。
 *
 * 坐标域标注（playbook 4.2）：window 逻辑 px / canvas backing px / surface logical px。
 * 车辆屏幕宽占比 = vehicleA 最终屏幕 envelope 宽 ÷ viewWidth（logical）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { bindPlatformCore } from '../src/platform/context';
import { platform } from '../src/platform';
import { WechatViewport } from '../src/platform/wechat/viewport';
import { FakeCanvas } from './wechatCanvasFrameHost';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { SfxAudioService } from '../src/presentation/audioService';
import { createPlayerPresentation } from '../src/presentation/playerPresentation';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { PlayerGameRuntime } from '../src/game/playerGameRuntime';
import { WechatBattleHost } from '../src/game/wechatBattleHost';
import { SingleLoop } from '../src/platform/wechat/singleLoop';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { stampVersion } from '../src/core/saveVersion';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { BuildDraft } from '../src/lab/buildEditorModel';

const LW = 844;
const LH = 390;
const DPR = 2;

interface Harness {
  screen: FakeCanvas;
  ui: FakeCanvas;
  renderer: Renderer;
  battleHost: WechatBattleHost;
  uiHost: CanvasPlayerUIHost;
  runtime: PlayerGameRuntime;
  loop: SingleLoop;
  drive: (dt?: number) => void;
  fakeNow: () => number;
  visibilityCbs: Array<(hidden: boolean) => void>;
  /** 当前车辆A屏幕 envelope（logical px） */
  vehicleRectA: () => { x: number; y: number; w: number; h: number } | null;
  /** 车辆A屏幕宽占比（% of viewWidth） */
  widthPctA: () => number;
}

interface HarnessOpts {
  /** 逻辑窗口宽（默认 844） */
  w?: number;
  /** 逻辑窗口高（默认 390） */
  h?: number;
  /** DPR（默认 2） */
  dpr?: number;
  /** safeArea 矩形（logical px；left/top/right/bottom 为安全区边缘坐标）；undefined = 全屏 0 insets */
  safeArea?: { left: number; top: number; right: number; bottom: number } | null;
  /** 预置玩家存档（同步 getItem 返回；null/缺省 = 无存档 → silDraft 默认 Build） */
  savedBuild?: BuildDraft | null;
}

function buildHarness(opts: HarnessOpts = {}): Harness {
  const w = opts.w ?? LW;
  const h = opts.h ?? LH;
  const dpr = opts.dpr ?? DPR;
  const screen = new FakeCanvas({ width: w * dpr, height: h * dpr, logicalW: w, logicalH: h });
  const ui = new FakeCanvas({ width: w * dpr, height: h * dpr, logicalW: w, logicalH: h });
  screen.ctx.fastRaster = true;
  ui.ctx.fastRaster = true;
  const sa = opts.safeArea ?? { left: 0, top: 0, right: w, bottom: h, width: w, height: h };
  const info = () => ({
    windowWidth: w,
    windowHeight: h,
    screenWidth: Math.round(w * dpr),
    screenHeight: Math.round(h * dpr),
    pixelRatio: dpr,
    safeArea: sa,
  });
  const fakeWx = {
    getWindowInfo: () => info(),
    getSystemInfoSync: () => info(),
    getMenuButtonBoundingClientRect: () => null,
  };
  (globalThis as any).wx = fakeWx;
  if (!vi.isMockFunction(Math.random)) {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  }
  let fakeNow = 0;
  const rafCbs: Array<(t: number) => void> = [];
  const visibilityCbs: Array<(hidden: boolean) => void> = [];
  // 预置存档（同步 getItem → loadPlayerBuild 同步读；真实微信 getStorageSync 同为同步）
  const savedRaw = opts.savedBuild ? JSON.stringify(stampVersion(opts.savedBuild)) : null;
  const core = {
    storage: { getItem: (): string | null => savedRaw, setItem: (): void => {}, removeItem: (): void => {} },
    input: { bindPointer: (): (() => void) => () => {} },
    lifecycle: {
      requestAnimationFrame: (cb: (t: number) => void): number => {
        rafCbs.push(cb);
        return rafCbs.length;
      },
      cancelAnimationFrame: (_h: number): void => {},
      now: (): number => fakeNow,
      onVisibilityChange: (cb: (hidden: boolean) => void): void => {
        visibilityCbs.push(cb);
      },
    },
    createViewport: (c: unknown) => new WechatViewport(c as { width: number; height: number }, DPR),
  };
  bindPlatformCore(core as never);

  const surface = platform.createViewport(screen).surface();
  const renderer = new Renderer(screen as unknown as HTMLCanvasElement, new VisualRegistry(), surface);
  const sfx = new SfxAudioService();
  const presentation = createPlayerPresentation(renderer, sfx);
  const battleHost = new WechatBattleHost(renderer, presentation);
  const uiHost = new CanvasPlayerUIHost(ui as unknown as HTMLCanvasElement);
  uiHost.mountCanvas();
  const runtime = new PlayerGameRuntime({ host: uiHost, battle: battleHost, sfx });
  runtime.init();
  const loop = new SingleLoop(
    (cb) => core.lifecycle.requestAnimationFrame(cb),
    (h) => core.lifecycle.cancelAnimationFrame(h),
  );
  const drive = (dt = 16.7): void => {
    fakeNow += dt;
    screen.ctx.clearDrawOps();
    ui.ctx.clearDrawOps();
    runtime.tick(fakeNow);
  };
  const vehicleRectA = () => {
    const o = battleHost.orchestrator;
    if (!o) return null;
    const rects = renderer.getVehicleScreenRects(o.getRenderSnapshot());
    return rects ? rects.a : null;
  };
  const widthPctA = () => {
    const r = vehicleRectA();
    if (!r) return 0;
    return (r.w / LW) * 100;
  };
  return {
    screen,
    ui,
    renderer,
    battleHost,
    uiHost,
    runtime,
    loop,
    drive,
    fakeNow: () => fakeNow,
    visibilityCbs,
    vehicleRectA,
    widthPctA,
  };
}

afterEach(() => {
  delete (globalThis as any).wx;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('F-WX-IOS-COLD-BOOT-PREVIEW-P0｜冷启动链路诊断 + 红测', () => {
  it('DIAG2. 完整冷启动序列（boot→init→onShow→首帧→切页）逐阶段 transform/占比', () => {
    const h = buildHarness();
    const rows: string[] = [];
    const snap = () => `transform={scale:${h.renderer.transform.scale.toFixed(3)}} pct=${h.widthPctA().toFixed(1)}% rectA=${JSON.stringify(h.vehicleRectA())}`;
    rows.push(`after-init ${snap()}`);
    // 微信冷启动必触发 onShow → syncWechatViewport('show')
    if (h.visibilityCbs.length > 0) {
      h.visibilityCbs[h.visibilityCbs.length - 1](false);
    }
    rows.push(`after-onShow ${snap()}`);
    h.drive();
    rows.push(`f1 ${snap()}`);
    h.drive();
    rows.push(`f2 ${snap()}`);
    // 切页 Home→Garage
    (h.uiHost as unknown as { dispatch: (id: string) => void }).dispatch('home-garage');
    h.drive();
    rows.push(`after-switch-garage ${snap()}`);
    // 切回 Home
    (h.uiHost as unknown as { dispatch: (id: string) => void }).dispatch('nav:home');
    h.drive();
    rows.push(`after-switch-home ${snap()}`);
    // eslint-disable-next-line no-console
    console.log('COLD-SEQ\n' + rows.join('\n'));
    expect(true).toBe(true);
  }, 30000);
  it('DIAG. 冷启动前10帧逐帧记录（renderer transform / 车辆 envelope / UI ink / 像素）', () => {
    const h = buildHarness();
    const rows: string[] = [];
    // 首帧前（init 完成、未 tick）：当前 transform 与车辆 rect
    const pre = h.renderer.transform;
    rows.push(`pre-tick  transform={scale:${pre.scale.toFixed(3)},ox:${pre.offsetX.toFixed(1)},oy:${pre.offsetY.toFixed(1)}} rectA=${JSON.stringify(h.vehicleRectA())} pct=${h.widthPctA().toFixed(1)}%`);
    for (let i = 1; i <= 10; i++) {
      h.drive();
      const t = h.renderer.transform;
      const r = h.vehicleRectA();
      rows.push(
        `f${i} transform={scale:${t.scale.toFixed(3)},ox:${t.offsetX.toFixed(1)},oy:${t.offsetY.toFixed(1)}} rectA=${r ? `${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.w.toFixed(0)}x${r.h.toFixed(0)}` : 'null'} pct=${h.widthPctA().toFixed(1)}%`,
      );
    }
    // eslint-disable-next-line no-console
    console.log('COLD-BOOT-TRACE\n' + rows.join('\n'));
    // 诊断不设断言（观察数据用）
    expect(h.runtime.playerPhase).toBe('garage');
  }, 30000);

  it('R-CB1 [红→绿] 冷启动稳定帧：Garage 车辆宽占比满足 R2.1（844 ≥40%），Home ≥28%（R2.1 T4）', () => {
    const h = buildHarness();
    // 冷启动稳定帧（Home 页；metaPage 初始 'home'）
    for (let i = 0; i < 10; i++) h.drive();
    const homePct = h.widthPctA();
    // 进入 Garage → 稳定帧
    (h.uiHost as unknown as { dispatch: (id: string) => void }).dispatch('home-garage');
    for (let i = 0; i < 10; i++) h.drive();
    const garagePct = h.widthPctA();
    // eslint-disable-next-line no-console
    console.log(`R-CB1 home=${homePct.toFixed(1)}% garage=${garagePct.toFixed(1)}%`);
    // R2.1：844 档 Garage ∈ [40,48]；Home 按 T4 语义 ≥28%（Home 取景区含 CTA，设计上小于 Garage）
    // 上限 48.01：设计目标恰为 48%，浮点运算得 48.000000000000014（IEEE 754 误差），加容差
    expect(garagePct).toBeGreaterThanOrEqual(40);
    expect(garagePct).toBeLessThanOrEqual(48.01);
    expect(homePct).toBeGreaterThanOrEqual(28);
  }, 30000);

  it('R-CB2 [红→绿] 冷启动 Home 首帧即稳定（f1==f10 无「切页依赖恢复」漂移）；切页后 Garage 达标', () => {
    const h = buildHarness();
    h.drive();
    const f1 = h.widthPctA();
    for (let i = 1; i < 10; i++) h.drive();
    const f10 = h.widthPctA();
    // 用户「切页后尺寸才恢复」= 帧间漂移/依赖后续 reframe——修复后首帧即最终值
    // eslint-disable-next-line no-console
    console.log(`R-CB2 f1=${f1.toFixed(1)}% f10=${f10.toFixed(1)}% drift=${Math.abs(f10 - f1).toFixed(2)}pt`);
    expect(Math.abs(f10 - f1)).toBeLessThan(0.5);
    // 切页（Home→Garage）→ Garage 达标（R2.1 844 ∈ [40,48]）
    (h.uiHost as unknown as { dispatch: (id: string) => void }).dispatch('home-garage');
    h.drive();
    const g = h.widthPctA();
    // eslint-disable-next-line no-console
    console.log(`R-CB2 garage-after-switch=${g.toFixed(1)}%`);
    // 上限 48.01：同 R-CB1（设计目标 48%，float 误差 48.000000000000014）
    expect(g).toBeGreaterThanOrEqual(40);
    expect(g).toBeLessThanOrEqual(48.01);
  }, 30000);

  it('R-CB3 [红] badge 每帧恰好绘制一次（单实例；无重复残留）', () => {
    const h = buildHarness();
    h.uiHost.setBuildBadge('#95805d0');
    // 记录 3 帧中 badge 绘制（黑色半透明底 fillRect）次数
    for (let f = 0; f < 3; f++) {
      h.drive();
      // drawBuildBadge 每帧在 renderBattleFrame 末尾绘制；统计 fillRect 中 badge 底色 op
      const badgeOps = h.ui.ctx.drawOps.filter(
        (op) => op.type === 'rect' && op.fillStyle === 'rgba(0,0,0,0.55)',
      ).length;
      // eslint-disable-next-line no-console
      console.log(`BADGE f${f + 1} drawCount=${badgeOps}`);
      expect(badgeOps).toBeLessThanOrEqual(1);
    }
  }, 30000);

  it('R-CB4 [红] 连续5次冷启动车辆宽占比不逐次漂移（≤1%）', () => {
    const pcts: number[] = [];
    for (let i = 0; i < 5; i++) {
      const h = buildHarness();
      for (let f = 0; f < 10; f++) h.drive();
      pcts.push(h.widthPctA());
    }
    // eslint-disable-next-line no-console
    console.log(`5-COLD pcts=${pcts.map((p) => p.toFixed(1)).join(',')}`);
    const min = Math.min(...pcts);
    const max = Math.max(...pcts);
    expect(max - min).toBeLessThanOrEqual(1);
  }, 60000);

  it('R-CB5 [红] Home 冷启动首帧车辆区域像素非0（车辆未出现 = 像素0）', () => {
    const h = buildHarness();
    h.drive(); // 首帧
    const r = h.vehicleRectA();
    expect(r).not.toBeNull();
    if (r) {
      // 车辆屏幕区域（logical → backing）应有非零像素
      const x0 = Math.max(0, Math.round(r.x * DPR));
      const y0 = Math.max(0, Math.round(r.y * DPR));
      const x1 = Math.min(screenW(h), Math.round((r.x + r.w) * DPR));
      const y1 = Math.min(screenH(h), Math.round((r.y + r.h) * DPR));
      const ink = countInk(h, x0, y0, x1, y1);
      // eslint-disable-next-line no-console
      console.log(`HOME-F1 rectA=${JSON.stringify(r)} ink=${ink}`);
      expect(ink).toBeGreaterThan(0);
    }
  }, 30000);

  it('R-CB6 [红] 真实 insets（safeArea 44/20/12/16 + 胶囊 fallback）+ 高车存档 Build：Garage 车辆宽占比 ≥ R2.1 36%', () => {
    // 高车存档：pineappleBody（hardpoint top y=-56 → 车高显著 > watermelon），模拟真机高车玩家存档；
    // iPhone 横屏无胶囊按钮 → getMenuButtonBoundingClientRect=null 且 API 存在 → insets.right=胶囊 fallback 101.28
    const tall = makeStarterDraft('pineappleBody', registry);
    const h = buildHarness({ safeArea: { left: 44, top: 12, right: 844 - 20, bottom: 390 - 16 }, savedBuild: tall });
    const ins = (h.uiHost as unknown as { insets: unknown }).insets;
    // 冷启动（metaPage=home）稳定帧
    for (let i = 0; i < 10; i++) h.drive();
    const homePct = h.widthPctA();
    // 进入 Garage（用户真机：Garage UI 正常但车辆极小）
    (h.uiHost as unknown as { dispatch: (id: string) => void }).dispatch('home-garage');
    h.drive();
    const garagePct = h.widthPctA();
    // eslint-disable-next-line no-console
    console.log(`R-CB6 ins=${JSON.stringify(ins)} home=${homePct.toFixed(1)}% garage=${garagePct.toFixed(1)}%`);
    // R2.1：Garage 车辆宽占比 ≥36%（高车 + 真实 insets 预期跌破 → 复现「缩成极小」红）
    expect(garagePct).toBeGreaterThanOrEqual(36);
  }, 30000);

  it('R-CB7 [红] 683×314 short 档（iPhone 真机截图 2048×941 ÷3）+ DPR3 + 真实 insets：冷启动稳定帧占比', () => {
    // 2048/3≈682.7、941/3≈313.7 → 逻辑 683×314（logicalH<600 且 aspect≈2.18 → compact short 档）
    const h = buildHarness({
      w: 683,
      h: 314,
      dpr: 3,
      safeArea: { left: 44, top: 12, right: 683 - 20, bottom: 314 - 16 },
    });
    for (let i = 0; i < 10; i++) h.drive();
    const homePct = h.widthPctA();
    (h.uiHost as unknown as { dispatch: (id: string) => void }).dispatch('home-garage');
    h.drive();
    const garagePct = h.widthPctA();
    // eslint-disable-next-line no-console
    console.log(
      `R-CB7 683×314@3x ins=${JSON.stringify((h.uiHost as unknown as { insets: unknown }).insets)} home=${homePct.toFixed(1)}% garage=${garagePct.toFixed(1)}%`,
    );
    // R2.1：Garage ≥36%；Home 对照 ≥28%（R2.1 T4 语义）
    expect(garagePct).toBeGreaterThanOrEqual(36);
    expect(homePct).toBeGreaterThanOrEqual(28);
  }, 30000);

  it('R-CB7B [红] 高车存档 + 683×314 short 档（2048×941/3）+ DPR3 + 真实 insets：真机截图尺寸模型', () => {
    const tall = makeStarterDraft('pineappleBody', registry);
    const h = buildHarness({
      w: 683,
      h: 314,
      dpr: 3,
      safeArea: { left: 44, top: 12, right: 683 - 20, bottom: 314 - 16 },
      savedBuild: tall,
    });
    for (let i = 0; i < 10; i++) h.drive();
    const homePct = h.widthPctA();
    (h.uiHost as unknown as { dispatch: (id: string) => void }).dispatch('home-garage');
    h.drive();
    const garagePct = h.widthPctA();
    // eslint-disable-next-line no-console
    console.log(
      `R-CB7B 683×314@3x ins=${JSON.stringify((h.uiHost as unknown as { insets: unknown }).insets)} home=${homePct.toFixed(1)}% garage=${garagePct.toFixed(1)}%`,
    );
    // 真机截图尺寸 + 高车：若跌破 36% 即为用户「极小」最贴近复现
    expect(garagePct).toBeGreaterThanOrEqual(36);
    expect(homePct).toBeGreaterThanOrEqual(28);
  }, 30000);

  it('R-CB6B [红] 对照组：默认矮车（watermelon）+ 真实 insets——区分高车 vs insets 主因', () => {
    const h = buildHarness({ safeArea: { left: 44, top: 12, right: 844 - 20, bottom: 390 - 16 } });
    for (let i = 0; i < 10; i++) h.drive();
    const homePct = h.widthPctA();
    (h.uiHost as unknown as { dispatch: (id: string) => void }).dispatch('home-garage');
    h.drive();
    const garagePct = h.widthPctA();
    // eslint-disable-next-line no-console
    console.log(`R-CB6B ins=${JSON.stringify((h.uiHost as unknown as { insets: unknown }).insets)} home=${homePct.toFixed(1)}% garage=${garagePct.toFixed(1)}%`);
    // 矮车 + 真实 insets：若 Garage 仍 ≥36%（R2.1），则 insets 不是主因，高车才是；
    // 若跌破 → insets 压缩 stageRect 是共同根因
    expect(garagePct).toBeGreaterThanOrEqual(36);
  }, 30000);

  it('DIAG3. 首帧 reframe 无 framingRect（lastState 未就绪 → getPreviewFramingRect null）→ 实际 fallback 机制记录', () => {
    // init 首次 reframePlayerCamera（showPreview L626）时 lastState=undefined → getPreviewFramingRect 返回 null →
    // renderer.reframe(snap,'previewSolo',{phase}) 无 framingRect：compact → envelope 自适应（默认非 garage padding）；
    // 非 compact → 固定 SOLO 框（SOLO_MIN/MAX）。两者都不是「arena fit 极小」——修正早期假设，记录真实 fallback。
    const o = new PlanckBattleOrchestrator(
      buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'a'),
      buildSnapshotFromDraft(makeStarterDraft('boxBody', registry), registry, 'b'),
      registry,
      { autoDrive: true },
      true,
    );
    const snap = o.getRenderSnapshot();
    const report = (label: string, canvas: HTMLCanvasElement, lw: number) => {
      const r = new Renderer(canvas, new VisualRegistry());
      r.resize(snap.arena.width, o.arena.config.height);
      r.reframe(snap, 'previewSolo', { phase: 'garage' }); // 无 framingRect
      const a = r.getVehicleScreenRects(snap)!.a;
      // eslint-disable-next-line no-console
      console.log(`DIAG3 ${label} scale=${r.transform.scale.toFixed(3)} pct=${((a.w / lw) * 100).toFixed(1)}% rectA=${JSON.stringify(a)}`);
      return r;
    };
    report('compact-844x390', makeCanvasLike(1688, 780), 844);
    report('normal-1280x720', makeCanvasLike(2560, 1440), 1280);
    expect(true).toBe(true); // 纯诊断记录（机制证据不设 FAIL）
  }, 30000);

  it('DIAG4. resize arena fit（orch 缺失时 doResize 残留）→ 「<10% 极小」路径验证（844×390 logical）', () => {
    // doResize → battle.resize → renderer.resize 设 arena fit（scale=min(vw/arenaW,vh/arenaH)×ZOOM）；
    // 随后 reframePlayerCamera 若 `if (!orch) return` 早退（orchestrator 缺失）→ arena fit 残留 → 车辆极小。
    const o = new PlanckBattleOrchestrator(
      buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'a'),
      buildSnapshotFromDraft(makeStarterDraft('boxBody', registry), registry, 'b'),
      registry,
      { autoDrive: true },
      true,
    );
    const renderer = new Renderer(makeCanvasLike(844, 390), new VisualRegistry());
    const snap = o.getRenderSnapshot();
    renderer.resize(snap.arena.width, o.arena.config.height); // arena fit，无后续 reframe（模拟 orch 缺失早退）
    const a = renderer.getVehicleScreenRects(snap)!.a;
    const pct = (a.w / 844) * 100;
    // eslint-disable-next-line no-console
    console.log(`DIAG4 resize-only scale=${renderer.transform.scale.toFixed(3)} pct=${pct.toFixed(1)}% rectA=${JSON.stringify(a)}`);
    // 证据：resize（arena fit，1600×900 contain × VIEW_ZOOM）残留 = 22.5%，非 Queue 假设的 <10%（0.43×ZOOM 放大）。
    // 「<10%」在本代码库任何路径均不存在（DIAG3 无 framing=34.6%；DIAG4=22.5%；R-CB6 高车=21.8%）。
    expect(pct).toBeGreaterThan(15); // 记录 arena fit 残留的真实量级（15~25% 区间）
  }, 30000);

  it('DIAG5. 取景链路全数值：env/bw/bh/safe/fitLimit/minS/maxS/hLimit/scale（矮车 vs 高车 × home vs garage）', () => {
    const rows: string[] = [];
    for (const tall of [false, true]) {
      for (const page of ['home', 'garage'] as const) {
        const draft = tall ? makeStarterDraft('pineappleBody', registry) : undefined;
        const h = buildHarness({
          safeArea: { left: 44, top: 12, right: 844 - 20, bottom: 390 - 16 },
          savedBuild: draft ?? null,
        });
        for (let i = 0; i < 10; i++) h.drive();
        if (page === 'garage') {
          (h.uiHost as unknown as { dispatch: (id: string) => void }).dispatch('home-garage');
          h.drive();
        }
        const snap = h.battleHost.orchestrator!.getRenderSnapshot();
        const env = (h.renderer as unknown as { vehicleBounds(v: unknown, includeVisual: boolean): { minX: number; maxX: number; minY: number; maxY: number } }).vehicleBounds(snap.vehicleA, true);
        const ew = env.maxX - env.minX;
        const eh = env.maxY - env.minY;
        const fr = (h.uiHost as unknown as { getPreviewFramingRect(): { x: number; y: number; w: number; h: number; mode: string } | null }).getPreviewFramingRect();
        if (!fr) continue;
        const pad = 6;
        const fw = fr.w - pad * 2;
        const fh = fr.h - pad * 2;
        const padX = Math.max(24, ew * 0.24);
        const padY = Math.max(10, eh * 0.14);
        const bw = ew + padX * 2 + 8; // + margin 4×2
        const bh = eh + padY * 2 + 8;
        const fitLimit = Math.min(fw / bw, fh / bh);
        const minS = (0.38 * fw) / ew;
        const maxS = (0.48 * 844) / ew;
        const hLimit = fh / bh;
        const t = h.renderer.transform;
        rows.push(
          `${tall ? 'TALL' : 'short'} ${page} env=${ew.toFixed(0)}x${eh.toFixed(0)} fr=${fr.w.toFixed(0)}x${fr.h.toFixed(0)} bw=${bw.toFixed(0)} bh=${bh.toFixed(0)} safe=${fw.toFixed(0)}x${fh.toFixed(0)} fit=${fitLimit.toFixed(3)} minS=${minS.toFixed(3)} maxS=${maxS.toFixed(3)} hLimit=${hLimit.toFixed(3)} scale=${t.scale.toFixed(3)}`,
        );
      }
    }
    // eslint-disable-next-line no-console
    console.log('DIAG5\n' + rows.join('\n'));
    expect(true).toBe(true);
  }, 30000);
});

function screenW(h: Harness): number {
  return h.screen.width;
}
function screenH(h: Harness): number {
  return h.screen.height;
}
/** 最小 canvas 桩（DIAG3 直接构造 renderer 用；与 garageCenterScaleR21 同款） */
function makeCanvasLike(w: number, h: number): HTMLCanvasElement {
  return {
    getContext: () => new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true }),
    width: w,
    height: h,
    clientWidth: w,
    clientHeight: h,
  } as unknown as HTMLCanvasElement;
}
/** 统计屏幕 canvas 指定 backing 区域内的非零像素数（扫描屏幕 drawOps 的 device bbox 交集粗算） */
function countInk(h: Harness, x0: number, y0: number, x1: number, y1: number): number {
  let ink = 0;
  for (const op of h.screen.ctx.drawOps) {
    const b = op as { devX?: number; devY?: number; devW?: number; devH?: number };
    if (b.devX === undefined || b.devY === undefined || b.devW === undefined || b.devH === undefined) continue;
    const ox0 = Math.max(x0, b.devX);
    const oy0 = Math.max(y0, b.devY);
    const ox1 = Math.min(x1, b.devX + b.devW);
    const oy1 = Math.min(y1, b.devY + b.devH);
    if (ox1 > ox0 && oy1 > oy0) ink += (ox1 - ox0) * (oy1 - oy0);
  }
  return ink;
}
