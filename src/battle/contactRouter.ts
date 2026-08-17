/**
 * Contact Router：Physics Contact 的统一入口。
 *
 * 每个 Content 不需要自己找敌人 / 判断接触；所有接触统一进入本模块，
 * 识别 Owner / Part，并路由到：
 * - Grounded 检测（wheel ↔ ground）；
 * - Impact（vehicle ↔ vehicle，达到阈值才产生有限伤害，重复触发保护）；
 * - Direct Weapon Damage（weapon part ↔ 敌车，真实有效接触）。
 */
import type { ContactEvent } from '../physics/adapter';
import { getMeta } from '../physics/adapter';
import type { Vehicle, WheelRuntime, PartRuntime } from './vehicleAssembly';
import type { DamageResolver } from './damageResolver';

/** Impact 配置 */
export interface ImpactConfig {
  /** 相对速度阈值：低于此值视为低速挤压，不掉血 */
  threshold: number;
  /** 超过阈值后，每单位速度对应的伤害 */
  damagePerSpeed: number;
  /** 单次 Impact 伤害上限 */
  maxDamage: number;
}

/** Contact Router 最近事件记录（供 Debug 显示） */
export interface ContactDebugState {
  lastContact: {
    point: { x: number; y: number };
    normal: { x: number; y: number };
    relativeVelocity: number;
  } | null;
  lastImpact: {
    damage: number;
    point: { x: number; y: number };
    relativeVelocity: number;
  } | null;
  lastDamage: { damage: number; target: string } | null;
}

export const DEFAULT_IMPACT_CONFIG: ImpactConfig = {
  threshold: 6,
  damagePerSpeed: 0.5,
  maxDamage: 120,
};

export class ContactRouter {
  readonly debug: ContactDebugState = {
    lastContact: null,
    lastImpact: null,
    lastDamage: null,
  };

  constructor(
    private vehicles: Vehicle[],
    private damageResolver: DamageResolver,
    private impactConfig: ImpactConfig = DEFAULT_IMPACT_CONFIG,
  ) {}

  /** 按 team 唯一查找 Vehicle（一个 battle 内每个 team 至多一辆车） */
  private findVehicleByTeam(team: string): Vehicle | undefined {
    return this.vehicles.find((v) => v.team === team);
  }

  private findWheel(v: Vehicle, partId: string): WheelRuntime | undefined {
    return v.wheels.find((w) => `wheel:${w.id}` === partId);
  }

  private findPart(v: Vehicle, partId: string): PartRuntime | undefined {
    return v.parts.find((p) => `part:${p.id}` === partId);
  }

  /** 处理一次接触事件 */
  handleContact(ev: ContactEvent): void {
    const mA = getMeta(ev.bodyA);
    const mB = getMeta(ev.bodyB);

    this.debug.lastContact = {
      point: ev.contactPoint,
      normal: ev.normal,
      relativeVelocity: ev.relativeVelocity,
    };

    this.handleGrounded(ev, mA, mB);
    this.handleVehicleContact(ev, mA, mB);
  }

  /** wheel ↔ ground：维护 grounded 状态 */
  private handleGrounded(
    ev: ContactEvent,
    mA: Record<string, unknown>,
    mB: Record<string, unknown>,
  ): void {
    const groundA = mA.kind === 'ground';
    const groundB = mB.kind === 'ground';
    if (!(groundA || groundB)) return;

    const wheelMeta = groundA ? mB : mA;
    const groundMeta = groundA ? mA : mB;
    void groundMeta;

    if (wheelMeta.kind !== 'vehicle') return;
    const partId = String(wheelMeta.partId ?? '');
    if (!partId.startsWith('wheel:')) return;

    const v = this.findVehicleByTeam(String(wheelMeta.team));
    if (!v) return;
    const wheel = this.findWheel(v, partId);
    if (!wheel) return;

    // start/active → 接地；end → 离地
    if (ev.phase === 'end') {
      wheel.grounded = false;
    } else {
      wheel.grounded = true;
    }
  }

