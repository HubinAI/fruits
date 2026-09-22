/**
 * PRP-R5-RESTORE-LEGACY-BATTLE-CAMERA｜Run Page 的战斗视图宿主（**只做 camera 接线 / clip / 合成**）。
 *
 * 架构（与 Queue 必改 1/2/3 逐条对应）：
 *
 *   ┌ 正式 Planck 战斗世界（1600×900，spawn 400/1200）   ← RunBattleRuntime（正式 Orchestrator）
 *   │        ↓ getRenderSnapshot()（引擎中立只读快照）
 *   │ 正式 Renderer（**原样复用，零修改**）              ← 只画：天空 / 看台 / 平台 / 墙 /
 *   │                                                    刺墙 / 车 / 轮 / 部件 / 弹丸 / 喷焰
 *   │        ↓ **正式 battle 相机链**：reframe(snap,'battle',{phase})
 *   │          → battleCam → 逐帧 applyBattleFollow       ← 本文件只做「接线」，不写镜头算法
 *   │ 离屏视口 502×358（= 舞台带 390×302 + 正式 inset 56/28）
 *   └        ↓ drawImage（9 参数，裁安全区 → 1:1 贴到舞台带）  ← 本文件唯一的合成动作
 *
 * 为什么这样接（而不是让 PRP 自己画战斗 / 自己算镜头）：
 *   1) 画战斗 / 算镜头 = 战斗表现的**第二套实现**，与 Queue「优先复用正式链路、PRP 只负责
 *      生命周期 / clip / 容器适配」相冲突；
 *   2) 复用正式 Renderer + 正式相机后，PRP 屏幕上出现的正是正式战斗的同一批像素与
 *      同一套取景语义（远端双车分明 → 接近渐进放大 → 碰撞车辆成为主体），不存在观感漂移；
 *   3) 正式 Renderer 是**只读**复用：本文件不修改它的任何一行。
 *
 * ⚠️ 取景纪律（Queue 必改 5）：镜头里**不允许**出现 PRP 专属规则 ——
 *   不按炮弹 zoom / 不按碰撞 zoom / 无镜头震动 / 无 kill zoom / 无 cinematic。
 *   scale 只来自正式三段动态取景（由**真实世界间距比例**驱动），位置只来自正式
 *   `applyBattleFollow`。本文件因此**只调用**正式入口，从不写 `renderer.transform`。
 *
 * ⚠️ **viewport adapter**：离屏视口 = 舞台带 + 正式 inset（56/28），使正式**安全区恰好等于
 *   舞台带**（非 compact battle 分支：insetX 56 / insetTop 28 / insetBottom 28）。
 *   合成时裁安全区那一块 —— 相机算法一行不改（见 `runBattleRuntime.RUN_BATTLE_VIEW_*`）。
 *
 * ⚠️ 事件表现（炮口闪光 / 伤害数字 / 命中闪白 / 死亡 FX）复用**正式表现唯一入口**
 *   `createPlayerPresentation`，不自己实现第二套 VFX。
 */

import { Renderer } from '../../render/renderer';
import { VisualRegistry } from '../../render/visualRegistry';
import { SfxAudioService, type AudioProbeState } from '../../presentation/audioService';
import { createPlayerPresentation } from '../../presentation/playerPresentation';
import { RUN_STAGE_BAND, type RunRect } from './runPageLayout';
import {
  RUN_BATTLE_VIEW_H,
  RUN_BATTLE_VIEW_INSET,
  RUN_BATTLE_VIEW_W,
  shouldReframeBattleCamera,
  type RunBattleRuntime,
  type RunBattleXform,
} from './runBattleRuntime';
import { RUN_VISUAL_ASSETS } from './runVehicleAssets';

/**
 * PRODUCT-LOOP-P0-SETTLEMENT-SINGLE-CTA-AND-AUDIO-LIFECYCLE（必改 3）｜
 * 终态停止战斗音频时的**淡出时长**（毫秒）。
 *
 * ⚠️ 上限是 Queue 明写的 **200 ms**（「允许短淡出：<= 200ms」）。取 180 而不是共享实现
 *    默认的 220：这里**只需**满足结算页「立刻安静」这条体验要求，不必改动
 *    `SfxAudioService` 既有调用点（主玩法路径）的既定值。
 */
