# 《最强水果》项目核心共识与开发边界
## WorkBuddy 长期上下文 / Memory Baseline

**版本**：V1.0  
**用途**：作为 WorkBuddy 在《最强水果》项目中的长期稳定上下文，用于判断开发边界、避免方案漂移。  
**注意**：本文不是单次任务指令，也不是完整设计文档。具体实现顺序、参数和当轮修改，以最新 WorkBuddy 执行指令为准。

---

# 1. 项目核心定位

《最强水果》的核心不是复杂操作、技能释放或智能 AI，而是：

> **极简策略 + 事前组装 + 自动物理战斗。**

玩家核心循环：

> **我觉得这样应该能赢 → 看它自己打 → 原来问题在这里 → 那我改一下再试。**

战斗的核心价值不是“看自动动画”，而是：

> **验证玩家上一轮 Build 判断，并让失败产生清楚的下一步修改方向。**

最终判断一个机制是否值得保留：

> **它是否让玩家做出了不同的下一步动作？**

---

# 2. 设计总原则

所有设计都视为“等待验证的体验假设”。

固定检查：

> **存在 → 可感知 → 可理解 → 可决策**

优先使用玩家天然理解的物理因果：

- 移动
- 速度
- 距离
- 重量
- 重心
- 碰撞
- 角度
- 支撑
- 摩擦
- 后坐
- 抬升
- 翻转
- 射击
- 挥击
- 切割
- 受伤
- 坠落

尽量避免：

- 隐藏权限
- 特殊攻击资格
- 大量 Buff / Debuff
- 复杂状态
- 大量文字解释
- 例外规则
- 为了平衡加入无法从画面理解的修正

如果一个机制连续 2～3 轮仍然很难懂：

> **优先问“能删掉哪个规则？”**

不要默认继续增加特效、提示、状态和说明。

---

# 3. 物理战斗核心原则

项目采用：

> **2D 侧视平面物理。**

允许：

- X / Y 平移
- 屏幕平面 Z 轴旋转

不做 3D Roll / Yaw 等额外自由度。

核心物理语言：

- Mass
- Center of Mass
- Moment of Inertia
- Collider
- Contact Point
- Contact Normal
- Impulse
- Gravity
- Ground Contact
- Friction / Grip
- Joint Reaction
- Recoil

原则：

> **数字决定部件有多少能力，Physics 决定这些能力能否、以及怎样被表达出来。**

同样 Build、同样初始条件：

> 结果应大体稳定、可重复。

不要通过随机命中、随机伤害、随机散布、随机攻击时机制造战斗变化。

---

# 4. 四类结构职责

## Body

负责：

> **“我以什么形状、角度和质量分布去碰别人。”**

Body 决定 Collider、Mass、COM基础、Hardpoint位置和被动碰撞几何。

Body 不负责主动攻击、独立 Direct Damage、隐藏职业能力。

普通 Body 碰撞伤害只走统一 Impact。

## Movement

V1 优先只做 Wheel。

负责：

> **“我怎样移动、支撑并把整车姿态送进碰撞。”**

轮子通过真实 Ground Contact 提供驱动，禁止直接修改 Vehicle 坐标模拟移动。

轮子离地自然失去驱动力。单轮、零轮 Build 都可以合法存在。

## Weapon

负责：

> **直接造成符合视觉认知的 HP Damage。**

玩家看到 Weapon 命中时，应天然认为“这一下应该掉血”。

Weapon 可以自然带来 Recoil、Rotation、Posture Change，但这些是物理副作用，核心反馈仍然是直接 HP 损失。

## Gadget

负责：

> **改变碰撞、距离、速度、角度、姿态、接触条件。**

Gadget 可以通过 Physics 间接造成结果，但不应该偷偷携带大额 Direct Damage。

判断标准：

> **去掉 Direct Damage 后，如果核心幻想崩溃，它更像 Weapon。**  
> **去掉 Direct Damage 后仍然能完成主要作用，它更像 Gadget。**

---

# 5. Slot / Energy / Mass

三种约束严格分工：

> **Slot 限制空间。**  
> **Energy 限制装配预算。**  
> **Mass 制造 Runtime 物理后果。**

## Slot

Body 有 Movement Hardpoint 与 Functional Hardpoint。

Movement Hardpoint 装 Wheel。

Functional Hardpoint：

> **Weapon 与 Gadget 共享。**

不要建立 Weapon Slot / Gadget Slot 两套功能孔位。

