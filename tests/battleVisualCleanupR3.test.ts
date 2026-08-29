/**
 * Queue F-BATTLE-VISUAL-CLEANUP-R3｜清理战斗开发痕迹与接触点信息重叠（targeted）
 *
 * Must#1（先确认再改）调查结论 —— 真机 Battle「部件周围明显矩形外框」的来源：
 *  - **不是**碰撞调试绘制：render(orchestrator, debugDraw?) 的 debugDraw 只由 DEV
 *    src/lab/physicsLab.ts 传入；正式路径 src/game/wechatBattleHost.ts 明确无 debugOverlay；
 *  - **不是**挂点调试框 / Garage 吸附反馈：drawVehicleHardpoints / drawGarageDragGhost
 *    只在 canvasPlayerUIHost.drawGarageMetaPage（playerPhase='garage' && metaPage='garage'）绘制；
 *  - **不是** E2E 诊断轮廓（__WX_DEBUG__ / __WX_RCA__ 只产生 dev-only 日志，PROD 编译期折叠）；
 *  - **是正式部件视觉**：Renderer.drawShape 对每个 collider polygon 画近黑 `#0d0f14` +
 *    恒定 1.5px 硬描边 → compound 车身内部接缝全显形 = 工程线框感，且线宽不随镜头收敛。
 *
 * 因此本 Queue 按 Must#3「重做表现轮廓而不是删除真实部件」修复：几何/collider/部件集合不变，
 * 描边换成同色系派生的柔和轮廓（partOutlineColor + 尺度收敛线宽 + 圆角 join）。
 *
 * 覆盖（全部走真实 PlanckBattleOrchestrator + 真实 Renderer + 真实 reframe，
 * 断言最终 stroke / fillText 绘制调用本身，不读源码字符串、不用 fake viewport / fake pointer）：
 *  T1. 无开发矩形框：Active/Warning/Closing/End 四阶段任何 stroke 都不再是近黑 `#0d0f14`
 *      硬线框，且部件轮廓线宽 ≤1.2（Must#1/#2/#3/#7）；
 *  T2. 真实部件未被删除：车辆填充仍在画（fill 调用 + 车身色），轮廓色 = 填充色派生（Must#3）；
 *  T3. 四档分辨率双车完整入画（420×210 / 621×351 / 844×390 / 1280×592）（Acceptance）；
 *  T4. 双方接触点屏幕空间避让：同一 contactPoint 上 A 受伤 / B 受伤两组数字最终绘制 x
 *      分居两侧、间距 ≥28px，且受伤方数字偏向受伤方一侧（Must#4）；
 *  T5. 显示总伤害守恒：避让只挪像素，activeDamageNumbers 合计 == 真实伤害总量（Must#4）；
 *  T6. 无持续噪音：TTL 到期后伤害数字清零（Must#4/Acceptance）；
 *  T7. HUD 安全区：420×210 / 844×390 Battle HUD 全部绘制矩形都不与微信胶囊内缩带相交（Must#5）；
 *  T8. 命中反馈不使用大面积闪屏：hit-flash 只描边不填充（Must#6）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { Renderer, partOutlineColor, mixHexColor } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { registry } from '../src/core/content';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import type { CanvasSurface } from '../src/render/canvasSurface';
import type { BattleOrchestratorApi } from '../src/battle/battleContract';
import type { DamageEvent } from '../src/battle/combatEvents';
import type { PlayerUIState, PlayerUIHudFrame } from '../src/ui/playerUI';

const VIEWPORTS = [
  { w: 420, h: 210 },
  { w: 621, h: 351 },
  { w: 844, h: 390 },
  { w: 1280, h: 592 },
];
const PHASES = ['Active', 'Warning', 'Closing', 'End'];
/** drawVehicle 实际使用的车身色（renderer.render：A 蓝 / B 橙） */
const VEHICLE_COLOR_A = '#4aa3ff';
const VEHICLE_COLOR_B = '#ff7a4a';
/** 旧近黑硬描边（本 Queue 要求消失的「开发矩形框」特征色） */
const LEGACY_DEBUG_OUTLINE = '#0d0f14';

