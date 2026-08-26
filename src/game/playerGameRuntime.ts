/**
 * F-WX-5｜玩家 Gameplay Runtime（平台中立）。
 *
 * 把 main.ts 的正常玩家流程（Garage 装配 / Matching / MatchPreview / Battle /
 * Result / Reward / 经济 / 引导 / 存档副作用 / 埋点 / 广告）逐字抽取为共享运行时，
 * Web（main.ts）与微信（wechat/game.ts）双入口复用同一份逻辑，禁止复制第二套 Gameplay。
 *
 * 职责边界：
 * - 本模块 = Gameplay flow 状态机 + 副作用（结算/存档/埋点/广告频控）+ 组装 PlayerUIState；
 * - 不碰任何平台全局（window/document/wx/localStorage）：时间经 platform.lifecycle、
 *   存储经 platform.storage（bootstrap 已绑定当前平台）、定时器用 globalThis.setTimeout
 *   （Web/微信均为标准 JS 全局）；未绑定 PlatformCore 访问会 fail-fast 抛错（禁止静默回退 Web）；
 * - 战斗驱动经注入的 PlayerBattleHost（Web=PhysicsLab 适配；微信=精简 Planck 宿主），
 *   Renderer 经 battle.reframe/resize/setPreviewVehicleFx 间接调用；
 * - UI 经注入的 PlayerUIHost（WebDom 或 Canvas），本模块只 pushUI 状态、不碰 DOM。
 *
 * 依赖注入点（deps）覆盖 Web-only 表现：
 * - onPanelsChanged：Web 重渲染 DEV A/B 面板（renderPanelsOnly）；微信省略；
 * - onBuildLocked：Web 禁用/恢复 DEV Build 控件 DOM；微信省略；
 * - onArenaFrame：Web 场边红脉冲 + Death 定格恢复（lab.timeScale）；微信省略；
 * - isResetDevVisible / onDevResetReload：Web ?resetdev=1 + location.reload；微信恒 false / 省略。
 */
import { platform } from '../platform';
import { registry } from '../core/content';
import {
  buildSnapshotFromDraft,
  makeStarterDraft,
  editableSlots,
  migrateDraftBody,
  EMPTY_SLOT,
  resolveDriveMode,
  type BuildDraft,
  type DriveMode,
} from '../lab/buildEditorModel';
import { resolveOnboardingStage, completeOnboarding, type OnboardingStage } from '../core/onboarding';
import { resetPlayerSave } from '../core/saveVersion';
import { validateSnapshot } from '../core/buildValidator';
import {
  OPPONENT_POOL,
  cloneBuildDraft,
  buildMatchingSequence,
  pickOpponentForTier,
  OPPONENT_TIERS,
} from '../player/opponentPool';
import { loadPlayerBuild, savePlayerBuild } from '../core/buildPersistence';
import { track, battleEndGuard } from '../core/analytics';
import { RewardedAdClaimer, tryInterstitialSafe, isRewardedAdAvailable } from '../core/ads';
import { onBattleEnded, resetAdFrequency } from '../core/adFrequency';
import {
  BattleRewardSettler,
  ensureInventory,
  canEquipPart,
  getInventory,
  saveInventory,
  equippedDefIds,
} from '../core/partInventory';
import {
  BattleProgressSettler,
  getProgress,
  saveProgress,
  mergeWithCost,
  tierOf,
  TIER_LABEL,
} from '../core/playerProgress';
import { phaseRemainingMs, warningCountdown } from '../presentation/battlePhaseFx';
import type { BattleConfig, BattleOrchestratorApi } from '../battle/battleContract';
import type { CameraFit, FramingRect } from '../render/renderer';
import type { BuildSnapshot } from '../core/types';
import type { UiMode, BattleState, PlayerPhase } from '../ui/playerShell';
import type { PlayerUIState, PlayerUIActions, PlayerUIHost } from '../ui/playerUI';

export type { UiMode, BattleState, PlayerPhase } from '../ui/playerShell';

/** 战斗宿主：Web（PhysicsLab 适配）与微信（WechatBattleHost）实现的统一战斗驱动面 */
export interface PlayerBattleHost {
  readonly orchestrator: BattleOrchestratorApi | null;
  /** 当前是否为只读装配预览（Editing 判定；预览不推进战斗） */
  readonly previewMode: boolean;
  loadCustomPreview(a: BuildSnapshot, b: BuildSnapshot, soloA?: boolean): void;
  loadCustom(a: BuildSnapshot, b: BuildSnapshot, config?: BattleConfig): void;
  step(dtMs: number): void;
  render(): void;
  setPreviewVehicleFx(fx: { alpha: number; scale: number } | null): void;
  arenaDims(): { w: number; h: number };
  /** 按 fit 构图一次（host 用自己的 renderer.reframe；battle fit 需带 phase）；
   *  framingRect（viewport logical 子区域）存在时固定预览框 fit 到该区域（Mobile Garage） */
  reframe(fit: CameraFit, framingRect?: FramingRect): void;
  resize(w: number, h: number): void;
  /** 首页程序化背景下沉为 renderer underlay 开关（仅首页开启；车库/匹配/战斗关闭） */
  setHomeBackdrop?(on: boolean): void;
  /**
   * F-MATCH-FRAME-R2：当前 transform 下 A/B 双车「可见 envelope」屏幕矩形（逻辑 px）。
   * Matching / MatchPreview 的 UI 据此绘制扫描框 / 对手名称，保证与 renderer 实际落点一致
   * （根治 UI 锚点猜测脱节）。无 orchestrator（非预览/战斗）→ null。
   */
  getMatchVehicleRects?(): { a: { x: number; y: number; w: number; h: number }; b: { x: number; y: number; w: number; h: number } } | null;
  /**
   * F-HOME-STAGE-R2：首页当前 transform 下「我的车」可见 envelope 屏幕矩形（逻辑 px）。
   * Home 车辆点击区据此注册（点击跟随真实 envelope，而非整块 vehicleFramingRect）；
   * 无 orchestrator（非预览/战斗）→ null。
   */
  getHomeVehicleRect?(): { x: number; y: number; w: number; h: number } | null;
}

