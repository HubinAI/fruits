/**
 * F-UX-3B｜Battle 去 UI 化 + 主体放大：
 * 1. mobile-short HUD 只保留左右 HP 条（删 A/B 字母、HP 数字、「战斗中」）；
 *    Warning/Closing 才中央显示阶段提示/倒计时（functional：recording ctx 捕获 fillText）；
 * 2. compact battle Active 薄地面构图——Ground 只改视觉厚度（Physics ground 不动）：
 *    420×210 地面占屏 ∈ [28,32]%（F-BATTLE-STAGE-COMPOSITION-P0 battleStageRect：groundY 68~72% 视口）；
 * 3. 双车开局完整入画 + 车辆位于薄 HUD 之下（FX/武器不被 HUD 遮挡）；
 * 4. mobile-normal HUD 零回归（844×390 仍有 A/B/数字/「战斗中」）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { getInventory } from '../src/core/partInventory';
import type { SafeInsets } from '../src/platform/types';
import type { PlayerUIState } from '../src/ui/playerUI';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import type { CanvasSurface } from '../src/render/canvasSurface';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { RenderVehicle } from '../src/battle/battleContract';

const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };
/** compact 矩阵：360×180 ~ 932×430（short: logicalH<260） */
const COMPACT_VPS = [
  { w: 360, h: 180, short: true },
  { w: 390, h: 195, short: true },
  { w: 420, h: 210, short: true },
  { w: 460, h: 230, short: true },
  { w: 621, h: 351, short: false },
  { w: 844, h: 390, short: false },
  { w: 932, h: 430, short: false },
];

function makeStubCtx(): CanvasRenderingContext2D {
  return new Proxy({} as CanvasRenderingContext2D, {
    get: () => () => ({ width: 0 }),
    set: () => true,
  });
}

/** 记录 fillText 文本的 ctx（其余方法 no-op）——用于断言 HUD 实际画了什么文字 */
function makeRecCtx(): { ctx: CanvasRenderingContext2D; texts: string[] } {
  const texts: string[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, prop) => {
      if (prop === 'fillText') return (s: string): void => void texts.push(String(s));
      return () => ({ width: 0 });
    },
    set: () => true,
  });
  return { ctx, texts };
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

function makeRecHost(vp: { w: number; h: number }): { host: CanvasPlayerUIHost; texts: () => string[] } {
  const { ctx, texts } = makeRecCtx();
  const core = createWebCore();
  bindPlatformCore({
    ...core,
    input: {
      bindClick: () => {},
      bindPointer: () => {},
    },
    createViewport: () => ({
      surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 }),
      onResize: () => {},
      safeInsets: () => INSETS,
    }),
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  const canvas = {
    getContext: () => ctx,
    width: vp.w,
    height: vp.h,
    style: undefined,
  } as unknown as HTMLCanvasElement;
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas();
  host.setActions({} as never);
  return { host, texts: () => texts };
}

/** 车辆世界 AABB → 屏幕 AABB（includeParts=true → envelope 完整外廓） */
function vehicleScreenBounds(
  v: RenderVehicle,
  cam: { scale: number; offsetX: number; offsetY: number },
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const acc = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  const shape = (s: RenderVehicle['body']): void => {
    if (s.kind === 'polygons') {
      for (const poly of s.polygons) for (const p of poly.points) acc(p.x, p.y);
    } else {
      acc(s.circle.center.x - s.circle.radius, s.circle.center.y - s.circle.radius);
      acc(s.circle.center.x + s.circle.radius, s.circle.center.y + s.circle.radius);
    }
  };
  shape(v.body);
  for (const w of v.wheels) {
    acc(w.center.x - w.radius, w.center.y - w.radius);
    acc(w.center.x + w.radius, w.center.y + w.radius);
  }
  for (const p of v.parts) shape(p.shape);
  const sx = (x: number): number => x * cam.scale + cam.offsetX;
  const sy = (y: number): number => y * cam.scale + cam.offsetY;
  return { minX: sx(minX), minY: sy(minY), maxX: sx(maxX), maxY: sy(maxY) };
}

