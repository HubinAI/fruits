/**
 * Queue W1-VIS-1｜Visual 与 Physics Collider 正式解耦契约 targeted test
 *
 * 覆盖 W1-VIS-1 验收：
 * 1. 无 VisualDef 时 Renderer/Snapshot 不变（bodyVisual/wheelVisuals/part.visual 全 undefined，
 *    现有 Collider Shape fallback 原样）；
 * 2. 手工 VisualDef transform 正确（anchor 基于真实物理原点、visual rotation 叠加真实 rotation、
 *    size/layer 透传）；
 * 3. facing=-1 且 mirrorWithFacing → anchor.x 与 rotation 正确镜像；
 * 4. Collider 数据完全不受 Visual 修改影响（带 visual 与不带 visual 的 collider 世界几何一致）。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { BodyDef, BuildSnapshot } from '../src/core/types';

function makeRegistryWithVisuals() {
  const reg = createRegistry();
  const baseBody = reg.bodies.get('boxBody')!;
  const visBody: BodyDef = {
    ...baseBody,
    id: 'visBody',
    visual: {
      visualId: 'body-v',
      size: { width: 120, height: 40 },
      anchor: { x: 10, y: 5 },
      rotation: 0.3,
      layer: 2,
      mirrorWithFacing: true,
    },
  };
  reg.bodies.set('visBody', visBody);

  const baseCannon = reg.functionals.get('cannon')!;
  reg.functionals.set('visCannon', {
    ...baseCannon,
    id: 'visCannon',
    visual: {
      visualId: 'cannon-v',
      size: { width: 60, height: 20 },
      anchor: { x: 0, y: 0 },
      rotation: 0,
      layer: 3,
      mirrorWithFacing: true,
    },
  });

  const baseWheel = reg.movements.get('wheelStd')!;
  reg.movements.set('visWheel', {
    ...baseWheel,
    id: 'visWheel',
    visual: {
      visualId: 'wheel-v',
      size: { width: 40, height: 40 },
      anchor: { x: -3, y: 0 },
      rotation: 0.5,
      layer: 1,
      mirrorWithFacing: true,
    },
  });
  return reg;
}

function build(bodyDefId: string, wheelDefId: string, partDefId = 'visCannon'): BuildSnapshot {
  return {
    id: 'car',
    bodyDefId,
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: wheelDefId },
      { hardpointId: 'front', defId: wheelDefId },
    ],
    functionals: [{ hardpointId: 'front', defId: partDefId }],
  };
}

function makeOrch(reg: ReturnType<typeof makeRegistryWithVisuals>, side: 'A' | 'B') {
  const config =
    side === 'A'
      ? { spawnA: { x: 400, y: 640, facing: 1 as const }, autoDrive: false, engine: 'planck' as const }
      : { spawnB: { x: 400, y: 640, facing: -1 as const }, autoDrive: false, engine: 'planck' as const };
  const a = build('visBody', 'visWheel');
  const b = build('boxBody', 'wheelStd');
  const orch =
    side === 'A'
      ? new PlanckBattleOrchestrator(a, b, reg, config)
      : new PlanckBattleOrchestrator(b, a, reg, config);
  return { orch, vehicle: side === 'A' ? orch.vehicleA : orch.vehicleB };
}

describe('W1-VIS-1 Visual ≠ Collider', () => {
  it('1. 无 VisualDef 时 Snapshot 不变（visual 字段 undefined + Collider Shape fallback 原样）', () => {
    const reg = createRegistry(); // 原始 registry：body/wheel 全部无 visual；ramHead 无 visual
    // W2-SIL-1 后 cannon/hammer/pushRod 都有 VisualDef；本用例断言旧 Content fallback，用 ramHead
    const orch = new PlanckBattleOrchestrator(
      build('boxBody', 'wheelStd', 'ramHead'),
      build('boxBody', 'wheelStd', 'ramHead'),
      reg,
      { autoDrive: false, engine: 'planck' },
    );
    const snap = orch.getRenderSnapshot();
    expect(snap.vehicleA.bodyVisual).toBeUndefined();
    expect(snap.vehicleA.wheelVisuals).toEqual([undefined, undefined]); // 与 wheels 对齐，元素无视觉
    expect(snap.vehicleA.parts[0]!.visual).toBeUndefined();
    expect(snap.vehicleA.body.kind).toBe('polygons'); // Collider fallback 仍在
    expect(snap.vehicleA.parts[0]!.shape.kind).toBe('polygons');
  });

  it('2. 手工 VisualDef transform 正确（Planck，facing=1）', () => {
    const reg = makeRegistryWithVisuals();
    const { orch, vehicle } = makeOrch(reg, 'A');
    const snap = orch.getRenderSnapshot();
    const v = snap.vehicleA;
    const bPos = orch.world.getPosition(vehicle.body);
    const bAng = orch.world.getAngle(vehicle.body);

    // Body visual：anchor(10,5) 随真实 body rotation 旋转；rotation = bodyAngle + 0.3
    expect(v.bodyVisual).toBeDefined();
    expect(v.bodyVisual!.visualId).toBe('body-v');
    expect(v.bodyVisual!.size).toEqual({ width: 120, height: 40 });
    expect(v.bodyVisual!.layer).toBe(2);
    const cos = Math.cos(bAng);
    const sin = Math.sin(bAng);
    expect(v.bodyVisual!.position.x).toBeCloseTo(bPos.x + 10 * cos - 5 * sin, 6);
    expect(v.bodyVisual!.position.y).toBeCloseTo(bPos.y + 10 * sin + 5 * cos, 6);
    expect(v.bodyVisual!.rotation).toBeCloseTo(bAng + 0.3, 6);

    // Part visual：cannon（anchor 0,0）→ position = part 物理原点；rotation = partAngle
    const part = vehicle.parts[0]!;
    const partPos = orch.world.getPosition(part.body);
    const partAng = orch.world.getAngle(part.body);
    const pv = v.parts[0]!.visual!;
    expect(pv.visualId).toBe('cannon-v');
    expect(pv.position.x).toBeCloseTo(partPos.x, 6);
    expect(pv.position.y).toBeCloseTo(partPos.y, 6);
    expect(pv.rotation).toBeCloseTo(partAng, 6);

    // Wheel visual（front 轮）：anchor(-3,0) 随轮真实 rotation
    const wheel = vehicle.wheels[1]!; // front
    const wPos = orch.world.getPosition(wheel.body);
    const wAng = orch.world.getAngle(wheel.body);
    const wv = v.wheelVisuals![1]!;
    expect(wv.visualId).toBe('wheel-v');
    expect(wv.position.x).toBeCloseTo(wPos.x + -3 * Math.cos(wAng), 6);
    expect(wv.rotation).toBeCloseTo(wAng + 0.5, 6);
  });

  it('3. facing=-1 且 mirrorWithFacing → anchor.x 与 rotation 正确镜像', () => {
    const reg = makeRegistryWithVisuals();
    const { orch, vehicle } = makeOrch(reg, 'B'); // facing = -1
    const snap = orch.getRenderSnapshot();
    const v = snap.vehicleB;
    const bPos = orch.world.getPosition(vehicle.body);
    const bAng = orch.world.getAngle(vehicle.body);

    // mirrorWithFacing=true：anchor.x 取反（-10）、rotation 镜像（-0.3）
    expect(v.bodyVisual).toBeDefined();
    expect(v.bodyVisual!.position.x).toBeCloseTo(bPos.x + -10 * Math.cos(bAng) - 5 * Math.sin(bAng), 6);
    expect(v.bodyVisual!.position.y).toBeCloseTo(bPos.y + -10 * Math.sin(bAng) + 5 * Math.cos(bAng), 6);
    expect(v.bodyVisual!.rotation).toBeCloseTo(bAng - 0.3, 6);
  });

  it('4. Collider 数据不受 Visual 修改影响（世界几何一致）', () => {
    const regVisual = makeRegistryWithVisuals();
    const regPlain = createRegistry();
    const oV = new PlanckBattleOrchestrator(
      build('visBody', 'visWheel'),
      build('boxBody', 'wheelStd', 'cannon'),
      regVisual,
      { autoDrive: false, engine: 'planck' },
    );
    const oP = new PlanckBattleOrchestrator(
      build('boxBody', 'wheelStd', 'cannon'),
      build('boxBody', 'wheelStd', 'cannon'),
      regPlain,
      { autoDrive: false, engine: 'planck' },
    );
    const sV = oV.getRenderSnapshot();
    const sP = oP.getRenderSnapshot();
    // visBody 与 boxBody 的 collider 相同 → body shape 多边形点数一致（Collider 未受影响）
    expect(sV.vehicleA.body.kind).toBe('polygons');
    expect(sP.vehicleA.body.kind).toBe('polygons');
    const ptsV = (sV.vehicleA.body as { polygons: { points: unknown[] }[] }).polygons.flatMap((p) => p.points);
    const ptsP = (sP.vehicleA.body as { polygons: { points: unknown[] }[] }).polygons.flatMap((p) => p.points);
    expect(ptsV.length).toBe(ptsP.length); // 同一 box collider 顶点数
  });
});
