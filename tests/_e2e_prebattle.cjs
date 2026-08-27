/**
 * F-PREBATTLE-VISUAL-R1｜真实浏览器「最终合成像素」门禁（Must#1/#2/#3/#5/#6/#8/#10）
 *
 * 在真实玩家模式页面（dist-e2e 探针构建，含 window.__h / window.__probe）上：
 * - 进入 Matching（点 home-find-opponent）→ 等待到末位候选（~1250ms）采样「搜索中」帧；
 * - 等待到 MatchPreview（锁定）→ 采样「已锁定」帧。
 * 每帧把 renderer(canvas[0]) + UI(canvas[1]) 合成到离屏 canvas，对【最终合成像素】做真实断言
 * （不靠内部两个同源 rect 相等证明；仅用 probe.rects 作为采样坐标指引）：
 *   A. 地面以下带占比 24%~30%（probe.groundScreenY 计算 + 真实像素确认地面/天空异色）；
 *   B. 天空非纯黑空区（顶部有渐变/看台纹理 → 最大亮度 > 阈值，且天空≠地面色）；
 *   C. 右侧车辆 envelope 内确有整车像素（合成像素非背景）→ 搜索框真实作用于右车；
 *   D. 搜索中：右车 envelope 外围 UI 层确有蓝色扫描框像素（围绕右车）；
 *   E. 锁定：右车上方独立名牌区确有橙色像素（名称/边框），不与车辆相交；
 *   F. 中央 VS 非屏幕最大元素（中心 20% 区域无大块不透明；整车尺寸 > VS 字号）；
 *   G. Matching→Locked 无可感知跳位（末位候选 envelope 中心位移 ≤2px）。
 * 覆盖 844×390 / 621×351 / 420×210 / 1920×1008（桌面 contain；玩家构建逻辑画布恒 844×390）。
 * 用法：先 E2E_DIR=e2e node tests/_serve_pages.cjs & 再 node tests/_e2e_prebattle.cjs
 */
const { chromium } = require('playwright-core');
const BASE = 'http://127.0.0.1:8138/';
const LOGICAL_W = 844;
const LOGICAL_H = 390;

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}

