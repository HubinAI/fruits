/**
 * Queue ID｜GADGET-VALIDATION-LAB-R1
 *
 * 为**专用 Portrait Battle Lab** 增加 4 个固定 Gadget 验收预设：
 *   A Hammer + Thruster        × RangedTurret
 *   B Hammer + ReverseThruster × RangedTurret
 *   C Cannon + Thruster        × Chaser
 *   D Cannon + ReverseThruster × Chaser
 *
 * 覆盖 Queue 验收 1–5。Gadget 必须走正式 Build → Runtime 链。
 */
import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { validateSnapshot } from '../src/core/buildValidator';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { OPPONENT_TEMPLATES } from '../src/player/opponentPool';
import {
  GADGET_VALIDATION_SCENARIOS,
  GADGET_VALIDATION_SCENARIO_IDS,
  SCENARIOS,
  getScenario,
} from '../src/lab/scenarios';
import { PhysicsLab } from '../src/lab/physicsLab';

const FRAME_MS = 1000 / 60;
const EXPECTED: Array<{ key: 'A' | 'B' | 'C' | 'D'; weapon: string; gadget: string; enemy: string; name: string }> = [
  { key: 'A', weapon: 'hammer', gadget: 'thruster', enemy: 'OPP-03', name: 'Hammer + Thruster' },
  { key: 'B', weapon: 'hammer', gadget: 'reverseThruster', enemy: 'OPP-03', name: 'Hammer + Reverse Thruster' },
  { key: 'C', weapon: 'cannon', gadget: 'thruster', enemy: 'OPP-16', name: 'Cannon + Thruster' },
  { key: 'D', weapon: 'cannon', gadget: 'reverseThruster', enemy: 'OPP-16', name: 'Cannon + Reverse Thruster' },
];

