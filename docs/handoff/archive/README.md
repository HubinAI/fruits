# 交接文档归档（archive）

历史交接文档按日期归档于此，**根目录不再放交接文档**。

> 新窗口只需要看两份：
> - `docs/handoff/NEW-WINDOW-PROMPT.md` —— **整段粘贴为新窗口第一条消息**
> - 本目录里**日期最新**的那份 `交接文档_*.md` —— 完整明细
>
> 结构性口径见上级目录的 `CURRENT_STATE.md` / `PROJECT_BASELINE.md` / `WORKBUDDY_RULES.md`。

---

## 归档清单（按时间正序）

| 日期 | 文件 | 主题 | HEAD |
|---|---|---|---|
| 2026-08-28 | `交接文档_2026-08-28_f50cb1e.md` | WeChat 双端迁移 / F-GARAGE 装配线三连交付 | `f50cb1e` |
| 2026-08-29 | `交接文档_2026-08-29_c3ed90d.md` | 战斗 Spike → Core Adapter → Binding 迁移 | `c3ed90d` |
| 2026-09-01 | `交接文档_2026-09-01_6a50d4e.md` | Player Shell / Q15-UI-R2 验收 | `6a50d4e` |
| 2026-09-12 | `交接文档_2026-09-12_PBL-B1-STOP.md` | Portrait Battle Lab B1 · **STOP 报告** | — |
| 2026-09-12 | `交接文档_2026-09-12_PBL-G1.md` | Portrait Battle Lab G1 | — |
| 2026-10-12 | `交接文档_2026-10-12_gadget-third-layer-6b0356a.md` | **Gadget 第三层真人体验闭环**（12 个 Queue） | `6b0356a` |

---

## 归档规则（沿用）

1. 一条或多条 Queue 完成后写一份，文件名 `交接文档_<日期>_<主题或Queue>-<HEAD短SHA>.md`。
2. **不删除**历史文档（契约与实测记录有追溯价值）。
3. 只在文档头部写明「基线 HEAD」；**不要**把当前 HEAD 写进旧文档（保持快照语义）。
4. 入库路径 = `docs/handoff/archive/`，**禁止**再放根目录。
5. 新窗口指令单独放 `docs/handoff/NEW-WINDOW-PROMPT.md`（**唯一一份**，覆盖式更新）。
