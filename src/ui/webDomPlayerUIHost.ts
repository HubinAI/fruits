/**
 * F-WX-3｜WebDomPlayerUIHost：正常玩家 UI 的 Web DOM 实现（第一阶段）。
 *
 * 复用 main.ts 原有 DOM 结构 / 类名 / 样式（不重新设计、不 Canvas 化），
 * 把「玩家 UI 的创建 / 更新 / 交互」收进唯一 Host 边界：
 * - 创建：Garage Dock / Matching VS / MatchInfo / MatchPreview 复核条 / Battle HUD /
 *   Result 结算卡（含 Reward / Economy / Onboard）/ READY 过渡，全部挂到传入容器（canvasWrap）；
 * - 渲染：由 PlayerUIState 驱动（render / renderBattleFrame），不直接读 Gameplay；
 * - 交互：按钮统一 dispatch PlayerUIActions，由 main.ts 转成 Gameplay command。
 *
 * DEV Scenario / Physics Lab / Runtime Debug Tools 不进入本类（main.ts 保留 Web-only）。
 */
import { registry } from '../core/content';
import {
  buildSnapshotFromDraft,
  editableSlots,
  slotLabel,
  EMPTY_SLOT,
  resolveDriveMode,
} from '../lab/buildEditorModel';
import { computeEnergy } from '../core/buildValidator';
import { starTierEnergy } from '../core/buildSnapshot';
import { getCount, canEquipPart, equippedDefIds, OFFICIAL_PARTS } from '../core/partInventory';
// F-CONTENT-PLAYER-BODY-PACK-R1：车身拥有守卫（未获得的新车身锁定）
import { canEquipBody } from '../core/bodyOwnership';
import { tierOf, TIER_LABEL, canAffordMerge, MERGE_COST_COIN } from '../core/playerProgress';
import { REWARD_AD_COIN_BONUS } from '../core/ads';
import { computePlayerShellVisibility } from './playerShell';
import {
  BODY_OPTIONS,
  WHEEL_OPTIONS,
  encodePartVal,
  decodePartVal,
} from './playerUI';
import type {
  PlayerUIHost,
  PlayerUIState,
  PlayerUIHudFrame,
  PlayerUIActions,
} from './playerUI';

export class WebDomPlayerUIHost implements PlayerUIHost {
  private actions: PlayerUIActions | null = null;

  // Battle HUD
  private hudEl!: HTMLDivElement;
  private hudA!: { root: HTMLElement; hpText: HTMLElement; barFill: HTMLElement };
  private hudB!: { root: HTMLElement; hpText: HTMLElement; barFill: HTMLElement };
  private hudPhase!: HTMLSpanElement;
  private phaseCountdown!: HTMLSpanElement;

  // Result 结算卡
  private resultModal!: HTMLDivElement;
  private resultTitle!: HTMLHeadingElement;
  private resultHpA!: HTMLDivElement;
  private resultHpB!: HTMLDivElement;
  private resultReward!: HTMLDivElement;
  private resultEconomy!: HTMLDivElement;
  private resultOnboard!: HTMLDivElement;
  private btnAdjust!: HTMLButtonElement;
  private btnRematch!: HTMLButtonElement;
  private btnRewardAd!: HTMLButtonElement;

  // 玩家 Shell
  private playerTop!: HTMLDivElement;
  private ptTitle!: HTMLDivElement;
  private matchBar!: HTMLDivElement;
  private btnMatchAdjust!: HTMLButtonElement;
  private btnFight!: HTMLButtonElement;
  private matchingVs!: HTMLDivElement;
  private matchInfo!: HTMLDivElement;
  private garageDock!: HTMLDivElement;
  private readyOverlay!: HTMLDivElement;

  setActions(actions: PlayerUIActions): void {
    this.actions = actions;
  }

