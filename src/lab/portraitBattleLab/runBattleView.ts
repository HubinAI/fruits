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
 *   └        ↓ drawImage（9 参数，裁安全区 → **等比**贴到舞台带）  ← 本文件唯一的合成动作
 *
 * FRUITS-ADVENTURE-BATTLE-VIEW-F1（比例失真修复，2026-10-22）：
 *   上面这条链路的**最后一步**过去是「两轴各自缩放」（源矩形按安全区、目标矩形按舞台带），
 *   于是只要舞台带不是 390×302 的比例就必然单轴拉伸 —— 竖屏冒险把 390×302 贴到 390×648，
 *   纵向 ×2.146，战车/车轮/角色全部被拉长。现在：
 *     ① 视口尺寸可由 `safeArea` 指定（竖屏冒险传 390×648 ⇒ 视口 502×704），正式相机拿到
 *        「同一宽、更高」的安全区 —— 横向构图语义与正式战斗完全一致，纵向多看到天空/地面；
 *     ② 合成只算**一个** scale（`planBattleBlit`），X/Y 恒相同 ⇒ 结构性不可能再出现单轴拉伸。
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
 * DEMO-HEIGHT-LINE-READABILITY-R2｜**离屏视口放大倍数**（可选，默认 1）。
 *
 * 它只做一件事：把「离屏视口」按倍数放大 → 正式相机拿到一个更大的安全区
 * → 世界→画布的像素密度同比提高（**镜头算法一行不改**，与既有的
 * 「视口 = 舞台带 + 正式 inset」是同一个 adapter 手法，只是倍数不同）。
 *
 * ⚠️ 这不是「第二套取景」：不改变 `reframe` / 逐帧跟随 / 任何 clamped 语义，
 *    只是让官方画面被**栅格化得更密**。页面随后用 `blitRegion()` 裁出近景窗 ——
 *    放大仍然来自官方渲染的同一批像素，而不是把低清画面吹大。
 *
 * ⚠️ 默认 1 ⇒ 既有四个 Lab 页面（run-page / encounter-lab / gadget-lab /
 *    下方调用点）行为**逐像素不变**。
 */
export interface RunBattleViewOptions {
  readonly viewportScale?: number;
  /**
   * FRUITS-ADVENTURE-BATTLE-VIEW-F1｜**目标逻辑安全区尺寸**（默认 = 正式舞台带 390×302）。
   *
   * 离屏视口 = 安全区 + 正式 inset（56/28）× `viewportScale`。默认值与历史实现逐像素相同；
   * 传入更高的安全区（如竖屏冒险的 390×648）时，正式相机拿到的是**同一宽、更高**的取景窗：
   * 横向构图（双车 span 占比驱动 scale）与历史完全一致，纵向多看到天空/地面 ——
   * 于是合成时 X/Y 可以共用同一个缩放系数（1:1），不再需要把 390×302 拉成 390×648。
   */
  readonly safeArea?: { readonly w: number; readonly h: number };
}

/**
 * FRUITS-ADVENTURE-BATTLE-VIEW-F1｜一次 `drawImage` 的合成规划（源矩形 + 目标矩形，逻辑坐标）。
 *
 * ⚠️ 这是「比例不失真」的**结构性保证**：`dw/sw === dh/sh` 恒成立（`contain` 与 `cover`
 *    都只算**一个** scale），因此无论目标带与安全区比例如何变化，车辆 / 轮胎 / 角色都
 *    不会被单轴拉伸。历史实现是「源 = 安全区，目标 = 舞台带」两轴各用各的比值 —— 这正是
 *    竖屏冒险里 390×302 → 390×648（纵向 ×2.146）的失真来源。
 */
export interface BattleBlitPlan {
  /** 源矩形（相对安全区左上角，逻辑 px）。 */
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  /** 目标矩形（目标画布逻辑 px）。 */
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
}

/**
 * 计算等比合成矩形。
 *
 * - `contain`：整块安全区**完整**放进目标带（可能留下上下/左右留白），X/Y 用同一 scale；
 * - `cover`  ：等比放大到**铺满**目标带，多出来的部分裁掉（`focusY` 决定裁切偏向：
 *              0 = 保留顶部，0.5 = 居中，1 = 保留底部），X/Y 仍是同一 scale。
 */
