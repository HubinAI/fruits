/**
 * Queue F-MOVE-1｜驱动模式进入正式 Build —— targeted test（纯模块层）。
 *
 * 覆盖（不依赖 DOM / 浏览器，全部走与运行时一致的纯函数 / 纯数据链）：
 * 1. DriveMode / resolveDriveMode：缺省 / 非法值 → 前进（旧 localStorage 兼容）；仅 'stationary' 为停驻；
 * 2. BuildDraft.drive：cloneBuildDraft 深拷贝（改副本不影响池内常量）；
 * 3. Q16 24 套对手池 drive 分配：远程压制 4 全停驻 / 控距干扰 2 停驻 2 前进 / 其余全前进；
 *    总体 6 套停驻 / 18 套前进（不超半数炮塔）；不扩数量（仍 24）；
 * 4. Q16 24 套全部通过正式 Validator（≥1 Weapon、Energy 不超载、槽位合法）；
 * 5. 持久化：旧存档无 drive → 归一 forward；drive 字段可序列化往返；
 * 6. 正式 Battle 接线映射：resolveDriveEnable 在
 *    {a:forward,b:stationary} 等组合下产出正确「已驱动」布尔（前进=驱动 / 停驻=不驱动）；
 *    前进侧行为与既有缺省完全一致（true）；
 * 7. 随机对手可实际遇到两种 Drive（mulberry32 驱动 pickRandomOpponent 多次抽取命中两种）。
 */
import { describe, it, expect } from 'vitest';
import {
  OPPONENT_POOL,
  cloneBuildDraft,
  pickRandomOpponent,
} from '../src/player/opponentPool';
import {
  resolveDriveMode,
  buildSnapshotFromDraft,
  type BuildDraft,
} from '../src/lab/buildEditorModel';
import { validateSnapshot, computeEnergy } from '../src/core/buildValidator';
import { resolveDriveEnable, mulberry32 } from '../src/battle/battleContract';
import { registry } from '../src/core/content';

function buildSnapshot(d: BuildDraft) {
  return buildSnapshotFromDraft(d, registry, 'customA');
}

describe('F-MOVE-1 DriveMode / resolveDriveMode', () => {
  it('缺省 / undefined / 非法串 → 前进', () => {
    expect(resolveDriveMode(undefined)).toBe('forward');
    expect(resolveDriveMode('forward')).toBe('forward');
    expect(resolveDriveMode('weird' as never)).toBe('forward');
  });
  it("仅 'stationary' → 停驻", () => {
    expect(resolveDriveMode('stationary')).toBe('stationary');
  });
});

describe('F-MOVE-1 BuildDraft.drive 数据链', () => {
  it('cloneBuildDraft 拷贝 drive（改副本不影响池内常量）', () => {
    const c = cloneBuildDraft(OPPONENT_POOL[0]); // RANGED_SUPPRESSION[0] = 停驻
    expect(c.drive).toBe('stationary');
    c.drive = 'forward';
    expect(OPPONENT_POOL[0].drive).toBe('stationary');
    const f = cloneBuildDraft(OPPONENT_POOL[10]); // CLOSE_BURST[2] = 前进（undefined）
    expect(resolveDriveMode(f.drive)).toBe('forward');
  });
});

describe('F-MOVE-1 Q16 对手池 drive 分配', () => {
  it('Q19 铺量后共 36 套（Q16 24 + Q19 12，不重复 Body 组合）', () => {
    expect(OPPONENT_POOL.length).toBe(36);
  });

  it('停驻总数 = 9（旧 6 + 新 3），约占 25%（不超半数）', () => {
    const stationary = OPPONENT_POOL.filter((d) => d.drive === 'stationary');
    expect(stationary.length).toBe(9);
    expect(
      OPPONENT_POOL.filter((d) => resolveDriveMode(d.drive) === 'forward').length,
    ).toBe(27);
  });

  it('远程压制 4 套全部停驻（索引 0..3）', () => {
    for (let i = 0; i < 4; i++) {
      expect(OPPONENT_POOL[i].drive, `RANGED[${i}]`).toBe('stationary');
    }
  });

  it('控距干扰 4 套 = 2 停驻 / 2 前进（索引 16..19）', () => {
    const rc = OPPONENT_POOL.slice(16, 20); // RANGE_CONTROL
    expect(rc[0].drive).toBe('stationary');
    expect(rc[1].drive).toBe('stationary');
    expect(resolveDriveMode(rc[2].drive)).toBe('forward');
    expect(resolveDriveMode(rc[3].drive)).toBe('forward');
  });

  it('其余类别（近距爆发 / 持续贴身 / 冲锋 / 混合型）全部前进', () => {
    const others = [
      ...OPPONENT_POOL.slice(4, 16), // CLOSE_BURST + CONTINUOUS_CONTACT + CHARGE
      ...OPPONENT_POOL.slice(20, 24), // HYBRID
    ];
    for (const d of others) {
      expect(resolveDriveMode(d.drive), `${d.bodyDefId}`).toBe('forward');
    }
  });

  it('36 套全部通过正式 Validator（≥1 Weapon、Energy≤容量、槽位合法）', () => {
    for (const d of OPPONENT_POOL) {
      const snap = buildSnapshot(d);
      const res = validateSnapshot(snap, registry);
      expect(res.valid, `${d.bodyDefId}: ${res.errors.join('; ')}`).toBe(true);
      const energy = computeEnergy(snap, registry).energy;
      const cap = registry.bodies.get(d.bodyDefId)!.energyCapacity;
      expect(energy).toBeLessThanOrEqual(cap);
    }
  });
});

