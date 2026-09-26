/**
 * PRODUCT-LOOP-P0-GARAGE-MOBILE-INTERACTION-R1｜**Garage 移动端单分类配车页** targeted 测试。
 *
 * 真人手机录屏确认的四条问题与本文件的对应关系：
 *   1 四个维度纵向堆成超长页          → GM-01..GM-06（固定骨架 + 分类 Tab）
 *   2 操作时 Preview 已滚出屏幕       → GM-02 / GM-05（Preview·Tab·返回在固定区，只有卡片区内部滚动）
 *   3 Weapon 两步 / 其余一步，规则不统一 → GM-07..GM-09（删除二次按钮，四维统一点卡即装）
 *   4 未拥有与可用内容混排            → GM-12 / GM-13（原生 `<details>` 降级区）
 *
 * 本队列自己立的不变量：
 *   - **结构保证而非滚动位置巧合**：Preview / Tab / 返回是滚动容器的**兄弟节点** ⇒
 *     几何上不可能被「滚出去」（GM-01 / GM-02 / GM-05）；
 *   - **只有一个滚动容器**：`.ph-garage-body`（GM-05）；
 *   - **不存在「已选择但未装备」中间态**：二次按钮在源码里被删除，探针按 DOM 数它（GM-07）；
 *   - **一个维度一个写入口**：`equipWeapon` / `equipBody` / `equipMovement` 各自过
 *     `validateSnapshot` 并只写自己的字段 ⇒ 「互不覆盖」是结构性的（GM-09）；
 *   - **状态词只有一个**：`使用中` / `未拥有`，其余一律不画（GM-10）；
 *   - **零新增持久化**：页面自己不写盘、不新增 key（GM-14）。
 *
 * ⚠️ 每个用例开头都 `isolateMigrations()`（预置四份一次性迁移的标记）：本文件要验的是
 *    **Garage 结构与交互本身**，不该被 onboarding / reseed / Movement 种子 / Body 种子的
 *    补件行为干扰。这是**隔离变量**，不是放宽断言 —— 那四份迁移各自的契约由
 *    `playerGrowthR2A` / `productReseedR2` / `productMovementChoiceSeed` / `productBodyChoiceSeed` 分别测。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { NEW_OFFICIAL_BODIES, grantBody } from '../src/core/bodyOwnership';
import { registry } from '../src/core/content';
import { OFFICIAL_MOVEMENTS, addPart, saveInventory } from '../src/core/partInventory';
import {
  GARAGE_BACK_LABEL,
  GARAGE_IN_USE_LABEL,
  GARAGE_IN_USE_LEAD,
  GARAGE_LOCKED_LABEL,
  GARAGE_MOVEMENT_OFF_LABEL,
  GARAGE_TAB_LABELS,
  GARAGE_TAB_ORDER,
  GARAGE_TITLE,
  MOVEMENT_HARDPOINT_LABELS,
  PRODUCT_STAGE_H,
  PRODUCT_STAGE_W,
  SAVE_KEY,
  type GarageTab,
} from '../src/product/homePage';
import {
  WEAPON_SLOT,
  bodyReading,
  defaultPlayerDraft,
  equipBody,
  equipMovement,
  equipWeapon,
  loadEquippedDraft,
  loadoutReading,
  movementReading,
  playerInventory,
} from '../src/product/playerLoadout';
import { markR2Onboarding } from '../src/product/r2Onboarding';
import { markR2Reseed } from '../src/product/r2Reseed';
import { markR3MovementSeed } from '../src/product/r3MovementChoiceSeed';
import { markR4BodySeed } from '../src/product/r4BodyChoiceSeed';
import type { BuildDraft } from '../src/lab/buildEditorModel';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT_DIR = join(REPO_ROOT, 'src', 'product');

function readProduct(f: string): string {
  return readFileSync(join(PRODUCT_DIR, f), 'utf8');
}
/** 源码守卫必须先剥注释（本项目铁律：注释里的自指文字会骗过字符串匹配）。 */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
/** HTML 里的 `<!-- -->` 同样要剥（否则注释里的示例样式会骗过匹配）。 */
function stripHtml(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, '');
}

