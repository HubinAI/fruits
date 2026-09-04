/**
 * F-WX-IOS-RESUME-VIEWPORT-P0｜微信视口同步唯一入口（syncWechatViewport）。
 *
 * 事故背景：iOS 微信切后台再返回后，画面出现跨层错乱（顶栏/底栏/车辆/场景缺失、偏移、
 * 裁切），只有回到 Home 才恢复。旧接线（game.ts）onShow 只做 reframePlayerCamera、
 * onWindowResize 存在「同尺寸早退」，两个入口各自为政：
 *
 *  1. onShow 不重读 windowInfo、不同步 canvas backing → iOS 竖屏过渡（window 短暂报
 *     390×844）期间 window 域 ≠ surface 域；backing 内容被系统清空/重置后无人重建；
 *  2. onWindowResize「w/h 与当前 backing 相同 → return」→ backing 内容被清空但尺寸
 *     不变时直接跳过；
 *  3. 竖屏 transient 值被立即提交 → 用临时 portrait 尺寸永久污染 backing。
 *
 * 本模块建立【唯一入口】：所有 onShow / onWindowResize / transient 重试统一走
 * syncWechatViewport(reason)，按固定顺序原子完成（Queue 三节 1~11 步）：
 *
 *   1. 读取并归一 windowInfo（readWechatWindowInfo）；
 *   2. 判断横屏值是否稳定有效（竖屏/正方形 → transient，不提交，有限帧重试）；
 *   3. 同步 screenCanvas backing（window × dpr；同尺寸也重设 → 清空旧位图 + 重置 ctx，
 *      不依赖旧像素残留）；
 *   4. 同步 uiCanvas backing（与 screen 完全一致）；
 *   5. WechatViewport.surface logical：实时 getter（canvas.width ÷ dpr），无需写回；
 *   6. PlayerViewportTransform：微信端未实例化（Web 玩家模式专用）→ 契约 no-op；
 *   7. 通知 Renderer resize：runtime.doResize()（battle.resize + 重构图）；
 *   8. UI Host ensureSize + 强制 dirty/redraw（forceRedraw，下一帧完整重绘）；
 *   9. 清 identity 后重新 composite：canvas.width 重设会把 ctx 重置为 identity——
 *      显式重设两块 ctx 为 DPR 单次变换（logical→backing 唯一最终转换）；
 *  10. 最后按当前 phase reframe camera（doResize 内部含 reframePlayerCamera）；
 *  11. 完成后才恢复/继续 SingleLoop（loop.start + request，至多一个 pending frame）。
 *
 * 竖屏过渡处理（Queue 四节）：游戏固定横屏 → 读到竖屏/极端比例时【不】立即提交最终
 * viewport；在有限帧内（maxTransientRetries × transientRetryMs）重新读取直到获得稳定
 * landscape（明确 onWindowResize landscape 事件会立即提交）；过渡期间保持上一张合法
 * 横屏 backing + 不恢复 loop（画面冻结在上一张横屏，不闪出放大裁切的错误画面）。
 *
 * 状态冻结（Queue 六节）：本入口不重置 playerPhase/battleState、不新建 Battle session、
 * 不重复结算、不重匹配、不重复启动 rAF（loop.start 幂等 + request 幂等）、不创建音频
 * 调度——只同步「窗口尺寸/backing/ctx/取景/重绘」。
 *
 * 坐标域契约（playbook 4.2，禁止改动）：window logical = 844×390；canvas backing =
 * window × dpr；surface logical = backing ÷ dpr = window；DPR 只在最终绘制时应用一次。
 */
import type { WechatWindowInfo } from './windowInfo';

/** 触发来源：show（后台→前台）/ resize（wx.onWindowResize）/ show-retry（transient 重试） */
export type ViewportSyncReason = 'show' | 'resize' | 'show-retry';

/** 最小 2D ctx（仅用 setTransform；真实 wx canvas 与 FakeCanvas 均满足） */
export interface SyncCanvas2DCtx {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
}
/** 最小 canvas（width/height 可写 + getContext('2d')） */
export interface SyncCanvasLike {
  width: number;
  height: number;
  getContext(kind: string): SyncCanvas2DCtx | null;
}

/** syncWechatViewport 目标依赖（game.ts 注入；全部真实对象引用） */
export interface ViewportSyncTargets {
  /** 唯一上屏 Canvas（game.ts 第一次 wx.createCanvas()） */
  screenCanvas: SyncCanvasLike;
  /** UI 离屏 Canvas（game.ts 第二次 createCanvas） */
  uiCanvas: SyncCanvasLike;
  /** UI Host：forceRedraw() 置 dirty 强制整页重绘（不触碰任何状态） */
  uiHost: { forceRedraw(): void };
  /** Gameplay Runtime：doResize() = battle.resize + reframePlayerCamera */
  runtime: { doResize(): void };
  /** SingleLoop：start() 置 running；request() 幂等补帧（至多一个 pending frame） */
  loop: { start(): void; request(): void };
  /** 微信窗口信息唯一来源（readWechatWindowInfo） */
  readWindowInfo: () => WechatWindowInfo | null;
  /** 竖屏 transient 最大重试次数（默认 5；每次间隔 transientRetryMs） */
  maxTransientRetries?: number;
  /** 竖屏 transient 重试间隔 ms（默认 100） */
  transientRetryMs?: number;
  /** 重试调度器（game.ts=setTimeout；测试=可控 fake timer） */
  scheduleRetry?: (fn: () => void, ms: number) => unknown;
}

