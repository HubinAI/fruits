# Fruits - Runtime Memory Index (compact)

Full archive: `.workbuddy/memory/archive/MEMORY_FULL_2026-09-05.md`
Daily: `.workbuddy/memory/YYYY-MM-DD.md` | Handoffs at repo root
Authority: `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md`

## 1. Identity
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果`
- Branch `foundation-02-wechat` (no new mainline)
- R2.1 (体验 FAIL 基线)=`8fbac75`；memory=`ff6a20d`/`9df1eab`
- Last delivery: F-GARAGE-FUSION-RESULT-INTERACTION-R2.2（SHA 见交付报告）
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
- R2.2 delivered: 不自动关/点卡不关/点空白关/遮罩 0.62 底层保留/新获得 ≥2.5s/失败行内 toast。
- Unit 34 全绿；全量 vitest 1732/1732；tsc 0；四端构建 OK；E2E 196/196+172/172；bundle-clean PASS；repo-health 9/9。
- iOS 未验证；电脑录屏体验回执待用户。

## 6. Next action
- NEXT: 停止等用户回执（R2.2 电脑录屏体验验收；确认后 iOS 真机点检）。Do NOT auto-start.
- Low-prio: KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01; mobile drive slot (F-GARAGE-TOUCH-ASSEMBLY-R2); strip-scroll no clamp.
