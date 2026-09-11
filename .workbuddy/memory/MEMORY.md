# Fruits - Runtime Memory Index (compact)

Full archive: `.workbuddy/memory/archive/MEMORY_FULL_2026-09-05.md`
Daily: `.workbuddy/memory/YYYY-MM-DD.md` | Handoffs at repo root
Authority: `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md`

## 1. Identity
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果`
- Branch `foundation-02-wechat` (no new mainline)；实验分支 `prototype-portrait-battle-lab`（PBL-F0 竖屏实验台，可整块删除）
- R2.1 (体验 FAIL 基线)=`8fbac75`；memory=`ff6a20d`/`9df1eab`
- Last delivery: PBL-F0 Portrait Battle Lab（见同日交接文档）；主线上一交付 R3 `1bb35d7`
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
- PBL Lab 隔离不变量：Lab 只走 `build:portrait-lab`→`dist-portrait-lab/`（独立 html+config+outDir）；不接正式 Renderer/Runtime/Physics；正式入口与 4 个正式构建配置 0 引用（R23 守卫）；删除清单见 Lab `constants.ts` 头部。
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

## 6. Next action
- NEXT: PBL-F0 已交付并推送 → **停等用户回执**（是否进 PBL-A Arena A 实现 / 先做 iOS 真机点检）。Do NOT auto-start.
- Low-prio: KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01; mobile drive slot (F-GARAGE-TOUCH-ASSEMBLY-R2); strip-scroll no clamp; O1/O2 非阻塞优化项。
