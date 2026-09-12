/**
 * PRP-F1 / PRP-R5
 * 「Run Page 里的战斗就是**旧正式左右侧视 Planck 战斗**」的无头物理验证（纯 node，无 DOM）。
 *
 * 本文件只做一件事：**用真实物理跑完整场战斗，然后从逐帧遥测里冻结实测值**。
 * 它承担 Queue 必改 5 的三条物理关系：
 *
 *   ① 炮弹飞行：弹丸离开炮口 → **真的飞过一段距离** → 命中（不能「贴脸直接扣血」）
 *   ② 后坐改变空间：开火后炮车真实后移，且这个位移**实际改变双方距离**（不是纯特效抖动）
 *   ③ 碰撞需要接敌过程：先跨越距离才进入接触（首次接触严格晚于首次命中）
 *
 * 外加「必改 1」的世界尺度核对（1600 / 900 / groundY 700 / spawn 400·1200 / 中心距 800）与
 * 「PRP-R5」的相机核对（**正式 battle 相机链** + viewport adapter + 三段动态取景）。
 * 所有期望值都是**实测后冻结的字面量**：若哪天有人把 arena / spawn / 射速 / 后坐偷偷改小，
 * 或把相机改回「固定全世界远摄」，这里会立刻红。
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_ARENA_CONFIG } from '../src/battle/arenaConfig';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import { isCompactLandscape } from '../src/render/viewportProfile';
import { RUN_STAGE_BAND } from '../src/lab/portraitBattleLab/runPageLayout';
import {
  RUN_BATTLE_VIEW_H,
  RUN_BATTLE_VIEW_INSET,
  RUN_BATTLE_VIEW_W,
  RunBattleRuntime,
  battleVisibleWorld,
  shouldReframeBattleCamera,
  vehicleWorldBox,
  type RunBattleXform,
} from '../src/lab/portraitBattleLab/runBattleRuntime';
import type { CanvasSurface } from '../src/render/canvasSurface';

const FRAME_MS = 1000 / 60;
const MAX_FRAMES = 4000;

interface Frame {
  readonly step: number;
  /** 玩家 / 敌人外廓世界外接框。 */
  readonly aMinX: number;
  readonly aMaxX: number;
  readonly bMinX: number;
  readonly bMaxX: number;
  /** 两车中心 x（世界 px）。 */
  readonly aX: number;
  readonly bX: number;
  /** 两车外廓间距（世界 px；>0 = 完全分离）。 */
  readonly gap: number;
  readonly hpA: number;
  readonly hpB: number;
  readonly projCount: number;
  /** 玩家方弹丸的最右端 x（无弹丸为 null）——用来证明弹丸在飞行。 */
  readonly projLeadX: number | null;
  /** 玩家方弹丸的中心 x 列表（世界 px）。 */
  readonly projXs: readonly number[];
  readonly result: boolean;
}

/** 跑完整场真实战斗并逐帧记录遥测（不改任何参数）。 */
function traceBattle(maxFrames = MAX_FRAMES): Frame[] {
  const rt = new RunBattleRuntime(false);
  const frames: Frame[] = [];
  const push = (): void => {
    const snap = rt.snapshot();
    const a = rt.vehicleBox('A');
    const b = rt.vehicleBox('B');
    const mine = (snap.projectiles ?? []).filter((p) => p.team === 'A');
    frames.push({
      step: rt.stepCount,
      aMinX: a.minX,
      aMaxX: a.maxX,
      bMinX: b.minX,
      bMaxX: b.maxX,
      aX: rt.vehicleX('A'),
      bX: rt.vehicleX('B'),
      gap: b.minX - a.maxX,
      hpA: rt.hp().a,
      hpB: rt.hp().b,
      projCount: mine.length,
      projLeadX: mine.length === 0 ? null : Math.max(...mine.map((p) => p.center.x + p.radius)),
      projXs: mine.map((p) => p.center.x),
      result: rt.result !== null,
    });
  };
  push();
  for (let i = 0; i < maxFrames; i++) {
    if (rt.result) break;
    rt.step(FRAME_MS);
    push();
  }
  rt.dispose();
  return frames;
}

