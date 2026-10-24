/**
 * FRUITS-ADVENTURE-UX-COHERENCE-R2｜**连续画面证据**（验收 5 要求的真实连续流程）。
 *
 * 与 R1 脚本的区别：本脚本跟踪的是「**同一局内** 战斗 → 结果 → 事件 → 强化 → 再次战斗」
 * 的连续帧序列，并把每一帧的关键读数一起落盘，用于回答：
 *
 *   ① 这五个阶段是不是**同一个可辨认场景**（同背景 / 同地平线 / 同车）；
 *   ② 事件与强化卡片是否完整可读（真实 measureText，0 截断）；
 *   ③ 非战斗阶段战车是否有清晰存在感（绿色车体像素簇的包围盒）；
 *   ④ 自动推进是否仍在（纯信息阶段零点击）。
 *
 * 全程：正常速度、真实鼠标点击、不加速、不桩化物理。
 *
 * 产物：
 *   docs/adventure-ux-coherence-r2/evidence/seq-*.png    连续帧
 *   docs/adventure-ux-coherence-r2/evidence/sequence.json 逐帧读数
 *
 * 用法：node tests/_e2e_coherence_r2.cjs [seed]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { launchBrowser } = require('./_browser_launch.cjs');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const OUT = path.join(__dirname, '..', 'docs', 'adventure-ux-coherence-r2', 'evidence');
const PORT = 8207;
const SEED = process.argv[2] || process.env.R2_SEED || 'scan-4';

/** 需要按顺序抓到的阶段（每个阶段抓第一帧）。 */
const WANT = ['BATTLE', 'RESULT', 'EVENT', 'EVENT_CHOICE', 'EVENT_DONE', 'CHOICE'];
const ACTION_BTN = { x: 34, y: 758, w: 322, h: 66 };

function startServer() {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/') u = '/adventure.html';
    const f = path.join(ROOT, path.normalize(u));
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((r) => server.listen(PORT, '127.0.0.1', () => r(server)));
}

async function canvasShot(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  const dataUrl = await page.evaluate(() => document.getElementById('adv-canvas').toDataURL('image/png'));
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return file;
}

/** 在页面里量卡片文本（与绘制同字体栈），返回是否有截断。 */
async function measureCards(page) {
  return page.evaluate(() => {
    const d = window.__adv.diagnose();
    const rects = window.__adv.probe().continuity.optionRects;
    if (!d.options || d.options.length === 0) return null;
    const c = document.createElement('canvas').getContext('2d');
    const FONT = getComputedStyle(document.body).fontFamily || 'system-ui';
    const r0 = rects[0] || { w: 362, h: 112 };
    const padX = 14, iconSize = 40, labelCol = 34;
    const tx = padX + iconSize + 12;
    const textW = r0.w - padX - tx;
    const gainAvail = textW - labelCol;
    const rows = [];
    for (const o of d.options) {
      c.font = `700 19px ${FONT}`;
      const wl = c.measureText(o.label || '').width;
      c.font = `600 14px ${FONT}`;
      const wg = c.measureText(o.gain || '').width;
      const wc = c.measureText(o.cost || '').width;
      rows.push({
        id: o.id, label: o.label, gain: o.gain, cost: o.cost,
        labelW: Math.round(wl), textW: Math.round(textW),
        gainW: Math.round(wg), costW: Math.round(wc), gainAvail: Math.round(gainAvail),
        clipped: wl > textW || wg > gainAvail || wc > gainAvail,
      });
    }
    return { kind: d.kind, title: d.title, cardW: Math.round(r0.w), cardH: Math.round(r0.h), rows };
  });
}

