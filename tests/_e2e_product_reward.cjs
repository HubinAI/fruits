/**
 * PRODUCT-LOOP-R2-A-REWARD-STACK-INVENTORY｜
 * 「打完一局 → **三选一** → 选中那件进入局外库存 → 数量累积 → 回车库看到」的**浏览器真实闭环 smoke**。
 *
 * 手段（与 `_e2e_product_home.cjs` 同一纪律，全部是真实行为取证）：
 *   - 真实浏览器（playwright-core / msedge），打开独立产物 `dist-portrait-lab/`；
 *   - **真实鼠标点击**（`page.mouse.click`，逻辑坐标 → 画布真实 CSS 矩形换算；不 evaluate 直调）；
 *   - **真实整页导航**（`<a href>` / `location.assign` 都由浏览器执行，不做 evaluate 跳转）；
 *   - **真实 localStorage 读取**（证明入库写进的是**正式存档 key**，而不是页面内存）；
 *   - **真实 `getImageData` 像素取证**（证明候选卡真的画在画布上，不是只有探针字段）；
 *   - 只读诊断句柄 `window.__PRODUCTHOME__` / `window.__RUNPAGE__`（只读，不能借它改状态）。
 *
 * 覆盖 R2-A 技术验收 1~8（第 9 条 = tsc / targeted / build 在门禁里跑）：
 *   ① fresh profile cannon = ★1 4/5      → A2 / A3
 *   ② COMPLETE 出现 3 个真实 Weapon 奖励 → C3 / C6
 *   ③ 选择 cannon 后变成 5/5             → D4（第一局）
 *   ④ 选择其它 Weapon 只增加对应 stack   → H4（第二局选 hammer：1 → 2，cannon 仍 5）
 *   ⑤ 同一奖励只能领取一次               → E1/E2/E3（同 token **换一件**也领不到）
 *   ⑥ FAILED 数量完全不变                → I2 / I5
 *   ⑦ old Profile migration 不丢数据     → 由 `tests/playerGrowthR2A.test.ts` 的 PG-07~PG-10 离线钉死
 *   ⑧ Equipped 仍指向有效库存实例         → 同上（PG-11~PG-14）
 *
 * 叠加 PRODUCT-LOOP-R2-B 技术验收（K 段，放在所有跑局断言**之后** —— ★2 会改变 Build 能量，
 * 插在中间会让「确定性通关路线」不再确定性）：
 *   ① 不满 5 件不能合成   → K2（DOM 里连按钮都不存在）
 *   ② 5/5 可以合成        → K1（「可合成」徽标 + 真实按钮）
 *   ③ 5×★1 → 1×★2        → K3 / K4（★1 卡消失、★2 是新卡）
 *   ⑥ 装备被合空自动升星    → K5（页面 + **正式 Build 存档**双取证）
 *   ⑦ 无连锁升星（必改 5）  → K7（★2 只有 1 件 ⇒ 没有★3、没有可再点的按钮）
 *   ⑧ reload 后三者保持     → K8 / K9（磁盘 ★1=0 / ★2=1 / 装的还是 ★2）
 *   ⚠️ 「不同 Weapon / 不同 star 不能混合」是**规则**层面的（④⑤）→ `tests/productFusionR2B.test.ts`
 *      的 FB-05 / FB-06 用库存对账钉死；E2E 侧无法在不造第二份满 stack 的前提下取证。
 *
 * ⚠️ 两条路线都是**确定性**的（`RunBattleRuntime` 无 RNG，`portraitRunPage.test.ts` 的
 *    `FROZEN_REPAIR` / `FROZEN_UPGRADE` 已冻结）：
 *      完成：一层 `twinCannon` + 耐久事件选「维修」+ 二层 `tripleLoad` → 终局 779 耐久 → COMPLETE
 *        （⚠️ PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY：玩家侧基线 80 → 120 后
 *         终局耐久 602 → 779，与 `portraitRunPage.test.ts` 的 `FROZEN_REPAIR` 同源）
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
 * 终点候选（与 `src/product/runReward.ts` 的 `REWARD_CHOICE_IDS` 同值）。
 * ⚠️ 全是**玩家一开始就拥有**的正式 Weapon ⇒ 本 Queue 不发新内容，
 *    奖励的价值体现在**数量**上（4 → 5），而不是「从无到有」。
 *
 * ⚠️ PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY（必改 2）：从 `['cannon','spear','hammer']`
 *    **收窄为 `['cannon']`**（真源 `REWARD_CHOICE_IDS` 同值）—— 当前只有它同时具备
 *    ① 完整 Run compatibility、② 已真人验证的 Run Buff、③ 永久 Star 成长链。
 *    发 spear / hammer 等于奖励玩家「这一局用不上的东西」（真人反馈 ③）。
 *    ⇒ 本文件里所有「候选条数」的断言随之改为**字面 1**（不是「≥1」）。
 */
const CHOICE_IDS = ['cannon'];
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

/*
  ══════════════════════════════════════════════════════════════════════════════
  PRODUCT-LOOP-P0-SETTLEMENT-CTA-LATENCY（Queue 必改 7）｜结算 CTA 两条守门的数据源
  ══════════════════════════════════════════════════════════════════════════════
*/

