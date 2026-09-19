/**
 * PRP-F0-RUN-PAGE-SHELL｜Portrait Run Prototype 入口（独立页面：/run-page.html）。
 *
 * 这是**玩家视角**的入口：默认打开即是 Run Page，页面上不存在任何开发控制
 * （Arena / Loadout / Encounter / Start / Reset / Gate 全部留在独立入口
 *  `portrait-lab.html` —— 那个页面才是 Debug control area）。
 *
 * 与正式入口 `src/main.ts` 完全隔离：不 import 平台 bootstrap、不 import
 * PlayerGameRuntime / Renderer / 任何一个正式玩法模块 —— 正式 Home / Garage /
 * Matching / Battle / Result 的默认路径不被本原型写入。
 *
 * ── PRODUCT-LOOP-R1-B：本文件同时是**产品奖励出口的宿主** ─────────────────────
 * 三条参数齐备时（`?run=<token>&reward=<defId>&back=<href>`）本页进入**产品奖励模式**：
 *   RUN COMPLETE → 页面多一张「本局获得」卡片 + 动作变「领取并返回」；
 *   点击 → `RunPage` **先 dispose 运行期**，然后把出口请求交给本宿主 → 本宿主执行
 *   **整页导航**到 `back`。奖励**入库**发生在导航之后（产品侧 Profile Repository 幂等执行）。
 *
 * 为什么导航必须在这里（而不是 `runPage.ts`）：
 *   `runPage.ts` 与正式玩家页面共用，`RP-25` 机器禁止它写 `location` / `history`
 *   ⇒ 页面结构上无法跳转；整页导航是**宿主**的职责（口径同 `nextRunMain.ts`）。
 *
 * ⚠️ 本文件**不硬编码任何产品地址**：`back` 由产品侧通过 URL 给全（`RP-25b` 机器钉死），
 *    因此 Lab 侧不存在第二个产品 URL 真源。
 *
 * 开发：`npm run dev:run-page` → http://127.0.0.1:5173/run-page.html
 * 构建：`npm run build:portrait-lab` → dist-portrait-lab/（含 run-page.html）
 *
 * 整块删除清单见本目录 constants.ts 头部注释。
 */
import { RunPage } from './runPage';
import { parseRunProductReward, type RunProductClaim } from './runProductReward';

/** Run Page 专属只读诊断句柄（仅本原型页面存在；不进入任何正式构建产物）。 */
interface RunPageDebugHandle {
  probe: () => unknown;
}

function boot(): void {
  const root = document.getElementById('run-root');
  if (!root) {
    // 页面缺失容器：明确报错（不静默白屏）
    throw new Error('[PRP-F0] 未找到 #run-root 容器');
  }

  /*
    PRODUCT-LOOP-R1-B｜产品上下文是**可选**的：
      - 无参数 / 参数不全 / 奖励 id 解析不出真实部件 → `null`
        ⇒ 本页行为与 PRP-RUN-02 **逐像素相同**（默认完整 Run 流程，终点可开新局）；
      - 三个参数齐备 → 进入产品奖励模式（只在 RUN COMPLETE 生效）。
  */
  const productReward = parseRunProductReward(window.location.search);

  const page = new RunPage(root, {
    productReward,
    /*
      ⚠️ 整页导航 = **文档销毁** ⇒ 战斗运行时 / 弹丸 / 接触记录 / 计时器 / 监听器
         随文档一起消失（比手动逐个 dispose 更强的清理保证）。而 `RunPage` 在调用本回调
         **之前**已经 dispose 过一次 —— 双保险，且不依赖导航一定成功。
      ⚠️ 目标地址来自**出口请求本身**（`claim.href` = 产品侧给的全量地址），本文件里
         出现不了任何产品 URL 字面量。
    */
    onProductClaim: productReward
      ? (claim: RunProductClaim) => {
          window.location.assign(claim.href);
        }
      : null,
  });
  (globalThis as { __RUNPAGE__?: RunPageDebugHandle }).__RUNPAGE__ = { probe: () => page.probe() };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
