# CURRENT STATE｜《最强水果》当前最新状态

> **日期**：2026-10-03（Mac 技术迁移验收已通过，见 §0）
> **HEAD**：`925c79dc4ec812c98a0235fdddf6a4caf9bc0b3d`
> **分支**：`prototype-portrait-battle-lab`（实验分支，可整块删除）｜**主线**：`foundation-02-wechat`
> **远端**：`origin git@github.com:HubinAI/fruits.git`
>
> ⚠️ 本文件是**快照**。HEAD 会前移；核对时以 `git rev-parse HEAD` 与 `git log` 为准。
> 结构性口径见 `PROJECT_BASELINE.md`；纪律见 `WORKBUDDY_RULES.md`。

---

## 0. 迁移基线与 Mac 验收结论（**新窗口先读这段**）

**当前迁移基线 HEAD = `925c79d`**（分支 `prototype-portrait-battle-lab`），四路 SHA 一致：
HEAD / 本机 ref / `origin/<branch>` / `git ls-remote` 直连远端。

⚠️ **本文件与另两份 handoff 的头部字段仍写 `7241aab` —— 那已过期一格，是文档滞后，不是代码冲突。**
`7241aab` 的两个后继（都在本分支上）：

```
925c79d infra(e2e): Playwright 正式入册 + 33 个 E2E 统一跨平台浏览器启动（MAC-MIGRATION-E2E-COMPAT-R1）
9e2ba72 docs(handoff): Mac 迁移交接三件套（Baseline / Rules / CurrentState）
7241aab PRODUCT-LOOP-R13-ENCOUNTER-ORDER-MATRIX-R1: Encounter 顺序全排列取证（test-only）
```

### 0.1 Windows → Mac 技术迁移：**已通过**（2026-10-03 验收）

| 层 | 结论 |
|---|---|
| Git（branch / HEAD / origin / 工作树 / stash / fsck） | ✅ 四路 SHA 一致，工作树干净，repo-health **9/9** |
| 依赖（`npm ci` 可恢复性） | ✅ `npm ls --all` 零 invalid/missing；`lightningcss-darwin-arm64` 到位、**零 win32 残留** |
| Playwright / Chromium | ✅ 启动链实测 PASS（Chromium `151.0.7922.34`，DOM 读 + 截图全通） |
| tsc | ✅ `npm run typecheck` exit 0 |
| builds | ✅ **四路**（含 `build:portrait-lab`，见 §附录 A 第 7 步） |
| Product E2E | ✅ 8 条全跑完，**0 条 Mac 归因失败**（`product-fail` 48/48 全绿） |
| **平台行为差异** | ✅ **未发现**。`product-fail` 含真实浏览器 + 真实点击 + 真实 `getImageData` 像素比对，全绿 ⇒ 渲染/点击/像素取证链正常 |

**Mac 环境**：macOS 26.6（Build 25G72）· **arm64** · 系统 Node **v24.21.0** / npm **11.19.0**（均在 `/usr/local/bin`）· git 2.50.1（Apple Git-155）。

### 0.2 ⚠️ 已知环境事实：WorkBuddy 会话默认 Node = 22.22.2（**非 Mac 缺陷 · 未解决 · 需人工处置**）

`package.json` `engines.node = ">=24.0.0"`，但**在 WorkBuddy 里执行 `node -v` 得到 v22.22.2**（你手工 Terminal 里是 v24.21.0）。

- **来源**：WorkBuddy **CLI harness 拥有** managed Node/Python runtime（app.asar 内原文：*“The CLI harness owns command execution, managed Node/Python runtimes…”*）。
  它在 spawn shell 时把 `~/.workbuddy/binaries/node/versions/22.22.2-3/bin` **前插**到 PATH 第 3 位，
  排在 `/usr/local/bin`（第 19 位）之前。
- **已排除的无效路径**（勿重复尝试）：
  - `~/.zshrc` / `~/.zprofile` / `~/.profile` / `~/.zshenv` —— shell 是 **`zsh -c` 非交互**（`ZSH_EVAL_CONTEXT=cmdarg:eval`），
    **profile 文件根本不加载**（`.zshenv` 实测写入后仍是 `UNSET`，已清理）。
  - `~/.workbuddy/settings.json` —— 无 `node` / `env` / `PATH` / `runtime` 任何键（已递归遍历确认）。
  - 项目级 `.workbuddy/settings.json` —— 不存在，且无证据表明支持。
  - `~/.workbuddy/shell-snapshots/*.sh` —— **会话级一次性缓存**（会话开始时生成 2 个，此后 20+ 次调用不再新增），改它无效。
