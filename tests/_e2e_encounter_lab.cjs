/**
 * PRP-M3-ENCOUNTER-BATCH-01｜遭遇验证台的**浏览器真实闭环**。
 *
 * 手段（与既有 PRP E2E 同源，不伪造任何步骤）：
 *   - 真实浏览器（playwright-core / msedge，回退默认 chromium）打开独立产物
 *     `dist-portrait-lab/encounter-lab.html`；
 *   - 真实鼠标点击（page.mouse.click，取按钮真实 getBoundingClientRect 中心）；
 *   - 真实像素读取（canvas.getContext('2d').getImageData，**精确 RGB 相等**统计）；
 *   - 只读诊断句柄 `window.__ENCOUNTERLAB__`。
 *
 * 它验证的是本 Queue 的四条技术验收（Content Batch，不做平衡）：
 *
 *   ① 三种 Encounter **可独立启动**：点一个 → 真实战斗 → 打到结束 → 战场冻结
 *   ② 切换前一场**必须完全 cleanup**：老的运行时被 dispose、控件计数递增、
 *      新的开局读数完全干净（步数 0 / 时间 0 / 存活弹丸 0 / 接触·命中·伤害全 false）
 *   ③ **不存在 Projectile / Contact / Runtime 残留**：每一场的 `fresh` 读数逐项干净，
 *      且 Reset 后舞台回到纯色待机面（真实像素证据）
 *   ④ 玩家条件不变：同一个 `WatermelonHeavyCannon`、满耐久、无 Run Buff、正式 spawn
 *
 * 用法：
 *   npm run build:portrait-lab
 *   node tests/_e2e_encounter_lab.cjs        （或 npm run e2e:encounter-lab）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

/** ⚠️ 与 run-page(8156) / next-run(8157) 用**不同端口**：三个 E2E 可并存。 */
const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8158;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const PAGE_URL = `${URL_BASE}/encounter-lab.html`;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
};

/** 舞台带几何（= `runPageLayout.RUN_STAGE_BAND` 的浏览器侧镜像：y=80 / h=302 / w=390）。 */
const BAND = { x: 0, y: 80, w: 390, h: 302 };
/** 待机舞台底色（= `encounterLab.COLORS.stageBg`）—— Reset 后舞台必须回到这个纯色。 */
const STAGE_BG = [0x0d, 0x11, 0x19];

/** 三个 Encounter 的正式期望（label / 模板 id / 验证目标 / 对手耐久上限）。 */
const EXPECT = [
  { id: 'ProtoRusher', label: '菠萝冲刺车', template: 'R1-RUSH-02', enemyHpMax: 1000 },
  { id: 'Chaser', label: '追猎者', template: 'OPP-16', enemyHpMax: 900 },
  { id: 'RangedTurret', label: '远程炮台', template: 'OPP-03', enemyHpMax: 1100 },
];

/** 正式世界 / 出生 / 玩家条件（三套必须完全一致）。 */
const COMMON = {
  arenaWidth: 1600,
  arenaHeight: 900,
  groundY: 700,
  spawnAx: 400,
  spawnBx: 1200,
  spawnSeparation: 800,
  playerHpMax: 1100,
  initialPlayerHp: 1100,
};

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}

function startServer() {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/encounter-lab.html';
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

const probeOf = (page) => page.evaluate(() => window.__ENCOUNTERLAB__.probe());

/** 真实鼠标点击一个测试控件（取真实 DOM 矩形中心，不直调业务方法）。 */
async function clickControl(page, id) {
  const box = await page.evaluate((wanted) => {
    const b = document.querySelector(`.elab-btn[data-elab-id="${wanted}"]`);
    if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }, id);
  if (!box) throw new Error('控件不存在：' + id);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(60);
  return box;
}

/** 舞台带的真实像素统计（精确 RGB 相等 + 不同色数）。 */
function bandStats(page, target) {
  return page.evaluate(
    ({ band, t }) => {
      const c = document.querySelector('#elab-canvas');
      const ctx = c.getContext('2d');
      const s = c.width / 390;
      const x = Math.floor(band.x * s);
      const y = Math.floor(band.y * s);
      const w = Math.floor(band.w * s);
      const h = Math.floor(band.h * s);
      const d = ctx.getImageData(x, y, w, h).data;
      let exact = 0;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] === t[0] && d[i + 1] === t[1] && d[i + 2] === t[2]) exact += 1;
        seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      }
      return { exact, distinct: seen.size, total: w * h };
    },
    { band: BAND, t: target },
  );
}

