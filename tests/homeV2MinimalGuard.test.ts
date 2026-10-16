/**
 * HOME-V2-MINIMAL-R1｜正式首页极简化的源码级守卫。
 *
 * 冻结三件事（防「极简化」把产品契约一起剪掉，或旧参数清单悄悄回流）：
 *   HV2-01 **结构收敛**：首页不再渲染零件参数清单 —— 数值 spec 行 / 「已装备部件」
 *          `<ul>` / 成长行 / Movement 摘要 / 底部 4 段说明文字全部结构性退役；
 *   HV2-02 **契约保留**：`open-garage` 与 `start-run` 两个动作不变；可执行时是
 *          真实 `<a href>`（地址由 `adventureHrefNow()` 实时产出 ⇒ 与 Garage 换装同源），
 *          不可执行时是**没有 href** 的 disabled 按钮（结构上「点了不会创建 Run」）；
 *   HV2-03 **领奖与新手链路不断**：`claimRunReward` 仍在挂载时执行一次并重读
 *          draft/inv；`renderHeader` 仍带 claimNotice。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const home = readFileSync('src/product/homePage.ts', 'utf8');
const html = readFileSync('home.html', 'utf8');

/** 首页视图函数体（renderHome）——「首页不再画什么」的判据只在它里面成立。 */
function renderHomeBody(): string {
  const start = home.indexOf('function renderHome(');
  const end = home.indexOf('PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return home.slice(start, end);
}

describe('HOME-V2-MINIMAL-R1｜正式首页极简化守卫', () => {
  it('HV2-01 首页不再渲染零件参数清单（spec 数值 / 部件 ul / 成长行 / movement / note）', () => {
    const body = renderHomeBody();
    // 旧「数值行」：耐久 / 能量 文本（`el('span','ph-stat', ...)`）
    expect(body).not.toContain("'ph-stat'");
    // 旧「已装备部件」列表
    expect(body).not.toContain("'ph-sec'");
    expect(body).not.toContain("'ph-slots'");
    // 旧成长行 / Movement 摘要
    expect(body).not.toContain('phHomeGrowth');
    expect(body).not.toContain('phHomeMovement');
    // 旧底部说明文字
    expect(body).not.toContain("'ph-note'");
    // 中央车仍在（产品首页必须看得见车）；车身名保留为轻量身份行
    expect(body).toContain('phHomeCar');
    expect(body).toContain('vehiclePreviewLayout(draft)');
  });

  it('HV2-02 两个动作契约不变：open-garage 与 start-run（a href ⇄ 无 href disabled）', () => {
    const body = renderHomeBody();
    expect(body).toContain("toGarage.dataset['phAction'] = 'open-garage'");
    expect(body).toContain("start.dataset['phAction'] = 'start-run'");
    // 可执行 = 真实相对链接，地址由 adventureHrefNow() 实时产出（与 Garage 换装同源）
    expect(body).toContain('start.href = adventureHrefNow()');
    // 不可执行 = 没有 href 的 disabled 按钮（不是「点了没反应」）
    expect(body).toContain('blocked.disabled = true');
    expect(body).toContain("blocked.dataset['phStartBlocked'] = '1'");
    expect(body).not.toContain('blocked.href');
    // 判据来自 fullRunCompat（真实 BuildDraft），不是页面字符串比较
    expect(body).toContain('fullRunCompat(draft)');
  });

  it('HV2-03 领奖 / 新手链路不断：挂载时领奖一次 + 重读，header 仍带 claimNotice', () => {
    // 领奖仍在挂载时执行（入口壳给的 search 解析后交给 Profile Repository）
    expect(home).toContain('const pendingClaim: PendingClaim | null = parsePendingClaim(');
    expect(home).toContain('claimRunReward(pendingClaim)');
    // 领奖后重读 draft/inv（否则首页显示的是领奖前旧快照）
    expect(home).toContain('draft = loadEquippedDraft();');
    expect(home).toContain('inv = playerInventory(draft);');
    // header 仍画 claimNotice（领奖结果如实回显）
    expect(home).toContain('const notice = claimNotice();');
    // 新手初始化仍在（成长会话必须在任何库存落盘之前开始 —— fresh 判据读磁盘）
    expect(home).toContain('openGrowthSession(draft)');
    expect(home).toContain('const growth: GrowthSession = openGrowthSession(draft);');
  });

  it('HV2-04 首页 CSS 层次背景与主 CTA 尺寸（手机 390×844 无滚动可点）', () => {
    // 层次背景（radial + linear 叠加）挂在 .ph-screen；Garage 家族未被改写
    expect(html).toMatch(/\.ph-screen\s*\{[^}]*radial-gradient/);
    // 主 CTA 更大更亮（主按钮层级可见）
    expect(html).toMatch(/\.ph-home-start\s*\{[^}]*min-height:\s*62px/);
    // 次级改车按钮存在且更弱
    expect(html).toMatch(/\.ph-home-garage\s*\{[^}]*min-height:\s*48px/);
    // 行动区纵向排布（主 CTA 在上，次级在下）
    expect(html).toMatch(/\.ph-home-actions\s*\{[^}]*flex-direction:\s*column/);
  });
});
