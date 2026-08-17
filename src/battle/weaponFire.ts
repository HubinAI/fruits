/**
 * Projectile Weapon（Cannon）开火系统。
 *
 * - 冷却：按固定 cooldown 自动开火，无蓄力 / 散射 / 追踪 / 爆炸；
 * - 炮口方向：来自 Body 姿态（angle）+ Hardpoint 世界方向（facing 镜像），不自动瞄准；
 * - Recoil：开火时用真实 `applyForceAt` 施加在炮口位置、方向 -dir，与 Damage 完全分离；
 *   轻车（小质量）后坐明显、重车（大质量）后坐小 —— 由「力 ÷ 质量」的真实物理决定，非脚本。
 */
import type { CannonParams } from '../core/types';
import { applyForceAt, PhysWorld } from '../physics/adapter';
import type { PartRuntime, Vehicle } from './vehicleAssembly';
import { spawnProjectile, type Projectile } from './projectile';

/** 炮口世界位置 + 方向 */
export function muzzleTransform(
  v: Vehicle,
  part: PartRuntime,
): { pos: { x: number; y: number }; dir: { x: number; y: number } } {
  const hp = part.hardpoint.localPosition;
  // facing 镜像（朝左时硬点 X 取反，Y 不变），再随 body.angle 旋转
  const hpLocal = { x: v.facing * hp.x, y: hp.y };
  const cos = Math.cos(v.body.angle);
  const sin = Math.sin(v.body.angle);
  const hpWorld = {
    x: v.body.position.x + hpLocal.x * cos - hpLocal.y * sin,
    y: v.body.position.y + hpLocal.x * sin + hpLocal.y * cos,
  };
  // 炮口方向 = 车头（facing）方向随 body.angle 旋转
  const dir = { x: v.facing * cos, y: v.facing * sin };
  // 炮管前伸：collider offset（炮管中心）+ 半宽，得到炮口在 hardpoint 前方的距离
  const collider = part.def.collider;
  const barrelLen = collider.offset.x + (collider.width ?? 0) / 2;
  return {
    pos: { x: hpWorld.x + dir.x * barrelLen, y: hpWorld.y + dir.y * barrelLen },
    dir,
  };
}

/**
 * 更新 Cannon 冷却并开火。返回本步新生成的 Projectile。
 * 由 BattleOrchestrator 每步调用（对每辆车）。
 */
export function updateCannonFire(
  world: PhysWorld,
  v: Vehicle,
  dtMs: number,
  nowMs: number,
): Projectile[] {
  const spawned: Projectile[] = [];

  for (const part of v.parts) {
    if (part.def.behavior !== 'cannon') continue;
    const params = part.def.behaviorParams as unknown as CannonParams;

    const remain = (v.weaponCooldowns.get(part.id) ?? 0) - dtMs;
    if (remain > 0) {
      v.weaponCooldowns.set(part.id, remain);
      continue;
    }
    v.weaponCooldowns.set(part.id, params.cooldown);

    const { pos, dir } = muzzleTransform(v, part);
    spawned.push(
      spawnProjectile(
        world,
        v.team,
        pos,
        { x: dir.x * params.projectileSpeed, y: dir.y * params.projectileSpeed },
        params.projectileRadius,
        params.projectileMass,
        params.damage,
        params.projectileLifetime,
        nowMs,
      ),
    );

    // Recoil：真实反作用力，作用在炮口位置、方向 -dir（与 Damage 分离）
    applyForceAt(v.body, pos, -dir.x * params.recoilForce, -dir.y * params.recoilForce);
  }

  return spawned;
}
