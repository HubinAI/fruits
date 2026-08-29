/**
 * F-WX-2.1｜微信启动 bootstrap。
 *
 * 必须在任何业务模块求值之前 import（wechat/game.ts 的第一行 import 即本模块）：
 * 先绑定 WechatCore，之后被 import 的业务模块（含顶层读 storage 的 adFrequency）
 * 一律读到 WechatStorage，绝不经过默认 Web Storage。
 *
 * pixelRatio 在模块顶层从 wx 窗口信息读取（优先 wx.getWindowInfo，回退
 * wx.getSystemInfoSync；微信环境全局 wx 启动即存在）；非微信环境（Node 测试动态
 * import 本模块）安全回退 1，仍绑定 WechatCore。
 * F-WX-VIEWPORT-SURFACE-P0｜Must#5：createWechatCore 必须传入真实 dpr，不得使用
 * 默认 1（默认 1 会让 Renderer/UI 的 dpr 变换退化为 identity → backing 与逻辑同域错乱）。
 */
import { bindPlatformCore } from './context';
import { createWechatCore } from './wechat';
import { readWechatWindowInfo } from './wechat/windowInfo';

const pixelRatio = readWechatWindowInfo()?.pixelRatio || 1;

bindPlatformCore(createWechatCore(pixelRatio));
