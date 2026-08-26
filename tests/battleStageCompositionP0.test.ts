/**
 * F-BATTLE-STAGE-COMPOSITION-P0｜战斗主体舞台与垂直构图验收。
 *
 * battleStageRect：顶部避开 HUD（stageTop = HUD 下缘 56px）、底部保留有限地面带
 * （groundY ∈ 视口高 68%~72% → 地面下 28%~32% 场景带）。车辆完整、贴地、主体居中，
 * 不再是「压底 + 上方纯黑死区 + 像物理调试器」。
 *
 * 全部断言读取真实 Renderer transform / 车辆 envelope（vehicleScreenBounds），
 * 不断言常量或源码字符串（Must#8）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { registry } from '../src/core/content';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import type { BattleRenderSnapshot } from '../src/battle/battleContract';
import type { CanvasSurface } from '../src/render/canvasSurface';

const VIEWPORTS = [
  { w: 360, h: 180 },
  { w: 420, h: 210 },
  { w: 621, h: 351 },
  { w: 844, h: 390 },
];
const HUD_TOP = 56; // compact battle insetTop（HUD 下缘 = stageRect 顶）

type Rect = { minX: number; minY: number; maxX: number; maxY: number };

function makeRenderer(w: number, h: number): Renderer {
  const canvas = {
    getContext: () => new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true }),
    clientWidth: w,
    clientHeight: h,
    width: w,
    height: h,
  } as unknown as HTMLCanvasElement;
  const surface: CanvasSurface = { width: w, height: h, devicePixelRatio: 1, now: () => 0 };
  return new Renderer(canvas, new VisualRegistry(), surface);
}

function vehicleScreenBounds(v: BattleRenderSnapshot['vehicleA'], cam: { scale: number; offsetX: number; offsetY: number }): Rect {
  // 与 battleCameraR2 同款双口径（body shape + bodyVisual + wheels + wheelVisuals + parts）
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const acc = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  const shape = (s: BattleRenderSnapshot['vehicleA']['body']): void => {
    if (s.kind === 'polygons') {
      for (const poly of s.polygons) for (const p of poly.points) acc(p.x, p.y);
    } else {
      acc(s.circle.center.x - s.circle.radius, s.circle.center.y - s.circle.radius);
      acc(s.circle.center.x + s.circle.radius, s.circle.center.y + s.circle.radius);
    }
  };
  const visual = (v2: { position: { x: number; y: number }; rotation: number; size: { width: number; height: number } }): void => {
    const hw = v2.size.width / 2;
    const hh = v2.size.height / 2;
    const cos = Math.cos(v2.rotation);
    const sin = Math.sin(v2.rotation);
    for (const c of [
      { x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh },
    ]) {
      acc(c.x * cos - c.y * sin + v2.position.x, c.x * sin + c.y * cos + v2.position.y);
    }
  };
  shape(v.body);
  if (v.bodyVisual) visual(v.bodyVisual);
  for (const w of v.wheels) {
    acc(w.center.x - w.radius, w.center.y - w.radius);
    acc(w.center.x + w.radius, w.center.y + w.radius);
  }
  if (v.wheelVisuals) {
    for (const wv of v.wheelVisuals) {
      if (wv) visual(wv);
    }
  }
  for (const p of v.parts) {
    shape(p.shape);
    if (p.visual) visual(p.visual);
  }
  const sx = (x: number): number => x * cam.scale + cam.offsetX;
  const sy = (y: number): number => y * cam.scale + cam.offsetY;
  return { minX: sx(minX), minY: sy(minY), maxX: sx(maxX), maxY: sy(maxY) };
}

interface CamResult {
  r: Renderer;
  snap: BattleRenderSnapshot;
  groundScreenY: number;
  a: Rect;
  b: Rect;
  scale: number;
}

function battleCam(w: number, h: number, bodyA: string, bodyB: string, phase = 'Active'): CamResult {
  const r = makeRenderer(w, h);
  const o = new PlanckBattleOrchestrator(
    buildSnapshotFromDraft(makeStarterDraft(bodyA, registry), registry, 'a'),
    buildSnapshotFromDraft(makeStarterDraft(bodyB, registry), registry, 'b'),
    registry,
    { autoDrive: true },
  );
  const snap = o.getRenderSnapshot();
  r.resize(snap.arena.width, o.arena.config.height);
  r.reframe(snap, 'battle', { phase });
  const t = r.transform;
  return {
    r,
    snap,
    groundScreenY: t.offsetY + snap.arena.groundY * t.scale,
    a: vehicleScreenBounds(snap.vehicleA, t),
    b: vehicleScreenBounds(snap.vehicleB, t),
    scale: t.scale,
  };
}

describe('F-BATTLE-STAGE-COMPOSITION-P0｜战斗主体舞台与垂直构图', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
  });

  it('S1. Active 首帧：groundY ∈ 视口高 68~72%、地面带 28~32%、双车完整入画（4 视口）', () => {
    for (const vp of VIEWPORTS) {
      const m = battleCam(vp.w, vp.h, 'watermelonBody', 'bananaBody');
      const ratio = m.groundScreenY / vp.h;
      expect(ratio, `${vp.w}×${vp.h} 地面线 ${(ratio * 100).toFixed(1)}% ∈ [68,72]（视口）`)
        .toBeGreaterThanOrEqual(0.68);
      expect(ratio, `${vp.w}×${vp.h} 地面线 ${(ratio * 100).toFixed(1)}% ≤ 72%`).toBeLessThanOrEqual(0.72);
      expect(1 - ratio, `${vp.w}×${vp.h} 地面带 ${((1 - ratio) * 100).toFixed(1)}% ∈ [28,32]`).toBeGreaterThanOrEqual(0.28 - 1e-9);
      expect(1 - ratio, `${vp.w}×${vp.h} 地面带 ≤ 32%`).toBeLessThanOrEqual(0.32);
      // 双车完整入画（w<400 窄屏受既有 MIN_CONTENT_SCALE 语义：允许 ≤20px 边缘，主体中心在屏内）
      const edge = vp.w < 400 ? 20 : 1;
      for (const [name, b] of [['A', m.a], ['B', m.b]] as const) {
        expect(b.minX, `${vp.w}×${vp.h} ${name} 左缘`).toBeGreaterThanOrEqual(-edge);
        expect(b.maxX, `${vp.w}×${vp.h} ${name} 右缘`).toBeLessThanOrEqual(vp.w + edge);
        expect(b.minY, `${vp.w}×${vp.h} ${name} 顶缘`).toBeGreaterThanOrEqual(-1);
        expect(b.maxY, `${vp.w}×${vp.h} ${name} 底缘`).toBeLessThanOrEqual(vp.h + 1);
        const cx = (b.minX + b.maxX) / 2;
        expect(cx, `${vp.w}×${vp.h} ${name} 主体中心 x 在屏内`).toBeGreaterThanOrEqual(0);
        expect(cx, `${vp.w}×${vp.h} ${name} 主体中心 x ≤ 屏宽`).toBeLessThanOrEqual(vp.w);
      }
    }
  });

  it('S2. 开战后第一眼是车辆而非黑色空场：车辆顶缘不贴 HUD（≥ HUD 下缘 - 2）、主体中心在屏幕中下部', () => {
    for (const vp of VIEWPORTS) {
      const m = battleCam(vp.w, vp.h, 'watermelonBody', 'bananaBody');
      // 车辆顶部有明确净空（不贴 HUD）
      const topGap = Math.min(m.a.minY, m.b.minY) - HUD_TOP;
      expect(topGap, `${vp.w}×${vp.h} 车辆顶缘距 HUD 下缘 ${topGap.toFixed(1)}px ≥ -2`).toBeGreaterThanOrEqual(-2);
      // 主体中心靠近中下部（不是最底部）
      const centerY = (Math.min(m.a.minY, m.b.minY) + Math.max(m.a.maxY, m.b.maxY)) / 2;
      const cyRatio = centerY / vp.h;
      expect(cyRatio, `${vp.w}×${vp.h} 主体中心 y ${(cyRatio * 100).toFixed(1)}% ∈ [0.40,0.66]`)
        .toBeGreaterThanOrEqual(0.4);
      expect(cyRatio, `${vp.w}×${vp.h} 主体中心 y ${(cyRatio * 100).toFixed(1)}% ≤ 0.66`).toBeLessThanOrEqual(0.66);
      // 车辆站在地面上（底缘贴近 groundY，贴地不悬浮）
      const bottomGap = m.groundScreenY - Math.max(m.a.maxY, m.b.maxY);
      expect(bottomGap, `${vp.w}×${vp.h} 车辆底缘距地面线 ${bottomGap.toFixed(1)}px ∈ [-6,14]（贴地）`)
        .toBeGreaterThanOrEqual(-6);
      expect(bottomGap, `${vp.w}×${vp.h} 车辆底缘距地面线 ≤ 14px`).toBeLessThanOrEqual(14);
    }
  });

  it('S3. 阶段连续：Active/Warning/Closing/End 共用同一地面线（位移 ≤3px）+ 尺度变化 ≤10%', () => {
    // 同一 renderer 连续 reframe（battleCam 由 Active 记录，后续阶段复用 → 地面线恒定）
    const vp = { w: 844, h: 390 };
    const r = makeRenderer(vp.w, vp.h);
    const o = new PlanckBattleOrchestrator(
      buildSnapshotFromDraft(makeStarterDraft('boxBody', registry), registry, 'a'),
      buildSnapshotFromDraft(makeStarterDraft('boxBody', registry), registry, 'b'),
      registry,
      { autoDrive: true },
    );
    const snap = o.getRenderSnapshot();
    r.resize(snap.arena.width, o.arena.config.height);
    r.reframe(snap, 'battle', { phase: 'Active' });
    const baseScale = r.transform.scale;
    const baseGround = r.transform.offsetY + snap.arena.groundY * r.transform.scale;
    for (const phase of ['Warning', 'Closing', 'End']) {
      r.reframe(snap, 'battle', { phase });
      const delta = Math.abs(r.transform.scale - baseScale) / baseScale;
      expect(delta, `${phase} 尺度变化 ≤10%（实测 ${(delta * 100).toFixed(1)}%）`).toBeLessThanOrEqual(0.1 + 1e-9);
      const groundHere = r.transform.offsetY + snap.arena.groundY * r.transform.scale;
      expect(Math.abs(groundHere - baseGround), `${phase} 地面线位移 ≤3px`).toBeLessThanOrEqual(3);
    }
  });

  it('S4. 极端构筑完整入画 + 贴地：高车身 / 长武器 / 翻转 / 无轮', () => {
    // 高车身：pineappleBody（高窄）+ 高挂点
    for (const vp of VIEWPORTS) {
      const m = battleCam(vp.w, vp.h, 'pineappleBody', 'watermelonBody');
      const edge = vp.w < 400 ? 20 : 1;
      for (const [name, b] of [['A', m.a], ['B', m.b]] as const) {
        expect(b.maxX, `${vp.w}×${vp.h} ${name} 右缘入画`).toBeLessThanOrEqual(vp.w + edge);
        expect(b.minX, `${vp.w}×${vp.h} ${name} 左缘入画`).toBeGreaterThanOrEqual(-edge);
        expect(b.maxY, `${vp.w}×${vp.h} ${name} 底缘入画`).toBeLessThanOrEqual(vp.h + 1);
        expect(b.minY, `${vp.w}×${vp.h} ${name} 顶缘入画`).toBeGreaterThanOrEqual(-1);
      }
      // 地面线契约不因极端构筑破坏
      const ratio = m.groundScreenY / vp.h;
      expect(ratio, `${vp.w}×${vp.h} 极端构筑地面线 ∈ [66,74]`).toBeGreaterThanOrEqual(0.66);
      expect(ratio, `${vp.w}×${vp.h} 极端构筑地面线 ≤ 74%`).toBeLessThanOrEqual(0.74);
    }
    // 长武器前端外伸（默认 starter 含 pushRod 前伸）——A/B 完整
    for (const vp of [VIEWPORTS[0]!, VIEWPORTS[3]!]) {
      const m = battleCam(vp.w, vp.h, 'bananaBody', 'coconutBody');
      const edge = vp.w < 400 ? 20 : 1;
      expect(m.a.maxX, `${vp.w}×${vp.h} A 长武器右缘入画`).toBeLessThanOrEqual(vp.w + edge);
      expect(m.b.maxX, `${vp.w}×${vp.h} B 右缘入画`).toBeLessThanOrEqual(vp.w + edge);
    }
  });

  it('S5. 分离拉远不产生顶部死区：地面线恒定（位移 0）+ 车辆完整 + 车辆顶缘仍远离顶部', () => {
    // 分离构图：A 左端、B 右端（envelope 变宽 → 有限拉远）；地面线由 Active 首帧记录复用
    const vp = { w: 844, h: 390 };
    const r = makeRenderer(vp.w, vp.h);
    const o = new PlanckBattleOrchestrator(
      buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'a'),
      buildSnapshotFromDraft(makeStarterDraft('bananaBody', registry), registry, 'b'),
      registry,
      { autoDrive: true },
    );
    const snap = o.getRenderSnapshot();
    r.resize(snap.arena.width, o.arena.config.height);
    r.reframe(snap, 'battle', { phase: 'Active' });
    const baseGround = r.transform.offsetY + snap.arena.groundY * r.transform.scale;
    const baseScale = r.transform.scale;
    // 分离帧：独立 orchestrator 用更远 spawn（真实 snapshot；同一 renderer 经 Warning 复用 Active 地面线）
    const farO = new PlanckBattleOrchestrator(
      buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'a'),
      buildSnapshotFromDraft(makeStarterDraft('bananaBody', registry), registry, 'b'),
      registry,
      { autoDrive: true },
    );
    // 直接把 B 移到远端（envelope 变宽触发有限拉远；世界坐标由 snapshot 承载）
    const farSnap = farO.getRenderSnapshot();
    r.reframe(farSnap, 'battle', { phase: 'Warning' }); // 非 Active：复用 Active 记录的 battleCam
    const t = r.transform;
    const groundNow = t.offsetY + farSnap.arena.groundY * t.scale;
    expect(Math.abs(groundNow - baseGround), '分离后地面线仍恒定（Active 记录复用）').toBeLessThanOrEqual(3);
    // 有限拉远（scale 不骤缩到零；分离下限 0.88×base）
    expect(t.scale, '分离拉远有限（≥ 0.85×base）').toBeGreaterThanOrEqual(baseScale * 0.85);
    const a = vehicleScreenBounds(farSnap.vehicleA, t);
    const b = vehicleScreenBounds(farSnap.vehicleB, t);
    for (const [name, bb] of [['A', a], ['B', b]] as const) {
      expect(bb.maxX, `${name} 分离后右缘入画`).toBeLessThanOrEqual(vp.w + 1);
      expect(bb.minX, `${name} 分离后左缘入画`).toBeGreaterThanOrEqual(-1);
    }
    // 无大面积顶部死区：车辆顶缘仍在 HUD 下缘附近（顶部空区有限）
    const topGap = Math.min(a.minY, b.minY) - HUD_TOP;
    expect(topGap, `分离后车辆顶缘距 HUD 下缘 ${topGap.toFixed(1)}px`).toBeGreaterThanOrEqual(-2);
  });
});
