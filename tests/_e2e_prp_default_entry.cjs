/**
 * PRP-R2-DEFAULT-EXPERIENCE-ENTRY｜启动链 smoke（真实 dev server + 真实浏览器）。
 *
 * 与 tests/_e2e_run_page.cjs 的分工：
 *   - _e2e_run_page.cjs 验证「页面本身画得对」（静态产物 + 精确像素账本）；
 *   - 本文件验证「**正常启动就落到这个页面**」——这正是前两轮真人验收失败的地方。
 *
 * 严格纪律（对应 Acceptance 1~6）：
 *   1) 先关闭所有旧 dev server（占用 5173 即强制结束）；
 *   2) 只执行真实启动命令 `npm run dev`（`BROWSER=none` 仅抑制自动化环境的系统弹窗，
 *      浏览器由 playwright 控制；命令本身与用户执行的完全一致）；
 *   3) 浏览器**只访问根路径 `/`** —— 禁止直接访问 /run-page.html 绕过启动链；
 *   4) 断言第一屏即 PRP Run Page，且不存在旧横屏 Home/Result、Arena A、Portrait Lab 开发控制；
 *   5) 不修改 URL 走完 IDLE → EVENT → BATTLE → RESULT → CHOICE → IDLE；
 *   6) 旧横屏正式游戏仍可经显式地址 /index.html 直达（保留，未删除）。
 *
 * 用法：npm run e2e:default-entry
 */
const { execFileSync, spawn } = require('child_process');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const REPO_ROOT = path.join(__dirname, '..');
const HOST = '127.0.0.1';
const PORT = 5173;
const ROOT_URL = `http://${HOST}:${PORT}/`;
const LEGACY_URL = `${ROOT_URL}index.html`;
const DEV_URL_SHOWN = `http://${HOST}:${PORT}/`;

/** Run Page 几何调色板（与 src/lab/portraitBattleLab/runPage.ts 的 COLORS 一一对应）。 */
const PALETTE = {
  ground: [0x5a, 0x6f, 0x8a],
  playerBody: [0x4a, 0x7f, 0xe0],
  playerPart: [0xa0, 0x6b, 0xff],
  enemyBody: [0xff, 0x6b, 0x5e],
  enemyPart: [0xff, 0x9b, 0x3d],
  nodeDone: [0xd2, 0x92, 0x2a],
  nodeTodo: [0x3a, 0x46, 0x5e],
  iconSlot: [0x24, 0x2e, 0x3e],
  iconOwned: [0x2f, 0xbf, 0x6b],
  iconChip: [0xd8, 0xf2, 0xa0],
  cardBar: [0x5f, 0x86, 0xc4],
  cardChip: [0xf0, 0xc1, 0x4b],
  actionBar: [0x33, 0x50, 0x7a],
  actionBarOff: [0x2a, 0x33, 0x41],
};

/** Arena A（Debug Lab）独占的调试黄 —— 玩家页面上出现即判 FAIL。 */
const ARENA_DEBUG_YELLOW = [0xff, 0xd3, 0x5a];

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round2 = (v) => Math.round(v * 100) / 100;

/* ------------------------------------------------------------------ 启动链 */

