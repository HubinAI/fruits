/**
 * F-WX-7｜`npm run dev:wechat` 一键开发流程。
 *
 * 1) 执行 build:wechat（产出 dist-wechat 标准小游戏工程：game.js + game.json +
 *    project.config.json）；
 * 2) 检测本机微信开发者工具 CLI（常见安装路径；可用环境变量 WECHAT_DEVTOOLS_CLI 指定），
 *    找到 → `cli open --project dist-wechat` 直接打开；
 * 3) 未找到 → 打印最短人工导入路径（不引入大型工具链，不伪造自动打开）。
 *
 * 零新依赖：仅 node:child_process / node:fs。（package.json type=module，本文件为 ESM。）
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist-wechat');

// 1) build:wechat
const build = spawnSync(
  process.execPath,
  [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '-c', 'vite.wechat.config.ts'],
  { cwd: root, stdio: 'inherit' },
);
if (build.status !== 0) {
  console.error('[dev:wechat] ❌ build:wechat 失败');
  process.exit(build.status || 1);
}
console.log(`[dev:wechat] ✅ 构建完成：${dist}`);
console.log(
  `    （目录内容：${existsSync(resolve(dist, 'game.js')) ? 'game.js ' : ''}${existsSync(resolve(dist, 'game.json')) ? 'game.json ' : ''}${existsSync(resolve(dist, 'project.config.json')) ? 'project.config.json' : ''}）`,
);

// 2) 检测微信开发者工具 CLI（常见安装路径 + 环境变量覆盖）
const CANDIDATES = [
  process.env.WECHAT_DEVTOOLS_CLI ?? '',
  'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat',
  'C:/Program Files/Tencent/微信web开发者工具/cli.bat',
  'C:/Program Files (x86)/Tencent/微信开发者工具/cli.bat',
  'C:/Program Files/Tencent/微信开发者工具/cli.bat',
  'C:/Users/' + (process.env.USERNAME ?? '') + '/AppData/Local/微信开发者工具/cli.bat',
].filter(Boolean);
const cli = CANDIDATES.find((p) => existsSync(p));

if (!cli) {
  // 3) 未安装 / 未检测到：给出最短人工导入路径（不伪造自动打开）
  console.log('');
  console.log('[dev:wechat] 未检测到微信开发者工具 CLI。本机需先安装「微信开发者工具」官方版。');
  console.log('最短人工导入路径：');
  console.log('  1. 下载安装：https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html');
  console.log('  2. 打开微信开发者工具 → 微信扫码登录');
  console.log('  3. 「导入项目」→ 目录选择：' + dist);
  console.log('  4. AppID：用测试号，或选「游客模式」（touristappid，无需 AppID 即可模拟器调试）');
  console.log('  5. 模拟器编译运行 → 验证 Garage→Matching→Battle→Result→Garage 闭环');
  console.log('  6. 真机预览：工具栏「预览」→ 手机微信扫码 → 真机横屏运行');
  process.exit(0);
}

// 找到 CLI：直接打开项目（开发者工具需已登录）
console.log(`[dev:wechat] 找到微信开发者工具 CLI：${cli}`);
console.log('[dev:wechat] 正在打开项目（若开发者工具未启动将先启动）…');
const open = spawnSync('cmd', ['/c', `"${cli}"`, 'open', '--project', dist], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});
if (open.status === 0) {
  console.log('[dev:wechat] ✅ 已触发打开（若未弹出窗口，请检查开发者工具登录状态）');
} else {
  console.log('[dev:wechat] ⚠️ CLI open 未成功，请按上方人工导入路径操作');
}
process.exit(open.status || 0);
