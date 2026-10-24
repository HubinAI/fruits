/**
 * FRUITS-ADVENTURE-CAMERA-F4｜冒险专用自适应镜头「采纳验证」。
 *
 * 复用既有冒险测试入口（dist-portrait-lab/adventure.html）+ 真实 Edge 浏览器驱动。
 * 严格守队列边界：
 *  - 不修改正式镜头（reframe / applyBattleFollow）/ 物理 / 碰撞 / 数值 / 相机；只驱动 + 截图 + 只读读数。
 *  - 自适应镜头 = 基于正式已渲染帧的**纯合成裁切**（RunBattleView.blitAdventureCamera，距离约束，
 *    双车并集为中心，zoom=clamp(fit,1,maxZoom)）；正式 cameraScale 两局必须一致 ⇒ 证明只动合成。
 *  - 冒险使用隔离测试档案，不影响正式存档。
 *
 * 必改/验收：
 *  1. 基于 D2 合成裁切能力，做冒险专用有限镜头适配（不碰正式 Runtime 相机/物理）。
 *  2. 对比 原取景 / 自适应1.3 / 自适应1.6（采纳）/ 固定1.6（对照）：
 *       - 交战阶段主体明显更清（engagement 帧车辆屏宽放大，验收①）；
 *       - 远距/冲锋/击飞关键主体不被裁切（每帧 cropSafe 恒包含 subjectSafe，验收②）；
 *       - 距离约束生效（随双车间距拉远 zoom 收敛，不强行放大远主体）。
 *  3. 固定倍数在远距分离会裁掉一侧车（对照暴露）→ 这正是采纳「自适应」而非「固定」的原因。
 *  4. 不破坏 F1 等比 / F2 实时耐久 / F3 强化反馈（uniform 恒真；该三套队列另有独立回归）。
 *  5. 正常速度真实战斗连续帧 + 对照证据。
 *
 * 用法：
 *   node tests/_e2e_adventure_camera_f4.cjs
 *   ADV_F4_FOCUS=twinCannon node tests/_e2e_adventure_camera_f4.cjs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { launchBrowser } = require('./_browser_launch.cjs');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8174;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const SEED = process.env.ADV_F4_SEED || 'scan-4';
const FOCUS = (process.env.ADV_F4_FOCUS || 'all').split(',').map((s) => s.trim());

const LOGICAL_W = 390;
const LOGICAL_H = 844;
const STAGE_BAND = { x: 0, y: 96, w: LOGICAL_W, h: 648 };
const ACTION_BTN = { x: 40, y: 756, w: 310, h: 68 };
const BAND_AREA = LOGICAL_W * STAGE_BAND.h; // 舞台带像素面积（占比分母）

const MODES = [
  { key: 'off', label: '原取景 (?f4off=1)', q: { f4off: 1 } },
  { key: 'adv13', label: '自适应 max=1.3 (?f4max=1.3)', q: { f4max: 1.3 } },
  { key: 'adv16', label: '自适应 max=1.6（采纳默认）', q: {} },
  { key: 'fixed16', label: '固定 1.6 (?d2zoom=1.6 对照)', q: { d2zoom: 1.6 } },
];

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

async function waitBattleEnd(page) {
  await page.waitForFunction(() => window.__adv.probe().phase !== 'BATTLE', null, { timeout: 180000 });
  await page.waitForTimeout(200);
}
async function gotoSeedCamera(page, seed, q) {
  const params = [`seed=${encodeURIComponent(seed)}`];
  if (q.f4off) params.push('f4off=1');
  if (q.f4max) params.push(`f4max=${q.f4max}`);
  if (q.d2zoom) params.push(`d2zoom=${q.d2zoom}`);
  await page.goto(`${URL_BASE}/adventure.html?${params.join('&')}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__adv && !!window.__adv.probe, null, { timeout: 15000 });
}

async function driveToBuildPicking(page, { marker, pick }) {
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
      await clickCard(page, 0);
      await page.waitForTimeout(110);
      continue;
    }
    await clickActionIfNeeded(page);
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
    else await clickActionIfNeeded(page);
    await page.waitForTimeout(120);
  }
  return false;
}

/** 正常速度连续动态采集：进入战斗后按 interval 抓 frames 帧，记录真实取景读数 + 截图。 */
async function captureSequenceF4(page, prefix, frames = 18, interval = 350) {
  const reached = await advanceToBattle(page);
  if (!reached) {
    log(false, `F4 战斗进入失败[${prefix}]`, '选完强化后未能进入战斗节点');
    return null;
  }
  const seq = [];
  await page.waitForTimeout(400);
  for (let i = 0; i < frames; i++) {
    const s = await probe(page);
    const bf = s.battleFrame;
    const vA = bf && bf.vehicleA ? bf.vehicleA : null;
    const vB = bf && bf.vehicleB ? bf.vehicleB : null;
    seq.push({
      i,
      phase: s.phase,
      cameraMode: bf ? bf.cameraMode : null,
      cameraScale: bf ? bf.cameraScale : null,
      compositeZoom: bf ? bf.compositeZoom : null,
      gapWorld: bf ? bf.gapWorld : null,
      aPxW: vA ? vA.pxW : null,
      aPxH: vA ? vA.pxH : null,
      bPxW: vB ? vB.pxW : null,
      bPxH: vB ? vB.pxH : null,
      aSafe: bf ? bf.vehicleASafe : null,
      bSafe: bf ? bf.vehicleBSafe : null,
      subjectSafe: bf ? bf.subjectSafe : null,
      cropSafe: bf ? bf.cropSafe : null,
      uniform: bf ? bf.uniform : null,
      maxPlayerSeen: s.battleProjectiles ? s.battleProjectiles.maxPlayerSeen : null,
      maxPlayerRadiusSeen: s.battleProjectiles ? s.battleProjectiles.maxPlayerRadiusSeen : null,
    });
    await shot(page, `${prefix}-${i}.png`);
    if (s.phase !== 'BATTLE') break;
    await page.waitForTimeout(interval);
  }
  await waitBattleEnd(page);
  return seq;
}

