/**
 * PRP-R2-DEFAULT-EXPERIENCE-ENTRY｜启动链 smoke（真实 dev server + 真实浏览器）。
 *
 * ⚠️ PRODUCT-LOOP-R1-C 起**默认落地页变了**：根路径 `/` 不再重写到 Run Page，
 *    而是重写到**产品首页** `home.html`。本文件据此分成四段，每一段都对应
 *    Queue 必改 1 的一条可机器判定的含义：
 *
 *   A. 启动链本身（关旧 server → 只跑 `npm run dev` → 端口/日志/HTTP 体）
 *   B. **默认入口 = 产品首页**：只访问根路径 `/`，第一屏必须是首页，
 *      且屏幕上不存在 Run Page / Portrait Lab / 旧横屏 Home 的容器与控制。
 *   C. **玩家真实路径可用**：首页 `开始冒险`（真实 `<a href>` 整页导航）→ Run Page，
 *      且这一局用的是**首页那份装备**（`source === 'profile'`）。
 *   D. **研发入口一个都没少**：`/run-page.html` 仍可直接进入，且 Run Page 的完整
 *      状态机（IDLE → EVENT → BATTLE → RESULT → CHOICE → IDLE）行为**逐项未变** ——
 *      这一段是改动前就在跑的断言，一字未改（换成在新入口上复跑）。
 *   E. 旧横屏正式游戏仍可经显式地址 `/index.html` 直达（保留，未删除）。
 *
 * 严格纪律：
 *   1) 先关闭所有旧 dev server（占用 5173 即强制结束）；
 *   2) 只执行真实启动命令 `npm run dev`（`BROWSER=none` 仅抑制自动化环境的系统弹窗，
 *      浏览器由 playwright 控制；命令本身与用户执行的完全一致）；
 *   3) 浏览器**只访问根路径 `/`** 作为入口 —— 禁止直接访问 /home.html 绕过启动链
 *      （C 段的 Run Page 由**真实点击**到达，E 段的 /index.html 是「保留性反证」）；
 *   4) 两条研发入口（`/run-page.html`）用**独立 page** 访问，不污染 A/B/C 的上下文；
 *   5) 断言里不出现「Run Page 是默认入口」这类已失效的推理。
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

/** 产品首页的正式存档 key（首页显示的主武器必须来自这里）。 */
const SAVE_KEY = 'strongfruit.playerBuild.v1';
/** 装备参数（产品侧与 Run 侧的唯一约定；Run 侧解析见 runPlayerLoadout.ts）。 */
const LOADOUT_PARAM = 'equipped';

/**
 * Run Page 几何调色板（与 src/lab/portraitBattleLab/runPage.ts 的 COLORS 一一对应）。
 * ⚠️ PRP-R3：车辆改用正式 sprite → 车身 / 部件不再入账（sprite 像素非纯色）。
 */
