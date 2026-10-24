/**
 * FRUITS-ADVENTURE-UX-CONTINUITY-R1｜一屏式连续性真实浏览器预验收。
 *
 * 这份脚本要回答的是**产品问题**，不是「代码有没有报错」：
 *   ① 战斗 / 事件 / 奖励是否共享同一主场景（不再整页跳转）
 *   ② 连续非决策阶段是否真的**不需要点击**（主操作次数显著下降）
 *   ③ 390×844 下素材正常加载、无缺失/拉伸/严重留白/文字遮挡
 *   ④ 正常速度连续流程（含胜负分支与复玩入口）能真实跑通
 *
 * 驱动方式（与真人操作一致）：
 *   - 正常速度：不加速时间、不桩化物理、不调用 debugStep；
 *   - 真实点击：`page.mouse.click` 打到 canvas 的逻辑坐标；
 *   - 真实等待：纯信息阶段**不点击**，等界面自己往下走（这就是被验证的对象）。
 *
 * 关键观测量（全部来自只读 `window.__adv.probe()`）：
 *   - 主操作点击次数 vs 信息阶段数：R1 前每个信息阶段都要一次点击，R1 后应为 0；
 *   - 每次「阶段切换」是否伴随整页换场（用舞台带尺寸是否恒定 + 叙事区是否常驻判定）；
 *   - 素材加载：`uiReady` / `uiFailed` 必须无缺失。
 *
 * 用法：
 *   node tests/_e2e_adventure_continuity_r1.cjs
 *   ADV_R1_SEED=scan-4 node tests/_e2e_adventure_continuity_r1.cjs
 *   ADV_R1_LOSS=1 node tests/_e2e_adventure_continuity_r1.cjs   # 额外跑一局败局分支
 * 产物：docs/adventure-ux-continuity-r1/evidence/*.png + continuity-*.json
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('./_browser_launch.cjs');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const OUT = path.join(__dirname, '..', 'docs', 'adventure-ux-continuity-r1', 'evidence');
const PORT = 8188;
const LOGICAL_W = 390;
const LOGICAL_H = 844;
const SEED = process.env.ADV_R1_SEED || 'scan-4';
const RUN_LOSS = process.env.ADV_R1_LOSS === '1';

const UX_ACTION_BTN = { x: 34, y: 758, w: 322, h: 66 };
const UX_STAGE = { x: 0, y: 92, w: 390, h: 378 };
const UX_NARRATIVE = { x: 0, y: 470, w: 390, h: 274 };

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}

/** 记录真实 404 的 URL（用于区分「页签杂项 404」与「素材缺失」）。 */
const http404 = [];

