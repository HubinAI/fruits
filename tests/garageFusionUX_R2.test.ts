/**
 * F-GARAGE-FUSION-UX-R2｜背包合成交互重构 —— T1–T28 验收矩阵（headless）。
 *
 * 取代 garageInventoryFusionR1.test.ts（旧交互「点卡即 5 合 1 同 defId」已被分类混合随机规则替代）。
 *
 * 测试分层：
 *  - A｜core 规则（T1–T6 / T11–T13 / T17）：fuseCategoryMaterials / autoPickFusionMaterials /
 *    fusionCategory* 纯函数（不依赖 UI）；
 *  - B｜host 交互（T7–T10 / T14–T16 / T18–T20）：真实 CanvasPlayerUIHost 派发（stub canvas +
 *    捕获指针 + fillText 录制），材料槽状态机（放入/移除/自动放入/合成/结果卡/切换清理）；
 *  - C｜可达性/布局（T21–T25）：分类全量可达、网格与底栏不重叠、多视口渲染、DPR 命中一致；
 *  - D｜构建隔离与存档兼容（T26–T28）：正式构建无测试按钮、旧 v1 存档可迁移、旧 2★ 保留。
 *
 * host 规则契约（与 Queue §二/§三/§五/§六 一致）：分类随机混合 5→1；材料=同分类同星未装备；
 * 自动放入 = 未装备→当前星→重复多→defId 序（确定性）；结果卡页内完成 ≥0.9s 可跳过；
 * 材料槽跨分类/返回车库清空；默认不消耗。动作桩忠实模拟 runtime（fuseCategoryMaterials +
 * 注入 rng），断言库存/文本/命中区，不断言像素。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import {
  getCount,
  getInventory,
  saveInventory,
  loadInventoryRaw,
  OFFICIAL_PARTS,
  OFFICIAL_MOVEMENTS,
  MAX_STAR,
  equippedCount,
  fusionCategoryOf,
  fusionCategoryPartIds,
  fusionCategoryAvailable,
  canFuseCategory,
  autoPickFusionMaterials,
  fuseCategoryMaterials,
  type PartInventory,
} from '../src/core/partInventory';
import { OFFICIAL_BODIES } from '../src/core/bodyOwnership';
import type { PlayerUIState, PlayerUIActions } from '../src/ui/playerUI';
import type { BuildDraft } from '../src/lab/buildEditorModel';

const INV_V1 = 'strongfruit.ownedParts.v1';

/** 内存版 localStorage（node 无原生；同既有库存测试） */
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
afterEach(() => {
  bindPlatformCore(createWebCore());
});

// ───────────────────────────── 基础 Build / 库存辅助 ─────────────────────────────

/** 空 Build：无任何功能件/轮组装备（equippedCount 恒 0；装备保护用例另行构造） */
function emptyDraft(): BuildDraft {
  return { bodyDefId: 'boxBody', rearRadius: 20, frontRadius: 20, functionalSelections: {} };
}

/** 指定功能件装备在 frontMass 的 Build（供「已装备保护」用例） */
function equipDraft(defId: string): BuildDraft {
  return {
    bodyDefId: 'boxBody',
    rearRadius: 20,
    frontRadius: 20,
    functionalSelections: { frontMass: defId },
    functionalStars: { frontMass: 1 },
  };
}

/** 装备一件 1★ cannon 的 Build（T4/T15 等已装备保护用例） */
function cannonEquipDraft(): BuildDraft {
  return equipDraft('cannon');
}

/** 无武器装备的完整 starter draft（host state 用；避免 starter 默认占用 1 件 1★ cannon） */
function noWeaponsDraft(): BuildDraft {
  const d = makeStarterDraft('watermelonBody', registry);
  d.functionalSelections = {};
  return d;
}

/** 确定性 rng：恒命中 pool 中 product 的下标（core 注入 / UI 动作桩用） */
function rngFor(product: string, cat: 'combat' | 'movement'): () => number {
  const pool = fusionCategoryPartIds(cat);
  const idx = pool.indexOf(product);
  return () => (idx < 0 ? 0 : idx / pool.length);
}

function allPartKeys(inv: PartInventory): string[] {
  return Object.keys(inv).filter((k) => k && k !== '__v' && typeof inv[k] === 'object');
}
function countOne(inv: PartInventory): number {
  return allPartKeys(inv).reduce((s, k) => s + getCount(inv, k, 1), 0);
}
function countTwo(inv: PartInventory): number {
  return allPartKeys(inv).reduce((s, k) => s + getCount(inv, k, 2), 0);
}

/** 库存可比较快照（不含 __v 信封） */
function snap(inv: PartInventory): string {
  const out: Record<string, unknown> = {};
  for (const k of allPartKeys(inv).sort()) out[k] = inv[k];
  return JSON.stringify(out);
}

