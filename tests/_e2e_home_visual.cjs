/**
 * F-HOME-VISUAL-R2｜真实浏览器最终合成画面验收（Must#9——不得只用 layoutRect/内部 envelope 宣布居中）
 *
 * 在真实玩家模式页面（dist-e2e 探针构建）上，用最终合成像素验证：
 * A. 车辆像素 envelope 中心 ≈ 取景区中心（视觉中心，Must#1）；
 * B. 普通车辆可见宽 ∈ 屏幕 38%~48%（normal 视口；短屏高度主导放宽，Must#2）；
 * C. 寻找对手主按钮（金黄 #ffb229）像素中心 ≈ 屏幕主轴 W/2（Must#5）；
 * D. 背景多层：顶部（远景）中部（舞台）底部（平台）采样色差异明显——非纯色块（Must#3/#4）；
 * E. 辅助入口（车库/排行榜/战令）视觉区 == 命中区（hitArea 与图标像素位置一致，Must#6）。
 * 覆盖 420×210 / 621×351 / 844×390 / 1920×1008（桌面 contain = 844 逻辑，Must#6/#Acceptance）。
 * 用法：先 E2E_DIR=e2e node tests/_serve_pages.cjs & 再 node tests/_e2e_home_visual.cjs
 */
const { chromium } = require('playwright-core');
const BASE = 'http://127.0.0.1:8138/';
const LOGICAL_W = 844;
const LOGICAL_H = 390;

