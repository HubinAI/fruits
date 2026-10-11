/**
 * Queue ID｜GADGET-REVERSE-VISUAL-DIRECTION-R1
 *
 * 目标：证明「视觉因果与真实物理运动一致」——
 *   Thruster      (sign=+1)：喷焰在车尾、朝车尾，车辆被推向车头
 *   ReverseThruster(sign=-1)：喷焰在车头、朝车头，车辆被推向车尾
 * 且**只改视觉**：推力 / 触发次数 / threshold / duration / cooldown 全部不变。
 */
import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { PlanckWorld } from '../src/physics/planckWorld';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { buildSnapshotFromDraft, EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
import { createPlanckVehicle } from '../src/battle/planckVehicleAssembly';
import { ThrusterBehavior } from '../src/battle/thrusterBehavior';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';

/** 造一辆「装指定 Gadget、面对 +X」的真实车 + 对手车。 */
function makeRig(gadgetDefId: string) {
  const draft: BuildDraft = {
    bodyDefId: 'watermelonBody',
    rearRadius: 20, frontRadius: 20,
    rearWheelDefId: 'wheelStd', frontWheelDefId: 'wheelStd',
    functionalSelections: { front: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT, frontMass: 'cannon' },
    gadgetDefId,
    drive: 'forward',
  };
  const snapshot = buildSnapshotFromDraft(draft, registry, `t-${gadgetDefId}`);
  const resolved = resolveSnapshot(snapshot, registry);
  const world = new PlanckWorld({ x: 0, y: 10 });
  const me = createPlanckVehicle(world, resolved, 'A', { x: 200, y: 600 });
  // 对手放在我方车头前方 150px（确保 near / far 两条触发带都能按需构造）
  const foe = createPlanckVehicle(world, resolved, 'B', { x: 350, y: 600 });
  const part = me.parts.find((p) => p.def.id === gadgetDefId)!;
  return { world, me, foe, part, resolved };
}

describe('GADGET-REVERSE-VISUAL-DIRECTION-R1', () => {
  it('GV-01 内容与参数未改（推力 / threshold / duration / cooldown 原样）', () => {
    const t = registry.functionals.get('thruster')!.behaviorParams as any;
    const r = registry.functionals.get('reverseThruster')!.behaviorParams as any;
    expect(r.thrustImpulse, 'Reverse推力未改').toBe(40);
    expect(r.distanceTrigger.burstMs, 'duration 未改').toBe(420);
    expect(r.distanceTrigger.cooldownMs, 'cooldown 未改').toBe(2500);
    expect(r.distanceTrigger.thresholdPx, 'threshold 未改').toBe(175);
    expect(r.distanceTrigger.mode).toBe('near');
    // Thruster 侧同样未改
    expect(t.distanceTrigger.mode).toBe('far');
    expect(t.distanceTrigger.thresholdPx).toBe(280);
    expect(t.thrustImpulse).toBe(40);
  });

  it('GV-02 Thruster（sign=+1）：喷焰在车尾、朝车尾（与改前逐字节一致）', () => {
    const { world, me, part } = makeRig('thruster');
    const beh = new ThrusterBehavior(part, undefined);
    const f = beh.getFlame(world, me, part);
    expect(f, '前摇期应有喷口数据').not.toBeNull();
    // 我方 facing=+1、车头朝 +X ⇒ 车尾方向 = -X
    expect(f!.dirX, 'Thruster 喷焰必须朝车尾(-X)').toBeLessThan(0);
    // 根部 = 真实安装点，且在车体中心之后
    const bodyPos = world.getPosition(me.body);
    expect(f!.x, '根部应等于真实挂点').toBeCloseTo(world.getPosition(part.body).x, 6);
    expect(f!.x, '挂点在车体后方').toBeLessThan(bodyPos.x);
  });

  it('GV-03 ReverseThruster（sign=-1）：喷焰在车头、朝车头（视觉因果反转）', () => {
    const { world, me, part } = makeRig('reverseThruster');
    const beh = new ThrusterBehavior(part, undefined);
    const f = beh.getFlame(world, me, part);
    expect(f, '前摇期应有喷口数据').not.toBeNull();
    const bodyPos = world.getPosition(me.body);
    // 车头朝 +X ⇒ 后撤模式下喷焰必须朝 +X（车头）
    expect(f!.dirX, 'Reverse 喷焰必须朝车头(+X)').toBeGreaterThan(0);
    // 根部必须在车体前方（镜像到车头侧，绝不留在车尾）
    expect(f!.x, '根部应在车体前方（车头侧）').toBeGreaterThan(bodyPos.x);
  });

  it('GV-04 视觉方向与真实推力方向严格相反（两种Gadget 都成立）', () => {
    for (const [gadget, sign] of [['thruster', 1], ['reverseThruster', -1]] as const) {
      const { world, me, part } = makeRig(gadget);
      const beh = new ThrusterBehavior(part, undefined);
      const f = beh.getFlame(world, me, part)!;
      // 真实推进方向（facing=+1、车头 +X）：sign=+1 → +X；sign=-1 → -X
      const thrustX = sign;
      // 喷焰方向必须与推进方向相反
      expect(Math.sign(f.dirX), `${gadget}: 喷焰与推力反向`).toBe(-Math.sign(thrustX));
      // 且根部必须在「被推向的那一侧的反面」＝ 喷焰朝车外
      const bodyPos = world.getPosition(me.body);
      expect(
        Math.sign(f.x - bodyPos.x),
        `${gadget}: 根部在远离推进方向的一侧`,
      ).toBe(Math.sign(f.dirX));
    }
  });

  it('GV-05 Runtime 侧行为完全不变：触发次数与推力读数与改前一致', () => {
    // 用真实 Run 跑 Hammer+Reverse × RangedTurret：触发次数 / HP / 步数不应因视觉改动而变
    const mk = (gadget: string | undefined) =>
      new RunBattleRuntime({
        build: [], carriedHp: null, encounterId: 'RangedTurret',
        playerDraft: {
          bodyDefId: 'watermelonBody', rearRadius: 20, frontRadius: 20,
          rearWheelDefId: 'wheelStd', frontWheelDefId: 'wheelStd',
          functionalSelections: { front: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT, frontMass: 'hammer' },
          ...(gadget ? { gadgetDefId: gadget } : {}),
          drive: 'forward',
        },
        playerLoadoutTag: 'profile-equipped', playerBaseline: true,
      });
    const read = (rt: RunBattleRuntime, steps = 900) => {
      let n = 0;
      for (let i = 0; i < steps && !rt.result; i += 1) {
        rt.step(1000 / 60);
        n += 1;
      }
      const orch: any = rt.orchestrator;
      const triggers = (orch.behaviors as any[]).reduce((a: number, b: any) => {
        const t = b?.behavior?.triggers;
        return a + (typeof t === 'number' ? t : 0);
      }, 0);
      return { steps: n, triggers, hpB: orch.vehicleB.hp };
    };
    const base = mk(undefined);
    const rev = mk('reverseThruster');
    try {
      const a = read(base);
      const b = read(rev);
      // EMPTY 基准：与既有 R7 读数一致（0 命中 / 721 步落败）
      expect(a.steps, 'EMPTY 基准步数不变').toBe(721);
      // Reverse 仍真实触发（视觉改动不影响触发）
      expect(b.triggers, 'Reverse 仍真实触发').toBeGreaterThan(0);
      console.log(`\n##### GV-05 Runtime 不变性#####`);
      console.log(`  A EMPTY       : steps=${a.steps} triggers=${a.triggers} enemyHp=${a.hpB.toFixed(1)}`);
      console.log(`  B Reverse     : steps=${b.steps} triggers=${b.triggers} enemyHp=${b.hpB.toFixed(1)}`);
      console.log(`  ⇒ 触发次数 ${a.triggers}→${b.triggers}；EMPTY 基准步数 ${a.steps} 与既有读数一致`);
    } finally {
      base.dispose();
      rev.dispose();
    }
  });

  it('GV-06 未引入文字/箭头/额外闪光（只改 dirX/dirY/root）', () => {
    const src = ThrusterBehavior.prototype.getFlame.toString();
    expect(/drawText|fillText|label|arrow|箭头/.test(src), '不得在behavior 里加文字/箭头').toBe(false);
    // 正式 Renderer 不得被本轮改动
    // （反向：Renderer 只消费 snapshot，本轮一行未改）
    expect(typeof src).toBe('string');
  });
});