原则：

> **分类用于理解职责，槽位用于创造自由。**

## Energy

Energy 是：

> **装配预算，不是局内持续消耗资源。**

Body 提供 Energy Capacity。

如果安装 / 替换部件后会导致超载：

> **直接阻止这次穿戴，并提示“能量超载”。**

不要先允许产生非法超载 Build，再到出战时处理。

## Mass

Mass：

> **不作为禁止安装的硬门槛。**

只要 Slot / Energy 合法，极端重型 Build 也允许进入战斗。

代价通过加速、推力、COM、Recoil、Rotation、Stability 自然发生。

禁止设置 MaxWeight 超重禁装来替代物理后果。

---

# 6. Auto Battle 原则

玩家进入战斗后：

> **不进行主动操作。**

AI 不负责替玩家“聪明地打赢”。

核心原则：

> **玩家不是在给 AI 下战术指令，而是在设计一台会自己运转的机器。**

V1 Vehicle Intent 尽量简单：

> 持续尝试朝唯一敌人方向驱动。

不要因为装备远程 Weapon 就自动后退、拉距、调整射击位置。

Weapon / Gadget 按自己的机械 Behavior 自动运行。

Weapon 不自动瞄准。

攻击方向必须来自：

> Body 姿态 + Hardpoint 真实世界方向。

允许挥空、射空、时机不好、Build之间互相干扰，因为这些失败正是玩家下一轮调整的依据。

---

# 7. Damage / Force / Contact

Damage 和 Force：

> **必须保持独立。**

不要 Damage 越高就自动 Knockback 越高。

Physics Contact 是核心事实来源，统一进入 Contact Router / Resolver。

Damage 统一进入 Damage Resolver。

Renderer 不参与 Gameplay 判定。

禁止：

- 动画第 N 帧直接扣血
- Sprite 重叠算命中
- Renderer 决定 Hit

Damage Sources：

1. Direct Weapon Damage：主 HP 输出
2. Impact / Environment Damage：次级结果

普通低速持续接触不要每帧掉血。

Impact 必须按“有效撞击事件”触发，而不是持续接触每帧触发。

---

# 8. Arena 原则

V1 Arena 优先保持简单：

> **平地 + 左右普通边界。**

暂时不要加入坡道、坑、弹跳板、复杂机关、大量地图规则。

普通 Wall：

- 是物理边界
- 不持续特殊伤害
- 高速撞墙可以走 Impact
- 偏低弹性

Projectile 撞墙或越过 Bounds 后消失，不默认反弹。

## Convergence

战斗收束：

> Active → Warning → Closing → End

Closing 通过左右刺墙真实向中央移动缩小空间。

刺墙有真实 Collider 与明确 Hazard Damage，但不是一碰即死。

如果大量正常战斗最终都依赖刺墙分胜负：

> 优先检查 Weapon Damage / 接敌 / 命中 / Physics。

战斗结果：

> **只有 Win / Lose。**

不建立 Draw。

同一 Fixed Step 双方同时死亡时，随机判定一方胜利作为极低频终局兜底。

---

# 9. Quality 原则

品质：

> 白 → 绿 → 蓝 → 紫 → 橙 → 红 → 粉 → 彩

品质不是所有属性一起无脑上涨。

必须拆开：

- 数值成长
- 构筑容量成长
- 物理结构成长

同一 Part 跨品质：

> 核心 Behavior / 物理身份保持稳定。

Body 跨品质优先保持：

- 相同物理尺寸
- 相同 Collider
- 基本稳定 Mass
- 基本稳定 COM
- 相同 Movement Hardpoint

品质主要通过：

- HP
- Energy Capacity
- 少数 Functional Hardpoint Unlock

体现成长。

八个品质不需要八次玩法规则变化。

蓝品质当前主要承担：

> **首次开放 Gadget 使用资格。**

原“橙品质固定 Body 被动”当前不作为必做规则；如果未来无法找到不侵占四类职责、又无需隐藏说明的自然效果，直接删除。

---

# 10. Physics Lab 是基础设施

Physics Lab：

> **必须直接调用正式 Battle Runtime。**

禁止维护“测试场专用 Physics / Damage / Knockback”。

Physics Lab 用于：

- 快速换 Build
- Preset Scenario
- Reset
- Debug
- Slow Motion
- Runtime追查
- 批量人工验收

但真正第三层体验验收：

> **必须使用 1x 正常速度 + Debug关闭。**

Debug 正确：

