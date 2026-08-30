/**
 * F-WX-RC-REPRODUCIBLE-BUILD-P0｜RC 包可复现门禁（纯函数 + git 薄封装）。
 *
 * 供 scripts/wechat-rc.js 与 tests/rcGate.test.ts 复用：
 * - 受控路径判定（src/ tests/ scripts/ wechat/ package.json vite 配置 tsconfig 等；
 *   .workbuddy/memory、dist、outputs 等非源码记录忽略）；
 * - `git status --porcelain` 行 → 受控 dirty 文件列表；
 * - rc-build.json 内容生成（fullSha/shortSha/branch/dirty/buildTime/buildMode）；
 * - 三方 SHA 校验（badge 前 7 位 = HEAD 前 7 位；rc-build.json fullSha = HEAD；bundle runtimeInfo = HEAD）。
 *
 * 注意：本文件为纯 ESM JavaScript（node 直接执行，不使用 TS 语法）。
 */
import { execFileSync } from 'node:child_process';

/** 受控路径前缀：存在未提交/已暂存改动时 RC 构建必须失败（Must#2）。 */
export const CONTROLLED_PREFIXES = [
  'src/',
  'tests/',
  'scripts/',
  'wechat/',
  'package.json',
  'package-lock.json',
  'vite.',
  'tsconfig',
];

/** 非源码记录前缀：忽略（.workbuddy/memory、dist、outputs 等；Must#2）。 */
export const IGNORED_PREFIXES = [
  '.workbuddy/',
  'dist',
  'outputs/',
  'HANDOFF_',
  '_verify',
  '交接文档',
  '最强水果',
  'vitest_cross2.log',
];

function norm(p) {
  return p.replace(/\\/g, '/');
}

/** 是否为受控路径（受控前缀命中即真；不依赖忽略表）。 */
export function isControlledPath(p) {
  const n = norm(p);
  for (const pre of CONTROLLED_PREFIXES) if (n.startsWith(pre)) return true;
  return false;
}

/** 是否命中忽略前缀（非源码记录）。 */
export function isIgnoredPath(p) {
  const n = norm(p);
  for (const pre of IGNORED_PREFIXES) if (n.startsWith(pre)) return true;
  return false;
}

/**
 * 从 `git status --porcelain`（v1）输出行过滤「受控且 dirty」的路径。
 * 行格式：`XY path`（X=index，Y=worktree）；rename/copy 为 `R  old -> new`（取 new）；
 * 引号包裹（含空格/特殊字符）时剥离；未识别路径默认按受控处理（宁严勿松，Must#3）。
 */
export function filterControlledDirty(statusLines) {
  const out = [];
  for (const line of statusLines) {
    if (!line || line.length < 4) continue;
    let path = line.replace(/\r$/, '').slice(3).trim();
    const arrow = path.indexOf(' -> ');
    if (arrow >= 0) path = path.slice(arrow + 4);
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
    if (isControlledPath(path) || !isIgnoredPath(path)) out.push(path);
  }
  return out;
}

/** git 命令执行器（cwd=root；仅去末尾换行，保留行首——porcelain v1 的 X 列可为空格；失败抛错）。 */
export function git(args, root) {
  const out = execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return out.replace(/\r?\n$/, '');
}

/** 当前 Git 状态摘要（runner 可注入以便测试 mock；默认真实 git）。 */
export function readGitState(runner) {
  const run = runner || ((args) => git(args, process.cwd()));
  const branch = run(['branch', '--show-current']);
  const headSha = run(['rev-parse', 'HEAD']);
  // core.quotepath=false：中文/非 ASCII 路径不八进制转义 → 忽略前缀可正确匹配
  const porcelain = run(['-c', 'core.quotepath=false', 'status', '--porcelain']);
  const dirtyFiles = filterControlledDirty(porcelain.split('\n'));
  return { branch, headSha, dirtyFiles };
}

/** rc-build.json 内容（Must#5 字段）。 */
export function makeRcBuildInfo(p) {
  return {
    fullSha: p.fullSha,
    shortSha: p.shortSha,
    branch: p.branch,
    dirty: p.dirty,
    buildTime: p.buildTime,
    buildMode: p.buildMode ?? 'rc',
  };
}

/**
 * 三方 SHA 校验（Must#6）：
 * - badge SHA = git HEAD 前 7 位；
 * - rc-build.json fullSha = git HEAD；
 * - bundle runtimeInfo sha = git HEAD。
 */
export function verifyRcShas(p) {
  return (
    p.badgeSha != null &&
    p.badgeSha === p.headSha.slice(0, 7) &&
    p.rcJsonSha != null &&
    p.rcJsonSha === p.headSha &&
    p.bundleSha != null &&
    p.bundleSha === p.headSha
  );
}

/** 从 bundle（game.js）提取 runtimeInfo sha 字面量；未命中返回 null。 */
const SHA_RE = /"sha"\s*:\s*"([0-9a-f]{40})"/;
export function extractBundleSha(gameJs) {
  const m = SHA_RE.exec(gameJs);
  return m ? m[1] : null;
}
