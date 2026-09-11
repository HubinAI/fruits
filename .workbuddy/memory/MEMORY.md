# Fruits - Runtime Memory Index (compact)

Full archive: `.workbuddy/memory/archive/MEMORY_FULL_2026-09-05.md`
Daily: `.workbuddy/memory/YYYY-MM-DD.md` | Handoffs at repo root
Authority: `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md`

## 1. Identity
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果`
- Branch `foundation-02-wechat` (no new mainline)；实验分支 `prototype-portrait-battle-lab`（PBL-F0 竖屏实验台，可整块删除）
- R2.1 (体验 FAIL 基线)=`8fbac75`；memory=`ff6a20d`/`9df1eab`
- Last delivery: PBL-F1 共享 Loadout/Encounter + Spawn（见同日交接文档）；主线上一交付 R3 `1bb35d7`
- Details -> archive / daily logs / handoff docs

## 2. Rules
- 1 Queue = 1 problem; no silent scope creep.
- Investigate/reproduce FIRST; modify after root cause locked.
- tech pass != landed in runtime != real human experience pass.
- User owns experience; don't ask user for complex tech logs.
- Commands standalone; end reply: state what user must reply.
- PC recording normal; phone recording only for major module nodes.
- Stop after each Queue; never auto-continue.

## 3. Git/build safety
- `git stash` FORBIDDEN. git anomaly -> `scripts/repo-health.js` first.
- NO reset --hard / checkout -- / delete .git / hand-edit refs / force-push delivered.
- Single-feature commit+push; verify local=remote SHA.
- RC needs clean HEAD; badge/rc-build.json/runtimeInfo/HEAD 4-way equal.
- Memory merges into feature commit; NO standalone memory commit.
- PBL Lab 隔离不变量（F1 起收紧为**单向**）：反向硬约束 = 正式 src/ 全树 + 正式入口 + 4 个正式构建配置 0 引用 `portraitBattleLab|portrait-lab`（R22b/R23 守卫）；正向白名单 = Lab 只允许 import 只读纯模块（`core/content`/`core/buildSnapshot`/`core/buildValidator`/`core/types`/`player/opponentPool`/`platform/playerViewport`/`lab/buildEditorModel`），禁止任何 Runtime/DOM/平台/物理模块（R22a 守卫）。Lab 只走 `build:portrait-lab`→`dist-portrait-lab/`。
- vitest: cwd 盘符大写 `/D/…`；全量 `--pool=vmForks --maxWorkers=1`.

## 4. Stable contracts
- DPR applied exactly once (logical->backing); no double multiply.
- Viewport resume only via `syncWechatViewport`; no 2nd sizing path.
- safe-area/capsule + hitArea in logical coords (stage 844x390).
- E2E handles only under `__E2E_INTERNAL_HANDLE__`; RC/web excluded.
- hitArea & draw rects share one layout source (`computeFusionLayout`).
- E2E hitArea bounds = logical stage, NOT CSS viewport.
- 结果层 z 序（后注册先命中）：页控件 < dismiss(空白关) < `fusion-result-card`(点卡 no-op)。

## 5. Current truth
- R3 delivered `1bb35d7`：合成页星级选择（方案C）落地——星级行动态生成/默认星级规则①②③/单星卡/fusionSlots `{defId,star}` 对象化/轻确认/满星查看态/dismiss 定位产物星级。
- 全量 vitest 1741/1741；tsc 0；三端构建 OK；bundle-clean rc/wechat/e2e PASS；repo-health 9/9；E2E R3 128/128 + ux_r2 160/160 + feedback_r21 184/184；RC 四方一致（dirty=false）。
- ⚠️ infra：bash cwd `/d/…`（小写）→ vitest 模块图 context.ts 双实例 → setup 绑定丢失 → 持久化测试静默假失败；必须 `/D/…` 大写。排查法：setup 哨兵 + `isPlatformCoreBound()` 对照。
- R2.2 电脑录屏体验已确认通过（O1「新获得」文字/O2「点击空白处继续」对比度 = 非阻塞优化项，未开 R2.3）。
- iOS 未验证。

## 5.1 PBL-F0（竖屏战场实验台）
- 独立入口 `portrait-lab.html` + `src/lab/portraitBattleLab/`（constants/state/layout/lab/main）+ `vite.portrait-lab.config.ts`；逻辑基准竖屏 390×844、固定摄像机（复用 `PlayerViewportTransform(390,844)`，零改共享码）；自绘占位舞台，不接正式 Battle Runtime。
- 状态机：Arena A/B、Loadout 西瓜重炮/香蕉冲锋锤、Encounter 追猎者/远程炮台/3轻敌人、Start（幂等）/Reset；running 中切选择项→回 idle。
- 门禁：targeted 25/25、E2E 35/35（1280×720@1 + 700×900@1.5，真实点击+真实 getImageData，dpr=1 像素面积精确 4200/9216/7840）、全量 vitest 1766/1766、tsc 0、三端构建 EXIT 0、bundle-clean PASS、repo-health 9/9。
- 正式代码 0 修改（仅 .gitignore +1 行、package.json +2 script）。

## 5.2 PBL-F1（共享 Loadout / Encounter + Spawn 流程）
- 用户口径裁决：**①** = Loadout 只引用正式库真实存在的件；`履带`→`heavyWheel`（adapted）、`LightSwarm3`→正式模板 `OPP-14` ×3、`磁铁`/`护盾` 正式库不存在 → **unavailable，不引入、不造数值**（`testData.ts` 模块加载时动态校验，将来正式库补上会立刻抛错）。
- 三条正式映射原则：Loadout = 正式 `BuildDraft`；敌人 = 正式 `OPPONENT_TEMPLATES`（`OPP-16` 追猎者 / `OPP-03` 远程炮台 / `OPP-14` 三轻敌人）；数值一律 `buildSnapshotFromDraft`→`validateSnapshot`→`resolveSnapshot`，Lab 零手写数值。
- 新增 `/` 改：`testData.ts`(新) `entities.ts`(新, SpawnPlan+实体/弹丸容器) `scene.ts`(新, 由正式 collider 组装场景) `layout.ts`(分层绘制面积账本 `paintedAreas`) `state.ts`(state 持有 run) `lab.ts`(HUD 带 + 分层绘制)。
- 关键不变量：`buildSpawnPlan(loadout, encounter)` **无 arena 入参** → A/B 必然共用同一基础数据；`plan.baseKey` 指纹只含 HP/质量/能量/伤害/CD/弹丸，不含 arena/team/序号。
- ⚠️ 实测踩坑：HUD 缺口提示文字若用 `#ffd35a`（与 Arena 层同色）→ 文字抗锯齿像素被 E2E 分类器误计 → arena 虚增 ~310px。修法 = 提示色改 `#ff5ee0`（与所有分层色 RGB 互斥）+ E2E 统计区排除 HUD 带（y<140），并加 F1-R25 守卫「HUD 带内不得出现任何分层几何」。
- 门禁：targeted 51/51（F0 26 + F1 25）、E2E 64/64（精确账本：初始 A/西瓜/追猎者 = arena 4200 / playerBody 8360 / playerPart 800 / enemyBody 7618 / enemyPart 1560）、全量 vitest 1792/1792、tsc 0、三端构建 EXIT 0、bundle-clean PASS、repo-health 9/9。正式源码 0 修改。

## 6. Next action
- NEXT: 序列 `PBL-F1 → PBL-A1 → PBL-B1 → PBL-G1` 严格依次执行（用户指令）；**PBL-A1 = 竖屏纵向俯视 Arena A 最小 Runtime**。
- Low-prio: KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01; mobile drive slot (F-GARAGE-TOUCH-ASSEMBLY-R2); strip-scroll no clamp; O1/O2 非阻塞优化项。
