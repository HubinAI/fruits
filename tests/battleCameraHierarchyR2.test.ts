/**
 * F-BATTLE-CAMERA-HIERARCHY-R2｜Battle 取景层级严格测试。
 *
 * Must#3/#4/#5/#6/#9：四视口 Battle 初始构图（双车+间距 ≤86% 可用宽、单车 ≥12% 屏、
 * 组合中心 ≤5%W、完整入画、不碰 HUD、地面 68-82%）；接近/碰撞构图；Warning/Closing 墙与
 * 车辆同时可见且不骤缩；120 帧 camera 稳定 ≤1%；Matching→Battle 无旧相机帧；Result 清理；
 * Home/Garage 取景对照零变化。全部读真实 Renderer transform / 车辆 envelope（Must#10 补充
 * 浏览器最终像素门禁在 e2e 层）。
 */
import { describe, it, expect } from 'vitest';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { registry } from '../src/core/content';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { computeMobileGarageLayout } from '../src/ui/mobileGarageLayout';
import { computeHomeLayout } from '../src/ui/homeLayout';
import { resolveLayoutProfile } from '../src/ui/layoutProfile';
import type { BattleRenderSnapshot } from '../src/battle/battleContract';
import type { CanvasSurface } from '../src/render/canvasSurface';

const RES = [
  { w: 420, h: 210 },
  { w: 621, h: 351 },
  { w: 844, h: 390 },
  { w: 1280, h: 592 },
];
const HUD_TOP = 56; // compact battle HUD 下缘

type Cam = { scale: number; offsetX: number; offsetY: number };

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

function vehicleBoundsScreen(v: BattleRenderSnapshot['vehicleA'], cam: Cam) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const acc = (x: number, y: number): void => {
    const sx = x * cam.scale + cam.offsetX;
    const sy = y * cam.scale + cam.offsetY;
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  };
  const shape = (s: BattleRenderSnapshot['vehicleA']['body']): void => {
    if (s.kind === 'polygons') for (const poly of s.polygons) for (const p of poly.points) acc(p.x, p.y);
    else acc(s.circle.center.x - s.circle.radius, s.circle.center.y - s.circle.radius);
  };
  shape(v.body);
  for (const w of v.wheels ?? []) acc(w.center.x, w.center.y);
  return { minX, minY, maxX, maxY };
}

function battleSnap(stepN: number): BattleRenderSnapshot {
  const o = new PlanckBattleOrchestrator(
    buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'a'),
    buildSnapshotFromDraft(makeStarterDraft('boxBody', registry), registry, 'b'),
    registry,
    { autoDrive: true },
    false,
  );
  for (let i = 0; i < stepN; i++) o.step(16.7, 1);
  return o.getRenderSnapshot();
}

function battleCamFor(r: { w: number; h: number }, snap: BattleRenderSnapshot, phase: string): { t: Cam; a: ReturnType<typeof vehicleBoundsScreen>; b: ReturnType<typeof vehicleBoundsScreen>; groundPct: number } {
  const renderer = makeRenderer(r.w, r.h);
  renderer.reframe(snap, 'battle', { phase: phase as never });
  const t = renderer.transform;
  const a = vehicleBoundsScreen(snap.vehicleA, t);
  const b = vehicleBoundsScreen(snap.vehicleB, t);
  const groundPct = ((snap.arena.groundY * t.scale + t.offsetY) / r.h) * 100;
  return { t, a, b, groundPct };
}

