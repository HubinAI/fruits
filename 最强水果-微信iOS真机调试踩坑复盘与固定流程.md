# 《最强水果》微信 iOS 真机调试踩坑复盘与固定流程

> 文档定位：项目长期记忆 / 微信小游戏真机调试基线 / WorkBuddy 执行约束  
> 形成时间：2026-08-29  
> 当前分支：`foundation-02-wechat`  
> 当前已验证基线：`c3ed90d44f2712dc3bc1ad28ed10039c903f8356`  
> 适用范围：微信开发者工具、iOS 真机、Canvas、DPR、输入、前后台生命周期、RC 调试包

---

## 1. 为什么必须保留这份文档

本轮问题经历了多次“自动化全绿，但玩家真机仍严重错乱”的情况。真正困难的部分不是某一行代码，而是同时存在以下四个误导因素：

1. Web、微信开发者工具和 iOS 真机对 Canvas 初始尺寸、DPR、输入事件的行为并不完全相同；
2. 内部逻辑坐标、Canvas backing、微信窗口逻辑尺寸、最终屏幕像素曾被混为一套坐标；
3. 旧测试桩直接提供了正确的物理 backing，绕过了微信真实环境的错误初始状态；
4. 大量单测和内部 rect 断言只能证明代码自洽，不能证明玩家最终看到和点到的是同一个位置。

因此，本次经验必须转化为项目固定规则：

> **数据与测试用于解释体验，不能用于反驳真机体验。内部坐标正确，不等于最终合成正确；技术实现完成，不等于方案落地，更不等于真人体验通过。**

---

## 2. 最终结论

### 2.1 当前已经确认通过的内容

在 iPhone 真机运行 `#c3ed90d`，连续约 75 秒完成 Garage → Matching → Battle → Result：

- 不再出现全局 2～3 倍放大；
- 不再出现右侧、底部大面积裁切；
- 不再出现文字逐帧堆叠成乱码；
- 点击位置恢复可用；
- Garage 装备变化可以反映到车辆；
- Matching、Battle、Result 可连续完成；
- 本次录屏未出现卡死或闪退；
- 结算尾段未发现此前那种持续战斗噪音。

因此可以判定：

| 层级 | 状态 |
|---|---|
| 微信 Canvas / DPR / Surface 坐标底层 | **真机通过** |
| 微信基础点击与主流程 | **真机通过** |
| Garage 装备功能 | **基本可用** |
| Garage 操作体验与 UI 正式度 | **尚未通过** |
| 微信胶囊安全区 | **仍需修复** |
| 前后台恢复与长时间稳定性 | **仍需专项真机复验** |

### 2.2 当前不能得出的结论

`c3ed90d` 解决的是阻塞体验的底层坐标和渲染问题，不能据此宣布：

- Garage 已达到《喵星人大作战》级别的拖装体验；
- 所有 UI 已完成正式适配；
- 所有 iPhone 型号、横竖屏切换与系统版本都通过；
- 前后台切换、音频、长战斗永远不会异常；
- Demo 已通过最终真人体验验收。

---

## 3. 问题演进与版本时间线

| 版本 / 包 | 主要变化 | 真机或模拟器结果 | 结论 |
|---|---|---|---|
| `f081a0f` | Garage 拖动连续性阶段 | 微信底层问题尚未完整暴露 | 功能前置基线 |
| `575f1d0` | SingleLoop、微信生命周期、音频 Context、错误守卫 | 修复生命周期类风险，但不能解决全局画面错乱 | 必要但非根因 |
| `1fb1153`（早期 RC/C2） | 调试 SHA、测试入口等 RC 能力 | iOS 出现 UI 逐帧堆叠、乱码、放大、点击后卡死 | 严重失败 |
| `46d6ea1`（C3） | 修复 UI 帧累积、合成状态、循环停止及探针隔离 | 文字堆叠改善，但全画面仍整体放大和裁切 | 只解决第一层问题 |
| `c3ed90d`（C4） | 明确 Canvas backing、Surface logical 域与 DPR 单次应用 | 开发者工具画面恢复；iPhone 真机主流程可运行 | 当前已验证底层基线 |

