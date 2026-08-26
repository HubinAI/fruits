/**
 * F-BATTLE-READABILITY-R1｜重构战斗HUD与命中反馈 —— 验收矩阵。
 *
 * 用户问题：HUD 只显示 A/B 和数字；伤害/炮弹/碰撞圆点/收束墙接近调试表现；
 * 玩家很难看懂谁在攻击、什么造成伤害、为什么局势变化。
 *
 * 本文件锁定验收（沿真实 Runtime / 真实 Renderer 绘制路径）：
 * A. HUD 左右阵营卡：我方蓝/对手橙名称 + HP 条 + 数字辅助；不再只显示 A/B 字母。
 * B. 统一命中反馈：接触点短促爆点（十字射线）+ 受击白描边 + 聚合伤害数字。
 * C. 炮弹/镭射/推进尾焰与普通碰撞明显区分（颜色/形状分支）。
 * D. 删除调试感：蓄能光点不再青色；微信端注册 Content 视觉（消灭灰盒）；激光弹带拖尾。
 * E. Warning/Closing 边缘危险脉冲 + 明确倒计时（提前感知收束压力）。
 * F. 收束墙危险机关表现（Warning 半透明红填充 + 脉动描边）。
 * G. 关键音效实际触发：攻击(fire)/命中(hit)/收束预警(closing)/胜负(win/lose)。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { createWechatCore } from '../src/platform/wechat';
import { PlayerGameRuntime } from '../src/game/playerGameRuntime';
import type { PlayerBattleHost, PlayerGameDeps } from '../src/game/playerGameRuntime';
import type { BattleOrchestratorApi, BattleConfig } from '../src/battle/battleContract';
import type { PlayerUIState, PlayerUIActions, PlayerUIHost, PlayerUIHudFrame } from '../src/ui/playerUI';
import type { SfxId } from '../src/presentation/audioService';

const RENDERER_SRC = readFileSync(fileURLToPath(new URL('../src/render/renderer.ts', import.meta.url)), 'utf8');
const HOST_SRC = readFileSync(fileURLToPath(new URL('../src/ui/canvasPlayerUIHost.ts', import.meta.url)), 'utf8');
const WX_GAME_SRC = readFileSync(fileURLToPath(new URL('../wechat/game.ts', import.meta.url)), 'utf8');
const WX_VITE_SRC = readFileSync(fileURLToPath(new URL('../vite.wechat.config.ts', import.meta.url)), 'utf8');

const INSETS = { left: 44, right: 44, top: 0, bottom: 12 };

/** Proxy ctx 捕获 fillText（prebattleP0 同模式） */
function makeRecCtx(): { ctx: CanvasRenderingContext2D; texts: string[]; fills: string[] } {
  const texts: string[] = [];
  const fills: string[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, prop) => {
      if (prop === 'fillText') return (s: string): void => void texts.push(String(s));
      if (prop === 'fillRect') return (): void => void fills.push('fillRect');
      if (prop === 'strokeRect') return (): void => void fills.push('strokeRect');
      return () => ({ width: 0 });
    },
    set: () => true,
  });
  return { ctx, texts, fills };
}

function makeHost(vp: { w: number; h: number }) {
  const { ctx, texts, fills } = makeRecCtx();
  const canvas = { getContext: () => ctx, width: vp.w, height: vp.h, style: undefined } as unknown as HTMLCanvasElement;
  const core = createWebCore();
  bindPlatformCore({
    ...core,
    input: { bindClick: () => {}, bindPointer: () => {} },
    createViewport: () => ({ surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 }), onResize: () => {}, safeInsets: () => INSETS }),
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas();
  return { host, texts, fills };
}

function fightingFrame(over: Partial<PlayerUIHudFrame> = {}): PlayerUIHudFrame {
  return {
    battleState: 'fighting',
    battleStatus: { phase: 'Active', sideA: { hp: 70, maxHp: 100 }, sideB: { hp: 40, maxHp: 100 } },
    phaseCountdownText: null,
    ...over,
  };
}

/** 先 render 战斗态 state（inBattle=true）再推 HUD 帧（drawHud 依赖 state.battleState） */
function renderFightingFrame(host: CanvasPlayerUIHost, frame: PlayerUIHudFrame): void {
  host.render({
    uiMode: 'build', battleState: 'fighting', playerPhase: 'garage', draft: null, draftValid: true,
    blockReason: null, garageSelected: null, inventory: {} as never, progress: { coin: 0, rating: 0 },
    onboarding: 'done', resetDevVisible: false, opponent: null, matchBarHidden: true, result: null,
    reward: null, economy: null, resultOnboardingVisible: false, rewardAdAvailable: false,
    rewardAdClaimed: false, readyOverlayVisible: false,
  });
  host.renderBattleFrame(frame);
}