  mount(parent: HTMLElement): void {
    /* ---------- 战斗 HUD（Q06-HUD-U1：Fighting 顶部固定 A/B HP，不随车辆运动带走） ---------- */
    this.hudEl = document.createElement('div');
    this.hudEl.className = 'battle-hud';
    this.hudA = this.makeHudSide('A', '#3b6fd4');
    this.hudB = this.makeHudSide('B', '#e08a2e');
    this.hudPhase = document.createElement('span');
    this.hudPhase.className = 'hud-phase';
    this.hudPhase.textContent = '战斗中';
    this.hudEl.appendChild(this.hudPhase);
    /* W2-FX-2：Warning 阶段倒计时（3 → 2 → 1；Closing 开始后消失） */
    this.phaseCountdown = document.createElement('span');
    this.phaseCountdown.className = 'phase-countdown';
    this.phaseCountdown.textContent = '';
    this.hudEl.appendChild(this.phaseCountdown);
    parent.appendChild(this.hudEl);

    /* ---------- 结算 Modal（Q06-HUD-U1：Ended 中央第一视觉焦点） ---------- */
    this.resultModal = document.createElement('div');
    this.resultModal.className = 'result-modal';
    const resultCard = document.createElement('div');
    resultCard.className = 'result-card';
    this.resultModal.appendChild(resultCard);
    this.resultTitle = document.createElement('h2');
    this.resultTitle.className = 'result-title';
    resultCard.appendChild(this.resultTitle);
    this.resultHpA = document.createElement('div');
    this.resultHpA.className = 'result-hp';
    resultCard.appendChild(this.resultHpA);
    this.resultHpB = document.createElement('div');
    this.resultHpB.className = 'result-hp';
    resultCard.appendChild(this.resultHpB);
    // Q21：战斗奖励区（进入 Result 时已自动入库，无领取按钮）
    this.resultReward = document.createElement('div');
    this.resultReward.className = 'result-reward';
    this.resultReward.style.display = 'none';
    resultCard.appendChild(this.resultReward);
    // Q23→Q24：经济/段位区（本局金币获得 + 段位变化；进入 Result 时结算并展示）
    this.resultEconomy = document.createElement('div');
    this.resultEconomy.className = 'result-economy';
    this.resultEconomy.style.display = 'none';
    resultCard.appendChild(this.resultEconomy);
    // Q26：首轮引导提示（仅全新账号首场 Result 显示，提示回车库调整；完成闭环后不再出现）
    this.resultOnboard = document.createElement('div');
    this.resultOnboard.className = 'result-onboard';
    this.resultOnboard.style.display = 'none';
    resultCard.appendChild(this.resultOnboard);
    const resultActions = document.createElement('div');
    resultActions.className = 'result-actions';
    resultCard.appendChild(resultActions);
    // 结算卡按钮：下一场（主）/ 调整配置（次）—— Q15 玩家主循环闭环
    this.btnAdjust = document.createElement('button');
    this.btnAdjust.className = 'secondary';
    this.btnAdjust.textContent = '调整配置';
    this.btnAdjust.onclick = () => this.actions?.onResultAdjust();
    resultActions.appendChild(this.btnAdjust);
    this.btnRematch = document.createElement('button');
    this.btnRematch.className = 'primary';
    this.btnRematch.textContent = '下一场';
    this.btnRematch.onclick = () => this.actions?.onResultNext();
    resultActions.appendChild(this.btnRematch);
    // Q30：Result 额外奖励（Rewarded 广告）——仅广告可用时显示；完整观看成功才发，关闭/失败不发。
    this.btnRewardAd = document.createElement('button');
    this.btnRewardAd.className = 'secondary';
    this.btnRewardAd.textContent = `看广告领 ${REWARD_AD_COIN_BONUS} 金币`;
    this.btnRewardAd.onclick = () => {
      void this.actions?.onClaimRewardAd();
    };
    resultActions.appendChild(this.btnRewardAd);
    parent.appendChild(this.resultModal);

    /* ---------- Q15-UI-R2：玩家 Shell ---------- */
    this.playerTop = document.createElement('div');
    this.playerTop.className = 'player-top';
    this.ptTitle = document.createElement('div');
    this.ptTitle.className = 'pt-title';
    this.playerTop.appendChild(this.ptTitle);
    parent.appendChild(this.playerTop);

    /* Q15：MatchPreview 复核条（调整配置 / 开始战斗）——与 Garage Dock CTA 同一视觉体系 */
    this.matchBar = document.createElement('div');
    this.matchBar.className = 'start-bar';
    this.btnMatchAdjust = document.createElement('button');
    this.btnMatchAdjust.className = 'btn-start-cta secondary';
    this.btnMatchAdjust.textContent = '调整配置';
    this.btnMatchAdjust.onclick = () => this.actions?.onMatchAdjust();
    this.matchBar.appendChild(this.btnMatchAdjust);
    this.btnFight = document.createElement('button');
    this.btnFight.className = 'btn-start-cta';
    this.btnFight.textContent = '开始战斗';
    this.btnFight.onclick = () => this.actions?.onStartBattle();
    this.matchBar.appendChild(this.btnFight);
    this.matchBar.style.display = 'none';
    parent.appendChild(this.matchBar);

    /* Q15-UI-R2：Matching 中央 VS（文字在顶部状态区，不贴车身） */
    this.matchingVs = document.createElement('div');
    this.matchingVs.className = 'matching-vs';
    this.matchingVs.textContent = 'VS';
    parent.appendChild(this.matchingVs);

    /* Q15-UX-R1：MatchPreview 信息层（我的战车 VS 对手；只展示 Body + 主要部件） */
    this.matchInfo = document.createElement('div');
    this.matchInfo.className = 'match-info';
    parent.appendChild(this.matchInfo);

    /* Q15-UI-R2：Garage 装配 Dock（底部操作区；玩家主 UI，不使用旧 .lab-panel 表单） */
    this.garageDock = document.createElement('div');
    this.garageDock.className = 'garage-dock';
    parent.appendChild(this.garageDock);

    /* Q07-C：Start 后短暂状态转换（READY / 开战 0.8s；Presentation 延迟，
     * 不改 Physics 时间与正式 Battle 结果） */
    this.readyOverlay = document.createElement('div');
    this.readyOverlay.className = 'ready-overlay';
    const readyCard = document.createElement('div');
    readyCard.className = 'ready-card';
    const readySub = document.createElement('div');
    readySub.className = 'rd-sub';
    readySub.textContent = 'READY';
    const readyMain = document.createElement('div');
    readyMain.className = 'rd-main';
    readyMain.textContent = '开战！';
    readyCard.appendChild(readySub);
    readyCard.appendChild(readyMain);
    this.readyOverlay.appendChild(readyCard);
    parent.appendChild(this.readyOverlay);
  }

