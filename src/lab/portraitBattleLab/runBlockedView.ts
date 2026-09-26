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
 * ⚠️ PRODUCT-LOOP-R6-RUN-WEAPON-SOURCE-OF-TRUTH：拒绝的**理由**已经变了 ——
 *    不再是「你装的不是 Cannon」（Run 现在以玩家实际装备的那件武器为自己的运行 base），
 *    而是「车上**没有**任何正式武器」。因此这里**不再点名任何武器 id**
 *    （改前从 `RUN_BASE_WEAPON_DEF_ID` 现读 cannon 拼进文案；现在那个常量是
 *    「R2 武器强化体系的归属武器」，与资格无关，再引用它就是把两件事混起来）。
 */

import type { RunLoadoutResolution } from './runPageScene';
import type { RunFailReturn } from './runFailSettlement';

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
  // ⚠️ PRODUCT-LOOP-R6：两种拒绝理由分开说 —— 「车上没有武器」与「这件武器还没有
  //    完整的战斗 Runtime」是不同的事，混成一句会让玩家找不到原因。
  lead.textContent =
    reason === 'no-weapon-runtime'
      ? '当前原型的完整冒险还用不了这件武器 —— 它还没有完整的战斗 Runtime。'
      : '当前原型的完整冒险要求车上装有一件正式武器；你的车目前没有可运行的武器。';
  lead.style.cssText = 'margin:0;font-size:14px;line-height:1.6;color:#c8d3e4;';

  const hint = document.createElement('p');
  hint.textContent = '请返回主界面更换战车装备后再出发 —— 这一局没有开始，也没有进入任何一天。';
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