describe('F-BATTLE-CAMERA-HIERARCHY-R2｜初始构图（Must#3/#4）', () => {
  it('T1. 四视口 Active 初始：双车+间距 ≤86% 可用宽；单车 ≥12% 屏；中心 ≤5%W；完整入画；不碰 HUD；地面 68-82%', () => {
    const snap = battleSnap(0);
    for (const r of RES) {
      const { t, a, b, groundPct } = battleCamFor(r, snap, 'Active');
      const span = (b.maxX - a.minX) / r.w;
      // F-BATTLE-DYNAMIC-FRAMING-R2.1：初始远距离目标 82-88%（高度完整入画优先时允许低于 82——短屏）
      expect(span, `${r.w}×${r.h} 初始 span ${(span * 100).toFixed(1)}% ≤ 88%`).toBeLessThanOrEqual(0.88 + 1e-9);
      const singleW = Math.max(a.maxX - a.minX, b.maxX - b.minX);
      expect(singleW / r.w, `${r.w}×${r.h} 单车 ${((singleW / r.w) * 100).toFixed(1)}% ≥ 12%`).toBeGreaterThanOrEqual(0.12);
      const cx = (a.minX + a.maxX + b.minX + b.maxX) / 4;
      expect(Math.abs(cx / r.w - 0.5), `${r.w}×${r.h} 组合中心偏差 ${(Math.abs(cx / r.w - 0.5) * 100).toFixed(1)}% ≤ 5%`).toBeLessThanOrEqual(0.05);
      expect(a.minX, `${r.w}×${r.h} A 完整入画（左缘 ≥0）`).toBeGreaterThanOrEqual(0);
      expect(b.maxX, `${r.w}×${r.h} B 完整入画（右缘 ≤W）`).toBeLessThanOrEqual(r.w);
      expect(a.minY, `${r.w}×${r.h} A 顶不碰 HUD（≥${HUD_TOP}）`).toBeGreaterThanOrEqual(HUD_TOP - 1);
      expect(groundPct, `${r.w}×${r.h} 地面 ${groundPct.toFixed(1)}% ∈ [68%,82%]`).toBeGreaterThanOrEqual(68);
      expect(groundPct, `${r.w}×${r.h} 地面 ≤82%`).toBeLessThanOrEqual(82);
      void t;
    }
  });
});

describe('F-BATTLE-CAMERA-HIERARCHY-R2｜接近/碰撞/阶段（Must#3/#6）', () => {
  it('T2. 接近（150 步）与碰撞（300 步）：双车完整入画；碰撞时单车不得放大到遮挡另一辆（≤55% 屏）', () => {
    const r = { w: 844, h: 390 };
    for (const [label, steps] of [['near', 150], ['hit', 300]] as const) {
      const snap = battleSnap(steps);
      const { a, b } = battleCamFor(r, snap, 'Active');
      expect(a.minX, `${label} A 左缘 ≥0`).toBeGreaterThanOrEqual(0);
      expect(b.maxX, `${label} B 右缘 ≤W`).toBeLessThanOrEqual(r.w);
      const singleW = Math.max(a.maxX - a.minX, b.maxX - b.minX);
      expect(singleW / r.w, `${label} 单车 ${((singleW / r.w) * 100).toFixed(1)}% ≤ 55% 屏（不遮挡另一辆）`).toBeLessThanOrEqual(0.55);
    }
  });

  it('T3. Warning/Closing：双车完整 + 相对 Active 首帧 scale 变化 ≤15%（不骤缩/不拉远）', () => {
    const r = { w: 844, h: 390 };
    const snap = battleSnap(0);
    const base = battleCamFor(r, snap, 'Active').t.scale;
    for (const phase of ['Warning', 'Closing', 'End'] as const) {
      // 同 renderer 连续 reframe（Active 先记录 battleCam）
      const renderer = makeRenderer(r.w, r.h);
      renderer.reframe(snap, 'battle', { phase: 'Active' });
      renderer.reframe(snap, 'battle', { phase: phase as never });
      const delta = Math.abs(renderer.transform.scale - base) / base;
      expect(delta, `${phase} scale 变化 ${(delta * 100).toFixed(1)}% ≤ 15%`).toBeLessThanOrEqual(0.15 + 1e-9);
      const a = vehicleBoundsScreen(snap.vehicleA, renderer.transform);
      const b = vehicleBoundsScreen(snap.vehicleB, renderer.transform);
      expect(a.minX, `${phase} A 完整`).toBeGreaterThanOrEqual(0);
      expect(b.maxX, `${phase} B 完整`).toBeLessThanOrEqual(r.w);
      expect(a.minY, `${phase} A 不碰 HUD`).toBeGreaterThanOrEqual(HUD_TOP - 1);
    }
  });
});

