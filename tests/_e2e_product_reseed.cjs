/**
 * PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1｜**真实产品入口** smoke（真实浏览器 + 真实 localStorage）。
 *
 * ── 本文件要证的五件事 ─────────────────────────────────────────────────────────
 *   ① **验收 ①**：用一份「上一轮 R2 验证**已经合成过 ★2**」的 persisted profile 启动正式入口
 *      ⇒ 自动**一次性**恢复成 `Cannon ★1 = 4/5` 且**装备 ★1**（★2 被清掉）；
 *   ② **验收 ②**：再刷新 / 重进 ⇒ reseed **不重复执行**（Build / 库存 / 账本逐字节不变）；
 *   ③ **验收 ③**：恢复之后**真的**能走完完整数据链 ——
 *      `4/5 → 打一局真实战斗 → COMPLETE → 领奖 → 5/5 → Garage 合成 → ★2 → 自动装备 ★2`
 *      →（回首页）下一局地址里的装备载荷已经是 ★2；
 *   ④ **必改 2 / 验收 ④**：其他 Weapon / Movement / 进度**一个字节都不动**（逐条对账，不是抽样）；
 *   ⑤ **回归（门禁抓出的真实丢档路径）**：首入判定**只做一次** —— 新账号首入时判据还不成立，
 *      但标记照样落盘；玩家之后**自己**合成出来的 ★2 绝不会在下一次挂载被当成「上一轮的产物」清掉
 *      （R5a..R5c；这条路径正是 `e2e:product-reward` 在门禁里抓出来的那个 bug）。
 *
 * ⚠️ 本文件与 `_e2e_product_legacy_profile.cjs` 同一性质：**一次迁移一个 E2E**。
 *    它**不重复** star_power / loop / reward / fail 的既有覆盖（奖励怎么发、合成怎么算、
 *    伤害怎么变都在那几条里）；这里只证明「上一轮验证把起点消费掉的账号能被拉回起点，
 *    并且拉回去之后那条链**真的**能再走一遍」。
 *
 * 手段（与既有产品 E2E 同一纪律，全部真实行为取证）：
 *   - 真实浏览器（playwright-core / msedge）+ 独立产物 `dist-portrait-lab/`；
 *   - **真实鼠标点击**（`page.mouse.click`；Run 页按画布真实 CSS 矩形做逻辑→屏幕换算）；
 *   - **真实整页导航**（`<a href>` 由浏览器执行，不做 evaluate 跳转）；
 *   - **真实 localStorage 读写**（注入夹具 / 读回库存 / 读回 Build 存档，全部绕过页面探针）；
 *   - 只读诊断句柄 `window.__PRODUCTHOME__` / `window.__RUNPAGE__`。
 *
 * ⚠️ 两个**踩过的坑**（写在这里，避免下一个人重踩）：
 *   1. `page.waitForURL(/home\.html/)` 会被 Run 页自己的地址**当场匹配** ——
 *      它的查询串里有 `home=.%2Fhome.html` 这个参数取值。必须用 **pathname 谓词**。
 *   2. `page.route` 的 `**` glob 在本仓真实链路里**一次都没拦到**过（实测），
 *      要「挂起导航」只能改测试自己的静态服务器。
 *
 * 用法：
 *   npm run build:portrait-lab
 *   node tests/_e2e_product_reseed.cjs   （或 npm run e2e:product-reseed）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
/** 端口刻意与其它产品 E2E 不同（8166..8171 已被占用），方便并行排查。 */
const PORT = 8172;
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

/** 正式存档 key（与 src 同值；E2E 独立写死，不 import 被测模块）。 */
const BUILD_KEY = 'strongfruit.playerBuild.v1';
const INV_KEY = 'strongfruit.ownedParts.v2';
const PROGRESS_KEY = 'strongfruit.playerProgress.v1';
const CLAIMS_KEY = 'strongfruit.profileClaims.v1';
/** 旧 R2 onboarding 标记（R2-RECOVERY 落的那一个 —— 本 Queue **不许复用**它）。 */
const ONBOARDING_KEY = 'strongfruit.r2Onboarding.v1';
/** 本 Queue 的**新**标记 key（独立写死：报文写的就是它）。 */
const RESEED_KEY = 'strongfruit.r2Reseed.v1';
// PRODUCT-LOOP-R3-MOVEMENT-CHOICE-SEED：第三份一次性迁移的标记（key 闭集白名单用）
const MOVEMENT_SEED_KEY = 'strongfruit.r3MovementChoiceSeed.v1';

