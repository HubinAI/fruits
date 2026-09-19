/**
 * PRODUCT-LOOP-R1-A-HOME-GARAGE-INVENTORY｜竖屏产品首页 / 调整战车 —— 浏览器真实闭环 smoke。
 *
 * 手段：真实浏览器（playwright-core / msedge）打开独立产物 `dist-portrait-lab/home.html`，
 *   - 真实鼠标点击（page.mouse.click，非 evaluate 直调）
 *   - 真实 localStorage 读取（证明装备写进的是**正式存档 key**，且没有第二套库存）
 *   - 真实 `page.reload()`（证明「返回 / 重开页面后状态仍一致」来自持久化，而不是内存巧合）
 *   - 只读诊断句柄 window.__PRODUCTHOME__（页面专属；只读，不能借它改状态）
 *
 * 覆盖 Queue 技术验收 1~6（7 = tsc / build 在门禁里跑）：
 *   1 首页能进入调整战车；
 *   2 至少两个已有 Weapon 可切换；
 *   3 装备后首页真实同步；
 *   4 返回 Garage 后状态仍一致（含整页 reload）；
 *   5 没有重复生成 Inventory（localStorage 里 ownedParts 只有一个 key）；
 *   6 当前装备存在唯一数据源（正式 playerBuild 存档）。
 *
 * 用法：
 *   npm run build:portrait-lab
 *   node tests/_e2e_product_home.cjs   （或 npm run e2e:product-home）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8166;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/** 正式存档 key（与 src/product/homePage.ts 的 SAVE_KEY / core/buildPersistence.ts 同值） */
const BUILD_KEY = 'strongfruit.playerBuild.v1';
/** 被本 Queue 端到端打通的唯一槽位（车身前上挂点） */
const WEAPON_SLOT = 'frontMass';

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round2 = (v) => Math.round(v * 100) / 100;

