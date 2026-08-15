# 《最强水果》WorkBuddy执行指令 01
## Physics Foundation / Battle Runtime / Physics Lab

**版本**：V1.0  
**用途**：项目第一阶段底层框架搭建  
**执行对象**：WorkBuddy  
**当前阶段定位**：先打牢 Physics Foundation，不扩正式 Content  
**验收口径**：技术正确 → 方案落地 → 实际体验成立  
> 本任务完成仅代表前两层；第三层体验由后续真人录屏验收。

---

# 一、问题

当前项目即将正式进入开发。

这个游戏的核心不是堆 Weapon 内容，而是：

> **玩家事前组装机器 → 统一二维物理自动战斗 → 玩家从真实碰撞、轨迹、姿态和伤害结果中理解 Build 问题 → 修改下一局配置。**

因此第一阶段不能先批量做水果、武器和玩法内容，必须先建立可靠的：

- Physics Foundation
- Build Assembly
- Battle Runtime
- Physics Lab

执行前请先完整检查：

- 现有仓库结构
- 技术栈
- 已有 Physics 方案
- Renderer 结构
- 测试框架
- 当前正式 Runtime 入口

不要假设已有接口。

如果项目已有合适的 2D Physics 方案，优先复用。

如果项目完全没有 Physics 方案：

- 不要手写 Physics Solver；
- 选择与当前技术栈兼容的成熟 2D 刚体方案；
- 封装 Physics Adapter；
- 不要顺手迁移技术栈。

---

# 二、目标

建立第一版可扩展物理战斗骨架，使以下因果真正成立：

> **质量 / 重心 / 转动惯量 + Collider + 接触点 + 支撑 + 轮子驱动 → 位移 / 旋转 / 碰撞 / Impact → Combat Event**

第一阶段只证明四件事：

1. 不同装配真的产生不同物理结果；
2. 同一套 Runtime 可以被正式战斗和 Physics Lab 共同调用；
3. 后续新增 Body / Movement / Weapon / Gadget 不需要不断修改 Battle 核心；
4. 出现异常时，可以沿真实 Runtime 快速定位，而不是继续盲调参数。

---

# 三、核心设计边界

## 3.1 四类结构

完整版固定四类：

- **Body**：决定以怎样的轮廓、角度、方向发生被动碰撞；
- **Movement**：决定怎样驱动、支撑和改变整车姿态；
- **Weapon**：主要职责是造成符合视觉认知的直接伤害；
- **Gadget**：主要职责是改变碰撞、速度、距离、姿态和战斗条件。

当前第一阶段：

> **只搭 Foundation 与通用接口，不批量实现正式 Weapon / Gadget Content。**

## 3.2 二维物理

整个战斗固定：

> **2D 侧视：X / Y 平移 + 屏幕平面 Z 轴旋转。**

禁止：

- 3D Roll
- 3D Yaw
- 出屏旋转
- 为表现偷偷加入 3D 自由度

## 3.3 物理原则

优先使用统一自然因果：

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
- Wheel Drive
- Joint Reaction

不要用以下隐藏状态替代真实物理：

- Airborne
- Flipped
- Knockdown
- “攻击资格”
- “翻倒免疫”
- “离地减速状态”

---

# 四、必改

## 4.1 建立统一 Build / Vehicle Assembly 基础

建立最小的数据结构与 Runtime 装配链。

### 4.1.1 Body Definition

至少能够描述：

- 简单非矩形 Collider 组合；
- Base Mass；
- HP；
- Energy Capacity；
- 2 个及以上 Movement Hardpoint；
- 若干通用 Functional Hardpoint；
- Hardpoint 的真实 Local Position；
- Hardpoint 的真实 Local Rotation。

Body 不要拥有：

- BodyContactDamage；
- 职业 Buff；
- 主动技能；
- 隐藏翻倒抗性；
- 隐藏 Weapon 兼容属性。

Body 的碰撞结果只通过：

> 几何 + 质量 + 质量分布 + 统一 Impact 体系

自然产生。

### 4.1.2 Movement Definition

V1 首阶段只支持：

> **Wheel**

最小参数：

- Radius
- Mass
- Drive Torque / Drive Force
- Max RPM
- Grip

Movement Hardpoint 为底部专用挂点。

### 4.1.3 Functional Part

Weapon 与 Gadget：

- 内容类别保持独立；
- 共享 **Functional Hardpoint**；
- 不建立 Weapon Slot / Gadget Slot 两套孔位。

每件功能部件：

> 占用 1 个 Functional Hardpoint。

第一阶段无需批量实现正式 Weapon / Gadget。

只需确保后续 Behavior 接口能合理接入。

