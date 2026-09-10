/**
 * F-GARAGE-FUSION-STAR-SELECTION-R3｜合成页星级选择 + 单星选材 —— 浏览器真实闭环 E2E（20 步 × 4 视口）
 *
 * 方案C 玩家路径（§正式交互结构）：
 *   种子：cannon 1★×6 + hammer 1★×6 + shotgun 2★×1 + smallWheel 1★×6；裸 Build（仅装 spear，种子全未装备）
 *   → Home→Garage→背包（战斗）→ 星级行动态生成（1★→2★ / 满星，无 3★）
 *   → 默认星级=最低可合成（1★）→ 卡片单星显示（2★ shotgun 在 1★ 星级下不出现）
 *   → 点卡放入 1★ 材料（槽位带 1★ 星标）→ 有材料切星级 → 轻确认（取消=完全不变 / 确认=清空并切换）
 *   → 2★ 满星查看态（纯查看，无槽/自动/合成）→ 切回 1★ → 自动放入（当前星级）
 *   → 合成（消耗 5 件 1★ → 随机 1 件 2★）→ 结果卡（不自动关/点卡不关）→ 空白关闭
 *   → 自动定位产物 2★ 满星查看态 +「新获得」→ 库存核账 → reload 保持 → 重进默认星级=最低有库存(2★)
 *
 * 手段（同 _e2e_fusion_ux_r2.cjs）：__inv.seedInventory 种子 / fillText 录制 / __h 只读诊断 / 真实像素点击。
 *
 * 视口 ×4：844×390 DPR1 / 844×390 DPR3 / 420×210 DPR1 / 1280×592 DPR1.5 —— 全跑真实 20 步闭环。
 *
 * 用法（需先 build:e2e + 起服务）：
 *   E2E_DIR=e2e node tests/_serve_pages.cjs &   （端口 8138）
 *   node tests/_e2e_fusion_star_selection_r3.cjs
 */
const { chromium } = require('playwright-core');
const BASE = 'http://127.0.0.1:8138/';
const INV_KEY = 'strongfruit.ownedParts.v2';
const BUILD_KEY = 'strongfruit.playerBuild.v1';

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' : '') + detail);
}

async function areas(page) {
  return page.evaluate(() => window.__h.getHitAreasForTest().map((a) => ({ id: a.id, x: a.x, y: a.y, w: a.w, h: a.h })));
}
function find(a, id) {
  return a.find((x) => x.id === id) || null;
}

/** 真实可见像素坐标（与 _e2e_fusion_ux_r2.cjs 同源） */
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
    return { px: r.left + drawnX * sx, py: r.top + drawnY * sy };
  }, id);
}
async function tapVisibleById(page, id) {
  const info = await pixelOf(page, id);
  if (!info) return null;
  await page.mouse.click(info.px, info.py);
  await page.waitForTimeout(200);
  return info;
}
/** 命中区右下角内缩点击（R2.2 结果卡「点空白区关闭」专用） */
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

// ---------- 只读诊断 ----------
async function hostState(page) {
  return page.evaluate(() => {
    const h = window.__h;
    return {
      star: typeof h.fusionStar === 'number' ? h.fusionStar : null,
      slots: h.fusionSlots ? h.fusionSlots.slice() : null,
      result: h.fusionResult ? { product: h.fusionResult.product, productStar: h.fusionResult.productStar } : null,
      glow: h.fusionGlow ? { defId: h.fusionGlow.defId } : null,
      newTag: h.fusionNew ? { defId: h.fusionNew.defId } : null,
    };
  });
}

// ---------- 库存 / Build 读数 ----------
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
async function seedInv(page, seed) {
  const ok = await page.evaluate((s) => {
    if (!window.__inv || typeof window.__inv.seedInventory !== 'function') return false;
    window.__inv.seedInventory(s);
    return true;
  }, seed);
  await page.waitForTimeout(150);
  return ok;
}
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
/** 真实翻页定位并点某卡 */
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

