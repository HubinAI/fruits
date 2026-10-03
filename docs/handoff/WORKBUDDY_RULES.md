# WORKBUDDY RULES｜《最强水果》协作与交付纪律

> **代码基线 HEAD**：`7241aab9f1df5477d0314e9283a525df153b06a4`（分支 `prototype-portrait-battle-lab`）
> **生成日期**：2026-10-03
> **用途**：换环境（含 Mac）后，**新会话第一条要读的就是本文件** —— 它约束「怎么做」，不描述「做到哪」（后者见 `CURRENT_STATE.md`）。
>
> ⚠️ 本文件与 Queue 明文冲突时，**Queue 明文优先**。

---

## 1. Queue 指令的六要素结构

每条 Queue 必须能拆成这六段，缺一段就**先问，不要猜**：

| 要素 | 含义 | 缺失时 |
|---|---|---|
| **问题** | 要解决的具体现象 / 已复现的证据 | 先做「第一步调查」，不要先改码 |
| **目标** | 可验收的终态 | 不要自行扩大范围 |
| **必改** | 明确要求改的（含 file:line 级定位） | — |
| **禁止** | 明确不许碰的（含 `src/**` 边界、参数、文档） | **默认全冻结**，只动必改项 |
| **验收** | 逐条可判定的通过条件（含「必须现算、不许硬编码迎合」） | 不要自造验收标准 |
| **提交** | 单功能 commit + push 的边界与禁止项 | 默认单 commit、禁顺手扩展 |

### 1.1 六要素的实际写法参考（本仓真实 Queue 的形状）

```
Queue ID: PRODUCT-LOOP-RXX-<TOPIC>
问题：<现象 + 已证伪的假设 + 复现方式>
目标：<可验收终态>
必改：<逐项，带 file:line>
禁止：不改 runScript 顺序 / 不调 Enemy·Weapon·Body·Movement 参数 / 不新增 Encounter / 不修 X
验收：① … ② … （必须按当前 HEAD 重算，不硬编码数字迎合）
提交：单功能 commit + push；完成后停止，不进入新的平衡修改
```

---

## 2. 三层验收：**必须分开表述**，不许用一层代替另一层

| 层 | 含义 | 证据形态 |
|---|---|---|
| ① **技术正确** | 代码能编译、测试断言通过 | `tsc --noEmit` exit 0 + 定向/全量 vitest |
| ② **方案落地** | 产品链路真的走到了（可达 / 数据真的写进库存 / 真的渲染出来） | E2E 真实点击链 + `page.evaluate` 读运行时状态 |
| ③ **真人体验成立** | 人在真机上、1× 速度、Debug 关，体验成立 | **真人录屏 / 真机回执** |

**三条硬规则**：

1. 「技术已实现 / 方案已落地 / 真人体验通过」**必须分开说**。不得用一句「已完成」合并。
2. **浏览器通过 ≠ 微信模拟器 ≠ iOS 真机** —— 三级链路各自取证，不得跨级推断。
3. ⚠️ **不用「测试绿」反驳「真人体验」**。测试绿只证明第①层；
   人报「打不中 / 点不到 / 卡顿」时，**不许**拿全绿测试当反驳证据，必须转成机制层取证
   （如：接触事件流、`minGap`、像素比对、真实点击序列）。

---

## 3. STOP / BLOCK 纪律

- **判据不成立 ⇒ STOP**：Queue 给了「若 A 则停手」这类条件判据时，条件一旦不成立，
  **立即停手并如实报告**，不许「再试一个参数」。
- **BLOCK 是合法结论**：能力缺口（如 `hammer` / `rammer` 0 条 COMPLETE）**允许长期为 0**，
  如实记为 BLOCK，**不得**为了「好看」放宽断言或改判据。
- **如实降级**：产品前提不足时（如某武器打不赢终局），
  **不要伪造能力** —— 保持 BLOCK、记录缺口、写清「让它生效需要新增什么规则」。
- **整块回退不动摇**：假设被证伪时，回退范围 = **该假设新增的全部内容**（规则 + 仅服务该规则的接线 + 该规则专属夹具）；
  同时**保留**同期不相关的授权改动（例：R12 回退保留了 `laser.cooldownMs = 600`）。
- **回退用 `git revert --no-commit <sha>`**（精确反向 patch），**不是**手改；
  之后**必须**在守卫主文件追加一条源码级回退守卫，防止该机制静默回流。

---

## 4. 单变量验证（本仓最强纪律）

**每轮只动一个字段**，并且必须走完这条链：

