/**
 * Build Snapshot 构造与解析。
 * Battle Runtime 只接收已装配好的 Build Snapshot。
 */
import type {
  BodyDef,
  BuildSnapshot,
  ContentRegistry,
  FunctionalHardpointDef,
  FunctionalInstall,
  FunctionalPartDef,
  MovementHardpointDef,
  MovementInstall,
  WheelDef,
} from './types';

/**
 * Q22｜星级统一倍率层（V0.5 部件成长）。
 * 仅做一次统一倍率，不在每个 Weapon 内单独打补丁：
 * - 能量统一约 +10%（取整数）；
 * - 伤害类数值（behaviorParams 中字段名含 'damage' 的数值）按**逐星曲线**放大（取整数）。
 * 物理几何 / 攻击节奏 / 射程 / 特殊机制不变。
 * 倍率后值在 buildSnapshotFromDraft 注入 install.star、resolveSnapshot 解析时应用，
 * 使 Runtime 拿到的 def 已是强化后值，零改 Runtime / Contact / Weapon 代码。
 *
 * ---------------------------------------------------------------------------
 * PRODUCT-LOOP-R2-C｜伤害倍率从「2★ 一个固定值」改为「1★..5★ 的线性曲线」
 *
 * 旧口径（Q22，仅两档可用）：`star >= 2` 一律 ×1.15 —— 当时星级上限就是 2★，
 * 谈不上「第几星」，因此一个常数够用。R2-B 把库存/存档泛化到 ★1..★5 之后，
 * 「★3 与 ★2 伤害一样」会直接毁掉玩家对「升星 = 伤害更高」的理解，
 * 所以本项目对**星级 → 武器伤害**这条关系只承认一条公式（本文件的
 * `starDamageMultiplier`）：`1 + 0.25 × (star - 1)`：
 *
 *   ★1 = 1.00 · ★2 = 1.25 · ★3 = 1.50 · ★4 = 1.75 · ★5 = 2.00
 *
 * ⚠️ 这是**星级伤害倍率的唯一真源**：Garage 卡片上给玩家看的那一行（「攻击 80 → 100」）
 *    与战斗里真实扣血的数（`ContactRouter` 取 `behaviorParams` 里的伤害字段）
 *    必须由同一个函数算出来 —— 否则「卡片写的」与「打出来的」会各说各话。
 * ⚠️ **只**改伤害：`cooldownMs` / `muzzleSpeed` / `projectileRadius` / `projectileMass` /
 *    `recoilImpulse`（以及一切字段名不含 'damage' 的参数）逐字不变 ——
 *    「升星只让武器打得更重」是产品承诺，由 `tests/productStarPowerR2C.test.ts` 机器钉死。
 */
export const STAR_TIER_ENERGY_MULT = 1.1;

/** 每升 1 星的武器伤害增量（见 `starDamageMultiplier`）。 */
export const STAR_DAMAGE_STEP = 0.25;
/**
 * 伤害曲线的星级上界（= 库存数据模型的档数上界 ★5）。
 * ⚠️ 与 `partInventory.INVENTORY_MAX_STAR` 必须同值（两处各自声明、由测试钉死，
 *    避免 core 的最底层纯模块反向依赖库存模块）。
 */
export const STAR_DAMAGE_MAX_STAR = 5;

/** 星级能量倍率（star<=1 恒等） */
export function starTierEnergy(base: number, star: number | undefined): number {
  if (!star || star <= 1) return base;
  return Math.round(base * STAR_TIER_ENERGY_MULT);
}

/**
 * 星级 → 武器伤害倍率（★1 恒等 = 1）。
 *
 * 越界 / 非数 / ★6… 一律**夹**进 `1..STAR_DAMAGE_MAX_STAR`（不抛错、不返回 NaN）：
 * 与 `partInventory.starKey` 同一种「越界即夹」的纪律 —— 结构上不可能出现
 * 「★9 打出 3.0 倍」这种没人定义过的读数。
 */
export function starDamageMultiplier(star: number | undefined): number {
  if (!star || !Number.isFinite(star) || star <= 1) return 1;
  const s = Math.min(STAR_DAMAGE_MAX_STAR, Math.floor(star));
  return 1 + STAR_DAMAGE_STEP * (s - 1);
}

/** 星级伤害倍率（star<=1 恒等；★2..★5 = 1.25 / 1.50 / 1.75 / 2.00） */
export function starTierDamage(base: number, star: number | undefined): number {
  const m = starDamageMultiplier(star);
  return m === 1 ? base : Math.round(base * m);
}

/** 字段名是否属「伤害类数值」（统一倍率目标） */
function isDamageKey(k: string): boolean {
  return /damage/i.test(k);
}

