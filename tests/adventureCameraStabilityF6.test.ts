/**
 * FRUITS-ADVENTURE-CAMERA-STABILITY-F6｜冒险合成镜头「连续帧稳定」定向测试。
 *
 * 背景（P0 连续帧诊断，正常速度真实战斗）：
 *   · 旧实现 zoom 没有时间维度：`z = clamp(fit,1,1.6)` 再过「最小增益门限 1.1」，于是接近过程中
 *     fit 一越过 1.1，画面就在**一帧内**从 1.000 跳到 1.110（实测 6/6 场）；
 *   · 纵向裁切按「主体中心」逐帧重算 ⇒ 战车颠簸/被击飞时 `cy` 单帧跳 64–68px（镜头甩动）；
 *   · 战斗→RESULT 走 `blitCover`（原比例）⇒ 主体屏宽在切换那一帧缩小 31%–34%。
 *
 * 本测试锁 F6 的六条不变量（对应 Queue 必改 1/2/3 与验收 1/2/3）：
 *   ① 目标突变时 zoom **单帧位移有上限**（时间平滑 + 速率上限），且单调收敛到目标；
 *   ② 旧「1.1 门限」的阶跃被消除：fit 连续穿过 1.1 时 zoom 也连续（单帧 ≤ 2%）；
 *   ③ 纵向**只认地面线**：战车 Y 抖动 / 击飞不产生取景窗位移（cy 变化 < 1px）；
 *   ④ 横向有平滑滞后，但「裁切矩形恒含双车」是硬约束（任何一帧都不切车）；
 *   ⑤ RESULT 沿用末帧取景：`scale == zoom` ⇒ 主体像素尺寸与战斗末帧**完全相同**（不缩回原比例）；
 *   ⑥ dt 异常（0 / 掉帧 1s）/ 无主体 / zoom≈1 三种边界都不产生 NaN 或跨场景滑动。
 *
 * ⚠️ 只覆盖**几何与时间响应**：`viewTransform()`（正式相机的只读读数）在此用固定值桩替身；
 *    真实像素链路（正式相机 → 离屏画布 → 合成裁切）由 `_diag_camera_p0.cjs` 与 F4 E2E 覆盖。
 */
import { describe, expect, it } from 'vitest';
import { RunBattleView } from '../src/lab/portraitBattleLab/runBattleView';
import type { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';

/** 竖屏冒险真实布局（与 advPage.ts 常量同源）。 */
const STAGE_BAND = { x: 0, y: 96, w: 390, h: 648 };
const RESULT_STAGE = { x: 0, y: 96, w: 390, h: 468 };
const SAFE = { w: 390, h: 648 };
const FPS_DT = 1000 / 60;

/**
 * 正式相机的只读读数桩（与真实战斗同量级：cs≈0.6、地面线落在安全区 y=450）。
 * 世界 → 安全区：`safe = world * scale + offset − inset`。
 */
const XF = { scale: 0.62, offsetX: -369, offsetY: 44, cropX: 56, cropY: 28 };
const GROUND_SAFE = 700 * XF.scale + XF.offsetY - XF.cropY; // = 450

interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}
/** 安全区坐标 → 世界坐标（构造测试场景用）。 */
function world(sx: number, sy: number): { x: number; y: number } {
  return {
    x: (sx + XF.cropX - XF.offsetX) / XF.scale,
    y: (sy + XF.cropY - XF.offsetY) / XF.scale,
  };
}
/** 一辆车：以「安全区左上角 + 宽高」描述，默认贴地（下沿 = 地面线 450）。 */
function carAt(sx: number, sy = 390, w = 124, h = 60): Box {
  const a = world(sx, sy);
  const b = world(sx + w, sy + h);
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
}
/** 极简运行时桩：只实现合成镜头真正读取的两个只读入口。 */
function runtime(a: Box, b: Box, groundY = 700): RunBattleRuntime {
  return { vehicleBox: (team: 'A' | 'B') => (team === 'A' ? a : b), groundY } as unknown as RunBattleRuntime;
}

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

