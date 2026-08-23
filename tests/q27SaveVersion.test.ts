/**
 * Q27｜V0.7 存档版本化与安全恢复 — targeted tests。
 * 覆盖验收 5 条：旧版本迁移 / 缺字段补默认 / 单字段损坏不丢全部 / Reset 恢复新账号 / 刷新稳定。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  CURRENT_SAVE_VERSION,
  STAMP_KEY,
  stampVersion,
  readJsonWithVersion,
  migrateLegacy,
  resetPlayerSave,
  RESET_KEYS,
} from '../src/core/saveVersion';
import {
  getProgress,
  saveProgress,
  loadProgressRaw,
  defaultProgress,
} from '../src/core/playerProgress';
import {
  getInventory,
  saveInventory,
  loadInventoryRaw,
  defaultInventory,
  STARTER_PARTS,
} from '../src/core/partInventory';
import { loadPlayerBuild } from '../src/core/buildPersistence';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import {
  loadOnboarding,
  saveOnboarding,
  resolveOnboardingStage,
} from '../src/core/onboarding';

/** 内存版 localStorage（node 环境无原生） */
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  get length(): number {
    return this.m.size;
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
});

const store = () => (globalThis as unknown as { localStorage: MemStorage }).localStorage;

describe('Q27 F｜SaveVersion 基座（纯函数）', () => {
  it('F1. stampVersion 给对象附加 __v 信封（当前版本）', () => {
    const out = stampVersion({ coin: 1, rating: 2 });
    expect(out.__v).toBe(CURRENT_SAVE_VERSION);
    expect(out.coin).toBe(1);
    expect(out.rating).toBe(2);
  });

  it('F2. readJsonWithVersion：null/坏 JSON → null；无信封→v0；有信封→读版本；数组→v0', () => {
    expect(readJsonWithVersion(null)).toBeNull();
    expect(readJsonWithVersion('{bad')).toBeNull();
    const a = readJsonWithVersion('{"coin":1}');
    expect(a).not.toBeNull();
    expect(a!.version).toBe(0);
    const b = readJsonWithVersion('{"coin":1,"__v":3}');
    expect(b!.version).toBe(3);
    const c = readJsonWithVersion('["cannon","laser"]');
    expect(c!.version).toBe(0);
    expect(Array.isArray(c!.obj)).toBe(true);
  });

  it('F3. migrateLegacy（inventory v0 数组 → 当前映射）', () => {
    const out = migrateLegacy('inventory', ['cannon', 'laser', 'saw'], 0) as Record<
      string,
      { one: number; two: number }
    >;
    expect(out.cannon).toEqual({ one: 1, two: 0 });
    expect(out.laser).toEqual({ one: 1, two: 0 });
    expect(out.saw).toEqual({ one: 1, two: 0 });
  });

  it('F4. migrateLegacy 已是最新版本直接返回（幂等）', () => {
    const obj = { coin: 5, rating: 6 };
    const once = migrateLegacy('progress', obj, CURRENT_SAVE_VERSION);
    const twice = migrateLegacy('progress', once, CURRENT_SAVE_VERSION);
    expect(twice).toBe(once);
  });
});

describe('Q27 A｜旧版本数据可迁移（验收 1）', () => {
  it('A1. progress 旧格式（无 __v）→ 仍可读取', () => {
    store().setItem('strongfruit.playerProgress.v1', JSON.stringify({ coin: 250, rating: 120 }));
    const p = loadProgressRaw();
    expect(p).not.toBeNull();
    expect(p!.coin).toBe(250);
    expect(p!.rating).toBe(120);
  });

  it('A2. inventory 旧版 owned-id 数组 → 迁移为 v2 数量库存', () => {
    store().setItem('strongfruit.ownedParts.v1', JSON.stringify(['cannon', 'laser', 'saw']));
    const inv = loadInventoryRaw()!;
    expect(inv.cannon.one).toBe(1);
    expect(inv.laser.one).toBe(1);
    expect(inv.saw.one).toBe(1);
    // 迁移后已写 v2（带 __v）
    const v2 = store().getItem('strongfruit.ownedParts.v2')!;
    expect(JSON.parse(v2).__v).toBe(CURRENT_SAVE_VERSION);
  });

  it('A3. build 旧格式（无 __v）→ 仍可读取合法 Build', () => {
    const draft = makeStarterDraft('watermelonBody', registry);
    store().setItem('strongfruit.playerBuild.v1', JSON.stringify(draft)); // 无 __v
    const loaded = loadPlayerBuild();
    expect(loaded).not.toBeNull();
    expect(loaded!.bodyDefId).toBe('watermelonBody');
  });

  it('A4. onboarding 旧格式（无 __v）→ 仍可读取', () => {
    store().setItem('strongfruit.onboarding.v1', JSON.stringify({ stage: 'done' }));
    expect(loadOnboarding()).toBe('done');
  });
});

describe('Q27 B｜缺字段安全补默认（验收 2）', () => {
  it('B1. progress 缺 coin → coin 补 0、rating 保留', () => {
    store().setItem('strongfruit.playerProgress.v1', JSON.stringify({ rating: 77 }));
    const p = loadProgressRaw()!;
    expect(p.coin).toBe(0);
    expect(p.rating).toBe(77);
  });

  it('B2. progress 缺 rating → rating 补 0、coin 保留', () => {
    store().setItem('strongfruit.playerProgress.v1', JSON.stringify({ coin: 321 }));
    const p = loadProgressRaw()!;
    expect(p.coin).toBe(321);
    expect(p.rating).toBe(0);
  });

  it('B3. inventory 缺某部件键 → 补 {one:0,two:0}、其它保留', () => {
    store().setItem('strongfruit.ownedParts.v2', JSON.stringify({ cannon: { one: 2, two: 1 } }));
    const inv = loadInventoryRaw()!;
    expect(inv.cannon.one).toBe(2);
    expect(inv.cannon.two).toBe(1);
    expect(inv.laser.one).toBe(0); // 缺失键补零
    expect(inv.laser.two).toBe(0);
  });
});

