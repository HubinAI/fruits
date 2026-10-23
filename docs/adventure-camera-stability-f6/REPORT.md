# FRUITS-ADVENTURE-CAMERA-STABILITY-F6｜冒险合成镜头「连续帧稳定」

> 交付对象：竖屏冒险战斗取景（`RunBattleView → advPage` 合成链路）。
> 基线：`c3b8c80`（F5 交付后的 HEAD）。分支 `prototype-portrait-battle-lab`。
> 一句话结论：**F4 的「交战放大 + 远距双车完整可见」全部保留（交战 zoom 1.44–1.52，裁车帧 0），
> P0 诊断出的三条硬伤全部消除** —— 主体屏宽单帧跳变 10.03% → 3.06%，战车在屏幕上的纵向抖动
> 23.1px → 0.9px，RESULT 切换的主体缩小 −31%…−34% → 0.0%。

---

## 1. 问题（P0 已量化，本次复核一致）

同种子 `scan-4`、正常速度、真实物理、6 场满局、3875 战斗帧：

| P0 结论 | 本次「修复前」复核值 |
|---|---|
| 交战时 zoom 从 1.000 一帧跳到 1.110（6/6 场） | 单帧 `Δz` 最大 **11.71%**，6 场各 1 帧（第 5 场 3 帧）|
| 纵向每帧追踪战车 Y ⇒ 取景窗甩动 | 单帧 `Δcy` 最大 **67.9px**，屏幕上战车跳动最大 **23.1px**（14 帧 >6px）|
| 战斗→RESULT 主体瞬间缩小 | 主体屏宽 **−31.1%…−34.2%**（均值 −31.9%），`Δzoom = 0.52` |

根因（与 P0 一致，本次逐条对应修法）：

1. **阈值阶跃**：`zoom = clamp(fit,1,1.6)` 之后又过一道「最小增益门限 1.1」——
   连续的距离映射被切成两段，fit 一越过 1.1 就整段跳过去。
2. **纵向无锚点**：裁切窗 `cy` 按「双车包围盒中心」逐帧重算 ⇒ 战车颠簸 / 被击飞时窗跟着动。
3. **RESULT 换口径**：战斗用自适应裁切（zoom≈1.45），RESULT 退回 `blitCover`（原比例 1.0）。

---

## 2. 修法（只动合成层，不碰正式相机）

### 2.1 缩放：从「阈值开关」改成「连续目标 + 时间平滑」

`src/lab/portraitBattleLab/runBattleView.ts`

- **删掉 1.1 门限**（`ADV_CAMERA_MIN_ZOOM`），目标改为单调连续映射
  `targetZoom = clamp(min(fit, maxZoom), 1, maxZoom)`（`advCompositeZoom`，:613）。
  为什么删而不是加迟滞：任何 `if (z < 1.1) z = 1` 都是把连续函数砍成阶梯，迟滞只能把台阶挪到别处；
  连续目标 + 下游平滑才是「不跳变」的唯一结构性解法。
- **一阶时间平滑** `advEase`（:223）：指数趋近（τ=130ms）+ 速率上限（2.2/s）+ 死区（0.0015）。
  帧率无关（dt 驱动），`dt` 钳在 `[0,50]ms`（切后台回来不会一次性甩到位）。
- **保底硬约束**：`zoom = min(smoothed, fit)` —— 平滑只能让镜头「慢一点跟上」，
  永远不允许放大到装不下双车（`fit` 来自带 padding 的主体框 ⇒ 保底后仍留 ≥6% 余量）。

### 2.2 纵向：只认地面线，不跟战车 Y

`cy = groundSafeY × (1 − 1/zoom)`（:687 附近），其中 `groundSafeY` 由**正式相机 transform + `rt.groundY`**
只读换算。含义：**地面线在屏幕上的相对高度与 zoom 无关**，恒等于它在原取景里的位置（`zoom=1` 时严格恒等）。

- 战车悬架颠簸 / 被击飞 ⇒ 取景窗纹丝不动（实测战车在屏幕上的纵向位移 ≤0.9px）；
- 只有「主体真要出框」时才让位（`ch ≥ core.h` 的可见性兜底），不做逐帧 Y 跟随。

### 2.3 横向：平滑跟随 + 可见性硬约束

