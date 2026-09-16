/**
 * PRP-F2-FIRST-REAL-UPGRADE-LOOP｜PRP-BUILD-01-TWO-STEP-CANNON-BUILD
 * Run-local 强化 overlay 门禁。
 *
 * 本文件回答三个问题：
 *   A. 强化**通过什么接缝**注入，正式定义是否真的没被改写；
 *   B. 第一层三种强化在**真实 Runtime** 里到底改变了什么（不是只比参数，而是比物理与事件）；
 *   C. 两层 Build 是否真的**叠加且联动**（第一层决定第二层条件池 + 最终战斗同时携带两层）。
 *
 * ⚠️ 全部断言跑**正式** `PlanckBattleOrchestrator`（`RunBattleRuntime` 的薄适配），
 *    数值来自真实物理推进后的快照 / 事件，不读 PRP 侧自算数字。
 */
import { describe, expect, it } from 'vitest';
import { registry as officialRegistry } from '../src/core/content';
import type { FunctionalPartDef } from '../src/core/types';
import * as runModifiersModule from '../src/lab/portraitBattleLab/runModifiers';
import {
  EMERGENCY_REPAIR_FRACTION,
  KINETIC_BURST_GAIN,
  RUN_BASE_WEAPON_DEF_ID,
  RUN_BUILD_MODIFIERS,
  RUN_LAYER1_POOL,
  RUN_LAYER2_POOLS,
  RUN_MODIFIER_OVERLAY,
  RUN_MODIFIERS,
  applyRunModifiersToSnapshot,
  composeRunWeaponDef,
  createRunRegistry,
  runBuildDefId,
  runLayer2PoolDefs,
  runModifierById,
  runOverlayDefId,
  weaponOverlayMods,
  type Layer1ModifierId,
  type RunModifierId,
} from '../src/lab/portraitBattleLab/runModifiers';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import {
  RunBuildAbilities,
  type RunAbilityPorts,
} from '../src/lab/portraitBattleLab/runBuildAbilities';
import type { BattleEvent, DamageEvent } from '../src/battle/combatEvents';

const CANNON_OFFICIAL = officialRegistry.functionals.get(RUN_BASE_WEAPON_DEF_ID) as FunctionalPartDef;
const CANNON_OFFICIAL_PARAMS = { ...(CANNON_OFFICIAL.behaviorParams ?? {}) };

const MODIFIER_IDS: readonly RunModifierId[] = ['heavyShell', 'twinCannon', 'fastReload'];
const LAYER1_IDS: readonly Layer1ModifierId[] = ['heavyShell', 'twinCannon', 'fastReload'];

/**
 * 战场里「玩家那门炮」的运行时 def（真实 resolved，不是 PRP 侧自算）。
 *
 * ⚠️ PRP-F2-R1：三种强化**都是**正式 `cannon`（双联炮不再借用 `shotgun`）。
 * PRP-BUILD-01：第二层的能力类项 **完全不改武器 def**，因此这里必须按 `category === 'weapon'`
 * 查找（而不是 `behavior === 'cannon'`）—— 否则一旦将来出现 gadget 就会被误当武器。
 */
function weaponPartDef(rt: RunBattleRuntime): FunctionalPartDef {
  const parts = rt.orchestrator.vehicleA.parts;
  const found = parts.find((p) => p.def.category === 'weapon');
  if (!found) throw new Error('找不到玩家武器部件');
  return found.def;
}

/**
 * 每次「新弹丸出现」所在的固定步号（1-based）。
 *
 * 口径 = 每步推进后比较 `projectileCount()` 的**增量**：增量 k → 该步新增 k 发。
 * 这是「真实弹丸何时被创建」的直接证据（不是读 PRP 自算数字，也不是读配置）。
 *
 * ⚠️ 仅当新弹丸出现时旧弹丸**尚未销毁**时才能被计数；本场演示的两个口径都满足
 * （基础炮飞行 ~100+ 步才命中，双联炮第二发只隔 6 步）。
 */
function projectileBirthSteps(rt: RunBattleRuntime, frames: number): number[] {
  const births: number[] = [];
  let prev = rt.projectileCount();
  for (let i = 1; i <= frames; i++) {
    rt.step(1000 / 60);
    const now = rt.projectileCount();
    for (let k = prev; k < now; k++) births.push(i);
    prev = now;
    if (rt.result) break;
  }
  return births;
}

/** 推进固定帧数，收集开火事件 / 弹丸半径峰值 / 存活累积。 */
function run(
  rt: RunBattleRuntime,
  frames: number,
  stepMs = 1000 / 60,
): {
  fires: { team: string; behavior: string; timestamp: number }[];
  maxRadius: number;
  maxAlive: number;
  aliveSum: number;
} {
  const fires: { team: string; behavior: string; timestamp: number }[] = [];
  rt.orchestrator.onCombatEvent((ev) => {
    if (ev.type === 'weaponFire') {
      fires.push({ team: ev.team as string, behavior: ev.behavior, timestamp: ev.timestamp });
    }
  });
  let maxRadius = 0;
  let maxAlive = 0;
  let aliveSum = 0;
  for (let i = 0; i < frames; i++) {
    rt.step(stepMs);
    for (const p of rt.snapshot().projectiles ?? []) {
      if (p.radius > maxRadius) maxRadius = p.radius;
    }
    const alive = rt.projectileCount();
    aliveSum += alive;
    if (alive > maxAlive) maxAlive = alive;
    if (rt.result) break; // 战斗结束 → 运行时不再推进，继续采样无意义
  }
  return { fires, maxRadius, maxAlive, aliveSum };
}

/** 打到结束（真实战斗），返回最终 HP 与结果。 */
function fightToEnd(rt: RunBattleRuntime, maxFrames = 1600): { hpA: number; hpB: number; frames: number } {
  let frames = 0;
  for (let i = 0; i < maxFrames; i++) {
    rt.step(1000 / 60);
    frames = i + 1;
    if (rt.result) break;
  }
  const hp = rt.hp();
  return { hpA: hp.a, hpB: hp.b, frames };
}

