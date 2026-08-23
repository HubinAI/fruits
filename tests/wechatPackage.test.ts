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

  it('F-WX-8-A｜UI overlay 与主画布分离：CanvasPlayerUIHost 用独立第二个 canvas（P0 根因守卫）', () => {
    // 根因：Renderer 与 CanvasPlayerUIHost 若共享同一 wx.createCanvas()，Renderer.render()
    // 每帧 clearRect+全屏深色背景会覆盖 CanvasHost 的 Garage UI → 首屏只见「战场」。
    // 修复：微信入口必须创建第二个 canvas 作 UI overlay（微信多 canvas 层叠，透明在上层）。
    const entry = read('wechat/game.ts');
    // 两个独立 createCanvas（主画布 + UI overlay）
    const creates = (entry.match(/wx\.createCanvas\(\)/g) ?? []).length;
    expect(creates).toBeGreaterThanOrEqual(2);
    // Renderer 绑主画布 canvas；CanvasPlayerUIHost 绑 uiCanvas（不是同一个）
    expect(entry).toMatch(/new Renderer\(canvas/);
    expect(entry).toMatch(/new CanvasPlayerUIHost\(uiCanvas/);
    expect(entry).not.toMatch(/new CanvasPlayerUIHost\(canvas/);
    // overlay 必须有自己的 2d ctx（微信第二个 canvas 独立可绘）
    expect(entry).toMatch(/const uiCtx = uiCanvas\.getContext\('2d'\)/);
  });
});
