/**
 * F-GARAGE-FUSION-UX-R2｜背包合成重构 —— 浏览器真实闭环 E2E（§十 玩家路径）
 *
 * 取代 _e2e_backpack_fusion.cjs（R1：点卡即 5合1 + 测试材料补足单件）。本版走 R2 玩家路径：
 *
 *   种子（未装备）：cannon 1★×2 + hammer 1★×2 + saw 1★×1（分类可用 = 5 → 「可合成 1 次」）
 *   → Home→Garage→背包（战斗分类）
 *   → 点「自动放入」→ 5 材料槽满（已选 5/5；材料 = 确定性 未装备→重复多→defId 序）
 *   → 点材料槽移除 1 件 → 点该卡片补回（手动移除/替换，零消耗）
 *   → 点暖金「合成」→ 页内结果卡（合成成功 / 2★）→ 材料槽清空收拢
 *   → 原 5 件 1★ 扣除、1 件同分类随机 2★ 入账（产物 ∈ OFFICIAL_PARTS）
 *   → 新产出短暂暖金高亮（fusionGlow.defId = 产物）
 *   → reload：2★ 保持、Build 未变、分类「还差 N 件」按剩余可算
 *
 * 关键手段（都不污染任何产物 bundle）：
 *  1) 种子库存：window.__inv.seedInventory（__E2E_INTERNAL_HANDLE__ 守卫，仅 e2e 构建）；
 *  2) 玩家 Build：把 BUILD_KEY 写成「合法但只装 1 件未参与材料的武器（spear）」，使 3 个种子 defId
 *     全部未装备 → 可用恰 5（默认 starter 会装备 cannon/hammer，会破坏 §十 场景口径）；
 *  3) 面板文案读数：page.addInitScript 劫持 CanvasRenderingContext2D.prototype.fillText 录制真实文本
 *     —— 纯测试侧 instrumentation，app 源码零改动；
 *  4) 只读诊断：读 window.__h.fusionSlots / fusionResult / fusionGlow（TS private 编译后为普通属性；
 *     仅读不写；一切交互仍走真实可见按钮点击）。
 *
 * 视口 ×4（§十）：844×390 DPR1 / 844×390 DPR3 / 420×210 DPR1 / 1280×592 DPR1.5 —— 全跑真实闭环。
 *
 * 用法（需先起服务 + Edge/Chromium）：npm run build:e2e 后
 *   E2E_DIR=e2e node tests/_serve_pages.cjs &   （端口 8138）
 *   node tests/_e2e_fusion_ux_r2.cjs
 */
const { chromium } = require('playwright-core');
const BASE = 'http://127.0.0.1:8138/';
const INV_KEY = 'strongfruit.ownedParts.v2';
const BUILD_KEY = 'strongfruit.playerBuild.v1';
const COMBAT_TOTAL = 11;
const MOVEMENT_TOTAL = 3;
const BODY_TOTAL = 8;

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
  await page.waitForTimeout(200);
  return info;
}

/** 连点（同一坐标背靠背两次点击，中间不等待）——验证不重复消耗 */
async function tapTwiceFast(page, id) {
  const info = await pixelOf(page, id);
  if (!info) return null;
  await page.mouse.click(info.px, info.py);
  await page.mouse.click(info.px, info.py);
  await page.waitForTimeout(280);
  return info;
}