const firstStepWhere = (f: readonly Frame[], pred: (x: Frame) => boolean): number => {
  const i = f.findIndex(pred);
  return i < 0 ? -1 : i;
};

let cache: Frame[] | null = null;
function frames(): Frame[] {
  if (!cache) cache = traceBattle();
  return cache;
}

/* ==================================================== 必改 1：世界尺度 */

describe('PRP-F1｜世界尺度 = 旧正式 Battle（不是舞台带宽）', () => {
  it('PB-01 arena / 地面 / 出生点与正式 DEFAULT_ARENA_CONFIG 完全一致', () => {
    const rt = new RunBattleRuntime(false);
    expect(rt.arenaWidth).toBe(1600);
    expect(rt.arenaHeight).toBe(900);
    expect(rt.groundY).toBe(700);
    expect(rt.arenaWidth).toBe(DEFAULT_ARENA_CONFIG.width);
    expect(rt.arenaHeight).toBe(DEFAULT_ARENA_CONFIG.height);
    expect(rt.groundY).toBe(DEFAULT_ARENA_CONFIG.groundY);
    expect(Math.round(rt.spawnAx)).toBe(400);
    expect(Math.round(rt.spawnBx)).toBe(1200);
    expect(Math.round(rt.spawnSeparation)).toBe(800);
    // 世界宽 >> 舞台带宽：战斗**没有**被压缩进竖屏窗口
    expect(rt.arenaWidth / RUN_STAGE_BAND.w).toBeGreaterThan(4);
    rt.dispose();
  });

  it('PB-02 耐久上限来自正式解析（PRP 没有改过 HP）', () => {
    const rt = new RunBattleRuntime(false);
    const hp = rt.hp();
    expect(hp.aMax).toBe(1100); // 西瓜重炮
    expect(hp.bMax).toBe(900); // 追猎者
    expect(hp.a).toBe(1100);
    expect(hp.b).toBe(900);
    rt.dispose();
  });
});

/* ==================================================== 必改 2：正式 Battle Camera */

/**
 * 相机逐帧遥测。
 *
 * ⚠️ 调用口径 = **正式口径**：每帧 `reframe(snap,'battle',{phase})`（正式 `Renderer` 的
 * battle 分支自述「Active 每帧」，正式相机测试 `battleDynamicFramingR21.test.ts` 同源）
 * + `render()`（其内部逐帧执行正式 `applyBattleFollow`）。
 */
interface CamFrame {
  readonly step: number;
  readonly phase: string;
  readonly scale: number;
  /** 舞台带内**实际可见**的世界宽（固定远摄时会恒为 1600）。 */
  readonly visW: number;
  /** A∪B 外廓占舞台带宽比例（%）。 */
  readonly spanPct: number;
  /** 单车最长边占舞台比例（%）。 */
  readonly singlePct: number;
  /** 地面线在舞台带内的 y。 */
  readonly groundBandY: number;
  /** 两车外廓在舞台带内的左右极值（完整入画判据）。 */
  readonly aMinBand: number;
  readonly bMaxBand: number;
}

/** 万能 2D ctx 桩（正式 render() 需要，只有 applyBattleFollow 的结果被读取）。 */
function makeCtx(canvas: unknown): CanvasRenderingContext2D {
  const grad = { addColorStop: () => undefined };
  const ctx: unknown = new Proxy(
    {},
    {
      get: (_t, k) => {
        if (k === 'canvas') return canvas;
        if (k === 'measureText') return () => ({ width: 0 });
        if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') {
          return () => grad;
        }
        return () => ctx;
      },
      set: () => true,
    },
  );
  return ctx as CanvasRenderingContext2D;
}

function makeRenderer(w: number, h: number): Renderer {
  const canvas = {
    getContext: () => makeCtx(undefined),
    clientWidth: w,
    clientHeight: h,
    width: w,
    height: h,
  } as unknown as HTMLCanvasElement;
  const surface: CanvasSurface = { width: w, height: h, devicePixelRatio: 1, now: () => 0 };
  const r = new Renderer(canvas, new VisualRegistry(), surface);
  r.setBattleBackdrop(true);
  return r;
}

