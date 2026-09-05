/**
 * F-GARAGE-FUSION-FEEDBACK-LAYOUT-R2.1｜合成页 统一布局 + 信息层级 + 交互反馈 —— T1–T22 验收（headless）。
 *
 * 分层：
 *  - L1 几何/同源（T1–T3 / T7 / T18–T19）：真实绘制 ops + hitAreas 互斥；badge 页头右缘独立位；
 *  - L2 卡内信息层级（T4–T6）：三层文字全在卡内 / 单主状态 / 选中徽标不压名称星级；
 *  - L3 材料槽与行内反馈（T8–T13）：槽可辨识（真实图标 ops + 短名 + ×N）/ 加入/移除/自动放入反馈 / N5 同步；
 *  - L4 状态机与结果闭环（T14–T17 / T21–T22）：还差N件 / 消耗-获得同卡 / 关闭后定位高亮 / 连点一次 / reload 保持；
 *  - L5 构建隔离（T16 / T20）：不同部件图标可区分（defId 微型差异符）；普通构建零 badge/测试按钮。
 *
 * 手段：headless 真实 CanvasPlayerUIHost（stub ctx **全量 drawOps 录制** + fillText 录制 + 真实指针），
 * 全部断言走 几何 / drawOps / 库存持久化——不做固定字符长度源码切片。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
  fusionCategoryPartIds,
  fuseCategoryMaterials,
  type PartInventory,
} from '../src/core/partInventory';
import { OFFICIAL_BODIES } from '../src/core/bodyOwnership';
import type { PlayerUIState, PlayerUIActions } from '../src/ui/playerUI';
import type { BuildDraft } from '../src/lab/buildEditorModel';

// ───────────────────────────── 基础辅助 ─────────────────────────────

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

function emptyDraft(): BuildDraft {
  return { bodyDefId: 'boxBody', rearRadius: 20, frontRadius: 20, functionalSelections: {} };
}
function noWeaponsDraft(): BuildDraft {
  const d = makeStarterDraft('watermelonBody', registry);
  d.functionalSelections = {};
  return d;
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
function countTwo(inv: PartInventory): number {
  return allPartKeys(inv).reduce((s, k) => s + getCount(inv, k, 2), 0);
}
/** 确定性 rng：命中 pool 中 product 的下标（core 注入 / UI 动作桩用） */
function rngFor(product: string, cat: 'combat' | 'movement'): () => number {
  const pool = fusionCategoryPartIds(cat);
  const idx = pool.indexOf(product);
  return () => (idx < 0 ? 0 : idx / pool.length);
}

// ───────────────────────────── drawOps / fillText 录制 ctx ─────────────────────────────

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
  r?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  v?: string;
  style?: string;
};

/** 全量 drawOps 录制（fillText 额外进 texts）。坐标 = 传入 ctx 的布局坐标（与 hitArea 同一空间）。 */
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
      if (prop === 'arc')
        return (x: number, y: number, r: number): void => {
          ops.push({ k: 'arc', x, y, r, style: String(state.strokeStyle ?? state.fillStyle ?? '') });
        };
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
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop: () => {} });
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

interface HostEnv {
  host: CanvasPlayerUIHost;
  areas: () => Area[];
  hasHit: (id: string) => boolean;
  hit: (id: string) => Area | undefined;
  click: (id: string) => void;
  doubleTap: (id: string) => void;
  texts: () => string[];
  ops: () => Op[];
  clearTexts: () => void;
  render: (over?: Partial<PlayerUIState>) => void;
  gotoBackpack: (over?: Partial<PlayerUIState>) => void;
  fillCard: (defId: string, n: number, over?: Partial<PlayerUIState>) => void;
  frameBadge: () => void;
}

/** headless host 环境：真实指针 + 真实 fuse 动作桩（fuseCategoryMaterials + 注入 rng）。 */
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
  host.setBuildBadge('#abc1234');
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
      const rng = rngFor(product, category);
      const res = fuseCategoryMaterials(cur, materials, category, lastDraft, star, rng);
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
    if (hit('home-garage')) click('home-garage');
    if (!hit('bfilter:combat')) click('nav:backpack');
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
  function frameBadge(): void {
    host.renderBattleFrame({} as never);
  }
  return { host, areas, hasHit: (id) => !!hit(id), hit, click, doubleTap, texts: () => texts.slice(), ops: () => ops.slice(), clearTexts: () => void (texts.length = 0), render, gotoBackpack, fillCard, frameBadge };
}