1. 先写**探针**（in-memory 改参 + `finally` 无条件还原）→ 扫一遍确认改前读数；
2. 只改**一个**字段 → 再扫同口径；
3. 差分**只能**来自那一个字段（口径/缓存/枚举顺序一字不动）；
4. **方向确认**后才落值。

⚠️ **踩过的坑（必须记住）**：

- **只缩短一级会误判方向**：`laser.cooldownMs` 1800 / 1200 / **900 全 0 COMPLETE**，
  只有 **600** 才出 2 路径 ⇒ 若只试到 900 就下「无效」结论，结论是错的。
- **非单调变量**：`rammer.restSteps` 改值会**平移整个 strike 相位** ⇒ 只能写「存在严格更优档」，
  **不能**写「越小越好」这种单调结论。
- **双形态方向相反**：同一参数对不同形态可能反向（`rammer` 的 `walk` 形态承伤反而 ↑）。
  **单向描述「都变好」是错的**。
- **单场隔离口径 ≠ 三段链口径**：单场隔离矩阵的读数**不能**代入三段链结论。

---

## 5. Runtime 真链排查（「先调查后修改」）

- **未以 `file:line` 证据锁定根因前，禁止改码。**
- 排查必须走**真链**，不许读 UI / 读参数表当证据：

  ```
  决策层 → contract → 编排器 → 实体层 → runtime → 引擎接触事件
  ```

- 取证用**引擎真实事件流**，不用推导值：
  - 伤害：`DamageEvent = { type:'damage', source, target, damageSource, damage }`（`damageResolver` 真的从 HP 减掉的那个数）
  - 命中：`RunBattleRuntime.playerWeaponHitSummary()`（按部件 defId 归因）
  - 几何：**判「够不够得着」必须用 `minGap`，`finalGap` 会骗人**
- ⚠️ **「bundle 里 grep 到字符串」≠「运行时句柄可用」**，唯一可靠取证是
  `page.evaluate(() => Object.keys(window.__X))`。

---

## 6. targeted 与 Batch Gate 的区分

| 类型 | 何时用 | 形状 |
|---|---|---|
| **定向（targeted）** | 改了一个模块 → 只跑 affected 文件 | `npx vitest run tests/<file>.test.ts --pool=vmForks --maxWorkers=1` |
| **全量 Batch Gate** | 每轮收口必跑 | `npx vitest run --pool=vmForks --maxWorkers=1`（≈40s，必须**独占机器**） |
| **重矩阵** | 只在明文要求时跑 | 权威 Strict Matrix 单跑 ≈42 分钟，**必须后台跑 + 独占机器** |

**硬规则**：

- 所有 vitest **必须带 `--pool`**（不带会全失败，与代码无关）。
- 全量回归**一律 `--pool=vmForks --maxWorkers=1`**（vmThreads 有 fake timers 顺序耦合的偶发超时）。
- ⚠️ **全量 vitest 有负载抖动**：与 E2E / 构建并发时，**无关文件**会报
  `Test timed out in 5000ms`。判定三步：① 单跑该文件 → 绿则排除逻辑问题；
  ② 查 import 面是否与被改模块有引用路径（无则无因果）；③ 全量重跑 → 绿即抖动。
  **三步齐了才写「非回归」，否则拆 Bug Queue。**
- **定向全绿 ≠ 全量安全**：闭集守卫（storage key 白名单等）只有全量门禁能抓。

---

## 7. commit / push 规则

- **单功能 commit + push**，然后 **stop-and-wait**：禁顺手扩展范围。
- **只 stage 业务文件**。以下**不要混进业务 commit**：
  `.workbuddy/` · `dist*` · `outputs/` · `_verify*` · `HANDOFF_` · `交接文档_*` · `新窗口交接指令_*` · `最强水果*`
- **memory 文件的提交规则以**当轮 Queue 明文**为准** —— 见 §8，两种情况历史上都出现过。
- **禁 `git stash`**（本环境曾因此丢 refs）。临时补丁备份到**仓库外** temp dir。
- **禁 `reset` / `checkout` 覆盖来源不明的改动**。工作树出现非自己写的 diff 时：
  **先只读侦察 → 逐行审阅 → 判断是自洽超集还是一半状态**，然后**报告并请裁决**。
- **`git commit -F <文件>` 必须传 Windows 路径**（Git Bash 的 `/tmp/...` Git 读不到）；
  **不要**用 `git commit -m @'…'@`（那是 PowerShell here-string 语法）。
