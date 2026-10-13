/**
 * CONTENT-ENCOUNTER-PLAYABLE-BATCH-R1｜遭遇验证台**扩展批次**的浏览器真实闭环。
 *
 * 手段（与 `_e2e_encounter_lab.cjs` 同源，不伪造任何步骤）：
 *   - 真实浏览器（playwright-core；`_browser_launch.cjs` 统一启动）打开独立产物
 *     `dist-portrait-lab/encounter-lab.html?batch=ext`；
 *   - 真实鼠标点击（page.mouse.click，取按钮真实 getBoundingClientRect 中心）；
 *   - 真实像素读取（canvas.getContext('2d').getImageData，精确 RGB 相等统计）；
 *   - 只读诊断句柄 `window.__ENCOUNTERLAB__`。
 *
 * 它验证本 Queue 的验收：
 *   ① 扩展批次三套内容**真实可切换**：点一个 → 真实战斗 → 打到结束 → 战场冻结；
 *   ② 切换**清场无残留**：每场 fresh 读数干净（步数 0 / 时间 0 / 无弹丸 / 无接触命中伤害）；
 *   ③ 配置 / 结果**真实**：三套对手的模板 id / 耐久上限与正式链路一致；
 *   ④ **默认三敌批次不回归**：同产物不带 query 时仍是 ProtoRusher / Chaser / RangedTurret。
 *
 * 用法：
 *   npm run build:portrait-lab
 *   node tests/_e2e_encounter_lab_ext.cjs        （或 npm run e2e:encounter-lab-ext）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { launchBrowser } = require('./_browser_launch.cjs');

/** ⚠️ 与 encounter-lab(8158) / height-line(8159) 用**不同端口**：E2E 可并存。 */
const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8160;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const PAGE_URL = `${URL_BASE}/encounter-lab.html?batch=ext`;
const PAGE_URL_DEFAULT = `${URL_BASE}/encounter-lab.html`;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
};

/** 舞台带几何（= `runPageLayout.RUN_STAGE_BAND` 浏览器侧镜像）。 */
const BAND = { x: 0, y: 80, w: 390, h: 302 };
/** 待机舞台底色（= `encounterLab.COLORS.stageBg`）。 */
const STAGE_BG = [0x0d, 0x11, 0x19];

/** 扩展批次三套的正式期望（label / 模板 id / 对手耐久上限，来自正式链路）。 */
const EXPECT = [
  { id: 'ExtendedHeavyContact', label: '重装近战', template: 'R1-HVY-02', enemyHpMax: 1000 },
  { id: 'ExtendedStandoffRod', label: '高架子推杆', template: 'R1-CTRL-01', enemyHpMax: 1100 },
  { id: 'ExtendedBurnSaw', label: '高身喷火锯', template: 'R1-MIX-02', enemyHpMax: 1100 },
];

/** 正式世界 / 出生 / 玩家条件（三套必须完全一致）。 */
const COMMON = {
  arenaWidth: 1600,
  arenaHeight: 900,
  groundY: 700,
  spawnAx: 400,
  spawnBx: 1200,
  spawnSeparation: 800,
  playerHpMax: 1100,
  initialPlayerHp: 1100,
};

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}

function startServer() {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/encounter-lab.html';
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

const probeOf = (page) => page.evaluate(() => window.__ENCOUNTERLAB__.probe());

/** 真实鼠标点击一个测试控件（取真实 DOM 矩形中心，不直调业务方法）。 */
async function clickControl(page, id) {
  const box = await page.evaluate((wanted) => {
    const b = document.querySelector(`.elab-btn[data-elab-id="${wanted}"]`);
    if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }, id);
  if (!box) throw new Error('控件不存在：' + id);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(60);
  return box;
}

/** 舞台带真实像素统计（精确 RGB 相等 + 不同色数）。 */
function bandStats(page, target) {
  return page.evaluate(
    ({ band, t }) => {
      const c = document.querySelector('#elab-canvas');
      const ctx = c.getContext('2d');
      const s = c.width / 390;
      const x = Math.floor(band.x * s);
      const y = Math.floor(band.y * s);
      const w = Math.floor(band.w * s);
      const h = Math.floor(band.h * s);
      const d = ctx.getImageData(x, y, w, h).data;
      let exact = 0;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] === t[0] && d[i + 1] === t[1] && d[i + 2] === t[2]) exact += 1;
        seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      }
      return { exact, distinct: seen.size, total: w * h };
    },
    { band: BAND, t: target },
  );
}