- **结论**：**WorkBuddy 自身不提供项目级 Node 版本覆盖入口**。要让它用 Node 24，只能由用户在
  WorkBuddy 设置界面内切换运行时（本机 grep 到的 `22.22.2-1/-2/-3` 是 CLI 自用运行时版本，不是可选偏好）。
- **在解决前的正确做法**：本项目所有 npm 命令**显式用系统 Node**：
  ```bash
  export PATH=/usr/local/bin:$PATH   # node -v => v24.21.0 / npm -v => 11.19.0
  ```
  **禁止**用改 `engines` / 降级依赖 / 改产品代码的方式绕过（见 §0.3）。

### 0.3 迁移期已确认的既有红（**跨平台同因，不是 Mac 问题，本轮未修**）

| 现象 | 归因 |
|---|---|
| `product-home` A6（`sprites=2` 要求 `>=3`） | 判据由**入库的 5 个 PNG**（`git ls-files assets/` 确认）+ 默认装配决定，Windows 上字节相同 ⇒ 必然同红。属**内容量缺口**（已冻结项） |
| `product-legacy` L8 | 断言 `expectedB` 只清 `front` 却期望保留 `top="hammer"`，而 **Hidden Top Weapon Removal**（P0）会清 `top` ⇒ **断言与已生效契约的口径偏差** |
| `default-entry` F2c（`initialGap=563.66`，期望 ≈606） | 两个视口读数**完全相同** ⇒ 确定性几何读数，非渲染随机性 |
| `product-loop` / `product-reward` / `product-reseed` 的 COMPLETE 相关红与大量 BLOCKED | 根因 = **§5.1 的 Q3 能力缺口**（`hammer`/`rammer` 打不赢完整 Run）。`product-reward` C0a 独立复现同一读数（`phase=FAILED battles=3/3 耐久=0% DAY=4`）。BLOCKED 是安全网**如实登记**，既不计 PASS 也不计 FAIL |

> ⚠️ 这四条**本轮明令未处理**（不顺手改判据、不改产品逻辑）。

---

## 1. 当前 HEAD 与工作树

| 项 | 值 |
|---|---|
| HEAD | `925c79dc4ec812c98a0235fdddf6a4caf9bc0b3d` |
| 分支 | `prototype-portrait-battle-lab` |
| 上游 | `origin/prototype-portrait-battle-lab`（SHA 一致） |
| `origin/prototype-portrait-battle-lab` | `925c79dc4ec812c98a0235fdddf6a4caf9bc0b3d` ✅（`git ls-remote` 直连远端复核） |
| `origin/foundation-02-wechat` | `1bb35d781a31d18c915a52bcfde9fab7bc15496c`（**落后于产品工作**） |
| 工作树 | 干净（Mac 验收时 `git status --porcelain` 为空） |
| `git stash` | 空 |
| `.git/REVERT_HEAD` | 不存在（回退已收口） |

最近提交（倒序）：

```
925c79d infra(e2e): Playwright 正式入册 + 33 个 E2E 统一跨平台浏览器启动（MAC-MIGRATION-E2E-COMPAT-R1）
9e2ba72 docs(handoff): Mac 迁移交接三件套（Baseline / Rules / CurrentState）
7241aab PRODUCT-LOOP-R13-ENCOUNTER-ORDER-MATRIX-R1: Encounter 顺序全排列取证（test-only）
b355338 PRODUCT-LOOP-R12-FIRE-WINDOW-ROLLBACK: 整块回退「对手开火执行期停止后撤」（精确反向 patch）
89c0285 PRODUCT-LOOP-R12-RANGED-TURRET-FIRE-WINDOW: 对手开火执行期停止后撤（单规则）
52a477d PRODUCT-LOOP-R11-RAMMER-REST-ROLLBACK: rammer restSteps 12 -> 24（整块回退该单变量）
c5614ec PRODUCT-LOOP-R11-WEAPON-BALANCE-BATCH-GATE: 批次收口守卫（test-only）
ebadfd9 PRODUCT-LOOP-R11-STRICT-SPACE-RECHECK: 权威可达空间严格重跑（test-only）
```

---

## 2. 最近已通过的重要 Queue