/** 依赖注入：入口（Web/微信）提供 Host / 表现 / Web-only 钩子 */
export interface PlayerGameDeps {
  host: PlayerUIHost;
  battle: PlayerBattleHost;
  /**
   * F-BATTLE-READABILITY-R1：战斗关键音效（攻击/命中/收束预警/胜负）。
   * Web = SfxAudioService；微信 = 惰性 no-op（play 安全跳过）。
   * 用户交互恢复音频（Web=AudioContext resume；微信省略/no-op）。
   */
  sfx?: { resume(): void; play?(id: import('../presentation/audioService').SfxId): void };
  /** Web：`() => new URLSearchParams(location.search).has('resetdev')`；微信：缺省 false */
  isResetDevVisible?: () => boolean;
  /** DEV 重置后刷新（Web=location.reload；微信缺省 → 运行时重读存档） */
  onDevResetReload?: () => void;
  /** Web：重渲染 DEV A/B 面板（renderPanelsOnly）；微信省略 */
  onPanelsChanged?: () => void;
  /** Web：锁定/恢复 DEV Build 控件 DOM；微信省略（仅运行时标志） */
  onBuildLocked?: (locked: boolean) => void;
  /** Web-only 每帧表现（场边红脉冲 + Death 定格恢复）；微信省略 */
  onArenaFrame?: (ctx: {
    orchestrator: BattleOrchestratorApi | null;
    previewMode: boolean;
    inWarning: boolean;
  }) => void;
  /** 入口自定视口 resize（Web：含 scenario 分支）；缺省 = 运行时内置 player-only */
  onResize?: () => void;
  /** 开战等流程序幕时重置入口的 DEV 场景相机（Web：currentCamera=null；微信省略） */
  onCameraReset?: () => void;
}

/**
 * 玩家 Gameplay Runtime：双入口共用的唯一玩家流程。
 * 除 deps 注入外，本类不依赖任何平台全局；PlatformCore 未绑定即访问 → 抛错。
 */
export class PlayerGameRuntime {
  // —— 玩家 Build 状态（DEV 面板可直接读写；玩家流程经 actions） ——
  draftA!: BuildDraft;
  draftB!: BuildDraft;
  /** 当前匹配对手在 OPPONENT_POOL 中的索引 */
  matchedIndex = 0;
  /** DEV 面板 B 编辑器折叠状态（Web-only 面板状态；运行时持有以便 flow 复位） */
  bEditorOpen = false;

  // —— 玩家流程状态（私有；经 actions / 公开方法读写） ——
  private uiModeInternal: UiMode = 'build';
  private battleStateInternal: BattleState = 'editing';
  private playerPhaseInternal: PlayerPhase = 'garage';
  private buildControlsLockedInternal = false;
  private garageSelected: string | null = null;
  private matchingGeneration = 0;
  private lastShownResult: BattleOrchestratorApi['result'] = null;
  private battleStartTimeMs = 0;
  private startTransitioning = false;
  private bFxStart = -1;
  private onboardingStage: OnboardingStage = 'pending';
  private currentResult: PlayerUIState['result'] = null;
  private currentReward: PlayerUIState['reward'] = null;
  private currentEconomy: PlayerUIState['economy'] = null;
  private currentResultOnboarding = false;
  private rewardAdClaimed = false;
  private readyOverlayVisible = false;
  private matchBarHidden = false;
  private lastPhase: string | null = null;
  private phaseStartTimeMs = 0;
  private lastPhaseOrch: unknown = null;
  private last = platform.lifecycle.now();

  private rewardSettler!: BattleRewardSettler;
  private progressSettler!: BattleProgressSettler;
  private rewardedClaimer!: RewardedAdClaimer;

  constructor(private readonly deps: PlayerGameDeps) {}

  // —— 公开只读访问（DEV 面板 / 入口读取） ——
  get uiMode(): UiMode {
    return this.uiModeInternal;
  }
  get battleState(): BattleState {
    return this.battleStateInternal;
  }
  get playerPhase(): PlayerPhase {
    return this.playerPhaseInternal;
  }
  get buildControlsLocked(): boolean {
    return this.buildControlsLockedInternal;
  }

