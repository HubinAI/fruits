/**
 * PBL-F0-PORTRAIT-BATTLE-LAB-FOUNDATION｜竖屏战场实验台 —— 浏览器真实闭环验证。
 *
 * 手段：真实浏览器（playwright-core / msedge）打开独立产物 dist-portrait-lab/portrait-lab.html，
 *   - 真实鼠标点击（page.click，非 evaluate 直调）
 *   - 真实像素读取（canvas.getContext('2d').getImageData 统计占位色块面积）
 *   - 只读诊断句柄 window.__PBL__（Lab 专属，仅存在于本实验页面）
 * 不伪造任何步骤；任一断言失败即 FAIL。
 *
 * 断言链（每个视口全跑）：
 *   竖屏逻辑区 390×844 ｜ 画布 backing = 逻辑×DPR ｜ 屏幕 CSS rect 为竖屏比例 844/390
 *   → 初始占位像素（Arena A 黄 / 追猎者 红 / 西瓜重炮 蓝）
 *   → 点「远程炮台」红面积比 0.6267 ｜ 点「香蕉冲锋锤」蓝面积比 1.1020
 *   → 点「Arena B」黄面积比 1.5037（占位布局确实切换）
 *   → 点「Start」phase=running / startCount=1 / Start 变 disabled
 *   → 点「Arena A」running 中被中止回 idle
 *   → 点「Reset」回到默认（A/追猎者/西瓜重炮、startCount=0）且像素签名回到初始
 *   → 独立产物内不含正式入口 index.html（404）且 bundle 不含正式玩法模块名
 *
 * 用法：
 *   npm run build:portrait-lab
 *   node tests/_e2e_portrait_battle_lab.cjs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8155;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
};

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}
function ratio(a, b) {
  return b === 0 ? Infinity : a / b;
}
function relDiff(a, b) {
  return Math.abs(a - b) / Math.max(1, Math.abs(b));
}

function startServer() {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/portrait-lab.html';
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
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

/** 占位色块像素统计（真实 getImageData；与 Lab 绘制常量一一对应）。 */
function pixelSignature(page) {
  return page.evaluate(() => {
    const c = document.querySelector('#pbl-canvas');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let yellow = 0;
    let red = 0;
    let blue = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      if (r > 200 && g > 180 && b < 130) yellow++; // Arena 标记 #ffd35a
      else if (r > 200 && g < 150 && b < 150) red++; // 敌人标记 #ff6b5e
      else if (b > 170 && r < 130 && g > 100) blue++; // 玩家轮廓 #4a7fe0
    }
    return { yellow, red, blue, w: c.width, h: c.height };
  });
}

const probeOf = (page) => page.evaluate(() => window.__PBL__.probe());

async function clickBtn(page, name) {
  await page.getByRole('button', { name, exact: true }).click();
}