  /** vehicle ↔ vehicle：Impact + Direct Weapon Damage */
  private handleVehicleContact(
    ev: ContactEvent,
    mA: Record<string, unknown>,
    mB: Record<string, unknown>,
  ): void {
    if (mA.kind !== 'vehicle' || mB.kind !== 'vehicle') return;

    const teamA = mA.team as string;
    const teamB = mB.team as string;
    if (teamA === teamB) return; // 同队（或同车）不产生敌我伤害

    const va = this.findVehicleByTeam(String(mA.team));
    const vb = this.findVehicleByTeam(String(mB.team));
    if (!va || !vb) return;

    const partIdA = String(mA.partId ?? '');
    const partIdB = String(mB.partId ?? '');

    // 只有 collisionStart 产生伤害（重复触发保护：持续贴合不重复扣血；
    // 分离后再次接触会重新触发 collisionStart）
    if (ev.phase !== 'start') return;

    // Impact：达到阈值才产生有限伤害
    if (ev.relativeVelocity >= this.impactConfig.threshold) {
      const speedOver = ev.relativeVelocity - this.impactConfig.threshold;
      const damage = Math.min(
        this.impactConfig.maxDamage,
        Math.max(0, speedOver * this.impactConfig.damagePerSpeed),
      );
      if (damage > 0) {
        // 质量差异：较轻一方承受更多伤害（基于相对速度，双方各自承担）
        // 简单分配：双方各承受一半（Impact 为次级伤害来源）
        this.damageResolver.applyDamage(va, {
          source: vb.team,
          target: va.team,
          damageSource: 'impact',
          contactPoint: ev.contactPoint,
          contactNormal: ev.normal,
          relativeVelocity: ev.relativeVelocity,
          damage: damage / 2,
        }, 0);
        this.damageResolver.applyDamage(vb, {
          source: va.team,
          target: vb.team,
          damageSource: 'impact',
          contactPoint: ev.contactPoint,
          contactNormal: { x: -ev.normal.x, y: -ev.normal.y },
          relativeVelocity: ev.relativeVelocity,
          damage: damage / 2,
        }, 0);
        this.debug.lastImpact = {
          damage,
          point: ev.contactPoint,
          relativeVelocity: ev.relativeVelocity,
        };
      }
    }

    // Direct Weapon Damage：ramHead 等 weapon part 的真实有效接触
    this.handleWeaponContact(ev, va, vb, partIdA, partIdB, 'A');
    this.handleWeaponContact(ev, vb, va, partIdB, partIdA, 'B');
  }

  private handleWeaponContact(
    ev: ContactEvent,
    attacker: Vehicle,
    defender: Vehicle,
    attackerPartId: string,
    _defenderPartId: string,
    _side: string,
  ): void {
    if (!attackerPartId.startsWith('part:')) return;
    const part = this.findPart(attacker, attackerPartId);
    if (!part) return;
    if (part.def.category !== 'weapon') return;

    // 只有行为能造成直接伤害的武器才处理（ram 用 baseDamage，hammer 用 damage）
    const params = part.def.behaviorParams as Record<string, unknown> | undefined;
    const baseDamage = ((params?.damage as number) ?? (params?.baseDamage as number) ?? 0);
    if (baseDamage <= 0) return;

    // 有效接触判定（避免贴合时持续扣血）：
    // - hammer（挥击武器）：以 swinging 状态判断「挥击中」（Matter 软约束快速衰减角速度，不能可靠用 av 阈值）；
    // - 其他接触武器（ram）：相对速度达标才算有效撞击。
    if (part.def.behavior === 'hammer') {
      if (part.swinging <= 0) return; // 未在挥击
    } else if (ev.relativeVelocity < 2) {
      return;
    }

    this.damageResolver.applyDamage(defender, {
      source: attacker.team,
      target: defender.team,
      damageSource: 'weapon',
      partId: part.def.id,
      behavior: part.def.behavior,
      contactPoint: ev.contactPoint,
      contactNormal: ev.normal,
      relativeVelocity: ev.relativeVelocity,
      damage: baseDamage,
    }, 0);
    this.debug.lastDamage = {
      damage: baseDamage,
      target: defender.id,
    };
  }
}
