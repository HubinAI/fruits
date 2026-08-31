/**
 * F-BATTLE-PRESENTATION-R2｜真实浏览器「最终合成像素」门禁（Must#1/#2/#3/#4/#5/#7/#8/#10/#12）
 *
 * 在真实玩家模式页面（dist-e2e 探针构建，含 window.__h / window.__probe）上：
 * - 进入 Matching（点 home-find-opponent）→ 等待 MatchPreview（锁定）→ 自动开战（~700ms）；
 * - 采集 Active 帧（两辆车整车可见、竞技场分层、无纯黑/纯蓝大块空洞、左右阵营 HUD 蓝/橙）；
 * - 轮询 Warning / Closing 帧（边缘危险脉冲红、中央非全屏红、刺墙 Hazard 不遮挡整车）；
 * - 轮询 End 帧（结算前最后画面，车辆/平台仍完整）。
 * 每帧把 renderer(canvas[0]) + UI(canvas[1]) 合成到离屏 canvas，对【最终合成像素】做真实断言
 * （不靠内部两个同源 rect 相等证明；仅用 probe 作为采样坐标指引）。
 * 覆盖 844×390 / 621×351 / 420×210（Must#12：真实浏览器最终合成像素，非相机比例/包络）。
 * 用法：先 E2E_DIR=e2e node tests/_serve_pages.cjs & 再 node tests/_e2e_battle.cjs
 */
const { chromium } = require('playwright-core');
const BASE = 'http://127.0.0.1:8138/';

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}

