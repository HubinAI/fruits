/**
 * F-REPO-HEALTH-GUARD-P0｜仓库健康门禁 targeted test。
 *
 * 全部使用 runner 注入 / fixture 模拟，**绝不触碰真实 .git**（Must#6）：
 * - 健康仓库通过；
 * - HEAD 对象缺失 / branch ref 缺失 / HEAD≠ref / remote 缺失 / fsck missing → 各自失败；
 * - 失败时 ok=false 且失败项 name 正确；
 * - 只读约束：不调用任何写命令（reset/checkout/rm/fetch 等不在 runner 路径）。
 */
import { describe, it, expect } from 'vitest';
import { checkRepoHealth, CRITICAL_CHECKS, recoveryGuidance } from '../scripts/repo-health.js';

const HEAD = '031b8d331940b75a8d2fd2736c101039347564bb';
const TREE = '8da65d5004c484926b5d87e90a14ab37947d0208';

/** 健康 runner：按命令分发返回真实值。 */
function healthyRunner(overrides: Record<string, (args: string[]) => string> = {}) {
  return (args: string[]): string => {
    const key = args.join(' ');
    if (overrides[key]) return overrides[key](args);
    if (key === 'rev-parse --is-inside-work-tree') return 'true';
    if (key === 'rev-parse HEAD') return HEAD;
    if (key === 'branch --show-current') return 'foundation-02-wechat';
    if (key === 'rev-parse refs/heads/foundation-02-wechat') return HEAD;
    if (key.startsWith('ls-remote --heads origin')) return `${HEAD}\trefs/heads/foundation-02-wechat`;
    if (key === 'cat-file -t HEAD') return 'commit';
    if (key === `rev-parse ${HEAD}^{tree}`) return TREE;
    if (key === `cat-file -t ${TREE}`) return 'tree';
    if (key === 'fsck --connectivity-only') return '';
    throw new Error('unexpected args: ' + key);
  };
}

function resultOf(checks: Array<{ name: string; ok: boolean; detail: string }>, name: string) {
  return checks.find((c) => c.name === name)!;
}

describe('F-REPO-HEALTH-GUARD-P0｜健康仓库', () => {
  it('1. 健康仓库：全部关键检查通过（ok=true，9 项全 PASS）', () => {
    const r = checkRepoHealth(healthyRunner(), process.cwd());
    expect(r.ok).toBe(true);
    expect(r.checks.length).toBe(CRITICAL_CHECKS.length);
    for (const c of r.checks) expect(c.ok, `${c.name}: ${c.detail}`).toBe(true);
  });

  it('2. 非 worktree：worktree 检查失败', () => {
    const runner = healthyRunner({ 'rev-parse --is-inside-work-tree': () => 'false' });
    const r = checkRepoHealth(runner, process.cwd());
    expect(r.ok).toBe(false);
    expect(resultOf(r.checks, 'worktree').ok).toBe(false);
  });
});