| Queue | 结果 | 关键读数 |
|---|---|---|
| `R6-BATCH` 内容地基批次 | ✅ | Full Run Weapon 登记 7 件 / BLOCK 清单定案 |
| `R7` 武器基础 Build 内容 + Weapon×Encounter 矩阵 | ✅ | 台账 `MX-*` / `BI-*` 建立 |
| `R8` Build 对遭遇的影响 | ✅ | 台账 `BI-04/05/06` |
| `R9` 三段节奏（BATTLE→CHOICE×2→FINAL） | ✅ | `RUN_TOTAL_BATTLES=3` / `RUN_TOTAL_CHOICES=2` |
| `R10` 完整产品可达空间（权威严格全枚举） | ✅ | 基线 **26 paths / 10 chassis** |
| `R11-LASER-CADENCE-R1` | ✅ | `laser.cooldownMs 1800 → 600`（**保留至今**） |
| `R11-RAMMER-REST-R1` → `ROLLBACK` | ✅ 已回退 | `rammer.restSteps 24 → 12 → 24`（当前 = 24） |
| `R11-STRICT-SPACE-RECHECK` + `BATCH-GATE` | ✅ | 当前 **28 paths / 11 chassis**（laser 由 0 → 1） |
| `R12-FIRE-WINDOW` | ❌ **证伪 → 整块回退** | 23 / 9（退化） |
| `R12-FIRE-WINDOW-ROLLBACK` | ✅ | 恢复 **28 / 11**；`git diff 52a477d -- src` = **0 行** |
| `R13-ENCOUNTER-ORDER-MATRIX-R1` | ✅ 纯取证 | 6 种 Encounter 全排列：hammer/rammer 全 0；判据 **2 成立** |
| `MAC-MIGRATION-HANDOFF` | ✅ docs-only | 迁移交接三件套 `docs/handoff/`；暴露硬 Blocker **B-1 / B-2** |
| `MAC-MIGRATION-E2E-COMPAT-R1` | ✅ infra/test | B-1/B-2 解除：`playwright-core@1.62.1` 入册 + **33 个 E2E 统一 `tests/_browser_launch.cjs`** |

---

## 3. 当前权威参数（内容库 `src/core/content.ts`）

> ⚠️ 一切以 `content.ts` 为准。本表只是速查。

| 武器 | 关键参数 |
|---|---|
| `cannon` | `cooldownMs 1000` · `projectileDamage 80`（正式键；**玩家侧基线独立 120**，只经 `createRunRegistry(build, true)`） |
| `flamethrower` | `cooldownMs 600` · `sprayMs 1000` · `projectileDamage 8` |
| `hammer` | `baseDamage 90`（Revolute 真实物理弧） |
| `laser` | `chargeMs 1500`（**前摇不动**）· `cooldownMs 600`（R11 保留）· `muzzleSpeed 56` · `projectileDamage 160` · `radius 12` |
| `machineGun` | `cooldownMs 1100` · `projectileDamage 20` · burst 7 发 |
| `rammer` | `extendPx 160` · `strikeSpeedPxPerStep 20` · `retractSpeedPxPerStep 3` · **`restSteps 24`** · `holdSteps 8` · `maxForceN 1200` · `baseDamage 70` |
| `shotgun` | `cooldownMs 1300` · `projectileDamage 30` · 5 发固定扇形 |

其它口径：

- 星级伤害 `1 + 0.25 × (star − 1)`；`INVENTORY_MAX_STAR = 5`；`MAX_STAR = 2`（旧横屏融合，冻结）。
- 合成阈值 `FUSE_STACK = 5`。
- 结算奖励**固定** `cannon ★1 ×1`。
- 敌人决策对象**恰好 4 键**：`{ band, enabled, worldDirection, targetSpeedPxPerStep }`。

---

## 4. Strict Matrix 最新基线

**工具**：`tests/productRunFullReachableSpaceR10.test.ts`（单跑 ≈42 分钟，须后台 + 独占机器）

| 口径 | COMPLETE Path | Unique Chassis |
|---|---|---|
| R10 基线（`R10_BASELINE_*`，现算必须复现） | **26** | **10** |
| **当前（`R11_CURRENT_*`）** | **28** | **11** |

逐武器唯一 COMPLETE chassis（当前）：

```
cannon 1 · flamethrower 1 · laser 1 · machineGun 4 · shotgun 4 · hammer 0 · rammer 0
```

> ⚠️ 只有**当前 28 / 11** 是「今天真实成立」的读数；R10 基线 26 / 10 是**对照分母**。
> ⚠️ R12 曾把它打到 23 / 9（`machineGun` 4 → 2）；回退后恢复。

---

## 5. 当前真实 Blocker

### 5.1 能力缺口（已如实降级，**长期允许为 0**）

| Blocker | 证据 | 让它生效需要什么 |
|---|---|---|
| `hammer` 打不赢完整 Run | 严格全枚举 **0 条 COMPLETE**；R13 六个 Encounter 顺序**全 0**；R12 的 P2 扫描 200 chassis 仅 2 命中 → 窗口 ON 后 **0 命中** | 「锤头 swing 相位 × 接触判定窗口」——**时序/判定**问题，不是几何问题 |
| `rammer` 打不赢完整 Run | 严格全枚举 **0 条 COMPLETE**；R13 六个顺序全 0；对 `RangedTurret` 最多 4 发（70×4=280）对 1100 HP | 「接触类武器有效命中密度」——**量级/命中密度**问题（够得着、打得中、打不死） |
| 一键可达装配打不赢终局（Q3-a） | 见上两条 | — |
| 浏览器端完整闭环无证据（Q3-b） | 无真人闭环录屏 | 真人录屏 / 真机回执 |
| 旧 C9 偶发红（Q3-c） | 偶发 | 单独排查 |

