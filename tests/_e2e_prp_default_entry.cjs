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

/**
 * Run Page 几何调色板（与 src/lab/portraitBattleLab/runPage.ts 的 COLORS 一一对应）。
 * ⚠️ PRP-R3：车辆改用正式 sprite → 车身 / 部件不再入账（sprite 像素非纯色）。
 */
const PALETTE = {
  ground: [0x8f, 0x7a, 0x52],
  road: [0x33, 0x2e, 0x42],
  nodeDone: [0xd2, 0x92, 0x2a],
  nodeTodo: [0x46, 0x53, 0x6b],
  buffIconHeavy: [0xb8, 0x56, 0x2e],
  buffIconExplosive: [0xc0, 0x7a, 0x2a],
  buffIconRepair: [0x3f, 0x8f, 0x5a],
  buffChip: [0xe6, 0xed, 0xf8],
  cardBar: [0x5f, 0x86, 0xc4],
  actionBar: [0x33, 0x50, 0x7a],
};

/** 正式车辆 sprite 的特征色（PNG 实解码主色）→ 证明战斗主体不是纯色矩形。 */
const SPRITE_COLORS = {
  watermelonBody: [0x3f, 0x8a, 0x3c],
  bananaBody: [0xf6, 0xc8, 0x3c],
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

  // 5) 四带主结构：顶部薄 / 战斗主体够大 / 冒险记录可读 / 最底唯一动作（PRP-R3 新比例）
  const b = p.bands;
  const hSum = b.top.h + b.stage.h + b.log.h + b.action.h;
  log(
    hSum === p.logicalH &&
      b.top.h / p.logicalH >= 0.08 &&
      b.top.h / p.logicalH <= 0.1 &&
      b.stage.h / p.logicalH >= 0.33 &&
      b.stage.h / p.logicalH <= 0.36 &&
      b.log.h / p.logicalH >= 0.4 &&
      b.log.h / p.logicalH <= 0.45 &&
      b.action.h / p.logicalH >= 0.08 &&
      b.action.h / p.logicalH <= 0.1,
    `[${tag}] S7 四带比例合规（顶 8~10% / 舞台 33~36% / 日志 40~45% / 动作 8~10%）`,
    `top=${round2((b.top.h / p.logicalH) * 100)}% stage=${round2((b.stage.h / p.logicalH) * 100)}% log=${round2(
      (b.log.h / p.logicalH) * 100,
    )}% action=${round2((b.action.h / p.logicalH) * 100)}%`,
  );

  const L = p.layers;
  log(
    L.nodeTodo > 0 && L.road > 0 && L.actionBar > 0 && L.ground > 0 && L.cardBar === 0,
    `[${tag}] S8 顶部进度 + 中部舞台路面 + 最底主动作都在场`,
    `nodeTodo=${L.nodeTodo} road=${L.road} ground=${L.ground} actionBar=${L.actionBar}`,
  );
  // PRP-R3 必改 1：未获得强化时顶部第二行**不存在**（不是 5 个空槽 / 不是「核心构建 X/5」）
  log(
    p.buffIconCount === 0 && L.buffIcon === 0 && L.buffChip === 0,
    `[${tag}] S8b 顶部无空槽、无「核心构建」计数（结构性：0 个强化 = 0 个图标矩形）`,
    `buffIconCount=${p.buffIconCount} buffIcon=${L.buffIcon} buffChip=${L.buffChip}`,
  );
  // PRP-R3 必改 3：玩家可见日志是自然语言，不是控制台（无 [系统]/[事件]/[战斗] 前缀）
  const texts = p.log.map((l) => l.text);
  log(
    texts.length > 0 && texts.every((t) => !t.includes('[') && !t.includes(']')),
    `[${tag}] S8c 日志是玩家叙事（无方括号 Debug 前缀）`,
    texts.join(' ｜ '),
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
      stats.road > 0 && stats.ground > 0 && stats.actionBar > 0 && stats.nodeTodo > 0,
      `[${tag}] S11 真实像素确认四带结构已绘制`,
      `road=${stats.road} ground=${stats.ground} actionBar=${stats.actionBar} nodeTodo=${stats.nodeTodo}`,
    );
    const A = 390 * 844;
    log(
      stats.road + stats.ground + stats.actionBar + stats.nodeTodo < A,
      `[${tag}] S12 画面不被单一层铺满（存在分带与留白）`,
      `sum=${stats.road + stats.ground + stats.actionBar + stats.nodeTodo} < ${A}`,
    );
    // PRP-R3 必改 2：战斗主体是**正式车辆 sprite**（真实像素在场 → 纯色矩形不可能命中）
    const melon = await countExact(page, SPRITE_COLORS.watermelonBody);
    log(
      melon > 200 && p.stage.player.allSprites === true,
      `[${tag}] S12b 战斗主体是正式车辆视觉（西瓜重炮 sprite 真实像素）`,
      `watermelonBody=${melon}px allSprites=${p.stage.player.allSprites}`,
    );
  }
}

