/**
 * PRODUCT-LOOP-R2-C-STAR-POWER-END-TO-END｜
 * 「星级不是 Garage 里的数字，而是真的改变下一局战斗」的**浏览器真实闭环 smoke**。
 *
 * 一条链走完（Queue 核心目标）：
 *   fresh profile（cannon ★1 ×4）
 *     → Run 1：打真一局（第一场真实战斗，实测炮的第一发命中 = 120）
 *     → COMPLETE → 领 cannon（本 Queue 起候选只有它一件）→ 库存 5/5
 *     → Garage 合成 → ★1 ×0 / ★2 ×1 / equipped 自动 ★2
 *     → Run 2：新一局（Day / HP / Run Buff 全部重置）
 *     → 第一场真实战斗真的用 ★2 炮：实测第一发命中 = 150（= round(120 × 1.25)）
 *
 * ⚠️ PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY 两处口径变更（本文件的数字随之重测）：
 *   ① 必改 2：终点候选从「三选一」收窄为**固定 cannon 一件**（`REWARD_CHOICE_IDS = ['cannon']`）；
 *   ② 必改 3（用户裁决）：本局 Run 的**玩家侧**炮基线 = `PRODUCT_RUN_CANNON_BASE_DAMAGE = 120`
 *      ⇒ 战斗内实测 ★1 = 120 / ★2 = 150。正式 `cannon` 仍是 80（敌方 RangedTurret /
 *      Validation / 旧横屏全部不受影响，`src/core/content.ts` 零改动）。
 *      ⚠️ 本文件因此同时存在**两套**伤害读数，刻意不合并（它们是不同层的读数）：
 *        · **卡面文本**（A2 / D1 / D3）= 正式曲线 `80 → 100 → 120`（PR-27：产品侧只读 core，不自算）；
 *        · **战斗内实测**（B2 / B3 / E3 / E4）= 本局口径 `120 → 150`。
 *
 * 手段（与 `_e2e_product_reward.cjs` 同一纪律，全部是真实行为取证）：
 *   - 真实浏览器（playwright-core / msedge）+ 独立产物 `dist-portrait-lab/`；
 *   - **真实鼠标点击**（`page.mouse.click`；Run 页按画布真实 CSS 矩形做逻辑→屏幕换算）；
 *   - **真实整页导航**（`<a href>` 由浏览器执行，不做 evaluate 跳转）；
 *   - **真实 localStorage 读取**（库存 / 正式 Build 存档都绕过页面探针独立对账）；
 *   - 只读诊断句柄 `window.__PRODUCTHOME__` / `window.__RUNPAGE__`。
 *
 * ⚠️ 本文件**只**为了这一件事而存在，不重复 reward / loop / fail 三条 E2E 的既有覆盖：
 *    奖励怎么发、数量怎么累积、失败怎么结算 —— 都在那三条里（本文件跑它们只为拼出链条）。
 * ⚠️ 战斗伤害是**实测**的：`battleWorld.playerWeaponHits` 来自正式 `damage` 事件里
 *    DamageResolver 真的从对手 HP 减掉的那个数，**不是**读卡面文字、不是读定义、不是自算。
 *
 * 用法：
 *   npm run build:portrait-lab
 *   node tests/_e2e_product_star_power.cjs   （或 npm run e2e:product-star-power）
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

/**
 * 终点候选（与 `runReward.REWARD_CHOICE_IDS` 同值）。
 *
 * ⚠️ PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY（必改 2）：从 `['cannon','spear','hammer']`
 *    **收窄为 `['cannon']`** —— 当前只有它同时具备完整 Run compatibility / 已验证 Run Buff /
 *    永久 Star 成长链（`FULL_RUN_SUPPORTED_WEAPON_IDS = ['cannon']`），
 *    发 spear 等于奖励玩家「这一局用不上的东西」（真人反馈 ③）。
 *    ⇒ C1 的 `rects.length === CHOICE_IDS.length` 与 `pickIndex` 都随之自动落到 1 张卡 / 下标 0，
 *      无需另写一份长度常量（候选池只有一个真源：这里）。
 */