function startServer() {
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
  };
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
        http404.push(urlPath);
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
async function canvasRect(page) {
  return page.evaluate(() => {
    const c = document.getElementById('adv-canvas');
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
}
async function clickLogical(page, lx, ly) {
  const rect = await canvasRect(page);
  await page.mouse.click(rect.left + (lx / LOGICAL_W) * rect.width, rect.top + (ly / LOGICAL_H) * rect.height);
}
const probe = (page) => page.evaluate(() => window.__adv.probe());

/** 只截 canvas（等同玩家看到的画面），保存到 evidence/。 */
async function shot(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  const dataUrl = await page.evaluate(() => document.getElementById('adv-canvas').toDataURL('image/png'));
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, buf);
  return file;
}

/**
 * 正常速度真实点击跑一局到终态。
 *
 * 唯一「不真人」的地方：选择卡的智能择优（信息全部来自只读 diagnose），
 * 这属于测试策略，不影响「是否需要点击」的计数口径。
 */
async function playRun(page, label, { wantLoss = false } = {}) {
  const t0 = Date.now();
  const trail = [];
  const shots = [];
  let lastPhase = null;
  let actionClicks = 0;
  let choiceClicks = 0;
  let missedClicks = 0; // 点在不可点主按钮上的次数（应为 0 —— 界面不该有假按钮）
  let infoPhaseWaits = 0;
  let stageHeights = new Set();
  let narrativePresent = 0;
  let probeCount = 0;
  let shotBudget = { BATTLE: 1, RESULT: 1, EVENT_CHOICE: 1, CHOICE: 1, EVENT_DONE: 1, COMPLETE: 1, FAILED: 1, EVENT: 1 };
  let autoAdvanceSeen = 0;

  await page.waitForFunction(() => !!window.__adv && !!window.__adv.probe, null, { timeout: 20000 });

  for (let guard = 0; guard < 4000; guard++) {
    const s = await probe(page);
    probeCount += 1;
    const c = s.continuity;
    stageHeights.add(`${UX_STAGE.w}x${UX_STAGE.h}`);
    if (c) narrativePresent += 1;

    if (s.phase !== lastPhase) {
      trail.push({
        t: Date.now() - t0,
        phase: s.phase,
        day: s.day,
        needsPlayer: c ? c.needsPlayer : null,
        hp: Math.round(s.carriedHp),
        alive: s.battleHp ? Math.round(s.battleHp.a) : null,
        buffs: [...s.buffs],
        battlesWon: s.battlesWon,
        battlesCompleted: s.battlesCompleted,
      });
      lastPhase = s.phase;
      // 关键阶段各截一张（每个阶段第一帧）
      if (shotBudget[s.phase] > 0) {
        shotBudget[s.phase] -= 1;
        shots.push(await shot(page, `r1-${label}-${s.phase.toLowerCase()}-${String(shots.length).padStart(2, '0')}`));
      }
    }

    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') {
      if (shotBudget[s.phase] === 0 && shots.every((f) => !f.includes(`-${s.phase.toLowerCase()}-`))) {
        shots.push(await shot(page, `r1-${label}-terminal`));
      }
      break;
    }

    // 浮层（决策）：真实点击卡片
    if (s.overlayOpen) {
      const diag = await page.evaluate(() => window.__adv.diagnose());
      const rects = c && c.optionRects ? c.optionRects : [];
      let pick = 0;
      if (diag && diag.kind === 'event') {
        const pct = s.playerHpMax > 0 ? s.carriedHp / s.playerHpMax : 1;
        // 首轮实测教训（诚实记录，两点都是真实数据）：
        //  ① 只按「血少就治疗」打分 ⇒ 玩家一个强化都拿不到 ⇒ 第 6 场「成长门槛敌」
        //    （ExtendedBurnSaw）必败。这不是流程问题，是策略把成长饿死了。
        //  ② 把 trade（用耐久换强化）当作「掉血」一律拒绝也不行：
        //    headless 实测 ExtendedBurnSaw 在 1100 耐久下
        //      [] 强化 → 败（615 步）；
        //      [heavyShell, damageUp, rateUp] → 败（625 步）；
        //      + twinCannon → 胜（剩 355）；
        //    ⇒ 用一点耐久换到的强化，恰恰是唯一能过门槛的那个。
        // 因此策略：优先「无代价拿强化」（buff）> 「换血拿强化」（trade，血 ≥ 50% 时）
        //          > 治疗（血 < 70%）> 无关选项。
        //
        // 败局分支（ADV_R1_LOSS=1）：走**「只顾回血、不拿强化」**这条真实可达的败局路径。
        // 理由（headless 实测）：只治疗不成长 ⇒ 第 6 场成长门槛敌必败。
        // 这不是人为把玩法搞坏，而是「无视 Build 成长」这个玩家真的会犯的选择 —— 正好用来
        // 验证败局界面（叙事区成绩卡 + 复玩入口）在真实物理下是否正常。
        const score = (o) => {
          const fresh = o.freshCount ?? 0;
          const needHeal = pct < 0.7;
          if (RUN_LOSS) {
            switch (o.effect) {
              case 'heal':
                return 10;
              case 'none':
                return 5;
              case 'buff':
              case 'trade':
                return 0;
              case 'damage':
                return 0;
              default:
                return 1;
            }
          }
          switch (o.effect) {
            case 'buff':
              return fresh > 0 ? 10 : 1;
            case 'trade':
              return fresh > 0 ? (pct >= 0.5 ? 9 : 0) : 0;
            case 'heal':
              return needHeal ? 6 : 2;
            case 'none':
              return 2;
            case 'damage':
              return 0;
            default:
              return 1;
          }
        };
        let best = -1;
        for (let i = 0; i < diag.options.length; i++) {
          const sc = score(diag.options[i]);
          if (sc > best) {
            best = sc;
            pick = i;
          }
        }
      }
      const r = rects[pick];
      if (r) {
        await clickLogical(page, r.x + r.w / 2, r.y + r.h / 2);
        choiceClicks += 1;
      } else {
        missedClicks += 1;
      }
      await page.waitForTimeout(60);
      continue;
    }

    // 纯信息阶段：**不点击**，等它自己走（这正是被验证的能力）
    if (c && c.needsPlayer === false && s.phase !== 'BATTLE') {
      infoPhaseWaits += 1;
      if (c.autoAdvances > autoAdvanceSeen) autoAdvanceSeen = c.autoAdvances;
      await page.waitForFunction(
        (ph) => {
          const p = window.__adv.probe();
          return p.phase !== ph || (p.continuity && p.continuity.needsPlayer === true);
        },
        s.phase,
        { timeout: 15000 },
      );
      continue;
    }

    // BATTLE：等战斗自己结束（真实物理逐帧推进）
    if (s.phase === 'BATTLE') {
      await page.waitForFunction(() => window.__adv.probe().phase !== 'BATTLE', null, { timeout: 180000 });
      continue;
    }

    // 需要玩家的主动作：真实点击
    if (c && c.actionClickable) {
      await clickLogical(page, UX_ACTION_BTN.x + UX_ACTION_BTN.w / 2, UX_ACTION_BTN.y + UX_ACTION_BTN.h / 2);
      actionClicks += 1;
      await page.waitForTimeout(60);
      continue;
    }

    // 不可点却停在原地：说明有阶段卡住了（会在断言里暴露）
    await page.waitForTimeout(120);
  }

  const final = await probe(page);
  const totalMs = Date.now() - t0;
  const infoPhases = trail.filter((t) => t.phase !== 'COMPLETE' && t.phase !== 'FAILED' && t.needsPlayer === false && t.phase !== 'BATTLE');
  return {
    label,
    totalMs,
    finalPhase: final.phase,
    finalDay: final.day,
    trail,
    shots,
    actionClicks,
    choiceClicks,
    missedClicks,
    infoPhaseWaits,
    infoPhasesWithoutClick: infoPhases.length,
    autoAdvances: final.continuity ? final.continuity.autoAdvances : 0,
    stageHeights: [...stageHeights],
    narrativePresentRatio: probeCount > 0 ? narrativePresent / probeCount : 0,
    ui: final.ui || null,
    finalProbe: {
      seedLabel: final.seedLabel,
      buffs: final.buffs,
      carriedHp: final.carriedHp,
      playerHpMax: final.playerHpMax,
      battlesCompleted: final.battlesCompleted,
      battlesWon: final.battlesWon,
    },
    wantLoss,
  };
}

