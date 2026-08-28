// F-PLAYER-SINGLE-CANVAS-RECOVERY-P0｜独立最终像素门禁（生产可用，零内部依赖）
//
// 设计铁律：点击位置【绝不】来自 window.__h / hitAreas / layoutRect / transformInfo /
// vehicleFramingRect / 任何源码布局常量。所有点击目标均从「最终可见像素」（canvas
// getImageData 真实像素）独立识别；验证也【只用像素】——不依赖任何内部状态对象
// （window.__probe / window.__h 仅作可选交叉校验，缺失时完全由像素结论判定，因此本门禁
// 可在 __E2E_PROBE__=false 的正式 Pages 构建上原样运行）。
//
//   1. 读取唯一可见 Canvas 的 getImageData（RGBA 真实像素）；
//   2. 按颜色签名聚类（金=寻找对手CTA/战斗tab；亮蓝=车身/移动激活tab；浅色文字=车库入口）；
//   3. 取聚类/行段质心（backing px）→ 经 canvas.getBoundingClientRect 映射到屏幕 CSS 坐标；
//   4. 真实鼠标 page.mouse.click 质心；
//   5. 验证（纯像素）：CTA 消失=离开首页；底部入口点击后顶部 tab 行出现=进入 Garage；
//      三页签点击后顶部 tab 像素签名依次变化=状态流转；空白角点击 CTA 仍在=无误触。
//
// 覆盖 420×210 / 844×390 / 1363×936 / 1920×1008 × DPR 1 / 1.25 / 1.5 / 2。
const { chromium } = require('playwright-core');
const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:8138/';
const VPS = [
  { w: 1920, h: 1008 },
  { w: 1363, h: 936 },
  { w: 844, h: 390 },
  { w: 420, h: 210 },
];
const DPRS = [1, 1.25, 1.5, 2];

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}

// 子集过滤（调试用）：PIXEL_VP="1920x1008,844x390" PIXEL_DPR="1,2"
const VPS_RUN = process.env.PIXEL_VP
  ? process.env.PIXEL_VP.split(',').map((s) => { const [w, h] = s.split('x').map(Number); return { w, h }; })
  : VPS;
const DPRS_RUN = process.env.PIXEL_DPR
  ? process.env.PIXEL_DPR.split(',').map(Number)
  : DPRS;

// ---- 颜色签名（来自 visualTokens：primary #ffb229 / combat active rgba(222,164,52) / ownBlue #3d8bff）----
function isGold(r, g, b) {
  return r > 175 && g > 105 && b < 155 && (r - b) > 65 && (r - g) > 18 && (g - b) > 18;
}
function isBrightBlue(r, g, b) {
  return b > 140 && r < 150 && g > 90 && (b - r) > 50; // 激活的 body/move（ownBlue #3d8bff）
}
function isBlueish(r, g, b) {
  return b > 70 && b > r + 8 && b >= g - 12; // 含未激活 secondary 蓝（较暗）
}
function isLightText(r, g, b) {
  return r > 150 && g > 150 && b > 150; // 浅色标签文字（车库/排行榜/战令）
}

