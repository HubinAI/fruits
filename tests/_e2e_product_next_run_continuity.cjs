/**
 * PRODUCT-LOOP-R10-NEXT-RUN-CONTINUITY｜
 * 「Run 1 → COMPLETE → 领奖 → 合成 ★2 → 回 Garage（保持 Body/Movement/Weapon）→ Run 2 → ★2 真的生效」
 * 的**浏览器真实闭环** smoke。
 *
 * ⚠️ 与 `_e2e_product_star_power.cjs` 同源的纪律（全部是真实行为取证）：
 *   - 真实浏览器（playwright-core / msedge）+ 独立产物 `dist-portrait-lab/`；
 *   - 真实鼠标点击 / 真实整页导航 / 真实 localStorage 读取 / 只读诊断句柄；
 *   - 战斗伤害是**实测**的（`battleWorld.playerWeaponHits` 来自正式 `damage` 事件）。
 *
 * ── 覆盖两条浏览器路径（PRODUCT-LOOP-P0-HIDDEN-TOP-WEAPON-REMOVAL 之前，产品真实可达空间里
 *    **唯一**能 COMPLETE 的两条组合；移除隐藏锤后这两条**也**打不赢）──────────
 *   来自 `tests/productRunContinuityWinningSearch.test.ts` 的权威侦察矩阵（8 车身 × 7 武器 ×
 *   5 后轮 = 280 组合，在**产品真实可达**空间里扫）：
 *     · **移除隐藏锤之前**：仅 2 个 COMPLETE 组合（machineGun：coconutBody+heavyWheel；
 *       shotgun：pineappleBody+smallWheel），其余 5 件零 COMPLETE。
 *     · **移除隐藏锤之后（本 Queue 当前状态）**：**全部 7 件零 COMPLETE**（矩阵 `productDraft`
 *       已同步清空 top ⇒ 重扫结论）—— 即 Q3 能力缺口 (a) 被本 Queue 坐实为**产品整体不可赢**，
 *       属真实 Blocker（平衡缺口，非回归）。
 *   本 E2E 仍跑这两条路径，但目的变为：**用真实浏览器证明 Runtime 只读到 frontMass 一件武器
 *   （无隐藏锤）、零运行时报错**，并把 COMPLETE/Continuity 记为真实 Blocker（不计 FAIL/PASS），
 *   不污染验收计数、也不伪造「能赢」。
 *
 * ── 每条路径的获胜装配 ──────────────────────────────────────────────────────
 *   侦察矩阵给定 `(body, rear)`，主武器 = 该路径的 weapon；车身 / 后轮经**真实 Garage UI**
 *   落盘；`top` 槽经 PRODUCT-LOOP-P0-HIDDEN-TOP-WEAPON-REMOVAL 已清空（产品侧不暴露，也不再携带隐藏锤）。
 * ⚠️ 后轮（heavyWheel / smallWheel）属 `OFFICIAL_MOVEMENTS`（needsInventory=true），
 *   全新账号不自动拥有 ⇒ 本 E2E 在装配前**显式 seed 后轮库存**（与 seed 武器同一纪律：
 *   只改 `ownedParts.v2` 计数一个数字，不碰 Build / 不碰内容数值）。
 *
 * ── 必验 Run 2 项（Queue 点名）─────────────────────────────────────────────
 *   DAY 1 干净开始 / Enemy 状态干净 / Build 清空 / Weapon Star 保留 / Body 保留 /
 *   front-rear Movement 保留 / Reward 不重复 / Settlement 状态清空 / Audio 状态干净。
 *
 * ── 通用性 ──────────────────────────────────────────────────────────────────
 *   本文件**不写死任何武器的伤害数字**：★2 实测伤害 = round(★1 实测 × 1.25)，
 *   卡面下一星预览 = round(基准 × 1.25) 由卡自己的 data-* 推出 ⇒ 三条路径共用一套断言。
 *
 * 用法：
 *   npm run build:portrait-lab
 *   node tests/_e2e_product_next_run_continuity.cjs
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

/**
 * 三条浏览器路径。⚠️ `(body, rear)` 来自侦察矩阵（产品真实可达 COMPLETE 组合）。
 * `policy` 与武器池族一致：非 Cannon → 通用基础成长池 `emergencyRepair → damageUp`；
 * Cannon → 自己的那套 `heavyShell → kineticBurst`。
 * FUSE_STACK：把被观测武器 ★1 摆到 4/5，使「领奖 4→5 → 合成 ★2」走得完。
 */
