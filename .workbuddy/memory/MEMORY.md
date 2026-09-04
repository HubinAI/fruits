# 《最强水果》项目长期开发基线

> 源文件：`最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md`（V1.0）。本文为运行时注入的精简版，完整内容以源文件为准。

## ⚠️ 微信 iOS 真机调试（最高优先）
含「微信/iOS/真机/Canvas/DPR/Surface/viewport/点击错位/UI放大/裁切/闪退/卡死/音频叠加/前后台/resize」的 Queue，**先读** `.workbuddy/memory/F-WX-IOS-REALDEVICE-DEBUG-PLAYBOOK.md`。
- 先标注坐标域（logical/window/backing/physical）；**DPR 仅在 logical→backing 最终绘制应用一次**（禁 fit 与绘制双乘）。
- 内部 rect 正确 ≠ 像素正确；Web ≠ 模拟器 ≠ 真机；自动化通过 ≠ 真人体验通过。三者必须分开表述。
- 底层修复：先红后绿（fake 从微信真实默认 logical Canvas 起步）+ 模拟器亲检 + 真机录屏（可见 SHA）；禁字号/gap/offset/局部 DPR 补偿掩盖全局坐标错。
- 已验证基线 c3ed90d 仅代表微信 Canvas/DPR/主流程真机通过；Garage 体验/UI 正式度/胶囊安全区/前后台长稳未过。**禁再改已通过的 Canvas backing/Surface logical/DPR 单次绘制底层。**

## 核心定位
极简策略 + 事前组装 + 自动物理战斗。玩家循环：「我觉得能赢→看它自己打→问题在这→改一下再试」。机制去留标准：**是否让玩家做出不同下一步动作？**
指令优先级：最新明确单次执行指令 > 本文稳定边界 > 历史草稿。冲突时**不默默实现**，先指出冲突+后果+最小修正。

## 关键边界
- 物理：2D 侧视（X/Y 平移 + Z 旋转），禁 3D Roll/Yaw。数字定能力，Physics 定表达。同 Build 同条件结果稳定，禁随机命中/伤害/散布。
- 四类：Body（碰撞/质量，无主动攻击）、Movement（V1 只 Wheel，真实 Ground Contact 驱动）、Weapon（直接 HP 伤害）、Gadget（改碰撞/距离/姿态，不带大额 Direct Damage）。
- Slot 限空间、Energy 限预算（超载拒绝）、Mass 造 Runtime 物理后果（**禁 MaxWeight 硬门槛**）。
- Auto Battle：持续朝唯一敌人驱动，不后退/拉距/自动瞄准；攻击方向来自 Body 姿态 + Hardpoint 世界方向；允许挥空/射空/互扰。
- Damage 不自动映射 Knockback。Contact→Contact Router，Damage→Damage Resolver，Renderer 不参与判定。
- Arena：V1 平地 + 左右墙；结果仅 Win/Lose，不建 Draw。Quality：跨品质核心 Behavior/物理身份稳定，成长走 HP/Energy/Functional Hardpoint。
- Physics Lab：必须调正式 Battle Runtime，禁测试场专用物理。第三层验收须 1x + Debug 关。

## 三层验收
技术正确(tests/build)→方案落地(进正式 Runtime)→实际体验成立(1x+Debug关+玩家能感知/理解/归因/决策)。仅第三层通过=设计完成。**开发完成≠体验通过≠进正式主线。**

## 方案漂移红线（出现即提醒，不默认实现）
复杂职业 AI/自动瞄准/自动拉距/大量隐藏 Buff/Body 免费攻击/Weapon-Gadget 独立槽/高品质全维度碾压/复杂机关成胜负主体/MaxWeight 硬限制/动画保证命中/Gadget 偷偷大额伤害/大量例外规则/稳定最优 Build 通吃只加 Content/Debug 成立但玩家感知不到。

## Canonical Physics（2026-08-17）
- **gravity.scale=0.0001**（唯一）；固定步进：Drive/Behavior 在每个 FIXED_DT 的 Engine.update 前执行（onBeforeStep），战斗时间按 steps*FIXED_DT。
- setMeta 已传播到 compound sub-part（碰撞 pair 是 sub-part，不传 meta 则 Contact Router 读不到 Owner）。
- 接触相对速度：dispatch 用 `collision.parentA/parentB`（父 COM）+ `vPoint=vCOM+ω×r`；bodyA/bodyB 仍传 sub-part。
- Matter 速度读取铁律：collisionStart/Active 回调内 velocity 才是真实值（积分后、求解前）；Resolver.solveVelocity 在事件后回写。

