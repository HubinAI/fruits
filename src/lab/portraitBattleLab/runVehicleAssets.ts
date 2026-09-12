/**
 * PRP-R3-CAPYBARA-UI-HIERARCHY-REBUILD｜Run Page 的真实车辆视觉资源（Lab-local）。
 *
 * 为什么需要本文件：
 *   Queue 必改 2 要求「停止使用纯色矩形作为正式体验占位」，并**优先复用现有正式车辆
 *   Renderer / Garage vehicle preview 中最小可复用的真实车辆视觉**。
 *
 * 复用面（**只读**，不改动任何正式模块）：
 *   1) 资源本身：正式 `assets/visuals/*.png`（与正式入口 `src/main.ts` 引用的是**同一批文件**，
 *      single source of truth = PNG 文件本体，不存在第二套美术）；
 *   2) 视觉定义：正式 `BodyDef.visual` / `WheelDef.visual` / `FunctionalPartDef.visual`
 *      （`visualId` + `size` + `anchor` + `rotation` + `mirrorWithFacing`）；
 *   3) 世界变换：正式纯函数 `visualWorldTransform`（`src/battle/battleContract.ts`，双引擎共享）。
 *
 * 因此「画出来的车」与正式战斗里的是同一套外形 + 同一套 anchor/镜像语义。
 *
 * 明确不复用（并说明为什么）：
 *   - 正式 `Renderer`（3367 行、强耦合 camera / battleSnapshot / backdrop / 特效池）：
 *     引入它就必须引入整个战斗快照与镜头系统，属「大规模修改正式模块」→ 按 Queue
 *     停止条件不做。这里只保留「把 sprite 按 RenderVisual 的 transform 画到 canvas 上」
 *     这一条最小胶水（与 `Renderer.drawVisual` 的 transform 约定一致：
 *     translate(position) · scale(-1,1)[mirror] · rotate(rotation)，以中心为原点绘制）。
 *
 * ⚠️ 资源缺失 / 未加载完成时**不白屏、不报错**：降级为按真实几何轮廓的纯色矩形
 *   （probe 会如实报出 `spritesReady=false`，不伪造「已用真实车辆视觉」）。
 */

import bodyWatermelonUrl from '../../../assets/visuals/body_watermelon.png';
import bodyBananaUrl from '../../../assets/visuals/body_banana.png';
import partCannonUrl from '../../../assets/visuals/part_cannon.png';
import partHammerUrl from '../../../assets/visuals/part_hammer.png';
import partPushRodUrl from '../../../assets/visuals/part_pushRod.png';

/** 正式 visualId → 正式资源 URL（与 src/main.ts 的注册表同源同文件）。 */
export const RUN_VISUAL_ASSETS: Readonly<Record<string, string>> = {
  body_watermelon: bodyWatermelonUrl,
  body_banana: bodyBananaUrl,
  part_cannon: partCannonUrl,
  part_hammer: partHammerUrl,
  part_pushRod: partPushRodUrl,
};

/** 可绘制的最小结构（与正式 `VisualImageLike` 同形；避免 import render/ 目录）。 */
export interface RunVisualImage {
  readonly width: number;
  readonly height: number;
}

export interface RunAssetStats {
  /** 已注册的 visualId 数量。 */
  readonly registered: number;
  /** 已完成加载、可绘制（尺寸 > 0）的 visualId 数量。 */
  readonly ready: number;
  /** 加载失败的 visualId。 */
  readonly failed: readonly string[];
}

/**
 * Lab-local 的最小 sprite 表（不引入正式 `render/visualRegistry`：
 * 该模块位于 Lab 明确隔离的 `render/` 目录内，且这里只需要「id → 可绘制源」一张表）。
 */
export class RunVisualStore {
  private readonly urls = new Map<string, string>();
  private readonly images = new Map<string, CanvasImageSource & RunVisualImage>();
  private readonly failed = new Set<string>();

  /** 注册 + 异步加载全部正式车辆资源；`onReady` 在每次加载完成后回调（供重绘）。 */
  loadAll(onReady?: () => void, doc: Document = document): RunAssetStats {
    for (const [visualId, url] of Object.entries(RUN_VISUAL_ASSETS)) {
      this.urls.set(visualId, url);
      const img = new Image();
      img.onload = () => {
        if (img.width > 0 && img.height > 0) this.images.set(visualId, img);
        else this.failed.add(visualId);
        onReady?.();
      };
      img.onerror = () => {
        this.failed.add(visualId);
        onReady?.();
      };
      img.src = url;
      void doc;
    }
    return this.stats();
  }

  get(visualId: string): (CanvasImageSource & RunVisualImage) | undefined {
    return this.images.get(visualId);
  }

  has(visualId: string): boolean {
    return this.images.has(visualId);
  }

  stats(): RunAssetStats {
    return {
      registered: this.urls.size,
      ready: this.images.size,
      failed: [...this.failed].sort(),
    };
  }
}