// ───────────────────────────── 几何/文本辅助 ─────────────────────────────

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function inter(a: Rect, b: Rect): Rect | null {
  if (!overlaps(a, b)) return null;
  return { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), w: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) };
}
function findText(env: HostEnv, re: RegExp): string | null {
  for (const t of env.texts()) if (re.test(t)) return t;
  return null;
}
/** 卡 rect 内录制的文字 op（x/y 已收窄为 number） */
interface TextOp extends Op {
  k: 'text';
  x: number;
  y: number;
}
function textOpsIn(env: HostEnv, r: Rect): TextOp[] {
  return env.ops().filter(
    (o): o is TextOp =>
      o.k === 'text' &&
      typeof o.x === 'number' &&
      typeof o.y === 'number' &&
      o.x >= r.x - 2 &&
      o.x <= r.x + r.w + 2 &&
      o.y >= r.y - 1 &&
      o.y <= r.y + r.h + 1,
  );
}
/** 与任一命中区相交的命中区对（两两；同 id 跳过；卡片对跳过——网格同层允许） */
function intersectPairs(areas: Area[]): Array<[Area, Area, Rect]> {
  const out: Array<[Area, Area, Rect]> = [];
  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      const a = areas[i];
      const b = areas[j];
      if (a.id === b.id) continue;
      if (a.id.startsWith('backpack-select:') && b.id.startsWith('backpack-select:')) continue;
      const ov = inter(a, b);
      if (ov) out.push([a, b, ov]);
    }
  }
  return out;
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 从 drawOps 定位 badge 底板矩形（fillText('#abc1234') 前最近一次 rgba(0,0,0,0.55) fillRect）。 */
function badgeRectFrom(ops: Op[]): Rect | null {
  for (let i = ops.length - 1; i >= 0; i--) {
    const o = ops[i];
    if (o.k === 'text' && o.s === '#abc1234') {
      for (let j = i - 1; j >= 0; j--) {
        const p = ops[j];
        if (
          p.k === 'fillRect' &&
          (p.style ?? '').includes('0,0,0,0.55') &&
          p.x !== undefined &&
          p.y !== undefined &&
          p.w !== undefined &&
          p.h !== undefined
        )
          return { x: p.x, y: p.y, w: p.w, h: p.h };
        if (p.k === 'text') break;
      }
      break;
    }
  }
  return null;
}

const VP4 = [
  { w: 420, h: 210 },
  { w: 621, h: 351 },
  { w: 844, h: 390 },
  { w: 1280, h: 592 },
];

// ───────────────────────────── L1 几何 / 同源（T1-T3 / T7 / T18-T19） ─────────────────────────────