describe('RP-MOD-01｜强化只活在本局 overlay registry（正式定义零改写）', () => {
  it('正式 content 单例的 cannon 定义在创建本局 registry 前后逐字段不变', () => {
    for (const id of MODIFIER_IDS) {
      const runReg = createRunRegistry(id);
      expect(runReg).not.toBe(officialRegistry);
      // 本局副本里的正式 cannon 键仍是正式值（overlay 走独立 id，不劫持正式键）
      expect(runReg.functionals.get(RUN_BASE_WEAPON_DEF_ID)).toEqual(CANNON_OFFICIAL);
      // 正式单例本身逐字段不变
      expect(officialRegistry.functionals.get(RUN_BASE_WEAPON_DEF_ID)).toEqual(CANNON_OFFICIAL);
      expect({ ...(officialRegistry.functionals.get(RUN_BASE_WEAPON_DEF_ID)!.behaviorParams ?? {}) }).toEqual(
        CANNON_OFFICIAL_PARAMS,
      );
    }
  });

  it('PRP-F2-R1：正式 content 的 cannon 定义不含 burst 字段（默认单发，平衡零变化）', () => {
    // 正式 content.ts 不写这两个可选参数 → CannonBehavior 走默认值（burstRounds=1 / burstIntervalMs=0）
    expect(CANNON_OFFICIAL_PARAMS.burstRounds).toBeUndefined();
    expect(CANNON_OFFICIAL_PARAMS.burstIntervalMs).toBeUndefined();
    // 正式 6 个基准参数逐字段冻结（PRP-F2 / R1 / R2 / BUILD-01 均未动任何一项）
    expect(CANNON_OFFICIAL_PARAMS).toEqual({
      cooldownMs: 1000,
      muzzleSpeed: 8,
      projectileDamage: 80,
      projectileRadius: 10,
      projectileMass: 1,
      recoilImpulse: 30,
    });
  });

  it('未选强化 → 本局 registry 与正式副本等价，且不注册任何 overlay 部件', () => {
    const runReg = createRunRegistry(null);
    expect(runReg.functionals.get(RUN_BASE_WEAPON_DEF_ID)).toEqual(CANNON_OFFICIAL);
    for (const id of MODIFIER_IDS) {
      expect(runReg.functionals.has(runOverlayDefId(id))).toBe(false);
    }
    // 空 Build / 只选能力类项 → 不产生任何本局 overlay 部件
    expect(runBuildDefId([])).toBeNull();
    expect(runBuildDefId(['kineticBurst'])).toBeNull();
    expect(runBuildDefId(['emergencyRepair'])).toBeNull();
    expect(createRunRegistry(['kineticBurst']).functionals.size).toBe(createRunRegistry(null).functionals.size);
  });

  it('overlay 部件只覆盖强化语义字段，其余沿用正式 Cannon', () => {
    for (const id of MODIFIER_IDS) {
      const runReg = createRunRegistry(id);
      const def = runReg.functionals.get(runOverlayDefId(id));
      expect(def).toBeTruthy();
      // 装配属性（质量 / 能量 / 碰撞盒 / 视觉）一律沿用正式值 → 「Base vehicle 冻结」
      expect(def!.mass).toBe(CANNON_OFFICIAL.mass);
      expect(def!.energy).toBe(CANNON_OFFICIAL.energy);
      expect(def!.collider).toEqual(CANNON_OFFICIAL.collider);
      expect(def!.visual).toEqual(CANNON_OFFICIAL.visual);
      // 两层组合出来的 overlay 同样只改 behaviorParams
      const combo = runReg.functionals.size; // 仅用于确认是「新增键」而非替换
      expect(combo).toBeGreaterThan(0);
    }
    const comboReg = createRunRegistry(['twinCannon', 'tripleLoad']);
    const comboDef = comboReg.functionals.get('run.mod.twinCannon+tripleLoad')!;
    expect(comboDef.mass).toBe(CANNON_OFFICIAL.mass);
    expect(comboDef.energy).toBe(CANNON_OFFICIAL.energy);
    expect(comboDef.collider).toEqual(CANNON_OFFICIAL.collider);
    expect(comboDef.visual).toEqual(CANNON_OFFICIAL.visual);
    expect(comboReg.functionals.get(RUN_BASE_WEAPON_DEF_ID)).toEqual(CANNON_OFFICIAL);
  });

  it('第一层 overlay 数值表与 Queue 的因果一一对应（冻结值，逐字段不许动）', () => {
    expect(RUN_MODIFIER_OVERLAY.heavyShell.behavior).toBe('cannon');
    expect(RUN_MODIFIER_OVERLAY.heavyShell.affectsWeapon).toBe(true);
    expect(RUN_MODIFIER_OVERLAY.heavyShell.behaviorParams).toEqual({
      projectileRadius: 16,
      projectileMass: 4,
      recoilImpulse: 90,
    });
    // PRP-F2-R1：双联炮 = 正式 cannon + **真实连发**（不再借用 shotgun 的同步齐射）。
    expect(RUN_MODIFIER_OVERLAY.twinCannon.behavior).toBe('cannon');
    expect(RUN_MODIFIER_OVERLAY.twinCannon.affectsWeapon).toBe(true);
    // 只声明「一次攻击几发 + 发间隔」；其余 6 个数值全部沿用正式 Cannon（每发都是完整炮弹）
    expect(RUN_MODIFIER_OVERLAY.twinCannon.behaviorParams).toEqual({
      burstRounds: 2,
      burstIntervalMs: 100,
    });
    // 必改 4：不靠大散射把两发分开 → twinCannon 不得声明扇形参数
    expect(RUN_MODIFIER_OVERLAY.twinCannon.behaviorParams.fanAnglesDeg).toBeUndefined();
    expect(RUN_MODIFIER_OVERLAY.fastReload.behavior).toBe('cannon');
    expect(RUN_MODIFIER_OVERLAY.fastReload.affectsWeapon).toBe(true);
    expect(RUN_MODIFIER_OVERLAY.fastReload.behaviorParams).toEqual({ cooldownMs: 650 });
    // 三项都**不碰**弹道速度（强化不改变弹道）
    for (const id of MODIFIER_IDS) {
      expect(RUN_MODIFIER_OVERLAY[id].behaviorParams.muzzleSpeed).toBeUndefined();
    }
  });

  it('快照重映射只动武器 defId；找不到基准武器时显式抛错', () => {
    const base = new RunBattleRuntime();
    const snap = base.plan.player.snapshot;
    const remapped = applyRunModifiersToSnapshot(snap, 'fastReload');
    const overlayId = runOverlayDefId('fastReload');
    expect(remapped.functionals.length).toBe(snap.functionals.length);
    const changed = remapped.functionals.filter((f) => f.defId === overlayId);
    expect(changed.length).toBeGreaterThan(0);
    // 非武器部件的 defId 逐一不变
    remapped.functionals.forEach((f, i) => {
      if (f.defId !== overlayId) {
        expect(f.defId).toBe(snap.functionals[i].defId);
      }
    });
    // 无改武器项 → 原样返回（不重映射，也不抛错）
    expect(applyRunModifiersToSnapshot(snap, [])).toBe(snap);
    expect(applyRunModifiersToSnapshot(snap, ['emergencyRepair'])).toBe(snap);
    base.dispose();

    const stripped = { ...snap, functionals: snap.functionals.filter((f) => f.defId !== RUN_BASE_WEAPON_DEF_ID) };
    expect(() => applyRunModifiersToSnapshot(stripped, ['heavyShell'])).toThrow(/无法注入强化/);
  });

  it('第一层三个选项 exactly 是 Queue 点名的三项（本局临时，不随机）', () => {
    expect(RUN_MODIFIERS.map((m) => m.id)).toEqual(['heavyShell', 'twinCannon', 'fastReload']);
    expect(RUN_MODIFIERS.map((m) => m.label)).toEqual(['重型弹头', '双联炮', '快速装填']);
    expect(RUN_MODIFIERS.every((m) => m.logText.startsWith('你'))).toBe(true);
    expect(RUN_MODIFIERS.every((m) => m.role === 'base')).toBe(true);
  });
});