  /** 玩家输入 → Gameplay command（入口经 host.setActions 绑定） */
  readonly actions: PlayerUIActions = {
    onToggleGarageSlot: (key) => {
      this.garageSelected = this.garageSelected === key ? null : key;
      this.pushUI(); // Host 重渲染 Dock：展开/收起第二层
    },
    onPickGarageOption: (value) => {
      const slotKey = this.garageSelected;
      if (!slotKey) return;
      const slotIsFunctional =
        slotKey !== 'body' && slotKey !== 'rearWheel' && slotKey !== 'frontWheel' && slotKey !== 'drive';
      // Q22：未拥有功能件（含未拥有星级）不可装备（守卫，disabled 仍双保险）
      if (slotIsFunctional && value !== EMPTY_SLOT) {
        const { defId, star } = decodePartValShared(value);
        if (!canEquipPart(defId, star)) return;
      }
      // Q28：变更前快照
      const oldVal =
        slotKey === 'body' ? this.draftA.bodyDefId
        : slotKey === 'rearWheel' ? String(this.draftA.rearRadius)
        : slotKey === 'frontWheel' ? String(this.draftA.frontRadius)
        : slotKey === 'drive' ? resolveDriveMode(this.draftA.drive)
        : (this.draftA.functionalSelections[slotKey] ?? EMPTY_SLOT);
      if (slotKey === 'body') {
        const migrated = migrateDraftBody(this.draftA, value, registry);
        this.draftA.bodyDefId = migrated.bodyDefId;
        this.draftA.functionalSelections = migrated.functionalSelections;
      } else if (slotKey === 'rearWheel') {
        this.draftA.rearRadius = Number(value);
      } else if (slotKey === 'frontWheel') {
        this.draftA.frontRadius = Number(value);
      } else if (slotKey === 'drive') {
        this.draftA.drive = value as DriveMode;
      } else {
        // Q22：功能件按 (defId, star) 装备
        if (value === EMPTY_SLOT) {
          this.draftA.functionalSelections[slotKey] = EMPTY_SLOT;
        } else {
          const { defId, star } = decodePartValShared(value);
          this.draftA.functionalSelections[slotKey] = defId;
          this.draftA.functionalStars = this.draftA.functionalStars ?? {};
          this.draftA.functionalStars[slotKey] = star;
        }
      }
      // Q28：Build 变更埋点（功能件槽额外发 part_equip）
      const isFunctional =
        slotKey !== 'body' && slotKey !== 'rearWheel' && slotKey !== 'frontWheel' && slotKey !== 'drive';
      const newVal =
        slotKey === 'body' ? this.draftA.bodyDefId
        : slotKey === 'rearWheel' ? String(this.draftA.rearRadius)
        : slotKey === 'frontWheel' ? String(this.draftA.frontRadius)
        : slotKey === 'drive' ? resolveDriveMode(this.draftA.drive)
        : (this.draftA.functionalSelections[slotKey] ?? EMPTY_SLOT);
      this.emitBuildChange(slotKey, oldVal, newVal, isFunctional);
      this.garageSelected = null; // 选完即收起
      this.refreshFromEdit(); // Draft → Energy → Preview + 重渲染 Dock（pushUI）
    },
    onFindOpponent: () => {
      if (!this.buildsValid()) return;
      this.deps.sfx?.resume();
      this.startMatching();
    },
    onMatchAdjust: () => this.adjustConfig(),
    onStartBattle: () => this.startBattleWithReady(),
    onResultAdjust: () => {
      // Q26：Result 的「调整配置」= 完成一次 Battle→Result→Garage 闭环 → 关闭首轮引导。
      completeOnboarding();
      this.onboardingStage = 'done';
      this.adjustConfig();
    },
    onResultNext: () => {
      void this.nextMatch();
    },
    onClaimRewardAd: async () => {
      if (this.rewardAdClaimed) return; // 本场已领 → 直接拒绝
      const out = await this.rewardedClaimer.claim();
      if (out.granted) {
        this.rewardAdClaimed = true;
        // 刷新当前金币展示（若经济区当前可见）
        if (this.currentEconomy) {
          this.currentEconomy = { ...this.currentEconomy, coin: out.coinAfter ?? this.currentEconomy.coin };
        }
        this.pushUI();
      }
      // 关闭 / 失败 / 无填充：不发奖，按钮保持可点（玩家可重试），绝不卡死
    },
    onMerge: () => {
      const cur = getInventory();
      const p = getProgress();
      track('merge_attempt'); // Q28：发起合成
      // Q23：合成 = 5×1★ 熔炼 + 固定金币消耗（纯函数，金币不足/副本不足均不生效）
      const res = mergeWithCost(cur, equippedDefIds(this.draftA), p.coin);
      if (!res.ok) return;
      track('merge_success'); // Q28：合成成功
      saveInventory(res.inventory);
      saveProgress({ coin: res.coin, rating: p.rating }); // 仅扣金币，rating 不变
      this.pushUI(); // Host 重渲染：反映新 2★ 库存 + 扣费后金币 + 合成面板
    },
    onResetProgress: () => {
      resetPlayerSave();
      resetAdFrequency(); // Q30：频控一并恢复新账号态
      if (this.deps.onDevResetReload) {
        this.deps.onDevResetReload();
      } else {
        // 无刷新能力（微信）：重读存档并重建初始状态（仅 DEV 可达，微信恒 false 不触发）
        this.reinitFromStorage();
      }
    },
    setHomeBackdrop: (on: boolean) => {
      // F-HOME-P0-LAYER：首页背景下沉为 renderer underlay（背景层<车辆层<UI层）
      this.deps.battle.setHomeBackdrop?.(on);
    },
  };

  // ==================== 生命周期 ====================

  /** 入口在业务模块求值后调用：装载玩家状态 + 绑定 actions + 初始渲染（与旧 main.ts 初始序列一致） */
  init(): void {
    this.draftA = loadPlayerBuild() ?? silDraft('watermelonBody');
    // Q22：部件库存初始化（starter + 旧存档已装备部件迁移；无存档则落盘）
    ensureInventory(this.draftA);
    // Q21：每场 Battle 奖励结算器（以 result 引用为幂等键，同场只结算一次）
    this.rewardSettler = new BattleRewardSettler();
    // Q23→Q24：每场 Battle 进度结算器（金币 + 段位；同场只结算一次，与 rewardSettler 同模式）
    this.progressSettler = new BattleProgressSettler();
    // Q30：Rewarded 发奖器（以每场 result 引用为幂等键，同场只发一次额外奖励，关闭/失败不发）
    this.rewardedClaimer = new RewardedAdClaimer();
    // Q26：首轮引导阶段（全新账号进入 pending，老存档直接 done；完成一次闭环后置 done 永久关闭）
    this.onboardingStage = resolveOnboardingStage();
    // Q15：对手来自固定对手池（玩家不可编辑，仅 DEV 可临时改）
    this.draftB = cloneBuildDraft(OPPONENT_POOL[this.matchedIndex]);

    this.deps.host.setActions(this.actions);
    track('game_start'); // Q28：应用启动（一次）
    this.refreshFromEdit();
    this.setMode('build'); // 初始：默认装配模式（含 doResize + track garage_enter + pushUI）
  }

  /** DEV 重置后无刷新平台的存档重读（微信 onResetProgress 兜底） */
  private reinitFromStorage(): void {
    this.draftA = loadPlayerBuild() ?? silDraft('watermelonBody');
    ensureInventory(this.draftA);
    this.onboardingStage = resolveOnboardingStage();
    this.draftB = cloneBuildDraft(OPPONENT_POOL[this.matchedIndex]);
    this.currentResult = null;
    this.currentReward = null;
    this.currentEconomy = null;
    this.currentResultOnboarding = false;
    this.rewardAdClaimed = false;
    this.readyOverlayVisible = false;
    this.matchBarHidden = false;
    this.lastShownResult = null;
    this.playerPhaseInternal = 'garage';
    this.battleStateInternal = 'editing';
    this.refreshFromEdit();
    this.pushUI();
  }

  /** 每帧推进（入口调度 rAF）：战斗步进 + Matching B FX + 渲染 + 阶段/结果轮询 + HUD 帧 */
  tick(now: number): void {
    // dt 双端钳制：上限 50ms（Q31 后台挂起防物理爆发）；下界 0（时钟回退/首帧时间源
    // 不一致时禁止倒退——负 dt 会毒化物理累加器导致战斗永久不推进）
    const dt = Math.max(0, Math.min(50, now - this.last));
    this.last = now;
    this.deps.battle.step(dt);
    this.applyMatchingBfx(now); // Matching 候选 B 淡入缩放（须先于 render 应用，A 不动）
    this.deps.battle.render();
    const countdownText = this.pollArenaPhase(now); // 阶段倒计时 / 场边红脉冲 / Death 定格恢复
    this.pollBattleResult(); // result 变化 → Ended 迁移 + 结算 + 结果展示（pushUI）
    this.deps.host.renderBattleFrame({
      battleState: this.battleStateInternal,
      battleStatus: this.deps.battle.orchestrator?.getBattleStatusSnapshot?.() ?? null,
      phaseCountdownText: countdownText,
      // F-BATTLE-READABILITY-R1：左右阵营卡名称（我方/对手车辆名；不再只显示 A/B）
      names: this.battleNames(),
    });
  }

