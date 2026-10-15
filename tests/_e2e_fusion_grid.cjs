/**
 * UX-BLUESTAR-EQUIP-FUSE-SIMPLIFY-R1｜**合成弹窗 + 装备确认弹窗 真实浏览器取证**。
 *
 * ── 取证什么 ──────────────────────────────────────────────────────────────
 *   F-01 主视图【合成】独立按钮存在；有真实可合成组（machineGun ★1 5/5）时带红点数量；
 *        无旧双页签 / 无常驻 5 槽工作台；
 *   F-02 cannon ★1 4/5 **不在**合成弹窗（点开只列 1 组 = machineGun；单组自动选中）；
 *   F-03 弹窗组 = 武器图形 + 名称 + ★1 → ★2 + 5 枚材料缩略图（全满）；
 *   F-04 底部唯一【合成升星】确认；点击 → 真实合成 ★1×5→0、★2=1；
 *   F-05 合成后弹窗自动关闭（无剩余组）、红点归零、库存/探针逐字对账；
 *   F-06 点武器卡 → 「当前装备/新装备」对比弹窗（图形+名称+真实属性对比），不立即写盘；
 *   F-07 弹窗【取消】零写盘（存档逐字节不变）；
 *   F-08 弹窗【替换】真实写盘 + 预览同次刷新 + 其余槽不丢；
 *   F-09 全程零 JS 错误。
 *
 * ── 纪律 ──────────────────────────────────────────────────────────────────
 *   真实浏览器 + 真实鼠标 + 独立 localStorage 取证；合成前置为**合法形态**库存注入
 *   （与正式 addPart 落盘同构，显式声明非玩家路径）；断言全部走 data-ph-* 探针或
 *   独立 storage 读取，不依赖文案匹配。
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
  console.log('=== UX-BLUESTAR-R1｜合成弹窗 + 装备确认弹窗 真实浏览器取证 ===\n');
  const server = await startServer();
  const browser = await launchBrowser(chromium);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));

  try {
    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__PRODUCTHOME__, null, { timeout: 20000 });

    // ── 前置：合法形态库存注入（cannon 4/5 不可合成 + machineGun 5/5 可合成）——显式声明非玩家路径。
    await page.evaluate(() => {
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
    log(pre === 5, '[前置] machineGun ★1×5 + cannon ★1×4（合法形态库存注入）', `★1×${pre}`);

    // F-01：进 Garage → 【合成】独立按钮 + 无页签 + 无工作台
    await clickSelector(page, '[data-ph-action="open-garage"]');
    const g0 = await page.evaluate(() => {
      const p = window.__PRODUCTHOME__.probe();
      const btn = document.querySelector('[data-ph-action="fuse-entry"]');
      return {
        tabs: document.querySelectorAll('[data-ph-garage-tabs], [data-ph-garage-tab]').length,
        bench: document.querySelectorAll('[data-ph-fuse-bench]').length,
        btn: !!btn,
        btnReady: btn?.classList.contains('ph-fuse-btn-ready') === true,
        badge: btn?.querySelector('.ph-fuse-btn-badge')?.textContent ?? null,
        probeReady: p.garageFuseEntryReady,
        readyCount: p.garageFuseReadyCount,
        modal: p.garageModal,
      };
    });
    log(
      g0.tabs === 0 && g0.bench === 0 && g0.btn && g0.btnReady && g0.badge === '1' && g0.probeReady && g0.readyCount === 1 && g0.modal === null,
      '[F-01] 单一背包主视图：【合成】独立按钮带红点数量 1；无旧双页签 / 无常驻 5 槽工作台',
      JSON.stringify(g0),
    );

    // F-02：点【合成】→ 弹窗只列 machineGun 一组（cannon 4/5 不在）；单组自动选中
    await clickSelector(page, '[data-ph-action="fuse-entry"]');
    const fm = await page.evaluate(() => {
      const p = window.__PRODUCTHOME__.probe();
      const opts = [...document.querySelectorAll('[data-ph-fuse-option]')].map((o) => ({
        def: o.getAttribute('data-ph-fuse-option'),
        star: o.getAttribute('data-ph-fuse-option-star'),
        sel: o.getAttribute('data-ph-fuse-option-selected'),
        name: o.querySelector('.ph-fuse-option-name')?.textContent ?? null,
        starText: o.querySelector('.ph-fuse-option-star')?.textContent ?? null,
        mats: o.querySelectorAll('.ph-fuse-mat').length,
        matsFilled: o.querySelectorAll('.ph-fuse-mat-filled').length,
        icon: !!o.querySelector('.ph-part-icon'),
      }));
      return {
        modal: p.garageModal,
        opts,
        goDef: document.querySelector('.ph-modal-card [data-ph-action="fuse"]')?.getAttribute('data-ph-fuse-def') ?? null,
        goStar: document.querySelector('.ph-modal-card [data-ph-action="fuse"]')?.getAttribute('data-ph-fuse-star') ?? null,
      };
    });
    log(
      fm.modal === 'fuse' && fm.opts.length === 1 &&
        fm.opts[0].def === 'machineGun' && fm.opts[0].star === '1' && fm.opts[0].sel === 'true' &&
        fm.opts[0].mats === 5 && fm.opts[0].matsFilled === 5 && fm.opts[0].icon &&
        fm.opts[0].starText === '★1 → ★2' &&
        fm.goDef === 'machineGun' && fm.goStar === '1',
      '[F-02/03] 合成弹窗只列 machineGun ★1 一组（自动选中；cannon 4/5 不出现）：图形+名称+★1 → ★2+5 枚全满材料格',
      JSON.stringify(fm),
    );

    // F-04：点唯一【合成升星】→ 真实合成
    await clickSelector(page, '.ph-modal-card [data-ph-action="fuse"]');
    await sleep(400);
    const after1 = await invCount(page, 'machineGun', 1);
    const after2 = await invCount(page, 'machineGun', 2);
    const f5 = await page.evaluate(() => {
      const p = window.__PRODUCTHOME__.probe();
      const btn = document.querySelector('[data-ph-action="fuse-entry"]');
      return {
        modal: p.garageModal,
        lastFuse: p.lastFuse,
        readyCount: p.garageFuseReadyCount,
        btnReady: btn?.classList.contains('ph-fuse-btn-ready') === true,
        badge: btn?.querySelector('.ph-fuse-btn-badge')?.textContent ?? null,
      };
    });
    log(
      after1 === 0 && after2 === 1 &&
        f5.modal === null && f5.lastFuse?.ok === true && f5.lastFuse.fromStar === 1 && f5.lastFuse.toStar === 2 &&
        f5.readyCount === 0 && f5.btnReady === false && f5.badge === null,
      '[F-04/05] 点唯一确认 → 真实合成：★1×5→0、★2=1；弹窗自动关闭（无剩余组）、红点归零',
      `★1×${after1} ★2×${after2} modal=${f5.modal} lastFuse=${JSON.stringify(f5.lastFuse)}`,
    );

    // F-06：点武器卡 → 对比弹窗（当前 cannon / 新 machineGun ★2），不立即写盘
    await clickSelector(page, '[data-ph-weapon="machineGun"][data-ph-star="2"]');
    const em = await page.evaluate(() => {
      const p = window.__PRODUCTHOME__.probe();
      const build = JSON.parse(localStorage.getItem('strongfruit.playerBuild.v1') || '{}');
      return {
        modal: p.garageModal,
        slot: document.querySelector('.ph-modal-card')?.getAttribute('data-ph-modal-slot'),
        curName: document.querySelector('[data-ph-modal-col="current"] .ph-modal-fig-name')?.textContent ?? null,
        newName: document.querySelector('[data-ph-modal-col="new"] .ph-modal-fig-name')?.textContent ?? null,
        curIcon: !!document.querySelector('[data-ph-modal-col="current"] .ph-part-icon'),
        newIcon: !!document.querySelector('[data-ph-modal-col="new"] .ph-part-icon'),
        rows: [...document.querySelectorAll('[data-ph-modal-row]')].map((r) => ({
          k: r.getAttribute('data-ph-modal-row'),
          t: r.querySelector('.ph-modal-row-val')?.textContent ?? '',
          d: r.querySelector('[data-ph-modal-delta]')?.getAttribute('data-ph-modal-delta') ?? null,
        })),
        cancel: !!document.querySelector('[data-ph-action="modal-cancel"]'),
        go: document.querySelector('[data-ph-action="modal-replace"]')?.textContent ?? null,
        equippedBefore: build.functionalSelections?.frontMass ?? null,
      };
    });
    log(
      em.modal === 'equip' && em.slot === 'weapon' && em.curName === '炮 ★1' && em.newName === '机枪 ★2' &&
        em.curIcon && em.newIcon && em.rows.length === 2 &&
        em.rows[0].k === '攻击' && em.rows[0].d !== null && em.rows[0].d !== '' && em.rows[0].t.includes('→') &&
        em.rows[1].k === '能量' && em.rows[1].d !== null && em.rows[1].t.includes('→') &&
        em.cancel && em.go === '替换' && em.equippedBefore === 'cannon',
      '[F-06] 点卡 → 对比弹窗：当前=炮★1 / 新=机枪★2（双图形）+ 真实属性对比（攻击/能量，方向着色）；存档未变',
      JSON.stringify(em),
    );

    // F-07：【取消】零写盘
    await clickSelector(page, '[data-ph-action="modal-cancel"]');
    const afterCancel = await page.evaluate(() => {
      const p = window.__PRODUCTHOME__.probe();
      const build = JSON.parse(localStorage.getItem('strongfruit.playerBuild.v1') || '{}');
      return { modal: p.garageModal, equipped: build.functionalSelections?.frontMass ?? null };
    });
    log(
      afterCancel.modal === null && afterCancel.equipped === 'cannon',
      '[F-07] 【取消】零写盘：弹窗关闭、装备仍是 cannon（存档逐字节不变）',
      JSON.stringify(afterCancel),
    );

    // F-08：【替换】真实写盘 + 其余槽不丢
    await clickSelector(page, '[data-ph-weapon="machineGun"][data-ph-star="2"]');
    await clickSelector(page, '[data-ph-action="modal-replace"]');
    const afterGo = await page.evaluate(() => {
      const p = window.__PRODUCTHOME__.probe();
      const build = JSON.parse(localStorage.getItem('strongfruit.playerBuild.v1') || '{}');
      return {
        modal: p.garageModal,
        equipped: build.functionalSelections?.frontMass ?? null,
        star: build.functionalStars?.frontMass ?? null,
        body: build.bodyDefId,
        lastEquip: p.lastEquip,
        previewWeapon: p.previewItems.find((i) => i.onWeaponSlot)?.defId ?? null,
      };
    });
    log(
      afterGo.modal === null && afterGo.equipped === 'machineGun' && afterGo.star === 2 &&
        afterGo.body === 'watermelonBody' && afterGo.lastEquip?.ok === true && afterGo.previewWeapon === 'machineGun',
      '[F-08] 【替换】真实写盘：machineGun★2 上车、车身/轮组不丢、预览同次刷新、弹窗关闭',
      JSON.stringify(afterGo),
    );

    // F-09：零 JS 错误
    log(pageErrors.length === 0, '[F-09] 全取证零运行时报错', pageErrors.slice(0, 2).join(' | ') || 'none');
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