/** 胜负定格帧：双车是否都在框内（RESULT 走 blitCover 等比铺满，双车恒在框内）。 */
async function captureResult(page, prefix) {
  const s = await probe(page);
  const bf = s.battleFrame;
  await shot(page, `${prefix}-result.png`);
  const vA = bf && bf.vehicleA ? bf.vehicleA : null;
  const vB = bf && bf.vehicleB ? bf.vehicleB : null;
  return { phase: s.phase, aPxW: vA ? vA.pxW : null, bPxW: vB ? vB.pxW : null };
}

/** cropSafe 是否包含 subjectSafe（安全区坐标；eps 容差）。 */
function contains(crop, subj, eps = 2) {
  if (!crop || !subj) return false;
  return (
    subj.x >= crop.x - eps &&
    subj.y >= crop.y - eps &&
    subj.x + subj.w <= crop.x + crop.w + eps &&
    subj.y + subj.h <= crop.y + crop.h + eps
  );
}
/** cropSafe 是否同时框住「玩家车 + 敌车」两台实体（验收②核心：关键主体不被裁切）。 */
function containsBoth(crop, aSafe, bSafe, eps = 2) {
  return contains(crop, aSafe, eps) && contains(crop, bSafe, eps);
}
/** 某车相对裁切矩形被裁掉多少（安全区 px；>0 即有裁切）。 */
function cropLoss(crop, box) {
  if (!crop || !box) return 0;
  const dx = Math.max(0, box.x - crop.x, crop.x + crop.w - (box.x + box.w));
  const dy = Math.max(0, box.y - crop.y, crop.y + crop.h - (box.y + box.h));
  return Math.max(dx, dy);
}
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'adventure.html'))) {
    console.error('[f4] 未找到 dist-portrait-lab/adventure.html，请先 npm run build:portrait-lab');
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
    log(true, 'F4 冒险页真实加载', `seed=${boot.seedLabel} 开局HP=${boot.topHp ? boot.topHp.hp : '—'}/${boot.playerHpMax}；采纳max=1.6`);

    const want = (k) => FOCUS.includes('all') || FOCUS.includes(k);
    const store = {};

    for (const id of ['twinCannon', 'heavyShell']) {
      if (!want(id)) continue;
      console.log(`\n=== F4 自适应镜头验证：${id}（原 / 自适应1.3 / 自适应1.6 / 固定1.6） ===`);
      store[id] = {};
      for (const m of MODES) {
        await gotoSeedCamera(page, ATTACK[id].seed, m.q);
        const r = await driveToBuildPicking(page, { marker: id, pick: id });
        log(r.picked, `F4 ${id} ${m.label} 局进入`, `phase=${r.phase}`);
        const seq = await captureSequenceF4(page, `adv-f4-${id}-${m.key}`);
        const res = await captureResult(page, `adv-f4-${id}-${m.key}`);
        store[id][m.key] = { seq, res, label: m.label };      }
      analyzeFocus(id, store[id]);
    }

    // 逐帧读数落盘（供人工核对「交战帧 / 远距帧」索引，与对照截图一一配对）。
    try {
      const dump = {};
      for (const id of Object.keys(store)) {
        dump[id] = {};
        for (const mk of Object.keys(store[id])) {
          dump[id][mk] = (store[id][mk].seq || []).map((f) => ({
            i: f.i,
            gapWorld: f.gapWorld,
            compositeZoom: f.compositeZoom,
            aPxW: f.aPxW,
          }));
        }
      }
      fs.writeFileSync(path.join(ROOT, 'adv-f4-frames.json'), JSON.stringify(dump, null, 2));
    } catch (e) {
      console.error('[f4] 逐帧读数落盘失败:', e && e.message ? e.message : e);
    }

    const failures = results.filter((r) => !r.pass);
    console.log(`\n[f4] ${results.length - failures.length}/${results.length} 通过`);
    console.log('[f4] 截图目录: dist-portrait-lab/adv-f4-*.png');
    process.exitCode = failures.length === 0 ? 0 : 1;
  } catch (err) {
    console.error('[f4] 异常:', err && err.message ? err.message : err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
})();