### 5.2 已知未修缺陷（**已在册，禁顺手并改**）

| # | 缺陷 | 位置 |
|---|---|---|
| ① | `validateSnapshot` 不含星级伤害倍率（校验器只判合法性，不算倍率） | ⚠️ **原记忆指针已失效**：`runPageState.ts` 里**没有** `validateSnapshot`。真实位置 = `src/core/buildValidator.ts:54`（`validateSnapshot`）/ 倍率唯一真源 = `src/core/buildSnapshot.ts:33`（`starDamageMultiplier`）—— 缺陷语义需人工确认（见 §9 一致性检查） |
| ② | `e2e:next-run` 崩：Hub 入口数断言写死 **3**，而真实是 **4** | ✅ 两端已复核：`tests/_e2e_next_run.cjs:619` 断言 `length === 3`；`src/lab/portraitBattleLab/validationHub.ts:60` 的 `VALIDATION_HUB_ENTRIES` 恰好 **4** 条（fullRun / nextRun / encounterBatch / contentBatch） |
| ③ | Lab `playerFunctionals()` 注释与实现不符 | Lab |
| ④ | 见 §5.1（Q3 能力缺口） | — |
| ⑤ | `settlementAudioLifecycle` 文件头误述终局（真实 `BananaRodLaser`，R9 后是 `d4-final`） | `tests/settlementAudioLifecycle.test.ts:18`（改了**只动注释、不动 T1~T7**） |

### 5.3 环境的既有假失败（**不是回归，别改被测逻辑**）

- `rcBundleCleanP0`（6 处）+ `rcFusionTestEntryP0`（T16）：干净 HEAD 同理红
  ⇒ 测试宿主运行期的进程通道被本机策略拒绝，属**环境假失败**。
- `productLoopRunReward` PC-14（`pushRod` gadget）：2026-10-01 已记「预存失败未修」。
- 全量 vitest **有负载抖动**（判据 = 两次运行红出的文件集合会变），抖动机 = `portraitLightSwarmExperience` LSE-09。

---

## 6. 主要迁移风险：`git clone` **不会带走**的东西

| 类别 | 具体 | 影响 |
|---|---|---|
| **未提交的 memory 改动** | `M .workbuddy/memory/MEMORY.md`（工作树已改、**未 commit**） | clone 拿到的是旧版；改动**丢失** |
| **未跟踪的当日日志** | `.workbuddy/memory/2026-09-29.md` … `2026-10-03.md`（**5 个**） | clone 完全看不到 |
| **未跟踪的交接文档** | 仓库根 ~50 个 `交接文档_2026-09-13…2026-10-01_*.md` | clone 看不到（注：**较早的 6 个反而已入库**，见 §7） |
| **未跟踪的新窗口指令** | `新窗口交接指令_2026-09-20.md` / `_2026-09-29.md` | clone 看不到 |
| **gitignore 的构建产物** | `dist/` `dist-wechat/` `dist-pages/` `dist-e2e/` `dist-portrait-lab/` `dist-wechat-c5-*/` | 可重建，但**必须重建** |
| **gitignore 的依赖** | `node_modules/` 全部可由 `npm ci` 复原（含已入册的 `playwright-core`） | ✅ 无风险；⚠️ 但**浏览器**不在 npm 依赖里，Mac 需另跑 `npx playwright-core install chromium`（见附录 A 第 8a 步） |
| **gitignore 的其它** | `outputs/` `_verify_q15recover/` `*.log` `tmp/` | 主要是录屏/临时产物，价值低 |
| **本机 git 配置** | `.git/config`（remote、branch tracking）+ **git 身份 `xiaoyue <xiaoyue@local>`** | Mac 上需重设身份，否则 commit 作者变 |
| **本地 git hooks** | **无**（`.git/hooks` 只有 `*.sample`） | 无风险 ✅ |
| **`.env` / 密钥** | **不存在**（已核实） | 无风险 ✅ |
| **用户级 WorkBuddy 资产** | `~/.workbuddy/MEMORY.md`（跨项目偏好，2906B）、`~/.workbuddy/skills/` | **不在仓库内，clone 带不走**，需手工迁移 |

**平台相关（不可跨机拷贝）**：

