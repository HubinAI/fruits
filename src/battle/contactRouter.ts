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

/** 同一物理步（batch）内的一条 start 事件快照（含 meta，供合并后统一结算） */
interface BatchEntry {
  ev: ContactEvent;
  mA: Record<string, unknown>;
  mB: Record<string, unknown>;
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

/**
 * Impact 有效接触阈值（F-02I-D/D2/A1R 诊断标定，2026-08-17）：
 * 正式 Runtime 中正常车体碰撞首次 batch 最大 relVel = 1.574～2.205。
 * 有效 body-only 低速对照（整车平移、表面间距 4px）最大 relVel = 0.458；
 * 另有带 Ram 的低速对照 relVel = 0.099。旧阈值 6 远高于正常碰撞区间。
 * 标定 0.75：比正常下限低约 52%，比有效 body-only 低速上限高约 64%。
 */
export const IMPACT_CONTACT_THRESHOLD = 0.75;

export const DEFAULT_IMPACT_CONFIG: ImpactConfig = {
  threshold: IMPACT_CONTACT_THRESHOLD,
  damagePerSpeed: 0.5,
  maxDamage: 120,
};

/**
 * Weapon 有效接触阈值（F-02W-D 诊断标定，2026-08-17）：
 * 正式 Runtime 中正常 Ram 攻击的首次接触速度为 1.114～1.795（对轻/重目标），
 * 低速擦碰对照为 0.099。旧值 2 高于正常攻击上限导致 baseDamage=80 完全无法触发。
 * 标定 0.5：对正常攻击下限（1.114）保留 55% 余量，对低速对照（0.099）保留 5 倍余量，
 * 位于诊断候选区间 [0.119, 0.891] 内。
 */
export const WEAPON_CONTACT_THRESHOLD = 0.5;

export class ContactRouter {
  readonly debug: ContactDebugState = {
    lastContact: null,
    lastImpact: null,
    lastDamage: null,
  };

  /**
   * 正在收集的碰撞批次（带 batch 的 start 事件）。
   * 严格按 timestamp 隔离：index=0 无条件重建；index>0 仅在
   * timestamp/size/连续性(index===entries.length)全部一致时接收；
   * 批次完整（index===size-1 且 entries.length===size）才统一结算并清空。
   */
  private batchBuffer: {
    timestamp: number;
    size: number;
    entries: BatchEntry[];
  } | null = null;

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

    // Grounded 始终立即执行（wheel ↔ ground 状态与伤害结算无关）
    this.handleGrounded(ev, mA, mB);

    // 带 batch 的 start：同一物理步的多个 collisionStart pair 先收集、
    // 批次末尾统一合并结算（Impact / 同一武器对同一敌车只结算一次）。
    // 无 batch 的 start、active、end：保持原单事件处理（active/end 本就不产生伤害）。
    if (ev.phase === 'start' && ev.batch) {
      this.collectBatch(ev, mA, mB);
      return;
    }
    this.handleVehicleContact(ev, mA, mB);
  }

  /**
   * 收集批次事件（严格隔离，异常/残缺批次不得参与伤害结算）。
   * - index=0：无条件丢弃任何旧 buffer，以当前 timestamp/size 重建；
   * - index>0：仅当 buffer 存在、timestamp 相同、size 相同、index===entries.length
   *   时接收；任一不符 → 清空 buffer，本条不结算，且不走无 batch fallback；
   * - 仅当 index===size-1 且 entries.length===size 时调用 processBatch，随后清空。
   */
  private collectBatch(
    ev: ContactEvent,
    mA: Record<string, unknown>,
    mB: Record<string, unknown>,
  ): void {
    const batch = ev.batch!;

    if (batch.index === 0) {
      // 新批次开始：无条件丢弃旧 buffer（残缺/污染批次不得延续到新批）
      this.batchBuffer = {
        timestamp: batch.timestamp,
        size: batch.size,
        entries: [],
      };
    } else {
      const buf = this.batchBuffer;
      const consistent =
        buf !== null &&
        buf.timestamp === batch.timestamp &&
        buf.size === batch.size &&
        batch.index === buf.entries.length;
      if (!consistent) {
        // 异常/残缺/跨批事件：清空 buffer，本条不结算，不落 fallback
        this.batchBuffer = null;
        return;
      }
    }

    const buf = this.batchBuffer!;
    buf.entries.push({ ev, mA, mB });

    // 批次完整（index 到 size-1 且条目数等于 size）才统一结算，随后无论成败清空
    if (batch.index === batch.size - 1 && buf.entries.length === batch.size) {
      const entries = buf.entries;
      this.batchBuffer = null;
      this.processBatch(entries);
    }
  }

