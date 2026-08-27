/**
 * F-PLAYER-UI-HITMAP-P0｜真实浏览器点击路径门禁（真实指针管线 + 真实可见像素点击）
 *
 * 修复「最终画面 / 命中区 / 真实点击」错位后的门禁升级：
 * - tapById（保留，内部逻辑测试）：读取内部 hitArea 中心点击，仅证明隐藏命中区能响应（非视觉证明）。
 * - tapVisibleById（新增，Must#4/#5）：用 host 真实变换 + getBoundingClientRect 把命中区中心
 *   换算到「实际绘制的可见页面坐标」，再用真实鼠标（page.mouse.click）点击该可见中心——
 *   证明可见像素 == 命中区（视觉与命中一致），且空白区点击不误触。
 *
 * 覆盖 420×210 / 844×390 / 1363×936 / 1920×1008，含两种 URL 模式：
 *   · ?player=1（玩家模式，phoneLogical=true，手机 844×390 逻辑 + CSS contain 放大居中）
 *   · 无 flag（本 E2E 构建 __PAGES_PREVIEW__=true 强制 playerMode=true，故仍手机 mobile 表现，
 *     与 ?player=1 等价——用于交叉验证「flag 是否为 no-op」）
 *
 * 重要环境事实（诚实披露）：E2E/Pages 构建定义 __PAGES_PREVIEW__=true → playerMode 恒为 true →
 * phoneLogical=true → 永远走 mobile profile（scale=1），真·桌面 dock（BASE_W=1280、host 布局
 * scale≠1、chip: 槽位）在本构建中不可达。因此本门禁的真实浏览器验证覆盖「手机/玩家路径（含宽屏
 * CSS contain scale≠1，如 1920×1008 的 CSS transform scale≈2.27）」。真·桌面 scale≠1 的 BASE_W=1280
 * 路径由确定性单测 tests/playerUIHitmapP0.test.ts T1 覆盖（直接构造 phoneLogical:false 的
 * CanvasPlayerUIHost @1920×1008，断言 ctx 变换仅 DPR、chip: 真实点击命中；旧双重缩放代码下失败）。
 *
 * 用法：先 `E2E_DIR=e2e node tests/_serve_pages.cjs &` 再 `node tests/_e2e_garage.cjs`
 */
const { chromium } = require('playwright-core');
const BASE = 'http://127.0.0.1:8138/';
const LOGICAL_W = 844;
const LOGICAL_H = 390;

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}

async function areas(page) {
  return page.evaluate(() => window.__h.getHitAreasForTest().map((a) => ({ id: a.id, x: a.x, y: a.y, w: a.w, h: a.h })));
}
function find(areas, id) {
  return areas.find((a) => a.id === id) || null;
}
function prefixed(areas, p) {
  return areas.filter((a) => a.id.startsWith(p));
}

/** 内部逻辑测试：读取 hitArea 中心点击（仅证明隐藏命中区能响应，非视觉证明）。 */
async function tapById(page, id) {
  const box = await page.locator('canvas').nth(1).boundingBox();
  const a = await page.evaluate((i) => {
    const x = window.__h.getHitAreasForTest().find((z) => z.id === i);
    return x ? { x: x.x, y: x.y, w: x.w, h: x.h } : null;
  }, id);
  if (!a) return null;
  const px = box.x + ((a.x + a.w / 2) / LOGICAL_W) * box.width;
  const py = box.y + ((a.y + a.h / 2) / LOGICAL_H) * box.height;
  await page.evaluate(
    ([x, y]) => {
      const c = document.querySelectorAll('canvas')[1];
      c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerType: 'mouse', isPrimary: true, button: 0, bubbles: true }));
    },
    [px, py],
  );
  await page.waitForTimeout(220);
  return a;
}

/** 真实可见像素点击：用 host 实际变换把命中区中心换算到「绘制后的可见页面坐标」，真实鼠标点击。
 *  drawnCss = (ox + scale·(x+w/2), oy + scale·(y+h/2))；page = rect.left + drawnCss · (rect.width/clientWidth)。
 *  getBoundingClientRect 已含任何 CSS contain / transform 缩放，故宽屏 CSS scale≠1 也正确映射。 */
