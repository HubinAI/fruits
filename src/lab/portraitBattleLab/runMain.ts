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
 * ── PRODUCT-LOOP-R2-A：本文件同时是**3选1 奖励出口的宿主** ───────────────────
 * 两个参数齐备时（`?run=<token>&choices=<JSON>`）本页进入**产品奖励模式**：
 *   RUN COMPLETE → 页面呈现**三张候选卡**（名称 / ★ / 当前数量 → 领取后数量），
 *   点中哪一件 → `RunPage` **先 dispose 运行期**，然后把出口请求交给本宿主 → 本宿主执行
 *   **整页导航**到**那一件自己的地址**（`choices[].href`，产品侧给全）。
 *   奖励**入库**发生在导航之后（产品侧 Profile Repository 幂等执行，同一 Run token 只入账一次）。
 *
 * 为什么导航必须在这里（而不是 `runPage.ts`）：
 *   `runPage.ts` 与正式玩家页面共用，`RP-25` 机器禁止它写 `location` / `history`
 *   ⇒ 页面结构上无法跳转；整页导航是**宿主**的职责（口径同 `nextRunMain.ts`）。
 *
 * ── PRODUCT-LOOP-R1-C：本文件同时是**局外装备的交接口** ─────────────────────
 * 链接里带 `equipped`（产品侧把当前 Player Profile Equipped 的整份 `BuildDraft`
 * 编成 JSON 交进来）时，本宿主解析它并注入 `RunPage` ⇒ 本局战斗的玩家车辆**从这份
 * Loadout 构建**（Queue 必改 2）。缺省（不带该参数）⇒ 既有演示装载，研发入口逐像素不变。
 *
 * ⚠️ 解析放在 Lab 侧的 `runPlayerLoadout.ts`（纯逻辑），导航 / URL 读取放在本宿主：
 *    `runPage.ts` 与正式玩家页面共用，必须结构上无法跳转、也不读 URL。
 * ⚠️ 本文件**不硬编码任何产品地址**：三条候选地址由产品侧通过 `choices` 载荷给全
 *    （`RP-25b` 机器钉死），因此 Lab 侧不存在第二个产品 URL 真源。
 *
 * ── PRODUCT-LOOP-R1-D：本文件同时是**失败出口**的宿主 ───────────────────────
 * 链接里带 `home`（产品侧给的**纯首页地址**，不带任何领奖参数）时：
 *   RUN FAILED → 页面呈现失败结算 + 唯一主 CTA「返回主界面」；
 *   点击 → `RunPage` **先 dispose 运行期**，然后把出口请求交给本宿主 → 本宿主执行
 *   **整页导航**到 `home`。
 * ⚠️ 失败链**结构上拿不到** COMPLETE 的候选地址（`choices` 载荷对它没有作用：
 *    `rewardChoiceViews()` 先查 `runComplete`）⇒ 「失败也发奖」不可能发生（必改 5）。
 * ⚠️ 本宿主**没有**任何「失败后重开一局」的分支（Queue 必改 6）。
 * ⚠️ 不带 `home`（研发入口）⇒ 失败结算照常呈现，但**不画按钮**。
 *
 * 开发：`npm run dev:run-page` → http://127.0.0.1:5173/run-page.html
 * 构建：`npm run build:portrait-lab` → dist-portrait-lab/（含 run-page.html）
 *
 * 整块删除清单见本目录 constants.ts 头部注释。
 */
import { RunPage } from './runPage';
import { parseRunFailReturn, type RunFailReturn } from './runFailSettlement';
import { parseRunRewardChoices, type RunProductClaim } from './runProductReward';
import { resolveRunPlayerLoadout } from './runPageScene';

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
    PRODUCT-LOOP-R2-A｜产品上下文是**可选**的：
      - 无参数 / 参数不全 / 候选全坏（解析不出任何真实部件）→ `null`
        ⇒ 本页行为与 PRP-RUN-02 **逐像素相同**（默认完整 Run 流程，终点可开新局）；
      - `run` + `choices` 齐备且至少一条候选合法 → 进入产品奖励模式（只在 RUN COMPLETE 生效）。
  */
  const rewardChoices = parseRunRewardChoices(window.location.search);
  /*
    PRODUCT-LOOP-R1-C｜本局玩家装载（局外 Equipped）同样是**可选**的：
      - 带 `equipped` 且能过正式校验 → `{ source:'profile', fallback:'none' }`
        ⇒ 本局战斗的玩家车辆从**这份** Loadout 构建（Queue 必改 2）；
      - 不带 → `{ source:'demo', fallback:'no-param' }`（研发入口原行为）；
      - 带了但坏了 → `{ source:'demo', fallback:'invalid' }` —— **如实上报给探针**，
        绝不静默当成正常（那一局跑的就不是玩家身上那件，属真实异常）。
  */
  const playerLoadout = resolveRunPlayerLoadout(window.location.search);

  /*
    PRODUCT-LOOP-R1-D｜失败回程地址（可选）：
      - 带 `home` → 本局失败时页面的唯一出口是「返回主界面」→ 本宿主执行整页导航回产品首页；
      - 不带（研发入口 `/run-page.html`）→ `null` ⇒ 失败结算**照常呈现**，但不画按钮
        （绝不画一个点了没反应的按钮）。
    ⚠️ `home` 与 COMPLETE 的候选地址是**两类不同的地址**：候选地址会触发入库，`home` 不会
       —— 「失败不发永久奖励」在地址层上就是靠这条区分（失败链拿不到候选地址）。
    ⚠️ 目标地址来自**出口请求本身**（`action.href` = 产品侧给的全量地址），本文件里
       出现不了任何产品 URL 字面量（`RP-25b` 钉死）。
  */
  const failReturn = parseRunFailReturn(window.location.search);

  const page = new RunPage(root, {
    rewardChoices,
    playerLoadout,
    failReturn,
    /*
      ⚠️ 整页导航 = **文档销毁** ⇒ 战斗运行时 / 弹丸 / 接触记录 / 计时器 / 监听器
         随文档一起消失（比手动逐个 dispose 更强的清理保证）。而 `RunPage` 在调用本回调
         **之前**已经 dispose 过一次 —— 双保险，且不依赖导航一定成功。
      ⚠️ 目标地址来自**出口请求本身**（`claim.href` = 产品侧给的那一件的全量地址），
         本文件里出现不了任何产品 URL 字面量。
      ⚠️ **选中即锁定**：本宿主不缓存、不改写选中结果；同一 Run 的重复入账由产品侧
         账本（`grantedRunIds`）幂等挡住，不靠本文件。
    */
    onProductClaim: rewardChoices
      ? (claim: RunProductClaim) => {
          window.location.assign(claim.href);
        }
      : null,
    /*
      PRODUCT-LOOP-R1-D｜失败终态的唯一出口：清理运行期（`RunPage.requestFailReturn`
      里已 `dispose()`）之后，整页导航回正式首页 —— **不带任何领奖参数**。
      ⚠️ 这里**没有**、也不会出现「重开一局」的分支（Queue 必改 6：新 Run 只能由玩家
         回首页后重新点「开始冒险」创建）。
    */
    onFailReturn: failReturn
      ? (action: RunFailReturn) => {
          window.location.assign(action.href);
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
