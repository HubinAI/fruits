/**
 * GARAGE-V2-UX-RETURN-BAG-FUSE-R1｜正式页 Garage 2.0 交互结构端到端验收（真实浏览器）。
 *
 * 上一版（EQUIP/FUSE/CUTOVER 三次切片）只断言「节点存在」⇒ 返回按钮虽然在 DOM 里，
 * 实际被顶到 y≈1198（画面 844 之外）依旧 PASS —— 假绿。本版按 Queue 验收 ① 重写：
 *
 *   ① **真实矩形**：390×844 与 1440×900（逻辑 390 缩放）下，[data-g2-back] 的
 *      getBoundingClientRect 必须**完整落在主容器内**，且用真实鼠标点击其中心
 *      （**不用** Playwright 的自动滚动 click，那会把屏外元素滚进来再点 ⇒ 又假绿）
 *      必须回到首页；背包滚到底后 footer 矩形**位置不变**。
 *   ② 两种浏览器宽度下背包都是 **4 列**、图标可见面积 ≥85% 格宽（实测值打印）。
 *   ③ 轮组弹窗：前/后轮 = 独立二选一；底部**唯一**主操作（取消 / 装备·替换 各 1 个）；
 *      点前/后槽时目标正确初始化；取消零写盘；装备后落盘 + 刷新有效。
 *   ④ 合成 = 同页模式：选主件 → 自动补 4 件（视觉标「料」）→ 下一品质预览 →
 *      唯一【确认五合一】→ 5 合 1；返回零写盘；4/5 / 锁定 / Body / 彩封顶 限制不变。
 *   ⑤ 默认入口 / 旧 legacy 入口 / 开始冒险 href 全部未变。
 *
 * 纪律：真实浏览器（playwright-core，项目 bundled chromium）、真实 localStorage 逐字节
 * 取证、探针只读。**不删除任何核心业务断言求绿**，只按新结构（同页合成）改写定位方式。
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright-core');
const { launchBrowser } = require('./_browser_launch.cjs');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const SHOT_DIR = path.join(__dirname, '..', 'docs', 'garage-v2', 'ux-r1');
const PORT = 8742;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = urlPath.replace(/^\//, '') || 'home.html';
    const abs = path.join(ROOT, rel);
    if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      res.writeHead(404); res.end('no'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
    res.end(fs.readFileSync(abs));
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

/** 正式存档 dump（独立取证：直接读 localStorage，不走页面探针）。 */
async function dumpStore(page) {
  return page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out[k] = localStorage.getItem(k);
    }
    return out;
  });
}

/** 让页面把某 defId 堆叠加到正式库存（写正式 ownedParts key，等价真实玩家拥有）。 */
async function grantParts(page, defId, star, n) {
  await page.evaluate(({ defId, star, n }) => {
    const KEY = 'strongfruit.ownedParts.v2';
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    const bucket = star === 1 ? 'one' : star === 2 ? 'two' : 'three';
    raw[defId] = raw[defId] || {};
    raw[defId][bucket] = (raw[defId][bucket] || 0) + n;
    localStorage.setItem(KEY, JSON.stringify(raw));
  }, { defId, star, n });
  await page.reload({ waitUntil: 'networkidle' });
  await openV2(page);
}

