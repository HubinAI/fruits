/**
 * Queue Q06-HUD-U1｜战斗 HUD + 结算卡 targeted test（node 层可测部分）
 *
 * 覆盖 Q06-HUD-U1 验收（DOM 粘合与每帧 HUD 更新由 main.ts 承担）：
 * 1. 战斗开始后 HUD 数据源（getBattleStatusSnapshot）每帧可读，HP 实时下降；
 * 2. 结算数据：B.hp=0 → step → result（winner/hp 供「胜利/失败 + 整数 HP」展示）；
 * 3. 原配置再战 = 同 Build 重新 loadCustom → status.hp 回满（= maxHp）；
 * 4. 调整配置 = loadCustomPreview → previewMode（回 Editing/Preview 的底层）；
 * 5. HUD 规则：HP bar 比例 = clamp(hp/maxHp, 0..1)、HP 数字取整（与 main 相同公式）。
 */
import { describe, it, expect } from 'vitest';
import { PhysicsLab } from '../src/lab/physicsLab';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import type { BattleConfig } from '../src/battle/battleContract';
import type { BuildSnapshot } from '../src/core/types';
import type { Renderer } from '../src/render/renderer';

const rendererStub = { bind: () => {} } as unknown as Renderer;

function wheels() {
  return [
    { hardpointId: 'rear', defId: 'wheelStd' },
    { hardpointId: 'front', defId: 'wheelStd' },
  ];
}

function ramBuild(id: string): BuildSnapshot {
  return {
    id,
    bodyDefId: 'boxBody',
    quality: 1,
    movements: wheels(),
    functionals: [{ hardpointId: 'front', defId: 'ramHead' }],
  };
}

function plainBuild(id: string): BuildSnapshot {
  return { id, bodyDefId: 'boxBody', quality: 1, movements: wheels(), functionals: [] };
}

const RAM_CONFIG: BattleConfig = {
  spawnA: { x: 400, y: 640, facing: 1 },
  spawnB: { x: 1200, y: 640, facing: -1 },
  settleToGround: true,
  autoDrive: true,
  impact: { threshold: 999 },
};

/** HUD 每帧更新规则（与 main.updateHud 相同公式）：整数 HP + clamp 比例条 */
function hudValue(hp: number, maxHp: number): { text: string; ratio: number } {
  return {
    text: `${Math.round(hp)} / ${Math.round(maxHp)}`,
    ratio: Math.max(0, Math.min(1, hp / Math.max(maxHp, 1))),
  };
}

describe('Q06-HUD-U1 Battle HUD + Result Card', () => {
  it('1. 战斗开始后 HUD 数据源每帧可读，HP 实时下降（A/B 独立）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(ramBuild('A'), plainBuild('B'), RAM_CONFIG);
    const o = lab.orchestrator as PlanckBattleOrchestrator;

    let observedDrop = false;
    for (let i = 0; i < 1500; i++) {
      lab.step(1000 / 60);
      // 每帧读 HUD 数据源（模拟 loop 中 updateHud 的 getBattleStatusSnapshot）
      const s = o.getBattleStatusSnapshot();
      const a = hudValue(s.sideA.hp, s.sideA.maxHp);
      const b = hudValue(s.sideB.hp, s.sideB.maxHp);
      expect(s.sideA.maxHp).toBe(1000);
      expect(s.sideB.maxHp).toBe(1000);
      expect(a.ratio).toBeGreaterThanOrEqual(0);
      expect(a.ratio).toBeLessThanOrEqual(1);
      if (s.sideB.hp < 1000) {
        observedDrop = true;
        expect(b.text).toBe('920 / 1000'); // 整数显示
        expect(b.ratio).toBeCloseTo(0.92, 6);
        expect(s.sideA.hp).toBe(1000); // A 独立不掉
        break;
      }
    }
    expect(observedDrop).toBe(true); // weapon damage 后 HP bar 实时下降
  });

  it('2. 结算数据：B.hp=0 → result（胜利 + 双方整数 HP）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(plainBuild('A'), plainBuild('B'), { autoDrive: false, engine: 'planck' });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    o.vehicleB.hp = 0;
    o.step(1000 / 60);
    const r = o.result;
    expect(r).not.toBeNull();
    expect(r!.winner).toBe('A'); // 结算卡【胜利】
    // 结算卡显示整数 HP（main.showResultModal 用 Math.round）
    expect(hudValue(r!.hpA, 1000).text).toBe('1000 / 1000');
    expect(hudValue(r!.hpB, 1000).text).toBe('0 / 1000');
    // HUD 在 End 后仍可读且与 result 一致
    const s = o.getBattleStatusSnapshot();
    expect(s.sideB.hp).toBe(r!.hpB);
    expect(s.phase).toBe('End');
  });

  it('3. 原配置再战 = 同 Build 重新 loadCustom → HP 回满（HUD 回满重新显示）', () => {
    const lab = new PhysicsLab(rendererStub);
    const a = ramBuild('A');
    const b = plainBuild('B');
    // 第一局：B 扣血
    lab.loadCustom(a, b, RAM_CONFIG);
    const o1 = lab.orchestrator as PlanckBattleOrchestrator;
    for (let i = 0; i < 1500 && o1.vehicleB.hp >= 1000; i++) lab.step(1000 / 60);
    expect(o1.vehicleB.hp).toBeLessThan(1000);

    // 原配置再战：同 Build 直接重建
    lab.loadCustom(a, b, RAM_CONFIG);
    const o2 = lab.orchestrator as PlanckBattleOrchestrator;
    expect(o2).not.toBe(o1);
    const s = o2.getBattleStatusSnapshot();
    expect(s.sideA.hp).toBe(1000); // 回满
    expect(s.sideB.hp).toBe(1000);
    expect(hudValue(s.sideB.hp, s.sideB.maxHp).text).toBe('1000 / 1000');
  });

  it('4. 调整配置 = loadCustomPreview → previewMode（回 Editing/Preview 底层）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(ramBuild('A'), plainBuild('B'), RAM_CONFIG);
    expect(lab.previewMode).toBe(false);

    // 「调整配置」→ Editing：恢复 Draft Preview
    lab.loadCustomPreview(ramBuild('A'), plainBuild('B'));
    expect(lab.previewMode).toBe(true);
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    expect(o.getBattleStatusSnapshot().sideA.hp).toBe(1000); // 预览态满血站桩
  });

  it('5. HUD 规则：clamp 比例 + 整数显示（含超界保护）', () => {
    expect(hudValue(920, 1000).text).toBe('920 / 1000');
    expect(hudValue(920, 1000).ratio).toBeCloseTo(0.92, 6);
    // clamp：hp 超过 max 或为负时比例夹在 0..1
    expect(hudValue(1200, 1000).ratio).toBe(1);
    expect(hudValue(-50, 1000).ratio).toBe(0);
    // maxHp=0 保护（不除零）
    expect(hudValue(0, 0).ratio).toBe(0);
  });
});