/** 用最小 canvas 桩构造视图，并把「正式相机读数」替换成固定 transform（见文件头）。 */
function makeView(): { view: RunBattleView; take: () => DrawCall[] } {
  let calls: DrawCall[] = [];
  const ctx = {
    drawImage: (_img: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) => {
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
      /* 不解码；本测试不依赖资源就绪 */
    }
  }
  g.Image = FakeImage;
  try {
    const view = new RunBattleView(doc as unknown as Document, { safeArea: SAFE });
    (view as unknown as { viewTransform: () => typeof XF }).viewTransform = () => XF;
    return {
      view,
      take: () => {
        const out = calls;
        calls = [];
        return out;
      },
    };
  } finally {
    g.Image = prevImage;
  }
}

/** 视图内部同一个 canvas 桩的 2d ctx（用于真实调用 blit*）。 */
function ctxOf(view: RunBattleView): CanvasRenderingContext2D {
  const canvas = (view as unknown as { canvas: { getContext: () => CanvasRenderingContext2D } }).canvas;
  return canvas.getContext();
}

/** 一帧推进（dt 默认 60fps）。 */
function step(view: RunBattleView, rt: RunBattleRuntime, dt = FPS_DT, maxZoom = 1.6) {
  return view.updateAdventureCamera(rt, maxZoom, dt);
}

/** 世界包围盒 → 安全区矩形（与产品代码同一条只读换算）。 */
function toSafe(box: Box): { x: number; y: number; w: number; h: number } {
  const x1 = box.minX * XF.scale + XF.offsetX - XF.cropX;
  const y1 = box.minY * XF.scale + XF.offsetY - XF.cropY;
  const x2 = box.maxX * XF.scale + XF.offsetX - XF.cropX;
  const y2 = box.maxY * XF.scale + XF.offsetY - XF.cropY;
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}
function containsBox(crop: { x: number; y: number; w: number; h: number }, box: Box, eps = 1e-6): boolean {
  const s = toSafe(box);
  return (
    s.x >= crop.x - eps &&
    s.y >= crop.y - eps &&
    s.x + s.w <= crop.x + crop.w + eps &&
    s.y + s.h <= crop.y + crop.h + eps
  );
}

