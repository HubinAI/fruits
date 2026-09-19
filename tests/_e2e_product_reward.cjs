/**
 * PRODUCT-LOOP-R1-B-RUN-REWARD-PERMANENT-INVENTORY｜
 * 「打完一局 → 获得永久部件 → 部件真正进入局外库存 → 回车库看到」的**浏览器真实闭环 smoke**。
 *
 * 手段（与 `_e2e_product_home.cjs` 同一纪律，全部是真实行为取证）：
 *   - 真实浏览器（playwright-core / msedge），打开独立产物 `dist-portrait-lab/`；
 *   - **真实鼠标点击**（`page.mouse.click`，逻辑坐标 → 画布真实 CSS 矩形换算；不 evaluate 直调）；
 *   - **真实整页导航**（`<a href>` / `location.assign` 都由浏览器执行，不做 evaluate 跳转）；
 *   - **真实 localStorage 读取**（证明入库写进的是**正式存档 key**，而不是页面内存）；
 *   - **真实 `getImageData` 像素取证**（证明「本局获得」卡片真的画在画布上，不是只有探针字段）；
 *   - 只读诊断句柄 `window.__PRODUCTHOME__` / `window.__RUNPAGE__`（只读，不能借它改状态）。
 *
 * 覆盖 Queue 技术验收 1~7（第 8 条 = tsc / targeted / build 在门禁里跑）：
 *   ① RUN COMPLETE 出现真实奖励；② 领取一次后进入 Inventory；③ 重复领取不能重复发奖；
 *   ④ FAILED 不获得奖励；⑤ 返回首页后状态存在；⑥ Garage 能看到新部件；⑦ Reload 后状态保持。
 *
 * ⚠️ 两条路线都是**确定性**的（`RunBattleRuntime` 无 RNG，`portraitRunPage.test.ts` 的
 *    `FROZEN_REPAIR` / `FROZEN_UPGRADE` 已冻结）：
 *      完成：一层 `twinCannon` + 耐久事件选「维修」+ 二层 `tripleLoad` → 终局 602 耐久 → COMPLETE
 *      失败：一层 `twinCannon` + 耐久事件选「继续改装」（多拿 `heavyShell`）+ 二层 `tripleLoad`
 *            → 终局耐久归零 → **FAILED（不经过 RESULT）**
 *    两条路线**只差一次点击**，因此「失败不发奖」是同一台机器上的真实对照，不是构造出来的状态。
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

/** 本 Queue 的固定奖励（与 `src/product/runReward.ts` 的 `REWARD_WEAPON_ID` 同值）。 */
const REWARD_ID = 'laser';
const REWARD_NAME = '镭射';
/** 三个正式存档 key（与 src 同值；E2E 独立取证，不经过页面探针）。 */
const BUILD_KEY = 'strongfruit.playerBuild.v1';
const INV_KEY = 'strongfruit.ownedParts.v2';
const CLAIMS_KEY = 'strongfruit.profileClaims.v1';
/** A 段打通的唯一武器槽。 */
const WEAPON_SLOT = 'frontMass';

/**
 * RUN COMPLETE「本局获得」卡片用到的三个**非入账**色（`runPage.ts` 的 `COLORS`）。
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

/** 从真实 storage dump 里读库存副本数（0 = 没这件 / 副本数 0）。 */
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

/**
 * 把一局 Run 从 IDLE 驱到终态（COMPLETE / FAILED）。
 *
 * 全部用**真实鼠标点击**：耐久事件按 id 选、强化三选一按池种类选、其余推进一步。
 * 同时滚动记录两条不变量：
 *   · `cardInNonComplete` —— 在**非 COMPLETE** 相位上出现过奖励卡（必须恒为空）；
 *   · `cardPhases`       —— 真正出现过奖励卡的相位集合。
 */