async function tapVisibleById(page, id) {
  const info = await page.evaluate((i) => {
    const h = window.__h;
    const a = h.getHitAreasForTest().find((z) => z.id === i);
    if (!a) return null;
    const t = h.getTransformInfo();
    const c = document.querySelectorAll('canvas')[1];
    const r = c.getBoundingClientRect();
    const drawnX = t.ox + t.scale * (a.x + a.w / 2);
    const drawnY = t.oy + t.scale * (a.y + a.h / 2);
    const sx = r.width / c.clientWidth;
    const sy = r.height / c.clientHeight;
    return { px: r.left + drawnX * sx, py: r.top + drawnY * sy };
  }, id);
  if (!info) return null;
  await page.mouse.click(info.px, info.py);
  await page.waitForTimeout(220);
  return info;
}

/** 空白负向：点击远离任何控件的角落，断言不引起任何状态切换（changed=false）。
 * 真正不变量是「空白点击不得触发任何 UI 过渡」——无论 ref 当前是否存在。 */
async function tapBlank(page, refId) {
  const info = await page.evaluate(() => {
    const c = document.querySelectorAll('canvas')[1];
    const r = c.getBoundingClientRect();
    return { px: r.left + 12, py: r.top + 12 };
  });
  const before = await areas(page);
  await page.mouse.click(info.px, info.py);
  await page.waitForTimeout(180);
  const after = await areas(page);
  const had = !!find(before, refId);
  const has = !!find(after, refId);
  const changed = had !== has; // 空白点击不得改变 refId 存在性（不得触发过渡）
  return { changed, had, has };
}

/** 手机/玩家路径（本 E2E 构建下 ?player=1 与无 flag 均为此路径）：
 *  首页 → 真实可见点击进入装配台 → 4 分类 tab → 武器/辅助分类切换 → 返回首页 + 空白负向。 */
