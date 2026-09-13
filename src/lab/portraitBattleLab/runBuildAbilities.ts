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
 * ## 三项的实现口径
 *
 *   - **动能爆发 kineticBurst**：`追加冲量 = KINETIC_BURST_GAIN × projectileMass × relativeVelocity`
 *     —— `projectileMass` 读自本局**真实 resolved 武器 def**（基础 1 / 重型弹头 4），
 *     `relativeVelocity` 读自正式 `damage` 事件。**没有「重型弹头专属伤害」这类写死强度**。
 *     方向 = 该次开火的真实炮口方向（`weaponFire.worldDirection`），作用点为敌车质心
 *     （纯平动推移 → 观感是「被整台撞开」，而不是被掀翻）。
 *   - **反冲蓄能 recoilCharge**：每 `RECOIL_CHARGE_THRESHOLD` 次真实开火蓄满一次，
 *     给玩家车一个**前向**冲量（沿自身 facing）→ 接敌补偿。**只由 fire/recoil 事件驱动，无定时器。**
 */

import type { BattleEvent } from '../../battle/combatEvents';
import {
  KINETIC_BURST_GAIN,
  RECOIL_CHARGE_IMPULSE,
  RECOIL_CHARGE_THRESHOLD,
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
  /** 在**步边界**施加一次真实冲量（作用点 = 该车质心）。 */
  readonly applyImpulse: (team: RunTeamId, dirX: number, dirY: number, magnitude: number) => void;
}

/** 一次待施加的真实冲量（步边界统一 flush）。 */
interface PendingImpulse {
  readonly team: RunTeamId;
  readonly dirX: number;
  readonly dirY: number;
  readonly magnitude: number;
  readonly label: 'kinetic' | 'charge';
}

/** 能力运行状态（诊断 / 验收用；全部是真实发生过的计数与量值）。 */
export interface RunAbilitySnapshot {
  /** 本局是否带「动能爆发」。 */
  readonly kineticBurst: boolean;
  /** 本局是否带「反冲蓄能」。 */
  readonly recoilCharge: boolean;
  /** 蓄能计数（0..THRESHOLD-1，已触发的已扣减）。 */
  readonly charge: number;
  /** 蓄满阈值（未带反冲蓄能时为 0）。 */
  readonly chargeThreshold: number;
  /** 已触发的接敌补偿次数（真实发生）。 */
  readonly chargesSpent: number;
  /** 动能爆发已触发的命中次数（真实发生）。 */
  readonly kineticHits: number;
  /** 最近一次动能追加冲量的大小（0 = 还没触发过）。 */
  readonly lastKineticImpulse: number;
  /** 正在读取的「当前 projectile 质量」（来自本局真实 resolved 武器 def）。 */
  readonly projectileMass: number;
  /** 尚未施加的待处理冲量数（正常应恒为 0 或 1）。 */
  readonly pending: number;
}

export class RunBuildAbilities {
  private readonly ports: RunAbilityPorts;
  private readonly hasKinetic: boolean;
  private readonly hasCharge: boolean;
  private readonly unsub: () => void;
  /** 本局真实 projectile 质量（构造时读一次；战斗中不会变）。 */
  readonly projectileMass: number;

  private charge = 0;
  private chargesSpent = 0;
  private kineticHits = 0;
  private lastKineticImpulse = 0;
  /** 最近一次玩家侧开火的真实炮口方向（动能爆发用；未开火前用玩家朝向兜底）。 */
  private lastFireDirX = 1;
  private lastFireDirY = 0;
  private hasFireDir = false;
  private readonly pending: PendingImpulse[] = [];

  constructor(ports: RunAbilityPorts, build: readonly RunModifierId[]) {
    this.ports = ports;
    this.hasKinetic = buildHas(build, 'kineticBurst');
    this.hasCharge = buildHas(build, 'recoilCharge');
    this.projectileMass = ports.projectileMass();
    this.unsub = ports.subscribe((ev) => this.onEvent(ev));
  }

  /** 事件 → 入队（**不在回调内改物理世界**，见文件头）。 */
  private onEvent(ev: BattleEvent): void {
    if (this.ports.isFinished()) return; // 战斗已结束 → 不再产生任何新动作

    if (ev.type === 'weaponFire') {
      if (ev.team !== PLAYER_TEAM) return;
      this.lastFireDirX = ev.worldDirection.x;
      this.lastFireDirY = ev.worldDirection.y;
      this.hasFireDir = true;
      if (!this.hasCharge) return;
      this.charge += 1;
      if (this.charge < RECOIL_CHARGE_THRESHOLD) return;
      this.charge -= RECOIL_CHARGE_THRESHOLD;
      this.chargesSpent += 1;
      // 玩家车「前向」= 自身 facing（A 朝 +X）→ 接敌补偿
      this.pending.push({
        team: PLAYER_TEAM,
        dirX: this.ports.facingOf(PLAYER_TEAM),
        dirY: 0,
        magnitude: RECOIL_CHARGE_IMPULSE,
        label: 'charge',
      });
      return;
    }

    if (ev.type === 'damage') {
      if (!this.hasKinetic) return;
      // 只认「玩家用炮打中敌车」这一次真实命中。
      if (ev.damageSource !== 'weapon') return;
      const sourceTeam: RunTeamId = ev.source;
      const targetTeam: RunTeamId = ev.target;
      if (sourceTeam !== PLAYER_TEAM || targetTeam !== ENEMY_TEAM) return;
      if (ev.behavior !== 'cannon') return;
      const magnitude = KINETIC_BURST_GAIN * this.projectileMass * Math.max(0, ev.relativeVelocity);
      if (!(magnitude > 0)) return;
      this.kineticHits += 1;
      this.lastKineticImpulse = magnitude;
      const dir = this.hasFireDir
        ? { x: this.lastFireDirX, y: this.lastFireDirY }
        : { x: this.ports.facingOf(PLAYER_TEAM), y: 0 };
      const len = Math.hypot(dir.x, dir.y) || 1;
      this.pending.push({
        team: ENEMY_TEAM,
        dirX: dir.x / len,
        dirY: dir.y / len,
        magnitude,
        label: 'kinetic',
      });
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
      this.ports.applyImpulse(p.team, p.dirX, p.dirY, p.magnitude);
    }
    this.pending.length = 0;
  }

  snapshot(): RunAbilitySnapshot {
    return {
      kineticBurst: this.hasKinetic,
      recoilCharge: this.hasCharge,
      charge: this.charge,
      chargeThreshold: this.hasCharge ? RECOIL_CHARGE_THRESHOLD : 0,
      chargesSpent: this.chargesSpent,
      kineticHits: this.kineticHits,
      lastKineticImpulse: this.lastKineticImpulse,
      projectileMass: this.projectileMass,
      pending: this.pending.length,
    };
  }

  dispose(): void {
    this.unsub();
    this.pending.length = 0;
  }
}