/** 等待当前这一场真的打完（真实物理时间；三阶段合计约 18s）。 */
async function waitDone(page, timeout = 90000) {
  await page.waitForFunction(() => window.__ENCOUNTERLAB__.probe().phase === 'done', null, { timeout });
}

/**
 * 开局读数的**残留判据**（浏览器侧独立实现一遍，不复用 src 的判断逻辑）。
 * 返回问题清单（空 = 干净）。
 */
function freshProblems(fresh, expectId) {
  const p = [];
  if (!fresh) return ['fresh 为空'];
  if (fresh.encounterId !== expectId) p.push(`encounterId=${fresh.encounterId} 期望 ${expectId}`);
  if (!Array.isArray(fresh.buildIds) || fresh.buildIds.length !== 0) p.push(`buildIds=${JSON.stringify(fresh.buildIds)} 期望 []`);
  if (fresh.initialPlayerHp !== fresh.playerHpMax) p.push(`耐久 ${fresh.initialPlayerHp}/${fresh.playerHpMax} 非满`);
  if (fresh.initialPlayerHp !== COMMON.initialPlayerHp) p.push(`耐久上限 ${fresh.initialPlayerHp} 期望 ${COMMON.initialPlayerHp}`);
  if (fresh.steps !== 0) p.push(`steps=${fresh.steps}`);
  if (fresh.timeMs !== 0) p.push(`timeMs=${fresh.timeMs}`);
  if (fresh.projectiles !== 0) p.push(`存活弹丸=${fresh.projectiles}`);
  if (fresh.contact || fresh.impact || fresh.damage) {
    p.push(`残留 contact=${fresh.contact} impact=${fresh.impact} damage=${fresh.damage}`);
  }
  for (const k of Object.keys(COMMON)) {
    if (fresh[k] !== COMMON[k]) p.push(`${k}=${fresh[k]} 期望 ${COMMON[k]}`);
  }
  if (!(fresh.gapWorld > 0)) p.push(`开局外廓间距=${fresh.gapWorld}（必须 > 0，两车分离）`);
  return p;
}

async function openPage(browser, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  await page.goto(PAGE_URL, { waitUntil: 'load' });
  await page.waitForFunction(
    () => {
      const c = document.querySelector('#elab-canvas');
      if (!window.__ENCOUNTERLAB__ || !c || c.width === 0) return false;
      const p = window.__ENCOUNTERLAB__.probe();
      return p.assets.ready >= 5 && p.assets.failed.length === 0 && p.screen.width > 0;
    },
    null,
    { timeout: 30000 },
  );
  return { ctx, page, pageErrors };
}

/* ======================================================== 视口 1：完整流程 */

