/**
 * PRODUCT-LOOP-R11-WEAPON-BALANCE-BATCH-GATE｜R11 批次技术收口守卫（test-only，不改 src）。
 *
 * ── 本文件存在的理由 ───────────────────────────────────────────────────────
 *
 * R11 是**三条单变量**。本文件断言的是它们的**终态**：
 *
 *   | 轮次 | 武器 | 唯一改动的键 | 终态 |
 *   |---|---|---|---|
 *   | `de9be13` R11-HAMMER-REACH | hammer | （reach 类） | **未落地**（负结果，零参数改动） |
 *   | `a046e92` R11-LASER-CADENCE | laser | `cooldownMs` | 1800 → **600**（保留） |
 *   | `9f59ec7` R11-RAMMER-REST   | rammer | `restSteps` | 24 → 12 → **24（已回退）** |
 *
 * ⚠️ **PRODUCT-LOOP-R11-RAMMER-REST-ROLLBACK**：rammer 的单变量假设**失败**（唯一 COMPLETE
 *    chassis 仍为 0，且把既有 `walk` 族 COMPLETE 由 6 条压到 4 条 ⇒ 真实路线退化）⇒ 整块回退
 *    （连同原 `productRunRammerRestR11` 取证文件一并撤销）。⇒ 本批次**最终落地的差异只剩 1 条**：
 *    `laser.cooldownMs`；hammer（负结果）与 rammer（已回退）都回到 R10 基线。
 *
 * 专属守卫：`productRunHammerReachProbeR11` / `productRunLaserCadenceR11`。而**「批次级」的两个
 * 契约没有别的机械守卫**：
 *
 *   ① **「只改一个变量」的字面证明** —— 断言激光的**其余每一个字段**（含键集）都等于 R10 基线；
 *   ② **「其它 6 件武器零退化」** —— 断言 `cannon / flamethrower / hammer / machineGun / rammer /
 *      shotgun` 的 `mass / energy / collider / behaviorParams` **逐字段逐值**等于 R10 基线。
 *
 * 在这份守卫之前，②只有「`git diff` 只显示 2 行改动」这种**一次性人工取证**；人一多、窗口一换
 * 就失效。本文件把它变成**每次全量 vitest 都会跑的机器断言**。
 *
 * ── 快照怎么来的 ───────────────────────────────────────────────────────────
 * `R10_BASELINE` = `1f3df13`（R10 收口点，R11 三条单变量全部尚未落地）时的 canonical 值。
 * `R11_DELTA` = 本批次**最终**允许的全部差异（回退后恰好 1 条：`laser.cooldownMs`）。
 * ⇒ 断言形态 `实际 == (基线 ⊕ 白名单)`：任何**未被白名单允许**的新差异（哪怕只差 1）都会红。
 *
 * ⚠️ 本文件**不写任何战斗读数**（那是各轮专属守卫的事）；读的全是正式 `registry` canonical 与
 *    正式 `content.ts` 源码结构。也不改 `src/**`。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { OFFICIAL_PARTS } from '../src/core/partInventory';
import { FULL_RUN_SUPPORTED_WEAPON_IDS } from '../src/product/runCompatibility';

/** 一件武器的完整可比快照（键集 + 值）。 */
interface WeaponSnap {
  readonly mass: number;
  readonly energy: number;
  readonly collider: unknown;
  readonly bp: Record<string, unknown>;
}

/**
 * **R10 基线快照**（`1f3df13`：三条单变量落地**之前**的 canonical）。
 * ⚠️ 这里写下的就是「不能退化」的那一组值 —— 改任何一个都要先改本表并说明理由。
 */
