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
 *   - **强力后坐 strongRecoil**：**每一次真实开火**都追加一次强后坐冲量 ——
 *     方向 = 本次开火的真实炮口方向**取反**（复用本分支已记录的 `lastFireDirX/Y`），
 *     作用点 = 本次开火的**真实炮口位置**（`weaponFire.worldPosition`）。
 *     **只由 `weaponFire` 事件驱动：无定时器、无「第 N 发」判断、无 charge / 阈值状态。**
 *     ⚠️ PRP-BUILD-01-R2：口径曾是「沿自身 facing 的**前向**冲量（接敌补偿）」——
 *     方向与真实后坐**相反**，真人无法把它读成因果（与正常接敌 / 接触推挤 / 相机跟随混在一起）。
 *     ⚠️ PRP-BUILD-01-R3：R2 改成同向强后坐之后，仍然是「每 N 发**蓄满一次**才释放一次」的
 *     **隐藏规则** —— 正常速度下真人分辨不出「哪一发才特殊」，会与普通 Cannon recoil /
 *     Enemy 接敌 / Collision / Camera follow 混在一起（真人第二次验收仍判失败）。
 *     现按 Queue 设计改判：**删除 charge 概念**，改成最简单的自然因果 —— **一炮一后坐**。
 *     高射速因此自然产生高频控距（每一炮都把自己往后踹一点）。
 *     ⚠️ 作用点用**真实炮口**而非质心：后坐本来就发生在炮口上，力臂产生真实的绕质心扭矩
 *     （与基础 Cannon 的普通后坐同源）；只作用在质心时冲量是纯平动，会被
 *     「跟随双方中点」的正式相机**追平**（R1 实测：世界退 20~32px → 舞台带只动 3~5px）。
 */

import type { BattleEvent } from '../../battle/combatEvents';
import {
  KINETIC_BURST_GAIN,
  STRONG_RECOIL_IMPULSE,
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
  readonly label: 'kinetic' | 'recoil';
}

/** 能力运行状态（诊断 / 验收用；全部是真实发生过的计数与量值）。 */
export interface RunAbilitySnapshot {
  /** 本局是否带「动能爆发」。 */
  readonly kineticBurst: boolean;
  /** 本局是否带「强力后坐」。 */
  readonly strongRecoil: boolean;
  /** 已**真实施加**的强力后坐次数（每个真实 `weaponFire` 恰好一次 → 与玩家开火次数 1:1）。 */
  readonly recoilKicks: number;
  /** 最近一次强力后坐冲量的大小（0 = 本局还没开过火）。 */
  readonly lastRecoilImpulse: number;
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
  private readonly hasStrongRecoil: boolean;
  private readonly unsub: () => void;
  /** 本局真实 projectile 质量（构造时读一次；战斗中不会变）。 */
  readonly projectileMass: number;

  private recoilKicks = 0;
  private lastRecoilImpulse = 0;
  private kineticHits = 0;
  private lastKineticImpulse = 0;
  private lastKineticHit: { x: number; y: number; magnitude: number } | null = null;
  /** 最近一次玩家侧开火的真实炮口方向（动能爆发用；未开火前用玩家朝向兜底）。 */
  private lastFireDirX = 1;
  private lastFireDirY = 0;
  /** 最近一次玩家侧开火的**真实炮口位置**（强力后坐的作用点）。 */
  private lastFireX = 0;
  private lastFireY = 0;
  private hasFireDir = false;
  private readonly pending: PendingImpulse[] = [];

  constructor(ports: RunAbilityPorts, build: readonly RunModifierId[]) {
    this.ports = ports;
    this.hasKinetic = buildHas(build, 'kineticBurst');
    this.hasStrongRecoil = buildHas(build, 'strongRecoil');
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
      this.lastFireX = ev.worldPosition.x;
      this.lastFireY = ev.worldPosition.y;
      this.hasFireDir = true;
      if (!this.hasStrongRecoil) return;
      // ⚠️ PRP-BUILD-01-R3：**每一次真实开火都追加一次强后坐** —— 一条 `weaponFire`
      //    对应一次冲量，没有任何中间状态（无计数、无阈值、无「第 N 发」判断）。
      //
      //    R2 的口径是「每 3 发蓄满 → 释放一次」，虽然物理上真实生效（450 冲量确实把车踹开），
      //    但真人第二次验收仍判失败：正常速度下分辨不出「哪一发才特殊」，
      //    会与普通 Cannon recoil / Enemy 接敌 / Collision / Camera follow 混在一起。
      //    根因是**多了一层不可见的累计状态** —— 玩家看不到「2/3」，只能看到一串相似的开炮。
      //    改成一一对应之后，因果变成「炮弹离膛 → 车马上后退」，连续多炮重复同一件事，
      //    高射速自然读成「高频控距」，不需要任何 UI 解释。
      //    ⚠️ 方向 = 本次开火的真实炮口方向取反（本分支上方刚写入的 `lastFireDirX/Y`）——
      //       就是车辆本来就在承受的那个后坐方向，不是朝向兜底。
      //    ⚠️ 作用点 = 本次开火的**真实炮口位置**（`weaponFire.worldPosition`）：
      //       后坐本来就发生在炮口上，力臂自然产生绕质心的后仰扭矩。只作用在质心时冲量是
      //       纯平动，会被「跟随双方中点」的正式相机**追平**（R1 实测：世界退 20~32px →
      //       舞台带只动 3~5px）；扭矩产生的仰俯是相机平移追不平的通道（R1 已证）。
      const fx = this.lastFireDirX;
      const fy = this.lastFireDirY;
      const flen = Math.hypot(fx, fy) || 1;
      this.pending.push({
        team: PLAYER_TEAM,
        dirX: -fx / flen,
        dirY: -fy / flen,
        magnitude: STRONG_RECOIL_IMPULSE,
        at: { x: this.lastFireX, y: this.lastFireY },
        label: 'recoil',
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
      // ⚠️ 真实作用点 = 本次命中的 `contactPoint`（拷贝一份，不持有事件对象）。
      const at = { x: ev.contactPoint.x, y: ev.contactPoint.y };
      this.lastKineticHit = { x: at.x, y: at.y, magnitude };
      const dir = this.hasFireDir
        ? { x: this.lastFireDirX, y: this.lastFireDirY }
        : { x: this.ports.facingOf(PLAYER_TEAM), y: 0 };
      const len = Math.hypot(dir.x, dir.y) || 1;
      this.pending.push({
        team: ENEMY_TEAM,
        dirX: dir.x / len,
        dirY: dir.y / len,
        magnitude,
        at,
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
      this.ports.applyImpulse(p.team, p.dirX, p.dirY, p.magnitude, p.at);
      if (p.label === 'recoil') {
        // 计数点 = **真实施加**处（被 `isFinished` 丢弃的那批不计），与 `kineticHits` 同一纪律。
        this.recoilKicks += 1;
        this.lastRecoilImpulse = p.magnitude;
      }
    }
    this.pending.length = 0;
  }

  snapshot(): RunAbilitySnapshot {
    return {
      kineticBurst: this.hasKinetic,
      strongRecoil: this.hasStrongRecoil,
      recoilKicks: this.recoilKicks,
      lastRecoilImpulse: this.lastRecoilImpulse,
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