/** 只含目标部件的库存（其余正式键归零；走 saveInventory→normalize 口径） */
function seedInventory(entries: Record<string, { one?: number; two?: number }>): void {
  const inv = getInventory();
  for (const k of allPartKeys(inv)) {
    inv[k].one = 0;
    inv[k].two = 0;
  }
  for (const [defId, v] of Object.entries(entries)) {
    if (!inv[defId]) inv[defId] = { one: 0, two: 0 };
    inv[defId].one = v.one ?? 0;
    inv[defId].two = v.two ?? 0;
  }
  saveInventory(inv);
}

// ───────────────────────────── host 环境（headless） ─────────────────────────────

interface Area {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface HostEnv {
  host: CanvasPlayerUIHost;
  areas: () => Area[];
  hasHit: (id: string) => boolean;
  click: (id: string) => void;
  /** 不重新取命中区、同一坐标背靠背两次真实指针（双击/多击路径） */
  doubleTap: (id: string) => void;
  texts: () => string[];
  clearTexts: () => void;
  render: (over?: Partial<PlayerUIState>) => void;
  /** Home→装配台→背包（默认战斗分类）真实导航链 */
  gotoBackpack: (over?: Partial<PlayerUIState>) => void;
  /** 翻页定位卡片并连续点 n 次（放入 n 件材料） */
  fillCard: (defId: string, n: number, over?: Partial<PlayerUIState>) => void;
}

/** 录制 fillText 的 stub ctx */
function makeRecCtx(): { ctx: CanvasRenderingContext2D; texts: string[] } {
  const texts: string[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, prop) => {
      if (prop === 'fillText') return (s: string): void => void texts.push(String(s));
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop: () => {} });
      return () => ({ width: 0 });
    },
    set: () => true,
  });
  return { ctx, texts };
}

function backpackState(over: Partial<PlayerUIState> = {}): PlayerUIState {
  return {
    uiMode: 'build',
    battleState: 'editing',
    playerPhase: 'garage',
    draft: noWeaponsDraft(),
    draftValid: true,
    blockReason: null,
    garageSelected: null,
    inventory: getInventory(),
    progress: { coin: 0, rating: 0 },
    onboarding: 'done',
    resetDevVisible: false,
    opponent: null,
    matchBarHidden: true,
    result: null,
    reward: null,
    economy: null,
    resultOnboardingVisible: false,
    rewardAdAvailable: false,
    rewardAdClaimed: false,
    readyOverlayVisible: false,
    ...over,
  };
}

/**
 * headless host 环境：真实 bindPointer → 真实 hit-test → 真实 dispatch；
 * onFuseCategory 动作桩忠实模拟 runtime——fuseCategoryMaterials(库存, 材料, 分类, draft, rng)，
 * 成功后 pushUI 重推（库存刷新）；combat rng 钉 cannon（确定性）。
 */
function makeEnv(vp: { w: number; h: number }, dpr = 1): HostEnv {
  let captured: ((x: number, y: number) => void) | null = null;
  const { ctx, texts } = makeRecCtx();
  const core = createWebCore();
  bindPlatformCore({
    ...core,
    createViewport: () => ({
      surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: dpr, now: () => 0 }),
      onResize: () => {},
      safeInsets: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
    }),
    input: {
      bindClick: () => {},
      bindPointer: (_t: EventTarget, h: (x: number, y: number) => void) => {
        captured = h;
      },
    },
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  // 微信式物理画布（backing = 逻辑 × dpr）；mountCanvas 平台中立挂载
  const canvas = {
    getContext: () => ctx,
    width: vp.w * dpr,
    height: vp.h * dpr,
    style: undefined,
  } as unknown as HTMLCanvasElement;
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas();
  let lastDraft: BuildDraft | null = null;
  let lastOver: Partial<PlayerUIState> = {};
  function pushUI(over: Partial<PlayerUIState>): void {
    const state = backpackState(over);
    lastDraft = state.draft ?? null;
    host.render(state);
  }
  const actions: PlayerUIActions = {
    onFuseCategory: (materials: string[], category: 'combat' | 'movement', star = 1) => {
      const cur = getInventory();
      const rng = category === 'combat' ? rngFor('cannon', 'combat') : undefined;
      const res = fuseCategoryMaterials(cur, materials, category, lastDraft, star, rng);
      if (res) pushUI(lastOver); // 忠实模拟 runtime：合成成功 → pushUI（fresh inventory）
      return res ? { product: res.product, star: res.star } : null;
    },
  } as unknown as PlayerUIActions;
  host.setActions(actions);

  function render(over: Partial<PlayerUIState> = {}): void {
    lastOver = over;
    pushUI(over);
  }
  function areas(): Area[] {
    return host.getHitAreasForTest() as unknown as Area[];
  }
  function hit(id: string): Area | undefined {
    return areas().find((a) => a.id === id);
  }
  function click(id: string): void {
    const a = hit(id);
    if (!a) throw new Error('应存在命中区 ' + id);
    if (!captured) throw new Error('未捕获指针');
    captured(a.x + a.w / 2, a.y + a.h / 2);
  }
  function doubleTap(id: string): void {
    const a = hit(id);
    if (!a) throw new Error('应存在命中区 ' + id);
    if (!captured) throw new Error('未捕获指针');
    const x = a.x + a.w / 2;
    const y = a.y + a.h / 2;
    captured(x, y);
    captured(x, y);
  }
  function gotoBackpack(over: Partial<PlayerUIState> = {}): void {
    render(over);
    if (hit('home-garage')) click('home-garage'); // Home → 装配台
    if (!hit('bfilter:combat')) click('nav:backpack'); // 装配台顶栏 → 背包页
  }
  function fillCard(defId: string, n: number, over: Partial<PlayerUIState> = {}): void {
    gotoBackpack(over);
    let guard = 0;
    while (!hit('backpack-select:' + defId)) {
      if (guard++ > 12) throw new Error('未找到卡片 ' + defId);
      const nx = hit('backpack-page-next');
      if (!nx) throw new Error('翻页未找到卡片 ' + defId);
      click('backpack-page-next');
    }
    for (let i = 0; i < n; i++) click('backpack-select:' + defId);
  }
  return {
    host,
    areas,
    hasHit: (id) => !!hit(id),
    click,
    doubleTap,
    texts: () => texts.slice(),
    clearTexts: () => void (texts.length = 0),
    render,
    gotoBackpack,
    fillCard,
  };
}

