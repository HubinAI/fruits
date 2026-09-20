/**
 * PRODUCT-LOOP-P0-LEGACY-PROFILE-MIGRATION-AND-RUN-REACHABILITY｜**真实产品入口** smoke。
 *
 * ── 本文件要证的两件事（都在真实浏览器 + 真实 localStorage 上，不经过任何桩）────
 *   ① **旧 starter profile 真的被迁移**：把一份「front = 推杆」的旧存档塞进真实
 *      localStorage，打开 `home.html`（正式产品入口）后，
 *      —— 存档里的 `front` 变成空槽、`frontMass` 仍是 cannon；
 *      —— **旁路玩家数据原样保留**（车身 / 轮径 / 轮组 / 驱动 / 其它槽 / 其它槽星级）；
 *      —— 库存与进度 key **逐字节不变**；
 *      —— 再 reload 一次**不再改写**（迁移结构上一次为限）。
 *   ② **产品基线可达性**（Queue 必改 3）：迁移后的装载**真的**能打完第一场、
 *      并走到**第一次局内强化**（第一层三选一）—— 用真实鼠标点击驱到那个节点。
 *
 * ⚠️ 为什么必须在浏览器里跑：迁移发生在正式读入口（`loadEquippedDraft`），走的是
 *    `platform.storage` 的真实实现；单测里的内存桩证明不了「真存储里也落了盘」。
 * ⚠️ 「迁移前会怎样」不在本文件重复取证：R1-C 已实测同一形状（`front` 挂推杆）在第一场
 *    **稳定失败**，而 `front` 留空 → COMPLETE（4/4）。本文件只证明**修复后**的形状可达。
 *
 * ⚠️ **三份夹具、两条路线**（第一版混用导致我自己踩了坑，记在这里）：
 *    - `LEGACY_STARTER`      = 旧 starter 的**标准形状**（drive forward / 默认轮径）
 *      ⇒ 迁移后应当与产品 fresh starter **逐字节同形**  ⇒ 走**战斗**路线（可达性 Gate）。
 *    - `LEGACY_WITH_PLAYERDATA` = 同一旧 starter，但**额外带上玩家自有数据**
 *      （非默认轮径 / 轮组 / `drive: stationary` / 其它槽星级）
 *      ⇒ 只用来证「其它数据全部保留」⇒ **不跑战斗**。
 *    - 教训：`drive` / 轮径 / 轮组**真的会改变战斗结果**，所以「保留性」与「可达性」
 *      不能用同一份夹具同时证 —— 第一版把 `drive: stationary` 塞进战斗夹具，
 *      结果第一场必输，红的是夹具不是产品。
 *
 * 用法：
 *   npm run build:portrait-lab
 *   node tests/_e2e_product_legacy_profile.cjs   （或 npm run e2e:product-legacy）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8169;
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

/* --------------------------------------------------------------- 常量口径 */

/** 正式存档 key（与 src 同值；E2E 独立取证，不 import src）。 */
const BUILD_KEY = 'strongfruit.playerBuild.v1';
const INV_KEY = 'strongfruit.ownedParts.v2';
const PROGRESS_KEY = 'strongfruit.playerProgress.v1';

const FRONT_SLOT = 'front';
const WEAPON_SLOT = 'frontMass';
const TOP_SLOT = 'top';
const REAR_SLOT = 'rear';
const EMPTY = 'none';

/**
 * **冻结的**旧 starter 形状（明文写死，故意不 import src —— 它描述的是**当年落盘的数据**）。
 * ⚠️ 刻意**没有** `functionalStars`：这正是判别「玩家从没碰过这一槽」的信号。
 * ⚠️ drive / 轮径取**默认值** ⇒ 迁移后应当与产品 fresh starter 逐字节同形（战斗路线要用它）。
 */
const LEGACY_STARTER = {
  bodyDefId: 'watermelonBody',
  rearRadius: 20,
  frontRadius: 20,
  drive: 'forward',
  functionalSelections: { [REAR_SLOT]: EMPTY, [FRONT_SLOT]: 'pushRod', [WEAPON_SLOT]: 'cannon', [TOP_SLOT]: 'hammer' },
};