### 关键认识

这次不是一个 bug，而是两层问题叠加：

1. **帧生命周期错误**：UI 清屏、合成或循环状态不稳定，导致内容逐帧累积甚至循环停止；
2. **坐标域错误**：Canvas backing、Surface logical 和 DPR 重复换算，导致稳定但整体放大、裁切和输入错位。

如果只修第一层，画面会“不再越来越乱”，但仍然是稳定地错；如果只修第二层，帧累积仍可能把正确画面再次污染。

---

## 4. 真根因：Canvas、Surface 与 DPR 坐标域不统一

### 4.1 微信真实初始条件

微信首画布通过 `wx.createCanvas()` 创建后，不能假设其 `width/height` 已经是物理 backing。项目早期代码却默认：

```text
canvas.width  = windowWidth  × pixelRatio
canvas.height = windowHeight × pixelRatio
```

实际代码没有在所有消费方初始化之前显式建立这一约定，于是微信真实默认值可能仍是窗口逻辑尺寸。

以横屏逻辑窗口 844×390、DPR=3 为例：

| 对象 | 错误状态 | 正确状态 |
|---|---:|---:|
| 微信窗口 logical | 844×390 | 844×390 |
| 主 Canvas backing | 844×390 | 2532×1170 |
| UI Canvas backing | 844×390 | 2532×1170 |
| `canvas.width / dpr` | 281×130 | 844×390 |

后续 Renderer 和 UI 再执行 DPR 变换时，相当于在只有三分之一逻辑空间的 buffer 上继续放大，最终表现为：

- 首页头像、宝箱、CTA、SHA 全部巨大；
- 右侧和底部内容被裁切；
- Garage、Matching、Battle 同时错乱；
- 玩家点击可见按钮无反应，点旧位置反而触发功能。

### 4.2 第二层错误：Surface 把 backing 当 logical

即使把 Canvas backing 修为 `window × dpr`，如果 `WechatViewport.surface.width/height` 继续向 Renderer 返回 backing 尺寸，Renderer 的 fit/相机仍会在物理像素域计算；随后绘制阶段又执行一次：

```ts
ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
```

结果就是 DPR 被应用两次。

正确契约必须是：

```text
windowWidth / windowHeight      = logical window
canvas.width / canvas.height    = backing pixels
surface.width / surface.height  = canvas backing ÷ dpr = logical window
Renderer 布局、相机、UI         = logical
ctx.setTransform(dpr, ...)       = logical → backing 的唯一最终转换
```

### 4.3 正确初始化顺序

微信入口必须在创建 Context、Surface、Renderer、UI Host、Input 之前完成尺寸定版：

```ts
const info = wx.getWindowInfo()
const dpr = info.pixelRatio || 1
const backingW = Math.round(info.windowWidth * dpr)
const backingH = Math.round(info.windowHeight * dpr)

screenCanvas.width = backingW
screenCanvas.height = backingH

uiCanvas.width = backingW
uiCanvas.height = backingH
```

随后：

- `createWechatCore` 必须收到同一个真实 DPR；
- Surface 对 Renderer 暴露 logical 尺寸；
- 两块 Canvas 使用完全一致的 backing；
- UI 和 Renderer 各自在 logical 域绘制；
- 最终合成只能应用一次 DPR；
- Input 逆变换必须与显示 transform 同源。

### 4.4 窗口变化

如果环境支持 `wx.onWindowResize`：

1. 重新读取 `windowWidth/windowHeight/pixelRatio`；
2. 同步重设 screenCanvas 与 uiCanvas backing；
3. 重建或更新 Surface logical 尺寸；
4. 重新应用 Context transform；
5. 调用 Runtime resize/reframe；
6. 清理未完成的拖动、pointer capture 和 armed 状态。

