/**
 * FRUITS-ADVENTURE-CAMERA-STABILITY-F6｜冒险合成镜头「连续帧稳定」真实浏览器验证。
 *
 * 与 F4 E2E 的分工：
 *   · F4 验证「自适应取景是否值得采纳」（交战更清 / 远距不裁车 / 正式相机未动）；
 *   · F6 验证「同一套自适应取景在**正常速度逐帧**下不再跳变」（P0 诊断发现的三条硬伤）。
 *
 * 严格守队列边界：不改正式 Runtime 相机 / 物理 / 碰撞 / 数值 / 节点 / 点击流程；
 * 只在页面内用 rAF 以**真实帧率**只读 `window.__adv.probe()`（不加速、不桩化、不改 dt）。
 *
 * 四条验收（对应 Queue 验收 1/2/3）：
 *   ① 交战 / 击飞阶段不出现明显画面甩动  ⇒ 逐帧 |Δzoom| / |ΔcropY| 有硬上限（旧实现 11% / 68px）；
 *   ② 战斗开始及 RESULT 切换不出现突然缩放 ⇒ 首帧已在目标附近；RESULT 主体屏宽变化 ≤ 3%
 *      （旧实现 -31%…-34%），且 RESULT 的 zoom 必须等于战斗末帧 zoom；
 *   ③ 远距分离 / 冲锋 / 击飞时双车保持可见 ⇒ 每帧 cropSafe ⊇ 双车可见部（裁到安全区后）；
 *   ④ F4 的收益不被平滑吃掉 ⇒ 交战帧 zoom ≥ 1.4（放大仍然生效）。
 *
 * 用法：
 *   node tests/_e2e_adventure_camera_f6.cjs
 *   ADV_F6_SEED=scan-4 ADV_F6_BATTLES=2 node tests/_e2e_adventure_camera_f6.cjs
 * 产物：dist-portrait-lab/adv-f6-frames.json（逐帧读数）+ adv-f6-*.png（关键帧截图）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { launchBrowser } = require('./_browser_launch.cjs');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8176;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const SEED = process.env.ADV_F6_SEED || 'scan-4';
const BATTLES = Math.max(1, Math.min(4, Number(process.env.ADV_F6_BATTLES) || 2));

const LOGICAL_W = 390;
const LOGICAL_H = 844;
const STAGE_BAND = { x: 0, y: 96, w: LOGICAL_W, h: 648 };
const ACTION_BTN = { x: 40, y: 756, w: 310, h: 68 };

/** 逐帧连续性的硬上限（正常速度 60fps；括号内为 F4 旧实现在同种子下的实测值）。 */
const LIMIT = {
  /** 主体屏宽逐帧变化 ≤ 3.5%（旧 10.03%，6 帧 >5%）——「放大跳变」的直接观感量。 */
  dSubjectPx: 3.5,
  /** 车底在屏幕上的纵向位移 ≤ 4px（旧 23.1px，14 帧 >6px）—— 地面锚定的证明。 */
  dCarScreenY: 4,
  /** 车中线在屏幕上的横向位移 ≤ 5px（旧 9.8px）。 */
  dCarScreenX: 5,
  /** 取景窗横向逐帧位移 ≤ 12px（旧 20.4px）。 */
  dCropX: 12,
  /** 取景窗缩放逐帧变化 ≤ 8%（旧 11.71%）；残余尖峰来自正式相机相位切换的补偿，见报告。 */
  dZoom: 0.08,
  /** RESULT 主体屏宽变化（相对战斗末帧）≤ 3%（旧 −31%…−34%）。 */
  resultScaleDrift: 0.03,
  /** 交战帧 zoom 下限（F4 收益）。 */
  engageZoom: 1.4,
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
const probe = (page) => page.evaluate(() => window.__adv.probe());

/**
 * 页面内逐帧记录器（真实 rAF）：只读 probe，不写任何页面状态。
 * 记录每一帧的相位 + 合成取景读数；战斗段进 `seqByBattle`，RESULT 段进 `resByBattle`。
 */
async function installRecorder(page) {
  await page.evaluate(() => {
    const rec = { frames: [], res: [], battleIdx: -1, prevPhase: null, shotBudget: 0, shotTag: '' };
    window.__f6rec = rec;
    const canvas = document.getElementById('adv-canvas');
    const grab = (tag) => {
      try {
        rec.shots = rec.shots || [];
        rec.shots.push({ tag, t: Math.round(performance.now()), data: canvas.toDataURL('image/png') });
      } catch (e) {
        /* ignore */
      }
    };
    const loop = () => {
      let p;
      try {
        p = window.__adv.probe();
      } catch (e) {
        requestAnimationFrame(loop);
        return;
      }
      const bf = p.battleFrame;
      const t = Math.round(performance.now());
      if (p.phase !== rec.prevPhase) {
        if (p.phase === 'BATTLE') rec.battleIdx += 1;
        if (p.phase === 'RESULT') {
          rec.shotTag = 'result';
          rec.shotBudget = 3;
        }
        rec.prevPhase = p.phase;
      }
      if (bf && (p.phase === 'BATTLE' || p.phase === 'RESULT')) {
        const row = {
          t,
          ph: p.phase,
          b: rec.battleIdx,
          z: bf.compositeZoom,
          tz: bf.targetZoom == null ? null : bf.targetZoom,
          cs: bf.cameraScale,
          cx: bf.cropSafe ? bf.cropSafe.x : null,
          cy: bf.cropSafe ? bf.cropSafe.y : null,
          cw: bf.cropSafe ? bf.cropSafe.w : null,
          ch: bf.cropSafe ? bf.cropSafe.h : null,
          aPxW: bf.vehicleA ? bf.vehicleA.pxW : null,
          bPxW: bf.vehicleB ? bf.vehicleB.pxW : null,
          aSafe: bf.vehicleASafe,
          bSafe: bf.vehicleBSafe,
          subj: bf.subjectSafe,
          gap: bf.gapWorld,
          band: bf.band ? bf.band.h : null,
        };
        if (p.phase === 'BATTLE') rec.frames.push(row);
        else rec.res.push(row);
      }
      if (rec.shotBudget > 0) {
        grab(rec.shotTag);
        rec.shotBudget -= 1;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}
const collectRecorder = (page) =>
  page.evaluate(() => ({
    frames: window.__f6rec.frames.slice(),
    res: window.__f6rec.res.slice(),
    shots: (window.__f6rec.shots || []).map((s) => ({ tag: s.tag, t: s.t, data: s.data })),
  }));

/** 把双车安全区矩形裁到安全区（相机允许车轮/部件探出 inset 余量，那部分原取景本来就看不到）。 */
function clipToSafe(box) {
  if (!box) return null;
  const x1 = Math.max(0, box.x);
  const y1 = Math.max(0, box.y);
  const x2 = Math.min(LOGICAL_W, box.x + box.w);
  const y2 = Math.min(STAGE_BAND.h, box.y + box.h);
  return x2 > x1 && y2 > y1 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
}
function contains(crop, box, eps = 2) {
  if (!crop || !box) return true; // 该车完全在安全区外 ⇒ 不构成「被裁切」
  return (
    box.x >= crop.x - eps &&
    box.y >= crop.y - eps &&
    box.x + box.w <= crop.x + crop.w + eps &&
    box.y + box.h <= crop.y + crop.h + eps
  );
}
const pct = (a, b) => (b ? (a / b - 1) * 100 : 0);
const max = (a) => (a.length ? a.reduce((m, x) => Math.max(m, x), -Infinity) : 0);
const p99 = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.99))];
};
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'adventure.html'))) {
    console.error('[f6] 未找到 dist-portrait-lab/adventure.html，请先 npm run build:portrait-lab');
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
    await page.waitForFunction(() => !!window.__adv && !!window.__adv.probe, null, { timeout: 20000 });
    const boot = await probe(page);
    log(boot.playerHpMax > 0, 'F6 冒险页真实加载（默认 F4 自适应 + F6 平滑）', `seed=${boot.seedLabel}；开局HP=${boot.topHp ? boot.topHp.hp : '—'}/${boot.playerHpMax}`);

    await installRecorder(page);

    // 推进到第 BATTLES 场战斗结束（每场 10–14s 真实物理，不加速）
    for (let guard = 0; guard < 1200; guard++) {
      const s = await probe(page);
      if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
      if (s.battlesCompleted >= BATTLES && s.phase !== 'BATTLE') break;
      if (s.phase === 'BATTLE') {
        await page.waitForTimeout(200);
        continue;
      }
      if (s.overlayOpen) await clickCard(page, 0);
      else await clickActionIfNeeded(page);
      await page.waitForTimeout(100);
    }
    // RESULT 以后再多留 6 帧（记录切换后的画面）
    await page.waitForTimeout(400);

    const rec = await collectRecorder(page);

    // 逐场分析
    const idx = [...new Set(rec.frames.map((f) => f.b))].sort((a, b) => a - b);
    log(idx.length >= 1, 'F6 采集到连续战斗帧', `${idx.length} 场；共 ${rec.frames.length} 帧`);

    let worstDz = 0;
    let worstDzP99 = 0;
    let worstDcy = 0;
    let worstDcx = 0;
    let worstDpx = 0;
    let worstCarY = 0;
    let worstCarX = 0;
    let engageZoom = 0;
    let cropViolations = 0;
    let resultDrift = 0;
    let resultZoomMismatch = 0;
    let startJump = 0;
    const perBattle = [];

    for (const b of idx) {
      const seq = rec.frames.filter((f) => f.b === b);
      if (seq.length < 60) continue;
      const dz = [];
      const dcy = [];
      const dcx = [];
      const dpx = [];
      const dcarY = [];
      const dcarX = [];
      // 车辆在**屏幕**上的位置（安全区 → 舞台带）：这才是「画面甩动」的直接观感量
      const carBottomY = (f) => ((f.aSafe.y + f.aSafe.h - f.cy) / f.ch) * f.band;
      const carMidX = (f) => ((f.aSafe.x + f.aSafe.w / 2 - f.cx) / f.cw) * LOGICAL_W;
      for (let i = 1; i < seq.length; i++) {
        const a = seq[i - 1];
        const c = seq[i];
        if (a.z != null && c.z != null) dz.push(Math.abs(c.z - a.z));
        if (a.cy != null && c.cy != null) dcy.push(Math.abs(c.cy - a.cy));
        if (a.cx != null && c.cx != null) dcx.push(Math.abs(c.cx - a.cx));
        if (a.aPxW && c.aPxW) dpx.push(Math.abs(c.aPxW / a.aPxW - 1));
        if (a.aSafe && c.aSafe && a.ch && c.ch) {
          dcarY.push(Math.abs(carBottomY(c) - carBottomY(a)));
          dcarX.push(Math.abs(carMidX(c) - carMidX(a)));
        }
      }
      for (const f of seq) {
        const crop = { x: f.cx, y: f.cy, w: f.cw, h: f.ch };
        if (!contains(crop, clipToSafe(f.aSafe)) || !contains(crop, clipToSafe(f.bSafe))) {
          cropViolations += 1;
        }
      }
      // 交战帧 = 本场双车世界间距最小的一帧
      const eng = seq.reduce((m, f) => (f.gap != null && f.gap < m.gap ? f : m), seq[0]);
      engageZoom = Math.max(engageZoom, eng.z || 0);

      const res = rec.res.filter((f) => f.b === b);
      const last = seq[seq.length - 1];
      const firstRes = res[0];
      if (firstRes && firstRes.aPxW && last.aPxW) {
        resultDrift = Math.max(resultDrift, Math.abs(pct(firstRes.aPxW, last.aPxW)) / 100);
        if (firstRes.z != null && last.z != null) {
          resultZoomMismatch = Math.max(resultZoomMismatch, Math.abs(firstRes.z - last.z));
        }
      }
      // 战斗首帧与目标的偏差（「开打瞬间突然缩放」的直接指标）
      if (seq[0].tz != null && seq[0].z != null) startJump = Math.max(startJump, Math.abs(seq[0].z - seq[0].tz));

      worstDz = Math.max(worstDz, max(dz));
      worstDzP99 = Math.max(worstDzP99, p99(dz));
      worstDcy = Math.max(worstDcy, max(dcy));
      worstDcx = Math.max(worstDcx, max(dcx));
      worstDpx = Math.max(worstDpx, max(dpx) * 100);
      worstCarY = Math.max(worstCarY, max(dcarY));
      worstCarX = Math.max(worstCarX, max(dcarX));
      perBattle.push({
        battle: b,
        frames: seq.length,
        durMs: seq[seq.length - 1].t - seq[0].t,
        maxDz: max(dz),
        p99Dz: p99(dz),
        maxDcy: max(dcy),
        maxDcx: max(dcx),
        maxDpxPct: max(dpx) * 100,
        maxCarYPx: max(dcarY),
        maxCarXPx: max(dcarX),
        engageGap: eng.gap,
        engageZoom: eng.z,
        aPxW: { min: Math.min(...seq.map((f) => f.aPxW || 0)), max: Math.max(...seq.map((f) => f.aPxW || 0)) },
        resZoom: firstRes ? firstRes.z : null,
        lastZoom: last.z,
        resDriftPct: firstRes && last.aPxW ? pct(firstRes.aPxW, last.aPxW) : null,
      });
    }

    console.log('\n逐场读数（正常速度逐帧）：');
    for (const p of perBattle) {
      console.log(
        `  第${p.battle + 1}场 ${p.frames}帧/${(p.durMs / 1000).toFixed(1)}s | 主体屏宽 Δ=${p.maxDpxPct.toFixed(2)}% ` +
          `| 车底屏幕Y Δ=${p.maxCarYPx.toFixed(1)}px 车中线屏幕X Δ=${p.maxCarXPx.toFixed(1)}px ` +
          `| 取景窗 Δz=${(p.maxDz * 100).toFixed(2)}% Δcy=${p.maxDcy.toFixed(1)}px Δcx=${p.maxDcx.toFixed(1)}px ` +
          `| 交战 gap=${p.engageGap ? p.engageGap.toFixed(0) : '—'} z=${p.engageZoom ? p.engageZoom.toFixed(2) : '—'} ` +
          `| RESULT z=${p.resZoom ? p.resZoom.toFixed(3) : '—'} vs 末帧 ${p.lastZoom ? p.lastZoom.toFixed(3) : '—'} (Δpx=${p.resDriftPct == null ? '—' : p.resDriftPct.toFixed(1) + '%'})`,
      );
    }

    console.log('\n=== 验收 1：交战 / 击飞不甩动（逐帧跳变有上限） ===');
    log(worstDpx <= LIMIT.dSubjectPx, `主体屏宽逐帧变化 ≤ ${LIMIT.dSubjectPx}%（放大不跳）`, `实测 max=${worstDpx.toFixed(2)}%（旧实现 10.03%，6 帧 >5%）`);
    log(worstCarY <= LIMIT.dCarScreenY, `车底在屏幕上的纵向位移 ≤ ${LIMIT.dCarScreenY}px（地面锚定，不随战车 Y 抖动）`, `实测 max=${worstCarY.toFixed(1)}px（旧实现 23.1px，14 帧 >6px）`);
    log(worstCarX <= LIMIT.dCarScreenX, `车中线在屏幕上的横向位移 ≤ ${LIMIT.dCarScreenX}px`, `实测 max=${worstCarX.toFixed(1)}px（旧实现 9.8px，6 帧 >6px）`);
    log(worstDcx <= LIMIT.dCropX, `取景窗横向逐帧位移 ≤ ${LIMIT.dCropX}px`, `实测 max=${worstDcx.toFixed(1)}px（旧实现 20.4px）`);
    log(worstDz <= LIMIT.dZoom, `取景窗缩放逐帧变化 ≤ ${(LIMIT.dZoom * 100).toFixed(1)}%`, `实测 max=${(worstDz * 100).toFixed(2)}% p99=${(worstDzP99 * 100).toFixed(2)}%（旧实现 11.71%，8 帧 >5%）；含正式相机相位切换的补偿`);

    console.log('\n=== 验收 2：战斗开始 / RESULT 切换不突然缩放 ===');
    log(startJump <= 0.12, '战斗首帧已在目标取景附近（无「开打一帧内缩放」）', `首帧 |z−target| max=${startJump.toFixed(3)}`);
    log(resultDrift <= LIMIT.resultScaleDrift, `RESULT 主体屏宽相对战斗末帧变化 ≤ ${(LIMIT.resultScaleDrift * 100).toFixed(0)}%`, `实测最差 ${(resultDrift * 100).toFixed(1)}%（旧实现 −31%~−34%）`);
    log(resultZoomMismatch <= 0.01, 'RESULT 沿用末帧 zoom（不缩回原比例）', `|z_RESULT − z_末帧| max=${resultZoomMismatch.toFixed(4)}（旧实现 0.52）`);

    console.log('\n=== 验收 3/4：双车恒可见 + F4 收益保留 ===');
    log(cropViolations === 0, '每帧裁切窗 ⊇ 双车可见部（远距 / 冲锋 / 击飞都不切车）', `违规帧=${cropViolations}`);
    log(engageZoom >= LIMIT.engageZoom, `交战帧 zoom ≥ ${LIMIT.engageZoom}（F4 放大收益保留）`, `实测 max=${engageZoom.toFixed(2)}`);

    // 逐帧读数落盘
    fs.writeFileSync(
      path.join(ROOT, 'adv-f6-frames.json'),
      JSON.stringify({ seed: SEED, battles: BATTLES, limit: LIMIT, perBattle, frames: rec.frames, res: rec.res }, null, 1),
    );
    // 关键帧截图（战斗→RESULT 切换的连续帧）
    let n = 0;
    for (const s of rec.shots || []) {
      const b64 = s.data.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(path.join(ROOT, `adv-f6-${s.tag}-${String(n++).padStart(2, '0')}.png`), Buffer.from(b64, 'base64'));
    }
    console.log(`\n[f6] 逐帧读数: ${path.join(ROOT, 'adv-f6-frames.json')}`);
    const failures = results.filter((r) => !r.pass);
    console.log(`[f6] ${results.length - failures.length}/${results.length} 通过`);
    process.exitCode = failures.length === 0 ? 0 : 1;
  } catch (err) {
    console.error('[f6] 异常:', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
})();
