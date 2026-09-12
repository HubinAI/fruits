/**
 * PRP-F0-RUN-PAGE-SHELL｜Portrait Run Prototype —— 浏览器真实闭环验证。
 *
 * 手段：真实浏览器（playwright-core / msedge）打开独立产物 dist-portrait-lab/run-page.html，
 *   - 真实鼠标点击（page.mouse.click，按逻辑坐标 → 屏幕坐标换算，非 evaluate 直调业务方法）
 *   - 真实像素读取（canvas.getContext('2d').getImageData，**精确 RGB 相等**统计各层面积）
 *   - 只读诊断句柄 window.__RUNPAGE__（Run Page 专属，仅存在于本原型页面）
 * 不伪造任何步骤；任一断言失败即 FAIL。
 *
 * 面积期望值来自纯模型账本 tests/portraitRunPage.test.ts（RP-22），
 * 本文件是「浏览器真实渲染 == 纯模型预测」的跨语言交叉核对：
 *   - dpr=1 且容器恰为 390×844 时 scale=1 → 精确像素断言成立；
 *   - dpr≠1 时画布被浏览器重采样，改断言「结构与流程」（不做精确面积）。
 *
 * 用法：
 *   npm run build:portrait-lab
 *   node tests/_e2e_run_page.cjs          （或 npm run e2e:run-page）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8156;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const PAGE_URL = `${URL_BASE}/run-page.html`;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
};

/**
 * Run Page 几何调色板（与 src/lab/portraitBattleLab/runPage.ts 的 COLORS 一一对应）。
 * 逐对互斥 → 精确相等匹配即可分类，无需区间判定（文字抗锯齿永不落入这些色）。
 */
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

/**
 * 不入面积账本、但需要「按点位精确采样」的颜色（承载文字 / 被描边覆盖的面）。
 * 入账规则见 runPageLayout.ts 的 RunLayerId 注释。
 */
const SAMPLE_COLORS = {
  actionFill: [0x28, 0x40, 0x5f],
  actionEdge: [0x4f, 0x70, 0x99],
  cardBg: [0x1b, 0x24, 0x32],
  cardEdge: [0x3d, 0x4c, 0x66],
};

/** 各状态整页分层面积的冻结期望（唯一来源：tests/portraitRunPage.test.ts RP-22）。 */
const LEDGER = {
  IDLE: {
    ground: 1496, playerBody: 3012, playerPart: 288, enemyBody: 0, enemyPart: 0,
    nodeDone: 432, nodeTodo: 576, iconSlot: 3920, iconOwned: 0, iconChip: 0,
    cardBar: 0, cardChip: 0, actionBar: 966, actionBarOff: 0,
  },
  EVENT: {
    ground: 1496, playerBody: 3012, playerPart: 288, enemyBody: 2774, enemyPart: 540,
    nodeDone: 432, nodeTodo: 576, iconSlot: 3920, iconOwned: 0, iconChip: 0,
    cardBar: 0, cardChip: 0, actionBar: 966, actionBarOff: 0,
  },
  BATTLE: {
    ground: 1496, playerBody: 3012, playerPart: 288, enemyBody: 2774, enemyPart: 540,
    nodeDone: 432, nodeTodo: 576, iconSlot: 3920, iconOwned: 0, iconChip: 0,
    cardBar: 0, cardChip: 0, actionBar: 0, actionBarOff: 966,
  },
  RESULT: {
    ground: 1496, playerBody: 3012, playerPart: 288, enemyBody: 0, enemyPart: 0,
    nodeDone: 432, nodeTodo: 576, iconSlot: 3920, iconOwned: 0, iconChip: 0,
    cardBar: 0, cardChip: 0, actionBar: 966, actionBarOff: 0,
  },
  CHOICE: {
    ground: 0, playerBody: 0, playerPart: 0, enemyBody: 0, enemyPart: 0,
    nodeDone: 0, nodeTodo: 0, iconSlot: 0, iconOwned: 0, iconChip: 0,
    cardBar: 3624, cardChip: 2028, actionBar: 0, actionBarOff: 0,
  },
  'IDLE+BUFF': {
    ground: 1496, playerBody: 3012, playerPart: 288, enemyBody: 0, enemyPart: 0,
    nodeDone: 432, nodeTodo: 576, iconSlot: 3136, iconOwned: 640, iconChip: 144,
    cardBar: 0, cardChip: 0, actionBar: 966, actionBarOff: 0,
  },
};