async function runFullFlow(browser) {
  const tag = 'M3';
  const { ctx, page, pageErrors } = await openPage(browser, { w: 390, h: 844, dpr: 1 });
  try {
    /* ---- 页面结构 ---- */
    const p0 = await probeOf(page);
    log(p0.title === '遭遇验证台', `[${tag}] A1 页面标题正确`, p0.title);
    log(
      p0.lead.includes('只换对手'),
      `[${tag}] A2 副标题点明「只换对手」`,
      p0.lead,
    );
    log(
      p0.loadoutId === 'WatermelonHeavyCannon' && p0.playerHpMax === 1100,
      `[${tag}] A3 玩家固定 WatermelonHeavyCannon 满耐久`,
      `loadout=${p0.loadoutId} hpMax=${p0.playerHpMax} ${p0.playerBodyName}`,
    );
    log(
      JSON.stringify(p0.batch.map((b) => b.id)) === JSON.stringify(EXPECT.map((e) => e.id)),
      `[${tag}] A4 批次恰好三个既有 Encounter（顺序一致）`,
      p0.batch.map((b) => b.id).join(','),
    );
    const batchOk = EXPECT.every((e, i) => {
      const b = p0.batch[i];
      return b.label === e.label && b.templateId === e.template && b.count === 1 && b.verifies.length > 0;
    });
    log(batchOk, `[${tag}] A5 三个 Encounter 的展示名 / 正式模板 id / 验证目标全部来自正式链路`,
      p0.batch.map((b) => `${b.id}=${b.label}[${b.templateId}]`).join(' '));

    /* ---- 控件（Queue 必改 3：只允许三个对手 + Reset） ---- */
    const dom = await page.evaluate(() => {
      const bar = document.querySelector('.elab-bar');
      const btns = Array.from(document.querySelectorAll('.elab-btn'));
      return {
        barChildren: bar ? bar.children.length : -1,
        count: btns.length,
        texts: btns.map((b) => b.textContent),
        sources: btns.map((b) => b.dataset.elabControl),
        ids: btns.map((b) => b.dataset.elabId),
        outsideStage: bar ? !document.querySelector('.elab-stage').contains(bar) : false,
      };
    });
    log(dom.count === 4 && dom.barChildren === 4, `[${tag}] A6 测试控件恰好 4 个（三个对手 + Reset）`, `count=${dom.count}`);
    log(
      JSON.stringify(dom.texts) === JSON.stringify(['菠萝冲刺车', '追猎者', '远程炮台', 'Reset']),
      `[${tag}] A7 控件文案 = 三个对手 + Reset`,
      dom.texts.join(' / '),
    );
    log(
      JSON.stringify(dom.sources) === JSON.stringify(['encounter', 'encounter', 'encounter', 'reset']),
      `[${tag}] A8 控件类型只允许 encounter / reset`,
      dom.sources.join(','),
    );
    log(dom.outsideStage, `[${tag}] A9 测试控件不在画布里（画布只画战场）`);
    log(
      JSON.stringify(p0.controls.map((c) => c.id)) === JSON.stringify([...EXPECT.map((e) => e.id), 'reset']),
      `[${tag}] A10 探针里的控件清单与 DOM 一致`,
      p0.controls.map((c) => c.id).join(','),
    );

    /* ---- 初始 idle ---- */
    log(
      p0.phase === 'idle' && p0.runtimeActive === false && p0.active === null && p0.runtimeSerial === 0 && p0.rounds.length === 0,
      `[${tag}] A11 初始 idle：无运行时 / 未选对手 / 无战果`,
      `phase=${p0.phase} serial=${p0.runtimeSerial}`,
    );
    const idleStats = await bandStats(page, STAGE_BG);
    log(
      idleStats.exact / idleStats.total > 0.9,
      `[${tag}] A12 idle 舞台是纯色待机面（真实像素）`,
      `exact=${idleStats.exact}/${idleStats.total} distinct=${idleStats.distinct}`,
    );

    /* ---- 三个 Encounter 依次切换：真实战斗跑到结束 ---- */
    const outcomes = [];
    for (let i = 0; i < EXPECT.length; i++) {
      const e = EXPECT[i];
      await clickControl(page, e.id);
      const p = await probeOf(page);
      const problems = freshProblems(p.fresh, e.id);
      log(problems.length === 0, `[${tag}] B${i + 1}.1 切到 ${e.id}：开局读数完全干净（无 Projectile·Contact·Runtime 残留）`,
        problems.length ? problems.join(' | ') : `steps=0 proj=0 contact=false spawn=${p.fresh.spawnAx}/${p.fresh.spawnBx}`);
      log(
        p.active === e.id && p.runtimeActive === true && p.runtimeSerial === i + 1 && p.disposedCount === i,
        `[${tag}] B${i + 1}.2 切换语义：新实例 + 上一场已 dispose`,
        `serial=${p.runtimeSerial} disposed=${p.disposedCount} active=${p.active}`,
      );
      log(
        p.fresh.enemyHpMax === e.enemyHpMax,
        `[${tag}] B${i + 1}.3 对手耐久上限 = 正式值（零修改）`,
        `enemyHpMax=${p.fresh.enemyHpMax} 期望 ${e.enemyHpMax}`,
      );

      await waitDone(page);
      const done = await probeOf(page);
      const rec = done.rounds[done.rounds.length - 1];
      log(
        done.phase === 'done' && rec.encounterId === e.id && rec.steps > 0 && rec.winner !== undefined,
        `[${tag}] B${i + 1}.4 ${e.id} 真实打到结束（战场冻结）`,
        `steps=${rec.steps} ${(rec.timeMs / 1000).toFixed(1)}s playerHp=${rec.playerHp}/${rec.playerHpMax} enemyHp=${rec.enemyHp}/${rec.enemyHpMax} winner=${rec.winner} reason=${rec.endReason}`,
      );
      log(
        done.rounds.length === i + 1,
        `[${tag}] B${i + 1}.5 战果计数 = ${i + 1}（每场独立记账）`,
        `rounds=${done.rounds.length}`,
      );
      outcomes.push(rec);

      // 结束帧的真实像素：舞台带必须"有内容"（不是一块纯色）
      const doneStats = await bandStats(page, STAGE_BG);
      log(
        doneStats.distinct > 40,
        `[${tag}] B${i + 1}.6 舞台带真的画出了战斗（真实像素：色数远多于纯色面）`,
        `distinct=${doneStats.distinct} 待机底色像素=${doneStats.exact}`,
      );
    }

    /* ---- 三场互相不同（不同敌人 = 不同过程）---- */
    const keys = outcomes.map((o) => `${o.steps}|${o.playerHp}|${o.enemyHp}|${o.winner}`);
    log(
      new Set(keys).size >= 2,
      `[${tag}] C1 三场过程读数不完全相同（不同敌人确实不同）`,
      outcomes.map((o) => `${o.encounterId}:${o.steps}步/玩家${o.playerHp}/敌${o.enemyHp}`).join(' · '),
    );
    log(
      outcomes.every((o) => o.playerHpMax === 1100 && o.enemyHpMax === [1000, 900, 1100][outcomes.indexOf(o)]),
      `[${tag}] C2 三场玩家耐久上限恒 1100（同一玩家条件）`,
      outcomes.map((o) => `${o.encounterId}:${o.playerHpMax}`).join(' '),
    );

    /* ---- Reset：无状态残留 ---- */
    const before = await probeOf(page);
    await clickControl(page, 'reset');
    const after = await probeOf(page);
    const resetOk =
      after.phase === 'idle' &&
      after.runtimeActive === false &&
      after.active === null &&
      after.fresh === null &&
      after.live === null &&
      after.rounds.length === 0 &&
      after.disposedCount === before.disposedCount + 1 &&
      after.resetCount === before.resetCount + 1 &&
      after.runtimeSerial === before.runtimeSerial;
    log(resetOk, `[${tag}] D1 Reset 清空全部状态（无残留）`,
      `phase=${after.phase} active=${after.active} rounds=${after.rounds.length} disposed=${after.disposedCount} serial=${after.runtimeSerial}`);
    const resetStats = await bandStats(page, STAGE_BG);
    log(
      resetStats.exact / resetStats.total > 0.9,
      `[${tag}] D2 Reset 后舞台回到纯色待机面（真实像素证据）`,
      `exact=${resetStats.exact}/${resetStats.total} distinct=${resetStats.distinct}`,
    );

    /* ---- Reset 后可重开（弹性）---- */
    await clickControl(page, 'ProtoRusher');
    const reopen = await probeOf(page);
    const reopenProblems = freshProblems(reopen.fresh, 'ProtoRusher');
    log(
      reopenProblems.length === 0 && reopen.runtimeSerial === before.runtimeSerial + 1,
      `[${tag}] D3 Reset 后可立刻重开（同一对手仍是干净开局）`,
      reopenProblems.length ? reopenProblems.join(' | ') : `serial=${reopen.runtimeSerial}`,
    );
    await waitDone(page);
    const reopened = await probeOf(page);
    log(reopened.rounds.length === 1, `[${tag}] D4 重开后战果重新从 1 开始计数`, `rounds=${reopened.rounds.length}`);

    log(pageErrors.length === 0, `[${tag}] E1 页面无运行期异常`, pageErrors.length ? pageErrors.join(' | ') : '0 errors');
  } finally {
    await ctx.close();
  }
}

