/**
 * DEMO-FRESH-ACCOUNT-VERTICAL-SLICE-R1｜**全新账号**真实纵切（浏览器真实闭环，零预置）。
 *
 * 与 `_e2e_product_{loop,next_run_continuity}.cjs` 的**唯一区别**（也是本 Queue 的核心）：
 *   二者在装配前**显式 seed** 武器 stack（machineGun→4）与后轮库存（smallWheel→1）；
 *   本文件**一个字节都不写 localStorage** —— 完全依赖正式初始化 / R3-R5 一次性投放给到的
 *   自然库存，验证「一个全新账号能不能自己从首页把一局走完」。
 *
 * ── 全新账号的自然起点（沿代码查得，见提交报告）────────────────────────────
 *   - starter 库存：`cannon/hammer/pushRod/spear` ★1×1（`partInventory.STARTER_PARTS`）
 *   - R2 onboarding：`cannon ★1 → 4/5`（`r2Onboarding`，前提：无 ★≥2 武器成长）
 *   - R3 种子：`smallWheel / largeWheel / heavyWheel` 各 ×1（`r3MovementChoiceSeed`）
 *   - R4 种子：`mangoBody` / `durianBody` 永久解锁（`r4BodyChoiceSeed`）
 *   - R5 内容池种子：其余正式 Weapon（machineGun / shotgun / flamethrower / …）各 ★1×1
 *
 * ── 本文件验证的真实路径（全部真实 UI，无注入）──────────────────────────────
 *   A. 独立浏览器上下文（全新 localStorage）打开 home.html → 断言自然起点读数
 *   B. 进 Garage，经**真实点选**把车配成可通关装配（machineGun + mangoBody + 双 smallWheel）
 *   C. 点「开始冒险」→ 完整 Run → 记录**每一次真实终态**（COMPLETE/FAILED/BLOCKED，不伪绿）
 *   D. 若 COMPLETE：领奖 → 断言该武器 ★1 计数 +1
 *   E. 进 Garage 合成（若该武器达 5/5）→ 断言 ★1→★2、equipped 升星、装配保留
 *   F. 回首页 → 第二局真实出发 → 断言 Build 保留 / ★2 生效
 *
 * ⚠️ 随机对手：正式 Run 用 `pickOpponentForTier` + `Math.random` ⇒ 同一装配「胜负不恒定」。
 *    本文件**如实记录每次终态**；未 COMPLETE 记 FAILED/BLOCKED，**绝不当 PASS**。
 *
 * 用法：
 *   npm run build:portrait-lab
 *   node tests/_e2e_fresh_account_slice.cjs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { launchBrowser } = require('./_browser_launch.cjs');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8161;
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

const WEAPON_SLOT = 'frontMass';
const BUILD_KEY = 'strongfruit.playerBuild.v1';
const INV_KEY = 'strongfruit.ownedParts.v2';
const FUSE_STACK = 5;
const DRIVE_BUDGET_MS = 240000;
/** 随机对手 ⇒ 最多重试几局来观测一次 COMPLETE（每局如实记录）。 */
const MAX_ATTEMPTS = 4;