async function waitDone(page, timeout = 90000) {
  await page.waitForFunction(() => window.__ENCOUNTERLAB__.probe().phase === 'done', null, { timeout });
}

/** 开局读数残留判据（浏览器侧独立实现一遍，不复用 src 判断逻辑）。 */
function freshProblems(fresh, expectId) {
  const p = [];
  if (!fresh) return ['fresh 为空'];
  if (fresh.encounterId !== expectId) p.push(`encounterId=${fresh.encounterId} 期望 ${expectId}`);
  if (!Array.isArray(fresh.buildIds) || fresh.buildIds.length !== 0) p.push(`buildIds=${JSON.stringify(fresh.buildIds)} 期望 []`);
  if (fresh.initialPlayerHp !== fresh.playerHpMax) p.push(`耐久 ${fresh.initialPlayerHp}/${fresh.playerHpMax} 非满`);
  if (fresh.initialPlayerHp !== COMMON.initialPlayerHp) p.push(`耐久上限 ${fresh.initialPlayerHp} 期望 ${COMMON.initialPlayerHp}`);
  if (fresh.steps !== 0) p.push(`steps=${fresh.steps}`);
  if (fresh.timeMs !== 0) p.push(`timeMs=${fresh.timeMs}`);
  if (fresh.projectiles !== 0) p.push(`存活弹丸=${fresh.projectiles}`);
  if (fresh.contact || fresh.impact || fresh.damage) {
    p.push(`残留 contact=${fresh.contact} impact=${fresh.impact} damage=${fresh.damage}`);
  }
  for (const k of Object.keys(COMMON)) {
    if (fresh[k] !== COMMON[k]) p.push(`${k}=${fresh[k]} 期望 ${COMMON[k]}`);
  }
  if (!(fresh.gapWorld > 0)) p.push(`开局外廓间距=${fresh.gapWorld}（必须 > 0，两车分离）`);
  return p;
}

async function openPage(browser, url, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(
    () => {
      const c = document.querySelector('#elab-canvas');
      if (!window.__ENCOUNTERLAB__ || !c || c.width === 0) return false;
      const p = window.__ENCOUNTERLAB__.probe();
      return p.assets.ready >= 5 && p.assets.failed.length === 0 && p.screen.width > 0;
    },
    null,
    { timeout: 30000 },
  );
  return { ctx, page, pageErrors };
}

/* ==================================================== 扩展批次完整流程 */