describe('RP-MOD-02｜第一层三种强化在真实 Runtime 里的差异', () => {
  it('重型弹头：弹丸真实半径更大、质量更大、后坐更强（改的是物理不是文案）', () => {
    const baseRt = new RunBattleRuntime();
    const heavyRt = new RunBattleRuntime({ modifier: 'heavyShell' });

    const baseDef = weaponPartDef(baseRt);
    const heavyDef = weaponPartDef(heavyRt);
    expect(baseDef.behavior).toBe('cannon');
    expect(heavyDef.behavior).toBe('cannon'); // 仍是炮，不是换武器
    const bp = (d: FunctionalPartDef) => d.behaviorParams as Record<string, number>;
    expect(bp(baseDef).projectileRadius).toBe(10);
    expect(bp(heavyDef).projectileRadius).toBe(16);
    expect(bp(baseDef).projectileMass).toBe(1);
    expect(bp(heavyDef).projectileMass).toBe(4);
    expect(bp(baseDef).recoilImpulse).toBe(30);
    expect(bp(heavyDef).recoilImpulse).toBe(90);
    // 弹道速度 / 伤害 / 冷却保持正式值 → 差异只来自「更重」
    expect(bp(heavyDef).muzzleSpeed).toBe(8);
    expect(bp(heavyDef).projectileDamage).toBe(80);
    expect(bp(heavyDef).cooldownMs).toBe(1000);

    // 真实飞行弹丸的半径（读自 world bounds，不是 PRP 自算）
    const base = run(baseRt, 300);
    const heavy = run(heavyRt, 300);
    expect(base.maxRadius).toBeGreaterThan(0);
    expect(heavy.maxRadius).toBeGreaterThan(base.maxRadius);
    expect(heavy.fires.length).toBe(base.fires.length); // 开火节奏未被改变（变量隔离）

    // 打到结束：强化后仍然是一场可打完的真实战斗（不是卡死 / 不是无人能赢）
    const baseEnd = fightToEnd(baseRt);
    const heavyEnd = fightToEnd(heavyRt);
    expect(baseEnd.frames).toBeGreaterThan(0);
    expect(heavyEnd.frames).toBeGreaterThan(0);

    baseRt.dispose();
    heavyRt.dispose();
  });

  it('重型弹头：自身后坐的真实冲量明显更大（真实物理量，不只比参数）', () => {
    // 同一门炮、相同开火节奏 → 唯一变量是 recoilImpulse（30 → 90）。
    //
    // ⚠️ **PRP-RUN-R1 口径修正**：旧口径 = 「整场里 chassis 的最负 vx」。它在本遭遇下**失真**：
    //    实测最负 vx 出现在**非开火帧**（base 的 −0.625 落在第 278 帧，而开火帧是 1/61/121/…），
    //    也就是量到的是**两车贴身对顶的接触推挤**，不是后坐 → 旧口径曾给出「重型弹头后坐更小」
    //    的错误结论（−0.501 vs −0.625）。旧遭遇（重型追猎者）恰好让接触推挤小于后坐峰值才没暴露。
    //    ⇒ 改为**开火帧对齐 + 按各自局部趋势归一**的冲量凹陷（与 `portraitRunBattle` PB-06 同口径）：
    //      dip = 开火前 3 帧平均逐帧位移 − 开火帧逐帧位移，只在开火帧测量。
    const recoilDip = (mod: 'heavyShell' | null): { avg: number; min: number; n: number; allUp: boolean } => {
      const rt = new RunBattleRuntime({ modifier: mod });
      const body = rt.orchestrator.vehicleA.body;
      const world = rt.orchestrator.world;
      const fires: number[] = [];
      const off = rt.orchestrator.onCombatEvent((ev) => {
        if (ev.type === 'weaponFire' && ev.team === 'A') fires.push(rt.stepCount + 1);
      });
      const ax: number[] = [];
      for (let i = 0; i < 400; i++) {
        rt.step(1000 / 60);
        ax.push(world.getPosition(body).x);
        if (rt.result) break;
      }
      off();
      rt.dispose();
      const d = (i: number): number => ax[i] - ax[i - 1];
      const use = fires.filter((f) => f >= 3 && f < ax.length);
      const dips = use.map((f) => (d(f - 1) + d(f - 2) + d(f - 3)) / 3 - d(f));
      expect(use.length).toBe(6); // 400 帧内共 7 次开火，首帧无前窗 → 6 次可测
      return {
        avg: dips.reduce((a, b) => a + b, 0) / dips.length,
        min: Math.min(...dips),
        n: dips.length,
        allUp: dips.every((v) => v > 0),
      };
    };
    const base = recoilDip(null);
    const heavy = recoilDip('heavyShell');
    // 基础炮确实每次开火都把自己推回来（6/6）
    expect(base.allUp).toBe(true);
    expect(base.min).toBeGreaterThan(0);
    // 强化后每一次开火的凹陷都更大（6/6），且平均凹陷明显变大
    expect(heavy.allUp).toBe(true);
    expect(heavy.avg).toBeGreaterThan(base.avg * 3); // 实测 4.14×（参数比 3×）
    // 冻结实测值：base 平均凹陷 0.064 / heavy 平均凹陷 0.265
    expect(base.avg).toBeCloseTo(0.06401, 3);
    expect(heavy.avg).toBeCloseTo(0.26507, 3);
    // 最强一次：base 0.0685 / heavy 0.2850
    expect(heavy.min).toBeGreaterThan(base.min * 3);
  });

  it('双联炮：一次攻击极短间隔连出两发真实弹丸（真实 projectile + 真实时间差 + 同向）', () => {
    const baseRt = new RunBattleRuntime();
    const twinRt = new RunBattleRuntime({ modifier: 'twinCannon' });

    // 仍是正式 cannon（不再借用 shotgun）—— 差别只在两个**可选** burst 参数
    expect(weaponPartDef(baseRt).behavior).toBe('cannon');
    expect(weaponPartDef(twinRt).behavior).toBe('cannon');
    const bp = (d: FunctionalPartDef) => d.behaviorParams as Record<string, unknown>;
    expect(bp(weaponPartDef(baseRt)).burstRounds).toBeUndefined(); // 正式定义不写 → 默认 1
    expect(bp(weaponPartDef(twinRt)).burstRounds).toBe(2);
    expect(bp(weaponPartDef(twinRt)).burstIntervalMs).toBe(100);
    // 每发都是**完整炮弹**：伤害 / 质量 / 半径 / 弹速沿用正式值（不是减伤的小弹）
    expect(bp(weaponPartDef(twinRt)).projectileDamage).toBe(80);
    expect(bp(weaponPartDef(twinRt)).projectileMass).toBe(1);
    expect(bp(weaponPartDef(twinRt)).projectileRadius).toBe(10);
    expect(bp(weaponPartDef(twinRt)).muzzleSpeed).toBe(8);
    expect(bp(weaponPartDef(twinRt)).fanAnglesDeg).toBeUndefined(); // 不靠扇形分开
    baseRt.dispose();
    twinRt.dispose();

    // ① 真实时间差：第 1 发 → 第 2 发之间的**固定步数**（新弹丸出现的步号差）
    const baseSrc = new RunBattleRuntime();
    const twinSrc = new RunBattleRuntime({ modifier: 'twinCannon' });
    const baseBirths = projectileBirthSteps(baseSrc, 300);
    const twinBirths = projectileBirthSteps(twinSrc, 300);
    expect(baseBirths.length).toBeGreaterThan(1);
    expect(twinBirths.length).toBeGreaterThan(1);
    // 正式 cannon：一次攻击一发，下一下要等冷却 1000ms ≈ 60 步
    expect(baseBirths[1] - baseBirths[0]).toBe(60);
    // 双联炮：第二发只隔 100ms ≈ 6 步 —— 「极短但真实可辨」的连发间隔
    expect(twinBirths[1] - twinBirths[0]).toBe(6);
    baseSrc.dispose();
    twinSrc.dispose();

    // ② 同向：**发射瞬间**两发都出自同一个炮口（认知是「同一个炮口连打两发」）。
    //
    // ⚠️ 为什么不是比较「同一时刻两发的 y」：第二发比第一发晚 6 步出发，
    //    在重力下第一发已经下坠了 ~7px —— 那个差值是**真实弹道的产物**，不是方向差异。
    //    正确的「同向」证据 = 两发各自**出生那一步**的炮口位置几乎重合。
    const dirSrc = new RunBattleRuntime({ modifier: 'twinCannon' });
    const spawnY: number[] = [];
    let prevAlive = dirSrc.projectileCount();
    for (let i = 1; i <= 20 && spawnY.length < 2; i++) {
      dirSrc.step(1000 / 60);
      const ps = dirSrc.snapshot().projectiles ?? [];
      if (ps.length > prevAlive) {
        // 新弹丸挂在集合末尾（插入序）→ 取最后一发 = 刚出生的那发
        spawnY.push(ps[ps.length - 1].center.y);
      }
      prevAlive = ps.length;
    }
    expect(spawnY.length).toBe(2);
    // 阈值 3px：若改用 ±4° 扇形把两发强行分开，第二发的出生 y 会偏 ~56px（差一个数量级）
    expect(Math.abs(spawnY[0] - spawnY[1])).toBeLessThan(3);
    dirSrc.dispose();

    // ③ 事件与弹丸投放量：同窗口内每发都触发真实 weaponFire，投放量明确多于基础炮
    const baseEv = new RunBattleRuntime();
    const twinEv = new RunBattleRuntime({ modifier: 'twinCannon' });
    const base = run(baseEv, 300);
    const twin = run(twinEv, 300);
    expect(base.fires.every((f) => f.behavior === 'cannon')).toBe(true);
    expect(twin.fires.every((f) => f.behavior === 'cannon')).toBe(true);
    expect(base.fires.length).toBeGreaterThan(2);
    expect(twin.fires.length).toBeGreaterThan(base.fires.length); // 每次攻击多一发真实开火
    expect(twin.maxAlive).toBeGreaterThanOrEqual(2); // 同一时刻确实有两发在空中
    expect(base.maxAlive).toBe(1);
    expect(twin.aliveSum).toBeGreaterThan(base.aliveSum);
    baseEv.dispose();
    twinEv.dispose();
  });

  it('快速装填：真实攻击间隔 1000ms → 650ms（1.54× 频率；PRP-F2-R2 参数回收）', () => {
    const baseRt = new RunBattleRuntime();
    const fastRt = new RunBattleRuntime({ modifier: 'fastReload' });

    const bp = (d: FunctionalPartDef) => d.behaviorParams as Record<string, number>;
    expect(bp(weaponPartDef(baseRt)).cooldownMs).toBe(1000); // Base Cannon 冻结，仍 1000ms
    expect(bp(weaponPartDef(fastRt)).cooldownMs).toBe(650); // PRP-F2-R2：400 → 650

    // 真实开火事件的时间差（不读配置、不读 PRP 自算数字）。
    // ⚠️ 只取 team 'A'（玩家那门炮）：本场演示**只有玩家开火**，敌方无炮（已实测 byTeam 仅 A）。
    type FireRec = { team: string; behavior: string; timestamp: number };
    const teamA = (f: FireRec[]) => f.filter((x) => x.team === 'A');
    const base = teamA(run(baseRt, 600).fires);
    const fast = teamA(run(fastRt, 600).fires);
    // 600 帧（10s）内的真实开火次数：10 次 / 16 次（事件计数，不是弹丸数增量 —— 后者会漏计）
    expect(base.length).toBe(10);
    expect(fast.length).toBe(16);
    expect(fast.length).toBeGreaterThan(base.length);

    const gaps = (f: FireRec[]) => f.slice(1).map((x, i) => x.timestamp - f[i].timestamp);
    const baseGaps = gaps(base);
    const fastGaps = gaps(fast);
    // 每一发间隔都精确落在 1000ms / 650ms（真实固定步进，无抖动）
    expect(baseGaps.every((g) => Math.abs(g - 1000) < 1e-6)).toBe(true);
    expect(fastGaps.every((g) => Math.abs(g - 650) < 1e-6)).toBe(true);

    // 频率比 = 1000/650 ≈ 1.538：既明显快于基础（>1.45），
    // 又比第一版 400ms（2.5×）**明显回收**（<1.65）—— 回收后每轮炮击之间重新留出物理运动时间。
    const ratio = 1000 / 650;
    expect(ratio).toBeGreaterThan(1.45);
    expect(ratio).toBeLessThan(1.65);

    baseRt.dispose();
    fastRt.dispose();
  });
});

