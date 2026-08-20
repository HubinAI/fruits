/**
 * Queue W2-SIL-1｜正式 Content 视觉轮廓样板 targeted test
 *
 * 覆盖验收：
 * 1. 5 个首批正式 Content 全部进入 ContentRegistry 并携带 VisualDef；
 * 2. cannon visual 本地跨距右端 == collider muzzle 真实位置（offset 20 + halfW 20 = 40）；
 * 3. hammer visual 本地跨距 0 附近 = Revolute pivot（柄根位于挂点）；
 * 4. pushRod visual 本地跨距右端 ≈ collider 前缘（offset 40 + halfW 40 = 80）；
 * 5. watermelon/banana 4 槽（front/frontMass/top/rear）editableSlots 真实返回；
 * 6. W2-SIL-1 样板 Draft（watermelon + banana，各装 pushRod+cannon+hammer）→ valid（能量 + ≥1 Weapon）；
 * 7. facing=-1 + mirrorWithFacing → watermelon/banana body visual 镜像路径无异常。
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/core/content';
import {
  buildSnapshotFromDraft,
  editableSlots,
  EMPTY_SLOT,
  type BuildDraft,
} from '../src/lab/buildEditorModel';
import { validateSnapshot } from '../src/core/buildValidator';
import { visualWorldTransform } from '../src/battle/battleContract';

const registry = createRegistry();

function silDraft(bodyDefId: string): BuildDraft {
  const body = registry.bodies.get(bodyDefId)!;
  const selections: Record<string, string> = {};
  for (const hp of body.functionalHardpoints) {
    if (hp.id === 'front') selections[hp.id] = 'pushRod';
    else if (hp.id === 'frontMass') selections[hp.id] = 'cannon';
    else if (hp.id === 'top') selections[hp.id] = 'hammer';
    else selections[hp.id] = EMPTY_SLOT;
  }
  return { bodyDefId, rearRadius: 20, frontRadius: 20, functionalSelections: selections };
}

describe('W2-SIL-1 正式 Content 视觉轮廓样板', () => {
  it('1. 5 个首批正式 Content 全部进入 Registry 并携带 VisualDef', () => {
    const ids = ['watermelonBody', 'bananaBody', 'cannon', 'hammer', 'pushRod'];
    for (const id of ids) {
      const def = registry.bodies.get(id) ?? registry.functionals.get(id);
      expect(def, `Registry 应含 ${id}`).toBeDefined();
      expect(def!.visual, `${id} 应携带 VisualDef`).toBeDefined();
      expect(def!.visual!.visualId).toMatch(
        /^(body_watermelon|body_banana|part_cannon|part_hammer|part_pushRod)$/,
      );
      expect(def!.visual!.size.width).toBeGreaterThan(0);
      expect(def!.visual!.size.height).toBeGreaterThan(0);
      expect(typeof def!.visual!.layer).toBe('number');
      expect(typeof def!.visual!.mirrorWithFacing).toBe('boolean');
    }
  });

  it('2. cannon visual 本地跨距右端 == 真实 muzzle（offset 20 + halfW 20 = 40）', () => {
    const cannon = registry.functionals.get('cannon')!;
    const v = cannon.visual!;
    const rightLocal = v.anchor.x + v.size.width / 2;
    expect(rightLocal).toBeCloseTo(40, 6); // 16 + 24
    const muzzleLocal = cannon.collider.offset.x + cannon.collider.width! / 2;
    expect(rightLocal).toBeCloseTo(muzzleLocal, 6); // sprite 炮口 = collider 炮口
  });

  it('3. hammer visual 本地跨距 0 附近 = Revolute pivot（柄根位于挂点）', () => {
    const hammer = registry.functionals.get('hammer')!;
    const v = hammer.visual!;
    const leftLocal = v.anchor.x - v.size.width / 2;
    // 柄根（sprite 左端）应接近 local 0（= Revolute pivot = 挂点）
    expect(Math.abs(leftLocal)).toBeLessThan(5); // [-3, 71] → left = -3
    expect(leftLocal).toBeCloseTo(-3, 6);
  });

  it('4. pushRod visual 本地跨距覆盖 collider 前缘（推板 = pusher plate 略超）', () => {
    const pushRod = registry.functionals.get('pushRod')!;
    const v = pushRod.visual!;
    const leftLocal = v.anchor.x - v.size.width / 2; // 基座近 chassis 侧
    const rightLocal = v.anchor.x + v.size.width / 2; // 推板前端
    const colliderFront = pushRod.collider.offset.x + pushRod.collider.width! / 2;
    // 基座贴近挂点（local ≈ 0 / 锚点侧）
    expect(leftLocal).toBeLessThanOrEqual(0);
    // 推板覆盖 collider 前缘（plate 应到达/略超 collider 前端：pusher plate 设计）
    expect(rightLocal).toBeGreaterThanOrEqual(colliderFront);
    expect(rightLocal - colliderFront).toBeLessThan(30); // 推板伸出 collider 不超过 30px
  });

  it('5. watermelon/banana 4 槽（front/frontMass/top/rear）editableSlots 真实返回', () => {
    expect(editableSlots(registry.bodies.get('watermelonBody')!)).toEqual([
      'front',
      'frontMass',
      'top',
      'rear',
    ]);
    expect(editableSlots(registry.bodies.get('bananaBody')!)).toEqual([
      'front',
      'frontMass',
      'top',
      'rear',
    ]);
  });

  it('6. W2-SIL-1 样板 Draft（watermelon + banana，各装 pushRod+cannon+hammer）→ valid', () => {
    const a = buildSnapshotFromDraft(silDraft('watermelonBody'), registry, 'silA');
    const b = buildSnapshotFromDraft(silDraft('bananaBody'), registry, 'silB');
    // 能量：20 + 30 + 25 = 75；watermelon 110 / banana 90 均够
    const va = validateSnapshot(a, registry);
    const vb = validateSnapshot(b, registry);
    expect(va.valid).toBe(true);
    expect(vb.valid).toBe(true);
    expect(va.errors).toEqual([]);
    expect(vb.errors).toEqual([]);
  });

  it('7. facing=-1 + mirrorWithFacing：watermelon/banana body visual 镜像路径无异常', () => {
    const wm = registry.bodies.get('watermelonBody')!;
    const bn = registry.bodies.get('bananaBody')!;
    const physPos = { x: 800, y: 600 };
    const physAngle = 0;
    const v1 = visualWorldTransform(wm.visual!, 1, physPos, physAngle);
    const v2 = visualWorldTransform(wm.visual!, -1, physPos, physAngle);
    expect(v1.position).toBeDefined();
    expect(v2.position).toBeDefined();
    expect(v2.mirror).toBe(true);
    // banana 同样：anchor.x=0（对称），facing=-1 → mirror=true
    const v3 = visualWorldTransform(bn.visual!, -1, physPos, physAngle);
    expect(v3.mirror).toBe(true);
  });
});