  /** F-BATTLE-READABILITY-R1：当前对局 A/B 车辆名（registry Body 名；draftB 恒为对手池 Build） */
  private battleNames(): { a: string; b: string } {
    const ba = registry.bodies.get(this.draftA.bodyDefId);
    const bb = registry.bodies.get(this.draftB.bodyDefId);
    return { a: ba?.name ?? this.draftA.bodyDefId, b: bb?.name ?? this.draftB.bodyDefId };
  }

  /** 后台→前台恢复：重置 dt 时钟（避免大 dt 一步钳制失真） */
  resetClock(): void {
    this.last = platform.lifecycle.now();
  }

  // ==================== 状态出口 ====================

  /** 组装当前 PlayerUIState 并推给 Host（Gameplay 状态变化 → 玩家 UI 更新的唯一出口） */
  pushUI(): void {
    this.deps.host.render({
      uiMode: this.uiModeInternal,
      battleState: this.battleStateInternal,
      playerPhase: this.playerPhaseInternal,
      draft: this.draftA,
      draftValid: this.buildsValid(),
      blockReason: this.blockReason(),
      garageSelected: this.garageSelected,
      inventory: getInventory(),
      progress: getProgress(),
      onboarding: this.onboardingStage,
      resetDevVisible: this.deps.isResetDevVisible ? this.deps.isResetDevVisible() : false,
      opponent:
        this.playerPhaseInternal === 'matchPreview'
          ? (() => {
              const bodyB = registry.bodies.get(this.draftB.bodyDefId);
              const partsB = bodyB
                ? editableSlots(bodyB)
                    .map((hpId) => {
                      const v = this.draftB.functionalSelections[hpId];
                      if (!v || v === EMPTY_SLOT) return null;
                      return registry.functionals.get(v)?.name ?? v;
                    })
                    .filter((x): x is string => x !== null)
                : [];
              return {
                bodyName: bodyB?.name ?? this.draftB.bodyDefId,
                parts: partsB,
                drive: resolveDriveMode(this.draftB.drive) === 'stationary' ? '停驻' : '前进',
              };
            })()
          : null,
      matchBarHidden: this.matchBarHidden,
      // F-MATCH-FRAME-R2：Matching / MatchPreview 推入真实 A/B 屏幕 envelope（逻辑 px），
      // 供 UI 绘制扫描框 / 对手名称；仅此两阶段有值，其余阶段为 null。
      matchVehicleRects:
        this.playerPhaseInternal === 'matching' || this.playerPhaseInternal === 'matchPreview'
          ? this.deps.battle.getMatchVehicleRects?.() ?? null
          : null,
      // F-HOME-STAGE-R2：Home 阶段（= garage 阶段 + metaPage==='home'，见 reframePlayerCamera 注释）
      // 推入「我的车」真实 envelope（逻辑 px），供 UI 注册车辆点击区（点击跟随真实 envelope）；
      // 仅预览阶段（garage/matching/matchPreview）有值，Battle 阶段为 null。UI Host 仅在 Home
      // 页（metaPage==='home'）使用此值，其余预览页（如车库编辑页）虽同属 garage 阶段但不用。
      homeVehicleRect: this.deps.battle.previewMode ? this.deps.battle.getHomeVehicleRect?.() ?? null : null,
      result: this.currentResult,
      reward: this.currentReward,
      economy: this.currentEconomy,
      resultOnboardingVisible: this.currentResultOnboarding,
      rewardAdAvailable: isRewardedAdAvailable(),
      rewardAdClaimed: this.rewardAdClaimed,
      readyOverlayVisible: this.readyOverlayVisible,
    });
  }

  // ==================== 相机 / 视口（player-only） ====================

  /** 按当前 playerPhase/battleState 构图一次（Q15-UI-R2 / Q08-A 语义，与旧 main.ts 一致） */
  reframePlayerCamera(): void {
    const orch = this.deps.battle.orchestrator;
    if (!orch) return;
    // 注：PlayerPhase 仅有 'garage' | 'matching' | 'matchPreview'，无独立 'home' 阶段——
    // 正式首页 = garage 阶段 + metaPage==='home'，故首页同样走 'previewSolo'（garage 分支）+
    // getPreviewFramingRect 返回的 home.vehicleFramingRect，已正确 fit 到 homeStageRect。
    // 末尾 else 为防御性兜底（当前不可达），保持 previewSolo 以兼容未来可能新增的预览阶段。
    const fit: CameraFit = this.deps.battle.previewMode
      ? (this.playerPhaseInternal === 'garage' // Q15-UI-R2 / F-HOME-IA-R1：Garage/首页 单车固定构图（fit 到 vehicleFramingRect）
          ? 'previewSolo'
          : (this.playerPhaseInternal === 'matching' || this.playerPhaseInternal === 'matchPreview') // A左B右固定构图，候选换车不呼吸
            ? 'previewFixed'
            : 'previewSolo')
      : 'battle'; // 正式战斗：按 phase 构图（Q08-A）
    // F-MATCH-CAMERA-TRANSACTION-P0：previewFixed 是全屏固定框语义（MATCH_MIN/MAX 世界框 +
    // 全屏安全区）——不得混入 getPreviewFramingRect（matching 时 metaPage 已被复位为 'home'，
    // 会误返回 home 取景区，使 Locked 构图与首帧不一致造成跳变）。previewSolo 保留 framing。
    const framing = fit === 'previewFixed' ? undefined : (this.deps.host.getPreviewFramingRect?.() ?? undefined);
    this.deps.battle.reframe(fit, framing);
  }

  /** 视口 resize：arena 尺寸 → host resize + 重构图（Web 可经 deps.onResize 接管 scenario 分支） */
  doResize(): void {
    if (this.deps.onResize) {
      this.deps.onResize();
      return;
    }
    const d = this.deps.battle.arenaDims();
    this.deps.battle.resize(d.w, d.h);
    this.reframePlayerCamera();
  }

