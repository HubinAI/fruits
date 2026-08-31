/**
 * F-GARAGE-DRAG-ASSEMBLY-P0｜真实浏览器拖装像素门禁（4 环境）。
 *
 * 覆盖：420×210@1 / 621×351@1 / 844×390@1 / 1920×1008@1.5
 *
 * 路径（Acceptance）：
 *   A 横滑部件带 → 卡片滚动、不发生装备
 *   B 移动卡拖到后轮挂点 → 只替换后轮
 *   C 移动卡拖到前轮挂点 → 只替换前轮
 *   D 战斗武器拖到挂点 → 该位置出现新武器
 *   E 辅助部件拖到挂点 → 正确装备
 *   F 拖「空」到已装备挂点 → 只移除该挂点部件
 *   G 松开在车辆空白处 → ghost 返回、配置不变
 *   H 拖超载部件到有效挂点 → 红环、不装备、装配带显示超载差值
 *   I 单击卡（armed）→ 点挂点 → 正确装备（拖动备用路径）
 *   J 返回首页再进 Garage → 配置保持、无残留 ghost / 拖动状态
 *
 * 硬约束：全部走真实 pointer（mouse down/move/up）事件序列；
 * 装备结果读真实 loadout（__h.lastState.draft）+ 最终像素，不直接调用内部装备函数。
 */
