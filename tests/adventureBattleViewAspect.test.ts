/**
 * FRUITS-ADVENTURE-BATTLE-VIEW-F1｜冒险战斗画面「比例不失真」定向测试。
 *
 * 背景（D1 诊断实测）：竖屏冒险把 390×302 的正式战斗安全区**两轴各自缩放**到 390×648，
 * 纵向 ×2.146 —— 战车 208×75（世界 2.77）被渲染成 71×55（屏幕 1.29）。
 *
 * 本测试锁三条不变量（对应 Queue 必改 1/2 与验收 1）：
 *   ① `planBattleBlit` 的合成**只算一个 scale**：`dw/sw === dh/sh` 恒成立（含比例不符的极端目标带）；
 *   ② `RunBattleView` 的视口可由 `safeArea` 指定：冒险传 390×648 ⇒ 视口 502×704；
 *      缺省（其余四个 Lab 页）仍是 502×358 / 安全区 390×302 —— 零回归；
 *   ③ `blit` 在「安全区 == 目标带」时是严格 1:1；在比例不符时等比缩放（绝不单轴拉伸）；
 *      `blitCover` 铺满目标带时同样是同一个 scale（只裁不拉）。
 */
import { describe, expect, it } from 'vitest';
import { planBattleBlit, RunBattleView } from '../src/lab/portraitBattleLab/runBattleView';

/** 竖屏冒险真实布局（与 advPage.ts 常量同源）。 */
const STAGE_BAND = { x: 0, y: 96, w: 390, h: 648 };
/** RESULT 阶段主体层（更矮：铺满时只能裁，不能拉）。 */
const RESULT_STAGE = { x: 0, y: 96, w: 390, h: 468 };
/** 正式舞台带（其余 Lab 页用的口径）。 */
const RUN_STAGE_BAND = { x: 0, y: 80, w: 390, h: 302 };

/** 9 参数 drawImage 的一次调用（DPR=1 下即逻辑坐标）。 */
interface DrawCall {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
}

/**
 * 用最小 canvas 桩构造 RunBattleView（node 环境无 DOM）。
 * 只验证**几何/合成**，不触发 render()（渲染链路由浏览器 E2E 覆盖）。
 */
function makeView(safeArea?: { w: number; h: number }): {
  view: RunBattleView;
  calls: DrawCall[];
  ctx: CanvasRenderingContext2D;
} {
  const calls: DrawCall[] = [];
  const ctx = {
    drawImage: (
      _img: unknown,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ) => {
      calls.push({ sx, sy, sw, sh, dx, dy, dw, dh });
    },
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const doc = { createElement: () => canvas };
  const g = globalThis as unknown as { Image?: unknown };
  const prevImage = g.Image;
  class FakeImage {
    width = 64;
    height = 64;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) {
      /* 不真正解码；本测试不依赖资源就绪 */
    }
  }
  g.Image = FakeImage;
  try {
    const view = new RunBattleView(doc as unknown as Document, safeArea ? { safeArea } : {});
    return { view, calls, ctx: ctx as unknown as CanvasRenderingContext2D };
  } finally {
    g.Image = prevImage;
  }
}

/** 单次合成的两轴缩放系数。 */
function ratios(c: DrawCall): { x: number; y: number } {
  return { x: c.dw / c.sw, y: c.dh / c.sh };
}

describe('planBattleBlit｜只算一个 scale（结构上不可能单轴拉伸）', () => {
  it('比例相符：contain 是严格 1:1（dx/dy 落在目标带原点）', () => {
    const p = planBattleBlit({ w: 390, h: 302 }, RUN_STAGE_BAND, 'contain');
    expect(p.sw / p.sh).toBeCloseTo(390 / 302, 10);
    expect(p.dw / p.dh).toBeCloseTo(p.sw / p.sh, 10);
    expect(p.dw).toBeCloseTo(390, 10);
    expect(p.dh).toBeCloseTo(302, 10);
    expect(p.dx).toBeCloseTo(RUN_STAGE_BAND.x, 10);
    expect(p.dy).toBeCloseTo(RUN_STAGE_BAND.y, 10);
  });

  it('F1 复查口径：安全区 390×302 贴到 390×648 时，两轴系数必须相同（旧实现是 1 vs 2.146）', () => {
    const p = planBattleBlit({ w: 390, h: 302 }, STAGE_BAND, 'contain');
    const rx = p.dw / p.sw;
    const ry = p.dh / p.sh;
    expect(ry).toBeCloseTo(rx, 10); // 同一个 scale
    // 旧实现：dstH/srcH = 648/302 ≈ 2.146 —— 新实现绝不允许出现这个比值
    expect(Math.abs(ry - 648 / 302)).toBeGreaterThan(0.5);
    // contain ⇒ 完整入画（目标带内的居中矩形不越界）
    expect(p.dx).toBeGreaterThanOrEqual(STAGE_BAND.x - 1e-9);
    expect(p.dy).toBeGreaterThanOrEqual(STAGE_BAND.y - 1e-9);
    expect(p.dx + p.dw).toBeLessThanOrEqual(STAGE_BAND.x + STAGE_BAND.w + 1e-9);
    expect(p.dy + p.dh).toBeLessThanOrEqual(STAGE_BAND.y + STAGE_BAND.h + 1e-9);
  });

  it('cover：铺满目标带、只裁不拉，两轴系数仍相同', () => {
    const p = planBattleBlit({ w: 390, h: 648 }, RESULT_STAGE, 'cover');
    expect(p.dw).toBeCloseTo(RESULT_STAGE.w, 10);
    expect(p.dh).toBeCloseTo(RESULT_STAGE.h, 10);
    expect(p.dw / p.sw).toBeCloseTo(p.dh / p.sh, 10);
    // 纵向裁掉 (648-468) 的一半（focusY=0.5）
    expect(p.sy).toBeCloseTo((648 - 468) / 2, 10);
    expect(p.sh).toBeCloseTo(468, 10);
    expect(p.sx).toBeCloseTo(0, 10);
    expect(p.sw).toBeCloseTo(390, 10);
  });

  it('cover 的 focusY 被钳制在 [0,1]（0 = 保顶，1 = 保底）', () => {
    const top = planBattleBlit({ w: 390, h: 648 }, RESULT_STAGE, 'cover', -5);
    const bottom = planBattleBlit({ w: 390, h: 648 }, RESULT_STAGE, 'cover', 5);
    expect(top.sy).toBeCloseTo(0, 10);
    expect(bottom.sy).toBeCloseTo(648 - 468, 10);
  });
});

