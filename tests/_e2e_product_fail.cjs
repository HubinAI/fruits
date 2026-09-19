/**
 * PRODUCT-LOOP-R1-D-FAILED-SETTLEMENT-TO-HOME｜**正式失败链 smoke**（真实浏览器）。
 *
 * 真人在正式产品入口录屏确认的 P0：
 *
 *   玩家 Run 内失败 → 没有失败结算 → 流程回到 DAY 1 继续跑 → 玩家无法主动回主界面。
 *
 * 本文件是该闭环的机器判据 —— 真实链路：
 *
 *   首页 → 调整战车（换一件打不过的武器）→ 开始冒险 → 战斗失败
 *        → 「冒险失败」结算出现 → **页面停住**（等待确认无自动重启，也不接受误触）
 *        → 点「返回主界面」→ 回到正式首页（不带任何领奖参数）
 *        → 三件套（Profile / Inventory / Equipped）一个都没被清空
 *        → 可进入调整战车 → 玩家主动再点「开始冒险」→ 新 Run：DAY 1 / 满耐久 / 无上一局 Buff
 *
 * 手段（与 A/B/C 三段 E2E 同一纪律，全部是真实行为取证）：
 *   - 真实浏览器（playwright-core / msedge）+ 独立产物 `dist-portrait-lab/`；
 *   - **真实鼠标点击**（逻辑坐标 → 画布真实 CSS 矩形换算，不 evaluate 直调）；
 *   - **真实整页导航**（`<a href>` / `location.assign` 由浏览器执行）；
 *   - **真实 localStorage 读取**（三件套一律独立取证，不读页面探针）；
 *   - 只读诊断句柄 `window.__PRODUCTHOME__` / `window.__RUNPAGE__`；
 *   - **真实 getImageData**：失败结算面板与底部 CTA 真的画在画布上。
 *
 * ⚠️ 失败路线是**确定性**的（`RunBattleRuntime` 无 RNG）：把主武器槽换成 `hammer`
 *    （近战锤，starter 已拥有）⇒ 第一场就被打死 ⇒ FAILED 🡒 DAY 2 / battles 1/4 / ≈16s。
 *    实测矩阵：`hammer` 第一场阵亡；`cannon` 走上「耐久事件选继续改装」的路线要到 DAY 7
 *    才归零（≈43s）。两条都真的失败，本文件取更短的那条（同时顺路验证车库换装真的生效）。
 *
 * 用法：
 *   npm run build:portrait-lab
 *   node tests/_e2e_product_fail.cjs   （或 npm run e2e:product-fail）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8171;
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

/** 正式存档 key（与 src 同值；E2E 独立取证，不经过页面探针）。 */
const BUILD_KEY = 'strongfruit.playerBuild.v1';
const INV_KEY = 'strongfruit.ownedParts.v2';
const CLAIMS_KEY = 'strongfruit.profileClaims.v1';
/** 唯一打通的武器槽（= 车身前上挂点）。 */
const WEAPON_SLOT = 'frontMass';
/** 失败回程地址的参数名（产品侧与 Lab 侧的唯一约定）。 */
const HOME_PARAM = 'home';
/** 领奖参数名（失败链**结构上**不该拿到；R2-A 起它只出现在每条候选自己的 href 里）。 */
const REWARD_PARAM = 'reward';
const RUN_PARAM = 'run';
/** PRODUCT-LOOP-R2-A：3选1 候选载荷（三条候选**各自**的领奖地址）。 */
const CHOICES_PARAM = 'choices';

/** 打不过的武器：近战锤，第一场就被打死（实测）。 */
const LOSE_WEAPON = 'hammer';
const LOSE_WEAPON_NAME = '锤';

/** 失败结算面板 + 底部 CTA 的**非入账**配色（与 `runPage.ts` 的 COLORS 同值）。 */
const PANEL_BG = [0x1b, 0x24, 0x32]; // COLORS.cardBg
const CTA_BAR = [0x33, 0x50, 0x7a]; // COLORS.actionBtn（启用态底部强调条）

