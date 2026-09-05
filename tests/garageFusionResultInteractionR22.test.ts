/**
 * F-GARAGE-FUSION-RESULT-INTERACTION-R2.2｜合成结果交互闭环 —— 关闭规则/输入隔离/视觉/反馈（headless）。
 *
 * 修复 7 类电脑录屏问题（基线 8fbac75 / R2.1 = 9df1eab）：
 *  ① 弹窗自动关闭（showFusionResult 950ms timer）
 *  ② 无法控制阅读（① 的后果）
 *  ③ 点击文案不一致（全屏 dismiss 覆盖卡本体 → 点卡即关；文案误导）
 *  ④ 输入隔离（底层保留后须证明底层不可达）
 *  ⑤ 背景全黑（结果帧早退不绘底层 + 0.78 遮罩过重）
 *  ⑥ 关闭后「新获得」反馈弱（仅 2000ms）
 *  ⑦ 异常操作无反馈（tryAddMaterial 失败静默 return）
 *
 * 必改 1–5 映射：
 *  关闭规则：TA1（不自动关）/ TA2（点卡不关）/ TA11（点空白关）+ TA3（文案「点击空白处继续」）
 *  输入隔离：TA2 结构断言 + TA10（顶层叠放顺序：卡片消费层 > 空白关闭层 > 全部页控件）
 *  弹窗视觉：TA4（底层保留）/ TA5（遮罩 55–70% 且晚于页面绘制）
 *  关闭后反馈：TA6（≥2.5s 高亮窗口）/ TA7（关闭后回列表、底层恢复可交互）
 *  异常反馈：TA8（槽满原因 toast）/ TA9（同种放满原因 toast）
 *
 * 手段：headless 真实 CanvasPlayerUIHost（drawOps 全量录制 + fillText 录制 + 真实指针 + 真实时钟），
 * 全部断言走 几何 / drawOps / 内部状态 / 库存持久化。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import {
  getInventory,
  saveInventory,
  fusionCategoryPartIds,
  fuseCategoryMaterials,
  type PartInventory,
} from '../src/core/partInventory';
import type { PlayerUIState, PlayerUIActions } from '../src/ui/playerUI';
import type { BuildDraft } from '../src/lab/buildEditorModel';

// ───────────────────────────── 基础辅助（与 R2.1 同构） ─────────────────────────────

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
      if (prop === 'moveTo') return (x: number, y: number): void => {
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

/** 内部状态探针（TS private 为编译期约束，运行时可读） */
type FusionHost = {
  fusionResult: { product: string; token: number } | null;
  fusionPending: { until: number; token: number } | null;
  fusionJumpTo: string | null;
  fusionGlow: { defId: string; until: number } | null;
  fusionNew: { defId: string; until: number } | null;
  fusionSlots: Array<string | null>;
  nowMs: number;
};

interface HostEnv {
  host: CanvasPlayerUIHost;
  areas: () => Area[];
  hasHit: (id: string) => boolean;
  hit: (id: string) => Area | undefined;
  click: (id: string) => void;
  /** 任意逻辑坐标真实指针（与 hitArea 同空间；等价玩家点屏幕） */
  tapAt: (x: number, y: number) => void;
  texts: () => string[];
  ops: () => Op[];
  clearTexts: () => void;
  render: (over?: Partial<PlayerUIState>) => void;
  gotoBackpack: (over?: Partial<PlayerUIState>) => void;
  /** 翻页找卡并点 n 次 */
  pickCards: (defId: string, n: number) => void;
  /** 仅翻页定位卡片（不重置页面/不点击） */
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
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function probe(env: HostEnv): FusionHost {
  return env.host as unknown as FusionHost;
}
/** 结果已展示（pending 280ms timer 已触发）后返回。 */
async function openResult(env: HostEnv, over: Partial<PlayerUIState> = {}): Promise<void> {
  env.gotoBackpack(over);
  env.pickCards('cannon', 5);
  env.click('backpack-fuse');
  await sleep(360); // runFusion 280ms pending → showFusionResult
}
/** 卡片中心 = contentRect 中心（卡宽高均含画布中心，见设计推导）。 */
function cardCenter(vp: { w: number; h: number }): { x: number; y: number } {
  return { x: vp.w / 2, y: vp.h / 2 };
}
/** 空白角落（卡外、遮罩内）。 */
function blankCorner(vp: { w: number; h: number }): { x: number; y: number } {
  return { x: vp.w - 8, y: vp.h - 8 };
}
/** 遮罩 fillRect（通道 6,9,14）在 ops 中的下标；无则 -1。 */
function veilIndex(ops: Op[]): number {
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    if (o.k === 'fillRect' && (o.style ?? '').startsWith('rgba(6,9,14,')) return i;
  }
  return -1;
}
function veilAlpha(ops: Op[]): number | null {
  const idx = veilIndex(ops);
  if (idx < 0) return null;
  const m = /^rgba\(6,\s*9,\s*14,\s*([\d.]+)\)$/.exec((ops[idx] as Op & { style: string }).style ?? '');
  return m ? Number(m[1]) : null;
}