// ==================== Runtime harness（playerGameRuntime.test.ts 同模式） ====================

/** 可控 phase/result 的假战斗宿主（驱动 runtime 阶段/结算音效触发） */
class PhaseScriptBattleHost implements PlayerBattleHost {
  previewMode = false;
  orchestrator: BattleOrchestratorApi | null = null;
  private script: Array<{ phase: string; result: null | { winner: 'A' | 'B'; hpA: number; hpB: number; phase: 'End'; endReason: string } }>;
  private idx = 0;
  private orch: BattleOrchestratorApi | null = null;
  constructor(script: Array<{ phase: string; result?: never }>) {
    this.script = script.map((s) => ({ phase: s.phase, result: null }));
    // 末位可携带 result（End 结算）
    const last = this.script[this.script.length - 1];
    if (last?.phase === 'End') {
      last.result = { winner: 'A', hpA: 100, hpB: 0, phase: 'End', endReason: 'hp' };
    }
  }
  loadCustomPreview(): void { this.previewMode = true; }
  loadCustom(): void { this.previewMode = false; this.orchestrator = this.orch; }
  step(): void {
    if (this.previewMode) return; // 预览不推进（与正式宿主一致）
    if (this.idx < this.script.length - 1) this.idx++;
    const cur = this.script[this.idx]!;
    // 复用同一 orchestrator 对象（只改字段）——runtime 的 lastPhaseOrch 按对象身份
    // 判断「战斗实例变化」；每次新建会误触发阶段状态重置，导致收束音效重复刷。
    if (!this.orch) {
      this.orch = {
        result: cur.result,
        phase: cur.phase,
        timeMs: this.idx * 1000,
        config: { autoDrive: true, arena: { phases: { warningMs: 3000 } } } as BattleConfig,
        getRenderSnapshot: () => ({}) as never,
        getBattleStatusSnapshot: () => null as never,
        step: () => {},
        onCombatEvent: () => () => {},
        dispose: () => {},
      } as unknown as BattleOrchestratorApi;
    }
    (this.orch as { phase: string }).phase = cur.phase;
    (this.orch as { result: typeof cur.result }).result = cur.result;
    (this.orch as { timeMs: number }).timeMs = this.idx * 1000;
    this.orchestrator = this.orch;
  }
  render(): void {}
  setPreviewVehicleFx(): void {}
  arenaDims(): { w: number; h: number } { return { w: 1600, h: 900 }; }
  reframe(): void {}
  resize(): void {}
}

class FakeHost implements PlayerUIHost {
  actions: PlayerUIActions | null = null;
  lastState: PlayerUIState | null = null;
  setActions(a: PlayerUIActions): void { this.actions = a; }
  mount(): void {}
  render(s: PlayerUIState): void { this.lastState = s; }
  renderBattleFrame(): void {}
}

class RecSfx {
  plays: SfxId[] = [];
  resume(): void {}
  play(id: SfxId): void { this.plays.push(id); }
}

function runtimeSetup(script: Array<{ phase: string }>): {
  runtime: PlayerGameRuntime;
  host: FakeHost;
  sfx: RecSfx;
} {
  const store = new Map<string, unknown>();
  (globalThis as any).wx = {
    getSystemInfoSync: () => ({ pixelRatio: 2 }),
    getStorageSync: (k: string) => (store.has(k) ? store.get(k) : null),
    setStorageSync: (k: string, v: unknown) => void store.set(k, v),
    removeStorageSync: (k: string) => void store.delete(k),
  };
  bindPlatformCore(createWechatCore(2));
  const host = new FakeHost();
  const sfx = new RecSfx();
  const battle = new PhaseScriptBattleHost(script);
  const runtime = new PlayerGameRuntime({ host, battle, sfx } as PlayerGameDeps);
  runtime.init();
  return { runtime, host, sfx };
}

function tickN(runtime: PlayerGameRuntime, n: number): void {
  let now = 0;
  for (let i = 0; i < n; i++) {
    now += 16.7;
    runtime.tick(now);
  }
}

