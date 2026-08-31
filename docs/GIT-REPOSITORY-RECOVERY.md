# Git 仓库恢复指南（F-REPO-HEALTH-GUARD-P0）

> 适用范围：`D:\0818new\最强水果`（Windows / WorkBuddy 环境）。
> 背景：某轮 `git stash push` 后出现 **refs/heads 内容消失、HEAD commit 对象本地缺失、git 无法解析当前提交**，
> 最终通过 `git fetch origin` + 重建分支 ref 恢复。本指南是**人工**恢复流程——健康门禁
> （`scripts/repo-health.js`）只读、失败即停，绝不自动修复。

## 0. 环境铁律（必须先读）

| 操作 | 结论 |
|------|------|
| `git stash` | **本环境禁止**（stash push 曾触发对象库损坏） |
| `git reset --hard` / `git checkout --` | **禁止**（丢失未提交改动/工作区） |
| 删除 `.git` / 手动删 objects | **禁止**（不可逆） |
| 未备份直接写 ref | **禁止**（先三路核对再写） |
| `git fetch origin <branch>` | **允许**（只读拉取对象，不改工作区） |
| 临时保存改动 | 用外部 binary patch（见 §3） |

## 1. 确认 HEAD 对象缺失

```bash
# 健康门禁快速自检（只读）
node scripts/repo-health.js        # 若已提供 CLI，否则用测试命令

# 手动确认（只读）
git rev-parse HEAD                 # 能返回 sha 吗？
git cat-file -t HEAD               # 期望 commit；报错 = 对象缺失
git cat-file -t <sha>              # 具体对象是否可读
git fsck --connectivity-only       # 期望无 missing / broken link 输出
```

**症状**：`git status` 报 `bad object HEAD`；`git rev-parse HEAD` 返回 sha 但 `cat-file -t` 失败。
此时**不要** `git fsck --full --no-reflogs --unreachable` 乱删（`--unreachable` 可能清掉你需要的对象）。

## 2. 保存未提交改动（先备份，再动仓库）

```bash
# 输出到【仓库外】目录（绝不写入 .git 或工作树内）
mkdir -p /tmp/git-backup-<日期>
git diff > /tmp/git-backup-<日期>/worktree.patch
git diff --cached > /tmp/git-backup-<日期>/staged.patch    # 若有已暂存改动
git status --porcelain > /tmp/git-backup-<日期>/status.txt

# 【必须】验证 patch 非空：确认改动真的被捕获，才能进行 fetch 等恢复操作
wc -c /tmp/git-backup-<日期>/worktree.patch     # >0 且有内容
grep -c '^diff' /tmp/git-backup-<日期>/worktree.patch
```

> patch 是二进制安全的外部文件（`git diff` 输出），与 `git stash` 不同：它不触碰 `.git` 内部结构，
> 不写 refs、不改 index 之外的对象图。**验证非空后才允许 fetch**（防止改动随仓库损坏一起丢失）。

## 3. 从 origin 只读 fetch 恢复对象

```bash
git fetch origin foundation-02-wechat
# 恢复后验证
git cat-file -t 031b8d3...          # 之前缺失的 commit 对象应变为可读
git rev-parse origin/foundation-02-wechat
```

`git fetch` 只写入对象库与 remote-tracking ref（`refs/remotes/origin/*`），**不碰工作区、
不碰 `refs/heads/*`**——是安全的只读恢复手段。若远端也没有该对象（本地未推送的 commit 丢失），
则无法从 origin 恢复，需另寻备份。

## 4. 三路 SHA 核对（重建 ref 前必须）

```bash
echo "HEAD 解析    = $(git rev-parse HEAD)"                 # 本地 HEAD
echo "origin ref   = $(git rev-parse origin/foundation-02-wechat)"
echo "remote 确认   = $(git ls-remote origin foundation-02-wechat | cut -f1)"  # 网络权威
```

- **三路一致** → 说明只是本地 ref 文件丢失（对象完好），可重建（见 §5）。
- **本地 HEAD ≠ origin** → 说明本地有未推送的提交，**重建 ref 会指向哪个 sha 需要你人工确认**
  （用 reflog / fsck 找可达对象），不确定就停。

## 5. 何时可以重建 branch ref

**仅当**：§4 三路 SHA 一致（本地对象库含该 commit）且 `refs/heads/<branch>` 文件缺失。

```bash
# 确认目标对象存在
git cat-file -t <三路一致的sha>        # 必须是 commit

# 先备份旧 ref（若存在任何内容）
ls .git/refs/heads/ 2>/dev/null
mkdir -p .git/refs/heads
printf '%s\n' '<三路一致的sha>' > .git/refs/heads/foundation-02-wechat

# 重建后立即验证
cat .git/refs/heads/foundation-02-wechat
git log --oneline -1
git status --short | head
```

> 重建 ref 是**最后手段**，只在「对象完好 + 三路一致」时执行；写完必须立刻 `git log` 验证
> 落盘（本环境 ref 写入偶发不落盘，未验证不得继续）。

## 6. 恢复后复验

```bash
node scripts/repo-health.js        # 健康门禁全部 PASS
git push origin foundation-02-wechat   # 确认远端同步
```

## 7. 本环境禁止操作清单（速查）

- ❌ `git stash`（含 `stash push/pop/apply`）
- ❌ `git reset --hard` / `git checkout --` / `git clean -f`
- ❌ 删除 `.git`、`objects`、`refs` 下的任何文件
- ❌ 未备份直接改 ref / `git update-ref`（本环境 update-ref 静默失败且会清 refs 子目录）
- ❌ `git fsck` 的 `--unreachable` / `--no-reflogs` 清理动作
- ✅ 允许：`git fetch`、`git diff` 输出外部 patch、`git cat-file`/`rev-parse`/`ls-remote` 等只读命令
