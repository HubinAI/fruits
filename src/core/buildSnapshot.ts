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
    return { install, hardpoint, def };
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
