# 《最强水果》WorkBuddy 会话交接（2026-08-20 22:55）

> 本文件是会话交接包：新窗口接手时先读本文件 + 项目基线
> `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md`（V1.0）。
> 详细逐队列日志见 `.workbuddy/memory/2026-08-20.md`。

---

## 0. 核心定位（判断机制是否保留的唯一标准）

极简策略 + 事前组装 + 自动物理战斗。
玩家循环：「我觉得这样能赢 → 看它自己打 → 原来问题在这 → 改一下再试」。
**每个机制必须让玩家做出不同的下一步动作，否则不保留。**

指令优先级：①最新明确的单次执行指令（最高）②稳定项目边界 ③历史草稿。
方案漂移红线、三层验收（技术正确 → 方案落地 → 实际体验成立）见基线文件。

---

## 1. 当前 Git 状态（接手先确认）

| 项 | 值 |
|---|---|
| 分支 | `foundation-02-canonical`（顶层名，commit ref 自动落盘） |
| HEAD | `efad32c47771c3ca2d00a50a3e72b2163402d949`（= 远端，ls-remote 已确认） |
| 旧分支 | `feature/foundation-02-canonical` 仍 = `d0411fb`（已弃用，**勿删**） |
| 工作区未提交 | 仅 `.workbuddy/memory/` 旧日志与交接 MD（全非生产，勿动） |
| dev server | 运行中 `http://localhost:5173`（strictPort 5173；右下角 Badge 显示 branch @ shortSHA） |

## 2. 环境惯例（必须遵守，否则踩坑）

1. **Node**：用 managed 24.x 或系统 22.22.2 均可（本项目无 engines 限制）。
2. **vitest**：所有命令必须带 `--pool=vmThreads --maxWorkers=1`，否则 `reading 'config'` 误报全失败：
   `node node_modules/vitest/vitest.mjs run tests/ --pool=vmThreads --maxWorkers=1`
3. **scoped tsc**：`node_modules/.bin/tsc --noEmit`（tsconfig include 已移除 vite.config.ts）。
4. **git push**：走 SSH `git@github.com:HubinAI/fruits.git`（`~/.ssh/config` 走 `ssh.github.com:443`）。
   push 后必须 `git ls-remote origin foundation-02-canonical` 对比 = 本地 HEAD。
5. **git commit**：顶层分支（无 `/`）自动落盘；**含 `/` 的 ref 写入被环境静默拦截**（勿用 `feature/` 前缀分支名；旧分支勿再 commit）。
6. **中文路径伪影**：`git status` 把 `planck` 显示为 `plank`（无 c）；真实文件名始终有 c。
7. **【重要·git 损坏恢复经验】**：`git stash` 在此环境会失败并可能清掉 `.git/refs/heads/` 与 `.pack` 数据（对象库损坏）。
   已验证恢复路径：`mv .git .git.broken-*` → `git init -b foundation-02-canonical` → `git remote add origin <ssh>` →
   `git fetch origin foundation-02-canonical` → `git reset FETCH_HEAD`（**mixed**，保留工作区改动）→ 验证 `git status`。
   结论：**不要用 git stash**。
8. **vite 8 define 不生效**：`define: { __X__: ... }` 在 vite 8 不替换标识符 → 改用**虚拟模块**（resolveId/load 注入）。
   Runtime Badge 已用 `virtual:runtime-info` 虚拟模块实现（类型声明在 `src/virtual-runtime-info.d.ts`）。

## 3. 本会话完成的队列（2026-08-20，5 个）