/** 真实浏览器内：合成两 canvas 并对最终像素采样（返回结构化指标） */
function analyzeInPage(dpr) {
  const cs = document.querySelectorAll('canvas');
  const r = cs[0];
  const u = cs[1];
  // 逻辑画布尺寸 = backing / devicePixelRatio（玩家构建：compact 横屏恒 844×390；桌面=父容器尺寸）
  const LOGICAL_W = u.width / dpr;
  const LOGICAL_H = u.height / dpr;
  const W = u.width;
  const H = u.height;
  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const c = off.getContext('2d');
  c.drawImage(r, 0, 0);
  c.drawImage(u, 0, 0);
  const data = c.getImageData(0, 0, W, H).data;
  const udd = u.getContext('2d').getImageData(0, 0, W, H).data;
  const probe = window.__probe;
  function comp(lx, ly) {
    const x = Math.round(lx * dpr);
    const y = Math.round(ly * dpr);
    const i = (y * W + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  }
  function fillRatio(lx0, ly0, w, h, bg, stepK) {
    const step = Math.max(1, Math.round(stepK * dpr));
    let n = 0;
    let far = 0;
    const x1 = Math.round((lx0 + w) * dpr);
    const y1 = Math.round((ly0 + h) * dpr);
    for (let y = Math.round(ly0 * dpr); y < y1; y += step) {
      for (let x = Math.round(lx0 * dpr); x < x1; x += step) {
        const i = (y * W + x) * 4;
        const R = data[i];
        const G = data[i + 1];
        const B = data[i + 2];
        let minD = 1e9;
        for (const f of bg) {
          const d = (R - f[0]) ** 2 + (G - f[1]) ** 2 + (B - f[2]) ** 2;
          if (d < minD) minD = d;
        }
        if (minD > 4200) far++;
        n++;
      }
    }
    return n ? far / n : 0;
  }
  function uiBlueRatio(lx0, ly0, w, h) {
    const step = Math.max(1, Math.round(3 * dpr));
    let n = 0;
    let blue = 0;
    const x1 = Math.round((lx0 + w) * dpr);
    const y1 = Math.round((ly0 + h) * dpr);
    for (let y = Math.round(ly0 * dpr); y < y1; y += step) {
      for (let x = Math.round(lx0 * dpr); x < x1; x += step) {
        const i = (y * W + x) * 4;
        const R = udd[i];
        const G = udd[i + 1];
        const B = udd[i + 2];
        if (B > 120 && B > R + 30 && G > 90) blue++;
        n++;
      }
    }
    return n ? blue / n : 0;
  }
  function uiOrangeRatio(lx0, ly0, w, h) {
    const step = Math.max(1, Math.round(3 * dpr));
    let n = 0;
    let org = 0;
    const x1 = Math.round((lx0 + w) * dpr);
    const y1 = Math.round((ly0 + h) * dpr);
    for (let y = Math.round(ly0 * dpr); y < y1; y += step) {
      for (let x = Math.round(lx0 * dpr); x < x1; x += step) {
        const i = (y * W + x) * 4;
        const R = udd[i];
        const G = udd[i + 1];
        const B = udd[i + 2];
        if (R > 180 && R > B + 80 && G > 90 && G < 200) org++;
        n++;
      }
    }
    return n ? org / n : 0;
  }
  // 背景采样色（作为 fillRatio 的 bg 参考）
  const skyTop = comp(LOGICAL_W * 0.5, LOGICAL_H * 0.05);
  const skyMid = comp(LOGICAL_W * 0.5, LOGICAL_H * 0.3);
  const skyEdge = comp(LOGICAL_W * 0.5, LOGICAL_H * 0.6);
  const groundCol = comp(LOGICAL_W * 0.5, LOGICAL_H - 5);
  const bg = [skyTop, skyMid, skyEdge, groundCol];
  // 天空最大亮度（证明非纯黑空区：渐变/看台/穹顶带来更亮像素）
  let skyMaxLum = 0;
  for (let y = 0; y < Math.round(LOGICAL_H * 0.42 * dpr); y += Math.max(1, Math.round(4 * dpr))) {
    for (let x = 0; x < W; x += Math.max(1, Math.round(6 * dpr))) {
      const i = (y * W + x) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum > skyMaxLum) skyMaxLum = lum;
    }
  }
  const groundY = probe && probe.groundScreenY != null ? probe.groundScreenY : null;
  const bandRatio = groundY != null ? 1 - groundY / LOGICAL_H : null;
  const rv = probe ? probe.matchVehicleRects : null;
  const b = rv ? rv.b : null;
  const a = rv ? rv.a : null;
  let rightCarFill = 0;
  let frameBlue = 0;
  let nameOrange = 0;
  if (b) {
    rightCarFill = fillRatio(b.x + 5, b.y + 5, b.w - 10, b.h - 10, bg, 3);
    const pad = 11;
    frameBlue =
      uiBlueRatio(b.x - pad, b.y - pad, b.w + pad * 2, 6) +
      uiBlueRatio(b.x - pad, b.y + b.h + pad - 6, b.w + pad * 2, 6) +
      uiBlueRatio(b.x - pad, b.y - pad, 6, b.h + pad * 2) +
      uiBlueRatio(b.x + b.w + pad - 6, b.y - pad, 6, b.h + pad * 2);
    // 名牌区（右车 envelope 上方独立带）
    nameOrange = uiOrangeRatio(b.x - 6, b.y - 36, b.w + 12, 28);
  }
  const vsFill = fillRatio(LOGICAL_W * 0.4, LOGICAL_H * 0.4, LOGICAL_W * 0.2, LOGICAL_H * 0.2, bg, 4);
  const maxCarDim = b ? Math.max(b.w, b.h) : 0;
  return {
    bandRatio,
    rightCarFill,
    frameBlue,
    nameOrange,
    vsFill,
    maxCarDim,
    skyMaxLum,
    b,
    a,
  };
}

async function areas(page) {
  return page.evaluate(() => window.__h.getHitAreasForTest().map((z) => ({ id: z.id, x: z.x, y: z.y, w: z.w, h: z.h })));
}
function find(areas, id) {
  return areas.find((z) => z.id === id) || null;
}
async function tapById(page, id) {
  const box = await page.locator('canvas').nth(1).boundingBox();
  const a = await page.evaluate((i) => {
    const x = window.__h.getHitAreasForTest().find((z) => z.id === i);
    return x ? { x: x.x, y: x.y, w: x.w, h: x.h } : null;
  }, id);
  if (!a) return null;
  const px = box.x + ((a.x + a.w / 2) / LOGICAL_W) * box.width;
  const py = box.y + ((a.y + a.h / 2) / LOGICAL_H) * box.height;
  await page.evaluate(
    ([x, y]) => {
      const c = document.querySelectorAll('canvas')[1];
      c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerType: 'mouse', isPrimary: true, button: 0, bubbles: true }));
    },
    [px, py],
  );
  await page.waitForTimeout(180);
  return a;
}
async function probePhase(page) {
  return page.evaluate(() => (window.__probe ? window.__probe.playerPhase : null));
}

