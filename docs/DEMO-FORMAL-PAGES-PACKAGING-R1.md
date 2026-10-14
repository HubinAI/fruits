# DEMO-FORMAL-PAGES-PACKAGING-R1 — 交付报告：正式页面生产打包

> Queue：`DEMO-FORMAL-PAGES-PACKAGING-R1`｜branch `prototype-portrait-battle-lab`｜HEAD 起点 `c939c37`
> 性质：**打包 Foundation**——不改产品 Runtime / 战斗物理 / 数值 / 装备 / 经济 / Garage / UI；
> 本轮**不执行对外部署**（发布是单独门槛）。

---

## 0. 一句话结论

`vite.pages.config.ts` 最小多入口（index 旧预览 + home + run-page），`npm run build:pages` 产物三页齐备、资源 `/fruits/assets/*` 前缀正确；生产构建真实浏览器 smoke **11/11 PASS**（/fruits/ 前缀下初始化→换装→开战→回首页装配持续→深链刷新→旧入口不回归→调试句柄全折叠→零 404/JS 错误）；全部既有回归保持绿色。**未部署、未触发 workflow。**

---

## 1. 改动清单

| 文件 | 改动 |
|---|---|
| `vite.pages.config.ts` | `build.rollupOptions.input` 增加三入口：`index`（旧 Canvas 预览，原行为不回归）/ `home` / `runPage`。base `/fruits/`、runtimeInfoPlugin、production define（`__WX_DEBUG__`/`__E2E_INTERNAL_HANDLE__` = false）全部沿用，零语义改动。 |
| `tests/_e2e_pages_smoke.cjs`（新增） | 生产构建 smoke（详见 §3）。 |
| `package.json` | 新增 `e2e:pages-smoke` 脚本。 |
| `docs/PAGES-PACKAGING-README.md`（新增） | 两条入口 + 发布前人工确认动作清单。 |

**未动**：产品 Runtime / 物理 / 数值 / 装备 / 经济 / Garage / Run 脚本 / 车高 Lab / 移动端布局；`.github/workflows/pages.yml` **零改动**（仍 workflow_dispatch 手动触发）。

---

## 2. 入口闭集依据（先查后补）

产品循环（`src/product/`）对 HTML 的引用**只有两个相对地址**：
- `runReward.ts:129` `ADVENTURE_HREF = './run-page.html'`（出发 + 候选 href）
- `runReward.ts:131` `HOME_HREF = './home.html'`（失败回程 + 领奖回程）

`next-run.html` / `validation-hub.html` / `encounter-lab.html` / `content-batch.html` 仅被 Lab 验证中心（`src/lab/portraitBattleLab/validationHub.ts`）引用，产品循环不依赖 ⇒ **刻意不打包**（外网产物不暴露 Lab 入口）。

---

## 3. 生产 smoke（`npm run e2e:pages-smoke`，11/11 PASS）

静态服务把 `dist-pages/` 挂在 **/fruits/** 前缀（GitHub Pages 路径形态），真实浏览器（playwright-core、390×844、真实鼠标点击、零注入）：

| 断言 | 结果 | 证据 |
|---|---|---|
| P-02 首页生产构建初始化 | PASS | `#ph-root` 挂载 5153 字节 DOM |
| P-02b 全新存储正式初始化 | PASS | 7 个 `strongfruit.*` 键自然生成（零注入） |
| P-03 Garage 换装保存 | PASS | `frontMass = machineGun` 落盘 |
| P-04 出发导航 + 画布 | PASS | URL = `/fruits/run-page.html?run=…&choices=…&equipped=…`（相对导航在前缀下成立，产品载荷完整） |
| P-04b Run 场景可交互 | PASS | 画布点击无崩溃、jsErrors=0 |
| P-05 装配持续 | PASS | 重新挂载首页后 `frontMass` 仍 = machineGun |
| P-07a/b 深链刷新 | PASS | home/run-page 直接刷新均可载入 |
| P-08 旧入口不回归 | PASS | `/fruits/index.html` Canvas 预览挂载非空 |
| P-09 生产干净 | PASS | `__h`/`__probe`/`__PRODUCTHOME__`/`__RUNPAGE__` 全部 undefined（编译期折叠实证） |
| P-06 零 404 / 零 JS 错误 | PASS | badResponses=0, jsErrors=0（全程监听） |

## 4. 构建产物（验收 1）

```
dist-pages/index.html                1.12 kB   （旧预览，独立分块）
dist-pages/home.html                25.94 kB
dist-pages/run-page.html             3.19 kB
dist-pages/assets/index-*.js       170.10 kB  （旧预览 chunk）
dist-pages/assets/home-*.js         49.11 kB
dist-pages/assets/runPage-*.js      77.11 kB
dist-pages/assets/opponentPool-*.js 429.65 kB（共享 chunk）
```
三页 HTML 的 `src`/`href` 全部指向 `/fruits/assets/*`（实测 grep）；index 的 chunk 与 home/runPage 的 chunk 相互独立 ⇒ 旧预览入口不受影响。

## 5. 回归（验收 4，全部绿色）

| 套件 | 结果 |
|---|---|
| `npm run typecheck` | PASS |
| `productFrameStepDeterminismR1`（FD-01~05）+ `productDemoWinPathRngRootR1`（W-01~W-04） | 15/15 PASS |
| `npm run build:portrait-lab` | PASS |
| `node tests/_e2e_demo_continuous_run.cjs`（M5 连续 3 局真实 Run） | **22/22 PASS，0 FAIL，0 BLOCKED**（RUN-2 COMPLETE 领奖、三源装配一致、帧健康 0% 长帧） |

预存红严格单列：`productEncounterContentBatchR1` EB-04（LAB_ENCOUNTERS 期望 10 实际 13）——上一轮已在干净 HEAD worktree 复现为预存红（MEMORY §0-⑧ 族），本轮未触碰。

## 6. 两条入口（验收 3）与发布门槛

- **本地静态预览**：`npm run build:pages` → 任意静态服务器挂 `/fruits/` 前缀（README 有 serve 命令）；或直接 `npm run e2e:pages-smoke`（自带服务）。
- **Pages 候选地址（未部署，仅标注）**：`https://hubinai.github.io/fruits/home.html` 与 `.../run-page.html`。
- **发布尚欠的人工确认动作**（缺一不发）：① Settings → Pages → Source = "GitHub Actions"（一次性管理员设置）；② 负责人手动触发 workflow（本轮未触发、未改 Pages 设置、未部署）；③ 上线后在候选地址真人验收完整 Demo。

## 7. 复现命令

```
export PATH=/Users/yy/.workbuddy/binaries/node/versions/22.22.2-6/bin:$PATH
npm run build:pages && npm run e2e:pages-smoke   # 11/11
npm run typecheck
npx vitest run tests/productFrameStepDeterminismR1.test.ts tests/productDemoWinPathRngRootR1.test.ts --pool=forks --maxWorkers=1  # 15/15
npm run build:portrait-lab && node tests/_e2e_demo_continuous_run.cjs  # 22/22
```

## 8. 边界声明

本轮只做到**生产可构建 + 可本地静态预览**；「代码完成」≠「已上线」≠「真人体验通过」。未新增游戏机制/UI/数值，未接扩展 Lab 敌人，未动正式 Run 默认路线。
