/**
 * Queue W1-P0-CLOSE-FIX｜Closing Stability Regression
 *
 * 正式 Runtime（Planck）回归，永久防止 Arena 参数再次把 Joint 打爆（W1-P0-CLOSE-R1：
 * closingSpeed=40 穿透车辆 → Prismatic translation 1026 崩溃）。现在默认 closingSpeed=3。
 *
 * 1. 完整默认流程（Active → Warning → Closing → End）：含 Push Rod 的真实 Build +
 *    默认 Arena（10s/3s/5s、closingSpeed=3），全程逐步验证：
 *    - Prismatic translation 不突破 limit（90）+ 合理 solver tolerance；
 *    - connector length 不异常爆长；
 *    - chassis / part 位置有限、无 NaN / Infinity；
 *    - Closing 墙最终位置收束到中央附近且不穿出 Arena（默认 3 下 End 前不交叉）；
 *    - 最终唯一 winner A/B。
 * 2. Closing hazard 收束：车辆贴墙重叠出生 + 默认 closingSpeed=3 → hazard tick 真实扣血、
 *    墙温和收束不崩（含 Push Rod 共存）。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import type { BuildSnapshot } from '../src/core/types';
import type { BattleRequest } from '../src/battle/battleContract';
import { createPlanckBattle } from '../src/battle/battleRequestAdapter';
import { isDamageEvent } from '../src/battle/combatEvents';
import { PHYSICS_HZ } from '../src/physics/units';

const registry = createRegistry();
const STEP = 1000 / PHYSICS_HZ;
const PUSH_ROD_LIMIT = 90; // Prismatic upper limit（pushRodBehavior.extendPx）
/**
 * 合理 solver tolerance（+20px，诊断依据）：closing 墙侧向压车时 pushRod 撞 limit 的
 * position solver 收敛余量实测 ≤ ~11px（A-only 无对手也发生，正常物理非崩溃）；
 * 崩溃对照（closingSpeed=40）translation 达 1026，量级差 100 倍——110 边界可稳定区分。
 */
const PUSH_ROD_TOLERANCE = 20;

function wheels() {
  return [
    { hardpointId: 'rear', defId: 'wheelStd' },
    { hardpointId: 'front', defId: 'wheelStd' },
  ];
}

/** A：含 Push Rod 的真实 Build（验收 2 核心） */
function pushRodBuild(id: string): BuildSnapshot {
  return {
    id,
    bodyDefId: 'boxBody',
    quality: 1,
    movements: wheels(),
    functionals: [{ hardpointId: 'front', defId: 'pushRod' }],
  };
}

/** B：正常可战斗 Build（重型 + Cannon） */
function combatBuild(id: string): BuildSnapshot {
  return {
    id,
    bodyDefId: 'heavyBox',
    quality: 1,
    movements: wheels(),
    functionals: [{ hardpointId: 'front', defId: 'cannon' }],
  };
}

