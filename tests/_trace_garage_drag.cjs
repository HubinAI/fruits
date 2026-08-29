/**
 * F-GARAGE-DRAG-CONTINUITY-R1｜Must#1 事件链追踪工具（调查用，不参与门禁）
 *
 * 目的：在真实浏览器（1920×1008 @ DPR1.5）复现用户拖动操作，记录完整事件链，
 *      定位「状态在哪一段丢失」。不修改任何产品代码。
 *
 * 每事件记录：timestamp / pointerId / pointerType / client 坐标 / logical 坐标 /
 *            累计 dx·dy / 修改前后 drag state / pointer capture 状态 / ghost 坐标 /
 *            最近挂点及距离 / 取消或完成原因。
 *
 * 用法：ENVS=1920x1008@1.5 node tests/_trace_garage_drag.cjs
 */
const { chromium } = require('playwright-core');
const path = require('path');

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:8138/';
const ENVS = (process.env.ENVS || '1920x1008@1.5').split(',');
const SCENES = (process.env.SCENES || '1,2,3,4,5,7').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
function log(s) {
  out.push(s);
  console.log(s);
}

// ---------- 页面内 recorder 注入 ----------
const RECORDER = () => {
  const w = window;
  w.__trace = [];
  w.__frames = [];
  w.__recOn = true;

  // pointer capture 调用追踪
  const origSet = Element.prototype.setPointerCapture;
  const origRel = Element.prototype.releasePointerCapture;
  w.__capLog = [];
  Element.prototype.setPointerCapture = function (id) {
    w.__capLog.push({ t: +performance.now().toFixed(1), op: 'set', pointerId: id, tag: this.tagName });
    try {
      return origSet.call(this, id);
    } catch {
      return undefined;
    }
  };
  Element.prototype.releasePointerCapture = function (id) {
    w.__capLog.push({ t: +performance.now().toFixed(1), op: 'release', pointerId: id, tag: this.tagName });
    try {
      return origRel.call(this, id);
    } catch {
      return undefined;
    }
  };

  const snap = () => {
    const h = w.__h;
    const d = h && h.garageDrag;
    if (!d) return null;
    return {
      phase: d.phase,
      x: +d.x.toFixed(1),
      y: +d.y.toFixed(1),
      sx: +d.startX.toFixed(1),
      sy: +d.startY.toFixed(1),
      hoverHp: d.hoverHp,
      overload: d.overload,
      armed: d.armed,
      submitted: d.submitted,
      card: d.card ? d.card.v : null,
    };
  };
  const nearest = () => {
    const h = w.__h;
    const d = h && h.garageDrag;
    const s = h && h.lastState;
    if (!d || !s || !s.hardpointScreenPts) return null;
    let best = null;
    let bd = Infinity;
    for (const p of s.hardpointScreenPts) {
      const dist = Math.hypot(d.x - p.x, d.y - p.y);
      if (dist < bd) {
        bd = dist;
        best = p.id;
      }
    }
    return { id: best, dist: +bd.toFixed(1) };
  };

  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
    w.addEventListener(
      type,
      (ev) => {
        if (!w.__recOn) return;
        const before = snap();
        const rec = {
          t: +performance.now().toFixed(1),
          kind: type,
          pointerId: ev.pointerId !== undefined ? ev.pointerId : null,
          pointerType: ev.pointerType || null,
          client: [Math.round(ev.clientX || 0), Math.round(ev.clientY || 0)],
          before,
          ghostBefore: before ? { x: before.x, y: before.y } : null,
          nearestBefore: nearest(),
          after: null,
        };
        w.__trace.push(rec);
        // host handler 在 bubble 阶段执行 → setTimeout(0) 采样得到「修改后」
        setTimeout(() => {
          rec.after = snap();
          rec.ghostAfter = rec.after ? { x: rec.after.x, y: rec.after.y } : null;
          rec.nearestAfter = nearest();
        }, 0);
      },
      true,
    );
  }

  // 每帧采样（ghost 连续性检测）
  let f = 0;
  const loop = () => {
    if (w.__recOn) {
      const s = snap();
      w.__frames.push({ f: f++, t: +performance.now().toFixed(1), s, ghost: s ? { x: s.x, y: s.y } : null, nearest: nearest() });
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  w.__reset = () => {
    w.__trace = [];
    w.__frames = [];
    w.__capLog = [];
  };
};

async function inject(page) {
  await page.evaluate(RECORDER);
}

async function dumpTrace(page, title) {
  const data = await page.evaluate(() => ({
    trace: window.__trace,
    frames: window.__frames,
    cap: window.__capLog,
  }));
  log(`\n  ── ${title} ──`);
  log('  |  t(ms) | event          | id/typ      | client      | before→after phase            | ghost(logical)        | nearest          |');
  log('  |--------|----------------|-------------|-------------|-------------------------------|-----------------------|------------------|');
  for (const r of data.trace) {
    const bp = r.before ? r.before.phase : 'null';
    const ap = r.after === null ? '(pending)' : r.after ? r.after.phase : 'null';
    const gh = r.after && r.after !== null ? `${r.after.x},${r.after.y}` : r.before ? `${r.before.x},${r.before.y}` : '-';
    const nn = r.nearestAfter || r.nearestBefore;
    log(
      `  | ${String(r.t).padStart(6)} | ${r.kind.padEnd(14)} | ${String(r.pointerId).padEnd(4)}/${String(r.pointerType || '-').padEnd(6)} | ${String(r.client[0]).padStart(4)},${String(r.client[1]).padStart(4)} | ${(bp + '→' + ap).padEnd(29)} | ${gh.padEnd(21)} | ${nn ? nn.id + ' ' + nn.dist : '-'} |`,
    );
  }
  // ghost 帧连续性
  const DRAGP = ['draggingPart', 'hoveringValidMount', 'hoveringInvalidMount'];
  const dragging = data.frames.filter((fr) => fr.s && DRAGP.includes(fr.s.phase));
  log(`  frames=${data.frames.length} draggingFrames=${dragging.length} capOps=${data.cap.length}`);
  if (data.cap.length) log(`  capture: ${JSON.stringify(data.cap)}`);
  // 按【手势段】切分：phase 从非 dragging → dragging 视为新段（跨手势的 idle 间隔
  // 不得算作 ghost 缺失，否则会把「两次拖装之间」误判为帧缺口/跳变）
  const segs = [];
  let cur = null;
  for (const fr of data.frames) {
    const on = !!(fr.s && DRAGP.includes(fr.s.phase));
    if (on) {
      if (fr.f - (cur ? cur.lastF : -999) > 1) {
        cur = { start: fr.f, lastF: fr.f, items: [fr] };
        segs.push(cur);
      } else {
        cur.lastF = fr.f;
        cur.items.push(fr);
      }
    } else {
      cur = null;
    }
  }
  log(`  手势段数=${segs.length}（每段 = 一次连续 draggingPart 区间）`);
  segs.forEach((sg, i) => {
    const miss = [];
    const jumps = [];
    for (let k = 1; k < sg.items.length; k++) {
      const gap = sg.items[k].f - sg.items[k - 1].f;
      if (gap > 1) miss.push(`f${sg.items[k - 1].f}→f${sg.items[k].f}(缺${gap - 1})`);
      const d = Math.hypot(sg.items[k].ghost.x - sg.items[k - 1].ghost.x, sg.items[k].ghost.y - sg.items[k - 1].ghost.y);
      if (d > 120) jumps.push(`f${sg.items[k].f} ${d.toFixed(0)}px`);
    }
    const bad = miss.length || jumps.length;
    log(
      `  段${i + 1}(f${sg.start}~f${sg.lastF}, ${sg.items.length}帧): 帧缺口=${miss.length ? miss.join(',') : '无'} | 跳变=${jumps.length ? jumps.join(',') : '无'} ${bad ? '  ★异常' : ''}`,
    );
  });
  return data;
}

async function diag(page) {
  return page.evaluate(() => {
    const h = globalThis.__h;
    if (!h) return null;
    const list = (h.hitAreas || []).filter((a) => a && a.id);
    const by = (p) => list.filter((a) => a.id.startsWith(p)).map((a) => ({ id: a.id, x: a.x, y: a.y, w: a.w, h: a.h }));
    const s = h.lastState;
    const d = s && s.draft;
    return {
      opts: by('opt:'),
      cats: by('garage-cat:'),
      hps: s && s.hardpointScreenPts ? s.hardpointScreenPts.map((p) => ({ id: p.id, kind: p.kind, x: p.x, y: p.y, occupied: p.occupied })) : [],
      row: h.stripCardRow ? { ...h.stripCardRow } : null,
      cat: h.getGarageCategory ? h.getGarageCategory() : null,
      meta: h.metaPage,
      phase: s && s.playerPhase,
      draft: d ? { body: d.bodyDefId, rear: d.rearRadius, front: d.frontRadius, sel: JSON.parse(JSON.stringify(d.functionalSelections || {})) } : null,
      cssW: h.cssW,
    };
  });
}

async function toClient(page, lx, ly) {
  const box = await page.locator('canvas').first().boundingBox();
  const t = await page.evaluate(() => globalThis.__h.getTransformInfo());
  const k = t.cssW > 0 ? box.width / t.cssW : 1;
  return { x: box.x + (t.ox + t.scale * lx) * k, y: box.y + (t.oy + t.scale * ly) * k };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MSEDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  for (const envSpec of ENVS) {
    const [dim, dprS] = envSpec.split('@');
    const [vw, vh] = dim.split('x').map(Number);
    const dpr = Number(dprS || 1);
    log(`\n================ ${vw}x${vh} @DPR${dpr} ================`);
    const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.goto(`${BASE}?player=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!globalThis.__h, null, { timeout: 15000 }).catch(() => {});
    await sleep(700);
    await inject(page);

    // 进入 Garage
    await page.evaluate(() => {
      const h = globalThis.__h;
      if (h.metaPage !== 'garage') {
        const home = (h.hitAreas || []).find((a) => a.id === 'home-garage');
        if (home) h.dispatch ? h.dispatch('home-garage') : null;
      }
    });
    await sleep(600);
    const d0 = await diag(page);
    log(`  meta=${d0.meta} phase=${d0.phase} cat=${d0.cat} cssW=${d0.cssW} cards=${d0.opts.length} hps=${d0.hps.length}`);
    if (!d0.opts.length) {
      log('  !! 无卡片，跳过');
      await context.close();
      continue;
    }

    // ---- 场景 1：慢速斜向拖动（真实玩家抖动：dx 与 dy 量级相近）----
    if (SCENES.includes('1')) {
      const card = d0.opts[0];
      const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
      const hp = d0.hps.find((p) => p.kind === 'movement') || d0.hps[0];
      const to = { x: hp.x, y: hp.y };
      log(`\n  【场景1】慢速斜向拖动：卡片 ${card.id}(${from.x.toFixed(0)},${from.y.toFixed(0)}) → 挂点 ${hp.id}(${to.x.toFixed(0)},${to.y.toFixed(0)})`);
      await page.evaluate(() => window.__reset());
      const a = await toClient(page, from.x, from.y);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await sleep(60); // 按住反馈窗口（Must#5 80ms）
      // 斜向：每步 dx=+3 dy=-3（玩家真实抖动，dx≈dy）
      const steps = 26;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        // 斜向路径 + 轻微横向抖动（模拟真人）
        const lx = from.x + (to.x - from.x) * t + (i % 2 === 0 ? 2.5 : -2.5);
        const ly = from.y + (to.y - from.y) * t;
        const c = await toClient(page, lx, ly);
        await page.mouse.move(c.x, c.y);
        await sleep(33); // ~30Hz
      }
      await page.mouse.up();
      await sleep(300);
      await dumpTrace(page, '场景1 事件链（慢速斜向）');
      const d1 = await diag(page);
      log(`  结果: draft=${JSON.stringify(d1.draft)} drag=${JSON.stringify((await page.evaluate(() => globalThis.__h.garageDrag)))}`);
    }

    // ---- 场景 1b：先纯垂直上移进入 draggingPart，再斜向移动到挂点（对照实验）----
    if (SCENES.includes('1b')) {
      const db = await diag(page);
      const card = db.opts[0];
      const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
      const hp = db.hps.find((p) => p.kind === 'movement') || db.hps[0];
      log(`\n  【场景1b】垂直起步再斜向：${card.id}(${from.x.toFixed(0)},${from.y.toFixed(0)}) → ${hp.id}(${hp.x.toFixed(0)},${hp.y.toFixed(0)})`);
      const beforeDraft = JSON.stringify(db.draft);
      await page.evaluate(() => window.__reset());
      const a = await toClient(page, from.x, from.y);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await sleep(60);
      // 第一步：纯垂直上移 14px（无横向分量）→ 应进入 draggingPart
      const c1 = await toClient(page, from.x, from.y - 14);
      await page.mouse.move(c1.x, c1.y);
      await sleep(60);
      const midDrag = await page.evaluate(() => (globalThis.__h.garageDrag ? globalThis.__h.garageDrag.phase : null));
      log(`   垂直起步后 phase=${midDrag}`);
      // 之后：自由斜向移动到挂点（真实玩家不会保持绝对垂直）
      for (let i = 1; i <= 12; i++) {
        const lx = from.x + ((hp.x - from.x) * i) / 12;
        const ly = from.y - 14 + ((hp.y - (from.y - 14)) * i) / 12;
        const c = await toClient(page, lx, ly);
        await page.mouse.move(c.x, c.y);
        await sleep(33);
      }
      const beforeUp = await page.evaluate(() => (globalThis.__h.garageDrag ? { phase: globalThis.__h.garageDrag.phase, hoverHp: globalThis.__h.garageDrag.hoverHp } : null));
      log(`   up 前 phase=${JSON.stringify(beforeUp)}`);
      await page.mouse.up();
      await sleep(300);
      const afterD = await diag(page);
      log(`   draft ${beforeDraft} → ${JSON.stringify(afterD.draft)}`);
      await dumpTrace(page, '场景1b 事件链（垂直起步再斜向）');
    }

    // ---- 场景 2：30Hz 稀疏 move ----
    if (SCENES.includes('2')) {
      const d1 = await diag(page);
      const card = d1.opts[1] || d1.opts[0];
      const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
      const hp = d1.hps.find((p) => p.kind === 'movement') || d1.hps[0];
      log(`\n  【场景2】30Hz 稀疏 move（大步长）: ${card.id} → ${hp.id}`);
      await page.evaluate(() => window.__reset());
      const a = await toClient(page, from.x, from.y);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await sleep(40);
      for (let i = 1; i <= 8; i++) {
        const lx = from.x + ((hp.x - from.x) * i) / 8;
        const ly = from.y + ((hp.y - from.y) * i) / 8;
        const c = await toClient(page, lx, ly);
        await page.mouse.move(c.x, c.y);
        await sleep(33);
      }
      await page.mouse.up();
      await sleep(300);
      await dumpTrace(page, '场景2 事件链（30Hz 稀疏）');
    }

    // ---- 场景 3：离开卡片/装配带 进入车辆区域 ----
    if (SCENES.includes('3')) {
      const d2 = await diag(page);
      const card = d2.opts[2] || d2.opts[0];
      const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
      const hp = d2.hps.find((p) => p.kind === 'movement') || d2.hps[0];
      log(`\n  【场景3】离开装配带进车辆区（先向左出带，再向挂点）: ${card.id} → ${hp.id}`);
      await page.evaluate(() => window.__reset());
      const a = await toClient(page, from.x, from.y);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await sleep(40);
      const waypoints = [
        { x: from.x - 30, y: from.y - 20 },
        { x: from.x - 60, y: from.y - 60 },
        { x: (from.x + hp.x) / 2, y: (from.y + hp.y) / 2 - 20 },
        { x: hp.x, y: hp.y },
      ];
      for (const wp of waypoints) {
        const c = await toClient(page, wp.x, wp.y);
        await page.mouse.move(c.x, c.y);
        await sleep(50);
      }
      await page.mouse.up();
      await sleep(300);
      await dumpTrace(page, '场景3 事件链（离开装配带）');
    }

    // ---- 场景 4：连续三次拖装 ----
    if (SCENES.includes('4')) {
      log(`\n  【场景4】连续三次拖装`);
      await page.evaluate(() => window.__reset());
      for (let n = 1; n <= 3; n++) {
        const dn = await diag(page);
        const card = dn.opts[(n - 1) % dn.opts.length];
        if (!card) break;
        const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
        const hp = dn.hps[(n - 1) % dn.hps.length] || dn.hps[0];
        const beforeDraft = JSON.stringify(dn.draft);
        const a = await toClient(page, from.x, from.y);
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await sleep(40);
        for (let i = 1; i <= 10; i++) {
          const lx = from.x + ((hp.x - from.x) * i) / 10;
          const ly = from.y + ((hp.y - from.y) * i) / 10;
          const c = await toClient(page, lx, ly);
          await page.mouse.move(c.x, c.y);
          await sleep(30);
        }
        await page.mouse.up();
        await sleep(260);
        const after = await diag(page);
        const dragAfter = await page.evaluate(() => globalThis.__h.garageDrag);
        log(`   第${n}次: ${card.id}→${hp.id} draft ${beforeDraft} → ${JSON.stringify(after.draft)} | 残留drag=${dragAfter ? dragAfter.phase : 'null'}`);
      }
      await dumpTrace(page, '场景4 事件链（连续三次）');
    }

    // ---- 场景 5：横向滑动卡带 ----
    if (SCENES.includes('5')) {
      const d5 = await diag(page);
      const card = d5.opts[0];
      const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
      log(`\n  【场景5】横向滑动卡带（应 stripScrolling，不装备）`);
      const beforeDraft = JSON.stringify(d5.draft);
      await page.evaluate(() => window.__reset());
      const a = await toClient(page, from.x, from.y);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await sleep(40);
      for (let i = 1; i <= 6; i++) {
        const c = await toClient(page, from.x - i * 22, from.y + (i % 2 === 0 ? 3 : -3));
        await page.mouse.move(c.x, c.y);
        await sleep(33);
      }
      await page.mouse.up();
      await sleep(260);
      const d5b = await diag(page);
      log(`   draft ${beforeDraft} → ${JSON.stringify(d5b.draft)}（应不变）| 残留drag=${JSON.stringify(await page.evaluate(() => globalThis.__h.garageDrag))}`);
      await dumpTrace(page, '场景5 事件链（横滑）');
    }

    // ---- 场景 7：pointerup 发生在 Canvas 边界附近 ----
    if (SCENES.includes('7')) {
      const d7 = await diag(page);
      const card = d7.opts[0];
      const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
      const hp = d7.hps.find((p) => p.kind === 'movement') || d7.hps[0];
      log(`\n  【场景7】up 发生在 Canvas 边界附近（先拖到挂点，再移出 canvas 边缘松开）`);
      await page.evaluate(() => window.__reset());
      const a = await toClient(page, from.x, from.y);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await sleep(40);
      // 先【纯垂直】起步进入 draggingPart（隔离方向锁问题，专测 capture 断流）
      const cv = await toClient(page, from.x, from.y - 16);
      await page.mouse.move(cv.x, cv.y);
      await sleep(50);
      const pAfterV = await page.evaluate(() => (globalThis.__h.garageDrag ? globalThis.__h.garageDrag.phase : null));
      log(`   垂直起步 phase=${pAfterV}（必须 draggingPart 才能测 capture）`);
      let i = 8;
      for (; i <= 8; i++) {
        const lx = from.x + ((hp.x - from.x) * i) / 8;
        const ly = from.y + ((hp.y - from.y) * i) / 8;
        const c = await toClient(page, lx, ly);
        await page.mouse.move(c.x, c.y);
        await sleep(30);
      }
      const box = await page.locator('canvas').first().boundingBox();
      log(`   canvas box: x=${box.x.toFixed(0)} y=${box.y.toFixed(0)} w=${box.width.toFixed(0)} h=${box.height.toFixed(0)}`);
      const inCanvas = await toClient(page, hp.x, hp.y);
      log(`   挂点 client=${inCanvas.x.toFixed(0)},${inCanvas.y.toFixed(0)}（canvas 内）`);
      // 移出 canvas 边界外（上方 30px：canvas y=60，故 y=30 在 canvas 之外），
      // 记录 host 是否仍随指针更新 → 判定 capture 是否缺失
      await page.mouse.move(box.x + box.width / 2, box.y - 30);
      await sleep(80);
      const outside = await page.evaluate(() => {
        const d = globalThis.__h.garageDrag;
        return d ? { phase: d.phase, x: +d.x.toFixed(1), y: +d.y.toFixed(1) } : null;
      });
      log(`   移出 canvas 后 host 状态=${JSON.stringify(outside)}（若 x/y 未随指针更新 → capture 缺失断流）`);
      await page.mouse.up();
      await sleep(300);
      const d7b = await diag(page);
      log(`   draft=${JSON.stringify(d7b.draft)} | 残留drag=${JSON.stringify(await page.evaluate(() => globalThis.__h.garageDrag))}`);
      await dumpTrace(page, '场景7 事件链（canvas 边界外 up）');
    }

    log(`\n  pageerror=${pageErrors.length}${pageErrors.length ? ': ' + pageErrors[0] : ''}`);
    await context.close();
  }
  await browser.close();
  require('fs').writeFileSync(path.join(__dirname, '_trace_out.log'), out.join('\n'), 'utf-8');
})();