/** 记录真实绘制调用的 ctx：stroke 时快照 strokeStyle/lineWidth/lineJoin；fillText 记录坐标 */
class RecCtx {
  calls: string[] = [];
  texts: Array<{ t: string; x: number; y: number }> = [];
  strokes: Array<{ color: string; width: number; join: string }> = [];
  fills: string[] = [];
  rects: Array<{ x: number; y: number; w: number; h: number }> = [];
  fillStyle: string | CanvasGradient = '';
  font = '';
  textAlign = '';
  textBaseline = '';
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  lineCap = '';
  shadowBlur = 0;
  shadowColor = '';
  filter = '';
  private _strokeStyle = '';
  private _lineWidth = 1;
  private _lineJoin = 'miter';
  get strokeStyle(): string {
    return this._strokeStyle;
  }
  set strokeStyle(v: string) {
    this._strokeStyle = v;
  }
  get lineWidth(): number {
    return this._lineWidth;
  }
  set lineWidth(v: number) {
    this._lineWidth = v;
  }
  get lineJoin(): string {
    return this._lineJoin;
  }
  set lineJoin(v: string) {
    this._lineJoin = v;
  }
  private rec(n: string): void {
    this.calls.push(n);
  }
  setTransform(): void { this.rec('setTransform'); }
  resetTransform(): void { this.rec('resetTransform'); }
  clearRect(): void { this.rec('clearRect'); }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.rec('fillRect');
    this.fills.push(String(this.fillStyle));
    this.rects.push({ x, y, w, h });
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.rec('strokeRect');
    this.rects.push({ x, y, w, h });
    this.strokes.push({ color: this._strokeStyle, width: this._lineWidth, join: this._lineJoin });
  }
  beginPath(): void { this.rec('beginPath'); }
  moveTo(): void { this.rec('moveTo'); }
  lineTo(): void { this.rec('lineTo'); }
  closePath(): void { this.rec('closePath'); }
  fill(): void {
    this.rec('fill');
    this.fills.push(String(this.fillStyle));
  }
  stroke(): void {
    this.rec('stroke');
    this.strokes.push({ color: this._strokeStyle, width: this._lineWidth, join: this._lineJoin });
  }
  arc(): void { this.rec('arc'); }
  ellipse(): void { this.rec('ellipse'); }
  quadraticCurveTo(): void { this.rec('quadraticCurveTo'); }
  bezierCurveTo(): void { this.rec('bezierCurveTo'); }
  fillText(t: string, x: number, y: number): void {
    this.rec('fillText');
    this.texts.push({ t, x, y });
  }
  strokeText(): void { this.rec('strokeText'); }
  save(): void { this.rec('save'); }
  restore(): void { this.rec('restore'); }
  scale(): void { this.rec('scale'); }
  translate(): void { this.rec('translate'); }
  rotate(): void { this.rec('rotate'); }
  setLineDash(): void { this.rec('setLineDash'); }
  clip(): void { this.rec('clip'); }
  rect(x: number, y: number, w: number, h: number): void {
    this.rec('rect');
    this.rects.push({ x, y, w, h });
  }
  roundRect(x: number, y: number, w: number, h: number): void {
    this.rec('roundRect');
    this.rects.push({ x, y, w, h });
  }
  drawImage(): void { this.rec('drawImage'); }
  createLinearGradient(): CanvasGradient {
    return { addColorStop: () => {} } as unknown as CanvasGradient;
  }
  createRadialGradient(): CanvasGradient {
    return { addColorStop: () => {} } as unknown as CanvasGradient;
  }
  measureText(): { width: number } {
    return { width: 10 };
  }
}