// ───────────────────────────── 文本/状态解析 ─────────────────────────────

function barCount(env: HostEnv): number {
  // F-GARAGE-FUSION-FEEDBACK-LAYOUT-R2.1：底栏 N/5 由固定文本 `${n}/5` 表达（旧卡内「已选 X/5」文案已拆分）
  for (const t of env.texts()) {
    const m = /^([0-5])\/5$/.exec(t);
    if (m) return +m[1];
  }
  return -1;
}

function findText(env: HostEnv, re: RegExp): string | null {
  for (const t of env.texts()) if (re.test(t)) return t;
  return null;
}

/** 页面可达 defId 全集（真实点「下一页」翻页） */
function collectIds(env: HostEnv, filter: 'combat' | 'movement' | 'body'): string[] {
  env.gotoBackpack();
  if (env.hasHit('bfilter:' + filter)) env.click('bfilter:' + filter);
  const ids = new Set<string>();
  const grab = (): void => {
    for (const a of env.areas()) if (a.id.startsWith('backpack-select:')) ids.add(a.id.slice('backpack-select:'.length));
  };
  grab();
  let guard = 0;
  while (env.hasHit('backpack-page-next') && guard++ < 12) {
    env.click('backpack-page-next');
    grab();
  }
  return [...ids];
}

function rectsOverlap(a: Area, b: Area): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

