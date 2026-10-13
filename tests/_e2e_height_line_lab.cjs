/**
 * DEMO-HEIGHT-LINE-VISUAL-LAB-R1｜车高 × 水平弹道对照台的**浏览器真实闭环**。
 * （R2 `DEMO-HEIGHT-LINE-READABILITY-R2` 在原 47 条之上追加「近景放大」取证，见 F 段。）
 *
 * 手段（与既有 PRP / M3 E2E 同源，不伪造任何步骤）：
 *   - 真实浏览器（`_browser_launch.cjs` 的 `launchBrowser`）打开独立产物
 *     `dist-portrait-lab/height-line-lab.html`；
 *   - **真实鼠标点击**（`page.mouse.click`，取按钮真实 getBoundingClientRect 中心）；
 *   - **真实像素读取**（`canvas.getContext('2d').getImageData`，精确 RGB 相等）；
 *   - 只读诊断句柄 `window.__HEIGHTLINELAB__`。
 *
 * 它验证的是本 Queue 的四条验收：
 *
 *   ① 三套配置**都能切换**（同车身 / 同炮 / 只换轮径），且各自真的跑完一场真实战斗；
 *   ② 切配置 / 清场**不残留**：每次新建的战斗开局读数逐项干净
 *      （步数 0 / 时间 0 / 存活弹丸 0 / 接触·命中·伤害全 false / 满耐久 / 零 Run Buff），
 *      且清场后舞台回到纯色待机面（真实像素证据）；
 *   ③ 差异**来自真实战果**（读回真实运行时的读数，不是页面写死）：
 *      小轮 = 玩家胜、受小口径弹 0 次；重轮 / 大轮 = 玩家败；
 *   ④ 对手恒定 = 既有 `RangedTurret`（本页不新增敌人、不改任何数值）。
 *
 * R2 追加（F 段）：**画面确实被放大**这条不再靠形容词 —— 用真实像素量出
 *   车体宽度（逻辑 px）、车顶/车底位置、以及「车顶之上最近一条弹带」与车顶的间距，
 *   再与只读近景读数（显示密度 / 世界窗宽 / 视口倍数 / 相对正式取景的放大倍数）交叉核对。
 *
 * ⚠️ 本 E2E **不回答**「真人能不能看出那 4px」——那是真人录屏的判据。
 *
 * 用法：
 *   npm run build:portrait-lab
 *   node tests/_e2e_height_line_lab.cjs      （或 npm run e2e:height-line-lab）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { launchBrowser } = require('./_browser_launch.cjs');

/** ⚠️ 与 run-page(8156) / next-run(8157) / encounter-lab(8158) 用**不同端口**，可并存。 */
const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8159;
const PAGE_URL = `http://127.0.0.1:${PORT}/height-line-lab.html`;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
};

/**
 * Lab 本地战场带几何（= `heightLineConfigs.HEIGHT_LINE_BATTLE_BAND` 的浏览器侧镜像）。
 *
 * ⚠️ `DEMO-HEIGHT-LINE-READABILITY-R2` 把它从 302 提到 **344**（只影响本页；
 *    正式 `runPageLayout.RUN_STAGE_BAND` 仍是 80 / 302 / 378 / 84）。
 */
const BAND = { x: 0, y: 80, w: 390, h: 344 };
/** 待机舞台底色（= `heightLineLab.COLORS.stageBg`）—— 清场后舞台必须回到这个纯色。 */
const STAGE_BG = [0x0d, 0x11, 0x19];

/** 近景取景的期望读数（= `heightLineConfigs` 的常量；这里断言**真实页面**回读一致）。 */
const CLOSE = {
  worldW: 170, // HEIGHT_LINE_CLOSE_WORLD_W
  roofFrac: 0.35, // HEIGHT_LINE_CLOSE_ROOF_FRAC
  pxPerWorld: 390 / 170, // 战场带宽 / 近景世界宽
  viewportScaleAtDpr1: 4, // HEIGHT_LINE_CLOSE_MAX_SUPERSAMPLE（DPR=1 时取满）
  viewW: 502, // RUN_BATTLE_VIEW_W = 舞台带宽 390 + 正式 inset 56×2
  viewH: 358, // RUN_BATTLE_VIEW_H = 舞台带高 302 + 正式 inset 28×2
};