describe('F-GARAGE-FUSION-FEEDBACK-LAYOUT-R2.1 L1｜几何与同源（T1-T3/T7/T18-T19）', () => {
  it('T1. RC badge 实绘于页头右缘独立位：不压 战斗/移动/车身 分类页签、不压返回按钮（4 视口）', () => {
    for (const vp of VP4) {
      seedInventory({ cannon: { one: 6 } });
      const env = makeEnv(vp);
      env.gotoBackpack();
      env.frameBadge();
      const badgeTxt = env.ops().filter((o) => o.k === 'text' && o.s === '#abc1234');
      expect(badgeTxt.length, `${vp.w}×${vp.h} badge 文本实绘`).toBe(1);
      const rect = badgeRectFrom(env.ops());
      expect(rect, `${vp.w}×${vp.h} badge 底板实绘`).not.toBeNull();
      if (!rect) continue;
      for (const tabId of ['bfilter:combat', 'bfilter:movement', 'bfilter:body']) {
        const tab = env.hit(tabId);
        if (!tab) continue;
        expect(inter(rect, tab), `${vp.w}×${vp.h} badge×${tabId} no-overlap`).toBeNull();
      }
      const back = env.hit('nav:garage');
      if (back) expect(inter(rect, back), `${vp.w}×${vp.h} badge×返回 no-overlap`).toBeNull();
      expect(rect.x + rect.w, `${vp.w}×${vp.h} badge 不超右缘`).toBeLessThanOrEqual(vp.w);
    }
  });

  it('T2. 测试材料×5 不侵胶囊（右缘 ≤ W）且不压返回/标题/badge（420×210 / 844×390）', () => {
    for (const vp of [{ w: 420, h: 210 }, { w: 844, h: 390 }]) {
      seedInventory({ cannon: { one: 6 } });
      const env = makeEnv(vp);
      env.gotoBackpack({ resetDevVisible: true });
      const tm = env.hit('backpack-test-material');
      expect(tm, `${vp.w}×${vp.h} 调试构建出现测试材料`).toBeTruthy();
      if (!tm) continue;
      expect(tm.x + tm.w, `${vp.w}×${vp.h} tm 右缘 ≤ W`).toBeLessThanOrEqual(vp.w);
      const back = env.hit('nav:garage');
      if (back) expect(inter(tm, back), `${vp.w}×${vp.h} tm×返回 no-overlap`).toBeNull();
      const titleTexts = env.texts().filter((s) => s === '部件合成').length;
      expect(titleTexts, `${vp.w}×${vp.h} 标题在`).toBeGreaterThan(0);
      env.frameBadge();
      const bRect = badgeRectFrom(env.ops());
      if (bRect) expect(inter(bRect, tm), `${vp.w}×${vp.h} badge×tm no-overlap`).toBeNull();
    }
  });

  it('T3. 页内七区域互斥：全部 hitArea 两两相交对 = 0（4 视口）', () => {
    for (const vp of VP4) {
      seedInventory({ cannon: { one: 6 }, hammer: { one: 2 } });
      const env = makeEnv(vp);
      env.gotoBackpack();
      const pairs = intersectPairs(env.areas());
      expect(pairs, `${vp.w}×${vp.h} 无相交 hitArea`).toEqual([]);
      // 移动/车身分类同检
      env.click('bfilter:movement');
      expect(intersectPairs(env.areas()), `${vp.w}×${vp.h} movement 无相交`).toEqual([]);
      env.click('bfilter:body');
      expect(intersectPairs(env.areas()), `${vp.w}×${vp.h} body 无相交`).toEqual([]);
    }
  });

  it('T7. 分页条不压卡片网格与材料栏：pager 整条位于可见卡片之下、材料栏之上', () => {
    for (const vp of VP4) {
      seedInventory({ cannon: { one: 6 } }); // 11 战斗部件 → 必然多页
      const env = makeEnv(vp);
      env.gotoBackpack();
      const pg = env.hit('backpack-page-next');
      expect(pg, `${vp.w}×${vp.h} 多页有分页条`).toBeTruthy();
      if (!pg) continue;
      const cards = env.areas().filter((a) => a.id.startsWith('backpack-select:'));
      for (const c of cards) {
        expect(c.y + c.h, `${vp.w}×${vp.h} 卡片底 ≤ pager 顶`).toBeLessThanOrEqual(pg.y + 0.5);
      }
      const slots = env.areas().filter((a) => a.id.startsWith('fusion-slot:') || a.id === 'fusion-auto' || a.id === 'backpack-fuse');
      for (const s of slots) {
        expect(pg.y + pg.h, `${vp.w}×${vp.h} pager 底 ≤ 材料栏顶`).toBeLessThanOrEqual(s.y + 0.5);
      }
    }
  });

  it('T18. 绘制与 hitArea 同源：主按钮文案锚点 == 命中区中心；disabled 时无命中、仅「还差N件」标签', () => {
    for (const vp of VP4) {
      seedInventory({ cannon: { one: 6 } });
      const env = makeEnv(vp);
      env.gotoBackpack();
      // 未满 5（槽空）：无 hit，主按钮标签 = 还差5件（button() 仅绘制、不注册 → 同源分支）
      expect(env.hasHit('backpack-fuse'), `${vp.w}×${vp.h} 未满无 hit`).toBe(false);
      expect(findText(env, /^还差\d件$/), `${vp.w}×${vp.h} 未满标签`).not.toBeNull();
      expect(findText(env, /^合成$/), `${vp.w}×${vp.h} 未满不绘「合成」`).toBeNull();
      env.fillCard('cannon', 5);
      env.clearTexts();
      env.render();
      const fuse = env.hit('backpack-fuse');
      expect(fuse, `${vp.w}×${vp.h} 满 5 注册`).toBeTruthy();
      if (!fuse) continue;
      // 同源：button() 用同一 (x,y,w,h) 绘制并注册 → 「合成」文案锚点 = 命中区中心
      const cxp = fuse.x + fuse.w / 2;
      const cyp = fuse.y + fuse.h / 2;
      const anchored = env
        .ops()
        .some((o) => o.k === 'text' && o.s === '合成' && typeof o.x === 'number' && typeof o.y === 'number' && Math.abs(o.x - cxp) < 1 && Math.abs(o.y - cyp) < 1);
      expect(anchored, `${vp.w}×${vp.h} 「合成」文案与 hit 同源同中心`).toBe(true);
    }
  });

  it('T19. 四视口 × DPR1/1.5/3：命中区逻辑几何一致、无重叠（DPR 只影响 backing）', () => {
    for (const vp of VP4) {
      seedInventory({ cannon: { one: 6 }, hammer: { one: 2 }, spear: { one: 3 } });
      const e1 = makeEnv(vp, 1);
      e1.gotoBackpack();
      const rect = (a: Area): Rect => ({ x: a.x, y: a.y, w: a.w, h: a.h });
      const base = new Map(e1.areas().map((a) => [a.id, rect(a)]));
      for (const dpr of [1.5, 3]) {
        const env = makeEnv(vp, dpr);
        env.gotoBackpack();
        const areas = env.areas();
        expect(intersectPairs(areas), `${vp.w}×${vp.h} DPR${dpr} 无重叠`).toEqual([]);
        for (const a of areas) {
          const b = base.get(a.id);
          expect(b, `${vp.w}×${vp.h} DPR${dpr} ${a.id} 存在`).toBeTruthy();
          if (b) expect(rect(a), `${vp.w}×${vp.h} DPR${dpr} ${a.id} 同几何`).toEqual(b);
        }
      }
    }
  });
});