  // ==================== 玩家流程（从 main.ts 逐字抽取） ====================

  /** 当前 Draft 的 BuildSnapshot（DEV 面板共用） */
  snapshotOf(side: 'A' | 'B'): BuildSnapshot {
    return buildSnapshotFromDraft(
      side === 'A' ? this.draftA : this.draftB,
      registry,
      side === 'A' ? 'customA' : 'customB',
    );
  }

  /** 中央显示当前 Draft 的真实 Planck 装配预览（不推进战斗） */
  private showPreview(): void {
    if (this.playerPhaseInternal === 'matchPreview') {
      const sa = this.snapshotOf('A');
      const sb = this.snapshotOf('B');
      this.deps.battle.loadCustomPreview(sa, sb);
      this.reframePlayerCamera();
      // F-MATCH-FRAME-R2 / F-HOME-STAGE-R2：取景后立即推 UI，保证 match/home vehicle
      // envelope 与 renderer 实际落点同步（扫描框 / 车辆点击区精确跟随）。
      this.pushUI();
      return;
    }
    // Garage / Matching：只渲染我的车（solo-A）。B 占位（不绘制 / 不取景）。
    const sa = this.snapshotOf('A');
    this.deps.battle.loadCustomPreview(sa, sa, true);
    this.reframePlayerCamera();
    this.pushUI();
  }

  /** 编辑后刷新：预览（非战斗时）+ 存档 + 玩家 UI（经 Host）；DEV 面板经 onPanelsChanged */
  refreshFromEdit(): void {
    this.deps.onPanelsChanged?.();
    if (this.battleStateInternal !== 'fighting') {
      this.showPreview();
    }
    // Q15：玩家 Build 持久化（最小；仅保存 Build Draft，不碰经济系统）
    savePlayerBuild(this.draftA);
    this.pushUI();
  }

  /** A/B 是否均合法 */
  private buildsValid(): boolean {
    return (
      validateSnapshot(this.snapshotOf('A'), registry).valid &&
      validateSnapshot(this.snapshotOf('B'), registry).valid
    );
  }

  /** Start 阻断原因（A/B 各自最主要错误；合法为 null） */
  private blockReason(): string | null {
    const va = validateSnapshot(this.snapshotOf('A'), registry);
    if (!va.valid && va.errors[0]) return `A：${va.errors[0]}`;
    const vb = validateSnapshot(this.snapshotOf('B'), registry);
    if (!vb.valid && vb.errors[0]) return `B：${vb.errors[0]}`;
    return null;
  }

  /** 锁定 / 解锁 Build 控件（Fighting 时锁定；标志在运行时，DOM 经 onBuildLocked） */
  private setBuildControlsLocked(locked: boolean): void {
    this.buildControlsLockedInternal = locked;
    this.deps.onBuildLocked?.(locked);
  }

  /** 开战 / 原配置再战：重新 validate 当前 Draft → 正式 Battle */
  private startOrRematch(): void {
    const sa = this.snapshotOf('A');
    const sb = this.snapshotOf('B');
    if (!validateSnapshot(sa, registry).valid || !validateSnapshot(sb, registry).valid) {
      return; // 任一非法：不启动
    }
    // F-MOVE-1：A(玩家) / B(对手) 各自按自己的驱动配置
    const sideDrive = {
      a: resolveDriveMode(this.draftA.drive) === 'forward',
      b: resolveDriveMode(this.draftB.drive) === 'forward',
    };
    // Q21：开始新一场 Battle 前重置奖励结算器（以 result 引用为幂等键，保证每场只结算一次）
    this.rewardSettler.reset();
    // Q23→Q24：进度结算器同模式重置（每场只结算一次）
    this.progressSettler.reset();
    this.deps.battle.loadCustom(sa, sb, { autoDrive: true, engine: 'planck', sideDrive });
    this.battleStateInternal = 'fighting';
    this.setBuildControlsLocked(true);
    // Q28：记录开战时刻 + 重置 battle_end/reward_gain 去重器（每场新的 result 对象）
    this.battleStartTimeMs = platform.lifecycle.now();
    battleEndGuard.clear();
    track('battle_start', {
      opponentTier: OPPONENT_TIERS[this.matchedIndex],
      playerRating: getProgress().rating,
      body: this.draftA.bodyDefId,
    });
    // Q15-UI-R2：进入 Fighting → 玩家 Shell 隐藏，恢复全战场 + Battle HUD（Host 统一收起）
    this.currentResult = null;
    this.currentCameraResetForDev();
    // Q08-CAM-A1：面板隐藏 → canvas CSS 尺寸变化，先同步 backing 再构图
    this.doResize();
    this.pushUI();
  }

  /** 开战前重置 DEV 相机标记（场景相机只在 DEV scenario 使用；build 模式无相机标记） */
  private currentCameraResetForDev(): void {
    // 历史 main.ts 在此处置 currentCamera=null（DEV scenario 相机）；build 玩家流程恒 null，
    // 交由入口的 onCameraReset 钩子处理（Web 置 currentCamera=null；微信无此概念）。
    this.deps.onCameraReset?.();
  }

  /** Garage → MatchPreview：干净 VS 复核界面，与 Matching 同相机连续 */
  private goToMatchPreview(): void {
    // Q15-UX-R1：退出 Matching 视觉层（仅文字/按钮变化，车辆位置/尺寸不跳变）
    this.playerPhaseInternal = 'matchPreview';
    this.bEditorOpen = false;
    this.setBuildControlsLocked(true); // 只读复核
    this.currentResult = null;
    this.deps.battle.setPreviewVehicleFx(null); // 候选淡入缩放结束，B 恢复正常绘制
    this.bFxStart = -1;
    this.matchBarHidden = true; // Q15-FLOW-R1-ATOMIC：复核条正常流程立即隐藏，永不闪现
    this.refreshFromEdit(); // 渲染面板(隐藏) + 完整 A+B 预览(previewFixed 同构图) + pushUI
    // Q15-FLOW-R1-ATOMIC：匹配完成直接开战——正常流程不再出现「调整配置 / 开始战斗」复核条。
    // F-MATCH-FRAME-R2：最终对手「对手已锁定」稳定展示约 700ms（原 250ms 偏短，玩家来不及识别），
    // 随后自动进入现有 READY → Battle（复用 startBattleWithReady，无新增确认按钮）。
    globalThis.setTimeout(() => {
      // guard：仅当仍处于 MatchPreview 编辑态才启动；旧 timer / 已切换状态直接 no-op。
      if (this.playerPhaseInternal !== 'matchPreview' || this.battleStateInternal !== 'editing') return;
      this.startBattleWithReady();
    }, 700);
  }