/* ========== F. PBL-FOUNDATION-RANGED-DISTANCE-CONTROL-R1（远程敌人的距离维持） ==========
 *
 * 本段用**真实浏览器 + 真实物理**验证「远程炮台在维持作战距离」这件事在页面上真的发生：
 *   F1 未声明 `enemyDrive` 的两套（ProtoRusher / Chaser）全程**没有**距离档 ⇒ 零变化；
 *   F2 RangedTurret 一局里 near / hold / far 三档**全部出现**（分段是活的）；
 *   F3 每档真实读到的 core 间距与档位契约一致（页面显示的就是决策本身）；
 *   F4 near 之后间距真的重新变大（「主动后撤拉开」是事实）；
 *   F5 仍然可以被追上（间距压到接触级）。
 *
 * ⚠️ 下面的 240 / 480 是 `src/battle/enemyDrive.ts` 的**粗档声明值**在浏览器侧的镜像
 *    （由正式 cannon 的 muzzleSpeed 8 × 一轮冷却 60 步 = 480 推出，near = 半个行程）。
 *    与本文件既有的「面积期望值内联」同口径：E2E 不 import src，只独立复核。
 */
const ENEMY_NEAR = 240;
const ENEMY_FAR = 480;

async function runDistanceFoundation(browser) {
  const tag = 'RDC';
  const { ctx, page, pageErrors } = await openPage(browser, { w: 390, h: 844, dpr: 1 });
  try {
    /* ---- F1：未声明的两套全程无距离档 ---- */
    for (const id of ['ProtoRusher', 'Chaser']) {
      await clickControl(page, id);
      const seen = new Set();
      let samples = 0;
      for (let i = 0; i < 14; i++) {
        const p = await probeOf(page);
        if (p.phase === 'done') break;
        if (p.live) {
          seen.add(String(p.live.enemyDriveBand));
          samples += 1;
        }
        await page.waitForTimeout(120);
      }
      log(
        samples > 0 && seen.size === 1 && seen.has('null'),
        `[${tag}] F1 ${id} 未声明 enemyDrive：全程无距离档（对手驱动与改前逐帧相同）`,
        `samples=${samples} bands=${[...seen].join(',')}`,
      );
      await clickControl(page, 'reset');
    }

    /* ---- F2~F5：RangedTurret 一局的档位轨迹 ---- */
    await clickControl(page, 'RangedTurret');
    const samples = [];
    const t0 = Date.now();
    for (;;) {
      const p = await probeOf(page);
      if (p.phase === 'done') break;
      if (p.live) {
        samples.push({
          band: p.live.enemyDriveBand,
          coreGap: p.live.enemyDriveGap,
          gap: p.live.gapWorld,
          steps: p.live.steps,
        });
      }
      if (Date.now() - t0 > 90000) break;
      await page.waitForTimeout(100);
    }
    const done = await probeOf(page);

    const bands = [...new Set(samples.map((s) => String(s.band)))];
    log(
      samples.length > 20 && bands.length === 3 && ['far', 'hold', 'near'].every((b) => bands.includes(b)),
      `[${tag}] F2 RangedTurret 一局内 near / hold / far 三档全部真实出现`,
      `samples=${samples.length} bands=${bands.join(',')} 步数=${samples[samples.length - 1] && samples[samples.length - 1].steps}`,
    );

    // F3：逐样本核对「页面显示的档位」与「它读到的 core 间距」是否自洽
    const violations = samples.filter((s) => {
      if (s.coreGap === null) return true;
      if (s.band === 'near') return !(s.coreGap < ENEMY_NEAR);
      if (s.band === 'far') return !(s.coreGap > ENEMY_FAR);
      return !(s.coreGap >= ENEMY_NEAR && s.coreGap <= ENEMY_FAR);
    });
    log(
      violations.length === 0,
      `[${tag}] F3 每个样本的档位都与真实 core 间距自洽（page 显示的就是决策本身）`,
      violations.length
        ? violations.slice(0, 3).map((v) => `${v.band}/${v.coreGap}`).join(' ')
        : `${samples.length} 个样本全部自洽`,
    );

    // F4：near 之后间距必须重新变大
    const firstNear = samples.findIndex((s) => s.band === 'near');
    const gapAtNear = firstNear >= 0 ? samples[firstNear].gap : NaN;
    const afterNear = firstNear >= 0 ? samples.slice(firstNear).map((s) => s.gap) : [];
    const peakAfter = afterNear.length ? Math.max(...afterNear) : NaN;
    log(
      firstNear > 0 && peakAfter > gapAtNear + 40,
      `[${tag}] F4 玩家接近 → 对手主动后撤 → 双方重新拉开（Queue 的核心可读行为）`,
      `首次 near 于第 ${firstNear} 个样本 · 外廓间距 ${Number(gapAtNear).toFixed(0)}px → 峰值 ${Number(peakAfter).toFixed(0)}px`,
    );

    // F5：仍然可以被追上（无硬隔离）
    const minGap = samples.length ? Math.min(...samples.map((s) => s.gap)) : NaN;
    const rec = done.rounds[done.rounds.length - 1];
    log(
      minGap < 20 && rec.enemyHp < rec.enemyHpMax,
      `[${tag}] F5 可以被玩家追上：间距压到接触级，且对手真的掉血（无硬隔离 / 无无敌）`,
      `最小外廓间距=${Number(minGap).toFixed(1)}px 敌耐久=${rec.enemyHp}/${rec.enemyHpMax} 步数=${rec.steps}`,
    );

    log(pageErrors.length === 0, `[${tag}] F6 本段无运行期异常`, pageErrors.length ? pageErrors.join(' | ') : '0 errors');
  } finally {
    await ctx.close();
  }
}

