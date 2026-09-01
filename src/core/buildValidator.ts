/**
 * Build Validator。
 *
 * 至少校验：
 * 1. 槽位存在；
 * 2. 类型合法；
 * 3. Energy 合法（不得超载）；
 * 4. 至少 1 件 Weapon。
 *
 * Energy 超载规则：安装 / 替换后 Energy 超出 Body Capacity 直接拒绝，
 * 替换时按「当前 Energy - 被替换部件 Energy + 新部件 Energy」计算。
 */
import type {
  BodyDef,
  BuildSnapshot,
  ContentRegistry,
  FunctionalInstall,
  ValidationResult,
} from './types';
import { energyAfterReplace, starTierEnergy } from './buildSnapshot';

function fail(message: string): ValidationResult {
  return { valid: false, errors: [message] };
}

function ok(): ValidationResult {
  return { valid: true, errors: [] };
}

/**
 * 计算一个 snapshot 当前的 totalEnergy（functional 部件 + F-CONTENT-PLAYER-
 * MOVEMENT-PACK-R1 起计入 movements 轮组能量；wheelStd=0 保持旧 Build 零回归）。
 */
export function computeEnergy(
  snapshot: BuildSnapshot,
  registry: ContentRegistry,
): { energy: number; error?: string } {
  let energy = 0;
  for (const install of snapshot.movements) {
    const def = registry.movements.get(install.defId);
    if (!def) return { energy, error: `未知 Movement "${install.defId}"` };
    energy += def.energy;
  }
  for (const install of snapshot.functionals) {
    const def = registry.functionals.get(install.defId);
    if (!def) return { energy, error: `未知功能部件 "${install.defId}"` };
    // Q22：能量含星级倍率（star<=1 恒等），否则 2★ 超载检测失效
    energy += starTierEnergy(def.energy, install.star ?? 1);
  }
  return { energy };
}

/** 整体校验一个 Build Snapshot */
export function validateSnapshot(
  snapshot: BuildSnapshot,
  registry: ContentRegistry,
): ValidationResult {
  const errors: string[] = [];

  const body: BodyDef | undefined = registry.bodies.get(snapshot.bodyDefId);
  if (!body) {
    errors.push(`未知 Body "${snapshot.bodyDefId}"`);
    return { valid: false, errors };
  }

  // Movement 安装校验
  const usedMovementHardpoints = new Set<string>();
  // F-CONTENT-PLAYER-MOVEMENT-PACK-R1：Movement 计能（wheelStd=0 零回归）
  let movementEnergy = 0;
  for (const install of snapshot.movements) {
    const hp = body.movementHardpoints.find((h) => h.id === install.hardpointId);
    if (!hp) {
      errors.push(`Movement 槽位不存在 "${install.hardpointId}"`);
      continue;
    }
    if (usedMovementHardpoints.has(install.hardpointId)) {
      errors.push(`Movement 槽位重复占用 "${install.hardpointId}"`);
    }
    usedMovementHardpoints.add(install.hardpointId);

    const def = registry.movements.get(install.defId);
    if (!def) {
      errors.push(`未知 Movement "${install.defId}"`);
      continue;
    }
    if (def.kind !== 'wheel') {
      errors.push(`V1 阶段 Movement 仅支持 Wheel，收到 "${def.kind}"`);
    }
    movementEnergy += def.energy;
  }

  // Functional 安装校验
  const usedFunctionalHardpoints = new Set<string>();
  let energy = 0;
  let weaponCount = 0;
  for (const install of snapshot.functionals) {
    const hp = body.functionalHardpoints.find(
      (h) => h.id === install.hardpointId,
    );
    if (!hp) {
      errors.push(`Functional 槽位不存在 "${install.hardpointId}"`);
      continue;
    }
    if (usedFunctionalHardpoints.has(install.hardpointId)) {
      errors.push(`Functional 槽位重复占用 "${install.hardpointId}"`);
    }
    usedFunctionalHardpoints.add(install.hardpointId);

    const def = registry.functionals.get(install.defId);
    if (!def) {
      errors.push(`未知 Functional "${install.defId}"`);
      continue;
    }
    energy += def.energy;
    if (def.category === 'weapon') weaponCount += 1;
  }

  // Energy 合法（F-CONTENT-PLAYER-MOVEMENT-PACK-R1：含 Movement 能量）
  if (energy + movementEnergy > body.energyCapacity) {
    errors.push(
      `能量超载：${energy + movementEnergy} > 容量 ${body.energyCapacity}`,
    );
  }

  // 至少 1 件 Weapon
  if (weaponCount < 1) {
    errors.push('至少需要 1 件 Weapon');
  }

  return errors.length === 0 ? ok() : { valid: false, errors };
}

/**
 * 校验一次 Functional 安装 / 替换操作。
 * 返回是否合法；Energy 超载直接拒绝（替换按先减后加计算）。
 */
export function validateFunctionalInstall(
  snapshot: BuildSnapshot,
  registry: ContentRegistry,
  install: FunctionalInstall,
): ValidationResult {
  const body = registry.bodies.get(snapshot.bodyDefId);
  if (!body) return fail(`未知 Body "${snapshot.bodyDefId}"`);

  const hp = body.functionalHardpoints.find(
    (h) => h.id === install.hardpointId,
  );
  if (!hp) return fail(`Functional 槽位不存在 "${install.hardpointId}"`);

  const def = registry.functionals.get(install.defId);
  if (!def) return fail(`未知 Functional "${install.defId}"`);

  // 被替换部件（若该槽位已被占用）
  const existing = snapshot.functionals.find(
    (f) => f.hardpointId === install.hardpointId,
  );

  const currentEnergy = computeEnergy(snapshot, registry).energy;
  const replacedEnergy = existing
    ? starTierEnergy(
        registry.functionals.get(existing.defId)?.energy ?? 0,
        existing.star ?? 1,
      )
    : 0;

  // Q22：安装部件的能量也含星级倍率
  const nextEnergy = energyAfterReplace(
    currentEnergy,
    replacedEnergy,
    starTierEnergy(def.energy, install.star ?? 1),
  );
  if (nextEnergy > body.energyCapacity) {
    return fail(
      `能量超载：安装后 ${nextEnergy} > 容量 ${body.energyCapacity}`,
    );
  }

  return ok();
}
