/**
 * F-GARAGE-INVENTORY-FUSION-R1｜背包信息层级 + **真实 5 合 1 玩家操作闭环** 浏览器门禁
 *
 * 与 P0 版的本质区别：P0 只验证「背包页可达 / 卡片渲染 / 门控不出现假可合 / 返回车库」，
 * 本版真正跑完玩家闭环——种子库存 → 真实可见像素点击 → 面板读数（可用/消耗/产出）→ 点击「合成」
 * → 校验 localStorage 1★-5 / 2★+1 → 连点不重复 → 返回车库 Build 不变 → reload 后 2★ 仍在。
 *
 * 关键手段（两者都不污染任何产物 bundle）：
 *  1) 种子库存：window.__inv.seedInventory（宿主内 __E2E_INTERNAL_HANDLE__ 守卫；
 *     build:e2e 才为 true，普通/RC/微信构建 esbuild 折叠移除 → bundle-clean 通过）。
 *     **不复用、不修改** RC「全部件×1」幂等授予路径。
 *  2) 面板文案读数：page.addInitScript 在浏览器层劫持 CanvasRenderingContext2D.prototype.fillText
 *     记录真实绘制文本 —— 纯测试侧 instrumentation，app 源码零改动、零新增诊断接口。
 *
 * 视口：420×210 / 844×390 / 1280×592 × DPR1 / DPR3（共 6 组）。
 *  - 844×390 DPR1 与 DPR3：跑**完整 5 合 1 闭环**（含装备保护、连点、Build 不变、reload 保持）；
 *  - 其余 4 组：验证背包页可达 / 三分类 / 战斗 11 项分页全可达 / 卡片点击几何正确 / 返回车库。
 *
 * 用法（需先起服务，且环境装有 Microsoft Edge / Chromium —— channel: 'msedge'）：
 *   node scripts/... （构建 dist-e2e）→ E2E_DIR=e2e node tests/_serve_pages.cjs &
 *   node tests/_e2e_backpack_fusion.cjs
 *
 * 诚实披露：本脚本在「无 chromium/msedge 的沙箱」中无法执行（ms-playwright 仅含 ffmpeg/winldd）；
 * 沙箱内以 chromium 可执行体存在时会自动回退（见 launch）。浏览器通过 ≠ iOS 真机真人体验通过。
 */
const { chromium } = require('playwright-core');
const BASE = 'http://127.0.0.1:8138/';
const FULL_LOOP_VP = '844x390';
/** 战斗分类正式部件总数（OFFICIAL_PARTS，§二.5） */
const COMBAT_TOTAL = 11;
const MOVEMENT_TOTAL = 3;
const BODY_TOTAL = 8;
const INV_KEY = 'strongfruit.ownedParts.v2';
const BUILD_KEY = 'strongfruit.playerBuild.v1';

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}

async function areas(page) {
  return page.evaluate(() => window.__h.getHitAreasForTest().map((a) => ({ id: a.id, x: a.x, y: a.y, w: a.w, h: a.h })));
}
function find(a, id) {
  return a.find((x) => x.id === id) || null;
}
function prefixed(a, p) {
  return a.filter((x) => x.id.startsWith(p));
}

/** 真实可见像素坐标（host 变换 + getBoundingClientRect 抗 CSS scale；与 _e2e_garage.cjs 同源）。 */
async function pixelOf(page, id) {
  return page.evaluate((i) => {
    const h = window.__h;
    const a = h.getHitAreasForTest().find((z) => z.id === i);
    if (!a) return null;
    const t = h.getTransformInfo();
    const c = document.querySelectorAll('canvas')[1] || document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    const drawnX = t.ox + t.scale * (a.x + a.w / 2);
    const drawnY = t.oy + t.scale * (a.y + a.h / 2);
    const sx = r.width / c.clientWidth;
    const sy = r.height / c.clientHeight;
    return { px: r.left + drawnX * sx, py: r.top + drawnY * sy, inRect: drawnX >= 0 && drawnY >= 0 };
  }, id);
}

/** 真实可见像素点击 */
async function tapVisibleById(page, id) {
  const info = await pixelOf(page, id);
  if (!info) return null;
  await page.mouse.click(info.px, info.py);
  await page.waitForTimeout(220);
  return info;
}