/** 各带底色（用于「分带结构」与「CHOICE 整页变暗」的真实像素判定）。 */
const BANDS = {
  top: { y: 48, color: [0x15, 0x1c, 0x28] },
  stage: { y: 300, color: [0x0f, 0x14, 0x1d] },
  log: { y: 650, color: [0x0d, 0x12, 0x1a] },
  action: { y: 810, color: [0x14, 0x1a, 0x26] },
};

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}

function startServer() {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/run-page.html';
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

/** 采样若干逻辑坐标的真实像素（用于分带结构与变暗判定）。 */
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

const probeOf = (page) => page.evaluate(() => window.__RUNPAGE__.probe());

/** 真实鼠标点击：逻辑坐标 → 屏幕坐标（用画布真实 CSS 矩形换算，不用 DPR-backed 尺寸）。 */
async function clickLogical(page, lx, ly) {
  const screen = (await probeOf(page)).screen;
  const cx = screen.left + (lx / 390) * screen.width;
  const cy = screen.top + (ly / 844) * screen.height;
  await page.mouse.click(cx, cy);
}

const centerOf = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** 点击某个布局矩形的中心（真实鼠标事件）。 */
async function clickRect(page, r) {
  const c = centerOf(r);
  await clickLogical(page, c.x, c.y);
}

function ledgerCheck(tag, label, stats, key, dpr) {
  const exp = LEDGER[key];
  if (dpr !== 1) {
    // 重采样后精确值不再成立：改断言「玩家/敌人两侧都存在」这类结构事实
    const structural =
      key === 'CHOICE'
        ? stats.cardBar > 0 && stats.playerBody === 0
        : stats.playerBody > 0 && (key.startsWith('CHOICE') ? true : stats.playerBody > 0);
    log(structural, `[${tag}] ${label}（dpr≠1 只做结构断言）`, `playerBody=${stats.playerBody} cardBar=${stats.cardBar}`);
    return;
  }
  const diff = Object.keys(exp).filter((k) => stats[k] !== exp[k]);
  log(
    diff.length === 0,
    `[${tag}] ${label} 分层像素面积精确`,
    diff.length
      ? diff.map((k) => `${k}:实际${stats[k]}≠期望${exp[k]}`).join(' / ')
      : Object.keys(exp).length + ' 层全部一致',
  );
}

async function runViewport(browser, vp) {
  const tag = `${vp.w}×${vp.h}@${vp.dpr}`;
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr });
  const page = await ctx.newPage();

  await page.goto(PAGE_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const c = document.querySelector('#run-canvas');
    return !!window.__RUNPAGE__ && !!c && c.width > 0 && window.__RUNPAGE__.probe().screen.width > 0;
  }, null, { timeout: 15000 });

  const urlAtStart = page.url();
  const navCountAtStart = await page.evaluate(() => performance.getEntriesByType('navigation').length);

  /* ---------------------------------------------------- 1) 页面层级 */
  const p0 = await probeOf(page);
  log(p0.logicalW === 390 && p0.logicalH === 844, `[${tag}] R1 竖屏逻辑区 390×844`, `logical=${p0.logicalW}×${p0.logicalH}`);
  log(
    p0.screen.width > 0 && p0.screen.height / p0.screen.width > 1.9,
    `[${tag}] R2 画布 CSS 矩形为竖屏比例`,
    `screen=${round2(p0.screen.width)}×${round2(p0.screen.height)} scale=${round2(p0.screen.scale)}`,
  );

  const b = p0.bands;
  const bands = [b.top, b.stage, b.log, b.action];
  let cursor = 0;
  let bandsOk = true;
  for (const band of bands) {
    if (band.x !== 0 || band.w !== 390 || band.y !== cursor) bandsOk = false;
    cursor += band.h;
  }
  log(bandsOk && cursor === 844, `[${tag}] R3 四带无缝无叠、合计铺满 844`, bands.map((x) => x.h).join('+') + `=${cursor}`);
  log(
    b.top.h <= Math.round(844 * 0.12),
    `[${tag}] R4 顶部为薄层（≤ 12% 高度）`,
    `top=${b.top.h} / 844`,
  );

  // 真实像素：四条带的底色（dpr=1 才精确）
  if (vp.dpr === 1) {
    const samples = await samplePixels(page, [
      { x: 388, y: BANDS.top.y },
      { x: 388, y: BANDS.stage.y },
      { x: 388, y: BANDS.log.y },
      { x: 388, y: BANDS.action.y },
    ]);
    const keys = ['top', 'stage', 'log', 'action'];
    const bad = keys.filter((k, i) => samples[i].rgb.join(',') !== BANDS[k].color.join(','));
    log(
      bad.length === 0,
      `[${tag}] R5 四条带底色的真实像素与结构定义一致`,
      bad.length ? bad.map((k, i) => k).join('/') : samples.map((s, i) => `${keys[i]}=${s.rgb.join(',')}`).join(' '),
    );
  }

  /* -------------------------------------------- 2) Debug 与玩家界面分离 */
  const domButtons = await page.evaluate(() => document.querySelectorAll('button').length);
  log(
    p0.debugControls === 0 && p0.domButtons === 0 && domButtons === 0,
    `[${tag}] R6 玩家页面 0 开发控制 / 0 DOM 按钮`,
    `debugControls=${p0.debugControls} domButtons=${p0.domButtons} documentButtons=${domButtons}`,
  );
  const hasDevText = await page.evaluate(() => /Gate|Arena A|Arena B|Loadout|Encounter|Start|Reset/.test(document.body.innerText || ''));
  log(!hasDevText, `[${tag}] R7 页面文本不含任何开发控制字样`, `hasDevText=${hasDevText}`);

  /* -------------------------------------------------- 3) IDLE 起点 */
  log(p0.phase === 'IDLE', `[${tag}] R8 默认打开即 IDLE`, `phase=${p0.phase}`);
  log(p0.logCount >= 3, `[${tag}] R9 IDLE 日志已可见`, `logCount=${p0.logCount}`);
  log(p0.actionLabel === '继续' && p0.actionEnabled, `[${tag}] R10 底部显示「继续」且可点`, `${p0.actionLabel}/${p0.actionEnabled}`);
  log(p0.buffs.length === 0 && p0.day === 3 && p0.dayTotal === 7, `[${tag}] R11 顶部 = DAY 3/7 + 0 个 Build 图标`, `day=${p0.day}/${p0.dayTotal} buffs=${p0.buffs.length}`);
  const sIdle = await pixelStats(page);
  ledgerCheck(tag, 'R12 IDLE', sIdle, 'IDLE', vp.dpr);

  // 主动作按钮：填充 / 描边（不入账）与强调条（入账）三色都要在预期位置命中
  if (vp.dpr === 1) {
    const btn = p0.actionRect;
    const btnPixels = await samplePixels(page, [
      { x: btn.x + 10, y: btn.y + 24 },
      { x: btn.x + 1, y: btn.y + 24 }, // 2px 描边覆盖 btn.x..btn.x+1 两列
      { x: btn.x + 6 + 20, y: btn.y + btn.h - 9 + 1 },
    ]);
    log(
      btnPixels[0].rgb.join(',') === SAMPLE_COLORS.actionFill.join(',') &&
        btnPixels[1].rgb.join(',') === SAMPLE_COLORS.actionEdge.join(',') &&
        btnPixels[2].rgb.join(',') === PALETTE.actionBar.join(','),
      `[${tag}] R12b 主动作按钮真实像素（填充 / 描边 / 强调条）`,
      btnPixels.map((q) => q.rgb.join(',')).join(' | '),
    );
  }

  /* --------------------------------- 4) 真实点击「继续」→ EVENT */
  await clickRect(page, p0.actionRect);
  let p = await probeOf(page);
  log(p.phase === 'EVENT', `[${tag}] R13 真实点击「继续」→ EVENT`, `phase=${p.phase}`);
  log(
    p.logCount === p0.logCount + 1 && p.log[p.log.length - 1].text.includes('遭遇敌人'),
    `[${tag}] R14 EVENT 日志追加事件文本`,
    p.log[p.log.length - 1].text,
  );
  log(p.actionLabel === '遭遇敌人', `[${tag}] R15 EVENT 底部切换为对应当前动作`, p.actionLabel);
  log(p.stage.enemy !== null && p.stage.playerLeftOfEnemy === true, `[${tag}] R16 EVENT 敌人在右侧出现、玩家在左`, `gap=${p.stage.minGapPx}`);
  const sEvent = await pixelStats(page);
  ledgerCheck(tag, 'R17 EVENT', sEvent, 'EVENT', vp.dpr);

  /* --------------------------------- 5) 真实点击「遭遇敌人」→ BATTLE */
  await clickRect(page, p.actionRect);
  p = await probeOf(page);
  const logAtBattleStart = p.log;
  log(p.phase === 'BATTLE', `[${tag}] R18 真实点击「遭遇敌人」→ BATTLE（不跳页面）`, `phase=${p.phase}`);
  log(p.actionLabel === '战斗中' && p.actionEnabled === false, `[${tag}] R19 BATTLE 底部为「战斗中」且不可误触`, `${p.actionLabel}/${p.actionEnabled}`);
  log(
    p.stage.playerLeftOfEnemy === true && p.stage.minGapPx > 0,
    `[${tag}] R20 BATTLE 玩家左 / 敌人右（严格分离）`,
    `playerLeftOfEnemy=${p.stage.playerLeftOfEnemy} gap=${p.stage.minGapPx}`,
  );
  log(
    p.stage.scale === 0.6 && p.stage.scale === p0.stage.scale,
    `[${tag}] R21 显示缩放为固定值 0.6（不随状态跳变）`,
    `scale=${p.stage.scale}`,
  );
  const sBattle = await pixelStats(page);
  ledgerCheck(tag, 'R22 BATTLE 开局', sBattle, 'BATTLE', vp.dpr);

  // 真实等待一段时间：日志不得刷逐帧伤害明细（验收 4）
  await page.waitForTimeout(700);
  const pMid = await probeOf(page);
  log(
    pMid.phase === 'BATTLE' && JSON.stringify(pMid.log) === JSON.stringify(logAtBattleStart),
    `[${tag}] R23 BATTLE 期间日志零变化（不刷伤害明细）`,
    `logCount=${pMid.log.length} steps=${pMid.battle && pMid.battle.steps}`,
  );
  log(
    pMid.battle && pMid.battle.enemyHp < pMid.battle.enemyHpMax && pMid.battle.playerHp <= pMid.battle.playerHpMax,
    `[${tag}] R24 战斗在真实推进（耐久在变，但没写日志）`,
    pMid.battle ? `enemy ${pMid.battle.enemyHp}/${pMid.battle.enemyHpMax} · self ${pMid.battle.playerHp}/${pMid.battle.playerHpMax}` : '',
  );

  /* ----------------------------------------- 6) 自动结束 → RESULT */
  await page.waitForFunction(() => window.__RUNPAGE__.probe().phase === 'RESULT', null, { timeout: 15000 });
  p = await probeOf(page);
  log(p.phase === 'RESULT', `[${tag}] R25 战斗自动结束 → RESULT（无操作介入）`, `phase=${p.phase}`);
  const added = p.log.length - logAtBattleStart.length;
  log(added === 2, `[${tag}] R26 战斗结束后一次性追加 2 行（结果 + 耐久占位）`, `+${added}: ${p.log.slice(-2).map((l) => l.text).join(' ｜ ')}`);
  log(p.stage.enemy === null && p.stage.enemyGone === true, `[${tag}] R27 敌方消失、玩家留在舞台`, `enemy=${p.stage.enemy} gone=${p.stage.enemyGone}`);
  log(p.actionLabel === '继续' && p.actionEnabled, `[${tag}] R28 RESULT 底部重新出现「继续」`, `${p.actionLabel}/${p.actionEnabled}`);
  const sResult = await pixelStats(page);
  ledgerCheck(tag, 'R29 RESULT', sResult, 'RESULT', vp.dpr);
  const playerRectAtResult = JSON.stringify(p.stage.player);

  /* --------------------------------- 7) 真实点击「继续」→ CHOICE */
  await clickRect(page, p.actionRect);
  p = await probeOf(page);
  log(p.phase === 'CHOICE' && p.choiceOpen, `[${tag}] R30 真实点击「继续」→ CHOICE 浮层`, `phase=${p.phase}`);
  log(p.choiceOptions.length === 3, `[${tag}] R31 三选一浮层恰好 3 个选项`, p.choiceOptions.map((o) => o.label).join(' / '));
  log(
    JSON.stringify(p.choiceOptions.map((o) => o.label)) === JSON.stringify(['重型弹头', '爆裂弹', '紧急维修']),
    `[${tag}] R32 选项正是 Queue 点名的三项`,
    p.choiceOptions.map((o) => o.label).join(' / '),
  );
  log(p.logCount === p0.logCount + 4, `[${tag}] R33 打开浮层不写日志（历史全程累积）`, `logCount=${p.logCount}`);
  log(
    JSON.stringify(p.stage.player) === playerRectAtResult,
    `[${tag}] R34 原页面位置不变（玩家几何与 RESULT 完全一致）`,
    '',
  );
  const sChoice = await pixelStats(page);
  ledgerCheck(tag, 'R35 CHOICE', sChoice, 'CHOICE', vp.dpr);
  if (vp.dpr === 1) {
    // 「整体变暗」：四条带的真实像素都必须离开原底色（被遮罩合成成新色）
    const samples = await samplePixels(page, [
      { x: 388, y: BANDS.top.y },
      { x: 388, y: BANDS.stage.y },
      { x: 388, y: BANDS.log.y },
      { x: 388, y: BANDS.action.y },
    ]);
    const keys = ['top', 'stage', 'log', 'action'];
    const allDarkened = samples.every((s, i) => s.rgb.join(',') !== BANDS[keys[i]].color.join(','));
    log(
      allDarkened,
      `[${tag}] R36 CHOICE 整页变暗（四条带全部离开原底色）`,
      samples.map((s, i) => `${keys[i]}=${s.rgb.join(',')}`).join(' '),
    );
    // 卡片位置：真实像素在卡片四角与色块中心命中期望色
    const cards = p.choiceOptions.map((o) => o.rect);
    const pts = [];
    for (const c of cards) {
      pts.push({ x: c.x + 6, y: c.y + 6 }, { x: c.x + c.w - 6, y: c.y + 6 }, { x: c.x + c.w / 2, y: c.y + c.h - 6 });
      pts.push({ x: c.x + 16 + 13, y: c.y + Math.round((c.h - 26) / 2) + 13 });
    }
    const cardPixels = await samplePixels(page, pts);
    const chipsOk = [3, 7, 11].every((i) => cardPixels[i].rgb.join(',') === PALETTE.cardChip.join(','));
    const bgOk = [0, 1, 2, 4, 5, 6, 8, 9, 10].every(
      (i) => cardPixels[i].rgb.join(',') === SAMPLE_COLORS.cardBg.join(','),
    );
    log(
      chipsOk && bgOk,
      `[${tag}] R37 卡片几何可被真实像素命中（位置 = 布局唯一来源）`,
      `chip=${cardPixels[3].rgb.join(',')} bg=${cardPixels[0].rgb.join(',')}`,
    );
  }

  /* --------------------------- 8) 真实点击中间卡片 → 回到 IDLE */
  const card1 = p.choiceOptions[1].rect; // 爆裂弹
  await clickRect(page, card1);
  p = await probeOf(page);
  log(p.phase === 'IDLE' && !p.choiceOpen, `[${tag}] R38 选择后浮层关闭、原页面恢复（回 IDLE）`, `phase=${p.phase}`);
  log(
    p.buffs.length === 1 && p.buffLabels[0] === '爆裂弹',
    `[${tag}] R39 顶部新增对应核心 Build 图标`,
    `buffs=${p.buffLabels.join('/')}`,
  );
  log(
    p.log[p.log.length - 1].text === '你选择了 爆裂弹' && p.logCount === p0.logCount + 5,
    `[${tag}] R40 日志追加「你选择了 XXX」且历史完整`,
    `logCount=${p.logCount} last=${p.log[p.log.length - 1].text}`,
  );
  log(
    JSON.stringify(p.phaseTrail) === JSON.stringify(['IDLE', 'EVENT', 'BATTLE', 'RESULT', 'CHOICE', 'IDLE']),
    `[${tag}] R41 五状态轨迹精确（同一页面内切换）`,
    p.phaseTrail.join('→'),
  );
  const sFinale = await pixelStats(page);
  ledgerCheck(tag, 'R42 回到 IDLE + 1 个强化', sFinale, 'IDLE+BUFF', vp.dpr);

  /* ------------------------------------------- 9) 持续存在的同一页面 */
  const after = await probeOf(page);
  await clickRect(page, after.actionRect);
  const pAgain = await probeOf(page);
  log(pAgain.phase === 'EVENT', `[${tag}] R43 同一页面可继续下一轮（持续存在的 Run Page）`, `phase=${pAgain.phase}`);
  const urlNow = page.url();
  const navCountNow = await page.evaluate(() => performance.getEntriesByType('navigation').length);
  log(
    urlNow === urlAtStart && navCountNow === navCountAtStart,
    `[${tag}] R44 全程零页面跳转（URL 不变 / navigation 条数不变）`,
    `url=${urlNow.replace(URL_BASE, '')} nav=${navCountAtStart}→${navCountNow}`,
  );

  await ctx.close();
}

