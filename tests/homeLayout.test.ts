import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeHomeLayout } from '../src/ui/homeLayout';
import { resolveLayoutProfile } from '../src/ui/layoutProfile';
import type { SafeInsets } from '../src/platform/types';

/**
 * F-HOME-IA-R1｜正式首页场景式布局专项：
 * 1. 布局矩阵（360×180 ~ 844×390）全部 rect 无溢出（safe 内 + 正尺寸 + 不重叠）；
 *    模块：profileRect(左上) / stageRect(中央) / vehicleFramingRect(stage 上部) /
 *    ctaRect(下方中央悬浮·中等宽) / garageRect(左下) / rankRect·passRect(右下) / chestSlot×4(右上)。
 * 2. 车辆取景区（vehicleFramingRect）⊆ stageRect 且为正尺寸；
 * 3. CTA 中等宽（不横贯整屏）、居中、全页最高（> 底部入口）；
 * 4. 背景单一入口 + 不再 UI 覆盖车辆（F-HOME-P0-LAYER）；
 * 5. DPR 不参与 Home 布局（纯函数：同 viewport 同 profile → 同结果）。
 * 6. 源码守卫：删除全宽车辆框/全宽 CTA 横栏/三等分底栏（drawHomePage 改场景式）。
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

describe('F-HOME-IA-R1｜正式首页场景式布局', () => {
  it('1. 布局矩阵：profile/stage/cta/garage/rank/pass/chest 全部 rect 在 safe 内且正尺寸', () => {
    for (const vp of VIEWPORTS) {
      const prof = resolveLayoutProfile(vp.w, vp.h);
      const l = computeHomeLayout(vp, INSETS, prof);
      const rects: Array<[string, { x: number; y: number; w: number; h: number }]> = [
        ['profile', l.profileRect],
        ['stage', l.stageRect],
        ['vehicleFraming', l.vehicleFramingRect],
        ['cta', l.ctaRect],
        ['garage', l.garageRect],
        ['rank', l.rankRect],
        ['pass', l.passRect],
      ];
      for (const [name, r] of rects) {
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
      // profile（左上）与 chest（右上）互不重叠
      const pr = l.profileRect;
      const lastChest = l.chestSlot(3);
      expect(pr.x + pr.w, 'profile 右缘 < 最右宝箱左缘（左段不压右段）').toBeLessThanOrEqual(lastChest.x + 0.5);
      // 层级关系（场景式，不再 topBar→vehicle→cta→assist 四横栏）：
      // stage 在中央（top row 之下、bottom row 之上）；vehicleFraming ⊆ stage；cta 在 stage 下部、不与底部入口重叠
      expect(l.vehicleFramingRect.x, 'vehicleFraming 在 stage 内（左）').toBeGreaterThanOrEqual(l.stageRect.x - 0.5);
      expect(l.vehicleFramingRect.y, 'vehicleFraming 在 stage 内（上）').toBeGreaterThanOrEqual(l.stageRect.y - 0.5);
      expect(l.vehicleFramingRect.x + l.vehicleFramingRect.w, 'vehicleFraming 在 stage 内（右）').toBeLessThanOrEqual(l.stageRect.x + l.stageRect.w + 0.5);
      expect(l.vehicleFramingRect.y + l.vehicleFramingRect.h, 'vehicleFraming 在 stage 内（下）').toBeLessThanOrEqual(l.stageRect.y + l.stageRect.h + 0.5);
      // 单底部条结构（F-HOME-VISUAL-R2）：CTA 中心 = 屏幕水平主轴 W/2（Must#5——禁止
      // 「左右入口剩余空间中心」：左侧 1 入口 + 右侧 2 入口会使主轴右偏）；与辅助入口不重叠
      expect(Math.abs(l.ctaRect.x + l.ctaRect.w / 2 - vp.w / 2), `${vp.w}×${vp.h} CTA 中心 = 屏幕主轴 W/2`).toBeLessThanOrEqual(1);
      expect(l.ctaRect.x, 'CTA 左缘 ≥ 车库右缘（水平不重叠）').toBeGreaterThanOrEqual(l.garageRect.x + l.garageRect.w - 1);
      expect(l.ctaRect.x + l.ctaRect.w, 'CTA 右缘 ≤ 排行榜左缘（水平不重叠）').toBeLessThanOrEqual(l.rankRect.x + 1);
      // 底部入口（garage 左；rank/pass 右）互不重叠
      expect(l.garageRect.x + l.garageRect.w, 'garage 右缘 ≤ rank 左缘').toBeLessThanOrEqual(l.rankRect.x + 0.5);
      expect(l.rankRect.x + l.rankRect.w, 'rank 右缘 ≤ pass 左缘').toBeLessThanOrEqual(l.passRect.x + 0.5);
    }
  });

  it('2. 车辆取景区为正尺寸且进入 stage：420×210 vehicleFraming.h ≥40；矩阵均 ≥20', () => {
    for (const vp of VIEWPORTS) {
      const prof = resolveLayoutProfile(vp.w, vp.h);
      const l = computeHomeLayout(vp, INSETS, prof);
      expect(l.stageRect.h, `${vp.w}×${vp.h} stage 高 ≥40`).toBeGreaterThanOrEqual(40);
      expect(l.vehicleFramingRect.h, `${vp.w}×${vp.h} vehicleFraming 高 ≥20`).toBeGreaterThanOrEqual(20);
    }
    const s = resolveLayoutProfile(420, 210);
    expect(computeHomeLayout({ w: 420, h: 210 }, INSETS, s).vehicleFramingRect.h, '420×210 vehicleFraming 高 ≥40').toBeGreaterThanOrEqual(40);
  });

  it('3. CTA 中等宽、中心 = 屏幕水平主轴 W/2、全页最高（不横贯整屏、不三等分底栏）', () => {
    for (const vp of VIEWPORTS) {
      const prof = resolveLayoutProfile(vp.w, vp.h);
      const l = computeHomeLayout(vp, INSETS, prof);
      const availW = vp.w - INSETS.left - INSETS.right;
      // 不横贯整屏：CTA 宽 < 可用宽（中等宽）
      expect(l.ctaRect.w, 'CTA 不横贯整屏（中等宽）').toBeLessThan(availW);
      // F-HOME-VISUAL-R2 Must#5：CTA 中心 = 屏幕水平主轴 W/2（禁止左右入口剩余空间中心）
      const ctaCx = l.ctaRect.x + l.ctaRect.w / 2;
      expect(Math.abs(ctaCx - vp.w / 2), `${vp.w}×${vp.h} CTA 中心 = 屏幕主轴 W/2`).toBeLessThanOrEqual(1);
      // 全页最高：CTA 高 > 底部入口高（主按钮视觉主次）
      expect(l.ctaRect.h, 'CTA 高于底部入口').toBeGreaterThan(l.garageRect.h);
    }
  });

  it('4. 背景单一入口 + 三层竞技场（F-HOME-VISUAL-R2）：drawHomeBackdrop 为唯一入口；远景看台 / 中景聚光 / 前景展示平台', () => {
    const host = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    const renderer = readFileSync('src/render/renderer.ts', 'utf-8');
    const start = renderer.indexOf('private drawHomeBackdrop');
    expect(start, 'renderer.drawHomeBackdrop 存在（正式背景资源单一入口）').toBeGreaterThan(-1);
    const method = renderer.slice(start, renderer.indexOf('private vehicleCenter'));
    // 三层背景：远景看台（tiers 阶梯）+ 中景聚光（spotlight 锥）+ 前景展示平台（台面前缘高光）
    expect(method, '远景看台层').toContain('const tiers = 6');
    expect(method, '看台灯点').toContain('rgba(150,195,255,0.4)');
    expect(method, '中景聚光锥').toContain('createLinearGradient');
    expect(method, '中景环境灯柱').toContain('rgba(30,46,74,0.7)');
    expect(method, '前景展示平台').toContain('rgba(120,170,255,0.32)');
    expect(method, '首带 #0a0d13 保留').toContain("'#0a0d13'");
    // Must#4：不再「4 纯色带 + 2 巨圆 + 远山」
    expect(method, '不再 bands 纯色带').not.toContain("const bands");
    expect(method, '不再远山剪影').not.toContain('rgba(20,28,44,0.9)');
    expect(host, 'host 不再引用 drawHomeBackground').not.toContain('drawHomeBackground');
  });

  it('5. DPR 不参与 Home 布局（纯函数：同 viewport 同 profile → 同结果）', () => {
    const prof = resolveLayoutProfile(420, 210);
    const a = computeHomeLayout({ w: 420, h: 210 }, INSETS, prof);
    const b = computeHomeLayout({ w: 420, h: 210 }, INSETS, prof);
    expect(a.profileRect).toEqual(b.profileRect);
    expect(a.stageRect).toEqual(b.stageRect);
    expect(a.vehicleFramingRect).toEqual(b.vehicleFramingRect);
    expect(a.ctaRect).toEqual(b.ctaRect);
    expect(a.garageRect).toEqual(b.garageRect);
    expect(a.rankRect).toEqual(b.rankRect);
    expect(a.passRect).toEqual(b.passRect);
  });

  it('6. 源码守卫：删除全宽车辆框 / 全宽 CTA 横栏 / 三等分底栏（drawHomePage 改场景式）', () => {
    const host = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    const start = host.indexOf('private drawHomePage');
    const end = host.indexOf('\n  private drawGarageMetaPage');
    const hp = host.slice(start, end === -1 ? host.length : end);
    // 取景改为 vehicleFramingRect（stage 上部、CTA 之上）
    expect(hp, '取景区改用 vehicleFramingRect').toContain('vehicleFramingRect');
    // 紧凑底部入口（图标 + 短标签），不再三等分大按钮
    expect(hp, '底部入口改紧凑 drawHomeBottomEntry').toContain('drawHomeBottomEntry');
    expect(hp, '不再引用 assistRect（三等分底栏已删）').not.toContain('assistRect');
    // 删除全宽车辆框（旧半透明矩形框 + 边框）
    expect(hp, '删除全宽车辆框（旧 rgba(10,14,22,0.35) 框）').not.toContain("'rgba(10,14,22,0.35)'");
    // 布局对象不再是四横栏结构（无 topBar/assist/全宽 vehicleRect 字段）
    const layoutSrc = readFileSync('src/ui/homeLayout.ts', 'utf-8');
    expect(layoutSrc, 'HomeLayout 不再导出 topBarRect').not.toMatch(/topBarRect\s*:/);
    expect(layoutSrc, 'HomeLayout 不再导出 assistRect').not.toMatch(/assistRect\s*:/);
    expect(layoutSrc, 'HomeLayout 导出 stageRect（中央主体）').toMatch(/stageRect\s*:/);
    expect(layoutSrc, 'HomeLayout 导出 vehicleFramingRect（取景子区）').toMatch(/vehicleFramingRect\s*:/);
  });
});
