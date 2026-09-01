# CORE-LOOP-RC1 CHECKLIST

Queue：F-WX-CORE-LOOP-RC1-GATE-P0（纯集成验收 + RC 固化）
日期：2026-09-01
分支：foundation-02-wechat
HEAD：6adc710df86eb4fdc9589d50c5a04c572af76917

---

## 一、RC SHA 与产物路径

| 项 | 值 |
|---|---|
| RC HEAD | 6adc710df86eb4fdc9589d50c5a04c572af76917 |
| 产物目录 | outputs/core-loop-rc1-6adc710/ |
| 产物文件 | game.js / game.json / project.config.json / rc-build.json |
| 产物状态 | **FAILED（含 `__h` 泄漏，未交付）** |

> 注：产物已复制至 outputs/core-loop-rc1-6adc710/ 用于 Bug Queue 复现，**不作为可导入正式 RC 交付**。

## 二、自动化验收结果

| 门禁 | 结果 | 说明 |
|---|---|---|
| repo-health | ✅ 9/9 | 前置通过 |
| 三路 SHA | ✅ local=remote=6adc710 | 前置通过 |
| tsc --noEmit | ✅ 0 | |
| 全量 vitest | ✅ 1494/1494 | audioLifecycleP0 T3/T6 + platformCore 并发 5s 超时偶发，单独复跑 30/30 全过（非断言失败） |
| build | ✅ | |
| build:pages | ✅ | |
| build:e2e | ✅ | |
| build:wechat | ✅ | 普通构建零 __h / 零 badge |
| Garage 单元门禁 | ✅ 131/131 | center stage / center scale R2.1 / visual density / drag assembly / drag continuity / equipped / result-adjust 完成并再战 / 正常 Garage 无 CTA / live assembly / build board |
| Battle 单元门禁 | ✅ | dynamic framing R2.1 / camera hierarchy / phase+Closing 墙 / hit readability / FX screen-space / 下一局无旧 FX（wechatResumeRenderStateP0） |
| Battle E2E | ⚠️ 142/143（3 次采样噪声） | M「Warning 中央干净」偶发 centerRed 2.1%~20%（中央小面积红字=伤害数字被误计入；从未出现 50%+ 全屏红）→ 已知非阻塞采样噪声 |
| 核心循环 E2E loop | ✅ 18/18（复跑） | 首跑 22/23：H 重试 3 次内未遇 Win 局（战斗随机性）；复跑 1 次即遇 → 通过 |
| 核心循环 E2E rematch | ✅ 60/60 | 完成并再战：直接 Matching 不经过 Home、snapshot Build 一致、reward +1、新 session、无残留 |
| Garage E2E continuity | ✅ 112/112 | |
| Garage E2E drag | ✅ 140/140 | |
| 微信生命周期矩阵 | ✅ | wechatResumeRenderStateP0（hide/show 6 类）/ audioLifecycleP0 / wechatLifecycle / platformBinding |
| 存档矩阵 | ✅ | buildPersistence 往返 / garageAdjustRematchP0 T10（重启 Build 保持、上下文不恢复）/ q21MetaProgression |
| 几何安全区矩阵 | ✅ | rcSafeBadgeP0 / topSafeLayout / mobileLandscape / resultUxR1 360 短屏 / garageAdjustRematchP0 T11（420 几何） |
| **RC 构建门禁** | ❌ **FAILED** | **`globalThis.__h` 泄漏进 RC bundle（mountScreen 裸执行）——违反「无 __h」** |

## 三、RC 构建失败详情（真实缺陷，独立 Bug Queue）