describe('F-BATTLE-CAMERA-HIERARCHY-R2｜相机稳定（Must#5）', () => {
  it('T4. 120 帧同一构图 scale 漂移 ≤1%', () => {
    const r = { w: 844, h: 390 };
    const renderer = makeRenderer(r.w, r.h);
    const snap = battleSnap(0);
    renderer.reframe(snap, 'battle', { phase: 'Active' });
    const s0 = renderer.transform.scale;
    let maxDrift = 0;
    for (let i = 0; i < 120; i++) {
      renderer.reframe(snap, 'battle', { phase: 'Active' });
      maxDrift = Math.max(maxDrift, Math.abs(renderer.transform.scale - s0) / s0);
    }
    expect(maxDrift, `120 帧 scale 漂移 ${(maxDrift * 100).toFixed(3)}% ≤ 0.5%（死区吸收）`).toBeLessThanOrEqual(0.005);
  });

  it('T5. Matching(previewFixed)→Battle 首帧：battle 基准为 Active 收缩构图（无旧相机闪帧）', () => {
    const r = { w: 844, h: 390 };
    const renderer = makeRenderer(r.w, r.h);
    const snap = battleSnap(0);
    renderer.reframe(snap, 'previewFixed', {}); // Matching/Locked
    const preScale = renderer.transform.scale;
    renderer.reframe(snap, 'battle', { phase: 'Active' }); // Battle 首帧
    const battleScale = renderer.transform.scale;
    // Battle 首帧必须重取景（Active 收缩构图），不得沿用 previewFixed 的 scale
    expect(Math.abs(battleScale - preScale) / preScale, `Battle 首帧相对 Matching scale 变化 ${(Math.abs(battleScale - preScale) / preScale * 100).toFixed(1)}%`).toBeGreaterThan(0.02);
    // battle 双车+间距 ≤86%（收缩构图生效）
    const a = vehicleBoundsScreen(snap.vehicleA, renderer.transform);
    const b = vehicleBoundsScreen(snap.vehicleB, renderer.transform);
    expect((b.maxX - a.minX) / r.w, 'Battle 首帧双车+间距 ≤88%（远段目标）').toBeLessThanOrEqual(0.88);
  });

  it('T6. Result 后离开 Battle（reframe 非 battle）→ battleCam 清理，后续构图正常', () => {
    const r = { w: 844, h: 390 };
    const renderer = makeRenderer(r.w, r.h);
    const snap = battleSnap(0);
    renderer.reframe(snap, 'battle', { phase: 'End' }); // Result 前最后一帧
    renderer.reframe(snap, 'battle', { phase: 'Active' });
    // 切到 Garage（previewSolo garage）→ 取景正常（无 battle 残留、不抛错、车辆在取景区内）
    const profile = resolveLayoutProfile(r.w, r.h);
    const l = computeMobileGarageLayout({ w: r.w, h: r.h }, { left: 44, right: 20, top: 12, bottom: 16 }, profile);
    renderer.reframe(snap, 'previewSolo', { framingRect: { ...l.stageRect, mode: 'garage' } });
    const g = renderer.getVehicleScreenRects(snap)!.a;
    expect(g.w, 'Garage 取景正常（battle 残留不影响）').toBeGreaterThan(0);
    expect(g.x, 'Garage 车辆在取景区内').toBeGreaterThanOrEqual(0);
  });
});

describe('F-BATTLE-CAMERA-HIERARCHY-R2｜Home/Garage 对照零变化（Must#7）', () => {
  it('T7. Home/Garage 取景不受 battle 修改影响（与 Garage 专用上限语义一致）', () => {
    for (const r of RES) {
      const renderer = makeRenderer(r.w, r.h);
      const snap = battleSnap(0);
      const profile = resolveLayoutProfile(r.w, r.h);
      const insets = { left: 44, right: 20, top: 12, bottom: 16 };
      const gl = computeMobileGarageLayout({ w: r.w, h: r.h }, insets, profile);
      renderer.reframe(snap, 'previewSolo', { framingRect: { ...gl.stageRect, mode: 'garage' } });
      const g = renderer.getVehicleScreenRects(snap)!.a;
      expect(g.w / r.w, `${r.w}×${r.h} Garage 车辆宽占比合理`).toBeGreaterThan(0.30);
      const hl = computeHomeLayout({ w: r.w, h: r.h }, insets, profile);
      renderer.reframe(snap, 'previewSolo', { framingRect: { ...hl.stageRect, mode: 'home' } });
      const h = renderer.getVehicleScreenRects(snap)!.a;
      expect(h.w / r.w, `${r.w}×${r.h} Home 车辆宽占比合理`).toBeGreaterThan(0.28);
    }
  });
});
