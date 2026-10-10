/**
 * Queue ID｜GADGET-REVERSE-THRUSTER-PROTOTYPE-R1
 *
 * 第二个 Gadget 原型：**Reverse Thruster（反推器）**——「敌人过近 → 短时后撤」。
 * 与 Thruster **共用同一 behavior 与同一状态机**，只由 `distanceTrigger.mode`
 * 切换触发方向（near）与冲量符号（车尾方向）。
 *
 * 覆盖 Queue 验收 1–6。
 */
import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { WEAPON_SLOT, defaultPlayerDraft } from '../src/product/playerLoadout';

const FRAME_MS = 1000 / 60;

interface Box { minX: number; minY: number; maxX: number; maxY: number }
function aabbGap(a: Box, b: Box): number {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.hypot(dx, dy);
}

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

interface Rec {
  steps: number; hpA: number; hpB: number;
  hits: number; totalDamage: number;
  triggers: number;
  /** 每次触发：触发瞬间距离 → burst 内峰值距离（= 真实拉大量） */
  widen: number[];
  minVx: number; maxTiltDeg: number;
  deepPen: number; nonFinite: boolean;
  gapLastThird: number;
}

function run(weapon: string, gadget: string | undefined, encounter: string): Rec {
  const rt = new RunBattleRuntime({
    build: [], carriedHp: null, encounterId: encounter,
    playerDraft: draftOf(weapon, gadget),
    playerLoadoutTag: 'profile-equipped', playerBaseline: true,
  });
  const orch: any = rt.orchestrator;
  const vA: any = orch.vehicleA;
  const vB: any = orch.vehicleB;
  const enemyColliders: any[] = [
    vB.body, ...vB.parts.map((p: any) => p.body), ...vB.wheels.map((w: any) => w.body),
  ];
  const gap = (): number => {
    let g = Infinity;
    const a: Box = orch.world.getCollisionBounds(vA.body);
    for (const eb of enemyColliders) g = Math.min(g, aabbGap(a, orch.world.getCollisionBounds(eb)));
    return g;
  };

  let step = 0, minVx = 0, maxTilt = 0, deepPen = 0, nonFinite = false;
  const widen: number[] = [];
  const gaps: number[] = [];
  let lastTriggers = 0;
  let lastTriggerStep = -999;
  let gapAtTrigger = 0;
  let peakInBurst = 0;

  try {
    while (rt.result === null && step < 1400) {
      step += 1;
      const g = gap();
      gaps.push(g);
      if (g < -100) deepPen += 1;
      const v = orch.world.getLinearVelocity(vA.body);
      if (!Number.isFinite(v.x) || !Number.isFinite(g)) nonFinite = true;
      if (v.x < minVx) minVx = v.x;
      maxTilt = Math.max(maxTilt, Math.abs(orch.world.getAngle(vA.body)) * 180 / Math.PI);

      let t = 0;
      try {
        t = ((orch as any).behaviors as any[]).reduce((a: number, b: any) => {
          const n = b?.behavior?.triggers;
          return a + (typeof n === 'number' ? n : 0);
        }, 0);
      } catch { /* ignore */ }
      if (t > lastTriggers) {
        gapAtTrigger = g; peakInBurst = g; lastTriggerStep = step; lastTriggers = t;
      } else if (step - lastTriggerStep <= 30 && step - lastTriggerStep >= 0) {
        peakInBurst = Math.max(peakInBurst, g);
      }
      if (step - lastTriggerStep === 31 && widen.length < lastTriggers) {
        widen.push(peakInBurst - gapAtTrigger);
      }
      rt.step(FRAME_MS);
    }

    const sum = rt.playerWeaponHitSummary() as unknown as Record<
      string, { count: number; damages: readonly number[] }
    >;
    const hits = Object.keys(sum).reduce((a, k) => a + sum[k]!.count, 0);
    const dmg: number[] = [];
    for (const k of Object.keys(sum)) dmg.push(...sum[k]!.damages);
    const last3 = gaps.slice(Math.floor(gaps.length * 0.667));
    return {
      steps: step, hpA: vA.hp, hpB: vB.hp,
      hits, totalDamage: dmg.reduce((a, b) => a + b, 0),
      triggers: lastTriggers, widen, minVx, maxTiltDeg: maxTilt,
      deepPen, nonFinite,
      gapLastThird: last3.length ? last3.reduce((a, b) => a + b, 0) / last3.length : NaN,
    };
  } finally {
    rt.dispose();
  }
}