- `node_modules/` **必须**在新机器 `rm -rf node_modules && npm ci` 重建
  （现含 `lightningcss-win32-x64-msvc` 等 Windows 专用可选依赖，Mac 需换 `darwin` 版）。
- 本机实际 Node = **v22.22.2**，而 `package.json` `engines.node = ">=24.0.0"`
  （CI `.github/workflows/pages.yml` 也用 **22**）⇒ 声明与实跑不一致，**不是硬 Blocker**，
  但首次 `npm ci` 可能出 `EBADENGINE` **警告**（无 `.npmrc`，未开 `engine-strict`）。

---

## 7. 已证伪假设（**不要再走这些路**）

| 假设 | 裁决 | 证据 |
|---|---|---|
| **对手开火执行期停止后撤 ⇒ 给接触型武器追击窗口**（R12） | ❌ **证伪 + 整块回退** | COMPLETE 28→23、Unique 11→9；`machineGun` 4→2；**hammer 覆盖率 2/200 → 0/200（反向）**，而 rammer 69→120（↑）⇒ 两件武器**方向相反** |
| **hammer 是「够不着」（reach 不足）** | ❌ 证伪（零参数改动的负结果） | R13：hammer 在 `RangedTurret` 放 E1 时 `minGap` 已到 **33.6（贴身）** 仍 **0 命中** |
| **Encounter 固定顺序（R 恒为终局）放大克制关系** | ❌ 证伪 | 控制组**反向**证据：`machineGun` 在 R=E3 最好（4→2→1）、`laser` 最好也在 R=E3 ⇒「固定终局放大克制」不成立 |
| **Encounter 顺序是主因** | ❌ 证伪（判据 2） | hammer/rammer 六个顺序**全 0**；`RangedTurret` 位置本身无隐藏效应（§E 四武器 0 违规） |
| **单场隔离矩阵可直接代入三段链** | ❌ 不成立 | 口径不同（单场隔离 ≠ Q3-07 三段链） |
| **`saw` 挂在产品主武器槽可用** | ❌ 几何缺口 | 车身前沿 x=85 > 圆锯前沿 x=73 ⇒ 正面接敌永远车身先接触 |

---

## 8. 当前下一步设计问题

**主线（按 R12 Queue 指定的 Q3）**：

1. **`hammer`** —— 方向 = **「锤头 swing 相位 × 接触判定窗口」的时序/判定问题**
   （不是几何、不是 reach、不是对手后撤）。要回答：锤头在什么相位、以什么相对速度、
   在哪个接触事件上才能被 `contactTick` 登记。
2. **`rammer`** —— 方向 = **「接触类武器有效命中密度」的量级问题**
   （够得着、打得中，但 4 发 × 70 = 280 对 1100 HP 不够）。要回答：是提命中密度，还是提单次量级，
   还是承认它需要 Build 支撑。
3. **中档武器**（`machineGun` / `shotgun` / `laser` / `cannon`）—— 现有 28 条路径**依赖「到终局前攒够 2 个 Build」**；
   要回答：这个依赖是设计意图还是偶然。

**已明确不做（别再 ask）**：Garage 观感 / 奖励动画 / 内容量 / Buff 平衡 / 挂点几何 /
逐武器差异化 / 第二层专属内容 / 更多成长方向；`saw` 挂点几何**不动**。

---

## 9. 一致性检查（本文件与三份 MD 对 `src` / `tests` / `git history` 的逐项复核）

**复核日期**：2026-10-03 · **基准 HEAD**：`7241aab`

### 9.1 已复核且**一致**（以代码真源为准）