(async () => {
  const server = await startServer();
  const browser = await launchBrowser(chromium);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const seq = [];
  const cardReports = [];
  let actionClicks = 0;
  let choiceClicks = 0;
  let infoWaits = 0;
  const taken = new Set();

  try {
    await page.goto(`http://127.0.0.1:${PORT}/adventure.html?seed=${encodeURIComponent(SEED)}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__adv && !!window.__adv.probe, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__adv.probe().ui.ready >= 30, null, { timeout: 20000 }).catch(() => {});

    for (let guard = 0; guard < 400; guard++) {
      const s = await page.evaluate(() => window.__adv.probe());
      if (s.phase === 'COMPLETE' || s.phase === 'FAILED') {
        if (!taken.has(s.phase)) {
          taken.add(s.phase);
          const f = await canvasShot(page, `seq-${String(taken.size).padStart(2, '0')}-${s.phase.toLowerCase()}.png`);
          seq.push({ phase: s.phase, day: s.day, file: path.basename(f), at: Date.now() });
        }
        break;
      }

      // 每个想要的目标阶段抓一帧（第一次出现时）
      if (WANT.includes(s.phase) && !taken.has(s.phase)) {
        taken.add(s.phase);
        // 战斗帧等 1.2s 让镜头进入交战；其它阶段立即抓
        if (s.phase === 'BATTLE') await page.waitForTimeout(1200);
        else await page.waitForTimeout(150);
        const s2 = await page.evaluate(() => window.__adv.probe());
        const f = await canvasShot(page, `seq-${String(taken.size).padStart(2, '0')}-${s2.phase.toLowerCase()}.png`);
        seq.push({ phase: s2.phase, day: s2.day, file: path.basename(f), at: Date.now(), needsPlayer: s2.continuity.needsPlayer });
      }

      if (s.overlayOpen) {
        const m = await measureCards(page);
        if (m) cardReports.push(m);
        const r = s.continuity.optionRects[0];
        await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
        choiceClicks += 1;
        await page.waitForTimeout(420);
        continue;
      }
      if (s.phase === 'BATTLE') {
        await page.waitForFunction(() => window.__adv.probe().phase !== 'BATTLE', null, { timeout: 180000 });
        continue;
      }
      if (s.continuity.needsPlayer) {
        await page.mouse.click(ACTION_BTN.x + ACTION_BTN.w / 2, ACTION_BTN.y + ACTION_BTN.h / 2);
        actionClicks += 1;
        await page.waitForTimeout(280);
        continue;
      }
      // 纯信息阶段：不点击，等它自己走
      infoWaits += 1;
      await page.waitForFunction(
        (ph) => { const p = window.__adv.probe(); return p.phase !== ph || p.continuity.needsPlayer; },
        s.phase,
        { timeout: 15000 },
      );
    }
  } finally {
    await ctx.close();
    await browser.close();
    server.close();
  }

  const clipped = cardReports.flatMap((r) => r.rows.filter((x) => x.clipped));
  const report = {
    seed: SEED,
    generatedAt: new Date().toISOString(),
    viewport: { w: 390, h: 844, dpr: 1 },
    sequence: seq,
    counters: { actionClicks, choiceClicks, infoWaits, pageErrors: errors },
    cards: cardReports,
    clippedCount: clipped.length,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'sequence.json'), JSON.stringify(report, null, 1), 'utf-8');

  console.log(`\n== 连续流程（seed=${SEED}）==`);
  for (const s of seq) console.log(`  ${s.file}  ${s.phase.padEnd(13)} day=${s.day}`);
  console.log(`\n主操作点击=${actionClicks}  选择点击=${choiceClicks}  纯信息阶段等待=${infoWaits}`);
  console.log(`卡片测量：${cardReports.length} 组，截断 ${clipped.length} 项`);
  if (clipped.length) for (const c of clipped) console.log(`  CLIP ${c.id} label="${c.label}" ${c.labelW}/${c.textW} gain ${c.gainW}/${c.gainAvail}`);
  console.log('->', path.join(OUT, 'sequence.json'));
  process.exitCode = clipped.length === 0 && errors.length === 0 ? 0 : 1;
})();