禁止只修改一个 Canvas，或只修改 CSS/布局尺寸而不修改 backing。

---

## 5. 为什么旧自动化全部通过却没有发现问题

### 5.1 Fake Canvas 给了“已经正确”的 backing

旧测试桩通常直接创建 2048×941、2532×1170 等物理尺寸 Canvas。它绕过了微信真环境“初始 Canvas 只有 logical 尺寸”的前置错误，因此测试从一开始就处在修复后的世界里。

正确回归用例必须从微信真实默认状态开始：

```text
window = 844×390
dpr = 3
canvas 初始 = 844×390
bootstrap 后必须 = 2532×1170
surface 必须 = 844×390 logical
```

这类测试必须具备“禁用修复时先红、恢复修复后再绿”的证据。

### 5.2 内部 rect 同源不等于最终像素正确

如果绘制矩形和测试读取的矩形都来自同一个错误 transform，两者当然相等，但玩家看到的最终合成可能仍是错的。

以后涉及以下问题，必须使用最终合成像素或真机录屏：

- 车辆是否真正居中；
- 扫描框是否围绕对手；
- Locked 名牌是否在车辆上方；
- CTA 可见中心是否等于点击中心；
- 微信胶囊是否遮挡 HUD；
- 两 Canvas 是否最终重合；
- DPR 2/3 是否仍保持相同 logical 构图。

### 5.3 Web 环境不能替代微信真机

Playwright Chromium、Windows Chrome、微信开发者工具、iOS 微信内核可能在以下行为上不同：

- `getBoundingClientRect()` 是否包含 CSS transform；
- pointer 与 touch 事件字段；
- `touchend` 的 `touches` 与 `changedTouches`；
- Canvas 默认 backing；
- AudioContext 创建方式；
- 前后台 rAF 生命周期；
- 安全区与微信胶囊位置。

Web E2E 只能作为快速回归，不能替代微信模拟器和 iOS 真机。

---

## 6. 本轮有效的调查方法

### 6.1 使用隔离包，而不是在同一个包反复猜

本轮采用 A/B/C1/C2/C3/C4 隔离：

- 每个包绑定明确 commit；
- 每个包显示独立诊断编号或 SHA；
- 诊断编号直接画在主画布，不能复用可能出错的正式 UI Canvas 路径；
- 普通包、RC 包、probe 包必须区分；
- 禁止多个后台构建进程交错写同一个日志或同一个 dist；
- 任何录屏必须先确认水印 SHA，防止旧缓存、旧二维码、旧目录污染判断。

隔离包的价值是回答：

> **第一个出现问题的版本是哪一个？变化来自功能代码、RC 探针，还是运行环境？**

### 6.2 记录完整数值链

诊断日志不应只打印一个 `dpr`，而应在 boot、resize、首帧分别输出：

```text
windowWidth / windowHeight
pixelRatio
screenCanvas.width / height
uiCanvas.width / height
surface.width / height
Renderer viewWidth / viewHeight / viewDpr
logical stage width / height
contain scale / offset
ctx current transform
touch client/window 坐标
最终 logical 坐标
```

推荐统一日志前缀：`[WX-SURF]`、`[WX-INPUT]`、`[WX-LIFE]`、`[WX-AUDIO]`。

### 6.3 先验证机制，再修改行为

本轮最有效的证据包括：

- 模拟错误 rect 后，点击行为可以精确翻转；
- 禁用 backing 定版时，测试从绿变红；
- Surface 改为 logical 后，模拟器整体 3 倍放大消失；
- 同一 SHA 在 iPhone 真机完成完整流程，无卡死和闪退。

没有机制翻转证据时，不应靠不断调整 gap、字号、车辆 offset 或扫描框补偿来碰运气。

---

## 7. 微信真机固定调试流程

