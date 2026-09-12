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
 *
 * ⚠️ PRP-R3：车辆改用**正式 sprite** → 车身 / 部件不再入账（sprite 像素非纯色），
 * 因此这里只剩「确实平涂且无人覆盖」的面：地线 / 路面 / 进度节点 / 强化图标 / 强调条。
 * 顶部「已获得强化图标」的底色按选项区分（三个色都要登记），高光块统一。
 */
const PALETTE = {
  ground: [0x8f, 0x7a, 0x52],
  road: [0x33, 0x2e, 0x42],
  nodeDone: [0xd2, 0x92, 0x2a],
  nodeTodo: [0x46, 0x53, 0x6b],
  buffIconHeavy: [0xb8, 0x56, 0x2e], // 重型弹头
  buffIconExplosive: [0xc0, 0x7a, 0x2a], // 爆裂弹
  buffIconRepair: [0x3f, 0x8f, 0x5a], // 紧急维修
  buffChip: [0xe6, 0xed, 0xf8],
  cardBar: [0x5f, 0x86, 0xc4],
  actionBar: [0x33, 0x50, 0x7a],
};

/**
 * 正式车辆 sprite 的特征色（PNG 实解码主色）。PRP-R3 必改 2 的判据：
 * 「战斗主体是真实车辆视觉」= 画面上真的存在这些精确色的像素（纯色矩形做不到）。
 * ⚠️ 只在 dpr=1 断言（dpr≠1 时画布被浏览器重采样，精确色不再成立）。
 */
const SPRITE_COLORS = {
  watermelonBody: [0x3f, 0x8a, 0x3c], // assets/visuals/body_watermelon.png
  bananaBody: [0xf6, 0xc8, 0x3c], // assets/visuals/body_banana.png
};

/** 三个强化图标的底色集合（用于「恰好一个在场」判定）。 */
const BUFF_ICON_COLORS = [PALETTE.buffIconHeavy, PALETTE.buffIconExplosive, PALETTE.buffIconRepair];

/**
 * 不入面积账本、但需要「按点位精确采样」的颜色（承载文字 / 被描边覆盖的面）。
 * 入账规则见 runPageLayout.ts 的 RunLayerId 注释。
 */
const SAMPLE_COLORS = {
  actionFill: [0x28, 0x40, 0x5f],
  actionFillOff: [0x23, 0x2b, 0x38],
  actionEdge: [0x4f, 0x70, 0x99],
  cardBg: [0x1b, 0x24, 0x32],
  cardEdge: [0x3d, 0x4c, 0x66],
  /** CHOICE 卡片左侧矢量图标色（按选项区分）。 */
  iconHeavy: [0xff, 0xb0, 0x66],
  iconExplosive: [0xff, 0xd1, 0x66],
  iconRepair: [0x7f, 0xd6, 0xa0],
};

/** 各状态整页分层面积的冻结期望（唯一来源：tests/portraitRunPage.test.ts RP-22）。 */
const LEDGER = {
  IDLE: {
    ground: 780, road: 19500, nodeDone: 384, nodeTodo: 512,
    buffIconHeavy: 0, buffIconExplosive: 0, buffIconRepair: 0, buffChip: 0,
    cardBar: 0, actionBar: 990,
  },
  EVENT: {
    ground: 780, road: 19500, nodeDone: 384, nodeTodo: 512,
    buffIconHeavy: 0, buffIconExplosive: 0, buffIconRepair: 0, buffChip: 0,
    cardBar: 0, actionBar: 990,
  },
  BATTLE: {
    ground: 780, road: 19500, nodeDone: 384, nodeTodo: 512,
    buffIconHeavy: 0, buffIconExplosive: 0, buffIconRepair: 0, buffChip: 0,
    cardBar: 0, actionBar: 0,
  },
  RESULT: {
    ground: 780, road: 19500, nodeDone: 384, nodeTodo: 512,
    buffIconHeavy: 0, buffIconExplosive: 0, buffIconRepair: 0, buffChip: 0,
    cardBar: 0, actionBar: 990,
  },
  CHOICE: {
    ground: 0, road: 0, nodeDone: 0, nodeTodo: 0,
    buffIconHeavy: 0, buffIconExplosive: 0, buffIconRepair: 0, buffChip: 0,
    cardBar: 3720, actionBar: 0,
  },
  // 回到 IDLE 且拿到 1 个强化（爆裂弹）→ 只多出「该选项底色 756 + 高光块 144」
  'IDLE+BUFF': {
    ground: 780, road: 19500, nodeDone: 384, nodeTodo: 512,
    buffIconHeavy: 0, buffIconExplosive: 756, buffIconRepair: 0, buffChip: 144,
    cardBar: 0, actionBar: 990,
  },
};

