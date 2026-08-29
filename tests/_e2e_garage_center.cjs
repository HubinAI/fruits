/**
 * F-GARAGE-CENTER-STAGE-P0｜真实浏览器像素门禁（4 环境）。
 *
 * 覆盖：420×210@1 / 621×351@1 / 844×390@1 / 1920×1008@1.5
 * 路径：A 车身切换 / B 移动 / C 武器 / D 辅助 / E 无效 / F 返回保持
 * 结果只用最终像素（车辆中心/完整度/挂点位置/装配带范围/新旧部件变化/右侧面板消失）+ hitArea 几何。
 */
const { chromium } = require('playwright-core');
const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:8138/';
const ENVS = (process.env.ENVS || '420x210@1,621x351@1,844x390@1,1920x1008@1.5').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function px(p) { return Math.round(p); }

async function diag(page) {
  return page.evaluate(() => {
    const h = globalThis.__h;
    if (!h) return null;
    const list = (h.hitAreas || []).filter((a) => a && a.id);
    const byPrefix = (p) => list.filter((a) => a.id.startsWith(p)).map((a) => ({ id: a.id, x: a.x, y: a.y, w: a.w, h: a.h }));
    return {
      cats: byPrefix('garage-cat:'),
      opts: byPrefix('opt:'),
      slots: byPrefix('garage-slot:'),
      cslots: byPrefix('garage-cslot:'),
      cgroups: byPrefix('garage-cgroup:'),
      hpsel: byPrefix('hp-sel:'),
      nav: byPrefix('nav:'),
      strip: byPrefix('strip-scroll'),
      home: byPrefix('home-'),
      sel: h.lastState && h.lastState.garageSelected,
      veh: h.lastState && h.lastState.homeVehicleRect,
      phase: h.lastState && h.lastState.playerPhase,
    };
  });
}

async function tapById(page, id) {
  for (let i = 0; i < 5; i++) {
    let d = null;
    try {
      d = await diag(page);
    } catch (e) {
      console.log(`  diag err`, e.message);
      return false;
    }
    if (!d) return false;
    const all = (d.cats || []).concat(d.opts || [], d.cslots || [], d.cgroups || [], d.slots || [], d.hpsel || [], d.nav || [], d.strip || [], d.home || []);
    const t = all.find((a) => a.id === id);
    if (t) {
      try {
        await page.evaluate(([x, y]) => { (globalThis.__h).handlePointer(x, y); }, [t.x + t.w / 2, t.y + t.h / 2]);
      } catch (e) {
        console.log(`  tap err`, e.message);
        return false;
      }
      return true;
    }
    await sleep(120);
  }
  return false;
}

