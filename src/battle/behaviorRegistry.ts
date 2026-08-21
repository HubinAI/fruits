/**
 * Behavior Registry（W1-BH-1）：behavior id → runtime factory。
 *
 * 新增 Weapon/Gadget Behavior 时，只需在此注册 factory：
 *   FACTORIES[myBehaviorId] = (ctx) => new MyRuntime(ctx);
 * 正常情况下不再修改 PlanckBattleOrchestrator 生命周期。
 */
import type { PartBehaviorRuntime, BehaviorContext } from './behaviorRuntime';
import {
  createCannonRuntime,
  createHammerRuntime,
  createPushRodRuntime,
  createLaserRuntime,
  createLifterRuntime,
  createRammerRuntime,
  createSawRuntime,
  createShotgunRuntime,
  createThrusterRuntime,
  createMachineGunRuntime,
} from './behaviorRuntime';

export type BehaviorFactory = (ctx: BehaviorContext) => PartBehaviorRuntime;

/** 已注册 Behavior（Cannon / Hammer / Push Rod / Laser / Lifter[prototype/hold] / Rammer-Q12-C / Saw-Q13-A / Shotgun-Q13-B / Thruster-Q13-C） */
const FACTORIES: Record<string, BehaviorFactory> = {
  cannon: createCannonRuntime,
  hammer: createHammerRuntime,
  pushRod: createPushRodRuntime,
  laser: createLaserRuntime,
  lifter: createLifterRuntime, // Q12-B-CLOSE prototype/hold：保留供 Scenario/测试/复用，不在玩家装配页
  rammer: createRammerRuntime,
  saw: createSawRuntime, // Q13-A：圆锯持续单方向高速旋转（真实 Revolute motor）
  shotgun: createShotgunRuntime, // Q13-B：霰弹炮齐射（5 发固定扇形真实 projectile / 一次爆闪 + 后坐）
  thruster: createThrusterRuntime, // Q13-C：推进器（固定周期 windup→thrust→cooldown；沿 chassis facing 施力 + 真实喷焰）
  machineGun: createMachineGunRuntime, // Q14-A：连发机枪（固定 burst 节奏，每发真实 projectile + 小闪光 + 单发后坐）
};

/** 按 behavior id 取 factory（未注册 → undefined，Orchestrator 跳过该 part） */
export function getBehaviorFactory(behaviorId: string): BehaviorFactory | undefined {
  return FACTORIES[behaviorId];
}

/** 已注册 behavior id 列表（调试 / 测试用） */
export function registeredBehaviorIds(): string[] {
  return Object.keys(FACTORIES);
}