describe('F6｜缩放时间平滑（必改 1：只加时间维度，不引入状态机）', () => {
  it('目标突变（双车瞬间贴脸）⇒ 连续斜坡，单帧位移 ≤ 速率上限，且单调收敛', () => {
    const { view } = makeView();
    const far = runtime(carAt(10), carAt(256)); // 双车铺开 ⇒ fit<1 ⇒ zoom=1
    const close = runtime(carAt(150), carAt(170)); // 贴脸 ⇒ fit 远超上限
    const z0 = step(view, far)!.zoom;
    expect(z0).toBe(1);

    const seq: number[] = [];
    for (let i = 0; i < 8; i++) seq.push(step(view, close)!.zoom);
    const deltas = seq.map((z, i) => Math.abs(z - (i === 0 ? z0 : seq[i - 1])));
    expect(Math.max(...deltas)).toBeLessThanOrEqual(2.2 * (FPS_DT / 1000) + 1e-6); // 2.2/s × 16.7ms
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]);
    for (let i = 0; i < 40; i++) step(view, close);
    expect(view.adventureCameraFrame()!.zoom).toBeCloseTo(1.6, 2);
  });

  it('旧「1.1 门限」阶跃被消除：fit 连续穿过 1.1 时 zoom 也连续（单帧 ≤ 1%）', () => {
    const { view } = makeView();
    // 让 fit 以 0.0035/帧 的**匀速**上升（从 0.95 扫到 1.30），必然穿过旧门限 1.10。
    // 反解几何：fit = 390/(1.12w+16) ⇒ w = (390/fit − 16)/1.12
    const fits = Array.from({ length: 101 }, (_, i) => 0.95 + i * 0.0035);
    let prev: number | null = null;
    let maxDelta = 0;
    let crossDelta = Number.NaN;
    for (const fit of fits) {
      const w = (390 / fit - 16) / 1.12;
      const half = w / 2;
      const rt = runtime(carAt(195 - half, 390, w, 60), carAt(195 + half - 1, 390, 1, 60));
      const z = step(view, rt)!.zoom;
      if (prev !== null) {
        const d = Math.abs(z - prev);
        maxDelta = Math.max(maxDelta, d);
        if (prev < 1.1 && z >= 1.1) crossDelta = d;
      }
      prev = z;
    }
    expect(Number.isNaN(crossDelta)).toBe(false); // 确实穿过了旧门限位置
    // 旧实现在这里是一帧 +0.10 的台阶；F6 单帧位移必须小于目标本身的变化量级
    expect(crossDelta).toBeLessThanOrEqual(0.006);
    expect(maxDelta).toBeLessThanOrEqual(0.006);
    expect(prev!).toBeGreaterThan(1.2); // 而且是真的一路放大，不是被门限按住
  });

  it('zoom 封底为 1：主体比安全区还宽 ⇒ 完全等价原取景', () => {
    const { view } = makeView();
    const wide = runtime(carAt(-80, 390, 560, 60), carAt(-70, 390, 1, 60));
    expect(view.advCompositeZoom(wide, 1.6)).toBe(1);
    const f = step(view, wide)!;
    expect(f.zoom).toBe(1);
    expect(f.cropSafe).toEqual({ x: 0, y: 0, w: 390, h: 648 });
  });

  it('距离约束仍然生效：双车越近 zoom 越大（F4 的既有优点没被平滑吃掉）', () => {
    const measure = (gap: number): number => {
      const { view } = makeView();
      const rt = runtime(carAt(140, 390, 60, 60), carAt(200 + gap, 390, 60, 60));
      for (let i = 0; i < 90; i++) step(view, rt);
      return view.adventureCameraFrame()!.zoom;
    };
    const near = measure(10);
    const mid = measure(100);
    const far = measure(250);
    expect(near).toBeGreaterThanOrEqual(mid);
    expect(mid).toBeGreaterThan(far);
    expect(near).toBeCloseTo(1.6, 2); // 贴脸 ⇒ 到达采纳上限
    expect(far).toBeCloseTo(1, 2); // 远距 ⇒ 收敛回原取景
  });
});

describe('F6｜纵向：地面锚定，不追踪战车 Y 轴（必改 2）', () => {
  it('战车被击飞（Y 瞬间上移 120px）⇒ 取景窗纵向纹丝不动', () => {
    const { view } = makeView();
    const grounded = runtime(carAt(120), carAt(220));
    for (let i = 0; i < 20; i++) step(view, grounded);
    const before = view.adventureCameraFrame()!.cropSafe;

    const flying = runtime(carAt(120, 270), carAt(220));
    const after = step(view, flying)!.cropSafe;
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
    expect(after.h).toBeCloseTo(before.h, 6);

    for (let i = 0; i < 12; i++) {
      const f = step(view, runtime(carAt(120, 270 - i * 4), carAt(220)))!;
      expect(Math.abs(f.cropSafe.y - before.y)).toBeLessThan(1);
    }
  });

  it('地面线在屏幕上的相对高度与 zoom 无关（锚点 = 地面线相对安全区的高度）', () => {
    const near = (() => {
      const { view } = makeView();
      const rt = runtime(carAt(140, 390, 60, 60), carAt(210, 390, 60, 60));
      for (let i = 0; i < 90; i++) step(view, rt);
      return view.adventureCameraFrame()!;
    })();
    const far = (() => {
      const { view } = makeView();
      const rt = runtime(carAt(10), carAt(256));
      for (let i = 0; i < 90; i++) step(view, rt);
      return view.adventureCameraFrame()!;
    })();
    const ratio = (f: { groundSafeY: number; cropSafe: { y: number; h: number } }) =>
      (f.groundSafeY - f.cropSafe.y) / f.cropSafe.h;
    expect(near.zoom).toBeGreaterThan(1.4);
    expect(far.zoom).toBe(1);
    expect(ratio(near)).toBeCloseTo(ratio(far), 6);
    expect(ratio(near)).toBeCloseTo(GROUND_SAFE / SAFE.h, 6);
    expect(far.cropSafe).toEqual({ x: 0, y: 0, w: 390, h: 648 }); // zoom=1 ⇒ 恒等
  });

  it('主体比取景窗还高时让位（纵向兜底），但取景窗始终落在安全区内', () => {
    const { view } = makeView();
    const high = runtime(carAt(150, 20, 124, 430), carAt(180, 390)); // 主体高度 > 裁切窗
    const f = step(view, high)!;
    expect(f.cropSafe.y).toBeGreaterThanOrEqual(0);
    expect(f.cropSafe.y + f.cropSafe.h).toBeLessThanOrEqual(SAFE.h + 1e-9);
  });
});

