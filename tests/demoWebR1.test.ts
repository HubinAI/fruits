/**
 * F-DEMO-WEB-R1｜对外网页试玩发布链路 —— 配置回归守卫。
 *
 * 不依赖网络/部署，仅静态断言发布链路的关键约束（来自 Queue 必做#1/#2/#5/#9）：
 * - pages 构建复用现有 dist-pages + GitHub Pages 链路（base=/fruits/ + __PAGES_PREVIEW__）；
 * - 部署 workflow 仅手动触发（workflow_dispatch），不自动跟随 foundation-02-wechat 每次提交。
 *
 * 注：外网版本「隐藏开发工具 / 分辨率按钮 / 版本角标」由以下运行时逻辑保证，
 * 不在本文件静态断言（属 main.ts / env.ts 既有 PROD 语义）：
 * - DEV_TOOLS_VISIBLE = !IS_PROD → PROD 公开版隐藏 Scenario/Debug/对手编辑；
 * - main.ts 角标仅 DEV_TOOLS_VISIBLE 为真时创建（PROD 不显示）；
 * - 公开 Canvas 手机横屏入口不含「分辨率按钮」控件（代码库无该元素）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const root = resolve(__dirname, '..');
const pagesYml = readFileSync(resolve(root, '.github/workflows/pages.yml'), 'utf8');
const pagesConfig = readFileSync(resolve(root, 'vite.pages.config.ts'), 'utf8');

describe('F-DEMO-WEB-R1 · 发布链路配置', () => {
  it('pages 构建复用现有 GitHub Pages 链路（base + preview define）', () => {
    expect(pagesConfig).toContain("base: '/fruits/'");
    expect(pagesConfig).toContain("__PAGES_PREVIEW__: 'true'");
    expect(pagesConfig).toContain('build:pages');
  });

  it('部署 workflow 仅手动触发，不自动跟随开发提交', () => {
    // 手动触发入口必须存在
    expect(pagesYml).toContain('workflow_dispatch:');
    // 不得有 push 自动触发（避免每次提交误推外网版本）
    const onBlock = pagesYml.split('on:')[1] ?? '';
    const afterOn = onBlock.split('permissions:')[0] ?? '';
    expect(afterOn).not.toMatch(/^\s*push\s*:/m);
    expect(afterOn).not.toContain('branches:');
  });

  it('workflow 在构建期记录发布所用 commit SHA', () => {
    expect(pagesYml).toContain('PUBLISH_SHA');
    expect(pagesYml).toContain('git rev-parse HEAD');
  });
});
