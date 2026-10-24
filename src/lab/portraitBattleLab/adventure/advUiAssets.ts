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
  /**
   * R1（FRUITS-ADVENTURE-UX-CONTINUITY-R1）｜一屏式叙事区专用 P0 素材。
   *   text_card_bg  ← atlasraft/battle_event_text_bg.png（182×164，浅色米白文本卡）
   *   event_bar_bg  ← atlasraft/battlenew_event_bg.png （1048×164，强边框事件条）
   *   btn_green     ← atlasraft/btn_green.png           （65×118，绿色圆角按钮）
   *   btn_yellow    ← atlasraft/btn_yellow.png          （65×118，黄色圆角按钮）
   *   event_line    ← atlasraft/event_line.png          （30×10，分隔装饰线）
   *   btn_chat      ← atlasraft/battle_event_btn_chat.png（185×102，圆形图标 + 条带按钮）
   * 全部为**九宫格**用途 → 边距见下方 NINE_SLICE（逐张按圆角弧线量取，非目测）。
   */
  | 'text_card_bg'
  | 'event_bar_bg'
  | 'btn_green'
  | 'btn_yellow'
  | 'event_line'
  | 'btn_chat'
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
  text_card_bg: 'adventure-ui/text_card_bg.png',
  event_bar_bg: 'adventure-ui/event_bar_bg.png',
  btn_green: 'adventure-ui/btn_green.png',
  btn_yellow: 'adventure-ui/btn_yellow.png',
  event_line: 'adventure-ui/event_line.png',
  btn_chat: 'adventure-ui/btn_chat.png',
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

/* ------------------------------------------------------------------ 九宫格 */

/**
 * R1｜九宫格边距（**量取值，非目测**）。
 *
 * 量法：对每个角落沿对角线找到第一处 alpha≥200 的像素，取四角半径 + 2px 余量；
 *   左右取 `max(TL, BL)` / `max(TR, BR)`，上下取 `max(TL, TR)` / `max(BL, BR)`
 *   （见 `docs/adventure-ux-continuity-r1/_probe_nine_slice.py`，可复算）。
 * 为什么不用「找纯色带」的通用扫描：这批素材是带高光/渐变/投影的立体按钮，
 *   不存在 1px 级纯色带，通用扫描会在噪声处抖动（实测给出 L524/R523 这类荒谬值）。
 *   ⇒ 圆角弧线法只依赖 alpha 外轮廓，对这类素材稳定。
 *
 * ⚠️ 本表是 `drawNineSlice` 的唯一输入；角落因此保持原始像素 1:1，符合「禁止非等比拉伸」
 *   的产品要求（按钮变宽时只拉中间条带，圆角不会被压扁）。
 */
export const NINE_SLICE: Readonly<Record<string, { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }>> = {
  /** 182×164 浅色文本卡：左下/右下 21px 大圆角 + 底部投影 ⇒ 底边留 23px。 */
  text_card_bg: { left: 23, right: 23, top: 10, bottom: 23 },
  /** 1048×164 事件条：上 25px 圆角、下 7px ⇒ 上厚下薄（投影在下方）。 */
  event_bar_bg: { left: 27, right: 26, top: 27, bottom: 9 },
  /** 65×118 绿色按钮。 */
  btn_green: { left: 21, right: 21, top: 16, bottom: 21 },
  /** 65×118 黄色按钮。 */
  btn_yellow: { left: 21, right: 21, top: 16, bottom: 21 },
  /** 30×10 装饰线（横向单轴拉伸即可，纵向保持原高）。 */
  event_line: { left: 6, right: 10, top: 3, bottom: 3 },
  /** 185×102 圆形图标按钮：左侧圆头不可拉 ⇒ 左 41px。 */
  btn_chat: { left: 41, right: 21, top: 32, bottom: 34 },
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

  /**
   * R1｜按素材 id 取九宫格边距（无表项 ⇒ null，调用方改用 contain，绝不猜边距）。
   */
  insets(id: AdvUiId): { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number } | null {
    return NINE_SLICE[id] ?? null;
  }
}

/** R1｜素材源文件名对照（诊断 / 报告引用用；运行时不依赖 D 盘路径）。 */
export const ADV_UI_SOURCE_NAMES: Readonly<Partial<Record<AdvUiId, string>>> = {
  text_card_bg: 'atlasraft/battle_event_text_bg.png',
  event_bar_bg: 'atlasraft/battlenew_event_bg.png',
  btn_green: 'atlasraft/btn_green.png',
  btn_yellow: 'atlasraft/btn_yellow.png',
  event_line: 'atlasraft/event_line.png',
  btn_chat: 'atlasraft/battle_event_btn_chat.png',
};