// ═══════════════════════════ A｜core 正式规则 ═══════════════════════════
describe('F-GARAGE-FUSION-UX-R2 A｜core 分类混合合成规则（T1-T6/T11-T13/T17）', () => {
  it('T1. 同分类混合 defId（cannon×3 + hammer×2）→ 产出 1 件同分类 2★（不要求同 defId）', () => {
    seedInventory({ cannon: { one: 3 }, hammer: { one: 2 } });
    const inv = getInventory();
    const res = fuseCategoryMaterials(inv, ['cannon', 'cannon', 'cannon', 'hammer', 'hammer'], 'combat', emptyDraft(), 1, rngFor('cannon', 'combat'));
    expect(res, '混合材料合成成功').not.toBeNull();
    expect(OFFICIAL_PARTS, '产物 ∈ 战斗 Registry').toContain(res!.product);
    expect(getCount(inv, 'cannon', 1), 'cannon 1★ -3').toBe(0);
    expect(getCount(inv, 'hammer', 1), 'hammer 1★ -2').toBe(0);
    expect(getCount(inv, res!.product, 2), '产物 2★ +1').toBe(1);
  });

  it('T2. 跨分类拒绝：战斗+移动混料 → null 且零变更；Body defId 无合成分类', () => {
    seedInventory({ cannon: { one: 4 }, smallWheel: { one: 1 } });
    const inv = getInventory();
    const before = snap(inv);
    const res = fuseCategoryMaterials(inv, ['cannon', 'cannon', 'cannon', 'cannon', 'smallWheel'], 'combat', emptyDraft(), 1);
    expect(res, '跨分类 → null').toBeNull();
    expect(snap(inv), '跨分类拒绝 → 零变更').toBe(before);
    expect(fusionCategoryOf('watermelonBody'), 'Body 不参与合成').toBeNull();
  });

  it('T3. 跨星级拒绝：star=0 / star=MAX_STAR / star=2（2★ 不可作材料升 3★）→ null 且零变更', () => {
    seedInventory({ cannon: { one: 5, two: 2 } });
    const inv = getInventory();
    const before = snap(inv);
    const m5 = ['cannon', 'cannon', 'cannon', 'cannon', 'cannon'];
    expect(fuseCategoryMaterials(inv, m5, 'combat', emptyDraft(), 0), 'star<1 拒绝').toBeNull();
    expect(fuseCategoryMaterials(inv, m5, 'combat', emptyDraft(), MAX_STAR), '满星不可再升').toBeNull();
    expect(fuseCategoryMaterials(inv, m5, 'combat', emptyDraft(), 2), '2★ 材料=满星 → null').toBeNull();
    expect(snap(inv), '全部拒绝 → 零变更').toBe(before);
  });

  it('T4. 仅未装备可作材料：装备 1 后 available=4 → 候选排除/不可合；拥有 6 装备 1 → 可合且装备不被消耗', () => {
    seedInventory({ cannon: { one: 5 } });
    const inv = getInventory();
    const draft = cannonEquipDraft();
    expect(equippedCount('cannon', 1, draft), '装备 1').toBe(1);
    expect(fusionCategoryAvailable(inv, 'combat', draft, 1), 'available = 5-1 = 4').toBe(4);
    expect(canFuseCategory(inv, 'combat', draft, 1).ok, 'available 4 → 不可合').toBe(false);
    const m5 = ['cannon', 'cannon', 'cannon', 'cannon', 'cannon'];
    expect(fuseCategoryMaterials(inv, m5, 'combat', draft, 1), '可用不足 → null').toBeNull();
    // 拥有 6 装备 1 → available 5 → 可合；装备中的 1 件不消耗
    inv.cannon = { one: 6, two: 0 };
    const res = fuseCategoryMaterials(inv, m5, 'combat', draft, 1, rngFor('cannon', 'combat'));
    expect(res, '可用 5 → 可合').not.toBeNull();
    expect(getCount(inv, 'cannon', 1), '消耗后剩 1（= 装备中的那件）').toBe(1);
  });

  it('T5. 自动放入恰好 5 件（可用 ≥5 → 恒 5；不足 → 返回全部可用）', () => {
    seedInventory({ cannon: { one: 3 }, hammer: { one: 2 }, spear: { one: 1 } });
    const inv = getInventory();
    expect(autoPickFusionMaterials(inv, 'combat', emptyDraft(), 1, 5), '可用 6 → 恰 5').toHaveLength(5);
    inv.cannon = { one: 2, two: 0 };
    expect(autoPickFusionMaterials(inv, 'combat', emptyDraft(), 1, 5), '可用 5 → 恰 5').toHaveLength(5);
    inv.cannon = { one: 1, two: 0 };
    expect(autoPickFusionMaterials(inv, 'combat', emptyDraft(), 1, 5), '可用 4 → 返回 4').toHaveLength(4);
  });

  it('T6. 自动放入稳定可复现：同库存两次一致；优先级=未装备→1★→重复多→defId 序', () => {
    seedInventory({ cannon: { one: 2 }, hammer: { one: 1 }, laser: { one: 3 }, machineGun: { one: 1 } });
    const inv = getInventory();
    const a1 = autoPickFusionMaterials(inv, 'combat', emptyDraft(), 1, 5);
    const a2 = autoPickFusionMaterials(inv, 'combat', emptyDraft(), 1, 5);
    expect(a2, '可复现').toEqual(a1);
    // 可用：laser 3 > cannon 2 > {hammer,machineGun} 1 → 前 5 = laser×3 + cannon×2
    expect(a1).toEqual(['laser', 'laser', 'laser', 'cannon', 'cannon']);
    // 全部 1 份时按 defId 字典序取前 5（同数量稳定序）
    seedInventory({
      cannon: { one: 1 },
      hammer: { one: 1 },
      machineGun: { one: 1 },
      saw: { one: 1 },
      laser: { one: 1 },
      spear: { one: 1 },
    });
    const inv2 = getInventory();
    const b = autoPickFusionMaterials(inv2, 'combat', emptyDraft(), 1, 5);
    expect(b.length).toBe(5);
    expect([...b].sort()).toEqual(['cannon', 'hammer', 'laser', 'machineGun', 'saw']);
  });

  it('T11. 产物只来自分类正式 Registry：扫描全部 pool 下标 → 产物 ∈ OFFICIAL_PARTS/MOVEMENTS', () => {
    seedInventory({ cannon: { one: 10 } });
    const poolC = fusionCategoryPartIds('combat');
    for (let i = 0; i < poolC.length; i++) {
      const invC = getInventory();
      const r = fuseCategoryMaterials(invC, ['cannon', 'cannon', 'cannon', 'cannon', 'cannon'], 'combat', emptyDraft(), 1, () => (i + 0.01) / poolC.length);
      expect(r, `pool idx ${i} 应产出`).not.toBeNull();
      expect(poolC, '战斗产物 ∈ OFFICIAL_PARTS').toContain(r!.product);
      expect(poolC.indexOf(r!.product), '产物下标 = floor(rng×len)').toBe(Math.min(poolC.length - 1, Math.floor(((i + 0.01) / poolC.length) * poolC.length)));
      saveInventory(getInventory()); // 复位库存快照外不额外动作（上一步已落盘消耗）→ 直接补回 5
      const cur = getInventory();
      cur.cannon.one = Math.max(5, cur.cannon.one + 5);
      saveInventory(cur);
    }
    seedInventory({ smallWheel: { one: 5 } });
    const invM = getInventory();
    const poolM = fusionCategoryPartIds('movement');
    const rm = fuseCategoryMaterials(invM, ['smallWheel', 'smallWheel', 'smallWheel', 'smallWheel', 'smallWheel'], 'movement', emptyDraft(), 1, () => 0);
    expect(rm, '移动合成成功').not.toBeNull();
    expect(poolM, '移动产物 ∈ OFFICIAL_MOVEMENTS').toContain(rm!.product);
  });

  it('T12. 注入 rng 决定产出：rng=0 → pool[0]；rng→1 → pool[last]；同 rng 可复现', () => {
    seedInventory({ cannon: { one: 5 } });
    const invA = getInventory();
    const ra = fuseCategoryMaterials(invA, ['cannon', 'cannon', 'cannon', 'cannon', 'cannon'], 'combat', emptyDraft(), 1, () => 0);
    expect(ra!.product, 'rng=0 → 首个 defId').toBe(OFFICIAL_PARTS[0]);
    seedInventory({ cannon: { one: 5 } });
    const invB = getInventory();
    const rb = fuseCategoryMaterials(invB, ['cannon', 'cannon', 'cannon', 'cannon', 'cannon'], 'combat', emptyDraft(), 1, () => 0.99999);
    expect(rb!.product, 'rng→1 → 末个 defId').toBe(OFFICIAL_PARTS[OFFICIAL_PARTS.length - 1]);
    seedInventory({ cannon: { one: 10 } });
    const invC = getInventory();
    const f = (): number => 0.5;
    const r1 = fuseCategoryMaterials(invC, ['cannon', 'cannon', 'cannon', 'cannon', 'cannon'], 'combat', emptyDraft(), 1, f);
    const r2 = fuseCategoryMaterials(invC, ['cannon', 'cannon', 'cannon', 'cannon', 'cannon'], 'combat', emptyDraft(), 1, f);
    expect(r1!.product).toBe(r2!.product);
  });

  it('T13. 原子：成功 = 1★ 总数 -5、2★ 总数 +1、单次落盘（loadInventoryRaw 读数一致）', () => {
    seedInventory({ cannon: { one: 3 }, hammer: { one: 2 } });
    const inv = getInventory();
    const before1 = countOne(inv);
    const before2 = countTwo(inv);
    const res = fuseCategoryMaterials(inv, ['cannon', 'cannon', 'cannon', 'hammer', 'hammer'], 'combat', emptyDraft(), 1, rngFor('cannon', 'combat'));
    expect(res).not.toBeNull();
    const persisted = loadInventoryRaw();
    expect(persisted, '已原子落盘').not.toBeNull();
    expect(countOne(persisted as PartInventory), '持久化 1★ 总数 -5').toBe(before1 - 5);
    expect(countTwo(persisted as PartInventory), '持久化 2★ 总数 +1').toBe(before2 + 1);
    expect(countTwo(persisted as PartInventory)).toBe(1);
  });

  it('T17. MAX_STAR 后不能作为产出升级（满星合成被 core 拒绝；MAX_STAR 钉死 2）', () => {
    seedInventory({ cannon: { one: 5, two: 1 } });
    const inv = getInventory();
    const before = snap(inv);
    const m5 = ['cannon', 'cannon', 'cannon', 'cannon', 'cannon'];
    expect(fuseCategoryMaterials(inv, m5, 'combat', emptyDraft(), MAX_STAR), 'star=MAX_STAR → null').toBeNull();
    expect(fuseCategoryMaterials(inv, m5, 'combat', emptyDraft(), 2), '2★=满星不可升级').toBeNull();
    expect(snap(inv)).toBe(before);
    expect(MAX_STAR).toBe(2);
  });
});

