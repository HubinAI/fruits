/**
 * Physics Lab：直接调用正式 Battle Runtime（禁止第二套物理 / 伤害 / 移动实现）。
 * 提供 Start / Pause / Reset / Clear、时间缩放、Debug 开关、Debug Override。
 */
import type { BuildSnapshot } from '../core/types';
import { registry } from '../core/content';
import type { BattleConfig } from '../battle/battleOrchestrator';
import { BattleOrchestrator } from '../battle/battleOrchestrator';
import type { Renderer } from '../render/renderer';
import { drawDebug } from '../render/debugOverlay';
import { DEFAULT_DEBUG_FLAGS, DEFAULT_OVERRIDES, type DebugFlags, type DebugOverrides } from '../render/debugOverlay';
import type { ScenarioDef } from './scenarios';
import type { WheelDef } from '../core/types';

/**
 * 把 Debug Override 应用到 Build（仅作用于 snapshot 层的 movement overrides，
 * 与正式 Content Config 隔离，禁止写入 registry）。
 */
function applyOverridesToBuild(
  build: BuildSnapshot,
  o: DebugOverrides,
): BuildSnapshot {
  if (!o.massScale && !o.driveTorqueScale && !o.gripScale) return build;
  return {
    ...build,
    movements: build.movements.map((m) => {
      const base = registry.movements.get(m.defId) as WheelDef | undefined;
      if (!base) return m;
      const merged: Partial<WheelDef> = { ...(m.overrides ?? {}) };
      if (o.massScale !== undefined) {
        merged.mass = (m.overrides?.mass ?? base.mass) * o.massScale;
      }
      if (o.driveTorqueScale !== undefined) {
        merged.driveTorque =
          (m.overrides?.driveTorque ?? base.driveTorque) * o.driveTorqueScale;
      }
      if (o.gripScale !== undefined) {
        merged.grip = (m.overrides?.grip ?? base.grip) * o.gripScale;
      }
      return { ...m, overrides: merged };
    }),
  };
}

function applyOverridesToConfig(
  config: BattleConfig,
  o: DebugOverrides,
): BattleConfig {
  if (o.impactThreshold === undefined) return config;
  return {
    ...config,
    impact: { ...(config.impact ?? {}), threshold: o.impactThreshold },
  };
}

export class PhysicsLab {
  orchestrator: BattleOrchestrator | null = null;
  paused = false;
  timeScale = 1;
  debugFlags: DebugFlags = { ...DEFAULT_DEBUG_FLAGS };
  overrides: DebugOverrides = { ...DEFAULT_OVERRIDES };

  private currentScenario: ScenarioDef | null = null;

  constructor(private renderer: Renderer) {}

  loadScenario(sc: ScenarioDef): void {
    this.currentScenario = sc;
    this.orchestrator = this.createBattle(sc.buildA, sc.buildB, sc.config);
  }

  /** 从自定义 Build 创建战斗（供 Build 编辑器用） */
  loadCustom(buildA: BuildSnapshot, buildB: BuildSnapshot): void {
    this.currentScenario = null;
    this.orchestrator = this.createBattle(buildA, buildB, { autoDrive: true });
  }

  private createBattle(
    buildA: BuildSnapshot,
    buildB: BuildSnapshot,
    config: BattleConfig,
  ): BattleOrchestrator {
    const a = applyOverridesToBuild(buildA, this.overrides);
    const b = applyOverridesToBuild(buildB, this.overrides);
    const c = applyOverridesToConfig(config, this.overrides);
    const orch = new BattleOrchestrator(a, b, registry, c);
    this.renderer.bind(orch);
    return orch;
  }

  step(realDtMs: number): void {
    if (!this.orchestrator || this.paused) return;
    this.orchestrator.step(realDtMs, this.timeScale);
  }

  render(): void {
    if (!this.orchestrator) return;
    const orch = this.orchestrator;
    this.renderer.render(orch, (ctx, t) => drawDebug(ctx, t, orch, this.debugFlags));
  }

  reset(): void {
    if (this.currentScenario) {
      this.loadScenario(this.currentScenario);
    }
  }

  clear(): void {
    this.orchestrator?.dispose();
    this.orchestrator = null;
    this.currentScenario = null;
  }
}
