/**
 * F-WX-RC-REPRODUCIBLE-BUILD-P0｜scripts/rc-gate.js（纯 ESM JavaScript）的 TypeScript 声明。
 * 仅供 tests/ 从 .ts 导入时类型检查；运行由 node 直接执行 .js 本体。
 */

/** 受控路径前缀：存在未提交/已暂存改动时 RC 构建必须失败。 */
export const CONTROLLED_PREFIXES: string[];
/** 非源码记录前缀：忽略（.workbuddy/memory、dist、outputs 等）。 */
export const IGNORED_PREFIXES: string[];

/** 是否为受控路径（受控前缀命中即真；不依赖忽略表）。 */
export function isControlledPath(p: string): boolean;

/** 是否命中忽略前缀（非源码记录）。 */
export function isIgnoredPath(p: string): boolean;

/** 从 `git status --porcelain`（v1）输出行过滤「受控且 dirty」的路径。 */
export function filterControlledDirty(statusLines: string[]): string[];

/** git 命令执行器（cwd=root；仅去末尾换行；失败抛错）。 */
export function git(args: string[], root: string): string;

/** 当前 Git 状态摘要（runner 可注入以便测试 mock；默认真实 git）。 */
export function readGitState(
  runner?: (args: string[]) => string,
): { branch: string; headSha: string; dirtyFiles: string[] };

/** rc-build.json 内容（Must#5 字段）。 */
export function makeRcBuildInfo(p: {
  fullSha: string;
  shortSha: string;
  branch: string;
  dirty: boolean;
  buildTime: string;
  buildMode?: string;
}): { fullSha: string; shortSha: string; branch: string; dirty: boolean; buildTime: string; buildMode: string };

/** 三方 SHA 校验（badge 前 7 位 = HEAD 前 7 位；rcJson = HEAD；bundle = HEAD）。 */
export function verifyRcShas(p: {
  headSha: string;
  badgeSha: string | null;
  rcJsonSha: string | null;
  bundleSha: string | null;
}): boolean;

/** 从 bundle（game.js）提取 runtimeInfo sha 字面量；未命中返回 null。 */
export function extractBundleSha(gameJs: string): string | null;