/** 驱动预算：失败路线实测 ≈16s，给足余量。 */
const DRIVE_BUDGET_MS = 120000;

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round2 = (v) => Math.round(v * 100) / 100;

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

/* ------------------------------------------------------------------ 页面助手 */

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

/** 真实鼠标点击 Run 画布：逻辑坐标 → 屏幕坐标（用画布真实 CSS 矩形换算，不用 DPR-backed 尺寸）。 */
async function clickLogical(page, lx, ly) {
  const screen = (await probeRun(page)).screen;
  await page.mouse.click(screen.left + (lx / 390) * screen.width, screen.top + (ly / 844) * screen.height);
}

/** 点击某个布局矩形的中心（真实鼠标事件）。 */
async function clickRect(page, r) {
  await clickLogical(page, r.x + r.w / 2, r.y + r.h / 2);
}

/** 直接读浏览器真实 localStorage（不经过页面探针，独立取证）。 */
function storageDump(page) {
  return page.evaluate(() => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      o[k] = localStorage.getItem(k);
    }
    return o;
  });
}

/** 在画布某矩形内按**精确 RGB 相等**统计像素数（真实 getImageData）。 */
function countColorInRect(page, rect, target) {
  return page.evaluate(
    ({ r, rgb }) => {
      const c = document.querySelector('#run-canvas');
      const ctx = c.getContext('2d');
      const s = c.width / 390;
      const x0 = Math.max(0, Math.floor(r.x * s));
      const y0 = Math.max(0, Math.floor(r.y * s));
      const x1 = Math.min(c.width, Math.ceil((r.x + r.w) * s));
      const y1 = Math.min(c.height, Math.ceil((r.y + r.h) * s));
      const d = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] === rgb[0] && d[i + 1] === rgb[1] && d[i + 2] === rgb[2]) n += 1;
      }
      return n;
    },
    { r: rect, rgb: target },
  );
}

/** 存档里的主武器槽（独立取证）。 */
function storedWeaponSlot(dump) {
  const raw = dump[BUILD_KEY];
  if (!raw) return null;
  try {
    const sel = JSON.parse(raw).functionalSelections;
    return sel ? (sel[WEAPON_SLOT] ?? null) : null;
  } catch {
    return null;
  }
}

