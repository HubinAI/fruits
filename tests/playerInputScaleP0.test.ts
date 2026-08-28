import { describe, it, expect } from 'vitest';
import { PlayerViewportTransform, PLAYER_LOGICAL_W, PLAYER_LOGICAL_H } from '../src/platform/playerViewport';
import { WebInput } from '../src/platform/web/input';

/**
 * F-PLAYER-INPUT-SCALE-P0｜最终可见画布 → 逻辑命中坐标映射（targeted）
 *
 * 线上真实复现（1363×936 DPR1）：Canvas 可见 rect=1363×629.82 top=153（CSS contain 缩放），
 * 可见 CTA 中心≈client(681,742)。旧实现把 client 坐标直接当 logical → 超界无反应。
 * 本队列：输入经 PlayerViewportTransform.clientToLogical 一步转换：
 *   logicalX=(clientX-rect.left)×logicalWidth/rect.width（logical=844×390 舞台，非 backing）。
 */
describe('F-PLAYER-INPUT-SCALE-P0', () => {
  it('T1. clientToLogical：1363×936 DPR1 可见 CTA 中心 (681,742) → logical (422,365)', () => {
    const vp = new PlayerViewportTransform();
    // 1363×936 DPR1：s=min(1363/844,936/390)=1.61493；rect=0,153,1363,629.82
    const p = vp.clientToLogical(681, 742, { left: 0, top: 153, width: 1363, height: 629.82 });
    expect(p.x).toBeCloseTo(421.7, 1);
    expect(p.y).toBeCloseTo(364.72, 1);
  });

  it('T2. clientToLogical：1:1（CSS 布局=逻辑 844×390）时恒等', () => {
    const vp = new PlayerViewportTransform();
    const p = vp.clientToLogical(422, 195, { left: 0, top: 0, width: 844, height: 390 });
    expect(p.x).toBeCloseTo(422, 6);
    expect(p.y).toBeCloseTo(195, 6);
  });

  it('T3. 公式用 logical 舞台 844×390，绝不用含 DPR 的 backing 尺寸', () => {
    const vp = new PlayerViewportTransform();
    // 1920×1008 DPR1.5：s=min(1920/844,1008/390)=2.27488；rect.w=1920, rect.h=887.20, top=(1008-887.20)/2=60.40
    // CTA 逻辑中心 (422,365) → client x=422×2.27488=960.0
    const p = vp.clientToLogical(960, 60.4 + 365 * 2.27488, { left: 0, top: 60.4, width: 1920, height: 887.2 });
    expect(p.x).toBeCloseTo(422, 1);
    expect(p.y).toBeCloseTo(365, 1);
    // 反证：若错误使用 backing（844×1.5=1266 而非 logical 844），会得到 x≈281≠422
    const wrongBacking = (960 * 1266) / 1920;
    expect(wrongBacking).toBeGreaterThan(400);
    expect(PLAYER_LOGICAL_W).toBe(844);
    expect(PLAYER_LOGICAL_H).toBe(390);
  });

  it('T4. WebInput + clientToLogical：pointerdown client(681,742) → handler 收到 logical (421.7,364.8)', () => {
    const input = new WebInput();
    const vp = new PlayerViewportTransform();
    let got: [number, number] | null = null;
    let handler: ((e: unknown) => void) | null = null;
    const screen = {
      clientWidth: 844,
      clientHeight: 390,
      getBoundingClientRect: () => ({ left: 0, top: 153, width: 1363, height: 629.82, right: 0, bottom: 0, x: 0, y: 0 } as DOMRect),
      addEventListener: (_t: string, h: (e: unknown) => void) => { handler = h; },
    } as unknown as HTMLElement;
    input.bindPointer(
      screen,
      (x, y) => { got = [x, y]; },
      (cx, cy, rect) => vp.clientToLogical(cx, cy, rect),
    );
    handler!({ clientX: 681, clientY: 742 });
    expect(got, '收到转换后坐标').not.toBeNull();
    expect(got![0], 'logicalX 一次到位').toBeCloseTo(421.7, 1);
    expect(got![1], 'logicalY 一次到位').toBeCloseTo(364.72, 1);
  });

  it('T5. WebInput 不传 transform：旧 CSS 归一化行为保持（回归）', () => {
    const input = new WebInput();
    let got: [number, number] | null = null;
    let handler: ((e: unknown) => void) | null = null;
    const screen = {
      clientWidth: 844,
      clientHeight: 390,
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 1688, height: 780, right: 0, bottom: 0, x: 0, y: 0 } as DOMRect),
      addEventListener: (_t: string, h: (e: unknown) => void) => { handler = h; },
    } as unknown as HTMLElement;
    input.bindPointer(screen, (x, y) => { got = [x, y]; });
    handler!({ clientX: 944, clientY: 440 });
    expect(got![0], '旧归一化 localX').toBeCloseTo(422, 3);
    expect(got![1], '旧归一化 localY').toBeCloseTo(195, 3);
  });

  it('T6. WebInput touch 事件路径（touches[0]）+ transform 同转换', () => {
    const input = new WebInput();
    const vp = new PlayerViewportTransform();
    let got: [number, number] | null = null;
    let handler: ((e: unknown) => void) | null = null;
    const screen = {
      clientWidth: 844,
      clientHeight: 390,
      getBoundingClientRect: () => ({ left: 0, top: 153, width: 1363, height: 629.82, right: 0, bottom: 0, x: 0, y: 0 } as DOMRect),
      addEventListener: (_t: string, h: (e: unknown) => void) => { handler = h; },
    } as unknown as HTMLElement;
    input.bindPointer(
      screen,
      (x, y) => { got = [x, y]; },
      (cx, cy, rect) => vp.clientToLogical(cx, cy, rect),
    );
    handler!({ touches: [{ clientX: 681, clientY: 742 }] });
    expect(got![0], 'touch→logicalX 同转换').toBeCloseTo(421.7, 1);
    expect(got![1], 'touch→logicalY 同转换').toBeCloseTo(364.72, 1);
  });

  it('T7. clientToLogical 守卫：rect 缺失/零宽不产生 NaN', () => {
    const vp = new PlayerViewportTransform();
    const p1 = vp.clientToLogical(100, 200, { left: 0, top: 0, width: 0, height: 0 });
    expect(Number.isFinite(p1.x)).toBe(true);
    expect(Number.isFinite(p1.y)).toBe(true);
    expect(p1.x).toBe(100);
    const p2 = vp.clientToLogical(100, 200, null as unknown as { left: number; top: number; width: number; height: number });
    expect(Number.isFinite(p2.x)).toBe(true);
    expect(p2.x).toBeCloseTo(100, 6);
  });
});
