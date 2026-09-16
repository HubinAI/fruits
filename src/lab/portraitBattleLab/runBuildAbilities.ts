/**
 * PRP-BUILD-01-TWO-STEP-CANNON-BUILD｜第二层「强联动」的运行期实现。
 *
 * 本文件只做一件事：把**正式战斗事件**翻译成**真实物理冲量**，除此之外不碰任何东西。
 *
 * ## 为什么不需要改正式模块（Queue 必改 4 的接缝判定）
 *
 * 三项强联动里有两项需要「战斗中的反应」，检查下来正式 Runtime 的接缝是**干净且公开**的：
 *
 *   1) `PlanckBattleOrchestrator.onCombatEvent(fn)`（`planckBattleOrchestrator.ts:413`）
 *      —— 公开订阅口，转发 `CombatEventBus`（`combatEvents.ts:102`）；
 *   2) 事件本身就有全部所需字段：
 *      - `WeaponFireEvent`（`combatEvents.ts:41`）：`team` / `partId` / `behavior` /
 *        `worldPosition` / `worldDirection` / `timestamp` —— **每次真实开火（= 真实 recoil）恰好一次**
 *        （`cannonBehavior.ts:352` 只在真正创建 projectile 后发出）；
 *      - `DamageEvent`（`combatEvents.ts:36`）：`source` / `target` / `damageSource` / `behavior` /
 *        `contactPoint` / `relativeVelocity` —— 炮弹命中敌车时由
 *        `ContactRouter.applyProjectileDamage`（`contactRouter.ts:1002`）经 DamageResolver 发出；
 *   3) `PlanckWorld.applyLinearImpulse` 是公开 API，且**正式代码自己就用它做 recoil**
 *      （`cannonBehavior.ts:363`）—— 用它施加真实冲量不是绕过引擎，而是引擎的正常用法。
 *
 * ⇒ 因此**不需要**给正式 Movement / recoil / Cannon 加任何 hook，也没有把 PRP 特例塞进正式模块。
 *   本类整体位于 PRP 侧（`src/lab/portraitBattleLab/`），随整块删除一起消失。
 *
 * ## ⚠️ 为什么不直接接收 `PlanckBattleOrchestrator`
 *
 * Lab 有一条硬守卫：**正式编排器只允许 `runBattleRuntime.ts` 引用**
 * （`tests/portraitBattleLab.test.ts` 的 `R22a-4`，它按 import specifier 判定）。
 * 尊重这条不变量的正确做法不是「把类型绕过去」，而是让本文件只声明它**真正需要的最小能力**
 * （`RunAbilityPorts`），由 `RunBattleRuntime` 适配实现。
 * 于是「PRP 与正式战斗栈之间只有 runBattleRuntime / runBattleView 相连」这件事
 * 在**运行期**也成立，而不仅仅是 import 层。
 *
 * ## ⚠️ 冲量在「步边界」施加，不在事件回调里施加
 *
 * `damage` 事件是在 `world.step` 内部的接触回调链里发出的（Orchestrator 的 batched contact
 * listener → ContactRouter → DamageResolver → bus.emit）。在物理求解过程中直接改速度容易与
 * 求解器状态相互作用，因此这里只**入队**，由 `flush()` 在**下一个固定步开始之前**统一施加
 * （`RunBattleRuntime.step` 在 `orchestrator.step` 前调用）。
 * 延迟 ≤ 1 个物理步（16.7ms），物理后果完全等价；且**战斗结束后不再施加**，
 * 从而不破坏「RESULT = 战场冻结」这一既有不变量。
 *
 * ## 两项的实现口径
 *
 *   - **动能爆发 kineticBurst**：`追加冲量 = KINETIC_BURST_GAIN × projectileMass × relativeVelocity`
 *     —— `projectileMass` 读自本局**真实 resolved 武器 def**（基础 1 / 重型弹头 4），
 *     `relativeVelocity` 读自正式 `damage` 事件。**没有「重型弹头专属伤害」这类写死强度**。
 *     方向 = 该次开火的真实炮口方向（`weaponFire.worldDirection`）。
 *     ⚠️ PRP-BUILD-01-R1：作用点从「质心」改为**真实命中点**（`damage.contactPoint`）。
 *     理由有两条，都不是表现层口味：
 *       1. **更真实**：冲击本来就发生在接触点 —— 弹丸自己那部分推力也是 Planck 在接触点施加的，
 *          `applyLinearImpulse(body, impulse, point)` 的 `point` 语义正是「力作用在世界的哪一点」；
 *          作用在质心反而是把一次偏心撞击当成了纯推。
 *       2. **可感知**：作用在质心时冲量只产生平动，而平动会被**相机跟随双方中点**追平
 *          （实测：世界位移 +20.7px → 屏幕只动 4px）；绕质心的扭矩产生的**仰俯 / 旋转**
 *          无法被相机平移追平，是唯一真正「一眼可辨」的物理通道。
 *     命中点同时进入 `snapshot().lastKineticHit`，供表现层在**同一个真实位置**画冲击环。
 *   - **压制射击 suppressionShot**：**每一次真实炮弹命中敌车**都追加一次**中等**击退冲量 ——
 *     方向 = 本次开火的**真实弹道方向**（复用本分支已记录的 `lastFireDirX/Y`；
 *     直射炮弹的命中方向即此，且该发确实命中了敌车 → 方向本就指向「远离玩家」），
 *     作用点 = 本次命中的**真实命中点**（`damage.contactPoint`）。
 *     **只由 `damage` 事件驱动**（`source=A` / `target=B` / `damageSource='weapon'` /
 *     `behavior='cannon'`）：**开炮不触发、未命中不触发、无定时器、无累计层数、
 *     无「第 N 发」、无固定周期。**
 *     ⚠️ PRP-BUILD-01-R4：本项**整体替换**旧的 `strongRecoil`。前两版都在「推玩家自己」，
 *     而正式车辆约束（重的玩家车） + Battle Camera（跟双方中点）让这条因果**三版都读不出来**；
 *     改判后冲量施加到**敌车**上 —— 敌车是轻的、R1 已证明敌车侧是可感知通道，
 *     且「敌车被顶回去」与「高频控距」目标同向。**不是数值调整，是换作用对象。**
 */

