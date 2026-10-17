/**
 * GARAGE-V2-QUALITY-RUN-ADAPTER-R1｜**安装件品质层（γ：显式 quality 字段）**。
 *
 * ── 本模块是什么 ────────────────────────────────────────────────────────────
 *   七档品质到真实战斗的**最小、独立、可验证**桥接：
 *   倍率真源 + 不双乘语义 + 安装件统一倍率函数（`applyInstallTier`）。
 *
 *   口径（Queue 必改 2 逐字落地）：
 *     白 1.00 / 绿 1.25 / 蓝 1.50 / 紫 1.75 / 橙 2.00 / 红 2.25 / 彩 2.50
 *   —— 即旧星级曲线 `1 + 0.25 × (n − 1)` 在 n = 1..7 的自然延拓：
 *     一条公式、两段应用域。旧 star 1..5 无 quality 时读数逐字不变。
 *
 * ── 本模块不是什么（冻结边界）────────────────────────────────────────────────
 *   - **不双乘**：安装件同时带 star 与 quality 时，quality **替代** star 的伤害倍率
 *     （star 不再参与伤害）——「星级与品质重复乘」是 Queue 明令禁止的假成长。
 *     star 的**能量语义**（>1 ⇒ ×1.10）在两条路径下都保持（Queue 必改 2：
 *     「能量若提升沿旧 star>1 的 1.10 口径」）。
 *   - 不改正式 content / ContactRouter / 任何 Weapon 行为：倍率仍只作用
 *     「behaviorParams 顶层数值键名含 damage」的字段，round 后交给
 *     `contactRouter.ts:688`（baseDamage）/ `:996`（projectileDamage）读取。
 *   - 不读库存、不读账本、不写存储：本层只认 **snapshot/draft 里的显式字段**。
 *     「品质产物能不能上身」由上层（未来正式 Garage V2 装备链）负责；
 *     `equipQualityProduct` 在本轮**仍**返回 run-not-wired（garageV2Quality.ts 不动）。
 *   - Gadget 无伤害通道（thruster 等参数键名不含 damage）⇒ 品质对 Gadget
 *     **结构上可解析但数值惰性**（不制造假强度）；真实 Gadget 品质属性属独立设计决策。
 */

import type { FunctionalPartDef, QualityTierId } from './types';

/** 七档顺序（index = 品质等级；禁改——顺序即倍率即合成链）。 */
export const QUALITY_TIERS_CORE: readonly QualityTierId[] = [
  'white',
  'green',
  'blue',
  'purple',
  'orange',
  'red',
  'chrome',
];

/** 每档品质的固定伤害倍率（Queue 必改 2 的逐字表）。 */
const QUALITY_DAMAGE_MULT: Readonly<Record<QualityTierId, number>> = {
  white: 1.0,
  green: 1.25,
  blue: 1.5,
  purple: 1.75,
  orange: 2.0,
  red: 2.25,
  chrome: 2.5,
};

/**
 * 品质 → 伤害倍率。缺省 / 非法值一律 **1**（恒等）——
 * 与 starDamageMultiplier 的「越界即夹」同一种纪律：结构上不可能出现
 * 「没人定义过的品质打出没定义过的倍率」。
 */
export function qualityDamageMultiplier(q: QualityTierId | undefined): number {
  if (!q) return 1;
  return QUALITY_DAMAGE_MULT[q] ?? 1;
}

/**
 * QUALITY-MOVEMENT-RUNTIME-EQUIP-R1｜品质 → **通用属性倍率**（Movement 扭矩 /
 * Gadget 冲量共用同一真源）。
 *
 * ⚠️ 不是第二套倍率：与 `qualityDamageMultiplier` **同一张表**
 *    （白1.00→彩2.50，`1 + 0.25 × (n − 1)` 的 n=1..7 自然延拓）。
 *    命名区分只为调用点语义清晰（damage vs movement/gadget 属性）；
 *    一致性由测试钉死（同 q 两函数同值）。
 */