describe('F6｜横向：平滑跟随 + 双车恒在框内（必改 1 + 验收 3）', () => {
  it('横向平移有平滑滞后（不是硬跟），随后收敛到主体中心', () => {
    const { view } = makeView();
    const still = runtime(carAt(150), carAt(170));
    for (let i = 0; i < 40; i++) step(view, still);
    const x0 = view.adventureCameraFrame()!.cropSafe.x;

    const shifted = runtime(carAt(170), carAt(190)); // 双车整体右移 20 安全 px
    const x1 = step(view, shifted)!.cropSafe.x;
    expect(x1).toBeGreaterThan(x0); // 确实在跟随
    expect(x1 - x0).toBeLessThan(20); // 但没有瞬间贴上去（存在滞后）

    for (let i = 0; i < 90; i++) step(view, shifted);
    const f = view.adventureCameraFrame()!;
    const subjCenter = f.subjectSafe.x + f.subjectSafe.w / 2;
    expect(f.cropSafe.x + f.cropSafe.w / 2).toBeCloseTo(subjCenter, 0);
  });

  it('双车快速横向漂移（6 安全 px/帧）时裁切窗恒含双车（可见性硬约束优先于平滑）', () => {
    const { view } = makeView();
    let ax = 20;
    let bx = 160;
    const xs: number[] = [];
    for (let i = 0; i < 12; i++) {
      ax += 6;
      bx += 6;
      const a = carAt(ax);
      const b = carAt(bx);
      const f = step(view, runtime(a, b))!;
      // 双车都在安全区内 ⇒ 裁切窗必须完整框住两台车（不被平滑滞后切掉）
      const sa = toSafe(a);
      const sb = toSafe(b);
      if (!containsBox(f.cropSafe, a) || !containsBox(f.cropSafe, b)) {
        throw new Error(
          `i=${i} crop=${JSON.stringify(f.cropSafe)} z=${f.zoom} A=${JSON.stringify(sa)} B=${JSON.stringify(sb)} subj=${JSON.stringify(f.subjectSafe)}`,
        );
      }
      expect(f.cropSafe.x).toBeGreaterThanOrEqual(-1e-9);
      expect(f.cropSafe.x + f.cropSafe.w).toBeLessThanOrEqual(SAFE.w + 1e-9);
      xs.push(f.cropSafe.x);
    }
    // 取景窗确实跟着走（不是钉死在原地）
    expect(xs[xs.length - 1]).toBeGreaterThan(xs[0]);
  });
});