const PALETTE = {
  ground: [0x8f, 0x7a, 0x52],
  road: [0x33, 0x2e, 0x42],
  nodeDone: [0xd2, 0x92, 0x2a],
  nodeTodo: [0x46, 0x53, 0x6b],
  buffIconShell: [0xb8, 0x56, 0x2e],
  buffIconTwin: [0xc0, 0x7a, 0x2a],
  buffIconReload: [0x3f, 0x8f, 0x5a],
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

const probeRun = (page) => page.evaluate(() => window.__RUNPAGE__.probe());
const probeHome = (page) => page.evaluate(() => window.__PRODUCTHOME__.probe());

/** 真实鼠标点击：逻辑坐标 → 屏幕坐标（用画布真实 CSS 矩形换算，不用 DPR-backed 尺寸）。 */
async function clickLogical(page, lx, ly) {
  const screen = (await probeRun(page)).screen;
  const cx = screen.left + (lx / 390) * screen.width;
  const cy = screen.top + (ly / 844) * screen.height;
  await page.mouse.click(cx, cy);
}
async function clickRect(page, r) {
  await clickLogical(page, r.x + r.w / 2, r.y + r.h / 2);
}
/** 真实鼠标点击 DOM 元素（首页是 DOM 页面，没有画布坐标可换算）。 */
async function clickSelector(page, sel) {
  const box = await page.locator(sel).first().boundingBox();
  if (!box) throw new Error(`无法定位元素：${sel}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(150);
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

/* ============================================================ B 段：默认入口 */

/**
 * 「第一屏」联合断言：**默认入口身份** + 无 Debug / 无其它面 + 竖屏几何。
 * @param tag 视口标签
 */
async function assertDefaultEntry(page, tag, vp) {
  const p = await probeHome(page);

  // 1) 入口身份：URL 仍是根路径（服务端重写，用户不需要记任何 URL）
  const url = new URL(page.url());
  log(url.pathname === '/', `[${tag}] S1 URL 保持根路径（无重定向、无需手输）`, `pathname=${url.pathname}`);

  // 2) 页面身份 = **产品首页**，且其它三个面都不在
  const dom = await page.evaluate(() => ({
    title: document.title,
    hasHomeRoot: !!document.getElementById('ph-root'),
    hasRunRoot: !!document.getElementById('run-root'),
    hasRunCanvas: !!document.getElementById('run-canvas'),
    hasLegacyApp: !!document.getElementById('app'),
    hasLabRoot: !!document.getElementById('pbl-root'),
    hasLabCanvas: !!document.getElementById('pbl-canvas'),
    handleHome: typeof window.__PRODUCTHOME__,
    handleRun: typeof window.__RUNPAGE__,
    handleLab: typeof window.__PBL__,
    staticDbg: typeof window.__E2E_INTERNAL_HANDLE__,
    // 产品页只有产品按钮：没有调试表单 / 调试控件
    devNodes: document.querySelectorAll('[data-dev],[data-dev-control]').length,
    formNodes: document.querySelectorAll('input,select,textarea').length,
    stageW: (document.querySelector('.ph-screen') || {}).offsetWidth || 0,
    stageH: (document.querySelector('.ph-screen') || {}).offsetHeight || 0,
  }));
  log(
    dom.title.includes('最强水果') && dom.title.includes('首页') && dom.hasHomeRoot && dom.handleHome === 'object',
    `[${tag}] S2 第一屏就是**产品首页**（#ph-root + __PRODUCTHOME__ 只读句柄）`,
    `title="${dom.title}" #ph-root=${dom.hasHomeRoot}`,
  );
  log(
    !dom.hasRunRoot &&
      !dom.hasRunCanvas &&
      dom.handleRun === 'undefined' &&
      !dom.hasLabRoot &&
      !dom.hasLabCanvas &&
      dom.handleLab === 'undefined' &&
      !dom.hasLegacyApp,
    `[${tag}] S3 首屏不存在 Run Page / Portrait Lab / 旧横屏 Home 的任何容器或句柄`,
    `#run-root=${dom.hasRunRoot} __RUNPAGE__=${dom.handleRun} #pbl-root=${dom.hasLabRoot} __PBL__=${dom.handleLab} #app=${dom.hasLegacyApp}`,
  );
  log(
    dom.devNodes === 0 && dom.formNodes === 0 && dom.staticDbg === 'boolean',
    `[${tag}] S4 玩家页零开发控制（无调试节点 / 无调试表单）`,
    `devNodes=${dom.devNodes} formNodes=${dom.formNodes}`,
  );
  log(
    dom.stageW === 390 && dom.stageH === 844,
    `[${tag}] S5 竖屏 390×844（逻辑舞台恒等比，只缩放不改布局口径）`,
    `.ph-screen=${dom.stageW}×${dom.stageH}`,
  );

  // 3) 首页显示的装备 = **正式存档**那一份（不是页面自己编的一份）
  const weaponSlotOk = p.slots.some((s) => s.hardpointId === p.weaponSlot && s.defId);
  log(
    p.view === 'home' &&
      p.saveKey === SAVE_KEY &&
      !!p.equippedWeaponId &&
      p.weaponIds.includes(p.equippedWeaponId) &&
      weaponSlotOk,
    `[${tag}] S6 首页展示的装备来自正式存档（key=${SAVE_KEY}）；主武器槽有真实 defId`,
    `equipped=${p.equippedWeaponId} slot=${p.weaponSlot} 拥有=${p.weaponIds.length} 件`,
  );
  /*
    车辆展示用**正式 sprite**，但「全部件都有图」不是事实、也不该被当成验收条件：
    两份轮子/行走件在正式资源表里本来就没有 PNG（产品侧 `SPRITE_URLS` 只映射车体与武器），
    它们**按真实 Collider 外接框画灰盒并带 `data-ph-nosprite` 如实标注**（设计如此，不伪造外形）。
    所以这里断言的是**可证的强条件**：
      - 探针说的 sprite 件数 === 页面里真实存在的 `<img>` 件数（同一来源，不是两套口径）；
      - 每一张 `<img>` 都真的加载成功（`naturalWidth > 0`，没有碎图）；
      - 没有图的件**必须**带 `data-ph-nosprite` 标注（不允许静默画一个灰盒冒充）；
      - 每个预览件不是 `<img>` 就是带标注的灰盒（不丢件、不多件）。
  */
  const preview = await page.evaluate(() => {
    const all = [...document.querySelectorAll('[data-ph-preview-item]')];
    return {
      items: all.length,
      imgs: all.filter((n) => n.tagName === 'IMG').length,
      broken: all.filter((n) => n.tagName === 'IMG' && n.naturalWidth === 0).length,
      nosprite: all.filter((n) => n.hasAttribute('data-ph-nosprite')).length,
      canvases: document.querySelectorAll('#ph-root canvas').length,
    };
  });
  log(
    preview.items > 0 &&
      preview.imgs === p.previewSpriteCount &&
      preview.nosprite === p.previewFallbackCount &&
      preview.broken === 0 &&
      preview.imgs + preview.nosprite === preview.items &&
      preview.canvases === 0,
    `[${tag}] S7 首页战车预览用正式 PNG 画（真实加载成功），无图的件按 Collider 外接框灰盒并如实标注`,
    `items=${preview.items} img=${preview.imgs}(broken=${preview.broken}) nosprite=${preview.nosprite} canvas=${preview.canvases} · probe sprite=${p.previewSpriteCount} fallback=${p.previewFallbackCount}`,
  );

  // 4) 「开始冒险」= 同产物内相对链接 + 本局 token + **本份存档装备**
  const href = String(p.startRunHref ?? '');
  const q = new URLSearchParams(href.split('?')[1] ?? '');
  let equipped = null;
  try {
    equipped = q.get(LOADOUT_PARAM) ? JSON.parse(q.get(LOADOUT_PARAM)) : null;
  } catch {
    equipped = null;
  }
  log(
    href.includes('run-page.html') && !/^https?:/i.test(href) && q.get('run') === p.runToken,
    `[${tag}] S8 「开始冒险」是同产物内的相对链接，且带**本局** token（幂等键与地址同源）`,
    `href=${href.slice(0, 90)}…`,
  );
  log(
    !!equipped && equipped.functionalSelections[p.weaponSlot] === p.equippedWeaponId,
    `[${tag}] S9 「开始冒险」的链接带着**屏幕上显示的那件**装备（首页显示 A ⇒ 链接也是 A）`,
    equipped ? `${p.weaponSlot}=${equipped.functionalSelections[p.weaponSlot]}` : 'n/a',
  );

  // 5) 结构性反证（仅 dpr=1，重采样后精确色不再成立）：首页是 **DOM 合成、零画布**
  if (vp.dpr === 1) {
    /*
      ⚠️ 旧横屏正式游戏是 canvas 驱动的（`#app` + canvas），产品首页**刻意相反**：
      整页 DOM 合成、零画布（`tests/productLoopHomeGarage.test.ts` 的 `PL-29` 也钉死了这一点）。
      所以这里的判据是 `canvas === 0` —— 写成 `>= 1` 是把旧横屏页面的口径带过来了。
    */
    log(
      p.canvasCount === 0 && preview.items > 0,
      `[${tag}] S10 首页是 DOM 合成：零 canvas，预览件是真实 DOM 元素`,
      `canvasCount=${p.canvasCount} previewItems=${preview.items}`,
    );
  }
}

/* ==================================================== C 段：玩家真实路径 */

/**
 * 首页 `开始冒险` → Run Page（真实整页导航），并确认这一局用的是**首页那份装备**。
 * 这是 Queue 必改 2「禁止 Run Page 自己用固定 loadout」的端到端判据。
 */
async function assertProductEntryFlow(page, tag) {
  const home = await probeHome(page);
  const equippedId = home.equippedWeaponId;

  await Promise.all([
    page.waitForURL(/run-page\.html/, { timeout: 20000 }).catch(() => {}),
    clickSelector(page, '[data-ph-action="start-run"]'),
  ]);
  await page.waitForFunction(
    () => {
      const c = document.querySelector('#run-canvas');
      if (!window.__RUNPAGE__ || !c || c.width === 0) return false;
      const p = window.__RUNPAGE__.probe();
      return p.screen.width > 0 && p.assets.ready >= 5 && p.assets.failed.length === 0;
    },
    null,
    { timeout: 25000 },
  );
  await sleep(300);

  const dom = await page.evaluate(() => ({
    hasRunRoot: !!document.getElementById('run-root'),
    hasRunCanvas: !!document.getElementById('run-canvas'),
    hasHomeRoot: !!document.getElementById('ph-root'),
    handleRun: typeof window.__RUNPAGE__,
  }));
  const p = await probeRun(page);
  log(
    dom.hasRunRoot && dom.hasRunCanvas && dom.handleRun === 'object' && !dom.hasHomeRoot,
    `[${tag}] C1 真实点击「开始冒险」→ **整页导航**到 Run Page（同一产物内，非 SPA 假跳转）`,
    `url=${page.url()} #run-root=${dom.hasRunRoot} #ph-root=${dom.hasHomeRoot}`,
  );
  /*
    ⚠️ 这里原先写的是 `p.playerLoadout.functionalSelections[p.weaponSlot]` —— 但 `p` 是 **Run 侧探针**，
    `weaponSlot` 是**首页** `ProductProbe` 才有的字段 ⇒ 索引恒为 `undefined`，
    报出来就是 `undefined=undefined`，断言实际上没在比任何东西。
    改为**挂点级逐槽对账**：首页那份 Build（来自首页探针的 slots）vs Run 侧真正收到的 Loadout。
  */
  const mounted = (selections) =>
    Object.entries(selections ?? {})
      .filter(([, v]) => v && v !== 'none')
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join(',');
  const homeMounted = mounted(Object.fromEntries(home.slots.map((s) => [s.hardpointId, s.defId])));
  const runMounted = mounted(p.playerLoadout.functionalSelections);
  log(
    p.playerLoadout.source === 'profile' &&
      p.playerLoadout.fallback === 'none' &&
      p.playerLoadout.functionalSelections[home.weaponSlot] === equippedId &&
      runMounted === homeMounted,
    `[${tag}] C2 这一局用的是**首页那份装备**（source=profile / 无回退 / 挂点级逐槽相同）`,
    `source=${p.playerLoadout.source} fallback=${p.playerLoadout.fallback} · 主武器 ${
      p.playerLoadout.functionalSelections[home.weaponSlot]
    }(首页=${equippedId}) · 逐槽[首页=${homeMounted} | 战斗=${runMounted}]`,
  );
  log(
    p.phase === 'IDLE' && p.day === 1 && p.build.length === 0 && p.logicalW === 390 && p.logicalH === 844,
    `[${tag}] C3 产品入口进 Run 的起点与四带舞台口径与研发入口一致（IDLE / DAY 1 / 空 Build / 390×844）`,
    `phase=${p.phase} day=${p.day} ${p.logicalW}×${p.logicalH}`,
  );
  log(
    p.debugControls === 0 && p.domButtons === 0,
    `[${tag}] C4 Run Page 仍是玩家页面（零开发控制）`,
    `debugControls=${p.debugControls} domButtons=${p.domButtons}`,
  );
  if (p.stage.player) {
    log(
      p.stage.player.allSprites === true,
      `[${tag}] C5 产品入口这一局的玩家车也全部用正式 sprite（装备来自存档，视觉一致）`,
      `allSprites=${p.stage.player.allSprites}`,
    );
  }
}

/* ==================================================== D 段：研发入口未变 */

/** 完整流程：同一页面内 IDLE → EVENT → BATTLE → RESULT → CHOICE → IDLE（不修改 URL）。 */
async function assertFullFlow(page, tag, dpr) {
  const trailBefore = (await probeRun(page)).transitions;
  const p0 = await probeRun(page);
  const urlBefore = page.url();

  await clickRect(page, p0.actionRect);
  let p = await probeRun(page);
  /*
    ⚠️ PRP-RUN-02：状态机改成读**固定 Run Script 节点**推进后，第一个战斗节点是**两段式**
    （`d1-start` IDLE --按一次--> `d2-battle1` IDLE --再按一次--> EVENT）→ 这里要点两次。
    第一次点击的判据是「脚本节点真的换了」，不是「phase 变了」。
  */
  log(
    p.phase === 'IDLE' && p.nodeId === 'd2-battle1' && p.day === 2,
    `[${tag}] F1a 真实点击「继续」→ 脚本推进到 DAY 2 的第一个战斗节点（同一页面 · 零跳转）`,
    `phase=${p.phase} node=${p.nodeId} day=${p.day} log=${p.logCount}`,
  );
  await clickRect(page, p.actionRect);
  p = await probeRun(page);
  log(
    p.phase === 'EVENT' && p.nodeKind === 'BATTLE',
    `[${tag}] F1 IDLE → EVENT（敌人从右侧出现）`,
    `phase=${p.phase} node=${p.nodeId} log=${p.logCount}`,
  );
  log(!!p.stage.enemy && p.stage.playerLeftOfEnemy === true, `[${tag}] F2 EVENT 敌人出现在玩家右侧`, `gap=${round2(p.stage.minGapPx)}`);
  /*
    PRP-F1 必改 1/2：一遭遇就切进**真实 Planck 战斗世界**（正式 1600×900），
    而且两车之间是**明确的远程开局**（外廓间距随**节点 ① 对手的真实车身宽度**变化：
    PRP-RUN-02 起节点 ① = 喷火车，实测 ≈ 606 世界 px）。
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
      Math.round(p.battleWorld.world.initialGap) === 606,
    `[${tag}] F2c 必改 2：正式出生点 400/1200，开局外廓间距 ≈ 606 世界 px（有纵深、不贴车）`,
    p.battleWorld ? `spawn=${round2(p.battleWorld.world.spawnAx)}/${round2(p.battleWorld.world.spawnBx)} initialGap=${round2(p.battleWorld.world.initialGap)}` : '',
  );

  await clickRect(page, p.actionRect);
  p = await probeRun(page);
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
    PRP-F1：真实 Planck 战斗（实测整场 ≈14.0s / 842 帧、首次命中 step 129 ≈2.15s、
    单发弹丸可见寿命 ≈8~15 帧 —— 因为前两发真实打在**地上**，只有第 3 发命中）。
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
  const pMid = await probeRun(page);
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
  p = await probeRun(page);
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
  p = await probeRun(page);
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
  p = await probeRun(page);
  log(p.phase === 'IDLE' && !p.choiceOpen, `[${tag}] F11 选择后回到 IDLE 原上下文`, `phase=${p.phase}`);
  log(
    p.buffs.length === buffsBefore + 1 &&
      p.logCount === before + 3 &&
      /你为大炮加装了/.test(p.log[p.log.length - 3].text),
    `[${tag}] F12 顶部 +1 强化图标 且 日志 +3 行（强化结果 + DAY N + 行进节拍）`,
    `buffs=${buffsBefore}→${p.buffs.length} tail=${p.log.slice(-3).map((l) => l.text).join(' ｜ ')}`,
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
      stats.buffIconTwin === 756 && stats.buffChip === 144,
      `[${tag}] F15 顶部图标真实像素（只有所选选项那一个底色，无空槽）`,
      `twin=${stats.buffIconTwin} chip=${stats.buffChip}`,
    );
  }
}

/* ------------------------------------------------------------------ 主流程 */

async function main() {
  console.log('=== PRP-R2 默认体验入口｜启动链 smoke（默认入口 = 产品首页）===\n');

  // Acceptance 1：从关闭所有旧 dev server 开始
  const killed = killPort(PORT);
  log(true, 'A1 已关闭所有旧 dev server（端口 5173 已清空）', killed > 0 ? `强制结束 ${killed} 个` : '原本空闲');
  await sleep(600);

  // Acceptance 2：只执行这一条真实启动命令
  console.log('\n>>> 执行 npm run dev（唯一启动命令）...\n');
  const dev = startDevServer();
  let first = await waitForServer(60000);
  log(!!first, 'A2 启动命令后 dev server 就绪', first ? `HTTP ${first.status}` : '超时未就绪');

  // 启动日志：Vite 打印的 Local URL 必须是根路径（--open 打开的就是它 → 经重写即默认入口）
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

  // Acceptance 3（HTTP 层）：根路径返回的就是**产品首页**
  log(
    !!first && first.body.includes('最强水果') && first.body.includes('ph-root'),
    'A5 根路径 HTTP 响应体就是产品首页（含页面标题与 #ph-root 容器）',
    first ? `含首页标题=${first.body.includes('最强水果')} 含 #ph-root=${first.body.includes('ph-root')}` : 'n/a',
  );
  log(
    !!first && !first.body.includes('src/main.ts') && !first.body.includes('run-root'),
    'A6 根路径响应体既不加载旧横屏正式入口脚本，也不是 Run Page',
    first ? `含 /src/main.ts=${first.body.includes('src/main.ts')} 含 #run-root=${first.body.includes('run-root')}` : 'n/a',
  );

  // Acceptance 3/4：真实浏览器，只访问根路径
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
      // 只访问根路径 —— 不手输 /home.html
      await page.goto(ROOT_URL, { waitUntil: 'load' });
      await page.waitForFunction(() => !!window.__PRODUCTHOME__, null, { timeout: 20000 });
      await sleep(400);

      // B 段：默认入口身份
      await assertDefaultEntry(page, vp.tag, vp);

      // C 段：玩家真实路径（真点击 → 真导航 → 用存档那份装备）
      await assertProductEntryFlow(page, `${vp.tag}/产品路径`);

      // D 段：研发入口 /run-page.html 仍在，且完整状态机行为逐项未变
      const devPage = await ctx.newPage();
      const devErrors = [];
      devPage.on('pageerror', (e) => devErrors.push(String(e)));
      await devPage.goto(`${ROOT_URL}run-page.html`, { waitUntil: 'load' });
      await devPage.waitForFunction(
        () => {
          if (!window.__RUNPAGE__) return false;
          const p = window.__RUNPAGE__.probe();
          return p.assets.ready >= 5 && p.assets.failed.length === 0 && p.stage.player.allSprites;
        },
        null,
        { timeout: 15000 },
      );
      await sleep(400);
      const devProbe = await probeRun(devPage);
      log(
        devProbe.playerLoadout.source === 'demo' && devProbe.playerLoadout.fallback === 'no-param',
        `[${vp.tag}] D1 研发入口 /run-page.html 不带产品参数时行为不变（退回演示装载，非错误）`,
        `source=${devProbe.playerLoadout.source} fallback=${devProbe.playerLoadout.fallback} tag=${devProbe.playerLoadout.tag}`,
      );
      await assertFullFlow(devPage, `${vp.tag}/run-page`, vp.dpr);
      log(devErrors.length === 0, `[${vp.tag}] D2 研发入口整段流程零运行时报错`, devErrors.slice(0, 2).join(' | ') || 'none');
      await devPage.close();

      log(consoleErrors.length === 0, `[${vp.tag}] S11 默认入口全程无运行时报错`, consoleErrors.slice(0, 2).join(' | ') || 'none');
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
      hasHomeRoot: !!document.getElementById('ph-root'),
    }));
    log(
      legacyDom.title.includes('Physics Lab') &&
        legacyDom.hasApp &&
        !legacyDom.hasRunRoot &&
        !legacyDom.hasHomeRoot,
      'E1 旧横屏正式游戏保留且仅在显式地址可达',
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
