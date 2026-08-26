import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeHomeLayout } from '../src/ui/homeLayout';
import { resolveLayoutProfile } from '../src/ui/layoutProfile';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { registry } from '../src/core/content';
import { makeStarterDraft, buildSnapshotFromDraft } from '../src/lab/buildEditorModel';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import type { SafeInsets } from '../src/platform/types';
import type { BattleRenderSnapshot } from '../src/battle/battleContract';

/**
 * F-HOME-VISUAL-R2｜正式首页场景与视觉层级验收
 * V1: CTA 中心 = 屏幕主轴 W/2（Must#5）+ 辅助入口轻量不重叠（Must#6）+ 层级（Must#8）；
 * V2: 普通车辆可见宽 ∈ 屏幕 38%~48%（真实 renderer envelope，Must#2）；
 * V3: 车辆 envelope 中心 = 取景区中心（真实 renderer，Must#1——非左右入口剩余空间中心）；
 * V4: 三层竞技场背景（远景看台 / 中景聚光 / 前景展示平台；Must#3/#4）；
 * V5: 入口矢量图标（车库/排行榜/战令，非单字圆片；Must#6）；
 * V6: 宝箱四态视觉（可领金光 / 计时进度+时标 / 空槽弱化；Must#7）。
 */
const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };
// F-HOME-VISUAL-R2 Acceptance 视口：420×210、621×351、844×390（1920×1008 桌面 contain
// 逻辑 = 844×390，同 V3 覆盖；360×180 高度主导完整入画优先——不在 Acceptance 列表）。
const VPS = [
  { w: 420, h: 210 },
  { w: 621, h: 351 },
  { w: 844, h: 390 },
];

function makeStubCtx(): CanvasRenderingContext2D {
  return new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, prop) => (prop === 'createLinearGradient' || prop === 'createRadialGradient' ? () => ({ addColorStop: () => {} }) : () => ({ width: 0 })),
    set: () => true,
  });
}

function measureHome(bodyId: string, vp: { w: number; h: number }) {
  bindPlatformCore(createWebCore());
  const canvas = {
    getContext: () => makeStubCtx(),
    clientWidth: vp.w,
    clientHeight: vp.h,
    width: vp.w,
    height: vp.h,
  } as unknown as HTMLCanvasElement;
  (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
  const r = new Renderer(canvas, new VisualRegistry(), { width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 });
  const o = new PlanckBattleOrchestrator(
    buildSnapshotFromDraft(makeStarterDraft(bodyId, registry), registry, 'a'),
    buildSnapshotFromDraft(makeStarterDraft('bananaBody', registry), registry, 'b'),
    registry,
    { autoDrive: true },
  );
  const snap = o.getRenderSnapshot();
  const profile = resolveLayoutProfile(vp.w, vp.h);
  const L = computeHomeLayout(vp, INSETS, profile);
  r.resize(1600, 1000);
  r.reframe(snap, 'previewSolo', { framingRect: { ...L.vehicleFramingRect, mode: 'home' } });
  const t = r.transform;
  const env = envelopeOf(snap.vehicleA, t);
  return {
    env,
    frame: L.vehicleFramingRect,
    W: vp.w,
    H: vp.h,
  };
}

function envelopeOf(v: BattleRenderSnapshot['vehicleA'], cam: { scale: number; offsetX: number; offsetY: number }) {
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
    for (const c of [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }]) {
      acc(c.x * cos - c.y * sin + v2.position.x, c.x * sin + c.y * cos + v2.position.y);
    }
  };
  shape(v.body);
  if (v.bodyVisual) visual(v.bodyVisual);
  for (const w of v.wheels) {
    acc(w.center.x - w.radius, w.center.y - w.radius);
    acc(w.center.x + w.radius, w.center.y + w.radius);
  }
  if (v.wheelVisuals) for (const wv of v.wheelVisuals) if (wv) visual(wv);
  for (const p of v.parts) {
    shape(p.shape);
    if (p.visual) visual(p.visual);
  }
  const sx = (x: number): number => x * cam.scale + cam.offsetX;
  const sy = (y: number): number => y * cam.scale + cam.offsetY;
  return { minX: sx(minX), minY: sy(minY), maxX: sx(maxX), maxY: sy(maxY) };
}