/**
 * 同一个旧 starter，但**额外带上玩家自有数据** —— 只用来证「其它数据全部保留」。
 * ⚠️ `drive: 'stationary'` 与轮径会**改变战斗结果**，所以这条路线**不跑战斗**。
 */
const LEGACY_WITH_PLAYERDATA = {
  ...LEGACY_STARTER,
  rearRadius: 26,
  frontRadius: 12,
  rearWheelDefId: 'smallWheel',
  frontWheelDefId: 'largeWheel',
  drive: 'stationary',
  functionalStars: { [TOP_SLOT]: 2 },
};

/** 单次驱动的预算（第一场真实物理 ≈16s；留足余量）。 */
const DRIVE_BUDGET_MS = 180000;

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
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

/* --------------------------------------------------------------- 页面助手 */

const waitHomeReady = (page) =>
  page.waitForFunction(() => !!window.__PRODUCTHOME__, null, { timeout: 20000 });
const waitRunReady = async (page) => {
  await page.waitForFunction(
    () => {
      const c = document.querySelector('#run-canvas');
      if (!window.__RUNPAGE__ || !c || c.width === 0) return false;
      const p = window.__RUNPAGE__.probe();
      return p.screen.width > 0 && p.assets.ready >= 5 && p.assets.failed.length === 0;
    },
    null,
    { timeout: 25000 },
  );
  await sleep(250);
};

const probeHome = (page) => page.evaluate(() => window.__PRODUCTHOME__.probe());
const probeRun = (page) => page.evaluate(() => window.__RUNPAGE__.probe());

