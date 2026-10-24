/**
 * FRUITS-ADVENTURE-BATTLE-VIEW-F1｜冒险战斗画面「比例不失真」真实浏览器验收。
 *
 * 手段：真实 Edge + 真实产物（dist-portrait-lab/adventure.html）+ 真实鼠标点击推进到 BATTLE，
 *   不伪造战斗、不改生产代码分支、不用 debug 步进跳过 UI。
 *
 * 断言（对应 Queue 验收 1/2/3 与必改 3）：
 *   ① **真实渲染路径的合成几何**：拦 `CanvasRenderingContext2D.drawImage`，抓「源 = 离屏战斗画布」
 *      的那一次合成，要求 `dstW/srcW === dstH/srcH`（X/Y 同一 scale）且 dst = 舞台带 390×648。
 *      旧实现这里是 1 与 2.146 —— 测试会直接失败。
 *   ② **页面自报的取景/合成读数**（`probe().battleFrame`）：safe 390×648、scaleX=scaleY、
 *      车辆世界宽高比 == 屏幕像素宽高比（比例未被破坏）。
 *   ③ **真实战斗帧截图**：整屏 + 舞台带裁切各一张（供人工核验「车辆/轮胎是不是圆轮」）。
 *   ④ **像素级动作证据**：战斗进行中相隔 ~1.1s 抓两帧做差，要求有真实位移像素（战斗在动，
 *      不是冻结帧）；并要求「运动包围盒高度」与相机预测的车高同量级 —— 若纵向被拉伸 2.146×，
 *      该比值会明显越界（回归警戒线）。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { launchBrowser } = require('./_browser_launch.cjs');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8161;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const SEED = process.env.ADV_F1_SEED || 'adv-r3-A';

/* 布局常量（与 advPage.ts / _e2e_adventure.cjs 同源） */
const LOGICAL_W = 390;
const LOGICAL_H = 844;
/**
 * FRUITS-ADVENTURE-UX-CONTINUITY-R1：舞台带从 390×648 改为**恒定** 390×378（y=92）。
 * 一屏式骨架里舞台只占中上段，下方 470..844 为叙事区与主操作位；
 * RESULT 不再改变舞台尺寸（旧实现会缩到 468，这是被 R1 消除的结构性隐患）。
 */
const STAGE_BAND = { x: 0, y: 92, w: LOGICAL_W, h: 378 };
const ACTION_BTN = { x: 40, y: 756, w: 310, h: 68 };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
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

/** 真实点击第 i 张浮层选项卡（几何与 advPage.layoutOptionCards 同源）。 */
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

