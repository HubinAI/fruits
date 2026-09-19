/**
 * PBL-F1｜共享测试数据的 Spawn 流程（纯函数 + 纯数据容器，无 DOM / 无 Canvas / 无物理）。
 *
 * 职责：
 *   1) 把「Test Loadout + Encounter」解析为一份 **Arena 无关** 的 SpawnPlan；
 *   2) 所有 HP / 质量 / 能量 / 伤害 / CD / 弹丸参数一律走正式链路
 *      `buildSnapshotFromDraft` → `validateSnapshot` → `resolveSnapshot`（registry 为唯一来源），
 *      本文件不出现任何手写数值；
 *   3) 提供实体 / 弹丸容器与清理语义：Start 生成、Reset 彻底清空（无残留）。
 *
 * 明确不做（属 PBL-A1 / PBL-B1）：出生坐标与站位、移动 / 朝向 / 接敌、物理步进、
 * AI、伤害结算、弹丸发射。本文件只产出「场上该有哪些实体、它们的基础数据是什么」。
 */
import { registry } from '../../core/content';
import { buildSnapshotFromDraft, type BuildDraft } from '../buildEditorModel';
import { resolveSnapshot, type ResolvedMovement, type ResolvedFunctional } from '../../core/buildSnapshot';
import { validateSnapshot } from '../../core/buildValidator';
import type { BodyDef, BuildSnapshot, FunctionalPartDef } from '../../core/types';
import { findEncounter, findLoadout } from './testData';
import type { LabEncounterId, LabLoadoutId } from './constants';

/* ------------------------------------------------------------ 类型定义 */

export type LabTeam = 'player' | 'enemy';

/** 解析后的移动件（数值全部来自正式 registry）。 */
export interface SpawnedMovement {
  readonly hardpointId: string;
  readonly defId: string;
  readonly name: string;
  readonly radius: number;
  readonly mass: number;
  readonly energy: number;
  readonly maxRPM: number;
  readonly grip: number;
}

/** 武器 / 辅助件的基础战斗数据（本 Queue 只声明，不发射）。 */
export interface CombatProfile {
  readonly defId: string;
  readonly name: string;
  readonly category: 'weapon' | 'gadget';
  readonly behavior: string;
  /** 接触型伤害（hammer 的 baseDamage）；无则 null。 */
  readonly contactDamage: number | null;
  /** 弹丸伤害（cannon 的 projectileDamage）；无则 null。 */
  readonly projectileDamage: number | null;
  /** 冷却 ms（cannon / thruster / machineGun 等）；无则 null。 */
  readonly cooldownMs: number | null;
  /** 真实弹丸参数；非弹丸武器为 null。 */
  readonly projectile: {
    readonly radius: number;
    readonly mass: number;
    readonly speed: number;
  } | null;
}

export interface SpawnedFunctional {
  readonly hardpointId: string;
  readonly defId: string;
  readonly name: string;
  readonly category: 'weapon' | 'gadget';
  readonly mass: number;
  readonly energy: number;
  readonly behavior: string;
  readonly behaviorParams: Readonly<Record<string, unknown>>;
  readonly profile: CombatProfile;
}

/** 场上一个实体（车辆）的基础数据快照——A / B 完全共用同一份。 */
export interface SpawnedEntity {
  readonly entityId: string;
  readonly team: LabTeam;
  readonly slotIndex: number;
  readonly bodyDefId: string;
  readonly bodyName: string;
  readonly hp: number;
  readonly energyCapacity: number;
  readonly bodyMass: number;
  readonly totalMass: number;
  readonly totalEnergy: number;
  readonly drive: 'forward' | 'stationary';
  readonly movements: readonly SpawnedMovement[];
  readonly functionals: readonly SpawnedFunctional[];
  /**
   * PBL-A1：正式 `BuildSnapshot`（经正式 `buildSnapshotFromDraft` 产出）。
   * 真实 Arena Runtime 需要用它 + 正式 `resolveSnapshot` 装配真实车辆；
   * 它是「正式链路产物」而非 Lab 自造数据，且**不进入 baseKey**
   * （A/B 共用指纹不受影响，见 entityBaseKey）。
   */
  readonly snapshot: BuildSnapshot;
}

