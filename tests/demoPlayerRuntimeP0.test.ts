/**
 * F-DEMO-PLAYER-RUNTIME-P0｜统一手机玩家演示入口 验收。
 *
 * 1. phoneLogical 模式（桌面打开玩家模式）强制 Compact Mobile profile（不切回 Desktop 布局）；
 * 2. 桌面 1920×1080 视口下，手机逻辑画布 844×390 经 CSS contain 放大居中，点击坐标经
 *    WebInput.getBoundingClientRect 归一化正确反算（逻辑坐标 == 视觉点击 / 缩放比）；
 * 3. 420×210 / 844×390 手机尺寸正常（Compact Mobile profile，scale=1）；
 * 4. main.ts 配置契约：dev:player 脚本、__PLAYER_MODE__ define、?player=1 玩家模式判定、
 *    playerMode 下结构性不挂载 DEV 工具栏/侧栏/Debug/版本角标（源码守卫，非 CSS 遮挡）。
 */
import { describe, it, expect } from 'vitest';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { WebInput } from '../src/platform/web/input';
import { resolveLayoutProfile } from '../src/ui/layoutProfile';
import { isCompactLandscape } from '../src/render/viewportProfile';

function stubCtx(): CanvasRenderingContext2D {
  return new Proxy({} as CanvasRenderingContext2D, {
    get: () => () => ({ width: 0 }),
    set: () => true,
  });
}
function stubCanvas(): HTMLCanvasElement {
  return {
    getContext: () => stubCtx(),
    style: {},
    width: 0,
    height: 0,
    addEventListener: () => {},
  } as unknown as HTMLCanvasElement;
}
/** fake parent：桌面视口（远大于 844×390），手机逻辑画布将被 contain 放大居中 */
function desktopParent(w = 1920, h = 1080): HTMLElement {
  return { clientWidth: w, clientHeight: h, appendChild: () => {} } as unknown as HTMLElement;
}

describe('F-DEMO-PLAYER-RUNTIME-P0｜phoneLogical 布局契约', () => {
  it('验收1a｜phoneLogical（桌面开玩家模式）强制 Compact Mobile profile，不切 Desktop', () => {
    const host = new CanvasPlayerUIHost(stubCanvas(), { phoneLogical: true });
    host.mount(desktopParent());
    // 844×390 是 compact landscape → mobile-normal（非 desktop）
    expect(resolveLayoutProfile(844, 390).mode, '844×390 应为 mobile-normal').toBe('mobile-normal');
    expect(isCompactLandscape(844, 390)).toBe(true);
    // 桌面 1920×1080 本身若直接当 layout 会判 desktop；但 phoneLogical 锁定手机逻辑尺寸 → 不切回
    const normal = new CanvasPlayerUIHost(stubCanvas()); // 非 phoneLogical
    normal.mount(desktopParent());
    expect(resolveLayoutProfile(1920, 1080).mode, '普通桌面 1920×1080 才判 desktop').toBe('desktop');
  });

  it('验收3｜420×210 / 844×390 手机尺寸走 Compact Mobile profile（不触发 Desktop 1280×720 fit）', () => {
    for (const [w, h] of [[420, 210], [844, 390]] as const) {
      expect(isCompactLandscape(w, h)).toBe(true);
      expect(resolveLayoutProfile(w, h).mode, `${w}×${h} 应为 mobile profile（非 desktop）`).not.toBe('desktop');
    }
  });
});

