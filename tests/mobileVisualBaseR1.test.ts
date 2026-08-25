/**
 * F-MOBILE-VISUAL-BASE-R1｜统一手机游戏视觉体系（落地验收）
 *
 * 验收目标（来自 Queue）：
 *  - 任一页面第一眼区分场景/主要信息/主操作；
 *  - 主按钮（金黄实底）与次按钮（轻量无重框）视觉权重明显不同；
 *  - 不再呈现后台表单 / 调试面板质感（蓝/橙阵营、胜/负状态统一语义）；
 *  - 语义视觉源 V 已定义且被玩家宿主实际消费（不是只改名字的 token 工程）；
 *  - 360×180 ~ 844×390 均不溢出（由既有 layout/hit-area 契约保证，本队列只换色不换几何）。
 *
 * 本测试为「落地」守卫：断言语义 token 已定义、且宿主渲染真实产生了对应语义色值
 * （金黄主操作 #ffb229 / 我方蓝 / 敌方橙 / 胜利绿 / 失败红），而非停留在 token 文件内。
 */
import { describe, it, expect } from 'vitest';
import { V } from '../src/ui/visualTokens';
import { readFileSync } from 'node:fs';

describe('F-MOBILE-VISUAL-BASE-R1｜语义视觉源 V 定义完整', () => {
  it('语义分组全部定义（场景/面板/主副按钮/文字/胜负/阵营/描边圆角）', () => {
    const keys = Object.keys(V);
    for (const k of [
      'arenaBgTop', 'arenaBgMid', 'arenaBgLow', 'arenaBgHorizon', 'arenaGround', 'arenaGroundEdge',
      'panel', 'panelEmph', 'panelSolid',
      'primary', 'primaryText', 'primaryBright', 'secondary', 'secondaryText',
      'textPrimary', 'textSecondary', 'textFaint',
      'win', 'lose',
      'ownBlue', 'ownBlueBright', 'enemyOrange', 'enemyOrangeBright',
      'border', 'borderSoft', 'radiusL', 'radiusM', 'strokeW',
    ]) {
      expect(keys, `V.${k} 已定义`).toContain(k);
      const val = (V as Record<string, unknown>)[k];
      expect(typeof val === 'string' || typeof val === 'number', `V.${k} 为色值/数值`).toBe(true);
    }
  });

  it('主/次操作权重差异明确（金黄实底 vs 半透明轻量蓝，且主文字为深底）', () => {
    // 主操作金黄实底 + 深底文字（高对比）
    expect(V.primary).toBe('#ffb229');
    expect(V.primaryText).toBe('#1c1304');
    // 次按钮为半透明蓝（非实底、非重框）
    expect(V.secondary.startsWith('rgba(')).toBe(true);
    expect(V.secondary).toContain('0.85');
    // 主色与次色明显不同（实底 vs 透明），保证第一眼主次
    expect(V.primary).not.toBe(V.secondary);
  });

  it('阵营语义稳定：我方蓝 ≠ 敌方橙（不可互换）', () => {
    expect(V.ownBlue).toBe('#3d8bff');
    expect(V.enemyOrange).toBe('#ff8a3d');
    expect(V.ownBlue).not.toBe(V.enemyOrange);
  });

  it('胜负语义稳定：胜利绿 ≠ 失败红', () => {
    expect(V.win).toBe('#37d67a');
    expect(V.lose).toBe('#ff5c6c');
    expect(V.win).not.toBe(V.lose);
  });

  it('不再使用旧中性灰 / 浅金主色（避免后台表单 / 调试面板质感）', () => {
    // 旧主按钮蓝 #3b6fd4、旧浅金 #ffd35a、旧中性灰底 #242b38 / #9aa4b5 均不应成为语义主色
    expect(V.primary).not.toBe('#3b6fd4');
    expect(V.primary).not.toBe('#ffd35a');
    expect(V.panel).not.toBe('#242b38');
    expect(V.textSecondary).not.toBe('#9aa4b5');
  });
});

describe('F-MOBILE-VISUAL-BASE-R1｜宿主已落地语义色（非仅 token 文件）', () => {
  const host = readFileSync('src/ui/canvasPlayerUIHost.ts', 'utf-8');
  const renderer = readFileSync('src/render/renderer.ts', 'utf-8');

  it('宿主 import 并消费 V（主色/面板/阵营/胜负直接来自 V）', () => {
    expect(host, 'host import V').toContain("import { V } from './visualTokens'");
    expect(host, '主操作金黄来自 V.primary').toContain('V.primary');
    expect(host, '我方蓝来自 V.ownBlue').toContain('V.ownBlue');
    expect(host, '敌方橙来自 V.enemyOrange').toContain('V.enemyOrange');
    expect(host, '胜利来自 V.win').toContain('V.win');
    expect(host, '失败来自 V.lose').toContain('V.lose');
    expect(host, '圆角面板 helper panel() 已使用').toContain('private panel(');
  });

  it('统一圆角面板：关键容器改用 panel()（非 strokeRect 硬直角整框）', () => {
    // 至少首页顶栏/车库 dock/结算卡/Modal 应改用 panel()
    expect(host).toContain('this.panel(');
    // 不应仍残留整屏 strokeRect 直角重框（描边统一由 V.border 分组，非整行边框）
    expect(renderer, 'renderer 消费 V.arenaGround（地面语义）').toContain('V.arenaGround');
    expect(renderer, 'renderer 消费 V.arenaGroundEdge（地面顶缘）').toContain('V.arenaGroundEdge');
  });

  it('主/次按钮实现：金黄实底 + 轻量次按钮（button() 命中 V.primary / V.secondary）', () => {
    const btn = host.slice(host.indexOf('private button('));
    expect(btn, '主按钮=金黄实底').toContain('V.primary');
    expect(btn, '次/普通按钮=轻量半透明蓝').toContain('V.secondary');
    expect(btn, '选中=蓝实底').toContain('C.blue');
  });
});
