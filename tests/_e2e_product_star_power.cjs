/**
 * PRODUCT-LOOP-R2-C-STAR-POWER-END-TO-END｜
 * 「星级不是 Garage 里的数字，而是真的改变下一局战斗」的**浏览器真实闭环 smoke**。
 *
 * 一条链走完（Queue 核心目标）：
 *   fresh profile（新账号的 cannon ★1 ×4；被观测的那件 = `machineGun`，夹具抬到 ★1 ×4）
 *     → 真实 Garage 装配：车身 `coconutBody` / 后轮 `heavyWheel` / 主武器 `machineGun`
 *     → Run 1：打真一局（第一场真实战斗，实测机枪第一发命中 = 20）
 *     → COMPLETE → 领 machineGun（R8 起候选 = 本局主武器，只有它一件）→ 库存 5/5
 *     → Garage 合成 → ★1 ×0 / ★2 ×1 / equipped 自动 ★2
 *     → Run 2：新一局（Day / HP / Run Buff 全部重置）
 *     → 第一场真实战斗真的用 ★2 机枪：实测第一发命中 = 25（= round(20 × 1.25)）
 *
 * ══════════════════════════════════════════════════════════════════════════════════════
 * ⚠️⚠️ PRODUCT-LOOP-R6-BASIC-ENCOUNTER-SEQUENCE（真人裁决：保持现状 + 如实降级）
 *     → PRODUCT-LOOP-P0-BROWSER-COMPLETE-PATH-R1（**降级解除 · 判据转正**）
 *
 * 产品 Run 已由**四场压力阶梯**收成**三段问题序列**（`ProtoRusher` → `Chaser` →
 * `RangedTurret`），第 3 段落位**终局** `d4-final`（⚠️ PRODUCT-LOOP-R9 收敛为**严格六节点链** ·
 * `RUN_TOTAL_DAYS` = 4）。`RangedTurret` 是全项目**唯一**声明
 * `enemyDrive:'keep-distance'` 的对手。
 *
 * ── R6~R9 期为什么不可达 ────────────────────────────────────────────────────────────
 * 本文件当时用的是**产品默认装载**（默认车身 + 缺省轮 + `cannon`）⇒ 终局控距下**零命中**
 * ⇒ **Run 1 必然 `RUN FAILED`**（实测 `phase=FAILED battles=3/3 耐久=0%`；Node 同源证据见
 * `tests/productRunEncounterSequenceQ3.test.ts` Q3-07）⇒ `C1 ~ E6` 只能逐条 `BLOCKED`
 * （**既不计 PASS 也不计 FAIL**，绝不伪造成通过）。
 *
 * ── 本 Queue 的改法（**一条断言都没删**） ────────────────────────────────────────────
 * 不可达的**根因是装载、不是判据**。⇒ 整条链换到**产品真实可达的获胜装配**上
 * （全部经**真实 Garage UI 点击**，见 `setUpWinningLoadout`）：
 *   · 车身 → `coconutBody`（默认拥有）· 后轮 → `heavyWheel`（R3 轮组种子已发）
 *   · 主武器 → `machineGun`（本局被观测的那件）
 *   · 行程 → Choice 1 点 `emergencyRepair` → Choice 2 点 `damageUp` ⇒ **Run 1 真实 COMPLETE**
 *   · 夹具 → 本 Queue 明令允许「测试初始夹具准备 `machineGun ★1 = 4/5`」（只改库存计数一个数字）
 * ⚠️ 被观测的武器从 `cannon` 换成 `machineGun` ⇒ 读数随之重定（见下一条）。
 * ⚠️ `C1 ~ E6` 的判据本体一字未改，只是**改成真的执行**；`else` 分支保留为**安全网**。
 *
 * ⚠️ PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY 两处口径变更（本文件的数字随之重测）：
 *   ① 必改 2：终点候选从「三选一」收窄为**一件**（R2 期固定 `['cannon']`；
 *      PRODUCT-LOOP-R8 起 = 本局装备的主武器 ⇒ 本文件现在是 `['machineGun']`）；
 *   ② 必改 3（用户裁决）：**Cannon** 的本局玩家侧基线 = `PRODUCT_RUN_CANNON_BASE_DAMAGE = 120`
 *      ⇒ **Cannon 局**存在**两套**伤害读数（卡面 `80 → 100` vs 战斗内 `120 → 150`）。
 *      ✅ **本 Queue 观测的 `machineGun` 不在 Cannon 基线的适用面上**（`playerBaseline` 是
 *      Cannon 专属：`composePlayerRunWeaponDef` 只在基准武器是 cannon 时写入 120）
 *      ⇒ 对本文件，**卡面读数与战斗内实测同值**：★1 `20` / ★2 `25` / ★3 `30`
 *      （来源 = 正式 `machineGun.behaviorParams.projectileDamage = 20` × 星级曲线
 *      `1 + 0.25 × (star − 1)`）。
 *      Cannon 的两层分离仍由 `_e2e_product_reward.cjs` / `tests/productStarPowerR2C.test.ts`
 *      覆盖；正式 `cannon` 仍恒为 80（`src/core/content.ts` 零改动）。
 *
 * ⚠️ 命中归组的**键**（`battleWorld.playerWeaponHits` 的 key）= 正式 `damage` 事件里的
 *    `part.def.id`。本装配下 = `machineGun`（探针实测；不是挂点名、也不是 overlay id）。
 * ══════════════════════════════════════════════════════════════════════════════════════
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
 * 终点候选（= **本局装备的那件主武器**）。
 *
 * ⚠️ PRODUCT-LOOP-R8-EQUIPPED-WEAPON-REWARD-R1：池子不再是一个固定常量，而是由本局装备
 *    现算（`runReward.rewardChoiceIdsFor(draft)`）。
 *
 * ⚠️ PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY（必改 2）：从 `['cannon','spear','hammer']`
 *    **收窄为一件** —— 奖励只发**这一局真的用得上**的东西（真人反馈 ③）。
 *    ⚠️ PRODUCT-LOOP-R6：奖励池**不再**与「支持完整 Run 的武器表」同值 ——
 *    R6 起后者是显式能力登记（`runCompatibility.FULL_RUN_SUPPORTED_WEAPON_IDS`；
 *    R6-BATCH 之后 7 件），本文件不需要改。
 * ⚠️ PRODUCT-LOOP-P0-BROWSER-COMPLETE-PATH-R1：本文件驱的车从「产品默认车（cannon）」
 *    换成**产品可达的获胜装配**（`machineGun`，见 `setUpWinningLoadout`）⇒ 候选随之变成它。
 *    `C1` 的 `rects.length === CHOICE_IDS.length` 与 `pickIndex` 自动落到 1 张卡 / 下标 0。
 */
