/**
 * Q21｜V0.4 Meta V0：最小部件库存（Functional Part 拥有状态）。
 *
 * - 只对 Functional Part 建立「已拥有」状态；Body / Wheel / Drive 本轮不做解锁成长；
 * - 新账号初始拥有一组基础部件：炮 / 锤 / 推杆 / 刺（STARTER_PARTS）；
 * - 兼容已有存档：若旧 Build 正装备其它正式部件，首次迁移一并加入 owned（旧 Build 不变非法）；
 * - owned 用现有 localStorage 持久化体系保存（与 buildPersistence 同风格）；
 * - Reward Pool = 当前正式 PART_OPTIONS（排除 EMPTY / HOLD / prototype：ramHead/lifter 本就不在 PART_OPTIONS）；
 * - 本模块只维护一个最小 owned-id 集合，不引入 Inventory Framework / 金币 / 星级 / 宝箱。
 *
 * 设计约束（来自 Queue 冻结项）：
 * - 不新增 dependency；
 * - 不为了测试增加 production hook（本模块是正常 production 代码，可被测试直接 import）；
 * - 不做金币 / 碎片 / 重复件转换 / 品质 / 星级 / 宝箱。
 */
import { PART_OPTIONS } from './partOptions';
import { EMPTY_SLOT } from '../lab/buildEditorModel';
import type { BuildDraft } from '../lab/buildEditorModel';

/** 新账号初始基础部件 */
export const STARTER_PARTS: readonly string[] = ['cannon', 'hammer', 'pushRod', 'spear'];

/** 当前正式 Functional 集合（PART_OPTIONS 已排除 EMPTY / HOLD / prototype） */
export const OFFICIAL_PARTS: string[] = PART_OPTIONS.filter((o) => o.v !== EMPTY_SLOT).map(
  (o) => o.v,
);

const STORAGE_KEY = 'strongfruit.ownedParts.v1';

/** 结算产出：awarded=null 且无 collectedAll=false 时表示已全部收集 */
export interface RewardOutcome {
  /** 本场解锁的部件 id；已全部收集时为 null */
  awarded: string | null;
  /** 是否已全部收集（不再有可奖励部件） */
  collectedAll: boolean;
}

/** 读取已保存 owned（无存档 / 解析失败 / 非数组 → null）。只保留正式部件并去重。 */
export function loadOwnedRaw(): string[] | null {
  if (typeof localStorage === 'undefined') return null;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    const owned = new Set<string>();
    for (const v of data) {
      if (typeof v === 'string' && OFFICIAL_PARTS.includes(v)) owned.add(v);
    }
    return [...owned];
  } catch {
    return null;
  }
}

/** 写入 owned（去重；隐私模式 / 配额失败静默忽略） */
export function saveOwnedParts(parts: string[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set(parts)]));
  } catch {
    // 写入失败静默忽略
  }
}

export function isOfficialPart(id: string): boolean {
  return OFFICIAL_PARTS.includes(id);
}

/**
 * 种子 owned：starter 必含 + 当前 Build 已装备的正式部件（兼容旧存档迁移）。
 * 返回去重后的稳定数组，不影响 localStorage。
 */
export function seedOwnedFromStarterAndBuild(playerBuild: BuildDraft | null): string[] {
  const owned = new Set<string>(STARTER_PARTS);
  const sel = playerBuild?.functionalSelections;
  if (sel) {
    for (const v of Object.values(sel)) {
      if (v && v !== EMPTY_SLOT && isOfficialPart(v)) owned.add(v);
    }
  }
  return [...owned];
}

/**
 * 确保 owned 已初始化：有存档 → 直接返回；无存档 → 种子（starter + 当前 Build 装备）并落盘。
 * 调用方传入当前玩家 Build 以支持首次迁移。
 */
export function ensureOwnedParts(playerBuild: BuildDraft | null): string[] {
  const saved = loadOwnedRaw();
  if (saved && saved.length > 0) return saved;
  const seeded = seedOwnedFromStarterAndBuild(playerBuild);
  saveOwnedParts(seeded);
  return seeded;
}

/** 当前 owned（无存档时回退到 starter 副本，不落盘） */
export function getOwnedParts(): string[] {
  return loadOwnedRaw() ?? [...STARTER_PARTS];
}

/** 某部件是否已拥有（EMPTY_SLOT 视为永远可装备） */
export function isOwned(id: string): boolean {
  if (id === EMPTY_SLOT) return true;
  return getOwnedParts().includes(id);
}

/** Garage 装备守卫：空槽恒可装备；其余必须已拥有 */
export function canEquipPart(id: string): boolean {
  return id === EMPTY_SLOT || isOwned(id);
}

/** 永久解锁一个部件（已拥有则不重复写入） */
export function addOwnedPart(id: string): void {
  if (!isOfficialPart(id)) return; // 拒绝非正式部件
  const cur = getOwnedParts();
  if (cur.includes(id)) return;
  cur.push(id);
  saveOwnedParts(cur);
}

/**
 * 纯计算：从给定 owned 集合中随机挑 1 个未拥有正式部件。
 * rng 可注入以便测试确定性；默认 Math.random。
 * 全部拥有 → { awarded: null, collectedAll: true }（不发重复件）。
 */
export function computeReward(owned: string[], rng: () => number = Math.random): RewardOutcome {
  const pool = OFFICIAL_PARTS.filter((p) => !owned.includes(p));
  if (pool.length === 0) return { awarded: null, collectedAll: true };
  const idx = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  return { awarded: pool[idx], collectedAll: false };
}

/**
 * 每场 Battle 的奖励结算器（运行时单例）。
 * 以 result 引用为幂等键：同一场 Battle 只结算一次（Result 轮询不会重复发奖）。
 * 结算时自动把奖励部件写入 owned（进入 Result 即已入库，无领取按钮）。
 */
export class BattleRewardSettler {
  private settledRef: unknown = null;
  private lastOutcome: RewardOutcome | null = null;

  /** 结算当前 Battle；同场重复调用返回已缓存结果（不发重复奖励） */
  settle(resultRef: unknown, rng: () => number = Math.random): RewardOutcome | null {
    if (this.settledRef === resultRef) return this.lastOutcome; // 同场已结算
    this.settledRef = resultRef;
    const outcome = computeReward(getOwnedParts(), rng);
    if (outcome.awarded) addOwnedPart(outcome.awarded);
    this.lastOutcome = outcome;
    return outcome;
  }

  /** 开始新一场 Battle 前重置幂等键 */
  reset(): void {
    this.settledRef = null;
    this.lastOutcome = null;
  }
}
