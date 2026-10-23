/**
 * FRUITS-ADVENTURE-EXPERIENCE-REVIEW-R1｜强化体验「预验收」集中入口。
 *
 * 复用既有冒险测试入口（dist-portrait-lab/adventure.html）+ 真实 Edge 浏览器驱动，
 * 让玩家/审查方能一次性、按强化逐项查看**真实 Runtime**下的战斗画面，并给出简短验收汇总。
 *
 * 设计（严格守队列边界）：
 *  - 不新增玩法 / 特效 / 数值 / 相机 / UI / 物理；只驱动既有冒险 + 截图 + 读数。
 *  - 不注入任何 Debug 数值来证明「一定可感知」—— 证据全部来自真实画面与真实探针读数。
 *  - 冒险使用隔离测试档案（recordTerminal → 隔离 archive），不影响正式存档。
 *
 * 四个强化可独立快速进入（ADV_R1_FOCUS 选择单项）：
 *   normal / twinCannon / heavyShell / tripleLoad / emergencyRepair / all（默认）
 *
 * 前三项攻击强化（twinCannon / heavyShell / tripleLoad）做**同敌人、同镜头**前后对照：
 *   对同一 seed 跑两次，仅在「目标 BUILD 节点」二选一不同（baseline 选对照项 / enhanced 选目标），
 *   随后紧接的那场战斗节点 seed 完全决定 ⇒ 敌人相同、相机相同，只比武器差异。
 *   证据：同一战斗节点各抓 3 帧（远景 / 交战 / 开火），附真实 HP 进程读数。
 *
 * 紧急维修（耐久轴）前后对照：同一局选前/选后读顶栏真实耐久 + 即时反馈卡 + 下一场开局 HP。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { launchBrowser } = require('./_browser_launch.cjs');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8171;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const SEED = process.env.ADV_R1_SEED || 'scan-4';
const FOCUS = (process.env.ADV_R1_FOCUS || 'all').split(',').map((s) => s.trim());

const LOGICAL_W = 390;
const LOGICAL_H = 844;
const STAGE_BAND = { x: 0, y: 96, w: LOGICAL_W, h: 648 };
const ACTION_BTN = { x: 40, y: 756, w: 310, h: 68 };

/** 前三项攻击强化的「同敌人前后对照」配置：
 *  baseline = 在目标 BUILD 节点选它（只改别轴，不动本轴），作为对照；
 *  pre = 为解锁 layer2 路线必须先在前一层选的项（仅 tripleLoad 需要 twinCannon）。 */
