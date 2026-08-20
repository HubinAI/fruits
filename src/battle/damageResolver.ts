/**
 * Damage Resolver：统一扣血入口，产生 Combat Event。
 *
 * Damage 与 Force 保持独立：本模块只扣 HP，不施加 Knockback。
 * Knockback 由碰撞的真实 Impulse 自然产生，禁止「Damage 数值直接映射 Knockback」。
 */
import type { TeamId, Vec2 } from '../core/types';
import type {
  BattleEvent,
  DamageEvent,
  DamageRequest,
  DeathEvent,
  CombatEventBus,
} from './combatEvents';
import type { CombatVehicleState } from './combatVehicle';

export class DamageResolver {
  constructor(private bus: CombatEventBus) {}

  /**
   * 对某个战斗车辆（引擎中立契约）扣血，返回生成的 DamageEvent。
   * W1-EV-1：emit 统一 BattleEvent——DamageEvent(type:'damage'，原字段完整) +
   * HP 首次从 >0 → <=0 时追加一次 DeathEvent（只发一次，不重复）。
   */
  applyDamage(
    target: CombatVehicleState,
    req: DamageRequest,
    timestamp: number,
  ): DamageEvent {
    const hpBefore = target.hp;
    const damage = Math.max(0, req.damage);
    target.hp = Math.max(0, hpBefore - damage);
    const hpAfter = target.hp;

    const ev: DamageEvent = {
      ...req,
      hpBefore,
      hpAfter,
      timestamp,
      type: 'damage',
    };
    this.bus.emit(ev);

    // 死亡只发一次：仅当本次扣血使 HP 首次跨越 0（之后 hp<=0 不再满足 hpBefore>0）
    if (hpBefore > 0 && hpAfter <= 0) {
      const death: DeathEvent = {
        type: 'death',
        team: target.team,
        sourceTeam: req.source,
        damageSource: req.damageSource,
        timestamp,
      };
      this.bus.emit(death);
    }
    return ev;
  }
}

/** 便捷类型：无 Damage Resolver 依赖的纯函数（供测试） */
export function computeHpAfter(hpBefore: number, damage: number): number {
  return Math.max(0, hpBefore - Math.max(0, damage));
}

export type { TeamId, Vec2, BattleEvent };