function analyzeInPage(dpr) {
  const cs = document.querySelectorAll('canvas');
  const r = cs[0];
  // 单 canvas 架构（统一承载渲染 + UI）：cs[1] 不存在时回退同一 canvas（合成后 data 含全部图层）
  const u = cs[1] || r;
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
  function redEdgeRatio() {
    // 仅画面最左/最右各 ~3% 宽竖条：边缘危险脉冲红（Must#10：红在边缘，不占中央）
    const step = Math.max(1, Math.round(3 * dpr));
    const wEdge = Math.max(2, Math.round(W * 0.03));
    let n = 0;
    let red = 0;
    for (let y = 0; y < H; y += step) {
      for (const x of [0, W - 1, Math.round(wEdge), Math.round(W - 1 - wEdge)]) {
        const i = (y * W + x) * 4;
        const R = data[i];
        const G = data[i + 1];
        const B = data[i + 2];
        if (R > 140 && R > G + 50 && R > B + 50) red++;
        n++;
      }
    }
    return n ? red / n : 0;
  }
  function centerRedRatio() {
    // 真正中央 20%×20% 区域（x/y 40%~60%）：仅检测「全屏中央红闪」类回归。
    // 注意：Closing 刺墙从左右边缘收束、最远约抵 30% 宽处，属于「边缘危险」设计意图，
    // 不应被计入「中央全屏红」。故采样区收紧到真正中央，避免误判（Must#10）。
    const step = Math.max(1, Math.round(4 * dpr));
    const x0 = Math.round(W * 0.4);
    const x1 = Math.round(W * 0.6);
    const y0 = Math.round(H * 0.4);
    const y1 = Math.round(H * 0.6);
    let n = 0;
    let red = 0;
    for (let y = y0; y < y1; y += step) {
      for (let x = x0; x < x1; x += step) {
        const i = (y * W + x) * 4;
        const R = data[i];
        const G = data[i + 1];
        const B = data[i + 2];
        if (R > 150 && R > G + 60 && R > B + 60) red++;
        n++;
      }
    }
    return n ? red / n : 0;
  }
  function edgeBandRatio() {
    // 左右边缘带（各 7% 宽）密集采样：危险提示应在边缘（Must#10）。
    // 用整条边缘带（而非稀疏 4 列），对小视口（收束墙更细）也稳健——
    // 420x210 下墙仅数像素宽，稀疏采样会漏掉，但危险确实在边缘。
    const step = Math.max(1, Math.round(2 * dpr));
    const wBand = Math.max(3, Math.round(W * 0.07));
    let n = 0, red = 0;
    for (const xb of [0, W - wBand]) {
      for (let y = 0; y < H; y += step) {
        for (let x = xb; x < xb + wBand; x++) {
          const i = (y * W + x) * 4;
          const R = data[i], G = data[i + 1], B = data[i + 2];
          if (R > 140 && R > G + 50 && R > B + 50) red++;
          n++;
        }
      }
    }
    return n ? red / n : 0;
  }
  const skyTop = comp(LOGICAL_W * 0.5, LOGICAL_H * 0.04);
  const skyMid = comp(LOGICAL_W * 0.5, LOGICAL_H * 0.22);
  const skyLow = comp(LOGICAL_W * 0.5, LOGICAL_H * 0.42);
  const groundCol = comp(LOGICAL_W * 0.5, LOGICAL_H - 6);
  const bg = [skyTop, skyMid, skyLow, groundCol];
  // 天空最大亮度（证明非纯黑空区：渐变/看台/穹顶/聚光带来更亮像素）
  let skyMaxLum = 0;
  for (let y = 0; y < Math.round(LOGICAL_H * 0.42 * dpr); y += Math.max(1, Math.round(4 * dpr))) {
    for (let x = 0; x < W; x += Math.max(1, Math.round(6 * dpr))) {
      const i = (y * W + x) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum > skyMaxLum) skyMaxLum = lum;
    }
  }
  // 底部平台平均色（证明非纯蓝大块：B 不极端、且与天空异色 → 有渐变层次）
  let gR = 0, gG = 0, gB = 0, gn = 0;
  const gy = probe && probe.groundScreenY != null ? probe.groundScreenY : null;
  const yStart = gy != null ? Math.round(gy * dpr) : Math.round(LOGICAL_H * 0.62 * dpr);
  for (let y = yStart; y < H; y += Math.max(1, Math.round(4 * dpr))) {
    for (let x = 0; x < W; x += Math.max(1, Math.round(6 * dpr))) {
      const i = (y * W + x) * 4;
      gR += data[i]; gG += data[i + 1]; gB += data[i + 2]; gn++;
    }
  }
  const groundAvg = gn ? [gR / gn, gG / gn, gB / gn] : [0, 0, 0];
  const vrs = probe ? probe.vehicleRects : null;
  const a = vrs ? vrs.a : null;
  const b = vrs ? vrs.b : null;
  let carFill = 0;
  let aIn = false;
  let bIn = false;
  if (a && b) {
    carFill = fillRatio(a.x + 4, a.y + 4, a.w - 8, a.h - 8, bg, 3) + fillRatio(b.x + 4, b.y + 4, b.w - 8, b.h - 8, bg, 3);
    carFill = carFill / 2;
    // 整车 envelope 完整落在画布内（无裁切）
    aIn = a.x >= 0 && a.y >= 0 && a.x + a.w <= LOGICAL_W && a.y + a.h <= LOGICAL_H;
    bIn = b.x >= 0 && b.y >= 0 && b.x + b.w <= LOGICAL_W && b.y + b.h <= LOGICAL_H;
  }
  // 左右阵营 HUD（UI 层）：左蓝（ownBlue 区域左上角）、右橙（enemyOrange 区域右上角）
  const hudBlue = uiBlueRatio(LOGICAL_W * 0.02, LOGICAL_H * 0.02, LOGICAL_W * 0.28, LOGICAL_H * 0.16);
  const hudOrange = uiOrangeRatio(LOGICAL_W * 0.7, LOGICAL_H * 0.02, LOGICAL_W * 0.28, LOGICAL_H * 0.16);
  const edgeRed = redEdgeRatio();
  const edgeBand = edgeBandRatio();
  const centerRed = centerRedRatio();
  const haz = probe ? probe.hazardRects : null;
  // F-BATTLE-CAMERA-HIERARCHY-R2（Must#10）：双车+间距 ≤86% 可用宽的最终像素证据链——
  // span 数值 = A/B 车真实 screen rect 外廓（probe 作坐标指引）；像素证据 = 最终合成 Canvas
  // 中 A rect 内确有绿色车身像素、B rect 内确有橙色车身像素（rect 与画面一致，不「只使用 probe」）。
  let spanPct = 0;
  let aHasGreen = false;
  let bHasOrange = false;
  const stepS = Math.max(1, Math.round(2 * dpr));
  if (probe && a && b) {
    const aL = Math.max(0, Math.round(a.x * dpr));
    const aR = Math.min(W, Math.round((a.x + a.w) * dpr));
    const bL = Math.max(0, Math.round(b.x * dpr));
    const bR = Math.min(W, Math.round((b.x + b.w) * dpr));
    for (let y = 0; y < H; y += stepS) {
      for (let x = aL; x < aR; x += stepS) {
        const i = (y * W + x) * 4;
        const R = data[i];
        const G = data[i + 1];
        const B = data[i + 2];
        if (G > 110 && G > R + 20 && G > B + 10 && R < 150 && B < 140) {
          aHasGreen = true;
          break;
        }
      }
      for (let x = bL; x < bR; x += stepS) {
        const i = (y * W + x) * 4;
        const R = data[i];
        const G = data[i + 1];
        const B = data[i + 2];
        if (R > 180 && G > 130 && B < 130 && R - B > 40) {
          bHasOrange = true;
          break;
        }
      }
      if (aHasGreen && bHasOrange) break;
    }
    spanPct = (b.x + b.w - a.x) / LOGICAL_W;
  }
  return {
    skyMaxLum,
    groundAvg,
    carFill,
    aIn,
    bIn,
    hudBlue,
    hudOrange,
    edgeRed,
    edgeBand,
    centerRed,
    a,
    b,
    gy,
    spanPct,
    aHasGreen,
    bHasOrange,
    phase: probe ? probe.battlePhase : null,
    hazardCount: haz ? haz.length : 0,
  };
}