async function driveRunToEnd(page, policy, label) {
  const t0 = Date.now();
  const seen = [];
  const cardInNonComplete = [];
  const cardPhases = new Set();
  let last = null;
  while (Date.now() - t0 < DRIVE_BUDGET_MS) {
    const p = await probeRun(page);
    if (!last || last.phase !== p.phase) seen.push(p.phase);
    last = p;
    if (p.rewardCard !== null || p.rewardCardRect !== null) {
      cardPhases.add(p.phase);
      if (p.phase !== 'COMPLETE') cardInNonComplete.push(p.phase);
    }
    if (p.phase === 'COMPLETE' || p.phase === 'FAILED') {
      return { probe: p, seen, cardInNonComplete, cardPhases: [...cardPhases], ms: Date.now() - t0 };
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

async function main() {
  console.log('=== PRODUCT-LOOP-R1-B｜RUN COMPLETE → 永久部件 → 回车库 产品闭环 smoke ===\n');

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
    /* --------------------------------------- 1) 首页基线：新账号，没有这件东西 */
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
      invCount(stored0, REWARD_ID) === 0 && !stored0[CLAIMS_KEY],
      'A2 基线：库存里还没有这件奖励，也还没有领奖账本（后面的 +1 一定是本局产生的）',
      `${REWARD_ID}.one=${invCount(stored0, REWARD_ID)} keys=${Object.keys(stored0).sort().join(',')}`,
    );
    log(
      !home0.weaponIds.includes(REWARD_ID),
      'A3 基线：车库可装备武器里也还没有它（不是「本来就有」）',
      `weapons=${home0.weaponIds.join(',')}`,
    );

    const token = home0.runToken;
    const claimHref = `./home.html?run=${token}&reward=${REWARD_ID}`;
    const advQuery = new URLSearchParams(home0.adventureHref.split('?')[1] ?? '');
    /*
      PRODUCT-LOOP-R1-D｜出发链接现在带**两个**回程地址，且必须是两个不同地址：
        `back` = 领奖地址（成功链）；`home` = **纯首页**（失败链；不带 run / reward
        ⇒ 回首页不会触发任何入库）。
      ⚠️ `home` 从**真实链接**里取（不在测试里另抄一份产品常量）—— 地址真源只有产品侧一个。
    */
    const homeHref = advQuery.get('home') ?? '';
    log(
      home0.adventureHref.startsWith('./run-page.html?') &&
        home0.startRunHref === home0.adventureHref &&
        advQuery.get('run') === token &&
        advQuery.get('reward') === REWARD_ID &&
        advQuery.get('back') === claimHref,
      'A4「开始冒险」= 带本局 token / 奖励 id / 回程地址的同产物链接（页面不硬编码地址）',
      `href=${home0.startRunHref}`,
    );
    log(
      homeHref !== '' && homeHref !== claimHref && !/[?&](run|reward)=/.test(homeHref),
      'A4b 出发链接同时给全「成功回哪儿」与「失败回哪儿」，后者是**纯首页**（不带任何领奖参数）',
      `back=${claimHref} home=${homeHref}`,
    );

    /* --------------------------------- 2) 出发 → Run Page 收到产品上下文（尚未结算） */
    await Promise.all([
      page.waitForURL(/run-page\.html/, { timeout: 20000 }).catch(() => {}),
      clickSelector(page, '[data-ph-action="start-run"]'),
    ]);
    await waitRunReady(page);
    const runStart = await probeRun(page);
    log(
      runStart.phase !== 'COMPLETE' &&
        runStart.rewardCard === null &&
        runStart.rewardCardRect === null &&
        runStart.exitHref === null,
      'B1 刚进 Run（未结算）：没有任何奖励卡、也没有产品出口（只有真结算才出现）',
      `phase=${runStart.phase} rewardCard=${runStart.rewardCard} exitHref=${runStart.exitHref}`,
    );

    /* --------------------- 3) 真实打完一局（双联炮 + 维修 + 三连装填）→ COMPLETE */
    const win = await driveRunToEnd(page, WIN_POLICY, '完成路线');
    const pDone = win.probe;
    log(
      pDone.phase === 'COMPLETE' && pDone.complete === true && pDone.failed === false,
      'C1 四场打完 → RUN COMPLETE（同一条确定性路线）',
      `phase=${pDone.phase} battles=${pDone.battlesCompleted}/${pDone.battleTotal} 用时 ${round2(win.ms / 1000)}s`,
    );
    log(
      win.cardInNonComplete.length === 0 && win.cardPhases.includes('COMPLETE'),
      'C2 奖励卡只在 COMPLETE 出现：全程所有其它相位都没有它（含 IDLE/EVENT/BATTLE/RESULT/CHOICE）',
      `出现相位=${win.cardPhases.join(',')} · 非 COMPLETE 违规=${win.cardInNonComplete.length}`,
    );

    /* 必改 3：从「测试结算」变成「产品结算」——最终 Day / 耐久 / Build 都还在，**多**一张「本局获得」 */
    const rc = pDone.rewardCard;
    log(
      pDone.day === 7 &&
        pDone.battle.durabilityPercent > 0 &&
        pDone.buildLabels.length === 2 &&
        !!rc &&
        rc.defId === REWARD_ID &&
        rc.name === REWARD_NAME &&
        rc.energy === 45 &&
        rc.label === '领取并返回' &&
        rc.hasSprite === false,
      'C3 RUN COMPLETE = 最终 DAY + 最终耐久 + 最终 Build + 「本局获得」一件**真实已有部件**',
      `DAY ${pDone.day} · 耐久 ${pDone.battle.durabilityPercent}% · Build=${pDone.buildLabels.join('+')} · 获得=${rc ? `${rc.name}(${rc.defId}, E${rc.energy})` : 'n/a'}`,
    );
    log(
      rc && rc.href === claimHref,
      'C4 奖励卡的出口 = 产品侧给的领奖地址（Lab 侧不含任何产品 URL 字面量）',
      `href=${rc ? rc.href : 'n/a'}`,
    );
    log(
      pDone.actionLabel === '领取并返回' && pDone.actionEnabled === true && pDone.exitHref === claimHref,
      'C5 完成态主动作文案 =「领取并返回」（动作，不是状态描述），且探针出口与卡片同源',
      `label=${pDone.actionLabel} enabled=${pDone.actionEnabled} exit=${pDone.exitHref}`,
    );

    /* 像素取证：卡片真的画在画布上（不是只有探针字段） */
    const cardRect = pDone.rewardCardRect;
    const cardBgPx = cardRect ? await countColorInRect(page, cardRect, CARD_BG) : 0;
    const iconFramePx = cardRect ? await countColorInRect(page, cardRect, ICON_FRAME_BG) : 0;
    const iconGlyphPx = cardRect ? await countColorInRect(page, cardRect, ICON_GLYPH) : 0;
    log(
      !!cardRect &&
        cardRect.w === 362 &&
        cardRect.h === 104 &&
        cardBgPx > 20000 &&
        iconFramePx > 3000 &&
        iconGlyphPx > 500,
      'C6「本局获得」卡片真的画出来（真实 getImageData：卡底成片 + 图标框 + 真实 Collider 外接框）',
      `rect=${cardRect ? `${cardRect.x},${cardRect.y} ${cardRect.w}×${cardRect.h}` : 'n/a'} cardBg=${cardBgPx} iconFrame=${iconFramePx} glyph=${iconGlyphPx}`,
    );

    /* ------------------------------------------- 4) 点「领取并返回」→ 真实领奖 */
    await Promise.all([
      page.waitForURL(/home\.html/, { timeout: 20000 }).catch(() => {}),
      clickRect(page, pDone.actionRect),
    ]);
    await waitHomeReady(page);
    const urlAfterClaim = await page.evaluate(() => location.pathname + location.search);
    const home1 = await probeHome(page);
    const stored1 = await storageDump(page);

    log(
      urlAfterClaim === `/home.html?run=${token}&reward=${REWARD_ID}`,
      'D1「领取并返回」= 真实整页导航回正式首页，并把本局 token / 奖励 id 带回产品侧',
      `url=${urlAfterClaim}`,
    );
    log(
      home1.claim !== null &&
        home1.claim.ok === true &&
        home1.claim.defId === REWARD_ID &&
        home1.claim.name === REWARD_NAME &&
        home1.claim.countAfter === 1,
      'D2 产品侧 Profile Repository 完成入库（页面只展示 Repository 的真实结果）',
      `ok=${home1.claim ? home1.claim.ok : 'n/a'} def=${home1.claim ? home1.claim.defId : 'n/a'} count=${home1.claim ? home1.claim.countAfter : 'n/a'}`,
    );
    const claimDom = await page.evaluate(() => {
      const n = document.querySelector('[data-ph-claim]');
      return n ? { state: n.getAttribute('data-ph-claim'), def: n.getAttribute('data-ph-claim-def'), text: n.textContent } : null;
    });
    log(
      !!claimDom && claimDom.state === 'ok' && claimDom.def === REWARD_ID && claimDom.text.includes(REWARD_NAME),
      'D3 首页可见地告诉玩家拿到了什么（真实 DOM 提示，不是静默入库）',
      claimDom ? `[${claimDom.state}] ${claimDom.text}` : 'n/a',
    );
    log(
      invCount(stored1, REWARD_ID) === 1,
      'D4 **独立取证**：正式库存 `ownedParts.v2` 里这件真的 +1 了（不是页面内存）',
      `${REWARD_ID}.one=${invCount(stored1, REWARD_ID)}（领奖前 ${invCount(stored0, REWARD_ID)}）`,
    );
    log(
      ledgerTokens(stored1).length === 1 && ledgerTokens(stored1)[0] === token,
      'D5 **独立取证**：领奖账本记录了本局 token（reward claim 状态真实存在）',
      `grantedRunIds=${JSON.stringify(ledgerTokens(stored1))}`,
    );

    /* ------------------------------------------- 5) 重复领取 → 绝不重复发奖 */
    await page.goto(`${URL_BASE}/home.html?run=${token}&reward=${REWARD_ID}`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const home2 = await probeHome(page);
    const stored2 = await storageDump(page);
    const dupDom = await page.evaluate(() => {
      const n = document.querySelector('[data-ph-claim]');
      return n ? { state: n.getAttribute('data-ph-claim'), text: n.textContent } : null;
    });
    log(
      home2.claim !== null && home2.claim.ok === false && home2.claim.reason === 'already-claimed',
      'E1 重复打开同一领奖地址 → Repository 判「已领取」（不是静默成功）',
      `ok=${home2.claim ? home2.claim.ok : 'n/a'} reason=${home2.claim ? home2.claim.reason : 'n/a'}`,
    );
    log(
      !!dupDom && dupDom.state === 'duplicate' && home2.claimedRunCount === 1,
      'E2 页面如实说「已领取过」，账本仍只有 1 条（没有第二次记录）',
      dupDom ? `[${dupDom.state}] ${dupDom.text} · 账本=${home2.claimedRunCount}` : 'n/a',
    );
    log(
      invCount(stored2, REWARD_ID) === 1,
      'E3 库存没有 +2：重复领取不会重复发奖（必改 4）',
      `${REWARD_ID}.one=${invCount(stored2, REWARD_ID)}（仍 1）`,
    );

    /* ------------------------ 6) 返回首页 → Garage 真的看到刚获得的新部件 */
    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const home3 = await probeHome(page);
    log(
      home3.claim === null && home3.weaponIds.includes(REWARD_ID) && home3.claimedRunCount === 1,
      'F1 干净打开首页：不再有领奖请求，但新部件**已经在库存里**（来自持久化，不是这次导航带的）',
      `weapons=${home3.weaponIds.join(',')} claimed=${home3.claimedRunCount}`,
    );

    await clickSelector(page, '[data-ph-action="open-garage"]');
    const garage1 = await probeHome(page);
    const laserCard = await page.evaluate(() => {
      const n = document.querySelector('[data-ph-weapon="laser"]');
      return n ? { text: n.textContent, equipped: n.getAttribute('data-ph-equipped') } : null;
    });
    const energyBefore = garage1.energy;
    log(
      garage1.view === 'garage' && !!laserCard && laserCard.text.includes(REWARD_NAME),
      'F2 调整战车：新部件**出现了**，与已有部件同一份 Inventory 数据（同一张卡片组件）',
      laserCard ? `[laser] ${laserCard.text}（equipped=${laserCard.equipped}）` : 'n/a',
    );

    await clickSelector(page, '[data-ph-weapon="laser"]');
    const garage2 = await probeHome(page);
    log(
      garage2.selectedWeaponId === REWARD_ID && garage2.equipEnabled === true,
      'F3 点击新部件 → 明确选中，且「装备」可点（它是一件能装上的东西，不是废品）',
      `selected=${garage2.selectedWeaponId} equipEnabled=${garage2.equipEnabled}`,
    );

    await clickSelector(page, '[data-ph-action="equip"]');
    const garage3 = await probeHome(page);
    const stored3 = await storageDump(page);
    log(
      garage3.equippedWeaponId === REWARD_ID && garage3.lastEquip && garage3.lastEquip.ok === true,
      'F4 装上成功：首页/车库的当前主武器变成刚获得的那件',
      `equipped=${garage3.equippedWeaponId} lastEquip=${garage3.lastEquip ? JSON.stringify(garage3.lastEquip) : 'n/a'}`,
    );
    log(
      garage3.energy === energyBefore + 15 && garage3.energyCapacity === garage1.energyCapacity,
      'F5「装上它真的不一样」：能量读数按两件正式武器的差额真实变化（不写死显示值）',
      `能量 ${energyBefore} → ${garage3.energy} / 容量 ${garage3.energyCapacity}`,
    );
    log(
      storedWeaponSlot(stored3) === REWARD_ID,
      'F6 **独立取证**：正式玩家 Build 存档的武器槽 = 刚获得的部件（唯一数据源，不是页面状态）',
      `${WEAPON_SLOT}=${storedWeaponSlot(stored3)}`,
    );

    /* ------------------------------------------------- 7) Reload 后状态保持 */
    await page.reload({ waitUntil: 'load' });
    await waitHomeReady(page);
    const afterReload = await probeHome(page);
    const stored4 = await storageDump(page);
    log(
      afterReload.equippedWeaponId === REWARD_ID &&
        afterReload.weaponIds.includes(REWARD_ID) &&
        afterReload.claimedRunCount === 1 &&
        invCount(stored4, REWARD_ID) === 1,
      'G1 整页 reload 后：新部件在库存里、还装着它、账本仍 1 条（状态来自真实持久化）',
      `equipped=${afterReload.equippedWeaponId} weapons=${afterReload.weaponIds.length} claimed=${afterReload.claimedRunCount} ${REWARD_ID}.one=${invCount(stored4, REWARD_ID)}`,
    );

    /* --------------------- 8) FAILED 对照：同一条机器、只差一次点击 → 不发奖 */
    const failPage = await ctx.newPage();
    const failErrors = [];
    failPage.on('pageerror', (e) => failErrors.push(String(e)));
    /*
      ⚠️ PRODUCT-LOOP-R1-D 修正：本段原先**零参数**打开 `run-page.html` —— 那一局既没有领奖
         上下文、也没有失败回程地址。R1-D 之后失败出口地址由**产品侧**给全（Lab 侧不硬编码
         任何产品 URL，`RP-25b` 机器钉死）⇒ 零参数下失败结算**照常呈现但没有出口按钮**，
         而「失败玩家必须能主动回主界面」正是本 Queue 的 P0 ⇒ 本段必须按**产品真实上下文**打开。

         参数 = 产品首页「开始冒险」链接里那四个（`run` / `reward` / `back` / `home`），
         即**领奖上下文完全齐备**下再来一次失败 —— 这比原来更强：
         「即使领奖地址就摆在同一个页面上，失败也拿不到它」（必改 5 的结构性反证）。
         ⚠️ 刻意**不带** `equipped`：保留 demo 装载 ⇒ `LOSE_POLICY` 的确定性（耐久归零路线）
         与 R1-C 逐字一致，本段只变「产品上下文」这一个自变量。
    */
    const failQuery = new URLSearchParams({
      run: token,
      reward: REWARD_ID,
      back: claimHref,
      home: homeHref,
    });
    await failPage.goto(`${URL_BASE}/run-page.html?${failQuery.toString()}`, { waitUntil: 'load' });
    await waitRunReady(failPage);
    const lose = await driveRunToEnd(failPage, LOSE_POLICY, '失败路线');
    const pFail = lose.probe;
    log(
      pFail.phase === 'FAILED' && pFail.failed === true && pFail.complete === false,
      'H1 同路线改选「继续改装」→ 终局耐久归零 → RUN FAILED（真实浏览器对照，不是构造状态）',
      `phase=${pFail.phase} failed=${pFail.failed} 用时 ${round2(lose.ms / 1000)}s`,
    );
    log(
      pFail.rewardCard === null &&
        pFail.rewardCardRect === null &&
        pFail.exitHref === homeHref &&
        pFail.exitHref !== claimHref,
      'H2 领奖上下文**齐备**（run/reward/back 都在同一条 URL 上）时，FAILED 依然拿不到奖励出口：卡片 / 矩形为 null，出口是**纯首页**而不是领奖地址（必改 5）',
      `rewardCard=${pFail.rewardCard} rewardCardRect=${pFail.rewardCardRect} exit=${pFail.exitHref}（领奖地址=${claimHref}）`,
    );
    log(
      pFail.actionEnabled === true &&
        pFail.actionLabel === '返回主界面' &&
        pFail.actionLabel !== '领取并返回' &&
        pFail.actionLabel !== '重新开始冒险',
      'H3 FAILED 的主动作 =「返回主界面」（可点的真实出口，不是禁用死按钮），既不是领奖、也不是「重新开始冒险」（必改 3 / 必改 6）',
      `label=${pFail.actionLabel} enabled=${pFail.actionEnabled} exit=${pFail.exitHref}`,
    );
    /*
      像素 A/B（**判据已随 R1-D 收紧**）：
        旧判据是「同一块矩形里 COMPLETE 有成片卡片底色、FAILED 几乎没有」——它成立的前提是
        「失败页面在这块矩形上什么都不画」。R1-D 之后**失败也有结算面板**（必改 3）且与奖励卡
        互斥复用同一槽位 ⇒ 底色两边都有，旧判据已失效（这正是它 FAIL 的原因）。
        新判据改为数**奖励卡专属图形**：图标框底 `pageBg`（`runPage.ts` 注释：卡片内唯一出现处）
        与图标本体 `wheelRim` —— COMPLETE 成片，FAILED 必须为 **0**。
        这比旧判据更强：不再只说「没有那么大片底色」，而是「那块矩形里**没有奖励卡的任何图形**」。
    */
    const failCardBgPx = cardRect ? await countColorInRect(failPage, cardRect, CARD_BG) : -1;
    const failIconFramePx = cardRect ? await countColorInRect(failPage, cardRect, ICON_FRAME_BG) : -1;
    const failIconGlyphPx = cardRect ? await countColorInRect(failPage, cardRect, ICON_GLYPH) : -1;
    log(
      cardBgPx > 20000 &&
        iconFramePx > 3000 &&
        iconGlyphPx > 500 &&
        failIconFramePx === 0 &&
        failIconGlyphPx === 0 &&
        failCardBgPx > 20000,
      'H4 像素 A/B：同一块矩形上 COMPLETE 有奖励卡专属图形（图标框 + Collider 本体），FAILED **一个像素都没有**（失败那块画的是结算面板，不是发奖）',
      `cardBg: COMPLETE=${cardBgPx} vs FAILED=${failCardBgPx} · 图标框: ${iconFramePx} vs ${failIconFramePx} · 图标本体: ${iconGlyphPx} vs ${failIconGlyphPx}`,
    );
    const stored5 = await storageDump(failPage);
    log(
      invCount(stored5, REWARD_ID) === 1 && ledgerTokens(stored5).length === 1,
      'H5 失败一局之后：库存与账本**一个数字都没动**（失败不补偿、不发奖）',
      `${REWARD_ID}.one=${invCount(stored5, REWARD_ID)} 账本=${ledgerTokens(stored5).length}`,
    );
    log(failErrors.length === 0, 'H6 失败路线全程零运行时报错', failErrors.slice(0, 2).join(' | ') || 'none');
    await failPage.close();

    log(pageErrors.length === 0, 'I1 全流程零运行时报错', pageErrors.slice(0, 2).join(' | ') || 'none');
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
