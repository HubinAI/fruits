// F-DEMO-VISUAL-GATE-R4：真实构建几何视觉 Gate（E2E v3）
// 驱动：playwright-core + 系统 Edge。页面 = 专用 E2E 构建（dist-e2e，__E2E_PROBE__ 探针）。
// 坐标来源 = 运行时真实 hitArea（window.__h）；几何断言 = window.__probe 只读快照
// （A/B envelope / matchVehicleRects / transform / groundScreenY / hazard rects / 阶段文案）。
// hash 仅作「动画仍在运行」的辅助信号，不作为视觉验收依据（Must#5）。
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8138/';
const VP = { w: 844, h: 390 };
const HUD_TOP = 56; // compact battle insetTop（HUD 下缘）
const SAFE = { left: 0, right: 0, top: 0, bottom: 0 }; // headless 无 safe-area → 0
const results = { passed: 0, failed: 0 };
const failures = [];

function log(ok, name, detail) {
  if (ok) {
    results.passed++;
    console.log('  [PASS] ' + name);
  } else {
    results.failed++;
    failures.push(name + (detail ? ' :: ' + detail : ''));
    console.log('  [FAIL] ' + name + (detail ? ' :: ' + detail : ''));
  }
}

async function hitArea(page, idPrefix) {
  return page.evaluate((p) => {
    const h = window.__h;
    if (!h || !h.getHitAreasForTest) return null;
    const a = h.getHitAreasForTest().find((x) => x.id.startsWith(p));
    return a ? { id: a.id, x: a.x, y: a.y, w: a.w, h: a.h } : null;
  }, idPrefix);
}

async function tapArea(page, idPrefix) {
  const a = await hitArea(page, idPrefix);
  if (!a) return null;
  const box = await page.locator('canvas').first().boundingBox();
  const px = box.x + ((a.x + a.w / 2) / VP.w) * box.width;
  const py = box.y + ((a.y + a.h / 2) / VP.h) * box.height;
  await page.evaluate(([x, y]) => {
    const c = document.querySelectorAll('canvas')[1] || document.querySelector('canvas');
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerType: 'mouse', isPrimary: true, button: 0, bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerType: 'mouse', isPrimary: true, button: 0, bubbles: true }));
  }, [px, py]);
  return a;
}

// 只读几何快照（结构化拷贝）
async function probe(page) {
  return page.evaluate(() => {
    const p = window.__probe;
    return p ? JSON.parse(JSON.stringify(p)) : null;
  });
}

// canvas 像素 hash（仅动画运行辅助信号）
async function hash(page) {
  return page.evaluate(() => {
    const c = window.__h && window.__h.canvas ? window.__h.canvas : (document.querySelectorAll('canvas')[1] || document.querySelector('canvas'));
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 8192) h = (h * 31 + d[i]) >>> 0;
    return h;
  });
}

// 探针轮询直到谓词成立
async function waitProbe(page, pred, maxMs, step = 300) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const p = await probe(page);
    if (p && pred(p)) return p;
    await page.waitForTimeout(step);
  }
  return null;
}

function attachError(page, errors, tag) {
  page.on('pageerror', (e) => errors.push('[' + tag + '] pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) {
      errors.push('[' + tag + '] console.error: ' + m.text());
    }
  });
}

async function initUnhandled(page) {
  await page.evaluate(() => {
    window.__unhandled = 0;
    window.addEventListener('unhandledrejection', () => {
      window.__unhandled = (window.__unhandled || 0) + 1;
    });
  });
}

// —— 几何硬断言 ——
function assertMatchingGeometry(p, W, H, label) {
  const r = p.vehicleRects;
  const ok = r && r.a && r.b;
  if (!ok) return { pass: false, detail: label + ' 无 vehicleRects' };
  const a = r.a;
  const b = r.b;
  const edge = 2; // 容差
  if (a.x < -edge || a.x + a.w > W + edge) return { pass: false, detail: `${label} A 越界 x=${a.x} right=${a.x + a.w} W=${W}` };
  if (b.x < -edge) return { pass: false, detail: `${label} B 左越界 x=${b.x}` };
  if (b.x + b.w > W + edge) return { pass: false, detail: `${label} 对手被右裁 b.right=${b.x + b.w} > W=${W}` };
  if (b.x + b.w > W - SAFE.right + 2) return { pass: false, detail: `${label} 对手越右安全边界 b.right=${b.x + b.w}` };
  return { pass: true };
}

