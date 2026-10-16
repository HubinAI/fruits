/**
 * GARAGE-V2-QUALITY-RUN-ADAPTER-R1｜七档品质 → **真实战斗** 的最小桥接（γ：显式 quality 字段）。
 *
 * 本文件回答三个问题（全部真实链路，禁止手写伤害伪造）：
 *  A｜倍率表（QT-01..02）：白→彩 = 1.00/1.25/1.50/1.75/2.00/2.25/2.50；
 *    ⚠️ 品质倍率**替代**旧 star 倍率（不双乘）—— quality 存在时 star 伤害倍率不参与；
 *    无 quality 字段 ⇒ 旧 star 逻辑**逐字保持**（旧 Build/旧存档/对手池零漂移）。
 *  B｜真实战斗（QT-03..05）：同一门炮、同一对手（ProtoRusher）、固定步序列——
 *    七档真实命中扣血逐档严格递增；第一发命中时刻逐档相同（物理一致性证明）；
 *    只有该挂点被改（另一件武器读数不变）。
 *  C｜旧基线冻结（QT-06..07）：旧 ★1..★5 无 quality 快照与改前读数逐字一致；
 *    white 不写 snapshot 字段（旧快照形状逐字节不变）。
 *
 * ⚠️ 全部断言读「正式 damage 事件里真实扣掉的那个数」（RunBattleRuntime.
 *    playerWeaponHitSummary），不是 UI 文案、不是自算倍率。
 */
import { describe, it, expect } from 'vitest';
import { registry } from '../src/core/content';
import {
  QUALITY_TIERS_CORE,
  qualityDamageMultiplier,
  applyInstallTier,
} from '../src/core/installQuality';
import type { QualityTierId } from '../src/core/types';
import {
  resolveSnapshot,
  starDamageMultiplier,
  starTierDamage,
  starTierEnergy,
  weaponMainDamage,
  weaponNumericParams,
} from '../src/core/buildSnapshot';
import { validateSnapshot } from '../src/core/buildValidator';
import { buildSnapshotFromDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import type { BuildSnapshot } from '../src/core/types';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import { defaultPlayerDraft, WEAPON_SLOT } from '../src/product/playerLoadout';

/* ---------------------------------------------------------------- 夹具 */

/** 与 productStarPowerR2C 同款内存 localStorage（node 无原生）。 */
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? (this.m.get(k) as string) : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  get length(): number { return this.m.size; }
}
(globalThis as Record<string, unknown>)['localStorage'] = new MemStorage();

/** 产品默认车（frontMass = cannon ★1），可选给主武器槽叠加显式品质档。 */
function playerDraftQ(quality: QualityTierId | null): BuildDraft {
  const base = defaultPlayerDraft();
  const out: BuildDraft = { ...base, functionalSelections: { ...base.functionalSelections } };
  if (quality) {
    out.functionalQualities = { [WEAPON_SLOT]: quality };
  }
  return out;
}

/** draft → 正式链解析（build → validate → resolve）。 */
function resolvedOf(draft: BuildDraft) {
  const snap = buildSnapshotFromDraft(draft, registry, 'qt-r1');
  const v = validateSnapshot(snap, registry);
  expect(v.valid, `夹具必须合法：${v.errors.join('；')}`).toBe(true);
  return resolveSnapshot(snap, registry);
}

/** 真实 Planck 战斗（正式链路 + 正式 Encounter，固定对手 ProtoRusher）。 */
function realBattle(draft: BuildDraft) {
  const rt = new RunBattleRuntime({
    encounterId: 'ProtoRusher',
    playerDraft: draft,
    playerLoadoutTag: 'profile-equipped',
  });
  try {
    const STEP_MS = 1000 / 60;
    let steps = 0;
    while (rt.result === null && steps < 2400) {
      rt.step(STEP_MS);
      steps += 1;
    }
    return {
      result: rt.result,
      weapons: rt.playerWeapons(),
      hits: rt.playerWeaponHitSummary(),
    };
  } finally {
    rt.dispose();
  }
}

/* ======================================================================
   A. 倍率表
   ====================================================================== */

