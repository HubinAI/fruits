/**
 * F-REPO-HEALTH-GUARD-P0｜scripts/repo-health.js（纯 ESM JavaScript）的 TypeScript 声明。
 * 仅供 tests/ 从 .ts 导入时类型检查；运行由 node 直接执行 .js 本体。
 */

/** 关键检查名（任一失败 → RC 拒绝）。 */
export const CRITICAL_CHECKS: string[];

/** git 命令执行器（cwd=root；仅去末尾换行；失败抛错）。 */
export function git(args: string[], root: string): string;

/** 仓库健康检查（只读）。runner 可注入（测试 mock）；默认真实 git。 */
export function checkRepoHealth(
  runner: ((args: string[]) => string) | null,
  root: string,
): {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
};

/** 人工恢复指引（供 RC 门禁失败时输出）。 */
export function recoveryGuidance(): string;