  private makeHudSide(teamLabel: string, color: string): {
    root: HTMLElement;
    hpText: HTMLElement;
    barFill: HTMLElement;
  } {
    const root = document.createElement('div');
    root.className = 'hud-side';
    const team = document.createElement('span');
    team.className = 'hud-team';
    team.textContent = teamLabel;
    team.style.color = color;
    const barWrap = document.createElement('div');
    barWrap.className = 'hud-bar-wrap';
    const barFill = document.createElement('div');
    barFill.className = 'hud-bar-fill';
    barFill.style.background = color;
    barWrap.appendChild(barFill);
    const hpText = document.createElement('span');
    hpText.className = 'hud-hp';
    root.appendChild(team);
    root.appendChild(barWrap);
    root.appendChild(hpText);
    this.hudEl.appendChild(root);
    return { root, hpText, barFill };
  }

  render(state: PlayerUIState): void {
    // 玩家 Shell 可见性（唯一 Host 边界，纯决策 computePlayerShellVisibility）
    const vis = computePlayerShellVisibility(state.uiMode, state.battleState, state.playerPhase);
    this.playerTop.style.display = vis.playerTop;
    this.garageDock.style.display = vis.garageDock;
    this.matchingVs.style.display = vis.matchingVs;
    this.matchInfo.style.display = vis.matchInfo;
    // Q15-FLOW-R1-ATOMIC：正常流程 MatchPreview 复核条立即隐藏，永不闪现
    this.matchBar.style.display = state.matchBarHidden ? 'none' : vis.matchBar;
    // 顶部标题（阶段文案；位于 UI 层顶部，不贴车身）
    this.ptTitle.textContent =
      state.playerPhase === 'garage'
        ? '我的战车'
        : state.playerPhase === 'matching'
          ? '正在寻找对手…'
          : '对手已找到';
    // Garage Dock（装配编辑态 + Garage）
    if (state.uiMode === 'build' && state.battleState === 'editing' && state.playerPhase === 'garage') {
      this.renderGarageDock(state);
    }
    // MatchPreview 信息层
    if (state.uiMode === 'build' && state.playerPhase === 'matchPreview' && state.opponent) {
      this.renderMatchInfo(state.opponent);
    }
    // Result / Reward / Economy / Onboard / 广告按钮
    this.renderResult(state);
    // READY 过渡
    this.readyOverlay.style.display = state.readyOverlayVisible ? 'flex' : 'none';
  }