  /** 主画布加载 A(玩家) + B(候选) 并固定取景（不创建第二个 Renderer） */
  private loadMatchAB(): void {
    const sa = this.snapshotOf('A');
    const sb = this.snapshotOf('B');
    this.deps.battle.loadCustomPreview(sa, sb);
    // F-MATCH-CAMERA-TRANSACTION-P0：战前准备【显式】previewFixed——此时 playerPhaseInternal
    // 仍为 'garage'（成功路径最后才提交），若经 reframePlayerCamera 会误选 previewSolo，
    // 导致首帧 Matching 单车构图（车辆过大/对手裁切），进入 matchPreview 才切 previewFixed
    // 造成 Locked 突然缩小。显式 previewFixed 使首帧即正确双车构图，Matching → Locked
    // 相机连续（同 fit + 固定框 + 同 spawn，无跳位/无缩放呼吸）。
    this.deps.battle.reframe('previewFixed');
  }

  /** Matching 候选换车——只重载 B（不重取景，相机保持固定无呼吸）+ 触发 B 淡入缩放 */
  private swapMatchCandidate(idx: number): void {
    this.draftB = cloneBuildDraft(OPPONENT_POOL[idx]);
    const sa = this.snapshotOf('A');
    const sb = this.snapshotOf('B');
    this.deps.battle.loadCustomPreview(sa, sb); // 不重构图：保留 previewFixed 固定相机
    this.bFxStart = platform.lifecycle.now(); // 触发 B 轻量淡入缩放（A 不动）
    this.pushUI(); // F-MATCH-FRAME-R2：重新计算并推入新候选的 matchVehicleRects（扫描框跟随真实 envelope）
  }

  /** 每帧应用 Matching 候选 B 的淡入缩放（A 不动；离开 Matching 即清除） */
  private applyMatchingBfx(now: number): void {
    if (this.playerPhaseInternal === 'matching' && this.bFxStart >= 0) {
      const t = (now - this.bFxStart) / 150;
      if (t >= 1) {
        this.bFxStart = -1;
        this.deps.battle.setPreviewVehicleFx(null);
        return;
      }
      const e = Math.max(0, Math.min(1, t));
      this.deps.battle.setPreviewVehicleFx({ alpha: 0.35 + 0.65 * e, scale: 0.96 + 0.04 * e });
    } else if (this.bFxStart !== -1) {
      this.bFxStart = -1;
      this.deps.battle.setPreviewVehicleFx(null);
    }
  }

  /** 玩家主流程：找对手（Garage → Matching → MatchPreview）。
   *  F-PLAYER-FLOW-ATOMIC-P0：原子提交——所有可失败的外围调用（埋点/控件锁定/对手抽取/
   *  A+B 预览加载）先行，最后一次性提交状态（battleState + playerPhase + pushUI）。
   *  任意外围步骤抛异常 → 状态保持完整 Home（不再出现「playerPhase 已改但 draftB/UI
   *  未完成」的半提交分裂）。防重复触发用 `matching` 状态门，非延时/重试。 */
  private startMatching(): void {
    if (this.playerPhaseInternal === 'matching') return; // 防重复触发
    // ① 外围副作用（先行；任何失败都不污染状态）
    track('find_opponent'); // Q28：发起寻找对手
    this.currentResult = null; // 收起结算卡（Host）
    // 控件锁定（playerMode 不注入 onBuildLocked → no-op；Web 由守卫后的 setBuildControlsLockedDom 处理）
    this.setBuildControlsLocked(true);
    // Q25：按玩家段位抽取对手（保持随机匹配 + 不连续重复同一 Build）
    const finalIdx = pickOpponentForTier(tierOf(getProgress().rating), this.matchedIndex, Math.random);
    this.matchedIndex = finalIdx;
    const seq = buildMatchingSequence(finalIdx, OPPONENT_POOL.length);
    // 主画布加载 A + 首个候选 B（previewFixed 固定相机）——A/B 同帧就绪
    this.draftB = cloneBuildDraft(OPPONENT_POOL[seq[0]]);
    this.loadMatchAB();
    // ② 最后一次性提交状态（成功路径唯一出口）
    this.battleStateInternal = 'editing';
    this.playerPhaseInternal = 'matching';
    this.pushUI(); // Host：隐藏 Dock / 显示 Matching 中央 VS + 顶部「正在寻找对手…」

    const gen = ++this.matchingGeneration; // 本场 generation
    // F-MATCH-DEMO-R1：节奏校准——搜索总时长 1420ms ∈ [1.2s, 1.8s]（验收 4），
    // 候选 4 个显示（3 次切换）∈ [3,5]；末位定格 = 实际锁定对手。
    // 节奏：快切 → 稍慢 → 最终锁定（0/340/720/1100ms，~1.1s 内 ≥4 次变化 → 定格）
    const steps: Array<{ at: number; idx: number }> = [
      { at: 340, idx: seq[1] },
      { at: 720, idx: seq[2] },
      { at: 1100, idx: seq[3] }, // 末位 = 实际锁定对手
    ];
    for (const s of steps) {
      globalThis.setTimeout(() => {
        if (gen !== this.matchingGeneration) return; // 防重复触发 / 离开阶段后失效
        this.swapMatchCandidate(s.idx);
      }, s.at);
    }
    // 锁定 → MatchPreview（~320ms 小停顿后定格）
    globalThis.setTimeout(() => {
      if (gen !== this.matchingGeneration) return;
      this.goToMatchPreview();
    }, 1100 + 320);
  }