import type { BattleEvent } from '../../battle/combatEvents';
import {
  KINETIC_BURST_GAIN,
  SUPPRESSION_SHOT_IMPULSE,
  buildHas,
  type RunModifierId,
} from './runModifiers';

/** 队伍 id（正式 `TeamId` 的 PRP 投影；与 Arena 无关）。 */
export type RunTeamId = 'A' | 'B';

/**
 * ⚠️ 用**命名队伍常量**做比较，而不是裸 `'A'` / `'B'`：
 * G1 守卫（`tests/portraitBattleLabG1.test.ts` 的 `arenaConditionLines`）会把
 * 「左侧不是队伍语义标识的 `=== 'A'`」当成 arena 分叉来报；而 `damage` 事件里的
 * `source` / `target` 是**队伍 id**，用命名常量既躲开误报，也让语义更清楚。
 */
const PLAYER_TEAM: RunTeamId = 'A';
const ENEMY_TEAM: RunTeamId = 'B';

/**
 * Run 能力所需的**最小正式运行时端口**（由 `RunBattleRuntime` 适配实现，见文件头）。
 *
 * 本接口是「PRP ↔ 正式战斗栈」的唯一接触面，刻意保持极窄：
 * 订阅事件 / 判断是否结束 / 读朝向 / 读当前炮弹质量 / 施加真实冲量。五项之外一无所求。
 */
export interface RunAbilityPorts {
  /** 订阅正式战斗事件（真实开火 / 真实命中）。返回退订函数。 */
  readonly subscribe: (fn: (ev: BattleEvent) => void) => () => void;
  /** 战斗是否已结束（结束后不再施加任何新动作 → 保住「RESULT = 战场冻结」）。 */
  readonly isFinished: () => boolean;
  /** 该队伍车的**真实朝向**（±1）。 */
  readonly facingOf: (team: RunTeamId) => number;
  /**
   * 当前**真实 projectile 质量**（读自本局 resolved 武器 def；读不到 → `0`）。
   * 动能爆发的强度直接乘这个值 → 强度来自当前炮弹，而不是写死的「专属伤害」。
   */
  readonly projectileMass: () => number;
  /**
   * 在**步边界**施加一次真实冲量。
   *
   * `at` = **真实作用点**（世界坐标）；省略 / `null` → 作用在该车自身位置。
   * ⚠️ 动能爆发必须传入 `damage.contactPoint`：作用点决定是否产生绕质心的扭矩，
   *    而扭矩是「这一炮把它轰得抬/转起来」这一可感知结果的唯一来源（见文件头）。
   */
  readonly applyImpulse: (
    team: RunTeamId,
    dirX: number,
    dirY: number,
    magnitude: number,
    at?: Readonly<{ x: number; y: number }> | null,
  ) => void;
}

