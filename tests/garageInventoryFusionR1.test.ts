/**
 * F-GARAGE-INVENTORY-FUSION-R1｜背包信息层级 + 真实 5 合 1 玩家操作闭环定向测试。
 *
 * 承接 P0（T1-T24 纯数据/规则）之上，新增 T25-T39（UI 信息层级 + 真实 5→1 操作闭环）：
 *  - T25/T26/T27：三类分类全部部件可访问（分页可达，无屏外隐藏卡）；
 *  - T28：背包页不显示金币/段位残留（顶栏金币/段位/能量在背包页被抑制）；
 *  - T29：同页卡片 hitArea 不重叠（信息层级清晰）；
 *  - T30：选中态（暖金）与已装备态（灰蓝）可区分；
 *  - T31/T32：合成按钮文案状态（还差 N 个 / 合成）；
 *  - T33/T34/T35/T36/T37：真实 5→1（host onFuse 驱动 fuseSameStar）→ 1★-5 / 2★+1 /
 *    连点不重复 / 已装备受保护 / Build 不变 / reload 持久化；
 *  - T38：E2E 测试句柄仅进入 build:e2e（宿主守卫 + 构建 define）；
 *  - T39：普通/RC bundle-clean 无内部句柄（__fx 不进入微信/RC 包）。
 *
 * 测试策略：headless 渲染 CanvasPlayerUIHost（stub canvas + 捕获指针 + 录制 fillText），
 * 真实派发 tap → 真实 hit-test → 真实 onFuse 动作 → 断言持久化库存。不依赖真实浏览器。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import {
  getInventory,
  saveInventory,
  loadInventoryRaw,
  getCount,
  fuseSameStar,
  OFFICIAL_PARTS,
  OFFICIAL_MOVEMENTS,
} from '../src/core/partInventory';
import { OFFICIAL_BODIES } from '../src/core/bodyOwnership';
import { EMPTY_SLOT } from '../src/lab/buildEditorModel';
import { backpackCardVisualState, backpackFuseButtonLabel } from '../src/ui/canvasPlayerUIHost';
import type { PlayerUIState, PlayerUIActions } from '../src/ui/playerUI';
import type { BuildDraft } from '../src/lab/buildEditorModel';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 内存版 localStorage（node 无原生；同 P0 测试） */
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

/** 录制 fillText 的 stub ctx（同时记录 x/y，供 T29 验证信息行位置） */
function makeRecCtx(): { ctx: CanvasRenderingContext2D; texts: Array<{ text: string; x: number; y: number }> } {
  const texts: Array<{ text: string; x: number; y: number }> = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, prop) => {
      if (prop === 'fillText') return (s: string, x: number, y: number): void => void texts.push({ text: String(s), x, y });
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
    draft: makeStarterDraft('watermelonBody', registry),
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

function makeBackpackEnv(vp: { w: number; h: number }) {
  let captured: ((x: number, y: number) => void) | null = null;
  const { ctx, texts } = makeRecCtx();
  const core = createWebCore();
  bindPlatformCore({
    ...core,
    createViewport: () => ({
      surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 }),
      onResize: () => {},
      safeInsets: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
    }),
    input: { bindClick: () => {}, bindPointer: (_t: EventTarget, h: (x: number, y: number) => void) => void (captured = h) },
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  const canvas = { getContext: () => ctx, width: vp.w, height: vp.h, style: undefined } as unknown as HTMLCanvasElement;
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
    onFuse: (defId: string, star: number) => {
      const cur = getInventory();
      fuseSameStar(cur, defId, star, lastDraft);
      // 忠实模拟正式 runtime（playerGameRuntime.onFuse → pushUI）：合成后重推 UI 状态（fresh inventory）
      pushUI(lastOver);
    },
  } as unknown as PlayerUIActions;
  host.setActions(actions);
  function render(over: Partial<PlayerUIState> = {}): void {
    lastOver = over;
    pushUI(over);
  }
  function hitAreas() {
    return host.getHitAreasForTest();
  }
  function hasHit(id: string): boolean {
    return hitAreas().some((a) => a.id === id);
  }
  function click(id: string): void {
    const a = hitAreas().find((x) => x.id === id);
    if (!a) throw new Error('应存在命中区 ' + id);
    if (!captured) throw new Error('未捕获指针');
    captured(a.x + a.w / 2, a.y + a.h / 2);
  }
  /**
   * 真实玩家导航链（metaPage 是宿主私有态，不可由 PlayerUIState 注入）：
   * Home（home-garage）→ Garage 顶栏（nav:backpack）→ 背包页（bfilter:*）。
   */
  function gotoBackpack(over: Partial<PlayerUIState> = {}): void {
    render(over);
    if (hasHit('home-garage')) click('home-garage');
    if (!hasHit('bfilter:combat')) click('nav:backpack');
  }
  return { host, render, gotoBackpack, click, hasHit, texts: () => texts, clearTexts: () => void (texts.length = 0) };
}

