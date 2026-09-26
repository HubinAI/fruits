/**
 * PRODUCT-LOOP-R1-D-FAILED-SETTLEMENT-TO-HOME｜**正式失败链 smoke**（真实浏览器）。
 *
 * 真人在正式产品入口录屏确认的 P0：
 *
 *   玩家 Run 内失败 → 没有失败结算 → 流程回到 DAY 1 继续跑 → 玩家无法主动回主界面。
 *
 * 本文件是该闭环的机器判据 —— 真实链路：
 *
 *   首页 → 调整战车 → 开始冒险 → 战斗失败
 *        → 「冒险失败」结算出现 → **页面停住**（等待确认无自动重启，也不接受误触）
 *        → 点「返回主界面」→ 回到正式首页（不带任何领奖参数）
 *        → 三件套（Profile / Inventory / Equipped）一个都没被清空
 *        → 可进入调整战车 → 玩家主动再点「开始冒险」→ 新 Run：DAY 1 / 满耐久 / 无上一局 Buff
 *
 * 手段（与 A/B/C 三段 E2E 同一纪律，全部是真实行为取证）：
 *   - 真实浏览器（playwright-core / msedge）+ 独立产物 `dist-portrait-lab/`；
 *   - **真实鼠标点击**（逻辑坐标 → 画布真实 CSS 矩形换算，不 evaluate 直调）；
 *   - **真实整页导航**（`<a href>` / `location.assign` 由浏览器执行）；
 *   - **真实 localStorage 读取**（三件套一律独立取证，不读页面探针）；
 *   - 只读诊断句柄 `window.__PRODUCTHOME__` / `window.__RUNPAGE__`；
 *   - **真实 getImageData**：失败结算面板与底部 CTA 真的画在画布上。
 *
 * ── ⚠️ PRODUCT-LOOP-P0-RUN-BUILD-LOADOUT-COMPATIBILITY：失败路线**已换**（契约变更）
 *
 * R1-D 当时的失败路线是「把主武器槽换成 `hammer` ⇒ 第一场就被打死（≈16s）」。
 * P0 Queue 之后这条路线**在产品层已经不成立**：非 cannon 的装备在首页就进不去完整 Run
 * （必改 2 / 必改 3 —— 不得进入 Run、不得偷偷换成 Cannon、不得创建半残 Run）。
 * ⇒ 本文件改用 R1-D 同一次实测里的**另一条**确定性失败路线：
 *
 *   `cannon` + 耐久事件选「继续改装」（`upgrade`，不回耐久）⇒ 打到 DAY 7 终局耐久归零。
 *
 * 顺带得到一件 R1-D 当时拿不到的东西：这条路线会**真的走过** P0 的原始 repro 路径
 * （DAY 2 选一层强化 → **DAY 3 第二场战斗创建**时 `applyRunModifiersToSnapshot()` 注入），
 * 所以 C0 就在真实浏览器里取证这件事「现在通了，而且强化真的生效」。
 *
 * 同时新增 A4–A8：**守门本身的实证**（装 hammer/h 等非 cannon → 开始冒险不可执行 +
 * 明确提示 + 可直接进调整战车 + 换回 cannon 后恢复可执行）。
 *
 * ── ⚠️ PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY：失败路线**第二次**换（见 `FAIL_POLICY`）
 *
 * P0 那条路线（重炮 + 动能爆发 + 横向双联炮 + 不回耐久）在旧的玩家侧基线 80 下归零；
 * 本 Queue 把本局玩家侧炮基线抬到 `PRODUCT_RUN_CANNON_BASE_DAMAGE = 120`（用户裁决）后，
 * 同一条路线实测变成 **COMPLETE**（4/4 · DAY 7 · 终局 HP ≈ 364）⇒ 它不再是失败路线。
 * ⇒ 按「产品契约变更作废既有 E2E 路线 ⇒ **换合法路线 + 保留全部守门断言**，不删断言」，
 *    改用 Node 冻结表在 120 下**仍然归零**的组合：`twinCannon + tripleLoad`（= `FAIL_POLICY`）。
 *    C1~D2 的每一条 FAILED 判据**一字未改** —— 这一轮改的是「怎么输」，不是「输了要看到什么」。
 *
 * ── ⚠️ PRODUCT-LOOP-R5-MULTI-WEAPON-PRODUCT-COMPAT-R1：守门取证从**一件**扩到**逐件** ──
 *
 * 内容池种子（`PRODUCT-LOOP-R5-BASIC-CONTENT-POOL-R1`）把验证账号的武器库存从 3 件扩到 9 件，
 * 而 A4–A10 只用 `hammer` 一件取证「非 cannon 进不去完整 Run」。⇒ 新增 **A4b**：
 * 按 `BLOCKED_WEAPON_MATRIX`（= canonical 武器全表 − 支持清单，**真源驱动**）**逐件**过同一组判据
 * （真实点击 → 存档独立取证 → 车库状态块 → 首页无 href → **装备仍是它**）。
 *
 * ⚠️ 两处**不是**放宽、而是必须的加固：
 *   ① `clickSelector` 补 `scrollIntoViewIfNeeded()`：9 张卡后排在后面的卡落到滚动区下方，
 *      `boundingBox()` 仍给矩形但真实鼠标点在视口外（与 loop / reward 两个脚本同一处置）；
 *   ② 新增 A4b-0 / A4b-9 两条**汇总**断言（库存 = canonical 全表 / 被拒矩阵逐件无一件被静默放行）。
 *   既有 A1–A10、B~D 全部判据**一字未改**。
 *
 * ── ⚠️ PRODUCT-LOOP-R6-RUN-WEAPON-SOURCE-OF-TRUTH：守门口径**第三次**变（矩阵随之变成两段）──
 *
 * R6 把 Run 的**基准武器**从「写死 cannon」改成「玩家实际装备里装配顺序第一件正式武器」，
 * 于是「哪件武器能进完整 Run」的判据不再是「是不是 Cannon」，而是
 * **「那件武器自己的 behavior Runtime 存不存在」**（显式能力登记 8 件 + 1 件明确拒绝；
 *  ⚠️ R6-BATCH 起改为 **7 件登记 + 2 件被拒**，见本文件下方 R6-BATCH 段）。
 *
 * ⇒ 本文件里凡是依赖旧口径的东西都必须跟着改，按「契约变更作废既有 E2E 路线 ⇒
 *    **换合法路线 + 新增守门断言，不删断言**」执行：
 *
 *   ① `BLOCKED_WEAPON`（A4–A10 用来取证的被拒武器）：`hammer` → **`spear`**。
 *      原因不是「换一件更弱的」，而是**判据真的变了** —— `hammer` 现在**属于放行集**
 *      （它有 `hammer` factory），全 9 件库存里被拒的**恰好只剩** `spear`
 *      （`behavior === 'ram'`，`behaviorRegistry.FACTORIES` 没注册它）。
 *   ② 主轴提示文案：`'当前原型仅支持加农炮进行完整冒险'` →
 *      `'当前原型尚不支持这件武器进行完整冒险'`（理由变了：不是「不是炮」，是「还没有 Runtime」）。
 *      `COMPAT_HINT`（下一步提示）**一字未改**。
 *   ③ A4b 从「8 件被拒」改为**两段真源驱动矩阵**：
 *        - **被拒矩阵**（`BLOCKED_WEAPON_MATRIX`，恰好 `['spear']`）——
 *          判据与 A4–A10 **完全同一组**（一字未改）；
 *        - **放行矩阵**（`SUPPORTED_WEAPON_MATRIX`，R6 时 8 件 → R6-BATCH 起 7 件）
 *          —— **R6 新契约的正向取证**：
 *          每件登记武器装上去之后都**真的**能出发（有 href），装备不会被偷偷换掉，
 *          而且出发链接里的装载载荷**真的**是它（不是被换成 cannon）。
 *
 * ⚠️ A1–A10、B~D 的既有判据除上面 ① ② 两处**取值**外一字未改；
 *    `FAIL_POLICY`（怎么输）与 `MAIN_WEAPON`（cannon，因为它有完整的 R2 强化体系）都不变。
 *
 * ── ⚠️ PRODUCT-LOOP-R6-BATCH-RUNTIME-COMPLETE-WEAPON-BATCH：被拒矩阵 1 件 → **2 件** ──
 *
 * R6-BATCH 逐件沿真实链实测伤害后，把 `saw` 从登记表**收回**：
 *   它有 `sawBehavior` + `contactTick` 链，但挂在**产品主武器槽** `frontMass` 上时
 *   圆锯 collider 整体落在西瓜车身内 ⇒ 实测 **0 命中 / 0 伤害**（详见 `SUPPORTED_WEAPON_IDS` 头注释）。
 * ⇒ 「被拒」不再是**一条**理由（Runtime 不存在），而是**两条不同**的理由：
 *       `spear` = ③ 没有 `ram` 工厂；`saw` = ④/⑤ 产品槽打不到人。
 *   本脚本**不需要**分理由（玩家侧的合法表现必须完全一致）⇒ A4b 被拒矩阵仍是**同一组**
 *   判据一字未改，只是从 1 件变成 2 件、放行矩阵从 8 件变成 7 件；
 *   A4b-9 汇总断言里的写死值同步改为 `'saw,spear'`（`CANONICAL_WEAPON_IDS` 的顺序）。
 *
 * 用法：
 *   npm run build:portrait-lab
 *   node tests/_e2e_product_fail.cjs   （或 npm run e2e:product-fail）
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

/** 正式存档 key（与 src 同值；E2E 独立取证，不经过页面探针）。 */
const BUILD_KEY = 'strongfruit.playerBuild.v1';
const INV_KEY = 'strongfruit.ownedParts.v2';
const CLAIMS_KEY = 'strongfruit.profileClaims.v1';
/** 唯一打通的武器槽（= 车身前上挂点）。 */
const WEAPON_SLOT = 'frontMass';
/** 失败回程地址的参数名（产品侧与 Lab 侧的唯一约定）。 */
const HOME_PARAM = 'home';
/** 领奖参数名（失败链**结构上**不该拿到；R2-A 起它只出现在每条候选自己的 href 里）。 */
const REWARD_PARAM = 'reward';
const RUN_PARAM = 'run';
/** PRODUCT-LOOP-R2-A：3选1 候选载荷（三条候选**各自**的领奖地址）。 */
const CHOICES_PARAM = 'choices';

