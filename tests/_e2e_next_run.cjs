/**
 * PRP-M2-NEXT-RUN-SEED-VALIDATION｜验证入口的**浏览器真实闭环**。
 *
 * 手段（与既有 Run Page E2E 同源，不伪造任何步骤）：
 *   - 真实浏览器（playwright-core / msedge，回退默认 chromium）打开独立产物
 *     `dist-portrait-lab/next-run.html`；
 *   - 真实鼠标点击（page.mouse.click，逻辑坐标 → 屏幕坐标换算，不直调业务方法）；
 *   - 真实像素读取（canvas.getContext('2d').getImageData，**精确 RGB 相等**统计）；
 *   - 只读诊断句柄 `window.__RUNPAGE__`。
 *
 * 它验证的是本 Queue 的**元体验链路**（对应 Queue 验收 1~3）：
 *
 *   ① 上一局 RUN COMPLETE → 种子三选一 → **全新 Run**（DAY 1 / 满耐久 / Build 只剩 seed）
 *      → 第一场真实 Battle（seed 真的进了 Runtime）→ `NEXT RUN VALIDATION COMPLETE`
 *   ② 三个种子**各自独立可跑**（重载页面即可重开验证流程）
 *   ③ 验证终点 = **一个真实出口**（PRP-M2-R1）：点一次「返回验证中心」→ 整页导航回 Hub
 *      → 验证 Runtime 不残留 → 可继续进入 Encounter Batch
 *
 * ⚠️ PRP-M2-R1-NEXT-RUN-VALIDATION-EXIT-BUG｜本文件曾经**把 P0 当成预期行为**：
 *    旧 N20 断言 `actionLabel === '下一局验证完成' && actionEnabled === false`、
 *    旧 N22 断言主动作强调条面积 `= 0`、旧 N23 断言「连点两次状态完全不变」。
 *    三条全绿，而真人录屏里那个按钮**点了没有任何反应** —— 因为终点态根本没有 action。
 *    现在这三条改判「终点态必须是一个**真实出口**」，并新增 ⑧ 段用真实鼠标点击闭环验证。
 *
 * ⚠️ 面积期望值与本文件内联的**布局规则**同源（卡片强调条 1240 / 进度节点 128 /
 *    强化图标 756+144 / 主动作强调条 990）—— 与 `tests/_e2e_run_page.cjs` 保持同一套口径。
 *
 * 用法：
 *   npm run build:portrait-lab
 *   node tests/_e2e_next_run.cjs          （或 npm run e2e:next-run）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

/** ⚠️ 与 `_e2e_run_page.cjs` 用**不同端口**：两个 E2E 可以并存，不抢端口。 */
const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8157;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const PAGE_URL = `${URL_BASE}/next-run.html`;
/** PRP-M2-R1：终点态的「返回验证中心」出口 —— 目标是 Hub 本身（整页导航）。 */
const HUB_URL = `${URL_BASE}/validation-hub.html`;
const ENCOUNTER_URL = `${URL_BASE}/encounter-lab.html`;
const EXIT_LABEL = '返回验证中心';
const EXIT_HREF = './validation-hub.html';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
};

/** 入面积账本的平涂色（与 runPage.ts 的 COLORS 一一对应；逐对互斥 → 精确相等即可分类）。 */
const PALETTE = {
  nodeDone: [0xd2, 0x92, 0x2a],
  nodeTodo: [0x46, 0x53, 0x6b],
  buffChip: [0xe6, 0xed, 0xf8],
  cardBar: [0x5f, 0x86, 0xc4],
  actionBar: [0x33, 0x50, 0x7a],
  /** 顶部「已获得强化」图标底色（按选项区分，三个都要登记）。 */
  buffIconShell: [0xb8, 0x56, 0x2e], // 重型弹头
  buffIconTwin: [0xc0, 0x7a, 0x2a], // 双联炮
  buffIconReload: [0x3f, 0x8f, 0x5a], // 快速装填
  buffIconKinetic: [0x8e, 0x44, 0xc0], // 动能爆发
};

/** 种子 id → 顶部图标底色（`BUFF_ICON_COLOR` 的浏览器侧镜像）。 */
const BUFF_ICON_KEY = {
  heavyShell: 'buffIconShell',
  twinCannon: 'buffIconTwin',
  fastReload: 'buffIconReload',
  kineticBurst: 'buffIconKinetic',
};

