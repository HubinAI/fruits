# Fruits - Runtime Memory Index

**只放「不变量 + 陷阱 + 下一步」。** 公式 / 实测数字 / 逐帧时间线 / 各轮 Queue 细节**不在这里**。

| 要找什么 | 去哪 |
|---|---|
| 近日做了什么、实测数字 | `.workbuddy/memory/YYYY-MM-DD.md`（最新 `2026-09-19.md`） |
| **结构守卫 / 环境陷阱 / Stable contracts 全文** | `.workbuddy/memory/REF_GUARDS_TRAPS_CONTRACTS.md`（**改动前必读**） |
| **PRP 运行时细节**（战斗参数 / 相机 / 接缝 / 入口 / file:line） | `.workbuddy/memory/REF_PRP_RUNTIME.md` §A–M |
| 每个 Queue 的完整交付说明 | repo-root `交接文档_YYYY-MM-DD_<Queue>.md`（**本地件，不入库**） |
| 更早的完整版 | `.workbuddy/memory/archive/MEMORY_FULL_*.md` |
| 项目级共识与边界（最高权威） | `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md` |

## 1. Identity / 链尾
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果` | 分支 `prototype-portrait-battle-lab`
  （实验分支）；主线 `foundation-02-wechat`。正式名 **PRP｜Portrait Run Prototype**。
- **链尾**：`0ff259f` M2-R1 → `d1a9d67` PBL-RDC → `bab5f63` M3-CB → `092e376` PBL-M3-LIGHT-SWARM →
  **`c0d2c5d` PRODUCT-LOOP-R1-A**；更早 `git log`。
- 全链对 `src/{core,physics,render,player,platform,ui,game,presentation}` diff **恒为空**（已机器取证）。正式 gameplay
  改动仅 `cannonBehavior.ts` 可选 `burstRounds`（默认 1，逐帧不变）+ `battle/` 内**可选**驱动档。

## 2. Rules
- 1 Queue = 1 problem；先调查/复现、锁定根因再改码；无静默扩范围；缺陷拆独立 Queue（禁混并）。
- tech pass ≠ 落进运行时 ≠ 真人体验通过；体验由用户裁决。回复结尾写「用户需要回什么」；Queue 完成**停等**。
- 优先「**数据 / 节点 / 声明**」而非「按计数、位置、role 推断」——后者一加节点就失效。
- 「一眼可辨」验收先找**相机追不平的物理通道**；不存在就**如实上报失败**，不加提示掩盖。
- 指令语义与禁止清单冲突 ⇒ 按**硬约束**落地并**显式上报解释与代价**（别沉默选一个）。
- PC 录屏常态化；手机录屏只用于大模块节点。

## 3. 红线速查（全文 → REF_GUARDS §1–2）
- 环境：`git stash` 禁止；四路 SHA 前先 `git fetch`；`git commit -F` 传 **Windows 路径**；排除 `交接文档_*.md`
  用**显式路径** `git add`（中文名八进制转义 ⇒ grep 中文无效）；bash 缺 `/usr/bin` ⇒ 命令前 `export PATH="/usr/bin:/bin:$PATH"`。
- vitest `--pool=vmForks --maxWorkers=1` + **独占机器**（并发 ⇒ 无关文件假 `timeout 5000ms`，先单独重跑）。
- ⚠️ **相机跟双方中点 ⇒ 屏幕净位移 ≈ 0**（头号可感知性陷阱）。
- **入口唯一性**：`/` 只由 dev-only `build/branchDevEntry.ts` 重写 → `/run-page.html`（守卫禁写进 `vite.config.ts`）。
- ⚠️ **`R22b`：`src/`（Lab 之外）0 处 `portrait-lab` / `portraitBattleLab` 字样 —— 注释里也不能提**。
- ⚠️ Lab `ALLOWED_RELATIVE_IMPORTS` 是闭集 ⇒ Lab 内写不了正式存档 ⇒ **产品页只能放 `src/product/`**。
- ⚠️ 页面模块**级零 DOM**（自挂载放 `*Main.ts`）；产品页导航只写常量、交给 `<a href>`（`RP-25` / `PL-29`）。
- ⚠️ **加根 html 同步面 5 处（挂 Hub 7 处）**；加 Hub 入口 **4 处硬断言**（最易漏**顺序断言**）。
- ⚠️ **跨轮复验 PRP 前必须先 build**（`emptyOutDir:false` ⇒ 陈旧 chunk ⇒ 假 FAIL）。
- ⚠️ **「有按钮 ⇒ 必有 action」**：断言禁用 / 终点态**必须同时断言存在真实出口**（M2-R1 的 P0 形态）。
- ⚠️ 改实现导致源码守卫失败 ⇒ **强化守卫，不放宽**。

## 4. 各功能面现状 → 细节在 REF / 交接文档
战斗参数 §A · 相机 §B · 接缝与第一层冻结值 §C · RUN-R1 §D · BUILD-01 §E · RUN-02 §F/§J/§K · M2 种子 §G ·
M3 遭遇台 §H · Hub §I · M2-R1 终点态出口 §L · **PBL-RDC §M** —— 全部 → `REF_PRP_RUNTIME.md`。
⚠️ **不在 REF、只看交接文档**：`PRP-M3-CONTENT-BATCH-01` · `PBL-M3-LIGHT-SWARM-EXPERIENCE-VALIDATION-R1` ·
**`PRODUCT-LOOP-R1-A-HOME-GARAGE-INVENTORY`（本轮）**。启动两行：`cd D:\0818new\最强水果` → `npm run dev`
（或 `dev:next-run` / `dev:encounter-lab` / `dev:validation` / `dev:home`）。

## 5. Next action
- ⚠️ **主线已切换**：用户明令「**停止继续扩 Validation / Lab / 局内内容**」，转入**正式产品主循环**
  （首页 → 看车 → 调整战车 → 返回首页 → 开始冒险）。本 Queue 只做**局外配车**，已交付、四路 SHA 一致。
- ⚠️ **下一步 = Queue B**（用户原文「完成后若技术门禁通过，继续 Queue B」）——⛔ **本对话从未给出 Queue B 内容**
  ⇒ **必须向用户索取，不得自行开发、不得扩范围**。
- ⚠️ **PRODUCT-LOOP-R1-A 待裁决 4 条**：① `WEAPON_SLOT='frontMass'`（备选 `front`）；② 首页是否做**默认启动第一屏**
  （本轮按「不动启动链」）；③ 是否认可 `src/product/` 命名空间；④ 无 sprite 武器现画灰盒，是否另开美术 Queue。
- ⚠️ **后续段缺口（本 Queue 未触碰）**：Run 仍用固定 `RUN_DEMO_LOADOUT_ID` ⇒「首页装备 → 下一局真正用上」尚未接线；
  `planckBattleOrchestrator.ts:217-218` 硬编码两车 + `battleContract.ts:96-98` 只有 A/B 胜负 +
  `runBattleRuntime.ts:355` 只取 `enemies[0]`；唯一 1vN 宿主是 DEBUG 的 `arenaA.ts:814`。
- ⚠️ **LightSwarm 真人结论仍未收到**（「3 弱敌是否从『打赢一辆车』变成『处理数量与拥挤』」）；要追需用户明确。
- ⚠️ **真人已裁决**：路边改装件 ✅ 保留；废弃修理站 ❌ 假选择，不进正式内容池。
- 未裁决挂起：`FAILED` 终态观感；`WEAPON_CONTACT_THRESHOLD=0.5`；PRP-R5 遗留；PRP 图标**盒内笔画**无 node 侧几何测试；
  **PRP 各轮录屏回执未归档**（唯一未闭环项）；更旧 4 项见 `2026-09-19.md`。
- Low-prio：`_e2e_portrait_battle_lab.cjs` 的 `[iso] I2` 用 `readdirSync().find()`；
  KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01；mobile drive slot；strip-scroll no clamp。
