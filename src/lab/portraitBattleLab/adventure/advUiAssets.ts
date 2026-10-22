/**
 * FRUITS-ADVENTURE-UI-R1/R2/R3｜冒险 UI 真实素材加载器（Lab-local，隔离于正式链路）。
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
 *
 * ── R3：语义图标来源与缺口记录 ────────────────────────────────────────────────
 * 全部图标均取自**既有 P0 索引**（`asset_index.json`，15,027 条），逐张**肉眼复核**后采用；
 * 未重新全盘扫描美术目录，未生成任何临时图片。
 *
 *   id                → 源素材（atlasraft / prefab-ui / atlas）         语义
 *   ev_crate          → MagicThreasureBox             神秘货箱（金色宝箱）
 *   ev_wreck          → Icon_Buff_Car                 废车（车辆）
 *   ev_rest           → battlenew_progress_icon_rest  临时修整（绿色十字＝修复）
 *   ev_convoy         → bb_icon_shop                  流浪商队（店铺＝行商）
 *   ev_altar          → richman_magic                 荒野祭坛（水晶球＝神秘/占卜）★
 *   icon_repair       → Icon_Buff_Repair              维修（扳手＋绿十字）
 *   icon_heal         → Icon_Buff_HP_Up               恢复耐久（心形 MAX＋上箭头）
 *   icon_up           → Icon_Buff_Atk_Up              强化 / 伤害提升（锤子＋双箭头）
 *   icon_damage       → Icon_Buff_ShangKou            损耗（染血武器）
 *   icon_trade        → Exchange_Entry_Icon           交易（卷轴＋金币宝石）
 *   icon_none         → bb_tip_icon_check             推进（对勾）
 *   bd_heavy_shell    → Icon_Buff_BaoZhu              重型弹头（红色炮弹）
 *   bd_twin_cannon    → cannon_erlianpao              双联炮（**双管**炮台）
 *   bd_triple_load    → cannon_sanguanpao             三连装填（**三管**炮台）
 *   bd_fast_reload    → cannon_lianshepao             快速装填（连射炮）
 *   bd_kinetic_burst  → Icon_Buff_QianNengBaoFa       动能爆发（爆炸冲击波）
 *   bd_rate_up        → btn_speed_1                   攻击加快（×2 倍率）
 *
 * ★ 已知缺口（**不随意错配**，如实记录）：
 *   1. 荒野祭坛：P0 无「祭坛/神龛/祭祀」图标 → 以水晶球表达「神秘/占卜」近似。
 *   2. 废车搜刮：P0 无「破败车辆」图标 → 以完好车辆图标近似（车辆本体正确，残破感缺失）。
 *   3. 临时修整：P0 无「营地/帐篷/休整」图标 → 以绿色十字（修复）近似。
 *   4. 流浪商队：P0 无「车队/货车」图标 → 以店铺图标（行商/交易）近似。
 *   5. 攻击加快：P0 无「速度箭头」图标 → 以 ×2 倍率图标（速率翻倍）表达。
 *   6. 全部为扁平小图标，非插画；徽章尺寸（约 40px）下细节有限。
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
  | 'hp_bar_bg'
  | 'tab_selected'
  | 'ev_crate'
  | 'ev_wreck'
  | 'ev_rest'
  | 'ev_convoy'
  | 'ev_altar'
  | 'icon_repair'
  | 'icon_heal'
  | 'icon_up'
  | 'icon_damage'
  | 'icon_trade'
  | 'icon_none'
  | 'bd_heavy_shell'
  | 'bd_twin_cannon'
  | 'bd_triple_load'
  | 'bd_fast_reload'
  | 'bd_kinetic_burst'
  | 'bd_rate_up';

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
  tab_selected: 'adventure-ui/tab_selected.png',
  ev_crate: 'adventure-ui/ev_crate.png',
  ev_wreck: 'adventure-ui/ev_wreck.png',
  ev_rest: 'adventure-ui/ev_rest.png',
  ev_convoy: 'adventure-ui/ev_convoy.png',
  ev_altar: 'adventure-ui/ev_altar.png',
  icon_repair: 'adventure-ui/icon_repair.png',
  icon_heal: 'adventure-ui/icon_heal.png',
  icon_up: 'adventure-ui/icon_up.png',
  icon_damage: 'adventure-ui/icon_damage.png',
  icon_trade: 'adventure-ui/icon_trade.png',
  icon_none: 'adventure-ui/icon_none.png',
  bd_heavy_shell: 'adventure-ui/bd_heavy_shell.png',
  bd_twin_cannon: 'adventure-ui/bd_twin_cannon.png',
  bd_triple_load: 'adventure-ui/bd_triple_load.png',
  bd_fast_reload: 'adventure-ui/bd_fast_reload.png',
  bd_kinetic_burst: 'adventure-ui/bd_kinetic_burst.png',
  bd_rate_up: 'adventure-ui/bd_rate_up.png',
};

/* ------------------------------------------------------------------ 语义映射 */

/** 事件类型 → 事件徽章图标（R3：按 P0 既有素材匹配；缺口见文件头记录）。 */
export function advEventIconId(kind: string): AdvUiId {
  switch (kind) {
    case 'crate':
      return 'ev_crate';
    case 'wreck':
      return 'ev_wreck';
    case 'rest':
      return 'ev_rest';
    case 'convoy':
      return 'ev_convoy';
    case 'altar':
      return 'ev_altar';
    default:
      return 'icon_none';
  }
}

/**
 * 结果类型 → 结果图标（R3 必改②：维修 / 强化 / 损耗 / 交易 / 推进 各有明确语义）。
 * `kind` 取 adventure 效果 kind：heal | damage | buff | trade | none。
 */
export function advOutcomeIconId(kind: string): AdvUiId {
  switch (kind) {
    case 'heal':
      return 'icon_heal';
    case 'buff':
      return 'icon_up';
    case 'damage':
      return 'icon_damage';
    case 'trade':
      return 'icon_trade';
    case 'none':
    default:
      return 'icon_none';
  }
}

/** 强化项（RunBuildId） → 强化图标；无专属图标时回退通用「强化」图标。 */
export function advBuildIconId(buildId: string): AdvUiId {
  switch (buildId) {
    case 'heavyShell':
      return 'bd_heavy_shell';
    case 'twinCannon':
      return 'bd_twin_cannon';
    case 'tripleLoad':
      return 'bd_triple_load';
    case 'fastReload':
      return 'bd_fast_reload';
    case 'kineticBurst':
      return 'bd_kinetic_burst';
    case 'emergencyRepair':
      return 'icon_repair';
    case 'damageUp':
      return 'icon_up';
    case 'rateUp':
      return 'bd_rate_up';
    default:
      return 'icon_up';
  }
}

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