function makeCanvas(ctx: RecCtx, vp: { w: number; h: number }): HTMLCanvasElement {
  return {
    width: vp.w,
    height: vp.h,
    clientWidth: vp.w,
    clientHeight: vp.h,
    getContext: () => ctx,
    style: undefined,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLCanvasElement;
}

/**
 * 阶段化正式渲染入口：真实 orchestrator 的真实 snapshot / 真实 status，仅覆盖 `phase`
 * 字符串（PlanckBattleOrchestrator.phase 是 getter，真实值由 arena 相位机产出；
 * 本委托只为在 Active/Warning/Closing/End 各渲染一次，不伪造几何、伤害、结果、时间）。
 */
function withPhase(o: BattleOrchestratorApi, phase: string): BattleOrchestratorApi {
  return {
    phase,
    get result() {
      return o.result;
    },
    get timeMs() {
      return o.timeMs;
    },
    get config() {
      return o.config;
    },
    getRenderSnapshot: () => o.getRenderSnapshot(),
    getBattleStatusSnapshot: () => o.getBattleStatusSnapshot(),
    step: (dt: number) => o.step(dt),
    onCombatEvent: (fn: Parameters<BattleOrchestratorApi['onCombatEvent']>[0]) => o.onCombatEvent(fn),
    dispose: () => o.dispose(),
  } as unknown as BattleOrchestratorApi;
}

/** 真实 Battle 场景：真实 Planck Orchestrator + 真实 Renderer + 真实 reframe('battle') */
function battleScene(vp: { w: number; h: number }, phase = 'Active') {
  const ctx = new RecCtx();
  // surface.now 是 Renderer 的表现时间基准（this.now() 优先取 surface.now）——
  // 接入受控 fakeNow，才能真实驱动伤害数字聚合窗口 / TTL（不改任何 Gameplay 时间）。
  const surface: CanvasSurface = { width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => fakeNow };
  const o = new PlanckBattleOrchestrator(
    buildSnapshotFromDraft(makeStarterDraft('boxBody', registry), registry, 'a'),
    buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'b'),
    registry,
    { autoDrive: true },
    false,
  );
  const r = new Renderer(makeCanvas(ctx, vp), new VisualRegistry(), surface);
  const snap = o.getRenderSnapshot();
  r.resize(snap.arena.width, o.arena.config.height);
  r.setBattleBackdrop(true); // 正式战斗背景（与 playerGameRuntime 战斗态一致）
  r.reframe(snap, 'battle', { phase });
  return { ctx, r, o: withPhase(o, phase), snap, vp };
}

function makeDamage(over: Partial<DamageEvent> = {}): DamageEvent {
  return {
    type: 'damage',
    source: 'A',
    target: 'B',
    damageSource: 'weapon',
    partId: 'hammer-1',
    behavior: 'hammer',
    contactPoint: { x: 800, y: 620 },
    contactNormal: { x: 1, y: 0 },
    relativeVelocity: 3,
    damage: 40,
    hpBefore: 900,
    hpAfter: 860,
    timestamp: 1000,
    ...over,
  };
}

let fakeNow = 1000;
let origNow: (() => number) | null = null;

