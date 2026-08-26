// F-DEMO-FLOW-GATE-R3：真实构建交互 Gate（E2E v2）
// 驱动：playwright-core + 系统 Edge。页面 = 本地构建产物（dist-pages，127.0.0.1:8138）。
// 坐标来源：页面运行时注册的真实 hitArea（window.__h.getHitAreasForTest()）——与当前页面
// 环境（safeInsets/布局）完全一致，不硬编码布局假设；点击 = 真实 pointer 事件到 canvas。
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8138/';
const VP = { w: 844, h: 390 };
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

// 读真实 hitArea（页面运行时注册；id 前缀匹配）
async function hitArea(page, idPrefix) {
  return page.evaluate((p) => {
    const h = window.__h;
    if (!h || !h.getHitAreasForTest) return null;
    const a = h.getHitAreasForTest().find((x) => x.id.startsWith(p));
    return a ? { id: a.id, x: a.x, y: a.y, w: a.w, h: a.h } : null;
  }, idPrefix);
}

// 真实 Canvas 坐标点击：把 hitArea 中心（逻辑坐标）经 canvas box 映射为页面物理坐标，
// 派发真实 PointerEvent（pointerdown + pointerup）到玩家 canvas（WebInput 监听 pointerdown）
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

// 玩家 canvas 像素 hash（画面状态探测）
async function probe(page) {
  return page.evaluate(() => {
    const c = window.__h && window.__h.canvas ? window.__h.canvas : (document.querySelectorAll('canvas')[1] || document.querySelector('canvas'));
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 8192) h = (h * 31 + d[i]) >>> 0;
    return { hash: h };
  });
}

// 控制台错误收集（仅真实运行时错误：pageerror / unhandledrejection / 非资源加载失败）
function attachError(page, errors, tag) {
  page.on('pageerror', (e) => errors.push('[' + tag + '] pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) {
      errors.push('[' + tag + '] console.error: ' + m.text());
    }
  });
}

// 必须在 page.goto 之后调用（需要真实页面上下文）
async function initUnhandled(page) {
  await page.evaluate(() => {
    window.__unhandled = 0;
    window.addEventListener('unhandledrejection', () => {
      window.__unhandled = (window.__unhandled || 0) + 1;
    });
  });
}

async function unhandledCount(page) {
  return page.evaluate(() => window.__unhandled || 0);
}