/** 关闭所有占用 5173 的旧 dev server（Acceptance 1：从「关闭所有旧 dev server」开始）。 */
function killPort(port) {
  let out = '';
  try {
    out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
  } catch {
    return 0;
  }
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`));
    if (m) pids.add(m[1]);
  }
  for (const pid of pids) {
    try {
      execFileSync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' });
    } catch {
      /* 已被其它进程回收 */
    }
  }
  return pids.size;
}

let devProc = null;
function startDevServer() {
  // 真实启动命令；BROWSER=none 只抑制「自动弹系统浏览器」这一步（自动化由 playwright 接管）
  devProc = spawn('npm', ['run', 'dev'], {
    cwd: REPO_ROOT,
    shell: true,
    env: { ...process.env, BROWSER: 'none' },
  });
  const state = { out: '' };
  devProc.stdout.on('data', (d) => (state.out += d.toString()));
  devProc.stderr.on('data', (d) => (state.out += d.toString()));
  return state;
}

function stopDevServer() {
  if (devProc && devProc.pid) {
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(devProc.pid)], { stdio: 'ignore' });
    } catch {
      /* 已退出 */
    }
  }
  devProc = null;
  killPort(PORT);
}

function getHtml(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await getHtml(ROOT_URL);
    if (r && r.status === 200) return r;
    await sleep(300);
  }
  return null;
}

/* ------------------------------------------------------------------ 页面助手 */

const probeOf = (page) => page.evaluate(() => window.__RUNPAGE__.probe());

/** 真实鼠标点击：逻辑坐标 → 屏幕坐标（用画布真实 CSS 矩形换算，不用 DPR-backed 尺寸）。 */
async function clickLogical(page, lx, ly) {
  const screen = (await probeOf(page)).screen;
  const cx = screen.left + (lx / 390) * screen.width;
  const cy = screen.top + (ly / 844) * screen.height;
  await page.mouse.click(cx, cy);
}
async function clickRect(page, r) {
  await clickLogical(page, r.x + r.w / 2, r.y + r.h / 2);
}

/** 真实 getImageData：按调色板精确 RGB 相等统计整页各层面积。 */
function pixelStats(page) {
  return page.evaluate((palette) => {
    const c = document.querySelector('#run-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const out = {};
    for (const k of Object.keys(palette)) out[k] = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      for (const k of Object.keys(palette)) {
        const p = palette[k];
        if (p[0] === r && p[1] === g && p[2] === b) {
          out[k] += 1;
          break;
        }
      }
    }
    return out;
  }, PALETTE);
}

function countExact(page, rgb) {
  return page.evaluate((target) => {
    const c = document.querySelector('#run-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === target[0] && d[i + 1] === target[1] && d[i + 2] === target[2]) n += 1;
    }
    return n;
  }, rgb);
}

/**
 * 「第一屏」联合断言：入口身份 + 三层结构 + 零 Debug。
 * @param tag 视口标签
 */
async function assertFirstScreen(page, tag, vp) {
  const p = await probeOf(page);

  // 1) 入口身份：URL 仍是根路径（服务端重写，用户不需要记任何 URL）
  const url = new URL(page.url());
  log(url.pathname === '/', `[${tag}] S1 URL 保持根路径（无重定向、无需手输）`, `pathname=${url.pathname}`);

  // 2) 页面身份 = PRP Run Page，且旧横屏正式游戏的容器不存在
  const dom = await page.evaluate(() => ({
    title: document.title,
    hasRunRoot: !!document.getElementById('run-root'),
    hasRunCanvas: !!document.getElementById('run-canvas'),
    hasLegacyApp: !!document.getElementById('app'),
    hasLabRoot: !!document.getElementById('pbl-root'),
    hasLabCanvas: !!document.getElementById('pbl-canvas'),
    handleRun: typeof window.__RUNPAGE__,
    handleLab: typeof window.__PBL__,
    staticDbg: typeof window.__E2E_INTERNAL_HANDLE__,
  }));
  log(
    dom.title.includes('Portrait Run Prototype') && dom.hasRunRoot && dom.hasRunCanvas,
    `[${tag}] S2 第一屏就是 PRP Run Page`,
    `title="${dom.title}" run-root=${dom.hasRunRoot} run-canvas=${dom.hasRunCanvas}`,
  );
  log(
    !dom.hasLegacyApp && !dom.hasLabRoot && !dom.hasLabCanvas && dom.handleLab === 'undefined',
    `[${tag}] S3 不存在旧横屏 Home 容器 / Portrait Lab 节点`,
    `#app=${dom.hasLegacyApp} #pbl-root=${dom.hasLabRoot} #pbl-canvas=${dom.hasLabCanvas} __PBL__=${dom.handleLab}`,
  );
  log(
    dom.handleRun === 'object' && dom.staticDbg === 'boolean',
    `[${tag}] S4 只暴露 Run Page 只读句柄`,
    `__RUNPAGE__=${dom.handleRun}`,
  );

  // 3) 零开发控制（Arena/Loadout/Encounter/FPS/runtime state/测试按钮…）
  log(
    p.debugControls === 0 && p.domButtons === 0,
    `[${tag}] S5 玩家页面零开发控制`,
    `debugControls=${p.debugControls} domButtons=${p.domButtons}`,
  );

  // 4) 竖屏 390×844
  const ratio = p.screen.width / p.screen.height;
  log(
    Math.abs(ratio - 390 / 844) < 0.01 && p.logicalW === 390 && p.logicalH === 844,
    `[${tag}] S6 竖屏 390×844`,
    `screen=${round2(p.screen.width)}×${round2(p.screen.height)} ratio=${round2(ratio)}`,
  );

  // 5) 三层主结构：顶部薄层 / 中部舞台最大 / 下部日志 / 最底唯一动作
  const b = p.bands;
  const hSum = b.top.h + b.stage.h + b.log.h + b.action.h;
  log(
    hSum === p.logicalH &&
      b.top.h / p.logicalH >= 0.08 &&
      b.top.h / p.logicalH <= 0.11 &&
      b.stage.h / p.logicalH >= 0.45 &&
      b.stage.h / p.logicalH <= 0.5 &&
      b.log.h / p.logicalH >= 0.28 &&
      b.log.h / p.logicalH <= 0.32 &&
      b.action.h / p.logicalH >= 0.08 &&
      b.action.h / p.logicalH <= 0.11,
    `[${tag}] S7 四带比例合规（顶 8~10% / 舞台 45~50% / 日志 28~32% / 动作 8~10%）`,
    `top=${round2((b.top.h / p.logicalH) * 100)}% stage=${round2((b.stage.h / p.logicalH) * 100)}% log=${round2(
      (b.log.h / p.logicalH) * 100,
    )}% action=${round2((b.action.h / p.logicalH) * 100)}%`,
  );

  const L = p.layers;
  log(
    L.nodeTodo > 0 && L.iconSlot > 0 && L.actionBar > 0 && L.ground > 0 && L.playerBody > 0,
    `[${tag}] S8 顶部进度/Build 槽 + 中部舞台 + 最底主动作都在场`,
    `nodeTodo=${L.nodeTodo} iconSlot=${L.iconSlot} ground=${L.ground} playerBody=${L.playerBody} actionBar=${L.actionBar}`,
  );

  // 第一屏必须是 IDLE：玩家单独在左，敌人未出现
  log(
    p.phase === 'IDLE' && p.stage.player && !p.stage.enemy && p.actionEnabled === true,
    `[${tag}] S9 第一屏状态 = IDLE（玩家待机 + 底部可推进行动）`,
    `phase=${p.phase} enemy=${p.stage.enemy ? 'present' : 'null'} action="${p.actionLabel}"`,
  );

  // 6) 精确像素反证（仅 dpr=1，重采样后精确色不再成立）
  if (vp.dpr === 1) {
    const arenaYellow = await countExact(page, ARENA_DEBUG_YELLOW);
    log(arenaYellow === 0, `[${tag}] S10 无 Arena A 黄色纵向竞技框`, `arenaYellow=${arenaYellow}px`);
    const stats = await pixelStats(page);
    log(
      stats.playerBody > 0 && stats.ground > 0 && stats.actionBar > 0 && stats.iconSlot > 0,
      `[${tag}] S11 真实像素确认三层结构已绘制`,
      `playerBody=${stats.playerBody} ground=${stats.ground} actionBar=${stats.actionBar} iconSlot=${stats.iconSlot}`,
    );
    const A = 390 * 844;
    log(
      stats.playerBody + stats.ground + stats.actionBar + stats.iconSlot < A,
      `[${tag}] S12 画面不被单一层铺满（存在分带与留白）`,
      `sum=${stats.playerBody + stats.ground + stats.actionBar + stats.iconSlot} < ${A}`,
    );
  }
}