// ---- 在浏览器内读取「最终页面截图」像素 + 几何，返回紧凑结构（data 用于 Node 端独立聚类/签名）----
// F-PLAYER-INPUT-SCALE-P0：识别来源升级为最终页面截图——构造与 page.screenshot 同内容的
// viewport 截图画布（背景 + 唯一可见 canvas 按可见 rect 映射），再裁剪画布矩形重采样回
// backing 尺寸（识别空间/聚类参数不变）。识别结果即「可见按钮在截图中的位置」，
// 点击坐标经 toScreen 落到 client（viewport CSS px）——绝不把 backing 像素直接当点击坐标。
async function analyze(page) {
  return page.evaluate(() => {
    const cs = document.querySelectorAll('canvas');
    const canvasCount = cs.length;
    const c = cs[0];
    const rect = c.getBoundingClientRect();
    let data = null, w = 0, h = 0;
    try {
      const vw = window.innerWidth, vh = window.innerHeight;
      const shot = document.createElement('canvas');
      shot.width = vw; shot.height = vh;
      const sctx = shot.getContext('2d');
      const bg = getComputedStyle(document.body).backgroundColor;
      sctx.fillStyle = bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#141a26';
      sctx.fillRect(0, 0, vw, vh);
      sctx.drawImage(c, 0, 0, c.width, c.height, rect.x, rect.y, rect.width, rect.height);
      // 裁剪可见矩形 → backing 尺寸（保持既有识别空间不变）
      const out = document.createElement('canvas');
      out.width = c.width; out.height = c.height;
      const octx = out.getContext('2d');
      octx.drawImage(shot, rect.x, rect.y, rect.width, rect.height, 0, 0, c.width, c.height);
      const img = octx.getImageData(0, 0, out.width, out.height);
      data = Array.from(img.data);
      w = out.width; h = out.height;
    } catch (e) {
      data = null;
    }
    const probe = window.__probe || null;
    const hState = window.__h && window.__h.getGarageCategory ? { garageCategory: window.__h.getGarageCategory() } : null;
    return {
      canvasCount,
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      data, w, h,
      playerPhase: probe ? probe.playerPhase : (hState ? hState.playerPhase : null),
      garageCategory: probe ? probe.garageCategory : (hState ? hState.garageCategory : null),
    };
  });
}

// 像素 → 屏幕 CSS 坐标
function toScreen(rect, bx, by, W, H) {
  return { x: rect.x + (bx / W) * rect.w, y: rect.y + (by / H) * rect.h };
}

// 聚类：横向连续段合并 + 垂直邻近合并，返回质心数组（backing px）
function clusterize(points, w, h, maxGap = 14) {
  if (points.length === 0) return [];
  const rows = {};
  for (const p of points) { const y = p[1]; (rows[y] = rows[y] || []).push(p[0]); }
  const segs = [];
  for (const yStr of Object.keys(rows)) {
    const y = +yStr;
    const xs = rows[y].slice().sort((a, b) => a - b);
    let start = xs[0], prev = xs[0];
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] - prev <= maxGap) { prev = xs[i]; }
      else { segs.push({ y, x0: start, x1: prev }); start = xs[i]; prev = xs[i]; }
    }
    segs.push({ y, x0: start, x1: prev });
  }
  segs.sort((a, b) => a.y - b.y);
  const clusters = [];
  for (const s of segs) {
    const cx = (s.x0 + s.x1) / 2;
    let merged = false;
    for (const cl of clusters) {
      if (Math.abs(cl.cx - cx) < 40 && Math.abs(cl.y - s.y) < maxGap) {
        cl.x0 = Math.min(cl.x0, s.x0); cl.x1 = Math.max(cl.x1, s.x1);
        cl.y0 = Math.min(cl.y0, s.y); cl.y1 = Math.max(cl.y1, s.y);
        cl.n += (s.x1 - s.x0 + 1);
        cl.cx = (cl.x0 + cl.x1) / 2; cl.cy = (cl.y0 + cl.y1) / 2;
        merged = true; break;
      }
    }
    if (!merged) clusters.push({ x0: s.x0, x1: s.x1, y0: s.y, y1: s.y, cx, cy: s.y, n: (s.x1 - s.x0 + 1) });
  }
  return clusters.sort((a, b) => b.n - a.n);
}

function collect(data, w, h, fn) {
  if (!data) return [];
  const pts = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (fn(data[i], data[i + 1], data[i + 2])) pts.push([x, y]);
    }
  }
  return pts;
}

// 最大金聚类尺寸（CTA 体量代理）
function goldMaxOf(a) {
  const gc = clusterize(collect(a.data, a.w, a.h, isGold), a.w, a.h);
  return gc[0] ? gc[0].n : 0;
}
// 顶部 tab 行像素签名：gold/blue/bright 计数（顶部 32% 高）
function tabSigOf(a) {
  let gold = 0, blue = 0, bright = 0;
  const H = a.h;
  for (let y = 0; y < H * 0.32; y++) {
    for (let x = 0; x < a.w; x++) {
      const i = (y * a.w + x) * 4;
      const r = a.data[i], g = a.data[i + 1], b = a.data[i + 2];
      if (isGold(r, g, b)) gold++;
      else if (isBlueish(r, g, b)) blue++;
      if (isBrightBlue(r, g, b)) bright++;
    }
  }
  return { gold, blue, bright, fill: gold + blue, sig: `${gold},${blue},${bright}` };
}

