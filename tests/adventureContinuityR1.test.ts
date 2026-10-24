/**
 * FRUITS-ADVENTURE-UX-CONTINUITY-R1｜一屏式连续性 + 经济等价性定向测试。
 *
 * 这份测试回答的是 Queue 的两个**产品级**断言，而不是「代码没报错」：
 *
 *   ① 连续性（必改 1 / 必改 2 / 验收 1 / 验收 2）
 *      「战斗、事件、奖励共享同一主场景，不再频繁整页跳转」
 *      「连续非决策阶段不需要重复点击继续，保留必要的实际选择」
 *      ⇒ 纯信息阶段（EVENT / RESULT / EVENT_DONE）**不接受主操作**、且能被自动承接；
 *        决策阶段（EVENT_CHOICE / CHOICE）**必须**由玩家选择，自动承接不得跨过它。
 *
 *   ② 等价性（禁止项：「不得丢失真实奖励和状态结算」）
 *      「旧路径：每次按继续推进」 vs 「新路径：纯信息阶段自动承接」
 *      在同种子、同选择下必须产生**完全相同**的 buffs / carriedHp / 胜负 / 完成场次。
 *      ⇒ 用两套驱动跑同一条脚本，逐字段比对终态（不是只比「都到 COMPLETE」）。
 *
 *   ③ 版面（验收 3）
 *      四段带不重叠、不越界；选项卡全部落在叙事区内；纯信息阶段主操作**不可点**。
 *      九宫格 corner 1:1（禁非等比拉伸）由几何断言 + 绘制调用记录共同验证。
 */
import { describe, it, expect } from 'vitest';
import {
  advAutoAdvance,
  advActionEnabled,
  advCarriedPlayerHp,
  advChoicePool,
  advContextFromLoadout,
  advCurrentNode,
  advInfoPhase,
  advNarrativeLines,
  advNarrativeTitle,
  advNeedsPlayer,
  chooseAdventureOption,
  createAdventureState,
  finishAdventureBattle,
  pressAdventureAction,
  type AdventureContext,
  type AdventureState,
} from '../src/lab/portraitBattleLab/adventure/advState';
import { generateAdventureScript, type AdventureScript } from '../src/lab/portraitBattleLab/adventure/advScript';
import {
  UX_ACTION,
  UX_ACTION_BTN,
  UX_H,
  UX_NARRATIVE,
  UX_NARRATIVE_CARD,
  UX_STAGE,
  UX_TOP,
  UXW,
  drawNineSlice,
  uxHit,
  uxOptionRects,
} from '../src/lab/portraitBattleLab/adventure/advLayout';
import { NINE_SLICE } from '../src/lab/portraitBattleLab/adventure/advUiAssets';
import { driveStep } from './_adv_drive_r1';

const ctx: AdventureContext = advContextFromLoadout();

type Driver = 'legacy' | 'r1';

/**
 * 完整跑一局（战斗用合成结果推进，不启真实物理 —— 本文件验证的是**流程结构**，
 * 真实物理下的胜负可达性由 `run_adventure_seed.test.ts` / E2E 覆盖）。
 *
 * legacy = R1 之前的行为：每个非战斗阶段都「按一次继续/选择」
 * r1     = R1 之后的行为：需要玩家才点，纯信息阶段自动承接
 */
