/**
 * F-WX-RC-REPRODUCIBLE-BUILD-P0｜RC 包与 Git 提交一致性门禁 targeted test。
 *
 * 覆盖（Must#7）：
 * - 受控路径判定：src、tests、scripts、wechat、package.json、vite 配置、tsconfig 等 dirty 即受控；
 *   .workbuddy/memory、dist、outputs、HANDOFF 等非源码记录 → 忽略；
 * - filterControlledDirty：worktree dirty / staged dirty（porcelain v1 行格式）/ rename / 引号路径；
 * - verifyRcShas：badge=HEAD 前 7 位 + rcJson=HEAD + bundle=HEAD 全等通过；任一旧 SHA 失败；
 * - makeRcBuildInfo 字段（fullSha/shortSha/branch/dirty/buildTime/buildMode=rc）；
 * - extractBundleSha 提取 runtimeInfo sha；
 * - readGitState 经注入 runner 读取（clean → 空 dirtyFiles；src dirty → 列出；memory-only → 忽略）。
 *
 * 不修改任何游戏逻辑 / UI / Renderer（仅 scripts + 构建配置 + 微信入口 badge 拼接）。
 */
import { describe, it, expect } from 'vitest';
import {
  isControlledPath,
  isIgnoredPath,
  filterControlledDirty,
  readGitState,
  makeRcBuildInfo,
  verifyRcShas,
  extractBundleSha,
} from '../scripts/rc-gate.js';

const HEAD = 'ca006f0c1c90a25467d255fba010d7c6b44b6655';

describe('F-WX-RC-REPRODUCIBLE-BUILD-P0｜受控路径判定', () => {
  it('1. src/tests/scripts/wechat/package.json/vite config/tsconfig 均为受控', () => {
    for (const p of [
      'src/ui/canvasPlayerUIHost.ts',
      'tests/rcGate.test.ts',
      'scripts/wechat-rc.js',
      'wechat/game.ts',
      'package.json',
      'package-lock.json',
      'vite.wechat.config.ts',
      'vite.config.ts',
      'tsconfig.json',
    ]) {
      expect(isControlledPath(p), p).toBe(true);
    }
  });

  it('2. .workbuddy/memory、dist、outputs、HANDOFF 等非源码记录忽略', () => {
    for (const p of [
      '.workbuddy/memory/2026-08-30.md',
      'dist-wechat/game.js',
      'dist/',
      'outputs/x.js',
      'HANDOFF_2026-08-22.md',
      '交接文档_2026-08-29_c3ed90d.md',
    ]) {
      expect(isControlledPath(p), p).toBe(false);
      expect(isIgnoredPath(p), p).toBe(true);
    }
  });
});