export function qualityMultiplierOf(q: QualityTierId | undefined): number {
  return qualityDamageMultiplier(q);
}

/* ------------------------------------------------- 旧星级口径（自包含副本）
 * ⚠️ 与 buildSnapshot.ts 的 starDamageMultiplier / starTierEnergy 同一规则。
 *    这里自包含是为了依赖方向单向（installQuality → types，绝不 import buildSnapshot；
 *    buildSnapshot 单向 import 本文件）⇒ 零循环。
 *    「副本是否漂移」由测试钉死：QT-EQ 等价断言（对全部正式武器 × star 1..5，
 *    applyStarTier ≡ applyInstallTier(_, star, undefined) 逐字段相同）。
 * ---------------------------------------------------------------------- */
const STAR_DAMAGE_STEP = 0.25;
const STAR_DAMAGE_MAX_STAR = 5;
const STAR_TIER_ENERGY_MULT = 1.1;

function isDamageKey(k: string): boolean {
  return /damage/i.test(k);
}

function starDamageMultiplier(star: number | undefined): number {
  if (!star || !Number.isFinite(star) || star <= 1) return 1;
  const s = Math.min(STAR_DAMAGE_MAX_STAR, Math.floor(star));
  return 1 + STAR_DAMAGE_STEP * (s - 1);
}

function starTierEnergy(base: number, star: number | undefined): number {
  if (!star || star <= 1) return base;
  return Math.round(base * STAR_TIER_ENERGY_MULT);
}

function starTierDamage(base: number, star: number | undefined): number {
  const m = starDamageMultiplier(star);
  return m === 1 ? base : Math.round(base * m);
}

/**
 * **安装件统一倍率层**（resolveSnapshot 的唯一接缝）：
 *
 *   - `quality` 缺省 ⇒ **逐字复刻**旧 `applyStarTier`：star<=1 恒等返回**同一个对象**
 *     （零 clone，既有 SP-05 引用语义断言依赖这一点）；star>=2 走星级曲线；
 *   - `quality` 存在 ⇒ 伤害类键 × **品质倍率**（**star 不参与伤害**——不双乘）；
 *     能量仍按 star 口径（star>1 ⇒ ×1.10，取整）；返回新对象（不改原 def 引用）。
 *
 * ⚠️ 作用面与旧层完全一致：只有 `behaviorParams` **顶层**数值键名含 `damage` 的字段
 *    （嵌套伤害如 saw.hitPolicy.damage 不在其中——与星级层同一边界，测试钉死）。
 */
export function applyInstallTier(
  def: FunctionalPartDef,
  star: number | undefined,
  quality: QualityTierId | undefined,
): FunctionalPartDef {
  /* ---------- 路径一：无品质 ⇒ 旧星级层逐字保持 ---------- */
  if (!quality) {
    if (!star || star <= 1) return def;
    const energy = starTierEnergy(def.energy, star);
    let behaviorParams = def.behaviorParams;
    if (behaviorParams) {
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(behaviorParams)) {
        next[k] = typeof v === 'number' && isDamageKey(k) ? starTierDamage(v, star) : v;
      }
      behaviorParams = next;
    }
    return { ...def, energy, behaviorParams };
  }

  /* ---------- 路径二：显式品质 ⇒ 品质倍率替代 star 伤害倍率 ---------- */
  const mult = qualityDamageMultiplier(quality);
  // white（=1.00）且 star<=1：既不抬伤害也不抬能量 ⇒ 恒等返回原对象（零 clone）
  if (mult === 1 && (!star || star <= 1)) return def;
  const energy = starTierEnergy(def.energy, star);
  let behaviorParams = def.behaviorParams;
  if (behaviorParams && mult !== 1) {
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(behaviorParams)) {
      // 伤害类键只乘**品质**倍率（star 不参与——不双乘）；round 与旧层同口径
      next[k] = typeof v === 'number' && isDamageKey(k) ? Math.round(v * mult) : v;
    }
    behaviorParams = next;
  }
  return { ...def, energy, behaviorParams };
}
