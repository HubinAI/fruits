/**
 * PBL-F0 / PBL-F1｜竖屏战场实验台 —— 浏览器真实闭环验证。
 *
 * 手段：真实浏览器（playwright-core / msedge）打开独立产物 dist-portrait-lab/portrait-lab.html，
 *   - 真实鼠标点击（page.click，非 evaluate 直调）
 *   - 真实像素读取（canvas.getContext('2d').getImageData 统计各分层色块面积）
 *   - 只读诊断句柄 window.__PBL__（Lab 专属，仅存在于本实验页面）
 * 不伪造任何步骤；任一断言失败即 FAIL。
 *
 * 期望面积常量来自纯模型账本 tests/portraitBattleLabF1.test.ts（F1-R22），
 * 本文件是「浏览器真实渲染 == 纯模型预测」的跨语言交叉核对。
 * 面积语义：部件层绘制在车身层之上 → 重叠区计入部件层，车身层相应减少。
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

/** 各分层期望像素面积（dpr=1；唯一来源 = tests/portraitBattleLabF1.test.ts F1-R22）。 */
const LEDGER = {
  'A/WatermelonHeavyCannon/Chaser': { arena: 4200, playerBody: 8360, playerPart: 800, enemyBody: 7618, enemyPart: 1560 },
  'A/WatermelonHeavyCannon/RangedTurret': { arena: 4200, playerBody: 8360, playerPart: 800, enemyBody: 7790, enemyPart: 1370 },
  'A/BananaChargeHammer/RangedTurret': { arena: 4200, playerBody: 7798, playerPart: 1560, enemyBody: 7790, enemyPart: 1370 },
  'B/BananaChargeHammer/RangedTurret': { arena: 5480, playerBody: 7798, playerPart: 1560, enemyBody: 7790, enemyPart: 1370 },
  'B/BananaChargeHammer/LightSwarm3': { arena: 5480, playerBody: 7798, playerPart: 1560, enemyBody: 18060, enemyPart: 11568 },
  'A/BananaChargeHammer/LightSwarm3': { arena: 4200, playerBody: 7798, playerPart: 1560, enemyBody: 18060, enemyPart: 11568 },
};

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
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

/**
 * 分层色块像素统计（真实 getImageData；与 Lab 的 LAYER_COLORS 一一对应）。
 *
 * 两条硬约定（都与 Lab 侧同步）：
 *   1) 顶部 HUD 带（y < 140）只含文字，不承载任何分层几何 → 统计一律跳过该带，
 *      彻底隔离「文字抗锯齿像素」对实体 / Arena 面积的污染；
 *   2) 纯白像素（HUD 标题字）直接忽略。
 * 各分层颜色两两互斥（已逐对验证），分类顺序不影响结果。
 */
function pixelSignature(page) {
  return page.evaluate(() => {
    const c = document.querySelector('#pbl-canvas');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const scale = c.width / 390;
    const yCut = Math.ceil(140 * scale); // HUD 带下沿（逻辑 140）× 实际缩放
    let arena = 0;
    let playerBody = 0;
    let playerPart = 0;
    let enemyBody = 0;
    let enemyPart = 0;
    for (let i = 0; i < d.length; i += 4) {
      const px = i >> 2;
      if (px / c.width < yCut) continue; // HUD 带：不参与统计
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      if (r > 230 && g > 230 && b > 230) continue; // 纯白文字
      if (r > 200 && g > 180 && b < 130) arena++; // #ffd35a
      else if (r > 200 && g >= 150 && g < 190 && b < 110) enemyPart++; // #ff9b3d
      else if (r > 200 && g < 150 && b < 150) enemyBody++; // #ff6b5e
      else if (b > 230 && r > 120 && r < 200 && g < 160) playerPart++; // #a06bff
      else if (b > 170 && r < 130 && g > 100) playerBody++; // #4a7fe0
    }
    return { arena, playerBody, playerPart, enemyBody, enemyPart, w: c.width, h: c.height };
  });
}

const probeOf = (page) => page.evaluate(() => window.__PBL__.probe());

async function clickBtn(page, name) {
  await page.getByRole('button', { name, exact: true }).click();
}