const CHOICE_IDS = ['machineGun'];
/** 本局被观测的那件武器 —— 也是 `playerWeaponHits` 的**归组键**（= `damage` 事件的 `part.def.id`）。 */
const OBSERVED_WEAPON = 'machineGun';
/** 满 stack 阈值（与 `playerGrowth.FUSE_STACK` 同值）。 */
const FUSE_STACK = 5;
/**
 * 本 Queue 允许的**测试初始夹具准备**：把被观测武器的 ★1 档摆到 `4/5`（= `FUSE_STACK - 1`）。
 * 这样 `Run 1 领奖（4 → 5）→ Garage 合成（5×★1 → ★2）` 这条链才走得完。
 */
const SEED_MACHINEGUN = FUSE_STACK - 1;
/** 两个正式存档 key（独立取证，不经过页面探针）。 */
const BUILD_KEY = 'strongfruit.playerBuild.v1';
const INV_KEY = 'strongfruit.ownedParts.v2';
/** 唯一打通的主武器槽。 */
const WEAPON_SLOT = 'frontMass';
/**
 * **正式** `machineGun` 的基准伤害（`core/content.ts` 的 `projectileDamage: 20`）。
 * ⚠️ 这是正式内容值，本 Queue **一字节未改**（`git diff --exit-code -- src/core/content.ts` 为空）。
 *    产品首页 / Garage 卡面读的就是它（PR-27：产品侧不许自算星级伤害，只许读 core）。
 */
const MACHINEGUN_BASE_DAMAGE = 20;
/** ★2 = round(20 × 1.25)（A2 / D1 / D3 的卡面文本用它）。 */
const MACHINEGUN_STAR2_DAMAGE = 25;
/** ★3 = round(20 × 1.5)（D3 的「下一星预览」用它）。 */
const MACHINEGUN_STAR3_DAMAGE = 30;
/**
 * ⚠️ **本文件刻意只保留一套伤害常量**（卡面 = 战斗内），与「Cannon 局有两套」不同：
 *
 *   `machineGun` **不在** Cannon 玩家基线的适用面上 ——
 *   `composePlayerRunWeaponDef` 只在 `playerBaseline && baseWeaponDefId === 'cannon'` 时
 *   把 `PRODUCT_RUN_CANNON_BASE_DAMAGE`（120）写进 `behaviorParams`，
 *   非 Cannon 武器拿到的是**自己的正式值**（本文件 = 20）。
 *   ⇒ B2 / B3 / E3 / E4 的**战斗内实测**与 A2 / D1 / D3 的**卡面文本**必须落在同一个数上；
 *     它们若分叉，说明「基线被套到了别的武器上」——那是**缺陷**，不是口径差异。
 *   Cannon 那两套读数（80/100 vs 120/150）仍由 `_e2e_product_reward.cjs` 与
 *   `tests/productStarPowerR2C.test.ts` 覆盖，正式 `cannon` 仍恒为 80。
 */

