/**
 * GARAGE-V2-INVENTORY-LAYOUT-LAB-R1｜Lab 页面源码级守卫（防"顺手接正式"）。
 *
 * Lab 是可整块删除的实验产物，本守卫冻结三条边界：
 *   GV2L-01 入口隔离：garageV2LabMain 必须在 import 业务模块**之前** bindPlatformCore
 *           （内存 Map 后端）——绑定语句在文件体最前、业务 import 在其后；
 *   GV2L-02 构建隔离：garage-v2-lab 只进 vite.portrait-lab.config，绝不进
 *           vite.pages.config / vite.config（正式产物闭集不被污染）；
 *   GV2L-03 视觉契约：背包格只有 图形+品质边框+部位角标 —— 源码里不渲染
 *           名字/数量/星级（`itemDisplayName` 只用于 title 提示与弹窗）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const labMain = readFileSync('src/product/garageV2LabMain.ts', 'utf8');
const lab = readFileSync('src/product/garageV2Lab.ts', 'utf8');
const labHtml = readFileSync('garage-v2-lab.html', 'utf8');
const pagesCfg = readFileSync('vite.pages.config.ts', 'utf8');
const labCfg = readFileSync('vite.portrait-lab.config.ts', 'utf8');
const mainCfg = readFileSync('vite.config.ts', 'utf8');

describe('GARAGE-V2-INVENTORY-LAYOUT-LAB-R1｜Lab 隔离与视觉契约守卫', () => {
  it('GV2L-01 入口先绑定隔离 PlatformCore（内存 Map），业务 import 在绑定语句之后', () => {
    // ① 绑定调用存在且用内存 Map 后端
    expect(labMain).toContain('bindPlatformCore(isolatedCore)');
    expect(labMain).toContain('new Map<string, string>()');
    // ② isolatedCore 定义（含 storage 三方法）出现在 bind 之前
    const bindAt = labMain.indexOf('bindPlatformCore(isolatedCore)');
    const coreAt = labMain.indexOf('const isolatedCore');
    expect(coreAt).toBeGreaterThan(-1);
    expect(coreAt).toBeLessThan(bindAt);
    // ③ 业务模块 import（./garageV2Lab）排在绑定语句之后（ESM 求值顺序靠 import 位置语义
    //    + 惰性存储读取双保险；这里冻结"声明顺序"这条硬约束防回归）
    const bizAt = labMain.indexOf("from './garageV2Lab'");
    expect(bizAt).toBeGreaterThan(bindAt);
    // ④ 入口不 import platform/bootstrap（那会把 Web Core 绑回真 localStorage）
    expect(labMain).not.toContain('platform/bootstrap');
  });

  it('GV2L-02 构建隔离：lab 入口只在 portrait-lab 配置；pages/主配置零引用', () => {
    expect(labCfg).toContain("'garage-v2-lab': 'garage-v2-lab.html'");
    expect(pagesCfg).not.toContain('garage-v2-lab');
    expect(mainCfg).not.toContain('garage-v2-lab');
  });

  it('GV2L-03 视觉契约：格子只渲染 图形+品质+部位角标；名字只进 title/弹窗', () => {
    // buildCell 里 append 的只有 partIconNode + 角标；quality 走 data-q（CSS 边框）。
    const cellFn = lab.slice(lab.indexOf('function buildCell'), lab.indexOf('function buildFoot'));
    expect(cellFn).toContain("partIconNode(iconKindOf(inst.slot), inst.defId)");
    expect(cellFn).toContain("SLOT_BADGE[inst.slot]");
    expect(cellFn).toContain("cell.dataset['q'] = inst.quality");
    // 格子主体不出现名字/数量/星级文本节点（itemDisplayName 仅用于 title 提示）
    expect(cellFn).not.toContain('itemDisplayName');
    expect(cellFn).not.toContain('×');
    expect(cellFn).not.toContain('★');
    // 品质七档 CSS 边框齐备（white..chrome）
    for (const q of ['white', 'green', 'blue', 'purple', 'orange', 'red', 'chrome']) {
      expect(labHtml).toContain(`data-q='${q}'`);
    }
    // 五槽 = body/weapon/gadget/front/rear（前后轮是 movement 的两个独立槽）
    for (const k of ['body', 'weapon', 'gadget', 'front', 'rear']) {
      expect(lab).toContain(`key: '${k}'`);
    }
    // 合成候选排除 body / 不可消耗 / 彩封顶
    const groupsFn = lab.slice(lab.indexOf('function fuseCandidateGroups'), lab.indexOf('function iconKindOf'));
    expect(groupsFn).toContain("inst.slot === 'body') continue");
    expect(groupsFn).toContain('!inst.consumable) continue');
    expect(groupsFn).toContain('isMaxQuality(inst.quality)) continue');
  });
});