/** 断言像素签名与账本完全一致（dpr=1 精确；dpr≠1 只断言分层比例稳定）。 */
function ledgerCheck(tag, label, sig, key, dpr) {
  const exp = LEDGER[key];
  if (!exp) return log(false, `[${tag}] ${label} 账本缺 ${key}`, '');
  if (dpr === 1) {
    const ok = Object.keys(exp).every((k) => sig[k] === exp[k]);
    return log(
      ok,
      `[${tag}] ${label} 分层像素面积精确`,
      `实际=${JSON.stringify({ arena: sig.arena, playerBody: sig.playerBody, playerPart: sig.playerPart, enemyBody: sig.enemyBody, enemyPart: sig.enemyPart })} 期望=${JSON.stringify(exp)}`,
    );
  }
  // dpr≠1：截图缩放后精确值不再成立，改断言分层相对关系（比例）不变
  const ok =
    relDiff(sig.playerBody / sig.enemyBody, exp.playerBody / exp.enemyBody) < 0.03 &&
    relDiff(sig.playerPart / sig.enemyPart, exp.playerPart / exp.enemyPart) < 0.03;
  return log(ok, `[${tag}] ${label} 分层比例与账本一致`, `pb/eb=${(sig.playerBody / sig.enemyBody).toFixed(4)}`);
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
    `backing=${p0.canvas.backingW}×${p0.canvas.backingH}`,
  );
  log(
    p0.canvas.cssH > p0.canvas.cssW && relDiff(p0.canvas.cssH / p0.canvas.cssW, 844 / 390) < 0.01,
    `[${tag}] A3 屏幕 CSS rect 为竖屏比例 844/390`,
    `css=${p0.canvas.cssW}×${p0.canvas.cssH}`,
  );

  // 2) 初始：Arena A + 西瓜重炮 + 追猎者（实体外形来自正式 collider）
  const s0 = await pixelSignature(page);
  log(
    p0.playerBody === 'watermelonBody' && p0.enemyBodies.join(',') === 'bananaBody',
    `[${tag}] A4 初始组合实体来自正式内容库`,
    `player=${p0.playerBody} enemies=${p0.enemyBodies.join(',')}`,
  );
  log(p0.unavailable.join('/') === '磁铁', `[${tag}] A5 缺口如实披露（西瓜重炮 → 磁铁）`, `unavailable=${p0.unavailable.join('/')}`);
  log(p0.liveEntities === 0 && p0.liveProjectiles === 0, `[${tag}] A6 idle 时场上无实体 / 无弹丸`, `entities=${p0.liveEntities} projectiles=${p0.liveProjectiles}`);
  ledgerCheck(tag, 'A7 初始', s0, 'A/WatermelonHeavyCannon/Chaser', vp.dpr);

  // 3) 真实点击 Encounter → 远程炮台（西瓜 + 炮 + 机枪）
  await clickBtn(page, '远程炮台');
  const pE = await probeOf(page);
  const sE = await pixelSignature(page);
  log(pE.encounter === 'RangedTurret', `[${tag}] A8 点「远程炮台」状态生效`, `encounter=${pE.encounter}`);
  log(pE.enemyBodies.join(',') === 'watermelonBody', `[${tag}] A9 敌人车身确实换成正式西瓜车`, `${pE.enemyBodies.join(',')}`);
  ledgerCheck(tag, 'A10 换 Encounter 后', sE, 'A/WatermelonHeavyCannon/RangedTurret', vp.dpr);

  // 4) 真实点击 Loadout → 香蕉冲锋锤（香蕉车 + 锤 + 推进器；护盾正式库无）
  await clickBtn(page, '香蕉冲锋锤');
  const pL = await probeOf(page);
  const sL = await pixelSignature(page);
  log(pL.loadout === 'BananaChargeHammer', `[${tag}] A11 点「香蕉冲锋锤」状态生效`, `loadout=${pL.loadout}`);
  log(pL.playerBody === 'bananaBody', `[${tag}] A12 玩家车身换成正式香蕉车`, `${pL.playerBody}`);
  log(pL.unavailable.join('/') === '护盾', `[${tag}] A13 缺口如实披露（香蕉冲锋锤 → 护盾）`, `unavailable=${pL.unavailable.join('/')}`);
  ledgerCheck(tag, 'A14 换 Loadout 后', sL, 'A/BananaChargeHammer/RangedTurret', vp.dpr);

  // 5) 真实点击 Arena → B（A/B 基础数据必须完全相同）
  const keyA = pL.baseKey;
  await clickBtn(page, 'Arena B');
  const pA = await probeOf(page);
  const sA = await pixelSignature(page);
  log(pA.arena === 'B', `[${tag}] A15 点「Arena B」状态生效`, `arena=${pA.arena}`);
  log(pA.baseKey === keyA, `[${tag}] A16 A/B 读到同一套共享基础数据（指纹相同）`, `key=${String(pA.baseKey).slice(0, 48)}…`);
  ledgerCheck(tag, 'A17 换 Arena 后', sA, 'B/BananaChargeHammer/RangedTurret', vp.dpr);

  // 6) 真实点击 Encounter → 3 轻敌人（同一正式轻型模板 ×3）
  await clickBtn(page, '3 轻敌人');
  const pS = await probeOf(page);
  const sS = await pixelSignature(page);
  log(pS.encounter === 'LightSwarm3', `[${tag}] A18 点「3 轻敌人」状态生效`, `encounter=${pS.encounter}`);
  log(pS.enemyBodies.length === 3 && new Set(pS.enemyBodies).size === 1, `[${tag}] A19 三敌人同源（同一正式模板）`, `${pS.enemyBodies.join(',')}`);
  ledgerCheck(tag, 'A20 三敌人组合', sS, 'B/BananaChargeHammer/LightSwarm3', vp.dpr);

  // 7) Start（真实点击）→ 生成该组合的实体
  await clickBtn(page, 'Start');
  const pR = await probeOf(page);
  log(pR.phase === 'running' && pR.startCount === 1, `[${tag}] A21 点「Start」→ running / startCount=1`, `phase=${pR.phase} starts=${pR.startCount}`);
  log(pR.liveEntities === 4 && pR.spawnSerial === 1, `[${tag}] A22 Start 生成 1 玩家 + 3 敌人`, `entities=${pR.liveEntities} serial=${pR.spawnSerial}`);
  log(pR.liveProjectiles === 0, `[${tag}] A23 本 Queue 未发射弹丸（容器为空）`, `projectiles=${pR.liveProjectiles}`);
  const startDisabled = await page.getByRole('button', { name: 'Start', exact: true }).isDisabled();
  log(startDisabled, `[${tag}] A24 running 中 Start 置为 disabled（幂等保护）`, `disabled=${startDisabled}`);
  const sRun = await pixelSignature(page);
  log(
    JSON.stringify(sRun) === JSON.stringify(sS),
    `[${tag}] A25 Start 不改变舞台几何（实体与预览同源）`,
    '',
  );

  // 8) running 中切换 Arena → 回 idle 并清空实体
  await clickBtn(page, 'Arena A');
  const pA2 = await probeOf(page);
  log(
    pA2.phase === 'idle' && pA2.arena === 'A' && pA2.liveEntities === 0 && pA2.liveProjectiles === 0,
    `[${tag}] A26 running 中切 Arena → 回 idle 且实体 / 弹丸清空`,
    `phase=${pA2.phase} arena=${pA2.arena} entities=${pA2.liveEntities}`,
  );
  ledgerCheck(tag, 'A27 回到 Arena A 后', await pixelSignature(page), 'A/BananaChargeHammer/LightSwarm3', vp.dpr);

  // 9) 再次 Start → 新批次（批次号递增）
  await clickBtn(page, 'Start');
  const pR2 = await probeOf(page);
  log(pR2.spawnSerial === 2 && pR2.liveEntities === 4, `[${tag}] A28 重新 Start 得到新批次`, `serial=${pR2.spawnSerial} entities=${pR2.liveEntities}`);

  // 10) Reset → 回默认 + 彻底清空 + 像素签名回到初始
  await clickBtn(page, 'Reset');
  const pZ = await probeOf(page);
  const sZ = await pixelSignature(page);
  log(
    pZ.phase === 'idle' && pZ.startCount === 0 && pZ.arena === 'A' &&
      pZ.loadout === 'WatermelonHeavyCannon' && pZ.encounter === 'Chaser',
    `[${tag}] A29 点「Reset」→ 回默认（A / 西瓜重炮 / 追猎者 / startCount=0）`,
    `arena=${pZ.arena} loadout=${pZ.loadout} encounter=${pZ.encounter} starts=${pZ.startCount}`,
  );
  log(
    pZ.liveEntities === 0 && pZ.liveProjectiles === 0,
    `[${tag}] A30 Reset 后无实体 / 无弹丸残留`,
    `entities=${pZ.liveEntities} projectiles=${pZ.liveProjectiles}`,
  );
  log(
    JSON.stringify(sZ) === JSON.stringify(s0),
    `[${tag}] A31 Reset 后像素签名回到初始（逐层完全一致）`,
    `初始=${JSON.stringify(s0)} 当前=${JSON.stringify(sZ)}`,
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

    // 11) 隔离：独立产物内不含正式入口；bundle 不含正式玩法 Runtime 模块
    const idx = await fetch(`${URL_BASE}/index.html`);
    log(idx.status === 404, '[iso] I1 独立产物内不含正式入口 index.html', `status=${idx.status}`);
    const assetsDir = path.join(ROOT, 'assets');
    const jsName = fs.readdirSync(assetsDir).find((f) => f.endsWith('.js'));
    const bundle = fs.readFileSync(path.join(assetsDir, jsName), 'utf8');
    const leaked = ['playerGameRuntime', 'canvasPlayerUIHost', 'webDomPlayerUIHost', 'physicsLab', 'planckBattleOrchestrator', 'garageFusion', 'bootstrap-wechat'].filter((n) => bundle.includes(n));
    log(leaked.length === 0, '[iso] I2 Lab bundle 不含正式玩法 Runtime 模块', leaked.length ? `泄漏=${leaked.join(',')}` : `bundle=${jsName} size=${bundle.length}B`);
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
