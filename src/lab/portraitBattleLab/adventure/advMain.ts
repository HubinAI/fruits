/**
 * FRUITS-RANDOM-ADVENTURE-R1｜随机冒险入口（独立页面：/adventure.html）。
 *
 * 与正式入口 / 玩家 Run Page 完全隔离：
 *   - 不 import 平台 bootstrap、不 import PlayerGameRuntime / 任何正式玩法模块；
 *   - 不参与 build / build:pages / build:e2e / build:wechat 任一正式构建
 *     （仅随 build:portrait-lab 进入 dist-portrait-lab，可整块删除）；
 *   - 不接入正式首页（满足 Queue 必改「未验证事件不自动接入正式首页」）。
 *
 * 启动：`npm run dev:adventure` → http://127.0.0.1:5173/adventure.html?seed=123
 * 种子：`?seed=` 指定可复现种子；省略则随机生成（终局点按钮以同种子重开）。
 */
import { AdvPage } from './advPage';

function boot(): void {
  const root = document.getElementById('adv-root');
  if (!root) return;

  const params = new URLSearchParams(location.search);
  const seed = params.get('seed') ?? undefined;

  let current = new AdvPage(root, { seed });

  // 只读诊断句柄（E2E / 调试；不参与任何玩法规则）
  (window as unknown as { __adv: unknown }).__adv = {
    get page() {
      return current;
    },
    probe: () => current.probe(),
    step: () => current.debugStep(),
    restart: (newSeed?: string) => {
      current.dispose();
      current = new AdvPage(root, { seed: newSeed });
    },
  };
}

boot();