- 目标 = 主体中心，`advEase`（τ=170ms，1500px/s 上限）；
- 硬约束 = 裁切窗必须含 **`core`**（未加 padding 的双车并集）；
  为此把主体拆成 `subjectRects()`（:568）返回 `core` / `padded` 两个矩形：
  `padded` 决定放大倍数（F4 原口径），`core` 决定「不切车」边界，
  **两者之差就是横向平滑可用的合法滞后余量**（6%+8px）。
  ⚠️ 这一步是必须的：`zoom == fit` 时裁切窗与 padded 主体等大，若用 padded 做约束，
  横向会被钉成「硬跟随」，平滑完全失效（第一版实现就踩了这个坑，单测里暴露出来）。

### 2.4 战斗 → RESULT：沿用最后稳定取景

`blitAdventureHold`（:765）：

- 源 = 最后一次战斗帧的裁切矩形（`advHold`，换战斗实例时清空）；
- 目标带 390×468 比战斗舞台 390×648 矮 ⇒ **只从上方裁掉一条天空，不缩放**；
  `scale = band.w / crop.w` 是唯一 scale（= zoom）⇒ **车辆像素尺寸与战斗末帧完全相同**；
- 纵向仍用同一条地面锚定规则 ⇒ 战报里战车仍踩在地上。

### 2.5 接线

`src/lab/portraitBattleLab/adventure/advPage.ts`

- `render()` 计算本帧真实 dt（`frameDtMs`，:606）——**只喂合成镜头**，战斗物理 dt 仍走 `startLoop`，互不干扰；
- 战斗分支：`updateAdventureCamera(battle, ADV_CAMERA_MAX, frameDtMs)` → `blitAdventureCamera(ctx, b)`（:872）；
- RESULT 分支：`blitAdventureHold(ctx, b, 0.5)`（:863）；
- 探针（`battleFrameProbe`）改为**读本帧真实解算结果**（新增 `targetZoom` 字段），
  保证「读数 == 画面」（此前是重新算一遍目标，平滑之后会与画面不符）。

**未改**：`Renderer` / `reframe` / `applyBattleFollow` / 物理 / 碰撞 / 伤害 / 数值 / 战车尺寸 /
冒险节点 / 点击流程 / UI。`?f4off=1`、`?d2zoom=`、`?f4max=` 三个对照旋钮行为不变（RESULT 自动退回 `blitCover`）。

---

## 3. 同条件前后对照

条件完全一致：seed=`scan-4`、390×844、正常速度（真实 rAF + 真实 dt）、真实物理、6 场满局、
同一台机器同一次会话、**同一支诊断脚本**（`tests/_diag_camera_p0.cjs`，`ADV_P0_OUT` 分目录落盘）。
修复前重新录制的结果与 P0 既有录制**逐帧一致**（`max|Δz|` 同为 0.1171、RESULT 同为 −31.1%/−34.2%）
⇒ 物理与采样口径可复现，前后对照可信。

| 指标（3875 战斗帧） | 修复前 `c3b8c80` | 修复后 | 变化 |
|---|---|---|---|
| 主体屏宽逐帧最大变化（放大跳变的观感量） | **10.03%** | **3.06%** | −69% |
| 缩放跳变 >5% 的帧数 | 6 | **0** | 全消 |
| 战车在**屏幕**上的纵向最大逐帧位移 | **23.1px**（14 帧 >6px） | **0.9px**（0 帧） | −96% |
| 战车在屏幕上的横向最大逐帧位移 | 9.8px（6 帧 >6px） | 3.9px（0 帧） | −60% |
| 取景窗 `Δcy` 单帧最大 | 67.9px | 17.2px | −75% |
| 取景窗 `Δcx` 单帧最大 | 20.4px | 7.1px | −65% |
| 取景窗 `Δz` 单帧最大 | 11.71% | 7.84% | −33%（残余成因见 §5） |
| 取景窗 `Δz` p99 | 3.55% | 2.40% | −32% |
| RESULT 主体屏宽变化（均 / 最差） | −31.9% / −34.2% | **0.0% / 0.0%** | 全消 |
| RESULT 与末帧 `Δzoom` | 0.52 | **0.000** | 全消 |
| 裁车帧（裁切窗未含双车） | 0 | 0 | 保持 |
| 交战 zoom 峰值 | 1.52 | 1.52 | 保持 |

逐场（正常速度，10–14s/场）：