/**
 * 「结算 CTA → 首页」的墙钟**宽上界**。
 * ⚠️ 这不是性能基线，是**量级哨兵**：拦住「有人又往结算链里塞一个固定数秒等待」。
 *    实测（产物版 3 次中位数）：点击→导航发起 ≈ 4.7 ms、导航→首页可见 = 52 ms，
 *    合计 ≈ 57 ms ⇒ 4000 ms 有 ~70× 余量，机器抖动 / CI 负载都不可能把它顶穿。
 * ⚠️ 刻意不设严格数字（不拿它考核机器），只拦结构性回归。
 */
const CTA_HOME_BUDGET_MS = 4000;

/**
 * `COLORS.actionFillOff`（`#232b38`）—— 主动作按钮**禁用态**填充色。
 * ⚠️ 在 `#run-canvas` 内**独占**：全仓同色只在**别的画布**出现
 *    （`src/main.ts` / `src/ui/canvasPlayerUIHost.ts` 的 HUD 能量条）
 *    ⇒ 在 Run 画布的动作按钮矩形里数到它，只可能来自那条被画出来的按钮本身。
 */
const ACTION_FILL_OFF = [0x23, 0x2b, 0x38];
/** `COLORS.actionFill`（`#28405f`）—— 主动作按钮**可用态**填充色（全仓独占）。 */
const ACTION_FILL_ON = [0x28, 0x40, 0x5f];

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

/**
 * 从真实 storage dump 里读某个 `(defId, star)` stack 的副本数。
 *
 * ⚠️ 星级 → 字段名的映射在这里**独立写一份**（不从 `core/partInventory.ts` import）：
 *    这条断言的目的是「**绕过产品代码**去核对磁盘」，引用被测模块的映射就等于用被告的证词。
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

/** 从出发链接里取出产品侧给的那份候选载荷（地址真源只有产品侧一个）。 */
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
function garageCard(page, defId, star = null) {
  return page.evaluate(
    ({ id, s }) => {
      /*
        ⚠️ 一个 defId 现在可能对应**多张卡**（★1 的炮与 ★2 的炮是两个 stack ⇒ 两张卡）。
        默认取第一张（★1 优先，`weaponEntries` 按星级升序遍历）；需要高星卡时显式传 star。
      */
      const all = [...document.querySelectorAll(`[data-ph-weapon="${id}"]`)];
      const n = s === null ? all[0] : all.find((x) => x.getAttribute('data-ph-star') === String(s));
      if (!n) return null;
      return {
        text: n.textContent,
        star: n.getAttribute('data-ph-star'),
        count: n.getAttribute('data-ph-count'),
        stackText: n.getAttribute('data-ph-stack-text'),
        threshold: n.getAttribute('data-ph-stack-threshold'),
        equipped: n.getAttribute('data-ph-equipped'),
        fusable: n.getAttribute('data-ph-fusable'),
        maxStar: n.getAttribute('data-ph-maxstar'),
        cards: all.length,
      };
    },
    { id: defId, s: star },
  );
}

/** 读某张卡的「合成」按钮是否真实存在（真实 DOM，不是探针自述）。 */
function garageFuseButton(page, defId, star) {
  return page.evaluate(
    ({ id, s }) => {
      const b = document.querySelector(`[data-ph-action="fuse"][data-ph-fuse-def="${id}"][data-ph-fuse-star="${s}"]`);
      return b ? { text: b.textContent, disabled: b.disabled === true } : null;
    },
    { id: defId, s: star },
  );
}

/**
 * 把一局 Run 从 IDLE 驱到终态（COMPLETE / FAILED）。
 *
 * 全部用**真实鼠标点击**：耐久事件按 id 选、强化三选一按池种类选、其余推进一步。
 * 同时滚动记录两条不变量：
 *   · `choicesInNonComplete` —— 在**非 COMPLETE** 相位上出现过候选（必须恒为空）；
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
    A/B 基准矩形一律取**最后一张卡**（不写死下标）。
    ⚠️ 必改 2 之前候选是 3 张，`rects[2]` = 最下面那张，恰好完整落在失败结算面板的槽位内；
       现在候选只有 1 张，而它**仍然**画在同一个槽位上（`runRewardChoiceRects(N)` 对 N=1
       保留同一几何）⇒「取最后一张」在新旧契约下指向**同一个矩形**，A/B 对照的意义不变。
    ⚠️ 顺手把「候选条数变了 ⇒ 下标越界」这道坑变成一句人话：上一轮它表现为
       `page.evaluate: TypeError: Cannot read properties of undefined (reading 'x')`，
       崩在浏览器上下文里极难定位。
  */
  const rects = pDone.rewardChoiceRects;
  if (rects.length === 0) {
    throw new Error(`${label}: COMPLETE 相位上没有任何候选矩形（探针 rewardChoiceRects 为空）`);
  }
  const abRect = rects[rects.length - 1];
  const pixel = { cardBg: 0, iconFrame: 0, iconGlyph: 0 };
  for (const r of rects) {
    pixel.cardBg += await countColorInRect(page, r, CARD_BG);
    pixel.iconFrame += await countColorInRect(page, r, ICON_FRAME_BG);
    pixel.iconGlyph += await countColorInRect(page, r, ICON_GLYPH);
  }
  pixel.abCardBg = await countColorInRect(page, abRect, CARD_BG);
  pixel.abIconFrame = await countColorInRect(page, abRect, ICON_FRAME_BG);
  pixel.abIconGlyph = await countColorInRect(page, abRect, ICON_GLYPH);

  /*
    PRODUCT-LOOP-P0-SETTLEMENT-CTA-LATENCY（必改 7）｜**死按钮像素取证**（必须在点之前采）。
    COMPLETE + 有候选卡时，底栏那条「完成本次冒险」按钮**不得**被画出来：
    它的命中分支不可达（`onPointerDown` 对有候选的终态直接 `return`）
    ⇒ 画出来就是一个「点了永远没有反馈」的假入口 = 真人录屏里被读成「卡死」的观感来源。
    ⚠️ 真实 `getImageData`（不走命中区 / 探针捷径）：分别数禁用态色与可用态色。
       两者都为 0 ⇒ 这个矩形里确实什么都没画。
  */
  const deadBtnOff = await countColorInRect(page, pDone.actionRect, ACTION_FILL_OFF);
  const deadBtnOn = await countColorInRect(page, pDone.actionRect, ACTION_FILL_ON);

  // **真实鼠标点击**选中的那张卡（坐标来自探针里与绘制同源的矩形）
  const cardRect = pDone.rewardChoiceRects[pickIndex];
  /*
    ⚠️ 刻意**不**用 `Promise.all` 把点击与导航绑在一起量：这里要在「按下」与
       「URL 真的变成首页」之间取一段独立的墙钟 —— 覆盖
       事件派发 + 处理中置位 + 两帧可见反馈 + `dispose()` 清理 + 整页导航 + 首页装载。
    ⚠️ `waitForURL` 仍带 catch：超时不让整段挂死，断言侧会因为我们自己的上界而失败。
  */
  const navT0 = Date.now();
  await Promise.all([
    page.waitForURL(/home\.html/, { timeout: 20000 }).catch(() => {}),
    clickRect(page, cardRect),
  ]);
  const navMs = Date.now() - navT0;
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
    navMs,
    deadBtnOff,
    deadBtnOn,
  };
}