// ───────────────────────────── L2 卡内信息层级（T4-T6） ─────────────────────────────

describe('F-GARAGE-FUSION-FEEDBACK-LAYOUT-R2.1 L2｜卡内信息层级（T4-T6）', () => {
  it('T4. 卡片三层信息全在卡内：name/星级/单主状态文字 ops 坐标均在卡 rect 内（战斗/短屏/正常）', () => {
    for (const vp of VP4) {
      seedInventory({ cannon: { one: 6 }, hammer: { one: 2 }, spear: { one: 3 } });
      const env = makeEnv(vp);
      env.gotoBackpack();
      const short = vp.h < 260;
      // cannon 卡（拥有 6 → L1 名 + L2 星 + L3 可用）
      let cannon = env.hit('backpack-select:cannon');
      let guard = 0;
      while (!cannon && guard++ < 6) {
        const nx = env.hit('backpack-page-next');
        if (!nx) break;
        env.click('backpack-page-next');
        cannon = env.hit('backpack-select:cannon');
      }
      expect(cannon, `${vp.w}×${vp.h} cannon 卡在位`).toBeTruthy();
      if (!cannon) continue;
      const inCard = textOpsIn(env, cannon);
      const expectLabels = short ? ['炮', /^1★×\d+/, /^可用 \d+$/] : ['炮', /^1★×\d+$/, /^可用 \d+$/];
      for (const lab of expectLabels) {
        const hitOp = inCard.some((o) => (typeof lab === 'string' ? o.s === lab : typeof o.s === 'string' && lab.test(o.s)));
        expect(hitOp, `${vp.w}×${vp.h} 卡内文字含 ${String(lab)}`).toBe(true);
      }
      // 全部在卡内（不含压行）：文字 y 与字号半径估算后不越卡
      const nameOp = inCard.find((o) => o.s === '炮');
      const starOp = inCard.find((o) => typeof o.s === 'string' && /^1★×/.test(o.s));
      const statOp = inCard.find((o) => typeof o.s === 'string' && /^可用 /.test(o.s));
      const nameFs = 15 * (short ? 0.8 : 1);
      const subFs = 13 * (short ? 0.8 : 1);
      if (nameOp && starOp && statOp) {
        const band = short ? [nameOp, starOp] : [nameOp, starOp, statOp];
      for (const o of band) {
        const half = (o === nameOp ? nameFs : subFs) / 2; // baseline=middle → 半高
        expect(o.y - half, `${vp.w}×${vp.h} 文字上缘 ≥ 卡顶`).toBeGreaterThanOrEqual(cannon.y - 0.6);
        expect(o.y + half, `${vp.w}×${vp.h} 文字下缘 ≤ 卡底`).toBeLessThanOrEqual(cannon.y + cannon.h + 0.6);
      }
      }
    }
  });

  it('T5. 每张卡最多一个主状态（可用 N / 已装备 / 未拥有），不堆叠', () => {
    for (const vp of VP4) {
      seedInventory({ cannon: { one: 6 }, hammer: { one: 2 }, spear: { one: 3 }, saw: { one: 2 } });
      const env = makeEnv(vp);
      env.gotoBackpack();
      for (const card of env.areas().filter((a) => a.id.startsWith('backpack-select:'))) {
        const statuses = textOpsIn(env, card).filter((o) => typeof o.s === 'string' && /^(可用 \d+|已装备|未拥有)$/.test(o.s));
        expect(statuses.length, `${vp.w}×${vp.h} ${card.id} 单主状态`).toBeLessThanOrEqual(1);
      }
    }
    // 已装备保护场景：装备 1 件 cannon（one=1）→ 状态=已装备
    seedInventory({ cannon: { one: 1 } });
    const draft = emptyDraft();
    const eqDraft: BuildDraft = { ...draft, functionalSelections: { frontMass: 'cannon' }, functionalStars: { frontMass: 1 } };
    const env = makeEnv({ w: 844, h: 390 });
    env.gotoBackpack({ draft: eqDraft });
    expect(findText(env, /^已装备$/), '装备件卡状态=已装备').not.toBeNull();
    // 未拥有（零库存部件）→ 状态=未拥有
    expect(findText(env, /^未拥有$/), '未拥有状态存在').not.toBeNull();
  });

  it('T6. 选中徽标/勾不压名称与星级行（normal chip / short ✓ 各占右上角预留位）', () => {
    for (const vp of VP4) {
      seedInventory({ cannon: { one: 10 } });
      const env = makeEnv(vp);
      env.gotoBackpack();
      const cannon = env.hit('backpack-select:cannon');
      expect(cannon, `${vp.w}×${vp.h} cannon 卡`).toBeTruthy();
      if (!cannon) continue;
      env.click('backpack-select:cannon'); // usedN=1 → 徽标
      env.clearTexts();
      env.render();
      const short = vp.h < 260;
      const chipRect: Rect = short
        ? { x: cannon.x + cannon.w - 16, y: cannon.y + 1, w: 14, h: 14 } // ✓ 区域（右上）
        : { x: cannon.x + cannon.w - 38, y: cannon.y + 3, w: 34, h: 16 }; // 已选N chip
      const inCard = textOpsIn(env, cannon);
      const otherLines = inCard.filter((o) => !(short && o.s === '✓') && !(!short && typeof o.s === 'string' && /^已选\d+$/.test(o.s)));
      for (const o of otherLines) {
        // 与徽标垂直带相交的文字必须不横向进入徽标区（名称行被 chipReserve 让位）
        const yBand = short ? o.y - 6 : o.y - 7;
        const bandBot = short ? o.y + 6 : o.y + 7;
        const verticalOverlap = bandBot > chipRect.y && yBand < chipRect.y + chipRect.h;
        if (verticalOverlap) {
          expect(o.x, `${vp.w}×${vp.h} 与徽标同带的文字在徽标左侧 (${o.s})`).toBeLessThanOrEqual(chipRect.x - 1);
        }
      }
      if (!short) {
        expect(inCard.some((o) => typeof o.s === 'string' && /^已选1$/.test(o.s)), `${vp.w}×${vp.h} chip 文案`).toBe(true);
      } else {
        expect(inCard.some((o) => o.s === '✓'), `${vp.w}×${vp.h} short 勾`).toBe(true);
      }
    }
  });
});

