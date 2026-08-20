/**
 * Battle Phase FX（W2-FX-2）：阶段级表现所需的纯逻辑（可测，不依赖 DOM / Canvas）。
 *
 * - 阶段倒计时：Warning 剩余时间 → 3/2/1 数字（表现层轮询，不读 Physics 规则）；
 * - Death 定格调度：表现层短暂冻结战斗推进（timeScale=0）后再恢复，禁止修改
 *   Gameplay / Physics 时间语义（不改变 FIXED_DT / 阶段时钟 / 伤害计时）；
 * - 伤害反馈配色：weapon / impact / hazard 各自反馈样式（hazard 专属刺伤区分）。
 */
import type { DamageSource } from '../battle/combatEvents';

/** 阶段剩余时间（ms）：End=0；其余 clamp ≥0（durationMs = 该阶段固定时长） */
export function phaseRemainingMs(
  phase: string,
  durationMs: number,
  elapsedMs: number,
): number {
  if (phase === 'End') return 0;
  return Math.max(0, durationMs - elapsedMs);
}

/** Warning 数字倒计时（3 → 2 → 1）：ceil(秒)；remaining ≤ 0 → ''（进 Closing 后隐藏） */
export function warningCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return '';
  return String(Math.min(9, Math.max(1, Math.ceil(remainingMs / 1000))));
}

/**
 * Death 定格调度（表现层）：死亡瞬间冻结战斗推进（timeScale=0）80~120ms 再恢复。
 * - 只管理「何时恢复」的调度状态；timeScale 的实际存取由调用方（main.ts）执行；
 * - 多次死亡以最后一次为准（resumeAt 覆盖）；
 * - 注入 now() 便于测试（默认 performance.now）。
 */
export class DeathPauseScheduler {
  private resumeAt: number | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** 触发定格（pauseMs 为表现层时长，建议 80~120） */
  trigger(pauseMs: number): void {
    this.resumeAt = this.now() + pauseMs;
  }

  /** 是否正处于定格窗口内（战斗应保持冻结） */
  frozen(): boolean {
    return this.resumeAt !== null && this.now() < this.resumeAt;
  }

  /** 是否已到达恢复时刻 */
  shouldResume(): boolean {
    return this.resumeAt !== null && this.now() >= this.resumeAt;
  }

  /** 是否存在活跃定格 */
  get active(): boolean {
    return this.resumeAt !== null;
  }

  /** 恢复完成：清空调度 */
  clear(): void {
    this.resumeAt = null;
  }
}

/** 伤害反馈配色（统一入口）：damageSource → 数字色 / 火花色（hazard 专属刺伤区分） */
export function damageFeedbackColors(source: DamageSource): {
  number: string;
  spark: string;
} {
  if (source === 'hazard') return { number: '#ff3b3b', spark: '#ff5a4e' };
  if (source === 'weapon') return { number: '#ff5a4e', spark: '#ffd35a' };
  return { number: '#ffb84e', spark: '#ffd35a' }; // impact
}

/**
 * 死亡车辆表现状态：未死亡 → 1（正常绘制）；淡出中 → 0..1 alpha；
 * 已消失（超 ttl）→ null（跳过绘制）。
 */
export function vehicleDeathAlpha(
  deaths: ReadonlyArray<{ team: string; bornAt: number; ttl: number }>,
  team: string,
  nowMs: number,
): number | null {
  let latest: { bornAt: number; ttl: number } | null = null;
  for (const d of deaths) {
    if (d.team !== team) continue;
    if (!latest || d.bornAt > latest.bornAt) latest = d;
  }
  if (!latest) return 1; // 未死亡：正常绘制
  const age = nowMs - latest.bornAt;
  if (age >= latest.ttl) return null; // 已消失：跳过绘制
  return Math.max(0, 1 - age / latest.ttl); // 淡出 alpha
}