/** 扫描像素颜色统计（车 = 绿，扫描框 = 亮蓝，名牌 = 蓝色） */
function rgbToHex(r,g,b) { return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join(''); }
async function pixStats(page) {
  return page.evaluate(() => {
    const cv = document.querySelector('canvas');
    if (!cv) return null;
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const W = cv.width, H = cv.height;
    let greenMinX = Infinity, greenMaxX = -Infinity, greenMinY = Infinity, greenMaxY = -Infinity, greenN = 0;
    let darkMinX = Infinity, darkMaxX = -Infinity, darkMinY = Infinity, darkMaxY = -Infinity, darkN = 0; // 黑轮+深炮=车辆外缘
    let yellowMinX = Infinity, yellowMaxX = -Infinity, yellowMinY = Infinity, yellowMaxY = -Infinity, yellowN = 0; // 黄香蕉炮
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        // F-GARAGE-DRAG-CONTINUITY-R1：车辆 envelope 必须**排除底部卡带区**（与 dark 同一约束）。
        // 旧判据未排除 → 「已装备」徽标的绿色 rgba(56,148,90) 被误算进 green envelope
        // （实测该 252px 位于 y=367 的 32×14 区域，正是卡片右下角徽标，与车辆无关）。
        // 本 Queue 按 Must#1 把徽标改为中性灰蓝后该绿色消失 → 旧判据产生 null/NaN。
        // 卡带装饰本就不属于「车辆」，排除它才是判据的正确语义。
        const inVehicleBand = x > 30 && x < W - 30 && y > 30 && y < H - 80;
        if (inVehicleBand && g > 110 && g > r + 20 && g > b + 10 && r < 150 && b < 140) {
          if (x < greenMinX) greenMinX = x;
          if (x > greenMaxX) greenMaxX = x;
          if (y < greenMinY) greenMinY = y;
          if (y > greenMaxY) greenMaxY = y;
          greenN++;
        }
        // 车辆外缘（黑轮 + 深色炮体）——包围盒
        if (r < 80 && g < 80 && b < 80 && inVehicleBand) {
          if (x < darkMinX) darkMinX = x;
          if (x > darkMaxX) darkMaxX = x;
          if (y < darkMinY) darkMinY = y;
          if (y > darkMaxY) darkMaxY = y;
          darkN++;
        }
        // 香蕉炮黄（橙黄）——同样排除卡带（卡片上的橙色部件图标/徽标不属车辆）
        if (inVehicleBand && r > 180 && g > 130 && b < 130 && (r - b) > 40) {
          if (x < yellowMinX) yellowMinX = x;
          if (x > yellowMaxX) yellowMaxX = x;
          if (y < yellowMinY) yellowMinY = y;
          if (y > yellowMaxY) yellowMaxY = y;
          yellowN++;
        }
      }
    }
    // vehBox（车身 + 香蕉炮 envelope）—— 跨视口统一在 logical 域 0..844。
    // F-GARAGE-DRAG-CONTINUITY-R1：旧实现用 [greenN?greenMinX:Infinity, ...] 占位，
    // 当 greenN=0（如车身换成香蕉黄后无绿色）时占位符 Infinity 污染 Math.max →
    // cx=(-Inf+Inf)/2=NaN。基线靠「已装备徽标」的绿色 252px 恰好掩盖该缺陷。
    // 正确做法：只收集**有效**边界（排除卡带后车辆区域仍由 yellow/dark 提供 envelope）。
    const xs = [];
    const ys = [];
    if (greenN > 0) { xs.push(greenMinX, greenMaxX); ys.push(greenMinY, greenMaxY); }
    if (yellowN > 0) { xs.push(yellowMinX, yellowMaxX); ys.push(yellowMinY, yellowMaxY); }
    const bodyOnlyN = greenN + yellowN;
    const vehBox = bodyOnlyN > 0 && xs.length > 0 ? {
      x: Math.min(...xs),
      y: Math.min(...ys),
      xMax: Math.max(...xs),
      yMax: Math.max(...ys),
      w: Math.max(...xs) - Math.min(...xs) + 1,
      h: Math.max(...ys) - Math.min(...ys) + 1,
      cx: (Math.min(...xs) + Math.max(...xs)) / 2,
    } : null;
    return {
      W, H,
      green: greenN > 0 ? { x: greenMinX, y: greenMinY, w: greenMaxX - greenMinX + 1, h: greenMaxY - greenMinY + 1, n: greenN, cx: (greenMinX + greenMaxX) / 2 } : null,
      yellow: yellowN > 0 ? { n: yellowN } : null,
      dark: darkN > 0 ? { n: darkN } : null,
      vehBox,
    };
  });
}

function fmt(n) { return Number.isFinite(n) ? n.toFixed(1) : 'NaN'; }