/**
 * 赢：**获胜装配 + 通用成长池**下那条确定性通关路线（与 reward / loop / reseed 同一条）。
 *
 * ⚠️ PRODUCT-LOOP-P0-BROWSER-COMPLETE-PATH-R1 重定口径：原值是 Cannon 池
 *    （`twinCannon` / `tripleLoad`）。现在驱的是 `machineGun` ⇒ 池族是**通用基础成长池**
 *    `['damageUp','rateUp','emergencyRepair']` ⇒ 必须点池里真的存在的两项：
 *      · `layer1` → `emergencyRepair`（先回耐久才撑得到终局）· `layer2` → `damageUp`（打穿终局）
 *      · 耐久事件选「维修」。
 */
const WIN_POLICY = { layer1: 'emergencyRepair', lateral: null, layer2: 'damageUp', durability: 'repair' };
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
/**
 * ⚠️ **安全网**（PRODUCT-LOOP-P0-BROWSER-COMPLETE-PATH-R1）：依赖「Run 1 COMPLETE → 领奖 →
 * 合成 ★2 → Run 2」的判据在 R6~R9 期没有观测对象（默认装载下 Run 1 恒 FAILED，见文件头披露）。
 * 现在 Run 1 跑在产品可达的获胜装配上 ⇒ 正常情况下不会触发；万一将来又不可达，
 * 仍然逐条记 `BLOCKED`：既不通过（**绝不伪造成 PASS**）也不失败（不是回归），
 * summary 单独计数、**退出码不受影响**。
 */
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
  const loc = page.locator(sel).first();
  /**
   * ⚠️ **必须先滚进可视区再取矩形**（PRODUCT-LOOP-P0-BROWSER-COMPLETE-PATH-R1 在
   *    `_e2e_product_reseed.cjs` 上实测踩到）：车库里那张卡片列表（`.ph-garage-body`）是
   *    `overflow: auto` 的**可滚动容器** ⇒ 库存变长后目标卡会落在容器可视区之外；
   *    此时 `boundingBox()` 给的仍是**布局坐标**、`page.mouse.click` 打在容器外面
   *    ⇒ **点击静默失效**（不报错、不生效）。
   *    本文件的账号比新账号多卡（夹具把 `machineGun ★1` 抬到 4/5）⇒ 同样需要先滚动。
   */
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

/* ------------------------------------------------- 本 Queue 的夹具与装配（真实 UI） */

/**
 * 夹具预置：把 `machineGun ★1` 的库存计数设成 `n`
 * （本 Queue 明令允许的「**测试初始夹具准备：`machineGun ★1 = 4/5`**」）。
 *
 * ⚠️ 只改**库存计数**这一个数字（`ownedParts.v2` → `machineGun.one`）：
 *    · **不碰 Build** —— 装备一律走真实 Garage UI（见 `setUpWinningLoadout`）；
 *    · 不碰任何武器 / 敌人 / 车身 / 轮组数值，不新增内容 ⇒ 不构成「测试专用 Buff」，
 *      只是把玩家的库存起点摆到 Queue 指定的位置（好让 `领奖 → 5/5 → 合成 ★2` 走得完）。
 * ⚠️ 写法是「读出现有 JSON → 只覆盖那**一个**键 → 写回」⇒ 版本信封（`__v`）与其它每一件
 *    部件都**逐字节不变**。
 * ⚠️ 函数内部会 `page.reload()`：**调用方在这之后拿到的 `runToken` 才是有效的**。
 */
async function seedMachineGunStack(page, n) {
  const before = await page.evaluate((count) => {
    const KEY = 'strongfruit.ownedParts.v2';
    const raw = localStorage.getItem(KEY);
    if (!raw) throw new Error('夹具预置前提不成立：新账号种子还没跑 ⇒ 库存存档不存在');
    const obj = JSON.parse(raw);
    const prev = obj['machineGun'] && typeof obj['machineGun'] === 'object' ? obj['machineGun'] : {};
    obj['machineGun'] = { ...prev, one: count };
    localStorage.setItem(KEY, JSON.stringify(obj));
    return prev['one'] ?? 0;
  }, n);
  await page.reload({ waitUntil: 'load' });
  await waitHomeReady(page);
  return before;
}

