# Fruits - Runtime Memory Index (compact)

Full text archive: `.workbuddy/memory/archive/MEMORY_FULL_2026-09-05.md`
Daily logs: `.workbuddy/memory/YYYY-MM-DD.md` | Handoffs at repo root
Authority: `最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md` (V1.0)

## 1. Identity
- Repo `git@github.com:HubinAI/fruits.git` | dir `D:\0818new\最强水果`
- Branch `foundation-02-wechat` (no new mainline)
- local=remote HEAD `8fbac75dc5abd68d013993588eb2885056837552`
- Last delivery: F-GARAGE-FUSION-FEEDBACK-LAYOUT-R2.1 (8fbac75)
- Details -> archive / daily logs / handoff docs

## 2. Rules
- 1 Queue = 1 problem; no silent scope creep.
- Investigate/reproduce/evidence FIRST; modify after root cause locked.
- tech pass != landed in runtime != real human experience pass.
- User owns experience; don't ask user for complex tech logs.
- User commands must be standalone & copy-paste ready.
- End each reply: state what user must reply.
- PC recording normal; phone recording only for major module nodes.
- Stop after each Queue; never auto-continue.

## 3. Git/build safety
- `git stash` FORBIDDEN.
- git anomaly -> `scripts/repo-health.js` first.
- NO reset --hard / checkout -- / delete .git / hand-edit refs.
- Single-feature commit+push; verify local=remote SHA.
- RC needs clean HEAD; badge/rc-build.json/runtimeInfo/HEAD 4-way equal.
- NO standalone memory commit after RC; memory merges into feature commit.

## 4. Stable contracts
- DPR applied exactly once (logical->backing); no double multiply.
- Viewport resume only via `syncWechatViewport`; no 2nd sizing path.
- safe-area/capsule + hitArea in logical coords (stage 844x390).
- E2E handles only under `__E2E_INTERNAL_HANDLE__`; out of RC/web.
- RC badge / debug-grant / diagnostic / E2E macros isolated.
- hitArea & draw rects share one layout source.
- E2E hitArea bounds = logical stage (cssW/cssH 844x390), NOT CSS viewport.

## 5. Current truth
- R2.1 `8fbac75`: technical gates PASS; **computer experience FAIL**.
- Confirmed: (1) success popup auto-closes; (2) can't control reading pace;
  (3) "click anywhere to continue" mismatch; (4) popup/input isolation check;
  (5) post-dismiss "newly acquired" still weak.
- iOS: not verified.

## 6. Next action
- NEXT: `F-GARAGE-FUSION-RESULT-INTERACTION-R2.2` (pending).
- Start ONLY on user command; do NOT auto-start.
- Low-prio: KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01; mobile drive slot (F-GARAGE-TOUCH-ASSEMBLY-R2); strip-scroll no clamp.
