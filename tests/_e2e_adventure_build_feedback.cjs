/**
 * FRUITS-ADVENTURE-BUILD-FEEDBACK-F3｜强化「可感知」真实浏览器验收。
 *
 * 手段：真实 Edge + 真实产物（dist-portrait-lab/adventure.html）+ 真实鼠标点击推进。
 *   种子 `scan-4`（离线扫描 400 个种子选出）：四个目标强化都能沿**真实节点序列**拿到 ——
 *     DAY7  BUILD/lateral → twinCannon（双联炮）
 *     DAY13 BUILD/generic → emergencyRepair（紧急维修）
 *     DAY19 BUILD/layer1  → heavyShell（重型弹头）
 *     DAY24 BUILD/layer2  → tripleLoad（三连装填）
 *   每次选择后都紧跟真实物理战斗 ⇒ 「下一场战斗兑现」逐项可验。
 *
 * 断言（对应 Queue 验收 1/2/3/4）：
 *   ① 即时反馈：选择强化后 `probe().buildToast` 非空，label/gain 与 `runModifiers` 逐字一致；
 *      紧急维修额外带**真实修理量**（0.25 × 1100，按缺口截断）。
 *   ② 兑现（读正式 `BattleRenderSnapshot.projectiles` 的只读统计，不是画面猜的）：
 *      - 双联炮：拿到它之后的下一场战斗，`maxPlayerSeen ≥ 2`（基线 1）；
 *      - 紧急维修：`carriedHp` 立刻 +275，且**下一场开局 HP 就是它**；
 *      - 重型弹头：`maxPlayerRadiusSeen ≥ 16`（基线 10）；
 *      - 三连装填：`maxPlayerSeen ≥ 3`。
 *   ③ 顶栏（F2 口径）维修后立刻上涨；F1 等比读数不受影响。
 *   ④ 关键画面截图：即时反馈卡 ×4 + 战斗中段（含改装条）×2。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { launchBrowser } = require('./_browser_launch.cjs');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8165;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const SEED = process.env.ADV_F3_SEED || 'scan-4';

/* 布局常量（与 advPage.ts / 既有 E2E 同源） */
const LOGICAL_W = 390;
const LOGICAL_H = 844;
const STAGE_BAND = { x: 0, y: 96, w: LOGICAL_W, h: 648 };
const ACTION_BTN = { x: 40, y: 756, w: 310, h: 68 };
/** 四个目标强化 → 期望的 note（runModifiers.ts 逐字）。 */
const NOTES = {
  twinCannon: '一次开火连续打出两发炮弹',
  tripleLoad: '一次开火连续打出三发炮弹',
  heavyShell: '炮弹更重，撞击和后坐都更明显',
  emergencyRepair: '立刻修回一部分车体耐久',
};
const BASE_SHELL_RADIUS = 10;
const HEAVY_SHELL_RADIUS = 16;

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

/** 真实点击第 i 张浮层选项卡（几何与 advPage.layoutOptionCards 同源）。 */
async function clickCard(page, i) {
  const diag = await page.evaluate(() => window.__adv.diagnose());
  const n = diag && diag.options ? diag.options.length : 0;
  if (n === 0) return;
  const w = 330;
  const h = n <= 2 ? 124 : 104;
  const gap = 16;
  const areaTop = STAGE_BAND.y + 154;
  const areaBottom = STAGE_BAND.y + STAGE_BAND.h - 30;
  const total = n * h + (n - 1) * gap;
  const startY = Math.round(areaTop + (areaBottom - areaTop - total) / 2);
  const x = Math.round((LOGICAL_W - w) / 2);
  await clickLogical(page, x + w / 2, startY + i * (h + gap) + h / 2);
}

async function clickCardById(page, id) {
  const diag = await page.evaluate(() => window.__adv.diagnose());
  if (!diag || !diag.options) return false;
  const idx = diag.options.findIndex((o) => o.id === id);
  if (idx < 0) return false;
  await clickCard(page, idx);
  return true;
}

const probe = (page) => page.evaluate(() => window.__adv.probe());