/**
 * 通过 **真实 Garage UI** 把车配成「本文件那条可过关的装配」。
 *
 * 每一步都是产品上真实存在的交互（点槽 → 点**已拥有**的卡 ⇒ 立即装备，无二次确认按钮）：
 *   · 车身   → `coconutBody`（默认拥有的正式车身）
 *   · 后轮   → `heavyWheel`（R3 轮组种子已发 ⇒ 拥有；前轮保持缺省 `wheelStd`）
 *   · 主武器 → `machineGun`（本局被观测的那件）
 *
 * ⚠️ 为什么是这三项：它们是**机器实测出来的最小可行组合**（探针读数见
 *    `_e2e_product_reward.cjs` 文件头与 `tests/productRunRewardPacingR9.test.ts`）。
 *    用默认车身 / 缺省轮 ⇒ 第 2 段就会阵亡（R6~R9 期的真实读数）。
 * ⚠️ 这里**没有**任何 `localStorage` 直写装备 —— Build 只经产品自己的装备入口落盘。
 */
async function setUpWinningLoadout(page) {
  await clickSelector(page, '[data-ph-action="open-garage"]');
  await clickSelector(page, '[data-ph-slot="body"]');
  await clickSelector(page, '[data-ph-body="coconutBody"]');
  await clickSelector(page, '[data-ph-slot="rear"]');
  await clickSelector(page, '[data-ph-movement="heavyWheel"]');
  await clickSelector(page, '[data-ph-slot="weapon"]');
  await clickSelector(page, '[data-ph-weapon="machineGun"]');
  await clickSelector(page, '[data-ph-action="back-home"]');
  await waitHomeReady(page);
}

/* ------------------------------------------------------------------ Run 驱动 */

/**
 * 把一局 Run 驱到终态（或「已经看到第一发主武器命中」），**同时**采集战斗侧的真实读数。
 *
 * 采集口径：每一帧都把 `battleWorld` 里的玩家武器读数 / 真实命中记录**照抄一份**存档 ——
 * 因为战斗运行时在离开 battle 相位时会被释放（`endBattle()`），落到终态再去读就晚了。
 *
 * ⚠️ 命中归组的**键** = 正式 `damage` 事件的 `part.def.id` ⇒ 本装配下是 `OBSERVED_WEAPON`
 *    （`machineGun`）。**不是**挂点名（`frontMass`）、也不是 Cannon 那种 overlay id。
 *
 * @param stopOnFirstWeaponHit true ⇒ 采到第一发**被观测武器**的命中就停（Run 2 只需要第一场）
 */
