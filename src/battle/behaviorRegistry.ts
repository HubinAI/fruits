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
} from './behaviorRuntime';

export type BehaviorFactory = (ctx: BehaviorContext) => PartBehaviorRuntime;

/** 正式已注册 Behavior（Cannon / Hammer / Push Rod / Laser / Lifter / Rammer-Q12-C） */
const FACTORIES: Record<string, BehaviorFactory> = {
  cannon: createCannonRuntime,
  hammer: createHammerRuntime,
  pushRod: createPushRodRuntime,
  laser: createLaserRuntime,
  lifter: createLifterRuntime,
  rammer: createRammerRuntime,
};

/** 按 behavior id 取 factory（未注册 → undefined，Orchestrator 跳过该 part） */
export function getBehaviorFactory(behaviorId: string): BehaviorFactory | undefined {
  return FACTORIES[behaviorId];
}

/** 已注册 behavior id 列表（调试 / 测试用） */
export function registeredBehaviorIds(): string[] {
  return Object.keys(FACTORIES);
}