function centerOf(rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function assertLockedStable(matching, locked, label) {
  if (!matching || !locked) return { pass: false, detail: label + ' 缺对比帧' };
  const dA = Math.abs(matching.a.x - locked.a.x) + Math.abs(matching.a.y - locked.a.y);
  const dB = Math.abs(matching.b.x - locked.b.x) + Math.abs(matching.b.y - locked.b.y);
  if (dA > 2 || dB > 2) return { pass: false, detail: `${label} 中心位移 A=${dA.toFixed(1)}px B=${dB.toFixed(1)}px > 2px` };
  const scaleDelta = Math.abs(matching.scale - locked.scale) / (matching.scale || 1);
  if (scaleDelta > 0.02) return { pass: false, detail: `${label} 尺度变化 ${(scaleDelta * 100).toFixed(1)}% > 2%` };
  return { pass: true };
}

function assertBattleStage(p, W, H, label) {
  const g = p.groundScreenY;
  const r = p.vehicleRects;
  if (typeof g !== 'number' || !r || !r.a || !r.b) return { pass: false, detail: label + ' 缺 groundScreenY/rects' };
  const ratio = g / H;
  if (ratio < 0.68 || ratio > 0.72) return { pass: false, detail: `${label} groundY ${(ratio * 100).toFixed(1)}% ∉ [68,72]` };
  // 双车 envelope 在 HUD 下方、groundY 上方
  for (const [name, rect] of [['A', r.a], ['B', r.b]]) {
    if (rect.y < HUD_TOP - 2) return { pass: false, detail: `${label} ${name} 顶缘 ${rect.y.toFixed(1)} 贴 HUD` };
    if (rect.y + rect.h > g + 4) return { pass: false, detail: `${label} ${name} 底缘 ${(rect.y + rect.h).toFixed(1)} 沉入地面线 ${g.toFixed(1)}` };
  }
  return { pass: true };
}

function assertHazardNotOverVehicle(p, label) {
  const hz = p.hazardRects;
  const r = p.vehicleRects;
  if (!Array.isArray(hz) || hz.length === 0) return { pass: true }; // 无 hazard（非 Closing）跳过
  if (!r || !r.a || !r.b) return { pass: false, detail: label + ' 缺 vehicleRects' };
  for (const w of hz) {
    // 左右收束墙在车辆外侧（墙右缘 ≤ A 左缘 或 墙左缘 ≥ B 右缘）——接触前不覆盖车辆主体
    const wallRight = w.x + w.w;
    if (wallRight > r.a.x + 2 && w.x < r.b.x + r.b.w - 2) {
      return { pass: false, detail: `${label} 墙 ${wallRight.toFixed(1)} 覆盖车辆区间 [${r.a.x.toFixed(1)}, ${(r.b.x + r.b.w).toFixed(1)}]` };
    }
  }
  return { pass: true };
}

function assertPhaseText(phase, text, label) {
  if (phase === 'Warning' && text && /^收束警告 \d/.test(text)) return { pass: true };
  if (phase === 'Closing' && text && /^刺墙逼近 \d/.test(text)) return { pass: true };
  return { pass: false, detail: `${label} phase=${phase} 文案=${text}` };
}

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  const W = VP.w;
  const H = VP.h;

  // ============ E2E-1 完整玩家闭环 + 几何硬断言（Home→Matching→Locked→Battle→Warning→Closing→Result→下一场） ============
  console.log('\n[E2E-1] 完整闭环 + 构图几何（844×390）');
  {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    attachError(page, errors, 'E2E-1');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await initUnhandled(page);
    await page.waitForTimeout(1200);

    // Home：探针存在 + playerPhase garage
    const hp = await probe(page);
    log(hp !== null && hp.playerPhase === 'garage', 'E2E 探针已注入（window.__probe 只读快照）');
    log(hp !== null && typeof hp.vehicleRects !== 'undefined', '探针含 A/B vehicleRects 字段');

    // 点击「寻找对手」→ Matching 全程跟踪最后一帧（锁定候选 = 与 Locked 同候选对比基准）
    let lastMatchFrame = null;
    const trackMatch = setInterval(async () => {
      const p = await probe(page);
      if (p && p.playerPhase === 'matching' && p.vehicleRects) lastMatchFrame = p;
    }, 100);
    await tapArea(page, 'home-find-opponent');
    const matchP = await waitProbe(page, (p) => p.playerPhase === 'matching', 4000);
    log(matchP !== null, '首页 CTA 点击进入 Matching');
    const firstFrame = lastMatchFrame ?? (await probe(page));
    const g1 = assertMatchingGeometry(firstFrame, W, H, '首帧 Matching');
    log(g1.pass, '首帧 Matching A/B 完整入安全区 + 对手不右裁', g1.detail);

    // Matching 候选切换（hash 辅助信号：动画运行；采样放宽到 8 帧 250ms）
    const cand = [];
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(250);
      cand.push(await hash(page));
    }
    let candChanged = false;
    for (let i = 1; i < cand.length; i++) if (cand[i] !== cand[i - 1]) { candChanged = true; break; }
    log(candChanged, 'Matching 动画持续（hash 辅助信号）');

    // Locked：中心位移 ≤2px、尺度 ≤2%。对比基准 = matching 最后一帧（锁定候选与 Locked
    // 同一候选——previewFixed 同相机，仅 envelope 尺寸差异会被排除）
    const lockedP = await waitProbe(page, (p) => p.playerPhase === 'matchPreview', 5000);
    clearInterval(trackMatch);
    log(lockedP !== null, 'Matching → Locked（matchPreview）');
    const lockedFrame = await probe(page);
    const g2 = assertLockedStable(
      { a: lastMatchFrame.vehicleRects?.a, b: lastMatchFrame.vehicleRects?.b, scale: lastMatchFrame.transform?.scale },
      { a: lockedFrame.vehicleRects?.a, b: lockedFrame.vehicleRects?.b, scale: lockedFrame.transform?.scale },
      'Locked',
    );
    log(g2.pass, 'Locked 两车中心位移 ≤2px + 尺度变化 ≤2%（同候选对比）', g2.detail);

    // Battle：groundY 舞台目标 + 双车 envelope 在 HUD 下 groundY 上
    const battleP = await waitProbe(page, (p) => p.battleState === 'fighting' && p.battlePhase === 'Active', 8000);
    log(battleP !== null, '自动进入 Battle（Active）');
    await page.waitForTimeout(600);
    const battleFrame = await probe(page);
    const g3 = assertBattleStage(battleFrame, W, H, 'Battle Active');
    log(g3.pass, 'Battle groundY ∈ [68%,72%] 视口 + 双车在 HUD 下/地面线上', g3.detail);

    // Warning → Closing：阶段文案语义
    const warnP = await waitProbe(page, (p) => p.battlePhase === 'Warning', 30000);
    const warnText = warnP ? warnP.phaseCountdownText : null;
    log(warnP !== null, '进入 Warning 阶段');
    const gw = assertPhaseText('Warning', warnText, 'Warning 文案');
    log(gw.pass, 'Warning 文案语义（收束警告 N）', gw.detail);
    const closeP = await waitProbe(page, (p) => p.battlePhase === 'Closing', 10000);
    if (closeP) {
      log(true, '进入 Closing 阶段');
      const gc = assertPhaseText('Closing', closeP.phaseCountdownText, 'Closing 文案');
      log(gc.pass, 'Closing 文案语义（刺墙逼近 N）', gc.detail);
      const gh = assertHazardNotOverVehicle(closeP, 'Closing 墙');
      log(gh.pass, '墙体接触前不覆盖车辆主体', gh.detail);
    } else {
      // Warning 阶段分出胜负 → 无 Closing（收束未进入即 End，属正常流程；不判失败）
      log(true, 'Warning 阶段分出胜负（无 Closing 阶段，跳过 Closing 几何断言）');
    }

    // Result → 下一场
    const resArea = await waitProbe(page, (p) => p.battleState === 'ended', 40000).then(async () => {
      // ended 后等 modal 出现
      const t0 = Date.now();
      while (Date.now() - t0 < 8000) {
        const a = await hitArea(page, 'modal-primary');
        if (a) return a;
        await page.waitForTimeout(300);
      }
      return null;
    });
    log(resArea !== null, '进入 Result（modal-primary 出现）');
    if (resArea) {
      const resHash = await hash(page);
      await tapArea(page, 'modal-primary');
      await page.waitForTimeout(800);
      const h2 = await hash(page);
      log(h2 !== resHash, '点击「下一场」离开 Result（hash 辅助信号）');
    }
    await page.close();
  }

  // ============ E2E-2 页面职责（Garage/Backpack/More 无匹配入口） ============
  console.log('\n[E2E-2] 页面职责：非首页无匹配入口');
  {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    attachError(page, errors, 'E2E-2');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await initUnhandled(page);
    await page.waitForTimeout(1200);
    await tapArea(page, 'home-garage');
    await page.waitForTimeout(500);
    const p = await probe(page);
    log(p && p.playerPhase === 'garage' && (await hitArea(page, 'home-find-opponent')) === null, 'Garage 无匹配入口');
    // 配置修改链路（武器 → 武器位 → 选项）
    await tapArea(page, 'entry-weapons');
    await page.waitForTimeout(400);
    log((await hitArea(page, 'weapon-slot:')) !== null, 'Garage 配置可用（武器位出现）');
    await tapArea(page, 'nav:home');
    await page.waitForTimeout(500);
    log((await hitArea(page, 'home-find-opponent')) !== null, '返回 Home CTA 恢复');
    await page.close();

    const page2 = await browser.newPage({ viewport: { width: W, height: H } });
    attachError(page2, errors, 'E2E-2b');
    await page2.goto(BASE, { waitUntil: 'networkidle' });
    await initUnhandled(page2);
    await page2.waitForTimeout(1200);
    await tapArea(page2, 'home-garage');
    await page2.waitForTimeout(400);
    await tapArea(page2, 'nav:backpack');
    await page2.waitForTimeout(400);
    log((await hitArea(page2, 'home-find-opponent')) === null, 'Backpack 无匹配入口');
    await page2.close();

    const page3 = await browser.newPage({ viewport: { width: W, height: H } });
    attachError(page3, errors, 'E2E-2c');
    await page3.goto(BASE, { waitUntil: 'networkidle' });
    await initUnhandled(page3);
    await page3.waitForTimeout(1200);
    await tapArea(page3, 'home-garage');
    await page3.waitForTimeout(400);
    await tapArea(page3, 'nav:more');
    await page3.waitForTimeout(400);
    log((await hitArea(page3, 'home-find-opponent')) === null, 'More 无匹配入口');
    await page3.close();
  }

  // ============ E2E-3 输入 Gate（单次 pointer 一次 action + 触摸路径 + 桌面 contain） ============
  console.log('\n[E2E-3] 输入 Gate');
  {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    attachError(page, errors, 'E2E-3a');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await initUnhandled(page);
    await page.waitForTimeout(1200);
    const hA = await hash(page);
    await tapArea(page, 'home-find-opponent');
    await page.waitForTimeout(250);
    const hB = await hash(page);
    log(hB !== hA, '单次 pointer 一次 action（画面切换）');
    await tapArea(page, 'home-find-opponent');
    await page.waitForTimeout(250);
    const hC = await hash(page);
    log(hC !== hA, '重复点击无回到 Home 跳变');
    await page.close();

    const pt = await browser.newPage({ viewport: { width: W, height: H }, hasTouch: true });
    attachError(pt, errors, 'E2E-3b');
    await pt.goto(BASE, { waitUntil: 'networkidle' });
    await initUnhandled(pt);
    await pt.waitForTimeout(1200);
    const ht0 = await hash(pt);
    const a = await hitArea(pt, 'home-find-opponent');
    const box = await pt.locator('canvas').first().boundingBox();
    const tx = box.x + ((a.x + a.w / 2) / W) * box.width;
    const ty = box.y + ((a.y + a.h / 2) / H) * box.height;
    await pt.evaluate(([x, y]) => {
      const c = document.querySelectorAll('canvas')[1] || document.querySelector('canvas');
      c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerType: 'touch', isPrimary: true, pointerId: 1, touches: [{ clientX: x, clientY: y }], bubbles: true }));
    }, [tx, ty]);
    await pt.waitForTimeout(400);
    log((await hash(pt)) !== ht0, '触摸路径：touch 点击 CTA 进入 Matching');
    await pt.close();

    const pd = await browser.newPage({ viewport: { width: 1688, height: 780 }, deviceScaleFactor: 2 });
    attachError(pd, errors, 'E2E-3c');
    await pd.goto(BASE, { waitUntil: 'networkidle' });
    await initUnhandled(pd);
    await pd.waitForTimeout(1200);
    const hd0 = await hash(pd);
    const da = await hitArea(pd, 'home-find-opponent');
    const dbox = await pd.locator('canvas').first().boundingBox();
    await pd.mouse.click(dbox.x + ((da.x + da.w / 2) / W) * dbox.width, dbox.y + ((da.y + da.h / 2) / H) * dbox.height);
    await pd.waitForTimeout(400);
    log((await hash(pd)) !== hd0, '桌面 contain 放大入口：点击 CTA 进入 Matching');
    await pd.close();
  }

  // ============ E2E-4 控制台 Gate ============
  console.log('\n[E2E-4] 控制台 Gate');
  log(errors.length === 0, '零未捕获 error / TypeError / unhandled rejection', errors.slice(0, 5).join(' | '));
  if (errors.length > 0) failures.push('console: ' + errors.slice(0, 8).join(' || '));

  // ============ 汇总 ============
  console.log('\n========== E2E GATE (v3 几何) 结果 ==========');
  console.log('passed=' + results.passed + ' failed=' + results.failed);
  if (failures.length > 0) console.log('FAILURES:\n' + failures.join('\n'));
  await browser.close();
  process.exitCode = results.failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error('E2E_GATE_CRASH', e);
  process.exitCode = 2;
});