| 断言 | 复核位置 | 结果 |
|---|---|---|
| 完整 Run 资格唯一入口 | `src/product/runCompatibility.ts:242` `canStartFullRun` | ✅ |
| `WEAPON_SLOT = 'frontMass'` | `src/product/playerLoadout.ts:166` | ✅ |
| Body 8 个（4 默认 + 4 新增） | `src/core/bodyOwnership.ts:26-48` | ✅ |
| 轮组 4 档 `wheelStd/smallWheel/largeWheel/heavyWheel` | `src/core/content.ts:390/411/433/456` | ✅ |
| Garage 四槽顺序与文案 | `src/product/homePage.ts:165-172` | ✅ |
| Run 脚本 6 节点 / `ProtoRusher→Chaser→RangedTurret` | `src/lab/portraitBattleLab/runScript.ts:178-242` | ✅ |
| 终局判据 = `kind === 'FINAL'`（与 encounterId 无关） | `src/lab/portraitBattleLab/runPageState.ts:763` | ✅ |
| `FUSE_STACK = 5` / `INVENTORY_MAX_STAR = 5` / `MAX_STAR = 2` | `playerGrowth.ts:177` / `partInventory.ts:90` / `:436` | ✅ |
| `laser.cooldownMs = 600`（R11 保留） | `src/core/content.ts:1004` | ✅ |
| `rammer.restSteps = 24`（R11 已回退） | `src/core/content.ts:674` | ✅ |
| Full Run Weapon 7 件 | `src/product/runCompatibility.ts:150` | ✅ |
| Strict Matrix 台账 26/10 与 28/11 | `tests/productRunFullReachableSpaceR10.test.ts:326-354` | ✅ |
| `src` 相对 `52a477d` 零改动 | `git diff --stat 52a477d HEAD -- src` = **空** | ✅ |
| `content.ts` / `contactRouter.ts` 零漂移 | `git diff --exit-code 52a477d HEAD -- …` = **exit 0** | ✅ |
| 已知未修 ② 的两端读数 | `_e2e_next_run.cjs:619`（期望 3）vs `validationHub.ts:60`（实际 4 条） | ✅ **两端复核成立** |
| 已知未修 ⑤ 的表述 | `tests/settlementAudioLifecycle.test.ts:18` 写 `d7-final = BananaRodLaser`；真实节点已是 `d4-final` | ✅ **确为陈旧注释** |
| `playwright-core` 未声明 | `package.json` / `package-lock.json` 根依赖均无；仅 `node_modules` 有 `1.62.1` | ✅ **迁移 Blocker 成立** |
| `.env` 不存在 / 无本地 git hooks | 文件系统 + `.git/hooks` 仅 `*.sample` | ✅ |

### 9.2 ⚠️ 发现冲突 / 指针失效（**以代码为准，已在文中修正**）

| # | 原口径 | 代码真源 | 处置 |
|---|---|---|---|
| C-1 | 「已知未修 ① `validateSnapshot` 不含星级倍率 —— `runPageState.ts:114` vs `:48`」 | `runPageState.ts` **根本没有** `validateSnapshot`；`validateSnapshot` 在 `src/core/buildValidator.ts:54`，星级倍率真源在 `src/core/buildSnapshot.ts:33`（`starDamageMultiplier`） | 已在 §5.2 ① 改指真源；**缺陷语义本身需人工确认**（原指针无法定位到底指的是哪一处不一致） |
| C-2 | 「`runCarriedPlayerHp` 位于 `runPageState.ts:600-620`」 | 实际函数定义在 `runPageState.ts:609` | 已在 `PROJECT_BASELINE.md` §8.4 改为 `:609` |
| C-3 | 「memory 文件要提交（功能 commit + memory commit 两次提交）」 | 近期 R12 / R13 Queue **明文禁止** staging `.workbuddy/memory/**` | 已在 `WORKBUDDY_RULES.md` §8 记为「两种口径并存，**以当轮 Queue 明文为准**」 |
| C-4 | 「`交接文档_*.md` 只在工作区、不入库」 | **2026-09-12 及更早的 6 个已在库**（`git ls-files` 可见），09-13 之后的未入库 | 已在 §6 / §7 / 附录 B-6 如实记录为**归属不一致**，未擅自改动 |

> 以上 C-1 / C-2 属**记录性偏差**（旧笔记的行号漂移），不影响任何产品行为；
> C-3 / C-4 属**约定分歧**，需人工裁决。

---

## 附录 A｜Mac 首次 `git clone` 后的最小执行顺序

> 目标：**首次不跑长时间 Strict Matrix**（那要 ≈42 分钟）。