/** 从「开始冒险」的真实 href 里解码产品侧交出去的装备（只读，不改形态）。 */
function decodeLoadoutFromHref(href) {
  try {
    const raw = new URLSearchParams(href.split('?')[1] ?? '').get('equipped');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 把 `functionalSelections` 摊成「真正装上了的部件」`{挂点: defId}`（跳过空槽）。 */
function mountedMap(selections) {
  const out = {};
  for (const [hp, id] of Object.entries(selections ?? {})) {
    if (id && id !== 'none') out[hp] = id;
  }
  return out;
}

const canon = (m) =>
  JSON.stringify(
    Object.keys(m ?? {})
      .sort()
      .map((k) => [k, m[k]]),
  );

/** 把一局 Run 驱到终态（真实鼠标点击；强化按池内 id 选，没指定就取第一项）。 */
async function driveRunToEnd(page, policy, label) {
  const t0 = Date.now();
  const seen = [];
  let last = null;
  while (Date.now() - t0 < DRIVE_BUDGET_MS) {
    const p = await probeRun(page);
    if (!last || last.phase !== p.phase) seen.push(p.phase);
    last = p;
    if (p.phase === 'COMPLETE' || p.phase === 'FAILED') {
      return { probe: p, seen, ms: Date.now() - t0 };
    }
    if (p.durabilityOpen && p.overlayOptions.length > 0) {
      const opt = p.overlayOptions.find((o) => o.id === policy.durability) ?? p.overlayOptions[0];
      await clickRect(page, opt.rect);
      await sleep(160);
      continue;
    }
    if (p.choiceOpen && p.choiceOptions.length > 0) {
      const want = policy[p.choicePoolKind] ?? null;
      const opt = (want && p.choiceOptions.find((o) => o.id === want)) || p.choiceOptions[0];
      await clickRect(page, opt.rect);
      await sleep(160);
      continue;
    }
    if (p.overlayOpen && p.overlayOptions.length > 0) {
      await clickRect(page, p.overlayOptions[0].rect);
      await sleep(160);
      continue;
    }
    if (p.actionEnabled) await clickRect(page, p.actionRect);
    await sleep(p.phase === 'BATTLE' ? 320 : 120);
  }
  throw new Error(`${label} 驱动超时（${DRIVE_BUDGET_MS}ms）· 最后 phase=${last ? last.phase : 'n/a'}`);
}

/** 驱动到**第一场真实战斗开打**（BATTLE 相位 + 战斗世界已建立），并返回该帧探针。 */
async function driveUntilFirstBattle(page, label) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < DRIVE_BUDGET_MS) {
    const p = await probeRun(page);
    last = p;
    if (p.phase === 'BATTLE' && p.battleWorld) return { probe: p, ms: Date.now() - t0 };
    if (p.phase === 'FAILED' || p.phase === 'COMPLETE') {
      throw new Error(`${label} 在进入第一场战斗前就结束了（phase=${p.phase}）`);
    }
    if (p.actionEnabled) await clickRect(page, p.actionRect);
    await sleep(140);
  }
  throw new Error(`${label} 未能进入第一场战斗 · 最后 phase=${last ? last.phase : 'n/a'}`);
}

/* ------------------------------------------------------------------- 主流程 */