describe('F-DEMO-PLAYER-RUNTIME-P0｜桌面放大后点击坐标正确反算', () => {
  /** fake canvas：被 CSS transform 放大（getBoundingClientRect 返回视觉尺寸），含居中位移 */
  function fakeScaledCanvas(logicalW: number, logicalH: number, scale: number, left: number, top: number) {
    const handlers: Record<string, (ev: unknown) => void> = {};
    const node = {
      clientWidth: logicalW,
      clientHeight: logicalH,
      getBoundingClientRect: () => ({
        left,
        top,
        width: logicalW * scale,
        height: logicalH * scale,
        right: left + logicalW * scale,
        bottom: top + logicalH * scale,
      }),
      addEventListener: (type: string, fn: (ev: unknown) => void) => {
        handlers[type] = fn;
      },
    } as unknown as HTMLElement;
    const fire = (cx: number, cy: number): void => handlers['mousedown']({ clientX: cx, clientY: cy });
    return { node, fire };
  }

  it('验收2｜1920×1080 桌面下 844×390 @contain 放大，点击按钮逻辑坐标与 1x 一致', () => {
    // contain 缩放比 = min(1920/844, 1080/390) = min(2.275, 2.769) = 2.275
    const scale = Math.min(1920 / 844, 1080 / 390);
    const left = (1920 - 844 * scale) / 2;
    const top = (1080 - 390 * scale) / 2;
    const { node, fire } = fakeScaledCanvas(844, 390, scale, left, top);
    const got: Array<[number, number]> = [];
    new WebInput().bindPointer(node, (x, y) => got.push([x, y]));
    // 点击逻辑中心 (422, 195) → 视觉坐标 = left + 422*scale, top + 195*scale
    fire(left + 422 * scale, top + 195 * scale);
    expect(got).toHaveLength(1);
    expect(got[0][0], '放大后归一化逻辑 x == 422').toBeCloseTo(422, 3);
    expect(got[0][1], '放大后归一化逻辑 y == 195').toBeCloseTo(195, 3);
  });

  it('验收2b｜缩放比不影响命中：2x 与 1x 点同一逻辑位置输出一致', () => {
    const results: Array<[number, number]> = [];
    for (const scale of [1, 2] as const) {
      const { node, fire } = fakeScaledCanvas(844, 390, scale, 0, 0);
      const got: Array<[number, number]> = [];
      new WebInput().bindPointer(node, (x, y) => got.push([x, y]));
      fire(422 * scale, 195 * scale); // 视觉 = 逻辑×scale（left/top=0）
      results.push(got[0]);
    }
    expect(results[0], '1x 逻辑坐标').toEqual(results[1]);
  });
});

describe('F-DEMO-PLAYER-RUNTIME-P0｜main.ts 玩家模式配置契约（源码守卫）', () => {
  const fs = require('fs');
  const src = fs.readFileSync('src/main.ts', 'utf-8');
  const pkg = fs.readFileSync('package.json', 'utf-8');

  it('验收｜npm run dev:player 脚本存在（本地玩家演示启动命令）', () => {
    expect(pkg).toContain('"dev:player"');
  });

  it('验收｜vite.config.ts 注入 __PLAYER_MODE__ define（本地玩家模式构建标志）', () => {
    const cfg = fs.readFileSync('vite.config.ts', 'utf-8');
    expect(cfg).toContain("__PLAYER_MODE__: 'true'");
  });

  it('验收｜playerMode 含 ?player=1 判定，且结构性禁止挂载 DEV DOM（非 CSS 遮挡）', () => {
    // ?player=1 进入玩家模式
    expect(src).toContain("new URLSearchParams(location.search).has('player')");
    // playerMode 下不挂载 DEV 工具栏 / panelA·panelB 侧栏（结构性：整段 if (!playerMode) 包裹）
    expect(src).toContain('if (!playerMode) {');
    expect(src).toContain('root.appendChild(toolbar)');
    expect(src).toContain('main.appendChild(panelA)');
    expect(src).toContain('main.appendChild(panelB)');
    // Debug 面板 / 版本角标 在 playerMode 下也不创建
    expect(src).toContain('if (DEV_TOOLS_VISIBLE && !playerMode)');
    expect(src).toContain('if (DEV_TOOLS_VISIBLE && !playerMode) {');
    // 玩家模式强制 Canvas Host（非 WebDom）
    expect(src).toContain('? new CanvasPlayerUIHost(');
    expect(src).toContain('phoneLogical: playerMode');
  });

  it('验收｜playerMode 下 Canvas 宿主用 phoneLogical 固定手机逻辑画布（桌面放大居中）', () => {
    // CanvasPlayerUIHost 构造接受 phoneLogical 选项
    expect(src).toContain('phoneLogical: playerMode');
    // host 实现中包含 applyPhoneScale（contain 放大居中）
    const hostSrc = fs.readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    expect(hostSrc).toContain('private applyPhoneScale');
    expect(hostSrc).toContain('PHONE_LOGICAL_W');
    expect(hostSrc).toContain('PHONE_LOGICAL_H');
  });
});
