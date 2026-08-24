/**
 * F-WX-7｜微信小游戏标准工程目录（可导入）源码守卫测试。
 *
 * 契约（A 项验收「build:wechat 后得到一个可直接导入开发者工具的标准目录」）：
 * 1. vite.wechat.config.ts：closeBundle 把 game.json / project.config.json 复制进 dist-wechat；
 * 2. wechat/game.json：deviceOrientation=landscape（C 项真实横屏）、showStatusBar=false；
 * 3. wechat/project.config.json：compileType=game、appid 默认 touristappid
 *    （禁止把私人 AppID 写进源码 / 提交进 Git）；
 * 4. dist-wechat 产物（构建后）存在 game.js + game.json + project.config.json，
 *    JSON 合法、内容与源一致 / appid 支持 WECHAT_APPID 覆盖（本测试不触发 build，
 *    存在性由 CI/本地构建命令验证；这里守卫源配置与复制逻辑，防止回归）。
 *
 * 平台依赖红线（D 项 Console 无错的前提，bundle 级验证见 build 集成）：
 * 5. 微信入口与 Platform WeChat 实现不得出现 document/localStorage/window 顶层依赖
 *    （wechat/game.ts 的 import 图不含 Web DOM 实现——已有 wechatPlayerSmoke 运行时验证；
 *    这里守卫源码不新增 DOM 引用）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function read(rel: string): string {
  return readFileSync(ROOT + rel, 'utf8');
}

describe('F-WX-7 微信工程目录（可直接导入）', () => {
  it('vite.wechat.config.ts：closeBundle 复制 game.json + project.config.json 到 dist-wechat', () => {
    const src = read('vite.wechat.config.ts');
    expect(src).toContain('closeBundle');
    expect(src).toContain('wechat-finalize-project');
    expect(src).toContain("'game.json'");
    expect(src).toContain("'project.config.json'");
    expect(src).toContain("outDir: 'dist-wechat'");
  });

  it('game.json：deviceOrientation=landscape（C 项真实横屏）+ showStatusBar=false', () => {
    const cfg = JSON.parse(read('wechat/game.json')) as {
      deviceOrientation: string;
      showStatusBar: boolean;
    };
    expect(cfg.deviceOrientation).toBe('landscape');
    expect(cfg.showStatusBar).toBe(false);
  });

  it('project.config.json：compileType=game，appid 默认 touristappid（私人 AppID 不入库）', () => {
    const cfg = JSON.parse(read('wechat/project.config.json')) as {
      appid: string;
      compileType: string;
    };
    expect(cfg.compileType).toBe('game');
    expect(cfg.appid).toBe('touristappid');
    // 防手滑：源码里绝不出现真实 AppID 形态（wx 开头的 18 位数字）
    expect(read('wechat/project.config.json')).not.toMatch(/"appid":\s*"wx[a-f0-9]{16}"/i);
  });

  it('WECHAT_APPID 覆盖：构建脚本从环境变量读 appid（不在源码硬编码）', () => {
    const src = read('vite.wechat.config.ts');
    expect(src).toContain('process.env.WECHAT_APPID');
  });

  it('微信入口不新增 DOM 顶层引用（bundle 级验证见 build 集成 + headless smoke）', () => {
    // wechat/game.ts 只 import 平台中立/微信实现；不得直接出现 document/localStorage 调用
    const entry = read('wechat/game.ts');
    expect(entry).not.toMatch(/document\./);
    expect(entry).not.toMatch(/localStorage/);
  });

  it('F-WX-P0｜唯一上屏 Canvas 合成链：首 canvas=screenCanvas、offscreen 不假设自动上屏、frame 末段 drawImage 合成', () => {
    const entry = read('wechat/game.ts');
    // 1) 第一次 createCanvas = 唯一上屏 canvas（screenCanvas，Renderer 绑定它）
    const creates = (entry.match(/wx\.createCanvas\(\)/g) ?? []).length;
    expect(creates).toBeGreaterThanOrEqual(2);
    expect(entry).toMatch(/const screenCanvas = wx\.createCanvas\(\)/); // 第一个 = 上屏
    expect(entry).toMatch(/const uiCanvas = wx\.createCanvas\(\)/); // 第二个 = offscreen
    expect(entry).toMatch(/new Renderer\(screenCanvas/);
    expect(entry).toMatch(/new CanvasPlayerUIHost\(uiCanvas/);
    // 2) 第二 canvas 不被假设自动上屏——源码必须有显式 drawImage 合成
    //    （不依赖「后创建的 canvas 自动叠层」这类错误假设）
    expect(entry).toMatch(/screenCtx\.drawImage\(uiCanvas/);
    // 3) frame 最后阶段：runtime.tick 之后执行 UI composite（最后一层；中间允许注释）
    expect(entry).toMatch(/\bruntime\.tick\(now\);[\s\S]*?compositeUi\(\);/);
    // 4) uiCanvas 尺寸显式同步 screenCanvas 物理像素（不依赖第二次 createCanvas 默认尺寸）
    expect(entry).toMatch(/uiCanvas\.width = screenCanvas\.width/);
    expect(entry).toMatch(/uiCanvas\.height = screenCanvas\.height/);
    // 5) 合成必须用单位变换（上一帧 Renderer 可能残留非单位 transform）
    expect(entry).toMatch(/screenCtx\.setTransform\(1, 0, 0, 1, 0, 0\)/);
  });

  it('F-WX-P0｜Runtime 版本标识稳定语义 [WECHAT-RUNTIME]，Queue 编号不作类型名，SHA 构建期注入', () => {
    const entry = read('wechat/game.ts');
    expect(entry).toContain('[WECHAT-RUNTIME]');
    expect(entry).not.toContain('[F-WX-5]'); // 旧 Queue 编号标识已移除（误导）
    // SHA 来自 virtual:runtime-info 构建期注入，非手写
    expect(entry).toContain('runtimeInfo.sha.slice(0, 7)');
  });

  it('F-WX-P0-INPUT｜DEV-only Input Trace：__WX_DEBUG__ 默认 false（PROD 零日志），WECHAT_DEBUG_INPUT=1 构建注入 true', () => {
    // 构建配置：define __WX_DEBUG__ 默认 false，环境变量可开
    const cfg = read('vite.wechat.config.ts');
    expect(cfg).toContain('__WX_DEBUG__');
    expect(cfg).toContain('WECHAT_DEBUG_INPUT');
    // 输入层有 [WX-INPUT] 诊断日志（raw/viewport/converted）
    const input = read('src/platform/wechat/input.ts');
    expect(input).toContain('[WX-INPUT] raw');
    expect(input).toContain('[WX-INPUT] converted');
    // Host 有 ui/layout/hit 命中诊断
    const host = read('src/ui/canvasPlayerUIHost.ts');
    expect(host).toContain('[WX-INPUT] hit');
    expect(host).toContain('HIT:');
    expect(host).toContain('MISS');
    // Host 输入转换收敛到单一 screenToLayoutPoint（禁止各按钮自行修坐标）
    expect(host).toContain('screenToLayoutPoint');
    expect(host).toMatch(/private screenToLayoutPoint\(x: number, y: number\)/);
  });

  it('F-WX-9A｜DEV-only 尺度诊断日志：一次性 [WX-VIEWPORT] + reframe [WX-REF]，均在 __WX_DEBUG__ gate 内（PROD 零输出）', () => {
    // 一次性视口日志在微信入口（wechat/game.ts），且必须包在 __WX_DEBUG__ gate 内
    const entry = read('wechat/game.ts');
    expect(entry).toContain('[WX-VIEWPORT]');
    // gate 结构：typeof __WX_DEBUG__ !== 'undefined' && __WX_DEBUG__ 包裹日志
    const viewportIdx = entry.indexOf('[WX-VIEWPORT]');
    const gateIdx = entry.lastIndexOf('typeof __WX_DEBUG__ !==', viewportIdx);
    expect(gateIdx, '[WX-VIEWPORT] 必须在 __WX_DEBUG__ gate 内').toBeGreaterThan(-1);
    expect(entry.indexOf('__WX_DEBUG__', gateIdx), 'gate 闭合条件存在').toBeGreaterThan(-1);
    // 日志必须包含尺度链关键字段（DPR/逻辑 viewport/profile/safeInsets/画布匹配）
    expect(entry).toContain('screenCanvas: { width: screenCanvas.width, height: screenCanvas.height }');
    expect(entry).toContain('logicalViewport');
    expect(entry).toContain('canvasMatchesWindow');
    expect(entry).toContain('resolveLayoutProfile');
    // reframe 尺度日志在 Renderer（平台中立，Web/微信共用），同样 DEV gate 内
    const renderer = read('src/render/renderer.ts');
    expect(renderer).toContain('[WX-REF]');
    expect(renderer).toContain('screenWidthPct');
    const refIdx = renderer.indexOf('[WX-REF]');
    const rGateIdx = renderer.lastIndexOf('typeof __WX_DEBUG__ !==', refIdx);
    expect(rGateIdx, '[WX-REF] 必须在 __WX_DEBUG__ gate 内').toBeGreaterThan(-1);
    // 日志是只读诊断：不改变 framing 语义（赋值在前、日志在后）
    expect(renderer.indexOf('this.transform = { scale, offsetX, offsetY }')).toBeLessThan(refIdx);
  });
});
