/**
 * FRUITS-ADVENTURE-BATTLE-HP-F2｜顶部耐久条「实时 HP」真实浏览器验收。
 *
 * 手段：真实 Edge + 真实产物（dist-portrait-lab/adventure.html）+ 真实鼠标点击推进到 BATTLE，
 *   不伪造战斗、不修改生产代码分支、不用 debug 步进。
 *
 * 断言（对应 Queue 验收 1/2/3）：
 *   ① 战斗中：`probe().topHp.source === 'battle-live'`，且 `topHp.hp === probe().battleHp.a`
 *      （显示值 == 正式运行时的真实 HP），分母同源（`battleHp.aMax === playerHpMax`）。
 *   ② 战斗中多次采样：真实 HP 下降时顶栏 pct 同步下降（旧实现恒为开局值，这里会失败）。
 *   ③ 像素证据：直接量顶栏耐久条的**实际填充像素宽度**，与 `topHp.pct` 对得上
 *      —— 证明改的是画出来的东西，不是探针里的数字。
 *   ④ 切场不回跳：进入 RESULT 后 `source === 'carried'`，`topHp.hp === round(battleHp.a)`
 *      （= 最后一帧实时 HP），pct 与最后一帧一致，且像素宽度同样对得上。
 *   ⑤ 下一场：进入第二场 BATTLE 时开局 `battleHp.a === topHp.hp`（耐久继承 + 显示一致）。
 *
 * 像素口径说明：条宽 248，填充后还要叠一圈 2px 深色描边（`lineWidth 2` 压在填充两端），
 * 所以实测比 `round(248×pct/100)` **少约 2px**；容差 ±3px 正是为此（且这个常数偏移
 * 在 pct 变化时不变 —— 断言「每帧都对得上」仍能抓住任何离线）。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { launchBrowser } = require('./_browser_launch.cjs');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8163;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const SEED = process.env.ADV_F2_SEED || 'adv-r3-A';

/* 布局常量（与 advPage.ts 同源） */
const LOGICAL_W = 390;
const LOGICAL_H = 844;
const TOP_BAND_H = 96;
const ACTION_BTN = { x: 40, y: 756, w: 310, h: 68 };
/** 耐久条（advPage.drawTop）：x 46, y 52, w 248, h 16。量中下部避开顶部 40% 高光。 */
const HP_BAR = { x: 46, y: 52, w: 248, h: 16 };
const HP_SAMPLE_Y = HP_BAR.y + Math.round(HP_BAR.h * 0.62);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
};

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}

