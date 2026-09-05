/**
 * F-GARAGE-FUSION-FEEDBACK-LAYOUT-R2.1｜合成页布局/反馈重构 —— 浏览器真实闭环 E2E（§十三 16 步）
 *
 * 种子（确定性材料口径，同 R2）：cannon 1★×2 + hammer 1★×2 + saw 1★×1（全部未装备 → 分类可用 5）
 *   S1 进合成（Home→Garage→背包 战斗分类）
 *   S2 切分类（combat 兜底 + 状态行主/次信息：可合成 1 次 / 1★材料 5 件）
 *   S3 点「自动放入」→ 5 槽满
 *   S4 五槽可辨识（fusion-slot:0..4 注册 + 槽内短名 + ×N）
 *   S5 反馈「已自动放入5件材料」+ N/5=5
 *   S6 点材料槽移除 1 → 剩 4
 *   S7 反馈「已移除：<短名>（4/5）」（库存零变更）
 *   S8 点该卡补回 → 满 5
 *   S9 反馈「已放入：<短名>（5/5）」
 *   S10 点「合成」→「合成中…」→ 页内结果卡
 *   S11 结果卡同屏「消耗：5件战斗1★」+「获得：<名>2★」+ 真图标 + 2★
 *   S12 点任意处关闭结果卡
 *   S13 关闭后产出自动可见（跳产物所在页）+「新获得」高亮（~2s）
 *   S14 库存：1★ −5、产物 2★ +1（与结果卡 defId 一致）
 *   S15 reload 后库存产出保持
 *   S16 全程：无 hitArea 重叠 / 无越界 / 无 pageerror / 无 console.error
 *
 * 关键手段（全部不污染产物 bundle）：
 *  - 种子库存 window.__inv.seedInventory（__E2E_INTERNAL_HANDLE__，仅 e2e 构建）；
 *  - 裸 Build：仅装 spear（不在材料集）→ 种子 defId 全未装备 → 可用恰 5；
 *  - fillText 劫持录制真实面板文案（纯测试侧 instrumentation）；
 *  - 只读诊断 __h（fusionSlots/result/glow）；交互全走真实可见点击。
 *
 * 视口 ×4 全跑（§十三）：844×390 DPR1 / 844×390 DPR3 / 420×210 DPR1 / 1280×592 DPR1.5
 * 用法：npm run build:e2e 后
 *   node tests/_serve_pages.cjs &   （端口 8138）
 *   node tests/_e2e_fusion_feedback_r21.cjs
 */
const { chromium } = require('playwright-core');
const BASE = 'http://127.0.0.1:8138/';
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
function find(A, id) {
  return A.find((x) => x.id === id) || null;
}
function prefixed(A, p) {
  return A.filter((x) => x.id.startsWith(p));
}
function inter(a, b) {
  if (!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y)) return null;
  return { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), w: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) };
}

/** 真实可见像素坐标（host 变换 + getBoundingClientRect 抗 CSS scale；与既有 E2E 同源） */
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
    const sx = r.width / Math.max(1, c.clientWidth);
    const sy = r.height / Math.max(1, c.clientHeight);
    return { px: r.left + drawnX * sx, py: r.top + drawnY * sy };
  }, id);
}
async function tapVisibleById(page, id) {
  const info = await pixelOf(page, id);
  if (!info) return null;
  await page.mouse.click(info.px, info.py);
  await page.waitForTimeout(180);
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

// ---------- 只读诊断（__h 私有态运行时即普通属性；只读不写） ----------
async function hostState(page) {
  return page.evaluate(() => {
    const h = window.__h;
    return {
      slots: h.fusionSlots ? h.fusionSlots.slice() : null,
      result: h.fusionResult ? { product: h.fusionResult.product, until: h.fusionResult.until, now: h.nowMs } : null,
      glow: h.fusionGlow ? { defId: h.fusionGlow.defId, until: h.fusionGlow.until, now: h.nowMs } : null,
      pending: h.fusionPending ? { until: h.fusionPending.until, now: h.nowMs } : null,
      backpackPage: h.backpackPage,
    };
  });
}

// ---------- 库存 / Build 读数（localStorage 只读） ----------
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
async function writeBareBuild(page) {
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [
    BUILD_KEY,
    JSON.stringify({ __v: 1, bodyDefId: 'boxBody', rearRadius: 20, frontRadius: 20, functionalSelections: { frontMass: 'spear' } }),
  ]);
}

