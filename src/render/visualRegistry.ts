/**
 * Visual Registry（W2-VIS-1）：visualId → image asset / texture metadata。
 *
 * - 只存视觉资源元数据与加载后的 image 引用；Physics / Content Def 完全不知道本模块
 *   （图片资源不进入 VisualDef / collider，不参与物理）；
 * - 缺资源 / 未加载完成 → isReady()=false，Renderer 安全回退 collider graybox
 *   （不白屏、不报错）；
 * - 首版：单张图片（src → HTMLImageElement 懒加载，加载完成由外部注入 setImage）；
 *   暂不做 Sprite Atlas 自动打包 / 骨骼动画。
 *
 * image 用最小结构接口（{ width, height }）而非强制 HTMLImageElement，便于
 * node 测试注入 fake、也兼容任何 ImageBitmap / canvas 源。
 */
export interface VisualImageLike {
  width: number;
  height: number;
}

/** 视觉资源元数据（注册信息；图片加载状态独立维护） */
export interface VisualAssetMeta {
  visualId: string;
  /** 图片源（public 相对路径或任意 URL） */
  src: string;
}

export class VisualRegistry {
  private readonly metas = new Map<string, VisualAssetMeta>();
  private readonly images = new Map<string, VisualImageLike | null>();

  /** 注册 visualId → 资源元数据（不加载图片；图片由外部加载器 setImage 注入） */
  register(visualId: string, src: string): void {
    this.metas.set(visualId, { visualId, src });
    if (!this.images.has(visualId)) this.images.set(visualId, null);
  }

  has(visualId: string): boolean {
    return this.metas.has(visualId);
  }

  getMeta(visualId: string): VisualAssetMeta | undefined {
    return this.metas.get(visualId);
  }

  /** 外部加载完成注入（main.ts 用 new Image() + onload；测试注入 fake） */
  setImage(visualId: string, image: VisualImageLike): void {
    if (!this.metas.has(visualId)) {
      throw new Error(`VisualRegistry: 未注册的 visualId "${visualId}" 不能注入图片`);
    }
    this.images.set(visualId, image);
  }

  /** 已加载的图片（未注册 / 未加载 → null） */
  getImage(visualId: string): VisualImageLike | null {
    return this.images.get(visualId) ?? null;
  }

  /** 可绘制性：已注册且图片已加载且尺寸有效（否则 Renderer 回退灰盒） */
  isReady(visualId: string): boolean {
    const img = this.images.get(visualId);
    return !!img && img.width > 0 && img.height > 0;
  }
}
