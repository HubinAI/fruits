/**
 * DEMO-HEIGHT-LINE-VISUAL-LAB-R1｜车高 × 水平弹道对照台的**浏览器真实闭环**。
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

/** 舞台带几何（= `runPageLayout.RUN_STAGE_BAND` 的浏览器侧镜像：y=80 / h=302 / w=390）。 */
const BAND = { x: 0, y: 80, w: 390, h: 302 };
/** 待机舞台底色（= `heightLineLab.COLORS.stageBg`）—— 清场后舞台必须回到这个纯色。 */
const STAGE_BG = [0x0d, 0x11, 0x19];

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

  try {
    console.log('\n##### A. 页面与控件 #####');
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__HEIGHTLINELAB__, null, { timeout: 20000 });
    let probe = await readProbe();

    check(pageErrors.length === 0, '无页面级 JS 错误', pageErrors.join(' | '));
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