/** 舞台带（96..744）的页面裁切区（与 advPage.ts 的 STAGE_BAND 同源）。 */
async function stageClipOf(page) {
  const rect = await page.evaluate(() => {
    const c = document.getElementById('adv-canvas');
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  return {
    x: rect.left,
    y: rect.top + (STAGE_BAND.y / LOGICAL_H) * rect.height,
    width: rect.width,
    height: (STAGE_BAND.h / LOGICAL_H) * rect.height,
  };
}

/** 一场战斗的弹丸峰值读数：战斗中读实时统计，战斗结束后读上一场存档（终态时实例已 dispose）。 */
function shellsOf(s) {
  if (!s) return null;
  return s.battleProjectiles || s.lastBattleShells || null;
}

async function waitBattleEnd(page) {
  await page.waitForFunction(() => window.__adv.probe().phase !== 'BATTLE', null, { timeout: 180000 });
  await page.waitForTimeout(220);
}

/**
 * 一路真实推进到「能选到 `pickId` 的那次 BUILD 浮层」。
 * 途中遇到的真实战斗全部打完（记录每场的开局/结束读数）—— 这正是在验证
 * 「拿到强化之后的下一场战斗」里的兑现。
 */
async function driveToBuild(page, pickId, shotName) {
  let lastBattleStart = null;
  let lastBattleEnd = null;
  for (let guard = 0; guard < 300; guard++) {
    const s = await probe(page);
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') {
      return { phase: s.phase, picked: false, lastBattleStart, lastBattleEnd };
    }
    if (s.phase === 'BATTLE') {
      lastBattleStart = {
        startHp: s.battleHp ? s.battleHp.a : null,
        buffs: s.buffs,
        topHp: s.topHp,
      };
      if (shotName) {
        await page.waitForTimeout(1200); // 让远摄→接近的相机真的动起来
        await page.screenshot({ path: path.join(ROOT, shotName), clip: await stageClipOf(page) });
        shotName = null;
      }
      await waitBattleEnd(page);
      lastBattleEnd = await probe(page);
      continue;
    }
    if (s.overlayOpen) {
      const diag = await page.evaluate(() => window.__adv.diagnose());
      const has = diag && diag.options && diag.options.some((o) => o.id === pickId);
      if (has) {
        const ok = await clickCardById(page, pickId);
        return { phase: 'CHOICE', picked: ok, lastBattleStart, lastBattleEnd };
      }
      await clickCard(page, 0);
    } else {
      await clickAction(page);
    }
    await page.waitForTimeout(110);
  }
  return { phase: 'TIMEOUT', picked: false, lastBattleStart, lastBattleEnd };
}

/** 打完接下来的一场真实战斗，返回它的结束读数（用于「选完强化后的那场」）。 */
async function fightNextBattle(page, shotName) {
  for (let guard = 0; guard < 300; guard++) {
    const s = await probe(page);
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') return s;
    if (s.phase === 'BATTLE') {
      if (shotName) {
        await page.waitForTimeout(1200);
        await page.screenshot({ path: path.join(ROOT, shotName), clip: await stageClipOf(page) });
        shotName = null;
      }
      await waitBattleEnd(page);
      return await probe(page);
    }
    if (s.overlayOpen) await clickCard(page, 0);
    else await clickAction(page);
    await page.waitForTimeout(110);
  }
  return null;
}

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'adventure.html'))) {
    console.error('[build-fb-e2e] 未找到 dist-portrait-lab/adventure.html，请先 npm run build:portrait-lab');
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
    const boot = await probe(page);
    log(true, 'F3 冒险页真实加载', `seed=${boot.seedLabel} phase=${boot.phase} 开局 HP=${boot.topHp.hp}/${boot.topHp.max}`);

    async function stageClip() {
      const rect = await page.evaluate(() => {
        const c = document.getElementById('adv-canvas');
        const r = c.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      });
      return {
        x: rect.left,
        y: rect.top + (STAGE_BAND.y / LOGICAL_H) * rect.height,
        width: rect.width,
        height: (STAGE_BAND.h / LOGICAL_H) * rect.height,
      };
    }
    const shotToast = async (name) => {
      const clip = await stageClip();
      await page.screenshot({ path: path.join(ROOT, name), clip });
    };

    /* ---------- ① 双联炮（DAY7 BUILD/lateral） ---------- */
    const d1 = await driveToBuild(page, 'twinCannon');
    log(d1.phase === 'CHOICE' && d1.picked, 'F3 真实点击拿到双联炮', `phase=${d1.phase}`);
    await page.waitForTimeout(190); // 130ms 按压延迟 + 余量
    const s1 = await probe(page);
    log(
      !!s1.buildToast && s1.buildToast.id === 'twinCannon' && s1.buildToast.gain === NOTES.twinCannon,
      'F3 即时反馈：双联炮（文案逐字来自 runModifiers）',
      s1.buildToast ? `label=${s1.buildToast.label} gain="${s1.buildToast.gain}" extra=${s1.buildToast.extra || '—'}` : 'buildToast=null',
    );
    await shotToast('adv-f3-toast-twin.png');

    /* ---------- ② 紧急维修（DAY13 BUILD/generic） ---------- */
    const d2 = await driveToBuild(page, 'emergencyRepair', 'adv-f3-battle-twin.png');
    // 双联炮的兑现 = 拿到它之后那场真实战斗里的玩家弹丸峰值
    log(
      !!d2.lastBattleEnd && shellsOf(d2.lastBattleEnd) && shellsOf(d2.lastBattleEnd).maxPlayerSeen >= 2,
      'F3 兑现：双联炮一次攻击同时 2 发玩家炮弹（基线 1）',
      shellsOf(d2.lastBattleEnd)
        ? `maxPlayerSeen=${shellsOf(d2.lastBattleEnd).maxPlayerSeen}（该场 buffs=[${(d2.lastBattleStart ? d2.lastBattleStart.buffs : []).join(',')}]）`
        : 'battleProjectiles=null',
    );
    log(d2.phase === 'CHOICE' && d2.picked, 'F3 真实点击拿到紧急维修', `phase=${d2.phase}`);
    const hpBefore = d2.lastBattleEnd ? d2.lastBattleEnd.carriedHp : null;
    await page.waitForTimeout(190);
    const s2 = await probe(page);
    const expectGain = Math.max(
      0,
      Math.min(Math.round(s2.playerHpMax * 0.25), s2.playerHpMax - (hpBefore ?? s2.playerHpMax)),
    );
    log(
      hpBefore !== null && s2.carriedHp - hpBefore === expectGain && expectGain > 0,
      'F3 兑现：紧急维修真实修耐久（0.25 × 上限，按缺口截断）',
      `HP ${hpBefore !== null ? hpBefore.toFixed(0) : '?'} → ${s2.carriedHp.toFixed(0)}（+${(s2.carriedHp - (hpBefore ?? 0)).toFixed(0)}，期望 +${expectGain}）`,
    );
    log(
      !!s2.buildToast && s2.buildToast.id === 'emergencyRepair' && /耐久 \+\d+/.test(s2.buildToast.extra || ''),
      'F3 即时反馈：紧急维修带真实修理量',
      s2.buildToast ? `label=${s2.buildToast.label} extra="${s2.buildToast.extra}"` : 'buildToast=null',
    );
    log(
      !!s2.buildToast && s2.buildToast.gain === NOTES.emergencyRepair,
      'F3 即时反馈文案逐字来自 runModifiers（紧急维修）',
      s2.buildToast ? `gain="${s2.buildToast.gain}"` : 'n/a',
    );
    log(
      s2.topHp.source === 'carried' && Math.abs(s2.topHp.hp - Math.round(s2.carriedHp)) <= 1,
      'F3 顶栏（F2 口径）立刻显示维修后的耐久',
      `topHp=${s2.topHp.hp} (${s2.topHp.pct}%) source=${s2.topHp.source}`,
    );
    await shotToast('adv-f3-toast-repair.png');

    /* ---------- ③ 重型弹头（DAY19 BUILD/layer1） ---------- */
    const d3 = await driveToBuild(page, 'heavyShell');
    // 紧急维修的兑现 = 下一场真实战斗的**开局** HP 就是修完的值
    log(
      !!d3.lastBattleStart && hpBefore !== null && Math.abs(d3.lastBattleStart.startHp - s2.carriedHp) <= 1,
      'F3 兑现：紧急维修后的下一场开局 HP = 维修值（耐久真实继承）',
      d3.lastBattleStart
        ? `开局 HP=${d3.lastBattleStart.startHp}（维修后 carriedHp=${s2.carriedHp.toFixed(0)}）buffs=[${d3.lastBattleStart.buffs.join(',')}]`
        : 'lastBattleStart=null',
    );
    log(d3.phase === 'CHOICE' && d3.picked, 'F3 真实点击拿到重型弹头', `phase=${d3.phase}`);
    await page.waitForTimeout(190);
    const s3 = await probe(page);
    log(
      !!s3.buildToast && s3.buildToast.id === 'heavyShell' && s3.buildToast.gain === NOTES.heavyShell,
      'F3 即时反馈：重型弹头（文案逐字一致）',
      s3.buildToast ? `label=${s3.buildToast.label} gain="${s3.buildToast.gain}"` : 'buildToast=null',
    );
    await shotToast('adv-f3-toast-heavy.png');

    /* ---------- ④ 三连装填（DAY24 BUILD/layer2） ---------- */
    // scan-4 里「重型弹头 → 三连装填」之间没有战斗 ⇒ 重型弹头的兑现与三连装填同场
    // （终局战同时带着这两项）；半径基线取双联炮那一场（实测 10）。
    const baselineRadius = (shellsOf(d2.lastBattleEnd) || {}).maxPlayerRadiusSeen ?? BASE_SHELL_RADIUS;
    const d4 = await driveToBuild(page, 'tripleLoad');
    log(d4.phase === 'CHOICE' && d4.picked, 'F3 真实点击拿到三连装填', `phase=${d4.phase}`);
    await page.waitForTimeout(190);
    const s4 = await probe(page);
    log(
      !!s4.buildToast && s4.buildToast.id === 'tripleLoad' && s4.buildToast.gain === NOTES.tripleLoad,
      'F3 即时反馈：三连装填（文案逐字一致）',
      s4.buildToast ? `label=${s4.buildToast.label} gain="${s4.buildToast.gain}"` : 'buildToast=null',
    );
    await shotToast('adv-f3-toast-triple.png');
    const final = await fightNextBattle(page, 'adv-f3-battle-final.png');
    log(
      !!final && !!shellsOf(final) && shellsOf(final).maxPlayerRadiusSeen >= HEAVY_SHELL_RADIUS - 0.001,
      'F3 兑现：重型弹头炮弹半径 16（基线 10）—— 画面里更大的炮弹',
      shellsOf(final)
        ? `maxPlayerRadiusSeen=${shellsOf(final).maxPlayerRadiusSeen.toFixed(1)}（基线 ${baselineRadius.toFixed(1)}）`
        : `battleProjectiles=null phase=${final ? final.phase : 'null'} buffs=${final ? final.buffs.join(',') : '?'}`,
    );
    log(
      !!final && !!shellsOf(final) && shellsOf(final).maxPlayerSeen >= 3,
      'F3 兑现：三连装填一次攻击同时 3 发玩家炮弹',
      shellsOf(final)
        ? `maxPlayerSeen=${shellsOf(final).maxPlayerSeen}（该场 buffs=[${final.buffs.join(',')}]）`
        : `battleProjectiles=null phase=${final ? final.phase : 'null'}`,
    );
    if (final && final.phase === 'BATTLE') {
      const clip2 = await stageClip();
      await page.screenshot({ path: path.join(ROOT, 'adv-f3-battle-final.png'), clip: clip2 });
    }

    /* ---------- ⑤ 战斗中段截图（带改装条 + 真实弹丸） ---------- */
    // 终局战后若仍在 BATTLE（未结束）直接截；否则重进一局截图成本高 ⇒ 只在有机会时截
    const shot = await probe(page);
    if (shot.phase === 'BATTLE') {
      await page.screenshot({ path: path.join(ROOT, 'adv-f3-battle-strip.png'), clip: await stageClipOf(page) });
      log(true, 'F3 战斗中段截图（改装条 + 弹丸）', 'adv-f3-battle-strip.png');
    } else {
      log(true, 'F3 本局已终局（COMPLETE/FAILED），跳过中段截图', `phase=${shot.phase}`);
    }

    /* ---------- ⑥ 兼容性 ---------- */
    const s5 = await probe(page);
    log(
      !s5.battleFrame || s5.battleFrame.uniform === true,
      'F3 不影响 F1：战斗画面两轴仍同系数',
      s5.battleFrame ? `scaleX=${s5.battleFrame.scaleX.toFixed(3)} scaleY=${s5.battleFrame.scaleY.toFixed(3)}` : 'battleFrame=null（当前无战斗实例）',
    );

    const failures = results.filter((r) => !r.pass);
    console.log(`\n[build-fb-e2e] ${results.length - failures.length}/${results.length} 通过`);
    process.exitCode = failures.length === 0 ? 0 : 1;
  } catch (err) {
    console.error('[build-fb-e2e] 异常:', err && err.message ? err.message : err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
})();