async function runExtFlow(browser) {
  const tag = 'EXT';
  const { ctx, page, pageErrors } = await openPage(browser, PAGE_URL, { w: 390, h: 844, dpr: 1 });
  try {
    const p0 = await probeOf(page);
    log(p0.batchMode === 'ext', `[${tag}] A1 URL ?batch=ext 切到扩展批次`, `batchMode=${p0.batchMode}`);
    log(p0.title.includes('扩展'), `[${tag}] A2 扩展批次标题正确`, p0.title);
    log(
      p0.loadoutId === 'WatermelonHeavyCannon' && p0.playerHpMax === 1100,
      `[${tag}] A3 玩家固定 WatermelonHeavyCannon 满耐久`,
      `loadout=${p0.loadoutId} hpMax=${p0.playerHpMax}`,
    );
    log(
      JSON.stringify(p0.batch.map((b) => b.id)) === JSON.stringify(EXPECT.map((e) => e.id)),
      `[${tag}] A4 扩展批次恰好三套且顺序一致`,
      p0.batch.map((b) => b.id).join(','),
    );
    const batchOk = EXPECT.every((e, i) => {
      const b = p0.batch[i];
      return b.label === e.label && b.templateId === e.template && b.count === 1 && b.verifies.length > 0;
    });
    log(batchOk, `[${tag}] A5 三套展示名 / 正式模板 id / 威胁假设全部来自正式链路`,
      p0.batch.map((b) => `${b.id}=${b.label}[${b.templateId}]`).join(' '));

    /* ---- 控件：三个对手 + Reset，且不在画布里 ---- */
    const dom = await page.evaluate(() => {
      const bar = document.querySelector('.elab-bar');
      const btns = Array.from(document.querySelectorAll('.elab-btn'));
      return {
        barChildren: bar ? bar.children.length : -1,
        count: btns.length,
        texts: btns.map((b) => b.textContent),
        ids: btns.map((b) => b.dataset.elabId),
        outsideStage: bar ? !document.querySelector('.elab-stage').contains(bar) : false,
      };
    });
    log(dom.count === 4 && dom.barChildren === 4, `[${tag}] A6 测试控件恰好 4 个（三个对手 + Reset）`, `count=${dom.count}`);
    log(
      JSON.stringify(dom.ids) === JSON.stringify([...EXPECT.map((e) => e.id), 'reset']),
      `[${tag}] A7 控件 id = 扩展三套 + reset`,
      dom.ids.join(' / '),
    );
    log(dom.outsideStage, `[${tag}] A8 测试控件不在画布里`);

    /* ---- 初始 idle ---- */
    log(
      p0.phase === 'idle' && p0.runtimeActive === false && p0.active === null && p0.runtimeSerial === 0 && p0.rounds.length === 0,
      `[${tag}] A9 初始 idle`,
      `phase=${p0.phase} serial=${p0.runtimeSerial}`,
    );
    const idleStats = await bandStats(page, STAGE_BG);
    log(idleStats.exact / idleStats.total > 0.9, `[${tag}] A10 idle 舞台是纯色待机面（真实像素）`,
      `exact=${idleStats.exact}/${idleStats.total}`);

    /* ---- 三套依次切换：真实战斗跑到结束 ---- */
    const outcomes = [];
    for (let i = 0; i < EXPECT.length; i++) {
      const e = EXPECT[i];
      await clickControl(page, e.id);
      const p = await probeOf(page);
      const problems = freshProblems(p.fresh, e.id);
      log(problems.length === 0, `[${tag}] B${i + 1}.1 切到 ${e.id}：开局读数完全干净`,
        problems.length ? problems.join(' | ') : `steps=0 proj=0 contact=false spawn=${p.fresh.spawnAx}/${p.fresh.spawnBx}`);
      log(
        p.fresh.enemyHp === e.enemyHpMax && p.fresh.enemyHpMax === e.enemyHpMax,
        `[${tag}] B${i + 1}.2 ${e.id} 对手耐久上限与正式链路一致`,
        `hp=${p.fresh.enemyHp}/${p.fresh.enemyHpMax} 期望 ${e.enemyHpMax}`,
      );
      log(p.phase === 'running' && p.runtimeActive, `[${tag}] B${i + 1}.3 真实物理推进中`, `phase=${p.phase}`);
      log(p.runtimeSerial === i + 1, `[${tag}] B${i + 1}.4 每次切换都是新运行时（serial 递增）`, `serial=${p.runtimeSerial}`);
      await waitDone(page);
      const d = await probeOf(page);
      log(d.phase === 'done' && d.rounds.length === i + 1, `[${tag}] B${i + 1}.5 ${e.id} 真实打到结束（战场冻结）`,
        `rounds=${d.rounds.length} winner=${d.rounds[i].winner ?? 'null'}`);
      outcomes.push({
        id: e.id,
        winner: d.rounds[i].winner,
        steps: d.rounds[i].steps,
        playerHp: d.rounds[i].playerHp,
        enemyHp: d.rounds[i].enemyHp,
      });
    }

    /* ---- 切换后一场必须完全 cleanup：老的运行时被 dispose ---- */
    // 每次切换都先 dispose 上一场 ⇒ disposed = 已切换次数 - 1（最后一场仍存活）；
    // Reset 会再 +1。这里在 Reset 之前断言：disposed === rounds.length - 1。
    const afterAll = await probeOf(page);
    log(
      afterAll.disposedCount === afterAll.rounds.length - 1 && afterAll.runtimeActive === true,
      `[${tag}] C1 每次切换都 dispose 上一场（最后一场仍存活）`,
      `disposed=${afterAll.disposedCount} rounds=${afterAll.rounds.length} runtime=${afterAll.runtimeActive}`,
    );

    /* ---- Reset：回到纯色待机面 + 清空战果 ---- */
    await clickControl(page, 'reset');
    const afterReset = await probeOf(page);
    log(afterReset.phase === 'idle' && afterReset.runtimeActive === false && afterReset.rounds.length === 0,
      `[${tag}] C2 Reset 回到 idle 且清空战果`, `phase=${afterReset.phase} rounds=${afterReset.rounds.length}`);
    const resetStats = await bandStats(page, STAGE_BG);
    log(resetStats.exact / resetStats.total > 0.9, `[${tag}] C3 Reset 后舞台回到纯色待机面（真实像素）`,
      `exact=${resetStats.exact}/${resetStats.total}`);

    log(pageErrors.length === 0, `[${tag}] C4 页面无运行期异常`, pageErrors.length ? pageErrors.join(' | ') : '0 errors');

    // eslint-disable-next-line no-console
    console.log('  [EXT] 三套实测：' + outcomes.map((o) => `${o.id} w=${o.winner} steps=${o.steps} hpA=${Math.round(o.playerHp)} hpB=${Math.round(o.enemyHp)}`).join(' | '));
  } finally {
    await ctx.close();
  }
}

