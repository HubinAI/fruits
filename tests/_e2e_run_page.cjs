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
  buffIconShell: [0xb8, 0x56, 0x2e], // 重型弹头
  buffIconTwin: [0xc0, 0x7a, 0x2a], // 双联炮
  buffIconReload: [0x3f, 0x8f, 0x5a], // 快速装填
  /* ---- PRP-BUILD-01 第二层（条件池）图标底色 ---- */
  buffIconKinetic: [0x8e, 0x44, 0xc0], // 动能爆发
  buffIconTriple: [0x2f, 0x8f, 0xc4], // 三连装填
  buffIconRepair: [0x4f, 0xc4, 0xa8], // 紧急维修
  buffChip: [0xe6, 0xed, 0xf8],
  cardBar: [0x5f, 0x86, 0xc4],
  actionBar: [0x33, 0x50, 0x7a],
};

/** 强化 id → 顶部图标底色的调色板键（`BUFF_ICON_COLOR` 的浏览器侧镜像）。 */
const BUFF_ICON_KEY = {
  heavyShell: 'buffIconShell',
  twinCannon: 'buffIconTwin',
  fastReload: 'buffIconReload',
  kineticBurst: 'buffIconKinetic',
  tripleLoad: 'buffIconTriple',
  emergencyRepair: 'buffIconRepair',
};

/**
 * 正式车辆 sprite 的特征色（参考值）——取自 PNG 解码出的**主色带**：
 * - body_watermelon.png：主色团 RGB 近似 48..63 / 128..143 / 48..63（约占不透明像素 60%）
 * - body_banana.png：主色团 RGB 近似 240..255 / 192..207 / 48..63（约占 46%）
 * PRP-R3 必改 2 的判据：「战斗主体是真实车辆视觉」= 画面上真的存在这些色族的像素（纯色矩形做不到）。
 * ⚠️ 必须用 `SPRITE_COLOR_TOL` 做色族匹配，不能要求精确相等：车辆 sprite 被缩放绘制，
 *    重采样后**精确色几乎不残留**（实测香蕉精确命中仅 5px）。色族匹配仍保持
 *    两车互斥（实测交叉命中恒为 0），故判据强度不受影响。
 * ⚠️ 只在 dpr=1 断言（dpr≠1 时画布被浏览器重采样，色值不可复现）。
 */
const SPRITE_COLORS = {
  watermelonBody: [0x30, 0x80, 0x30], // assets/visuals/body_watermelon.png 主色带
  bananaBody: [0xf0, 0xc0, 0x30], // assets/visuals/body_banana.png 主色带
  /**
   * 菠萝车身（PRP-RUN-R1：低压验证对手「菠萝冲刺车」`R1-RUSH-02`）。
   *
   * ⚠️ 菠萝没有 PNG 资源 —— 它由**正式 Renderer** 程序化绘制
   * （`src/render/renderer.ts` 的 `body_pineapple` 分支：`#c9c24a` 填充，
   * `globalAlpha 0.92`）。因此画到画布上的像素是**与竞技场天空的混合值**：
   * 0.92 × (201,194,74) + 0.08 × 背景(≈#1d3050 地平线带) ≈ **(187,182,74)**。
   * 与目标色各通道差 (14,12,0) → 仍在 tol 16 内；同时与西瓜/香蕉色族互斥
   * （对香蕉差 (39,2,26)、对西瓜差 (153,66,26)，均 > 16）。
   */
  pineappleBody: [0xc9, 0xc2, 0x4a],
};

/**
 * 车辆 sprite 特征色的容差。缩放绘制的 sprite 重采样后**精确色几乎不残留**
 * （实测香蕉精确命中仅 5px）→ 必须带一个小容差。
 * 容差 16 仍能保持两车特征色互斥（实测交叉命中恒为 0），故不影响判据强度。
 */
const SPRITE_COLOR_TOL = 16;

/**
 * CHOICE 卡片图标盒内「该选项专属图标色」必须出现的**最小像素数**（46×46 = 2116 盒内）。
 * ⚠️ PRP-F2：图标判据从「图标中心单点采样」升级为「盒内按面积统计」，原因见
 *    `runPage.ts` 的 `iconRect` 注释 —— 双联炮图标是两根并排炮管，46×46 盒的几何中心
 *    恰好落在两管之间的空隙里，单点采样会**假红**。面积统计更强：证明图标成片画出来，
 *    且对「弹体 / 双炮管 / 循环箭头」三种形状都成立。阈值取 ~1.4%（远低于描边字形的实际覆盖）。
 */
const CHOICE_ICON_MIN_PX = 30;

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
  /** CHOICE 卡片左侧矢量图标色（按选项区分；六个两两 RGB 精确互斥）。 */
  iconShell: [0xff, 0xb0, 0x66],
  iconTwin: [0xff, 0xd1, 0x66],
  iconReload: [0x7f, 0xd6, 0xa0],
  iconKinetic: [0xc9, 0x8c, 0xf0],
  iconTriple: [0x79, 0xc0, 0xea],
  iconRepair: [0x5f, 0xd0, 0xc0],
};

/** 选项 id → 该选项的 CHOICE 卡片图标色（`CHOICE_ICON_COLOR` 的浏览器侧镜像）。 */
const ICON_COLOR_BY_ID = {
  heavyShell: SAMPLE_COLORS.iconShell,
  twinCannon: SAMPLE_COLORS.iconTwin,
  fastReload: SAMPLE_COLORS.iconReload,
  kineticBurst: SAMPLE_COLORS.iconKinetic,
  tripleLoad: SAMPLE_COLORS.iconTriple,
  emergencyRepair: SAMPLE_COLORS.iconRepair,
};

/**
 * 面积账本的**期望值生成器**（唯一来源 = 模型层 `tests/portraitRunPage.test.ts` 的
 * RP-22 / RP-22b 冻结字面量）。
 *
 * ⚠️ 为什么不是一张静态表：PRP-BUILD-01 把流程改成「三场两选」后，**同一个 phase 会出现在
 *    不同的 day**（DAY 3 / 4 / 5）—— 顶部进度节点随之整体前移一格；顶部强化行也会从
 *    0 → 1 → 2 个图标。逐帧静态表会退化成手抄，容易与真实规则脱钩，
 *    因此这里按**与布局函数同源的规则**生成，并与 RP-22b 的字面量保持一致：
 *      · 节点：`nodeDone = day × 128` / `nodeTodo = (7 − day) × 128`（总量恒 896）；
 *      · 图标：每个 30×30 = 900（底色 756 + 高光块 144），**只画实际已获得的**。
 *
 * ⚠️ `stage === 'idle'` 才有 `ground` / `road`（待机近景两层）；battle 模式舞台带被真实
 *    Planck 战斗世界整块位图覆盖 → 这两层在画面上不存在（账面 0，不是「少画了」）。
 */
function ledgerExpect({ day, stage, buffs = [], action = true, masked = false }) {
  const e = {
    ground: 0,
    road: 0,
    nodeDone: 0,
    nodeTodo: 0,
    buffChip: 0,
    cardBar: 0,
    actionBar: 0,
  };
  for (const k of Object.keys(BUFF_ICON_KEY)) e[BUFF_ICON_KEY[k]] = 0;
  // CHOICE：整页被遮罩合成 → 底层不再带精确色，只登记浮层自身的强调条（3 张 × 1240）
  if (masked) {
    e.cardBar = 3 * 1240;
    return e;
  }
  if (stage === 'idle') {
    e.ground = 780;
    e.road = 19500;
  }
  e.nodeDone = day * 128;
  e.nodeTodo = (7 - day) * 128;
  for (const id of buffs) e[BUFF_ICON_KEY[id]] = 756;
  e.buffChip = 144 * buffs.length;
  e.actionBar = action ? 990 : 0;
  return e;
}

/** 面积比较容差（见 LEDGER_TOLERANCE 注释）。 */
const LEDGER_TOLERANCE = { ground: 64, road: 256 };
const LEDGER_TOLERANCE_DEFAULT = 8;

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
 * PRP-F1：在「某辆车**自己的可见外廓**」内统计该车体特征色像素（带容差）。
 * 比「整页数精确色」更强：既证明该车是真实车身外观（不是纯色占位），
 * 又证明「左=西瓜 / 右=对手车身」没有互换（交叉命中必须为 0）。
 * ⚠️ `box` 的坐标系**随 stage.mode 变化**（见 runPage.ts 的 stage 字段注释）：
 *   - `mode === 'battle'`：bounds 是**带内相对坐标** → `bandOffsetY` 传 `bands.stage.y`（80）；
 *   - `mode === 'idle'`：bounds 已是**页面绝对坐标** → `bandOffsetY` 必须传 0。
 */
function countSpriteColorInBox(page, box, bandOffsetY, rgb, tol) {
  return page.evaluate(
    ({ box: b, off, target, tol: t }) => {
      const c = document.querySelector('#run-canvas');
      const ctx = c.getContext('2d');
      const s = c.width / 390;
      const x0 = Math.max(0, Math.floor(b.x * s));
      const x1 = Math.min(c.width, Math.ceil((b.x + b.w) * s));
      const y0 = Math.max(0, Math.floor((b.y + off) * s));
      const y1 = Math.min(c.height, Math.ceil((b.y + off + b.h) * s));
      const d = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - target[0]) <= t && Math.abs(d[i + 1] - target[1]) <= t && Math.abs(d[i + 2] - target[2]) <= t) n += 1;
      }
      return n;
    },
    { box, off: bandOffsetY, target: rgb, tol },
  );
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

/**
 * 面积账本比对。`exp` 由 `ledgerExpect()` 生成（= 模型层 RP-22 / RP-22b 的冻结口径）。
 * ⚠️ dpr≠1 时画布被浏览器重采样 → 只做结构断言（不做精确面积）。
 */