const WEAPON_SLOT = 'frontMass';
const EMPTY = 'none';
/** 满 stack 阈值（与 `playerGrowth.FUSE_STACK` 同值）。 */
const FUSE_STACK = 5;
/** 正式 cannon 基准伤害与 ★2 的理论值（卡面文本用；产品侧只读 core，不自算）。 */
const CANNON_BASE_DAMAGE = 80;
const CANNON_STAR2_DAMAGE = 100;

/**
 * 夹具 ①｜「上一轮 R2 验证**已经消费掉起点**」的 Build —— **明文写死**（不 import src：
 * 它描述的是磁盘上真实存在过的数据）。
 *   - 主武器槽装的是 **★2 的炮**（`functionalStars.frontMass = 2`）；
 *   - `front` 是空槽（产品 R1-C 起默认车就不挂推杆 ⇒ 不会误命中旧 starter 迁移的判别式）。
 */
const CONSUMED_BUILD = {
  bodyDefId: 'watermelonBody',
  rearRadius: 20,
  frontRadius: 20,
  drive: 'forward',
  functionalSelections: { rear: EMPTY, front: EMPTY, [WEAPON_SLOT]: 'cannon', top: 'hammer' },
  functionalStars: { [WEAPON_SLOT]: 2 },
};

/** 夹具 ②｜库存：`cannon ★1 = 1`（新领的那件）+ `cannon ★2 = 1`（上一轮合成的产物）。 */
const CONSUMED_INV = {
  cannon: { one: 1, two: 1 },
  /** 别的 Weapon 也有成长 —— 用来证「不是重置整个 Profile」 */
  spear: { one: 2, two: 1 },
  hammer: { one: 1, two: 0 },
  pushRod: { one: 1, two: 0 },
  /** Movement（轮组）也在 */
  smallWheel: { one: 1, two: 0 },
};

/** 夹具 ③｜一份可辨认的进度记录（迁移不该碰它）。 */
const CONSUMED_PROGRESS = { cleared: 3, best: 7 };
/**
 * 夹具 ⑥｜玩家**自己**走完 `首入 → 领奖 → 5/5 → 合成` 之后的库存（★1 归 0、★2 = 1）。
 *
 * 用来取证**门禁抓出的那条真实丢档路径**（见 R5b）：新账号首入时判据 ③ 还不成立，
 * 若「首入判定」不落标记，玩家自己合出来的 ★2 会在下一次挂载被误当成「上一轮的产物」清掉。
 */
const SELF_FUSED_INV = { ...CONSUMED_INV, cannon: { one: 0, two: 1 } };
/** 夹具 ④｜旧 R2 onboarding 标记：**已消费**（版本 1）。 */
const CONSUMED_ONBOARDING = { version: 1 };
/** 夹具 ⑤｜领奖账本：真的领过奖（= 走过产品验证链）。 */
const CONSUMED_CLAIMS = { grantedRunIds: ['run-r2-validation'] };

/** 赢：耐久事件选「维修」→ 终局有耐久 → COMPLETE（与 star_power / reward 同一条确定性路线）。 */
const WIN_POLICY = { layer1: 'twinCannon', lateral: null, layer2: 'tripleLoad', durability: 'repair' };
const DRIVE_BUDGET_MS = 240000;

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

/** 注入「上一轮验证已消费起点」的整份账号（5 个 key）。 */
async function injectConsumedProfile(page) {
  await page.evaluate(
    ({ keys, build, inv, progress, claims, onboarding }) => {
      localStorage.setItem(keys.build, JSON.stringify({ ...build, __v: 1 }));
      localStorage.setItem(keys.inv, JSON.stringify({ ...inv, __v: 1 }));
      localStorage.setItem(keys.progress, JSON.stringify(progress));
      localStorage.setItem(keys.claims, JSON.stringify({ ...claims, __v: 1 }));
      localStorage.setItem(keys.onboarding, JSON.stringify({ ...onboarding, __v: 1 }));
      localStorage.removeItem(keys.reseed); // 本队列的标记必须**不存在**（否则测的不是「首次」）
    },
    {
      keys: {
        build: BUILD_KEY,
        inv: INV_KEY,
        progress: PROGRESS_KEY,
        claims: CLAIMS_KEY,
        onboarding: ONBOARDING_KEY,
        reseed: RESEED_KEY,
      },
      build: CONSUMED_BUILD,
      inv: CONSUMED_INV,
      progress: CONSUMED_PROGRESS,
      claims: CONSUMED_CLAIMS,
      onboarding: CONSUMED_ONBOARDING,
    },
  );
  return storageDump(page);
}