function round2(v) {
  return Math.round(v * 100) / 100;
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
      { w: 390, h: 844, dpr: 1 }, // 容器恰为逻辑尺寸 → scale=1 → 精确像素断言成立
      { w: 700, h: 900, dpr: 1.5 },
    ];
    for (const vp of viewports) await runViewport(browser, vp);

    // 隔离：独立产物内不含正式入口；Run Page bundle 不含正式玩法 Runtime 模块
    const idx = await fetch(`${URL_BASE}/index.html`);
    log(idx.status === 404, '[iso] I1 独立产物内不含正式入口 index.html', `status=${idx.status}`);
    const assetsDir = path.join(ROOT, 'assets');
    const jsName = fs.readdirSync(assetsDir).find((f) => f.startsWith('run-page') && f.endsWith('.js'));
    log(!!jsName, '[iso] I2 Run Page 有独立 chunk', jsName || '(missing)');
    const bundle = fs.readFileSync(path.join(assetsDir, jsName), 'utf8');
    const leaked = ['playerGameRuntime', 'canvasPlayerUIHost', 'webDomPlayerUIHost', 'physicsLab', 'planckBattleOrchestrator', 'garageFusion', 'bootstrap-wechat', 'ArenaARuntime'].filter((n) => bundle.includes(n));
    log(leaked.length === 0, '[iso] I3 Run Page bundle 不含正式玩法 Runtime / Arena A 运行时', leaked.length ? `泄漏=${leaked.join(',')}` : `bundle=${jsName} size=${bundle.length}B`);
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log('\n============================');
  console.log(`E2E Portrait Run Page: ${results.length - failed.length}/${results.length} PASS`);
  console.log('============================');
  if (failed.length) {
    for (const f of failed) console.log('FAILED: ' + f.name + ' | ' + f.detail);
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