| 场次 | 帧数 | 修复前 `Δz` / `Δcy` / `Δcx` | 修复后 `Δz` / `Δcy` / `Δcx` |
|---|---|---|---|
| 1 | 601 | 10.99% / 64.1px / 19.3px | 1.94% / 5.2px / 2.3px |
| 2 | 602 | 10.99% / 64.1px / 19.3px | 1.91% / 5.3px / 2.3px |
| 3 | 602 | 10.30% / 60.5px / 18.2px | 2.03% / 5.6px / 2.4px |
| 4 | 602 | 10.94% / 63.9px / 19.2px | 2.67% / 6.7px / 2.9px |
| 5（14s，跨竞技场相位切换） | 842 | 11.71% / 67.9px / 20.4px | 7.84% / 17.2px / 7.1px |
| 6 | 626 | 10.14% / 59.7px / 18.0px | 2.17% / 5.5px / 2.4px |

> 第 5 场是唯一跨过竞技场 `Active(10s) → Warning → Closing` 相位的战斗。残余 7.84% 不是 F6 的
> 平滑失效，而是**正式相机在相位切换那一帧自己做了一次 reframe（`cs` 一帧 +5.3%）**，
> 合成层为了让双车仍然装得下而同帧跟随（`zoom ≤ fit` 硬约束）—— 代价换来的是
> **屏幕上的主体尺寸只变化 −0.3%/+0.4%**（否则双车会被切）。详见 §5。

**关键跳变指标定义**（可复算，见 `analyze.py`）：

- 主体屏宽 = `worldW × cameraScale × bandScale × zoom`（探针 `vehicleA.pxW`）；
- 战车屏幕纵向位置 = `(aSafe.y + aSafe.h − crop.y) / crop.h × band.h`；
- 取景窗位移 = `crop.x/y` 的逐帧差（安全区坐标）。

---

## 4. 视觉证据（同条件连续帧）

`evidence.html` 是同条件前后对照页；精选关键帧在 `evidence/`（6 张，战斗末帧 / RESULT 首帧 /
交战帧，前后各一）。逐帧可复算数据在 `before/camera-adaptive.json`、`after/camera-adaptive.json`
（`analyze.py before after` 直接重放即得 `metrics.json` 全部数字）。

原始裸帧（`before/frames/`、`after/frames/`、`before/strip/`、`after/strip/`，共约 29MB PNG）
按仓库惯例**不入库**（见本目录 `.gitignore`），本地重生成命令：

```bash
ADV_P0_OUT=docs/adventure-camera-stability-f6/<before|after> node tests/_diag_camera_p0.cjs
ADV_P0_OUT=docs/adventure-camera-stability-f6/<before|after> node tests/_diag_camera_p0_strip.cjs
```

（正常速度 8fps 滚动缓冲 + RESULT 前后 60fps 连拍；同种子、同机、`--headless=old`。）

最具说服力的一对（战斗末帧 → RESULT 首帧）：

| | 战斗末帧 `toresult-039` | RESULT 首帧 `result-000` |
|---|---|---|
| 修复前 | 双车占满画面（`pxW≈188`） | **整体缩回原比例（`pxW≈129`，−31%）** |
| 修复后 | 双车占满画面（`pxW≈188`） | **像素尺寸不变**（`pxW=188`），只裁掉一条天空 |

---

## 5. 剩余问题（诚实披露）

1. **正式相机相位切换的 scale 阶跃未被消除（也不该由本 Queue 消除）**
   竞技场 `Active → Warning → Closing` 那一帧，正式相机 `cs` 一帧变化 +4.5%~+5.3%（它自己的
   `reframe` 三段 span 变了）。合成层为保证「双车不被切」同帧跟随，于是 `Δz` 出现 5–8% 的单帧值。
   实测该帧屏幕主体尺寸只变 −0.3%/+0.4%，但**背景/舞台会跟着正式相机缩放一次**。
   要彻底消除必须改正式 Runtime 相机 —— Queue 明令禁止，故只记录不改。
2. **远距分离时 zoom 是「立即跟随」而非「平滑跟随」**
   `zoom ≤ fit` 是可见性硬约束：双车一旦拉开到装不下，镜头必须立刻缩小，否则真会切车。
   实测分离段单帧 `Δz ≈ 2.8%`（物理分离速度决定，非跳变）。这里主动选择「可见性 > 平滑」。
3. **`?f4off=1` / `?d2zoom=` 两个对照旋钮不参与平滑**（它们本来就不走自适应裁切），
   RESULT 会退回历史 `blitCover` —— 属对照语义，非缺陷。
