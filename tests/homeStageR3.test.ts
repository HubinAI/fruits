/**
 * F-HOME-STAGE-R3｜移动端首页底部操作层（轻量次级入口 + 唯一主按钮）布局验收。
 *
 * 布局链路：computeHomeLayout(viewport, insets, profile) 单一布局源 →
 *   stageRect（中央车辆舞台，避开顶部信息与底部交互区）/ vehicleFramingRect（取景子区，
 *   底缘在底部主条上缘之上，不压车）/ ctaRect（寻找对手唯一主按钮，中等宽居中）/
 *   garageRect·rankRect·passRect（底部主条左右紧凑次级入口）。
 *
 * R3 真实改动仅限底部次级入口「视觉降级」（drawHomeBottomEntry：去掉实底重框 → 轻量 chip），
 * 不动 homeLayout 几何、不动车库/宝箱/排行榜/战令逻辑、不动桌面、不缩字号。
 * 本测试守「主次构图」+ 车辆舞台回归（居中/贴地/不遮挡）。
 *
 * 验收（viewport 矩阵 360×180..844×390）：
 * 1. 车辆舞台独立于顶部信息与底部交互区；
 * 2. 完整车辆不被底栏遮挡（vehicleFraming ⊆ stage，底缘 ≤ 主条上缘）；
 * 3. 「寻找对手」唯一主按钮：最高且居中、不横贯；
 * 4. 车库/排行榜/战令紧凑次级：高度 < 主按钮、两侧分布、固定 3 个（不新增入口）。
 */
import { describe, it, expect } from 'vitest';
import { computeHomeLayout } from '../src/ui/homeLayout';
import { resolveLayoutProfile } from '../src/ui/layoutProfile';
import type { SafeInsets } from '../src/platform/types';

const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };
const VIEWPORTS = [
  { w: 360, h: 180 },
  { w: 390, h: 195 },
  { w: 420, h: 210 },
  { w: 460, h: 230 },
  { w: 621, h: 351 },
  { w: 844, h: 390 },
];

describe('F-HOME-STAGE-R3｜底部操作层主次构图', () => {
  for (const vp of VIEWPORTS) {
    const prof = resolveLayoutProfile(vp.w, vp.h);
    const l = computeHomeLayout(vp, INSETS, prof);
    const bandTop = l.ctaRect.y; // 底部主条顶缘

    it(`${vp.w}×${vp.h}：车辆舞台独立于顶部信息与底部交互区`, () => {
      expect(l.stageRect.y, 'stage 在顶部之下').toBeGreaterThanOrEqual(INSETS.top);
      expect(l.stageRect.y + l.stageRect.h, 'stage 底缘 = 底部主条上缘（不进交互区）').toBeLessThanOrEqual(bandTop + 0.5);
    });

    it(`${vp.w}×${vp.h}：完整车辆不被底栏遮挡（取景区 ⊆ stage、底缘 ≤ 主条上缘）`, () => {
      expect(l.vehicleFramingRect.x, '取景区在 stage 内（左）').toBeGreaterThanOrEqual(l.stageRect.x - 0.5);
      expect(l.vehicleFramingRect.y, '取景区在 stage 内（上）').toBeGreaterThanOrEqual(l.stageRect.y - 0.5);
      expect(l.vehicleFramingRect.x + l.vehicleFramingRect.w, '取景区在 stage 内（右）').toBeLessThanOrEqual(l.stageRect.x + l.stageRect.w + 0.5);
      expect(l.vehicleFramingRect.y + l.vehicleFramingRect.h, '取景区底缘 ≤ 主条上缘（不压车）').toBeLessThanOrEqual(bandTop + 0.5);
    });

    it(`${vp.w}×${vp.h}：「寻找对手」唯一主按钮：最高且居中、不横贯`, () => {
      expect(l.ctaRect.h, 'CTA 高于次级入口(garage)').toBeGreaterThan(l.garageRect.h);
      expect(l.ctaRect.h, 'CTA 高于次级入口(rank)').toBeGreaterThan(l.rankRect.h);
      expect(l.ctaRect.h, 'CTA 高于次级入口(pass)').toBeGreaterThan(l.passRect.h);
      // CTA 左右等距居中
      const leftGap = l.ctaRect.x - (l.garageRect.x + l.garageRect.w);
      const rightGap = l.rankRect.x - (l.ctaRect.x + l.ctaRect.w);
      expect(Math.abs(leftGap - rightGap), 'CTA 左右等距居中').toBeLessThanOrEqual(1);
      // 不横贯：CTA 宽 < 可用宽（两侧留次级入口位）
      expect(l.ctaRect.w, 'CTA 不横贯整屏').toBeLessThan(vp.w - INSETS.left - INSETS.right);
    });

    it(`${vp.w}×${vp.h}：车库/排行榜/战令=紧凑次级（高度<主按钮、两侧分布、固定 3 个）`, () => {
      for (const [name, r] of [['garage', l.garageRect], ['rank', l.rankRect], ['pass', l.passRect]] as const) {
        expect(r.h, `${name} 高度 < CTA`).toBeLessThan(l.ctaRect.h);
        expect(r.x, `${name} 在 safe 左内`).toBeGreaterThanOrEqual(INSETS.left - 0.5);
        expect(r.x + r.w, `${name} 在 safe 右内`).toBeLessThanOrEqual(vp.w - INSETS.right + 0.5);
      }
      // 次级入口位于底部主条两侧，不挤占 CTA 中央区
      expect(l.garageRect.x + l.garageRect.w, '车库在 CTA 左侧').toBeLessThanOrEqual(l.ctaRect.x + 0.5);
      expect(l.rankRect.x, '排行榜在 CTA 右侧').toBeGreaterThanOrEqual(l.ctaRect.x + l.ctaRect.w - 0.5);
      expect(l.passRect.x, '战令在排行榜右侧').toBeGreaterThan(l.rankRect.x);
    });
  }
});
