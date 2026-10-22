/**
 * FRUITS-ADVENTURE-R3/R4｜隔离测试档案（meta 成长，不影响正式存档）。
 *
 * 设计约束（验收③ + Queue 必改 3 + R4 必改①）：
 *   - 局外成长**不写**正式玩家存档（`strongfruit.playerBuild.v1`），只写本隔离键；
 *   - 键名明确带 `testArchive` 前缀，与正式存档键在命名与用途上完全隔离；
 *   - 所有写入均为**真实结算数据**（实际战斗数 / 实际强化 / 实际胜负），绝不生成假领奖结果；
 *   - 重开（新一局）只重置当局状态，**保留**本档案（进度跨局累积）；
 *   - R4：结算统计**区分完成战斗（battlesCompleted，含打退）与获胜战斗（battlesWon，winner==='A'）**；
 *     「下一局目标」全部由档案真实数据派生，且**必须可达**（7 战上限内绝不出现「8 场」这类不可达目标）。
 *
 * ⚠️ 仅依赖浏览器 `localStorage`（与冻结 Run 体系一致）；无 SSR / Node 直跑场景由调用方兜底。
 */
import { ADVENTURE_TOTAL_BATTLES } from './advScript';

const ARCHIVE_KEY = 'strongfruit.adventure.r3.testArchive.v1';
const ARCHIVE_VERSION = 2;
const MAX_RUNS = 12;

export interface AdvRunSummary {
  readonly seedLabel: string;
  readonly won: boolean;
  readonly dayReached: number;
  readonly dayTotal: number;
  readonly battlesCompleted: number;
  /** 获胜战斗数（winner==='A'）；与 battlesCompleted（完成场次，含打退）区分。 */
  readonly battlesWon: number;
  /** 终点耐久百分比（0~100；用于已全胜通关后的可达目标）。 */
  readonly finalHpPct: number;
  readonly buffs: readonly string[];
  readonly finalHp: number;
  readonly playerHpMax: number;
  readonly loadoutSource: string;
  readonly ts: number;
}

export interface AdvArchive {
  readonly version: number;
  readonly runs: readonly AdvRunSummary[];
  readonly best: {
    readonly battlesCompleted: number;
    readonly battlesWon: number;
    readonly dayReached: number;
    readonly won: boolean;
    readonly finalHpPct: number;
    readonly seedLabel: string;
  } | null;
  readonly totals: {
    readonly runs: number;
    readonly wins: number;
    readonly battlesCompleted: number;
    readonly battlesWon: number;
  };
}

function emptyArchive(): AdvArchive {
  return {
    version: ARCHIVE_VERSION,
    runs: [],
    best: null,
    totals: { runs: 0, wins: 0, battlesCompleted: 0, battlesWon: 0 },
  };
}

function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** 读取隔离测试档案（缺失 / 损坏 / 版本不符 → 空档案，不影响游戏）。 */
export function readArchive(): AdvArchive {
  const st = safeStorage();
  if (!st) return emptyArchive();
  try {
    const raw = st.getItem(ARCHIVE_KEY);
    if (!raw) return emptyArchive();
    const parsed = JSON.parse(raw) as Partial<AdvArchive> | null;
    if (!parsed || parsed.version !== ARCHIVE_VERSION) return emptyArchive();
    return {
      version: ARCHIVE_VERSION,
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      best: parsed.best ?? null,
      totals: parsed.totals ?? { runs: 0, wins: 0, battlesCompleted: 0, battlesWon: 0 },
    };
  } catch {
    return emptyArchive();
  }
}

/** 「更好的一局」比较（R4）：先比通关，再比获胜场次，最后比终点耐久。 */
function betterThan(a: AdvRunSummary, b: NonNullable<AdvArchive['best']>): boolean {
  if (a.won !== b.won) return a.won;
  if (a.battlesWon !== b.battlesWon) return a.battlesWon > b.battlesWon;
  return a.finalHpPct > b.finalHpPct;
}

/** 写入一局结算（真实数据），返回更新后的档案。调用方负责保存。 */
export function recordRun(summary: AdvRunSummary): AdvArchive {
  const cur = readArchive();
  const runs = [summary, ...cur.runs].slice(0, MAX_RUNS);
  const totals = {
    runs: cur.totals.runs + 1,
    wins: cur.totals.wins + (summary.won ? 1 : 0),
    battlesCompleted: cur.totals.battlesCompleted + summary.battlesCompleted,
    battlesWon: cur.totals.battlesWon + summary.battlesWon,
  };
  const best =
    !cur.best || betterThan(summary, cur.best)
      ? {
          battlesCompleted: summary.battlesCompleted,
          battlesWon: summary.battlesWon,
          dayReached: summary.dayReached,
          won: summary.won,
          finalHpPct: summary.finalHpPct,
          seedLabel: summary.seedLabel,
        }
      : cur.best;
  const next: AdvArchive = { version: ARCHIVE_VERSION, runs, best, totals };
  const st = safeStorage();
  if (st) {
    try {
      st.setItem(ARCHIVE_KEY, JSON.stringify(next));
    } catch {
      /* 写入失败静默忽略（隐私模式 / 配额），不影响当前对局 */
    }
  }
  return next;
}

/** 本档案使用的 localStorage 键（便于测试断言「隔离」）。 */
export function archiveStorageKey(): string {
  return ARCHIVE_KEY;
}

/**
 * 基于档案推导「下一局目标」（明确的局外成长动机，真实数据派生）。
 * R4 必改①：所有目标**必须真实可达** ——
 *   - 未通关 → 比最佳走得更远（恒可达）；
 *   - 已通关但非全胜 → 挑战 7 战全胜（ADVENTURE_TOTAL_BATTLES 上限内，可达）；
 *   - 已全胜通关 → 追平/刷新通关终点耐久纪录（ADVENTURE_TOTAL_BATTLES 场已是上限，
 *     绝不出现「挑战 8 场不败」这类 7 战上限下不可达的目标）。
 */
export function nextRunGoal(archive: AdvArchive): string {
  if (!archive.best) return '目标：撑过第一场战斗，活着走到终点。';
  if (!archive.best.won) {
    return `目标：比最好的一局（完成 ${archive.best.battlesCompleted} 场 / 获胜 ${archive.best.battlesWon} 场）走得更远。`;
  }
  if (archive.best.battlesWon < ADVENTURE_TOTAL_BATTLES) {
    return `目标：全胜通关（${ADVENTURE_TOTAL_BATTLES} 战全胜，当前最佳获胜 ${archive.best.battlesWon} 场）。`;
  }
  return `目标：追平或刷新通关耐久纪录（当前最佳终点耐久 ${archive.best.finalHpPct}%）。`;
}