/**
 * 各条带底色的采样点（用于「分带结构」「CHOICE 整页变暗」的真实像素判定）。
 * ⚠️ 舞台带**不是平涂**：天空是垂直渐变（夜空 → 地平线暖雾，见 runPage.drawBackdrop）→
 *    改用「两处天空采样互不相同、且都不等于其它三带底色」判定（同一点位前后对比见 R36）。
 */
const BANDS = {
  top: { y: 48, color: [0x15, 0x1c, 0x28] },
  log: { y: 650, color: [0x0d, 0x12, 0x1a] },
  action: { y: 810, color: [0x14, 0x1a, 0x26] },
};
/** 舞台天空的两个采样高度：都必须在地平线暖端之上、且高于全部山脊顶（不受遮挡）。 */
const STAGE_SKY_Y = [96, 196];
/** 四条带的 5 个采样点（top / sky×2 / log / action）——「整页变暗」用同一点位前后对比。 */
const BAND_POINTS = [
  { key: 'top', x: 388, y: BANDS.top.y },
  { key: 'skyHigh', x: 388, y: STAGE_SKY_Y[0] },
  { key: 'skyLow', x: 388, y: STAGE_SKY_Y[1] },
  { key: 'log', x: 388, y: BANDS.log.y },
  { key: 'action', x: 388, y: BANDS.action.y },
];
const sampleBands = (page) => samplePixels(page, BAND_POINTS.map((p) => ({ x: p.x, y: p.y })));

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

/** 统计画布中与给定 RGB **精确相等**的像素个数（用于反证「玩家页面上没有 Arena 调试色」）。 */
function countExact(page, rgb) {
  return page.evaluate((target) => {
    const c = document.querySelector('#run-canvas');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === target[0] && d[i + 1] === target[1] && d[i + 2] === target[2]) n += 1;
    }
    return n;
  }, rgb);
}

/**
 * PRP-R1：Arena A（Debug Lab）独占的调试色 —— 纵向竞技场的黄色描边框。
 * 玩家 Run Page 的调色板里**不存在**这个色 → 出现即代表 Debug 画面泄漏进玩家页面。
 */