/** 每个视口跑完整闭环。 */
async function runViewport(browser, vp) {
  const tag = `${vp.w}×${vp.h}@${vp.dpr}`;
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr });
  const page = await ctx.newPage();

  await page.goto(`${URL_BASE}/portrait-lab.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const c = document.querySelector('#pbl-canvas');
    return !!window.__PBL__ && !!c && c.width > 0 && window.__PBL__.probe().camera.scale > 0;
  }, null, { timeout: 15000 });

  // 1) 竖屏逻辑区 + 固定摄像机 + 屏幕矩形
  const p0 = await probeOf(page);
  log(p0.logicalW === 390 && p0.logicalH === 844, `[${tag}] A1 竖屏逻辑区 390×844`, `logical=${p0.logicalW}×${p0.logicalH}`);
  log(
    p0.canvas.backingW === Math.round(390 * vp.dpr) && p0.canvas.backingH === Math.round(844 * vp.dpr),
    `[${tag}] A2 画布 backing = 逻辑 × DPR`,
    `backing=${p0.canvas.backingW}×${p0.canvas.backingH} 期望=${Math.round(390 * vp.dpr)}×${Math.round(844 * vp.dpr)}`,
  );
  const cssRatio = p0.canvas.cssH / p0.canvas.cssW;
  log(
    p0.canvas.cssH > p0.canvas.cssW && relDiff(cssRatio, 844 / 390) < 0.01,
    `[${tag}] A3 屏幕 CSS rect 为竖屏比例 844/390`,
    `css=${p0.canvas.cssW}×${p0.canvas.cssH} ratio=${cssRatio.toFixed(4)}`,
  );

  // 2) 初始占位像素（Arena A 黄 / 追猎者 红 / 西瓜重炮 蓝）
  const s0 = await pixelSignature(page);
  log(
    s0.w === Math.round(390 * vp.dpr) && s0.h === Math.round(844 * vp.dpr),
    `[${tag}] A4 像素来源画布尺寸一致`,
    `${s0.w}×${s0.h}`,
  );
  log(s0.yellow > 0 && s0.red > 0 && s0.blue > 0, `[${tag}] A5 初始占位像素存在（黄/红/蓝）`, JSON.stringify(s0));
  if (vp.dpr === 1) {
    log(
      s0.yellow === 4200 && s0.red === 9216 && s0.blue === 7840,
      `[${tag}] A5b 初始占位像素面积精确（黄 2×14×150 / 红 96² / 蓝 140×56）`,
      JSON.stringify(s0),
    );
  }

  // 3) 真实点击 Encounter → 远程炮台（红面积比 76²/96²）
  await clickBtn(page, '远程炮台');
  const pE = await probeOf(page);
  const sE = await pixelSignature(page);
  log(pE.encounter === 'turret', `[${tag}] A6 点「远程炮台」状态生效`, `encounter=${pE.encounter}`);
  log(relDiff(ratio(sE.red, s0.red), 5776 / 9216) < 0.03, `[${tag}] A7 红面积比 ≈ 0.6267`, `${ratio(sE.red, s0.red).toFixed(4)}`);

  // 4) 真实点击 Loadout → 香蕉冲锋锤（蓝面积比 8640/7840）
  await clickBtn(page, '香蕉冲锋锤');
  const pL = await probeOf(page);
  const sL = await pixelSignature(page);
  log(pL.loadout === 'banana-hammer', `[${tag}] A8 点「香蕉冲锋锤」状态生效`, `loadout=${pL.loadout}`);
  log(relDiff(ratio(sL.blue, s0.blue), 8640 / 7840) < 0.03, `[${tag}] A9 蓝面积比 ≈ 1.1020`, `${ratio(sL.blue, s0.blue).toFixed(4)}`);

  // 5) 真实点击 Arena → B（黄面积比 (2×14×110+80×30)/(2×14×150) = 5480/4200）
  await clickBtn(page, 'Arena B');
  const pA = await probeOf(page);
  const sA = await pixelSignature(page);
  log(pA.arena === 'B', `[${tag}] A10 点「Arena B」状态生效`, `arena=${pA.arena}`);
  log(relDiff(ratio(sA.yellow, s0.yellow), 5480 / 4200) < 0.03, `[${tag}] A11 黄面积比 ≈ 1.3048（Arena 渲染确实切换）`, `${ratio(sA.yellow, s0.yellow).toFixed(4)}`);

  // 6) Start（真实点击）→ running
  await clickBtn(page, 'Start');
  const pR = await probeOf(page);
  log(pR.phase === 'running' && pR.startCount === 1, `[${tag}] A12 点「Start」→ running / startCount=1`, `phase=${pR.phase} starts=${pR.startCount}`);
  const startDisabled = await page.getByRole('button', { name: 'Start', exact: true }).isDisabled();
  log(startDisabled, `[${tag}] A13 running 中 Start 置为 disabled（幂等保护）`, `disabled=${startDisabled}`);

  // 7) running 中切换 Arena → 回 idle
  await clickBtn(page, 'Arena A');
  const pA2 = await probeOf(page);
  log(pA2.phase === 'idle' && pA2.arena === 'A', `[${tag}] A14 running 中切 Arena → 回 idle`, `phase=${pA2.phase} arena=${pA2.arena}`);

  // 8) Reset → 回默认 + 像素签名回到初始
  await clickBtn(page, 'Reset');
  const pZ = await probeOf(page);
  const sZ = await pixelSignature(page);
  log(
    pZ.phase === 'idle' && pZ.startCount === 0 && pZ.arena === 'A' && pZ.loadout === 'watermelon-cannon' && pZ.encounter === 'stalker',
    `[${tag}] A15 点「Reset」→ 回默认（A / 西瓜重炮 / 追猎者 / startCount=0）`,
    `arena=${pZ.arena} loadout=${pZ.loadout} encounter=${pZ.encounter} starts=${pZ.startCount}`,
  );
  log(
    relDiff(sZ.yellow, s0.yellow) < 0.01 && relDiff(sZ.red, s0.red) < 0.01 && relDiff(sZ.blue, s0.blue) < 0.01,
    `[${tag}] A16 Reset 后像素签名回到初始`,
    `yellow ${s0.yellow}→${sZ.yellow} red ${s0.red}→${sZ.red} blue ${s0.blue}→${sZ.blue}`,
  );

  await ctx.close();
}

(async () => {
  const server = await startServer();
  let browser;
  try {
    try {
      browser = await chromium.launch({ channel: 'msedge', headless: true });
    } catch (e) {
      console.log('msedge 不可用，回退默认 chromium：' + (e && e.message ? e.message : e));
      browser = await chromium.launch({ headless: true });
    }

    const viewports = [
      { w: 1280, h: 720, dpr: 1 },
      { w: 700, h: 900, dpr: 1.5 },
    ];
    for (const vp of viewports) await runViewport(browser, vp);

    // 9) 隔离：独立产物内不含正式入口；bundle 不含正式玩法模块名
    const idx = await fetch(`${URL_BASE}/index.html`);
    log(idx.status === 404, '[iso] I1 独立产物内不含正式入口 index.html', `status=${idx.status}`);
    const assetsDir = path.join(ROOT, 'assets');
    const jsName = fs.readdirSync(assetsDir).find((f) => f.endsWith('.js'));
    const bundle = fs.readFileSync(path.join(assetsDir, jsName), 'utf8');
    const leaked = ['playerGameRuntime', 'canvasPlayerUIHost', 'webDomPlayerUIHost', 'physicsLab', 'planckBattleOrchestrator', 'garageFusion'].filter((n) => bundle.includes(n));
    log(leaked.length === 0, '[iso] I2 Lab bundle 不含正式玩法模块', leaked.length ? `泄漏=${leaked.join(',')}` : `bundle=${jsName} size=${bundle.length}B`);
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log('\n============================');
  console.log(`E2E Portrait Battle Lab: ${results.length - failed.length}/${results.length} PASS`);
  console.log('============================');
  if (failed.length) {
    for (const f of failed) console.log('FAILED: ' + f.name + ' | ' + f.detail);
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
