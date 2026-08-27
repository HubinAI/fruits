import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { getInventory } from '../src/core/partInventory';
import { registry } from '../src/core/content';
import { decodePartVal } from '../src/ui/playerUI';
import { EMPTY_SLOT } from '../src/lab/buildEditorModel';
import type { PlayerUIState } from '../src/ui/playerUI';
import type { SafeInsets } from '../src/platform/types';

/**
 * F-GARAGE-COMBAT-TAB-R1｜合并武器与辅助入口，突出战斗配置 — 专项验收（Acceptance #1~#7）。
 *
 * A1：一眼看出 Garage 核心调整入口是「战斗」（最宽 + 金橙强调；未选中也清晰可辨，绝不似「已选中」）。
 * A2：顶部只存在 车身 / 移动 / 战斗 三个主分类（武器+辅助合并）。
 * A3：战斗页内一次点击即在 武器挂点 / 辅助挂点 两组间切换（≤1 击）。
 * A4：≤2 次点击完成一个已选挂点的部件替换。
 * A5：装备变更立即派发 onPickGarageOption（左侧战车实时重绘的前提）。
 * A6：旧 武器 / 辅助 主 tab 与隐藏 hit area 全部消失（无 garage-cat:weapon/gadget、无 weapon-slot:）。
 * A7：360×180~1920×1008 可见、可点、不溢出（所有 hit 在 safe area 内）。
 *
 * 注：weapon/gadget 在内部仍为两类（FunctionalHardpointDef 无 category；过滤仅展示层），
 * 本测试断言「合并仅在展示层，内部类型不变」（A2 合并 + A3 分组过滤 + A6 无类型合并）。
 */
const INSETS: SafeInsets = { left: 44, right: 20, top: 12, bottom: 16 };
// 紧凑横屏（Compact Mobile Landscape）viewport：h<600 且 aspect≥1.5 → 走 Mobile Profile（garage-cat tab）。
// 360×180 为最严苛矮屏；其余覆盖 mobile-short → mobile-normal。1920×1008 走 Desktop，
// 真实部署经 phoneLogical 强制 Mobile（见 A7b），故此处不纳入 Mobile 循环。
const VPS = [
  { w: 360, h: 180 },
  { w: 420, h: 210 },
  { w: 621, h: 351 },
  { w: 844, h: 390 },
  { w: 1024, h: 480 },
  { w: 1280, h: 540 },
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
  fired: Record<string, string[]>;
  texts: string[];
}