// ═══════════════════════════ B｜host 交互 ═══════════════════════════
describe('F-GARAGE-FUSION-UX-R2 B｜host 材料槽交互（T7-T10/T14-T16/T18-T20）', () => {
  it('T7. 手动放入/移除/替换：点卡 5 次满槽 → 点材料槽移除 1 → 再点卡片补回（材料零消耗）', () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv({ w: 844, h: 390 });
    env.fillCard('cannon', 5);
    env.clearTexts();
    env.render();
    expect(barCount(env), '5 件放入 → 已选 5/5').toBe(5);
    env.click('fusion-slot:2'); // 移除第 3 槽
    env.clearTexts();
    env.render();
    expect(barCount(env), '移除 1 → 已选 4/5').toBe(4);
    expect(getCount(getInventory(), 'cannon', 1), '移除不消耗材料').toBe(5);
    env.click('backpack-select:cannon'); // 再点卡片补回
    env.clearTexts();
    env.render();
    expect(barCount(env), '补回 → 已选 5/5').toBe(5);
  });

  it('T8. 材料不足：可用 4 → 状态行「还差 1 件1★部件」且 合成/自动放入 不可点', () => {
    seedInventory({ cannon: { one: 4 } });
    const env = makeEnv({ w: 844, h: 390 });
    env.gotoBackpack();
    env.clearTexts();
    env.render();
    expect(findText(env, /^还差 1 件1★部件/), '状态行提示还差数').not.toBeNull();
    expect(env.hasHit('backpack-fuse'), '不足 5 → 合成不可点').toBe(false);
    expect(env.hasHit('fusion-auto'), '不足 5 → 自动放入不可点').toBe(false);
  });

  it('T9. 满 5 件 → 主按钮「合成」注册命中（可点击执行）', () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv({ w: 844, h: 390 });
    env.fillCard('cannon', 5);
    expect(env.hasHit('backpack-fuse'), '满 5 → 合成可点').toBe(true);
  });

  it('T10. 多击只执行一次：同坐标背靠背两次点击 → 恰好一次合成', () => {
    seedInventory({ cannon: { one: 10 } });
    const env = makeEnv({ w: 844, h: 390 });
    env.fillCard('cannon', 5);
    env.doubleTap('backpack-fuse');
    expect(getCount(getInventory(), 'cannon', 1), '只消耗一次 5（10-5）').toBe(5);
    expect(countTwo(getInventory()), '只产出一次 2★').toBe(1);
  });

  it('T14. reload 后合成结果保持（localStorage 持久化；重开 host 重读一致）', () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv({ w: 844, h: 390 });
    env.fillCard('cannon', 5);
    env.click('backpack-fuse');
    const after = loadInventoryRaw() as PartInventory;
    expect(getCount(after, 'cannon', 1), '1★ -5 已落盘').toBe(0);
    expect(countTwo(after), '2★ +1 已落盘').toBe(1);
    // 模拟重进：新 host 同 localStorage
    const env2 = makeEnv({ w: 844, h: 390 });
    env2.gotoBackpack();
    env2.clearTexts();
    env2.render();
    const reloaded = getInventory();
    expect(getCount(reloaded, 'cannon', 1), 'reload 后 1★ 仍为 0').toBe(0);
    expect(countTwo(reloaded), 'reload 后 2★ 保持').toBe(1);
  });

  it('T15. 合成不改 Build（draft 对象零变更；装备的 1 件不被消耗）', () => {
    seedInventory({ cannon: { one: 6 } });
    const env = makeEnv({ w: 844, h: 390 });
    const d2 = cannonEquipDraft(); // 装备 1 件 1★ cannon → 可用 5
    const beforeDraft = JSON.stringify(d2);
    env.fillCard('cannon', 5, { draft: d2 });
    env.click('backpack-fuse');
    expect(JSON.stringify(d2), '装备中 Build 未被合成修改').toBe(beforeDraft);
    expect(getCount(getInventory(), 'cannon', 1), '装备的 1 件未被消耗（6-5）').toBe(1);
  });

  it('T16. 车身分类无任何合成入口（无 自动放入/合成/材料槽/测试材料；有「车身不参与合成」提示）', () => {
    const env = makeEnv({ w: 844, h: 390 });
    env.gotoBackpack();
    env.click('bfilter:body');
    const ids = env.areas().map((a) => a.id);
    expect(ids, '无合成按钮').not.toContain('backpack-fuse');
    expect(ids, '无自动放入').not.toContain('fusion-auto');
    expect(ids.filter((i) => i.startsWith('fusion-slot:')), '无材料槽').toHaveLength(0);
    expect(ids, '无测试材料按钮（车身）').not.toContain('backpack-test-material');
    env.clearTexts();
    env.render();
    expect(findText(env, /车身不参与合成/), '车身提示').not.toBeNull();
  });

  it('T18. 切换分类清空材料槽（未确认选择不跨分类保留；库存零变更）', () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv({ w: 844, h: 390 });
    env.fillCard('cannon', 3);
    env.clearTexts();
    env.render();
    expect(barCount(env), '已放 3 件').toBe(3);
    env.click('bfilter:movement'); // 切分类 → 槽清空
    env.clearTexts();
    env.render();
    expect(barCount(env), '切分类 → 已选 0/5').toBe(0);
    expect(getCount(getInventory(), 'cannon', 1), '清空不消耗材料').toBe(5);
    env.click('bfilter:combat'); // 切回 → 仍为空（不跨分类恢复）
    env.clearTexts();
    env.render();
    expect(barCount(env), '切回战斗仍为空').toBe(0);
  });

  it('T19. 返回车库清空未确认材料槽（再进背包不残留；库存零变更）', () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv({ w: 844, h: 390 });
    env.fillCard('cannon', 4);
    env.clearTexts();
    env.render();
    expect(barCount(env), '已放 4 件').toBe(4);
    env.click('nav:garage'); // ‹ 返回车库
    expect(env.hasHit('garage-cat:body'), '回到装配台').toBe(true);
    env.click('nav:backpack'); // 再进背包 → 槽空
    env.clearTexts();
    env.render();
    expect(barCount(env), '返回后再进 → 已选 0/5').toBe(0);
    expect(getCount(getInventory(), 'cannon', 1), '库存零变更').toBe(5);
  });

  it('T20. Result-adjust 上下文保持：战败→调整配置→背包→返回车库，仍显示「完成并再战」', () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv({ w: 844, h: 390 });
    env.render({ battleState: 'ended' }); // 结算态（无 result → 不弹 Modal）
    env.render({ draft: noWeaponsDraft() }); // ended→garage editing → garageFromResult 置位
    expect(env.hasHit('garage-retry'), 'Result-adjust → 装配台含「完成并再战」').toBe(true);
    env.fillCard('cannon', 5, { draft: noWeaponsDraft() });
    env.click('nav:garage');
    expect(env.hasHit('garage-retry'), '背包返回后 Result-adjust 上下文保留').toBe(true);
  });
});