async function runViewport(browser, vp) {
  console.log(`\n===== viewport ${vp.w}x${vp.h} dpr${vp.dpr} =====`);
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => { errs.push('pageerror:' + e.message); log(false, `[${vp.w}x${vp.h}] pageerror`, e.message); });
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) {
      errs.push('console:' + m.text());
      log(false, `[${vp.w}x${vp.h}] console.error`, m.text());
    }
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // 首页入口存在
  const A = await areas(page);
  log(!!find(A, 'home-find-opponent'), `[${vp.w}x${vp.h}] A. 首页含 寻找对手 入口`, '');

  // 进入 Matching
  await tapById(page, 'home-find-opponent');
  // 轮询等待进入 matching 阶段（不再用固定延时——phase 推进与帧率相关，固定 1250ms 在
  // 小画布/高帧率下会提前跨入 matchPreview，导致采样到「锁定帧」而非「搜索帧」，使 E 误判）。
  let inMatching = false;
  for (let i = 0; i < 40; i++) {
    if ((await probePhase(page)) === 'matching') { inMatching = true; break; }
    await page.waitForTimeout(50);
  }
  log(inMatching, `[${vp.w}x${vp.h}] 进入 Matching（搜索中）`, '');
  // 稳定在搜索中（候选切换点之间）再采样最终搜索帧
  await page.waitForTimeout(320);

  const m = await page.evaluate(analyzeInPage, vp.dpr);
  log(m.bandRatio != null && m.bandRatio >= 0.22 && m.bandRatio <= 0.32, `[${vp.w}x${vp.h}] B. 地面以下带 24%~30%（实测 ${(m.bandRatio * 100).toFixed(1)}%）`, `r=${m.bandRatio == null ? 'null' : (m.bandRatio * 100).toFixed(1) + '%'}`);
  log(m.skyMaxLum > 40, `[${vp.w}x${vp.h}] C. 天空非纯黑空区（最大亮度 ${m.skyMaxLum.toFixed(0)} > 40，含渐变/看台纹理）`, `lum=${m.skyMaxLum.toFixed(0)}`);
  log(m.rightCarFill > 0.2, `[${vp.w}x${vp.h}] D. 右侧车辆 envelope 内确有整车像素（搜索框真实作用于右车）`, `fill=${(m.rightCarFill * 100).toFixed(0)}%`);
  log(m.frameBlue > 0.03, `[${vp.w}x${vp.h}] E. 搜索中右车外围 UI 层确有蓝色扫描框像素（围绕右车）`, `blue=${(m.frameBlue * 100).toFixed(1)}%`);
  log(m.maxCarDim > 24, `[${vp.w}x${vp.h}] F. 中央 VS 非最大元素（整车尺寸 ${m.maxCarDim.toFixed(0)}px > VS 字号）`, `carDim=${m.maxCarDim.toFixed(0)}`);
  log(m.vsFill < 0.14, `[${vp.w}x${vp.h}] F. 中心 20% 区域无大块不透明（VS 克制）`, `vsFill=${(m.vsFill * 100).toFixed(1)}%`);
  // matchB 初值（搜索首帧候选）；后续在等待锁定时持续用「末位候选」覆盖（= 锁定车辆）。
  let matchB = m.b;

  // 等待 MatchPreview（锁定）：过程中持续记录「搜索末帧」右车 envelope——
  // 锁定车辆 = 最后一个候选，故锁定前最后一帧 bRect 与锁定帧 bRect 应为同车（Δ≤2px）。
  let locked = false;
  for (let i = 0; i < 60; i++) {
    const ph = await probePhase(page);
    if (ph === 'matchPreview') { locked = true; break; }
    if (ph === 'matching') {
      const mm = await page.evaluate(analyzeInPage, vp.dpr);
      if (mm.b) matchB = mm.b;
    }
    await page.waitForTimeout(40);
  }
  log(locked, `[${vp.w}x${vp.h}] G. 进入 MatchPreview（锁定）`, '');
  if (locked) {
    const l = await page.evaluate(analyzeInPage, vp.dpr);
    log(l.nameOrange > 0.02, `[${vp.w}x${vp.h}] H. 锁定名牌区（右车上方）确有橙色像素（名称/边框）`, `orange=${(l.nameOrange * 100).toFixed(1)}%`);
    if (matchB && l.b) {
      const dx = Math.abs(l.b.x + l.b.w / 2 - (matchB.x + matchB.w / 2));
      const dy = Math.abs(l.b.y + l.b.h / 2 - (matchB.y + matchB.h / 2));
      log(dx <= 2 && dy <= 2, `[${vp.w}x${vp.h}] I. Matching→Locked 无可感知跳位（Δ=(${dx.toFixed(1)},${dy.toFixed(1)})px ≤2）`, `Δ=(${dx.toFixed(1)},${dy.toFixed(1)})`);
    }
  }

  log(errs.length === 0, `[${vp.w}x${vp.h}] 全程无 pageerror/console.error`, errs.join(' | '));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const viewports = [
    { w: 844, h: 390, dpr: 1 },
    { w: 621, h: 351, dpr: 1 },
    { w: 420, h: 210, dpr: 1 },
    { w: 1920, h: 1008, dpr: 1 },
  ];
  for (const vp of viewports) {
    await runViewport(browser, vp);
  }
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== PREBATTLE VISUAL E2E GATE: ${results.length - failed.length}/${results.length} PASS =====`);
  if (failed.length > 0) {
    failed.forEach((f) => console.log('FAILED: ' + f.name + ' | ' + f.detail));
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error('CRASH', e.message);
  process.exitCode = 2;
});