/** R2.2：命中区右下角（内缩 inset）真实像素点击——结果卡「点空白区关闭」专用（卡片中心=阅读 no-op，不可再点中）。 */
async function tapCornerById(page, id, inset = 12) {
  const info = await page.evaluate(([i, ins]) => {
    const h = window.__h;
    const a = h.getHitAreasForTest().find((z) => z.id === i);
    if (!a) return null;
    const t = h.getTransformInfo();
    const c = document.querySelectorAll('canvas')[1] || document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    const drawnX = t.ox + t.scale * (a.x + a.w - ins);
    const drawnY = t.oy + t.scale * (a.y + a.h - ins);
    const sx = r.width / Math.max(1, c.clientWidth);
    const sy = r.height / Math.max(1, c.clientHeight);
    return { px: r.left + drawnX * sx, py: r.top + drawnY * sy };
  }, [id, inset]);
  if (!info) return null;
  await page.mouse.click(info.px, info.py);
  await page.waitForTimeout(200);
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

// ---------- 只读诊断（__h 私有态在运行时为普通属性；只读不写） ----------
async function hostState(page) {
  return page.evaluate(() => {
    const h = window.__h;
    return {
      slots: h.fusionSlots ? h.fusionSlots.slice() : null,
      result: h.fusionResult ? { product: h.fusionResult.product, now: h.nowMs } : null,
      glow: h.fusionGlow ? { defId: h.fusionGlow.defId, until: h.fusionGlow.until, now: h.nowMs } : null,
    };
  });
}

// ---------- 库存 / Build 读数（直接读 localStorage，只读） ----------
async function readInvAll(page) {
  return page.evaluate((k) => {
    try {
      const raw = JSON.parse(localStorage.getItem(k) || '{}');
      const out = {};
      for (const [d, e] of Object.entries(raw)) {
        if (e && typeof e === 'object' && d !== '__v') out[d] = { one: Number(e.one || 0), two: Number(e.two || 0) };
      }
      return out;
    } catch (err) {
      void err;
      return {};
    }
  }, INV_KEY);
}
async function readBuild(page) {
  return page.evaluate((k) => localStorage.getItem(k) || '', BUILD_KEY);
}
/** 通过 e2e 专用句柄种子库存（不经 RC 授予路径）；仅含种子 defId，其余归零 */
async function seedInv(page, seed) {
  const ok = await page.evaluate(
    (s) => {
      if (!window.__inv || typeof window.__inv.seedInventory !== 'function') return false;
      window.__inv.seedInventory(s);
      return true;
    },
    seed,
  );
  await page.waitForTimeout(150);
  return ok;
}
/** 写玩家 Build（合法：只装 1 件未参与材料的武器 → 种子 defId 全部未装备） */
async function writeBareBuild(page) {
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [
    BUILD_KEY,
    JSON.stringify({
      __v: 1,
      bodyDefId: 'boxBody',
      rearRadius: 20,
      frontRadius: 20,
      functionalSelections: { frontMass: 'spear' },
    }),
  ]);
}

/** 库存汇总 */
function totals(inv) {
  let one = 0;
  let two = 0;
  for (const e of Object.values(inv)) {
    one += e.one;
    two += e.two;
  }
  return { one, two };
}

/** 从库存找 2★ 增量产物 defId（前后对比） */
function productOf(before, after) {
  for (const [d, e] of Object.entries(after)) {
    if (e.two > (before[d] ? before[d].two : 0)) return d;
  }
  return null;
}

function parseBarCount(texts) {
  for (const t of texts) {
    const m = /^已选 (\d+)\/5$/.exec(t);
    if (m) return +m[1];
  }
  return -1;
}

/** 翻页定位并点某卡（真实翻页 + 真实点击） */
async function tapCard(page, defId) {
  let guard = 0;
  while (guard++ < 12) {
    const A = await areas(page);
    if (find(A, 'backpack-select:' + defId)) return !!(await tapVisibleById(page, 'backpack-select:' + defId));
    if (!find(A, 'backpack-page-next')) return false;
    await tapVisibleById(page, 'backpack-page-next');
  }
  return false;
}

/** 分页收集全部可达 defId */
async function collectIds(page) {
  const ids = new Set();
  const grab = async () => {
    for (const a of prefixed(await areas(page), 'backpack-select:')) ids.add(a.id.slice('backpack-select:'.length));
  };
  await grab();
  let guard = 0;
  while (guard++ < 12) {
    const A = await areas(page);
    if (!find(A, 'backpack-page-next')) break;
    await tapVisibleById(page, 'backpack-page-next');
    await grab();
  }
  return [...ids];
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
}

/**
 * §十 真实闭环（所有视口实跑）：
 * 种子 cannon2+hammer2+saw1 → 可合成1次 → 自动放入 → 移除1 → 补回 → 合成 → 结果卡 → 扣料/产出
 * → 高亮 → reload 保持 → Build 不变。
 */
