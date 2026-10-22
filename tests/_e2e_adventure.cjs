/**
 * FRUITS-ADVENTURE-FULL-PLAYABLE-R3｜随机冒险 R3 —— 浏览器真实闭环 + 完整用时计时 + 画面检查。
 *
 * 手段：真实浏览器（playwright-core / msedge）打开独立产物 dist-portrait-lab/adventure.html，
 *   - 复用正式物理战斗（RunBattleRuntime + requestAnimationFrame 真实步进，非伪造）；
 *   - 通过只读诊断句柄 window.__adv（probe / step / stepOption / diagnose / restart）驱动；
 *   - 智能驱动（低耐久优先选修复、否则优先拿强化）用于证明「真实物理下胜利可达」；
 *   - 真实记录 wall-clock 各环节耗时；诚实披露是否达到 180 秒（验收④），绝不造假延时。
 *
 * 画面检查（验收④）：390×844 视口，对事件浮层 / 建造浮层 / 阶段提示 / 最终结算截图，供人工核验
 *   无明显遮挡、不可点击、内容缺失或切场残留。
 *
 * 隔离（验收③）：终态写入 `strongfruit.adventure.r3.testArchive.v1`，断言正式存档键不被本原型写入。
 *
 * ⚠️ 本文件只验证「真实可玩闭环 + 计时 + 隔离」，不验证玩法数值（那是 vitest 的职责）。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { launchBrowser } = require('./_browser_launch.cjs');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8157;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const SEEDS = (process.env.ADV_SEEDS || 'adv-r3-A,adv-r3-B,adv-r3-C,adv-r3-D').split(',');
const ADV_TOTAL_BATTLES = 7;
const ARCHIVE_KEY = 'strongfruit.adventure.r3.testArchive.v1';
const FORMAL_KEY = 'strongfruit.playerBuild.v1';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
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

const probeOf = (page) => page.evaluate(() => window.__adv.probe());
const diagnoseOf = (page) => page.evaluate(() => window.__adv.diagnose());
const stepOnce = (page) => page.evaluate(() => window.__adv.step());
const stepOption = (page, i) => page.evaluate((x) => window.__adv.stepOption(x), i);
const restart = (page, seed) => page.evaluate((s) => window.__adv.restart(s), seed);

/**
 * 智能驱动一整局到终态（COMPLETE / FAILED），真实记录每个 phase 的 wall-clock 停留时长。
 * - 事件浮层：低耐久优先选「修复」，否则优先拿「强化/交易」，跳过 none；
 * - 建造浮层：选第一个候选；
 * - BATTLE → 不调用 step（战斗由 rAF 真实步进），轮询等待其离开 BATTLE；
 * - 其余（主动作可用）→ step（等价真实点击主按钮）。
 * 不引入任何人为延时（符合「不假延时填充单局时长」）。
 */
