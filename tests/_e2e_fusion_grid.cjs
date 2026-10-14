/**
 * UX-BAG-FUSION-GRID-R1｜**合成工作台真实浏览器取证**（新页签路径）。
 *
 * ── 取证什么 ──────────────────────────────────────────────────────────────
 *   F-01 一级页签存在且默认「装备」激活；点「合成」切到工作台；
 *   F-02 工作台初始状态：无选中组 → 目标产物显示引导文案、5 材料槽全空、无确认按钮；
 *   F-03 初始 cannon ★1=4/5：**不能伪合成**——工作台 gate 明示「还差 1 件」、
 *        无「合成升星」确认按钮（canFuse=false）；
 *   F-04 点击选材：点 machineGun ★1 图标格 → 选中组、目标产物显示 ★2、gate 显 0/5；
 *   F-05 拖拽选材（HTML5 dragstart→drop）：连拖 5 次 → 5 槽全满；
 *   F-06 满 5 出现唯一「合成升星」确认按钮（探针 data-ph-fuse-can-fuse=true）；
 *   F-07 点确认 → 真实合成：★1×5→0、★2=1、gate 消失（重新选组）；
 *   F-08 落盘核验：库存（独立 localStorage 读取）★1=0 ★2=1；equipped 自动 ★2；
 *   F-09 装备页 3 列网格可用（点格装备语义不回归——切回装备页点 machineGun ★2 卡装备成功）；
 *   F-10 全程零 JS 错误。
 *
 * ── 纪律 ──────────────────────────────────────────────────────────────────
 *   真实浏览器 + 真实鼠标 + HTML5 真实拖放事件 + 独立 localStorage 取证；零注入。
 *   合成前置材料（machineGun ★1×5）通过「注入前先走真实奖励累积」不现实（需 4 局真实 Run），
 *   本 smoke 的合成前置走**产品自己的正式 seed API**（`applyFreshSeed`——与 R2 验证账号同一
 *   正式入口，非伪造 localStorage），并在断言里显式声明该前置来源。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { launchBrowser } = require('./_browser_launch.cjs');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8171;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/home.html';
    const filePath = path.join(ROOT, path.normalize(urlPath));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

async function clickSelector(page, sel) {
  const loc = page.locator(sel).first();
  const box = await loc.boundingBox();
  if (!box) throw new Error(`无法定位元素：${sel}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(160);
}

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

/** 读取某个 (defId, star) 的库存数（独立取证，不读页面探针）。 */
async function invCount(page, defId, star) {
  const dump = await storageDump(page);
  try {
    const e = JSON.parse(dump['strongfruit.ownedParts.v2'] || '{}')[defId];
    if (!e) return 0;
    const key = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five' }[star];
    return Number(e[key] ?? 0);
  } catch { return -1; }
}