- **commit message 用 `-F -` + heredoc**，分节写：Queue 名 / 一句话 / 分节说明 / 验收数字 / 未验证项。

### 7.1 push 后四路 SHA 核对（本机 ref 落盘不可靠）

```bash
git rev-parse HEAD
git rev-parse refs/heads/<branch>                       # 本机 ref
git ls-remote origin refs/heads/<branch> | cut -f1      # 权威远端（顶替 origin/<branch>）
cat .git/FETCH_HEAD                                     # fetch 后
```

⚠️ ⚠️ **实测：本机 `refs/remotes/origin/` 可能整个为空** —— `git fetch` 会打印 `[new branch]`，
但 `git rev-parse origin/<branch>` 与 `refs/remotes/origin/<branch>` 双双报 `ambiguous argument`。
**这不是 push 失败**（`git ls-remote` 直连远端即权威值）。四路里用 `git ls-remote` 顶替那一路。

---

## 8. memory / skill / handoff 的**禁止自行修改**规则

⚠️ **这是历史上口径变过的一条，必须按当轮 Queue 明文执行**：

| 时期 | 规则 |
|---|---|
| 更早（R1-A 起） | 两次提交：功能 commit + 紧随的 `memory: <QUEUE> 收口记录（…）` commit（`.workbuddy/memory/**` 要提交） |
| **近期（R12 / R13 明文）** | **`.workbuddy/memory/**` 不得 staging / commit**；且**禁止修改 memory / skill / handoff** |

**因此默认行为（除非 Queue 明确授权）**：

1. **不改** `.workbuddy/memory/**`、**不改** `.workbuddy/skills/**`、**不写** `交接文档_*` / `新窗口交接指令_*`
   —— **只报告，不落盘**。
2. 如果本轮发现了**确实值得入库的坑**（例：跨段耐久必须走 `runCarriedPlayerHp()`），
   在最终报告里**列出建议**，由用户决定是否单独开一轮补录。
3. **例外**：`.workbuddy/memory/YYYY-MM-DD.md` 的当日日志**追加**在「无禁令」的轮次是允许的，
   但**先确认当轮 Queue 没有写禁令**。

> ⚠️ **不得自行把「旧约定」当理由去提交 memory**。R12 / R13 都明文禁过，
> 若新会话看到 `git status` 里 `M .workbuddy/memory/MEMORY.md` 就顺手 commit —— **那是违规的**。

---

## 9. 其它反复踩过的环境 / 书写陷阱（换 Mac 后部分仍适用）

- **断言书写三坑**：
  ① `toEqual` 比较**键集**（`{...obj, 覆盖}` 与期望对象键数不同 ⇒ 永远不等，要写「按同名字段取值」的函数）；
  ② 浮点**别 round 后再去重**；③ 源码字符串守卫匹配前**剥注释**。
- **「注释提前闭合」已踩 3 处**：HTML `--` 紧跟 `>` · JS 块注释 `*` 紧跟 `/` ·
  源码守卫匹配前剥注释（但查「注释里的话」**必须**用未剥原文）。
- **E2E 假绿**：`waitForURL(/home\.html/)` 会被 Run 页自身地址当场匹配 ⇒ **根本没等导航** ⇒
  **必须用 pathname 谓词**。
- **负控制纪律**：新增守卫后**故意注入回归**确认断言**真的红**，再干净回退 + **grep 全仓**验零残留。
- **改实现导致源码守卫失败 ⇒ 强化守卫，不放宽**。
- **像素阈值按面积推导**，不拍脑袋。
- **跨轮复验 PRP 前必须先 build**（`emptyOutDir: false` ⇒ 陈旧 chunk ⇒ 假 FAIL）。
- **E2E 硬约束**：禁 `hitArea` / `__h` / `__probe` / `getImageData` 捷径当验收结论；
  像素基线改动前先记录。

---

## 10. 收尾清单（每轮缺一不可）

1. 定向 targeted → `tsc --noEmit` → 全量 Batch Gate → 构建（按 Queue 类型定路数）。
2. 单功能 commit + push。
3. **四路 SHA 核对**（HEAD / 本机 ref / `ls-remote` / `FETCH_HEAD`）。
4. 边界取证：
   ```bash
   git diff --stat -- src/{core,battle,physics,render,player,platform,ui,game,presentation,lab}
   git diff --exit-code -- src/core/content.ts src/battle/contactRouter.ts
   ```
5. 交付报告（**含未达成项诚实披露**）→ `present_files` 呈现。
6. **停下等真机回执，不开下一条**。