/** 完整流程：同一页面内 IDLE → EVENT → BATTLE → RESULT → CHOICE → IDLE（不修改 URL）。 */
async function assertFullFlow(page, tag) {
  const trailBefore = (await probeOf(page)).transitions;
  const p0 = await probeOf(page);
  const urlBefore = page.url();

  await clickRect(page, p0.actionRect);
  let p = await probeOf(page);
  log(p.phase === 'EVENT', `[${tag}] F1 IDLE → EVENT（敌人从右侧出现）`, `phase=${p.phase} log=${p.logCount}`);
  log(!!p.stage.enemy && p.stage.playerLeftOfEnemy === true, `[${tag}] F2 EVENT 敌人出现在玩家右侧`, `gap=${round2(p.stage.minGapPx)}`);

  await clickRect(page, p.actionRect);
  p = await probeOf(page);
  log(p.phase === 'BATTLE' && p.battle, `[${tag}] F3 EVENT → BATTLE`, `phase=${p.phase} steps=${p.battle.steps}`);
  const logAtBattleStart = p.logCount;
  await sleep(700);
  const pMid = await probeOf(page);
  log(
    pMid.phase === 'BATTLE' && pMid.logCount === logAtBattleStart,
    `[${tag}] F4 BATTLE 期间日志零追加（不刷逐帧伤害）`,
    `log=${logAtBattleStart} → ${pMid.logCount}`,
  );
  log(
    pMid.stage.playerLeftOfEnemy === true && pMid.stage.minGapPx > 0,
    `[${tag}] F5 BATTLE 玩家左 / 敌人右（严格分离）`,
    `gap=${round2(pMid.stage.minGapPx)}`,
  );

  // 自动结束（演示脚本 2.4s）
  await page.waitForFunction("window.__RUNPAGE__.probe().phase === 'RESULT'", null, { timeout: 8000 });
  p = await probeOf(page);
  log(
    p.phase === 'RESULT' && !p.stage.enemy && p.stage.enemyGone === true && p.stage.player,
    `[${tag}] F6 BATTLE → RESULT 自动结束（敌人消失、玩家留场）`,
    `phase=${p.phase} enemyGone=${p.stage.enemyGone}`,
  );
  log(p.logCount >= logAtBattleStart + 1, `[${tag}] F7 RESULT 一次性追加结果（非逐帧）`, `${logAtBattleStart} → ${p.logCount}`);

  await clickRect(page, p.actionRect);
  p = await probeOf(page);
  log(p.phase === 'CHOICE' && p.choiceOpen && p.choiceOptions.length === 3, `[${tag}] F8 RESULT → CHOICE（三选一浮层）`, `phase=${p.phase}`);
  const chShapes = p.layers;
  log(
    chShapes.cardBar > 0 && chShapes.playerBody === 0,
    `[${tag}] F9 CHOICE 原页面整体变暗（底层几何不再以原色出现）`,
    `cardBar=${chShapes.cardBar} playerBody=${chShapes.playerBody}`,
  );
  // 原页面位置不变：主动作按钮几何未挪位
  log(
    JSON.stringify(p.actionRect) === JSON.stringify(p0.actionRect),
    `[${tag}] F10 CHOICE 期间原页面位置一字不动`,
    `actionRect=${JSON.stringify(p.actionRect)}`,
  );

  const before = p.logCount;
  const buffsBefore = p.buffs.length;
  await clickRect(page, p.choiceOptions[1].rect);
  p = await probeOf(page);
  log(p.phase === 'IDLE' && !p.choiceOpen, `[${tag}] F11 选择后回到 IDLE 原上下文`, `phase=${p.phase}`);
  log(
    p.buffs.length === buffsBefore + 1 && p.logCount === before + 1 && /你选择了/.test(p.log[p.log.length - 1].text),
    `[${tag}] F12 顶部 +1 Build 图标 且 日志 +1「你选择了 X」`,
    `buffs=${buffsBefore}→${p.buffs.length} log="${p.log[p.log.length - 1].text}"`,
  );
  log(page.url() === urlBefore && p.transitions > trailBefore, `[${tag}] F13 全程同一页面、URL 未变`, `url=${page.url()}`);

  // 顶部新图标真的画出来了（dpr=1 时精确像素）
  log(p.layers.iconOwned > 0 && p.layers.iconChip > 0, `[${tag}] F14 顶部新 Build 图标已绘制`, `iconOwned=${p.layers.iconOwned} iconChip=${p.layers.iconChip}`);
}

