/**
 * FRUITS-ADVENTURE-UI-R1｜冒险 UI 真实素材加载器（Lab-local，隔离于正式链路）。
 *
 * 素材来源：D:\1020卡皮巴拉\unpacked_1.9.3（Capybara Go! 1.9.3 拆包，卡通暖色圆角），
 *   经 R2 审计确认为风格统一、可直接支撑内部原型的唯一来源（见 docs/adventure-ui-audit-r2/README.md）。
 *
 * 合规约束（Queue 禁止项）：
 *   - 第三方拆包素材**仅用于本地内部验证**，已复制到工程 `public/adventure-ui/`（见 .gitignore，
 *     该目录不入库、不随公开发布包）；运行时**绝不依赖 D 盘绝对路径**（全部经站点相对 URL 加载）。
 *   - 公网 clone 缺少该目录时，img.onerror → 资源缺失 → 调用方**降级为过程式 Canvas 绘制**，
 *     构建不失败、运行不白屏（与 runVehicleAssets 的 fallback 纪律一致）。
 *
 * 加载方式：仿 `runVehicleAssets` 的最小 Image 表 + onReady 回调（每次加载完成触发宿主重绘）。
 * 资源路径相对文档基址（adventure.html 同目录下的 `adventure-ui/`），dev / 构建产物
 * （base:'./'）下均可正确解析。
 */

export type AdvUiId =
  | 'battle_bg'
  | 'card_bg'
  | 'chest_close'
  | 'chest_open'
  | 'banner_win'
  | 'banner_lost'
  | 'star'
  | 'score_blue'
  | 'score_red'
  | 'rank_self'
  | 'hp_bar'
  | 'hp_bar_bg';

/** 资源 id → 站点相对 URL（adventure.html 同目录的 adventure-ui/）。 */
const FILES: Readonly<Record<AdvUiId, string>> = {
  battle_bg: 'adventure-ui/battle_bg.png',
  card_bg: 'adventure-ui/card_bg.png',
  chest_close: 'adventure-ui/chest_close.png',
  chest_open: 'adventure-ui/chest_open.png',
  banner_win: 'adventure-ui/banner_win.png',
  banner_lost: 'adventure-ui/banner_lost.png',
  star: 'adventure-ui/star.png',
  score_blue: 'adventure-ui/score_blue.png',
  score_red: 'adventure-ui/score_red.png',
  rank_self: 'adventure-ui/rank_self.png',
  hp_bar: 'adventure-ui/hp_bar.png',
  hp_bar_bg: 'adventure-ui/hp_bar_bg.png',
};

export interface AdvUiStats {
  readonly registered: number;
  readonly ready: number;
  readonly failed: readonly string[];
}

export class AdvUiStore {
  private readonly images = new Map<AdvUiId, HTMLImageElement>();
  private readonly failed = new Set<AdvUiId>();

  /** 异步加载全部注册资源；每次完成（成功/失败）回调 onReady 供重绘。 */
  load(onReady?: () => void): AdvUiStats {
    let pending = Object.keys(FILES).length;
    const done = (): void => {
      pending -= 1;
      onReady?.();
      if (pending <= 0) onReady?.();
    };
    for (const id of Object.keys(FILES) as AdvUiId[]) {
      const img = new Image();
      img.onload = () => {
        if (img.width > 0 && img.height > 0) this.images.set(id, img);
        else this.failed.add(id);
        done();
      };
      img.onerror = () => {
        this.failed.add(id);
        done();
      };
      img.src = FILES[id];
    }
    return this.stats();
  }

  get(id: AdvUiId): HTMLImageElement | undefined {
    return this.images.get(id);
  }

  has(id: AdvUiId): boolean {
    return this.images.has(id);
  }

  /** 资源是否就绪可用（已加载且非失败）。 */
  ready(id: AdvUiId): boolean {
    return this.images.has(id) && !this.failed.has(id);
  }

  stats(): AdvUiStats {
    return {
      registered: Object.keys(FILES).length,
      ready: this.images.size,
      failed: [...this.failed].sort(),
    };
  }
}