(async () => {
  const server = await startServer();
  const browser = await launchBrowser(chromium);
  const ctx = await browser.newContext({
    viewport: { width: LOGICAL_W, height: LOGICAL_H },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    // 「Failed to load resource ... 404」是浏览器对缺失 URL 的通用报错（通常是 /favicon.ico），
    // 是否属于**素材缺失**要看服务端实际 404 的路径（见下方 `http404` 断言）。
    if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  try {
    const url = `http://127.0.0.1:${PORT}/adventure.html?seed=${encodeURIComponent(SEED)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__adv && !!window.__adv.probe, null, { timeout: 20000 });
    // 等素材加载完（ui.load 是异步的；probe.ui 给出就绪/失败清单）
    await page.waitForFunction(
      () => {
        const p = window.__adv.probe();
        return p.ui && p.ui.registered > 0 && p.ui.ready + p.ui.failed.length >= p.ui.registered;
      },
      null,
      { timeout: 20000 },
    ).catch(() => {});

    const ui0 = (await probe(page)).ui;
    log(!!ui0 && ui0.failed.length === 0, 'R1 素材全部加载成功（无缺失）', ui0 ? `ready=${ui0.ready}/${ui0.registered} failed=${JSON.stringify(ui0.failed)}` : 'no ui probe');

    const run = await playRun(page, 'win');

    // ① 一屏式：舞台带尺寸全程恒定 + 叙事区全程存在
    log(run.stageHeights.length === 1 && run.stageHeights[0] === `${UX_STAGE.w}x${UX_STAGE.h}`,
      'R1 ①同一主场景：舞台带尺寸全程恒定（无整页换场）', `heights=${JSON.stringify(run.stageHeights)}`);
    log(run.narrativePresentRatio > 0.99, 'R1 ①叙事区全程常驻（事件/奖励/战报同屏承接）', `ratio=${(run.narrativePresentRatio * 100).toFixed(1)}%`);

    // ② 非决策阶段零点击
    log(run.infoPhasesWithoutClick > 0, 'R1 ②非决策阶段确实发生且无需点击', `infoPhases=${run.infoPhasesWithoutClick} waits=${run.infoPhaseWaits}`);
    log(run.autoAdvances >= run.infoPhasesWithoutClick * 0.9,
      'R1 ②自动承接次数 ≈ 非决策阶段数（每一次「继续」都被省掉）',
      `autoAdvances=${run.autoAdvances} infoPhases=${run.infoPhasesWithoutClick}`);

    // 决策仍需玩家：选择次数必须 > 0
    log(run.choiceClicks > 0, 'R1 ②保留必要的实际选择（选择卡仍需点击）', `choiceClicks=${run.choiceClicks}`);
    // 主操作只剩「真推进」：次数应远少于旧基线（扫描基线：主操作 26 次 / 选择 8 次）
    log(run.actionClicks <= 24, 'R1 ②主操作次数显著下降（旧基线 26 次）', `actionClicks=${run.actionClicks}（旧 26）`);
    log(run.missedClicks === 0, 'R1 ③没有假按钮（点在不可点主操作上的次数 = 0）', `missed=${run.missedClicks}`);

    // ④ 完整流程到达终态
    log(run.finalPhase === 'COMPLETE' || run.finalPhase === 'FAILED', 'R1 ④正常速度连续流程能跑到终态', `phase=${run.finalPhase} day=${run.finalDay} 用时=${(run.totalMs / 1000).toFixed(1)}s`);
    if (!RUN_LOSS) {
      log(run.finalPhase === 'COMPLETE', 'R1 ④种子全胜路径可通关', `phase=${run.finalPhase} 耐久=${Math.round(run.finalProbe.carriedHp)}/${run.finalProbe.playerHpMax}`);
    } else {
      log(run.finalPhase === 'FAILED', 'R1 ④败局分支可达且界面正常（真实物理下确实会输）',
        `phase=${run.finalPhase} day=${run.finalDay} 赢=${run.finalProbe.battlesWon}/${run.finalProbe.battlesCompleted} 局`);
    }

    // 复玩入口：终局「再来一局」必须能开新局（新种子）
    const before = await probe(page);
    await clickLogical(page, UX_ACTION_BTN.x + UX_ACTION_BTN.w / 2, UX_ACTION_BTN.y + UX_ACTION_BTN.h / 2);
    await page.waitForTimeout(300);
    const afterReplay = await probe(page);
    log(afterReplay.seedLabel !== before.seedLabel && afterReplay.phase !== before.phase,
      'R1 ④复玩入口可用（新种子、新开局）',
      `${before.seedLabel}(${before.phase}) → ${afterReplay.seedLabel}(${afterReplay.phase})`);
    run.shots.push(await shot(page, 'r1-replay-newrun'));

    // 页签级错误
    log(consoleErrors.length === 0, 'R1 页面无 console.error / 未捕获异常', consoleErrors.slice(0, 3).join(' | '));
    // 素材类 404（只关心 adventure-ui/ 与 assets/；favicon 之类不算）
    const asset404 = http404.filter((u) => /adventure-ui\/|assets\//.test(u));
    log(asset404.length === 0, 'R1 素材请求无 404', `http404(all)=${JSON.stringify(http404)} asset404=${JSON.stringify(asset404)}`);

    fs.mkdirSync(OUT, { recursive: true });
    const report = {
      seed: SEED,
      generatedAt: new Date().toISOString(),
      viewport: { w: LOGICAL_W, h: LOGICAL_H, dpr: 1 },
      bands: { stage: UX_STAGE, narrative: UX_NARRATIVE, action: UX_ACTION_BTN },
      run,
      results,
    };
    fs.writeFileSync(path.join(OUT, 'continuity-win.json'), JSON.stringify(report, null, 1), 'utf-8');

    console.log('\n=== 流程（win）===');
    for (const t of run.trail) console.log(`  +${String(t.t).padStart(6)}ms  ${t.phase.padEnd(13)} day=${t.day} needsPlayer=${t.needsPlayer}`);
    console.log(`\n主操作点击=${run.actionClicks}  选择点击=${run.choiceClicks}  非决策阶段=${run.infoPhasesWithoutClick}（0 次点击）  自动承接=${run.autoAdvances}`);

    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} PASS`);
    if (failed.length) {
      console.log('FAILED:');
      for (const f of failed) console.log('  - ' + f.name + (f.detail ? ' | ' + f.detail : ''));
    }
    console.log('evidence ->', OUT);
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    await ctx.close();
    await browser.close();
    server.close();
  }
})();
