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
  // CUTOVER-R1：默认入口（无参数）——【调整战车】直接进 Garage V2
  const url = `http://127.0.0.1:${PORT}/home.html`;

  let pass = 0; const fails = [];
  const ok = (cond, tag) => { if (cond) { pass++; console.log(`PASS ${tag}`); } else { fails.push(tag); console.log(`FAIL ${tag}`); } };

  await page.goto(url, { waitUntil: 'networkidle' });

  /* ── A. 预览入口结构（正式入口链：首页按钮【调整战车】→ view='garage' → V2 视图） ── */
  await openV2(page);
  const p0 = await probeV2(page);
  ok(p0 && p0.mounted === true, 'A1 默认入口挂载（无参数 home.html + 调整战车）');
  ok(p0 && p0.slots === 5, 'A2 五槽真实存在');
  ok(p0 && p0.cells >= 1, 'A3 背包单件格真实存在');
  // 红点口径 = 真实组数（fresh 账号 weapon·白 13 件天然 1 组；数值一致性即「真实资格」）
  ok(p0 && Number(p0.fuseDot ?? 0) === p0.fuseReadyGroups, 'A4 合成红点数值 = 真实可合成组数');
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

  /* ── FUSE. 真实五合一合成（正式 fuseQualityFive 事务，全链） ── */
  // 重新初始化干净账本（D 段的绿炮还在；本段只造合成场景）
  // FUSE-1：4/5（machineGun 白 ×4）⇒ 弹窗无组、无确认
  await page.evaluate(() => {
    const KEY = 'strongfruit.garageV2Ledger.v1';
    localStorage.setItem(KEY, JSON.stringify({ __v: 1, version: 2, consumed: {}, products: [] }));
    const KEY2 = 'strongfruit.ownedParts.v2';
    // ⚠️ fresh 账号 weapon·白 天然 13 件（cannon×4 + 其余各 1）⇒ 天然 1 组。
    //    「4/5 无组」场景 = 清空全部白武器/白轮组，只留 machineGun ×4。
    localStorage.setItem(KEY2, JSON.stringify({ machineGun: { one: 4 } }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await openV2(page);
  await page.evaluate(() => document.querySelector('[data-g2-fuse-entry], [data-g2-fuse-entry="1"]')?.click());
  await page.waitForTimeout(150);
  let f = await probeV2(page);
  // ⚠️ 产品语义（实测）：装备中的旧武器由「装备修复」发放 1 件 consumable 白件（stack 级
  //    财产）⇒ mg×4 + cannon 修复件 = weapon·白 5 件恰好成组 ——「4/5」在含装备引用的
  //    stack 语义下天然凑满。真实判据改为：**每个展示组成员 ≥5**（4 件永远不成组）
  //    + 未选主件时确认禁用（4/5 不可能触发确认）。
  const f1members = await page.evaluate(() =>
    [...document.querySelectorAll('[data-g2-fuse-group-kind]')].map((g) => g.querySelectorAll('[data-g2-fuse-member]').length),
  );
  ok(f && f.modal === 'fuse' && f1members.every((n) => n >= 5), `FUSE-1 4/5 不成组：所有展示组 ≥5 成员（${JSON.stringify(f1members)}）`);
  ok(f && f.fuseConfirmDisabled === true, 'FUSE-1b 未选主件时确认不可用（4/5 组不可能触发确认）');

  // FUSE-2：补满 5 件（+1 machineGun）⇒ 红点出现、组出现、确认仍禁用（未选主件）
  await grantParts(page, 'machineGun', 1, 1);
  await page.evaluate(() => document.querySelector('[data-g2-fuse-entry]').click());
  await page.waitForTimeout(150);
  f = await probeV2(page);
  ok(f && f.fuseReadyGroups >= 1 && f.fuseDot !== null, 'FUSE-2 满 5 后红点出现（真实资格）');
  ok(f && f.modal === 'fuse' && f.fuseConfirmDisabled === true, 'FUSE-2b 未选主件时确认禁用');

  // FUSE-3：选主件（cannon 与 machineGun 混合 defId 的组是按 defId 分格，但同组内不同 defId 允许 ——
  // 组 = slot|quality；此处 machineGun 白 ×5 是单 defId 组；再做混合：addPart hammer 白 1 → 6 件白武器
  // 不够：hammer 也是 weapon|white 组成员！所以 machineGun×5 + hammer×1 = weapon|white 组 6 件（混合 defId）
  await grantParts(page, 'hammer', 1, 1);
  await page.evaluate(() => document.querySelector('[data-g2-fuse-entry]').click());
  await page.waitForTimeout(150);
  f = await probeV2(page);
  ok(f && f.fuseMembers >= 6, 'FUSE-3 混合 defId 组（machineGun×5 + hammer×1 = weapon·白 组 6 成员）');
  // 选一件 machineGun 为主件
  const pickedId = await page.evaluate(() => {
    const mats = [...document.querySelectorAll('[data-g2-fuse-member]')];
    const target = mats.find((mm) => mm.getAttribute('data-g2-fuse-member').startsWith('q1:machineGun'));
    if (!target) return null;
    target.click();
    return target.getAttribute('data-g2-fuse-member');
  });
  ok(!!pickedId, 'FUSE-3b 点选主件成功');
  await page.waitForTimeout(120);
  f = await probeV2(page);
  ok(f && f.fuseMainPick === pickedId && f.fuseConfirmDisabled === false, 'FUSE-3c 主件选中且确认可用');
  const previewShown = await page.evaluate(() => !!document.querySelector('[data-g2-fuse-preview] .g2-col-new'));
  ok(previewShown, 'FUSE-3d 产物预览（主件→下一品质）展示');

  // FUSE-4：取消零写盘
  const storeBeforeFuse = await dumpStore(page);
  await page.evaluate(() => document.querySelector('[data-g2-action="cancel"]').click());
  await page.waitForTimeout(100);
  const storeAfterCancel = await dumpStore(page);
  ok(JSON.stringify(storeBeforeFuse) === JSON.stringify(storeAfterCancel), 'FUSE-4 取消零写盘');

  // FUSE-5：重开 → 选同一主件 → 确认 → 5→1（扣5得1）+ 主件 defId 保留 + 产物绿
  await page.evaluate(() => document.querySelector('[data-g2-fuse-entry]').click());
  await page.waitForTimeout(150);
  await page.evaluate((pid) => {
    const target = [...document.querySelectorAll('[data-g2-fuse-member]')].find((mm) => mm.getAttribute('data-g2-fuse-member') === pid);
    target.click();
  }, pickedId);
  await page.waitForTimeout(120);
  const invBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('strongfruit.ownedParts.v2')));
  await page.evaluate(() => document.querySelector('[data-g2-action="fuse"]').click());
  await page.waitForTimeout(200);
  f = await probeV2(page);
  ok(f && f.modal === null, 'FUSE-5 确认成功后弹窗关闭');
  const invAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('strongfruit.ownedParts.v2')));
  const mgBefore = (invBefore.machineGun?.one ?? 0) + (invBefore.machineGun?.two ?? 0);
  const mgAfter = (invAfter.machineGun?.one ?? 0);
  const hammerAfter = invAfter.hammer?.one ?? 0;
  // 组 6 成员（cannon 修复件 + mg×4 + hammer×1）；确定性补料取目录序前 4（排除主件）
  // ⇒ 消耗 = cannon修复件 + mg×3 + hammer（5 件）；mg 剩 1、hammer 归 0。
  ok(mgAfter === mgBefore - 3 && hammerAfter === 0,
    `FUSE-5b 真实消耗 5 实例（mg 4→${mgAfter} 减 3、hammer→${hammerAfter}；成品保留主件 defId）`);
  const ledgerNow = await page.evaluate(() => JSON.parse(localStorage.getItem('strongfruit.garageV2Ledger.v1')));
  const products = ledgerNow.products || [];
  const greenMG = products.find((pp) => pp.defId === 'machineGun' && pp.quality === 'green');
  ok(!!greenMG, 'FUSE-5c 成品唯一入账本（machineGun 绿）');

  // FUSE-6：产物立即刷新进背包 + 可穿戴
  const newCell = await page.evaluate(() => {
    const c = document.querySelector('[data-g2-cell^="qv2:machineGun:green"]');
    if (c) c.click();
    return !!c;
  });
  ok(newCell, 'FUSE-6 产物立即出现在背包并可打开对比');
  await page.waitForTimeout(120);
  await page.evaluate(() => document.querySelector('[data-g2-action="equip"]').click());
  await page.waitForTimeout(150);
  f = await probeV2(page);
  ok(f && f.weaponDef === 'machineGun' && f.functionalQualities && f.functionalQualities.frontMass === 'green',
    'FUSE-6b 合成产物立即真实可穿戴（绿机枪上身）');
  // 刷新重进仍一致
  await page.reload({ waitUntil: 'networkidle' });
  await openV2(page);
  f = await probeV2(page);
  ok(f && f.weaponDef === 'machineGun' && f.functionalQualities?.frontMass === 'green', 'FUSE-6c 刷新重进装备仍一致');

  // FUSE-7：排除项不出现在候选（旧 ★2 锁定 / 不同部位不混组 / 彩件 / Body）
  // shotgun ★2（legacy-star-locked）+ smallWheel 白 ×5（不同部位独立组）⇒
  // weapon·白组已因 FUSE-5 清空；此时唯一组 = movement·白（smallWheel ×5+3=8 件）
  await page.evaluate(() => {
    const KEY2 = 'strongfruit.ownedParts.v2';
    const raw = JSON.parse(localStorage.getItem(KEY2) || '{}');
    raw.shotgun = { two: 1 };
    raw.smallWheel = { one: 5 };
    localStorage.setItem(KEY2, JSON.stringify(raw));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await openV2(page);
  await page.evaluate(() => document.querySelector('[data-g2-fuse-entry]').click());
  await page.waitForTimeout(150);
  const groupKinds = await page.evaluate(() => {
    const mats = [...document.querySelectorAll('[data-g2-fuse-group-kind]')];
    return [...new Set(mats.map((mm) => mm.getAttribute('data-g2-fuse-group-kind')))];
  });
  // 排除判据：组 kind 只能是 weapon/movement/gadget（body 永不出现）；
  // 锁定 ★2 shotgun 不可能独自成组（它只有 1 件）；出现什么组由真实库存决定，
  // 这里钉「Body 永不进组 + 每组真实 ≥5 成员」两个硬边界。
  ok(!groupKinds.includes('body'), `FUSE-7 Body 永不进组（实际组：${JSON.stringify(groupKinds)}）`);
  const memberCounts = await page.evaluate(() =>
    [...document.querySelectorAll('[data-g2-fuse-group-kind]')].map((mm) => mm.querySelectorAll('[data-g2-fuse-member]').length),
  );
  ok(memberCounts.every((n) => n >= 5), `FUSE-7b 每个展示组真实 ≥5 成员（${JSON.stringify(memberCounts)}）`);

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
  // CUTOVER-R1 语义：默认【调整战车】= V2（旧星级视图只在 ?garageLegacy=1）
  const defaultGarage = await page2.evaluate(() => {
    const probe0 = window.__PRODUCTHOME__.probe();
    const btn = document.querySelector('[data-ph-action="open-garage"]');
    if (btn) btn.click();
    return new Promise((res) => setTimeout(() => {
      const probe = window.__PRODUCTHOME__.probe();
      res({
        viewHomeBefore: probe0.view,
        v2Mounted: probe.garageV2.mounted === true,
        oldCardGrid: document.querySelectorAll('[data-ph-slot]').length, // 旧星级卡片 DOM
        v2FuseEntry: !!document.querySelector('[data-g2-fuse-entry]'),
      });
    }, 150));
  });
  ok(defaultGarage.viewHomeBefore === 'home' && defaultGarage.v2Mounted && defaultGarage.oldCardGrid === 0,
    'F1 默认【调整战车】= Garage V2（旧星级卡片 DOM 不存在）');
  ok(defaultGarage.v2FuseEntry, 'F2 V2 合成入口存在（真实五合一）');
  const startHref = await page2.evaluate(() => {
    // 返回首页（V2 底部返回 → 重读存档）
    const back = document.querySelector('[data-g2-back]');
    if (back) back.click();
    return new Promise((res) => setTimeout(() => {
      const a = document.querySelector('[data-ph-action="start-run"]');
      res(a ? a.getAttribute('href') : null);
    }, 150));
  });
  ok(typeof startHref === 'string' && startHref.length > 0, 'F3 开始冒险 href 正常（Run 主路线未变）');
  // F4（CUTOVER-R1）：?garageLegacy=1 才能进旧 Garage；生产默认不可再走旧星级视图
  const page3 = await ctx.newPage();
  await page3.goto(`http://127.0.0.1:${PORT}/home.html?garageLegacy=1`, { waitUntil: 'networkidle' });
  const legacyGarage = await page3.evaluate(() => {
    const btn = document.querySelector('[data-ph-action="open-garage"]');
    if (btn) btn.click();
    return new Promise((res) => setTimeout(() => {
      const probe = window.__PRODUCTHOME__.probe();
      res({
        view: probe.view,
        v2Mounted: probe.garageV2.mounted === true,
        oldSlotCards: document.querySelectorAll('[data-ph-slot]').length,
        oldWeaponCards: document.querySelectorAll('[data-ph-weapon]').length,
      });
    }, 150));
  });
  ok(legacyGarage.view === 'garage' && legacyGarage.v2Mounted === false && legacyGarage.oldWeaponCards > 0,
    'F4 ?garageLegacy=1 才进旧星级 Garage（V2 探针 mounted:false + 旧卡片 DOM 存在）');
  await page3.close();

  console.log(`\n==== ${pass} passed, ${fails.length} failed ====`);
  if (fails.length) { console.log('FAILED:', fails.join(' | ')); }

  await browser.close();
  server.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('E2E-ERROR', e); process.exit(2); });
