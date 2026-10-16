/**
 * GARAGE-V2-QUALITY-WEAPON-EQUIP-R1｜品质偏差账本（core 侧读口）。
 *
 * ── 为什么这个模块存在 ───────────────────────────────────────────────────────
 *   `loadPlayerBuild`（core/buildPersistence）在加载时必须**真实校验**
 *   `equippedQualityInstances` 绑定是否仍被账本持有（防幽灵穿戴），
 *   但账本 key/类型此前只存在于 product/garageV2Quality.ts —— core 不能反向
 *   import product（依赖方向纪律）。
 *
 *   裁定（与 OFFICIAL_PARTS / STAR_DAMAGE_MAX_STAR「两处声明、测试钉死」同款）：
 *   **key、类型、纯读写搬进 core**，product 层 `garageV2Quality.ts` 改为
 *   re-export（`export ... from`）—— 既有调用方（garageV2Lab / 测试）import 面
 *   **逐字节不变**，PL-26 白名单只需登记 garageV2Quality 的新来源行。
 *
 * ── 冻结边界 ───────────────────────────────────────────────────────────────
 *   - 账本 key / 形状 / v1→v2 升级语义**逐字节不变**（Foundation + COH 两轮的契约原样）；
 *   - 写侧仍只在 product 的 fuseQualityFive（本模块只提供 load/save 纯函数，
 *     fuse 事务逻辑零搬动）；
 *   - 本模块不解释「穿戴」，不读 Build，不写 ownedParts.v2 / ownedBodies.v1。
 */

import { platform } from '../platform';
import { readJsonWithVersion, stampVersion } from './saveVersion';
import type { QualityTierId } from './types';
import { QUALITY_TIERS_CORE } from './installQuality';

/** 账本 storage key（与 Foundation 逐字相同；旧存档零迁移）。 */
export const GARAGE_V2_LEDGER_KEY = 'strongfruit.garageV2Ledger.v1';
export const GARAGE_V2_LEDGER_VERSION = 1;

/** 消耗记录（v2 形状；与 garageV2Quality.ConsumedRecord 逐字段一致）。 */
export interface LedgerConsumedRecord {
  readonly consumedIds: readonly string[];
  readonly highWatermark: number;
  readonly synced: boolean;
}

/** 一件品质合成产物的账本记录。 */
export interface LedgerQualityProduct {
  readonly defId: string;
  readonly quality: QualityTierId;
  readonly seq: number;
}

/** 偏差账本（v2 形状）。 */
export interface GarageV2LedgerData {
  readonly version: number;
  readonly consumed: Readonly<Record<string, LedgerConsumedRecord>>;
  readonly products: readonly LedgerQualityProduct[];
}

const EMPTY_LEDGER: GarageV2LedgerData = {
  version: GARAGE_V2_LEDGER_VERSION,
  consumed: {},
  products: [],
};

/**
 * 读账本（无 / 损坏 / 形状非法 → 空账本，绝不抛）。
 * ⚠️ 解析规则与 garageV2Quality.loadGarageV2Ledger 逐字节一致（同一实现的两份声明
 *    由测试钉死：对同一存储读出的账本必须 deep-equal）。
 */
export function loadGarageV2LedgerData(): GarageV2LedgerData {
  try {
    const parsed = readJsonWithVersion(platform.storage.getItem(GARAGE_V2_LEDGER_KEY));
    if (!parsed) return { ...EMPTY_LEDGER, consumed: {}, products: [] };
    const obj = parsed.obj as Record<string, unknown> | null;
    if (!obj || typeof obj !== 'object') return { ...EMPTY_LEDGER, consumed: {}, products: [] };
    const consumedRaw = obj['consumed'];
    const productsRaw = obj['products'];
    const consumed: Record<string, LedgerConsumedRecord> = {};
    if (consumedRaw && typeof consumedRaw === 'object' && !Array.isArray(consumedRaw)) {
      for (const [k, v] of Object.entries(consumedRaw as Record<string, unknown>)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const o = v as Record<string, unknown>;
          const idsRaw = Array.isArray(o['consumedIds']) ? (o['consumedIds'] as unknown[]) : [];
          const ids = idsRaw
            .filter((x): x is string => typeof x === 'string' && x.startsWith('q1:'))
            .filter((x, i, arr) => arr.indexOf(x) === i);
          const hw = Math.max(0, Math.floor(Number(o['highWatermark']) || 0));
          if (ids.length > 0 || hw > 0) {
            consumed[k] = {
              consumedIds: ids,
              highWatermark: Math.max(hw, ids.length),
              synced: o['synced'] === true,
            };
          }
          continue;
        }
        // v1 形状：数量 → 前 N 序号已耗 + 高水位 N（语义不变）
        const n = Math.max(0, Math.floor(Number(v) || 0));
        if (n > 0) {
          consumed[k] = {
            consumedIds: Array.from({ length: n }, (_, i) => `q1:${k.replace('|', ':')}:${i + 1}`),
            highWatermark: n,
            synced: false,
          };
        }
      }
    }
    const products: LedgerQualityProduct[] = Array.isArray(productsRaw)
      ? (productsRaw as unknown[])
          .map((p): LedgerQualityProduct | null => {
            const o = p as Record<string, unknown> | null;
            const defId = typeof o?.['defId'] === 'string' ? (o['defId'] as string) : null;
            const quality = typeof o?.['quality'] === 'string' ? (o['quality'] as QualityTierId) : null;
            const seq = Math.floor(Number(o?.['seq']) || 0);
            if (!defId || quality === null || !(QUALITY_TIERS_CORE as readonly string[]).includes(quality) || seq < 1) return null;
            return { defId, quality, seq };
          })
          .filter((p): p is LedgerQualityProduct => p !== null)
      : [];
    return { version: GARAGE_V2_LEDGER_VERSION, consumed, products };
  } catch {
    return { ...EMPTY_LEDGER, consumed: {}, products: [] };
  }
}

/**
 * **账本持有校验**（加载时防幽灵穿戴的唯一判据）：
 * `qv2:<defId>:<quality>:<seq>` 是否仍存在于账本 products。
 * 纯读、零副作用、绝不抛。
 */
export function ledgerOwnsProduct(instanceId: string): boolean {
  if (!instanceId.startsWith('qv2:')) return false;
  const parts = instanceId.split(':');
  if (parts.length !== 4) return false;
  const [, defId, quality, seqRaw] = parts as [string, string, string, string];
  const seq = Math.floor(Number(seqRaw));
  if (!defId || !(QUALITY_TIERS_CORE as readonly string[]).includes(quality) || !Number.isFinite(seq) || seq < 1) {
    return false;
  }
  const ledger = loadGarageV2LedgerData();
  return ledger.products.some(
    (p) => p.defId === defId && p.quality === quality && p.seq === seq,
  );
}

/** 写账本（信封版本戳；失败静默——与既有存档模块同一纪律）。供 product 写侧复用。 */
export function saveGarageV2LedgerData(ledger: GarageV2LedgerData): void {
  try {
    platform.storage.setItem(GARAGE_V2_LEDGER_KEY, JSON.stringify(stampVersion(ledger)));
  } catch {
    // 隐私模式 / 配额失败静默
  }
}
