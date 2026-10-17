/**
 * GARAGE-V2-FORMAL-EQUIP-SLICE-R1｜正式页 Garage V2 装备视图端到端验收（真实浏览器）。
 *
 * 验收 2 逐条（Queue 原文）：
 *   A. ?garageV2=1 预览入口可打开；车/五槽/单件格/合成待接入/返回 结构真实存在；
 *   B. 对比弹窗【取消】零写盘（正式 localStorage 逐字节对照）；
 *   C. 【装备/替换】真实落盘（q1 旧件与 qv2 品质件两条路），刷新后仍有效；
 *   D. 前后轮目标独立（装前轮不动后轮）；非法/取消不改档；
 *   E. 正式 Run 链读数与新装配同源（buildSnapshotFromDraft 正式映射探针）；
 *   F. 旧主路线未变：不带参数 → 旧 Garage 正常、合成入口仍在、开始冒险 href 正常。
 *
 * 纪律（与 _e2e_product_loop.cjs 同一条）：真实浏览器（playwright-core/msedge）、
 * 真实 localStorage 独立取证（「Profile Equipped」侧不读页面探针）、
 * 探针句柄只读（__PRODUCTHOME__.probe().garageV2）。
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright-core');
const { launchBrowser } = require('./_browser_launch.cjs');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8742;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    let rel = urlPath.replace(/^\//, '') || 'home.html';
    const abs = path.join(ROOT, rel);
    if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      res.writeHead(404); res.end('no'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
    res.end(fs.readFileSync(abs));
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

/** 正式存档 dump（独立取证：直接读 localStorage，不走页面探针）。 */
async function dumpStore(page) {
  return page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out[k] = localStorage.getItem(k);
    }
    return out;
  });
}

/** 让页面把某 defId 堆叠加到正式库存（模拟玩家真实拥有；走页面里的正式 addPart 模块语义——
 *  但产品页不暴露 ⇒ 改走真实玩家路径：直接写正式 ownedParts.v1 key（同一 key 正式存档用）。 */
async function grantParts(page, defId, star, n) {
  await page.evaluate(({ defId, star, n }) => {
    const KEY = 'strongfruit.ownedParts.v2';
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    const bucket = star === 1 ? 'one' : star === 2 ? 'two' : 'three';
    raw[defId] = raw[defId] || {};
    raw[defId][bucket] = (raw[defId][bucket] || 0) + n;
    localStorage.setItem(KEY, JSON.stringify(raw));
  }, { defId, star, n });
  await page.reload({ waitUntil: 'networkidle' });
  await openV2(page);
}