  /** MatchPreview → Fighting：READY 过渡后真正开战（复用正式 Planck Runtime） */
  private startBattleWithReady(): void {
    if (this.startTransitioning) return;
    if (this.battleStateInternal !== 'editing' || this.playerPhaseInternal !== 'matchPreview') return;
    if (!this.buildsValid()) return;
    // Q11-C-R2：用户 Start 交互 → 恢复 AudioContext（浏览器自动播放策略）
    this.deps.sfx?.resume();
    this.startTransitioning = true;
    this.setBuildControlsLocked(true);
    this.doResize();
    this.readyOverlayVisible = true;
    this.pushUI(); // Host：显示 READY 过渡层（mobile 由 Host 门控不绘制，画面仍为「对手已锁定」）
    // F-MATCH-DEMO-R1：mobile 无 READY 覆盖层——Locked 稳定 ~700ms（goToMatchPreview）后
    // 直接开战，不追加 600ms READY 空等（Locked 总时长 600~800ms 验收 6）；
    // 桌面（未实现 isMobileView → undefined）保留 READY 600ms 过渡语义。
    const readyHoldMs = this.deps.host.isMobileView?.() ? 0 : 600;
    globalThis.setTimeout(() => {
      this.readyOverlayVisible = false;
      this.startTransitioning = false;
      this.startOrRematch();
      if (this.battleStateInternal !== 'fighting') {
        // 理论上不可达（已锁定且校验通过），防御：完整恢复编辑视觉
        this.setBuildControlsLocked(false);
        this.pushUI();
      }
    }, readyHoldMs);
  }

  /** Q28：Build 变更埋点统一出口（DEV 面板直接改 Draft 时也经此出口） */
  emitBuildChange(slot: string, oldPart: string, newPart: string, isFunctional: boolean): void {
    const body = this.draftA.bodyDefId;
    const drive = resolveDriveMode(this.draftA.drive);
    track('build_change', { slot, oldPart, newPart, drive, body });
    if (isFunctional && newPart && newPart !== EMPTY_SLOT) {
      track('part_equip', { slot, part: newPart, drive, body });
    }
  }

  /** Ended 后玩家选择：调整配置 → 回 Garage（保留玩家上一场 Build，不重置） */
  private adjustConfig(): void {
    this.currentResult = null; // Host 收起结算卡（HUD 由 renderBattleFrame 按 battleState 控制）
    this.playerPhaseInternal = 'garage'; // 回到装配
    this.battleStateInternal = 'editing';
    track('garage_enter'); // Q28：结算后回 Garage（闭环一步）
    this.bEditorOpen = false;
    this.garageSelected = null;
    this.setBuildControlsLocked(false);
    // Q08-CAM-A1：面板恢复 → canvas CSS 变窄，先同步 backing 再显示 Preview
    this.doResize();
    this.refreshFromEdit(); // 按 phase(Garage) 渲染 solo-A 预览 + Dock（pushUI 接入 Host）
  }

  /** Ended 后玩家选择：下一场 → 走同一套 Matching（随机新对手）→ MatchPreview */
  private async nextMatch(): Promise<void> {
    await tryInterstitialSafe(() => {
      this.currentResult = null;
      this.startMatching(); // 复用 Garage「寻找对手」同一状态链
    });
  }

  /** Q30：每场 Result 结算（奖励 + 金币/段位 + 首轮引导 + 广告重置 + 埋点） */
  private finalizeBattleResult(r: { winner: 'A' | 'B'; hpA: number; hpB: number }): void {
    const isWin = r.winner === 'A';
    // Q22：结算本场奖励（胜/负均获得 1★、可重复；同场只结算一次，自动入库）
    const outcome = this.rewardSettler.settle(r);
    this.currentReward = outcome
      ? (() => {
          const def = registry.functionals.get(outcome.defId);
          const cat = def?.category === 'weapon' ? '武器' : def?.category === 'gadget' ? '辅助' : '';
          return {
            name: def?.name ?? outcome.defId,
            starStr: outcome.star >= 2 ? '★★' : '★',
            cat,
            countAfter: outcome.countAfter,
          };
        })()
      : null;
    // Q23→Q24：结算本局金币 + 段位（同场只结算一次，自动入库）
    const prog = this.progressSettler.settle(r, isWin);
    this.currentEconomy = prog
      ? {
          coinDelta: prog.coinDelta,
          ratingDelta: prog.ratingDelta,
          tierLabel: TIER_LABEL[tierOf(prog.progress.rating)],
          rating: prog.progress.rating,
          coin: prog.progress.coin,
        }
      : null;
    // Q26：首轮引导——全新账号且本场获得新部件时，明确提示「回车库调整」（仅首场）
    this.currentResultOnboarding = this.onboardingStage === 'pending' && !!outcome;
    // Q30：每场 Result 显示时重置 Rewarded 发奖锁与按钮态（同场只发一次；下一场重新可领）
    this.rewardedClaimer.reset();
    this.rewardAdClaimed = false;
    // Q30：完整 Battle 结束 → 插屏频控计数 +1（在 battle_end 去重块内，每场只计一次）
    onBattleEnded();
    // Q28：battle_end / reward_gain / rank_change —— 同一 result 对象只触发一次
    if (battleEndGuard.firstTime(r)) {
      const duration = Math.max(0, (platform.lifecycle.now() - this.battleStartTimeMs) / 1000);
      const playerRating = prog ? prog.progress.rating : getProgress().rating;
      track('battle_end', {
        result: isWin ? 'win' : 'lose',
        duration: Number(duration.toFixed(1)),
        playerRating,
        opponentTier: OPPONENT_TIERS[this.matchedIndex],
      });
      if (prog) {
        track('reward_gain', {
          coinDelta: prog.coinDelta,
          ratingDelta: prog.ratingDelta,
          part: outcome?.defId ?? null,
          star: outcome ? (outcome.star >= 2 ? 2 : 1) : null,
        });
        if (prog.ratingDelta !== 0) {
          track('rank_change', {
            from: prog.progress.rating - prog.ratingDelta,
            to: prog.progress.rating,
            delta: prog.ratingDelta,
            tier: TIER_LABEL[tierOf(prog.progress.rating)],
          });
        }
      }
    }
  }

  /** 每帧轮询：result 变化 → Ended（显示中央结算卡；Build 控件保持锁定，先选「调整配置」） */
  private pollBattleResult(): void {
    const r = this.deps.battle.orchestrator?.result ?? null;
    if (r === this.lastShownResult) return;
    this.lastShownResult = r;
    if (this.uiModeInternal === 'build' && this.battleStateInternal === 'fighting' && r && r.phase === 'End') {
      this.battleStateInternal = 'ended';
      this.currentResult = { winner: r.winner, hpA: r.hpA, hpB: r.hpB };
      // F-BATTLE-READABILITY-R1：胜负音效（赢=上扬 / 输=低频下沉；仅每场结算一次）
      this.deps.sfx?.play?.(r.winner === 'A' ? 'win' : 'lose');
      this.finalizeBattleResult(this.currentResult); // 结算副作用（奖励/经济/埋点/广告重置）
      this.pushUI(); // Host：结算卡成为第一视觉焦点
    }
  }