const CHOICE_IDS = ['cannon'];
/** 满 stack 阈值（与 `playerGrowth.FUSE_STACK` 同值）。 */
const FUSE_STACK = 5;
/** 两个正式存档 key（独立取证，不经过页面探针）。 */
const BUILD_KEY = 'strongfruit.playerBuild.v1';
const INV_KEY = 'strongfruit.ownedParts.v2';
/** 唯一打通的主武器槽。 */
const WEAPON_SLOT = 'frontMass';
/**
 * **正式** cannon 的基准伤害（`core/content.ts` 的 `projectileDamage: 80`）。
 * ⚠️ 这是正式内容值，本 Queue **一字节未改**（`git diff --exit-code -- src/core/content.ts` 为空）。
 *    产品首页 / Garage 卡面读的就是它（PR-27：产品侧不许自算星级伤害，只许读 core）。
 */
const CANNON_BASE_DAMAGE = 80;
/** ★2 的**正式**理论伤害 = round(80 × 1.25)（同上；A2 / D1 / D3 的卡面文本用它）。 */
const CANNON_STAR2_DAMAGE = 100;

/**
 * PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY（必改 3，按用户裁决）｜
 * **本局 Run 内玩家侧**的炮基线伤害（= `runModifiers.PRODUCT_RUN_CANNON_BASE_DAMAGE`）。
 *
 * 作用顺序：正式 Cannon Def（80）→ **本局玩家基线 overlay（120）** → 永久 Star 乘子 → Run Modifier。
 * ⚠️ 它**不是**正式内容：正式 `cannon` 键（敌方 `RangedTurret` / Validation / 旧横屏）
 *    在任何情况下都恒为 80；本常量只承载「本局玩家那一件」的 overlay 值。
 * ⇒ 因此 B2 / B3 / E3 / E4 的**战斗内实测**用下面这两个，
 *    而 A2 / D1 / D3 的**卡面文本**仍用上面的正式 80 / 100 —— 两层读数刻意分开。
 */
const RUN_CANNON_BASE_DAMAGE = 120;
/** ★2 的**本局实测**伤害 = round(120 × 1.25) = 150。 */
const RUN_CANNON_STAR2_DAMAGE = 150;

/** 赢：耐久事件选「维修」→ 终局有耐久 → COMPLETE（与 reward E2E 同一条确定性路线）。 */
const WIN_POLICY = { layer1: 'twinCannon', lateral: null, layer2: 'tripleLoad', durability: 'repair' };
const DRIVE_BUDGET_MS = 240000;

/**
 * 产品**新一局的起点是第 1 天**（Queue 必改 5 STEP 6 逐字要求「必须确认 DAY = 1」）。
 *
 * ⚠️ 这里独立写一份字面量，**不** import `src/lab/portraitBattleLab/runScript.ts` 的
 *    `RUN_FIRST_DAY`：E2E 是黑盒验收，引用被测方的常量就等于用被告的证词证明被告清白。
 *    两侧同值由各自的断言分别钉住（单测 `portraitRunPage` RP-06 断 `RUN_FIRST_DAY === 1`）。
 */
const RUN_FIRST_DAY = 1;

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

