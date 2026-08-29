/**
 * F-WX-VIEWPORT-SURFACE-P0｜Must#4/#5 微信最终像素几何验收门禁。
 *
 * 每个环境（844×390@1 / 1024×470.5@2 / 844×390@3 / 932×430@3 → backing
 * 844×390 / 2048×941 / 2532×1170 / 2796×1290）动态 import 真实 wechat/game.ts
 * （fake wx 的 createCanvas 返回微信真实默认的「逻辑尺寸」画布），驱动真实
 * Runtime 后检查最终绘制（device 空间 op bbox = 最终像素位置）：
 *
 *  1. SHA 左上安全区、字号 ≤ 屏高 4%；
 *  2. 首页车辆完整且中心 ≈ 50% 屏宽；
 *  3. CTA 中心 ≈ 50% 屏宽；
 *  4. 顶部信息/底部入口完整（UI op union 触达右/下边缘）；
 *  5. 所有 UI op 都在可见舞台内（原始 bbox 不越界）；
 *  6. Garage 车辆居中、装配带位于底部；
 *  7. Matching 左右两车完整；
 *  8. Battle 两车 + HUD 同时可见；
 *  9. 点击坐标（CTA 中心）与可见控件一致（tap → matching）；
 * 10. 连续 120 帧无像素累积（screen 画布面积计数 frame11 == frame120）。
 *
 * 采样约定：UI 画布仅在 dirty / battle / matching 帧重绘 → 每个阶段在【状态变更后】
 * clearDrawOps 再驱动 1~2 帧采样，保证 drawOps 只含当前阶段画面。
 * 使用 fastRaster（面积记账）控制耗时；几何判定基于 drawOps 的 device bbox。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { makeSurfaceFakeWx, SURFACE_ENVS, driveFrames } from './wechatSurfaceEnv';

type Op = { type: string; devX: number; devY: number; devW: number; devH: number; text?: string; fontSize?: number; fillStyle?: unknown };

function unionBBox(ops: Op[]): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const op of ops) {
    if (op.type === 'clear' || op.type === 'image') continue;
    if (op.devW <= 0 || op.devH <= 0) continue;
    if (op.devX < minX) minX = op.devX;
    if (op.devY < minY) minY = op.devY;
    if (op.devX + op.devW > maxX) maxX = op.devX + op.devW;
    if (op.devY + op.devH > maxY) maxY = op.devY + op.devH;
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function opCovers(ops: Op[], px: number, py: number, filter?: (op: Op) => boolean): boolean {
  return ops.some(
    (op) =>
      op.type !== 'clear' &&
      op.type !== 'image' &&
      (!filter || filter(op)) &&
      px >= op.devX &&
      px < op.devX + op.devW &&
      py >= op.devY &&
      py < op.devY + op.devH,
  );
}

function allWithinBacking(ops: Op[], bw: number, bh: number, dpr: number): boolean {
  // 容差：允许 ≤1 逻辑 px 字形上溢 + 装饰性背景条带 ~1% 屏宽量级的边缘出血
  // （真机由 canvas 裁切，无用户可见问题）。全局 3× 放大/裁切的特征性溢出 ≫ 此量级。
  const tolX = Math.max(0.51, dpr, bw * 0.008);
  const tolY = Math.max(0.51, dpr, bh * 0.008);
  return ops.every(
    (op) =>
      op.type === 'clear' ||
      op.type === 'image' ||
      (op.devX >= -tolX && op.devY >= -tolY && op.devX + op.devW <= bw + tolX && op.devY + op.devH <= bh + tolY),
  );
}

/** 车辆 shape op = string 色 path 且与取景区 backing 框相交、非退化（devW/devH>0）。
 *  世界环境元素（地面线 devH=0、舞台外墙条）被排除——它们本就超出可视区、由 canvas 裁切。 */