describe('F-BATTLE-VISUAL-CLEANUP-R3｜战斗开发痕迹清理', () => {
  beforeEach(() => {
    fakeNow = 1000;
    origNow = (globalThis.performance as { now: () => number }).now;
    (globalThis.performance as { now: () => number }).now = () => fakeNow;
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
  });
  afterEach(() => {
    if (origNow) (globalThis.performance as { now: () => number }).now = origNow;
    bindPlatformCore(createWebCore());
  });

  it('T1. 无开发矩形框：Active/Warning/Closing/End 四阶段均无近黑硬线框，部件轮廓线宽 ≤1.2（Must#1/#2/#3/#7）', () => {
    for (const phase of PHASES) {
      for (const vp of VIEWPORTS) {
        const s = battleScene(vp, phase);
        s.r.render(s.o); // 正式渲染路径：不传 debugDraw（与 wechatBattleHost 一致）
        const legacy = s.ctx.strokes.filter((k) => k.color.toLowerCase() === LEGACY_DEBUG_OUTLINE);
        expect(legacy.length, `${phase} ${vp.w}×${vp.h}：无近黑 ${LEGACY_DEBUG_OUTLINE} 硬线框`).toBe(0);
        // 部件表现轮廓（由填充色派生）线宽必须收敛 ≤1.2，不再恒定 1.5 粗线
        const partOutlines = s.ctx.strokes.filter(
          (k) =>
            k.color === partOutlineColor(VEHICLE_COLOR_A) ||
            k.color === partOutlineColor(VEHICLE_COLOR_B) ||
            k.color === partOutlineColor('#9aa4b5') ||
            k.color === partOutlineColor('#d8d2c0'),
        );
        expect(partOutlines.length, `${phase} ${vp.w}×${vp.h}：部件表现轮廓存在（部件未被删除）`).toBeGreaterThan(0);
        for (const k of partOutlines) {
          expect(k.width, `${phase} ${vp.w}×${vp.h}：轮廓线宽收敛 ≤1.2（实测 ${k.width}）`).toBeLessThanOrEqual(1.2);
          expect(k.width, `${phase} ${vp.w}×${vp.h}：轮廓线宽下限 0.6`).toBeGreaterThanOrEqual(0.6);
          expect(k.join, `${phase} ${vp.w}×${vp.h}：圆角 join（去工程直角盒语气）`).toBe('round');
        }
      }
    }
  });

  it('T2. 真实部件未被删除（Must#3）：车身/部件仍填充绘制，轮廓色 = 填充色派生（非近黑、非删除）', () => {
    const s = battleScene({ w: 844, h: 390 });
    s.r.render(s.o);
    // 车身填充仍在（A 蓝 / B 橙）——「重做轮廓」而非「删除部件」
    expect(s.ctx.fills, 'A 车身填充仍绘制').toContain(VEHICLE_COLOR_A);
    expect(s.ctx.fills, 'B 车身填充仍绘制').toContain(VEHICLE_COLOR_B);
    // 轮廓色与填充同色系（对比度降低 → 不再读作调试线框）
    const outA = partOutlineColor(VEHICLE_COLOR_A);
    expect(s.ctx.strokes.some((k) => k.color === outA), `A 车身轮廓 = 填充派生 ${outA}`).toBe(true);
    // 派生规则可验证：填充朝 #1b2130 混 50%
    expect(outA).toBe(mixHexColor(VEHICLE_COLOR_A, '#1b2130', 0.5));
    // 派生轮廓相对旧近黑显著更亮（对比度下降 = 外框感消失的量化证据）
    const lum = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16);
      return (((n >> 16) & 255) * 0.2126 + ((n >> 8) & 255) * 0.7152 + (n & 255) * 0.0722) / 255;
    };
    expect(lum(outA), '表现轮廓亮度显著高于旧近黑').toBeGreaterThan(lum(LEGACY_DEBUG_OUTLINE) + 0.15);
  });

  it('T3. 四档分辨率双车完整入画（Acceptance：420×210 / 621×351 / 844×390 / 1280×592）', () => {
    for (const vp of VIEWPORTS) {
      const s = battleScene(vp);
      s.r.render(s.o);
      const rects = s.r.getVehicleScreenRects(s.snap)!;
      for (const [name, rc] of [['A', rects.a], ['B', rects.b]] as const) {
        expect(rc.x, `${vp.w}×${vp.h} ${name} 左缘入画`).toBeGreaterThanOrEqual(-0.5);
        expect(rc.y, `${vp.w}×${vp.h} ${name} 上缘入画`).toBeGreaterThanOrEqual(-0.5);
        expect(rc.x + rc.w, `${vp.w}×${vp.h} ${name} 右缘入画`).toBeLessThanOrEqual(vp.w + 0.5);
        expect(rc.y + rc.h, `${vp.w}×${vp.h} ${name} 下缘入画`).toBeLessThanOrEqual(vp.h + 0.5);
        expect(rc.w, `${vp.w}×${vp.h} ${name} 可见宽度 > 0`).toBeGreaterThan(0);
      }
      // A 在 B 左侧、互不重叠（「谁是谁」可读）
      expect(rects.a.x + rects.a.w, `${vp.w}×${vp.h} A/B 不重叠`).toBeLessThanOrEqual(rects.b.x + 0.5);
    }
  });

  it('T4. 双方接触点屏幕避让：同一 contactPoint 两方数字分居两侧、间距 ≥28px（Must#4）', () => {
    for (const vp of VIEWPORTS) {
      const s = battleScene(vp);
      const cp = { x: 800, y: 620 }; // 同一世界接触点
      s.r.spawnDamageNumberFromEvent(makeDamage({ source: 'A', target: 'B', contactPoint: cp, damage: 40 }));
      s.r.spawnDamageNumberFromEvent(
        makeDamage({ source: 'B', target: 'A', contactPoint: cp, partId: 'saw-1', behavior: 'saw', damage: 25 }),
      );
      s.ctx.texts.length = 0;
      s.r.render(s.o);
      const xA = s.ctx.texts.find((t) => t.t === '-25')?.x; // target=A（我方受伤）
      const xB = s.ctx.texts.find((t) => t.t === '-40')?.x; // target=B（对手受伤）
      expect(xA, `${vp.w}×${vp.h} 我方受伤数字已绘制`).toBeDefined();
      expect(xB, `${vp.w}×${vp.h} 对手受伤数字已绘制`).toBeDefined();
      expect(Math.abs(xA! - xB!), `${vp.w}×${vp.h} 跨方数字水平间距 ≥28px（实测 ${Math.abs(xA! - xB!)}）`).toBeGreaterThanOrEqual(28);
      // 方向：受伤方数字偏向受伤方一侧（A 在 B 左 → 我方数字更靠左）
      const rects = s.r.getVehicleScreenRects(s.snap)!;
      const aLeft = rects.a.x + rects.a.w / 2 < rects.b.x + rects.b.w / 2;
      expect(aLeft, `${vp.w}×${vp.h} A 在 B 左侧（前置）`).toBe(true);
      expect(xA! < xB!, `${vp.w}×${vp.h} 我方数字偏我方（左）、对手数字偏对手（右）`).toBe(true);
    }
  });

  it('T5. 显示总伤害守恒（Must#4）：避让只挪像素，不吞不改累计伤害', () => {
    const s = battleScene({ w: 844, h: 390 });
    const cp = { x: 800, y: 620 };
    const real = [40, 25, 13];
    s.r.spawnDamageNumberFromEvent(makeDamage({ target: 'B', contactPoint: cp, damage: real[0] }));
    s.r.spawnDamageNumberFromEvent(
      makeDamage({ source: 'B', target: 'A', contactPoint: cp, partId: 'saw-1', behavior: 'saw', damage: real[1] }),
    );
    fakeNow += 300; // 超聚合窗口 → 新组（同车第 2 组）
    s.r.spawnDamageNumberFromEvent(makeDamage({ target: 'B', contactPoint: cp, partId: 'mg-1', behavior: 'machineGun', damage: real[2] }));
    const shown = s.r.activeDamageNumbers.reduce((sum, f) => sum + Number(f.text.replace('-', '')), 0);
    expect(shown, '显示合计 == 真实伤害总量').toBe(real[0] + real[1] + real[2]);
    // 同车 ≤2 组仍成立（避让不放宽既有硬限）
    expect(s.r.activeDamageNumbers.filter((f) => f.target === 'B').length, '同车 ≤2 组').toBeLessThanOrEqual(2);
  });

  it('T6. 无持续噪音：TTL 到期后伤害数字清零（不常驻画面）', () => {
    const s = battleScene({ w: 844, h: 390 });
    s.r.spawnDamageNumberFromEvent(makeDamage());
    expect(s.r.activeDamageNumbers.length, '刚命中：有数字').toBe(1);
    fakeNow += 1000; // > DAMAGE_NUMBER_TTL_MS 900
    expect(s.r.activeDamageNumbers.length, 'TTL 过期：清零').toBe(0);
    s.ctx.texts.length = 0;
    s.r.render(s.o);
    expect(s.ctx.texts.some((t) => t.t.startsWith('-')), '过期后不再绘制伤害数字').toBe(false);
  });

  it('T7. HUD 安全区（Must#5）：Battle HUD 绘制矩形不与微信胶囊内缩带相交', () => {
    const insets = { left: 44, right: 60, top: 12, bottom: 16 }; // right=60 模拟微信胶囊内缩
    for (const vp of [{ w: 420, h: 210 }, { w: 844, h: 390 }]) {
      const ctx = new RecCtx();
      const core = createWebCore();
      bindPlatformCore({
        ...core,
        createViewport: () => ({
          surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 }),
          onResize: () => {},
          safeInsets: () => insets,
        }),
      } as unknown as Parameters<typeof bindPlatformCore>[0]);
      const host = new CanvasPlayerUIHost(makeCanvas(ctx, vp));
      host.mountCanvas();
      host.render({
        playerPhase: 'garage',
        uiMode: 'build',
        battleState: 'fighting',
        draft: null as never,
      } as unknown as PlayerUIState);
      ctx.rects.length = 0;
      host.renderBattleFrame({
        battleState: 'fighting',
        battleStatus: { phase: 'Warning', sideA: { hp: 60, maxHp: 100 }, sideB: { hp: 40, maxHp: 100 } },
        phaseCountdownText: '收束警告 2',
      } as PlayerUIHudFrame);
      const capsuleLeft = vp.w - insets.right;
      const offenders = ctx.rects.filter(
        (rc) => rc.w > 0 && rc.h > 0 && rc.x + rc.w > capsuleLeft + 0.5 && rc.x < vp.w,
      );
      expect(offenders.length, `${vp.w}×${vp.h} HUD 不与胶囊带 [${capsuleLeft}, ${vp.w}] 相交（越界 ${offenders.length} 个）`).toBe(0);
      // 左侧安全区同样遵守
      const leftOffenders = ctx.rects.filter((rc) => rc.w > 0 && rc.h > 0 && rc.x < insets.left - 0.5 && rc.x + rc.w > 0);
      expect(leftOffenders.length, `${vp.w}×${vp.h} HUD 不越左安全区 ${insets.left}`).toBe(0);
    }
  });

  it('T8. 命中反馈不使用大面积闪屏（Must#6）：hit-flash 只白描边、不整块白填充', () => {
    const s = battleScene({ w: 844, h: 390 });
    s.r.spawnHitFlash('B');
    s.ctx.fills.length = 0;
    s.ctx.strokes.length = 0;
    s.r.render(s.o);
    expect(s.ctx.strokes.some((k) => k.color === '#ffffff'), '受击白描边存在（反馈清楚）').toBe(true);
    expect(s.ctx.fills.some((f) => f === '#ffffff' || f === '#fff'), '不做整块白色填充（无大面积闪屏）').toBe(false);
  });
});