const VP = { w: 844, h: 390 };

// ───────────────────────────── 关闭规则（必改1：不自动关/点卡不关/点空白关/文案） ─────────────────────────────

describe('F-GARAGE-FUSION-RESULT-INTERACTION-R2.2｜关闭规则（TA1-TA3 / TA11）', () => {
  it('TA1. 不自动关闭：结果卡无任何输入持续 ≥1.5s 仍展示（移除 950ms 自动关）', async () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv(VP, 1, 'shotgun');
    await openResult(env);
    expect(probe(env).fusionResult, '结果卡已展示').not.toBeNull();
    // 无任何输入，静置远超旧的 950ms 自动关闭窗口
    await sleep(1100);
    env.clearTexts();
    env.render();
    expect(probe(env).fusionResult, '结果卡不被自动关闭').not.toBeNull();
    expect(findText(env, /^合成成功$/), '结果卡仍可见').not.toBeNull();
  });

  it('TA2. 点卡本体不关闭：点结果卡中心（阅读态 no-op）→ 卡仍在、无跳页', async () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv(VP, 1, 'shotgun');
    await openResult(env);
    env.clearTexts();
    const p0 = probe(env);
    expect(p0.fusionResult, '前置：结果展示中').not.toBeNull();
    const c = cardCenter(VP);
    env.tapAt(c.x, c.y);
    env.render();
    const p1 = probe(env);
    expect(p1.fusionResult, '点卡不关（仍展示）').not.toBeNull();
    expect(p1.fusionJumpTo, '点卡不触发跳页').toBeNull();
    expect(findText(env, /^合成成功$/), '卡内容仍在').not.toBeNull();
  });

  it('TA3. 文案与行为一致：「点击空白处继续」（不再出现「点击任意处继续」）', async () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv(VP, 1, 'shotgun');
    await openResult(env);
    env.clearTexts();
    env.render();
    expect(findText(env, /^点击空白处继续$/), '新文案可读').not.toBeNull();
    expect(findText(env, /^点击任意处继续$/), '旧误导文案移除').toBeNull();
  });

  it('TA11. 点空白关闭：点卡片外遮罩区 → 关闭 + 回列表定位新产出', async () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv({ w: 420, h: 210 }, 1, 'shotgun'); // 极短屏：产物跨页，跳页可观测
    await openResult(env);
    const b = blankCorner({ w: 420, h: 210 });
    env.tapAt(b.x, b.y);
    env.render();
    expect(probe(env).fusionResult, '空白点击关闭').toBeNull();
    expect(findText(env, /^新获得$/), '产物卡「新获得」角标').not.toBeNull();
    expect(env.hasHit('backpack-select:shotgun'), '产物卡当前页可见').toBe(true);
  });
});

// ───────────────────────────── 弹窗视觉（必改3：底层保留 + 遮罩 55–70%） ─────────────────────────────

describe('F-GARAGE-FUSION-RESULT-INTERACTION-R2.2｜弹窗视觉（TA4-TA5）', () => {
  it('TA4. 底层保留：结果帧仍绘制整页（顶行「部件合成」+ 返回按钮可见于遮罩之下）', async () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv(VP, 1, 'shotgun');
    await openResult(env);
    env.clearTexts();
    env.render(); // 仅此帧：结果卡 + 底层页面应同帧绘制
    expect(findText(env, /^部件合成$/), '页标题在结果帧仍绘制（不再黑底）').not.toBeNull();
    expect(findText(env, /^‹ 返回车库$/), '返回按钮在结果帧仍绘制').not.toBeNull();
  });

  it('TA5. 遮罩为半透明 55–70%（rgba(6,9,14,α)）且晚于底层页面绘制（先页面后压暗）', async () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv(VP, 1, 'shotgun');
    await openResult(env);
    env.clearTexts();
    env.render();
    const ops = env.ops();
    const alpha = veilAlpha(ops);
    expect(alpha, '存在结果遮罩 fillRect').not.toBeNull();
    expect(alpha! >= 0.55 && alpha! <= 0.7, `遮罩透明度在 0.55–0.70（实为 ${alpha}）`).toBe(true);
    const titleIdx = ops.findIndex((o) => o.k === 'text' && o.s === '部件合成');
    const vIdx = veilIndex(ops);
    expect(titleIdx, '结果帧含页标题 op').toBeGreaterThanOrEqual(0);
    expect(vIdx, '遮罩在页标题之后绘制（底层先画）').toBeGreaterThan(titleIdx);
  });
});

// ───────────────────────────── 输入隔离（必改2：结果期底层不可达；卡区 = 阅读 no-op） ─────────────────────────────

