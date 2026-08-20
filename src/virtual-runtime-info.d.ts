/**
 * F-DEV-1：vite 虚拟模块 `virtual:runtime-info` 的类型声明。
 * 实际值由 vite.config.ts 插件在 dev/build 启动时经 git 注入（非手写常量）。
 */
declare module 'virtual:runtime-info' {
  interface RuntimeInfo {
    sha: string;
    branch: string;
  }
  const info: RuntimeInfo;
  export default info;
}
