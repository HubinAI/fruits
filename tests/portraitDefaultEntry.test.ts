/**
 * PRP-R2-DEFAULT-EXPERIENCE-ENTRY｜「正常启动即进入本轮产物」startup-chain 门禁（纯 node）。
 * PRODUCT-LOOP-R1-C｜**默认落地页从 Run Page 改为正式产品首页**（Queue 必改 1）。
 *
 * 事件背景：PRP-F0 / PRP-R1 两轮技术门禁全绿，但真人录屏仍然先进入旧横屏游戏
 * （横屏主界面 / 横屏战斗 / 横屏结算），必须手输 `/run-page.html` 才看得到本轮产物。
 * 根因不在页面渲染，而在**启动链**：`npm run dev` → `vite` → 根路径 `/` → `index.html`。
 *
 * ── PRODUCT-LOOP-R1-C 为什么又换了一次落地页 ────────────────────────────────
 * A / B 两段把「首页 / Garage / Inventory / Equipped」与「Run 奖励 → 永久库存」都接上了，
 * 玩家闭环的**起点**就是首页。默认第一屏仍落在 Run Page 的话，玩家一启动就跳过首页与车库，
 * 产品闭环在结构上无法从「正常启动」走通 ⇒ 落地页改为 `/home.html`。
 *
 * 本文件冻结四件事（比 PRP-R2 时期更强，不是放宽）：
 *   A) 根路径重写规则（纯函数）：`/` → **正式产品首页**；其余（含旧默认入口
 *      `/run-page.html` 与旧游戏 `/index.html`）一律不重写；
 *   B) **研发 / 验证入口一个都没少**：七个显式入口仍各有自己的 `dev:*` 命令，
 *      且都不在默认启动链上（Queue 必改 1 原文：「不要删除」）；
 *   C) 插件是 **dev-only**：只 `apply: 'serve'`，构建期零影响、不 import 任何运行时；
 *   D) 既有隔离守卫**未被削弱**：正式入口 + 四个正式构建配置仍 0 引用原型字面量
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

describe('PRODUCT-LOOP-R1-C｜A. 默认启动链 = 根路径直接落到正式产品首页', () => {
  it('R2-01 根路径 `/` 重写为正式首页（用户无需输入任何 URL）', () => {
    expect(resolveDevEntryRewrite('/')).toBe(BRANCH_DEFAULT_DEV_ENTRY);
    expect(BRANCH_DEFAULT_DEV_ENTRY).toBe('/home.html');
    // 带 query / hash 的根路径同样命中（浏览器自动打开可能带参数）
    expect(resolveDevEntryRewrite('/?player=1')).toBe(BRANCH_DEFAULT_DEV_ENTRY);
    expect(resolveDevEntryRewrite('/#top')).toBe(BRANCH_DEFAULT_DEV_ENTRY);
    // ⚠️ 反向断言：**旧默认入口**（Run Page）现在只是一个普通显式入口 —— 必须不再被重写，
    //    否则「第一屏 = 首页」会被悄悄改回「第一屏 = Run」，而本测试仍然全绿。
    expect(resolveDevEntryRewrite('/run-page.html')).toBeNull();
    expect(resolveDevEntryRewrite('/run-page.html?run=x&reward=laser')).toBeNull();
  });

  it('R2-02 旧横屏正式游戏 `/index.html` 不被重写 —— 仍是可直达的显式备用入口', () => {
    expect(resolveDevEntryRewrite('/index.html')).toBeNull();
    // 旧游戏是正式入口，必须完整保留（本 Queue 禁止删除正式横屏游戏）
    const html = read('index.html');
    expect(html.includes('最强水果 — Physics Lab')).toBe(true);
    expect(html.includes('<div id="app"></div>')).toBe(true);
    expect(html.includes('/src/main.ts')).toBe(true);
  });

  it('R2-03 其余路径一律不重写（新默认入口自身 / 研发入口 / 资源 / 空值）', () => {
    for (const u of [
      // PRODUCT-LOOP-R1-C：新默认入口自身（重写目标不再被二次重写）
      '/home.html',
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
      '/src/product/homeMain.ts',
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
    expect(existsSync(join(REPO_ROOT, 'home.html'))).toBe(true);
    // ⚠️ 旧默认入口必须仍然存在（Queue 必改 1：研发入口「不要删除」）
    expect(existsSync(join(REPO_ROOT, 'run-page.html'))).toBe(true);
  });

  it('R2-05 `npm run dev` 会自动打开浏览器（唯一正常启动命令 → 第一屏即产品首页）', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.dev).toBe('vite --open');
    // 自动打开的落地 URL 由 Vite 取根 URL `/`（未设 server.open）→ 经 R2-01 重写为产品首页
    expect(read('vite.config.ts').includes('open:')).toBe(false);
    // 旧横屏正式游戏 / Debug Lab 都降级为**显式**备用入口
    expect(pkg.scripts['dev:legacy']).toBe('vite --open=/index.html');
    expect(pkg.scripts['dev:debug-lab']).toBe('vite --open=/portrait-lab.html');
  });

  /**
   * PRODUCT-LOOP-R1-C 必改 1 的**另一半**：改默认入口**不许顺手删掉任何研发入口**。
   *
   * 这条是本轮新增的（PRP-R2 时期不存在，因为那时「默认入口」与「Run 入口」是同一个，
   * 只要它还在就什么都还在）。换落地页之后这两件事**解耦**了 —— 必须显式钉住「一个都没少」。
   */
  it('R2-11 研发 / 验证入口一个都没少，且都不在默认启动链上', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const researchEntries: readonly [string, string, string][] = [
      ['dev:run-page', '/run-page.html', 'Run 本体（玩家页；产品闭环里由首页的相对链接进入）'],
      ['dev:validation', '/validation-hub.html', '验证中心'],
      ['dev:next-run', '/next-run.html', '下一局起始改装验证'],
      ['dev:encounter-lab', '/encounter-lab.html', '遭遇验证台'],
      ['dev:content-batch', '/content-batch.html', 'M3 内容批次验证台'],
      ['dev:debug-lab', '/portrait-lab.html', 'Debug control area（Arena A）'],
      ['dev:legacy', '/index.html', '旧横屏正式游戏'],
    ];
    for (const [script, page, what] of researchEntries) {
      expect(pkg.scripts[script], `${what} 的显式入口命令必须仍存在`).toBe(`vite --open=${page}`);
      expect(existsSync(join(REPO_ROOT, page.replace(/^\//, ''))), `${what} 的页面文件必须仍存在`).toBe(true);
      // 都不在默认启动链上（根路径只重写到首页）
      expect(resolveDevEntryRewrite(page), `${what} 不应被重写`).toBeNull();
    }
    // 产品首页也仍有自己的显式入口（不是只能靠根路径到达）
    expect(pkg.scripts['dev:home']).toBe('vite --open=/home.html');
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

  it('R2-10 根目录只有八个 HTML 入口（不存在「绕过默认启动链的页面」）', () => {
    const htmls = readdirSync(REPO_ROOT)
      .filter((f) => f.endsWith('.html'))
      .sort();
    // ⚠️ PRP-M2 新增 `next-run.html`（「下一局起始改装」验证入口）；PRP-M3 新增
    //    `encounter-lab.html`（遭遇验证台）；PRP-VALIDATION-HUB-R1 新增 `validation-hub.html`
    //    （验证中心：验证入口的导航壳）；PRP-M3-CONTENT-BATCH-01 新增 `content-batch.html`
    //    （M3 内容批次验证台）；PRODUCT-LOOP-R1-A 新增 `home.html`（竖屏**正式产品**首页 /
    //    调整战车 —— 唯一的**非验证**页面，源码在 `src/product/`）。
    //    PRODUCT-LOOP-R1-C：`home.html` 成为**默认启动链的落地页**（根路径重写目标），
    //    其余七个仍是显式备用入口（清单按字典序，数量不变）。
    expect(htmls).toEqual([
      'content-batch.html',
      'encounter-lab.html',
      'home.html',
      'index.html',
      'next-run.html',
      'portrait-lab.html',
      'run-page.html',
      'validation-hub.html',
    ]);
  });
});