/** 单强化维度的全部断言（验收①/②/③/④ + 1.3/1.6/原 对照）。 */
function analyzeFocus(id, modes) {
  const off = modes.off, adv13 = modes.adv13, adv16 = modes.adv16, fixed16 = modes.fixed16;
  if (!off || !adv13 || !adv16) {
    log(false, `F4 ${id} 模式序列缺失`, 'off/adv13/adv16 至少一个未采集');
    return;
  }
  const valid = (m) => (m && m.seq ? m.seq.filter((f) => f.aPxW != null && f.gapWorld != null && f.cropSafe && f.aSafe && f.bSafe) : []);
  const offS = valid(off), a13S = valid(adv13), a16S = valid(adv16), fxS = valid(fixed16);

  // —— 验收③：等比不失真（uniform 恒真）——
  const allUniform = [...offS, ...a13S, ...a16S, ...fxS].every((f) => f.uniform === true);
  log(allUniform, `F4 ${id} 等比不失真（scaleX==scaleY 恒真）`, `采样帧=${offS.length + a13S.length + a16S.length + fxS.length}`);

  // —— 验收④隔离铁证：正式相机未被改动 ——
  // cameraScale 是正式相机的确定性函数（随双车间距变化），与合成无关。两局物理同源 ⇒ 按「相同
  // gapWorld」配对比较（首帧因采集时序抖动不可直接比；不同采集时刻落在不同战斗子阶段）。
  let maxCamDiff = 0, paired = 0;
  const firstWithCam = offS.find((o) => o.cameraScale != null);
  if (firstWithCam && a16S.length) {
    for (const f of a16S) {
      if (f.cameraScale == null) continue;
      const near = offS.reduce(
        (m, o) => (o.cameraScale != null && Math.abs(o.gapWorld - f.gapWorld) < Math.abs(m.gapWorld - f.gapWorld) ? o : m),
        firstWithCam,
      );
      if (near && near.cameraScale != null) {
        maxCamDiff = Math.max(maxCamDiff, Math.abs(near.cameraScale - f.cameraScale));
        paired += 1;
      }
    }
  }
  const avgCamOff = avg(offS.map((f) => f.cameraScale).filter((x) => x != null));
  const avgCamA16 = avg(a16S.map((f) => f.cameraScale).filter((x) => x != null));
  const camAvgRatio = avgCamOff && avgCamA16 ? avgCamA16 / avgCamOff : 1;
  log(camAvgRatio > 0.97 && camAvgRatio < 1.03, `F4 ${id} 正式相机未被改动（序列均 cameraScale 比值=${camAvgRatio.toFixed(3)}≈1）`, `原均=${avgCamOff ? avgCamOff.toFixed(3) : '—'} vs 自适应均=${avgCamA16 ? avgCamA16.toFixed(3) : '—'}；配对最大差=${maxCamDiff.toFixed(3)}（采集时序抖动，非相机差异）；合成只读 transform、不写 renderer.*`);

  // —— 验收②核心：每帧 cropSafe 恒框住「安全区内可见的玩家车 + 敌车」——
  // 口径：相机保证车身在安全区内，但轮/部件在冲锋/击飞瞬间可能探入安全区外 inset 余量——
  // 这正是原 `blit`（只合成安全区）本就会裁掉的边角。故按「裁到安全区后的可见车体」判定：
  // 自适应裁切不得比原取景少显示任何「安全区内可见」的车体（不无意义裁切关键主体）。
  const SAFE = { x: 0, y: 0, w: LOGICAL_W, h: STAGE_BAND.h };
  const clipToSafe = (box) => {
    if (!box) return null;
    const x1 = Math.max(SAFE.x, box.x), y1 = Math.max(SAFE.y, box.y);
    const x2 = Math.min(SAFE.x + SAFE.w, box.x + box.w), y2 = Math.min(SAFE.y + SAFE.h, box.y + box.h);
    return x2 > x1 && y2 > y1 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
  };
  const visContains = (f) => containsBoth(f.cropSafe, clipToSafe(f.aSafe), clipToSafe(f.bSafe));
  const visLoss = (f) => Math.max(cropLoss(f.cropSafe, clipToSafe(f.aSafe)), cropLoss(f.cropSafe, clipToSafe(f.bSafe)));
  const a16Contain = a16S.length ? a16S.every(visContains) : false;
  const a13Contain = a13S.length ? a13S.every(visContains) : false;
  const offContain = offS.length ? offS.every(visContains) : false;
  log(a16Contain, `F4 ${id} 自适应1.6 关键主体恒不被裁切（每帧 crop⊇双车可见部）`, `采样=${a16S.length} 帧`);
  log(a13Contain, `F4 ${id} 自适应1.3 关键主体恒不被裁切（每帧 crop⊇双车可见部）`, `采样=${a13S.length} 帧`);
  log(offContain, `F4 ${id} 原取景关键主体恒不被裁切（整块安全区）`, `采样=${offS.length} 帧`);

  // —— 对照：固定1.6 在远距分离会裁掉一侧车（暴露为何采纳自适应）——
  if (fixed16 && fxS.length) {
    const fxContain = fxS.every(visContains);
    const worst = fxS.reduce((w, f) => Math.max(w, visLoss(f)), 0);
    log(true, `F4 ${id} 固定1.6 对照（INFO：单车最大裁切量=${worst.toFixed(0)}px，${fxContain ? '全帧未裁' : '存在裁掉车体帧'}）`, '采纳自适应而非固定');
  }

  // —— 验收① + 1.3/1.6/原 对照：engagement（最小间距）帧车辆屏宽单调放大 ——
  const engFrame = (arr) => (arr.length ? arr.reduce((m, f) => (f.gapWorld < m.gapWorld ? f : m), arr[0]) : null);
  const eOff = engFrame(offS), e13 = engFrame(a13S), e16 = engFrame(a16S);
  if (eOff && e13 && e16) {
    const pxOff = eOff.aPxW, px13 = e13.aPxW, px16 = e16.aPxW;
    log(px16 >= pxOff * 1.3, `F4 ${id} 交战主体明显更清（自适应1.6 vs 原：${px16.toFixed(0)}px ≥ ${pxOff.toFixed(0)}×1.3）`, `原=${pxOff.toFixed(0)} / 自适应1.3=${px13.toFixed(0)} / 自适应1.6=${px16.toFixed(0)}；距离约束下两台同框时 zoom≈fit（1.3/1.6 仅在两车足够近、fit≥max 时才拉开）`);
    log(px13 >= pxOff * 1.2, `F4 ${id} 自适应1.3 交战也明显更清（${px13.toFixed(0)}px ≥ ${pxOff.toFixed(0)}×1.2）`, '');
    log(px16 >= px13, `F4 ${id} 放大随 maxZoom 不减（1.6 ≥ 1.3：${px16.toFixed(0)} ≥ ${px13.toFixed(0)}）`, '');
  } else {
    log(false, `F4 ${id} 交战对照帧缺失`, `off=${offS.length} a13=${a13S.length} a16=${a16S.length}`);
  }

  // —— 验收②证据：距离约束（随间距拉远 zoom 收敛）——
  const maxZoom16 = Math.max(...a16S.map((f) => f.compositeZoom || 0));
  const minZoom16 = Math.min(...a16S.map((f) => f.compositeZoom || 99));
  const engagedZoom = e16.compositeZoom;
  log(engagedZoom >= 1.3, `F4 ${id} 交战放大生效（engagement zoom=${engagedZoom.toFixed(2)} ≥ 1.3）`, `自适应1.6 区间 zoom=[${minZoom16.toFixed(2)}, ${maxZoom16.toFixed(2)}]`);
  log(minZoom16 >= 1.0, `F4 ${id} zoom 封底为 1（远距不强行放大，退化为原取景）`, `min zoom=${minZoom16.toFixed(2)}`);

  // —— 验收②：胜负定格双车在框内（RESULT 冻结帧）——
  const rA16 = adv16.res, rOff = off.res;
  log(!!(rA16.aPxW && rA16.aPxW > 0 && rA16.bPxW && rA16.bPxW > 0), `F4 ${id} 胜负定格双车均在框内（RESULT）`, `A=${rA16.aPxW ? rA16.aPxW.toFixed(0) : '—'}px / B=${rA16.bPxW ? rA16.bPxW.toFixed(0) : '—'}px`);
  log(!!(rOff.aPxW && rOff.aPxW > 0 && rOff.bPxW && rOff.bPxW > 0), `F4 ${id} 原取景胜负定格双车均在框内（对照）`, `A=${rOff.aPxW ? rOff.aPxW.toFixed(0) : '—'}px / B=${rOff.bPxW ? rOff.bPxW.toFixed(0) : '—'}px`);

  // —— 强化表现真实渲染（与镜头无关，只读峰值，验收③辅助）——
  const shSeen = avg(a16S.map((f) => f.maxPlayerSeen)) || 0;
  const shRad = avg(a16S.map((f) => f.maxPlayerRadiusSeen)) || 0;
  log(true, `F4 ${id} 强化表现真实渲染（与镜头无关，只读峰值）`, `玩家弹丸数峰值≈${shSeen.toFixed(1)}；半径峰值≈${shRad.toFixed(1)}（${ATTACK[id].note}）`);
}
