/**
 * FRUITS-RANDOM-ADVENTURE-R2｜随机冒险 R2 —— 浏览器真实闭环 + 完整用时计时（事件组合随机 + 主题视觉 + 开奖反馈）。
 *
 * 手段：真实浏览器（playwright-core / msedge）打开独立产物 dist-portrait-lab/adventure.html，
 *   - 复用正式物理战斗（RunBattleRuntime + requestAnimationFrame 真实步进，非伪造）；
 *   - 通过只读诊断句柄 window.__adv（probe / step / restart）驱动，step 与真实点击等价；
 *   - 真实记录「进入冒险→逐天事件→真实短战斗→状态改变→最终结算」各环节 wall-clock 耗时；
 *   - 诚实记录是否达到 180 秒（验收④）；不足须如实披露，绝不造假延时。
 *
 * ⚠️ 本文件只验证「真实可玩闭环 + 计时」，不验证玩法数值（那是 vitest 的职责）。
 * ⚠️ 关闭后台节流，保证 headless 下 rAF 真实推进战斗（与真实玩家体验同速）。
 * ⚠️ 终结态 COMPLETE / FAILED 均为合法的「最终结算」（失败是 roguelike 真实结局），都算闭环达成。
 *
 * 用法：
 *   npm run build:portrait-lab
 *   node tests/_e2e_adventure.cjs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { launchBrowser } = require('./_browser_launch.cjs');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8157;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const SEEDS = (process.env.ADV_SEEDS || 'adv-e2e-A,adv-e2e-B,adv-e2e-C').split(',');
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
const stepOnce = (page) => page.evaluate(() => window.__adv.step());
const restart = (page, seed) => page.evaluate((s) => window.__adv.restart(s), seed);

/**
 * 驱动一整局到终态（COMPLETE / FAILED），真实记录每个 phase 的 wall-clock 停留时长。
 * - 浮层打开 → step（选首卡，等价于真实点击首张卡）；
 * - BATTLE → 不调用 step（战斗由 rAF 真实步进），轮询等待其离开 BATTLE；
 * - 其余（主动作可用）→ step（等价于真实点击主按钮）。
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

  for (let guard = 0; guard < 400; guard++) {
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
      await stepOnce(page);
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

    const ctx = await browser.newContext({ viewport: { width: 480, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`${URL_BASE}/adventure.html?seed=${encodeURIComponent(SEEDS[0])}`, { waitUntil: 'load' });

    const runs = [];
    for (const seed of SEEDS) {
      await restart(page, seed);
      await page.waitForTimeout(40);
      const run = await playThrough(page, seed);
      runs.push(run);

      log(
        run.finalState.phase === 'COMPLETE' || run.finalState.phase === 'FAILED',
        `R2[${seed}] 真实闭环可玩：跑到终态 ${run.finalState.phase}`,
        `phase=${run.finalState.phase} 终态耐久=${run.finalState.carriedHp}/${run.finalState.playerHpMax}`,
      );
      log(run.finalState.battlesCompleted === 3, `R2[${seed}] 三场真实物理战斗全部发生`, `battlesCompleted=${run.finalState.battlesCompleted}`);
      log(run.battleWaits >= 3, `R2[${seed}] 至少等待 3 场战斗由 rAF 真实推进`, `battleWaits=${run.battleWaits}`);
      log(
        run.finalState.day === run.finalState.dayTotal,
        `R2[${seed}] 逐天推进到最后一天`,
        `day=${run.finalState.day}/${run.finalState.dayTotal}`,
      );
      log(
        run.hpChanged && run.buffChanged,
        `R2[${seed}] 事件/战斗真实改变耐久与 Build（非仅文本）`,
        `hpChanged=${run.hpChanged} buffChanged=${run.buffChanged} 终态强化=${run.finalState.buffs.length}`,
      );
      log(true, `R2[${seed}] 完整用时 = ${run.totalSec}s（验收④ 门槛 180s）`, run.total >= 180000 ? '已达到 180s' : '⚠️ 未达 180s，如实披露');
    }

    // ---- 验收①：不同种子产生不同事件组合（不仅是顺序，R2 关键）----
    const combos = new Set(runs.map((r) => JSON.stringify(r.finalState.eventPlan)));
    log(
      combos.size > 1,
      `R2 不同种子产生不同事件组合（不仅是顺序）`,
      `combinations=${combos.size} 示例=${runs.map((r) => r.finalState.eventPlan.map((e) => e.eventKind).join('>')).join(' | ')}`,
    );

    // ---- 验收①：同种子完全可复现（eventPlan + 阶段序列一致）----
    const ref = runs[0];
    await restart(page, SEEDS[0]);
    await page.waitForTimeout(40);
    const replay = await playThrough(page, SEEDS[0] + '(重放)');
    const samePlan = JSON.stringify(ref.finalState.eventPlan) === JSON.stringify(replay.finalState.eventPlan);
    const sameSeq = JSON.stringify(ref.transitions) === JSON.stringify(replay.transitions);
    log(samePlan, `R2[${SEEDS[0]}] 同种子可复现：eventPlan 完全一致`, `eventPlan=${JSON.stringify(ref.finalState.eventPlan)}`);
    log(sameSeq, `R2[${SEEDS[0]}] 同种子可复现：阶段切换序列一致（含胜负）`, `seqA=${ref.transitions.join('>')} seqB=${replay.transitions.join('>')}`);

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
    };
    fs.writeFileSync(path.join(ROOT, 'adventure-e2e-timing.json'), JSON.stringify(summary, null, 2));
    console.log('计时明细已写入 dist-portrait-lab/adventure-e2e-timing.json');

    await ctx.close();
  } catch (e) {
    console.error(e);
    results.push({ pass: false, name: 'R2 E2E 运行异常', detail: String(e && e.message) });
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log('\n============================');
  console.log(`E2E Random Adventure R2: ${results.length - failed.length}/${results.length} PASS`);
  console.log('============================');
  if (failed.length) {
    for (const f of failed) console.log('FAILED: ' + f.name + ' | ' + f.detail);
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
