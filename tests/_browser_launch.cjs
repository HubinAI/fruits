'use strict';
/**
 * 公共浏览器启动 helper（跨平台 · 确定性）
 * =====================================================================
 * 背景（MAC-MIGRATION-HANDOFF §B-2）
 *   各 E2E 原先各自写死 Windows-only 的启动参数，共两种形态：
 *     ① `chromium.launch({ channel: 'msedge', headless: true })`
 *     ② `executablePath: process.env.MSEDGE || 'C:/Program Files (x86)/.../msedge.exe'`
 *   二者在 macOS 上均不可用 ⇒ 全新 clone 到 Mac 后 E2E 全灭。
 *   本 helper 是**唯一**的浏览器启动入口：任何 E2E 都不得再自行拼 launch 参数。
 *
 * 解析顺序（确定性；非「静默回退到任意未知浏览器」）
 *   0. 显式可执行文件路径：options.executablePath > E2E_BROWSER_EXECUTABLE_PATH > MSEDGE
 *      —— 一旦显式指定，失败即报错，不再猜测其它浏览器。
 *   1. 显式通道：E2E_BROWSER_CHANNEL（如 msedge / chrome / chromium）
 *      —— 一旦显式指定，失败即报错，不再猜测其它浏览器。
 *   2. Windows 现行正式口径：系统 Edge（channel: 'msedge'）。
 *   3. 项目正式声明的 Chromium（Playwright bundled，需先安装）
 *      `npx playwright-core install chromium`
 *   4. 全部失败 ⇒ 抛聚合错误：列出每个候选的失败原因 + 安装指引。
 *
 * 环境变量
 *   E2E_BROWSER_CHANNEL          指定通道（msedge / chrome / chromium）
 *   E2E_BROWSER_EXECUTABLE_PATH  指定可执行文件绝对路径（优先于通道）
 *   MSEDGE                       历史兼容别名，等价于上面一项
 *
 * 用法
 *   const { chromium } = require('playwright-core');
 *   const { launchBrowser } = require('./_browser_launch.cjs');
 *   const browser = await launchBrowser(chromium);                        // 默认 headless
 *   const browser = await launchBrowser(chromium, { args: ['--no-sandbox'] });
 */

/** 系统浏览器通道，按优先级排列（保留 Windows 现行 Edge 口径）。 */
const SYSTEM_CHANNELS = ['msedge'];

/** 无网络/无浏览器时给出的安装指引。 */
const INSTALL_HINT = [
  '',
  '修复方式（任选其一）：',
  '  A) 安装项目正式声明的 Chromium：',
  '       npx playwright-core install chromium',
  '  B) 显式指定本机已有浏览器：',
  '       E2E_BROWSER_CHANNEL=chrome npm run e2e:product-home      # macOS 若装了 Chrome',
  '       E2E_BROWSER_CHANNEL=msedge  npm run e2e:product-home     # 装有 Microsoft Edge',
  '       E2E_BROWSER_EXECUTABLE_PATH=/path/to/browser npm run e2e:product-home',
  '',
].join('\n');

/** 单行摘要（聚合错误里只保留首行，避免刷屏）。 */
function firstLine(err) {
  const msg = err && err.message ? err.message : String(err);
  return msg.split('\n').map((s) => s.trim()).filter(Boolean)[0] || msg.trim();
}

/** 构造「全部候选都失败」的聚合错误。 */
function aggregateError(attempts) {
  const detail = attempts.map((a) => `  - ${a.label}: ${a.reason}`).join('\n');
  const err = new Error(`[browser-launch] 无法启动任何浏览器。逐项尝试结果：\n${detail}\n${INSTALL_HINT}`);
  err.code = 'E2E_NO_BROWSER';
  err.attempts = attempts;
  return err;
}

/**
 * 启动浏览器（跨平台）。
 * @param {object} chromium playwright-core 导出的 chromium
 * @param {object} [options]
 * @param {boolean} [options.headless=true]
 * @param {string[]} [options.args] 额外的 Chromium 命令行参数（原样透传）
 * @param {string} [options.executablePath] 显式可执行文件路径
 * @param {boolean} [options.verbose] 打印最终选用的浏览器（默认打印一次，便于排障）
 * @returns {Promise<import('playwright-core').Browser>}
 */
async function launchBrowser(chromium, options = {}) {
  if (!chromium || typeof chromium.launch !== 'function') {
    throw new Error('[browser-launch] 第一个参数必须是 playwright-core 的 chromium 对象');
  }

  const { headless = true, verbose = true, ...rest } = options;
  const attempts = [];

  const attempt = async (label, launchOptions) => {
    try {
      const browser = await chromium.launch({ headless, ...launchOptions, ...rest });
      if (verbose) console.log(`[browser-launch] 使用 ${label}`);
      return browser;
    } catch (err) {
      attempts.push({ label, reason: firstLine(err) });
      return null;
    }
  };

  // ---- 0) 显式可执行文件路径（MSEDGE 为历史兼容）----
  const explicitPath =
    options.executablePath || process.env.E2E_BROWSER_EXECUTABLE_PATH || process.env.MSEDGE;
  if (explicitPath) {
    const b = await attempt(`executablePath=${explicitPath}`, { executablePath: explicitPath });
    if (b) return b;
    // 显式指定却失败 ⇒ 不猜测其它浏览器，直接报错
    throw aggregateError(attempts);
  }

  // ---- 1) 显式通道（失败即报错）----
  const envChannel = (process.env.E2E_BROWSER_CHANNEL || '').trim();
  if (envChannel) {
    const b = await attempt(`channel=${envChannel}（来自 E2E_BROWSER_CHANNEL）`, { channel: envChannel });
    if (b) return b;
    throw aggregateError(attempts);
  }

  // ---- 2) 系统浏览器通道（Windows 现行 Edge 口径）----
  for (const channel of SYSTEM_CHANNELS) {
    const b = await attempt(`channel=${channel}（系统浏览器）`, { channel });
    if (b) return b;
  }

  // ---- 3) 项目正式声明的 Chromium（Playwright bundled）----
  const b = await attempt('项目 Chromium（Playwright bundled）', {});
  if (b) return b;

  // ---- 4) 全败：聚合报错，绝不静默继续 ----
  throw aggregateError(attempts);
}

module.exports = { launchBrowser, SYSTEM_CHANNELS, INSTALL_HINT };