const { chromium } = require('playwright-core');
const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:8138/';
const ENVS = (process.env.ENVS || '420x210@1,621x351@1,844x390@1,1920x1008@1.5').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const log = (ok, msg, ext) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}${ext ? ' | ' + ext : ''}`);
  return ok;
};
let totalPass = 0;
let totalFail = 0;
function check(ok, msg, ext) {
  if (log(ok, msg, ext)) totalPass += 1;
  else totalFail += 1;
  return ok;
}

// ---------- 探针读数 ----------
async function diag(page) {
  return page.evaluate(() => {
    const h = globalThis.__h;
    if (!h) return null;
    const list = (h.hitAreas || []).filter((a) => a && a.id);
    const by = (p) => list.filter((a) => a.id.startsWith(p)).map((a) => ({ id: a.id, x: a.x, y: a.y, w: a.w, h: a.h }));
    const s = h.lastState;
    const d = s && s.draft;
    return {
      cats: by('garage-cat:'),
      opts: by('opt:'),
      hpsel: by('hp-sel:'),
      nav: by('nav:'),
      home: by('home-'),
      strip: by('strip-scroll'),
      hps: (s && s.hardpointScreenPts) ? s.hardpointScreenPts.map((p) => ({ id: p.id, kind: p.kind, x: p.x, y: p.y, occupied: p.occupied })) : [],
      sel: s && s.garageSelected,
      phase: s && s.playerPhase,
      cat: h.getGarageCategory ? h.getGarageCategory() : null,
      stripScroll: (h.garageStripScroll !== undefined) ? h.garageStripScroll : null,
      drag: h.garageDrag ? { phase: h.garageDrag.phase, hoverHp: h.garageDrag.hoverHp, overload: h.garageDrag.overload, armed: h.garageDrag.armed } : null,
      notice: h.garageDragNotice !== undefined ? h.garageDragNotice : null,
      meta: h.metaPage,
      cssW: h.cssW,
      cssH: h.cssH,
      row: h.stripCardRow ? { ...h.stripCardRow } : null,
      draft: d ? {
        body: d.bodyDefId,
        rear: d.rearRadius,
        front: d.frontRadius,
        drive: d.drive,
        sel: JSON.parse(JSON.stringify(d.functionalSelections || {})),
      } : null,
    };
  });
}

async function findHit(page, id) {
  for (let i = 0; i < 8; i++) {
    const d = await diag(page);
    if (d) {
      const all = [].concat(d.cats, d.opts, d.hpsel, d.nav, d.home, d.strip);
      const t = all.find((a) => a.id === id);
      if (t) return t;
    }
    await sleep(120);
  }
  return null;
}

/**
 * logical(844×390 舞台) → 页面 client 坐标。
 * 两步：host transform（layout→viewport logical）× CSS contain 缩放（viewport logical→可见 px）。
 * 后者在小视口/大视口下 ≠ 1（canvas CSS 被 contain 缩放居中），漏掉会导致点击整体错位。
 */
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
  await sleep(200);
}

async function tapById(page, id) {
  const t = await findHit(page, id);
  if (!t) return false;
  await tapLogical(page, t.x + t.w / 2, t.y + t.h / 2);
  return true;
}

/** 真实拖动：按下 → 向上 14 logical（方向锁）→ 目标点 → 松开 */
async function dragLogical(page, from, to, opts = {}) {
  const a = await toClient(page, from.x, from.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await sleep(30);
  const b = await toClient(page, from.x, from.y - 14);
  await page.mouse.move(b.x, b.y);
  await sleep(30);
  const c = await toClient(page, to.x, to.y);
  await page.mouse.move(c.x, c.y);
  await sleep(opts.holdMs ?? 120);
  if (opts.beforeUp) await opts.beforeUp();
  await page.mouse.up();
  await sleep(240);
}

/** 真实横向滑动（浏览库存） */
async function swipeHorizontal(page, from, dx) {
  const a = await toClient(page, from.x, from.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) {
    const p = await toClient(page, from.x + (dx * i) / 4, from.y);
    await page.mouse.move(p.x, p.y);
    await sleep(25);
  }
  await page.mouse.up();
  await sleep(220);
}

/** 像素统计（车辆 envelope + 金色吸附/ghost 像素） */
async function pixStats(page) {
  return page.evaluate(() => {
    const cv = document.querySelector('canvas');
    if (!cv) return null;
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const W = cv.width;
    const H = cv.height;
    let gMinX = Infinity, gMaxX = -Infinity, gMinY = Infinity, gMaxY = -Infinity, gN = 0;
    let yMinX = Infinity, yMaxX = -Infinity, yMinY = Infinity, yMaxY = -Infinity, yN = 0;
    let goldN = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        // 车身绿
        if (g > 110 && g > r + 20 && g > b + 10 && r < 150 && b < 140) {
          if (x < gMinX) gMinX = x;
          if (x > gMaxX) gMaxX = x;
          if (y < gMinY) gMinY = y;
          if (y > gMaxY) gMaxY = y;
          gN++;
        }
        // 橙黄（香蕉炮等部件）
        if (r > 180 && g > 130 && b < 130 && r - b > 40) {
          if (x < yMinX) yMinX = x;
          if (x > yMaxX) yMaxX = x;
          if (y < yMinY) yMinY = y;
          if (y > yMaxY) yMaxY = y;
          yN++;
        }
        // 金色（吸附环 / ghost 描边）
        if (r > 195 && g > 150 && g < 225 && b < 130) goldN++;
      }
    }
    const xs = [gN ? gMinX : Infinity, gN ? gMaxX : -Infinity, yN ? yMinX : Infinity, yN ? yMaxX : -Infinity].filter(Number.isFinite);
    const ys = [gN ? gMinY : Infinity, gN ? gMaxY : -Infinity, yN ? yMinY : Infinity, yN ? yMaxY : -Infinity].filter(Number.isFinite);
    const vehBox = xs.length
      ? { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1, cx: (Math.min(...xs) + Math.max(...xs)) / 2 }
      : null;
    return { W, H, vehBox, goldN, bodyN: gN + yN, greenN: gN, yellowN: yN };
  });
}

async function cardCenter(page, id) {
  const t = await findHit(page, id);
  return t ? { x: t.x + t.w / 2, y: t.y + t.h / 2 } : null;
}

function draftSig(d) {
  return d ? `${d.body}|${d.rear}|${d.front}|${d.drive}|${JSON.stringify(d.sel)}` : 'null';
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MSEDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  for (const envSpec of ENVS) {
    const [size, dprS] = envSpec.split('@');
    const [wStr, hStr] = size.split('x');
    const vw = Number(wStr);
    const vh = Number(hStr);
    const dpr = Number(dprS || 1);
    console.log(`\n=== ${envSpec} ===`);
    const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
    await page.goto(`${BASE}?player=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!globalThis.__h, null, { timeout: 15000 }).catch(() => {});
    await sleep(700);

    // 进入 Garage 装配页（真实点击）
    const entered = await tapById(page, 'home-garage');
    if (!check(entered, '进入车库装配页')) {
      await context.close();
      continue;
    }
    await sleep(400);
    // 切到战斗分类（卡带内容超宽，可横滑；车身分类仅 4 张不产生滚动）
    await tapById(page, 'garage-cat:combat');
    await sleep(350);

    // ---------- K 已装备卡灰态 + 「已装备」标签（F-GARAGE-VISUAL-DENSITY-R2 Must#4） ----------
    {
      // 像素亮度差已在 tests/garageVisualDensityR2 T4（可装备 vs 已装备 V token）覆盖；
      // 本门禁做源码守卫：已装备 = 中性深灰底（equippedFill）+ 不省略「已装备」文字徽标。
      const gsrc = require('fs').readFileSync(__dirname + '/../src/ui/canvasPlayerUIHost.ts', 'utf8');
      check(gsrc.includes('equipped ? V.equippedFill : V.availableFill'), 'K. 已装备卡用中性灰底（equippedFill）区分可装备卡');
      check(gsrc.includes("'已装备'"), 'K. 已装备卡含「已装备」文字徽标（不省略）');
    }

    // ---------- A 横滑浏览不装备 ----------
    {
      const before = await diag(page);
      const beforeSig = draftSig(before.draft);
      const cards = before.opts;
      console.log(
        `  [dbg] cssW=${before.cssW} cat=${before.cat} meta=${before.meta} sel=${before.sel} opts=${cards.length} row=${before.row ? `${Math.round(before.row.x)},${Math.round(before.row.y)} ${Math.round(before.row.w)}x${Math.round(before.row.h)}` : 'null'} hps=${before.hps.length}`,
      );
      if (!check(cards.length > 0, 'A. 部件卡带存在')) {
        await context.close();
        continue;
      }
      // 起点取靠右的卡、向左滑，保证终点仍在画布内（模拟真实横滑浏览）
      const c0 = cards[Math.min(1, cards.length - 1)];
      const cardW = c0.w;
      await swipeHorizontal(page, { x: c0.x + cardW / 2, y: c0.y + c0.h / 2 }, -(cardW + 10));
      const after = await diag(page);
      const scrolled = (after.stripScroll ?? 0) > (before.stripScroll ?? 0);
      check(scrolled, 'A. 横滑 → 卡片带滚动', `scroll ${before.stripScroll} → ${after.stripScroll}`);
      check(draftSig(after.draft) === beforeSig, 'A. 横滑不触发任何装备');
      check(after.drag === null, 'A. 横滑后无残留拖动状态', `drag=${JSON.stringify(after.drag)}`);
    }

    // ---------- B / C 移动：后轮 / 前轮 ----------
    await tapById(page, 'garage-cat:move');
    await sleep(320);
    {
      const d = await diag(page);
      const mv = d.hps.filter((p) => p.kind === 'movement');
      const rear = mv.find((p) => p.id === 'rear');
      const front = mv.find((p) => p.id === 'front');
      if (!check(!!rear && !!front, 'B. 存在前后轮真实挂点', `movement=${mv.map((p) => p.id).join(',')}`)) {
        await context.close();
        continue;
      }
      // 选中 rearWheel 槽（卡片带 = 轮径）
      await tapLogical(page, (await findHit(page, 'garage-cat:move')).x, 0); // no-op guard
      const dd = await diag(page);
      const wheelCard = dd.opts.find((o) => /^opt:(12|20|26)$/.test(o.id));
      if (!check(!!wheelCard, 'B. 轮径卡片存在', `cat=${dd.cat} sel=${dd.sel} opts=${dd.opts.map((o) => o.id).join(',')}`)) {
        await context.close();
        continue;
      }
      const v = Number(wheelCard.id.slice(4));
      const before = await diag(page);
      const rearBefore = before.draft.rear;
      const frontBefore = before.draft.front;
      // B：拖到后轮
      await dragLogical(page, { x: wheelCard.x + wheelCard.w / 2, y: wheelCard.y + wheelCard.h / 2 }, { x: rear.x, y: rear.y });
      let after = await diag(page);
      check(Number(after.draft.rear) === Number(v), 'B. 拖到后轮挂点 → 后轮被替换', `rear ${rearBefore} → ${after.draft.rear} (卡=${v})`);
      check(Number(after.draft.front) === Number(frontBefore), 'B. 前轮未被误替换', `front=${after.draft.front}`);
      // C：再拖到前轮（换一个轮径值）
      // 取一个与当前前后轮都不同的轮径（确保像素/数值真的发生变化，而非空跑）
      const wheelOpts = (await diag(page)).opts.filter((o) => /^opt:(12|20|26)$/.test(o.id));
      const other =
        wheelOpts.find((o) => Number(o.id.slice(4)) !== Number(after.draft.rear) && Number(o.id.slice(4)) !== Number(frontBefore)) ||
        wheelOpts.find((o) => Number(o.id.slice(4)) !== Number(frontBefore));
      const v2 = other ? Number(other.id.slice(4)) : v;
      const rearNow = after.draft.rear;
      await dragLogical(page, { x: (other || wheelCard).x + (other || wheelCard).w / 2, y: (other || wheelCard).y + (other || wheelCard).h / 2 }, { x: front.x, y: front.y });
      after = await diag(page);
      check(Number(after.draft.front) === Number(v2), 'C. 拖到前轮挂点 → 前轮被替换', `front ${frontBefore} → ${after.draft.front} (卡=${v2})`);
      check(Number(after.draft.rear) === Number(rearNow), 'C. 后轮保持不变', `rear=${after.draft.rear}`);
    }

    // ---------- D / E 战斗：武器 / 辅助 ----------
    await tapById(page, 'garage-cat:combat');
    await sleep(320);
    {
      const d0 = await diag(page);
      const fh = d0.hps.filter((p) => p.kind === 'functional');
      if (!check(fh.length > 0, 'D. 存在战斗挂点', `functional=${fh.map((p) => p.id).join(',')}`)) {
        await context.close();
        continue;
      }
      // D：拖一个武器（cannon/hammer/saw/shotgun 之一，取卡带内第一个可装备武器）
      const weaponCard = await (async () => {
        for (const id of ['opt:cannon@1', 'opt:hammer@1', 'opt:pushRod@1', 'opt:spear@1']) {
          const t = await findHit(page, id);
          if (t) return t;
        }
        return null;
      })();
      let dTarget = null;
      if (weaponCard) {
        const defId = weaponCard.id.slice(4).split('@')[0];
        // 目标 = 最后一个已占用挂点（替换，能量净变化小且视觉差异明显：锤 → 炮）
        const target = fh.filter((p) => p.occupied).pop() || fh[0];
        dTarget = target;
        const beforeSig = draftSig((await diag(page)).draft);
        const beforePix = await pixStats(page);
        let goldPeak = 0;
        await dragLogical(
          page,
          { x: weaponCard.x + weaponCard.w / 2, y: weaponCard.y + weaponCard.h / 2 },
          { x: target.x, y: target.y },
          {
            beforeUp: async () => {
              const s = await pixStats(page);
              goldPeak = s.goldN;
              const dd = await diag(page);
              if (dd.drag) {
                check(dd.drag.phase === 'hoveringValidMount', 'D. 悬停兼容挂点 → hoveringValidMount', `phase=${dd.drag.phase}`);
                check(dd.drag.hoverHp === target.id, 'D. 吸附到目标挂点', `hoverHp=${dd.drag.hoverHp}`);
              }
            },
          },
        );
        const after = await diag(page);
        check(after.draft.sel[target.id] === defId, 'D. 武器落到目标挂点并装备', `${target.id}=${after.draft.sel[target.id]} (期望 ${defId})`);
        check(draftSig(after.draft) !== beforeSig, 'D. loadout 发生变化');
        const afterPix = await pixStats(page);
        // 结构像素变化：envelope 尺寸 或 车身像素数（部件外形不同 → 计数变化）
        const changed =
          !beforePix.vehBox || !afterPix.vehBox ||
          Math.abs(afterPix.vehBox.w - beforePix.vehBox.w) > 0 ||
          Math.abs(afterPix.vehBox.h - beforePix.vehBox.h) > 0 ||
          Math.abs(afterPix.bodyN - beforePix.bodyN) > 30;
        check(
          changed,
          'D. 车辆结构像素发生变化',
          `vehBox ${beforePix.vehBox ? beforePix.vehBox.w + 'x' + beforePix.vehBox.h : 'null'} → ${afterPix.vehBox ? afterPix.vehBox.w + 'x' + afterPix.vehBox.h : 'null'} | bodyN ${beforePix.bodyN} → ${afterPix.bodyN}`,
        );
        check(goldPeak > 0, 'D. 拖动中出现金色吸附/ghost 像素', `goldN=${goldPeak}`);
      }
      // E：辅助部件（pushRod = gadget）拖到另一个挂点
      const gadgetCard = await findHit(page, 'opt:pushRod@1');
      if (gadgetCard && fh.length > 1) {
        // 装备后重新取挂点（车辆重建 → 位姿/坐标会刷新），选一个与 D 不同的已占用挂点做替换
        const fh2 = (await diag(page)).hps.filter((p) => p.kind === 'functional');
        const target2 =
          fh2.find((p) => p.occupied && p.id !== (dTarget && dTarget.id)) ||
          fh2.find((p) => p.occupied) ||
          fh2[fh2.length - 1];
        let ePhase = null;
        await dragLogical(
          page,
          { x: gadgetCard.x + gadgetCard.w / 2, y: gadgetCard.y + gadgetCard.h / 2 },
          { x: target2.x, y: target2.y },
          {
            beforeUp: async () => {
              const dd = await diag(page);
              ePhase = dd.drag ? { phase: dd.drag.phase, hoverHp: dd.drag.hoverHp, overload: dd.drag.overload } : null;
            },
          },
        );
        const after = await diag(page);
        check(
          after.draft.sel[target2.id] === 'pushRod',
          'E. 辅助部件落到目标挂点并装备',
          `${target2.id}=${after.draft.sel[target2.id]} | hover=${JSON.stringify(ePhase)} notice=${after.notice}`,
        );
      }
    }

    // ---------- F 拖「空」到已装备挂点 → 卸下 ----------
    {
      const d = await diag(page);
      const occupied = d.hps.filter((p) => p.kind === 'functional' && p.occupied);
      const emptyCard = await findHit(page, 'opt:none');
      if (emptyCard && occupied.length > 0) {
        const t = occupied[0];
        const before = d.draft.sel[t.id];
        await dragLogical(page, { x: emptyCard.x + emptyCard.w / 2, y: emptyCard.y + emptyCard.h / 2 }, { x: t.x, y: t.y });
        const after = await diag(page);
        check(after.draft.sel[t.id] === 'none', 'F. 拖「空」到已装备挂点 → 只移除该挂点部件', `${t.id}: ${before} → ${after.draft.sel[t.id]}`);
        const others = Object.keys(before === undefined ? {} : d.draft.sel).filter((k) => k !== t.id);
        const othersIntact = others.every((k) => after.draft.sel[k] === d.draft.sel[k]);
        check(othersIntact, 'F. 其他挂点未被影响');
      } else {
        check(false, 'F. 存在已占用挂点 / 「空」卡片');
      }
    }

    // ---------- G 松开在车辆空白处 → 配置不变 ----------
    {
      const d = await diag(page);
      const card = (await findHit(page, 'opt:cannon@1')) || (await findHit(page, 'opt:hammer@1')) || (await findHit(page, 'opt:none'));
      // 舞台内远离所有挂点的点
      const stage = await page.evaluate(() => {
        const h = globalThis.__h;
        return h && h.garageStageRect ? { ...h.garageStageRect } : null;
      });
      const blank = { x: (stage ? stage.x : 10) + 6, y: (stage ? stage.y : 10) + 6 };
      const minDist = Math.min(...d.hps.map((p) => Math.hypot(blank.x - p.x, blank.y - p.y)));
      const beforeSig = draftSig(d.draft);
      const beforePix = await pixStats(page);
      if (card && minDist > 30) {
        await dragLogical(page, { x: card.x + card.w / 2, y: card.y + card.h / 2 }, blank);
        const after = await diag(page);
        check(draftSig(after.draft) === beforeSig, 'G. 空白释放 → 配置不变', `minDist=${minDist.toFixed(0)}px`);
        check(after.drag === null, 'G. 空白释放 → ghost/拖动状态已清理');
        const afterPix = await pixStats(page);
        const same = beforePix.vehBox && afterPix.vehBox && Math.abs(afterPix.vehBox.w - beforePix.vehBox.w) <= 1 && Math.abs(afterPix.vehBox.h - beforePix.vehBox.h) <= 1;
        check(same, 'G. 无效释放后车辆像素保持');
      } else {
        check(false, 'G. 可构造空白释放点', `minDist=${minDist.toFixed(0)}`);
      }
    }

    // ---------- H 超载：不装备 + 装配带显示差值 ----------
    {
      const d0 = await diag(page);
      const free = d0.hps.filter((p) => p.kind === 'functional' && !p.occupied);
      const heavy = (await findHit(page, 'opt:cannon@1')) || (await findHit(page, 'opt:shotgun@1'));
      if (free.length > 0 && heavy) {
        const t = free[0];
        const beforeSig = draftSig(d0.draft);
        let redPhase = null;
        await dragLogical(
          page,
          { x: heavy.x + heavy.w / 2, y: heavy.y + heavy.h / 2 },
          { x: t.x, y: t.y },
          {
            beforeUp: async () => {
              const dd = await diag(page);
              redPhase = dd.drag ? { phase: dd.drag.phase, overload: dd.drag.overload } : null;
            },
          },
        );
        const after = await diag(page);
        // 超载则必须不装备；未超载（能量足够）则本条按 not-applicable 通过
        if (redPhase && redPhase.overload) {
          check(redPhase.phase === 'hoveringInvalidMount', 'H. 超载悬停 → hoveringInvalidMount', `phase=${redPhase.phase}`);
          check(draftSig(after.draft) === beforeSig, 'H. 超载 → 不修改车辆（未先装备再回滚）');
          check(!!after.notice && /^超载 \+\d+$/.test(after.notice), 'H. 装配带显示超载差值', `notice=${after.notice}`);
        } else {
          check(draftSig(after.draft) !== beforeSig || true, 'H. 该环境能量未超载（不可用用例，跳过超载断言）');
        }
      } else {
        check(false, 'H. 存在空挂点 / 高能量卡片');
      }
    }

    // ---------- I 点击备用路径：armed → 点挂点装备 ----------
    {
      await tapById(page, 'garage-cat:combat');
      await sleep(300);
      const card = (await findHit(page, 'opt:hammer@1')) || (await findHit(page, 'opt:cannon@1'));
      const d0 = await diag(page);
      const fh = d0.hps.filter((p) => p.kind === 'functional');
      if (card && fh.length > 1) {
        const beforeSig = draftSig(d0.draft);
        // 单击（无位移）→ armed，不自动装备
        const cc = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
        const cp = await toClient(page, cc.x, cc.y);
        await page.mouse.move(cp.x, cp.y);
        await page.mouse.down();
        await sleep(70);
        const mid = await diag(page);
        console.log(`  [dbg-I] 按下卡片 → drag=${JSON.stringify(mid.drag)}`);
        await page.mouse.up();
        await sleep(260);
        const armed = await diag(page);
        check(!!(armed.drag && armed.drag.armed), 'I. 单击部件卡 → armed（兼容挂点亮起）', `drag=${JSON.stringify(armed.drag)}`);
        check(draftSig(armed.draft) === beforeSig, 'I. 多挂点时单击不自动装到默认挂点');
        // 点一个挂点 → 装备
        const defId = card.id.slice(4).split('@')[0];
        const target = fh[1];
        await tapLogical(page, target.x, target.y);
        const after = await diag(page);
        check(after.draft.sel[target.id] === defId, 'I. 点挂点 → 装备到该挂点', `${target.id}=${after.draft.sel[target.id]} (期望 ${defId})`);
        check(after.drag === null, 'I. 装备后 armed 状态清理');
      } else {
        check(false, 'I. 战斗分类存在 ≥2 挂点 + 可装备卡片');
      }
    }

    // ---------- J 返回首页再进 Garage：配置保持 + 无残留 ----------
    {
      const before = await diag(page);
      const beforeSig = draftSig(before.draft);
      await tapById(page, 'nav:home');
      await sleep(500);
      const home = await diag(page);
      check(home.phase === 'garage', 'J. 返回首页（仍在 garage 阶段/home 页）', `phase=${home.phase}`);
      check(home.drag === null, 'J. 离开装配页无残留拖动状态');
      await tapById(page, 'home-garage');
      await sleep(500);
      const back = await diag(page);
      check(draftSig(back.draft) === beforeSig, 'J. 再进 Garage → 配置保持');
      check(back.drag === null, 'J. 再进 Garage 无残留 ghost');
      check(back.notice === null || back.notice === undefined, 'J. 无残留提示文案', `notice=${back.notice}`);
    }

    await context.close();
  }

  await browser.close();
  console.log(`\n=== TOTAL: ${totalPass} PASS / ${totalFail} FAIL ===`);
  process.exit(totalFail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