```bash
# 0) 前置：Node ≥ 22（声明 ≥24；CI 用 22，实测 22 可跑）；git；npm
node -v && npm -v

# 1) clone
git clone git@github.com:HubinAI/fruits.git
cd fruits

# 2) checkout 正确分支（产品工作全在这条上，不是 foundation-02-wechat）
git checkout prototype-portrait-battle-lab
git rev-parse HEAD          # 期望 925c79d（或其后继）
git log --oneline -5        # 确认拿到 §2 的提交链

# 3) 设 git 身份（clone 不带 .git/config 的 user 段）
git config user.name  "<你的名字>"
git config user.email "<你的邮箱>"

# 4) install（node_modules 不可跨机拷贝；Mac 会自动换成 darwin 版可选依赖）
npm ci

# 5) 类型检查
npm run typecheck           # = tsc --noEmit，必须 exit 0

# 6) 定向测试（先选一个不变的稳定文件，验证 vitest 环境）
npx vitest run tests/repoHealth.test.ts --pool=vmForks --maxWorkers=1
#    ⚠️ 所有 vitest 必须带 --pool，否则全失败（与代码无关）

# 7) 构建（产品侧四路，不跑 RC）
#    ⚠️ 第四路 build:portrait-lab 不能省：8 条 Product E2E 全部读 dist-portrait-lab/
#       漏了它 ⇒ 4 条 E2E 直接报「未找到 dist-portrait-lab/home.html」
npm run build && npm run build:pages && npm run build:wechat && npm run build:portrait-lab

# 8) Product E2E
#    8a) 先装「项目约定浏览器」——macOS **必做一次**
#        `npm ci` 只装 playwright-core 驱动，**不下载浏览器**
#        Mac 实测口径：playwright-core **1.62.1**（精确版本，勿改 `^`）
#          ⇒ browsers.json 声明 chromium revision **1234**
#          ⇒ 缓存落在 ~/Library/Caches/ms-playwright/chromium-1234
#             （macOS 布局是 chrome-mac/…/Chromium.app/Contents/MacOS/Chromium；
#              headless 走 chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/）
#        ⚠️ 缓存里若还有别的 revision（如 1243）不影响：驱动只认自己声明的 1234
npx playwright-core install chromium

#    8b) 启动解析顺序（唯一入口 = tests/_browser_launch.cjs）
#        Windows：系统 Edge（channel:'msedge'，保留现行口径）
#        macOS  ：Edge 不存在 → 自动落到上面装的 Chromium
#        可显式覆盖：E2E_BROWSER_CHANNEL=chrome | E2E_BROWSER_EXECUTABLE_PATH=/path/to/browser
#        全部候选失败 ⇒ 报错并打印安装指引（**不会**静默换未知浏览器）
npm run e2e:product-home
npm run e2e:product-reward
npm run e2e:product-star-power
npm run e2e:product-loop
npm run e2e:product-fail
npm run e2e:product-legacy
npm run e2e:product-reseed
npm run e2e:default-entry

# 9) repo-health（⚠️ 脚本无 CLI main，必须用 node -e 调导出函数）
node -e "
import('./scripts/repo-health.js').then((m)=>{
  const r=m.checkRepoHealth(null, process.cwd());
  console.log('repo-health: '+r.checks.filter(c=>c.ok).length+'/'+r.checks.length+' ok='+r.ok);
  for(const c of r.checks) if(!c.ok) console.log('  FAIL '+c.name+' | '+c.detail);
});
"
# 期望 9/9（worktree / head-resolve / branch-exists / branch-ref-resolve /
#           head-ref-consistency / origin-branch / head-object / tree-object / fsck-connectivity）
```

**不要**在首次 clone 就跑：

- `tests/productRunFullReachableSpaceR10.test.ts`（≈42 分钟，且必须独占机器）
- 全量 `vitest`（≈40s 起，但会与构建/E2E 抢资源产生**假超时**；要跑就独占机器）
- `npm run e2e:product-reward` **前**务必先跑过第 8a 步（装浏览器）；只 `npm ci` 不装浏览器会报
  “Executable doesn't exist”
- ⚠️ **在 WorkBuddy 里跑任何 npm 命令前**先 `export PATH=/usr/local/bin:$PATH`
  （WorkBuddy 会话默认 Node 是 22.22.2，详见 §0.2）

---

## 附录 B｜迁移 Blocker 详表

### B-1 ✅ 已解除｜`playwright-core` 已正式入册（`MAC-MIGRATION-E2E-COMPAT-R1`）

- **原现象**：`tests/*.cjs` 里 **33 个** E2E 脚本 `require('playwright-core')`，
  但该包**既不在 `package.json`，也不在 `package-lock.json`** ⇒ Mac `npm ci` 装不出来。
- **处置（已落地）**：`playwright-core` 写入 `devDependencies`，**精确版本 `1.62.1`**
  （= 原手工残留版本，锁死跨平台同一 chromium revision），lockfile 同步含
  `resolved` + `integrity`。**未触碰任何其它 npm 包。**
- **验证**：`rm -rf node_modules && npm ci` 后 `require('playwright-core')` 正常。
- ⚠️ 仍在生效的约束：**必须精确版本**，不要改成 `^`（否则 Windows/macOS 会落到不同浏览器 revision）。

### B-2 ✅ 已解除｜浏览器启动已跨平台统一（`MAC-MIGRATION-E2E-COMPAT-R1`）

- **原现象**：E2E 各自写死 Windows-only 参数 —— **27 个** 文件含 `channel: 'msedge'`
  （不止 8 条 Product E2E），其中 **6 个**还硬编码
  `executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'`；
  只有 8 个带 try/catch 回退 ⇒ macOS 上大面积失败。
- **处置（已落地）**：新增唯一入口 `tests/_browser_launch.cjs`，**33 个 E2E 全部改走
  `await launchBrowser(chromium)`**，散落的 `channel:'msedge'` / 硬编码 exe 路径 /
  裸 `chromium.launch(` **归零**（守卫 `tests/e2eBrowserLaunchGuard.test.ts` B3–B6 钉死）。
