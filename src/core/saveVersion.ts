/**
 * Q27｜V0.7 存档版本化与安全恢复（Save Version Foundation）。
 *
 * 轻量、零依赖的存档迁移基座：
 * - 每个玩家持久化记录写入时附带 `saveVersion` 信封（__v 字段），便于后续迭代识别旧格式；
 * - 统一迁移入口 `migrateLegacy(kind, obj, fromVersion)`：把任意旧版本对象升级到当前形状；
 * - 字段级安全：迁移后再由各模块自身的 normalize 逐字段校验，单字段非法/缺失只回退该字段默认，
 *   不影响其它合法字段，更不会清空整个存档（各模块 key 相互独立，天然隔离）；
 * - 统一 Reset 能力 `resetPlayerSave()`：仅删除已知玩家存档 key，用于 DEV/Settings 安全入口恢复新账号状态；
 * - 不引入云存档 / 登录 / 服务端 DB / 状态管理框架 / 新 dependency。
 *
 * 设计约束（来自 Queue 冻结项 / 禁止项）：
 * - 不一次性重写全部 localStorage：每个 key 独立读写、独立迁移；
 * - 不改变任何已有数据结构语义（Build / Inventory / Coin / Rating / Tutorial 字段含义不变）；
 * - 不触碰 Weapon / Physics / 经济 / 段位规则（那些在各自模块）。
 */
import type { PartInventory } from './partInventory';

/** 当前存档格式版本（单调递增；下次破坏性变更 +1 并在 migrateLegacy 增加 v(N-1)→vN 步骤） */
export const CURRENT_SAVE_VERSION = 1;

/** 版本信封字段名（写入每条记录时附带） */
export const STAMP_KEY = '__v';

/** 受版本化管理的存档种类 */
export type SaveKind = 'build' | 'inventory' | 'progress' | 'onboarding';

/** 已知玩家存档 key（Reset 只动这些，绝不波及无关 key） */
export const RESET_KEYS: readonly string[] = [
  'strongfruit.playerBuild.v1',
  'strongfruit.ownedParts.v2',
  'strongfruit.ownedParts.v1', // 旧版遗留 key，一并清理
  'strongfruit.playerProgress.v1',
  'strongfruit.onboarding.v1',
];

/** 给对象附加/更新版本信封（写入时调用；不修改入参，返回新对象） */
export function stampVersion<T>(obj: T): T & Record<typeof STAMP_KEY, number> {
  return { ...obj, [STAMP_KEY]: CURRENT_SAVE_VERSION } as T & Record<typeof STAMP_KEY, number>;
}

/**
 * 安全解析带版本信封的 JSON 字符串：
 * - null / 空 → 返回 null（调用方回退该 key 默认，不影响其它 key）；
 * - 非法 JSON → 返回 null（整条记录解析失败，仅该 key 失效，绝不波及其它 key）；
 * - 合法对象 → { version: 记录的 __v 或 0（无信封视为最旧 v0）, obj }；
 * - 合法数组（仅旧版库存 owned-id 数组使用）→ { version: 0, obj }，交由 migrateLegacy 升级。
 */
export function readJsonWithVersion(raw: string | null): { version: number; obj: unknown } | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // 解析失败：仅该 key 失效
  }
  if (Array.isArray(parsed)) return { version: 0, obj: parsed }; // 旧版库存数组
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const version = typeof obj[STAMP_KEY] === 'number' ? (obj[STAMP_KEY] as number) : 0;
  return { version, obj };
}

/**
 * 统一迁移入口（Save Version Foundation 核心）。
 * 把 fromVersion 的旧对象升级到当前形状；已是最新版本直接返回。
 * 每个种类的升级步骤集中在下方 upgrade_* 函数，便于后续迭代追加。
 *
 * 注意：迁移只做「结构升级」（如旧版数组→新版对象），字段级合法性校验
 * 由各模块自身的 normalize 负责（迁移后调用），二者职责分离。
 */
export function migrateLegacy(kind: SaveKind, obj: unknown, fromVersion: number): unknown {
  if (fromVersion >= CURRENT_SAVE_VERSION) return obj; // 已是最新
  let cur = obj;
  if (fromVersion < 1) {
    cur = upgrade_v0_to_v1(kind, cur);
  }
  // 未来：if (fromVersion < 2) cur = upgrade_v1_to_v2(kind, cur);
  return cur;
}

/** v0（无信封 / 旧版结构）→ v1（当前结构） */
function upgrade_v0_to_v1(kind: SaveKind, obj: unknown): unknown {
  switch (kind) {
    case 'inventory': {
      // 旧版 Q21 owned-id 数组 → 当前数量化库存映射
      if (Array.isArray(obj)) {
        const map: Record<string, { one: number; two: number }> = {};
        for (const v of obj) {
          if (typeof v === 'string' && !map[v]) map[v] = { one: 1, two: 0 };
        }
        return map;
      }
      return obj; // 已是对象形状，仅补信封
    }
    case 'build':
    case 'progress':
    case 'onboarding':
      // 这些种类 v0→v1 数据形状不变，仅写入时补 __v 信封
      return obj;
  }
}

/**
 * Reset Progress：仅删除已知玩家存档 key（恢复新账号状态）。
 * 安全入口——只应在 DEV/Settings 中明确调用，绝不自动执行。
 * 无 localStorage（隐私模式 / node）静默忽略。
 */
export function resetPlayerSave(): void {
  if (typeof localStorage === 'undefined') return;
  for (const key of RESET_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // 忽略单项删除失败
    }
  }
}

/** 类型守卫：用于测试与调用方断言迁移产物形状（库存） */
export function isInventoryShape(d: unknown): d is PartInventory {
  return !!d && typeof d === 'object' && !Array.isArray(d);
}