const ARENA_DEBUG_YELLOW = [0xff, 0xd3, 0x5a];

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
    // 重采样后精确值不再成立：改断言「结构与流程」（不做精确面积）
    const structural =
      key === 'CHOICE'
        ? stats.cardBar > 0 && stats.road === 0
        : stats.road > 0 && stats.nodeTodo > 0;
    log(
      structural,
      `[${tag}] ${label}（dpr≠1 只做结构断言）`,
      `road=${stats.road} nodeTodo=${stats.nodeTodo} cardBar=${stats.cardBar} actionBar=${stats.actionBar}`,
    );
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
  // PRP-R3：车辆视觉来自正式 PNG，必须等资源**真的加载完成**再做像素断言
  //（加载完成会触发重绘；未就绪时车辆整件不画 —— 绝不画纯色占位）。
  await page.waitForFunction(
    () => {
      const c = document.querySelector('#run-canvas');
      if (!window.__RUNPAGE__ || !c || c.width === 0) return false;
      const p = window.__RUNPAGE__.probe();
      return p.screen.width > 0 && p.assets.ready >= 5 && p.assets.failed.length === 0 && p.stage.player.allSprites;
    },
    null,
    { timeout: 15000 },
  );

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

  /*
    PRP-R1 必改 4：电脑预览必须直接把「手机页面」呈到眼前 ——
    居中、放大到约 88vh、严格 390:844，而不是屏幕中央一个很小的窄框。
    真机 / 窄窗口（≤640 宽或 ≤620 高）保持铺满，不走手机框。
  */
  const isDesktopPreview = vp.w > 640 && vp.h > 620;
  if (isDesktopPreview) {
    const expectH = Math.min(vp.h * 0.88, 940);
    const cx = p0.screen.left + p0.screen.width / 2;
    const cy = p0.screen.top + p0.screen.height / 2;
    log(
      Math.abs(cx - vp.w / 2) <= 2 && Math.abs(cy - vp.h / 2) <= 2,
      `[${tag}] R2b 手机页面在桌面视口内居中`,
      `center=${round2(cx)},${round2(cy)} viewport=${vp.w / 2},${vp.h / 2}`,
    );
    log(
      Math.abs(p0.screen.height - expectH) <= 2 &&
        Math.abs(p0.screen.width / p0.screen.height - 390 / 844) < 0.01,
      `[${tag}] R2c 手机页面高度≈88vh 且严格保持 390:844`,
      `h=${round2(p0.screen.height)} expect=${round2(expectH)} ratio=${round2(p0.screen.width / p0.screen.height)}`,
    );
    log(
      p0.screen.height / vp.h >= 0.8 && p0.debugControls === 0 && p0.domButtons === 0,
      `[${tag}] R2d 手机画面是第一视觉主体，且页面上零开发控制`,
      `hRatio=${round2(p0.screen.height / vp.h)} debug=${p0.debugControls} buttons=${p0.domButtons}`,
    );
  }

  /*
    PRP-R1 必改 2 / 验收 2：玩家页面里**不得**出现 Arena A 的调试黄框或任何 Debug 句柄。
    这条断言与「唯一入口」互为保险：即使入口被写错，画面本身也会立刻判 FAIL。
  */
  if (vp.dpr === 1) {
    const arenaPixels = await countExact(page, ARENA_DEBUG_YELLOW);
    log(arenaPixels === 0, `[${tag}] R2e 玩家页面无 Arena A 调试黄框`, `arenaYellow=${arenaPixels}px`);
  }
  const labHandle = await page.evaluate(
    () =>
      typeof window.__PBL__ !== 'undefined' ||
      typeof window.__PBL_LAB__ !== 'undefined' ||
      !!document.querySelector('#pbl-root, #pbl-canvas'),
  );
  log(!labHandle, `[${tag}] R2f 玩家页面不暴露 Debug Lab 句柄 / 节点`, `labHandle=${labHandle}`);

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

  // 真实像素：三条平涂带的底色精确命中 + 舞台天空是渐变（dpr=1 才精确）
  if (vp.dpr === 1) {
    const samples = await sampleBands(page);
    const at = (i) => samples[i].rgb.join(',');
    const flatOk =
      at(0) === BANDS.top.color.join(',') &&
      at(3) === BANDS.log.color.join(',') &&
      at(4) === BANDS.action.color.join(',');
    const skyGradient = at(1) !== at(2);
    const skyIsSky =
      at(1) !== BANDS.top.color.join(',') &&
      at(1) !== BANDS.log.color.join(',') &&
      at(1) !== BANDS.action.color.join(',');
    log(
      flatOk && skyGradient && skyIsSky,
      `[${tag}] R5 分带底色真实像素：三条平涂带精确命中，舞台天空为垂直渐变（非大片平涂）`,
      `top=${at(0)} sky=${at(1)}→${at(2)} log=${at(3)} action=${at(4)}`,
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
  log(p0.logCount === 2, `[${tag}] R9 IDLE 日志已可见（DAY 行 + 行进叙事）`, `logCount=${p0.logCount}`);
  log(p0.actionLabel === '继续' && p0.actionEnabled, `[${tag}] R10 底部显示「继续」且可点`, `${p0.actionLabel}/${p0.actionEnabled}`);
  log(
    p0.buffs.length === 0 && p0.day === 3 && p0.dayTotal === 7,
    `[${tag}] R11 顶部 = DAY 3/7 + 0 个强化图标`,
    `day=${p0.day}/${p0.dayTotal} buffs=${p0.buffs.length}`,
  );
  /*
    PRP-R3 必改 1：顶部第二行**是空的不存在**，不是「5 个固定空槽」。
    buffIconCount 由布局函数直接给出（0 个强化 → 0 个图标矩形）。
  */
  log(
    p0.buffIconCount === 0 && p0.layers.buffIcon === 0 && p0.layers.buffChip === 0,
    `[${tag}] R11b 未获得强化时顶部没有任何图标 / 空槽（结构性）`,
    `buffIconCount=${p0.buffIconCount} buffIcon=${p0.layers.buffIcon}`,
  );
  // 必改 3：玩家可见日志不得含任何方括号 Debug 前缀，也不得是内部状态 dump
  const logTexts = p0.log.map((l) => l.text);
  log(
    logTexts.every((t) => !t.includes('[') && !t.includes(']') && t.trim().length > 0),
    `[${tag}] R11c 日志是玩家叙事（无 [系统]/[事件] 前缀）`,
    logTexts.join(' ｜ '),
  );
  const sIdle = await pixelStats(page);
  ledgerCheck(tag, 'R12 IDLE', sIdle, 'IDLE', vp.dpr);

  /* ------------------------------------------- 3b) 战斗主体 = 真实车辆 sprite */
  if (vp.dpr === 1) {
    const melon = await countExact(page, SPRITE_COLORS.watermelonBody);
    log(
      melon > 200,
      `[${tag}] R12c 战斗主体是正式车辆 sprite（西瓜车身真实像素）`,
      `watermelonBody=${melon}px（纯色矩形不可能命中）`,
    );
  }

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
    p.logCount === p0.logCount + 2 && p.log[p.log.length - 1].text === '你遭遇了追猎者。',
    `[${tag}] R14 EVENT 日志追加 2 句自然语言敌情`,
    p.log.slice(-2).map((l) => l.text).join(' ｜ '),
  );
  log(p.actionLabel === '遭遇敌人', `[${tag}] R15 EVENT 底部切换为对应当前动作`, p.actionLabel);
  log(p.stage.enemy !== null && p.stage.playerLeftOfEnemy === true, `[${tag}] R16 EVENT 敌人在右侧出现、玩家在左`, `gap=${p.stage.minGapPx}`);
  log(
    !!p.stage.enemy && p.stage.enemy.allSprites === true && p.stage.player.allSprites === true,
    `[${tag}] R16b 两车全部可视件都是真实 sprite / 真实半径轮（无纯色矩形占位）`,
    `player=${p.stage.player.allSprites} enemy=${p.stage.enemy && p.stage.enemy.allSprites}`,
  );
  const sEvent = await pixelStats(page);
  ledgerCheck(tag, 'R17 EVENT', sEvent, 'EVENT', vp.dpr);
  if (vp.dpr === 1) {
    const melon = await countExact(page, SPRITE_COLORS.watermelonBody);
    const banana = await countExact(page, SPRITE_COLORS.bananaBody);
    log(
      melon > 200 && banana > 200,
      `[${tag}] R17b 玩家 / 敌人都是正式车辆 sprite（双车真实像素在场）`,
      `watermelon=${melon}px banana=${banana}px`,
    );
  }

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
    Math.abs(p.stage.scale - p0.stage.scale) < 1e-9 && p.stage.scale > 0.7 && p.stage.scale <= 0.9,
    `[${tag}] R21 显示缩放为固定值且明显放大（不随状态跳变）`,
    `scale=${p.stage.scale}`,
  );
  const sBattle = await pixelStats(page);
  ledgerCheck(tag, 'R22 BATTLE 开局', sBattle, 'BATTLE', vp.dpr);
  if (vp.dpr === 1) {
    // 禁用态的真实像素证据：按钮填充离开可用态色（禁用色在 (btn.x+10, btn.y+24)）
    const btn = p.actionRect;
    const off = await samplePixels(page, [{ x: btn.x + 10, y: btn.y + 24 }]);
    log(
      off[0].rgb.join(',') === SAMPLE_COLORS.actionFillOff.join(',') && sBattle.actionBar === 0,
      `[${tag}] R22b BATTLE 主动作进入禁用态（填充变色 + 可用态强调条消失）`,
      `fill=${off[0].rgb.join(',')} actionBar=${sBattle.actionBar}`,
    );
  }

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
  log(added === 3, `[${tag}] R26 战斗结束后一次性追加 3 行玩家叙事（胜负 + 耐久 % + 改装机会）`, `+${added}: ${p.log.slice(-3).map((l) => l.text).join(' ｜ ')}`);
  log(p.stage.enemy === null && p.stage.enemyGone === true, `[${tag}] R27 敌方消失、玩家留在舞台`, `enemy=${p.stage.enemy} gone=${p.stage.enemyGone}`);
  log(p.actionLabel === '继续' && p.actionEnabled, `[${tag}] R28 RESULT 底部重新出现「继续」`, `${p.actionLabel}/${p.actionEnabled}`);
  const sResult = await pixelStats(page);
  ledgerCheck(tag, 'R29 RESULT', sResult, 'RESULT', vp.dpr);
  const bandSamplesBefore = vp.dpr === 1 ? await sampleBands(page) : [];
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
  log(p.logCount === p0.logCount + 5, `[${tag}] R33 打开浮层不写日志（历史全程累积）`, `logCount=${p.logCount}`);
  log(
    JSON.stringify(p.stage.player) === playerRectAtResult,
    `[${tag}] R34 原页面位置不变（玩家几何与 RESULT 完全一致）`,
    '',
  );
  // 必改 4：三张卡片各只显示「图标 + 名称 + 一句结果」，且都有一句玩家向结果
  log(
    p.choiceOptions.every((o) => typeof o.note === 'string' && o.note.length > 0 && !o.note.includes('[')),
    `[${tag}] R34b 每张卡片都带「一句结果」（无内部字段 / 无方括号）`,
    p.choiceOptions.map((o) => `${o.label}：${o.note}`).join(' ｜ '),
  );
  const sChoice = await pixelStats(page);
  ledgerCheck(tag, 'R35 CHOICE', sChoice, 'CHOICE', vp.dpr);
  if (vp.dpr === 1) {
    // 「整体变暗」：与 RESULT 时**同一批点位**逐点对比，5 处必须全部离开原色（被遮罩合成）
    const after = await sampleBands(page);
    const changed = after.map((s, i) => s.rgb.join(',') !== bandSamplesBefore[i].rgb.join(','));
    log(
      changed.every(Boolean),
      `[${tag}] R36 CHOICE 整页变暗（5 个分带采样点逐点离开 CHOICE 之前的值）`,
      BAND_POINTS.map((p, i) => `${p.key}:${bandSamplesBefore[i].rgb.join(',')}→${after[i].rgb.join(',')}`).join(' '),
    );
    // 卡片几何：真实像素在「卡片底 / 顶部强调条 / 左侧矢量图标中心」三处命中期望色
    const cards = p.choiceOptions.map((o) => o.rect);
    const pts = [];
    for (const c of cards) {
      pts.push(
        { x: c.x + 6, y: c.y + 6 }, // 卡片底（避开 2px 描边与强调条）
        { x: c.x + c.w / 2, y: c.y + 6 }, // 顶部强调条
        { x: c.x + 18 + 23, y: c.y + Math.round((c.h - 46) / 2) + 23 }, // 图标中心
      );
    }
    const cardPixels = await samplePixels(page, pts);
    const at = (i) => cardPixels[i].rgb.join(',');
    const bgOk = [0, 3, 6].every((i) => at(i) === SAMPLE_COLORS.cardBg.join(','));
    const barOk = [1, 4, 7].every((i) => at(i) === PALETTE.cardBar.join(','));
    const iconOk =
      at(2) === SAMPLE_COLORS.iconHeavy.join(',') &&
      at(5) === SAMPLE_COLORS.iconExplosive.join(',') &&
      at(8) === SAMPLE_COLORS.iconRepair.join(',');
    log(
      bgOk && barOk && iconOk,
      `[${tag}] R37 卡片 = 图标 + 名称 + 一句结果（几何被真实像素命中，位置 = 布局唯一来源）`,
      `bg=${at(0)} bar=${at(1)} icon=${at(2)}/${at(5)}/${at(8)}`,
    );
  }

  /* --------------------------- 8) 真实点击中间卡片 → 回到 IDLE */
  const card1 = p.choiceOptions[1].rect; // 爆裂弹
  await clickRect(page, card1);
  p = await probeOf(page);
  log(p.phase === 'IDLE' && !p.choiceOpen, `[${tag}] R38 选择后浮层关闭、原页面恢复（回 IDLE）`, `phase=${p.phase}`);
  log(
    p.buffs.length === 1 && p.buffLabels[0] === '爆裂弹',
    `[${tag}] R39 顶部新增对应强化图标（只加 1 个，不是填满 5 个槽）`,
    `buffs=${p.buffLabels.join('/')} buffIconCount=${p.buffIconCount}`,
  );
  log(
    p.log[p.log.length - 1].text === '你换上了爆裂弹。' && p.logCount === p0.logCount + 6,
    `[${tag}] R40 日志追加自然语言结果（你换上了爆裂弹。）且历史完整`,
    `logCount=${p.logCount} last=${p.log[p.log.length - 1].text}`,
  );
  log(
    JSON.stringify(p.phaseTrail) === JSON.stringify(['IDLE', 'EVENT', 'BATTLE', 'RESULT', 'CHOICE', 'IDLE']),
    `[${tag}] R41 五状态轨迹精确（同一页面内切换）`,
    p.phaseTrail.join('→'),
  );
  const sFinale = await pixelStats(page);
  ledgerCheck(tag, 'R42 回到 IDLE + 1 个强化', sFinale, 'IDLE+BUFF', vp.dpr);
  if (vp.dpr === 1) {
    // 顶部图标底色按选项区分：拿到「爆裂弹」→ 只应是该选项的底色（其余两个为 0）
    const icons = [sFinale.buffIconHeavy, sFinale.buffIconExplosive, sFinale.buffIconRepair];
    log(
      icons.filter((n) => n > 0).length === 1 && sFinale.buffIconExplosive === 756 && sFinale.buffChip === 144,
      `[${tag}] R42b 顶部只有 1 个真实图标（无空槽、无 5 个占位格子）`,
      `heavy/explosive/repair=${icons.join('/')} chip=${sFinale.buffChip}`,
    );
    const melon = await countExact(page, SPRITE_COLORS.watermelonBody);
    log(melon > 200, `[${tag}] R42c 回到 IDLE 后车辆仍是正式 sprite`, `watermelon=${melon}px`);
  }

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
      { w: 390, h: 844, dpr: 1 }, // 真机竖屏：铺满视口
      { w: 700, h: 900, dpr: 1.5 }, // 窄窗口：仍走铺满分支
      { w: 1920, h: 1080, dpr: 1 }, // PRP-R1：桌面真人验收视口（含精确像素账本）
      { w: 1280, h: 720, dpr: 1.5 }, // PRP-R1：Windows 150% 缩放下的真实 CSS 视口
    ];
    for (const vp of viewports) await runViewport(browser, vp);

    // 隔离：独立产物内不含正式入口；Run Page bundle 不含正式玩法 Runtime 模块
    const idx = await fetch(`${URL_BASE}/index.html`);
    log(idx.status === 404, '[iso] I1 独立产物内不含正式入口 index.html', `status=${idx.status}`);
    // ⚠️ 必须查 **run-page.html 实际引用的那个 chunk**：outDir 采用 safe-delete shim 覆盖写
    //（emptyOutDir:false），目录里会残留历次构建的旧 chunk —— 按文件名前缀「随便挑一个」会
    // 挑到过期产物，让隔离断言变成空转。
    const pageHtml = fs.readFileSync(path.join(ROOT, 'run-page.html'), 'utf8');
    const chunkMatch = pageHtml.match(/assets\/(run-page[-.\w]*\.js)/);
    const jsName = chunkMatch ? chunkMatch[1] : '';
    log(!!jsName, '[iso] I2 Run Page 有独立 chunk（取自 run-page.html 的真实引用）', jsName || '(missing)');
    const bundle = jsName ? fs.readFileSync(path.join(ROOT, 'assets', jsName), 'utf8') : '';
    // ⚠️ 本机产物目录**整体不可清理**：vite.portrait-lab.config.ts 走 emptyOutDir:false
    //（safe-delete shim 拦截 fs.rmSync），历次构建的旧 chunk 会一直留在 assets/ 里。
    // 所以这里**不能**断言「目录内零残留」——那是构建配置的既知约束，不是产品缺陷。
    // 真正要防的缺陷是「隔离断言读到过期产物而空转」：I2 已改为取 run-page.html 的真实引用。
    // I2b 因此改为断言**被引用的 chunk 就是最新一次构建的产物**（mtime 最新），
    // 残留文件数只作信息性报告（用于提示本地可手动清理）。
    const allChunks = fs
      .readdirSync(path.join(ROOT, 'assets'))
      .filter((f) => f.startsWith('run-page') && f.endsWith('.js'));
    const mtimeOf = (f) => {
      try {
        return fs.statSync(path.join(ROOT, 'assets', f)).mtimeMs;
      } catch {
        return -1;
      }
    };
    const liveMtime = jsName ? mtimeOf(jsName) : -1;
    const newestStale = Math.max(-1, ...allChunks.filter((f) => f !== jsName).map(mtimeOf));
    log(
      !!jsName && liveMtime > newestStale,
      '[iso] I2b 被引用的 Run Page chunk 是最新构建产物（非过期 chunk）',
      `live=${jsName}@${liveMtime} stale=${allChunks.length - (jsName ? 1 : 0)}个(信息性，emptyOutDir:false)`,
    );
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