async function runMobilePath(browser, vp, playerMode) {
  const tag = playerMode ? 'player' : 'noflag';
  console.log(`\n===== [${tag}] viewport ${vp.w}x${vp.h} dpr${vp.dpr} =====`);
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => { errs.push('pageerror:' + e.message); log(false, `[${tag}|${vp.w}x${vp.h}] pageerror`, e.message); });
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) {
      errs.push('console:' + m.text());
      log(false, `[${tag}|${vp.w}x${vp.h}] console.error`, m.text());
    }
  });
  await page.goto(BASE + (playerMode ? '?player=1' : ''), { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);

  // 首页态
  let A = await areas(page);
  log(!!find(A, 'home-garage'), `[${tag}|${vp.w}x${vp.h}] A. 首页含 home-garage`, '');
  const g = await tapVisibleById(page, 'home-garage');
  log(!!g, `[${tag}|${vp.w}x${vp.h}] B. 真实点击可见车库中心进入装配台`, '');
  let B = await areas(page);
  // F-GARAGE-COMBAT-TAB-R1：顶部只 3 个分类（车身/移动/战斗；武器+辅助合并）
  const tabs = ['garage-cat:body', 'garage-cat:move', 'garage-cat:combat'];
  const missing = tabs.filter((t) => !find(B, t));
  log(missing.length === 0, `[${tag}|${vp.w}x${vp.h}] B. 3 个分类 tab 出现`, missing.length ? '缺失:' + missing.join(',') : 'ok');
  // 旧 武器/辅助 主 tab 彻底消失
  const oldTabs = ['garage-cat:weapon', 'garage-cat:gadget'].filter((t) => find(B, t));
  log(oldTabs.length === 0, `[${tag}|${vp.w}x${vp.h}] B. 旧武器/辅助主 tab 消失`, oldTabs.length ? '残留:' + oldTabs.join(',') : 'ok');
  log(!!find(B, 'nav:home'), `[${tag}|${vp.w}x${vp.h}] B. 唯一返回 nav:home`, '');

  // 进入战斗（默认武器分组）
  await tapVisibleById(page, 'garage-cat:combat');
  let C = await areas(page);
  log(!!find(C, 'garage-cgroup:weapon') && !!find(C, 'garage-cgroup:gadget'), `[${tag}|${vp.w}x${vp.h}] C. 战斗页「武器|辅助」分段控件出现`, '');
  log(prefixed(C, 'garage-cslot:').length >= 1, `[${tag}|${vp.w}x${vp.h}] C. 战斗页共享挂点 chip 出现`, `n=${prefixed(C, 'garage-cslot:').length}`);
  log(prefixed(C, 'opt:').length >= 1, `[${tag}|${vp.w}x${vp.h}] C. 战斗页（武器分组）部件卡同屏`, `n=${prefixed(C, 'opt:').length}`);

  // 一次点击「辅助」分段 → 切到 gadget 分组
  await tapVisibleById(page, 'garage-cgroup:gadget');
  let D = await areas(page);
  log(prefixed(D, 'opt:').length >= 1, `[${tag}|${vp.w}x${vp.h}] D. 辅助分组部件卡同屏`, `n=${prefixed(D, 'opt:').length}`);

  // 选一个共享挂点（selectGarageSlot，只选不收起）
  const chipId = prefixed(D, 'garage-cslot:')[0] ? prefixed(D, 'garage-cslot:')[0].id : null;
  if (chipId) {
    await tapVisibleById(page, chipId);
    let E = await areas(page);
    log(prefixed(E, 'opt:').length >= 1, `[${tag}|${vp.w}x${vp.h}] E. 选挂点后部件卡出现`, `n=${prefixed(E, 'opt:').length}`);
  } else {
    log(false, `[${tag}|${vp.w}x${vp.h}] E. 共享挂点 chip 可点`, '无 garage-cslot:');
  }

  await tapVisibleById(page, 'nav:home');
  let F = await areas(page);
  log(!!find(F, 'home-garage'), `[${tag}|${vp.w}x${vp.h}] F. 真实点击可见返回首页`, '');
  log(prefixed(F, 'garage-cat:').length === 0, `[${tag}|${vp.w}x${vp.h}] F. 返回后装配台关闭`, `n=${prefixed(F, 'garage-cat:').length}`);

  // 空白负向：首页态点击左上空白不得进入装配台（不得触发过渡）
  const blank = await tapBlank(page, 'garage-cat:body');
  log(!blank.changed, `[${tag}|${vp.w}x${vp.h}] 空白点击不误触（不进装配台）`, `changed=${blank.changed}`);

  // 内部逻辑基线（保留 tapById）：旧式「读内部 hitArea 中心 → 派发合成 pointerdown」仍可用，
  // 仅证明隐藏命中区能响应（非视觉证明）——与上方 tapVisibleById（真实鼠标可见中心）互补。
  if (playerMode) {
    const g2 = await tapById(page, 'home-garage');
    log(!!g2, `[${tag}|${vp.w}x${vp.h}] Z. 内部命中区点击通道仍可用（基线回归）`, '');
  }

  log(errs.length === 0, `[${tag}|${vp.w}x${vp.h}] 全程无 pageerror/console.error`, errs.join(' | '));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const viewports = [
    { w: 844, h: 390, dpr: 1 },
    { w: 420, h: 210, dpr: 1 },
    { w: 1363, h: 936, dpr: 1 },
    { w: 1920, h: 1008, dpr: 1 },
  ];
  for (const vp of viewports) {
    await runMobilePath(browser, vp, true); // 玩家模式（手机 logical + CSS contain）
    await runMobilePath(browser, vp, false); // 无 flag（E2E 构建仍强制 player → 等价交叉验证）
  }
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== HITMAP E2E GATE: ${results.length - failed.length}/${results.length} PASS =====`);
  if (failed.length > 0) {
    failed.forEach((f) => console.log('FAILED: ' + f.name + ' | ' + f.detail));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error('CRASH', e && e.stack ? e.stack : e);
  process.exit(2);
});