describe('RunBattleView｜视口与合成（冒险 390×648 vs 其余页面 390×302）', () => {
  it('冒险口径：safeArea=390×648 ⇒ 视口 502×704，安全区读数 390×648', () => {
    const { view } = makeView({ w: STAGE_BAND.w, h: STAGE_BAND.h });
    expect(view.viewportSize()).toEqual({ w: 502, h: 704 });
    expect(view.safeAreaSize()).toEqual({ w: 390, h: 648 });
  });

  it('缺省口径零回归：视口仍是 502×358，安全区仍是 390×302', () => {
    const { view } = makeView();
    expect(view.viewportSize()).toEqual({ w: 502, h: 358 });
    expect(view.safeAreaSize()).toEqual({ w: 390, h: 302 });
  });

  it('blit 到冒险舞台带 = 1:1 等比贴满（X/Y 同一 scale，无留白无拉伸）', () => {
    const { view, calls, ctx } = makeView({ w: 390, h: 648 });
    view.blit(ctx, STAGE_BAND);
    expect(calls).toHaveLength(1);
    const c = calls[0];
    // 源矩形 = 正式安全区（inset 原点 56/28 起，尺寸 390×648，DPR=1）
    expect(c.sx).toBeCloseTo(56, 10);
    expect(c.sy).toBeCloseTo(28, 10);
    expect(c.sw).toBeCloseTo(390, 10);
    expect(c.sh).toBeCloseTo(648, 10);
    // 目标矩形 = 舞台带，且两轴系数都是 1
    expect(c.dx).toBeCloseTo(STAGE_BAND.x, 10);
    expect(c.dy).toBeCloseTo(STAGE_BAND.y, 10);
    expect(c.dw).toBeCloseTo(STAGE_BAND.w, 10);
    expect(c.dh).toBeCloseTo(STAGE_BAND.h, 10);
    const r = ratios(c);
    expect(r.x).toBeCloseTo(1, 10);
    expect(r.y).toBeCloseTo(1, 10);
  });

  it('比例不符的目标带 ⇒ 等比缩放（旧实现的 2.146 单轴拉伸被结构性排除）', () => {
    const { view, calls, ctx } = makeView({ w: 390, h: 648 });
    view.blit(ctx, RUN_STAGE_BAND);
    const c = calls[0];
    const r = ratios(c);
    expect(r.x).toBeCloseTo(r.y, 10);
    expect(Math.abs(r.y - RUN_STAGE_BAND.h / 648)).toBeLessThan(1e-9); // = min() 选中的 scale
    expect(Math.abs(r.x - RUN_STAGE_BAND.h / 648)).toBeLessThan(1e-9); // 同一 scale
    // 宽度因此收窄（等比），而不是被拉满 390：这正是「不单轴拉伸」的代价与证据
    expect(c.dw).toBeLessThan(RUN_STAGE_BAND.w);
  });

  it('blitCover 到 RESULT 主体层：铺满 390×468 且只裁纵向（车辆像素不被压缩）', () => {
    const { view, calls, ctx } = makeView({ w: 390, h: 648 });
    view.blitCover(ctx, RESULT_STAGE, 0.5);
    const c = calls[0];
    expect(c.dw).toBeCloseTo(390, 10);
    expect(c.dh).toBeCloseTo(468, 10);
    expect(c.sw).toBeCloseTo(390, 10);
    expect(c.sh).toBeCloseTo(468, 10);
    // 源纵向偏移 = inset 28 + (648-468)/2
    expect(c.sy).toBeCloseTo(28 + 90, 10);
    const r = ratios(c);
    expect(r.x).toBeCloseTo(1, 10);
    expect(r.y).toBeCloseTo(1, 10);
  });

  it('compositeProbe 如实回报两轴系数（供 E2E / 报告对账）', () => {
    const { view } = makeView({ w: 390, h: 648 });
    const p = view.compositeProbe(STAGE_BAND, 'contain');
    expect(p.safe).toEqual({ w: 390, h: 648 });
    expect(p.band).toEqual({ w: 390, h: 648 });
    expect(p.scaleX).toBeCloseTo(p.scaleY, 10);
    expect(p.scaleX).toBeCloseTo(1, 10);
  });
});