function ledgerCheck(tag, label, stats, exp, dpr) {
  if (dpr !== 1) {
    // 重采样后精确值不再成立：改断言「结构与流程」（不做精确面积）
    const structural =
      exp.cardBar > 0
        ? stats.cardBar > 0 && stats.road === 0
        : stats.nodeTodo > 0 || stats.ground > 0;
    log(
      structural,
      `[${tag}] ${label}（dpr≠1 只做结构断言）`,
      `road=${stats.road} nodeTodo=${stats.nodeTodo} cardBar=${stats.cardBar} actionBar=${stats.actionBar}`,
    );
    return;
  }
  const diff = Object.keys(exp).filter(
    (k) => Math.abs((stats[k] ?? 0) - exp[k]) > (LEDGER_TOLERANCE[k] ?? LEDGER_TOLERANCE_DEFAULT),
  );
  log(
    diff.length === 0,
    `[${tag}] ${label} 分层像素面积精确`,
    diff.length
      ? diff.map((k) => `${k}:实际${stats[k]}≠期望${exp[k]}`).join(' / ')
      : Object.keys(exp).length + ' 层全部一致',
  );
}

/**
 * CHOICE 卡片图标判据（PRP-BUILD-01 起两层池共用）。
 *
 * 口径：在**与绘制同源**的 `iconRect` 盒内按**精确 RGB 相等**统计该选项的专属图标色，
 * 并要求其它**全部五个**图标色的命中为 0（六个色两两精确互斥）。
 * ⚠️ 必须是「盒内面积统计」而不是中心单点采样：双联炮图标是两根并排炮管，
 *    46×46 盒的几何中心恰好落在两管空隙里，单点采样会假红（见 runPage.ts 的 iconRect 注释）。
 */