function makeHost(vp: { w: number; h: number }, insets: SafeInsets, phoneLogical = false): HostEnv {
  let captured: ((x: number, y: number) => void) | null = null;
  const fired: Record<string, string[]> = {};
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
  const host = new CanvasPlayerUIHost(canvas, { phoneLogical });
  host.mountCanvas();
  const rec = (k: string) => (v: string) => void (fired[k] = [...(fired[k] ?? []), v]);
  host.setActions({
    onToggleGarageSlot: rec('toggle'),
    selectGarageSlot: rec('select'),
    onPickGarageOption: rec('pick'),
    onFindOpponent: () => {},
    onMatchAdjust: () => {},
    onStartBattle: () => {},
    onResultAdjust: () => {},
    onResultNext: () => {},
    onClaimRewardAd: () => {},
    onMerge: () => {},
    onResetProgress: () => {},
  });
  return {
    host,
    pointer: (x: number, y: number) => captured!(x, y),
    areas: () => host.getHitAreasForTest(),
    fired,
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

function goGarage(env: HostEnv): void {
  const home = env.areas().find((a) => a.id === 'home-garage')!;
  env.pointer(home.x + home.w / 2, home.y + home.h / 2);
}

const optDefCategory = (optId: string): string | null => {
  const v = optId.slice('opt:'.length);
  if (v === EMPTY_SLOT) return null;
  const { defId } = decodePartVal(v);
  return registry.functionals.get(defId)?.category ?? null;
};

describe('F-GARAGE-COMBAT-TAB-R1｜战斗配置入口合并与突出', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
  });

  it('A2｜顶部只存在 车身/移动/战斗 三个主分类（武器+辅助合并，无 garage-cat:weapon/gadget）', () => {
    for (const vp of VPS) {
      const env = makeHost(vp, INSETS);
      env.host.render(garageState());
      goGarage(env);
      const cats = env.areas().filter((a) => a.id.startsWith('garage-cat:')).map((a) => a.id);
      expect(cats, `${vp.w}×${vp.h} 恰好 3 个主分类`).toHaveLength(3);
      for (const id of ['garage-cat:body', 'garage-cat:move', 'garage-cat:combat']) {
        expect(cats, `${vp.w}×${vp.h} 应含 ${id}`).toContain(id);
      }
      // 旧武器/辅助主 tab 彻底消失
      expect(cats.some((id) => id === 'garage-cat:weapon' || id === 'garage-cat:gadget'),
        `${vp.w}×${vp.h} 无旧武器/辅助主 tab`).toBe(false);
    }
  });

  it('A1｜「战斗」是最宽的主分类（金橙强调，突出主入口）；未选中也清晰可辨（源码：选中/未选中填充不同）', () => {
    for (const vp of VPS) {
      const env = makeHost(vp, INSETS);
      env.host.render(garageState());
      goGarage(env);
      const combat = env.areas().find((a) => a.id === 'garage-cat:combat')!;
      const body = env.areas().find((a) => a.id === 'garage-cat:body')!;
      const move = env.areas().find((a) => a.id === 'garage-cat:move')!;
      expect(combat.w, `${vp.w}×${vp.h} 战斗 tab 最宽`).toBeGreaterThan(body.w);
      expect(combat.w, `${vp.w}×${vp.h} 战斗 tab 最宽`).toBeGreaterThan(move.w);
      // 战斗 tab 至少占总宽 40%（明显大于另两个）
      const total = body.w + move.w + combat.w;
      expect(combat.w / total, `${vp.w}×${vp.h} 战斗 tab 占比 > 40%`).toBeGreaterThan(0.4);
    }
    // 源码守卫：combat 选用不同填充区分 选中/未选中（未选中绝不似「已选中」）
    const src = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
    const btnStart = src.indexOf('private button(');
    const btnBody = src.slice(btnStart, btnStart + 4000);
    expect(btnBody, 'combat 未选中填充（暗金）').toContain('rgba(58,44,18,0.62)');
    expect(btnBody, 'combat 选中填充（金橙实心）').toContain('rgba(222,164,52,0.96)');
    // 战斗 tab 图标 = 闪电（drawTabIcon 含 'combat' 分支）
    expect(src, 'drawTabIcon 含 combat 分支').toContain("else if (kind === 'combat')");
  });

  it('A3｜战斗页内一次点击切换 武器挂点/辅助挂点 两组（≤1 击；内部 weapon/gadget 类型不变）', () => {
    const vp = { w: 844, h: 390 };
    const env = makeHost(vp, INSETS);
    env.host.render(garageState());
    goGarage(env);
    // 进入战斗（默认武器分组）
    const combat = env.areas().find((a) => a.id === 'garage-cat:combat')!;
    env.pointer(combat.x + combat.w / 2, combat.y + combat.h / 2);
    const fnSlot = env.fired['toggle'].slice(-1)[0];
    expect(fnSlot, '战斗页默认自动选中一个硬点').toBeTruthy();
    env.host.render(garageState({ garageSelected: fnSlot }));
    // 武器分组部件卡（均为 weapon 类别，空槽除外）
    const weaponOpts = env.areas().filter((a) => a.id.startsWith('opt:')).map((a) => a.id);
    expect(weaponOpts.length, '武器分组展开部件卡').toBeGreaterThan(0);
    for (const id of weaponOpts) {
      const cat = optDefCategory(id);
      expect(cat === null || cat === 'weapon', `武器分组只显示 weapon（${id}）`).toBe(true);
    }
    // 一次点击「辅助」分段 → 切换到 gadget 分组（≤1 击；内部类型不变）
    const gSeg = env.areas().find((a) => a.id === 'garage-cgroup:gadget');
    expect(gSeg, '辅助分段入口存在').toBeTruthy();
    env.pointer(gSeg!.x + gSeg!.w / 2, gSeg!.y + gSeg!.h / 2);
    // 分段点击只切过滤分组（不派发 toggle/select）；分组状态在 host 内部保持
    env.host.render(garageState({ garageSelected: fnSlot }));
    // 切换后：gadget 分组部件卡（均为 gadget 类别）
    const gadgetOpts = env.areas().filter((a) => a.id.startsWith('opt:')).map((a) => a.id);
    expect(gadgetOpts.length, '辅助分组展开部件卡').toBeGreaterThan(0);
    for (const id of gadgetOpts) {
      const cat = optDefCategory(id);
      expect(cat === null || cat === 'gadget', `辅助分组只显示 gadget（${id}）`).toBe(true);
    }
    // 内部类型未合并：weapon/gadget 仍是两个独立类别（过滤结果互斥且完整）
    expect(weaponOpts.some((id) => optDefCategory(id) === 'weapon'), '武器组含 weapon 件').toBe(true);
    expect(gadgetOpts.some((id) => optDefCategory(id) === 'gadget'), '辅助组含 gadget 件').toBe(true);
    // 共享挂点行 chip 点击 → selectGarageSlot（只选不收起；分组由分段决定）
    const chip = env.areas().find((a) => a.id.startsWith('garage-cslot:'));
    expect(chip, '共享挂点 chip 存在').toBeTruthy();
    const cHp = chip!.id.slice('garage-cslot:'.length);
    env.pointer(chip!.x + chip!.w / 2, chip!.y + chip!.h / 2);
    expect(env.fired['select'], '点击挂点 chip 派发 selectGarageSlot').toContain(cHp);
  });

  it('A4+A5｜≤2 次点击完成部件替换：点「战斗」(1) → 点部件卡(2) 派发 onPickGarageOption', () => {
    const vp = { w: 844, h: 390 };
    const env = makeHost(vp, INSETS);
    env.host.render(garageState());
    goGarage(env);
    const combat = env.areas().find((a) => a.id === 'garage-cat:combat')!;
    env.pointer(combat.x + combat.w / 2, combat.y + combat.h / 2); // 第 1 击：进入战斗 + 默认武器分组 + 选硬点
    const fnSlot = env.fired['toggle'].slice(-1)[0];
    env.host.render(garageState({ garageSelected: fnSlot }));
    const opt = env.areas().find((a) => a.id.startsWith('opt:') && a.id !== 'opt:none');
    expect(opt, '战斗页应展开部件卡').toBeTruthy();
    env.pointer(opt!.x + opt!.w / 2, opt!.y + opt!.h / 2); // 第 2 击：选装
    expect(env.fired['pick'].length, '2 击内完成换装 pick 派发').toBeGreaterThanOrEqual(1);
    expect(env.fired['pick'][0], 'pick 派发值 = 部件 val').toBe(opt!.id.slice('opt:'.length));
  });

  it('A6｜旧武器/辅助主 tab 与隐藏 hit area 全部消失（无 garage-cat:weapon/gadget、无 weapon-slot:、无独立硬点列表页）', () => {
    const vp = { w: 844, h: 390 };
    const env = makeHost(vp, INSETS);
    env.host.render(garageState());
    goGarage(env);
    expect(env.areas().some((a) => a.id === 'garage-cat:weapon' || a.id === 'garage-cat:gadget'),
      '无旧武器/辅助主 tab').toBe(false);
    expect(env.areas().some((a) => a.id.startsWith('weapon-slot:')), '无隐藏 weapon-slot: hit').toBe(false);
    expect(env.areas().some((a) => a.id.startsWith('gadget-slot:')), '无隐藏 gadget-slot: hit').toBe(false);
    // 战斗页用「武器｜辅助」分段控件 + 共享挂点行（garage-cgroup: / garage-cslot:），非分组前缀 chip
    const combat = env.areas().find((a) => a.id === 'garage-cat:combat')!;
    env.pointer(combat.x + combat.w / 2, combat.y + combat.h / 2);
    env.host.render(garageState({ garageSelected: env.fired['toggle'].slice(-1)[0] }));
    expect(env.areas().some((a) => a.id === 'garage-cgroup:weapon' || a.id === 'garage-cgroup:gadget'),
      '战斗页用分段控件（garage-cgroup:）').toBe(true);
    expect(env.areas().some((a) => a.id.startsWith('garage-cslot:')),
      '战斗页用共享挂点 chip（garage-cslot:）').toBe(true);
    expect(env.areas().some((a) => a.id.startsWith('garage-cslot:weapon:') || a.id.startsWith('garage-cslot:gadget:')),
      '战斗页不再用分组前缀 chip（改为分段控件）').toBe(false);
  });

  it('A7｜360×180~1920×1008：战斗 tab + 部件卡 在 safe area 内、可点、不溢出', () => {
    for (const vp of VPS) {
      const env = makeHost(vp, INSETS);
      env.host.render(garageState());
      goGarage(env);
      const combat = env.areas().find((a) => a.id === 'garage-cat:combat')!;
      // 战斗 tab 在 safe area 内、尺寸为正
      expect(combat.w).toBeGreaterThan(0);
      expect(combat.h).toBeGreaterThan(0);
      expect(combat.x).toBeGreaterThanOrEqual(INSETS.left);
      expect(combat.x + combat.w).toBeLessThanOrEqual(vp.w - INSETS.right);
      expect(combat.y).toBeGreaterThanOrEqual(INSETS.top);
      expect(combat.y + combat.h).toBeLessThanOrEqual(vp.h - INSETS.bottom);
      // 进入战斗 + 选硬点 → 部件卡
      env.pointer(combat.x + combat.w / 2, combat.y + combat.h / 2);
      env.host.render(garageState({ garageSelected: env.fired['toggle'].slice(-1)[0] }));
      for (const a of env.areas().filter((x) => x.id.startsWith('opt:'))) {
        expect(a.w).toBeGreaterThan(0);
        expect(a.h).toBeGreaterThan(0);
        expect(a.x).toBeGreaterThanOrEqual(INSETS.left);
        expect(a.x + a.w).toBeLessThanOrEqual(vp.w - INSETS.right);
        expect(a.y).toBeGreaterThanOrEqual(INSETS.top);
        expect(a.y + a.h).toBeLessThanOrEqual(vp.h - INSETS.bottom);
      }
      // 分组挂点 chip 同样在 safe area 内
      for (const a of env.areas().filter((x) => x.id.startsWith('garage-cslot:'))) {
        expect(a.x).toBeGreaterThanOrEqual(INSETS.left);
        expect(a.x + a.w).toBeLessThanOrEqual(vp.w - INSETS.right);
        expect(a.y + a.h).toBeLessThanOrEqual(vp.h - INSETS.bottom);
      }
      // 分段控件（武器｜辅助）也在 safe area 内
      for (const a of env.areas().filter((x) => x.id.startsWith('garage-cgroup:'))) {
        expect(a.x).toBeGreaterThanOrEqual(INSETS.left);
        expect(a.x + a.w).toBeLessThanOrEqual(vp.w - INSETS.right);
        expect(a.y + a.h).toBeLessThanOrEqual(vp.h - INSETS.bottom);
      }
    }
  });

  it('A7b｜1920×1008（phoneLogical 强制 Mobile，真实部署同款）：战斗 tab + 分段 + 部件卡 不溢出', () => {
    const vp = { w: 1920, h: 1008 };
    const env = makeHost(vp, INSETS, true); // phoneLogical：真实部署在桌面宽屏强制 Mobile Profile
    env.host.render(garageState());
    goGarage(env);
    const combat = env.areas().find((a) => a.id === 'garage-cat:combat')!;
    expect(combat.w).toBeGreaterThan(0);
    expect(combat.x).toBeGreaterThanOrEqual(INSETS.left);
    expect(combat.x + combat.w).toBeLessThanOrEqual(vp.w - INSETS.right);
    expect(combat.y + combat.h).toBeLessThanOrEqual(vp.h - INSETS.bottom);
    env.pointer(combat.x + combat.w / 2, combat.y + combat.h / 2);
    env.host.render(garageState({ garageSelected: env.fired['toggle'].slice(-1)[0] }));
    // 分段 + 共享挂点行 + 部件卡 全部在 safe area 内
    for (const a of env.areas().filter((x) => x.id.startsWith('opt:') || x.id.startsWith('garage-cslot:') || x.id.startsWith('garage-cgroup:'))) {
      expect(a.x).toBeGreaterThanOrEqual(INSETS.left);
      expect(a.x + a.w).toBeLessThanOrEqual(vp.w - INSETS.right);
      expect(a.y + a.h).toBeLessThanOrEqual(vp.h - INSETS.bottom);
    }
  });

  it('A4 实战路径｜进入车库 → 战斗 → 选武器挂点看部件 → 选辅助挂点看部件 → 换件 → 返回首页配置保留', () => {
    const vp = { w: 844, h: 390 };
    const env = makeHost(vp, INSETS);
    env.host.render(garageState());
    goGarage(env);
    // 战斗
    const combat = env.areas().find((a) => a.id === 'garage-cat:combat')!;
    env.pointer(combat.x + combat.w / 2, combat.y + combat.h / 2);
    const wHp = env.fired['toggle'].slice(-1)[0];
    env.host.render(garageState({ garageSelected: wHp }));
    // 选武器挂点（共享行第一个 chip；默认武器分组）
    const wChip = env.areas().find((a) => a.id.startsWith('garage-cslot:'));
    expect(wChip, '共享挂点 chip 存在').toBeTruthy();
    env.pointer(wChip!.x + wChip!.w / 2, wChip!.y + wChip!.h / 2);
    env.host.render(garageState({ garageSelected: wChip!.id.slice('garage-cslot:'.length) }));
    expect(env.areas().some((a) => a.id.startsWith('opt:')), '武器挂点展开部件卡').toBe(true);
    // 选辅助挂点：点「辅助」分段 → 点共享行一个 chip
    const gSeg = env.areas().find((a) => a.id === 'garage-cgroup:gadget')!;
    env.pointer(gSeg.x + gSeg.w / 2, gSeg.y + gSeg.h / 2);
    const gChip = env.areas().find((a) => a.id.startsWith('garage-cslot:'));
    expect(gChip, '辅助挂点 chip 存在（共享行）').toBeTruthy();
    const gHp = gChip!.id.slice('garage-cslot:'.length);
    env.pointer(gChip!.x + gChip!.w / 2, gChip!.y + gChip!.h / 2);
    env.host.render(garageState({ garageSelected: gHp }));
    expect(env.areas().some((a) => a.id.startsWith('opt:')), '辅助挂点展开部件卡').toBe(true);
    // 换件
    const opt = env.areas().find((a) => a.id.startsWith('opt:') && a.id !== 'opt:none');
    expect(opt, '辅助挂点有可换部件').toBeTruthy();
    env.pointer(opt!.x + opt!.w / 2, opt!.y + opt!.h / 2);
    expect(env.fired['pick'].length).toBeGreaterThanOrEqual(1);
    // 返回首页（唯一返回 = 左上 nav:home）→ 配置态无残留命中
    env.host.render(garageState({ garageSelected: gHp }));
    const back = env.areas().find((a) => a.id === 'nav:home')!;
    env.pointer(back.x + back.w / 2, back.y + back.h / 2);
    const homeIds = env.areas().map((a) => a.id);
    expect(homeIds.some((id) => id === 'home-garage'), '已返回首页').toBe(true);
    expect(homeIds.some((id) => id.startsWith('garage-cat') || id.startsWith('opt:') || id.startsWith('garage-cslot')),
      '返回首页后无车库配置残留').toBe(false);
  });
});