const STAR_FIELDS = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five' };

/** 从 storage dump 里读某个 `(defId, star)` 的副本数（映射在这里独立写一份）。 */
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

/** 从**正式 Build 存档**里读武器槽星级（键缺省 ⇒ ★1，与 `buildEditorModel` 约定一致）。 */
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

/**
 * 「除 cannon 之外的库存条目**逐条**对账」。
 *
 * ⚠️ 两边的**缺键语义**都必须按 0 处理（注入的夹具是**局部**对象，读回来的是 core 归一化后的
 *    完整对象 ⇒ 直接比 JSON 会把「补 0」当成「改动」）。
 */
function nonCannonDiff(beforeLiteral, afterRaw) {
  const after = JSON.parse(afterRaw);
  const keys = new Set([...Object.keys(beforeLiteral), ...Object.keys(after)]);
  keys.delete('cannon');
  const diffs = [];
  for (const k of [...keys].sort()) {
    for (const f of ['one', 'two', 'three', 'four', 'five']) {
      const b = Number(((beforeLiteral[k] || {})[f]) ?? 0);
      const a = Number(((after[k] || {})[f]) ?? 0);
      if (a !== b) diffs.push(`${k}.${f}: ${b} → ${a}`);
    }
  }
  return diffs;
}

/** 从出发链接里取产品侧交给 Run 的那份装备（URL 编码后的 BuildDraft）。 */
function equippedOf(href) {
  const raw = new URLSearchParams(href.split('?')[1] ?? '').get('equipped') ?? '';
  return raw ? JSON.parse(raw) : null;
}

/** 读 Garage 里某张 Weapon 卡的真实 DOM 读数。 */
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
        damageLineText: dmgLine ? dmgLine.textContent : null,
        cards: all.length,
      };
    },
    { id: defId, s: star },
  );
}

/* ------------------------------------------------------------------ Run 驱动 */

