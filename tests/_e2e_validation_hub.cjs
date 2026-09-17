/**
 * PRP-VALIDATION-HUB-R1｜验证中心的**浏览器真实闭环**。
 *
 * 手段（与既有 PRP E2E 同源，不伪造任何步骤）：
 *   - 真实浏览器（playwright-core / msedge，回退默认 chromium）打开独立产物
 *     `dist-portrait-lab/validation-hub.html`；
 *   - **真实鼠标点击**（page.mouse.click，取卡片真实 getBoundingClientRect 中心）；
 *   - **真实整页导航**（点卡片 = 浏览器加载入口页面本身）+ **真实浏览器后退**；
 *   - 只读诊断句柄 `window.__VALIDATIONHUB__` / `__RUNPAGE__` / `__ENCOUNTERLAB__`。
 *
 * 它验证的是本 Queue 的六条技术验收（纯测试壳，不做玩法）：
 *
 *   ① 一条命令启动验证中心（`npm run dev:validation` 指向的正是本页；H-10 在 node 侧钉死）
 *   ② 三个验证入口都能进：Full Run / Next Run / Encounter Batch，各自真的是那一条验证
 *   ③ 返回 Hub 后能切下一个：后退 → Hub（标记推进）→ 点下一张卡
 *   ④ 切换**彻底清理**：上一份文档真实开过一场（脏了）→ 切回来开局读数逐项干净，
 *      运行时序号 / 场次记录 / 画布数量一个都没跟过来（Runtime / 弹丸 / 接触 /
 *      计时器 / 监听器随文档销毁）
 *   ⑤ 控件与玩家画面分离：Hub **没有画布**、不显示任何运行期读数；
 *      三个入口页面里 0 处 Hub 字面量（Hub 不往玩家画面注入东西）
 *   ⑥ Hub 是纯导航：它的 chunk 不加载任何正式玩法 / 战斗 / 物理代码
 *
 * 用法：
 *   npm run build:portrait-lab
 *   node tests/_e2e_validation_hub.cjs        （或 npm run e2e:validation-hub）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

/** ⚠️ 与 run-page(8156) / next-run(8157) / encounter-lab(8158) 用**不同端口**：四个 E2E 可并存。 */
const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8159;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
};

/**
 * 三个入口的**浏览器侧镜像**（刻意手写，不读源码表）：
 * 如果 Hub 上摆的东西变了而这里没变，本文件必须失败。
 */
const EXPECT = [
  { id: 'fullRun', label: 'Full Run', pageFile: 'run-page.html', probe: '__RUNPAGE__' },
  { id: 'nextRun', label: 'Next Run', pageFile: 'next-run.html', probe: '__RUNPAGE__' },
  { id: 'encounterBatch', label: 'Encounter Batch', pageFile: 'encounter-lab.html', probe: '__ENCOUNTERLAB__' },
];

/** 三个入口页面（源文件）：任何一个出现 Hub 字面量都说明「Hub 往玩家画面伸手了」。 */
const ENTRY_PAGES = ['run-page.html', 'next-run.html', 'encounter-lab.html'];
const HUB_TOKENS = ['validation-hub', 'vhub', '__VALIDATIONHUB__'];

/** 三套 Encounter 的正式期望（与 M3 同源，用于「新文档开局干净」判据）。 */
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

/** 页面文本里**不允许**出现的运行期读数形态（Hub 只是导航）。 */
const READOUT_RE = /(\d+(\.\d+)?\s*(fps|hz|ms|px|%))|\b(fps|damage|hitbox|physics|hitbox)\b/i;

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}

function startServer() {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/validation-hub.html';
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

const hubProbe = (page) => page.evaluate(() => window.__VALIDATIONHUB__.probe());
const runProbe = (page) => page.evaluate(() => window.__RUNPAGE__.probe());
const elabProbe = (page) => page.evaluate(() => window.__ENCOUNTERLAB__.probe());
const markerText = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.vhub-marker');
    return el ? el.textContent : null;
  });