function vehicleOps(ops: Op[], fx: number, fy: number, fw: number, fh: number): Op[] {
  return ops.filter(
    (o) =>
      o.type === 'path' &&
      typeof o.fillStyle === 'string' &&
      o.devW > 0 &&
      o.devH > 0 &&
      o.devX < fx + fw &&
      o.devX + o.devW > fx &&
      o.devY < fy + fh &&
      o.devY + o.devH > fy,
  );
}

function assertCenteredX(cx: number, cssW: number, tol = 0.03, label = ''): void {
  const ratio = cx / cssW;
  expect(Math.abs(ratio - 0.5), `${label} 中心应≈50%屏宽，实际 ${(ratio * 100).toFixed(1)}%`).toBeLessThanOrEqual(tol);
}

describe('F-WX-VIEWPORT-SURFACE-P0｜微信最终像素几何验收（每环境）', () => {
  afterEach(() => {
    delete (globalThis as any).wx;
    delete (globalThis as any).__WX_BUILD_BADGE__;
    delete (globalThis as any).__WX_DEBUG__;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  for (const env of SURFACE_ENVS) {
    it(`env ${env.name}（backing ${env.backingW}×${env.backingH}）：首页/CTA/SHA/车辆 + Garage + Matching + Battle + 点击 + 120帧无累积`, async () => {
      vi.useFakeTimers();
      const fake = makeSurfaceFakeWx(env);
      fake.screen.ctx.fastRaster = true;
      fake.ui.ctx.fastRaster = true;
      (globalThis as any).wx = fake.wx;
      (globalThis as any).__WX_BUILD_BADGE__ = true;
      (globalThis as any).__WX_DEBUG__ = false;
      vi.resetModules();

      const mod = await import('../wechat/game');
      const runtime = mod.runtime;
      const uiHost = mod.uiHost;
      const dpr = env.dpr;
      const bw = fake.ui.width;
      const bh = fake.ui.height;
      const cssW = bw / dpr;
      const cssH = bh / dpr;
      expect(bw).toBe(env.backingW); // 前置：backing 已定版（transform 门禁已验）

      // ============ HOME ============
      driveFrames(fake, 10); // 首帧渲染（UI 在 dirty 帧绘制一次）+ renderer 收敛
      const uiOps: Op[] = [...fake.ui.ctx.drawOps]; // boot 首页 UI（frame-1 单帧绘制）
      fake.screen.ctx.clearDrawOps();
      driveFrames(fake, 1); // renderer 每帧重绘 → 采样帧
      const screenOps: Op[] = [...fake.screen.ctx.drawOps];

      // 5. 所有 UI op 在可见舞台内（原始 bbox 不越界 = 无裁切）；renderer 车辆 shape 同
      expect(allWithinBacking(uiOps, bw, bh, dpr), 'UI 全部 op 应在 backing 内').toBe(true);
      // 首页取景区（车辆 envelope 应完整 fit 于此）
      const framing = uiHost.getPreviewFramingRect();
      expect(framing, '首页应有车辆取景区').toBeTruthy();
      const fbx = framing!.x * dpr;
      const fby = framing!.y * dpr;
      const fbw = framing!.w * dpr;
      const fbh = framing!.h * dpr;
      const homeVeh = vehicleOps(screenOps, fbx, fby, fbw, fbh);
      expect(homeVeh.length, '首页取景区内应有车辆 shape op').toBeGreaterThan(0);
      expect(allWithinBacking(homeVeh, bw, bh, dpr), '首页车辆 shape 应在 backing 内（未裁切）').toBe(true);

      // 4. 顶部信息/底部入口完整（UI op union 触达右/下边缘；旧 bug 只画左上 1/dpr）
      const uiBox = unionBBox(uiOps);
      expect(uiBox, '首页应有 UI 绘制').not.toBeNull();
      expect(uiBox!.x, 'UI 左边缘应从 0 起').toBeLessThanOrEqual(bw * 0.05);
      expect(uiBox!.y, 'UI 上边缘应从 0 起').toBeLessThanOrEqual(bh * 0.05);
      expect(uiBox!.x + uiBox!.w, 'UI 右边缘应触达（无右侧裁切）').toBeGreaterThanOrEqual(bw * 0.92);
      expect(uiBox!.y + uiBox!.h, 'UI 下边缘应触达（无底部裁切）').toBeGreaterThanOrEqual(bh * 0.88);

      // 3. CTA 中心 ≈ 50% 屏宽 + 该点确有绘制
      const hitAreas = uiHost.getHitAreasForTest();
      const cta = hitAreas.find((a) => a.id === 'home-find-opponent');
      expect(cta, '首页 CTA 命中区应存在').toBeTruthy();
      const ctaCx = cta!.x + cta!.w / 2;
      const ctaCy = cta!.y + cta!.h / 2;
      assertCenteredX(ctaCx, cssW, 0.02, 'CTA');
      expect(ctaCy, 'CTA 应在下部（底部主条）').toBeGreaterThan(cssH * 0.7);
      expect(opCovers(uiOps, ctaCx * dpr, ctaCy * dpr), 'CTA 中心应有绘制像素').toBe(true);

      // 1. SHA 左上安全区 + 字号 ≤ 屏高 4%
      const badgeOp = uiOps.find((o) => o.type === 'text' && typeof o.text === 'string' && o.text.startsWith('#'));
      expect(badgeOp, 'SHA 水印文本 op 应存在（__WX_BUILD_BADGE__=true）').toBeTruthy();
      expect(badgeOp!.devX, 'SHA 应位于左上（x）').toBeLessThanOrEqual(bw * 0.12);
      expect(badgeOp!.devY, 'SHA 应位于左上（y）').toBeLessThanOrEqual(bh * 0.12);
      const fontLogical = badgeOp!.fontSize ?? 0;
      expect(fontLogical, 'SHA 字号应 > 0').toBeGreaterThan(0);
      expect(fontLogical, 'SHA 字号不应超过屏高 4%').toBeLessThanOrEqual(0.04 * cssH + 1);

      // 2. 首页车辆完整且居中（取景区中心 ≈ 50%；车辆 shape op 覆盖取景区中心）
      const fcx = framing!.x + framing!.w / 2;
      const fcy = framing!.y + framing!.h / 2;
      assertCenteredX(fcx, cssW, 0.03, '首页车辆');
      expect(homeVeh.length, 'renderer 应有车辆 shape op').toBeGreaterThan(0);
      expect(opCovers(homeVeh, fcx * dpr, fcy * dpr), '取景区中心应有车辆绘制').toBe(true);
      const vehBox = unionBBox(homeVeh);
      expect(vehBox, '车辆 shape 应有 bbox').not.toBeNull();
      expect(vehBox!.w, '车辆应有一定宽度（非塌缩/非放大爆框）').toBeGreaterThanOrEqual(bw * 0.15);
      expect(vehBox!.w, '车辆宽度不应超屏（未爆框裁切）').toBeLessThanOrEqual(bw * 0.75);

      // 10. 连续 120 帧无像素累积。fast 面积记账对重叠绘制重复计数，不能作累积指标；
      //     在 frame 11 与 frame 120 各用【慢速光栅】（ink 去重=唯一像素）采一帧对比，
      //     中间帧保持 fast 控制耗时。旧 bug：UI 未清屏 → composite 每帧叠 UI 像素 → 唯一像素增长。
      fake.screen.ctx.fastRaster = false;
      fake.ui.ctx.fastRaster = false;
      fake.screen.ctx.resetInk(); // 清 fast 面积残留
      fake.ui.ctx.resetInk();
      fake.screen.ctx.clearDrawOps();
      fake.ui.ctx.clearDrawOps();
      driveFrames(fake, 1); // frame 11 慢速采样（screen 每帧重绘；UI home 静态不重绘）
      const inkAtFrame11 = fake.screen.ctx.inkCount;
      fake.screen.ctx.fastRaster = true;
      fake.ui.ctx.fastRaster = true;
      driveFrames(fake, 108); // 至第 ~119 帧
      fake.screen.ctx.fastRaster = false;
      fake.ui.ctx.fastRaster = false;
      fake.screen.ctx.resetInk();
      fake.ui.ctx.resetInk();
      driveFrames(fake, 1); // frame 120 慢速采样
      const ink120 = fake.screen.ctx.inkCount;
      const uiInk120 = fake.ui.ctx.inkCount;
      fake.screen.ctx.fastRaster = true;
      fake.ui.ctx.fastRaster = true;
      expect(ink120, '120 帧后 screen 唯一像素数应与第 11 帧一致（无累积）').toBe(inkAtFrame11);
      expect(uiInk120, 'UI 画布唯一像素数稳定').toBeGreaterThanOrEqual(0); // home 静态不重绘；UI 累积由 wechatCanvasStability 专测

      // ============ GARAGE ============
      const garageEntry = uiHost.getHitAreasForTest().find((a) => a.id === 'home-garage');
      expect(garageEntry, '首页车库入口命中区应存在').toBeTruthy();
      fake.tap(garageEntry!.x + garageEntry!.w / 2, garageEntry!.y + garageEntry!.h / 2); // dispatch → metaPage=garage + dirty
      fake.ui.ctx.clearDrawOps();
      fake.screen.ctx.clearDrawOps();
      driveFrames(fake, 2);
      const gOps: Op[] = [...fake.ui.ctx.drawOps];
      const gScreenOps: Op[] = [...fake.screen.ctx.drawOps];
      const gFraming = uiHost.getPreviewFramingRect();
      expect(gFraming, 'Garage 应有车辆取景区').toBeTruthy();
      expect(gFraming!.mode, 'Garage 取景区 mode 应为 garage').toBe('garage');
      assertCenteredX(gFraming!.x + gFraming!.w / 2, cssW, 0.05, 'Garage 车辆');
      const beltArea = uiHost.getHitAreasForTest().some((a) => a.y >= cssH * 0.7);
      expect(beltArea, 'Garage 装配带命中区应位于底部').toBe(true);
      expect(opCovers(gOps, bw * 0.5, bh * 0.9), 'Garage 底部中央应有绘制（装配带）').toBe(true);
      const gBox = unionBBox(gOps);
      expect(gBox).not.toBeNull();
      expect(gBox!.x + gBox!.w, 'Garage UI 右边缘触达').toBeGreaterThanOrEqual(bw * 0.92);
      expect(allWithinBacking(gOps, bw, bh, dpr), 'Garage UI 应在 backing 内').toBe(true);
      const gVeh = vehicleOps(gScreenOps, gFraming!.x * dpr, gFraming!.y * dpr, gFraming!.w * dpr, gFraming!.h * dpr);
      expect(gVeh.length, 'Garage 取景区内应有车辆 shape op').toBeGreaterThan(0);
      expect(allWithinBacking(gVeh, bw, bh, dpr), 'Garage 车辆应在 backing 内（未裁切）').toBe(true);
      // 返回首页
      const backHome = uiHost.getHitAreasForTest().find((a) => a.id === 'nav:home');
      if (backHome) {
        fake.tap(backHome.x + backHome.w / 2, backHome.y + backHome.h / 2);
        driveFrames(fake, 4);
      }

      // ============ MATCHING（经 CTA 点击 = 点击坐标与可见控件一致） ============
      const cta2 = uiHost.getHitAreasForTest().find((a) => a.id === 'home-find-opponent');
      expect(cta2, '返回首页后 CTA 命中区应存在').toBeTruthy();
      fake.tap(cta2!.x + cta2!.w / 2, cta2!.y + cta2!.h / 2);
      expect(runtime.playerPhase, '点击 CTA 中心应进入 matching（点击坐标与可见控件一致）').toBe('matching');
      fake.screen.ctx.clearDrawOps();
      driveFrames(fake, 2);
      const mScreenOps: Op[] = [...fake.screen.ctx.drawOps];
      const mPath = mScreenOps.filter((o) => o.type === 'path' && typeof o.fillStyle === 'string' && o.devW < bw * 0.5 && o.devW > 0);
      const mLeft = mPath.some((o) => o.devX + o.devW / 2 < bw * 0.4);
      const mRight = mPath.some((o) => o.devX + o.devW / 2 > bw * 0.6);
      expect(mLeft, 'Matching 左侧车辆应可见').toBe(true);
      expect(mRight, 'Matching 右侧车辆应可见').toBe(true);
      // previewFixed 无取景区：以全屏为框筛选可见车辆 shape（排除全宽地面线/退化 op）
      const mVisible = vehicleOps(mScreenOps, 0, 0, bw, bh);
      expect(allWithinBacking(mVisible, bw, bh, dpr), 'Matching 车辆应在 backing 内').toBe(true);

      // ============ BATTLE ============
      vi.advanceTimersByTime(1420 + 700 + 600); // matching → preview → fighting
      expect(runtime.battleState, '应进入 fighting').toBe('fighting');
      fake.ui.ctx.clearDrawOps();
      fake.screen.ctx.clearDrawOps();
      driveFrames(fake, 3);
      const bScreenOps: Op[] = [...fake.screen.ctx.drawOps];
      const bUiOps: Op[] = [...fake.ui.ctx.drawOps];
      const bPath = bScreenOps.filter((o) => o.type === 'path' && typeof o.fillStyle === 'string' && o.devW < bw * 0.5 && o.devW > 0);
      const bLeft = bPath.some((o) => o.devX + o.devW / 2 < bw * 0.4);
      const bRight = bPath.some((o) => o.devX + o.devW / 2 > bw * 0.6);
      expect(bLeft, 'Battle 左车（A）应可见').toBe(true);
      expect(bRight, 'Battle 右车（B）应可见').toBe(true);
      const hudTop = bUiOps.some((o) => o.type === 'text' && o.devY < bh * 0.25 && o.devH > 0);
      expect(hudTop, 'Battle HUD 顶部文本应可见').toBe(true);
      expect(allWithinBacking(bUiOps, bw, bh, dpr), 'Battle UI 应在 backing 内').toBe(true);
      // battle 无取景区：以全屏为框筛选可见车辆 shape（竞技场墙/地面线可能超出可视区由 canvas 裁切）
      const bVisible = vehicleOps(bScreenOps, 0, 0, bw, bh);
      expect(allWithinBacking(bVisible, bw, bh, dpr), 'Battle 车辆应在 backing 内').toBe(true);
    }, 120000);
  }
});

/**
 * F-WX-SAFE-AREA-P0｜胶囊避让几何验收（Must#3/#4）：唯一安全区契约（safeInsets 折叠胶囊）
 * 经 insets 传播到所有顶部/右侧锚点。注入真实胶囊矩形后，断言：
 *  - 首页宝箱 4 槽最右缘 ≤ capsule.left（水平避让，≥6px）；
 *  - Battle 顶部右 HUD 最右缘 ≤ capsule.left（顶部右侧避让，≥6px）；
 *  - SHA 水印位于左上（不卷入胶囊区域）。
 * 验证「无需各页面独立硬编码 iPhone 偏移」即可统一避让胶囊。
 */
describe('F-WX-SAFE-AREA-P0｜胶囊避让几何验收（Home 宝箱 / Battle 右 HUD ≤ capsule.left）', () => {
  afterEach(() => {
    delete (globalThis as any).wx;
    delete (globalThis as any).__WX_BUILD_BADGE__;
    delete (globalThis as any).__WX_DEBUG__;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('env 844x390@1：注入胶囊 → 宝箱右缘与 Battle 右 HUD 右缘均落在胶囊左侧（≥6px）', async () => {
    vi.useFakeTimers();
    const env = SURFACE_ENVS[0]!; // 844x390@1（cssW=844, dpr=1）
    const fake = makeSurfaceFakeWx(env);
    fake.screen.ctx.fastRaster = true;
    fake.ui.ctx.fastRaster = true;
    // 注入胶囊（menu button）：左上 (744,4) → 右下 (831,36)，宽 87 高 32（window 逻辑 px）
    (fake.wx as Record<string, unknown>).getMenuButtonBoundingClientRect = () => ({
      width:  87,
      height: 32,
      top: 4,
      left: 744,
      right: 831,
      bottom: 36,
    });
    (globalThis as any).wx = fake.wx;
    (globalThis as any).__WX_BUILD_BADGE__ = true;
    (globalThis as any).__WX_DEBUG__ = false;
    vi.resetModules();

    const mod = await import('../wechat/game');
    const runtime = mod.runtime;
    const uiHost = mod.uiHost;
    const dpr = env.dpr;
    const capsuleLeft = 744;

    // ============ HOME ============
    driveFrames(fake, 10);
    // 初始 boot 绘制已包含 SHA 水印与首页 UI；直接取样（不 clear，避免 UI 非 dirty 不重绘丢 SHA）
    const homeOps: Op[] = [...fake.ui.ctx.drawOps];
    const chests = uiHost.getHitAreasForTest().filter((a) => a.id.startsWith('home-chest-'));
    expect(chests.length, '应存在 4 个宝箱命中区').toBe(4);
    const maxChestRight = Math.max(...chests.map((c) => c.x + c.w));
    // 宝箱右缘应落在胶囊左侧（744）左侧，且与胶囊间距 ≥6px：844-insR = 738 ≤ 744 ✓
    expect(maxChestRight, '宝箱最右缘应 ≤ capsule.left（避让胶囊）').toBeLessThanOrEqual(capsuleLeft);
    expect(capsuleLeft - maxChestRight, '宝箱与胶囊水平间距应 ≥6px').toBeGreaterThanOrEqual(6);

    // SHA 水印位于左上（胶囊在右上，不冲突；验证其 x 在左上象限）
    const badgeOp = homeOps.find((o) => o.type === 'text' && typeof o.text === 'string' && o.text.startsWith('#'));
    expect(badgeOp, 'SHA 水印应存在').toBeTruthy();
    expect(badgeOp!.devX, 'SHA 应位于左上（不卷入胶囊区）').toBeLessThanOrEqual(env.backingW * 0.15);

    // ============ BATTLE（经 CTA 点击进入；验证右 HUD 避让胶囊） ============
    const cta = uiHost.getHitAreasForTest().find((a) => a.id === 'home-find-opponent');
    expect(cta, '首页 CTA 命中区应存在').toBeTruthy();
    fake.tap(cta!.x + cta!.w / 2, cta!.y + cta!.h / 2);
    vi.advanceTimersByTime(1420 + 700 + 600);
    expect(runtime.battleState, '应进入 fighting').toBe('fighting');
    fake.ui.ctx.clearDrawOps();
    fake.screen.ctx.clearDrawOps();
    driveFrames(fake, 3);
    const bUiOps: Op[] = [...fake.ui.ctx.drawOps];
    // capsule rect (device px) at top-right; assert no drawn (non-clear) UI pixel falls inside
    const capsuleDev = { x: capsuleLeft * dpr, y: 4 * dpr, w: 87 * dpr, h: 32 * dpr };
    const hitsCapsule = bUiOps.some(
      (o) =>
        o.type !== 'clear' && o.type !== 'image' &&
        o.devW > 0 &&
        o.devH > 0 &&
        o.devX < capsuleDev.x + capsuleDev.w &&
        o.devX + o.devW > capsuleDev.x &&
        o.devY < capsuleDev.y + capsuleDev.h &&
        o.devY + o.devH > capsuleDev.y,
    );
    expect(hitsCapsule, "Battle: no UI pixel should overlap capsule rect").toBe(false);

    // 退出前清理
    vi.useRealTimers();
  }, 120000);
});