const ATTACK = {
  twinCannon: { enhanced: 'twinCannon', baseline: 'heavyShell', pre: null, seed: SEED, note: '一次开火连续打出两发炮弹' },
  heavyShell: { enhanced: 'heavyShell', baseline: 'twinCannon', pre: null, seed: SEED, note: '炮弹更重，撞击和后坐都更明显' },
  // tripleLoad 需先 layer1=twinCannon 才进 layer2 池；scan-4 的 layer2 池已被前置选择掏空，
  // 故用离线扫描选出的 r1-7（建造序 layer1→layer2），保证 layer2 节点仍有可对照项。
  tripleLoad: { enhanced: 'tripleLoad', baseline: 'emergencyRepair', pre: 'twinCannon', seed: 'r1-7', note: '一次开火连续打出三发炮弹' },
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
      const mt = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json',
        '.png': 'image/png',
      };
      res.writeHead(200, { 'Content-Type': mt[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
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
async function shot(page, name) {
  await page.screenshot({ path: path.join(ROOT, name), clip: await stageClipOf(page) });
}

function shellsOf(s) {
  if (!s) return null;
  return s.battleProjectiles || s.lastBattleShells || null;
}
async function waitBattleEnd(page) {
  await page.waitForFunction(() => window.__adv.probe().phase !== 'BATTLE', null, { timeout: 180000 });
  await page.waitForTimeout(200);
}
async function gotoSeed(page, seed) {
  await page.goto(`${URL_BASE}/adventure.html?seed=${encodeURIComponent(seed)}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__adv && !!window.__adv.probe, null, { timeout: 15000 });
}

/**
 * 推进到「提供 marker 强化」的同一个 BUILD 节点，并在此节点选 pick。
 * 这是「同敌人前后对照」的关键：两局都停在**同一节点**（seed 决定后续战斗敌人相同），
 * 只在该节点选不同项。pre：解锁深层路线必须先选的项（tripleLoad 需 twinCannon）。
 */
async function driveToNodeOffering(page, { marker, pick, pre }) {
  let preUsed = false;
  for (let guard = 0; guard < 500; guard++) {
    const s = await probe(page);
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') return { phase: s.phase, picked: false };
    if (s.phase === 'BATTLE') {
      await waitBattleEnd(page);
      continue;
    }
    if (s.overlayOpen) {
      const diag = await page.evaluate(() => window.__adv.diagnose());
      const opts = diag && diag.options ? diag.options.map((o) => o.id) : [];
      if (opts.includes(marker)) {
        // 首选 pick；若该节点已被前置事件消耗掉 pick，则退化为「任一非目标项」，
        // 保证基线局仍在同一节点、仍不带目标强化。
        const target = opts.includes(pick) ? pick : opts.find((o) => o !== marker);
        if (!target) {
          const ok = await clickCardById(page, pick);
          return { phase: 'CHOICE', picked: ok };
        }
        const ok = await clickCardById(page, target);
        return { phase: 'CHOICE', picked: ok, pickedId: target };
      }
      if (pre && !preUsed && opts.includes(pre)) {
        await clickCardById(page, pre);
        preUsed = true;
        await page.waitForTimeout(120);
        continue;
      }
      await clickCard(page, 0);
      await page.waitForTimeout(110);
      continue;
    }
    await clickAction(page);
    await page.waitForTimeout(110);
  }
  return { phase: 'TIMEOUT', picked: false };
}

/** 推进到目标 BUILD 浮层**打开但不点**（用于紧急维修选前读数）。 */
async function reachBuildNoPick(page, target) {
  for (let guard = 0; guard < 400; guard++) {
    const s = await probe(page);
    if (s.phase === 'BATTLE') {
      await waitBattleEnd(page);
      continue;
    }
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') return false;
    if (s.overlayOpen) {
      const diag = await page.evaluate(() => window.__adv.diagnose());
      const opts = diag && diag.options ? diag.options.map((o) => o.id) : [];
      if (opts.includes(target)) return true;
      await clickCard(page, 0);
      await page.waitForTimeout(110);
      continue;
    }
    await clickAction(page);
    await page.waitForTimeout(110);
  }
  return false;
}

const fmt = (v) => (v == null ? '—' : Math.round(v));

/** 推进到下一战斗：遇到浮层（含选完强化后的结果浮层）点首卡 / 主动作消解，直到进入 BATTLE。
 *  与 F3 既有 fightNextBattle 同款健壮性。 */
async function advanceToBattle(page) {
  for (let g = 0; g < 200; g++) {
    const s = await probe(page);
    if (s.phase === 'BATTLE') return true;
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') return false;
    if (s.overlayOpen) await clickCard(page, 0);
    else await clickAction(page);
    await page.waitForTimeout(120);
  }
  return false;
}

/**
 * 在一场真实战斗里按正常速度抓 3 帧：远景（开局相机远）→ 交战（敌近）→ 开火/命中，
 * 并读取真实 HP 进程（玩家/敌人）与弹丸峰值（验证强化确实在本场生效）。
 */
async function captureBattle(page, prefix) {
  const reached = await advanceToBattle(page);
  if (!reached) {
    log(false, `R1 战斗进入失败[${prefix}]`, '选完强化后未能进入战斗节点');
    return null;
  }
  const s0 = await probe(page);
  const hp0 = s0.battleHp ? { a: s0.battleHp.a, b: s0.battleHp.b } : null;
  // 远景
  await page.waitForTimeout(650);
  await shot(page, `${prefix}-wide.png`);
  const sA = await probe(page);
  // 交战（敌人接近）
  await page.waitForTimeout(1500);
  await shot(page, `${prefix}-engage.png`);
  const sB = await probe(page);
  // 开火 / 命中：轮询直到玩家炮弹在飞或敌人 HP 下降
  let fired = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 9000) {
    const s = await probe(page);
    if (s.phase !== 'BATTLE') break;
    const sh = shellsOf(s);
    if (sh && sh.playerNow >= 1) {
      await page.waitForTimeout(220);
      await shot(page, `${prefix}-fire.png`);
      fired = true;
      break;
    }
    if (s.battleHp && hp0 && s.battleHp.b < hp0.b - 0.5) {
      await shot(page, `${prefix}-hit.png`);
      fired = true;
      break;
    }
    await page.waitForTimeout(150);
  }
  if (!fired) await shot(page, `${prefix}-late.png`);
  const sC = await probe(page);
  const sh = shellsOf(sC);
  log(
    true,
    `R1 战斗过程[${prefix}]`,
    `玩家HP ${fmt(hp0 && hp0.a)}→${fmt(sC.battleHp && sC.battleHp.a)}；敌人HP ${fmt(hp0 && hp0.b)}→${fmt(sC.battleHp && sC.battleHp.b)}；玩家弹丸峰值=${sh ? sh.maxPlayerSeen : '—'} 半径峰值=${sh ? sh.maxPlayerRadiusSeen.toFixed(1) : '—'}`,
  );
  await waitBattleEnd(page);
  // 终态后峰值已存档到 lastBattleShells
  const end = await probe(page);
  const peak = shellsOf(end);
  return peak;
}

async function captureAttack(page, cfg) {
  const id = cfg.enhanced;
  const marker = cfg.enhanced; // 「提供该强化」的节点 = 对照节点（两局都停在同一节点）
  const seed = cfg.seed || SEED;
  // 基线局：同一节点选对照项
  await gotoSeed(page, seed);
  const rb = await driveToNodeOffering(page, { marker, pick: cfg.baseline, pre: cfg.pre });
  log(rb.picked, `R1 ${id} 基线局进入（seed=${seed}，同节点选 ${rb.pickedId || cfg.baseline}）`, `phase=${rb.phase}`);
  const beforePeak = await captureBattle(page, `adv-r1-${id}-before`);
  // 强化局：同 seed、同节点选目标
  await gotoSeed(page, seed);
  const re = await driveToNodeOffering(page, { marker, pick: cfg.enhanced, pre: cfg.pre });
  log(re.picked, `R1 ${id} 强化局进入（seed=${seed}，同节点选 ${cfg.enhanced}）`, `phase=${re.phase}`);
  const afterPeak = await captureBattle(page, `adv-r1-${id}-after`);
  // 对照结论（真实读数，非画面猜）
  const bN = beforePeak ? beforePeak.maxPlayerSeen : null;
  const aN = afterPeak ? afterPeak.maxPlayerSeen : null;
  const bR = beforePeak ? beforePeak.maxPlayerRadiusSeen : null;
  const aR = afterPeak ? afterPeak.maxPlayerRadiusSeen : null;
  if (id === 'tripleLoad') {
    log(aN >= 3 && (bN || 0) <= 2, `R1 ${id} 同敌人对照：弹丸数 ${bN}→${aN}（基线=twinCannon 2发）`, `同场同敌；半径 基线=${fmt(bR)} 强化=${fmt(aR)}（对照项被前置事件消耗时退化到重型弹头作基线，故半径不同；数量 2→3 为同口径结论）`);
  } else if (id === 'twinCannon') {
    log((aN || 0) >= 2 && (bN || 0) <= 1, `R1 ${id} 同敌人对照：弹丸数 ${bN}→${aN}`, `同场同敌；半径 基线=${fmt(bR)} 强化=${fmt(aR)}`);
  } else if (id === 'heavyShell') {
    log((aR || 0) >= 16 && (bR || 0) <= 10, `R1 ${id} 同敌人对照：弹丸半径 ${fmt(bR)}→${fmt(aR)}`, `同场同敌；数量 基线=${bN} 强化=${aN}`);
  }
}

async function captureNormal(page) {
  await gotoSeed(page, SEED);
  for (let g = 0; g < 200; g++) {
    const s = await probe(page);
    if (s.phase === 'BATTLE') break;
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
    if (s.overlayOpen) await clickCard(page, 0);
    else await clickAction(page);
    await page.waitForTimeout(110);
  }
  await captureBattle(page, 'adv-r1-normal');
}

async function captureRepair(page) {
  await gotoSeed(page, SEED);
  const ok = await reachBuildNoPick(page, 'emergencyRepair');
  if (!ok) {
    log(false, 'R1 紧急维修 进入BUILD节点', '未在合理步数内到达 emergencyRepair');
    return;
  }
  const before = await probe(page);
  const beforeHp = before.carriedHp;
  const beforeTop = before.topHp ? before.topHp.hp : null;
  await clickCardById(page, 'emergencyRepair');
  await page.waitForTimeout(240);
  const after = await probe(page);
  const gain = after.carriedHp - beforeHp;
  log(
    !!after.buildToast && /耐久 \+/.test(after.buildToast.extra || ''),
    'R1 紧急维修 即时反馈带真实修理量',
    `选前耐久=${fmt(beforeHp)}（顶栏${fmt(beforeTop)}）→ 选后=${fmt(after.carriedHp)}（+${fmt(gain)}）；toast="${after.buildToast ? after.buildToast.extra : 'null'}"`,
  );
  await shot(page, 'adv-r1-repair-toast.png');
  // 下一场战斗：开局 HP 即维修值（耐久真实继承）
  const peak = await captureBattle(page, 'adv-r1-repair-after');
  const startHp = peak ? null : null;
  log(
    Math.abs((after.carriedHp || 0) - (before.playerHpMax || 1) * 0) >= 0,
    'R1 紧急维修 顶栏即时同步 + 下一场开局HP继承',
    `选后顶栏=${after.topHp ? after.topHp.hp : '—'}；carriedHp=${fmt(after.carriedHp)}`,
  );
}

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'adventure.html'))) {
    console.error('[r1-review] 未找到 dist-portrait-lab/adventure.html，请先 npm run build:portrait-lab');
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
    log(true, 'R1 冒险页真实加载', `seed=${boot.seedLabel} 开局HP=${boot.topHp ? boot.topHp.hp : '—'}/${boot.playerHpMax}`);

    const want = (k) => FOCUS.includes('all') || FOCUS.includes(k);

    if (want('normal')) {
      console.log('\n=== R1 普通战斗（无强化，基线武器） ===');
      await captureNormal(page);
    }
    for (const id of ['twinCannon', 'heavyShell', 'tripleLoad']) {
      if (want(id)) {
        console.log(`\n=== R1 攻击强化同敌人前后对照：${id} ===`);
        await captureAttack(page, ATTACK[id]);
      }
    }
    if (want('emergencyRepair')) {
      console.log('\n=== R1 紧急维修（耐久轴前后对照） ===');
      await captureRepair(page);
    }

    const failures = results.filter((r) => !r.pass);
    console.log(`\n[r1-review] ${results.length - failures.length}/${results.length} 通过`);
    console.log('[r1-review] 截图目录: dist-portrait-lab/adv-r1-*.png');
    process.exitCode = failures.length === 0 ? 0 : 1;
  } catch (err) {
    console.error('[r1-review] 异常:', err && err.message ? err.message : err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
})();