- **解析顺序（确定性，无「未知浏览器」静默回退）**：
  ① 显式 `E2E_BROWSER_EXECUTABLE_PATH` / `MSEDGE`（历史兼容）→
  ② 显式 `E2E_BROWSER_CHANNEL` → ③ 系统 Edge（Windows 现行口径）→
  ④ **项目正式声明的 Chromium**；全败则抛聚合错误 + 安装指引（`E2E_NO_BROWSER`）。
  ⚠️ ①② 一旦显式指定却启动失败，**直接报错**，不再猜其它浏览器。
- **Mac 前置（一次性）**：
  ```bash
  npx playwright-core install chromium
  ```
  （`npm ci` 只装驱动，不下载浏览器；版本 1.62.1 ⇒ chromium revision 1234。）
- 备选：macOS 若已装 Chrome/Edge，可 `E2E_BROWSER_CHANNEL=chrome`（或 `msedge`）跳过下载。
- ✅ **Mac 实测通过**（2026-10-03）：msedge 不存在 → 自动落到项目 bundled Chromium
  `151.0.7922.34`，newContext / newPage / DOM 读取 / 截图全通 ⇒ 启动链 PASS。

### B-3 ⚠️ Node 版本：`engines` 要求 ≥24，但 **WorkBuddy 会话实跑 22.22.2**（Mac 已复核）

- `package.json` `engines.node = ">=24.0.0"`；**Mac 系统 Node = v24.21.0 / npm 11.19.0**（在 `/usr/local/bin`，满足声明）。
- ⚠️ **但 WorkBuddy 会话里 `node -v` = v22.22.2** —— WorkBuddy CLI harness 把自带的
  `~/.workbuddy/binaries/node/versions/22.22.2-3/bin` 前插到 PATH 第 3 位，排在 `/usr/local/bin`（第 19 位）之前。
  **你手工 Terminal 里是 24.21.0，只有 WorkBuddy 里是 22.22.2** ⇒ 两套执行环境不一致。
- **不是硬 Blocker**（无 `.npmrc` / 未开 `engine-strict`，`npm ci` 只出 `EBADENGINE` 警告不失败）；
  且 `engines` 声明 ≥24 与 CI 实跑 22 本来就并存（CI `.github/workflows/pages.yml` 用 22）。
- **完整调查结论与已排除路径见 §0.2** —— profile 文件（`.zshrc`/`.zprofile`/`.zshenv`/`.profile`）
  **不被加载**（shell 是 `zsh -c` 非交互）、`settings.json` 无相关键、项目级 settings 不存在、
  `shell-snapshots` 是会话级一次性缓存 ⇒ **WorkBuddy 无项目级 Node 覆盖入口**，需用户在设置界面切换运行时。
- **当前正确做法**：WorkBuddy 内跑 npm 前 `export PATH=/usr/local/bin:$PATH`。
  **禁止**用降 `engines` / 降级依赖 / 改产品代码绕过。

### B-4 ✅ Mac 已解除｜平台专属可选依赖

- Windows 侧 `node_modules` 含 `lightningcss-win32-x64-msvc`；Mac **必须**重建
  （`rm -rf node_modules && npm ci`）⇒ 自动换 darwin 版。**绝不要**跨机拷贝 `node_modules/`。
- ✅ **Mac 实测**：`lightningcss-darwin-arm64` 到位、**零 `lightningcss-win32-*` 残留**；
  `npm ls --all` 零 invalid/missing。
  （注：Vite 8 用 **rolldown** 而非 rollup/esbuild，故无 `@rollup/*`、`@esbuild/*` 平台包**属正常，不是缺包**。）

### B-5 ⚠️ 仓库外资产（clone 永远带不走）

- `~/.workbuddy/MEMORY.md`（**跨项目**用户偏好，2906B）—— 需手工迁移。
- `~/.workbuddy/skills/`（本机只有 3 个迁移标记 json，**无实际 skill 目录**）。
- 仓库内 `.workbuddy/memory/` 与 `.workbuddy/skills/queue-delivery-gate/SKILL.md`
  **部分已入库**（见 §6）—— 但 09-29 之后的日志与 `MEMORY.md` 的最新改动**未入库**。

### B-6 ℹ️ 文档归属不一致（非 Blocker，但会让人困惑）

- 仓库根的 `交接文档_*.md`：**2026-09-12 及更早的 6 个已入库**，**09-13 之后的 ~50 个只在工作区**。
- 若希望 Mac 上也能看到全部历史交接文档，需**单独一轮**决定是否补入库（本 Queue 未擅自 commit）。