/** 真实鼠标点击：元素真实 CSS 矩形中心（不用 evaluate 直调 click）。 */
async function clickSelector(page, sel) {
  const box = await page.locator(sel).first().boundingBox();
  if (!box) throw new Error(`无法定位元素：${sel}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(120);
}

/** 真实鼠标点击 Run 画布：逻辑坐标 → 屏幕坐标（用画布真实 CSS 矩形换算）。 */
async function clickLogical(page, lx, ly) {
  const screen = (await probeRun(page)).screen;
  await page.mouse.click(
    screen.left + (lx / 390) * screen.width,
    screen.top + (ly / 844) * screen.height,
  );
}
const clickRect = (page, r) => clickLogical(page, r.x + r.w / 2, r.y + r.h / 2);

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

const parseBuild = (dump) => {
  try {
    return JSON.parse(dump[BUILD_KEY]);
  } catch {
    return null;
  }
};

/** 去掉 `saveVersion` 的版本信封（它不属于领域对象）。 */
function stripStamp(o) {
  const { __v, ...rest } = o;
  void __v;
  return rest;
}

/** 键序无关的规范化 JSON（对象键排序后比较，避免「顺序不同 = 不等」的假红）。 */
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** 注入一份旧存档 + 一份可辨认的进度记录（**库存不动**，用产品自己建的真实库存）。 */
async function injectLegacy(page, build) {
  await page.evaluate(
    ({ buildKey, progressKey, b }) => {
      localStorage.setItem(buildKey, JSON.stringify({ ...b, __v: 1 }));
      localStorage.setItem(progressKey, JSON.stringify({ cleared: 3, best: 7 }));
    },
    { buildKey: BUILD_KEY, progressKey: PROGRESS_KEY, b: build },
  );
  return storageDump(page);
}

/**
 * 驱到**第一次局内强化**（第一层三选一）。
 * 判据与宿主同源：`choiceOpen` 且 `choicePoolKind === 'layer1'`（不是「数第几选」）。
 */
async function driveToFirstChoice(page) {
  const t0 = Date.now();
  let last = null;
  let battle1 = null;
  while (Date.now() - t0 < DRIVE_BUDGET_MS) {
    const p = await probeRun(page);
    last = p;
    if (!battle1 && p.phase === 'BATTLE' && p.battleWorld) battle1 = p;
    if (p.choiceOpen && p.choicePoolKind === 'layer1') return { probe: p, battle1 };
    if (p.phase === 'FAILED' || p.phase === 'COMPLETE') return { probe: p, battle1 };
    if (p.durabilityOpen && p.overlayOptions.length > 0) {
      await clickRect(page, p.overlayOptions[0].rect);
      await sleep(180);
      continue;
    }
    if (p.choiceOpen && p.choiceOptions.length > 0) {
      await clickRect(page, p.choiceOptions[0].rect);
      await sleep(180);
      continue;
    }
    if (p.overlayOpen && p.overlayOptions.length > 0) {
      await clickRect(page, p.overlayOptions[0].rect);
      await sleep(180);
      continue;
    }
    if (p.actionEnabled) await clickRect(page, p.actionRect);
    await sleep(p.phase === 'BATTLE' ? 400 : 140);
  }
  throw new Error(`驱动超时（${DRIVE_BUDGET_MS}ms）· 最后 phase=${last ? last.phase : 'n/a'}`);
}

/* ------------------------------------------------------------------- 主流程 */

async function main() {
  console.log('=== PRODUCT-LOOP-P0-LEGACY｜旧 starter profile 迁移 + 产品基线可达性（真实入口）===\n');

  for (const f of ['home.html', 'run-page.html']) {
    if (!fs.existsSync(path.join(ROOT, f))) {
      console.error(`未找到 ${path.join(ROOT, f)} —— 请先 npm run build:portrait-lab`);
      process.exit(1);
    }
  }

  const server = await startServer();
  log(true, 'L0 静态产物就绪（home.html / run-page.html 真实存在）');

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  try {
    /* ---- 1) 先在真实产品里跑一遍全新账号：让产品自己建出真实的库存 ---- */
    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const fresh = await storageDump(page);
    log(
      !!fresh[INV_KEY] && parseBuild(fresh) === null,
      'L1 全新账号基线：真实库存已生成、还没有 Build 存档（下面注入的旧存档是唯一变量）',
      `inv=${!!fresh[INV_KEY]} build=${fresh[BUILD_KEY] ? 'exists' : 'null'}`,
    );

    /* ==================================================== 路线 A：保留性（不跑战斗） */

    const seededA = await injectLegacy(page, LEGACY_WITH_PLAYERDATA);
    const legacyA = parseBuild(seededA);
    log(
      legacyA.functionalSelections[FRONT_SLOT] === 'pushRod' &&
        legacyA.functionalSelections[WEAPON_SLOT] === 'cannon' &&
        // 判别条件只关心**这一槽**的印记：front 上没有星级 ⇒ 玩家从没写过这一槽
        (legacyA.functionalStars ?? {})[FRONT_SLOT] === undefined,
      'L2 注入的旧存档形状正确（front=推杆 / frontMass=cannon / **front 无星级印记**）—— 这正是旧 starter 的判别特征',
      `${FRONT_SLOT}=${legacyA.functionalSelections[FRONT_SLOT]} ${WEAPON_SLOT}=${legacyA.functionalSelections[WEAPON_SLOT]} frontStar=${(legacyA.functionalStars ?? {})[FRONT_SLOT]}`,
    );

    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const afterA = await storageDump(page);
    const migratedA = parseBuild(afterA);

    const keysSame =
      JSON.stringify(Object.keys(migratedA).sort()) === JSON.stringify(Object.keys(legacyA).sort());
    const playerDataKept =
      migratedA.bodyDefId === LEGACY_WITH_PLAYERDATA.bodyDefId &&
      migratedA.rearRadius === LEGACY_WITH_PLAYERDATA.rearRadius &&
      migratedA.frontRadius === LEGACY_WITH_PLAYERDATA.frontRadius &&
      migratedA.rearWheelDefId === LEGACY_WITH_PLAYERDATA.rearWheelDefId &&
      migratedA.frontWheelDefId === LEGACY_WITH_PLAYERDATA.frontWheelDefId &&
      migratedA.drive === LEGACY_WITH_PLAYERDATA.drive &&
      JSON.stringify(migratedA.functionalStars) === JSON.stringify(LEGACY_WITH_PLAYERDATA.functionalStars);
    log(
      migratedA.functionalSelections[FRONT_SLOT] === EMPTY &&
        migratedA.functionalSelections[WEAPON_SLOT] === 'cannon' &&
        migratedA.functionalSelections[TOP_SLOT] === 'hammer' &&
        migratedA.functionalSelections[REAR_SLOT] === EMPTY,
      'L3 **迁移落盘（真实存储）**：打开正式入口后 `front` 已清空，主武器仍是 cannon，其它槽一字未动',
      `${FRONT_SLOT}=${migratedA.functionalSelections[FRONT_SLOT]} ${WEAPON_SLOT}=${migratedA.functionalSelections[WEAPON_SLOT]} ${TOP_SLOT}=${migratedA.functionalSelections[TOP_SLOT]}`,
    );
    log(
      playerDataKept && keysSame,
      'L3b **玩家数据一字未改**：车身 / 轮径 / 轮组 / 驱动 / 其它槽星级原样，且**键集不变**（唯一变化就是 front 这一个槽；不是「重置成默认车」）',
      `body=${migratedA.bodyDefId} r=${migratedA.rearRadius}/${migratedA.frontRadius} wheels=${migratedA.rearWheelDefId}/${migratedA.frontWheelDefId} drive=${migratedA.drive} stars=${JSON.stringify(migratedA.functionalStars)} keysSame=${keysSame}`,
    );
    log(
      afterA[INV_KEY] === seededA[INV_KEY] && afterA[PROGRESS_KEY] === seededA[PROGRESS_KEY],
      'L3c **永久数据不丢**：库存与进度 key 与迁移前**逐字节相同**（迁移只动 Build 的那一个槽）',
      `inv=${afterA[INV_KEY] === seededA[INV_KEY]} progress=${afterA[PROGRESS_KEY] === seededA[PROGRESS_KEY]}`,
    );
    const pushRodOwned = (() => {
      try {
        return Number(JSON.parse(afterA[INV_KEY]).pushRod.one) > 0;
      } catch {
        return false;
      }
    })();
    log(
      pushRodOwned,
      'L3d **不粗暴删推杆**：库存里的推杆仍在（只是不装在这台车的 front 上）',
      `pushRod.one>0 = ${pushRodOwned}`,
    );

    // 再打开一次：迁移不重复执行
    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const againA = await storageDump(page);
    log(
      againA[BUILD_KEY] === afterA[BUILD_KEY] &&
        againA[INV_KEY] === afterA[INV_KEY] &&
        againA[PROGRESS_KEY] === afterA[PROGRESS_KEY],
      'L7 **不重复修改**：再打开一次首页，Build / 库存 / 进度三份存档**逐字节不变**（迁移一次为限）',
      `build=${againA[BUILD_KEY] === afterA[BUILD_KEY]} inv=${againA[INV_KEY] === afterA[INV_KEY]}`,
    );

    /* ============================================ 路线 B：可达性（标准旧 starter 形状） */

    const seededB = await injectLegacy(page, LEGACY_STARTER);
    log(
      parseBuild(seededB).functionalStars === undefined,
      'L2b 战斗路线的夹具是**纯旧 starter 形状**（完全没有 functionalStars）—— 这是「玩家从没编辑过任何槽」的信号',
      `stars=${parseBuild(seededB).functionalStars}`,
    );
    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const afterB = await storageDump(page);
    const migratedB = parseBuild(afterB);
    // 迁移后应当与「旧 starter 清掉 front」逐字段同形（= 产品 fresh starter 的当前规则）
    const expectedB = {
      ...LEGACY_STARTER,
      functionalSelections: { ...LEGACY_STARTER.functionalSelections, [FRONT_SLOT]: EMPTY },
    };
    log(
      canon(stripStamp(migratedB)) === canon(expectedB),
      'L8 **必改 2 同源**：标准旧 starter 迁移后**逐字段等于**「旧 starter 清掉 front」（= 产品 fresh starter 的当前规则，不存在第二套 starter）',
      `got=${canon(stripStamp(migratedB))}`,
    );
    log(
      afterB[INV_KEY] === seededB[INV_KEY] && afterB[PROGRESS_KEY] === seededB[PROGRESS_KEY],
      'L8b 路线 B 同样零副作用：库存 / 进度逐字节不变',
      `inv=${afterB[INV_KEY] === seededB[INV_KEY]}`,
    );

    /* ---- 首屏读数：前槽空、主武器 cannon、完整 Run 可达 ---- */
    const home1 = await probeHome(page);
    const frontReading = (home1.slots ?? []).find((s) => s.hardpointId === FRONT_SLOT);
    log(
      !!frontReading &&
        frontReading.defId === EMPTY &&
        home1.equippedWeaponId === 'cannon' &&
        typeof home1.startRunHref === 'string' &&
        home1.startRunHref.length > 0,
      'L4 首屏如实反映迁移结果：前槽「空」、已装备 = cannon、**开始冒险可执行**（href 非空）',
      `front=${frontReading ? `${frontReading.defId}(${frontReading.name})` : 'n/a'} equipped=${home1.equippedWeaponId} href=${home1.startRunHref ? 'set' : 'null'}`,
    );

    /* ---- 真实鼠标出发 → Run 收到的就是迁移后的车 ---- */
    await Promise.all([
      page.waitForURL(/run-page\.html/, { timeout: 20000 }).catch(() => {}),
      clickSelector(page, '[data-ph-action="start-run"]'),
    ]);
    await waitRunReady(page);
    const runStart = await probeRun(page);
    log(
      runStart.playerLoadout.source === 'profile' &&
        runStart.playerLoadout.fallback === 'none' &&
        runStart.playerLoadout.functionalSelections[FRONT_SLOT] === EMPTY &&
        runStart.playerLoadout.functionalSelections[WEAPON_SLOT] === 'cannon',
      'L5 Run 收到的装载 = 迁移后的车（来源仍是 profile；front 空 / 主武器 cannon）',
      `source=${runStart.playerLoadout.source} ${FRONT_SLOT}=${runStart.playerLoadout.functionalSelections[FRONT_SLOT]} ${WEAPON_SLOT}=${runStart.playerLoadout.functionalSelections[WEAPON_SLOT]}`,
    );

    /* ---- 必改 3 的 Gate：第一场能结束 ⇒ 真的走到第一次强化 ---- */
    const driven = await driveToFirstChoice(page);
    const p1 = driven.probe;
    log(
      p1.phase === 'CHOICE' && p1.choicePoolKind === 'layer1',
      'L6 **Reachability Gate ①**：迁移后的标准 Cannon 基线**真的**走到第一次局内强化（第一层三选一）',
      `phase=${p1.phase} pool=${p1.choicePoolKind} DAY=${p1.day} battles=${p1.battlesCompleted}/${p1.battleTotal} node=${p1.nodeId}`,
    );
    log(
      p1.battlesCompleted >= 1 && !!driven.battle1,
      'L6b **Reachability Gate ②**：第一场战斗**真的打完了**（真实 BATTLE 相位 → 计入 battlesCompleted）',
      `battlesCompleted=${p1.battlesCompleted} 第一场武器槽=${mountedOf(driven.battle1)?.[WEAPON_SLOT] ?? 'n/a'} 首场相位=${driven.battle1 ? driven.battle1.phase : 'n/a'}`,
    );
    log(
      p1.build.length === 0,
      'L6c 进入第一次强化时本局还没有任何强化（强化是**这一场之后**才拿到的）',
      `build=${JSON.stringify(p1.build)}`,
    );

    log(pageErrors.length === 0, 'L9 全程零页面异常', pageErrors.slice(0, 2).join(' | ') || 'none');
  } finally {
    await browser.close();
    server.close();
  }

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n=== 结果 ${pass}/${results.length} PASS ===`);
  if (pass !== results.length) {
    for (const r of results.filter((x) => !x.pass)) console.log(`  FAIL ${r.name} | ${r.detail}`);
    process.exit(1);
  }
}

/** 第一场战斗里玩家车的逐槽真实装配（测试锁用）。 */
function mountedOf(p) {
  if (!p || !p.battleWorld) return null;
  const out = {};
  for (const f of p.battleWorld.playerFunctionals ?? []) out[f.hardpointId] = f.defId;
  return out;
}

main().catch((e) => {
  console.error('SMOKE 异常:', e && e.stack ? e.stack : e);
  process.exit(1);
});
