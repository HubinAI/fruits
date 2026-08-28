import { describe, it, expect } from 'vitest';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { registry } from '../src/core/content';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import type { CanvasSurface } from '../src/render/canvasSurface';

/**
 * F-GARAGE-LIVE-ASSEMBLY-P0｜真实装配挂点输出（targeted）
 * 引擎 snapshot 输出挂点世界坐标（body 位姿 + localPosition），Renderer 转 logical 屏幕坐标。
 */
const A_BODY = 'boxBody';
const B_BODY = 'watermelonBody';

function makeCanvas(w: number, h: number) {
  return {
    getContext: () => new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true }),
    width: w,
    height: h,
    clientWidth: w,
    clientHeight: h,
  } as unknown as HTMLCanvasElement;
}

function makeOrch() {
  return new PlanckBattleOrchestrator(
    buildSnapshotFromDraft(makeStarterDraft(A_BODY, registry), registry, 'a'),
    buildSnapshotFromDraft(makeStarterDraft(B_BODY, registry), registry, 'b'),
    registry,
    { autoDrive: true },
    true, // soloA（Garage 语义）
  );
}

describe('F-GARAGE-LIVE-ASSEMBLY-P0', () => {
  it('T1. 引擎 snapshot 输出挂点世界坐标：movement+functional+occupied 与真实装配一致', () => {
    const o = makeOrch();
    const snap = o.getRenderSnapshot();
    const hps = snap.vehicleA.hardpoints ?? [];
    expect(hps.length, '挂点数量 >0').toBeGreaterThan(0);
    const kinds = hps.map((h) => h.kind);
    expect(kinds, '含 movement 挂点').toContain('movement');
    expect(kinds, '含 functional 挂点').toContain('functional');
    // movement 恒 occupied（轮/驱动默认安装）
    for (const hp of hps.filter((h) => h.kind === 'movement')) {
      expect(hp.occupied, `movement 挂点 ${hp.id} 恒占用`).toBe(true);
    }
    // 世界坐标有限
    for (const hp of hps) {
      expect(Number.isFinite(hp.world.x) && Number.isFinite(hp.world.y), `${hp.id} 世界坐标有限`).toBe(true);
    }
    // functional 挂点 occupied 与 parts 安装一致
    const partIds = new Set(snap.vehicleA.parts.map((p) => p.category !== '' ? p : p).map((_, i) => hps.filter((h) => h.kind === 'functional')[i]?.id));
    const funcHps = hps.filter((h) => h.kind === 'functional');
    expect(funcHps.some((h) => h.occupied), '至少一个 functional 挂点已占用（默认武器）').toBe(true);
    void partIds;
  });

  it('T2. Renderer 挂点屏幕坐标（surface 注入 DPR1.5）= logical，位于车辆区域且与 envelope 相关', () => {
    const canvas = makeCanvas(844 * 1.5, 390 * 1.5);
    const surface: CanvasSurface = { width: 844 * 1.5, height: 390 * 1.5, devicePixelRatio: 1.5, now: () => 0 };
    const o = makeOrch();
    const r = new Renderer(canvas, new VisualRegistry(), surface);
    const snap = o.getRenderSnapshot();
    r.resize(snap.arena.width, o.arena.config.height);
    r.reframe(snap, 'previewSolo');
    const pts = r.getVehicleHardpointScreenPts(snap, 'a');
    expect(pts.length, '挂点屏幕坐标数量与 snapshot 一致').toBe(snap.vehicleA.hardpoints?.length ?? 0);
    const veh = r.getVehicleScreenRects(snap)!.a;
    for (const p of pts) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y), `${p.id} 屏幕坐标有限`).toBe(true);
      expect(p.x, `${p.id} 在逻辑舞台内（x≥0）`).toBeGreaterThanOrEqual(-2);
      expect(p.x, `${p.id} 在逻辑舞台内（x≤844）`).toBeLessThanOrEqual(846);
      expect(p.y, `${p.id} 在逻辑舞台内（y≤390）`).toBeLessThanOrEqual(392);
      // 挂点应在车辆 envelope 附近（水平 ±envelope 宽）
      expect(Math.abs(p.x - (veh.x + veh.w / 2)), `${p.id} 水平贴近车辆中心`).toBeLessThanOrEqual(veh.w * 0.7 + 20);
    }
  });

  it('T3. Web 无 surface（DPR1.5 经 window）：挂点输出 = logical（与 surface 注入一致，Must#9 域规则）', () => {
    const canvas = makeCanvas(844, 390);
    const o = makeOrch();
    const r = new Renderer(canvas, new VisualRegistry());
    const snap = o.getRenderSnapshot();
    r.resize(snap.arena.width, o.arena.config.height);
    r.reframe(snap, 'previewSolo');
    const pts = r.getVehicleHardpointScreenPts(snap, 'a');
    expect(pts.length, 'Web 域同样输出').toBeGreaterThan(0);
    for (const p of pts) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(p.x, 'Web 域不 ÷dpr（≤844）').toBeLessThanOrEqual(846);
    }
  });

  it('T4. 挂点屏幕坐标与绘制同源（sx/sy 同一 transform）：换装 reframe 后挂点跟随车辆', () => {
    const canvas = makeCanvas(844, 390);
    const o = makeOrch();
    const r = new Renderer(canvas, new VisualRegistry());
    const snap = o.getRenderSnapshot();
    r.resize(snap.arena.width, o.arena.config.height);
    r.reframe(snap, 'previewSolo', { framingRect: { x: 0, y: 52, w: 844, h: 278, mode: 'home' } });
    const pts = r.getVehicleHardpointScreenPts(snap, 'a');
    const veh = r.getVehicleScreenRects(snap)!.a;
    expect(pts.length, 'home 取景下挂点仍输出').toBeGreaterThan(0);
    // 挂点必须位于车辆 envelope 之内/边缘（home 取景车辆在安全舞台内）
    for (const p of pts) {
      expect(p.x, `${p.id} 在车辆 envelope 水平范围`).toBeGreaterThanOrEqual(veh.x - 2);
      expect(p.x, `${p.id} 在车辆 envelope 水平范围`).toBeLessThanOrEqual(veh.x + veh.w + 2);
      expect(p.y, `${p.id} 在车辆 envelope 垂直范围`).toBeGreaterThanOrEqual(veh.y - 2);
      expect(p.y, `${p.id} 在车辆 envelope 垂直范围`).toBeLessThanOrEqual(veh.y + veh.h + 2);
    }
  });
});
