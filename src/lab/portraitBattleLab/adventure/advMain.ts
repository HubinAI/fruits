/**
 * FRUITS-ADVENTURE-FULL-PLAYABLE-R3｜随机冒险入口（独立页面：/adventure.html）。
 *
 * 与正式入口 / 玩家 Run Page 完全隔离：
 *   - 不 import 平台 bootstrap、不 import PlayerGameRuntime / 任何正式玩法模块；
 *   - 不参与 build / build:pages / build:e2e / build:wechat 任一正式构建
 *     （仅随 build:portrait-lab 进入 dist-portrait-lab，可整块删除）；
 *   - 不接入正式首页（满足 Queue 必改「未验证事件不自动接入正式首页」）。
 *
 * 装备来源（验收③「优先读取正式车库」+「不得假装已读取」）：
 *   1. `?equipped=<BuildDraft JSON>`：走冻结的 `resolveRunPlayerLoadout`（与 runPage 同一机制，
 *      含正式 validateSnapshot + 完整 Run 兼容判定）。URL 带合法装备 → 用正式车库装配；
 *   2. 否则（未带参数）尝试**同域 best-effort 读** `strongfruit.playerBuild.v1`
 *      （产品写正式存档的同一键；冒险页与产品同 origin ⇒ localStorage 共享），
 *      原样解析后经同一 `resolveRunPlayerLoadout` 校验 → 用正式车库装配；
 *   3. 以上都失败 / 装备不兼容完整 Run（非 cannon） ⇒ 诚实回退演示装配，并在 UI / 探针标明来源，
 *      绝不假装读到了正式车库。
 *
 * 局外成长：终态结算写入**隔离测试档案** `strongfruit.adventure.r3.testArchive.v1`，
 *   与正式存档键完全隔离，不影响正式玩家存档（详见 advArchive.ts）。
 *
 * 启动：`npm run dev:adventure` → http://127.0.0.1:5173/adventure.html?seed=123
 * 种子：`?seed=` 指定可复现种子；省略则随机生成（终局点按钮以同种子重开）。
 */
import { resolveRunPlayerLoadout, demoRunPlayerLoadout, type RunPlayerLoadout } from '../runPageScene';
import { parseExternalDraft } from '../runPlayerLoadout';
import { AdvPage } from './advPage';

/** 产品正式存档键（只读读取，绝不写入；与隔离测试档案键完全分离）。 */
const FORMAL_BUILD_KEY = 'strongfruit.playerBuild.v1';

function readFormalBuildFromStorage(): unknown | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(FORMAL_BUILD_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 解析本局装载 + 来源诊断（诚实，不假装）。
 * 优先 URL `equipped`；否则同域存档；都不行（或不兼容）回退演示。
 */
function resolveLoadout(search: string): { loadout: RunPlayerLoadout; source: string } {
  const fromUrl = resolveRunPlayerLoadout(search);
  if (fromUrl.fallback === 'none') {
    return { loadout: fromUrl.loadout, source: '正式车库' };
  }
  if (fromUrl.fallback === 'invalid') {
    return { loadout: demoRunPlayerLoadout(), source: '演示（URL装备损坏）' };
  }
  if (fromUrl.blocked) {
    // 装备合法但本原型完整 Run 不支持（如非 cannon 武器）：诚实回退演示，并说明。
    return { loadout: demoRunPlayerLoadout(), source: '演示（装备不兼容完整冒险）' };
  }
  // 未带参数：尝试同域读正式存档
  const stored = readFormalBuildFromStorage();
  if (stored && typeof stored === 'object') {
    const draft = parseExternalDraft(stored);
    if (draft) {
      const re = resolveRunPlayerLoadout(`?equipped=${encodeURIComponent(JSON.stringify(draft))}`);
      if (!re.blocked) return { loadout: re.loadout, source: '正式车库' };
    }
  }
  return { loadout: demoRunPlayerLoadout(), source: '演示（未检测到正式车库）' };
}

function boot(): void {
  const root = document.getElementById('adv-root');
  if (!root) return;

  const params = new URLSearchParams(location.search);
  const seed = params.get('seed') ?? undefined;
  const { loadout, source } = resolveLoadout(location.search);

  let current = new AdvPage(root, { seed, loadout, loadoutSource: source });

  // 只读诊断句柄（E2E / 调试；不参与任何玩法规则）
  (window as unknown as { __adv: unknown }).__adv = {
    get page() {
      return current;
    },
    probe: () => current.probe(),
    step: () => current.debugStep(),
    stepOption: (i: number) => current.debugStepOption(i),
    diagnose: () => current.diagnose(),
    restart: (newSeed?: string) => {
      current.dispose();
      const next = resolveLoadout(location.search);
      current = new AdvPage(root, { seed: newSeed, loadout: next.loadout, loadoutSource: next.source });
    },
  };
}

boot();
