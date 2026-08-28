/**
 * F-WX-5｜微信精简战斗宿主（PlayerBattleHost 微信实现）。
 *
 * 复用正式 PlanckBattleOrchestrator + Renderer + BattlePresentationController，
 * **不**经 PhysicsLab（避免静态拉入 debugOverlay / Matter BattleOrchestrator /
 * Runtime Debug Tools——Queue 禁止微信正式入口加载 Physics Lab / Scenario / Debug Tools）。
 *
 * 与 PhysicsLab 的关键差异：无 paused / timeScale / debugFlags / overrides /
 * loadScenario（玩家版本不需要）；预览/战斗创建逻辑与 physicsLab 同源
 * （预览共用 PREVIEW_BATTLE_CONFIG，见 src/battle/previewConfig.ts）。
 */
import { registry } from '../core/content';
import { PlanckBattleOrchestrator } from '../battle/planckBattleOrchestrator';
import { PREVIEW_BATTLE_CONFIG } from '../battle/previewConfig';
import type { BattleConfig, BattleOrchestratorApi } from '../battle/battleContract';
import type { Renderer, CameraFit, FramingRect } from '../render/renderer';
import type { BattlePresentationController, BattleEventSource } from '../presentation/battlePresentationController';
import type { BuildSnapshot } from '../core/types';
import type { PlayerBattleHost } from './playerGameRuntime';

/** 微信玩家版本战斗宿主：只做 preview/battle/step/render/camera，不提供任何 DEV 能力 */
export class WechatBattleHost implements PlayerBattleHost {
  orchestrator: BattleOrchestratorApi | null = null;
  private isPreviewMode = false;

  constructor(
    private readonly renderer: Renderer,
    private readonly presentation?: BattlePresentationController,
  ) {}

  get previewMode(): boolean {
    return this.isPreviewMode;
  }

  loadCustomPreview(buildA: BuildSnapshot, buildB: BuildSnapshot, soloA: boolean = false): void {
    this.isPreviewMode = true;
    const cfg: BattleConfig = { ...PREVIEW_BATTLE_CONFIG }; // 与 Web 装配预览同一语义
    this.orchestrator = new PlanckBattleOrchestrator(buildA, buildB, registry, cfg, soloA);
    this.presentation?.stop(); // 预览不消费 Battle Event（与 PhysicsLab 一致）
  }

  loadCustom(buildA: BuildSnapshot, buildB: BuildSnapshot, config?: BattleConfig): void {
    this.isPreviewMode = false;
    this.orchestrator = new PlanckBattleOrchestrator(
      buildA,
      buildB,
      registry,
      config ?? { autoDrive: true },
    );
    if (this.presentation && this.orchestrator) {
      const source: BattleEventSource = {
        onEvent: (cb) => this.orchestrator!.onCombatEvent(cb),
      };
      this.presentation.bind(source); // 正式战斗才消费 Battle Event
    }
  }

  step(realDtMs: number): void {
    if (!this.orchestrator || this.isPreviewMode) return; // 预览不推进战斗
    this.orchestrator.step(realDtMs);
  }

  render(): void {
    if (!this.orchestrator) return;
    this.renderer.render(this.orchestrator); // 正式渲染路径（无 debugOverlay）
  }

  setPreviewVehicleFx(fx: { alpha: number; scale: number } | null): void {
    this.renderer.setPreviewVehicleFx(fx);
  }

  arenaDims(): { w: number; h: number } {
    const o = this.orchestrator;
    // BattleOrchestratorApi 接口无 arena 字段；微信宿主恒创建 Planck，instanceof 收窄取 config
    if (o instanceof PlanckBattleOrchestrator) {
      return { w: o.arena.config.width, h: o.arena.config.height };
    }
    return { w: 1600, h: 900 };
  }

  reframe(fit: CameraFit, framingRect?: FramingRect): void {
    const o = this.orchestrator;
    if (!o) return;
    this.renderer.reframe(o.getRenderSnapshot(), fit, {
      phase: fit === 'battle' ? o.phase : undefined,
      framingRect,
    });
  }

  resize(w: number, h: number): void {
    this.renderer.resize(w, h);
  }

  setHomeBackdrop(on: boolean): void {
    // F-HOME-P0-LAYER：首页程序化背景下沉为 renderer underlay（背景层<车辆层<UI层）
    this.renderer.setHomeBackdrop(on);
  }

  setPrebattleBackdrop(on: boolean): void {
    // F-PREBATTLE-VISUAL-R1：战前程序化背景下沉为 renderer underlay（背景层<车辆层<UI层）
    this.renderer.setPrebattleBackdrop(on);
  }

  setBattleBackdrop(on: boolean): void {
    // F-BATTLE-PRESENTATION-R2：战斗竞技场程序化背景下沉为 renderer underlay（背景层<车辆层<UI层）
    this.renderer.setBattleBackdrop(on);
  }

  getMatchVehicleRects(): { a: { x: number; y: number; w: number; h: number }; b: { x: number; y: number; w: number; h: number } } | null {
    const o = this.orchestrator;
    if (!o) return null;
    return this.renderer.getVehicleScreenRects(o.getRenderSnapshot());
  }

  /** F-HOME-STAGE-R2：首页「我的车」真实 envelope（逻辑 px）；无 orchestrator → null */
  getHomeVehicleRect(): { x: number; y: number; w: number; h: number } | null {
    const o = this.orchestrator;
    if (!o) return null;
    const rects = this.renderer.getVehicleScreenRects(o.getRenderSnapshot());
    return rects ? rects.a : null;
  }

  /** F-GARAGE-LIVE-ASSEMBLY-P0：当前车辆（A）真实装配挂点屏幕坐标（逻辑 px，只读）。 */
  getVehicleHardpointScreenPts(): Array<{ id: string; kind: "movement" | "functional"; x: number; y: number; occupied: boolean }> {
    const o = this.orchestrator;
    if (!o) return [];
    return this.renderer.getVehicleHardpointScreenPts(o.getRenderSnapshot(), 'a');
  }
}