/** 打开验证中心并等它 boot 完（探针出现）。 */
async function openHub(page) {
  await page.goto(`${URL_BASE}/validation-hub.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__VALIDATIONHUB__ !== 'undefined');
}

/** 真实鼠标点击一张入口卡片，并等**目标入口页面**真正加载完（探针出现）。 */
async function clickCard(page, id) {
  const want = EXPECT.find((e) => e.id === id);
  if (!want) throw new Error('未知卡片：' + id);
  const box = await page.evaluate((wanted) => {
    const a = document.querySelector(`a.vhub-card[data-vhub-id="${wanted}"]`);
    if (!a) return null;
    const r = a.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }, id);
  if (!box) throw new Error('卡片不存在：' + id);
  if (!(box.w > 0 && box.h > 0)) throw new Error('卡片尺寸为 0：' + id);
  await page.mouse.click(box.x, box.y);
  await page.waitForFunction(
    ({ wantPath, probe }) => location.pathname === wantPath && typeof window[probe] !== 'undefined',
    { wantPath: `/${want.pageFile}`, probe: want.probe },
    { timeout: 20000 },
  );
  return box;
}

/** 真实浏览器后退回验证中心，并等标记刷新（bfcache 恢复时靠 pageshow 重读）。 */
async function goHub(page) {
  await page.goBack();
  // ⚠️ 判据用「Hub 真的渲染出来了」而不是某个具体 pathname：
  //    第一次是从 `/` 打开 Hub 的（`npm run dev` 的落地形式），后退会回到 `/`；
  //    之后从显式 `/validation-hub.html` 打开时后退回的就是那个路径。两者都是「回到了 Hub」。
  await page.waitForFunction(
    () =>
      typeof window.__VALIDATIONHUB__ !== 'undefined' &&
      document.querySelectorAll('a.vhub-card').length === 3,
    undefined,
    { timeout: 20000 },
  );
}

/** 真实鼠标点击遭遇验证台的一个测试控件（取真实 DOM 矩形中心，不直调业务方法）。 */
async function clickElabControl(page, id) {
  const box = await page.evaluate((wanted) => {
    const b = document.querySelector(`.elab-btn[data-elab-id="${wanted}"]`);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);
  if (!box) throw new Error('控件不存在：' + id);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(60);
}

/** 「新文档开局」的干净判据（**没有**任何一场建过 = 没有 residue 可言）。 */
function blankProblems(p) {
  const out = [];
  if (p.fresh !== null) out.push(`fresh 非空：${JSON.stringify(p.fresh)}`);
  if (p.runtimeActive !== false) out.push(`runtimeActive=${p.runtimeActive}`);
  if (p.runtimeSerial !== 0) out.push(`runtimeSerial=${p.runtimeSerial}`);
  if (p.disposedCount !== 0) out.push(`disposedCount=${p.disposedCount}`);
  if (p.rounds.length !== 0) out.push(`rounds=${p.rounds.length}`);
  if (p.active !== null) out.push(`active=${p.active}`);
  if (p.phase !== 'idle') out.push(`phase=${p.phase}`);
  return out;
}

/** 已建过一场时的开局读数判据（镜像 M3 的 freshProblems）。 */
function freshProblems(fresh, expectId) {
  const p = [];
  if (!fresh) return ['fresh 为空'];
  if (fresh.encounterId !== expectId) p.push(`encounterId=${fresh.encounterId} 期望 ${expectId}`);
  if (!Array.isArray(fresh.buildIds) || fresh.buildIds.length !== 0) p.push(`buildIds=${JSON.stringify(fresh.buildIds)} 期望 []`);
  if (fresh.initialPlayerHp !== fresh.playerHpMax) p.push(`耐久 ${fresh.initialPlayerHp}/${fresh.playerHpMax} 非满`);
  if (fresh.steps !== 0) p.push(`steps=${fresh.steps}`);
  if (fresh.timeMs !== 0) p.push(`timeMs=${fresh.timeMs}`);
  if (fresh.projectiles !== 0) p.push(`存活弹丸=${fresh.projectiles}`);
  if (fresh.contact || fresh.impact || fresh.damage) {
    p.push(`残留 contact=${fresh.contact} impact=${fresh.impact} damage=${fresh.damage}`);
  }
  for (const k of Object.keys(COMMON)) {
    if (fresh[k] !== COMMON[k]) p.push(`${k}=${fresh[k]} 期望 ${COMMON[k]}`);
  }
  return p;
}

/* ================================================== 主流程：①-⑥ */

async function runFlow(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  try {
    /* ---------------------------------------------------- ① 一条命令启动 */
    const resp = await page.goto(`${URL_BASE}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.__VALIDATIONHUB__ !== 'undefined');
    log(resp && resp.status() === 200, '[V1] 验证中心一条命令启动即可打开（/ 落到本页）', `status=${resp ? resp.status() : 'n/a'}`);

    // 再走一遍显式 URL（= `npm run dev:validation` 真正打开的那个地址），把后续历史规范化
    await page.goto(`${URL_BASE}/validation-hub.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.__VALIDATIONHUB__ !== 'undefined');
    log(
      (await page.evaluate(() => location.pathname)) === '/validation-hub.html',
      '[V1b] 显式地址（dev:validation 打开的那个）同样落在验证中心',
      `pathname=${await page.evaluate(() => location.pathname)}`,
    );

    /* ------------------------------------------- ⑤ Hub 没有画布 / 没有读数 */
    const p0 = await hubProbe(page);
    log(p0.cardCount === 3 && p0.entries.length === 3, '[V2] Hub 上恰好三张入口卡片', `cards=${p0.cardCount}`);
    const domCounts = await page.evaluate(() => ({
      canvas: document.querySelectorAll('canvas').length,
      img: document.querySelectorAll('img').length,
      debugAttrs: [...document.querySelectorAll('*')].filter((el) =>
        [...el.attributes].some((a) => /^data-(fps|debug|state|damage|physics|probe)/i.test(a.name)),
      ).length,
      text: document.body.innerText,
    }));
    log(
      p0.canvasCount === 0 && domCounts.canvas === 0,
      '[V3] Hub 上没有画布（录像区域不存在混入 Debug 数据的物理条件）',
      `probe=${p0.canvasCount} dom=${domCounts.canvas}`,
    );
    log(domCounts.debugAttrs === 0, '[V4] Hub 上没有调试数据属性（fps / debug / state / damage / physics）', `count=${domCounts.debugAttrs}`);
    log(!READOUT_RE.test(domCounts.text), '[V5] Hub 渲染文本里没有任何运行期读数', `chars=${domCounts.text.length}`);

    /* ------------------------------------------- ② 三个入口都能进 */
    const ids = p0.entries.map((e) => e.id);
    const labels = p0.entries.map((e) => e.label);
    log(
      JSON.stringify(ids) === JSON.stringify(EXPECT.map((e) => e.id)) &&
        JSON.stringify(labels) === JSON.stringify(EXPECT.map((e) => e.label)),
      '[V6] 三张卡的 id / 顺序 / label 与镜像表逐项一致',
      `${ids.join(',')} · ${labels.join(' / ')}`,
    );
    const hrefsOk = EXPECT.every((e) => p0.entries.find((x) => x.id === e.id).pageFile === e.pageFile);
    log(hrefsOk, '[V7] 三张卡分别指向三个真实入口页面', EXPECT.map((e) => e.pageFile).join(' / '));

    // —— 第 1 张：Full Run = 玩家正式页面本身，进去必须是「全新一局」
    await clickCard(page, 'fullRun');
    const run0 = await runProbe(page);
    log(
      run0.phase === 'IDLE' && run0.nodeId === 'd1-start' && run0.day === 1 && run0.battlesCompleted === 0,
      '[V8] Full Run 进入的是玩家正式页面本身，且是全新一局（DAY 1 / 未打任何一场）',
      `phase=${run0.phase} node=${run0.nodeId} day=${run0.day}`,
    );
    log(
      run0.battle === null && run0.stage.mode === 'idle' && run0.build.length === 0 && run0.logCount > 0,
      '[V9] Full Run 开局没有残留战斗运行时（待机近景 / 空 Build / 起始日志已就位）',
      `battle=${run0.battle === null ? 'null' : 'present'} mode=${run0.stage.mode} log=${run0.logCount}`,
    );

    /* --------------------------------- ③ 返回 Hub 后能切下一个（标记推进） */
    await goHub(page);
    const m1 = await markerText(page);
    const p1 = await hubProbe(page);
    log(p1.lastEntry === 'fullRun' && p1.nextEntry === 'nextRun', '[V10] 回到 Hub：标记记下 Full Run，并指出下一个是 Next Run', `last=${p1.lastEntry} next=${p1.nextEntry}`);
    log(m1 !== null && m1.includes('Full Run') && m1.includes('Next Run'), '[V11] 标记真的显示在页面上（不只是探针里有）', String(m1));

    // —— 第 2 张：Next Run 必须真的是 M2 那条验证流程
    await clickCard(page, 'nextRun');
    const nr = await runProbe(page);
    log(nr.nextRunValidation === true, '[V12] Next Run 进入的确实是「下一局起始改装」验证流程', `nextRunValidation=${nr.nextRunValidation}`);
    log(
      nr.priorRun !== null && nr.priorRun.complete === true && nr.phase === 'COMPLETE',
      '[V13] Next Run 开局就是「上一局已 RUN COMPLETE」（= M2 验证流程本身）',
      nr.priorRun ? `prior day=${nr.priorRun.day} 耐久=${nr.priorRun.durabilityPercent}% complete=${nr.priorRun.complete}` : 'priorRun=null',
    );

    await goHub(page);
    const p2 = await hubProbe(page);
    log(p2.lastEntry === 'nextRun' && p2.nextEntry === 'encounterBatch', '[V14] 回到 Hub：标记推进到 Next Run，下一项 Encounter Batch', `last=${p2.lastEntry} next=${p2.nextEntry}`);

    // —— 第 3 张：Encounter Batch 必须真的是 M3 那三个对手的对照台
    await clickCard(page, 'encounterBatch');
    const elab0 = await elabProbe(page);
    const blank = blankProblems(elab0);
    log(
      elab0.batch.length === 3 && elab0.batch.map((b) => b.id).join(',') === 'ProtoRusher,Chaser,RangedTurret',
      '[V15] Encounter Batch 进入的是那三个正式对手的对照台（不改任何定义）',
      elab0.batch.map((b) => `${b.id}`).join(','),
    );
    log(blank.length === 0, '[V16] 刚进入 Encounter Batch：还没有任何一场被建过（无 residue 可言）', blank.length ? blank.join(' | ') : 'blank');
    log(
      elab0.loadoutId === 'WatermelonHeavyCannon' && elab0.playerHpMax === 1100,
      '[V17] 玩家条件不变：同一个 WatermelonHeavyCannon / 满耐久',
      `loadout=${elab0.loadoutId} 车身=${elab0.playerBodyName} HP ${elab0.playerHpMax}`,
    );

    /* ------------------- ④ 切换彻底清理：先真的脏一场，再切走再切回来 */
    await clickElabControl(page, 'ProtoRusher');
    await page.waitForTimeout(700);
    const dirty = await elabProbe(page);
    log(
      dirty.runtimeActive === true && dirty.live !== null && dirty.live.steps > 0 && dirty.runtimeSerial === 1,
      '[V18] 切换前这一场确实「脏了」（真实物理在推进；单次点击只建了一个运行时）',
      `serial=${dirty.runtimeSerial} steps=${dirty.live ? dirty.live.steps : -1} inFlight=${dirty.live ? dirty.live.projectiles : -1} timeMs=${dirty.live ? dirty.live.timeMs : -1}`,
    );
    log(
      dirty.live.steps > 0 && (dirty.live.contact || dirty.live.damage || dirty.live.projectiles > 0 || dirty.live.impact),
      '[V19] 这一场留下了「真的脏过」的证据（弹丸 / 接触 / 命中 / 伤害至少其一）',
      dirty.live ? `projectiles=${dirty.live.projectiles} contact=${dirty.live.contact} impact=${dirty.live.impact} damage=${dirty.live.damage}` : 'live=null',
    );

    // 真实浏览器后退 → 回 Hub → 再进同一个入口（新文档）
    await goHub(page);
    const p3 = await hubProbe(page);
    log(p3.lastEntry === 'encounterBatch' && p3.nextEntry === 'fullRun', '[V20] 回到 Hub：标记推进到 Encounter Batch（循环回 Full Run）', `last=${p3.lastEntry} next=${p3.nextEntry}`);

    await clickCard(page, 'encounterBatch');
    const elab1 = await elabProbe(page);
    const blank1 = blankProblems(elab1);
    log(blank1.length === 0, '[V21] 切回来开局读数逐项干净（运行时 / 场次记录 / 激活项全部归零）', blank1.length ? blank1.join(' | ') : 'blank');
    const canvasNow = await page.evaluate(() => document.querySelectorAll('canvas').length);
    log(canvasNow === 1, '[V22] 只存在一块画布（旧文档的画布与它的循环一起消失）', `canvas=${canvasNow}`);

    // 单次点击 = 单次建场（若监听器有重复，这里会 +2）
    await clickElabControl(page, 'ProtoRusher');
    const one = await elabProbe(page);
    log(one.runtimeSerial === 1, '[V23] 新文档里点一次只建一个运行时（没有重复监听器）', `serial=${one.runtimeSerial}`);
    const oneProblems = freshProblems(one.fresh, 'ProtoRusher');
    log(oneProblems.length === 0, '[V23b] 重建后的开局读数同样干净（首场无残留）', oneProblems.length ? oneProblems.join(' | ') : 'clean');
    await clickElabControl(page, 'Chaser');
    const two = await elabProbe(page);
    log(two.runtimeSerial === 2 && two.disposedCount === 1, '[V24] 第二次点击严格 +1（且旧实例已被 dispose）', `serial=${two.runtimeSerial} disposed=${two.disposedCount}`);
    const twoProblems = freshProblems(two.fresh, 'Chaser');
    log(twoProblems.length === 0, '[V24b] 换对手后的开局读数同样干净', twoProblems.length ? twoProblems.join(' | ') : 'clean');

    await goHub(page);
    log(
      (await page.evaluate(() => document.querySelectorAll('a.vhub-card').length)) === 3,
      '[V25] 从第三个入口也能回到 Hub 并继续切换',
      `url=${page.url()}`,
    );

    log(pageErrors.length === 0, '[V26] 全程（Hub + 三个入口 + 来回切换）无运行期异常', pageErrors.length ? pageErrors.join(' | ') : '0 errors');
  } finally {
    await ctx.close();
  }
}

/* ============================================ 结构：窄屏 / 非 1 DPR 也成立 */

async function runStructural(browser) {
  const vp = { w: 390, h: 844, dpr: 3, tag: '390x844@3' };
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  try {
    await openHub(page);
    const p = await hubProbe(page);
    log(p.cardCount === 3, `[${vp.tag}] S1 窄屏下三张卡都在`, `cards=${p.cardCount}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    log(overflow <= 1, `[${vp.tag}] S2 无横向溢出（卡片不越界）`, `overflow=${overflow}px`);
    const noCanvas = await page.evaluate(() => document.querySelectorAll('canvas').length === 0);
    log(noCanvas, `[${vp.tag}] S3 Hub 仍然没有画布`, `canvas=${noCanvas ? 0 : '>0'}`);

    await clickCard(page, 'nextRun');
    const nr = await runProbe(page);
    log(nr.nextRunValidation === true, `[${vp.tag}] S4 非 1 DPR 下也能从 Hub 进入验证流程`, `nextRunValidation=${nr.nextRunValidation}`);
    await goHub(page);
    log(
      (await page.evaluate(() => location.pathname.endsWith('validation-hub.html'))) === true &&
        (await hubProbe(page)).lastEntry === 'nextRun',
      `[${vp.tag}] S5 非 1 DPR 下后退回 Hub 且标记正确`,
      'last=nextRun',
    );
    log(pageErrors.length === 0, `[${vp.tag}] S6 页面无运行期异常`, pageErrors.length ? pageErrors.join(' | ') : '0 errors');
  } finally {
    await ctx.close();
  }
}

