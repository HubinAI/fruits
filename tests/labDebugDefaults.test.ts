/**
 * Queue LAB-DEBUG-UX｜Debug 默认全关 + 一键关闭语义
 *
 * 覆盖验收：
 * 1. Debug 显示项默认全部为 false（页面刷新 / 重新进入后不自动勾选——main.ts 的
 *    checkbox 用 lab.debugFlags 初始化，而 debugFlags 默认来自 DEFAULT_DEBUG_FLAGS）；
 * 2. 不影响 Override 数值（DEFAULT_OVERRIDES 原样保留）；
 * 3. 「全部关闭」核心语义：遍历全部 key 置 false 后无任何残留 true。
 *
 * 使用最小 canvas stub（node 环境无 DOM；PhysicsLab 构造函数只存储 renderer 不调用）。
 */
import { describe, it, expect } from 'vitest';
import { PhysicsLab } from '../src/lab/physicsLab';
import {
  DEFAULT_DEBUG_FLAGS,
  DEFAULT_OVERRIDES,
  type DebugFlags,
} from '../src/render/debugOverlay';
import type { Renderer } from '../src/render/renderer';

/** 最小 Renderer stub：PhysicsLab 构造只保存引用，不调用任何方法 */
const rendererStub = {} as unknown as Renderer;

/** DebugFlags 全部 key（与面板项一一对应） */
function flagKeys(): (keyof DebugFlags)[] {
  return Object.keys(DEFAULT_DEBUG_FLAGS) as (keyof DebugFlags)[];
}

describe('LAB-DEBUG-UX Debug 默认全关', () => {
  it('DEFAULT_DEBUG_FLAGS 全部 14 项均为 false（刷新后不自动勾选的数据源）', () => {
    const keys = flagKeys();
    expect(keys.length).toBe(14);
    for (const k of keys) {
      expect(DEFAULT_DEBUG_FLAGS[k]).toBe(false);
    }
  });

  it('new PhysicsLab() 的 debugFlags 全部为 false', () => {
    const lab = new PhysicsLab(rendererStub);
    for (const k of flagKeys()) {
      expect(lab.debugFlags[k]).toBe(false);
    }
  });

  it('Override 不受影响：默认值与 DEFAULT_OVERRIDES 完全一致', () => {
    const lab = new PhysicsLab(rendererStub);
    expect(lab.overrides).toEqual(DEFAULT_OVERRIDES);
    // Override 数值为研发隔离值，与 Debug 显示开关相互独立
    expect(lab.overrides.massScale).toBe(1);
    expect(lab.overrides.driveTorqueScale).toBe(1);
    expect(lab.overrides.gripScale).toBe(1);
  });

  it('「全部关闭」语义：勾选若干项后一次清空，无残留 true', () => {
    const lab = new PhysicsLab(rendererStub);
    // 模拟手动勾选了 3 项
    lab.debugFlags.com = true;
    lab.debugFlags.collider = true;
    lab.debugFlags.totalMass = true;
    // 「全部关闭」：遍历全部 key 置 false（main.ts 按钮同一语义）
    for (const k of flagKeys()) {
      lab.debugFlags[k] = false;
    }
    for (const k of flagKeys()) {
      expect(lab.debugFlags[k]).toBe(false);
    }
  });
});