### 4.1.4 Build Snapshot

Battle Runtime 输入必须是：

> 已经装配好的 Build Snapshot。

Battle Runtime 不直接依赖：

- Inventory
- Matchmaking
- Rank
- Season
- Shop
- Merge
- Chest
- Progression

Build Snapshot 至少描述：

- Body
- Movement 安装情况
- Functional Hardpoint 安装情况
- Quality
- 当前有效数值

同一 Snapshot 应可同时供：

- 正式 Battle
- Physics Lab
- Preset AI Build
- 未来异步玩家 Build

复用。

### 4.1.5 Build Validator

建立最小 BuildValidator。

至少校验：

- 槽位存在；
- 类型合法；
- Energy 合法；
- 至少 1 件 Weapon。

#### Energy 超载规则

不要允许超载 Build 先产生。

当玩家安装 / 替换某个部件后，若最终 Energy 超出 Body Capacity：

> **直接拒绝本次安装操作。**

并提示：

> **“能量超载”**

Build 始终保持合法状态。

替换时必须计算：

> 当前 Energy - 被替换部件 Energy + 新部件 Energy

禁止因为先加后减导致错误拒绝。

---

# 五、Physics Foundation

## 5.1 Vehicle Assembly 必须是真实物理装配

Vehicle 不应只是：

> 一个矩形刚体 + 若干无质量 Sprite。

必须支持真实 Assembly：

- Body 主刚体；
- Wheel 物理件；
- Fixed Mount 部件；
- Jointed Part；
- Projectile 等临时实体。

整车必须能够得到：

- Total Mass
- Center of Mass
- Moment of Inertia

固定安装部件的：

> Mass + Local Position

必须真实影响整车质量分布。

禁止仅仅：

> 把所有部件质量加到一个总 Mass 数字上，但挂点位置完全不影响 COM / Inertia。

具体实现可根据现有 Physics Engine 选择：

- compound fixture
- welded body
- joint assembly
- 其他合理方式

但最终体验必须成立。

## 5.2 必须真实支持的物理能力

至少支持：

- Mass
- COM
- Moment of Inertia
- Linear Velocity
- Angular Velocity
- Gravity
- Collider Contact
- Contact Point
- Contact Normal
- Impulse
- Ground Contact
- Friction / Grip
- Fixed Physics Timestep

---

# 六、Movement Foundation

## 6.1 轮子必须真实驱动

禁止：

```ts
vehicle.x += speed * dt
```

之类直接修改 Vehicle 坐标的假移动。

Wheel 必须通过：

> **地面接触 + Motor / Drive + Grip**

提供真实牵引。

## 6.2 必须满足

- 只有实际接地的 Wheel 提供驱动；
- 前轮离地时，前轮不贡献牵引；
- 全轮腾空时，不产生凭空水平驱动力；
- 单轮 Build 合法；
- 零轮 Build 合法；
- Body 拖地会真实产生摩擦；
- 推不动目标 / 顶墙时允许 Wheel 打滑；
- 不允许通过固定 Speed 强制把对手位移；
- 前后不同 Radius 必须真实改变 Body 倾角；
- Body 倾角进一步真实改变 Functional Hardpoint 的世界方向。

不要增加：

- Airborne 状态
- Flipped 状态
- Knockdown 状态

来模拟这些结果。

---

# 七、Contact → Impact / Damage → Combat Event

## 7.1 Contact 统一入口

Physics Contact 必须进入一个清晰统一入口，例如：

> Contact Router / Contact Resolver

至少能够取得：

- Owner
- Part
- Contact Point
- Contact Normal
- Relative Velocity

不要让每个 Content 自己重新找敌人和判断接触。

## 7.2 Impact Event

建立统一 Impact Event。

必须满足：

### 低速持续挤压

> 不掉血。

### 达到 Impact Threshold

> 才产生有限 Impact Damage。

### 持续贴合

> 不得每个 Physics Frame 重复扣血。

### 再次形成新撞击

必须经过：

> 明显分离 → 再次高速接触

才形成新的 Impact Event。

Impact Damage：

> 只作为次级伤害来源。

## 7.3 Direct Weapon Damage

本阶段只建立接口，不批量实现正式 Weapon。

原则：

> Weapon Damage 只能来自真实攻击轨迹 / Collider / Projectile 的真实有效接触。

禁止：

- 动画播放到某时间点直接伤害；
- Sprite 重叠直接 Hit；
- 自动保证命中。

Damage 与 Force 保持独立。

禁止：

> Damage 数值直接映射 Knockback。

## 7.4 Combat Event

Runtime 应建立统一 Combat Event 结构，至少能够承载后续所需的：