const RUN_BATTLE_AUDIO_FADE_MS = 180;

export interface RunBattleViewAssetStats {
  readonly registered: number;
  readonly ready: number;
  readonly failed: readonly string[];
}

/**
 * PRODUCT-LOOP-P0-SETTLEMENT-SINGLE-CTA-AND-AUDIO-LIFECYCLE（必改 3 / 4 / 8）｜
 * 战斗音频的生命周期读数（探针 / E2E 用；不参与任何战斗规则）。
 *
 * - `stopped`：本宿主上**是否调过**停止（幂等；`false` = 从没停过）；
 * - `stops`  ：停止被调用的次数（含 `dispose()` 里那一次）——
 *              用来证明「终态确实停过」，而**不是**用来要求某个精确次数（幂等 ⇒ 多少次都等价）；
 * - 其余字段直通 `SfxAudioService.getAudioProbe()`
 *   （`activeBgmSources` = 当前仍在循环发声的战斗音源数，终态必须为 `0`）。
 */
export interface RunBattleAudioProbe extends AudioProbeState {
  readonly stopped: boolean;
  readonly stops: number;
}

/**
 * 战斗视图宿主。
 *
 * 生命周期：`new RunBattleView()` → `loadAssets()`（异步）→ 每次要显示时 `render(runtime)` +
 * `blit(ctx, band)`。离屏视口恒为「舞台带 + 正式 inset」（502×358，再乘 DPR）——
 * 「clip」不是一次裁剪调用，而是**合成时只取安全区**这个结构性事实。
 */
export class RunBattleView {
  private readonly canvas: HTMLCanvasElement;
  private readonly registry = new VisualRegistry();
  private readonly renderer: Renderer;
  /**
   * PRODUCT-LOOP-P0-SETTLEMENT-SINGLE-CTA-AND-AUDIO-LIFECYCLE（必改 3 / 4）｜
   * 音频服务实例**必须自己持有**（旧实现直接 `new SfxAudioService()` 塞进表现层，
   * 于是「停战斗音」这件事在宿主里**根本没有把手**，只能等到 `dispose()` 里那句
   * `presentation.stop()` —— 而它只解绑事件订阅、**不停音源**）。
   */
  private readonly sfx: SfxAudioService;
  private readonly presentation;
  /** 本宿主的音频停止次数（幂等 ⇒ 仅供探针证明「停过」，不参与任何判断）。 */
  private audioStops = 0;
  /** 注入 Renderer 的视口抽象（**可变**：DPR 变化时同步，避免与画布 backing 失配）。 */
  private readonly surface: { width: number; height: number; devicePixelRatio: number; now(): number };
  private readonly urls = new Map<string, string>();
  private readonly failed = new Set<string>();
  /** 已绑定表现事件源的运行时实例（同一实例不重复绑定；换实例才重新绑定）。 */
  private boundTo: RunBattleRuntime | null = null;
  /** 上一次调用 reframe 时看到的阶段（`shouldReframeBattleCamera` 的输入）。 */
  private lastPhase: string | null = null;
  /** 结束帧是否已经画好（true = 之后复用该帧，战场与取景一起冻结）。 */
  private frozenFrame = false;
  /** 资源每次加载完成 → 宿主重绘（构造早于宿主字段就绪，故由宿主动态注册）。 */
  private onAssetReadyCb: (() => void) | null = null;
  private ready = 0;
  private dpr = 1;

  constructor(doc: Document = document) {
    this.canvas = doc.createElement('canvas');
    this.dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    this.applySize();
    // 注入 surface：Renderer 的 view 域 = 本离屏视口（带 + 正式 inset），与页面 DOM 尺寸解耦。
    // ⚠️ surface 是**长期持有的同一个对象**：DPR 变化時由 applySize() 同步，
    //    否则 Renderer 的 setTransform(dpr) 会与画布 backing 尺寸失配（画面整帧错位）。
    this.surface = {
      width: RUN_BATTLE_VIEW_W,
      height: RUN_BATTLE_VIEW_H,
      devicePixelRatio: this.dpr,
      now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    };
    this.renderer = new Renderer(this.canvas, this.registry, this.surface);
    this.renderer.setBattleBackdrop(true);
    this.sfx = new SfxAudioService();
    this.presentation = createPlayerPresentation(this.renderer, this.sfx);
    this.loadAssets(() => this.onAssetReadyCb?.());
  }

