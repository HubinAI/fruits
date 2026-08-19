/**
 * Physics Lab：直接调用正式 Battle Runtime（禁止第二套物理 / 伤害 / 移动实现）。
 * 提供 Start / Pause / Reset / Clear、时间缩放、Debug 开关、Debug Override。
 */
import type { BuildSnapshot } from '../core/types';
import { registry } from '../core/content';
import type { BattleConfig, BattleOrchestratorApi } from '../battle/battleContract';
import { BattleOrchestrator } from '../battle/battleOrchestrator';
import { PlanckBattleOrchestrator } from '../battle/planckBattleOrchestrator';
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
  orchestrator: BattleOrchestratorApi | null = null;
  paused = false;
  timeScale = 1;
  debugFlags: DebugFlags = { ...DEFAULT_DEBUG_FLAGS };
  overrides: DebugOverrides = { ...DEFAULT_OVERRIDES };

  private currentScenario: ScenarioDef | null = null;

  /** 最近一次 custom battle 的输入（供 Reset 重建；与 currentScenario 互斥） */
  private currentCustom: {
    buildA: BuildSnapshot;
    buildB: BuildSnapshot;
    config: BattleConfig;
  } | null = null;

  constructor(private renderer: Renderer) {}

  loadScenario(sc: ScenarioDef): void {
    this.currentScenario = sc;
    this.currentCustom = null;
    this.orchestrator = this.createBattle(sc.buildA, sc.buildB, sc.config);
  }

  /**
   * 从自定义 Build 创建战斗（供 Build 编辑器用）。
   * config 缺省 = { autoDrive: true }（无 engine → 维持既有 Matter 兼容语义）。
   * 显式传 { autoDrive: true, engine: 'planck' } → 创建 PlanckBattleOrchestrator。
   * 保存 buildA/buildB/config，Reset 时按同一输入重建同场战斗。
   */
  loadCustom(
    buildA: BuildSnapshot,
    buildB: BuildSnapshot,
    config?: BattleConfig,
  ): void {
    this.currentScenario = null;
    const cfg = config ?? { autoDrive: true };
    this.currentCustom = { buildA, buildB, config: cfg };
    this.orchestrator = this.createBattle(buildA, buildB, cfg);
  }

  private createBattle(
    buildA: BuildSnapshot,
    buildB: BuildSnapshot,
    config: BattleConfig,
  ): BattleOrchestratorApi {
    const a = applyOverridesToBuild(buildA, this.overrides);
    const b = applyOverridesToBuild(buildB, this.overrides);
    const c = applyOverridesToConfig(config, this.overrides);
    // 引擎选择：仅显式 engine === 'planck' 进入 PlanckBattleOrchestrator；
    // 其余（缺省 / 'matter' / loadCustom 未传 engine）一律 Matter，默认行为不变。
    const orch: BattleOrchestratorApi =
      config.engine === 'planck'
        ? new PlanckBattleOrchestrator(a, b, registry, c)
        : new BattleOrchestrator(a, b, registry, c);
    this.renderer.bind(orch);
    return orch;
  }

  step(realDtMs: number): void {
    if (!this.orchestrator || this.paused) return;
    this.orchestrator.step(realDtMs, this.timeScale);
  }

  render(): void {
    const orch = this.orchestrator;
    if (!orch) return;
    // Matter 路径：保留 Matter-only debugOverlay（drawDebug）。
    // Planck 路径：debugOverlay 仍是 Matter-only，本队列禁止重构，故只走正式 renderer.render()（不调用 drawDebug）。
    if (orch instanceof BattleOrchestrator) {
      this.renderer.render(orch, (ctx, t) => drawDebug(ctx, t, orch, this.debugFlags));
    } else {
      this.renderer.render(orch);
    }
  }

  reset(): void {
    if (this.currentScenario) {
      this.loadScenario(this.currentScenario);
    } else if (this.currentCustom) {
      const c = this.currentCustom;
      this.loadCustom(c.buildA, c.buildB, c.config);
    }
  }

  clear(): void {
    this.orchestrator?.dispose();
    this.orchestrator = null;
    this.currentScenario = null;
    this.currentCustom = null;
  }
}
