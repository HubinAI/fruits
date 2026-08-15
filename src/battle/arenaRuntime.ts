/**
 * Arena Runtime：只负责 Ground / Wall / Bounds / Phase / Closing / Hazard。
 *
 * 不读取车上装什么 Weapon、Build 职业、Gadget 类型（15.2）。
 */
import type { Body } from 'matter-js';
import type { BattlePhase } from '../core/types';
import { Category, PhysWorld, createBox, setMeta, setStatic, setVelocity } from '../physics/adapter';

export interface ArenaConfig {
  /** 墙内宽度 */
  width: number;
  /** 墙内高度 */
  height: number;
  /** 地面顶部 y（车辆落点参考） */
  groundY: number;
  wallThickness: number;
  /** 阶段时长（ms） */
  phases: {
    activeMs: number;
    warningMs: number;
    closingMs: number;
  };
  /** Closing 刺墙推进速度（px/s）。骨架阶段默认较慢，不精调节奏。 */
  closingSpeed: number;
  /** Projectile Bounds（顶部越界销毁） */
  projectileTopY: number;
}

export interface ClosingWall {
  body: Body;
  side: 'left' | 'right';
}

const DEFAULT_ARENA: ArenaConfig = {
  width: 1600,
  height: 900,
  groundY: 700,
  wallThickness: 60,
  phases: {
    activeMs: 10_000,
    warningMs: 3_000,
    closingMs: 5_000,
  },
  closingSpeed: 40,
  projectileTopY: -50,
};

export class ArenaRuntime {
  readonly config: ArenaConfig;
  readonly ground: Body;
  readonly leftWall: Body;
  readonly rightWall: Body;
  readonly closingWalls: ClosingWall[] = [];

  private _phase: BattlePhase = 'Active';
  private phaseElapsed = 0;

  constructor(world: PhysWorld, config: Partial<ArenaConfig> = {}) {
    this.config = { ...DEFAULT_ARENA, ...config };

    const t = this.config.wallThickness;
    const cx = this.config.width / 2;

    // Ground（平坦真实 Collider）
    this.ground = createBox(
      cx,
      this.config.groundY + this.config.height / 2,
      this.config.width + t * 2,
      this.config.height,
      0,
      { filter: { category: Category.GROUND, mask: Category.VEHICLE_A | Category.VEHICLE_B | Category.PROJECTILE }, friction: 1, frictionStatic: 1 },
    );
    setMeta(this.ground, { kind: 'ground' });
    this.ground.isStatic = true;
    world.add(this.ground);

    // 左右普通低弹性 Wall
    this.leftWall = createBox(
      -t / 2,
      this.config.groundY,
      t,
      this.config.height,
      0,
      { filter: { category: Category.ARENA, mask: Category.VEHICLE_A | Category.VEHICLE_B | Category.PROJECTILE }, restitution: 0.05, friction: 0.2 },
    );
    setMeta(this.leftWall, { kind: 'arena', side: 'left' });
    this.leftWall.isStatic = true;
    world.add(this.leftWall);

    this.rightWall = createBox(
      this.config.width + t / 2,
      this.config.groundY,
      t,
      this.config.height,
      0,
      { filter: { category: Category.ARENA, mask: Category.VEHICLE_A | Category.VEHICLE_B | Category.PROJECTILE }, restitution: 0.05, friction: 0.2 },
    );
    setMeta(this.rightWall, { kind: 'arena', side: 'right' });
    this.rightWall.isStatic = true;
    world.add(this.rightWall);

    // Closing 刺墙骨架（Hazard 接口）。初始静态，避免巨大质量动态体破坏世界稳定性；
    // 进入 Closing 阶段后才激活并推进。
    const closing = (side: 'left' | 'right'): ClosingWall => {
      const x = side === 'left' ? -t * 2 : this.config.width + t * 2;
      const body = createBox(x, this.config.groundY - this.config.height / 4, t, this.config.height / 2, 100_000, {
        filter: { category: Category.HAZARD, mask: Category.VEHICLE_A | Category.VEHICLE_B },
        friction: 0.2,
        restitution: 0,
      });
      setMeta(body, { kind: 'hazard', side });
      setStatic(body, true);
      world.add(body);
      return { body, side };
    };
    this.closingWalls.push(closing('left'), closing('right'));
  }

  get phase(): BattlePhase {
    return this._phase;
  }

  /** 每步推进阶段计时与 Closing 推进 */
  update(dtMs: number): void {
    if (this._phase === 'End') return;
    this.phaseElapsed += dtMs;
    const p = this.config.phases;

    if (this._phase === 'Active' && this.phaseElapsed >= p.activeMs) {
      this._phase = 'Warning';
      this.phaseElapsed = 0;
    } else if (this._phase === 'Warning' && this.phaseElapsed >= p.warningMs) {
      this._phase = 'Closing';
      this.phaseElapsed = 0;
      // 激活 Closing 刺墙
      for (const cw of this.closingWalls) setStatic(cw.body, false);
    } else if (this._phase === 'Closing') {
      // Closing 刺墙向中间推进
      for (const cw of this.closingWalls) {
        const dir = cw.side === 'left' ? 1 : -1;
        setVelocity(cw.body, dir * this.config.closingSpeed, 0);
      }
      if (this.phaseElapsed >= p.closingMs) {
        this._phase = 'End';
      }
    }
  }

  /** 强制设置阶段（Lab 调试用） */
  setPhase(phase: BattlePhase): void {
    this._phase = phase;
    this.phaseElapsed = 0;
  }

  /** Projectile Bounds 判断：越过顶部则销毁 */
  isOutOfProjectileBounds(p: { x: number; y: number }): boolean {
    return p.y < this.config.projectileTopY;
  }
}
