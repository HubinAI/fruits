/**
 * F-PRESENT-1｜高频伤害数字聚合（纯 Presentation 逻辑，无 Canvas / 无 Gameplay 依赖）。
 *
 * 问题：机枪 / 喷火器等高频武器每次真实 damage 都触发一个浮动数字，
 * 大量数字同时停留 → 红色数字云遮挡武器主体。
 *
 * 目标：Gameplay / Damage Resolver / HP 完全不变；只把「同一来源的短时间连续伤害」
 * 合并成少量可读数字。
 *
 * 规则：
 * - 分组键 = target + source + (partId ?? behavior ?? damageSource)；
 * - 固定聚合窗口（以「该组第一次命中时间」为起点，不得每次命中无限延长）；
 * - 窗口内命中 → 合并进当前组（累计真实伤害、跟随最新 contactPoint）；
 * - 窗口到期后再命中 → 开启新组（持续攻击仅少量组同时可见）；
 * - 首击立即返回 isNewGroup=true（单发 Cannon/Hammer/Laser 零延迟、不吞数字）；
 * - 聚合只重组「显示」，真实 damage 总量守恒（各组合计 = 全部真实 damage 之和）。
 */
import type { DamageEvent } from '../battle/combatEvents';

/** 聚合后的一次「显示决策」 */
export interface AggregatedDamageView {
  /** 该组累计真实伤害（= 组内所有真实 damage 四舍五入之和） */
  accumulatedDamage: number;
  /** 最新真实 contactPoint（聚合数字位置跟随） */
  x: number;
  y: number;
  /** 分组键（同一来源连续命中相同） */
  groupKey: string;
  /** 该组首次命中时间（ms），窗口起点 */
  windowStart: number;
  /** true=本次为新建浮动数字（首击 / 窗口到期）；false=合并进已有组（原地更新） */
  isNewGroup: boolean;
  /** F-BATTLE-PRESENTATION-R2：本次命中是否为「重要伤害」（单次大额）→ 渲染提高层级（放大+高亮） */
  important: boolean;
}

interface GroupState {
  windowStart: number;
  accumDamage: number;
}

/**
 * F-BATTLE-PRESENTATION-R2：单次大额伤害阈值——达到即视为「重要伤害」，渲染层提高层级
 * （放大字号 + 高亮），让 Cannon/Hammer 等重击从高频小伤害中脱颖而出（Must#8 重要伤害提高层级）。
 * 纯展示阈值，不改 Damage Resolver / 武器参数 / 命中判定。
 */
export const BIG_HIT_THRESHOLD = 15;

export class DamageNumberAggregator {
  private groups = new Map<string, GroupState>();

  constructor(private readonly windowMs: number) {}

  /** 分组键：优先 partId，缺失再退化到 behavior / damageSource */
  static groupKey(ev: DamageEvent): string {
    const sub = ev.partId ?? ev.behavior ?? ev.damageSource;
    return `${ev.target}|${ev.source}|${sub}`;
  }

  /**
   * 喂入一次真实 damage event，返回应显示的聚合视图。
   * 不合并真实伤害事件、不改 HP；仅决定「显示什么 / 是否新建数字」。
   */
  feed(ev: DamageEvent, nowMs: number): AggregatedDamageView {
    const dmg = Math.round(ev.damage);
    const important = ev.damage >= BIG_HIT_THRESHOLD;
    const key = DamageNumberAggregator.groupKey(ev);
    const existing = this.groups.get(key);
    // 窗口以该组首次命中时间为起点；窗口内 → 合并进当前组
    if (existing && nowMs - existing.windowStart < this.windowMs) {
      existing.accumDamage += dmg;
      return {
        accumulatedDamage: existing.accumDamage,
        x: ev.contactPoint.x,
        y: ev.contactPoint.y,
        groupKey: key,
        windowStart: existing.windowStart,
        isNewGroup: false,
        important,
      };
    }
    // F-BATTLE-PRESENTATION-R2：同一车辆同时最多 2 组浮动数字（Must#8）。
    // 若该 target 已有 ≥2 组「窗口内活跃」数字，则合并进最旧活跃组（不新建数字），
    // 避免多武器同时命中产生 >2 组数字云遮挡车辆主体；连续小伤害仍走窗口合并。
    const targetActive = [...this.groups.entries()].filter(
      ([k, g]) => k.split('|')[0] === ev.target && nowMs - g.windowStart < this.windowMs,
    );
    if (targetActive.length >= 2) {
      targetActive.sort((a, b) => a[1].windowStart - b[1].windowStart);
      const [mergeKey, mergeG] = targetActive[0];
      mergeG.accumDamage += dmg;
      return {
        accumulatedDamage: mergeG.accumDamage,
        x: ev.contactPoint.x,
        y: ev.contactPoint.y,
        groupKey: mergeKey,
        windowStart: mergeG.windowStart,
        isNewGroup: false,
        important,
      };
    }
    // 新组：首击或窗口到期 → 立即新建（不延迟）
    this.groups.set(key, { windowStart: nowMs, accumDamage: dmg });
    return {
      accumulatedDamage: dmg,
      x: ev.contactPoint.x,
      y: ev.contactPoint.y,
      groupKey: key,
      windowStart: nowMs,
      isNewGroup: true,
      important,
    };
  }

  /** 测试 / 调试：当前活跃分组数（按 key） */
  get activeGroupCount(): number {
    return this.groups.size;
  }
}