以后所有微信底层 P0 问题，严格按以下顺序执行。

### 阶段 A：冻结与复现

1. 冻结视觉、Physics、装备规则等无关改动；
2. 记录 branch、local HEAD、remote HEAD；
3. 记录微信开发者工具版本、设备、iOS、微信版本、横竖屏、DPR；
4. 录制第一次异常，不要求长流程；
5. 明确问题属于画面、输入、音频、生命周期还是多层叠加。

### 阶段 B：事件链和坐标域

对输入问题，至少追踪：

1. 原始 touch/pointer；
2. Canvas backing/client/window 数据；
3. Input 收到的原始坐标；
4. client/window → logical 入参；
5. viewport transform；
6. host handlePointer；
7. layout point；
8. hitArea 命中；
9. dispatch/action；
10. Runtime phase 与最终画面。

对画面问题，至少追踪：

1. window logical；
2. Canvas backing；
3. Surface logical；
4. Renderer view；
5. DPR transform；
6. camera/contain；
7. UI logical；
8. overlay backing；
9. composite transform；
10. 最终屏幕像素。

### 阶段 C：隔离与先红后绿

1. 构建历史 A/B 包定位首个错误版本；
2. 分离普通构建、RC badge、E2E probe、debug grant；
3. 新建真实微信默认 Canvas 测试桩；
4. 禁用候选修复，确认测试会红；
5. 恢复修复，确认测试转绿；
6. 清理所有临时日志和诊断入口。

### 阶段 D：自动门禁

至少覆盖：

- DPR 1/2/3；
- 844×390；
- 2048×941；
- 2532×1170；
- 2796×1290；
- 非整数 contain；
- 120 帧无累积；
- 首页车辆完整且居中；
- CTA 最终像素中心为屏幕 50%；
- Garage 车辆、卡带和点击正常；
- Matching 双车、扫描框、名牌正常；
- Battle 双车、HUD、Result 正常；
- 输入坐标与最终可见控件一致。

### 阶段 E：模拟器与真机

顺序不可颠倒：

1. 自动门禁全绿；
2. 微信开发者工具模拟器亲眼检查；
3. 构建带新 SHA 的唯一 RC；
4. iPhone 真机冷启动；
5. 完整主流程录屏；
6. 前后台切换；
7. 结算停留；
8. 第二局确认无状态、音频或循环累积。

只有阶段 E 通过，才能使用“真机体验通过”的表述。

---

## 8. 真机录屏固定要求

### 8.1 基础录屏

- 横屏；
- 开启声音；
- 不剪辑、不加速；
- 开始画面必须能看到 SHA；
- 显示首页至少 3～5 秒；
- 完整操作：Home → Garage → 换装 → Home → Matching → Locked → Battle → Result；
- Result 停留至少 5 秒；
- 必要时进入下一局验证音频与 Runtime 未累积。

### 8.2 生命周期专项

- Battle 中切后台 3～5 秒；
- 回到微信后继续至少 10 秒；
- 检查是否双倍加速、卡死、音频叠加、触摸残留；
- 再完成一局或返回首页。

### 8.3 录屏判定纪律

- 看不到 SHA：无效；
- SHA 不是目标 HEAD：无效；
- 只录模拟器：不能宣布真机通过；
- 只录首页：不能证明主流程；
- 只提供测试报告：不能替代录屏；
- 玩家主观感到错位或卡顿：先按真实问题调查，不以门禁数量反驳。

---

## 9. 本轮错误做法与永久禁令

### 9.1 禁止继续做的事

