/**
 * F-GARAGE-FUSION-STAR-SELECTION-R3｜合成页星级选择与精确选材（方案C）——headless 红测→绿测。
 *
 * 目标：同一部件不同星级不再堆在同一张卡内；分类 → 星级选择 → 只展示当前星级 →
 * 明确选材 → 5合1。只改合成页星级筛选与选材交互（UI-only；core fuseCategoryMaterials
 * 已支持 star 参数，冻结不动）。
 *
 * 真实星级范围（T2）：MAX_STAR=2（partInventory.ts:343，fuseCategoryMaterials 拒绝 star≥2）
 * → 星级行动态生成：`1★ → 2★｜N件`（可合成）+ `2★｜满星`（查看态，无合成操作）。
 * 用户 Queue 中「2★→3★」等示例按真实范围映射为「1★→2★」。
 *
 * 覆盖（对应用户 T1-T25 映射）：
 *  RB1  星级行存在且来自真实配置范围（T2）
 *  RB2  默认星级 = 最低可合成星级（T16）
 *  RB3  1★ 视图卡片不显示 2★ 聚合（T1）
 *  RB4  满星查看态：无合成操作、显示当前星库存（T21）
 *  RB5  精确选材：slots 完整保存 (defId,star)；材料区显示「战斗1★材料 N/5」（T3/T4/T9）
 *  RB6  已有材料切分类/星级 → 页内轻确认；取消保持；确认清空并切换（T10/T11/T12）
 *  RB7  完全未拥有部件不出现在合成网格（T13）
 *  RB8  全部被装备占用 → 灰态原因「装备占用N」（T14）
 *  RB9  结果关闭后自动切产出星级 + 定位产出卡 + 新获得 + 库存正确（T17/T18/T19/T20）
 *
 * 手段：与 R2.2 同构（真实 CanvasPlayerUIHost + drawOps 录制 + 真实指针 + 库存持久化）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft, EMPTY_SLOT } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import {
  getInventory,
  saveInventory,
  fusionCategoryPartIds,
  fuseCategoryMaterials,
  MAX_STAR,
  type PartInventory,
} from '../src/core/partInventory';
import type { PlayerUIState, PlayerUIActions } from '../src/ui/playerUI';
import type { BuildDraft } from '../src/lab/buildEditorModel';

// ───────────────────── 基础辅助（与 R2.2 同构） ─────────────────────

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
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
});
afterEach(() => {
  bindPlatformCore(createWebCore());
});

function draftWith(over: Partial<BuildDraft> = {}): BuildDraft {
  const d = makeStarterDraft('watermelonBody', registry);
  d.functionalSelections = {};
  return Object.assign(d, over);
}
function allPartKeys(inv: PartInventory): string[] {
  return Object.keys(inv).filter((k) => k && k !== '__v' && typeof inv[k] === 'object');
}
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
function rngFor(product: string, cat: 'combat' | 'movement'): () => number {
  const pool = fusionCategoryPartIds(cat);
  const idx = pool.indexOf(product);
  return () => (idx < 0 ? 0 : idx / pool.length);
}

// ───────────────────── drawOps / fillText 录制 ctx（同 R2.2） ─────────────────────

interface Area {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
type Op = {
  k: 'text' | 'fillRect' | 'arc' | 'stroke' | 'fillStyle';
  s?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  style?: string;
  v?: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
};

function makeOpsCtx(): { ctx: CanvasRenderingContext2D; texts: string[]; ops: Op[] } {
  const texts: string[] = [];
  const ops: Op[] = [];
  const state: Record<string, unknown> = {};
  let px = 0;
  let py = 0;
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, prop) => {
      if (prop in state) return state[prop as string];
      if (prop === 'fillText')
        return (s: string, x: number, y: number): void => {
          texts.push(String(s));
          ops.push({ k: 'text', s: String(s), x, y, style: String(state.fillStyle ?? '') });
        };
      if (prop === 'fillRect')
        return (x: number, y: number, w: number, h: number): void => {
          ops.push({ k: 'fillRect', x, y, w, h, style: String(state.fillStyle ?? '') });
        };
      if (prop === 'arc') return () => {};
      if (prop === 'moveTo')
        return (x: number, y: number): void => {
          px = x;
          py = y;
        };
      if (prop === 'lineTo')
        return (x: number, y: number): void => {
          ops.push({ k: 'stroke', x1: px, y1: py, x2: x, y2: y, style: String(state.strokeStyle ?? '') });
          px = x;
          py = y;
        };
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient')
        return () => ({ addColorStop: () => {} });
      return () => ({ width: 0 });
    },
    set: (t, prop, v) => {
      (t as unknown as Record<string, unknown>)[prop as string] = v;
      if (prop === 'fillStyle') ops.push({ k: 'fillStyle', v: String(v) });
      state[prop as string] = v;
      return true;
    },
  });
  return { ctx, texts, ops };
}

function backpackState(over: Partial<PlayerUIState> = {}): PlayerUIState {
  return {
    uiMode: 'build',
    battleState: 'editing',
    playerPhase: 'garage',
    draft: draftWith(),
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

/** 内部状态探针（R3 目标形态：fusionStar 存在、fusionSlots 为 (defId,star) 对象数组） */
type FusionHostR3 = {
  fusionStar?: number;
  fusionSwitchAsk?: unknown;
  fusionResult: { product: string; token: number } | null;
  fusionPending: { until: number; token: number } | null;
  fusionJumpTo: string | null;
  fusionGlow: { defId: string; until: number } | null;
  fusionNew: { defId: string; until: number } | null;
  fusionSlots: Array<{ defId: string; star: number } | null>;
  nowMs: number;
};

