/**
 * PRP-M3-ENCOUNTER-BATCH-01｜遭遇验证台入口（独立页面：`/encounter-lab.html`）。
 *
 * 这不是产品入口。它只把本 Queue 要验证的那一件事摆出来：
 *
 *     同一辆战车 + 同一个战场 + 三个**已经存在的**正式 Encounter
 *         → 点一个就跑一场真实战斗 → 打完即停 → 换下一个 / Reset 重开
 *
 * 隔离（Queue 必改 4）：
 *   - 独立 HTML（`encounter-lab.html`）+ 独立脚本，**不进入**任何正式构建
 *     （`npm run build` / `build:pages` / `build:e2e` / `build:wechat` 产物零影响）；
 *   - **默认开发入口完全不变**：`npm run dev` 仍然落在玩家页面（根路径重写规则未动），
 *     本页只由 `npm run dev:encounter-lab`（或显式访问 `/encounter-lab.html`）打开；
 *   - 不引入任何正式玩法运行时 / 正式 UI Host / 存档 / 经济 —— 本页只读世界与对照。
 *
 * 开发：`npm run dev:encounter-lab` → http://127.0.0.1:5173/encounter-lab.html
 * 构建：`npm run build:portrait-lab` → dist-portrait-lab/（含 encounter-lab.html）
 *
 * 整块删除清单见本目录 constants.ts 头部注释。
 */
import { EncounterLab } from './encounterLab';

/** 验证台只读诊断句柄（仅本页面存在；不进入任何正式构建产物）。 */
interface EncounterLabDebugHandle {
  probe: () => unknown;
}

function boot(): void {
  const root = document.getElementById('elab-root');
  if (!root) {
    // 页面缺失容器：明确报错（不静默白屏）
    throw new Error('[PRP-M3] 未找到 #elab-root 容器');
  }
  const lab = new EncounterLab(root);
  (globalThis as { __ENCOUNTERLAB__?: EncounterLabDebugHandle }).__ENCOUNTERLAB__ = {
    probe: () => lab.probe(),
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
