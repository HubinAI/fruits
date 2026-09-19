/**
 * PRODUCT-LOOP-R1-C-END-TO-END-PLAYER-LOOP｜**真正的端到端玩家闭环 smoke**（真实浏览器）。
 * PRODUCT-LOOP-R2-A-REWARD-STACK-INVENTORY｜**改口径**：终点的「领取那一件」变成
 * 「**三张候选卡里选一件**」，奖励的价值从「从无到有」变成「**同一个 stack 数量累积**」。
 *
 * 这是本阶段唯一验收目标的机器判据。它跑的不是「一条片段」，而是**两个完整的局**：
 *
 *   第一局：首页 → 调整战车 → 装备 Weapon A → 开始冒险 → 第一场确认 Weapon A
 *           → 真实打完一整局 → COMPLETE → 在**三张候选卡**里点中一件（Weapon B）
 *   局外  ：回首页（库存已累积）→ 调整战车 → Weapon B 的**读数 +1** → 装备 Weapon B
 *   第二局：回首页 → 开始冒险 → 新 Run 状态干净 → 第一场**真实使用 Weapon B**
 *
 * 手段（与 `_e2e_product_home.cjs` / `_e2e_product_reward.cjs` 同一纪律，全部是真实行为取证）：
 *   - 真实浏览器（playwright-core / msedge），打开独立产物 `dist-portrait-lab/`；
 *   - **真实鼠标点击**（`page.mouse.click`；逻辑坐标 → 画布真实 CSS 矩形换算，不 evaluate 直调）；
 *   - **真实整页导航**（`<a href>` / `location.assign` 由浏览器执行，本文件不做 evaluate 跳转）；
 *   - **真实 localStorage 读取**（「Profile Equipped」这一侧一律独立取证，不读页面探针）；
 *   - **真实 `getImageData` 像素取证**（三张候选卡真的画在画布上，不是只有探针字段）；
 *   - 只读诊断句柄 `window.__PRODUCTHOME__` / `window.__RUNPAGE__`（只读，不能借它改状态）。
 *
 * 七条必证（R1-C 验收原文）+ R2-A 的四条增量（两块判据跑在**同一台机器**上）：
 *   1 Run Buff 不继承          → F6（第二局第一场开打时 `build === []`；上一局是两层）
 *   2 HP 不继承                → F5（第二局第一场 `playerHp === playerHpMax` 满耐久）
 *   3 Day 不继承               → F7（第二局 DAY 远小于第一局结束时）
 *   4 Permanent Inventory 继承 → F8（第二局的奖励件**数量**已累积，来自持久化）
 *   5 Equipped Weapon 继承     → F2 / F4（第二局第一场真的装着 Weapon B）
 *   6 Reward 不重复领取        → G1 / G2 / G3（重开领奖 URL → 不重复发奖；**换一件也领不到**）
 *   7 Validation 入口仍独立可用 → H1
 *   ① 新账号成长起点 ★1 4/5   → A1（fresh seed，只发这一次）
 *   ② 终点三张真实 Weapon 卡    → C3 / C3b / C3c（含真实像素）
 *   ③ 选中那一件数量 +1         → D2（**独立取证**正式存档 key）
 *   ④ 其它 stack 不跟着涨       → D2（同一份 dump 里对照 cannon / hammer 保持不变）
 *
 * ⚠️ 本文件只跑**成功**那条路线（它必须真的打完四场才能到 COMPLETE）；失败路线与
 *    「FAILED 数量零变化」的对照在 `_e2e_product_reward.cjs` 里（同一条路线的
 *    「耐久事件选另一项」变体），不在这里重复。
 * ⚠️ 完成路线是**确定性**的（`RunBattleRuntime` 无 RNG；强化路线由池内 id 指定）：
 *    一层 `twinCannon` + 耐久事件「维修」+ 二层 `tripleLoad` → 终局仍存活 → COMPLETE
 *    （同一条路线在 B 段 `_e2e_product_reward.cjs` 里已实测跑通，本文件沿用。）
 *
 * 用法：
 *   npm run build:portrait-lab
 *   node tests/_e2e_product_loop.cjs   （或 npm run e2e:product-loop）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8168;
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

/**
 * Weapon A = 第一局出发时装的武器。
 *
 * ⚠️ 为什么是 **cannon**（实测，不是随便挑的）：本 smoke 的第一局必须**真的打完**
 *    （Queue 原文「真实完成 Run → COMPLETE → 领取 Weapon B」），而实测只有主武器
 *    在中远距离造成伤害时才能稳定打完这四场：
 *       spear@主武器槽（近战刺）→ 第 2 场僵持，跑不完
 *       hammer@主武器槽（近战锤）→ 第 1 场即被打死（玩家弹丸峰值 = 0）
 *       cannon@主武器槽（远程炮）→ COMPLETE（4/4 场，复跑同结果）
 *    （完整矩阵见 `src/product/playerLoadout.ts` 的 `DEFAULT_CLEARED_SLOT` 注释。）
 */
const WEAPON_A = 'cannon';
const WEAPON_A_NAME = '炮';
/**
 * 换装前的**预装**武器（同属 starter 已拥有）：先用它做一次真实换装，
 * 再装回 Weapon A ⇒ 「装备」这一步在两个方向上都是**真实写存档**的动作，
 * 而不是「点了但本来就是它」的空转。
 *
 * ⚠️ 刻意选 **hammer**（不是下面要领的 spear）：本文件里有三个不同的武器角色
 *    （出发装备 / 预装探针 / 本局奖励），让它们**互不重合** ⇒ 每一条断言都指向唯一一件，
 *    「读到 spear 2/5」不可能来自别的步骤（否则「+1」是哪个动作造成的就说不清了）。
 */
const WEAPON_PRE = 'hammer';
const WEAPON_PRE_NAME = '锤';
/**
 * Weapon B = 本局在终点**三张候选卡里真的点中**的那一件。
 *
 * ⚠️ R2-A 之后它不再是「唯一奖励」：`REWARD_WEAPON_ID` 已随 3选1 一起被删掉，
 *    三张卡各自带一条领奖地址，玩家点谁由本文件的 `PICK_INDEX` 决定
 *    （= 玩家的选择，而不是产品写死的「奖励就是它」）。
 * ⚠️ 它与新账号的初始读数（`SEED_COUNTS.spear` = 1）不同 ⇒ 「领完变 2」是可观测的累积。
 *
 * ── ⚠️ PRODUCT-LOOP-P0-RUN-BUILD-LOADOUT-COMPATIBILITY：它的角色**缩小**了 ──────────
 * P0 之前本文件让第二局**真的装上 Weapon B（spear）去打第一场**。P0 之后这条路不再合法：
 * 非 cannon 的装备在首页就进不去完整 Run（产品裁决：Spear / Hammer 在有正式 Run Build
 * 内容之前不得进入完整 Run）。⇒ `spear` 现在只承担**局外**角色：
 *
 *   ① 终点真的点中它 ⇒ 库存 1 → 2（R2-A 的累积证据，D1–D3 一字未动）；
 *   ② 照样可以拥有 / 查看 / **装备**（必改 3：不许把它从 Inventory 删掉）⇒ D4 / D4b 一字未动；
 *   ③ 但装上它之后「开始冒险」必须进**不可执行**状态（新段 E1 / E2），
 *      换回 `cannon` 才恢复（新段 E3）—— 第二局因此用 `cannon` 打第一场。
 *
 * ⚠️ 于是本文件比 P0 之前**多**取证了一件事：守门在真实鼠标点击下真的成立（E1 真点不导航）。
 *    代价是「第二局第一场用的是刚换上的那件新装备」不再由 `spear` 承担 ——
 *    改由 F4b 的**逐槽对账**证明（战斗里真实装配的车 = 出发前存档里那份 Loadout）。
 */