/** 连点（同一坐标背靠背两次点击，中间不等待）——验证不重复消耗 */
async function tapTwiceFast(page, id) {
  const info = await pixelOf(page, id);
  if (!info) return null;
  await page.mouse.click(info.px, info.py);
  await page.mouse.click(info.px, info.py);
  await page.waitForTimeout(300);
  return info;
}

// ---------- 浏览器层文本录制（不改 app 源码） ----------
const INIT_SCRIPT = `(() => {
  window.__txt = [];
  const P = CanvasRenderingContext2D.prototype;
  const orig = P.fillText;
  P.fillText = function (s, x, y) {
    try { if (window.__txt.length < 8000) window.__txt.push(String(s)); } catch (e) { void e; }
    return orig.apply(this, arguments);
  };
})();`;

async function clearTexts(page) {
  await page.evaluate(() => { window.__txt.length = 0; });
}
async function readTexts(page) {
  return page.evaluate(() => window.__txt.slice());
}

// ---------- 库存 / Build 读数（直接读 localStorage，只读） ----------
async function readInv(page, defId) {
  return page.evaluate(
    ([k, d]) => {
      try {
        const raw = JSON.parse(localStorage.getItem(k) || '{}');
        const e = raw && raw[d] ? raw[d] : {};
        return { one: Number(e.one || 0), two: Number(e.two || 0) };
      } catch (err) {
        void err;
        return { one: -1, two: -1 };
      }
    },
    [INV_KEY, defId],
  );
}
async function readBuild(page) {
  return page.evaluate((k) => localStorage.getItem(k) || '', BUILD_KEY);
}
/** 通过 e2e 专用句柄种子库存（不经 RC 授予路径） */
async function seedInv(page, defId, one, two) {
  const ok = await page.evaluate(
    ([d, o, t]) => {
      if (!window.__inv || typeof window.__inv.seedInventory !== 'function') return false;
      const seed = {};
      seed[d] = { one: o, two: t };
      window.__inv.seedInventory(seed);
      return true;
    },
    [defId, one, two],
  );
  await page.waitForTimeout(180);
  return ok;
}

/** 从录制文本解析合成面板读数 */
function parsePanel(texts) {
  const out = { owned: null, one: null, two: null, equipped: null, available: null, consume: false, produce: false, btn: null };
  for (const t of texts) {
    let m = /^拥有 (\d+)（1★ (\d+) · 2★ (\d+)）$/.exec(t);
    if (m) {
      out.owned = +m[1];
      out.one = +m[2];
      out.two = +m[3];
      continue;
    }
    m = /^已装备 (\d+) · 可用 (\d+) \/ 需要 5$/.exec(t);
    if (m) {
      out.equipped = +m[1];
      out.available = +m[2];
      continue;
    }
    if (/^消耗 5 × 1★\s+→\s+产出 1 × ★2$/.test(t)) {
      out.consume = true;
      out.produce = true;
      continue;
    }
    if (t === '合成' || t === '已满星' || /^还差 \d+ 个$/.test(t)) out.btn = t;
  }
  return out;
}

/** 分页遍历当前分类，收集全部可达 defId（点击「下一页」为真实点击） */
async function collectIds(page) {
  const ids = new Set();
  const grab = async () => {
    for (const a of prefixed(await areas(page), 'backpack-select:')) ids.add(a.id.slice('backpack-select:'.length));
  };
  await grab();
  let guard = 0;
  let pages = 1;
  while (guard++ < 12) {
    const A = await areas(page);
    if (!find(A, 'backpack-page-next')) break;
    const before = ids.size;
    await tapVisibleById(page, 'backpack-page-next');
    await grab();
    pages++;
    if (ids.size === before && pages > 6) break;
  }
  return { ids: [...ids], pages };
}

/** 翻页定位并选中某卡（先回第一页） */
async function selectCard(page, defId) {
  let guard = 0;
  while (guard++ < 12) {
    const A = await areas(page);
    if (find(A, 'backpack-select:' + defId)) {
      const hit = await tapVisibleById(page, 'backpack-select:' + defId);
      return !!hit;
    }
    if (!find(A, 'backpack-page-next')) return false;
    await tapVisibleById(page, 'backpack-page-next');
  }
  return false;
}

