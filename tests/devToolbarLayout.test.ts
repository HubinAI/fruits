/**
 * Q13-C-R4：开发工具折叠区布局修复（仅 UI/DOM，不动 Gameplay/Physics/Scenario 数据）。
 *
 * 问题：toolsHost 被 insert 进 .lab-main（横向 flex），作为 flex item 被挤压成窄条，
 * 导致 Scenario 下拉框在常态桌面分辨率下不可见。
 *
 * 修复：把 toolsHost 移出 .lab-main，改为 .lab-root 内 toolbar 与 main 之间的独立纵向一行
 *（全宽、flex-shrink:0、不挤压战场），并给 Scenario select 明确可读宽度。
 *
 * 因测试环境为 node（无 jsdom），这里直接断言 src/main.ts 中落实的 CSS 与 DOM 挂载逻辑，
 * 以及 SCENARIOS 中 Q13-C 选项的可读文案（展开后第一眼可见）。
 */
/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { SCENARIOS } from '../src/lab/scenarios';

const MAIN_SRC = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf-8');

/** 抓取源码中某个 CSS 选择器对应的规则体（第一个匹配，无嵌套 CSS 所以安全） */
function cssRuleBody(source: string, selector: string): string | null {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc + '\\s*\\{([^}]*)\\}', 'm');
  const m = source.match(re);
  return m ? m[1] : null;
}

/** 抓取源码中所有匹配某选择器的规则体（处理同名组合规则 + 独立规则） */
function allCssRuleBodies(source: string, selector: string): string[] {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc + '\\s*\\{([^}]*)\\}', 'gm');
  const out: string[] = [];
  for (const m of source.matchAll(re)) out.push(m[1]);
  return out;
}

describe('Q13-C-R4 开发工具折叠区布局修复', () => {
  it('1) .tool-tools-host 基础为横向 flex 且全宽不挤压（display:flex / width:100% / flex-shrink:0 / box-sizing:border-box）', () => {
    const body = cssRuleBody(MAIN_SRC, '.tool-tools-host');
    expect(body, '应存在 .tool-tools-host 规则').not.toBeNull();
    expect(body!).toContain('display: flex'); // 展开时由内联 '' 回退到 flex
    expect(body!).not.toContain('display: none'); // 基础不再默认隐藏（隐藏改由内联控制）
    expect(body!).toContain('width: 100%');
    expect(body!).toContain('flex-shrink: 0');
    expect(body!).toContain('box-sizing: border-box');
  });

  it('2) Scenario select 有明确可读宽度（min-width 260～320px）', () => {
    const bodies = allCssRuleBodies(MAIN_SRC, '.tool-tools-host select');
    expect(bodies.length).toBeGreaterThan(0);
    const readable = bodies.some((b) =>
      /min-width:\s*(2[6-9]\d|3[01]\d|320)px/.test(b),
    );
    expect(readable, '应存在 min-width 在 260~320px 的 .tool-tools-host select 规则').toBe(true);
  });

  it('3) toolsHost 挂载在 .lab-root（toolbar 与 main 之间），不再是 .lab-main 的 flex item', () => {
    expect(MAIN_SRC).toContain('root.insertBefore(toolsHost, main)');
    expect(MAIN_SRC).not.toContain('main.insertBefore(toolsHost');
  });

  it('4) 收起默认隐藏 + 展开/收起切换逻辑保持（内联 display 控制，不依赖浏览器 zoom）', () => {
    // 初始显式收起：基础 CSS 是 flex，首屏必须靠内联 none 隐藏
    expect(MAIN_SRC).toMatch(/toolsHost\.style\.display\s*=\s*'none'\s*;/);
    // 切换逻辑：展开→''（回退到 CSS flex 显示），收起→'none'
    expect(MAIN_SRC).toContain("toolsHost.style.display = toolsOpen ? '' : 'none'");
  });

  it('5) Scenario 下拉框含 Q13-C 可读选项（展开后第一眼可见：Q13-C · Thruster (Gadget Boost)）', () => {
    const q13c = SCENARIOS.find((s) => s.id === 'Q13-C');
    expect(q13c, 'SCENARIOS 应包含 Q13-C').toBeDefined();
    expect(q13c!.name).toBe('Thruster (Gadget Boost)');
    // 下拉框文案格式为 `${s.id} · ${s.name}`，展开即见
    const label = `${q13c!.id} · ${q13c!.name}`;
    expect(label).toBe('Q13-C · Thruster (Gadget Boost)');
    expect(label).toContain('Thruster');
    expect(label).toContain('Gadget Boost');
  });

  it('6) 未顺带改动推进器 / 战斗逻辑（物理相关关键词出现次数不应因本次布局修复改变）', () => {
    // 本次只动 DOM 挂载 + CSS；若引入火焰/推力相关改动会污染关键词，这里做保护性断言
    expect(MAIN_SRC).not.toMatch(/thrustImpulse|flameLength|windupMs/);
  });
});