async function runViewport(browser, vp) {
  const tag = `${vp.w}x${vp.h}@dpr${vp.dpr}`;
  console.log(`\n===== [fusion-ux-r2] ${tag}（§十 真实闭环）=====`);
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr });
  await ctx.addInitScript(INIT_SCRIPT);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => {
    errs.push('pageerror:' + e.message);
    log(false, `[${tag}] pageerror`, e.message);
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) {
      errs.push('console:' + m.text());
      log(false, `[${tag}] console.error`, m.text());
    }
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // F0. 种子 + 裸 Build（先读再写；build 确保 cannon/hammer/saw 均未装备）
  const seeded = await seedInv(page, { cannon: { one: 2, two: 0 }, hammer: { one: 2, two: 0 }, saw: { one: 1, two: 0 } });
  log(seeded, `[${tag}] F0. e2e 库存种子可用（cannon2+hammer2+saw1）`);
  await writeBareBuild(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // A. 真实玩家导航到背包战斗分类
  await gotoBackpackCombat(page, tag);

  // B. 背包页信息层级：无金币/段位残留 + 顶栏保留
  await clearTexts(page);
  await tapVisibleById(page, 'bfilter:combat'); // 重绘当帧
  const bpTexts = await readTexts(page);
  const residue = bpTexts.filter((t) => /^金币 |^段位 /.test(t));
  log(residue.length === 0, `[${tag}] B1. 背包页无金币/段位残留`, residue.join(','));
  log(bpTexts.some((t) => t.includes('部件合成')), `[${tag}] B2. 保留标题「部件合成」`);
  log(bpTexts.some((t) => t.includes('返回车库')), `[${tag}] B3. 保留「‹ 返回车库」`);

  // C. 三分类全部部件可达（真实翻页）
  const combat = await collectIds(page);
  log(combat.length === COMBAT_TOTAL, `[${tag}] C1. 战斗分类 ${COMBAT_TOTAL} 项全部可达`, `n=${combat.length}`);
  await tapVisibleById(page, 'bfilter:movement');
  const move = await collectIds(page);
  log(move.length === MOVEMENT_TOTAL, `[${tag}] C2. 移动分类 ${MOVEMENT_TOTAL} 项全部可达`, `n=${move.length}`);
  await tapVisibleById(page, 'bfilter:body');
  const body = await collectIds(page);
  log(body.length === BODY_TOTAL, `[${tag}] C3. 车身分类 ${BODY_TOTAL} 项全部可达`, `n=${body.length}`);
  await tapVisibleById(page, 'bfilter:combat'); // 回到战斗（含清空材料槽的切换语义）

  // D. 种子场景状态：分类可用 5 → 「可合成 1 次」
  await clearTexts(page);
  await tapVisibleById(page, 'bfilter:combat');
  const st = await readTexts(page);
  log(st.some((t) => /^可合成 1 次/.test(t)), `[${tag}] D1. 分类可用 5 → 状态行「可合成 1 次」`, st.filter((t) => /可合成|还差/.test(t)).join(' | '));
  const fuseAtEmpty = find(await areas(page), 'backpack-fuse');
  const dbgIds = (await areas(page)).filter((a) => /backpack|fusion|bfilter/.test(a.id)).map((a) => a.id);
  const dbgState = await hostState(page);
  log(!fuseAtEmpty, `[${tag}] D2. 空槽时主按钮不可点（默认不自动消耗）`, fuseAtEmpty ? 'ids=' + dbgIds.join(',') + ' slots=' + JSON.stringify(dbgState.slots) : 'absent');
  log(!!find(await areas(page), 'fusion-auto'), `[${tag}] D3. 「自动放入」次按钮可点`);

  // E. 自动放入 → 5 槽满
  await tapVisibleById(page, 'fusion-auto');
  const autoState = await hostState(page);
  log(autoState.slots && autoState.slots.filter(Boolean).length === 5, `[${tag}] E1. 自动放入后材料槽满 5`, JSON.stringify(autoState.slots));
  log(!!find(await areas(page), 'backpack-fuse'), `[${tag}] E2. 满 5 → 暖金「合成」主按钮可点`);
  // 确定性优先级：可用 2/2/1 → 重复多优先 → cannon×2 hammer×2 saw×1（defId 稳定）
  const sorted = autoState.slots.filter(Boolean).slice().sort();
  const expectMat = ['cannon', 'cannon', 'hammer', 'hammer', 'saw'].sort();
  log(JSON.stringify(sorted) === JSON.stringify(expectMat), `[${tag}] E3. 自动放入材料 = 未装备→重复多→defId 序`, sorted.join(','));

  // F. 手动移除 1 件（点材料槽）→ 再点卡片补回（零消耗）
  const beforeRem = await readInvAll(page);
  const removeIdx = 2;
  const removedDefId = autoState.slots[removeIdx];
  await tapVisibleById(page, `fusion-slot:${removeIdx}`);
  const afterRemState = await hostState(page);
  log(afterRemState.slots.filter(Boolean).length === 4, `[${tag}] F1. 点材料槽移除 → 剩 4 件`);
  log(JSON.stringify(afterRemState.slots) === JSON.stringify(autoState.slots.slice(0, removeIdx).concat([null], autoState.slots.slice(removeIdx + 1))), `[${tag}] F2. 移除的正是 ${removedDefId}（槽 ${removeIdx}）`);
  const afterRemInv = await readInvAll(page);
  log(JSON.stringify(beforeRem) === JSON.stringify(afterRemInv), `[${tag}] F3. 移除不消耗材料（库存零变更）`);
  const refilled = await tapCard(page, removedDefId);
  log(refilled, `[${tag}] F4. 再点「${removedDefId}」卡片补回`);
  const refillState = await hostState(page);
  log(refillState.slots.filter(Boolean).length === 5, `[${tag}] F5. 补回 → 满 5`);

  // G. 合成 → 材料扣除 / 随机产出 / 结果卡 / 槽清空（文本采集须在点击前清空，合成帧的绘制落在点击后）
  const before = await readInvAll(page);
  const buildBefore = await readBuild(page);
  await clearTexts(page);
  await tapVisibleById(page, 'backpack-fuse');
  await page.waitForTimeout(340); // 280ms pending → 结果卡（G1-G7 读数窗口；与 feedback R2.1 driver 的 420ms 同法）
  const afterFuse = await hostState(page);
  log(afterFuse.result && afterFuse.result.product, `[${tag}] G1. 结果卡出现（含产出 defId）`, afterFuse.result ? afterFuse.result.product : 'null');
  const after = await readInvAll(page);
  const tBefore = totals(before);
  const tAfter = totals(after);
  log(tAfter.one === tBefore.one - 5, `[${tag}] G2. 1★ 总数 -5（原子扣料）`, `${tBefore.one} → ${tAfter.one}`);
  log(tAfter.two === tBefore.two + 1, `[${tag}] G3. 2★ 总数 +1（随机产出）`, `${tBefore.two} → ${tAfter.two}`);
  const product = productOf(before, after);
  log(afterFuse.result && product === afterFuse.result.product, `[${tag}] G4. 产出 defId = 结果卡 defId（${product}）`);
  log(afterFuse.slots && afterFuse.slots.every((s) => s === null), `[${tag}] G5. 合成成功 → 材料槽清空收拢`);
  // 结果卡可见文案（页内完成，无 Modal）——文本在合成帧已录制（点击前已清空）
  const resTexts = await readTexts(page);
  log(resTexts.some((t) => t === '合成成功'), `[${tag}] G6. 结果卡文案「合成成功」`);
  log(resTexts.some((t) => t === '2★'), `[${tag}] G7. 结果卡星级「2★」`);
  log(!find(await areas(page), 'modal-veil'), `[${tag}] G8. 合成走页内结果卡（无 Modal）`);
  // R2.2：底层保留 + 不自动关 + 点卡不关（真实交互）
  log(resTexts.some((t) => t === '部件合成'), `[${tag}] G9. 结果帧底层页面保留（非全黑）`);
  await page.waitForTimeout(1200); // 静置远超旧 950ms 自动关窗口
  const persist = await hostState(page);
  log(persist.result && persist.result.product === product, `[${tag}] G10. 无输入 1.2s 后结果卡仍展示（不自动关）`, persist.result ? persist.result.product : 'null');
  const beforeCard = await hostState(page);
  await tapVisibleById(page, 'fusion-result-card'); // 卡中心命中=阅读态 no-op
  const afterCard = await hostState(page);
  log(afterCard.result && afterCard.result.product === beforeCard.result.product, `[${tag}] G11. 点卡本体 → 结果卡不关闭（阅读态）`);

  // H. 点结果卡外空白区关闭（R2.2：右下角空白；点卡本体为阅读 no-op）→ 新产出短暂暖金高亮
  await tapCornerById(page, 'fusion-result-dismiss');
  const glowState = await hostState(page);
  log(glowState.glow && glowState.glow.defId === product, `[${tag}] H1. 新产出短暂暖金高亮（${product}）`, glowState.glow ? glowState.glow.defId : 'null');

  // I. Build 不变 + reload 持久化
  log((await readBuild(page)) === buildBefore, `[${tag}] I1. 合成不改 Build（playerBuild 未变）`);
  const beforeReload = await readInvAll(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const afterReload = await readInvAll(page);
  log(JSON.stringify(afterReload) === JSON.stringify(beforeReload), `[${tag}] I2. reload 后库存保持（2★ 在档）`);
  log(totals(afterReload).two === tBefore.two + 1, `[${tag}] I3. reload 后 2★ 仍在`, `two=${totals(afterReload).two}`);
  // 重进背包：材料已扣、产物在库存 → 状态行按剩余可算（还差 N 件）
  await gotoBackpackCombat(page, tag + '/reload');
  await clearTexts(page);
  await tapVisibleById(page, 'bfilter:combat');
  const st2 = await readTexts(page);
  log(st2.some((t) => /^还差 \d+ 件1★部件/.test(t)), `[${tag}] I4. 重进后按剩余材料提示「还差 N 件1★部件」`, st2.filter((t) => /可合成|还差/.test(t)).join(' | '));

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
    { w: 844, h: 390, dpr: 1 },
    { w: 844, h: 390, dpr: 3 },
    { w: 420, h: 210, dpr: 1 },
    { w: 1280, h: 592, dpr: 1.5 },
  ];
  for (const vp of viewports) {
    await runViewport(browser, vp);
  }
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== FUSION UX R2 E2E GATE: ${results.length - failed.length}/${results.length} PASS =====`);
  if (failed.length > 0) {
    failed.forEach((f) => console.log('FAILED: ' + f.name + ' | ' + f.detail));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error('CRASH', e && e.stack ? e.stack : e);
  process.exit(2);
});