  /** W2-FX-2：阶段表现轮询（Warning 倒计时；phase 切换重构图；Web-only 表现经 onArenaFrame） */
  private pollArenaPhase(nowMs: number): string | null {
    const o = this.deps.battle.orchestrator;
    // 战斗实例变化（load / reset / preview 重建）→ 阶段状态重置
    if (o !== this.lastPhaseOrch) {
      this.lastPhaseOrch = o;
      this.lastPhase = null;
      this.phaseStartTimeMs = 0;
    }
    // Preview / 无战斗：不显示阶段表现
    if (!o || this.deps.battle.previewMode) {
      this.deps.onArenaFrame?.({ orchestrator: o, previewMode: true, inWarning: false });
      return null;
    }
    if (o.phase !== this.lastPhase) {
      this.lastPhase = o.phase;
      this.phaseStartTimeMs = o.timeMs;
      // F-BATTLE-READABILITY-R1：Warning/Closing 进入时收束预警音（玩家提前感知刺墙压力；
      // 微信 no-op / Web 无 AudioContext 安全跳过）
      if (o.phase === 'Warning' || o.phase === 'Closing') {
        this.deps.sfx?.play?.('closing');
      }
      // Q08-A：phase 切换（Active→Warning→Closing/End）→ 稳定切换一次构图
      this.reframePlayerCamera();
    }
    const inWarning = o.phase === 'Warning' && o.result?.phase !== 'End';
    this.deps.onArenaFrame?.({ orchestrator: o, previewMode: false, inWarning });
    if (inWarning) {
      const warningMs = o.config.arena?.phases?.warningMs ?? 3000;
      const remaining = phaseRemainingMs(o.phase, warningMs, o.timeMs - this.phaseStartTimeMs);
      // F-BATTLE-HUD-HAZARD-R1：阶段提示 = 文字 + 倒计时一个信息组（mobile-normal 与
      // short HUD 同源）；「收束警告」→「刺墙逼近」文字变化解释 Warning→Closing 重置。
      return `收束警告 ${warningCountdown(remaining)}`;
    }
    // F-UX-3B：Closing 阶段同样中央显示倒计时（刺墙逼近；表现层纯逻辑，不碰 Physics/伤害）
    if (o.phase === 'Closing' && o.result?.phase !== 'End') {
      const closingMs = o.config.arena?.phases?.closingMs ?? 5000;
      const remaining = phaseRemainingMs(o.phase, closingMs, o.timeMs - this.phaseStartTimeMs);
      return `刺墙逼近 ${warningCountdown(remaining)}`;
    }
    void nowMs;
    return null;
  }

  // ==================== 顶层模式（DEV scenario 入口） ====================

  /**
   * 顶层模式切换（Q07-A）：装配（默认主页面）↔ 机制场景（开发工具入口）。
   * 仅处理 Gameplay 流（uiMode/currentResult/playerPhase/track/doResize/refresh/pushUI）；
   * DOM（backToBuildBtn/debugPanel 显隐）由入口 setMode 包装处理。
   */
  setMode(m: UiMode): void {
    this.uiModeInternal = m;
    this.currentResult = null; // 模式切换关闭结算卡（Host）
    // Q08-CAM-A1：模式切换改面板显隐 → canvas CSS 尺寸变化，先同步 backing 再构图
    this.doResize();
    if (m === 'build' && this.battleStateInternal !== 'fighting') {
      // Q15-UX-R1：切回装配 → Garage（solo-A），退出 Matching/MatchPreview 视觉层
      this.playerPhaseInternal = 'garage';
      track('garage_enter'); // Q28：进入 Garage（仅当真正切回装配时）
      this.refreshFromEdit(); // 按 phase(Garage) 渲染 A 编辑器 + solo-A 预览
    }
    this.pushUI();
  }

  /** DEV 场景已加载后：清结算/结果状态并重推 UI（场景相机由入口 devReframeCamera 处理） */
  clearResultState(): void {
    this.lastShownResult = null;
    this.currentResult = null;
    this.pushUI();
  }

  /** DEV Reset（lab.reset 后）：同步 flow 状态到 lab 现实（build 模式才动流程） */
  syncAfterLabReset(): void {
    this.lastShownResult = null;
    this.currentResult = null;
    if (this.uiModeInternal !== 'build') return; // scenario：只清结果，不 push（与旧 main.ts 一致）
    // preview 重建 → Editing（中央恢复装配预览）；battle 重建 → Fighting
    this.battleStateInternal = this.deps.battle.previewMode ? 'editing' : 'fighting';
    this.setBuildControlsLocked(!this.deps.battle.previewMode);
    if (this.deps.battle.previewMode) {
      this.doResize();
      this.refreshFromEdit();
    } else {
      this.reframePlayerCamera(); // Fighting：布局未变（面板已隐藏）
    }
    this.pushUI();
  }

  /** DEV Clear（lab.clear 后）：同步 flow 状态到无战斗现实 */
  syncAfterLabClear(): void {
    this.lastShownResult = null;
    this.currentResult = null;
    if (this.uiModeInternal !== 'build') return;
    this.battleStateInternal = 'editing';
    this.setBuildControlsLocked(false);
    this.doResize(); // Q08-CAM-A1：面板恢复 → CSS 变窄，先同步 backing
    this.refreshFromEdit(); // Clear 后恢复装配预览（Garage：solo-A + 仅 A 面板）
  }
}

// —— 模块级工具（与 playerUI.ts 的 encode/decode 同源；避免循环依赖单独本地实现） ——
function decodePartValShared(v: string): { defId: string; star: number } {
  if (v === EMPTY_SLOT) return { defId: EMPTY_SLOT, star: 1 };
  const i = v.lastIndexOf('@');
  const defId = i >= 0 ? v.slice(0, i) : v;
  const star = i >= 0 ? Number(v.slice(i + 1)) || 1 : 1;
  return { defId, star };
}

/** W2-SIL-1 视觉样板 Draft（starter；空存档首次启动即生成此合法 Build） */
function silDraft(bodyDefId: string): BuildDraft {
  return makeStarterDraft(bodyDefId, registry);
}