- Source
- Target
- DamageSource
- Weapon / Part 信息
- ContactPoint
- ContactNormal
- RelativeVelocity
- FinalDamage
- Impulse
- HP Before / After

不要求字段名完全一致，但概念必须存在。

Renderer 只能消费 Runtime 结果。

---

# 八、Collision / Owner / Layer

必须有明确 Owner / Collision 过滤能力。

至少区分：

- Ground
- Arena
- Vehicle A
- Vehicle B
- Projectile

同一 Vehicle 内：

> 默认关闭普通 Collider 互撞。

避免：

- Wheel 撞自己 Body；
- Weapon 自己卡 Body；
- Projectile 出生先打自己；
- Gadget 自己推自己。

但是：

> Joint / Recoil / Motor 等真实 Reaction 必须保留。

即：

> **忽略同车普通 Collision ≠ 忽略同车物理反作用。**

---

# 九、Arena 最小骨架

本轮 Arena 只需要：

- 平坦真实 Ground Collider；
- 左右普通低弹性 Wall；
- Projectile Bounds 接口；
- Battle Phase：

> Active → Warning → Closing → End

阶段时长全部配置化。

## 9.1 普通 Wall

普通左右墙：

- 无持续特殊 Damage；
- 低速接触不伤害；
- 高速撞墙只走统一 Impact；
- Wall 偏低弹性、吸收型。

不要让车辆像弹珠一样频繁反弹。

## 9.2 Projectile

Projectile：

- 撞左右 Wall → 命中特效 → 吸收 / 销毁；
- 越过顶部 Projectile Bounds → 销毁；
- 默认不反弹。

## 9.3 Closing

Closing 刺墙本轮只需要：

- Runtime 状态骨架；
- 配置接口；
- 基本 Collider / Hazard 接口。

不要求本轮精调：

- 视觉
- 推进速度
- Damage
- 节奏

禁止顺手增加：

- 坡道
- 地坑
- 弹跳板
- 复杂场地机关

---

# 十、Physics Lab 必做

Physics Lab 必须：

> **直接调用正式 Battle Runtime。**

禁止维护第二套 Physics / Damage / Movement 实现。

## 10.1 最小操作

至少支持：

- 左侧 Build 选择
- 右侧 Build 选择
- Start
- Pause
- Reset
- Clear

支持快速切换：

- Body
- Front Wheel
- Rear Wheel
- Functional Part

不要要求走正式：

> 仓库 → 合成 → 匹配 → 战斗

流程。

## 10.2 Preset Build

支持保存 / 加载固定 Build Preset。

例如：

- LightVehicle
- HeavyVehicle
- FrontHeavy
- RearHeavy
- NoseDown
- NoseUp

后续正式 P0 Scenario 需要可复用这些 Preset。

---

# 十一、Physics Lab 固定 Scenario

本阶段至少建立以下 5 个固定 Scenario。

## Scenario A｜Light vs Heavy

条件：

> 接近同速度正面碰撞。

验收：

- Heavy Vehicle 位移明显更小；
- Light Vehicle 位移 / 反弹明显更大；
- 不能只是视觉差异；
- Debug 中 Mass / COM / Velocity 能对应解释。

## Scenario B｜Off-center Collision

条件：

> 相近质量，改变接触高度 / 位置。

验收：

- 接近 COM 的碰撞以平移为主；
- 明显偏心碰撞产生明显 Z 轴 Angular Velocity；
- 接触点不同必须真正改变旋转结果。

## Scenario C｜Wheel Radius / Body Angle

同一 Body：

> 前小后大  
> vs  
> 前大后小

验收：

- Body 世界倾角明显不同；
- Body Collider 同步改变；
- Functional Hardpoint 世界方向同步改变；
- 不是只改 Sprite。

## Scenario D｜Grounded Drive

能够快速制造：

- 双轮接地；
- 单轮接地；
- 全轮腾空。

验收：

- 双轮正常驱动；
- 单轮仅接地轮提供驱动；
- 全轮腾空无凭空牵引；
- 落地后自然恢复驱动。

## Scenario E｜Mass Distribution

同一 Body：

> 在前 / 后不同位置增加相同测试质量。

要求：

- Total Mass 相同；
- COM 明显前移 / 后移；
- Inertia / 碰撞旋转结果出现对应差异。

用于证明：

> 部件位置真的参与物理，而不是只有总重量。

---

# 十二、Debug 能力

Physics Lab 至少支持开关显示：

- Collider
- COM
- Movement Hardpoint
- Functional Hardpoint
- Grounded Wheel
- Linear Velocity
- Angular Velocity
- Contact Point
- Contact Normal
- Impulse
- Total Mass
- Moment of Inertia
- 最近 Impact Event
- 最近 Damage Event