> 不等于体验成立。

---

# 11. Foundation 与 Content 的开发原则

如果多个 Content 反复需要同一种底层能力：

> **先修 Foundation，再继续 Content Queue。**

例如 Contact、Damage、Projectile、Movement、Joint、Creation Entry、Test Tool 应优先成为可复用底层。

但不要因为“以后可能需要”提前建：

- 巨型 ECS
- 通用技能编辑器
- 通用规则编辑器
- 完整关卡编辑器
- 行为树系统

原则：

> **重复需求真实出现后，再向 Foundation 下沉。**

---

# 12. WorkBuddy 协作原则

WorkBuddy 负责：

- 查真实代码
- 查正式 Runtime
- 实现
- targeted tests
- tsc / build / vitest
- Commit
- 返回技术证据

WorkBuddy：

> **不负责替代真人体验判断。**

单次普通指令默认结构：

> **问题 → 目标 → 必改 → 禁止 → 验收 → 提交**

要求：

- 聚焦当前目标
- 修改点直接
- 不重复大量历史
- 不顺带扩大模块
- 不要求 WorkBuddy 提供真人录屏

---

# 13. 开发节奏

以下问题单点深入：

- P0 Bug
- 公共 Foundation
- 复杂根因
- 多模块底层迁移
- “代码完成但实际无变化”

多个彼此独立的新机制 / Content 默认允许批量队列。

推荐流程：

> **批量设计 → WorkBuddy多队列顺序开发 → Physics Lab集中验证 → 一段录像批量验收 → 只返修失败项**

已经通过的内容：

> 不重复验收。

---

# 14. 三层验收

固定使用三层验收。

## 第一层：技术正确

检查代码、状态、Tests、Build、清理、Runtime Error。

## 第二层：方案落地

检查设计要求是否真的进入正式 Runtime。

## 第三层：实际体验成立

在：

> 正常速度 + Debug关闭 + 不听解释

情况下，玩家是否能感知、理解、归因并做出预期下一步决策。

只有第三层通过：

> 才真正算设计完成。

固定原则：

> **开发完成 ≠ 体验通过 ≠ 进入正式主线。**

---

# 15. “代码完成但实际没变化”的处理

如果 WorkBuddy 报告完成，但真人体验没有明显变化：

> **不要继续表面调参数。**

必须沿真实 Runtime 追：

> **输入 → 正式逻辑 → 状态 / 数据 → Renderer / Collision / Result → 玩家实际看到的结果**

重点判断：

1. Runtime 根本没有真正生效；
2. 还是设计假设本身错误。

连续 2～3 轮仍无法达到目标：

> 停止 10% 级微调，重新判断方向。

---

# 16. 必须主动防止的方案漂移

如果后续需求出现以下趋势，应主动提醒，而不是默认继续实现：

- 复杂职业 AI
- 自动瞄准
- 自动拉距
- 大量隐藏 Buff
- Body 免费攻击
- Weapon / Gadget 独立槽导致固定模板
- 高品质所有维度同时碾压
- 复杂地图机关成为胜负主体
- 用 MaxWeight 等硬限制替代自然物理代价
- 用动画保证命中
- Gadget 偷偷承担大额 Direct Damage
- 为了“看起来丰富”增加大量例外规则
- 稳定最优 Build 长期通吃但继续只加 Content
- Debug成立但玩家正常速度完全感知不到

发现漂移时：

> **优先回到最简单、最自然、最可归因的规则。**

---

# 17. 当前工程优先级

项目底层优先级：

> **Physics Foundation → Build Assembly → Battle Runtime → Physics Lab → 独立 Content Queue**

未经 Foundation 验证：

> 不批量扩大量正式 Content。

Foundation 稳定后：

> 独立 Weapon / Gadget / Body / Wheel 默认可批量进入 WorkBuddy 队列开发。

---

# 18. 指令优先级

当信息发生冲突时：

1. **最新明确的单次 WorkBuddy 执行指令**
2. **本文的稳定项目边界**
3. 历史设计草稿 / 旧方案

如果最新任务与本文核心定位存在明显冲突：

> **不要自行默默实现冲突方案。**

请明确指出：

- 冲突点
- 可能造成的体验 / 架构后果
- 最小建议修正

---

# 19. 一句话总纲

> **我们不是在设计一套规则很多的自动战斗游戏，而是在用少量稳定、可见、可理解的物理规则，让玩家通过一次次 Build 实验自然产生策略。**