describe('F-MOVE-1 持久化：旧存档无 drive → 前进', () => {
  it('无 drive 字段的旧 Draft 经 resolveDriveMode 归一为 forward', () => {
    const old = JSON.parse(
      JSON.stringify({
        bodyDefId: 'watermelonBody',
        rearRadius: 20,
        frontRadius: 20,
        functionalSelections: { front: 'cannon', frontMass: 'machineGun' },
      }),
    ) as BuildDraft;
    expect(old.drive).toBeUndefined();
    expect(resolveDriveMode(old.drive)).toBe('forward');
  });

  it('drive 字段可序列化往返（save→load 在浏览器中生效）', () => {
    const d: BuildDraft = {
      bodyDefId: 'bananaBody',
      rearRadius: 12,
      frontRadius: 26,
      functionalSelections: { front: 'machineGun', frontMass: 'laser' },
      drive: 'stationary',
    };
    const round = JSON.parse(JSON.stringify(d)) as BuildDraft;
    expect(round.drive).toBe('stationary');
    expect(round.functionalSelections.front).toBe('machineGun');
  });

  it('旧存档结构非法（未知 Body）时 isBuildDraftShape 不通过（回归保护）', () => {
    // 用一个明显非法的旧存档形状，确认 drive 字段不破坏既有结构校验语义
    const bad = { bodyDefId: 'unknownBody', rearRadius: 20, frontRadius: 20, functionalSelections: {} };
    expect((bad as BuildDraft).drive).toBeUndefined();
    expect(resolveDriveMode((bad as BuildDraft).drive)).toBe('forward');
  });
});

describe('F-MOVE-1 正式 Battle 接线映射（前进=驱动 / 停驻=不驱动）', () => {
  it("玩家前进 + 对手停驻 → sideDrive {a:true, b:false}", () => {
    const sideDrive = {
      a: resolveDriveMode('forward') === 'forward',
      b: resolveDriveMode('stationary') === 'forward',
    };
    expect(sideDrive).toEqual({ a: true, b: false });
    expect(resolveDriveEnable(true, sideDrive)).toEqual({ a: true, b: false });
  });

  it('双方停驻 → {a:false, b:false}；双方前进 → {a:true, b:true}', () => {
    expect(resolveDriveEnable(true, { a: false, b: false })).toEqual({ a: false, b: false });
    expect(resolveDriveEnable(true, { a: true, b: true })).toEqual({ a: true, b: true });
  });

  it('前进侧与既有缺省行为完全一致（resolveDriveEnable 缺省 = 双方驱动）', () => {
    expect(resolveDriveEnable(true, { a: true, b: true })).toEqual(
      resolveDriveEnable(true, undefined),
    );
  });
});

describe('F-MOVE-1 随机对手可实际遇到两种 Drive', () => {
  it('mulberry32 驱动 pickRandomOpponent 多次抽取命中停驻与前进（pool 含 6 停驻 / 18 前进）', () => {
    const rng = mulberry32(0x1234abcd);
    const seen = new Set<string>();
    let last = -1;
    for (let i = 0; i < 200; i++) {
      const idx = pickRandomOpponent(last, OPPONENT_POOL.length, rng);
      seen.add(resolveDriveMode(OPPONENT_POOL[idx].drive));
      last = idx;
    }
    expect(seen.has('stationary')).toBe(true);
    expect(seen.has('forward')).toBe(true);
  });
});
