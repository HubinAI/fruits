import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeHomeLayout } from '../src/ui/homeLayout';
import { resolveLayoutProfile } from '../src/ui/layoutProfile';
import type { SafeInsets } from '../src/platform/types';

/**
 * F-HOME-1｜正式首页布局专项：
 * 1. 布局矩阵（360×180 ~ 844×390）全部 rect 无溢出（safe 内 + 正尺寸 + 不重叠）；
 * 2. 车辆展示区明显可见（中上重点，高度由 available 反推）；
 * 3. 背景非纯底色（drawHomeBackground 渐变 + 装饰，源码守卫）；
 * 4. 寻找对手 CTA 为全页最强（宽 ≥ 辅助入口之和、位置在车辆区下方）。
 */

const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };
const VIEWPORTS = [
  { w: 360, h: 180 },
  { w: 390, h: 195 },
  { w: 420, h: 210 },
  { w: 460, h: 230 },
  { w: 621, h: 351 },
  { w: 844, h: 390 },
];

describe('F-HOME-1｜正式首页布局', () => {
  it('1. 布局矩阵：topBar / vehicle / cta / assist 全部 rect 在 safe 内且正尺寸', () => {
    for (const vp of VIEWPORTS) {
      const prof = resolveLayoutProfile(vp.w, vp.h);
      const l = computeHomeLayout(vp, INSETS, prof);
      for (const [name, r] of [
        ['topBar', l.topBarRect],
        ['vehicle', l.vehicleRect],
        ['cta', l.ctaRect],
        ['assist', l.assistRect],
      ] as const) {
        expect(r.w, `${vp.w}×${vp.h} ${name} 宽>0`).toBeGreaterThan(0);
        expect(r.h, `${vp.w}×${vp.h} ${name} 高>0`).toBeGreaterThan(0);
        expect(r.x, `${vp.w}×${vp.h} ${name} x ≥ safeLeft`).toBeGreaterThanOrEqual(INSETS.left);
        expect(r.y, `${vp.w}×${vp.h} ${name} y ≥ safeTop`).toBeGreaterThanOrEqual(INSETS.top);
        expect(r.x + r.w, `${vp.w}×${vp.h} ${name} 右缘 ≤ safeRight`).toBeLessThanOrEqual(vp.w - INSETS.right + 0.5);
        expect(r.y + r.h, `${vp.w}×${vp.h} ${name} 底缘 ≤ safeBottom`).toBeLessThanOrEqual(vp.h - INSETS.bottom + 0.5);
      }
      // 宝箱 4 槽也在 safe 内且不重叠
      for (let i = 0; i < 4; i++) {
        const s = l.chestSlot(i);
        expect(s.w, `chest ${i} 宽>0`).toBeGreaterThan(0);
        expect(s.x, `chest ${i} x ≥ safeLeft`).toBeGreaterThanOrEqual(INSETS.left);
        expect(s.x + s.w, `chest ${i} 右缘 ≤ safeRight`).toBeLessThanOrEqual(vp.w - INSETS.right + 0.5);
        expect(s.y + s.h, `chest ${i} 底缘 ≤ safeBottom`).toBeLessThanOrEqual(vp.h - INSETS.bottom + 0.5);
        if (i > 0) {
          const prev = l.chestSlot(i - 1);
          expect(s.x, `chest ${i} 在 ${i - 1} 右侧`).toBeGreaterThanOrEqual(prev.x + prev.w);
        }
      }
      // 层级顺序：topBar → vehicle → cta → assist（不重叠）
      expect(l.vehicleRect.y, 'vehicle 在 topBar 下方').toBeGreaterThanOrEqual(l.topBarRect.y + l.topBarRect.h);
      expect(l.ctaRect.y, 'cta 在 vehicle 下方').toBeGreaterThanOrEqual(l.vehicleRect.y + l.vehicleRect.h);
      expect(l.assistRect.y, 'assist 在 cta 下方').toBeGreaterThanOrEqual(l.ctaRect.y + l.ctaRect.h);
    }
  });

  it('2. 车辆展示区明显可见（中上重点）：420×210 高 ≥50px；621×351 高 ≥120px', () => {
    const s = resolveLayoutProfile(420, 210);
    expect(computeHomeLayout({ w: 420, h: 210 }, INSETS, s).vehicleRect.h, '420×210 车辆区高 ≥50').toBeGreaterThanOrEqual(50);
    const n = resolveLayoutProfile(621, 351);
    expect(computeHomeLayout({ w: 621, h: 351 }, INSETS, n).vehicleRect.h, '621×351 车辆区高 ≥120').toBeGreaterThanOrEqual(120);
  });

  it('3. CTA 全页最强：宽 ≥ 三辅助入口之和 + 高 ≥40；辅助入口明显矮于 CTA', () => {
    const prof = resolveLayoutProfile(844, 390);
    const l = computeHomeLayout({ w: 844, h: 390 }, INSETS, prof);
    const assistW = Math.floor((l.assistRect.w - 2 * 10) / 3);
    expect(l.ctaRect.w, 'CTA 宽 ≥ 三辅助入口之和').toBeGreaterThanOrEqual(assistW * 3);
    expect(l.ctaRect.h, 'CTA 高 ≥40').toBeGreaterThanOrEqual(40);
    expect(l.assistRect.h, '辅助入口矮于 CTA').toBeLessThan(l.ctaRect.h);
  });

  it('4. 背景非纯底色（源码守卫）：drawHomeBackground 有多段渐变 + 光晕/远山装饰', () => {
    const src = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    const start = src.indexOf('private drawHomeBackground');
    expect(start, 'drawHomeBackground 存在').toBeGreaterThan(-1);
    const method = src.slice(start, src.indexOf('private drawGarageMetaPage'));
    // 多段天空（非单一 fillRect）
    expect(method).toContain('bands');
    expect(method).toContain("'#0a0d13'");
    // 光晕（arc 圆）+ 远山剪影（polygon）+ 地面光带
    expect(method).toContain('ctx.arc');
    expect(method).toContain('fillStyle = \'rgba(20,28,44,0.9)\''); // 远山
    expect(method).toContain('fillRect'); // 地面光带
  });

  it('5. DPR 不参与 Home 布局（纯函数：同 viewport 同 profile → 同结果）', () => {
    const prof = resolveLayoutProfile(420, 210);
    const a = computeHomeLayout({ w: 420, h: 210 }, INSETS, prof);
    const b = computeHomeLayout({ w: 420, h: 210 }, INSETS, prof);
    // chestSlot 是函数（每次新对象），比较其余布局几何
    expect(a.topBarRect).toEqual(b.topBarRect);
    expect(a.vehicleRect).toEqual(b.vehicleRect);
    expect(a.ctaRect).toEqual(b.ctaRect);
    expect(a.assistRect).toEqual(b.assistRect);
  });
});
