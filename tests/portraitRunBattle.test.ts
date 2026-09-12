/**
 * PRP-F1-PORTRAIT-PLANCK-BATTLE-INTEGRATION
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
 * 「相机固定」的几何核对。所有期望值都是**实测后冻结的字面量**：
 * 若哪天有人把 arena / spawn / 射速 / 后坐偷偷改小，这里会立刻红。
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_ARENA_CONFIG } from '../src/battle/arenaConfig';
import { RUN_STAGE_BAND } from '../src/lab/portraitBattleLab/runPageLayout';
import {
  RUN_BATTLE_GROUND_FRAC,
  RunBattleRuntime,
  runBattleCamera,
} from '../src/lab/portraitBattleLab/runBattleRuntime';

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

/* ==================================================== 必改 3：固定相机 */

describe('PRP-F1｜相机是固定远摄（完整世界 + 固定取景）', () => {
  it('PB-03 相机覆盖完整世界 0..1600，且不随车辆位置变化', () => {
    const cam = runBattleCamera(RUN_STAGE_BAND.w, RUN_STAGE_BAND.h);
    expect(cam.scale).toBeCloseTo(390 / 1600, 12);
    expect(cam.offsetX).toBe(0);
    expect(cam.offsetX + cam.worldW * cam.scale).toBeCloseTo(cam.viewW, 9); // 右边缘 = 视野右边缘
    expect(cam.groundScreenY).toBeCloseTo(RUN_STAGE_BAND.h * RUN_BATTLE_GROUND_FRAC, 9);
    // 离屏战斗画布的坐标原点就是舞台带左上角 → 带内相对位置 = RUN_BATTLE_GROUND_FRAC
    expect(cam.groundScreenY / RUN_STAGE_BAND.h).toBeCloseTo(RUN_BATTLE_GROUND_FRAC, 9);
    expect(cam.groundScreenY / RUN_STAGE_BAND.h).toBeGreaterThan(0.6); // 上方留出弹道空间
    expect(cam.groundScreenY).toBeLessThan(RUN_STAGE_BAND.h);
    // 纯函数：相同入参 → 相同结果（函数没有任何「车辆位置」入参）
    expect(runBattleCamera(RUN_STAGE_BAND.w, RUN_STAGE_BAND.h)).toEqual(cam);
  });

  it('PB-04 车辆世界位移不会引起取景变化（收束阶段也不把车挤出画面）', () => {
    const cam = runBattleCamera(RUN_STAGE_BAND.w, RUN_STAGE_BAND.h);
    const f = frames();
    const toView = (x: number): number => cam.offsetX + x * cam.scale;
    const minAMinX = Math.min(...f.map((x) => x.aMinX));
    const maxBMaxX = Math.max(...f.map((x) => x.bMaxX));
    // 实测：整场战斗两车的真实可见外廓都被框在视野内。
    // ⚠️ 唯一例外是收束阶段玩家被刺墙推到左墙里，**sprite 外廓**越过世界左边界 ≈4 世界 px
    //    （≈1 逻辑 px，亚像素级）；这是正式战斗自身的行为，PRP 不为此改任何物理。
    expect(toView(maxBMaxX)).toBeLessThanOrEqual(cam.viewW + 1.5);
    expect(toView(minAMinX)).toBeGreaterThanOrEqual(-1.5);
    expect(Math.round(minAMinX)).toBe(-4);
    // 实测：收束阶段玩家被推到 x≈86（远小于开局外廓左缘 310）
    // → 任何「只框开局交战段」的固定取景都会在这里把车裁掉，只有框住完整世界才安全。
    const minAX = Math.min(...f.map((x) => x.aX));
    expect(minAX).toBeLessThan(150);
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
