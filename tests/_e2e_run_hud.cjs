/**
 * UX-PERCEPTUAL-R2-A｜**战场底部战力状态面板**真实浏览器取证（R1 返修）。
 *
 * ── 取证什么（全部真源，零渲染外推）────────────────────────────────────────
 *   H-01 面板读数存在且形状正确（探针 statusHud：panel/visible/hp/hpMax/atk/hpBar）；
 *   H-02 耐久随**真实受击**变化：BATTLE 期间多点采样，hp 单调不增、
 *        受击后 hpBarFillW < barW（真源 = s.battle.playerHp，每帧 syncRunBattle 回写）；
 *   H-03 攻击读数与战斗世界真实武器伤害同源：hud.atk === playerWeapons[0].damage；
 *   H-04 **不遮挡**（本 Queue 核心）：
 *        a) 几何：面板在战场带内、水平居中、贴在战斗地线之下（面板顶 ≥ 地线 + 8px）；
 *        b) 逐帧采样两场战斗（含「菠萝冲刺车」跳劈场）的双方战车屏幕外接框，
 *           与面板**零重叠**（probe stage.player/enemy.bounds，带内坐标 +80 转页面坐标）；
 *        c) 动能冲击环（若出现）与面板零重叠；
 *   H-05 血条像素取证：前景色（hpBarFill/hpLow 精确 RGB）像素宽 == 探针声明 fillW（±2px）；
 *   H-06 攻击数字**真的够大**：面板内 dayAccent 精确色字形像素行高 ≥ 18px（32px 字号）；
 *   H-07 CHOICE 浮层期间面板**消失**（visible=false 且面板区 cardBg 精确色 ≤ 50px）；
 *   H-08 390×844 与窄桌面两种真实页面截图落盘（docs/ux-perceptual-r2/）。
 *
 * ── 时序纪律 ────────────────────────────────────────────────────────────────
 *   像素取证（H-03/05/06/08）在**战斗进行中、面板可见时现场取**（第二场采样达标即取），
 *   避免战斗结束进入终态/浮层面板消失导致的假红；几何/采样类断言循环后汇总。
 *
 * ── 纪律 ──────────────────────────────────────────────────────────────────
 *   真实浏览器 + 真实点击 + 零注入（复用 M5 E2E 的 launch/helper 形态）；
 *   只读探针与像素，不改变任何游戏行为；不删改任何既有断言口径（几何随 Queue 更新）。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { launchBrowser } = require('./_browser_launch.cjs');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const PORT = 8175;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const SHOT_DIR = path.join(__dirname, '..', 'docs', 'ux-perceptual-r2');
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/home.html';
    const filePath = path.join(ROOT, path.normalize(urlPath));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

async function clickSelector(page, sel) {
  const loc = page.locator(sel).first();
  await loc.scrollIntoViewIfNeeded();  // 卡阵是唯一滚动容器：卡可能在视口外（y>844）
  const box = await loc.boundingBox();
  if (!box) throw new Error(`无法定位元素：${sel}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(150);
}

async function clickRect(page, r) {
  const screen = (await page.evaluate(() => window.__RUNPAGE__.probe())).screen;
  const cx = screen.left + (r.x + r.w / 2) / 390 * screen.width;
  const cy = screen.top + (r.y + r.h / 2) / 844 * screen.height;
  await page.mouse.click(cx, cy);
  await sleep(180);
}

const probeRun = (page) => page.evaluate(() => window.__RUNPAGE__.probe());

/** 两个矩形是否真实重叠（边贴边不算）。 */
function overlaps(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }

/** 画布内某逻辑区域的**精确 RGB** 像素统计（DPR 无关：按画布 backing 比例换算）。 */
function scanRegion(page, rect) {
  return page.evaluate((r) => {
    const c = document.querySelector('#run-canvas');
    const cr = c.getBoundingClientRect();
    const ctx2 = c.getContext('2d');
    const sx = c.width / cr.width;
    const sy = c.height / cr.height;
    const x0 = Math.round(r.x / 390 * cr.width * sx);
    const y0 = Math.round(r.y / 844 * cr.height * sy);
    const w = Math.max(1, Math.round(r.w / 390 * cr.width * sx));
    const h = Math.max(1, Math.round(r.h / 844 * cr.height * sy));
    const img = ctx2.getImageData(x0, y0, w, h);
    const d = img.data;
    const byColor = {};
    for (let i = 0; i < d.length; i += 4) {
      const key = `${d[i]},${d[i + 1]},${d[i + 2]}`;
      byColor[key] = (byColor[key] || 0) + 1;
    }
    return { total: d.length / 4, byColor };
  }, rect);
}