const R10_BASELINE: Record<string, WeaponSnap> = {
  cannon: {
    mass: 20,
    energy: 30,
    collider: { shape: 'box', width: 40, height: 20, offset: { x: 20, y: 0 } },
    bp: {
      cooldownMs: 1000,
      muzzleSpeed: 8,
      projectileDamage: 80,
      projectileRadius: 10,
      projectileMass: 1,
      recoilImpulse: 30,
    },
  },
  flamethrower: {
    mass: 22,
    energy: 30,
    collider: { shape: 'box', width: 30, height: 18, offset: { x: 15, y: 0 } },
    bp: {
      sprayMs: 1000,
      cooldownMs: 600,
      projectileIntervalMs: 33,
      flameLifetimeMs: 320,
      muzzleSpeed: 10,
      projectileDamage: 8,
      projectileRadius: 4,
      projectileMass: 0.03,
      spreadAnglesDeg: [-6, 0, 6],
    },
  },
  hammer: {
    mass: 40,
    energy: 25,
    collider: { shape: 'box', width: 60, height: 14, offset: { x: 40, y: 0 } },
    // 锤只有 baseDamage —— **没有**任何 reach 类键（这是 R11-HAMMER-REACH 负结果的结构证据）
    bp: { baseDamage: 90 },
  },
  laser: {
    mass: 20,
    energy: 45,
    collider: { shape: 'box', width: 40, height: 20, offset: { x: 20, y: 0 } },
    bp: {
      chargeMs: 1500,
      cooldownMs: 1800, // ← R11 唯一改动点（白名单里改成 600）
      muzzleSpeed: 56,
      projectileDamage: 160,
      projectileRadius: 12,
      projectileMass: 1,
      recoilImpulse: 560,
    },
  },
  machineGun: {
    mass: 20,
    energy: 30,
    collider: { shape: 'box', width: 40, height: 16, offset: { x: 20, y: 0 } },
    bp: {
      burstRounds: 7,
      roundIntervalMs: 100,
      cooldownMs: 1100,
      muzzleSpeed: 12,
      projectileDamage: 20,
      projectileRadius: 5,
      projectileMass: 0.1,
      recoilImpulse: 6,
    },
  },
  rammer: {
    mass: 25,
    energy: 25,
    collider: { shape: 'box', width: 30, height: 22, offset: { x: 15, y: 0 } },
    bp: {
      extendPx: 160,
      strikeSpeedPxPerStep: 20,
      retractSpeedPxPerStep: 3,
      restSteps: 24, // ← R11-RAMMER-REST 曾改成 12；ROLLBACK 已还原 ⇒ 不在白名单里（必须仍是 24）
      holdSteps: 8,
      maxForceN: 1200,
      baseDamage: 70,
    },
  },
  shotgun: {
    mass: 25,
    energy: 30,
    collider: { shape: 'box', width: 46, height: 22, offset: { x: 23, y: 0 } },
    bp: {
      cooldownMs: 1300,
      muzzleSpeed: 13,
      projectileDamage: 30,
      projectileRadius: 7,
      projectileMass: 1,
      recoilImpulse: 160,
      fanAnglesDeg: [-12, -6, 0, 6, 12],
    },
  },
};

/**
 * **本批次最终允许的全部差异**（回退后恰好 1 条）。
 * ⚠️ 这个表就是「只允许调整一个变量」的机器表达：表外的任何字段变化都会让 BG-01/BG-05 变红。
 * ⚠️ R11-RAMMER-REST-ROLLBACK 之后 `rammer` **必须不在**表内 —— 它的 canonical 等于 R10 基线。
 */
const R11_DELTA: Record<string, { readonly field: string; readonly before: number; readonly after: number; readonly reason: string }> = {
  laser: {
    field: 'cooldownMs',
    before: 1800,
    after: 600,
    reason: '攻击周期 = chargeMs + cooldownMs = 3300ms ⇒ ~1000 步战斗只装得下 5 发；缩短冷却让激光装得下足够多的射击（前摇不动）。',
  },
};

const FULL_RUN_WEAPONS = ['cannon', 'flamethrower', 'hammer', 'laser', 'machineGun', 'rammer', 'shotgun'] as const;

/** 读正式 registry 的武器快照。 */
function snapOf(defId: string): WeaponSnap {
  const def = registry.functionals.get(defId);
  if (!def) throw new Error(`缺少正式 weapon def：${defId}`);
  return {
    mass: def.mass,
    energy: def.energy,
    collider: def.collider,
    bp: { ...(def.behaviorParams as Record<string, unknown>) },
  };
}

