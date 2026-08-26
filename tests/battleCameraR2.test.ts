/**
 * F-BATTLE-CAMERA-R2｜重构战斗跟随相机与收束构图 —— 验收矩阵。
 *
 * 用户问题：车辆长期贴屏底、顶部约七成无意义黑色空间；进入 Closing 后相机大幅拉远、
 * 车辆缩成小模型。调研根因：旧 Active 用固定 corridor 预算高度 + compact 底部锚定
 * （地面线在屏底 97%）；旧 Closing 按整个 Arena + 收束墙全量 fit（车辆骤缩）。
 *
 * 本文件沿真实 Runtime 锁定验收（禁止单帧位置测试代替完整阶段切换）：
 * A. 真实 PlanckBattleOrchestrator 推进 Active→Warning→Closing：每阶段 A/B 完整入画、
 *    地面线 78~84%、Closing/Warning 尺度相对 Active ≤15%、墙不遮挡车辆。
 * B. 运行期跟随：step+render 多帧，尺度变化平滑（无骤缩/跳位）、车辆始终入画。
 * C. 极端构筑（长武器 / 无轮站桩 / 高车身 / 翻转姿态）：主要车身 + 武器不裁切。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { registry } from '../src/core/content';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import type { CanvasSurface } from '../src/render/canvasSurface';
import type { BattleRenderSnapshot, RenderVehicle } from '../src/battle/battleContract';

const VP = { w: 844, h: 390 }; // 手机横屏（用户录屏目标视口）
const SAFE_TOP = 56; // compact battle insetTop（逻辑 px）
const SAFE_BOTTOM = 12; // compact battle insetBottom
const GROUND_LINE_LO = 0.78;
const GROUND_LINE_HI = 0.84;

function makeStubCtx(): CanvasRenderingContext2D {
  const handler = { get: () => () => ({ width: 0 }), set: () => true };
  return new Proxy({} as CanvasRenderingContext2D, handler);
}

function makeRenderer(w: number, h: number): Renderer {
  const canvas = {
    getContext: () => makeStubCtx(),
    clientWidth: w,
    clientHeight: h,
    width: w,
    height: h,
  } as unknown as HTMLCanvasElement;
  const surface: CanvasSurface = { width: w, height: h, devicePixelRatio: 1, now: () => 0 };
  return new Renderer(canvas, new VisualRegistry(), surface);
}

/** 车辆世界 AABB → 屏幕 AABB（envelope = Body+Wheels+Parts；与 renderer 构图同口径） */
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

function assertGroundLine(r: Renderer, arena: BattleRenderSnapshot['arena'], label: string): void {
  const t = r.transform;
  const groundScreenY = t.offsetY + arena.groundY * t.scale;
  const safeTop = SAFE_TOP;
  const safeBottom = SAFE_BOTTOM;
  const safeH = VP.h - safeTop - safeBottom;
  const ratio = (groundScreenY - safeTop) / safeH;
  expect(ratio, `${label} 地面线 ${(ratio * 100).toFixed(1)}% ∈ [78%,84%]`).toBeGreaterThanOrEqual(GROUND_LINE_LO);
  expect(ratio, `${label} 地面线 ${(ratio * 100).toFixed(1)}% ≤ 84%`).toBeLessThanOrEqual(GROUND_LINE_HI);
}

function assertVehiclesInView(r: Renderer, snap: BattleRenderSnapshot, label: string): void {
  for (const [name, v] of [['A', snap.vehicleA], ['B', snap.vehicleB]] as const) {
    const b = vehicleScreenBounds(v, r.transform);
    expect(b.minX, `${label} ${name} 左缘入画`).toBeGreaterThanOrEqual(-1);
    expect(b.maxX, `${label} ${name} 右缘入画`).toBeLessThanOrEqual(VP.w + 1);
    expect(b.minY, `${label} ${name} 顶缘入画`).toBeGreaterThanOrEqual(SAFE_TOP - 1);
    expect(b.maxY, `${label} ${name} 底缘入画`).toBeLessThanOrEqual(VP.h + 1);
  }
}

