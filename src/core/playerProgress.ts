/**
 * Q23→Q24｜V0.5→V0.6 玩家进度（金币 + 段位 rating）。
 *
 * - 持久化于 localStorage（与 partInventory 同模式：typeof localStorage 守卫 + 静默失败）；
 * - 不引入实例 UID、不新增 dependency；
 * - 不做商店 / 付费货币 / 多种资源 / 动态价格 / 赛季 / 排行榜 / 晋级赛 / 隐藏分；
 * - 结算为纯函数（可单测，不依赖 DOM）；运行时单例结算器以 result 引用为幂等键，同场只结算一次。
 *
 * 设计约束（来自 Queue 冻结项 + Q30 更新）：
 * - 金币常规来源：Battle 获得（COIN_WIN/LOSE）、5合1 消耗（MERGE_COST_COIN）；
 * - Q30 新增唯一额外来源：IAA 广告激励（`addCoins`，仅 Rewarded 完整观看后由 ads 层发放，非 Gameplay 数值）；
 * - 段位只随胜负变化，最低 0；不细分小段；
 * - 难度 / 抽取逻辑在 opponentPool（Q25），本模块不涉对手。
 * - 段位只随胜负变化，最低 0；不细分小段；
 * - 难度 / 抽取逻辑在 opponentPool（Q25），本模块不涉对手。
 */
import { tryMerge, type PartInventory } from './partInventory';
import { readJsonWithVersion, migrateLegacy, stampVersion } from './saveVersion';

export type Tier = 'bronze' | 'silver' | 'gold' | 'diamond';

export interface ProgressState {
  /** 金币（Q23） */
  coin: number;
  /** 段位积分（Q24），最低 0 */
  rating: number;
}

const STORAGE_KEY = 'strongfruit.playerProgress.v1';

// —— 金币（Q23）——
export const COIN_WIN = 100;
export const COIN_LOSE = 60;
/** 5合1 固定金币消耗 */
export const MERGE_COST_COIN = 500;

// —— 段位（Q24）——
export const RATING_WIN = 20;
export const RATING_LOSE = -10;
export const RATING_MIN = 0;

export const TIER_LABEL: Record<Tier, string> = {
  bronze: '青铜',
  silver: '白银',
  gold: '黄金',
  diamond: '钻石',
};

/** 新账号默认进度 */
export function defaultProgress(): ProgressState {
  return { coin: 0, rating: 0 };
}

/**
 * 段位：0–99 青铜 / 100–199 白银 / 200–299 黄金 / 300+ 钻石。
 * 不细分小段（无晋级赛 / 无隐藏分）。
 */
export function tierOf(rating: number): Tier {
  if (rating >= 300) return 'diamond';
  if (rating >= 200) return 'gold';
  if (rating >= 100) return 'silver';
  return 'bronze';
}

/** 纯函数：应用一场战斗结果（coin + rating），不读写存储；rating 最低不低于 0 */
export function applyBattleResult(p: ProgressState, isWin: boolean): ProgressState {
  const coinDelta = isWin ? COIN_WIN : COIN_LOSE;
  const ratingDelta = isWin ? RATING_WIN : RATING_LOSE;
  return {
    coin: p.coin + coinDelta,
    rating: Math.max(RATING_MIN, p.rating + ratingDelta),
  };
}

/** 写入进度（附带 saveVersion 信封；隐私模式 / 配额失败静默忽略） */
export function saveProgress(p: ProgressState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stampVersion(p)));
  } catch {
    // 写入失败静默忽略
  }
}

/** 读进度（无存档 / 解析失败 → null；旧格式经统一迁移 + 字段级安全校验） */
export function loadProgressRaw(): ProgressState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = readJsonWithVersion(raw);
    if (!parsed) return null;
    const d = migrateLegacy('progress', parsed.obj, parsed.version) as Record<string, unknown>;
    if (!d || typeof d !== 'object') return null;
    return {
      // 字段级安全：单字段非法/缺失只回退该字段默认（coin 缺省 0、rating 夹 0），不丢全部
      coin: Math.max(0, Math.floor(Number(d.coin) || 0)),
      rating: Math.max(RATING_MIN, Math.floor(Number(d.rating) || 0)),
    };
  } catch {
    return null;
  }
}

/** 当前进度（无存档回退默认；不落盘） */
export function getProgress(): ProgressState {
  return loadProgressRaw() ?? defaultProgress();
}

/** 结算结果（供 Result 卡展示本局金币 / 段位变化） */
export interface ProgressSettle {
  progress: ProgressState;
  coinDelta: number;
  ratingDelta: number;
}

/**
 * 每场 Battle 的进度结算器（运行时单例）。
 * 以 result 引用为幂等键：同一场 Battle 只结算一次（Result 轮询不会重复发奖/重复加分）。
 */
export class BattleProgressSettler {
  private settledRef: unknown = null;
  private last: ProgressSettle | null = null;

  settle(resultRef: unknown, isWin: boolean): ProgressSettle | null {
    if (this.settledRef === resultRef) return this.last; // 同场已结算
    this.settledRef = resultRef;
    const before = getProgress();
    const after = applyBattleResult(before, isWin);
    saveProgress(after);
    const res: ProgressSettle = {
      progress: after,
      coinDelta: after.coin - before.coin,
      ratingDelta: after.rating - before.rating,
    };
    this.last = res;
    return res;
  }

  /** 开始新一场 Battle 前重置幂等键 */
  reset(): void {
    this.settledRef = null;
    this.last = null;
  }
}

/** 合成金币门槛校验（纯函数） */
export function canAffordMerge(coin: number): boolean {
  return coin >= MERGE_COST_COIN;
}

/**
 * Q30｜IAA 广告激励金币（唯一新增金币来源，独立于 Battle / 合成）。
 * - 不修改段位；
 * - 金币下限 0（防溢出为负）；
 * - 不落盘之外的副作用（saveProgress 内部已静默失败保护）。
 */
export function addCoins(amount: number): ProgressState {
  const before = getProgress();
  const after: ProgressState = {
    ...before,
    coin: Math.max(0, before.coin + Math.floor(amount)),
  };
  saveProgress(after);
  return after;
}

/** 合成 + 扣费结果（纯函数，可单测；不读写存储） */
export interface MergeWithCostResult {
  ok: boolean;
  inventory: PartInventory;
  coin: number;
}

/**
 * 5合1 + 固定金币消耗（Q23）。
 * - 金币不足 → ok=false（不消耗部件、不扣费）；
 * - 部件不足 5 个（含已装备保留后）→ ok=false（不扣费）；
 * - 成功 → 消耗 5 个 1★（跨 defId）+ 扣 MERGE_COST_COIN 金币，返回新库存与新金币。
 * 直接 mutate 传入的 inv / coin 由调用方负责落盘。
 */
export function mergeWithCost(
  inv: PartInventory,
  equippedDefIds: string[],
  coin: number,
  rng: () => number = Math.random,
): MergeWithCostResult {
  if (coin < MERGE_COST_COIN) return { ok: false, inventory: inv, coin };
  const res = tryMerge(inv, equippedDefIds, rng);
  if (!res) return { ok: false, inventory: inv, coin };
  return { ok: true, inventory: res.inventory, coin: coin - MERGE_COST_COIN };
}
