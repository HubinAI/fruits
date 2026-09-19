/**
 * PRP-VALIDATION-HUB-R1｜验证中心（Validation Hub）的 node 侧门禁。
 *
 * 本 Queue 交付的是一个**纯测试壳**，没有新玩法、没有新数值、没有新敌人。
 * 因此这里守的不是「玩法对不对」，而是四件容易腐坏的事：
 *
 *   A) **Hub 上摆的就是该摆的三个** —— 三入口 / 顺序 / 对应 Queue / 指向真实页面，
 *      既不缺（少一个就没法批量验收）也不多（不把历史 Lab 接进来）。
 *   B) **Hub 是纯导航** —— import 图里没有战斗 / 物理 / Runtime；不画、不读像素、
 *      不写任何战斗数值；也不向三个入口页面注入任何东西。
 *   C) **默认启动链零污染** —— `npm run dev` 仍是 `vite --open`、根路径仍只重写到
 *      玩家入口、`/validation-hub.html` 不被重写、五个正式构建配置 0 引用。
 *   D) **「上次进入」标记只指路不判定** —— 只读写本表内的 id；storage 被禁用 / 抛异常都不崩。
 *
 * 浏览器侧的真实闭环（切换 / 无残留 / 入口真能进）见 `tests/_e2e_validation_hub.cjs`。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BRANCH_DEFAULT_DEV_ENTRY, resolveDevEntryRewrite } from '../build/branchDevEntry';
import {
  VALIDATION_HUB_ENTRIES,
  VALIDATION_HUB_STORAGE_KEY,
  nextValidationHubEntry,
  readValidationHubLastEntry,
  validationHubEntryById,
  writeValidationHubLastEntry,
  type ValidationHubStore,
} from '../src/lab/portraitBattleLab/validationHub';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
/**
 * 剥掉 HTML 注释后再判「字面量泄漏」。
 * ⚠️ 与本仓库既有口径一致（见 `portraitDefaultEntry.test.ts` R2-09）：
 *    注释里**说明性**地提到某个字面量（例如解释「本页与 run-page.html 分离」）
 *    不算引用；只有当它出现在**可执行结构**里才算。
 */
const stripHtmlComments = (src: string): string => src.replace(/<!--[\s\S]*?-->/g, '');

const LAB = 'src/lab/portraitBattleLab';
const HUB_LOGIC = `${LAB}/validationHub.ts`;
const HUB_MAIN = `${LAB}/validationHubMain.ts`;
const HUB_HTML = 'validation-hub.html';

/** 验证入口的**页面文件**（Hub 只导航到它们，绝不包裹 / 改写 / 注入）。 */
const ENTRY_PAGES = ['run-page.html', 'next-run.html', 'encounter-lab.html', 'content-batch.html'];

/** Hub 相关字面量：任何一个出现在入口页面里都说明「Hub 往玩家画面伸手了」。 */
const HUB_TOKENS = ['validation-hub', 'vhub', '__VALIDATIONHUB__', 'ValidationHub'];