describe('F-WX-RC-REPRODUCIBLE-BUILD-P0｜dirty 过滤（Must#2/#3）', () => {
  it('3. worktree dirty（porcelain " M src/…"）→ 受控列出', () => {
    const dirty = filterControlledDirty([' M src/ui/canvasPlayerUIHost.ts']);
    expect(dirty).toEqual(['src/ui/canvasPlayerUIHost.ts']);
  });

  it('4. staged dirty（"M  src/…"）→ 受控列出（Must#7：staged dirty 构建失败）', () => {
    const dirty = filterControlledDirty(['M  src/game/playerGameRuntime.ts']);
    expect(dirty).toEqual(['src/game/playerGameRuntime.ts']);
  });

  it('5. memory-only dirty → 忽略（允许构建）', () => {
    const dirty = filterControlledDirty([
      ' M .workbuddy/memory/2026-08-30.md',
      '?? .workbuddy/memory/2026-08-17.md',
    ]);
    expect(dirty).toEqual([]);
  });

  it('6. 混合：受控 + 非受控 → 仅受控列出；未识别顶层文件默认受控（宁严勿松）', () => {
    const dirty = filterControlledDirty([
      ' M src/ui/topSafeLayout.ts',
      ' M dist-wechat/game.js',
      '?? outputs/x.json',
      '?? 未知文件.txt',
    ]);
    expect(dirty).toEqual(['src/ui/topSafeLayout.ts', '未知文件.txt']);
  });

  it('7. rename（"R  src/a.ts -> src/b.ts"）→ 取新路径', () => {
    const dirty = filterControlledDirty(['R  src/a.ts -> src/b.ts']);
    expect(dirty).toEqual(['src/b.ts']);
  });

  it('8. 引号包裹路径（含空格）剥离引号', () => {
    const dirty = filterControlledDirty([' M "src/my file.ts"']);
    expect(dirty).toEqual(['src/my file.ts']);
  });

  it('9. readGitState：clean → dirtyFiles 空；src dirty → 列出；memory-only → 空', () => {
    const clean = readGitState((args) => {
      if (args[0] === 'branch') return 'foundation-02-wechat';
      if (args[0] === 'rev-parse') return HEAD;
      return '';
    });
    expect(clean.branch).toBe('foundation-02-wechat');
    expect(clean.headSha).toBe(HEAD);
    expect(clean.dirtyFiles).toEqual([]);

    const srcDirty = readGitState((args) => {
      if (args[0] === 'branch') return 'foundation-02-wechat';
      if (args[0] === 'rev-parse') return HEAD;
      return ' M src/render/renderer.ts';
    });
    expect(srcDirty.dirtyFiles).toEqual(['src/render/renderer.ts']);

    const memoryOnly = readGitState((args) => {
      if (args[0] === 'branch') return 'foundation-02-wechat';
      if (args[0] === 'rev-parse') return HEAD;
      return ' M .workbuddy/memory/2026-08-30.md';
    });
    expect(memoryOnly.dirtyFiles).toEqual([]);
  });
});

describe('F-WX-RC-REPRODUCIBLE-BUILD-P0｜rc-build.json 与三方校验（Must#5/#6）', () => {
  it('10. makeRcBuildInfo 字段齐全（buildMode=rc）', () => {
    const info = makeRcBuildInfo({ fullSha: HEAD, shortSha: HEAD.slice(0, 7), branch: 'foundation-02-wechat', dirty: false, buildTime: '2026-08-30T00:00:00.000Z' });
    expect(info).toEqual({
      fullSha: HEAD,
      shortSha: HEAD.slice(0, 7),
      branch: 'foundation-02-wechat',
      dirty: false,
      buildTime: '2026-08-30T00:00:00.000Z',
      buildMode: 'rc',
    });
  });

  it('11. 三方一致（badge=前7位 / rcJson=HEAD / bundle=HEAD）→ 通过', () => {
    expect(verifyRcShas({ headSha: HEAD, badgeSha: HEAD.slice(0, 7), rcJsonSha: HEAD, bundleSha: HEAD })).toBe(true);
  });

  it('12. 旧 badge SHA → 失败（Must#7：旧 SHA 无法通过校验）', () => {
    expect(verifyRcShas({ headSha: HEAD, badgeSha: '9b7556b', rcJsonSha: HEAD, bundleSha: HEAD })).toBe(false);
  });

  it('13. rc-build.json SHA 旧 / bundle SHA 旧 / badge null → 失败', () => {
    expect(verifyRcShas({ headSha: HEAD, badgeSha: HEAD.slice(0, 7), rcJsonSha: '9b7556b49909018484dadb8d874007ecfc02e462', bundleSha: HEAD })).toBe(false);
    expect(verifyRcShas({ headSha: HEAD, badgeSha: HEAD.slice(0, 7), rcJsonSha: HEAD, bundleSha: '9b7556b49909018484dadb8d874007ecfc02e462' })).toBe(false);
    expect(verifyRcShas({ headSha: HEAD, badgeSha: null, rcJsonSha: HEAD, bundleSha: HEAD })).toBe(false);
  });

  it('14. extractBundleSha：提取 runtimeInfo sha 字面量；缺省 null', () => {
    const js = 'const x = {"sha": "ca006f0c1c90a25467d255fba010d7c6b44b6655"};';
    expect(extractBundleSha(js)).toBe(HEAD);
    expect(extractBundleSha('no sha here')).toBeNull();
  });
});
