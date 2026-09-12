/**
 * PRP-F1-PORTRAIT-PLANCK-BATTLE-INTEGRATION｜Run Page 的战斗视图宿主（**只做 camera / clip / 合成**）。
 *
 * 架构（与 Queue 必改 4 逐条对应）：
 *
 *   ┌ 正式 Planck 战斗世界（1600×900，spawn 400/1200）   ← RunBattleRuntime（正式 Orchestrator）
 *   │        ↓ getRenderSnapshot()（引擎中立只读快照）
 *   │ 正式 Renderer（**原样复用，零修改**）              ← 只画：天空 / 看台 / 平台 / 墙 /
 *   │                                                    刺墙 / 车 / 轮 / 部件 / 弹丸 / 喷焰
 *   │        ↓ 固定远摄相机 transform（本文件设置一次）
 *   │ 离屏 canvas 390×302（= 舞台带尺寸）                ← clip 由「画布即带」结构性保证
 *   └        ↓ drawImage（9 参数，1:1 贴到舞台带）        ← 本文件唯一的合成动作
 *
 * 为什么这样接（而不是让 PRP 自己画战斗）：
 *   1) 画战斗 = 战斗表现的**第二套实现**，与 Queue「优先删除/收缩 PRP-local gameplay 逻辑、
 *      PRP 只负责 Camera / Clip / UI 容器适配」相冲突；
 *   2) 复用正式 Renderer 后，PRP 屏幕上出现的正是正式战斗的同一批像素
 *      （看台 / 刺墙 / 锯齿轮廓 / 弹丸 / 伤害数字 / 死亡定格），不存在观感漂移；
 *   3) 正式 Renderer 是**只读**复用：本文件不修改它的任何一行。
 *
 * ⚠️ 固定取景纪律（Queue 必改 3）：**绝不调用 `renderer.reframe(snap, 'battle')`**。
 *   正式 battle 相机会在 reframe 后启用逐帧 `applyBattleFollow`（跟随双方中点 + ≤12% 分离拉远），
 *   那是「智能追踪 / 动态 zoom」。这里改为直接写 `renderer.transform`（固定远摄，只算一次），
 *   `battleCam` 恒为 null → `applyBattleFollow` 每帧直接 return → 镜头在整个战斗中一动不动。
 *
 * ⚠️ 事件表现（炮口闪光 / 伤害数字 / 命中闪白 / 死亡 FX）复用**正式表现唯一入口**
 *   `createPlayerPresentation`，不自己实现第二套 VFX。
 */

import { Renderer } from '../../render/renderer';
import { VisualRegistry } from '../../render/visualRegistry';
import { SfxAudioService } from '../../presentation/audioService';
import { createPlayerPresentation } from '../../presentation/playerPresentation';
import { RUN_STAGE_BAND, type RunRect } from './runPageLayout';
import { runBattleCamera, type RunBattleCamera, type RunBattleRuntime } from './runBattleRuntime';
import { RUN_VISUAL_ASSETS } from './runVehicleAssets';

export interface RunBattleViewAssetStats {
  readonly registered: number;
  readonly ready: number;
  readonly failed: readonly string[];
}

/**
 * 战斗视图宿主。
 *
 * 生命周期：`new RunBattleView()` → `loadAssets()`（异步）→ 每次要显示时 `render(runtime)` +
 * `blit(ctx, band)`。离屏画布尺寸恒为舞台带尺寸（390×302，再乘 DPR）——「clip」不是一次
 * 裁剪调用，而是**画布即带**这个结构性事实：战斗世界永远不可能画出舞台带之外。
 */
export class RunBattleView {
  private readonly canvas: HTMLCanvasElement;
  private readonly registry = new VisualRegistry();
  private readonly renderer: Renderer;
  private readonly presentation;
  private readonly camera: RunBattleCamera;
  private readonly urls = new Map<string, string>();
  private readonly failed = new Set<string>();
  /** 已绑定表现事件源的运行时实例（同一实例不重复绑定；换实例才重新绑定）。 */
  private boundTo: RunBattleRuntime | null = null;
  /** 资源每次加载完成 → 宿主重绘（构造早于宿主字段就绪，故由宿主动态注册）。 */
  private onAssetReadyCb: (() => void) | null = null;
  private ready = 0;
  private dpr = 1;

  constructor(doc: Document = document) {
    this.camera = runBattleCamera(RUN_STAGE_BAND.w, RUN_STAGE_BAND.h);
    this.canvas = doc.createElement('canvas');
    this.dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    this.applySize();
    // 注入 surface：Renderer 的 view 域 = 本离屏视口（390×302），与页面 DOM 尺寸解耦。
    this.renderer = new Renderer(this.canvas, this.registry, {
      width: this.camera.viewW,
      height: this.camera.viewH,
      devicePixelRatio: this.dpr,
      now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    });
    this.renderer.setBattleBackdrop(true);
    this.applyCamera();
    this.presentation = createPlayerPresentation(this.renderer, new SfxAudioService());
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

  getCamera(): RunBattleCamera {
    return this.camera;
  }

  /** 每帧（或每次画面变化）绘制一次：真实战斗快照 → 离屏画布。 */
  render(runtime: RunBattleRuntime): void {
    this.applySize();
    this.applyCamera();
    // 事件表现：正式唯一入口。⚠️ 只在**事件源换实例**时重新绑定（bind 内部先 stop 再订阅）
    if (this.boundTo !== runtime) {
      this.boundTo = runtime;
      this.presentation.bind({ onEvent: (cb) => runtime.orchestrator.onCombatEvent(cb) });
    }
    this.renderer.render(runtime.orchestrator);
  }

  /** 把离屏战斗画面 1:1 贴到目标画布的舞台带（唯一的合成动作）。 */
  blit(ctx: CanvasRenderingContext2D, band: RunRect = RUN_STAGE_BAND): void {
    ctx.drawImage(
      this.canvas,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
      band.x,
      band.y,
      band.w,
      band.h,
    );
  }

  dispose(): void {
    this.presentation.stop();
    this.boundTo = null;
  }

  /* --------------------------------------------------------------- 内部 */

  /** 宿主注册「资源就绪 → 重绘」回调（构造早于宿主字段就绪，故不能只靠构造参数）。 */
  onAssetsReady(cb: () => void): void {
    this.onAssetReadyCb = cb;
  }

  private applySize(): void {
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    this.dpr = dpr;
    const w = Math.round(this.camera.viewW * dpr);
    const h = Math.round(this.camera.viewH * dpr);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  /**
   * 固定远摄：只写 transform（不是 reframe）。
   * 结果只由「舞台带宽 + 正式 arena 宽」决定，与车辆实时位置无关。
   */
  private applyCamera(): void {
    this.renderer.transform = {
      scale: this.camera.scale,
      offsetX: this.camera.offsetX,
      offsetY: this.camera.offsetY,
    };
  }
}