const WEAPON_B = 'spear';
const WEAPON_B_NAME = '刺';
/**
 * 终点三张候选（与 `src/product/runReward.ts` 的 `REWARD_CHOICE_IDS` 同值）。
 * ⚠️ 顺序 = 界面上**从上到下**的展示顺序 ⇒ `PICK_INDEX` 同时就是「点第几张卡」。
 */
const CHOICE_IDS = ['cannon', 'spear', 'hammer'];
const CHOICE_NAMES = { cannon: '炮', spear: '刺', hammer: '锤' };
/** 本文件要选中第几张卡（= `WEAPON_B` 在候选池里的下标；与卡片矩形一一对应）。 */
const PICK_INDEX = CHOICE_IDS.indexOf(WEAPON_B);
/**
 * 新账号成长起点（Queue 必改 3；真源 = `src/product/playerGrowth.ts` 的 `FRESH_STACK_SEED`）。
 * ⚠️ 这不是 core 的 `defaultInventory()`（那边 starter 各 1）—— 起点是**产品侧**为
 *    「第一局胜利就能凑满 5/5」刻意抬起来的，因此必须在这里独立取证。
 */
const SEED_COUNTS = { cannon: 4, spear: 1, hammer: 1 };
/** 满 stack 阈值（与 `playerGrowth.FUSE_STACK` 同值；让断言能钉死「4/5」这个读数）。 */
const FUSE_STACK = 5;
/** 候选卡底色（`runPage.ts` 的 `COLORS.cardBg`）—— 用于证明卡片真的画在画布上。 */
const CARD_BG = [0x1b, 0x24, 0x32];

/** 正式存档 key（与 src 同值；E2E 独立取证，不经过页面探针）。 */
const BUILD_KEY = 'strongfruit.playerBuild.v1';
const INV_KEY = 'strongfruit.ownedParts.v2';
const CLAIMS_KEY = 'strongfruit.profileClaims.v1';
/** A 段打通的唯一武器槽（= 车身前上挂点）。 */
const WEAPON_SLOT = 'frontMass';
/** 装备参数名（产品侧与 Lab 侧的唯一约定）。 */
const LOADOUT_PARAM = 'equipped';

/** 稳定取胜路线（与 B 段同一条；锚在池内 id 上，不靠随机）。 */
const WIN_POLICY = { layer1: 'twinCannon', lateral: null, layer2: 'tripleLoad', durability: 'repair' };

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

/**
 * 首页「不可执行」提示块的**真实 DOM**（PRODUCT-LOOP-P0 必改 2）。
 * 断言提示「画在页面上」而不是只在探针里 —— 探针字段对玩家不可见。
 */
const compatNoticeDom = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-ph-compat]');
    return el
      ? {
          value: el.getAttribute('data-ph-compat'),
          reason: el.getAttribute('data-ph-compat-reason'),
          text: el.textContent ?? '',
        }
      : null;
  });

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
  const cx = screen.left + (lx / 390) * screen.width;
  const cy = screen.top + (ly / 844) * screen.height;
  await page.mouse.click(cx, cy);
}

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

function invCount(dump, defId) {
  const raw = dump[INV_KEY];
  if (!raw) return null;
  try {
    const e = JSON.parse(raw)[defId];
    return e ? Number(e.one) : 0;
  } catch {
    return null;
  }
}

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

/** **Profile Equipped Weapon ID**（独立取证：直接读正式 Build 存档）。 */
function profileEquippedWeapon(dump) {
  const raw = dump[BUILD_KEY];
  if (!raw) return null;
  try {
    const sel = JSON.parse(raw).functionalSelections;
    return sel ? (sel[WEAPON_SLOT] ?? null) : null;
  } catch {
    return null;
  }
}

