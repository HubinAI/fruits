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
 * FRUITS-ADVENTURE-CAMERA-STABILITY-F6｜冒险合成镜头**一帧解算结果**（只读读数）。
 *
 * `zoom` = 本帧真正用于合成的倍数（距离约束目标 → 时间平滑 → 主体可容纳上限，三步的结果）；
 * `targetZoom` = 距离约束给出的目标（未平滑），用于把「平滑滞后」和「目标本身在动」分开看。
 */
export interface AdvCameraFrame {
  /** 本帧实际合成倍数（与 `blitAdventureCamera` 的裁切矩形严格自洽）。 */
  readonly zoom: number;
  /** 距离约束目标（未平滑；`min(fit, maxZoom)`，fit<1 时为 1）。 */
  readonly targetZoom: number;
  /** 本帧实际裁切矩形（安全区逻辑坐标）。 */
  readonly cropSafe: RunRect;
  /** 关键主体矩形（双车并集 + padding，安全区坐标）。 */
  readonly subjectSafe: RunRect;
  /** 地面线在安全区坐标里的 y（纵向锚点；由正式相机 transform 与 `rt.groundY` 只读换算）。 */
  readonly groundSafeY: number;
  /** 双车世界中心间距。 */
  readonly gapWorld: number;
}

/** 数值区间钳制（`lo > hi` 时返回 `lo`，避免 NaN / 反向区间）。 */
function advClamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** F6｜单帧 dt 上限（ms）：切后台 / 掉帧回来时最多只推进 50ms 的镜头平滑。 */
const ADV_CAMERA_DT_MAX_MS = 50;

/**
 * F6｜**一阶时间平滑**（指数趋近 + 速率上限），帧率无关。
 *
 * 为什么两件套都要：
 *  - 指数趋近（时间常数 `tauMs`）⇒ 目标突变时输出是**连续斜坡**而不是瞬间跳变；
 *  - 速率上限（`ratePerSec`）⇒ 即便某帧 dt 很大或目标一次变很多，单帧位移也被钳住；
 *  - 死区 `eps` ⇒ 目标不再变化后**精确落到目标**，不留下永久亚像素偏移（避免长期漂移）。
 * ⚠️ `dtMs` 被钳到 `[0, ADV_DT_MAX_MS]`：切后台/掉帧回来不会把镜头一次性甩到目标。
 */