/**
 * 本局用的**主武器**：`cannon`。
 *
 * ⚠️ PRODUCT-LOOP-R6：这里曾经写「正式基准武器 = **唯一**支持完整 Run 的武器」——
 *    那句话在 R6 之后**不再成立**（支持清单是显式能力登记，见 `SUPPORTED_WEAPON_IDS`；
 *    R6-BATCH 之后 7 件）。
 *    cannon 仍然是本局武器的理由变成了另一条：**只有它有完整的 R2 强化体系**
 *    （`FAIL_POLICY` 用的 `twinCannon` / `tripleLoad` 都是 Cannon 专属 overlay）
 *    ⇒ 这条失败路线必须以它为主武器，否则路线本身不成立。
 * ⚠️ P0 之前这里是 `hammer`；见文件头「失败路线已换」。
 */
const MAIN_WEAPON = 'cannon';
const MAIN_WEAPON_NAME = '炮';
/**
 * 用来证明守门的**被拒**武器（A4–A10 单件走全链路用）。
 *
 * ⚠️ R6 起不再是 `hammer`（不是放宽，是**判据真的变了**）：改前「非 cannon 一律拒绝」，
 *    所以随便挑一件非 cannon 都能取证；R6 起拒绝的理由不再是「不是炮」。
 *    R6-BATCH 之后共有**两件**被拒（`spear` = 没有 `ram` 工厂；`saw` = 产品槽打不到人），
 *    本常量取 `spear` —— 它是**唯一**能让局内资格层也拒绝的那件（`no-weapon-runtime`），
 *    因此 A4–A10 里「宿主在创建 Run 之前就被拦住」这条判据仍然成立。
 *    ⚠️ `saw` 走的是**另一条**路径（产品侧不发 href、但局内资格层按设计放行）
 *    ⇒ 它只在下面的 `BLOCKED_WEAPON_MATRIX` 里被逐件审核，**不当** A4–A10 的取样件。
 */
const BLOCKED_WEAPON = 'spear';
const BLOCKED_WEAPON_NAME = '刺';

/**
 * PRODUCT-LOOP-R5-MULTI-WEAPON-PRODUCT-COMPAT-R1｜**本批次验证账号的武器全表**（9 件）。
 *
 * ⚠️ 与 `_e2e_product_loop.cjs` / `_e2e_product_reward.cjs` 的 `CANONICAL_WEAPON_IDS` 同源
 *    （三处同名常量 = 同一份 canonical 武器集合的独立取证，不 import 源码）。
 * ⚠️ `ramHead`（冲撞头）不在这张表里：它有武器定义但**不在** `OFFICIAL_PARTS`
 *    ⇒ 玩家拿不到 ⇒ 不进库存（`tests/productMultiWeaponCompatR5.test.ts` MW-01 钉死）。
 */
const CANONICAL_WEAPON_IDS = [
  'cannon',
  'flamethrower',
  'hammer',
  'laser',
  'machineGun',
  'rammer',
  'saw',
  'shotgun',
  'spear',
];
/**
 * 支持「完整 Run」的武器（= `runCompatibility.FULL_RUN_SUPPORTED_WEAPON_IDS` 的**独立取证**）。
 *
 * ⚠️ PRODUCT-LOOP-R6：这张表从 `['cannon']` 扩为 **8 件显式能力登记**。改前 Run 底层把
 *    运行武器硬绑 cannon ⇒ 只有 cannon 能进完整 Run；R6 把 base 改为「玩家装备里
 *    装配顺序第一件正式武器」⇒ 只要那件武器**自己的** Runtime 完整，它就能进完整 Run
 *    （用**它自己**的 canonical Def 跑，不套 Cannon 的数值 / 行为 / 弹道）。
 *
 * ⚠️ PRODUCT-LOOP-R6-BATCH：逐件沿**真实链**实测伤害后，`saw` 被**收回**（8 → 7 件）：
 *    它的 behavior Runtime 与 `contactTick` 链都存在，但挂在**产品主武器槽** `frontMass`
 *    上时圆锯 collider（半径 28、圆心 = 挂点 x=45）完全落在西瓜车身内（车身 collider 前沿
 *    x=85）⇒ 正面接敌永远由车身先接触 ⇒ 实测 **0 命中 / 0 伤害**
 *    （既有 saw 测试全部挂 `front`，所以此前从未被发现）。要让它生效必须改挂点 / 几何
 *    = 新增规则 ⇒ 保持 BLOCK，与 `spear`（无 `ram` 工厂）一起进被拒矩阵。
 *
 * ⚠️ 本文件**不 import 源码**：这是同一份裁决结果的独立抄写，两边漂移由
 *    `tests/productRunWeaponSourceOfTruthR6.test.ts`（R6-09 逐条门槛 + R6-11 真实物理 smoke）
 *    与 `tests/productRunWeaponRuntimeBatchR7.test.ts`（R7 逐件真实链 + 实测伤害）机器钉死。
 *    登记门槛 5 条（① 正式可拥有 ② Snapshot 可解析 ③ behavior Runtime 存在
 *    ④ Collision/Damage/Result 链在**产品主武器槽**上成立 ⑤ 不需要新增玩法规则）
 *    逐条写在 `src/product/runCompatibility.ts` 模块头。
 */
const SUPPORTED_WEAPON_IDS = [
  'cannon',
  'flamethrower',
  'hammer',
  'laser',
  'machineGun',
  'rammer',
  'shotgun',
];
/** 逐件审核矩阵 = 全部 − 支持（**不手写**：内容变了这张表跟着走）⇒ R6-BATCH 起 = `['saw','spear']`。 */
const BLOCKED_WEAPON_MATRIX = CANONICAL_WEAPON_IDS.filter((id) => !SUPPORTED_WEAPON_IDS.includes(id));
/** 放行矩阵 = 全部 − 被拒（同样真源驱动）⇒ R6-BATCH 起 7 件。 */
const SUPPORTED_WEAPON_MATRIX = CANONICAL_WEAPON_IDS.filter((id) => SUPPORTED_WEAPON_IDS.includes(id));

