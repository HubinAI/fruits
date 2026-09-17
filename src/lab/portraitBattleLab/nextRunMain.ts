/**
 * PRP-M2-NEXT-RUN-SEED-VALIDATION｜「下一局起始改装」验证入口（独立页面：`/next-run.html`）。
 *
 * 这个页面**不是产品入口**：它只把本 Queue 要验证的那一件事摆出来 ——
 *
 *     RUN COMPLETE → 选一个「下一局起始改装」 → 全新 Run 第一场 → NEXT RUN VALIDATION COMPLETE
 *
 * 隔离（必改 4）：
 *   - 独立 HTML（`next-run.html`）+ 独立脚本，**不进入**任何正式构建
 *     （`npm run build` / `build:pages` / `build:e2e` / `build:wechat` 产物零影响）；
 *   - **默认开发入口完全不变**：`npm run dev` 仍然落在玩家页面（根路径重写规则未动），
 *     本页只由 `npm run dev:next-run`（或显式访问 `/next-run.html`）打开；
 *   - 复用**同一个** `RunPage` 类（同一套绘制 / 输入 / 战斗循环），只通过 `RunPageOptions`
 *     注入验证专属的三件事 —— 不复制第二套页面实现，也就不可能出现「两套口径不一致」。
 *
 * 开发：`npm run dev:next-run` → http://127.0.0.1:5173/next-run.html
 * 构建：`npm run build:portrait-lab` → dist-portrait-lab/（含 next-run.html）
 *
 * 整块删除清单见本目录 constants.ts 头部注释。
 */
import { NEXT_RUN_SEEDS, buildPriorCompletedRun } from './nextRunValidation';
import { RunPage } from './runPage';
import { runPageContext } from './runPageScene';

/** 验证页面的只读诊断句柄（与玩家入口同名，便于复用既有的探针读取方式）。 */
interface NextRunDebugHandle {
  probe: () => unknown;
}

function boot(): void {
  const root = document.getElementById('run-root');
  if (!root) {
    // 页面缺失容器：明确报错（不静默白屏）
    throw new Error('[PRP-M2] 未找到 #run-root 容器');
  }
  // ① 「上一局」= 走**真实状态机**的确定性快进（只固定每场剩血，不跑物理）→ RUN COMPLETE。
  //    ⚠️ 这是验证脚手架，不是产品路径：正式一局的起点永远来自 createRunPageState。
  const prior = buildPriorCompletedRun(runPageContext());
  // ② 同一个 RunPage，注入验证流程：终局起点 + 种子三选一 + 第一场结束即停止。
  const page = new RunPage(root, {
    priorRun: prior,
    seedOptions: NEXT_RUN_SEEDS,
    stopAfterFirstBattle: true,
  });
  (globalThis as { __RUNPAGE__?: NextRunDebugHandle }).__RUNPAGE__ = { probe: () => page.probe() };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