/** 用真实点击推进到第一次 BATTLE（不等待战斗结束）。 */
async function driveToBattle(page) {
  let clicks = 0;
  for (let guard = 0; guard < 80; guard++) {
    const s = await page.evaluate(() => window.__adv.probe());
    if (s.phase === 'BATTLE') return { ok: true, clicks };
    if (s.overlayOpen) {
      await clickCard(page, 0);
      clicks++;
    } else {
      await clickActionIfNeeded(page);
      clicks++;
    }
    await page.waitForTimeout(120);
  }
  return { ok: false, clicks };
}

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'adventure.html'))) {
    console.error('[battle-frame-e2e] 未找到 dist-portrait-lab/adventure.html，请先 npm run build:portrait-lab');
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

    // ---- 拦真实合成：记录所有「源 = canvas」的 drawImage，并留下最近的离屏战斗画布 ----
    await page.addInitScript(() => {
      const orig = CanvasRenderingContext2D.prototype.drawImage;
      window.__ADV_BLITS__ = [];
      window.__F1_LAST_SRC__ = null;
      CanvasRenderingContext2D.prototype.drawImage = function (img, ...rest) {
        const isCanvas = img instanceof HTMLCanvasElement;
        if (isCanvas && rest.length === 8) {
          window.__ADV_BLITS__.push({
            sw: rest[2],
            sh: rest[3],
            dx: rest[4],
            dy: rest[5],
            dw: rest[6],
            dh: rest[7],
            srcW: img.width,
            srcH: img.height,
          });
          window.__F1_LAST_SRC__ = img;
        }
        return orig.call(this, img, ...rest);
      };
      // 帧抓取 / 帧差（像素证据用；只读 canvas）
      window.__F1__ = {
        grab() {
          const c = document.getElementById('adv-canvas');
          const g = c.getContext('2d');
          const dpr = c.width / 390;
          const y0 = Math.round(92 * dpr);
          return g.getImageData(0, y0, c.width, Math.round(378 * dpr));
        },
        diffBox(a, b, thr = 26) {
          let minX = 1e9;
          let minY = 1e9;
          let maxX = -1;
          let maxY = -1;
          let n = 0;
          const w = a.width;
          const h = a.height;
          const da = a.data;
          const db = b.data;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const i = (y * w + x) * 4;
              const d = Math.max(
                Math.abs(da[i] - db[i]),
                Math.abs(da[i + 1] - db[i + 1]),
                Math.abs(da[i + 2] - db[i + 2]),
              );
              if (d > thr) {
                n++;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
          return n > 0 ? { n, w: maxX - minX + 1, h: maxY - minY + 1, frameW: w, frameH: h } : { n: 0 };
        },
        distinctColors() {
          const c = document.getElementById('adv-canvas');
          const g = c.getContext('2d');
          const dpr = c.width / 390;
          const d = g.getImageData(0, Math.round(92 * dpr), c.width, Math.round(378 * dpr)).data;
          const set = new Set();
          for (let i = 0; i < d.length; i += 4 * 97) set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
          return set.size;
        },
        /**
         * 玩家车绿色车身在指定区域的像素包围盒（宽/高）。
         *
         * 为什么用它做比例标尺：离屏战斗画布由正式 Renderer 用**单一** `scale` 变换绘制，
         * 其内部几何天然等比；页面画布是合成结果。把「页面里的车身宽高比」与
         * 「离屏画布里的车身宽高比」相比 —— 若合成把某一轴拉伸，两者必然不等。
         * 该比较**不依赖车辆设计尺寸**，因此车辆美术改动不会误报。
         */
        blobAspect(canvas, y0, h) {
          const g = canvas.getContext('2d');
          const hh = h === undefined ? canvas.height : h;
          const w = canvas.width;
          const d = g.getImageData(0, y0, w, hh).data;
          let minX = 1e9;
          let minY = 1e9;
          let maxX = -1;
          let maxY = -1;
          let n = 0;
          for (let y = 0; y < hh; y++) {
            for (let x = 0; x < w; x++) {
              const i = (y * w + x) * 4;
              const r = d[i];
              const gg = d[i + 1];
              const bb = d[i + 2];
              if (gg > 80 && gg > r + 25 && gg > bb + 25) {
                n++;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
          if (n < 100) return { n, w: 0, h: 0, aspect: 0 };
          const bw = maxX - minX + 1;
          const bh = maxY - minY + 1;
          return { n, w: bw, h: bh, aspect: bw / bh };
        },
        /** 页面画布舞台带内的车身包围盒。 */
        pageBlob() {
          const c = document.getElementById('adv-canvas');
          const dpr = c.width / 390;
          return window.__F1__.blobAspect(c, Math.round(92 * dpr), Math.round(378 * dpr));
        },
        /** 离屏战斗画布（合成源，正式 Renderer 单一 scale 绘制）内的车身包围盒。 */
        srcBlob() {
          const c = window.__F1_LAST_SRC__;
          if (!c) return { n: 0, w: 0, h: 0, aspect: 0 };
          return window.__F1__.blobAspect(c, 0, c.height);
        },
      };
    });

    await page.goto(`${URL_BASE}/adventure.html?seed=${encodeURIComponent(SEED)}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__adv && !!window.__adv.probe, null, { timeout: 15000 });
    const boot = await page.evaluate(() => window.__adv.probe());
    log(true, 'F1 冒险页真实加载', `seed=${boot.seedLabel} phase=${boot.phase}`);

    // ---- 真实点击推进到 BATTLE ----
    const drove = await driveToBattle(page);
    const atBattle = await page.evaluate(() => window.__adv.probe());
    log(drove.ok && atBattle.phase === 'BATTLE', 'F1 真实点击链路推进到 BATTLE', `clicks=${drove.clicks} phase=${atBattle.phase}`);
    if (!drove.ok) throw new Error('未能进入 BATTLE');

    await page.waitForTimeout(700); // 让远摄→接近的相机真的动起来
    const frame1 = await page.evaluate(() => window.__adv.probe().battleFrame);
    const shotFull = path.join(ROOT, 'adv-f1-battle-full.png');
    const shotStage = path.join(ROOT, 'adv-f1-battle-stage.png');
    await page.screenshot({ path: shotFull });
    const rect = await page.evaluate(() => {
      const c = document.getElementById('adv-canvas');
      const r = c.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });
    const stageClip = {
      x: rect.left,
      y: rect.top + (STAGE_BAND.y / LOGICAL_H) * rect.height,
      width: rect.width,
      height: (STAGE_BAND.h / LOGICAL_H) * rect.height,
    };
    await page.screenshot({ path: shotStage, clip: stageClip });
    console.log(`[battle-frame-e2e] 截图: ${shotFull}`);
    console.log(`[battle-frame-e2e] 截图(舞台带): ${shotStage}`);

    // ---- ① 真实合成几何（drawImage 实参）----
    const blits = await page.evaluate(() => window.__ADV_BLITS__.slice(-80));
    // 战斗合成 = 目标矩形恰好是舞台带（0,96,390×648）的那次 drawImage。
    // ⚠️ 不按「源矩形 == 390×648」筛选：F4/F6 的自适应取景会把源矩形裁成子矩形
    //    （zoom>1 时源必然小于安全区），F1 要验的不变量是「X/Y 同一 scale + 铺满舞台带」，
    //    与源矩形大小无关。
    const battleBlit = [...blits]
      .reverse()
      .find(
        (b) =>
          Math.abs(b.dw - STAGE_BAND.w) < 1.5 &&
          Math.abs(b.dh - STAGE_BAND.h) < 1.5 &&
          Math.abs(b.dy - STAGE_BAND.y) < 1.5,
      );
    if (battleBlit) {
      const rx = battleBlit.dw / battleBlit.sw;
      const ry = battleBlit.dh / battleBlit.sh;
      log(
        Math.abs(rx - ry) < 1e-6,
        'F1 真实合成 X/Y 使用同一缩放系数（旧实现为 1 vs 2.146）',
        `src=${battleBlit.sw}x${battleBlit.sh} dst=${battleBlit.dw}x${battleBlit.dh} scaleX=${rx.toFixed(4)} scaleY=${ry.toFixed(4)}`,
      );
      log(
        Math.abs(battleBlit.dw - STAGE_BAND.w) < 1.5 && Math.abs(battleBlit.dh - STAGE_BAND.h) < 1.5,
        'F1 战斗画面铺满舞台带 390×378（无留白、无越界）',
        `dst=(${battleBlit.dx},${battleBlit.dy}) ${battleBlit.dw}×${battleBlit.dh}`,
      );
    } else {
      log(false, 'F1 抓到战斗合成调用', `blits=${JSON.stringify(blits.slice(-3))}`);
    }

    // ---- ② 页面自报读数 ----
    log(
      !!frame1 && frame1.uniform === true && frame1.safe.w === 390 && frame1.safe.h === 378,
      'F1 取景安全区 = 竖屏冒险舞台带（390×378），合成两轴系数相等',
      frame1 ? `safe=${frame1.safe.w}×${frame1.safe.h} viewport=${frame1.viewport.w}×${frame1.viewport.h} scaleX=${frame1.scaleX.toFixed(3)} scaleY=${frame1.scaleY.toFixed(3)}` : 'battleFrame=null',
    );
    if (frame1 && frame1.vehicleA) {
      const v = frame1.vehicleA;
      const dev = Math.abs(v.worldAspect - v.pxAspect) / v.worldAspect;
      log(
        dev < 1e-6,
        'F1 车辆宽高比在世界→屏幕两条路径上一致（比例未被破坏）',
        `world=${v.worldW.toFixed(1)}×${v.worldH.toFixed(1)}(${v.worldAspect.toFixed(3)}) px=${v.pxW.toFixed(1)}×${v.pxH.toFixed(1)}(${v.pxAspect.toFixed(3)}) 偏差=${(dev * 100).toFixed(4)}%`,
      );
    } else {
      log(false, 'F1 车辆比例读数可用', 'vehicleA=null');
    }

    // ---- ③ 画面非空 ----
    const colors = await page.evaluate(() => window.__F1__.distinctColors());
    log(colors > 60, 'F1 战斗帧包含真实画面（非空白）', `采样到的不同颜色数=${colors}`);

    // ---- ④ 像素动作证据 + 纵向比例警戒 ----
    // ImageData 不可跨 evaluate 传递 ⇒ 帧抓取与帧差都在页内完成，只把统计量取回。
    const moved = await page.evaluate(() => {
      const f = window.__F1__;
      const before = f.grab();
      return new Promise((resolve) => {
        setTimeout(() => resolve(f.diffBox(before, f.grab())), 1100);
      });
    });
    log(moved.n > 200, 'F1 战斗真的在动（1.1s 内像素位移）', `位移像素=${moved.n} 包围盒=${moved.w}×${moved.h}`);

    // 像素级比例标尺：页面合成后的车身宽高比 vs 离屏画布（正式 Renderer 单一 scale）里的同一辆车。
    // 两者必须一致；旧实现纵向 ×2.146 ⇒ 页面上这辆绿车的宽高比会小一半以上。
    const pixelAspect = await page.evaluate(() => ({
      page: window.__F1__.pageBlob(),
      src: window.__F1__.srcBlob(),
    }));
    const pa = pixelAspect.page;
    const sa = pixelAspect.src;
    const dev2 = sa.aspect > 0 ? Math.abs(pa.aspect - sa.aspect) / sa.aspect : 1;
    log(
      pa.n > 100 && sa.n > 100 && dev2 < 0.03,
      'F1 像素级：页面车身宽高比 == 离屏渲染车身高宽比（合成两轴等比）',
      `页面=${pa.w}×${pa.h}(${pa.aspect.toFixed(3)}) 离屏=${sa.w}×${sa.h}(${sa.aspect.toFixed(3)}) 偏差=${(dev2 * 100).toFixed(2)}%`,
    );

    // ---- ⑤ 战斗中段（接近/碰撞）：车辆成为主体，战斗动作清楚 ----
    await page.waitForTimeout(3200);
    const midPhase = await page.evaluate(() => window.__adv.probe());
    if (midPhase.phase === 'BATTLE') {
      const shotMid = path.join(ROOT, 'adv-f1-battle-mid.png');
      await page.screenshot({ path: shotMid, clip: stageClip });
      console.log(`[battle-frame-e2e] 截图(战斗中段): ${shotMid}`);
      const midFrame = await page.evaluate(() => window.__adv.probe().battleFrame);
      log(
        !!midFrame && midFrame.uniform === true,
        'F1 中段取景仍两轴同系数（相机拉近期间不产生失真）',
        midFrame
          ? `cameraScale=${midFrame.cameraScale.toFixed(3)} vehicle px=${midFrame.vehicleA ? `${midFrame.vehicleA.pxW.toFixed(0)}×${midFrame.vehicleA.pxH.toFixed(0)}` : 'n/a'}`
          : 'battleFrame=null',
      );
    } else {
      log(true, 'F1 战斗在中段截图前已结束（跳过中段断言）', `phase=${midPhase.phase}`);
    }

    // ---- ⑥ RESULT 阶段：主体层更矮（390×468）⇒ 等比铺满 + 纵向裁切（不压缩车辆）----
    await page.waitForFunction(() => window.__adv.probe().phase !== 'BATTLE', null, { timeout: 120000 });
    await page.waitForTimeout(250);
    const resultPhase = await page.evaluate(() => window.__adv.probe());
    const resultFrame = await page.evaluate(() => window.__adv.probe().battleFrame);
    if (resultFrame) {
      log(
        resultFrame.uniform === true && resultFrame.band.h === 378 && resultFrame.safe.h === 378,
        'F1 RESULT 战报帧：沿用 390×378 同一安全区（R1 起舞台高度恒定，不再缩成 468）',
        `band=${resultFrame.band.w}×${resultFrame.band.h} safe=${resultFrame.safe.w}×${resultFrame.safe.h} scaleX=${resultFrame.scaleX.toFixed(3)} scaleY=${resultFrame.scaleY.toFixed(3)}`,
      );
    } else {
      log(false, 'F1 RESULT 战报帧读数可用', `phase=${resultPhase.phase} battleFrame=null`);
    }
    const shotResult = path.join(ROOT, 'adv-f1-result-frame.png');
    await page.screenshot({ path: shotResult });
    console.log(`[battle-frame-e2e] 截图(RESULT): ${shotResult}`);

    const failures = results.filter((r) => !r.pass);
    console.log(`\n[battle-frame-e2e] ${results.length - failures.length}/${results.length} 通过`);
    process.exitCode = failures.length === 0 ? 0 : 1;
  } catch (err) {
    console.error('[battle-frame-e2e] 异常:', err && err.message ? err.message : err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
})();