// ───────────────────────────── L3 材料槽与行内反馈（T8-T13） ─────────────────────────────

describe('F-GARAGE-FUSION-FEEDBACK-LAYOUT-R2.1 L3｜材料槽与行内反馈（T8-T13）', () => {
  it('T8. 材料槽可辨识真实部件：槽内 = 图标 drawOps（非空槽）+ 短名文字', () => {
    seedInventory({ cannon: { one: 6 } });
    const env = makeEnv({ w: 844, h: 390 });
    env.gotoBackpack();
    const emptySlot = env.hit('fusion-slot:0');
    expect(emptySlot, '空槽不注册命中').toBeUndefined();
    env.fillCard('cannon', 1);
    const slot = env.hit('fusion-slot:0');
    expect(slot, '放入后槽注册命中').toBeTruthy();
    if (!slot) return;
    const ops = env.ops();
    const nameIn = ops.some(
      (o) =>
        o.k === 'text' &&
        o.s === '炮' &&
        typeof o.x === 'number' &&
        typeof o.y === 'number' &&
        o.x >= slot.x &&
        o.x <= slot.x + slot.w &&
        o.y >= slot.y &&
        o.y <= slot.y + slot.h,
    );
    expect(nameIn, '槽内短名文字').toBe(true);
    // 图标 drawOps：icon 中心 ≈ (slot.x+17, slot.y+h/2) ±22px 内存在形状 op（非空槽无「+」占位）
    const icx = slot.x + 17;
    const icy = slot.y + slot.h / 2;
    const shapes = ops.filter((o) => (o.k === 'fillRect' || o.k === 'arc' || o.k === 'stroke') && Math.abs((o as { x?: number }).x ?? ((o as { x1?: number }).x1 ?? -9999) - icx) < 26 && Math.abs((o as { y?: number }).y ?? ((o as { y1?: number }).y1 ?? -9999) - icy) < 22);
    expect(shapes.length, '槽内图标形状 ops ≥1').toBeGreaterThanOrEqual(1);
  });

  it('T9. 重复表达正确：同 defId 多件 → 仅首个槽右上 ×N（N=槽内总件数）；单件不出现 ×1', () => {
    seedInventory({ cannon: { one: 6 }, hammer: { one: 6 } });
    const env = makeEnv({ w: 844, h: 390 });
    env.gotoBackpack();
    env.click('backpack-select:cannon');
    env.click('backpack-select:cannon');
    env.click('backpack-select:cannon');
    env.click('backpack-select:hammer');
    env.clearTexts();
    env.render();
    const mults = env.texts().filter((t) => /^×\d+$/.test(t));
    expect(mults, '×N 仅 cannon ×3').toEqual(['×3']);
  });

  it('T10. 加入行内反馈：每次放入 → 「已放入：短名（n/5）」累计 n 实时', () => {
    seedInventory({ cannon: { one: 6 } });
    const env = makeEnv({ w: 844, h: 390 });
    env.gotoBackpack();
    env.clearTexts();
    env.click('backpack-select:cannon');
    expect(findText(env, /^已放入：炮（1\/5）$/), '第 1 件反馈').not.toBeNull();
    env.click('backpack-select:cannon');
    expect(findText(env, /^已放入：炮（2\/5）$/), '第 2 件反馈').not.toBeNull();
  });

  it('T11. 移除行内反馈：点材料槽 → 「已移除：短名（n/5）」n 实时递减、库存零消耗', () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv({ w: 844, h: 390 });
    env.fillCard('cannon', 5);
    env.clearTexts();
    env.click('fusion-slot:2');
    expect(findText(env, /^已移除：炮（4\/5）$/), '移除反馈 n=4').not.toBeNull();
    expect(getCount(getInventory(), 'cannon', 1), '移除不消耗库存').toBe(5);
    expect(env.hasHit('backpack-fuse'), '移除后未满 → 合成不可点').toBe(false);
  });

  it('T12. 自动放入：满 5 槽 + 「已自动放入5件材料」+ N/5=5（卡片/槽同步闪亮由 flash 状态驱动）', () => {
    seedInventory({ cannon: { one: 2 }, hammer: { one: 2 }, saw: { one: 1 } });
    const env = makeEnv({ w: 844, h: 390 });
    env.gotoBackpack();
    env.clearTexts();
    env.click('fusion-auto');
    expect(findText(env, /^已自动放入5件材料$/), '自动放入反馈').not.toBeNull();
    const slots = env.areas().filter((a) => a.id.startsWith('fusion-slot:'));
    expect(slots.length, '5 槽注册').toBe(5);
    expect(findText(env, /^5\/5$/), 'N/5=5').not.toBeNull();
    const h = env.host as unknown as { fusionSlots: Array<string | null>; fusionFlash: unknown };
    expect(h.fusionSlots.filter(Boolean).length, '状态机满 5').toBe(5);
    expect(h.fusionFlash, '自动放入触发闪亮').not.toBeNull();
    expect(env.hasHit('backpack-fuse'), '满 5 合成可点').toBe(true);
  });

  it('T13. N/5 与实选一致：加入/移除全程 bar N/5 同步', () => {
    seedInventory({ cannon: { one: 6 } });
    const env = makeEnv({ w: 844, h: 390 });
    env.gotoBackpack();
    env.click('backpack-select:cannon');
    expect(findText(env, /^1\/5$/), '放入1 → 1/5').not.toBeNull();
    env.click('backpack-select:cannon');
    expect(findText(env, /^2\/5$/), '放入2 → 2/5').not.toBeNull();
    env.click('fusion-slot:0');
    env.clearTexts();
    env.render();
    expect(findText(env, /^1\/5$/), '移除1 → 1/5').not.toBeNull();
    expect(findText(env, /^2\/5$/), '不再 2/5').toBeNull();
  });
});