function startServer() {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/adventure.html';
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

async function clickLogical(page, lx, ly) {
  const rect = await page.evaluate(() => {
    const c = document.getElementById('adv-canvas');
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  await page.mouse.click(rect.left + (lx / LOGICAL_W) * rect.width, rect.top + (ly / LOGICAL_H) * rect.height);
}

const clickAction = (page) => clickLogical(page, ACTION_BTN.x + ACTION_BTN.w / 2, ACTION_BTN.y + ACTION_BTN.h / 2);

/**
 * FRUITS-ADVENTURE-UX-CONTINUITY-R1｜按新语义推进：需要玩家才点，纯信息阶段等它自己走。
 * R1 之后 EVENT / RESULT / EVENT_DONE 由界面自动承接（主操作在这些阶段是 no-op 且不显示按钮），
 * 旧脚本若在这里继续点主按钮只会原地打转 —— 因此统一改为「等自动化」。
 */
async function clickActionIfNeeded(page) {
  const s = await page.evaluate(() => window.__adv.probe());
  const c = s && s.continuity;
  if (s && s.overlayOpen) return false;
  if (c && c.needsPlayer === false) {
    // 纯信息阶段：不点击，等它自己推进（最多 15s，正常在 1.0–1.2s 内完成）
    await page
      .waitForFunction(
        (ph) => {
          const p = window.__adv.probe();
          return p.phase !== ph || (p.continuity && p.continuity.needsPlayer === true);
        },
        s.phase,
        { timeout: 15000 },
      )
      .catch(() => {});
    return false;
  }
  await clickAction(page);
  return true;
}

/** 真实点击第 i 张浮层选项卡（几何与 advPage.layoutOptionCards 同源）。 */
/**
 * FRUITS-ADVENTURE-UX-CONTINUITY-R1｜点第 i 张选项卡。
 *
 * 坐标**不再由测试重算**：直接读 `probe().continuity.optionRects`（= 页面 `uxOptionRects` 的输出，
 * 与绘制同源）。R1 把选项卡从「全屏遮罩里的舞台带」搬进了「叙事区」，任何在测试里复刻一遍
 * 几何的做法都会在版面调整后悄悄失效 —— 这正是 F1 脚本卡在 EVENT_CHOICE 的原因。
 */
async function clickCard(page, i) {
  const s = await page.evaluate(() => window.__adv.probe());
  const rects = (s && s.continuity && s.continuity.optionRects) || [];
  const r = rects[i];
  if (!r) return;
  await clickLogical(page, r.x + r.w / 2, r.y + r.h / 2);
}

/** 用真实点击推进到下一次 BATTLE。 */
async function driveToBattle(page) {
  let clicks = 0;
  for (let guard = 0; guard < 120; guard++) {
    const s = await page.evaluate(() => window.__adv.probe());
    if (s.phase === 'BATTLE') return { ok: true, clicks };
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') return { ok: false, clicks, terminal: s.phase };
    if (s.overlayOpen) await clickCard(page, 0);
    else await clickActionIfNeeded(page);
    clicks++;
    await page.waitForTimeout(110);
  }
  return { ok: false, clicks };
}

/** 顶栏耐力条的实际填充宽度（逻辑 px）。绿 = 正常，红 = 低耐久（pct ≤ 25）。 */
async function measureBar(page) {
  return page.evaluate(
    ([bar, y]) => {
      const c = document.getElementById('adv-canvas');
      const g = c.getContext('2d');
      const dpr = c.width / 390;
      const x0 = Math.round(bar.x * dpr);
      const w = Math.round(bar.w * dpr);
      const row = g.getImageData(x0, Math.round(y * dpr), w, 1).data;
      let green = 0;
      let red = 0;
      for (let i = 0; i < w; i++) {
        const r = row[i * 4];
        const gg = row[i * 4 + 1];
        const bb = row[i * 4 + 2];
        if (gg > 100 && gg > r + 20 && gg > bb + 20) green++;
        else if (r > 150 && r > gg + 40 && r > bb + 40) red++;
      }
      return { greenPx: green / dpr, redPx: red / dpr, filledPx: (green + red) / dpr, dpr };
    },
    [HP_BAR, HP_SAMPLE_Y],
  );
}

/** 一帧读数：探针（真实 HP + 显示值）+ 条像素宽度。 */
async function sample(page) {
  const probe = await page.evaluate(() => window.__adv.probe());
  const bar = await measureBar(page);
  return { probe, bar };
}

const expectFill = (pct) => Math.round((HP_BAR.w * pct) / 100);

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'adventure.html'))) {
    console.error('[hp-bar-e2e] 未找到 dist-portrait-lab/adventure.html，请先 npm run build:portrait-lab');
    process.exit(1);
  }
  const server = await startServer();
  let browser;
  try {
    browser = await launchBrowser(chromium, {
      args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
    });
    const ctx = await browser.newContext({ viewport: { width: LOGICAL_W, height: LOGICAL_H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();

    await page.goto(`${URL_BASE}/adventure.html?seed=${encodeURIComponent(SEED)}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__adv && !!window.__adv.probe, null, { timeout: 15000 });
    const boot = await page.evaluate(() => window.__adv.probe());
    log(true, 'F2 冒险页真实加载', `seed=${boot.seedLabel} phase=${boot.phase} 开局耐久=${boot.topHp.hp}/${boot.topHp.max} source=${boot.topHp.source}`);

    // ---- 真实点击推进到 BATTLE ----
    const drove = await driveToBattle(page);
    if (!drove.ok) throw new Error(`未能进入 BATTLE（clicks=${drove.clicks}）`);
    await page.waitForTimeout(160); // 让首帧真实战斗先发生

    const rect = await page.evaluate(() => {
      const c = document.getElementById('adv-canvas');
      const r = c.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });
    const topClip = {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: (TOP_BAND_H / LOGICAL_H) * rect.height,
    };

    // ---- ① 战斗中的显示来源与分母 ----
    const first = await sample(page);
    const p0 = first.probe;
    log(
      p0.phase === 'BATTLE' && p0.topHp.source === 'battle-live',
      'F2 战斗中顶栏读实时 HP（source = battle-live）',
      `phase=${p0.phase} source=${p0.topHp.source} 显示=${p0.topHp.hp} 运行时=${p0.battleHp ? p0.battleHp.a : 'n/a'}`,
    );
    log(
      !!p0.battleHp && p0.topHp.hp === Math.round(p0.battleHp.a),
      'F2 显示值 == RunBattleRuntime.hp().a（同一帧）',
      `显示=${p0.topHp.hp} 运行时=${p0.battleHp ? p0.battleHp.a : 'n/a'} 开局 carriedHp=${p0.carriedHp}`,
    );
    log(
      !!p0.battleHp && p0.battleHp.aMax === p0.playerHpMax,
      'F2 分母同源（运行时 maxHp == 冒险 ctx.playerHpMax ⇒ 切场百分比不跳）',
      `aMax=${p0.battleHp ? p0.battleHp.aMax : 'n/a'} playerHpMax=${p0.playerHpMax}`,
    );
    log(
      Math.abs(first.bar.filledPx - expectFill(p0.topHp.pct)) <= 3,
      'F2 像素：耐久条实际填充宽度 == topHp.pct 对应宽度',
      `pct=${p0.topHp.pct}% 期望=${expectFill(p0.topHp.pct)}px 实测=${first.bar.filledPx}px（绿${first.bar.greenPx} 红${first.bar.redPx}）`,
    );
    await page.screenshot({ path: path.join(ROOT, 'adv-f2-top-first.png'), clip: topClip });

    // ---- ② 连续采样：真实 HP 降 ⇒ 顶栏同步降 ----
    const series = [first];
    for (let i = 0; i < 14; i++) {
      await page.waitForTimeout(420);
      const s = await sample(page);
      if (s.probe.phase !== 'BATTLE') break;
      if (s.probe.battleHp && s.probe.topHp.hp !== Math.round(s.probe.battleHp.a)) {
        log(false, 'F2 采样帧显示值偏离运行时 HP', `显示=${s.probe.topHp.hp} 运行时=${s.probe.battleHp.a}`);
      }
      series.push(s);
    }
    const last = series[series.length - 1];
    const dropHp = first.probe.battleHp.a - last.probe.battleHp.a;
    const dropPct = first.probe.topHp.pct - last.probe.topHp.pct;
    log(
      series.length >= 3 && dropHp > 0 && dropPct > 0,
      'F2 战斗中真实 HP 下降时顶栏耐久同步下降（旧实现恒为开局值 88%）',
      `采样=${series.length} 帧 HP ${first.probe.battleHp.a.toFixed(0)}→${last.probe.battleHp.a.toFixed(0)}(-${dropHp.toFixed(0)}) pct ${first.probe.topHp.pct}%→${last.probe.topHp.pct}%(-${dropPct})`,
    );
    // 每一帧的显示百分比都要与运行时 HP 自洽（不是只在首尾对得上）
    const consistent = series.every(
      (s) => s.probe.battleHp && s.probe.topHp.pct === Math.round((Math.round(s.probe.battleHp.a) / s.probe.playerHpMax) * 100),
    );
    log(consistent, 'F2 每一采样帧 pct 都由该帧真实 HP 算出（逐帧一致）', `帧=${series.length}`);
    // 每一帧的像素宽度也要跟上（显示真的在变）
    const pxOk = series.every((s) => Math.abs(s.bar.filledPx - expectFill(s.probe.topHp.pct)) <= 3);
    log(pxOk, 'F2 像素：每采样帧耐久条宽度都对得上该帧 pct', `帧=${series.length}`);
    await page.screenshot({ path: path.join(ROOT, 'adv-f2-top-battle.png'), clip: topClip });

    // ---- ④ 切场不回跳 ----
    await page.waitForFunction(() => window.__adv.probe().phase !== 'BATTLE', null, { timeout: 120000 });
    await page.waitForTimeout(260);
    const settled = await sample(page);
    const sp = settled.probe;
    const frozenHp = sp.battleHp ? Math.round(sp.battleHp.a) : null;
    log(
      sp.topHp.source === 'carried',
      'F2 战斗结束后顶栏切回已结算口径（source = carried）',
      `phase=${sp.phase} source=${sp.topHp.source} carriedHp=${sp.carriedHp} 显示=${sp.topHp.hp}`,
    );
    log(
      frozenHp !== null && sp.topHp.hp === frozenHp && sp.topHp.hp === Math.round(sp.carriedHp),
      'F2 切场不回跳：显示值 == 最后一帧实时 HP == carriedHp',
      `显示=${sp.topHp.hp} 最后实时=${frozenHp} carriedHp=${sp.carriedHp} 最后战斗中采样=${last.probe.topHp.hp}`,
    );
    log(
      Math.abs(settled.bar.filledPx - expectFill(sp.topHp.pct)) <= 3,
      'F2 像素：结算帧耐久条宽度对得上（画出来的也是结算值）',
      `pct=${sp.topHp.pct}% 期望=${expectFill(sp.topHp.pct)}px 实测=${settled.bar.filledPx}px`,
    );
    const carryBefore = sp.carriedHp;
    await page.screenshot({ path: path.join(ROOT, 'adv-f2-top-settled.png'), clip: topClip });

    // ---- ⑤ 下一场：耐久继承 + 显示一致 ----
    const drove2 = await driveToBattle(page);
    if (drove2.ok) {
      await page.waitForTimeout(200);
      const next = await sample(page);
      log(
        next.probe.topHp.source === 'battle-live' &&
          !!next.probe.battleHp &&
          Math.abs(next.probe.battleHp.a - next.probe.topHp.hp) <= 1,
        'F2 下一场开局：顶栏显示 == 本场继承来的真实 HP',
        `上一场结算=${carryBefore} 本场开局运行时=${next.probe.battleHp ? next.probe.battleHp.a : 'n/a'} 显示=${next.probe.topHp.hp}`,
      );
      log(
        Math.abs(next.bar.filledPx - expectFill(next.probe.topHp.pct)) <= 3,
        'F2 像素：下一场开局耐久条宽度对得上',
        `pct=${next.probe.topHp.pct}% 实测=${next.bar.filledPx}px`,
      );
      await page.screenshot({ path: path.join(ROOT, 'adv-f2-top-next-battle.png'), clip: topClip });
    } else {
      log(true, 'F2 本局已到终局，跳过「下一场」断言（不伪造推进）', `phase=${drove2.terminal || '?'}`);
    }

    const failures = results.filter((r) => !r.pass);
    console.log(`\n[hp-bar-e2e] ${results.length - failures.length}/${results.length} 通过`);
    process.exitCode = failures.length === 0 ? 0 : 1;
  } catch (err) {
    console.error('[hp-bar-e2e] 异常:', err && err.message ? err.message : err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
})();
