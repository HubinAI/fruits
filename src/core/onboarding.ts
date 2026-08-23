/**
 * Q26｜V0.7 新账号首轮引导状态。
 *
 * 设计约束（来自 Queue 冻结项 / 禁止项）：
 * - 只持久化「是否已完成首轮闭环」，不引入新页面 / 强制遮罩链 / 大型教程状态机；
 * - 全新账号（启动时尚无已保存的玩家 Build）进入 pending，首 Garage / 首 Result 给极简提示；
 * - 老存档（已有 Build，含非法旧档被清空回退）一律视为已完成，直接 done，不进引导；
 * - 玩家完成一次 Battle→Result→Garage 后调用 completeOnboarding 置 done，永久关闭；
 * - 无 localStorage（隐私模式 / SSR / node 测试）静默降级为 pending（不影响游戏）；
 * - 不触碰 Weapon / Physics / 经济 / 段位逻辑（那些在各自模块）。
 */
import { loadPlayerBuild } from './buildPersistence';

export type OnboardingStage = 'pending' | 'done';

const STORAGE_KEY = 'strongfruit.onboarding.v1';

/** 读引导状态：'pending' | 'done' | null（无标志） */
export function loadOnboarding(): OnboardingStage | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Record<string, unknown>;
    if (d && d.stage === 'done') return 'done';
    if (d && d.stage === 'pending') return 'pending';
    return null;
  } catch {
    return null;
  }
}

/** 写引导状态（隐私模式 / 配额失败静默忽略） */
export function saveOnboarding(stage: OnboardingStage): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ stage }));
  } catch {
    // 写入失败静默忽略
  }
}

/**
 * 是否全新账号：启动时尚无已保存的玩家 Build（loadPlayerBuild 返回 null）。
 * 老存档（含非法旧档被 buildPersistence 清为 null 的情况）统一走「已有账号」路径 → 不进引导。
 */
export function isFreshAccount(): boolean {
  return loadPlayerBuild() === null;
}

/**
 * 启动期解析引导阶段（幂等，可安全多次调用）：
 * - 已有显式 done 标志 → done；
 * - 已有显式 pending 标志 → pending（保持，不重新判定 fresh，刷新一致）；
 * - 无显式标志（首次运行 Q26）：
 *    · 老存档（非 fresh）→ 标记 done 并持久化；
 *    · 全新账号 → 标记 pending 并持久化（保证刷新后仍 pending，直到完成闭环）。
 */
export function resolveOnboardingStage(): OnboardingStage {
  const existing = loadOnboarding();
  if (existing === 'done') return 'done';
  if (existing === 'pending') return 'pending';
  if (!isFreshAccount()) {
    saveOnboarding('done');
    return 'done';
  }
  saveOnboarding('pending');
  return 'pending';
}

/** 完成首轮闭环（Battle→Result→Garage 后调用），持久化 done。可重复调用（幂等）。 */
export function completeOnboarding(): void {
  saveOnboarding('done');
}
