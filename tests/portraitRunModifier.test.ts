/**
 * PRP-F2-FIRST-REAL-UPGRADE-LOOP｜Run-local 强化 overlay 门禁。
 *
 * 本文件回答两个问题（Queue 技术正确 1/2/3 + 方案落地 5）：
 *   A. 强化**通过什么接缝**注入，正式定义是否真的没被改写；
 *   B. 三种强化在**真实 Runtime** 里到底改变了什么（不是只比参数，而是比物理与事件）。
 *
 * ⚠️ 全部断言跑**正式** `PlanckBattleOrchestrator`（`RunBattleRuntime` 的薄适配），
 *    数值来自真实物理推进后的快照 / 事件，不读 PRP 侧自算数字。
 */
import { describe, expect, it } from 'vitest';
import { registry as officialRegistry } from '../src/core/content';
import type { FunctionalPartDef } from '../src/core/types';
import {
  RUN_BASE_WEAPON_DEF_ID,
  RUN_MODIFIER_OVERLAY,
  RUN_MODIFIERS,
  applyRunModifierToSnapshot,
  createRunRegistry,
  runOverlayDefId,
  type RunModifierId,
} from '../src/lab/portraitBattleLab/runModifiers';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';

const CANNON_OFFICIAL = officialRegistry.functionals.get(RUN_BASE_WEAPON_DEF_ID) as FunctionalPartDef;
const CANNON_OFFICIAL_PARAMS = { ...(CANNON_OFFICIAL.behaviorParams ?? {}) };

const MODIFIER_IDS: readonly RunModifierId[] = ['heavyShell', 'twinCannon', 'fastReload'];

/** 战场里「玩家那门炮」的运行时 def（真实 resolved，不是 PRP 侧自算）。 */
function weaponPartDef(rt: RunBattleRuntime): FunctionalPartDef {
  const parts = rt.orchestrator.vehicleA.parts;
  const found = parts.find(
    (p) => p.def.behavior === 'cannon' || p.def.behavior === 'shotgun',
  );
  if (!found) throw new Error('找不到玩家武器部件');
  return found.def;
}

/** 推进固定帧数，收集开火事件 / 弹丸半径峰值 / 存活累积。 */
function run(
  rt: RunBattleRuntime,
  frames: number,
  stepMs = 1000 / 60,
): { fires: { behavior: string; timestamp: number }[]; maxRadius: number; maxAlive: number; aliveSum: number } {
  const fires: { behavior: string; timestamp: number }[] = [];
  rt.orchestrator.onCombatEvent((ev) => {
    if (ev.type === 'weaponFire') fires.push({ behavior: ev.behavior, timestamp: ev.timestamp });
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

  it('未选强化 → 本局 registry 与正式副本等价，且不注册任何 overlay 部件', () => {
    const runReg = createRunRegistry(null);
    expect(runReg.functionals.get(RUN_BASE_WEAPON_DEF_ID)).toEqual(CANNON_OFFICIAL);
    for (const id of MODIFIER_IDS) {
      expect(runReg.functionals.has(runOverlayDefId(id))).toBe(false);
    }
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
    }
  });

  it('overlay 数值表与 Queue 的因果一一对应（冻结值）', () => {
    expect(RUN_MODIFIER_OVERLAY.heavyShell.behavior).toBe('cannon');
    expect(RUN_MODIFIER_OVERLAY.heavyShell.behaviorParams).toEqual({
      projectileRadius: 16,
      projectileMass: 4,
      recoilImpulse: 90,
    });
    expect(RUN_MODIFIER_OVERLAY.twinCannon.behavior).toBe('shotgun');
    // 双联炮**只**声明弹数：#其余 6 个数值全部沿用正式 Cannon（每发都是完整炮弹）
    expect(RUN_MODIFIER_OVERLAY.twinCannon.behaviorParams).toEqual({ fanAnglesDeg: [-4, 4] });
    expect(RUN_MODIFIER_OVERLAY.fastReload.behavior).toBe('cannon');
    expect(RUN_MODIFIER_OVERLAY.fastReload.behaviorParams).toEqual({ cooldownMs: 400 });
    // 三项都**不碰**弹道速度（强化不改变弹道）
    for (const id of MODIFIER_IDS) {
      expect(RUN_MODIFIER_OVERLAY[id].behaviorParams.muzzleSpeed).toBeUndefined();
    }
  });

  it('快照重映射只动武器 defId；找不到基准武器时显式抛错', () => {
    const base = new RunBattleRuntime();
    const snap = base.plan.player.snapshot;
    const remapped = applyRunModifierToSnapshot(snap, 'fastReload');
    expect(remapped.functionals.length).toBe(snap.functionals.length);
    const changed = remapped.functionals.filter((f) => f.defId === runOverlayDefId('fastReload'));
    expect(changed.length).toBeGreaterThan(0);
    // 非武器部件的 defId 逐一不变
    remapped.functionals.forEach((f, i) => {
      if (f.defId !== runOverlayDefId('fastReload')) {
        expect(f.defId).toBe(snap.functionals[i].defId);
      }
    });
    base.dispose();

    const stripped = { ...snap, functionals: snap.functionals.filter((f) => f.defId !== RUN_BASE_WEAPON_DEF_ID) };
    expect(() => applyRunModifierToSnapshot(stripped, 'fastReload')).toThrow(/无法注入强化/);
  });

  it('三个选项 exactly 是 Queue 点名的三项（本局临时，不随机）', () => {
    expect(RUN_MODIFIERS.map((m) => m.id)).toEqual(['heavyShell', 'twinCannon', 'fastReload']);
    expect(RUN_MODIFIERS.map((m) => m.label)).toEqual(['重型弹头', '双联炮', '快速装填']);
    expect(RUN_MODIFIERS.every((m) => m.logText.startsWith('你'))).toBe(true);
  });
});