interface HostEnv {
  host: CanvasPlayerUIHost;
  areas: () => Area[];
  hasHit: (id: string) => boolean;
  hit: (id: string) => Area | undefined;
  click: (id: string) => void;
  tapAt: (x: number, y: number) => void;
  texts: () => string[];
  ops: () => Op[];
  clearTexts: () => void;
  render: (over?: Partial<PlayerUIState>) => void;
  gotoBackpack: (over?: Partial<PlayerUIState>) => void;
  pickCards: (defId: string, n: number) => void;
  pageTo: (defId: string) => void;
}

function makeEnv(vp: { w: number; h: number }, dpr = 1, product = 'shotgun'): HostEnv {
  let captured: ((x: number, y: number) => void) | null = null;
  const { ctx, texts, ops } = makeOpsCtx();
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
  const canvas = {
    getContext: () => ctx,
    width: vp.w * dpr,
    height: vp.h * dpr,
    style: undefined,
  } as unknown as HTMLCanvasElement;
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas();
  let lastOver: Partial<PlayerUIState> = {};
  let lastDraft: BuildDraft | null = null;
  function pushUI(over: Partial<PlayerUIState>): void {
    const state = backpackState(over);
    lastDraft = state.draft ?? null;
    host.render(state);
  }
  const actions: PlayerUIActions = {
    onFuseCategory: (materials: string[], category: 'combat' | 'movement', star = 1) => {
      const cur = getInventory();
      const res = fuseCategoryMaterials(cur, materials, category, lastDraft, star, rngFor(product, category));
      if (res) pushUI(lastOver);
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
  function tapAt(x: number, y: number): void {
    if (!captured) throw new Error('未捕获指针');
    captured(x, y);
  }
  function gotoBackpack(over: Partial<PlayerUIState> = {}): void {
    render(over);
    if (hit('home-garage')) click('home-garage');
    if (!hit('bfilter:combat')) click('nav:backpack');
  }
  function pickCards(defId: string, n: number): void {
    gotoBackpack();
    let guard = 0;
    while (!hit('backpack-select:' + defId)) {
      if (guard++ > 12) throw new Error('未找到卡片 ' + defId);
      const nx = hit('backpack-page-next');
      if (!nx) throw new Error('翻页未找到卡片 ' + defId);
      click('backpack-page-next');
    }
    for (let i = 0; i < n; i++) click('backpack-select:' + defId);
  }
  function pageTo(defId: string): void {
    let guard = 0;
    while (!hit('backpack-select:' + defId)) {
      if (guard++ > 24) throw new Error('未找到卡片 ' + defId);
      const nx = hit('backpack-page-next');
      if (nx) {
        click('backpack-page-next');
        continue;
      }
      const pv = hit('backpack-page-prev');
      if (pv) {
        click('backpack-page-prev');
        continue;
      }
      throw new Error('分页无可用按钮，未找到卡片 ' + defId);
    }
  }
  return { host, areas, hasHit: (id) => !!hit(id), hit, click, tapAt, texts: () => texts.slice(), ops: () => ops.slice(), clearTexts: () => void (texts.length = 0), render, gotoBackpack, pickCards, pageTo };
}

function findText(env: HostEnv, re: RegExp): string | null {
  for (const t of env.texts()) if (re.test(t)) return t;
  return null;
}
function cardTextsNear(env: HostEnv, area: Area): string[] {
  return env
    .ops()
    .filter((o) => o.k === 'text' && typeof o.s === 'string' && o.x !== undefined && o.y !== undefined)
    .filter((o) => o.x! >= area.x - 4 && o.x! <= area.x + area.w + 4 && o.y! >= area.y - 4 && o.y! <= area.y + area.h + 4)
    .map((o) => o.s!);
}
function probe(env: HostEnv): FusionHostR3 {
  return env.host as unknown as FusionHostR3;
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const VP = { w: 844, h: 390 };

// ───────────────────── RB1/RB2｜星级行 + 默认星级（T2/T16） ─────────────────────

describe('R3｜星级行与默认星级（RB1-RB2 / T2·T16）', () => {
  it('RB1. 星级行按真实 MAX_STAR 动态生成：1★→2★ 可合成 + 2★满星查看态，无 3★', () => {
    expect(MAX_STAR, '前置：domain 真实星级上限').toBe(2);
    seedInventory({ cannon: { one: 3, two: 2 } });
    const env = makeEnv(VP);
    env.gotoBackpack();
    const s1 = env.hit('fusion-star:1');
    expect(s1, '星级行 1★ 命中区存在（方案C 第二层）').toBeTruthy();
    expect(env.hasHit('fusion-star:2'), '满星查看态 2★ 存在').toBe(true);
    expect(env.hasHit('fusion-star:3'), 'MAX_STAR 之外无星级（未写死）').toBe(false);
    env.render();
    const t1 = cardTextsNear(env, s1!).join(' ');
    expect(t1, `1★ chip 文案含「1★ → 2★」与可用件数（实为「${t1}」）`).toMatch(/1★\s*→\s*2★/);
    expect(t1, '1★ chip 数量口径 = 可作材料件数 3').toMatch(/3件/);
    const t2 = cardTextsNear(env, env.hit('fusion-star:2')!).join(' ');
    expect(t2, '满星 chip 文案「满星」').toMatch(/满星/);
  });

  it('RB2. 默认星级 = 最低可合成星级（1★ 可合成 → 默认 1★；卡片为 1★ 单星视图）', () => {
    seedInventory({ cannon: { one: 5, two: 2 } });
    const env = makeEnv(VP);
    env.gotoBackpack();
    expect(probe(env).fusionStar, '默认选中 1★（可合成）').toBe(1);
    env.pageTo('cannon');
    env.render();
    const card = env.hit('backpack-select:cannon')!;
    const t = cardTextsNear(env, card).join(' ');
    expect(t, '卡片为 1★ 单星视图').toMatch(/1★/);
    expect(t, '不聚合显示 2★×N（T1 前置）').not.toMatch(/2★×/);
  });
});

// ───────────────────── RB3/RB4｜单星卡 + 满星查看态（T1/T21） ─────────────────────

describe('R3｜单星卡片与满星查看态（RB3-RB4 / T1·T21）', () => {
  it('RB3. 同一部件 1★/2★ 不再同卡：1★ 视图只显示 1★ 库存（可用3）', () => {
    seedInventory({ cannon: { one: 3, two: 2 } });
    const env = makeEnv(VP);
    env.gotoBackpack();
    env.pageTo('cannon');
    env.render();
    const t = cardTextsNear(env, env.hit('backpack-select:cannon')!).join(' ');
    expect(t, '显示 1★').toMatch(/1★/);
    expect(t, '可用 3（1★ 未装备口径）').toMatch(/可用 3/);
    expect(t, '禁止聚合显示 2★×2').not.toMatch(/2★×/);
  });

  it('RB4. 满星查看态：切到 2★ → 无合成操作（fuse/auto 不注册）+ 显示 2★ 真实库存', () => {
    seedInventory({ cannon: { one: 3, two: 2 } });
    const env = makeEnv(VP);
    env.gotoBackpack();
    env.click('fusion-star:2');
    env.render();
    expect(probe(env).fusionStar, '进入满星查看态').toBe(MAX_STAR);
    expect(env.hasHit('backpack-fuse'), '满星态无合成按钮命中').toBe(false);
    expect(env.hasHit('fusion-auto'), '满星态无自动放入').toBe(false);
    expect(env.hasHit('fusion-slot:0'), '满星态无材料槽').toBe(false);
    env.pageTo('cannon');
    env.render();
    const t = cardTextsNear(env, env.hit('backpack-select:cannon')!).join(' ');
    expect(t, '满星视图显示 2★').toMatch(/2★/);
    expect(t, '显示真实 2★ 可用库存 2').toMatch(/可用 2/);
  });
});

// ───────────────────── RB5｜精确选材 + 材料区标签（T3/T4/T9） ─────────────────────

describe('R3｜精确选材（RB5 / T3·T4·T9）', () => {
  it('RB5. 点卡只加入当前分类+星级+defId；slots 完整保存 star；材料区显示「战斗1★材料 N/5」', () => {
    seedInventory({ cannon: { one: 6, two: 2 } });
    const env = makeEnv(VP);
    env.pickCards('cannon', 2);
    const p = probe(env);
    expect(p.fusionSlots[0], '槽位保存对象 {defId,star}').toEqual({ defId: 'cannon', star: 1 });
    expect(p.fusionSlots[1], '第二件同样 1★（不跨星）').toEqual({ defId: 'cannon', star: 1 });
    env.render();
    expect(findText(env, /战斗1★材料 2\/5/), '材料区锁定标签（分类+源星级+N/5）').not.toBeNull();
    // 满星态点卡不加入材料：先清空材料（点槽移除 ×2）→ 切满星（无材料直接切）→ 点卡 no-op
    env.click('fusion-slot:0');
    env.click('fusion-slot:1');
    env.click('fusion-star:2');
    expect(probe(env).fusionStar, '无材料 → 直接进入满星查看态').toBe(MAX_STAR);
    env.pageTo('cannon');
    env.click('backpack-select:cannon');
    expect(probe(env).fusionSlots.filter(Boolean).length, '满星态点卡不加入').toBe(0);
  });
});

// ───────────────────── RB6｜切换确认（T10/T11/T12） ─────────────────────

describe('R3｜切换轻确认（RB6 / T10·T11·T12）', () => {
  it('RB6. 已有材料切分类 → 轻确认；取消保持全部；确认清空并切换', () => {
    seedInventory({ cannon: { one: 5 }, smallWheel: { one: 5 } });
    const env = makeEnv(VP);
    env.pickCards('cannon', 3);
    expect(probe(env).fusionSlots.filter(Boolean).length, '前置：3 件已选').toBe(3);
    // 切分类 → 出现确认层（不静默切换）
    env.click('bfilter:movement');
    env.render();
    expect(env.hasHit('fusion-switch-cancel'), '确认层「取消」存在').toBe(true);
    expect(env.hasHit('fusion-switch-confirm'), '确认层「清空并切换」存在').toBe(true);
    expect(findText(env, /清空当前3件材料/), '确认文案含将清空件数').not.toBeNull();
    // 取消 → 分类/星级/材料完全不变
    env.click('fusion-switch-cancel');
    env.render();
    const p = probe(env);
    expect(p.fusionSlots.filter(Boolean).length, '取消后材料保持 3').toBe(3);
    expect(env.hasHit('backpack-select:cannon'), '仍在战斗分类').toBe(true);
    // 再切 → 确认清空并切换 → movement 分类、材料归零
    env.click('bfilter:movement');
    env.click('fusion-switch-confirm');
    env.render();
    const p2 = probe(env);
    expect(p2.fusionSlots.every((s) => s === null), '清空并切换后材料归零').toBe(true);
    expect(env.hasHit('backpack-select:smallWheel'), '已进入移动分类').toBe(true);
    env.clearTexts();
    env.render();
    expect(findText(env, /战斗1★材料/), '切后材料区不再显示战斗锁定标签（已清空）').toBeNull();
  });
});

// ───────────────────── RB7/RB8｜网格过滤 + 占用灰态（T13/T14） ─────────────────────

describe('R3｜网格过滤与占用灰态（RB7-RB8 / T13·T14）', () => {
  it('RB7. 完全未拥有部件不出现在合成网格', () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv(VP);
    env.gotoBackpack();
    let guard = 0;
    while (env.hasHit('backpack-page-next') && guard++ < 12) env.click('backpack-page-next');
    env.render();
    expect(env.hasHit('backpack-select:shotgun'), '零库存部件（shotgun）不注册命中').toBe(false);
    expect(findText(env, /^未拥有$/), '合成页无「未拥有」弱卡').toBeNull();
  });

  it('RB8. 有库存但全部被装备占用 → 灰态标记「装备占用N」', () => {
    seedInventory({ cannon: { one: 1 } });
    const env = makeEnv(VP, 1, 'shotgun');
    env.gotoBackpack({ draft: draftWith({ functionalSelections: { front: 'cannon', frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT } as BuildDraft['functionalSelections'] }) });
    env.pageTo('cannon');
    env.render();
    const t = cardTextsNear(env, env.hit('backpack-select:cannon')!).join(' ');
    expect(t, '灰态原因 = 装备占用1').toMatch(/装备占用1/);
    expect(env.hasHit('backpack-fuse'), '可用 0 → 不可合成').toBe(false);
  });
});

// ───────────────────── RB9｜结果关闭后定位（T17/T18/T19/T20） ─────────────────────

describe('R3｜结果关闭后定位与库存（RB9 / T17·T18·T19·T20）', () => {
  it('RB9. 合成1★得2★ → 关闭后自动切到产出星级（满星查看态）+ 产出卡新获得 + 库存正确', async () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv(VP, 1, 'shotgun');
    env.pickCards('cannon', 5);
    env.click('backpack-fuse');
    await sleep(360); // pending 280ms → 结果卡
    expect(probe(env).fusionResult, '结果卡展示').not.toBeNull();
    const b = { x: VP.w - 8, y: VP.h - 8 };
    env.tapAt(b.x, b.y); // 点空白关闭（R2.2 规则）
    env.render();
    const p = probe(env);
    expect(p.fusionResult, '已关闭').toBeNull();
    expect(p.fusionStar, '自动切到产出星级 2★（满星查看态）').toBe(2);
    expect(findText(env, /^新获得$/), '产出卡「新获得」').not.toBeNull();
    env.pageTo('shotgun');
    env.render();
    const t = cardTextsNear(env, env.hit('backpack-select:shotgun')!).join(' ');
    expect(t, '产出卡显示真实 2★ 库存（可用 1）').toMatch(/可用 1/);
    const inv = getInventory();
    expect(inv.cannon.one, '1★ 库存 -5（T17）').toBe(0);
    expect(inv.shotgun.two, '产出 2★ 入库 +1（T18：其他星不变）').toBe(1);
    expect(inv.shotgun.one, 'shotgun 1★ 不受影响').toBe(0);
  });
});