export interface SpawnPlan {
  readonly loadoutId: LabLoadoutId;
  readonly encounterId: LabEncounterId;
  readonly player: SpawnedEntity;
  readonly enemies: readonly SpawnedEntity[];
  /**
   * 共享基础数据指纹：只由 (loadout, encounter) 决定，与 Arena / team / 序号无关。
   * A / B 对照测试用它证明「两边读到的是同一套基础数据」。
   */
  readonly baseKey: string;
  /** 场上全部实体（player 在首位）。 */
  readonly entities: readonly SpawnedEntity[];
  /**
   * PBL-FOUNDATION-RANGED-DISTANCE-CONTROL-R1｜本套 Encounter 声明的对手 Movement 姿态。
   *
   * ⚠️ 由 `LAB_ENCOUNTERS[].enemyDrive` **原样透传**（不推断、不按 id 判断）。
   *    缺省 `undefined` ⇒ 战斗运行时不给对手装距离档 ⇒ 驱动行为逐帧不变。
   */
  readonly enemyDrive?: 'keep-distance';
}

/** 弹丸记录容器（本 Queue 不发射；A1/B1 接入，Reset 必须清空）。 */
export interface ProjectileRecord {
  readonly projectileId: number;
  readonly ownerEntityId: string;
  readonly defId: string;
  readonly radius: number;
  readonly mass: number;
  readonly speed: number;
  readonly damage: number;
}

/* --------------------------------------------------------- 数值解析层 */

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * 从正式 def 推导战斗基础数据。
 * 只按**约定字段名**读取行为参数（baseDamage / projectileDamage / cooldownMs /
 * projectileRadius / projectileMass / muzzleSpeed），不复制任何数值。
 */
export function combatProfileOf(def: FunctionalPartDef): CombatProfile {
  const p = (def.behaviorParams ?? {}) as Record<string, unknown>;
  const radius = num(p['projectileRadius']);
  const mass = num(p['projectileMass']);
  const speed = num(p['muzzleSpeed']);
  return {
    defId: def.id,
    name: def.name,
    category: def.category,
    behavior: def.behavior,
    contactDamage: num(p['baseDamage']),
    projectileDamage: num(p['projectileDamage']),
    cooldownMs: num(p['cooldownMs']),
    projectile: radius !== null && mass !== null && speed !== null ? { radius, mass, speed } : null,
  };
}

function toMovement(m: ResolvedMovement): SpawnedMovement {
  return {
    hardpointId: m.install.hardpointId,
    defId: m.def.id,
    name: m.def.name,
    radius: m.def.radius,
    mass: m.def.mass,
    energy: m.def.energy,
    maxRPM: m.def.maxRPM,
    grip: m.def.grip,
  };
}

function toFunctional(f: ResolvedFunctional): SpawnedFunctional {
  return {
    hardpointId: f.install.hardpointId,
    defId: f.def.id,
    name: f.def.name,
    category: f.def.category,
    mass: f.def.mass,
    energy: f.def.energy,
    behavior: f.def.behavior,
    behaviorParams: f.def.behaviorParams ?? {},
    profile: combatProfileOf(f.def),
  };
}

/**
 * 把一个正式 BuildDraft 解析成实体基础数据。
 * 先过正式 BuildValidator（合法性），再过 resolveSnapshot（数值展开）——
 * 任何缺失引用都会显式抛错，不静默回退。
 */
function resolveEntity(
  draft: BuildDraft,
  entityId: string,
  team: LabTeam,
  slotIndex: number,
  id: string,
): SpawnedEntity {
  const snapshot = buildSnapshotFromDraft(draft, registry, id);
  const validation = validateSnapshot(snapshot, registry);
  if (!validation.valid) {
    throw new Error(`[PBL-F1] 测试数据非法 Build（${entityId}）：${validation.errors.join('；')}`);
  }
  const resolved = resolveSnapshot(snapshot, registry);
  const body: BodyDef = resolved.body;
  return {
    entityId,
    team,
    slotIndex,
    bodyDefId: body.id,
    bodyName: body.name,
    hp: body.hp,
    energyCapacity: body.energyCapacity,
    bodyMass: body.baseMass,
    totalMass: resolved.totalMass,
    totalEnergy: resolved.totalEnergy + resolved.movements.reduce((s, m) => s + m.def.energy, 0),
    drive: draft.drive === 'stationary' ? 'stationary' : 'forward',
    movements: resolved.movements.map(toMovement),
    functionals: resolved.functionals.map(toFunctional),
    snapshot,
  };
}