export function planBattleBlit(
  src: { readonly w: number; readonly h: number },
  dst: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  mode: 'contain' | 'cover' = 'contain',
  focusY = 0.5,
): BattleBlitPlan {
  const sw = Math.max(1, src.w);
  const sh = Math.max(1, src.h);
  const dw0 = Math.max(1, dst.w);
  const dh0 = Math.max(1, dst.h);
  if (mode === 'cover') {
    const scale = Math.max(dw0 / sw, dh0 / sh);
    const cropW = Math.min(sw, dw0 / scale);
    const cropH = Math.min(sh, dh0 / scale);
    const f = Math.max(0, Math.min(1, focusY));
    return {
      sx: (sw - cropW) / 2,
      sy: (sh - cropH) * f,
      sw: cropW,
      sh: cropH,
      dx: dst.x,
      dy: dst.y,
      dw: dw0,
      dh: dh0,
    };
  }
  const scale = Math.min(dw0 / sw, dh0 / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  return {
    sx: 0,
    sy: 0,
    sw,
    sh,
    dx: dst.x + (dw0 - dw) / 2,
    dy: dst.y + (dh0 - dh) / 2,
    dw,
    dh,
  };
}

/**
 * 战斗视图宿主。
 *
 * 生命周期：`new RunBattleView()` → `loadAssets()`（异步）→ 每次要显示时 `render(runtime)` +
 * `blit(ctx, band)`（1:1 贴安全区）或 `blitRegion(ctx, src, dst)`（近景裁切贴图）。
 * 离屏视口 = 「舞台带 + 正式 inset」× `viewportScale`（默认 1 ⇒ 502×358，再乘 DPR）——
 * 「clip」不是一次裁剪调用，而是**合成时只取安全区 / 只取子矩形**这个结构性事实。
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
  /** 离屏视口放大倍数（≥1；见 `RunBattleViewOptions`）。1 = 与既有页面逐像素相同。 */
  private readonly viewportScale: number;
  /** 目标逻辑安全区（默认 = 正式舞台带；见 `RunBattleViewOptions.safeArea`）。 */
  private readonly safeW: number;
  private readonly safeH: number;
  /** 调用方是否显式指定了安全区（false ⇒ 视口公式保持历史形态，零回归）。 */
  private readonly safeOverride: boolean;

  constructor(doc: Document = document, options: RunBattleViewOptions = {}) {
    const requested = options.viewportScale ?? 1;
    this.viewportScale = Number.isFinite(requested) && requested > 1 ? requested : 1;
    const sa = options.safeArea;
    // ⚠️ 缺省 = 历史口径（安全区 390×302 ⇒ 视口 502×358），既有四个 Lab 页面零变化。
    this.safeOverride = !!sa && sa.w > 0 && sa.h > 0;
    this.safeW = this.safeOverride ? sa!.w : RUN_BATTLE_VIEW_W - RUN_BATTLE_VIEW_INSET.x * 2;
    this.safeH = this.safeOverride ? sa!.h : RUN_BATTLE_VIEW_H - RUN_BATTLE_VIEW_INSET.y * 2;
    this.canvas = doc.createElement('canvas');
    this.dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    this.applySize();
    // 注入 surface：Renderer 的 view 域 = 本离屏视口（带 + 正式 inset）× 放大倍数，
    // 与页面 DOM 尺寸解耦。⚠️ 视口放大 = 正式相机拿到更大的安全区 ⇒ 世界→画布像素密度同比提高，
    //    镜头算法本身不动。
    // ⚠️ surface 是**长期持有的同一个对象**：DPR 变化時由 applySize() 同步，
    //    否则 Renderer 的 setTransform(dpr) 会与画布 backing 尺寸失配（画面整帧错位）。
    this.surface = {
      width: this.viewportW(),
      height: this.viewportH(),
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
   * 把离屏战斗画面**等比**贴到目标矩形（默认舞台带）。
   *
   * FRUITS-ADVENTURE-BATTLE-VIEW-F1（失真修复）：历史实现是「源 = 安全区，目标 = 舞台带」，
   * X/Y 各用各的比值 —— 舞台带一旦不是安全区比例（竖屏冒险 390×302 → 390×648），车辆就被
   * 纵向拉长 2.146×。现在只算**一个** scale（`planBattleBlit` 的 contain），X/Y 恒相同：
   *   - 目标比例 = 安全区比例（所有 Lab 页 + 竖屏冒险的战斗态）⇒ 1:1，与历史逐像素相同；
   *   - 目标更高/更宽 ⇒ 等比缩放并居中，**绝不**单轴拉伸（可能留白，由调用方决定是否接受）。
   *
   * ⚠️ 这只改变合成几何，不写 `renderer.*`、不改物理世界 / 碰撞 / 相机规则。
   */
  blit(ctx: CanvasRenderingContext2D, band: RunRect = RUN_STAGE_BAND): void {
    this.composite(ctx, band, 'contain', 0.5);
  }

  /**
   * FRUITS-ADVENTURE-BATTLE-VIEW-F1｜**等比铺满**合成：目标带比安全区更扁/更窄时，
   * 等比放大到铺满后裁掉溢出部分（`focusY` 控制裁切偏向，0.5 = 居中）。
   *
   * 用途：竖屏冒险的 RESULT 阶段主体层只有 390×468（比 390×648 的战斗舞台矮），
   * 若用 contain 会整体缩小、留出左右/上下空档；cover 则保持车辆像素尺寸不变、
   * 只裁掉一部分天空与地面带 —— 宽高比依旧是同一个 scale。
   */
  blitCover(ctx: CanvasRenderingContext2D, band: RunRect, focusY = 0.5): void {
    this.composite(ctx, band, 'cover', focusY);
  }

  /**
   * **唯一的远景/定格合成口径**（`blit` 与 `blitCover` 共用）：`planBattleBlit` 只算一个
   * scale，源矩形换算到 backing 的 device 域后交给 9 参数 `drawImage`。
   */
  private composite(
    ctx: CanvasRenderingContext2D,
    band: RunRect,
    mode: 'contain' | 'cover',
    focusY: number,
  ): void {
    const safe = this.safeAreaSize();
    const plan = planBattleBlit(safe, band, mode, focusY);
    ctx.drawImage(
      this.canvas,
      RUN_BATTLE_VIEW_INSET.x * this.dpr + plan.sx * this.dpr,
      RUN_BATTLE_VIEW_INSET.y * this.dpr + plan.sy * this.dpr,
      plan.sw * this.dpr,
      plan.sh * this.dpr,
      plan.dx,
      plan.dy,
      plan.dw,
      plan.dh,
    );
  }

  /**
   * 合成读数（只读探针 / E2E 用）：安全区、目标带、以及**实际使用的 X/Y 缩放系数**。
   * `scaleX` 与 `scaleY` 必须恒等 —— 这是「比例不失真」的可断言事实。
   */
  compositeProbe(band: RunRect = RUN_STAGE_BAND, mode: 'contain' | 'cover' = 'contain'): {
    readonly safe: { readonly w: number; readonly h: number };
    readonly band: { readonly w: number; readonly h: number };
    readonly scaleX: number;
    readonly scaleY: number;
  } {
    const safe = this.safeAreaSize();
    const plan = planBattleBlit(safe, band, mode);
    return {
      safe: { w: safe.w, h: safe.h },
      band: { w: band.w, h: band.h },
      scaleX: plan.dw / plan.sw,
      scaleY: plan.dh / plan.sh,
    };
  }

  /**
   * DEMO-HEIGHT-LINE-READABILITY-R2｜**近景裁切合成**：把离屏画面的一个子矩形
   * （`src`，离屏画布**逻辑**坐标）放大/缩放到目标矩形（`dst`，页面逻辑坐标）。
   *
   * ⚠️ 它仍然只是**合成**：不写任何 `renderer.*` 状态、不自己算镜头、不新增相机。
   *    子矩形由调用方用只读读数（`viewTransform()` + `vehicleBox()`）算出 ——
   *    画出来的仍是正式相机渲染的同一批像素。
   */
  blitRegion(ctx: CanvasRenderingContext2D, src: RunRect, dst: RunRect): void {
    ctx.drawImage(
      this.canvas,
      src.x * this.dpr,
      src.y * this.dpr,
      src.w * this.dpr,
      src.h * this.dpr,
      dst.x,
      dst.y,
      dst.w,
      dst.h,
    );
  }

  /** 离屏视口逻辑尺寸（= 「舞台带 + 正式 inset」× `viewportScale`）。 */
  viewportSize(): { readonly w: number; readonly h: number } {
    return { w: this.viewportW(), h: this.viewportH() };
  }

  /**
   * 正式安全区逻辑尺寸（= 视口 − 两侧正式 inset）。
   * 默认口径下恒等于舞台带（390×302）；显式传入 `safeArea` 时等于该尺寸 × `viewportScale`
   * （竖屏冒险用 390×648 —— 合成时 X/Y 同一 scale，不需要把矮安全区拉高）。
   */
  safeAreaSize(): { readonly w: number; readonly h: number } {
    return {
      w: this.viewportW() - RUN_BATTLE_VIEW_INSET.x * 2,
      h: this.viewportH() - RUN_BATTLE_VIEW_INSET.y * 2,
    };
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

  /** 离屏视口逻辑宽 = 「安全区 + 正式 inset」× 放大倍数。 */
  private viewportW(): number {
    // 缺省口径：与历史实现逐字相同（既有四个 Lab 页面零回归）
    if (!this.safeOverride) return Math.round(RUN_BATTLE_VIEW_W * this.viewportScale);
    return Math.round(this.safeW * this.viewportScale + RUN_BATTLE_VIEW_INSET.x * 2);
  }

  /** 离屏视口逻辑高 = 「安全区 + 正式 inset」× 放大倍数。 */
  private viewportH(): number {
    if (!this.safeOverride) return Math.round(RUN_BATTLE_VIEW_H * this.viewportScale);
    return Math.round(this.safeH * this.viewportScale + RUN_BATTLE_VIEW_INSET.y * 2);
  }

  /** 宿主注册「资源就绪 → 重绘」回调（构造早于宿主字段就绪，故不能只靠构造参数）。 */
  onAssetsReady(cb: () => void): void {
    this.onAssetReadyCb = cb;
  }

  /** 同步画布 backing 尺寸；返回是否发生了尺寸变化（变化会清空画布 → 冻结帧必须重画）。 */
  private applySize(): boolean {
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    this.dpr = dpr;
    if (this.surface) this.surface.devicePixelRatio = dpr; // DPR 变化 → 与 backing 保持同一域
    const w = Math.round(this.viewportW() * dpr);
    const h = Math.round(this.viewportH() * dpr);
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