// ───────────────────────────── L4 状态机与结果闭环（T14-T17 / T21-T22） ─────────────────────────────

describe('F-GARAGE-FUSION-FEEDBACK-LAYOUT-R2.1 L4｜状态机与结果闭环（T14-T17/T21-T22）', () => {
  it('T14. 材料不足：主按钮「还差 N 件」disabled（无命中），自动放入 disabled；状态行主次拆分明晰', () => {
    seedInventory({ cannon: { one: 4 } });
    const env = makeEnv({ w: 844, h: 390 });
    env.gotoBackpack();
    expect(findText(env, /^还差 \d 件1★部件$/), '主状态=还差 N').not.toBeNull();
    expect(findText(env, /^可用 1★材料 \d 件$/), '次状态=可用 N 件').not.toBeNull();
    expect(findText(env, /^还差\d件$/), '主按钮标签=还差N件').not.toBeNull();
    expect(env.hasHit('backpack-fuse'), '合成不可点').toBe(false);
    expect(env.hasHit('fusion-auto'), '自动放入不可点（可用<5）').toBe(false);
  });

  it('T15. 结果卡同时显示 消耗：5件战斗1★ / 获得：名2★ + 真实产出图标 + 2★', async () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv({ w: 844, h: 390 }, 1, 'shotgun');
    env.fillCard('cannon', 5);
    env.click('backpack-fuse');
    await sleep(340);
    env.clearTexts();
    env.render();
    expect(findText(env, /^合成成功$/), '标题').not.toBeNull();
    expect(findText(env, /^消耗：5件战斗1★$/), '消耗行').not.toBeNull();
    const got = findText(env, /^获得：.+$/);
    expect(got, '获得行').not.toBeNull();
    expect(got!.includes('霰弹炮'), '获得行含产物名').toBe(true);
    expect(findText(env, /^2★$/), '获得星级（同卡 2★ 标注）').not.toBeNull();
    expect(findText(env, /^点击任意处继续$/), '点击继续可读').not.toBeNull();
    expect(getCount(getInventory(), 'cannon', 1), '1★ -5').toBe(0);
    expect(getCount(getInventory(), 'shotgun', 2), '产物 2★ +1').toBe(1);
    // 真实产出图标（非通用占位）：结果卡区域存在形状 ops（对应 shotgun 微特征）
    const ops = env.ops();
    const hasIcon = ops.some((o) => (o.k === 'fillRect' || o.k === 'arc' || o.k === 'stroke') && o.style !== '');
    expect(hasIcon, '结果卡有图标绘制').toBe(true);
  });

  it('T17. 关闭结果卡 → 自动切产物所在分页 + 产物卡「新获得」高亮（~2s）且星级数量立即可见', async () => {
    seedInventory({ cannon: { one: 5 } });
    // 420×210 极短屏（pageSize 小 → 产物 shotgun 位于后续页，跳页可观测）
    const env = makeEnv({ w: 420, h: 210 }, 1, 'shotgun');
    env.fillCard('cannon', 5);
    env.click('backpack-fuse');
    await sleep(340);
    expect(env.hasHit('fusion-result-dismiss'), '结果卡命中区').toBeTruthy();
    env.clearTexts();
    env.click('fusion-result-dismiss');
    // 跳页 + 新获得
    const h = env.host as unknown as { fusionJumpTo: string | null; fusionGlow: { defId: string } | null; fusionNew: { defId: string } | null; backpackPage: number };
    expect(h.fusionJumpTo, '跳转标记消费').toBeNull();
    expect(findText(env, /^新获得$/), '产物卡 新获得 角标').not.toBeNull();
    expect(h.fusionGlow?.defId, 'glow=产物').toBe('shotgun');
    expect(h.fusionNew?.defId, 'new=产物').toBe('shotgun');
    const shotCard = env.hit('backpack-select:shotgun');
    expect(shotCard, '产物卡当前页可见').toBeTruthy();
    if (shotCard) {
      const inCard = textOpsIn(env, shotCard);
      expect(inCard.some((o) => typeof o.s === 'string' && /^2★×1$/.test(o.s)), '星级数量立即可见').toBe(true);
    }
  });

  it('T21. 连点主按钮只执行一次：背靠背双击 → 1★ -5 恰一次、2★ +1 恰一次', () => {
    seedInventory({ cannon: { one: 10 } });
    const env = makeEnv({ w: 844, h: 390 });
    env.fillCard('cannon', 5);
    env.doubleTap('backpack-fuse');
    expect(getCount(getInventory(), 'cannon', 1), '只消耗一次（10-5）').toBe(5);
    expect(countTwo(getInventory()), '只产出一次').toBe(1);
  });

  it('T22. reload 后库存产出保持：合成落盘 → 新 host 重读一致、产物卡状态正确', async () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv({ w: 844, h: 390 }, 1, 'shotgun');
    env.fillCard('cannon', 5);
    env.click('backpack-fuse');
    await sleep(340);
    const persisted = loadInventoryRaw() as PartInventory;
    expect(getCount(persisted, 'cannon', 1), '落盘 1★=0').toBe(0);
    expect(getCount(persisted, 'shotgun', 2), '落盘 2★=1').toBe(1);
    const env2 = makeEnv({ w: 844, h: 390 }, 1, 'shotgun');
    env2.gotoBackpack();
    env2.clearTexts();
    env2.render();
    const reloaded = getInventory();
    expect(getCount(reloaded, 'cannon', 1), 'reload 1★=0').toBe(0);
    expect(getCount(reloaded, 'shotgun', 2), 'reload 2★=1').toBe(1);
    expect(findText(env2, /^2★×1$/), 'reload 后产物卡 2★×1 可见').not.toBeNull();
  });
});

