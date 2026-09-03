/**
 * F-WX-RC-BUNDLE-CLEAN-P0｜微信 bundle 内部句柄泄漏只读门禁
 *
 * 用法：
 *   node scripts/check-wechat-bundle-clean.js <bundle.js> <mode>
 *   mode: rc | wechat | diag | e2e
 *
 * - RC/普通微信/微信诊断（rc|wechat|diag）：禁止任何内部句柄赋值（globalThis/window
 *   .__h/__probe/__fx/__inv/__runtime/__renderer/__player/__battle）——命中即 exit 1，
 *   绝不报告「RC 构建成功」。微信诊断（WECHAT_DEBUG_INPUT=1）只有日志、零内部句柄。
 * - E2E（e2e）：显式 allowlist 放行 E2E 专用句柄（__h/__probe/__fx/__inv），但仍禁止
 *   __runtime/__renderer/__player/__battle 等未授权句柄。
 * - 使用**精确赋值模式**（`globalThis.__h = `）而非宽泛 grep——合法的 `dirty` 业务字段、
 *   RC badge 水印、grant 按钮文案不会被误判为泄漏。
 */
import { readFileSync } from 'node:fs';

/** 禁止的内部句柄赋值（精确模式：句柄 + 赋值） */
const FORBIDDEN = [
  'globalThis.__h = ',
  'window.__h = ',
  'globalThis.__probe = ',
  'window.__probe = ',
  'globalThis.__fx = ',
  'window.__fx = ',
  // F-GARAGE-INVENTORY-FUSION-R1：背包库存种子句柄（__fx 已被表现层特效探针占用，故独立命名空间）
  'globalThis.__inv = ',
  'window.__inv = ',
  'globalThis.__runtime = ',
  'window.__runtime = ',
  'globalThis.__renderer = ',
  'window.__renderer = ',
  'globalThis.__player = ',
  'window.__player = ',
  'globalThis.__battle = ',
  'window.__battle = ',
];

/** E2E 显式 allowlist（E2E 构建允许的探针句柄） */
const E2E_ALLOW = new Set([
  'globalThis.__h = ',
  'window.__h = ',
  'globalThis.__probe = ',
  'window.__probe = ',
  'globalThis.__fx = ',
  'window.__fx = ',
  // F-GARAGE-INVENTORY-FUSION-R1：E2E 构建放行库存种子句柄（普通/RC/微信诊断仍禁止）
  'globalThis.__inv = ',
  'window.__inv = ',
]);

function main() {
  const [bundlePath, mode] = process.argv.slice(2);
  if (!bundlePath || !mode) {
    console.error('[bundle-clean] 用法: node scripts/check-wechat-bundle-clean.js <bundle.js> <rc|wechat|e2e>');
    process.exit(2);
  }
  if (!['rc', 'wechat', 'e2e', 'diag'].includes(mode)) {
    console.error(`[bundle-clean] 未知构建模式: ${mode}（应为 rc|wechat|e2e|diag）`);
    process.exit(2);
  }
  const src = readFileSync(bundlePath, 'utf8');
  const hits = [];
  for (const pat of FORBIDDEN) {
    if (mode === 'e2e' && E2E_ALLOW.has(pat)) continue; // E2E allowlist 放行必要探针
    let i = src.indexOf(pat);
    while (i !== -1) {
      const line = src.slice(0, i).split('\n').length;
      const ctx = src.slice(Math.max(0, i - 30), Math.min(src.length, i + pat.length + 30)).replace(/\n/g, ' ');
      hits.push({ pat, line, ctx });
      i = src.indexOf(pat, i + 1);
    }
  }
  if (hits.length > 0) {
    console.error(`[bundle-clean] ❌ FAIL (${mode})：${bundlePath} 含 ${hits.length} 处内部句柄泄漏：`);
    for (const h of hits) {
      console.error(`   line ${h.line}: ${h.pat}   …${h.ctx}…`);
    }
    console.error('[bundle-clean] RC 判定失败（不得视为可交付 RC）。');
    process.exit(1);
  }
  console.log(`[bundle-clean] ✅ PASS (${mode})：${bundlePath} 无内部句柄泄漏`);
  process.exit(0);
}

main();
