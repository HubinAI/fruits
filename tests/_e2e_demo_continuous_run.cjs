/**
 * DEMO-M5-CONTINUOUS-RUN-RC-R1｜**连续 3+ 局真实 Run 的 Demo 候选验收**（全新账号 · 零注入）。
 *
 * 本文件是 `DEMO-FRESH-ACCOUNT-VERTICAL-SLICE-R1`（`_e2e_fresh_account_slice.cjs`）的「连续多局」延伸：
 * 上一轮只验到第二局 DAY1 开始；本轮在同一真实 Profile 上**连续打完 3 次真实 Run 尝试**，
 * 把「首页 → Garage → 完整 Run → 胜败结算 → 奖励 → 改装再战」打包成可集中真人验收的 Demo 候选。
 *
 * ⚠️ 纪律（与 `_e2e_product_*.cjs` / `_e2e_fresh_account_slice.cjs` 完全一致，不可放宽）：
 *   - 真实浏览器（playwright-core）+ 独立产物 `dist-portrait-lab/`；
 *   - **真实鼠标点击**（逻辑坐标 → 画布真实 CSS 矩形换算，不 evaluate 直调）；
 *   - **真实整页导航**（`<a href>` / `location.assign` 由浏览器执行）；
 *   - **真实 localStorage 读取**（三件套一律独立取证，不读页面探针）；
 *   - **零预置**：不写 / 不注入 localStorage、不篡改 RNG / 库存 / 胜负 / 奖励、不走 Lab 控制入口。
 *
 * 连续旅程（同一真实 Profile，全程真实点击）：
 *   RUN-1：用**全新账号默认装配**（cannon 4/5 · 默认车身/轮，未换装）出发 → 终态（预期 FAILED，如实计入）
 *          ⇒ 演示设计风险「首局默认炮打不过 UI 唯一默认路线」+ 失败结算→返回首页→不发证。
 *   RUN-2：进 Garage 真实换装成**可通关装配**（machineGun + mangoBody + 双 smallWheel）
 *          → 终态；若未 COMPLETE 则同装配重试（bounded），直到观测到一次真实 COMPLETE → 真实领奖。
 *   RUN-3：再进 Garage 换成**不同的合法装配**（machineGun + durianBody + 双 smallWheel）
 *          → 终态；并明确断言「换装确实改变了下一局 Build」（车身：mango → durian）。
 *
 * 验收口径（如实，绝伪绿）：
 *   - 每次真实 Run 都有唯一终态 + 进入→退出的浏览器证据，同一真实 Profile 数据贯通；
 *   - 至少一局 COMPLETE → 真实领奖并（由产品侧幂等）防重复；失败局不领；
 *   - 车库库存 / 存档 Build 与首页一致，回首页 / 失败重试无白屏与状态残留；
 *   - 失败不当 PASS，随机阻塞记 BLOCKED。
 *
 * 用法：
 *   npm run build:portrait-lab
 *   node tests/_e2e_demo_continuous_run.cjs   （或 npm run e2e:demo-continuous-run）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { launchBrowser } = require('./_browser_launch.cjs');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8162;
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
/** 唯一武器槽（= 车身前上挂点 frontMass）。 */
const WEAPON_SLOT = 'frontMass';

/** 可通关装配（全部来自自然库存）：machineGun + mangoBody + 前/后 smallWheel。 */
const WIN_BUILD = { weapon: 'machineGun', body: 'mangoBody', front: 'smallWheel', rear: 'smallWheel' };
/** 不同的合法装配（只换车身，仍 machineGun + 双 smallWheel）：用来证明换装确实改变下一局 Build。 */
const VARIANT_BUILD = { weapon: 'machineGun', body: 'durianBody', front: 'smallWheel', rear: 'smallWheel' };

/**
 * 稳定取胜路线（锚在池内 id 上，不靠随机）：machineGun 属通用基础成长池，
 * `emergencyRepair` 先 → `damageUp`（与 `_e2e_product_loop.cjs` / `_e2e_fresh_account_slice.cjs` 同口径）。
 */
const POLICY = { layer1: 'emergencyRepair', lateral: null, layer2: 'damageUp', durability: 'repair' };

const FUSE_STACK = 5;
/** 单次完整 Run 的驱动预算（三段真实物理战斗）。 */
const DRIVE_BUDGET_MS = 240000;
/** RUN-2 为保证「至少一局真实 COMPLETE」而对同一可通关装配做的 bounded 重试上限。 */
const MAX_COMPLETE_RETRY = 3;

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