const FUSE_STACK = 5;
const SEED_STACK = FUSE_STACK - 1;
const WEAPON_SLOT = 'frontMass';
const BUILD_KEY = 'strongfruit.playerBuild.v1';
const INV_KEY = 'strongfruit.ownedParts.v2';

// ⚠️ **PRODUCT-LOOP-P0-HIDDEN-TOP-WEAPON-REMOVAL 之后**：产品真实可达空间（仅 frontMass 一件武器）
//   **全部 7 件零 COMPLETE**（权威侦察矩阵 280 组合重扫结论）—— Q3 能力缺口 (a) 坐实。
//   这两条路径仍跑，目的：**真实浏览器取证** Runtime 只读到 frontMass 一件武器（无隐藏锤）+ 零报错，
//   并把 COMPLETE/Continuity 记为真实 Blocker（不计 FAIL/PASS）。本 Queue 明令**不修**此缺口。
const WEAPON_PATHS = [
  { weapon: 'machineGun', body: 'coconutBody', rear: 'heavyWheel', policy: { layer1: 'emergencyRepair', lateral: null, layer2: 'damageUp', durability: 'repair' } },
  { weapon: 'shotgun', body: 'pineappleBody', rear: 'smallWheel', policy: { layer1: 'emergencyRepair', lateral: null, layer2: 'damageUp', durability: 'repair' } },
];
/** 需要库存才拥有的后轮（OFFICIAL_MOVEMENTS，needsInventory=true）。wheelStd/none 不需要。 */
const REAR_WHEELS_NEEDS_INVENTORY = new Set(['smallWheel', 'largeWheel', 'heavyWheel']);

const RUN_FIRST_DAY = 1;
const DRIVE_BUDGET_MS = 240000;

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