/**
 * PRODUCT-LOOP-R2-C｜一件武器的**主伤害值** —— 「这件武器一次命中会扣对手多少血」。
 *
 * 为什么需要它：战斗侧结算伤害时**按武器类别读不同的字段**
 * （`src/battle/contactRouter.ts`：
 *   - 弹丸类命中 → `behaviorParams.projectileDamage`（炮 / 霰弹 / 机枪 / 镭射…）；
 *   - 车身直击类 → `behaviorParams.baseDamage`（锤 / 刺 / 冲角…））。
 * Garage 要给玩家看「这一件的攻击力」、探针要报「本场这一件真的打多少」，
 * 若各自去 `behaviorParams` 里猜字段名，就会出现第二个「伤害口径」。
 * ⇒ 本函数是**唯一**知道「主伤害取哪个键」的地方，且顺序（先弹丸后直击）
 *   与战斗侧两个分支一一对应；`tests/productStarPowerR2C.test.ts` 用
 *   「真实战斗里打出来的数」把这条口径钉死（不是只比源码字符串）。
 *
 * 没有任何伤害字段（Gadget / Movement / 纯装饰件）⇒ `0`。
 */
export function weaponMainDamage(def: FunctionalPartDef): number {
  const bp = def.behaviorParams ?? {};
  const projectile = bp['projectileDamage'];
  if (typeof projectile === 'number' && Number.isFinite(projectile)) return projectile;
  const direct = bp['baseDamage'];
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  return 0;
}

/** 该武器的**全部数值型 behaviorParams**（只读快照；用于逐项证明「只有伤害变了」）。 */
export function weaponNumericParams(def: FunctionalPartDef): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(def.behaviorParams ?? {})) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** 应用星级倍率，返回倍率后的 def 副本（star<=1 直接返回原 def，零 clone 开销） */
export function applyStarTier(def: FunctionalPartDef, star: number | undefined): FunctionalPartDef {
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

/** 解析后的 Movement 安装（含展开定义） */
export interface ResolvedMovement {
  install: MovementInstall;
  hardpoint: MovementHardpointDef;
  def: WheelDef;
}

/** 解析后的 Functional 安装（含展开定义） */
export interface ResolvedFunctional {
  install: FunctionalInstall;
  hardpoint: FunctionalHardpointDef;
  def: FunctionalPartDef;
}

/** 解析后的 Build Snapshot（含装配级有效数值） */
export interface ResolvedSnapshot {
  snapshot: BuildSnapshot;
  body: BodyDef;
  movements: ResolvedMovement[];
  functionals: ResolvedFunctional[];
  /** 总质量 = Body 基础质量 + 所有部件质量 */
  totalMass: number;
  /** 总能量 = 所有功能部件能量之和 */
  totalEnergy: number;
}

/** 应用 Movement overrides（用于 Lab 轮径 / 质量测试） */
function applyMovementOverrides(
  def: WheelDef,
  overrides?: Partial<WheelDef>,
): WheelDef {
  if (!overrides) return def;
  return { ...def, ...overrides };
}

/** 展开并解析 Build Snapshot。缺失引用会抛错（调用方应先通过 BuildValidator）。 */
export function resolveSnapshot(
  snapshot: BuildSnapshot,
  registry: ContentRegistry,
): ResolvedSnapshot {
  const body = registry.bodies.get(snapshot.bodyDefId);
  if (!body) {
    throw new Error(`ResolveSnapshot: unknown body "${snapshot.bodyDefId}"`);
  }

  const movements: ResolvedMovement[] = snapshot.movements.map((install) => {
    const hardpoint = body.movementHardpoints.find(
      (h) => h.id === install.hardpointId,
    );
    if (!hardpoint) {
      throw new Error(
        `ResolveSnapshot: unknown movement hardpoint "${install.hardpointId}"`,
      );
    }
    const baseDef = registry.movements.get(install.defId);
    if (!baseDef) {
      throw new Error(`ResolveSnapshot: unknown movement "${install.defId}"`);
    }
    return { install, hardpoint, def: applyMovementOverrides(baseDef, install.overrides) };
  });

  const functionals: ResolvedFunctional[] = snapshot.functionals.map((install) => {
    const hardpoint = body.functionalHardpoints.find(
      (h) => h.id === install.hardpointId,
    );
    if (!hardpoint) {
      throw new Error(
        `ResolveSnapshot: unknown functional hardpoint "${install.hardpointId}"`,
      );
    }
    const def = registry.functionals.get(install.defId);
    if (!def) {
      throw new Error(`ResolveSnapshot: unknown functional "${install.defId}"`);
    }
    // Q22：应用星级统一倍率（star<=1 恒等），Runtime 拿到强化后 def
    return { install, hardpoint, def: applyStarTier(def, install.star ?? 1) };
  });

  const totalMass =
    body.baseMass +
    movements.reduce((s, m) => s + m.def.mass, 0) +
    functionals.reduce((s, f) => s + f.def.mass, 0);

  const totalEnergy = functionals.reduce((s, f) => s + f.def.energy, 0);

  return {
    snapshot,
    body,
    movements,
    functionals,
    totalMass,
    totalEnergy,
  };
}

/**
 * 计算「替换某 Functional 部件」后的 Energy。
 * 规则：当前 Energy - 被替换部件 Energy + 新部件 Energy。
 * 禁止因为先加后减导致错误拒绝。
 */
export function energyAfterReplace(
  currentEnergy: number,
  replacedPartEnergy: number,
  newPartEnergy: number,
): number {
  return currentEnergy - replacedPartEnergy + newPartEnergy;
}

/** 计算「替换某 Functional 部件」后的总质量 */
export function massAfterReplace(
  currentMass: number,
  replacedPartMass: number,
  newPartMass: number,
): number {
  return currentMass - replacedPartMass + newPartMass;
}
