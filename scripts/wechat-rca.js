/**
 * F-WX-RCA-1｜`npm run build:wechat:rca`——真实尺度核对专用构建。
 *
 * 仅本构建注入 WECHAT_RCA=1（vite define __WX_RCA__=true）→ dist-wechat 输出 [WX-RCA]
 * 真实尺度日志（viewport + Garage/Battle 的 core/envelope 屏宽占比），供真人微信开发者
 * 工具核对「车身+轮子主体」实际大小。
 *
 * 普通 `npm run build:wechat`（无 WECHAT_RCA）→ PROD 包零 [WX-RCA] 日志。
 * 零新依赖：仅 node:child_process / node:path / node:url（同 scripts/wechat-dev.js 模式）。
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const build = spawnSync(
  process.execPath,
  [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '-c', 'vite.wechat.config.ts'],
  { cwd: root, stdio: 'inherit', env: { ...process.env, WECHAT_RCA: '1' } },
);
if (build.status !== 0) {
  console.error('[build:wechat:rca] ❌ 构建失败');
  process.exit(build.status || 1);
}
console.log('[build:wechat:rca] ✅ 完成：dist-wechat 含 [WX-RCA] 日志（普通 build:wechat 无）');
process.exit(0);
