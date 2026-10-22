/**
 * FRUITS-ADVENTURE-FULL-PLAYABLE-R3｜隔离测试档案（meta 成长，不影响正式存档）。
 *
 * 设计约束（验收③ + Queue 必改 3）：
 *   - 局外成长**不写**正式玩家存档（`strongfruit.playerBuild.v1`），只写本隔离键；
 *   - 键名明确带 `testArchive` 前缀，与正式存档键在命名与用途上完全隔离；
 *   - 所有写入均为**真实结算数据**（实际战斗数 / 实际强化 / 实际胜负），绝不生成假领奖结果；
 *   - 重开（restart）只重置当局状态，**保留**本档案（进度跨局累积）。
 *
 * ⚠️ 仅依赖浏览器 `localStorage`（与冻结 Run 体系一致）；无 SSR / Node 直跑场景由调用方兜底。
 */
const ARCHIVE_KEY = 'strongfruit.adventure.r3.testArchive.v1';
const ARCHIVE_VERSION = 1;
const MAX_RUNS = 12;

export interface AdvRunSummary {
  readonly seedLabel: string;
  readonly won: boolean;
  readonly dayReached: number;
  readonly dayTotal: number;
  readonly battlesCompleted: number;
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
    readonly dayReached: number;
    readonly won: boolean;
    readonly seedLabel: string;
  } | null;
  readonly totals: {
    readonly runs: number;
    readonly wins: number;
    readonly battlesWon: number;
  };
}

function emptyArchive(): AdvArchive {
  return { version: ARCHIVE_VERSION, runs: [], best: null, totals: { runs: 0, wins: 0, battlesWon: 0 } };
}

function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** 读取隔离测试档案（缺失 / 损坏 → 空档案，不影响游戏）。 */
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
      totals: parsed.totals ?? { runs: 0, wins: 0, battlesWon: 0 },
    };
  } catch {
    return emptyArchive();
  }
}

/** 写入一局结算（真实数据），返回更新后的档案。调用方负责保存。 */
export function recordRun(summary: AdvRunSummary): AdvArchive {
  const cur = readArchive();
  const runs = [summary, ...cur.runs].slice(0, MAX_RUNS);
  const totals = {
    runs: cur.totals.runs + 1,
    wins: cur.totals.wins + (summary.won ? 1 : 0),
    battlesWon: cur.totals.battlesWon + summary.battlesCompleted,
  };
  const best =
    !cur.best || summary.battlesCompleted > cur.best.battlesCompleted || (summary.won && !cur.best.won)
      ? {
          battlesCompleted: summary.battlesCompleted,
          dayReached: summary.dayReached,
          won: summary.won,
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

/** 基于档案推导「下一局目标」（明确的局外成长动机，真实数据派生）。 */
export function nextRunGoal(archive: AdvArchive): string {
  if (!archive.best) return '目标：撑过第一场战斗，活着走到终点。';
  if (!archive.best.won) {
    return `目标：比最好的一局（第 ${archive.best.dayReached} 天 / ${archive.best.battlesCompleted} 胜）走得更远。`;
  }
  const target = archive.best.battlesCompleted + 1;
  return `目标：刷新最佳战绩（当前 ${archive.best.battlesCompleted} 胜），挑战 ${target} 场不败。`;
}