  /** 每帧：Battle HUD（HP 条 + 阶段文案 + Warning 倒计时） */
  renderBattleFrame(frame: PlayerUIHudFrame): void {
    const s = frame.battleStatus;
    if ((frame.battleState !== 'fighting' && frame.battleState !== 'ended') || !s) {
      this.hudEl.style.display = 'none';
    } else {
      this.hudEl.style.display = 'flex';
      // W2-UX-R2：Ended 不再显示「战斗中」（改「战斗结束」，避免与结算卡矛盾）
      this.hudPhase.textContent = s.phase === 'End' ? '战斗结束' : '战斗中';
      this.hudA.hpText.textContent = `${Math.round(s.sideA.hp)} / ${Math.round(s.sideA.maxHp)}`;
      this.hudB.hpText.textContent = `${Math.round(s.sideB.hp)} / ${Math.round(s.sideB.maxHp)}`;
      this.hudA.barFill.style.width =
        `${Math.max(0, Math.min(1, s.sideA.hp / Math.max(s.sideA.maxHp, 1))) * 100}%`;
      this.hudB.barFill.style.width =
        `${Math.max(0, Math.min(1, s.sideB.hp / Math.max(s.sideB.maxHp, 1))) * 100}%`;
    }
    // Warning 倒计时（3 → 2 → 1；Closing 开始后消失）——保留原「'' 回退」语义
    if (frame.phaseCountdownText != null) {
      this.phaseCountdown.textContent = frame.phaseCountdownText;
      this.phaseCountdown.style.display = '';
    } else {
      this.phaseCountdown.style.display = 'none';
    }
  }