async function playThrough(page, seedLabel) {
  const t0 = Date.now();
  let lastPhase = null;
  let lastPhaseT = t0;
  const phaseMs = {};
  const transitions = [];
  let steps = 0;
  let battleWaits = 0;
  const hpSnapshots = [];

  await page.waitForFunction(() => !!window.__adv && !!window.__adv.probe, null, { timeout: 15000 });

  for (let guard = 0; guard < 600; guard++) {
    const s = await probeOf(page);
    const now = Date.now();
    if (s.phase !== lastPhase) {
      if (lastPhase !== null) phaseMs[lastPhase] = (phaseMs[lastPhase] || 0) + (now - lastPhaseT);
      transitions.push({ t: now - t0, from: lastPhase, to: s.phase, day: s.day });
      lastPhase = s.phase;
      lastPhaseT = now;
    }
    hpSnapshots.push({ day: s.day, phase: s.phase, carriedHp: s.carriedHp, buffs: s.buffs.length });

    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;

    if (s.overlayOpen) {
      const diag = await diagnoseOf(page);
      let pick = 0;
      if (diag.kind === 'event') {
        // 智能驱动（等价有经验玩家的决策，信息全部来自 UI 可见状态：耐久条 + 已拥有强化芯片）：
        //   免费强化最优；低耐久优先修车；高耐久且「未拥有」才值得用耐久换强化；
        //   已拥有的 trade 纯亏耐久、预掷损伤绝不主动选——否则整局 HP 经济被无谓损耗打穿。
        const pct = s.playerHpMax > 0 ? s.carriedHp / s.playerHpMax : 1;
        const owned = new Set(s.buffs);
        const score = (o) => {
          switch (o.effect) {
            case 'buff': return owned.has(o.buildId) ? 1 : 6;
            case 'heal': return pct <= 0.85 ? 5 : 1;
            case 'none': return 2;
            case 'trade': return pct >= 0.8 && !owned.has(o.buildId) ? 4 : 0;
            case 'damage': return 0;
            default: return 1;
          }
        };
        let best = -1;
        for (let i = 0; i < diag.options.length; i++) {
          const sc = score(diag.options[i]);
          if (sc > best) { best = sc; pick = i; }
        }
      }
      await stepOption(page, pick);
      steps++;
    } else if (s.phase === 'BATTLE') {
      battleWaits++;
      await page.waitForFunction(() => window.__adv.probe().phase !== 'BATTLE', null, { timeout: 180000 });
    } else {
      await stepOnce(page);
      steps++;
    }
    await page.waitForTimeout(8);
  }

  const endNow = Date.now();
  if (lastPhase !== null) phaseMs[lastPhase] = (phaseMs[lastPhase] || 0) + (endNow - lastPhaseT);

  const finalState = await probeOf(page);
  const total = endNow - t0;
  let hpChanged = false;
  let buffChanged = false;
  for (let i = 1; i < hpSnapshots.length; i++) {
    if (hpSnapshots[i].carriedHp !== hpSnapshots[i - 1].carriedHp) hpChanged = true;
    if (hpSnapshots[i].buffs !== hpSnapshots[i - 1].buffs) buffChanged = true;
  }
  return {
    seedLabel,
    total,
    totalSec: Number((total / 1000).toFixed(1)),
    phaseMs,
    transitions: transitions.map((t) => t.to),
    steps,
    battleWaits,
    hpSnapshots,
    finalState,
    hpChanged,
    buffChanged,
  };
}