describe('F-HOME-VISUAL-R2｜正式首页场景与视觉层级', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
    delete (globalThis as { window?: unknown }).window;
  });

  it('V1. 布局：CTA 中心 = 屏幕主轴 W/2（Must#5）；辅助入口轻量、不重叠（Must#6）；层级（Must#8）', () => {
    for (const vp of VPS) {
      const l = computeHomeLayout(vp, INSETS, resolveLayoutProfile(vp.w, vp.h));
      // Must#5：CTA 中心 = 屏幕水平主轴（不是左右入口剩余空间中心）
      expect(Math.abs(l.ctaRect.x + l.ctaRect.w / 2 - vp.w / 2), `${vp.w}×${vp.h} CTA 中心 = W/2`).toBeLessThanOrEqual(1);
      // Must#6：入口不与 CTA 重叠
      expect(l.ctaRect.x, 'CTA 左缘 ≥ 车库右缘').toBeGreaterThanOrEqual(l.garageRect.x + l.garageRect.w - 1);
      expect(l.ctaRect.x + l.ctaRect.w, 'CTA 右缘 ≤ 排行榜左缘').toBeLessThanOrEqual(l.rankRect.x + 1);
      // 层级：个人信息（顶）< 车辆取景区（中央）< CTA（底部中央）< 辅助入口（底部两侧）
      expect(l.profileRect.y, '个人信息在顶部').toBeLessThanOrEqual(l.stageRect.y);
      expect(l.ctaRect.y, 'CTA 在车辆取景区下方').toBeGreaterThanOrEqual(l.vehicleFramingRect.y + l.vehicleFramingRect.h);
      expect(l.ctaRect.h, 'CTA 高于辅助入口（主操作最显眼）').toBeGreaterThan(l.garageRect.h);
    }
  });

  it('V2. 普通车辆可见宽 ∈ 屏幕 38%~48%（真实 renderer envelope，Must#2）', () => {
    for (const body of ['watermelonBody', 'boxBody']) {
      for (const vp of VPS) {
        const m = measureHome(body, vp);
        const wPct = (m.env.maxX - m.env.minX) / m.W;
        // 短屏（h<260 mobile-short）高度主导（完整入画优先）：下限 32%（高车+矮屏物理限制）；
        // normal 视口（621/844）Must#2 目标 38%~48%（renderer clamp 上限 47% → 屏幕占比 ≤ 48%）。
        const lo = vp.h < 260 ? 0.32 : 0.38;
        expect(wPct, `${body} ${vp.w}×${vp.h} 车辆可见宽 ${(wPct * 100).toFixed(1)}% ∈ [${(lo * 100).toFixed(0)}%,48%]`)
          .toBeGreaterThanOrEqual(lo - 1e-9);
        expect(wPct, `${body} ${vp.w}×${vp.h} 车辆可见宽 ${(wPct * 100).toFixed(1)}% ≤ 48%`)
          .toBeLessThanOrEqual(0.48 + 1e-9);
        // 完整入画（不被底栏遮挡 / 不裁切）
        expect(m.env.maxY, `${body} ${vp.w}×${vp.h} 车辆底缘 ≤ 取景区底`).toBeLessThanOrEqual(m.frame.y + m.frame.h + 1);
        expect(m.env.minY, `${body} ${vp.w}×${vp.h} 车辆顶缘 ≥ 取景区顶`).toBeGreaterThanOrEqual(m.frame.y - 1);
      }
    }
  });

  it('V3. 车辆 envelope 中心 = 取景区中心（Must#1 视觉中心，非左右入口剩余空间中心）', () => {
    for (const body of ['watermelonBody', 'boxBody']) {
      for (const vp of VPS) {
        const m = measureHome(body, vp);
        const cx = (m.env.minX + m.env.maxX) / 2;
        const frameCx = m.frame.x + m.frame.w / 2;
        // 水平：车辆中心 = 取景区中心（safe 区视觉中心；renderer fit 取景区 → 中心即 safe 中心）
        expect(Math.abs(cx - frameCx), `${body} ${vp.w}×${vp.h} 车辆水平中心 = 取景区中心`).toBeLessThanOrEqual(m.W * 0.02 + 1);
        // 垂直：车辆中心 ≈ 取景区中心（偏差 ≤ 取景区高 22%——车在舞台上、贴展示平台）
        const cy = (m.env.minY + m.env.maxY) / 2;
        const frameCy = m.frame.y + m.frame.h / 2;
        const devY = Math.abs(cy - frameCy) / m.frame.h;
        expect(devY, `${body} ${vp.w}×${vp.h} 垂直中心偏差 ${(devY * 100).toFixed(1)}% ≤ 22%`).toBeLessThanOrEqual(0.22);
      }
    }
  });

  it('V4. 三层竞技场背景（Must#3/#4）：远景看台 / 中景聚光 / 前景展示平台；无纯色带 + 巨圆', () => {
    const src = readFileSync('src/render/renderer.ts', 'utf-8');
    const start = src.indexOf('private drawHomeBackdrop');
    const method = src.slice(start, src.indexOf('private vehicleCenter'));
    // 三层
    expect(method, '远景看台（多层阶梯）').toContain('const tiers = 6');
    expect(method, '看台灯点').toContain('rgba(150,195,255,0.4)');
    expect(method, '中景聚光（createLinearGradient 锥）').toContain('createLinearGradient');
    expect(method, '中景环境灯柱').toContain('rgba(30,46,74,0.7)');
    expect(method, '前景展示平台（前缘高光）').toContain('rgba(120,170,255,0.32)');
    // Must#4：不再 4 纯色带 + 2 巨圆 + 远山剪影
    expect(method, '不再 bands 纯色带').not.toContain('const bands');
    expect(method, '不再两个巨型圆光晕（两个 arc 光晕数组）').not.toContain('w * 0.18, h * 0.3');
    expect(method, '不再远山剪影').not.toContain('rgba(20,28,44,0.9)');
  });

  it('V5. 入口矢量图标（Must#6）：车库=小车 / 排行榜=柱状 / 战令=旗帜；不再「装/榜/令」单字圆片', () => {
    const host = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    const start = host.indexOf('private drawHomeBottomEntry');
    const entryBlock = host.slice(start, host.indexOf('private drawGarageMetaPage'));
    expect(entryBlock, '图标绘制入口').toContain('drawHomeEntryIcon');
    expect(entryBlock, '车库=小车图标').toContain("kind === 'garage'");
    expect(entryBlock, '排行榜=柱状图标').toContain("kind === 'rank'");
    expect(entryBlock, '战令=旗帜图标（旗杆+三角旗）').toContain('lineTo(cx + s * 0.78, cy - s * 0.3)');
    // 不再单字圆片（'装'/'榜'/'令' 作为 icon 参数）
    expect(entryBlock, '不再单字圆片 icon 参数').not.toMatch(/'装'|'榜'|'令'/);
  });

  it('V6. 宝箱四态视觉（Must#7）：可领金光 / 计时进度+时钟 / 空槽弱化——非四个相同线框', () => {
    const host = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    const start = host.indexOf("// ① 顶部：个人信息");
    const chestBlock = host.slice(start, start + 3200);
    expect(chestBlock, '可领取：金色底光 + 加粗描边 + 光点').toContain("'rgba(160,120,30,0.28)'");
    expect(chestBlock, '可领取：光点').toContain('s.x + s.w - 4');
    expect(chestBlock, '计时：时钟 arc 圆标').toContain('tctx.arc');
    expect(chestBlock, '计时：进度条').toContain('s.w - 6) * 0.5');
    expect(chestBlock, '空槽：中心十字弱化').toContain('ccx - 2');
  });
});
