/**
 * Battle Presentation Controller（W2-FX-1）：BattleEvent → Presentation 统一消费层。
 *
 * - Runtime 只产出 BattleEvent（damage / weaponFire / death，W1-EV-1 已冻结）；
 *   本控制器是正式表现层唯一事件消费入口：把每个事件分派到 8 个可选 hook；
 * - Weapon Behavior 一律不得直接操作 DOM/audio；Renderer 只负责「画」，不决定表现映射；
 * - 所有 hook 缺省 = 无操作 → FX/SFX 可因无资源安全 skip（不抛错、不影响战斗）；
 * - 幂等绑定：bind() 重复调用先解绑旧订阅（同一事件绝不重复播放）；
 *   stop() 解绑（Preview / Clear / 战斗结束不再消费）。
 */
import {
  isDamageEvent,
  isDeathEvent,
  isWeaponChargeEvent,
  isWeaponFireEvent,
  type BattleEvent,
  type DamageEvent,
  type DeathEvent,
  type WeaponChargeEvent,
  type WeaponFireEvent,
} from '../battle/combatEvents';

/** 表现层事件源（BattleOrchestratorApi.onCombatEvent 适配；返回解除订阅函数） */
export interface BattleEventSource {
  onEvent(cb: (ev: BattleEvent) => void): () => void;
}

/** 8 个表现 hook：全部可选，缺省 no-op（安全 skip） */
export interface BattlePresentationHooks {
  /** weaponFire → 炮口闪光（有真实 worldPosition/worldDirection） */
  onMuzzleFlash?: (ev: WeaponFireEvent) => void;
  /** weaponFire → 开火音效 */
  onFireSound?: (ev: WeaponFireEvent) => void;
  /** damage → 命中闪白（目标车辆） */
  onHitFlash?: (ev: DamageEvent) => void;
  /** damage → 命中火花（contactPoint） */
  onHitSpark?: (ev: DamageEvent) => void;
  /** damage → 命中音效 */
  onDamageSound?: (ev: DamageEvent) => void;
  /** damage → 伤害数字（统一入口：所有伤害数字都经此 hook，Renderer 复用同一数字池） */
  onDamageNumber?: (ev: DamageEvent) => void;
  /** death → 死亡 FX（首次 >0 → <=0 只发一次） */
  onDeathFx?: (ev: DeathEvent) => void;
  /** death → 死亡音效 */
  onDeathSound?: (ev: DeathEvent) => void;
  /** Q11-C：weaponCharge → 蓄能光点（progress 0→1 每固定步 upsert；肉眼可见大招前摇） */
  onWeaponCharge?: (ev: WeaponChargeEvent) => void;
  /** Q11-C：weaponFire（laser）→ 清除该部件蓄能光点（发射完成） */
  onWeaponChargeEnd?: (ev: WeaponFireEvent) => void;
}

export class BattlePresentationController {
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly hooks: BattlePresentationHooks = {}) {}

  /** 是否已绑定事件源（供 UI/测试判断 Preview 不消费 / Fighting 才消费） */
  get bound(): boolean {
    return this.unsubscribe !== null;
  }

  /** 幂等绑定：先解绑旧订阅再订阅新源（同事件不重复播放） */
  bind(source: BattleEventSource): void {
    this.stop();
    this.unsubscribe = source.onEvent((ev) => this.handle(ev));
  }

  /** 解绑：不再消费任何 Battle Event */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /** 事件分派：每个事件恰好走一次对应表现路径（无 per-weapon 独立生命周期） */
  private handle(ev: BattleEvent): void {
    if (isWeaponFireEvent(ev)) {
      this.hooks.onMuzzleFlash?.(ev);
      this.hooks.onFireSound?.(ev);
      // Q11-C：laser 发射完成 → 清除该部件蓄能光点
      if (ev.behavior === 'laser') this.hooks.onWeaponChargeEnd?.(ev);
      return;
    }
    if (isWeaponChargeEvent(ev)) {
      // Q11-C：蓄能表现（纯视觉，不参与伤害判定）
      this.hooks.onWeaponCharge?.(ev);
      return;
    }
    if (isDamageEvent(ev)) {
      // 命中闪白：接触即反馈（与旧 renderer.bind 语义一致）
      this.hooks.onHitFlash?.(ev);
      // 火花 / 音效 / 伤害数字：只有真实伤害才播放
      if (ev.damage > 0) {
        this.hooks.onHitSpark?.(ev);
        this.hooks.onDamageSound?.(ev);
        this.hooks.onDamageNumber?.(ev);
      }
      return;
    }
    if (isDeathEvent(ev)) {
      this.hooks.onDeathFx?.(ev);
      this.hooks.onDeathSound?.(ev);
    }
  }
}