/** 一次同步的结果（诊断/测试只读） */
export interface ViewportSyncResult {
  reason: ViewportSyncReason;
  /** true = 本次提交了 viewport（backing 已同步）；false = transient 待定/无信息 */
  committed: boolean;
  /** window 逻辑 + dpr（本次读取） */
  window?: { w: number; h: number; dpr: number };
  /** 提交后的 backing（backing px） */
  backing?: { w: number; h: number };
  /** transient 重试计数（>0 = 已进入竖屏待定） */
  transientPending?: number;
}

/** 创建唯一视口同步入口（挂到 game.ts；所有 onShow/onWindowResize 复用，不允许两套尺寸逻辑） */
export function createViewportSync(targets: ViewportSyncTargets): {
  syncWechatViewport: (reason: ViewportSyncReason) => ViewportSyncResult;
  /** 当前 transient 待定计数（只读诊断） */
  readonly transientPending: number;
} {
  const maxRetries = targets.maxTransientRetries ?? 5;
  const retryMs = targets.transientRetryMs ?? 100;
  const schedule = targets.scheduleRetry ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  let transientPending = 0;

  /** 重设 backing（width/height 同值也重设：清空旧位图 + 重置 ctx 为 identity） */
  function resetBacking(canvas: SyncCanvasLike, w: number, h: number): void {
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx?.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** 恢复 DPR 单次变换（logical→backing 唯一最终转换；canvas.width 重设后 ctx 为 identity） */
  function applyDprTransform(canvas: SyncCanvasLike, dpr: number): void {
    const ctx = canvas.getContext('2d');
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function syncWechatViewport(reason: ViewportSyncReason): ViewportSyncResult {
    // —— 1. 读取并归一 windowInfo ——
    const info = targets.readWindowInfo();
    if (!info || info.windowWidth <= 0 || info.windowHeight <= 0) {
      return { reason, committed: false };
    }
    const w = info.windowWidth;
    const h = info.windowHeight;
    const dpr = info.pixelRatio || 1;

    // —— 2. 判断横屏值是否稳定有效 ——
    // 游戏固定横屏：任何「宽 ≤ 高」（竖屏/正方形）窗口值都是 transient——
    // 不立即提交最终 viewport，在有限帧内重读直到获得稳定 landscape（Queue 四节）。
    const isStableLandscape = w > h;
    if (!isStableLandscape) {
      transientPending++;
      if (transientPending <= maxRetries) {
        schedule(() => syncWechatViewport('show-retry'), retryMs);
        return { reason, committed: false, window: { w, h, dpr }, transientPending };
      }
      // 超过最大重试仍竖屏（异常环境）：防御性按当前 window 提交（真实固定横屏不达）
      transientPending = 0;
    } else {
      transientPending = 0;
    }

    // —— 3/4. 同步两块 Canvas backing（window × dpr；同尺寸也重设 → 不依赖旧像素） ——
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    resetBacking(targets.screenCanvas, bw, bh);
    resetBacking(targets.uiCanvas, bw, bh);

    // —— 5. WechatViewport.surface logical：实时 getter（canvas.width ÷ dpr），无需写回 ——
    // —— 6. PlayerViewportTransform：微信端未实例化（Web 玩家模式专用）→ 契约 no-op ——

    // —— 7/10. Renderer resize + 按当前 phase reframe camera（doResize 内含 reframePlayerCamera） ——
    // F-WX-RESUME-RENDER-STATE-P0：doResize 失败不得阻断 resume 恢复——
    // 否则 loop 停摆 + 画面冻结/跨页泄漏（见调查报告 §3）。恢复动作置于 finally，
    // 无论 doResize 成败都执行（仅触达 lifecycle/renderer reset/binding；不碰冻结项）。
    try {
      targets.runtime.doResize();
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[WX-RESUME] syncWechatViewport: runtime.doResize failed during resume; recovery still applied', err);
      }
    } finally {
      // —— 8. UI Host ensureSize（下一帧 draw 顶部）+ 强制 dirty/redraw ——
      targets.uiHost.forceRedraw();

      // —— 9. ctx transform 恢复为 DPR 单次变换（清 identity 后重新 composite 由下一帧完成） ——
      applyDprTransform(targets.screenCanvas, dpr);
      applyDprTransform(targets.uiCanvas, dpr);

      // —— 11. 完成后才恢复/继续 SingleLoop（start 幂等 + request 至多一个 pending frame） ——
      targets.loop.start();
      targets.loop.request();
    }

    return { reason, committed: true, window: { w, h, dpr }, backing: { w: bw, h: bh } };
  }

  return {
    syncWechatViewport,
    get transientPending() {
      return transientPending;
    },
  };
}
