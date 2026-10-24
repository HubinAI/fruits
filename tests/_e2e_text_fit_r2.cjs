/**
 * R2 卡片文字是否真的被截断 —— **实测**，不靠几何推断。
 *
 * 手段：在页面里用 canvas 真实 measureText 量每个真实选项的文本，
 * 与卡片实际可用的文本宽度/高度比较。
 *
 * 输出每个选项的：
 *   label 是否超宽（会被 fitText 截断 → 出现省略号）
 *   gain / cost 是否超宽
 *   卡片内可用行数 vs 实际需要行数
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { launchBrowser } = require('./_browser_launch.cjs');

const ROOT = path.join(__dirname, '..', 'dist-portrait-lab');
const OUT = path.join(__dirname, '..', 'docs', 'adventure-ux-coherence-r2', 'evidence');
const PORT = 8201;
const SEED = process.env.R2_SEED || 'scan-4';

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

(async () => {
  const server = await startServer();
  const browser = await launchBrowser(chromium);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const rows = [];
  try {
    await page.goto(`http://127.0.0.1:${PORT}/adventure.html?seed=${SEED}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__adv, null, { timeout: 20000 });
    fs.mkdirSync(OUT, { recursive: true });

    for (let step = 0; step < 160; step++) {
      const s = await page.evaluate(() => window.__adv.probe());
      if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
      if (s.overlayOpen) {
        // 在**真实页面**里量文本（与绘制同一套字体栈与字号）
        const m = await page.evaluate(() => {
          const d = window.__adv.diagnose();
          const rects = window.__adv.probe().continuity.optionRects;
          const c = document.createElement('canvas').getContext('2d');
          const FONT = getComputedStyle(document.body).fontFamily || 'system-ui';
          const out = [];
          const r0 = rects[0] || { w: 362, h: 112 };
          // ⚠️ 与 advPage.drawChoiceCard 的**真实**版面常数逐项一致（R2 三行版式）：
          const padX = 14;
          const iconSize = 40;
          const tx = padX + iconSize + 12;         // 文本列起点（相对卡片左边）
          const rightLimit = r0.w - padX;          // 文本列右界（相对卡片左边）
          const textW = rightLimit - tx;           // 名称可用宽度
          const labelCol = 34;                     // 「收益 / 代价」标签列
          const gainAvail = textW - labelCol;      // 收益/代价内容可用宽度
          for (const o of d.options || []) {
            c.font = `700 19px ${FONT}`;
            const wLabel = c.measureText(o.label || '').width;
            c.font = `600 14px ${FONT}`;
            const wGain = c.measureText(o.gain || '').width;
            const wCost = c.measureText(o.cost || '').width;
            c.font = `500 11px ${FONT}`;
            const wCaveat = c.measureText(o.caveat || '').width;
            const caveatFits =
              !o.caveat || labelCol + Math.min(wCost, gainAvail) + 10 + wCaveat <= textW;
            out.push({
              id: o.id,
              label: o.label,
              gain: o.gain,
              cost: o.cost,
              caveat: o.caveat || '',
              labelW: Math.round(wLabel),
              gainW: Math.round(wGain),
              costW: Math.round(wCost),
              textW: Math.round(textW),
              gainAvail: Math.round(gainAvail),
              labelClipped: wLabel > textW,
              gainClipped: wGain > gainAvail,
              costClipped: wCost > gainAvail,
              caveatFits,
              kind: d.kind,
              n: (d.options || []).length,
              cardH: Math.round(r0.h),
              cardW: Math.round(r0.w),
            });
          }
          return out;
        });
        rows.push(...m);
        // 点第一张继续推进
        const rects = s.continuity.optionRects;
        await page.mouse.click(rects[0].x + rects[0].w / 2, rects[0].y + rects[0].h / 2);
        await page.waitForTimeout(420);
        continue;
      }
      if (s.phase === 'BATTLE') {
        await page.waitForFunction(() => window.__adv.probe().phase !== 'BATTLE', null, { timeout: 180000 });
        continue;
      }
      if (s.continuity.needsPlayer) {
        await page.mouse.click(34 + 322 / 2, 758 + 66 / 2);
        await page.waitForTimeout(260);
        continue;
      }
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

  const clipped = rows.filter((r) => r.labelClipped || r.gainClipped || r.costClipped);
  const caveatMissed = rows.filter((r) => r.caveatFits === false);
  console.log(`\n量到 ${rows.length} 个选项，其中被截断 ${clipped.length} 个：`);
  for (const r of rows) {
    const tag = r.labelClipped || r.gainClipped || r.costClipped ? 'CLIP' : ' ok ';
    console.log(
      `  [${tag}] ${r.kind}/${r.id} n=${r.n} card=${r.cardW}x${r.cardH} ` +
        `label="${r.label}" ${r.labelW}/${r.textW} | gain="${r.gain}" ${r.gainW}/${r.gainAvail} | cost="${r.cost}" ${r.costW}/${r.gainAvail}`,
    );
  }
  if (caveatMissed.length) {
    console.log(`\n另外 ${caveatMissed.length} 个 caveat 放不进代价行（绘制时会跳过）：`);
    for (const r of caveatMissed) console.log(`  ${r.kind}/${r.id} caveat="${r.caveat}"`);
  }
  fs.writeFileSync(
    path.join(OUT, 'text-fit.json'),
    JSON.stringify({ seed: SEED, rows, clipped: clipped.length, caveatMissed: caveatMissed.length }, null, 1),
    'utf-8',
  );
  process.exitCode = clipped.length === 0 ? 0 : 1;
})();
