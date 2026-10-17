# GARAGE-V2-FORMAL-FUSE-SLICE-R1 交付报告

**正式 Garage V2 合成接入（真实五合一）· 垂直切片**
**commit：本报告同 commit（单 commit + push，local = remote = clean），基线 `fe8c359`**

## 1. 交付什么

`?garageV2=1` 正式 Garage V2 装备视图的背包右上【合成】从「待接入」占位替换为**真实五合一合成**：
点合成 → 弹窗只列真实可合成组 → 点一件为主件（产物保留该 defId）→ 系统确定性补同组其余 4 件
→ 主件→下一品质图形/颜色预览 → 唯一【确认合成】调 `fuseQualityFive` **一次** → 成功重读正式
存档（库存/账本/装备同刷）→ 红点/候选刷新 → 新产物立即在背包可穿戴。
**默认旧 Garage 入口未切换**（Queue 明令）；未新增/迁移任何底层。

## 2. 真实事务语义（验收 2）

| 步骤 | 语义 | 证据 |
|---|---|---|
| 组资格 | `slot\|quality` ≥5 互异 consumable 实例；排除 Body/旧 ★2..5 锁定/彩封顶/非推进 Gadget 主件 | FUSE-7/7b（Body 永不进组 + 每组 ≥5） |
| 混合 defId | 同部位同品质跨 defId 成组（machineGun×5 + hammer×1 = weapon·白 6 成员） | FUSE-3 |
| 主件选择 | 组内点一件 = 主件（保留外形与 defId）；再点取消 | FUSE-3b/3c |
| 确定性补料 | 排除主件后按目录序取 4 件（互异） | FUSE-5b 消耗 = 修复件+mg×3+hammer |
| 确认合成 | `fuseQualityFive` 唯一调用；失败显示实际 reason 且零写盘；成功 5→1 | FUSE-5/5b/5c（成品 machineGun 绿入账本） |
| 立即可穿 | 产物格立即出现 → 对比 → equipQualityProduct 落盘 | FUSE-6/6b/6c（刷新重进一致） |
| 取消零写盘 | 关弹窗不写任何 key | FUSE-4（逐字节对照） |
| 重复确认 | 成功后弹窗关闭 + 主件清空 ⇒ 无双扣入口 | FUSE-5（modal=null） |

## 3. 关键产品语义裁定（E2E 实测钉死）

- **装备修复件计入可合成财产**：装备中的旧武器由 `repairedEquipped` 发放 1 件 consumable
  白件（stack 级财产）——「4/5」库存 + 1 修复件会天然凑满 5。因此验收 1 的「初始 4/5 不提供
  确认」落地为两条硬判据：**所有展示组成员恒 ≥5**（4 件永远不成组）+ **未选主件确认禁用**
  （FUSE-1/1b）。这是真实产品语义，不是测试妥协。
- **非推进 Gadget 排除**：`registry.functionals.get(defId).behavior === 'thruster'` 判据与
  `equipQualityProduct` gadget 分支同源（不自建第二份真源）；pushRod 等不进组、不显示伪可穿产物。

## 4. 修改文件

| 文件 | 变更 |
|---|---|
| `src/product/garageV2View.ts` | fuse-pending 假弹窗删除；`G2Modal` 加 `kind:'fuse'`；`fuseCandidateGroups`（真实资格）+ `fuseModal`（组/主件/预览/确认/失败回显）；红点=真实组数；探针 +`fuseReadyGroups/fuseDot/fuseMainPick/fuseMembers/fuseConfirmDisabled` |
| `home.html` | +`.g2-mat-main` 主件高亮样式 |
| `tests/productLoopHomeGarage.test.ts` | PL-26 闭集登记 garageV2View +`../core/content` |
| `tests/_e2e_garage_v2_formal_slice.cjs` | FUSE-1..7b 全链断言（36/36） |
| `docs/screenshots/garage-v2-fuse-modal-390x844.png` | 真实 390×844 合成弹窗截图 |

## 5. 验证记录（验收 4）

- tsc 绿；`build:pages` + `build:portrait-lab` 绿；
- targeted 10 文件 **128/128**（PL-26/品质底座/账本/三部位穿戴/星级/首页/Lab 守卫）；
- 真实浏览器：V2 slice E2E **36/36**（原 19 + FUSE 17）；旧 product-loop **55/55**；
- 未重复跑全量 18 旧红检查（按 Queue 明令）。

## 6. 诚实声明（验收 5）

**预览 V2 合成完成，默认正式 Garage 尚未切换**——合成只在 `?garageV2=1` 受控预览分支可达；
下一条 Queue 只需主入口切换与集中验收。技术/界面落地 ≠ 真人体验通过（本轮按 Queue 明令无录屏）。