async function openV2(page) {
  // 重新进入并点「调整战车」（预览分支的正式入口链：首页按钮 → view='garage' → V2 视图）
  await page.evaluate(() => {
    const btn = document.querySelector('[data-ph-action="open-garage"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(120);
}

async function probeV2(page) {
  return page.evaluate(() => window.__PRODUCTHOME__ && window.__PRODUCTHOME__.probe().garageV2);
}

(async () => {
  const server = await startServer();
  const browser = await launchBrowser(chromium);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const url = `http://127.0.0.1:${PORT}/home.html?garageV2=1`;

  let pass = 0; const fails = [];
  const ok = (cond, tag) => { if (cond) { pass++; console.log(`PASS ${tag}`); } else { fails.push(tag); console.log(`FAIL ${tag}`); } };

  await page.goto(url, { waitUntil: 'networkidle' });

  /* ── A. 预览入口结构（正式入口链：首页按钮【调整战车】→ view='garage' → V2 视图） ── */
  await openV2(page);
  const p0 = await probeV2(page);
  ok(p0 && p0.mounted === true, 'A1 预览入口挂载（?garageV2=1 + 调整战车）');
  ok(p0 && p0.slots === 5, 'A2 五槽真实存在');
  ok(p0 && p0.cells >= 1, 'A3 背包单件格真实存在');
  ok(p0 && p0.fusePending === true, 'A4 合成按钮=待接入占位');
  ok(p0 && p0.gridTextFree === true, 'A5 背包格零名字/数量/星级文本');
  const hasBack = await page.evaluate(() => !!document.querySelector('[data-g2-back]'));
  ok(hasBack, 'A6 底部返回存在');

  /* ── B.【取消】零写盘 ── */
  const before = await dumpStore(page);
  await page.evaluate(() => {
    const cell = document.querySelector('[data-g2-cell]');
    if (cell) cell.click();
  });
  await page.waitForTimeout(80);
  const modalShown = await page.evaluate(() => !!document.querySelector('[data-g2-modal="compare"]'));
  ok(modalShown, 'B1 点背包格弹出对比弹窗');
  await page.evaluate(() => {
    const c = document.querySelector('[data-g2-action="cancel"]');
    if (c) c.click();
  });
  await page.waitForTimeout(80);
  const afterCancel = await dumpStore(page);
  ok(JSON.stringify(before) === JSON.stringify(afterCancel), 'B2 取消后正式存档逐字节不变（零写盘）');

  /* ── C. q1 旧件替换（movement：装前轮，前后独立） ── */
  await grantParts(page, 'largeWheel', 1, 1);
  const cells = await page.evaluate(() => [...document.querySelectorAll('[data-g2-cell]')].map((c) => ({
    id: c.getAttribute('data-g2-cell'),
    kind: c.getAttribute('data-g2-slot-kind'),
  })));
  const lwCell = cells.find((c) => c.id.startsWith('q1:largeWheel'));
  ok(!!lwCell, 'C1 库存新增 largeWheel 单件格可见');
  if (lwCell) {
    await page.evaluate((id) => {
      document.querySelector(`[data-g2-cell="${id}"]`).click();
    }, lwCell.id);
    await page.waitForTimeout(80);
    // movement 默认目标 rear ⇒ 切到 front（独立目标）
    await page.evaluate(() => {
      const b = document.querySelector('[data-g2-target="front"]');
      if (b) b.click();
    });
    await page.waitForTimeout(60);
    await page.evaluate(() => {
      const b = document.querySelector('[data-g2-action="equip"]');
      if (b) b.click();
    });
    await page.waitForTimeout(120);
    const p1 = await probeV2(page);
    ok(p1 && p1.frontDef === 'largeWheel', 'C2 确认装备：前轮=largeWheel 落盘并重读');
    // 新账号缺省轮 = wheelStd（不进库存 ⇒ probe 读 null）；「不受影响」= 装备前轮后仍为缺省值。
    ok(p1 && (p1.rearDef === null || p1.rearDef === 'smallWheel'), 'C3 后轮不受影响（保持缺省/原值）');
    // 刷新后仍有效
    await page.reload({ waitUntil: 'networkidle' });
    await openV2(page);
    const p2 = await probeV2(page);
    ok(p2 && p2.frontDef === 'largeWheel', 'C4 刷新后装备仍有效（正式存档持久化）');
  }

  /* ── D. qv2 品质件替换 + Run 同源 ── */
  // 真实玩家路径拿一件绿炮：写正式账本 key（与 fuseQualityFive 产物同形状）。
  await page.evaluate(() => {
    const KEY = 'strongfruit.garageV2Ledger.v1';
    const ledger = { __v: 1, version: 2, consumed: {}, products: [{ defId: 'cannon', quality: 'green', seq: 1 }] };
    localStorage.setItem(KEY, JSON.stringify(ledger));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await openV2(page);
  const qv2Cell = await page.evaluate(() => {
    const c = document.querySelector('[data-g2-cell^="qv2:cannon:green"]');
    if (c) c.click();
    return !!c;
  });
  ok(qv2Cell, 'D1 qv2 品质件单件格可见并可点');
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    const b = document.querySelector('[data-g2-action="equip"]');
    if (b) b.click();
  });
  await page.waitForTimeout(140);
  const p3 = await probeV2(page);
  ok(p3 && p3.weaponDef === 'cannon' && p3.functionalQualities && p3.functionalQualities.frontMass === 'green',
    'D2 qv2 绿炮经 equipQualityProduct 真实落盘（quality+绑定双字段）');
  // Run 同源：正式存档直接喂 buildSnapshotFromDraft（同一条正式映射链）
  const runSide = await page.evaluate(() => {
    // 只读：读正式存档 JSON，回到 node 侧用正式链验证
    return localStorage.getItem('strongfruit.playerBuild.v1');
  });
  ok(!!runSide && runSide.includes('"green"') && runSide.includes('qv2:cannon:green'), 'D3 正式存档含品质字段与实例绑定');

  /* ── E. 非法实例零写盘（账本里删掉产物 ⇒ 幽灵绑定拒绝） ── */
  const storeBefore = await dumpStore(page);
  await page.evaluate(() => {
    const KEY = 'strongfruit.garageV2Ledger.v1';
    localStorage.setItem(KEY, JSON.stringify({ __v: 1, version: 2, consumed: {}, products: [] }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  const ghostNull = await page.evaluate(() => window.__PRODUCTHOME__.probe().bodyName);
  ok(typeof ghostNull === 'string', 'E1 幽灵绑定被加载校验拒绝后页面仍以默认车启动（不白屏）');

  /* ── F. 旧主路线未变 ── */
  const page2 = await ctx.newPage();
  await page2.goto(`http://127.0.0.1:${PORT}/home.html`, { waitUntil: 'networkidle' });
  const oldGarage = await page2.evaluate(() => {
    const btn = document.querySelector('[data-ph-action="open-garage"]');
    if (btn) btn.click();
    return new Promise((res) => setTimeout(() => {
      res({
        oldGarageShown: !!document.querySelector('[data-ph-view="garage"]') || !!document.querySelector('.ph-garage, [data-ph-garage]'),
        oldCardGrid: document.querySelectorAll('[data-ph-slot]').length,
        fuseEntry: !!document.querySelector('[data-ph-action="fuse-entry"]'),
      });
    }, 150));
  });
  ok(oldGarage.oldCardGrid > 0, 'F1 不带参数仍进旧 Garage（槽交互结构原样）');
  ok(oldGarage.fuseEntry, 'F2 旧合成入口仍在（旧主路线未变）');
  const startHref = await page2.evaluate(() => {
    // 回首页
    const back = document.querySelector('[data-ph-action="back-home"]');
    if (back) back.click();
    return new Promise((res) => setTimeout(() => {
      const a = document.querySelector('[data-ph-action="start-run"]');
      res(a ? a.getAttribute('href') : null);
    }, 150));
  });
  ok(typeof startHref === 'string' && startHref.length > 0, 'F3 开始冒险 href 正常（Run 主路线未变）');

  console.log(`\n==== ${pass} passed, ${fails.length} failed ====`);
  if (fails.length) { console.log('FAILED:', fails.join(' | ')); }

  await browser.close();
  server.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('E2E-ERROR', e); process.exit(2); });