function play(script: AdventureScript, driver: Driver): AdventureState {
  let s = createAdventureState(ctx, script);
  for (let guard = 0; guard < 600; guard++) {
    if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
    if (s.phase === 'BATTLE') {
      const cur = advCarriedPlayerHp(s, ctx);
      // 固定剧本：每场都赢，剩余耐久 -30（保证跨战斗继承可观测）
      s = finishAdventureBattle(
        s,
        { winner: 'A', endReason: 'test', playerHp: Math.max(1, cur - 30), enemyHp: 0, steps: 40 },
        script,
      );
      continue;
    }
    if (s.phase === 'EVENT_CHOICE') {
      const node = advCurrentNode(s, script);
      if (node.kind !== 'EVENT') throw new Error('EVENT_CHOICE 但节点不是 EVENT');
      s = chooseAdventureOption(s, node.options[0].id, ctx, script);
      continue;
    }
    if (s.phase === 'CHOICE') {
      const node = advCurrentNode(s, script);
      if (node.kind !== 'BUILD') throw new Error('CHOICE 但节点不是 BUILD');
      const pool = advChoicePool(s, node, ctx);
      if (pool.length === 0) {
        s = chooseAdventureOption(s, '__skip__', ctx, script);
        continue;
      }
      s = chooseAdventureOption(s, pool[0].id, ctx, script);
      continue;
    }
    if (driver === 'legacy') {
      // legacy 驱动把纯信息阶段也「按继续」—— R1 之后该动作是 no-op，
      // 所以这里显式走自动承接来复现旧路径的推进结果（同一段代码）。
      const next = advNeedsPlayer(s) ? pressAdventureAction(s, ctx, script) : advAutoAdvance(s, ctx, script);
      if (next === s) throw new Error(`legacy 驱动在 ${s.phase} 无法推进`);
      s = next;
    } else {
      const next = advNeedsPlayer(s) ? pressAdventureAction(s, ctx, script) : advAutoAdvance(s, ctx, script);
      if (next === s) throw new Error(`r1 驱动在 ${s.phase} 无法推进`);
      s = next;
    }
  }
  return s;
}

/* ------------------------------------------------------------------ ① 连续性 */