/* --------------------------------------------------------------- 页面助手 */

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

/** 真实鼠标点击：元素真实 CSS 矩形中心（不用 evaluate 直调 click）。 */
async function clickSelector(page, sel) {
  const loc = page.locator(sel).first();
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  if (!box) throw new Error(`无法定位元素：${sel}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(120);
}
/** 真实鼠标点击 Run 画布：逻辑坐标 → 屏幕坐标。 */
async function clickRect(page, r) {
  const screen = (await probeRun(page)).screen;
  const cx = screen.left + (r.x + r.w / 2) / 390 * screen.width;
  const cy = screen.top + (r.y + r.h / 2) / 844 * screen.height;
  await page.mouse.click(cx, cy);
  await sleep(180);
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
const STAR_FIELDS = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five' };
function invCount(dump, defId, star = 1) {
  const raw = dump[INV_KEY];
  if (!raw) return null;
  try {
    const e = JSON.parse(raw)[defId];
    if (!e) return 0;
    return Number(e[STAR_FIELDS[star]] ?? 0);
  } catch {
    return null;
  }
}
/** 存档里主武器槽（独立取证）。 */
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
/** 车库 / 首页某 Weapon 卡的**真实 DOM 读数**。 */
function garageCard(page, defId, star = null) {
  return page.evaluate(
    ({ id, s }) => {
      const all = [...document.querySelectorAll(`[data-ph-weapon="${id}"]`)];
      const n = s === null ? all[0] : all.find((x) => x.getAttribute('data-ph-star') === String(s));
      if (!n) return null;
      return {
        star: n.getAttribute('data-ph-star'),
        count: n.getAttribute('data-ph-count'),
        stackText: n.getAttribute('data-ph-stack-text'),
        equipped: n.getAttribute('data-ph-equipped'),
        fusable: n.getAttribute('data-ph-fusable'),
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
  await clickSelector(page, '[data-ph-slot="front"]');
  await clickSelector(page, `[data-ph-movement="${front}"]`);
  await clickSelector(page, '[data-ph-slot="rear"]');
  await clickSelector(page, `[data-ph-movement="${rear}"]`);
  await clickSelector(page, '[data-ph-slot="weapon"]');
  await clickSelector(page, `[data-ph-weapon="${weapon}"]`);
  await clickSelector(page, '[data-ph-action="back-home"]');
  await waitHomeReady(page);
}

/** 进入 Run（真实点击开始冒险 → 等 Run 页就绪）。 */
async function enterRun(page) {
  await Promise.all([
    page.waitForURL(/run-page\.html/, { timeout: 20000 }).catch(() => {}),
    clickSelector(page, '[data-ph-action="start-run"]'),
  ]);
  await waitRunReady(page);
  return probeRun(page);
}

/** 驱动一局 Run 到终态（真实时钟；记录阶段序列与末次战斗现场）。 */
async function driveRun(page, label) {
  const t0 = Date.now();
  const seen = [];
  let last = null;
  let lastExplore = null;
  while (Date.now() - t0 < DRIVE_BUDGET_MS) {
    const p = await probeRun(page);
    if (!last || last.phase !== p.phase) seen.push(p.phase);
    if (p.phase === 'BATTLE' && p.battle) {
      lastExplore = { nodeId: p.nodeId, battles: p.battlesCompleted, hpA: p.battle.playerHp, hpAMax: p.battle.playerHpMax };
    }
    last = p;
    if (p.phase === 'COMPLETE' || p.phase === 'FAILED') {
      return { stopped: p.phase, ms: Date.now() - t0, seen, last, lastExplore };
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
  return { stopped: 'timeout', ms: Date.now() - t0, seen, last, lastExplore };
}

/** 终态后的「退出」：COMPLETE 按 CTA 领奖返回 / FAILED 按 CTA 返回主界面（均经真实点击）。 */
async function exitTerminal(page, terminal) {
  await Promise.all([
    page.waitForURL((u) => u.pathname === '/home.html', { timeout: 20000 }).catch(() => {}),
    clickRect(page, terminal.actionRect),
  ]);
  await waitHomeReady(page);
  return probeHome(page);
}

/* --------------------------------------------------- 单局编排（含装配/终态/领奖） */

/**
 * 打一局并据终态处理（领奖 / 返回）。
 * @param build 若提供则先真实换装；为 null 表示用当前（默认）装配、不换装。
 * @returns 该局的结构化证据。
 */
async function playRun(page, label, build) {
  if (build) await setUpLoadout(page, build.body, build.front, build.rear, build.weapon);
  const storedBefore = await storageDump(page);
  const runStart = await enterRun(page);
  const rl = runStart.playerLoadout;
  const startLoadout = {
    body: rl.bodyDefId,
    weapon: rl.functionalSelections[WEAPON_SLOT],
    front: rl.functionalSelections['front'],
    rear: rl.functionalSelections['rear'],
  };
  const d = await driveRun(page, label);
  const terminal = d.last;
  const seenTrail = d.seen.join('>');
  const outcome = d.stopped; // COMPLETE / FAILED / timeout

  let claimed = false;
  let claimId = null;
  let homeAfter = null;
  let invDelta = null;

  if (outcome === 'COMPLETE') {
    const rc = terminal.rewardChoices || [];
    claimId = rc.length > 0 ? rc[0].defId : null;
    const before = claimId ? invCount(storedBefore, claimId, 1) : null;
    homeAfter = await exitTerminal(page, terminal); // 点「领取并返回」
    const after = claimId ? invCount(await storageDump(page), claimId, 1) : null;
    claimed = !!(homeAfter.claim && homeAfter.claim.ok === true);
    invDelta = claimId ? after - before : null;
  } else if (outcome === 'FAILED') {
    const before = invCount(storedBefore, 'machineGun', 1);
    homeAfter = await exitTerminal(page, terminal); // 点「返回主界面」
    const after = invCount(await storageDump(page), 'machineGun', 1);
    claimed = false;
    invDelta = after - before; // 失败应恒为 0（不发证）
  } else {
    // timeout：安全网——不当 PASS，记 BLOCKED，返回首页收尾。
    try {
      await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
      await waitHomeReady(page);
    } catch {
      /* noop */
    }
    homeAfter = await probeHome(page).catch(() => null);
    claimed = false;
  }

  return {
    label,
    build: build || startLoadout,
    startLoadout,
    storedBefore,
    terminal: outcome,
    seenTrail,
    ms: d.ms,
    lastExplore: d.lastExplore,
    terminalProbe: terminal,
    claimed,
    claimId,
    invDelta,
    homeAfter,
  };
}

/* ------------------------------------------------------------------- 主流程 */

async function main() {
  console.log('=== DEMO-M5-CONTINUOUS-RUN-RC-R1｜连续 3+ 局真实 Run（全新账号 · 零注入）===\n');

  for (const f of ['home.html', 'run-page.html']) {
    if (!fs.existsSync(path.join(ROOT, f))) {
      console.error(`未找到 ${path.join(ROOT, f)} —— 请先 npm run build:portrait-lab`);
      process.exit(1);
    }
  }

  const server = await startServer();
  const browser = await launchBrowser(chromium);
  // 独立上下文 = 全新 localStorage。绝不调用任何 seed。
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));

  const runs = [];
  try {
    /* ==================================== 全新账号自然起点 */
    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
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
      invCount(stored0, 'machineGun', 1) >= 1,
      '[A3] R5 内容池种子自然给到 machineGun ★1 ≥1（未注入）',
      `machineGun★1=${invCount(stored0, 'machineGun', 1)}`,
    );
    const hasMango = home0.body && Array.isArray(home0.body.cards)
      ? home0.body.cards.some((b) => b.defId === 'mangoBody' && b.owned)
      : null;
    const hasDurian = home0.body && Array.isArray(home0.body.cards)
      ? home0.body.cards.some((b) => b.defId === 'durianBody' && b.owned)
      : null;
    log(hasMango === true && hasDurian === true, '[A4] R4 种子自然解锁 mangoBody / durianBody（未注入）', `mango=${hasMango} durian=${hasDurian}`);
    log(
      home0.equippedWeaponId === 'cannon' && home0.startRunBlocked === false && !!home0.startRunHref,
      '[A5] 默认装配 = cannon 且「开始冒险」可执行（cannon 在完整 Run 支持清单内）',
      `equipped=${home0.equippedWeaponId} blocked=${home0.startRunBlocked}`,
    );

    /* ============================ RUN-1：全新账号默认装配（cannon，不换装） */
    console.log('\n--- RUN-1：默认装配（cannon 4/5 · 默认车身/轮）---');
    const run1 = await playRun(page, 'RUN-1(default)', null);
    runs.push(run1);
    console.log(
      `  RUN-1 真实终态 = ${run1.terminal}（${(run1.ms / 1000).toFixed(1)}s，阶段 ${run1.seenTrail}）` +
        (run1.lastExplore ? ` 末次探针 node=${run1.lastExplore.nodeId} hp=${Math.round(run1.lastExplore.hpA)}/${run1.lastExplore.hpAMax}` : ''),
    );
    log(
      run1.terminal === 'FAILED',
      '[B1] RUN-1 默认 cannon 装配在 UI 唯一默认路线下**真实 FAILED**（设计风险：默认炮打不过终局控距）',
      `终态=${run1.terminal} 阶段=${run1.seenTrail}`,
    );
    log(
      run1.terminal !== 'COMPLETE' ? run1.homeAfter && run1.homeAfter.claim === null && run1.invDelta === 0
        : (run1.claimed && run1.invDelta === 1),
      '[B2] 失败局**不发证**：回首页后 claim 为 null、machineGun 库存未变（若意外 COMPLETE 则必须真实领奖）',
      run1.terminal === 'COMPLETE' ? `claimed=${run1.claimed} delta=${run1.invDelta}` : `claim=${run1.homeAfter && run1.homeAfter.claim} delta=${run1.invDelta}`,
    );
    log(
      run1.homeAfter && run1.homeAfter.view === 'home' && !!run1.homeAfter.startRunHref && run1.homeAfter.startRunBlocked === false,
      '[B3] RUN-1 结束后回到**干净首页**：可再次出发（无白屏 / 无状态残留）',
      run1.homeAfter ? `view=${run1.homeAfter.view} blocked=${run1.homeAfter.startRunBlocked}` : 'n/a',
    );

    /* ============================ RUN-2：可通关装配 machineGun+mangoBody+双smallWheel */
    console.log('\n--- RUN-2：可通关装配（machineGun+mangoBody+双 smallWheel）---');
    let run2 = null;
    let attempts = 0;
    for (let i = 1; i <= MAX_COMPLETE_RETRY; i++) {
      attempts += 1;
      // 仅在第一次（或换装被重置时）换装；重试时装配已落盘，直接出发。
      run2 = await playRun(page, `RUN-2(#${i})`, i === 1 ? WIN_BUILD : null);
      runs.push(run2);
      console.log(
        `  RUN-2 第 ${i} 次真实终态 = ${run2.terminal}（${(run2.ms / 1000).toFixed(1)}s，阶段 ${run2.seenTrail}）`,
      );
      if (run2.terminal === 'COMPLETE') break;
      // FAILED：返回首页后继续重试（同一可通关装配）
    }
    log(
      run2 && run2.terminal === 'COMPLETE',
      '[C1] RUN-2 可通关装配**真实 COMPLETE**（最多重试 ${MAX_COMPLETE_RETRY} 次，每次如实记录）',
      `终态=${run2 ? run2.terminal : 'n/a'} 尝试=${attempts}`,
    );
    if (run2 && run2.terminal === 'COMPLETE') {
      const rc = run2.terminalProbe.rewardChoices || [];
      log(
        rc.length >= 1 && run2.terminalProbe.actionEnabled === true,
        '[C2] COMPLETE 终点出现真实领奖候选 + CTA 可用',
        `候选=${rc.map((x) => `${x.defId}(${x.countBefore}→${x.countAfter})`).join(',')}`,
      );
      log(
        run2.claimed === true && run2.invDelta === 1,
        '[C3] 真实领奖生效：claimed=ok 且被领武器 ★1 +1（仅胜利才发证）',
        `claimId=${run2.claimId} delta=${run2.invDelta}`,
      );
      // 幂等：reload 后 claim 应清除（不重复发奖）
      await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
      await waitHomeReady(page);
      const homeReload = await probeHome(page);
      log(
        homeReload.claim === null,
        '[C4] 领奖 token 幂等：重新挂载首页不再触发领奖（不重复发奖）',
        `claim=${homeReload.claim ? 'non-null' : 'null'}`,
      );
    } else {
      blocked('[C2~C4] 真实 COMPLETE + 领奖', `RUN-2 在 ${MAX_COMPLETE_RETRY} 次内未观测到 COMPLETE（随机对手；未伪绿）`);
    }

    /* ============================ RUN-3：不同的合法装配 machineGun+durianBody+双smallWheel */
    console.log('\n--- RUN-3：不同的合法装配（machineGun+durianBody+双 smallWheel）---');
    const run3 = await playRun(page, 'RUN-3(variant)', VARIANT_BUILD);
    runs.push(run3);
    console.log(
      `  RUN-3 真实终态 = ${run3.terminal}（${(run3.ms / 1000).toFixed(1)}s，阶段 ${run3.seenTrail}）`,
    );
    // 装配传播证明：RUN-3 出发时读取的 Build 必须 = 刚在车库换上的 durianBody 装配。
    // ⚠️ Run 探针的 `playerLoadout.functionalSelections` 只暴露武器槽（frontMass）等 functional 硬点，
    //    **轮组不在其中**——轮组由正式 Build 存档的 `frontWheelDefId` / `rearWheelDefId` 决定下一局实际装配，
    //    与 functionalSelections 分开存储。故车身/武器读探针、轮组读正式存档，二者分别核对。
    const start3 = run3.startLoadout;
    const sb3 = JSON.parse(run3.storedBefore[BUILD_KEY]);
    const wheelsOk = sb3.frontWheelDefId === VARIANT_BUILD.front && sb3.rearWheelDefId === VARIANT_BUILD.rear;
    log(
      start3.body === VARIANT_BUILD.body &&
        start3.weapon === VARIANT_BUILD.weapon &&
        wheelsOk,
      '[D1] 换装确实改变了下一局 Build：RUN-3 出发 = durianBody + machineGun + 双 smallWheel（车身/武器读 Run 探针，轮组读正式 Build 存档）',
      `probe.body=${start3.body} weapon=${start3.weapon} · 存档 front=${sb3.frontWheelDefId} rear=${sb3.rearWheelDefId}`,
    );
    // RUN-2（若 COMPLETE）的 Build 应为 mangoBody —— 与 RUN-3 的 durianBody 不同 ⇒ 换装生效
    const run2Body = run2 ? run2.startLoadout.body : null;
    log(
      run2Body !== start3.body,
      '[D2] 与上一局 Build 不同：RUN-2 车身 = ' + (run2Body || 'n/a') + ' vs RUN-3 车身 = ' + start3.body + '（换装真实传入下一局）',
      `RUN-2.body=${run2Body} RUN-3.body=${start3.body}`,
    );
    if (run3.terminal === 'COMPLETE') {
      log(
        run3.claimed === true && run3.invDelta === 1,
        '[D3] RUN-3 若 COMPLETE 也真实领奖（machineGun ★1 再 +1）',
        `claimId=${run3.claimId} delta=${run3.invDelta}`,
      );
    } else {
      log(
        run3.homeAfter && run3.homeAfter.claim === null && run3.invDelta === 0,
        '[D3] RUN-3 若 FAILED 同样不发证（失败不当 PASS）',
        `claim=${run3.homeAfter && run3.homeAfter.claim} delta=${run3.invDelta}`,
      );
    }

    /* ============================ 贯通性 / 无残留 收尾 */
    const completeRuns = runs.filter((r) => r.terminal === 'COMPLETE');
    const failRuns = runs.filter((r) => r.terminal === 'FAILED');
    log(
      completeRuns.length >= 1,
      '[E1] 全程至少一局真实 COMPLETE 并走真实领奖（Demo 胜利路径成立）',
      `COMPLETE=${completeRuns.length} 次 · FAILED=${failRuns.length} 次`,
    );
    log(
      failRuns.every((r) => r.invDelta === 0),
      '[E2] 所有失败局均未发证（machineGun 库存零变动）',
      `失败局数=${failRuns.length}`,
    );
    const finalStored = await storageDump(page);
    const mgFinal = invCount(finalStored, 'machineGun', 1);
    const mgExpected = 1 + completeRuns.length; // 自然 1/5 + 每次 COMPLETE +1
    log(
      mgFinal === mgExpected,
      '[E3] 同一真实 Profile 数据贯通：machineGun ★1 终值 = 自然 1 + 真实 COMPLETE 次数',
      `终值=${mgFinal} 期望=${mgExpected}（COMPLETE=${completeRuns.length}）`,
    );
    log(
      pageErrors.length === 0,
      '[E4] 全流程零运行时报错（无白屏 / 无 JS 异常）',
      pageErrors.slice(0, 2).join(' | ') || 'none',
    );
  } catch (err) {
    log(false, '[F0] 未捕获异常', String(err && err.stack ? err.stack.split('\n')[0] : err));
    console.error(err);
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n=== 连续 Run 终态一览 ===');
  for (const r of runs) {
    console.log(
      `  ${r.label}: ${r.terminal} · ${(r.ms / 1000).toFixed(1)}s · Build=${JSON.stringify(r.build)} · 领奖=${r.claimed ? r.claimId : '否'}`,
    );
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

main().catch((e) => {
  console.error('E2E 运行失败：', e && e.stack ? e.stack : e);
  process.exit(1);
});
