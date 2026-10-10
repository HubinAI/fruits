/**
 * Queue ID｜GADGET-THRUSTER-PROTOTYPE-R1
 *
 * 第一个 Gadget 原型：**distance-triggered Thruster**。
 *
 * 规则：敌人在自车前向半球内 且 双方真实碰撞 AABB 间距 > farThreshold 且 冷却结束
 *      ⇒ 触发一次短时真实前冲（不瞬移 / 不吸附 / 不锁敌 / 不改对方速度）。
 *
 * 覆盖 Queue 验收 1–6。
 */
import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { WEAPON_SLOT, defaultPlayerDraft } from '../src/product/playerLoadout';

const FRAME_MS = 1000 / 60;

function draftOf(weapon: string, gadget: string | undefined): BuildDraft {
  const base = defaultPlayerDraft();
  const d: BuildDraft = {
    ...base,
    functionalSelections: {
      front: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT,
      [WEAPON_SLOT]: weapon,
    },
  };
  if (gadget !== undefined) d.gadgetDefId = gadget;
  return d;
}

interface Outcome {
  steps: number;
  hpB: number;
  hits: number;
  totalDamage: number;
  peakVx: number;
  triggers: number;
}

function run(weapon: string, gadget: string | undefined): Outcome {
  const rt = new RunBattleRuntime({
    build: [], carriedHp: null, encounterId: 'RangedTurret',
    playerDraft: draftOf(weapon, gadget),
    playerLoadoutTag: 'profile-equipped', playerBaseline: true,
  });
  const orch: any = rt.orchestrator;
  const vA: any = orch.vehicleA;
  let step = 0;
  let peakVx = 0;
  try {
    while (rt.result === null && step < 1400) {
      step += 1;
      const v = orch.world.getLinearVelocity(vA.body);
      if (Math.abs(v.x) > peakVx) peakVx = Math.abs(v.x);
      rt.step(FRAME_MS);
    }
    const sum = rt.playerWeaponHitSummary() as unknown as Record<
      string,
      { count: number; damages: readonly number[] }
    >;
    const hits = Object.keys(sum).reduce((a, k) => a + sum[k]!.count, 0);
    const dmg: number[] = [];
    for (const k of Object.keys(sum)) dmg.push(...sum[k]!.damages);
    const triggers = ((orch as any).behaviors as any[]).reduce((a: number, b: any) => {
      const t = b?.behavior?.triggers;
      return a + (typeof t === 'number' ? t : 0);
    }, 0);
    return {
      steps: step, hpB: vA ? orch.vehicleB.hp : NaN,
      hits, totalDamage: dmg.reduce((a, b) => a + b, 0), peakVx, triggers,
    };
  } finally {
    rt.dispose();
  }
}

describe('GADGET-THRUSTER-PROTOTYPE-R1', () => {
  it('GT-01 thruster 是 gadget 类，distanceTrigger 参数已配置', () => {
    const t = registry.functionals.get('thruster')!;
    expect(t.category).toBe('gadget');
    expect(t.energy).toBe(20);
    const bp = t.behaviorParams as {
      distanceTrigger?: { enabled?: boolean; mode?: string; thresholdPx?: number };
    };
    expect(bp.distanceTrigger?.enabled, 'distanceTrigger.enabled').toBe(true);
    expect(bp.distanceTrigger?.mode, 'Thruster 是 far 模式（前冲）').toBe('far');
    expect(bp.distanceTrigger?.thresholdPx).toBe(280);
  });

  it('GT-02 EMPTY Gadget 基准：Hammer × RangedTurret 仍为既有结果（0 contact / 0 伤害）', () => {
    const a = run('hammer', undefined);
    expect(a.hits, 'EMPTY Gadget 下命中仍为 0').toBe(0);
    expect(a.totalDamage, 'EMPTY Gadget 下伤害仍为 0').toBe(0);
    expect(a.triggers, 'EMPTY Gadget 无触发').toBe(0);
    expect(a.steps, '步数与既有基准一致').toBe(721);
  }, 400000);

  it('GT-03 装 Thruster 后：真实前冲可见（峰值 vx 明显高于 cruise 1.5）', () => {
    const b = run('hammer', 'thruster');
    expect(b.triggers, '必须真实触发过前冲').toBeGreaterThan(0);
    expect(b.peakVx, '峰值 vx 必须明显高于 1.5 cruise（真实前冲，非只改数字）').toBeGreaterThan(3);
  }, 400000);

  it('GT-04 装 Thruster 后：Hammer 真实 collider contact 从 0 变为 >0', () => {
    const a = run('hammer', undefined);
    const b = run('hammer', 'thruster');
    expect(a.hits, '基准 0').toBe(0);
    expect(b.hits, '装 Thruster 后 contact/hit 必须 >0').toBeGreaterThan(0);
    expect(b.totalDamage, '走既有 contactOnce 链（baseDamage 90）').toBeGreaterThan(0);
  }, 400000);

  it('GT-05 Thruster 不识别武器类型：Cannon 装配同样触发', () => {
    const c = run('cannon', 'thruster');
    expect(c.triggers, '同一个 Gadget 逻辑对其它武器同样有效').toBeGreaterThan(0);
  }, 300000);

  it('GT-06 Hammer 参数未被修改（swing / reach / baseDamage / contactOnce 不变）', () => {
    const h = registry.functionals.get('hammer')!;
    expect(h.category).toBe('weapon');
    expect((h.behaviorParams as { baseDamage?: number }).baseDamage, 'baseDamage 仍 90').toBe(90);
    expect(h.behavior, 'behavior 仍 hammer').toBe('hammer');
    // reach / swing 由 collider + behaviorParams 决定，未在本 Queue 触碰
    expect(h.collider).toEqual({ shape: 'box', width: 60, height: 14, offset: { x: 40, y: 0 } });
  });
});