/** 从「开始冒险」的真实 href 里解码产品侧交出去的装备（不改它的形态，只读）。 */
function decodeLoadoutFromHref(href) {
  try {
    const raw = new URLSearchParams(href.split('?')[1] ?? '').get(LOADOUT_PARAM);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * 从出发链接里取出产品侧给的 **3选1 载荷**（`{stack, choices:[{defId,star,countBefore,href}]}`）。
 * ⚠️ 必须走 `URLSearchParams`：载荷是 JSON，里面的 `&` / `=` 会被裸字符串切割切坏。
 */
function choicesOf(href) {
  try {
    const raw = new URLSearchParams(href.split('?')[1] ?? '').get('choices') ?? '';
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Garage 里某张 Weapon 卡的**真实 DOM 读数**（star / count / stackText 都取卡片自己的 data-*）。 */
function weaponCard(page, defId) {
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

/** 把一局 Run 驱到终态（真实鼠标点击），并记录第一场战斗的现场。 */
async function driveRunToEnd(page, policy, label) {
  const t0 = Date.now();
  const seen = [];
  /**
   * 「第一场战斗」的现场快照 —— 必须**在打的过程中**抓，不能事后补：
   *   `battleWorld` 只在战斗存在时非空，战斗结束后世界会被释放。
   * 判据 = 第一次进入 `BATTLE` 相位（此时本局 Build 还没选过任何强化）。
   */
  let firstBattle = null;
  let firstBattleFound = false;
  let last = null;
  while (Date.now() - t0 < DRIVE_BUDGET_MS) {
    const p = await probeRun(page);
    if (!last || last.phase !== p.phase) seen.push(p.phase);
    last = p;
    if (!firstBattleFound && p.phase === 'BATTLE' && p.battleWorld) {
      firstBattle = p;
      firstBattleFound = true;
    }
    if (p.phase === 'COMPLETE' || p.phase === 'FAILED') {
      return { probe: p, firstBattle, seen, ms: Date.now() - t0 };
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
  throw new Error(`${label} 驱动超时（${DRIVE_BUDGET_MS}ms）· 最后 phase=${last ? last.phase : 'n/a'}`);
}

/** 第一场战斗里，玩家车**真实装出来**的主武器槽 defId（测试锁的一半）。 */
function firstBattleWeapon(runResult) {
  const fb = runResult.firstBattle;
  if (!fb || !fb.battleWorld) return null;
  const f = (fb.battleWorld.playerFunctionals ?? []).find((x) => x.hardpointId === WEAPON_SLOT);
  return f ? f.defId : null;
}

/** 把 `functionalSelections` 摊成「真正装上了的部件」`{挂点: defId}`（跳过空槽）。 */
function mountedMap(selections) {
  const out = {};
  for (const [hp, id] of Object.entries(selections ?? {})) {
    if (id && id !== 'none') out[hp] = id;
  }
  return out;
}

/** 第一场战斗里玩家车的**逐槽真实装配**（`{挂点: defId}`）—— 测试锁的完整形态。 */
function firstBattleMounted(runResult) {
  const fb = runResult.firstBattle;
  if (!fb || !fb.battleWorld) return null;
  const out = {};
  for (const f of fb.battleWorld.playerFunctionals ?? []) out[f.hardpointId] = f.defId;
  return out;
}

const canon = (m) =>
  JSON.stringify(
    Object.keys(m ?? {})
      .sort()
      .map((k) => [k, m[k]]),
  );

/* ------------------------------------------------------------------- 主流程 */

async function main() {
  console.log('=== PRODUCT-LOOP-R1-C + R2-A｜端到端玩家闭环 smoke（两局真实 Run + 3选1 数量累积）===\n');

  for (const f of ['home.html', 'run-page.html', 'validation-hub.html', 'portrait-lab.html']) {
    if (!fs.existsSync(path.join(ROOT, f))) {
      console.error(`未找到 ${path.join(ROOT, f)} —— 请先 npm run build:portrait-lab`);
      process.exit(1);
    }
  }

  const server = await startServer();
  log(true, 'P0 静态产物就绪（home / run-page / validation-hub / portrait-lab 真实存在）');

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  // 390×844 / DPR 1：Run 画布 1:1（逻辑坐标 ↔ 屏幕坐标线性换算的前提）
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  try {
    /* ============================================================ 第一局 */

    /* ---- 1) 首页基线：新账号的成长起点（R2-A 验收 ①） ---- */
    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const home0 = await probeHome(page);
    const stored0 = await storageDump(page);
    log(
      home0.view === 'home' &&
        home0.growth.fresh === true &&
        home0.growth.seeded === true &&
        home0.growth.stackThreshold === FUSE_STACK &&
        invCount(stored0, 'cannon') === SEED_COUNTS.cannon &&
        invCount(stored0, WEAPON_B) === SEED_COUNTS[WEAPON_B] &&
        invCount(stored0, WEAPON_PRE) === SEED_COUNTS[WEAPON_PRE] &&
        !stored0[CLAIMS_KEY],
      'A1 **新账号的成长起点**（R2-A 验收 ①）：cannon ★1 4/5、另两件候选各 1/5；没有领奖账本（后面的 +1 一定是本局产生的）',
      `fresh=${home0.growth.fresh} seeded=${home0.growth.seeded} cannon=${invCount(stored0, 'cannon')} ${WEAPON_B}=${invCount(stored0, WEAPON_B)} ${WEAPON_PRE}=${invCount(stored0, WEAPON_PRE)}`,
    );
    log(
      home0.weapons.length === 3 &&
        home0.weapons.every((w) => w.star === 1 && w.threshold === FUSE_STACK) &&
        home0.weapons.find((w) => w.defId === 'cannon').count === 4 &&
        home0.weapons.find((w) => w.defId === 'cannon').stackText === '4/5' &&
        home0.weapons.every((w) => w.reachesThreshold === false) &&
        home0.weapons.every((w) => w.fusable === false) &&
        home0.weapons.every((w) => w.maxStar === false),
      'A1b Garage 读数与库存同源：三张卡都是 ★1、分母 = 满 stack 阈值、次数 4/1/1（未满 ⇒ 无合成入口；合成验收在 R2-B 的段里）',
      home0.weapons.map((w) => `${w.name}★${w.star}${w.stackText}`).join(' · '),
    );
    log(
      home0.equippedWeaponId === WEAPON_A && home0.weaponIds.includes(WEAPON_PRE),
      `A2 基线：装的是 Weapon A（${WEAPON_A_NAME}），且**另有**一件已拥有武器（${WEAPON_PRE_NAME}）⇒ 下面两步换装都能真实改变存档`,
      `当前=${home0.equippedWeaponId} / A=${WEAPON_A} / 预装=${WEAPON_PRE}`,
    );
    // 主循环可行性处置（PRODUCT-LOOP-R1-C 的最小产品侧改动）：默认车的前置槽留空，
    // 否则推杆会与主武器几何重叠并把车推出射程 ⇒ 新账号第一场必输、闭环不可达。
    const frontSlot = home0.slots.find((s) => s.hardpointId === 'front');
    log(
      !!frontSlot && frontSlot.defId === 'none' && !frontSlot.occupied,
      'A2b 默认车把「前端挂点」留给主武器（不挂推杆）—— 这是主循环可达性的前置条件',
      `front=${frontSlot ? frontSlot.defId : 'n/a'} 全槽=${JSON.stringify(home0.slots.map((s) => [s.hardpointId, s.defId]))}`,
    );

    /* ---- 2) 调整战车 → 两步真实换装 → 装上 Weapon A ---- */
    await clickSelector(page, '[data-ph-action="open-garage"]');
    const garage0 = await probeHome(page);
    const cardA = await page.evaluate(() => {
      const out = {};
      for (const n of document.querySelectorAll('[data-ph-weapon]')) {
        const id = n.getAttribute('data-ph-weapon');
        out[id] = (n.textContent || '').slice(0, 40);
      }
      return out;
    });
    const cardIds = Object.keys(cardA);
    log(
      garage0.view === 'garage' && cardIds.includes(WEAPON_A) && cardIds.includes(WEAPON_PRE),
      'A3 进入调整战车：Weapon A 与预装武器都在可装备列表里（与其它武器同一份 Inventory 数据）',
      `view=${garage0.view} 车卡=[${cardIds.join(' / ')}] probe.weaponIds=[${garage0.weaponIds.join(',')}]`,
    );
    // R2-A「Garage 最小显示」：每张卡都带星级与数量，且卡面文案与 data-* 同源
    const cardASeed = await weaponCard(page, WEAPON_A);
    const cardBSeed = await weaponCard(page, WEAPON_B);
    log(
      !!cardASeed &&
        !!cardBSeed &&
        cardASeed.star === '1' &&
        cardASeed.threshold === String(FUSE_STACK) &&
        cardASeed.stackText === `${SEED_COUNTS[WEAPON_A]}/5` &&
        cardASeed.count === String(SEED_COUNTS[WEAPON_A]) &&
        cardBSeed.count === String(SEED_COUNTS[WEAPON_B]) &&
        cardASeed.text.includes(`★1`) &&
        cardASeed.text.includes(`${SEED_COUNTS[WEAPON_A]}/5`),
      `A3b Garage 卡片真的写出「星级 + 数量 / 5」：${WEAPON_A_NAME} ★1 ${SEED_COUNTS[WEAPON_A]}/5（未满 ⇒ 无「可合成」徽标、无合成按钮）`,
      cardASeed ? `[${WEAPON_A}] ${cardASeed.text} · data: star=${cardASeed.star} count=${cardASeed.count} stackText=${cardASeed.stackText}` : 'n/a',
    );

    // 第一步：装上预装武器 → 存档真的变了（证明「装备」不是一个 no-op）
    await clickSelector(page, `[data-ph-weapon="${WEAPON_PRE}"]`);
    await clickSelector(page, '[data-ph-action="equip"]');
    const storedPre = await storageDump(page);
    log(
      storedWeaponSlot(storedPre) === WEAPON_PRE,
      `A4 第一步换装（${WEAPON_PRE_NAME}）：**独立取证**正式 Build 存档的主武器槽 = ${WEAPON_PRE}（装备动作真的落盘）`,
      `${WEAPON_SLOT}=${storedWeaponSlot(storedPre)}`,
    );

    // 第二步：装回 Weapon A → 存档再次真的变了（双向都落盘）
    await clickSelector(page, `[data-ph-weapon="${WEAPON_A}"]`);
    await clickSelector(page, '[data-ph-action="equip"]');
    const garage1 = await probeHome(page);
    const stored1 = await storageDump(page);
    log(
      garage1.equippedWeaponId === WEAPON_A && storedWeaponSlot(stored1) === WEAPON_A,
      `A5 第二步换装（${WEAPON_A_NAME}）：**独立取证**正式 Build 存档的主武器槽 = Weapon A（唯一数据源，不是页面状态）`,
      `${WEAPON_SLOT}=${storedWeaponSlot(stored1)}`,
    );

    /* ---- 3) 回首页 → 「开始冒险」必须带上**这份**装备 ---- */
    await clickSelector(page, '[data-ph-action="back-home"]');
    const home1 = await probeHome(page);
    const loadoutInHref = decodeLoadoutFromHref(home1.startRunHref ?? '');
    log(
      home1.view === 'home' && home1.equippedWeaponId === WEAPON_A,
      'A6 返回首页：屏幕上显示的装备同步为 Weapon A（首页 = 下一局实际使用的装备）',
      `equipped=${home1.equippedWeaponId}`,
    );
    log(
      !!loadoutInHref &&
        loadoutInHref.functionalSelections[WEAPON_SLOT] === WEAPON_A &&
        loadoutInHref.bodyDefId === JSON.parse(stored1[BUILD_KEY]).bodyDefId,
      'A7 「开始冒险」的链接里带着**存档里那份**装备（解码后主武器槽 = Weapon A；车身一致）',
      loadoutInHref ? `${WEAPON_SLOT}=${loadoutInHref.functionalSelections[WEAPON_SLOT]}` : 'n/a',
    );
    // R2-A 的地址层契约：出发链接必须**同时**给全三张候选各自的领奖地址（Lab 不许自己拼）
    const payloadInHref = choicesOf(home1.startRunHref ?? '');
    const ownClaims = CHOICE_IDS.map(
      (id) => `./home.html?run=${home0.runToken}&reward=${id}`,
    );
    log(
      !!payloadInHref &&
        payloadInHref.stack === FUSE_STACK &&
        payloadInHref.choices.length === 3 &&
        payloadInHref.choices.every((c, i) => c.defId === CHOICE_IDS[i]) &&
        payloadInHref.choices.every((c) => c.star === 1) &&
        payloadInHref.choices.every((c, i) => c.countBefore === SEED_COUNTS[CHOICE_IDS[i]]) &&
        payloadInHref.choices.every((c, i) => c.href === ownClaims[i]) &&
        home1.rewardChoices.length === 3 &&
        new URLSearchParams((home1.startRunHref ?? '').split('?')[1] ?? '').get('reward') === null,
      'A8 出发链接带**一整份 3选1 载荷**（三条各自的领奖地址 + 满 stack 阈值 + 出发那一刻的库存读数），且地址里**没有**裸 `reward=`',
      payloadInHref
        ? `stack=${payloadInHref.stack} · ${payloadInHref.choices.map((c) => `${c.defId}★${c.star}(${c.countBefore}→${c.countBefore + 1})`).join(' / ')}`
        : 'n/a',
    );

    /* ---- 4) 出发 → Run 收到产品上下文 + 装备 ---- */
    await Promise.all([
      page.waitForURL(/run-page\.html/, { timeout: 20000 }).catch(() => {}),
      clickSelector(page, '[data-ph-action="start-run"]'),
    ]);
    await waitRunReady(page);
    const runStart1 = await probeRun(page);
    log(
      runStart1.playerLoadout.source === 'profile' &&
        runStart1.playerLoadout.fallback === 'none' &&
        runStart1.playerLoadout.functionalSelections[WEAPON_SLOT] === WEAPON_A,
      'B1 进 Run：装载来源 = profile（产品侧交进来的正式存档装备），且主武器槽 = Weapon A',
      `source=${runStart1.playerLoadout.source} fallback=${runStart1.playerLoadout.fallback} ${WEAPON_SLOT}=${runStart1.playerLoadout.functionalSelections[WEAPON_SLOT]}`,
    );
    log(
      runStart1.phase === 'IDLE' && runStart1.day === 1 && runStart1.build.length === 0,
      'B2 第一局起点干净：IDLE / DAY 1 / Run Build 为空',
      `phase=${runStart1.phase} day=${runStart1.day} build=[${runStart1.build.join(',')}]`,
    );

    /* ---- 5) 真实打完整局（第一场现场由 driver 在过程中抓） ---- */
    const run1 = await driveRunToEnd(page, WIN_POLICY, '第一局');
    const p1 = run1.probe;

    /* ==== 测试锁 ①：Profile Equipped Weapon ID ↔ Run 第一场实际 Weapon Def ID ==== */
    const profileWeaponBefore = profileEquippedWeapon(stored1);
    log(
      firstBattleWeapon(run1) === WEAPON_A && profileWeaponBefore === WEAPON_A,
      `B3 **测试锁**：Profile Equipped Weapon ID（${profileWeaponBefore}）= Run 第一场实际 Weapon Def ID（${firstBattleWeapon(run1)}）`,
      `battle=${JSON.stringify(run1.firstBattle && run1.firstBattle.battleWorld ? run1.firstBattle.battleWorld.playerFunctionals : null)}`,
    );
    // 测试锁的**完整形态**：战斗里装出来的车逐槽等于存档那份 draft（不只是「武器 id 相同」）
    const storedSel = JSON.parse(stored1[BUILD_KEY]).functionalSelections;
    log(
      canon(firstBattleMounted(run1)) === canon(mountedMap(storedSel)),
      `B3b 测试锁（逐槽）：**战斗里真实装配的车** = 存档那份 Loadout（挂点级对账，不是只比一个 id）`,
      `存档=${canon(mountedMap(storedSel))} 战斗=${canon(firstBattleMounted(run1))}`,
    );
    log(
      !!run1.firstBattle && run1.firstBattle.build.length === 0,
      'B4 第一场开打时本局还没有任何 Run Buff（Build = 空）⇒ 后面拿到的强化确实是**这一局内部**发生的',
      `build=[${run1.firstBattle ? run1.firstBattle.build.join(',') : 'n/a'}]`,
    );
    log(
      run1.seen.includes('IDLE') && run1.seen.includes('EVENT') && run1.seen.includes('BATTLE'),
      'B5 第一场是一次**真实**战斗（相位真的走过 EVENT → BATTLE），不是脚本插值',
      `相位轨迹=${run1.seen.join('→')}`,
    );

    log(
      p1.phase === 'COMPLETE' && p1.complete === true && p1.failed === false,
      `C1 真实打完一整局 → RUN COMPLETE（用量 ${round2(run1.ms / 1000)}s）`,
      `phase=${p1.phase} battles=${p1.battlesCompleted}/${p1.battleTotal} 耐久=${p1.battle.durabilityPercent}%`,
    );
    log(
      p1.build.length === 2 && p1.buildLabels.length === 2 && p1.day > 1,
      'C2 本局确实攒下了 Run Buff 与进度（第二局要证明它们**不继承**，这里先证明第一局真的有）',
      `DAY ${p1.day} · Build=[${p1.build.join(',')}] (${p1.buildLabels.join('+')})`,
    );
    /* --------- C3：R2-A 验收 ②｜终点是**三张真实 Weapon 卡**（不是单件固定奖励） --------- */
    const rc = p1.rewardChoices;
    log(
      rc.length === 3 &&
        rc.every((c, i) => c.defId === CHOICE_IDS[i] && c.name === CHOICE_NAMES[CHOICE_IDS[i]]) &&
        rc.every((c) => c.star === 1 && c.energy > 0) &&
        rc.every((c, i) => c.countBefore === SEED_COUNTS[CHOICE_IDS[i]]) &&
        rc.every((c) => c.countAfter === c.countBefore + 1) &&
        rc[PICK_INDEX].previewText === `${SEED_COUNTS[WEAPON_B]} → ${SEED_COUNTS[WEAPON_B] + 1}` &&
        rc[PICK_INDEX].reachesThreshold === false &&
        p1.rewardChoicesDropped === 0,
      'C3 COMPLETE 出现**三张真实 Weapon 候选卡**（R2-A 验收 ②）：名称 / ★1 / 当前数量 → 领取后数量预览，且载荷零条被丢弃',
      `候选=${rc.map((c) => `${c.name}★${c.star} ${c.previewText}`).join(' | ')} dropped=${p1.rewardChoicesDropped}`,
    );
    log(
      p1.exitHref === null && p1.actionEnabled === false,
      'C3b 出口**在卡片上**：底栏那条通用按钮在终点态不可用、也没有产品出口（3选1 不存在「默认那件」）',
      `label=${p1.actionLabel} enabled=${p1.actionEnabled} exit=${p1.exitHref}`,
    );
    // 真实像素取证：三张卡真的画在画布上（不是只有探针字段）
    // ⚠️ 必须在**点卡之前**采：点中即整页导航 ⇒ `#run-canvas` 不复存在。
    // 阈值来源：三个矩形总面积 3 × 362 × 68 = 73848 px²，实测卡底 ≈ 58800（约 79.6%）
    // ⇒ 取 55000（约 74.5%）作为「成片」下界：排掉「只画了边框」，也给字体抗锯齿留余量。
    const choiceRects = p1.rewardChoiceRects;
    let cardBgPx = 0;
    for (const r of choiceRects) cardBgPx += await countColorInRect(page, r, CARD_BG);
    log(
      choiceRects.length === 3 && choiceRects.every((r) => r.w === 362 && r.h === 68) && cardBgPx > 55000,
      'C3c 三张候选卡真的画出来（真实 `getImageData`：三个矩形里都是成片的卡底像素）',
      `rects=${choiceRects.map((r) => `${r.x},${r.y} ${r.w}×${r.h}`).join(' | ')} cardBg=${cardBgPx}`,
    );
    // 本局的幂等键：第一局出发时首页生成的那个 token（领奖与「重复领取」都对着它）
    const token1 = home0.runToken;
    const ownClaims1 = CHOICE_IDS.map((id) => `./home.html?run=${token1}&reward=${id}`);
    log(
      rc.every((c, i) => c.href.includes(`run=${token1}`) && c.href.includes(`reward=${CHOICE_IDS[i]}`)) &&
        rc.every((c, i) => c.href === ownClaims1[i]) &&
        token1 === home0.runToken,
      'C4 三张卡的出口带的是**本局** token + **各自**的奖励 id（三条地址共用同一幂等键 ⇒ 谁先到谁入账，第二个必然落空）',
      `token=${token1} · ${rc.map((c) => c.href.replace('./home.html?', '')).join('  ')}`,
    );

    /* ---- 6) 点中 **Weapon B 那张卡** → 回首页入库（真实鼠标，不是底栏按钮） ---- */
    await Promise.all([
      page.waitForURL(/home\.html/, { timeout: 20000 }).catch(() => {}),
      clickRect(page, choiceRects[PICK_INDEX]),
    ]);
    await waitHomeReady(page);
    const home2 = await probeHome(page);
    const stored2 = await storageDump(page);
    log(
      home2.claim !== null && home2.claim.ok === true && home2.claim.defId === WEAPON_B,
      'D1 领奖在**产品侧**完成（页面只展示 Profile Repository 的真实结果）',
      `ok=${home2.claim ? home2.claim.ok : 'n/a'} def=${home2.claim ? home2.claim.defId : 'n/a'}`,
    );
    log(
      invCount(stored2, WEAPON_B) === SEED_COUNTS[WEAPON_B] + 1 &&
        invCount(stored2, WEAPON_A) === SEED_COUNTS[WEAPON_A] &&
        invCount(stored2, WEAPON_PRE) === SEED_COUNTS[WEAPON_PRE] &&
        ledgerTokens(stored2).length === 1 &&
        ledgerTokens(stored2)[0] === token1,
      `D2 **独立取证**（浏览器真实 localStorage）：只有 ${WEAPON_B} 从 ${SEED_COUNTS[WEAPON_B]} → ${SEED_COUNTS[WEAPON_B] + 1}（R2-A 验收 ③④），另两件一个数字都没动；账本记下本局 token`,
      `${WEAPON_A}=${invCount(stored2, WEAPON_A)} ${WEAPON_B}=${invCount(stored2, WEAPON_B)} ${WEAPON_PRE}=${invCount(stored2, WEAPON_PRE)} 账本=${JSON.stringify(ledgerTokens(stored2))}`,
    );

    /* ---- 7) 局外：Garage 看到 Weapon B 的**数量**长了 → 装备它 ---- */
    await clickSelector(page, '[data-ph-action="open-garage"]');
    const cardB = await weaponCard(page, WEAPON_B);
    const cardBSeed0 = SEED_COUNTS[WEAPON_B];
    log(
      !!cardB &&
        cardB.text.includes(WEAPON_B_NAME) &&
        cardB.star === '1' &&
        cardB.count === String(cardBSeed0 + 1) &&
        cardB.stackText === `${cardBSeed0 + 1}/5` &&
        cardB.threshold === String(FUSE_STACK),
      `D3 调整战车：刚领到的那件**读数长了一格**（${cardBSeed0} → ${cardBSeed0 + 1}，同一份 Inventory 数据，不是另造一套）`,
      cardB ? `[${WEAPON_B}] ${cardB.text} · data: star=${cardB.star} count=${cardB.count} stackText=${cardB.stackText}` : 'n/a',
    );
    await clickSelector(page, `[data-ph-weapon="${WEAPON_B}"]`);
    await clickSelector(page, '[data-ph-action="equip"]');
    const stored3 = await storageDump(page);
    log(
      storedWeaponSlot(stored3) === WEAPON_B,
      'D4 **独立取证**：装备 Weapon B 后，正式 Build 存档的主武器槽 = Weapon B',
      `${WEAPON_SLOT}=${storedWeaponSlot(stored3)}`,
    );

    /* ---- 8) 返回首页（**不刷新**）：同一页两个视图共享同一份状态 ---- */
    await clickSelector(page, '[data-ph-action="back-home"]');
    const home3 = await probeHome(page);
    log(
      home3.view === 'home' && home3.equippedWeaponId === WEAPON_B,
      'D4b 返回首页：**未刷新**，屏幕上显示的装备已同步为 Weapon B（首页 / 车库同一份状态）',
      `view=${home3.view} equipped=${home3.equippedWeaponId}`,
    );

    /*
      ⚠️ PRODUCT-LOOP-P0：这一段原先断言「第二次开始冒险的链接带的是 Weapon B」。
      现在**装着 Weapon B 根本不该有链接** ⇒ 断言随之改写，并且加了三条更强的：
        E1  不可执行（无 href + 资格=不支持 + 两句提示：探针与**真实 DOM** 双取证）
        E2  真鼠标点它**不导航**（守门在真实点击下成立，不是「点了没反应」的装饰）
        E2b 提示里的「调整战车」入口可直接执行
        E3  换回 cannon 后恢复可执行，链接带的装备 = 当前 Equipped
    */
    const blockedNotice = await compatNoticeDom(page);
    log(
      home3.startRunBlocked === true &&
        home3.startRunHref === null &&
        home3.runCompat.ok === false &&
        home3.runCompat.reason === 'unsupported-weapon' &&
        home3.runCompat.notice === '当前原型仅支持加农炮进行完整冒险' &&
        home3.runCompat.hint === '请先调整战车' &&
        !!blockedNotice &&
        blockedNotice.value === 'unsupported' &&
        blockedNotice.text.includes('当前原型仅支持加农炮进行完整冒险') &&
        blockedNotice.text.includes('请先调整战车'),
      `E1 装着 Weapon B（${WEAPON_B_NAME}）时「开始冒险」进入**不可执行**状态：没有 href + 资格=不支持 + 两句提示（探针与真实 DOM 都取证）`,
      `blocked=${home3.startRunBlocked} href=${home3.startRunHref} notice=${home3.runCompat.notice} hint=${home3.runCompat.hint}`,
    );

    const blockedUrlBefore = await page.evaluate(() => location.pathname + location.search);
    await clickSelector(page, '[data-ph-action="start-run"]');
    await sleep(600);
    const blockedUrlAfter = await page.evaluate(() => location.pathname + location.search);
    log(
      blockedUrlAfter === blockedUrlBefore &&
        blockedUrlAfter.startsWith('/home.html') &&
        (await probeHome(page)).startRunBlocked === true,
      'E2 真鼠标点「开始冒险」：**完全没有导航**、仍停在首页 ⇒ 非 cannon 时不可能进入 Run（不是「进去了再返回」）',
      `url ${blockedUrlBefore} → ${blockedUrlAfter}`,
    );

    await clickSelector(page, '[data-ph-action="open-garage"]');
    const garageForBack = await probeHome(page);
    log(
      garageForBack.view === 'garage',
      'E2b 提示「请先调整战车」可直接执行：真实点击进入调整战车（复用既有入口，没有新增第二个按钮）',
      `view=${garageForBack.view}`,
    );

    await clickSelector(page, `[data-ph-weapon="${WEAPON_A}"]`);
    await clickSelector(page, '[data-ph-action="equip"]');
    const stored3b = await storageDump(page);
    await clickSelector(page, '[data-ph-action="back-home"]');
    const home4 = await probeHome(page);
    const loadout2 = decodeLoadoutFromHref(home4.startRunHref ?? '');
    const payload2 = choicesOf(home4.startRunHref ?? '');
    const cardBAfter = home4.weapons.find((w) => w.defId === WEAPON_B);
    log(
      storedWeaponSlot(stored3b) === WEAPON_A &&
        home4.view === 'home' &&
        home4.equippedWeaponId === WEAPON_A &&
        home4.startRunBlocked === false &&
        !!loadout2 &&
        loadout2.functionalSelections[WEAPON_SLOT] === WEAPON_A &&
        (await compatNoticeDom(page)) === null,
      `E3 换回 Weapon A（${WEAPON_A_NAME}）：守门恢复放行（有 href / 提示消失 / 资格=通过），且链接带的装备 = 当前 Equipped`,
      `equipped=${home4.equippedWeaponId} blocked=${home4.startRunBlocked} 链接装备槽=${loadout2 ? loadout2.functionalSelections[WEAPON_SLOT] : 'n/a'}`,
    );
    log(
      !!payload2 &&
        !!cardBAfter &&
        cardBAfter.count === SEED_COUNTS[WEAPON_B] + 1 &&
        payload2.choices[PICK_INDEX].defId === WEAPON_B &&
        payload2.choices[PICK_INDEX].countBefore === SEED_COUNTS[WEAPON_B] + 1,
      'E3b 第二次出发的载荷读的是**领奖之后**的库存（候选读数已累积到 2 ⇒ 预览 2 → 3，不是出发时那份旧快照）',
      payload2
        ? `载荷=${payload2.choices.map((c) => `${c.defId}:${c.countBefore}`).join(' ')} · 卡片=${cardBAfter ? cardBAfter.count : 'n/a'}`
        : 'n/a',
    );

    /* ---- 9) 整页 reload：状态确实来自真实持久化（不是内存） ---- */
    await page.reload({ waitUntil: 'load' });
    await waitHomeReady(page);
    const afterReload = await probeHome(page);
    const cardBReload = afterReload.weapons.find((w) => w.defId === WEAPON_B);
    log(
      afterReload.equippedWeaponId === WEAPON_A &&
        afterReload.startRunBlocked === false &&
        !!cardBReload &&
        cardBReload.count === SEED_COUNTS[WEAPON_B] + 1,
      `D5 整页 reload：累积出来的数量（${SEED_COUNTS[WEAPON_B] + 1}/5）与「仍装着换回来的 ${WEAPON_A_NAME}」都来自真实持久化（不是页面内存）`,
      `equipped=${afterReload.equippedWeaponId} ${WEAPON_B}=${cardBReload ? cardBReload.count : 'n/a'}`,
    );

    /* ============================================================ 第二局 */

    await Promise.all([
      page.waitForURL(/run-page\.html/, { timeout: 20000 }).catch(() => {}),
      clickSelector(page, '[data-ph-action="start-run"]'),
    ]);
    await waitRunReady(page);
    const runStart2 = await probeRun(page);

    /* ---- 证明 1 / 3：新 Run 状态干净 ---- */
    log(
      runStart2.phase === 'IDLE' &&
        runStart2.day === 1 &&
        runStart2.build.length === 0 &&
        runStart2.buffs.length === 0 &&
        runStart2.buffIconCount === 0 &&
        runStart2.repairBonus === 0 &&
        runStart2.battlesCompleted === 0 &&
        runStart2.battle === null &&
        runStart2.complete === false &&
        runStart2.failed === false,
      'F1 第二局起点**干净**：DAY 1 / Run Buff 空 / 维修补偿 0 / 无残留战斗（第一局是 DAY ' +
        p1.day +
        ' + 两层 Build）',
      `day=${runStart2.day} build=[${runStart2.build.join(',')}] buffs=${runStart2.buffs.length} repair=${runStart2.repairBonus} battle=${runStart2.battle}`,
    );
    log(
      runStart2.playerLoadout.source === 'profile' &&
        runStart2.playerLoadout.fallback === 'none' &&
        runStart2.playerLoadout.functionalSelections[WEAPON_SLOT] === WEAPON_A,
      `F2 第二局的装载来源仍是 profile，且主武器槽 = **Weapon A（${WEAPON_A_NAME}）**（继承的是局外装备；P0 起完整 Run 只支持它）`,
      `${WEAPON_SLOT}=${runStart2.playerLoadout.functionalSelections[WEAPON_SLOT]}`,
    );

    /* ---- 第二局第一场：真实使用 Weapon B + HP/Buff 不继承 ---- */
    const run2 = await driveFirstBattleThenStop(page);
    const p2 = run2.probe;
    log(
      p2.phase === 'BATTLE' && p2.battleWorld !== null,
      'F3 第二局第一场真的打起来了（BATTLE + 真实战斗世界）',
      `phase=${p2.phase} steps=${p2.battle ? p2.battle.steps : 'n/a'}`,
    );
    log(
      firstBattleWeapon(run2) === WEAPON_A,
      `F4 **测试锁（第二局）**：Run 第一场实际 Weapon Def ID（${firstBattleWeapon(run2)}）= Profile Equipped Weapon ID（${profileEquippedWeapon(stored3b)}）`,
      `battle=${JSON.stringify(p2.battleWorld.playerFunctionals)}`,
    );
    const sel2 = JSON.parse(stored3b[BUILD_KEY]).functionalSelections;
    log(
      canon(firstBattleMounted(run2)) === canon(mountedMap(sel2)),
      `F4b 第二局测试锁（逐槽）：战斗里真实装配的车 = 局外刚换上的那份 Loadout（挂点级对账）`,
      `存档=${canon(mountedMap(sel2))} 战斗=${canon(firstBattleMounted(run2))}`,
    );
    log(
      p2.battle !== null && p2.battle.playerHp === p2.battle.playerHpMax && p2.battle.playerHp > 0,
      'F5 证明 2｜HP 不继承：第二局第一场从**满耐久**开始（不是第一局打剩的血）',
      `HP ${p2.battle ? p2.battle.playerHp : 'n/a'} / ${p2.battle ? p2.battle.playerHpMax : 'n/a'}`,
    );
    log(
      p2.build.length === 0 && p2.buffs.length === 0 && p2.buffIconCount === 0,
      'F6 证明 1｜Run Buff 不继承：第二局第一场开打时 Build 仍为空、顶部没有强化图标',
      `build=[${p2.build.join(',')}] buffs=${p2.buffs.length}`,
    );
    /*
      ⚠️ 采样点是「第二局第一场**战斗进行中**」⇒ 此刻的 DAY 已经不是起点的 DAY 1
      （本局的 Day 在开打时会走一格，第一局从 DAY 1 一路涨到 DAY 7）。
      所以这里**不能用 `day === 1` 当判据**（那是 F1 判据，采样时机不同）；
      正确的证法是：第二局的 DAY 必须**远小于**第一局结束时的 DAY，
      且已完成的战斗数归零 —— 这才叫「没有继承」。起点 DAY 1 由 F1 独立证明。
    */
    log(
      p2.day < p1.day && p2.battlesCompleted === 0,
      'F7 证明 3｜Day 不继承：第二局的 DAY 远小于第一局结束时（起点已是 DAY 1，见 F1）',
      `day=${p2.day}（第一局结束 DAY ${p1.day}）battles=${p2.battlesCompleted}`,
    );

    /* ---- 证明 4：Permanent Inventory 继承（R2-A：继承的是**数量**） ---- */
    const stored4 = await storageDump(page);
    log(
      invCount(stored4, WEAPON_B) === SEED_COUNTS[WEAPON_B] + 1 &&
        invCount(stored4, WEAPON_A) === SEED_COUNTS[WEAPON_A] &&
        invCount(stored4, WEAPON_PRE) === SEED_COUNTS[WEAPON_PRE],
      `F8 证明 4｜Permanent Inventory 继承：第一局领到的那件数量已累积（${SEED_COUNTS[WEAPON_B]} → ${SEED_COUNTS[WEAPON_B] + 1}），另两件保持不动`,
      `${WEAPON_A}=${invCount(stored4, WEAPON_A)} ${WEAPON_B}=${invCount(stored4, WEAPON_B)} ${WEAPON_PRE}=${invCount(stored4, WEAPON_PRE)}`,
    );

    /* ---- 证明 6：Reward 不重复领取 ---- */
    // ⚠️ 必须用 **token1**（第一局出发时那个、已经被领过的 token），不是 home3.runToken：
    //    home3 是 reload 之后的新挂载，它会生成一个**全新**的 token ⇒ 拿它当幂等键只会
    //    领到第二件奖励（库存再 +1），测出来的是「新 token 能领奖」而不是「同一个 token 不能重复领」。
    const dupPage = await ctx.newPage();
    await dupPage.goto(`${URL_BASE}/home.html?run=${token1}&reward=${WEAPON_B}`, {
      waitUntil: 'load',
    });
    await waitHomeReady(dupPage);
    const dup = await probeHome(dupPage);
    const dupStored = await storageDump(dupPage);
    log(
      dup.claim !== null && dup.claim.ok === false && dup.claim.reason === 'already-claimed',
      'G1 证明 6｜Reward 不重复领取：重开同一领奖 URL → Repository 判「已领取」',
      `ok=${dup.claim ? dup.claim.ok : 'n/a'} reason=${dup.claim ? dup.claim.reason : 'n/a'}`,
    );
    log(
      invCount(dupStored, WEAPON_B) === SEED_COUNTS[WEAPON_B] + 1 && ledgerTokens(dupStored).length === 1,
      'G2 库存没有再 +1、账本没有 +1（重复领取不重复发奖）',
      `${WEAPON_B}=${invCount(dupStored, WEAPON_B)} 账本=${ledgerTokens(dupStored).length}`,
    );
    await dupPage.close();

    /*
      ⚠️ R2-A 新增的一条：**同一个 token 换一件**也领不到。
      3选1 之后「三个不同的领奖地址」是产品侧真的会发出去的（三张卡各一条），
      因此必须证明幂等键绑的是 **run token** 而不是「地址」——
      否则玩家点开另一张卡的地址就能把同一局再领一次。
    */
    const dup2Page = await ctx.newPage();
    await dup2Page.goto(`${URL_BASE}/home.html?run=${token1}&reward=${CHOICE_IDS[0]}`, {
      waitUntil: 'load',
    });
    await waitHomeReady(dup2Page);
    const dup2 = await probeHome(dup2Page);
    const dup2Stored = await storageDump(dup2Page);
    log(
      dup2.claim !== null &&
        dup2.claim.ok === false &&
        dup2.claim.reason === 'already-claimed' &&
        invCount(dup2Stored, CHOICE_IDS[0]) === SEED_COUNTS[CHOICE_IDS[0]] &&
        ledgerTokens(dup2Stored).length === 1,
      `G3 同一 token **换一件**（${CHOICE_IDS[0]}）也领不到 ⇒ 幂等键绑的是 Run token，不是地址（三条候选地址共用它）`,
      `reason=${dup2.claim ? dup2.claim.reason : 'n/a'} ${CHOICE_IDS[0]}=${invCount(dup2Stored, CHOICE_IDS[0])} 账本=${ledgerTokens(dup2Stored).length}`,
    );
    await dup2Page.close();

    /* ---- 证明 7：Validation 入口仍独立可用 ---- */
    const hubPage = await ctx.newPage();
    const hubErrors = [];
    hubPage.on('pageerror', (e) => hubErrors.push(String(e)));
    await hubPage.goto(`${URL_BASE}/validation-hub.html`, { waitUntil: 'load' });
    await hubPage.waitForSelector('.vhub-card', { timeout: 15000 }).catch(() => {});
    const hubCards = await hubPage.$$eval('.vhub-card', (ns) =>
      ns.map((n) => n.textContent || ''),
    );
    const hubHasFullRun = hubCards.some((t) => t.includes('完整一局'));
    await hubPage.close();

    const barePage = await ctx.newPage();
    const bareErrors = [];
    barePage.on('pageerror', (e) => bareErrors.push(String(e)));
    await barePage.goto(`${URL_BASE}/run-page.html`, { waitUntil: 'load' });
    await waitRunReady(barePage);
    const bare = await probeRun(barePage);
    await barePage.close();

    const labPage = await ctx.newPage();
    const labErrors = [];
    labPage.on('pageerror', (e) => labErrors.push(String(e)));
    await labPage.goto(`${URL_BASE}/portrait-lab.html`, { waitUntil: 'load' });
    await sleep(1200);
    const labOk = await labPage.evaluate(() => document.querySelectorAll('canvas').length > 0);
    await labPage.close();

    log(
      hubCards.length === 4 && hubHasFullRun && hubErrors.length === 0,
      'H1 证明 7｜验证中心仍独立可用（四张入口卡，含「完整一局」）+ 零报错',
      `cards=${hubCards.length} · ${hubCards.length ? hubCards.map((t) => t.trim().split('\n')[0]).join(' / ') : ''}`,
    );
    log(
      bare.playerLoadout.source === 'demo' &&
        bare.playerLoadout.fallback === 'no-param' &&
        bare.phase === 'IDLE',
      'H2 研发入口 `/run-page.html`（**不带**产品参数）行为不变：退回演示装载 + DAY 1',
      `source=${bare.playerLoadout.source} fallback=${bare.playerLoadout.fallback} tag=${bare.playerLoadout.tag}`,
    );
    log(
      labOk && labErrors.length === 0,
      'H3 Debug 面 `portrait-lab.html` 仍独立可用（Arena A 画布存在）+ 零报错',
      `canvas=${labOk}`,
    );

    log(pageErrors.length === 0, 'I1 全流程零运行时报错', pageErrors.slice(0, 3).join(' | ') || 'none');
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

/** 读正式 Build 存档的武器槽（与 `profileEquippedWeapon` 同义，供页面内断言复用）。 */
function storedWeaponSlot(dump) {
  return profileEquippedWeapon(dump);
}

/**
 * 第二局只打到「第一场真的打起来」为止（不跑完 —— 本 Queue 只要求证明第一场用了新装备）。
 *
 * ⚠️ 必须在**战斗中**取样：`battleWorld` 只在战斗存在时非空。
 */
async function driveFirstBattleThenStop(page) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < 60000) {
    const p = await probeRun(page);
    last = p;
    if (p.phase === 'BATTLE' && p.battleWorld && p.battle && p.battle.steps >= 1) {
      /*
        ⚠️ 必须把这份**战斗中的**快照同时当作 `firstBattle` 返回：
        `battleWorld` 只在战斗存在时非空（战斗一结束世界就没了），
        而 `firstBattleWeapon` / `firstBattleMounted` 都从这个字段取证 ⇒
        只返回 `{ probe }` 会让「第一场实际装了什么」永远读到 null。
      */
      return { probe: p, firstBattle: p };
    }
    if (p.phase === 'FAILED' || p.phase === 'COMPLETE') break;
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
    await sleep(160);
  }
  throw new Error(
    `第二局未能进入第一场战斗（最后 phase=${last ? last.phase : 'n/a'} step=${last && last.battle ? last.battle.steps : 'n/a'}）`,
  );
}

main().catch((e) => {
  console.error('SMOKE 异常：', e);
  process.exit(1);
});
