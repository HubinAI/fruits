/**
 * Queue Q02-C2｜Cannon Content Definition targeted test
 *
 * 覆盖 Q02-C2 验收：
 * 1. registry 可取得 cannon（createRegistry 与单例一致）；
 * 2. category='weapon'、behavior='cannon'；
 * 3. behaviorParams 恰含六个参数且数值正确；
 * 4. cannon 不含 baseDamage（炮身接触不能直接造成 Weapon Damage，与 ramHead 对比）。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry, registry } from '../src/core/content';
import type { FunctionalPartDef } from '../src/core/types';

const cannon = createRegistry().functionals.get('cannon');

describe('Q02-C2 Cannon Content Definition', () => {
  it('registry 可取得 cannon（createRegistry 与单例 registry 一致）', () => {
    expect(cannon).toBeDefined();
    expect(registry.functionals.get('cannon')).toBeDefined();
    // 同一模块级 cannon 对象引用（Map 值相同）
    expect(registry.functionals.get('cannon')).toBe(cannon);
  });

  it('category / behavior / 真实 collider / mass / energy 正确', () => {
    const c = cannon as FunctionalPartDef;
    expect(c.category).toBe('weapon');
    expect(c.behavior).toBe('cannon');
    expect(c.mass).toBeGreaterThan(0);
    expect(c.energy).toBeGreaterThan(0);
    expect(c.collider.shape).toBe('box');
    expect(c.collider.width).toBeGreaterThan(0);
    expect(c.collider.height).toBeGreaterThan(0);
    // 炮口方向：collider offset 向前伸出（offset.x > 0）
    expect(c.collider.offset.x).toBeGreaterThan(0);
  });

  it('behaviorParams 恰含六个参数且数值正确（明显、易验证）', () => {
    const c = cannon as FunctionalPartDef;
    expect(c.behaviorParams).toEqual({
      cooldownMs: 1000,
      muzzleSpeed: 12,
      projectileDamage: 80,
      projectileRadius: 6,
      projectileMass: 1,
      recoilImpulse: 12,
    });
    // 无多余参数（除六参数外无其它 key）
    expect(Object.keys(c.behaviorParams ?? {}).sort()).toEqual([
      'cooldownMs',
      'muzzleSpeed',
      'projectileDamage',
      'projectileMass',
      'projectileRadius',
      'recoilImpulse',
    ]);
  });

  it('cannon 不含 baseDamage（炮身接触不能直接造成 Weapon Damage）', () => {
    const c = cannon as FunctionalPartDef;
    expect(c.behaviorParams).not.toHaveProperty('baseDamage');
    expect((c.behaviorParams as Record<string, unknown>).baseDamage).toBeUndefined();
    // 对照：ramHead 有 baseDamage（接触直伤），cannon 没有（伤害只能来自 projectile）
    const ram = createRegistry().functionals.get('ramHead')!;
    expect(ram.behaviorParams).toHaveProperty('baseDamage');
  });
});