let camCache: CamFrame[] | null = null;
function camFrames(): CamFrame[] {
  if (camCache) return camCache;
  const renderer = makeRenderer(RUN_BATTLE_VIEW_W, RUN_BATTLE_VIEW_H);
  const rt = new RunBattleRuntime(false);
  const out: CamFrame[] = [];
  let last: string | null = null;
  for (let f = 0; f <= 940; f++) {
    if (f > 0) rt.step(FRAME_MS);
    const snap = rt.snapshot();
    // 与视图层**同一节奏函数**（官方口径：Active 每帧 + 阶段切换那一帧）
    const phase = rt.orchestrator.phase;
    if (shouldReframeBattleCamera(phase, last)) {
      last = phase;
      renderer.reframe(snap, 'battle', { phase });
    }
    renderer.render(rt.orchestrator);
    const t = renderer.transform;
    const xf: RunBattleXform = {
      scale: t.scale,
      offsetX: t.offsetX,
      offsetY: t.offsetY,
      cropX: RUN_BATTLE_VIEW_INSET.x,
      cropY: RUN_BATTLE_VIEW_INSET.y,
    };
    const a = vehicleWorldBox(snap, 'A');
    const b = vehicleWorldBox(snap, 'B');
    const band = RUN_STAGE_BAND;
    out.push({
      step: f,
      phase: rt.orchestrator.phase,
      scale: t.scale,
      visW: battleVisibleWorld(xf).width,
      spanPct: (((b.maxX - a.minX) * t.scale) / band.w) * 100,
      singlePct:
        Math.max(
          (a.maxX - a.minX) * t.scale,
          (a.maxY - a.minY) * t.scale,
          (b.maxX - b.minX) * t.scale,
          (b.maxY - b.minY) * t.scale,
        ) / band.w * 100,
      groundBandY: t.offsetY + snap.arena.groundY * t.scale - RUN_BATTLE_VIEW_INSET.y,
      aMinBand: t.offsetX + a.minX * t.scale - RUN_BATTLE_VIEW_INSET.x,
      bMaxBand: t.offsetX + b.maxX * t.scale - RUN_BATTLE_VIEW_INSET.x,
    });
    if (rt.result) break;
  }
  rt.dispose();
  camCache = out;
  return out;
}

