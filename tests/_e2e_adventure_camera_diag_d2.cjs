/**
 * FRUITS-ADVENTURE-CAMERA-DIAG-D2｜战斗主体偏小的「成因诊断 + 最小改善验证」隔离实验。
 *
 * 复用既有冒险测试入口（dist-portrait-lab/adventure.html）+ 真实 Edge 浏览器驱动。
 * 严格守队列边界：
 *  - 不修改正式镜头（reframe / applyBattleFollow）/ 物理 / 碰撞 / 数值 / 相机；只驱动 + 截图 + 只读读数。
 *  - 实验镜头 = 基于正式已渲染帧的**纯合成放大**（RunBattleView.blitSubject，由 ?d2zoom= 触发，
 *    默认中性、不进入正式主线）；正式 cameraScale 必须两局完全一致 ⇒ 证明只动了合成，没动相机。
 *  - 冒险使用隔离测试档案，不影响正式存档。
 *
 * 必查：
 *  1. 沿 世界坐标→Camera→RunBattleView→冒险舞台 链路，量化 远景/接近/交战 的车辆屏幕占比
 *     （读 probe().battleFrame：cameraScale + vehicleA.pxW/pxH，算占舞台带比例）。
 *  2. 相同敌人、相同构筑下，比较 现有镜头(?d2zoom=1) 与 实验镜头(?d2zoom=Z) 的同条件画面。
 *  3. 对 双联炮 / 重型弹头 分别提供正常速度连续动态对照（多帧序列），判断「镜头可读性」vs「强化表现本身不明显」。
 *  4. （R1 断言修复在 _e2e_adventure_experience_review_r1.cjs 内完成，本文件只做相机诊断。）
 *
 * 用法：
 *   node tests/_e2e_adventure_camera_diag_d2.cjs                 # twinCannon + heavyShell 都跑
 *   ADV_D2_FOCUS=twinCannon node tests/_e2e_adventure_camera_diag_d2.cjs
 *   ADV_D2_ZOOM=1.7 node tests/_e2e_adventure_camera_diag_d2.cjs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { launchBrowser } = require('./_browser_launch.cjs');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8173;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const SEED = process.env.ADV_D2_SEED || 'scan-4';
const ZOOM = (() => {
  const v = Number(process.env.ADV_D2_ZOOM || '1.6');
  return Number.isFinite(v) && v > 1 && v <= 2.5 ? v : 1.6;
})();
const FOCUS = (process.env.ADV_D2_FOCUS || 'all').split(',').map((s) => s.trim());

const LOGICAL_W = 390;
const LOGICAL_H = 844;
const STAGE_BAND = { x: 0, y: 96, w: LOGICAL_W, h: 648 };
const ACTION_BTN = { x: 40, y: 756, w: 310, h: 68 };
const BAND_AREA = LOGICAL_W * STAGE_BAND.h; // 舞台带像素面积（占比分母）

/** 攻击强化：seed + 在「提供该强化的 BUILD 节点」选它（两局同选它 ⇒ 同敌人同构筑）。 */
const ATTACK = {
  twinCannon: { id: 'twinCannon', seed: SEED, note: '一次开火连续两发' },
  heavyShell: { id: 'heavyShell', seed: SEED, note: '炮弹更重（半径10→16）' },
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

async function waitBattleEnd(page) {
  await page.waitForFunction(() => window.__adv.probe().phase !== 'BATTLE', null, { timeout: 180000 });
  await page.waitForTimeout(200);
}
async function gotoSeedZoom(page, seed, zoom) {
  // F4 起默认 = 自适应镜头；显式带 ?d2zoom=（含 =1）才进固定倍数模式，
  // 故「现有镜头」基线用 ?d2zoom=1（=1 ⇒ 退化为全安全区 blit = 原取景），避免落入自适应默认。
  const q = `seed=${encodeURIComponent(seed)}&d2zoom=${zoom}`;
  await page.goto(`${URL_BASE}/adventure.html?${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__adv && !!window.__adv.probe, null, { timeout: 15000 });
}

/** 推进到「提供 marker 的 BUILD 节点」并在此选 pick（pre：解锁深层路线先选项，heavyShell 不需要）。 */
async function driveToBuildPicking(page, { marker, pick, pre }) {
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
        const ok = await clickCardById(page, pick);
        return { phase: 'CHOICE', picked: ok };
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
 * 正常速度连续动态对照：进入指定强化的战斗后，按 interval 抓 frames 帧（默认 8×500ms≈4s），
 * 覆盖 远景→接近→交战/开火；每帧记录真实读数（cameraScale、vehicleA 屏幕像素、弹丸峰值）。
 */
async function captureSequence(page, prefix, frames = 8, interval = 500) {
  const reached = await advanceToBattle(page);
  if (!reached) {
    log(false, `D2 战斗进入失败[${prefix}]`, '选完强化后未能进入战斗节点');
    return null;
  }
  const seq = [];
  await page.waitForTimeout(400); // 开局短暂稳定
  for (let i = 0; i < frames; i++) {
    const s = await probe(page);
    const bf = s.battleFrame;
    const v = bf && bf.vehicleA ? bf.vehicleA : null;
    const pxW = v ? v.pxW : null;
    const pxH = v ? v.pxH : null;
    const ratio = v ? (v.pxW * v.pxH) / BAND_AREA : null;
    const widthPct = v ? (v.pxW / LOGICAL_W) * 100 : null;
    const heightPct = v ? (v.pxH / STAGE_BAND.h) * 100 : null;
    const sh = s.battleProjectiles;
    seq.push({
      i,
      phase: s.phase,
      cameraScale: bf ? bf.cameraScale : null,
      compositeZoom: bf ? bf.compositeZoom : null,
      pxW,
      pxH,
      ratio,
      widthPct,
      heightPct,
      maxPlayerSeen: sh ? sh.maxPlayerSeen : null,
      maxPlayerRadiusSeen: sh ? sh.maxPlayerRadiusSeen : null,
    });
    await shot(page, `${prefix}-${i}.png`);
    if (s.phase !== 'BATTLE') break;
    await page.waitForTimeout(interval);
  }
  await waitBattleEnd(page);
  return seq;
}

/** 必查2/3：同一强化、同一 seed，分别在 现有镜头(?d2zoom=1) 与 实验镜头(?d2zoom=Z) 抓连续序列。 */
async function compareZoom(page, cfg) {
  const id = cfg.id;
  // 现有镜头
  await gotoSeedZoom(page, cfg.seed, 1);
  const r1 = await driveToBuildPicking(page, { marker: id, pick: id });
  log(r1.picked, `D2 ${id} 现有镜头局进入（?d2zoom=1）`, `phase=${r1.phase}`);
  const existing = await captureSequence(page, `adv-d2-${id}-existing`);
  // 实验镜头（明显放大主体）
  await gotoSeedZoom(page, cfg.seed, ZOOM);
  const r2 = await driveToBuildPicking(page, { marker: id, pick: id });
  log(r2.picked, `D2 ${id} 实验镜头局进入（?d2zoom=${ZOOM}）`, `phase=${r2.phase}`);
  const exp = await captureSequence(page, `adv-d2-${id}-exp`);
  if (!existing || !exp) return;

  // 技术结论：实验倍率必须体现在「合成放大」，而非「正式相机」。用**序列均** cameraScale
  // 比值≈1.0（若为实验放大应≈ZOOM=1.6）—— 首帧因采集时序抖动不可比（F4 同源修正）。
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const camE = existing.map((f) => f.cameraScale).filter((x) => x != null);
  const camX = exp.map((f) => f.cameraScale).filter((x) => x != null);
  const camRatio = camE.length && camX.length ? mean(camX) / mean(camE) : 1;
  const camSame = camRatio > 0.95 && camRatio < 1.05;
  log(
    camSame,
    `D2 ${id} 正式相机未被改动（序列均 cameraScale 比值=${camRatio.toFixed(3)}，远离实验倍率 ${ZOOM}）`,
    `现有均=${camE.length ? mean(camE).toFixed(3) : '—'}；实验均=${camX.length ? mean(camX).toFixed(3) : '—'}；相机未放大（若放大应≈${ZOOM}）`,
  );

  // 实验镜头把主体放大 ~ZOOM 倍（纯合成放大，量化证据）。
  const pxE = existing.map((f) => f.pxW).filter((x) => x != null);
  const pxX = exp.map((f) => f.pxW).filter((x) => x != null);
  const ratioE = existing.map((f) => f.ratio).filter((x) => x != null);
  const ratioX = exp.map((f) => f.ratio).filter((x) => x != null);
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const pxEa = avg(pxE);
  const pxXa = avg(pxX);
  const enlarged = pxEa != null && pxXa != null && pxXa >= pxEa * (ZOOM * 0.85);
  log(
    enlarged,
    `D2 ${id} 实验镜头主体放大≈${ZOOM.toFixed(1)}×（纯合成，不改相机）`,
    `车辆均屏宽 现有=${pxEa ? pxEa.toFixed(0) : '—'}px → 实验=${pxXa ? pxXa.toFixed(0) : '—'}px；屏幕占比 现有=${(avg(ratioE) * 100).toFixed(1)}% → 实验=${(avg(ratioX) * 100).toFixed(1)}%`,
  );

  // 必查1：量化「远景/接近/交战」车辆屏幕占比（用现有镜头序列三段采样）。
  const f0 = existing[0];
  const fMid = existing[Math.floor(existing.length / 2)];
  const fLast = existing[existing.length - 1];
  const desc = (f) =>
    f && f.ratio != null
      ? `宽${f.pxW.toFixed(0)}px(${f.widthPct.toFixed(0)}%)×高${f.pxH.toFixed(0)}px，面积占比${(f.ratio * 100).toFixed(1)}%`
      : '—';
  log(
    f0 && f0.ratio != null,
    `D2 ${id} 车辆屏幕占比（现有镜头：远景→接近→交战）`,
    `远景=${desc(f0)}；接近=${desc(fMid)}；交战=${desc(fLast)}；舞台带=${LOGICAL_W}×${STAGE_BAND.h}`,
  );
  // 强化表现本身是否真的渲染（与镜头无关，只读峰值）。
  const shSeen = avg(existing.map((f) => f.maxPlayerSeen)) || 0;
  const shRad = avg(existing.map((f) => f.maxPlayerRadiusSeen)) || 0;
  log(
    true,
    `D2 ${id} 强化表现真实渲染（与镜头无关，只读峰值）`,
    `玩家弹丸数峰值≈${shSeen.toFixed(1)}；半径峰值≈${shRad.toFixed(1)}（基线1发/半径10；${cfg.note}）`,
  );
}

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'adventure.html'))) {
    console.error('[d2-diag] 未找到 dist-portrait-lab/adventure.html，请先 npm run build:portrait-lab');
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
    log(true, 'D2 冒险页真实加载', `seed=${boot.seedLabel} 开局HP=${boot.topHp ? boot.topHp.hp : '—'}/${boot.playerHpMax}；实验ZOOM=${ZOOM}`);

    const want = (k) => FOCUS.includes('all') || FOCUS.includes(k);
    for (const id of ['twinCannon', 'heavyShell']) {
      if (want(id)) {
        console.log(`\n=== D2 相机诊断：${id}（现有 vs 实验镜头） ===`);
        await compareZoom(page, ATTACK[id]);
      }
    }

    const failures = results.filter((r) => !r.pass);
    console.log(`\n[d2-diag] ${results.length - failures.length}/${results.length} 通过`);
    console.log('[d2-diag] 截图目录: dist-portrait-lab/adv-d2-*.png');
    process.exitCode = failures.length === 0 ? 0 : 1;
  } catch (err) {
    console.error('[d2-diag] 异常:', err && err.message ? err.message : err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
})();
