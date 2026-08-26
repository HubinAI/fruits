/**
 * F-MATCH-CAMERA-TRANSACTION-P0｜匹配首帧错误相机与 Locked 跳变验收。
 *
 * 根因：startMatching 顺序 = loadMatchAB → reframePlayerCamera → 最后提交 phase='matching'。
 * reframePlayerCamera 用 playerPhaseInternal 推断 fit——loadMatchAB 时仍为 'garage' →
 * 首帧误用 previewSolo（单车构图：车辆过大/对手裁切），进入 matchPreview 才切 previewFixed
 * → Locked 突然缩小。且 previewFixed 在 reframePlayerCamera 中原会混入 home framingRect
 * （matching 时 metaPage 被复位为 'home'）→ 与首帧无 framing 不一致。
 *
 * 修复：loadMatchAB 战前准备显式 reframe('previewFixed')；reframePlayerCamera 中
 * previewFixed 不传 framingRect（全屏固定框语义）。
 *
 * 验收（Must#6：真实 Renderer + orchestrator，不得以 fake reframe 空实现为主要验收）：
 * 1. 时序：startMatching 首帧 reframe = previewFixed（全程无 previewSolo）；候选切换不重构图；
 * 2. 真实相机：4 视口 previewFixed 首帧 = 正确双车构图（A 左 / B 右、不重叠、完整入画、
 *    B 不越右安全边界）；
 * 3. Matching → Locked：同一 previewFixed 两帧 A/B 中心位移 ≤2px、scale 变化 ≤2%；
 * 4. 扫描框 = 该帧真实 bRect（getVehicleScreenRects 同源，完整在安全区）；
 * 5. 失败原子性：loadCustomPreview / reframe 抛错 → 玩家完整停留 Home（phase 仍 garage）。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { registry } from '../src/core/content';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { PlayerGameRuntime } from '../src/game/playerGameRuntime';
import type { PlayerBattleHost } from '../src/game/playerGameRuntime';
import type { PlayerUIHost, PlayerUIActions } from '../src/ui/playerUI';
import type { PlayerUIState } from '../src/ui/playerUI';
import type { CanvasSurface } from '../src/render/canvasSurface';
import type { SafeInsets } from '../src/platform/types';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { createWechatCore } from '../src/platform/wechat';

const RUNTIME = readFileSync('src/game/playerGameRuntime.ts', 'utf-8');

const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };
const VIEWPORTS = [
  { w: 360, h: 180 },
  { w: 420, h: 210 },
  { w: 621, h: 351 },
  { w: 844, h: 390 },
];
const A_BODY = 'boxBody';
const B_BODIES = ['watermelonBody', 'bananaBody', 'pineappleBody'];

type Rect = { x: number; y: number; w: number; h: number };

// —— 真实相机：真实 orchestrator + renderer + previewFixed 固定框 ——
function frameMatch(vp: { w: number; h: number }, bodyA: string, bodyB: string): {
  a: Rect;
  b: Rect;
  scale: number;
  view: { w: number; h: number };
} {
  const canvas = {
    getContext: () => new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true }),
    width: vp.w,
    height: vp.h,
  } as unknown as HTMLCanvasElement;
  const surface: CanvasSurface = { width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 };
  const o = new PlanckBattleOrchestrator(
    buildSnapshotFromDraft(makeStarterDraft(bodyA, registry), registry, 'a'),
    buildSnapshotFromDraft(makeStarterDraft(bodyB, registry), registry, 'b'),
    registry,
    { autoDrive: true },
    false,
  );
  const r = new Renderer(canvas, new VisualRegistry(), surface);
  const snap = o.getRenderSnapshot();
  r.resize(snap.arena.width, o.arena.config.height);
  r.reframe(snap, 'previewFixed'); // = 修复后 loadMatchAB / matching 阶段 reframePlayerCamera
  const rects = r.getVehicleScreenRects(snap)!;
  const diag = r.scaleDiagnostics(snap);
  return { a: rects.a, b: rects.b, scale: diag.scale, view: { w: diag.view.w, h: diag.view.h } };
}

// —— 增强 fake battle host：记录 reframe 序列 + 可注入失败 ——
class RecordingBattleHost implements PlayerBattleHost {
  previewMode = false;
  orchestrator: PlayerBattleHost['orchestrator'] = null;
  reframeCalls: Array<{ fit: string; framing: unknown }> = [];
  failLoad = false;
  failReframe = false;
  loadCustomPreview(): void {
    if (this.failLoad) throw new Error('loadCustomPreview boom');
    this.previewMode = true;
  }
  loadCustom(): void {
    this.previewMode = false;
  }
  step(): void {}
  render(): void {}
  setPreviewVehicleFx(): void {}
  arenaDims(): { w: number; h: number } {
    return { w: 1600, h: 900 };
  }
  reframe(fit: string, framing?: unknown): void {
    if (this.failReframe) throw new Error('reframe boom');
    this.reframeCalls.push({ fit, framing });
  }
  resize(): void {}
}

class RecordHost implements PlayerUIHost {
  actions: PlayerUIActions | null = null;
  lastState: PlayerUIState | null = null;
  mountCanvas(): void {}
  mount(): void {}
  renderBattleFrame(): void {}
  render(s: PlayerUIState): void {
    this.lastState = s;
  }
  getHitAreasForTest() {
    return [];
  }
  isMobileView(): boolean {
    return true;
  }
  getPreviewFramingRect() {
    return { x: 59, y: 0, w: 726, h: 34, mode: 'home' as const };
  }
  setActions(a: PlayerUIActions): void {
    this.actions = a;
  }
  setDraft?(): void {}
}

function setup(battle: RecordingBattleHost, host: RecordHost): PlayerGameRuntime {
  const store = new Map<string, unknown>();
  (globalThis as any).wx = {
    getSystemInfoSync: () => ({ pixelRatio: 2 }),
    getStorageSync: (k: string) => (store.has(k) ? store.get(k) : null),
    setStorageSync: (k: string, v: unknown) => void store.set(k, v),
    removeStorageSync: (k: string) => void store.delete(k),
  };
  bindPlatformCore(createWechatCore(2));
  const runtime = new PlayerGameRuntime({ host, battle, sfx: { resume() {} } });
  runtime.init();
  return runtime;
}

describe('F-MATCH-CAMERA-TRANSACTION-P0｜匹配首帧相机与 Locked 连续性', () => {
  afterEach(() => {
    vi.useRealTimers();
    bindPlatformCore(createWebCore());
    delete (globalThis as any).wx;
  });

  it('T1. 时序：startMatching 首帧 reframe = previewFixed（全程无 previewSolo）；候选切换不重构图；Locked 仍 previewFixed', () => {
    vi.useFakeTimers();
    const battle = new RecordingBattleHost();
    const host = new RecordHost();
    const runtime = setup(battle, host);
    runtime.actions.onFindOpponent();
    // startMatching → loadMatchAB → 首个 reframe 必须是 previewFixed（不是 previewSolo）
    expect(battle.reframeCalls.length, '首帧已 reframe').toBeGreaterThanOrEqual(1);
    expect(battle.reframeCalls[0]!.fit, '战前准备首帧 = previewFixed（不依赖未提交 phase）').toBe('previewFixed');
    expect(battle.reframeCalls[0]!.framing, 'previewFixed 不带 framingRect（全屏固定框语义）').toBeUndefined();
    expect(battle.reframeCalls.some((c) => c.fit === 'previewSolo'), '匹配全程无 previewSolo').toBe(false);
    // 候选切换 3 次（340/720/1100ms）→ 不重构图
    vi.advanceTimersByTime(1420);
    const afterCandidates = battle.reframeCalls.length;
    expect(runtime.playerPhase, '进入 matchPreview').toBe('matchPreview');
    expect(battle.reframeCalls.length, '候选切换期间不重构图（相机固定）').toBe(afterCandidates);
    // Locked（goToMatchPreview）仍 previewFixed + 无 framing
    const lastCall = battle.reframeCalls[battle.reframeCalls.length - 1]!;
    expect(lastCall.fit, 'Locked 仍 previewFixed').toBe('previewFixed');
    expect(lastCall.framing, 'Locked previewFixed 无 framing').toBeUndefined();
  });

  it('T2. 真实相机：首帧 previewFixed = 正确双车构图（4 视口 × 3 候选：A 左/B 右、不重叠、完整入画、B 不越右安全边界）', () => {
    for (const vp of VIEWPORTS) {
      for (const bodyB of B_BODIES) {
        const m = frameMatch(vp, A_BODY, bodyB);
        const W = vp.w;
        const safeRight = W - INSETS.right;
        expect(m.a.x, `${vp.w}×${vp.h} B=${bodyB} A 左缘 ≥ 0`).toBeGreaterThanOrEqual(0);
        expect(m.a.x + m.a.w, `${vp.w}×${vp.h} B=${bodyB} A 右缘 ≤ 屏宽`).toBeLessThanOrEqual(W + 1);
        expect(m.b.x, `${vp.w}×${vp.h} B=${bodyB} B 左缘 ≥ 0`).toBeGreaterThanOrEqual(0);
        expect(m.b.x + m.b.w, `${vp.w}×${vp.h} B=${bodyB} B 右缘 ≤ 屏宽（不越界）`).toBeLessThanOrEqual(W + 1);
        expect(m.b.x + m.b.w, `${vp.w}×${vp.h} B=${bodyB} B 不越右安全边界`).toBeLessThanOrEqual(safeRight + 2);
        // A 左半 / B 右半
        const aCx = m.a.x + m.a.w / 2;
        const bCx = m.b.x + m.b.w / 2;
        expect(aCx, `${vp.w}×${vp.h} A 中心在左半屏`).toBeLessThan(W / 2);
        expect(bCx, `${vp.w}×${vp.h} B 中心在右半屏`).toBeGreaterThan(W / 2);
        // A/B 不重叠（中央 VS 间隙）
        expect(m.a.x + m.a.w, `${vp.w}×${vp.h} A 右缘 ≤ B 左缘（不重叠）`).toBeLessThanOrEqual(m.b.x + 1);
        // 纵向完整
        expect(m.a.y, `${vp.w}×${vp.h} A 顶 ≥ 0`).toBeGreaterThanOrEqual(0);
        expect(m.a.y + m.a.h, `${vp.w}×${vp.h} A 底 ≤ 屏高`).toBeLessThanOrEqual(vp.h + 1);
        expect(m.b.y + m.b.h, `${vp.w}×${vp.h} B 底 ≤ 屏高`).toBeLessThanOrEqual(vp.h + 1);
      }
    }
  });

  it('T3. Matching → Locked 无可感知跳位/缩放：同一 previewFixed 两帧 A/B 中心位移 ≤2px、scale 变化 ≤2%', () => {
    for (const vp of VIEWPORTS) {
      const f1 = frameMatch(vp, A_BODY, 'watermelonBody');
      const f2 = frameMatch(vp, A_BODY, 'watermelonBody'); // Locked 同候选（同 spawn 同 fit）
      const dA = Math.abs(f1.a.x - f2.a.x) + Math.abs(f1.a.y - f2.a.y);
      const dB = Math.abs(f1.b.x - f2.b.x) + Math.abs(f1.b.y - f2.b.y);
      expect(dA, `${vp.w}×${vp.h} A 中心位移 ≤2px`).toBeLessThanOrEqual(2);
      expect(dB, `${vp.w}×${vp.h} B 中心位移 ≤2px`).toBeLessThanOrEqual(2);
      const scaleDelta = Math.abs(f1.scale - f2.scale) / f1.scale;
      expect(scaleDelta, `${vp.w}×${vp.h} 尺度变化 ≤2%`).toBeLessThanOrEqual(0.02);
    }
  });

  it('T4. 扫描框 = 该帧真实 bRect：getVehicleScreenRects 同源（B envelope 完整在安全区、与右槽位一致）', () => {
    for (const vp of VIEWPORTS) {
      const m = frameMatch(vp, A_BODY, 'bananaBody');
      // Host drawMatchingContinuum 扫描框以 matchVehicleRects.b（= renderer getVehicleScreenRects）
      // 为锚（F-MATCH-FRAME-R2）；bRect 本身即扫描框几何源
      expect(m.b.w, `${vp.w}×${vp.h} 扫描框对应 B envelope（宽 >0）`).toBeGreaterThan(0);
      expect(m.b.x, `${vp.w}×${vp.h} 扫描框左缘 ≥ 0`).toBeGreaterThanOrEqual(0);
      expect(m.b.x + m.b.w, `${vp.w}×${vp.h} 扫描框右缘 ≤ 安全右界`).toBeLessThanOrEqual(vp.w - INSETS.right + 2);
      expect(m.b.y, `${vp.w}×${vp.h} 扫描框顶 ≥ 0`).toBeGreaterThanOrEqual(0);
      expect(m.b.y + m.b.h, `${vp.w}×${vp.h} 扫描框底 ≤ 屏高`).toBeLessThanOrEqual(vp.h + 1);
    }
  });

  it('T5. 失败原子性：loadCustomPreview / reframe 抛错 → 玩家完整停留 Home（phase 仍 garage）', () => {
    vi.useFakeTimers();
    // 5a loadCustomPreview 抛错（init 成功后再注入失败——init 的 garage 预览也走 loadCustomPreview）
    const b1 = new RecordingBattleHost();
    const h1 = new RecordHost();
    const r1 = setup(b1, h1);
    b1.failLoad = true;
    expect(() => r1.actions.onFindOpponent(), 'loadCustomPreview 抛错不吞').toThrow();
    expect(r1.playerPhase, '加载失败 phase 仍 garage（完整停留 Home）').toBe('garage');
    expect(r1.battleState, '加载失败 battleState 仍 editing').toBe('editing');
    expect(h1.lastState?.playerPhase, 'Host 仍渲染 Home').toBe('garage');
    // 5b reframe 抛错
    const b2 = new RecordingBattleHost();
    const h2 = new RecordHost();
    const r2 = setup(b2, h2);
    b2.failReframe = true;
    expect(() => r2.actions.onFindOpponent(), 'reframe 抛错不吞').toThrow();
    expect(r2.playerPhase, 'reframe 失败 phase 仍 garage').toBe('garage');
    expect(h2.lastState?.playerPhase, 'Host 仍渲染 Home').toBe('garage');
  });

  it('T6. 源码守卫：战前准备显式 previewFixed + previewFixed 不混入 framingRect', () => {
    expect(RUNTIME, 'loadMatchAB 战前显式 previewFixed').toMatch(/loadCustomPreview\(sa, sb\);\s*\n\s*\/\/ F-MATCH-CAMERA-TRANSACTION-P0[\s\S]*?this\.deps\.battle\.reframe\('previewFixed'\);/);
    expect(RUNTIME, 'reframePlayerCamera previewFixed 不传 framingRect').toMatch(/const framing = fit === 'previewFixed' \? undefined :/);
    expect(RUNTIME, 'previewFixed 全屏固定框语义注释').toContain('全屏固定框语义');
  });
});
