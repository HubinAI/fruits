/**
 * Queue F-WX-RC-BUNDLE-CLEAN-P0｜RC bundle 内部句柄泄漏门禁 strict test
 *
 * Must#5 覆盖（可自动化部分；真实构建扫描见验证阶段 + scripts/check-wechat-bundle-clean.js 接入）：
 * T1  `__WX_DEBUG_GRANT__=true` 不再产生 `__h`（mountScreen __h 条件已改绑 __WX_DEBUG__——源码断言）；
 * T2  普通微信 bundle 无 __h/__probe/__fx（构建扫描：验证阶段 `check-wechat-bundle-clean.js wechat` + grep）；
 * T3  RC bundle 有 badge 与 grant、无内部句柄（构建扫描：验证阶段 `check ... rc`；本测试断言 RC 脚本接入点）；
 * T4  E2E 保留 __h（构建扫描：验证阶段 `check ... e2e`；本测试断言 E2E allowlist）；
 * T5  bundle-clean 命中 `globalThis.__h` → exit 1；
 * T6  命中 `window.__probe` → exit 1；
 * T7  普通业务 `dirty` 字段不误报；
 * T8  badge 与 grant 文案不误报；
 * T9  RC 门禁失败时不报告构建成功（check 失败 exit 1 + wechat-rc.js 在 rc-build.json 前调用）；
 * T10 RC bundle-clean 通过后才执行四方 SHA（wechat-rc.js 中 check 位于 SHA 校验之前——源码断言）；
 * T11 所有 define 真值表与预期一致（vite configs env→宏映射）；
 * T12 E2E 既有门禁不因句柄改绑失效（E2E 专用宏 __WX_DEBUG__ 仍控制 __h——源码断言 + 回归验证）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHECK = resolve(__dirname, '../scripts/check-wechat-bundle-clean.js');
const UI_SRC = readFileSync(resolve(__dirname, '../src/ui/canvasPlayerUIHost.ts'), 'utf8');
const RC_SCRIPT = readFileSync(resolve(__dirname, '../scripts/wechat-rc.js'), 'utf8');
const WX_CONFIG = readFileSync(resolve(__dirname, '../vite.wechat.config.ts'), 'utf8');
const E2E_CONFIG = readFileSync(resolve(__dirname, '../vite.e2e.config.ts'), 'utf8');

const NODE = process.execPath;

function runCheck(bundleContent: string, mode: string): { status: number; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-clean-'));
  const file = join(dir, 'game.js');
  writeFileSync(file, bundleContent, 'utf8');
  const r = spawnSync(NODE, [CHECK, file, mode], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

afterEach(() => {
  // no-op：脚本逻辑测试无全局副作用
});

describe('F-WX-RC-BUNDLE-CLEAN-P0', () => {
  it('T1. __h 周边无 __WX_DEBUG__/grant/badge（E2E-only 宏隔离，微信诊断不泄漏）', () => {
    const MAIN_SRC = readFileSync(resolve(__dirname, '../src/main.ts'), 'utf8');
    // 检查全部 __h/__probe/__fx 赋值块的条件宏
    const pats: RegExp[] = [
      /\(globalThis as \{ __h\?: CanvasPlayerUIHost \}\)\.__h = this/g,
      /\(globalThis as \{ __h\?: typeof host \}\)\.__h = host/g,
      /\(globalThis as \{ __probe\?: unknown \}\)\.__probe/g,
      /\(globalThis as \{ __fx\?: unknown \}\)\.__fx/g,
    ];
    const blocks: Array<{ src: string; idx: number }> = [];
    for (const pat of pats) {
      for (const m of MAIN_SRC.matchAll(pat)) blocks.push({ src: MAIN_SRC, idx: m.index });
      for (const m of UI_SRC.matchAll(pat)) blocks.push({ src: UI_SRC, idx: m.index });
    }
    expect(blocks.length, '找到全部内部句柄赋值点').toBeGreaterThanOrEqual(5);
    for (const b of blocks) {
      const condStart = b.src.lastIndexOf('if (typeof', b.idx);
      const cond = b.src.slice(condStart, b.idx);
      expect(cond.includes('__E2E_INTERNAL_HANDLE__'), '句柄条件 = __E2E_INTERNAL_HANDLE__').toBe(true);
      expect(cond.includes('__WX_DEBUG_GRANT__'), '不使用 grant').toBe(false);
      expect(cond.includes('__WX_BUILD_BADGE__'), '不使用 badge').toBe(false);
      expect(cond.includes('typeof __WX_DEBUG__'), '不使用 __WX_DEBUG__ 条件').toBe(false);
    }
    // grant 宏只保留玩家可见入口（wechat/game.ts isResetDevVisible）
    const gameSrc = readFileSync(resolve(__dirname, '../wechat/game.ts'), 'utf8');
    const grantUses = gameSrc.match(/__WX_DEBUG_GRANT__/g) ?? [];
    expect(grantUses.length).toBeGreaterThanOrEqual(1); // 「全部件×1」入口仍由 grant 控制
  });

  it('T2/T3. wechat-rc.js 在 rc-build.json 生成前接入 bundle-clean（RC 失败不产出可交付清单）', () => {
    const buildIdx = RC_SCRIPT.indexOf('const build = spawnSync');
    const rcJsonIdx = RC_SCRIPT.indexOf('const rcInfo = makeRcBuildInfo({');
    const cleanIdx = RC_SCRIPT.indexOf('check-wechat-bundle-clean.js');
    expect(cleanIdx, 'check 接入').toBeGreaterThan(-1);
    expect(cleanIdx).toBeGreaterThan(buildIdx); // build 之后
    expect(cleanIdx).toBeLessThan(rcJsonIdx); // rc-build.json 生成之前
    // T10: 四方 SHA 校验在 bundle-clean 之后
    const shaIdx = RC_SCRIPT.indexOf('if (!verifyRcShas(');
    expect(shaIdx).toBeGreaterThan(cleanIdx); // bundle-clean 通过后才做 SHA
  });

  it('T5. 命中 globalThis.__h =  → exit 1', () => {
    const r = runCheck('const a=1;\nglobalThis.__h = {x:1};\nconst b=2;', 'rc');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('globalThis.__h = ');
    expect(r.stderr).toContain('FAIL');
  });

  it('T6. 命中 window.__probe / __h → exit 1（RC/普通微信/微信诊断模式）', () => {
    const r = runCheck('window.__probe = {phase:"Active"};', 'wechat');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('window.__probe = ');
    // 微信诊断（diag）模式同样禁止内部句柄
    const d = runCheck('globalThis.__h = this;', 'diag');
    expect(d.status).toBe(1);
    expect(d.stderr).toContain('globalThis.__h = ');
  });

  it('T7. 普通业务 dirty 字段不误报', () => {
    const r = runCheck('this.dirty = true;\nif (dirty) { redraw(); }', 'rc');
    expect(r.status).toBe(0); // dirty 业务字段非句柄 → PASS
    expect(r.stdout).toContain('PASS');
  });

  it('T8. badge 与 grant 文案不误报', () => {
    const r = runCheck('badgeText="#6adc710";\nbtnLabel="全部件+1";\n__WX_BUILD_BADGE__="true";', 'rc');
    expect(r.status).toBe(0); // badge 水印 / grant 按钮文案 / define 宏字符串均非句柄赋值 → PASS
  });

  it('T9. RC 门禁失败时不报告构建成功（exit 1 + 无 PASS 输出）', () => {
    const r = runCheck('globalThis.__fx = {};', 'rc');
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain('PASS');
    expect(r.stderr).not.toContain('通过');
  });

  it('T4/T12. E2E 模式显式 allowlist：__h/__probe/__fx 允许；未授权句柄（__runtime）仍禁止', () => {
    const ok = runCheck('globalThis.__h = this;\nglobalThis.__probe = {};\nglobalThis.__fx = {};', 'e2e');
    expect(ok.status).toBe(0); // E2E 专用句柄允许
    expect(ok.stdout).toContain('PASS');
    const bad = runCheck('globalThis.__runtime = {};', 'e2e');
    expect(bad.status).toBe(1); // 未授权句柄仍禁止
    expect(bad.stderr).toContain('__runtime');
  });

  it('T11. define 真值表与预期一致（vite configs env→宏映射）', () => {
    // wechat: __WX_DEBUG__ ← WECHAT_DEBUG_INPUT；__WX_DEBUG_GRANT__ ← WECHAT_DEBUG_GRANT；__WX_BUILD_BADGE__ ← WECHAT_BADGE
    expect(WX_CONFIG).toContain('__WX_DEBUG__: process.env.WECHAT_DEBUG_INPUT ? \'true\' : \'false\'');
    expect(WX_CONFIG).toContain('__WX_DEBUG_GRANT__: process.env.WECHAT_DEBUG_GRANT ? \'true\' : \'false\'');
    expect(WX_CONFIG).toContain('__WX_BUILD_BADGE__: process.env.WECHAT_BADGE ? \'true\' : \'false\'');
    // e2e: __WX_DEBUG__ 恒 true（E2E 专用探针）
    expect(E2E_CONFIG).toContain("__WX_DEBUG__: 'true'");
    // RC 脚本：WECHAT_BADGE=1 + WECHAT_DEBUG_GRANT=1（badge + grant 同时开，但不开 __WX_DEBUG__）
    expect(RC_SCRIPT).toContain("WECHAT_BADGE: '1'");
    expect(RC_SCRIPT).toContain("WECHAT_DEBUG_GRANT: '1'");
    expect(RC_SCRIPT).not.toContain("WECHAT_DEBUG_INPUT: '1'"); // RC 不开 E2E 探针
  });
});