/* ============================================ 视口 2：非 1 DPR 结构验证 */

async function runStructural(browser) {
  const tag = 'S';
  const { ctx, page, pageErrors } = await openPage(browser, { w: 1280, h: 720, dpr: 1.5 });
  try {
    const p = await probeOf(page);
    log(
      p.canvas.backingW === Math.round(390 * 1.5) && p.canvas.backingH === Math.round(844 * 1.5),
      `[${tag}] S1 画布 backing = 逻辑 × DPR（390×844@1.5 → 585×1266）`,
      `${p.canvas.backingW}×${p.canvas.backingH}`,
    );
    log(p.screen.width > 0 && p.screen.dpr === 1.5, `[${tag}] S2 屏幕 rect 真实（contain 缩放）`,
      `w=${p.screen.width.toFixed(1)} scale=${p.screen.scale.toFixed(3)} dpr=${p.screen.dpr}`);
    log(p.batch.length === 3 && p.controls.length === 4, `[${tag}] S3 结构与非 1 DPR 无关`, `batch=${p.batch.length} controls=${p.controls.length}`);

    await clickControl(page, 'Chaser');
    const after = await probeOf(page);
    const problems = freshProblems(after.fresh, 'Chaser');
    log(problems.length === 0, `[${tag}] S4 非 1 DPR 下开局读数同样干净`, problems.length ? problems.join(' | ') : 'clean');
    await waitDone(page);
    const done = await probeOf(page);
    log(done.phase === 'done' && done.rounds.length === 1, `[${tag}] S5 非 1 DPR 下也能真实打到结束`,
      `steps=${done.rounds[0] ? done.rounds[0].steps : -1}`);
    log(pageErrors.length === 0, `[${tag}] S6 页面无运行期异常`, pageErrors.length ? pageErrors.join(' | ') : '0 errors');
  } finally {
    await ctx.close();
  }
}