4. **诊断脚本仍是仓库内的未跟踪工具**（`tests/_diag_camera_p0*.cjs`，P0 交付时约定「只读、不提交」）。
   本 Queue 复用了它（新增 `ADV_P0_OUT` 输出目录参数），仍按 P0 约定不纳入本 commit；
   提交的是可长期跑的定向测试与 E2E（见 §6）。
5. **顺带修了一个既存类型缺陷**：`tests/adventureRepairValue.test.ts`（F5 提交）有 5 处
   TS 错误（未使用的 import + 未收窄的 `AdventureNode` 联合类型），导致 `tsc --noEmit` 在 HEAD 上
   本就不干净。F6 的 tsc 门控需要它干净，故做了 2 行纯类型修正（不改测试语义）。

---

## 6. 回归与门控

| 门控 | 结果 |
|---|---|
| `tsc --noEmit` | 干净（0 错误） |
| `tests/adventureCameraStabilityF6.test.ts`（新增，15 例） | **15/15** |
| `tests/_e2e_adventure_camera_f6.cjs`（新增，真实浏览器 2 场 × 600 帧） | **12/12** |
| `tests/_e2e_adventure_camera_f4.cjs`（F4 采纳验证，8 场真实战斗） | **37/37** |
| `tests/_e2e_adventure_camera_diag_d2.cjs`（D2 对照） | **13/13** |
| `tests/_e2e_adventure.cjs`（R4 冒险全流程） | **23/23** |
| `tests/_e2e_adventure_battle_frame.cjs`（F1 比例不失真） | **11/11**（含 1 处筛选口径维护，见 §6.3） |
| `tests/_e2e_adventure_hp_bar.cjs`（F2 实时耐久） | **13/13** |
| `tests/_e2e_adventure_build_feedback.cjs`（F3 强化反馈） | **18/18** |
| `tests/_e2e_adventure_experience_review_r1.cjs`（R1 体验复盘） | **22/22** |
| 全量 `vitest --pool=vmThreads`（1079 文件 / 3104 例） | 3084 通过 / **20 失败**，失败集合与基线**逐用例完全一致**（0 新增、0 修复） |

### 6.1 F6 E2E 自身读数（正常速度，2 场 × 600 帧）

```
第1场 600帧/10.0s | 主体屏宽 Δ=2.62% | 车底屏幕Y Δ=0.7px 车中线屏幕X Δ=4.0px
                  | 取景窗 Δz=1.93% Δcy=5.3px Δcx=2.3px | 交战 gap=168 z=1.44
                  | RESULT z=1.450 vs 末帧 1.450 (Δpx=-0.0%)
第2场 602帧/10.0s | 主体屏宽 Δ=2.01% | 车底屏幕Y Δ=0.7px 车中线屏幕X Δ=3.5px
                  | 取景窗 Δz=1.92% Δcy=5.3px Δcx=2.3px | 交战 gap=168 z=1.44
                  | RESULT z=1.452 vs 末帧 1.452 (Δpx=-0.0%)
首帧 |z − target| = 0.000（开打瞬间不带缩放动画）
裁车帧 = 0
```

### 6.2 全量 vitest：失败集合对照（`c3b8c80` vs F6 树）

- F6 树：`numTotal 3104 / passed 3084 / failed 20 / files 1079`，失败分布在 15 个文件；
- 在基线 `c3b8c80` 上单独跑这 15 个文件：同样 **20 失败 / 15 文件**；
- 逐用例名集合对比：`只在新树失败 = 0`，`只在基线失败 = 0`。

⇒ 这 20 个失败是仓库既有失败（`portraitBattleLab*` / `product*` 源码扫描类断言等），与 F6 无关。

### 6.3 一处测试维护（F1，必须披露）

`tests/_e2e_adventure_battle_frame.cjs` 原先用「源矩形 == 390×648」来定位战斗合成调用。
F4/F6 的自适应取景会把源矩形裁成子矩形（`zoom>1` 时源必然小于安全区），该筛选条件在
「zoom 恒为 1」的年代才成立；F6 去掉 1.1 门限后，开打首帧 zoom≈1.02（不再是精确 1），
于是这条断言抓不到调用（9/10）。

改为按**目标矩形**（`dw=390, dh=648, dy=96`＝舞台带）定位：F1 要验的不变量是
「X/Y 同一 scale + 铺满舞台带」，与源矩形大小无关。改后 11/11，且断言内容未放宽
（`scaleX=1.0171 scaleY=1.0171`，仍是同一 scale）。