async function clickSelector(page, sel) {
  const box = await page.locator(sel).first().boundingBox();
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

/**
 * 从真实 storage dump 里读某个 `(defId, star)` stack 的副本数。
 * ⚠️ 星级 → 字段名的映射在这里**独立写一份**（不 import 被测模块的映射：
 *    引用被告的证词就证明不了「磁盘上真的是那样」）。
 */
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

/** 从**正式 Build 存档**里读武器槽的星级（键缺省 ⇒ ★1，与 `buildEditorModel` 的约定一致）。 */
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

/** 从出发链接里取产品侧交给 Run 的那份装备（URL 编码后的 BuildDraft）。 */
function equippedOf(href) {
  const raw = new URLSearchParams(href.split('?')[1] ?? '').get('equipped') ?? '';
  return raw ? JSON.parse(raw) : null;
}

/** 读 Garage 里某张 Weapon 卡的真实 DOM 读数（含 R2-C 的 damage 三个 data-*）。 */
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
        damageText: n.getAttribute('data-ph-damage-text'),
        /** 卡面上那一行的**真实文本**（`null` = 那一行根本没画） */
        damageLineText: dmgLine ? dmgLine.textContent : null,
        cards: all.length,
      };
    },
    { id: defId, s: star },
  );
}

/* ------------------------------------------------------------------ Run 驱动 */

/**
 * 把一局 Run 驱到终态（或「已经看到第一发主炮命中」），**同时**采集战斗侧的真实读数。
 *
 * 采集口径：每一帧都把 `battleWorld` 里的玩家武器读数 / 真实命中记录**照抄一份**存档 ——
 * 因为战斗运行时在离开 battle 相位时会被释放（`endBattle()`），落到终态再去读就晚了。
 *
 * @param stopOnFirstCannonHit true ⇒ 采到第一发主炮命中就停（Run 2 只需要第一场）
 */