/** 期望值 = 基线 ⊕ 白名单。 */
function expectedOf(defId: string): WeaponSnap {
  const base = R10_BASELINE[defId];
  if (!base) throw new Error(`快照表没有 ${defId}`);
  const delta = R11_DELTA[defId];
  const bp: Record<string, unknown> = { ...base.bp };
  if (delta) {
    expect(bp[delta.field], `${defId}.${delta.field} 的基线值必须与快照表一致`).toBe(delta.before);
    bp[delta.field] = delta.after;
  }
  return { mass: base.mass, energy: base.energy, collider: base.collider, bp };
}

/** 剥注释后的 `content.ts` 源码（写源码守卫前必须剥 —— 注释里也有这些键名）。 */
function strippedContentSource(): string {
  const src = readFileSync(join(__dirname, '..', 'src', 'core', 'content.ts'), 'utf8');
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * 取 `const <name>: FunctionalPartDef = { … }` 这一段。
 * ⚠️ 必须找**下一个顶层声明**（`\nconst `）来收尾 —— 直接搜 `FunctionalPartDef = {`
 *    会命中**同一行**的声明头（`const rammer: ` 之后就有一个），把块切空。
 */
function defBlock(code: string, varName: string): string {
  const start = code.indexOf(`const ${varName}: FunctionalPartDef = {`);
  expect(start, `必须能在 content.ts 里定位 ${varName} 的定义块`).toBeGreaterThan(-1);
  const next = code.indexOf('\nconst ', start + 1);
  return next === -1 ? code.slice(start) : code.slice(start, next);
}

describe('PRODUCT-LOOP-R11-WEAPON-BALANCE-BATCH-GATE｜批次技术收口', () => {
  /* ============================================================ BG-00 */
  it('BG-00｜白名单即全部差异：回退后本批次只允许 laser.cooldownMs 一个键变化', () => {
    expect(Object.keys(R11_DELTA).sort(), 'R11 批次的差异条目（增删都要显式改这里）').toEqual(['laser']);
    // 白名单必须与「三个单变量的裁决」逐条对应：
    //   hammer = 负结果 ⇒ **不在**白名单；rammer = 假设失败已整块回退 ⇒ **同样不在**白名单
    expect(Object.keys(R11_DELTA)).not.toContain('hammer');
    expect(Object.keys(R11_DELTA)).not.toContain('rammer');
    // 且白名单字段确实落在该武器的 canonical 键集里（防写错键名后守卫永真）
    for (const [defId, d] of Object.entries(R11_DELTA)) {
      const base = R10_BASELINE[defId]!;
      expect(Object.keys(base.bp), `${defId} 的基线快照必须含 ${d.field}`).toContain(d.field);
      const now = snapOf(defId).bp;
      expect(Object.keys(now), `${defId} 的当前 canonical 必须含 ${d.field}`).toContain(d.field);
      expect(now[d.field], `${defId}.${d.field} 必须已落到白名单的 after 值`).toBe(d.after);
      expect(now[d.field], `${defId}.${d.field} 必须真的与 R10 基线不同（否则本轮没落地）`).not.toBe(d.before);
    }
  });

  /* ============================================================ BG-01 */
  it('BG-01｜「只改一个变量」的字面证明：7 件放行武器的 mass/energy/collider/behaviorParams 逐字段 = 基线 ⊕ 白名单', () => {
    for (const defId of FULL_RUN_WEAPONS) {
      const got = snapOf(defId);
      const want = expectedOf(defId);
      // mass / energy：任何一件都不许动
      expect(got.mass, `${defId}.mass 退化`).toBe(want.mass);
      expect(got.energy, `${defId}.energy 退化`).toBe(want.energy);
      // collider：几何（形状 / 尺寸 / 挂点偏移）任何一件都不许动 —— 含 hammer 的 reach 几何
      expect(got.collider, `${defId}.collider 退化（几何 / reach 被改）`).toEqual(want.collider);
      // behaviorParams：**键集 + 每个值**都必须一致（键集比较能抓住「偷偷加第二个键」）
      expect(Object.keys(got.bp).sort(), `${defId}.behaviorParams 键集变了`).toEqual(
        Object.keys(want.bp).sort(),
      );
      expect(got.bp, `${defId}.behaviorParams 逐字段退化`).toEqual(want.bp);
    }
  });

  /* ============================================================ BG-02 */
  it('BG-02｜hammer：reach 类单变量**未落地**（负结果）—— canonical 里没有 reach 键，几何与基线逐字节相同', () => {
    const base = R10_BASELINE['hammer']!;
    const got = snapOf('hammer');
    expect(Object.keys(got.bp).sort(), '锤只有 baseDamage；出现 reach 类键说明有人落地了负结果').toEqual([
      'baseDamage',
    ]);
    expect(got.bp['baseDamage'], '锤的 baseDamage 不动').toBe(90);
    expect(got.collider, '锤的 collider（= 它唯一的 reach 真源）逐字节等于基线').toEqual(base.collider);
    expect(got.mass, '锤 mass 不动').toBe(40);
    expect(got.energy, '锤 energy 不动').toBe(25);

    // 源码结构守卫（剥注释）：hammer 定义块里不得出现任何 reach 字样
    const block = defBlock(strippedContentSource(), 'hammer');
    expect(/reach/i.test(block), 'hammer 定义块里不得出现 reach 键（负结果未被落地）').toBe(false);
    // 反向：整个 content.ts 里也不该有 reachPx / reachSteps 这类「可调 reach」字段
    const code = strippedContentSource();
    expect(/reachPx|reachSteps|reachFactor/.test(code), 'canonical 里不得出现 reach 类可调字段').toBe(false);
  });

  /* ============================================================ BG-03 */
  it('BG-03｜laser：只动 cooldownMs —— 前摇 / 伤害 / 速度 / 弹体 / 后坐 / 几何全部冻结', () => {
    const got = snapOf('laser').bp;
    expect(got['chargeMs'], '前摇 = 激光的可感知身份，不动').toBe(1500);
    expect(got['cooldownMs'], '落地值').toBe(600);
    expect(got['muzzleSpeed'], '速度不动').toBe(56);
    expect(got['projectileDamage'], '伤害不动').toBe(160);
    expect(got['projectileRadius'], '弹体半径不动').toBe(12);
    expect(got['projectileMass'], '弹体质量不动').toBe(1);
    expect(got['recoilImpulse'], '后坐不动').toBe(560);
    // 改动方向合理性：600 必须仍 > 0（还有冷却）且 < R10 基线（确实变快了）
    expect(got['cooldownMs']).toBeGreaterThan(0);
    expect(got['cooldownMs']).toBeLessThan(1800);
  });

  /* ============================================================ BG-04 */
  it('BG-04｜rammer：R11-RAMMER-REST 已**整块回退** —— 全部字段（含 restSteps）逐值等于 R10 基线', () => {
    const got = snapOf('rammer').bp;
    const base = R10_BASELINE['rammer']!;
    expect(got['extendPx'], '行程不动').toBe(160);
    expect(got['strikeSpeedPxPerStep'], '伸出速度不动').toBe(20);
    expect(got['holdSteps'], '到位停顿不动').toBe(8);
    expect(got['retractSpeedPxPerStep'], '回收速度不动').toBe(3);
    expect(got['maxForceN'], 'motor 力矩不动').toBe(1200);
    expect(got['baseDamage'], '伤害不动（伤害只走 ContactRouter 读 canonical baseDamage）').toBe(70);
    // ★ 回退的核心断言：restSteps 必须**回到 24**（= R10 基线值），不是 12、也不是任何其它档位
    expect(got['restSteps'], 'restSteps 必须已回退到 R10 基线 24').toBe(24);
    expect(got['restSteps'], '回退后必须与 R10 基线逐值一致').toBe(base.bp['restSteps']);
    expect(got, 'rammer 整份快照（键集 + 逐字段）必须等于 R10 基线').toEqual(base.bp);
    // 接触类武器**没有** cooldownMs —— 防止有人为「统一节奏键」给它加一个
    expect(Object.keys(got)).not.toContain('cooldownMs');
  });

  /* ============================================================ BG-05 */
  it('BG-05｜其它 4 件（cannon / flamethrower / machineGun / shotgun）：**零字段变化**（不退化）', () => {
    for (const defId of ['cannon', 'flamethrower', 'machineGun', 'shotgun'] as const) {
      const base = R10_BASELINE[defId]!;
      const got = snapOf(defId);
      // 这 4 件**不在**白名单 ⇒ 期望值 = 基线原样
      expect(Object.keys(R11_DELTA), `${defId} 不得进入差异白名单`).not.toContain(defId);
      expect(got.mass, `${defId}.mass`).toBe(base.mass);
      expect(got.energy, `${defId}.energy`).toBe(base.energy);
      expect(got.collider, `${defId}.collider`).toEqual(base.collider);
      expect(got.bp, `${defId}.behaviorParams 逐字段必须与 R10 基线完全一致`).toEqual(base.bp);
    }
  });

  /* ============================================================ BG-06 */
  it('BG-06｜放行面冻结：仍恰 7 件；spear / saw 保持 BLOCK（未修、未放行）', () => {
    expect([...FULL_RUN_SUPPORTED_WEAPON_IDS].sort()).toEqual([...FULL_RUN_WEAPONS].sort());
    expect(FULL_RUN_SUPPORTED_WEAPON_IDS).toHaveLength(7);
    for (const blocked of ['spear', 'saw']) {
      expect(FULL_RUN_SUPPORTED_WEAPON_IDS, `${blocked} 必须仍在 BLOCK`).not.toContain(blocked);
    }
    // 反向：BLOCK 的 2 件仍**存在**于正式内容库（是「不放行」而不是「被删」）
    // ⚠️ `OFFICIAL_PARTS` 是 `string[]`（不是对象数组），判存在用 `includes`。
    for (const blocked of ['spear', 'saw']) {
      expect(registry.functionals.get(blocked), `${blocked} 应仍存在于正式内容库`).toBeTruthy();
      expect(OFFICIAL_PARTS.includes(blocked), `${blocked} 应仍是正式可拥有件（未被删）`).toBe(true);
    }
  });

  /* ============================================================ BG-07 */
  it('BG-07｜源码守卫：落地键在定义块里只出现一次；rammer 已回退（24，无 12 残留）', () => {
    const code = strippedContentSource();

    // rammer：`restSteps` 仍恰 1 处，且值必须是**回退后**的 24（不是 12）
    const rammerBlock = defBlock(code, 'rammer');
    expect(
      rammerBlock.match(/restSteps\s*:/g)?.length,
      'rammer 定义块里 restSteps 恰 1 处',
    ).toBe(1);
    expect(rammerBlock.match(/restSteps\s*:\s*24\b/g)?.length, 'rammer 回退值恰 1 处').toBe(1);
    expect(rammerBlock.match(/restSteps\s*:\s*12\b/g), 'rammer 定义块里不得残留 12').toBeNull();

    const laserBlock = defBlock(code, 'laser');
    expect(laserBlock.match(/cooldownMs\s*:/g)?.length, 'laser 定义块里 cooldownMs 恰 1 处').toBe(1);
    expect(laserBlock.match(/cooldownMs\s*:\s*600\b/g)?.length, 'laser 落地值恰 1 处').toBe(1);
    expect(laserBlock.match(/chargeMs\s*:\s*1500\b/g)?.length, 'laser 前摇恰 1 处').toBe(1);

    for (const w of FULL_RUN_WEAPONS) {
      expect(code.includes(`id: '${w}'`), `${w} 应在 content.ts 里`).toBe(true);
    }
  });
});