describe('PRP-VALIDATION-HUB-R1｜A. Hub 上摆的就是该摆的四个', () => {
  it('H-01 恰好四个入口，id / 顺序 / label 与各 Queue 原文逐一对应（不接历史 Lab）', () => {
    expect(VALIDATION_HUB_ENTRIES).toHaveLength(4);
    expect(VALIDATION_HUB_ENTRIES.map((e) => e.id)).toEqual([
      'fullRun',
      'nextRun',
      'encounterBatch',
      'contentBatch',
    ]);
    expect(VALIDATION_HUB_ENTRIES.map((e) => e.label)).toEqual([
      'Full Run',
      'Next Run',
      'Encounter Batch',
      'Content Batch',
    ]);
    // 调试页 / 历史 Lab 一律不进 Hub
    for (const e of VALIDATION_HUB_ENTRIES) {
      expect(e.pageFile, `${e.id} 不得指向 Debug Lab`).not.toBe('portrait-lab.html');
    }
  });

  it('H-02 每个入口都指向一个真实存在的根目录 HTML，且四者互不相同', () => {
    const files = VALIDATION_HUB_ENTRIES.map((e) => e.pageFile);
    expect(new Set(files).size).toBe(4);
    for (const e of VALIDATION_HUB_ENTRIES) {
      const abs = join(REPO_ROOT, e.pageFile);
      expect(existsSync(abs), `${e.pageFile} 不存在`).toBe(true);
      expect(statSync(abs).size, `${e.pageFile} 是空文件`).toBeGreaterThan(0);
      // href 与文件名同源（改一处必改另一处，防「指向不存在的页面」）
      expect(e.href, `${e.id} 的 href 与 file 不同源`).toBe(`./${e.pageFile}`);
      // 相对链接：dev（/validation-hub.html）与独立产物（dist-portrait-lab/）两边都成立
      expect(e.href.startsWith('./')).toBe(true);
    }
  });

  it('H-03 Full Run 的入口就是**玩家正式页面本身**（Hub 不复制 / 不包裹 / 不改写它）', () => {
    const full = validationHubEntryById('fullRun');
    if (full === null) throw new Error('Hub 缺少 fullRun 入口');
    // 默认启动链的落地页（根路径重写目标）= 同一个文件 ⇒ Hub 里的 Full Run 就是玩家那一页
    expect(BRANCH_DEFAULT_DEV_ENTRY).toBe('/run-page.html');
    expect(full.pageFile).toBe(BRANCH_DEFAULT_DEV_ENTRY.replace(/^\//, ''));
    // 反过来：玩家页面里不得留下任何 Hub 痕迹（没有返回按钮、没有注入的控件）
    const player = read('run-page.html');
    for (const t of HUB_TOKENS) {
      expect(player.includes(t), `run-page.html 不得含 ${t}`).toBe(false);
    }
  });

  it('H-04 四个入口分别可追溯到已交付的四个 Queue，且后备命令真实可执行', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const want: Record<string, string> = {
      fullRun: 'PRP-RUN-02-FULL-RUN-VERTICAL-SLICE',
      nextRun: 'PRP-M2-NEXT-RUN-SEED-VALIDATION',
      encounterBatch: 'PRP-M3-ENCOUNTER-BATCH-01',
      contentBatch: 'PRP-M3-CONTENT-BATCH-01',
    };
    for (const e of VALIDATION_HUB_ENTRIES) {
      expect(e.queueId, `${e.id} 的 queueId 与交付不符`).toBe(want[e.id]);
      // 「验证什么」必须是人话，不是占位
      expect(e.verifies.length, `${e.id} 缺少验证目标`).toBeGreaterThan(8);
      // 后备命令必须真的存在（否则 Hub 之外就没法单独打开）
      expect(e.command.startsWith('npm run dev:'), `${e.id} 命令不是 dev:*`).toBe(true);
      const script = e.command.replace('npm run ', '');
      expect(pkg.scripts[script], `package.json 缺少 script ${script}`).toBe(`vite --open=/${e.pageFile}`);
    }
  });

  it('H-05 四个入口恰好覆盖四个验证页面（既不缺也不多）', () => {
    expect(VALIDATION_HUB_ENTRIES.map((e) => e.pageFile).sort()).toEqual([...ENTRY_PAGES].sort());
    // 根目录里不存在「不在 Hub 上、也不是 Debug 页 / 正式入口」的第五个验证页面
    const extras = readdirSync(REPO_ROOT)
      .filter((f) => f.endsWith('.html'))
      .filter((f) => !ENTRY_PAGES.includes(f) && f !== HUB_HTML && f !== 'index.html' && f !== 'portrait-lab.html');
    expect(extras).toEqual([]);
  });
});

describe('PRP-VALIDATION-HUB-R1｜B. Hub 是纯导航（不碰运行时、不碰玩家画面）', () => {
  it('H-06 源码级：Hub 两个 .ts 的 import 图里只有 Hub 自己（零战斗 / 物理 / 平台模块）', () => {
    let totalSpecs = 0;
    for (const f of [HUB_LOGIC, HUB_MAIN]) {
      const code = stripComments(read(f));
      const specs = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      totalSpecs += specs.length;
      for (const s of specs) {
        expect(s, `${f} 只允许 import './validationHub'`).toBe('./validationHub');
      }
    }
    // 守卫不能空转：页面壳至少真的 import 了那张表
    expect(totalSpecs).toBeGreaterThan(0);
  });

  it('H-07 源码级：Hub 不画、不读像素、不写任何战斗数值', () => {
    for (const f of [HUB_LOGIC, HUB_MAIN]) {
      const code = stripComments(read(f));
      for (const api of ['getContext', 'getImageData', 'requestAnimationFrame', 'createElementNS']) {
        expect(code.includes(api), `${f} 不得使用 ${api}`).toBe(false);
      }
      for (const banned of ['damage', 'cooldown', 'projectileMass', 'recoil', 'reloadMs']) {
        expect(code.includes(banned), `${f} 不得出现战斗数值 "${banned}"`).toBe(false);
      }
    }
    // 页面本身也没有画布（剥注释后判，注释里写着「本页没有画布」是说明性的）
    expect(stripHtmlComments(read(HUB_HTML)).includes('<canvas')).toBe(false);
  });

  it('H-08 Hub 不向三个验证入口页面注入任何东西（剥注释后 0 处 Hub 字面量）', () => {
    for (const p of ENTRY_PAGES) {
      const src = stripHtmlComments(read(p));
      for (const t of HUB_TOKENS) {
        expect(src.includes(t), `${p} 不得含 ${t}`).toBe(false);
      }
    }
  });

  it('H-09 独立入口真实存在：只挂 Hub 自己的脚本、只用真实 <a> 导航、不拦截默认跳转', () => {
    expect(existsSync(join(REPO_ROOT, HUB_HTML))).toBe(true);
    const html = read(HUB_HTML);
    expect(html.includes('/src/lab/portraitBattleLab/validationHubMain.ts')).toBe(true);
    expect(html.includes('<div id="vhub-root"></div>')).toBe(true);
    // 只挂自己那一个脚本（不挂任何其它原型入口）
    const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
    expect(scripts).toEqual(['/src/lab/portraitBattleLab/validationHubMain.ts']);
    // 「不得引用」一律在**剥注释后**判（注释里解释隔离关系不算引用）
    const code = stripHtmlComments(html);
    for (const t of [
      '/src/main.ts',
      'runMain.ts',
      'nextRunMain.ts',
      'encounterLabMain.ts',
      ...ENTRY_PAGES,
      'portrait-lab.html',
    ]) {
      expect(code.includes(t), `${HUB_HTML} 不得引用 ${t}`).toBe(false);
    }
    // 无按钮（导航一律真实 <a>）、无内联脚本
    expect(code.includes('<button')).toBe(false);
    expect(/<script(?![^>]*\ssrc=)/.test(code)).toBe(false);

    // 页面壳：真实 <a href> + 不 preventDefault（拦截了就不是整页导航）
    const main = stripComments(read(HUB_MAIN));
    expect(main.includes("document.createElement('a')")).toBe(true);
    expect(main.includes('.href = entry.href')).toBe(true);
    expect(main.includes('preventDefault')).toBe(false);
  });
});

describe('PRP-VALIDATION-HUB-R1｜C. 默认启动链零污染', () => {
  it('H-10 `npm run dev` 逐字不变，验证中心不在默认链上', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['dev']).toBe('vite --open');
    expect(pkg.scripts['dev:validation']).toBe('vite --open=/validation-hub.html');
    // 根路径仍只重写到玩家入口；Hub 自己不被重写（它不是玩家入口）
    expect(resolveDevEntryRewrite('/')).toBe(BRANCH_DEFAULT_DEV_ENTRY);
    expect(resolveDevEntryRewrite('/validation-hub.html')).toBeNull();
    // 相邻入口一个都没被顺手改
    for (const p of ['/run-page.html', '/next-run.html', '/encounter-lab.html', '/portrait-lab.html', '/index.html']) {
      expect(resolveDevEntryRewrite(p), `不应重写：${p}`).toBeNull();
    }
  });

  it('H-11 五个正式构建配置与正式入口 0 引用验证中心', () => {
    for (const t of ['index.html', 'vite.config.ts', 'vite.pages.config.ts', 'vite.e2e.config.ts', 'vite.wechat.config.ts']) {
      const code = stripComments(read(t));
      for (const token of ['validation-hub', 'validationHub', 'vhub']) {
        expect(code.includes(token), `${t} 不得引用 ${token}`).toBe(false);
      }
    }
  });

  it('H-12 独立构建真实登记了验证中心（不是只建了网页没接上）', () => {
    const cfg = stripComments(read('vite.portrait-lab.config.ts'));
    expect(cfg.includes("'validation-hub': 'validation-hub.html'")).toBe(true);
    expect(cfg.includes("outDir: 'dist-portrait-lab'")).toBe(true);
    // 仍不引入任何正式平台宏（Hub 不参与版本角标 / RC 可追溯链）
    for (const macro of ['__PLAYER_MODE__', '__WX_DEBUG__', '__PAGES_PREVIEW__', '__E2E_INTERNAL_HANDLE__', 'runtimeInfoPlugin']) {
      expect(cfg.includes(macro), `不得引入 ${macro}`).toBe(false);
    }
  });

  it('H-13 玩家正式 UI 事实仍成立：run-page.html 里没有任何 <button>', () => {
    expect(stripHtmlComments(read('run-page.html')).includes('<button')).toBe(false);
  });
});