describe('F6｜RESULT 沿用最后稳定取景（必改 3：不突然缩回原比例）', () => {
  it('战报帧合成 scale == 战斗末帧 zoom ⇒ 主体像素尺寸不变（对照旧口径会缩到 1/zoom）', () => {
    const { view, take } = makeView();
    const rt = runtime(carAt(150, 390, 60, 60), carAt(210, 390, 60, 60));
    for (let i = 0; i < 90; i++) step(view, rt);
    const hold = view.adventureCameraHold()!;
    expect(hold.zoom).toBeGreaterThan(1.4);

    take();
    view.blitAdventureHold(ctxOf(view), RESULT_STAGE);
    const call = take()[0];
    const scale = call.dw / call.sw;
    expect(scale).toBeCloseTo(hold.zoom, 6); // 与战斗末帧同一 scale ⇒ 车辆像素不变
    expect(call.dw).toBeCloseTo(RESULT_STAGE.w, 6);
    expect(call.dh).toBeCloseTo(RESULT_STAGE.h, 6);
    expect(call.sh).toBeCloseTo(RESULT_STAGE.h / hold.zoom, 6); // 只裁纵向，不缩放
    // 源窗口必须落在末帧裁切窗内（不能取到窗口外的天空/地面）
    expect(call.sy).toBeGreaterThanOrEqual(XF.cropY + hold.cropSafe.y - 1e-6);
    expect(call.sy + call.sh).toBeLessThanOrEqual(XF.cropY + hold.cropSafe.y + hold.cropSafe.h + 1e-6);
    // 旧口径（scale=1）会把主体缩到 1/zoom = 31%~38%
    expect(1 / hold.zoom).toBeLessThan(0.7);
  });

  it('没有战斗帧时（?f4off=1 / ?d2zoom= 对照）退回历史 blitCover，行为不变', () => {
    const { view, take } = makeView();
    view.blitAdventureHold(ctxOf(view), RESULT_STAGE, 0.5);
    const c = take()[0];
    expect(c.dw / c.sw).toBeCloseTo(1, 10);
    expect(c.dh).toBeCloseTo(RESULT_STAGE.h, 10);
    expect(c.sh).toBeCloseTo(RESULT_STAGE.h, 10);
  });

  it('换战斗实例会清空沿用取景（不跨场互相污染）', () => {
    const { view } = makeView();
    const rt = runtime(carAt(150), carAt(170));
    for (let i = 0; i < 40; i++) step(view, rt);
    expect(view.adventureCameraHold()).not.toBeNull();
    view.resetAdventureCamera();
    expect(view.adventureCameraHold()).toBeNull();
    expect(view.adventureCameraFrame()).toBeNull();
  });
});

describe('F6｜边界与鲁棒性', () => {
  it('dt = 0 状态不变；dt = 1s（掉帧）被钳到 50ms，不甩镜头', () => {
    const { view } = makeView();
    const far = runtime(carAt(10), carAt(256));
    step(view, far);
    const z0 = view.adventureCameraFrame()!.zoom;
    expect(step(view, far, 0)!.zoom).toBeCloseTo(z0, 10);

    const close = runtime(carAt(150), carAt(170));
    const zJump = step(view, close, 1000)!.zoom;
    expect(Number.isFinite(zJump)).toBe(true);
    expect(zJump - z0).toBeLessThanOrEqual(2.2 * 0.05 + 1e-6);
  });

  it('无主体（车辆框退化）⇒ 解算为 null，合成退回原取景（不抛错）', () => {
    const { view, take } = makeView();
    const zero: Box = { minX: 100, minY: 100, maxX: 100, maxY: 100 };
    expect(step(view, runtime(zero, zero))).toBeNull();
    view.blitAdventureCamera(ctxOf(view), STAGE_BAND);
    const c = take()[0];
    expect(c.sw).toBeCloseTo(390, 10);
    expect(c.dw).toBeCloseTo(STAGE_BAND.w, 10);
  });

  it('zoom≈1 时合成与原取景逐像素一致（退化门槛 1.002）', () => {
    const { view, take } = makeView();
    step(view, runtime(carAt(-60, 390, 520, 60), carAt(0, 390, 1, 60)));
    view.blitAdventureCamera(ctxOf(view), STAGE_BAND);
    const a = take()[0];

    const second = makeView();
    second.view.blit(ctxOf(second.view), STAGE_BAND);
    const b = second.take()[0];
    expect(a).toEqual(b);
  });
});
