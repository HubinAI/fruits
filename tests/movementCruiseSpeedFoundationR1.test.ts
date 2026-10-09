/**
 * Queue ID｜MOVEMENT-CRUISE-SPEED-FOUNDATION-R1
 *
 * 目标：把「持续速度」正式变成 Movement Foundation 的**数据能力**，
 * 且**不改变任何当前正式玩法表现**（四档 Movement 第一版统一 1.5）。
 *
 * 本文件覆盖 Queue 验收 1–4：
 *   ① 所有当前 Movement 的 cruiseSpeedPxPerStep 均为 1.5；
 *   ② 标准现有配置解析后的 player drive target 仍为 1.5（正式行为无变化）；
 *   ③ 混搭解析：1.5+1.5 → 1.5；fixture 1.5+3.0 → 1.5；单侧 → 该侧数值；
 *   ④ Runtime 玩家 drive 已由 Movement 数据链提供。
 */
import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import type { WheelDef } from '../src/core/types';
import {
  FALLBACK_CRUISE_SPEED_PX_PER_STEP,
  resolveVehicleCruiseSpeedPxPerStep,
} from '../src/battle/planckMovement';
import { EMPTY_SLOT } from '../src/lab/buildEditorModel';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { WEAPON_SLOT, defaultPlayerDraft } from '../src/product/playerLoadout';

/** 临时 fixture：只在测试内构造，不写进 content.ts（禁止改动正式数值）。 */
function fixtureWheel(id: string, cruise: number): WheelDef {
  return {
    kind: 'wheel',
    id,
    name: id,
    radius: 20,
    mass: 10,
    driveTorque: 100,
    driveForce: 0.005,
    maxRPM: 300,
    grip: 0.9,
    energy: 0,
    cruiseSpeedPxPerStep: cruise,
  };
}

/** 解析器只吃 wheels 数组，构造最小形状即可（不建物理世界）。 */
function wheelsOf(...defs: WheelDef[]): { def: WheelDef }[] {
  return defs.map((def) => ({ def }));
}

const OFFICIAL_IDS = ['wheelStd', 'smallWheel', 'largeWheel', 'heavyWheel'] as const;