## vitest 运行环境（重要）
- 不带 `--pool` 全失败（vitest 4.1.10 双实例故障，与代码无关）。**所有 vitest 必须带 `--pool`**。
- **全量回归一律 `--pool=vmForks --maxWorkers=1`**（vmThreads 有 fake timers 顺序耦合偶发失败）；单文件可用 vmThreads。
- fake timers 泄漏：`vi.useFakeTimers()` 不恢复→污染后续文件真实 setTimeout→5s 超时。修复：`afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();})`。
- 对手池基线（22230fd）：OPPONENT_POOL 36→49 + TEMPLATES(role 五类)+ROLES+ROLE_INDICES；主组合去重 49/49。`vi.spyOn(Math,'random').mockReturnValue(固定值)` 隐式映射对手索引的 harness，铺量后必须复查抽取映射与战斗预算。
- 已知问题：`docs/KNOWN-ISSUES.md`（KNOWN-<AREA>-<SEQ>）；已登记 KNOWN-WX-COLD-BOOT-PREVIEW-SCALE-01。

## Git / 凭据 / 工具层
- 身份：本仓库 `xiaoyue <xiaoyue@local>`（新会话需重设）；push 走 SSH（`git@github.com:HubinAI/fruits.git`，免密）。
- **git ref 写入不可靠**：commit 后分支 ref 常不落盘（update-ref/branch -f 也静默失败）。可靠恢复：`mkdir -p .git/refs/heads/<b> && printf '%s\n' <sha> > .git/refs/heads/<b>`；commit 后立刻 `git log` 验证，未落盘用 fsck/cat-file 确认对象完整后手动写 ref 再 push。
- `.gitconfig` 可能含 `!` 前缀外部 helper 行；切回 manager 须整行覆盖。GCM 根除唯一路径=用户 GUI 勾 Always use this from now on；HTTPS 非交互=inline token URL（单次不写盘）。
- git status 把 `planck` 显示成 `plank`（中文路径伪影），真实文件名始终 `planck`，用 `ls <dir>/` 拿拼写。
- Git Bash 中文目录路径不稳；git 命令用裸相对路径几乎都稳。Read 对中文绝对路径偶发失败，Bash cat 兜底。

## 微信视口同步唯一入口（2026-09-01，95805d0 后）
- `src/platform/wechat/viewportSync.ts` 的 `syncWechatViewport(reason)` 是唯一入口：onShow/onWindowResize/show-retry 统一复用，**禁止任何路径独立改 canvas backing 或调 runtime.doResize**。
- iOS 后台返回三缺陷已修：onShow 不同步 backing；onWindowResize 同尺寸早退；竖屏 transient 立即提交+稳态 dirty=false 不重绘（UIHost 新增 forceRedraw()）。
- 竖屏 transient 契约：w≤h 不提交、≤5次×100ms 重读至稳定 landscape；过渡期保持上一张合法横屏+不恢复 loop。

## 测试确定性（2026-09-01）
- 战斗内无随机，但匹配层（`pickOpponentForTier`+`buildMatchingSequence`）消费 Math.random。驱动战斗到结束的测试必须 mock 常量（`vi.spyOn(Math,'random').mockReturnValue(0.5)`，带 `!vi.isMockFunction` 防重守卫）。
- 候选池动态索引：settleRng 用 `idx/pool.length`（基于当前候选池动态索引）精确命中 defId——池大小随拥有状态变化，固定 mock 值不可靠。

## E2E / 内容包集成（2026-09-01，6a50d4e）
- strip-scroll 箭头无 clamp 缺陷（canvasPlayerUIHost L1520-1526，clamp 仅在 L2570）→ 点卡瞬间 hitArea 漂移装错卡 → E2E 以 verify+重试吸收；产品修复留后续 Queue。
- 轮卡 armed 路径：move 分类点卡→双挂点 armed（armGarageCard）→须再点 `hp-sel:rear/front` 才装备（body 分类单目标直接装备）→ E2E verify+onVerifyFail 吸收。
- 移动端 drive 槽无入口（chip/entry/hp-sel:drive 均缺；Garage idle 挂点不注册命中，F-GARAGE-VISUAL-DENSITY-R2 设计）→ 站桩/卸轮真实点击不可达，属 F-GARAGE-TOUCH-ASSEMBLY-R2。
- 战斗动态采样噪声：实时移动/碰撞→单帧统计漂移大。采样=Active 后立即(150ms)+belt 多帧平均(3×350ms 覆盖≥1.5圈)；中心断言用「走廊左端 0.15~0.35W 且各轮组一致」。
- 移动端 Garage 交互：三视口全 mobile（isCompactLandscape: h<600 && aspect≥1.5）→无 chip:* 命中区；只有 `garage-cat:body|move|combat` tab + 当前选中槽横向卡带；切分类自动选中首槽（body→body/move→rearWheel）。

