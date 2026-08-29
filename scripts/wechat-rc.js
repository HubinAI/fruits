/**
 * F-WX-IOS-CANVAS-CRASH-P0｜Must#6｜`npm run build:wechat:rc`——内部体验版（RC）候选包专用构建。
 *
 * 本构建同时注入两个相互独立的编译期标志（均不依赖 E2E probe）：
 * - WECHAT_BADGE=1（__WX_BUILD_BADGE__=true）→ dist-wechat 在画面角落绘制短 SHA 水印（#7位），
 *   供真人微信开发者工具 / 真机录屏确认版本（SHA 三路一致）；
 * - WECHAT_DEBUG_GRANT=1（__WX_DEBUG_GRANT__=true）→ 作为「调试体验入口」：配合 game.ts 的
 *   isResetDevVisible 使「全部件×1」可达且隔离于普通体验入口（普通玩家用 build:wechat，永不出现，无法误触）。
 *
 * 普通 `npm run build:wechat`（无这两个 env）→ 正式包零 SHA 水印、零「全部件×1」入口
 * （正式发布前可关闭 / 不可误触）。E2E probe（__E2E_PROBE__，已弃用、已迁移到 __WX_DEBUG__）不得出现在任何微信构建中。
 * 零新依赖：仅 node:child_process / node:path / node:url（同 scripts/wechat-rca.js 模式）。
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const build = spawnSync(
  process.execPath,
  [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '-c', 'vite.wechat.config.ts'],
  { cwd: root, stdio: 'inherit', env: { ...process.env, WECHAT_BADGE: '1', WECHAT_DEBUG_GRANT: '1' } },
);
if (build.status !== 0) {
  console.error('[build:wechat:rc] ❌ 构建失败');
  process.exit(build.status || 1);
}
console.log('[build:wechat:rc] ✅ 完成：dist-wechat 含角落 SHA 水印（__WX_BUILD_BADGE__）+ 调试「全部件×1」入口（__WX_DEBUG_GRANT__）；正式 build:wechat 均无');
process.exit(0);
