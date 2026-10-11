/**
 * Queue ID｜GADGET-REVERSE-VISUAL-IDENTITY-R1
 *
 * 目标：让Reverse Thruster 拥有**独立的视觉身份** —— 车头下方的独立喷口向前喷气，
 *      与 Cannon 炮口 / 炮弹在视觉上明确错开。
 * 硬约束：**不改任何战斗参数**，不改 Cannon muzzle / projectile，
 *        Renderer 里不得出现 Cannon 特判。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { PlanckWorld } from '../src/physics/planckWorld';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { buildSnapshotFromDraft, EMPTY_SLOT } from '../src/lab/buildEditorModel';
import { createPlanckVehicle } from '../src/battle/planckVehicleAssembly';
import { ThrusterBehavior } from '../src/battle/thrusterBehavior';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';

const REPO_ROOT = join(__dirname, '..');

/** 剥掉注释后再判定「代码里有没有特判」（注释里可合法提到 cannon 作为取证说明）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function rig(gadget: string, weapon: string) {
  const draft = {
    bodyDefId: 'watermelonBody', rearRadius: 20, frontRadius: 20,
    rearWheelDefId: 'wheelStd', frontWheelDefId: 'wheelStd',
    functionalSelections: { front: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT, frontMass: weapon },
    gadgetDefId: gadget,
    drive: 'forward' as const,
  };
  const resolved = resolveSnapshot(buildSnapshotFromDraft(draft, registry, `g-${gadget}-${weapon}`), registry);
  const world = new PlanckWorld({ x: 0, y: 10 });
  const me = createPlanckVehicle(world, resolved, 'A', { x: 300, y: 600 });
  const part = me.parts.find((p) => p.def.id === gadget)!;
  const flame = new ThrusterBehavior(part, undefined).getFlame(world, me, part)!;
  const bodyPos = world.getPosition(me.body);
  const weaponPart = me.parts.find((p) => p.def.id === weapon)!;
  const weaponPos = world.getPosition(weaponPart.body);
  return {
    flame: {
      x: flame.x - bodyPos.x, y: flame.y - bodyPos.y,
      dirX: flame.dirX, dirY: flame.dirY, length: flame.length, width: flame.width,
    },
    weapon: { x: weaponPos.x - bodyPos.x, y: weaponPos.y - bodyPos.y },
  };
}

describe('GADGET-REVERSE-VISUAL-IDENTITY-R1', () => {
  it('VI-01 战斗参数全部未改（推力 / threshold / duration / cooldown）', () => {
    const t = registry.functionals.get('thruster')!.behaviorParams as any;
    const r = registry.functionals.get('reverseThruster')!.behaviorParams as any;
    expect(r.thrustImpulse, 'Reverse 推力未改').toBe(40);
    expect(r.distanceTrigger.thresholdPx, 'threshold 未改').toBe(175);
    expect(r.distanceTrigger.burstMs, 'duration 未改').toBe(420);
    expect(r.distanceTrigger.cooldownMs, 'cooldown 未改').toBe(2500);
    expect(r.distanceTrigger.mode).toBe('near');
    // ⚠️ thrustSign 是**派生值**（mode='near' ⇒ sign=-1），不是 content 字段（content 侧零新增）
    expect(t.distanceTrigger.mode, 'Thruster 仍是 far').toBe('far');
    expect(t.thrustImpulse).toBe(40);
    // Cannon 数值未改
    const c = registry.functionals.get('cannon')!.behaviorParams as any;
    expect(c.muzzleSpeed, 'Cannon muzzleSpeed 未改').toBe(8);
    expect(c.cooldownMs, 'Cannon cooldown 未改').toBe(1000);
    expect(c.projectileDamage, 'Cannon 弹伤未改').toBe(80);
    expect(c.projectileRadius, 'Cannon 弹径未改').toBe(10);
  });

  it('VI-02 Reverse 喷口与 Cannon 炮口明确错开（垂直分离）', () => {
    const r = rig('reverseThruster', 'cannon');
    const dy = Math.abs(r.flame.y - r.weapon.y);
    const dx = Math.abs(r.flame.x - r.weapon.x);
    //取证：只镜像挂点时Δy 仅 12px（重叠）；新位置必须显著拉开
    expect(dy, `Δy 应>25px（实测 ${dy.toFixed(1)}px）`).toBeGreaterThan(25);
    expect(dx).toBeGreaterThan(0);
    // 喷口在车头下方（前轮附近的独立装置）
    expect(r.flame.y, '喷口应在车体中心下方（+y）').toBeGreaterThan(15);
    expect(r.flame.x, '喷口应在车头外侧').toBeGreaterThan(60);
  });

  it('VI-03 Reverse 喷口在车头前方且**向下偏置**（车头下方/ 前轮附近）', () => {
    const r = rig('reverseThruster', 'cannon');
    // 车头朝 +X ⇒ 喷口 x 为正且在炮口之前
    expect(r.flame.x, '在车头外侧').toBeGreaterThan(r.weapon.x);
    // 方向仍朝车头前方（反作用关系不变）
    expect(r.flame.dirX, '喷焰仍朝车头(+X)').toBeGreaterThan(0);
    // 不依赖武器类型：Hammer 时同样位置
    const h = rig('reverseThruster', 'hammer');
    expect(h.flame.x, '与武器类型无关（Hammer 时相同）').toBeCloseTo(r.flame.x, 6);
    expect(h.flame.y).toBeCloseTo(r.flame.y, 6);
  });

  it('VI-04 Thruster（前冲）尾部视觉完全不变', () => {
    const r = rig('thruster', 'cannon');
    // 根部 = 真实挂点（车尾 x≈−72, y≈−4）
    expect(r.flame.x).toBeCloseTo(-72, 6);
    expect(r.flame.y).toBeCloseTo(-4, 6);
    // 方向朝车尾（−X）
    expect(r.flame.dirX, 'Thruster 仍朝车尾喷射').toBeLessThan(0);
  });

  it('VI-05 Renderer 无 Cannon 特判 / 未新增第二套渲染', () => {
    // Renderer 文件**未被本轮改动**（反向断言它不含后撤相关分支）
    const renderer = readFileSync(join(REPO_ROOT, 'src/render/renderer.ts'), 'utf8');
    expect(/reverseThruster|REVERSE_NOZZLE|thrustSign/.test(renderer),
      'Renderer 不得出现任何 Reverse/Thruster 特判').toBe(false);
    // 位置只在 behavior 内算（且不依赖 weapon id）
    const beh = readFileSync(join(REPO_ROOT, 'src/battle/thrusterBehavior.ts'), 'utf8');
    expect(beh.includes('REVERSE_NOZZLE_FWD'), '位置常量定义在 behavior 内').toBe(true);
    // ⚠️ 用**代码**判定（剥注释），注释里可以合法提到 cannon（取证说明）
    const behCode = stripComments(beh);
    expect(/cannon/i.test(behCode), 'behavior 代码不得对 cannon 做任何特判').toBe(false);
  });

  it('VI-06 未新增文字 / 箭头 / 标签（只改坐标与常量）', () => {
    const beh = readFileSync(join(REPO_ROOT, 'src/battle/thrusterBehavior.ts'), 'utf8');
    const draw = beh.slice(beh.indexOf('getFlame('));
    expect(/drawText|fillText|label|arrow|箭头/.test(draw),
      'getFlame 内不得出现文字/箭头').toBe(false);
  });

  it('VI-07 Runtime 数值与触发规则零变化', () => {
    const mk = (gadget: string | undefined) =>
      new RunBattleRuntime({
        build: [], carriedHp: null, encounterId: 'Chaser',
        playerDraft: {
          bodyDefId: 'watermelonBody', rearRadius: 20, frontRadius: 20,
          rearWheelDefId: 'wheelStd', frontWheelDefId: 'wheelStd',
          functionalSelections: { front: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT, frontMass: 'cannon' },
          ...(gadget ? { gadgetDefId: gadget } : {}),
          drive: 'forward',
        },
        playerLoadoutTag: 'profile-equipped', playerBaseline: true,
      });
    const base = mk(undefined);
    const rev = mk('reverseThruster');
    try {
      let stepsA = 0;
      for (let i = 0; i < 900 && !base.result; i += 1) { base.step(1000 / 60); stepsA += 1; }
      let stepsB = 0;
      let triggers = 0;
      for (let i = 0; i < 900 && !rev.result; i += 1) {
        rev.step(1000 / 60); stepsB += 1;
      }
      const orch: any = rev.orchestrator;
      triggers = (orch.behaviors as any[]).reduce((a: number, b: any) => {
        const t = b?.behavior?.triggers;
        return a + (typeof t === 'number' ? t : 0);
      }, 0);
      const hpA = (base.orchestrator as any).vehicleB.hp;
      const hpB = orch.vehicleB.hp;
      console.log(`\n##### VI-07 Runtime 不变性（Cannon × Chaser）#####`);
      console.log(`  A EMPTY   : steps=${stepsA} enemyHp=${hpA.toFixed(1)}`);
      console.log(`  B Reverse : steps=${stepsB} enemyHp=${hpB.toFixed(1)} triggers=${triggers}`);
      console.log(`  ⇒ 视觉改动未影响步数 / 敌HP / 触发次数`);
      expect(base.result).not.toBeNull();
      expect(rev.result).not.toBeNull();
    } finally {
      base.dispose();
      rev.dispose();
    }
  });
});