## 背包 / 合成设计基线（2026-09-02，F-GARAGE-INVENTORY-FUSION-P0）
- Garage 顶栏恒含 `nav:backpack`（back 右侧、energy 左侧）；`nav:more` **从不注册 hitArea**（garage/shell 两模式 `tb.more` 恒 null）→仅经私有 dispatch。
- 背包页：分类 `bfilter:combat|movement|body`；卡片 `backpack-select:<defId>`；选中且≥5 未装备同★副本才注册 `backpack-fuse`（L2033 disabled 不注册）。Body 不合成。
- 合成：`fuseSameStar(inv,defId,star,build)` 5 同 defId 同★未装备→1 同 defId ★+1；**无金币、无跨 defId、已装备保护、MAX_STAR=2 钉死、满星返回 null**。`available=owned−equipped`。
- 导航不变量：`nav:backpack` 进背包（清 selected/toast）；`nav:garage` 从背包返**车库配置页**（保留 garageFromResult，不经 Home、不重建 runtime）；`nav:more`/`nav:home` 才清。
- 旧金币跨 defId 融合已移除：`mergeWithCost`/`tryMerge`/`MERGE_COST_COIN`/`canAffordMerge`/`showMergeModal`/`onMerge` 全删；合成 handler=`onFuse(defId,star)`（复用 `merge_attempt`/`merge_success`）。

## E2E 内部句柄命名空间铁律（2026-09-03，9c76c9b）
- `globalThis.__fx` 已被 `main.ts:452` 表现层特效探针独占（spawnDamage/spawnSpark/spawnLaserBeam/debug）；两处 `__fx={…}` 是整体赋值→后落笔者静默覆盖前者。新测试能力**必须用新命名空间**，禁复用 `__fx`。
- 句柄分工：`__h`=host、`__probe`=每帧几何、`__fx`=表现层特效、**`__inv`=背包库存种子**（`seedInventory`）。
- 新增句柄必须同时：①包在 `if(typeof __E2E_INTERNAL_HANDLE__!=='undefined'&&__E2E_INTERNAL_HANDLE__)` 内；②加进 `scripts/check-wechat-bundle-clean.js` 的 FORBIDDEN **和** E2E allowlist。漏②=开泄漏通道。
- 「bundle grep 到字符串」≠「运行时句柄可用」；句柄可用性只能用 `page.evaluate(()=>Object.keys(window.__X))` 真实浏览器取证。
- `metaPage` 是 CanvasPlayerUIHost **私有字段（L386），不在 PlayerUIState**；测试 `render({metaPage:'backpack'})` 是静默 no-op。进背包唯一正确路径=真实点击 `home-garage`→`nav:backpack`→`bfilter:*`。
- `makeStarterDraft()` 默认把 `cannon` 装 `frontMass`→需「N 件全未装备」场景须用全 EMPTY_SLOT 的 bareDraft，否则 `available=owned−1` 恒少1、合成按钮恒 disabled。
- 读 Canvas 真实文案正道：`page.addInitScript` 劫持 `CanvasRenderingContext2D.prototype.fillText` 记到 `window.__txt`——纯测试侧 instrumentation，源码零改动。
- 后台服务器：`(node server &)` 写在单次 Bash 调用里会随调用结束被回收→E2E 报 ERR_CONNECTION_REFUSED。静态服务器须 `run_in_background=true` 常驻，跑完显式停。
- 源码字符串守卫断言铁律（2026-09-04）：断言源码含子串**一律用「方法边界截取」**（`src.indexOf('\n  private ', methodStart+10)` 取下一顶层 private 方法边界），**禁固定字符窗口**（`src.slice(start,start+N)`）。反面：`garageBuildBoardP0.test.ts T6` 原用固定 2600 字符窗口，方法体增长后截不到目标行而误报（base 同样不成立，属既有脆性）；d41fcac 已改边界截取修复。判定=拿 base 原文件跑同断言对照。

## RC 测试工具宏（F-RC-FUSION-TEST-ENTRY-P0）
- `__WX_DEBUG_GRANT__`：RC 体验包专属宏（`vite.wechat.config.ts` define，由 `WECHAT_DEBUG_GRANT=1` 注入 `npm run build:wechat:rc`；普通微信包=false，编译期折叠）。`wechat/game.ts:139` 的 `isResetDevVisible` 已绑此宏。
- `__E2E_INTERNAL_HANDLE__`：E2E 包专属宏（库存种子 `__inv` 句柄用），普通/RC/微信包折叠移除。
- 背包测试材料按钮 `backpack-test-material`（标签「测试材料×5」）：仅 `(rcGrant||e2eProbe||devReset) && 无2★副本` 时绘制+注册；点击补足当前选中 defId 1★ 可用数到 5（requiredOwned=equippedCount+5；topUp=max(0,requiredOwned−owned)）；已装备保护、满5幂等、不影响其它部件/Build/能量/金币/段位/奖励池。普通微信/Pages/正式Web 恒不可见。
- dev-grant 标签：领取前「全部件×1」、领取后「全部件×1 ✓」（保留可见；×1 幂等语义不变；claimed 由真实库存完整性计算）。

## 正式部件 defId 速查
冲锤=`rammer`、火炮=`cannon`、机枪=`machineGun`、激光=`laser`、推进器=`thruster`。**坑**：`'ram'` 不是有效 id，`addPart` 对非官方 id 静默 no-op。OFFICIAL_BODIES 含车身件（合成面板 early-return 排除）。
