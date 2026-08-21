/**
 * 真实 Projectile 生成（Q13-B 抽取）：所有「发射真实弹」Weapon 共用的唯一生成点。
 *
 * 复用现有正式 Projectile / CCD / Owner Filter 链（与 Cannon / Laser 同一条引擎链路，
 * 不创建第二套 Projectile 系统）：
 * - world.createDynamicCircle(... { bullet:true, collisionFilter })：真实动态圆 + 原生 CCD；
 * - world.setOwnerTag(...)：kind='projectile' + shooter team + partId('part:<hardpoint>')，
 *   供 ContactRouter 反查来源 weapon part 结算 projectileDamage；
 * - world.setLinearVelocity(...)：初速度 = 射手（part body）线速度 + dir × muzzleSpeed；
 * - 碰撞过滤：不碰同队（同负 group + mask 不含己方类别），可碰敌车 / arena / ground / hazard。
 *
 * 调用方（Shotgun 等）只负责「何时发射 / 朝哪些方向发射 / 发几发」，弹体本身的生成、
 * 归属、CCD、伤害结算全部走本函数 + ContactRouter，确保只有一条 Projectile 系统。
 */
import type {
  BodyHandle,
  PlanckCollisionFilter,
  PlanckWorld,
} from '../physics/planckWorld';
import {
  PlanckCategory,
  type PlanckPartRuntime,
  type PlanckVehicle,
} from './planckVehicleAssembly';

/** 本地向量旋转（px；与 planckVehicleAssembly.rotateLocal 同语义） */
function rotateLocal(p: { x: number; y: number }, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/** 单次发射参数（方向由调用方给出；同一次齐射的各发只改 dir） */
export interface SpawnProjectileParams {
  /** 单位方向（由调用方按扇形/单发算出；初速度 = 射手线速度 + dir × muzzleSpeed） */
  dir: { x: number; y: number };
  muzzleSpeed: number;
  projectileRadius: number;
  projectileMass: number;
  /** 可选：弹体重力缩放（Laser 用 0 走直线；Cannon/Shotgun 缺省 = 跟随世界重力） */
  gravityScale?: number;
}

/** 单次生成结果：created projectile handle + 真实炮口世界点（供 recoil / 爆闪定位） */
export interface SpawnProjectileResult {
  proj: BodyHandle;
  muzzlePoint: { x: number; y: number };
}

/**
 * 生成一发真实 projectile（复用正式 Projectile 链路，Q13-B 起所有发射武器共用）。
 * 返回 { proj, muzzlePoint }：proj 供调用方追踪 / 越界销毁；muzzlePoint 供 recoil / 爆闪。
 */
export function spawnWeaponProjectile(
  world: PlanckWorld,
  vehicle: PlanckVehicle,
  part: PlanckPartRuntime,
  opts: SpawnProjectileParams,
): SpawnProjectileResult {
  const p = opts;
  const partPos = world.getPosition(part.body);
  const partAngle = world.getAngle(part.body);

  // 炮口外缘（part 本地坐标）：collider 沿发射轴方向的最远点（与 Cannon 同公式）
  const c = part.def.collider;
  const halfW = (c.width ?? 0) / 2;
  const muzzleLocal = {
    x: vehicle.facing * ((c.offset?.x ?? 0) + halfW),
    y: c.offset?.y ?? 0,
  };
  const muzzlePoint = {
    x: partPos.x + rotateLocal(muzzleLocal, partAngle).x,
    y: partPos.y + rotateLocal(muzzleLocal, partAngle).y,
  };

  // 初速度 = 当前射手（part body）线速度 + 发射方向 × muzzleSpeed
  const shooterVel = world.getLinearVelocity(part.body);
  const velocity = {
    x: shooterVel.x + p.dir.x * p.muzzleSpeed,
    y: shooterVel.y + p.dir.y * p.muzzleSpeed,
  };

  // 碰撞过滤：不碰同队（同负 group + mask 不含己方类别），可碰敌车 / arena / ground / hazard
  const enemyCat =
    vehicle.team === 'A' ? PlanckCategory.VEHICLE_B : PlanckCategory.VEHICLE_A;
  const filter: PlanckCollisionFilter = {
    categoryBits: PlanckCategory.PROJECTILE,
    maskBits:
      PlanckCategory.GROUND |
      PlanckCategory.ARENA |
      PlanckCategory.HAZARD |
      enemyCat,
    groupIndex: vehicle.team === 'A' ? -1 : -2,
  };

  // 真实动态圆 + 原生 CCD（bullet=true）；复用正式 Projectile 链路，不新建系统
  const proj = world.createDynamicCircle(
    muzzlePoint.x,
    muzzlePoint.y,
    p.projectileRadius,
    p.projectileMass,
    {
      bullet: true,
      collisionFilter: filter,
      ...(p.gravityScale !== undefined ? { gravityScale: p.gravityScale } : {}),
    },
  );
  world.setOwnerTag(proj, {
    kind: 'projectile',
    vehicleId: vehicle.id,
    partId: `part:${part.id}`,
    team: vehicle.team,
  });
  world.setLinearVelocity(proj, velocity.x, velocity.y);

  return { proj, muzzlePoint };
}
