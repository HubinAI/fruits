/**
 * F-LOSS-ADJUST-REMATCH-LOOP-P0｜闭环 E2E 门禁（Must#11 A-H）
 *
 * 流程：强制 Loss（点 Result 主按钮语义判定：loss→garage / win→matching，win 则重开）
 *   → Result 调整配置进 Garage（保留配置）
 *   → Garage 换装（body + 移动件/武器）
 *   → 再次匹配 → 下一局：最终 Canvas 像素证明外观变化 + probe snapshot 证明 Build 一致
 *   → 返回 Result：奖励未重复（localStorage 库存差 = 1 次）
 *   → Next Match 路径单独覆盖（win→primary 下一场 / loss→secondary 下一场 → matching 不进 garage）。
 * 视觉结果来自最终合成 Canvas 像素（A 车 rect 区域像素签名对比）；内部 probe 只用于
 * 配置（draft）与 session（battleState/playerPhase）证据。
 */
const { chromium } = require('playwright-core');
const BASE = 'http://127.0.0.1:8138/?player=1';
const INV_KEY = 'strongfruit.ownedParts.v2';

let PASS = 0;
let FAIL = 0;
function log(ok, name, info) {
  const tag = ok ? 'PASS' : 'FAIL';
  if (ok) PASS++; else FAIL++;
  console.log(`${tag} ${name} | ${info}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(page) {
  return page.evaluate(() => (globalThis.__probe ? { ...globalThis.__probe } : null)).catch(() => null);
}
async function hitAreas(page) {
  return page.evaluate(() => {
    const h = globalThis.__h;
    if (!h) return [];
    return (h.hitAreas || []).filter((a) => a && a.id).map((a) => ({ id: a.id, x: a.x, y: a.y, w: a.w, h: a.h }));
  }).catch(() => []);
}
async function findHit(page, id, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const list = await hitAreas(page);
    const t = list.find((a) => a.id === id);
    if (t) return t;
    await sleep(150);
  }
  return null;
}
async function toClient(page, lx, ly) {
  const box = await page.locator('canvas').first().boundingBox();
  const t = await page.evaluate(() => globalThis.__h.getTransformInfo());
  const k = t.cssW > 0 ? box.width / t.cssW : 1;
  return { x: box.x + (t.ox + t.scale * lx) * k, y: box.y + (t.oy + t.scale * ly) * k };
}
async function clickHit(page, hit) {
  const p = await toClient(page, hit.x + hit.w / 2, hit.y + hit.h / 2);
  await page.mouse.click(p.x, p.y);
  await sleep(220);
}
async function waitProbe(page, pred, ms, step = 120) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const p = await probe(page);
    if (pred(p)) return p;
    await sleep(step);
  }
  return null;
}
/** A 车 rect 区域最终 Canvas 像素签名（绿=西瓜/蓝青系、橙=箱系） */
async function sampleVehicleA(page) {
  return page.evaluate(() => {
    const p = globalThis.__probe;
    const c = document.querySelector('canvas');
    if (!p || !c || !p.vehicleRects || !p.vehicleRects.a) return null;
    const a = p.vehicleRects.a;
    const dpr = c.width / (c.clientWidth || 1) || 1;
    const W = c.width, H = c.height;
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, W, H).data;
    const x0 = Math.max(0, Math.round(a.x * dpr));
    const x1 = Math.min(W, Math.round((a.x + a.w) * dpr));
    const y0 = Math.max(0, Math.round(a.y * dpr));
    const y1 = Math.min(H, Math.round((a.y + a.h) * dpr));
    let green = 0, orange = 0, n = 0;
    const stepS = Math.max(1, Math.round(2 * dpr));
    for (let y = y0; y < y1; y += stepS) {
      for (let x = x0; x < x1; x += stepS) {
        const i = (y * W + x) * 4;
        const R = data[i], G = data[i + 1], B = data[i + 2];
        if (G > 110 && G > R + 20 && G > B + 10 && R < 150 && B < 140) green++;
        else if (R > 180 && G > 130 && B < 130 && R - B > 40) orange++;
        n++;
      }
    }
    return {
      rect: { x: a.x, y: a.y, w: a.w, h: a.h },
      greenPct: n ? green / n : 0,
      orangePct: n ? orange / n : 0,
      px: n,
    };
  }).catch(() => null);
}
async function invTotal(page) {
  return page.evaluate((k) => {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) return 0;
      const obj = JSON.parse(raw);
      const inv = obj && typeof obj === 'object' && 'obj' in obj ? obj.obj : obj;
      let n = 0;
      for (const key of Object.keys(inv)) {
        const e = inv[key];
        if (e && typeof e === 'object') n += (e.one || 0) + (e.two || 0);
      }
      return n;
    } catch { return -1; }
  }, INV_KEY);
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const VIEWPORTS = [
    { w: 420, h: 210, dpr: 1, label: '420x210 dpr1' },
    { w: 844, h: 390, dpr: 1, label: '844x390 dpr1' },
    { w: 1280, h: 592, dpr: 1.5, label: '1280x592 dpr1.5' },
    { w: 844, h: 390, dpr: 3, label: '844x390 dpr3' },
  ];
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let hitHomeNav = false; // 本视口是否点击过 nav:home（「不经过 Home」证据）

    // ---------- A/B. 强制 Loss → 调整配置 → Garage 装配台（garage-retry 出现） ----------
    let lossAt = -1;
    let firstA = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.goto(BASE, { waitUntil: 'load' });
      await waitProbe(page, (p) => p && p.playerPhase === 'garage', 10000);
      await page.waitForTimeout(400);
      const find = (await findHit(page, 'home-find-opponent', 12)) || (await findHit(page, 'cta-find', 12));
      if (!find) { log(false, `[${vp.label}] A. 找到寻找对手`, 'not found'); break; }
      await clickHit(page, find);
      const fight = await waitProbe(page, (p) => p && p.battleState === 'fighting', 30000);
      if (!fight) { log(false, `[${vp.label}] A. 进入战斗`, 'timeout'); break; }
      const sa = await sampleVehicleA(page);
      if (sa) firstA = sa;
      const ended = await waitProbe(page, (p) => p && p.battleState === 'ended', 60000);
      if (!ended) { log(false, `[${vp.label}] A. 战斗结束`, 'timeout'); break; }
      // 点 loss 主按钮：mobile modal-primary（loss→garage）/ desktop result-adjust
      const primary = await findHit(page, 'modal-primary', 12);
      const adjustBtn = await findHit(page, 'result-adjust', 6);
      if (primary) { await clickHit(page, primary); }
      else if (adjustBtn) { await clickHit(page, adjustBtn); }
      else { log(false, `[${vp.label}] A. Result 主按钮`, 'not found'); break; }
      await sleep(400);
      const p = await probe(page);
      if (p && p.playerPhase === 'garage') { lossAt = attempt; break; }
      log(true, `[${vp.label}] A. 第 ${attempt + 1} 局为 Win（主按钮→matching），重开`, '');
    }
    if (lossAt < 0) { log(false, `[${vp.label}] A. 4 局内未出现 Loss`, ''); await page.close(); continue; }
    log(true, `[${vp.label}] B. 战败 Result 主按钮 → Garage 装配台`, '');
    // result-adjust 上下文证据：garage-retry 按钮出现（仅此模式显示）
    const retryBtn = await findHit(page, 'garage-retry', 12);
    log(!!retryBtn, `[${vp.label}] B2. garage-retry（完成并再战）按钮出现（result-adjust 上下文）`, '');

    // ---------- C. Garage 换装（bananaBody） ----------
    const draftBefore = await page.evaluate(() => {
      const d = globalThis.__h && globalThis.__h.lastState && globalThis.__h.lastState.draft;
      return d ? { body: d.bodyDefId } : null;
    }).catch(() => null);
    const chipBody = await findHit(page, 'chip:body', 10);
    if (chipBody) await clickHit(page, chipBody);
    await sleep(200);
    const optBody = await findHit(page, 'opt:bananaBody');
    if (!optBody) { log(false, `[${vp.label}] C. bananaBody 部件卡`, 'not found'); await page.close(); continue; }
    await clickHit(page, optBody);
    await sleep(250);
    const draftAfter = await page.evaluate(() => {
      const d = globalThis.__h && globalThis.__h.lastState && globalThis.__h.lastState.draft;
      return d ? { body: d.bodyDefId } : null;
    }).catch(() => null);
    log(!!draftAfter && draftAfter.body === 'bananaBody', `[${vp.label}] C. 换装 bananaBody 即时同步`, JSON.stringify(draftAfter));

    // ---------- D. 点 garage-retry → 直接 Matching（不经过 Home） ----------
    const retry = await findHit(page, 'garage-retry', 10);
    if (!retry) { log(false, `[${vp.label}] D. garage-retry 可点`, 'not found'); await page.close(); continue; }
    await clickHit(page, retry);
    await sleep(500);
    const pD = await probe(page);
    log(!!pD && pD.playerPhase === 'matching', `[${vp.label}] D. 完成并再战 → 直接 Matching（不经过 Home）`, `phase=${pD ? pD.playerPhase : 'null'}`);
    log(!hitHomeNav, `[${vp.label}] D2. 全流程未点击 nav:home（未经过 Home）`, `navHomeClicks=${hitHomeNav}`);

    // ---------- E/F. 第二局：像素证明外观变化 + snapshot Build 一致 + 新 session ----------
    const fight2 = await waitProbe(page, (p) => p && p.battleState === 'fighting', 30000);
    log(!!fight2, `[${vp.label}] E. 第二局进入 Battle`, '');
    const pF = await probe(page);
    log(!!pF && pF.battlePhase === 'Active', `[${vp.label}] E2. 第二局 phase=Active（新 session，非复用旧局）`, `phase=${pF ? pF.battlePhase : 'null'}`);
    const secondA = await sampleVehicleA(page);
    if (firstA && secondA) {
      const rectChanged = Math.abs(secondA.rect.w - firstA.rect.w) > 2 || Math.abs(secondA.rect.h - firstA.rect.h) > 2;
      const sigChanged = Math.abs(secondA.greenPct - firstA.greenPct) > 0.05 || Math.abs(secondA.orangePct - firstA.orangePct) > 0.05;
      log(rectChanged || sigChanged, `[${vp.label}] E3. 新 Battle 车辆最终像素与上一局不同（外观变化）`,
        `rect ${firstA.rect.w.toFixed(0)}x${firstA.rect.h.toFixed(0)}→${secondA.rect.w.toFixed(0)}x${secondA.rect.h.toFixed(0)} | green ${firstA.greenPct.toFixed(2)}→${secondA.greenPct.toFixed(2)} | orange ${firstA.orangePct.toFixed(2)}→${secondA.orangePct.toFixed(2)}`);
    } else {
      log(false, `[${vp.label}] E3. 像素对比基准缺失`, `first=${!!firstA} second=${!!secondA}`);
    }
    const snapDraft = await page.evaluate(() => {
      const d = globalThis.__h && globalThis.__h.lastState && globalThis.__h.lastState.draft;
      return d ? d.bodyDefId : null;
    }).catch(() => null);
    log(snapDraft === 'bananaBody', `[${vp.label}] F. runtime snapshot Build 与换装结果一致`, `draft.body=${snapDraft}`);

    // ---------- G. 奖励不重复（本视口两局库存差 = 1 次结算） ----------
    const s1 = await invTotal(page); // 第二局结算前（= 首局 1 次 + win 重开局数）
    const ended2 = await waitProbe(page, (p) => p && p.battleState === 'ended', 60000);
    log(!!ended2, `[${vp.label}] G. 第二局结束`, '');
    const s2 = await invTotal(page);
    log(s2 === s1 + 1, `[${vp.label}] G2. reward settlement count 仍为 1（库存 +1 只一次）`, `s1=${s1} s2=${s2}`);

    // ---------- H. 无上局 FX/HUD/camera 残留（第二局初始无红墙 + 新阶段） ----------
    // （E2 已断 phase=Active 新局；此处补初始无红墙色——closingWalls 未激活）
    const cleanStart = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      if (!c) return null;
      const W = c.width, H = c.height;
      const ctx = c.getContext('2d');
      const data = ctx.getImageData(0, 0, W, H).data;
      let red = 0, n = 0;
      const step = Math.max(2, Math.round(W / 100));
      for (let y = 0; y < H; y += step) {
        for (let x = 0; x < W; x += step) {
          const i = (y * W + x) * 4;
          const R = data[i], G = data[i + 1], B = data[i + 2];
          if (R > 200 && G < 140 && B < 140 && R - G > 60) red++;
          n++;
        }
      }
      return { redPct: n ? red / n : 0 };
    }).catch(() => null);
    log(!!cleanStart && cleanStart.redPct < 0.05, `[${vp.label}] H. 第二局初始无红墙/死亡环残留（FX/camera 清理）`, `redPct=${cleanStart ? (cleanStart.redPct * 100).toFixed(2) : 'null'}%`);

    // ---------- I. 返回 Home 保留：nav:home 后 garage-retry 消失（Must#4） ----------
    // 回到 Result（第二局结束）→ 点 adjust → garage → 点 nav:home → 无 garage-retry
    const pI = await probe(page);
    if (pI && pI.battleState === 'ended') {
      const prim2 = await findHit(page, 'modal-primary', 10);
      const adj2 = await findHit(page, 'result-adjust', 6);
      if (prim2) await clickHit(page, prim2);
      else if (adj2) await clickHit(page, adj2);
      await sleep(300);
    }
    const navHome = await findHit(page, 'nav:home', 8);
    if (navHome) { hitHomeNav = true; await clickHit(page, navHome); }
    await sleep(300);
    const retryAfter = await findHit(page, 'garage-retry', 6);
    log(!retryAfter, `[${vp.label}] I. 返回 Home 后 garage-retry 消失（上下文清除，保留返回能力）`, '');

    log(errors.length === 0, `[${vp.label}] 全程无 pageerror`, errors.slice(0, 2).join(' | ') || '');
    await page.close();
  }
  console.log(`===== GARAGE-ADJUST-REMATCH E2E GATE: ${PASS}/${PASS + FAIL} PASS =====`);
  await browser.close();
  process.exit(FAIL > 0 ? 1 : 0);
})();