/** 指纹只取「基础战斗数据」，刻意不含 team / entityId / 序号 → A/B 必须完全相同。 */
function entityBaseKey(e: SpawnedEntity): string {
  return JSON.stringify({
    body: e.bodyDefId,
    hp: e.hp,
    mass: e.totalMass,
    energy: e.totalEnergy,
    cap: e.energyCapacity,
    drive: e.drive,
    movements: e.movements.map((m) => [m.hardpointId, m.defId, m.radius, m.mass, m.energy]),
    functionals: e.functionals.map((f) => [
      f.hardpointId,
      f.defId,
      f.mass,
      f.energy,
      f.profile.contactDamage,
      f.profile.projectileDamage,
      f.profile.cooldownMs,
      f.profile.projectile ? [f.profile.projectile.radius, f.profile.projectile.mass, f.profile.projectile.speed] : null,
    ]),
  });
}

/* ------------------------------------------------------------- Spawn 流程 */

/**
 * 生成 SpawnPlan。**入参不含 arena**——A / B 唯一共用同一套测试数据。
 * `LightSwarm3` 只把同一套正式轻型 Build 复制 count 份，数值零改动。
 */
export function buildSpawnPlan(loadoutId: string, encounterId: string): SpawnPlan {
  const loadout = findLoadout(loadoutId);
  if (!loadout) throw new Error(`[PBL-F1] 未知 Test Loadout "${loadoutId}"`);
  const encounter = findEncounter(encounterId);
  if (!encounter) throw new Error(`[PBL-F1] 未知 Encounter "${encounterId}"`);

  const player = resolveEntity(loadout.draft, 'player', 'player', 0, `lab-loadout-${loadout.id}`);
  const enemies: SpawnedEntity[] = [];
  for (let i = 0; i < encounter.count; i++) {
    enemies.push(
      resolveEntity(
        // 深拷贝模板 draft：每份敌人独立，互不共享可变引用
        { ...encounter.draft, functionalSelections: { ...encounter.draft.functionalSelections } },
        `enemy-${i + 1}`,
        'enemy',
        i,
        `lab-encounter-${encounter.id}-${i + 1}`,
      ),
    );
  }

  const baseKey = JSON.stringify({
    loadout: loadout.id,
    encounter: encounter.id,
    player: entityBaseKey(player),
    enemy: entityBaseKey(enemies[0]),
    enemyCount: enemies.length,
  });

  return {
    loadoutId: loadout.id,
    encounterId: encounter.id,
    player,
    enemies,
    baseKey,
    entities: [player, ...enemies],
    // PBL-FOUNDATION-RANGED-DISTANCE-CONTROL-R1：只**原样透传**数据源里的声明。
    enemyDrive: encounter.enemyDrive,
  };
}

/* --------------------------------------------------- 运行时数据容器 */

/** Lab 运行期数据（纯数据；Start 生成 / Reset 彻底清空）。 */
export interface LabRunData {
  readonly plan: SpawnPlan | null;
  readonly entities: readonly SpawnedEntity[];
  readonly projectiles: readonly ProjectileRecord[];
  /** 累计 spawn 批次号（单调递增，不随 Reset 归零——用于证明每次都是新批次）。 */
  readonly spawnSerial: number;
}

export function createRunData(): LabRunData {
  return { plan: null, entities: [], projectiles: [], spawnSerial: 0 };
}

/** Start：按当前配置生成一批实体（替换上一批，不留旧引用）。 */
export function spawnRun(loadoutId: string, encounterId: string, serial: number): LabRunData {
  const plan = buildSpawnPlan(loadoutId, encounterId);
  return { plan, entities: [...plan.entities], projectiles: [], spawnSerial: serial };
}

/** Reset / 中止：清空实体与弹丸（plan 一并置空，spawnSerial 保留，便于排查残留批次）。 */
export function clearRun(prev: LabRunData): LabRunData {
  return { plan: null, entities: [], projectiles: [], spawnSerial: prev.spawnSerial };
}

/** 追加弹丸记录（本 Queue 无人调用；A1/B1 接入后由 Reset 统一清空）。 */
export function addProjectile(prev: LabRunData, p: ProjectileRecord): LabRunData {
  return { ...prev, projectiles: [...prev.projectiles, p] };
}

/** 是否已彻底清空（Reset 后必须为 true）。 */
export function isRunClean(run: LabRunData): boolean {
  return run.plan === null && run.entities.length === 0 && run.projectiles.length === 0;
}