  /** 正式车辆美术（与正式入口同源的 5 个 PNG）→ 正式 VisualRegistry。 */
  private loadAssets(onReady?: () => void): void {
    for (const [visualId, url] of Object.entries(RUN_VISUAL_ASSETS)) {
      this.urls.set(visualId, url);
      this.registry.register(visualId, url);
      const img = new Image();
      img.onload = () => {
        if (img.width > 0 && img.height > 0) {
          this.registry.setImage(visualId, img);
          this.ready += 1;
        } else {
          this.failed.add(visualId);
        }
        onReady?.();
      };
      img.onerror = () => {
        this.failed.add(visualId);
        onReady?.();
      };
      img.src = url;
    }
  }

  assetStats(): RunBattleViewAssetStats {
    return { registered: this.urls.size, ready: this.ready, failed: [...this.failed].sort() };
  }

  /** 全部正式车辆 sprite 都已就绪（= 画面里画的是真实车辆美术，而不是缺件的车）。 */
  get assetsAllReady(): boolean {
    return this.failed.size === 0 && this.ready >= Object.keys(RUN_VISUAL_ASSETS).length;
  }

  /** 相机实时状态（离屏画布域）；舞台带内坐标需减去 cropX/cropY。 */
  viewTransform(): RunBattleXform {
    const t = this.renderer.transform;
    return {
      scale: t.scale,
      offsetX: t.offsetX,
      offsetY: t.offsetY,
      cropX: RUN_BATTLE_VIEW_INSET.x,
      cropY: RUN_BATTLE_VIEW_INSET.y,
    };
  }

  /**
   * 每帧绘制一次：真实战斗快照 → 正式 Renderer（含**正式 battle 相机链**）。
   *
   * ⚠️ `reframe` 的调用节奏 = **正式口径**（见 `shouldReframeBattleCamera`）：
   *   `Active` 每帧（正式 `Renderer` battle 分支自述「Active 每帧」，正式相机测试
   *   `battleDynamicFramingR21.test.ts` 同源）+ 每个阶段切换那一帧。PRP 在这里只做
   *   **接线**——镜头算法（三段 span / 阻尼 / 死区 / 单帧钳制 / 地面锚定）全在正式 renderer 内。
   *
   * ⚠️ `reframe` 之后必须调 `render()`：正式 `applyBattleFollow` 在 render 内逐帧执行
   *   （追踪双方中点 + 分离有限拉远 + offsetX 平滑 + 世界不出画 clamp）。
   *
   * ⚠️ 战斗结束后（result 非空）：**取景与战场一起冻结** —— 不再 reframe，也**不再重画**
   *   离屏战场，后续每一帧直接复用已经画好的结束帧（`blit` 即可）。这样 RESULT 画面在
   *   像素与几何上都逐帧完全一致（正式 `applyBattleFollow` 的 offsetX 阻尼是渐近的，
   *   若继续逐帧 render，会把「冻结的战场」缓慢挪动）。视口/DPR 变化仍强制重画。
   */
  render(runtime: RunBattleRuntime): void {
    const resized = this.applySize();
    if (this.boundTo !== runtime) {
      this.boundTo = runtime;
      // 换战斗实例：重置相机接线状态（阶段记忆 / 冻结帧 / 表现绑定）
      this.lastPhase = null;
      this.frozenFrame = false;
      this.presentation.bind({ onEvent: (cb) => runtime.orchestrator.onCombatEvent(cb) });
    }
    const live = runtime.result === null;
    if (!live && this.frozenFrame && !resized) return; // 冻结：复用结束帧
    const phase = runtime.phase;
    if (live && shouldReframeBattleCamera(phase, this.lastPhase)) {
      this.lastPhase = phase;
      this.renderer.reframe(runtime.snapshot(), 'battle', { phase });
    }
    this.renderer.render(runtime.orchestrator);
    if (!live) this.frozenFrame = true;
  }