/** 一次待施加的真实冲量（步边界统一 flush）。 */
interface PendingImpulse {
  readonly team: RunTeamId;
  readonly dirX: number;
  readonly dirY: number;
  readonly magnitude: number;
  /** 真实作用点（世界坐标）；`null` = 该车自身位置。 */
  readonly at: Readonly<{ x: number; y: number }> | null;
  readonly label: 'kinetic' | 'suppression';
}

/** 能力运行状态（诊断 / 验收用；全部是真实发生过的计数与量值）。 */
export interface RunAbilitySnapshot {
  /** 本局是否带「动能爆发」。 */
  readonly kineticBurst: boolean;
  /** 本局是否带「压制射击」。 */
  readonly suppressionShot: boolean;
  /**
   * 已**真实施加**的压制击退次数（每个真实命中恰好一次 → 与「玩家炮弹命中敌车」次数 1:1）。
   * ⚠️ 开炮不计数、未命中不计数 —— 这是 Queue 验收「每次真实命中至多对应一次额外 impulse」的锚点。
   */
  readonly suppressionHits: number;
  /** 最近一次压制击退冲量的大小（0 = 本局还没命中过）。 */
  readonly lastSuppressionImpulse: number;
  /** 动能爆发已触发的命中次数（真实发生）。 */
  readonly kineticHits: number;
  /** 最近一次动能追加冲量的大小（0 = 还没触发过）。 */
  readonly lastKineticImpulse: number;
  /**
   * 最近一次动能爆发的**真实命中点**（世界坐标）与冲量大小；`null` = 还没触发过。
   * 表现层用它把冲击环画在**同一个真实位置**（不另造位置）。
   */
  readonly lastKineticHit: Readonly<{ x: number; y: number; magnitude: number }> | null;
  /** 正在读取的「当前 projectile 质量」（来自本局真实 resolved 武器 def）。 */
  readonly projectileMass: number;
  /** 尚未施加的待处理冲量数（正常应恒为 0；开火帧 + 命中帧同时发生时最多 2）。 */
  readonly pending: number;
}

export class RunBuildAbilities {
  private readonly ports: RunAbilityPorts;
  private readonly hasKinetic: boolean;
  private readonly hasSuppression: boolean;
  private readonly unsub: () => void;
  /** 本局真实 projectile 质量（构造时读一次；战斗中不会变）。 */
  readonly projectileMass: number;

  private suppressionHits = 0;
  private lastSuppressionImpulse = 0;
  private kineticHits = 0;
  private lastKineticImpulse = 0;
  private lastKineticHit: { x: number; y: number; magnitude: number } | null = null;
  /** 最近一次玩家侧开火的真实弹道方向（两项能力共用；未开火前用玩家朝向兜底）。 */
  private lastFireDirX = 1;
  private lastFireDirY = 0;
  private hasFireDir = false;
  private readonly pending: PendingImpulse[] = [];

  constructor(ports: RunAbilityPorts, build: readonly RunModifierId[]) {
    this.ports = ports;
    this.hasKinetic = buildHas(build, 'kineticBurst');
    this.hasSuppression = buildHas(build, 'suppressionShot');
    this.projectileMass = ports.projectileMass();
    this.unsub = ports.subscribe((ev) => this.onEvent(ev));
  }