/** 真实战斗推进：step 直到 phase 离开 Active（或超时），返回各 phase 的 snapshot 记录 */
function driveToPhase(
  o: PlanckBattleOrchestrator,
  r: Renderer,
  target: string,
): Array<{ phase: string; snap: BattleRenderSnapshot }> {
  const records: Array<{ phase: string; snap: BattleRenderSnapshot }> = [];
  const seen = new Set<string>(['Active']);
  let steps = 0;
  const maxSteps = 60 * 30; // 30s 上限（正式 battle ≈18s + Warning/Closing 推进）
  while (steps < maxSteps) {
    o.step(16.6667);
    r.render(o); // 每帧渲染（运行期跟随路径同帧生效）
    const snap = o.getRenderSnapshot();
    if (!seen.has(o.phase) && o.phase) {
      seen.add(o.phase);
      records.push({ phase: o.phase, snap });
    }
    steps++;
    if (seen.has(target)) break;
  }
  return records;
}

describe('F-BATTLE-CAMERA-R2｜战斗跟随相机与收束构图', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
  });

  it('A1. 真实阶段切换：Active/Warning/Closing(End) 每阶段 A/B 完整入画 + 地面线 78~84% + 尺度 ≤15%', () => {
    bindPlatformCore(createWebCore());
    const r = makeRenderer(VP.w, VP.h);
    // 肉装 boxBody 对局：战斗足够长，能真实推进经过 Warning → Closing（非单帧位置测试）
    const o = new PlanckBattleOrchestrator(
      buildSnapshotFromDraft(makeStarterDraft('boxBody', registry), registry, 'a'),
      buildSnapshotFromDraft(makeStarterDraft('boxBody', registry), registry, 'b'),
      registry,
      { autoDrive: true },
    );
    const snap0 = o.getRenderSnapshot();
    r.resize(snap0.arena.width, o.arena.config.height);
    r.reframe(snap0, 'battle', { phase: 'Active' });
    const activeScale = r.transformScale;
    assertGroundLine(r, snap0.arena, 'Active');
    assertVehiclesInView(r, snap0, 'Active');

    const phases = driveToPhase(o, r, 'End');
    // 完整阶段切换：必须记录到 Warning 与 Closing（或 End）——禁止单帧位置测试
    const names = phases.map((p) => p.phase);
    expect(names, `应记录 Warning 阶段（实际 ${names.join('/')}）`).toContain('Warning');
    expect(
      names.some((n) => n === 'Closing' || n === 'End'),
      `应记录 Closing 或 End（实际 ${names.join('/')}）`,
    ).toBe(true);
    for (const rec of phases) {
      const phase = rec.phase;
      r.reframe(rec.snap, 'battle', { phase });
      const scale = r.transformScale;
      const delta = Math.abs(scale - activeScale) / activeScale;
      expect(delta, `${phase} 尺度相对 Active ≤15%（实测 ${(delta * 100).toFixed(1)}%）`).toBeLessThanOrEqual(0.15);
      assertGroundLine(r, rec.snap.arena, phase);
      assertVehiclesInView(r, rec.snap, phase);
    }
  });

  it('A2. Closing 收束墙从画面边缘进入、不遮挡车辆（车辆仍是视觉主体）', () => {
    bindPlatformCore(createWebCore());
    const r = makeRenderer(VP.w, VP.h);
    const o = new PlanckBattleOrchestrator(
      buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'a'),
      buildSnapshotFromDraft(makeStarterDraft('bananaBody', registry), registry, 'b'),
      registry,
      { autoDrive: true },
    );
    const snap0 = o.getRenderSnapshot();
    r.resize(snap0.arena.width, o.arena.config.height);
    // 直接构造 Closing 构图（真实 orchestrator 的 closingWalls 位置）
    r.reframe(snap0, 'battle', { phase: 'Closing' });
    assertVehiclesInView(r, snap0, 'Closing');
    // 墙初始在 arena 两侧（x≈-120 / x≈1720）→ 屏幕位置在画面两侧或屏外，不进入中央 1/3
    for (const cw of snap0.arena.closingWalls) {
      if (cw.kind !== 'polygons') continue;
      for (const poly of cw.polygons) {
        const xs = poly.points.map((p) => p.x * r.transformScale + r.transform.offsetX);
        const left = Math.min(...xs);
        const right = Math.max(...xs);
        const cx = (left + right) / 2;
        if (cx < VP.w / 2) {
          expect(right, '左墙不进入画面中央 1/3（≤34% 或屏外）').toBeLessThanOrEqual(VP.w * 0.34);
        } else {
          expect(left, '右墙不进入画面中央 1/3（≥66% 或屏外）').toBeGreaterThanOrEqual(VP.w * 0.66);
        }
      }
    }
  });

  it('B. 运行期跟随：多帧尺度平滑（无骤缩/跳位）、车辆始终入画', () => {
    bindPlatformCore(createWebCore());
    const r = makeRenderer(VP.w, VP.h);
    const o = new PlanckBattleOrchestrator(
      buildSnapshotFromDraft(makeStarterDraft('watermelonBody', registry), registry, 'a'),
      buildSnapshotFromDraft(makeStarterDraft('bananaBody', registry), registry, 'b'),
      registry,
      { autoDrive: true },
    );
    const snap0 = o.getRenderSnapshot();
    r.resize(snap0.arena.width, o.arena.config.height);
    r.reframe(snap0, 'battle', { phase: 'Active' });
    let prevScale = r.transformScale;
    let prevOffX = r.transform.offsetX;
    let steps = 0;
    const maxSteps = 60 * 6; // ~6s（覆盖 A 顶推 B 的接近过程）
    while (!o.result && steps < maxSteps) {
      o.step(16.6667);
      r.render(o);
      const t = r.transform;
      // 尺度平滑：相邻帧变化 ≤0.5%（0.4% 限幅 + 容差）
      const scaleDelta = Math.abs(t.scale - prevScale) / prevScale;
      expect(scaleDelta, `step ${steps} 尺度突变 ${(scaleDelta * 100).toFixed(2)}% ≤0.5%`).toBeLessThanOrEqual(0.005);
      // 位置平滑：offsetX 相邻帧变化 ≤40px（防跳位）
      expect(Math.abs(t.offsetX - prevOffX), `step ${steps} offsetX 跳位`).toBeLessThanOrEqual(40);
      prevScale = t.scale;
      prevOffX = t.offsetX;
      // 车辆始终入画（中点追踪 + 视野 clamp）
      const snap = o.getRenderSnapshot();
      assertVehiclesInView(r, snap, `step ${steps}`);
      steps++;
    }
    expect(steps, '战斗应推进 ≥60 帧（非单帧位置测试）').toBeGreaterThanOrEqual(60);
  });

  describe('C. 极端构筑不裁切', () => {
    function makeExtremeSnap(
      over: Partial<BattleRenderSnapshot['vehicleA']> & { flipB?: boolean; longWeapon?: boolean; wheelLess?: boolean; tallBody?: boolean },
    ): BattleRenderSnapshot {
      const base = (() => {
        const body = {
          kind: 'polygons' as const,
          polygons: [{ points: [
            { x: 350, y: 650 }, { x: 450, y: 650 }, { x: 450, y: 700 }, { x: 350, y: 700 },
          ] }],
        };
        return {
          arena: { width: 1600, groundY: 700, normalWalls: [], closingWalls: [] },
          vehicleA: {
            team: 'A',
            body,
            bodyVisual: {
              visualId: 'body_watermelon',
              position: { x: 400, y: 675 },
              rotation: 0,
              size: { width: 180, height: 60 },
              layer: 1,
            },
            wheels: [
              { center: { x: 370, y: 680 }, radius: 20, angle: 0 },
              { center: { x: 430, y: 680 }, radius: 20, angle: 0 },
            ],
            wheelVisuals: [],
            parts: [
              {
                shape: {
                  kind: 'polygons',
                  polygons: [{ points: [
                    { x: 440, y: 660 }, { x: 520, y: 660 }, { x: 520, y: 690 }, { x: 440, y: 690 },
                  ] }],
                },
                category: 'weapon',
                visual: {
                  visualId: 'part_pushRod',
                  position: { x: 480, y: 675 },
                  rotation: 0,
                  size: { width: 120, height: 18 },
                  layer: 10,
                },
              },
            ],
          },
          vehicleB: {
            team: 'B',
            body: {
              kind: 'polygons',
              polygons: [{ points: [
                { x: 1150, y: 656 }, { x: 1250, y: 656 }, { x: 1250, y: 700 }, { x: 1150, y: 700 },
              ] }],
            },
            bodyVisual: {
              visualId: 'body_banana',
              position: { x: 1200, y: 678 },
              rotation: 0,
              size: { width: 200, height: 56 },
              layer: 1,
            },
            wheels: [
              { center: { x: 1170, y: 680 }, radius: 20, angle: 0 },
              { center: { x: 1230, y: 680 }, radius: 20, angle: 0 },
            ],
            wheelVisuals: [],
            parts: [],
          },
          projectiles: [],
        } as unknown as BattleRenderSnapshot;
      })();
      const a = { ...base.vehicleA, ...over } as BattleRenderSnapshot['vehicleA'];
      const b = base.vehicleB;
      // 长武器：A 武器视觉加长到 320（尖端大幅前伸）
      if (over.longWeapon) {
        a.parts = [{
          ...a.parts[0]!,
          visual: { ...a.parts[0]!.visual!, size: { width: 320, height: 18 }, position: { x: 600, y: 675 } },
        }];
      }
      // 无轮站桩：A 无轮（轮列表清空）
      if (over.wheelLess) {
        a.wheels = [];
        a.wheelVisuals = [];
      }
      // 高车身：A body 加高到 200（顶部大幅上探）
      if (over.tallBody) {
        a.body = {
          kind: 'polygons',
          polygons: [{ points: [
            { x: 350, y: 500 }, { x: 450, y: 500 }, { x: 450, y: 700 }, { x: 350, y: 700 },
          ] }],
        };
        a.bodyVisual = { ...a.bodyVisual!, size: { width: 180, height: 200 }, position: { x: 400, y: 600 } };
      }
      // 翻转姿态：B 翻转（rotation=π）
      if (over.flipB) {
        b.bodyVisual = { ...b.bodyVisual!, rotation: Math.PI, position: { x: 1200, y: 678 } };
        b.body = {
          kind: 'polygons',
          polygons: [{ points: [
            { x: 1150, y: 656 }, { x: 1250, y: 656 }, { x: 1250, y: 700 }, { x: 1150, y: 700 },
          ] }],
        };
      }
      return { ...base, vehicleA: a, vehicleB: b };
    }

    for (const [label, over] of [
      ['长武器（武器尖端大幅前伸）', { longWeapon: true }],
      ['无轮站桩（A 无轮）', { wheelLess: true }],
      ['高车身（车身高度 200）', { tallBody: true }],
      ['翻转姿态（B rotation=π）', { flipB: true }],
    ] as Array<[string, Parameters<typeof makeExtremeSnap>[0]]>) {
      it(`Active：${label}——主要车身 + 武器完整入画`, () => {
        bindPlatformCore(createWebCore());
        const r = makeRenderer(VP.w, VP.h);
        const snap = makeExtremeSnap(over);
        r.resize(snap.arena.width, 1000);
        r.reframe(snap, 'battle', { phase: 'Active' });
        assertGroundLine(r, snap.arena, `Active(${label})`);
        // 完整 envelope（含部件/视觉）入画 = 主要车身 + 武器不裁切
        assertVehiclesInView(r, snap, `Active(${label})`);
      });
    }
  });
});