describe('QT｜A. 七档品质倍率（γ 显式字段）', () => {
  it('QT-01 倍率表 = 白1.00/绿1.25/蓝1.50/紫1.75/橙2.00/红2.25/彩2.50；非法输入恒等 1', () => {
    const EXPECTED = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5];
    expect([...QUALITY_TIERS_CORE]).toEqual(['white', 'green', 'blue', 'purple', 'orange', 'red', 'chrome']);
    for (let i = 0; i < QUALITY_TIERS_CORE.length; i++) {
      expect(qualityDamageMultiplier(QUALITY_TIERS_CORE[i]!), `第 ${i + 1} 档`).toBe(EXPECTED[i]);
    }
    // 非法 / 缺省一律恒等（旧链路零风险）
    expect(qualityDamageMultiplier(undefined)).toBe(1);
    expect(qualityDamageMultiplier('not-a-tier' as QualityTierId)).toBe(1);
  });

  it('QT-02 不双乘：quality 存在 ⇒ 品质倍率**替代** star 倍率（cannon=80：紫=140，不是 80×1.5×1.75）', () => {
    for (const q of QUALITY_TIERS_CORE) {
      const def = applyInstallTier(registry.functionals.get('cannon')!, undefined, q);
      expect(weaponMainDamage(def), `cannon ${q}`).toBe(Math.round(80 * qualityDamageMultiplier(q)));
    }
    // quality + 高 star 并存 ⇒ 伤害只按 quality（紫 1.75），不是 1.75×1.75；
    // 能量仍按 star 口径（★5 ⇒ ×1.1 取整）
    const both = applyInstallTier(registry.functionals.get('cannon')!, 5, 'purple');
    expect(weaponMainDamage(both)).toBe(Math.round(80 * 1.75));
    expect(both.energy).toBe(Math.round(30 * 1.1));
    // 无 quality ⇒ star 逻辑逐字保持（★2 = 100）
    expect(weaponMainDamage(applyInstallTier(registry.functionals.get('cannon')!, 2, undefined))).toBe(
      starTierDamage(80, 2),
    );
  });

  it('QT-02b 无 quality 路径与旧星级层等价：全部正式部件 × star 2..5 逐字段相同', () => {
    // 防副本漂移的等价断言：installQuality 的 star 路径必须逐字段等于
    // 「官方保留函数 starDamageMultiplier / starTierEnergy 现算的结果」。
    for (const def of registry.functionals.values()) {
      const before = weaponNumericParams(def);
      for (const star of [2, 3, 4, 5]) {
        const viaInstall = applyInstallTier(def, star, undefined);
        const got = weaponNumericParams(viaInstall);
        // 伤害键 = round(base × 官方星级倍率)；其余键逐字不变
        for (const [k, v] of Object.entries(before)) {
          if (/damage/i.test(k)) {
            expect(got[k], `${def.id}.${k} ★${star}`).toBe(Math.round(v * starDamageMultiplier(star)));
          } else {
            expect(got[k], `${def.id}.${k} ★${star} 非伤害键`).toBe(v);
          }
        }
        // 能量 = 官方 starTierEnergy 口径
        expect(viaInstall.energy, `${def.id} energy ★${star}`).toBe(starTierEnergy(def.energy, star));
        // 非伤害键逐字不变（对象级复核）
        for (const k of Object.keys(before)) {
          if (/damage/i.test(k)) continue;
          expect(got[k], `${def.id}.${k}`).toBe(before[k]);
        }
      }
      // star<=1 ⇒ 同一对象引用（SP-05 引用语义逐字保持）
      expect(applyInstallTier(def, 1, undefined)).toBe(def);
      expect(applyInstallTier(def, undefined, undefined)).toBe(def);
    }
  });
});

/* ======================================================================
   B. 真实战斗
   ====================================================================== */

describe('QT｜B. 真实战斗：七档命中伤害逐档严格递增（不是 UI 数字）', () => {
  it('QT-03 同炮同对手：真实第一发扣血 = round(80 × 倍率)，七档严格单调', () => {
    const EXPECTED = [80, 100, 120, 140, 160, 180, 200];
    let prevFirst = 0;
    for (let i = 0; i < QUALITY_TIERS_CORE.length; i++) {
      const q = QUALITY_TIERS_CORE[i]!;
      const r = realBattle(playerDraftQ(q));
      expect(r.result, `${q} 场必须打完`).not.toBeNull();
      const h = r.hits['cannon'];
      expect(h, `${q} 场必须有真实炮击命中记录`).toBeDefined();
      expect(h!.count).toBeGreaterThan(0);
      const first = h!.damages[0]!;
      expect(first, `${q} 第一发真实扣血`).toBe(EXPECTED[i]);
      if (prevFirst > 0) expect(first, `${q} 必须严格强于上一档`).toBeGreaterThan(prevFirst);
      prevFirst = first;
    }
  }, 300000);

  it('QT-04 物理一致性：七档第一发命中的战斗时刻逐档相同（只有伤害进数据，物理零漂移）', () => {
    const firstAts: number[] = [];
    for (const q of QUALITY_TIERS_CORE) {
      const r = realBattle(playerDraftQ(q));
      const h = r.hits['cannon'];
      expect(h, `${q} 场必须有命中`).toBeDefined();
      expect(r.result, `${q} 场必须打完`).not.toBeNull();
      firstAts.push(h!.firstAtMs);
    }
    for (let i = 1; i < firstAts.length; i++) {
      expect(firstAts[i], `第 ${i + 1} 档第一发时刻必须与第 1 档相同`).toBe(firstAts[0]);
    }
  }, 300000);

  it('QT-05 品质只作用在它自己那个挂点：另一件武器读数不变（真实装配逐件对拍）', () => {
    const mk = (q: QualityTierId | null): BuildDraft => {
      const base = playerDraftQ(q);
      return { ...base, functionalSelections: { ...base.functionalSelections, top: 'hammer' } };
    };
    const rWhite = realBattle(mk('white'));
    const rRed = realBattle(mk('red'));
    const w1 = rWhite.weapons.map((w) => `${w.defId}@${w.hardpointId}:${w.damage}`);
    const w2 = rRed.weapons.map((w) => `${w.defId}@${w.hardpointId}:${w.damage}`);
    expect(w1.length, '本场必须不止一件武器').toBeGreaterThan(1);
    for (let i = 0; i < w1.length; i++) {
      if (w1[i]!.startsWith('cannon@')) {
        expect(w2[i], '主武器红品质 = 80×2.25').toBe('cannon@frontMass:180');
      } else {
        expect(w2[i], `${w1[i]} 不该被主武器品质影响`).toBe(w1[i]);
      }
    }
    // 锤子若真的命中过，真实扣血必须两场相同
    for (const [partId, h] of Object.entries(rWhite.hits)) {
      if (partId === 'cannon') continue;
      const h2 = rRed.hits[partId];
      expect(h2, `${partId} 在红品质场也该有同样的命中`).toBeDefined();
      expect(h2!.damages[0], `${partId} 的真实伤害不该变`).toBe(h.damages[0]);
    }
  }, 300000);
});

/* ======================================================================
   C. 旧基线冻结 + 快照形状
   ====================================================================== */

describe('QT｜C. 旧基线冻结与快照形状', () => {
  it('QT-06 旧 ★1..★5 无 quality：解析读数与改前口径逐字一致（80/100/120/140/160）', () => {
    const base = defaultPlayerDraft();
    for (let star = 1; star <= 5; star++) {
      const d: BuildDraft = {
        ...base,
        functionalSelections: { ...base.functionalSelections },
        functionalStars: { [WEAPON_SLOT]: star },
      };
      const rs = resolvedOf(d);
      const w = rs.functionals.find((f) => f.install.hardpointId === WEAPON_SLOT)!;
      expect(weaponMainDamage(w.def), `★${star} 无品质`).toBe(starTierDamage(80, star));
    }
  });

  it('QT-07 snapshot 形状：white 不写字段；非 white 写 quality；resolve 后 def 已含倍率', () => {
    // white ⇒ 不写字段（与 star>1 才写 star 的既有先例同构）
    const snapW = buildSnapshotFromDraft(playerDraftQ('white'), registry, 'qt-shape');
    const fw = snapW.functionals.find((f) => f.hardpointId === WEAPON_SLOT)! as unknown as Record<string, unknown>;
    expect(fw['quality'], 'white 不写 quality 字段').toBeUndefined();
    // purple ⇒ 写 quality；resolve 后 def 伤害 = 140
    const snapP = buildSnapshotFromDraft(playerDraftQ('purple'), registry, 'qt-shape');
    const fp = snapP.functionals.find((f) => f.hardpointId === WEAPON_SLOT)! as unknown as Record<string, unknown>;
    expect(fp['quality']).toBe('purple');
    const rs = resolveSnapshot(snapP as BuildSnapshot, registry);
    const w = rs.functionals.find((f) => f.install.hardpointId === WEAPON_SLOT)!;
    expect(weaponMainDamage(w.def)).toBe(140);
    // registry 单例零污染
    expect(weaponMainDamage(registry.functionals.get('cannon')!)).toBe(80);
  });

  it('QT-08 Gadget 通道数值惰性：thruster 带 quality 也不产生假强度（无伤害键可放大）', () => {
    const thruster = registry.functionals.get('thruster')!;
    expect(weaponMainDamage(thruster), 'Gadget 基线主伤 = 0').toBe(0);
    const resolved = applyInstallTier(thruster, undefined, 'chrome');
    expect(weaponMainDamage(resolved)).toBe(0);
    // 全部数值参数逐字不变（品质对 Gadget 无伤害通道可作用）
    expect(weaponNumericParams(resolved)).toEqual(weaponNumericParams(thruster));
  });
});