describe('W1-P0-CLOSE-FIX · Closing Stability（默认 closingSpeed=3）', () => {
  it('1. 完整默认流程：Push Rod 不崩、connector 不爆长、位置有限、End 唯一 winner、墙收束不穿出', () => {
    const req: BattleRequest = {
      battleId: 'closing-stab',
      buildA: pushRodBuild('stabA'),
      buildB: combatBuild('stabB'),
      config: {
        autoDrive: false, // 站桩：无武器对射伤害，确保完整跑满 Active→Warning→Closing→End
        engine: 'planck',
        settleToGround: true,
        randomSeed: 5,
        // 不 override arena：默认 phases（10s/3s/5s）+ 默认 closingSpeed=3
      },
      randomSeed: 5,
      rulesVersion: 'v1.0.0',
      contentVersion: 'c1',
    };
    const o = createPlanckBattle(req, registry);
    const rodA = o.vehicleA.parts.find((p) => p.def.behavior === 'pushRod')!;
    expect(rodA).toBeDefined();
    const cfg = o.arena.config;
    const wall0Init = o.world.getPosition(o.arena.closingWalls[0]!.body).x; // -120
    const wall1Init = o.world.getPosition(o.arena.closingWalls[1]!.body).x; // 1720

    let maxTrans = 0;
    let maxConn = 0;
    let minCarX = Infinity;
    let maxCarX = -Infinity;
    const phasesSeen = new Set<string>();

    for (let i = 0; i < 1500 && !o.result; i++) {
      o.step(STEP);
      phasesSeen.add(o.arena.phase);
      const aPos = o.world.getPosition(o.vehicleA.body);
      const bPos = o.world.getPosition(o.vehicleB.body);
      const rodPos = o.world.getPosition(rodA.body);
      const trans = o.world.getPrismaticTranslation(rodA.joint);
      // connector from = chassis hardpoint 世界位置（facing 镜像 + 姿态旋转）
      const bAng = o.world.getAngle(o.vehicleA.body);
      const anchor = {
        x:
          aPos.x +
          Math.cos(bAng) * (o.vehicleA.facing * rodA.hardpoint.localPosition.x) -
          Math.sin(bAng) * rodA.hardpoint.localPosition.y,
        y:
          aPos.y +
          Math.sin(bAng) * (o.vehicleA.facing * rodA.hardpoint.localPosition.x) +
          Math.cos(bAng) * rodA.hardpoint.localPosition.y,
      };
      const conn = Math.hypot(rodPos.x - anchor.x, rodPos.y - anchor.y);

      // 逐步验证：无 NaN / Infinity；位置有限；trans 不破 limit（+solver tolerance）
      expect(Number.isFinite(trans)).toBe(true);
      expect(Number.isFinite(conn)).toBe(true);
      expect(Number.isFinite(aPos.x) && Number.isFinite(aPos.y)).toBe(true);
      expect(Number.isFinite(bPos.x) && Number.isFinite(bPos.y)).toBe(true);
      expect(Number.isFinite(rodPos.x) && Number.isFinite(rodPos.y)).toBe(true);
      expect(Math.abs(trans)).toBeLessThanOrEqual(PUSH_ROD_LIMIT + PUSH_ROD_TOLERANCE); // 90 + 5 solver tolerance
      expect(conn).toBeLessThanOrEqual(PUSH_ROD_LIMIT + 120); // 异常爆长防护（正常 extend 90 + 挂点偏移）

      maxTrans = Math.max(maxTrans, Math.abs(trans));
      maxConn = Math.max(maxConn, conn);
      minCarX = Math.min(minCarX, aPos.x, bPos.x);
      maxCarX = Math.max(maxCarX, aPos.x, bPos.x);
    }

    // 完整跑过全部阶段
    expect(phasesSeen.has('Active')).toBe(true);
    expect(phasesSeen.has('Warning')).toBe(true);
    expect(phasesSeen.has('Closing')).toBe(true);
    // 战斗结束 + 唯一 winner（默认 arenaEnd；站桩无伤害 → 同 HP → seed tie-break 唯一赢家）
    expect(o.result).not.toBeNull();
    expect(['A', 'B']).toContain(o.result!.winner);
    // 车辆全程保持真实稳定（有限且未非物理越界）
    expect(Number.isFinite(minCarX) && Number.isFinite(maxCarX)).toBe(true);
    expect(minCarX).toBeGreaterThan(-500);
    expect(maxCarX).toBeLessThan(2100);

    // Closing 墙最终位置：默认 3 下 300 步收束 ~900px → 中央附近（780/820），不穿出 Arena
    const wall0Final = o.world.getPosition(o.arena.closingWalls[0]!.body).x;
    const wall1Final = o.world.getPosition(o.arena.closingWalls[1]!.body).x;
    expect(wall0Final).toBeGreaterThan(wall0Init); // 左墙右移
    expect(wall1Final).toBeLessThan(wall1Init); // 右墙左移
    expect(wall0Final).toBeLessThan(cfg.width); // 不穿出右界
    expect(wall1Final).toBeGreaterThan(0); // 不穿出左界
    // 两墙收束到中央附近（±120px），未交叉穿出
    expect(wall0Final).toBeLessThan(cfg.width / 2 + 120);
    expect(wall1Final).toBeGreaterThan(cfg.width / 2 - 120);

    console.log(
      `[CLOSE-STAB] maxTrans=${maxTrans.toFixed(1)} maxConn=${maxConn.toFixed(1)} ` +
        `wall0=${wall0Final.toFixed(1)} wall1=${wall1Final.toFixed(1)} carX=[${minCarX.toFixed(1)},${maxCarX.toFixed(1)}] ` +
        `winner=${o.result!.winner} endReason=${o.result!.endReason}`,
    );
  });

  it('2. Closing hazard 收束：贴墙重叠出生 + 默认 speed=3 → hazard 真实扣血、Push Rod 不崩、唯一 winner', () => {
    const o = createPlanckBattle(
      {
        battleId: 'closing-hazard',
        buildA: pushRodBuild('hazA'),
        buildB: combatBuild('hazB'),
        config: {
          autoDrive: false,
          engine: 'planck',
          settleToGround: true,
          randomSeed: 9,
          impact: { threshold: 999 }, // 隔离 Impact（只测 hazard）
          // 车辆贴各自刺墙重叠出生（对称）：Closing 起始后真实 begin 接触 → hazard tick
          spawnA: { x: -20, y: 640, facing: 1 },
          spawnB: { x: 1620, y: 640, facing: -1 },
          // 不 override closingSpeed → 默认 3
          arena: {
            phases: {
              activeMs: STEP * 20,
              warningMs: STEP * 10,
              closingMs: STEP * 300,
            },
          },
        },
        randomSeed: 9,
        rulesVersion: 'v1.0.0',
        contentVersion: 'c1',
      },
      registry,
    );
    // 直接从 Closing 开始（绕过 Active/Warning 物理不确定性；hazard 门控已由 W1-END-2 覆盖）
    o.arena.setPhase('Closing');
    const rodA = o.vehicleA.parts.find((p) => p.def.behavior === 'pushRod')!;

    const hazardEvents: string[] = [];
    o.onCombatEvent((e) => {
      if (isDamageEvent(e) && e.damageSource === 'hazard') hazardEvents.push(e.target);
    });
    const hpA0 = o.vehicleA.hp;
    const hpB0 = o.vehicleB.hp;

    let maxTrans = 0;
    for (let i = 0; i < 400 && !o.result; i++) {
      o.step(STEP);
      const trans = o.world.getPrismaticTranslation(rodA.joint);
      expect(Math.abs(trans)).toBeLessThanOrEqual(PUSH_ROD_LIMIT + PUSH_ROD_TOLERANCE);
      maxTrans = Math.max(maxTrans, Math.abs(trans));
    }
    expect(o.result).not.toBeNull();
    // hazard tick 真实扣血（至少一方被刺墙压到）
    expect(hazardEvents.length).toBeGreaterThan(0);
    expect(o.vehicleA.hp < hpA0 || o.vehicleB.hp < hpB0).toBe(true);
    // 唯一 winner
    expect(['A', 'B']).toContain(o.result!.winner);
    // Push Rod 全程不崩
    expect(maxTrans).toBeLessThanOrEqual(PUSH_ROD_LIMIT + PUSH_ROD_TOLERANCE);
    console.log(
      `[CLOSE-STAB-HAZARD] hazardEvents=${hazardEvents.length} maxTrans=${maxTrans.toFixed(1)} ` +
        `winner=${o.result!.winner} hpA=${Math.round(o.vehicleA.hp)} hpB=${Math.round(o.vehicleB.hp)}`,
    );
  });
});