function startServer() {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/home.html';
    const filePath = path.join(ROOT, path.normalize(urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

/* ------------------------------------------------------------------ 页面助手 */

const probeOf = (page) => page.evaluate(() => window.__PRODUCTHOME__.probe());

/** 真实鼠标点击：取元素真实 CSS 矩形 → 点其中心（不用 evaluate 直调 click）。 */
async function clickSelector(page, sel) {
  const box = await page.locator(sel).first().boundingBox();
  if (!box) throw new Error(`无法定位元素：${sel}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(80);
}

/** 直接读浏览器真实 localStorage（不经过页面探针，独立取证）。 */
function storageDump(page) {
  return page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith('strongfruit.')) out[k] = localStorage.getItem(k);
    }
    return out;
  });
}

async function main() {
  console.log('=== PRODUCT-LOOP-R1-A｜首页 / 调整战车 产品闭环 smoke ===\n');

  if (!fs.existsSync(path.join(ROOT, 'home.html'))) {
    console.error(`未找到 ${path.join(ROOT, 'home.html')} —— 请先 npm run build:portrait-lab`);
    process.exit(1);
  }

  const server = await startServer();
  log(true, 'P0 静态产物就绪（dist-portrait-lab/home.html 真实存在）');

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  try {
    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__PRODUCTHOME__, null, { timeout: 15000 });
    await sleep(250);

    /* ---------------------------------------------------------- 1) 首页身份 */
    const dom = await page.evaluate(() => ({
      title: document.title,
      hasRoot: !!document.getElementById('ph-root'),
      hasLegacyApp: !!document.getElementById('app'),
      hasLabRoot: !!document.getElementById('pbl-root'),
      hasRunRoot: !!document.getElementById('run-root'),
      screen: (() => {
        const s = document.querySelector('.ph-screen');
        const r = s.getBoundingClientRect();
        return { w: r.width, h: r.height };
      })(),
    }));
    let p = await probeOf(page);
    log(
      dom.hasRoot && !dom.hasLegacyApp && !dom.hasLabRoot && !dom.hasRunRoot,
      'A1 第一屏是产品首页（不是旧横屏游戏 / 不是 Debug lab / 不是 Run）',
      `title="${dom.title}" #app=${dom.hasLegacyApp} #pbl-root=${dom.hasLabRoot} #run-root=${dom.hasRunRoot}`,
    );
    log(
      Math.abs(dom.screen.w / dom.screen.h - 390 / 844) < 0.02,
      'A2 竖屏 390×844 手机框（比例与 Run Page 同口径）',
      `screen=${round2(dom.screen.w)}×${round2(dom.screen.h)}`,
    );
    log(
      p.view === 'home' && p.bodyName === '西瓜车身' && p.canvasCount === 0,
      'A3 首页读出真实战车（车身 + 耐久 + 能量），且整页零画布',
      `view=${p.view} body=${p.bodyName} hp=${p.hp} energy=${p.energy}/${p.energyCapacity} canvas=${p.canvasCount}`,
    );
    log(
      p.equippedWeaponId === 'cannon' && p.weaponSlot === WEAPON_SLOT,
      'A4 默认主武器 = starter 在 Weapon 槽装的炮（读正式存档，非写死）',
      `slot=${p.weaponSlot} equipped=${p.equippedWeaponId}（${p.equippedWeaponName}）`,
    );
    log(
      p.weaponIds.length >= 2,
      'A5 库存里至少两件可切换的正式武器（验收 2 的前置）',
      `weapons=${p.weaponIds.join(',')}`,
    );
    log(
      p.previewSpriteCount >= 3 && p.previewFallbackCount >= 1,
      'A6 战车是真实 sprite 合成：正式 PNG + 无图件如实回退灰盒',
      `sprites=${p.previewSpriteCount} fallbacks=${p.previewFallbackCount} items=${p.previewItems.length}`,
    );
    log(
      p.startRunHref === './run-page.html',
      'A7「开始冒险」是同产物内的相对链接（本轮不改 Run）',
      `href=${p.startRunHref}`,
    );

    const stored0 = await storageDump(page);
    log(
      !stored0[BUILD_KEY] && Object.keys(stored0).filter((k) => k.startsWith('strongfruit.ownedParts')).length === 1,
      'A8 装备前：库存只有正式 v2 key，且还没有玩家 Build 存档',
      `keys=${Object.keys(stored0).sort().join(',')}`,
    );

    /* ------------------------------------------------- 2) 进调整战车并切换武器 */
    await clickSelector(page, '[data-ph-action="open-garage"]');
    p = await probeOf(page);
    log(p.view === 'garage' && p.equippedWeaponId === 'cannon', 'B1 首页 →「调整战车」（验收 1）', `view=${p.view}`);
    log(
      p.selectedWeaponId === null && p.equipEnabled === false,
      'B2 刚进入时未选中任何件 →「装备」不可点（不做静默默认选择）',
      `selected=${p.selectedWeaponId} equipEnabled=${p.equipEnabled}`,
    );

    // 选一件与当前不同的武器（hammer）
    const target = p.weaponIds.includes('hammer') ? 'hammer' : p.weaponIds.find((w) => w !== 'cannon');
    log(!!target && target !== 'cannon', 'B3 存在一件与当前不同的可切换武器', `target=${target}`);
    await clickSelector(page, `[data-ph-weapon="${target}"]`);
    p = await probeOf(page);
    log(
      p.selectedWeaponId === target && p.equipEnabled === true,
      'B4 点击库存卡 → 明确选中，且「装备」变为可点（验收 2）',
      `selected=${p.selectedWeaponId} equipEnabled=${p.equipEnabled}`,
    );
    const previewBefore = p.previewItems.find((i) => i.onWeaponSlot);
    log(previewBefore && previewBefore.defId === 'cannon', 'B5 装备前预览的主武器槽仍是炮', `slotPreview=${previewBefore && previewBefore.defId}`);

    await clickSelector(page, '[data-ph-action="equip"]');
    p = await probeOf(page);
    log(
      p.lastEquip && p.lastEquip.ok === true && p.equippedWeaponId === target,
      'B6 点击「装备」→ 槽位真实更新（页面读数）',
      `equipped=${p.equippedWeaponId} lastEquip=${JSON.stringify(p.lastEquip)}`,
    );
    const previewAfter = (await probeOf(page)).previewItems.find((i) => i.onWeaponSlot);
    log(previewAfter && previewAfter.defId === target, 'B7 战车预览同步换件（车身显示 = 真实装备）', `slotPreview=${previewAfter && previewAfter.defId}`);

    /* ---------------------------------------------------- 3) 唯一数据源取证 */
    const stored1 = await storageDump(page);
    const ownedKeys = Object.keys(stored1).filter((k) => k.startsWith('strongfruit.ownedParts'));
    log(!!stored1[BUILD_KEY], 'C1 装备写进的是正式玩家 Build 存档 key（验收 6）', `key=${BUILD_KEY}`);
    log(
      ownedKeys.length === 1 && ownedKeys[0] === 'strongfruit.ownedParts.v2',
      'C2 全库只有一个库存 key —— 没有重复生成 Inventory（验收 5）',
      `ownedParts keys=${ownedKeys.join(',')}`,
    );
    let parsed = null;
    try {
      parsed = JSON.parse(stored1[BUILD_KEY]);
    } catch {
      parsed = null;
    }
    log(
      !!parsed && parsed.functionalSelections && parsed.functionalSelections[WEAPON_SLOT] === target,
      'C3 存档内容真的是「该槽位 = 所选武器」（不只看 key 存在）',
      `functionalSelections.${WEAPON_SLOT}=${parsed && parsed.functionalSelections && parsed.functionalSelections[WEAPON_SLOT]}`,
    );

    /* --------------------------------------------------- 4) 返回首页并同步 */
    await clickSelector(page, '[data-ph-action="back-home"]');
    p = await probeOf(page);
    log(
      p.view === 'home' && p.equippedWeaponId === target,
      'D1 返回首页 → 首页战车 / 装备状态真实同步（验收 3）',
      `view=${p.view} equipped=${p.equippedWeaponId}（${p.equippedWeaponName}）`,
    );
    const homeSlot = p.slots.find((s) => s.hardpointId === WEAPON_SLOT);
    log(
      !!homeSlot && homeSlot.defId === target && homeSlot.editable === true,
      'D2 首页「已装备部件」里主武器槽就是刚装的那件',
      `homeSlot=${homeSlot && homeSlot.defId} editable=${homeSlot && homeSlot.editable}`,
    );

    /* ------------------------------------------- 5) 整页 reload（持久化取证） */
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__PRODUCTHOME__, null, { timeout: 15000 });
    await sleep(200);
    p = await probeOf(page);
    log(
      p.view === 'home' && p.equippedWeaponId === target,
      'E1 reload 后仍是该武器（状态来自正式存档，不是内存巧合）',
      `equipped=${p.equippedWeaponId}`,
    );

    // 再进 Garage：状态仍一致（验收 4）
    await clickSelector(page, '[data-ph-action="open-garage"]');
    p = await probeOf(page);
    log(
      p.view === 'garage' && p.equippedWeaponId === target && p.selectedWeaponId === null,
      'E2 返回 Garage 后状态仍一致（验收 4）：当前 Weapon 是它、且未预选',
      `equipped=${p.equippedWeaponId} selected=${p.selectedWeaponId}`,
    );
    const marked = await page.evaluate(
      (t) => document.querySelectorAll(`[data-ph-weapon="${t}"][data-ph-equipped="true"]`).length,
      target,
    );
    log(marked === 1, 'E3 库存卡上「已装备」标记唯一且落在正确的那张卡上', `markedCards=${marked}`);

    // 再装回另一件，确认可反复切换
    const back = p.weaponIds.find((w) => w !== target);
    await clickSelector(page, `[data-ph-weapon="${back}"]`);
    await clickSelector(page, '[data-ph-action="equip"]');
    p = await probeOf(page);
    log(p.equippedWeaponId === back, 'E4 可反复来回切换（每次都是真实写入）', `${target} → ${back}（当前 ${p.equippedWeaponId}）`);

    const stored2 = await storageDump(page);
    log(
      Object.keys(stored2).filter((k) => k.startsWith('strongfruit.ownedParts')).length === 1 &&
        Object.keys(stored2).length === 2,
      'E5 三轮操作后官方 storage 仍只有两个 key（无残留 / 无第二套库存）',
      `keys=${Object.keys(stored2).sort().join(',')}`,
    );

    /* --------------------------------------- 6) 预览元素与零 console 报错 */
    const domCounts = await page.evaluate(() => ({
      items: document.querySelectorAll('[data-ph-preview-item]').length,
      imgs: document.querySelectorAll('.ph-car-item').length,
      buttons: document.querySelectorAll('#ph-root button').length,
      canvases: document.querySelectorAll('#ph-root canvas').length,
    }));
    log(
      domCounts.items === 6 && domCounts.imgs === 6 && domCounts.canvases === 0 && domCounts.buttons > 0,
      'F1 预览是真实 DOM 元素（非 canvas），控件是真实 <button>',
      `items=${domCounts.items} imgs=${domCounts.imgs} buttons=${domCounts.buttons} canvas=${domCounts.canvases}`,
    );
    log(consoleErrors.length === 0, 'F2 全程零运行时报错', consoleErrors.slice(0, 2).join(' | ') || 'none');

    /* --------------------------------- 7) 「开始冒险」真的落到玩家 Run 入口 */
    await clickSelector(page, '[data-ph-action="back-home"]');
    await Promise.all([
      page.waitForURL(/run-page\.html/, { timeout: 20000 }).catch(() => {}),
      clickSelector(page, '[data-ph-action="start-run"]'),
    ]);
    await sleep(600);
    const runDom = await page.evaluate(() => ({
      url: location.pathname,
      hasRunRoot: !!document.getElementById('run-root'),
      hasHomeRoot: !!document.getElementById('ph-root'),
    }));
    log(
      /run-page\.html$/.test(runDom.url) && runDom.hasRunRoot && !runDom.hasHomeRoot,
      'G1 首页「开始冒险」→ 落到既有玩家 Run 入口（同产物相对链接，整页导航）',
      `path=${runDom.url} run-root=${runDom.hasRunRoot}`,
    );
  } finally {
    await browser.close();
    server.close();
  }

  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.log(`\n=== 结果：${pass}/${results.length} PASS，${fail} FAIL ===`);
  if (fail > 0) {
    console.log('\n失败项：');
    results.filter((r) => !r.pass).forEach((r) => console.log(`  FAIL ${r.name} | ${r.detail}`));
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('SMOKE 异常：', e);
  process.exit(1);
});