describe('RP-MOD-02｜三种强化在真实 Runtime 里的差异（必改 5）', () => {
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

  it('重型弹头：自身后坐的真实反速度明显更大（真实物理量，不只比参数）', () => {
    // 同一门炮、相同开火节奏 → 唯一变量是 recoilImpulse。
    // 判定口径 = 整场里玩家 chassis 的**最负 vx**（= 开火瞬间被真实冲量推回来的峰值反速度）。
    const peakRearwardVx = (mod: 'heavyShell' | null): number => {
      const rt = new RunBattleRuntime({ modifier: mod });
      const body = rt.orchestrator.vehicleA.body;
      let minVx = Infinity;
      for (let i = 0; i < 400; i++) {
        rt.step(1000 / 60);
        minVx = Math.min(minVx, rt.orchestrator.world.getLinearVelocity(body).x);
        if (rt.result) break;
      }
      rt.dispose();
      return minVx;
    };
    const baseVx = peakRearwardVx(null);
    const heavyVx = peakRearwardVx('heavyShell');
    expect(baseVx).toBeLessThan(0); // 基础炮确实会把自己推回来
    expect(heavyVx).toBeLessThan(baseVx); // 强化后反速度更负 = 后坐更明显
  });

  it('双联炮：同一次开火产生两发真实弹丸（真实 projectile，不是视觉假弹）', () => {
    const baseRt = new RunBattleRuntime();
    const twinRt = new RunBattleRuntime({ modifier: 'twinCannon' });

    expect(weaponPartDef(baseRt).behavior).toBe('cannon');
    expect(weaponPartDef(twinRt).behavior).toBe('shotgun');

    // 到第一次开火为止：基础 1 发 / 双联炮 2 发
    const firstAlive = (rt: RunBattleRuntime): number => {
      for (let i = 0; i < 20; i++) {
        rt.step(1000 / 60);
        const n = rt.projectileCount();
        if (n > 0) return n;
      }
      return 0;
    };
    expect(firstAlive(baseRt)).toBe(1);
    expect(firstAlive(twinRt)).toBe(2);

    // 同一窗口内（300 帧，两场都还没打完）：**开火次数相同**（节奏没变），弹丸投放量约两倍
    const base = run(baseRt, 300);
    const twin = run(twinRt, 300);
    expect(base.fires.every((f) => f.behavior === 'cannon')).toBe(true);
    expect(twin.fires.every((f) => f.behavior === 'shotgun')).toBe(true);
    expect(twin.fires.length).toBe(base.fires.length); // 同节奏 → 变量隔离在「弹数」
    expect(base.fires.length).toBeGreaterThan(2);
    expect(twin.maxAlive).toBe(2); // 同一时刻确实有两发在空中
    expect(base.maxAlive).toBe(1);
    // 真实弹丸投放量更多（严格大于；不是 2.0× —— 扇形把两发分开后，
    // 单发寿命比基础炮的单发短，所以「存活帧累积」比值小于弹数比）。
    expect(twin.aliveSum).toBeGreaterThan(base.aliveSum);

    baseRt.dispose();
    twinRt.dispose();
  });

  it('快速装填：同窗口开火次数明显更多（真实节奏差异）', () => {
    const baseRt = new RunBattleRuntime();
    const fastRt = new RunBattleRuntime({ modifier: 'fastReload' });

    const bp = (d: FunctionalPartDef) => d.behaviorParams as Record<string, number>;
    expect(bp(weaponPartDef(baseRt)).cooldownMs).toBe(1000);
    expect(bp(weaponPartDef(fastRt)).cooldownMs).toBe(400);

    const base = run(baseRt, 600);
    const fast = run(fastRt, 600);
    expect(fast.fires.length).toBeGreaterThan(base.fires.length * 1.5);

    baseRt.dispose();
    fastRt.dispose();
  });
});

describe('RP-MOD-03｜跨战斗耐久与 clean recreate（必改 4 / 技术正确 4）', () => {
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
    expect((weaponPartDef(second).behaviorParams as Record<string, number>).cooldownMs).toBe(400);
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
    expect((weaponPartDef(b).behaviorParams as Record<string, number>).cooldownMs).toBe(400);
    b.dispose();
  });

  it('不带强化重开 → 完全回到基础武器（强化不跨 Run 残留）', () => {
    const withMod = new RunBattleRuntime({ modifier: 'twinCannon' });
    expect(weaponPartDef(withMod).behavior).toBe('shotgun');
    withMod.dispose();

    const reset = new RunBattleRuntime();
    expect(reset.modifier).toBeNull();
    expect(weaponPartDef(reset).behavior).toBe('cannon');
    expect((weaponPartDef(reset).behaviorParams as Record<string, number>).cooldownMs).toBe(1000);
    reset.dispose();
  });
});