/** 种子 id → 卡片矢量图标色（`CHOICE_ICON_COLOR` 的浏览器侧镜像）。 */
const ICON_COLOR_BY_ID = {
  heavyShell: [0xff, 0xb0, 0x66],
  twinCannon: [0xff, 0xd1, 0x66],
  fastReload: [0x7f, 0xd6, 0xa0],
};

/** 卡片强调条单张面积（与 `RUN_CHOICE.barH` / `barInsetX` 同源：3 × 1240）。 */
const CARD_BAR = 1240;
/** 顶部进度节点单格面积（7 格合计恒 896）。 */
const NODE_CELL = 128;
/** 顶部强化图标 = 底色 756 + 高光块 144。 */
const BUFF_ICON = 756;
const BUFF_CHIP = 144;
/** 主动作按钮底部强调条面积。 */
const ACTION_BAR = 990;
/** 图标盒内「该选项专属图标色」的最小像素数（46×46 盒；与既有 E2E 同阈值）。 */
const ICON_MIN_PX = 30;
/** 面积比较容差（抗锯齿边缘）。 */
const TOL = 8;

/** 四条带上的采样点（用于「整页变暗」的同点位前后对比）。 */
const BAND_POINTS = [
  { x: 388, y: 48 },
  { x: 388, y: 96 },
  { x: 388, y: 196 },
  { x: 388, y: 650 },
  { x: 388, y: 810 },
];

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}

