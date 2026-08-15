# 《最强水果》项目长期开发基线

> **基线源文件**：`最强水果_项目核心共识与开发边界_WorkBuddy_Memory.md`（V1.0）
> 完整内容以源文件为准，此处为长期上下文速查。

## 核心定位（一句话）

极简策略 + 事前组装 + 自动物理战斗。玩家循环：「我觉得这样能赢 → 看它自己打 → 原来问题在这 → 改一下再试」。判断机制是否保留的唯一标准：**它是否让玩家做出不同的下一步动作？**

## 指令优先级（3 级）

1. **最新明确的单次 WorkBuddy 执行指令**（最高）
2. **本文的稳定项目边界**
3. 历史设计草稿 / 旧方案

## 冲突处理（硬规则）

最新任务与本基线核心定位冲突时：**不自行默默实现冲突方案**，必须先指出「冲突点 + 体验/架构后果 + 最小建议修正」。

## 关键边界速查

- **物理**：2D 侧视（X/Y 平移 + Z 轴旋转），禁 3D Roll/Yaw。数字定能力，Physics 定能力能否表达。同 Build 同条件结果大体稳定，禁随机命中/伤害/散布。
- **四类结构**：Body（碰撞几何/质量分布，无主动攻击）、Movement（V1 只 Wheel，真实 Ground Contact 驱动）、Weapon（直接 HP 伤害）、Gadget（改碰撞/距离/姿态，不带大额 Direct Damage）。
- **Slot/Energy/Mass 分工**：Slot 限空间、Energy 限装配预算（超载直接拒绝穿戴）、Mass 制造 Runtime 物理后果（禁 MaxWeight 硬门槛）。
- **Auto Battle**：玩家不操作，AI 不替玩家聪明赢。V1 持续朝唯一敌人驱动，不后退/拉距/自动瞄准。攻击方向来自 Body 姿态 + Hardpoint 世界方向。允许挥空/射空/互扰。
- **Damage/Force 独立**：Damage 不自动映射 Knockback。Physics Contact 统一进 Contact Router，Damage 统一进 Damage Resolver，Renderer 不参与判定。
- **Arena**：V1 平地 + 左右普通墙。Convergence = Active→Warning→Closing→End，刺墙真实 Collider + Hazard。结果只有 Win/Lose，不建 Draw（同帧双死随机兜底）。
- **Quality**：白绿蓝紫橙红粉彩。跨品质核心 Behavior/物理身份稳定，尺寸/Collider/Mass/COM 基本不变，成长走 HP/Energy/Functional Hardpoint。
- **Physics Lab**：必须直接调正式 Battle Runtime，禁测试场专用物理。第三层体验验收必须 1x + Debug 关闭。

## 三层验收

1. 技术正确（tests/build/Runtime）
2. 方案落地（设计进正式 Runtime）
3. 实际体验成立（正常速度 + Debug 关 + 不听解释，玩家能感知/理解/归因/决策）

只有第三层通过才算设计完成。**开发完成 ≠ 体验通过 ≠ 进入正式主线。**

## 方案漂移红线（出现即主动提醒，不默认实现）

复杂职业 AI / 自动瞄准 / 自动拉距 / 大量隐藏 Buff / Body 免费攻击 / Weapon-Gadget 独立槽 / 高品质全维度碾压 / 复杂机关成胜负主体 / MaxWeight 硬限制 / 动画保证命中 / Gadget 偷偷大额伤害 / 大量例外规则 / 稳定最优 Build 通吃但只加 Content / Debug 成立但玩家感知不到。

## 开发节奏

P0 Bug / 公共 Foundation / 复杂根因 / 多模块迁移 → 单点深入。独立新机制/Content → 允许批量队列。推荐：批量设计 → 多队列顺序开发 → Physics Lab 集中验证 → 一段录像批量验收 → 只返修失败项。