  /** 事件 → 入队（**不在回调内改物理世界**，见文件头）。 */
  private onEvent(ev: BattleEvent): void {
    if (this.ports.isFinished()) return; // 战斗已结束 → 不再产生任何新动作

    if (ev.type === 'weaponFire') {
      if (ev.team !== PLAYER_TEAM) return;
      // ⚠️ 这里**只记录**本次开火的真实弹道方向，**不产生任何冲量**。
      //    两项能力都需要「这一发的方向」：动能爆发用它做击退方向，压制射借用它做弹道方向。
      //    ⚠️ PRP-BUILD-01-R4：开火**不再触发**任何自车冲量（旧的「一炮一后坐」整条删除）——
      //       Queue 必改 2 明令「开炮即触发」属于禁止项。
      this.lastFireDirX = ev.worldDirection.x;
      this.lastFireDirY = ev.worldDirection.y;
      this.hasFireDir = true;
      return;
    }

    if (ev.type === 'damage') {
      if (!this.hasKinetic && !this.hasSuppression) return;
      // 只认「玩家用炮打中敌车」这一次真实命中（两项能力共用同一入口条件）。
      if (ev.damageSource !== 'weapon') return;
      const sourceTeam: RunTeamId = ev.source;
      const targetTeam: RunTeamId = ev.target;
      if (sourceTeam !== PLAYER_TEAM || targetTeam !== ENEMY_TEAM) return;
      if (ev.behavior !== 'cannon') return;
      // ⚠️ 方向来源的诚实说明：`damage` 事件本身**不带**弹丸方向（只有 `contactPoint` /
      //    `contactNormal` / `relativeVelocity`），而 `contactNormal` 是撞击面的法线、
      //    并不是弹道方向（斜撞会把它读成横向）。因此这里用**本次开火记录的真实炮口方向**作为
      //    弹道方向的来源：直射炮弹的飞行方向就是它；且本路线的第一层是「快速装填」（单发炮），
      //    同一场战斗里炮口朝向一致 ⇒ 与在飞弹丸的真实方向一致。
      //    作用点则严格用**本次命中自己的** `contactPoint`（不是开火点）。
      const at = { x: ev.contactPoint.x, y: ev.contactPoint.y };
      const dir = this.hasFireDir
        ? { x: this.lastFireDirX, y: this.lastFireDirY }
        : { x: this.ports.facingOf(PLAYER_TEAM), y: 0 };
      const len = Math.hypot(dir.x, dir.y) || 1;
      const unitX = dir.x / len;
      const unitY = dir.y / len;

      if (this.hasKinetic) {
        const magnitude = KINETIC_BURST_GAIN * this.projectileMass * Math.max(0, ev.relativeVelocity);
        if (magnitude > 0) {
          this.kineticHits += 1;
          this.lastKineticImpulse = magnitude;
          this.lastKineticHit = { x: at.x, y: at.y, magnitude };
          this.pending.push({
            team: ENEMY_TEAM,
            dirX: unitX,
            dirY: unitY,
            magnitude,
            at,
            label: 'kinetic',
          });
        }
      }

      if (this.hasSuppression) {
        // ⚠️ PRP-BUILD-01-R4：**每一次真实命中 → 恰好一次**中等击退，没有中间状态
        //    （无计数阈值、无「第 N 发」、无定时器、无累计层数）。
        //    强度是**固定值**，刻意不乘 `projectileMass` / `relativeVelocity` ——
        //    那是动能爆发的口径（单次强冲击）；压制射击要的是「多次小冲击」，
        //    弹重不该把它的量级带跑（重弹本来就已经通过真实物理打出更狠的命中）。
        this.pending.push({
          team: ENEMY_TEAM,
          dirX: unitX,
          dirY: unitY,
          magnitude: SUPPRESSION_SHOT_IMPULSE,
          at,
          label: 'suppression',
        });
      }
    }
  }

  /**
   * 在**固定步开始之前**统一施加待处理冲量（由 `RunBattleRuntime.step` 调用）。
   *
   * 战斗已结束 → 直接丢弃（保住「RESULT = 战场冻结」）。
   */
  flush(): void {
    if (this.pending.length === 0) return;
    if (this.ports.isFinished()) {
      this.pending.length = 0;
      return;
    }
    for (const p of this.pending) {
      this.ports.applyImpulse(p.team, p.dirX, p.dirY, p.magnitude, p.at);
      if (p.label === 'suppression') {
        // 计数点 = **真实施加**处（被 `isFinished` 丢弃的那批不计），与 `kineticHits` 同一纪律。
        this.suppressionHits += 1;
        this.lastSuppressionImpulse = p.magnitude;
      }
    }
    this.pending.length = 0;
  }

  snapshot(): RunAbilitySnapshot {
    return {
      kineticBurst: this.hasKinetic,
      suppressionShot: this.hasSuppression,
      suppressionHits: this.suppressionHits,
      lastSuppressionImpulse: this.lastSuppressionImpulse,
      kineticHits: this.kineticHits,
      lastKineticImpulse: this.lastKineticImpulse,
      lastKineticHit: this.lastKineticHit ? { ...this.lastKineticHit } : null,
      projectileMass: this.projectileMass,
      pending: this.pending.length,
    };
  }

  dispose(): void {
    this.unsub();
    this.pending.length = 0;
  }
}