  /** 结算卡渲染（胜负 + 剩余 HP + 奖励 + 经济/段位 + 首轮引导 + 广告按钮） */
  private renderResult(state: PlayerUIState): void {
    if (!state.result) {
      this.resultModal.style.display = 'none';
      return;
    }
    const isWin = state.result.winner === 'A';
    this.resultTitle.textContent = isWin ? '【胜利】' : '【失败】';
    this.resultTitle.style.color = isWin ? '#59c97a' : '#ff6b5e';
    this.resultHpA.textContent = `我方剩余 HP：${Math.round(state.result.hpA)}`;
    this.resultHpB.textContent = `对手剩余 HP：${Math.round(state.result.hpB)}`;
    if (state.reward) {
      this.resultReward.innerHTML =
        `<div class="rr-label">获得部件</div>` +
        `<div class="rr-name">${state.reward.name} ${state.reward.starStr}</div>` +
        `<div class="rr-cat">${state.reward.cat} · 当前拥有 ×${state.reward.countAfter}</div>`;
      this.resultReward.style.display = 'flex';
    } else {
      this.resultReward.style.display = 'none';
    }
    if (state.economy) {
      const coinSign = state.economy.coinDelta >= 0 ? '+' : '';
      const ratingSign = state.economy.ratingDelta >= 0 ? '+' : '';
      this.resultEconomy.innerHTML =
        `<div class="re-label">本局金币 ${coinSign}${state.economy.coinDelta} · 段位 ${ratingSign}${state.economy.ratingDelta}` +
        `（${state.economy.tierLabel} ${state.economy.rating}）</div>` +
        `<div class="re-cat">当前金币 ${state.economy.coin}</div>`;
      this.resultEconomy.style.display = 'flex';
    } else {
      this.resultEconomy.style.display = 'none';
    }
    // Q26：首轮引导——全新账号且本场获得新部件时，明确提示「回车库调整」（仅首场，完成闭环后隐藏）
    if (state.resultOnboardingVisible) {
      this.resultOnboard.textContent = '获得新部件，可以回车库调整';
      this.resultOnboard.style.display = 'flex';
    } else {
      this.resultOnboard.style.display = 'none';
    }
    this.syncRewardAd(state);
    this.resultModal.style.display = 'flex';
  }

  /** Q30：Rewarded 按钮可见性与可点态（无广告环境隐藏，游戏照常完整） */
  private syncRewardAd(state: PlayerUIState): void {
    this.btnRewardAd.disabled = state.rewardAdClaimed;
    this.btnRewardAd.style.opacity = state.rewardAdClaimed ? '0.6' : '';
    this.btnRewardAd.textContent = state.rewardAdClaimed
      ? `已领 +${REWARD_AD_COIN_BONUS}`
      : `看广告领 ${REWARD_AD_COIN_BONUS} 金币`;
    this.btnRewardAd.style.display = state.rewardAdAvailable ? '' : 'none';
  }

  /** MatchPreview 信息层内容（只展示 Body 名 + 已安装主要部件 + 驱动，不展示数值/调试） */
  private renderMatchInfo(opponent: { bodyName: string; parts: string[]; drive: '前进' | '停驻' }): void {
    this.matchInfo.replaceChildren();
    const left = document.createElement('div');
    left.className = 'mi-side mi-left';
    left.innerHTML = '<div class="mi-label">我的战车</div>';
    const vs = document.createElement('div');
    vs.className = 'mi-vs';
    vs.textContent = 'VS';
    const right = document.createElement('div');
    right.className = 'mi-side mi-right';
    // F-MOVE-1：锁定阶段在对手附近显示其真实 Drive 配置（仅表示驱动模式，不做职业/AI 标签）
    right.innerHTML =
      `<div class="mi-label">对手</div>` +
      `<div class="mi-body">${opponent.bodyName}</div>` +
      (opponent.parts.length ? `<div class="mi-parts">${opponent.parts.join(' / ')}</div>` : '') +
      `<div class="mi-drive">驱动 · ${opponent.drive}</div>`;
    this.matchInfo.appendChild(left);
    this.matchInfo.appendChild(vs);
    this.matchInfo.appendChild(right);
  }