/** 把一局 Run 驱到终态（真实鼠标点击；COMPLETE / FAILED 即停）。 */
async function driveRun(page, policy, label) {
  const t0 = Date.now();
  const seen = [];
  let last = null;
  let stopped = 'timeout';
  while (Date.now() - t0 < DRIVE_BUDGET_MS) {
    const p = await probeRun(page);
    if (!last || last.phase !== p.phase) seen.push(p.phase);
    last = p;
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
  return { label, stopped, ms: Date.now() - t0, seen, last };
}

/* ------------------------------------------------------------------- 主流程 */

async function main() {
  console.log('=== PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1｜一次性 reseed（真实入口）===\n');

  for (const f of ['home.html', 'run-page.html']) {
    if (!fs.existsSync(path.join(ROOT, f))) {
      console.error(`未找到 ${path.join(ROOT, f)} —— 请先 npm run build:portrait-lab`);
      process.exit(1);
    }
  }

  const server = await startServer();
  log(true, 'R0 静态产物就绪（home.html / run-page.html 真实存在）');

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  try {
    /* ==================================================================================
       R1｜注入「上一轮 R2 验证已经把起点消费掉」的真实账号
       ================================================================================== */
    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const seeded = await injectConsumedProfile(page);
    const b0 = JSON.parse(seeded[BUILD_KEY]);
    log(
      invCount(seeded, 'cannon', 1) === 1 &&
        invCount(seeded, 'cannon', 2) === 1 &&
        b0.functionalSelections[WEAPON_SLOT] === 'cannon' &&
        b0.functionalStars?.[WEAPON_SLOT] === 2 &&
        !!seeded[ONBOARDING_KEY] &&
        !!seeded[CLAIMS_KEY] &&
        seeded[RESEED_KEY] === undefined,
      'R1 夹具 = Queue 描述的真实形态：`cannon ★1 = 1` / `★2 = 1` / Build 装的是 ★2 / 旧 onboarding 标记已消费 / 有领奖记录 / **本轮标记不存在**',
      `★1×${invCount(seeded, 'cannon', 1)} ★2×${invCount(seeded, 'cannon', 2)} equipped★${(b0.functionalStars || {})[WEAPON_SLOT]} 旧标记=${!!seeded[ONBOARDING_KEY]} 新标记=${!!seeded[RESEED_KEY]}`,
    );

    /* ==================================================================================
       R2｜打开正式入口 → 一次性恢复（验收 ①/必改 3）
       ================================================================================== */
    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const probe1 = await probeHome(page);
    const afterReseed = await storageDump(page);
    log(
      probe1.growth.reseedApplied === true &&
        probe1.growth.reseedReason === 'reseeded' &&
        probe1.growth.reseedCleared === 1 &&
        probe1.growth.reseedCannon === FUSE_STACK - 1,
      'R2 **验收 ①**｜打开首页就**自动一次性恢复**：`cannon ★1` 回到 4/5、清掉上一轮验证的 ★2（页面读数与判定结果同源）',
      `applied=${probe1.growth.reseedApplied} reason=${probe1.growth.reseedReason} cleared=${probe1.growth.reseedCleared} ★1=${probe1.growth.reseedCannon}`,
    );
    log(
      invCount(afterReseed, 'cannon', 1) === 4 &&
        invCount(afterReseed, 'cannon', 2) === 0 &&
        invCount(afterReseed, 'cannon', 3) === 0 &&
        invCount(afterReseed, 'cannon', 4) === 0 &&
        invCount(afterReseed, 'cannon', 5) === 0,
      'R2b **落盘取证**：磁盘上 `cannon ★1 = 4` 且 **★2..★5 全部为 0**（真实 localStorage，不经过探针）',
      `★1×${invCount(afterReseed, 'cannon', 1)} ★2×${invCount(afterReseed, 'cannon', 2)} ★3×${invCount(afterReseed, 'cannon', 3)}`,
    );
    const b1 = JSON.parse(afterReseed[BUILD_KEY]);
    log(
      b1.functionalSelections[WEAPON_SLOT] === 'cannon' &&
        b1.functionalStars === undefined &&
        storedWeaponStar(afterReseed) === 1 &&
        probe1.equippedWeaponId === 'cannon' &&
        probe1.equippedWeaponStar === 1,
      'R2c **必改 3**｜恢复后是**真实 pre-fusion 态**：主武器槽装的是 `cannon ★1`（★1 = 缺省 ⇒ `functionalStars` **整个键都必须不存在**）—— 存档、探针两侧一致',
      `frontMass=${b1.functionalSelections[WEAPON_SLOT]} functionalStars=${JSON.stringify(b1.functionalStars ?? null)} 存档★${storedWeaponStar(afterReseed)} 探针★${probe1.equippedWeaponStar}`,
    );
    log(
      !!afterReseed[RESEED_KEY] && afterReseed[ONBOARDING_KEY] === seeded[ONBOARDING_KEY],
      'R2d **必改 1**｜标记写在**本队列自己的新 key** 上；旧标记（`r2Onboarding.v1`）既未被复用也未被改写',
      `reseed=${afterReseed[RESEED_KEY]} 旧标记={"version":1}=${afterReseed[ONBOARDING_KEY] === seeded[ONBOARDING_KEY]}`,
    );

    /* ---- 必改 2 / 验收 ④：其他 Weapon / Movement / 进度逐条不动 ---- */
    const diff = nonCannonDiff(CONSUMED_INV, afterReseed[INV_KEY]);
    log(
      diff.length === 0,
      'R2e **必改 2 / 验收 ④**｜除 cannon 之外的库存条目**逐条不变**（spear ★2 成长 / hammer / pushRod / 轮组全部保留）',
      diff.length === 0
        ? `spear ★1=${invCount(afterReseed, 'spear', 1)} ★2=${invCount(afterReseed, 'spear', 2)} hammer=${invCount(afterReseed, 'hammer', 1)} wheel=${invCount(afterReseed, 'smallWheel', 1)}`
        : diff.join(' · '),
    );
    log(
      afterReseed[PROGRESS_KEY] === seeded[PROGRESS_KEY] &&
        afterReseed[CLAIMS_KEY] === seeded[CLAIMS_KEY],
      'R2f **不清档**：进度与领奖账本两个 key **逐字节不变**（本迁移不删 key、不重置 Profile）',
      `progress=${afterReseed[PROGRESS_KEY] === seeded[PROGRESS_KEY]} claims=${afterReseed[CLAIMS_KEY] === seeded[CLAIMS_KEY]}`,
    );
    const keysAfter = Object.keys(afterReseed).sort();
    /*
      ⚠️ PRODUCT-LOOP-R3-MOVEMENT-CHOICE-SEED 追加了**第 7 个** key
      （`strongfruit.r3MovementChoiceSeed.v1`，一次性 Movement 可选方案种子的标记）——
      它在本场景里由注入的「历史账号」首入时落下。
      **仍然只是白名单 +1，闭集语义一字未改**：多出任何别的 key 这一条照样红。
    */
    log(
      JSON.stringify(keysAfter) ===
        JSON.stringify(
          [CLAIMS_KEY, INV_KEY, ONBOARDING_KEY, PROGRESS_KEY, RESEED_KEY, BUILD_KEY, MOVEMENT_SEED_KEY].sort(),
        ),
      'R2g key 集合 = 注入的 5 个 + 本队列自己的 1 个新标记 + Movement 种子标记（没有凭空多出别的写入）',
      keysAfter.join(' · '),
    );

    /* ==================================================================================
       R3｜刷新 / 重进 ⇒ reseed 不重复执行（验收 ②）
       ================================================================================== */
    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const probe2 = await probeHome(page);
    const afterReload = await storageDump(page);
    log(
      probe2.growth.reseedApplied === false &&
        probe2.growth.reseedReason === 'already-marked' &&
        afterReload[INV_KEY] === afterReseed[INV_KEY] &&
        afterReload[BUILD_KEY] === afterReseed[BUILD_KEY] &&
        afterReload[RESEED_KEY] === afterReseed[RESEED_KEY],
      'R3 **验收 ②**｜reload ⇒ `already-marked`，库存 / Build / 标记三份存档**逐字节不变**（一次性）',
      `applied=${probe2.growth.reseedApplied} reason=${probe2.growth.reseedReason} invSame=${afterReload[INV_KEY] === afterReseed[INV_KEY]} buildSame=${afterReload[BUILD_KEY] === afterReseed[BUILD_KEY]}`,
    );

    /* ==================================================================================
       R4｜恢复后的**完整数据链**（验收 ③）：4/5 → 领奖 → 5/5 → 合成 → ★2 → 自动装备
       ================================================================================== */
    await clickSelector(page, '[data-ph-action="open-garage"]');
    const card1 = await garageCard(page, 'cannon', 1);
    log(
      !!card1 &&
        card1.count === '4' &&
        card1.stackText === '4/5' &&
        card1.damageLineText === `攻击 ${CANNON_BASE_DAMAGE} → ${CANNON_STAR2_DAMAGE}` &&
        card1.cards === 1,
      'R4 **验收 ③ 起点**｜Garage 里**只有一张** cannon 卡（★1，4/5），卡面已写明升星后是多少 —— 上一轮那张 ★2 卡确实没了',
      card1 ? `count=${card1.count} stackText=${card1.stackText} 行="${card1.damageLineText}" 卡片数=${card1.cards}` : 'n/a',
    );
    await clickSelector(page, '[data-ph-action="back-home"]');
    const homeBeforeRun = await probeHome(page);
    const equipPayload0 = equippedOf(homeBeforeRun.adventureHref);

    await Promise.all([
      page.waitForURL((u) => u.pathname === '/run-page.html', { timeout: 20000 }).catch(() => {}),
      clickSelector(page, '[data-ph-action="start-run"]'),
    ]);
    await waitRunReady(page);
    const run = await driveRun(page, WIN_POLICY, '恢复后的一局');
    const pDone = run.last;
    log(
      run.stopped === 'COMPLETE' && !!pDone,
      'R4b 恢复后的这一局**真的**能走到 COMPLETE（真实战斗，真实鼠标）',
      `stopped=${run.stopped} ms=${run.ms} phases=${run.seen.join('→')}`,
    );

    /* ---- 原点：底栏唯一 CTA「领取并返回」（卡片纯展示） ---- */
    log(
      pDone.actionEnabled === true && pDone.actionLabel === '领取并返回',
      'R4c 终点的唯一出口是底栏 CTA「领取并返回」且可用',
      `label=${pDone.actionLabel} enabled=${pDone.actionEnabled}`,
    );
    await Promise.all([
      page.waitForURL((u) => u.pathname === '/home.html', { timeout: 20000 }).catch(() => {}),
      clickRect(page, pDone.actionRect),
    ]);
    await waitHomeReady(page);
    const afterClaim = await storageDump(page);
    log(
      invCount(afterClaim, 'cannon', 1) === 5,
      'R4d 领到 cannon ⇒ 库存 **5/5**（真实鼠标按下 CTA + 真实整页导航回来）',
      `★1×${invCount(afterClaim, 'cannon', 1)}`,
    );

    /* ---- Garage：5 合 1 → ★2 自动装备 ---- */
    await clickSelector(page, '[data-ph-action="open-garage"]');
    const g1 = await probeHome(page);
    const cardFull = await garageCard(page, 'cannon', 1);
    log(
      !!cardFull && cardFull.fusable === 'true' && cardFull.stackText === '5/5',
      'R4e 5/5 的 ★1 炮：卡上「可合成」亮起（合成按钮真的可用）',
      cardFull ? `stackText=${cardFull.stackText} fusable=${cardFull.fusable}` : 'n/a',
    );
    await clickSelector(page, `[data-ph-action="fuse"][data-ph-fuse-def="cannon"][data-ph-fuse-star="1"]`);
    const g2 = await probeHome(page);
    const afterFuse = await storageDump(page);
    log(
      g2.lastFuse &&
        g2.lastFuse.ok === true &&
        g2.lastFuse.fromStar === 1 &&
        g2.lastFuse.toStar === 2 &&
        g2.lastFuse.countAfter === 0 &&
        g2.lastFuse.productCount === 1 &&
        g2.lastFuse.equippedUpgraded === true &&
        invCount(afterFuse, 'cannon', 1) === 0 &&
        invCount(afterFuse, 'cannon', 2) === 1 &&
        g2.equippedWeaponId === 'cannon' &&
        g2.equippedWeaponStar === 2 &&
        storedWeaponStar(afterFuse) === 2,
      'R4f **验收 ③ 终点**｜一次真实点击合成：★1 归 0、★2 = 1、**equipped 自动升到 ★2**（页面 + 库存 + 正式 Build 存档三处一致）',
      `★1×${invCount(afterFuse, 'cannon', 1)} ★2×${invCount(afterFuse, 'cannon', 2)} equipped=${g2.equippedWeaponId}★${g2.equippedWeaponStar} 存档★${storedWeaponStar(afterFuse)}`,
    );
    await clickSelector(page, '[data-ph-action="back-home"]');
    const homeAfter = await probeHome(page);
    const equipPayload1 = equippedOf(homeAfter.adventureHref);
    log(
      equipPayload0 &&
        equipPayload0.functionalStars === undefined &&
        equipPayload1 &&
        equipPayload1.functionalStars &&
        equipPayload1.functionalStars[WEAPON_SLOT] === 2,
      'R4g **「下一局更强」的输入**：上一局出发时是 ★1（无 `functionalStars` 键），现在「开始冒险」地址里的装备载荷已是 ★2',
      `before=${JSON.stringify((equipPayload0 || {}).functionalStars ?? null)} after=${JSON.stringify((equipPayload1 || {}).functionalStars ?? null)}`,
    );

    /* ==================================================================================
       R5a..R5c｜**门禁抓出的真实丢档路径（回归）**：首入判定只做一次
       ----------------------------------------------------------------------------------
       `e2e:product-reward` 在本轮门禁里抓到过（K8 / H2 / H3 同时红，磁盘读数 `★1=4 ★2=0`）：
         新账号首入时**还没领过奖**（判据 ③ 不成立）⇒ 不执行、也（旧实现）不落标记；
         玩家随后自己走完 `领奖 → 5/5 → 合成 ★2`，回到首页时五条判据**全部成立**
         ⇒ 旧实现把玩家**自己刚合出来的** ★2 当成「上一轮的产物」清掉并把 ★1 倒补回 4。
       根因 = 把「连续判定」当成了「首入判定」（判据读的是**会被玩家自己改变**的库存）。
       修法 = 判定在**第一次挂载**就落定（落标记的判据 = `decided`），此后只看标记。
       这里用**真实浏览器 + 真实 localStorage** 把修好的行为钉死。
       ================================================================================== */
    await page.evaluate(
      (keys) => {
        for (const k of keys) localStorage.removeItem(k);
      },
      [BUILD_KEY, INV_KEY, PROGRESS_KEY, CLAIMS_KEY, ONBOARDING_KEY, RESEED_KEY],
    );

    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const freshProbe = await probeHome(page);
    const afterFresh = await storageDump(page);
    log(
      freshProbe.growth.reseedApplied === false &&
        freshProbe.growth.reseedReason === 'not-prototype' &&
        !!afterFresh[RESEED_KEY] &&
        invCount(afterFresh, 'cannon', 1) === 4,
      'R5a **首入判定落定**｜全新账号第一次打开首页：本迁移**不执行**（`not-prototype`，一个字节都不改），但**判定已经做出** ⇒ 标记落盘（这正是「只判一次」的前提）',
      `reason=${freshProbe.growth.reseedReason} applied=${freshProbe.growth.reseedApplied} 标记=${!!afterFresh[RESEED_KEY]} ★1×${invCount(afterFresh, 'cannon', 1)}`,
    );

    // 玩家自己走完整条链：领一件（★1=5）⇒ 合成 ⇒ ★2（★1 归 0，装备自动升到 ★2）
    await page.evaluate(
      ({ keys, build, inv }) => {
        localStorage.setItem(keys.inv, JSON.stringify({ ...inv, __v: 1 }));
        localStorage.setItem(keys.build, JSON.stringify({ ...build, __v: 1 }));
      },
      { keys: { build: BUILD_KEY, inv: INV_KEY }, build: CONSUMED_BUILD, inv: SELF_FUSED_INV },
    );
    const selfInjected = await storageDump(page);

    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const selfProbe = await probeHome(page);
    const afterSelf = await storageDump(page);
    log(
      selfProbe.growth.reseedReason === 'already-marked' &&
        selfProbe.growth.reseedApplied === false &&
        invCount(afterSelf, 'cannon', 1) === 0 &&
        invCount(afterSelf, 'cannon', 2) === 1 &&
        storedWeaponStar(afterSelf) === 2,
      'R5b **回归（门禁抓出的丢档路径）**｜玩家**自己**合成出来的 ★2 不被当成「上一轮的产物」：★1 不倒补、★2 原样保留、装备仍是 ★2',
      `reason=${selfProbe.growth.reseedReason} ★1×${invCount(afterSelf, 'cannon', 1)} ★2×${invCount(afterSelf, 'cannon', 2)} 存档★${storedWeaponStar(afterSelf)}`,
    );
    log(
      afterSelf[INV_KEY] === selfInjected[INV_KEY] &&
        afterSelf[BUILD_KEY] === selfInjected[BUILD_KEY] &&
        afterSelf[RESEED_KEY] === afterFresh[RESEED_KEY],
      'R5c **零写入**｜这一次挂载对库存与 Build **一个字节都没写**（判定只看标记，不再重判）',
      `invSame=${afterSelf[INV_KEY] === selfInjected[INV_KEY]} buildSame=${afterSelf[BUILD_KEY] === selfInjected[BUILD_KEY]} 标记不变=${afterSelf[RESEED_KEY] === afterFresh[RESEED_KEY]}`,
    );

    /* ==================================================================================
       R5d｜整段没有任何页面异常
       ================================================================================== */
    log(pageErrors.length === 0, 'R5d 整段流程 0 个未捕获页面异常', pageErrors.join(' · ') || '（无）');
  } catch (e) {
    log(false, 'R9 主流程未抛异常', String((e && e.message) || e));
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

main();