/* ============================================================== 主流程 */

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

    await runFullFlow(browser);
    await runDistanceFoundation(browser);
    await runStructural(browser);

    // 隔离：独立产物内不含正式入口；测试控件不进入玩家页面
    const idx = await fetch(`${URL_BASE}/index.html`);
    log(idx.status === 404, '[iso] J1 独立产物内不含正式入口 index.html', `status=${idx.status}`);
    const html = fs.readFileSync(path.join(ROOT, 'encounter-lab.html'), 'utf8');
    const chunkMatch = html.match(/assets\/(encounter-lab[-.\w]*\.js)/);
    log(!!chunkMatch, '[iso] J2 encounter-lab.html 真实引用了自己的 chunk（不是陈旧产物）', chunkMatch ? chunkMatch[1] : 'none');
    if (chunkMatch) {
      const bytes = fs.readFileSync(path.join(ROOT, 'assets', chunkMatch[1]), 'utf8');
      const leaked = ['playerGameRuntime', 'canvasPlayerUIHost', 'webDomPlayerUIHost', 'garageFusion', 'bootstrap-wechat'].filter(
        (n) => bytes.includes(n),
      );
      log(
        leaked.length === 0,
        '[iso] J3 验证台 chunk 内不含正式玩家 Runtime',
        leaked.length ? `命中=${leaked.join(',')}` : `扫描 ${bytes.length}B`,
      );
    }
    const playerHtml = fs.readFileSync(path.join(ROOT, 'run-page.html'), 'utf8');
    log(
      !playerHtml.includes('<button'),
      '[iso] J4 玩家页面（run-page.html）里没有任何 <button>（测试控件未进入玩家 UI）',
      `扫描 ${playerHtml.length}B`,
    );
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log('\n============================');
  console.log(`E2E Encounter Lab: ${results.length - failed.length}/${results.length} PASS`);
  console.log('============================');
  if (failed.length) {
    for (const f of failed) console.log('FAILED: ' + f.name + ' | ' + f.detail);
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
