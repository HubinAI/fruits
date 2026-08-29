/**
 * F-WX-VIEWPORT-SURFACE-P0｜微信窗口信息统一读取（唯一来源）。
 *
 * 为什么需要：整条微信链路（surface / UI host / Input / 诊断）都假设
 * `canvas.width = windowWidth × pixelRatio`（物理 backing）。而微信首画布默认
 * `canvas.width = windowWidth`（逻辑尺寸）——必须由入口在创建 surface/UI/Input 之前
 * 显式把 backing 定版为 `window × dpr`，否则所有 ×dpr 变换都作用在一个只有逻辑宽的
 * buffer 上 → 全局放大 + 裁切（C3 真机/模拟器录屏现象）。
 *
 * 本模块只读 `wx.getWindowInfo()`（较新基础库；缺省回退 `wx.getSystemInfoSync()`），
 * 返回统一字段。全部字段带坐标域标注：
 * - windowWidth/windowHeight：window 逻辑 px；
 * - screenWidth/screenHeight：physical px；
 * - pixelRatio：window→backing 倍率；
 * - safeArea：window 逻辑 px 矩形。
 */
export interface WechatWindowInfo {
  /** window 逻辑 px */
  windowWidth: number;
  /** window 逻辑 px */
  windowHeight: number;
  /** physical px */
  screenWidth: number;
  /** physical px */
  screenHeight: number;
  /** window→backing 倍率（≥1） */
  pixelRatio: number;
  /** window 逻辑 px 矩形；缺省 null */
  safeArea: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } | null;
}

/** 读取微信窗口信息；wx 缺失 / API 异常时返回 null（调用方自行兜底）。 */
export function readWechatWindowInfo(): WechatWindowInfo | null {
  const wx = (globalThis as any).wx as any;
  if (!wx) return null;
  let info: Record<string, unknown> | null = null;
  try {
    if (typeof wx.getWindowInfo === 'function') {
      const r = wx.getWindowInfo();
      if (r && typeof r === 'object') info = r;
    }
    if (!info && typeof wx.getSystemInfoSync === 'function') {
      const r = wx.getSystemInfoSync();
      if (r && typeof r === 'object') info = r;
    }
  } catch {
    info = null;
  }
  if (!info) return null;
  const num = (k: string): number => (typeof info![k] === 'number' ? (info![k] as number) : 0);
  const sa = info.safeArea && typeof (info.safeArea as { left?: unknown }).left === 'number'
    ? (info.safeArea as { left: number; top: number; right: number; bottom: number; width: number; height: number })
    : null;
  return {
    windowWidth: num('windowWidth'),
    windowHeight: num('windowHeight'),
    screenWidth: num('screenWidth'),
    screenHeight: num('screenHeight'),
    pixelRatio: num('pixelRatio') || 1,
    safeArea: sa,
  };
}