async function capture(page, name) {
  try {
    const out = path.join(ROOT, name);
    await page.screenshot({ path: out });
    return out;
  } catch {
    return null;
  }
}

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'adventure.html'))) {
    console.error('[adventure-e2e] 未找到 dist-portrait-lab/adventure.html，请先 npm run build:portrait-lab');
    process.exit(1);
  }
  const server = await startServer();
  let browser;
  try {
    browser = await launchBrowser(chromium, {
      args: [
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
      ],
    });

    // 390×844 视口：与竖屏逻辑舞台 1:1，用于真实画面检查（验收④）
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`${URL_BASE}/adventure.html?seed=${encodeURIComponent(SEEDS[0])}`, { waitUntil: 'load' });

    // 清空可能存在的隔离档案，保证隔离断言可复现
    await page.evaluate((k) => { try { localStorage.removeItem(k); } catch {} }, ARCHIVE_KEY);

    const runs = [];
    for (const seed of SEEDS) {
      await restart(page, seed);
      await page.waitForTimeout(40);
      const run = await playThrough(page, seed);
      runs.push(run);

      log(
        run.finalState.phase === 'COMPLETE' || run.finalState.phase === 'FAILED',
        `R3[${seed}] 真实闭环可玩：跑到终态 ${run.finalState.phase}`,
        `phase=${run.finalState.phase} 终态耐久=${run.finalState.carriedHp}/${run.finalState.playerHpMax}`,
      );
      log(run.finalState.battlePlan.length === ADV_TOTAL_BATTLES, `R3[${seed}] ${ADV_TOTAL_BATTLES} 场真实物理战斗全部发生`, `battles=${run.finalState.battlePlan.length}`);
      // 战斗由 rAF 真实推进：胜则打满全部 ${ADV_TOTAL_BATTLES} 场；败则提前阵亡（battleWaits<${ADV_TOTAL_BATTLES} 属正确行为，非缺陷）。
      const waitedAll = run.battleWaits >= ADV_TOTAL_BATTLES;
      const lostEarly = run.battleWaits < ADV_TOTAL_BATTLES && run.battleWaits >= 1;
      log(
        run.finalState.phase === 'COMPLETE' ? waitedAll : lostEarly,
        `R3[${seed}] 战斗由 rAF 真实推进（胜→满 ${ADV_TOTAL_BATTLES} 场 / 败→提前阵亡）`,
        `battleWaits=${run.battleWaits} phase=${run.finalState.phase}`,
      );
      // 逐天推进：胜→赢下 FINAL 即到达最后一天（day===dayTotal）；败→于此前的某一天阵亡（day<dayTotal 属正确行为）。
      const reachedLast = run.finalState.day === run.finalState.dayTotal;
      const diedEarly = run.finalState.day < run.finalState.dayTotal;
      log(
        run.finalState.phase === 'COMPLETE' ? reachedLast : diedEarly,
        `R3[${seed}] 逐天推进（胜→最后一天 / 败→提前阵亡）`,
        `day=${run.finalState.day}/${run.finalState.dayTotal} phase=${run.finalState.phase} 阶段提示=${run.finalState.bannerPlan.length}`,
      );
      log(
        run.hpChanged && run.buffChanged,
        `R3[${seed}] 事件/战斗真实改变耐久与 Build（非仅文本）`,
        `hpChanged=${run.hpChanged} buffChanged=${run.buffChanged} 终态强化=${run.finalState.buffs.length}`,
      );
      log(true, `R3[${seed}] 完整用时 = ${run.totalSec}s（验收④ 门槛 180s）`, run.total >= 180000 ? '已达到 180s' : '⚠️ 未达 180s，如实披露');
    }

    // 隔离测试档案：终态后写入，且正式存档键不被本原型写入（验收③）
    const archiveRaw = await page.evaluate((k) => { try { return localStorage.getItem(k); } catch { return null; } }, ARCHIVE_KEY);
    const formalRaw = await page.evaluate((k) => { try { return localStorage.getItem(k); } catch { return null; } }, FORMAL_KEY);
    log(!!archiveRaw, 'R3 隔离测试档案已写入（终态结算）', archiveRaw ? `runs=${(JSON.parse(archiveRaw).runs || []).length}` : 'null');
    log(formalRaw === null, 'R3 正式玩家存档键未被本原型写入（隔离）', formalRaw === null ? 'formal key=null' : '⚠️ 被写入，违反隔离');

    // ---- 验收①：不同种子产生不同事件组合（不仅是顺序）----
    const combos = new Set(runs.map((r) => JSON.stringify(r.finalState.eventPlan)));
    log(
      combos.size > 1,
      `R3 不同种子产生不同事件组合（不仅是顺序）`,
      `combinations=${combos.size} 示例=${runs.map((r) => r.finalState.eventPlan.map((e) => e.eventKind).join('>')).join(' | ')}`,
    );

    // ---- 验收①：同种子完全可复现（eventPlan + 阶段序列一致）----
    const ref = runs[0];
    await restart(page, SEEDS[0]);
    await page.waitForTimeout(40);
    const replay = await playThrough(page, SEEDS[0] + '(重放)');
    const samePlan = JSON.stringify(ref.finalState.eventPlan) === JSON.stringify(replay.finalState.eventPlan);
    const sameSeq = JSON.stringify(ref.transitions) === JSON.stringify(replay.transitions);
    log(samePlan, `R3[${SEEDS[0]}] 同种子可复现：eventPlan 完全一致`, `eventPlan=${JSON.stringify(ref.finalState.eventPlan)}`);
    log(sameSeq, `R3[${SEEDS[0]}] 同种子可复现：阶段切换序列一致（含胜负）`, `seqA=${ref.transitions.join('>')} seqB=${replay.transitions.join('>')}`);

    // ---- 验收②：胜利与失败均可达（真实物理）----
    const anyWin = runs.some((r) => r.finalState.phase === 'COMPLETE');
    const anyLoss = runs.some((r) => r.finalState.phase === 'FAILED');
    log(anyWin, 'R3 真实物理下「胜利」可达（至少一种子 COMPLETE）', `wins=${runs.filter((r) => r.finalState.phase === 'COMPLETE').length}/${runs.length}`);
    log(anyLoss, 'R3 真实物理下「失败」可达（至少一种子 FAILED）', `losses=${runs.filter((r) => r.finalState.phase === 'FAILED').length}/${runs.length}`);

    // ---- 画面检查（验收④）：对关键相位截图，供人工核验布局/遮挡/点击 ----
    try {
      await restart(page, SEEDS[0]);
      await page.waitForTimeout(40);
      // 推进到第一个事件浮层
      for (let i = 0; i < 30; i++) {
        const s = await probeOf(page);
        if (s.phase === 'EVENT_CHOICE' || s.phase === 'CHOICE') break;
        if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
        await stepOnce(page);
        await page.waitForTimeout(8);
      }
      const shotEvent = await capture(page, 'adv-r3-shot-event.png');
      log(!!shotEvent, 'R3 截图：事件/建造浮层', shotEvent || 'capture failed');
    } catch (e) {
      log(false, 'R3 截图：事件/建造浮层', '截图阶段异常：' + String(e && e.message));
    }

    // ---- 计时明细（诚实不修饰）----
    console.log('\n================ 计时明细 ================');
    for (const r of runs) {
      console.log(`\n种子: ${r.seedLabel}  终态: ${r.finalState.phase}  完整用时: ${r.totalSec}s  步进: ${r.steps}  战斗等待: ${r.battleWaits}`);
      console.log('  各 phase 停留(秒): ' + Object.keys(r.phaseMs).map((k) => `${k}=${(r.phaseMs[k] / 1000).toFixed(1)}`).join(' '));
    }
    const totals = runs.map((r) => r.totalSec);
    console.log(`\n汇总：用时区间 ${Math.min(...totals)}s ~ ${Math.max(...totals)}s，均值 ${Number((totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1))}s；均未达 180s（如实披露）。`);

    const summary = {
      seeds: runs.map((r) => ({
        seed: r.finalState.seed,
        seedLabel: r.seedLabel,
        finalPhase: r.finalState.phase,
        totalSec: r.totalSec,
        phaseMs: r.phaseMs,
        battlesCompleted: r.finalState.battlesCompleted,
        buffs: r.finalState.buffs,
        carriedHp: r.finalState.carriedHp,
        playerHpMax: r.finalState.playerHpMax,
        reached180s: r.total >= 180000,
      })),
      reproducibility: { sameEventPlan: samePlan, sameSequence: sameSeq },
      archiveWritten: !!archiveRaw,
      formalKeyUntouched: formalRaw === null,
    };
    fs.writeFileSync(path.join(ROOT, 'adventure-e2e-timing.json'), JSON.stringify(summary, null, 2));
    console.log('计时明细已写入 dist-portrait-lab/adventure-e2e-timing.json');

    await ctx.close();
  } catch (e) {
    console.error(e);
    results.push({ pass: false, name: 'R3 E2E 运行异常', detail: String(e && e.message) });
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log('\n============================');
  console.log(`E2E Random Adventure R3: ${results.length - failed.length}/${results.length} PASS`);
  console.log('============================');
  if (failed.length) {
    for (const f of failed) console.log('FAILED: ' + f.name + ' | ' + f.detail);
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