async function openV2(page) {
  await page.evaluate(() => {
    const btn = document.querySelector('[data-ph-action="open-garage"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(140);
}

async function probeV2(page) {
  return page.evaluate(() => window.__PRODUCTHOME__ && window.__PRODUCTHOME__.probe().garageV2);
}

/** 真实矩形（视口坐标，含浏览器缩放效果）。 */
async function rect(page, sel) {
  return page.evaluate((s) => {
    const n = document.querySelector(s);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  }, sel);
}

/** 一个矩形是否**完整**落在另一个矩形内（容差 0.6px：缩放下的亚像素）。 */
function inside(inner, outer, tol = 0.6) {
  if (!inner || !outer) return false;
  return (
    inner.top >= outer.top - tol &&
    inner.bottom <= outer.bottom + tol &&
    inner.left >= outer.left - tol &&
    inner.right <= outer.right + tol
  );
}

/** 真实鼠标点击矩形中心（**不**依赖 Playwright 自动滚动 ⇒ 屏外元素点不中就是失败）。 */
async function realClickRect(page, r) {
  if (!r) return false;
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
  return true;
}

(async () => {
  const server = await startServer();
  const browser = await launchBrowser(chromium);
  let pass = 0;
  const fails = [];
  const ok = (cond, tag) => { if (cond) { pass++; console.log(`PASS ${tag}`); } else { fails.push(tag); console.log(`FAIL ${tag}`); } };

  const url = `http://127.0.0.1:${PORT}/home.html`;

  /* ══════════════════════ ① 版面 / 返回按钮（两种宽度） ══════════════════════ */

  /**
   * 每种视口都跑一遍：几何断言 + 真实点击 + 背包滚到底 footer 不位移 + 4 列/图标面积。
   * @param tag 断言前缀
   */
  async function layoutChecks(ctx, tag, shot) {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await openV2(page);

    const p0 = await probeV2(page);
    ok(p0 && p0.mounted === true && p0.slots === 5, `${tag}1 挂载 + 五槽存在（mode=${p0 && p0.mode}）`);
    ok(p0 && p0.gridTextFree === true, `${tag}2 背包格零名字/数量/星级文本`);
    ok(p0 && Number(p0.fuseDot ?? 0) === p0.fuseReadyGroups, `${tag}3 合成红点数值 = 真实可合成组数`);

    // —— ① 返回按钮：真实矩形必须完整在主容器内（旧版这里 y≈1198 > 844 ⇒ 必红）
    const main = await rect(page, '.ph-main-garage');
    const back = await rect(page, '[data-g2-back]');
    const screen = await rect(page, '[data-ph-screen]');
    ok(!!back, `${tag}4 返回按钮存在（几何断言的前提）`);
    ok(inside(back, main), `${tag}5 返回按钮矩形完整落在主容器内（back=${JSON.stringify(back && { top: Math.round(back.top), bottom: Math.round(back.bottom) })} / main.bottom=${main && Math.round(main.bottom)}）`);
    ok(inside(back, screen), `${tag}6 返回按钮矩形完整落在 390×844 逻辑画面内`);
    ok(!!back && back.h >= 44, `${tag}7 返回按钮触控高度 ≥44px（实测 ${back && Math.round(back.h)}）`);

    // —— ① 上方无效空白：页面级 header 在 V2 内不再占位（旧版白占 59~62px）
    const headerH = await page.evaluate(() => {
      const h = document.querySelector('.ph-header');
      if (!h) return 0;
      return getComputedStyle(h).display === 'none' ? 0 : h.getBoundingClientRect().height;
    });
    ok(headerH === 0, `${tag}8 上方无效空白已消除（header 高度 ${Math.round(headerH)}px）`);
    ok(!!main && Math.abs(main.top) <= 1, `${tag}9 主容器从画面顶端开始（main.top=${main && Math.round(main.top)}）`);

    // —— ② 4 列 + 图标面积
    const grid = await page.evaluate(() => {
      const g = document.querySelector('[data-g2-grid]');
      if (!g) return null;
      const cs = getComputedStyle(g);
      const cols = cs.gridTemplateColumns.trim().split(/\s+/).length;
      const cell = g.querySelector('.g2-cell');
      const icon = cell && cell.querySelector('.ph-part-icon');
      const cw = cell ? cell.getBoundingClientRect().width : 0;
      const iw = icon ? icon.getBoundingClientRect().width : 0;
      return { cols, cellW: +cw.toFixed(1), iconW: +iw.toFixed(1), ratio: cw ? +(iw / cw).toFixed(3) : 0 };
    });
    ok(!!grid && grid.cols === 4, `${tag}10 背包恒 4 列（实测 ${grid && grid.cols} 列）`);
    ok(!!grid && grid.cellW >= 80, `${tag}11 单格足够大（实测 ${grid && grid.cellW}px 逻辑像素）`);
    ok(!!grid && grid.ratio >= 0.85, `${tag}12 图标可见面积 ≥85% 格宽（实测 ${grid && grid.ratio}）`);

    // —— ① 背包滚到底：footer 位置不变，返回按钮仍在画面内
    const footBefore = await rect(page, '[data-g2-foot]');
    const scrolled = await page.evaluate(() => {
      const bag = document.querySelector('[data-g2-bag]');
      if (!bag) return null;
      bag.scrollTop = bag.scrollHeight;
      return { scrollTop: bag.scrollTop, scrollH: bag.scrollHeight, clientH: bag.clientHeight, overflowY: getComputedStyle(bag).overflowY };
    });
    await page.waitForTimeout(60);
    const footAfter = await rect(page, '[data-g2-foot]');
    const backAfter = await rect(page, '[data-g2-back]');
    ok(!!scrolled && scrolled.scrollH > scrolled.clientH, `${tag}13 背包自身可滚（scrollH=${scrolled && scrolled.scrollH} > clientH=${scrolled && scrolled.clientH}）`);
    ok(!!scrolled && scrolled.scrollTop > 0, `${tag}14 背包真的滚到了底部（scrollTop=${scrolled && scrolled.scrollTop}）`);
    ok(!!footBefore && !!footAfter && Math.abs(footBefore.top - footAfter.top) < 0.6, `${tag}15 滚到底 footer **原位不动**（before=${footBefore && Math.round(footBefore.top)} after=${footAfter && Math.round(footAfter.top)}）`);
    ok(inside(backAfter, main), `${tag}16 滚到底返回按钮仍在主容器内`);

    // —— ② 截图（正常速度，未改任何动画/延时）：装备页（先回滚到顶部，交验收看的是常规起点）
    if (shot) {
      await page.evaluate(() => {
        const bag = document.querySelector('[data-g2-bag]');
        if (bag) bag.scrollTop = 0;
      });
      await page.waitForTimeout(60);
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(SHOT_DIR, shot) });
    }

    // —— ① 真实鼠标点击返回（不自动滚动）→ 必须回首页
    await realClickRect(page, backAfter);
    await page.waitForTimeout(200);
    const view = await page.evaluate(() => window.__PRODUCTHOME__.probe().view);
    ok(view === 'home', `${tag}17 真实鼠标点返回 → 回首页（view=${view}）`);
    const headerBack = await page.evaluate(() => {
      const h = document.querySelector('.ph-header');
      return h ? getComputedStyle(h).display !== 'none' && h.getBoundingClientRect().height > 0 : false;
    });
    ok(headerBack, `${tag}18 回首页后页面 header 原样恢复（冻结首页布局）`);
    await page.close();
  }

  {
    const ctx390 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await layoutChecks(ctx390, 'L390-', 'equip-390x844.png');
    await ctx390.close();

    const ctxDesk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await layoutChecks(ctxDesk, 'L1440-', null);
    await ctxDesk.close();
  }

  /* ══════════════════════ ③ 换装 / 前后轮目标 ══════════════════════ */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await openV2(page);

  /* ── B.【取消】零写盘 ── */
  const before = await dumpStore(page);
  await page.evaluate(() => document.querySelector('[data-g2-cell]')?.click());
  await page.waitForTimeout(80);
  ok(await page.evaluate(() => !!document.querySelector('[data-g2-modal="compare"]')), 'B1 点背包格弹出对比弹窗');
  await page.evaluate(() => document.querySelector('[data-g2-action="cancel"]')?.click());
  await page.waitForTimeout(80);
  ok(JSON.stringify(before) === JSON.stringify(await dumpStore(page)), 'B2 取消后正式存档逐字节不变（零写盘）');

  /* ── B3. 彩品质（封顶）件：**能穿戴**（封顶只限制合成，不限制穿戴） ── */
  await page.evaluate(() => {
    localStorage.setItem('strongfruit.garageV2Ledger.v1', JSON.stringify({
      __v: 1, version: 2, consumed: {},
      products: [{ defId: 'cannon', quality: 'chrome', seq: 1 }],
    }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await openV2(page);
  const chromeClicked = await page.evaluate(() => {
    const c = document.querySelector('[data-g2-cell^="qv2:cannon:chrome"]');
    if (c) c.click();
    return !!c;
  });
  ok(chromeClicked, 'B3 彩品质件单件格可见并可点');
  if (chromeClicked) {
    await page.waitForTimeout(90);
    const chromeModal = await page.evaluate(() => ({
      disabled: document.querySelector('[data-g2-action="equip"]')?.disabled ?? null,
      warn: document.querySelector('[data-g2-warn]')?.textContent ?? null,
    }));
    ok(chromeModal.disabled === false, `B3b 彩封顶件【装备】如实可用（不再被 lockedReason 误禁）：${chromeModal.warn}`);
    const beforeChrome = await dumpStore(page);
    await page.evaluate(() => document.querySelector('[data-g2-action="equip"]')?.click());
    await page.waitForTimeout(160);
    const pChrome = await probeV2(page);
    ok(pChrome && pChrome.functionalQualities?.frontMass === 'chrome',
      `B3c 彩品质炮真实上身（quality=${pChrome && pChrome.functionalQualities && pChrome.functionalQualities.frontMass}）`);
    ok(JSON.stringify(beforeChrome) !== JSON.stringify(await dumpStore(page)), 'B3d 穿戴确实落盘（写的是正式存档）');
  }

  /* ── B4. 结构性装不上的件：主操作如实禁用 + 点它零写盘 ── */
  await page.evaluate(() => {
    localStorage.setItem('strongfruit.garageV2Ledger.v1', JSON.stringify({
      __v: 1, version: 2, consumed: {},
      products: [{ defId: 'pushRod', quality: 'green', seq: 1 }],
    }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await openV2(page);
  const prClicked = await page.evaluate(() => {
    const c = document.querySelector('[data-g2-cell^="qv2:pushRod:green"]');
    if (c) c.click();
    return !!c;
  });
  if (prClicked) {
    await page.waitForTimeout(90);
    const prModal = await page.evaluate(() => ({
      disabled: document.querySelector('[data-g2-action="equip"]')?.disabled ?? null,
      warn: document.querySelector('[data-g2-warn]')?.textContent ?? null,
    }));
    ok(prModal.disabled === true, `B4 非推进类 Gadget 品质件：主操作如实禁用（原因：${prModal.warn}）`);
    const beforeIllegal = await dumpStore(page);
    await page.evaluate(() => document.querySelector('[data-g2-action="equip"]')?.click());
    await page.waitForTimeout(90);
    ok(JSON.stringify(beforeIllegal) === JSON.stringify(await dumpStore(page)), 'B4b 非法件零写盘（结构性装不上）');
    await page.evaluate(() => document.querySelector('[data-g2-action="cancel"]')?.click());
    await page.waitForTimeout(70);
  } else {
    ok(false, 'B4 非推进类 Gadget 品质件单件格可见（前置失败）');
  }
  // 清掉 B3/B4 的账本与 Build（避免留下幽灵绑定，回到干净起点）
  await page.evaluate(() => {
    localStorage.setItem('strongfruit.garageV2Ledger.v1', JSON.stringify({ __v: 1, version: 2, consumed: {}, products: [] }));
    localStorage.removeItem('strongfruit.playerBuild.v1');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await openV2(page);

  /* ── C. 库存新增 largeWheel → 弹窗结构 + 前后轮目标 + 装备落盘 ── */
  await grantParts(page, 'largeWheel', 1, 1);
  const cells = await page.evaluate(() => [...document.querySelectorAll('[data-g2-cell]')].map((c) => ({
    id: c.getAttribute('data-g2-cell'),
    kind: c.getAttribute('data-g2-slot-kind'),
  })));
  const lwCell = cells.find((c) => c.id.startsWith('q1:largeWheel'));
  ok(!!lwCell, 'C1 库存新增 largeWheel 单件格可见');
  if (lwCell) {
    await page.evaluate((id) => document.querySelector(`[data-g2-cell="${id}"]`).click(), lwCell.id);
    await page.waitForTimeout(90);
    // ④ 二选一存在 + 默认目标 = 后轮（背包格入口语义），底部只有两个动作
    const modalShape = await page.evaluate(() => {
      const card = document.querySelector('[data-g2-modal]');
      const actions = card ? [...card.querySelectorAll('[data-g2-action]')].map((b) => b.getAttribute('data-g2-action')) : [];
      return {
        targets: card ? [...card.querySelectorAll('[data-g2-target]')].map((b) => ({
          t: b.getAttribute('data-g2-target'),
          on: b.getAttribute('data-g2-target-on') === 'true',
        })) : [],
        actions,
      };
    });
    ok(modalShape.targets.length === 2 && modalShape.targets.some((x) => x.t === 'front') && modalShape.targets.some((x) => x.t === 'rear'),
      `C2 前后轮 = 独立二选一（${JSON.stringify(modalShape.targets)}）`);
    ok(modalShape.targets.find((x) => x.on && x.t === 'rear'), 'C3 背包格入口默认目标 = 后轮');
    ok(modalShape.actions.filter((a) => a === 'equip').length === 1 && modalShape.actions.filter((a) => a === 'cancel').length === 1 && modalShape.actions.length === 2,
      `C4 底部唯一主操作：取消 + 装备/替换（实际 ${JSON.stringify(modalShape.actions)}）`);

    // 切到前轮
    await page.evaluate(() => document.querySelector('[data-g2-target="front"]')?.click());
    await page.waitForTimeout(70);
    const pFront = await probeV2(page);
    ok(pFront && pFront.movementTarget === 'front', 'C5 切目标后 movementTarget=front（并保持）');
    ok(modalShape.targets.length === 2, 'C6 目标二选一恒存在（不做四按钮并列）');

    // 取消：零写盘
    const beforeCancel = await dumpStore(page);
    await page.evaluate(() => document.querySelector('[data-g2-action="cancel"]')?.click());
    await page.waitForTimeout(80);
    ok(JSON.stringify(beforeCancel) === JSON.stringify(await dumpStore(page)), 'C7 取消零写盘（弹窗内改目标也不写）');

    // 重新打开并真的装备到前轮
    await page.evaluate((id) => document.querySelector(`[data-g2-cell="${id}"]`).click(), lwCell.id);
    await page.waitForTimeout(80);
    await page.evaluate(() => document.querySelector('[data-g2-target="front"]')?.click());
    await page.waitForTimeout(60);
    await page.evaluate(() => document.querySelector('[data-g2-action="equip"]')?.click());
    await page.waitForTimeout(140);
    const p1 = await probeV2(page);
    ok(p1 && p1.frontDef === 'largeWheel', 'C8 确认装备：前轮=largeWheel 落盘并重读');
    ok(p1 && (p1.rearDef === null || p1.rearDef === 'smallWheel'), 'C9 后轮不受影响（保持缺省/原值）');
    await page.reload({ waitUntil: 'networkidle' });
    await openV2(page);
    const p2 = await probeV2(page);
    ok(p2 && p2.frontDef === 'largeWheel', 'C10 刷新后装备仍有效（正式存档持久化）');

    /**
     * C11/C12：二选一必须**真的切换对比基准**（不是只换个高亮）。
     * 此时前轮 = largeWheel、后轮仍是缺省 ⇒ 切到前轮时「当前装备」列必须显示 largeWheel。
     */
    const readCurCol = () => page.evaluate(() => {
      const col = document.querySelector('[data-g2-modal] [data-g2-col="current"]');
      if (!col) return null;
      return {
        icon: col.querySelector('[data-ph-part-icon]')?.getAttribute('data-ph-part-icon') ?? null,
        note: col.querySelector('[data-g2-col-note]')?.textContent ?? null,
        q: col.querySelector('.g2-col-q')?.textContent ?? null,
      };
    });
    await page.evaluate(() => document.querySelector('[data-g2-cell^="q1:largeWheel"]')?.click());
    await page.waitForTimeout(90);
    const curRear = await readCurCol();
    await page.evaluate(() => document.querySelector('[data-g2-target="front"]')?.click());
    await page.waitForTimeout(80);
    const curFront = await readCurCol();
    ok(!!curFront && curFront.icon === 'largeWheel', `C11 二选一真的切换对比基准（切前轮 → 当前装备=${curFront && curFront.icon}）`);
    ok(JSON.stringify(curRear) !== JSON.stringify(curFront), `C12 前后轮对比基准不同（rear=${JSON.stringify(curRear)} / front=${JSON.stringify(curFront)}）`);
    await page.evaluate(() => document.querySelector('[data-g2-action="cancel"]')?.click());
    await page.waitForTimeout(70);
  }

  /* ── D. 点「前/后槽」时目标正确初始化 ── */
  {
    await page.evaluate(() => document.querySelector('[data-g2-slot="front"]')?.click());
    await page.waitForTimeout(90);
    const frontOpen = await page.evaluate(() => ({
      modal: !!document.querySelector('[data-g2-modal="compare"]'),
      onFront: document.querySelector('[data-g2-target="front"]')?.getAttribute('data-g2-target-on') === 'true',
      onRear: document.querySelector('[data-g2-target="rear"]')?.getAttribute('data-g2-target-on') === 'true',
      title: document.querySelector('[data-g2-modal-title]')?.textContent ?? null,
    }));
    ok(frontOpen.modal && frontOpen.onFront && !frontOpen.onRear, `D1 点前轮槽 → 目标初始化为 front（title=${frontOpen.title}）`);
    await page.evaluate(() => document.querySelector('[data-g2-action="cancel"]')?.click());
    await page.waitForTimeout(70);
    await page.evaluate(() => document.querySelector('[data-g2-slot="rear"]')?.click());
    await page.waitForTimeout(90);
    const rearOpen = await page.evaluate(() => ({
      modal: !!document.querySelector('[data-g2-modal="compare"]'),
      onRear: document.querySelector('[data-g2-target="rear"]')?.getAttribute('data-g2-target-on') === 'true',
    }));
    ok(rearOpen.modal && rearOpen.onRear, 'D2 点后轮槽 → 目标初始化为 rear');
    await page.evaluate(() => document.querySelector('[data-g2-action="cancel"]')?.click());
    await page.waitForTimeout(70);
  }

  /* ── E. qv2 品质件替换 + Run 同源 ── */
  await page.evaluate(() => {
    localStorage.setItem('strongfruit.garageV2Ledger.v1', JSON.stringify({ __v: 1, version: 2, consumed: {}, products: [{ defId: 'cannon', quality: 'green', seq: 1 }] }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await openV2(page);
  const qv2Cell = await page.evaluate(() => {
    const c = document.querySelector('[data-g2-cell^="qv2:cannon:green"]');
    if (c) c.click();
    return !!c;
  });
  ok(qv2Cell, 'E1 qv2 品质件单件格可见并可点');
  await page.waitForTimeout(80);
  await page.evaluate(() => document.querySelector('[data-g2-action="equip"]')?.click());
  await page.waitForTimeout(140);
  const p3 = await probeV2(page);
  ok(p3 && p3.weaponDef === 'cannon' && p3.functionalQualities && p3.functionalQualities.frontMass === 'green',
    'E2 qv2 绿炮经 equipQualityProduct 真实落盘（quality+绑定双字段）');
  const runSide = await page.evaluate(() => localStorage.getItem('strongfruit.playerBuild.v1'));
  ok(!!runSide && runSide.includes('"green"') && runSide.includes('qv2:cannon:green'), 'E3 正式存档含品质字段与实例绑定');

  /* ══════════════════════ ④ 同页合成模式 ══════════════════════ */

  /** 打开合成模式并返回探针读数 */
  async function openFuse() {
    await page.evaluate(() => document.querySelector('[data-g2-fuse-entry]')?.click());
    await page.waitForTimeout(150);
    return probeV2(page);
  }

  // FUSE-1：4/5（machineGun 白 ×4）⇒ 不成组、确认禁用、返回装备恒在
  await page.evaluate(() => {
    localStorage.setItem('strongfruit.garageV2Ledger.v1', JSON.stringify({ __v: 1, version: 2, consumed: {}, products: [] }));
    localStorage.setItem('strongfruit.ownedParts.v2', JSON.stringify({ machineGun: { one: 4 } }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await openV2(page);
  let f = await openFuse();
  const f1members = await page.evaluate(() =>
    [...document.querySelectorAll('[data-g2-fuse-group-kind]')].map((g) => g.querySelectorAll('[data-g2-fuse-member]').length));
  ok(f && f.mode === 'fuse', 'FUSE-1 合成 = 同页模式（不是遮罩弹窗）');
  ok(f1members.every((n) => n >= 5), `FUSE-1b 4/5 不成组：所有展示组 ≥5 成员（${JSON.stringify(f1members)}）`);
  ok(f && f.fuseConfirmDisabled === true, 'FUSE-1c 未选主件时确认不可用');
  ok(f && f.fuseBackVisible === true, 'FUSE-1d 合成模式【返回装备】恒存在');
  // 合成候选与背包**同规格**：4 列 + 图标 ≥85%
  const fuseGrid = await page.evaluate(() => {
    const g = document.querySelector('[data-g2-fuse-member]')?.closest('.g2-grid');
    if (!g) return null;
    const cols = getComputedStyle(g).gridTemplateColumns.trim().split(/\s+/).length;
    const cell = g.querySelector('.g2-cell');
    const icon = cell?.querySelector('.ph-part-icon');
    const cw = cell ? cell.getBoundingClientRect().width : 0;
    return { cols, ratio: cw ? +(icon.getBoundingClientRect().width / cw).toFixed(3) : 0 };
  });
  if (fuseGrid) ok(fuseGrid.cols === 4 && fuseGrid.ratio >= 0.85, `FUSE-1e 合成候选与背包同规格（${JSON.stringify(fuseGrid)}）`);
  else ok(false, 'FUSE-1e 合成候选与背包同规格（无候选组可测）');
  // 返回装备零写盘
  {
    const beforeExit = await dumpStore(page);
    await page.evaluate(() => document.querySelector('[data-g2-fuse-back]')?.click());
    await page.waitForTimeout(100);
    const afterExit = await dumpStore(page);
    ok(JSON.stringify(beforeExit) === JSON.stringify(afterExit), 'FUSE-1f 退出合成模式零写盘');
    ok((await probeV2(page)).mode === 'equip', 'FUSE-1g 退出合成 → 回装备页');
  }

  // FUSE-2：补满 5 件 → 红点出现、组出现
  await grantParts(page, 'machineGun', 1, 1);
  const dotState = await probeV2(page); // ⚠️ 红点在**装备页**（合成模式下 head 换成【返回装备】）
  ok(dotState && dotState.fuseReadyGroups >= 1 && dotState.fuseDot !== null, 'FUSE-2 满 5 后红点出现（真实资格）');
  f = await openFuse();
  ok(f && f.fuseConfirmDisabled === true, 'FUSE-2b 未选主件时确认禁用');

  // FUSE-3：混合 defId（mg×5 + hammer×1 = 6 成员）→ 选主件 → 自动补 4 料 + 预览
  await grantParts(page, 'hammer', 1, 1);
  f = await openFuse();
  ok(f && f.fuseMembers >= 6, 'FUSE-3 混合 defId 组（machineGun×5 + hammer×1 = weapon·白 6 成员）');
  const pickedId = await page.evaluate(() => {
    const target = [...document.querySelectorAll('[data-g2-fuse-member]')]
      .find((mm) => (mm.getAttribute('data-g2-fuse-member') || '').startsWith('q1:machineGun'));
    if (!target) return null;
    target.click();
    return target.getAttribute('data-g2-fuse-member');
  });
  ok(!!pickedId, 'FUSE-3b 点选主件成功');
  await page.waitForTimeout(120);
  f = await probeV2(page);
  ok(f && f.fuseMainPick === pickedId && f.fuseConfirmDisabled === false, 'FUSE-3c 主件选中且确认可用');
  ok(f && f.fuseConsumeMarked === 4, `FUSE-3d 自动补 4 件材料并标为消耗（实测 ${f && f.fuseConsumeMarked}）`);
  const previewShown = await page.evaluate(() => {
    const next = document.querySelector('[data-g2-fuse-next]');
    const main = document.querySelector('[data-g2-fuse-main="true"]');
    return { next: next?.getAttribute('data-g2-fuse-next') ?? null, mainMarked: !!main, text: document.querySelector('[data-g2-fuse-text]')?.textContent ?? null };
  });
  ok(previewShown.next === 'green' && previewShown.mainMarked, `FUSE-3e 固定区预览「主件 → 下一品质」（next=${previewShown.next}）`);

  // 截图：合成模式（正常速度）
  {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, 'fuse-390x844.png') });
  }

  // FUSE-4：确认 → 5 合 1
  const invBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('strongfruit.ownedParts.v2')));
  await page.evaluate(() => document.querySelector('[data-g2-action="fuse"]')?.click());
  await page.waitForTimeout(220);
  f = await probeV2(page);
  ok(f && f.mode === 'equip', 'FUSE-4 确认成功 → 回装备页（结果立即可见）');
  const noteText = await page.evaluate(() => document.querySelector('[data-g2-note]')?.textContent ?? null);
  ok(!!noteText && noteText.includes('合成成功'), `FUSE-4b 结果清晰（顶部提示：${noteText}）`);
  // 截图：合成成功后回装备页（结果清晰 + 新件高亮）
  await page.screenshot({ path: path.join(SHOT_DIR, 'fuse-result-390x844.png') });
  const freshCell = await page.evaluate(() => {
    const c = document.querySelector('[data-g2-fresh]');
    return c ? c.getAttribute('data-g2-cell') : null;
  });
  ok(!!freshCell && freshCell.startsWith('qv2:machineGun:green'), `FUSE-4b2 产物在背包里带「刚出炉」高亮（${freshCell}）`);
  const invAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('strongfruit.ownedParts.v2')));
  const mgBefore = (invBefore.machineGun?.one ?? 0) + (invBefore.machineGun?.two ?? 0);
  const mgAfter = invAfter.machineGun?.one ?? 0;
  const hammerAfter = invAfter.hammer?.one ?? 0;
  ok(mgAfter === mgBefore - 3 && hammerAfter === 0,
    `FUSE-4c 真实消耗 5 实例（mg ${mgBefore}→${mgAfter}、hammer→${hammerAfter}；成品保留主件 defId）`);
  const ledgerNow = await page.evaluate(() => JSON.parse(localStorage.getItem('strongfruit.garageV2Ledger.v1')));
  const greenMG = (ledgerNow.products || []).find((pp) => pp.defId === 'machineGun' && pp.quality === 'green');
  ok(!!greenMG, 'FUSE-4d 成品唯一入账本（machineGun 绿）');

  // FUSE-5：产物立即在背包 + 可穿戴 + 刷新一致
  const newCell = await page.evaluate(() => {
    const c = document.querySelector('[data-g2-cell^="qv2:machineGun:green"]');
    if (c) c.click();
    return !!c;
  });
  ok(newCell, 'FUSE-5 产物立即出现在背包并可打开对比');
  await page.waitForTimeout(120);
  await page.evaluate(() => document.querySelector('[data-g2-action="equip"]')?.click());
  await page.waitForTimeout(150);
  f = await probeV2(page);
  ok(f && f.weaponDef === 'machineGun' && f.functionalQualities?.frontMass === 'green', 'FUSE-5b 合成产物立即真实可穿戴（绿机枪上身）');
  await page.reload({ waitUntil: 'networkidle' });
  await openV2(page);
  f = await probeV2(page);
  ok(f && f.weaponDef === 'machineGun' && f.functionalQualities?.frontMass === 'green', 'FUSE-5c 刷新重进装备仍一致');

  // FUSE-6：限制不变（Body 永不进组 / 组 ≥5 / 锁定件不进候选 / 彩封顶不进候选）
  await page.evaluate(() => {
    const KEY2 = 'strongfruit.ownedParts.v2';
    const raw = JSON.parse(localStorage.getItem(KEY2) || '{}');
    raw.shotgun = { two: 1 };            // 旧 ★2 legacy-star-locked
    raw.smallWheel = { one: 5 };         // movement·白 真实可合成组
    localStorage.setItem(KEY2, JSON.stringify(raw));
    // 5 件彩品质产物（同形状真实产物）⇒ 彩封顶必须**不进候选**
    const KEY = 'strongfruit.garageV2Ledger.v1';
    localStorage.setItem(KEY, JSON.stringify({
      __v: 1, version: 2, consumed: {},
      products: [{ defId: 'cannon', quality: 'chrome', seq: 1 }, { defId: 'cannon', quality: 'chrome', seq: 2 },
        { defId: 'cannon', quality: 'chrome', seq: 3 }, { defId: 'cannon', quality: 'chrome', seq: 4 },
        { defId: 'cannon', quality: 'chrome', seq: 5 }],
    }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await openV2(page);
  const lockedIds = await page.evaluate(() => [...document.querySelectorAll('.g2-cell-locked')].map((c) => c.getAttribute('data-g2-cell')));
  const chromeInBag = await page.evaluate(() => document.querySelectorAll('[data-g2-cell^="qv2:cannon:chrome"]').length);
  ok(chromeInBag === 5, `FUSE-6 5 件彩品质产物真实在背包（实测 ${chromeInBag}）`);
  f = await openFuse();
  const groupKinds = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-g2-fuse-group-kind]')]
    .map((mm) => mm.getAttribute('data-g2-fuse-group-kind')))]);
  const memberIds = await page.evaluate(() => [...document.querySelectorAll('[data-g2-fuse-member]')].map((m) => m.getAttribute('data-g2-fuse-member')));
  const memberCounts = await page.evaluate(() =>
    [...document.querySelectorAll('[data-g2-fuse-group-kind]')].map((mm) => mm.querySelectorAll('[data-g2-fuse-member]').length));
  ok(!groupKinds.includes('body'), `FUSE-6b Body 永不进组（实际组：${JSON.stringify(groupKinds)}）`);
  ok(memberCounts.every((n) => n >= 5), `FUSE-6c 每个展示组真实 ≥5 成员（${JSON.stringify(memberCounts)}）`);
  ok(!memberIds.some((id) => id.includes(':chrome')), 'FUSE-6d 彩封顶不进候选（5 件也不成组）');
  ok(!memberIds.some((id) => lockedIds.includes(id)), `FUSE-6e 锁定件（装备中/旧星级/封顶）不进候选（锁定 ${lockedIds.length} 件）`);
  ok(!memberIds.some((id) => id.startsWith('q1:shotgun')), 'FUSE-6f 旧 ★2 shotgun 不进候选（legacy-star-locked）');
  // 退出合成（零写盘）
  {
    const b = await dumpStore(page);
    await page.evaluate(() => document.querySelector('[data-g2-fuse-back]')?.click());
    await page.waitForTimeout(100);
    ok(JSON.stringify(b) === JSON.stringify(await dumpStore(page)), 'FUSE-6g 返回装备零写盘（退出模式不落任何账）');
  }

  /* ── G. 非法实例零写盘（幽灵绑定） ── */
  await page.evaluate(() => {
    localStorage.setItem('strongfruit.garageV2Ledger.v1', JSON.stringify({ __v: 1, version: 2, consumed: {}, products: [] }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  const ghostNull = await page.evaluate(() => window.__PRODUCTHOME__.probe().bodyName);
  ok(typeof ghostNull === 'string', 'G1 幽灵绑定被加载校验拒绝后页面仍以默认车启动（不白屏）');

  /* ── H. 默认入口 / 旧 legacy / 开始冒险 href ── */
  const page2 = await ctx.newPage();
  await page2.goto(url, { waitUntil: 'networkidle' });
  const defaultGarage = await page2.evaluate(() => {
    const probe0 = window.__PRODUCTHOME__.probe();
    document.querySelector('[data-ph-action="open-garage"]')?.click();
    return new Promise((res) => setTimeout(() => {
      const probe = window.__PRODUCTHOME__.probe();
      res({
        viewHomeBefore: probe0.view,
        v2Mounted: probe.garageV2.mounted === true,
        oldCardGrid: document.querySelectorAll('[data-ph-slot]').length,
        v2FuseEntry: !!document.querySelector('[data-g2-fuse-entry]'),
      });
    }, 180));
  });
  ok(defaultGarage.viewHomeBefore === 'home' && defaultGarage.v2Mounted && defaultGarage.oldCardGrid === 0,
    'H1 默认【调整战车】= Garage V2（旧星级卡片 DOM 不存在）');
  ok(defaultGarage.v2FuseEntry, 'H2 V2 合成入口存在（右上 · 真实五合一）');
  const backRect2 = await rect(page2, '[data-g2-back]');
  ok(inside(backRect2, await rect(page2, '.ph-main-garage')), 'H3 默认入口下返回按钮同样在画面内');
  await realClickRect(page2, backRect2); // 真实鼠标点击 → 回首页（其内部重读正式存档）
  await page2.waitForTimeout(180);
  const startHref = await page2.evaluate(() => {
    const a = document.querySelector('[data-ph-action="start-run"]');
    return a ? a.getAttribute('href') : null;
  });
  ok(typeof startHref === 'string' && startHref.length > 0, 'H4 开始冒险 href 正常（Run 主路线未变）');
  await page2.close();

  const page3 = await ctx.newPage();
  await page3.goto(`http://127.0.0.1:${PORT}/home.html?garageLegacy=1`, { waitUntil: 'networkidle' });
  const legacyGarage = await page3.evaluate(() => {
    document.querySelector('[data-ph-action="open-garage"]')?.click();
    return new Promise((res) => setTimeout(() => {
      const probe = window.__PRODUCTHOME__.probe();
      res({
        view: probe.view,
        v2Mounted: probe.garageV2.mounted === true,
        oldWeaponCards: document.querySelectorAll('[data-ph-weapon]').length,
      });
    }, 180));
  });
  ok(legacyGarage.view === 'garage' && legacyGarage.v2Mounted === false && legacyGarage.oldWeaponCards > 0,
    'H5 ?garageLegacy=1 才进旧星级 Garage（V2 未挂载 + 旧卡片存在）');
  await page3.close();

  console.log(`\n==== ${pass} passed, ${fails.length} failed ====`);
  if (fails.length) console.log('FAILED:', fails.join(' | '));

  await browser.close();
  server.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('E2E-ERROR', e); process.exit(2); });