1. 禁止用字号、gap、offset、车辆缩放补偿全局坐标错误；
2. 禁止对扫描框、车辆、名牌分别增加独立 DPR 补偿；
3. 禁止让 UI、Renderer、Input 各自读取不同尺寸来源；
4. 禁止同时把 backing 尺寸用于 Surface logical 和 DPR 绘制；
5. 禁止只比较两个同源 rect 就宣布最终画面正确；
6. 禁止以“测试文件很多、通过数量很高”宣布体验完成；
7. 禁止 RC badge、E2E probe、debugGrant 使用同一个总开关；
8. 禁止调试文字走可能已经损坏的 UI overlay 路径；
9. 禁止多个隔离构建复用同一 dist 或交错写同一日志；
10. 禁止在没有确认 SHA 的情况下分析录屏。

### 9.2 必须坚持的原则

- 坐标域先标注，再写换算；
- DPR 只在 logical → backing 最终绘制时应用一次；
- resize 必须同时更新两 Canvas、Surface、Renderer、UI、Input；
- 每个修复必须有能失败的回归用例；
- 模拟器通过后才给用户真机包；
- 真机通过后才关闭微信底层 Queue；
- 体验问题与技术问题分开排队，不把 UI 美化混入 P0 底层修复。

---

## 10. 当前仍存在的问题（不要与本轮底层问题混淆）

`c3ed90d` 真机录屏已经证明底层可运行，但仍观察到：

1. Garage 装配区接近半屏，中央车辆偏小，视觉主次仍不理想；
2. 卡片文字密集、字号偏小，“已装备”虽然存在但识别层级弱；
3. 拖装时挂点圆圈、红色无效提示、占用虚线同时出现，反馈过杂；
4. 左右箭头靠近并覆盖边缘卡片，横滑与拖装存在操作竞争；
5. 微信胶囊和 RC 调试条会遮挡顶部状态、宝箱或 Battle HUD；
6. Battle 部件外框偏重，接触位置和伤害数字仍有原型感；
7. 本次真机录屏没有覆盖 Battle 前后台切换，生命周期仍需专项验证。

这些问题应进入独立 Queue，禁止再次修改已经通过的 Canvas backing / Surface logical / DPR 单次绘制底层。

建议后续顺序：

1. `F-WX-SAFE-AREA-P0`
2. `F-GARAGE-TOUCH-ASSEMBLY-R2`
3. `F-GARAGE-VISUAL-DENSITY-R2`
4. `F-BATTLE-VISUAL-CLEANUP-R3`
5. `F-WX-LIFECYCLE-REALDEVICE-GATE-P0`

---

## 11. WorkBuddy 读取与执行规则

建议将本文放入仓库：

```text
.workbuddy/memory/F-WX-IOS-REALDEVICE-DEBUG-PLAYBOOK.md
```

以后任何包含以下关键词的 Queue，开始前必须完整读取本文：

```text
微信 / iOS / 真机 / Canvas / DPR / Surface / viewport / 点击错位 /
UI 放大 / 裁切 / 闪退 / 卡死 / 音频叠加 / 前后台 / resize
```

WorkBuddy 每次相关交付报告必须明确列出：

- 修改前坐标域链；
- 首个错误转换点；
- 是否修改 Canvas backing；
- 是否修改 Surface logical；
- DPR 在何处应用；
- 普通构建、RC、probe 的开关隔离；
- 自动门禁结果；
- 模拟器结果；
- 真机是否已验收；
- local / remote / deployment SHA；
- 仍未覆盖的真实环境。

---

## 12. 项目协作结论

本次踩坑最重要的经验不是“Canvas 记得乘 DPR”，而是：

> **先确定每一个值属于哪个坐标域，再允许写任何换算；先看玩家最终画面，再用日志和测试解释；先让测试能复现真实环境，再相信测试结果。**

本项目今后继续坚持三层状态：

1. **技术已实现**：代码与自动化成立；
2. **方案已落地**：目标结构真实出现在正式 Runtime；
3. **真人体验通过**：目标设备上由真人连续操作验证成立。

`c3ed90d` 已达到本轮“微信 iOS Canvas / DPR / 主流程真人通过”，但 Garage、UI、安全区和生命周期长测仍需后续 Queue 完成。