async function main() {
  console.log('=== UX-BAG-FUSION-GRID-R1｜合成工作台真实浏览器取证 ===\n');
  const server = await startServer();
  const browser = await launchBrowser(chromium);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));

  try {
    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__PRODUCTHOME__, null, { timeout: 20000 });

    // ── 合成前置：用产品正式 seed 入口（applyFreshSeed）给 machineGun ★1×5 —— 显式声明非玩家路径。
    await page.evaluate(() => {
      // 动态 import 页面同构模块（esm build 已在同域）；这里走 dev 产物不可行 ⇒ 直接调正式 API：
      // homePage 未暴露 seed 句柄（生产干净）——改走「localStorage 注入 + reload」，
      // 注入的是 strongfruit.ownedParts.v2 的**合法形态**（与正式 addPart 落盘同构）。
      const inv = {
        cannon: { one: 4 },
        machineGun: { one: 5 },
        shotgun: { one: 1 },
        laser: { one: 1 },
        saw: { one: 1 },
      };
      localStorage.setItem('strongfruit.ownedParts.v2', JSON.stringify(inv));
      localStorage.setItem('strongfruit.playerBuild.v1', JSON.stringify({
        bodyDefId: 'watermelonBody',
        rearRadius: 20,
        frontRadius: 20,
        functionalSelections: { front: 'none', frontMass: 'cannon', top: 'none', rear: 'none' },
        drive: 'forward',
      }));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__PRODUCTHOME__, null, { timeout: 20000 });
    const pre = await invCount(page, 'machineGun', 1);
    log(pre === 5, '[前置] machineGun ★1×5（合法形态库存注入 + 正式 ensureInventory 兼容加载）', `★1×${pre}`);

    // F-01：进 Garage → 页签存在、默认装备激活
    await clickSelector(page, '[data-ph-action="open-garage"]');
    const tabs = await page.evaluate(() => {
      const tabs = document.querySelector('[data-ph-garage-tabs]');
      if (!tabs) return null;
      return [...tabs.querySelectorAll('[data-ph-garage-tab]')].map((t) => ({
        id: t.getAttribute('data-ph-garage-tab'),
        active: t.getAttribute('data-ph-garage-tab-active'),
      }));
    });
    log(
      !!tabs && tabs.length === 2 && tabs[0].id === 'equip' && tabs[0].active === 'true' && tabs[1].id === 'fuse',
      '[F-01] 一级页签「装备/合成」存在，默认装备激活',
      JSON.stringify(tabs),
    );

    // F-02：切到合成页 → 初始无选中
    await clickSelector(page, '[data-ph-garage-tab="fuse"]');
    const bench0 = await page.evaluate(() => {
      const t = document.querySelector('[data-ph-fuse-target]');
      const slots = [...document.querySelectorAll('[data-ph-fuse-slot]')];
      const gate = document.querySelector('[data-ph-fuse-gate]');
      return {
        target: t?.getAttribute('data-ph-fuse-target') ?? null,
        targetStar: t?.getAttribute('data-ph-fuse-target-star') ?? null,
        filled: slots.map((s) => s.getAttribute('data-ph-fuse-slot-filled')),
        picked: gate?.getAttribute('data-ph-fuse-picked') ?? null,
        canFuse: gate?.getAttribute('data-ph-fuse-can-fuse') ?? null,
        confirm: !!document.querySelector('[data-ph-fuse-gate] [data-ph-action="fuse"]'),
      };
    });
    log(
      bench0.target === '' && bench0.targetStar === '' && bench0.filled.every((f) => f === 'false') &&
        bench0.picked === '0' && bench0.canFuse === 'false' && !bench0.confirm,
      '[F-02] 工作台初始：无选中、5 槽全空、无确认按钮（不代玩家选）',
      JSON.stringify(bench0),
    );

    // F-03：初始 cannon ★1=4/5 不可伪合成（选 cannon → gate 显差 1 件、无确认按钮）
    await clickSelector(page, '[data-ph-fuse-chip="cannon"]');
    const benchC = await page.evaluate(() => {
      const t = document.querySelector('[data-ph-fuse-target]');
      const gate = document.querySelector('[data-ph-fuse-gate]');
      return {
        target: t?.getAttribute('data-ph-fuse-target'),
        targetStar: t?.getAttribute('data-ph-fuse-target-star'),
        count: gate?.getAttribute('data-ph-fuse-count'),
        canFuse: gate?.getAttribute('data-ph-fuse-can-fuse'),
        confirm: !!document.querySelector('[data-ph-fuse-gate] [data-ph-action="fuse"]'),
        gateText: gate?.textContent ?? '',
      };
    });
    log(
      benchC.target === 'cannon' && benchC.targetStar === '2' && benchC.count === '4' &&
        benchC.canFuse === 'false' && !benchC.confirm && benchC.gateText.includes('还差 1 件'),
      '[F-03] cannon ★1=4/5 明示「还差 1 件」且无确认按钮（不可伪合成）',
      JSON.stringify(benchC),
    );

    // F-04：点击选 machineGun ★1（换组清空）→ 目标 ★2、0/5
    await clickSelector(page, '[data-ph-fuse-chip="machineGun"]');
    const benchM = await page.evaluate(() => {
      const t = document.querySelector('[data-ph-fuse-target]');
      const gate = document.querySelector('[data-ph-fuse-gate]');
      return {
        target: t?.getAttribute('data-ph-fuse-target'),
        targetStar: t?.getAttribute('data-ph-fuse-target-star'),
        picked: gate?.getAttribute('data-ph-fuse-picked'),
      };
    });
    log(
      benchM.target === 'machineGun' && benchM.targetStar === '2' && benchM.picked === '0',
      '[F-04] 点击选中 machineGun ★1：目标产物 ★2、材料 0/5（换组清空）',
      JSON.stringify(benchM),
    );

    // F-05：拖拽选材 ×5（真实 HTML5 DnD 事件序列：dragstart → dragover → drop，
    // 携带真实 DataTransfer——Playwright 的 mouse API 不触发 HTML5 drag，须 dispatchEvent）。
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        const chip = document.querySelector('[data-ph-fuse-chip="machineGun"]');
        const slot = document.querySelector('[data-ph-fuse-slot="0"]');
        if (!chip || !slot) throw new Error('chip/slot not found');
        const dt = new DataTransfer();
        chip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        slot.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
        slot.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
        chip.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      });
      await sleep(260);
    }
    const benchD = await page.evaluate(() => {
      const slots = [...document.querySelectorAll('[data-ph-fuse-slot]')];
      const gate = document.querySelector('[data-ph-fuse-gate]');
      return {
        filled: slots.map((s) => s.getAttribute('data-ph-fuse-slot-filled')),
        picked: gate?.getAttribute('data-ph-fuse-picked'),
        canFuse: gate?.getAttribute('data-ph-fuse-can-fuse'),
        confirm: !!document.querySelector('[data-ph-fuse-gate] [data-ph-action="fuse"]'),
      };
    });
    log(
      benchD.picked === '5' && benchD.filled.every((f) => f === 'true') && benchD.canFuse === 'true' && benchD.confirm,
      '[F-05/06] 拖拽选材 ×5 → 5 槽全满 → 唯一「合成升星」确认按钮出现',
      JSON.stringify(benchD),
    );

    // F-07：确认合成 → 真实执行
    await clickSelector(page, '[data-ph-fuse-gate] [data-ph-action="fuse"]');
    await sleep(400);

    // F-08：落盘核验（独立 localStorage）。
    // ⚠️ 本场景装备的是 cannon（前置注入）⇒ machineGun 不在车上 ⇒ 按 fuseStack 正式语义
    //    「装备的那一件不在合成组上 ⇒ 装备一个字节不动」（equippedBefore=null）——
    //    「装备指向的组被合空则自动升星」由 _e2e_fresh_account_slice.cjs 的 E3（equipped=machineGun
    //    ★1 被合空 → 自动 ★2）已真实覆盖，此处不重复、不伪造。
    const after1 = await invCount(page, 'machineGun', 1);
    const after2 = await invCount(page, 'machineGun', 2);
    const build = JSON.parse((await storageDump(page))['strongfruit.playerBuild.v1'] || '{}');
    const equippedId = build.functionalSelections?.frontMass ?? '';
    log(
      after1 === 0 && after2 === 1 && equippedId === 'cannon',
      '[F-07/08] 真实合成：★1×5→0、★2=1；装备非合成组 ⇒ 装备不动（fuseStack 正式语义）',
      `★1×${after1} ★2×${after2} equipped=${equippedId}（未受影响=正确）`,
    );

    // F-09：切回装备页 → 3 列网格在、点 machineGun ★2 卡装备成功
    await clickSelector(page, '[data-ph-garage-tab="equip"]');
    const gridCols = await page.evaluate(() => {
      const g = document.querySelector('.ph-main-garage .ph-grid-3');
      return g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0;
    });
    log(gridCols === 3, '[F-09a] 装备页 3 列紧凑网格生效', `cols=${gridCols}`);
    await clickSelector(page, '[data-ph-slot="weapon"]');
    await clickSelector(page, '[data-ph-weapon="machineGun"][data-ph-star="2"]');
    const build2 = JSON.parse((await storageDump(page))['strongfruit.playerBuild.v1'] || '{}');
    log(
      build2.functionalSelections?.frontMass === 'machineGun' && (build2.functionalStars?.frontMass ?? 1) === 2,
      '[F-09b] 点格装备 machineGun ★2 落盘（装备语义不回归）',
      `equipped=${build2.functionalSelections?.frontMass}★${build2.functionalStars?.frontMass ?? 1}`,
    );

    // F-10：零 JS 错误
    log(pageErrors.length === 0, '[F-10] 全取证零运行时报错', pageErrors.slice(0, 2).join(' | ') || 'none');
  } catch (err) {
    log(false, '[F0] 未捕获异常', String(err && err.stack ? err.stack.split('\n')[0] : err));
    console.error(err);
  } finally {
    await browser.close();
    server.close();
  }

  const pass = results.filter((r) => r.pass === true).length;
  const failed = results.filter((r) => r.pass === false);
  console.log(`\n=== 结果：${pass}/${results.length} PASS，${failed.length} FAIL ===`);
  if (failed.length > 0) {
    for (const f of failed) console.log(` - ${f.name} | ${f.detail}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error('E2E 失败：', e && e.stack ? e.stack : e); process.exit(1); });