async function driveRun(page, policy, label, stopOnFirstCannonHit = false) {
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
      if (stopOnFirstCannonHit && hits.cannon && hits.cannon.count >= 1) {
        stopped = 'cannon-hit';
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

  const withCannon = samples.filter((s) => s.hits.cannon);
  return {
    label,
    stopped,
    ms: Date.now() - t0,
    seen,
    samples,
    last,
    /** 玩家车上的武器读数（最后一份） */
    weapons: samples.length > 0 ? samples[samples.length - 1].weapons : [],
    /** 采到过的**第一发主炮命中**（最早那一次采样里 cannon 的那条） */
    firstCannonHit: withCannon.length > 0 ? withCannon[0].hits.cannon : null,
    /** 采样里 cannon 命中次数最多的那一条（= 那一场的完整命中记录） */
    fullestCannonHits:
      withCannon.length > 0
        ? withCannon.reduce((a, b) => (b.hits.cannon.count > a.hits.cannon.count ? b : a)).hits.cannon
        : null,
    /** 第一份 battleWorld 采样（用于读「本场开局」的客观事实） */
    firstBattleSample: samples.length > 0 ? samples[0] : null,
  };
}

/** 从首页出发 → 进 Run → 驱动到指定状态。 */
async function enterRunAndDrive(page, policy, label, stopOnFirstCannonHit) {
  const homeBefore = await probeHome(page);
  const equipped = equippedOf(homeBefore.adventureHref);
  await Promise.all([
    page.waitForURL(/run-page\.html/, { timeout: 20000 }).catch(() => {}),
    clickSelector(page, '[data-ph-action="start-run"]'),
  ]);
  await waitRunReady(page);
  const runStart = await probeRun(page);
  const detail = await driveRun(page, policy, label, stopOnFirstCannonHit);
  return { homeBefore, equipped, runStart, detail };
}

/** 单场玩家武器读数里挑出主武器那件。 */
function mainWeapon(weapons, defId = 'cannon') {
  return weapons.find((w) => w.defId === defId && w.hardpointId === WEAPON_SLOT) ?? null;
}

async function main() {
  console.log('=== PRODUCT-LOOP-R2-C｜星级 → 真实战斗伤害 端到端闭环 smoke ===\n');

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
    /* ==================================================================================
       A｜起点：新账号 = cannon ★1 ×4，且卡面**在合成前**就告诉玩家升星会得到什么
       ================================================================================== */
    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const home0 = await probeHome(page);
    const stored0 = await storageDump(page);
    log(
      home0.growth.fresh === true &&
        home0.growth.seeded === true &&
        invCount(stored0, 'cannon', 1) === 4 &&
        home0.equippedWeaponId === 'cannon' &&
        home0.equippedWeaponStar === 1,
      'A1 起点（Queue「fresh profile → cannon ★1 ×4」）：库存 ★1 = 4，且主武器槽装的正是 ★1 的炮',
      `★1×${invCount(stored0, 'cannon', 1)} · equipped=${home0.equippedWeaponId} ★${home0.equippedWeaponStar}`,
    );

    /* ---- 打开「调整战车」读**真实 DOM 卡面**（Weapon 卡只画在车库视图里） ---- */
    await clickSelector(page, '[data-ph-action="open-garage"]');
    const c0card = await garageCard(page, 'cannon', 1);
    log(
      !!c0card &&
        c0card.star === '1' &&
        c0card.count === '4' &&
        c0card.damage === String(CANNON_BASE_DAMAGE) &&
        c0card.damageNext === String(CANNON_STAR2_DAMAGE) &&
        c0card.damageText === `攻击 ${CANNON_BASE_DAMAGE} → ${CANNON_STAR2_DAMAGE}` &&
        c0card.damageLineText === `攻击 ${CANNON_BASE_DAMAGE} → ${CANNON_STAR2_DAMAGE}`,
      'A2 **Queue 必改 4**：Weapon 卡上**真的画出**了最终主属性那一行「攻击 80 → 100」' +
        '（真实 DOM 文本，不是探针自述；此时还差一件没凑齐，玩家已经知道升星值多少）',
      c0card ? `行文本="${c0card.damageLineText}" data=${c0card.damage}/${c0card.damageNext}` : 'n/a',
    );
    await clickSelector(page, '[data-ph-action="back-home"]');

    /* ==================================================================================
       B｜Run 1：★1 炮的第一场**真实**战斗（本局口径：实测第一发命中 = 120）
       ================================================================================== */
    const run1 = await enterRunAndDrive(page, WIN_POLICY, 'Run 1', false);
    const r1First = run1.detail.samples.length > 0 ? run1.detail.samples[0] : null;
    const r1Main = mainWeapon(r1First ? r1First.weapons : []);
    log(
      run1.equipped !== null &&
        run1.equipped.functionalStars === undefined,
      'B1 **Profile Equipped Star**（输入）：产品侧交给 Run 的装备载荷里**没有** `functionalStars` 键 —— ' +
        '这正是既有约定（★1 = 缺省，`buildEditorModel` 的 ★1 不写字段），因此这一局的输入就是 ★1',
      run1.equipped ? `functionalStars=${JSON.stringify(run1.equipped.functionalStars ?? null)}` : 'n/a',
    );
    log(
      run1.detail.firstCannonHit !== null &&
        run1.detail.firstCannonHit.damages[0] === RUN_CANNON_BASE_DAMAGE,
      'B2 Run 1 第一场真实命中：★1 炮扣对手 **120** 点血（本局玩家侧基线 ' +
        '`PRODUCT_RUN_CANNON_BASE_DAMAGE = 120`；正式 `cannon` 仍是 80）',
      run1.detail.firstCannonHit
        ? `首中 ${run1.detail.firstCannonHit.firstAtMs}ms · damages=[${run1.detail.firstCannonHit.damages.join(',')}]`
        : 'n/a',
    );
    log(
      !!r1Main && r1Main.star === 1 && r1Main.damage === RUN_CANNON_BASE_DAMAGE,
      'B3 **Battle Runtime Weapon Star**（真实装配）：运行时读到的炮是 ★1、伤害 120（本局口径）',
      r1Main ? `${r1Main.defId}@${r1Main.hardpointId} ★${r1Main.star} damage=${r1Main.damage}` : 'n/a',
    );
    log(
      run1.detail.stopped === 'COMPLETE',
      'B4 Run 1 打到 COMPLETE（★1 的确定性通关路线，与 reward E2E 基线一致）',
      `stopped=${run1.detail.stopped} · ${(run1.detail.ms / 1000).toFixed(1)}s`,
    );

    /* ==================================================================================
       C｜领奖：点 cannon 那张卡（必改 2 起候选只有它一件）→ 库存 5/5
       ================================================================================== */
    const pDone = run1.detail.last;
    const pickIndex = CHOICE_IDS.indexOf('cannon');
    const cardRect = pDone.rewardChoiceRects[pickIndex];
    log(
      pDone.phase === 'COMPLETE' && pDone.rewardChoiceRects.length === CHOICE_IDS.length,
      'C1 COMPLETE 上真的画出了候选卡（与绘制同源的矩形；条数 = 产品候选池长度）',
      `phase=${pDone.phase} rects=${pDone.rewardChoiceRects.length}`,
    );
    await Promise.all([
      page.waitForURL(/home\.html/, { timeout: 20000 }).catch(() => {}),
      clickRect(page, cardRect),
    ]);
    await waitHomeReady(page);
    const storedAfterClaim = await storageDump(page);
    log(
      invCount(storedAfterClaim, 'cannon', 1) === 5,
      'C2 领到 cannon ⇒ 库存 ★1 = **5/5**（真实鼠标点击候选卡 + 真实整页导航回来）',
      `★1×${invCount(storedAfterClaim, 'cannon', 1)}`,
    );

    /* ==================================================================================
       D｜Garage：合成 5×★1 → 1×★2，装备自动升星；卡面换成 ★2 的下一星预览
       ================================================================================== */
    await clickSelector(page, '[data-ph-action="open-garage"]');
    const g1 = await probeHome(page);
    const g1c1 = await garageCard(page, 'cannon', 1);
    log(
      g1.weapons.find((w) => w.defId === 'cannon' && w.star === 1).fusable === true &&
        g1c1.text.includes('可合成') &&
        g1c1.damageLineText === `攻击 ${CANNON_BASE_DAMAGE} → ${CANNON_STAR2_DAMAGE}`,
      'D1 5/5 的 ★1 炮：卡上同时写着「可合成」与「攻击 80 → 100」（按下合成前就知道结果）',
      g1c1.text,
    );

    await clickSelector(page, `[data-ph-action="fuse"][data-ph-fuse-def="cannon"][data-ph-fuse-star="1"]`);
    const g2 = await probeHome(page);
    const storedAfterFuse = await storageDump(page);
    log(
      g2.lastFuse &&
        g2.lastFuse.ok === true &&
        g2.lastFuse.fromStar === 1 &&
        g2.lastFuse.toStar === 2 &&
        g2.lastFuse.countAfter === 0 &&
        g2.lastFuse.productCount === 1 &&
        g2.lastFuse.equippedUpgraded === true &&
        invCount(storedAfterFuse, 'cannon', 1) === 0 &&
        invCount(storedAfterFuse, 'cannon', 2) === 1 &&
        verifiedEquipped(g2, storedAfterFuse),
      'D2 合成一次：★1 归 0、★2 = 1、**equipped 自动升到 ★2**（页面读数 + 磁盘库存 + 正式 Build 存档三处一致）',
      `★1×${invCount(storedAfterFuse, 'cannon', 1)} ★2×${invCount(storedAfterFuse, 'cannon', 2)} ` +
        `equipped=${g2.equippedWeaponId}★${g2.equippedWeaponStar} 存档★${storedWeaponStar(storedAfterFuse)}`,
    );

    const g2c2 = await garageCard(page, 'cannon', 2);
    log(
      !!g2c2 &&
        g2c2.equipped === 'true' &&
        g2c2.damage === String(CANNON_STAR2_DAMAGE) &&
        g2c2.damageNext === '120' &&
        g2c2.damageLineText === '攻击 100 → 120',
      'D3 ★2 卡面：现在写着「攻击 100 → 120」（下一星 = ★3 的真实值 120）—— 升星不是数字，是一个可预期的下一站',
      g2c2 ? g2c2.damageLineText : 'n/a',
    );

    await clickSelector(page, '[data-ph-action="back-home"]');
    const backHome = await probeHome(page);
    const equipPayload = equippedOf(backHome.adventureHref);
    log(
      equipPayload &&
        equipPayload.functionalStars &&
        equipPayload.functionalStars[WEAPON_SLOT] === 2,
      'D4 回首页后「开始冒险」地址里的装备载荷已经是 **functionalStars.frontMass = 2**（下一局一定带 ★2 出发）',
      equipPayload ? JSON.stringify(equipPayload.functionalStars) : 'n/a',
    );

    /* ==================================================================================
       E｜Run 2：新一局真的用 ★2 炮，且实测伤害 = 150 > 120
       ================================================================================== */
    const run2 = await enterRunAndDrive(page, WIN_POLICY, 'Run 2', true);
    const r2First = run2.detail.samples.length > 0 ? run2.detail.samples[0] : null;
    const r2Main = mainWeapon(r2First ? r2First.weapons : []);
    log(
      run2.equipped !== null &&
        run2.equipped.functionalStars &&
        run2.equipped.functionalStars[WEAPON_SLOT] === 2,
      'E1 **Profile Equipped Star**（输入）：Run 2 的装备载荷里主武器槽星级 = 2',
      run2.equipped ? JSON.stringify(run2.equipped.functionalStars) : 'n/a',
    );
    /*
      E1b｜Queue 必改 5 STEP 6 的**逐字**落地：「返回首页 → 开始第二局。必须确认 DAY = 1 /
      HP = 满 / Run Buff = []」。
      ⚠️ 判据必须取**进入 Run 的那一瞬间**的探针（`runStart`），不能用第一场战斗的采样：
         第一场战斗的节点是 `d2-battle1`（脚本里它的 `day` 字段 = 2），拿它当「新局起点」
         既证不出 DAY = 1、也读不到「还没打过任何一场」。
      ⚠️ 这里断的是**字面 1**，不是「两局相同」—— 后者只能证明「重置了」，证明不了
         「重置到的是第 1 天」（若脚本起点漂移到第 3 天，同 day 仍然成立）。
    */
    log(
      run2.runStart.day === RUN_FIRST_DAY &&
        run2.runStart.battlesCompleted === 0 &&
        run2.runStart.build.length === 0 &&
        run2.runStart.modifier === null,
      'E1b **Queue 必改 5 STEP 6**：第二局**进入的瞬间**就是 DAY = 1 / 一场都没打过 / Run Buff = [] ' +
        '（字面断 1，不是「与第一局相同」的代理判据）',
      `DAY=${run2.runStart.day} battles=${run2.runStart.battlesCompleted} ` +
        `build=[${run2.runStart.build.join(',')}] modifier=${run2.runStart.modifier}`,
    );
    /*
      E2｜「新 Run 真的重置了」的**第二层**证据（与 E1b 互补，两条各证一面）：
        · E1b 证「起点 = DAY 1 的干净状态」（进入瞬间）；
        · E2 证「第一场开局与第一局**逐帧同源**」—— 同 day / 同 nodeId（第一场 = `d2-battle1`
          ⇒ 这里的 day 是 **2**，正是上面提到的那个陷阱）、Run Buff 清空、第一场开局 HP = 满
          （上一局终局是带着战损的，若继续旧局就会是残血）。
    */
    const r2Hp =
      (run2.detail.samples.find((s) => s.hp !== null) || {}).hp || null;
    log(
      r1First !== null &&
        r2First !== null &&
        r2First.day === r1First.day &&
        r2First.nodeId === r1First.nodeId &&
        r2First.build.length === 0 &&
        r2First.modifier === null &&
        r2Hp !== null &&
        r2Hp.a === r2Hp.aMax,
      'E2 新 Run 真的重置了：从**与第一局相同的起点**重新开始（同 day / 同 nodeId），Run Buff 清空，第一场开局 HP = 满',
      `Run1 起点 day=${r1First ? r1First.day : '?'} node=${r1First ? r1First.nodeId : '?'} · ` +
        `Run2 起点 day=${r2First ? r2First.day : '?'} node=${r2First ? r2First.nodeId : '?'} ` +
        `build=[${r2First ? r2First.build.join(',') : '?'}] modifier=${r2First ? r2First.modifier : '?'} ` +
        `hp=${r2Hp ? `${r2Hp.a}/${r2Hp.aMax}` : 'n/a'}`,
    );
    log(
      !!r2Main && r2Main.star === 2 && r2Main.damage === RUN_CANNON_STAR2_DAMAGE,
      'E3 **Battle Runtime Weapon Star**：这一局运行时读到的炮是 **★2**、伤害 150（不是页面内存、不是存档副本）',
      r2Main ? `${r2Main.defId}@${r2Main.hardpointId} ★${r2Main.star} damage=${r2Main.damage}` : 'n/a',
    );
    log(
      run2.detail.firstCannonHit !== null &&
        run2.detail.firstCannonHit.damages[0] === RUN_CANNON_STAR2_DAMAGE &&
        run2.detail.firstCannonHit.damages[0] > RUN_CANNON_BASE_DAMAGE &&
        run2.detail.firstCannonHit.damages[0] ===
          Math.round(RUN_CANNON_BASE_DAMAGE * 1.25),
      'E4 **本 Queue 的核心结论（实测）**：同一门炮、只差星级，第一发真实命中 120 → **150**（= round(120 × 1.25)）—— 星级真的进了战斗',
      run2.detail.firstCannonHit
        ? `首中 ${run2.detail.firstCannonHit.firstAtMs}ms · damages=[${run2.detail.firstCannonHit.damages.join(',')}]`
        : 'n/a',
    );
    log(
      run1.detail.firstCannonHit &&
        run2.detail.firstCannonHit &&
        run1.detail.firstCannonHit.firstAtMs === run2.detail.firstCannonHit.firstAtMs,
      'E5「同条件」的机器证据：两局第一发命中发生在**同一战斗时刻**（在它之前两场物理逐帧相同 —— 星级只改了伤害，不改节奏 / 几何 / 质量）',
      `Run1 ${run1.detail.firstCannonHit ? run1.detail.firstCannonHit.firstAtMs : '?'}ms · Run2 ${run2.detail.firstCannonHit ? run2.detail.firstCannonHit.firstAtMs : '?'}ms`,
    );
    log(
      onlyDamageDiffers(r1Main, r2Main),
      'E6 **Queue 必改 1**：两局**第一场**（都还没有 Run-local 强化）的武器数值参数逐项比对，**只有伤害不同**（cd / 炮口速度 / 半径 / 质量 / 后坐全等）',
      onlyDamageDetail(r1Main, r2Main),
    );

    log(pageErrors.length === 0, 'F1 全流程零运行时报错', pageErrors.slice(0, 2).join(' | ') || 'none');
  } catch (err) {
    log(false, 'F0 未捕获异常', String(err && err.stack ? err.stack.split('\n')[0] : err));
    console.error(err);
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== 结果：${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length > 0) {
    console.log('失败项：');
    for (const f of failed) console.log(` - ${f.name} | ${f.detail}`);
    process.exit(1);
  }
}

/** D2 的「装备指向」三处一致判据。 */
function verifiedEquipped(probe, dump) {
  return (
    probe.equippedWeaponId === 'cannon' &&
    probe.equippedWeaponStar === 2 &&
    storedWeaponStar(dump) === 2
  );
}

/** E6：逐项比对两局的武器数值参数，只有伤害类不同。 */
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

main();
