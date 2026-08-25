import { describe, it, expect } from 'vitest';
import { WebInput } from '../src/platform/web/input';
import {
  REVIEW_PRESETS,
  DEFAULT_REVIEW_INDEX,
  createMobileReviewState,
  selectReviewPreset,
  toggleReviewScale,
  reviewViewport,
  reviewContainerStyle,
} from '../src/dev/reviewMode';

/**
 * F-UX-REVIEW-1｜DEV Mobile Review 验收：
 * 1. 420×210 @ 2x 显示时内部仍严格 420×210（容器 CSS 尺寸 = 逻辑 viewport，transform 仅视觉）；
 * 2. 1x/2x 点击同一按钮命中同一 action（WebInput 坐标归一化：2x 视觉坐标 → 同一逻辑坐标）；
 * 3. 五档 viewport 均可实时切换（纯函数状态机 + 样式计算）；
 * 4. 正常未缩放 Web 保持原行为（rect.width === clientWidth → local = clientX - rect.left）。
 */

/** 构造 fake 元素：模拟被 CSS transform 缩放的 canvas（getBoundingClientRect 返回视觉尺寸） */
function fakeNode(logicalW: number, logicalH: number, scale: number) {
  const handlers: Record<string, (ev: unknown) => void> = {};
  const node = {
    clientWidth: logicalW,
    clientHeight: logicalH,
    getBoundingClientRect: () => {
      // 视觉 rect（transform 放大后）：left/top 为视觉位移，width/height 为视觉尺寸
      const vw = logicalW * scale;
      const vh = logicalH * scale;
      return { left: 100, top: 50, width: vw, height: vh, right: 100 + vw, bottom: 50 + vh };
    },
    addEventListener: (type: string, fn: (ev: unknown) => void) => {
      handlers[type] = fn;
    },
  } as unknown as HTMLElement;
  const fire = (cx: number, cy: number): void => handlers['mousedown']({ clientX: cx, clientY: cy });
  return { node, fire };
}

describe('F-UX-REVIEW-1｜WebInput 缩放坐标归一化', () => {
  it('验收2｜1x 与 2x 下点击同一逻辑点 → 输出同一逻辑坐标（命中同一按钮/action）', () => {
    const logicalW = 420;
    const logicalH = 210;
    for (const scale of [1, 2] as const) {
      const { node, fire } = fakeNode(logicalW, logicalH, scale);
      const got: Array<[number, number]> = [];
      new WebInput().bindPointer(node, (x, y) => got.push([x, y]));
      // 点击逻辑中心：视觉坐标 = rect.left + 逻辑×scale
      const cx = 100 + (logicalW / 2) * scale;
      const cy = 50 + (logicalH / 2) * scale;
      fire(cx, cy);
      expect(got).toHaveLength(1);
      expect(got[0][0], `scale=${scale} 归一化后逻辑 x`).toBeCloseTo(logicalW / 2, 5);
      expect(got[0][1], `scale=${scale} 归一化后逻辑 y`).toBeCloseTo(logicalH / 2, 5);
    }
  });

  it('验收2b｜同一点在 1x 与 2x 下的输出完全一致（等价性证明）', () => {
    const logicalW = 460;
    const logicalH = 230;
    const results: Array<[number, number]> = [];
    for (const scale of [1, 2] as const) {
      const { node, fire } = fakeNode(logicalW, logicalH, scale);
      const got: Array<[number, number]> = [];
      new WebInput().bindPointer(node, (x, y) => got.push([x, y]));
      fire(100 + 200 * scale, 50 + 100 * scale);
      results.push(got[0]);
    }
    expect(results[0]).toEqual(results[1]);
  });

  it('验收4｜未缩放 Web 保持原行为：rect.width === clientWidth → local = clientX - rect.left', () => {
    const { node, fire } = fakeNode(844, 390, 1); // scale=1 → 视觉 rect == 逻辑尺寸
    const got: Array<[number, number]> = [];
    new WebInput().bindPointer(node, (x, y) => got.push([x, y]));
    fire(100 + 300, 50 + 120);
    expect(got[0][0], 'localX = clientX - rect.left（原行为）').toBe(300);
    expect(got[0][1], 'localY = clientY - rect.top（原行为）').toBe(120);
  });
});