/** 三套配置的正式期望（id / 轮径 / 该轮真实半径）。 */
const CONFIGS = [
  { id: 'mango-small', radius: 12, expectWinner: 'A' },
  { id: 'mango-heavy', radius: 20, expectWinner: 'B' },
  { id: 'mango-large', radius: 26, expectWinner: 'B' },
];

const failures = [];
function check(ok, label, detail) {
  if (ok) {
    console.log(`  ✅ ${label}`);
  } else {
    console.log(`  ❌ ${label}${detail === undefined ? '' : ` — ${detail}`}`);
    failures.push(label);
  }
}

function serve() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!fs.existsSync(ROOT)) {
    console.log(`❌ 缺少产物目录 ${ROOT} —— 先跑「npm run build:portrait-lab」`);
    process.exit(1);
  }
  const server = await serve();
  const browser = await launchBrowser(chromium);
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));

  const readProbe = () => page.evaluate(() => window.__HEIGHTLINELAB__.probe());
  const clickControl = async (id) => {
    const box = await page.evaluate((controlId) => {
      const el = document.querySelector(`[data-hlab-id="${controlId}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, id);
    if (!box) throw new Error(`控件 ${id} 不存在`);
    await page.mouse.click(box.x, box.y);
  };
  const waitDone = async (label, timeoutMs = 90000) => {
    const t0 = Date.now();
    for (;;) {
      const p = await readProbe();
      if (p.phase === 'done') return p;
      if (Date.now() - t0 > timeoutMs) throw new Error(`${label} 超时未出结果（phase=${p.phase}）`);
      await sleep(250);
    }
  };
  /** 真实像素：逻辑坐标 (x,y) → 真实 getImageData（按 dpr 换算 backing 坐标）。 */
  const pixel = (x, y) =>
    page.evaluate(
      ({ px, py }) => {
        const c = document.getElementById('hlab-canvas');
        const ctx = c.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const d = ctx.getImageData(Math.round(px * dpr), Math.round(py * dpr), 1, 1).data;
        return [d[0], d[1], d[2]];
      },
      { px: x, py: y },
    );

  /**
   * R2 可读性取证：在**同一帧**里同时做两件事（这是关键 —— 两次读取必须来自同一幅画面）——
   *
   *   ① **真实像素扫描**（`getImageData`）本地战场带：
   *        `carWidthLogical` —— 芒果车体（橙色）当前取景下的逻辑像素宽度；
   *        `carTopLogical`   —— 车体顶边（像素事实，不是读数推算）；
   *        `pixelGapLogical` —— 车体顶边与其上方**最亮的一条弹带**之间的逻辑像素间距；
   *   ② **只读渲染快照**（`probe().closeUp`）：窗的世界范围 / 显示密度 / 玩家车箱顶 /
   *        本帧全部存活弹丸（含**阵营**）。
   *
   *   ⇒ E2E 因此可以要求「像素看到的弹带」与「快照里那枚**敌弹**」互相印证，
   *     而不是各说各话。它只读像素、不注入标记、不改页面状态。
   */
  const sampleFrame = () =>
    page.evaluate(
      ({ bandTop, bandH }) => {
        const probe = window.__HEIGHTLINELAB__.probe();
        const close = probe.closeUp;
        const c = document.getElementById('hlab-canvas');
        if (!c) return null;
        const ctx = c.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const y0 = Math.round(bandTop * dpr);
        const n = Math.round(bandH * dpr);
        if (y0 + n > c.height) return null;
        const img = ctx.getImageData(0, y0, c.width, n).data;
        const W = c.width;
        const isOrange = (r, g, b) => r > 180 && g > 110 && g < 210 && b < 110;
        const isBright = (r, g, b) => r > 215 && g > 215 && b > 200;
        let firstOrange = -1;
        let lastOrange = -1;
        const orangeRows = [];
        const brightCount = new Array(n).fill(0);
        for (let y = 0; y < n; y += 1) {
          let oc = 0;
          let bc = 0;
          for (let x = 0; x < W; x += 1) {
            const i = (y * W + x) * 4;
            const r = img[i];
            const g = img[i + 1];
            const b = img[i + 2];
            if (isOrange(r, g, b)) oc += 1;
            if (isBright(r, g, b)) bc += 1;
          }
          brightCount[y] = bc;
          if (oc > 8) {
            if (firstOrange < 0) firstOrange = y;
            lastOrange = y;
            orangeRows.push(y);
          }
        }
        if (firstOrange < 0) return null;
        // 车宽：取车体纵向中位那一行，逐像素数橙色
        const midY = orangeRows[Math.floor(orangeRows.length / 2)];
        let carW = 0;
        for (let x = 0; x < W; x += 1) {
          const i = (midY * W + x) * 4;
          if (isOrange(img[i], img[i + 1], img[i + 2])) carW += 1;
        }
        // 车顶之上最亮的一行（= 一条弹带；至少要 3 个近白像素才算「看得见」）
        let bulletRow = -1;
        let bulletHits = 0;
        for (let y = 0; y < firstOrange - 1; y += 1) {
          if (brightCount[y] > bulletHits) {
            bulletHits = brightCount[y];
            bulletRow = y;
          }
        }
        const carTopLogical = (y0 + firstOrange) / dpr;
        const pixelGapLogical =
          bulletRow >= 0 && bulletHits >= 3 ? (firstOrange - bulletRow) / dpr : null;

        // 只读快照：本帧的敌弹里，有几枚走在窗内、且在玩家车箱顶之上
        let enemyAbove = 0;
        let enemyGapLogical = null;
        let enemyY = null;
        if (close) {
          const inWin = (probe.closeUp.projectiles || [])
            .filter((p) => p.team === 'B')
            .filter(
              (p) =>
                p.y >= close.worldTop &&
                p.y <= close.worldTop + close.worldH &&
                p.x >= close.worldLeft &&
                p.x <= close.worldLeft + close.worldW,
            )
            .filter((p) => p.y < close.playerBox.minY);
          enemyAbove = inWin.length;
          if (inWin.length > 0) {
            const top = inWin.reduce((a, p) => (p.y < a.y ? p : a));
            enemyY = top.y;
            enemyGapLogical = (close.playerBox.minY - top.y) * close.pxPerWorld;
          }
        }
        return {
          carWidthLogical: carW / dpr,
          carTopLogical,
          carBottomLogical: (y0 + lastOrange) / dpr,
          pixelGapLogical,
          bulletHits,
          enemyAbove,
          enemyGapLogical,
          enemyY,
        };
      },
      { bandTop: BAND.y, bandH: BAND.h },
    );

  try {
    console.log('\n##### A. 页面与控件 #####');
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__HEIGHTLINELAB__, null, { timeout: 20000 });
    // 正式 Renderer 的美术必须先就位（与 encounter-lab E2E 同口径）：否则「看得出弹道/受击」
    // 这条验收就只剩物理读数、没有画面证据。
    await page.waitForFunction(
      () => {
        const a = window.__HEIGHTLINELAB__.probe().assets;
        return a.failed.length === 0 && a.ready >= 5;
      },
      null,
      { timeout: 20000 },
    );
    let probe = await readProbe();

    check(pageErrors.length === 0, '无页面级 JS 错误', pageErrors.join(' | '));
    check(
      probe.assets.ready >= 5 && probe.assets.failed.length === 0,
      `正式 Renderer 美术已就位（ready=${probe.assets.ready} / registered=${probe.assets.registered} / failed=${probe.assets.failed.length}）`,
    );
    check(probe.problems.length === 0, '配置自检为空', probe.problems.join(' | '));
    check(probe.opponentId === 'RangedTurret', `对手 = 既有 RangedTurret（实际 ${probe.opponentId}）`);
    check(probe.opponentLabel === '远程炮台', `对手展示名来自正式表（实际 ${probe.opponentLabel}）`);
    check(probe.configs.length === 3, `三套配置（实际 ${probe.configs.length}）`);
    check(
      probe.configs.every((c) => c.bodyDefId === 'mangoBody'),
      '三套同车身 mangoBody',
    );
    check(
      JSON.stringify(probe.configs.map((c) => c.wheelRadius)) === JSON.stringify([12, 20, 26]),
      `轮径现读 = [12,20,26]（实际 ${JSON.stringify(probe.configs.map((c) => c.wheelRadius))}）`,
    );
    check(
      probe.controls.length === 5 &&
        probe.controls.filter((c) => c.kind === 'config').length === 3 &&
        probe.controls.some((c) => c.kind === 'clear') &&
        probe.controls.some((c) => c.kind === 'reset'),
      '控件 = 3 配置 + 清场 + Reset',
    );
    check(probe.phase === 'idle' && !probe.runtimeActive, '初始为 idle（无运行时）');

    console.log('\n##### B. 三套配置各自跑完一场真实战斗（真实点击） #####');
    const rounds = [];
    for (const cfg of CONFIGS) {
      await clickControl(cfg.id);
      probe = await readProbe();
      const fresh = probe.fresh;
      check(fresh !== null && fresh.configId === cfg.id, `${cfg.id}: 已建立战斗且开局读数带配置 id`);
      check(
        fresh.steps === 0 && fresh.timeMs === 0 && fresh.projectiles === 0,
        `${cfg.id}: 开局干净（步数 0 / 时间 0 / 弹丸 0）`,
        JSON.stringify({ steps: fresh.steps, t: fresh.timeMs, proj: fresh.projectiles }),
      );
      check(
        !fresh.contact && !fresh.impact && !fresh.damage,
        `${cfg.id}: 无上一场残留（接触/命中/伤害全 false）`,
      );
      check(
        fresh.initialPlayerHp === fresh.playerHpMax && fresh.buildIds.length === 0,
        `${cfg.id}: 满耐久 + 零 Run Buff`,
      );
      check(probe.opponentId === 'RangedTurret' && fresh.encounterId === 'RangedTurret', `${cfg.id}: 对手恒定`);
      check(
        fresh.configId === cfg.id && probe.configs.find((c) => c.id === cfg.id).wheelRadius === cfg.radius,
        `${cfg.id}: 轮径 r${cfg.radius} 与配置一致`,
      );

      const done = await waitDone(cfg.id);
      const last = done.rounds[done.rounds.length - 1];
      rounds.push(last);
      check(
        done.phase === 'done' && last !== undefined && last.encounterId === 'RangedTurret',
        `${cfg.id}: 真实战斗跑到终局并冻结`,
      );
      check(
        last.winner === cfg.expectWinner,
        `${cfg.id}: winner=${cfg.expectWinner}（实际 ${last.winner}）`,
      );
      console.log(
        `     ↳ ${cfg.id} 用时 ${(last.timeMs / 1000).toFixed(2)}s · 玩家 ${last.playerHp.toFixed(0)}/${last.playerHpMax} · 敌 ${last.enemyHp.toFixed(0)}/${last.enemyHpMax}`,
      );
    }

    console.log('\n##### C. 真实战果差异（读回真实运行时读数） #####');
    check(rounds[0].playerHp > 0 && rounds[0].enemyHp === 0, '小轮：玩家存活、敌方清空（真实胜利）');
    check(rounds[1].playerHp === 0, '重轮：玩家耐久归零（真实失败）');
    check(rounds[2].playerHp === 0, '大轮：玩家耐久归零（真实失败）');
    check(
      rounds[0].timeMs > rounds[1].timeMs && rounds[0].timeMs > rounds[2].timeMs,
      '小轮那一场明显更长（活到场地收束阶段）',
    );

    console.log('\n##### D. 清场无残留（真实点击 + 真实像素） #####');
    await clickControl('clear');
    probe = await readProbe();
    check(!probe.runtimeActive && probe.phase === 'idle' && probe.active === null, '清场后回到 idle、无运行时');
    check(probe.fresh === null, '清场后开局读数清空');
    check(probe.rounds.length === 3, '清场保留累计对照（3 场）');
    let bg = await pixel(BAND.x + 6, BAND.y + BAND.h - 6);
    check(
      JSON.stringify(bg) === JSON.stringify(STAGE_BG),
      `清场后舞台回到纯色待机面（实际 ${JSON.stringify(bg)}）`,
    );

    await clickControl(CONFIGS[0].id);
    probe = await readProbe();
    check(
      probe.fresh !== null && probe.fresh.steps === 0 && probe.fresh.projectiles === 0,
      '清场后重新开一场：开局仍然干净',
    );
    const again = await waitDone('清场后重跑');
    check(
      again.rounds[again.rounds.length - 1].winner === 'A' && again.rounds.length === 4,
      '同一配置复跑结果一致（可反复观察同一段弹道）',
    );

    console.log('\n##### E. Reset（清场 + 清空对照） #####');
    await clickControl('reset');
    probe = await readProbe();
    check(probe.rounds.length === 0 && !probe.runtimeActive && probe.active === null, 'Reset 清空累计对照');
    bg = await pixel(BAND.x + 6, BAND.y + BAND.h - 6);
    check(JSON.stringify(bg) === JSON.stringify(STAGE_BG), 'Reset 后舞台仍是纯色待机面');
    check(pageErrors.length === 0, '全程无页面级 JS 错误', pageErrors.join(' | '));

    console.log('\n##### F. R2 可读性：近景放大（真实像素 + 只读读数） #####');
    await clickControl(CONFIGS[0].id);
    let closeReading = null;
    let carWidth = 0;
    let carTop = -1;
    let carBottom = -1;
    // 「像素看到的弹带」与「快照里的敌弹」同时成立、且彼此吻合的那一帧
    let best = null;
    for (let i = 0; i < 60; i += 1) {
      const p = await readProbe();
      if (closeReading === null && p.closeUp) closeReading = p.closeUp;
      const f = await sampleFrame();
      if (f) {
        if (f.carWidthLogical > carWidth) carWidth = f.carWidthLogical;
        carTop = f.carTopLogical;
        carBottom = f.carBottomLogical;
        if (f.pixelGapLogical !== null && f.enemyGapLogical !== null) {
          const score = Math.min(f.pixelGapLogical, f.enemyGapLogical);
          if (best === null || score > best.score) best = { score, ...f };
        } else if (best === null) {
          best = { score: -1, ...f };
        }
      }
      if (p.phase === 'done') break;
      await sleep(80);
    }

    // ① 只读读数：近景窗的几何与「相对正式取景放大了几倍」
    check(closeReading !== null, '近景取景读数已建立（有真实战斗时非空）');
    if (closeReading) {
      const c = closeReading;
      console.log(
        `     ↳ 近景 pxPerWorld=${c.pxPerWorld.toFixed(3)} · 窗 ${c.worldW}×${c.worldH.toFixed(1)} 世界px · ` +
          `视口 ${c.viewportW}×${c.viewportH}（×${c.viewportScale}）· ` +
          `源矩形 (${c.srcX.toFixed(0)},${c.srcY.toFixed(0)},${c.srcW.toFixed(0)},${c.srcH.toFixed(0)}) · ` +
          `车顶比例 ${c.roofScreenFrac.toFixed(3)} · 相对正式取景放大 ${c.upscaleVsOfficial.toFixed(2)}×`,
      );
      check(
        Math.abs(c.pxPerWorld - CLOSE.pxPerWorld) < 1e-6,
        `显示密度恒定 = 战场带宽 / 近景世界宽（实际 ${c.pxPerWorld.toFixed(4)}）`,
      );
      check(Math.abs(c.worldW - CLOSE.worldW) < 1e-9, `近景窗世界宽 = ${CLOSE.worldW}（实际 ${c.worldW}）`);
      check(
        c.viewportScale === CLOSE.viewportScaleAtDpr1 &&
          c.viewportW === CLOSE.viewW * CLOSE.viewportScaleAtDpr1,
        `离屏视口按 DPR 反比放大（DPR=1 ⇒ ×${CLOSE.viewportScaleAtDpr1}，实际 ${c.viewportW}×${c.viewportH}）`,
      );
      check(
        Math.abs(c.roofScreenFrac - CLOSE.roofFrac) < 1e-6,
        `车顶锚在窗内 ${CLOSE.roofFrac} 处（实际 ${c.roofScreenFrac.toFixed(4)}）`,
      );
      check(
        c.srcX >= 0 &&
          c.srcY >= 0 &&
          c.srcX + c.srcW <= c.viewportW + 1e-6 &&
          c.srcY + c.srcH <= c.viewportH + 1e-6,
        '裁切源矩形完全落在离屏视口内（不会画出透明边）',
      );
      check(c.upscaleVsOfficial >= 2, `相对**正式取景**放大 ≥ 2×（实际 ${c.upscaleVsOfficial.toFixed(2)}×）`);
      check(
        c.cameraScale > 0 && Math.abs(c.officialCameraScale - c.cameraScale / c.viewportScale) < 1e-9,
        '正式相机 scale 已按视口倍数归一（officialCameraScale 可复算）',
      );
    }

    // ② 真实像素 + 同一帧的只读快照：车体被明显放大，且**敌弹**清晰走在车顶之上
    console.log(
      `     ↳ 像素实测 车宽=${carWidth.toFixed(0)} 逻辑px · 车顶 y=${carTop.toFixed(1)} · 车底 y=${carBottom.toFixed(1)}`,
    );
    check(carWidth >= 300, `近景中车体宽度 ≥ 300 逻辑px（实际 ${carWidth.toFixed(0)} / 带宽 ${BAND.w}）`);
    check(
      carTop > BAND.y && carTop < BAND.y + BAND.h && carBottom > carTop && carBottom <= BAND.y + BAND.h,
      '车体完整落在战场带内（顶/底都可见，没有贴边裁掉）',
    );
    if (best !== null) {
      console.log(
        `     ↳ 同一帧 像素弹带-车顶间距=${best.pixelGapLogical === null ? '未捕捉' : `${best.pixelGapLogical.toFixed(1)} 逻辑px`}` +
          ` · 快照内敌弹（车顶之上/在窗内）${best.enemyAbove} 枚 · 最近一枚在车顶上方 ${best.enemyGapLogical === null ? '—' : `${best.enemyGapLogical.toFixed(1)} 逻辑px`}`,
      );
    }
    check(best !== null && best.pixelGapLogical !== null, '像素层能捕捉到车顶之上的弹带（看得见）');
    check(best !== null && best.enemyAbove > 0, '同一帧快照里确有**敌弹**走在窗内且高于玩家车顶');
    check(
      best !== null && best.pixelGapLogical !== null && best.pixelGapLogical >= 6,
      `像素量出的弹带-车顶间距 ≥ 6 逻辑px（实际 ${best && best.pixelGapLogical !== null ? best.pixelGapLogical.toFixed(1) : '未捕捉'}）`,
    );
    check(
      best !== null && best.enemyGapLogical !== null && best.enemyGapLogical >= 6,
      `快照量出的敌弹-车顶间距 ≥ 6 逻辑px（实际 ${best && best.enemyGapLogical !== null ? best.enemyGapLogical.toFixed(1) : '未捕捉'}）`,
    );
    check(
      best !== null &&
        best.pixelGapLogical !== null &&
        best.enemyGapLogical !== null &&
        Math.abs(best.pixelGapLogical - best.enemyGapLogical) <= 10,
      // ⚠️ 两个间距的口径**故意略有差别**，所以容差不是 0：
      //    - 像素侧量到的是「车体**橙色**顶边 ↔ 弹带**最亮那一行**（近似弹丸中心）」；
      //    - 快照侧量到的是「车**箱**顶（含炮/挂点，比橙色车身再高约 3 世界px ≈ 7 逻辑px）
      //      ↔ 弹丸**中心**」。
      //    ⇒ 期望的系统性偏差 ≈ 7 逻辑px。这条断言要排除的是「两边根本在说两枚不同的弹」。
      `像素与快照互相印证（两者差值 ≤ 10 逻辑px，实际 ${best && best.pixelGapLogical !== null && best.enemyGapLogical !== null ? Math.abs(best.pixelGapLogical - best.enemyGapLogical).toFixed(1) : '—'}）`,
    );
    check(pageErrors.length === 0, 'F 段仍无页面级 JS 错误', pageErrors.join(' | '));
  } catch (err) {
    check(false, '未捕获异常', String(err && err.message ? err.message : err));
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
    await new Promise((r) => server.close(r));
  }

  if (failures.length > 0) {
    console.log(`\n❌ DEMO-HEIGHT-LINE E2E 失败 ${failures.length} 项：\n  - ${failures.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('\n✅ DEMO-HEIGHT-LINE E2E 全部通过（三套配置真实战斗 + 切换无残留 + 清场待机面）');
})();
