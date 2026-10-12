/**
 * DEMO-HEIGHT-LINE-VISUAL-LAB-R1｜对照台入口（独立页面：`/height-line-lab.html`）。
 *
 * 这不是产品入口。它只把本 Queue 要验证的那一件事摆出来：
 *
 *     同一个车身 + 同一门炮 + 同一个既有对手（`RangedTurret`）
 *         → 只换轮径（小 / 重 / 大三套）→ 选一套就跑一场**真实**战斗
 *         → 正常速度看到真实弹道与受击 → 打完即停 → 清场 → 换下一套
 *
 * 隔离（与既有 Lab 同一套纪律）：
 *   - 独立 HTML + 独立脚本，**不进入**任何正式构建产物
 *     （`npm run build` / `build:pages` / `build:e2e` / `build:wechat` 零影响）；
 *   - **默认开发入口完全不变**：`npm run dev` 仍落在玩家页面（根路径重写规则未动），
 *     本页只由 `npm run dev:height-line-lab`（或显式访问 `/height-line-lab.html`）打开；
 *   - 不引入任何正式玩法运行时 / UI Host / 存档 / 经济 —— 本页只读世界与对照。
 *
 * 开发：`npm run dev:height-line-lab` → http://127.0.0.1:5173/height-line-lab.html
 * 构建：`npm run build:portrait-lab` → dist-portrait-lab/（含 height-line-lab.html）
 *
 * 整块删除清单见本目录 constants.ts 头部注释。
 */
import { HeightLineLab } from './heightLineLab';

/** 对照台只读诊断句柄（仅本页面存在；不进入任何正式构建产物）。 */
interface HeightLineLabDebugHandle {
  probe: () => unknown;
}

function boot(): void {
  const root = document.getElementById('hlab-root');
  if (!root) {
    // 页面缺失容器：明确报错（不静默白屏）
    throw new Error('[DEMO-HEIGHT-LINE] 未找到 #hlab-root 容器');
  }
  const lab = new HeightLineLab(root);
  (globalThis as { __HEIGHTLINELAB__?: HeightLineLabDebugHandle }).__HEIGHTLINELAB__ = {
    probe: () => lab.probe(),
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
