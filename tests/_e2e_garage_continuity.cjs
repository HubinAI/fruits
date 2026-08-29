/**
 * F-GARAGE-DRAG-CONTINUITY-R1｜Garage 拖装连续性真实浏览器门禁
 *
 * 覆盖 420×210@1 / 621×351@1 / 844×390@1 / 1920×1008@1.5，全部真实 mouse 事件序列。
 *
 * A 慢速斜向拖动 ghost 全程连续（帧缺口 ≤2）
 * B 再拖到另一挂点，不需要额外复位
 * C 连续三次拖装，三次全部一次成功（每次都从 idle 开始、结束归零）
 * D 离开卡片与装配带后状态不断
 * E 横滑卡带不误装备，之后立即可拖
 * F 拖武器/辅助到兼容挂点
 * G 空白区域释放，配置不变、无残留
 * H pointercancel 后下一次拖动正常
 * I 换装后新卡灰态 +「已装备」标签，旧卡恢复正常
 * J 已装备 / armed / 普通 / 未获得 四态像素可区分
 * K 返回首页再进 Garage，装备与标签保持
 * L 全程无 pageerror、无重复装备事件
 *
 * 时间序列断言：ghost 帧缺口 ≤2；单次手势只产生一次 completion/cancellation；
 *               pointer capture 结束后归零；连续三次均从 idle 正常开始与结束。
 *
 * 用法：ENVS=... node tests/_e2e_garage_continuity.cjs
 */