describe('F-UX-REVIEW-1｜reviewMode 纯逻辑（预设/状态机/样式）', () => {
  it('验收1｜420×210 @ 2x：容器 CSS 尺寸 = 420×210（内部严格一致），transform 仅视觉放大', () => {
    const vp420 = REVIEW_PRESETS.find((p) => p.w === 420 && p.h === 210)!;
    const st = reviewContainerStyle(vp420, 2);
    expect(st.width, '容器宽 = 逻辑 420').toBe(420);
    expect(st.height, '容器高 = 逻辑 210').toBe(210);
    expect(st.transform, '视觉放大 2x').toBe('scale(2)');
    // 1x 无缩放
    const st1 = reviewContainerStyle(vp420, 1);
    expect(st1.transform).toBe('scale(1)');
    // 内部尺寸严格等于所选 viewport（容器 CSS 尺寸即游戏 parent.clientWidth/Height）
    expect(st.width).toBe(vp420.w);
    expect(st.height).toBe(vp420.h);
  });

  it('验收3a｜五档预设齐全且默认 420×210', () => {
    expect(REVIEW_PRESETS.map((p) => `${p.w}×${p.h}`)).toEqual([
      '360×180',
      '390×195',
      '420×210',
      '460×230',
      '621×351',
    ]);
    expect(DEFAULT_REVIEW_INDEX).toBe(2);
    const s = createMobileReviewState();
    expect(reviewViewport(s)).toEqual({ w: 420, h: 210 });
    expect(s.scale).toBe(2);
  });

  it('验收3b｜五档均可实时切换（越界钳制）', () => {
    let s = createMobileReviewState();
    const seen: string[] = [];
    for (let i = 0; i < REVIEW_PRESETS.length; i++) {
      s = selectReviewPreset(s, i);
      const vp = reviewViewport(s);
      seen.push(`${vp.w}×${vp.h}`);
    }
    expect(seen).toEqual(['360×180', '390×195', '420×210', '460×230', '621×351']);
    // 越界钳制
    expect(reviewViewport(selectReviewPreset(s, -5))).toEqual(REVIEW_PRESETS[0]);
    expect(reviewViewport(selectReviewPreset(s, 99))).toEqual(REVIEW_PRESETS[REVIEW_PRESETS.length - 1]);
  });

  it('验收3c｜1x/2x 切换只改变显示，不改变内部 viewport', () => {
    let s = createMobileReviewState();
    const vpBefore = reviewViewport(s);
    s = toggleReviewScale(s);
    expect(s.scale, '2x → 1x').toBe(1);
    s = toggleReviewScale(s);
    expect(s.scale, '1x → 2x').toBe(2);
    expect(reviewViewport(s), '切换显示不改变内部 viewport').toEqual(vpBefore);
    // 各档位下样式：CSS 尺寸 = viewport，transform = scale
    for (const p of REVIEW_PRESETS) {
      const st2 = reviewContainerStyle(p, 2);
      expect(st2.width).toBe(p.w);
      expect(st2.height).toBe(p.h);
      expect(st2.transform).toBe('scale(2)');
    }
  });
});

describe('F-UX-2A｜Mobile Review 纯净模式（源码守卫）', () => {
  it('验收1/2｜Review 开启时隐藏全部 DEV 控件；隐藏与 1x/2x 无关；普通 DEV 不受影响', () => {
    const src = require('fs').readFileSync('src/main.ts', 'utf-8');
    const reviewStart = src.lastIndexOf('DEV Mobile Review'); // review 块注释（非 import 注释）
    const reviewEnd = src.indexOf('/* ---------- 主循环');
    const reviewBlock = src.slice(reviewStart, reviewEnd);
    // review 块内一次性隐藏全部 DEV 控件（Build Editor / 侧栏 / Debug 面板 / 原 DEV 工具栏）
    expect(reviewBlock).toContain("toolbar.style.display = 'none'");
    expect(reviewBlock).toContain("panelA.style.display = 'none'");
    expect(reviewBlock).toContain("panelB.style.display = 'none'");
    expect(reviewBlock).toContain('debugPanel) debugPanel.style.display');
    // 隐藏发生在 applyReview（1x/2x 逻辑）之前——一次性执行，与显示倍率无关
    const applyStart = reviewBlock.indexOf('const applyReview');
    const hideIdx = reviewBlock.indexOf("toolbar.style.display = 'none'");
    expect(hideIdx, 'DEV 控件隐藏先于 applyReview').toBeGreaterThan(-1);
    expect(hideIdx, '隐藏不依赖 applyReview（倍率逻辑外一次性执行）').toBeLessThan(applyStart);
    // 普通 DEV 路径不受影响：整个 review 块在 if (reviewOn) 条件内（无参数时不执行，
    // 不触碰任何 DEV 控件）；scenario 的 panelA/panelB 隐藏是既有独立逻辑，与 review 无关
    const ifIdx = src.indexOf('if (reviewOn) {');
    expect(ifIdx, 'if (reviewOn) 存在').toBeGreaterThan(-1);
    expect(ifIdx, 'if (reviewOn) 位于 review 块注释内').toBeGreaterThan(reviewStart);
    expect(ifIdx, 'if (reviewOn) 在主循环之前').toBeLessThan(reviewEnd);
    // 游戏区域保持页面中央：flex:none + margin auto + transformOrigin top left（1x/2x 只变视觉）
    expect(reviewBlock).toContain("canvasWrap.style.flex = 'none'");
    expect(reviewBlock).toContain("canvasWrap.style.margin = 'auto'");
    expect(reviewBlock).toContain('top left');
  });
});