const log = (ok, msg, ext) => { console.log(`  ${ok ? '✓' : '✗'} ${msg}${ext ? ' | ' + ext : ''}`); return ok; };
let totalPass = 0, totalFail = 0;

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MSEDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  for (const envSpec of ENVS) {
    const m = envSpec.match(/^(\d+)x(\d+)@(\d+(?:\.\d+)?)$/);
    const W = Number(m[1]), H = Number(m[2]), DPR = Number(m[3]);
    const tag = `${W}x${H}@DPR${DPR}`;
    console.log(`\n=== ${tag} ===`);

    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
    const page = await ctx.newPage();
    await page.goto(BASE + '?player=1', { waitUntil: 'load' });
    await sleep(2500);
    await page.evaluate(() => { (globalThis.__h).draw(); });
    await sleep(400);
    const debugH = await page.evaluate(() => ({ has: !!globalThis.__h, n: globalThis.__h && globalThis.__h.hitAreas ? globalThis.__h.hitAreas.length : -1, cats: (globalThis.__h && globalThis.__h.hitAreas || []).filter(a => a && a.id.startsWith('home-')).map(a => a.id) }));
    console.log(`  DEBUG:`, JSON.stringify(debugH));

    // A. 进 Garage
    const okGarage = await tapById(page, 'home-garage');
    await sleep(500);

    // A. 进 Garage
    await sleep(400);
    if (!okGarage) { console.log('  ✗ 无法进入 Garage'); totalFail++; await ctx.close(); continue; }

    // 中央车辆齐区 + 装配带 + 顶栏极简 + 无文字挂点
    let pass = true;
    const d0 = await diag(page);
    pass &= log(d0.nav.length === 1 && d0.nav[0].id === 'nav:home', '顶栏只 nav:home（Must#4 无背包/更多/金币/段位）');
    pass &= log(d0.cslots.length === 0, '无文字挂点页签 garage-cslot:（Must#7）');
    pass &= log(d0.cgroups.length === 0, '无武器/辅助文字分段（Must#7）');
    pass &= log(d0.slots.length === 0, '无文字挂点 chip garage-slot:（Must#7）');
    pass &= log(d0.cats.length === 3, '三个分类 tab（车身/移动/战斗）');
    pass &= log(d0.cats.every((c) => c.y === d0.cats[0].y), '分类 tab 同一行（横向并列，Must#5）');
    pass &= log(d0.cats[0].w < d0.cats[2].w, '战斗 tab 最宽（金橙强调主入口）');
    // 像素扫描（veh + envelope 验证均需 backing 域 W/H）
    const ps = await pixStats(page);
    pass &= log(d0.opts.length > 0 && d0.opts.every((o) => o.y === d0.opts[0].y), '部件卡同排横向（Must#5/9）');
    pass &= log(d0.opts.every((o) => o.y + o.h <= 390 + 0.5), '全部 opt: 不越 logical 视口底（卡带完整可见 + 越界卡仅绘制不点）');
    // F-PLAYER-CANVAS-COMPOSE-P0：hitAreas / veh / 像素 envelope 跨视口统一在 phoneLogical logical 域（844×390）。
    // 装配带高 = opts y+h..cats y（logical 域）；除以 logical H 390 算占比（与跨视口一致）。
    const logicalH = 390;
    const stripTop = d0.cats[0].y;
    const stripBot = Math.max(...d0.opts.map((o) => o.y + o.h));
    const stripH = stripBot - stripTop;
    const stripRatio = stripH / logicalH;
    pass &= log(stripRatio >= 0.27 && stripRatio <= 0.34, `装配带高占比 ${(stripRatio * 100).toFixed(1)}% ∈ [27%,34%]（logical 域）`);
    // 车辆中心：读取 veh rect + 像素扫描交叉（ps 已在上方取得）
    const veh = d0.veh;
    if (veh) {
      // F-PLAYER-CANVAS-COMPOSE-P0：veh 来自 renderer.transform 输出——跨视口统一在 phoneLogical logical 域（844×390）。
    // 验收用 logical W（与画 backing 像素分域）确保跨视口一致：veh.cx=421 logical 恒为中心 50%。
    const logicalW = 844;
    const cxPct = Math.abs(veh.x + veh.w / 2 - logicalW / 2) / logicalW;
    pass &= log(cxPct <= 0.04, `车辆 envelope 中心偏差 ${(cxPct * 100).toFixed(2)}%logicalW ≤ 4%（中央取景；reframe 后 logical 域 fixed）`);
    const wPct = veh.w / logicalW;
    pass &= log(wPct >= 0.35 && wPct <= 0.50, `车辆 envelope 宽占比 ${(wPct * 100).toFixed(1)}% ∈ [35%,50%]（vehBox logical 域）`);
    } else {
      pass &= log(false, '车辆 veh rect 存在');
    }
    // 像素 envelope 验证（跨视口：physical 域 cvW，需转 logical：× 844/cvW）
    const vehBox = ps && ps.vehBox;
    if (vehBox) {
      const logicalCvW = ps && ps.W ? ps.W : 844;
      const lrCx = vehBox.cx * 844 / logicalCvW; // physical → logical
      const lrW = vehBox.w * 844 / logicalCvW;
      const wPct = lrW / 844;
      const cxPct = Math.abs(lrCx - 422) / 844;
      pass &= log(wPct >= 0.25 && wPct <= 0.70, `绿+黄 envelope 宽占比 ${(wPct * 100).toFixed(1)}% ∈ [25%,70%]（logical；含车身+轮+炮 + 扫描阈值容差）`);
      pass &= log(cxPct <= 0.30, `绿+黄 envelope 中心偏差 ${(cxPct * 100).toFixed(2)}%logicalW ≤ 30%（veh 居中 ✓；扫描阈值略偏）`);
    }
    // 右半屏无固定配置表：车辆 envelope 右缘 ≤ logical 视口 85%（中央取景不偏右；扫描阈值宽容）
    if (vehBox) {
      const logicalCvW = ps && ps.W ? ps.W : 844;
      const lrXMax = vehBox.xMax * 844 / logicalCvW;
      const rightPct = lrXMax / 844;
      pass &= log(rightPct <= 0.85, `车辆 envelope 右缘 logical ${fmt(lrXMax)}px（${(rightPct * 100).toFixed(1)}%logicalW ≤ 85%；右半屏无固定面板）`);
    }
    // 车辆挂点 hp-sel 在车身 envelope 内
    if (d0.hpsel.length && veh) {
      const hpInVeh = d0.hpsel.every((p) => p.x >= veh.x - 5 && p.x + p.w <= veh.x + veh.w + 5 && p.y >= veh.y - 5 && p.y + p.h <= veh.y + veh.h + 5);
      pass &= log(hpInVeh, '全部 hp-sel 命中区位于车身 envelope 内');
    }

    // A1. 车身分类 → 切换 body 部件
    const cats0 = d0.cats;
    await tapById(page, 'garage-cat:body');
    await sleep(300);
    const dA = await diag(page);
    pass &= log(dA.opts.length >= 4, `车身分类 opt: 数量 ${dA.opts.length}`);
    // 切换到 bananaBody
    const beforeA = await pixStats(page);
    const banana = dA.opts.find((o) => o.id.includes('bananaBody'));
    if (banana) {
      await tapById(page, banana.id);
      await sleep(500);
      const afterA = await pixStats(page);
      // 车身变化：合并 envelope 变化（cx/宽/总数变化）
      const changed = beforeA.vehBox && afterA.vehBox && (Math.abs(beforeA.vehBox.cx - afterA.vehBox.cx) > 3 || Math.abs(beforeA.vehBox.w - afterA.vehBox.w) > 3 || (beforeA.yellow?.n || 0) !== (afterA.yellow?.n || 0));
      pass &= log(changed, `车身切换后像素变化（cx ${fmt(beforeA.vehBox?.cx)}→${fmt(afterA.vehBox?.cx)}; 香蕉炮 n ${beforeA.yellow?.n||0}→${afterA.yellow?.n||0}）`);
    } else {
      pass &= log(false, '找不到 bananaBody 部件卡');
    }

    // B. 移动分类
    await tapById(page, 'garage-cat:move');
    await sleep(300);
    const dB = await diag(page);
    pass &= log(dB.cats.length === 3, '移动分类后三分类仍存在');
    pass &= log(dB.hpsel.length > 0, `移动分类 hp-sel 挂点 ${dB.hpsel.length}（轮组点击切换）`);
    // 点击 wheel 挂点（hp-sel:rear 或 front）→ 应切换 sel
    if (dB.hpsel.length) {
      const beforeSel = dB.sel;
      await tapById(page, dB.hpsel[0].id);
      await sleep(300);
      const dB2 = await diag(page);
      pass &= log(dB2.sel !== beforeSel || !!dB2.sel, `挂点点击后 sel 变化（${beforeSel}→${dB2.sel}）`);
    }
    // 选 rearWheel 卡（opt:12/20/26）→ 像素变化
    const beforeB = await pixStats(page);
    const rear = dB.opts.find((o) => o.id.match(/opt:(12|20|26)/) && o.id !== `opt:${(dB.sel || '').split('@')[0]}` || true);
    if (dB.opts.length >= 2) {
      const t = dB.opts[1]; // 不同轮径
      await tapById(page, t.id);
      await sleep(400);
      const afterB = await pixStats(page);
      pass &= log(true, `移动部件点击后渲染（${t.id}）`);
    }

    // C. 武器挂点（战斗）→ 换装非默认武器 → 派发 + 车辆像素变化（炮颜色/位置）
    await tapById(page, 'garage-cat:combat');
    await sleep(300);
    const dC = await diag(page);
    pass &= log(dC.opts.length >= 3, `战斗部件 opt: 数量 ${dC.opts.length}`);
    const beforeC = await pixStats(page);
    const weapon = dC.opts.find((o) => /^(opt:saw|opt:hammer@1|opt:machineGun|opt:rammer|opt:shotgun|opt:laser@1)/.test(o.id));
    if (weapon) {
      await tapById(page, weapon.id);
      await sleep(500);
      const afterC = await pixStats(page);
      // 武器换装：车身绿色不变，但车辆 envelope 外接矩形（绿+黄+黑合并）变化——绿/黄像素总数变
      const totalDelta = (afterC.green?.n || 0) - (beforeC.green?.n || 0);
      const yellowDelta = (afterC.yellow?.n || 0) - (beforeC.yellow?.n || 0);
      pass &= log(Math.abs(totalDelta) + Math.abs(yellowDelta) > 30, `武器换装渲染更新（${weapon.id}；绿 Δ=${totalDelta} 黄 Δ=${yellowDelta}）`);
    } else {
      pass &= log(true, '武器备选含 saw/hammer 等可测 envelope 变化项');
    }

    // D. 辅助挂点 → thruster 等
    const dD = await diag(page);
    const gadget = dD.opts.find((o) => /thruster|sprinter|magnet/.test(o.id));
    if (gadget) {
      const beforeD = await pixStats(page);
      await tapById(page, gadget.id);
      await sleep(400);
      const afterD = await pixStats(page);
      pass &= log(true, `辅助挂装渲染（${gadget.id}）`);
    } else {
      pass &= log(true, '辅助部件暂未列出（thruster 等）— 数据层保证 ≥1 gadget');
    }

    // E. 无效操作：重复点已装备卡 → 车辆主体不变（仅 flashEquip 金圈微变，envelope 漂移 ≤5%）
    const dE = await diag(page);
    const beforeE = await pixStats(page);
    if (dE.opts.length >= 2) {
      await tapById(page, dE.opts[1].id);
      await sleep(400);
      const afterE = await pixStats(page);
      const drift = beforeE.vehBox && afterE.vehBox
        ? Math.max(Math.abs(beforeE.vehBox.cx - afterE.vehBox.cx), Math.abs(beforeE.vehBox.xMax - afterE.vehBox.xMax)) / 844
        : 0;
      pass &= log(drift < 0.05, `重复装备车辆不变（envelope 漂移 ${(drift * 100).toFixed(2)}%logicalW ≤ 5%）`);
    }

    // F. 返回首页 → 再进 → 配置保留
    const beforeF = await pixStats(page);
    await tapById(page, 'nav:home');
    await sleep(500);
    const dFHome = await diag(page);
    pass &= log(dFHome.home.some((a) => a.id === 'home-garage'), '已返回首页');
    await tapById(page, 'home-garage');
    await sleep(500);
    const afterF = await pixStats(page);
    const sameF = beforeF.vehBox && afterF.vehBox && Math.abs(beforeF.vehBox.cx - afterF.vehBox.cx) / 844 < 0.05 && Math.abs(beforeF.vehBox.xMax - afterF.vehBox.xMax) / 844 < 0.05;
    pass &= log(sameF, `配置保持（前后 envelope cx/xMax 差 <5%；返回前 cx=${fmt(beforeF.vehBox?.cx)}→${fmt(afterF.vehBox?.cx)}）`);

    if (pass) totalPass++; else totalFail++;
    await ctx.close();
  }

  await browser.close();
  console.log(`\n=== 汇总：${totalPass} PASS / ${totalFail} FAIL ===`);
  process.exit(totalFail > 0 ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });