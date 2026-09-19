/**
 * PRODUCT-LOOP-R2-C-STAR-POWER-END-TO-END｜星级 → **真实战斗伤害** 的 targeted 测试。
 *
 * 本文件要回答的问题只有一个：**星级是不是真的改变了下一局战斗**，以及
 * 「改变了多少」是否只有**一个**变量（武器伤害）。
 *
 * 覆盖：
 *  A｜曲线（SP-01..SP-04）：★1..★5 = 1.00 / 1.25 / 1.50 / 1.75 / 2.00，越界夹紧；
 *    三件奖励武器（炮 / 刺 / 锤）的伤害表；**只有** damage 类键被改；
 *    「卡片上写的数」与「战斗里读的字段」是同一个函数算的（口径同源）。
 *  B｜不复制正式定义（SP-05）：★2 不产生 `cannon_star2`，正式 content 单例一字未改，
 *    `applyStarTier` 对 ★2 返回的是新对象（不改原 def 引用）。
 *  C｜层级顺序（SP-06）：永久装备 → 永久星级 → Run-local Modifier，
 *    三者各自只改自己那几个数（跑真实 `createRunRegistry` + `applyRunModifiersToSnapshot`）。
 *  D｜**真实战斗**（SP-07..SP-09）：同一门炮在两个只有星级不同的 Build 下，
 *    真实 `damage` 事件的扣血量 ★2 > ★1（且恰好 ×1.25）；同一门炮每一发同重；
 *    星级只作用在它自己那个挂点上（另一件武器的伤害不动）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registry } from '../src/core/content';
import {
  STAR_DAMAGE_MAX_STAR,
  STAR_DAMAGE_STEP,
  applyStarTier,
  resolveSnapshot,
  starDamageMultiplier,
  starTierDamage,
  starTierEnergy,
  weaponMainDamage,
  weaponNumericParams,
} from '../src/core/buildSnapshot';
import { validateSnapshot } from '../src/core/buildValidator';
import { addPart, defaultInventory, INVENTORY_MAX_STAR } from '../src/core/partInventory';
import { buildSnapshotFromDraft, EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
import {
  defaultPlayerDraft,
  weaponDefs,
  weaponEntries,
  WEAPON_SLOT,
  DAMAGE_LABEL,
} from '../src/product/playerLoadout';
import {
  applyRunModifiersToSnapshot,
  createRunRegistry,
} from '../src/lab/portraitBattleLab/runModifiers';
import { RunBattleRuntime } from '../src/lab/portraitBattleLab/runBattleRuntime';
import type { ContentRegistry, FunctionalPartDef } from '../src/core/types';

/** Queue 必改 5 的三件奖励武器（与 `runReward.REWARD_CHOICE_IDS` 同值）。 */
const REWARD_WEAPONS = ['cannon', 'spear', 'hammer'] as const;

/** 逐星伤害倍率表（Queue 必改 1 的逐字落地）。 */
const EXPECTED_MULT = [1, 1.25, 1.5, 1.75, 2];

/** 内存版 localStorage（node 无原生；与 R2-A / R2-B 测试同一模式）。 */
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  get length(): number {
    return this.m.size;
  }
}

let prevStorage: unknown;

beforeEach(() => {
  prevStorage = (globalThis as Record<string, unknown>)['localStorage'];
  (globalThis as Record<string, unknown>)['localStorage'] = new MemStorage();
});

afterEach(() => {
  (globalThis as Record<string, unknown>)['localStorage'] = prevStorage;
});

/* ============================================================================
   夹具
   ============================================================================ */

/** 产品侧真实默认车（`defaultPlayerDraft`），可选地给主武器槽指定星级。 */
function playerDraft(weaponStar = 1, weaponDefId: string | null = null): BuildDraft {
  const base = defaultPlayerDraft();
  const out: BuildDraft = {
    ...base,
    functionalSelections: { ...base.functionalSelections },
  };
  if (weaponDefId) out.functionalSelections[WEAPON_SLOT] = weaponDefId;
  if (weaponStar > 1) out.functionalStars = { ...(out.functionalStars ?? {}), [WEAPON_SLOT]: weaponStar };
  else delete out.functionalStars;
  return out;
}

/** 把一份 draft 过正式链路（`buildSnapshotFromDraft` → `validateSnapshot` → `resolveSnapshot`）。 */
function resolvedOf(draft: BuildDraft, reg: ContentRegistry = registry) {
  const snap = buildSnapshotFromDraft(draft, reg, 'sp-r2c');
  const v = validateSnapshot(snap, reg);
  expect(v.valid, `夹具必须合法：${v.errors.join('；')}`).toBe(true);
  return resolveSnapshot(snap, reg);
}

/**
 * 跑一场**真实** Planck 战斗，回到终局（或步数上限），收集真实命中记录。
 * ⚠️ 与 `portraitRunPage` 用的是同一条正式链路（`RunBattleRuntime` + 正式 Encounter）。
 */
function realBattle(draft: BuildDraft, encounterId = 'ProtoRusher') {
  const rt = new RunBattleRuntime({
    encounterId,
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
      steps,
      result: rt.result,
      hp: rt.hp(),
      weapons: rt.playerWeapons(),
      hits: rt.playerWeaponHitSummary(),
      timeMs: rt.timeMs,
    };
  } finally {
    rt.dispose();
  }
}

/* ============================================================================
   A. 曲线（必改 1）
   ============================================================================ */

describe('PRODUCT-LOOP-R2-C｜A. 星级伤害曲线（★1..★5）', () => {
  it('SP-01 逐星倍率 = 1 + 0.25 × (star − 1)；★1/缺省/非数 恒等，越界夹进 1..5', () => {
    for (let star = 1; star <= 5; star++) {
      expect(starDamageMultiplier(star), `★${star}`).toBeCloseTo(EXPECTED_MULT[star - 1], 10);
      expect(starDamageMultiplier(star)).toBeCloseTo(1 + STAR_DAMAGE_STEP * (star - 1), 10);
    }
    // 恒等侧
    for (const s of [undefined, 0, -1, -100, Number.NaN]) {
      expect(starDamageMultiplier(s as number | undefined), `star=${String(s)}`).toBe(1);
    }
    // 越界**夹**（不抛、不 NaN、不产生没定义过的倍率）
    expect(starDamageMultiplier(6)).toBe(2);
    expect(starDamageMultiplier(99)).toBe(2);
    expect(starDamageMultiplier(2.9), '小数向下取整 → ★2').toBeCloseTo(1.25, 10);
    // ★1 上界：曲线只定义到 ★5，且它必须等于库存数据模型的档数上界
    expect(STAR_DAMAGE_MAX_STAR).toBe(5);
    expect(STAR_DAMAGE_MAX_STAR).toBe(INVENTORY_MAX_STAR);
  });

  it('SP-02 三件奖励武器 ★1..★5 的**真实伤害表**（取整口径写死在断言里）', () => {
    /*
      炮 80 / 锤 90 / 刺 60 —— 这三个基准值来自正式 content，本 Queue 一字未改。
      ⚠️ 断言按 `Math.round(base × mult)` **现算**而不是抄一串数字：
         抄数字的话，改曲线时测试会「跟着变绿」，而现算会立刻红。
    */
    const BASE: Record<string, number> = { cannon: 80, hammer: 90, spear: 60 };
    expect(Object.keys(BASE).sort()).toEqual([...REWARD_WEAPONS].sort());
    for (const defId of REWARD_WEAPONS) {
      const base = BASE[defId];
      const def = registry.functionals.get(defId)!;
      expect(weaponMainDamage(def), `${defId} 的基准伤害与正式定义同源`).toBe(base);
      for (let star = 1; star <= 5; star++) {
        const d = starTierDamage(base, star);
        expect(d, `${defId} ★${star}`).toBe(Math.round(base * EXPECTED_MULT[star - 1]));
        // 逐星**严格递增**（★3 必须强于 ★2 —— 这正是 Q22 的固定倍率做不到的事）
        if (star > 1) expect(d).toBeGreaterThan(starTierDamage(base, star - 1));
      }
    }
    // 炮的具体数字（产品卡面上会写出来的那几对）
    expect(starTierDamage(80, 1)).toBe(80);
    expect(starTierDamage(80, 2)).toBe(100);
    expect(starTierDamage(80, 5)).toBe(160);
  });

  it('SP-03 星级**只**改伤害类数值：正式每一件武器的其余参数逐字不变（★2..★5）', () => {
    /*
      这是 Queue 必改 1 的机器形式：cooldown / projectile mass / radius / recoil / range
      / movement / HP 一个都不许动。断言对**正式 registry 里全部武器**成立（不是只对炮）。
      ⚠️ 「伤害类」= 顶层数值键里名字含 damage 的那些 —— 这正是 `applyStarTier` 的作用面，
         **嵌套**的伤害（`saw.hitPolicy.damage`）不在其中，由 SP-03b 单独钉死。
    */
    const weapons = weaponDefs();
    expect(weapons.length, '正式武器不能是空集（否则本用例空转）').toBeGreaterThanOrEqual(3);
    const scaled: string[] = [];
    const notScaled: string[] = [];
    for (const def of weapons) {
      const before = weaponNumericParams(def);
      const dmgKeys = Object.keys(before).filter((k) => /damage/i.test(k));
      if (dmgKeys.length === 0) {
        notScaled.push(def.id);
      } else {
        scaled.push(def.id);
      }
      for (let star = 2; star <= 5; star++) {
        const after = weaponNumericParams(applyStarTier(def, star));
        for (const k of Object.keys(before)) {
          if (/damage/i.test(k)) continue; // 伤害类：唯一允许变的
          expect(after[k], `${def.id} 的 ${k} 在 ★${star} 下必须逐字不变`).toBe(before[k]);
        }
        for (const k of dmgKeys) {
          expect(after[k], `${def.id} 的 ${k} 在 ★${star} 下必须被放大`).toBe(
            Math.round(before[k] * EXPECTED_MULT[star - 1]),
          );
        }
        // 质量 / 几何 / 能量：`applyStarTier` 只合并 energy 与 behaviorParams
        expect(applyStarTier(def, star).collider, `${def.id} 的 collider 不许被星级改`).toBe(def.collider);
        expect(applyStarTier(def, star).mass, `${def.id} 的 mass 不许被星级改`).toBe(def.mass);
        expect(applyStarTier(def, star).energy, `${def.id} 的能量按能量倍率走`).toBe(
          starTierEnergy(def.energy, star),
        );
      }
    }
    /*
      ⚠️ **作用面边界（机器钉死）**：正式 10 件武器里恰好只有 `saw` 的伤害没写在顶层
      （它走 contactTick 的 `hitPolicy.damage`，嵌套一层 ⇒ 倍率层看不见）。
      把这条边界写成断言而不是注释：将来若有人再添一件「伤害藏在嵌套里」的武器，
      或者把 saw 的伤害改成顶层，这里会立刻红 —— 那时才需要决定它要不要进成长链。
    */
    expect(notScaled, '星级伤害的作用面边界：只有 saw 不在其中').toEqual(['saw']);
    expect(scaled.length).toBe(9);
    expect(scaled).not.toContain('saw');
    // 玩家**能成长**的三件必须全在作用面内（否则 Queue 的核心目标不成立）
    for (const id of REWARD_WEAPONS) expect(scaled, `${id} 必须在星级作用面内`).toContain(id);
  });

  it('SP-03b `saw` 的边界：主伤读取为 0、卡片不给数字，且星级**不**碰它的嵌套伤害', () => {
    const saw = registry.functionals.get('saw')!;
    // 主伤口径：顶层没有 → 0（不知道就不编）
    expect(weaponMainDamage(saw)).toBe(0);
    // 星级层对它是零作用（嵌套值原样保留 —— 不静默、不半生效）
    for (let star = 2; star <= 5; star++) {
      const after = applyStarTier(saw, star) as FunctionalPartDef;
      expect(weaponNumericParams(after)).toEqual(weaponNumericParams(saw));
      expect(after.behaviorParams?.['hitPolicy'], '嵌套伤害原样透传').toEqual(
        saw.behaviorParams?.['hitPolicy'],
      );
    }
    // 产品侧：即便玩家莫名拥有 saw，卡片也**不会**写「攻击 0」（damageText 为空串）
    // ⚠️ 当前产品结构上不可能拥有它（不在 STARTER_PARTS、不在奖励池）—— 这条只是把
    //    「不可达分支」也钉住，避免将来它变成可达时悄悄印出一个假数字。
    const inv = defaultInventory();
    addPart(inv, 'saw', 1, 1);
    const entry = weaponEntries(inv).find((w) => w.defId === 'saw')!;
    expect(entry.damage).toBe(0);
    expect(entry.damageNext).toBeNull();
    expect(entry.damageText, '没有可读主伤 ⇒ 不给数字（不是 `攻击 0 → 0`）').toBe('');
    // 同一份库存里三件奖励武器照常有数字（不是整体降级）
    expect(weaponEntries(inv).find((w) => w.defId === 'cannon')!.damageText).toBe('攻击 80 → 100');
  });

  it('SP-04 口径同源：`weaponMainDamage` 就是战斗结算读的那个字段，且与星级层可交换', () => {
    /*
      `weaponMainDamage` 的取值顺序（先 `projectileDamage` 后 `baseDamage`）必须与
      `src/battle/contactRouter.ts` 的两个伤害分支一一对应，否则「卡片上的数」
      与「打出来的数」会分叉。这里对三件奖励武器逐星钉死「先缩后读 == 先读后缩」。
      弹丸类与直击类各取一件，保证两个分支都被覆盖。
    */
    const projectileLike = registry.functionals.get('cannon')!;
    const directLike = [registry.functionals.get('hammer')!, registry.functionals.get('spear')!];
    expect((projectileLike.behaviorParams as Record<string, number>)['projectileDamage'], '炮 = 弹丸类').toBe(80);
    for (const d of directLike) {
      expect(
        (d.behaviorParams as Record<string, number>)['baseDamage'],
        `${d.id} = 车身直击类（走 baseDamage，不是 projectileDamage）`,
      ).toBe(weaponMainDamage(d));
      expect(d.behaviorParams?.['projectileDamage'], `${d.id} 不该同时声明 projectileDamage`).toBeUndefined();
    }
    for (const def of [projectileLike, ...directLike]) {
      const base = weaponMainDamage(def);
      for (let star = 1; star <= 5; star++) {
        expect(
          weaponMainDamage(applyStarTier(def, star)),
          `${def.id} ★${star}：先缩后读必须等于先读后缩`,
        ).toBe(starTierDamage(base, star));
      }
    }
    // 没有任何伤害字段的件 → 0（读不出数就不编）
    const gadget: FunctionalPartDef = {
      ...projectileLike,
      id: 'not-a-real-weapon',
      behaviorParams: { pushForce: 10 },
    };
    expect(weaponMainDamage(gadget)).toBe(0);
  });
});

/* ============================================================================
   B. 不复制正式定义（必改 3）
   ============================================================================ */

describe('PRODUCT-LOOP-R2-C｜B. 星级通过 overlay 注入，不为 ★2 造定义（必改 3）', () => {
  it('SP-05 ★2 经正式链路解析后：正式 content 单例一字未改，registry 也没多出任何键', () => {
    const officialCannon = registry.functionals.get('cannon')!;
    const officialKeys = [...registry.functionals.keys()].sort();
    const before = weaponNumericParams(officialCannon);

    const rs = resolvedOf(playerDraft(2));
    const starCannon = rs.functionals.find((f) => f.install.hardpointId === WEAPON_SLOT)!;
    expect(starCannon.def.id, '★2 仍然是那件正式武器，不是 cannon_star2').toBe('cannon');
    expect(starCannon.install.star).toBe(2);
    expect(weaponMainDamage(starCannon.def)).toBe(100);
    // 非伤害参数逐字不变 ⇒ 「同一件武器，只是打得更重」
    const after = weaponNumericParams(starCannon.def);
    for (const k of Object.keys(before)) {
      if (/damage/i.test(k)) continue;
      expect(after[k]).toBe(before[k]);
    }
    // 正式单例：定义对象本身与被它派生的数值都没被写坏
    expect(weaponNumericParams(registry.functionals.get('cannon')!)).toEqual(before);
    expect([...registry.functionals.keys()].sort(), '正式 registry 不许新增键（无 cannon_star2）').toEqual(
      officialKeys,
    );
    expect(officialKeys).not.toContain('cannon_star2');
    expect(registry.functionals.get('cannon')).toBe(officialCannon);
    // 引用语义：★1 恒等返回**同一个对象**（零 clone）；★2 返回新的副本（不改原 def）
    expect(applyStarTier(officialCannon, 1)).toBe(officialCannon);
    expect(applyStarTier(officialCannon, undefined)).toBe(officialCannon);
    expect(applyStarTier(officialCannon, 2)).not.toBe(officialCannon);
    expect(starCannon.def).not.toBe(officialCannon);
  });
});

/* ============================================================================
   C. 层级顺序（必改 2）：永久装备 → 永久星级 → Run-local
   ============================================================================ */

describe('PRODUCT-LOOP-R2-C｜C. 层级顺序：永久装备 → 永久星级 → Run-local Modifier', () => {
  it('SP-06 heavyShell（Run-local）与 ★2（永久）各自只改自己那几个数，合成后逐项可对账', () => {
    const runReg = createRunRegistry(['heavyShell']);
    // overlay 部件 = 本局 registry 里多出来的那个键（正式 cannon 键仍在）
    const overlayKeys = [...runReg.functionals.keys()].filter((k) => !registry.functionals.has(k));
    expect(overlayKeys.length, 'heavyShell 必须真的造出一个本局 overlay 部件').toBe(1);
    const overlayId = overlayKeys[0];
    expect(runReg.functionals.get('cannon'), '正式 cannon 在副本里保持原值').toBe(registry.functionals.get('cannon'));

    const planDraft = playerDraft(2);
    const planSnap = buildSnapshotFromDraft(planDraft, registry, 'sp-r2c-run');
    const modified = applyRunModifiersToSnapshot(planSnap, ['heavyShell']);
    // overlay 只动 defId：挂点与**星级**原样
    const install = modified.functionals.find((f) => f.hardpointId === WEAPON_SLOT)!;
    expect(install.defId, '武器 defId 被重映射到本局 overlay').toBe(overlayId);
    expect(install.star, '星级被原样保留（Run-local 不许吃掉永久星级）').toBe(2);

    expect(validateSnapshot(modified, runReg).valid).toBe(true);
    const rs = resolveSnapshot(modified, runReg);
    const w = rs.functionals.find((f) => f.install.hardpointId === WEAPON_SLOT)!;
    const p = weaponNumericParams(w.def);
    // ① 永久星级：伤害 = 官方基准 × ★2 曲线（overlay 不改伤害 ⇒ 两种顺序同值）
    expect(p['projectileDamage']).toBe(starTierDamage(80, 2));
    expect(p['projectileDamage']).toBe(100);
    // ② Run-local：heavyShell 的三个数**原样**到达（没有被星级二次缩放）
    expect(p['projectileRadius']).toBe(16);
    expect(p['projectileMass']).toBe(4);
    expect(p['recoilImpulse']).toBe(90);
    // ③ 两者都不碰的数：开火节奏
    expect(p['cooldownMs']).toBe(1000);
    expect(p['muzzleSpeed']).toBe(8);
    // ④ 正式单例与正式 cannon 依旧零改动（本轮只在内存副本里生效）
    expect(weaponNumericParams(registry.functionals.get('cannon')!)['projectileDamage']).toBe(80);
  });
});

/* ============================================================================
   D. 真实战斗（Queue 必改 5 的核心）
   ============================================================================ */

describe('PRODUCT-LOOP-R2-C｜D. 真实战斗里 ★2 真的打得更重（不是 UI 数字）', () => {
  it('SP-07 同一门炮、只有星级不同：真实命中扣血 ★1 = 80 / ★2 = 100（恰好 ×1.25）', () => {
    const r1 = realBattle(playerDraft(1));
    const r2 = realBattle(playerDraft(2));

    // 前置：两场都必须真的分出胜负、并且玩家那门炮真的打中过（否则断言是空转）
    expect(r1.result, '★1 那场必须打完').not.toBeNull();
    expect(r2.result, '★2 那场必须打完').not.toBeNull();

    const h1 = r1.hits['cannon'];
    const h2 = r2.hits['cannon'];
    expect(h1, '★1 场必须有真实炮击命中记录').toBeDefined();
    expect(h2, '★2 场必须有真实炮击命中记录').toBeDefined();
    expect(h1.count).toBeGreaterThan(0);

    // ① Queue 必改 1 的基准值（正式 cannon = 80，本 Queue 未改内容）
    expect(h1.damages[0], '★1 炮第一发真实扣血').toBe(80);
    expect(h2.damages[0], '★2 炮第一发真实扣血').toBe(100);
    expect(h2.damages[0] > h1.damages[0], '★2 必须真的更重').toBe(true);
    expect(h2.damages[0], '同条件单次伤害 = ★1 × 1.25').toBe(Math.round(h1.damages[0] * 1.25));

    // ② 「同条件」的机器证据：**第一发命中发生的时刻必须完全相同**
    //    （在第一次命中之前，两场的物理逐帧相同：星级只改了伤害与能量，两者都不进物理）
    expect(h2.firstAtMs, '第一发命中的战斗时刻必须与 ★1 场相同').toBe(h1.firstAtMs);

    // ③ 同一门炮每一发都同重（不是被平均掉、也不是只有第一发生效）
    for (const [i, d] of h1.damages.entries()) expect(d, `★1 第 ${i + 1} 发`).toBe(80);
    for (const [i, d] of h2.damages.entries()) expect(d, `★2 第 ${i + 1} 发`).toBe(100);
  }, 120000);

  it('SP-08 星级作用在**真实装配**上：`playerWeapons()` 报的 star / damage 与 Build 同源', () => {
    for (const star of [1, 2]) {
      const rt = new RunBattleRuntime({ encounterId: 'ProtoRusher', playerDraft: playerDraft(star) });
      try {
        const main = rt.playerWeapons().find((w) => w.hardpointId === WEAPON_SLOT)!;
        expect(main.defId).toBe('cannon');
        expect(main.star, '战斗运行时的武器星级').toBe(star);
        expect(main.damage, '战斗里真实会用的伤害').toBe(starTierDamage(80, star));
        // 与正式链路解析出来的数一致（不是另算一份）
        expect(main.damage).toBe(weaponMainDamage(resolvedOf(playerDraft(star)).functionals.find(
          (f) => f.install.hardpointId === WEAPON_SLOT,
        )!.def));
      } finally {
        rt.dispose();
      }
    }
  }, 60000);

  it('SP-09 星级只作用在它自己那个挂点上：另一件武器的伤害两场完全相同', () => {
    const r1 = realBattle(playerDraft(1));
    const r2 = realBattle(playerDraft(2));
    const taken1 = r1.weapons.map((w) => `${w.defId}@${w.hardpointId}★${w.star}:${w.damage}`);
    const taken2 = r2.weapons.map((w) => `${w.defId}@${w.hardpointId}★${w.star}:${w.damage}`);
    expect(taken1.length, '本场不止一件武器（否则「只影响一件」无法被证伪）').toBeGreaterThan(1);
    // 逐件比对：只有主武器那一件的 ★/伤害不同，其余逐字相同
    for (let i = 0; i < taken1.length; i++) {
      const a = taken1[i];
      const b = taken2[i];
      if (a.startsWith('cannon@' + WEAPON_SLOT)) {
        expect(a).toBe(`cannon@${WEAPON_SLOT}★1:80`);
        expect(b).toBe(`cannon@${WEAPON_SLOT}★2:100`);
      } else {
        expect(b, `${a.split(':')[0]} 不该被主武器升星影响`).toBe(a);
      }
    }
    // 若另一件武器也命中过，它的真实伤害也必须两场相同（伤害来源自洽）
    for (const [partId, h] of Object.entries(r1.hits)) {
      if (partId === 'cannon') continue;
      const h2 = r2.hits[partId];
      expect(h2, `${partId} 在 ★2 场也该有同样的命中`).toBeDefined();
      expect(h2!.damages[0], `${partId} 的真实伤害不该变`).toBe(h.damages[0]);
    }
  }, 120000);

  it('SP-10 卡面文案与战斗同源：`攻击 80 → 100` 的两个数就是上面实测的那两个', () => {
    expect(DAMAGE_LABEL).toBe('攻击');
    // 卡片读数走产品侧真实入口（`weaponEntries`），不是在这里手拼字符串
    const inv = defaultInventory();
    // starter 本来就给 1 件 ★1 炮 ⇒ 再加 3 件 = 4（**差一件**没满）
    addPart(inv, 'cannon', 1, 3);
    const c1 = weaponEntries(inv).find((w) => w.defId === 'cannon' && w.star === 1)!;
    expect(c1.damageText, '★1 卡：升星会得到什么，写在同一行里').toBe('攻击 80 → 100');
    expect(c1.damage).toBe(80);
    expect(c1.damageNext).toBe(100);
    expect(c1.fusable, '还没满 5 件 ⇒ 不能合').toBe(false);
    // ⚠️ 即便还没凑满 5 件也要给下一星的值（Queue 必改 4「按下合成**前**就知道」）
    expect(c1.count).toBeLessThan(c1.threshold);
    expect(c1.damageText).toContain('→');

    // ★2 卡：下一星是 ★3
    addPart(inv, 'cannon', 2, 1);
    const c2 = weaponEntries(inv).find((w) => w.defId === 'cannon' && w.star === 2)!;
    expect(c2.damageText).toBe('攻击 100 → 120');
    // ★5 卡：没有下一星 ⇒ 不画箭头
    addPart(inv, 'hammer', 5, 1);
    const h5 = weaponEntries(inv).find((w) => w.defId === 'hammer' && w.star === 5)!;
    expect(h5.maxStar).toBe(true);
    expect(h5.damageNext).toBeNull();
    expect(h5.damageText).toBe('攻击 180');
    expect(h5.damageText).not.toContain('→');
    // 空槽常量仍在（`EMPTY_SLOT` 是「这个挂点没装东西」的唯一判据）
    expect(typeof EMPTY_SLOT).toBe('string');
  });
});