/** 进入背包战斗分类（真实玩家路径：首页 → 装配台 → 顶栏背包 → 战斗 tab） */
async function gotoBackpackCombat(page, tag) {
  const A = await areas(page);
  log(!!find(A, 'home-garage'), `[${tag}] A1. 首页含「车库」入口`);
  await tapVisibleById(page, 'home-garage');
  const B = await areas(page);
  log(!!find(B, 'garage-cat:body'), `[${tag}] A2. 进入装配台（三分类在位）`);
  log(!!find(B, 'nav:backpack'), `[${tag}] A3. 装配台顶栏含「背包」入口`);
  await tapVisibleById(page, 'nav:backpack');
  const C = await areas(page);
  const tabs = ['bfilter:combat', 'bfilter:movement', 'bfilter:body'].filter((t) => find(C, t));
  log(tabs.length === 3, `[${tag}] A4. 背包页三分类 tab 齐全`, `tabs=${tabs.length}`);
  await tapVisibleById(page, 'bfilter:combat');
  return find(C, 'bfilter:combat') !== null;
}

async function runViewport(browser, vp) {
  const tag = `${vp.w}x${vp.h}@dpr${vp.dpr}`;
  const full = `${vp.w}x${vp.h}` === FULL_LOOP_VP;
  console.log(`\n===== [backpack-fusion R1] ${tag}${full ? ' (FULL 5合1)' : ' (页面/分类/分页/几何)'} =====`);
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr });
  await ctx.addInitScript(INIT_SCRIPT);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => { errs.push('pageerror:' + e.message); log(false, `[${tag}] pageerror`, e.message); });
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) {
      errs.push('console:' + m.text());
      log(false, `[${tag}] console.error`, m.text());
    }
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);

  // ---------- A. 真实玩家路径进入背包战斗分类 ----------
  await gotoBackpackCombat(page, tag);

  // ---------- B. 信息层级：无金币/段位残留 + 卡片信息行齐全 ----------
  await clearTexts(page);
  await tapVisibleById(page, 'bfilter:combat'); // 重绘当帧
  const bpTexts = await readTexts(page);
  const residue = bpTexts.filter((t) => /^金币 |^段位 /.test(t));
  log(residue.length === 0, `[${tag}] B1. 背包页无金币/段位残留`, residue.join(','));
  log(bpTexts.includes('背包'), `[${tag}] B2. 保留标题「背包」`);
  log(bpTexts.some((t) => t.includes('返回车库')), `[${tag}] B3. 保留「‹ 返回车库」`);
  const infoLines = bpTexts.filter((t) => /^总 \d+ · 装备 \d+ · 可合 \d+$/.test(t) || t === '未获得');
  const cardsNow = prefixed(await areas(page), 'backpack-select:');
  log(
    infoLines.length === cardsNow.length && cardsNow.length > 0,
    `[${tag}] B4. 每张卡片都有数量口径行（总/装备/可合 或 未获得）`,
    `info=${infoLines.length} cards=${cardsNow.length}`,
  );

  // ---------- C. 三分类全部部件可达（分页真实点击） ----------
  const combat = await collectIds(page);
  log(combat.ids.length === COMBAT_TOTAL, `[${tag}] C1. 战斗分类 ${COMBAT_TOTAL} 项全部可达`, `n=${combat.ids.length} pages=${combat.pages}`);
  await tapVisibleById(page, 'bfilter:movement');
  const move = await collectIds(page);
  log(move.ids.length === MOVEMENT_TOTAL, `[${tag}] C2. 移动分类 ${MOVEMENT_TOTAL} 项全部可达`, `n=${move.ids.length}`);
  await tapVisibleById(page, 'bfilter:body');
  const body = await collectIds(page);
  log(body.ids.length === BODY_TOTAL, `[${tag}] C3. 车身分类 ${BODY_TOTAL} 项全部可达`, `n=${body.ids.length}`);

  // ---------- D. 点击几何：选中卡真实落在该卡（无错位） ----------
  await tapVisibleById(page, 'bfilter:combat');
  const firstCard = prefixed(await areas(page), 'backpack-select:')[0];
  let geomOk = false;
  if (firstCard) {
    const did = firstCard.id.slice('backpack-select:'.length);
    await clearTexts(page);
    await tapVisibleById(page, firstCard.id);
    const t2 = await readTexts(page);
    // 选中后底部面板出现该卡名称行「<名称> · 当前 ★1」或「车身不参与合成」
    geomOk = t2.some((t) => /· 当前 ★1$/.test(t)) || t2.includes('车身不参与合成');
    log(geomOk, `[${tag}] D1. 点击卡片真实选中（面板切到该卡）`, `defId=${did}`);
  } else {
    log(false, `[${tag}] D1. 战斗分类应有卡片`);
  }

  if (!full) {
    // 非全闭环视口：验证返回车库闭环后结束
    await tapVisibleById(page, 'nav:garage');
    const E = await areas(page);
    log(!!find(E, 'garage-cat:body'), `[${tag}] E1. 「‹ 返回车库」回装配页`);
    log(!find(E, 'home-garage'), `[${tag}] E2. 未穿透回首页（保留上下文）`);
    log(errs.length === 0, `[${tag}] Z. 全程无 pageerror/console.error`, errs.join(' | '));
    await ctx.close();
    return;
  }

  // ================= 全闭环（844×390 DPR1/DPR3）=================
  const seeded = await seedInv(page, 'cannon', 5, 0);
  log(seeded, `[${tag}] F0. e2e 种子句柄可用（window.__inv.seedInventory）`);

  // F1. 选中 cannon → 读面板（拥有/已装备/可用/消耗/产出）
  await tapVisibleById(page, 'bfilter:combat');
  const sel = await selectCard(page, 'cannon');
  log(sel, `[${tag}] F1. 真实点击选中「炮」卡片`);
  await clearTexts(page);
  await tapVisibleById(page, 'backpack-select:cannon'); // 重绘当帧读面板
  let panel = parsePanel(await readTexts(page));
  log(panel.one === 5, `[${tag}] F2. 面板「拥有」读数 = 种子 1★×5`, JSON.stringify(panel));
  const eq = panel.equipped == null ? 0 : panel.equipped;

  // F3. 装备保护：拥有 5、装备 eq → 可用 5-eq
  if (eq > 0) {
    log(panel.available === 5 - eq, `[${tag}] F3. 装备保护：拥有5/装备${eq} → 可用${5 - eq}`, `available=${panel.available}`);
    log(!find(await areas(page), 'backpack-fuse'), `[${tag}] F3b. 可用<5 → 合成按钮不可点（无假可合）`);
    log(panel.btn === `还差 ${5 - panel.available} 个`, `[${tag}] F3c. 文案「还差 N 个」`, `btn=${panel.btn}`);
  } else {
    // 未装备 cannon：单独做一次「可用 4 → 还差 1 个」门控验证
    await seedInv(page, 'cannon', 4, 0);
    await clearTexts(page);
    await tapVisibleById(page, 'backpack-select:cannon');
    const p4 = parsePanel(await readTexts(page));
    log(p4.available === 4, `[${tag}] F3. 拥有4未装备 → 可用 4`, `available=${p4.available}`);
    log(!find(await areas(page), 'backpack-fuse'), `[${tag}] F3b. 可用<5 → 合成按钮不可点（无假可合）`);
    log(p4.btn === '还差 1 个', `[${tag}] F3c. 文案「还差 1 个」`, `btn=${p4.btn}`);
  }

  // F4. 可用 = 5（拥有 5+eq）→ 面板齐备 + 暖金「合成」可点
  await seedInv(page, 'cannon', 5 + eq, 0);
  await clearTexts(page);
  await tapVisibleById(page, 'backpack-select:cannon');
  panel = parsePanel(await readTexts(page));
  log(panel.available === 5, `[${tag}] F4. 可用 = 5`, `available=${panel.available} equipped=${panel.equipped}`);
  log(panel.consume && panel.produce, `[${tag}] F5. 面板显示「消耗 5 × 1★ → 产出 1 × ★2」`);
  log(panel.btn === '合成', `[${tag}] F6. 主按钮文案「合成」`, `btn=${panel.btn}`);
  const fuseHit = find(await areas(page), 'backpack-fuse');
  log(!!fuseHit, `[${tag}] F7. 「合成」按钮真实可点（注册命中区）`);
  log(!find(await areas(page), 'modal-veil'), `[${tag}] F8. 合成走页内面板（无新增 Modal）`);
  const buildBefore = await readBuild(page);

  // F9. 真实点击合成 → 1★-5 / 2★+1
  const pre = await readInv(page, 'cannon');
  await tapVisibleById(page, 'backpack-fuse');
  const post = await readInv(page, 'cannon');
  log(post.one === pre.one - 5, `[${tag}] F9. 1★ 实际 -5`, `${pre.one} → ${post.one}`);
  log(post.two === pre.two + 1, `[${tag}] F10. 2★ 实际 +1`, `${pre.two} → ${post.two}`);
  if (eq > 0) log(post.one === eq, `[${tag}] F11. 已装备 ${eq} 件未被消耗`, `one=${post.one}`);
  else log(true, `[${tag}] F11. 无已装备副本（装备保护由 F3 门控验证）`);
  await clearTexts(page);
  await tapVisibleById(page, 'backpack-select:cannon');
  const okText = (await readTexts(page)).some((t) => /合成成功/.test(t) || /2★ 1/.test(t) || /★★×1/.test(t));
  log(okText, `[${tag}] F12. 合成结果有可见反馈（焦点仍在原卡面板）`);

  // F13. 连点不重复消耗（恰好可用 5 → 快速两连击只应发生一次合成）
  await seedInv(page, 'cannon', 5 + eq, 0);
  await tapVisibleById(page, 'backpack-select:cannon');
  const pre2 = await readInv(page, 'cannon');
  await tapTwiceFast(page, 'backpack-fuse');
  const post2 = await readInv(page, 'cannon');
  log(
    post2.one === pre2.one - 5 && post2.two === pre2.two + 1,
    `[${tag}] F13. 连点不重复消耗（仅一次合成）`,
    `1★ ${pre2.one}→${post2.one} / 2★ ${pre2.two}→${post2.two}`,
  );

  // F14. 返回车库 → Build 不变
  await tapVisibleById(page, 'nav:garage');
  const G = await areas(page);
  log(!!find(G, 'garage-cat:body'), `[${tag}] F14. 「‹ 返回车库」回装配页`);
  log(!find(G, 'home-garage'), `[${tag}] F15. 未穿透回首页（保留上下文）`);
  log((await readBuild(page)) === buildBefore, `[${tag}] F16. 合成不改动 Build（playerBuild 持久化未变）`);

  // F17. reload 后 2★ 仍在（等价关掉重进）
  const beforeReload = await readInv(page, 'cannon');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);
  const afterReload = await readInv(page, 'cannon');
  log(
    afterReload.two === beforeReload.two && afterReload.two >= 1,
    `[${tag}] F17. reload 后 2★ 保持`,
    `two ${beforeReload.two} → ${afterReload.two}`,
  );
  await gotoBackpackCombat(page, tag + '/reload');
  const sel2 = await selectCard(page, 'cannon');
  await clearTexts(page);
  if (sel2) await tapVisibleById(page, 'backpack-select:cannon');
  const pr = parsePanel(await readTexts(page));
  log(pr.two === afterReload.two, `[${tag}] F18. reload 后面板 2★ 读数与库存一致`, `panel2★=${pr.two}`);

  log(errs.length === 0, `[${tag}] Z. 全程无 pageerror/console.error`, errs.join(' | '));
  await ctx.close();
}

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  } catch (e) {
    console.log('msedge 不可用，回退默认 chromium：' + (e && e.message ? e.message : e));
    browser = await chromium.launch({ headless: true });
  }
  const viewports = [
    { w: 420, h: 210, dpr: 1 },
    { w: 420, h: 210, dpr: 3 },
    { w: 844, h: 390, dpr: 1 },
    { w: 844, h: 390, dpr: 3 },
    { w: 1280, h: 592, dpr: 1 },
    { w: 1280, h: 592, dpr: 3 },
  ];
  for (const vp of viewports) {
    await runViewport(browser, vp);
  }
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== BACKPACK FUSION R1 E2E GATE: ${results.length - failed.length}/${results.length} PASS =====`);
  if (failed.length > 0) {
    failed.forEach((f) => console.log('FAILED: ' + f.name + ' | ' + f.detail));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error('CRASH', e && e.stack ? e.stack : e);
  process.exit(2);
});
