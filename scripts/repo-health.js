/**
 * F-REPO-HEALTH-GUARD-P0｜Git 仓库健康只读门禁。
 *
 * 事故背景：某轮 `git stash push` 后出现 refs/heads 内容消失、HEAD commit 对象本地缺失、
 * git 无法解析当前提交，最终靠 `git fetch origin` + 重建分支 ref 恢复。本脚本为**只读**
 * 健康检查，供 `scripts/wechat-rc.js` 在 dirty 检查前调用——任一关键检查失败 → RC 拒绝。
 *
 * 只读铁律（Must#2/#4）：绝不自动写 refs / reset / checkout / 删对象 / fetch / push / 清理
 * 工作区；不调用 git stash（本环境禁止）。检查失败输出明确失败项 + 人工恢复步骤
 * （指向 docs/GIT-REPOSITORY-RECOVERY.md），由人决定是否恢复。
 *
 * 纯 ESM JavaScript（node 直接执行，不使用 TS 语法）；检查函数接受可注入 runner 便于测试。
 */
import { execFileSync } from 'node:child_process';

/** 关键检查（任一失败 → RC 拒绝）。 */
export const CRITICAL_CHECKS = [
  'worktree',
  'head-resolve',
  'branch-exists',
  'branch-ref-resolve',
  'head-ref-consistency',
  'origin-branch',
  'head-object',
  'tree-object',
  'fsck-connectivity',
];

/** git 命令执行器（cwd=root；仅去末尾换行；失败抛错——由调用方捕获）。 */
export function git(args, root) {
  const out = execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return out.replace(/\r?\n$/, '');
}

/** 执行 git 命令并吞掉失败（返回 null 表示命令失败/输出无效）。 */
function safeRun(runner, args) {
  try {
    const out = runner(args);
    return out == null ? null : String(out).trim();
  } catch {
    return null;
  }
}

/**
 * 仓库健康检查（只读）。
 * @param runner 可注入命令执行器（默认真实 git，cwd=root）；测试 mock 时注入。
 * @returns { ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }> }
 */
export function checkRepoHealth(runner, root) {
  const run = runner || ((args) => git(args, root));
  const checks = [];
  const record = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

  // a. 当前目录是否为 Git worktree
  const wt = safeRun(run, ['rev-parse', '--is-inside-work-tree']);
  record('worktree', wt === 'true', `is-inside-work-tree=${wt}`);

  // b/c. HEAD 解析 + 当前 branch
  const headSha = safeRun(run, ['rev-parse', 'HEAD']);
  const branch = safeRun(run, ['branch', '--show-current']);
  record('head-resolve', /^[0-9a-f]{40}$/.test(headSha || ''), `HEAD=${headSha ?? 'null'}`);
  record('branch-exists', !!branch && branch !== 'HEAD', `branch=${branch ?? 'null'}`);

  // d. refs/heads/<branch> 解析
  let refSha = null;
  if (branch && branch !== 'HEAD') {
    refSha = safeRun(run, ['rev-parse', 'refs/heads/' + branch]);
    record('branch-ref-resolve', /^[0-9a-f]{40}$/.test(refSha || ''), `refs/heads/${branch}=${refSha ?? 'null'}`);
  } else {
    record('branch-ref-resolve', false, 'branch 为空，无法解析 refs/heads');
  }

  // e. HEAD == branch ref == rev-parse 一致
  const consistent = !!headSha && !!refSha && headSha === refSha;
  record('head-ref-consistency', consistent, `HEAD=${headSha} ref=${refSha}`);

  // f. origin 对应 branch 存在（只读 ls-remote，不写本地）
  const remoteSha = branch ? safeRun(run, ['ls-remote', '--heads', 'origin', branch]) : null;
  const remoteOk = !!remoteSha && remoteSha.split('\t')[0] === headSha;
  record('origin-branch', remoteOk, `origin/${branch ?? '?'}=${remoteSha ? remoteSha.split('\t')[0] : 'null'}`);

  // g. HEAD 对象及其 tree 对象可读
  const headType = safeRun(run, ['cat-file', '-t', 'HEAD']);
  record('head-object', headType === 'commit', `cat-file -t HEAD=${headType ?? 'null'}`);
  let treeSha = null;
  let treeType = null;
  if (headSha) {
    treeSha = safeRun(run, ['rev-parse', headSha + '^{tree}']);
    if (treeSha) treeType = safeRun(run, ['cat-file', '-t', treeSha]);
  }
  record('tree-object', !!treeSha && treeType === 'tree', `HEAD^{tree}=${treeSha ?? 'null'} (${treeType ?? 'null'})`);

  // h. git fsck --connectivity-only 无 missing/broken link（只读校验，不删任何对象）
  const fsckOut = safeRun(run, ['fsck', '--connectivity-only']);
  const hasMissing = !!fsckOut && /(missing|broken link|dangling commit .* missing)/.test(fsckOut);
  record('fsck-connectivity', !hasMissing, fsckOut ? (hasMissing ? fsckOut.split('\n').filter((l) => /missing|broken/.test(l)).slice(0, 3).join(' | ') : 'clean') : 'null');

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

/** 恢复指引（供 wechat-rc.js 输出；人工操作见 docs/GIT-REPOSITORY-RECOVERY.md）。 */
export function recoveryGuidance() {
  return [
    '仓库健康检查失败，RC 构建已拒绝（未做任何自动修复——健康门禁只读）。',
    '请按 docs/GIT-REPOSITORY-RECOVERY.md 人工处理：',
    '  1) 确认失败项（HEAD 对象缺失 / branch ref 缺失 / SHA 不一致 / 远端分支缺失 / fsck missing）；',
    '  2) 如需保留未提交改动：git diff > 仓库外目录的 patch 文件，验证非空后再动仓库；',
    '  3) 恢复对象：git fetch origin <branch>（只读拉取，不改工作区）；',
    '  4) 重建 ref 前必须三路 SHA 核对（local/ref/remote）；',
    '  5) 禁止：git reset --hard / git checkout -- / 删除 .git / 未备份写 ref / git stash。',
  ].join('\n');
}