  /**
   * 把离屏战斗画面贴到目标画布的舞台带（唯一的合成动作）。
   *
   * 9 参数 `drawImage`：源矩形 = **正式安全区**（= inset 原点 + 舞台带尺寸 × DPR），
   * 目标矩形 = 舞台带。视口比带大出来的 inset 边缘（`cropX/cropY` 那圈）永远不出画 ——
   * 这正是「viewport adapter」的落点，不是一次额外的裁剪调用。
   */
  blit(ctx: CanvasRenderingContext2D, band: RunRect = RUN_STAGE_BAND): void {
    ctx.drawImage(
      this.canvas,
      RUN_BATTLE_VIEW_INSET.x * this.dpr,
      RUN_BATTLE_VIEW_INSET.y * this.dpr,
      band.w * this.dpr,
      band.h * this.dpr,
      band.x,
      band.y,
      band.w,
      band.h,
    );
  }

  /**
   * PRODUCT-LOOP-P0-SETTLEMENT-SINGLE-CTA-AND-AUDIO-LIFECYCLE（必改 3 / 4）｜
   * **停止战斗音频**（终态结算专用入口；与页面析构解耦）。
   *
   * 做两件事，缺一不可：
   *   ① `presentation.stop()` —— 解开战斗事件订阅，终态上不再产生任何**新的**战斗音；
   *   ② `sfx.stopBattleAudio(fadeMs)` —— 把**已经在循环**的音源在 ≤200ms 内淡出并停止。
   *
   * ⚠️ 为什么 ② 不能省：`presentation.stop()` 只解绑，**一个音源都不会停**。
   *    实测（`tests/settlementAudioLifecycle.test.ts`）蓄能循环音源在解绑后
   *    `activeBgmSources` 仍为 1 —— 真人录屏里「结算页仍持续播放战斗噪音」正是它。
   * ⚠️ **幂等**：重复调用安全（同一音源带 `stopped` 闸；空集时是 no-op），
   *    因此「终态停一次 + `dispose()` 再停一次」不会报错、也不会重复发声（必改 4）。
   * ⚠️ 不做任何**画面**副作用：冻结的战场帧仍由 `render()` 的 `frozenFrame` 分支复用。
   */
  stopBattleAudio(): void {
    this.audioStops += 1;
    this.presentation.stop();
    this.sfx.stopBattleAudio(RUN_BATTLE_AUDIO_FADE_MS);
  }

  /** 战斗音频生命周期读数（必改 8：探针 / E2E 只锁 `ACTIVE → STOPPED`，不测音量数值）。 */
  audioProbe(): RunBattleAudioProbe {
    return { ...this.sfx.getAudioProbe(), stopped: this.audioStops > 0, stops: this.audioStops };
  }

  dispose(): void {
    // ⚠️ 必改 4：析构**复用**同一个幂等停止入口 —— 页面销毁不需要重新发明一套静音逻辑，
    //    也不会因为「终态已经停过」而产生第二次异常。
    this.stopBattleAudio();
    this.boundTo = null;
  }

  /* --------------------------------------------------------------- 内部 */

  /** 宿主注册「资源就绪 → 重绘」回调（构造早于宿主字段就绪，故不能只靠构造参数）。 */
  onAssetsReady(cb: () => void): void {
    this.onAssetReadyCb = cb;
  }

  /** 同步画布 backing 尺寸；返回是否发生了尺寸变化（变化会清空画布 → 冻结帧必须重画）。 */
  private applySize(): boolean {
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    this.dpr = dpr;
    if (this.surface) this.surface.devicePixelRatio = dpr; // DPR 变化 → 与 backing 保持同一域
    const w = Math.round(RUN_BATTLE_VIEW_W * dpr);
    const h = Math.round(RUN_BATTLE_VIEW_H * dpr);
    let changed = false;
    if (this.canvas.width !== w) {
      this.canvas.width = w;
      changed = true;
    }
    if (this.canvas.height !== h) {
      this.canvas.height = h;
      changed = true;
    }
    if (changed) this.frozenFrame = false;
    return changed;
  }
}