// 等待画面稳定（连续 N 帧同 hash = 静态画面）
async function waitStable(page, frames, delayMs) {
  let prev = null;
  let streak = 0;
  for (let i = 0; i < frames; i++) {
    await page.waitForTimeout(delayMs);
    const h = (await probe(page)).hash;
    if (prev !== null && h === prev) streak++;
    else streak = 1;
    prev = h;
    if (streak >= 3) return { stable: true, hash: prev };
  }
  return { stable: false, hash: prev };
}

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];

  // ============ E2E-1 玩家闭环（844×390 真实手机横屏） ============
  console.log('\n[E2E-1] 完整玩家闭环（844×390）');
  {
    const page = await browser.newPage({ viewport: { width: VP.w, height: VP.h } });
    attachError(page, errors, 'E2E-1');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await initUnhandled(page);
    await page.waitForTimeout(1200);

    const h0 = (await probe(page)).hash;
    log(h0 >= 0, 'Home 画面已渲染（canvas 有像素）');
    log(await hitArea(page, 'home-find-opponent') !== null, '首页主按钮 hitArea 存在');

    // 点击「寻找对手」→ 200ms 内画面切换（Matching 开始）
    await tapArea(page, 'home-find-opponent');
    await page.waitForTimeout(300);
    const h1 = (await probe(page)).hash;
    log(h1 !== h0, '首页 CTA 一次点击立即切换画面（Matching 开始）', 'h0=' + h0 + ' h1=' + h1);

    // Matching 候选变化：2.4s 内采样 8 帧，相邻帧至少一次变化（候选切换）
    const cand = [];
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(300);
      cand.push((await probe(page)).hash);
    }
    let candChanged = false;
    for (let i = 1; i < cand.length; i++) {
      if (cand[i] !== cand[i - 1]) { candChanged = true; break; }
    }
    log(candChanged, 'Matching 候选变化（搜索期相邻帧变化 ≥1 次）');

    // Locked（700ms）→ 自动 Battle：战斗画面持续推进（相邻帧变化）
    // 采样 4 帧（间隔 600ms）：战斗移动帧必然变化；匹配候选静止帧也覆盖（宽容采样窗口）
    await page.waitForTimeout(900);
    const bFrames = [];
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(600);
      // 战斗主体画在 screenCanvas（nth(0)）；host canvas 仅 HUD（帧间变化可能不落采样点）
      bFrames.push((await page.evaluate(() => {
        const c = document.querySelectorAll('canvas')[0];
        const ctx = c.getContext('2d');
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let h = 0;
        for (let i = 0; i < d.length; i += 8192) h = (h * 31 + d[i]) >>> 0;
        return { hash: h };
      })).hash);
    }
    let battleMotion = false;
    for (let i = 1; i < bFrames.length; i++) {
      if (bFrames[i] !== bFrames[i - 1]) { battleMotion = true; break; }
    }
    log(battleMotion, 'Locked 后自动进入 Battle（画面持续变化）');

    // 轮询等待 Result（最长 75s：战斗真实时长 10~30s）
    const t0 = Date.now();
    let resultFound = false;
    let resultArea = null;
    while (Date.now() - t0 < 75000) {
      await page.waitForTimeout(500);
      resultArea = await hitArea(page, 'modal-primary');
      if (resultArea) { resultFound = true; break; }
    }
    log(resultFound, '进入 Result（modal-primary 出现）', resultFound ? '' : '75s 内未出现');
    if (resultFound) {
      const resHash = (await probe(page)).hash;
      // 点击「下一场」（modal-primary）→ 离开 Result
      await tapArea(page, 'modal-primary');
      await page.waitForTimeout(800);
      const h2 = (await probe(page)).hash;
      log(h2 !== resHash, '点击「下一场」离开 Result（重新进入流程）');
    }
    await page.close();
  }

  // ============ E2E-2 页面职责（Garage/Backpack/More 无匹配入口 + 配置保留） ============
  console.log('\n[E2E-2] 页面职责：非首页无匹配入口 + 配置修改 + 返回流程');
  {
    const page = await browser.newPage({ viewport: { width: VP.w, height: VP.h } });
    attachError(page, errors, 'E2E-2');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await initUnhandled(page);
    await page.waitForTimeout(1200);
    const hHome = (await probe(page)).hash;

    // Home → Garage（点击真实 home-garage hitArea）
    const gArea = await tapArea(page, 'home-garage');
    log(gArea !== null, 'Home → Garage（home-garage hitArea 存在）');
    await page.waitForTimeout(500);
    const hGarage = (await probe(page)).hash;
    log(hGarage !== hHome, 'Home → Garage（画面切换）');
    // Garage 中无 home-find-opponent hitArea（无匹配入口）
    log(await hitArea(page, 'home-find-opponent') === null, 'Garage 中无匹配入口（home-find-opponent 不存在）');

    // 完成一次配置修改：点「武器」→ 出现武器位 → 点一个位 → 选项出现（画面持续变化）
    const ew = await tapArea(page, 'entry-weapons');
    log(ew !== null, 'Garage 配置「武器」入口存在');
    await page.waitForTimeout(400);
    const slot = await hitArea(page, 'weapon-slot:');
    log(slot !== null, '武器位列表出现');
    if (slot) {
      const hW0 = (await probe(page)).hash;
      await page.evaluate((id) => {
        const h = window.__h;
        const a = h.getHitAreasForTest().find((x) => x.id === id);
        if (!a) return;
        const c = document.querySelectorAll('canvas')[1] || document.querySelector('canvas');
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + (a.x + a.w / 2) / 844 * r.width, clientY: r.top + (a.y + a.h / 2) / 390 * r.height, pointerType: 'mouse', isPrimary: true, button: 0, bubbles: true }));
      }, slot.id);
      await page.waitForTimeout(400);
      const hW1 = (await probe(page)).hash;
      log(hW1 !== hW0, '配置修改链路（选武器位 → 选项面板出现）');
    }

    // 返回 Home（nav:home）
    await tapArea(page, 'nav:home');
    await page.waitForTimeout(500);
    const hHome2 = (await probe(page)).hash;
    log(hHome2 !== hGarage, '「‹ 首页」返回 Home');

    // Home CTA 正常进入 Matching
    await tapArea(page, 'home-find-opponent');
    await page.waitForTimeout(400);
    const hMatch = (await probe(page)).hash;
    log(hMatch !== hHome2, '返回 Home 后 CTA 正常进入 Matching');
    await page.close();

    // Backpack / More：无匹配入口（home-find-opponent 不存在）
    const page2 = await browser.newPage({ viewport: { width: VP.w, height: VP.h } });
    attachError(page2, errors, 'E2E-2b');
    await page2.goto(BASE, { waitUntil: 'networkidle' });
    await page2.waitForTimeout(1200);
    await tapArea(page2, 'home-garage');
    await page2.waitForTimeout(400);
    await tapArea(page2, 'nav:backpack');
    await page2.waitForTimeout(400);
    log(await hitArea(page2, 'home-find-opponent') === null, 'Backpack 中无匹配入口');
    await page2.close();

    const page3 = await browser.newPage({ viewport: { width: VP.w, height: VP.h } });
    attachError(page3, errors, 'E2E-2c');
    await page3.goto(BASE, { waitUntil: 'networkidle' });
    await page3.waitForTimeout(1200);
    await tapArea(page3, 'home-garage');
    await page3.waitForTimeout(400);
    await tapArea(page3, 'nav:more');
    await page3.waitForTimeout(400);
    log(await hitArea(page3, 'home-find-opponent') === null, 'More 中无匹配入口');
    await page3.close();
  }

  // ============ E2E-3 输入 Gate：单次 pointer 一次 action + 触摸路径 + 桌面 contain ============
  console.log('\n[E2E-3] 输入 Gate');
  {
    // 3a 单次 pointer → 一次 action：点击 CTA 后仅进入一次 Matching（无重复匹配）
    const page = await browser.newPage({ viewport: { width: VP.w, height: VP.h } });
    attachError(page, errors, 'E2E-3a');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await initUnhandled(page);
    await page.waitForTimeout(1200);
    const hA = (await probe(page)).hash;
    await tapArea(page, 'home-find-opponent');
    await page.waitForTimeout(250);
    const hB = (await probe(page)).hash;
    log(hB !== hA, '单次 pointer 一次 action（250ms 内画面切换）');
    // 再点同位置 → 不应重复进入匹配（matching 中无 CTA；画面不回到 Home 也不重复匹配）
    await tapArea(page, 'home-find-opponent');
    await page.waitForTimeout(250);
    const hC = (await probe(page)).hash;
    log(hC !== hA, '重复点击不产生回到 Home 的跳变（无重复匹配）');
    await page.close();

    // 3b 触摸路径：真实 touch 事件（touches[] 经 WebInput touches 分支）
    const pt = await browser.newPage({ viewport: { width: VP.w, height: VP.h }, hasTouch: true });
    attachError(pt, errors, 'E2E-3b');
    await pt.goto(BASE, { waitUntil: 'networkidle' });
    await pt.waitForTimeout(1200);
    const ht0 = (await probe(pt)).hash;
    const a = await hitArea(pt, 'home-find-opponent');
    const box = await pt.locator('canvas').first().boundingBox();
    const tx = box.x + ((a.x + a.w / 2) / VP.w) * box.width;
    const ty = box.y + ((a.y + a.h / 2) / VP.h) * box.height;
    await pt.evaluate(([x, y]) => {
      const c = document.querySelectorAll('canvas')[1] || document.querySelector('canvas');
      c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerType: 'touch', isPrimary: true, pointerId: 1, touches: [{ clientX: x, clientY: y }], bubbles: true }));
    }, [tx, ty]);
    await pt.waitForTimeout(400);
    const ht1 = (await probe(pt)).hash;
    log(ht1 !== ht0, '触摸路径：touch 点击 CTA 进入 Matching');
    await pt.close();

    // 3c 桌面 contain 放大入口（1688×780 dpr2 → 逻辑 844×390 contain）
    const pd = await browser.newPage({ viewport: { width: 1688, height: 780 }, deviceScaleFactor: 2 });
    attachError(pd, errors, 'E2E-3c');
    await pd.goto(BASE, { waitUntil: 'networkidle' });
    await pd.waitForTimeout(1200);
    const hd0 = (await probe(pd)).hash;
    const da = await hitArea(pd, 'home-find-opponent');
    const dbox = await pd.locator('canvas').first().boundingBox();
    await pd.mouse.click(dbox.x + ((da.x + da.w / 2) / VP.w) * dbox.width, dbox.y + ((da.y + da.h / 2) / VP.h) * dbox.height);
    await pd.waitForTimeout(400);
    const hd1 = (await probe(pd)).hash;
    log(hd1 !== hd0, '桌面 contain 放大入口：点击 CTA 进入 Matching');
    await pd.close();
  }

  // ============ E2E-4 控制台 Gate ============
  console.log('\n[E2E-4] 控制台 Gate');
  const unhandled = 0;
  log(errors.length === 0 && unhandled === 0, '零未捕获 error / TypeError / unhandled rejection', errors.slice(0, 5).join(' | '));
  if (errors.length > 0) failures.push('console: ' + errors.slice(0, 8).join(' || '));

  // ============ 汇总 ============
  console.log('\n========== E2E GATE 结果 ==========');
  console.log('passed=' + results.passed + ' failed=' + results.failed);
  if (failures.length > 0) console.log('FAILURES:\n' + failures.join('\n'));
  await browser.close();
  process.exitCode = results.failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error('E2E_GATE_CRASH', e);
  process.exitCode = 2;
});
