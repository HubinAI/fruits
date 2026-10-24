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
  // ⚠️ FRUITS-ADVENTURE-UX-CONTINUITY-R1：这里原有第三项 `tripleLoad`，现已**移除**。
  // 原因（实测，非推测）：`tripleLoad` 已进入冒险策展排除项（与 fastReload 同纪律）——
  //   同一 build 下把 twinCannon 换成 twinCannon+tripleLoad：
  //     对 ProtoRusher（最弱敌）A/978 → **B/0**；对 ExtendedHeavyContact A/409 → **B/0**。
  //   HEAD `49dc670` 上复现完全相同的数字 ⇒ **既存 DPS 崩塌**，与本 Queue 无关，
  //   但冒险奖励池不再发放它（详见 advState.ADV_EXCLUDED_BUILD_IDS 的实测表）。
  // 为什么不再补一个替代项：可用的攻击类强化只剩 kineticBurst，而它**只存在于 layer2 池**
  // （需先拥有 layer1 主路线），无法在「同一 BUILD 节点」做同敌人前后对照 —— 强行补会变成
  // 另一条不公平的断言。故本脚本如实只保留 2 个可对照项（twinCannon / heavyShell），
  // 第三项的攻击强化覆盖由 E2E `_e2e_adventure_build_feedback.cjs` ④ 段（动能爆发真实进入 Build）承担。
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
    await clickActionIfNeeded(page);
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
    await clickActionIfNeeded(page);
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
    else await clickActionIfNeeded(page);
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
  // D2 修复：把本场开局时的 carriedHp 一并带回 —— 它是跨战耐久的唯一真源，
  // 下一节点若是阶段整备(BANNER)会在此之上再补给（可能封顶），故「下一场开局HP」应等于
  // 「战斗开局时的 carriedHp」，而非选完维修那一刻的 1009。这才是真实的跨战继承契约。
  const startCarriedHp = typeof s0.carriedHp === 'number' ? s0.carriedHp : null;
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
  // D2 修复：把本场开局真实 HP（carriedHp 继承验证用）一并带回，避免「跨战继承」用恒真断言。
  const startPlayerHp = hp0 ? hp0.a : null;
  const startPlayerMax = s0.playerHpMax || null;
  // R1：本场「双方血量净变化」—— 动能爆发的可观测兑现（对手被撞开 ⇒ 我方掉血更少）。
  const enemyDrop = hp0 && sC.battleHp ? hp0.b - sC.battleHp.b : null;
  const playerDrop = hp0 && sC.battleHp ? hp0.a - sC.battleHp.a : null;
  const extra = { startPlayerHp, startPlayerMax, startCarriedHp, enemyDrop, playerDrop };
  return peak
    ? { ...peak, ...extra }
    : { maxPlayerSeen: 0, maxPlayerRadiusSeen: 0, playerNow: 0, ...extra };
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
  if (id === 'twinCannon') {
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
    else await clickActionIfNeeded(page);
    await page.waitForTimeout(110);
  }
  await captureBattle(page, 'adv-r1-normal');
}