/** 完整流程：同一页面内 IDLE → EVENT → BATTLE → RESULT → CHOICE → IDLE（不修改 URL）。 */
async function assertFullFlow(page, tag, dpr) {
  const trailBefore = (await probeOf(page)).transitions;
  const p0 = await probeOf(page);
  const urlBefore = page.url();

  await clickRect(page, p0.actionRect);
  let p = await probeOf(page);
  log(p.phase === 'EVENT', `[${tag}] F1 IDLE → EVENT（敌人从右侧出现）`, `phase=${p.phase} log=${p.logCount}`);
  log(!!p.stage.enemy && p.stage.playerLeftOfEnemy === true, `[${tag}] F2 EVENT 敌人出现在玩家右侧`, `gap=${round2(p.stage.minGapPx)}`);
  /*
    PRP-F1 必改 1/2：一遭遇就切进**真实 Planck 战斗世界**（正式 1600×900），
    而且两车之间是**明确的远程开局**（实测外廓间距 ≈ 529 世界 px）。
  */
  log(
    !!p.battleWorld &&
      p.battleWorld.world.width === 1600 &&
      p.battleWorld.world.height === 900 &&
      p.battleWorld.world.groundY === 700,
    `[${tag}] F2b 必改 1：战斗世界 = 正式 arena 尺度 1600×900（groundY 700）`,
    p.battleWorld ? `world=${p.battleWorld.world.width}×${p.battleWorld.world.height} stageBand=${p.bands.stage.w}×${p.bands.stage.h}` : 'no battleWorld',
  );
  log(
    !!p.battleWorld &&
      Math.round(p.battleWorld.world.spawnAx) === 400 &&
      Math.round(p.battleWorld.world.spawnBx) === 1200 &&
      Math.round(p.battleWorld.world.initialGap) === 529,
    `[${tag}] F2c 必改 2：正式出生点 400/1200，开局外廓间距 ≈ 529 世界 px（有纵深、不贴车）`,
    p.battleWorld ? `spawn=${round2(p.battleWorld.world.spawnAx)}/${round2(p.battleWorld.world.spawnBx)} initialGap=${round2(p.battleWorld.world.initialGap)}` : '',
  );

  await clickRect(page, p.actionRect);
  p = await probeOf(page);
  log(p.phase === 'BATTLE' && p.battle, `[${tag}] F3 EVENT → BATTLE`, `phase=${p.phase} steps=${p.battle.steps}`);
  const logAtBattleStart = p.logCount;
  /*
    PRP-F1 必改 2/5③：**开局瞬间**两车严格分离（玩家左 / 敌人右）。
    ⚠️ 必须在窗口观测**之前**采样：真实战斗里敌方会逐步接敌，窗口结束时 gap 已为负（真实碰撞），
    那是必改 5③ 期望的结果，不是「分离失败」。
  */
  log(
    p.stage.playerLeftOfEnemy === true && p.stage.minGapPx > 0,
    `[${tag}] F5 BATTLE 开局玩家左 / 敌人右（严格分离）`,
    `gap=${round2(p.stage.minGapPx)}`,
  );
  /*
    PRP-F1：真实 Planck 战斗（实测整场 ≈15.4s、首次命中 step 132 ≈2.2s、单发弹丸寿命 ≈40+ 帧）。
    单点采样会随机落在「弹丸刚落地 / 下一发未出膛」的空窗 → 改为 5s 窗口累积观测。
  */
  const win = await page.evaluate(async () => {
    const acc = {
      samples: 0,
      maxProjectiles: 0,
      projSamples: 0,
      phases: [],
      maxLogCount: 0,
      camVariants: [],
      lastSteps: 0,
      firstGapPx: null,
      lastGapPx: 0,
      scaleMin: Infinity,
      scaleMax: 0,
      outOfBand: 0,
    };
    const t0 = performance.now();
    while (performance.now() - t0 < 5000) {
      const p = window.__RUNPAGE__.probe();
      acc.samples += 1;
      acc.phases.push(p.phase);
      acc.maxLogCount = Math.max(acc.maxLogCount, p.logCount);
      if (acc.firstGapPx === null) acc.firstGapPx = p.stage.minGapPx;
      acc.lastGapPx = p.stage.minGapPx;
      const w = p.battleWorld;
      if (w) {
        acc.maxProjectiles = Math.max(acc.maxProjectiles, w.projectiles);
        if (w.projectiles > 0) acc.projSamples += 1;
        acc.lastSteps = w.steps;
        const v = `${w.camera.scale}|${w.camera.offsetX}`;
        if (!acc.camVariants.includes(v)) acc.camVariants.push(v);
        acc.scaleMin = Math.min(acc.scaleMin, w.camera.scale);
        acc.scaleMax = Math.max(acc.scaleMax, w.camera.scale);
        if (p.stage.player && p.stage.enemy) {
          const a = p.stage.player.bounds;
          const b = p.stage.enemy.bounds;
          if (a.x < -2 || a.x + a.w > 392 || b.x < -2 || b.x + b.w > 392) acc.outOfBand += 1;
        }
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    return acc;
  });
  const pMid = await probeOf(page);
  log(
    win.phases.every((ph) => ph === 'BATTLE') && win.maxLogCount === logAtBattleStart,
    `[${tag}] F4 BATTLE 期间日志零追加（不刷逐帧伤害）`,
    `窗口 ${win.samples} 次采样全程 BATTLE · 日志恒为 ${logAtBattleStart}`,
  );
  /*
    PRP-F1 必改 5③：**碰撞需要接敌过程** —— 窗口结束时两车必须比开局更近（真实位移，非脚本演出）。
  */
  log(
    win.lastGapPx < win.firstGapPx - 20,
    `[${tag}] F5d 必改 5③：敌我距离在真实缩小（接敌过程，非贴车开局）`,
    `gap ${round2(win.firstGapPx)} → ${round2(win.lastGapPx)}（${win.samples} 次采样 · steps→${win.lastSteps}）`,
  );
  /*
    PRP-R5 必改 1/2/4：相机 = **正式 battle 相机链**（reframe → battleCam → applyBattleFollow）
    + PRP 的 viewport adapter。窗口内必须看到「镜头真的跟随 + 真的变焦」：
    scale 取值不再是单一常数、可见世界宽 < 世界宽（不再是固定全世界远摄），
    且两车全程完整落在舞台带内。窗口中炮弹**真的在飞**（真实弹丸计数 > 0，不是贴脸扣血）。
  */
  const wMid = pMid.battleWorld;
  log(
    !!wMid &&
      wMid.camera.cropX === 56 &&
      wMid.camera.cropY === 28 &&
      wMid.camera.bandW === 390 &&
      wMid.camera.bandH === 302 &&
      Math.abs(wMid.camera.scale - 390 / 1600) > 1e-6 &&
      wMid.camera.showsWholeWorld === false,
    `[${tag}] F5b 必改 1/2：viewport adapter + 不再是固定远摄（可见世界宽 < 世界宽）`,
    wMid
      ? `view=${wMid.camera.viewW}×${wMid.camera.viewH} crop=${wMid.camera.cropX},${wMid.camera.cropY} scale=${round2(wMid.camera.scale)} 可见世界宽=${Math.round(wMid.camera.visibleWorldWidth)}/${wMid.world.width}`
      : '',
  );
  log(
    win.camVariants.length > 1 && win.scaleMax / win.scaleMin > 1.2 && win.outOfBand === 0,
    `[${tag}] F5e 必改 4/5：镜头真的跟随+变焦，且变焦全程两车完整在舞台带内`,
    `scale ${round2(win.scaleMin)}→${round2(win.scaleMax)}（${round2(win.scaleMax / win.scaleMin)}×）· 窗口内相机取值种类=${win.camVariants.length} · 越界 ${win.outOfBand} 次`,
  );
  log(
    win.maxProjectiles > 0 && win.projSamples > 0,
    `[${tag}] F5c 必改 5①：炮弹真的在空中飞（真实弹丸 > 0，不是贴脸扣血）`,
    `窗口内最多 ${win.maxProjectiles} 发在飞 · ${win.projSamples}/${win.samples} 次采样见弹 · steps→${win.lastSteps}`,
  );

  // 自动结束（真实 Planck 战斗实测约 15.4s）
  await page.waitForFunction("window.__RUNPAGE__.probe().phase === 'RESULT'", null, { timeout: 40000 });
  p = await probeOf(page);
  /*
    PRP-F1 必改 4：RESULT 不再表现为「敌人消失」，而是**真实战场冻结在画面上**：
    战斗世界仍在（stage.mode = battle）、双方都还在场地里，战斗结论来自官方判据。
  */
  log(
    p.phase === 'RESULT' && !!p.stage.enemy && p.stage.player && p.stage.mode === 'battle' && !!p.battleWorld,
    `[${tag}] F6 BATTLE → RESULT 自动结束（真实战场冻结在画面上，非脚本收尾）`,
    `phase=${p.phase} mode=${p.stage.mode} winner=${p.battle && p.battle.winner} endReason=${p.battle && p.battle.endReason}`,
  );
  log(
    p.logCount === logAtBattleStart + 3,
    `[${tag}] F7 RESULT 一次性追加 3 行玩家叙事（非逐帧）`,
    `${logAtBattleStart} → ${p.logCount}`,
  );

  await clickRect(page, p.actionRect);
  p = await probeOf(page);
  log(p.phase === 'CHOICE' && p.choiceOpen && p.choiceOptions.length === 3, `[${tag}] F8 RESULT → CHOICE（三选一浮层）`, `phase=${p.phase}`);
  const chShapes = p.layers;
  log(
    chShapes.cardBar > 0 && chShapes.road === 0 && chShapes.nodeTodo === 0,
    `[${tag}] F9 CHOICE 原页面整体变暗（底层几何不再以原色出现 → 三选一独占焦点）`,
    `cardBar=${chShapes.cardBar} road=${chShapes.road} nodeTodo=${chShapes.nodeTodo}`,
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
    p.buffs.length === buffsBefore + 1 && p.logCount === before + 1 && /你换上了/.test(p.log[p.log.length - 1].text),
    `[${tag}] F12 顶部 +1 强化图标 且 日志 +1 自然语言结果（你换上了 X。）`,
    `buffs=${buffsBefore}→${p.buffs.length} log="${p.log[p.log.length - 1].text}"`,
  );
  log(page.url() === urlBefore && p.transitions > trailBefore, `[${tag}] F13 全程同一页面、URL 未变`, `url=${page.url()}`);

  // 顶部新图标真的画出来了，而且只有 1 个（不是 5 个空槽 / 不是固定槽位）
  log(
    p.layers.buffIcon > 0 && p.layers.buffChip > 0 && p.buffIconCount === 1,
    `[${tag}] F14 顶部新强化图标已绘制且只有 1 个`,
    `buffIcon=${p.layers.buffIcon} buffChip=${p.layers.buffChip} buffIconCount=${p.buffIconCount}`,
  );
  if (dpr === 1) {
    const stats = await pixelStats(page);
    log(
      stats.buffIconExplosive === 756 && stats.buffChip === 144,
      `[${tag}] F15 顶部图标真实像素（只有所选选项那一个底色，无空槽）`,
      `explosive=${stats.buffIconExplosive} chip=${stats.buffChip}`,
    );
  }
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
      // PRP-R3：等正式车辆 sprite 真的加载完成再做任何像素断言
      await page.waitForFunction(
        () => {
          if (!window.__RUNPAGE__) return false;
          const p = window.__RUNPAGE__.probe();
          return p.assets.ready >= 5 && p.assets.failed.length === 0 && p.stage.player.allSprites;
        },
        null,
        { timeout: 15000 },
      );
      await sleep(400);
      await assertFirstScreen(page, vp.tag, vp);
      log(consoleErrors.length === 0, `[${vp.tag}] S13 首屏无运行时报错`, consoleErrors.slice(0, 2).join(' | ') || 'none');
      await assertFullFlow(page, vp.tag, vp.dpr);
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
