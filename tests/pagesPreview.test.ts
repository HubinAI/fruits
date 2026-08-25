/**
 * F-WX-6.1｜固定 Web Mobile Preview（GitHub Pages）源码守卫测试。
 *
 * 断言点（结构与行为契约，防止后续改动破坏 Pages 部署链）：
 * 1. vite.pages.config.ts：base=/fruits/、__PAGES_PREVIEW__ define、dist-pages、runtimeInfoPlugin；
 * 2. main.ts：Pages 预览默认启用 Canvas UI（isPagesPreview || ?canvasui=1），普通 DEV 行为不变；
 * 3. main.ts：Badge 在 Pages 预览（production 语义）下仍显示 short SHA（构建期注入，非手写）；
 * 4. src/pages-preview.d.ts 声明 __PAGES_PREVIEW__（typeof 守卫防 ReferenceError）；
 * 5. package.json：build:pages 脚本存在；
 * 6. .github/workflows/pages.yml：push foundation-02-wechat + workflow_dispatch 触发、
 *    dist-pages artifact、deploy-pages、dist 不 commit 进业务分支（workflow 即产物）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function read(rel: string): string {
  return readFileSync(ROOT + rel, 'utf8');
}

describe('F-WX-6.1 Pages Preview 构建配置', () => {
  it('vite.pages.config.ts：base=/fruits/（Pages 子路径，assets 前缀正确）', () => {
    expect(read('vite.pages.config.ts')).toContain("base: '/fruits/'");
  });

  it('vite.pages.config.ts：define __PAGES_PREVIEW__（默认 Canvas UI）', () => {
    expect(read('vite.pages.config.ts')).toContain('__PAGES_PREVIEW__');
    expect(read('vite.pages.config.ts')).toContain("'true'");
  });

  it('vite.pages.config.ts：独立产物目录 dist-pages + runtimeInfoPlugin（构建期 SHA）', () => {
    const src = read('vite.pages.config.ts');
    expect(src).toContain("outDir: 'dist-pages'");
    expect(src).toContain('runtimeInfoPlugin()');
  });

  it('src/pages-preview.d.ts：声明 __PAGES_PREVIEW__（typeof 守卫防未声明变量 ReferenceError）', () => {
    const src = read('src/pages-preview.d.ts');
    expect(src).toContain('__PAGES_PREVIEW__');
    expect(src).toContain('boolean | undefined');
  });

  it('package.json：build:pages 脚本存在且不动其它脚本', () => {
    const src = read('package.json');
    expect(src).toContain('"build:pages"');
    expect(src).toContain('"build:wechat"');
    expect(src).toContain('"dev:mobile"');
  });
});

describe('F-WX-6.1 main.ts 默认 Canvas + short SHA Badge', () => {
  const MAIN = read('src/main.ts');

  it('Pages 预览默认启用 Canvas UI：isPagesPreview || ?canvasui=1，普通 DEV 行为不变', () => {
    // 守卫：typeof __PAGES_PREVIEW__（未注入构建为 undefined → false）
    expect(MAIN).toContain("typeof __PAGES_PREVIEW__ !== 'undefined'");
    // 默认 Canvas：isPagesPreview || ?mobile-review=1 || URLSearchParams(location.search).has('canvasui')
    expect(MAIN).toMatch(/canvasUiMode\s*=\s*isPagesPreview\s*\|\|\s*reviewOn\s*\|\|\s*new URLSearchParams\(location\.search\)\.has\('canvasui'\)/);
  });

  it('F-DEMO-WEB-R1：Badge 仅 dev/test（DEV_TOOLS_VISIBLE）显示，PROD 公开版隐藏', () => {
    // 改动后：badge 条件不再含 isPagesPreview（公开 Pages PROD 不再显示调试角标）
    expect(MAIN).toContain('if (DEV_TOOLS_VISIBLE) {');
    expect(MAIN).not.toContain('if (DEV_TOOLS_VISIBLE || isPagesPreview) {');
    // short SHA 来自构建期 runtimeInfo（slice(0,7)），非手写常量
    expect(MAIN).toContain('runtimeInfo.sha.slice(0, 7)');
  });

  it('不手写 SHA：main.ts 不出现本仓库历史 commit 前缀硬编码', () => {
    // 防止有人把「当前 HEAD SHA」手写进 main.ts 造成自引用循环（E 项红线）
    expect(MAIN).not.toMatch(/685dc55[0-9a-f]{33}/);
  });
});

describe('F-WX-6.1 GitHub Actions Pages workflow', () => {
  const WF = read('.github/workflows/pages.yml');

  it('F-DEMO-WEB-R1：仅 workflow_dispatch 手动触发，不自动跟随开发提交', () => {
    // 手动触发入口必须存在
    expect(WF).toContain('workflow_dispatch');
    // 不得有 push 自动触发（避免每次提交误推外网版本）
    const onBlock = WF.split('on:')[1] ?? '';
    const afterOn = onBlock.split('permissions:')[0] ?? '';
    expect(afterOn).not.toMatch(/^\s*push\s*:/m);
    expect(afterOn).not.toContain('branches:');
  });

  it('官方流程：npm ci → build:pages → upload-pages-artifact(dist-pages) → deploy-pages', () => {
    expect(WF).toContain('npm ci');
    expect(WF).toContain('npm run build:pages');
    expect(WF).toContain('actions/upload-pages-artifact@v3');
    expect(WF).toContain('path: dist-pages');
    expect(WF).toContain('actions/deploy-pages@v4');
  });

  it('dist 不 commit 进业务分支：workflow 内无 git add/commit dist 步骤', () => {
    // 禁止「把 dist 手工 commit 到业务分支」——构建产物只作为 artifact 上传
    expect(WF).not.toMatch(/git\s+add/i);
    expect(WF).not.toMatch(/git\s+commit/i);
  });

  it('权限最小化：pages: write + id-token: write（Actions Pages 官方要求）', () => {
    expect(WF).toContain('pages: write');
    expect(WF).toContain('id-token: write');
  });
});