describe('F-GARAGE-FUSION-RESULT-INTERACTION-R2.2｜输入隔离（TA10 / TA2 结构）', () => {
  it('TA10. 顶层叠放：结果期 hitAreas 顶层 = [空白关闭层, 卡片消费层]（后注册 = 先命中），屏蔽全部页控件', async () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv(VP, 1, 'shotgun');
    await openResult(env);
    env.render();
    const as = env.areas();
    expect(as.length, '结果期仍有命中区').toBeGreaterThanOrEqual(2);
    const last = as[as.length - 1];
    const prev = as[as.length - 2];
    expect(last.id, '最顶层=卡片消费层（点卡 no-op）').toBe('fusion-result-card');
    expect(prev.id, '次顶层=空白关闭层').toBe('fusion-result-dismiss');
    // 关闭层全幅覆盖：空白角落与产物卡以外任意点先被关闭层消费 → 底层页控件不可达
    const b = blankCorner(VP);
    expect(
      b.x >= prev.x && b.x <= prev.x + prev.w && b.y >= prev.y && b.y <= prev.y + prev.h,
      '空白角落位于关闭层内',
    ).toBe(true);
    expect(prev.w * prev.h, '关闭层覆盖 ≥80% 页面').toBeGreaterThanOrEqual(VP.w * VP.h * 0.8);
  });
});

// ───────────────────────────── 关闭后反馈（必改4：≥2.5s） ─────────────────────────────

describe('F-GARAGE-FUSION-RESULT-INTERACTION-R2.2｜关闭后反馈（TA6-TA7）', () => {
  it('TA6. 关闭后「新获得」高亮窗口 ≥2.5s（glow/new until − now ≥ 2500ms）', async () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv({ w: 420, h: 210 }, 1, 'shotgun');
    await openResult(env);
    const b = blankCorner({ w: 420, h: 210 });
    env.tapAt(b.x, b.y);
    env.render();
    const p = probe(env);
    expect(p.fusionResult, '已关闭').toBeNull();
    expect(p.fusionGlow?.defId, 'glow=产物').toBe('shotgun');
    expect(p.fusionNew?.defId, 'new=产物').toBe('shotgun');
    const remainGlow = (p.fusionGlow?.until ?? 0) - p.nowMs;
    const remainNew = (p.fusionNew?.until ?? 0) - p.nowMs;
    expect(remainGlow, `glow 窗口 ≥2500ms（实为 ${remainGlow}）`).toBeGreaterThanOrEqual(2480);
    expect(remainNew, `new 窗口 ≥2500ms（实为 ${remainNew}）`).toBeGreaterThanOrEqual(2480);
    expect(findText(env, /^新获得$/), '产物卡「新获得」角标可见').not.toBeNull();
  });

  it('TA7. 关闭后回列表：产物页可交互（卡片/返回可点，非卡状态残留）', async () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv(VP, 1, 'shotgun');
    await openResult(env);
    const b = blankCorner(VP);
    env.tapAt(b.x, b.y);
    env.render();
    expect(probe(env).fusionResult, '已关闭').toBeNull();
    expect(env.hasHit('backpack-select:shotgun'), '产物卡可交互').toBe(true);
    expect(env.hasHit('nav:garage'), '返回车库可点').toBe(true);
    expect(findText(env, /^部件合成$/), '仍在合成页').not.toBeNull();
  });
});

// ───────────────────────────── 异常反馈（必改5：失败给行内 toast，不静默） ─────────────────────────────

describe('F-GARAGE-FUSION-RESULT-INTERACTION-R2.2｜异常反馈（TA8-TA9）', () => {
  it('TA8. 槽满再点其它卡 → 行内原因 toast（不再静默无反应）', async () => {
    seedInventory({ cannon: { one: 6 }, laser: { one: 1 } });
    const env = makeEnv(VP, 1, 'shotgun');
    env.gotoBackpack();
    env.pickCards('cannon', 4);
    env.pickCards('laser', 1); // 槽满 5（4×cannon + 1×laser）
    expect(env.hasHit('backpack-fuse'), '满 5 合成可点').toBe(true);
    env.pageTo('cannon'); // 翻回 cannon 所在页（槽位保留）
    env.clearTexts();
    env.click('backpack-select:cannon'); // cannon 仍可用（6−4），但槽已满 → 原因 toast
    expect(findText(env, /材料槽已满|槽已满/), '槽满原因行内反馈').not.toBeNull();
  });

  it('TA9. 同种 1★ 已全部放入后再点 → 行内原因 toast（不再静默无反应）', async () => {
    seedInventory({ cannon: { one: 5 } });
    const env = makeEnv(VP, 1, 'shotgun');
    env.gotoBackpack();
    env.pickCards('cannon', 5); // 可用 5 全放入
    expect(env.hasHit('backpack-fuse'), '满 5 合成可点').toBe(true);
    env.clearTexts();
    env.click('backpack-select:cannon'); // uses 5 ≥ avail 5 → 原因 toast
    expect(findText(env, /已全部放入/), '放满原因行内反馈').not.toBeNull();
  });
});
