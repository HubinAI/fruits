/**
 * F-DEBUG-GRANT-ALL-PARTS-P0｜真实浏览器验证（?player=1&resetdev=1）
 * A. Debug 开启：按钮命中区存在
 * B. 第一次点击：每正式部件数量精确 +1，反馈「已获得全部件×1（N种）」
 * C. 第二次点击：再次 +1（累计）
 * D. 刷新后库存保持
 * E. 无 resetdev 参数：无按钮、无命中区
 */
const { chromium } = require('playwright-core');
const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:8138/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (ok, msg, ext) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}${ext ? ' | ' + ext : ''}`);
  if (ok) pass += 1; else fail += 1;
};

async function garageEntry(page) {
  const h = await page.evaluate(() => {
    const h = globalThis.__h;
    const a = (h.hitAreas || []).find((x) => x && x.id === 'home-garage');
    return a ? { x: a.x + a.w / 2, y: a.y + a.h / 2 } : null;
  });
  if (!h) return false;
  await page.mouse.click(h.x, h.y);
  await sleep(400);
  return true;
}

async function invCounts(page) {
  return page.evaluate(() => {
    const s = globalThis.__h.lastState;
    const inv = s && s.inventory;
    const out = {};
    if (inv) for (const k of Object.keys(inv)) out[k] = (inv[k] && inv[k].one) || 0;
    return out;
  });
}

async function hasGrantButton(page) {
  return page.evaluate(() => {
    const h = globalThis.__h;
    const a = (h.hitAreas || []).find((x) => x && x.id === 'dev-grant-all');
    return a ? { x: a.x + a.w / 2, y: a.y + a.h / 2, rect: { x: a.x, y: a.y, w: a.w, h: a.h } } : null;
  });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MSEDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });

  // ---------- Debug 开启 ----------
  const page = await context.newPage();
  await page.goto(`${BASE}?player=1&resetdev=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!globalThis.__h, null, { timeout: 15000 });
  await sleep(600);
  await garageEntry(page);
  const btn = await hasGrantButton(page);
  check(!!btn, 'A. Debug 开启（?resetdev=1）→ dev-grant-all 按钮命中区存在', btn ? `rect=${btn.rect.w}x${btn.rect.h}` : '');

  if (btn) {
    const b0 = await invCounts(page);
    const beforeSum = Object.values(b0).reduce((a, c) => a + c, 0);
    // B. 第一次点击
    await page.mouse.click(btn.x, btn.y);
    await sleep(400);
    const msg1 = await page.evaluate(() => globalThis.__h.lastState.devGrantMessage || null);
    const b1 = await invCounts(page);
    const n = Object.keys(b1).length;
    const eachPlus1 = Object.keys(b1).every((k) => b1[k] === (b0[k] || 0) + 1);
    check(eachPlus1, 'B. 第一次点击 → 每种正式部件 +1', `N=${n} sum ${beforeSum}→${Object.values(b1).reduce((a, c) => a + c, 0)}`);
    check(msg1 === `已获得全部件×1（${n}种）`, 'B. 反馈文案（N 来自去重数量）', `msg=${msg1}`);
    // C. 第二次点击
    const btn2 = await hasGrantButton(page);
    if (btn2) {
      await page.mouse.click(btn2.x, btn2.y);
      await sleep(400);
      const b2 = await invCounts(page);
      const eachPlus2 = Object.keys(b2).every((k) => b2[k] === (b0[k] || 0) + 2);
      check(eachPlus2, 'C. 第二次点击 → 再次 +1（累计）', `sum=${Object.values(b2).reduce((a, c) => a + c, 0)}`);
    }
  }

  // ---------- D. 刷新保持 ----------
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!globalThis.__h, null, { timeout: 15000 });
  await sleep(600);
  await garageEntry(page);
  const afterReload = await invCounts(page);
  const plus2All = Object.keys(afterReload).every((k) => afterReload[k] === 2); // starter 各1 + 两次点击 = 3？见下
  // 说明：starter 部件（cannon/hammer/pushRod/spear）初始=1，+2 后=3；其余=2
  const starter = ['cannon', 'hammer', 'pushRod', 'spear'];
  const okReload = Object.keys(afterReload).every((k) => (starter.includes(k) ? afterReload[k] === 3 : afterReload[k] === 2));
  check(okReload, 'D. 刷新后库存保持（starter=3 / 其余=2）', `sample=${JSON.stringify({ cannon: afterReload.cannon, laser: afterReload.laser })}`);
  await context.close();

  // ---------- E. 无参数 ----------
  const page2 = await (await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 })).newPage();
  await page2.goto(`${BASE}?player=1`, { waitUntil: 'load' });
  await page2.waitForFunction(() => !!globalThis.__h, null, { timeout: 15000 });
  await sleep(600);
  await garageEntry(page2);
  const btnN = await hasGrantButton(page2);
  check(!btnN, 'E. 无 resetdev 参数 → 无按钮、无命中区');
  await page2.context().close();

  await browser.close();
  console.log(`\n=== TOTAL: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
