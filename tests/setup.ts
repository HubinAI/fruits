/**
 * F-WX-2.1｜vitest setup：每个测试文件求值前绑定 Web Core。
 *
 * - setupFiles 在测试文件 import 之前执行 → 业务模块（含 adFrequency 顶层读 storage）
 *   在既有测试里仍读到 WebStorage（localStorage），与 Web 启动行为一致，零改造回归；
 * - 需要验证 WeChat 绑定的用例（tests/platformBinding.test.ts）在用例内
 *   bindPlatformCore(createWechatCore(...)) 并在 afterEach 还原为 Web Core。
 */
import { bindPlatformCore } from '../src/platform/context';
import { createWebCore } from '../src/platform/web';

bindPlatformCore(createWebCore());