describe('Q27 C｜单字段损坏不丢全部数据（验收 3）', () => {
  it('C1. progress 单字段损坏（coin 为字符串）→ rating 保留、coin 回退默认', () => {
    store().setItem('strongfruit.playerProgress.v1', JSON.stringify({ coin: 'abc', rating: 50 }));
    const p = loadProgressRaw()!;
    expect(p.coin).toBe(0); // 损坏字段回退默认
    expect(p.rating).toBe(50); // 合法字段保留
  });

  it('C2. progress key 损坏 → 仅 progress 回退默认，inventory 不受影响', () => {
    store().setItem('strongfruit.playerProgress.v1', '{bad json');
    store().setItem(
      'strongfruit.ownedParts.v2',
      JSON.stringify(stampVersion({ cannon: { one: 3, two: 0 } })),
    );
    expect(getProgress().coin).toBe(0); // progress 损坏 → 默认
    expect(getProgress().rating).toBe(0);
    const inv = getInventory();
    expect(inv.cannon.one).toBe(3); // inventory 完好
  });

  it('C3. build 单槽损坏 → build 回退（null），progress/inventory 不丢', () => {
    const bad: ReturnType<typeof makeStarterDraft> = makeStarterDraft('watermelonBody', registry);
    (bad.functionalSelections as Record<string, string>).front = 'ghostPart'; // 未知部件
    store().setItem('strongfruit.playerBuild.v1', JSON.stringify(bad));
    store().setItem('strongfruit.playerProgress.v1', JSON.stringify({ coin: 111, rating: 22 }));
    expect(loadPlayerBuild()).toBeNull(); // 该 key 回退
    expect(getProgress().coin).toBe(111); // 其它 key 完整
    expect(getProgress().rating).toBe(22);
  });

  it('C4. inventory 损坏 → 仅 inventory 回退，progress 不丢', () => {
    store().setItem('strongfruit.ownedParts.v2', '{not json');
    store().setItem('strongfruit.playerProgress.v1', JSON.stringify({ coin: 200, rating: 30 }));
    expect(loadInventoryRaw()).toBeNull();
    expect(getProgress().coin).toBe(200);
  });
});

describe('Q27 D｜Reset 可恢复新账号状态（验收 4）', () => {
  it('D1. resetPlayerSave 清空后回到新账号状态', () => {
    // 预置「老玩家」状态
    saveProgress({ coin: 999, rating: 300 });
    saveInventory({ ...defaultInventory(), cannon: { one: 5, two: 3 } } as never);
    saveOnboarding('done');
    store().setItem('strongfruit.playerBuild.v1', JSON.stringify(makeStarterDraft('watermelonBody', registry)));
    // 模拟无关 key，验证 Reset 不波及
    store().setItem('strongfruit.unrelated.v1', 'keep-me');

    resetPlayerSave();

    // 玩家存档 key 已清空
    for (const k of RESET_KEYS) expect(store().getItem(k)).toBeNull();
    // 无关 key 不被波及
    expect(store().getItem('strongfruit.unrelated.v1')).toBe('keep-me');

    // 读回即新账号默认
    expect(getProgress()).toEqual(defaultProgress());
    const inv = getInventory();
    for (const s of STARTER_PARTS) expect(inv[s].one).toBe(1); // 默认 starter 库存
    // 引导回到 pending（全新账号）
    expect(resolveOnboardingStage()).toBe('pending');
  });

  it('D2. Reset 仅删除已知玩家 key（不误删其它 key）', () => {
    store().setItem('strongfruit.playerProgress.v1', JSON.stringify({ coin: 1, rating: 1 }));
    store().setItem('some.other.app.key', 'x');
    resetPlayerSave();
    expect(store().getItem('some.other.app.key')).toBe('x');
  });
});

describe('Q27 E｜刷新稳定（验收 5）', () => {
  it('E1. progress 写→读 roundtrip 一致，且带 __v 信封', () => {
    saveProgress({ coin: 123, rating: 45 });
    const raw = store().getItem('strongfruit.playerProgress.v1')!;
    expect(JSON.parse(raw)[STAMP_KEY]).toBe(CURRENT_SAVE_VERSION);
    const p = loadProgressRaw()!;
    expect(p.coin).toBe(123);
    expect(p.rating).toBe(45);
  });

  it('E2. inventory 写→读 roundtrip 一致，且带 __v 信封', () => {
    const inv = defaultInventory();
    inv.cannon.one = 7;
    saveInventory(inv);
    const raw = store().getItem('strongfruit.ownedParts.v2')!;
    expect(JSON.parse(raw)[STAMP_KEY]).toBe(CURRENT_SAVE_VERSION);
    const back = loadInventoryRaw()!;
    expect(back.cannon.one).toBe(7);
  });

  it('E3. 连续迁移幂等：v0 对象迁移两次 == 一次', () => {
    const legacy = { coin: 10, rating: 20 } as Record<string, unknown>;
    const once = migrateLegacy('progress', legacy, 0) as Record<string, unknown>;
    const twice = migrateLegacy('progress', once, CURRENT_SAVE_VERSION) as Record<string, unknown>;
    expect(twice).toEqual(once);
    expect(twice.coin).toBe(10);
    expect(twice.rating).toBe(20);
  });
});