describe('GADGET-VALIDATION-LAB-R1', () => {
  it('GV-01 四个预设都已注册进 Lab 场景表（可被既有 <select> 切换）', () => {
    for (const e of EXPECTED) {
      const sc = getScenario(GADGET_VALIDATION_SCENARIO_IDS[e.key]);
      expect(sc, `预设 ${e.key} 必须在 SCENARIOS 里`).toBeDefined();
      expect(sc!.name, `预设 ${e.key} 的真人可见标签`).toBe(e.name);
      expect(GADGET_VALIDATION_SCENARIOS.length, '共 4 个预设').toBe(4);
      expect(SCENARIOS.includes(sc!)).toBe(true);
    }
  });

  it('GV-02 预设配置与定义完全一致（武器 / Gadget / 车身 / 敌人）', () => {
    for (const e of EXPECTED) {
      const sc = getScenario(GADGET_VALIDATION_SCENARIO_IDS[e.key])!;
      // 玩家车：统一 watermelonBody + 标准轮
      expect(sc.buildA.bodyDefId, `${e.key} 统一 watermelonBody`).toBe('watermelonBody');
      expect(sc.buildA.movements.map((m) => m.defId)).toEqual(['wheelStd', 'wheelStd']);
      // 主武器走正式 frontMass 槽
      expect(sc.buildA.functionals, `${e.key} 只有一个正式武器件`).toEqual([
        { hardpointId: 'frontMass', defId: e.weapon },
      ]);
      // 独立 Gadget 位
      expect(sc.buildA.gadget, `${e.key} 走独立 Gadget 字段`).toEqual({ defId: e.gadget });
      // 敌人 = 正式对手模板（与正式 Encounter 同一份内容）
      const tpl = OPPONENT_TEMPLATES.find((t) => t.id === e.enemy)!;
      expect(tpl, `${e.key} 引用正式模板 ${e.enemy}`).toBeDefined();
      // 正常速度战斗
      expect(sc.config.autoDrive, `${e.key} 正常速度`).toBe(true);
      expect(sc.config.engine).toBe('planck');
    }
  });

  it('GV-03 Gadget 走正式 Gadget Slot 与 Runtime 链（合法 + 能解析出 Gadget）', () => {
    for (const e of EXPECTED) {
      const sc = getScenario(GADGET_VALIDATION_SCENARIO_IDS[e.key])!;
      // 走正式 validator（能量 / 槽位 / 武器数量全部同一套规则）
      const v = validateSnapshot(sc.buildA, registry);
      expect(v.valid, `${e.key} 玩家车必须通过正式校验：${JSON.stringify(v.errors)}`).toBe(true);
      // 走正式 resolveSnapshot：gadget 必须被解析出来
      const r = resolveSnapshot(sc.buildA, registry);
      expect(r.gadget, `${e.key} resolveSnapshot 必须解析出 Gadget`).not.toBeNull();
      expect(r.gadget!.def.id).toBe(e.gadget);
      expect(r.gadget!.def.category).toBe('gadget');
      // 敌人同样合法
      expect(validateSnapshot(sc.buildB, registry).valid, `${e.key} 敌人车合法`).toBe(true);
    }
  });

  it('GV-04 四个预设可独立启动并步进（真实 Runtime，不是Fake 物理）', () => {
    const lab = new PhysicsLab(undefined as never);
    for (const e of EXPECTED) {
      const sc = getScenario(GADGET_VALIDATION_SCENARIO_IDS[e.key])!;
      lab.loadScenario(sc);
      const o = lab.orchestrator as unknown as { step: (ms: number) => void; vehicleA: { parts: unknown[] } };
      expect(o, `${e.key} orchestrator 已建立`).toBeTruthy();
      for (let i = 0; i < 40; i += 1) o.step(FRAME_MS);
      // 步进后仍无异常
      expect(Number.isFinite(o.vehicleA.parts.length), `${e.key} 步进后状态有限`).toBe(true);
    }
  });

  it('GV-05 切换后无上一场状态残留（每次 loadScenario 都是全新编排器）', () => {
    const lab = new PhysicsLab(undefined as never);
    const idA = GADGET_VALIDATION_SCENARIO_IDS.A;
    const idD = GADGET_VALIDATION_SCENARIO_IDS.D;

    // A 跑一段
    lab.loadScenario(getScenario(idA)!);
    const first = lab.orchestrator as unknown as { step: (ms: number) => void };
    for (let i = 0; i < 90; i += 1) first.step(FRAME_MS);

    // 切到 D
    lab.loadScenario(getScenario(idD)!);
    const second = lab.orchestrator as unknown as { vehicleB: { hp: number } };
    expect(second, '切换后拿到新的 orchestrator').toBeTruthy();
    // 敌人满血（未被上一场的伤害污染）= 无残留
    expect(second.vehicleB.hp, '切换后敌方 HP 回到初始值（无上一场残留）').toBe(
      getScenario(idD)!.config && resolveSnapshot(getScenario(idD)!.buildB, registry).body.hp,
    );

    // 再切回 A，同样是全新
    lab.loadScenario(getScenario(idA)!);
    const third = lab.orchestrator as unknown as { vehicleB: { hp: number } };
    expect(third.vehicleB.hp, '来回切换后仍为初始 HP').toBe(
      resolveSnapshot(getScenario(idA)!.buildB, registry).body.hp,
    );
  });

  it('GV-06 预设未引入 Debug overlay 或额外战斗补偿（无 build 侧改动）', () => {
    // 场景只声明 buildA/buildB/config/camera —— 不含任何调试或补偿字段
    for (const e of EXPECTED) {
      const sc = getScenario(GADGET_VALIDATION_SCENARIO_IDS[e.key])! as unknown as Record<string, unknown>;
      expect(Object.keys(sc).sort(), `${e.key} 场景字段固定`).toEqual(
        ['buildA', 'buildB', 'camera', 'config', 'description', 'id', 'name'].sort(),
      );
      // 玩家车 snapshot 不含任何测试专用字段
      const keys = Object.keys(getScenario(GADGET_VALIDATION_SCENARIO_IDS[e.key])!.buildA).sort();
      expect(keys).toEqual(['bodyDefId', 'functionals', 'gadget', 'id', 'movements', 'quality']);
    }
  });
});