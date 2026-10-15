# 新窗口对话指令 · UX 感知三连交接（局内面板 + 图标背包 + 蔚蓝式弹窗）

> 用法：新开窗口后，把下面「---」之间的内容**整段粘贴为第一条消息**。

---

## 上下文

我在做《最强水果》微信小游戏的 **Battle Runtime / 玩法层**（仓库 `HubinAI/fruits`，分支 `prototype-portrait-battle-lab`）。

本窗口刚完成 **UX 感知迭代三连**（3 个 Queue / 3 个功能 commit），最终 SHA **`4d52947`**（功能链尾 `41a1e59`），
工作区 clean，全部已 push（local=remote 一致）：

| # | SHA | Queue | 一句话 |
|---|---|---|---|
| 1 | `d569293` | UX-RUN-STATUS-PRESENCE-R2 | 局内战力状态面板移到战场带底部（**局内已冻结**，用户已认可） |
| 2 | `22a15d1` | UX-BAG-VISUAL-FUSION-R2 | 图标化背包（`src/product/partIcon.ts` 真美术优先+真数据矢量） |
| 3 | `41a1e59` | UX-BLUESTAR-EQUIP-FUSE-SIMPLIFY-R1 | **当前 Garage 形态**：删双页签/5槽台 ⇒ 单一背包 + 「当前/新装备」对比替换弹窗 + 图腾式合成弹窗 |

### 当前 Garage 交互形态（必读）

- 单一背包主视图：整车预览 → 5 真实槽（2×2+gadget 跨行）→「选择〈槽名〉装备」→ 分类卡阵（唯一滚动容器）→ **【合成】独立按钮**；
- 点库存格（四类+未装载）**不再立即写盘** → 「当前装备/新装备」对比弹窗（真实可计算属性对比，↑↓ 只在真实差值上）；
  【取消】零写盘；【替换】调既有 `equip*` 一次；
- 【合成】按钮只有存在 `fusable` 组才红点数量徽标（源码级条件渲染）；弹窗**只列** count≥5 且未满星组，
  单组自动选中、唯一确认 = `fuseStack` **一次 5→1（不批量）**；
- 页面状态机 = `garageModal: {equip|fuse}|null` + `fuseModalSel`（旧 `garageTab/fuseSel/fuseFocusPending` 全删）。

### 本轮守卫契约变更（9 条，全部「同步非放宽」，明细见交接文档 §2）

GS-01/05/09b/10/14/15/16/20/22+MVR-11：页签→独立按钮、点卡即装→弹窗确认、
合成工作台→弹窗、**全页零拖拽**（GS-09b）、`↑↓` 只许在真实数值比较（GS-20）、
「轮径」禁令收窄为禁数字字面量（GS-22/MVR-11）。

### 回归基线（判红必读）

- 全量 vitest **19 failed = 预存红闭集**（基线 worktree 逐字同红，diff 为空）：
  T20、R22a、F1-R1/R2、G1-05、R2-09/10、LSE-04/21、NR-14、RC-06b/c、RP-21/27、H-05、EB-04、**PL-26**、PC-14、PR-27。
  ⇒ **判红必先建 HEAD 独立 worktree 复现**，否则会记错账。
- 本轮全绿：fusion-grid 8/8（重写为弹窗契约）、product-loop 55/55、fresh-slice 22/22、
  demo-continuous-run 22/22、pages-smoke 11/11、run-hud 13/13、run-page 453/453。
- ⚠️ **E2E 装配 helper 五处已同步新闭环**「点卡 → `[data-ph-action="modal-replace"]`」
  （loop/slice/demo/run-hud/pages-smoke）；新写 E2E 必须走新闭环，
  合成路径 = `[data-ph-action="fuse-entry"]` → `.ph-modal-card [data-ph-action="fuse"]`。

### 环境与陷阱

```bash
cd /Users/yy/Documents/workbuddy/fruits
git rev-parse HEAD origin/prototype-portrait-battle-lab   # 应同为 4d52947
```

- vitest 用 `--pool=vmThreads`；E2E 端口不可复用 ⇒ 串行跑；长 E2E 后台跑。
- ⚠️ 新增 `src/product/` 模块必须在 `tests/productLoopHomeGarage.test.ts` 的 **PL-26** 登记
  （PL-26 本身是预存红：`playerLoadout.ts` 缺 `../core/partOptions` 登记——最小修即绿，等独立 Queue）。
- ⚠️ 取证截图放独立目录（`e2e:run-hud` 会重拍 `docs/ux-perceptual-r2/A-run-*.png`，别混放）。
- ⚠️ 弹窗卡片选择器用 **`.ph-modal-card`**（类），不是 `[data-ph-modal-card]`（属性不存在）。
- ⚠️ Movement 缺省轮 defId = `wheelStd`；未拥有的卡 `disabled` 不可点。
- 禁改：局内 HUD/Run/物理/武器伤害（**局内已冻结**）、部件定义、初始库存、奖励、星级与 5合1、
  不引入 4合1/宝石/品质锁/洗炼/商店/虚构战力。

**完整交接文档**：`docs/handoff/archive/交接文档_2026-10-15_ux-trilogy_4d52947.md`
（含 3 个 Queue 明细、9 条守卫变更表、19 个预存红清单、6 条踩坑、验收入口）

**请等我下发下一个 Queue 指令，不要自动开工。**

---
