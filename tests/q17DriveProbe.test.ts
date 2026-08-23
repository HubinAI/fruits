/**
 * Queue Q17-MOVEMENT-PROBE｜站桩 vs 前进 的接敌方式验证 —— targeted test（纯模块层）。
 *
 * 覆盖：
 * 1. resolveDriveEnable（新增按侧驱动纯函数）：缺省 / autoDrive=false / 按侧覆盖的语义；
 * 2. Q17-A / Q17-B 场景结构：存在、engine=planck、Q17-A 只关 A 的 drive（sideDrive.a=false）、
 *    Q17-B 无 sideDrive（双方正常前进）；
 * 3. Q17-A/B 使用完全相同的两套 Build（唯一主要变量 = Movement/drive）；
 * 4. Q17 两车 Build 全部通过正式 Validator（≥1 Weapon、Energy 不超载、槽位合法）。
 */
import { describe, it, expect } from 'vitest';
import { resolveDriveEnable } from '../src/battle/battleContract';
import { SCENARIOS, getScenario } from '../src/lab/scenarios';
import { validateSnapshot, computeEnergy } from '../src/core/buildValidator';
import { registry } from '../src/core/content';

describe('Q17 resolveDriveEnable（按侧驱动纯函数）', () => {
  it('缺省（无 sideDrive / 无 autoDrive）= 双方驱动（既有行为）', () => {
    expect(resolveDriveEnable(undefined, undefined)).toEqual({ a: true, b: true });
    expect(resolveDriveEnable(undefined, {})).toEqual({ a: true, b: true });
    expect(resolveDriveEnable(true, undefined)).toEqual({ a: true, b: true });
  });

  it('autoDrive=false = 双方都不驱动（既有 Lab 站桩语义）', () => {
    expect(resolveDriveEnable(false, undefined)).toEqual({ a: false, b: false });
  });

  it('sideDrive 按侧覆盖：{a:false} → A 站桩、B 跟随 autoDrive 驱动', () => {
    expect(resolveDriveEnable(true, { a: false })).toEqual({ a: false, b: true });
    expect(resolveDriveEnable(true, { a: false, b: true })).toEqual({ a: false, b: true });
  });

  it('sideDrive 只在指定侧覆盖，未指定侧跟随 autoDrive', () => {
    expect(resolveDriveEnable(false, { b: true })).toEqual({ a: false, b: true });
    expect(resolveDriveEnable(false, { a: true })).toEqual({ a: true, b: false });
  });
});

describe('Q17 场景（DEV 隔离探针）', () => {
  const a = getScenario('Q17-A');
  const b = getScenario('Q17-B');

  it('Q17-A / Q17-B 均存在', () => {
    expect(a).toBeDefined();
    expect(b).toBeDefined();
  });

  it('Q17-A：A 站桩（sideDrive.a=false）且 B 驱动；Q17-B：无 sideDrive（双方正常前进）', () => {
    expect(a!.config.engine).toBe('planck');
    expect(a!.config.sideDrive).toEqual({ a: false, b: true });
    expect(b!.config.engine).toBe('planck');
    expect(b!.config.autoDrive).toBe(true);
    expect(b!.config.sideDrive).toBeUndefined();
  });

  it('Q17-A/B 使用完全相同的两套 Build（唯一主要变量 = Movement/drive）', () => {
    expect(JSON.stringify(a!.buildA)).toBe(JSON.stringify(b!.buildA));
    expect(JSON.stringify(a!.buildB)).toBe(JSON.stringify(b!.buildB));
  });

  it('Q17 两车 Build 全部通过正式 Validator（≥1 Weapon、Energy≤容量、槽位合法）', () => {
    for (const s of [a!, b!]) {
      for (const snap of [s.buildA, s.buildB]) {
        const res = validateSnapshot(snap, registry);
        expect(res.valid, `${snap.id}: ${res.errors.join('; ')}`).toBe(true);
        const energy = computeEnergy(snap, registry).energy;
        const cap = registry.bodies.get(snap.bodyDefId)!.energyCapacity;
        expect(energy).toBeLessThanOrEqual(cap);
      }
    }
  });

  it('SCENARIOS 数量含新增（防误删探针场景）', () => {
    expect(SCENARIOS.some((s) => s.id === 'Q17-A')).toBe(true);
    expect(SCENARIOS.some((s) => s.id === 'Q17-B')).toBe(true);
  });
});