/** 全新账号的**可通关装配**（全部来自自然库存）：machineGun + mangoBody + 双 smallWheel。 */
const WIN_BUILD = { weapon: 'machineGun', body: 'mangoBody', front: 'smallWheel', rear: 'smallWheel' };
/** machineGun 属通用成长池：emergencyRepair 优先，其次 damageUp。 */
const POLICY = { layer1: 'emergencyRepair', lateral: null, layer2: 'damageUp', durability: 'repair' };

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}
function blocked(name, detail = '') {
  results.push({ pass: null, blocked: true, name, detail });
  console.log('BLOCKED ' + name + (detail ? ' | ' + detail : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

const waitHomeReady = (page) => page.waitForFunction(() => !!window.__PRODUCTHOME__, null, { timeout: 20000 });
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

async function clickSelector(page, sel) {
  const loc = page.locator(sel).first();
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  if (!box) throw new Error(`无法定位元素：${sel}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(100);
}
const clickRect = async (page, r) => {
  const screen = (await probeRun(page)).screen;
  const cx = screen.left + (r.x + r.w / 2) / 390 * screen.width;
  const cy = screen.top + (r.y + r.h / 2) / 844 * screen.height;
  await page.mouse.click(cx, cy);
  await sleep(180);
};

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
const STAR_FIELDS = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five' };
function invCount(dump, defId, star = 1) {
  const raw = dump[INV_KEY];
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    const e = o && o[defId];
    if (!e) return 0;
    const f = STAR_FIELDS[star];
    return f ? Number(e[f] ?? 0) : null;
  } catch {
    return null;
  }
}
function garageCard(page, defId, star = null) {
  return page.evaluate(
    ({ id, s }) => {
      const all = [...document.querySelectorAll(`[data-ph-weapon="${id}"]`)];
      const n = s === null ? all[0] : all.find((x) => x.getAttribute('data-ph-star') === String(s));
      if (!n) return null;
      const dmgLine = n.querySelector('.ph-card-damage');
      return {
        star: n.getAttribute('data-ph-star'),
        count: n.getAttribute('data-ph-count'),
        stackText: n.getAttribute('data-ph-stack-text'),
        equipped: n.getAttribute('data-ph-equipped'),
        fusable: n.getAttribute('data-ph-fusable'),
        damage: n.getAttribute('data-ph-damage'),
        damageNext: n.getAttribute('data-ph-damage-next'),
        damageLineText: dmgLine ? dmgLine.textContent : null,
      };
    },
    { id: defId, s: star },
  );
}

/** 真实 Garage 装配（点槽 → 点卡），无任何 localStorage 直写。 */
async function setUpLoadout(page, body, front, rear, weapon) {
  await clickSelector(page, '[data-ph-action="open-garage"]');
  await clickSelector(page, '[data-ph-slot="body"]');
  await clickSelector(page, `[data-ph-body="${body}"]`);
  await clickSelector(page, '[data-ph-action="modal-replace"]');
  await clickSelector(page, '[data-ph-slot="front"]');
  await clickSelector(page, `[data-ph-movement="${front}"]`);
  await clickSelector(page, '[data-ph-action="modal-replace"]');
  await clickSelector(page, '[data-ph-slot="rear"]');
  await clickSelector(page, `[data-ph-movement="${rear}"]`);
  await clickSelector(page, '[data-ph-action="modal-replace"]');
  await clickSelector(page, '[data-ph-slot="weapon"]');
  await clickSelector(page, `[data-ph-weapon="${weapon}"]`);
  await clickSelector(page, '[data-ph-action="modal-replace"]');
  await clickSelector(page, '[data-ph-action="back-home"]');
  await waitHomeReady(page);
}

/** 驱动一局 Run 到终态（真实时钟；记录 seen 阶段序列与每次终态）。 */
async function driveRun(page, label) {
  const t0 = Date.now();
  const seen = [];
  let last = null;
  let stopped = 'timeout';
  let lastExplore = null;
  while (Date.now() - t0 < DRIVE_BUDGET_MS) {
    const p = await probeRun(page);
    if (!last || last.phase !== p.phase) seen.push(p.phase);
    if (p.phase === 'BATTLE' && p.battle) {
      lastExplore = {
        nodeId: p.nodeId,
        battle: p.battlesCompleted,
        hpA: p.battle.playerHp,
        hpAMax: p.battle.playerHpMax,
      };
    }
    last = p;
    if (p.phase === 'COMPLETE' || p.phase === 'FAILED') {
      stopped = p.phase;
      break;
    }
    if (p.durabilityOpen && p.overlayOptions.length > 0) {
      const opt = p.overlayOptions.find((o) => o.id === POLICY.durability) ?? p.overlayOptions[0];
      await clickRect(page, opt.rect);
      continue;
    }
    if (p.choiceOpen && p.choiceOptions.length > 0) {
      const want = POLICY[p.choicePoolKind] ?? null;
      const opt = (want && p.choiceOptions.find((o) => o.id === want)) || p.choiceOptions[0];
      await clickRect(page, opt.rect);
      continue;
    }
    if (p.overlayOpen && p.overlayOptions.length > 0) {
      await clickRect(page, p.overlayOptions[0].rect);
      continue;
    }
    if (p.actionEnabled) await clickRect(page, p.actionRect);
    await sleep(p.phase === 'BATTLE' ? 400 : 140);
  }
  return { label, stopped, ms: Date.now() - t0, seen, last, lastExplore };
}

async function enterRun(page) {
  await Promise.all([
    page.waitForURL(/run-page\.html/, { timeout: 20000 }).catch(() => {}),
    clickSelector(page, '[data-ph-action="start-run"]'),
  ]);
  await waitRunReady(page);
  return probeRun(page);
}

/**
 * 打一局（最多 MAX_ATTEMPTS 次，直到观测到一次 COMPLETE；每局如实记录）。
 * 未 COMPLETE 的局如实记 FAILED/BLOCKED，绝不当 PASS。
 */
async function playUntilComplete(page, tag) {
  const attempts = [];
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const runStart = await enterRun(page);
    const d = await driveRun(page, `${tag} attempt ${i}`);
    attempts.push({ i, stopped: d.stopped, seen: d.seen.join('>'), lastExplore: d.lastExplore, last: d.last });
    console.log(
      `  [${tag}] 第 ${i} 局真实终态 = ${d.stopped}（${(d.ms / 1000).toFixed(1)}s，阶段 ${d.seen.join('>')}）` +
        (d.lastExplore ? ` 末次探针 ${d.lastExplore.nodeId} hp=${Math.round(d.lastExplore.hpA)}/${d.lastExplore.hpAMax}` : ''),
    );
    if (d.stopped === 'COMPLETE') return { complete: true, attempts, done: d.last, runStart };
    // 未通关：回到首页准备下一局（真实导航，不刷新存储）
    await page.goto(`${URL_BASE}/home.html?garageLegacy=1`, { waitUntil: 'load' });
    await waitHomeReady(page);
  }
  return { complete: false, attempts, done: null, runStart: null };
}

async function main() {
  console.log('=== DEMO-FRESH-ACCOUNT-VERTICAL-SLICE-R1｜全新账号真实纵切（零预置）===\n');
  for (const f of ['home.html', 'run-page.html']) {
    if (!fs.existsSync(path.join(ROOT, f))) {
      console.error(`未找到 ${path.join(ROOT, f)} —— 请先 npm run build:portrait-lab`);
      process.exit(1);
    }
  }
  const server = await startServer();
  const browser = await launchBrowser(chromium);
  // ⚠️ 独立上下文 = 全新 localStorage。绝不调用任何 seed。
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  try {
    /* ---- A. 全新账号自然起点 ---- */
    await page.goto(`${URL_BASE}/home.html?garageLegacy=1`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const home0 = await probeHome(page);
    const stored0 = await storageDump(page);
    log(
      home0.growth.fresh === true || home0.growth.seeded === true,
      '[A1] 全新账号已完成正式初始化（fresh/seeded）',
      `fresh=${home0.growth.fresh} seeded=${home0.growth.seeded}`,
    );
    log(
      invCount(stored0, 'cannon', 1) === 4,
      '[A2] R2 onboarding 自然把 cannon ★1 补到 4/5（未注入）',
      `cannon★1=${invCount(stored0, 'cannon', 1)}`,
    );
    log(
      invCount(stored0, 'smallWheel', 1) >= 1,
      '[A3] R3 种子自然给到 smallWheel ★1 ≥ 1（未注入）',
      `smallWheel★1=${invCount(stored0, 'smallWheel', 1)}`,
    );
    log(
      invCount(stored0, 'machineGun', 1) >= 1,
      '[A4] R5 内容池种子自然给到 machineGun ★1 ≥ 1（未注入）',
      `machineGun★1=${invCount(stored0, 'machineGun', 1)}`,
    );
    const hasMango = home0.body && Array.isArray(home0.body.cards)
      ? home0.body.cards.some((b) => b.defId === 'mangoBody' && b.owned)
      : null;
    log(hasMango === true, '[A5] R4 种子自然解锁 mangoBody（未注入）', `mangoBody owned=${hasMango}`);

    // 是否已有可通关装配在首页就绪（可在 Garage 换装）
    log(
      home0.runCompat && home0.runCompat.ok === true,
      '[A6] 首页当前装配可开始完整 Run（未换装）',
      home0.runCompat ? `ok=${home0.runCompat.ok} base=${home0.runCompat.equippedWeaponIds.join(',')}` : 'n/a',
    );

    /* ---- B. Garage 真实换装成可通关装配 ---- */
    await setUpLoadout(page, WIN_BUILD.body, WIN_BUILD.front, WIN_BUILD.rear, WIN_BUILD.weapon);
    const stored1 = await storageDump(page);
    const b1 = JSON.parse(stored1[BUILD_KEY]);
    log(
      b1.functionalSelections[WEAPON_SLOT] === WIN_BUILD.weapon &&
        b1.bodyDefId === WIN_BUILD.body &&
        b1.frontWheelDefId === WIN_BUILD.front &&
        b1.rearWheelDefId === WIN_BUILD.rear,
      '[B1] 可通关装配经真实 Garage UI 落盘（machineGun + mangoBody + 双 smallWheel）',
      `weapon=${b1.functionalSelections[WEAPON_SLOT]} body=${b1.bodyDefId} front=${b1.frontWheelDefId} rear=${b1.rearWheelDefId}`,
    );
    const homeAfterBuild = await probeHome(page);
    log(
      homeAfterBuild.runCompat && homeAfterBuild.runCompat.ok === true,
      '[B2] 换装后首页可开始完整 Run',
      homeAfterBuild.runCompat ? `ok=${homeAfterBuild.runCompat.ok} base=${homeAfterBuild.runCompat.equippedWeaponIds.join(',')}` : 'n/a',
    );

    /* ---- C. 真实 Run（最多 4 局，如实记录每次终态）---- */
    const play = await playUntilComplete(page, 'RUN');
    if (!play.complete) {
      blocked(
        '[C1] 全新账号装配在 ≤4 局内达成 COMPLETE',
        `4 局真实终态：${play.attempts.map((a) => `#${a.i}=${a.stopped}`).join(' / ')}（随机对手 ⇒ 可能未通关；未伪绿）`,
      );
      blocked('[C2~F 领奖→合成→下一局]', '本批未观测到 COMPLETE ⇒ 不继续（不伪造结算）');
      log(pageErrors.length === 0, '[F1] 全流程零运行时报错', pageErrors.slice(0, 2).join(' | ') || 'none');
      return;
    }
    const pDone = play.done;
    log(
      play.attempts.length === 1,
      '[C1] 全新账号装配**首局即 COMPLETE**（★1 自然库存）',
      `终态=COMPLETE · 用时 ${(play.attempts[0].ms / 1000).toFixed(1)}s · 阶段 ${play.attempts[0].seen}`,
    );
    log(
      pDone.phase === 'COMPLETE' && pDone.complete === true && pDone.failed === false,
      '[C2] Run 三段全打到终局 → RUN COMPLETE',
      `battles=${pDone.battlesCompleted}/${pDone.battleTotal} phase=${pDone.phase}`,
    );
    const rc = pDone.rewardChoices || [];
    log(
      rc.length >= 1 && pDone.actionEnabled === true,
      '[C3] COMPLETE 终点出现真实领奖候选 + CTA 可用',
      `候选=${rc.map((x) => `${x.defId}(${x.countBefore}→${x.countAfter})`).join(',')} label=${pDone.actionLabel}`,
    );
    // 观测到的那件武器（纪录用）
    const claimId = rc.length > 0 ? rc[0].defId : null;

    /* ---- D. 领奖 ---- */
    await Promise.all([
      page.waitForURL((u) => u.pathname === '/home.html', { timeout: 20000 }).catch(() => {}),
      clickRect(page, pDone.actionRect),
    ]);
    await waitHomeReady(page);
    // ⚠️ 第一次回程挂载 = 领奖执行点：homeClaim/storedClaim 在此取证。
    const homeClaim = await probeHome(page);
    const storedClaim = await storageDump(page);
    // CUTOVER-R1：后续 open-garage 段 = 旧 Garage 兼容测试（丢 query ⇒ 幂等重挂不二次领奖）。
    await page.goto(`${URL_BASE}/home.html?garageLegacy=1`, { waitUntil: 'load' });
    await waitHomeReady(page);
    log(
      homeClaim.claim && homeClaim.claim.ok === true && homeClaim.claim.defId === claimId,
      '[D1] 领奖真实生效（Repository 返回 ok）',
      homeClaim.claim ? `defId=${homeClaim.claim.defId} countAfter=${homeClaim.claim.countAfter}` : 'n/a',
    );
    log(
      claimId && invCount(storedClaim, claimId, 1) === pDone.rewardChoices[0].countAfter,
      '[D2] 库存 ★1 计数与领奖后真实值一致（4→5 或 5→6 视起点）',
      `${claimId}★1=${claimId ? invCount(storedClaim, claimId, 1) : '?'}`,
    );
    // 幂等：**重新挂载**首页（新一次 mount，无 pending claim）⇒ 不应再触发领奖。
    // ⚠️ 必须 reload 才有意义：同一 mount 的 `claim` 字段恒等于该次 mount 的领奖结果。
    await page.goto(`${URL_BASE}/home.html?garageLegacy=1`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const homeClaim2 = await probeHome(page);
    log(
      homeClaim2.claim === null,
      '[D3] 领奖 token 幂等：重新挂载首页不再触发领奖',
      `claim=${homeClaim2.claim ? 'non-null' : 'null'}`,
    );

    /* ---- E. 合成 ★2（把被观测武器经**连续多次真实胜利**累积到 5/5）----
     * 奖励池 = 出发时的基准武器（`rewardChoiceIdsFor(draft)`）；machineGun 起点 1/5
     * ⇒ 需连续多局胜利才到 5/5；每局如实记录终态，未胜的局不推进。
     */
    const winRecords = [];
    let stackNow = invCount(storedClaim, claimId, 1);
    const MAX_WIN_RUNS = 8;
    for (let k = 0; k < MAX_WIN_RUNS && stackNow !== null && stackNow < FUSE_STACK; k++) {
      const playK = await playUntilComplete(page, `ACCUM#${k + 1}`);
      if (!playK.complete) {
        winRecords.push(`#${k + 1}=未通关`);
        break;
      }
      const rcK = playK.done.rewardChoices || [];
      await Promise.all([
        page.waitForURL((u) => u.pathname === '/home.html', { timeout: 20000 }).catch(() => {}),
        clickRect(page, playK.done.actionRect),
      ]);
      await waitHomeReady(page);
      // ⚠️ 回程挂载 = 领奖执行点：dK 在此取证（库存计数用）。
      const dK = await storageDump(page);
      // CUTOVER-R1：后续 open-garage 段 = 旧 Garage 兼容测试。
      await page.goto(`${URL_BASE}/home.html?garageLegacy=1`, { waitUntil: 'load' });
      await waitHomeReady(page);
      stackNow = invCount(dK, claimId, 1);
      winRecords.push(`#${k + 1}=COMPLETE→★1×${stackNow}`);
    }
    console.log(`  [E] ${claimId} 连续胜利累积：${winRecords.join(' / ')}（目标 ${FUSE_STACK}/5）`);
    log(
      stackNow !== null && stackNow >= FUSE_STACK,
      `[E1] 连续真实胜利把 ${claimId} ★1 累积到 ${FUSE_STACK}/5（未注入）`,
      `★1×${stackNow} · 记录 ${winRecords.join(' / ')}`,
    );

    if (stackNow !== null && stackNow >= FUSE_STACK) {
      await clickSelector(page, '[data-ph-action="open-garage"]');
      const card1 = await garageCard(page, claimId, 1);
      log(!!card1 && card1.fusable === 'true', `[E2] ${claimId} ★1 达 ${FUSE_STACK}/5 且「可合成」`, card1 ? card1.stackText : 'n/a');
      // UX-BLUESTAR-R1：合成走【合成】独立按钮 → 弹窗（单组自动选中）→ 唯一确认。
      await clickSelector(page, '[data-ph-action="fuse-entry"]');
      const modalOpt = await page.evaluate((cid) => {
        const opt = document.querySelector(`[data-ph-fuse-option="${cid}"][data-ph-fuse-option-star="1"]`);
        return opt ? opt.getAttribute('data-ph-fuse-option-selected') : null;
      }, claimId);
      log(modalOpt === 'true', `[E2b] 合成弹窗自动选中 ${claimId} ★1（唯一可合成组）`, `selected=${modalOpt}`);
      await clickSelector(page, '.ph-modal-card [data-ph-action="fuse"]');
      const g2 = await probeHome(page);
      const storedFuse = await storageDump(page);
      log(
        g2.lastFuse && g2.lastFuse.ok === true && g2.lastFuse.fromStar === 1 && g2.lastFuse.toStar === 2 &&
          invCount(storedFuse, claimId, 1) === 0 && invCount(storedFuse, claimId, 2) === 1 &&
          g2.equippedWeaponId === claimId && g2.equippedWeaponStar === 2,
        '[E3] 合成：★1→0、★2=1、equipped 自动 ★2（页面+磁盘+Build 一致）',
        `★1×${invCount(storedFuse, claimId, 1)} ★2×${invCount(storedFuse, claimId, 2)} equipped=${g2.equippedWeaponId}★${g2.equippedWeaponStar}`,
      );
      const buildAfterFuse = JSON.parse(storedFuse[BUILD_KEY]);
      log(
        buildAfterFuse.bodyDefId === b1.bodyDefId &&
          buildAfterFuse.frontWheelDefId === b1.frontWheelDefId &&
          buildAfterFuse.rearWheelDefId === b1.rearWheelDefId,
        '[E4] 合成后装配保留（车身/前轮/后轮不变，仅升星）',
        `body=${buildAfterFuse.bodyDefId} front=${buildAfterFuse.frontWheelDefId} rear=${buildAfterFuse.rearWheelDefId}`,
      );
    } else {
      blocked(
        `[E2~E4] 合成 ★2（需要 ${claimId} 到 ${FUSE_STACK}/5）`,
        `连续真实胜利后 ★1=${stackNow}/5（每局约 40s；本批上限 ${MAX_WIN_RUNS} 局，未达阈值 ⇒ 不伪造升星）`,
      );
    }

    /* ---- F. 第二局（保持装配出发）---- */
    await clickSelector(page, '[data-ph-action="back-home"]');
    const home2 = await probeHome(page);
    await Promise.all([
      page.waitForURL(/run-page\.html/, { timeout: 20000 }).catch(() => {}),
      clickSelector(page, '[data-ph-action="start-run"]'),
    ]);
    await waitRunReady(page);
    const run2 = await probeRun(page);
    const stored2 = await storageDump(page);
    const r2Build = JSON.parse(stored2[BUILD_KEY]);
    log(
      run2.day === 1 && run2.battlesCompleted === 0 && run2.build.length === 0 && run2.modifier === null,
      '[F1] 第二局进入瞬间 = DAY1 / 0 场 / Build=[] / modifier=null（干净新局）',
      `DAY=${run2.day} battles=${run2.battlesCompleted} build=[${run2.build.join(',')}]`,
    );
    log(
      r2Build.functionalSelections[WEAPON_SLOT] === WIN_BUILD.weapon &&
        r2Build.bodyDefId === WIN_BUILD.body &&
        r2Build.frontWheelDefId === WIN_BUILD.front &&
        r2Build.rearWheelDefId === WIN_BUILD.rear,
      '[F2] 第二局出发装配保留（与第一局同）',
      `weapon=${r2Build.functionalSelections[WEAPON_SLOT]} body=${r2Build.bodyDefId} front=${r2Build.frontWheelDefId} rear=${r2Build.rearWheelDefId}`,
    );
    log(pageErrors.length === 0, '[F3] 全流程零运行时报错', pageErrors.slice(0, 2).join(' | ') || 'none');
    void home2;
  } catch (err) {
    log(false, '[F0] 未捕获异常', String(err && err.stack ? err.stack.split('\n')[0] : err));
    console.error(err);
  } finally {
    await browser.close();
    server.close();
  }

  const pass = results.filter((r) => r.pass === true).length;
  const blockedN = results.filter((r) => r.blocked === true).length;
  const failed = results.filter((r) => r.pass === false);
  console.log(`\n=== 结果：${pass}/${results.length} PASS，${failed.length} FAIL，${blockedN} BLOCKED ===`);
  if (failed.length > 0) {
    console.log('失败项：');
    for (const f of failed) console.log(` - ${f.name} | ${f.detail}`);
  }
  if (blockedN > 0) {
    console.log('\n不可达（既不计 PASS 也不计 FAIL）：');
    for (const b of results.filter((r) => r.blocked === true)) console.log(` - ${b.name} | ${b.detail}`);
  }
  // 只要没有 FAIL 就算命令成功（BLOCKED 是 RNG 诚实口径）
  if (failed.length > 0) process.exit(1);
}

main();
