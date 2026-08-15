/**
 * Damage Resolver：统一扣血入口，产生 Combat Event。
 *
 * Damage 与 Force 保持独立：本模块只扣 HP，不施加 Knockback。
 * Knockback 由碰撞的真实 Impulse 自然产生，禁止「Damage 数值直接映射 Knockback」。
 */
import type { TeamId, Vec2 } from '../core/types';
import type { CombatEvent, DamageRequest, CombatEventBus } from './combatEvents';
import type { Vehicle } from './vehicleAssembly';

export class DamageResolver {
  constructor(private bus: CombatEventBus) {}

  /** 对某个 Vehicle 扣血，返回生成的 CombatEvent */
  applyDamage(
    target: Vehicle,
    req: DamageRequest,
    timestamp: number,
  ): CombatEvent {
    const hpBefore = target.hp;
    const damage = Math.max(0, req.damage);
    target.hp = Math.max(0, hpBefore - damage);

    const ev: CombatEvent = {
      ...req,
      hpBefore,
      hpAfter: target.hp,
      timestamp,
    };
    this.bus.emit(ev);
    return ev;
  }
}

/** 便捷类型：无 Damage Resolver 依赖的纯函数（供测试） */
export function computeHpAfter(hpBefore: number, damage: number): number {
  return Math.max(0, hpBefore - Math.max(0, damage));
}

export type { TeamId, Vec2 };