const BUILD_KEY = 'strongfruit.playerBuild.v1';
const INV_KEY = 'strongfruit.ownedParts.v2';

/** 内存版 localStorage（node 无原生；与其它产品侧测试同一模式）。 */
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  get length(): number {
    return this.m.size;
  }
}

let store: MemStorage;

beforeEach(() => {
  store = new MemStorage();
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = store;
});

function allKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const k = store.key(i);
    if (k) out.push(k);
  }
  return out.sort();
}

/** 预置四份一次性迁移的标记 ⇒ 本文件只观察结构与交互（隔离变量，非放宽）。 */
function isolateMigrations(): void {
  markR2Onboarding();
  markR2Reseed();
  markR3MovementSeed();
  markR4BodySeed();
}

/**
 * 把一件部件**真的发到库存里**（走正式 `addPart` + `saveInventory`，与真实入库链路同口径）。
 * ⚠️ 不改测试夹具的存储形状 —— 星级 → `PartStack` 字段名的映射只有 `core/partInventory` 那一处。
 */
function grantPart(defId: string, star = 1, n = 1): void {
  const inv = playerInventory(defaultPlayerDraft());
  addPart(inv, defId, star, n);
  saveInventory(inv);
}

/**
 * ⚠️ 用**函数边界**切片，确保断言只落在目标函数内：`homePage.ts` 里 `ph-actions` / `ph-main`
 *    既出现在首页渲染里也出现在 Garage 里，不切片的话「顺序」断言会被首页那一段污染。
 * ⚠️ 刻意**不在切片函数里调用 `expect`** —— 它会在文件顶层被调用（describe 收集阶段），
 *    顶层断言不是本文件的意图；切不到时返回空串，后续断言自然会红。
 */
const home = strip(readProduct('homePage.ts'));
const html = stripHtml(readFileSync(join(REPO_ROOT, 'home.html'), 'utf8'));

function sliceFn(src: string, startMarker: string, endMarker: string): string {
  const s = src.indexOf(startMarker);
  if (s < 0) return '';
  const e = src.indexOf(endMarker, s);
  return e < 0 ? src.slice(s) : src.slice(s, e);
}
/** `renderGarage` 的**函数体**（到下一个顶层函数 `function render(` 为止）。 */
const garageFn = sliceFn(home, 'function renderGarage', 'function render(');

