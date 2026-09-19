/**
 * PRP-R2-DEFAULT-EXPERIENCE-ENTRY｜「正常启动即进入本轮原型」startup-chain 门禁（纯 node）。
 *
 * 事件背景：PRP-F0 / PRP-R1 两轮技术门禁全绿，但真人录屏仍然先进入旧横屏游戏
 * （横屏主界面 / 横屏战斗 / 横屏结算），必须手输 `/run-page.html` 才看得到本轮产物。
 * 根因不在页面渲染，而在**启动链**：`npm run dev` → `vite` → 根路径 `/` → `index.html`。
 *
 * 本文件冻结三件事：
 *   A) 根路径重写规则（纯函数）：`/` → 本轮原型入口；其余（含旧游戏 `/index.html`）一律不重写；
 *   B) 插件是 **dev-only**：只 `apply: 'serve'`，构建期零影响、不 import 任何原型运行时；
 *   C) 既有隔离守卫**未被削弱**：正式入口 + 四个正式构建配置仍 0 引用原型字面量
 *      （与 R23 / RP-27 同口径，本文件是它们的「改动后复检」）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  BRANCH_DEFAULT_DEV_ENTRY,
  branchDefaultEntryAvailable,
  branchDefaultEntryPlugin,
  resolveDevEntryRewrite,
} from '../build/branchDevEntry';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

/** 剥掉注释后再做「字面量泄漏」判断（注释里说明性是允许的）。 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('PRP-R2｜A. 默认启动链 = 根路径直接落到本轮原型', () => {
  it('R2-01 根路径 `/` 重写为本轮原型入口（用户无需输入任何 URL）', () => {
    expect(resolveDevEntryRewrite('/')).toBe(BRANCH_DEFAULT_DEV_ENTRY);
    expect(BRANCH_DEFAULT_DEV_ENTRY).toBe('/run-page.html');
    // 带 query / hash 的根路径同样命中（浏览器自动打开可能带参数）
    expect(resolveDevEntryRewrite('/?player=1')).toBe(BRANCH_DEFAULT_DEV_ENTRY);
    expect(resolveDevEntryRewrite('/#top')).toBe(BRANCH_DEFAULT_DEV_ENTRY);
  });

  it('R2-02 旧横屏正式游戏 `/index.html` 不被重写 —— 仍是可直达的显式备用入口', () => {
    expect(resolveDevEntryRewrite('/index.html')).toBeNull();
    // 旧游戏是正式入口，必须完整保留（本 Queue 禁止删除正式横屏游戏）
    const html = read('index.html');
    expect(html.includes('最强水果 — Physics Lab')).toBe(true);
    expect(html.includes('<div id="app"></div>')).toBe(true);
    expect(html.includes('/src/main.ts')).toBe(true);
  });

  it('R2-03 其余路径一律不重写（原型入口自身 / Debug 页 / 资源 / 空值）', () => {
    for (const u of [
      '/run-page.html',
      '/portrait-lab.html',
      // PRP-M2：验证入口同样**不**被重写（默认启动链只认根路径）
      '/next-run.html',
      // PRP-M3：遭遇验证台同样**不**被重写（同上；本轮新增的第四个原型入口）
      '/encounter-lab.html',
      // PRP-VALIDATION-HUB-R1：验证中心（三个验证入口的导航壳）同样**不**被重写
      // —— 它只是把已验证的入口摆到一页上，不改默认启动链
      '/validation-hub.html',
      // PRP-M3-CONTENT-BATCH-01：M3 内容批次验证台同样**不**被重写（同上；第六个原型入口）
      '/content-batch.html',
      '/src/main.ts',
      '/src/lab/portraitBattleLab/runMain.ts',
      '/@vite/client',
      '/assets/index.js',
      '',
      undefined,
      null,
    ]) {
      expect(resolveDevEntryRewrite(u), `不应重写：${String(u)}`).toBeNull();
    }
  });

  it('R2-04 目标入口在本次工作区真实存在（否则插件自动跳过，根路径不会 404）', () => {
    expect(branchDefaultEntryAvailable(REPO_ROOT)).toBe(true);
    expect(branchDefaultEntryAvailable(join(REPO_ROOT, 'src'))).toBe(false);
    expect(existsSync(join(REPO_ROOT, 'run-page.html'))).toBe(true);
  });

  it('R2-05 `npm run dev` 会自动打开浏览器（唯一正常启动命令 → 第一屏即原型）', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.dev).toBe('vite --open');
    // 自动打开的落地 URL 由 Vite 取根 URL `/`（未设 server.open）→ 经 R2-01 重写为原型入口
    expect(read('vite.config.ts').includes('open:')).toBe(false);
    // 旧横屏正式游戏 / Debug Lab 都降级为**显式**备用入口
    expect(pkg.scripts['dev:legacy']).toBe('vite --open=/index.html');
    expect(pkg.scripts['dev:debug-lab']).toBe('vite --open=/portrait-lab.html');
  });
});

describe('PRP-R2｜B. 重写插件是 dev-only（构建期零影响）', () => {
  it('R2-06 插件只在 serve 生效，且不 import 任何原型运行时', () => {
    const src = stripComments(read('build/branchDevEntry.ts'));
    expect(src.includes("apply: 'serve'")).toBe(true);
    expect(src.includes("apply: 'build'")).toBe(false);
    // 只改请求路径字符串 —— 不依赖 src/lab 下任何模块
    expect(src.includes('src/lab')).toBe(false);
    expect(src.includes('portraitBattleLab')).toBe(false);
  });

  it('R2-07 插件已被 vite.config.ts 真实注册（不是只定义没接上）', () => {
    const cfg = stripComments(read('vite.config.ts'));
    expect(cfg.includes("from './build/branchDevEntry.ts'")).toBe(true);
    expect(cfg.includes('branchDefaultEntryPlugin()')).toBe(true);
    // 中间件按注册顺序执行：必须排在 runtimeInfoPlugin 之前（先于 Vite 内部中间件）
    expect(cfg.indexOf('branchDefaultEntryPlugin()')).toBeLessThan(cfg.indexOf('runtimeInfoPlugin()'));
  });

  it('R2-08 插件对象形状正确（name / apply / configureServer）', () => {
    const plugin = branchDefaultEntryPlugin();
    expect(plugin.name).toBe('prp-branch-default-dev-entry');
    expect(plugin.apply).toBe('serve');
    expect(typeof plugin.configureServer).toBe('function');
  });
});

describe('PRP-R2｜C. 既有隔离守卫未被削弱（R23 / RP-27 改动后复检）', () => {
  it('R2-09 正式入口 + 四个正式构建配置仍 0 引用原型字面量', () => {
    const targets = [
      'index.html',
      'vite.config.ts',
      'vite.pages.config.ts',
      'vite.e2e.config.ts',
      'vite.wechat.config.ts',
    ];
    for (const t of targets) {
      const src = read(t);
      // 本文件里的「说明性注释」不算泄漏：剥注释后检查（与 RP-27 同级强度）
      const code = stripComments(src);
      for (const banned of ['run-page', 'runMain', 'portrait-lab', 'portraitBattleLab']) {
        expect(code.includes(banned), `${t} 不得引用 ${banned}`).toBe(false);
      }
    }
  });

  it('R2-10 根目录只有七个 HTML 入口（不存在「绕过默认启动链的页面」）', () => {
    const htmls = readdirSync(REPO_ROOT)
      .filter((f) => f.endsWith('.html'))
      .sort();
    // ⚠️ PRP-M2 新增 `next-run.html`（「下一局起始改装」验证入口）；PRP-M3 新增
    //    `encounter-lab.html`（遭遇验证台）；PRP-VALIDATION-HUB-R1 新增 `validation-hub.html`
    //    （验证中心：验证入口的导航壳）；PRP-M3-CONTENT-BATCH-01 新增 `content-batch.html`
    //    （M3 内容批次验证台）。四者同样**不绕过**任何守卫：
    //    不在默认启动链上（根路径仍只重写到玩家入口）、不进入任何正式构建、
    //    只由各自的 `npm run dev:*` 显式打开（清单按字典序）。
    expect(htmls).toEqual([
      'content-batch.html',
      'encounter-lab.html',
      'index.html',
      'next-run.html',
      'portrait-lab.html',
      'run-page.html',
      'validation-hub.html',
    ]);
  });
});