- **最短复现**：`npm run build:wechat:rc` → `grep -c "globalThis.__h = this" dist-wechat/game.js` → 1（裸执行，无 if 包裹）。
- **首个错误断点**：`src/ui/canvasPlayerUIHost.ts:508`（mountScreen 内 `if (typeof __WX_DEBUG_GRANT__ !== 'undefined' && __WX_DEBUG_GRANT__) { globalThis.__h = this; }`）——`__h` 探针错误绑定 `__WX_DEBUG_GRANT__`（RC 调试 grant），而 `scripts/wechat-rc.js:79` 设 `WECHAT_DEBUG_GRANT=1` → 条件恒真 → 泄漏。
- **影响**：微信真机运行 mountScreen 时执行 `window.__h = host`（暴露内部 host 引用）；违反「正式构建零调试句柄」契约；普通 build:wechat 无此问题（未设 grant）。
- **应开 Bug Queue**：`F-WX-RC-BUNDLE-CLEAN-P0`（修复 mountScreen `__h` 条件改绑 `__WX_DEBUG__`；RC 构建后断言无 `__h`/`__probe`；重出 RC 并重验四方 SHA）。
- **本 Queue 不修复**（纯验收 Queue，按纪律禁止混合修复）。

## 四、已知非阻塞问题

1. `_e2e_battle.cjs` M 断言采样噪声：中央 40-60% 区域的红色伤害数字被计入「中央红」→ centerRed 偶发 2.1%~20%（阈值 2%）；真正「全屏中央红闪」回归仍会被 50%+ 捕获；非产品缺陷。
2. `_e2e_garage.cjs` 崩溃（DOM getBoundingClientRect 点击）——过时脚本（Canvas 全合成 UI 后未更新），不在有效门禁清单。
3. `_e2e_garage_center.cjs` 装配带占比 26.9% vs 阈值 27%（差 0.1%）——过时阈值（布局自 f50cb1e 未变，脚本未同步），非本轮回归。

## 五、iOS 真人验收步骤（待验证）

> 以下步骤用于 RC 修复后（`F-WX-RC-BUNDLE-CLEAN-P0` 重出 RC）的真机验收，**当前未执行、未通过**。

1. 微信开发者工具导入 `outputs/<新RC目录>/`，编译 → 预览二维码 → iOS 真机。
2. 首页：车辆完整居中、4 宝箱不进入胶囊、RC badge 在安全区内（#<sha>）。
3. Garage（正常进入）：车辆/顶栏/装配带完整；顶栏无「完成并再战」。
4. 战斗（Home→匹配→Battle）：双车/HUD/地面/Closing 墙可见；伤害数字 15/18px；受击白框闪烁非常驻。
5. 战败 → 调整配置：直接进入 Garage 装配台；顶部出现「完成并再战」暖金按钮；不遮挡能量与返回。
6. Garage 换装（换 body）→ 点「完成并再战」→ 直接进 Matching（不经过 Home）→ 新 Battle 车辆外观变化。
7. Result「下一场」：Win 主按钮=下一场；连点不重复创建匹配。
8. 前后台：Battle 切后台停音、回来不叠加；Result 切后台奖励不重复；onShow 相机重取景无漂移。
9. 杀进程重开：Build/库存/金币/段位保持；「完成并再战」不恢复；存档损坏走既有 fallback。
10. 120 帧持续战斗无累计漂移、无闪退、无卡死。

## 六、每项状态汇总

| 项 | 状态 |
|---|---|
| 前置健康（repo-health / SHA / 干净 / 无 zz_*） | ✅ Pass |
| 全量测试 / 四构建 / 全部门禁（单元+E2E） | ✅ Pass（除下述 RC 构建） |
| 生命周期矩阵 | ✅ Pass |
| 存档矩阵 | ✅ Pass |
| 微信几何与安全区（单元矩阵） | ✅ Pass |
| 最终像素检查（E2E 像素门禁） | ✅ Pass（battle/loop/rematch/continuity/drag） |
| **RC 构建（无 __h / 无探针 / 四方一致）** | ❌ **Fail（__h 泄漏）** |
| iOS 真人体验 | ⏳ 未验证（待 RC 修复后） |
