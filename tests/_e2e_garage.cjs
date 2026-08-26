/**
 * F-GARAGE-BUILD-BOARD-P0｜真实浏览器点击路径门禁（Must#1/#2/#4/#10——单屏装配板 + 真实指针管线）
 *
 * 在真实玩家模式页面（dist-e2e 探针构建，含 window.__h）上，用真实指针事件验证单屏装配板的
 * 点击路径（不走 unit 的 stub bindPointer，而是走过平台 bindPointer → host.handlePointer）：
 * A. 首页仅 home-garage，未进入时 build board 不显示（garage-cat 不存在）；
 * B. 点 home-garage → 4 个常驻分类 tab（garage-cat:body/move/weapon/gadget）出现 + 唯一返回 nav:home + 无 panel-back（Must#1/#2）；
 * C. 点 garage-cat:weapon → 武器分类出现挂点 chip（garage-slot:）与部件卡（opt:）同屏（Must#4 单屏）；
 * D. 点 garage-cat:body → 车身分类无挂点 chip（仅车身选项卡 opt:）；
 * E. 点 garage-cat:gadget → 辅助分类出现挂点 chip（garage-slot:）；
 * F. 点 nav:home → 回到首页（home-garage 重现，garage-cat 消失，Must#1 唯一返回）。
 * 全程无 pageerror / console.error（真实指针管线不抛，Must#10）。
 * 覆盖 844×390 / 420×210（手机横屏矩阵）。
 * 用法：先 E2E_DIR=e2e node tests/_serve_pages.cjs & 再 node tests/_e2e_garage.cjs
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

/** 读取全部命中区 */
async function areas(page) {
  return page.evaluate(() => window.__h.getHitAreasForTest().map((a) => ({ id: a.id, x: a.x, y: a.y, w: a.w, h: a.h })));
}
function find(areas, id) {
  return areas.find((a) => a.id === id) || null;
}
function prefixed(areas, p) {
  return areas.filter((a) => a.id.startsWith(p));
}

/** 真实指针点击某个精确 hit id（client 坐标 = canvas[1] boundingBox + 逻辑坐标映射） */
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

async function runViewport(browser, vp) {
  console.log(`\n===== viewport ${vp.w}x${vp.h} dpr${vp.dpr} =====`);
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => { errs.push('pageerror:' + e.message); log(false, `[${vp.w}x${vp.h}] pageerror`, e.message); });
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) {
      errs.push('console:' + m.text());
      log(false, `[${vp.w}x${vp.h}] console.error`, m.text());
    }
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);

  // A. 首页：home-garage 存在；未进入装配台时 garage-cat 不存在
  let A = await areas(page);
  log(!!find(A, 'home-garage'), `[${vp.w}x${vp.h}] A. 首页含 home-garage 入口`, '');
  log(prefixed(A, 'garage-cat:').length === 0, `[${vp.w}x${vp.h}] A. 首页未显示装配台（无 garage-cat）`, `n=${prefixed(A, 'garage-cat:').length}`);

  // B. 点 home-garage → 4 个分类 tab + nav:home + 无 panel-back
  const g = await tapById(page, 'home-garage');
  log(!!g, `[${vp.w}x${vp.h}] B. 点击 home-garage 命中`, '');
  let B = await areas(page);
  const tabs = ['garage-cat:body', 'garage-cat:move', 'garage-cat:weapon', 'garage-cat:gadget'];
  const missingTabs = tabs.filter((t) => !find(B, t));
  log(missingTabs.length === 0, `[${vp.w}x${vp.h}] B. 4 个常驻分类 tab 出现`, missingTabs.length ? '缺失:' + missingTabs.join(',') : 'body/move/weapon/gadget');
  log(!!find(B, 'nav:home'), `[${vp.w}x${vp.h}] B. 唯一返回 nav:home 存在（Must#1）`, '');
  log(!find(B, 'panel-back'), `[${vp.w}x${vp.h}] B. 装配台无 panel-back（Must#1）`, '');

  // C. 点 garage-cat:weapon → 挂点 chip + 部件卡同屏（Must#4 单屏）
  await tapById(page, 'garage-cat:weapon');
  let C = await areas(page);
  log(prefixed(C, 'garage-slot:').length >= 1, `[${vp.w}x${vp.h}] C. 武器分类挂点 chip 出现`, `n=${prefixed(C, 'garage-slot:').length}`);
  log(prefixed(C, 'opt:').length >= 1, `[${vp.w}x${vp.h}] C. 武器分类部件卡同屏`, `n=${prefixed(C, 'opt:').length}`);

  // D. 点 garage-cat:body → 车身分类仅 1 个车身 chip（garage-slot:body，无其他硬点）+ 部件卡同屏
  await tapById(page, 'garage-cat:body');
  let D = await areas(page);
  const bodyChips = prefixed(D, 'garage-slot:');
  log(bodyChips.length === 1 && !!find(D, 'garage-slot:body'), `[${vp.w}x${vp.h}] D. 车身分类仅 1 个车身 chip`, `n=${bodyChips.length} ids=${bodyChips.map((c) => c.id).join(',')}`);
  log(prefixed(D, 'opt:').length >= 1, `[${vp.w}x${vp.h}] D. 车身分类部件卡存在`, `n=${prefixed(D, 'opt:').length}`);

  // E. 点 garage-cat:gadget → 挂点 chip 出现
  await tapById(page, 'garage-cat:gadget');
  let E = await areas(page);
  log(prefixed(E, 'garage-slot:').length >= 1, `[${vp.w}x${vp.h}] E. 辅助分类挂点 chip 出现`, `n=${prefixed(E, 'garage-slot:').length}`);

  // F. 点 nav:home → 回到首页（home-garage 重现，garage-cat 消失）
  await tapById(page, 'nav:home');
  let F = await areas(page);
  log(!!find(F, 'home-garage'), `[${vp.w}x${vp.h}] F. 点击 nav:home 回到首页`, '');
  log(prefixed(F, 'garage-cat:').length === 0, `[${vp.w}x${vp.h}] F. 返回后装配台关闭（无 garage-cat）`, `n=${prefixed(F, 'garage-cat:').length}`);

  log(errs.length === 0, `[${vp.w}x${vp.h}] 全程无 pageerror/console.error（Must#10 真实管线不抛）`, errs.join(' | '));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const viewports = [
    { w: 844, h: 390, dpr: 1 },
    { w: 420, h: 210, dpr: 1 },
  ];
  for (const vp of viewports) {
    await runViewport(browser, vp);
  }
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== GARAGE BUILD BOARD E2E GATE: ${results.length - failed.length}/${results.length} PASS =====`);
  if (failed.length > 0) {
    failed.forEach((f) => console.log('FAILED: ' + f.name + ' | ' + f.detail));
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error('CRASH', e.message);
  process.exitCode = 2;
});
