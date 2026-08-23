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
 * - 伤害类数值（behaviorParams 中字段名含 'damage' 的数值）统一约 +15%（取整数）。
 * 物理几何 / 攻击节奏 / 射程 / 特殊机制不变。
 * 倍率后值在 buildSnapshotFromDraft 注入 install.star、resolveSnapshot 解析时应用，
 * 使 Runtime 拿到的 def 已是强化后值，零改 Runtime / Contact / Weapon 代码。
 */
export const STAR_TIER_ENERGY_MULT = 1.1;
export const STAR_TIER_DAMAGE_MULT = 1.15;

/** 星级能量倍率（star<=1 恒等） */
export function starTierEnergy(base: number, star: number | undefined): number {
  if (!star || star <= 1) return base;
  return Math.round(base * STAR_TIER_ENERGY_MULT);
}

/** 星级伤害倍率（star<=1 恒等） */
export function starTierDamage(base: number, star: number | undefined): number {
  if (!star || star <= 1) return base;
  return Math.round(base * STAR_TIER_DAMAGE_MULT);
}

/** 字段名是否属「伤害类数值」（统一倍率目标） */
function isDamageKey(k: string): boolean {
  return /damage/i.test(k);
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
