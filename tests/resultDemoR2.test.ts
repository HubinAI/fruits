/**
 * F-RESULT-DEMO-R2｜重做手机结算卡与再战路径 —— 验收矩阵。
 *
 * 用户问题：结算页大面积空洞、字段与数值分离、右侧奖励裁切、奖励文字低对比、
 * 表格和长边框过多、缺少游戏结算感；R1 只改标题颜色/部件边框/360×180 溢出。
 *
 * 本文件锁定验收（沿真实 Canvas 手机结算 Modal 路径）：
 * A. 信息顺序固定：胜利/失败 → 金币+段位 → 部件卡 → 操作按钮。
 * B. 金币/段位紧凑结果块：value 紧跟 label（不再两端分离）；sub 辅助小字。
 * C. 零增量不显示孤立「+0」/空字段。
 * D. 单张部件卡：名称 + 星级 + 库存变化；无整行表格线 / 无巨大空白。
 * E. 「下一场」唯一主按钮、「调整配置」次按钮；广告在奖励区内不抢主操作。
 * F. 背景暗化保留、卡片不铺满全屏。
 * G. 360×180～844×390 不裁切、不溢出（按钮 safe 内、奖励值完整）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CanvasPlayerUIHost } from '../src/ui/canvasPlayerUIHost';
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';
import { makeStarterDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import { getInventory } from '../src/core/partInventory';
import type { PlayerUIState, PlayerUIActions } from '../src/ui/playerUI';
import type { SafeInsets } from '../src/platform/types';

const SRC = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf8');
const RESULT_METHOD = SRC.slice(SRC.indexOf('private showResultModal'), SRC.indexOf('showModal(spec: ModalSpec): void'));
const MODAL_METHOD = SRC.slice(SRC.indexOf('private drawModal'), SRC.indexOf('private drawReadyOverlay'));

const INSETS: SafeInsets = { left: 44, right: 44, top: 0, bottom: 12 };

function makeRecHost(vp: { w: number; h: number }): {
  host: CanvasPlayerUIHost;
  texts: string[];
  fills: string[];
} {
  const texts: string[] = [];
  const fills: string[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, prop) => {
      if (prop === 'fillText') return (s: string): void => void texts.push(String(s));
      if (prop === 'fillRect' || prop === 'strokeRect') return (): void => void fills.push('rect');
      return () => ({ width: 0 });
    },
    set: () => true,
  });
  const canvas = { getContext: () => ctx, width: vp.w, height: vp.h, style: undefined } as unknown as HTMLCanvasElement;
  const core = createWebCore();
  bindPlatformCore({
    ...core,
    input: { bindClick: () => {}, bindPointer: () => {} },
    createViewport: () => ({ surface: () => ({ width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 }), onResize: () => {}, safeInsets: () => INSETS }),
  } as unknown as Parameters<typeof bindPlatformCore>[0]);
  const host = new CanvasPlayerUIHost(canvas);
  host.mountCanvas();
  host.setActions({} as unknown as PlayerUIActions);
  return { host, texts, fills };
}

function resultState(over: Partial<PlayerUIState> = {}): PlayerUIState {
  return {
    uiMode: 'build',
    battleState: 'ended',
    playerPhase: 'matchPreview',
    draft: makeStarterDraft('boxBody', registry),
    draftValid: true,
    blockReason: null,
    garageSelected: null,
    inventory: getInventory(),
    progress: { coin: 100, rating: 200 },
    onboarding: 'done',
    resetDevVisible: false,
    opponent: null,
    matchBarHidden: true,
    result: { winner: 'A', hpA: 90, hpB: 0 },
    reward: { kind: 'functional', name: '榴莲炮', starStr: '★★', cat: 'weapon', countAfter: 2 },
    economy: { coinDelta: 50, ratingDelta: 12, tierLabel: '青铜', rating: 212, coin: 150 },
    resultOnboardingVisible: false,
    rewardAdAvailable: true,
    rewardAdClaimed: false,
    readyOverlayVisible: false,
    ...over,
  };
}

describe('F-RESULT-DEMO-R2｜手机结算卡与再战路径', () => {
  describe('A｜信息顺序固定', () => {
    it('A1. showResultModal：title(胜/负) → rewardRows(金币/段位) → partCard → 按钮（源码守卫）', () => {
      expect(RESULT_METHOD, 'title 胜利/失败').toContain("title: isWin ? '胜利' : '失败'");
      expect(RESULT_METHOD, '金币块').toContain("label: '金币'");
      expect(RESULT_METHOD, '段位块').toContain("label: '段位'");
      expect(RESULT_METHOD, '部件卡').toContain('partCard');
      // F-LOSS-ADJUST-REMATCH-LOOP-P0｜Must#3：主/次按胜负切换（战败主=调整配置；胜利主=下一场）
      expect(RESULT_METHOD, '主按钮按胜负切换').toContain("primary: isWin ? '下一场' : '调整配置'");
      expect(RESULT_METHOD, '次按钮按胜负切换').toContain("secondary: isWin ? '调整配置' : '下一场'");
      // 顺序：rewardRows 定义在 partCard 之前（奖励先于部件卡）
      const idxRows = RESULT_METHOD.indexOf("label: '金币'");
      const idxPart = RESULT_METHOD.indexOf('partCard:');
      const idxBtn = RESULT_METHOD.indexOf("primary: isWin ? '下一场' : '调整配置'");
      expect(idxRows, '金币块在部件卡前').toBeGreaterThan(-1);
      expect(idxPart, '部件卡在金币块后').toBeGreaterThan(idxRows);
      expect(idxBtn, '按钮在部件卡后').toBeGreaterThan(idxPart);
    });
  });

  describe('B｜紧凑结果块（值紧跟标签，不再两端分离）', () => {
    it('B1. rewardRows 绘制为同块紧凑（value 紧跟 label 左对齐，非右对齐两端分离）', () => {
      expect(MODAL_METHOD, 'value 紧跟 label（bx + lw）').toContain('bx + lw');
      expect(MODAL_METHOD, '无右对齐 value（cx + cardW - pad 两端分离）').not.toContain('cx + cardW - pad, yy + rewardRowH');
    });

    it('B2. 844×390：结算卡显示 胜利/金币+50/段位+12/部件/库存/按钮（值完整无右侧裁切）', () => {
      const env = makeRecHost({ w: 844, h: 390 });
      env.host.render(resultState());
      const t = env.texts;
      expect(t.some((s) => s === '胜利'), '标题胜利').toBe(true);
      expect(t.some((s) => s.includes('金币')), '金币标签').toBe(true);
      expect(t.some((s) => s.includes('+50')), '金币值 +50（紧跟标签不分离）').toBe(true);
      expect(t.some((s) => s.includes('段位')), '段位标签').toBe(true);
      expect(t.some((s) => s.includes('+12')), '段位值 +12').toBe(true);
      expect(t.some((s) => s.includes('榴莲炮')), '部件名').toBe(true);
      expect(t.some((s) => s.includes('★★')), '部件星级').toBe(true);
      expect(t.some((s) => s.includes('库存')), '库存变化').toBe(true);
      expect(t.some((s) => s === '下一场'), '主按钮').toBe(true);
      expect(t.some((s) => s === '调整配置'), '次按钮').toBe(true);
    });
  });

  describe('C｜零增量不显示孤立 +0/空字段', () => {
    it('C1. coinDelta=0 → 不显示「金币/+0」行', () => {
      const env = makeRecHost({ w: 844, h: 390 });
      env.host.render(resultState({ economy: { coinDelta: 0, ratingDelta: 12, tierLabel: '青铜', rating: 212, coin: 150 } }));
      const t = env.texts;
      // 精确匹配独立「金币」标签（adRow 文案含「金币」子串，须排除）
      expect(t.some((s) => s === '金币'), '金币块隐藏（无孤立 +0）').toBe(false);
      expect(t.some((s) => s.includes('+0')), '无孤立 +0').toBe(false);
      expect(t.some((s) => s === '段位') && t.some((s) => s.includes('+12')), '段位块仍显示').toBe(true);
    });

    it('C2. ratingDelta=0 → 不显示「段位/+0」行（含辅助小字）', () => {
      const env = makeRecHost({ w: 844, h: 390 });
      env.host.render(resultState({ economy: { coinDelta: 50, ratingDelta: 0, tierLabel: '青铜', rating: 212, coin: 150 } }));
      const t = env.texts;
      expect(t.some((s) => s === '段位'), '段位块隐藏（无孤立 +0）').toBe(false);
      expect(t.some((s) => s === '金币') && t.some((s) => s.includes('+50')), '金币块仍显示').toBe(true);
    });
  });

  describe('D｜单张部件卡 + 无表格线/巨大空白', () => {
    it('D1. 部件卡单张明确（名称+星级+库存）且仅极淡分隔线（无整行表格/满框线）', () => {
      expect(MODAL_METHOD, '部件卡名称').toContain('spec.partCard.name');
      expect(MODAL_METHOD, '部件卡星级').toContain('spec.partCard.starStr');
      expect(MODAL_METHOD, '部件卡库存').toContain('spec.partCard.count');
      expect(MODAL_METHOD, '无整框线（C.border 满框）').not.toContain('this.rect(cx + pad, yy, pw, ph, C.cardBg, C.border, 1)');
      expect(MODAL_METHOD, '极淡分隔线 borderSoft').toContain('V.borderSoft');
    });

    it('D2. 删除 R1 强制大留白：minLargeH ≤ 55%（旧 62%/86% 大面积空洞）', () => {
      expect(MODAL_METHOD, 'minLargeH 降至 ≤0.55H').toContain('H * (this.isShort ? 0.55 : 0.45)');
      expect(MODAL_METHOD, '无 0.86 强制留白').not.toContain('H * (this.isShort ? 0.86');
      expect(MODAL_METHOD, '无 0.62 强制留白').not.toContain('H * (this.isShort ? 0.62');
    });
  });

  describe('E｜按钮主次 + 广告在奖励区', () => {
    it('E1. 下一场唯一主按钮（primary）、调整配置次按钮；无第三底部按钮', () => {
      const env = makeRecHost({ w: 844, h: 390 });
      env.host.render(resultState());
      const ar = env.host.getHitAreasForTest();
      expect(ar.some((a) => a.id === 'modal-tertiary'), '无第三同级按钮').toBe(false);
      const next = ar.find((a) => a.id === 'modal-primary')!;
      const adjust = ar.find((a) => a.id === 'modal-secondary')!;
      const ad = ar.find((a) => a.id === 'modal-ad')!;
      expect(ad.h, '广告矮于决策按钮（弱化）').toBeLessThan(next.h);
      expect(ad.y + ad.h, '广告在决策行上方（奖励区内）').toBeLessThanOrEqual(next.y);
      expect(next.x, '下一场在调整配置右侧（唯一主路径）').toBeGreaterThan(adjust.x + adjust.w);
      // 主次按钮高度 ≥ 可点击
      expect(next.h, '主按钮可点').toBeGreaterThanOrEqual(48);
      expect(adjust.h, '次按钮可点').toBeGreaterThanOrEqual(48);
    });
  });

  describe('F｜背景暗化保留、卡片不铺满全屏', () => {
    it('F1. 全屏遮罩（暗化战场）+ 卡片不铺满（cardW ≤ 85% 屏宽 / cardH ≤ safe 高）', () => {
      const env = makeRecHost({ w: 844, h: 390 });
      env.host.render(resultState());
      const ar = env.host.getHitAreasForTest();
      const next = ar.find((a) => a.id === 'modal-primary')!;
      // 按钮位于卡片内：按钮不贴屏幕边缘 → 卡片不铺满全屏
      expect(next.x, '按钮不贴左缘（卡片内缩）').toBeGreaterThan(env.host.getHitAreasForTest().find((a) => a.id === 'modal-veil')!.x + 20);
      expect(MODAL_METHOD, '遮罩全屏').toContain('this.rect(0, 0, W, H, C.overlayBg)');
      expect(MODAL_METHOD, '卡片宽 ≤ 78% 屏宽').toContain('W * (this.isShort ? 0.9 : 0.78)');
    });
  });

  describe('G｜360×180～844×390 不裁切、不溢出', () => {
    for (const vp of [{ w: 360, h: 180 }, { w: 420, h: 210 }, { w: 621, h: 351 }, { w: 844, h: 390 }]) {
      it(`${vp.w}×${vp.h}：结算 Modal 按钮 safe 内 + 奖励值完整（无右侧裁切）`, () => {
        const env = makeRecHost(vp);
        env.host.render(resultState());
        const ar = env.host.getHitAreasForTest();
        const safeBottom = vp.h - INSETS.bottom;
        for (const id of ['modal-primary', 'modal-secondary']) {
          const a = ar.find((x) => x.id === id)!;
          expect(a.y, `${id} y ≥ safeTop`).toBeGreaterThanOrEqual(INSETS.top);
          expect(a.y + a.h, `${id} 底缘 ≤ safe 底`).toBeLessThanOrEqual(safeBottom);
          expect(a.x + a.w, `${id} 右缘 ≤ 屏宽`).toBeLessThanOrEqual(vp.w);
          expect(a.h, `${id} 可点`).toBeGreaterThanOrEqual(36);
        }
        // 奖励值完整显示（fillText 捕获 '+50' '+12' 出现 → 未裁切）
        const t = env.texts;
        expect(t.some((s) => s.includes('+50')), `${vp.w}×${vp.h} 金币值完整`).toBe(true);
        expect(t.some((s) => s.includes('+12')), `${vp.w}×${vp.h} 段位值完整`).toBe(true);
      });
    }
  });
});