## 12.1 时间控制

至少支持：

- 1x
- 0.5x
- 0.25x

如实现成本合理：

> 增加单 Fixed Step 推进。

但必须明确：

> Debug / Slow Motion 只用于找原因。

最终体验验收必须回到：

> **1x正常速度 + Debug关闭。**

## 12.2 Debug Override

允许研发临时 Override：

- Mass
- Drive Force / Torque
- Impact Threshold
- Friction / Grip
- 其他少量 Foundation 参数

用于：

> 先夸张差异验证方向。

但：

> Override 必须和正式 Content Config 隔离。

禁止让 Debug 参数进入正式游戏数据。

---

# 十三、Damage / Runtime 追查链

出现：

> “代码完成但玩家看不到变化”

时，必须能够沿真实 Runtime 追查：

> **Contact → Behavior → Damage / Impulse → HP / State → Renderer / FX → 玩家实际看到**

例如：

### 锤看起来撞到了但没 Damage

依次检查：

1. Collider 是否产生 Contact；
2. Contact Router 是否识别正确 Owner / Part；
3. Weapon Behavior 是否形成有效 Hit；
4. Damage Resolver 是否生成 Damage；
5. HP 是否实际变化；
6. Combat Event 是否发出；
7. Renderer / FX 是否消费。

禁止直接：

> 再调 Damage 数字 / 特效大小

掩盖底层未生效问题。

---

# 十四、确定性与稳定性

同一 Scenario：

> 同 Build + 同初始位置 + 同配置

必须尽量获得大体一致结果。

至少做到：

- Fixed Physics Timestep；
- 固定初始 Transform；
- 固定 Part 初始 Phase；
- 不加入随机攻击 Offset；
- 不加入随机散布；
- 不加入随机 Physics Noise。

如果同一 Scenario：

> 一次能铲起，一次完全不能铲起；

且初始条件没有变化，

必须作为：

> Physics 稳定性问题

处理。

禁止用“随机性”解释。

---

# 十五、模块边界

第一阶段建议保持如下职责：

```text
Build Validator
      │
Build Snapshot
      │
      ▼
Battle Runtime
├── Battle Orchestrator
├── Vehicle Assembly
│   ├── Body
│   ├── Movement
│   └── Functional Parts
├── Part Behaviors
├── Physics / Contact Router
├── Damage Resolver
└── Arena Runtime
      │
Combat Events
      │
├── Renderer
└── Physics Lab
```

## 15.1 Battle Orchestrator

只负责：

- 初始化左右 Build；
- Battle生命周期；
- Countdown；
- Active；
- Warning；
- Closing；
- HP死亡检测；
- Result。

不控制：

- 开炮；
- 挥锤；
- Gadget动作；
- 车辆职业AI。

## 15.2 Arena Runtime

只负责：

- Ground
- Wall
- Bounds
- Phase
- Closing
- Hazard

不要读取：

- 车上装什么 Weapon；
- Build职业；
- Gadget类型。

## 15.3 Renderer

只负责读取：

- Physics Transform
- Part State
- Combat Event

表现：

- Sprite位置
- FX
- Hit反馈
- Damage数字
- 屏震
- 音效事件

禁止 Renderer 决定 Gameplay。

---

# 十六、Foundation 首版安装 / Behavior 能力

框架层优先只支持少量通用能力：

### Fixed Mount
用于未来：

- Cannon
- Spear
- Ram Head
- Rebound Device

### Revolute Joint
用于未来：

- Wheel
- Hammer
- Circular Saw
- Lift Roller

### Linear / Prismatic Joint
用于未来：

- Push Rod

### Emitter / Spawn
用于未来：

- Projectile
- Laser Shot

不要提前实现：

- Rope
- Chain
- Grab Lock
- Multi-joint Arm
- 通用技能编辑器

---

# 十七、明确禁止

本轮禁止顺带实现：

- 正式水果内容；
- 大量 Weapon；
- 大量 Gadget；
- Inventory；
- Matchmaking；
- Rank；
- Season；
- Battle Pass；
- Merge；
- Chest；
- Shop；
- 正式新手流程；
- 正式美术精修；
- 复杂AI；
- 远程自动拉距；
- Weapon自动瞄准；
- Gadget独立槽；
- Body自带Direct Damage；
- 玩家自由拖拽Weapon；
- 玩家手调Weapon角度；
- MaxWeight禁装；
- 综合Power限制；
- Damage随机浮动；
- 暴击；
- 闪避；
- 伤害类型抗性；
- 复杂3D Physics；
- 复杂 ECS 重构；
- 通用规则编辑器；
- 通用关卡编辑器。