/* ================================================== 隔离：Hub 是纯导航 */

function runIsolation() {
  // ⑥ Hub 的 chunk 里不能有任何正式玩法 / 战斗 / 物理代码 —— 否则它就不是「纯导航」
  const hubHtml = fs.readFileSync(path.join(ROOT, 'validation-hub.html'), 'utf8');
  const refs = [...hubHtml.matchAll(/assets\/([\w.-]+\.js)/g)].map((m) => m[1]);
  log(refs.length > 0, '[iso] I1 验证中心引用了自己的 chunk（不是陈旧产物 / 不是空壳）', refs.join(', '));
  const hubChunk = refs.find((f) => f.startsWith('validation-hub-'));
  log(!!hubChunk, '[iso] I2 找到验证中心自己的 chunk', hubChunk || 'none');
  if (hubChunk) {
    const bytes = fs.readFileSync(path.join(ROOT, 'assets', hubChunk), 'utf8');
    const banned = [
      'planck',
      'PlanckBattleOrchestrator',
      'contactRouter',
      'damageResolver',
      'playerGameRuntime',
      'canvasPlayerUIHost',
      'webDomPlayerUIHost',
      'garageFusion',
      'bootstrap-wechat',
      'visualRegistry',
      'renderer',
    ].filter((n) => bytes.includes(n));
    log(
      banned.length === 0,
      '[iso] I3 验证中心 chunk 内 0 处正式玩法 / 战斗 / 物理 / 平台代码（Hub 只是导航）',
      banned.length ? `命中=${banned.join(',')}` : `扫描 ${bytes.length}B`,
    );
  }
  // 它只引用了自己（+ Vite 的 modulepreload polyfill），不捎带任何战斗 chunk
  const others = refs.filter((f) => !f.startsWith('validation-hub-') && !f.startsWith('modulepreload-polyfill-'));
  log(others.length === 0, '[iso] I4 验证中心不加载任何战斗 / 页面 chunk', others.length ? others.join(', ') : 'only self');

  // ⑤ 三个入口页面不得含 Hub 字面量（剥 HTML 注释后判：注释里说明隔离关系不算引用）
  const stripHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
  const leaked = [];
  for (const f of ENTRY_PAGES) {
    const code = stripHtml(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    for (const t of HUB_TOKENS) if (code.includes(t)) leaked.push(`${f}:${t}`);
    if (code.includes('<button') && f === 'run-page.html') leaked.push(`${f}:<button>`);
  }
  log(leaked.length === 0, '[iso] I5 三个入口页面内 0 处 Hub 字面量（Hub 不向玩家画面注入东西）', leaked.length ? leaked.join(' | ') : 'clean');

  // 玩家页面不加载验证中心的 chunk
  const playerHtml = fs.readFileSync(path.join(ROOT, 'run-page.html'), 'utf8');
  log(!playerHtml.includes('validation-hub'), '[iso] I6 玩家页面不加载验证中心的任何资源', `扫描 ${playerHtml.length}B`);
  // 独立产物内不含正式入口
}

/* ============================================================== 主流程 */

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

    await runFlow(browser);
    await runStructural(browser);
    runIsolation();

    const idx = await fetch(`${URL_BASE}/index.html`);
    log(idx.status === 404, '[iso] I7 独立产物内不含正式入口 index.html', `status=${idx.status}`);
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log('\n============================');
  console.log(`E2E Validation Hub: ${results.length - failed.length}/${results.length} PASS`);
  console.log('============================');
  if (failed.length) {
    for (const f of failed) console.log('FAILED: ' + f.name + ' | ' + f.detail);
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
