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

/**
 * 战场里「玩家那门炮」的运行时 def（真实 resolved，不是 PRP 侧自算）。
 *
 * ⚠️ PRP-F2-R1：三种强化**都是**正式 `cannon`（双联炮不再借用 `shotgun`），
 * 因此只按 `behavior === 'cannon'` 查找 —— 若哪天又出现 shotgun，这条查找会漏掉，
 * 从而让「不该有 shotgun」这件事在测试里变响。
 */
function weaponPartDef(rt: RunBattleRuntime): FunctionalPartDef {
  const parts = rt.orchestrator.vehicleA.parts;
  const found = parts.find((p) => p.def.behavior === 'cannon');
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
    // 正式 6 个基准参数逐字段冻结（本 Queue 未动任何一项）
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
    // PRP-F2-R1：双联炮 = 正式 cannon + **真实连发**（不再借用 shotgun 的同步齐射）。
    expect(RUN_MODIFIER_OVERLAY.twinCannon.behavior).toBe('cannon');
    // 只声明「一次攻击几发 + 发间隔」；其余 6 个数值全部沿用正式 Cannon（每发都是完整炮弹）
    expect(RUN_MODIFIER_OVERLAY.twinCannon.behaviorParams).toEqual({
      burstRounds: 2,
      burstIntervalMs: 100,
    });
    // Queue 必改 4：不靠大散射把两发分开 → twinCannon 不得声明扇形参数
    expect(RUN_MODIFIER_OVERLAY.twinCannon.behaviorParams.fanAnglesDeg).toBeUndefined();
    expect(RUN_MODIFIER_OVERLAY.fastReload.behavior).toBe('cannon');
    expect(RUN_MODIFIER_OVERLAY.fastReload.behaviorParams).toEqual({ cooldownMs: 650 });
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

  it('不带强化重开 → 完全回到基础武器（强化不跨 Run 残留）', () => {
    const withMod = new RunBattleRuntime({ modifier: 'twinCannon' });
    expect(weaponPartDef(withMod).behavior).toBe('cannon');
    expect((weaponPartDef(withMod).behaviorParams as Record<string, unknown>).burstRounds).toBe(2);
    withMod.dispose();

    const reset = new RunBattleRuntime();
    expect(reset.modifier).toBeNull();
    expect(weaponPartDef(reset).behavior).toBe('cannon');
    expect((weaponPartDef(reset).behaviorParams as Record<string, number>).cooldownMs).toBe(1000);
    reset.dispose();
  });
});