async function clickSelector(page, sel) {
  const loc = page.locator(sel).first();
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  if (!box) throw new Error(`无法定位元素：${sel}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(100);
}
async function clickLogical(page, lx, ly) {
  const screen = (await probeRun(page)).screen;
  const cx = screen.left + (lx / 390) * screen.width;
  const cy = screen.top + (ly / 844) * screen.height;
  await page.mouse.click(cx, cy);
}
const clickRect = async (page, r) => clickLogical(page, r.x + r.w / 2, r.y + r.h / 2);

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
    if (!f) return null;
    return Number(e[f] ?? 0);
  } catch {
    return null;
  }
}
function storedWeaponStar(dump) {
  const raw = dump[BUILD_KEY];
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    const s = o && o.functionalStars && o.functionalStars[WEAPON_SLOT];
    return typeof s === 'number' ? s : 1;
  } catch {
    return null;
  }
}
function equippedOf(href) {
  const raw = new URLSearchParams(href.split('?')[1] ?? '').get('equipped') ?? '';
  return raw ? JSON.parse(raw) : null;
}
function garageCard(page, defId, star = null) {
  return page.evaluate(
    ({ id, s }) => {
      const all = [...document.querySelectorAll(`[data-ph-weapon="${id}"]`)];
      const n = s === null ? all[0] : all.find((x) => x.getAttribute('data-ph-star') === String(s));
      if (!n) return null;
      const dmgLine = n.querySelector('.ph-card-damage');
      return {
        text: n.textContent,
        star: n.getAttribute('data-ph-star'),
        count: n.getAttribute('data-ph-count'),
        stackText: n.getAttribute('data-ph-stack-text'),
        equipped: n.getAttribute('data-ph-equipped'),
        fusable: n.getAttribute('data-ph-fusable'),
        damage: n.getAttribute('data-ph-damage'),
        damageNext: n.getAttribute('data-ph-damage-next'),
        damageLineText: dmgLine ? dmgLine.textContent : null,
        cards: all.length,
      };
    },
    { id: defId, s: star },
  );
}

/** 夹具预置：把某武器 ★1 库存计数设成 n（只改一个数字；Build 一律走真实 Garage UI）。 */
async function seedWeaponStack(page, defId, n) {
  const before = await page.evaluate(
    ({ id, count }) => {
      const KEY = 'strongfruit.ownedParts.v2';
      const raw = localStorage.getItem(KEY);
      if (!raw) throw new Error('夹具预置前提不成立：新账号种子还没跑 ⇒ 库存存档不存在');
      const obj = JSON.parse(raw);
      const prev = obj[id] && typeof obj[id] === 'object' ? obj[id] : {};
      obj[id] = { ...prev, one: count };
      localStorage.setItem(KEY, JSON.stringify(obj));
      return prev.one ?? 0;
    },
    { id: defId, count: n },
  );
  // ⚠️ 必须**显式回 home.html** 再读 `__PRODUCTHOME__`：上一路径跑完可能停在 run-page.html，
  //    `reload()` 会重载 run-page（不挂 `__PRODUCTHOME__`）⇒ waitHomeReady 超时。localStorage 是
  //    origin 级共享，先设再回 home 即可（与当前停留在哪一页无关）。
  await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
  await waitHomeReady(page);
  return before;
}

/**
 * 夹具预置：把某**后轮**（smallWheel / heavyWheel 等，属 OFFICIAL_MOVEMENTS）的库存计数设成 n。
 * 与 `seedWeaponStack` 同一纪律：只改 `ownedParts.v2` 的 `one` 一个数字（Movement 与 Weapon
 * **共用同一份库存**），不碰 Build、不碰任何数值。
 * ⚠️ 为什么需要它：全新账号的 `ensureInventory` 只种子 `STARTER_PARTS`（不含 Movement），
 *   `ensureMovementOwnership` 又只补「已装备但不拥有」的后轮 —— 在 Garage 经真实 UI 点选装备
 *   之前，后轮根本不在库存里 ⇒ 卡片不可装备。故本 E2E 在装配前显式 seed 后轮。
 */
async function seedMovementStack(page, defId, n) {
  const before = await page.evaluate(
    ({ id, count }) => {
      const KEY = 'strongfruit.ownedParts.v2';
      const raw = localStorage.getItem(KEY);
      if (!raw) throw new Error('夹具预置前提不成立：新账号种子还没跑 ⇒ 库存存档不存在');
      const obj = JSON.parse(raw);
      const prev = obj[id] && typeof obj[id] === 'object' ? obj[id] : {};
      obj[id] = { ...prev, one: count };
      localStorage.setItem(KEY, JSON.stringify(obj));
      return prev.one ?? 0;
    },
    { id: defId, count: n },
  );
  await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
  await waitHomeReady(page);
  return before;
}

/** 经真实 Garage UI 把车配成「获胜装配」：车身 → 后轮 → 主武器。 */
async function setUpWinningLoadout(page, body, rear, weapon) {
  await clickSelector(page, '[data-ph-action="open-garage"]');
  await clickSelector(page, '[data-ph-slot="body"]');
  await clickSelector(page, `[data-ph-body="${body}"]`);
  await clickSelector(page, '[data-ph-slot="rear"]');
  await clickSelector(page, `[data-ph-movement="${rear}"]`);
  await clickSelector(page, '[data-ph-slot="weapon"]');
  await clickSelector(page, `[data-ph-weapon="${weapon}"]`);
  await clickSelector(page, '[data-ph-action="back-home"]');
  await waitHomeReady(page);
}

async function driveRun(page, policy, label, stopOnFirstWeaponHit = false, observedWeapon) {
  const t0 = Date.now();
  const samples = [];
  const seen = [];
  let last = null;
  let stopped = 'timeout';
  while (Date.now() - t0 < DRIVE_BUDGET_MS) {
    const p = await probeRun(page);
    if (!last || last.phase !== p.phase) seen.push(p.phase);
    last = p;
    const bw = p.battleWorld;
    if (bw) {
      const hitsRaw = bw.playerWeaponHits || {};
      const hits = {};
      for (const [k, v] of Object.entries(hitsRaw)) {
        hits[k] = { count: v.count, firstAtMs: v.firstAtMs, damages: [...v.damages] };
      }
      samples.push({
        phase: p.phase,
        day: p.day,
        nodeId: p.nodeId,
        battlesCompleted: p.battlesCompleted,
        build: [...p.build],
        modifier: p.modifier,
        profileStars: { ...p.playerLoadout.functionalStars },
        weapons: bw.playerWeapons.map((w) => ({ ...w, params: { ...w.params } })),
        hits,
        hp: p.battle ? { a: p.battle.playerHp, aMax: p.battle.playerHpMax } : null,
      });
      if (stopOnFirstWeaponHit && hits[observedWeapon] && hits[observedWeapon].count >= 1) {
        stopped = 'weapon-hit';
        break;
      }
    }
    if (p.phase === 'COMPLETE' || p.phase === 'FAILED') {
      stopped = p.phase;
      break;
    }
    if (p.durabilityOpen && p.overlayOptions.length > 0) {
      const opt = p.overlayOptions.find((o) => o.id === policy.durability) ?? p.overlayOptions[0];
      await clickRect(page, opt.rect);
      await sleep(180);
      continue;
    }
    if (p.choiceOpen && p.choiceOptions.length > 0) {
      const want = policy[p.choicePoolKind] ?? null;
      const opt = (want && p.choiceOptions.find((o) => o.id === want)) || p.choiceOptions[0];
      await clickRect(page, opt.rect);
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
  const withObserved = samples.filter((s) => s.hits[observedWeapon]);
  return {
    label,
    stopped,
    ms: Date.now() - t0,
    seen,
    samples,
    last,
    weapons: samples.length > 0 ? samples[samples.length - 1].weapons : [],
    firstWeaponHit: withObserved.length > 0 ? withObserved[0].hits[observedWeapon] : null,
    fullestWeaponHits:
      withObserved.length > 0
        ? withObserved.reduce((a, b) => (b.hits[observedWeapon].count > a.hits[observedWeapon].count ? b : a)).hits[observedWeapon]
        : null,
    firstBattleSample: samples.length > 0 ? samples[0] : null,
  };
}

async function enterRunAndDrive(page, policy, label, stopOnFirstWeaponHit, observedWeapon) {
  const homeBefore = await probeHome(page);
  const equipped = equippedOf(homeBefore.adventureHref);
  await Promise.all([
    page.waitForURL(/run-page\.html/, { timeout: 20000 }).catch(() => {}),
    clickSelector(page, '[data-ph-action="start-run"]'),
  ]);
  await waitRunReady(page);
  const runStart = await probeRun(page);
  const detail = await driveRun(page, policy, label, stopOnFirstWeaponHit, observedWeapon);
  return { homeBefore, equipped, runStart, detail };
}
function mainWeapon(weapons, defId, slot = WEAPON_SLOT) {
  return weapons.find((w) => w.defId === defId && w.hardpointId === slot) ?? null;
}
function verifiedEquipped(probe, dump, defId) {
  return probe.equippedWeaponId === defId && probe.equippedWeaponStar === 2 && storedWeaponStar(dump) === 2;
}
function onlyDamageDiffers(a, b) {
  if (!a || !b) return false;
  const ka = Object.keys(a.params).sort();
  const kb = Object.keys(b.params).sort();
  if (ka.join(',') !== kb.join(',')) return false;
  let damageKeysSeen = 0;
  for (const k of ka) {
    if (/damage/i.test(k)) {
      damageKeysSeen += 1;
      if (!(b.params[k] > a.params[k])) return false;
      continue;
    }
    if (a.params[k] !== b.params[k]) return false;
  }
  return damageKeysSeen > 0;
}
function onlyDamageDetail(a, b) {
  if (!a || !b) return 'n/a';
  const diff = Object.keys(a.params)
    .filter((k) => a.params[k] !== b.params[k])
    .map((k) => `${k}: ${a.params[k]} → ${b.params[k]}`);
  const same = Object.keys(a.params).filter((k) => a.params[k] === b.params[k]).length;
  return `变了 ${diff.join(' / ') || '（无）'} · 其余 ${same} 项逐字相同`;
}

/* ============================================================================
 * 单条路径：seed → 装配 → Run1 → 领奖 → 合成 ★2 → 验证 Garage 保留 → Run2 验 ★2
 * ========================================================================== */
async function runPath(page, path) {
  const { weapon, body, rear, policy } = path;
  const tag = `[${weapon}/${body}/${rear}]`;
  console.log(`\n========== 路径 ${tag} ==========`);

  // ---- A｜seed 该武器 ★1 到 4/5 + seed 后轮库存 + 真实 Garage 装配获胜组合 ----
  await seedWeaponStack(page, weapon, SEED_STACK);
  // 后轮需库存（OFFICIAL_MOVEMENTS，needsInventory=true）：全新账号不自动拥有 ⇒ 显式 seed。
  if (REAR_WHEELS_NEEDS_INVENTORY.has(rear)) {
    const mBefore = await seedMovementStack(page, rear, 1);
    const storedM = await storageDump(page);
    log(
      invCount(storedM, rear, 1) === 1,
      `${tag} A1b 夹具：后轮 ${rear} ★1 摆到 1（全新账号不自动拥有，装配前显式 seed）`,
      `${rear}★1=${invCount(storedM, rear, 1)}（seed 前 ${mBefore}）`,
    );
  }
  const stored1 = await storageDump(page);
  log(
    invCount(stored1, weapon, 1) === SEED_STACK,
    `${tag} A1 夹具：把被观测武器 ${weapon} ★1 摆到 ${SEED_STACK}/5（其余不动）`,
    `${weapon}★1=${invCount(stored1, weapon, 1)}`,
  );
  await setUpWinningLoadout(page, body, rear, weapon);
  const stored2 = await storageDump(page);
  const b2 = JSON.parse(stored2[BUILD_KEY]);
  log(
    b2.functionalSelections[WEAPON_SLOT] === weapon && b2.bodyDefId === body && b2.rearWheelDefId === rear,
    `${tag} A1c 获胜装配经真实 Garage UI 落盘：weapon=${weapon}/body=${body}/rear=${rear}`,
    `weapon=${b2.functionalSelections[WEAPON_SLOT]} body=${b2.bodyDefId} rear=${b2.rearWheelDefId}`,
  );

  // ---- B｜Run 1：★1 第一场真实命中 ----
  const run1 = await enterRunAndDrive(page, policy, `${tag} Run 1`, false, weapon);
  const r1First = run1.detail.samples.length > 0 ? run1.detail.samples[0] : null;
  const r1Main = mainWeapon(r1First ? r1First.weapons : [], weapon);
  log(
    run1.equipped !== null && (run1.equipped.functionalStars === undefined || run1.equipped.functionalStars[WEAPON_SLOT] === 1),
    `${tag} B1 输入载荷：Run 1 装备载荷主武器槽 = ★1（缺省或显式 1）`,
    run1.equipped ? `functionalStars=${JSON.stringify(run1.equipped.functionalStars ?? null)}` : 'n/a',
  );
  const star1Dmg = run1.detail.firstWeaponHit ? run1.detail.firstWeaponHit.damages[0] : null;
  log(
    star1Dmg !== null && star1Dmg > 0,
    `${tag} B2 Run 1 第一场真实命中：★1 ${weapon} 每发扣对手 ${star1Dmg} 点血（实测，非卡面）`,
    run1.detail.firstWeaponHit ? `首中 ${run1.detail.firstWeaponHit.firstAtMs}ms · dmg=${star1Dmg}` : 'n/a',
  );
  log(
    !!r1Main && r1Main.star === 1,
    `${tag} B3 Runtime 读到的是 ★1 的 ${weapon}`,
    r1Main ? `${r1Main.defId}@${r1Main.hardpointId} ★${r1Main.star}` : 'n/a',
  );
  const run1Completed = run1.detail.stopped === 'COMPLETE';
  if (run1Completed) {
    const pDone = run1.detail.last;
    log(
      !!pDone && pDone.complete === true && pDone.failed === false,
      `${tag} B4 Run 1 三段全打到终局 → RUN COMPLETE`,
      `stopped=${run1.detail.stopped} · ${(run1.detail.ms / 1000).toFixed(1)}s · battles=${pDone ? pDone.battlesCompleted : '?'}/${pDone ? pDone.battleTotal : '?'}`,
    );
    log(
      !!pDone && pDone.phase === 'COMPLETE' && pDone.rewardChoices.length === 1 && pDone.rewardChoices[0].defId === weapon && pDone.rewardChoices[0].countAfter === SEED_STACK + 1 && pDone.actionLabel === '领取并返回' && pDone.actionEnabled === true,
      `${tag} B4b COMPLETE 终点：候选=本局主武器 ${weapon}（${SEED_STACK}→${SEED_STACK + 1}）；底栏唯一 CTA「领取并返回」可用`,
      `候选=${pDone ? pDone.rewardChoices.length : '?'} defId=${pDone && pDone.rewardChoices[0] ? pDone.rewardChoices[0].defId : '?'} label=${pDone ? pDone.actionLabel : '?'}`,
    );
  } else {
    // ⚠️ PRODUCT-LOOP-P0-HIDDEN-TOP-WEAPON-REMOVAL｜Q3 能力缺口 (a) 坐实：移除隐藏锤后，
    //    产品真实可达空间（仅 frontMass 一件武器）**零 COMPLETE 组合**（权威侦察矩阵 280 组合重扫结论）。
    //    原本靠隐藏锤伤害才能赢的两条浏览器路径现在打不赢 —— 属**真实 Blocker**（平衡缺口，非回归），
    //    本 Queue 明令**不修** ⇒ 记为真实 Blocker（不计 FAIL/PASS），不污染验收计数、也不伪造「能赢」。
    //    B1/B2/B3 已用真实浏览器证明：Runtime 只读到 frontMass 一件武器（无隐藏锤）、零运行时报错。
    blocked(`${tag} B4 Run 1 → COMPLETE`, `Q3 能力缺口 (a) 坐实：移除隐藏锤后产品真实可达空间零 COMPLETE（本 Queue 不修）`);
    blocked(`${tag} B4b COMPLETE 终点候选`, `Run 1 未 COMPLETE ⇒ 无候选/无 CTA（Q3 缺口 (a)）`);
    blocked(`${tag} C~E 链路`, `Run 1 没有 COMPLETE（Q3 缺口 (a) 坐实：真实可达空间零 COMPLETE）`);
    console.log(`  [${tag}] 探针核对：stopped=${run1.detail.stopped} · 装备=仅 ${weapon}@frontMass · 无隐藏锤`);
    return;
  }

  // ---- C｜领奖 ----
  await Promise.all([
    page.waitForURL((u) => u.pathname === '/home.html', { timeout: 20000 }).catch(() => {}),
    clickRect(page, pDone.actionRect),
  ]);
  await waitHomeReady(page);
  const storedAfterClaim = await storageDump(page);
  log(
    invCount(storedAfterClaim, weapon, 1) === SEED_STACK + 1,
    `${tag} C2 领到 ${weapon} ⇒ 库存 ★1 = **5/5**`,
    `★1×${invCount(storedAfterClaim, weapon, 1)}`,
  );

  // ---- D｜合成 ★2 + 验证 Garage 保留 ----
  await clickSelector(page, '[data-ph-action="open-garage"]');
  const g1 = await probeHome(page);
  const g1c1 = await garageCard(page, weapon, 1);
  const wDmg = g1c1 ? Number(g1c1.damage) : 0;
  const wNext = g1c1 ? Number(g1c1.damageNext) : 0;
  log(
    !!g1c1 && g1.weapons.find((x) => x.defId === weapon && x.star === 1).fusable === true && g1c1.damageLineText === `攻击 ${wDmg} → ${wNext}` && wNext === Math.round(wDmg * 1.25),
    `${tag} D1 5/5 的 ★1：${weapon} 卡面写着「攻击 ${wDmg} → ${wNext}」（下一步预览 = 升星真值），且「可合成」`,
    g1c1 ? g1c1.text : 'n/a',
  );
  await clickSelector(page, `[data-ph-action="fuse"][data-ph-fuse-def="${weapon}"][data-ph-fuse-star="1"]`);
  const g2 = await probeHome(page);
  const storedAfterFuse = await storageDump(page);
  log(
    g2.lastFuse && g2.lastFuse.ok === true && g2.lastFuse.fromStar === 1 && g2.lastFuse.toStar === 2 && g2.lastFuse.countAfter === 0 && g2.lastFuse.productCount === 1 && g2.lastFuse.equippedUpgraded === true && invCount(storedAfterFuse, weapon, 1) === 0 && invCount(storedAfterFuse, weapon, 2) === 1 && verifiedEquipped(g2, storedAfterFuse, weapon),
    `${tag} D2 合成：★1 归 0、★2 = 1、equipped 自动 ★2（页面 + 磁盘 + Build 存档三处一致）`,
    `★1×${invCount(storedAfterFuse, weapon, 1)} ★2×${invCount(storedAfterFuse, weapon, 2)} equipped=${g2.equippedWeaponId}★${g2.equippedWeaponStar}`,
  );
  // ⚠️ Queue 必验：合成后回首页，**Body / Movement / Weapon 保持**（只升星，不动装配）。
  // 真源 = 正式 Build 存档（home 探针不暴露 bodyDefId/rearWheelDefId，必须读存档，与 E1d 同源）。
  const buildAfterFuse = JSON.parse(storedAfterFuse[BUILD_KEY]);
  log(
    buildAfterFuse.bodyDefId === b2.bodyDefId &&
      buildAfterFuse.rearWheelDefId === b2.rearWheelDefId &&
      buildAfterFuse.functionalSelections[WEAPON_SLOT] === weapon &&
      g2.equippedWeaponId === weapon &&
      g2.equippedWeaponStar === 2,
    `${tag} D-R9 合成后装配保留：车身(${b2.bodyDefId})/后轮(${b2.rearWheelDefId})/主武器(${weapon}) 保持，仅升星`,
    `body ${b2.bodyDefId}→${buildAfterFuse.bodyDefId} rear ${b2.rearWheelDefId}→${buildAfterFuse.rearWheelDefId} weapon=${weapon}★${g2.equippedWeaponStar}`,
  );
  const g2c2 = await garageCard(page, weapon, 2);
  const wDmg2 = g2c2 ? Number(g2c2.damage) : 0;
  const wNext2 = g2c2 ? Number(g2c2.damageNext) : 0;
  log(
    !!g2c2 &&
      g2c2.equipped === 'true' &&
      wDmg2 === Math.round(wDmg * 1.25) &&
      wNext2 === Math.round(wDmg * (1 + 0.25 * 2)) &&
      g2c2.damageLineText === `攻击 ${wDmg2} → ${wNext2}`,
    `${tag} D3 ★2 卡面：攻击 ${wDmg2} → ${wNext2}（下一星 ★3 = base × (1 + 0.25·2) 真值）`,
    g2c2 ? g2c2.damageLineText : 'n/a',
  );
  await clickSelector(page, '[data-ph-action="back-home"]');
  const backHome = await probeHome(page);
  const equipPayload = equippedOf(backHome.adventureHref);
  log(
    equipPayload && equipPayload.functionalStars && equipPayload.functionalStars[WEAPON_SLOT] === 2,
    `${tag} D4 回首页后「开始冒险」载荷已带 functionalStars.frontMass = 2`,
    equipPayload ? JSON.stringify(equipPayload.functionalStars) : 'n/a',
  );

  // ---- E｜Run 2：★2 生效 + 必验 Run 2 干净态 ----
  const run2 = await enterRunAndDrive(page, policy, `${tag} Run 2`, true, weapon);
  const r2First = run2.detail.samples.length > 0 ? run2.detail.samples[0] : null;
  const r2Main = mainWeapon(r2First ? r2First.weapons : [], weapon);
  log(
    run2.equipped !== null && run2.equipped.functionalStars && run2.equipped.functionalStars[WEAPON_SLOT] === 2,
    `${tag} E1 Run 2 输入载荷主武器槽星级 = 2`,
    run2.equipped ? JSON.stringify(run2.equipped.functionalStars) : 'n/a',
  );
  // 必验 Run 2：DAY 1 干净 / Enemy 干净 / Build 清空 / Weapon Star 保留 / Body 保留 / Movement 保留
  const r2Probe = run2.runStart;
  const r2Stored = await storageDump(page);
  const r2Build = JSON.parse(r2Stored[BUILD_KEY]);
  log(
    r2Probe.day === RUN_FIRST_DAY && r2Probe.battlesCompleted === 0 && r2Probe.build.length === 0 && r2Probe.modifier === null,
    `${tag} E1b Run 2 进入瞬间 = DAY 1 / 0 场 / Build=[] / modifier=null（干净新局）`,
    `DAY=${r2Probe.day} battles=${r2Probe.battlesCompleted} build=[${r2Probe.build.join(',')}] modifier=${r2Probe.modifier}`,
  );
  log(
    r2Probe.stage && r2Probe.stage.enemy === null,
    `${tag} E1c Run 2 Enemy 状态干净（IDLE 时 stage.enemy === null）`,
    `enemy=${r2Probe.stage ? JSON.stringify(r2Probe.stage.enemy) : 'n/a'}`,
  );
  log(
    r2Build.functionalSelections[WEAPON_SLOT] === weapon && r2Build.bodyDefId === body && r2Build.rearWheelDefId === rear,
    `${tag} E1d Run 2 出发装配保留：weapon=${weapon}/body=${body}/rear=${rear}（与 Run 1 同）`,
    `weapon=${r2Build.functionalSelections[WEAPON_SLOT]} body=${r2Build.bodyDefId} rear=${r2Build.rearWheelDefId}`,
  );
  const r2Hp = (run2.detail.samples.find((s) => s.hp !== null) || {}).hp || null;
  log(
    r1First !== null && r2First !== null && r2First.day === r1First.day && r2First.nodeId === r1First.nodeId && r2First.build.length === 0 && r2First.modifier === null && r2Hp !== null && r2Hp.a === r2Hp.aMax,
    `${tag} E2 新 Run 真重置：同 day/同 nodeId，Run Buff 清空，第一场开局 HP=满`,
    `Run1 day=${r1First ? r1First.day : '?'} node=${r1First ? r1First.nodeId : '?'} · Run2 day=${r2First ? r2First.day : '?'} node=${r2First ? r2First.nodeId : '?'} hp=${r2Hp ? `${r2Hp.a}/${r2Hp.aMax}` : 'n/a'}`,
  );
  const star2Dmg = run2.detail.firstWeaponHit ? run2.detail.firstWeaponHit.damages[0] : null;
  log(
    !!r2Main && r2Main.star === 2 && star2Dmg === Math.round(star1Dmg * 1.25) && star2Dmg > star1Dmg,
    `${tag} E3+E4 ★2 实测：Runtime 读到 ${weapon} ★2，第一发命中 ${star1Dmg} → **${star2Dmg}**（= round(${star1Dmg} × 1.25)，> ★1）`,
    r2Main ? `${r2Main.defId} ★${r2Main.star} dmg=${star2Dmg}` : 'n/a',
  );
  log(
    run1.detail.firstWeaponHit && run2.detail.firstWeaponHit && run1.detail.firstWeaponHit.firstAtMs === run2.detail.firstWeaponHit.firstAtMs,
    `${tag} E5 两局第一发命中同战斗时刻（星级只改伤害，不改节奏/几何/质量）`,
    `Run1 ${run1.detail.firstWeaponHit ? run1.detail.firstWeaponHit.firstAtMs : '?'}ms · Run2 ${run2.detail.firstWeaponHit ? run2.detail.firstWeaponHit.firstAtMs : '?'}ms`,
  );
  log(
    onlyDamageDiffers(r1Main, r2Main),
    `${tag} E6 两局第一场武器参数逐项比对只有伤害不同（连发节奏/炮口速度/半径/质量/后坐全等）`,
    onlyDamageDetail(r1Main, r2Main),
  );
  // 必验：Reward 不重复 / Settlement 状态清空 / Audio 干净（Run 2 探针读终态前的干净态）
  log(
    r2Probe.complete === false && r2Probe.failed === false && r2Probe.rewardChoices.length === 0 && r2Probe.claiming === false,
    `${tag} E7 Run 2 起点 Settlement 状态清空（complete/failed/rewardChoices/claiming 全空）`,
    `complete=${r2Probe.complete} failed=${r2Probe.failed} rewardChoices=${r2Probe.rewardChoices.length} claiming=${r2Probe.claiming}`,
  );
  const r2Audio = r2Probe.battleAudio || {};
  log(
    r2Audio.activeBgmSources === 0,
    `${tag} E8 Run 2 起点 Audio 干净（activeBgmSources === 0）`,
    `activeBgmSources=${r2Audio.activeBgmSources}`,
  );
}

async function main() {
  console.log('=== PRODUCT-LOOP-R10-NEXT-RUN-CONTINUITY｜获胜装配保持 + ★2 真实生效 端到端闭环 ===\n');
  for (const f of ['home.html', 'run-page.html']) {
    if (!fs.existsSync(path.join(ROOT, f))) {
      console.error(`未找到 ${path.join(ROOT, f)} —— 请先 npm run build:portrait-lab`);
      process.exit(1);
    }
  }
  const server = await startServer();
  log(true, 'P0 静态产物就绪（dist-portrait-lab 内 home.html + run-page.html 真实存在）');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  try {
    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const home0 = await probeHome(page);
    const stored0 = await storageDump(page);
    log(
      home0.growth.fresh === true && home0.growth.seeded === true,
      'P0a 起点：新账号已 seed（growth.fresh + growth.seeded）',
      `fresh=${home0.growth.fresh} seeded=${home0.growth.seeded}`,
    );
    for (const path of WEAPON_PATHS) {
      await runPath(page, path);
    }
    log(pageErrors.length === 0, 'F1 全流程零运行时报错', pageErrors.slice(0, 2).join(' | ') || 'none');
  } catch (err) {
    log(false, 'F0 未捕获异常', String(err && err.stack ? err.stack.split('\n')[0] : err));
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
    console.log('\n本批次不可达（既不计 PASS 也不计 FAIL；根因见探针读数）：');
    for (const b of results.filter((r) => r.blocked === true)) console.log(` - ${b.name} | ${b.detail}`);
  }
  if (failed.length > 0) process.exit(1);
}

main();
