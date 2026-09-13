/**
 * PRP-F1 / PRP-R5
 * 「Run Page 里的战斗就是**旧正式左右侧视 Planck 战斗**」的无头物理验证（纯 node，无 DOM）。
 *
 * 本文件只做一件事：**用真实物理跑完整场战斗，然后从逐帧遥测里冻结实测值**。
 * 它承担 Queue 必改 5 的三条物理关系：
 *
 *   ① 炮弹飞行：弹丸离开炮口 → **真的飞过一段距离** → 命中（不能「贴脸直接扣血」）
 *   ② 后坐改变空间：每次开火都在**真实炮口世界点**施加反向冲量 → 开火那一帧玩家的逐帧位移被
 *      **瞬时压低**（冲量凹陷），随后由驱动重新加速；整场玩家被**真实推进** 160 世界 px
 *      （不是原地播放特效）。
 *      ⚠️ **PRP-RUN-R1 口径修正**：旧写法「开火后炮车真实后移 / 双方距离变大」只在**重型对手**
 *      下成立 —— 它靠的是对手把玩家顶回去（旧追猎者把玩家从 400 顶到 86）。本 Queue 按必改 4
 *      换用低压验证对手（菠萝冲刺车）后，两车贴身对顶、空间被接触约束，净位移不再反向。
 *      因此改用**质量无关**的冲量观测（逐帧位移凹陷），证据强度反而更高：
 *      15 次开火里 **13/13** 全部可测到凹陷，量值 0.111~0.153 世界 px/帧。
 *   ③ 碰撞需要接敌过程：先跨越距离才进入接触（首次接触严格晚于首次命中）
 *
 * 外加「必改 1」的世界尺度核对（1600 / 900 / groundY 700 / spawn 400·1200 / 中心距 800）与
 * 「PRP-R5」的相机核对（**正式 battle 相机链** + viewport adapter + 三段动态取景）。
 * 所有期望值都是**实测后冻结的字面量**：若哪天有人把 arena / spawn / 射速 / 后坐偷偷改小，
 * 或把相机改回「固定全世界远摄」，这里会立刻红。
 *
 * ⚠️ **PRP-RUN-R1 说明**：本文件的遭遇 = 本局演示遭遇 `RUN_DEMO_ENCOUNTER_ID`
 * （= **菠萝冲刺车** `R1-RUSH-02`，敌 HP **1000**；换选依据见 `runPageScene.ts` 与
 * `交接文档_2026-09-13_PRP-RUN-R1.md`）。换遭遇会改变**所有**与几何 / 时序相关的冻结值
 * ——旧「追猎者」的 900 / 529 / 269.78 / 314 等数字一律作废，必须以本文件的实测值重冻结。
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
  /**
   * 双方**耐久上限**（正式解析）。
   *
   * ⚠️ PRP-RUN-R1：「首次掉血」这类判据必须用**本场真实上限**而不是写死数字 ——
   *    写死 900 时一旦换验证对手（上限 1000），`hpB < 900` 就不再等于「首次掉血」，
   *    会把判据悄悄变成「掉了 100 点以上」，从而让 PB-05/PB-07 的关系断言失真。
   */
  readonly hpAMax: number;
  readonly hpBMax: number;
  readonly projCount: number;
  /**
   * 本步内玩家方（team `A`）是否**真实开火**（正式 `weaponFire` 事件）。
   *
   * ⚠️ PRP-RUN-R1：这是**唯一可靠**的开火判据。旧 PB-06 用「弹丸数增量」推断开火轮次，
   *    在本遭遇下只数到 3 发（真实 15 发）—— 因为两车贴合后每一发都在同一个物理步内被消耗，
   *    根本不会出现在任何一张战后快照里（见 PB-06 的逐帧证据）。
   */
  readonly fired: boolean;
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
  // 真实开火事件（正式 weaponFire；只订阅，不影响物理）
  let firedInStep = false;
  const offFire = rt.orchestrator.onCombatEvent((ev) => {
    if (ev.type === 'weaponFire' && ev.team === 'A') firedInStep = true;
  });
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
      hpAMax: rt.hp().aMax,
      hpBMax: rt.hp().bMax,
      projCount: mine.length,
      fired: firedInStep,
      projLeadX: mine.length === 0 ? null : Math.max(...mine.map((p) => p.center.x + p.radius)),
      projXs: mine.map((p) => p.center.x),
      result: rt.result !== null,
    });
    firedInStep = false;
  };
  push();
  for (let i = 0; i < maxFrames; i++) {
    if (rt.result) break;
    rt.step(FRAME_MS);
    push();
  }
  offFire();
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
    expect(hp.bMax).toBe(1000); // 菠萝冲刺车（R1-RUSH-02）
    expect(hp.a).toBe(1100);
    expect(hp.b).toBe(1000);
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
    // 冻结实测：开局 scale 0.3408 / A∪B span 83.88% / 可见世界宽 1144.39
    expect(f[0].scale).toBeCloseTo(0.3407929033822199, 12);
    expect(f[0].spanPct).toBeCloseTo(83.87891705713784, 6);
    expect(f[0].visW).toBeCloseTo(1144.3900272846686, 6);
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
    expect(far.length).toBe(64);
    expect(mid.length).toBe(66);
    expect(hit.length).toBe(714);
    // 碰撞段车辆成为主体（正式判据 ≥16% 舞台；实测 28.9%~35.4%）
    const singles = hit.map((x) => x.singlePct);
    expect(Math.min(...singles)).toBeGreaterThanOrEqual(16);
    expect(Math.min(...singles)).toBeCloseTo(28.947977, 3);
    expect(Math.max(...singles)).toBeCloseTo(35.352768, 3);
  });

  it('PB-04b 不是固定远摄：镜头真的裁世界、真的变焦（废除 PRP-F1 的永久 390/1600）', () => {
    const f = camFrames();
    // ❌ 旧行为（PRP-F1）：scale 恒 390/1600 = 0.24375、可见世界宽恒 1600、offsetX 恒 0
    expect(f.every((x) => x.scale === 390 / 1600)).toBe(false);
    // 可见世界宽全程 < 世界宽（相机确实在裁世界），开局就只有 1144（≈ 世界的 72%）
    expect(Math.max(...f.map((x) => x.visW))).toBeLessThan(DEFAULT_ARENA_CONFIG.width);
    expect(Math.max(...f.map((x) => x.visW))).toBeCloseTo(1144.39, 3);
    // 碰撞期进一步收窄到 ≈589（世界的 37%）—— 物理反馈被放大到可感知尺度
    expect(Math.min(...f.map((x) => x.visW))).toBeCloseTo(588.653, 3);
    // 变焦幅度：峰值 scale ≥ 1.9× 开局 scale（实测 0.6625 / 0.3408 = 1.944×）
    // ⚠️ PRP-RUN-R1：旧遭遇（重型对手贴身对顶）能压到 2.74×；换成低压对手后两车贴身距离更大
    //    （对手外廓更宽），峰值变焦降到 1.944× —— 仍是明确的动态取景，不是固定远摄。
    const maxScale = Math.max(...f.map((x) => x.scale));
    expect(maxScale / f[0].scale).toBeGreaterThan(1.9);
    expect(maxScale / f[0].scale).toBeCloseTo(1.944081, 3);
    expect(maxScale).toBeCloseTo(0.6625290529515256, 12);

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
    // 实测：B 右缘最大 359.36（带内留 30.6px 余量）
    expect(Math.max(...f.map((x) => x.bMaxBand))).toBeCloseTo(359.361, 3);
    expect(Math.max(...f.map((x) => x.bMaxBand))).toBeLessThanOrEqual(RUN_STAGE_BAND.w);
    // 实测：A 左缘最小 +30.64（全程留在带内）
    // ⚠️ PRP-RUN-R1：旧遭遇里玩家会被重型对手顶到世界左墙（A 左缘 −0.33，是正式相机
    //    offsetX 的「世界不出画」clamp 结果）；换低压对手后玩家被**向前推**（400 → 560），
    //    不再触边，因此最小值是正常的带内正值。正式 clamp 语义未变，只是本遭遇不触发。
    expect(Math.min(...f.map((x) => x.aMinBand))).toBeCloseTo(30.639, 3);
    expect(Math.min(...f.map((x) => x.aMinBand))).toBeGreaterThanOrEqual(0);
  });
});