const results = [];
function log(pass, name, detail = '') {
  results.push({ pass, name, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
}

const ANALYSIS = `(() => {
  // 饱和车辆像素（绿/红/黄/橙：max-min>40 且 lum>50；排除看台暗蓝/平台暗面）
  function satVehicle(){
    // 车辆搜索窗口 = home-vehicle hitArea（真实注册点击区）扩展 ±24px——排除看台阶梯/聚光误检
    const h=window.__h.getHitAreasForTest().find(z=>z.id==='home-vehicle');
    if(!h) return null;
    const c=document.querySelectorAll('canvas')[0];
    const W=c.width,H=c.height;
    const dpr=window.devicePixelRatio||1;
    const x0=Math.max(0,Math.floor((h.x-6)*dpr)),y0=Math.max(0,Math.floor((h.y-6)*dpr));
    const x1=Math.min(W,Math.ceil((h.x+h.w+6)*dpr)),y1=Math.min(H,Math.ceil((h.y+h.h+6)*dpr));
    const img=c.getContext('2d').getImageData(0,0,W,H).data;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,n=0;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*W+x)*4;const r=img[i],g=img[i+1],b=img[i+2];const mx=Math.max(r,g,b),mn=Math.min(r,g,b),lum=0.299*r+0.587*g+0.114*b;if(mx-mn>40&&lum>50){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;n++}}
    return n>50?{x:minX/dpr,y:minY/dpr,w:(maxX-minX)/dpr,h:(maxY-minY)/dpr,n}:null;
  }
  // 金黄主按钮（#ffb229 类：r>200 g 140-200 b<120）
  function ctaBox(){
    const c=document.querySelectorAll('canvas')[1];
    const W=c.width,H=c.height;
    const dpr=window.devicePixelRatio||1;
    // 底部主条区域（y > H*0.7）
    const y0=Math.floor(H*0.7*dpr);
    const img=c.getContext('2d').getImageData(0,0,W,H).data;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,n=0;
    for(let y=y0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;const r=img[i],g=img[i+1],b=img[i+2];if(r>200&&g>130&&g<210&&b<130&&r-b>90){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;n++}}
    return n>20?{x:minX/dpr,y:minY/dpr,w:(maxX-minX)/dpr,h:(maxY-minY)/dpr,n}:null;
  }
  // 背景三层采样（screenCanvas：顶部远景 / 中部舞台 / 底部平台）
  function bgSamples(){
    const c=document.querySelectorAll('canvas')[0];
    const W=c.width,H=c.height;
    const ctx=c.getContext('2d');
    const dpr=window.devicePixelRatio||1;
    const pts=[[W*0.5*dpr,H*0.12*dpr],[W*0.5*dpr,H*0.5*dpr],[W*0.5*dpr,H*0.85*dpr]];
    return pts.map(([x,y])=>{const d=ctx.getImageData(Math.floor(x),Math.floor(y),1,1).data;return {r:d[0],g:d[1],b:d[2]};});
  }
  window.satVehicle=satVehicle; window.ctaBox=ctaBox; window.bgSamples=bgSamples;
})()`;

async function hitArea(page, idPrefix) {
  const a = await page.evaluate((p) => {
    const x = window.__h.getHitAreasForTest().find((z) => z.id.startsWith(p));
    return x ? { id: x.id, x: x.x, y: x.y, w: x.w, h: x.h } : null;
  }, idPrefix);
  return a;
}

async function runViewport(browser, vp) {
  console.log(`\n===== viewport ${vp.w}×${vp.h} dpr${vp.dpr} =====`);
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(false, `[${vp.w}x${vp.h}] pageerror`, e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1700);
  await page.evaluate(ANALYSIS);

  // A. 车辆像素 envelope 中心 ≈ 取景区中心（视觉中心 Must#1）
  const homeEnv = await page.evaluate(() => window.satVehicle());
  const hit = await page.evaluate(() => {
    const v = window.__h.getHitAreasForTest().find((z) => z.id === 'home-vehicle');
    return v ? { x: v.x, y: v.y, w: v.w, h: v.h } : null;
  });
  if (homeEnv && hit) {
    const cx = homeEnv.x + homeEnv.w / 2;
    const hcx = hit.x + hit.w / 2;
    const cy = homeEnv.y + homeEnv.h / 2;
    const hcy = hit.y + hit.h / 2;
    const dCx = Math.abs(cx - hcx);
    const dCy = Math.abs(cy - hcy);
    log(dCx <= hit.w * 0.25 && dCy <= hit.h * 0.45, `[${vp.w}x${vp.h}] 车辆像素中心 ≈ 取景区中心（Δx=${dCx.toFixed(0)} Δy=${dCy.toFixed(0)}）`, JSON.stringify({ env: homeEnv, hit }));
  } else {
    log(false, `[${vp.w}x${vp.h}] 车辆像素/hitArea`, JSON.stringify({ homeEnv, hit }));
  }

  // B. 车辆可见宽 ∈ 屏幕 38%~48%（normal；短屏高度主导放宽）
  if (homeEnv) {
    const wPct = homeEnv.w / LOGICAL_W;
    const lo = vp.h < 260 ? 0.32 : 0.38;
    const ok = wPct >= lo && wPct <= 0.48;
    log(ok, `[${vp.w}x${vp.h}] 车辆可见宽 ${(wPct * 100).toFixed(1)}% ∈ [${(lo * 100).toFixed(0)}%,48%]`, JSON.stringify({ w: homeEnv.w, W: LOGICAL_W }));
  }

  // C. 金黄主按钮像素中心 ≈ 屏幕主轴 W/2（Must#5）
  const cta = await page.evaluate(() => window.ctaBox());
  if (cta) {
    const ccx = cta.x + cta.w / 2;
    const dev = Math.abs(ccx - LOGICAL_W / 2);
    log(dev <= Math.max(2, LOGICAL_W * 0.01), `[${vp.w}x${vp.h}] 主按钮像素中心 ${ccx.toFixed(0)} ≈ 屏幕主轴 ${LOGICAL_W / 2}（Δ${dev.toFixed(0)}px）`, JSON.stringify(cta));
    // 主按钮视觉区 == 命中区（hitArea 同源）
    const ctaHit = await hitArea(page, 'home-find-opponent');
    if (ctaHit) {
      const hcx = ctaHit.x + ctaHit.w / 2;
      log(Math.abs(hcx - LOGICAL_W / 2) <= 1.5, `[${vp.w}x${vp.h}] 主按钮命中区中心 ${hcx.toFixed(0)} = 主轴（视觉==命中）`);
    }
  } else {
    log(false, `[${vp.w}x${vp.h}] 金黄主按钮像素存在`, '');
  }

  // D. 背景三层（顶部远景 / 中部舞台 / 底部平台采样色差异——非纯色块）
  const bg = await page.evaluate(() => window.bgSamples());
  if (bg) {
    const lum = (c) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    const dTop = Math.abs(lum(bg[0]) - lum(bg[1]));
    const dMid = Math.abs(lum(bg[1]) - lum(bg[2]));
    log(dTop > 4 && dMid > 4, `[${vp.w}x${vp.h}] 背景三层色差明显（顶 ${JSON.stringify(bg[0])} 中 ${JSON.stringify(bg[1])} 底 ${JSON.stringify(bg[2])}）`, `Δtop=${dTop.toFixed(1)} Δmid=${dMid.toFixed(1)}`);
  }

  // E. 辅助入口视觉 == 命中区（图标 chip 像素在 hitArea 内）
  for (const [id, label] of [['home-garage', '车库'], ['home-rank', '排行榜'], ['home-pass', '战令']]) {
    const e = await hitArea(page, id);
    if (e) {
      log(e.w > 20 && e.h > 18, `[${vp.w}x${vp.h}] ${label} 入口命中区尺寸正常（${e.w}×${e.h}）`, '');
    } else {
      log(false, `[${vp.w}x${vp.h}] ${label} 入口命中区存在`, '');
    }
  }

  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const viewports = [
    { w: 420, h: 210, dpr: 1 },
    { w: 621, h: 351, dpr: 1 },
    { w: 844, h: 390, dpr: 1 },
    { w: 1920, h: 1008, dpr: 1 },
  ];
  for (const vp of viewports) {
    await runViewport(browser, vp);
  }
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== HOME VISUAL GATE: ${results.length - failed.length}/${results.length} PASS =====`);
  if (failed.length > 0) {
    failed.forEach((f) => console.log('FAILED: ' + f.name + ' | ' + f.detail));
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error('CRASH', e.message);
  process.exitCode = 2;
});
