/**
 * PRODUCT-LOOP-R2-A-REWARD-STACK-INVENTORY｜
 * 「打完一局 → **三选一** → 选中那件进入局外库存 → 数量累积 → 回车库看到」的**浏览器真实闭环 smoke**。
 *
 * 手段（与 `_e2e_product_home.cjs` 同一纪律，全部是真实行为取证）：
 *   - 真实浏览器（playwright-core / msedge），打开独立产物 `dist-portrait-lab/`；
 *   - **真实鼠标点击**（`page.mouse.click`，逻辑坐标 → 画布真实 CSS 矩形换算；不 evaluate 直调）；
 *   - **真实整页导航**（`<a href>` / `location.assign` 都由浏览器执行，不做 evaluate 跳转）；
 *   - **真实 localStorage 读取**（证明入库写进的是**正式存档 key**，而不是页面内存）；
 *   - **真实 `getImageData` 像素取证**（证明三张候选卡真的画在画布上，不是只有探针字段）；
 *   - 只读诊断句柄 `window.__PRODUCTHOME__` / `window.__RUNPAGE__`（只读，不能借它改状态）。
 *
 * 覆盖 R2-A 技术验收 1~8（第 9 条 = tsc / targeted / build 在门禁里跑）：
 *   ① fresh profile cannon = ★1 ×4      → A2 / A3
 *   ② COMPLETE 出现 3 个真实 Weapon 奖励 → C3 / C6
 *   ③ 选择 cannon 后变成 ×5             → D4（第一局）
 *   ④ 选择其它 Weapon 只增加对应 stack   → H4（第二局选 hammer：1 → 2，cannon 仍 5）
 *   ⑤ 同一奖励只能领取一次               → E1/E2/E3（同 token **换一件**也领不到）
 *   ⑥ FAILED 数量完全不变                → I2 / I5
 *   ⑦ old Profile migration 不丢数据     → 由 `tests/playerGrowthR2A.test.ts` 的 PG-07~PG-10 离线钉死
 *   ⑧ Equipped 仍指向有效库存实例         → 同上（PG-11~PG-14）
 *
 * ⚠️ 两条路线都是**确定性**的（`RunBattleRuntime` 无 RNG，`portraitRunPage.test.ts` 的
 *    `FROZEN_REPAIR` / `FROZEN_UPGRADE` 已冻结）：
 *      完成：一层 `twinCannon` + 耐久事件选「维修」+ 二层 `tripleLoad` → 终局 602 耐久 → COMPLETE
 *      失败：一层 `twinCannon` + 耐久事件选「继续改装」（多拿 `heavyShell`）+ 二层 `tripleLoad`
 *            → 终局耐久归零 → **FAILED（不经过 RESULT）**
 *    两条路线**只差一次点击**，因此「失败不发奖」是同一台机器上的真实对照，不是构造出来的状态。
 *
 * ⚠️ 为什么本文件要跑**两局成功**：R2-A 的核心是「数量会累积」，而「累积」只有在
 *    **第二局的读数与第一局不同**时才是可观测的事实。一局只能证明「+1」，两局才能证明
 *    「同一个 stack 会一直长，而别的 stack 不会跟着长」（验收 ③ 与 ④ 是同一台机器上的对照）。
 *
 * 用法：
 *   npm run build:portrait-lab
 *   node tests/_e2e_product_reward.cjs   （或 npm run e2e:product-reward）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8167;
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
 * 3选1 的三条候选（与 `src/product/runReward.ts` 的 `REWARD_CHOICE_IDS` 同值）。
 * ⚠️ 全是**玩家一开始就拥有**的正式 Weapon ⇒ 本 Queue 不发新内容，
 *    奖励的价值体现在**数量**上（4 → 5），而不是「从无到有」。
 */
const CHOICE_IDS = ['cannon', 'spear', 'hammer'];
const NAMES = { cannon: '炮', spear: '刺', hammer: '锤' };
/** 满 stack 阈值（与 `playerGrowth.FUSE_STACK` 同值；页面读数也必须是它）。 */
const FUSE_STACK = 5;
/**
 * 新账号的成长起点读数（真源 = `src/product/playerGrowth.ts` 的 `FRESH_STACK_SEED`）。
 * ⚠️ 刻意不写成「三件都是 4」：起点是 `cannon 4 / 另外两件各 1`，而这个不对称正是
 *    「第一局领 cannon 就能凑满 5/5、领别的只是 +1」这条产品设计的事实依据。
 */
const SEED_COUNTS = { cannon: 4, spear: 1, hammer: 1 };
/** 是否带正式 sprite（`core/content.ts` 的真实值；无 sprite 的件卡片必须如实标「暂无美术」）。 */
const HAS_SPRITE = { cannon: true, spear: false, hammer: true };
/** 三个正式存档 key（与 src 同值；E2E 独立取证，不经过页面探针）。 */
const BUILD_KEY = 'strongfruit.playerBuild.v1';
const INV_KEY = 'strongfruit.ownedParts.v2';
const CLAIMS_KEY = 'strongfruit.profileClaims.v1';
/** A 段打通的唯一武器槽。 */
const WEAPON_SLOT = 'frontMass';

/**
 * 3选1 候选卡用到的三个**非入账**色（`runPage.ts` 的 `COLORS`）。
 * 它们刻意不在像素账本 `PALETTE` 里 ⇒ 卡片不会把任何入账面积算进 / 算错。
 */
const CARD_BG = [0x1b, 0x24, 0x32]; // COLORS.cardBg —— 卡片底
const ICON_FRAME_BG = [0x0b, 0x0e, 0x14]; // COLORS.pageBg —— 图标框底（卡片内唯一出现处）
const ICON_GLYPH = [0x9a, 0xa2, 0xb2]; // COLORS.wheelRim —— 图标本体（真实 Collider 外接框）

/** 赢：耐久事件选「维修」→ 终局有耐久 → COMPLETE。 */
const WIN_POLICY = { layer1: 'twinCannon', lateral: null, layer2: 'tripleLoad', durability: 'repair' };
/** 输：同路线但耐久事件选「继续改装」（多拿一件横向改装）→ 终局耐久归零 → FAILED。 */
const LOSE_POLICY = { layer1: 'twinCannon', lateral: 'heavyShell', layer2: 'tripleLoad', durability: 'upgrade' };

/** 单次完整 Run 的驱动预算（四场真实物理战斗）。 */
const DRIVE_BUDGET_MS = 240000;

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
  await sleep(100);
}

/** 真实鼠标点击 Run 画布：逻辑坐标 → 屏幕坐标（用画布真实 CSS 矩形换算，不用 DPR-backed 尺寸）。 */
async function clickLogical(page, lx, ly) {
  const screen = (await probeRun(page)).screen;
  const cx = screen.left + (lx / 390) * screen.width;
  const cy = screen.top + (ly / 844) * screen.height;
  await page.mouse.click(cx, cy);
}

/** 点击某个布局矩形的中心（真实鼠标事件）。 */
async function clickRect(page, r) {
  await clickLogical(page, r.x + r.w / 2, r.y + r.h / 2);
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

/** 从真实 storage dump 里读某个 ★1 stack 的副本数（0 = 副本数 0）。 */
function invCount(dump, defId) {
  const raw = dump[INV_KEY];
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    const e = o && o[defId];
    return e ? Number(e.one) : 0;
  } catch {
    return null;
  }
}

/** 从真实 storage dump 里读领奖账本（幂等键数组）。 */
function ledgerTokens(dump) {
  const raw = dump[CLAIMS_KEY];
  if (!raw) return [];
  try {
    const o = JSON.parse(raw);
    return Array.isArray(o.grantedRunIds) ? o.grantedRunIds : [];
  } catch {
    return [];
  }
}

/** 从真实 storage dump 里读当前装备的武器槽 defId。 */
function storedWeaponSlot(dump) {
  const raw = dump[BUILD_KEY];
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    const sel = o && o.functionalSelections;
    return sel ? (sel[WEAPON_SLOT] ?? null) : null;
  } catch {
    return null;
  }
}

/** 从出发链接里取出产品侧给的那份 3选1 载荷（地址真源只有产品侧一个）。 */
function choicesOf(href) {
  const raw = new URLSearchParams(href.split('?')[1] ?? '').get('choices') ?? '';
  return raw ? JSON.parse(raw) : null;
}

/**
 * 真实 `getImageData`：在**逻辑坐标矩形**内统计与给定 RGB 精确相等的像素数。
 * ⚠️ 只在 DPR = 1（且舞台 1:1）时有意义 —— 本 E2E 用 390×844 视口，画布 backing = 逻辑尺寸。
 */
function countColorInRect(page, rect, rgb) {
  return page.evaluate(
    ({ r, target }) => {
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
        if (d[i] === target[0] && d[i + 1] === target[1] && d[i + 2] === target[2]) n += 1;
      }
      return n;
    },
    { r: rect, target: rgb },
  );
}

/** 读 Garage 里某张 Weapon 卡的真实 DOM 读数（star / count / stackText 都来自卡片自己的 data-*）。 */
function garageCard(page, defId) {
  return page.evaluate((id) => {
    const n = document.querySelector(`[data-ph-weapon="${id}"]`);
    if (!n) return null;
    return {
      text: n.textContent,
      star: n.getAttribute('data-ph-star'),
      count: n.getAttribute('data-ph-count'),
      stackText: n.getAttribute('data-ph-stack-text'),
      threshold: n.getAttribute('data-ph-stack-threshold'),
      equipped: n.getAttribute('data-ph-equipped'),
    };
  }, defId);
}

/**
 * 把一局 Run 从 IDLE 驱到终态（COMPLETE / FAILED）。
 *
 * 全部用**真实鼠标点击**：耐久事件按 id 选、强化三选一按池种类选、其余推进一步。
 * 同时滚动记录两条不变量：
 *   · `choicesInNonComplete` —— 在**非 COMPLETE** 相位上出现过 3选1 候选（必须恒为空）；
 *   · `choicePhases`         —— 真正出现过候选的相位集合。
 */
async function driveRunToEnd(page, policy, label) {
  const t0 = Date.now();
  const seen = [];
  const choicesInNonComplete = [];
  const choicePhases = new Set();
  let last = null;
  while (Date.now() - t0 < DRIVE_BUDGET_MS) {
    const p = await probeRun(page);
    if (!last || last.phase !== p.phase) seen.push(p.phase);
    last = p;
    if (p.rewardChoices.length > 0 || p.rewardChoiceRects.length > 0) {
      choicePhases.add(p.phase);
      if (p.phase !== 'COMPLETE') choicesInNonComplete.push(p.phase);
    }
    if (p.phase === 'COMPLETE' || p.phase === 'FAILED') {
      return {
        probe: p,
        seen,
        choicesInNonComplete,
        choicePhases: [...choicePhases],
        ms: Date.now() - t0,
      };
    }
    // 耐久事件：按 id 选（repair / upgrade）
    if (p.durabilityOpen && p.overlayOptions.length > 0) {
      const opt = p.overlayOptions.find((o) => o.id === policy.durability) ?? p.overlayOptions[0];
      await clickRect(page, opt.rect);
      await sleep(180);
      continue;
    }
    // 强化三选一 / 横向二选一 / 第二层条件池：按池种类选择指定 id
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
  throw new Error(`${label} 驱动超时（${DRIVE_BUDGET_MS}ms）· 最后 phase=${last ? last.phase : 'n/a'}`);
}

/**
 * 「从首页出发 → 打完一局 → **真实鼠标点中某一张候选卡** → 回到首页」的完整一轮。
 * 返回这一轮的全部取证（不在这里做断言，断言留给主流程的字母段落）。
 */
async function playOneRunAndClaim(page, pickDefId, policy, label) {
  const homeBefore = await probeHome(page);
  const token = homeBefore.runToken;
  const cards = choicesOf(homeBefore.adventureHref);
  const pickIndex = CHOICE_IDS.indexOf(pickDefId);
  if (pickIndex < 0) throw new Error(`候选池里没有 ${pickDefId}`);
  const pickHref = cards.choices[pickIndex].href;

  const storedBefore = await storageDump(page);
  const before = {};
  for (const id of CHOICE_IDS) before[id] = invCount(storedBefore, id);

  await Promise.all([
    page.waitForURL(/run-page\.html/, { timeout: 20000 }).catch(() => {}),
    clickSelector(page, '[data-ph-action="start-run"]'),
  ]);
  await waitRunReady(page);
  const runStart = await probeRun(page);

  const done = await driveRunToEnd(page, policy, label);
  const pDone = done.probe;

  /*
    ⚠️ 像素取证必须在**点那张卡之前**做：点中即整页导航回首页 ⇒ `#run-canvas` 不复存在
    （`countColorInRect` 会拿到 null）。这是真实踩过的坑，不是防御性代码。
    A/B 基准矩形统一取 **最下面那张卡**（`rects[2]`，完整落在失败结算面板的槽位内）。
  */
  const rects = pDone.rewardChoiceRects;
  const pixel = { cardBg: 0, iconFrame: 0, iconGlyph: 0 };
  for (const r of rects) {
    pixel.cardBg += await countColorInRect(page, r, CARD_BG);
    pixel.iconFrame += await countColorInRect(page, r, ICON_FRAME_BG);
    pixel.iconGlyph += await countColorInRect(page, r, ICON_GLYPH);
  }
  pixel.abCardBg = await countColorInRect(page, rects[2], CARD_BG);
  pixel.abIconFrame = await countColorInRect(page, rects[2], ICON_FRAME_BG);
  pixel.abIconGlyph = await countColorInRect(page, rects[2], ICON_GLYPH);

  // **真实鼠标点击**选中的那张卡（坐标来自探针里与绘制同源的矩形）
  const cardRect = pDone.rewardChoiceRects[pickIndex];
  await Promise.all([
    page.waitForURL(/home\.html/, { timeout: 20000 }).catch(() => {}),
    clickRect(page, cardRect),
  ]);
  await waitHomeReady(page);
  const urlAfter = await page.evaluate(() => location.pathname + location.search);
  const homeAfter = await probeHome(page);
  const storedAfter = await storageDump(page);
  const after = {};
  for (const id of CHOICE_IDS) after[id] = invCount(storedAfter, id);

  return {
    label,
    token,
    cards,
    pickIndex,
    pickDefId,
    pickHref,
    before,
    after,
    storedBefore,
    storedAfter,
    runStart,
    done,
    pDone,
    homeAfter,
    urlAfter,
    cardRect,
    rects,
    pixel,
  };
}

async function main() {
  console.log('=== PRODUCT-LOOP-R2-A｜3选1 → 数量累积 → 回车库 产品闭环 smoke ===\n');

  for (const f of ['home.html', 'run-page.html']) {
    if (!fs.existsSync(path.join(ROOT, f))) {
      console.error(`未找到 ${path.join(ROOT, f)} —— 请先 npm run build:portrait-lab`);
      process.exit(1);
    }
  }

  const server = await startServer();
  log(true, 'P0 静态产物就绪（dist-portrait-lab 内 home.html + run-page.html 真实存在）');

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  /*
    ⚠️ 视口 = 390×844 / DPR 1：Run 画布 **1:1**（不是桌面手机框缩放）。
    这样 `getImageData` 的精确色统计才成立（缩放重采样会让颜色失真）。
  */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  try {
    /* --------------------------------- 1) 首页基线：新账号的成长起点（验收 ①） */
    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const home0 = await probeHome(page);
    const stored0 = await storageDump(page);
    log(
      home0.claim === null && home0.claimedRunCount === 0,
      'A1 正常打开首页：不是带奖励回来的（没有领奖请求，账本为空）',
      `claim=${home0.claim} claimed=${home0.claimedRunCount} token=${home0.runToken}`,
    );
    log(
      home0.growth.fresh === true &&
        home0.growth.seeded === true &&
        home0.growth.stackThreshold === FUSE_STACK &&
        invCount(stored0, 'cannon') === 4 &&
        invCount(stored0, 'spear') === 1 &&
        invCount(stored0, 'hammer') === 1,
      'A2 **新账号的成长起点**（验收 ①）：cannon ★1 ×4，另外两件候选各 ×1（种子只发这一次）',
      `fresh=${home0.growth.fresh} seeded=${home0.growth.seeded} cannon=${invCount(stored0, 'cannon')} spear=${invCount(stored0, 'spear')} hammer=${invCount(stored0, 'hammer')}`,
    );
    log(
      home0.weapons.length === 3 &&
        home0.weapons.every((w) => w.star === 1 && w.threshold === FUSE_STACK) &&
        home0.weapons.find((w) => w.defId === 'cannon').count === 4 &&
        home0.weapons.find((w) => w.defId === 'cannon').stackText === '×4' &&
        home0.weapons.every((w) => w.reachesThreshold === false),
      'A3 Garage 读数与库存同源：三张卡都是 ★1、分母 = 满 stack 阈值、次数 4/1/1（未满）',
      home0.weapons.map((w) => `${w.name}★${w.star}${w.stackText}`).join(' · '),
    );

    const token0 = home0.runToken;
    const adv0 = new URLSearchParams(home0.adventureHref.split('?')[1] ?? '');
    const payload0 = choicesOf(home0.adventureHref);
    const homeHref = adv0.get('home') ?? '';
    const expectedClaims = CHOICE_IDS.map((id) => `./home.html?run=${token0}&reward=${id}`);
    log(
      home0.adventureHref.startsWith('./run-page.html?') &&
        home0.startRunHref === home0.adventureHref &&
        adv0.get('run') === token0 &&
        adv0.get('reward') === null &&
        !!payload0 &&
        payload0.stack === FUSE_STACK &&
        payload0.choices.length === 3 &&
        payload0.choices.every((c, i) => c.defId === CHOICE_IDS[i]) &&
        payload0.choices.every((c, i) => c.href === expectedClaims[i]),
      'A4「开始冒险」= 带本局 token + **一整份 3选1 载荷**（三条各自的领奖地址）的同产物链接；地址里**没有**裸 `reward=`',
      `href=${home0.startRunHref}`,
    );
    log(
      homeHref !== '' && !/[?&](run|reward)=/.test(homeHref),
      'A4b 出发链接同时给全「失败回哪儿」：**纯首页**（不带任何领奖参数 ⇒ 回首页不会触发入库）',
      `home=${homeHref}`,
    );
    log(
      home0.weapons.find((w) => w.defId === 'cannon').count === SEED_COUNTS.cannon &&
        payload0.choices.every((c) => c.star === 1) &&
        payload0.choices.every((c, i) => c.countBefore === SEED_COUNTS[CHOICE_IDS[i]]) &&
        payload0.choices[0].countBefore === SEED_COUNTS.cannon,
      'A5 载荷里的数量读数 = 出发那一刻的真实库存（4 / 1 / 1，逐件对账）；三条候选共用同一个本局 token ⇒ 只能领一次',
      `载荷=${payload0.choices.map((c) => `${c.defId}:${c.countBefore}`).join(' ')}`,
    );

    /* ============================ 第一局：选 cannon（验收 ③） ============================ */
    const r1 = await playOneRunAndClaim(page, 'cannon', WIN_POLICY, '第一局（完成路线）');
    const pDone = r1.pDone;

    log(
      r1.runStart.phase !== 'COMPLETE' &&
        r1.runStart.rewardChoices.length === 0 &&
        r1.runStart.rewardChoiceRects.length === 0 &&
        r1.runStart.exitHref === null,
      'B1 刚进 Run（未结算）：**没有**任何候选卡、也没有产品出口（只有真结算才出现）',
      `phase=${r1.runStart.phase} choices=${r1.runStart.rewardChoices.length} exitHref=${r1.runStart.exitHref}`,
    );

    log(
      pDone.phase === 'COMPLETE' && pDone.complete === true && pDone.failed === false,
      'C1 四场打完 → RUN COMPLETE（同一条确定性路线）',
      `phase=${pDone.phase} battles=${pDone.battlesCompleted}/${pDone.battleTotal} 用时 ${round2(r1.done.ms / 1000)}s`,
    );
    log(
      r1.done.choicesInNonComplete.length === 0 && r1.done.choicePhases.includes('COMPLETE'),
      'C2 候选卡只在 COMPLETE 出现：全程所有其它相位都没有它（含 IDLE/EVENT/BATTLE/RESULT/CHOICE）',
      `出现相位=${r1.done.choicePhases.join(',')} · 非 COMPLETE 违规=${r1.done.choicesInNonComplete.length}`,
    );

    /* 必改 4：终点是**三张真实候选**（名称 / ★1 / 当前数量 / 领取后数量预览） */
    const rc = pDone.rewardChoices;
    log(
      pDone.day === 7 &&
        pDone.battle.durabilityPercent > 0 &&
        pDone.buildLabels.length === 2 &&
        rc.length === 3 &&
        rc.every((c, i) => c.defId === CHOICE_IDS[i] && c.name === NAMES[CHOICE_IDS[i]]) &&
        rc.every((c, i) => c.star === 1 && c.energy > 0 && c.hasSprite === HAS_SPRITE[CHOICE_IDS[i]]) &&
        rc[0].countBefore === 4 &&
        rc[0].countAfter === 5 &&
        rc[0].previewText === '4 → 5' &&
        rc[0].reachesThreshold === true &&
        rc[1].countBefore === 1 &&
        rc[1].countAfter === 2 &&
        rc[1].previewText === '1 → 2' &&
        rc[1].reachesThreshold === false,
      'C3 RUN COMPLETE = 最终 DAY + 最终耐久 + 最终 Build + **三张真实 Weapon 候选**（名称 / ★1 / 数量 / 领取后预览）',
      `DAY ${pDone.day} · 耐久 ${pDone.battle.durabilityPercent}% · Build=${pDone.buildLabels.join('+')} · 候选=${rc.map((c) => `${c.name}★${c.star} ${c.previewText}${c.reachesThreshold ? '(满)' : ''}`).join(' | ')}`,
    );
    log(
      rc.every((c, i) => c.href === expectedClaims[i]) && pDone.rewardChoicesDropped === 0,
      'C4 三张卡的出口 = 产品侧给的**各自**领奖地址（Lab 侧不含任何产品 URL 字面量），且三条载荷全部合法（丢弃 0 条）',
      `dropped=${pDone.rewardChoicesDropped} hrefs=${rc.map((c) => c.href.replace('./home.html?', '')).join(' ')}`,
    );
    log(
      pDone.exitHref === null &&
        pDone.actionEnabled === false &&
        pDone.actionLabel !== '领取并返回',
      'C5 出口**在卡片上**：底栏动作不可用、也没有「领取并返回」（3选1 不存在「默认那件」）',
      `label=${pDone.actionLabel} enabled=${pDone.actionEnabled} exit=${pDone.exitHref}`,
    );

    /*
      像素取证：三张卡真的画在画布上（不是只有探针字段）。
      ⚠️ 读数是在 `playOneRunAndClaim` 里、**点那张卡之前**采的：点中即整页导航回首页
      ⇒ `#run-canvas` 不复存在（`getImageData` 拿不到画布）。这是真实踩过的坑。
    */
    const rects = r1.rects;
    const cardBgPx = r1.pixel.cardBg;
    const iconFramePx = r1.pixel.iconFrame;
    const iconGlyphPx = r1.pixel.iconGlyph;
    /*
      ⚠️ A/B 基准矩形 = **最下面那张卡**：它的矩形（y 302..370）完整落在失败结算面板的槽位
      （`runFailPanelRect()` 的 y 266..370）内部 ⇒ 同一个矩形可以拿来做 COMPLETE / FAILED 对照。
      上面两张卡与面板只部分重叠，不能用于对照。
    */
    const abRect = rects[2];
    const abCardBgPx = r1.pixel.abCardBg;
    const abIconFramePx = r1.pixel.abIconFrame;
    const abIconGlyphPx = r1.pixel.abIconGlyph;
    /*
      阈值来源（不是拍的）：三个矩形总面积 = 3 × 362 × 68 = 73848 px²。
      卡底之外的像素只有三类：① 2px 描边（cardEdge）；② 图标框内部（pageBg 实心填充）；
      ③ 文字字形（名称 / ★ / 数量 / defId）。实测卡底 ≈ 58800（≈ 79.6% 面积）
      ⇒ 取 **55000（≈ 74.5%）** 作为「成片」的下界：既排掉「只画了个边框」，
      也给字体渲染 / 亚像素抗锯齿留足余量（不在阈值上做无意义的灵敏度竞赛）。
    */
    log(
      rects.length === 3 &&
        rects.every((r) => r.w === 362 && r.h === 68) &&
        cardBgPx > 55000 &&
        iconFramePx > 2000 &&
        iconGlyphPx > 600,
      'C6 三张候选卡真的画出来（真实 getImageData：卡底成片 + 每张都有图标框 + 真实 Collider 外接框）',
      `rects=${rects.map((r) => `${r.x},${r.y} ${r.w}×${r.h}`).join(' | ')} cardBg=${cardBgPx} iconFrame=${iconFramePx} glyph=${iconGlyphPx}`,
    );

    log(
      r1.urlAfter === `/home.html?run=${token0}&reward=cannon`,
      'D1 点中 **cannon 那张卡** = 真实整页导航到**它自己**的领奖地址（不是底栏按钮）',
      `url=${r1.urlAfter}`,
    );
    const claimDom = await page.evaluate(() => {
      const n = document.querySelector('[data-ph-claim]');
      return n
        ? {
            state: n.getAttribute('data-ph-claim'),
            def: n.getAttribute('data-ph-claim-def'),
            text: n.textContent,
          }
        : null;
    });
    log(
      r1.homeAfter.claim !== null &&
        r1.homeAfter.claim.ok === true &&
        r1.homeAfter.claim.defId === 'cannon' &&
        r1.homeAfter.claim.countAfter === 5 &&
        !!claimDom &&
        claimDom.state === 'ok' &&
        claimDom.def === 'cannon' &&
        claimDom.text.includes(NAMES.cannon),
      'D2 产品侧 Profile Repository 完成入库并如实展示：cannon 4 → **5**（验收 ③）',
      `ok=${r1.homeAfter.claim ? r1.homeAfter.claim.ok : 'n/a'} count=${r1.homeAfter.claim ? r1.homeAfter.claim.countAfter : 'n/a'} dom=${claimDom ? `[${claimDom.state}] ${claimDom.text}` : 'n/a'}`,
    );
    log(
      r1.after.cannon === 5 &&
        r1.after.spear === 1 &&
        r1.after.hammer === 1 &&
        ledgerTokens(r1.storedAfter).length === 1 &&
        ledgerTokens(r1.storedAfter)[0] === token0,
      'D3 **独立取证**（读浏览器真实 localStorage）：只有 cannon +1，另外两件一个数字都没动；账本记下本局 token',
      `cannon ${r1.before.cannon}→${r1.after.cannon} · spear ${r1.before.spear}→${r1.after.spear} · hammer ${r1.before.hammer}→${r1.after.hammer} · 账本=${JSON.stringify(ledgerTokens(r1.storedAfter))}`,
    );
    log(
      r1.homeAfter.weapons.find((w) => w.defId === 'cannon').stackText === '5/5' &&
        r1.homeAfter.weapons.find((w) => w.defId === 'cannon').reachesThreshold === true,
      'D4 领奖后的首页读数：cannon 达到满 stack ⇒ 显示 `5/5`（Queue「达到5件时只显示 5/5」；本 Queue **不做合成**）',
      `cannon stackText=${r1.homeAfter.weapons.find((w) => w.defId === 'cannon').stackText}`,
    );

    /* --------------------------- 2) 同一 Run **换一件**再领 → 仍然领不到（验收 ⑤） */
    await page.goto(`${URL_BASE}/home.html?run=${token0}&reward=spear`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const homeDup = await probeHome(page);
    const storedDup = await storageDump(page);
    const dupDom = await page.evaluate(() => {
      const n = document.querySelector('[data-ph-claim]');
      return n ? { state: n.getAttribute('data-ph-claim'), text: n.textContent } : null;
    });
    log(
      homeDup.claim !== null &&
        homeDup.claim.ok === false &&
        homeDup.claim.reason === 'already-claimed' &&
        !!dupDom &&
        dupDom.state === 'duplicate' &&
        homeDup.claimedRunCount === 1,
      'E1 拿着**同一个 token 但换一件**（spear）再回首页 → Repository 判「已领取」（换一件 = 换一个说法，不是新的一局）',
      `ok=${homeDup.claim ? homeDup.claim.ok : 'n/a'} reason=${homeDup.claim ? homeDup.claim.reason : 'n/a'} dom=${dupDom ? `[${dupDom.state}] ${dupDom.text}` : 'n/a'}`,
    );
    log(
      invCount(storedDup, 'cannon') === 5 && invCount(storedDup, 'spear') === 1 && ledgerTokens(storedDup).length === 1,
      'E2 库存逐项不变（cannon 仍 5 / spear 仍 1），账本仍只有 1 条（没有第二条记录）',
      `cannon=${invCount(storedDup, 'cannon')} spear=${invCount(storedDup, 'spear')} 账本=${ledgerTokens(storedDup).length}`,
    );

    /* ------------------------------------- 3) 回车库：真的看到并装上刚长出来的那件 */
    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const home3 = await probeHome(page);
    log(
      home3.claim === null && home3.claimedRunCount === 1 && home3.growth.seeded === false,
      'F1 干净打开首页：不再有领奖请求、账本是持久化的 1 条，且**种子不会再发一次**（只发新账号）',
      `claim=${home3.claim} claimed=${home3.claimedRunCount} seeded=${home3.growth.seeded}`,
    );

    await clickSelector(page, '[data-ph-action="open-garage"]');
    const g1 = await probeHome(page);
    const cannonCard = await garageCard(page, 'cannon');
    const spearCard = await garageCard(page, 'spear');
    log(
      g1.view === 'garage' &&
        !!cannonCard &&
        cannonCard.star === '1' &&
        cannonCard.count === '5' &&
        cannonCard.stackText === '5/5' &&
        cannonCard.threshold === String(FUSE_STACK) &&
        cannonCard.text.includes(NAMES.cannon) &&
        !!spearCard &&
        spearCard.star === '1' &&
        spearCard.count === '1' &&
        spearCard.stackText === '×1',
      'F2 调整战车：Weapon 卡**带星级与数量**（`炮 ★1 5/5` / `刺 ★1 ×1`），且与库存同源',
      `${cannonCard ? cannonCard.text : 'n/a'} ｜ ${spearCard ? spearCard.text : 'n/a'}`,
    );

    const energyBefore = g1.energy;
    await clickSelector(page, '[data-ph-weapon="spear"]');
    const g2 = await probeHome(page);
    log(
      g2.selectedWeaponId === 'spear' && g2.equipEnabled === true,
      'F3 点击 spear → 明确选中，且「装备」可点（它是一件能装上的东西）',
      `selected=${g2.selectedWeaponId} equipEnabled=${g2.equipEnabled}`,
    );

    await clickSelector(page, '[data-ph-action="equip"]');
    const g3 = await probeHome(page);
    const stored3 = await storageDump(page);
    log(
      g3.equippedWeaponId === 'spear' &&
        g3.lastEquip &&
        g3.lastEquip.ok === true &&
        storedWeaponSlot(stored3) === 'spear',
      'F4 装上成功：当前主武器变成 spear，且**正式 Build 存档**的武器槽也变了（唯一数据源）',
      `equipped=${g3.equippedWeaponId} ${WEAPON_SLOT}=${storedWeaponSlot(stored3)}`,
    );
    log(
      g3.energy === energyBefore - 5 && g3.energyCapacity === g1.energyCapacity,
      'F5「装上它真的不一样」：能量读数按两件正式武器的差额真实变化（炮 E30 → 刺 E25，不写死显示值）',
      `能量 ${energyBefore} → ${g3.energy} / 容量 ${g3.energyCapacity}`,
    );

    /* --------------------------------------------- 4) Reload 后状态保持 */
    await page.reload({ waitUntil: 'load' });
    await waitHomeReady(page);
    const afterReload = await probeHome(page);
    const stored4 = await storageDump(page);
    log(
      afterReload.equippedWeaponId === 'spear' &&
        afterReload.weaponIds.length === 3 &&
        afterReload.claimedRunCount === 1 &&
        invCount(stored4, 'cannon') === 5 &&
        invCount(stored4, 'spear') === 1,
      'G1 整页 reload 后：装备 / 数量 / 账本全部来自真实持久化（cannon 5 件仍是 5 件）',
      `equipped=${afterReload.equippedWeaponId} weapons=${afterReload.weaponIds.length} claimed=${afterReload.claimedRunCount} cannon=${invCount(stored4, 'cannon')}`,
    );

    /*
      ⚠️ 第二局出发前**必须换回 cannon** —— 这不是「顺手点一下」，而是一条**实测约束**：
      主武器槽的实测矩阵（`src/product/playerLoadout.ts` 的 `DEFAULT_CLEARED_SLOT` 注释）里，
      只有 cannon（远程炮）能在默认车上稳定打完四场；spear 会在第 2 场僵持跑不完、
      hammer 第 1 场就被打死（玩家弹丸峰值 0）。
      本段要的是「第二局**真的打完**」（验收 ④ 需要 COMPLETE 才会出现候选卡），
      所以必须让它带着**能赢的那件**出发 —— 这是产品事实，不是为了测试放水。
      ⚠️ 顺带实证「装备是可逆的」：能量读数应当回到装 cannon 时的读数。
    */
    await clickSelector(page, '[data-ph-action="open-garage"]');
    await clickSelector(page, '[data-ph-weapon="cannon"]');
    await clickSelector(page, '[data-ph-action="equip"]');
    const g4 = await probeHome(page);
    const storedCannonBack = await storageDump(page);
    log(
      storedWeaponSlot(storedCannonBack) === 'cannon' &&
        g4.equippedWeaponId === 'cannon' &&
        g4.energy === energyBefore,
      'G2 换回 cannon（第二局要真的打完四场 ⇒ 主武器必须是实测能赢的那件）：正式存档武器槽 = cannon，能量回到 55（装备可逆）',
      `frontMass=${storedWeaponSlot(storedCannonBack)} 能量=${g4.energy}`,
    );
    await clickSelector(page, '[data-ph-action="back-home"]');

    /* ==================== 第二局：选 hammer（验收 ④；也是「累积」的真正证明） ==================== */
    const r2 = await playOneRunAndClaim(page, 'hammer', WIN_POLICY, '第二局（完成路线）');
    log(
      r2.token !== token0 && r2.pickHref !== r1.pickHref,
      'H1 第二局的 token 与第一局不同（每挂载一次首页 = 一次新的「准备出发」）⇒ 领奖是**新的一局**，不是重复领',
      `token1=${token0} token2=${r2.token}`,
    );
    log(
      r2.runStart.playerLoadout.source === 'profile' &&
        r2.runStart.playerLoadout.functionalSelections[WEAPON_SLOT] === 'cannon',
      'H1b 第二局确实带着**刚换回的** cannon 出发（局外的装备动作真的作用到了下一局）',
      `source=${r2.runStart.playerLoadout.source} ${WEAPON_SLOT}=${r2.runStart.playerLoadout.functionalSelections[WEAPON_SLOT]}`,
    );
    log(
      r2.pDone.phase === 'COMPLETE' &&
        r2.pDone.rewardChoices.length === 3 &&
        r2.pDone.rewardChoices[0].countBefore === 5 &&
        r2.pDone.rewardChoices[2].countBefore === 1,
      'H2 第二局终点的候选读数 = **上一局结束时的库存**（cannon 5 / hammer 1）—— 数量真的在跨局累积',
      `候选=${r2.pDone.rewardChoices.map((c) => `${c.defId}:${c.previewText}`).join(' ')}`,
    );
    log(
      r2.after.hammer === 2 &&
        r2.after.cannon === 5 &&
        r2.after.spear === 1 &&
        ledgerTokens(r2.storedAfter).length === 2,
      'H3 **验收 ④**：选 hammer 只让 hammer 1 → 2；cannon 仍 5、spear 仍 1（不同 stack 各自独立）',
      `cannon ${r2.before.cannon}→${r2.after.cannon} · spear ${r2.before.spear}→${r2.after.spear} · hammer ${r2.before.hammer}→${r2.after.hammer} · 账本=${ledgerTokens(r2.storedAfter).length}`,
    );
    log(
      r2.homeAfter.weapons.find((w) => w.defId === 'hammer').count === 2 &&
        r2.homeAfter.weapons.find((w) => w.defId === 'hammer').stackText === '×2' &&
        r2.homeAfter.weapons.find((w) => w.defId === 'cannon').stackText === '5/5',
      'H4 首页读数：hammer `★1 ×2`、cannon `★1 5/5`（同一份库存，两个 stack 各长各的）',
      r2.homeAfter.weapons.map((w) => `${w.name}★${w.star}${w.stackText}`).join(' · '),
    );

    const storedFinal = await storageDump(page);
    const finalCounts = { cannon: invCount(storedFinal, 'cannon'), spear: invCount(storedFinal, 'spear'), hammer: invCount(storedFinal, 'hammer') };

    /* ------------------- 5) FAILED 对照：同一条机器、只差一次点击 → 数量零变化（验收 ⑥） */
    const failPage = await ctx.newPage();
    const failErrors = [];
    failPage.on('pageerror', (e) => failErrors.push(String(e)));
    /*
      ⚠️ 按**产品真实上下文**打开（而不是零参数）：那一局必须和玩家真实出发的那一局
         带一样的东西（`run` / `choices` / `home`）—— 这样「即使三条领奖地址就摆在同一个
         页面上，失败也拿不到它们」才是结构性反证（验收 ⑥ 的最强形态）。
         ⚠️ 刻意**不带** `equipped`：保留 demo 装载 ⇒ `LOSE_POLICY` 的确定性（耐久归零路线）
         与 R1-C 逐字一致，本段只变「产品上下文」这一个自变量。
    */
    const homeForFail = await probeHome(page);
    const failQuery = new URLSearchParams(homeForFail.adventureHref.split('?')[1] ?? '');
    await failPage.goto(`${URL_BASE}/run-page.html?${failQuery.toString()}`, { waitUntil: 'load' });
    await waitRunReady(failPage);
    const lose = await driveRunToEnd(failPage, LOSE_POLICY, '失败路线');
    const pFail = lose.probe;
    log(
      pFail.phase === 'FAILED' && pFail.failed === true && pFail.complete === false,
      'I1 同路线改选「继续改装」→ 终局耐久归零 → RUN FAILED（真实浏览器对照，不是构造状态）',
      `phase=${pFail.phase} failed=${pFail.failed} 用时 ${round2(lose.ms / 1000)}s`,
    );
    log(
      pFail.rewardChoices.length === 0 &&
        pFail.rewardChoiceRects.length === 0 &&
        pFail.chosenDefId === null &&
        lose.choicesInNonComplete.length === 0,
      'I2 **验收 ⑥**：领奖上下文**齐备**（run/choices/home 都在同一条 URL 上）时，FAILED 依然拿不到任何候选（结构上没有奖励选择）',
      `choices=${pFail.rewardChoices.length} rects=${pFail.rewardChoiceRects.length} chosen=${pFail.chosenDefId}`,
    );
    log(
      pFail.exitHref === homeHref &&
        pFail.actionEnabled === true &&
        pFail.actionLabel === '返回主界面' &&
        pFail.actionLabel !== '重新开始冒险',
      'I3 FAILED 的主动作 =「返回主界面」（可点的真实出口），出口是**纯首页**而不是任何领奖地址',
      `label=${pFail.actionLabel} enabled=${pFail.actionEnabled} exit=${pFail.exitHref}`,
    );
    /*
      像素 A/B：**同一块矩形**（最下面那张候选卡的位置）上
        COMPLETE = 三张候选卡之一 ⇒ 有卡片专属图形（图标框底 + Collider 本体）；
        FAILED   = 结算面板复用同一槽位 ⇒ 卡片专属图形必须为 **0**。
      这比「有没有底色」强：失败那块画的是结算面板，不是发奖。
    */
    const failAbBg = await countColorInRect(failPage, abRect, CARD_BG);
    const failAbFrame = await countColorInRect(failPage, abRect, ICON_FRAME_BG);
    const failAbGlyph = await countColorInRect(failPage, abRect, ICON_GLYPH);
    log(
      abIconFramePx > 600 && abIconGlyphPx > 200 && failAbFrame === 0 && failAbGlyph === 0 && failAbBg > 20000,
      'I4 像素 A/B：同一块矩形上 COMPLETE 有候选卡专属图形（图标框 + Collider 本体），FAILED **一个像素都没有**',
      `图标框: ${abIconFramePx} vs ${failAbFrame} · 图标本体: ${abIconGlyphPx} vs ${failAbGlyph} · 卡底: ${abCardBgPx} vs ${failAbBg}`,
    );
    const stored5 = await storageDump(failPage);
    const failCounts = { cannon: invCount(stored5, 'cannon'), spear: invCount(stored5, 'spear'), hammer: invCount(stored5, 'hammer') };
    log(
      failCounts.cannon === finalCounts.cannon &&
        failCounts.spear === finalCounts.spear &&
        failCounts.hammer === finalCounts.hammer &&
        ledgerTokens(stored5).length === 2,
      'I5 **验收 ⑥**：失败一局之后三件数量与账本**一个数字都没动**（失败不补偿、不发奖、不增长）',
      `cannon ${finalCounts.cannon}→${failCounts.cannon} · spear ${finalCounts.spear}→${failCounts.spear} · hammer ${finalCounts.hammer}→${failCounts.hammer} · 账本=${ledgerTokens(stored5).length}`,
    );
    log(failErrors.length === 0, 'I6 失败路线全程零运行时报错', failErrors.slice(0, 2).join(' | ') || 'none');
    await failPage.close();

    log(pageErrors.length === 0, 'J1 全流程零运行时报错', pageErrors.slice(0, 2).join(' | ') || 'none');
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