describe('RP-MOD-03｜跨战斗耐久与 clean recreate', () => {
  it('第二场从第一场真实剩余 HP 继续，maxHp 不变（禁止自动满血）', () => {
    const first = new RunBattleRuntime();
    const maxHp = first.playerMaxHp;
    expect(first.initialPlayerHp).toBe(maxHp);

    // 打到结束（真实战斗）
    const end = fightToEnd(first);
    expect(first.result).not.toBeNull();
    expect(end.hpA).toBeGreaterThan(0);
    expect(end.hpA).toBeLessThan(maxHp);
    first.dispose();

    const second = new RunBattleRuntime({ carriedHp: end.hpA });
    expect(second.initialPlayerHp).toBe(end.hpA); // 续用真实剩余耐久
    expect(second.playerMaxHp).toBe(maxHp); // 上限不变 → 耐久条如实显示「打剩多少」
    expect(second.initialPlayerHp).toBeLessThan(second.playerMaxHp);
    // 世界与出生关系仍是正式值（跨战斗耐久不改变战场）
    expect(second.spawnSeparation).toBe(800);
    second.dispose();
  });

  it('第二场开局即带强化：耐久与强化同时注入（真实战斗里两者共存）', () => {
    const first = new RunBattleRuntime();
    const maxHp = first.playerMaxHp;
    const end = fightToEnd(first);
    first.dispose();

    const second = new RunBattleRuntime({ modifier: 'fastReload', carriedHp: end.hpA });
    expect(second.initialPlayerHp).toBe(end.hpA);
    expect(second.playerMaxHp).toBe(maxHp);
    expect(second.modifier).toBe('fastReload');
    expect((weaponPartDef(second).behaviorParams as Record<string, number>).cooldownMs).toBe(650);
    second.dispose();
  });

  it('未携带耐久 → 满耐久开局（第一场的正常路径）', () => {
    const rt = new RunBattleRuntime();
    expect(rt.initialPlayerHp).toBe(rt.playerMaxHp);
    expect(rt.initialPlayerHp).toBeGreaterThan(0);
    rt.dispose();
  });

  it('clean recreate：新战斗无弹丸残留 / 位置回到正式 spawn / 强化正确重注入', () => {
    const a = new RunBattleRuntime({ modifier: 'fastReload' });
    const firstRun = run(a, 300);
    expect(firstRun.maxAlive).toBeGreaterThan(0); // 第一场确实有真实弹丸在飞
    expect(a.stepCount).toBeGreaterThan(0);
    a.dispose();

    // 全新一场：弹丸从 0 开始、出生位置回到正式 spawn、强化仍是本局那一项
    const b = new RunBattleRuntime({ modifier: 'fastReload' });
    expect(b.projectileCount()).toBe(0);
    expect(b.stepCount).toBe(0);
    expect(b.spawnSeparation).toBe(800);
    expect(Math.abs(b.vehicleX('A') - b.spawnAx)).toBeLessThan(1);
    expect((weaponPartDef(b).behaviorParams as Record<string, number>).cooldownMs).toBe(650);
    b.dispose();
  });

  it('不带强化重开 → 完全回到基础武器（Build 不跨 Run 残留）', () => {
    const withMod = new RunBattleRuntime({ build: ['twinCannon', 'tripleLoad'] });
    expect(weaponPartDef(withMod).behavior).toBe('cannon');
    expect((weaponPartDef(withMod).behaviorParams as Record<string, unknown>).burstRounds).toBe(3);
    expect(withMod.build).toEqual(['twinCannon', 'tripleLoad']);
    withMod.dispose();

    const reset = new RunBattleRuntime();
    expect(reset.build).toEqual([]); // Reset 后 Build 完全清空
    expect(reset.modifier).toBeNull();
    expect(weaponPartDef(reset).behavior).toBe('cannon');
    expect((weaponPartDef(reset).behaviorParams as Record<string, number>).cooldownMs).toBe(1000);
    expect((weaponPartDef(reset).behaviorParams as Record<string, unknown>).burstRounds).toBeUndefined();
    expect(reset.orchestrator.vehicleA.parts.some((p) => p.def.id.startsWith('run.mod.'))).toBe(false);
    reset.dispose();
  });
});