  /**
   * 统一处理一整批 collisionStart：
   * - Impact：每对敌车（无序 team 对）只结算一次，取该对 relativeVelocity 最大的事件；
   * - Weapon：同一武器（attacker team + partId）对同一敌车只结算一次，取最大 relativeVelocity；
   *   不同武器仍可各自结算一次。
   * 阈值 / 伤害公式 / Impact 与 Weapon 可同时成立 的规则全部保留。
   */
  private processBatch(entries: BatchEntry[]): void {
    const hostile = entries.filter(
      ({ mA, mB }) =>
        mA.kind === 'vehicle' &&
        mB.kind === 'vehicle' &&
        mA.team !== mB.team,
    );
    if (hostile.length === 0) return;

    // --- Impact 合并（无序 team 对） ---
    const impactByKey = new Map<string, BatchEntry>();
    for (const en of hostile) {
      const key = [String(en.mA.team), String(en.mB.team)].sort().join('|');
      const cur = impactByKey.get(key);
      if (!cur || en.ev.relativeVelocity > cur.ev.relativeVelocity) {
        impactByKey.set(key, en);
      }
    }
    for (const en of impactByKey.values()) {
      const va = this.findVehicleByTeam(String(en.mA.team));
      const vb = this.findVehicleByTeam(String(en.mB.team));
      if (!va || !vb) continue;
      this.applyImpact(va, vb, en.ev);
    }

    // --- Weapon 合并（attacker team + partId + defender team，两个方向） ---
    const weaponByKey = new Map<
      string,
      BatchEntry & { attacker: Vehicle; defender: Vehicle; attackerPartId: string }
    >();
    const addWeapon = (
      attacker: Vehicle,
      defender: Vehicle,
      attackerPartId: string,
      en: BatchEntry,
    ): void => {
      if (!attackerPartId.startsWith('part:')) return;
      const key = `${attacker.team}|${attackerPartId}|${defender.team}`;
      const cur = weaponByKey.get(key);
      if (!cur || en.ev.relativeVelocity > cur.ev.relativeVelocity) {
        weaponByKey.set(key, { ...en, attacker, defender, attackerPartId });
      }
    };
    for (const en of hostile) {
      const va = this.findVehicleByTeam(String(en.mA.team));
      const vb = this.findVehicleByTeam(String(en.mB.team));
      if (!va || !vb) continue;
      const partIdA = String(en.mA.partId ?? '');
      const partIdB = String(en.mB.partId ?? '');
      addWeapon(va, vb, partIdA, en); // A 的 part 攻击 B
      addWeapon(vb, va, partIdB, en); // B 的 part 攻击 A
    }
    for (const w of weaponByKey.values()) {
      this.handleWeaponContact(w.ev, w.attacker, w.defender, w.attackerPartId, '', 'B');
    }
  }

  /**
   * Impact 结算（阈值 / damagePerSpeed / maxDamage 保持正式值不变）。
   * 只有 relativeVelocity 达阈值的批次事件会走到这里（processBatch 已选最大者）。
   */
  private applyImpact(va: Vehicle, vb: Vehicle, ev: ContactEvent): void {
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

    // Impact：达到阈值才产生有限伤害（无 batch 单事件路径，逻辑与批量版共用）
    this.applyImpact(va, vb, ev);

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

    // 只有行为能造成直接伤害的武器才处理
    const baseDamage = (part.def.behaviorParams?.baseDamage as number) ?? 0;
    if (baseDamage <= 0) return;

    // 武器伤害要求真实有效接触（相对速度达标，避免贴合时持续扣血）。
    // 阈值来自 WEAPON_CONTACT_THRESHOLD（F-02W-D 标定 0.5）：正常攻击 1.114~1.795、
    // 低速擦碰 0.099，0.5 可稳定区分两者。
    if (ev.relativeVelocity < WEAPON_CONTACT_THRESHOLD) return;

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