function collectBackpackDefIds(env: ReturnType<typeof makeBackpackEnv>, filter: 'combat' | 'movement' | 'body'): string[] {
  env.gotoBackpack();
  env.click('bfilter:' + filter);
  const ids = new Set<string>();
  const grab = (): void => {
    for (const a of env.host.getHitAreasForTest()) if (a.id.startsWith('backpack-select:')) ids.add(a.id.slice('backpack-select:'.length));
  };
  grab();
  let guard = 0;
  while (env.hasHit('backpack-page-next') && guard++ < 12) {
    env.click('backpack-page-next');
    grab();
  }
  return [...ids];
}

function selectCard(env: ReturnType<typeof makeBackpackEnv>, defId: string, draft?: BuildDraft): void {
  const over: Partial<PlayerUIState> = {};
  if (draft) over.draft = draft;
  env.gotoBackpack(over);
  env.click('bfilter:combat');
  let guard = 0;
  while (guard++ < 12) {
    if (env.hasHit('backpack-select:' + defId)) {
      env.click('backpack-select:' + defId);
      return;
    }
    if (env.hasHit('backpack-page-next')) env.click('backpack-page-next');
    else break;
  }
  throw new Error('未找到卡片 ' + defId);
}

function cannonEquipDraft(): BuildDraft {
  const d = makeStarterDraft('watermelonBody', registry);
  d.functionalSelections = { front: 'cannon' };
  return d;
}

/**
 * 无 cannon 装备的 Build（starter draft 默认在 frontMass 装了 cannon，
 * 会占用 1 件 1★ → available 少 1）。§四「种子 cannon 1★=5 且全部未装备」需要此裸 Build。
 */
function bareDraft(): BuildDraft {
  const d = makeStarterDraft('watermelonBody', registry);
  const sel: Record<string, string> = {};
  for (const k of Object.keys(d.functionalSelections)) sel[k] = EMPTY_SLOT;
  d.functionalSelections = sel;
  return d;
}

function rectsOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

describe('F-GARAGE-INVENTORY-FUSION-R1 A｜信息层级 / 可访问性', () => {
  it('T25. 战斗分类 11 个正式部件全部可访问（分页可达，无屏外隐藏卡）', () => {
    const env = makeBackpackEnv({ w: 844, h: 390 });
    const ids = collectBackpackDefIds(env, 'combat');
    expect(ids.length).toBe(11);
    expect([...new Set(ids)].sort()).toEqual([...OFFICIAL_PARTS].sort());
  });

  it('T26. 移动分类 3 项全部可访问', () => {
    const env = makeBackpackEnv({ w: 844, h: 390 });
    const ids = collectBackpackDefIds(env, 'movement');
    expect(ids.length).toBe(3);
    expect([...new Set(ids)].sort()).toEqual([...OFFICIAL_MOVEMENTS].sort());
  });

  it('T27. 车身分类 8 项全部可访问', () => {
    const env = makeBackpackEnv({ w: 844, h: 390 });
    const ids = collectBackpackDefIds(env, 'body');
    expect(ids.length).toBe(8);
    expect([...new Set(ids)].sort()).toEqual([...OFFICIAL_BODIES].sort());
  });

  it('T28. 背包页不显示金币/段位残留（顶栏金币/段位/能量被抑制）', () => {
    const env = makeBackpackEnv({ w: 844, h: 390 });
    env.gotoBackpack();
    // 导航链途经 Home / Garage 顶栏（那里本就有金币/段位）→ 只采集背包页当帧文本
    env.clearTexts();
    env.render();
    expect(env.texts().length, '背包页应有文本渲染').toBeGreaterThan(0);
    const bad = env.texts().filter((t) => /金币|段位/.test(t.text));
    expect(bad.map((t) => t.text)).toEqual([]);
    // 标题/返回/分类仍在（信息层级保留必要项）
    const all = env.texts().map((t) => t.text);
    expect(all.some((t) => t.includes('背包'))).toBe(true);
    expect(all.some((t) => t.includes('返回车库'))).toBe(true);
  });

  it('T29. 背包卡片不重叠（同页 hitArea 互斥 + 卡内信息行齐全）', () => {
    const env = makeBackpackEnv({ w: 844, h: 390 });
    env.gotoBackpack();
    env.clearTexts();
    env.click('bfilter:combat');
    const cards = env.host.getHitAreasForTest().filter((a) => a.id.startsWith('backpack-select:'));
    expect(cards.length).toBeGreaterThan(0);
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        expect(rectsOverlap(cards[i], cards[j]), `卡片 ${cards[i].id} 与 ${cards[j].id} 重叠`).toBe(false);
      }
    }
    // 每张卡都渲染数量口径行：已获得 →「总 N · 装备 N · 可合 N」；未获得 →「未获得」（无歧义空白）
    const owned = env.texts().filter((t) => /总 \d+ · 装备 \d+ · 可合 \d+/.test(t.text));
    const unowned = env.texts().filter((t) => t.text === '未获得');
    expect(owned.length, '应有已获得卡片的数量信息行').toBeGreaterThan(0);
    expect(owned.length + unowned.length).toBe(cards.length);
    // 星级行（★×N / ★★×N / 「—」占位）每卡一条
    const stars = env.texts().filter((t) => /★/.test(t.text) || t.text === '—');
    expect(stars.length).toBeGreaterThanOrEqual(cards.length);
  });

  it('T30. 选中态（暖金）与已装备态（灰蓝）可区分', () => {
    expect(backpackCardVisualState(true, false)).toBe('selected');
    expect(backpackCardVisualState(false, true)).toBe('equipped');
    expect(backpackCardVisualState(false, false)).toBe('normal');
    expect(backpackCardVisualState(true, false)).not.toBe(backpackCardVisualState(false, true));
  });
});