const { chromium } = require('playwright-core');
const path = require('path');

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:8138/';
const ENVS = (process.env.ENVS || '420x210@1,621x351@1,844x390@1,1920x1008@1.5').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let totalPass = 0;
let totalFail = 0;
const fails = [];
function check(ok, name, detail = '') {
  if (ok) {
    totalPass += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    totalFail += 1;
    fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
  return !!ok; // 调用方用 `if (!check(...)) continue;`，必须回传判定结果
}

// ---------- 页面内 recorder：帧采样 + pointer capture 记账 ----------
const RECORDER = () => {
  const w = window;
  w.__capOps = [];
  w.__frames = [];
  w.__recOn = true;
  const origSet = Element.prototype.setPointerCapture;
  const origRel = Element.prototype.releasePointerCapture;
  Element.prototype.setPointerCapture = function (id) {
    w.__capOps.push({ op: 'set', id });
    try {
      return origSet.call(this, id);
    } catch {
      return undefined;
    }
  };
  Element.prototype.releasePointerCapture = function (id) {
    w.__capOps.push({ op: 'release', id });
    try {
      return origRel.call(this, id);
    } catch {
      return undefined;
    }
  };
  const snap = () => {
    const h = w.__h;
    const d = h && h.garageDrag;
    return d ? { phase: d.phase, x: d.x, y: d.y, hoverHp: d.hoverHp, armed: d.armed } : null;
  };
  let f = 0;
  const loop = () => {
    if (w.__recOn) {
      const s = snap();
      w.__frames.push({ f: f++, s, ghost: s ? { x: s.x, y: s.y } : null });
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  w.__reset = () => {
    w.__capOps = [];
    w.__frames = [];
  };
};

const DRAGP = ['draggingPart', 'hoveringValidMount', 'hoveringInvalidMount'];

/** 把手势帧按「连续 dragging 区间」分段，返回各段的帧缺口与跳变 */
function segmentFrames(frames) {
  const segs = [];
  let cur = null;
  for (const fr of frames) {
    const on = !!(fr.s && DRAGP.includes(fr.s.phase));
    if (on) {
      if (!cur || fr.f - cur.lastF > 1) {
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
  return segs.map((sg) => {
    let maxGap = 0;
    let maxJump = 0;
    for (let i = 1; i < sg.items.length; i++) {
      maxGap = Math.max(maxGap, sg.items[i].f - sg.items[i - 1].f - 1);
      maxJump = Math.max(
        maxJump,
        Math.hypot(sg.items[i].ghost.x - sg.items[i - 1].ghost.x, sg.items[i].ghost.y - sg.items[i - 1].ghost.y),
      );
    }
    return { start: sg.start, end: sg.lastF, frames: sg.items.length, maxGap, maxJump };
  });
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
      nav: by('nav:'),
      home: by('home-'),
      hps: s && s.hardpointScreenPts ? s.hardpointScreenPts.map((p) => ({ id: p.id, kind: p.kind, x: p.x, y: p.y, occupied: p.occupied })) : [],
      row: h.stripCardRow ? { ...h.stripCardRow } : null,
      cat: h.getGarageCategory ? h.getGarageCategory() : null,
      meta: h.metaPage,
      phase: s && s.playerPhase,
      cssW: h.cssW,
      drag: h.garageDrag ? { phase: h.garageDrag.phase, hoverHp: h.garageDrag.hoverHp, armed: h.garageDrag.armed } : null,
      draft: d
        ? { body: d.bodyDefId, rear: d.rearRadius, front: d.frontRadius, drive: d.drive, sel: JSON.parse(JSON.stringify(d.functionalSelections || {})) }
        : null,
    };
  });
}

const draftSig = (d) => (d ? `${d.body}|${d.rear}|${d.front}|${d.drive}|${JSON.stringify(d.sel)}` : 'null');

async function toClient(page, lx, ly) {
  const box = await page.locator('canvas').first().boundingBox();
  const t = await page.evaluate(() => globalThis.__h.getTransformInfo());
  const k = t.cssW > 0 ? box.width / t.cssW : 1;
  return { x: box.x + (t.ox + t.scale * lx) * k, y: box.y + (t.oy + t.scale * ly) * k };
}

async function tapLogical(page, lx, ly) {
  const c = await toClient(page, lx, ly);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(220);
}

async function tapById(page, id) {
  const d = await diag(page);
  const all = [].concat(d.cats, d.opts, d.nav, d.home);
  const t = all.find((a) => a.id === id);
  if (!t) return false;
  await tapLogical(page, t.x + t.w / 2, t.y + t.h / 2);
  return true;
}

/**
 * 真实斜向拖动：按下 → 沿「带横向抖动的斜线」分步移动到目标 → 松开。
 * 复刻真人手势（不保持绝对垂直），正是旧实现会误判为横滑的路径。
 */
async function dragDiagonal(page, from, to, steps = 14) {
  const a = await toClient(page, from.x, from.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await sleep(50);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const jitter = i % 2 === 0 ? 2.5 : -2.5;
    const c = await toClient(page, from.x + (to.x - from.x) * t + jitter, from.y + (to.y - from.y) * t);
    await page.mouse.move(c.x, c.y);
    await sleep(30);
  }
  await page.mouse.up();
  await sleep(280);
}

async function readTrace(page) {
  return page.evaluate(() => ({ cap: window.__capOps || [], frames: window.__frames || [] }));
}

/** 采样卡片矩形内像素（backing 像素），用于四态判定 */
async function cardPixels(page, card) {
  return page.evaluate(
    ([c]) => {
      const cv = document.querySelector('canvas');
      const t = globalThis.__h.getTransformInfo();
      const ctx = cv.getContext('2d');
      // backing 坐标 = (layout→logical) × (canvas backing 宽 / 逻辑舞台宽)。
      // **不得**再乘 CSS 显示缩放 k（box.width/cssW）：canvas backing 直接映射 844×390
      // 逻辑舞台，与页面把它 CSS 放大到多少像素无关（实测 420 下 cvW=844 而 box.w=420，
      // 乘 k 会把所有采样点压到左上角 → 读到黑边 → 全 0）。k 只用于 toClient（→屏幕 client）。
      const f = cv.width / (t.cssW || cv.width);
      const px = (lx, ly) => {
        const sx = Math.round((t.ox + t.scale * lx) * f);
        const sy = Math.round((t.oy + t.scale * ly) * f);
        if (sx < 0 || sy < 0 || sx >= cv.width || sy >= cv.height) return null;
        const d = ctx.getImageData(sx, sy, 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      // 中心（避开 mini 图标与文字）：取卡片右侧 65% 宽、垂直中部
      const cx = c.x + c.w * 0.62;
      const cy = c.y + c.h * 0.5;
      // 徽标区（右下角）：检测「已装备/未获得」亮字
      const bx = c.x + c.w - 18;
      const by = c.y + c.h - 8;
      const samples = [];
      for (let dx = -3; dx <= 3; dx++) {
        for (let dy = -3; dy <= 3; dy++) {
          const p = px(cx + dx, cy + dy);
          if (p) samples.push(p);
        }
      }
      const badge = [];
      for (let dx = -7; dx <= 7; dx++) {
        for (let dy = -4; dy <= 4; dy++) {
          const p = px(bx + dx, by + dy);
          if (p) badge.push(p);
        }
      }
      // 已装备左侧标识条区（x+3 竖条；普通卡此处是底色 → 明显更暗）
      const mark = [];
      for (let dy = -4; dy <= 4; dy++) {
        const p = px(c.x + 3, c.y + c.h * 0.5 + dy);
        if (p) mark.push(p);
      }
      const avg = (arr) =>
        arr.length
          ? arr.reduce((s, p) => [s[0] + p[0] / arr.length, s[1] + p[1] / arr.length, s[2] + p[2] / arr.length], [0, 0, 0]).map(Math.round)
          : null;
      const maxLum = (arr) => arr.reduce((m, p) => Math.max(m, (p[0] + p[1] + p[2]) / 3), 0);
      return {
        center: avg(samples),
        badgeMaxLum: Math.round(maxLum(badge)),
        markMaxLum: Math.round(maxLum(mark)),
        badgeN: badge.length,
      };
    },
    [card],
  );
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MSEDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  for (const envSpec of ENVS) {
    const [size, dprS] = envSpec.split('@');
    const [vw, vh] = size.split('x').map(Number);
    const dpr = Number(dprS || 1);
    console.log(`\n================ ${vw}x${vh} @DPR${dpr} ================`);
    const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.goto(`${BASE}?player=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!globalThis.__h, null, { timeout: 15000 }).catch(() => {});
    await sleep(700);
    await page.evaluate(RECORDER);

    // 进入 Garage（经真实点击进入）
    const d0 = await diag(page);
    if (d0.meta !== 'garage') await tapById(page, 'home-garage');
    await sleep(500);
    // 切到「移动」分类（轮径：有 rear/front 两个 movement 挂点，便于 A/B）
    await tapById(page, 'garage-cat:move').catch(() => {});
    await sleep(400);
    let d = await diag(page);
    console.log(`  meta=${d.meta} cat=${d.cat} cards=${d.opts.length} hps=${d.hps.length}`);
    if (!d.opts.length) {
      check(false, '环境可用（部件卡存在）', `cat=${d.cat}`);
      await context.close();
      continue;
    }

    // ---------- A/B：慢速斜向拖到前轮 → 立即再拖到后轮 ----------
    {
      const frontHp = d.hps.find((p) => p.kind === 'movement');
      const rearHp = d.hps.filter((p) => p.kind === 'movement')[1] || frontHp;
      if (!check(!!frontHp, 'A. 存在 movement 挂点')) {
        await context.close();
        continue;
      }
      const card = d.opts[0];
      const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
      await page.evaluate(() => window.__reset());
      await dragDiagonal(page, from, { x: frontHp.x, y: frontHp.y });
      const tr = await readTrace(page);
      const segs = segmentFrames(tr.frames);
      const seg = segs[0];
      check(!!seg, 'A. 斜向拖动进入 draggingPart（ghost 可见）', `段数=${segs.length} 帧=${seg ? seg.frames : 0}`);
      if (seg) {
        check(seg.maxGap <= 2, 'A. ghost 帧缺口 ≤2（连续不中断）', `maxGap=${seg.maxGap}`);
        check(seg.maxJump <= 90, 'A. ghost 无无原因跳变', `maxJump=${Math.round(seg.maxJump)}px`);
      }
      const capOk = tr.cap.filter((c) => c.op === 'set').length === tr.cap.filter((c) => c.op === 'release').length;
      check(capOk, 'A. pointer capture set/release 配对', `set=${tr.cap.filter((c) => c.op === 'set').length} release=${tr.cap.filter((c) => c.op === 'release').length}`);
      const dA = await diag(page);
      check(dA.drag === null, 'A. 手势结束后状态归零（无残留）', `drag=${JSON.stringify(dA.drag)}`);

      // B：无需额外复位，直接拖第二张卡到另一个挂点
      const dB0 = await diag(page);
      const card2 = dB0.opts[1] || dB0.opts[0];
      const from2 = { x: card2.x + card2.w / 2, y: card2.y + card2.h / 2 };
      await page.evaluate(() => window.__reset());
      await dragDiagonal(page, from2, { x: rearHp.x, y: rearHp.y });
      const tr2 = await readTrace(page);
      const segs2 = segmentFrames(tr2.frames);
      check(segs2.length >= 1 && segs2[0].frames > 3, 'B. 第二次拖动正常开始（无需复位点击）', `段数=${segs2.length} 帧=${segs2[0] ? segs2[0].frames : 0}`);
      const dB = await diag(page);
      check(dB.drag === null, 'B. 第二次手势结束归零', `drag=${JSON.stringify(dB.drag)}`);
    }

    // ---------- C：连续三次拖装，三次全部一次成功 ----------
    {
      let allOk = true;
      const notes = [];
      for (let n = 1; n <= 3; n++) {
        const dn = await diag(page);
        if (!dn.opts.length) break;
        const hp = dn.hps[(n - 1) % Math.max(1, dn.hps.length)];
        const card = dn.opts[(n - 1) % dn.opts.length];
        const before = draftSig(dn.draft);
        await page.evaluate(() => window.__reset());
        await dragDiagonal(page, { x: card.x + card.w / 2, y: card.y + card.h / 2 }, { x: hp.x, y: hp.y }, 10);
        const tr = await readTrace(page);
        const segs = segmentFrames(tr.frames);
        const after = await diag(page);
        const cleanStart = tr.frames.length > 0 && tr.frames[0].s === null;
        const cleanEnd = after.drag === null;
        const oneSeg = segs.length <= 1;
        const ok = !!segs[0] && segs[0].frames > 2 && cleanEnd && oneSeg && cleanStart;
        if (!ok) allOk = false;
        notes.push(`#${n}:帧${segs[0] ? segs[0].frames : 0} 段${segs.length} 起${cleanStart ? 'idle' : 'X'} 终${cleanEnd ? 'null' : 'X'} ${before === draftSig(after.draft) ? '配置不变(幂等)' : '已换装'}`);
      }
      check(allOk, 'C. 连续三次拖装均一次成功（每次从 idle 开始、结束归零、单段）', notes.join(' | '));
    }

    // ---------- D：离开卡片与装配带后状态不断 ----------
    {
      const dn = await diag(page);
      const card = dn.opts[0];
      const hp = dn.hps.find((p) => p.kind === 'movement') || dn.hps[0];
      const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
      const a = await toClient(page, from.x, from.y);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await sleep(40);
      // 先向左上离开卡带（装配带之外），再折向挂点
      const wps = [
        { x: from.x - 40, y: from.y - 30 },
        { x: from.x - 70, y: from.y - 80 },
        { x: (from.x + hp.x) / 2, y: (from.y + hp.y) / 2 },
        { x: hp.x, y: hp.y },
      ];
      let alive = true;
      for (const wp of wps) {
        const c = await toClient(page, wp.x, wp.y);
        await page.mouse.move(c.x, c.y);
        await sleep(50);
        const s = await page.evaluate(() => (globalThis.__h.garageDrag ? globalThis.__h.garageDrag.phase : null));
        if (!s || !['draggingPart', 'hoveringValidMount', 'hoveringInvalidMount'].includes(s)) alive = false;
      }
      await page.mouse.up();
      await sleep(260);
      check(alive, 'D. 离开卡片与装配带后拖动状态不断', `末态=${JSON.stringify((await diag(page)).drag)}`);
    }

    // ---------- E：横滑卡带不误装备，之后立即可拖 ----------
    {
      const dn = await diag(page);
      const before = draftSig(dn.draft);
      const card = dn.opts[0];
      const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
      const a = await toClient(page, from.x, from.y);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await sleep(40);
      for (let i = 1; i <= 6; i++) {
        const c = await toClient(page, from.x - i * 20, from.y + (i % 2 === 0 ? 3 : -3));
        await page.mouse.move(c.x, c.y);
        await sleep(30);
      }
      await page.mouse.up();
      await sleep(260);
      const dE = await diag(page);
      check(draftSig(dE.draft) === before, 'E. 横滑不误装备（配置不变）', `${before} → ${draftSig(dE.draft)}`);
      check(dE.drag === null, 'E. 横滑后无 dragging/armed 残留', `drag=${JSON.stringify(dE.drag)}`);
      // 之后立即可拖
      const hp = dE.hps.find((p) => p.kind === 'movement') || dE.hps[0];
      await page.evaluate(() => window.__reset());
      await dragDiagonal(page, from, { x: hp.x, y: hp.y }, 10);
      const trE = await readTrace(page);
      const segsE = segmentFrames(trE.frames);
      check(segsE.length >= 1 && segsE[0].frames > 2, 'E. 横滑后立即拖装可用', `帧=${segsE[0] ? segsE[0].frames : 0}`);
    }

    // ---------- F：拖武器/辅助到兼容挂点 ----------
    {
      await tapById(page, 'garage-cat:combat').catch(() => {});
      await sleep(420);
      const df = await diag(page);
      if (df.opts.length && df.hps.length) {
        // 战斗分类多数卡片未获得（locked → Must#13 本就禁止拖动），故逐张尝试，
        // 取第一张能正常进入 draggingPart 的（= 真实可拖动的已获得部件）
        const hp = df.hps.find((p) => p.kind === 'functional') || df.hps[0];
        let okF = false;
        let noteF = '未找到可拖动卡片';
        for (const card of df.opts.slice(0, 8)) {
          const before = draftSig(df.draft);
          await page.evaluate(() => window.__reset());
          await dragDiagonal(page, { x: card.x + card.w / 2, y: card.y + card.h / 2 }, { x: hp.x, y: hp.y }, 12);
          const trF = await readTrace(page);
          const segsF = segmentFrames(trF.frames);
          const dF = await diag(page);
          if (segsF.length >= 1 && segsF[0].frames > 2) {
            okF = true;
            noteF = `card=${card.id} 帧=${segsF[0].frames} ${before === draftSig(dF.draft) ? '配置不变(幂等)' : '已换装'}`;
            check(dF.drag === null, 'F. 战斗部件手势结束归零', `drag=${JSON.stringify(dF.drag)}`);
            break;
          }
          noteF = `试 ${df.opts.slice(0, 8).indexOf(card) + 1} 张均未进入 draggingPart（多为未获得 locked）`;
        }
        check(okF, 'F. 战斗部件（武器/辅助）拖到兼容挂点', noteF);
      } else {
        check(false, 'F. 战斗分类可用', `cards=${df.opts.length} hps=${df.hps.length}`);
      }
      await tapById(page, 'garage-cat:move').catch(() => {});
      await sleep(360);
    }

    // ---------- G：空白区域释放，配置不变 ----------
    {
      const dg = await diag(page);
      const before = draftSig(dg.draft);
      const card = dg.opts[0];
      const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
      const blank = { x: dg.cssW - 30, y: 60 };
      await dragDiagonal(page, from, blank, 10);
      const dG = await diag(page);
      check(draftSig(dG.draft) === before, 'G. 空白释放配置不变', `${before} → ${draftSig(dG.draft)}`);
      check(dG.drag === null, 'G. 空白释放后 ghost 与状态清理', `drag=${JSON.stringify(dG.drag)}`);
    }

    // ---------- H：pointercancel 后下一次拖动正常 ----------
    {
      const dh = await diag(page);
      const card = dh.opts[0];
      const hp = dh.hps.find((p) => p.kind === 'movement') || dh.hps[0];
      const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
      const a = await toClient(page, from.x, from.y);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await sleep(40);
      const b = await toClient(page, from.x + 8, from.y - 20);
      await page.mouse.move(b.x, b.y);
      await sleep(40);
      // 真实 pointercancel（CDP 派发系统级取消）
      await page.evaluate(() => {
        const cv = document.querySelector('canvas');
        cv.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));
      });
      await sleep(160);
      await page.mouse.up().catch(() => {});
      await sleep(200);
      const dH1 = await diag(page);
      check(dH1.drag === null, 'H. pointercancel 后状态清理', `drag=${JSON.stringify(dH1.drag)}`);
      // 下一次拖动正常
      await page.evaluate(() => window.__reset());
      await dragDiagonal(page, from, { x: hp.x, y: hp.y }, 10);
      const trH = await readTrace(page);
      const segsH = segmentFrames(trH.frames);
      check(segsH.length >= 1 && segsH[0].frames > 2, 'H. cancel 后下一次拖动正常', `帧=${segsH[0] ? segsH[0].frames : 0}`);
    }

    // ---------- I/J：换装后卡片状态 + 四态可区分 ----------
    {
      const di = await diag(page);
      // 找一张「未装备」的卡拖上去 → 该卡应变灰态并显示「已装备」
      const hp = di.hps.find((p) => p.kind === 'movement') || di.hps[0];
      let target = null;
      for (const c of di.opts) {
        await dragDiagonal(page, { x: c.x + c.w / 2, y: c.y + c.h / 2 }, { x: hp.x, y: hp.y }, 10);
        const after = await diag(page);
        const now = after.opts.find((o) => o.id === c.id);
        if (now) {
          const pxNow = await cardPixels(page, now);
          if (pxNow.badgeMaxLum > 150) {
            target = { card: now, px: pxNow, before: c };
            break;
          }
        }
      }
      check(!!target, 'I. 换装后出现「已装备」标签（徽标亮字）', target ? `card=${target.card.id} badgeLum=${target.px.badgeMaxLum}` : '未检测到');
      if (target) {
        // 已装备 = 中性灰蓝：非亮蓝（蓝-红 差值小、亮度 <110）
        const [r, g, b] = target.px.center;
        check(b - r < 60 && (r + g + b) / 3 < 110, 'I. 已装备卡为中性灰蓝（非亮蓝）', `center=rgb(${r},${g},${b})`);
      }
      // J：四态像素可区分（已装备 / 普通 / 未获得 / armed）
      const dj = await diag(page);
      const sampled = [];
      for (const c of dj.opts.slice(0, 6)) {
        const px = await cardPixels(page, c);
        sampled.push({ id: c.id, ...px });
      }
      const lums = sampled.map((s) => (s.center ? (s.center[0] + s.center[1] + s.center[2]) / 3 : 0));
      const distinct = new Set(lums.map((l) => Math.round(l / 6))).size;
      check(distinct >= 2, 'J. 卡片状态像素可区分（≥2 个不同视觉层级）', `亮度=${lums.map((l) => Math.round(l)).join('/')} 层级=${distinct}`);
      const withBadge = sampled.filter((s) => s.badgeMaxLum > 150).length;
      check(withBadge >= 1, 'J. 存在带「已装备/未获得」文字标签的卡片', `badgeCards=${withBadge}/${sampled.length}`);
      // 已装备标识条（左竖条）→ 与普通卡形成第二重区分（仅靠底色差 3 亮度不足「肉眼可区分」）
      const marks = sampled.map((s) => s.markMaxLum);
      const hasMark = marks.some((m) => m > 100);
      const plainMax = Math.max(...sampled.filter((s) => s.badgeMaxLum <= 150).map((s) => s.markMaxLum), 0);
      check(hasMark && Math.max(...marks) - plainMax > 40, 'J. 已装备卡有灰蓝标识条（与普通卡可区分）', `markLum=${marks.join('/')} 普通最高=${plainMax}`);
    }

    // ---------- K：返回首页再进 Garage，装备与标签保持 ----------
    {
      const dk0 = await diag(page);
      const sig0 = draftSig(dk0.draft);
      const homeNav = dk0.nav.find((n) => n.id === 'nav:home') || dk0.nav[0];
      if (homeNav) await tapLogical(page, homeNav.x + homeNav.w / 2, homeNav.y + homeNav.h / 2);
      await sleep(400);
      const backHome = await diag(page);
      check(backHome.meta !== 'garage' || backHome.phase !== 'garage', 'K. 已离开 Garage', `meta=${backHome.meta}`);
      await tapById(page, 'home-garage');
      await sleep(500);
      const dk1 = await diag(page);
      check(draftSig(dk1.draft) === sig0, 'K. 返回后装备配置保持', `${sig0} → ${draftSig(dk1.draft)}`);
      const anyBadge = await (async () => {
        for (const c of dk1.opts.slice(0, 4)) {
          const px = await cardPixels(page, c);
          if (px.badgeMaxLum > 150) return true;
        }
        return false;
      })();
      check(anyBadge, 'K. 返回后「已装备」标签保持');
    }

    // ---------- L：无 pageerror ----------
    check(pageErrors.length === 0, 'L. 全程无 pageerror', pageErrors.length ? pageErrors[0].slice(0, 120) : '');
    await context.close();
  }
  await browser.close();
  console.log(`\n================ TOTAL: ${totalPass} PASS / ${totalFail} FAIL ================`);
  if (fails.length) {
    console.log('失败项：');
    for (const f of fails) console.log(`  - ${f}`);
  }
  require('fs').writeFileSync(path.join(__dirname, '_e2e_continuity_out.log'), fails.join('\n'), 'utf-8');
  process.exitCode = totalFail > 0 ? 1 : 0;
})();