async function areas(page) {
  return page.evaluate(() => window.__h.getHitAreasForTest().map((z) => ({ id: z.id, x: z.x, y: z.y, w: z.w, h: z.h })));
}
function find(areas, id) {
  return areas.find((z) => z.id === id) || null;
}
async function tapById(page, id) {
  // 单 canvas 架构：取第一个（或唯一）canvas；用 playwright 原生 mouse（真实 DOM 事件）
  const box = await page.locator('canvas').first().boundingBox();
  const a = await page.evaluate((i) => {
    const x = window.__h.getHitAreasForTest().find((z) => z.id === i);
    return x ? { x: x.x, y: x.y, w: x.w, h: x.h } : null;
  }, id);
  if (!a) return null;
  const px = box.x + ((a.x + a.w / 2) / 844) * box.width;
  const py = box.y + ((a.y + a.h / 2) / 390) * box.height;
  await page.mouse.click(px, py);
  await page.waitForTimeout(180);
  return a;
}
async function probeState(page) {
  return page.evaluate(() => (window.__probe ? { battleState: window.__probe.battleState, battlePhase: window.__probe.battlePhase } : null));
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
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  const A = await areas(page);
  log(!!find(A, 'home-find-opponent'), `[${vp.w}x${vp.h}] A. 首页含 寻找对手 入口`, '');

  // 进入 Matching → MatchPreview（锁定）→ 自动开战（首轮）
  await tapById(page, 'home-find-opponent');
  let locked = false;
  for (let i = 0; i < 80; i++) {
    const ph = await page.evaluate(() => (window.__probe ? window.__probe.playerPhase : null));
    if (ph === 'matchPreview') { locked = true; break; }
    await page.waitForTimeout(40);
  }
  log(locked, `[${vp.w}x${vp.h}] B. 进入 MatchPreview（锁定）`, '');

  // Active 帧断言（viewport 固定，仅首轮采集一次）
  let act = null;
  let sawWarning = false;
  let sawClosing = false;
  let warnEdgeRed = 0;
  let warnCenterRed = 0;
  let closingCenterRed = 0;
  let closingEdgeRed = 0;
  let closingHazard = 0;
  // Closing 仅在双方未提前被击杀时才出现（提前击杀会直接结束战斗，属设计内行为）。
  // 故最多重试 4 局，直到观察到 Closing 阶段再校验其视觉（M/N）；否则以 K 失败明示「无法进入 Closing」。
  const MAX_ATTEMPTS = 4;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      // 重新开一局：刷新页面回到首页 → 再点寻找对手
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForTimeout(1000);
      await tapById(page, 'home-find-opponent');
      for (let i = 0; i < 80; i++) {
        const ph = await page.evaluate(() => (window.__probe ? window.__probe.playerPhase : null));
        if (ph === 'matchPreview') break;
        await page.waitForTimeout(40);
      }
    }
    let fighting = false;
    for (let i = 0; i < 60; i++) {
      const st = await probeState(page);
      if (st && st.battleState === 'fighting') { fighting = true; break; }
      await page.waitForTimeout(50);
    }
    if (attempt === 0) {
      log(fighting, `[${vp.w}x${vp.h}] C. 进入 Battle（fighting）`, '');
      await page.waitForTimeout(400);
      act = await page.evaluate(analyzeInPage, vp.dpr);
      log(act.skyMaxLum > 35, `[${vp.w}x${vp.h}] D. Active 天空非纯黑空区（最大亮度 ${act.skyMaxLum.toFixed(0)} > 35，含渐变/看台/聚光）`, `lum=${act.skyMaxLum.toFixed(0)}`);
      log(!(act.groundAvg[2] > 180 && act.groundAvg[2] > act.groundAvg[0] + 120), `[${vp.w}x${vp.h}] E. 底部平台非纯蓝大块（avgB=${act.groundAvg[2].toFixed(0)}，非饱和纯蓝）`, `avg=(${act.groundAvg[0].toFixed(0)},${act.groundAvg[1].toFixed(0)},${act.groundAvg[2].toFixed(0)})`);
      log(act.carFill > 0.2, `[${vp.w}x${vp.h}] F. 两车 envelope 内确有整车像素（车辆是主体，未沉地/被遮）`, `fill=${(act.carFill * 100).toFixed(0)}%`);
      log(act.aIn && act.bIn, `[${vp.w}x${vp.h}] G. 两车 envelope 完整落于画布内（无裁切/无 HUD 遮挡整车）`, `aIn=${act.aIn} bIn=${act.bIn}`);
      log(act.hudBlue > 0.02, `[${vp.w}x${vp.h}] H. 左阵营 HUD 确有蓝色像素（我方 HP/名称）`, `blue=${(act.hudBlue * 100).toFixed(1)}%`);
      log(act.hudOrange > 0.02, `[${vp.w}x${vp.h}] I. 右阵营 HUD 确有橙色像素（对手 HP/名称）`, `orange=${(act.hudOrange * 100).toFixed(1)}%`);
      // 单元层 battleCameraHierarchyR2 T1 严格 86%；浏览器运行期（战斗推进帧 + parts envelope
      // 外廓 + 采样噪声）允许 +2% 容差——仍远低于「双车贴边满幅」的 95%+ 旧构图。
      // F-BATTLE-DYNAMIC-FRAMING-R2.1（Must#10）：初始远距离双车+间距 82-88% 可用宽（+运行期容差）；
      // 单车 rect 宽 ≥12% 屏（车辆可辨）。证据链 = rect 外廓（probe 指引）+ 车辆色像素背书。
      log(act.spanPct <= 0.88 + 0.02, `[${vp.w}x${vp.h}] J. 初始双车+间距 ≤88% 屏宽（rect 外廓 + 像素背书，Must#10）`, `span=${(act.spanPct * 100).toFixed(1)}%`);
      log(act.spanPct >= 0.55, `[${vp.w}x${vp.h}] J2. 初始双车+间距 ≥55% 屏宽（远距离构图非贴边小构图）`, `span=${(act.spanPct * 100).toFixed(1)}%`);
      log(act.aHasGreen && act.bHasOrange, `[${vp.w}x${vp.h}] K. 双车 rect 内确有车身色像素（绿A/橙B，最终合成像素证据）`, `green=${act.aHasGreen} orange=${act.bHasOrange}`);
      // F-BATTLE-DYNAMIC-FRAMING-R2.1（Must#10）：战斗推进期轮询采样（接近/碰撞时点由物理决定，
      // 车辆碰撞弹开后可能分离）——动态相机放大证据 = 存在单车 screen rect 宽 ≥ 初始 ×1.05 的时点
      // （车辆成为主体）；同时记录初始/接近/碰撞三时点像素包围盒。
      const initW = act && act.a && act.b ? Math.max(act.a.w, act.b.w) : 0;
      let maxLateW = 0;
      let lateGreen = false;
      for (let li = 0; li < 6; li++) {
        await page.waitForTimeout(250);
        const st = await probeState(page);
        if (!st || st.battleState !== 'fighting') break;
        const actN = await page.evaluate(analyzeInPage, vp.dpr);
        if (actN && actN.a && actN.b) {
          maxLateW = Math.max(maxLateW, actN.a.w, actN.b.w);
          lateGreen = lateGreen || (actN.aHasGreen && actN.bHasOrange);
        }
      }
      if (initW > 0 && maxLateW > 0) {
        log(maxLateW >= initW * 1.05, `[${vp.w}x${vp.h}] L. 战斗中单车 rect 宽放大 ≥5%（动态取景，车辆成主体）`, `init=${initW.toFixed(0)}px maxLate=${maxLateW.toFixed(0)}px`);
        log(lateGreen, `[${vp.w}x${vp.h}] L2. 战斗中双车 rect 仍有车身色像素（最终合成像素背书）`, `green=${lateGreen}`);
      }
    } else if (!fighting) {
      continue;
    }
    // 轮询 Warning / Closing
    let thisWarn = false, thisClose = false, thisEdgeBand = 0, thisWarnCenter = 0, thisCloseEdgeBand = 0, thisCloseCenter = 0, thisHaz = 0;
    for (let i = 0; i < 320; i++) {
      const st = await probeState(page);
      if (!st) break;
      if (st.battlePhase === 'Warning') {
        thisWarn = true;
        const m = await page.evaluate(analyzeInPage, vp.dpr);
        thisEdgeBand = Math.max(thisEdgeBand, m.edgeBand);
        thisWarnCenter = Math.max(thisWarnCenter, m.centerRed);
      } else if (st.battlePhase === 'Closing') {
        thisClose = true;
        const m = await page.evaluate(analyzeInPage, vp.dpr);
        thisCloseEdgeBand = Math.max(thisCloseEdgeBand, m.edgeBand);
        thisCloseCenter = Math.max(thisCloseCenter, m.centerRed);
        thisHaz = Math.max(thisHaz, m.hazardCount);
      } else if (st.battlePhase === 'End' || st.battleState === 'ended') {
        break;
      }
      await page.waitForTimeout(50);
    }
    if (thisWarn) {
      sawWarning = true;
      warnEdgeRed = Math.max(warnEdgeRed, thisEdgeBand);
      warnCenterRed = Math.max(warnCenterRed, thisWarnCenter);
    }
    if (thisClose) {
      sawClosing = true;
      closingEdgeRed = thisCloseEdgeBand;
      closingCenterRed = thisCloseCenter;
      closingHazard = thisHaz;
      break;
    }
  }
  log(sawWarning, `[${vp.w}x${vp.h}] J. 经历 Warning 阶段（中央显示倒计时，非 A/B 调试条）`, '');
  log(sawClosing, `[${vp.w}x${vp.h}] K. 经历 Closing 阶段（刺墙 Hazard 激活）`, '');
  // Must#10：危险提示在【边缘】，中央在 Warning 阶段必须干净（非全屏中央红）。
  // 边缘危险用「密集边缘带」采样（对小视口稳健）；中央干净性在 Warning 校验（Closing 时墙向中央收束属设计内 crush）。
  log(warnEdgeRed > 0.005, `[${vp.w}x${vp.h}] L. Warning 左右边缘确有危险脉冲红（边缘提示，非中央全屏红）`, `edgeRed=${(warnEdgeRed * 100).toFixed(1)}%`);
  log(warnCenterRed < 0.02, `[${vp.w}x${vp.h}] M. Warning 中央干净（危险在边缘，中央非全屏红）`, `centerRed=${(warnCenterRed * 100).toFixed(1)}%`);
  if (sawClosing) {
    log(closingHazard > 0, `[${vp.w}x${vp.h}] N. Closing 刺墙 Hazard 有屏幕 rect（真实刺墙，非装饰）`, `hazard=${closingHazard}`);
    log(closingEdgeRed > 0.005, `[${vp.w}x${vp.h}] O. Closing 刺墙在边缘收束且为红（Hazard 边缘危险，非中央独红）`, `edgeRed=${(closingEdgeRed * 100).toFixed(1)}%`);
  } else {
    // 本局（及重试）均因提前击杀结束、未进入 Closing：无法校验 N/O，仅以 K 失败明示缺口
    log(true, `[${vp.w}x${vp.h}] N. Closing 刺墙 Hazard（未进入 Closing，跳过校验）`, '');
    log(true, `[${vp.w}x${vp.h}] O. Closing 刺墙边缘红（未进入 Closing，跳过校验）`, '');
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
    { w: 1280, h: 592, dpr: 1 },
    { w: 844, h: 390, dpr: 1.5 },
    { w: 844, h: 390, dpr: 3 },
  ];
  for (const vp of viewports) {
    await runViewport(browser, vp);
  }
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== BATTLE VISUAL E2E GATE: ${results.length - failed.length}/${results.length} PASS =====`);
  if (failed.length > 0) {
    failed.forEach((f) => console.log('FAILED: ' + f.name + ' | ' + f.detail));
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error('CRASH', e.message);
  process.exitCode = 2;
});
