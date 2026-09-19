/**
 * Q15｜玩家 Build 最小持久化（仅 localStorage 保存当前 Build Draft）。
 *
 * - 只保存 Build，不保存金币 / 段位 / 宝箱 / 战令（本轮不做经济系统）；
 * - 刷新页面：合法存档 → 恢复上一次 Build；无存档 / 非法旧存档 → 返回 null
 *   （调用方回退到默认合法 Build）；
 * - 非法判定：结构非法（缺字段 / 未知 Body / 未知部件）或构成非法 Build
 *   （validateSnapshot 不通过，例如旧存档引用了已移除的部件）→ 视为非法；
 * - 读写失败（隐私模式 / 配额 / SSR 无 localStorage）静默处理，不影响游戏。
 */
import type { BuildDraft } from '../lab/buildEditorModel';
import { EMPTY_SLOT, buildSnapshotFromDraft, resolveDriveMode } from '../lab/buildEditorModel';
import { registry } from './content';
import { validateSnapshot } from './buildValidator';
// PRODUCT-LOOP-R2-B｜`functionalStars` 的合法上界 = 库存数据模型的星级档数（★5）。
// ⚠️ 不在这里写死一个 5：那是第二份真源，与 `partInventory` 的模型必然漂移。
// 依赖方向：`buildPersistence → partInventory`（单向；`partInventory` 不依赖本模块，无环）。
import { INVENTORY_MAX_STAR } from './partInventory';
import { readJsonWithVersion, migrateLegacy, stampVersion, STAMP_KEY } from './saveVersion';
import { platform } from '../platform';

const STORAGE_KEY = 'strongfruit.playerBuild.v1';

const KNOWN_BODIES = new Set(registry.bodies.keys());
const KNOWN_FUNCTIONALS = new Set(registry.functionals.keys());
const KNOWN_MOVEMENTS = new Set(registry.movements.keys());

/** 读取并校验玩家 Build；无存档 / 解析失败 / 非法 → null */
export function loadPlayerBuild(): BuildDraft | null {
  let raw: string | null = null;
  try {
    raw = platform.storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  const parsed = readJsonWithVersion(raw);
  if (!parsed) return null;
  const migrated = migrateLegacy('build', parsed.obj, parsed.version) as Record<string, unknown>;
  delete migrated[STAMP_KEY]; // 版本信封不泄漏进领域对象（BuildDraft 语义不含 __v）
  if (!isBuildDraftShape(migrated)) return null;
  const draft = migrated as BuildDraft;
  // F-MOVE-1：驱动模式归一（旧 localStorage 无 drive 字段 / 非法值 → 前进）
  draft.drive = resolveDriveMode(draft.drive);
  // 必须构成合法 Build（未知部件 / 超载 / 无 Weapon → 旧存档非法）
  const snap = buildSnapshotFromDraft(draft, registry, 'customA');
  if (!validateSnapshot(snap, registry).valid) return null;
  return draft;
}

/** 写入玩家 Build（附带 saveVersion 信封；结构性序列化） */
export function savePlayerBuild(d: BuildDraft): void {
  try {
    platform.storage.setItem(STORAGE_KEY, JSON.stringify(stampVersion(d)));
  } catch {
    // 写入失败静默忽略（隐私模式 / 配额），不影响当前对局
  }
}

/** 结构校验：body 已知、轮径为数字、functionalSelections 值为已知部件或空槽；
 *  F-CONTENT-PLAYER-MOVEMENT-PACK-R1：rearWheelDefId/frontWheelDefId 可选，
 *  若存在必须是已知 Movement defId（旧存档无此字段 = 标准轮）。 */
function isBuildDraftShape(d: unknown): d is BuildDraft {
  if (!d || typeof d !== 'object') return false;
  const o = d as Record<string, unknown>;
  if (typeof o.bodyDefId !== 'string' || !KNOWN_BODIES.has(o.bodyDefId)) return false;
  if (typeof o.rearRadius !== 'number' || typeof o.frontRadius !== 'number') return false;
  // F-CONTENT-PACK-REAL-UI-R1｜Fix 4：卸下轮组存为 EMPTY_SLOT（站桩 Build 可持久化重载）
  if (o.rearWheelDefId !== undefined && (typeof o.rearWheelDefId !== 'string' || (o.rearWheelDefId !== EMPTY_SLOT && !KNOWN_MOVEMENTS.has(o.rearWheelDefId)))) return false;
  if (o.frontWheelDefId !== undefined && (typeof o.frontWheelDefId !== 'string' || (o.frontWheelDefId !== EMPTY_SLOT && !KNOWN_MOVEMENTS.has(o.frontWheelDefId)))) return false;
  if (typeof o.functionalSelections !== 'object' || o.functionalSelections === null) {
    return false;
  }
  const sel = o.functionalSelections as Record<string, unknown>;
  for (const v of Object.values(sel)) {
    if (typeof v !== 'string') return false;
    if (v !== EMPTY_SLOT && !KNOWN_FUNCTIONALS.has(v)) return false;
  }
  // Q22：functionalStars 可选（各槽星级）；缺省视为全 1★
  // PRODUCT-LOOP-R2-B｜上界从「只接受 1|2」放宽到 **1..INVENTORY_MAX_STAR（★5）**：
  //   数据模型（`partInventory.PartStack`）已泛化到 5 档，若这里仍只认 1|2，
  //   玩家把 ★3 装上车后 `savePlayerBuild` 会写进去、而 `loadPlayerBuild` 判非法 → 返回 null
  //   ⇒ **整份玩家 Build 静默回退 starter**（装备凭空消失，且没有一处报错）。
  //   ⚠️ 零行为变化：战斗侧 `starTierEnergy` / `starTierDamage` 对**一切 star ≥ 2 用同一倍率**
  //      （`buildSnapshot.ts:30-39`），且旧横屏只会写 1/2（`MAX_STAR = 2`）⇒ 放宽只影响
  //      「本来会被静默丢弃」的高星 Build。
  if (o.functionalStars !== undefined) {
    if (typeof o.functionalStars !== 'object' || o.functionalStars === null) return false;
    const stars = o.functionalStars as Record<string, unknown>;
    for (const v of Object.values(stars)) {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > INVENTORY_MAX_STAR) {
        return false;
      }
    }
  }
  return true;
}
