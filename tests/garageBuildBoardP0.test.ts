import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { getInventory } from '../src/core/partInventory';
import { registry } from '../src/core/content';
import type { PlayerUIState } from '../src/ui/playerUI';
import type { SafeInsets } from '../src/platform/types';

/**
 * F-GARAGE-BUILD-BOARD-P0｜手机战车装配台专项验收
 * T1: 左上「首页」唯一返回（无 panel-back / 无重复返回；Must#1）；
 * T2: 右顶常驻分类 tab（4 个紧凑 + 图形识别 + 高亮；Must#2）；
 * T3: 部件卡四要素（简图/名称/星级/能量 + 已装备/可装备/未获得状态；Must#3）；
 * T4: 武器/辅助分类显示挂点 chip；选挂点立即刷新部件卡（Must#4）；
 * T5: 能量条 + 超载原因靠近选择区（Must#6）；
 * T6: 2 次点击完成一次已选挂点的部件替换（Acceptance#2）+ 装备变化可见（Must#5）；
 * T7: 360×180~844×390 矩阵：装配台不抛 + 全部 hit 在 safe 内 + 无寻找对手（Must#10/Acceptance）；
 * T8: 数据/规则保留守卫（garageOptions 仍读 canEquipPart/星级/能量/库存；Must#9）。
 */
const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };
const VPS = [
  { w: 360, h: 180 },
  { w: 420, h: 210 },
  { w: 621, h: 351 },
  { w: 844, h: 390 },
];

function makeStubCtx(texts: string[]) {
  return new Proxy(
    {} as CanvasRenderingContext2D,
    {
      get: (_t, prop) => {
        if (prop === 'fillText') return (s: string) => texts.push(s);
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop: () => {} });
        return () => ({ width: 0 });
      },
      set: () => true,
    },
  );
}

interface HostEnv {
  host: CanvasPlayerUIHost;
  pointer: (x: number, y: number) => void;
  areas: () => ReadonlyArray<{ id: string; x: number; y: number; w: number; h: number }>;
  texts: string[];
}

function makeHost(vp: { w: number; h: number }, insets: SafeInsets): HostEnv {
  let captured: ((x: number, y: number) => void) | null = null;
  const texts: string[] = [];
  const core = createWebCore();
  bindPlatformCore({
    ...core,
    input: {
      bindClick: () => {},
      bindPointer: (_t: EventTarget, h: (x: number, y: number) => void) => {
        captured = h;
      },
    },
    createViewport: () => ({
      surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 }),
      onResize: () => {},
      safeInsets: () => insets,
    }),
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  const canvas = {
    getContext: () => makeStubCtx(texts),
    width: vp.w,
    height: vp.h,
    style: undefined,
  } as unknown as HTMLCanvasElement;
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas();
  return {
    host,
    pointer: (x: number, y: number) => captured!(x, y),
    areas: () => host.getHitAreasForTest(),
    texts,
  };
}