/**
 * 首页 / 车库提示文案（`runCompatibility` 里的两句；断言写死是为了防「提示被改成看不懂的话」）。
 *
 * ⚠️ PRODUCT-LOOP-R6：主轴提示从「当前原型**仅支持加农炮**进行完整冒险」改为
 *    「当前原型**尚不支持这件武器**进行完整冒险」—— 被拒的理由不再是「不是 Cannon」，
 *    而是「这件武器还没有完整的战斗 Runtime」⇒ 文案必须跟着换口径，
 *    否则会出现「提示说只支持炮，但实际 8 件武器都能出发」这种**自相矛盾**的页面。
 * ⚠️ `COMPAT_HINT`（下一步）**一字未改**。
 */
const COMPAT_NOTICE = '当前原型尚不支持这件武器进行完整冒险';
const COMPAT_HINT = '请先调整战车';

/**
 * 失败路线的耐久取舍策略 = 「继续改装」（`upgrade`：不回耐久，并且多拿一项横向改装）。
 *
 * ⚠️ 必须是它（不是 `repair`）：`repair` 会拿回一段耐久 ⇒ 这一局能 COMPLETE（R1-C 实测 4/4），
 *    只有「不回耐久」才让 DAY 7 的终局真的打到耐久归零。
 * ⚠️ 找不到这个 id 时会回退到第一个选项（= 维修）⇒ 失败路线会静默变成通关路线，
 *    C1 的 `phase === 'FAILED'` 会立刻红掉（这正是要的：路线错了必须响）。
 */
const DURABILITY_POLICY = 'upgrade';

/**
 * ⚠️ **PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY：失败路线**再次**换了（第二个变量变了）**
 *
 * 上一版（P0 起）用的是 `layer1 = 重炮(heavyShell)`、`layer2 = 动能爆发(kineticBurst)`、
 * `lateral = 池内第一项`（= 双联炮）—— 那条组合在**旧的玩家侧基线 80** 下恰好归零 FAILED。
 * 本 Queue 把本局**玩家侧**炮基线抬到 `PRODUCT_RUN_CANNON_BASE_DAMAGE = 120`（用户裁决）后，
 * 同一组合实测变成 **COMPLETE**（battles 4/4 · DAY 7 · 终局 HP ≈ 364）
 * ⇒ 这条路线在产品层**已经不再是失败路线**了。
 *
 * 新路线不是猜的，来自 Node 侧同一口径的冻结表（`tests/portraitRunPage.test.ts` 的
 * `FROZEN_UPGRADE`，120 下重测）：
 *   - `heavyShell+kineticBurst` → 终局 **422**（通关 ⇒ 不能再用来验失败）；
 *   - **`twinCannon+tripleLoad` → 终局 0 / FAILED**  ← 本文件改用的就是它；
 *   - **`fastReload+twinCannon`  → 终局 0 / FAILED**  （备选）。
 * ⇒ 失败路径**没有被 120 吃掉**（`RP-F2-11` 的「同路线、同一次耐久事件、结局相反」判据
 *    仍在 Node 侧成立），只是浏览器这条走查要**换一条同样合法的失败路线**。
 *    这不是放宽断言：C1~D2 的每一条 FAILED 判据一字未改，改的只是「怎么输」。
 *
 * ⚠️ `lateral` 仍取 `null`（= 池内第一项）。Node 表同样按「横向池第一项」取值
 *    （双联路线 → 重型弹头），两侧口径一致 —— 这是本文件与冻结表能逐值对上账的前提。
 * ⚠️ `layer1` / `layer2` 从此**显式指定**，不再依赖「池内第一项」的隐式顺序：
 *    组合本身是失败路线的定义，让它隐式依赖选项顺序会让路线在内容重排时悄悄漂移。
 */
const FAIL_POLICY = { layer1: 'twinCannon', lateral: null, layer2: 'tripleLoad', durability: DURABILITY_POLICY };

/** 失败结算面板 + 底部 CTA 的**非入账**配色（与 `runPage.ts` 的 COLORS 同值）。 */
const PANEL_BG = [0x1b, 0x24, 0x32]; // COLORS.cardBg
const CTA_BAR = [0x33, 0x50, 0x7a]; // COLORS.actionBtn（启用态底部强调条）