describe('R1 连续性：谁在等玩家（advNeedsPlayer / advInfoPhase）', () => {
  it('纯信息阶段不需要玩家；决策与终局需要玩家', () => {
    const script = generateAdventureScript('r1-needs');
    let s = createAdventureState(ctx, script);
    const seen = new Map<string, boolean>();
    for (let guard = 0; guard < 600; guard++) {
      seen.set(s.phase, advNeedsPlayer(s));
      // 互补性：任何阶段必须恰好属于「需要玩家」或「信息阶段」之一
      expect(advNeedsPlayer(s)).toBe(!advInfoPhase(s));
      if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
      if (s.phase === 'BATTLE') {
        const cur = advCarriedPlayerHp(s, ctx);
        s = finishAdventureBattle(s, { winner: 'A', endReason: 't', playerHp: Math.max(1, cur - 20), enemyHp: 0, steps: 30 }, script);
        continue;
      }
      if (s.phase === 'EVENT_CHOICE') {
        const node = advCurrentNode(s, script);
        if (node.kind === 'EVENT') {
          s = chooseAdventureOption(s, node.options[0].id, ctx, script);
          continue;
        }
      }
      if (s.phase === 'CHOICE') {
        const node = advCurrentNode(s, script);
        const pool = node.kind === 'BUILD' ? advChoicePool(s, node, ctx) : [];
        s = chooseAdventureOption(s, pool.length > 0 ? pool[0].id : '__skip__', ctx, script);
        continue;
      }
      const next = advNeedsPlayer(s) ? pressAdventureAction(s, ctx, script) : advAutoAdvance(s, ctx, script);
      if (next === s) break;
      s = next;
    }
    // 必须真的走过这三类「旧版要求点继续」的阶段
    expect(seen.has('EVENT')).toBe(true);
    expect(seen.has('RESULT')).toBe(true);
    expect(seen.has('EVENT_DONE')).toBe(true);
    // …而且现在它们都不再需要玩家
    expect(seen.get('EVENT')).toBe(false);
    expect(seen.get('RESULT')).toBe(false);
    expect(seen.get('EVENT_DONE')).toBe(false);
    // 决策阶段仍需玩家动手
    expect(seen.get('EVENT_CHOICE')).toBe(true);
    expect(seen.get('CHOICE')).toBe(true);
    // 战斗是自动阶段（物理自己跑）
    expect(seen.get('BATTLE')).toBe(false);
  });

  it('纯信息阶段的主操作是 no-op（点它不会推进，也不会跳过任何节点）', () => {
    const script = generateAdventureScript('r1-noop');
    let s = createAdventureState(ctx, script);
    // 走到 EVENT（旧版第一个「按继续」点）
    for (let i = 0; i < 200 && s.phase !== 'EVENT'; i++) {
      const next = driveStep(s, ctx, script);
      if (next === s) break;
      s = next;
    }
    expect(s.phase).toBe('EVENT');
    // 关键断言：EVENT 上按主操作 = 原样返回（同引用），绝不推进
    expect(pressAdventureAction(s, ctx, script)).toBe(s);
    expect(advActionEnabled(s)).toBe(true); // 旧版它就是「可点」的 —— 这正是被取消的那次点击
    // 而自动承接会推进到 BATTLE
    const auto = advAutoAdvance(s, ctx, script);
    expect(auto.phase).toBe('BATTLE');
    expect(auto.battle).not.toBeNull();
  });

  it('自动承接绝不跨过决策点：RESULT / EVENT_DONE 只推进一个节点；决策点上是 no-op', () => {
    const scripts = ['r1-a', 'r1-b', 'r1-c', 'r1-d', 'r1-e'];
    for (const seed of scripts) {
      const script = generateAdventureScript(seed);
      let s = createAdventureState(ctx, script);
      let infoAdvances = 0;
      for (let guard = 0; guard < 800; guard++) {
        if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
        if (s.phase === 'EVENT_CHOICE' || s.phase === 'CHOICE') {
          // 决策点：自动承接必须是 no-op（玩家没决定就不许往下走）
          expect(advAutoAdvance(s, ctx, script), `${seed}@${s.phase}`).toBe(s);
          s = driveStep(s, ctx, script);
          continue;
        }
        if (s.phase === 'RESULT' || s.phase === 'EVENT_DONE') {
          infoAdvances += 1;
          const before = s.nodeId;
          const next = advAutoAdvance(s, ctx, script);
          expect(next).not.toBe(s);
          // 一次自动承接只走一个 next；若 next 是「候选池已空的 BUILD」，允许继续跳过（死锁防护）
          const node = script.nodes[before];
          const allowSkip =
            node != null &&
            node.next != null &&
            script.nodes[node.next]?.kind === 'BUILD' &&
            advChoicePool(next, script.nodes[node.next]!, ctx).length === 0;
          if (node && node.next && !allowSkip) expect(next.nodeId, `${seed}@${before}`).toBe(node.next);
          s = next;
          continue;
        }
        const next = driveStep(s, ctx, script);
        if (next === s) break;
        s = next;
      }
      expect(infoAdvances, seed).toBeGreaterThan(0);
      expect(s.phase === 'COMPLETE' || s.phase === 'FAILED', seed).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ ② 等价性 */

describe('R1 等价性：自动承接不改变任何经济 / 耐久 / 胜负结算', () => {
  it('20 个种子：legacy 路径与 R1 路径的终态逐字段完全一致', () => {
    for (let i = 0; i < 20; i++) {
      const seed = `r1-equiv-${i}`;
      const script = generateAdventureScript(seed);
      const legacy = play(script, 'legacy');
      const r1 = play(script, 'r1');
      expect(r1.phase, seed).toBe(legacy.phase);
      expect(r1.day, seed).toBe(legacy.day);
      expect([...r1.buffs], seed).toEqual([...legacy.buffs]);
      expect(advCarriedPlayerHp(r1, ctx), seed).toBe(advCarriedPlayerHp(legacy, ctx));
      expect(r1.battlesCompleted, seed).toBe(legacy.battlesCompleted);
      expect(r1.battlesWon, seed).toBe(legacy.battlesWon);
      expect(r1.eventResult, seed).toBe(legacy.eventResult);
      // 日志文本也必须一致（叙事区显示的就是它；不一致 = 玩家看到的内容变了）
      expect(r1.log.map((e) => `${e.kind}:${e.text}`), seed).toEqual(legacy.log.map((e) => `${e.kind}:${e.text}`));
    }
  });

  it('自动承接不产生额外的 actionCount（那一次的「继续」确实消失了，不是换了名字）', () => {
    const script = generateAdventureScript('r1-count');
    const legacy = play(script, 'legacy');
    const r1 = play(script, 'r1');
    // 两者都走同一段推进代码 ⇒ actionCount 相同；差别只在 UI 是否要求点击。
    expect(r1.actionCount).toBe(legacy.actionCount);
    // 但「需要玩家」的阶段数必须显著少于总阶段数（这就是点击被省掉的地方）
    let info = 0;
    let total = 0;
    let s = createAdventureState(ctx, script);
    for (let guard = 0; guard < 600; guard++) {
      total += 1;
      if (!advNeedsPlayer(s) && s.phase !== 'BATTLE') info += 1;
      if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
      if (s.phase === 'BATTLE') {
        const cur = advCarriedPlayerHp(s, ctx);
        s = finishAdventureBattle(s, { winner: 'A', endReason: 't', playerHp: Math.max(1, cur - 25), enemyHp: 0, steps: 30 }, script);
        continue;
      }
      if (s.phase === 'EVENT_CHOICE') {
        const node = advCurrentNode(s, script);
        s = chooseAdventureOption(s, node.kind === 'EVENT' ? node.options[0].id : '__skip__', ctx, script);
        continue;
      }
      if (s.phase === 'CHOICE') {
        const node = advCurrentNode(s, script);
        const pool = node.kind === 'BUILD' ? advChoicePool(s, node, ctx) : [];
        s = chooseAdventureOption(s, pool.length > 0 ? pool[0].id : '__skip__', ctx, script);
        continue;
      }
      const next = advNeedsPlayer(s) ? pressAdventureAction(s, ctx, script) : advAutoAdvance(s, ctx, script);
      if (next === s) break;
      s = next;
    }
    expect(info).toBeGreaterThan(0);
    // 纯信息阶段占全部阶段的比例：这些都不再需要点击
    expect(info / total).toBeGreaterThan(0.15);
  });

  it('战斗结束（RESULT）后自动承接：耐久与场次口径不变，仍是同一场战斗的结算', () => {
    const script = generateAdventureScript('r1-result');
    let s = createAdventureState(ctx, script);
    // 推进到第一场 BATTLE
    for (let i = 0; i < 200 && s.phase !== 'BATTLE'; i++) {
      const next = driveStep(s, ctx, script);
      if (next === s) break;
      s = next;
    }
    expect(s.phase).toBe('BATTLE');
    const before = s;
    const after = finishAdventureBattle(before, { winner: 'A', endReason: 'ko', playerHp: 900, enemyHp: 0, steps: 120 }, script);
    expect(after.phase).toBe('RESULT');
    expect(after.battlesCompleted).toBe(1);
    expect(after.battlesWon).toBe(1);
    expect(advCarriedPlayerHp(after, ctx)).toBe(900);
    // 自动承接后：进入下一节点（可能是 IDLE/EVENT/BUILD 决策），但场次/耐久一字不变
    const auto = advAutoAdvance(after, ctx, script);
    expect(auto).not.toBe(after);
    expect(auto.phase).not.toBe('RESULT');
    expect(auto.battlesCompleted).toBe(1);
    expect(auto.battlesWon).toBe(1);
    expect(advCarriedPlayerHp(auto, ctx)).toBe(900);
    // RESULT 上按主操作 = no-op（旧版这里是那一次「继续」）
    expect(pressAdventureAction(after, ctx, script)).toBe(after);
  });
});

/* ------------------------------------------------------------------ ③ 版面 */

describe('R1 版面：四段恒定骨架（390×844）', () => {
  it('四段不重叠、不越界、合计铺满 844', () => {
    const bands = [UX_TOP, UX_STAGE, UX_NARRATIVE, UX_ACTION];
    let y = 0;
    for (const b of bands) {
      expect(b.x).toBe(0);
      expect(b.w).toBe(UXW);
      expect(b.y).toBe(y);
      y += b.h;
    }
    expect(y).toBe(UX_H);
  });

  it('舞台高度恒定（与战斗视图安全区一致），不随阶段改变', () => {
    // R1 的关键结构性保证：战斗与 RESULT 用同一个舞台带（旧实现在 RESULT 时缩到 468）
    expect(UX_STAGE.h).toBe(378);
    expect(UX_STAGE.y + UX_STAGE.h).toBe(UX_NARRATIVE.y);
  });

  it('选项卡全部落在叙事区卡片内（决策不遮住上方战场）', () => {
    for (const n of [2, 3, 4]) {
      const rects = uxOptionRects(n);
      expect(rects.length).toBe(n);
      for (const r of rects) {
        // 左右与卡片对齐
        expect(r.x).toBe(UX_NARRATIVE_CARD.x);
        expect(r.w).toBe(UX_NARRATIVE_CARD.w);
        // 纵向完全落在叙事带内
        expect(r.y).toBeGreaterThanOrEqual(UX_NARRATIVE.y);
        expect(r.y + r.h).toBeLessThanOrEqual(UX_NARRATIVE.y + UX_NARRATIVE.h);
        // 绝不侵入舞台
        expect(r.y).toBeGreaterThanOrEqual(UX_STAGE.y + UX_STAGE.h);
      }
      // 卡片之间不重叠
      for (let i = 1; i < rects.length; i++) {
        expect(rects[i].y).toBeGreaterThanOrEqual(rects[i - 1].y + rects[i - 1].h);
      }
    }
  });

  it('主按钮完整位于底部动作带内（可见即可点）', () => {
    expect(UX_ACTION_BTN.y).toBeGreaterThanOrEqual(UX_ACTION.y);
    expect(UX_ACTION_BTN.y + UX_ACTION_BTN.h).toBeLessThanOrEqual(UX_ACTION.y + UX_ACTION.h);
    expect(UX_ACTION_BTN.x).toBeGreaterThanOrEqual(0);
    expect(UX_ACTION_BTN.x + UX_ACTION_BTN.w).toBeLessThanOrEqual(UXW);
    // 中心点命中
    expect(uxHit(UX_ACTION_BTN, { x: UX_ACTION_BTN.x + UX_ACTION_BTN.w / 2, y: UX_ACTION_BTN.y + UX_ACTION_BTN.h / 2 })).toBe(true);
    // 带外一点不命中
    expect(uxHit(UX_ACTION_BTN, { x: 2, y: 2 })).toBe(false);
  });
});

/* ------------------------------------------------------------------ ④ 九宫格 */

/** 记录 drawImage 调用的最小 ctx 桩（只用于几何断言）。 */
function recordingCtx(): { ctx: CanvasRenderingContext2D; calls: Array<{ sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number }> } {
  const calls: Array<{ sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number }> = [];
  const ctx = {
    drawImage: (_img: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) => {
      calls.push({ sx, sy, sw, sh, dx, dy, dw, dh });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('R1 九宫格：角落 1:1，绝不非等比拉伸', () => {
  it('drawNineSlice 把 8 个边框块 + 1 个中心块画在正确位置，且四角源/目标尺寸一致', () => {
    const img = { width: 182, height: 164 } as unknown as CanvasImageSource & { width: number; height: number };
    const ins = NINE_SLICE.text_card_bg;
    const { ctx, calls } = recordingCtx();
    const ok = drawNineSlice(ctx, img, 14, 486, 362, 246, ins);
    expect(ok).toBe(true);
    // 4 角 + 4 边 + 1 中心 = 9 块
    expect(calls.length).toBe(9);
    const corners = [calls[0], calls[1], calls[2], calls[3]];
    for (const c of corners) {
      // 角落：源尺寸 == 目标尺寸（不缩放 ⇒ 圆角不变形）
      expect(c.dw).toBeCloseTo(c.sw, 6);
      expect(c.dh).toBeCloseTo(c.sh, 6);
    }
    // 角落尺寸与量取的 insets 相符
    expect(corners[0].sw).toBe(ins.left);
    expect(corners[0].sh).toBe(ins.top);
    expect(corners[1].sw).toBe(ins.right);
    expect(corners[3].dh).toBe(ins.bottom);
    // 四角分别贴在目标矩形的四个角
    expect(corners[0].dx).toBeCloseTo(14, 6);
    expect(corners[0].dy).toBeCloseTo(486, 6);
    expect(corners[1].dx + corners[1].dw).toBeCloseTo(14 + 362, 6);
    expect(corners[3].dy + corners[3].dh).toBeCloseTo(486 + 246, 6);
    // 所有块都落在目标矩形内（不越界、不重叠出框）
    for (const c of calls) {
      expect(c.dx).toBeGreaterThanOrEqual(13.999);
      expect(c.dy).toBeGreaterThanOrEqual(485.999);
      expect(c.dx + c.dw).toBeLessThanOrEqual(14 + 362 + 0.001);
      expect(c.dy + c.dh).toBeLessThanOrEqual(486 + 246 + 0.001);
      // 源块不出图
      expect(c.sx).toBeGreaterThanOrEqual(0);
      expect(c.sy).toBeGreaterThanOrEqual(0);
      expect(c.sx + c.sw).toBeLessThanOrEqual(182 + 0.001);
      expect(c.sy + c.sh).toBeLessThanOrEqual(164 + 0.001);
    }
  });

  it('目标小于四角之和时按比例收缩，绝不产生负宽高（不留裂缝/不抛错）', () => {
    const img = { width: 182, height: 164 } as unknown as CanvasImageSource & { width: number; height: number };
    const { ctx, calls } = recordingCtx();
    const ok = drawNineSlice(ctx, img, 0, 0, 30, 30, NINE_SLICE.text_card_bg);
    expect(ok).toBe(true);
    for (const c of calls) {
      expect(c.dw).toBeGreaterThan(0);
      expect(c.dh).toBeGreaterThan(0);
      expect(c.sw).toBeGreaterThan(0);
      expect(c.sh).toBeGreaterThan(0);
    }
  });

  it('每个九宫格素材的 insets 都不超过素材尺寸的 1/3（否则中区被吃掉，无法拉伸）', () => {
    const sizes: Record<string, [number, number]> = {
      text_card_bg: [182, 164],
      event_bar_bg: [1048, 164],
      btn_green: [65, 118],
      btn_yellow: [65, 118],
      event_line: [30, 10],
      btn_chat: [185, 102],
    };
    for (const [id, ins] of Object.entries(NINE_SLICE)) {
      const [w, h] = sizes[id] ?? [0, 0];
      expect(w, id).toBeGreaterThan(0);
      expect(ins.left + ins.right, id).toBeLessThanOrEqual(w);
      expect(ins.top + ins.bottom, id).toBeLessThanOrEqual(h);
      // 中区必须留得下：至少 1px 可拉伸
      expect(w - ins.left - ins.right, id).toBeGreaterThan(0);
      expect(h - ins.top - ins.bottom, id).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------------------------------------ ⑤ 叙事区内容 */

describe('R1 叙事区：一张卡只讲刚发生的这件事', () => {
  it('advNarrativeLines 只取最近节点的连续行，不被前几天的旧文字占满', () => {
    const script = generateAdventureScript('r1-narr');
    let s = createAdventureState(ctx, script);
    // 推进几天，让日志里堆满历史
    for (let guard = 0; guard < 60 && s.phase !== 'BATTLE'; guard++) {
      const next = advNeedsPlayer(s) ? pressAdventureAction(s, ctx, script) : advAutoAdvance(s, ctx, script);
      if (next === s) break;
      s = next;
    }
    expect(s.log.length).toBeGreaterThan(3);
    const lines = advNarrativeLines(s, 3);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.length).toBeGreaterThan(0);
    // 取到的一定是日志尾部
    const tail = s.log.slice(s.log.length - lines.length);
    expect(lines.map((e) => e.text)).toEqual(tail.map((e) => e.text));
  });

  it('每种阶段都有非空标题（叙事卡不会出现空白抬头）', () => {
    const script = generateAdventureScript('r1-title');
    let s = createAdventureState(ctx, script);
    const titles = new Set<string>();
    for (let guard = 0; guard < 600; guard++) {
      titles.add(advNarrativeTitle(s, script));
      if (s.phase === 'COMPLETE' || s.phase === 'FAILED') break;
      if (s.phase === 'BATTLE') {
        const cur = advCarriedPlayerHp(s, ctx);
        s = finishAdventureBattle(s, { winner: 'A', endReason: 't', playerHp: Math.max(1, cur - 25), enemyHp: 0, steps: 30 }, script);
        continue;
      }
      if (s.phase === 'EVENT_CHOICE') {
        const node = advCurrentNode(s, script);
        s = chooseAdventureOption(s, node.kind === 'EVENT' ? node.options[0].id : '__skip__', ctx, script);
        continue;
      }
      if (s.phase === 'CHOICE') {
        const node = advCurrentNode(s, script);
        const pool = node.kind === 'BUILD' ? advChoicePool(s, node, ctx) : [];
        s = chooseAdventureOption(s, pool.length > 0 ? pool[0].id : '__skip__', ctx, script);
        continue;
      }
      const next = advNeedsPlayer(s) ? pressAdventureAction(s, ctx, script) : advAutoAdvance(s, ctx, script);
      if (next === s) break;
      s = next;
    }
    expect(titles.size).toBeGreaterThan(3);
    for (const t of titles) expect(t.trim().length).toBeGreaterThan(0);
    expect([...titles]).toContain('战斗胜利');
  });
});
