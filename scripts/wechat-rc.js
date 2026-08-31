/**
 * F-WX-RC-REPRODUCIBLE-BUILD-P0｜`npm run build:wechat:rc`——RC 包与 Git 提交一一对应的强制门禁。
 *
 * 背景：连续两轮出现「代码在未提交 working tree 中完成 → build:wechat:rc 读取旧 HEAD →
 * 随后 commit → RC 包包含新代码但 badge 仍显示旧 SHA」，版号无法代表真实源码。
 *
 * 本脚本强制：
 * 1. 构建前检查 Git 状态（Must#1）：受控路径（src/ tests/ scripts/ wechat/ package.json
 *    vite*.config.* tsconfig* 等）存在未提交/已暂存改动 → RC 构建失败（Must#2/#3）；
 *    .workbuddy/memory、dist、outputs 等非源码记录忽略。
 * 2. 临时诊断必须显式 `--dirty`（或 WECHAT_RC_DIRTY=1）：放行但 badge 显示 `#<sha>-dirty`
 *    （Must#4），不得伪装正式 RC。
 * 3. 构建成功后生成 dist-wechat/rc-build.json（fullSha/shortSha/branch/dirty/buildTime/
 *    buildMode=rc；Must#5）。
 * 4. 构建结束自动校验三方 SHA（Must#6）：badge 前 7 位 = HEAD 前 7 位、rc-build.json fullSha
 *    = HEAD、bundle runtimeInfo sha = HEAD；不一致则构建失败。
 *
 * 另注入 __WX_DEBUG_GRANT__（「全部件×1」调试入口，与 badge 解耦；普通 build:wechat 两者均无）。
 * F-REPO-HEALTH-GUARD-P0：dirty 检查前先跑只读仓库健康门禁（scripts/repo-health.js）——
 * 任一关键检查失败 → RC 拒绝并输出人工恢复指引；健康门禁绝不自动修复仓库。
 * 零新依赖：node:child_process / node:path / node:url / node:fs + 本地 rc-gate.js / repo-health.js。
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readGitState, makeRcBuildInfo, verifyRcShas, extractBundleSha, git } from './rc-gate.js';
import { checkRepoHealth, recoveryGuidance } from './repo-health.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'dist-wechat');

// —— 显式诊断参数（Must#4）：仅临时诊断使用，badge 标记 -dirty，不伪装正式 RC ——
const allowDirty = process.argv.includes('--dirty') || process.env.WECHAT_RC_DIRTY === '1';

// —— F-REPO-HEALTH-GUARD-P0（Must#3）：RC 构建前先跑只读仓库健康门禁（在 dirty 检查之前）——
let health;
try {
  health = checkRepoHealth((args) => git(args, root), root);
} catch (e) {
  console.error(`[build:wechat:rc] ❌ 仓库健康检查无法执行：${e instanceof Error ? e.message : e}`);
  console.error(recoveryGuidance());
  process.exit(1);
}
if (!health.ok) {
  console.error('[build:wechat:rc] ❌ 仓库健康检查失败（只读门禁，未做任何自动修复），拒绝构建：');
  for (const c of health.checks) {
    if (!c.ok) console.error(`   - ${c.name}: ${c.detail}`);
  }
  console.error('');
  console.error(recoveryGuidance());
  process.exit(1);
}

// —— Must#1/#2/#3：构建前 Git 状态检查 ——
let state;
try {
  state = readGitState((args) => git(args, root));
} catch (e) {
  console.error(`[build:wechat:rc] ❌ 无法读取 Git 状态：${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
if (state.dirtyFiles.length > 0) {
  if (!allowDirty) {
    console.error('[build:wechat:rc] ❌ 工作树含受控路径未提交/已暂存改动，拒绝构建——RC 包必须与 Git 提交一一对应：');
    for (const f of state.dirtyFiles) console.error(`   - ${f}`);
    console.error('   如确需临时诊断，请用 `npm run build:wechat:rc -- --dirty`（badge 显示 #<sha>-dirty，不得作为正式 RC 发布）。');
    process.exit(1);
  }
  console.warn('[build:wechat:rc] ⚠️ 诊断模式（--dirty）：以下受控路径 dirty，badge 将标记 -dirty：');
  for (const f of state.dirtyFiles) console.warn(`   - ${f}`);
}

// —— 构建（含 badge / 调试入口注入；诊断 dirty 时注入 __WX_RC_DIRTY__ → badge 拼接 -dirty） ——
const env = {
  ...process.env,
  WECHAT_BADGE: '1',
  WECHAT_DEBUG_GRANT: '1',
};
if (state.dirtyFiles.length > 0 && allowDirty) env.WECHAT_RC_DIRTY = '1';

const build = spawnSync(
  process.execPath,
  [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '-c', 'vite.wechat.config.ts'],
  { cwd: root, stdio: 'inherit', env },
);
if (build.status !== 0) {
  console.error('[build:wechat:rc] ❌ 构建失败');
  process.exit(build.status || 1);
}

// —— Must#5：生成 rc-build.json ——
const headSha = git(['rev-parse', 'HEAD'], root);
const dirty = state.dirtyFiles.length > 0;
const rcJsonPath = resolve(outDir, 'rc-build.json');
const rcInfo = makeRcBuildInfo({
  fullSha: headSha,
  shortSha: headSha.slice(0, 7),
  branch: state.branch,
  dirty,
  buildTime: new Date().toISOString(),
  buildMode: 'rc',
});
writeFileSync(rcJsonPath, JSON.stringify(rcInfo, null, 2) + '\n');

// —— Must#6：构建结束自动校验三方 SHA ——
const bundleSha = extractBundleSha(readFileSync(resolve(outDir, 'game.js'), 'utf8'));
const badgeSha = bundleSha ? bundleSha.slice(0, 7) : null;
const rcJsonSha = existsSync(rcJsonPath) ? JSON.parse(readFileSync(rcJsonPath, 'utf8')).fullSha : null;
if (!verifyRcShas({ headSha, badgeSha, rcJsonSha, bundleSha })) {
  console.error('[build:wechat:rc] ❌ SHA 三方校验失败（badge / rc-build.json / bundle runtimeInfo 与 HEAD 不一致）：');
  console.error(`   HEAD           = ${headSha}`);
  console.error(`   badge          = ${badgeSha ?? 'null'}`);
  console.error(`   rc-build.json  = ${rcJsonSha ?? 'null'}`);
  console.error(`   bundle runtime = ${bundleSha ?? 'null'}`);
  process.exit(1);
}

console.log(
  `[build:wechat:rc] ✅ 完成：dist-wechat 含 SHA 水印 #${badgeSha}${dirty ? '-dirty' : ''}（dirty=${dirty}）` +
    `+ rc-build.json（fullSha=${headSha.slice(0, 12)}…，branch=${state.branch}）；三方 SHA 校验通过。`,
);
console.log('   正式 build:wechat（无 WECHAT_BADGE）→ 零 SHA 水印、零「全部件×1」入口。');
process.exit(0);