/** 420×210 等 viewport 的 battle Active 相机（真实 Planck 开局 snapshot） */
function battleActiveCam(w: number, h: number): {
  groundFillPct: number;
  vehicles: Array<{ minX: number; minY: number; maxX: number; maxY: number }>;
} {
  const canvas = {
    getContext: () => makeStubCtx(),
    clientWidth: w,
    clientHeight: h,
    width: w,
    height: h,
  } as unknown as HTMLCanvasElement;
  const surface: CanvasSurface = { width: w, height: h, devicePixelRatio: 1, now: () => 0 };
  const o = new PlanckBattleOrchestrator(
    buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'a'),
    buildSnapshotFromDraft(makeStarterDraft('bananaBody', registry), registry, 'b'),
    registry,
    { autoDrive: true },
  );
  const r = new Renderer(canvas, new VisualRegistry(), surface);
  const snap = o.getRenderSnapshot();
  r.resize(snap.arena.width, o.arena.config.height);
  r.reframe(snap, 'battle', { phase: 'Active' });
  const cam = r.transform;
  const groundScreenY = cam.offsetY + snap.arena.groundY * cam.scale;
  const fillPct = ((h - groundScreenY) / h) * 100;
  const vehicles = [snap.vehicleA, snap.vehicleB].map((v) => vehicleScreenBounds(v, cam));
  return { groundFillPct: fillPct, vehicles };
}