// ============================================================================
describe('PRODUCT-LOOP-P0-GARAGE-MOBILE-INTERACTION-R1｜A. 固定配车结构（必改 1）', () => {
  it('GM-01 三段式骨架：`.ph-garage-top` / `.ph-garage-body` / `.ph-actions` 三个兄弟节点，且 append 顺序 top → body → actions', () => {
    for (const cls of ['ph-garage-top', 'ph-garage-body', 'ph-actions']) {
      expect(garageFn, `Garage 必须创建 .${cls}`).toContain(`'${cls}'`);
    }
    const topAt = garageFn.indexOf("el('div', 'ph-garage-top')");
    const bodyAt = garageFn.indexOf("el('div', 'ph-garage-body')");
    const actionsAt = garageFn.indexOf("el('div', 'ph-actions')");
    expect(topAt).toBeGreaterThan(-1);
    expect(bodyAt).toBeGreaterThan(topAt);
    expect(actionsAt).toBeGreaterThan(bodyAt);
    // 三者都是 stage 的**直接子节点**（兄弟），这是「固定 / 可滚」结构保证的前提。
    for (const cls of ['top', 'body', 'actions']) {
      expect(garageFn, `stage 必须直接 append ${cls}`).toContain(`stage.append(${cls})`);
    }
  });

  it('GM-02 Preview + 分类 Tab 在固定区 `.ph-garage-top` 内，返回首页在固定区 `.ph-actions` 内（不在滚动容器里）', () => {
    // A：战车实时 Preview 是 top 的第一个孩子。
    expect(garageFn).toContain("const car = el('div', 'ph-car-wrap ph-car-wrap-sm')");
    expect(garageFn).toContain('car.append(renderPreview(vehiclePreviewLayout(draft)))');
    expect(garageFn).toContain('top.append(car)');
    // B：分类 Tab 也挂在 top 上。
    expect(garageFn).toContain("const tabs = el('div', 'ph-tabs')");
    expect(garageFn).toContain('top.append(tabs)');
    // D：返回首页挂在 actions 上，且带 `back-home`（E2E 用它做真实点击）。
    expect(garageFn).toContain(`el('button', 'ph-btn', GARAGE_BACK_LABEL)`);
    expect(garageFn).toContain("back.dataset['phAction'] = 'back-home'");
    expect(garageFn).toContain('actions.append(back)');
    // ⚠️ 反向：Preview / Tab 都**不得**出现在 body 的渲染里（否则就跟着列表滚了）。
    expect(garageFn).not.toMatch(/body\.append\(car/);
    expect(garageFn).not.toMatch(/body\.append\(tabs/);
    expect(GARAGE_BACK_LABEL).toBe('返回首页');
    expect(GARAGE_TITLE).toBe('调整战车');
  });

  it('GM-03 卡片区**只渲染当前分类**：三分支各自渲染一类，且都写进 `body`（不是 stage）', () => {
    expect(garageFn).toContain("if (garageTab === 'weapon') renderWeaponTab(body, r);");
    expect(garageFn).toContain("else if (garageTab === 'body') renderBodySection(body);");
    expect(garageFn).toContain('else renderMovementSection(body, garageTab);');
    // Movement 区只画当前这个挂点（另一侧由 Tab 决定）。
    expect(home).toContain('if (slot.hardpointId !== hardpointId) continue;');
    // 反向：不得把三个区**同时**画进 stage（那正是旧的超长页形态）。
    expect(garageFn).not.toContain('stage.append(renderWeaponTab');
    expect(garageFn).not.toContain('renderBodySection(stage');
    expect(garageFn).not.toContain('renderMovementSection(stage');
  });

  it('GM-04 `ph-main-garage` 是「整页不滚」的唯一开关，挂在 view 上（首页仍是整页滚动）', () => {
    expect(home).toContain("stage.classList.toggle('ph-main-garage', view === 'garage')");
    const renderFn = sliceFn(home, 'function render(): void', 'render();');
    expect(renderFn).toContain("screen.dataset['phView'] = view");
    expect(renderFn).toContain('stage.replaceChildren();');
  });

  it('GM-05 home.html 的滚动契约：骨架 / 舞台 `hidden`，**只有** `.ph-garage-body` 是 `auto`', () => {
    expect(html).toMatch(/\.ph-main-garage\s*\{[^}]*overflow:\s*hidden/);
    expect(html).toMatch(/\.ph-garage-body\s*\{[^}]*overflow-y:\s*auto/);
    expect(html).toMatch(/\.ph-screen\s*\{[^}]*overflow:\s*hidden/);
    // 固定区不吃掉卡片区的空间：top / actions 都是 `flex: 0 0 auto`，body 是 `flex: 1 1 auto`。
    expect(html).toMatch(/\.ph-garage-top\s*\{[^}]*flex:\s*0 0 auto/);
    expect(html).toMatch(/\.ph-garage-body\s*\{[^}]*flex:\s*1 1 auto/);
    expect(html).toMatch(/\.ph-garage-body\s*\{[^}]*min-height:\s*0/);
    // 逻辑舞台尺寸口径没变（本 Queue 不碰缩放契约）。
    expect(PRODUCT_STAGE_W).toBe(390);
    expect(PRODUCT_STAGE_H).toBe(844);
  });

  it('GM-06 分类 Tab 与配置字段**一一对应**（4 个、顺序固定、默认 weapon；Tab 键名与挂点名刻意同名）', () => {
    expect([...GARAGE_TAB_ORDER]).toEqual(['weapon', 'body', 'front', 'rear']);
    // 恰好四个 —— 本 Queue 明令不新增第 5 个分类。
    expect(GARAGE_TAB_ORDER.length).toBe(4);
    // 标签是玩家语言，且与 Tab 集合**键集完全一致**（没有多余 / 缺失）。
    expect(Object.keys(GARAGE_TAB_LABELS).sort()).toEqual([...GARAGE_TAB_ORDER].sort());
    expect(GARAGE_TAB_LABELS).toEqual({ weapon: '武器', body: '车身', front: '前轮', rear: '后轮' });
    /*
      ⚠️ 「分类 → 挂点」不需要第二张映射表：Movement 的 Tab 键名与 `MOVEMENT_HARDPOINT_LABELS`
         的键**同名** ⇒ `renderMovementSection(body, garageTab)` 可以直接传。
         这条断言把那个「刻意同名」钉死：谁把 Tab 改成 `rearWheel` 就会立刻变红。
    */
    for (const tab of ['front', 'rear'] as const) {
      expect(MOVEMENT_HARDPOINT_LABELS[tab], `Tab "${tab}" 必须与 Movement 挂点同名`).toBeTruthy();
    }
    expect(MOVEMENT_HARDPOINT_LABELS['front']).toBe('前轮');
    expect(MOVEMENT_HARDPOINT_LABELS['rear']).toBe('后轮');
    // 默认分类 = 武器；切换是**纯视图**（`garageTab = tab; render();` 之间不写任何存储）。
    expect(home).toContain("let garageTab: GarageTab = 'weapon'");
    const tabHandler = sliceFn(home, 'btn.addEventListener', 'tabs.append(btn)');
    expect(tabHandler).toContain('garageTab = tab;');
    expect(tabHandler).toContain('render();');
    expect(tabHandler).not.toContain('setItem');
    expect(tabHandler).not.toContain('savePlayerBuild');
    // Tab 的状态用 dataset（不是硬编码 attribute 字符串）——E2E 靠 `[data-ph-tab]` 点击。
    expect(home).toContain("btn.dataset['phTab'] = tab");
    expect(home).toContain("btn.dataset['phTabActive'] = String(active)");
    // GarageTab 类型就是这四个字面量（没有别的取值）。
    const tabType: GarageTab[] = ['weapon', 'body', 'front', 'rear'];
    expect(tabType.length).toBe(GARAGE_TAB_ORDER.length);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-P0-GARAGE-MOBILE-INTERACTION-R1｜B. 统一直接装备（必改 2）', () => {
  it('GM-07 二次「装备」按钮**结构性删除**：源码里不存在它的 action，探针改为按 DOM 数它', () => {
    // 旧交互留下的东西必须一个都不剩。
    expect(home).not.toContain("dataset['phAction'] = 'equip'");
    expect(home).not.toContain("'equip'");
    // 也不再有「已选择但未装备」的中间态状态。
    expect(home).not.toContain('selectedWeaponId');
    expect(home).not.toContain('selectedWeaponStar');
    expect(home).not.toContain('equipEnabled');
    /*
      ⚠️ 而且必须是**运行时可数**的硬证据（不是「源码里没写」）：
         探针字段直接对 DOM 做 `querySelectorAll('[data-ph-action="equip"]').length`，
         于是 E2E 在任何时刻都能断言「页面上 0 个二次按钮」。
    */
    expect(home).toContain(
      "garageEquipButtonCount: stage.querySelectorAll('[data-ph-action=\"equip\"]').length",
    );
    expect(home).toContain('readonly garageEquipButtonCount: number;');
  });

  it('GM-08 四维**统一**为「点已拥有卡即装备」：三类卡片的 click 都直接调各自的 equip 写入口', () => {
    // Weapon：点卡直接装备（不再是「选中」）。
    expect(home).toContain('card.addEventListener(\'click\', () => equipWeaponAndRender(w.defId, w.star));');
    // Movement：点已拥有卡直接装备到它所在挂点；点「未装载」即卸下。
    expect(home).toContain(
      'card.addEventListener(\'click\', () => equipMovementAndRender(slot.hardpointId, c.defId));',
    );
    expect(home).toContain(
      'offCard.addEventListener(\'click\', () => equipMovementAndRender(slot.hardpointId, EMPTY_SLOT));',
    );
    // Body：点卡直接装备。
    expect(home).toContain('card.addEventListener(\'click\', () => equipBodyAndRender(c.defId));');
    // 三个 `*AndRender` 都是「写入口 + 刷新」这一种形状（没有第二套流程）。
    for (const fn of ['equipWeaponAndRender', 'equipMovementAndRender', 'equipBodyAndRender']) {
      expect(home).toContain(`function ${fn}`);
    }
    // 首次进入没有预设选中项：状态里只剩「当前分类」。
    expect(home).not.toMatch(/let\s+selected\b/);
    expect(home).toContain("let garageTab: GarageTab = 'weapon'");
  });

  it('GM-09 三个唯一写入口各自过 `validateSnapshot` 且**只改自己的字段**（互不覆盖）', () => {
    isolateMigrations();
    for (const m of OFFICIAL_MOVEMENTS) grantPart(m);
    // hammer 是「非当前装备」的样本（默认车装的是 cannon）⇒ 真实发一件进库存。
    grantPart('hammer');
    const bodyB = NEW_OFFICIAL_BODIES[0];
    grantBody(bodyB);

    let draft: BuildDraft = defaultPlayerDraft();
    const inv = playerInventory(draft);
    const snapshot = (d: BuildDraft) => JSON.stringify(d);

    // ① Weapon
    const before0 = snapshot(draft);
    const w = equipWeapon('hammer', draft, inv);
    expect(w.ok, `weapon 装备应成功：${w.detail ?? ''}`).toBe(true);
    draft = w.draft as BuildDraft;
    expect(draft.functionalSelections[WEAPON_SLOT]).toBe('hammer');
    // 其余字段一字不动（含 Movement / Body 两维）。
    const persistedAfterW = JSON.parse(snapshot(loadEquippedDraft())) as BuildDraft;
    for (const k of ['rearWheelDefId', 'frontWheelDefId'] as const) {
      expect(persistedAfterW[k], `装 Weapon 不得写 ${k}`).toBeUndefined();
    }
    expect(persistedAfterW.bodyDefId).toBe(JSON.parse(before0).bodyDefId);

    // ② Movement rear（front 必须保持「无键」语义）
    const mv = OFFICIAL_MOVEMENTS[0];
    const rear = equipMovement('rear', mv, draft, inv);
    expect(rear.ok, `rear 装备应成功：${rear.detail ?? ''}`).toBe(true);
    draft = rear.draft as BuildDraft;
    expect(draft.rearWheelDefId).toBe(mv);
    expect('frontWheelDefId' in draft).toBe(false);
    // Weapon 槽没被顶掉。
    expect(draft.functionalSelections[WEAPON_SLOT]).toBe('hammer');

    // ③ Movement front
    const front = equipMovement('front', mv, draft, inv);
    expect(front.ok).toBe(true);
    draft = front.draft as BuildDraft;
    expect(draft.rearWheelDefId).toBe(mv);
    expect(draft.frontWheelDefId).toBe(mv);
    expect(draft.functionalSelections[WEAPON_SLOT]).toBe('hammer');

    // ④ Body
    const b = equipBody(bodyB, draft);
    expect(b.ok, `body 装备应成功：${b.detail ?? ''}`).toBe(true);
    const afterAll = b.draft as BuildDraft;
    expect(afterAll.bodyDefId).toBe(bodyB);
    // 前三维一字未动。
    expect(afterAll.functionalSelections[WEAPON_SLOT]).toBe('hammer');
    expect(afterAll.rearWheelDefId).toBe(mv);
    expect(afterAll.frontWheelDefId).toBe(mv);

    // 每一次装备都过正式读入口（= 内部含 validateSnapshot）能读回来。
    const back = loadEquippedDraft();
    expect(back.functionalSelections[WEAPON_SLOT]).toBe('hammer');
    expect(back.rearWheelDefId).toBe(mv);
    expect(back.frontWheelDefId).toBe(mv);
    expect(back.bodyDefId).toBe(bodyB);
    // 存档仍只有两个 key（不新增第二套库存 / 拥有记录）。
    expect(allKeys().filter((k) => k.startsWith('strongfruit.ownedParts')).length).toBe(1);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-P0-GARAGE-MOBILE-INTERACTION-R1｜C. 状态语义唯一（必改 3）', () => {
  it('GM-10 配置页只有两个状态词（使用中 / 未拥有）；「默认 / 已选择 / 已装备 / 选中」一律不出现', () => {
    expect(GARAGE_IN_USE_LABEL).toBe('使用中');
    expect(GARAGE_LOCKED_LABEL).toBe('未拥有');
    expect(GARAGE_IN_USE_LEAD).toBe('当前使用中');
    // 旧的标签常量必须已经不存在（不是「没被引用」而是「不存在」）。
    for (const dead of [
      'GARAGE_EQUIP_LABEL',
      'GARAGE_MOVEMENT_PICK_LABEL',
      'GARAGE_MOVEMENT_PICKED_LABEL',
      'GARAGE_MOVEMENT_EQUIPPED_LABEL',
      'GARAGE_MOVEMENT_DEFAULT_LABEL',
      'GARAGE_MOVEMENT_LOCKED_LABEL',
    ]) {
      expect(home, `${dead} 必须已删除`).not.toContain(dead);
    }
    /*
      ⚠️ 卡面上不得再画与「使用中」竞争的第二个状态词。
         `'默认'` 是**字符串字面量**，只在页面的展示文案里出现时才命中 ——
         读数层的 `implicit` 字段（布尔）不在此列，它的语义由 GM-11 单独钉。
    */
    expect(home).not.toContain("'默认'");
    expect(home).not.toContain('「默认」');
    expect(home).not.toContain("'已选择'");
    expect(home).not.toContain("'已装备'");
    expect(home).not.toContain("'选中'");
    // 三个区都统一用 `GARAGE_IN_USE_LABEL` 标当前装备（同一个常量，不是各写各的）。
    const inUseUses = home.split('GARAGE_IN_USE_LABEL').length - 1;
    expect(inUseUses, '使用中必须由**唯一常量**驱动（Weapon / Movement / Body 三处共用）').toBeGreaterThanOrEqual(3);
    expect(home).toContain('GARAGE_LOCKED_LABEL');
  });

  it('GM-11 「缺省轮 / 缺省车身」语义**保留在读数层**（只是不再画标签）：implicit 字段照旧可读', () => {
    isolateMigrations();
    const draft = defaultPlayerDraft();
    const r = movementReading(draft, playerInventory(draft));
    const dflt = r.cards.find((c) => c.implicit);
    expect(dflt, '缺省轮必须仍可被识别（implicit=true）').toBeTruthy();
    expect(dflt?.defId).toBe(r.defaultDefId);
    // 缺省轮恒拥有、不进库存（这是底层语义，与卡面文案无关）。
    expect(dflt?.owned).toBe(true);
    expect(dflt?.count).toBe(0);
    // 页面把 implicit 如实透到 DOM 上（供 E2E / 未来渲染使用），只是不画成标签。
    expect(home).toContain("card.dataset['phMovementImplicit'] = String(c.implicit)");
    expect(home).toContain("card.dataset['phBodyImplicit'] = String(c.implicit)");
    expect(home).not.toContain('ph-card-implicit');
  });
});

// ============================================================================
describe('PRODUCT-LOOP-P0-GARAGE-MOBILE-INTERACTION-R1｜D. 未拥有内容降级（必改 4）', () => {
  it('GM-12 未拥有内容进原生 `<details>` 降级区（`data-ph-locked`），可用内容留在主卡阵', () => {
    // 唯一构造函数：原生 details + summary + 一个 grid。
    const lockedFn = sliceFn(home, 'function lockedSection', 'function renderWeaponTab');
    expect(lockedFn).toContain("el('details', 'ph-locked')");
    expect(lockedFn).toContain("det.dataset['phLocked'] = String(count)");
    expect(lockedFn).toContain("el('summary', 'ph-locked-summary'");
    // 零 JS 交互：不挂 click / 不挂任何监听。
    expect(lockedFn).not.toContain('addEventListener');
    /*
      ⚠️ **分流**必须发生在卡片循环里：owned → 主 grid；!owned → lockedGrid + 计数。
         Movement 与 Body 两处同款（同一个模式，不是各写一套）。
    */
    const mvSection = sliceFn(home, 'function renderMovementSection', 'function lockedSection');
    expect(mvSection).toContain('if (c.owned) grid.append(cell);');
    expect(mvSection).toContain('lockedGrid.append(cell);');
    expect(mvSection).toContain('if (lockedCount > 0) row.append(lockedSection(lockedGrid, lockedCount));');
    const bodySection = sliceFn(home, 'function renderBodySection', 'function lockedSection');
    expect(bodySection).toContain('if (c.owned) grid.append(cell);');
    expect(bodySection).toContain('if (lockedCount > 0) box.append(lockedSection(lockedGrid, lockedCount));');
    // 样式：折叠区默认靠原生 `<details>`（浏览器默认闭合），不额外加 `open`。
    expect(home).not.toMatch(/det\.open\s*=\s*true/);
    expect(home).not.toMatch(/setAttribute\('open'/);
    expect(html).toMatch(/\.ph-locked-summary/);
    expect(html).toMatch(/\.ph-card-locked/);
  });

  it('GM-13 降级 ≠ 新入口：页面**没有**商城 / 解锁 / 经济 / 教程 / 推荐 / 属性评分', () => {
    for (const banned of [
      '商城',
      '购买',
      '解锁',
      '金币',
      '钻石',
      '货币',
      '价格',
      '教程',
      '推荐',
      '评分',
    ]) {
      expect(home, `页面不得出现 ${banned}`).not.toContain(banned);
    }
    /*
      ⚠️ 英文侧只查**会真的变成新入口的 DOM 标识**（`ph-*` 类名 / 标识符前缀）——
      不能直接查 `store`：本页大量出现 `storedDefId`（Movement 三态读数字段），
      用子串查 `store` 会把它误判成「商城入口」（实测踩过）。
    */
    for (const banned of ['ph-store', 'ph-shop', 'ph-unlock', 'ph-buy', 'ph-price', 'ph-currency']) {
      expect(home, `页面不得出现 ${banned}`).not.toContain(banned);
    }
    // 也没有红绿对比箭头（Queue 明令不做）。
    expect(home).not.toContain('ph-delta');
    expect(home).not.toContain('▲');
    expect(home).not.toContain('▼');
    expect(home).not.toContain('↑');
    expect(home).not.toContain('↓');
  });
});

// ============================================================================
describe('PRODUCT-LOOP-P0-GARAGE-MOBILE-INTERACTION-R1｜E. 边界（禁止清单）', () => {
  it('GM-14 零新增持久化：页面自己不写盘，正式 key 仍是同一个', () => {
    expect(home).not.toContain('localStorage');
    expect(home).not.toContain('setItem');
    expect(home).not.toContain('savePlayerBuild(');
    expect(home).not.toContain('saveInventory');
    expect(SAVE_KEY).toBe(BUILD_KEY);
    // 页面里出现过的 storage key 只有正式那一个（没有第二张表 / 没有新迁移 key）。
    const keyLiteral = home.match(/'strongfruit\.[a-zA-Z0-9._]+'/g) ?? [];
    expect([...new Set(keyLiteral)]).toEqual([`'${BUILD_KEY}'`]);
    // 库存 key 也一字未改（本 Queue 不新建第二套库存 / 拥有记录）。
    expect(INV_KEY).toBe('strongfruit.ownedParts.v2');
  });

  it('GM-15 不碰数值 / 不新增部件：页面里没有部件数值字面量，也没有第 5 个分类', () => {
    // 页面不得给任何部件属性赋值（数值唯一真源在内容层 / 读数层）。
    for (const field of ['radius', 'mass', 'baseMass', 'energyCapacity', 'hp', 'damage']) {
      expect(home, `页面不得给 ${field} 赋字面量`).not.toMatch(new RegExp(`${field}\\s*:\\s*\\d`));
    }
    // 也不自己造一张武器 / 轮组 / 车身清单。
    expect(home).not.toContain('OFFICIAL_MOVEMENTS');
    expect(home).not.toContain('OFFICIAL_BODIES');
    expect(home).not.toContain('NEW_OFFICIAL_BODIES');
    // 分类恰好四个（不新增维度）。
    expect(GARAGE_TAB_ORDER.length).toBe(4);
    // 卡片读数一律取自读数层（页面不自己拼那三个数）。
    expect(home).not.toContain('轮径');
    expect(home).toContain("el('span', 'ph-card-stats', c.statsText)");
    expect(home).toContain("card.dataset['phBodyStats'] = c.statsText");
    /*
      内容量的真源仍在 core：本队列没有新增任何部件定义 ——
      `registry.movements` 恰好是「三档需库存轮组 + 缺省轮」。
    */
    expect(registry.movements.size).toBe(OFFICIAL_MOVEMENTS.length + 1);
  });

  it('GM-16 写入口仍然唯一：`playerLoadout` 里只有一处 `savePlayerBuild(`，且三个 equip 都走它', () => {
    const loadout = strip(readProduct('playerLoadout.ts'));
    expect(loadout.split('savePlayerBuild(').length - 1).toBe(1);
    expect(loadout).toContain('function persistPlayerBuild');
    // 三个写入口都在同一个文件里、都调 `persistPlayerBuild(`。
    expect(loadout.split('persistPlayerBuild(').length - 1).toBeGreaterThanOrEqual(4);
  });

  it('GM-17 探针口径同步：Garage 相关字段只剩 `garageTab` 与 `garageEquipButtonCount`', () => {
    expect(home).toContain('readonly garageTab: GarageTab;');
    expect(home).toContain('readonly garageEquipButtonCount: number;');
    // 旧字段在探针接口里也必须消失（不能只删实现留接口）。
    const probeIface = sliceFn(home, 'export interface ProductProbe', 'export interface ProductDebugHandle');
    expect(probeIface).not.toContain('selectedWeaponId');
    expect(probeIface).not.toContain('equipEnabled');
    expect(probeIface).toContain('readonly garageTab');
    expect(probeIface).toContain('readonly garageEquipButtonCount');
  });

  it('GM-18 首页与 Garage 仍是同一页面的两个视图（零跳转、零第二套页面逻辑）', () => {
    expect(home).toContain("export type ProductView = 'home' | 'garage'");
    expect(home).toContain("if (view === 'home') renderHome(r);");
    expect(home).toContain('else renderGarage(r);');
    expect(home).not.toContain('location.href');
    expect(home).not.toContain('window.open');
    // 返回首页只是切视图 + 重渲染（不写盘 / 不导航）。
    const backHandler = sliceFn(garageFn, 'back.addEventListener', 'actions.append(back)');
    expect(backHandler).toContain("view = 'home';");
    expect(backHandler).toContain('render();');
    expect(backHandler).not.toContain('setItem');
  });
});

// ============================================================================
describe('PRODUCT-LOOP-P0-GARAGE-MOBILE-INTERACTION-R1｜F. 读数层回归（本 Queue 不改读数）', () => {
  it('GM-19 结构重构**没有**改变任何读数：loadout / movement / body 三份 reading 与装备动作保持一致', () => {
    isolateMigrations();
    for (const m of OFFICIAL_MOVEMENTS) grantPart(m);
    grantPart('hammer');
    const bodyB = NEW_OFFICIAL_BODIES[0];
    grantBody(bodyB);

    const draft = defaultPlayerDraft();
    const inv = playerInventory(draft);
    const lo = loadoutReading(draft, inv);
    expect(lo.equippedWeaponId).toBe('cannon');
    expect(lo.equippedWeaponName).toBe('炮');
    expect(lo.bodyName).toBe('西瓜车身');

    const mv = movementReading(draft, inv);
    expect(mv.slots.length).toBe(2);
    expect(mv.defaultDefId).toBeTruthy();
    expect(mv.legal).toBe(true);

    const bd = bodyReading(draft);
    expect(bd.cards.length).toBeGreaterThanOrEqual(1);
    expect(bd.cards.some((c) => c.defId === draft.bodyDefId && c.equipped)).toBe(true);

    // 装备后读数立刻跟上（页面靠它渲染 ⇒ 「点卡 → Preview 同次变化」的数据层保证）。
    const w = equipWeapon('hammer', draft, inv);
    expect(loadoutReading(w.draft as BuildDraft, inv).equippedWeaponName).toBe('锤');
    // 未装载标签常量仍是那一个（本 Queue 没改三态语义）。
    expect(GARAGE_MOVEMENT_OFF_LABEL).toBe('未装载');
  });
});