describe('MOVEMENT-CRUISE-SPEED-FOUNDATION-R1', () => {
  /* ---------------- 验收 ①：所有当前 Movement 均为 1.5 ---------------- */
  it('CS-01 四档正式 Movement 的 cruiseSpeedPxPerStep 均为 1.5（第一版不差异化）', () => {
    for (const id of OFFICIAL_IDS) {
      const def = registry.movements.get(id);
      expect(def, `${id} 必须存在于 registry.movements`).toBeDefined();
      expect(
        def!.cruiseSpeedPxPerStep,
        `${id} 第一版必须填 1.5（保证正式玩法与改前一致）`,
      ).toBe(1.5);
    }
  });

  /* ---------------- 验收 ③：混搭解析规则 ---------------- */
  it('CS-02 前后均有 Movement → 取两者较低者', () => {
    // 1.5 + 1.5 → 1.5
    expect(
      resolveVehicleCruiseSpeedPxPerStep(wheelsOf(fixtureWheel('a', 1.5), fixtureWheel('b', 1.5))),
      '1.5 + 1.5 → 1.5',
    ).toBe(1.5);

    // 1.5 + 3.0 → 1.5（短板效应）
    expect(
      resolveVehicleCruiseSpeedPxPerStep(wheelsOf(fixtureWheel('a', 1.5), fixtureWheel('b', 3.0))),
      '1.5 + 3.0 → 1.5（取较低）',
    ).toBe(1.5);

    // 顺序无关
    expect(
      resolveVehicleCruiseSpeedPxPerStep(wheelsOf(fixtureWheel('a', 3.0), fixtureWheel('b', 1.5))),
      '3.0 + 1.5 → 1.5（取较低，与顺序无关）',
    ).toBe(1.5);
  });

  it('CS-03 只有一侧有效 → 使用该侧数值', () => {
    expect(
      resolveVehicleCruiseSpeedPxPerStep(wheelsOf(fixtureWheel('only', 2.5))),
      '单侧 2.5 → 2.5',
    ).toBe(2.5);
    expect(
      resolveVehicleCruiseSpeedPxPerStep(wheelsOf(fixtureWheel('only', 3.0))),
      '单侧 3.0 → 3.0',
    ).toBe(3.0);
  });

  it('CS-04 无有效 Movement → 安全 fallback（= 1.5，不额外创造推进能力）', () => {
    expect(resolveVehicleCruiseSpeedPxPerStep([]), '空 wheels → fallback').toBe(
      FALLBACK_CRUISE_SPEED_PX_PER_STEP,
    );
    expect(FALLBACK_CRUISE_SPEED_PX_PER_STEP, 'fallback 与改前常量同值 = 1.5').toBe(1.5);
  });

  it('CS-05 非法值视为该侧无效（不污染解析）', () => {
    const bad = { ...fixtureWheel('bad', Number.NaN) };
    expect(
      resolveVehicleCruiseSpeedPxPerStep([
        { def: bad },
        { def: fixtureWheel('ok', 2.0) },
      ]),
      'NaN 侧被跳过 → 取 2.0',
    ).toBe(2.0);
    expect(
      resolveVehicleCruiseSpeedPxPerStep([
        { def: { ...fixtureWheel('bad', Number.NaN) } },
      ]),
      '只有 NaN 侧 → fallback',
    ).toBe(FALLBACK_CRUISE_SPEED_PX_PER_STEP);
    expect(
      resolveVehicleCruiseSpeedPxPerStep([{ def: fixtureWheel('neg', -1) }]),
      '负值侧无效 → fallback',
    ).toBe(FALLBACK_CRUISE_SPEED_PX_PER_STEP);
  });

  /* ---------------- 验收 ② / ④：Runtime 玩家 drive 走数据链 ---------------- */
  it('CS-06 标准现有配置：Runtime 解析出的玩家 cruise speed 仍为 1.5（行为零变化）', () => {
    const base = defaultPlayerDraft();
    for (const movementId of OFFICIAL_IDS) {
      const rt = new RunBattleRuntime({
        build: [],
        carriedHp: null,
        encounterId: 'ProtoRusher',
        playerDraft: {
          ...base,
          frontWheelDefId: movementId,
          frontRadius: registry.movements.get(movementId)!.radius,
          rearWheelDefId: movementId,
          rearRadius: registry.movements.get(movementId)!.radius,
          functionalSelections: {
            front: EMPTY_SLOT,
            top: EMPTY_SLOT,
            rear: EMPTY_SLOT,
            [WEAPON_SLOT]: 'cannon',
          },
        },
        playerLoadoutTag: 'profile-equipped',
        playerBaseline: true,
      });
      try {
        const wheels = (rt.orchestrator as unknown as { vehicleA: { wheels: unknown[] } }).vehicleA
          .wheels;
        expect(
          resolveVehicleCruiseSpeedPxPerStep(wheels as never),
          `${movementId}+${movementId} 解析结果必须仍是 1.5`,
        ).toBe(1.5);
      } finally {
        rt.dispose();
      }
    }
  });

  it('CS-07 默认玩家装配（未显式指定 Movement）解析同样为 1.5', () => {
    const base = defaultPlayerDraft();
    const rt = new RunBattleRuntime({
      build: [],
      carriedHp: null,
      encounterId: 'ProtoRusher',
      playerDraft: {
        ...base,
        functionalSelections: {
          front: EMPTY_SLOT,
          top: EMPTY_SLOT,
          rear: EMPTY_SLOT,
          [WEAPON_SLOT]: 'cannon',
        },
      },
      playerLoadoutTag: 'profile-equipped',
      playerBaseline: true,
    });
    try {
      const wheels = (rt.orchestrator as unknown as { vehicleA: { wheels: unknown[] } }).vehicleA
        .wheels;
      expect(resolveVehicleCruiseSpeedPxPerStep(wheels as never)).toBe(1.5);
    } finally {
      rt.dispose();
    }
  });

  /* ---------------- 边界：maxRPM 未被删除、未被改动 ---------------- */
  it('CS-08 maxRPM 与其它物理参数未被本Queue 触碰', () => {
    const expected: Record<string, { radius: number; maxRPM: number; driveTorque: number; mass: number }> = {
      wheelStd: { radius: 20, maxRPM: 300, driveTorque: 100, mass: 10 },
      smallWheel: { radius: 12, maxRPM: 380, driveTorque: 520, mass: 6 },
      largeWheel: { radius: 26, maxRPM: 240, driveTorque: 40, mass: 14 },
      heavyWheel: { radius: 20, maxRPM: 260, driveTorque: 35, mass: 20 },
    };
    for (const id of OFFICIAL_IDS) {
      const d = registry.movements.get(id)!;
      const e = expected[id]!;
      expect(d.radius, `${id}.radius 不得变`).toBe(e.radius);
      expect(d.maxRPM, `${id}.maxRPM 不得变/不得删`).toBe(e.maxRPM);
      expect(d.driveTorque, `${id}.driveTorque 不得变`).toBe(e.driveTorque);
      expect(d.mass, `${id}.mass 不得变`).toBe(e.mass);
    }
  });
});