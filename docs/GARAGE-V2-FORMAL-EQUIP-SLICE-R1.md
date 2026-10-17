# GARAGE-V2-FORMAL-EQUIP-SLICE-R1 交付报告

**正式页 Garage V2 装备界面 + 真实穿戴 · 垂直切片**
**commit：本报告同 commit（单 commit + push，local = remote = clean）**

## 1. 交付什么

正式 `home.html` 新增**受控预览分支** `?garageV2=1`：首页【调整战车】在该分支下进入
**Garage V2 装备视图**（视觉结构 = 用户已拍板的 Lab 布局；数据 = 纯正式生产存档）。
**正式合成弹窗未接入**（按钮显示「待接入」），旧 Garage / 旧合成 / 正式 Run 主路线全部原样保留。

## 2. 入口与结构（验收 1）

- 入口链：`home.html?garageV2=1` → 首页【调整战车】（`data-ph-action="open-garage"`）→ V2 视图。
- 结构（真实 390×844 截图 ×2，`docs/screenshots/`）：
  - 中上真实战车预览（`vehiclePreviewLayout` 正式 sprite 同源）；
  - 左右五槽：车身/武器/辅助（左）+ 前轮/后轮（右），已装备高亮；
  - 下方 3–5 列**单件**品质图标格（`repeat(4, minmax(0,1fr))`，≤374px 3 列、≥430px 5 列）；
    边框白绿蓝紫橙红彩 + 部位角标（武/身/轮/辅）；**零名字/数量/星级/堆叠**
    （E2E A5 用「剥角标后 textContent 必须为空」机器判据钉死）；
  - 背包右上【合成】= 待接入占位（`data-g2-fuse-pending`，弹窗如实说明，不写库存）；
  - 底部【返回】→ 正式首页视图。
- CSS 与 Lab 同源（85 条 `.g2-*` 规则注入 home.html `<style>`），**零 import** Lab/种子/隔离存储。

## 3. 真实穿戴事务（验收 2）

| 步骤 | 语义 | 证据 |
|---|---|---|
| 点背包格 | 「当前装备 vs 新件」图形对比（品质色/锁定说明/前后轮目标切换） | E2E B1 |
| 【取消】 | 零写盘（正式 localStorage 逐字节不变） | E2E B2 |
| q1 旧件装备 | 旧 `equipWeapon/equipMovement/equipGadget/equipBody` 全家（★2..5 原星装备） | E2E C2 |
| qv2 品质件装备 | `equipQualityProduct(id, draft, slot)`（quality+实例绑定双字段落盘） | E2E D2 |
| 前后轮独立 | 「装到前轮/装到后轮」切换；装前轮后轮保持原值 | E2E C2/C3 |
| 刷新持久 | 正式存档落盘，reload 后读数一致 | E2E C4 |
| 幽灵绑定 | 账本删除产物 ⇒ 加载校验拒绝，页面以默认车启动不白屏 | E2E E1 |

真实浏览器 E2E：`tests/_e2e_garage_v2_formal_slice.cjs` **19/19 PASS**。

## 4. 旧主路线未变（验收 3）

不带参数的 `home.html`：旧 Garage 槽交互结构原样（E2E F1）、旧合成入口仍在（F2）、
`开始冒险` href 正常（F3）；`_e2e_product_loop.cjs` **55/55 PASS**（换装/合成/三局 Run/领奖全链）。

## 5. 修改文件

| 文件 | 变更 |
|---|---|
| `src/product/garageV2View.ts` | **新增**：正式 V2 装备视图（读数+对比弹窗+装备事务分派+探针） |
| `src/product/homePage.ts` | `garageV2Preview` 常量（?garageV2=1）+ `render()` 分支挂载 + 探针转发 |
| `home.html` | 注入 85 条 `.g2-*` 规则（与 Lab 同源 CSS） |
| `tests/productLoopHomeGarage.test.ts` | PL-26 闭集登记：homePage +`./garageV2View`、新增 garageV2View 条目（10 import 逐字） |
| `tests/_e2e_garage_v2_formal_slice.cjs` | **新增**：19 断言真实浏览器 E2E |
| `docs/screenshots/garage-v2-formal-*.png` | 真实 390×844 截图 ×2 |

## 6. 诚实限制（不能报「Garage V2 已正式上线」）

1. **合成弹窗未接入**——按钮「待接入」，下一条 Queue 复用本组件接 `fuseQualityFive`；
2. 正式主入口**尚未切换**——V2 只在 `?garageV2=1` 预览分支可达；
3. pushRod 类无品质实效的产物**未开放**（合成接入时必须拦）；Body 品质结构性不存在；
4. **技术/界面落地 ≠ 真人体验通过**（本轮按 Queue 明令无录屏）。

## 7. 验证记录

- tsc 全绿；`build:portrait-lab` + `build:pages` 绿；
- targeted：PL-26 35/35 + 品质/星级/Lab/首页守卫 73/73；
- 真实浏览器：本切片 E2E 19/19 + product-loop 55/55；
- 预存红：本轮未跑全量（Queue 明令不为 UI 切片循环全量）；上一轮基线 18 条预存红闭集不受本轮影响（本轮改动面 = 新模块 + homePage 接线 + CSS + 测试登记，全数在 targeted 覆盖内）。