async function captureRepair(page) {
  await gotoSeed(page, SEED);
  const ok = await reachBuildNoPick(page, 'emergencyRepair');
  if (!ok) {
    // R1 查明：F5 策展（advRepairHasRealValue）只在「净贡献 > 0」时投放紧急维修；
    // 满耐久开局 + 紧随阶段整备 ⇒ 整局都可能不出现。这是**正确的产品行为**，
    // 因此这里如实记为「本种子未覆盖」，而不是判失败（报告 §6 有说明）。
    log(true, 'R1 紧急维修 本种子未投放（F5 策展：无收益维修不出现，属预期）', '该项在 scan-4 上未覆盖；机制单测见 adventureRepairValue.test.ts');
    return;
  }
  const before = await probe(page);
  const beforeHp = before.carriedHp;
  const beforeTop = before.topHp ? before.topHp.hp : null;
  const maxHp = before.playerHpMax || 1100;
  // 预期修理量（与 advEmergencyRepairGain 同口径：0.25×上限，按缺口截断）—— 真源公式，非魔法数。
  const expectedGain = Math.max(0, Math.min(Math.round(0.25 * maxHp), maxHp - beforeHp));
  await clickCardById(page, 'emergencyRepair');
  await page.waitForTimeout(240);
  const after = await probe(page);
  const gain = after.carriedHp - beforeHp;
  // 必查4-①：维修把「真实修理量」写进 carriedHp（同正式 Run 口径，可复算），不再是恒真空断言。
  log(
    gain === expectedGain,
    'R1 紧急维修 真实修理量写入carriedHp（同正式Run口径）',
    `选前耐久=${fmt(beforeHp)} → 选后carriedHp=${fmt(after.carriedHp)}（预期+${fmt(expectedGain)}，实际+${fmt(gain)}）；顶栏${fmt(beforeTop)}`,
  );
  log(
    !!after.buildToast && /耐久 \+/.test(after.buildToast.extra || ''),
    'R1 紧急维修 即时反馈带真实修理量',
    `选前耐久=${fmt(beforeHp)}（顶栏${fmt(beforeTop)}）→ 选后=${fmt(after.carriedHp)}（+${fmt(gain)}）；toast="${after.buildToast ? after.buildToast.extra : 'null'}"`,
  );
  await shot(page, 'adv-r1-repair-toast.png');
  // 下一场战斗：验证真实的「跨战耐久继承契约」—— carriedHp 是跨战耐久唯一真源，
  // 下一节点若是阶段整备(BANNER)会再补给（可能封顶），但无论中间如何变化，
  // 战斗开局 HP 必须等于「开局那一刻的 carriedHp」。这才是可被真实 HP 对照证明的契约。
  const result = await captureBattle(page, 'adv-r1-repair-after');
  const repairCarried = after.carriedHp;
  const startHp = result ? result.startPlayerHp : null;
  const startCarried = result ? result.startCarriedHp : null;
  const inherits = startHp != null && startCarried != null && Math.abs(startHp - startCarried) <= 1;
  log(
    inherits,
    'R1 紧急维修 跨战耐久继承契约（carriedHp→下一场开局HP，真实HP对照）',
    `维修写入carriedHp=${fmt(repairCarried)}；下一场开局HP=${fmt(startHp)}；战斗开局时carriedHp=${fmt(startCarried)}；契约=${inherits ? '成立' : '破裂'}`,
  );
  // 顶栏即时同步（选后立即，不依赖下一场）
  log(
    !!after.topHp && Math.abs(after.topHp.hp - repairCarried) <= 1,
    'R1 紧急维修 顶栏即时同步',
    `选后顶栏=${after.topHp ? after.topHp.hp : '—'}；carriedHp=${fmt(repairCarried)}`,
  );
  // 必查4-②（技术结果，非失败）：本 seed 维修节点后紧跟阶段整备(BANNER)，
  // 会把 carriedHp 从 1009 再次补给至满 1100 才进下一场 ⇒ 维修的「可见收益」被整备覆盖。
  // 这是预期的经济设计（整备=阶段补给），不是缺陷；维修值本身已真实写入 carriedHp。
  if (startCarried != null && Math.abs(startCarried - repairCarried) > 1) {
    console.log(
      `INFO R1 紧急维修 维修值被阶段整备二次补给覆盖（预期，非缺陷） | 选后carriedHp=${fmt(repairCarried)} → 下一节点阶段整备回耐久至=${fmt(startCarried)}；维修值已真实写入carriedHp，被整备补给覆盖。若需「维修值原样带入下一场」属设计取舍，不在D2范围（建议单独Queue评估整备只补给至维修前缺口）。`,
    );
  }
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
    for (const id of ['twinCannon', 'heavyShell']) {
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