  /**
   * Q15-UI-R2：Garage 装配 Dock 渲染。
   * 第一层：车身 / 后轮 / 前轮 / 各 functional 挂点 chip（只显示当前装备，不铺开全部部件）；
   * 第二层：点击某 chip 后横向展开其选项（选完即收起 garageSelected=null）；
   * Energy 合并进 Dock；「寻找对手」为主 CTA（与 MatchPreview 按钮同一视觉体系）。
   */
  private renderGarageDock(state: PlayerUIState): void {
    const draft = state.draft;
    if (!draft) return;
    const dock = this.garageDock;
    dock.replaceChildren();
    // Q23→Q24：车库顶部状态条（金币 + 段位/rating）
    {
      const p = state.progress;
      const tier = tierOf(p.rating);
      const stats = document.createElement('div');
      stats.className = 'dock-stats';
      stats.innerHTML = `金币 <b>${p.coin}</b> · ${TIER_LABEL[tier]} <b>${p.rating}</b>`;
      dock.appendChild(stats);
    }
    // Q26：首轮引导——全新账号仅在首 Garage 显示极简提示；完成闭环后 onboarding 变 done 即不再渲染。
    if (state.onboarding === 'pending') {
      const ob = document.createElement('div');
      ob.className = 'dock-onboard';
      ob.textContent = '这是你的第一辆战车，点「寻找对手」开始第一场战斗';
      dock.appendChild(ob);
    }
    // Q27：DEV/Settings 安全入口——仅当 URL 含 ?resetdev=1 时显示「重置进度」；正常游玩不可见。
    if (state.resetDevVisible) {
      const dev = document.createElement('button');
      dev.className = 'dock-dev-reset';
      dev.textContent = 'DEV：重置进度';
      dev.onclick = () => {
        if (confirm('确认重置全部进度？此操作不可撤销，将恢复到新账号状态。')) {
          this.actions?.onResetProgress();
        }
      };
      dock.appendChild(dev);
    }
    const body = registry.bodies.get(draft.bodyDefId);
    const snapshot = buildSnapshotFromDraft(draft, registry, 'customA');
    const valid = state.draftValid;

    // 第一层：槽位 chip 行
    const chips = document.createElement('div');
    chips.className = 'dock-chips';
    const chipDefs: Array<{ key: string; label: string; value: string; empty: boolean }> = [];
    chipDefs.push({ key: 'body', label: '车身', value: body?.name ?? draft.bodyDefId, empty: false });
    const rw = WHEEL_OPTIONS.find((w) => String(draft.rearRadius) === w.v);
    const fw = WHEEL_OPTIONS.find((w) => String(draft.frontRadius) === w.v);
    chipDefs.push({ key: 'rearWheel', label: '后轮', value: rw?.t ?? String(draft.rearRadius), empty: false });
    chipDefs.push({ key: 'frontWheel', label: '前轮', value: fw?.t ?? String(draft.frontRadius), empty: false });
    // F-MOVE-1：驱动模式（前进 / 停驻）——与车身/轮子同为 Build 的明确配置
    chipDefs.push({
      key: 'drive',
      label: '驱动',
      value: resolveDriveMode(draft.drive) === 'stationary' ? '停驻' : '前进',
      empty: false,
    });
    if (body) {
      for (const hpId of editableSlots(body)) {
        const cur = draft.functionalSelections[hpId] ?? EMPTY_SLOT;
        const curStar = draft.functionalStars?.[hpId] ?? 1;
        const name =
          cur === EMPTY_SLOT
            ? '空'
            : (registry.functionals.get(cur)?.name ?? cur) + (curStar >= 2 ? ' ★★' : ' ★');
        chipDefs.push({ key: hpId, label: slotLabel(hpId), value: name, empty: cur === EMPTY_SLOT });
      }
    }
    for (const def of chipDefs) {
      const chip = document.createElement('button');
      chip.className = 'dock-chip' + (state.garageSelected === def.key ? ' active' : '');
      const lab = document.createElement('span');
      lab.className = 'dc-label';
      lab.textContent = def.label;
      const val = document.createElement('span');
      val.className = 'dc-value' + (def.empty ? ' empty' : '');
      val.textContent = def.value;
      chip.appendChild(lab);
      chip.appendChild(val);
      chip.onclick = () => {
        this.actions?.onToggleGarageSlot(def.key);
      };
      chips.appendChild(chip);
    }
    dock.appendChild(chips);

    // 第二层：当前选中槽的横向选项
    const garageSelected = state.garageSelected;
    if (garageSelected) {
      const slotIsFunctional =
        garageSelected !== 'body' &&
        garageSelected !== 'rearWheel' &&
        garageSelected !== 'frontWheel' &&
        garageSelected !== 'drive';
      const picker = document.createElement('div');
      picker.className = 'dock-picker';
      const title = document.createElement('div');
      title.className = 'dp-title';
      const selLabel =
        garageSelected === 'body' ? '车身'
          : garageSelected === 'rearWheel' ? '后轮'
            : garageSelected === 'frontWheel' ? '前轮'
              : garageSelected === 'drive' ? '驱动'
                : slotLabel(garageSelected);
      title.textContent = `正在改「${selLabel}」`;
      picker.appendChild(title);
      const opts: Array<{ v: string; t: string; meta: string }> = [];
      if (garageSelected === 'body') {
        // F-CONTENT-PLAYER-BODY-PACK-R1：新 4 车身默认未拥有 → 「未获得」仍可见、锁定
        for (const o of BODY_OPTIONS) {
          const owned = canEquipBody(o.v);
          opts.push({ v: o.v, t: o.t, meta: owned ? '' : '未获得' });
        }
      } else if (garageSelected === 'rearWheel' || garageSelected === 'frontWheel') {
        for (const o of WHEEL_OPTIONS) opts.push({ v: o.v, t: o.t, meta: '' });
      } else if (garageSelected === 'drive') {
        opts.push({ v: 'forward', t: '前进', meta: '轮子正常驱动' });
        opts.push({ v: 'stationary', t: '停驻', meta: '不主动移动·真实物理保留' });
      } else {
        // Q22：功能件按 (defId, star) 展开；空槽单独；未拥有星级显示「未获得」仍可见（不隐藏）
        opts.push({ v: EMPTY_SLOT, t: '空', meta: '空 · 0 能量' });
        const inv = state.inventory;
        for (const defId of OFFICIAL_PARTS) {
          const def = registry.functionals.get(defId);
          if (!def) continue;
          const cat = def.category === 'weapon' ? '武器' : def.category === 'gadget' ? '辅助' : def.category;
          for (const star of [1, 2]) {
            const count = getCount(inv, defId, star);
            const starStr = star >= 2 ? '★★' : '★';
            const t = `${def.name} ${starStr}`;
            const meta = count > 0
              ? `${cat} · ${starTierEnergy(def.energy, star)} 能量 · 拥有 ×${count}`
              : '未获得';
            opts.push({ v: encodePartVal(defId, star), t, meta });
          }
        }
      }
      const curVal =
        garageSelected === 'body' ? draft.bodyDefId
          : garageSelected === 'rearWheel' ? String(draft.rearRadius)
            : garageSelected === 'frontWheel' ? String(draft.frontRadius)
              : garageSelected === 'drive' ? resolveDriveMode(draft.drive)
                : encodePartVal(
                    draft.functionalSelections[garageSelected] ?? EMPTY_SLOT,
                    draft.functionalStars?.[garageSelected] ?? 1,
                  );
      for (const o of opts) {
        const b = document.createElement('button');
        // F-CONTENT-PLAYER-BODY-PACK-R1：车身槽未获得的新车身锁定（与 Canvas 玩家模式一致）；
        // Q22：功能件槽中，未拥有星级锁定（不可装备、仍可见），空槽/已拥有正常
        const equip = garageSelected === 'body'
          ? canEquipBody(o.v)
          : !slotIsFunctional
            ? true
            : o.v === EMPTY_SLOT
              ? true
              : (() => {
                  const { defId, star } = decodePartVal(o.v);
                  return canEquipPart(defId, star);
                })();
        b.className = 'dock-opt' + (o.v === curVal ? ' active' : '') + (equip ? '' : ' locked');
        if (!equip) b.disabled = true;
        const nameEl = document.createElement('div');
        nameEl.className = 'do-name';
        nameEl.textContent = o.t;
        b.appendChild(nameEl);
        if (o.meta) {
          const metaEl = document.createElement('div');
          metaEl.className = 'do-meta';
          metaEl.textContent = o.meta;
          b.appendChild(metaEl);
        }
        b.onclick = () => {
          this.actions?.onPickGarageOption(o.v);
        };
        picker.appendChild(b);
      }
      dock.appendChild(picker);
    }

    // Q22：合成 Panel（Garage 内简易，不新页面、不改布局结构）
    {
      const inv = state.inventory;
      const progress = state.progress;
      const reserved = new Set(equippedDefIds(draft));
      let available = 0;
      for (const p of OFFICIAL_PARTS) available += Math.max(0, inv[p].one - (reserved.has(p) ? 1 : 0));
      const canMergeParts = available >= 5;
      const canAfford = canAffordMerge(progress.coin);
      const mergePanel = document.createElement('div');
      mergePanel.className = 'merge-panel';
      const mTitle = document.createElement('div');
      mTitle.className = 'mp-title';
      mTitle.textContent = '合成 · 5 × 1★ → 1 × 随机 2★';
      mergePanel.appendChild(mTitle);
      const mInfo = document.createElement('div');
      mInfo.className = 'mp-info';
      mInfo.textContent =
        `可合成 1★ 副本：${available}（已装备各保留 1） · 消耗 ${MERGE_COST_COIN} 金币`;
      mergePanel.appendChild(mInfo);
      const mBtn = document.createElement('button');
      mBtn.className = 'mp-btn';
      if (!canMergeParts) mBtn.textContent = '副本不足';
      else if (!canAfford) mBtn.textContent = `金币不足（${progress.coin}/${MERGE_COST_COIN}）`;
      else mBtn.textContent = '合成';
      mBtn.disabled = !(canMergeParts && canAfford);
      mBtn.onclick = () => {
        this.actions?.onMerge();
      };
      mergePanel.appendChild(mBtn);
      dock.appendChild(mergePanel);
    }

    // 底部行：能量 + 寻找对手 CTA
    const row = document.createElement('div');
    row.className = 'dock-row';
    const energyRes = computeEnergy(snapshot, registry);
    const used = energyRes.error ? Number.NaN : energyRes.energy;
    const capacity = body?.energyCapacity ?? 0;
    const overload = Number.isFinite(used) && used > capacity;
    const eRow = document.createElement('div');
    eRow.className = 'dock-energy';
    const eLabel = document.createElement('span');
    eLabel.className = 'de-label';
    eLabel.textContent = '能量';
    const eBar = document.createElement('div');
    eBar.className = 'de-bar';
    const pct = Number.isFinite(used) ? Math.min(100, (used / Math.max(capacity, 1)) * 100) : 0;
    const eFill = document.createElement('div');
    eFill.className = 'de-fill' + (overload ? ' overload' : '');
    eFill.style.width = `${pct}%`;
    eBar.appendChild(eFill);
    const eTxt = document.createElement('span');
    eTxt.className = 'de-text' + (overload ? ' overload' : '');
    eTxt.textContent = Number.isFinite(used) ? `${used} / ${capacity}` : '? / ?';
    eRow.appendChild(eLabel);
    eRow.appendChild(eBar);
    eRow.appendChild(eTxt);
    row.appendChild(eRow);

    if (!valid) {
      const reason = state.blockReason;
      if (reason) {
        const hint = document.createElement('span');
        hint.className = 'dock-hint';
        hint.textContent = reason;
        row.appendChild(hint);
      }
    }

    const cta = document.createElement('button');
    cta.className = 'dock-cta';
    cta.textContent = '寻找对手';
    cta.disabled = !valid;
    cta.onclick = () => {
      this.actions?.onFindOpponent();
    };
    row.appendChild(cta);
    dock.appendChild(row);
  }
}