async function main() {
  console.log('=== PRODUCT-LOOP-R1-D｜失败结算 → 返回主界面 smoke（真实浏览器）===\n');

  for (const f of ['home.html', 'run-page.html']) {
    if (!fs.existsSync(path.join(ROOT, f))) {
      console.error(`未找到 ${path.join(ROOT, f)} —— 请先 npm run build:portrait-lab`);
      process.exit(1);
    }
  }

  const server = await startServer();
  log(true, 'P0 静态产物就绪（dist-portrait-lab 内 home.html + run-page.html 真实存在）');

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  // 390×844 / DPR 1：Run 画布 1:1（精确色统计与逻辑坐标换算的前提）
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  try {
    /* ======================================================= A. 首页与出发准备 */

    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const home0 = await probeHome(page);
    const stored0 = await storageDump(page);
    log(
      typeof home0.equippedWeaponId === 'string' && home0.equippedWeaponId !== '' && !!home0.startRunHref,
      'A1 首页就绪：身上有一件真实武器，且「开始冒险」链接已生成',
      `equipped=${home0.equippedWeaponId} href=${(home0.startRunHref ?? '').slice(0, 60)}…`,
    );

    // 产品侧必须把**两类**出口都给全：成功有哪几个去处（三条候选的领奖地址）+ 失败回哪儿（纯首页）
    const startHref = home0.startRunHref ?? '';
    const startQ = new URLSearchParams(startHref.split('?')[1] ?? '');
    /*
      ⚠️ PRODUCT-LOOP-R2-A 的契约变更：成功侧不再是「一个 back」，而是 `choices` 载荷里
      **每条候选各自的**领奖地址（三条 defId 不同 ⇒ 目的地必然不同）。
    */
    const choicesRaw = startQ.get(CHOICES_PARAM) ?? '';
    const choices = choicesRaw ? JSON.parse(choicesRaw).choices ?? [] : [];
    const claimHrefs = choices.map((c) => c.href);
    const homeHref = startQ.get(HOME_PARAM) ?? '';
    const homeQ = new URLSearchParams(homeHref.split('?')[1] ?? '');
    log(
      claimHrefs.length === 3 &&
        claimHrefs.every((h) => typeof h === 'string' && h !== '') &&
        homeHref !== '' &&
        claimHrefs.every((h) => h !== homeHref) &&
        !startQ.has(REWARD_PARAM),
      'A2 出发链接同时给全「成功有哪几个去处」（三条候选各自的领奖地址）与「失败回哪儿」，且成功侧**没有**裸 `reward=`',
      `choices=${claimHrefs.map((h) => h.replace('./home.html?', '')).join(' ')} home=${homeHref}`,
    );
    log(
      !homeQ.has(RUN_PARAM) && !homeQ.has(REWARD_PARAM) && homeQ.toString() === '',
      'A3 失败回程地址是**纯首页**：不带 run / reward 参数 ⇒ 回首页不会触发任何入库（必改 5 的地址层保证）',
      `home 参数解析：${homeQ.toString() === '' ? '(空 search)' : homeQ.toString()}`,
    );

    // 车库真实换装：换成一件打不过的武器（顺路证明「调整战车」真的写存档）
    await clickSelector(page, '[data-ph-action="open-garage"]');
    const garage0 = await probeHome(page);
    await clickSelector(page, `[data-ph-weapon="${LOSE_WEAPON}"]`);
    await clickSelector(page, '[data-ph-action="equip"]');
    const stored1 = await storageDump(page);
    log(
      garage0.view === 'garage' &&
        storedWeaponSlot(stored1) === LOSE_WEAPON &&
        storedWeaponSlot(stored1) !== storedWeaponSlot(stored0),
      `A4 调整战车：真实点击装上「${LOSE_WEAPON_NAME}」→ **正式存档**的主武器槽真的变了（独立取证）`,
      `storage ${WEAPON_SLOT}: ${storedWeaponSlot(stored0)} → ${storedWeaponSlot(stored1)}`,
    );
    await clickSelector(page, '[data-ph-action="back-home"]');
    const home1 = await probeHome(page);
    const loadoutBefore = decodeLoadoutFromHref(home1.startRunHref ?? '');
    log(
      home1.view === 'home' && home1.equippedWeaponId === LOSE_WEAPON && !!loadoutBefore,
      'A5 返回首页：装备已经是刚装的那件，且下一局链接里带的装备跟着变了',
      `equipped=${home1.equippedWeaponId} 链接装备槽=${loadoutBefore ? loadoutBefore.functionalSelections[WEAPON_SLOT] : 'n/a'}`,
    );

    /* ============================================================== B. 进局 */

    await Promise.all([
      page.waitForURL(/run-page\.html/, { timeout: 20000 }).catch(() => {}),
      clickSelector(page, '[data-ph-action="start-run"]'),
    ]);
    await waitRunReady(page);
    const runStartUrl = await page.evaluate(() => location.pathname + location.search);
    const runStart = await probeRun(page);
    log(
      runStart.playerLoadout.source === 'profile' &&
        runStart.playerLoadout.fallback === 'none' &&
        runStart.playerLoadout.functionalSelections[WEAPON_SLOT] === LOSE_WEAPON,
      'B1 真实整页导航进局：这一局用的就是**首页那份装备**（source=profile / 无回退 / 主武器槽相同）',
      `source=${runStart.playerLoadout.source} fallback=${runStart.playerLoadout.fallback} ${WEAPON_SLOT}=${runStart.playerLoadout.functionalSelections[WEAPON_SLOT]}`,
    );
    log(
      runStart.phase !== 'FAILED' && runStart.failSettlement === null && runStart.failPanelRect === null,
      'B2 还没打完：没有任何失败结算（结算只在**真失败之后**出现，不是常驻面板）',
      `phase=${runStart.phase} failSettlement=${runStart.failSettlement}`,
    );
    // 失败回程地址真的进了局内（Lab 侧拿到的是产品给的那个地址）
    const runSearch = new URLSearchParams(runStartUrl.split('?')[1] ?? '');
    log(
      runSearch.get(HOME_PARAM) === homeHref,
      `B3 局内拿到了失败回程地址（逐字等于产品侧给的那个）：${HOME_PARAM}=${runSearch.get(HOME_PARAM)}`,
      `home=${runSearch.get(HOME_PARAM)}`,
    );

    /* ============================================ C. 真打 → RUN FAILED 结算 */

    const lose = await driveRunToEnd(page, { layer1: null, lateral: null, layer2: null, durability: 'repair' }, '失败路线');
    const pFail = lose.probe;
    log(
      pFail.phase === 'FAILED' && pFail.failed === true && pFail.complete === false && pFail.battle,
      'C1 真实物理打出失败：RUN FAILED（不是构造状态，是这一场真的被打到耐久归零）',
      `phase=${pFail.phase} battles=${pFail.battlesCompleted}/${pFail.battleTotal} DAY=${pFail.day} 用时 ${round2(lose.ms / 1000)}s · 终局 HP=${pFail.battle ? pFail.battle.playerHp : 'n/a'}`,
    );

    const fs1 = pFail.failSettlement;
    log(
      !!fs1 &&
        fs1.title === '冒险失败' &&
        fs1.day === pFail.day &&
        fs1.durabilityPercent === 0 &&
        Array.isArray(fs1.lines) &&
        fs1.lines.length === 3,
      'C2 明确出现「冒险失败」结算：标题 + 失败 DAY + 最终 Build + 最终耐久（最低必要信息，必改 3）',
      fs1 ? `${fs1.title} · ${fs1.lines.join(' / ')}` : 'n/a',
    );
    log(
      !!fs1 && fs1.buildLabels.length === 0 && fs1.lines[1] === '最终改装：未做任何改装' && fs1.lines[2] === '战车耐久：已耗尽',
      'C3 结算内容逐项来自真实状态：这一局没来得及改装 ⇒ 如实写「未做任何改装」；耐久 0 ⇒ 写「已耗尽」',
      fs1 ? `${fs1.lines[1]} · ${fs1.lines[2]}` : 'n/a',
    );
    log(
      pFail.actionLabel === '返回主界面' &&
        pFail.actionEnabled === true &&
        pFail.exitHref === homeHref &&
        !claimHrefs.includes(pFail.exitHref) &&
        pFail.actionLabel !== '重新开始冒险',
      'C4 底部**唯一**主 CTA =「返回主界面」，出口 = 产品侧给的**纯首页**地址（不是三条领奖地址中的任何一条、更不是「重新开始冒险」，必改 3 / 必改 6）',
      `label=${pFail.actionLabel} enabled=${pFail.actionEnabled} exit=${pFail.exitHref}（候选领奖地址=${claimHrefs.join(' ')}）`,
    );
    log(
      pFail.rewardChoices.length === 0 &&
        pFail.rewardChoiceRects.length === 0 &&
        pFail.chosenDefId === null &&
        pFail.rewardChoicesDropped === 0,
      'C5 失败**不发永久奖励**：3选1 候选 / 候选矩形 / 已选件三方皆为空（必改 5；载荷本身合法，不是靠「解析失败」才没有奖励）',
      `choices=${pFail.rewardChoices.length} rects=${pFail.rewardChoiceRects.length} chosen=${pFail.chosenDefId} dropped=${pFail.rewardChoicesDropped}`,
    );
    const domButtons = await page.evaluate(() => window.__RUNPAGE__.probe().domButtons);
    log(
      domButtons === 0,
      'C6 失败页面上**没有**任何 DOM 按钮（页面结构上不存在第二个动作入口 —— 想重开也无处可点）',
      `domButtons=${domButtons}`,
    );

    // 像素取证：结算面板与 CTA 真的画在画布上（不是只有探针字段）
    const panelRect = pFail.failPanelRect;
    const panelPx = panelRect ? await countColorInRect(page, panelRect, PANEL_BG) : -1;
    const ctaPx = await countColorInRect(page, pFail.actionRect, CTA_BAR);
    log(
      !!panelRect && panelPx > 20000 && ctaPx > 0,
      'C7 像素取证（真实 getImageData）：结算面板底色成片 + 底部 CTA 强调条真的画出来',
      `panel=${panelRect ? `${panelRect.x},${panelRect.y} ${panelRect.w}×${panelRect.h}` : 'n/a'} cardBg=${panelPx}px actionBtn=${ctaPx}px`,
    );

    /* ==================================== D. 必改 2 / 必改 6：失败必须停住 */

    const snap0 = await probeRun(page);
    const samples = [];
    for (let i = 0; i < 12; i++) {
      await sleep(220);
      const p = await probeRun(page);
      samples.push(`${p.phase}/${p.day}/${p.battlesCompleted}/${p.nodeId}`);
    }
    const stable = samples.every((s) => s === samples[0]);
    log(
      stable && samples[0].startsWith('FAILED/'),
      'D1 FAILED 后等待 ~2.6s（跨很多帧）：相位 / DAY / 已打场数 / 脚本节点**一个都没变**（不自动推进、不自动重开）',
      `采样=${samples[0]}（12 次全同）`,
    );

    // 误触：点非按钮区域（日志带 / 舞台带空白）必须零副作用
    await clickLogical(page, 195, 640);
    await sleep(200);
    await clickLogical(page, 20, 400);
    await sleep(400);
    const snap1 = await probeRun(page);
    log(
      snap1.phase === 'FAILED' &&
        snap1.day === snap0.day &&
        snap1.battlesCompleted === snap0.battlesCompleted &&
        snap1.nodeId === snap0.nodeId &&
        snap1.revision === snap0.revision &&
        snap1.logCount === snap0.logCount,
      'D2 失败页面上点**任何非按钮位置**都零副作用（状态连一次 revision 都没递增 —— 必改 2「除非用户明确点击动作」）',
      `phase=${snap1.phase} DAY=${snap1.day} battles=${snap1.battlesCompleted} revision=${snap1.revision} log=${snap1.logCount}（点前 ${snap0.phase}/${snap0.day}/${snap0.battlesCompleted}/rev${snap0.revision}/${snap0.logCount}）`,
    );

    const storedAtFail = await storageDump(page);

    /* ====================================================== E. 返回主界面 */

    await Promise.all([
      page.waitForURL(/home\.html/, { timeout: 20000 }).catch(() => {}),
      clickRect(page, pFail.actionRect),
    ]);
    await waitHomeReady(page);
    const afterReturnUrl = await page.evaluate(() => location.pathname + location.search);
    const afterQ = new URLSearchParams(afterReturnUrl.split('?')[1] ?? '');
    log(
      afterReturnUrl === '/home.html' || (afterReturnUrl.startsWith('/home.html') && !afterQ.has(RUN_PARAM) && !afterQ.has(REWARD_PARAM)),
      'E1 点「返回主界面」= 真实整页导航回正式首页，且 URL 里**没有**领奖参数（失败绝不触发入库）',
      `url=${afterReturnUrl}`,
    );

    const storedAfterReturn = await storageDump(page);
    const homeAfterFail = await probeHome(page);
    log(
      storedAfterReturn[BUILD_KEY] === storedAtFail[BUILD_KEY] &&
        storedAfterReturn[INV_KEY] === storedAtFail[INV_KEY] &&
        storedAfterReturn[CLAIMS_KEY] === storedAtFail[CLAIMS_KEY] &&
        storedWeaponSlot(storedAfterReturn) === LOSE_WEAPON,
      'E2 三件套**逐字节不变**：Profile 没被清空、Inventory 没动、Equipped 还是那件（失败不发奖也不删档，必改 4）',
      `${WEAPON_SLOT}=${storedWeaponSlot(storedAfterReturn)} 账本=${storedAfterReturn[CLAIMS_KEY] ? '有' : '无'}`,
    );
    log(
      homeAfterFail.claim === null &&
        homeAfterFail.view === 'home' &&
        homeAfterFail.equippedWeaponId === LOSE_WEAPON &&
        !!homeAfterFail.startRunHref,
      'E3 回到首页是一次**干净挂载**：没有领奖请求、停在首页视图、装备仍是那件、可以再次出发',
      `claim=${homeAfterFail.claim} view=${homeAfterFail.view} equipped=${homeAfterFail.equippedWeaponId}`,
    );

    await clickSelector(page, '[data-ph-action="open-garage"]');
    const garageAfterFail = await probeHome(page);
    log(
      garageAfterFail.view === 'garage' && garageAfterFail.weaponIds.includes(LOSE_WEAPON),
      'E4 回首页后**可以直接进入调整战车**（失败链的终点是「可调整配置」而不是死胡同）',
      `view=${garageAfterFail.view} 车库件数=${garageAfterFail.weaponIds.length}`,
    );
    await clickSelector(page, '[data-ph-action="back-home"]');

    /* ============================== F. 失败后的新 Run 只能由玩家主动出发 */

    const home2 = await probeHome(page);
    const loadout2 = decodeLoadoutFromHref(home2.startRunHref ?? '');
    log(
      !!loadout2 && loadout2.functionalSelections[WEAPON_SLOT] === LOSE_WEAPON,
      'F1 玩家主动再点「开始冒险」：链接带的仍是当前 Equipped（新 Run 的入口只有首页这一个）',
      `${WEAPON_SLOT}=${loadout2 ? loadout2.functionalSelections[WEAPON_SLOT] : 'n/a'}`,
    );

    await Promise.all([
      page.waitForURL(/run-page\.html/, { timeout: 20000 }).catch(() => {}),
      clickSelector(page, '[data-ph-action="start-run"]'),
    ]);
    await waitRunReady(page);
    const run2Start = await probeRun(page);
    log(
      run2Start.day === 1 &&
        run2Start.battlesCompleted === 0 &&
        run2Start.build.length === 0 &&
        run2Start.repairBonus === 0 &&
        run2Start.phase !== 'FAILED' &&
        run2Start.failSettlement === null,
      'F2 新 Run 状态**干净**：DAY 1 / 没打过任何一场 / Run Buff 与维修补偿清空 / 也不残留上一局的失败结算（必改 4）',
      `DAY=${run2Start.day} battles=${run2Start.battlesCompleted} build=${JSON.stringify(run2Start.build)} 补偿=${run2Start.repairBonus} phase=${run2Start.phase}`,
    );

    const firstBattle2 = await driveUntilFirstBattle(page, '第二局第一场');
    const fb = firstBattle2.probe;
    log(
      fb.battle.playerHp === fb.battle.playerHpMax && fb.battle.steps >= 1,
      'F3 新 Run 第一场是**满耐久**开打（不是上一局剩下的血）',
      `HP=${fb.battle.playerHp}/${fb.battle.playerHpMax} steps=${fb.battle.steps}`,
    );
    const mounted2 = {};
    for (const f of fb.battleWorld.playerFunctionals ?? []) mounted2[f.hardpointId] = f.defId;
    log(
      canon(mounted2) === canon(mountedLoadout(loadout2)),
      'F4 新 Run 第一场**真实装配** = 首页那份 Equipped（逐槽对账，不是「大致一样」）',
      `实际=${canon(mounted2)} vs 链接=${canon(mountedLoadout(loadout2))}`,
    );

    log(pageErrors.length === 0, 'G1 全流程零运行时报错', pageErrors.slice(0, 2).join(' | ') || 'none');
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
    process.exit(1);
  }
}

function mountedLoadout(draft) {
  return mountedMap(draft && draft.functionalSelections);
}

main().catch((e) => {
  console.error('E2E 运行失败：', e && e.stack ? e.stack : e);
  process.exit(1);
});
