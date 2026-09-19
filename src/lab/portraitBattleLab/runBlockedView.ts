/**
 * PRODUCT-LOOP-P0-RUN-BUILD-LOADOUT-COMPATIBILITY｜**Run 创建被拒绝**时的呈现。
 *
 * ── 为什么单独成一个模块 ────────────────────────────────────────────────────
 * `runMain.ts` 是宿主，但它被 `RP-25b` 用**比页面文件更严**的断言钉住：
 * 「只允许两次数据驱动的整页导航」且**文件里不得出现 `createElement`** ——
 * 宿主的职责是「读 URL、解析、导航」，不该顺手造 UI。
 * ⇒ 拒绝态的可视化搬到这里，`runMain.ts` 只负责「判定拒绝 + 交给本模块 + 不再创建 Run」。
 *
 * ⚠️ 本文件登记在 `tests/portraitRunPage.test.ts` 的 `RUN_PAGE_FILES` 里
 *    （与 R1-D 的失败结算模块同一处置）⇒ 自动受 RP-24 / RP-25 / RP-25b 的全部禁令：
 *    不引用 Arena / Gate / Lab 控制器 / 俯视驱动、不建 `<button>`、不写 location / history。
 *    出口只用 `<a href>`（`PL-29` 的同一口径），因此这里**没有任何导航能力**。
 *
 * ── 三条硬约束 ──────────────────────────────────────────────────────────────
 *   ① **不硬编码任何产品地址**（`RP-25b`）：唯一出口地址来自链接本身
 *      （`home` 参数 → `failReturn.href`，由**产品侧给全**）；没有它就不画链接，
 *      绝不画一个点了没反应的按钮。
 *   ② **不引入 `<button>`**（`e2e:encounter-lab` 的 J4 钉死「玩家页面里没有测试控件」）
 *      ⇒ 出口一律 `<a href>`。
 *   ③ **可被机器观测**：`data-run-blocked` 落在 DOM 上，同一份事实也放进只读句柄
 *      `__RUNBLOCKED__` ⇒ E2E 不需要靠文案断言。
 *
 * ⚠️ 文案里的「基准武器」从真源（`RUN_BASE_WEAPON_DEF_ID`）现读，不硬编码武器 id。
 */

import type { RunLoadoutResolution } from './runPageScene';
import type { RunFailReturn } from './runFailSettlement';
import { RUN_BASE_WEAPON_DEF_ID } from './runModifiers';

/** 拒绝态的只读诊断句柄（仅供本原型页面 / E2E 断言；不进入任何正式构建产物）。 */
export interface RunBlockedHandle {
  readonly blocked: true;
  readonly reason: string;
  readonly fallback: string;
  readonly returnHref: string | null;
}

/**
 * 渲染「本次冒险无法开始」。
 *
 * 这一条路径**不会创建 RunPage** ⇒ 没有战斗运行时、没有 DAY、没有 canvas ——
 * 结构上不可能再出现真人 P0 那条「跑到 DAY3 才 throw」。
 */
export function renderRunBlocked(
  root: HTMLElement,
  resolution: RunLoadoutResolution,
  failReturn: RunFailReturn | null,
): void {
  const reason = resolution.blockedReason ?? 'unknown';
  const box = document.createElement('div');
  box.className = 'run-blocked';
  box.dataset['runBlocked'] = '1';
  box.dataset['runBlockedReason'] = reason;
  box.dataset['runLoadoutFallback'] = resolution.fallback;
  box.style.cssText =
    'box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;' +
    'justify-content:center;gap:12px;padding:24px;font-family:system-ui,sans-serif;' +
    'color:#eaf1fb;background:#12161f;text-align:center;';

  const title = document.createElement('h1');
  title.textContent = '本次冒险无法开始';
  title.style.cssText = 'margin:0;font-size:20px;font-weight:700;';

  const lead = document.createElement('p');
  lead.textContent =
    `当前原型的完整冒险只支持正式基准武器（${RUN_BASE_WEAPON_DEF_ID}）；` +
    '你车上的装备不满足这个前提。';
  lead.style.cssText = 'margin:0;font-size:14px;line-height:1.6;color:#c8d3e4;';

  const hint = document.createElement('p');
  hint.textContent = '请返回主界面更换主武器后再出发 —— 这一局没有开始，也没有进入任何一天。';
  hint.style.cssText = 'margin:0;font-size:14px;line-height:1.6;color:#c8d3e4;';

  box.append(title, lead, hint);

  if (failReturn) {
    const back = document.createElement('a');
    back.textContent = '返回主界面';
    back.href = failReturn.href;
    back.dataset['runBlockedReturn'] = '1';
    back.style.cssText =
      'display:inline-block;align-self:center;margin-top:8px;padding:10px 18px;' +
      'border-radius:8px;background:#ffd35a;color:#12161f;font-weight:650;text-decoration:none;';
    box.append(back);
  }

  root.append(box);
  (globalThis as { __RUNBLOCKED__?: RunBlockedHandle }).__RUNBLOCKED__ = {
    blocked: true,
    reason,
    fallback: resolution.fallback,
    returnHref: failReturn ? failReturn.href : null,
  };
}