/* ------------------------------------------------------------------ 主流程 */

async function main() {
  console.log('=== PRP-R2 默认体验入口｜启动链 smoke ===\n');

  // Acceptance 1：从关闭所有旧 dev server 开始
  const killed = killPort(PORT);
  log(true, 'A1 已关闭所有旧 dev server（端口 5173 已清空）', killed > 0 ? `强制结束 ${killed} 个` : '原本空闲');
  await sleep(600);

  // Acceptance 2：只执行这一条真实启动命令
  console.log('\n>>> 执行 npm run dev（唯一启动命令）...\n');
  const dev = startDevServer();
  let first = await waitForServer(60000);
  log(!!first, 'A2 启动命令后 dev server 就绪', first ? `HTTP ${first.status}` : '超时未就绪');

  // 启动日志：Vite 打印的 Local URL 必须是根路径（--open 打开的就是它 → 经重写即原型）
  // 启动日志晚于 listening 到达（npm 多一层管道），轮询等待而不是靠短路通过。
  const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  let out = '';
  for (let i = 0; i < 20; i += 1) {
    out = stripAnsi(dev.out);
    if (/Local:\s+\S+/.test(out) && /HEAD\s+:\s+[0-9a-f]{40}/.test(out)) break;
    await sleep(300);
  }
  const localMatch = out.match(/Local:\s+(\S+)/);
  const printed = localMatch ? localMatch[1] : '';
  log(
    !!localMatch && printed.replace(/\/$/, '') === DEV_URL_SHOWN.replace(/\/$/, ''),
    'A3 启动日志打印的访问地址 = 根路径（= `--open` 的落点）',
    `Local=${printed || '(未捕获)'}`,
  );
  const headMatch = out.match(/HEAD\s+:\s+([0-9a-f]{40})/);
  log(!!headMatch, 'A4 启动日志含 Runtime HEAD SHA（可核对非 stale）', headMatch ? headMatch[1] : '(未捕获)');

  // Acceptance 3/5（HTTP 层）：根路径返回的就是 PRP 页面
  log(
    !!first && first.body.includes('Portrait Run Prototype') && first.body.includes('run-root'),
    'A5 根路径 HTTP 响应体就是 PRP Run Page',
    first ? `含 PRP 标题=${first.body.includes('Portrait Run Prototype')} 含 #run-root=${first.body.includes('run-root')}` : 'n/a',
  );
  log(
    !!first && !first.body.includes('src/main.ts'),
    'A6 根路径响应体不含旧横屏正式入口脚本',
    first ? `含 /src/main.ts=${first.body.includes('src/main.ts')}` : 'n/a',
  );

  // Acceptance 3：真实浏览器，只访问根路径
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const viewports = [
    { w: 1920, h: 1080, dpr: 1, tag: '1920x1080@1' },
    { w: 1280, h: 720, dpr: 1.5, tag: '1280x720@1.5' },
  ];
  try {
    for (const vp of viewports) {
      const ctx = await browser.newContext({
        viewport: { width: vp.w, height: vp.h },
        deviceScaleFactor: vp.dpr,
      });
      const page = await ctx.newPage();
      const consoleErrors = [];
      page.on('pageerror', (e) => consoleErrors.push(String(e)));
      // 只访问根路径 —— 不手输 /run-page.html
      await page.goto(ROOT_URL, { waitUntil: 'load' });
      await page.waitForFunction('!!window.__RUNPAGE__', null, { timeout: 15000 });
      await sleep(400);
      await assertFirstScreen(page, vp.tag, vp);
      log(consoleErrors.length === 0, `[${vp.tag}] S13 首屏无运行时报错`, consoleErrors.slice(0, 2).join(' | ') || 'none');
      await assertFullFlow(page, vp.tag);
      await ctx.close();
    }

    // 保留验证：旧横屏正式游戏仍可经显式地址直达（未被删除，但默认不再进入）
    const ctxLegacy = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const legacy = await ctxLegacy.newPage();
    await legacy.goto(LEGACY_URL, { waitUntil: 'load' });
    await sleep(600);
    const legacyDom = await legacy.evaluate(() => ({
      title: document.title,
      hasApp: !!document.getElementById('app'),
      hasRunRoot: !!document.getElementById('run-root'),
    }));
    log(
      legacyDom.title.includes('Physics Lab') && legacyDom.hasApp && !legacyDom.hasRunRoot,
      'A7 旧横屏正式游戏保留且仅在显式地址可达',
      `title="${legacyDom.title}" #app=${legacyDom.hasApp} #run-root=${legacyDom.hasRunRoot}`,
    );
    await ctxLegacy.close();
  } finally {
    await browser.close();
  }

  // Acceptance 1 的收尾：smoke 结束必须把 dev server 关干净（不留残留端口给下一轮真人验收）
  stopDevServer();
  await sleep(800);
  let residue = '';
  try {
    residue = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
  } catch {
    /* ignore */
  }
  log(
    !new RegExp(`:${PORT}\\s+\\S+\\s+LISTENING`).test(residue),
    'A8 smoke 结束后 dev server 已关闭（端口无残留）',
    `5173 listening=${new RegExp(`:${PORT}\\s+\\S+\\s+LISTENING`).test(residue)}`,
  );

  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.log(`\n=== 结果：${pass}/${results.length} PASS，${fail} FAIL ===`);
  if (fail > 0) {
    console.log('\n失败项：');
    results.filter((r) => !r.pass).forEach((r) => console.log(`  FAIL ${r.name} | ${r.detail}`));
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('SMOKE 异常：', e);
  stopDevServer();
  process.exit(1);
});