// ═══════════════════════════ C｜可达性 / 布局 / DPR ═══════════════════════════
describe('F-GARAGE-FUSION-UX-R2 C｜可达性 / 布局 / DPR（T21-T25）', () => {
  it('T21. 战斗分类 11 个正式部件全部可达（真实翻页，无屏外隐藏卡）', () => {
    const env = makeEnv({ w: 844, h: 390 });
    const ids = collectIds(env, 'combat');
    expect(ids.length).toBe(11);
    expect([...ids].sort()).toEqual([...OFFICIAL_PARTS].sort());
  });

  it('T22. 移动分类 3 项 / 车身分类 8 项全部可达', () => {
    const env = makeEnv({ w: 844, h: 390 });
    const mv = collectIds(env, 'movement');
    expect(mv.length).toBe(3);
    expect([...mv].sort()).toEqual([...OFFICIAL_MOVEMENTS].sort());
    const bd = collectIds(env, 'body');
    expect(bd.length).toBe(8);
    expect([...bd].sort()).toEqual([...OFFICIAL_BODIES].sort());
  });

  it('T23. 卡片网格与底部合成栏不重叠（卡片底缘 ≤ 合成栏顶缘）', () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv({ w: 844, h: 390 });
    env.fillCard('cannon', 1);
    const cards = env.areas().filter((a) => a.id.startsWith('backpack-select:'));
    const barIds = ['fusion-auto', 'backpack-fuse', 'fusion-slot:0', 'fusion-slot:1', 'fusion-slot:2', 'fusion-slot:3', 'fusion-slot:4'];
    const barRects = env.areas().filter((a) => barIds.includes(a.id));
    expect(cards.length, '有卡片').toBeGreaterThan(0);
    expect(barRects.length, '合成栏元素在位').toBeGreaterThan(0);
    const barTop = Math.min(...barRects.map((a) => a.y));
    for (const c of cards) {
      expect(c.y + c.h, `卡片 ${c.id} 底缘不越过合成栏`).toBeLessThanOrEqual(barTop + 1);
      for (const b of barRects) expect(rectsOverlap(c, b), `卡片 ${c.id} 与 ${b.id} 不重叠`).toBe(false);
    }
  });

  it('T24. 三种布局 420×210 / 844×390 / 1280×592：渲染不抛 + 返回/三分类/满 5 合成/结果卡可走通', async () => {
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    for (const vp of [{ w: 420, h: 210 }, { w: 844, h: 390 }, { w: 1280, h: 592 }]) {
      seedInventory({ cannon: { one: 5 } });
      const env = makeEnv(vp);
      expect(() => env.render(), `${vp.w}×${vp.h} 渲染不抛`).not.toThrow();
      env.gotoBackpack();
      expect(env.hasHit('nav:garage'), `${vp.w}×${vp.h} 返回入口在位`).toBe(true);
      expect(
        env.hasHit('bfilter:combat') && env.hasHit('bfilter:movement') && env.hasHit('bfilter:body'),
        `${vp.w}×${vp.h} 三分类在位`,
      ).toBe(true);
      env.fillCard('cannon', 5);
      expect(env.hasHit('backpack-fuse'), `${vp.w}×${vp.h} 满 5 合成可点`).toBe(true);
      env.click('backpack-fuse');
      // F-GARAGE-FUSION-FEEDBACK-LAYOUT-R2.1：合成经「合成中…」瞬时态（~260ms）后弹结果卡
      await sleep(340);
      env.clearTexts();
      env.render();
      expect(findText(env, /合成成功/), `${vp.w}×${vp.h} 结果卡出现`).not.toBeNull();
      expect(countTwo(getInventory()), `${vp.w}×${vp.h} 2★ 落盘`).toBe(1);
    }
  });

  it('T25. DPR1 / DPR3 命中一致：同命中区逻辑几何一致；同中心点击满 5 → 合成可点（无错位）', () => {
    seedInventory({ cannon: { one: 10 } });
    const e1 = makeEnv({ w: 844, h: 390 }, 1);
    const e3 = makeEnv({ w: 844, h: 390 }, 3);
    e1.gotoBackpack();
    e3.gotoBackpack();
    const c1 = e1.areas().find((a) => a.id === 'backpack-select:cannon');
    const c3 = e3.areas().find((a) => a.id === 'backpack-select:cannon');
    expect(c1, 'DPR1 有 cannon 卡').toBeTruthy();
    expect(c3, 'DPR3 有 cannon 卡').toBeTruthy();
    expect(c3!.x, 'DPR3 卡片逻辑 x 与 DPR1 一致').toBe(c1!.x);
    expect(c3!.y, 'DPR3 卡片逻辑 y 与 DPR1 一致').toBe(c1!.y);
    expect(c3!.w, 'DPR3 卡片逻辑 w 与 DPR1 一致').toBe(c1!.w);
    expect(c3!.h, 'DPR3 卡片逻辑 h 与 DPR1 一致').toBe(c1!.h);
    // DPR3 满 5 → 合成可点（命中不漂移）
    for (let i = 0; i < 5; i++) e3.click('backpack-select:cannon');
    expect(e3.hasHit('backpack-fuse'), 'DPR3 满 5 → 合成可点').toBe(true);
  });
});