/** 真实玩家导航：首页 → 装配台 → 背包（战斗分类） */
async function gotoBackpackCombat(page, tag) {
  await tapVisibleById(page, 'home-garage');
  const B = await areas(page);
  log(!!find(B, 'garage-cat:body'), `[${tag}] N1. 进入装配台`);
  await tapVisibleById(page, 'nav:backpack');
  const C = await areas(page);
  log(!!find(C, 'bfilter:combat'), `[${tag}] N2. 进入背包（战斗分类）`);
}

/**
 * 20 步真实闭环（所有视口实跑）。
 */
async function runViewport(browser, vp) {
  const tag = `${vp.w}x${vp.h}@dpr${vp.dpr}`;
  console.log(`\n===== [fusion-star-r3] ${tag}（20 步闭环）=====`);
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

  // F0. 种子 + 裸 Build（cannon 恰 5：合成后 1★ 战斗库存清零 → reload 默认星级走规则② = 2★，确定性）
  const seeded = await seedInv(page, {
    cannon: { one: 5, two: 0 },
    shotgun: { one: 0, two: 1 },
    smallWheel: { one: 6, two: 0 },
  });
  log(seeded, `[${tag}] F0. 库存种子可用（cannon5 + shotgun2★1 + smallWheel6）`);
  await writeBareBuild(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // S1-S2. 真实玩家路径进背包战斗分类
  log(!!find(await areas(page), 'home-garage'), `[${tag}] S1. 首页含车库入口`);
  await gotoBackpackCombat(page, tag);

  // S3. 星级行动态生成：1★/2★ 命中在位、无 3★（禁止写死，读真实 MAX_STAR 范围）
  const A3 = await areas(page);
  log(!!find(A3, 'fusion-star:1') && !!find(A3, 'fusion-star:2') && !find(A3, 'fusion-star:3'), '[tag] S3. 星级行 1★/2★ 在位且无 3★'.replace('[tag]', `[${tag}]`));

  // S4. 星级 chip 文案（动态：1★ → 2★｜N 件 / 2★｜满星）
  await clearTexts(page);
  await tapVisibleById(page, 'bfilter:combat'); // 重绘当帧
  const chipTexts = await readTexts(page);
  const chip1 = chipTexts.find((t) => /^1★ → 2★｜\d+件$/.test(t));
  const chip2 = chipTexts.find((t) => /^2★｜满星$/.test(t));
  log(!!chip1 && !!chip2, `[${tag}] S4. 星级 chip 动态文案`, `${chip1 || '无1★chip'} / ${chip2 || '无2★chip'}`);

  // S5. 默认星级=1（最低可合成）：单星视图——2★-only 的 shotgun 显示弱态「可用 0」卡（其他星有库存 → 查看不隐藏）
  const A5 = await areas(page);
  await clearTexts(page);
  await tapVisibleById(page, 'bfilter:combat');
  const s5Texts = await readTexts(page);
  log(!!find(A5, 'backpack-select:shotgun') && s5Texts.some((t) => /^可用 0$/.test(t)), `[${tag}] S5. 单星视图：shotgun 1★ 弱态卡「可用 0」（不显示 2★ 数量）`);

  // S6. 点卡放入 1★ 材料：槽位对象带 star、N/5 同步
  const added = await tapCard(page, 'cannon');
  const st6 = await hostState(page);
  log(added && st6.slots && st6.slots[0] && st6.slots[0].defId === 'cannon' && st6.slots[0].star === 1, `[${tag}] S6. 点卡放入 1★ 材料（槽位 {defId,star}）`, JSON.stringify(st6.slots));

  // S7. 有材料切星级 → 轻确认层出现，材料保留（不静默清空）
  await tapVisibleById(page, 'fusion-star:2');
  const A7 = await areas(page);
  const st7 = await hostState(page);
  log(!!find(A7, 'fusion-switch-confirm') && st7.slots && st7.slots.filter(Boolean).length === 1, `[${tag}] S7. 有材料切星级 → 轻确认层 + 材料保留`, JSON.stringify(st7.slots));

  // S8. 取消 → 完全不变（星级仍 1、槽位仍在）
  await tapVisibleById(page, 'fusion-switch-cancel');
  const st8 = await hostState(page);
  log(st8.star === 1 && st8.slots && st8.slots.filter(Boolean).length === 1, `[${tag}] S8. 取消切换 → 星级/材料完全不变`, `star=${st8.star} slots=${JSON.stringify(st8.slots)}`);

  // S9. 再切 2★ → 确认 → 清空并切换；cannon 1★ 卡消失、shotgun 2★ 卡出现
  await tapVisibleById(page, 'fusion-star:2');
  await tapVisibleById(page, 'fusion-switch-confirm');
  const st9 = await hostState(page);
  const A9 = await areas(page);
  log(st9.star === 2 && st9.slots && st9.slots.every((s) => s === null), `[${tag}] S9. 确认切换 → 星级=2★ 且材料清空`, `star=${st9.star}`);
  log(!!find(A9, 'backpack-select:cannon') && !!find(A9, 'backpack-select:shotgun'), `[${tag}] S9b. 2★ 视图单星显示（cannon 1★ 弱态 / shotgun 2★ 正常）`);
  await clearTexts(page);
  await tapVisibleById(page, 'bfilter:combat');
  const s9bTexts = await readTexts(page);
  log(s9bTexts.some((t) => /^可用 0$/.test(t)) && s9bTexts.some((t) => /^可用 1$/.test(t)), `[${tag}] S9b2. 单星数量（cannon 2★ 弱态可用 0 / shotgun 可用 1）`);

  // S10. 2★ 满星查看态：纯查看，无材料槽/自动放入/合成命中
  const A10 = await areas(page);
  log(!find(A10, 'fusion-auto') && !find(A10, 'backpack-fuse') && !find(A10, 'fusion-slot:0'), `[${tag}] S10. 2★ 满星查看态（无槽/自动/合成命中）`);
  await clearTexts(page);
  await tapVisibleById(page, 'bfilter:combat');
  const fullTexts = await readTexts(page);
  log(fullTexts.some((t) => /2★满星 · 不参与合成/.test(t)), `[${tag}] S10b. 满星提示文案在位`);

  // S11. 无材料切回 1★ → 直接切换（无确认层）
  await tapVisibleById(page, 'fusion-star:1');
  const A11 = await areas(page);
  const st11 = await hostState(page);
  log(st11.star === 1 && !find(A11, 'fusion-switch-confirm'), `[${tag}] S11. 无材料切回 1★ → 直接切换（无确认层）`);

  // S12. 自动放入（当前星级 1★）→ 5 槽满 + 行内反馈
  await clearTexts(page);
  await tapVisibleById(page, 'fusion-auto');
  const st12 = await hostState(page);
  const autoTexts = await readTexts(page);
  const allStar1 = st12.slots && st12.slots.filter(Boolean).length === 5 && st12.slots.every((s) => s && s.star === 1);
  log(allStar1, `[${tag}] S12. 自动放入 5 件 1★ 材料`, JSON.stringify(st12.slots));
  log(autoTexts.some((t) => /^已自动放入5件战斗1★材料$/.test(t)), `[${tag}] S12b. 自动放入行内反馈（带分类+星级）`);

  // S13. 合成 → 结果卡（消耗 5 件 1★ / 产出 2★）
  const before = await readInvAll(page);
  await clearTexts(page);
  await tapVisibleById(page, 'backpack-fuse');
  await page.waitForTimeout(340);
  const st13 = await hostState(page);
  const resTexts = await readTexts(page);
  log(!!st13.result && !!st13.result.product, `[${tag}] S13. 结果卡出现（产物 ${st13.result ? st13.result.product : 'null'}）`);
  log(resTexts.some((t) => t === '合成成功') && resTexts.some((t) => /^消耗：5件战斗1★$/.test(t)), `[${tag}] S13b. 结果卡文案（合成成功 / 消耗：5件战斗1★）`);

  // S14. 库存核账：1★ 总数 -5、2★ 总数 +1
  const after = await readInvAll(page);
  const tB = totals(before);
  const tA = totals(after);
  const product = productOf(before, after);
  log(tA.one === tB.one - 5 && tA.two === tB.two + 1, `[${tag}] S14. 原子核账 1★-5 / 2★+1`, `${JSON.stringify(tB)} → ${JSON.stringify(tA)}`);
  log(!!product && st13.result && product === st13.result.product, `[${tag}] S14b. 产出 defId 与结果卡一致（${product}）`);

  // S15. R2.2 沿用：不自动关 + 点卡本体不关
  await page.waitForTimeout(1200);
  const st15 = await hostState(page);
  log(st15.result && st15.result.product === product, `[${tag}] S15. 静置 1.2s 结果卡仍展示（不自动关）`);
  await tapVisibleById(page, 'fusion-result-card');
  const st15b = await hostState(page);
  log(st15b.result && st15b.result.product === product, `[${tag}] S15b. 点卡本体 → 不关闭（阅读态）`);

  // S16. 空白关闭 → 自动定位产物星级（2★ 满星查看态）+ 新获得
  await tapCornerById(page, 'fusion-result-dismiss');
  const st16 = await hostState(page);
  log(st16.star === 2 && !st16.result, `[${tag}] S16. 关闭后自动切产物 2★ 查看态`, `star=${st16.star}`);
  log(st16.glow && st16.glow.defId === product && st16.newTag && st16.newTag.defId === product, `[${tag}] S16b. 新产出 glow+新获得（${product}）`);

  // S17. 产物 2★ 卡可见且「可用 N」（N=产物 2★ 库存数，动态断言避免随机产物 flaky）
  await clearTexts(page);
  await tapVisibleById(page, 'bfilter:combat');
  const s17Texts = await readTexts(page);
  const A17 = await areas(page);
  const expAvail = after[product] ? after[product].two : 0;
  const productVisible = !!find(A17, 'backpack-select:' + product);
  log(productVisible && s17Texts.some((t) => new RegExp('^可用 ' + expAvail + '$').test(t)), `[${tag}] S17. 产物 2★ 卡可见且「可用 ${expAvail}」`);

  // S18. reload → 库存保持
  const beforeReload = await readInvAll(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const afterReload = await readInvAll(page);
  log(JSON.stringify(afterReload) === JSON.stringify(beforeReload), `[${tag}] S18. reload 后库存保持`);

  // S19. 重进背包 → 默认星级=最低有库存（cannon 0 → 2★满星查看态）
  await gotoBackpackCombat(page, tag + '/reload');
  const dbg19 = await page.evaluate(() => {
    const h = window.__h;
    const inv = h.lastState ? h.lastState.inventory : null;
    const pick = {};
    for (const d of ['cannon', 'shotgun', 'spear', 'hammer']) if (inv && inv[d]) pick[d] = inv[d];
    return { star: h.fusionStar, byCat: h.fusionStarByCat, pick };
  });
  console.log('[dbg19]', JSON.stringify(dbg19));
  const st19 = await hostState(page);
  log(st19.star === 2, `[${tag}] S19. reload 后默认星级=最低有库存（2★）`, `star=${st19.star}`);

  // S20. 全程无 pageerror / console.error
  log(errs.length === 0, `[${tag}] S20. 全程无 pageerror/console.error`, errs.join(' | '));
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
  console.log(`\n===== FUSION STAR SELECTION R3 E2E GATE: ${results.length - failed.length}/${results.length} PASS =====`);
  if (failed.length > 0) {
    failed.forEach((f) => console.log('FAILED: ' + f.name + ' | ' + f.detail));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error('CRASH', e && e.stack ? e.stack : e);
  process.exit(2);
});