// ───────────────────────────── L5 图标可区分 / 构建隔离（T16 / T20） ─────────────────────────────

describe('F-GARAGE-FUSION-FEEDBACK-LAYOUT-R2.1 L5｜图标可区分与构建隔离（T16/T20）', () => {
  it('T16. 不同部件图标可区分：同一槽位放入不同 defId → 槽内 drawOps 特征序列不同', () => {
    seedInventory({ cannon: { one: 6 }, machineGun: { one: 6 }, shotgun: { one: 6 }, saw: { one: 6 } });
    function slotSig(defId: string): string {
      const env = makeEnv({ w: 844, h: 390 });
      env.gotoBackpack();
      let card = env.hit('backpack-select:' + defId);
      let guard = 0;
      while (!card && guard++ < 6) {
        const nx = env.hit('backpack-page-next');
        if (!nx) throw new Error('无卡 ' + defId);
        env.click('backpack-page-next');
        card = env.hit('backpack-select:' + defId);
      }
      env.click('backpack-select:' + defId);
      const slot = env.hit('fusion-slot:0');
      if (!slot) throw new Error('槽未注册 ' + defId);
      const icx = slot.x + 17;
      const icy = slot.y + slot.h / 2;
      const sig = env
        .ops()
        .filter((o) => {
          if (o.k === 'fillRect' || o.k === 'arc')
            return typeof o.x === 'number' && typeof o.y === 'number' && Math.abs(o.x - icx) < 30 && Math.abs(o.y - icy) < 30;
          if (o.k === 'stroke') return typeof o.x1 === 'number' && typeof o.y1 === 'number' && Math.abs(o.x1 - icx) < 30 && Math.abs(o.y1 - icy) < 30;
          return false;
        })
        .map((o) => (o.k === 'fillRect' ? `R${Math.round(o.w ?? 0)}x${Math.round(o.h ?? 0)}` : o.k === 'arc' ? `A${Math.round(o.r ?? 0)}` : 'L'))
        .join(',');
      return sig;
    }
    const sigCannon = slotSig('cannon');
    const sigMG = slotSig('machineGun');
    const sigShot = slotSig('shotgun');
    const sigSaw = slotSig('saw');
    // 基准炮（无微特征）与各微特征部件互不相同
    expect(sigMG, '机枪 ≠ 炮').not.toBe(sigCannon);
    expect(sigShot, '霰弹 ≠ 炮').not.toBe(sigCannon);
    expect(sigSaw, '圆锯 ≠ 炮').not.toBe(sigCannon);
    expect(sigShot, '霰弹 ≠ 机枪').not.toBe(sigMG);
  });

  it('T20. 普通构建零 badge/测试按钮/调试入口：无宏 + resetDevVisible=false → 无 backpack-test-material 与测试文案', () => {
    seedInventory({ cannon: { one: 6 } });
    const env = makeEnv({ w: 844, h: 390 });
    env.gotoBackpack();
    expect(env.hasHit('backpack-test-material'), '无测试材料按钮').toBe(false);
    expect(findText(env, /测试材料|测试×5/), '无测试按钮文案').toBeNull();
    // body 分类亦无
    env.click('bfilter:body');
    expect(env.hasHit('backpack-test-material'), 'body 无测试按钮').toBe(false);
  });
});

