/**
 * F-WX-2.1｜Web 启动 bootstrap。
 *
 * 必须在任何业务模块（含顶层读 storage 的 adFrequency）之前 import：
 * main.ts 的第一行 import 即本模块，ESM 按 import 顺序求值，保证
 * bindPlatformCore(createWebCore()) 先于所有业务模块的模块顶层代码执行。
 */
import { bindPlatformCore } from './context';
import { createWebCore } from './web';

bindPlatformCore(createWebCore());
