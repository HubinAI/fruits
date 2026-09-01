/**
 * F-CONTENT-PACK-REAL-UI-R1｜Fix 4 数据链路单元测试（站桩 Build / 卸轮）。
 *
 * 不启动浏览器/微信；纯函数级验证「双轮卸下形成站桩 Build」在 Build 校验与持久化两道门禁下
 * 端到端成立：
 *  - buildSnapshotFromDraft 跳过 EMPTY_SLOT 轮组（Fix 4b）→ Battle Snapshot 不含未知 Movement；
 *  - validateSnapshot 对「0 轮组 + 默认武器」判合法（start-battle 门禁通过，Fix 4 站桩 Build 可开战）；
 *  - buildPersistence 持久化轮组 EMPTY_SLOT（Fix 4c）→ 重载仍识别站桩 Build。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registry } from '../src/core/content';
import { makeStarterDraft, buildSnapshotFromDraft, EMPTY_SLOT } from '../src/lab/buildEditorModel';
import { validateSnapshot } from '../src/core/buildValidator';
import { loadPlayerBuild, savePlayerBuild } from '../src/core/buildPersistence';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';

function bindMemStorage(): { mem: Map<string, string> } {
  const mem = new Map<string, string>();
  bindPlatformCore({
    ...createWebCore(),
    storage: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
    },
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  return { mem };
}

describe('F-CONTENT-PACK-REAL-UI-R1｜Fix 4 站桩 Build 数据链路', () => {
  beforeEach(() => {
    bindMemStorage();
  });
  afterEach(() => {
    bindPlatformCore(createWebCore());
  });

  it('T-F4a/b：双轮卸下 → BuildSnapshot 不含轮组且校验合法（可开战）', () => {
    const d = makeStarterDraft('watermelonBody', registry);
    // 模拟 Fix 4a runtime 守卫放行后的卸轮结果
    d.rearWheelDefId = EMPTY_SLOT;
    d.frontWheelDefId = EMPTY_SLOT;

    const snap = buildSnapshotFromDraft(d, registry, 'a');
    // Fix 4b：EMPTY_SLOT 轮组不进 Snapshot（否则 validateSnapshot 报「未知 Movement」）
    expect(snap.movements.length, '双轮卸下后 movement 安装数为 0').toBe(0);

    const res = validateSnapshot(snap, registry);
    expect(res.valid, `站桩 Build 校验合法（errors=${JSON.stringify(res.errors)}）`).toBe(true);
  });

  it('T-F4c：卸轮 Build 持久化轮组 EMPTY_SLOT，重载仍识别', () => {
    const d = makeStarterDraft('watermelonBody', registry);
    d.rearWheelDefId = EMPTY_SLOT;
    d.frontWheelDefId = EMPTY_SLOT;

    savePlayerBuild(d);
    const loaded = loadPlayerBuild();
    expect(loaded, '重载 Build 非 null（isBuildDraftShape 接受 EMPTY_SLOT 轮组）').not.toBeNull();
    expect(loaded?.rearWheelDefId, 'rear 仍为 EMPTY_SLOT').toBe(EMPTY_SLOT);
    expect(loaded?.frontWheelDefId, 'front 仍为 EMPTY_SLOT').toBe(EMPTY_SLOT);
  });

  it('T-F4c 反向：单轮卸下（仅后轮）持久化仍合法且可重载', () => {
    const d = makeStarterDraft('watermelonBody', registry);
    d.rearWheelDefId = EMPTY_SLOT; // 仅卸后轮，前轮保持默认 wheelStd

    const snap = buildSnapshotFromDraft(d, registry, 'a');
    expect(snap.movements.length, '单轮卸下后仅剩 1 个轮组安装').toBe(1);
    expect(validateSnapshot(snap, registry).valid, '单轮卸下 Build 校验合法').toBe(true);

    savePlayerBuild(d);
    const loaded = loadPlayerBuild();
    expect(loaded?.rearWheelDefId).toBe(EMPTY_SLOT);
    expect(loaded?.frontWheelDefId ?? 'wheelStd', '前轮保持默认轮').toBe('wheelStd');
  });
});