// ═══════════════════════════ D｜构建隔离 / 存档兼容 ═══════════════════════════
describe('F-GARAGE-FUSION-UX-R2 D｜构建隔离与存档兼容（T26-T28）', () => {
  it('T26. 正式构建无测试按钮：headless（宏未定义 + resetDevVisible=false）不注册 backpack-test-material；源码门控引用 RC/E2E 宏', () => {
    const env = makeEnv({ w: 844, h: 390 });
    env.gotoBackpack();
    env.clearTexts();
    env.render();
    expect(env.areas().map((a) => a.id), '正式态无测试材料按钮').not.toContain('backpack-test-material');
    const uiSrc = readFileSync(new URL('../src/ui/canvasPlayerUIHost.ts', import.meta.url), 'utf8');
    expect(uiSrc).toContain("typeof __WX_DEBUG_GRANT__ !== 'undefined' && __WX_DEBUG_GRANT__");
    expect(uiSrc).toContain("typeof __E2E_INTERNAL_HANDLE__ !== 'undefined' && __E2E_INTERNAL_HANDLE__");
    expect(uiSrc).toContain('const tmShow = (rcGrantTM || e2eProbeTM || devResetTM)');
    expect(uiSrc).toContain("'backpack-test-material'");
    expect(uiSrc, '正式合成主按钮仍在').toContain("'backpack-fuse'");
  });

  it('T27. 旧 v1 存档兼容：owned-id 数组 → 迁移 1★=1；背包可渲染、可走合成', () => {
    (globalThis as unknown as { localStorage: MemStorage }).localStorage.setItem(INV_V1, JSON.stringify(['cannon', 'hammer', 'spear']));
    const inv = getInventory(); // loadInventoryRaw → v1 迁移
    expect(getCount(inv, 'cannon', 1), 'cannon 迁移为 1').toBe(1);
    expect(getCount(inv, 'hammer', 1), 'hammer 迁移为 1').toBe(1);
    expect(getCount(inv, 'spear', 1), 'spear 迁移为 1').toBe(1);
    // 背包渲染不抛 + 补足后可走合成
    seedInventory({ cannon: { one: 6 } });
    const env = makeEnv({ w: 844, h: 390 });
    env.fillCard('cannon', 5, { draft: noWeaponsDraft() });
    env.click('backpack-fuse');
    expect(countTwo(getInventory()), '迁移库存上合成正常').toBe(1);
  });

  it('T28. 旧 2★ 保留：拥有 1★×5 + 2★×1（cannon），合成只消耗 1★、产物钉 hammer——旧 2★ 不被触碰', () => {
    seedInventory({ cannon: { one: 5, two: 1 } });
    const inv = getInventory();
    expect(getCount(inv, 'cannon', 2), '旧 2★ cannon = 1').toBe(1);
    const res = fuseCategoryMaterials(inv, ['cannon', 'cannon', 'cannon', 'cannon', 'cannon'], 'combat', emptyDraft(), 1, rngFor('hammer', 'combat'));
    expect(res, '合成成功').not.toBeNull();
    expect(res!.product, '产物 = hammer（钉定 rng）').toBe('hammer');
    expect(getCount(inv, 'hammer', 2), '新 2★ hammer +1').toBe(1);
    expect(getCount(inv, 'cannon', 2), '旧 2★ cannon 保留 = 1').toBe(1);
    expect(getCount(inv, 'cannon', 1), '1★ cannon -5').toBe(0);
  });
});