describe('PRP-R5｜相机 = 正式 Battle Camera（viewport adapter + 三段动态取景）', () => {
  it('PB-03 viewport adapter：正式安全区恰好等于舞台带（非 compact 分支 56/28/28）', () => {
    // 视口 = 舞台带 + 正式 inset × 2
    expect(RUN_BATTLE_VIEW_INSET).toEqual({ x: 56, y: 28 });
    expect(RUN_BATTLE_VIEW_W).toBe(RUN_STAGE_BAND.w + 56 * 2);
    expect(RUN_BATTLE_VIEW_H).toBe(RUN_STAGE_BAND.h + 28 * 2);
    // ⚠️ adapter 成立的前提：该尺寸必须**不是** compact 横屏，否则正式相机会换一套 inset
    //    （compact battle = insetX 0 / top 56 / bottom 12），安全区就不再等于舞台带。
    expect(isCompactLandscape(RUN_BATTLE_VIEW_W, RUN_BATTLE_VIEW_H)).toBe(false);

    const f = camFrames();
    // 地面线锚定在带内 71.3%（正式语义：视口高 68~72% → 带内 ≈ 71.3~75.6%），上下都留了空间
    expect(f[0].groundBandY / RUN_STAGE_BAND.h).toBeCloseTo(0.7134, 3);
    expect(f[0].groundBandY).toBeGreaterThan(0);
    expect(f[0].groundBandY).toBeLessThan(RUN_STAGE_BAND.h);
    // 冻结实测：开局 scale 0.3310 / A∪B span 84.03% / 可见世界宽 1178.16
    expect(f[0].scale).toBeCloseTo(0.33102439024390246, 12);
    expect(f[0].spanPct).toBeCloseTo(84.02926829268293, 6);
    expect(f[0].visW).toBeCloseTo(1178.1609195402298, 6);
  });

  it('PB-04 三段动态取景（正式口径）：远 82~88% → 接近 68~82% → 碰撞 48~70%', () => {
    const f = camFrames();
    const inRange = (lo: number, hi: number): CamFrame[] => f.filter((x) => x.spanPct >= lo && x.spanPct <= hi);
    const far = inRange(82, 88);
    const mid = inRange(68, 82);
    const hit = inRange(48, 70);
    // 三段都必须真实出现过（= 接近过程被镜头跟着讲出来，而不是固定取景）
    expect(far.length, '远端段帧数').toBeGreaterThan(0);
    expect(mid.length, '接近段帧数').toBeGreaterThan(0);
    expect(hit.length, '碰撞段帧数').toBeGreaterThan(0);
    // 冻结实测帧数
    expect(far.length).toBe(57);
    expect(mid.length).toBe(93);
    expect(hit.length).toBe(755);
    // 碰撞段车辆成为主体（正式判据 ≥16% 舞台；实测 28.8%~54.2%）
    const singles = hit.map((x) => x.singlePct);
    expect(Math.min(...singles)).toBeGreaterThanOrEqual(16);
    expect(Math.min(...singles)).toBeCloseTo(28.806, 3);
    expect(Math.max(...singles)).toBeCloseTo(54.162, 3);
  });

  it('PB-04b 不是固定远摄：镜头真的裁世界、真的变焦（废除 PRP-F1 的永久 390/1600）', () => {
    const f = camFrames();
    // ❌ 旧行为（PRP-F1）：scale 恒 390/1600 = 0.24375、可见世界宽恒 1600、offsetX 恒 0
    expect(f.every((x) => x.scale === 390 / 1600)).toBe(false);
    // 可见世界宽全程 < 世界宽（相机确实在裁世界），开局就只有 1178（≈ 世界的 74%）
    expect(Math.max(...f.map((x) => x.visW))).toBeLessThan(DEFAULT_ARENA_CONFIG.width);
    expect(Math.max(...f.map((x) => x.visW))).toBeCloseTo(1178.161, 3);
    // 碰撞期进一步收窄到 ≈430（世界的 27%）—— 物理反馈被放大到可感知尺度
    expect(Math.min(...f.map((x) => x.visW))).toBeCloseTo(429.499, 3);
    // 变焦幅度：峰值 scale ≥ 2× 开局 scale（实测 0.908 / 0.3310 = 2.74×）
    const maxScale = Math.max(...f.map((x) => x.scale));
    expect(maxScale / f[0].scale).toBeGreaterThan(2);
    expect(maxScale).toBeCloseTo(0.9080346210751752, 12);

    // Active 内单帧 scale 步长 ≤1.5%（正式阻尼上限 BATTLE_SCALE_MAX_STEP；实测恰好 1.5%）
    let maxActiveStep = 0;
    for (let i = 1; i < f.length; i++) {
      if (f[i - 1].phase === 'Active' && f[i].phase === 'Active') {
        maxActiveStep = Math.max(maxActiveStep, Math.abs(f[i].scale - f[i - 1].scale) / f[i - 1].scale);
      }
    }
    expect(maxActiveStep).toBeLessThanOrEqual(0.015 + 1e-9);

    // 地面线恒定（正式「地面锚定」语义）：全程漂移 ≤1px
    const gs = f.map((x) => x.groundBandY);
    expect(Math.max(...gs) - Math.min(...gs)).toBeLessThanOrEqual(1);
  });

  it('PB-04d reframe 节奏 = 正式口径（Active 每帧；其它阶段仅阶段切换那一帧）', () => {
    expect(shouldReframeBattleCamera('Active', null)).toBe(true); // 开局首帧
    expect(shouldReframeBattleCamera('Active', 'Active')).toBe(true); // Active 每帧
    expect(shouldReframeBattleCamera('Warning', 'Active')).toBe(true); // 阶段切换那一帧
    expect(shouldReframeBattleCamera('Warning', 'Warning')).toBe(false);
    expect(shouldReframeBattleCamera('Closing', 'Warning')).toBe(true);
    expect(shouldReframeBattleCamera('Closing', 'Closing')).toBe(false);
    expect(shouldReframeBattleCamera('End', 'Closing')).toBe(true);
    expect(shouldReframeBattleCamera('End', 'End')).toBe(false);
  });

  it('PB-04c 完整入画：两车全程（含收束/碰撞/被推墙）都在舞台带内', () => {
    const f = camFrames();
    // 实测：B 右缘最大 360.47（带内留 29.5px 余量）
    expect(Math.max(...f.map((x) => x.bMaxBand))).toBeCloseTo(360.474, 3);
    expect(Math.max(...f.map((x) => x.bMaxBand))).toBeLessThanOrEqual(RUN_STAGE_BAND.w);
    // 实测：A 左缘最小 −0.329（收束阶段被刺墙推向世界左墙）
    // ⚠️ 这是**正式相机** offsetX 的「世界不出画」clamp 结果：车在世界里紧贴左墙时，
    //    取景被 clamp 在世界边界上，A 的 sprite 外廓会比带左缘多出 0.33 逻辑 px（亚像素级）。
    //    正式横屏同样如此；PRP 不为此改任何物理，也不自造取景规则。
    expect(Math.min(...f.map((x) => x.aMinBand))).toBeCloseTo(-0.3294, 3);
    expect(Math.min(...f.map((x) => x.aMinBand))).toBeGreaterThanOrEqual(-1);
  });
});