如果实现过程中发现：

> 必须增加以上能力才能让Foundation成立，

先停止扩展并说明：

- 当前真实阻塞是什么；
- 为什么已有Foundation无法解决；
- 最小新增能力是什么。

不要自行扩大系统。

---

# 十八、技术验收

完成后必须至少证明以下内容。

## 18.1 Assembly

部件：

> Mass + Position

真实影响：

- Total Mass；
- COM；
- Inertia。

不是视觉附件。

## 18.2 Movement

证明：

- Grounded Wheel 才提供驱动；
- 腾空停止牵引；
- 不同Radius真实改变Body角度；
- Hardpoint方向随Body真实改变；
- 单轮 / 零轮合法；
- 推不动时Wheel可以打滑。

## 18.3 Collision

证明：

- Light vs Heavy结果明显不同；
- 正中 vs 偏心碰撞结果不同；
- 偏心力能够产生真实Angular Velocity；
- 结果大体稳定可复现。

## 18.4 Impact

证明：

- 低速贴合不持续扣血；
- 高速新接触产生一次 Impact Event；
- 持续 Contact 不每帧重复伤害；
- 分离后再次撞击可重新触发。

## 18.5 Physics Lab

证明：

> 五个 Scenario 全部使用正式 Runtime。

禁止使用：

- Scenario 专属 Knockback；
- Scenario 专属 Velocity；
- Scenario 专属 Fake Damage；
- Scenario 专属 Flip。

## 18.6 Targeted Tests

至少覆盖：

1. Build Energy 安装 / 替换校验；
2. Mass / COM 聚合；
3. Grounded Wheel 驱动；
4. Collision Owner过滤；
5. Impact重复触发保护；
6. 如架构允许，增加确定性 Scenario 基础检查。

## 18.7 工程检查

执行当前项目对应的：

- TypeScript / tsc；
- build；
- vitest / targeted tests；
- lint（若项目已有且属于标准流程）。

要求：

> 全部通过，无新增明显 Runtime Error。

---

# 十九、提交

只提交本任务相关修改。

不要顺带重构无关模块。

建议 Commit：

```text
feat: establish physics foundation and battle lab
```

完成后返回：

1. Commit Hash；
2. 主要新增 / 修改模块；
3. Physics Engine / Adapter选择及原因（若本轮新引入）；
4. 五个 Scenario 当前实际结果；
5. targeted tests结果；
6. build / tsc / vitest结果；
7. 已知Foundation风险；
8. 暂未解决项；
9. 是否存在任何为了过测试而加入的临时逻辑，如有必须明确列出。

---

# 二十、验收分层

## 第一层：技术正确

由WorkBuddy负责证明：

- Runtime正常；
- tests正常；
- build正常；
- 状态清理正常；
- 无明显技术错误。

## 第二层：方案落地

确认当前方案真的实现：

- 真实Mass / COM / Inertia；
- 真实Grounded Drive；
- 真实Collider Contact；
- 真实偏心Impulse；
- 统一Impact Event；
- Lab共用正式Runtime。

## 第三层：实际体验成立

**不由WorkBuddy判定。**

后续由真人在：

> **1x正常速度 + Debug关闭**

状态下录屏验收：

- 轻重差异是否肉眼明显；
- 碰撞是否自然；
- 偏心撞击是否容易理解；
- 轮径变化是否真实改变姿态；
- 单轮 / 腾空表现是否自然；
- 同一测试重复结果是否稳定。

只有第三层通过：

> Physics Foundation 才真正视为完成。

---

# 二十一、当前阶段核心提醒

这不是一个“尽量真实的物理模拟器”。

真正目标是：

> **用少量、统一、稳定的二维物理规则，产生丰富但可理解的战斗结果。**

始终优先：

> **存在 → 可感知 → 可理解 → 可决策**

最终必须回答：

> **这些Physics差异有没有让玩家想改变下一次Build？**

如果一个底层机制：

- 技术上存在；
- Debug能看到；
- 但正常速度下玩家感知不到；

则仍视为：

> **体验未成立。**

如果连续2～3轮调参仍无法让差异成立：

> 停止微调。

优先检查：

1. Runtime是否真的生效；
2. 当前设计假设是否本身错误。

---

# 二十二、当前第一阶段完成定义

第一阶段完成不等于：

> 项目完成。

只代表：

> **我们拥有了一套值得继续往上搭Content的Physics Foundation。**

在这一阶段通过前：

> 不批量进入正式水果、Weapon、Gadget Content开发。