async function driveRun(page, policy, label, stopOnFirstWeaponHit = false) {
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
      if (stopOnFirstWeaponHit && hits[OBSERVED_WEAPON] && hits[OBSERVED_WEAPON].count >= 1) {
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

  const withObserved = samples.filter((s) => s.hits[OBSERVED_WEAPON]);
  return {
    label,
    stopped,
    ms: Date.now() - t0,
    seen,
    samples,
    last,
    /** 玩家车上的武器读数（最后一份） */
    weapons: samples.length > 0 ? samples[samples.length - 1].weapons : [],
    /** 采到过的**第一发被观测武器命中**（最早那一次采样里它的那条） */
    firstWeaponHit: withObserved.length > 0 ? withObserved[0].hits[OBSERVED_WEAPON] : null,
    /** 采样里被观测武器命中次数最多的那一条（= 那一场的完整命中记录） */
    fullestWeaponHits:
      withObserved.length > 0
        ? withObserved.reduce((a, b) =>
            b.hits[OBSERVED_WEAPON].count > a.hits[OBSERVED_WEAPON].count ? b : a,
          ).hits[OBSERVED_WEAPON]
        : null,
    /** 第一份 battleWorld 采样（用于读「本场开局」的客观事实） */
    firstBattleSample: samples.length > 0 ? samples[0] : null,
  };
}

/** 从首页出发 → 进 Run → 驱动到指定状态。 */
async function enterRunAndDrive(page, policy, label, stopOnFirstWeaponHit) {
  const homeBefore = await probeHome(page);
  const equipped = equippedOf(homeBefore.adventureHref);
  await Promise.all([
    page.waitForURL(/run-page\.html/, { timeout: 20000 }).catch(() => {}),
    clickSelector(page, '[data-ph-action="start-run"]'),
  ]);
  await waitRunReady(page);
  const runStart = await probeRun(page);
  const detail = await driveRun(page, policy, label, stopOnFirstWeaponHit);
  return { homeBefore, equipped, runStart, detail };
}

/** 单场玩家武器读数里挑出主武器那件。 */
function mainWeapon(weapons, defId = OBSERVED_WEAPON) {
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
       A｜起点：新账号 + 本 Queue 允许的夹具准备 + **真实 Garage 装配**；
          卡面**在合成前**就告诉玩家升星会得到什么
       ================================================================================== */
    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const home0 = await probeHome(page);
    const stored0 = await storageDump(page);
    log(
      home0.growth.fresh === true &&
        home0.growth.seeded === true &&
        invCount(stored0, 'cannon', 1) === 4 &&
        invCount(stored0, OBSERVED_WEAPON, 1) === 1 &&
        home0.equippedWeaponId === 'cannon' &&
        home0.equippedWeaponStar === 1,
      'A1 起点（Queue「fresh profile」）：新账号的 cannon ★1 = 4、主武器槽装的正是 ★1 的炮；' +
        `被观测的 ${OBSERVED_WEAPON} ★1 = 1（夹具抬到 4/5 之前）`,
      `cannon★1×${invCount(stored0, 'cannon', 1)} · ${OBSERVED_WEAPON}★1×${invCount(stored0, OBSERVED_WEAPON, 1)} · ` +
        `equipped=${home0.equippedWeaponId} ★${home0.equippedWeaponStar}`,
    );

    /* ---- 夹具准备（**本 Queue 明令允许**）：只改库存计数一个数字 ---- */
    const mgBefore = await seedMachineGunStack(page, SEED_MACHINEGUN);
    const stored1 = await storageDump(page);
    log(
      invCount(stored1, OBSERVED_WEAPON, 1) === SEED_MACHINEGUN &&
        invCount(stored1, 'cannon', 1) === 4 &&
        invCount(stored1, 'spear', 1) === 1 &&
        invCount(stored1, 'hammer', 1) === 1,
      `A1b 夹具准备（**本 Queue 明令允许**「测试初始夹具准备 \`${OBSERVED_WEAPON} ★1 = 4/5\`」）：` +
        `${OBSERVED_WEAPON} ★1 由 ${mgBefore} → **${SEED_MACHINEGUN}/5**；其余每一件一个数字都没动（也不碰 Build）`,
      `${OBSERVED_WEAPON} ★1: ${mgBefore} → ${invCount(stored1, OBSERVED_WEAPON, 1)} · ` +
        `cannon=${invCount(stored1, 'cannon', 1)} spear=${invCount(stored1, 'spear', 1)} hammer=${invCount(stored1, 'hammer', 1)}`,
    );

    /* ---- **真实 Garage UI** 装配（获胜装配：车身 / 后轮 / 主武器） ---- */
    await setUpWinningLoadout(page);
    const stored2 = await storageDump(page);
    const b2 = JSON.parse(stored2[BUILD_KEY]);
    log(
      b2.functionalSelections[WEAPON_SLOT] === OBSERVED_WEAPON &&
        b2.bodyDefId === 'coconutBody' &&
        b2.rearWheelDefId === 'heavyWheel',
      'A1c 获胜装配**真的经产品 Garage UI 落盘**：正式 Build 存档里 主武器=machineGun / 车身=coconutBody / 后轮=heavyWheel' +
        '（全部真实点击，没有一处 localStorage 直写装备）',
      `weapon=${b2.functionalSelections[WEAPON_SLOT]} body=${b2.bodyDefId} rear=${b2.rearWheelDefId}`,
    );

    /* ---- 打开「调整战车」读**真实 DOM 卡面**（Weapon 卡只画在车库视图里） ---- */
    await clickSelector(page, '[data-ph-action="open-garage"]');
    const c0card = await garageCard(page, OBSERVED_WEAPON, 1);
    const mgFace = `攻击 ${MACHINEGUN_BASE_DAMAGE} → ${MACHINEGUN_STAR2_DAMAGE}`;
    log(
      !!c0card &&
        c0card.star === '1' &&
        c0card.count === String(SEED_MACHINEGUN) &&
        c0card.damage === String(MACHINEGUN_BASE_DAMAGE) &&
        c0card.damageNext === String(MACHINEGUN_STAR2_DAMAGE) &&
        c0card.damageText === mgFace &&
        c0card.damageLineText === mgFace,
      `A2 **Queue 必改 4**：Weapon 卡上**真的画出**了最终主属性那一行「${mgFace}」` +
        '（真实 DOM 文本，不是探针自述；此时还差一件没凑齐，玩家已经知道升星值多少）',
      c0card ? `行文本="${c0card.damageLineText}" data=${c0card.damage}/${c0card.damageNext}` : 'n/a',
    );
    await clickSelector(page, '[data-ph-action="back-home"]');

    /* ==================================================================================
       B｜Run 1：★1 机枪的第一场**真实**战斗（实测第一发命中 = 20）
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
      run1.detail.firstWeaponHit !== null &&
        run1.detail.firstWeaponHit.damages[0] === MACHINEGUN_BASE_DAMAGE,
      `B2 Run 1 第一场真实命中：★1 机枪每发扣对手 **${MACHINEGUN_BASE_DAMAGE}** 点血` +
        `（＝正式 \`${OBSERVED_WEAPON}.projectileDamage\`；本武器**不在** Cannon 玩家基线的适用面上）`,
      run1.detail.firstWeaponHit
        ? `首中 ${run1.detail.firstWeaponHit.firstAtMs}ms · damages=[${run1.detail.firstWeaponHit.damages.slice(0, 8).join(',')}${run1.detail.firstWeaponHit.damages.length > 8 ? ',…' : ''}]`
        : 'n/a',
    );
    log(
      !!r1Main && r1Main.star === 1 && r1Main.damage === MACHINEGUN_BASE_DAMAGE,
      `B3 **Battle Runtime Weapon Star**（真实装配）：运行时读到的是 ★1 的 ${OBSERVED_WEAPON}、伤害 ${MACHINEGUN_BASE_DAMAGE}`,
      r1Main ? `${r1Main.defId}@${r1Main.hardpointId} ★${r1Main.star} damage=${r1Main.damage}` : 'n/a',
    );
    /*
      ✅ PRODUCT-LOOP-P0-BROWSER-COMPLETE-PATH-R1：Run 1 现在跑在**产品可达的获胜装配**上
      ⇒ **真的打到 COMPLETE**。R6~R9 期它恒 FAILED（默认装载下终局控距零命中），
      当时 `B4` 被改成断 FAILED；现在改回**正面**断 COMPLETE（判据本体不变）。
      ⚠️ `pDone` 的定义仍放在 B4 之前（B4 / B4b 后面的 C 段都要用它）。
    */
    const pDone = run1.detail.last;
    log(
      run1.detail.stopped === 'COMPLETE' && !!pDone && pDone.complete === true && pDone.failed === false,
      'B4 Run 1 三段全打到终局 → RUN COMPLETE（获胜装配 + 通用成长池 `emergencyRepair → damageUp`）',
      `stopped=${run1.detail.stopped} · ${(run1.detail.ms / 1000).toFixed(1)}s · ` +
        `battles=${pDone ? `${pDone.battlesCompleted}/${pDone.battleTotal}` : 'n/a'} ` +
        `DAY=${pDone ? pDone.day : 'n/a'} 耐久=${pDone ? pDone.battle.durabilityPercent : 'n/a'}%`,
    );
    log(
      !!pDone &&
        pDone.phase === 'COMPLETE' &&
        pDone.rewardChoices.length === 1 &&
        pDone.rewardChoiceRects.length === 1 &&
        pDone.rewardChoices[0].defId === OBSERVED_WEAPON &&
        pDone.rewardChoices[0].countBefore === SEED_MACHINEGUN &&
        pDone.rewardChoices[0].countAfter === SEED_MACHINEGUN + 1 &&
        pDone.claiming === false &&
        pDone.claimStarts === 0 &&
        pDone.actionLabel === '领取并返回' &&
        pDone.actionEnabled === true,
      'B4b COMPLETE 终点：候选卡 = **本局真的用上的那件主武器**（machineGun 4 → 5）；底栏唯一 CTA「领取并返回」可用且尚未按下' +
        '（R6~R9 期这条守门问的是 FAILED 侧，现在问 COMPLETE 侧；FAILED 侧仍由 `_e2e_product_fail.cjs` 覆盖）',
      `候选=${pDone ? pDone.rewardChoices.length : 'n/a'} ` +
        `defId=${pDone && pDone.rewardChoices[0] ? pDone.rewardChoices[0].defId : 'n/a'} ` +
        `claiming=${pDone ? pDone.claiming : 'n/a'} label=${pDone ? pDone.actionLabel : 'n/a'} ` +
        `enabled=${pDone ? pDone.actionEnabled : 'n/a'}`,
    );

    /*
      ✅ 判据本体（「Run 1 打完 → 领奖 → 合成 ★2 → Run 2 用上 ★2」）**一条都没删**：
      R6~R9 期它只是被记账为 `BLOCKED`（前提 Run 1 COMPLETE 不成立），现在真的执行。
    */
    const run1Completed = run1.detail.stopped === 'COMPLETE';
    if (run1Completed) {

    /* ==================================================================================
       C｜领奖：候选只有本局主武器一件 → 库存 5/5
       ================================================================================== */
    log(
      pDone.phase === 'COMPLETE' && pDone.rewardChoiceRects.length === CHOICE_IDS.length,
      'C1 COMPLETE 上真的画出了候选卡（与绘制同源的矩形；条数 = 产品候选池长度）',
      `phase=${pDone.phase} rects=${pDone.rewardChoiceRects.length}`,
    );
    /*
      ⚠️ PRODUCT-LOOP-P0-SETTLEMENT-SINGLE-CTA-AND-AUDIO-LIFECYCLE（必改 1 / 2）之后，
         出口从「候选卡」收敛为**底栏唯一主 CTA**：卡片纯展示，点它**什么都不发生**。
         本段路线据此改写为「按下底栏 CTA」，**断言一条不删、只加一条守门**
         （REF §9：产品契约变更作废既有 E2E 路线 ⇒ 换合法路线 + 新增守门断言）。
      ⚠️ `waitForURL` 必须用 **pathname 谓词**：Run 页地址自带 `home=.%2Fhome.html`
         这个参数取值，子串正则 `/home\.html/` 会**当场匹配自己**、根本不等待导航。
    */
    log(
      pDone.actionEnabled === true && pDone.actionLabel === '领取并返回',
      'C1b **必改 2**｜终点的唯一出口是底栏 CTA「领取并返回」且可用（卡片不是入口）',
      `label=${pDone.actionLabel} enabled=${pDone.actionEnabled}`,
    );
    await Promise.all([
      page.waitForURL((u) => u.pathname === '/home.html', { timeout: 20000 }).catch(() => {}),
      clickRect(page, pDone.actionRect),
    ]);
    await waitHomeReady(page);
    const storedAfterClaim = await storageDump(page);
    log(
      invCount(storedAfterClaim, OBSERVED_WEAPON, 1) === SEED_MACHINEGUN + 1,
      `C2 领到 ${OBSERVED_WEAPON} ⇒ 库存 ★1 = **5/5**（真实鼠标按下底栏 CTA + 真实整页导航回来）`,
      `★1×${invCount(storedAfterClaim, OBSERVED_WEAPON, 1)}`,
    );

    /* ==================================================================================
       D｜Garage：合成 5×★1 → 1×★2，装备自动升星；卡面换成 ★2 的下一星预览
       ================================================================================== */
    await clickSelector(page, '[data-ph-action="open-garage"]');
    const g1 = await probeHome(page);
    const g1c1 = await garageCard(page, OBSERVED_WEAPON, 1);
    const mgFace = `攻击 ${MACHINEGUN_BASE_DAMAGE} → ${MACHINEGUN_STAR2_DAMAGE}`;
    log(
      g1.weapons.find((w) => w.defId === OBSERVED_WEAPON && w.star === 1).fusable === true &&
        g1c1.text.includes('可合成') &&
        g1c1.damageLineText === mgFace,
      `D1 5/5 的 ★1 机枪：卡上同时写着「可合成」与「${mgFace}」（按下合成前就知道结果）`,
      g1c1.text,
    );

    await clickSelector(page, `[data-ph-action="fuse"][data-ph-fuse-def="${OBSERVED_WEAPON}"][data-ph-fuse-star="1"]`);
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
        invCount(storedAfterFuse, OBSERVED_WEAPON, 1) === 0 &&
        invCount(storedAfterFuse, OBSERVED_WEAPON, 2) === 1 &&
        verifiedEquipped(g2, storedAfterFuse),
      'D2 合成一次：★1 归 0、★2 = 1、**equipped 自动升到 ★2**（页面读数 + 磁盘库存 + 正式 Build 存档三处一致）',
      `★1×${invCount(storedAfterFuse, OBSERVED_WEAPON, 1)} ★2×${invCount(storedAfterFuse, OBSERVED_WEAPON, 2)} ` +
        `equipped=${g2.equippedWeaponId}★${g2.equippedWeaponStar} 存档★${storedWeaponStar(storedAfterFuse)}`,
    );

    const g2c2 = await garageCard(page, OBSERVED_WEAPON, 2);
    const mgFace2 = `攻击 ${MACHINEGUN_STAR2_DAMAGE} → ${MACHINEGUN_STAR3_DAMAGE}`;
    log(
      !!g2c2 &&
        g2c2.equipped === 'true' &&
        g2c2.damage === String(MACHINEGUN_STAR2_DAMAGE) &&
        g2c2.damageNext === String(MACHINEGUN_STAR3_DAMAGE) &&
        g2c2.damageLineText === mgFace2,
      `D3 ★2 卡面：现在写着「${mgFace2}」（下一星 = ★3 的真实值 ${MACHINEGUN_STAR3_DAMAGE}）—— 升星不是数字，是一个可预期的下一站`,
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
       E｜Run 2：新一局真的用 ★2 机枪，且实测伤害 = 25 > 20
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
      !!r2Main && r2Main.star === 2 && r2Main.damage === MACHINEGUN_STAR2_DAMAGE,
      `E3 **Battle Runtime Weapon Star**：这一局运行时读到的是 **★2** 的机枪、伤害 ${MACHINEGUN_STAR2_DAMAGE}（不是页面内存、不是存档副本）`,
      r2Main ? `${r2Main.defId}@${r2Main.hardpointId} ★${r2Main.star} damage=${r2Main.damage}` : 'n/a',
    );
    log(
      run2.detail.firstWeaponHit !== null &&
        run2.detail.firstWeaponHit.damages[0] === MACHINEGUN_STAR2_DAMAGE &&
        run2.detail.firstWeaponHit.damages[0] > MACHINEGUN_BASE_DAMAGE &&
        run2.detail.firstWeaponHit.damages[0] ===
          Math.round(MACHINEGUN_BASE_DAMAGE * 1.25),
      `E4 **本 Queue 的核心结论（实测）**：同一把机枪、只差星级，第一发真实命中 ${MACHINEGUN_BASE_DAMAGE} → **${MACHINEGUN_STAR2_DAMAGE}**` +
        `（= round(${MACHINEGUN_BASE_DAMAGE} × 1.25)）—— 星级真的进了战斗`,
      run2.detail.firstWeaponHit
        ? `首中 ${run2.detail.firstWeaponHit.firstAtMs}ms · damages=[${run2.detail.firstWeaponHit.damages.slice(0, 8).join(',')}${run2.detail.firstWeaponHit.damages.length > 8 ? ',…' : ''}]`
        : 'n/a',
    );
    log(
      run1.detail.firstWeaponHit &&
        run2.detail.firstWeaponHit &&
        run1.detail.firstWeaponHit.firstAtMs === run2.detail.firstWeaponHit.firstAtMs,
      'E5「同条件」的机器证据：两局第一发命中发生在**同一战斗时刻**（在它之前两场物理逐帧相同 —— 星级只改了伤害，不改节奏 / 几何 / 质量）',
      `Run1 ${run1.detail.firstWeaponHit ? run1.detail.firstWeaponHit.firstAtMs : '?'}ms · Run2 ${run2.detail.firstWeaponHit ? run2.detail.firstWeaponHit.firstAtMs : '?'}ms`,
    );
    log(
      onlyDamageDiffers(r1Main, r2Main),
      'E6 **Queue 必改 1**：两局**第一场**（都还没有 Run-local 强化）的武器数值参数逐项比对，**只有伤害不同**（连发节奏 / 炮口速度 / 半径 / 质量 / 后坐全等）',
      onlyDamageDetail(r1Main, r2Main),
    );

    } else {
      /*
        ⚠️ **安全网**（R6~R9 期这里真的走过）：`C1 ~ E6` 的前提是「Run 1 COMPLETE 后领奖」。
        现在 Run 1 跑在产品可达的获胜装配上 ⇒ 正常情况下**不会**再进这个分支；
        万一将来又不可达，整块仍然被**诚实记账**为 `BLOCKED`，绝不静默跳过。
      */
      const why =
        '安全网：Run 1 没有 COMPLETE（若真的触发，说明获胜装配/池族又发生了漂移 ⇒ 先查探针读数，不要改这里的判据）';
      for (const n of [
        'C1 COMPLETE 上真的画出了候选卡',
        'C1b 终点的唯一出口是底栏 CTA「领取并返回」且可用',
        'C2 领到 machineGun ⇒ 库存 ★1 = 5/5',
        'D1 5/5 的 ★1 机枪：卡上同时写「可合成」与「攻击 20 → 25」',
        'D2 合成一次：★1 归 0、★2 = 1、equipped 自动升到 ★2',
        'D3 ★2 卡面写着「攻击 25 → 30」',
        'D4 回首页后装备载荷已带 functionalStars.frontMass = 2',
        'E1 Run 2 的装备载荷主武器槽星级 = 2',
        'E1b 第二局进入瞬间就是 DAY = 1 / 一场没打 / Run Buff = []',
        'E2 新 Run 真的重置了（同 day / 同 nodeId / 满耐久）',
        'E3 运行时读到的是 ★2 机枪、伤害 25',
        'E4 **核心结论**：同一把机枪只差星级，第一发真实命中 20 → 25',
        'E5 两局第一发命中发生在同一战斗时刻（星级不改节奏）',
        'E6 两局第一场武器参数逐项比对只有伤害不同',
      ]) {
        blocked(n, why);
      }
    } /* ← if (run1Completed) 结束：C 段（领奖）+ D 段（合成）+ E 段（Run 2）到此为止 */

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
  console.log(
    `\n=== 结果：${pass}/${results.length} PASS，${failed.length} FAIL，${blockedN} BLOCKED（安全网分支触发时才出现 · 如实登记） ===`,
  );
  if (failed.length > 0) {
    console.log('失败项：');
    for (const f of failed) console.log(` - ${f.name} | ${f.detail}`);
  }
  if (blockedN > 0) {
    console.log('\n本批次不可达（**既不计 PASS 也不计 FAIL**；根因见文件头裁决披露）：');
    for (const b of results.filter((r) => r.blocked === true)) console.log(` - ${b.name} | ${b.detail}`);
  }
  if (failed.length > 0) process.exit(1);
}

/** D2 的「装备指向」三处一致判据。 */
function verifiedEquipped(probe, dump) {
  return (
    probe.equippedWeaponId === OBSERVED_WEAPON &&
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