describe('GADGET-REVERSE-THRUSTER-PROTOTYPE-R1', () => {
  it('RV-01 反推器是独立 Gadget 内容（near 模式 / energy 20 / 共用 thruster behavior）', () => {
    const t = registry.functionals.get('reverseThruster')!;
    const bp = t.behaviorParams as {
      distanceTrigger?: { enabled?: boolean; mode?: string; thresholdPx?: number };
    };
    expect(t.category, '走正式 Gadget 维度').toBe('gadget');
    expect(t.energy).toBe(20);
    expect(t.behavior, '复用同一 behavior（不做大规模状态机重构）').toBe('thruster');
    expect(bp.distanceTrigger?.enabled).toBe(true);
    expect(bp.distanceTrigger?.mode, 'near = 过近触发').toBe('near');
    expect(bp.distanceTrigger?.thresholdPx).toBe(175);
  });

  it('RV-02 EMPTY Gadget 基准保持现状（Cannon × Chaser 现状读数）', () => {
    const a = run('cannon', undefined, 'Chaser');
    expect(a.triggers, 'EMPTY 无触发').toBe(0);
    expect(a.hits, '基准命中数与既有一致').toBe(8);
    expect(a.totalDamage).toBe(960);
    expect(a.steps).toBe(542);
  }, 400000);

  it('RV-03 反推器真实触发并产生真实后撤（明显负向速度）', () => {
    const a = run('cannon', undefined, 'Chaser');
    const b = run('cannon', 'reverseThruster', 'Chaser');
    expect(b.triggers, '必须真实触发').toBeGreaterThan(0);
    expect(b.minVx, `后撤速度必须明显（基准 ${a.minVx.toFixed(1)} → 反推 ${b.minVx.toFixed(1)}）`)
      .toBeLessThan(a.minVx - 1.5);
  }, 400000);

  it('RV-04 空间链成立：每次触发后敌我距离被真实拉开', () => {
    const b = run('cannon', 'reverseThruster', 'Chaser');
    expect(b.widen.length, '至少有一次可测的触发窗口').toBeGreaterThan(0);
    const best = Math.max(...b.widen);
    expect(best, `后撤必须形成明显拉开（实测 ${best.toFixed(1)}px）`).toBeGreaterThan(20);
  }, 400000);

  it('RV-05 无严重物理异常（深穿 / 非有限值 / 极端倾角）', () => {
    const b = run('cannon', 'reverseThruster', 'Chaser');
    expect(b.deepPen, '无深度穿越（coreGap < -100）').toBe(0);
    expect(b.nonFinite, '无物理爆炸 / NaN').toBe(false);
    expect(b.maxTiltDeg, '无极端翻车（< 45°）').toBeLessThan(45);
  }, 400000);

  it('RV-06 不识别武器类型：Hammer 也能装配，但不会神奇改善闭距', () => {
    const a = run('hammer', undefined, 'RangedTurret');
    const b = run('hammer', 'reverseThruster', 'RangedTurret');
    expect(b.triggers, 'Hammer 装上反推器同样能触发（无武器专属逻辑）').toBeGreaterThan(0);
    // 反推器只会「拉远」，不会创造 Hammer 需要的近身接触 ⇒ 命中不会变好
    expect(b.hits, 'Hammer 命中不会因反推器变好').toBeLessThanOrEqual(a.hits);
  }, 400000);

  it('RV-07 武器与 Movement 数值未被修改', () => {
    const h = registry.functionals.get('hammer')!;
    const c = registry.functionals.get('cannon')!;
    expect((h.behaviorParams as { baseDamage?: number }).baseDamage, 'hammer baseDamage 仍 90').toBe(90);
    expect((c.behaviorParams as { muzzleSpeed?: number }).muzzleSpeed, 'cannon muzzleSpeed 未改').toBe(8);
    for (const id of ['wheelStd', 'smallWheel', 'largeWheel', 'heavyWheel']) {
      expect(registry.movements.get(id)!.cruiseSpeedPxPerStep, `${id} cruiseSpeed 仍 1.5`).toBe(1.5);
    }
  });
});