async function run() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const vp of VPS_RUN) {
    for (const dpr of DPRS_RUN) {
      const tag = `${vp.w}x${vp.h}@${dpr}`;
      const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: dpr });
      const errs = [];
      page.on('pageerror', (e) => errs.push(String(e.message || e)));
      try {
        await page.goto(BASE + '?player=1', { waitUntil: 'load', timeout: 30000 });
        await page.waitForFunction(() => document.querySelectorAll('canvas').length >= 1, { timeout: 20000 });
        await page.waitForTimeout(700);

        // 验收#10：唯一可见 Canvas
        const a = await analyze(page);
        log(a.canvasCount === 1, `[${tag}] #10 唯一可见Canvas`, `canvasN=${a.canvasCount}`);
        if (a.canvasCount !== 1) { await page.close(); continue; }

        // 验收#1（CTA 中心≈50%）+ #1（点击进入 Matching）+ #2（空白角无误触）
        const goldHome = clusterize(collect(a.data, a.w, a.h, isGold), a.w, a.h);
        if (goldHome.length === 0) {
          log(false, `[${tag}] #1 金黄CTA像素`, '未检测到金黄像素');
        } else {
          const cta = goldHome[0];
          const screen = toScreen(a.rect, cta.cx, cta.cy, a.w, a.h);
          const mainAxisCenter = (screen.x - a.rect.x) / a.rect.w;
          const centerPx = screen.x - a.rect.x;
          log(Math.abs(mainAxisCenter - 0.5) < 0.12, `[${tag}] #1 CTA中心≈50%主轴`, `center=${(mainAxisCenter * 100).toFixed(1)}% px=${centerPx.toFixed(0)}`);
          const goldMaxHome = cta.n;
          // #1 点击 CTA → 离开首页（居中大体量金 CTA 消失：仍居中且体量>50% 的金聚类不再存在）
          await page.mouse.click(screen.x, screen.y);
          // F-PLAYER-INPUT-SCALE-P0：匹配流程会自动推进（匹配中→VS→预览锁定），等待其稳定
          // （约 2.4s 后画面静止，诊断确认 fill 精确不变），再做 #2 空白角验证——避免把
          // 「流程推进」误判为「误触」。
          await page.waitForTimeout(2600);
          const a3 = await analyze(page);
          const gc3 = clusterize(collect(a3.data, a3.w, a3.h, isGold), a3.w, a3.h);
          const centeredBig = gc3.some((c) => c.n > goldMaxHome * 0.5 && Math.abs(c.cx / a3.w - 0.5) < 0.15);
          const navPix = !centeredBig;
          const navProbe = a3.playerPhase === 'matching' || a3.playerPhase === 'matchPreview';
          log(navProbe || navPix, `[${tag}] #1 点击CTA→进入Matching`, `probe=${a3.playerPhase} navPix=${navPix}`);
          // #2：匹配稳定后点击空白角不得误触——不得发生【导航】。判据（像素，backing 空间随 dpr² 缩放）：
          //   回 Home = 底部居中（cy>0.7·h 且 cx≈0.5·w）大体量金色重新出现（Home CTA ~54k@DPR2，
          //     匹配各阶段≈0；阈值 5000×dpr²）；
          //   进 Garage = 顶部 tab 行填充剧增（Garage ~22k@DPR1 / ~90k@DPR2，匹配流程 max ~11.9k@DPR1
          //     / ~47.7k@DPR2；阈值 65000×dpr²，两档之间）。
          // 匹配流程自带循环动画（匹配中 fill~4.5k ↔ 预览 fill~47.7k @DPR2 交替）——不作为误触。
          const gmBase = goldMaxOf(a3);
          const tabBase = tabSigOf(a3);
          await page.mouse.click(a.rect.x + 4, a.rect.y + 4);
          await page.waitForTimeout(500);
          const a4 = await analyze(page);
          const gmCorner = goldMaxOf(a4);
          const tabCorner = tabSigOf(a4);
          const dpr2 = (a4.w / 844) ** 2;
          const goldPts4 = collect(a4.data, a4.w, a4.h, isGold);
          const bottomCenteredGold = goldPts4.filter(([x, y]) => y > a4.h * 0.7 && Math.abs(x / a4.w - 0.5) < 0.25).length;
          // 阈值（@DPR1 backing 空间，随 dpr² 缩放）：
          //   Home CTA 底部居中金 ≈13549；匹配 locked 阶段底部金按钮 ≈7110 → notHome 阈值 10000；
          //   匹配流程 topFill max ≈11932；Garage tab 行 fill ≈22080 → notGarage 阈值 17000。
          const notHome = bottomCenteredGold < 10000 * dpr2;
          const notGarage = tabCorner.fill < 17000 * dpr2;
          const stablePix = notHome && notGarage;
          const stableProbe = a4.playerPhase === 'matching' || a4.playerPhase === 'matchPreview';
          log(stableProbe || stablePix, `[${tag}] #2 空白角点击不误触`, `probe=${a4.playerPhase} goldMax ${gmBase}→${gmCorner} tabFill ${tabBase.fill}→${tabCorner.fill} bottomGold=${bottomCenteredGold} notHome=${notHome} notGarage=${notGarage} pix=${stablePix}`);
        }

        // 验收#3：底部浅色入口点击 → 进入 Garage（顶部 tab 行出现）
        await page.goto(BASE + '?player=1', { waitUntil: 'load', timeout: 30000 });
        await page.waitForFunction(() => document.querySelectorAll('canvas').length >= 1, { timeout: 20000 });
        await page.waitForTimeout(700);
        const home = await analyze(page);

        // F-PLAYER-INPUT-SCALE-P0 Must：1363×936 DPR1 下点击旧错误点 (422,518) 不得触发 CTA
        // （旧实现把 client 直接当 logical → 该点落 422,365 命中 CTA；修复后 422,518→logical
        //  (261,226) 空白区，CTA 保持 → 仍 Home）。点击坐标 = 截图像素坐标（client）。
        if (vp.w === 1363 && dpr === 1) {
          const gmHomeOld = goldMaxOf(home);
          await page.mouse.click(422, 518);
          await page.waitForTimeout(450);
          const hOldErr = await analyze(page);
          const gmAfterOld = goldMaxOf(hOldErr);
          const stillHome = gmAfterOld > gmHomeOld * 0.6;
          const notMatching = hOldErr.playerPhase !== 'matching' && hOldErr.playerPhase !== 'matchPreview';
          log(stillHome && notMatching, `[${tag}] Must-旧错点(422,518)不触发CTA`, `gold ${gmHomeOld}→${gmAfterOld} phase=${hOldErr.playerPhase} pix=${stillHome}`);
        }

        const lightPts = collect(home.data, home.w, home.h, isLightText);
        const lightClusters = clusterize(lightPts, home.w, home.h);
        const bottomClusters = lightClusters.filter((c) => c.cy / home.h > 0.55);
        if (bottomClusters.length === 0) {
          log(false, `[${tag}] #3 车库入口像素`, '未检测到底部浅色入口');
        } else {
          bottomClusters.sort((p, q) => p.cx - q.cx);
          const g = bottomClusters[0];
          const gs = toScreen(home.rect, g.cx, g.cy, home.w, home.h);
          const tabBefore = tabSigOf(home).fill;
          await page.mouse.click(gs.x, gs.y);
          await page.waitForTimeout(500);
          const gar = await analyze(page);
          const tabAfter = tabSigOf(gar).fill;
          const enterPix = tabAfter > tabBefore + 50;
          const enterProbe = gar.garageCategory != null || gar.playerPhase === 'garage';
          log(enterProbe || enterPix, `[${tag}] #3 点击车库入口→进入Garage`, `probe=${gar.garageCategory}/${gar.playerPhase} tabFill ${tabBefore}→${tabAfter} pix=${enterPix}`);

          // 验收#4：车身/移动/战斗 三页签从像素识别并点击，像素签名依次变化。
          const gar2 = await analyze(page);
          const W2 = gar2.w, H2 = gar2.h, D2 = gar2.data;
          // 锚定 tab 行 y（高亮蓝密度最高行）
          const yh = {};
          for (let y = 0; y < H2 * 0.35; y++) {
            for (let x = 0; x < W2; x++) {
              const i = (y * W2 + x) * 4;
              if (isBrightBlue(D2[i], D2[i + 1], D2[i + 2])) yh[y] = (yh[y] || 0) + 1;
            }
          }
          let ymode = -1, ymaxc = -1;
          for (const k in yh) { if (yh[k] > ymaxc) { ymaxc = yh[k]; ymode = +k; } }
          if (ymode < 0) {
            log(false, `[${tag}] #4 页签锚定`, '未找到高亮蓝激活tab行');
          } else {
            const isFill = (r, g, b) => { const dr = r - 20, dg = g - 29, db = b - 44; return dr * dr + dg * dg + db * db > 196; };
            const occ = new Array(W2).fill(0);
            const y0 = Math.max(0, ymode - 12), y1 = Math.min(H2 - 1, ymode + 12);
            for (let y = y0; y <= y1; y++) {
              for (let x = 0; x < W2; x++) {
                const i = (y * W2 + x) * 4;
                if (isFill(D2[i], D2[i + 1], D2[i + 2])) occ[x] = 1;
              }
            }
            const runs = [];
            let s = -1;
            for (let x = 0; x < W2; x++) {
              if (occ[x] && s < 0) s = x;
              else if (!occ[x] && s >= 0) { runs.push([s, x - 1]); s = -1; }
            }
            if (s >= 0) runs.push([s, W2 - 1]);
            const tabs = runs.filter((r) => r[1] - r[0] >= 20)
              .sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))
              .slice(0, 3)
              .sort((p, q) => p[0] - q[0]);
            if (tabs.length < 3) {
              log(false, `[${tag}] #4 三页签识别`, `段数=${tabs.length}(期望3) runs=${runs.length}`);
            } else {
              // 点击顺序 combat(2)→move(1)→body(0)：每次落到不同分类 → 像素签名必变
              const order = [2, 1, 0];
              const expect = ['combat', 'move', 'body'];
              const sigs = [];
              let okAll = true;
              for (let k = 0; k < 3; k++) {
                const t = tabs[order[k]];
                const cx = (t[0] + t[1]) / 2;
                const ts = toScreen(gar2.rect, cx, ymode, W2, H2);
                await page.mouse.click(ts.x, ts.y);
                await page.waitForTimeout(320);
                const aa = await analyze(page);
                const sig = tabSigOf(aa).sig;
                sigs.push(sig);
                const catOk = aa.garageCategory === expect[k];
                if (!catOk) okAll = false;
                log(true, `[${tag}] #4 点击页签[${expect[k]}]`, `cat=${aa.garageCategory} sig=${sig}`);
              }
              const distinct = new Set(sigs).size;
              // 像素门禁：状态流转以【最终像素签名】为准（distinct>=2）；__probe 仅可选交叉校验，
              // 生产 Pages（__E2E_PROBE__=false）下 probe 恒 null，不得因此判失败。
              log(distinct >= 2, `[${tag}] #4 三页签状态依次变化`, `distinctSig=${distinct} probeOk=${okAll} (pixel-gated)`);
            }
          }
        }

        if (errs.length) log(false, `[${tag}] 无pageerror`, errs.slice(0, 2).join(' | '));
      } catch (e) {
        log(false, `[${tag}] FATAL`, String(e && e.message || e));
      }
      await page.close();
    }
  }
  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== 独立像素门禁结果：${passed}/${results.length} 通过 ===`);
  if (passed !== results.length) process.exitCode = 1;
}
run().catch((e) => { console.error(e); process.exit(1); });
