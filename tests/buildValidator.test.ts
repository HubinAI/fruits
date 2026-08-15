import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import {
  validateSnapshot,
  validateFunctionalInstall,
} from '../src/core/buildValidator';
import type { BuildSnapshot } from '../src/core/types';

function baseBuild(): BuildSnapshot {
  return {
    id: 't',
    bodyDefId: 'boxBody',
    quality: 1,
    movements: [
      { hardpointId: 'rear', defId: 'wheelStd' },
      { hardpointId: 'front', defId: 'wheelStd' },
    ],
    functionals: [{ hardpointId: 'front', defId: 'ramHead' }],
  };
}

describe('BuildValidator', () => {
  const registry = createRegistry();

  it('合法 build 通过', () => {
    const r = validateSnapshot(baseBuild(), registry);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('缺少 Weapon 失败', () => {
    const b = baseBuild();
    b.functionals = [];
    expect(validateSnapshot(b, registry).valid).toBe(false);
  });

  it('未知 Body 失败', () => {
    const b = baseBuild();
    b.bodyDefId = 'nope';
    expect(validateSnapshot(b, registry).valid).toBe(false);
  });

  it('未知 Functional 槽位失败', () => {
    const b = baseBuild();
    b.functionals = [{ hardpointId: 'ghost', defId: 'ramHead' }];
    expect(validateSnapshot(b, registry).valid).toBe(false);
  });

  it('重复占用同一 Functional 槽位失败', () => {
    const b = baseBuild();
    b.functionals = [
      { hardpointId: 'front', defId: 'ramHead' },
      { hardpointId: 'front', defId: 'testMass' },
    ];
    expect(validateSnapshot(b, registry).valid).toBe(false);
  });

  it('Energy 超载失败（安装校验）', () => {
    // 注入高能耗部件（energy=90），ramHead(20)+90=110 > 100
    registry.functionals.set('highEnergy', {
      id: 'highEnergy',
      name: '高能耗',
      category: 'weapon',
      mass: 10,
      energy: 90,
      collider: { shape: 'box', width: 10, height: 10, offset: { x: 0, y: 0 } },
      behavior: 'none',
    });
    const r = validateFunctionalInstall(baseBuild(), registry, {
      hardpointId: 'rear',
      defId: 'highEnergy',
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join('')).toContain('能量超载');
  });

  it('替换时先减后加，避免错误拒绝', () => {
    // 当前：ramHead(20)。替换 front 为 highEnergy(90) → 20-20+90=90 <= 100，应通过
    registry.functionals.set('highEnergy', {
      id: 'highEnergy',
      name: '高能耗',
      category: 'weapon',
      mass: 10,
      energy: 90,
      collider: { shape: 'box', width: 10, height: 10, offset: { x: 0, y: 0 } },
      behavior: 'none',
    });
    const r = validateFunctionalInstall(baseBuild(), registry, {
      hardpointId: 'front',
      defId: 'highEnergy',
    });
    expect(r.valid).toBe(true);
  });
});