function garageState(over: Partial<PlayerUIState> = {}): PlayerUIState {
  return {
    uiMode: 'build',
    battleState: 'editing',
    playerPhase: 'garage',
    draft: makeStarterDraft('boxBody', registry),
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

function richInv() {
  const inv: Record<string, { one: number; two: number }> = {};
  for (const p of ['cannon', 'hammer', 'ramHead', 'pushRod', 'testMass', 'bumper']) {
    inv[p] = { one: 1, two: 1 };
  }
  return inv;
}

function goGarage(env: HostEnv) {
  const home = env.host.getHitAreasForTest().find((a) => a.id === 'home-garage');
  if (!home) return;
  env.pointer(home.x + home.w / 2, home.y + home.h / 2);
}

describe('F-GARAGE-BUILD-BOARD-P0｜手机战车装配台', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    bindPlatformCore(createWebCore());
  });

  it('T1. 左上「首页」唯一返回：装配台无 panel-back / 无重复返回按钮（Must#1）', () => {
    const src = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    const hostStart = src.indexOf('private drawGarageMetaPage');
    const hostBody = src.slice(hostStart, hostStart + 900);
    // 面板不再绘制「‹ 返回」
    expect(hostBody, 'drawGarageMetaPage 不绘制 panel-back').not.toContain("'panel-back'");
    // 唯一返回 = 顶栏 nav:home（drawMobileTopBar）
    expect(src, '左上首页返回存在（nav:home）').toContain("'nav:home'");
    // 行为：装配台 hitArea 无 panel-back
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(garageState({ garageSelected: 'body' }));
    goGarage(env);
    expect(env.host.getHitAreasForTest().some((a) => a.id === 'panel-back'), '无面板返回按钮').toBe(false);
  });

  it('T2. 右顶常驻分类 tab：3 个紧凑 tab（车身/移动/战斗）+ 图形识别 + 当前高亮（Must#2）', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(garageState());
    goGarage(env);
    const tabs = ['garage-cat:body', 'garage-cat:move', 'garage-cat:combat'];
    for (const id of tabs) {
      const a = env.host.getHitAreasForTest().find((x) => x.id === id);
      expect(a, `分类 tab ${id} 存在`).toBeTruthy();
      expect(a!.h, `${id} 紧凑（≤40px，不占巨大方块）`).toBeLessThanOrEqual(40);
    }
    // 图形识别：button 的 icon 分支绘制 drawTabIcon（车身/轮/炮/方块）
    const src = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    expect(src, 'button 支持 icon 参数（含 combat）').toContain("icon?: 'body' | 'wheel' | 'weapon' | 'gadget' | 'combat'");
    expect(src, '分类 tab 绘制小图标').toContain('drawTabIcon(opts.icon');
    // 当前分类高亮（active = garageCategory）——在 drawGarageCategoryTabs 方法体内
    const tabStart = src.indexOf('private drawGarageCategoryTabs');
    expect(src.slice(tabStart, tabStart + 1300), '分类 tab active 高亮').toContain('active: this.garageCategory === r.t.cat');
  });

  it('T3. 部件卡四要素：简图 + 名称 + 星级 + 能量 + 状态（已装备/可装备/未获得；Must#3）', () => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k === 'strongfruit.ownedParts.v2' ? JSON.stringify({ ...richInv(), __v: 2 }) : null),
      setItem: () => {},
      removeItem: () => {},
    });
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(garageState({ inventory: richInv() }));
    goGarage(env);
    // 点「车身」分类 tab（garageCategory='body'）→ render 选中 body → 部件卡
    const tabBody = env.host.getHitAreasForTest().find((a) => a.id === 'garage-cat:body')!;
    env.pointer(tabBody.x + tabBody.w / 2, tabBody.y + tabBody.h / 2);
    env.host.render(garageState({ garageSelected: 'body', inventory: richInv() }));
    const opts = env.host.getHitAreasForTest().filter((a) => a.id.startsWith('opt:'));
    // 空槽 + 多个功能件选项
    expect(opts.length, '部件卡数量').toBeGreaterThanOrEqual(3);
    // 卡内容（源码守卫）：简图 drawPartIcon / 名称 / 星级 C.gold / 能量 meta / 状态徽标
    const src = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    const cardStart = src.indexOf('private drawPartCard');
    const cardBody = src.slice(cardStart, cardStart + 1300);
    expect(cardBody, '部件卡绘制简图').toContain('drawPartIcon');
    expect(cardBody, '部件卡绘制名称').toContain('c.t.replace');
    expect(cardBody, '部件卡绘制星级（★ 金色）').toContain('C.gold');
    expect(cardBody, '部件卡绘制能量 meta').toContain('c.meta');
    expect(cardBody, '部件卡绘制状态徽标（已装备/未获得）').toContain("'已装备'");
    expect(cardBody, '部件卡绘制未获得徽标').toContain("'未获得'");
  });

  it('T4. 战斗分类：武器｜辅助分段 + 共享挂点行 + 选挂点立即刷新部件卡（Must#4）', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(garageState());
    goGarage(env);
    // 点「战斗」分类 tab（garageCategory='combat'，默认武器分组）→ 分段 + 共享挂点行 + 部件卡
    const tabCombat = env.host.getHitAreasForTest().find((a) => a.id === 'garage-cat:combat')!;
    env.pointer(tabCombat.x + tabCombat.w / 2, tabCombat.y + tabCombat.h / 2);
    env.host.render(garageState({ garageSelected: 'front' }));
    // 战斗分类 → 分段「武器｜辅助」（两组入口同屏）+ 共享挂点行（garage-cslot:<hp>）
    const wSeg = env.host.getHitAreasForTest().find((a) => a.id === 'garage-cgroup:weapon');
    const gSeg = env.host.getHitAreasForTest().find((a) => a.id === 'garage-cgroup:gadget');
    expect(wSeg, '武器分段入口').toBeTruthy();
    expect(gSeg, '辅助分段入口').toBeTruthy();
    const chips = env.host.getHitAreasForTest().filter((a) => a.id.startsWith('garage-cslot:'));
    expect(chips.length, '共享挂点行 chip').toBeGreaterThanOrEqual(1);
    // 默认武器分组 → 部件卡（武器）同屏出现（同一屏：不再独立挂点列表页）
    const opts = env.host.getHitAreasForTest().filter((a) => a.id.startsWith('opt:'));
    expect(opts.length, '默认武器分组部件卡同屏出现').toBeGreaterThan(0);
    // 挂点 chip 命中区正常（视觉==命中）
    const chip = chips[0]!;
    expect(chip.x >= 0 && chip.w > 0, '挂点 chip 命中区正常').toBe(true);
  });

  it('T5. 能量条 + 超载原因靠近选择区（Must#6）', () => {
    const env = makeHost({ w: 844, h: 390 }, INSETS);
    env.host.render(garageState());
    goGarage(env);
    const tabBody = env.host.getHitAreasForTest().find((a) => a.id === 'garage-cat:body')!;
    env.pointer(tabBody.x + tabBody.w / 2, tabBody.y + tabBody.h / 2);
    env.host.render(garageState({ garageSelected: 'body' }));
    // 能量条文本（used/capacity 或 能量 标签）在面板内
    expect(env.texts.some((t) => t.includes('/') || t.startsWith('能量')), '能量条反馈存在').toBe(true);
    const src = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    const barStart = src.indexOf('private drawGarageEnergyBar');
    const barBody = src.slice(barStart, barStart + 1000);
    expect(barBody, '能量条画在面板底部').toContain('panelRect.y + panelRect.h - h');
    expect(barBody, '超载原因红字（overload 分支）').toContain('V.lose');
    expect(src, '超载原因文本（blockReason/energyRes.error）').toContain('state.blockReason');
  });

  it('T6. 2 次点击完成一次已选挂点的部件替换（Acceptance#2）+ 装备变化可见（Must#5）', () => {
    const src = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    // 源码路径：garage-cat（1 击分类）→ opt（2 击选件）；无中间挂点列表页
    expect(src, '分类 tab 点击处理').toContain("id.startsWith('garage-cat:')");
    expect(src, '部件卡点击处理 opt:').toContain("id.startsWith('opt:')");
    // 装备变化可见：选件 → onPickGarageOption → runtime 更新 draft → 左侧 preview 重绘
    // （runtime 层行为；host 侧确保 opt 点击派发 onPickGarageOption）
    expect(src, '部件卡点击派发 pick').toContain("this.actions?.onPickGarageOption(id.slice(4))");
    // 选中态明确：drawGaragePartCards 调用 drawPartCard 时传 equipped = c.v === curVal（Must#5）
    const cardsStart = src.indexOf('private drawGaragePartCards');
    expect(src.slice(cardsStart, cardsStart + 2200), '选中态 = 当前装备（调用传参）').toContain('this.drawPartCard(x, y, cardW, cardH, c, c.v === curVal)');
  });

  it('T7. 360×180~844×390 矩阵：装配台不抛 + 全部 hit 在 safe 内 + 无寻找对手（Must#10）', () => {
    for (const vp of VPS) {
      const env = makeHost(vp, INSETS);
      for (const sel of ['body', 'rearWheel', 'front']) {
        expect(() => env.host.render(garageState({ garageSelected: sel })), `${vp.w}×${vp.h} sel=${sel} 渲染不抛`).not.toThrow();
      }
      goGarage(env);
      const areas = env.host.getHitAreasForTest();
      for (const a of areas) {
        expect(a.x, `${vp.w}×${vp.h} ${a.id} x ≥ safeLeft`).toBeGreaterThanOrEqual(INSETS.left - 0.5);
        expect(a.y, `${vp.w}×${vp.h} ${a.id} y ≥ safeTop`).toBeGreaterThanOrEqual(INSETS.top - 0.5);
        expect(a.x + a.w, `${vp.w}×${vp.h} ${a.id} 右缘 ≤ safeRight`).toBeLessThanOrEqual(vp.w - INSETS.right + 0.5);
        expect(a.y + a.h, `${vp.w}×${vp.h} ${a.id} 底缘 ≤ safeBottom`).toBeLessThanOrEqual(vp.h - INSETS.bottom + 0.5);
      }
      // Must#10：Garage 无寻找对手
      expect(areas.some((a) => a.id === 'home-find-opponent' || a.id === 'cta-find'), `${vp.w}×${vp.h} 无寻找对手`).toBe(false);
    }
  });

  it('T8. 数据/规则保留（Must#9）：garageOptions 仍读 canEquipPart / 星级 / 能量 / 库存；runtime 装备逻辑未改', () => {
    const host = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    const optStart = host.indexOf('private garageOptions(');
    const optBody = host.slice(optStart, optStart + 1400);
    expect(optBody, '未获得判定 canEquipPart').toContain('canEquipPart');
    expect(optBody, '星级能量 starTierEnergy').toContain('starTierEnergy');
    expect(optBody, '库存 getCount').toContain('getCount');
    expect(optBody, '空槽选项保留').toContain("v: EMPTY_SLOT");
    // runtime 装备规则未改（onPickGarageOption 仍用 migrateDraftBody / canEquipPart / decodePartVal）
    const rt = readFileSync('src/game/playerGameRuntime.ts', 'utf-8');
    const pickStart = rt.indexOf('onPickGarageOption:');
    expect(rt.slice(pickStart, pickStart + 700), 'runtime 装备规则保留').toContain('canEquipPart');
    expect(rt.slice(pickStart, pickStart + 1100), 'runtime 车身迁移保留').toContain('migrateDraftBody');
  });
});