/* ==================================================== 必改 5①②③ */

describe('PRP-F1｜必改 5：三条物理关系（真实物理，逐帧遥测）', () => {
  it('PB-05 关系① 炮弹飞行：弹丸离开炮口 → 飞过一段距离 → 才命中', () => {
    const f = frames();
    const firstShot = firstStepWhere(f, (x) => x.projCount > 0);
    const firstDamage = firstStepWhere(f, (x) => x.hpB < x.hpBMax || x.hpA < x.hpAMax);
    expect(firstShot).toBeGreaterThanOrEqual(0);
    expect(firstDamage).toBeGreaterThan(firstShot);

    // 开火 → 命中之间，弹丸**真实存在于空中**并且逐帧前进
    const flight = f.slice(firstShot, firstDamage);
    expect(flight.length).toBe(128); // ≈2.13s 的飞行期（正式 Cannon 的弹道确实要飞）
    const alive = flight.filter((x) => x.projXs.length > 0);
    // ⚠️ PRP-RUN-R1 实测：整段飞行期里只有 38 帧能看到弹丸 —— 因为**前两发打在地上**
    //    （真实弹道下坠：逐帧 y 654→660 递增，飞不到 564 世界 px 外的对手），
    //    第 3 发（开火于第 121 帧、贴得更近）才在第 128/129 帧命中。
    //    证据在下面：首次命中恰好只掉 **80** 点 = 正式 Cannon `projectileDamage` 的**单发**值。
    expect(alive.length).toBe(38);
    const leads = alive.map((x) => x.projLeadX!);
    // 弹丸前缘从 536 推进到 708.8（同一段飞行里 173 世界 px 的位移）
    expect(Math.round(Math.min(...leads))).toBe(536);
    expect(Math.round(Math.max(...leads))).toBe(709);
    expect(Math.max(...leads) - Math.min(...leads)).toBeCloseTo(172.836512, 3);
    expect(Math.max(...leads) - Math.min(...leads)).toBeGreaterThan(170);

    // 命中发生时两车**仍未接触**（外廓间距 47.58 世界 px > 0）→ 这一击只能来自飞行中的炮弹，
    // 不可能是碰撞伤害；真正的首次接触还要再等 18 帧（第 147 帧）。
    expect(f[firstDamage].gap).toBeGreaterThan(0);
    expect(f[firstDamage].gap).toBeCloseTo(47.582094, 3);
    // 冻结实测值（首次命中 = 第 129 帧 ≈ 2.15s）
    expect(firstDamage).toBe(129);
    // 首次命中的伤害 = 单发炮弹伤害（1000 → 920）→ 前两发确实没有命中任何东西
    expect(f[firstDamage].hpB).toBe(920);
    expect(f[firstDamage].hpBMax - f[firstDamage].hpB).toBe(80);
    // 首次开火几乎在开局（Cannon 初始就绪），弹丸出现在炮口附近而不是敌方身上
    expect(firstShot).toBe(1);
    expect(Math.round(f[firstShot].projLeadX!)).toBe(536);
  });

  it('PB-06 关系② 后坐改变空间：每次开火都真实压低位移，且整场被真实推进', () => {
    const f = frames();

    /* ── 开火口径 = 正式 weaponFire 事件（唯一可靠；不是「弹丸数增量」）── */
    const fires = f.map((x, i) => (x.fired ? i : -1)).filter((i) => i >= 0);
    // ⚠️ 旧 PB-06 用「弹丸数增量」推断开火轮次，在本遭遇下**只数到 3 发**（真实 15 发）。
    //    原因：两车贴合（第 147 帧起 gap ≤ 0）后，每一发都在**同一个物理步内**被消耗，
    //    根本不会出现在任何一张战后快照里。证据：
    //      · 全 842 帧里 projCount>0 的帧只有 38 帧，且**全部**落在前 128 帧（两车还没贴上）；
    //      · 其后 12 次开火（第 181/241/…/841 帧）在快照里一发都看不到。
    const visible = f.filter((x) => x.projCount > 0).map((x) => x.step);
    expect(visible.length).toBe(38);
    expect(Math.max(...visible)).toBe(128);
    // 真实开火 = 15 次，节奏 = 正式 Cannon cooldown 1000ms（每 60 帧一发）
    expect(fires.length).toBe(15);
    expect(fires[0]).toBe(1);
    for (let i = 1; i < fires.length; i++) expect(fires[i] - fires[i - 1]).toBe(60);

    /* ── 后坐 = 开火那一帧玩家的逐帧位移被**瞬时压低** ── */
    const usable = fires.filter((i) => i >= 3 && i + 4 < f.length);
    const delta = (i: number): number => f[i].aX - f[i - 1].aX;
    const preTrend = (i: number): number => (delta(i - 1) + delta(i - 2) + delta(i - 3)) / 3;
    const dips = usable.map((i) => preTrend(i) - delta(i));
    expect(usable.length).toBe(13);
    // **13/13 每一次开火都测到凹陷** —— 冲量与开火事件严格对齐，不是随机物理抖动
    expect(dips.filter((d) => d > 0).length).toBe(13);
    expect(Math.min(...dips)).toBeCloseTo(0.1111, 3);
    expect(Math.max(...dips)).toBeCloseTo(0.1525, 3);
    expect(Math.min(...dips)).toBeGreaterThan(0.1);

    // 跨全部开火把「相对开火帧的逐帧位移」逐元素平均 → 抖动抵消，冲量帧自己浮出来
    const avgDelta = (k: number): number => {
      const vals = usable.map((i) => delta(i + k));
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    // 开火前 3 帧在加速：0.1212 → 0.1292 → 0.1379（≈ +0.008/帧）
    expect(avgDelta(-3)).toBeCloseTo(0.1212, 3);
    expect(avgDelta(-2)).toBeCloseTo(0.1292, 3);
    expect(avgDelta(-1)).toBeCloseTo(0.1379, 3);
    // 开火帧直接塌到 0.0073（按前趋势本该是 ≈0.146）→ 瞬时掉了 ≈0.139 世界 px/帧
    expect(avgDelta(0)).toBeCloseTo(0.0073, 3);
    expect(avgDelta(-1) - avgDelta(0)).toBeGreaterThan(0.12);
    // 随后由驱动重新加速回来：0.0274 → 0.0468 → 0.0662 → 0.0849（≈ +0.019/帧）
    expect(avgDelta(1)).toBeCloseTo(0.0274, 3);
    expect(avgDelta(4)).toBeCloseTo(0.0849, 3);
    expect(avgDelta(4)).toBeGreaterThan(avgDelta(0));

    /* ── 整场空间确实被改变（不是原地播放特效）── */
    // 玩家被**真实推进** 160.5 世界 px（出生 400 → 最大 560.5）
    const maxAX = Math.max(...f.map((x) => x.aX));
    expect(maxAX).toBeCloseTo(560.533, 3);
    expect(maxAX - f[0].aX).toBeGreaterThan(150);
    // ⚠️ 反向位移在本遭遇下只剩亚像素量级（全程最小 399.35 vs 出生 400）：
    //    两车贴身对顶、空间被接触约束，玩家不会被推回出生点之后。
    //    旧断言「400 − minAX > 150（实测 314）」靠的是**重型对手把玩家顶到世界左墙**，
    //    在低压验证对手下物理上不成立 → 已按实测改为「整场真实推进量」+ 上面的冲量凹陷观测。
    expect(Math.min(...f.map((x) => x.aX))).toBeCloseTo(399.349, 3);
    expect(Math.min(...f.map((x) => x.aX))).toBeLessThan(f[0].aX);
  });

  it('PB-07 关系③ 碰撞需要接敌过程：首次接触严格晚于首次命中', () => {
    const f = frames();
    const firstDamage = firstStepWhere(f, (x) => x.hpB < x.hpBMax || x.hpA < x.hpAMax);
    const firstContact = firstStepWhere(f, (x) => x.gap <= 0);
    expect(firstContact).toBeGreaterThan(firstDamage); // 先远程交火，后才进入碰撞

    // 开局就有明确距离，并且是**连续跨越**过去的
    expect(f[0].gap).toBeCloseTo(563.663, 3);
    expect(f[0].gap).toBeGreaterThan(400);
    expect(firstContact).toBeGreaterThanOrEqual(140);
    // 冻结实测值（首次外廓重叠 = 第 147 帧，重叠 −1.17 世界 px）
    expect(firstContact).toBe(147);
    expect(f[firstContact].gap).toBeLessThanOrEqual(0);
    expect(f[firstContact].gap).toBeCloseTo(-1.169948, 3);
    expect(f[firstContact].gap).toBeGreaterThan(-10);
    const travel = f[0].gap - f[firstContact].gap;
    expect(travel).toBeCloseTo(564.833, 3); // 跨越了 564.8 世界 px 才接上
    expect(travel).toBeGreaterThan(550);

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
    // 冻结实测值：整场 842 帧 ≈ 14.03s，玩家残血 843.05 / 1100（≈ 77%）
    expect(last.step).toBe(841);
    expect(last.hpA).toBeCloseTo(843.0515, 3);
    expect(last.hpB).toBe(0);
    expect(Math.round((last.hpA / 1100) * 100)).toBe(77);
    // ⚠️ PRP-RUN-R1：本遭遇是**低压验证对手**，第一场打完还剩 77%（旧追猎者只剩 24.5%
    //    → 第二场必败 → 旧规则下会被读成 0 HP 却继续构筑）。这是三场 Build 验证能跑完的前提。
    expect(last.hpA).toBeGreaterThan(last.hpAMax * 0.7);
  });
});
