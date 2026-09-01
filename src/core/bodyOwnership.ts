/**
 * F-CONTENT-PLAYER-BODY-PACK-R1｜车身拥有状态（轻量解锁模型）。
 *
 * 背景：既有系统里车身（BODY_OPTIONS）与轮径一样是 BuildDraft 直接选择、
 * 无拥有性计数；只有 Functional 部件有 PartInventory 拥有计数 + locked 五态。
 * 本 Queue 新增 4 个正式水果车身，要求：
 * - 「未获得状态不能装备」（T6）；
 * - 「Inventory 获得后可装备，彻底重启后存档保持」（T8）；
 * - 「不在正式环境默认赠送全部新车身」（四-3）；
 * - 「旧存档载入不得丢失已有车身、库存或装备」（T9）。
 *
 * 因此为「车身」引入最轻量的拥有集合（无数量概念，拥有即解锁）：
 * - 旧 4 个正式车身（西瓜/香蕉/菠萝/椰子）**恒为默认拥有**——与既有
 *   「直接可选」规则一致（迁移兼容：无论是否已有本 key，旧车身永不丢失）；
 * - 新 4 个正式车身（榴莲/梨子/芒果/橙子）默认**未拥有**，仅经
 *   grantBody / debug「全部件×1」获得后解锁；
 * - 持久化独立 key（与 PartInventory 分离，互不干扰），写入即落盘。
 *
 * 设计约束（来自 Queue 冻结项 / 禁止项）：
 * - 不新建经济系统（无金币/商店/宝箱/掉落池）；解锁与掉落沿用「同级车身
 *   默认拥有」规则，本 Queue 只提供 debug 获得路径 + 拥有持久化；
 * - 不触碰 Physics / 伤害 / AI / 胜负规则 / 对手池 / viewport / DPR；
 * - 空档/轮径/驱动等其它 Build 选择不受本模型影响；
 * - 旧 4 个车身不受本模型约束（恒可装备），保证零回归。
 */
import { platform } from '../platform';

/** 旧 4 个正式车身（恒默认拥有；迁移兼容，永不因存档丢失） */
export const DEFAULT_OWNED_BODIES: readonly string[] = [
  'watermelonBody',
  'bananaBody',
  'pineappleBody',
  'coconutBody',
];

/** 本 Queue 新增的 4 个正式水果车身（默认未拥有，需获得后解锁） */
export const NEW_OFFICIAL_BODIES: readonly string[] = [
  'durianBody',
  'pearBody',
  'mangoBody',
  'orangeBody',
];

/** 全部正式玩家车身（默认拥有 + 新增） */
export const OFFICIAL_BODIES: readonly string[] = [
  ...DEFAULT_OWNED_BODIES,
  ...NEW_OFFICIAL_BODIES,
];

const STORAGE_KEY = 'strongfruit.ownedBodies.v1';

/**
 * 读取已获得的新车身 id 集合；无存档 / 解析失败 → []（仅新车身受存档控制）。
 * 旧 4 个默认拥有不在此集合语义内（恒拥有），因此该 key 只记录新车身获得项。
 */
export function loadOwnedBodies(): string[] {
  try {
    const raw = platform.storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of parsed) {
      if (typeof v === 'string' && NEW_OFFICIAL_BODIES.includes(v) && !seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** 落盘已获得的新车身 id 集合（静默失败保护，与既有存档模块同模式） */
export function saveOwnedBodies(ids: string[]): void {
  try {
    platform.storage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // 写入失败静默忽略
  }
}

/** 某车身是否已拥有（旧 4 个恒 true；新车身查存档） */
export function isBodyOwned(defId: string): boolean {
  if (DEFAULT_OWNED_BODIES.includes(defId)) return true;
  if (!NEW_OFFICIAL_BODIES.includes(defId)) return false;
  return loadOwnedBodies().includes(defId);
}

/** 车身装备守卫：必须属于正式车身目录且已拥有（Garage 与 Runtime 共用） */
export function canEquipBody(defId: string): boolean {
  return OFFICIAL_BODIES.includes(defId) && isBodyOwned(defId);
}

/** 永久解锁一个正式车身（非正式车身忽略；幂等：已拥有再调无副作用） */
export function grantBody(defId: string): boolean {
  if (!NEW_OFFICIAL_BODIES.includes(defId)) return false;
  const owned = loadOwnedBodies();
  if (!owned.includes(defId)) {
    owned.push(defId);
    saveOwnedBodies(owned);
  }
  return true;
}

/**
 * 一次性解锁全部新增正式车身（debug「全部件×1」车身部分）。
 * @returns 本次实际新增解锁数（0 = 全部已拥有；幂等）
 */
export function grantAllNewBodies(): number {
  const owned = loadOwnedBodies();
  const set = new Set(owned);
  const next: string[] = [];
  let added = 0;
  for (const id of NEW_OFFICIAL_BODIES) {
    if (!set.has(id)) {
      set.add(id);
      next.push(id);
      added += 1;
    }
  }
  if (next.length > 0) saveOwnedBodies([...owned, ...next]);
  return added;
}