/** 驱动预算：新路线实测要走到 DAY 7（R1-D 同一次实测 ≈43s），给足余量。 */
const DRIVE_BUDGET_MS = 120000;

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round2 = (v) => Math.round(v * 100) / 100;

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
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
  /*
    ⚠️ PRODUCT-LOOP-R5-MULTI-WEAPON-PRODUCT-COMPAT-R1｜必须先 `scrollIntoViewIfNeeded()`（与
    `_e2e_product_loop.cjs` / `_e2e_product_reward.cjs` 同一处置）。内容池种子把武器槽从
    3 张卡变成 9 张卡（本段 A4b 两段矩阵合起来要把 9 件**每件都点一次**），排在后面的卡会落到
    `.ph-garage-body` 的滚动区下方 ⇒ `boundingBox()` 仍给出矩形，但真实鼠标点的是**视口外**的坐标，
    点击落在别的元素上。⚠️ 这不是放宽断言：本文件所有判据一字未改。
  */
  const loc = page.locator(sel).first();
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  if (!box) throw new Error(`无法定位元素：${sel}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(120);
}

/** 真实鼠标点击 Run 画布：逻辑坐标 → 屏幕坐标（用画布真实 CSS 矩形换算，不用 DPR-backed 尺寸）。 */
async function clickLogical(page, lx, ly) {
  const screen = (await probeRun(page)).screen;
  await page.mouse.click(screen.left + (lx / 390) * screen.width, screen.top + (ly / 844) * screen.height);
}

/** 点击某个布局矩形的中心（真实鼠标事件）。 */
async function clickRect(page, r) {
  await clickLogical(page, r.x + r.w / 2, r.y + r.h / 2);
}

/** 直接读浏览器真实 localStorage（不经过页面探针，独立取证）。 */
function storageDump(page) {
  return page.evaluate(() => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      o[k] = localStorage.getItem(k);
    }
    return o;
  });
}

/** 首页「不可执行」提示块的**真实 DOM**（不是探针字段 —— 有提示 = 画在页面上）。 */
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

/** 车库「完整冒险」状态块的**真实 DOM**（必改 3：车库必须可识别当前能不能冒险）。 */
const runCompatDom = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-ph-run-compat]');
    return el
      ? {
          value: el.getAttribute('data-ph-run-compat'),
          reason: el.getAttribute('data-ph-run-compat-reason'),
          text: el.textContent ?? '',
        }
      : null;
  });

/** 在画布某矩形内按**精确 RGB 相等**统计像素数（真实 getImageData）。 */
function countColorInRect(page, rect, target) {
  return page.evaluate(
    ({ r, rgb }) => {
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
        if (d[i] === rgb[0] && d[i + 1] === rgb[1] && d[i + 2] === rgb[2]) n += 1;
      }
      return n;
    },
    { r: rect, rgb: target },
  );
}

/** 存档里的主武器槽（独立取证）。 */
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

/** 从「开始冒险」的真实 href 里解码产品侧交出去的装备（只读，不改形态）。 */
function decodeLoadoutFromHref(href) {
  try {
    const raw = new URLSearchParams(href.split('?')[1] ?? '').get('equipped');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 把 `functionalSelections` 摊成「真正装上了的部件」`{挂点: defId}`（跳过空槽）。 */
function mountedMap(selections) {
  const out = {};
  for (const [hp, id] of Object.entries(selections ?? {})) {
    if (id && id !== 'none') out[hp] = id;
  }
  return out;
}

const canon = (m) =>
  JSON.stringify(
    Object.keys(m ?? {})
      .sort()
      .map((k) => [k, m[k]]),
  );

/**
 * 在 Run 页面上走**一步**（真实鼠标点击）：优先处理当前打开的选择事件，否则按下主行动键。
 * ⚠️ 抽成单步是为了让「驱到某一场」与「驱到终态」共用同一套点击策略 ——
 *    两处若各写一份，「驱到第二场」会漏点选择事件而卡死在 CHOICE 上。
 */
async function runStep(page, policy, p) {
  if (p.durabilityOpen && p.overlayOptions.length > 0) {
    const opt = p.overlayOptions.find((o) => o.id === policy.durability) ?? p.overlayOptions[0];
    await clickRect(page, opt.rect);
    await sleep(160);
    return;
  }
  if (p.choiceOpen && p.choiceOptions.length > 0) {
    const want = policy[p.choicePoolKind] ?? null;
    const opt = (want && p.choiceOptions.find((o) => o.id === want)) || p.choiceOptions[0];
    await clickRect(page, opt.rect);
    await sleep(160);
    return;
  }
  if (p.overlayOpen && p.overlayOptions.length > 0) {
    await clickRect(page, p.overlayOptions[0].rect);
    await sleep(160);
    return;
  }
  if (p.actionEnabled) await clickRect(page, p.actionRect);
  await sleep(p.phase === 'BATTLE' ? 320 : 120);
}

/** 把一局 Run 驱到终态（真实鼠标点击；强化按池内 id 选，没指定就取第一项）。 */
async function driveRunToEnd(page, policy, label) {
  const t0 = Date.now();
  const seen = [];
  let last = null;
  while (Date.now() - t0 < DRIVE_BUDGET_MS) {
    const p = await probeRun(page);
    if (!last || last.phase !== p.phase) seen.push(p.phase);
    last = p;
    if (p.phase === 'COMPLETE' || p.phase === 'FAILED') {
      return { probe: p, seen, ms: Date.now() - t0 };
    }
    await runStep(page, policy, p);
  }
  throw new Error(`${label} 驱动超时（${DRIVE_BUDGET_MS}ms）· 最后 phase=${last ? last.phase : 'n/a'}`);
}

/**
 * 驱动到**第 N+1 场真实战斗开打**（`battlesDone` = 开打前已完成的场数），并返回该帧探针。
 *
 *   - `battlesDone === 0` ⇒ 第一场（新局刚出发）；
 *   - `battlesDone === 1` ⇒ **第二场** = PRODUCT-LOOP-P0 的原始 repro 点
 *     （DAY 2 选完一层强化 → DAY 3 这一场创建时才会 `applyRunModifiersToSnapshot()`）。
 */
async function driveUntilBattle(page, battlesDone, policy, label) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < DRIVE_BUDGET_MS) {
    const p = await probeRun(page);
    last = p;
    if (p.phase === 'BATTLE' && p.battleWorld && p.battlesCompleted === battlesDone) return p;
    if (p.phase === 'FAILED' || p.phase === 'COMPLETE') {
      throw new Error(`${label} 在进入目标场次前就结束了（phase=${p.phase} DAY=${p.day}）`);
    }
    await runStep(page, policy, p);
  }
  throw new Error(
    `${label} 未能进入第 ${battlesDone + 1} 场战斗 · 最后 phase=${last ? last.phase : 'n/a'} DAY=${last ? last.day : 'n/a'}`,
  );
}

/** 取某一帧里玩家主武器槽的**真实定义读数**（behavior / damage / params 全取）。 */
function weaponAt(probe, hardpointId) {
  const list = (probe.battleWorld && probe.battleWorld.playerWeapons) || [];
  return list.find((w) => w.hardpointId === hardpointId) ?? null;
}

/* ------------------------------------------------------------------- 主流程 */

async function main() {
  console.log('=== PRODUCT-LOOP-R1-D｜失败结算 → 返回主界面 smoke（真实浏览器）===\n');

  for (const f of ['home.html', 'run-page.html']) {
    if (!fs.existsSync(path.join(ROOT, f))) {
      console.error(`未找到 ${path.join(ROOT, f)} —— 请先 npm run build:portrait-lab`);
      process.exit(1);
    }
  }

  const server = await startServer();
  log(true, 'P0 静态产物就绪（dist-portrait-lab 内 home.html + run-page.html 真实存在）');

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  // 390×844 / DPR 1：Run 画布 1:1（精确色统计与逻辑坐标换算的前提）
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  try {
    /* ======================================================= A. 首页与出发准备 */

    await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
    await waitHomeReady(page);
    const home0 = await probeHome(page);
    const stored0 = await storageDump(page);
    log(
      typeof home0.equippedWeaponId === 'string' && home0.equippedWeaponId !== '' && !!home0.startRunHref,
      'A1 首页就绪：身上有一件真实武器，且「开始冒险」链接已生成',
      `equipped=${home0.equippedWeaponId} href=${(home0.startRunHref ?? '').slice(0, 60)}…`,
    );

    // 产品侧必须把**两类**出口都给全：成功有哪几个去处（候选的领奖地址）+ 失败回哪儿（纯首页）
    const startHref = home0.startRunHref ?? '';
    const startQ = new URLSearchParams(startHref.split('?')[1] ?? '');
    /*
      ⚠️ PRODUCT-LOOP-R2-A 的契约变更：成功侧不再是「一个 back」，而是 `choices` 载荷里
      **每条候选各自的**领奖地址。
      ⚠️ PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY（必改 2）：候选池收窄为 `REWARD_CHOICE_IDS
      = ['cannon']` ⇒ 成功侧**只有一条**去处（只发玩家这一局真的用得上的东西）。
      这里断**字面 1** 而不是「≥ 1」：候选池再变动的第一天，本断言就必须响。
    */
    const choicesRaw = startQ.get(CHOICES_PARAM) ?? '';
    const choices = choicesRaw ? JSON.parse(choicesRaw).choices ?? [] : [];
    const claimHrefs = choices.map((c) => c.href);
    const homeHref = startQ.get(HOME_PARAM) ?? '';
    const homeQ = new URLSearchParams(homeHref.split('?')[1] ?? '');
    log(
      claimHrefs.length === 1 &&
        claimHrefs.every((h) => typeof h === 'string' && h !== '') &&
        homeHref !== '' &&
        claimHrefs.every((h) => h !== homeHref) &&
        !startQ.has(REWARD_PARAM),
      'A2 出发链接同时给全「成功有哪几个去处」（候选池 1 条领奖地址）与「失败回哪儿」，且成功侧**没有**裸 `reward=`',
      `choices=${claimHrefs.map((h) => h.replace('./home.html?', '')).join(' ')} home=${homeHref}`,
    );
    log(
      !homeQ.has(RUN_PARAM) && !homeQ.has(REWARD_PARAM) && homeQ.toString() === '',
      'A3 失败回程地址是**纯首页**：不带 run / reward 参数 ⇒ 回首页不会触发任何入库（必改 5 的地址层保证）',
      `home 参数解析：${homeQ.toString() === '' ? '(空 search)' : homeQ.toString()}`,
    );

    /* ============ A4–A8：PRODUCT-LOOP-P0 守门（非 cannon 不得进入完整 Run） ============ */

    // 车库真实换装：换成一件**非 cannon** 的武器（证明拥有 / 装备这条路仍然畅通 —— 必改 3）
    await clickSelector(page, '[data-ph-action="open-garage"]');
    const garage0 = await probeHome(page);
    await clickSelector(page, `[data-ph-weapon="${BLOCKED_WEAPON}"]`);
    const stored1 = await storageDump(page);
    const garageCompat = await runCompatDom(page);
    log(
      garage0.view === 'garage' &&
        storedWeaponSlot(stored1) === BLOCKED_WEAPON &&
        storedWeaponSlot(stored1) !== storedWeaponSlot(stored0),
      `A4 调整战车：真实点击装上「${BLOCKED_WEAPON_NAME}」→ **正式存档**的主武器槽真的变了（独立取证）`,
      `storage ${WEAPON_SLOT}: ${storedWeaponSlot(stored0)} → ${storedWeaponSlot(stored1)}`,
    );
    log(
      !!garageCompat &&
        garageCompat.value === 'unsupported' &&
        garageCompat.reason === 'unsupported-weapon' &&
        garageCompat.text.includes(COMPAT_NOTICE),
      `A5 车库**可识别当前不可冒险**（必改 3）：状态块 = unsupported + 原因 + 明确提示；且「${BLOCKED_WEAPON_NAME}」仍留在库存里（没被删）`,
      garageCompat ? `[data-ph-run-compat=${garageCompat.value}] ${garageCompat.text.replace(/\s+/g, ' ').trim()}` : 'n/a',
    );
    await clickSelector(page, '[data-ph-action="back-home"]');
    const home1 = await probeHome(page);
    const noticeDom = await compatNoticeDom(page);
    log(
      home1.view === 'home' &&
        home1.startRunBlocked === true &&
        home1.startRunHref === null &&
        home1.runCompat.ok === false &&
        home1.runCompat.reason === 'unsupported-weapon' &&
        home1.runCompat.notice === COMPAT_NOTICE &&
        home1.runCompat.hint === COMPAT_HINT,
      'A6 返回首页：开始冒险进入**不可执行**状态 —— 没有 href（点了不可能创建 Run）、资格读数=不支持、且给出 Queue 逐字的两句提示',
      `blocked=${home1.startRunBlocked} href=${home1.startRunHref} notice=${home1.runCompat.notice} hint=${home1.runCompat.hint}`,
    );
    log(
      !!noticeDom &&
        noticeDom.value === 'unsupported' &&
        noticeDom.reason === 'unsupported-weapon' &&
        noticeDom.text.includes(COMPAT_NOTICE) &&
        noticeDom.text.includes(COMPAT_HINT),
      'A7 提示**真的画在页面上**（不是只在探针里）：DOM 上有提示块，两句文案齐全（Prototype 限制用最小提示，不做弹窗）',
      noticeDom ? `[data-ph-compat=${noticeDom.value}] ${noticeDom.text.replace(/\s+/g, ' ').trim()}` : 'n/a',
    );

    // 真鼠标点「不可执行的开始冒险」：必须**什么也不发生**（不导航 = 没有创建 Run 的可能）
    const urlBeforeBlockedClick = await page.evaluate(() => location.pathname + location.search);
    await clickSelector(page, '[data-ph-action="start-run"]');
    await sleep(600);
    const urlAfterBlockedClick = await page.evaluate(() => location.pathname + location.search);
    const home1b = await probeHome(page);
    log(
      urlAfterBlockedClick === urlBeforeBlockedClick &&
        urlAfterBlockedClick.startsWith('/home.html') &&
        home1b.view === 'home' &&
        home1b.startRunBlocked === true,
      'A8 真鼠标点「开始冒险」：**完全没有导航**、仍停在首页 ⇒ 不支持时不可能进入 Run（不是「进去了再返回」）',
      `url ${urlBeforeBlockedClick} → ${urlAfterBlockedClick}`,
    );

    // 「请先调整战车」那条提示是可以直接执行的：同一个入口能进车库（不做第二个入口）
    await clickSelector(page, '[data-ph-action="open-garage"]');
    const garageBlocked = await probeHome(page);
    log(
      garageBlocked.view === 'garage',
      `A9 提示「${COMPAT_HINT}」可直接执行：真实点击进入调整战车（复用既有入口，没有新增第二个按钮）`,
      `view=${garageBlocked.view}`,
    );

    // 换回 cannon：完整冒险资格必须恢复，且链接里带的装备跟着变
    await clickSelector(page, `[data-ph-weapon="${MAIN_WEAPON}"]`);
    const stored2 = await storageDump(page);
    await clickSelector(page, '[data-ph-action="back-home"]');
    const home2 = await probeHome(page);
    const loadoutBefore = decodeLoadoutFromHref(home2.startRunHref ?? '');
    log(
      storedWeaponSlot(stored2) === MAIN_WEAPON &&
        home2.view === 'home' &&
        home2.equippedWeaponId === MAIN_WEAPON &&
        home2.startRunBlocked === false &&
        !!home2.startRunHref &&
        home2.runCompat.ok === true &&
        (await compatNoticeDom(page)) === null &&
        !!loadoutBefore &&
        loadoutBefore.functionalSelections[WEAPON_SLOT] === MAIN_WEAPON,
      `A10 换回「${MAIN_WEAPON_NAME}」：守门恢复放行（有 href / 提示消失 / 资格=通过），且下一局链接里的装备就是它`,
      `equipped=${home2.equippedWeaponId} blocked=${home2.startRunBlocked} href=${(home2.startRunHref ?? '').slice(0, 48)}… 链接装备槽=${loadoutBefore ? loadoutBefore.functionalSelections[WEAPON_SLOT] : 'n/a'}`,
    );

    /* ============ A4b：**两段**真源驱动矩阵（被拒的 2 件 + 放行的 7 件） ============ */

    /*
      A4–A10 用 `spear` 一件把**被拒**链条走全（真实点击 + 存档独立取证 + 真鼠标点不可执行按钮）。
      A4b 换成**真源驱动**的两段矩阵 —— 因为 R6 之后「非 cannon 一律拒绝」这条口径已经没有了：

        ① **被拒矩阵** `BLOCKED_WEAPON_MATRIX`（= 全部 − 支持，R6-BATCH 起恰好 `['saw','spear']`）
           —— 仍过 A4–A10 的**同一组**判据（一字未改）：
           「未支持武器明确阻止 / 禁止 silent fallback 到 Cannon / 禁止自动替玩家换 Cannon」。
           两件的拒绝理由**不同**（spear：没有 `ram` 工厂；saw：产品槽上圆锯打不到人），
           但**产品侧表现必须完全一致** —— 玩家看到的是同一件事「这件武器跑不了完整冒险」。
        ② **放行矩阵** `SUPPORTED_WEAPON_MATRIX`（= 全部 − 被拒，R6-BATCH 起 7 件）——
           **R6 新契约的正向取证**：每件登记武器装上去之后都**真的**能出发（有 href），
           装备**不会被偷偷换掉**，而且出发链接里的装载载荷**真的**是它。

      ⚠️ 两段都不 import 源码：矩阵由 `CANONICAL_WEAPON_IDS` 与 `SUPPORTED_WEAPON_IDS`
         两张独立抄写的常量推导 ⇒ 源码侧清单一漂移，这里必须响。
      ⚠️ 两段合起来覆盖全部 9 件（2 件被拒 + 7 件放行），没有一件武器落空。
    */
    const invWeaponIds = [...new Set((home2.weapons ?? []).map((w) => w.defId))].sort();
    const weaponNameOf = new Map((home2.weapons ?? []).map((w) => [w.defId, w.name]));
    log(
      invWeaponIds.join(',') === CANONICAL_WEAPON_IDS.join(','),
      'A4b-0 验证账号的武器库存 = canonical 全表（9 件，**逐 id 相等**）⇒ 下面两段矩阵合起来覆盖全部 9 件',
      invWeaponIds.join(','),
    );
    /*
      ⚠️ 先钉一次**两段之和 = 全表**（互斥且完备）：若将来某件武器既不在放行集、
         也不在想拒集（比如常量改错），这条会立刻响 —— 否则它会被「两段各自都通过」掩盖。
    */
    log(
      BLOCKED_WEAPON_MATRIX.length + SUPPORTED_WEAPON_MATRIX.length === CANONICAL_WEAPON_IDS.length &&
        BLOCKED_WEAPON_MATRIX.every((id) => !SUPPORTED_WEAPON_MATRIX.includes(id)),
      `A4b-1 两段矩阵互斥且完备：被拒 ${BLOCKED_WEAPON_MATRIX.length} 件 + 放行 ${SUPPORTED_WEAPON_MATRIX.length} 件 = 全表 ${CANONICAL_WEAPON_IDS.length} 件`,
      `被拒=[${BLOCKED_WEAPON_MATRIX.join(',')}] 放行=[${SUPPORTED_WEAPON_MATRIX.join(',')}]`,
    );

    /* ---- ① 被拒矩阵：明确阻止 / 不许静默回退 / 不许自动换炮 ---- */
    const matrixBad = [];
    for (const wid of BLOCKED_WEAPON_MATRIX) {
      await clickSelector(page, '[data-ph-action="open-garage"]');
      await clickSelector(page, `[data-ph-weapon="${wid}"]`);
      const storedW = await storageDump(page);
      const garageW = await runCompatDom(page);
      await clickSelector(page, '[data-ph-action="back-home"]');
      const homeW = await probeHome(page);
      const noticeW = await compatNoticeDom(page);
      const slotW = storedWeaponSlot(storedW);
      const ok =
        slotW === wid &&
        !!garageW &&
        garageW.value === 'unsupported' &&
        garageW.reason === 'unsupported-weapon' &&
        garageW.text.includes(COMPAT_NOTICE) &&
        homeW.view === 'home' &&
        homeW.equippedWeaponId === wid && // ⇐ 没有自动换炮
        homeW.startRunBlocked === true &&
        homeW.startRunHref === null && // ⇐ 结构上无法创建 Run
        homeW.runCompat.ok === false &&
        homeW.runCompat.reason === 'unsupported-weapon' &&
        !!noticeW &&
        noticeW.text.includes(COMPAT_NOTICE) &&
        noticeW.text.includes(COMPAT_HINT);
      if (!ok) {
        matrixBad.push(
          `${wid}(slot=${slotW} garage=${garageW ? garageW.value : 'n/a'} blocked=${homeW.startRunBlocked} href=${homeW.startRunHref} equipped=${homeW.equippedWeaponId})`,
        );
      }
      log(
        ok,
        `A4b 被拒：「${weaponNameOf.get(wid) ?? wid}」(${wid}) ⇒ 车库 unsupported + 首页无 href + 装备仍是它（**不自动换炮**）`,
        `slot=${slotW} equipped=${homeW.equippedWeaponId} href=${homeW.startRunHref}`,
      );
    }
    log(
      matrixBad.length === 0 && BLOCKED_WEAPON_MATRIX.join(',') === 'saw,spear',
      `A4b-9 **被拒汇总**：${BLOCKED_WEAPON_MATRIX.length} 件跑不了完整 Run 的武器逐件审核全部通过（没有任何一件被静默放行；两件理由不同但**产品表现必须一致**）· 矩阵 = [${BLOCKED_WEAPON_MATRIX.join(',')}]`,
      matrixBad.length === 0 ? '全部通过' : `失败：${matrixBad.join(' | ')}`,
    );

    /* ---- ② 放行矩阵：R6 新契约的正向取证（每件登记武器**真的**能出发） ---- */
    const supportedBad = [];
    for (const wid of SUPPORTED_WEAPON_MATRIX) {
      await clickSelector(page, '[data-ph-action="open-garage"]');
      await clickSelector(page, `[data-ph-weapon="${wid}"]`);
      const storedW = await storageDump(page);
      const garageW = await runCompatDom(page);
      await clickSelector(page, '[data-ph-action="back-home"]');
      const homeW = await probeHome(page);
      const noticeW = await compatNoticeDom(page);
      const slotW = storedWeaponSlot(storedW);
      const loadoutW = decodeLoadoutFromHref(homeW.startRunHref ?? '');
      const ok =
        slotW === wid && // ① 正式存档真的换成了它（**独立**读 localStorage）
        !!garageW &&
        garageW.value === 'ok' && // ② 车库说「当前装备可以出发」（不再 unsupported）
        homeW.view === 'home' &&
        homeW.equippedWeaponId === wid && // ③ 装备仍是它（没有被换成别的）
        homeW.startRunBlocked === false &&
        !!homeW.startRunHref && // ④ **结构上真的能**创建 Run
        homeW.runCompat.ok === true &&
        homeW.runCompat.reason === 'ok' &&
        /*
          ⑤ 本局 base = 它自己。`baseWeaponDefId` 的定义就是 `equippedWeaponIds[0]`
             （探针没单独报 base，这里按定义读同一个读数）。

          ⚠️ 刻意**不**写 `equippedWeaponIds.length === 1`：默认车在 `top` 槽也装着 `hammer`
             （同一份 profile 的既有事实，`equipped=` 载荷里能看到）⇒ 车上本来就可以有
             **多件**武器。R6 的规则是「**装配顺序第一件**正式武器 = Run base」，
             所以这里要钉的是「第一件就是刚点上的这件」，而不是「车上只有一件」。
        */
        homeW.runCompat.equippedWeaponIds[0] === wid &&
        homeW.runCompat.equippedWeaponIds.includes(wid) &&
        // ⑥ 出发链接真的带的是它（不是被静默换成 cannon）
        !!loadoutW &&
        loadoutW.functionalSelections[WEAPON_SLOT] === wid &&
        noticeW === null; // ⑦ 没有残留的「不可执行」提示块
      if (!ok) {
        supportedBad.push(
          `${wid}(view=${homeW.view} slot=${slotW} garage=${garageW ? garageW.value : 'n/a'} blocked=${homeW.startRunBlocked} href=${homeW.startRunHref} ok=${homeW.runCompat.ok} reason=${homeW.runCompat.reason} base=${(homeW.runCompat.equippedWeaponIds ?? [])[0]} 链接=${loadoutW ? loadoutW.functionalSelections[WEAPON_SLOT] : 'n/a'} notice=${noticeW ? noticeW.value : 'null'})`,
        );
      }
      log(
        ok,
        `A4b 放行（R6 新契约）：「${weaponNameOf.get(wid) ?? wid}」(${wid}) ⇒ 车库 ok + 首页有 href + base 就是它自己（**不注入 Cannon**）`,
        `slot=${slotW} base=${(homeW.runCompat.equippedWeaponIds ?? [])[0]} href=${(homeW.startRunHref ?? '').slice(0, 40)}…`,
      );
    }
    log(
      supportedBad.length === 0 && SUPPORTED_WEAPON_MATRIX.length === 7,
      `A4b-11 **放行汇总**：${SUPPORTED_WEAPON_MATRIX.length} 件登记武器逐件审核全部通过（每件都真的能出发，且本局 base = 它自己）`,
      supportedBad.length === 0 ? '全部通过' : `失败：${supportedBad.join(' | ')}`,
    );

    // 矩阵跑完后把装备放回 cannon —— B 段要真的进局
    await clickSelector(page, '[data-ph-action="open-garage"]');
    await clickSelector(page, `[data-ph-weapon="${MAIN_WEAPON}"]`);
    await clickSelector(page, '[data-ph-action="back-home"]');
    const homeAfterMatrix = await probeHome(page);
    log(
      homeAfterMatrix.view === 'home' &&
        homeAfterMatrix.equippedWeaponId === MAIN_WEAPON &&
        homeAfterMatrix.startRunBlocked === false &&
        !!homeAfterMatrix.startRunHref,
      `A4b-10 矩阵结束后换回「${MAIN_WEAPON_NAME}」：守门恢复放行（有 href）⇒ 后续 B 段可正常进局`,
      `equipped=${homeAfterMatrix.equippedWeaponId} href=${(homeAfterMatrix.startRunHref ?? '').slice(0, 40)}…`,
    );

    /* ============================================================== B. 进局 */

    await Promise.all([
      page.waitForURL(/run-page\.html/, { timeout: 20000 }).catch(() => {}),
      clickSelector(page, '[data-ph-action="start-run"]'),
    ]);
    await waitRunReady(page);
    const runStartUrl = await page.evaluate(() => location.pathname + location.search);
    const runStart = await probeRun(page);
    log(
      runStart.playerLoadout.source === 'profile' &&
        runStart.playerLoadout.fallback === 'none' &&
        runStart.playerLoadout.functionalSelections[WEAPON_SLOT] === MAIN_WEAPON,
      'B1 真实整页导航进局：这一局用的就是**首页那份装备**（source=profile / 无回退 / 主武器槽相同）',
      `source=${runStart.playerLoadout.source} fallback=${runStart.playerLoadout.fallback} ${WEAPON_SLOT}=${runStart.playerLoadout.functionalSelections[WEAPON_SLOT]}`,
    );
    log(
      runStart.phase !== 'FAILED' && runStart.failSettlement === null && runStart.failPanelRect === null,
      'B2 还没打完：没有任何失败结算（结算只在**真失败之后**出现，不是常驻面板）',
      `phase=${runStart.phase} failSettlement=${runStart.failSettlement}`,
    );
    // 失败回程地址真的进了局内（Lab 侧拿到的是产品给的那个地址）
    const runSearch = new URLSearchParams(runStartUrl.split('?')[1] ?? '');
    log(
      runSearch.get(HOME_PARAM) === homeHref,
      `B3 局内拿到了失败回程地址（逐字等于产品侧给的那个）：${HOME_PARAM}=${runSearch.get(HOME_PARAM)}`,
      `home=${runSearch.get(HOME_PARAM)}`,
    );

    /* ============================ C0. P0 原始 repro 路径（强化注入的那一场） */

    const firstBattle = await driveUntilBattle(page, 0, FAIL_POLICY, '第一场');
    const w1 = weaponAt(firstBattle, WEAPON_SLOT);
    log(
      !!w1 && firstBattle.build.length === 0,
      'C0a 第一场（DAY 2）真实开打：本局还没有任何强化，主武器槽读到的就是**正式基准武器**本身',
      w1 ? `build=${JSON.stringify(firstBattle.build)} ${WEAPON_SLOT}.defId=${w1.defId} behavior=${w1.behavior}` : 'n/a',
    );

    /*
      ⚠️ 这一条就是 PRODUCT-LOOP-P0 的原始 repro 路径的**真实浏览器**取证：
        「DAY2 选/进入一层强化 → DAY3 第二场战斗创建 → `applyRunModifiersToSnapshot()` 注入」。
      ⚠️ 判据为什么看 `playerWeapons[].behavior/params` 而不看 `defId`：
        overlay 部件是 `composeRunWeaponDef()` 用 `{...正式cannon}` 派生出来的 ⇒ 它的
        `def.id` 字段**仍然是 `'cannon'`**（只有本局 registry 的**键**是 overlay id）。
        真正「强化生效了」的可观测差别在 behavior / behaviorParams 上 —— 那也正是
        Battle Runtime 实际使用的那份定义。
    */
    const secondBattle = await driveUntilBattle(page, 1, FAIL_POLICY, '第二场（强化注入场）');
    const w2 = weaponAt(secondBattle, WEAPON_SLOT);
    const w1Signature = w1 ? JSON.stringify([w1.behavior, w1.damage, w1.params]) : 'n/a';
    const w2Signature = w2 ? JSON.stringify([w2.behavior, w2.damage, w2.params]) : 'n/a';
    log(
      !!w1 &&
        !!w2 &&
        secondBattle.build.length >= 1 &&
        w2Signature !== w1Signature &&
        secondBattle.phase === 'BATTLE' &&
        secondBattle.battlesCompleted === 1,
      'C0b（P0 回归）DAY 3 第二场**真的创建成功且强化真的生效**：Run 推进到第二场、本局 Build 非空、主武器槽的定义已不是基准炮（behavior/params 真的变了）',
      `build=${JSON.stringify(secondBattle.build)} · 第二场 ${WEAPON_SLOT}: ${w2Signature}（第一场 ${w1Signature}）`,
    );

    /* ============================================ C. 真打 → RUN FAILED 结算 */

    const lose = await driveRunToEnd(page, FAIL_POLICY, '失败路线');
    const pFail = lose.probe;
    log(
      pFail.phase === 'FAILED' && pFail.failed === true && pFail.complete === false && pFail.battle,
      'C1 真实物理打出失败：RUN FAILED（不是构造状态，是这一场真的被打到耐久归零）',
      `phase=${pFail.phase} battles=${pFail.battlesCompleted}/${pFail.battleTotal} DAY=${pFail.day} 用时 ${round2(lose.ms / 1000)}s · 终局 HP=${pFail.battle ? pFail.battle.playerHp : 'n/a'}`,
    );

    const fs1 = pFail.failSettlement;
    log(
      !!fs1 &&
        fs1.title === '冒险失败' &&
        fs1.day === pFail.day &&
        fs1.durabilityPercent === 0 &&
        Array.isArray(fs1.lines) &&
        fs1.lines.length === 3,
      'C2 明确出现「冒险失败」结算：标题 + 失败 DAY + 最终 Build + 最终耐久（最低必要信息，必改 3）',
      fs1 ? `${fs1.title} · ${fs1.lines.join(' / ')}` : 'n/a',
    );
    /*
      ⚠️ 与更换失败路线前的那一版**故意不同**：旧路线第一场就死 ⇒ 本局零改装（断言「未做任何改装」）。
      新路线打到 DAY 7 ⇒ 本局**真的拿过**强化。断言从「写死一句未改装」改成
      「结算逐字复述本局真实拿到的那些改装」—— 这比原来更强，因为它锁住了
      「结算内容 = 真实状态」这件事对一个**非空** Build 也成立。
    */
    log(
      !!fs1 &&
        fs1.buildLabels.length === pFail.build.length &&
        pFail.build.length >= 2 &&
        fs1.lines[1] === `最终改装：${fs1.buildLabels.join(' + ')}` &&
        fs1.lines[1] !== '最终改装：未做任何改装' &&
        fs1.lines[2] === '战车耐久：已耗尽',
      'C3 结算内容逐项来自真实状态：列出的改装 = 本局真的拿到的那几项（逐字拼回），耐久 0 ⇒ 写「已耗尽」',
      fs1 ? `${fs1.lines[1]} · ${fs1.lines[2]}` : 'n/a',
    );
    log(
      pFail.actionLabel === '返回主界面' &&
        pFail.actionEnabled === true &&
        pFail.exitHref === homeHref &&
        !claimHrefs.includes(pFail.exitHref) &&
        pFail.actionLabel !== '重新开始冒险',
      'C4 底部**唯一**主 CTA =「返回主界面」，出口 = 产品侧给的**纯首页**地址（不是三条领奖地址中的任何一条、更不是「重新开始冒险」，必改 3 / 必改 6）',
      `label=${pFail.actionLabel} enabled=${pFail.actionEnabled} exit=${pFail.exitHref}（候选领奖地址=${claimHrefs.join(' ')}）`,
    );
    log(
      pFail.rewardChoices.length === 0 &&
        pFail.rewardChoiceRects.length === 0 &&
        pFail.chosenDefId === null &&
        pFail.rewardChoicesDropped === 0,
      'C5 失败**不发永久奖励**：3选1 候选 / 候选矩形 / 已选件三方皆为空（必改 5；载荷本身合法，不是靠「解析失败」才没有奖励）',
      `choices=${pFail.rewardChoices.length} rects=${pFail.rewardChoiceRects.length} chosen=${pFail.chosenDefId} dropped=${pFail.rewardChoicesDropped}`,
    );
    const domButtons = await page.evaluate(() => window.__RUNPAGE__.probe().domButtons);
    log(
      domButtons === 0,
      'C6 失败页面上**没有**任何 DOM 按钮（页面结构上不存在第二个动作入口 —— 想重开也无处可点）',
      `domButtons=${domButtons}`,
    );

    // 像素取证：结算面板与 CTA 真的画在画布上（不是只有探针字段）
    const panelRect = pFail.failPanelRect;
    const panelPx = panelRect ? await countColorInRect(page, panelRect, PANEL_BG) : -1;
    const ctaPx = await countColorInRect(page, pFail.actionRect, CTA_BAR);
    log(
      !!panelRect && panelPx > 20000 && ctaPx > 0,
      'C7 像素取证（真实 getImageData）：结算面板底色成片 + 底部 CTA 强调条真的画出来',
      `panel=${panelRect ? `${panelRect.x},${panelRect.y} ${panelRect.w}×${panelRect.h}` : 'n/a'} cardBg=${panelPx}px actionBtn=${ctaPx}px`,
    );

    /* ==================================== D. 必改 2 / 必改 6：失败必须停住 */

    const snap0 = await probeRun(page);
    const samples = [];
    for (let i = 0; i < 12; i++) {
      await sleep(220);
      const p = await probeRun(page);
      samples.push(`${p.phase}/${p.day}/${p.battlesCompleted}/${p.nodeId}`);
    }
    const stable = samples.every((s) => s === samples[0]);
    log(
      stable && samples[0].startsWith('FAILED/'),
      'D1 FAILED 后等待 ~2.6s（跨很多帧）：相位 / DAY / 已打场数 / 脚本节点**一个都没变**（不自动推进、不自动重开）',
      `采样=${samples[0]}（12 次全同）`,
    );

    // 误触：点非按钮区域（日志带 / 舞台带空白）必须零副作用
    await clickLogical(page, 195, 640);
    await sleep(200);
    await clickLogical(page, 20, 400);
    await sleep(400);
    const snap1 = await probeRun(page);
    /*
      ⚠️ 这里原来比的是 `revision` —— 但 `runPage.ts` 的 `baseProbe()` **没有这个字段**
        （`snap.revision` 恒为 `undefined`）⇒ `undefined === undefined` 让这条断言
        白拿了一半结论。改比**整份事件日志**（`log[].seq` 逐条），比一个计数器更强：
        任何一次误触都会往日志里添一条，逐条比对骗不过去。
    */
    const log1 = JSON.stringify(snap1.log ?? []);
    const log0 = JSON.stringify(snap0.log ?? []);
    log(
      snap1.phase === 'FAILED' &&
        snap1.day === snap0.day &&
        snap1.battlesCompleted === snap0.battlesCompleted &&
        snap1.nodeId === snap0.nodeId &&
        snap1.logCount === snap0.logCount &&
        log1 === log0,
      'D2 失败页面上点**任何非按钮位置**都零副作用（相位 / DAY / 场数 / 节点 / 事件日志逐条全同 —— 必改 2「除非用户明确点击动作」）',
      `phase=${snap1.phase} DAY=${snap1.day} battles=${snap1.battlesCompleted} log=${snap1.logCount} 条（逐条相同）`,
    );

    const storedAtFail = await storageDump(page);

    /* ====================================================== E. 返回主界面 */

    await Promise.all([
      /* ⚠️ pathname 谓词：Run 页地址自带 `home=.%2Fhome.html` ⇒ 子串正则 `/home\.html/`
         会当场匹配自己、根本不等待导航。 */
      page.waitForURL((u) => u.pathname === '/home.html', { timeout: 20000 }).catch(() => {}),
      clickRect(page, pFail.actionRect),
    ]);
    await waitHomeReady(page);
    const afterReturnUrl = await page.evaluate(() => location.pathname + location.search);
    const afterQ = new URLSearchParams(afterReturnUrl.split('?')[1] ?? '');
    log(
      afterReturnUrl === '/home.html' || (afterReturnUrl.startsWith('/home.html') && !afterQ.has(RUN_PARAM) && !afterQ.has(REWARD_PARAM)),
      'E1 点「返回主界面」= 真实整页导航回正式首页，且 URL 里**没有**领奖参数（失败绝不触发入库）',
      `url=${afterReturnUrl}`,
    );

    const storedAfterReturn = await storageDump(page);
    const homeAfterFail = await probeHome(page);
    log(
      storedAfterReturn[BUILD_KEY] === storedAtFail[BUILD_KEY] &&
        storedAfterReturn[INV_KEY] === storedAtFail[INV_KEY] &&
        storedAfterReturn[CLAIMS_KEY] === storedAtFail[CLAIMS_KEY] &&
        storedWeaponSlot(storedAfterReturn) === MAIN_WEAPON,
      'E2 三件套**逐字节不变**：Profile 没被清空、Inventory 没动、Equipped 还是那件（失败不发奖也不删档，必改 4）',
      `${WEAPON_SLOT}=${storedWeaponSlot(storedAfterReturn)} 账本=${storedAfterReturn[CLAIMS_KEY] ? '有' : '无'}`,
    );
    log(
      homeAfterFail.claim === null &&
        homeAfterFail.view === 'home' &&
        homeAfterFail.equippedWeaponId === MAIN_WEAPON &&
        !!homeAfterFail.startRunHref &&
        homeAfterFail.startRunBlocked === false,
      'E3 回到首页是一次**干净挂载**：没有领奖请求、停在首页视图、装备仍是那件、可以再次出发',
      `claim=${homeAfterFail.claim} view=${homeAfterFail.view} equipped=${homeAfterFail.equippedWeaponId}`,
    );

    await clickSelector(page, '[data-ph-action="open-garage"]');
    const garageAfterFail = await probeHome(page);
    log(
      garageAfterFail.view === 'garage' && garageAfterFail.weaponIds.includes(MAIN_WEAPON),
      'E4 回首页后**可以直接进入调整战车**（失败链的终点是「可调整配置」而不是死胡同）',
      `view=${garageAfterFail.view} 车库件数=${garageAfterFail.weaponIds.length}`,
    );
    await clickSelector(page, '[data-ph-action="back-home"]');

    /* ============================== F. 失败后的新 Run 只能由玩家主动出发 */

    const home3 = await probeHome(page);
    const loadout2 = decodeLoadoutFromHref(home3.startRunHref ?? '');
    log(
      !!loadout2 && loadout2.functionalSelections[WEAPON_SLOT] === MAIN_WEAPON,
      'F1 玩家主动再点「开始冒险」：链接带的仍是当前 Equipped（新 Run 的入口只有首页这一个）',
      `${WEAPON_SLOT}=${loadout2 ? loadout2.functionalSelections[WEAPON_SLOT] : 'n/a'}`,
    );

    await Promise.all([
      page.waitForURL(/run-page\.html/, { timeout: 20000 }).catch(() => {}),
      clickSelector(page, '[data-ph-action="start-run"]'),
    ]);
    await waitRunReady(page);
    const run2Start = await probeRun(page);
    log(
      run2Start.day === 1 &&
        run2Start.battlesCompleted === 0 &&
        run2Start.build.length === 0 &&
        run2Start.repairBonus === 0 &&
        run2Start.phase !== 'FAILED' &&
        run2Start.failSettlement === null,
      'F2 新 Run 状态**干净**：DAY 1 / 没打过任何一场 / Run Buff 与维修补偿清空 / 也不残留上一局的失败结算（必改 4）',
      `DAY=${run2Start.day} battles=${run2Start.battlesCompleted} build=${JSON.stringify(run2Start.build)} 补偿=${run2Start.repairBonus} phase=${run2Start.phase}`,
    );

    const fb = await driveUntilBattle(page, 0, FAIL_POLICY, '第二局第一场');
    log(
      fb.battle.playerHp === fb.battle.playerHpMax && fb.battle.steps >= 1,
      'F3 新 Run 第一场是**满耐久**开打（不是上一局剩下的血）',
      `HP=${fb.battle.playerHp}/${fb.battle.playerHpMax} steps=${fb.battle.steps}`,
    );
    const mounted2 = {};
    for (const f of fb.battleWorld.playerFunctionals ?? []) mounted2[f.hardpointId] = f.defId;
    log(
      canon(mounted2) === canon(mountedLoadout(loadout2)),
      'F4 新 Run 第一场**真实装配** = 首页那份 Equipped（逐槽对账，不是「大致一样」）',
      `实际=${canon(mounted2)} vs 链接=${canon(mountedLoadout(loadout2))}`,
    );

    log(pageErrors.length === 0, 'G1 全流程零运行时报错', pageErrors.slice(0, 2).join(' | ') || 'none');
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
    process.exit(1);
  }
}

function mountedLoadout(draft) {
  return mountedMap(draft && draft.functionalSelections);
}

main().catch((e) => {
  console.error('E2E 运行失败：', e && e.stack ? e.stack : e);
  process.exit(1);
});
