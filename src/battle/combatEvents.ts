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

/** 统一 Combat Event：承载 Renderer 所需的全部伤害上下文（W1-EV-1 前身） */
export interface CombatEvent extends DamageRequest {
  hpBefore: number;
  hpAfter: number;
  timestamp: number;
}

/* ---------- W1-EV-1：正式 Battle Event 结构（不改变 Damage 结果） ---------- */

/** 伤害事件：保留现有 CombatEvent 全部字段，增加 type:'damage' 判别 */
export interface DamageEvent extends CombatEvent {
  type: 'damage';
}

/** 开火事件：Cannon 真正创建 projectile 时发出（Hammer/Push 不凑假 fire） */
export interface WeaponFireEvent {
  type: 'weaponFire';
  team: TeamId;
  /** 来源 weapon part 的 OwnerTag.partId（'part:<hardpoint>'） */
  partId: string;
  /** behavior 标识（如 'cannon'） */
  behavior: string;
  worldPosition: Vec2;
  worldDirection: Vec2;
  timestamp: number;
}

/** 死亡事件：HP 首次从 >0 → <=0 时只发一次 */
export interface DeathEvent {
  type: 'death';
  team: TeamId;
  sourceTeam?: TeamId;
  damageSource?: DamageSource;
  timestamp: number;
}

/** 正式 Battle Event 联合（Renderer / VFX / SFX 按 type 判别消费） */
export type BattleEvent = DamageEvent | WeaponFireEvent | DeathEvent;

/** 类型谓词：BattleEvent → DamageEvent（consumer 判别用） */
export function isDamageEvent(ev: BattleEvent): ev is DamageEvent {
  return ev.type === 'damage';
}

/** 类型谓词：BattleEvent → WeaponFireEvent */
export function isWeaponFireEvent(ev: BattleEvent): ev is WeaponFireEvent {
  return ev.type === 'weaponFire';
}

/** 类型谓词：BattleEvent → DeathEvent */
export function isDeathEvent(ev: BattleEvent): ev is DeathEvent {
  return ev.type === 'death';
}

/** 简单事件总线（Runtime → Renderer / Lab）；支持完整 BattleEvent */
export class CombatEventBus {
  private listeners: Array<(ev: BattleEvent) => void> = [];

  subscribe(fn: (ev: BattleEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  emit(ev: BattleEvent): void {
    for (const fn of this.listeners) fn(ev);
  }
}