describe('F-GARAGE-INVENTORY-FUSION-R1 B｜合成按钮状态', () => {
  it('T31. 可用=4 → 文案「还差 1 个」（<5 不可合）', () => {
    expect(backpackFuseButtonLabel({ ok: false, available: 4, need: 5, maxStar: false }, true)).toBe('还差 1 个');
  });
  it('T32. 可用≥5 → 文案「合成」；满星「已满星」；未获得空', () => {
    expect(backpackFuseButtonLabel({ ok: true, available: 5, need: 5, maxStar: false }, true)).toBe('合成');
    expect(backpackFuseButtonLabel({ ok: false, available: 5, need: 5, maxStar: true }, true)).toBe('已满星');
    expect(backpackFuseButtonLabel({ ok: false, available: 0, need: 5, maxStar: false }, false)).toBe('');
  });
});

describe('F-GARAGE-INVENTORY-FUSION-R1 C｜真实 5 合 1 操作闭环', () => {
  it('T33. 实际 5×1★ → 1×2★（1★-5、2★+1，原子持久化）', () => {
    const env = makeBackpackEnv({ w: 844, h: 390 });
    saveInventory({ cannon: { one: 5, two: 0 } });
    selectCard(env, 'cannon', bareDraft());
    expect(env.hasHit('backpack-fuse'), '可用 5 → 合成按钮可点').toBe(true);
    env.click('backpack-fuse');
    expect(getCount(getInventory(), 'cannon', 1)).toBe(0);
    expect(getCount(getInventory(), 'cannon', 2)).toBe(1);
  });

  it('T34. 连点不重复消耗（合成后按钮 disabled，无法二次触发）', () => {
    const env = makeBackpackEnv({ w: 844, h: 390 });
    saveInventory({ cannon: { one: 5, two: 0 } });
    selectCard(env, 'cannon', bareDraft());
    env.click('backpack-fuse');
    expect(getCount(getInventory(), 'cannon', 2)).toBe(1);
    // 合成成功后面板重绘：可用=0 → 按钮 disabled（不再注册命中）→ 第二次点击不可达
    expect(env.hasHit('backpack-fuse')).toBe(false);
    expect(getCount(getInventory(), 'cannon', 1)).toBe(0);
  });

  it('T35. 已装备副本受保护：拥有5装备1不可合；拥有6装备1可合且装备1不被消耗', () => {
    const env = makeBackpackEnv({ w: 844, h: 390 });
    const eq = cannonEquipDraft();
    // 拥有 5、装备 1 → available 4 → 不可合
    saveInventory({ cannon: { one: 5, two: 0 } });
    selectCard(env, 'cannon', eq);
    expect(env.hasHit('backpack-fuse')).toBe(false);
    expect(getCount(getInventory(), 'cannon', 1)).toBe(5);
    // 拥有 6、装备 1 → available 5 → 可合，装备中的 1 件不被消耗
    saveInventory({ cannon: { one: 6, two: 0 } });
    selectCard(env, 'cannon', eq);
    expect(env.hasHit('backpack-fuse')).toBe(true);
    env.click('backpack-fuse');
    expect(getCount(getInventory(), 'cannon', 1)).toBe(1); // 装备中的 1 件未被消耗
    expect(getCount(getInventory(), 'cannon', 2)).toBe(1);
  });

  it('T36. 合成后 Build 不变（draft 引用与字段未改）', () => {
    const env = makeBackpackEnv({ w: 844, h: 390 });
    saveInventory({ cannon: { one: 5, two: 0 } });
    const d = bareDraft();
    const snapshot = JSON.stringify(d);
    selectCard(env, 'cannon', d);
    env.click('backpack-fuse');
    expect(JSON.stringify(d)).toBe(snapshot);
  });

  it('T37. reload 后合成结果保持（localStorage 持久化，等价重进读取）', () => {
    const env = makeBackpackEnv({ w: 844, h: 390 });
    saveInventory({ cannon: { one: 5, two: 0 } });
    selectCard(env, 'cannon', bareDraft());
    env.click('backpack-fuse');
    const reloaded = loadInventoryRaw();
    expect(reloaded, '合成结果应已落盘（等价重进读取）').not.toBeNull();
    expect(getCount(reloaded as NonNullable<typeof reloaded>, 'cannon', 2)).toBe(1);
    expect(getCount(reloaded as NonNullable<typeof reloaded>, 'cannon', 1)).toBe(0);
  });
});