/** 某逻辑区域内、包含指定精确色像素的**行数**（字形高度取证用）。 */
function colorRowSpan(page, rect, rgb) {
  return page.evaluate((info) => {
    const c = document.querySelector('#run-canvas');
    const cr = c.getBoundingClientRect();
    const ctx2 = c.getContext('2d');
    const sx = c.width / cr.width;
    const sy = c.height / cr.height;
    const x0 = Math.round(info.r.x / 390 * cr.width * sx);
    const y0 = Math.round(info.r.y / 844 * cr.height * sy);
    const w = Math.max(1, Math.round(info.r.w / 390 * cr.width * sx));
    const h = Math.max(1, Math.round(info.r.h / 844 * cr.height * sy));
    const img = ctx2.getImageData(x0, y0, w, h);
    const d = img.data;
    const [R, G, B] = info.rgb;
    let rows = 0;
    for (let y = 0; y < h; y++) {
      let hit = 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (d[i] === R && d[i + 1] === G && d[i + 2] === B) hit += 1;
      }
      if (hit >= 2) rows += 1;
    }
    return rows;
  }, { r: rect, rgb });
}

async function setupRun(page) {
  await page.goto(`${URL_BASE}/home.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__PRODUCTHOME__, null, { timeout: 20000 });
  // 换可通关装配（自然库存内），真实点击进 Run。
  await clickSelector(page, '[data-ph-action="open-garage"]');
  await clickSelector(page, '[data-ph-slot="body"]');
  await clickSelector(page, '[data-ph-body="mangoBody"]');
  await clickSelector(page, '[data-ph-action="modal-replace"]');
  await clickSelector(page, '[data-ph-slot="front"]');
  await clickSelector(page, '[data-ph-movement="smallWheel"]');
  await clickSelector(page, '[data-ph-action="modal-replace"]');
  await clickSelector(page, '[data-ph-slot="rear"]');
  await clickSelector(page, '[data-ph-movement="smallWheel"]');
  await clickSelector(page, '[data-ph-action="modal-replace"]');
  await clickSelector(page, '[data-ph-slot="weapon"]');
  await clickSelector(page, '[data-ph-weapon="machineGun"]');
  await clickSelector(page, '[data-ph-action="modal-replace"]');
  await clickSelector(page, '[data-ph-action="back-home"]');
  await page.waitForFunction(() => !!window.__PRODUCTHOME__, null, { timeout: 20000 });

  await Promise.all([
    page.waitForURL(/run-page\.html/, { timeout: 20000 }).catch(() => {}),
    clickSelector(page, '[data-ph-action="start-run"]'),
  ]);
  await page.waitForFunction(() => {
    const c = document.querySelector('#run-canvas');
    if (!window.__RUNPAGE__ || !c || c.width === 0) return false;
    const p = window.__RUNPAGE__.probe();
    return p.screen.width > 0 && p.assets.ready >= 5 && p.assets.failed.length === 0;
  }, null, { timeout: 25000 });
  await sleep(300);
}

/** 推进到 BATTLE 且面板可见（窄桌面截图用；独立页面）。 */
async function advanceToBattle(page) {
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    const p = await page.evaluate(() => window.__RUNPAGE__.probe());
    if (p.phase === 'BATTLE' && p.statusHud.visible) return true;
    if (p.durabilityOpen && p.overlayOptions.length > 0) await clickRect(page, p.overlayOptions[0].rect);
    else if (p.choiceOpen && p.choiceOptions.length > 0) await clickRect(page, p.choiceOptions[0].rect);
    else if (p.overlayOpen && p.overlayOptions.length > 0) await clickRect(page, p.overlayOptions[0].rect);
    else if (p.actionEnabled) await clickRect(page, p.actionRect);
    await sleep(300);
  }
  return false;
}

async function main() {
  console.log('=== UX-PERCEPTUAL-R2-A｜战场底部战力状态面板真实浏览器取证 ===\n');
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const server = await startServer();
  const browser = await launchBrowser(chromium);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));

  // 跨战斗采样累计器
  const carSamples = []; // { b, pl:[x,y,w,h], en:[...], visible, hp, fill, groundBandY }（页面坐标）
  let battlesSeen = 0;
  let prevPhase = '';
  let choiceHideChecked = false;
  let pixelDone = false;
  let lastProbe = null;

  try {
    await setupRun(page);

    // —— 推进 + 采样：覆盖两场真实战斗（第二场 = 菠萝冲刺车，含反复跳劈）——
    const t0 = Date.now();
    while (Date.now() - t0 < 170000) {
      const p = await probeRun(page);
      lastProbe = p;
      if (p.phase !== prevPhase) {
        if (p.phase === 'BATTLE') battlesSeen += 1;
        prevPhase = p.phase;
      }
      const hud = p.statusHud;
      if (!hud || !Number.isFinite(hud.hp) || !Number.isFinite(hud.hpMax) || hud.hpMax <= 0) {
        log(false, '[H-01] 探针 statusHud 形状正确', JSON.stringify(hud));
        break;
      }
      // 战斗中采样战车外接框（带内坐标 + 80 = 页面坐标）
      if (p.phase === 'BATTLE' && p.stage && p.stage.mode === 'battle' && p.stage.player && p.stage.enemy) {
        carSamples.push({
          b: battlesSeen,
          pl: [p.stage.player.bounds.x, p.stage.player.bounds.y + 80, p.stage.player.bounds.w, p.stage.player.bounds.h],
          en: [p.stage.enemy.bounds.x, p.stage.enemy.bounds.y + 80, p.stage.enemy.bounds.w, p.stage.enemy.bounds.h],
          visible: hud.visible,
          hp: hud.hp,
          fill: hud.hpBarFillW,
          groundBandY: p.battleWorld && p.battleWorld.camera ? p.battleWorld.camera.groundBandY : null,
        });
        const ki = p.battleWorld && p.battleWorld.kineticImpact;
        if (ki && ki.rings > 0) carSamples.push({ ring: [ki.bandX, ki.bandY + 80, ki.maxRadius, ki.maxRadius] });
      }
      // H-07：CHOICE 浮层期间面板必须消失（探针 + 像素双证）
      // ⚠️ 像素证据用**面板专属色签名**（dayAccent 大数字 / hpBarBg / hpBarFill / hpLow）——
      //    CHOICE 卡片底色也是 cardBg，用 cardBg 无法区分「面板」与「卡片」。
      if (!choiceHideChecked && p.choiceOpen && p.overlayOptions.length > 0) {
        choiceHideChecked = true;
        const pHide = await probeRun(page);
        const hideOk = pHide.statusHud.visible === false;
        const region = await scanRegion(page, pHide.statusHud.panel);
        const sig =
          (region.byColor['232,178,60'] || 0)   // dayAccent #e8b23c（32px 大数字）
          + (region.byColor['42,49,64'] || 0)   // hpBarBg  #2a3140（血条底槽）
          + (region.byColor['79,174,98'] || 0)  // hpBarFill #4fae62（血条前景）
          + (region.byColor['224,90,78'] || 0); // hpLow    #e05a4e
        log(
          hideOk && sig <= 8,
          '[H-07] CHOICE 浮层期间面板消失（visible=false 且面板专属色签名 ≤ 8px）',
          `visible=${pHide.statusHud.visible} signaturePx=${sig}`,
        );
      }
      // 第二场采样达标：现场取像素证据 + 截图（面板可见时刻），然后收尾
      if (!pixelDone && battlesSeen === 2 && carSamples.filter((s) => !s.ring && s.b === 2).length >= 18) {
        pixelDone = true;
        const panel = hud.panel;
        // H-03：攻击读数与战斗世界真实武器伤害同源
        if (p.battleWorld && p.battleWorld.playerWeapons.length > 0) {
          const w = p.battleWorld.playerWeapons[0];
          log(
            hud.atk === w.damage,
            '[H-03] 面板攻击 = 战斗世界真实武器伤害（同一 weaponMainDamage 合成链）',
            `hud.atk=${hud.atk} battleWorld.damage=${w.damage} weapon=${w.defId}★${w.star}`,
          );
        } else {
          log(hud.atk !== null, '[H-03] 面板攻击读数非空（战斗世界快照异常，同链复核由 vitest 承担）', `atk=${hud.atk}`);
        }
        // H-05：血条像素取证（扫**中心单行**：精确色像素宽 == 声明 fillW）
        {
          const bar = hud.hpBar;
          const rowRect = { x: bar.x, y: bar.y + Math.floor(bar.h / 2), w: bar.w, h: 1 };
          const region = await scanRegion(page, rowRect);
          const fill = region.byColor['79,174,98'] || 0;  // hpBarFill #4fae62
          const low = region.byColor['224,90,78'] || 0;   // hpLow #e05a4e
          const bg = region.byColor['42,49,64'] || 0;     // hpBarBg #2a3140
          const fillW = fill + low;
          log(
            Math.abs(fillW - hud.hpBarFillW) <= 2 && bg > 0,
            '[H-05] 血条像素取证：前景精确色像素宽 == 探针声明 fillW（±2px）',
            `fillPx=${fillW} declared=${hud.hpBarFillW} bgPx=${bg} bar=[${bar.x},${bar.y},${bar.w},${bar.h}]`,
          );
        }
        // H-06：攻击大数字真的够大（dayAccent 精确色字形行高 ≥ 18px）
        {
          const numRect = { x: panel.x + 10, y: panel.y + 26, w: 80, h: 36 };
          const rows = await colorRowSpan(page, numRect, [232, 178, 60]); // dayAccent #e8b23c
          log(
            rows >= 18,
            '[H-06] 攻击数字**够大**：面板内 32px 大数字字形像素行高 ≥ 18px（R1 为 17px 字号）',
            `dayAccentRows=${rows} zone=[${numRect.x},${numRect.y},${numRect.w},${numRect.h}]`,
          );
        }
        // H-08：截图（390×844 战斗实况 + 窄桌面 920×780）
        await page.screenshot({ path: path.join(SHOT_DIR, 'A-run-390-battle.png') });
        const dctx = await browser.newContext({ viewport: { width: 920, height: 780 }, deviceScaleFactor: 1 });
        const dpage = await dctx.newPage();
        try {
          await dpage.goto(`${URL_BASE}/run-page.html`, { waitUntil: 'load' });
          await dpage.waitForFunction(() => {
            const c = document.querySelector('#run-canvas');
            return !!window.__RUNPAGE__ && c && c.width > 0 && window.__RUNPAGE__.probe().assets.ready >= 5;
          }, null, { timeout: 25000 });
          const reached = await advanceToBattle(dpage);
          await sleep(500);
          await dpage.screenshot({ path: path.join(SHOT_DIR, 'A-run-desktop-battle.png') });
          log(reached, '[H-08] 截图落盘：390×844 + 窄桌面（920×780）战斗实况', SHOT_DIR);
        } finally {
          await dctx.close();
        }
        break;
      }
      if (p.durabilityOpen && p.overlayOptions.length > 0) await clickRect(page, p.overlayOptions[0].rect);
      else if (p.choiceOpen && p.choiceOptions.length > 0) await clickRect(page, p.choiceOptions[0].rect);
      else if (p.overlayOpen && p.overlayOptions.length > 0) await clickRect(page, p.overlayOptions[0].rect);
      else if (p.actionEnabled) await clickRect(page, p.actionRect);
      await sleep(300);
    }

    const p0 = lastProbe || (await probeRun(page));
    const hud0 = p0.statusHud;

    // H-01：形状（含新字段 visible / panel）
    log(
      !!hud0 && Number.isFinite(hud0.hp) && Number.isFinite(hud0.hpMax) && hud0.hpMax > 0
      && !!hud0.panel && !!hud0.hpBar && typeof hud0.visible === 'boolean',
      '[H-01] 探针 statusHud 存在：panel/visible/hp/hpMax/atk/hpBar 形状正确',
      JSON.stringify({ visible: hud0.visible, panel: hud0.panel, atk: hud0.atk, hp: hud0.hp, hpMax: hud0.hpMax }),
    );

    // H-02：耐久单调不增 + 确实被真实受击缩短
    const battleSamples = carSamples.filter((s) => !s.ring && s.b === 1);
    if (battleSamples.length >= 3) {
      const monotonicOk = battleSamples.every((s, i) => i === 0 || s.hp <= battleSamples[i - 1].hp + 1e-6);
      const first = battleSamples[0];
      const last = battleSamples[battleSamples.length - 1];
      log(
        monotonicOk,
        '[H-02a] 耐久随真实受击**单调不增**（syncRunBattle 每帧回写真源）',
        battleSamples.slice(0, 8).map((s) => `${Math.round(s.hp)}(${s.fill}px)`).join(' '),
      );
      log(
        last.hp < first.hp || last.fill < first.fill,
        '[H-02b] 血条**确实被真实受击缩短**（fill 随 hp 变化——不是静态装饰）',
        `first=${Math.round(first.hp)}(${first.fill}px) last=${Math.round(last.hp)}(${last.fill}px)`,
      );
    } else {
      log(false, '[H-02] BATTLE 采样不足（未能覆盖受击过程）', `n=${battleSamples.length}`);
    }

    // H-04a：几何（战场带内 / 水平居中）
    const panel = hud0.panel;
    log(
      panel.x >= 0 && panel.y >= 80 && panel.x + panel.w <= 390 && panel.y + panel.h <= 382
      && panel.x === Math.round((390 - panel.w) / 2),
      '[H-04a] 面板几何：战场带内 + 水平居中',
      `panel=[${panel.x},${panel.y},${panel.w},${panel.h}]`,
    );

    // H-04b：贴在战斗地线之下
    const groundSamples = carSamples.filter((s) => s.groundBandY !== null);
    const groundLinePage = groundSamples.length > 0 ? 80 + groundSamples[0].groundBandY : null;
    log(
      groundLinePage !== null && panel.y >= groundLinePage + 8,
      '[H-04b] 面板贴在战斗地线之下（不遮站台上的战车）',
      `panel.y=${panel.y} groundLine=${groundLinePage}`,
    );

    // H-04c：逐帧采样双方战车，与面板零重叠
    const carRects = carSamples.filter((s) => !s.ring);
    let overlapCount = 0;
    let minPlTop = 1e9;
    let minEnTop = 1e9;
    for (const s of carRects) {
      const pl = { x: s.pl[0], y: s.pl[1], w: s.pl[2], h: s.pl[3] };
      const en = { x: s.en[0], y: s.en[1], w: s.en[2], h: s.en[3] };
      minPlTop = Math.min(minPlTop, pl.y);
      minEnTop = Math.min(minEnTop, en.y);
      if (overlaps(panel, pl) || overlaps(panel, en)) overlapCount += 1;
    }
    log(
      overlapCount === 0 && carRects.length >= 20,
      '[H-04c] 两场战斗逐帧采样：面板与双方战车外接框**零重叠**（含跳劈车）',
      `samples=${carRects.length} overlaps=${overlapCount} minPlayerTop=${Math.round(minPlTop)} minEnemyTop=${Math.round(minEnTop)} panelBottom=${panel.y + panel.h}`,
    );

    // H-04d：动能冲击环（若出现）与面板零重叠
    const ringRects = carSamples.filter((s) => s.ring);
    let ringOverlap = 0;
    for (const r of ringRects) {
      const ring = { x: r.ring[0] - r.ring[2], y: r.ring[1] - r.ring[3], w: r.ring[2] * 2, h: r.ring[3] * 2 };
      if (overlaps(panel, ring)) ringOverlap += 1;
    }
    log(
      ringOverlap === 0,
      '[H-04d] 动能冲击环（若出现）与面板零重叠',
      `ringSamples=${ringRects.length} overlaps=${ringOverlap}`,
    );

    if (!pixelDone) {
      log(false, '[H-03/05/06/08] 未能在战斗 2 面板可见时取得像素证据', `battlesSeen=${battlesSeen} samples=${carRects.length}`);
    }

    // H-E：全流程零 JS 错误
    log(pageErrors.length === 0, '[H-E] 全取证零运行时报错', pageErrors.slice(0, 2).join(' | ') || 'none');
  } catch (err) {
    log(false, '[F0] 未捕获异常', String(err && err.stack ? err.stack.split('\n')[0] : err));
    console.error(err);
  } finally {
    await browser.close();
    server.close();
  }

  const pass = results.filter((r) => r.pass === true).length;
  const failed = results.filter((r) => r.pass === false);
  console.log(`\n=== 结果：${pass}/${results.length} PASS，${failed.length} FAIL ===`);
  if (failed.length > 0) {
    for (const f of failed) console.log(` - ${f.name} | ${f.detail}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error('E2E 失败：', e && e.stack ? e.stack : e); process.exit(1); });