/** 短名（与 fusionShortName 同表；e2e 断言反馈文案用） */
const SHORT = { cannon: '炮', hammer: '锤', pushRod: '推杆', spear: '刺', laser: '镭射', rammer: '冲锤', saw: '圆锯', shotgun: '霰弹', thruster: '推进', machineGun: '机枪', flamethrower: '喷火' };
function shortName(defId) {
  return SHORT[defId] || defId;
}
function totals(inv) {
  let one = 0;
  let two = 0;
  for (const e of Object.values(inv)) {
    one += e.one;
    two += e.two;
  }
  return { one, two };
}
function productOf(before, after) {
  for (const [d, e] of Object.entries(after)) {
    if (e.two > (before[d] ? before[d].two : 0)) return d;
  }
  return null;
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

/** 命中区几何门禁：两两不相交 + 全部在 logical 舞台内（§十三 S16 / 布局像素门禁）
 *  注意：hitArea 注册于 host logical 舞台坐标系（cssW×cssH，Web 恒 844×390），
 *  CSS viewport 变化只影响外层 CSS 缩放——越界判定必须以 logical 舞台为界，
 *  拿 CSS viewport（如 420×210）比较 logical 坐标会误报。 */
async function geometryGate(page, tag) {
  const A = await areas(page);
  const t = await page.evaluate(() => window.__h.getTransformInfo());
  const LW = t.cssW || 844;
  const LH = t.cssH || 390;
  const bad = [];
  for (let i = 0; i < A.length; i++) {
    for (let j = i + 1; j < A.length; j++) {
      const a = A[i];
      const b = A[j];
      if (a.id === b.id) continue;
      if (a.id.startsWith('backpack-select:') && b.id.startsWith('backpack-select:')) continue;
      const ov = inter(a, b);
      if (ov) bad.push(`${a.id}×${b.id}(${Math.round(ov.w)}x${Math.round(ov.h)})`);
    }
    const a = A[i];
    if (a.x < -0.5 || a.y < -0.5 || a.x + a.w > LW + 0.5 || a.y + a.h > LH + 0.5) bad.push(`${a.id}越界`);
  }
  log(bad.length === 0, `[${tag}] S16a. hitArea 无重叠/无越界(舞台${LW}x${LH})`, bad.slice(0, 8).join(',') || 'ok');
}

/** 进背包战斗分类（真实玩家路径） */
async function gotoBackpackCombat(page, tag) {
  const A = await areas(page);
  log(!!find(A, 'home-garage'), `[${tag}] S1a. 首页含「车库」入口`);
  await tapVisibleById(page, 'home-garage');
  const B = await areas(page);
  log(!!find(B, 'nav:backpack'), `[${tag}] S1b. 装配台顶栏含「背包」`);
  await tapVisibleById(page, 'nav:backpack');
  const C = await areas(page);
  const tabs = ['bfilter:combat', 'bfilter:movement', 'bfilter:body'].filter((t) => find(C, t));
  log(tabs.length === 3, `[${tag}] S1c. 背包页三分类齐全`, `tabs=${tabs.length}`);
  await tapVisibleById(page, 'bfilter:combat');
}

/** §十三 16 步真实闭环（每视口实跑） */
async function runViewport(browser, vp) {
  const tag = `${vp.w}x${vp.h}@dpr${vp.dpr}`;
  console.log(`\n===== [fusion-feedback-r21] ${tag}（§十三 16 步）=====`);
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

  const seeded = await seedInv(page, { cannon: { one: 2, two: 0 }, hammer: { one: 2, two: 0 }, saw: { one: 1, two: 0 } });
  log(seeded, `[${tag}] F0. e2e 库存种子可用（cannon2+hammer2+saw1）`);
  await writeBareBuild(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // S1 进合成 + S2 分类与状态行
  await gotoBackpackCombat(page, tag);
  await clearTexts(page);
  await tapVisibleById(page, 'bfilter:combat');
  const st = await readTexts(page);
  log(st.some((t) => /^可合成 1 次/.test(t)), `[${tag}] S2a. 主状态「可合成 1 次」`, st.filter((t) => /可合成|还差/.test(t)).join('|'));
  log(st.some((t) => /^1★材料 \d 件/.test(t)), `[${tag}] S2b. 次状态「1★材料 N 件」`, st.filter((t) => /^1★材料/.test(t)).join('|'));
  log(!find(await areas(page), 'backpack-fuse'), `[${tag}] S2c. 空槽时主按钮不可点`);
  log(!!find(await areas(page), 'fusion-auto'), `[${tag}] S2d. 「自动放入」可点（可用=5）`);

  // S3 自动放入
  await clearTexts(page);
  await tapVisibleById(page, 'fusion-auto');
  const autoState = await hostState(page);
  log(autoState.slots && autoState.slots.filter(Boolean).length === 5, `[${tag}] S3a. 自动放入 → 5 槽满`, JSON.stringify(autoState.slots));
  const sorted = autoState.slots.filter(Boolean).slice().sort();
  log(JSON.stringify(sorted) === JSON.stringify(['cannon', 'cannon', 'hammer', 'hammer', 'saw'].sort()), `[${tag}] S3b. 确定性材料（重复多→defId 序）`, sorted.join(','));
  // S4 五槽可辨识
  const A4 = await areas(page);
  const slots = prefixed(A4, 'fusion-slot:');
  log(slots.length === 5, `[${tag}] S4a. 5 个材料槽注册`, `n=${slots.length}`);
  const txt4 = await readTexts(page);
  const shortSeen = ['cannon', 'hammer', 'saw'].map((d) => shortName(d)).filter((n) => txt4.includes(n));
  log(shortSeen.length === 3, `[${tag}] S4b. 槽内短名可辨识（炮/锤/圆锯）`, shortSeen.join(','));
  // S5 自动放入反馈 + N/5
  log(txt4.some((t) => t === '已自动放入5件材料'), `[${tag}] S5a. 「已自动放入5件材料」行内反馈`);
  log(txt4.some((t) => /^5\/5$/.test(t)), `[${tag}] S5b. N/5 = 5/5`);

  // S6 移除 1 件
  const beforeRem = await readInvAll(page);
  const removedDefId = autoState.slots[2]; // hammer
  await clearTexts(page);
  await tapVisibleById(page, 'fusion-slot:2');
  const afterRemState = await hostState(page);
  log(afterRemState.slots.filter(Boolean).length === 4, `[${tag}] S6a. 点槽移除 → 4 件`);
  // S7 移除反馈 + 零消耗
  const txt7 = await readTexts(page);
  log(txt7.some((t) => new RegExp(`^已移除：${shortName(removedDefId)}（4/5）$`).test(t)), `[${tag}] S7a. 「已移除：${shortName(removedDefId)}（4/5）」`, txt7.filter((t) => /已移除/.test(t)).join('|') || '(none)');
  log(JSON.stringify(await readInvAll(page)) === JSON.stringify(beforeRem), `[${tag}] S7b. 移除零库存消耗`);
  expectFuseDisabled: {
    const af = await areas(page);
    log(!find(af, 'backpack-fuse'), `[${tag}] S7c. 未满 5 → 合成不可点`);
  }

  // S8 补回 + S9 加入反馈
  await clearTexts(page);
  const refilled = await tapCard(page, removedDefId);
  log(refilled, `[${tag}] S8a. 点「${removedDefId}」卡补回`);
  const refillState = await hostState(page);
  log(refillState.slots.filter(Boolean).length === 5, `[${tag}] S8b. 补回 → 满 5`);
  const txt9 = await readTexts(page);
  log(txt9.some((t) => new RegExp(`^已放入：${shortName(removedDefId)}（5/5）$`).test(t)), `[${tag}] S9a. 「已放入：${shortName(removedDefId)}（5/5）」`, txt9.filter((t) => /已放入/.test(t)).join('|') || '(none)');
  log(txt9.some((t) => /^5\/5$/.test(t)), `[${tag}] S9b. N/5=5 同步`);
  log(!!find(await areas(page), 'backpack-fuse'), `[${tag}] S9c. 满 5 → 「合成」可点`);

  // S10 合成（合成中…→ 结果卡）
  const before = await readInvAll(page);
  const buildBefore = await readBuild(page);
  await clearTexts(page);
  await tapVisibleById(page, 'backpack-fuse');
  const pendState = await hostState(page);
  log(!!pendState.pending, `[${tag}] S10a. 「合成中…」瞬时态`);
  await page.waitForTimeout(420); // 280ms pending → 结果卡
  const resState = await hostState(page);
  log(resState.result && !!resState.result.product, `[${tag}] S10b. 页内结果卡出现（产物 ${resState.result ? resState.result.product : 'null'}）`);
  const after = await readInvAll(page);
  const product = productOf(before, after);
  log(!!product && resState.result && product === resState.result.product, `[${tag}] S10c. 产物 defId 与结果卡一致`, product || 'null');
  // S11 结果卡同屏：消耗 / 获得 / 2★ / 标题
  const resTxt = await readTexts(page);
  log(resTxt.some((t) => t === '合成成功'), `[${tag}] S11a. 标题「合成成功」`);
  log(resTxt.some((t) => /^消耗：5件战斗1★$/.test(t)), `[${tag}] S11b. 「消耗：5件战斗1★」`);
  const got = resTxt.filter((t) => /^获得：/.test(t));
  log(got.length === 1, `[${tag}] S11c. 「获得：…」行存在`, got.join('|') || '(none)');
  log(resTxt.some((t) => t === '2★'), `[${tag}] S11d. 星级标注「2★」`);
  log(resTxt.some((t) => t === '点击任意处继续'), `[${tag}] S11e. 「点击任意处继续」可读`);
  const tBefore = totals(before);
  const tAfter = totals(after);
  log(tAfter.one === tBefore.one - 5, `[${tag}] S14a. 1★ 总数 -5（原子扣料）`, `${tBefore.one}→${tAfter.one}`);
  log(tAfter.two === tBefore.two + 1, `[${tag}] S14b. 2★ 总数 +1`, `${tBefore.two}→${tAfter.two}`);

  // S12 关闭结果卡
  await clearTexts(page);
  await tapVisibleById(page, 'fusion-result-dismiss');
  // S13 关闭后：跳产物所在页 + 「新获得」高亮
  const glowState = await hostState(page);
  log(glowState.glow && glowState.glow.defId === product, `[${tag}] S13a. 新产出高亮（glow=产物）`, glowState.glow ? glowState.glow.defId : 'null');
  const A13 = await areas(page);
  log(!!find(A13, 'backpack-select:' + product), `[${tag}] S13b. 产出卡当前页可见（自动跳页）`, `page=${glowState.backpackPage}`);
  const txt13 = await readTexts(page);
  log(txt13.some((t) => t === '新获得'), `[${tag}] S13c. 产出卡「新获得」角标`);
  // 星级数量立即可见（2★×1）
  const starVisible = await page.evaluate(() => window.__txt.some((t) => /^2★×1$/.test(t)));
  log(starVisible, `[${tag}] S13d. 产物卡星级数量（2★×1）可见`);

  // S14 已在上；S15 reload 持久化 + Build 不变
  log((await readBuild(page)) === buildBefore, `[${tag}] S15a. 合成不改 Build`);
  const beforeReload = await readInvAll(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const afterReload = await readInvAll(page);
  log(JSON.stringify(afterReload) === JSON.stringify(beforeReload), `[${tag}] S15b. reload 后库存保持`, `two=${totals(afterReload).two}`);
  log(totals(afterReload).two === tBefore.two + 1, `[${tag}] S15c. reload 后 2★ 在档`);
  // 重进背包 → 材料已扣 → 「还差 N 件」
  await gotoBackpackCombat(page, tag + '/reload');
  await clearTexts(page);
  await tapVisibleById(page, 'bfilter:combat');
  const st2 = await readTexts(page);
  log(st2.some((t) => /^还差 \d+ 件1★部件/.test(t)), `[${tag}] S15d. 重进按剩余材料提示「还差 N 件」`, st2.filter((t) => /可合成|还差/.test(t)).join('|'));

  // S16 全程几何门禁 + console 干净
  await geometryGate(page, tag);
  log(errs.length === 0, `[${tag}] S16b. 全程无 pageerror/console.error`, errs.join(' | '));
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
    try {
      await runViewport(browser, vp);
    } catch (e) {
      log(false, `[${vp.w}x${vp.h}@dpr${vp.dpr}] CRASH`, e && e.stack ? String(e.stack).split('\n').slice(0, 3).join(' / ') : String(e));
    }
  }
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== FUSION FEEDBACK R2.1 E2E GATE: ${results.length - failed.length}/${results.length} PASS =====`);
  if (failed.length > 0) {
    failed.forEach((f) => console.log('FAILED: ' + f.name + ' | ' + f.detail));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error('CRASH', e && e.stack ? e.stack : e);
  process.exit(2);
});
