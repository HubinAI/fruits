# GARAGE-V2-UI-HOME-BATCH-R1｜交付说明（B: Lab / C: 正式极简首页）

两个独立提交，串行完成。**正式 Garage V2 接入仍须等「七档品质真的能穿戴并影响 Run」独立验收**——
本批只做「Lab 验证」+「正式首页极简化」，Lab 完成 ≠ 正式体验完成。

---

## B｜GARAGE-V2-INVENTORY-LAYOUT-LAB-R1（commit `6880db0`）

### 实际入口
```bash
npm run dev:garage-v2-lab        # 开发服务器，自动打开 /garage-v2-lab.html
# 或
npm run build:portrait-lab && open dist-portrait-lab/garage-v2-lab.html
```
独立文件三件套（可整块删除）：`garage-v2-lab.html` + `src/product/garageV2LabMain.ts` + `src/product/garageV2Lab.ts`；
构建登记在 `vite.portrait-lab.config.ts`（**不进** `vite.pages.config` / 主配置 / 正式首页入口，有 GV2L-02 守卫）。

### 布局（用户拍板结构，390×844）
中上真实战车预览（正式 sprite 同源）→ 左右五穿戴槽（车身·武器·辅助 | 前轮·后轮）→
下方背包 3–5 列自适应单件格 → 【合成】按钮在背包标题右上（有合格组才亮红点数量）→ 底部仅返回。

### 格子呈现（无名字/数量/星级/不堆叠）
`partIcon` 图形 + 品质边框（白绿蓝紫橙红彩七档 CSS `--q`）+ 微型部位角标（武/身/轮/辅）；
名字只进 `title` 悬浮提示与弹窗，不进格子主体。

### 交互
- 点材料格 / 穿戴槽 → 「当前装备 / 背包选中」双图形对比弹窗；
  `legacy-star-locked`（旧 ★2..5）/ `body-not-consumable` / 未接 Run 的品质件
  **直白置灰说明，不返回假"换装成功"**；
- 【合成】只列 同部位 + 同品质 ≥5 的组（排除 body / 锁定 / 彩封顶）；
  点一件主件 → 系统确定性取其余 4 件 → 展示「主件外形 + 下一品质」→ 一键确认。

### 存储隔离（硬验证）
入口 `garageV2LabMain.ts` 在 **import 任何业务模块之前** `bindPlatformCore(<内存 Map 后端>)`
⇒ 库存 / 账本 / Build 全部落在内存，**真实 localStorage 一个字节不碰**。
E2E canary 实测：预置 `strongfruit.ownedParts.v2='{"CANARY":{one:9}}'` → 全程操作后**逐字节不变**。

### B 截图
`B-lab-main-390.png`（主视图）/ `B-lab-compare-390.png`（对比弹窗）/
`B-lab-fuse-picked-390.png`（合成弹窗 + 产物外形预览）/ `B-lab-after-fuse-390.png`（合成后：绿炮入格、红点刷新）/
`B-lab-main-desktop.png`（窄桌面 5 列自适应）。

### B 验证
- `tests/garageV2LabGuard.test.ts` 3/3（GV2L-01 入口隔离顺序 / GV2L-02 构建隔离 / GV2L-03 视觉契约）；
- PL-26 登记 `garageV2Lab.ts` import 闭集 ⇒ 35/35 绿；
- 浏览器冒烟（真实 Chromium）：5 槽 defId 正确、旧 ★2 锁定格 🔒、合成 3 组
  （武器×21 / 辅助×5 / 轮组×5 —— movement|white 恰 5 件**跨 defId** 成组）、
  选主件 → 「将得到 绿品质·炮」、确认后 cannon 白 5→1 + 绿炮入格 + 红点刷新、
  **localStorage canary 不变**；typecheck / build:portrait-lab 绿。

---

## C｜HOME-V2-MINIMAL-R1（本批第二个提交）

### 正式生产入口
```bash
npm run dev:home                 # 开发
npm run build:pages              # 正式产物 dist-pages/home.html（+ run-page.html）
```

### 极简化结果
首页从「零件参数清单」收敛为**产品首页**：
层次背景（`.ph-screen` radial + linear 叠加）→ 中央当前真实战车外观 + 一行车身名 →
纵向行动区：【开始冒险】**唯一主 CTA**（62px 高、亮黄、字距放大）+【调整战车】次级按钮（48px、弱化）。
主 CTA 实测 `y=670`、`h=62` ⇒ 390×844 **无需滚动即可点击**。

### 结构性退役（同信息 Garage 仍可见）
耐久/能量数值行 · 「已装备部件」`<ul>` · 成长行（`phHomeGrowth`）·
Movement 摘要（`phHomeMovement`）· 底部 4 段说明文字 —— 全部从 `renderHome` 移除。

### 保留的产品契约（一字未动）
- `data-ph-action="open-garage"`（进 Garage 视图，整页零跳转）；
- `data-ph-action="start-run"`：可执行 = 真实 `<a href>`（地址由 `adventureHrefNow()` **实时**产出
  ⇒ 与 Garage 换装同源，实测换机枪后 `href` 含 `machineGun`）；不可执行 = **无 href** 的 disabled 按钮
  （结构上「点了不会创建 Run」）；
- 领奖（挂载时 `claimRunReward` 一次 + 重读 draft/inv）与新账号初始化（`openGrowthSession` 先于任何库存落盘）；
- `renderHeader` 仍带领奖 banner（`claimNotice`）；「不可冒险」兼容提示（`renderCompatNotice`）如实出现。

### C 截图
`C-home-minimal-390.png`（极简首页）/ `C-home-after-equip-390.png`（Garage 换装后返回）。

### C 验证
- `tests/homeV2MinimalGuard.test.ts` 4/4（HV2-01 结构收敛 / HV2-02 契约保留 / HV2-03 领奖+新手链路 / HV2-04 CSS 层级）；
- `tests/productMovementProductLoopSurface.test.ts` PS-01 **按新契约重订**（12/12）：首页不再画 Movement 摘要、
  Garage 侧读数真源与遍历不变、共享标签表不变、`open-garage` 入口仍在 —— **不删除** Movement 可确认性不变量；
- 全量 vitest **18 failed = 基线逐字一致（IDENTICAL-18）**，零新增红；
- E2E：pages-smoke 11/11、product-loop 55/55、demo-continuous-run 22/22（帧健康 0% 长帧）、fresh-slice 22/22；
- typecheck / build / build:pages / build:portrait-lab 绿。

---

## 未完成事项（诚实登记）

1. **正式 Garage V2 接入未做**（Queue 收口明确要求）—— 必须等「七档品质真的能穿戴并影响 Run」
   的独立验收；`equipQualityProduct` 仍返回 `run-not-wired`，Lab 只做隔离预览。
2. **7 档品质 ↔ 正式 Run 战斗强度映射**仍未拍板（α 降维 / β 扩曲线 / γ 独立字段，见
   `docs/garage-v2/G2-AUDIT.md` §G）；因此彩色格子**不代表**更强战斗。
3. **Body 无数量模型** ⇒ 不开品质消耗（`body-not-consumable`），「5 台车身合 1」需重新设计。
4. **旧 ★2..★5 仍锁定**（`legacy-star-locked`），品质映射待设计决策。
5. 预存红 18 条如实保留（清单见 `.workbuddy/memory` 与交接文档），非本批引入。
6. 未部署 Pages、未合并 main、未改局内 HUD/物理/战斗数值/奖励投放。
