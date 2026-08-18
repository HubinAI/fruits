/**
 * Planck Arena Runtime（Queue F-02M-B13A）—— 最小实现。
 *
 * 与 Matter ArenaRuntime（src/battle/arenaRuntime.ts）保持同构：
 * - static ground（friction=1）、static 左右普通墙（friction=0.2、restitution=0.05）、
 *   kinematic 左右 Closing 刺墙（friction=0.2、restitution=0，初始速度 0）；
 * - 几何位置 / 尺寸 / collisionFilter 与 Matter Arena 对应规则一致；
 * - 共享 ArenaPhaseClock，阶段副作用语义与 Matter 完全一致
 *   （Warning→Closing 当步速度 0；原本已处于 Closing 的下一次 update 才推进；
 *   Closing→End 当步保留最后一次推进；End 后不再改速度）；
 * - OwnerTag：ground / arena / hazard。
 *
 * 约束：
 * - 禁止 import Matter adapter / vehicleAssembly；碰撞类别复用
 *   planckVehicleAssembly.ts 导出的 PlanckCategory（不复制数值）。
 * - 不接入车辆、Damage、ContactRouter、Orchestrator。
 */
import type { BodyHandle, PlanckWorld } from '../physics/planckWorld';
import type { BattlePhase } from '../core/types';
import { ArenaPhaseClock } from './arenaPhase';
import { DEFAULT_ARENA_CONFIG, type ArenaConfig } from './arenaConfig';
import { PlanckCategory } from './planckVehicleAssembly';

export interface PlanckClosingWall {
  body: BodyHandle;
  side: 'left' | 'right';
}

export class PlanckArenaRuntime {
  readonly config: ArenaConfig;
  readonly ground: BodyHandle;
  readonly leftWall: BodyHandle;
  readonly rightWall: BodyHandle;
  readonly closingWalls: PlanckClosingWall[] = [];

  private readonly world: PlanckWorld;
  private readonly phaseClock: ArenaPhaseClock;

  constructor(world: PlanckWorld, config: Partial<ArenaConfig> = {}) {
    this.world = world;
    this.config = { ...DEFAULT_ARENA_CONFIG, ...config };
    this.phaseClock = new ArenaPhaseClock({
      activeMs: this.config.phases.activeMs,
      warningMs: this.config.phases.warningMs,
      closingMs: this.config.phases.closingMs,
    });

    const t = this.config.wallThickness;
    const cx = this.config.width / 2;
    const vehicleMask = PlanckCategory.VEHICLE_A | PlanckCategory.VEHICLE_B;

    // Ground（static，friction=1）—— 与 Matter Arena 几何/过滤一致
    this.ground = world.createStaticBox(
      cx,
      this.config.groundY + this.config.height / 2,
      this.config.width + t * 2,
      this.config.height,
      {
        friction: 1,
        collisionFilter: {
          categoryBits: PlanckCategory.GROUND,
          maskBits: vehicleMask | PlanckCategory.PROJECTILE,
        },
      },
    );
    world.setOwnerTag(this.ground, { kind: 'ground' });

    // 左右普通低弹性 Wall（static，friction=0.2 / restitution=0.05）
    this.leftWall = world.createStaticBox(
      -t / 2,
      this.config.groundY,
      t,
      this.config.height,
      {
        friction: 0.2,
        restitution: 0.05,
        collisionFilter: {
          categoryBits: PlanckCategory.ARENA,
          maskBits: vehicleMask | PlanckCategory.PROJECTILE,
        },
      },
    );
    world.setOwnerTag(this.leftWall, { kind: 'arena' });

    this.rightWall = world.createStaticBox(
      this.config.width + t / 2,
      this.config.groundY,
      t,
      this.config.height,
      {
        friction: 0.2,
        restitution: 0.05,
        collisionFilter: {
          categoryBits: PlanckCategory.ARENA,
          maskBits: vehicleMask | PlanckCategory.PROJECTILE,
        },
      },
    );
    world.setOwnerTag(this.rightWall, { kind: 'arena' });

    // Closing 刺墙（kinematic，初始速度 0；friction=0.2 / restitution=0）
    const closing = (side: 'left' | 'right'): PlanckClosingWall => {
      const x = side === 'left' ? -t * 2 : this.config.width + t * 2;
      const body = world.createKinematicBox(
        x,
        this.config.groundY - this.config.height / 4,
        t,
        this.config.height / 2,
        {
          friction: 0.2,
          restitution: 0,
          collisionFilter: {
            categoryBits: PlanckCategory.HAZARD,
            maskBits: vehicleMask,
          },
        },
      );
      world.setOwnerTag(body, { kind: 'hazard' });
      world.setLinearVelocity(body, 0, 0);
      return { body, side };
    };
    this.closingWalls.push(closing('left'), closing('right'));
  }

  get phase(): BattlePhase {
    return this.phaseClock.phase;
  }

  /**
   * 每步推进阶段计时与 Closing 推进（语义与 Matter ArenaRuntime 严格一致）：
   * - Active→Warning 无物理副作用；
   * - Warning→Closing 当步速度仍为 0（不驱动）；
   * - 原本已处于 Closing 的下一次 update 才设置 left +closingSpeed / right -closingSpeed；
   * - Closing→End 当步仍保留最后一次推进；End 后不再改速度。
   */
  update(dtMs: number): void {
    if (this.phaseClock.phase === 'End') return;
    const upd = this.phaseClock.update(dtMs);
    if (upd.changed && upd.previous === 'Warning' && upd.current === 'Closing') {
      // Warning→Closing：当步不驱动（速度保持 0）
      return;
    }
    if (upd.previous === 'Closing') {
      // 原本已处于 Closing（含 Closing→End 当步）：左右相向推进
      for (const cw of this.closingWalls) {
        const dir = cw.side === 'left' ? 1 : -1;
        this.world.setLinearVelocity(cw.body, dir * this.config.closingSpeed, 0);
      }
    }
  }

  /** 强制设置阶段（Lab 调试用）：只切阶段并清零计时，不驱动墙体、无物理副作用 */
  setPhase(phase: BattlePhase): void {
    this.phaseClock.setPhase(phase);
  }

  /** Projectile Bounds 判断：越过顶部则销毁 */
  isOutOfProjectileBounds(p: { x: number; y: number }): boolean {
    return p.y < this.config.projectileTopY;
  }
}
