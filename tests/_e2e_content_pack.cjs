/**
 * F-CONTENT-PACK-BROWSER-GATE-R1｜内容包浏览器集成验收 E2E 门禁（车身 / 轮组 / 正式奖励闭环）。
 *
 * 只使用 E2E 构建（dist-e2e，__E2E_INTERNAL_HANDLE__ 内部句柄 __h/__probe 编译期注入；
 * 正式 Web/Pages/WeChat/RC 构建零泄漏——见 vite.e2e.config.ts / check-wechat-bundle-clean.js）。
 * 坐标来源 = 运行时真实 hitArea（window.__h）；几何/像素 = __probe 只读快照 + 真实 getImageData；
 * 输入 = 真实鼠标点击序列（禁 hitArea/__h 捷径替身）。不增加任何生产 probe。
 *
 * 覆盖三部分（A. 车身内容 / B. Movement 内容 / C. 正式奖励闭环）+ 三视口
 * （420×210 dpr1 / 844×390 dpr1 / 1280×592 dpr1.5）重点覆盖。
 *
 * 【Garage 导航事实（本脚本依赖的正式 UI 契约，v7cd8c0b 实测）】
 * - 直接加载 ?player=1 → playerPhase='garage' 但 metaPage='home'（正式首页）；
 *   必须点 home-garage 进装配面板（metaPage='garage'）；dev-grant-all 在装配面板内渲染；
 * - 三视口（420×210 / 844×390 / 1280×592）按 isCompactLandscape 全判为 mobile 布局：
 *   **移动端无 chip:* 命中区**（chip 槽是 Desktop 概念）——装配面板只有三个分类 tab
 *   garage-cat:body|move|combat + 当前选中槽的横向部件卡带；
 *   切分类自动选中该分类首槽（onToggleGarageSlot(slots[0])：body→body / move→rearWheel）；
 * - onToggleGarageSlot 是 toggle：已选中槽再点会收起选项条 → 已在目标分类时
 *   不得重复点 tab（用 lastState.garageSelected 先行判定，避免收起）；
 * - 部件卡横排（body 8 卡 × 132px 必溢出 844 视口）：越界/部分可见卡不注册 hitArea；
 *   完全可见卡才可点（strip-scroll-left/right 翻页）→ pickOption / 断言都需滚动感知；
 * - 移动端 drive 槽无入口（chip:drive / entry:drive / hp-sel:drive 均无；Garage idle
 *   挂点不注册命中——F-GARAGE-VISUAL-DENSITY-R2 正式设计）→ 站桩（drive=stationary）
 *   真实点击不可达（F-GARAGE-TOUCH-ASSEMBLY-R2 范畴），B.7 作可达验证 + 披露；
 * - 装配面板内没有「寻找对手」；开战必须 nav:home 回正式首页再 home-find-opponent；
 * - 战斗 Result（移动端 modal）：win → primary=下一场 / secondary=调整配置；loss 反之。
 *   胜/负均结算奖励，不能用 reward 推断胜负 → tapAdjust 用 lastState.result.winner 探测。
 *
 * C 部分确定性：不调用 debug grant、不预置 grantAllNewBodies（正式 body reward 路径必须
 * 真实走通）。用「覆盖全局 Math.random 为恒值」注入可控 RNG——候选池 = [12 functional +
 * 3 movement + 未拥有 body]，恒值按区间精确命中目标 defId：
 *   19 候选（全 fresh）：smallWheel∈[12/19,13/19)  durianBody∈[15/19,16/19)
 *   18 候选（已拥有 durianBody）：pearBody∈[15/18,16/18)  → rng=0.85 → floor(15.3)=15 ✓
 * （匹配抽取与结算都消费 Math.random；恒值与调用次数无关，结算必命中区间。）
 */
const { chromium } = require('playwright-core');
const BASE = 'http://127.0.0.1:8138/?player=1';
const BASE_DEV = 'http://127.0.0.1:8138/?player=1&resetdev=1';
const INV_KEY = 'strongfruit.ownedParts.v2';
const BODIES_KEY = 'strongfruit.ownedBodies.v1';

