/**
 * Q28｜V0.7 基础事件埋点接口。
 *
 * 设计约束（来自 Queue 验收）：
 * - 统一入口 `track(event, payload)`；业务层只依赖本模块的 `track` 与事件名，
 *   不直接依赖任何具体平台 SDK（第三方接管通过 `setPlatformAdapter` 后续插入）。
 * - DEV / TEST（ANALYTICS_DEV 或测试强制）：console + 内存 sink，便于本地观察与测试。
 * - PROD：默认 no-op（不联网、不上传、不采集完整存档、不含个人隐私）；
 *   后续如需平台上报，调用 `setPlatformAdapter(sink)` 接管即可。
 * - payload 保持最小、可解释：仅平铺原始标量/小对象，禁止函数与隐私字段。
 * - 不引入任何第三方 dependency。
 */

import { ANALYTICS_DEV } from './env';

/** 核心事件名（统一枚举） */
export type AnalyticsEvent =
  | 'game_start'
  | 'garage_enter'
  | 'build_change'
  | 'find_opponent'
  | 'battle_start'
  | 'battle_end'
  | 'reward_gain'
  | 'part_equip'
  | 'merge_attempt'
  | 'merge_success'
  | 'rank_change';

/** 一条已落盘（或待上报）的事件记录 */
export interface AnalyticsRecord {
  event: AnalyticsEvent;
  payload: Record<string, unknown>;
  /** 触发时刻（ms 时间戳）。 */
  t: number;
}

/** Sink 接口：事件出口。业务层不感知具体实现。 */
export interface AnalyticsSink {
  emit(rec: AnalyticsRecord): void;
}

/** 内存 Sink（DEV）：保留事件序列供测试 / 本地排查。 */
export class MemorySink implements AnalyticsSink {
  readonly events: AnalyticsRecord[] = [];
  emit(rec: AnalyticsRecord): void {
    this.events.push(rec);
  }
  clear(): void {
    this.events.length = 0;
  }
}

/** console Sink（DEV）：本地可读。 */
class ConsoleSink implements AnalyticsSink {
  emit(rec: AnalyticsRecord): void {
    // 仅 DEV 输出；不抛错、不影响主流程。
    try {
      // eslint-disable-next-line no-console
      console.debug(`[analytics] ${rec.event}`, rec.payload);
    } catch {
      /* ignore */
    }
  }
}

/** PROD 默认出口：什么都不做（不联网、不上传）。 */
class NoopSink implements AnalyticsSink {
  emit(_rec: AnalyticsRecord): void {
    /* no-op */
  }
}

const noopSink = new NoopSink();
const consoleSink = new ConsoleSink();
/** 共享内存 Sink（仅 DEV 喂食），测试可读。 */
export const memorySink = new MemorySink();

/** 后续平台上报 adapter 接入点（PROD 可选接管）。 */
let platformAdapter: AnalyticsSink | null = null;
export function setPlatformAdapter(s: AnalyticsSink | null): void {
  platformAdapter = s;
}

/**
 * 模式判定：默认跟随 Vite 的 DEV 标志；测试可用 setAnalyticsMode 强制。
 * 业务层无需关心；本文件内部唯一决策点。
 */
let forcedMode: 'dev' | 'prod' | null = null;
export function setAnalyticsMode(m: 'dev' | 'prod' | null): void {
  forcedMode = m;
}
export function isAnalyticsDev(): boolean {
  if (forcedMode) return forcedMode === 'dev';
  // Q31：统一跟随 Release Config（dev / test = 开发态；prod = no-op）。
  return ANALYTICS_DEV;
}

/** payload 最小化清洗：剔除函数（防引用泄露），其余平铺保留。 */
function sanitize(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(payload)) {
    const v = payload[k];
    if (typeof v === 'function') continue; // 禁止函数（含可能泄露内部引用）
    out[k] = v;
  }
  return out;
}

/**
 * 统一事件入口。业务层只调它。
 * - DEV：console + 内存（可观察、可测）。
 * - PROD：若有 platform adapter 则转发，否则 no-op。
 */
export function track(event: AnalyticsEvent, payload: Record<string, unknown> = {}): void {
  const rec: AnalyticsRecord = { event, payload: sanitize(payload), t: Date.now() };
  if (isAnalyticsDev()) {
    consoleSink.emit(rec);
    memorySink.emit(rec);
  } else if (platformAdapter) {
    platformAdapter.emit(rec);
  }
  // PROD 且无 adapter → 静默 no-op
}

/**
 * Result 轮询去重：同一 result 对象只放行一次 battle_end / reward_gain，
 * 防止 Result 弹窗因每帧 poll 重复触发。每场开战前 clear()。
 */
export class RefGuard {
  private seen = new Set<unknown>();
  /** 首次见到 ref → true（应触发）；重复 → false。 */
  firstTime(ref: unknown): boolean {
    if (this.seen.has(ref)) return false;
    this.seen.add(ref);
    return true;
  }
  clear(): void {
    this.seen.clear();
  }
}

/** battle_end / reward_gain 专用去重器（在 main.ts 持有，开战前 clear）。 */
export const battleEndGuard = new RefGuard();

export { noopSink };