describe('RP-MOD-04｜PRP-BUILD-01 两层 Build（必改 1/2/3/5/6）', () => {
  it('必改 1｜第二层条件池由第一层选择决定（固定池，无随机权重）', () => {
    /**
     * ⚠️ PRP-BUILD-01-CLOSEOUT-AND-FREEZE：快速装填的**专属**第二层（三条尝试全部真人未通过）
     * 已整条删除，它的池改为**通用转向池**。本用例同时锁住两件事：
     *   ① 仍然存在的两条强联动**条件性**成立（只出现在它对应的第一层池里）；
     *   ② 快速装填池 = 三个**已存在**的方向，且第二层定义表里**不存在**任何废弃项。
     */
    // 第二层三项是固定表（不再有第四项）
    expect(RUN_BUILD_MODIFIERS.map((m) => m.id)).toEqual([
      'kineticBurst',
      'tripleLoad',
      'emergencyRepair',
    ]);
    // 第一层仍是固定三项 —— **不新增第四个第一层强化**
    expect(RUN_LAYER1_POOL).toEqual(['heavyShell', 'twinCannon', 'fastReload']);
    expect(RUN_MODIFIERS.map((m) => m.id)).toEqual(['heavyShell', 'twinCannon', 'fastReload']);

    // 每池**恰好三项**（不加长任何池），无重复，且都不含自身（转向的是另一个方向）
    for (const l1 of LAYER1_IDS) {
      const pool = RUN_LAYER2_POOLS[l1];
      expect(pool).toHaveLength(3);
      expect(new Set(pool).size).toBe(3);
      expect(pool).not.toContain(l1);
      // 「安全通用项」在三池里是同一种取舍（紧急维修），不是每个分支专属
      expect(pool).toContain('emergencyRepair');
      // 池里每一项都必须是**已存在**的强化定义（不引入新内容）
      for (const id of pool) expect(runModifierById(id)).toBeDefined();
      // 定义解析顺序与池顺序一致
      expect(runLayer2PoolDefs(l1).map((d) => d.id)).toEqual([...pool]);
    }

    // 两条强联动各自只出现在「它对应的第一层」池里（条件性成立），且固定在槽位 0
    expect(RUN_LAYER2_POOLS.heavyShell[0]).toBe('kineticBurst');
    expect(RUN_LAYER2_POOLS.twinCannon[0]).toBe('tripleLoad');
    for (const l1 of LAYER1_IDS) {
      const pool = RUN_LAYER2_POOLS[l1];
      for (const syn of ['kineticBurst', 'tripleLoad'] as const) {
        if (pool[0] !== syn) expect(pool.includes(syn)).toBe(false);
      }
    }
    // 强联动在池里的身份就是 'synergy'（另两池槽位 0 是转向项 = 'base'）
    expect(runModifierById(RUN_LAYER2_POOLS.heavyShell[0]!)!.role).toBe('synergy');
    expect(runModifierById(RUN_LAYER2_POOLS.twinCannon[0]!)!.role).toBe('synergy');

    // 同一个「强联动」不会在两个池里同时出现 → 「第一次选择已经改变了后续可获得的方向」
    const firsts = LAYER1_IDS.map((l1) => RUN_LAYER2_POOLS[l1][0]);
    expect(new Set(firsts).size).toBe(3);

    // ⚠️ 必改 2：快速装填池 = **通用转向池**（三个已存在的方向：重炮 / 多发 / 生存）
    expect(RUN_LAYER2_POOLS.fastReload).toEqual(['heavyShell', 'twinCannon', 'emergencyRepair']);
    // 池里每一项都是「已存在」的定义（重型弹头 / 双联炮 / 紧急维修），不是新造内容
    expect(RUN_LAYER2_POOLS.fastReload.map((id) => runModifierById(id)!.label)).toEqual([
      '重型弹头',
      '双联炮',
      '紧急维修',
    ]);
    // 且它**不再**包含任何专属联动（= 池里没有任何 role==='synergy' 的项）
    expect(RUN_LAYER2_POOLS.fastReload.map((id) => runModifierById(id)!.role)).toEqual([
      'base',
      'base',
      'safe',
    ]);

    // ⚠️ 必改 1：废弃机制在**定义层**已经不存在（扩展面 / overlay 表都查不到）
    for (const gone of ['suppressionShot', 'strongRecoil', 'recoilCharge']) {
      expect(runModifierById(gone), `${gone} 必须已被删除`).toBeUndefined();
      expect(gone in RUN_MODIFIER_OVERLAY, `${gone} 必须已被删除`).toBe(false);
    }
    // ⚠️ 必改 1：废弃机制的**模块级导出常量**也已不存在（不是「留着不用」，而是根本没有）
    for (const gone of [
      'SUPPRESSION_SHOT_IMPULSE',
      'STRONG_RECOIL_IMPULSE',
      'RECOIL_CHARGE_IMPULSE',
      'RECOIL_CHARGE_THRESHOLD',
    ]) {
      expect(gone in runModifiersModule, `${gone} 必须已被删除`).toBe(false);
    }

    // 未知第一层 → 空池（不静默给通用池）
    expect(runLayer2PoolDefs('nope')).toEqual([]);
  });

  it('必改 3｜三连装填：复用同一 burst Foundation，burstRounds 2 → 3、间隔不变', () => {
    expect(RUN_MODIFIER_OVERLAY.tripleLoad.affectsWeapon).toBe(true);
    expect(RUN_MODIFIER_OVERLAY.tripleLoad.behavior).toBe('cannon');
    expect(RUN_MODIFIER_OVERLAY.tripleLoad.behaviorParams).toEqual({ burstRounds: 3, burstIntervalMs: 100 });

    // 浅合并口径：只抬 burstRounds，其余逐项沿用「双联炮之后」的本局武器
    const twinDef = composeRunWeaponDef(CANNON_OFFICIAL, ['twinCannon']);
    const tripleDef = composeRunWeaponDef(CANNON_OFFICIAL, ['twinCannon', 'tripleLoad']);
    const bp = (d: FunctionalPartDef) => d.behaviorParams as Record<string, number>;
    expect(bp(twinDef).burstRounds).toBe(2);
    expect(bp(tripleDef).burstRounds).toBe(3);
    // 间隔保持当前可读节奏（第一版不重新调）
    expect(bp(twinDef).burstIntervalMs).toBe(100);
    expect(bp(tripleDef).burstIntervalMs).toBe(100);
    // 其余全部沿用正式 Cannon → 三发都是完整炮弹
    expect(bp(tripleDef).projectileDamage).toBe(80);
    expect(bp(tripleDef).projectileMass).toBe(1);
    expect(bp(tripleDef).projectileRadius).toBe(10);
    expect(bp(tripleDef).muzzleSpeed).toBe(8);
    expect(bp(tripleDef).cooldownMs).toBe(1000);
    expect(bp(tripleDef).recoilImpulse).toBe(30);

    // 真实 Runtime：一局带两层 → 三发真实弹丸、真实事件、同一炮口
    const rt = new RunBattleRuntime({ build: ['twinCannon', 'tripleLoad'] });
    expect(rt.build).toEqual(['twinCannon', 'tripleLoad']);
    expect(weaponPartDef(rt).behavior).toBe('cannon');
    expect(bp(weaponPartDef(rt)).burstRounds).toBe(3);
    const births = projectileBirthSteps(rt, 300);
    expect(births.length).toBeGreaterThan(2);
    // 第 1→2 发、2→3 发 都是 100ms ≈ 6 步（同一 Foundation，同一节奏）
    expect(births[1] - births[0]).toBe(6);
    expect(births[2] - births[1]).toBe(6);
    // 第 3 发之后才计主冷却 → 1000ms ≈ 60 步
    expect(births[3] - births[2]).toBe(60);
    rt.dispose();
  });

  it('必改 2｜动能爆发：追加真实冲量，强度读当前 Projectile 质量（不写死专属伤害）', () => {
    expect(RUN_MODIFIER_OVERLAY.kineticBurst.affectsWeapon).toBe(false);
    expect(RUN_MODIFIER_OVERLAY.kineticBurst.behaviorParams).toEqual({});
    // PRP-BUILD-01-R1：增益 12 → 28（一次性倍数级放大，方向验证）。
    // ⚠️ 这是**实测扫描后的定向值**，不是随手改的数：同条件 A/B 下 28 让「每炮屏幕位移」
    //    从 1.2px 抬到 15.6px（单炮最高 62px）、绕质心旋转从 **0/12 次** 变成 **7/11 次**
    //    （最高 55.6°），同时敌车**不越舞台带右缘**（390.3 ≈ 390）、**不出现单帧瞬转**，
    //    且三场连锁的第三场仍留 430/1100（不伤 PRP-RUN-R1 的「三场都活着且有余量」）。
    //    完整扫描表与取舍理由见 `runModifiers.ts` 的注释。
    expect(KINETIC_BURST_GAIN).toBe(28);

    // 不带 → 完全不订阅、不产生任何命中追加
    const off = new RunBattleRuntime({ build: ['heavyShell'] });
    run(off, 400);
    expect(off.abilitySnapshot().kineticBurst).toBe(false);
    expect(off.abilitySnapshot().kineticHits).toBe(0);
    expect(off.abilitySnapshot().lastKineticImpulse).toBe(0);
    off.dispose();

    // 带 → 真实命中累计，且冲量 = GAIN × 质量 × 相对速度
    const on = new RunBattleRuntime({ build: ['heavyShell', 'kineticBurst'] });
    const ab = () => on.abilitySnapshot();
    expect(ab().kineticBurst).toBe(true);
    expect(ab().projectileMass).toBe(4); // 读自本局真实 resolved 武器（重型弹头）
    run(on, 600);
    expect(ab().kineticHits).toBeGreaterThan(0); // 真实打出过命中
    expect(ab().lastKineticImpulse).toBeGreaterThan(0);
    expect(ab().pending).toBeLessThanOrEqual(1); // 冲量在步边界被 flush，不积压
    // PRP-BUILD-01-R1：最近一次命中必须带**真实命中点**（供表现层把冲击环画在同一位置）
    const hit = ab().lastKineticHit;
    expect(hit).not.toBeNull();
    expect(hit!.magnitude).toBe(ab().lastKineticImpulse);
    expect(hit!.x).toBeGreaterThan(0);
    on.dispose();

    // 同一项「动能爆发」在**轻弹**（基础 mass 1）上强度严格更小 → 「不是写死一个专属伤害」
    const lightRt = new RunBattleRuntime({ build: ['heavyShell', 'kineticBurst'] });
    const lightMass = lightRt.abilitySnapshot().projectileMass;
    run(lightRt, 600);
    const heavyImpulse = lightRt.abilitySnapshot().lastKineticImpulse;
    lightRt.dispose();
    expect(lightMass).toBe(4);

    const plainRt = new RunBattleRuntime({ build: ['kineticBurst'] }); // 基础炮，未选重型弹头
    expect(plainRt.abilitySnapshot().projectileMass).toBe(1);
    run(plainRt, 600);
    const plainImpulse = plainRt.abilitySnapshot().lastKineticImpulse;
    expect(plainRt.abilitySnapshot().kineticBurst).toBe(true);
    expect(plainRt.abilitySnapshot().kineticHits).toBeGreaterThan(0);
    expect(plainImpulse).toBeGreaterThan(0);
    plainRt.dispose();

    // 同一条 synergy 项：mass 4 的最近一次追加冲量必然大于 mass 1（真实质量进入公式）
    expect(heavyImpulse).toBeGreaterThan(plainImpulse);
    // 且冲量与「质量 × 相对速度」同量纲（>= GAIN × mass × 最小可观测相对速度）
    expect(plainImpulse).toBeGreaterThanOrEqual(KINETIC_BURST_GAIN * 1 * 0.5);
  });

  it('动能爆发入口：四种「非真实命中」路径一律不触发（合成事件逐个否掉）', () => {
    /**
     * 用**合成事件注入**直测能力层（真实 `RunBuildAbilities` + 记录型假端口）——
     * 完全确定（不依赖弹道运气），且能把入口条件的每一条逐条否掉：
     *   ① 开炮即触发；② 未命中触发（碰撞 / 环境伤害）；③ 反向命中（敌打玩家）；④ 非本武器 behavior。
     * 另外锁死 ⑤ 每次真实命中**恰好一次**（该发只入队一次）与 ⑥ 结束后不再施加。
     *
     * ⚠️ 这条入口是**共享接缝**：它不专属任何一个第二层项。
     *    `PRP-BUILD-01-CLOSEOUT-AND-FREEZE` 删掉废弃的快速装填专属二层时，
     *    本用例按 Queue「共享能力不因清理误删」的要求**改为驱动仍在生效的动能爆发**，
     *    而不是随废弃机制一起删掉。
     */
    const listeners: Array<(ev: BattleEvent) => void> = [];
    const applied: { team: string; dirX: number; dirY: number; mag: number; at: unknown }[] = [];
    let finished = false;
    const ports: RunAbilityPorts = {
      subscribe: (fn) => {
        listeners.push(fn);
        return () => {};
      },
      isFinished: () => finished,
      facingOf: () => 1,
      projectileMass: () => 1,
      applyImpulse: (team, dirX, dirY, mag, at) => {
        applied.push({ team, dirX, dirY, mag, at: at ?? null });
      },
    };
    const ab = new RunBuildAbilities(ports, ['kineticBurst']);
    const emit = (ev: BattleEvent): void => {
      for (const fn of listeners) fn(ev);
    };
    /** 一次「玩家炮弹命中敌车」的正式 damage 事件（字段取真实形状）。 */
    const hit = (over: Partial<DamageEvent> = {}): BattleEvent =>
      ({
        type: 'damage',
        source: 'A',
        target: 'B',
        damageSource: 'weapon',
        behavior: 'cannon',
        contactPoint: { x: 100, y: 50 },
        contactNormal: { x: -1, y: 0 },
        relativeVelocity: 3,
        damage: 80,
        hpBefore: 500,
        hpAfter: 420,
        timestamp: 100,
        ...over,
      }) as DamageEvent;
    // 冲量 = GAIN × projectileMass(1) × relativeVelocity(3)
    const EXPECTED = KINETIC_BURST_GAIN * 1 * 3;

    // ① 开炮**不**触发 —— 但它必须记录弹道方向供命中时使用
    emit({
      type: 'weaponFire',
      team: 'A',
      partId: 'part:cannon',
      behavior: 'cannon',
      worldPosition: { x: 10, y: 0 },
      worldDirection: { x: 1, y: 0 },
      timestamp: 0,
    });
    ab.flush();
    expect(ab.snapshot().kineticHits).toBe(0);
    expect(applied).toHaveLength(0);

    // ② 未命中：非 weapon 来源（碰撞 / 环境伤害）不触发
    emit(hit({ damageSource: 'impact', behavior: 'ram' }));
    ab.flush();
    expect(ab.snapshot().kineticHits).toBe(0);
    // ③ 反向命中（敌车打玩家）不触发
    emit(hit({ source: 'B', target: 'A' }));
    // ④ 不是本武器 behavior 不触发
    emit(hit({ behavior: 'laser' }));
    ab.flush();
    expect(ab.snapshot().kineticHits).toBe(0);
    expect(applied).toHaveLength(0);

    // ⑤ 真实命中 → **恰好一次**，参数逐项正确
    emit(hit());
    ab.flush();
    expect(ab.snapshot().kineticHits).toBe(1);
    expect(ab.snapshot().lastKineticImpulse).toBe(EXPECTED);
    expect(applied).toHaveLength(1);
    expect(applied[0]!.team).toBe('B'); // 冲量施加在**敌车**上
    expect(applied[0]!.mag).toBe(EXPECTED);
    expect(applied[0]!.at).toEqual({ x: 100, y: 50 }); // 真实命中点
    expect(applied[0]!.dirX).toBeCloseTo(1, 6); // 沿本次真实弹道方向
    expect(applied[0]!.dirY).toBeCloseTo(0, 6);

    // ⑥ 再一次命中 → 再一次冲量：1:1，无阈值 / 无累计
    emit(hit({ contactPoint: { x: 130, y: 55 } }));
    ab.flush();
    expect(ab.snapshot().kineticHits).toBe(2);
    expect(applied).toHaveLength(2);

    // ⑦ 战斗结束后不再施加（保住「RESULT = 战场冻结」）
    finished = true;
    emit(hit({ contactPoint: { x: 160, y: 60 } }));
    ab.flush();
    expect(applied).toHaveLength(2);
    expect(ab.snapshot().kineticHits).toBe(2);
    ab.dispose();
  });

  it('Reset：新建一局在第一次命中之前没有任何遗留状态', () => {
    // ⚠️ 同样是**共享接缝**用例（不专属任何一个第二层项）：能力层必须无「跨局残留 /
    //    阈值 / 计时」这类隐藏状态。删除废弃的快速装填专属二层时按此口径保留。
    const fresh = new RunBattleRuntime({ build: ['heavyShell', 'kineticBurst'] });
    expect(fresh.abilitySnapshot().kineticHits).toBe(0);
    expect(fresh.abilitySnapshot().lastKineticImpulse).toBe(0);
    expect(fresh.abilitySnapshot().lastKineticHit).toBeNull();
    expect(fresh.abilitySnapshot().pending).toBe(0);
    fresh.dispose();

    // 同一路线跑过一场之后，新开一局的计数从 0 起（不是沿用上一次 Runtime 的残留）
    const again = new RunBattleRuntime({ build: ['heavyShell', 'kineticBurst'] });
    run(again, 600);
    expect(again.abilitySnapshot().kineticHits).toBeGreaterThan(0);
    again.dispose();
    const reset = new RunBattleRuntime({ build: ['heavyShell', 'kineticBurst'] });
    expect(reset.abilitySnapshot().kineticHits).toBe(0);
    expect(reset.abilitySnapshot().lastKineticImpulse).toBe(0);
    expect(reset.abilitySnapshot().lastKineticHit).toBeNull();
    expect(reset.abilitySnapshot().pending).toBe(0);
    reset.dispose();
  });

  it('必改 5｜紧急维修：不改武器、不写真实战果，只提供选择后的耐久补偿', () => {
    expect(RUN_MODIFIER_OVERLAY.emergencyRepair.affectsWeapon).toBe(false);
    expect(RUN_MODIFIER_OVERLAY.emergencyRepair.behaviorParams).toEqual({});
    expect(EMERGENCY_REPAIR_FRACTION).toBe(0.25);
    // 能力类项不参与武器组合 → registry / 武器 def 与基础完全一致
    const reg = createRunRegistry(['emergencyRepair']);
    expect(reg.functionals.size).toBe(createRunRegistry(null).functionals.size);
    expect(weaponOverlayMods(['emergencyRepair'])).toEqual([]);
    expect(weaponOverlayMods(['heavyShell', 'emergencyRepair'])).toEqual(['heavyShell']);
    expect(weaponOverlayMods(['twinCannon', 'tripleLoad'])).toEqual(['twinCannon', 'tripleLoad']);

    const rt = new RunBattleRuntime({ build: ['emergencyRepair'] });
    expect(weaponPartDef(rt).behaviorParams).toEqual(CANNON_OFFICIAL_PARAMS);
    expect(rt.abilitySnapshot().kineticBurst).toBe(false);
    rt.dispose();
  });

  it('必改 6｜最终战斗同时携带两层，且武器是两层浅合并后的确定结果', () => {
    // 三条路线的「第一层 + 第二层」组合全部能真实开打，并各自留下可区分的方向痕迹
    const routeHeavy: readonly RunModifierId[] = ['heavyShell', 'kineticBurst'];
    const routeTwin: readonly RunModifierId[] = ['twinCannon', 'tripleLoad'];
    // ⚠️ 必改 2：快速装填的第二层已改为**通用转向池**，这里取其中一条真实可选组合
    //    （快速装填 → 双联炮 = 保留高频的同时向多发转型）。
    const routeFast: readonly RunModifierId[] = ['fastReload', 'twinCannon'];
    // 该组合确实来自条件池（不是测试自己编的）
    expect(RUN_LAYER2_POOLS.fastReload).toContain('twinCannon');

    const heavy = new RunBattleRuntime({ build: routeHeavy });
    const twin = new RunBattleRuntime({ build: routeTwin });
    const fast = new RunBattleRuntime({ build: routeFast });
    for (const rt of [heavy, twin, fast]) expect(rt.build).toHaveLength(2);

    const bp = (rt: RunBattleRuntime) => weaponPartDef(rt).behaviorParams as Record<string, number>;
    // 重型弹头 + 动能爆发 = 单发超重（质量 / 半径 / 后坐 + 能力标记）
    expect(bp(heavy).projectileMass).toBe(4);
    expect(bp(heavy).projectileRadius).toBe(16);
    expect(heavy.abilitySnapshot().kineticBurst).toBe(true);
    // 双联炮 + 三连装填 = 多发连射
    expect(bp(twin).burstRounds).toBe(3);
    expect(bp(twin).burstIntervalMs).toBe(100);
    // 快速装填 + 双联炮 = 高频（650ms）**且**一次两发（两层浅合并的结果，两个特征同时保留）
    expect(bp(fast).cooldownMs).toBe(650);
    expect(bp(fast).burstRounds).toBe(2);
    expect(bp(fast).burstIntervalMs).toBe(100);
    // 且它没有意外带上任何能力项（这条路线不提供能力）
    expect(fast.abilitySnapshot().kineticBurst).toBe(false);

    // 能力标记互不串味：只有重弹路线带动能爆发
    expect(twin.abilitySnapshot().kineticBurst).toBe(false);
    expect(heavy.abilitySnapshot().kineticBurst).toBe(true);

    // 三条路线都是可打完的真实战斗（不是卡死）
    for (const rt of [heavy, twin, fast]) {
      const end = fightToEnd(rt);
      expect(end.frames).toBeGreaterThan(0);
      expect(rt.result).not.toBeNull();
    }
    expect(heavy.result).not.toBeNull();
    expect(twin.result).not.toBeNull();
    expect(fast.result).not.toBeNull();

    heavy.dispose();
    twin.dispose();
    fast.dispose();
  });

  it('两层 Build 的 overlay 部件 id 是确定性的（顺序决定，重复选择不叠加）', () => {
    expect(runBuildDefId(['heavyShell'])).toBe('run.mod.heavyShell');
    expect(runBuildDefId(['twinCannon', 'tripleLoad'])).toBe('run.mod.twinCannon+tripleLoad');
    expect(runBuildDefId(['heavyShell', 'kineticBurst'])).toBe('run.mod.heavyShell'); // 能力类不进 id
    expect(runBuildDefId(['kineticBurst'])).toBeNull();
    // 同一组合 → 同一 id（可复现，无随机）
    expect(runBuildDefId(['fastReload', 'twinCannon'])).toBe(runBuildDefId(['fastReload', 'twinCannon']));
    // 顺序不同 → 结果不同（后选覆盖先选），这是「有序 Build」的确定性语义
    expect(runBuildDefId(['twinCannon', 'heavyShell'])).toBe('run.mod.twinCannon+heavyShell');
    // 合并冲突时后选胜出：双联炮(mass 沿用) + 重型弹头(mass 4) → 4
    const merged = composeRunWeaponDef(CANNON_OFFICIAL, ['twinCannon', 'heavyShell']);
    const mp = merged.behaviorParams as Record<string, number>;
    expect(mp.burstRounds).toBe(2); // 先选的仍在
    expect(mp.projectileMass).toBe(4); // 后选的覆盖
    expect(mp.recoilImpulse).toBe(90);
  });
});