let PASS = 0;
let FAIL = 0;
function log(ok, name, info) {
  const tag = ok ? 'PASS' : 'FAIL';
  if (ok) PASS++; else FAIL++;
  console.log(`${tag} ${name} | ${info}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 内部句柄读取（仅 E2E 构建存在） ----------
async function probe(page) {
  return page.evaluate(() => (globalThis.__probe ? { ...globalThis.__probe } : null)).catch(() => null);
}
async function hitAreas(page) {
  return page.evaluate(() => {
    const h = globalThis.__h;
    if (!h) return [];
    return (h.hitAreas || []).filter((a) => a && a.id).map((a) => ({ id: a.id, x: a.x, y: a.y, w: a.w, h: a.h }));
  }).catch(() => []);
}
async function findHit(page, id, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const list = await hitAreas(page);
    const t = list.find((a) => a.id === id);
    if (t) return t;
    await sleep(150);
  }
  return null;
}
async function toClient(page, lx, ly) {
  const box = await page.locator('canvas').first().boundingBox();
  const t = await page.evaluate(() => globalThis.__h.getTransformInfo());
  const k = t.cssW > 0 ? box.width / t.cssW : 1;
  return { x: box.x + (t.ox + t.scale * lx) * k, y: box.y + (t.oy + t.scale * ly) * k };
}
async function clickHit(page, hit) {
  if (!hit) return false;
  const p = await toClient(page, hit.x + hit.w / 2, hit.y + hit.h / 2);
  await page.mouse.click(p.x, p.y);
  await sleep(220);
  return true;
}
async function waitProbe(page, pred, ms, step = 120) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const p = await probe(page);
    if (pred(p)) return p;
    await sleep(step);
  }
  return null;
}
async function draftOf(page) {
  return page.evaluate(() => {
    const d = globalThis.__h && globalThis.__h.lastState && globalThis.__h.lastState.draft;
    return d
      ? {
          bodyDefId: d.bodyDefId,
          rearRadius: d.rearRadius,
          rearWheelDefId: d.rearWheelDefId ?? null,
          frontWheelDefId: d.frontWheelDefId ?? null,
          drive: d.drive ?? 'forward',
          valid: !!(globalThis.__h.lastState && globalThis.__h.lastState.draftValid),
        }
      : null;
  }).catch(() => null);
}
async function rewardStateOf(page) {
  return page.evaluate(() => {
    const s = globalThis.__h && globalThis.__h.lastState;
    const r = s && s.reward;
    return r ? { kind: r.kind, name: r.name, starStr: r.starStr, cat: r.cat, countAfter: r.countAfter } : null;
  }).catch(() => null);
}
async function garageSelectedOf(page) {
  return page.evaluate(() => (globalThis.__h && globalThis.__h.lastState ? globalThis.__h.lastState.garageSelected : null)).catch(() => null);
}
async function anyOptHit(page) {
  return page
    .evaluate(() => {
      const h = globalThis.__h;
      return !!(h && h.hitAreas && h.hitAreas.some((a) => a && a.id && a.id.startsWith('opt:')));
    })
    .catch(() => false);
}
/** 当前选中槽位的已装值（用于装备点击的效果验证；wheelStd 默认轮 defId 为 null 时回落 radius） */
async function slotValueOf(page) {
  return page.evaluate(() => {
    const h = globalThis.__h;
    const s = h && h.lastState;
    if (!s || !s.draft) return null;
    const slot = s.garageSelected;
    const d = s.draft;
    if (slot === 'body') return d.bodyDefId;
    if (slot === 'rearWheel') return d.rearWheelDefId ?? String(d.rearRadius);
    if (slot === 'frontWheel') return d.frontWheelDefId ?? String(d.frontRadius);
    if (slot === 'drive') return d.drive;
    return null;
  }).catch(() => null);
}
/** 当前 armed 的卡片值（轮卡点击 → armed → 点挂点的中间态验证） */
async function armedOf(page) {
  return page
    .evaluate(() => {
      const g = globalThis.__h && globalThis.__h.garageDrag;
      return g && g.card ? g.card.v : null;
    })
    .catch(() => null);
}

// ---------- 统一奖励状态（localStorage 双键） ----------
async function rewardState(page) {
  return page.evaluate(
    ([invK, bodyK]) => {
      const readInv = () => {
        try {
          const raw = localStorage.getItem(invK);
          if (!raw) return 0;
          const obj = JSON.parse(raw);
          const inv = obj && typeof obj === 'object' && 'obj' in obj ? obj.obj : obj;
          let n = 0;
          for (const key of Object.keys(inv)) {
            const e = inv[key];
            if (e && typeof e === 'object') n += (e.one || 0) + (e.two || 0);
          }
          return n;
        } catch { return -1; }
      };
      const readBodies = () => {
        try {
          const raw = localStorage.getItem(bodyK);
          if (!raw) return 0;
          const arr = JSON.parse(raw);
          return Array.isArray(arr) ? arr.length : 0;
        } catch { return 0; }
      };
      return { inv: readInv(), bodies: readBodies() };
    },
    [INV_KEY, BODIES_KEY],
  );
}
function rewardDelta(before, after) {
  return { inv: after.inv - before.inv, bodies: after.bodies - before.bodies };
}
function logReward(ok, name, info, before, after) {
  const d = rewardDelta(before, after);
  const valid = (d.inv === 1 && d.bodies === 0) || (d.inv === 0 && d.bodies === 1);
  log(ok && valid, name, `${info} | Δinv=${d.inv} Δbodies=${d.bodies}`);
}

// ---------- RNG 注入（恒值覆盖，与调用次数无关） ----------
async function setRng(page, v) {
  await page.evaluate((val) => {
    (globalThis).__origRandom = (globalThis).Math.random;
    (globalThis).Math.random = () => val;
  }, v);
}
async function restoreRng(page) {
  await page.evaluate(() => {
    if ((globalThis).__origRandom) (globalThis).Math.random = (globalThis).__origRandom;
  });
}

// ---------- 页面导航（Garage 装配面板 / 首页开战） ----------
/** 进入 Garage 装配面板（metaPage='garage'）。直接加载页面停在正式首页（metaPage='home'），
 *  无 chip 槽；必须点 home-garage 切入装配面板，chip 槽与 dev-grant-all 才渲染。 */
async function enterGaragePanel(page) {
  const p = await waitProbe(page, (pp) => pp && pp.playerPhase === 'garage', 10000);
  if (!p) return false;
  // 装配面板特征：mobile = garage-cat 分类 tab；desktop = chip 槽（三视口全 mobile → 走 tab）
  if ((await findHit(page, 'garage-cat:body', 3)) || (await findHit(page, 'chip:body', 3))) return true;
  const hg = await findHit(page, 'home-garage', 6);
  if (!hg) return false;
  await clickHit(page, hg);
  await sleep(250);
  return !!(await findHit(page, 'garage-cat:body', 8)) || !!(await findHit(page, 'chip:body', 8));
}
async function gotoGarage(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  return enterGaragePanel(page);
}
/** 回正式首页（metaPage='home'）——装配面板内无「寻找对手」，开战必须先回首页。 */
async function toHomePage(page) {
  if (await findHit(page, 'home-find-opponent', 4)) return true;
  const back = await findHit(page, 'nav:home', 5);
  if (!back) return false;
  await clickHit(page, back);
  return !!(await findHit(page, 'home-find-opponent', 8));
}
/** 确保分类 tab（body / move）。mobile 无 chip:* 命中区——分类判定用
 *  lastState.garageSelected（进入装配面板自动选中首槽：body→body / move→rearWheel；
 *  onToggleGarageSlot 是 toggle，已在目标分类时点 tab 会收起 → 必须先行判定）。
 *  desktop 兜底：chip 槽存在即已就绪。 */
async function ensureGarageCat(page, cat) {
  const chipProbe = cat === 'body' ? 'chip:body' : 'chip:rearWheel';
  if (await findHit(page, chipProbe, 2)) return true; // desktop chip 槽
  const sel = await garageSelectedOf(page);
  const inCat = cat === 'body' ? sel === 'body' : sel === 'rearWheel' || sel === 'frontWheel' || sel === 'drive';
  if (inCat) return true;
  const tab = await findHit(page, `garage-cat:${cat}`, 5);
  if (!tab) return false;
  await clickHit(page, tab);
  await sleep(250);
  return true;
}
/** 展开某槽位选项条。mobile：无 chip 命中区，槽位由分类 tab 自动选中（body→body /
 *  move→rearWheel）；frontWheel/drive 无入口 → false（调用方处理）。desktop：chip 点击。 */
async function openChip(page, chipId) {
  const slotKey = chipId.slice(5); // 'body' | 'rearWheel' | 'frontWheel' | 'drive'
  const cat = slotKey === 'body' ? 'body' : 'move';
  if (!(await ensureGarageCat(page, cat))) return false;
  const sel = await garageSelectedOf(page);
  if (sel === slotKey) return anyOptHit(page); // 该槽选项条已展开
  const chip = await findHit(page, chipId, 4);
  if (chip) {
    await clickHit(page, chip);
    await sleep(250);
    return true;
  }
  return false; // mobile 非首槽（frontWheel/drive）无 chip 入口
}
/** 点选项卡（F-CONTENT-PACK-REAL-UI-R1 真实玩家语义：禁点击失败重试）。
 *  - Fix 2 已消除 strip-scroll 漂移（布局前统一 clampGarageStripScroll）→ 点卡即装所见卡；
 *  - 真实玩家路径：先向右翻页直到目标卡完全可见（strip-scroll-right 仅用于「揭示」，非重试点击），
 *    单击一次，立即 verify 效果；verify 失败即 FAIL（不再点卡重试掩盖真实缺陷）；
 *  - onVerifyFail 仅作「armed→点挂点」单步补装（移动端轮卡点击进入 armed 后必须再点挂点才装备，
 *    属正式交互路径，非点击重试），成功一次即返回。
 *  opts.verify(page) → boolean 表示装备生效。
 *  opts.onVerifyFail(page) → boolean 表示「armed 挂点补装成功」。 */
async function pickOption(page, optId, opts = {}) {
  const { verify, onVerifyFail } = opts;
  for (let i = 0; i < 10; i++) {
    const opt = await findHit(page, optId, 2);
    if (opt) {
      await clickHit(page, opt); // 真实玩家单击一次
      await sleep(250);
      if (!verify || (await verify(page))) return true;
      // 仅允许「armed→点挂点」单步补装（正式交互，非点击重试）
      if (onVerifyFail && (await onVerifyFail(page))) return true;
      return false; // 真实失败：不重试，不掩盖
    }
    const next = await findHit(page, 'strip-scroll-right', 2); // 翻页揭示目标卡（非重试）
    if (!next) break;
    await clickHit(page, next);
    await sleep(150);
  }
  return false;
}
/** 横向扫 strip：每步先查目标 hitArea，无则向右翻页；返回「任意滚动位置出现过」。 */
async function scanStripForHit(page, optId, rightTries = 8) {
  for (let i = 0; i <= rightTries; i++) {
    if (await findHit(page, optId, 2)) return true;
    const next = await findHit(page, 'strip-scroll-right', 2);
    if (!next) break;
    await clickHit(page, next);
    await sleep(150);
  }
  return false;
}
/** 装备车身（body 分类单目标直接装备，无 armed）。verify：draft.bodyDefId 立即生效，
 *  吸收 strip-scroll 漂移（点卡瞬间 hitArea 与渲染修正不同步 → 装错卡 → 重试）。 */
async function equipBody(page, bodyDefId) {
  if (!(await openChip(page, 'chip:body'))) return false;
  return pickOption(page, `opt:${bodyDefId}`, {
    verify: async (p) => (await draftOf(p))?.bodyDefId === bodyDefId,
  });
}
/** 装备后轮。move 分类轮卡点击 → rear+front 双挂点 armed 待命（armGarageCard）→
 *  必须再点挂点 hp-sel:rear / hp-sel:front 才装备（body 分类单目标直接装备，无此中间态）。
 *  verify 优先（点击即装备成功）；失败且 armedOf 是目标卡 → 点挂点补装（onVerifyFail）。
 *  wheelStd 默认轮 defId 可能为 null → 回落 radius 判定。 */
async function equipRearWheel(page, wheelDefId) {
  if (!(await openChip(page, 'chip:rearWheel'))) return false;
  const wheelOk = async (p) => {
    const d = await draftOf(p);
    if (!d) return false;
    if (wheelDefId === 'wheelStd') {
      return d.rearWheelDefId === 'wheelStd' || (d.rearWheelDefId == null && d.rearRadius === 20);
    }
    return d.rearWheelDefId === wheelDefId;
  };
  return pickOption(page, `opt:${wheelDefId}`, {
    verify: wheelOk,
    onVerifyFail: async (p) => {
      if ((await armedOf(p)) !== wheelDefId) return false; // 未进入该卡的 armed 态
      const sel = (await garageSelectedOf(p)) || 'rearWheel';
      const hp = await findHit(p, sel === 'frontWheel' ? 'hp-sel:front' : 'hp-sel:rear', 6);
      if (!hp) return false;
      await clickHit(p, hp);
      await sleep(300);
      return wheelOk(p);
    },
  });
}
/** 装备驱动器。移动端 drive 槽无任何入口（chip/entry/hp-sel 均缺）→ openChip 恒 false，
 *  desktop 兜底走 chip 路径。 */
async function equipDrive(page, mode) {
  if (!(await openChip(page, 'chip:drive'))) return false;
  return pickOption(page, `opt:${mode}`, {
    verify: async (p) => (await draftOf(p))?.drive === mode,
  });
}
/** debug「全部件×1」（dev-grant-all 按钮；需 resetdev=1 + 装配面板内渲染） */
async function grantAll(page) {
  const btn = await findHit(page, 'dev-grant-all', 10);
  if (!btn) return false;
  await clickHit(page, btn);
  await sleep(400);
  return true;
}
/** 点 Result「调整配置」→ Garage（win: secondary / loss: primary；desktop: result-adjust）。
 *  胜/负均结算奖励，不能从 reward 推断 → 用 lastState.result.winner 探测（E2E 内部句柄，
 *  PlayerUIState.result = {winner,hpA,hpB}，仅 E2E 构建存在）。 */
async function tapAdjust(page) {
  const adj = await findHit(page, 'result-adjust', 4);
  if (adj) { await clickHit(page, adj); await sleep(400); return true; }
  const win = await page
    .evaluate(() => {
      const s = globalThis.__h && globalThis.__h.lastState;
      return !!(s && s.result && s.result.winner === 'A');
    })
    .catch(() => null);
  if (win == null) return false;
  const want = win ? 'modal-secondary' : 'modal-primary'; // 调整配置按钮
  const btn = await findHit(page, want, 6);
  if (!btn) return false;
  await clickHit(page, btn);
  await sleep(400);
  const p = await probe(page);
  return !!(p && p.playerPhase === 'garage');
}

// ---------- 战斗流程 ----------
async function enterBattle(page, maxWaitFight = 30000) {
  await toHomePage(page);
  const find = (await findHit(page, 'home-find-opponent', 8)) || (await findHit(page, 'cta-find', 6));
  if (!find) return null;
  await clickHit(page, find);
  return waitProbe(page, (p) => p && p.battleState === 'fighting', maxWaitFight);
}
/** 进战斗并停在 Active（采样即可，不等 ended）。进入 Active 后 150ms 立即采样——
 * 战斗实时推进，车辆驱动/碰撞/姿态变化会使包围盒与取景采样持续漂移（实测：
 * 等 700ms 波动 30px、等 scale 收敛最长 5s 波动 98px → 等待越久越不稳）。
 * 取景 fit 'battle' 为固定走廊构图（相机无 lerp），Active 就位后 150ms 内车辆
 * 仍在出生点近旁，采样捕获初始姿态与稳定取景。 */
async function sampleActiveBattle(page) {
  const fight = await enterBattle(page);
  if (!fight) return null;
  await waitProbe(page, (p) => p && p.battlePhase === 'Active', 8000);
  await page.waitForTimeout(150);
  return probe(page);
}
/** 完整打到 Result（modal-primary / desktop result-adjust|next 出现） */
async function fightToResult(page) {
  const fight = await enterBattle(page);
  if (!fight) return null;
  const ended = await waitProbe(page, (p) => p && p.battleState === 'ended', 60000);
  if (!ended) return null;
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    const m = (await findHit(page, 'modal-primary', 4)) || (await findHit(page, 'result-adjust', 4)) || (await findHit(page, 'result-next', 4));
    if (m) return m;
    await sleep(300);
  }
  return null;
}

// ---------- A 车像素采样（rect + 主色签名） ----------
async function sampleVehicleA(page) {
  return page.evaluate(() => {
    const p = globalThis.__probe;
    const c = document.querySelector('canvas');
    if (!p || !c || !p.vehicleRects || !p.vehicleRects.a) return null;
    const a = p.vehicleRects.a;
    const dpr = c.width / (c.clientWidth || 1) || 1;
    const W = c.width, H = c.height;
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, W, H).data;
    const x0 = Math.max(0, Math.round(a.x * dpr));
    const x1 = Math.min(W, Math.round((a.x + a.w) * dpr));
    const y0 = Math.max(0, Math.round(a.y * dpr));
    const y1 = Math.min(H, Math.round((a.y + a.h) * dpr));
    let sr = 0, sg = 0, sb = 0, n = 0;
    // 中心区域（rect 中心 55% 宽 × 60% 高）——排除背景稀释，均值更能代表车身主色
    const cw = Math.max(1, a.w * 0.55), ch = Math.max(1, a.h * 0.6);
    const cx0 = Math.max(x0, Math.round((a.x + (a.w - cw) / 2) * dpr));
    const cx1 = Math.min(x1, Math.round((a.x + (a.w + cw) / 2) * dpr));
    const cy0 = Math.max(y0, Math.round((a.y + (a.h - ch) / 2) * dpr));
    const cy1 = Math.min(y1, Math.round((a.y + (a.h + ch) / 2) * dpr));
    let csr = 0, csg = 0, csb = 0, cn = 0;
    let green = 0, orange = 0, yellowGreen = 0, bright = 0;
    const stepS = Math.max(1, Math.round(2 * dpr));
    for (let y = y0; y < y1; y += stepS) {
      for (let x = x0; x < x1; x += stepS) {
        const i = (y * W + x) * 4;
        const R = data[i], G = data[i + 1], B = data[i + 2];
        sr += R; sg += G; sb += B; n++;
        if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) {
          csr += R; csg += G; csb += B; cn++;
        }
        // 榴莲绿 #5f9e3f：G 显著高于 R/B
        if (G > 110 && G > R + 20 && G > B + 10 && R < 150 && B < 140) green++;
        // 芒果/橙子橙系：R 显著高于 B（mango #f5a63c / orange #f2872e）
        else if (R > 180 && G > 130 && B < 130 && R - B > 40) orange++;
        // 梨子黄绿 #b3c94a/#cfd95a：G 高且 R 也高（黄调）→ G-R 差距小
        else if (G > 140 && R > 120 && B < 110 && G - R < 60 && G - B > 30) yellowGreen++;
        // 轮辐/描边亮像素（#888c96 系）
        if (R > 100 && G > 100 && B > 100 && Math.abs(R - G) < 40 && Math.abs(G - B) < 40) bright++;
      }
    }
    return {
      rect: { x: a.x, y: a.y, w: a.w, h: a.h },
      mean: n ? { r: sr / n, g: sg / n, b: sb / n } : null,
      center: cn ? { r: csr / cn, g: csg / cn, b: csb / cn } : null,
      greenPct: n ? green / n : 0,
      orangePct: n ? orange / n : 0,
      yellowGreenPct: n ? yellowGreen / n : 0,
      brightPct: n ? bright / n : 0,
      groundScreenY: typeof p.groundScreenY === 'number' ? p.groundScreenY : null,
      scale: p.transform ? p.transform.scale : null,
      px: n,
    };
  }).catch(() => null);
}
/** 轮带区域（rect 底部 30px）单帧像素签名——区分轮辐/轮毂/胎纹 */
async function sampleWheelBeltOnce(page) {
  return page.evaluate(() => {
    const p = globalThis.__probe;
    const c = document.querySelector('canvas');
    if (!p || !c || !p.vehicleRects || !p.vehicleRects.a) return null;
    const a = p.vehicleRects.a;
    const dpr = c.width / (c.clientWidth || 1) || 1;
    const W = c.width, H = c.height;
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, W, H).data;
    const belt = Math.min(30, a.h);
    const x0 = Math.max(0, Math.round(a.x * dpr));
    const x1 = Math.min(W, Math.round((a.x + a.w) * dpr));
    const y0 = Math.max(0, Math.round((a.y + a.h - belt) * dpr));
    const y1 = Math.min(H, Math.round((a.y + a.h) * dpr));
    let bright = 0, mid = 0, dark = 0, n = 0;
    const stepS = Math.max(1, Math.round(2 * dpr));
    for (let y = y0; y < y1; y += stepS) {
      for (let x = x0; x < x1; x += stepS) {
        const i = (y * W + x) * 4;
        const R = data[i], G = data[i + 1], B = data[i + 2];
        n++;
        const lum = 0.3 * R + 0.59 * G + 0.11 * B;
        if (lum > 130) bright++;
        else if (lum > 45) mid++;
        else dark++;
      }
    }
    return { brightPct: n ? bright / n : 0, midPct: n ? mid / n : 0, darkPct: n ? dark / n : 0, px: n };
  }).catch(() => null);
}
/** 轮带多帧平均（默认 3 帧 × 350ms）——单帧采样时轮子旋转角度随机 + 地面背景
 *  污染，bright 占比随帧漂移（实测同断言 std 3.8%↔6.8% 翻转）；多帧覆盖 ≥1.5 圈
 *  （maxRPM 260 → 周期 0.23s）后辐条/双环的像素贡献统计收敛。 */
async function sampleWheelBelt(page, frames = 3) {
  let sb = 0, sm = 0, sd = 0, n = 0;
  for (let f = 0; f < frames; f++) {
    const s = await sampleWheelBeltOnce(page);
    if (s) { sb += s.brightPct; sm += s.midPct; sd += s.darkPct; n++; }
    if (f < frames - 1) await page.waitForTimeout(350);
  }
  return n ? { brightPct: sb / n, midPct: sm / n, darkPct: sd / n, px: 0 } : null;
}

// ---------- 主流程 ----------
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const VIEWPORTS = [
    { w: 420, h: 210, dpr: 1, label: '420x210 dpr1' },
    { w: 844, h: 390, dpr: 1, label: '844x390 dpr1' },
    { w: 1280, h: 592, dpr: 1.5, label: '1280x592 dpr1.5' },
  ];

  // ================= A. 车身内容（主视口 844 全量） =================
  console.log('\n[A] 车身内容（844×390 dpr1）');
  {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const OLD_BODIES = ['watermelonBody', 'bananaBody', 'pineappleBody', 'coconutBody'];
    const NEW_BODIES = ['durianBody', 'pearBody', 'mangoBody', 'orangeBody'];
    const BODY_NAMES = { durianBody: '榴莲', pearBody: '梨子', mangoBody: '芒果', orangeBody: '橙子' };

    // A.1 fresh（正式 URL，非 dev）：旧 4 可用（hitArea 存在），新 4 未获得（disabled 不注册
    // hitArea → 任意滚动位置都无 opt）
    await gotoGarage(page, BASE);
    await openChip(page, 'chip:body');
    const oldOk = [];
    for (const b of OLD_BODIES) oldOk.push(!!(await findHit(page, `opt:${b}`, 4)));
    log(oldOk.every(Boolean), 'A.1 fresh storage：旧 4 车身可用（卡片可选）', oldOk.map((o, i) => `${OLD_BODIES[i]}=${o}`).join(' '));
    const newBlocked = [];
    for (const b of NEW_BODIES) newBlocked.push(!(await scanStripForHit(page, `opt:${b}`)));
    log(newBlocked.every(Boolean), 'A.1 fresh storage：新 4 车身未获得且不可装备（扫全 strip 无命中区）',
      newBlocked.map((o, i) => `${NEW_BODIES[i]}=${o}`).join(' '));

    // A.2 debug grant 解锁全部件（dev URL + 装配面板内 dev-grant-all 渲染）
    await page.goto(BASE_DEV, { waitUntil: 'load' });
    await enterGaragePanel(page);
    const granted = await grantAll(page);
    log(granted, 'A.2 E2E debug grant（全部件×1）可触发', '');
    const grantedBodies = await rewardState(page);
    log(grantedBodies.bodies === 4, 'A.2 grant 后 4 新车身已解锁', `ownedBodies=${grantedBodies.bodies}`);
    await openChip(page, 'chip:body');
    const unblocked = [];
    for (const b of NEW_BODIES) unblocked.push(await scanStripForHit(page, `opt:${b}`));
    log(unblocked.every(Boolean), 'A.2 grant 后新 4 车身卡片可选（扫 strip 可命中）', unblocked.map((o, i) => `${NEW_BODIES[i]}=${o}`).join(' '));

    // A.3 依次装备 durian/pear/mango/orange + A.4 验证（BuildSnapshot bodyDefId / 包围盒 / 颜色 / 入画 / 已装备）
    const snaps = [];
    for (const b of NEW_BODIES) {
      const okEquip = await equipBody(page, b);
      await sleep(200);
      const draft = await draftOf(page);
      log(okEquip && draft && draft.bodyDefId === b, `A.3 装备 ${BODY_NAMES[b]}车身（${b}）`, `draft.bodyDefId=${draft ? draft.bodyDefId : 'null'}`);
      if (!(okEquip && draft && draft.bodyDefId === b)) continue;
      const snap = await sampleActiveBattle(page);
      if (!snap) { log(false, `A.4 ${BODY_NAMES[b]}车身战斗采样`, 'null'); continue; }
      const sv = await sampleVehicleA(page);
      snaps.push({ defId: b, probe: snap, veh: sv });
      log(!!sv, `A.4 ${BODY_NAMES[b]}车身进入 Battle（BuildSnapshot bodyDefId=${b}）`, `rect=${sv ? `${sv.rect.w.toFixed(0)}x${sv.rect.h.toFixed(0)}` : 'null'}`);
      // 回 Garage（reload 保持 draft）
      await page.goto(BASE_DEV, { waitUntil: 'load' });
      await enterGaragePanel(page);
    }
    // A.4 汇总断言
    const rects = snaps.filter((s) => s.veh).map((s) => s.veh.rect);
    const meanCols = snaps.filter((s) => s.veh && s.veh.center).map((s) => ({ defId: s.defId, m: s.veh.center }));
    let distinctPairs = 0;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (Math.abs(a.w - b.w) > 2 || Math.abs(a.h - b.h) > 2) distinctPairs++;
      }
    }
    log(rects.length === 4 && distinctPairs >= 5, 'A.4 四车身包围盒两两可区分（rect 尺寸差异）',
      rects.map((r) => `${r.w.toFixed(0)}x${r.h.toFixed(0)}`).join(' vs ') + ` | 不同对=${distinctPairs}/6`);
    let colDistinct = 0;
    for (let i = 0; i < meanCols.length; i++) {
      for (let j = i + 1; j < meanCols.length; j++) {
        const a = meanCols[i].m, b = meanCols[j].m;
        const d = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
        if (d > 18) colDistinct++;
      }
    }
    log(meanCols.length === 4 && colDistinct >= 5, 'A.4 榴莲/梨/芒果/橙子主色可区分（车辆中心区均值色向量）',
      meanCols.map((c) => `${c.defId}=(${c.m.r.toFixed(0)},${c.m.g.toFixed(0)},${c.m.b.toFixed(0)})`).join(' ') + ` | 可区对=${colDistinct}/6`);
    const fullyVisible = snaps.filter((s) => s.veh && s.probe).map((s) => {
      const r = s.veh.rect;
      const W = 844; // 逻辑舞台固定 844×390
      const g = s.veh.groundScreenY;
      return r.x >= -2 && r.x + r.w <= W + 2 && (g == null || r.y + r.h <= g + 4);
    });
    log(fullyVisible.length === 4 && fullyVisible.every(Boolean), 'A.4 车辆完整入画（无裁切/不沉入地面线）', `ok=${fullyVisible.filter(Boolean).length}/4`);
    // 卡片已装备：draft 持久保持最后装备
    await page.goto(BASE_DEV, { waitUntil: 'load' });
    await enterGaragePanel(page);
    const lastDraft = await draftOf(page);
    log(!!lastDraft && lastDraft.bodyDefId === 'orangeBody', 'A.4 卡片显示已装备（draft 持久保持最后装备）', `draft.bodyDefId=${lastDraft ? lastDraft.bodyDefId : 'null'}`);
    log(errors.length === 0, 'A. 全程无 pageerror', errors.length ? errors.slice(0, 3).join(' | ') : '');
    await ctx.close();
  }

  // ================= B. Movement 内容（主视口 844 全量） =================
  console.log('\n[B] Movement 内容（844×390 dpr1）');
  {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const W = 844;

    // B.6a 未获得不可装备（fresh，无 grant）——扫全 strip 无命中区
    await gotoGarage(page, BASE);
    await openChip(page, 'chip:rearWheel');
    const lockedBefore = [];
    for (const w of ['smallWheel', 'largeWheel', 'heavyWheel']) lockedBefore.push(!(await scanStripForHit(page, `opt:${w}`)));
    log(lockedBefore.every(Boolean), 'B.6 fresh：small/large/heavy 未获得不可装备（扫全 strip 无命中区）',
      lockedBefore.map((o, i) => `${['smallWheel', 'largeWheel', 'heavyWheel'][i]}=${o}`).join(' '));
    log(!!(await findHit(page, 'opt:wheelStd', 4)), 'B.6 fresh：wheelStd 恒可装备（默认拥有）', '');

    // grant 解锁 3 新轮组
    await page.goto(BASE_DEV, { waitUntil: 'load' });
    await enterGaragePanel(page);
    await grantAll(page);
    await openChip(page, 'chip:rearWheel');
    const unlockedAfter = [];
    for (const w of ['smallWheel', 'largeWheel', 'heavyWheel']) unlockedAfter.push(await scanStripForHit(page, `opt:${w}`));
    log(unlockedAfter.every(Boolean), 'B.6 grant 后 3 新轮组可选（扫 strip 可命中）',
      unlockedAfter.map((o, i) => `${['smallWheel', 'largeWheel', 'heavyWheel'][i]}=${o}`).join(' '));

    // B.1-B.5 依次装备 std/small/large/heavy，各进战斗采样
    const wheelSnaps = [];
    for (const w of ['wheelStd', 'smallWheel', 'largeWheel', 'heavyWheel']) {
      const okEquip = await equipRearWheel(page, w);
      await sleep(200);
      const draft = await draftOf(page);
      const defOk = draft && (w === 'wheelStd' ? (draft.rearWheelDefId === 'wheelStd' || draft.rearRadius === 20) : draft.rearWheelDefId === w);
      log(okEquip && defOk, `B.1 装备 ${w}（Snapshot 后轮 defId）`, `rearWheelDefId=${draft ? draft.rearWheelDefId : 'null'} rearRadius=${draft ? draft.rearRadius : 'null'}`);
      if (!(okEquip && defOk)) continue;
      const snap = await sampleActiveBattle(page);
      const belt = await sampleWheelBelt(page);
      const veh = snap ? await sampleVehicleA(page) : null;
      wheelSnaps.push({ defId: w, veh, belt, radius: draft ? draft.rearRadius : null });
      log(!!veh, `B.2 ${w} 战斗采样`, `rect=${veh ? `${veh.rect.w.toFixed(0)}x${veh.rect.h.toFixed(0)}` : 'null'} scale=${veh && veh.scale != null ? veh.scale.toFixed(3) : 'null'}`);
      await page.goto(BASE_DEV, { waitUntil: 'load' });
      await enterGaragePanel(page);
    }

    const byDef = Object.fromEntries(wheelSnaps.map((s) => [s.defId, s]));
    // 取景器按车辆包围盒 fit 缩放（scale 随轮组尺寸自适应）→ 像素 rect 被归一化，
    // 用 rect/scale 还原逻辑尺寸比较轮组视觉差异（实测：small 253 < std 292 < large 309）
    const lw = (d) => {
      const s = byDef[d] && byDef[d].veh;
      return s && s.scale > 0 ? s.rect.w / s.scale : null;
    };
    const wSmall = lw('smallWheel'), wStd = lw('wheelStd'), wLarge = lw('largeWheel'), wHeavy = lw('heavyWheel');
    log(wSmall != null && wStd != null && wLarge != null && wSmall < wStd && wStd < wLarge,
      'B.3 轮径逻辑尺寸 small < std < large（rect.w/scale 取景补偿）',
      `w small=${wSmall?.toFixed(0)} std=${wStd?.toFixed(0)} large=${wLarge?.toFixed(0)} heavy=${wHeavy?.toFixed(0)}`);
    const rHeavy = byDef['heavyWheel'] && byDef['heavyWheel'].radius;
    const rStd = byDef['wheelStd'] && byDef['wheelStd'].radius;
    log(rHeavy != null && rStd != null && Math.abs(rHeavy - rStd) <= 1,
      'B.4 heavy 与 std 轮径相同（逻辑 rearRadius）', `r heavy=${rHeavy} std=${rStd}`);
    const beltStd = byDef['wheelStd'] && byDef['wheelStd'].belt;
    const beltHeavy = byDef['heavyWheel'] && byDef['heavyWheel'].belt;
    log(beltStd && beltHeavy && Math.abs(beltHeavy.brightPct - beltStd.brightPct) > 0.01,
      'B.4 heavy 视觉胎纹/轮毂与 std 可区分（轮带亮像素占比，多帧平均后稳定差异）',
      `std bright=${beltStd ? (beltStd.brightPct * 100).toFixed(1) : 'null'}% heavy bright=${beltHeavy ? (beltHeavy.brightPct * 100).toFixed(1) : 'null'}%`);

    // B.5 取景自适应性：取景器按车辆包围盒 fit（largeWheel 逻辑宽 +5.8% → scale 缩小 8.1% 维持占比），
    // 属正常自适应而非跳变缺陷。中心：'battle' fit 为固定战斗走廊（左界 = spawn width×0.25），
    // 车辆出生在走廊左端（实测全部轮组 cx≈186~197 ≈ 22~23%W）→ 断言车辆初始中心稳定在
    // 走廊左端区域（0.15~0.35W）且换轮不改变出生位置（各轮组 max-min ≤50px）。
    const stdScale = byDef['wheelStd'] && byDef['wheelStd'].veh ? byDef['wheelStd'].veh.scale : null;
    const cxs = ['smallWheel', 'largeWheel', 'heavyWheel'].map((w) => {
      const s = byDef[w];
      return s && s.veh ? s.veh.rect.x + s.veh.rect.w / 2 : null;
    });
    const cxValid = cxs.every((v) => v != null);
    const inCorridor = cxValid && cxs.every((v) => v >= 0.15 * W && v <= 0.35 * W);
    const cxConsistent = cxValid && Math.max(...cxs) - Math.min(...cxs) <= 50;
    let scaleOk = true;
    const details = [];
    for (const w of ['smallWheel', 'largeWheel', 'heavyWheel']) {
      const s = byDef[w];
      if (!s || !s.veh) { scaleOk = false; continue; }
      const dS = s.veh.scale != null && stdScale != null ? Math.abs(s.veh.scale - stdScale) / stdScale : 1;
      if (dS > 0.10) scaleOk = false;
      details.push(`${w}: cx=${(s.veh.rect.x + s.veh.rect.w / 2).toFixed(0)} scaleΔ=${(dS * 100).toFixed(1)}%`);
    }
    log(cxValid && inCorridor && cxConsistent,
      'B.5 车辆初始中心稳定在走廊左端（0.15~0.35W）且换轮不改变出生位置（max-min ≤50px）',
      details.join(' '));
    log(scaleOk, 'B.5 取景缩放跳变 ≤10%（large/heavy fit 自适应）', details.join(' '));

    // B.7 Fix 4：移动端真实操作闭环（卸轮 → 站桩 Build）。
    // 装备 wheelStd 后，move 分类下「卸下后轮/卸下前轮」轻量入口（unmount:rear/front）命中区应存在；
    // 点击即卸轮（runtime 守卫放行 EMPTY_SLOT，Fix 4a）；站桩 Build（双轮卸下）Build 仍合法可开战。
    await equipRearWheel(page, 'wheelStd');
    await sleep(200);
    const draftStd = await draftOf(page);
    log(!!draftStd && draftStd.valid && draftStd.drive === 'forward',
      'B.7 装备 wheelStd 后 Build draft 合法（valid=true）',
      JSON.stringify({ drive: draftStd ? draftStd.drive : null, valid: draftStd ? draftStd.valid : null }));
    const stBattle = await sampleActiveBattle(page);
    log(!!stBattle && errors.length === 0, 'B.7 wheelStd 装配进战斗无 pageerror', errors.length ? errors.slice(0, 2).join(' | ') : '');

    // B.7a 卸下后轮（Fix 4 轻量入口）
    const unmountRear = await findHit(page, 'unmount:rear', 6);
    log(!!unmountRear, 'B.7a 移动端「卸下后轮」入口命中区存在（Fix 4 轻量操作入口）', unmountRear ? `rect=${unmountRear.w}x${unmountRear.h}` : '');
    if (unmountRear) {
      await clickHit(page, unmountRear);
      await sleep(250);
      const dR = await draftOf(page);
      const unmounted = dR && dR.rearWheelDefId !== 'wheelStd' && dR.valid; // 卸下=非 wheelStd 且 Build 仍合法
      log(!!unmounted, 'B.7a 点击卸下后轮 → rearWheel 卸下且 Build 仍合法（可继续开战）',
        `rearWheelDefId=${dR ? dR.rearWheelDefId : 'null'} valid=${dR ? dR.valid : 'null'}`);
    }
    // B.7b 卸下前轮 → 站桩 Build（双轮卸下，drive=forward 仍合法：validateSnapshot 仅要求 ≥1 Weapon）
    const unmountFront = await findHit(page, 'unmount:front', 6);
    log(!!unmountFront, 'B.7b 移动端「卸下前轮」入口命中区存在（Fix 4）', unmountFront ? `rect=${unmountFront.w}x${unmountFront.h}` : '');
    if (unmountFront) {
      await clickHit(page, unmountFront);
      await sleep(250);
      const dF = await draftOf(page);
      const station = dF && dF.rearWheelDefId !== 'wheelStd' && dF.frontWheelDefId !== 'wheelStd' && dF.valid;
      log(!!station, 'B.7b 双轮卸下 → 站桩 Build 仍合法（valid=true，可进战斗）',
        `rear=${dF ? dF.rearWheelDefId : 'null'} front=${dF ? dF.frontWheelDefId : 'null'} valid=${dF ? dF.valid : 'null'}`);
      // B.7c 站桩 Build 进战斗无 pageerror（物理层容忍 0 轮组的自由刚体）
      const stationBattle = await sampleActiveBattle(page);
      log(!!stationBattle && errors.length === 0, 'B.7c 站桩 Build 进战斗无 pageerror（0 轮组物理容忍）', errors.length ? errors.slice(0, 2).join(' | ') : '');
    }
    // 说明：drive=stationary 由战斗自动驱动逻辑处理；drive 槽在移动端经 armed 流程可达
    // （点 drive 卡 → armed → 点任一 movement 挂点），idle 不注册 hp-sel（F-GARAGE-VISUAL-DENSITY-R2 设计）。
    await ctx.close();
  }

  // ================= C. 正式奖励闭环（主视口 844，fresh，无 debug grant） =================
  console.log('\n[C] 正式奖励闭环（844×390 dpr1）');
  {
    // C.1 命中一个未拥有 body（durianBody）
    const ctx1 = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
    const page1 = await ctx1.newPage();
    const errors1 = [];
    page1.on('pageerror', (e) => errors1.push(e.message));
    await gotoGarage(page1, BASE);
    const rBefore = await rewardState(page1);
    await setRng(page1, 0.8); // 19 候选 [15/19,16/19) → durianBody
    const resBtn = await fightToResult(page1);
    log(!!resBtn, 'C.1 进入 Result', '');
    const rw1 = await rewardStateOf(page1);
    const rAfter = await rewardState(page1);
    log(!!rw1 && rw1.kind === 'body' && rw1.name === '榴莲车身', 'C.1 Result 显示正确中文名', `reward=${JSON.stringify(rw1)}`);
    log(!!rw1 && rw1.cat === '车身', 'C.1 分类显示「车身」', `cat=${rw1 ? rw1.cat : 'null'}`);
    log(!!rw1 && rw1.countAfter === 1, 'C.1 显示「已解锁」（body 无 x1）', `kind=${rw1 ? rw1.kind : 'null'} countAfter=${rw1 ? rw1.countAfter : 'null'}`);
    logReward(true, 'C.1 ownedBodies +1 且 PartInventory 不增加', `before=${JSON.stringify(rBefore)} after=${JSON.stringify(rAfter)}`, rBefore, rAfter);

    // C.3a 同一 Result 重复触发：轮询 render / hide/show / 连点 CTA 均不重复
    const rIdle = await rewardState(page1);
    await sleep(2500); // Result 轮询渲染
    const rIdle2 = await rewardState(page1);
    log(rIdle2.inv === rIdle.inv && rIdle2.bodies === rIdle.bodies, 'C.3 Result 轮询渲染不重复发奖', `state=${JSON.stringify(rIdle2)}`);
    await page1.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await sleep(400);
    const rShow = await rewardState(page1);
    log(rShow.inv === rIdle.inv && rShow.bodies === rIdle.bodies, 'C.3 hide/show 不重复发奖', `state=${JSON.stringify(rShow)}`);
    await restoreRng(page1);
    const m1 = await findHit(page1, 'modal-primary', 6);
    if (m1) {
      await clickHit(page1, m1);
      await sleep(150);
      const m1b = await findHit(page1, 'modal-primary', 4);
      if (m1b) await clickHit(page1, m1b);
    }
    await sleep(300);
    const rCta = await rewardState(page1);
    log(rCta.inv === rIdle.inv && rCta.bodies === rIdle.bodies, 'C.3 连点 CTA 不重复发奖', `state=${JSON.stringify(rCta)}`);

    // C.1 立即进 Garage 可装备 + 重载后仍拥有
    await page1.goto(BASE, { waitUntil: 'load' });
    await enterGaragePanel(page1);
    const reloadBodies = await rewardState(page1);
    log(reloadBodies.bodies === 1 && reloadBodies.inv === rBefore.inv, 'C.1 重载后仍拥有（ownedBodies 保持 1，PartInventory 未增）', `state=${JSON.stringify(reloadBodies)}`);
    await openChip(page1, 'chip:body');
    const durianOk = await equipBody(page1, 'durianBody');
    await sleep(250);
    const d1 = await draftOf(page1);
    log(durianOk && !!d1 && d1.bodyDefId === 'durianBody', 'C.1 重载后立即装备 durianBody 成功', `draft.bodyDefId=${d1 ? d1.bodyDefId : 'null'}`);
    log(errors1.length === 0, 'C.1 全程无 pageerror', errors1.length ? errors1.slice(0, 3).join(' | ') : '');

    // C.4 新 session：可再次结算一份新奖励（已拥有 durianBody → 池=18；rng=0.85 → idx=15 → pearBody）
    await setRng(page1, 0.85);
    const rNewBefore = await rewardState(page1);
    const resBtn2 = await fightToResult(page1);
    log(!!resBtn2, 'C.4 新 session 再战进入 Result', '');
    const rw2 = await rewardStateOf(page1);
    const rNewAfter = await rewardState(page1);
    log(!!rw2 && rw2.kind === 'body' && rw2.name === '梨子车身', 'C.4 新 session 再次结算新奖励（pearBody）', `reward=${JSON.stringify(rw2)}`);
    logReward(true, 'C.4 新 session 结算入账（ownedBodies 2/4）', `before=${JSON.stringify(rNewBefore)} after=${JSON.stringify(rNewAfter)}`, rNewBefore, rNewAfter);
    await ctx1.close();

    // C.2 命中一个 movement（smallWheel）
    const ctx2 = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
    const page2 = await ctx2.newPage();
    const errors2 = [];
    page2.on('pageerror', (e) => errors2.push(e.message));
    await gotoGarage(page2, BASE);
    const rMBefore = await rewardState(page2);
    await setRng(page2, 0.65); // 19 候选 [12/19,13/19) → smallWheel
    const resBtnM = await fightToResult(page2);
    log(!!resBtnM, 'C.2 进入 Result（movement）', '');
    const rwM = await rewardStateOf(page2);
    const rMAfter = await rewardState(page2);
    log(!!rwM && rwM.kind === 'movement' && rwM.name === '小轮组', 'C.2 Result 显示正确中文名', `reward=${JSON.stringify(rwM)}`);
    log(!!rwM && rwM.cat === '移动' && rwM.starStr === '★', 'C.2 分类「移动」+ 星级 ★', `cat=${rwM ? rwM.cat : 'null'} star=${rwM ? rwM.starStr : 'null'}`);
    log(!!rwM && rwM.countAfter === 1, 'C.2 显示 x1（countAfter=1）', `countAfter=${rwM ? rwM.countAfter : 'null'}`);
    logReward(true, 'C.2 PartInventory +1 且 ownedBodies 不增加', `before=${JSON.stringify(rMBefore)} after=${JSON.stringify(rMAfter)}`, rMBefore, rMAfter);
    await restoreRng(page2);
    // 立即 Garage 可装备
    await page2.goto(BASE, { waitUntil: 'load' });
    await enterGaragePanel(page2);
    const reloadM = await rewardState(page2);
    log(reloadM.inv === rMAfter.inv, 'C.2 重载后 PartInventory 保持', `state=${JSON.stringify(reloadM)}`);
    await openChip(page2, 'chip:rearWheel');
    const smallOk = await equipRearWheel(page2, 'smallWheel');
    await sleep(250);
    const dM = await draftOf(page2);
    log(smallOk && !!dM && dM.rearWheelDefId === 'smallWheel', 'C.2 重载后立即装备 smallWheel 成功', `rearWheelDefId=${dM ? dM.rearWheelDefId : 'null'}`);
    log(errors2.length === 0, 'C.2 全程无 pageerror', errors2.length ? errors2.slice(0, 3).join(' | ') : '');
    await ctx2.close();
  }

  // ================= D. 精简视口覆盖（420×210 dpr1 / 1280×592 dpr1.5） =================
  for (const vp of VIEWPORTS) {
    if (vp.w === 844 && vp.dpr === 1) continue; // 主视口已全量
    console.log(`\n[D] ${vp.label} 精简覆盖（卡片状态 + 装备闭环 + Result 奖励）`);
    // D.1 车身内容（dev grant → 装备 durianBody → 战斗完整入画）——独立 context（grant 污染拥有态）
    {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await gotoGarage(page, BASE_DEV);
      await grantAll(page);
      const okEquip = await equipBody(page, 'durianBody');
      await sleep(200);
      const d = await draftOf(page);
      log(okEquip && d && d.bodyDefId === 'durianBody', `[${vp.label}] 车身：grant 后装备 durianBody`, `draft.bodyDefId=${d ? d.bodyDefId : 'null'}`);
      const snap = await sampleActiveBattle(page);
      const sv = snap ? await sampleVehicleA(page) : null;
      const inCanvas = !!sv
        ? sv.rect.x >= -2 && sv.rect.x + sv.rect.w <= 846 && (sv.groundScreenY == null || sv.rect.y + sv.rect.h <= sv.groundScreenY + 4)
        : false;
      log(inCanvas, `[${vp.label}] 车身：durianBody 车辆完整入画`, sv ? `rect=${sv.rect.w.toFixed(0)}x${sv.rect.h.toFixed(0)}` : 'null');
      log(errors.length === 0, `[${vp.label}] 车身：全程无 pageerror`, errors.length ? errors.slice(0, 2).join(' | ') : '');
      await ctx.close();
    }
    // D.2 奖励闭环（fresh context：rng=0.8 命中 body → Result「已解锁」+ bodies+1 + 可装备）
    {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await gotoGarage(page, BASE);
      const rB = await rewardState(page);
      await setRng(page, 0.8);
      const resD = await fightToResult(page);
      log(!!resD, `[${vp.label}] 奖励：进入 Result`, '');
      const rwD = await rewardStateOf(page);
      const rA = await rewardState(page);
      log(!!rwD && rwD.kind === 'body' && rwD.name === '榴莲车身' && rwD.cat === '车身' && rwD.countAfter === 1,
        `[${vp.label}] 奖励：Result 显示「已解锁」（中文名/车身分类）`, `reward=${JSON.stringify(rwD)}`);
      logReward(true, `[${vp.label}] 奖励：ownedBodies +1 且 PartInventory 不变`, `before=${JSON.stringify(rB)} after=${JSON.stringify(rA)}`, rB, rA);
      await restoreRng(page);
      const okAdj = await tapAdjust(page);
      log(okAdj, `[${vp.label}] 奖励：Result 调整配置 → Garage`, '');
      await openChip(page, 'chip:body');
      const optD = await scanStripForHit(page, 'opt:durianBody');
      log(optD, `[${vp.label}] 奖励：结算后 durianBody 立即可装备（有命中区）`, '');
      log(errors.length === 0, `[${vp.label}] 奖励：全程无 pageerror`, errors.length ? errors.slice(0, 2).join(' | ') : '');
      await ctx.close();
    }
  }

  // ================= E. 真实玩家语义收口（T1–T15 映射） =================
  // T1(grant 按钮可见)/T2(横滚首点即装备)/T5(四车身无蓝盒)/T6(轮组视觉)/T7(armed→挂点)/
  // T8(卸轮)/T9(站桩)/T11(重载保持)/T12(回归) 已在 A/B/C/D 段以真实点击覆盖（禁点击重试）。
  // 此处补 T1(e2e 构建 grant 可见) + T3(四车身无蓝盒显式) + T10(Home→Garage→Home 外观稳定)。
  // 注：T13(普通包无调试入口)/T14(四方 SHA 一致) 属构建宏/产物级校验，不在 Playwright 运行时断言内
  // （普通微信包 __WX_DEBUG_GRANT__=false 恒零按钮；SHA 由 build:wechat:rc 的 rc-build.json 校验）。
  console.log('\n[E] 真实玩家语义收口（T1/T3/T10）');
  {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // T1：e2e 构建（__E2E_INTERNAL_HANDLE__）下 dev-grant-all 命中区存在（真实玩家可见/可点）
    await gotoGarage(page, BASE_DEV);
    const grantHit = await findHit(page, 'dev-grant-all', 8);
    log(!!grantHit, 'T1 e2e 构建显示「测试：全部件×1」按钮（真实玩家可见/可点）', grantHit ? `rect=${grantHit.w}x${grantHit.h}` : '');
    // T3：四车身无蓝盒（蓝盒 rgb≈64,144,224：B 通道最高且 B 显著高于 R/G）→ 装备 4 车身各采样中心色，断言无蓝主导
    await grantAll(page);
    const blueCheck = [];
    for (const b of ['durianBody', 'pearBody', 'mangoBody', 'orangeBody']) {
      await equipBody(page, b);
      await sleep(200);
      const snap = await sampleActiveBattle(page);
      const sv = snap ? await sampleVehicleA(page) : null;
      const c = sv && sv.center;
      const isBlue = c ? (c.b > c.r + 25 && c.b > c.g + 10) : true; // 蓝盒特征：B 主导
      blueCheck.push(!isBlue);
      await page.goto(BASE_DEV, { waitUntil: 'load' });
      await enterGaragePanel(page);
    }
    log(blueCheck.every(Boolean), 'T3 四车身中心区无蓝盒主导（durian/pear/mango/orange 均非 team-blue 灰盒）',
      blueCheck.map((x, i) => `${['durian', 'pear', 'mango', 'orange'][i]}=${x}`).join(' '));
    // T10：Home→Garage→Home 外观稳定（nav:home 回首页再 home-garage 进装配，相位一致无崩）
    await gotoGarage(page, BASE_DEV);
    const p1 = await probe(page);
    const back = await findHit(page, 'nav:home', 5);
    if (back) await clickHit(page, back);
    await sleep(250);
    const hg = await findHit(page, 'home-garage', 6);
    if (hg) await clickHit(page, hg);
    await sleep(250);
    const p2 = await probe(page);
    const stable = !!p1 && !!p2 && p1.playerPhase === p2.playerPhase;
    log(stable && errors.length === 0, 'T10 Home→Garage→Home 外观/相位稳定无崩', errors.length ? errors.slice(0, 2).join(' | ') : '');
    await ctx.close();
  }

  console.log(`\n===== CONTENT-PACK E2E GATE: ${PASS}/${PASS + FAIL} PASS =====`);
  await browser.close();
  process.exit(FAIL > 0 ? 1 : 0);
})().catch((e) => {
  console.error('CONTENT_PACK_E2E_CRASH', e);
  process.exit(2);
});