/* ==================================================== 必改 5①②③ */

describe('PRP-F1｜必改 5：三条物理关系（真实物理，逐帧遥测）', () => {
  it('PB-05 关系① 炮弹飞行：弹丸离开炮口 → 飞过一段距离 → 才命中', () => {
    const f = frames();
    const firstShot = firstStepWhere(f, (x) => x.projCount > 0);
    const firstDamage = firstStepWhere(f, (x) => x.hpB < 900 || x.hpA < 1100);
    expect(firstShot).toBeGreaterThanOrEqual(0);
    expect(firstDamage).toBeGreaterThan(firstShot);

    // 开火 → 命中之间，弹丸**真实存在于空中**并且逐帧前进
    const flight = f.slice(firstShot, firstDamage);
    expect(flight.length).toBeGreaterThanOrEqual(120); // ≥2s 的飞行期
    const alive = flight.filter((x) => x.projXs.length > 0);
    expect(alive.length).toBeGreaterThanOrEqual(40);
    const leads = alive.map((x) => x.projLeadX!);
    // 同一轮炮弹的前缘从 536 推进到 737（≈201 世界 px = 逐帧 4.9 px）
    expect(Math.round(Math.min(...leads))).toBe(536);
    expect(Math.round(Math.max(...leads))).toBe(737);
    expect(Math.max(...leads) - Math.min(...leads)).toBeGreaterThan(190);

    // 命中发生时两车**仍未接触**（外廓间距 91.7 世界 px > 0）→ 这一击只能来自飞行中的炮弹，
    // 不可能是碰撞伤害；真正的首次接触还要再等 25 帧（第 157 帧）。
    expect(f[firstDamage].gap).toBeGreaterThan(0);
    expect(Math.round(f[firstDamage].gap)).toBe(92);
    // 冻结实测值（首次命中 = 第 132 帧 ≈ 2.2s）
    expect(firstDamage).toBe(132);
    // 首次开火几乎在开局（Cannon 初始就绪），弹丸出现在炮口附近而不是敌方身上
    expect(firstShot).toBe(1);
    expect(Math.round(f[firstShot].projLeadX!)).toBe(536);
  });

  it('PB-06 关系② 后坐改变空间：开火后炮车真实后移，且真的改变双方距离', () => {
    const f = frames();
    const shots = f
      .map((x, i) => ({ i, before: i === 0 ? 0 : f[i - 1].projCount, after: x.projCount }))
      .filter((s) => s.after > s.before)
      .map((s) => s.i);
    // 实测：整场 9 轮开火（≈ 每 60 帧一发 → 与正式 cooldown 一致）
    expect(shots.length).toBe(9);

    // 每次开火后的 6 帧内，玩家车中心 x 必须真的往回走（A 朝 +X → 后坐 = x 变小）
    const recoils = shots.map((i) => {
      const win = f.slice(i, Math.min(f.length, i + 7));
      return f[i].aX - Math.min(...win.map((x) => x.aX));
    });
    const maxRecoil = Math.max(...recoils);
    // 冻结实测值：最强一次后坐回退 ≈ 14.9 世界 px（发生在第 421 帧）
    expect(Math.round(maxRecoil)).toBe(15);
    expect(maxRecoil).toBeGreaterThan(5); // 明显位移，不是 0 抖动

    // 后坐「改变双方距离」：开火瞬间的间距 vs 其后 6 帧的最大间距必须真的变大（≈15.5 世界 px）
    const gapGrowth = shots.map((i) => {
      const win = f.slice(i, Math.min(f.length, i + 7));
      return Math.max(...win.map((x) => x.gap)) - f[i].gap;
    });
    expect(Math.round(Math.max(...gapGrowth))).toBe(15);
    expect(Math.max(...gapGrowth)).toBeGreaterThan(3);

    // 整场空间确实被改变：玩家车从出生位置被推走很远（后坐 + 交火推挤，非纯特效）
    const minAX = Math.min(...f.map((x) => x.aX));
    expect(400 - minAX).toBeGreaterThan(150);
    // 冻结实测值（A.x 最小 ≈ 86.3 → 回退 ≈ 313.7 世界 px）
    expect(Math.round(400 - minAX)).toBe(314);
  });

  it('PB-07 关系③ 碰撞需要接敌过程：首次接触严格晚于首次命中', () => {
    const f = frames();
    const firstDamage = firstStepWhere(f, (x) => x.hpB < 900 || x.hpA < 1100);
    const firstContact = firstStepWhere(f, (x) => x.gap <= 0);
    expect(firstContact).toBeGreaterThan(firstDamage); // 先远程交火，后才进入碰撞

    // 开局就有明确距离，并且是**连续跨越**过去的
    expect(Math.round(f[0].gap)).toBe(529);
    expect(f[0].gap).toBeGreaterThan(400);
    expect(firstContact).toBeGreaterThanOrEqual(140);
    // 冻结实测值（首次外廓重叠 = 第 157 帧，重叠 −3.17 世界 px）
    expect(firstContact).toBe(157);
    expect(f[firstContact].gap).toBeLessThanOrEqual(0);
    expect(f[firstContact].gap).toBeGreaterThan(-10);
    const travel = f[0].gap - f[firstContact].gap;
    expect(Math.round(travel)).toBe(532); // 跨越了 532 世界 px 才接上

    // 接敌是**渐进**的：从开局到首次接触之间间距单调收窄（差分不出现反向大跳）
    const approach = f.slice(0, firstContact + 1).map((x) => x.gap);
    const backJumps = approach.filter((g, i) => i > 0 && g - approach[i - 1] > 30);
    expect(backJumps.length).toBe(0);
  });

  it('PB-08 战斗以官方结果收束（HP 归零 / 阶段结束），不是脚本计时', () => {
    const f = frames();
    const last = f[f.length - 1];
    expect(last.result).toBe(true);
    // 结局由正式判据给出：至少一方 HP 归零
    expect(Math.min(last.hpA, last.hpB)).toBeLessThanOrEqual(0);
    // 冻结实测值：整场 922 帧 ≈ 15.37s，玩家残血 269.78 / 1100（≈ 25%）
    expect(last.step).toBe(921);
    expect(last.hpA).toBeCloseTo(269.78, 1);
    expect(last.hpB).toBe(0);
    expect(Math.round((last.hpA / 1100) * 100)).toBe(25);
  });
});
