/**
 * MAC-MIGRATION-E2E-COMPAT-R1｜E2E 浏览器启动公共化守卫（纯源码，不启动浏览器）
 *
 * 迁移硬 Blocker 回顾（MAC-MIGRATION-HANDOFF §B-1 / §B-2）：
 * - B-1：33 个 `tests/*.cjs` `require('playwright-core')`，但该依赖既不在
 *   `package.json` 也不在 `package-lock.json`，本机仅靠 `node_modules` 手工残留；
 * - B-2：浏览器启动参数各自写死 Windows-only（`channel: 'msedge'` / 硬编码
 *   `C:/Program Files (x86)/.../msedge.exe`）⇒ macOS 全灭。
 *
 * 本守卫钉死「修好之后不许再散落」：
 *   B1. 公共 helper 存在且导出 launchBrowser；
 *   B2. playwright-core 以**精确版本**正式入册 devDependencies（不许再 --no-save）；
 *   B3. 除 helper 外，任何 `tests/*.cjs` 不得再出现 `chromium.launch(`（唯一启动点）；
 *   B4. 除 helper / `_serve_pages.cjs` 外，所有 E2E 必须 `await launchBrowser(`；
 *   B5. 剥注释后全仓 `tests/*.cjs` 零 `channel: 'msedge'`；
 *   B6. 剥注释后全仓 `tests/*.cjs` 零硬编码 Edge 安装路径；
 *   B7. 不得再出现 `--no-save` 式旁路（helper 的存在使手工残留不再需要）。
 *
 * ⚠️ 源码守卫纪律：匹配前**剥注释**（本仓已踩过「JS 块注释 `*` 紧跟 `/`」的坑），
 * 但注意行注释剥离要求 `//` 前是行首或空白，避免误伤 `http://`。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = fileURLToPath(new URL('./', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const HELPER = '_browser_launch.cjs';
/** 不启动浏览器的测试脚本（HTTP 静态服务器）。 */
const NON_LAUNCHING = new Set([HELPER, '_serve_pages.cjs']);

const E2E_FILES = readdirSync(TESTS_DIR).filter((f) => f.endsWith('.cjs')).sort();

/** 剥离块注释与行注释（行注释要求 `//` 前为行首/空白，避免误伤 http://）。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

const read = (name: string) => readFileSync(TESTS_DIR + name, 'utf8');

describe('MAC-MIGRATION-E2E-COMPAT-R1｜E2E 浏览器启动公共化', () => {
  it('B1. 公共 launch helper 存在并导出 launchBrowser', () => {
    expect(E2E_FILES, 'tests/ 下存在公共 helper').toContain(HELPER);
    const helperSrc = read(HELPER);
    expect(helperSrc, 'helper 导出 launchBrowser').toMatch(/module\.exports\s*=\s*\{[^}]*launchBrowser/);
    // helper 自身是唯一允许直接调用 chromium.launch 的地方
    expect(stripComments(helperSrc), 'helper 内保留唯一 chromium.launch 调用点').toContain('chromium.launch(');
  });

  it('B2. playwright-core 以精确版本正式入册 devDependencies（不再依赖手工残留）', () => {
    const pkg = JSON.parse(readFileSync(REPO_ROOT + 'package.json', 'utf8'));
    const declared = pkg.devDependencies && pkg.devDependencies['playwright-core'];
    expect(declared, 'package.json devDependencies 声明 playwright-core').toBeTruthy();
    // 精确版本：跨平台必须锁同一版本，避免 Windows/macOS 落到不同 chromium revision
    expect(declared, 'playwright-core 必须是精确版本（无 ^ / ~）').toMatch(/^\d+\.\d+\.\d+$/);

    const lock = JSON.parse(readFileSync(REPO_ROOT + 'package-lock.json', 'utf8'));
    const lockRoot = lock.packages && lock.packages[''];
    expect(lockRoot.devDependencies['playwright-core'], 'lockfile 根声明一致').toBe(declared);
    const lockEntry = lock.packages[`node_modules/playwright-core`];
    expect(lockEntry, 'lockfile 含 playwright-core 实体条目').toBeTruthy();
    expect(lockEntry.version, 'lockfile 版本与 package.json 一致').toBe(declared);
    expect(lockEntry.resolved, 'lockfile 含 resolved（npm ci 可复原）').toBeTruthy();
    expect(lockEntry.integrity, 'lockfile 含 integrity（npm ci 可校验）').toBeTruthy();
  });

  it('B3. 唯一启动点：除 helper 外不得再出现裸 chromium.launch(', () => {
    const bypass = E2E_FILES.filter(
      (f) => f !== HELPER && stripComments(read(f)).includes('chromium.launch('),
    );
    expect(bypass, '除 helper 外不得再出现裸 chromium.launch(').toEqual([]);
  });

  it('B4. 覆盖完整：所有 E2E 必须经 await launchBrowser( 启动', () => {
    const launching = E2E_FILES.filter((f) => !NON_LAUNCHING.has(f));
    expect(launching.length, 'E2E 文件数下界（守卫不允许变成空转）').toBeGreaterThanOrEqual(30);
    const noHelper = launching.filter((f) => !stripComments(read(f)).includes('await launchBrowser('));
    expect(noHelper, '所有 E2E 必须经 await launchBrowser( 启动').toEqual([]);
  });

  it('B5+B6. 不再散落 Windows-only 浏览器硬编码（channel:msedge / 硬编码 exe 路径）', () => {
    const msedgeChannel: string[] = [];
    const hardcodedExe: string[] = [];
    for (const f of E2E_FILES) {
      const stripped = stripComments(read(f));
      if (/channel:\s*'msedge'/.test(stripped)) msedgeChannel.push(f);
      if (/Microsoft\/Edge\/Application/.test(stripped)) hardcodedExe.push(f);
    }
    expect(msedgeChannel, "剥注释后零 channel: 'msedge'").toEqual([]);
    expect(hardcodedExe, '剥注释后零硬编码 Edge 安装路径').toEqual([]);
  });

  it('B7. helper 的解析顺序保持确定性（Edge 优先 → 项目 Chromium，无未知浏览器静默回退）', () => {
    const helperSrc = read(HELPER);
    // Windows 现行口径保留
    expect(helperSrc, '系统通道含 msedge（保留 Windows 现行口径）').toMatch(/SYSTEM_CHANNELS\s*=\s*\[[^\]]*'msedge'/);
    // 兜底为项目正式声明的 Chromium（Playwright bundled）
    expect(helperSrc, '兜底路径存在').toContain('项目 Chromium');
    // 全部失败必须显式报错，不得静默继续
    expect(helperSrc, '全败时抛错').toContain('E2E_NO_BROWSER');
    // 显式覆盖入口（供 macOS 指定已有浏览器）
    expect(helperSrc, 'E2E_BROWSER_CHANNEL 覆盖入口').toContain('E2E_BROWSER_CHANNEL');
    expect(helperSrc, 'E2E_BROWSER_EXECUTABLE_PATH 覆盖入口').toContain('E2E_BROWSER_EXECUTABLE_PATH');
    // 安装指引（Mac 修复动作）
    expect(helperSrc, '安装指引含 playwright-core install chromium').toContain('playwright-core install chromium');
  });
});