async function main() {
  console.log('=== PRODUCT-LOOP-R2-A｜候选 → 数量累积 → 回车库 产品闭环 smoke ===\n');

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
      'A2 **新账号的成长起点**（验收 ①）：cannon ★1 4/5，另外两件候选各 1/5（种子只发这一次）',
      `fresh=${home0.growth.fresh} seeded=${home0.growth.seeded} cannon=${invCount(stored0, 'cannon')} spear=${invCount(stored0, 'spear')} hammer=${invCount(stored0, 'hammer')}`,
    );
    log(
      home0.weapons.length === 3 &&
        home0.weapons.every((w) => w.star === 1 && w.threshold === FUSE_STACK) &&
        home0.weapons.find((w) => w.defId === 'cannon').count === 4 &&
        home0.weapons.find((w) => w.defId === 'cannon').stackText === '4/5' &&
        home0.weapons.every((w) => w.reachesThreshold === false) &&
        home0.weapons.every((w) => w.fusable === false) &&
        home0.weapons.every((w) => w.maxStar === false),
      'A3 Garage 读数与库存同源：三张卡都是 ★1、分母 = 满 stack 阈值、次数 4/1/1（未满 ⇒ 不可合成）',
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
        payload0.choices.length === 1 &&
        payload0.choices.every((c, i) => c.defId === CHOICE_IDS[i]) &&
        payload0.choices.every((c, i) => c.href === expectedClaims[i]),
      'A4「开始冒险」= 带本局 token + **一整份候选载荷**（候选池 1 条领奖地址）的同产物链接；地址里**没有**裸 `reward=`',
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
      'A5 载荷里的数量读数 = 出发那一刻的真实库存（4 / 1 / 1，逐件对账）；候选共用同一个本局 token ⇒ 只能领一次',
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

    /* 必改 2＋4：终点是**真实候选**（名称 / ★1 / 当前数量 / 领取后数量预览 / 成长口径那一行） */
    const rc = pDone.rewardChoices;
    log(
      pDone.day === 7 &&
        pDone.battle.durabilityPercent > 0 &&
        pDone.buildLabels.length === 2 &&
        rc.length === 1 &&
        rc.every((c, i) => c.defId === CHOICE_IDS[i] && c.name === NAMES[CHOICE_IDS[i]]) &&
        rc.every((c, i) => c.star === 1 && c.energy > 0 && c.hasSprite === HAS_SPRITE[CHOICE_IDS[i]]) &&
        rc[0].countBefore === 4 &&
        rc[0].countAfter === 5 &&
        rc[0].previewText === '4 → 5' &&
        rc[0].reachesThreshold === true &&
        /*
          ⚠️ 本条是 PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY（必改 2）**新增**的守门断言：
          结算卡第二行从「库存多了一个」改成**成长口径**（`当前 4/5 → 领取后 5/5`），
          对应 `RunRewardChoiceView.progressText`（`runPage.ts` 的探针同源字段，非页面自算）。
          它钉的是「玩家在这一屏就能看到自己离升星还差多少」这件事**真的画出来了**。
        */
        rc[0].progressText === `当前 4/${FUSE_STACK} → 领取后 5/${FUSE_STACK}` &&
        rc[0].stackLimit === FUSE_STACK,
      'C3 RUN COMPLETE = 最终 DAY + 最终耐久 + 最终 Build + **真实 Weapon 候选卡**（名称 / ★1 / 数量 / 领取后预览 / 成长口径一行）',
      `DAY ${pDone.day} · 耐久 ${pDone.battle.durabilityPercent}% · Build=${pDone.buildLabels.join('+')} · 候选=${rc.map((c) => `${c.name}★${c.star} ${c.previewText}${c.reachesThreshold ? '(满)' : ''} 「${c.progressText}」`).join(' | ')}`,
    );
    log(
      rc.every((c, i) => c.href === expectedClaims[i]) && pDone.rewardChoicesDropped === 0,
      'C4 候选卡的出口 = 产品侧给的**各自**领奖地址（Lab 侧不含任何产品 URL 字面量），且载荷全部合法（丢弃 0 条）',
      `dropped=${pDone.rewardChoicesDropped} hrefs=${rc.map((c) => c.href.replace('./home.html?', '')).join(' ')}`,
    );
    log(
      pDone.exitHref === null &&
        pDone.actionEnabled === false &&
        pDone.actionLabel !== '领取并返回',
      'C5 出口**在卡片上**：底栏动作不可用、也没有「领取并返回」（候选池不存在「默认那件」）',
      `label=${pDone.actionLabel} enabled=${pDone.actionEnabled} exit=${pDone.exitHref}`,
    );

    /*
      像素取证：候选卡真的画在画布上（不是只有探针字段）。
      ⚠️ 读数是在 `playOneRunAndClaim` 里、**点那张卡之前**采的：点中即整页导航回首页
      ⇒ `#run-canvas` 不复存在（`getImageData` 拿不到画布）。这是真实踩过的坑。
    */
    const rects = r1.rects;
    const cardBgPx = r1.pixel.cardBg;
    const iconFramePx = r1.pixel.iconFrame;
    const iconGlyphPx = r1.pixel.iconGlyph;
    /*
      ⚠️ A/B 基准矩形 = **最后一张卡**（必改 2 之前它恰好是 `rects[2]`，即最下面那张）：
      它的矩形（y 302..370）完整落在失败结算面板的槽位（`runFailPanelRect()` 的 y 266..370）
      内部 ⇒ 同一个矩形可以拿来做 COMPLETE / FAILED 对照。
      候选收窄为 1 张后，这一张**仍**画在同一个槽位上 ⇒ 对照关系一字未变。
    */
    const abRect = rects[rects.length - 1];
    const abCardBgPx = r1.pixel.abCardBg;
    const abIconFramePx = r1.pixel.abIconFrame;
    const abIconGlyphPx = r1.pixel.abIconGlyph;
    /*
      阈值来源（不是拍的，**按实际卡数重推**）：
      候选 1 张 ⇒ 矩形面积 = 1 × 362 × 68 = 24616 px²。
      卡底之外的像素只有三类：① 2px 描边（cardEdge）；② 图标框内部（pageBg 实心填充）；
      ③ 文字字形（名称 / ★ / 数量 / defId）。实测卡底 ≈ 19664（≈ 79.9% 面积）
      ⇒ 取 **18000（≈ 73.1%）** 作为「成片」的下界：既排掉「只画了个边框」，
      也给字体渲染 / 亚像素抗锯齿留足余量（不在阈值上做无意义的灵敏度竞赛）。
      图标框 / 字形两项是**逐卡**入账的 ⇒ 按每卡折算（旧值 2000 / 600 是 3 张卡的合计口径，
      单卡下界取 1/3 = 600 / 180）。
    */
    log(
      rects.length === 1 &&
        rects.every((r) => r.w === 362 && r.h === 68) &&
        cardBgPx > 18000 &&
        iconFramePx > 600 &&
        iconGlyphPx > 180,
      'C6 候选卡真的画出来（真实 getImageData：卡底成片 + 图标框 + 真实 Collider 外接框）',
      `rects=${rects.map((r) => `${r.x},${r.y} ${r.w}×${r.h}`).join(' | ')} cardBg=${cardBgPx} iconFrame=${iconFramePx} glyph=${iconGlyphPx}`,
    );

    /*
      PRODUCT-LOOP-P0-SETTLEMENT-CTA-LATENCY（必改 7）｜**死按钮不得回归**。
      取值在 `playOneRunAndClaim` 内、**点那张卡之前**（点中即整页导航 ⇒ `#run-canvas` 消失）。
      ⚠️ 这是真人录屏 P0 的**结构根因**守卫：`C5` 已经断言「底栏动作不可用」
        （探针口径），但探针那条口径在修复前**就是**不可用的 —— 屏幕上却依然画着按钮。
        本断言补上「**真的没画**」这一层，两者合起来才等价于「不存在假入口」。
      ⚠️ 真实 `getImageData`：禁用态色与可用态色**都**必须为 0 ——
        既不能有「画着却点不动」的死按钮，也不能有「画着却点不动」的活按钮。
    */
    log(
      r1.deadBtnOff === 0 && r1.deadBtnOn === 0,
      'C7 **必改 7**｜COMPLETE+候选卡时底栏按钮**没有被画出来**（真实 getImageData 双色取证；死按钮不得回归）',
      `actionRect=${JSON.stringify(pDone.actionRect)} 禁用态像素=${r1.deadBtnOff} 可用态像素=${r1.deadBtnOn}`,
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
      invCount(r1.storedBefore, 'cannon') === 4 &&
        invCount(r1.storedAfter, 'cannon') === 5 &&
        invCount(r1.storedAfter, 'spear') === 1 &&
        invCount(r1.storedAfter, 'hammer') === 1 &&
        ledgerTokens(r1.storedAfter).length === 1 &&
        ledgerTokens(r1.storedAfter)[0] === token0,
      'D3 **独立取证**（读浏览器真实 localStorage）：只有 cannon +1，另外两件一个数字都没动；账本记下本局 token',
      `cannon ${invCount(r1.storedBefore, 'cannon')}→${invCount(r1.storedAfter, 'cannon')} · spear ${invCount(r1.storedAfter, 'spear')} · hammer ${invCount(r1.storedAfter, 'hammer')} · 账本=${JSON.stringify(ledgerTokens(r1.storedAfter))}`,
    );
    log(
      r1.homeAfter.weapons.find((w) => w.defId === 'cannon').stackText === '5/5' &&
        r1.homeAfter.weapons.find((w) => w.defId === 'cannon').reachesThreshold === true &&
        // R2-B：满 stack 同时意味着**进入可合成态**（能否真的合，由末尾 K 段真实点击验证）
        r1.homeAfter.weapons.find((w) => w.defId === 'cannon').fusable === true &&
        r1.homeAfter.weapons.find((w) => w.defId === 'cannon').maxStar === false,
      'D4 领奖后的首页读数：cannon 达到满 stack ⇒ 显示 `5/5` 且 `fusable=true`（★2 未到上限）',
      `cannon stackText=${r1.homeAfter.weapons.find((w) => w.defId === 'cannon').stackText}`,
    );
    /*
      PRODUCT-LOOP-P0-SETTLEMENT-CTA-LATENCY（必改 7）｜**时延守门**。
      真实鼠标点击那张候选卡 → URL 真的变成首页，全程墙钟必须 < `CTA_HOME_BUDGET_MS`。
      ⚠️ 它拦的是**量级**回归（把「固定数秒等待」塞回来），不是性能基线：
        实测 ≈ 57 ms vs 上界 4000 ms ⇒ ~70× 余量，机器抖动不会误伤。
    */
    log(
      r1.navMs < CTA_HOME_BUDGET_MS,
      'D5 **必改 7**｜结算 CTA → 首页的墙钟时延在宽上界内（防「固定数秒静止」回归）',
      `第一局 navMs=${r1.navMs} ms（上界 ${CTA_HOME_BUDGET_MS} ms）`,
    );

    /*
      ⚠️ D4b / D4c 是本 Queue 补的**两条守门断言** —— 必改 5（首页一行最小成长状态）与
      必改 6（领奖之后的下一步引导）此前**只有探针字段、整个门禁里没有任何一条 E2E 校验过**。
      取证走**真实 DOM**（不只是探针自述）+ 探针双证；文案逐字写死，防「引导被摘掉 /
      被改成看不懂的话」。同时把「页面**不代劳**合成」这条纪律一并钉住：此刻 ★2 必须不存在。
    */
    const growthDom = await page.evaluate(() => {
      const row = document.querySelector('[data-ph-home-growth]');
      const readyLabel = document.querySelector('.ph-home-growth-ready');
      const hint = document.querySelector('[data-ph-claim-hint]');
      return {
        stack: row ? row.getAttribute('data-ph-home-growth-stack') : null,
        ready: row ? row.getAttribute('data-ph-home-growth-ready') : null,
        text: row ? row.textContent : null,
        readyLabel: readyLabel ? readyLabel.textContent : null,
        hintState: hint ? hint.getAttribute('data-ph-claim-hint') : null,
        hintText: hint ? hint.textContent : null,
      };
    });
    log(
      !!r1.homeAfter.homeGrowth &&
        r1.homeAfter.homeGrowth.defId === 'cannon' &&
        r1.homeAfter.homeGrowth.star === 1 &&
        r1.homeAfter.homeGrowth.count === 5 &&
        r1.homeAfter.homeGrowth.threshold === FUSE_STACK &&
        r1.homeAfter.homeGrowth.stackText === '5/5' &&
        r1.homeAfter.homeGrowth.ready === true &&
        growthDom.stack === '5/5' &&
        growthDom.ready === 'true' &&
        growthDom.text.includes('成长 5/5') &&
        growthDom.readyLabel === '可升星',
      'D4b **必改 5**：首页真的画出一行最小成长状态（`炮 ★1 成长 5/5 可升星`），读数与库存同源（探针与真实 DOM 双证）',
      `探针=${JSON.stringify(r1.homeAfter.homeGrowth)} · DOM=${growthDom.text}`,
    );
    log(
      r1.homeAfter.claimUpgradableHint === true &&
        growthDom.hintState === 'upgradable' &&
        !!growthDom.hintText &&
        growthDom.hintText.includes('已可升星') &&
        growthDom.hintText.includes('调整战车') &&
        invCount(r1.storedAfter, 'cannon', 2) === 0,
      'D4c **必改 6**：领奖提示**自然引导到下一步**（`已可升星 → 点「调整战车」合成`），且此刻 ★2 **还不存在** ⇒ 页面绝不代替玩家合成',
      `hint=${growthDom.hintState} 「${growthDom.hintText}」 · ★2=${invCount(r1.storedAfter, 'cannon', 2)}`,
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
        spearCard.stackText === '1/5' &&
        spearCard.fusable === 'false',
      'F2 调整战车：Weapon 卡**带星级与数量**（`炮 ★1 5/5` / `刺 ★1 1/5`），且与库存同源',
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

    /*
      ============ 第二局（H 段）**已挪到 K 段（合成）之后** ============

      ⚠️ PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY（必改 2）的两条硬约束把这一段逼到了后面：
      ① 候选池收窄为 `['cannon']` ⇒ 玩家在终点**只能**点 cannon 那张卡。
         旧写法 `playOneRunAndClaim(page, 'hammer', …)` 会在候选池里找不到 hammer
         （`CHOICE_IDS.indexOf('hammer')` = **-1**）⇒ `cards.choices[-1]` 直接越界。
      ② 但它**不能**在合并之前领 cannon：合成（K 段）的前提是 `cannon ★1` **恰好 5 件**
         （`5 × ★1 → 1 × ★2` 之后 ★1 必须归 0）。若先领到 6 件，一次合成只会留下 1 件 ★1，
         K3 / K4 / K8 那几条「★1 归零 ⇒ 卡消失」的判据就全部失真。
      ⇒ 顺序改为「**先合成（K）→ 再开第二局领 ★1（H）**」，H 段见 `J1` 之前。
    */

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
        /*
          ⚠️ 账本这里改成**与失败前的快照相比「没有 +1」**，而不是写死条数：
          本 Queue 把第二局（H 段）挪到了合成之后 ⇒ 走到 I 段时只领过 1 次。
          写死 2 会把「顺序调整」误报成「失败发了奖」——那是两件事。
          「失败不新增账本条目」这条判据本身一字未变，只是换成了不依赖轮次的口径。
        */
        ledgerTokens(stored5).length === ledgerTokens(storedFinal).length &&
        ledgerTokens(stored5).length >= 1,
      'I5 **验收 ⑥**：失败一局之后三件数量与账本**一个数字都没动**（失败不补偿、不发奖、不增长）',
      `cannon ${finalCounts.cannon}→${failCounts.cannon} · spear ${finalCounts.spear}→${failCounts.spear} · hammer ${finalCounts.hammer}→${failCounts.hammer} · 账本=${ledgerTokens(storedFinal).length}→${ledgerTokens(stored5).length}`,
    );
    log(failErrors.length === 0, 'I6 失败路线全程零运行时报错', failErrors.slice(0, 2).join(' | ') || 'none');
    await failPage.close();

    /* ==========================================================================================
       5) PRODUCT-LOOP-R2-B｜合成：5 × ★1 → 1 × ★2 + equipped 自动升星（验收 ①②③⑥⑦⑧ + 必改 3）

       ⚠️ 本段刻意放在**所有「跑局」断言之后**：★2 的炮真实占用 33 能量（★1 = 30）⇒ 一旦插在
          中间，后续几局的 Build 数值就变了，「确定性通关路线」不再确定性。放到最后 = 只动
          「局外成长」这一件事，前面的战斗取证逐字不受影响。
       ⚠️ 到这一步 page 停在首页（第 2 局领奖后回到 home.html），cannon 库存 = ★1 ×5。
       ========================================================================================== */
    const preK = await probeHome(page);
    if (preK.view !== 'garage') await clickSelector(page, '[data-ph-action="open-garage"]');
    const k0 = await probeHome(page);
    const k0c1 = k0.weapons.find((w) => w.defId === 'cannon' && w.star === 1);
    const k0c2 = k0.weapons.find((w) => w.defId === 'cannon' && w.star === 2);
    const k0card = await garageCard(page, 'cannon', 1);
    const k0fuse = await garageFuseButton(page, 'cannon', 1);
    const k0spear = await garageCard(page, 'spear', 1);
    const k0spearFuse = await garageFuseButton(page, 'spear', 1);
    log(
      !!k0c1 &&
        k0c1.count === 5 &&
        k0c1.stackText === '5/5' &&
        k0c1.fusable === true &&
        k0c1.maxStar === false &&
        k0c2 === undefined &&
        !!k0card &&
        k0card.text.includes('可合成') &&
        !!k0fuse &&
        /*
          ⚠️ PRODUCT-LOOP-R2-RECOVERY（必改 4）把 Garage 的合成按钮文案从「合成」改成
          **「合成升星」**（Queue 要求把「合成 = 升星」这层因果写在按钮上）。
          这里跟着改成新文案 —— 旧值「合成」是本轮之前就残留的陈旧断言（上一轮门禁没跑到这一段）。
        */
        k0fuse.text === '合成升星' &&
        k0fuse.disabled === false,
      'K1 验收 ②「5/5 可以合成」：cannon ★1 = 5/5 ⇒ 卡片写「可合成」+ 真实「合成升星」按钮，且此刻**还没有** ★2 卡',
      `★1=${k0c1 ? `${k0c1.count}/${k0c1.threshold} fusable=${k0c1.fusable}` : 'n/a'} · ★2=${k0c2 ? k0c2.count : '不存在'} · 卡=${k0card ? k0card.text : 'n/a'} · 按钮=${k0fuse ? k0fuse.text : '不存在'}`,
    );
    log(
      !!k0spear &&
        k0spear.stackText === '1/5' &&
        k0spear.fusable === 'false' &&
        k0spearFuse === null,
      'K2 验收 ①「不满 5 件不能合成」：spear 1/5 ⇒ 卡片无「可合成」徽标，且合成按钮在 DOM 里**根本不存在**（不是置灰）',
      `spear=${k0spear ? `${k0spear.stackText} fusable=${k0spear.fusable}` : 'n/a'} · 按钮=${k0spearFuse ? '存在' : '不存在'}`,
    );

    const energyBeforeFuse = k0.energy;
    const equippedStarBefore = k0.equippedWeaponStar;

    // ★ 真实鼠标点击「合成」（点的是按钮自己声明的 defId/star，不猜坐标、不调内部函数）
    await clickSelector(
      page,
      `[data-ph-action="fuse"][data-ph-fuse-def="cannon"][data-ph-fuse-star="1"]`,
    );
    const k1 = await probeHome(page);
    const storedK = await storageDump(page);
    log(
      !!k1.lastFuse &&
        k1.lastFuse.ok === true &&
        k1.lastFuse.reason === null &&
        k1.lastFuse.partId === 'cannon' &&
        k1.lastFuse.fromStar === 1 &&
        k1.lastFuse.toStar === 2 &&
        k1.lastFuse.countAfter === 0 &&
        k1.lastFuse.productCount === 1 &&
        k1.lastFuse.equippedUpgraded === true,
      'K3 验收 ③「5 × ★1 → 1 × ★2」：**一次**点击后 ★1 归 0、★2 = 1（对账字段来自合成返回值）',
      k1.lastFuse
        ? `ok=${k1.lastFuse.ok} ★${k1.lastFuse.fromStar}→★${k1.lastFuse.toStar} countAfter=${k1.lastFuse.countAfter} product=${k1.lastFuse.productCount} upgraded=${k1.lastFuse.equippedUpgraded}`
        : 'n/a',
    );

    const k1c1 = await garageCard(page, 'cannon', 1);
    const k1c2 = await garageCard(page, 'cannon', 2);
    const k1c3 = await garageCard(page, 'cannon', 3);
    const k1fuse = await garageFuseButton(page, 'cannon', 2);
    log(
      k1c1 === null &&
        !!k1c2 &&
        k1c2.star === '2' &&
        k1c2.count === '1' &&
        k1c2.stackText === '1/5' &&
        k1c2.equipped === 'true' &&
        k1c2.fusable === 'false' &&
        k1c3 === null,
      'K4 星级真的进了数据模型（不是改文案）：★1 的炮**库存归零 ⇒ 卡消失**；★2 的炮是一张新卡（1/5、带「已装备」）；★3 不存在',
      `★1=${k1c1 ? k1c1.text : '不存在'} ★2=${k1c2 ? k1c2.text : '不存在'} ★3=${k1c3 ? k1c3.text : '不存在'}`,
    );
    log(
      k1.equippedWeaponId === 'cannon' &&
        k1.equippedWeaponStar === 2 &&
        storedWeaponStar(storedK) === 2,
      'K5 **验收 ⑥**：装备那一档被合空 ⇒ Equipped 自动改指 ★2（玩家无需「卸下 → 合成 → 再装备」），且**正式 Build 存档**里也是 ★2',
      `equipped=${k1.equippedWeaponId} ★${k1.equippedWeaponStar} · 存档 ★${storedWeaponStar(storedK)}（合成前 ★${equippedStarBefore}）`,
    );

    const entryStar2 = k1.weapons.find((w) => w.defId === 'cannon' && w.star === 2);
    const entryStar1 = k0.weapons.find((w) => w.defId === 'cannon' && w.star === 1);
    const starDelta = entryStar2 && entryStar1 ? entryStar2.energyInUse - entryStar1.energyInUse : null;
    log(
      starDelta !== null &&
        starDelta > 0 &&
        k1.energy === energyBeforeFuse + starDelta &&
        k1.energyCapacity === k0.energyCapacity,
      `K6 星级倍率真的作用到 Build 总能量：★2 单件占 ${entryStar2 ? entryStar2.energyInUse : '?'}（★1 占 ${entryStar1 ? entryStar1.energyInUse : '?'}）⇒ 总能量恰好 +${starDelta}`,
      `能量 ${energyBeforeFuse} → ${k1.energy}（差 ${k1.energy - energyBeforeFuse} = 卡片 ${entryStar2 ? entryStar2.energyInUse : '?'} − ${entryStar1 ? entryStar1.energyInUse : '?'}）/ 容量 ${k1.energyCapacity}`,
    );

    // 必改 5（不连锁）：一次点击只有一次 5 合 1；★2 = 1 件 ⇒ 没有 ★3、也没有可再点的合成按钮
    log(
      k1fuse === null && k1c3 === null && !!k1c2 && k1c2.count === '1',
      'K7 必改 5「一次点击只执行一次」：合成后 ★2 只有 1 件 ⇒ 没有★3、也**没有**可再点的合成按钮（不存在连锁升星）',
      `★2=${k1c2 ? k1c2.count : 'n/a'} 按钮=${k1fuse ? k1fuse.text : '不存在'} ★3=${k1c3 ? '存在' : '不存在'}`,
    );

    /* ---- 验收 ⑧：整页 reload 后 star / count / equipped 三者都保持 ---- */
    await page.reload({ waitUntil: 'load' });
    await waitHomeReady(page);
    const kReload = await probeHome(page);
    const storedReload = await storageDump(page);
    const kReloadC1 = await garageCard(page, 'cannon', 1);
    log(
      kReload.equippedWeaponId === 'cannon' &&
        kReload.equippedWeaponStar === 2 &&
        invCount(storedReload, 'cannon', 1) === 0 &&
        invCount(storedReload, 'cannon', 2) === 1 &&
        invCount(storedReload, 'cannon', 3) === 0 &&
        storedWeaponStar(storedReload) === 2,
      'K8 **验收 ⑧**：整页 reload 后 `star / count / equipped` 三者全部保持（★1=0、★2=1、装的还是 ★2）—— 全部来自真实持久化',
      `equipped=${kReload.equippedWeaponId} ★${kReload.equippedWeaponStar} · 磁盘 ★1=${invCount(storedReload, 'cannon', 1)} ★2=${invCount(storedReload, 'cannon', 2)} ★3=${invCount(storedReload, 'cannon', 3)} · 存档星=${storedWeaponStar(storedReload)}`,
    );
    log(
      kReloadC1 === null && kReload.equippedWeaponId === 'cannon',
      'K9 reload 后 ★1 卡仍未回来（库存真的是 0，不是页面内存里少显示一张）',
      `★1=${kReloadC1 ? kReloadC1.text : '不存在'}`,
    );

    /* ============ H｜第二局：再领一次 ★1 cannon（验收 ④「跨局累积」） ============
       ⚠️ 为什么在本段（K 段合成**之后**）：见上面 `storedFinal` 之前的说明。
          合成把 `cannon ★1` 合空（5 → 0）⇒ 第二局的候选读数就是 **0 → 1**。
       ⚠️ 断言一条都没删，只是重新基线到新的真实状态；而且因为此时 ★2 同时存在，
          「★1 与 ★2 是两条互不干扰的 stack」也被顺带钉住了。
    */
    const r2 = await playOneRunAndClaim(page, CHOICE_IDS[0], WIN_POLICY, '第二局（完成路线）');
    log(
      r2.token !== token0 && r2.pickHref !== r1.pickHref,
      'H1 第二局的 token 与第一局不同（每挂载一次首页 = 一次新的「准备出发」）⇒ 领奖是**新的一局**，不是重复领',
      `token1=${token0} token2=${r2.token}`,
    );
    log(
      r2.runStart.playerLoadout.source === 'profile' &&
        r2.runStart.playerLoadout.functionalSelections[WEAPON_SLOT] === 'cannon',
      'H1b 第二局确实带着**当前装备**的 cannon 出发（局外的装备动作真的作用到了下一局）',
      `source=${r2.runStart.playerLoadout.source} ${WEAPON_SLOT}=${r2.runStart.playerLoadout.functionalSelections[WEAPON_SLOT]}`,
    );
    log(
      r2.pDone.phase === 'COMPLETE' &&
        r2.pDone.rewardChoices.length === 1 &&
        r2.pDone.rewardChoices[0].defId === CHOICE_IDS[0] &&
        r2.pDone.rewardChoices[0].countBefore === 0 &&
        r2.pDone.rewardChoices[0].countAfter === 1,
      'H2 第二局终点的候选读数 = **当前真实库存**（合成之后 ★1 = 0 ⇒ 预览 0 → 1）—— 载荷读的是活库存，不是出发时那份旧快照',
      `候选=${r2.pDone.rewardChoices.map((c) => `${c.defId}:${c.previewText}`).join(' ')}`,
    );
    log(
      invCount(r2.storedBefore, 'cannon') === 0 &&
        invCount(r2.storedAfter, 'cannon') === 1 &&
        invCount(r2.storedAfter, 'cannon', 2) === 1 &&
        invCount(r2.storedAfter, 'spear') === 1 &&
        invCount(r2.storedAfter, 'hammer') === 1 &&
        ledgerTokens(r2.storedAfter).length === 2,
      'H3 **验收 ④**：领这一件只让 cannon **★1** 0 → 1；★2 仍 1、spear 仍 1、hammer 仍 1（★1 与 ★2 是两条独立 stack）',
      `cannon★1 ${invCount(r2.storedBefore, 'cannon')}→${invCount(r2.storedAfter, 'cannon')} · cannon★2=${invCount(r2.storedAfter, 'cannon', 2)} · spear ${invCount(r2.storedAfter, 'spear')} · hammer ${invCount(r2.storedAfter, 'hammer')} · 账本=${ledgerTokens(r2.storedAfter).length}`,
    );
    log(
      r2.homeAfter.weapons.find((w) => w.defId === 'cannon' && w.star === 2).stackText === '1/5' &&
        r2.homeAfter.weapons.find((w) => w.defId === 'cannon' && w.star === 1).stackText === '1/5' &&
        r2.homeAfter.weapons.find((w) => w.defId === 'hammer').stackText === '1/5',
      'H4 首页读数：cannon 同时有 ★1 `1/5` 与 ★2 `1/5` 两张卡、hammer `1/5`（同一份库存，各 stack 各长各的）',
      r2.homeAfter.weapons.map((w) => `${w.name}★${w.star}${w.stackText}`).join(' · '),
    );
    /*
      PRODUCT-LOOP-P0-SETTLEMENT-CTA-LATENCY（必改 7）：时延上界不是「只对第一局成立」。
      第二局的候选数量 / 库存状态都不同（★1 合成后为 0）⇒ 再证一次，防止
      「某条分支才慢」这种回归溜过单点取样。
    */
    log(
      r1.navMs < CTA_HOME_BUDGET_MS && r2.navMs < CTA_HOME_BUDGET_MS,
      'H5 **必改 7**｜两局都满足同一时延上界（不是只对第一局成立）',
      `r1=${r1.navMs} ms · r2=${r2.navMs} ms（上界 ${CTA_HOME_BUDGET_MS} ms）`,
    );

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