describe('F-REPO-HEALTH-GUARD-P0｜事故场景模拟（Must#6）', () => {
  it('3. HEAD 对象缺失（cat-file -t HEAD 抛错 → head-object 失败）', () => {
    const runner = healthyRunner({
      'cat-file -t HEAD': () => {
        throw new Error('fatal: bad object HEAD');
      },
    });
    const r = checkRepoHealth(runner, process.cwd());
    expect(r.ok).toBe(false);
    expect(resultOf(r.checks, 'head-object').ok).toBe(false);
    expect(resultOf(r.checks, 'head-object').detail).toContain('null');
  });

  it('4. branch ref 缺失（rev-parse refs/heads/<b> 抛错 → branch-ref-resolve 失败）', () => {
    const runner = healthyRunner({
      'rev-parse refs/heads/foundation-02-wechat': () => {
        throw new Error('fatal: ambiguous argument');
      },
    });
    const r = checkRepoHealth(runner, process.cwd());
    expect(r.ok).toBe(false);
    expect(resultOf(r.checks, 'branch-ref-resolve').ok).toBe(false);
    expect(resultOf(r.checks, 'head-ref-consistency').ok).toBe(false);
  });

  it('5. local/ref SHA 不一致（ref 指向旧 sha → head-ref-consistency 失败）', () => {
    const runner = healthyRunner({
      'rev-parse refs/heads/foundation-02-wechat': () => '57bdbb30db8512c3f8c7df61975b70e1e45f8b88',
    });
    const r = checkRepoHealth(runner, process.cwd());
    expect(r.ok).toBe(false);
    expect(resultOf(r.checks, 'head-ref-consistency').ok).toBe(false);
    expect(resultOf(r.checks, 'head-ref-consistency').detail).toContain(HEAD);
  });

  it('6. remote branch 缺失（ls-remote 无输出 → origin-branch 失败）', () => {
    const runner = healthyRunner({
      'ls-remote --heads origin foundation-02-wechat': () => '',
    });
    const r = checkRepoHealth(runner, process.cwd());
    expect(r.ok).toBe(false);
    expect(resultOf(r.checks, 'origin-branch').ok).toBe(false);
  });

  it('7. remote SHA 与本地不一致（ls-remote 返回不同 sha → origin-branch 失败）', () => {
    const runner = healthyRunner({
      'ls-remote --heads origin foundation-02-wechat': () => 'c660be192e078a9a0b188af4ae0be994dc1b6dbb\trefs/heads/foundation-02-wechat',
    });
    const r = checkRepoHealth(runner, process.cwd());
    expect(r.ok).toBe(false);
    expect(resultOf(r.checks, 'origin-branch').ok).toBe(false);
  });

  it('8. fsck 出现 missing object → fsck-connectivity 失败', () => {
    const runner = healthyRunner({
      'fsck --connectivity-only': () => 'error: 031b8d331940b75a8d2fd2736c101039347564bb: missing commit 031b8d3',
    });
    const r = checkRepoHealth(runner, process.cwd());
    expect(r.ok).toBe(false);
    expect(resultOf(r.checks, 'fsck-connectivity').ok).toBe(false);
    expect(resultOf(r.checks, 'fsck-connectivity').detail).toContain('missing');
  });

  it('9. HEAD 无法解析（rev-parse HEAD 抛错 → head-resolve 失败且一致性失败）', () => {
    const runner = healthyRunner({
      'rev-parse HEAD': () => {
        throw new Error('fatal: bad object HEAD');
      },
      'rev-parse refs/heads/foundation-02-wechat': () => HEAD,
      'ls-remote --heads origin foundation-02-wechat': () => '',
    });
    const r = checkRepoHealth(runner, process.cwd());
    expect(r.ok).toBe(false);
    expect(resultOf(r.checks, 'head-resolve').ok).toBe(false);
    expect(resultOf(r.checks, 'head-ref-consistency').ok).toBe(false);
  });
});

describe('F-REPO-HEALTH-GUARD-P0｜只读约束与恢复指引', () => {
  it('10. 健康检查只调用只读 git 命令（无 reset/checkout/rm/fetch/push/stash/update-ref）', () => {
    const invoked: string[] = [];
    const runner = (args: string[]) => {
      invoked.push(args[0] + ' ' + args.slice(1).join(' '));
      return healthyRunner()(args);
    };
    checkRepoHealth(runner, process.cwd());
    for (const line of invoked) {
      for (const banned of ['reset', 'checkout', 'clean', 'rm ', 'fetch', 'push', 'stash', 'update-ref', 'gc', 'prune', 'branch -D']) {
        expect(line, `禁止命令被调用: ${line}`).not.toContain(banned);
      }
    }
  });

  it('11. 恢复指引包含人工步骤与禁止操作（reset/checkout/删除 .git/stash/未备份写 ref）', () => {
    const g = recoveryGuidance();
    expect(g).toContain('docs/GIT-REPOSITORY-RECOVERY.md');
    expect(g).toContain('fetch origin');
    expect(g).toContain('reset --hard');
    expect(g).toContain('git stash');
  });
});