describe('F-GARAGE-INVENTORY-FUSION-R1 D｜E2E 句柄隔离', () => {
  it('T38. E2E 测试句柄仅进入 build:e2e（宿主守卫 + 构建 define）', () => {
    const uiSrc = readFileSync(resolve(__dirname, '../src/ui/canvasPlayerUIHost.ts'), 'utf8');
    const e2eCfg = readFileSync(resolve(__dirname, '../vite.e2e.config.ts'), 'utf8');
    const wxCfg = readFileSync(resolve(__dirname, '../vite.wechat.config.ts'), 'utf8');
    const pagesCfg = readFileSync(resolve(__dirname, '../vite.pages.config.ts'), 'utf8');
    const webCfg = readFileSync(resolve(__dirname, '../vite.config.ts'), 'utf8');
    expect(e2eCfg).toContain("__E2E_INTERNAL_HANDLE__: 'true'");
    for (const c of [wxCfg, pagesCfg, webCfg]) expect(c).toContain("__E2E_INTERNAL_HANDLE__: 'false'");
    // 宿主每一处 __inv 赋值（种子句柄实现）都必须落在 __E2E_INTERNAL_HANDLE__ 守卫内
    const ASSIGN = '.__inv = {';
    let from = 0;
    let n = 0;
    for (;;) {
      const idx = uiSrc.indexOf(ASSIGN, from);
      if (idx < 0) break;
      n++;
      const condStart = uiSrc.lastIndexOf('if (typeof', idx);
      expect(condStart, `第 ${n} 处 __inv 赋值前应有 if (typeof 守卫`).toBeGreaterThan(-1);
      expect(uiSrc.slice(condStart, idx), `第 ${n} 处 __inv 赋值应被 __E2E_INTERNAL_HANDLE__ 守卫`).toContain(
        '__E2E_INTERNAL_HANDLE__',
      );
      from = idx + ASSIGN.length;
    }
    expect(n, '宿主应含 __inv 种子句柄实现').toBeGreaterThan(0);
    expect(uiSrc).toContain('seedInventory: (seed');
    // 命名空间不得与 main.ts 的表现层特效探针（__fx）冲突——同名直接赋值会互相覆盖，
    // 实测表现为浏览器里 window.__fx 只剩 spawnDamage/... 、seedInventory 被抹掉。
    expect(uiSrc, '库存种子句柄不得再挂在 __fx（已被特效探针占用）').not.toContain('.__fx = {');
  });

  it('T39. 普通/RC bundle-clean 无内部句柄（__inv 不进入微信/RC 包）', () => {
    const CHECK = resolve(__dirname, '../scripts/check-wechat-bundle-clean.js');
    // 规则校验（无条件执行）：rc/wechat 模式必须拦下 __inv，e2e 模式必须放行
    const dir = mkdtempSync(join(tmpdir(), 'bc-r1-'));
    const f = join(dir, 'game.js');
    writeFileSync(f, 'globalThis.__inv = { seedInventory: () => {} };');
    const rc = spawnSync(process.execPath, [CHECK, f, 'rc'], { encoding: 'utf8' });
    const wx = spawnSync(process.execPath, [CHECK, f, 'wechat'], { encoding: 'utf8' });
    const e2e = spawnSync(process.execPath, [CHECK, f, 'e2e'], { encoding: 'utf8' });
    rmSync(dir, { recursive: true, force: true });
    expect(rc.status, 'rc 模式命中 __inv 必须失败').toBe(1);
    expect(wx.status, 'wechat 模式命中 __inv 必须失败').toBe(1);
    expect(e2e.status, 'e2e 模式 allowlist 放行 __inv').toBe(0);
    // 已构建的微信包（若存在）必须实测干净
    const bundle = resolve(__dirname, '../dist-wechat/game.js');
    if (existsSync(bundle)) {
      const r = spawnSync(process.execPath, [CHECK, bundle, 'wechat'], { encoding: 'utf8' });
      expect(r.status, '已构建微信包应无内部句柄').toBe(0);
    }
  });
});
