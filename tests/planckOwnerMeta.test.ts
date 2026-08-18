/**
 * Queue F-02M-B1｜Planck Body Owner Meta（保留不回删）
 *
 * 验证 opaque BodyHandle 的 OwnerTag 存取：
 * 标签往返、防御复制（输入/输出互不污染）、未设置返回 null、跨 World 抛错。
 */
import { describe, it, expect } from 'vitest';
import { PlanckWorld, type BodyHandle } from '../src/physics/planckWorld';
import type { OwnerTag } from '../src/core/types';

describe('F-02M-B1 · Planck Body Owner Meta', () => {
  it('车身/车轮/地面标签往返一致', () => {
    const world = new PlanckWorld({ x: 0, y: 10 });
    const chassis: BodyHandle = world.createDynamicBox(0, 585, 120, 40, 50);
    const wheel: BodyHandle = world.createDynamicCircle(-40, 637, 20, 10, { friction: 1 });
    const ground: BodyHandle = world.createStaticGround(0, 700, 4000, 80);

    const chassisTag: OwnerTag = { kind: 'vehicle', vehicleId: 'light', team: 'A' };
    const wheelTag: OwnerTag = { kind: 'vehicle', vehicleId: 'light', partId: 'wheel:front', team: 'A' };
    const groundTag: OwnerTag = { kind: 'ground' };

    world.setOwnerTag(chassis, chassisTag);
    world.setOwnerTag(wheel, wheelTag);
    world.setOwnerTag(ground, groundTag);

    const c = world.getOwnerTag(chassis);
    const w = world.getOwnerTag(wheel);
    const g = world.getOwnerTag(ground);

    expect(c).toEqual(chassisTag);
    expect(w).toEqual(wheelTag);
    expect(g).toEqual(groundTag);

    // 字段级核对
    expect(c?.kind).toBe('vehicle');
    expect(c?.vehicleId).toBe('light');
    expect(c?.team).toBe('A');
    expect(w?.partId).toBe('wheel:front');
    expect(g?.kind).toBe('ground');
    expect(g?.vehicleId).toBeUndefined();
  });

  it('防御复制：输入/返回对象修改不污染内部保存', () => {
    const world = new PlanckWorld();
    const body: BodyHandle = world.createDynamicBox(0, 0, 40, 40, 5);

    const tag: OwnerTag = { kind: 'vehicle', vehicleId: 'orig', team: 'A' };
    world.setOwnerTag(body, tag);

    // 修改输入对象（set 之后）不得影响内部
    tag.vehicleId = 'MUTATED';
    tag.kind = 'ground';
    expect(world.getOwnerTag(body)?.vehicleId).toBe('orig');
    expect(world.getOwnerTag(body)?.kind).toBe('vehicle');

    // 修改返回值不得影响内部
    const got = world.getOwnerTag(body);
    got!.vehicleId = 'MUTATED2';
    got!.team = 'B';
    const again = world.getOwnerTag(body);
    expect(again?.vehicleId).toBe('orig');
    expect(again?.team).toBe('A');
  });

  it('未设置返回 null；跨 World handle 抛错', () => {
    const wa = new PlanckWorld();
    const wb = new PlanckWorld();
    const aBody = wa.createDynamicBox(0, 0, 40, 40, 5);
    const bBody = wb.createDynamicBox(0, 0, 40, 40, 5);

    // 未设置 → null
    expect(wa.getOwnerTag(aBody)).toBeNull();

    // 跨 World：aBody 传给 wb
    expect(() => wb.setOwnerTag(aBody, { kind: 'vehicle', team: 'A' })).toThrow();
    expect(() => wb.getOwnerTag(aBody)).toThrow();

    // 正常 set 后各自独立
    wa.setOwnerTag(aBody, { kind: 'vehicle', team: 'A' });
    wb.setOwnerTag(bBody, { kind: 'ground' });
    expect(wa.getOwnerTag(aBody)?.team).toBe('A');
    expect(wb.getOwnerTag(bBody)?.kind).toBe('ground');
    // 跨 World 读也抛错（aBody 不属于 wb，不返回 bBody 的 tag）
    expect(() => wb.getOwnerTag(aBody)).toThrow();
  });
});
