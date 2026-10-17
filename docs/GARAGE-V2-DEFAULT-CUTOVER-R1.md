# GARAGE-V2-DEFAULT-CUTOVER-R1 交付报告

**正式默认入口切换（Garage V2 成为【调整战车】唯一生产路径）**
**commit：本报告同 commit（单 commit + push，local = remote = clean），基线 `3f0316c`**

## 1. 差量内容（不重做任何 UI/品质/Foundation）

| 文件 | 变更 |
|---|---|
| `src/product/homePage.ts` | ① `render()` 的 `garageV2Preview && view==='garage'` → **默认 `view==='garage'` 即装载 `mountGarageV2View`**（初始 draft 也改为挂载时 `loadEquippedDraft()` 现读）；② 旧星级 Garage 降级为 `?garageLegacy=1` 兼容测试开关（生产默认不可达）；③ `onClose` 返回首页时**重读正式存档**（`draft = loadEquippedDraft(); inv = playerInventory(draft)`）——Garage V2 内的合成/换装落盘后，首页战车与开始冒险的 BuildSnapshot 与存档同源；④ probe 条件/注释同步（`garageV2Preview` 变量删除） |
| `src/product/garageV2View.ts` | 头部注释更新为「正式主入口」语义（无逻辑变化） |
| `tests/_e2e_garage_v2_formal_slice.cjs` | URL 改无参数默认入口；F1–F4 重写为切默认语义（默认 V2 + 旧卡片 DOM 不存在 + legacy 才进旧 Garage）；**37/37** |
| 5 个旧 Garage E2E | `product_loop` / `demo_continuous_run` / `fresh_account_slice` / `product_home` / `pages_smoke` 的 home.html 导航加 `?garageLegacy=1`（legacy 专用跑法）；Run 回程段在**领奖挂载取证之后**再进 legacy（保序不丢断言） |

## 2. 存档一致性闭环（必改 2）

- **进 Garage**：挂载时现读 `loadEquippedDraft()`（不用外层旧 draft）；
- **Garage 内**：所有写走正式事务（`equipQualityProduct`/`fuseQualityFive`/旧 `equip*`），即时落盘；
- **返回首页**：`onClose` 重读 `loadEquippedDraft()` + `playerInventory()` ⇒ 首页战车预览、`adventureHrefNow()` 的出发载荷、领奖后的逐件新格全部与存档一致（E2E F3 + FUSE-6c 钉死）。

## 3. 验证记录（验收 3/4 · 一次集中回归）

| 套件 | 结果 |
|---|---|
| V2 slice E2E（真实浏览器，默认入口） | **37/37** |
| product-loop（真实浏览器两局 Run 全链） | **55/55** |
| demo-continuous-run（M5 三局 + 帧健康 0.0%） | **22/22** |
| fresh-account-slice（真实浏览器） | **22/22** |
| pages-smoke（生产构建 /fruits/ 前缀） | **11/11** |
| targeted vitest 10 文件 | **128/128** |
| tsc / build:portrait-lab / build:pages | 全绿 |
| 全量 18 预存红 | 未重复跑（按 Queue 明令） |

## 4. 预存红如实登记（非本轮引入）

`_e2e_product_home.cjs` 有 10 条 FAIL + 尾部 JSON 崩溃。**已用独立 worktree 在基线 `3f0316c` 复现逐字相同失败**——全部是 `5e9abe6` 后 HOME-V2-MINIMAL-R1 极简化删除旧 DOM（`phHomeMovement` 摘要段等）而该 E2E 未同步的**陈旧族**，与本轮切默认无关，记基线账不在本 Queue scope（核心行为断言由 product-loop/continuous/fresh-slice 覆盖）。建议后续独立 Queue 清理。

## 5. 截图（验收 3 · 真实 390×844）

- `docs/screenshots/cutover-home-default-390x844.png`——无参数首页（极简结构不变）；
- `docs/screenshots/cutover-garage-v2-default-entry-390x844.png`——默认【调整战车】直达 V2（五槽/逐件品质格/合成红点 1/底部返回，零旧文本卡与星级入口）。

## 6. 诚实声明（验收 5）

只完成**技术正确/方案落地**：默认入口、返回重读闭环、legacy 隔离、全部核心回归绿。真人体验（手感/信息密度/合成动线是否好用）仍由用户判断。实测发现的 `product_home.cjs` 陈旧族已按预存红登记，未顺手修（避免扩 scope）。
