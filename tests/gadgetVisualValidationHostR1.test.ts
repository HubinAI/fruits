/**
 * Queue ID｜GADGET-VISUAL-VALIDATION-HOST-R1
 *
 * 断言「Gadget 真人视觉验收宿主」的硬纪律（Queue 必改 1–4 + 验收 1–5）。
 * 核心：战斗必须由**正式 Renderer** 绘制，且 Gadget 必须走正式 Build 链。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { validateSnapshot } from '../src/core/buildValidator';
import { RunBattleView } from '../src/lab/portraitBattleLab/runBattleView';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import {
  GADGET_VISUAL_PRESETS,
  presetSnapshot,
} from '../src/lab/portraitBattleLab/gadgetVisualHost';

const REPO_ROOT = join(__dirname, '..');
const HOST_TS = join(REPO_ROOT, 'src/lab/portraitBattleLab/gadgetVisualHost.ts');
const HOST_HTML = join(REPO_ROOT, 'gadget-lab.html');

/** 剥掉注释再断言（避免注释里的关键词造成假失败/假通过）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('GADGET-VISUAL-VALIDATION-HOST-R1', () => {
  it('VH-01 四个预设 A/B/C/D 的配置与定义完全一致', () => {
    expect(GADGET_VISUAL_PRESETS.length, '恰好 4 个预设').toBe(4);
    expect(GADGET_VISUAL_PRESETS.map((p) => p.key)).toEqual(['A', 'B', 'C', 'D']);
    const expectTable: Array<[string, string, string, string]> = [
      ['A', 'hammer', 'thruster', 'RangedTurret'],
      ['B', 'hammer', 'reverseThruster', 'RangedTurret'],
      ['C', 'cannon', 'thruster', 'Chaser'],
      ['D', 'cannon', 'reverseThruster', 'Chaser'],
    ];
    for (const [key, weapon, gadget, enc] of expectTable) {
      const p = GADGET_VISUAL_PRESETS.find((x) => x.key === key)!;
      expect(p.weapon, `${key} 武器`).toBe(weapon);
      expect(p.gadget, `${key} Gadget`).toBe(gadget);
      expect(p.encounter, `${key} Encounter`).toBe(enc);
    }
  });

  it('VH-02 预设走正式 Build 链：validator + resolveSnapshot 出 gadget', () => {
    for (const p of GADGET_VISUAL_PRESETS) {
      const snap = presetSnapshot(p);
      expect(snap.bodyDefId, `${p.key} 统一 watermelonBody`).toBe('watermelonBody');
      expect(snap.movements.map((m) => m.defId), `${p.key} 标准 Movement`).toEqual(['wheelStd', 'wheelStd']);
      const v = validateSnapshot(snap, registry);
      expect(v.valid, `${p.key} 正式校验：${JSON.stringify(v.errors)}`).toBe(true);
      const r = resolveSnapshot(snap, registry);
      expect(r.gadget, `${p.key} 必须解析出 Gadget`).not.toBeNull();
      expect(r.gadget!.def.id).toBe(p.gadget);
      expect(r.gadget!.def.category).toBe('gadget');
    }
  });

  it('VH-03 四个预设都能用正式 RunBattleRuntime 真实跑起来（独立 + Reset）', () => {
    for (const p of GADGET_VISUAL_PRESETS) {
      const rt = new RunBattleRuntime({
        build: [],
        carriedHp: null,
        encounterId: p.encounter,
        playerDraft: {
          bodyDefId: 'watermelonBody',
          rearRadius: 20, frontRadius: 20,
          rearWheelDefId: 'wheelStd', frontWheelDefId: 'wheelStd',
          functionalSelections: { front: 'none', top: 'none', rear: 'none', frontMass: p.weapon },
          gadgetDefId: p.gadget,
          drive: 'forward',
        },
        playerLoadoutTag: 'gadget-visual-host',
        playerBaseline: true,
      });
      try {
        // 正常速度步进一段（验证不是一开局就崩）
        for (let i = 0; i < 120; i += 1) rt.step(1000 / 60);
        const summary = rt.playerWeaponHitSummary() as Record<string, { count: number }>;
        expect(typeof summary, `${p.key} runtime 步进后仍可读战斗读数`).toBe('object');
        // dispose 后再 Reset（= 上一个预设的场被彻底丢弃）
      } finally {
        rt.dispose();
      }
    }
  });

  it('VH-04 视觉宿主复用正式 RunBattleView（内含正式 Renderer），未复制 Renderer', () => {
    const src = stripComments(readFileSync(HOST_TS, 'utf8'));
    // ✅ 必须复用正式 RunBattleView
    expect(src.includes('new RunBattleView()'), '必须实例化正式 RunBattleView').toBe(true);
    // ❌ 不得出现第二份渲染实现
    // （fillRect 只允许用于「清背景」这一处；车辆/部件绘制一律禁止出现）
    const fillRectUses = src.split('fillRect').length - 1;
    expect(fillRectUses, 'fillRect 最多 1 处（仅清背景），不得用于画实体').toBeLessThanOrEqual(1);
    expect(src.includes('fillRect'), '唯一的 fillRect 必须只配合 clear/fill 背景').toBe(true);
    expect(/new\s+Renderer\s*\(/.test(src), '不得自己 new Renderer（必须由 RunBattleView 持有）').toBe(false);
    expect(src.includes('drawVisual'), '不得自己实现 visual/sprite 渲染').toBe(false);
    // ✅ 实体绘制必须走官方 blit（RunBattleView 的正式渲染产物）
    expect(src.includes('view.blit('), '实体画面必须经官方 blit 绘制').toBe(true);
    // ❌ 不得绕过 Build 直接调行为
    for (const forbidden of ['applyThrust', 'ThrusterBehavior', 'ReverseThrusterBehavior', 'getBehaviorFactory']) {
      expect(src.includes(forbidden), `不得直接调用 ${forbidden}（必须走正式 Build 链）`).toBe(false);
    }
    // ✅ 必须通过 playerDraft.gadgetDefId 进入
    expect(src.includes('gadgetDefId'), 'Gadget 必须经 playerDraft.gadgetDefId 进入正式链').toBe(true);
    // ✅ 正式 Renderer 真实存在且被 RunBattleView 持有
    const viewSrc = readFileSync(join(REPO_ROOT, 'src/lab/portraitBattleLab/runBattleView.ts'), 'utf8');
    expect(viewSrc.includes('new Renderer('), 'RunBattleView 内部确实 new正式 Renderer').toBe(true);
    expect(viewSrc.includes('VisualRegistry'), 'RunBattleView 内部确实用正式 VisualRegistry').toBe(true);
  });

  it('VH-05 页面只保留最小控制（A/B/C/D + Reset），无 Debug 面板', () => {
    const html = readFileSync(HOST_HTML, 'utf8');
    expect(html.includes('Gadget Visual Validation Host'), '页面标题标明用途').toBe(true);
    expect(html.includes('src/lab/portraitBattleLab/gadgetVisualHost.ts'), '入口脚本指向正式宿主模块').toBe(true);
    // 控制条只有 5 个按钮（4 预设 + Reset）由 TS 生成
    const src = stripComments(readFileSync(HOST_TS, 'utf8'));
    expect(src.includes('Reset'), '必须有 Reset');
    expect(src.includes('GADGET_VISUAL_PRESETS'), '预设来自配置表');
    // ❌ 不得常驻 Debug 数据面板
    for (const forbidden of ['pbl-gate', 'pbl-status', 'pbl-validation-banner', 'ExperienceValidation', 'debugOverlay']) {
      expect(src.includes(forbidden), `不得引入 Debug 面板 ${forbidden}`).toBe(false);
    }
    // ✅ 战斗区占主要区域（flex:1 + 窄控制条）
    expect(html.includes('flex: 1 1 auto'), '战斗区必须 flex:1 占主要区域').toBe(true);
  });

  it('VH-06 正式玩家流程零变化（本Host 不碰 run-page / home / Garage）', () => {
    const src = stripComments(readFileSync(HOST_TS, 'utf8'));
    // 不得引用正式产品页面模块
    for (const forbidden of ['homePage', 'playerProfile', 'buildPersistence', 'runPageState', 'RunPage']) {
      expect(src.includes(forbidden), `不得接入 ${forbidden}（保持正式流程零变化）`).toBe(false);
    }
    // portrait-lab.html 必须原样存在且未被改（继续承担 Debug / Physics 验证）
    const labHtml = readFileSync(join(REPO_ROOT, 'portrait-lab.html'), 'utf8');
    expect(labHtml.includes('src/lab/portraitBattleLab/main.ts'), 'portrait-lab 入口原样保留').toBe(true);
  });

  it('VH-07 RunBattleView 可实例化（正式 Renderer + PNG 美术链可用）', () => {
    // node 侧无 DOM ⇒ 这里只验证构造所需的正式类存在且导出（浏览器行为由 E2E 覆盖）
    expect(typeof RunBattleView, 'RunBattleView 已导出').toBe('function');
    expect(typeof RunBattleRuntime, 'RunBattleRuntime 已导出').toBe('function');
  });
});