| commit | 队列 | 内容 |
|---|---|---|
| `3adfd2f` | Q11-C-R2-RECOVER | 镭射 R2 未落地追查（判定 A 类从未实现）并恢复：muzzleSpeed 16→56（保留 gravityScale 0 直线）、recoil 改作用于 vehicle.body（chassis）、Renderer 圆球→150px 长条能量束（RenderProjectile +velocity 只读标记）、音效闭环（charge 升调 + fire 爆鸣/低频冲击 + Start resume AudioContext） |
| `046b02e` | F-DEV-1 | Runtime 版本可追溯：右下角 Badge（branch @ shortSHA，virtual:runtime-info 虚拟模块 git 注入）、strictPort（端口占用直接失败实测）、启动打印 cwd/branch/HEAD/port、PART_OPTIONS 移入 `src/core/partOptions.ts`（UI 与测试共用数据源）+ smoke 测试（不含 wedgeShovel 含 spear/laser） |
| `fd70f20` | Q12-A | 冲撞头 Weapon：复用 ramHead Runtime（behavior ram 直击），collider 20×30→44×26 offset 22（短粗前置 vs 刺 96×6），PART_OPTIONS「冲撞头」+ Q12 场景；适配 2 个既有测试（COM 85→97、spawnB 640→700） |
| `0a9cef9` | Q12-B | 举升臂 Gadget：front Revolute（复用 Hammer 的 motor/limit），状态机 rest→lift(70°)→hold→lower，臂 100×14 offset {50,0}，无 baseDamage → 无 Direct Weapon Damage；PART_OPTIONS「举升臂」+ Q12-B 场景 |
| `63ef7ae` | Q12-C | 冲锤 Weapon：Prismatic（复用 Push Rod 的 motor/limit），状态机 rest(前摇)→strike(快伸 8px/step)→hold→retract，行程 160px，baseDamage 70 → 真实 Contact 伤害；maxForce 200→500（修锤头顶住对手卡住）；PART_OPTIONS「冲锤」+ Q12-C 场景 |

## 4. 当前正式 Content 盘点（PART_OPTIONS，玩家装配页）

`空 / 炮(cannon) / 锤(hammer) / 推杆(pushRod) / 刺(spear) / 镭射(laser) / 冲撞头(ramHead) / 举升臂(lifter) / 冲锤(rammer)` —— 9 项。

- **Weapon**：cannon（弹道+后坐）、hammer（Revolute 摆锤 90 伤害）、spear（固定长刺 80）、laser（蓄能镭射 160）、ramHead（短粗冲撞 80）、rammer（Prismatic 冲锤 70）
- **Gadget**：pushRod（Prismatic 伸缩位移，无伤害）、lifter（Revolute 上翻，无伤害）
- **Archived**：wedgeShovel（Q11-A-CLOSE 退出，registry/Scenario 保留，**勿复活**）

## 5. 测试状态

`vitest 76 文件 418/418 + 全量 tsc 0 error`（buildUx 35 个：Q11-C / Q12-A / Q12-B / Q12-C / F-DEV-1 全覆盖）。
新增 behaviorRegistry 已含：cannon/hammer/pushRod/laser/lifter/rammer。

## 6. 已知坑速查

- **git stash 危险**（勿用，见 §2.7）
- **vite 8 define 不生效**（用虚拟模块，见 §2.8）
- **测试跨 world 用旧 part joint 报错**（场景测试要重新 `find` part）
- **ramHead collider 变更会波及 lightVehicle/heavyVehicle preset（B 也装 ramHead）**——弹道测试 spawn 距离需适配（projectileRenderSnapshot spawnB 640→700）
- **dev server 改 vite.config 需重启**（HMR 不覆盖 config 变更完整语义）；重启：kill 5173 进程后 `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort`
- **Badge 验收**：真人录像前先看右下角 Badge 的 branch @ SHA 与 `git log` 一致，避免录到旧 Runtime

## 7. 建议下一步（未做，供新窗口参考）

- Physics Lab 集中验收 Q12-A/B/C（正式速度 + Debug 关，录像检查：冲撞头正面撞 vs 擦空、举升臂翻起弧内顶起 vs 错过、冲锤前摇→伸出→命中→回收）
- Q12-B 举升臂翻起弧内顶起的时序优化（当前 banana 到达时臂常处回落/待机；臂翻起 70° 时水平投影缩短够不到停靠位的 banana——已有「低位挡 24.7px 抬起」满足验收，但「翻起弧内顶起」可再调）
- Cannon 全距离/伤害数值回收（多队列标注「初版故意做大、后续真人验收再回收」）
