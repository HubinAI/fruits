/**
 * F-WX-6｜紧凑横屏（Compact Mobile Landscape）判定（共享）。
 *
 * Renderer（相机 inset）与 CanvasPlayerUIHost（布局 Profile）共用同一规则：
 * - 依据 viewport 宽高比 + 高度（逻辑/CSS px，不依赖具体机型）；
 * - 目标：常见手机横屏约 800~950 × 360~450（如 844×390 / 852×393 / 932×430）；
 * - 1280×720 等 h≥600 的大横屏走 Desktop 布局（不缩小触控即可用，保持既有行为）。
 */
export function isCompactLandscape(logicalW: number, logicalH: number): boolean {
  if (logicalW <= 0 || logicalH <= 0) return false;
  const aspect = logicalW / logicalH;
  return logicalH < 600 && aspect >= 1.5;
}
