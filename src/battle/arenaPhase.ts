/**
 * 引擎中立 Arena 阶段时钟（Queue F-02M-B11A）。
 *
 * 严格复现现有 ArenaRuntime（src/battle/arenaRuntime.ts）的阶段语义，
 * 但不依赖任何物理引擎 / ArenaRuntime：
 * - Active → Warning → Closing → End；
 * - `>=` 判定；每次调用最多跨越一个阶段；
 * - 转换后 elapsed 清零，不继承溢出时间；End 后保持不变。
 *
 * 约束：仅依赖 `BattlePhase` 类型；禁止导入 Matter、Planck、adapter、ArenaRuntime。
 */
import type { BattlePhase } from '../core/types';

/** 阶段时长（ms）—— 默认值与 ArenaRuntime DEFAULT_ARENA.phases 一致 */
export interface ArenaPhaseDurations {
  activeMs: number;
  warningMs: number;
  closingMs: number;
}

/** 单次 update 的阶段更新结果 */
export interface ArenaPhaseUpdate {
  previous: BattlePhase;
  current: BattlePhase;
  changed: boolean;
}

/** 引擎中立 Arena 阶段时钟 */
export class ArenaPhaseClock {
  readonly durations: ArenaPhaseDurations;
  private _phase: BattlePhase = 'Active';
  private _elapsedMs = 0;

  constructor(durations?: Partial<ArenaPhaseDurations>) {
    this.durations = {
      activeMs: durations?.activeMs ?? 10_000,
      warningMs: durations?.warningMs ?? 3_000,
      closingMs: durations?.closingMs ?? 5_000,
    };
  }

  get phase(): BattlePhase {
    return this._phase;
  }

  get elapsedMs(): number {
    return this._elapsedMs;
  }

  /** 推进阶段计时；最多跨越一个阶段；转换后 elapsed 清零 */
  update(dtMs: number): ArenaPhaseUpdate {
    const previous = this._phase;
    if (this._phase === 'End') {
      // End 后保持不变
      return { previous, current: this._phase, changed: false };
    }
    this._elapsedMs += dtMs;
    const p = this.durations;
    if (this._phase === 'Active' && this._elapsedMs >= p.activeMs) {
      this._phase = 'Warning';
      this._elapsedMs = 0;
    } else if (this._phase === 'Warning' && this._elapsedMs >= p.warningMs) {
      this._phase = 'Closing';
      this._elapsedMs = 0;
    } else if (this._phase === 'Closing' && this._elapsedMs >= p.closingMs) {
      this._phase = 'End';
      this._elapsedMs = 0;
    }
    return { previous, current: this._phase, changed: previous !== this._phase };
  }

  /** 强制设置阶段并清零 elapsed（无物理副作用） */
  setPhase(phase: BattlePhase): void {
    this._phase = phase;
    this._elapsedMs = 0;
  }
}
