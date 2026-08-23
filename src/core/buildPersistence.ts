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
import { readJsonWithVersion, migrateLegacy, stampVersion, STAMP_KEY } from './saveVersion';
import { platform } from '../platform';

const STORAGE_KEY = 'strongfruit.playerBuild.v1';

const KNOWN_BODIES = new Set(registry.bodies.keys());
const KNOWN_FUNCTIONALS = new Set(registry.functionals.keys());

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

/** 结构校验：body 已知、轮径为数字、functionalSelections 值为已知部件或空槽 */
function isBuildDraftShape(d: unknown): d is BuildDraft {
  if (!d || typeof d !== 'object') return false;
  const o = d as Record<string, unknown>;
  if (typeof o.bodyDefId !== 'string' || !KNOWN_BODIES.has(o.bodyDefId)) return false;
  if (typeof o.rearRadius !== 'number' || typeof o.frontRadius !== 'number') return false;
  if (typeof o.functionalSelections !== 'object' || o.functionalSelections === null) {
    return false;
  }
  const sel = o.functionalSelections as Record<string, unknown>;
  for (const v of Object.values(sel)) {
    if (typeof v !== 'string') return false;
    if (v !== EMPTY_SLOT && !KNOWN_FUNCTIONALS.has(v)) return false;
  }
  // Q22：functionalStars 可选（各槽星级 1/2）；缺省视为全 1★
  if (o.functionalStars !== undefined) {
    if (typeof o.functionalStars !== 'object' || o.functionalStars === null) return false;
    const stars = o.functionalStars as Record<string, unknown>;
    for (const v of Object.values(stars)) {
      if (typeof v !== 'number' || (v !== 1 && v !== 2)) return false;
    }
  }
  return true;
}