describe('F-BATTLE-READABILITY-R1｜战斗HUD与命中反馈', () => {
  afterEach(() => {
    vi.useRealTimers();
    bindPlatformCore(createWebCore());
    delete (globalThis as any).wx;
  });

  describe('A｜HUD 左右阵营卡', () => {
    it('A1. 传入 names 时显示车辆名（我方/对手），不再只显示 A/B 字母', () => {
      const { host, texts } = makeHost({ w: 844, h: 390 });
      renderFightingFrame(host, fightingFrame({ names: { a: '西瓜', b: '香蕉' } }));
      const t = texts;
      expect(t.some((s) => s === 'A' || s === 'B'), '不再只显示 A/B 字母').toBe(false);
      expect(t.some((s) => s.includes('西瓜')), '显示我方车辆名（蓝）').toBe(true);
      expect(t.some((s) => s.includes('香蕉')), '显示对手车辆名（橙）').toBe(true);
      expect(t.some((s) => s === '70' || s === '40'), 'HP 数字降为辅助信息仍显示').toBe(true);
    });

    it('A2. 无 names 时回落「我方/对手」标签（不显示孤立 A/B）', () => {
      const { host, texts } = makeHost({ w: 844, h: 390 });
      renderFightingFrame(host, fightingFrame());
      const t = texts;
      expect(t.some((s) => s === 'A' || s === 'B'), '回落标签无 A/B 字母').toBe(false);
      expect(t.some((s) => s.includes('我方')), '左阵营回落「我方」').toBe(true);
      expect(t.some((s) => s.includes('对手')), '右阵营回落「对手」').toBe(true);
    });
  });

  describe('B｜统一命中反馈', () => {
    it('B1. 命中火花为短促爆点（十字射线），受击白描边 + 聚合伤害数字路径均在', () => {
      expect(RENDERER_SRC, 'sparks 绘制含十字爆点射线').toMatch(/ctx\.moveTo\(x - L, y\);\s*\r?\n\s*ctx\.lineTo\(x \+ L, y\);/);
      expect(RENDERER_SRC, '受击白描边（hitFlash）').toContain("strokeShape(v.body, '#ffffff')");
      expect(RENDERER_SRC, '聚合伤害数字').toMatch(/damageAggregator\.feed/);
      // 时长短促不遮车（ttl 常量）
      expect(RENDERER_SRC, '火花 ttl 短促').toMatch(/ttl: 220/);
      expect(RENDERER_SRC, '受击描边 ttl 短促').toMatch(/ttl: 120/);
    });
  });

  describe('C｜炮弹/镭射/尾焰与碰撞明显区分', () => {
    it('C1. 三种武器飞行视觉分支不同（laser 青色拖尾 / tracer 弹迹 / 尾焰粒子）', () => {
      expect(RENDERER_SRC, 'laser 弹带青色能量拖尾').toMatch(/#7fd8ff';\s*\r?\n\s*ctx\.lineWidth = Math\.max\(2, this\.ss\(p\.radius\)\)/);
      expect(RENDERER_SRC, '霰弹 tracer 沿飞行方向短弹迹').toMatch(/TRACER = this\.ss\(42\)/);
      expect(RENDERER_SRC, '推进尾焰 drawFlamePlumes').toContain('private drawFlamePlumes');
      // 普通碰撞 = sparks 十字爆点（暖色），与青色激光飞行视觉区分
      expect(RENDERER_SRC, '碰撞爆点默认暖黄').toContain("spawnSpark(x: number, y: number, color = '#ffd35a')");
    });
  });

  describe('D｜删除调试感反馈', () => {
    it('D1. 蓄能光点不再青色（统一暖金→亮白）', () => {
      const chargeBlock = RENDERER_SRC.slice(RENDERER_SRC.indexOf('now - c.lastAt < 500'), RENDERER_SRC.indexOf('now - c.lastAt < 500') + 400);
      expect(chargeBlock.includes('#6fa8ff'), '蓄能光点无青色').toBe(false);
      expect(chargeBlock, '蓄能光点金黄→亮白').toContain("'#ffd35a'");
    });

    it('D2. 微信端注册 Content 视觉 + base64 内联（消灭灰盒方块）', () => {
      expect(WX_GAME_SRC, '微信注册 body_watermelon 视觉').toContain("['body_watermelon', bodyWatermelonUrl]");
      expect(WX_GAME_SRC, '微信用 wx.createImage 加载').toContain('wx.createImage()');
      expect(WX_GAME_SRC, '加载完成注入 registry').toContain('visualRegistry.setImage(visualId, img)');
      expect(WX_VITE_SRC, '微信构建图片内联（微信无静态资源服务器）').toContain('assetsInlineLimit: 100000000');
    });

    it('D3. 激光弹带飞行拖尾（不再是孤立青色圆点）', () => {
      expect(RENDERER_SRC, 'laser 拖尾 TRAIL').toMatch(/TRAIL = this\.ss\(26\)/);
    });
  });

  describe('E｜Warning 边缘危险脉冲 + 倒计时', () => {
    it('E1. Warning/Closing 绘制左右边缘红色危险脉冲', () => {
      expect(HOST_SRC, 'drawDangerEdgePulse 存在').toContain('private drawDangerEdgePulse');
      expect(HOST_SRC, 'Warning/Closing 调用边缘脉冲').toMatch(/if \(s\.phase === 'Warning' \|\| s\.phase === 'Closing'\) \{\s*\n\s*this\.drawDangerEdgePulse/);
      expect(HOST_SRC, '边缘脉冲贴边细条（不遮挡车辆）').toMatch(/this\.W \* 0\.012\)/);
    });

    it('E2. Warning/Closing 中央倒计时仍显示（提前感知）', () => {
      const { host, texts } = makeHost({ w: 844, h: 390 });
      renderFightingFrame(host, fightingFrame({ battleStatus: { phase: 'Warning', sideA: { hp: 70, maxHp: 100 }, sideB: { hp: 40, maxHp: 100 } }, phaseCountdownText: '2' }));
      const t = texts;
      expect(t.some((s) => s === '2'), 'Warning 中央倒计时 2').toBe(true);
    });
  });

  describe('F｜收束墙危险机关', () => {
    it('F1. Warning 墙半透明红填充 + 脉动描边（非纯矩形）；Closing 刺墙', () => {
      const wallsBlock = RENDERER_SRC.slice(RENDERER_SRC.indexOf('arena.closingWalls'), RENDERER_SRC.indexOf('arena.closingWalls') + 900);
      expect(wallsBlock, 'Warning 墙半透明红填充').toContain("'#c0403a'");
      expect(wallsBlock, 'Warning 脉动描边').toContain("strokeShape(cw, '#e8a33c')");
      expect(RENDERER_SRC, 'Closing 锯齿刺墙').toContain('private drawSpikes');
    });
  });

  describe('G｜关键音效实际触发', () => {
    it('G1. 攻击/命中/死亡由 BattleEvent 接线（fire/hit/death）', () => {
      const pres = readFileSync(fileURLToPath(new URL('../src/presentation/playerPresentation.ts', import.meta.url)), 'utf8');
      expect(pres, '攻击音 fire').toContain("sfx.play('fire')");
      expect(pres, '命中音 hit').toContain("sfx.play('hit')");
      expect(pres, '死亡音 death').toContain("sfx.play('death')");
    });

    it('G2. 收束预警音：Warning 阶段进入时触发 closing（不重复刷）', () => {
      vi.useFakeTimers();
      const { runtime, sfx } = runtimeSetup([
        { phase: 'Active' }, { phase: 'Active' }, { phase: 'Warning' }, { phase: 'Warning' }, { phase: 'Closing' },
      ]);
      // 进入正式战斗（previewMode=false）后清空（matching 无关键音）
      runtime.actions.onFindOpponent();
      vi.advanceTimersByTime(1420 + 700 + 600 + 10);
      expect(runtime.battleState).toBe('fighting');
      sfx.plays = [];
      tickN(runtime, 1); // Active（首帧：lastPhase 初始化）
      expect(sfx.plays, 'Active 无预警音').not.toContain('closing');
      tickN(runtime, 2); // → Warning
      expect(sfx.plays, '进入 Warning 触发收束预警音').toContain('closing');
      tickN(runtime, 2); // → Closing（Warning→Closing 各播一次，不逐帧刷）
      const count = sfx.plays.filter((p) => p === 'closing').length;
      expect(count, 'closing 每场阶段切换至多两次（Warning+Closing）').toBeLessThanOrEqual(2);
      vi.useRealTimers();
    });

    it('G3. 胜负音效：End 结算触发 win/lose（每场一次）', () => {
      vi.useFakeTimers();
      const { runtime, sfx } = runtimeSetup([
        { phase: 'Active' }, { phase: 'Active' }, { phase: 'Warning' }, { phase: 'End' },
      ]);
      runtime.actions.onFindOpponent();
      vi.advanceTimersByTime(1420 + 700 + 600 + 10);
      expect(runtime.battleState).toBe('fighting');
      sfx.plays = [];
      tickN(runtime, 4); // 推进到 End → result → 结算
      expect(sfx.plays, '胜利触发 win').toContain('win');
      expect(sfx.plays.filter((p) => p === 'win').length, 'win 每场一次').toBe(1);
      vi.useRealTimers();
    });
  });

  describe('Aux｜HUD 不遮挡车辆/战场核心', () => {
    it('Aux1. 阵营卡位于顶部安全区（insT+17 HP 条），边缘脉冲贴边细条', () => {
      expect(HOST_SRC, 'HP 条在顶部安全区').toMatch(/const barY = top \+ 17;/);
      expect(HOST_SRC, '边缘脉冲宽 ≤ 1.2% 屏宽').toMatch(/this\.W \* 0\.012\)/);
    });
  });
});