/** 表现轮廓派生纯函数（不依赖 canvas / snapshot） */
describe('F-BATTLE-VISUAL-CLEANUP-R3｜表现轮廓派生', () => {
  it('T9. mixHexColor / partOutlineColor：同色系加深、非近黑、非法输入不抛', () => {
    expect(mixHexColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHexColor('#ff0000', '#0000ff', 0)).toBe('#ff0000');
    expect(mixHexColor('#ff0000', '#0000ff', 1)).toBe('#0000ff');
    expect(mixHexColor('#ff0000', '#0000ff', 5)).toBe('#0000ff'); // clamp
    expect(() => mixHexColor('not-a-color', '#0000ff', 0.5)).not.toThrow();
    const out = partOutlineColor('#4aa3ff');
    expect(out).not.toBe('#0d0f14');
    expect(out.startsWith('#')).toBe(true);
    expect(out).toHaveLength(7);
  });
});

/*
 * 说明（Must#2 的「不得显示」四类，均为不进 Battle 的结构性事实）：
 *  - 碰撞包围盒 / E2E 诊断轮廓：render(o) 正式路径不传 debugDraw（上方全部用例均如此调用）；
 *  - 挂点调试框 / Garage 吸附反馈：只在 garage MetaPage 绘制（本文件 T7 只走 renderBattleFrame，
 *    Battle HUD 路径内不含挂点 / ghost 绘制）。
 */
