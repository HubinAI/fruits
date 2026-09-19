/**
 * PRODUCT-LOOP-R1-A/B｜产品首页入口壳（`home.html` 的 `<script type="module">`）。
 *
 * 分工（与 `runPage.ts` / `runMain.ts` 同一套路）：
 *   - `homePage.ts`  = 页面逻辑（**模块级零 DOM**，可在 node 下直接 import 做单测）；
 *   - `homeMain.ts`  = 入口壳：找容器 → 读 URL → 挂载。**只有壳能读 `location`**。
 *
 * PRODUCT-LOOP-R1-B｜为什么读 URL 放在壳里：
 *   玩家点 Run 的「领取并返回」后会落回 `./home.html?run=<token>&reward=<defId>`。
 *   读 `location.search` 需要 DOM 全局 —— 放进页面逻辑会让「页面可在 node 下 import」
 *   这条不变量失效（本项目的页面模块级零 DOM 铁律）。
 *
 * ⚠️ 壳只把 URL **原样**交给页面（一个字符串），自己**解析都不做**：
 *    解析是纯函数（`parsePendingClaim`），属于产品逻辑层 ⇒ 壳的 import 清单保持
 *    「只 import 页面模块本身」不变（A 段的 `PL-26c` 守卫因此**不需要放宽**）。
 * ⚠️ 壳不做任何业务判断：不校验奖励是否合法、不决定发不发奖 —— 那由 Profile Repository 判。
 */
import { mountProductHome } from './homePage';

function boot(): void {
  const root = document.getElementById('ph-root');
  if (!root) {
    // 页面缺失容器：明确报错（不静默白屏）
    throw new Error('[PRODUCT-LOOP] 未找到 #ph-root 容器');
  }
  // 无参数 → 空串 ⇒ 页面按「正常打开首页」处理（与 A 段行为完全一致）
  mountProductHome(root, { search: window.location.search });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