function startServer() {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/next-run.html';
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

const probeOf = (page) => page.evaluate(() => window.__RUNPAGE__.probe());

async function clickLogical(page, lx, ly) {
  const screen = (await probeOf(page)).screen;
  const cx = screen.left + (lx / 390) * screen.width;
  const cy = screen.top + (ly / 844) * screen.height;
  await page.mouse.click(cx, cy);
}

async function clickRect(page, r) {
  await clickLogical(page, r.x + r.w / 2, r.y + r.h / 2);
}

/** 按逻辑坐标点击**主动作按钮**（唯一入口）。 */
async function pressAction(page) {
  const p = await probeOf(page);
  await clickRect(page, p.actionRect);
  await page.waitForTimeout(60);
}

/** 点击第 i 张种子卡片。 */
async function clickSeed(page, i) {
  const p = await probeOf(page);
  await clickRect(page, p.seedOptions[i].rect);
  await page.waitForTimeout(60);
}

/** 真实 getImageData：按调色板精确 RGB 相等统计整页各层面积。 */
function pixelStats(page) {
  return page.evaluate((palette) => {
    const c = document.querySelector('#run-canvas');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
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

/** 采样若干逻辑坐标的真实像素。 */
function samplePixels(page, points) {
  return page.evaluate((pts) => {
    const c = document.querySelector('#run-canvas');
    const ctx = c.getContext('2d');
    const scale = c.width / 390;
    return pts.map((p) => {
      const x = Math.min(c.width - 1, Math.max(0, Math.floor(p.x * scale)));
      const y = Math.min(c.height - 1, Math.max(0, Math.floor(p.y * scale)));
      const d = ctx.getImageData(x, y, 1, 1).data;
      return { x: p.x, y: p.y, rgb: [d[0], d[1], d[2]] };
    });
  }, points);
}

/** 在给定盒内统计与目标色**精确相等**的像素数（盒坐标为页面绝对逻辑坐标）。 */
function countExactInBox(page, box, rgb) {
  return page.evaluate(
    ({ b, target }) => {
      const c = document.querySelector('#run-canvas');
      const ctx = c.getContext('2d');
      const s = c.width / 390;
      const x0 = Math.max(0, Math.floor(b.x * s));
      const y0 = Math.max(0, Math.floor(b.y * s));
      const x1 = Math.min(c.width, Math.ceil((b.x + b.w) * s));
      const y1 = Math.min(c.height, Math.ceil((b.y + b.h) * s));
      const d = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] === target[0] && d[i + 1] === target[1] && d[i + 2] === target[2]) n += 1;
      }
      return n;
    },
    { b: box, target: rgb },
  );
}

/** 面积断言（带容差）。 */
function near(actual, expected, tol = TOL) {
  return Math.abs(actual - expected) <= tol;
}

/**
 * 打开页面并等待「上一局 RUN COMPLETE」就绪（资产也加载完成 → 像素断言才有效）。
 */
async function openValidationPage(browser, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  await page.goto(PAGE_URL, { waitUntil: 'load' });
  await page.waitForFunction(
    () => {
      const c = document.querySelector('#run-canvas');
      if (!window.__RUNPAGE__ || !c || c.width === 0) return false;
      const p = window.__RUNPAGE__.probe();
      return p.phase === 'COMPLETE' && p.screen.width > 0 && p.assets.ready >= 5 && p.assets.failed.length === 0;
    },
    null,
    { timeout: 30000 },
  );
  return { ctx, page, pageErrors };
}

/** 期望账本：上一局终态（无需真实战斗 → 用模型规则生成）。 */
function ledgerPrior() {
  return {
    nodeDone: 7 * NODE_CELL,
    nodeTodo: 0,
    buffChip: 2 * BUFF_CHIP,
    cardBar: 0,
    actionBar: ACTION_BAR,
  };
}

/** 期望账本：新 Run 的 DAY 1 开场（IDLE 待机近景，顶部 1 个 seed 图标）。 */
function ledgerNewRun(seedId) {
  return {
    nodeDone: 1 * NODE_CELL,
    nodeTodo: 6 * NODE_CELL,
    buffChip: 1 * BUFF_CHIP,
    cardBar: 0,
    actionBar: ACTION_BAR,
    [BUFF_ICON_KEY[seedId]]: BUFF_ICON,
  };
}

/* ======================================================== 视口 1：完整流程 */

async function runFullFlow(browser, vp) {
  const tag = `${vp.w}×${vp.h}@${vp.dpr}`;
  const { ctx, page, pageErrors } = await openValidationPage(browser, vp);
  const SEEDS = ['heavyShell', 'twinCannon', 'fastReload'];
  /** 三个种子各自的第一场真实结局（用于汇总断言）。 */
  const outcomes = [];

  try {
    /* ---------- ① 起点 = 上一局 RUN COMPLETE ---------- */
    const start = await probeOf(page);
    log(
      start.nextRunValidation === true && start.phase === 'COMPLETE' && start.priorRun && start.priorRun.complete,
      `[${tag}] N1 起点是上一局 RUN COMPLETE（验证流程已启用）`,
      `phase=${start.phase} priorDay=${start.priorRun && start.priorRun.day} priorBattles=${
        start.priorRun && start.priorRun.battlesCompleted
      }`,
    );
    const priorBuild = (start.priorRun && start.priorRun.build) || [];
    log(
      priorBuild.join(',') === 'heavyShell,kineticBurst' &&
        start.priorRun.durabilityPercent > 0 &&
        start.priorRun.durabilityPercent < 100,
      `[${tag}] N2 上一局是一条真实的两层路线，且耐久**不是满的**`,
      `build=${priorBuild.join('+')} dur=${start.priorRun && start.priorRun.durabilityPercent}%`,
    );
    log(
      start.seedSelectOpen === false && start.seedChosen === null && start.seedOptions.length === 0,
      `[${tag}] N3 还没做任何选择（种子浮层未打开）`,
      `seedChosen=${start.seedChosen}`,
    );
    log(
      start.actionLabel === '完成本次冒险' && start.actionEnabled === true && start.validationComplete === false,
      `[${tag}] N4 上一局的唯一主动作仍是「完成本次冒险」（尚未进入验证）`,
      `label=${start.actionLabel} enabled=${start.actionEnabled}`,
    );

    if (vp.dpr === 1) {
      const px = await pixelStats(page);
      const exp = ledgerPrior();
      const ok =
        near(px.nodeDone, exp.nodeDone) &&
        near(px.nodeTodo, exp.nodeTodo) &&
        near(px.buffChip, exp.buffChip) &&
        near(px[BUFF_ICON_KEY.heavyShell], BUFF_ICON) &&
        near(px[BUFF_ICON_KEY.kineticBurst], BUFF_ICON) &&
        near(px.cardBar, 0) &&
        near(px.actionBar, exp.actionBar);
      log(
        ok,
        `[${tag}] N5 上一局终态账本：7 个进度格 + 两个强化图标 + 可用主动作（且无浮层卡片）`,
        `nodeDone=${px.nodeDone} nodeTodo=${px.nodeTodo} shell=${px.buffIconShell} kinetic=${px.buffIconKinetic} chip=${px.buffChip} card=${px.cardBar} action=${px.actionBar}`,
      );
    }

    // 浮层打开前的采样：供「整页重压暗」做**同点位前后对比**（不依赖绝对阈值）
    const beforeMask = vp.dpr === 1 ? await samplePixels(page, BAND_POINTS) : null;

    /* ---------- ② 唯一主动作 → 种子三选一 ---------- */
    await pressAction(page);
    const sel = await probeOf(page);
    log(
      sel.seedSelectOpen === true && sel.phase === 'COMPLETE',
      `[${tag}] N6 点主动作 → 打开种子浮层，且**没有**开默认新局（state 仍是上一局终态）`,
      `seedSelectOpen=${sel.seedSelectOpen} phase=${sel.phase} nodeId=${sel.nodeId}`,
    );
    log(
      sel.seedOptions.length === 3 &&
        sel.seedOptions.map((o) => o.id).join(',') === SEEDS.join(',') &&
        sel.seedOptions.map((o) => o.title).join(',') === '重炮开局,双联开局,快装开局' &&
        sel.overlayTitle === '带走一项改装',
      `[${tag}] N7 三张卡正好是三个种子（重炮 / 双联 / 快装开局）`,
      `${sel.seedOptions.map((o) => `${o.id}=${o.title}`).join(' | ')} title=${sel.overlayTitle}`,
    );

    // 点击遮罩其它区域：不关窗、不推进（必须显式选一个）
    await clickLogical(page, 195, 20);
    const afterBlank = await probeOf(page);
    log(
      afterBlank.seedSelectOpen === true && afterBlank.seedChosen === null,
      `[${tag}] N8 点遮罩空白处不关窗、不推进（必须显式选一个种子）`,
      `seedSelectOpen=${afterBlank.seedSelectOpen}`,
    );

    if (vp.dpr === 1) {
      const pxSeed = await pixelStats(page);
      log(
        near(pxSeed.cardBar, 3 * CARD_BAR) && near(pxSeed.actionBar, 0) && near(pxSeed.nodeDone, 0),
        `[${tag}] N9 种子浮层账本：3 张卡片强调条（底层几何被遮罩合成掉，主动作不再入账）`,
        `cardBar=${pxSeed.cardBar} action=${pxSeed.actionBar} nodeDone=${pxSeed.nodeDone}`,
      );
      // 三个图标真的画出来（盒内按面积统计；中心单点采样会假红，见既有注释）
      const iconHits = [];
      for (let i = 0; i < sel.seedOptions.length; i++) {
        const o = sel.seedOptions[i];
        iconHits.push(await countExactInBox(page, o.iconRect, ICON_COLOR_BY_ID[o.id]));
      }
      log(
        iconHits.every((n) => n >= ICON_MIN_PX),
        `[${tag}] N10 三张卡片的矢量图标真的画出来（盒内专属色面积 ≥ ${ICON_MIN_PX}px）`,
        iconHits.map((n, i) => `${sel.seedOptions[i].id}=${n}px`).join(' '),
      );
      // 整页变暗：同点位前后对比（遮罩下每个采样点都必须明显更暗）
      const afterMask = await samplePixels(page, BAND_POINTS);
      const deltas = afterMask.map((d, i) => {
        const b = beforeMask[i].rgb;
        return b[0] + b[1] + b[2] - (d.rgb[0] + d.rgb[1] + d.rgb[2]);
      });
      log(
        deltas.every((x) => x >= 15),
        `[${tag}] N11 种子浮层整页重压暗（5 个点位同点位前后对比）`,
        // ⚠️ 阈值刻意取 15 而不是 60：页面底色本身极暗（日志带 rgb 13/18/26 合计仅 57），
        //    0.86 深色遮罩对**暗底**的绝对降幅上限本来就小（实测最小 26）——
        //    取大阈值会把「遮罩确实画了」误判成失败。
        deltas.map((x, i) => `${BAND_POINTS[i].y}:-${x}`).join(' '),
      );
    }

    /* ---------- ③ reload → 三个种子各自独立可跑 ---------- */
    for (let s = 0; s < SEEDS.length; s++) {
      const seedId = SEEDS[s];
      if (s > 0) {
        // 重载页面 = 重开验证流程（回到上一局终态）→ 证明三个种子互不粘连
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(
          () => window.__RUNPAGE__ && window.__RUNPAGE__.probe().phase === 'COMPLETE',
          null,
          { timeout: 30000 },
        );
        await pressAction(page);
      }
      await clickSeed(page, s);
      const fresh = await probeOf(page);
      const build = fresh.build.join(',');
      log(
        fresh.seedChosen === seedId &&
          fresh.seedSelectOpen === false &&
          fresh.nodeId === 'd1-start' &&
          fresh.day === 1 &&
          build === seedId &&
          fresh.battle === null &&
          fresh.battlesCompleted === 0 &&
          fresh.validationComplete === false,
        `[${tag}] N12.${s} 选「${
          sel.seedOptions[s].title
        }」→ 全新 Run（DAY 1 / 满耐久 / Build 只剩 ${seedId} / 无战斗残留）`,
        `day=${fresh.day} build=${build} battle=${fresh.battle} battles=${fresh.battlesCompleted} prior=${fresh.priorRun && fresh.priorRun.build.join('+')}`,
      );
      // 上一局摘要仍在 → 库里两个状态确实并存且互不影响
      log(
        fresh.priorRun && fresh.priorRun.complete === true && fresh.priorRun.build.join('+') === 'heavyShell+kineticBurst',
        `[${tag}] N13.${s} 上一局摘要保留（新旧两局是**两个独立状态**，不是覆盖）`,
        `priorDay=${fresh.priorRun && fresh.priorRun.day} priorDur=${fresh.priorRun && fresh.priorRun.durabilityPercent}%`,
      );

      if (vp.dpr === 1 && s === 0) {
        const pxNew = await pixelStats(page);
        const exp = ledgerNewRun(seedId);
        const ok =
          near(pxNew.nodeDone, exp.nodeDone) &&
          near(pxNew.nodeTodo, exp.nodeTodo) &&
          near(pxNew.buffChip, exp.buffChip) &&
          near(pxNew[BUFF_ICON_KEY[seedId]], BUFF_ICON) &&
          near(pxNew.cardBar, 0) &&
          near(pxNew.actionBar, exp.actionBar);
        log(
          ok,
          `[${tag}] N14 新 Run 账本：进度节点回到 DAY 1（1 亮 6 暗）+ 只剩一个种子图标`,
          `nodeDone=${pxNew.nodeDone} nodeTodo=${pxNew.nodeTodo} chip=${pxNew.buffChip} icon=${
            pxNew[BUFF_ICON_KEY[seedId]]
          } action=${pxNew.actionBar}`,
        );
      }

      /* ---------- ④ 第一场真实 Battle：seed 真的进 Runtime ---------- */
      await pressAction(page); // d1-start → d2-battle1（IDLE）
      const atBattleNode = await probeOf(page);
      await pressAction(page); // → EVENT（敌情）
      const atEvent = await probeOf(page);
      await pressAction(page); // → BATTLE（真实物理开始）
      await page.waitForFunction(() => window.__RUNPAGE__.probe().phase === 'BATTLE', null, { timeout: 20000 });
      const inBattle = await probeOf(page);
      const bw = inBattle.battleWorld;
      log(
        atBattleNode.phase === 'IDLE' && atBattleNode.nodeId === 'd2-battle1' && atEvent.phase === 'EVENT',
        `[${tag}] N15.${s} 新 Run 不跳过任何节拍（DAY 1 开场 → 第一场节点的敌情 → 开打）`,
        `${atBattleNode.nodeId}/${atBattleNode.phase} → ${atEvent.phase} → ${inBattle.phase}`,
      );
      log(
        bw && bw.build.join(',') === seedId && bw.initialPlayerHp === bw.playerHpMax && bw.playerHpMax > 0,
        `[${tag}] N16.${s} 第一场运行时真的带着这个 seed，且**满耐久开局**（不是只画图标）`,
        `build=${bw && bw.build.join('+')} hp=${bw && bw.initialPlayerHp}/${bw && bw.playerHpMax}`,
      );
      log(
        bw && bw.world.spawnSeparation === 800 && bw.world.width === 1600 && bw.camera.showsWholeWorld === false,
        `[${tag}] N17.${s} 用的是正式战斗世界（1600×900 / 出生距 800 / 正式动态取景，非整世界远摄）`,
        `w=${bw && bw.world.width} sep=${bw && bw.world.spawnSeparation} whole=${bw && bw.camera.showsWholeWorld}`,
      );
      log(
        inBattle.stage.mode === 'battle' && inBattle.battleAssets.ready > 0 && inBattle.battleAssets.failed.length === 0,
        `[${tag}] N18.${s} 第一场舞台是**真实战斗世界**（正式 sprite 全部就绪、零降级占位）`,
        `mode=${inBattle.stage.mode} sprites=${inBattle.battleAssets.ready} failed=${inBattle.battleAssets.failed.length} nodeId=${inBattle.nodeId}`,
      );

      // 三个种子**各自**都跑到第一场结束 —— 这是「第一场结束即停止」的最强证据，
      // 也是 Queue 验收 3（三个 Seed 分别可独立运行）的真实数据来源。
      await page.waitForFunction(
        () => {
          const p = window.__RUNPAGE__.probe();
          return p.validationComplete === true || p.phase === 'RESULT' || p.phase === 'FAILED';
        },
        null,
        { timeout: 90000 },
      );
      const done = await probeOf(page);
      outcomes.push({
        seedId,
        phase: done.phase,
        battles: done.battlesCompleted,
        hp: done.battle ? done.battle.playerHp : null,
        hpMax: done.battle ? done.battle.playerHpMax : null,
        steps: done.battle ? done.battle.steps : null,
        complete: done.validationComplete,
        label: done.actionLabel,
        enabled: done.actionEnabled,
        href: done.exitHref,
      });

      if (s === 0) {
        log(
          done.validationComplete === true && done.battlesCompleted === 1,
          `[${tag}] N19 第一场结束即到达验证终点（NEXT RUN VALIDATION COMPLETE）`,
          `phase=${done.phase} battles=${done.battlesCompleted} complete=${done.validationComplete}`,
        );
        log(
          // ⚠️ PRP-M2-R1：终点态的主动作必须是一个**真实出口**。
          //    旧断言是 `actionLabel === '下一局验证完成' && actionEnabled === false`
          //    —— 那条断言把「按钮可见但点了没反应」的 P0 **当成预期行为**钉死了
          //    （E2E 全绿、真人一点就发现无响应）。现在改为「有按钮必有 action」。
          done.actionLabel === EXIT_LABEL &&
            done.actionEnabled === true &&
            done.exitHref === EXIT_HREF,
          `[${tag}] N20 验证终点：唯一主动作 = 「${EXIT_LABEL}」（文案与目标同源，可点）`,
          `label=${done.actionLabel} enabled=${done.actionEnabled} href=${done.exitHref}`,
        );
        log(
          done.battle !== null && done.battle.done === true && done.battle.steps > 0,
          `[${tag}] N21 终点画面是**已结束的真实战斗**（真实步数 / 真实剩余耐久 / 战场冻结）`,
          `winner=${done.battle && done.battle.winner} hp=${done.battle && done.battle.playerHp} steps=${
            done.battle && done.battle.steps
          }`,
        );

        if (vp.dpr === 1) {
          const pxDone = await pixelStats(page);
          log(
            // ⚠️ PRP-M2-R1：终点态按钮**可用**（= 一个真实出口）→ 强调条照常入账。
            //    旧断言 `near(pxDone.actionBar, 0)` 是「按钮被画成禁用色」的机器证据，
            //    也就是 P0 的另一面：屏幕上有个按钮，但它不属于任何 action。
            near(pxDone.actionBar, ACTION_BAR) &&
              near(pxDone.cardBar, 0) &&
              near(pxDone[BUFF_ICON_KEY[seedId]], BUFF_ICON),
            `[${tag}] N22 终点账本：主动作强调条**在账**（按钮是一个可点的真出口），强化图标仍在`,
            `action=${pxDone.actionBar} card=${pxDone.cardBar} icon=${pxDone[BUFF_ICON_KEY[seedId]]}`,
          );
        }

        /* ---------- ⑤ 终点态不再挂 Run 正式流程动作（结构上跑不到第二场） ---------- */
        // ⚠️ 这里刻意**不点击**：本状态下按钮是「返回验证中心」出口，点一下就会导航离开
        //    （真实点击验证在 ⑧ 段做）。这里只钉住静态事实：节点仍停在第一场、只打完 1 场、
        //    唯一可点的动作**指向 Hub**（而不是 Run 的「继续」）、页面里不存在第二个按钮。
        //    —— 旧版本的 N23 是「连点两次状态不变」，那条断言在出口做好之后不成立
        //    （点一次就该回 Hub），而它之前之所以能过，正是因为按钮**没有 action**。
        const atFinal = await probeOf(page);
        log(
          atFinal.phase === 'RESULT' &&
            atFinal.battlesCompleted === 1 &&
            atFinal.nodeId === 'd2-battle1' &&
            atFinal.exitHref === EXIT_HREF &&
            atFinal.domButtons === 0,
          `[${tag}] N23 终点态唯一的可点动作指向 Hub（不是 Run 的「继续」）⇒ 结构上跑不到第二场`,
          `phase=${atFinal.phase} battles=${atFinal.battlesCompleted} nodeId=${atFinal.nodeId} exit=${atFinal.exitHref} domButtons=${atFinal.domButtons}`,
        );
      }
    }

    /* ---------- ⑥ 三个种子各自的第一场结局（真实数据） ---------- */
    log(
      outcomes.length === 3 &&
        outcomes.every(
          (o) =>
            o.complete === true &&
            o.battles === 1 &&
            (o.phase === 'RESULT' || o.phase === 'FAILED') &&
            // ⚠️ PRP-M2-R1：三个种子的终点态都要有**同一个真实出口**（不再是禁用按钮）
            o.enabled === true &&
            o.label === EXIT_LABEL &&
            o.href === EXIT_HREF &&
            o.steps > 0,
        ),
      `[${tag}] N24 三个种子**各自独立**跑完第一场，并在同一条件下停下（终点行为完全一致）`,
      outcomes.map((o) => `${o.seedId}:${o.phase} hp=${Math.round(o.hp)}/${o.hpMax} steps=${o.steps}`).join(' | '),
    );

    /* ---------- ⑦ 页面无开发控制 / 无额外导航 / 无运行期错误 ---------- */
    const nav = await page.evaluate(() => performance.getEntriesByType('navigation').length);
    const last = await probeOf(page);
    log(
      last.debugControls === 0 && last.domButtons === 0,
      `[${tag}] N25 验证页面同样零开发控制（无 DOM 按钮、无 dev 控件）`,
      `debugControls=${last.debugControls} domButtons=${last.domButtons}`,
    );
    // ⚠️ PRP-M2-R1：出口是一个**真实整页导航** ⇒ 「不产生额外导航」只能在**点击出口之前**成立。
    //    这里收紧为 `=== 1`（只有初始加载那一次）：整局流程内所有切换都是同一页面内的状态切换。
    log(nav === 1, `[${tag}] N26 点击出口之前，整局流程 0 次额外导航（所有切换都在同一文档内）`, `navigations=${nav}`);
    log(pageErrors.length === 0, `[${tag}] N27 页面无运行期异常`, pageErrors.length ? pageErrors.join(' | ') : '0 errors');

    /*
      ---------- ⑧ PRP-M2-R1：终点态的唯一出口（真人录屏 P0 的机器回归） ----------
      真人录屏现象：底部按钮可见，连点**完全无响应**。根因 = 终点态既没有 action，
      又把 Run 的正式流程 action 挡住 ⇒ 「有按钮但无 action」。
      本段用**真实鼠标点击**证明它已经是一个真出口：点一次 → 立即回 Hub，
      且回 Hub 后验证 Runtime **不残留**（文档销毁 ⇒ probe 句柄 / 画布都不存在），
      并且可以**继续进入 Encounter Batch**（验收 4）。
    */
    const atExit = await probeOf(page);
    log(
      atExit.validationComplete === true &&
        atExit.actionEnabled === true &&
        atExit.actionLabel === EXIT_LABEL &&
        atExit.exitHref === EXIT_HREF,
      `[${tag}] N28 终点态唯一主动作 = 一个**真实出口**（文案与目标同源，不再是状态标记）`,
      `label=${atExit.actionLabel} enabled=${atExit.actionEnabled} href=${atExit.exitHref}`,
    );

    const beforeUrl = page.url();
    await clickRect(page, atExit.actionRect); // 真实鼠标点击底部按钮
    await page.waitForURL(HUB_URL, { timeout: 15000 });
    log(
      beforeUrl === PAGE_URL && page.url() === HUB_URL,
      `[${tag}] N29 点**一次**「${EXIT_LABEL}」→ 立即整页导航回验证中心（点击被吞的 P0 已消除）`,
      `${beforeUrl.split('/').pop()} → ${page.url().split('/').pop()}`,
    );

    await page.waitForFunction(() => document.querySelectorAll('a[data-vhub-id]').length === 3, null, { timeout: 15000 });
    const hub = await page.evaluate(() => ({
      hasRunPage: typeof window.__RUNPAGE__ !== 'undefined',
      canvas: document.querySelectorAll('canvas').length,
      hubRoot: !!document.querySelector('#vhub-root'),
      entries: [...document.querySelectorAll('a[data-vhub-id]')].map((a) => a.getAttribute('href')),
    }));
    log(
      hub.hubRoot === true && hub.hasRunPage === false && hub.canvas === 0,
      `[${tag}] N30 回 Hub 后验证 Runtime **不残留**：整页导航 ⇒ probe 句柄与画布随文档一起消失（无上一场 battle / projectile / timer）`,
      `hubRoot=${hub.hubRoot} __RUNPAGE__=${hub.hasRunPage} canvas=${hub.canvas}`,
    );
    log(
      JSON.stringify(hub.entries) === JSON.stringify(['./run-page.html', './next-run.html', './encounter-lab.html']),
      `[${tag}] N31 返回后 Hub 三个入口都在（可以继续验收下一项）`,
      hub.entries.join(' '),
    );

    await page.click('a[data-vhub-id="encounterBatch"]');
    await page.waitForURL(ENCOUNTER_URL, { timeout: 15000 });
    log(
      page.url() === ENCOUNTER_URL,
      `[${tag}] N32 返回 Hub 后**可以继续进入 Encounter Batch**（验收 4）`,
      page.url().split('/').pop(),
    );
  } finally {
    await ctx.close();
  }
}

/* ================================================ 视口 2：非 1 DPR 结构验证 */

async function runStructural(browser, vp) {
  const tag = `${vp.w}×${vp.h}@${vp.dpr}`;
  const { ctx, page, pageErrors } = await openValidationPage(browser, vp);
  try {
    const start = await probeOf(page);
    log(
      start.phase === 'COMPLETE' && start.nextRunValidation === true && start.seedOptions.length === 0,
      `[${tag}] S1 非 1 DPR 视口同样从上一局终态起步（结构一致）`,
      `phase=${start.phase} scale=${start.screen.scale.toFixed(3)} dpr=${start.screen.dpr}`,
    );
    await pressAction(page);
    const sel = await probeOf(page);
    log(
      sel.seedSelectOpen === true && sel.seedOptions.length === 3,
      `[${tag}] S2 种子浮层三个选项（结构与 DPR 无关）`,
      sel.seedOptions.map((o) => o.id).join(','),
    );
    await clickSeed(page, 2); // 快装开局
    const fresh = await probeOf(page);
    log(
      fresh.seedChosen === 'fastReload' && fresh.day === 1 && fresh.build.join(',') === 'fastReload',
      `[${tag}] S3 选「快装开局」→ 全新 Run 只带 fastReload`,
      `day=${fresh.day} build=${fresh.build.join('+')}`,
    );
    await pressAction(page);
    await pressAction(page);
    await pressAction(page);
    await page.waitForFunction(() => window.__RUNPAGE__.probe().phase === 'BATTLE', null, { timeout: 20000 });
    const bt = await probeOf(page);
    log(
      bt.battleWorld &&
        bt.battleWorld.build.join(',') === 'fastReload' &&
        bt.battleWorld.initialPlayerHp === bt.battleWorld.playerHpMax,
      `[${tag}] S4 快装 seed 同样真实进入第一场运行时（非 1 DPR 下亦成立）`,
      `build=${bt.battleWorld && bt.battleWorld.build.join('+')} hp=${bt.battleWorld && bt.battleWorld.initialPlayerHp}`,
    );
    log(pageErrors.length === 0, `[${tag}] S5 页面无运行期异常`, pageErrors.length ? pageErrors.join(' | ') : '0 errors');
  } finally {
    await ctx.close();
  }
}

/* ------------------------------------------------------------------ 主流程 */

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

    // 完整流程（真实战斗 + 精确像素）只在 390×844@1 上跑；非 1 DPR 只验结构。
    await runFullFlow(browser, { w: 390, h: 844, dpr: 1 });
    await runStructural(browser, { w: 1280, h: 720, dpr: 1.5 });

    // 隔离：验证入口产物存在，且独立构建产物内不含正式入口
    const idx = await fetch(`${URL_BASE}/index.html`);
    log(idx.status === 404, '[iso] J1 独立产物内不含正式入口 index.html', `status=${idx.status}`);
    const html = fs.readFileSync(path.join(ROOT, 'next-run.html'), 'utf8');
    const chunkMatch = html.match(/assets\/(next-run[-.\w]*\.js)/);
    log(!!chunkMatch, '[iso] J2 next-run.html 真实引用了自己的 chunk（不是陈旧产物）', chunkMatch ? chunkMatch[1] : 'none');
    if (chunkMatch) {
      const bytes = fs.readFileSync(path.join(ROOT, 'assets', chunkMatch[1]), 'utf8');
      const leaked = ['playerGameRuntime', 'canvasPlayerUIHost', 'webDomPlayerUIHost', 'garageFusion', 'bootstrap-wechat'].filter(
        (n) => bytes.includes(n),
      );
      log(
        leaked.length === 0,
        '[iso] J3 验证入口 chunk 内不含正式玩家 Runtime',
        leaked.length ? `命中=${leaked.join(',')}` : `扫描 ${bytes.length}B`,
      );
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log('\n============================');
  console.log(`E2E Next Run Validation: ${results.length - failed.length}/${results.length} PASS`);
  console.log('============================');
  if (failed.length) {
    for (const f of failed) console.log('FAILED: ' + f.name + ' | ' + f.detail);
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
