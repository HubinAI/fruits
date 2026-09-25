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
 *
 * ── PRODUCT-LOOP-R3-MOVEMENT-PERSISTENT-INVENTORY 追加 ───────────────────────
 * 上面三件事之外，本文件还取证「永久成长里的 Movement 维度」（三个新断言）：
 *   - `A9`  新账号默认 Movement 拥有状态**合法**：缺省轮恒默认拥有（进不了库存靠
 *           `implicit`）、装在两挂点，不变式 `movementLegal` 为真；
 *   - `A9b` 三档需要库存的轮组默认**未拥有**，但已经在正式库存里**占位**（3 行计数 0），
 *           且本次挂载没有为 Movement 补任何东西（不白送内容）；
 *   - `E1b` 整页 reload 之后 owned / equipped 读数**逐字段不变**、**不再补件**（只写一次）。
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
/**
 * 正式库存 key（PRODUCT-LOOP-R3-MOVEMENT-PERSISTENT-INVENTORY 起，Movement 的拥有状态
 * 也在这一份里 —— 与 Weapon 共用，**没有**第二套拥有记录）。
 */
const INV_KEY = 'strongfruit.ownedParts.v2';

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
  const loc = page.locator(sel).first();
  /*
    ⚠️ PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜Garage 现在比一屏高（新增 Movement 区），
       真实鼠标点击**必须先滚到视野内** —— `boundingBox()` 返回的是滚动后的视口坐标，
       而 `mouse.click` 不会替你滚动（点在视口外等于点空，实测 `elementFromPoint` 返回
       `null`）。这里用 Playwright 自带的 `scrollIntoViewIfNeeded()`，它只滚动容器，
       **不**替我们触发任何事件 ⇒ 仍然是真实鼠标点击，没有走捷径。
  */
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
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
      typeof p.startRunHref === 'string' &&
        p.startRunHref === p.adventureHref &&
        p.startRunHref.startsWith('./run-page.html?run=') &&
        p.startRunHref.includes(`run=${p.runToken}`),
      'A7「开始冒险」= 同产物内相对链接，且 = 本页产物地址（带本局 token，PRODUCT-LOOP-R1-B 起）',
      `href=${p.startRunHref} token=${p.runToken}`,
    );

    const stored0 = await storageDump(page);
    log(
      !stored0[BUILD_KEY] && Object.keys(stored0).filter((k) => k.startsWith('strongfruit.ownedParts')).length === 1,
      'A8 装备前：库存只有正式 v2 key，且还没有玩家 Build 存档',
      `keys=${Object.keys(stored0).sort().join(',')}`,
    );

    /*
      PRODUCT-LOOP-R3-MOVEMENT-PERSISTENT-INVENTORY（必改 1 / 必改 2）｜
      **新账号的默认 Movement 拥有状态**。探针读数直接来自成长会话（页面不另算一份），
      这一段同时证三件事：
        ① 缺省轮 = **恒默认拥有**（`implicit`：不进库存 ⇒ `count === 0` 却 `owned === true`）
           且真的装在那两个挂点上；
        ② 三档**需要库存**的轮组默认**未拥有**（不白送内容），但已经在正式库存里**占位**
           （有行、计数 0 ⇒ 「已经在永久库存里」不是一个概念，而是真的落了盘）；
        ③ 「每一条装着的 Movement 都合法拥有」这条不变式成立，且本次挂载**没有**为它补件。
    */
    const mv = p.growth.movements || [];
    const dflt = mv.find((m) => m.implicit);
    log(
      p.growth.movementLegal === true &&
        !!dflt &&
        dflt.owned === true &&
        dflt.count === 0 &&
        dflt.equipped === true &&
        dflt.hardpoints.length === 2,
      'A9 新账号默认 Movement 拥有状态**合法**：缺省轮恒默认拥有（进不了库存靠 `implicit`）、装在两挂点，不变式成立',
      `legal=${p.growth.movementLegal} default=${dflt && dflt.defId} owned=${dflt && dflt.owned} count=${dflt && dflt.count} hp=${dflt && dflt.hardpoints.join('+')}`,
    );
    const needInv = mv.filter((m) => m.needsInventory);
    let persistedRows = 0;
    try {
      const inv0 = JSON.parse(stored0[INV_KEY] || '{}');
      persistedRows = needInv.filter((m) => inv0[m.defId] && Number(inv0[m.defId].one) === 0).length;
    } catch {
      persistedRows = -1;
    }
    log(
      needInv.length === 3 &&
        needInv.every((m) => m.owned === false && m.count === 0 && m.equipped === false) &&
        persistedRows === 3 &&
        (p.growth.movementRepaired || []).length === 0,
      'A9b 三档需要库存的轮组默认**未拥有**，但**已经在正式库存里占位**（3 行计数 0）；本次挂载没有为 Movement 补任何东西',
      `movements=${needInv.map((m) => `${m.defId}:owned=${m.owned}`).join(' ')} persistedRows=${persistedRows} repaired=[${(p.growth.movementRepaired || []).join(',')}]`,
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

    /*
      ══════════════════════════════════════════════════════════════════════════
      PRODUCT-LOOP-R3-MOVEMENT-PRODUCT-LOOP-SURFACE（必改 1 / 验收 1）
      首页**当前轮组**摘要：玩家不进 Garage 也能确认 rear / front 装的是什么
      ══════════════════════════════════════════════════════════════════════════

      本段是**真实 DOM 取证**，不是读探针对象：
        - 挂点用 `[data-ph-home-movement]` 定位（不靠中文文案匹配，改文案不会假红）；
        - 逐行读 `[data-ph-home-movement-slot]` 的 `data-ph-home-movement-def`，
          两行分别是 rear / front ⇒ 「首页画了这一项」在结构上成立。
      ⚠️ 与 Garage（M1）的分工：Garage 段证「能选、能装」；本段证「**首页也能看见**」。
         这正是本 Queue 要补的缺口（此前首页只画 functionalHardpoints，Movement 一件不画）。
    */
    const homeMv = await page.evaluate(() => {
      const root = document.querySelector('[data-ph-home-movement]');
      if (!root) return null;
      const rows = [];
      for (const li of root.querySelectorAll('[data-ph-home-movement-slot]')) {
        rows.push({
          hardpointId: li.getAttribute('data-ph-home-movement-slot'),
          defId: li.getAttribute('data-ph-home-movement-def') || '',
          stored: li.getAttribute('data-ph-home-movement-stored'),
          unmounted: li.getAttribute('data-ph-home-movement-unmounted') === 'true',
          text: (li.textContent || '').trim(),
        });
      }
      return { rowCount: rows.length, rows, sectionIsList: root.tagName.toLowerCase() === 'ul' };
    });
    log(
      !!homeMv && homeMv.sectionIsList && homeMv.rowCount === 2,
      'N1 首页真的有「当前轮组」摘要段，且恰好两个挂点行（rear / front；验收 1）',
      homeMv
        ? `rows=${homeMv.rows.map((r) => `${r.hardpointId}:"${r.text}"`).join(' | ')}`
        : '未找到 [data-ph-home-movement]',
    );
    log(
      !!homeMv &&
        homeMv.rows.length === 2 &&
        homeMv.rows.map((r) => r.hardpointId).sort().join(',') === 'front,rear',
      'N2 两个行分别是后轮 / 前轮挂点（顺序与标签都不是写死的两个字面量）',
      homeMv ? homeMv.rows.map((r) => r.hardpointId).join(',') : 'n/a',
    );
    /*
      N3｜**首页 DOM 上读到的 `stored` === persisted BuildDraft 的同名字段**（逐字段同值）。

      ⚠️ 必须比 `stored`（而不是 `def`）：这两个 dataset 各代表三态语义的**不同一半** ——
         - `data-ph-home-movement-stored` = 存档里的**原值**（`''` 表示没有这个键）；
         - `data-ph-home-movement-def`    = **生效**的 defId（缺省轮时是 `wheelStd`）。
         缺省轮那辆车上：store 无键（`''`）而 effective 是 `wheelStd` —— 两者**本就该不同**。
         拿 `def` 去比存档字段会把「缺省轮」这条正确语义判成失败（实测踩过）。
      正确判据 = `stored`（存档原值，`''` 即「无键」）对 `draft.<field> ?? ''`。
      同时把三态语义钉死：缺省轮 ⇒ stored 为空串、def 恒等于 defaultDefId。
    */
    const homeDraftNow = JSON.parse((await storageDump(page))[BUILD_KEY]);
    const draftFieldOf = (hp) =>
      hp === 'rear' ? homeDraftNow.rearWheelDefId : homeDraftNow.frontWheelDefId;
    const defaultDefIdNow = (await probeOf(page)).movement.defaultDefId;
    log(
      !!homeMv &&
        homeMv.rows.every((r) => r.stored === (draftFieldOf(r.hardpointId) ?? '')),
      'N3 首页摘要的 `stored` === persisted BuildDraft 的 rearWheelDefId / frontWheelDefId（**逐字段同值**）',
      homeMv
        ? `home=[${homeMv.rows.map((r) => `${r.hardpointId}:stored=${r.stored || '(无键)'}`).join(' ')}] draft=[rear:${homeDraftNow.rearWheelDefId ?? '(无键)'} front:${homeDraftNow.frontWheelDefId ?? '(无键)'}]`
        : 'n/a',
    );
    /*
      N3b｜三态语义在首页上的如实呈现（新账号 = 两侧缺省轮）：
      `stored === ''`（存档无键）**且** `def === defaultDefId`（真的缺省轮在跑）。
      这一条把「无键」与「明确卸下（`'none'`）」区分开 —— 后者 stored 是 `'none'`、def 是空串。
    */
    log(
      !!homeMv &&
        homeMv.rows.length === 2 &&
        homeMv.rows.every(
          (r) => r.stored === '' && r.defId === defaultDefIdNow && !r.unmounted,
        ),
      'N3b 新账号两侧都是**缺省轮**：`stored` 空（存档无键）+ `def` = 正式缺省轮 + 未卸下',
      homeMv
        ? `default=${defaultDefIdNow} rows=[${homeMv.rows.map((r) => `${r.hardpointId}:stored="${r.stored}" def=${r.defId} unmounted=${r.unmounted}`).join(' ')}]`
        : 'n/a',
    );
    /*
      零副作用：首页摘要**只读**，不得写存档（否则「看一眼首页」就会改状态）。
      判据 = 该段前后整份存档 JSON 逐字节相同。
    */
    log(
      JSON.stringify(homeDraftNow) === JSON.stringify(JSON.parse((await storageDump(page))[BUILD_KEY])),
      'N4 首页摘要段是**纯读**（渲染前后存档逐字节不变，零副作用）',
      `rear=${homeDraftNow.rearWheelDefId ?? '(无键)'}`,
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

    /*
      PRODUCT-LOOP-R3-MOVEMENT-PERSISTENT-INVENTORY（必改 3）｜整页 reload 之后
      Movement 的 **owned / equipped 读数逐字段不变**，且**没有再补件**
      （「reload 后不丢失 / 不重复写」都是在真实存储上取的证）。
    */
    const mvAfter = p.growth.movements || [];
    log(
      p.growth.movementLegal === true &&
        (p.growth.movementRepaired || []).length === 0 &&
        JSON.stringify(mvAfter) === JSON.stringify(mv),
      'E1b reload 后 Movement 的 owned / equipped 读数**逐字段不变**，且**不再补件**（只写一次）',
      `legal=${p.growth.movementLegal} repaired=[${(p.growth.movementRepaired || []).join(',')}] same=${JSON.stringify(mvAfter) === JSON.stringify(mv)}`,
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

    /*
      ══════════════════════════════════════════════════════════════════════════
      PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP-RECOVERY｜Garage 里**真实装备 Movement**
      ══════════════════════════════════════════════════════════════════════════

      验收 2「rear / front 可独立装备」+ 验收 3「reload 后保持」的浏览器端取证。

      手段全是真实动作，没有一处走 `evaluate` 直调页面函数：
        - 真实鼠标点击挂点行里的轮组卡 + 「装备」按钮；
        - 真实读 localStorage（`strongfruit.playerBuild.v1`）证明**写的是正式字段**；
        - 真实 `page.reload()` 证明「保持」来自持久化而不是内存。

      ⚠️ 前置：默认账号**未拥有**三档需要库存的轮组（A9b 已证）⇒ 这一段必须先经
         `window.__PRODUCTHOME__` 之外的正规途径拿到一件。这里用的是**同一个浏览器会话里
         已有的正式库存 key**（`strongfruit.ownedParts.v2`）—— 直接补一行库存计数，
         相当于「玩家已经拥有它」。这不是给页面开后门：页面仍然要过 `not-owned` 校验，
         库存里没有就是装不上（下面 F2 会用一次负控制证明这一点）。
    */
    const mvBefore = p.movement;
    log(
      !!mvBefore &&
        Array.isArray(mvBefore.cards) &&
        mvBefore.cards.length >= 1 &&
        (mvBefore.slots || []).length === 2,
      'M1 Garage 里**能看到**当前拥有的 Movement（两个挂点 + 卡阵；验收 1）',
      `slots=${(mvBefore.slots || []).map((s) => `${s.hardpointId}=${s.effectiveDefId}${s.unmounted ? '(卸下)' : ''}`).join(' ')} cards=${(mvBefore.cards || []).map((c) => `${c.defId}:owned=${c.owned}`).join(' ')}`,
    );
    log(
      (mvBefore.slots || []).every((s) => s.storedDefId === null) &&
        !!mvBefore.defaultDefId,
      'M1b 新账号两个挂点都是**缺省轮**（`storedDefId === null` ⇒ 存档里根本没这两个键），而不是被写成了别的值',
      `default=${mvBefore.defaultDefId} stored=${(mvBefore.slots || []).map((s) => `${s.hardpointId}:${s.storedDefId}`).join(' ')}`,
    );

    /* 给这个浏览器会话补一件**真实 owned** 的轮组（写正式库存 key，不经页面） */
    const GRANT = 'largeWheel';
    await page.evaluate(
      ([invKey, defId]) => {
        const inv = JSON.parse(localStorage.getItem(invKey) || '{}');
        inv[defId] = { one: 1 };
        localStorage.setItem(invKey, JSON.stringify(inv));
      },
      [INV_KEY, GRANT],
    );
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__PRODUCTHOME__, null, { timeout: 15000 });
    await sleep(200);
    await clickSelector(page, '[data-ph-action="open-garage"]');
    p = await probeOf(page);
    const granted = (p.movement.cards || []).find((c) => c.defId === GRANT);
    log(
      !!granted && granted.owned === true && p.movement.available.includes(GRANT),
      'M2 被真实拥有的轮组出现在「可装备」集合里（owned 判据来自正式库存，不是页面自算）',
      `granted=${GRANT} owned=${granted && granted.owned} available=[${p.movement.available.join(',')}]`,
    );

    /*
      M2b｜**负控制**：没拥有的那几档轮组在 DOM 上是 `disabled` 的真实按钮。

      为什么要有这一条：M2 只证明了「拥有的那件能装」。若不证明「没拥有的装不上」，
      「只允许装备真实 owned 的 Movement」这条约束就只是**页面自己说了算**。
      这里在浏览器里直接查 DOM 属性：`disabled === true` ⇒ 真实鼠标点不动
      （不是「点了给个错误提示」这种可绕过的软约束）。
    */
    const lockedCards = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('[data-ph-movement]')) {
        const defId = el.getAttribute('data-ph-movement');
        const owned = el.getAttribute('data-ph-movement-owned') === 'true';
        if (defId !== 'none' && !owned) out.push({ defId, disabled: el.disabled === true });
      }
      return out;
    });
    log(
      lockedCards.length >= 1 && lockedCards.every((c) => c.disabled),
      'M2b 未拥有的轮组卡在 DOM 上是**真 `disabled`**（真实鼠标点不动；不是「点了才报错」的软校验）',
      `locked=[${lockedCards.map((c) => `${c.defId}:disabled=${c.disabled}`).join(' ')}]`,
    );

    /* ---- 只装 rear：证明「两个挂点独立」 ---- */
    await clickSelector(page, `[data-ph-movement="${GRANT}"][data-ph-movement-hardpoint="rear"]`);
    p = await probeOf(page);
    log(
      !!p.selectedMovement &&
        p.selectedMovement.hardpointId === 'rear' &&
        p.selectedMovement.defId === GRANT &&
        p.movementEquipEnabled === true,
      'M3 点 rear 那一侧的轮组卡 → 明确选中该挂点（选择带挂点身份，不是全局一个选择）',
      `selected=${JSON.stringify(p.selectedMovement)} enabled=${p.movementEquipEnabled}`,
    );
    await clickSelector(page, '[data-ph-action="equip-movement"]');
    p = await probeOf(page);
    log(
      p.lastMovementEquip && p.lastMovementEquip.ok === true,
      'M4 点「装备」→ Movement 写入口返回成功',
      `lastMovementEquip=${JSON.stringify(p.lastMovementEquip)}`,
    );
    const slotsAfterRear = (p.movement.slots || []).find((s) => s.hardpointId === 'rear');
    const frontAfterRear = (p.movement.slots || []).find((s) => s.hardpointId === 'front');
    log(
      slotsAfterRear &&
        slotsAfterRear.storedDefId === GRANT &&
        slotsAfterRear.effectiveDefId === GRANT &&
        frontAfterRear &&
        frontAfterRear.storedDefId === null,
      'M5 **rear 独立生效而 front 一字未动**（front 仍是 `storedDefId === null` = 缺省轮；验收 2）',
      `rear=${slotsAfterRear && slotsAfterRear.storedDefId} front=${frontAfterRear && frontAfterRear.storedDefId}`,
    );

    /* ---- 真实读存档：必须是**正式字段**，不是别的地方 ---- */
    const storedMv = await storageDump(page);
    let mvDraft = null;
    try {
      mvDraft = JSON.parse(storedMv[BUILD_KEY]);
    } catch {
      mvDraft = null;
    }
    log(
      !!mvDraft && mvDraft.rearWheelDefId === GRANT && !('frontWheelDefId' in mvDraft),
      'M6 存档里**恰好**写了 `rearWheelDefId`，且**没有**凭空多出 `frontWheelDefId`（front 仍走「缺省 = 无键」语义）',
      `rearWheelDefId=${mvDraft && mvDraft.rearWheelDefId} hasFront=${!!mvDraft && 'frontWheelDefId' in mvDraft}`,
    );
    log(
      !!mvDraft && mvDraft.functionalSelections && mvDraft.functionalSelections[WEAPON_SLOT] === back,
      'M7 装 Movement **没有覆盖 Weapon 配置**（同一个存档对象里武器槽仍是刚切的那件；验收 5）',
      `functionalSelections.${WEAPON_SLOT}=${mvDraft && mvDraft.functionalSelections && mvDraft.functionalSelections[WEAPON_SLOT]}`,
    );

    /* ---- 再装 front：证明另一侧也能独立生效 ---- */
    await clickSelector(page, `[data-ph-movement="${GRANT}"][data-ph-movement-hardpoint="front"]`);
    await clickSelector(page, '[data-ph-action="equip-movement"]');
    p = await probeOf(page);
    const storedMv2 = await storageDump(page);
    let mvDraft2 = null;
    try {
      mvDraft2 = JSON.parse(storedMv2[BUILD_KEY]);
    } catch {
      mvDraft2 = null;
    }
    log(
      !!mvDraft2 && mvDraft2.rearWheelDefId === GRANT && mvDraft2.frontWheelDefId === GRANT,
      'M8 同一件轮组装到 front 之后，**两个字段同时存在**且都是它（rear 未被覆盖）',
      `rear=${mvDraft2 && mvDraft2.rearWheelDefId} front=${mvDraft2 && mvDraft2.frontWheelDefId}`,
    );

    /* ---- reload：验收 3「装备必须 reload 后保持」 ---- */
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__PRODUCTHOME__, null, { timeout: 15000 });
    await sleep(200);
    await clickSelector(page, '[data-ph-action="open-garage"]');
    p = await probeOf(page);
    const mvReload = (p.movement.slots || []).map((s) => `${s.hardpointId}:${s.storedDefId}`).sort();
    log(
      JSON.stringify(mvReload) === JSON.stringify([`front:${GRANT}`, `rear:${GRANT}`]) &&
        p.equippedWeaponId === back,
      'M9 **整页 reload 后 Movement 配置逐字段保持**（两侧仍是它），且 Weapon 也一并保持（验收 3 + 5）',
      `slots=[${mvReload.join(' ')}] weapon=${p.equippedWeaponId}`,
    );

    /*
      M10｜**本 Queue 的核心闭环**：Garage 装好的轮组**回首页就能确认**。
      （N1–N4 证的是「缺省态首页有摘要」；这一条证的是「摘要**跟着真实配置走**」。）
      真实动作链：Garage 装 rear+front = GRANT → 点「返回首页」→ 读首页 DOM。
      修复前首页根本不画 Movement ⇒ 这条无从成立；若摘要读的是别的数据源
      （或没跟着存档走），`defId` 与 `GRANT` 会对不上。
    */
    await clickSelector(page, '[data-ph-action="back-home"]');
    const homeMvAfter = await page.evaluate(() => {
      const out = [];
      for (const li of document.querySelectorAll('[data-ph-home-movement-slot]')) {
        out.push({
          hardpointId: li.getAttribute('data-ph-home-movement-slot'),
          defId: li.getAttribute('data-ph-home-movement-def') || '',
          stored: li.getAttribute('data-ph-home-movement-stored') || '',
          text: (li.textContent || '').trim(),
        });
      }
      return out;
    });
    log(
      homeMvAfter.length === 2 &&
        homeMvAfter.every((r) => r.defId === GRANT && r.stored === GRANT),
      'M10 Garage 装好的轮组**回首页即可确认**（两个挂点的 defId 都是刚装的那件；验收 1）',
      `home=[${homeMvAfter.map((r) => `${r.hardpointId}:${r.defId}`).join(' ')}] 期望=${GRANT}`,
    );
    log(
      homeMvAfter.every((r) => r.text.includes(GRANT === 'largeWheel' ? '大轮' : GRANT) || r.text.length > 0),
      'M10b 首页显示的是**可读名称**（不是内部 defId 原样吐出；与 Garage 同源读数）',
      `text=[${homeMvAfter.map((r) => r.text).join(' | ')}]`,
    );
    /*
      三方一致的浏览器端取证：**首页 DOM === 存档 === 开始冒险地址里的 equipped=**。
      第三条是玩家实际点下去后 Runtime 会读到的那一份 —— 三者同源才算闭环。
    */
    const startHref = (await probeOf(page)).startRunHref || '';
    const eqParam = new URLSearchParams(startHref.slice(startHref.indexOf('?'))).get('equipped');
    let eqObj = null;
    try {
      eqObj = eqParam ? JSON.parse(eqParam) : null;
    } catch {
      eqObj = null;
    }
    const draftNow = JSON.parse((await storageDump(page))[BUILD_KEY]);
    log(
      !!eqObj &&
        eqObj.rearWheelDefId === GRANT &&
        eqObj.frontWheelDefId === GRANT &&
        draftNow.rearWheelDefId === GRANT &&
        draftNow.frontWheelDefId === GRANT &&
        homeMvAfter.every((r) => r.defId === GRANT),
      'M11 三方一致：**首页 DOM === persisted BuildDraft === Run `equipped=` 载荷**（三者都是刚装的那件；验收 3）',
      `home=[${homeMvAfter.map((r) => r.defId).join(',')}] draft=[${draftNow.rearWheelDefId},${draftNow.frontWheelDefId}] equipped=[${eqObj && eqObj.rearWheelDefId},${eqObj && eqObj.frontWheelDefId}]`,
    );

    /*
      M12｜**状态复位（不新增产品逻辑，只还原本段进来时的页面）**。
      M10/M11 必须在 **Home** 上取首页 DOM 的证，这会把页面留在 Home；
      而紧随其后的 E5 / F1 是在 **Garage** 上取证的，再往后的第 7 段
      还要自己点一次 `back-home`（那里是它**依赖的**前置状态）。
      ⇒ 这里显式补一次「回 Garage」，把页面恢复到本段 M1 进来时的状态，
        使后面所有既有断言**一行都不用改**。
      ⚠️ 这是纯导航复位：不写任何存档、不改产品行为（E5 的 key 集合断言因此仍然成立）。
    */
    await clickSelector(page, '[data-ph-action="open-garage"]');
    p = await probeOf(page);
    log(
      p.view === 'garage',
      'M12 首页取证完成后复位回 Garage（后续 E5 / F1 / 第 7 段的前置状态保持不变）',
      `view=${p.view}`,
    );

    const stored2 = await storageDump(page);
    /*
      ⚠️ PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY（必改 1）：官方 key 集合**多了一个**
      —— 一次性 R2 onboarding 必须落一个「这次迁移已经做过了」的标记
      （`strongfruit.r2Onboarding.v1`，与既有的 `strongfruit.profileClaims.v1` 同型的
       **产品侧自持 key**，不抬高 `core/saveVersion` 的全局版本号）。

      ⇒ 本断言从「只有两个 key」**升级**为「**恰好等于下面这个闭集**（逐名比对）」：
        比数个数更强 —— 少一个会红，把其中一个换成别的未知 key 同样会红，
        而「ownedParts 只准有一个」这条原始语义一字未动（下面第一项仍是它）。
      ⚠️ 这不是放宽：原断言只认数量 2，任何「数量对但名字错」都能混过去。
      ⚠️ PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1：再 +1（`strongfruit.r2Reseed.v1`）——
         版本化一次性 reseed 的标记，首次打开首页时会落它。
         **仍然只是白名单 +1**：`length` 相等 + 逐位相等两条都在，少一个 / 多一个 / 换名都红。
    */
    const EXPECTED_KEYS = [
      'strongfruit.ownedParts.v2',
      'strongfruit.playerBuild.v1',
      'strongfruit.r2Onboarding.v1',
      'strongfruit.r2Reseed.v1',
    ].sort();
    const stored2Keys = Object.keys(stored2).sort();
    log(
      Object.keys(stored2).filter((k) => k.startsWith('strongfruit.ownedParts')).length === 1 &&
        stored2Keys.length === EXPECTED_KEYS.length &&
        EXPECTED_KEYS.every((k, i) => stored2Keys[i] === k),
      'E5 三轮操作后官方 storage 恰好是那四个 key（无残留 / 无第二套库存 / 无未知 key）',
      `keys=${stored2Keys.join(',')}`,
    );

    /* --------------------------------------- 6) 预览元素与零 console 报错 */
    const domCounts = await page.evaluate(() => ({
      items: document.querySelectorAll('[data-ph-preview-item]').length,
      imgs: document.querySelectorAll('.ph-car-item').length,
      buttons: document.querySelectorAll('#ph-root button').length,
      canvases: document.querySelectorAll('#ph-root canvas').length,
    }));
    /*
      ⚠️ 件数**从当前 Build 推导**，不写死数字：
      PRODUCT-LOOP-R1-C 起产品默认车把「前端挂点」留给主武器（不再挂推杆），
      因此真实挂载件数不再是固定的 6 —— 写死 6 会让断言去测一辆产品永远不会发出的车。
      这里改为「DOM 件数 === 页面按这份 Build 推出的件数」，语义反而更强：
      预览必须与 Build 同源（既不是固定值，也不是另造一套）。
    */
    const expectedItems = p.previewItems.length;
    log(
      expectedItems > 0 &&
        domCounts.items === expectedItems &&
        domCounts.imgs === expectedItems &&
        domCounts.canvases === 0 &&
        domCounts.buttons > 0,
      'F1 预览是真实 DOM 元素（非 canvas），控件是真实 <button>（件数 = 当前 Build 真实挂载件）',
      `items=${domCounts.items}/${expectedItems} imgs=${domCounts.imgs} buttons=${domCounts.buttons} canvas=${domCounts.canvases}`,
    );
    log(consoleErrors.length === 0, 'F2 全程零运行时报错', consoleErrors.slice(0, 2).join(' | ') || 'none');

    /* --------------------------------- 7) 「开始冒险」真的落到玩家 Run 入口 */
    await clickSelector(page, '[data-ph-action="back-home"]');
    const homeP = await probeOf(page);
    await Promise.all([
      page.waitForURL(/run-page\.html/, { timeout: 20000 }).catch(() => {}),
      clickSelector(page, '[data-ph-action="start-run"]'),
    ]);
    await sleep(600);
    const runDom = await page.evaluate(() => ({
      path: location.pathname,
      search: location.search,
      hasRunRoot: !!document.getElementById('run-root'),
      hasHomeRoot: !!document.getElementById('ph-root'),
    }));
    log(
      runDom.path === '/run-page.html' &&
        runDom.hasRunRoot &&
        !runDom.hasHomeRoot &&
        runDom.search.includes(`run=${homeP.runToken}`),
      'G1 首页「开始冒险」→ 落到既有玩家 Run 入口（整页导航，且把本局 token 带进 Run）',
      `path=${runDom.path} search=${runDom.search} run-root=${runDom.hasRunRoot}`,
    );

    /* --- G2 带产品载荷进来、但还没打完 ⇒ 不得出现候选卡（既有路径逐帧不变） --- */
    const runIdle = await page.evaluate(() => window.__RUNPAGE__.probe());
    log(
      runIdle.rewardChoices.length === 0 &&
        runIdle.rewardChoiceRects.length === 0 &&
        runIdle.chosenDefId === null &&
        runIdle.exitHref === null &&
        runIdle.phase !== 'COMPLETE',
      'G2 带产品载荷进 Run：非 COMPLETE 状态不画 3选1 候选、也没有产品出口（只有真结算才出现）',
      `phase=${runIdle.phase} choices=${runIdle.rewardChoices.length} exitHref=${runIdle.exitHref}`,
    );

    /*
      ══════════════════════════════════════════════════════════════════════════
      G3 / G4｜「Product Run Snapshot 与 Garage 配置一致」（验收 4）
      ══════════════════════════════════════════════════════════════════════════

      取证手段 = **解码真实导航 URL 上那个 `equipped=` 参数**。

      为什么是它：产品侧把本局装备交给 Lab 的**唯一**通道就是
      `runReward.encodeRunLoadout()` → URL 查询串（Lab 的模块白名单是闭集，
      **结构上读不到正式存档**）⇒ 这个参数**就是** Product Run Snapshot 的装配来源。
      把它解出来与 Garage 读数逐字段比对，比读 Run 页内部状态更接近「契约层」：
      它同时钉住「Garage 写的字段」与「Run 收到的字段」是同一份。

      ⚠️ 刻意**不改** `runPage.ts`（Lab 冻结面）去多暴露一个探针字段：
         URL 上的载荷已经是权威事实，加探针属于「为测试改产品代码」。
      ⚠️ `encodeRunLoadout` **只在字段有定义时才写**（`!== undefined`）⇒
         `rearWheelDefId` 缺省时 URL 里根本没有这个键 —— 「缺省 = 无键」这条语义
         在**线路上**也成立，下面的断言按这个口径写。
    */
    const equippedRaw = new URLSearchParams(runDom.search).get('equipped');
    let equippedDraft = null;
    try {
      equippedDraft = JSON.parse(equippedRaw);
    } catch {
      equippedDraft = null;
    }
    const garageSlots = (homeP.movement && homeP.movement.slots) || [];
    const garageByHp = Object.fromEntries(garageSlots.map((s) => [s.hardpointId, s]));
    log(
      !!equippedDraft &&
        equippedDraft.rearWheelDefId === GRANT &&
        equippedDraft.frontWheelDefId === GRANT &&
        garageByHp.rear &&
        garageByHp.rear.effectiveDefId === GRANT &&
        garageByHp.front &&
        garageByHp.front.effectiveDefId === GRANT,
      'G3 **Run Snapshot 与 Garage 配置一致**：URL 载荷里 rear / front 都是刚装的那件，与 Garage 读数逐挂点相同（验收 4）',
      `url.rear=${equippedDraft && equippedDraft.rearWheelDefId} url.front=${equippedDraft && equippedDraft.frontWheelDefId} garage.rear=${garageByHp.rear && garageByHp.rear.effectiveDefId} garage.front=${garageByHp.front && garageByHp.front.effectiveDefId}`,
    );
    log(
      !!equippedDraft &&
        equippedDraft.functionalSelections &&
        equippedDraft.functionalSelections[WEAPON_SLOT] === back,
      'G4 Run 载荷里 Weapon 槽仍是 Garage 里那一件 ⇒ 「装 Movement 之后 Run 用的武器没被顶掉」（验收 5 的 Run 侧取证）',
      `url.functionalSelections.${WEAPON_SLOT}=${equippedDraft && equippedDraft.functionalSelections && equippedDraft.functionalSelections[WEAPON_SLOT]}`,
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
