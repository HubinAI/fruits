/**
 * F-BATTLE-HUD-HAZARD-R1｜统一阶段提示 + 降低收束墙视觉噪声验收。
 *
 * 1. 阶段语义统一：runtime phaseCountdownText = 完整文案（「收束警告 N / 刺墙逼近 N」），
 *    mobile-normal 与 short HUD 同源绘制同一信息组（Must#1/#2）；
 * 2. Warning → Closing 倒计时重置由文字变化解释（Must#3）；
 * 3. 收束墙填充降半透明（车辆不被实心红遮住）、轮廓/尖刺清晰、边缘脉冲克制（Must#4）；
 * 4. 伤害数字同侧纵向错开（Must#5）；
 * 5. 玩家名/HP 可读性保留（Must#6）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { PlayerGameRuntime } from '../src/game/playerGameRuntime';
import type { PlayerBattleHost } from '../src/game/playerGameRuntime';
import type { BattleOrchestratorApi } from '../src/battle/battleContract';
import type { PlayerUIHost, PlayerUIActions, PlayerUIState, PlayerUIHudFrame } from '../src/ui/playerUI';
import type { BattleConfig } from '../src/battle/battleContract';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { createWechatCore } from '../src/platform/wechat';

const HOST = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
const RENDERER = readFileSync('src/render/renderer.ts', 'utf-8');
const RUNTIME = readFileSync('src/game/playerGameRuntime.ts', 'utf-8');

function makeOrch(phase: string, timeMs: number): BattleOrchestratorApi {
  return {
    result: phase === 'End' ? { winner: 'A', hpA: 100, hpB: 0, phase: 'End', endReason: 'hp' } : null,
    phase,
    timeMs,
    config: { autoDrive: true, arena: { phases: { warningMs: 3000, closingMs: 5000 } } } as BattleConfig,
    getRenderSnapshot: () => ({}) as unknown as never,
    getBattleStatusSnapshot: () => null as never,
    step: () => {},
    onCombatEvent: () => () => {},
    dispose: () => {},
  } as unknown as BattleOrchestratorApi;
}

class StageBattleHost implements PlayerBattleHost {
  previewMode = false;
  orchestrator: BattleOrchestratorApi | null = makeOrch('Active', 0);
  loadCustomPreview(): void {}
  loadCustom(): void {}
  step(): void {}
  render(): void {}
  setPreviewVehicleFx(): void {}
  arenaDims(): { w: number; h: number } {
    return { w: 1600, h: 900 };
  }
  reframe(): void {}
  resize(): void {}
}

class RecHost implements PlayerUIHost {
  actions: PlayerUIActions | null = null;
  lastState: PlayerUIState | null = null;
  hudFrames: Array<{ phase: string; text: string | null }> = [];
  mountCanvas(): void {}
  mount(): void {}
  setActions(a: PlayerUIActions): void {
    this.actions = a;
  }
  render(s: PlayerUIState): void {
    this.lastState = s;
  }
  renderBattleFrame(f: PlayerUIHudFrame): void {
    this.hudFrames.push({ phase: f.battleStatus?.phase ?? 'none', text: f.phaseCountdownText });
  }
  isMobileView(): boolean {
    return true;
  }
  getPreviewFramingRect() {
    return { x: 59, y: 0, w: 726, h: 34, mode: 'home' as const };
  }
}

function setup(battle: StageBattleHost, host: RecHost): PlayerGameRuntime {
  const store = new Map<string, unknown>();
  (globalThis as any).wx = {
    getSystemInfoSync: () => ({ pixelRatio: 2 }),
    getStorageSync: (k: string) => (store.has(k) ? store.get(k) : null),
    setStorageSync: (k: string, v: unknown) => void store.set(k, v),
    removeStorageSync: (k: string) => void store.delete(k),
  };
  bindPlatformCore(createWechatCore(2));
  const runtime = new PlayerGameRuntime({ host, battle, sfx: { resume() {} } });
  runtime.init();
  return runtime;
}

function makeRecHost(vp: { w: number; h: number }, insets = { left: 44, right: 20, top: 12, bottom: 16 }) {
  const texts: string[] = [];
  const ctx = new Proxy(
    {} as CanvasRenderingContext2D,
    { get: (_t, prop) => (prop === 'fillText' ? (s: string) => void texts.push(s) : () => ({ width: 0 })), set: () => true },
  );
  const core = createWebCore();
  bindPlatformCore({
    ...core,
    createViewport: () => ({
      surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 }),
      onResize: () => {},
      safeInsets: () => insets,
    }),
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  const host = new CanvasPlayerUIHost({ getContext: () => ctx, width: vp.w, height: vp.h, style: undefined, addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLCanvasElement);
  host.mountCanvas();
  return { host, texts: () => texts };
}

describe('F-BATTLE-HUD-HAZARD-R1｜统一阶段提示 + 收束墙视觉克制', () => {
  afterEach(() => {
    bindPlatformCore(createWebCore());
    delete (globalThis as any).wx;
  });

  it('T1. 阶段文案统一：Warning=「收束警告 N」、Closing=「刺墙逼近 N」（runtime 真实生成，非孤立数字）', () => {
    const battle = new StageBattleHost();
    const host = new RecHost();
    const runtime = setup(battle, host);
    // Warning：同一 orchestrator 实例推进 timeMs（phaseStartTimeMs 以首帧为起点）→ 3/2/1
    const warnOrch = makeOrch('Warning', 0);
    battle.orchestrator = warnOrch;
    runtime.tick(0);
    const warnFrame = host.hudFrames[host.hudFrames.length - 1]!;
    expect(warnFrame.text, 'Warning 完整文案').toBe('收束警告 3');
    (warnOrch as { timeMs: number }).timeMs = 1000;
    runtime.tick(1000);
    expect(host.hudFrames[host.hudFrames.length - 1]!.text, 'Warning 递减 2').toBe('收束警告 2');
    (warnOrch as { timeMs: number }).timeMs = 2500;
    runtime.tick(2500);
    expect(host.hudFrames[host.hudFrames.length - 1]!.text, 'Warning 递减 1').toBe('收束警告 1');
    // Closing：新阶段 5s 倒计时从 5 开始——文字变化解释重置
    battle.orchestrator = makeOrch('Closing', 0);
    runtime.tick(0);
    const closeFrame = host.hudFrames[host.hudFrames.length - 1]!;
    expect(closeFrame.text, 'Closing 完整文案（重置为 5）').toBe('刺墙逼近 5');
    expect(closeFrame.text !== warnFrame.text, 'Warning→Closing 文字变化解释倒计时重置').toBe(true);
    expect(closeFrame.text!.includes('刺墙逼近'), '不再孤立数字').toBe(true);
    // Active：无阶段文案
    battle.orchestrator = makeOrch('Active', 0);
    runtime.tick(0);
    expect(host.hudFrames[host.hudFrames.length - 1]!.text, 'Active 无阶段提示').toBeNull();
  });

  it('T2. mobile-normal 与 short HUD 同源：直接绘制完整文案（不再孤立数字、不再本端拼 label）', () => {
    // short（420×210）
    const s = makeRecHost({ w: 420, h: 210 });
    s.host.render({ playerPhase: 'garage', uiMode: 'build', battleState: 'fighting', draft: null as never } as unknown as PlayerUIState);
    s.host.renderBattleFrame({
      battleState: 'fighting',
      battleStatus: { phase: 'Warning', sideA: { hp: 50, maxHp: 100 }, sideB: { hp: 50, maxHp: 100 } },
      phaseCountdownText: '收束警告 2',
    } as PlayerUIHudFrame);
    expect(s.texts().some((t) => t.includes('收束警告') && t.includes('2')), 'short 画完整文案').toBe(true);
    expect(s.texts().some((t) => t === '2'), 'short 无孤立数字').toBe(false);
    // normal（844×390）
    const n = makeRecHost({ w: 844, h: 390 });
    n.host.render({ playerPhase: 'garage', uiMode: 'build', battleState: 'fighting', draft: null as never } as unknown as PlayerUIState);
    n.host.renderBattleFrame({
      battleState: 'fighting',
      battleStatus: { phase: 'Closing', sideA: { hp: 50, maxHp: 100 }, sideB: { hp: 50, maxHp: 100 } },
      phaseCountdownText: '刺墙逼近 3',
    } as PlayerUIHudFrame);
    expect(n.texts().some((t) => t.includes('刺墙逼近') && t.includes('3')), 'normal 画完整文案').toBe(true);
    expect(n.texts().some((t) => t === '3'), 'normal 无孤立数字').toBe(false);
    // 源码：两端都直接画 phaseCountdownText（同一信息组）
    expect(HOST, 'short HUD 直接画完整文案').toContain("this.text(frame.phaseCountdownText, this.W / 2, top + 44");
    expect(HOST, 'normal HUD 直接画完整文案').toContain("this.text(frame.phaseCountdownText, this.W / 2, top + 46");
    // mobile 分支：Active 无常驻「战斗中」（新结构：仅 Warning/Closing 中央组 + End 提示）
    const mobileHud = HOST.slice(HOST.indexOf('if (s.phase === \'Warning\' || s.phase === \'Closing\') {'), HOST.indexOf('// A 左上'));
    expect(mobileHud, 'mobile 分支无「战斗中」常驻').not.toContain('战斗中');
    expect(mobileHud, 'mobile 分支 End 单独提示').toContain("} else if (s.phase === 'End') {");
  });

  it('T3. 收束墙克制：Closing 填充半透明（车辆不被实心红遮住）+ 尖刺/轮廓清晰 + 脉动描边弱化', () => {
    // 填充 alpha 0.26（半透明）
    const closingBlock = RENDERER.slice(RENDERER.indexOf('正式进入——墙体填充降为半透明'), RENDERER.indexOf('正式进入——墙体填充降为半透明') + 600);
    expect(closingBlock, 'Closing 填充半透明').toContain('ctx.globalAlpha = 0.26');
    expect(closingBlock, '尖刺在 alpha 外（清晰绘制）').toMatch(/globalAlpha = 0\.26;\s*this\.drawShape\(cw, '#c0403a'\);\s*ctx\.globalAlpha = 1;\s*this\.drawSpikes/);
    // 尖刺自身 alpha 0.85（清晰）
    expect(RENDERER, '尖刺保持清晰').toContain('ctx.globalAlpha = 0.85;');
    // 脉动描边弱化（0.85+0.15 → 0.7+0.2）
    expect(closingBlock, '脉动描边弱化').toContain('const pulse = 0.7 + 0.2 * Math.sin(now * 0.01);');
  });

  it('T4. 边缘危险脉冲克制：Closing ≤0.56、Warning ≤0.40（不再与墙体同强）', () => {
    const pulseBlock = HOST.slice(HOST.indexOf('private drawDangerEdgePulse'), HOST.indexOf('private drawDangerEdgePulse') + 400);
    expect(pulseBlock, 'Closing 脉冲降为 0.4+0.16').toContain('0.4 + 0.16 * pulse');
    expect(pulseBlock, 'Warning 脉冲降为 0.22+0.18').toContain('0.22 + 0.18 * pulse');
  });

  it('T5. 伤害数字同侧短时聚合/错开：同 x 桶内纵向错开（避免堆叠遮挡车辆/墙/HUD）', () => {
    expect(RENDERER, '按世界 x 相近分桶').toContain('const bucket = Math.round(f.x / 90);');
    // F-BATTLE-HIT-READABILITY-R1：同车 slot 错层 16px + 上浮封顶（防 age 差异抵消错层）
    expect(RENDERER, '纵向错层（screen-space 常量，F-BATTLE-FX-SCREENSPACE-R2）').toContain('lane * 16');
    expect(RENDERER, '上浮封顶防抵消（screen-space 常量，F-BATTLE-FX-SCREENSPACE-R2）').toContain('Math.min(age, 0.25) * 40');
    // 聚合器仍保留（F-PRESENT-1 不变——同源短时合并先于错开）
    expect(RENDERER, '聚合器保留').toContain('DamageNumberAggregator');
  });

  it('T6. 矩阵不越界：360×180~844×390 Warning/Closing 渲染不抛 + 阶段组完整（HP/玩家名可读保留）', () => {
    for (const vp of [{ w: 360, h: 180 }, { w: 420, h: 210 }, { w: 621, h: 351 }, { w: 844, h: 390 }]) {
      const env = makeRecHost(vp);
      env.host.render({ playerPhase: 'garage', uiMode: 'build', battleState: 'fighting', draft: null as never } as unknown as PlayerUIState);
      expect(() =>
        env.host.renderBattleFrame({
          battleState: 'fighting',
          battleStatus: { phase: 'Warning', sideA: { hp: 70, maxHp: 100 }, sideB: { hp: 40, maxHp: 100 } },
          phaseCountdownText: '收束警告 2',
        } as PlayerUIHudFrame),
        `${vp.w}×${vp.h} Warning 渲染不抛`,
      ).not.toThrow();
      expect(env.texts().some((t) => t.includes('收束警告')), `${vp.w}×${vp.h} Warning 阶段组完整`).toBe(true);
      if (vp.w >= 500) {
        expect(env.texts().some((t) => t.includes('我方') || t.includes('对手')), `${vp.w}×${vp.h} 玩家名保留（normal 语义）`).toBe(true);
      }
      expect(() =>
        env.host.renderBattleFrame({
          battleState: 'fighting',
          battleStatus: { phase: 'Closing', sideA: { hp: 70, maxHp: 100 }, sideB: { hp: 40, maxHp: 100 } },
          phaseCountdownText: '刺墙逼近 5',
        } as PlayerUIHudFrame),
        `${vp.w}×${vp.h} Closing 渲染不抛`,
      ).not.toThrow();
      expect(env.texts().some((t) => t.includes('刺墙逼近')), `${vp.w}×${vp.h} Closing 阶段组完整`).toBe(true);
    }
  });

  it('T7. 源码守卫：runtime 生成完整阶段文案（Warning/Closing 分支）', () => {
    expect(RUNTIME, 'Warning 完整文案').toContain('return `收束警告 ${warningCountdown(remaining)}`;');
    expect(RUNTIME, 'Closing 完整文案').toContain('return `刺墙逼近 ${warningCountdown(remaining)}`;');
  });
});