describe('PRP-VALIDATION-HUB-R1｜D. 「上次进入」标记只指路、不判定', () => {
  it('H-14 「下一个」按 Hub 顺序循环推进（未进入 / 未知 id → 第一个）', () => {
    expect(nextValidationHubEntry(null).id).toBe('fullRun');
    expect(nextValidationHubEntry('fullRun').id).toBe('nextRun');
    expect(nextValidationHubEntry('nextRun').id).toBe('encounterBatch');
    expect(nextValidationHubEntry('encounterBatch').id).toBe('contentBatch');
    expect(nextValidationHubEntry('contentBatch').id).toBe('fullRun');
    // 历史残留 / 手改值 → 回到第一个，不崩
    expect(nextValidationHubEntry('who-knows').id).toBe('fullRun');
    expect(nextValidationHubEntry('portrait-lab').id).toBe('fullRun');
  });

  it('H-15 只读写本表内的 id；storage 被禁用 / 抛异常一律退化成「没来过」', () => {
    const mem = new Map<string, string>();
    const store: ValidationHubStore = {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => {
        mem.set(k, v);
      },
    };
    expect(readValidationHubLastEntry(store)).toBeNull();
    expect(writeValidationHubLastEntry(store, 'nextRun')).toBe(true);
    expect(mem.get(VALIDATION_HUB_STORAGE_KEY)).toBe('nextRun');
    expect(readValidationHubLastEntry(store)).toBe('nextRun');

    // 非法 id 不写
    expect(writeValidationHubLastEntry(store, 'light-swarm')).toBe(false);
    expect(readValidationHubLastEntry(store)).toBe('nextRun');

    // 手改 / 残留值一律当没写过
    mem.set(VALIDATION_HUB_STORAGE_KEY, 'ancient-lab');
    expect(readValidationHubLastEntry(store)).toBeNull();
    mem.set(VALIDATION_HUB_STORAGE_KEY, '');
    expect(readValidationHubLastEntry(store)).toBeNull();

    // 无痕 / 受限上下文
    const blocked: ValidationHubStore = {
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => {
        throw new Error('storage disabled');
      },
    };
    expect(readValidationHubLastEntry(blocked)).toBeNull();
    expect(writeValidationHubLastEntry(blocked, 'fullRun')).toBe(false);

    // 完全没有 storage
    expect(readValidationHubLastEntry(null)).toBeNull();
    expect(writeValidationHubLastEntry(null, 'fullRun')).toBe(false);
  });
});

describe('PRP-VALIDATION-HUB-R1｜E. 删除清单（防「删不干净」）', () => {
  it('H-16 constants.ts 的整块删除清单已含验证中心全部产物', () => {
    const c = read(`${LAB}/constants.ts`);
    for (const t of [
      HUB_HTML,
      'tests/portraitValidationHub.test.ts',
      'tests/_e2e_validation_hub.cjs',
      'dev:validation',
      'e2e:validation-hub',
    ]) {
      expect(c.includes(t), `删除清单缺 ${t}`).toBe(true);
    }
  });
});