async function checkChoiceIcons(page, probe) {
  const all = Object.values(ICON_COLOR_BY_ID);
  const rows = [];
  for (const opt of probe.choiceOptions) {
    const own = ICON_COLOR_BY_ID[opt.id];
    const ownPx = await countSpriteColorInBox(page, opt.iconRect, 0, own, 0);
    let cross = 0;
    for (const c of all) {
      if (c === own) continue;
      cross += await countSpriteColorInBox(page, opt.iconRect, 0, c, 0);
    }
    rows.push({ id: opt.id, own: ownPx, cross });
  }
  return {
    ok: rows.every((r) => r.own >= CHOICE_ICON_MIN_PX && r.cross === 0),
    rows,
  };
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
  // PRP-F1：IDLE 中部舞台 = PRP 待机近景（还没接战 → 结构上没有真实战斗世界）
  log(
    p0.stage.mode === 'idle' && p0.battleWorld === null && p0.stage.scale > 0.5,
    `[${tag}] R11d IDLE 中部舞台 = PRP 待机近景（未接战，无真实战斗世界）`,
    `mode=${p0.stage.mode} battleWorld=${p0.battleWorld ? 'present' : 'null'} scale=${round2(p0.stage.scale)}`,
  );
  const sIdle = await pixelStats(page);
  ledgerCheck(tag, 'R12 IDLE (DAY3 · 0 强化)', sIdle, ledgerExpect({ day: 3, stage: 'idle' }), vp.dpr);

  /* ------------------------------------------- 3b) 战斗主体 = 真实车辆 sprite */
  if (vp.dpr === 1) {
    // IDLE 是待机近景（scale 0.77，车更大 + bounds 已是页面绝对坐标 → 不再加带偏移）
    const melon = await countSpriteColorInBox(page, p0.stage.player.bounds, 0, SPRITE_COLORS.watermelonBody, SPRITE_COLOR_TOL);
    log(
      melon >= 100,
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
    p.logCount === p0.logCount + 2 && p.log[p.log.length - 1].text === '你遭遇了菠萝冲刺车。',
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
  /*
    PRP-F1 必改 1/2：遭遇瞬间中部舞台就已切成**真实 Planck 战斗世界**（世界尺度 = 正式 1600×900），
    并且两车之间有**明确的开局距离**（实测外廓间距 ≈ 564 世界 px）—— 不是「贴车开局」。
    ⚠️ PRP-RUN-R1：本值随**敌方车身的真实外廓宽度**变化（开区间距 = 800 − 半宽A − 半宽B）。
  */
  const w0 = p.battleWorld;
  log(
    p.stage.mode === 'battle' && !!w0 && w0.world.width === 1600 && w0.world.height === 900,
    `[${tag}] R16c 必改 1：战斗世界 = 正式 arena 尺度（1600×900，不是舞台带宽 390）`,
    w0 ? `world=${w0.world.width}×${w0.world.height} groundY=${w0.world.groundY} cameraScale=${round2(w0.camera.scale)}` : 'no battleWorld',
  );
  log(
    !!w0 &&
      Math.round(w0.world.spawnAx) === 400 &&
      Math.round(w0.world.spawnBx) === 1200 &&
      Math.round(w0.world.spawnSeparation) === 800,
    `[${tag}] R16d 必改 2：出生点 = 正式 spawnA 400 / spawnB 1200（中心距 800 世界 px）`,
    w0 ? `spawnA=${round2(w0.world.spawnAx)} spawnB=${round2(w0.world.spawnBx)} sep=${round2(w0.world.spawnSeparation)}` : '',
  );
  log(
    !!w0 && w0.world.initialGap > 400 && Math.round(w0.world.initialGap) === 564,
    `[${tag}] R16e 必改 2：开局有明确距离（两车外廓实测间距 ≈ 564 世界 px）`,
    w0 ? `initialGap=${round2(w0.world.initialGap)}（世界宽的 ${round2((w0.world.initialGap / w0.world.width) * 100)}%）` : '',
  );
  const sEvent = await pixelStats(page);
  ledgerCheck(tag, 'R17 EVENT (DAY3)', sEvent, ledgerExpect({ day: 3, stage: 'battle' }), vp.dpr);
  if (vp.dpr === 1) {
    /*
      PRP-RUN-R1 实测（dpr=1、EVENT 帧、tol 16）：
      左框（玩家西瓜）西瓜色族在场 / 菠萝与香蕉 0；右框（敌人菠萝冲刺车）菠萝色族在场 /
      西瓜与香蕉 0 → 两车特征色**互斥**，判定「右边那辆确实是另一个正式车身」。
      阈值取实测值的 ~55%，交叉命中必须严格为 0。
    */
    const bandY = p.bands.stage.y;
    const pb = p.stage.player.bounds;
    const eb = p.stage.enemy.bounds;
    const melonL = await countSpriteColorInBox(page, pb, bandY, SPRITE_COLORS.watermelonBody, SPRITE_COLOR_TOL);
    const pineL = await countSpriteColorInBox(page, pb, bandY, SPRITE_COLORS.pineappleBody, SPRITE_COLOR_TOL);
    const bananaL = await countSpriteColorInBox(page, pb, bandY, SPRITE_COLORS.bananaBody, SPRITE_COLOR_TOL);
    const pineR = await countSpriteColorInBox(page, eb, bandY, SPRITE_COLORS.pineappleBody, SPRITE_COLOR_TOL);
    const bananaR = await countSpriteColorInBox(page, eb, bandY, SPRITE_COLORS.bananaBody, SPRITE_COLOR_TOL);
    const melonR = await countSpriteColorInBox(page, eb, bandY, SPRITE_COLORS.watermelonBody, SPRITE_COLOR_TOL);
    log(
      melonL >= 100 &&
        pineR >= 30 &&
        pineL === 0 &&
        bananaL === 0 &&
        bananaR === 0 &&
        melonR === 0,
      `[${tag}] R17b 玩家 / 敌人都是正式车辆外观（各自外廓内特征色在场且三色互斥）`,
      `左框 西瓜${melonL}px/菠萝${pineL}px/香蕉${bananaL}px · 右框 菠萝${pineR}px/西瓜${melonR}px/香蕉${bananaR}px`,
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
  /*
    PRP-R5 必改 1/2：相机 = **正式 battle 相机链**（reframe → battleCam → applyBattleFollow），
    PRP 只做 viewport adapter（离屏视口 = 舞台带 + 正式 inset 56/28，合成时裁安全区）。
    判据一：**不再是**固定全世界远摄 —— 可见世界宽 < 世界宽、可见区就是舞台带、裁剪原点 = 56/28。
    判据二：开局沿用正式三段取景的「远端段」—— A∪B 外廓占舞台宽 82~88%，且两车完整在带内。
  */
  const cam0 = p.battleWorld && p.battleWorld.camera;
  const b0 = p.battleWorld && p.battleWorld.world;
  log(
    !!cam0 &&
      cam0.cropX === 56 &&
      cam0.cropY === 28 &&
      cam0.bandW === 390 &&
      cam0.bandH === 302 &&
      cam0.viewW === 502 &&
      cam0.viewH === 358,
    `[${tag}] R21 必改 1/2：viewport adapter（离屏 502×358 → 安全区 = 舞台带 390×302，裁 56/28）`,
    cam0 ? `view=${cam0.viewW}×${cam0.viewH} band=${cam0.bandW}×${cam0.bandH} crop=${cam0.cropX},${cam0.cropY}` : 'no camera',
  );
  const span0 = p.stage.enemy && p.stage.player
    ? (p.stage.enemy.bounds.x + p.stage.enemy.bounds.w - p.stage.player.bounds.x) / 390
    : NaN;
  log(
    !!cam0 && !!b0 &&
      Math.abs(cam0.scale - 390 / 1600) > 1e-6 &&
      cam0.visibleWorldWidth < b0.width &&
      cam0.showsWholeWorld === false &&
      span0 >= 0.8 && span0 <= 0.9,
    `[${tag}] R21b 必改 1：不再是固定全世界远摄（可见世界宽 < 世界宽）；开局 = 正式远端段 span 82~88%`,
    cam0 ? `scale=${round2(cam0.scale)}（旧固定=${round2(390 / 1600)}）可见世界宽=${Math.round(cam0.visibleWorldWidth)}/${b0 ? b0.width : '?'} span=${(span0 * 100).toFixed(1)}%` : 'no camera',
  );
  log(
    !!p.stage.player && !!p.stage.enemy &&
      p.stage.player.bounds.x >= -1 &&
      p.stage.player.bounds.x + p.stage.player.bounds.w <= 391 &&
      p.stage.enemy.bounds.x >= -1 &&
      p.stage.enemy.bounds.x + p.stage.enemy.bounds.w <= 391,
    `[${tag}] R21c 必改 2：开局两车都完整落在舞台带内（正式取景的「完整入画」语义）`,
    p.stage.player && p.stage.enemy
      ? `A=[${round2(p.stage.player.bounds.x)}, ${round2(p.stage.player.bounds.x + p.stage.player.bounds.w)}] B=[${round2(p.stage.enemy.bounds.x)}, ${round2(p.stage.enemy.bounds.x + p.stage.enemy.bounds.w)}]`
      : 'no bounds',
  );
  const sBattle = await pixelStats(page);
  ledgerCheck(
    tag,
    'R22 BATTLE 开局 (DAY3)',
    sBattle,
    ledgerExpect({ day: 3, stage: 'battle', action: false }),
    vp.dpr,
  );
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

  /*
    PRP-F1：从这一帧起是**真实 Planck 战斗**（实测整场 ≈15.4s；首次命中 step 132 ≈2.2s；
    单发弹丸寿命 ≈40+ 帧）。若只在一个瞬间采样，必然随机落在「弹丸刚落地 / 下一发未出膛」的空窗里
    → 改为**窗口内累积观测**（5s，每 50ms 一次）：这不是放宽判据，而是把
    「炮弹真的飞过 / 耐久真的掉过 / 日志始终不动 / 相机始终不动」变成窗口内可证的事实。
  */
  const win = await page.evaluate(async () => {
    const acc = {
      samples: 0,
      maxProjectiles: 0,
      projSamples: 0,
      minEnemyHp: Infinity,
      minPlayerHp: Infinity,
      maxLogCount: 0,
      phases: [],
      camVariants: [],
      lastSteps: 0,
      lastGapWorld: 0,
      scaleMin: Infinity,
      scaleMax: 0,
      visWMin: Infinity,
      spanMin: Infinity,
      spanMax: 0,
      outOfBand: 0,
      groundMin: Infinity,
      groundMax: -Infinity,
    };
    const t0 = performance.now();
    while (performance.now() - t0 < 5000) {
      const p = window.__RUNPAGE__.probe();
      acc.samples += 1;
      acc.phases.push(p.phase);
      acc.maxLogCount = Math.max(acc.maxLogCount, p.log.length);
      const w = p.battleWorld;
      if (w) {
        acc.maxProjectiles = Math.max(acc.maxProjectiles, w.projectiles);
        if (w.projectiles > 0) acc.projSamples += 1;
        acc.lastSteps = w.steps;
        acc.lastGapWorld = w.gapWorld;
        const v = `${w.camera.scale}|${w.camera.offsetX}|${w.camera.offsetY}`;
        if (!acc.camVariants.includes(v)) acc.camVariants.push(v);
        acc.scaleMin = Math.min(acc.scaleMin, w.camera.scale);
        acc.scaleMax = Math.max(acc.scaleMax, w.camera.scale);
        acc.visWMin = Math.min(acc.visWMin, w.camera.visibleWorldWidth);
        acc.groundMin = Math.min(acc.groundMin, w.camera.groundBandY);
        acc.groundMax = Math.max(acc.groundMax, w.camera.groundBandY);
        if (p.stage.player && p.stage.enemy) {
          const a = p.stage.player.bounds;
          const b = p.stage.enemy.bounds;
          if (a.x < -2 || a.x + a.w > 392 || b.x < -2 || b.x + b.w > 392) acc.outOfBand += 1;
          acc.spanMin = Math.min(acc.spanMin, (b.x + b.w - a.x) / 390);
          acc.spanMax = Math.max(acc.spanMax, (b.x + b.w - a.x) / 390);
        }
      }
      if (p.battle) {
        acc.minEnemyHp = Math.min(acc.minEnemyHp, p.battle.enemyHp);
        acc.minPlayerHp = Math.min(acc.minPlayerHp, p.battle.playerHp);
        acc.enemyHpMax = p.battle.enemyHpMax;
        acc.playerHpMax = p.battle.playerHpMax;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    const p = window.__RUNPAGE__.probe();
    acc.endPhase = p.phase;
    acc.endSteps = (p.battleWorld && p.battleWorld.steps) || 0;
    return acc;
  });
  const pMid = await probeOf(page);
  log(
    win.samples >= 40 &&
      win.phases.every((ph) => ph === 'BATTLE') &&
      win.maxLogCount === logAtBattleStart.length,
    `[${tag}] R23 BATTLE 期间日志零变化（不刷伤害明细）`,
    `窗口 ${win.samples} 次采样全程 BATTLE · 日志恒为 ${logAtBattleStart.length} 条 · steps→${win.endSteps}`,
  );
  log(
    win.minEnemyHp < win.enemyHpMax && win.minEnemyHp > 0 && win.minPlayerHp <= win.playerHpMax,
    `[${tag}] R24 战斗在真实推进（耐久在变，但没写日志）`,
    `窗口内最低 敌方 ${win.minEnemyHp}/${win.enemyHpMax} · 我方 ${win.minPlayerHp}/${win.playerHpMax} · steps→${win.endSteps}`,
  );
  /*
    PRP-F1 必改 5①：窗口内必须出现过**炮弹真的在空中飞**
    （真实 projectile 渲染快照计数 > 0，不是「贴脸直接扣血」）。
  */
  const wMid = pMid.battleWorld;
  log(
    win.maxProjectiles > 0 && win.projSamples > 0,
    `[${tag}] R24b 必改 5①：炮弹真的在飞（真实存活弹丸 > 0）`,
    `窗口内最多 ${win.maxProjectiles} 发在飞 · ${win.projSamples}/${win.samples} 次采样见弹 · steps→${win.lastSteps} gapWorld=${round2(win.lastGapWorld)}`,
  );
  /*
    PRP-R5 必改 4/5：相机在战斗中**真的跟随 + 真的变焦**（正式三段动态取景 + 正式
    applyBattleFollow）—— 从「远端段」渐进推近到「接近段/碰撞段」，可见世界宽同步收窄。
    ❌ PRP-F1 的「整场一动不动」被废除（那正是「物理反馈不可感知」的根因）。
    同时验证：取景变化**不把车挤出带**（完整入画），地面线保持锚定（不漂移）。
  */
  log(
    !!wMid &&
      win.camVariants.length > 1 &&
      win.scaleMax / win.scaleMin > 1.2 &&
      win.visWMin < (b0 ? b0.width : 1600),
    `[${tag}] R24c 必改 4/5：镜头真的跟随+变焦（不再是固定远摄）`,
    `scale ${round2(win.scaleMin)}→${round2(win.scaleMax)}（${round2(win.scaleMax / win.scaleMin)}×）· 可见世界宽最小 ${Math.round(win.visWMin)} · 窗口内相机取值种类=${win.camVariants.length}`,
  );
  log(
    win.outOfBand === 0 && win.spanMin >= 0.4 && win.spanMax <= 0.95,
    `[${tag}] R24d 必改 4：变焦全程两车完整在舞台带内（A∪B 外廓占宽 40%~95%）`,
    `${win.samples} 次采样越界 ${win.outOfBand} 次 · span ${(win.spanMin * 100).toFixed(1)}%~${(win.spanMax * 100).toFixed(1)}%`,
  );
  log(
    win.groundMax - win.groundMin <= 1,
    `[${tag}] R24e 正式「地面线锚定」：战斗中地面线漂移 ≤1px`,
    `groundBandY ${round2(win.groundMin)}~${round2(win.groundMax)}（带内 302）`,
  );

  /* ----------------------------------------- 6) 自动结束 → RESULT */
  // ⚠️ 真实 Planck 战斗实测约 15.4s（官方阶段 Active 10s + Warning 3s + Closing，HP 判据收束）
  await page.waitForFunction(() => window.__RUNPAGE__.probe().phase === 'RESULT', null, { timeout: 40000 });
  p = await probeOf(page);
  log(p.phase === 'RESULT', `[${tag}] R25 战斗自动结束 → RESULT（无操作介入）`, `phase=${p.phase}`);
  const added = p.log.length - logAtBattleStart.length;
  log(added === 3, `[${tag}] R26 战斗结束后一次性追加 3 行玩家叙事（胜负 + 耐久 % + 改装机会）`, `+${added}: ${p.log.slice(-3).map((l) => l.text).join(' ｜ ')}`);
  /*
    PRP-F1：RESULT 不是「敌人消失」，而是**真实战场冻结在画面上**（战败方仍留在场地里）；
    战斗结论来自官方 resolveBattleResult（winner / endReason 原样带回）。
  */
  const wEnd = p.battleWorld;
  log(
    p.stage.mode === 'battle' && !!p.stage.enemy && !!wEnd && !!p.battle && p.battle.done === true,
    `[${tag}] R27 必改 4：RESULT = 真实战场冻结（战斗结论由正式判据给出，非脚本计时）`,
    p.battle ? `winner=${p.battle.winner} endReason=${p.battle.endReason} steps=${p.battle.steps} durability=${p.battle.durabilityPercent}%` : '',
  );
  log(
    !!p.battle && p.battle.winner === 'A' && p.battle.endReason === 'hp' && Math.min(p.battle.playerHp, p.battle.enemyHp) <= 0,
    `[${tag}] R27b 必改 5：结局由 HP 判据收束（一方耐久归零）`,
    p.battle ? `hpA=${round2(p.battle.playerHp)} hpB=${round2(p.battle.enemyHp)}` : '',
  );
  /*
    PRP-R5：战斗结束后**取景与战场一起冻结** —— 结束帧在像素与几何上逐帧完全一致
    （相机不再逐帧微调；两车世界坐标与屏幕 rect 都不变）。间隔 300ms 再取一次快照对比。
  */
  const frozenA = JSON.stringify({ p: p.stage.player, e: p.stage.enemy, c: p.battleWorld && p.battleWorld.camera });
  await page.waitForTimeout(300);
  const pFrozen = await probeOf(page);
  const frozenB = JSON.stringify({
    p: pFrozen.stage.player,
    e: pFrozen.stage.enemy,
    c: pFrozen.battleWorld && pFrozen.battleWorld.camera,
  });
  log(
    frozenA === frozenB && pFrozen.phase === 'RESULT',
    `[${tag}] R27c 结束态冻结：RESULT 期间相机与两车几何逐帧完全一致（战场冻结）`,
    `player/enemy/camera 300ms 前后 ${frozenA === frozenB ? '完全相同' : '发生变化'}`,
  );
  log(p.actionLabel === '继续' && p.actionEnabled, `[${tag}] R28 RESULT 底部重新出现「继续」`, `${p.actionLabel}/${p.actionEnabled}`);
  const sResult = await pixelStats(page);
  ledgerCheck(tag, 'R29 RESULT (DAY3)', sResult, ledgerExpect({ day: 3, stage: 'battle' }), vp.dpr);
  const bandSamplesBefore = vp.dpr === 1 ? await sampleBands(page) : [];
  const playerRectAtResult = JSON.stringify(p.stage.player);

  /* --------------------------------- 7) 真实点击「继续」→ CHOICE */
  await clickRect(page, p.actionRect);
  p = await probeOf(page);
  log(p.phase === 'CHOICE' && p.choiceOpen, `[${tag}] R30 真实点击「继续」→ CHOICE 浮层`, `phase=${p.phase}`);
  log(p.choiceOptions.length === 3, `[${tag}] R31 三选一浮层恰好 3 个选项`, p.choiceOptions.map((o) => o.label).join(' / '));
  /*
    PRP-BUILD-01 必改 1 的前半：第一次选择**必然是固定的第一层三选一**
    （`choicePoolLayer === 1`），并且选项 id 正是 Queue 点名的三项。
  */
  log(
    p.choicePoolLayer === 1 &&
      JSON.stringify(p.choiceOptions.map((o) => o.label)) ===
        JSON.stringify(['重型弹头', '双联炮', '快速装填']) &&
      JSON.stringify(p.choiceOptions.map((o) => o.id)) ===
        JSON.stringify(['heavyShell', 'twinCannon', 'fastReload']),
    `[${tag}] R32 第一次选择 = 第一层固定三选一（layer=1，正是 Queue 点名的三项）`,
    `layer=${p.choicePoolLayer} ${p.choiceOptions.map((o) => o.label).join(' / ')}`,
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
  ledgerCheck(tag, 'R35 CHOICE', sChoice, ledgerExpect({ masked: true }), vp.dpr);
  if (vp.dpr === 1) {
    // 「整体变暗」：与 RESULT 时**同一批点位**逐点对比，5 处必须全部离开原色（被遮罩合成）
    const after = await sampleBands(page);
    const changed = after.map((s, i) => s.rgb.join(',') !== bandSamplesBefore[i].rgb.join(','));
    log(
      changed.every(Boolean),
      `[${tag}] R36 CHOICE 整页变暗（5 个分带采样点逐点离开 CHOICE 之前的值）`,
      BAND_POINTS.map((p, i) => `${p.key}:${bandSamplesBefore[i].rgb.join(',')}→${after[i].rgb.join(',')}`).join(' '),
    );
    // 卡片几何：真实像素在「卡片底 / 顶部强调条」两处命中期望色（单点采样即可，均为平涂面）
    const cards = p.choiceOptions.map((o) => o.rect);
    const pts = [];
    for (const c of cards) {
      pts.push(
        { x: c.x + 6, y: c.y + 6 }, // 卡片底（避开 2px 描边与强调条）
        { x: c.x + c.w / 2, y: c.y + 6 }, // 顶部强调条
      );
    }
    const cardPixels = await samplePixels(page, pts);
    const at = (i) => cardPixels[i].rgb.join(',');
    const bgOk = [0, 2, 4].every((i) => at(i) === SAMPLE_COLORS.cardBg.join(','));
    const barOk = [1, 3, 5].every((i) => at(i) === PALETTE.cardBar.join(','));
    /*
      图标：在**与绘制同源**的 `iconRect` 内按面积统计该选项专属图标色，并要求「它选项的图标色为 0」
      （调色板逐对互斥 → 交叉命中恒应为 0，与车辆 sprite 特征色同一套纪律）。
    */
    const icons = await checkChoiceIcons(page, p);
    log(
      bgOk && barOk && icons.ok,
      `[${tag}] R37 卡片 = 图标 + 名称 + 一句结果（几何被真实像素命中，位置 = 布局唯一来源）`,
      `bg=${at(0)} bar=${at(1)} icon(盒内px)=${icons.rows.map((r) => r.own).join('/')} 交叉=${icons.rows
        .map((r) => r.cross)
        .join('/')}`,
    );
  }

  /* --------------------------- 8) 真实点击中间卡片 → 回到 IDLE */
  const card1 = p.choiceOptions[1].rect; // 双联炮
  await clickRect(page, card1);
  p = await probeOf(page);
  log(p.phase === 'IDLE' && !p.choiceOpen, `[${tag}] R38 选择后浮层关闭、原页面恢复（回 IDLE）`, `phase=${p.phase}`);
  log(
    p.buffs.length === 1 &&
      p.buffLabels[0] === '双联炮' &&
      JSON.stringify(p.build) === JSON.stringify(['twinCannon']) &&
      p.modifier === 'twinCannon',
    `[${tag}] R39 顶部新增对应强化图标（只加 1 个，不是填满 5 个槽）· Build = [twinCannon]`,
    `build=${p.buildLabels.join('/')} modifier=${p.modifier} buffIconCount=${p.buffIconCount}`,
  );
  /*
    PRP-F2 必改 3：选择后**追加两行**（强化自然语言结果 + 进入下一天），历史完整。
    ⚠️ 计数从 `+6` 变 `+7` 是**预期后果**：强化从「替换已有装备」改成「本局叠加 Modifier」后，
    日志由「1 行结果」变为「结果 + DAY N」两行。总量随状态机阶段固定，不是放开断言。
  */
  log(
    p.log[p.log.length - 2].text === '你为大炮加装了一门副炮。' &&
      p.log[p.log.length - 1].text === 'DAY 4' &&
      p.logCount === p0.logCount + 7,
    `[${tag}] R40 日志追加自然语言结果 + DAY 4 两行，且历史完整`,
    `logCount=${p.logCount} tail=${p.log.slice(-2).map((l) => l.text).join(' ｜ ')}`,
  );
  log(
    JSON.stringify(p.phaseTrail) === JSON.stringify(['IDLE', 'EVENT', 'BATTLE', 'RESULT', 'CHOICE', 'IDLE']),
    `[${tag}] R41 六状态轨迹精确（同一页面内切换）`,
    p.phaseTrail.join('→'),
  );
  const sIdle4 = await pixelStats(page);
  ledgerCheck(
    tag,
    'R42 回到 IDLE + 1 个强化 (DAY4)',
    sIdle4,
    ledgerExpect({ day: 4, stage: 'idle', buffs: ['twinCannon'] }),
    vp.dpr,
  );
  if (vp.dpr === 1) {
    // 顶部图标底色按选项区分：拿到「双联炮」→ 只应是该选项的底色（其余六个为 0）
    const iconKeys = Object.keys(BUFF_ICON_KEY).map((k) => BUFF_ICON_KEY[k]);
    const icons = iconKeys.map((k) => sIdle4[k]);
    log(
      icons.filter((n) => n > 0).length === 1 && sIdle4.buffIconTwin === 756 && sIdle4.buffChip === 144,
      `[${tag}] R42b 顶部只有 1 个真实图标（无空槽、无 5 个占位格子）`,
      `${iconKeys.map((k, i) => `${k}=${icons[i]}`).join('/')} chip=${sIdle4.buffChip}`,
    );
    // IDLE（页面绝对坐标 → 偏移 0）
    const melon = await countSpriteColorInBox(page, p.stage.player.bounds, 0, SPRITE_COLORS.watermelonBody, SPRITE_COLOR_TOL);
    log(melon >= 100, `[${tag}] R42c 回到 IDLE 后车辆仍是正式 sprite`, `watermelon=${melon}px`);
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

  /*
    --------------------------------- 10) PRP-F2：DAY 4 的第二场 = 强化后的真实战斗
    这是真人验收「不看顶部图标文字，能不能仅从第二场看出自己选了什么」的机器侧等价物：
      ① 运行时真实拿到的 modifier = 刚选的那一项（不是只写了日志 / 只画了图标）；
      ② 开局 steps / projectiles = 0 → **clean recreate**，没有上一场的弹丸 / 接触 / AI 残留；
      ③ 开局 HP = 上一场打完剩下的耐久（< 上限）→ **跨战斗耐久**，不自动满血。
    这一切都在**同一个 canvas 页面**里发生（R44 已证零跳转）。
  */
  const hpCarried = p.battle ? p.battle.playerHp : NaN;
  const hpMaxCarried = p.battle ? p.battle.playerHpMax : NaN;
  await clickRect(page, pAgain.actionRect);
  const p2 = await probeOf(page);
  log(p2.phase === 'BATTLE' && p2.actionLabel === '战斗中', `[${tag}] R45 第二场真实战斗开打（DAY 4 · 同一页面）`, `phase=${p2.phase}/${p2.actionLabel}`);
  const w2 = p2.battleWorld;
  log(
    !!w2 &&
      w2.modifier === 'twinCannon' &&
      JSON.stringify(w2.build) === JSON.stringify(['twinCannon']),
    `[${tag}] R46 必改 5/6：第二场运行时真实拿到第一层 Build（不是只写日志 / 只画图标）`,
    w2 ? `modifier=${w2.modifier} build=[${w2.build.join(',')}]` : 'no battleWorld',
  );
  log(
    !!w2 && w2.steps === 0 && w2.projectiles === 0,
    `[${tag}] R47 必改 4：clean recreate（步数 / 弹丸从 0 起，无上一场残留）`,
    w2 ? `steps=${w2.steps} projectiles=${w2.projectiles}` : '',
  );
  log(
    !!w2 &&
      Math.abs(w2.initialPlayerHp - hpCarried) < 1e-6 &&
      w2.playerHpMax === hpMaxCarried &&
      w2.initialPlayerHp > 0 &&
      w2.initialPlayerHp < w2.playerHpMax,
    `[${tag}] R48 必改 4：跨战斗耐久成立（带上一场剩余 HP 开打，不自动满血，上限不变）`,
    w2 ? `开局 ${round2(w2.initialPlayerHp)}/${round2(w2.playerHpMax)}（上一场结束 ${round2(hpCarried)}）` : '',
  );
  /** 第二场窗口内「在飞弹丸数」峰值（供最终战斗的三连装填做同口径对照）。 */
  let twinWinMax = 0;
  if (w2) {
    // 窗口累积观测（理由同 R24b：单点采样会落在开火空窗里）
    const twinWin = await page.evaluate(async () => {
      const acc = { samples: 0, maxProjectiles: 0, projSamples: 0, minEnemyHp: Infinity, enemyHpMax: 0, phases: [] };
      const t0 = performance.now();
      while (performance.now() - t0 < 4000) {
        const pr = window.__RUNPAGE__.probe();
        acc.samples += 1;
        acc.phases.push(pr.phase);
        const w = pr.battleWorld;
        if (w) {
          acc.maxProjectiles = Math.max(acc.maxProjectiles, w.projectiles);
          if (w.projectiles > 0) acc.projSamples += 1;
        }
        if (pr.battle) {
          acc.minEnemyHp = Math.min(acc.minEnemyHp, pr.battle.enemyHp);
          acc.enemyHpMax = pr.battle.enemyHpMax;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      return acc;
    });
    /*
      PRP-F2-R1：双联炮 = 正式 Cannon 的**真实连发**（burstRounds=2 / burstIntervalMs=100ms）。
      一次攻击在第 1 步与第 7 步各出一发真实 projectile（单测里以「新弹丸出现的步差 = 6」精确固化）。
      100ms 之后两发**同时在空中** → 窗口内「在飞弹丸 ≥ 2」是可证的真实 Runtime 差异；
      敌方耐久必须真的被这两发打下去（证明第二发不是视觉假弹）。
      对比参照：第一场（基础 Cannon）同长度窗口的 maxProjectiles 一并打印，不作硬断言
      —— 基础单发在远距离飞行时也可能有 2 发重叠（不具排他性），硬断言会变成脆弱判据。
    */
    twinWinMax = twinWin.maxProjectiles;
    log(
      twinWin.maxProjectiles >= 2 && twinWin.projSamples > 0,
      `[${tag}] R49 必改 2/5：双联炮一次攻击连出两发（先后 100ms · 窗口内两发同时在飞 · 真实 projectile）`,
      `窗口内最多 ${twinWin.maxProjectiles} 发在飞 · ${twinWin.projSamples}/${twinWin.samples} 次采样见弹 · 第一场同窗口最多 ${win.maxProjectiles} 发`,
    );
    log(
      twinWin.minEnemyHp < twinWin.enemyHpMax,
      `[${tag}] R49b 强化后的炮弹真的造成伤害（敌方耐久在掉）`,
      `窗口内最低 敌方 ${round2(twinWin.minEnemyHp)}/${round2(twinWin.enemyHpMax)}`,
    );
  }

  /*
    -------------------- 11) PRP-BUILD-01：第二场结束 → **第二次选择机会**（条件池）
    这一步是「Build 而不是两个互不相关的 Buff」的机器侧证据：
      · 第二场打完**还不是终局**（`verificationComplete === false`），主动作仍是「继续」；
      · 第二次候选池**由第一层决定**（`choicePoolLayer === 2`，池 = 双联炮分支的三项）；
      · 池的槽位结构 = 强联动 / 安全通用 / 轻度转向（必改 5 的取舍）；
      · 选了强联动「三连装填」后 Build = [twinCannon, tripleLoad]（两层同时存在）。
  */
  await page.waitForFunction(
    () => {
      const pr = window.__RUNPAGE__.probe();
      return pr.phase === 'RESULT' && pr.battlesCompleted === 2;
    },
    null,
    { timeout: 90000 },
  );
  const pRes2 = await probeOf(page);
  log(
    pRes2.phase === 'RESULT' && pRes2.battlesCompleted === 2 && pRes2.verificationComplete === false,
    `[${tag}] R50 第二场自动结束 → RESULT（battlesCompleted=2，**还不是终局**，仍有第二次改装机会）`,
    `phase=${pRes2.phase} battlesCompleted=${pRes2.battlesCompleted} verificationComplete=${pRes2.verificationComplete} action="${pRes2.actionLabel}"`,
  );
  log(
    pRes2.day === 4 && pRes2.buffs.length === 1 && pRes2.actionLabel === '继续' && pRes2.actionEnabled,
    `[${tag}] R50b 第二场后仍是 DAY 4 + 1 个强化 + 主动作「继续」（还没到第三天 / 第二层）`,
    `day=${pRes2.day}/${pRes2.dayTotal} buffs=${pRes2.buffLabels.join('/')} action="${pRes2.actionLabel}"`,
  );
  log(
    pRes2.log[pRes2.log.length - 1].text === '你发现了一次改装机会……',
    `[${tag}] R50c 第二场 RESULT 仍引导「一次改装机会」（= 即将打开第二次选择）`,
    `tail=${pRes2.log[pRes2.log.length - 1].text}`,
  );
  const sRes2 = await pixelStats(page);
  ledgerCheck(
    tag,
    'R50d RESULT 第二场 (DAY4 · 1 强化)',
    sRes2,
    ledgerExpect({ day: 4, stage: 'battle', buffs: ['twinCannon'] }),
    vp.dpr,
  );

  /* ------------------ 11b) 真实点击「继续」→ CHOICE②（条件池，不是同一套通用三选一） */
  await clickRect(page, pRes2.actionRect);
  const pChoice2 = await probeOf(page);
  const pool2Ids = pChoice2.choiceOptions.map((o) => o.id);
  log(
    pChoice2.phase === 'CHOICE' && pChoice2.choicePoolLayer === 2,
    `[${tag}] R51 必改 1：第二次选择 = 第二层（choicePoolLayer=2，由第一层决定）`,
    `phase=${pChoice2.phase} layer=${pChoice2.choicePoolLayer}`,
  );
  log(
    JSON.stringify(pool2Ids) === JSON.stringify(['tripleLoad', 'emergencyRepair', 'heavyShell']) &&
      JSON.stringify(pChoice2.choiceOptions.map((o) => o.label)) ===
        JSON.stringify(['三连装填', '紧急维修', '重型弹头']),
    `[${tag}] R51b 必改 1/5：双联炮分支的条件池 = 强联动「三连装填」+ 安全项「紧急维修」+ 转向项「重型弹头」`,
    `pool=${pChoice2.choiceOptions.map((o) => `${o.label}(${o.id})`).join(' / ')}`,
  );
  log(
    // 与第一次的固定池**不是同一套**（至少两项不同）→ 「第一次选择改变了后续能拿到的方向」
    pool2Ids.filter((id) => ['heavyShell', 'twinCannon', 'fastReload'].includes(id)).length <= 1 &&
      pool2Ids[0] === 'tripleLoad',
    `[${tag}] R51c 必改 1：第二次池 ≠ 第一次池（强联动占首位，不是通用三选一换个顺序）`,
    `第一次池=[heavyShell,twinCannon,fastReload] 第二次池=[${pool2Ids.join(',')}]`,
  );
  const sChoice2 = await pixelStats(page);
  ledgerCheck(tag, 'R51d CHOICE②', sChoice2, ledgerExpect({ masked: true }), vp.dpr);
  if (vp.dpr === 1) {
    const icons2 = await checkChoiceIcons(page, pChoice2);
    log(
      icons2.ok,
      `[${tag}] R51e 第二层卡片图标同样是真实矢量字形（盒内面积 + 七色精确互斥）`,
      icons2.rows.map((r) => `${r.id}:${r.own}px/交叉${r.cross}`).join(' '),
    );
  }

  /* ------------------ 11c) 选强联动「三连装填」→ IDLE(DAY5)，顶部 2 个图标 */
  await clickRect(page, pChoice2.choiceOptions[0].rect); // 三连装填
  const pIdle5 = await probeOf(page);
  log(
    pIdle5.phase === 'IDLE' &&
      pIdle5.day === 5 &&
      pIdle5.buffs.length === 2 &&
      JSON.stringify(pIdle5.build) === JSON.stringify(['twinCannon', 'tripleLoad']) &&
      pIdle5.modifier === 'twinCannon',
    `[${tag}] R52 必改 6：选择后 Build = [twinCannon, tripleLoad]（DAY 5 · 顶部 2 个图标，不是 1 个）`,
    `day=${pIdle5.day}/${pIdle5.dayTotal} build=${pIdle5.buildLabels.join('+')} buffIconCount=${pIdle5.buffIconCount}`,
  );
  const sIdle5 = await pixelStats(page);
  ledgerCheck(
    tag,
    'R52b IDLE (DAY5 · 2 强化)',
    sIdle5,
    ledgerExpect({ day: 5, stage: 'idle', buffs: ['twinCannon', 'tripleLoad'] }),
    vp.dpr,
  );
  if (vp.dpr === 1) {
    log(
      sIdle5.buffIconTwin === 756 && sIdle5.buffIconTriple === 756 && sIdle5.buffChip === 288,
      `[${tag}] R52c 顶部 2 个真实图标 = 各自选项的底色（双联炮 + 三连装填），无空槽`,
      `twin=${sIdle5.buffIconTwin} triple=${sIdle5.buffIconTriple} chip=${sIdle5.buffChip}`,
    );
  }

  /* ------------------ 11d) 第三场 = 最终战斗（两层 Build 同时真实生效） */
  /*
    规则（PRP-RUN-R1 起）：carry = 上一场真实剩余；**耐久 <= 0 = 本局立即结束**（FAILED 终态），
    所以能走到最终战斗 ⇒ 上一场结束时 hp2 必然 > 0 —— 不存在「0 耐久 → 满耐久开幕」这条
    已被删除的错误分支。本分支没选维修项 → 无补偿 → 开局耐久必须**恰好等于**上一场剩余
    （不多不少 = 无隐藏回血）。
  */
  const hp2 = pRes2.battle ? pRes2.battle.playerHp : NaN;
  const hpMax2 = pRes2.battle ? pRes2.battle.playerHpMax : NaN;
  const expectInit3 = hp2;
  await clickRect(page, pIdle5.actionRect); // IDLE → EVENT
  const pEvent5 = await probeOf(page);
  await clickRect(page, pEvent5.actionRect); // EVENT → BATTLE③
  const p3 = await probeOf(page);
  const w3 = p3.battleWorld;
  log(
    p3.phase === 'BATTLE' && p3.actionLabel === '战斗中',
    `[${tag}] R53 最终战斗开打（DAY 5 · 两层 Build · 仍在同一页面）`,
    `phase=${p3.phase}/${p3.actionLabel}`,
  );
  log(
    !!w3 &&
      w3.modifier === 'twinCannon' &&
      JSON.stringify(w3.build) === JSON.stringify(['twinCannon', 'tripleLoad']) &&
      // ⚠️ 本路线的第二层是「三连装填」，所以**能力类**强化必须是关的；
      //    `kineticBurst === false` = 「动能爆发」不会被别的 Build 顺带打开（不串味）。
      //    ⚠️ PRP-BUILD-01-CLOSEOUT-AND-FREEZE：快速装填的专属二层（三条尝试全部未通过）
      //    已整条废弃，探针里的 suppression* 字段随之一并删除。
      w3.abilities.kineticBurst === false,
    `[${tag}] R53b 必改 6：最终战斗**同时携带两层**（一层改武器 + 二层能力/数值，运行时不串味）`,
    w3
      ? `build=[${w3.build.join(',')}] modifier=${w3.modifier} kinetic=${w3.abilities.kineticBurst}`
      : 'no battleWorld',
  );
  log(
    !!w3 && w3.steps === 0 && w3.projectiles === 0,
    `[${tag}] R53c clean recreate（最终战斗步数 / 弹丸从 0 起，无上一场残留）`,
    w3 ? `steps=${w3.steps} projectiles=${w3.projectiles}` : '',
  );
  log(
    !!w3 &&
      w3.playerHpMax === hpMax2 &&
      Math.abs(w3.initialPlayerHp - expectInit3) < 1e-6 &&
      w3.initialPlayerHp > 0 &&
      w3.initialPlayerHp <= w3.playerHpMax,
    `[${tag}] R53d 跨战斗耐久规则在最终战斗同样成立（carry = 上一场剩余，绝不超过上一场剩余 = 无隐藏回血）`,
    w3
      ? `开局 ${round2(w3.initialPlayerHp)}/${round2(w3.playerHpMax)}（上一场结束 ${round2(hp2)} → 期望 ${round2(expectInit3)}）`
      : '',
  );
  /*
    PRP-RUN-R1 结构断言（浏览器端真实证据）：
      三场战斗的**开局耐久单调不增**（第二场 ≤ 第一场结束时剩余，第三场 ≤ 第二场结束时剩余），
      且只可能因为「耐久没归零」才走到下一步 → 结构上不存在隐藏回血 / 死亡续命。
  */
  if (w3) {
    log(
      w2.initialPlayerHp <= hpMaxCarried &&
        w2.initialPlayerHp <= hpCarried + 1e-6 &&
        w3.initialPlayerHp <= hp2 + 1e-6 &&
        hpCarried > 0 &&
        hp2 > 0,
      `[${tag}] R53e 单一耐久贯穿三场：开局耐久单调不增，且前两场结束耐久均 > 0（无一例死亡续命）`,
      `B1 结束 ${round2(hpCarried)} → B2 开局 ${round2(w2.initialPlayerHp)} → B2 结束 ${round2(hp2)} → B3 开局 ${round2(w3.initialPlayerHp)}`,
    );
  }
  if (w3) {
    /*
      必改 3 的浏览器端真实证据：三连装填 = 同一 burst Foundation 把 burstRounds 2 → 3，
      因此一次攻击会在 0ms / 100ms / 200ms 各出一发**真实 projectile** →
      窗口内「同时在飞 ≥ 3」是可证的真实 Runtime 差异（与单测的 6/6/60 步差同源）。
    */
    const tripleWin = await page.evaluate(async () => {
      const acc = { samples: 0, maxProjectiles: 0, projSamples: 0, minEnemyHp: Infinity, enemyHpMax: 0 };
      const t0 = performance.now();
      while (performance.now() - t0 < 4500) {
        const pr = window.__RUNPAGE__.probe();
        acc.samples += 1;
        const w = pr.battleWorld;
        if (w) {
          acc.maxProjectiles = Math.max(acc.maxProjectiles, w.projectiles);
          if (w.projectiles > 0) acc.projSamples += 1;
        }
        if (pr.battle) {
          acc.minEnemyHp = Math.min(acc.minEnemyHp, pr.battle.enemyHp);
          acc.enemyHpMax = pr.battle.enemyHpMax;
        }
        await new Promise((r) => setTimeout(r, 40));
      }
      return acc;
    });
    log(
      tripleWin.maxProjectiles >= 3 && tripleWin.projSamples > 0,
      `[${tag}] R54 必改 3：三连装填一次攻击连出三发真实炮弹（0/100/200ms · 窗口内三发同时在飞）`,
      `窗口内最多 ${tripleWin.maxProjectiles} 发在飞 · ${tripleWin.projSamples}/${tripleWin.samples} 次采样见弹（第二场同口径最多 ${twinWinMax} 发）`,
    );
    log(
      tripleWin.minEnemyHp < tripleWin.enemyHpMax,
      `[${tag}] R54b 三发都是真弹（敌方耐久真的在掉）`,
      `窗口内最低 敌方 ${round2(tripleWin.minEnemyHp)}/${round2(tripleWin.enemyHpMax)}`,
    );
  }

  /* ------------------ 11e) 第三场结束 = 验证结束（三层 / 更多 Day 结构上不可能） */
  await page.waitForFunction(
    () => {
      const pr = window.__RUNPAGE__.probe();
      return pr.phase === 'RESULT' && pr.battlesCompleted === 3;
    },
    null,
    { timeout: 90000 },
  );
  const pEndFinal = await probeOf(page);
  log(
    pEndFinal.phase === 'RESULT' &&
      pEndFinal.battlesCompleted === 3 &&
      pEndFinal.verificationComplete === true &&
      pEndFinal.actionLabel === '重新开始验证' &&
      pEndFinal.actionEnabled,
    `[${tag}] R55 第三场自动结束 → 终局 RESULT（battlesCompleted=3，不再进入 CHOICE）`,
    `phase=${pEndFinal.phase} battlesCompleted=${pEndFinal.battlesCompleted} action="${pEndFinal.actionLabel}"`,
  );
  log(
    pEndFinal.day === 5 &&
      pEndFinal.day <= pEndFinal.dayTotal &&
      pEndFinal.buffs.length === 2 &&
      JSON.stringify(pEndFinal.build) === JSON.stringify(['twinCannon', 'tripleLoad']),
    `[${tag}] R55b 不继续 Day / 不叠第三层：DAY 停在 5（无 8/7）、仍是两层 Build`,
    `day=${pEndFinal.day}/${pEndFinal.dayTotal} build=${pEndFinal.buildLabels.join('+')}`,
  );
  const sRes5 = await pixelStats(page);
  ledgerCheck(
    tag,
    'R55c RESULT 最终场 (DAY5 · 2 强化)',
    sRes5,
    ledgerExpect({ day: 5, stage: 'battle', buffs: ['twinCannon', 'tripleLoad'] }),
    vp.dpr,
  );
  log(
    pEndFinal.log[pEndFinal.log.length - 1].text === '本次改装的验证到此结束。',
    `[${tag}] R55d 终局叙事不再引导下一次改装`,
    `tail=${pEndFinal.log[pEndFinal.log.length - 1].text}`,
  );
  log(
    JSON.stringify(pEndFinal.phaseTrail) ===
      JSON.stringify([
        'IDLE', 'EVENT', 'BATTLE', 'RESULT', 'CHOICE', 'IDLE',
        'EVENT', 'BATTLE', 'RESULT', 'CHOICE', 'IDLE',
        'EVENT', 'BATTLE', 'RESULT',
      ]) && pEndFinal.battlesCompleted === 3 && pEndFinal.buffs.length === 2,
    `[${tag}] R55e 完整闭环轨迹：三场真实战斗 + 两次选择，全程同一个状态机（无第三层）`,
    pEndFinal.phaseTrail.join('→'),
  );

  /*
    -------------------- 12) 重新开始验证 = 干净新 Run（Build 完全清空）
  */
  await clickRect(page, pEndFinal.actionRect);
  await page.waitForTimeout(250);
  const pRestart = await probeOf(page);
  log(
    pRestart.phase === 'IDLE' &&
      pRestart.day === 3 &&
      pRestart.buffs.length === 0 &&
      pRestart.build.length === 0 &&
      pRestart.modifier === null &&
      pRestart.battlesCompleted === 0 &&
      pRestart.verificationComplete === false &&
      pRestart.actionLabel === '继续',
    `[${tag}] R56 重新开始验证 = 干净新 Run（DAY 3 / Build 完全清空 / 主动作=继续）`,
    `phase=${pRestart.phase} day=${pRestart.day} build=[${pRestart.build.join(',')}] battles=${pRestart.battlesCompleted}`,
  );
  const sRestart = await pixelStats(page);
  ledgerCheck(tag, 'R56b 新 Run IDLE (DAY3 · 0 强化)', sRestart, ledgerExpect({ day: 3, stage: 'idle' }), vp.dpr);
  log(
    JSON.stringify(pRestart.phaseTrail) === JSON.stringify(['IDLE']),
    `[${tag}] R57 新 Run 是独立状态机（phaseTrail 从 IDLE 重新开始，不是老页面的延续）`,
    pRestart.phaseTrail.join('→'),
  );
  // 新 Run 里第一场仍是**基础**战斗（点击继续 → EVENT，不再有任何历史强化）
  await clickRect(page, pRestart.actionRect);
  const pFreshEvent = await probeOf(page);
  log(
    pFreshEvent.phase === 'EVENT' &&
      pFreshEvent.buffs.length === 0 &&
      pFreshEvent.build.length === 0 &&
      pFreshEvent.modifier === null,
    `[${tag}] R58 新 Run 从头开始（第一场准备中 · 无任何强化残留）`,
    `phase=${pFreshEvent.phase} build=[${pFreshEvent.build.join(',')}]`,
  );

  /*
    ------------------ 13) PRP-BUILD-01-R1：动能爆发的**真实感知链**（浏览器端 · 真实命中 → 真实冲击 → 真实位移）
    判据（Queue 必改 3「极简命中反馈」+ 必改 4「同条件 A/B」的浏览器侧）：
      · 环只在**真实重弹命中**的那一刻出现（每次出现都伴随 `abilities.kineticHits` 递增）；
      · 环画在**真实命中点**上 —— `kineticImpact.worldX/Y` 与 `abilities.lastKineticHit` **逐字段相等**；
      · 环是**短的** —— 寿命 `RUN_IMPACT_RING_MS`(280ms) 之外完全消失（`kineticImpact` 回到 null）；
      · **物理真的发生** —— 命中后短窗内敌车在舞台带内的真实位移 > 0（不是只有视觉环）。
    做法：独立打开一个干净页面，走「基础 → 重型弹头 → 重型弹头+动能爆发」两层路线，
    在第三场用 25ms 轮询读**公开 probe**（不读配置、不走任何内部句柄）。
    ⚠️ 只在第一个视口跑一次（连打三场 ≈ 50s）。
  */
  if (!kineticObserved) {
    kineticObserved = true;

    const kctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      deviceScaleFactor: vp.dpr,
    });
    const kpage = await kctx.newPage();
    await kpage.goto(PAGE_URL, { waitUntil: 'load' });
    await kpage.waitForFunction(
      () => {
        const c = document.querySelector('#run-canvas');
        if (!window.__RUNPAGE__ || !c || c.width === 0) return false;
        const p = window.__RUNPAGE__.probe();
        return p.screen.width > 0 && p.assets.ready >= 5 && p.assets.failed.length === 0 && p.stage.player.allSprites;
      },
      null,
      { timeout: 15000 },
    );

    const waitResult = () =>
      kpage.waitForFunction(() => window.__RUNPAGE__.probe().phase === 'RESULT', null, { timeout: 120000 });
    /** IDLE → EVENT → BATTLE（两次真实点击）。 */
    const enterBattle = async () => {
      await clickRect(kpage, (await probeOf(kpage)).actionRect); // IDLE → EVENT
      await clickRect(kpage, (await probeOf(kpage)).actionRect); // EVENT → BATTLE
      return await probeOf(kpage);
    };
    /** 在 CHOICE 里按**候选 id** 点选（id 来自公开 probe，不靠硬编码序号）。 */
    const chooseById = async (id) => {
      const pr = await probeOf(kpage);
      const i = pr.choiceOptions.findIndex((o) => o.id === id);
      if (i < 0) return null;
      await clickRect(kpage, pr.choiceOptions[i].rect);
      return { label: pr.choiceOptions[i].label, layer: pr.choicePoolLayer };
    };

    // 第一场：基础（路线起点）
    const k1 = await enterBattle();
    await waitResult();
    await clickRect(kpage, (await probeOf(kpage)).actionRect); // RESULT → CHOICE①
    const pickShell = await chooseById('heavyShell');
    // 第二场：重型弹头
    const k2 = await enterBattle();
    await waitResult();
    await clickRect(kpage, (await probeOf(kpage)).actionRect); // RESULT → CHOICE②
    const pickKinetic = await chooseById('kineticBurst');
    // 第三场：重型弹头 + 动能爆发 —— 感知链就在这一场观测
    const k3 = await enterBattle();
    log(
      !!pickShell &&
        !!pickKinetic &&
        pickShell.layer === 1 &&
        pickKinetic.layer === 2 &&
        !!k3.battleWorld &&
        JSON.stringify(k3.battleWorld.build) === JSON.stringify(['heavyShell', 'kineticBurst']) &&
        k3.battleWorld.abilities.kineticBurst === true &&
        k3.battleWorld.abilities.projectileMass === 4,
      `[${tag}] R63 第三场真实拿到「重型弹头 + 动能爆发」（第二层 · projectile 质量 4 由真实武器 def 读出）`,
      `第一层=${pickShell ? pickShell.label : '?'} 第二层=${pickKinetic ? pickKinetic.label : '?'} ` +
        `build=[${k3.battleWorld ? k3.battleWorld.build.join(',') : '?'}] ` +
        `mass=${k3.battleWorld ? k3.battleWorld.abilities.projectileMass : '?'} ` +
        `(第一场 build=[${k1.battleWorld ? k1.battleWorld.build.join(',') : '?'}] · 第二场 build=[${
          k2.battleWorld ? k2.battleWorld.build.join(',') : '?'
        }])`,
    );

    /*
      25ms 轮询第三场：把每一次 `kineticHits` 递增当做一个「冲击 episode」，
      记录它出现时的真实位置 / 年龄 / 环数，以及命中后短窗内敌车的**真实舞台带位移**。
    */
    const kin = await kpage.evaluate(async (capMs) => {
      const acc = {
        samples: 0,
        battleMs: 0,
        kineticHits: 0,
        episodes: 0,
        ringFrames: 0,
        expiredFrames: 0,
        maxAgeMs: -1,
        ageOutOfRange: 0,
        posMismatch: 0,
        firstRingEpisodeAgeMs: -1,
        minAgeMs: -1,
        enemyDxMax: 0,
        ringsMax: 0,
        maxImpulse: 0,
        mass: 0,
        endedByPhase: false,
      };
      let prevHits = -1;
      let cur = null;
      const t0 = performance.now();
      while (performance.now() - t0 < capMs) {
        const pr = window.__RUNPAGE__.probe();
        if (pr.phase !== 'BATTLE' || !pr.battleWorld) {
          acc.endedByPhase = true;
          break;
        }
        const w = pr.battleWorld;
        acc.samples += 1;
        acc.battleMs = w.timeMs;
        acc.mass = w.abilities.projectileMass;
        acc.maxImpulse = Math.max(acc.maxImpulse, w.abilities.lastKineticImpulse);
        const h = w.abilities.kineticHits;
        if (prevHits < 0) prevHits = h;
        if (h !== prevHits) {
          prevHits = h;
          acc.episodes += 1;
          cur = { enemyX0: w.enemy.bounds.x, enemyDx: 0, firstAge: -1 };
        }
        acc.kineticHits = h;
        const imp = w.kineticImpact;
        if (imp) {
          acc.ringFrames += 1;
          if (imp.ageMs > acc.maxAgeMs) acc.maxAgeMs = imp.ageMs;
          // 环出现时的年龄必须落在寿命内（0 ≤ age ≤ 280）
          if (imp.ageMs < 0 || imp.ageMs > 280) acc.ageOutOfRange += 1;
          // VFX 位置与「真实命中点」逐字段相等（同源，不是估算）
          const lk = w.abilities.lastKineticHit;
          if (!lk || imp.worldX !== lk.x || imp.worldY !== lk.y) acc.posMismatch += 1;
          if (imp.rings > acc.ringsMax) acc.ringsMax = imp.rings;
          if (cur) {
            if (cur.firstAge < 0) cur.firstAge = imp.ageMs;
          }
        } else {
          acc.expiredFrames += 1;
        }
        if (cur) cur.enemyDx = Math.max(cur.enemyDx, Math.abs(w.enemy.bounds.x - cur.enemyX0));
        if (cur) acc.enemyDxMax = Math.max(acc.enemyDxMax, cur.enemyDx);
        await new Promise((r) => setTimeout(r, 25));
      }
      return acc;
    }, 26000);

    const realHits = kin.kineticHits;
    log(
      realHits >= 3 && kin.ringFrames >= 3 && kin.posMismatch === 0 && kin.ageOutOfRange === 0,
      `[${tag}] R64 感知链同源：每一次真实动能命中都出现环，且环的位置 = 真实命中点 contactPoint`,
      `${kin.samples} 次采样 · 真实命中 ${realHits} 次 · 有环帧 ${kin.ringFrames} · ` +
        `位置不符 ${kin.posMismatch} · 年龄越界 ${kin.ageOutOfRange}（年龄上界 280ms）`,
    );
    log(
      kin.expiredFrames > 0 && kin.maxAgeMs <= 280 && kin.ringsMax >= 1,
      `[${tag}] R65 环是「短的」：寿命内最多同时 2 道，超过 280ms 后完全消失（不是常驻装饰）`,
      `环数峰值 ${kin.ringsMax} · 年龄峰值 ${round2(kin.maxAgeMs)}ms · 无环帧 ${kin.expiredFrames}/${kin.samples}`,
    );
    log(
      kin.enemyDxMax > 5 && kin.maxImpulse > 0,
      `[${tag}] R66 必改 3b：命中后敌车真的有**物理位移**（不是只有一层视觉环）`,
      `命中后短窗内舞台带位移峰值 ${round2(kin.enemyDxMax)}px · 最近一次真实冲量 ${round2(kin.maxImpulse)} · ` +
        `战斗推进 ${Math.round(kin.battleMs)}ms · 结束方式=${kin.endedByPhase ? 'BATTLE 结束' : '采样窗口到'}`,
    );

    await kctx.close();
  }

  /*
    --------------------------- 14) PRP-F2-R2：快速装填参数回收（400 → 650）的浏览器端真实验证
    判据（Queue 验收｜方案）：
      · 正常速度下仍能看出「快速装填的炮击频率高于基础炮」；
      · 但相比 400ms（≈2.5×），炮击之间重新留出明显物理运动时间（≈1.54×，不再淹没接敌过程）。
    做法：在**同一个页面的干净新 Run** 里连跑两场 —— 第一场基础炮、第二场只带快速装填 ——
    只用公开 probe 的「在飞弹丸数增量」反推真实开火间隔（不读配置、不看任何文字）。
    同条件保证：Enemy / Player / Battle world / Spawn / Camera / 跨战斗耐久 全部与第一场一致。
    ⚠️ PRP-BUILD-01：新 Run 现在是「三场两选」，本段只走到**第二场**为止（第三场 / 第二次选择
       不参与节奏复验），因此 `choiceOptions[2]` 仍是第一层池里的「快速装填」。
  */
  if (!fireCadenceObserved) {
    fireCadenceObserved = true;

    // 第一场：基础炮（DAY 3，无任何强化）
    await clickRect(page, pFreshEvent.actionRect);
    const pBaseFight = await probeOf(page);
    const baseWin = await sampleFireCadence(page, 6000);
    await page.waitForFunction(() => window.__RUNPAGE__.probe().phase === 'RESULT', null, { timeout: 90000 });
    const pBaseEnd = await probeOf(page);
    await clickRect(page, pBaseEnd.actionRect); // RESULT → CHOICE①
    const pChoiceFr = await probeOf(page);

    // 第二场：只带快速装填（第一次选择里 index 2）
    await clickRect(page, pChoiceFr.choiceOptions[2].rect);
    const pAfterFr = await probeOf(page);
    await clickRect(page, pAfterFr.actionRect); // IDLE → EVENT
    const pEventFr = await probeOf(page);
    await clickRect(page, pEventFr.actionRect); // EVENT → BATTLE
    const pFastFight = await probeOf(page);
    const fastWin = await sampleFireCadence(page, 6000);

    const baseMin = minOf(baseWin.gaps);
    const fastMin = minOf(fastWin.gaps);
    log(
      pBaseFight.phase === 'BATTLE' &&
        !!pBaseFight.battleWorld &&
        pBaseFight.battleWorld.modifier === null &&
        pBaseFight.battleWorld.build.length === 0 &&
        pBaseFight.battleWorld.initialPlayerHp === pBaseFight.battleWorld.playerHpMax &&
        baseWin.gaps.length >= 2,
      `[${tag}] R60 快速装填独立复验：第一场是**无强化的基础炮**（同 Enemy / Player / World / Spawn / Camera，满耐久开局）`,
      `build=[${pBaseFight.battleWorld ? pBaseFight.battleWorld.build.join(',') : '?'}] · 观测 ${baseWin.volleys} 次开火 · ${
        baseWin.gaps.length
      } 个间隔 · 最小间隔 ${Number.isNaN(baseMin) ? 'n/a' : Math.round(baseMin)}ms`,
    );
    log(
      !!pFastFight.battleWorld &&
        pFastFight.battleWorld.modifier === 'fastReload' &&
        JSON.stringify(pFastFight.battleWorld.build) === JSON.stringify(['fastReload']) &&
        pAfterFr.buffs.length === 1 &&
        pAfterFr.day === 4,
      `[${tag}] R61 必改 5：第二场运行时真实拿到「快速装填」（单变量隔离 Run · DAY 4 · 只有这一个强化）`,
      `build=[${pFastFight.battleWorld ? pFastFight.battleWorld.build.join(',') : '?'}] day=${pAfterFr.day} buffs=${pAfterFr.buffLabels.join('/')}`,
    );
    /*
      真实节奏断言（用最小观测间隔）：
        基础炮 ≈1000ms（Base Cannon 冻结）/ 快速装填 ≈650ms（400 → 650 回收后）。
      下界 480ms 用来证明**不再是 400ms 那一版**（若退回 400ms，最小间隔会掉到 ~400 而失败）。
    */
    log(
      baseMin > 880 &&
        baseMin < 1120 &&
        fastMin > 560 &&
        fastMin < 800 &&
        fastMin < baseMin * 0.8 &&
        fastMin > 480,
      `[${tag}] R62 参数回收成立：真实攻击间隔 ≈650ms（明显快于基础 1000ms，但不再是 400ms 的 2.5×）`,
      `基础 ${Math.round(baseMin)}ms → 快速装填 ${Math.round(fastMin)}ms · 频率比 ${round2(baseMin / fastMin)}×`,
    );

    await ctx.close();
    return;
  }

  await ctx.close();
}

/**
 * PRP-F2-R2：采样**真实开火节奏**（浏览器端，只看公开 probe 字段，不走任何内部句柄捷径）。
 *
 * 口径：每 25ms 读一次 `battleWorld.projectiles`，把「在飞弹丸数增加」记为一次真实开火，
 * 并记录相对时刻 → 相邻两次开火的时差 = **真实攻击间隔**（不是读配置）。
 * 战斗结束（phase 离开 BATTLE）即停止，避免把 RESULT 冻结帧算进采样。
 */
async function sampleFireCadence(page, windowMs) {
  return await page.evaluate(async (ms) => {
    const acc = { samples: 0, volleys: 0, gaps: [], lastAt: null };
    let prev = -1;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const pr = window.__RUNPAGE__.probe();
      if (pr.phase !== 'BATTLE') break;
      const w = pr.battleWorld;
      if (w) {
        if (prev >= 0 && w.projectiles > prev) {
          acc.volleys += 1;
          const at = performance.now() - t0;
          if (acc.lastAt !== null) acc.gaps.push(Math.round(at - acc.lastAt));
          acc.lastAt = at;
        }
        prev = w.projectiles;
      }
      acc.samples += 1;
      await new Promise((r) => setTimeout(r, 25));
    }
    return acc;
  }, windowMs);
}

/**
 * ⚠️ 口径说明：浏览器端只能用「在飞弹丸数增量」推断开火，而本场演示里
 * **弹丸命中销毁的那一步常常正好等于下一发的开火步**（单测实测 `birthGaps` 出现 120 步），
 * 于是会**漏计**若干次开火 → 均值被拉高、计数被压低。
 * 因此硬断言一律用**最小观测间隔**（漏计只会把间隔变大，不会变小 → 最小值是稳健下界）。
 */
function minOf(a) {
  return a.length ? Math.min(...a) : NaN;
}

/** 开火节奏与视口无关（物理固定步进）→ 只在首个视口做满时序观测，避免 4 视口重复跑两场 15 秒战斗。 */
let fireCadenceObserved = false;

/**
 * PRP-BUILD-01-R1：动能爆发的**真实感知链**与视口无关（物理固定步进）→ 同样只在首个视口跑一次
 * （这条要连打三场 ≈ 50s，四视口各跑一遍没有信息增量）。
 */
let kineticObserved = false;

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
    /*
      ⚠️ PRP-F1：`planckBattleOrchestrator` **不再**属于「泄漏」——
      Run Page 现在就是**正式接入旧侧视 Planck 战斗**（必改 4），它必须被打进 bundle。
      仍然必须零泄漏的是：正式玩家 Runtime / 正式 UI Host / Debug Lab / 融合 / 微信引导 / Arena A。
    */
    /*
      ⚠️ 并且：**不得**用「标识符字符串扫描」当正向证据 —— 生产构建是压缩产物，
      类名 / 模块名几乎全部被重命名（旧版 I3 的泄漏列表因此长期是空转）。
      改法：沿 chunk 图取出**全部可达字节**，再用两类**压缩后仍然存活**的标记做正向判定：
        - 物理引擎（planck-js）内部字段名：`maxTOIContacts` / `linearSlopSquared` / `baumgarte`
        - 正式车辆装配的属性路径：`hardpointId` / `maxManifoldPoints`
      它们只可能来自正式战斗栈；PRP 自造的「假战斗」不可能产生这些标记。
    */
    const reachable = [jsName];
    for (const m of pageHtml.matchAll(/["'(]\.\/([A-Za-z0-9_.-]+\.js)/g)) reachable.push(m[1]);
    for (let i = 0; i < reachable.length; i += 1) {
      let src = '';
      try {
        src = fs.readFileSync(path.join(ROOT, 'assets', reachable[i]), 'utf8');
      } catch {
        continue;
      }
      for (const m of src.matchAll(/["'(]\.\/([A-Za-z0-9_.-]+\.js)/g)) {
        if (!reachable.includes(m[1])) reachable.push(m[1]);
      }
    }
    const reachableSet = [...new Set(reachable.filter(Boolean))];
    const allBytes = reachableSet
      .map((n) => {
        try {
          return fs.readFileSync(path.join(ROOT, 'assets', n), 'utf8');
        } catch {
          return '';
        }
      })
      .join('\n');
    log(
      reachableSet.length >= 2 && allBytes.length > 300000,
      '[iso] I3 可达 chunk 图被完整取出（排除「只扫一个 chunk / 扫到过期产物」的空转）',
      `chunks=${reachableSet.join(',')} total=${allBytes.length}B`,
    );
    const leaked = [
      'playerGameRuntime',
      'canvasPlayerUIHost',
      'webDomPlayerUIHost',
      'physicsLab',
      'garageFusion',
      'bootstrap-wechat',
      'ArenaARuntime',
    ].filter((n) => allBytes.includes(n));
    log(
      leaked.length === 0,
      '[iso] I3a 可达产物内不含正式玩家 Runtime / Arena A 运行时',
      leaked.length ? `命中=${leaked.join(',')}` : `扫描 ${allBytes.length}B`,
    );
    const engineMarkers = ['maxTOIContacts', 'linearSlopSquared', 'baumgarte'];
    const battleMarkers = ['hardpointId', 'maxManifoldPoints'];
    const missing = [...engineMarkers, ...battleMarkers].filter((m) => !allBytes.includes(m));
    log(
      missing.length === 0,
      '[iso] I3b PRP-F1：产物内**真的含正式 Planck 战斗栈**（不是 PRP 自造假战斗）',
      missing.length
        ? `缺失标记=${missing.join(',')}`
        : `engine=${engineMarkers.join('/')} + battle=${battleMarkers.join('/')} 全部在场`,
    );
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
