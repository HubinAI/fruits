/**
 * Queue Q06-F2｜Build Editor Pure Model targeted test
 *
 * 覆盖 Q06-F2 验收：
 * 1. wedge / box / tall / heavyBox 返回各自真实 hardpoints；
 * 2. boxBody 能看到额外 frontMass（heavyBox 继承 boxBody 同样含）；
 * 3. Body 切换不产生非法遗留槽（保留同名、丢弃旧槽、新增默认 none）；
 * 4. Cannon / Hammer / Push 可安装在任意真实 Functional hardpoint；
 * 5. none 不进入 BuildSnapshot（且不自动塞 ramHead、不创造不存在的 hardpoint）。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import {
  buildSnapshotFromDraft,
  editableSlots,
  migrateDraftBody,
  type BuildDraft,
} from '../src/lab/buildEditorModel';

const registry = createRegistry();

function draftOf(
  bodyDefId: string,
  selections: Record<string, string> = {},
): BuildDraft {
  return {
    bodyDefId,
    rearRadius: 20,
    frontRadius: 20,
    functionalSelections: selections,
  };
}

describe('Q06-F2 Build Editor Pure Model', () => {
  it('1. wedge / box / tall / heavyBox 返回各自真实 hardpoints', () => {
    expect(editableSlots(registry.bodies.get('wedgeBody')!)).toEqual([
      'front',
      'top',
      'rear',
    ]);
    expect(editableSlots(registry.bodies.get('boxBody')!)).toEqual([
      'front',
      'frontMass',
      'top',
      'rear',
    ]);
    expect(editableSlots(registry.bodies.get('tallBody')!)).toEqual([
      'front',
      'top',
      'rear',
    ]);
    expect(editableSlots(registry.bodies.get('heavyBox')!)).toEqual([
      'front',
      'frontMass',
      'top',
      'rear',
    ]);
  });

  it('2. boxBody（及继承它的 heavyBox）能看到额外 frontMass，wedge/tall 没有', () => {
    expect(editableSlots(registry.bodies.get('boxBody')!)).toContain('frontMass');
    expect(editableSlots(registry.bodies.get('heavyBox')!)).toContain('frontMass');
    expect(editableSlots(registry.bodies.get('wedgeBody')!)).not.toContain(
      'frontMass',
    );
    expect(editableSlots(registry.bodies.get('tallBody')!)).not.toContain(
      'frontMass',
    );
  });

  it('3. Body 切换：保留同名选择、丢弃不存在旧槽、新增槽默认 none（不产生非法遗留槽）', () => {
    // boxBody：front=cannon、top=hammer、rear=pushRod、frontMass=none
    const box = draftOf('boxBody', {
      front: 'cannon',
      frontMass: 'none',
      top: 'hammer',
      rear: 'pushRod',
    });
    // 切到 wedgeBody：无 frontMass → 丢弃；front/top/rear 保留
    const wedge = migrateDraftBody(box, 'wedgeBody', registry);
    expect(wedge.bodyDefId).toBe('wedgeBody');
    expect(wedge.functionalSelections).toEqual({
      front: 'cannon',
      top: 'hammer',
      rear: 'pushRod',
    });
    // 切回 boxBody：frontMass 为新增槽 → 默认 none
    const back = migrateDraftBody(wedge, 'boxBody', registry);
    expect(back.functionalSelections).toEqual({
      front: 'cannon',
      frontMass: 'none',
      top: 'hammer',
      rear: 'pushRod',
    });
    // 非法遗留槽检查：任何时刻 selections 键集合 == 目标 Body 真实槽位集合
    for (const m of [wedge, back]) {
      const slots = editableSlots(registry.bodies.get(m.bodyDefId)!);
      expect(Object.keys(m.functionalSelections).sort()).toEqual([...slots].sort());
    }
  });

  it('3b. Body 切换：none 选择同样保留；未知 Body 清空槽位', () => {
    const d = draftOf('boxBody', { front: 'none', top: 'hammer', rear: 'none' });
    const wedge = migrateDraftBody(d, 'wedgeBody', registry);
    expect(wedge.functionalSelections).toEqual({
      front: 'none',
      top: 'hammer',
      rear: 'none',
    });
    const ghost = migrateDraftBody(d, 'noSuchBody', registry);
    expect(ghost.functionalSelections).toEqual({});
  });

  it('4. Cannon/Hammer/Push 可安装在任意真实 Functional hardpoint', () => {
    // 三种正式部件装在三个不同真实槽位（含 frontMass/top/rear 非 front 槽）
    const s = buildSnapshotFromDraft(
      draftOf('boxBody', {
        front: 'cannon',
        frontMass: 'hammer',
        top: 'pushRod',
        rear: 'none',
      }),
      registry,
      'multi',
    );
    expect(s.functionals).toEqual([
      { hardpointId: 'front', defId: 'cannon' },
      { hardpointId: 'frontMass', defId: 'hammer' },
      { hardpointId: 'top', defId: 'pushRod' },
    ]);
    // movements 生成前/后轮（radius overrides 透传）
    expect(s.movements).toHaveLength(2);
    expect(s.movements[0]!.hardpointId).toBe('rear');
    expect(s.movements[1]!.hardpointId).toBe('front');
    expect(s.movements[1]!.overrides?.radius).toBe(20);
  });

  it('5. none 不进入 BuildSnapshot；不自动塞 ramHead；不创造不存在的 hardpoint', () => {
    // 全部空槽 → functionals 为空（不自动塞 ramHead）
    const empty = buildSnapshotFromDraft(
      draftOf('boxBody', { front: 'none', frontMass: 'none', top: 'none', rear: 'none' }),
      registry,
    );
    expect(empty.functionals).toEqual([]);

    // 混入不存在槽位（ghost）→ 被过滤；none 被过滤；合法项保留
    const mixed = buildSnapshotFromDraft(
      draftOf('wedgeBody', {
        front: 'pushRod',
        top: 'none',
        rear: 'hammer',
        ghost: 'cannon',
      }),
      registry,
    );
    expect(mixed.functionals).toEqual([
      { hardpointId: 'front', defId: 'pushRod' },
      { hardpointId: 'rear', defId: 'hammer' },
    ]);
  });

  it('5b. 未知 Body 的 draft 也能产出 snapshot（functionals 因无真实槽位被清空）', () => {
    const s = buildSnapshotFromDraft(
      draftOf('noSuchBody', { front: 'cannon', ghost: 'hammer' }),
      registry,
    );
    expect(s.bodyDefId).toBe('noSuchBody');
    expect(s.functionals).toEqual([]); // 无真实 hardpoint 可挂
    expect(s.movements).toHaveLength(2);
  });
});