describe('F-UX-3B Battle 去 UI 化 + 主体放大', () => {
  beforeAll(() => {
    bindPlatformCore(createWebCore());
  });

  it('1. mobile-short HUD：只保留 HP 条——无 A/B 字母、无 HP 数字、无「战斗中」', () => {
    const { host, texts } = makeRecHost({ w: 420, h: 210 });
    host.render(garageState({ battleState: 'fighting' }));
    host.renderBattleFrame({
      battleState: 'fighting',
      battleStatus: { phase: 'Active', sideA: { hp: 70, maxHp: 100 }, sideB: { hp: 40, maxHp: 100 } },
      phaseCountdownText: null,
    });
    const t = texts();
    expect(t.some((s) => s === 'A' || s === 'B'), 'short HUD 无 A/B 字母').toBe(false);
    expect(t.some((s) => s === '70' || s === '40'), 'short HUD 无 HP 数字').toBe(false);
    expect(t.some((s) => s.includes('战斗中')), 'short HUD 无「战斗中」常驻文字').toBe(false);
    // 无阶段提示（Active 不显示）
    expect(t.some((s) => s.includes('警告') || s.includes('刺墙')), 'Active 无阶段提示').toBe(false);
  });

  it('2. mobile-short HUD：Warning/Closing 才中央显示阶段提示 + 倒计时', () => {
    const { host, texts } = makeRecHost({ w: 420, h: 210 });
    host.render(garageState({ battleState: 'fighting' }));
    host.renderBattleFrame({
      battleState: 'fighting',
      battleStatus: { phase: 'Warning', sideA: { hp: 50, maxHp: 100 }, sideB: { hp: 50, maxHp: 100 } },
      phaseCountdownText: '2',
    });
    expect(texts().some((s) => s.includes('警告') && s.includes('2')), 'Warning 中央提示含倒计时').toBe(true);
    host.renderBattleFrame({
      battleState: 'fighting',
      battleStatus: { phase: 'Closing', sideA: { hp: 50, maxHp: 100 }, sideB: { hp: 50, maxHp: 100 } },
      phaseCountdownText: '3',
    });
    expect(texts().some((s) => s.includes('刺墙逼近') && s.includes('3')), 'Closing 中央提示含倒计时').toBe(true);
  });

  it('3. mobile-normal（844×390）HUD 阵营卡：名称（我方/对手）+ HP 数字辅助 +「战斗中」；不再只显示 A/B', () => {
    const { host, texts } = makeRecHost({ w: 844, h: 390 });
    host.render(garageState({ battleState: 'fighting' }));
    host.renderBattleFrame({
      battleState: 'fighting',
      battleStatus: { phase: 'Active', sideA: { hp: 70, maxHp: 100 }, sideB: { hp: 40, maxHp: 100 } },
      phaseCountdownText: null,
    });
    const t = texts();
    expect(t.some((s) => s === 'A' || s === 'B'), 'F-BATTLE-READABILITY-R1：阵营卡不再只显示 A/B 字母').toBe(false);
    expect(t.some((s) => s.includes('我方') || s.includes('对手')), '阵营卡显示我方/对手名（无 names 回落）').toBe(true);
    expect(t.some((s) => s === '70' || s === '40'), 'normal HUD 保留 HP 数字（辅助信息）').toBe(true);
    expect(t.some((s) => s.includes('战斗中')), 'normal HUD 保留「战斗中」').toBe(true);
  });

  it('4. compact battle 地面线 68~72% 视口（420×210 地面占屏 ∈ [28,32]%，battleStageRect）+ 双车完整入画', () => {
    const { groundFillPct, vehicles } = battleActiveCam(420, 210);
    expect(groundFillPct, `420×210 地面 ${groundFillPct.toFixed(1)}% ∈ [28,32]%（地面线 68~72% 视口）`).toBeGreaterThanOrEqual(28);
    expect(groundFillPct, `420×210 地面 ${groundFillPct.toFixed(1)}% ≤ 32%`).toBeLessThanOrEqual(32);
    for (const [i, b] of vehicles.entries()) {
      expect(b.minX, `车辆${i} 左缘入画`).toBeGreaterThanOrEqual(-1);
      expect(b.maxX, `车辆${i} 右缘入画`).toBeLessThanOrEqual(421);
      expect(b.minY, `车辆${i} 顶缘入画`).toBeGreaterThanOrEqual(-1);
      expect(b.maxY, `车辆${i} 底缘入画`).toBeLessThanOrEqual(211);
      // F-BATTLE-CAMERA-R2：车辆顶缘在 HUD 安全区（56 逻辑 px）之下、不被顶部遮挡
      expect(b.minY, `车辆${i} 顶缘在 HUD 安全区（56px）之下`).toBeGreaterThanOrEqual(56);
    }
  });

  it('5. 全 compact 矩阵地面线 68~72% 视口（地面占屏 [28,32]%，battleStageRect）；w≥400 双车完整入画', () => {
    for (const vp of COMPACT_VPS) {
      const { groundFillPct, vehicles } = battleActiveCam(vp.w, vp.h);
      expect(
        groundFillPct,
        `${vp.w}×${vp.h} 地面 ${groundFillPct.toFixed(1)}% ∈ [28,32]%（地面线 68~72% 视口）`,
      ).toBeGreaterThanOrEqual(28);
      expect(groundFillPct, `${vp.w}×${vp.h} 地面 ${groundFillPct.toFixed(1)}% ≤ 32%`).toBeLessThanOrEqual(32);
      // w<400（360/390）受既有 MIN_CONTENT_SCALE=0.4 下限钳制（预存行为，非 3B 引入）——
      // 只验收「地面变薄」；完整入画断言限定 w≥400（corridor 数学上可容纳）。
      if (vp.w >= 400) {
        for (const b of vehicles) {
          expect(b.minX, `${vp.w}×${vp.h} 左缘入画`).toBeGreaterThanOrEqual(-1);
          expect(b.maxX, `${vp.w}×${vp.h} 右缘入画`).toBeLessThanOrEqual(vp.w + 1);
          expect(b.minY, `${vp.w}×${vp.h} 顶缘入画`).toBeGreaterThanOrEqual(-1);
          expect(b.maxY, `${vp.w}×${vp.h} 底缘入画`).toBeLessThanOrEqual(vp.h + 1);
          expect(b.minY, `${vp.w}×${vp.h} 车辆在 HUD 区（56px）之下`).toBeGreaterThanOrEqual(55);
        }
      }
    }
  });

  it('6. 源码守卫：drawHudShort 无常驻文字；runtime pollArenaPhase 含 Closing 倒计时分支', () => {
    const hostSrc = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    const shortMethod = hostSrc.slice(hostSrc.indexOf('private drawHudShort'), hostSrc.indexOf('// ==================== Result'));
    expect(shortMethod).toContain('Warning');
    expect(shortMethod).toContain('Closing');
    expect(shortMethod, 'short HUD 无「战斗中」常驻文字').not.toContain('战斗中');
    expect(shortMethod, 'short HUD 无 A 字母').not.toContain("text('A'");
    expect(shortMethod, 'short HUD 无 B 字母').not.toContain("text('B'");
    expect(shortMethod, 'short HUD 无 HP 数字').not.toContain('Math.round(s.sideA.hp)');
    const rt = readFileSync('src/game/playerGameRuntime.ts', 'utf-8');
    expect(rt, 'runtime Closing 倒计时分支存在').toContain("o.phase === 'Closing'");
  });
});