function advEase(cur: number, target: number, dtMs: number, tauMs: number, ratePerSec: number, eps: number): number {
  const d = target - cur;
  if (Math.abs(d) <= eps) return target;
  const t = Math.max(0, Math.min(ADV_CAMERA_DT_MAX_MS, dtMs)) / 1000;
  if (t <= 0) return cur;
  const step = d * (1 - Math.exp((-t * 1000) / tauMs));
  const cap = ratePerSec * t;
  return cur + (Math.abs(step) > cap ? Math.sign(step) * cap : step);
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
  /* ---- F6：冒险合成镜头的时间平滑状态（只有 2 个标量 + 2 个只读快照，不是状态机） ---- */
  /** 上一帧实际使用的合成倍数（平滑状态）。 */
  private advZoom = 1;
  /** 上一帧裁切窗的水平中心（安全区坐标；平滑状态）。 */
  private advCenterX = 0;
  /** 平滑状态是否已初始化（false ⇒ 本帧直接落到目标，避免跨场景滑动）。 */
  private advReady = false;
  /** 本帧解算结果（探针 / 绘制共用同一份，保证「读数 == 画面」）。 */
  private advFrame: AdvCameraFrame | null = null;
  /** 最后一次战斗帧的取景（RESULT 沿用；换战斗实例时清空）。 */
  private advHold: AdvCameraFrame | null = null;
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
      // 换战斗实例：重置相机接线状态（阶段记忆 / 冻结帧 / 表现绑定 / F6 合成镜头平滑）
      this.lastPhase = null;
      this.frozenFrame = false;
      this.resetAdventureCamera();
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

  /**
   * D2 诊断专用（**隔离实验，不进入正式主线**，默认不被调用）：
   * 把离屏画面的「主体子矩形」—— 水平居中、底部加权（围绕贴地双车）—— 放大 `zoom` 倍
   * 等比贴满目标带，从而**在不改动正式相机 / 物理 / 碰撞** 的前提下放大战斗主体、提高可读性。
   *
   * ⚠️ 纯合成：不写任何 `renderer.*`、不改 `reframe` / `applyBattleFollow` / 世界坐标 / 镜头规则。
   *    只裁掉四周多余天空/地面并把主体区域等比放大，X/Y 用同一 scale（`blitRegion` 同源）。
   * ⚠️ 调用方（冒险页）只在 `?d2zoom=` 诊断查询参数存在且 >1 时才调用本方法；正式玩法、首页、
   *    车库、以及所有无该参数的入口，行为与此前逐像素一致（本方法永不被触发）。
   */
  blitSubject(ctx: CanvasRenderingContext2D, band: RunRect, zoom = 1.6): void {
    const z = Number.isFinite(zoom) && zoom > 1 ? zoom : 1;
    if (z <= 1) {
      this.blit(ctx, band);
      return;
    }
    const safe = this.safeAreaSize();
    // 更小源区域 = 放大：水平居中（双车中点≈画面中），底部加权（车辆贴地，占下 1/z）。
    const sw = safe.w / z;
    const sh = safe.h / z;
    const sx = (safe.w - sw) / 2;
    const sy = safe.h - sh;
    this.blitRegion(ctx, { x: RUN_BATTLE_VIEW_INSET.x + sx, y: RUN_BATTLE_VIEW_INSET.y + sy, w: sw, h: sh }, band);
  }

  /**
   * FRUITS-ADVENTURE-CAMERA-F4 → **F6 稳定化**｜冒险专用自适应镜头的取景参数（纯合成，只读推理）。
   *
   * F4 的距离约束（保留）：
   *   ① 取「双车世界包围盒并集 + 外扩 padding」作为关键主体矩形，映射到安全区逻辑坐标；
   *   ② 求能刚好框住该主体的放大倍数 `fit = min(safe.w/subjW, safe.h/subjH)`；
   *   ③ zoom 目标 = `clamp(fit, 1, maxZoom)` ⇒ 交战/接近自动放大到上限，远距/击飞自动收敛，
   *      fit<1（主体比安全区还宽，正式相机已经把双车框满）⇒ 封底 1 = 原取景；
   *   ④ 裁切矩形恒包含双车（`zoom ≤ fit` ⇒ 主体宽度 ≤ 裁切宽度，且主体框本身已含 padding）。
   *
   * F6 修正（连续帧诊断 P0 的三条硬伤）：
   *   ① **缩放加时间平滑**（`advEase`）：P0 实测旧实现单帧 `z 1.000 → 1.110`（16ms）——那是
   *      「增益门限 1.1」把连续映射切成两段造成的**阶跃**。F6 去掉这道阈值，改为
   *      「连续目标 + 一阶平滑 + 速率上限」⇒ 同一处穿越变成 ~0.13s 的斜坡（单帧 ≤ 3%）；
   *   ② **纵向只认地面线**（`groundSafeY` 由正式相机 transform 与 `rt.groundY` 只读换算）：
   *      `cy = groundSafeY × (1 − 1/zoom)` ⇒ 地面线在屏幕上的相对高度**与 zoom 无关地固定**，
   *      战车上下颠簸 / 被击飞时取景窗纹丝不动（P0 实测旧实现单帧 cy 跳变 64–68px）；
   *      只有主体真要出框时才让位（`ch ≥ subj.h` 时的可见性兜底），不做逐帧 Y 跟随；
   *   ③ **横向加时间平滑**（同样 `advEase`），并保留「裁切矩形恒包含双车」的硬约束
   *      ⇒ 平移有轻微跟随延迟（镜头惯性），但任何一帧都不会把车切出框。
   *
   * ⚠️ 纯合成：不写 `renderer.*`、不改 `reframe` / `applyBattleFollow` / 世界坐标 / 物理 /
   *    碰撞 / 镜头规则；画出来的仍是正式相机渲染的同一批像素。
   */
  private static readonly ADV_SUBJECT_PAD = 0.06; // 主体外扩比例（每侧），给命中 FX 留呼吸位
  private static readonly ADV_SUBJECT_PAD_MIN = 8; // 最小外扩（逻辑 px）；vehicleWorldBox 已含全部可见部件
  /** F6｜缩放平滑时间常数（ms）：目标突变时 ~0.13s 走完 63%。 */
  private static readonly ADV_ZOOM_TAU_MS = 130;
  /** F6｜横向平移平滑时间常数（ms）：略慢于缩放，接近真实镜头的跟随惯性。 */
  private static readonly ADV_PAN_TAU_MS = 170;
  /** F6｜缩放速率上限（单位/秒）：兜住大 dt / 目标一次变很多时的单帧位移。 */
  private static readonly ADV_ZOOM_RATE = 2.2;
  /** F6｜横向平移速率上限（安全区 px/秒）：只在极端位移时才夹到，正常跟随由时间常数主导。 */
  private static readonly ADV_PAN_RATE = 1500;
  /** F6｜缩放死区：进入死区即精确落到目标，避免永久残留亚像素偏移。 */
  private static readonly ADV_ZOOM_EPS = 0.0015;
  /** F6｜平移死区（安全区 px）。 */
  private static readonly ADV_PAN_EPS = 0.3;
  /** F6｜zoom 小于它时直接走原取景（`blit`），保证「无放大时的像素与历史完全一致」。 */
  private static readonly ADV_BLIT_EPS = 1.002;

  /**
   * 把「玩家车 + 敌车」的世界包围盒并集（`core`）与「并集 + padding」（`padded`）同时映射到
   * **安全区逻辑坐标**（原点 = 安全区左上，等于离屏画布左上 − 正式 inset）。返回 null = 无战斗实体。
   *
   * ⚠️ F6 为什么需要两个矩形：
   *   - `padded` 决定**放大倍数**（F4 既有口径：给命中 FX 与时间平滑都留呼吸位）；
   *   - `core`（不含 padding）决定**「车不被切掉」的硬约束边界**。
   *     两者之差就是横向平滑可以使用的**合法滞后余量**（6% + 8px）——
   *     没有这块余量时，`zoom == fit` 会把「裁切窗 == 主体框」钉死，横向就没有任何平滑空间了。
   */
  private subjectRects(rt: RunBattleRuntime): { readonly core: RunRect; readonly padded: RunRect } | null {
    const a = rt.vehicleBox('A');
    const b = rt.vehicleBox('B');
    if (!a || !b) return null;
    const t = this.viewTransform();
    const toSafe = (wx: number, wy: number) => ({
      x: wx * t.scale + t.offsetX - t.cropX,
      y: wy * t.scale + t.offsetY - t.cropY,
    });
    const pts = [
      toSafe(a.minX, a.minY), toSafe(a.maxX, a.minY), toSafe(a.minX, a.maxY), toSafe(a.maxX, a.maxY),
      toSafe(b.minX, b.minY), toSafe(b.maxX, b.minY), toSafe(b.minX, b.maxY), toSafe(b.maxX, b.maxY),
    ];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX) || maxX - minX <= 0 || maxY - minY <= 0) return null;
    const padX = (maxX - minX) * RunBattleView.ADV_SUBJECT_PAD + RunBattleView.ADV_SUBJECT_PAD_MIN;
    const padY = (maxY - minY) * RunBattleView.ADV_SUBJECT_PAD + RunBattleView.ADV_SUBJECT_PAD_MIN;
    return {
      core: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
      padded: { x: minX - padX, y: minY - padY, w: maxX - minX + padX * 2, h: maxY - minY + padY * 2 },
    };
  }

  /**
   * 把「玩家车 + 敌车」的世界包围盒并集，外加 padding，映射到**安全区逻辑坐标**。
   * 返回 null 表示无战斗实体。（F4 公开口径；F6 内部同时需要 `core`，见 `subjectRects`。）
   */
  subjectSafeRect(rt: RunBattleRuntime): RunRect | null {
    return this.subjectRects(rt)?.padded ?? null;
  }

  /**
   * F4/F6：距离约束的**目标**放大倍数（纯函数，无状态、不含时间平滑）。
   *
   * `fit = min(safe.w/subjW, safe.h/subjH)`，再 `clamp(fit, 1, maxZoom)`。
   * ⚠️ F6 起这里**不再有 1.1 最小增益门限**：那道阈值是「单帧 1.000→1.110」阶跃的唯一来源；
   *    连续映射 + 下游时间平滑才是「不跳变」的正确做法（微裁在该带内是渐进出现的，不刺眼）。
   */
  advCompositeZoom(rt: RunBattleRuntime, maxZoom = 1.6): number {
    const subj = this.subjectSafeRect(rt);
    if (!subj) return 1;
    const safe = this.safeAreaSize();
    const fit = Math.min(safe.w / subj.w, safe.h / subj.h);
    return advClamp(Math.min(maxZoom, fit), 1, maxZoom);
  }

  /**
   * FRUITS-ADVENTURE-CAMERA-STABILITY-F6｜**推进一帧合成镜头**（每帧一次，唯一状态更新入口）。
   *
   * 三段式（对应 Queue 必改 1/2，**不引入状态机**：只有 `zoom` 与 `centerX` 两个标量）：
   *   ① 目标：`targetZoom = clamp(fit,1,maxZoom)`；水平目标 = 主体中心（钳制在安全区与「含双车」区间内）；
   *   ② 平滑：`advEase`（时间常数 + 速率上限 + 死区），缩放/平移各自一条；
   *   ③ 保底：`zoom ≤ fit` 与 `crop ⊇ 双车` 是**硬约束**，平滑只能让镜头「慢一点跟上」，
   *      绝不允许把关键主体切出框（`fit` 本身来自带 padding 的主体框，因此保底后仍留 ≥6% 余量）。
   *
   * 纵向**不做平滑也不用主体 Y**：`cy = groundSafeY × (1 − 1/zoom)` —— 地面线在屏幕上的
   * 相对高度与 zoom 无关，击飞/颠簸不会带动取景窗（Queue 必改 2「纵向保持地面锚定」）。
   *
   * @param dtMs 距上一帧的真实毫秒（调用方给；缺省按 60fps）。内部钳到 [0, 50]。
   * @returns 本帧解算结果；无战斗实体时 null（调用方退化为原取景）。
   */
  updateAdventureCamera(rt: RunBattleRuntime, maxZoom = 1.6, dtMs = 1000 / 60): AdvCameraFrame | null {
    const rects = this.subjectRects(rt);
    const safe = this.safeAreaSize();
    if (!rects || safe.w <= 0 || safe.h <= 0) {
      this.advFrame = null;
      this.advReady = false;
      return null;
    }
    const subj = rects.padded;
    const core = rects.core;
    const t = this.viewTransform();
    const groundSafeY = rt.groundY * t.scale + t.offsetY - t.cropY;
    const ga = rt.vehicleBox('A');
    const gb = rt.vehicleBox('B');
    const gapWorld = Math.hypot(
      (gb.minX + gb.maxX) / 2 - (ga.minX + ga.maxX) / 2,
      (gb.minY + gb.maxY) / 2 - (ga.minY + ga.maxY) / 2,
    );

    // ① 目标（距离约束）
    const fit = Math.min(safe.w / subj.w, safe.h / subj.h);
    const targetZoom = advClamp(Math.min(maxZoom, fit), 1, maxZoom);

    // ② 平滑 + ③ 保底（zoom ≤ fit 是硬上限 ⇒ 裁切矩形必含主体框）
    let zoom = this.advReady
      ? advEase(this.advZoom, targetZoom, dtMs, RunBattleView.ADV_ZOOM_TAU_MS, RunBattleView.ADV_ZOOM_RATE, RunBattleView.ADV_ZOOM_EPS)
      : targetZoom;
    zoom = advClamp(Math.min(zoom, fit), 1, maxZoom);
    const cw = safe.w / zoom;
    const ch = safe.h / zoom;

    // 水平：目标 = 主体中心；硬约束 = 裁切窗须含 `core`（不含 padding 的双车并集）。
    // padding 那点余量正是平滑允许的滞后空间 —— 既保住「车不被切」，又不把镜头钉成硬跟。
    const cxTarget = advClamp(
      subj.x + subj.w / 2,
      Math.min(cw / 2, safe.w / 2),
      Math.max(safe.w - cw / 2, cw / 2),
    );
    let centerX = this.advReady
      ? advEase(this.advCenterX, cxTarget, dtMs, RunBattleView.ADV_PAN_TAU_MS, RunBattleView.ADV_PAN_RATE, RunBattleView.ADV_PAN_EPS)
      : cxTarget;
    const cxSafeLo = cw / 2;
    const cxSafeHi = Math.max(safe.w - cw / 2, cxSafeLo);
    const cxCoreLo = core.x + core.w - cw / 2; // 含 core 右边缘所需的最小中心
    const cxCoreHi = core.x + cw / 2; // 含 core 左边缘所需的最大中心
    const cxLo = Math.max(cxSafeLo, cxCoreLo);
    const cxHi = Math.min(cxSafeHi, cxCoreHi);
    // 可行区间为空（主体比裁切窗宽 / 部分出安全区）⇒ 以主体中心为准（可见性优先），
    // 不再退化到「安全区区间」——那会让平滑滞后直接把车推出框。
    centerX = cxLo <= cxHi ? advClamp(centerX, cxLo, cxHi) : subj.x + subj.w / 2;
    const cropX = advClamp(centerX - cw / 2, 0, Math.max(0, safe.w - cw));

    // 纵向：地面线锚定（与 zoom 无关的固定屏幕高度），仅在主体真要出框时让位
    const ground = advClamp(groundSafeY, 0, safe.h);
    let cropY = advClamp(ground * (1 - 1 / zoom), 0, Math.max(0, safe.h - ch));
    if (ch >= core.h) {
      const yLo = Math.max(0, core.y + core.h - ch);
      const yHi = Math.min(Math.max(0, safe.h - ch), core.y);
      if (yLo <= yHi) cropY = advClamp(cropY, yLo, yHi);
    }

    // 状态写回（deadband 命中时精确落位，避免长期亚像素漂移）
    this.advZoom = zoom;
    this.advCenterX = centerX;
    this.advReady = true;

    const frame: AdvCameraFrame = {
      zoom,
      targetZoom,
      cropSafe: { x: cropX, y: cropY, w: cw, h: ch },
      subjectSafe: subj,
      groundSafeY: ground,
      gapWorld,
    };
    this.advFrame = frame;
    this.advHold = frame; // RESULT 沿用「最后一次战斗取景」（必改 3）
    return frame;
  }

  /** F6：本帧战斗取景读数（只读；E2E / 探针用）。null = 本场战斗还没有过解算。 */
  adventureCameraFrame(): AdvCameraFrame | null {
    return this.advFrame;
  }

  /** F6：战斗→RESULT 沿用的「最后稳定取景」（null = 无战斗帧 ⇒ 调用方退回 `blitCover`）。 */
  adventureCameraHold(): AdvCameraFrame | null {
    return this.advHold;
  }

  /** F6：换战斗实例时清空平滑状态（下一场从目标值直接起步，不做跨场镜头滑动）。 */
  resetAdventureCamera(): void {
    this.advZoom = 1;
    this.advCenterX = this.safeAreaSize().w / 2;
    this.advReady = false;
    this.advFrame = null;
    this.advHold = null;
  }

  /**
   * FRUITS-ADVENTURE-CAMERA-F4/F6｜冒险专用**自适应镜头**合成（默认启用，仅冒险原型）。
   *
   * 画的是 `updateAdventureCamera` 本帧解算出的裁切矩形（`zoom ≤ 1.002` 时退化为 `blit`，
   * 与无 F4 的原取景逐像素一致）。⚠️ 必须先 `updateAdventureCamera` 再调用本方法；
   * 没有解算结果时安全退化为原取景。
   */
  blitAdventureCamera(ctx: CanvasRenderingContext2D, band: RunRect): void {
    const f = this.advFrame;
    if (!f || f.zoom <= RunBattleView.ADV_BLIT_EPS) {
      this.blit(ctx, band);
      return;
    }
    const c = f.cropSafe;
    this.blitRegion(
      ctx,
      { x: RUN_BATTLE_VIEW_INSET.x + c.x, y: RUN_BATTLE_VIEW_INSET.y + c.y, w: c.w, h: c.h },
      band,
    );
  }

  /**
   * FRUITS-ADVENTURE-CAMERA-STABILITY-F6（必改 3）｜**RESULT 沿用最后稳定取景**。
   *
   * 旧实现走 `blitCover`（原比例铺满 390×468）⇒ P0 实测主体屏宽在切换那一帧
   * **缩小 31%–34%**（例：188.0px → 129.5px）。现在：
   *   - 源 = 最后一次战斗帧的裁切矩形（`adventureCameraHold`）⇒ 车辆像素尺寸**与战斗末帧完全相同**；
   *   - 目标带更矮（468 < 648）⇒ 只从上方裁掉一条天空，**不缩放**（`scale = band.w / crop.w`
   *     是唯一 scale，X/Y 恒相同 ⇒ 不拉伸）；
   *   - 纵向仍按同一条**地面锚定**规则落位（地面线在可见窗内的相对高度不变）⇒ 战报里车仍踩在地上。
   * 无战斗帧（如 `?f4off=1` / `?d2zoom=` 对照模式）⇒ 退回历史 `blitCover`，行为逐像素不变。
   */
  blitAdventureHold(ctx: CanvasRenderingContext2D, band: RunRect, focusY = 0.5): void {
    const f = this.advHold;
    if (!f || f.zoom <= RunBattleView.ADV_BLIT_EPS) {
      this.blitCover(ctx, band, focusY);
      return;
    }
    const safe = this.safeAreaSize();
    const c = f.cropSafe;
    const scale = band.w / c.w; // = zoom（band.w == safe.w 时严格相等）
    if (!(scale > 0) || !Number.isFinite(scale)) {
      this.blitCover(ctx, band, focusY);
      return;
    }
    const visH = band.h / scale; // 目标带能容纳的源高度（< c.h ⇒ 只裁纵向）
    if (visH >= c.h) {
      // 目标带比取景窗还高（理论上不会）：交给 cover 处理，仍是单一 scale
      this.blitCover(ctx, band, focusY);
      return;
    }
    const anchor = advClamp(f.groundSafeY / safe.h, 0.35, 0.9);
    const sy = advClamp(f.groundSafeY - anchor * visH, c.y, c.y + c.h - visH);
    this.blitRegion(
      ctx,
      { x: RUN_BATTLE_VIEW_INSET.x + c.x, y: RUN_BATTLE_VIEW_INSET.y + sy, w: c.w, h: visH },
      band,
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