/* ================================ 默认三敌不回归（同产物不带 query） */

async function runDefaultNoRegression(browser) {
  const tag = 'DEF';
  const { ctx, page, pageErrors } = await openPage(browser, PAGE_URL_DEFAULT, { w: 390, h: 844, dpr: 1 });
  try {
    const p = await probeOf(page);
    log(p.batchMode === 'default', `[${tag}] D1 不带 query ⇒ 默认批次`, `batchMode=${p.batchMode}`);
    log(
      JSON.stringify(p.batch.map((b) => b.id)) === JSON.stringify(['ProtoRusher', 'Chaser', 'RangedTurret']),
      `[${tag}] D2 默认三敌一字不变（ProtoRusher / Chaser / RangedTurret）`,
      p.batch.map((b) => b.id).join(','),
    );
    log(p.title === '遭遇验证台', `[${tag}] D3 默认标题不变`, p.title);
    const dom = await page.evaluate(() => Array.from(document.querySelectorAll('.elab-btn')).map((b) => b.dataset.elabId));
    log(JSON.stringify(dom) === JSON.stringify(['ProtoRusher', 'Chaser', 'RangedTurret', 'reset']),
      `[${tag}] D4 默认控件清单不变`, dom.join(','));

    // 默认批次仍能真实开打（快速验证一场，不强求跑完）
    await clickControl(page, 'ProtoRusher');
    const run = await probeOf(page);
    log(run.phase === 'running' && run.fresh && run.fresh.encounterId === 'ProtoRusher',
      `[${tag}] D5 默认批次仍可真实开战`, `phase=${run.phase} fresh=${run.fresh ? run.fresh.encounterId : 'null'}`);
    log(pageErrors.length === 0, `[${tag}] D6 页面无运行期异常`, pageErrors.length ? pageErrors.join(' | ') : '0 errors');
  } finally {
    await ctx.close();
  }
}

/* ============================================================== 主流程 */

(async () => {
  const server = await startServer();
  let browser;
  try {
    browser = await launchBrowser(chromium);
    await runExtFlow(browser);
    await runDefaultNoRegression(browser);

    // 隔离：扩展批次 chunk 内不含正式玩家 Runtime
    const html = fs.readFileSync(path.join(ROOT, 'encounter-lab.html'), 'utf8');
    const chunkMatch = html.match(/assets\/(encounter-lab[-.\w]*\.js)/);
    log(!!chunkMatch, '[iso] J1 encounter-lab.html 真实引用自己的 chunk', chunkMatch ? chunkMatch[1] : 'none');
    if (chunkMatch) {
      const bytes = fs.readFileSync(path.join(ROOT, 'assets', chunkMatch[1]), 'utf8');
      log(bytes.includes('ExtendedHeavyContact'), '[iso] J2 扩展批次内容已打进 chunk（不是陈旧产物）');
      const leaked = ['playerGameRuntime', 'canvasPlayerUIHost', 'webDomPlayerUIHost', 'garageFusion', 'bootstrap-wechat'].filter(
        (n) => bytes.includes(n),
      );
      log(leaked.length === 0, '[iso] J3 验证台 chunk 内不含正式玩家 Runtime',
        leaked.length ? `命中=${leaked.join(',')}` : `扫描 ${bytes.length}B`);
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log('\n============================');
  console.log(`E2E Encounter Lab EXT: ${results.length - failed.length}/${results.length} PASS`);
  console.log('============================');
  if (failed.length) {
    for (const f of failed) console.log('FAILED: ' + f.name + ' | ' + f.detail);
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
