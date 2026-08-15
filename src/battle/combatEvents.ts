/**
 * Combat Event 统一结构 + 事件总线。
 *
 * Renderer 只能消费 Runtime 结果（Combat Event），不得自行决定 Gameplay。
 */
import type { TeamId, Vec2 } from '../core/types';

/** 伤害来源类别 */
export type DamageSource = 'impact' | 'weapon' | 'hazard';

/** 一次伤害请求（进入 Damage Resolver 前） */
export interface DamageRequest {
  source: TeamId;
  target: TeamId;
  damageSource: DamageSource;
  /** 触发伤害的 part（如 ramHead 对应的 hardpoint / 部件 id） */
  partId?: string;
  /** 触发伤害的 behavior（如 'ram'） */
  behavior?: string;
  contactPoint: Vec2;
  contactNormal: Vec2;
  relativeVelocity: number;
  damage: number;
}

/** 统一 Combat Event：承载 Renderer 所需的全部伤害上下文 */
export interface CombatEvent extends DamageRequest {
  hpBefore: number;
  hpAfter: number;
  timestamp: number;
}

/** 简单事件总线（Runtime → Renderer / Lab） */
export class CombatEventBus {
  private listeners: Array<(ev: CombatEvent) => void> = [];

  subscribe(fn: (ev: CombatEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  emit(ev: CombatEvent): void {
    for (const fn of this.listeners) fn(ev);
  }
}
