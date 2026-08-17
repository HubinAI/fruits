/**
 * Projectile 运行时实体。
 *
 * 真实刚体飞出（禁止「立即命中判定」）：
 * - 从炮口世界位置生成；
 * - 初速度沿炮口世界方向；
 * - 带 Owner（Team）；
 * - 碰撞过滤保证不能命中自己（只与敌车 category + Arena + Ground 碰撞）；
 * - 默认不反弹（restitution 0）；
 * - 命中 / 撞墙 / 越界后销毁（销毁逻辑在 BattleOrchestrator 的碰撞处理与 bounds 检查）。
 */
import type { Body } from 'matter-js';
import type { TeamId } from '../core/types';
import { Category, PhysWorld, createCircle, setMeta, setVelocity } from '../physics/adapter';

export interface Projectile {
  /** 唯一 id（用 body.id，同一 World 内全局唯一） */
  id: number;
  team: TeamId;
  body: Body;
  damage: number;
  /** 出生时间（战斗时钟 ms） */
  bornAtMs: number;
  lifetimeMs: number;
}

/**
 * 生成 Projectile 并加入 World。
 * @param velocity 初速度（世界向量，通常沿炮口方向 * projectileSpeed）
 */
export function spawnProjectile(
  world: PhysWorld,
  team: TeamId,
  pos: { x: number; y: number },
  velocity: { x: number; y: number },
  radius: number,
  mass: number,
  damage: number,
  lifetimeMs: number,
  nowMs: number,
): Projectile {
  const enemyCategory = team === 'A' ? Category.VEHICLE_B : Category.VEHICLE_A;
  // mask：只与敌车、Arena 墙、Ground 碰撞；不含自己 team 的 category（不能命中自己）
  const body = createCircle(pos.x, pos.y, radius, mass, {
    filter: {
      category: Category.PROJECTILE,
      mask: enemyCategory | Category.ARENA | Category.GROUND,
    },
    friction: 0,
    restitution: 0, // 不反弹
  });
  setMeta(body, { kind: 'projectile', team });
  setVelocity(body, velocity.x, velocity.y);
  world.add(body);

  return {
    id: body.id,
    team,
    body,
    damage,
    bornAtMs: nowMs,
    lifetimeMs,
  };
}

/** 销毁 Projectile（从 World 移除刚体） */
export function destroyProjectile(world: PhysWorld, p: Projectile): void {
  world.remove(p.body);
}