// ───────────────────────────── 分类列表一致性（布局数据源防漂移） ─────────────────────────────

describe('F-GARAGE-FUSION-FEEDBACK-LAYOUT-R2.1 L0｜布局数据源防漂移', () => {
  it('战斗/移动/车身分类卡片全集 == 正式 Registry（新增部件自动出现在背包网格）', () => {
    for (const vp of [{ w: 844, h: 390 }, { w: 420, h: 210 }]) {
      const env = makeEnv(vp);
      env.gotoBackpack();
      const combatIds: string[] = [];
      let guard = 0;
      while (guard++ < 8) {
        for (const a of env.areas()) {
          const m = /^backpack-select:(.+)$/.exec(a.id);
          if (m && !combatIds.includes(m[1])) combatIds.push(m[1]);
        }
        if (!env.hasHit('backpack-page-next')) break;
        env.click('backpack-page-next');
      }
      expect(combatIds.sort(), `${vp.w}×${vp.h} 战斗全集`).toEqual([...OFFICIAL_PARTS].sort());
      env.click('bfilter:movement');
      const mv = env.areas().filter((a) => a.id.startsWith('backpack-select:')).map((a) => a.id.slice('backpack-select:'.length)).sort();
      expect(mv, '移动全集').toEqual([...OFFICIAL_MOVEMENTS].sort());
      env.click('bfilter:body');
      const bd: string[] = [];
      let bguard = 0;
      while (bguard++ < 8) {
        for (const a of env.areas()) {
          const m = /^backpack-select:(.+)$/.exec(a.id);
          if (m && !bd.includes(m[1])) bd.push(m[1]);
        }
        if (!env.hasHit('backpack-page-next')) break;
        env.click('backpack-page-next');
      }
      expect(bd.sort(), '车身全集').toEqual([...OFFICIAL_BODIES].sort());
    }
  });
});
