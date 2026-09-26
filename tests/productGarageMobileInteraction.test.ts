/**
 * PRODUCT-LOOP-P0-GARAGE-SLOT-INTERACTION-R2｜**Garage 槽位式配装页** targeted 测试。
 *
 * 本文件在 R1（`GARAGE-MOBILE-INTERACTION`，分类 Tab 版）之上**升级为槽位版**：
 * R1 解决的是「四个维度纵向堆成超长页 / 操作时 Preview 滚出屏幕 / 两步装备不统一 /
 * 未拥有与可用混排」；R2 的真人手机录屏又暴露三个 P0 ——
 *   ① 玩家不知道装备该「拖动」还是「点击」；
 *   ② 战车 Preview 朝向与正式战斗**相反** ⇒ 前轮 / 后轮认知反转；
 *   ③ 玩家不知道从哪里进入**合成**。
 *
 * 对应关系：
 *   ① 操作模型不自然          → GS-01..GS-09（槽位骨架 + 唯一「点槽位→点部件→立即装备」+ 零拖拽）
 *   ② Preview 反向            → GS-10..GS-12（y 向下口径不翻转 · 槽位锚点 = 正式挂点 · 只翻车辆层）
 *   ③ 找不到合成              → GS-13..GS-15（底部持续可见入口 + 运行时可见性读数）
 *
 * 本队列自己立的不变量（比 R1 更强，因为**结构**变了）：
 *   - **结构保证而非滚动位置巧合**：Preview + 4 个槽 / 「我的装备」标题 / 合成入口都是
 *     滚动容器的**兄弟节点** ⇒ 几何上不可能被「滚出去」（GS-01 / GS-02 / GS-05 / GS-13）；
 *   - **只有一个滚动容器**：`.ph-garage-body`（GS-05）；
 *   - **不存在「已选择但未装备」中间态**：二次按钮在源码里被删除，探针按 DOM 数它（GS-07）；
 *   - **一个槽位一个写入口**：`equipWeapon` / `equipBody` / `equipMovement` 各自过
 *     `validateSnapshot` 并只写自己的字段 ⇒ 「互不覆盖」是结构性的（GS-09）；
 *   - **槽位坐标与预览件坐标同一个换算函数**（`previewOffset`）⇒ 不可能漂移（GS-11）；
 *   - **槽位锚点 = 正式 `BodyDef` 挂点**（不是排版凑的）⇒「这个东西装在这里」是数据保证（GS-11）；
 *   - **合成入口只带路、不合成**：`fuseStack()` 全页仍只有 1 个调用点（GS-14）；
 *   - **状态词只有一个**：`使用中` / `未拥有`，其余一律不画（GS-16）；
 *   - **零新增持久化**：页面自己不写盘、不新增 key（GS-19）。
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
  GARAGE_FUSE_ENTRY_LABEL,
  GARAGE_FUSE_ENTRY_NONE_LABEL,
  GARAGE_FUSE_ENTRY_READY_LABEL,
  GARAGE_IN_USE_LABEL,
  GARAGE_IN_USE_LEAD,
  GARAGE_LOCKED_LABEL,
  GARAGE_MOVEMENT_OFF_LABEL,
  GARAGE_MY_PARTS_LABEL,
  GARAGE_SLOT_LABELS,
  GARAGE_SLOT_MAX_DX,
  GARAGE_SLOT_ORDER,
  GARAGE_TITLE,
  MOVEMENT_HARDPOINT_LABELS,
  PRODUCT_STAGE_H,
  PRODUCT_STAGE_W,
  SAVE_KEY,
  type GarageSlot,
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
import { vehiclePreviewLayout, vehicleSlotAnchors } from '../src/product/vehiclePreview';
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
/** `renderGarage` 的**函数体**（连同紧随其后的 `garageSlotDefId` / `garageSlotValue` / `garageFuseEntry`）。 */
const garageFn = sliceFn(home, 'function renderGarage', 'function render(');
/** 合成入口构造函数体。 */
const fuseEntryFn = sliceFn(home, 'function garageFuseEntry', 'function render(');
/** 探针接口声明段。 */
const probeIface = sliceFn(home, 'export interface ProductProbe', 'export interface ProductDebugHandle');

// ============================================================================
describe('PRODUCT-LOOP-P0-GARAGE-SLOT-INTERACTION-R2｜A. 槽位式骨架（必改 1）', () => {
  it('GS-01 四段骨架：`.ph-garage-stage` / `.ph-my-parts` / `.ph-garage-body` / `.ph-garage-foot`，append 顺序 stage → myParts → body → 合成入口', () => {
    for (const cls of ['ph-garage-stage', 'ph-my-parts', 'ph-garage-body', 'ph-garage-foot']) {
      expect(garageFn, `Garage 必须创建 .${cls}`).toContain(`'${cls}'`);
    }
    /*
      ⚠️ 顺序断言用**真实的 `stage.append(...)` 调用位置**，不是「类名字面量出现的先后」——
         后者会被源码排版（常量区 / 辅助函数定义位置）污染。
    */
    const order = ['stage.append(stageBox)', 'stage.append(myParts)', 'stage.append(body)', 'stage.append(garageFuseEntry(r))'];
    let prev = -1;
    for (const call of order) {
      const at = garageFn.indexOf(call);
      expect(at, `Garage 必须 ${call}`).toBeGreaterThan(-1);
      expect(at, `${call} 的 append 顺序必须在上一段之后`).toBeGreaterThan(prev);
      prev = at;
    }
    // 四个兄弟节点 + 唯一滚动容器 ⇒「固定区不会被滚出屏幕」是结构保证。
    expect(garageFn).toContain("stageBox.dataset['phGarageStage'] = '1'");
    expect(garageFn).toContain("foot.dataset['phGarageFoot'] = '1'");
    expect(garageFn).toContain("body.dataset['phGarageBody'] = garageSlot");
    expect(garageFn).toContain("myParts.dataset['phMyParts'] = garageSlot");
  });

  it('GS-02 Preview 与 4 个装备槽在固定区 `.ph-garage-stage` 内、返回首页在 `.ph-header` 内（都不在滚动容器里）', () => {
    // A：战车实时 Preview 是 stage 区第一个孩子。
    expect(garageFn).toContain("const car = el('div', 'ph-car-wrap ph-car-wrap-sm')");
    expect(garageFn).toContain('const previewBox = renderPreview(layout);');
    expect(garageFn).toContain('car.append(previewBox);');
    expect(garageFn).toContain('stageBox.append(car);');
    /*
      ⚠️ 槽位节点挂在 **`.ph-car`（车体）内部** 而不是 stage 上：槽位的 `left` 与
         `top: calc(100% + …)` 都以**车体本身**为基准；挂到 stage 会让 `100%` 变成整段高度，
         槽位会直接落到「我的装备」上（实测踩过）。
    */
    expect(garageFn).toContain('previewBox.append(btn);');
    expect(garageFn).not.toContain('stageBox.append(btn)');
    expect(garageFn).not.toContain('stage.append(btn)');
    // B：返回首页挂在 header 上（Queue 结构：顶部 = 标题 / 返回），且带 `back-home`（E2E 用它做真实点击）。
    expect(garageFn).toContain("const back = el('button', 'ph-back', GARAGE_BACK_LABEL)");
    expect(garageFn).toContain("back.dataset['phAction'] = 'back-home'");
    expect(garageFn).toContain('header.append(back);');
    // ⚠️ 反向：Preview / 返回都**不得**出现在 body（滚动容器）的渲染里。
    expect(garageFn).not.toMatch(/body\.append\(car/);
    expect(garageFn).not.toMatch(/body\.append\(previewBox/);
    expect(garageFn).not.toMatch(/body\.append\(back/);
    expect(GARAGE_BACK_LABEL).toBe('返回首页');
    expect(GARAGE_TITLE).toBe('调整战车');
  });

  it('GS-03 卡片区**只渲染当前槽**：三分支各自渲染一类，且都写进 `body`（不是 stage）', () => {
    expect(garageFn).toContain("if (garageSlot === 'weapon') renderWeaponTab(body, r);");
    expect(garageFn).toContain("else if (garageSlot === 'body') renderBodySection(body);");
    expect(garageFn).toContain('else renderMovementSection(body, garageSlot);');
    // Movement 区只画当前这个挂点（另一侧由槽位决定）。
    expect(home).toContain('if (slot.hardpointId !== hardpointId) continue;');
    // 「我的装备 · <槽位名>」标题由**同一个**槽位状态驱动 ⇒ 标题与卡阵不可能分叉。
    expect(GARAGE_MY_PARTS_LABEL).toBe('我的装备');
    expect(garageFn).toContain("el('span', 'ph-my-parts-label', GARAGE_MY_PARTS_LABEL)");
    expect(garageFn).toContain("el('span', 'ph-my-parts-slot', GARAGE_SLOT_LABELS[garageSlot])");
    // 反向：不得把三个区**同时**画进 stage（那正是旧的超长页形态）。
    expect(garageFn).not.toContain('stage.append(renderWeaponTab');
    expect(garageFn).not.toContain('renderBodySection(stage');
    expect(garageFn).not.toContain('renderMovementSection(stage');
  });

  it('GS-04 `ph-main-garage` 是「整页不滚」的唯一开关，挂在 view 上（首页仍是整页滚动）', () => {
    expect(home).toContain("stage.classList.toggle('ph-main-garage', view === 'garage')");
    const renderFn = sliceFn(home, 'function render(): void', 'render();');
    expect(renderFn).toContain("screen.dataset['phView'] = view");
    expect(renderFn).toContain('stage.replaceChildren();');
  });

  it('GS-05 home.html 的滚动契约：骨架 / 舞台 `hidden`，**只有** `.ph-garage-body` 是 `auto`', () => {
    expect(html).toMatch(/\.ph-main-garage\s*\{[^}]*overflow:\s*hidden/);
    expect(html).toMatch(/\.ph-garage-body\s*\{[^}]*overflow-y:\s*auto/);
    expect(html).toMatch(/\.ph-screen\s*\{[^}]*overflow:\s*hidden/);
    // 固定区不吃掉卡片区的空间：stage / myParts / foot 都是 `flex: 0 0 auto`，body 是 `flex: 1 1 auto`。
    expect(html).toMatch(/\.ph-garage-stage\s*\{[^}]*flex:\s*0 0 auto/);
    expect(html).toMatch(/\.ph-my-parts\s*\{[^}]*flex:\s*0 0 auto/);
    expect(html).toMatch(/\.ph-garage-foot\s*\{[^}]*flex:\s*0 0 auto/);
    expect(html).toMatch(/\.ph-garage-body\s*\{[^}]*flex:\s*1 1 auto/);
    expect(html).toMatch(/\.ph-garage-body\s*\{[^}]*min-height:\s*0/);
    // 槽位样式：绝对定位 + 限宽（夹取的排版前提）+ 上下两个 modifier。
    expect(html).toMatch(/\.ph-slotnode\s*\{[^}]*position:\s*absolute/);
    expect(html).toMatch(/\.ph-slotnode\s*\{[^}]*max-width:\s*96px/);
    expect(html).toMatch(/\.ph-slotnode-above\s*\{[^}]*transform:\s*translate\(-50%,\s*-100%\)/);
    expect(html).toMatch(/\.ph-slotnode-below\s*\{[^}]*top:\s*calc\(100%\s*\+\s*6px\)/);
    // ⚠️ 本 Queue 明令**不许**用缩字号 / 压 gap 维持旧结构 ⇒ 预览框的留白是**加**出来的。
    expect(html).toMatch(/\.ph-garage-stage \.ph-car-wrap\s*\{[^}]*padding:\s*50px 0 54px/);
    // 逻辑舞台尺寸口径没变（本 Queue 不碰缩放契约）。
    expect(PRODUCT_STAGE_W).toBe(390);
    expect(PRODUCT_STAGE_H).toBe(844);
  });

  it('GS-06 槽位与配置字段**一一对应**（4 个、顺序固定、默认 weapon；槽位名与挂点名刻意同名）', () => {
    expect([...GARAGE_SLOT_ORDER]).toEqual(['weapon', 'body', 'front', 'rear']);
    // 恰好四个 —— 本 Queue 明令不新增第 5 个槽（Gadget 等未来空槽也不许预埋）。
    expect(GARAGE_SLOT_ORDER.length).toBe(4);
    // 标签是玩家语言，且与槽位集合**键集完全一致**（没有多余 / 缺失）。
    expect(Object.keys(GARAGE_SLOT_LABELS).sort()).toEqual([...GARAGE_SLOT_ORDER].sort());
    expect(GARAGE_SLOT_LABELS).toEqual({ weapon: '武器', body: '车身', front: '前轮', rear: '后轮' });
    /*
      ⚠️ 「槽位 → 挂点」不需要第二张映射表：Movement 的槽位名与 `MOVEMENT_HARDPOINT_LABELS`
         的键**同名** ⇒ `renderMovementSection(body, garageSlot)` 可以直接传。
         这条断言把那个「刻意同名」钉死：谁把槽位改成 `rearWheel` 就会立刻变红。
    */
    for (const slot of ['front', 'rear'] as const) {
      expect(MOVEMENT_HARDPOINT_LABELS[slot], `槽位 "${slot}" 必须与 Movement 挂点同名`).toBeTruthy();
    }
    expect(MOVEMENT_HARDPOINT_LABELS['front']).toBe('前轮');
    expect(MOVEMENT_HARDPOINT_LABELS['rear']).toBe('后轮');
    // 默认槽位 = 武器；切换是**纯视图**（切槽位不可能改配置）。
    expect(home).toContain("let garageSlot: GarageSlot = 'weapon'");
    const slotHandler = sliceFn(garageFn, 'btn.addEventListener', 'previewBox.append(btn)');
    expect(slotHandler).toContain('if (garageSlot === slot) return;');
    expect(slotHandler).toContain('garageSlot = slot;');
    expect(slotHandler).toContain('render();');
    expect(slotHandler).not.toContain('setItem');
    expect(slotHandler).not.toContain('savePlayerBuild');
    // 槽位状态用 dataset（不是硬编码 attribute 字符串）——E2E 靠 `[data-ph-slot]` 点击。
    expect(home).toContain("btn.dataset['phSlot'] = slot");
    expect(home).toContain("btn.dataset['phSlotActive'] = String(slot === garageSlot)");
    expect(home).toContain("btn.dataset['phSlotDef'] = garageSlotDefId(slot, r, mv)");
    // 槽位上如实显示「当前槽装的是哪一件」（读数层给的，页面不自己拼）。
    expect(garageFn).toContain("el('span', 'ph-slotnode-label', GARAGE_SLOT_LABELS[slot])");
    expect(garageFn).toContain("el('span', 'ph-slotnode-value', garageSlotValue(slot, r, mv))");
    // GarageSlot 类型就是这四个字面量（没有别的取值）。
    const slotType: GarageSlot[] = ['weapon', 'body', 'front', 'rear'];
    expect(slotType.length).toBe(GARAGE_SLOT_ORDER.length);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-P0-GARAGE-SLOT-INTERACTION-R2｜B. 唯一点击即装备 + 零拖拽（必改 2）', () => {
  it('GS-07 二次「装备」按钮**结构性删除**：源码里不存在它的 action，探针按 DOM 数它', () => {
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
    expect(probeIface).toContain('readonly garageEquipButtonCount: number;');
  });

  it('GS-07b 零拖拽（必改 2 明令）：源码无任何 drag 事件绑定，且运行时 `[draggable="true"]` 恒 0', () => {
    /*
      ⚠️ 用正则一次盖住全部 HTML5 拖放事件与属性赋值 —— 少列一个就等于给拖拽留后门。
         `draggable` 这个**词**本身允许出现（探针的选择器里就有），禁的是「绑定拖拽行为」。
    */
    expect(home).not.toMatch(/drag(start|end|over|enter|leave)\b/);
    expect(home).not.toMatch(/["']drop["']/);
    expect(home).not.toMatch(/\.drop\s*=/);
    expect(home).not.toMatch(/setAttribute\(\s*['"]draggable/);
    expect(home).not.toMatch(/\.draggable\s*=/);
    // 运行时硬证据（探针现场数 DOM，不是源码推断）。
    expect(home).toContain(
      "garageDraggableCount: stage.querySelectorAll('[draggable=\"true\"]').length",
    );
    expect(probeIface).toContain('readonly garageDraggableCount: number;');
    // 4 个槽也是**运行时**数的（「4 个真实槽 / 没有第 5 个空槽」的机器证据）。
    expect(home).toContain("garageSlotCount: stage.querySelectorAll('[data-ph-slot]').length");
    expect(probeIface).toContain('readonly garageSlotCount: number;');
  });

  it('GS-08 四维**统一**为「点已拥有卡即装备」：三类卡片的 click 都直接调各自的 equip 写入口', () => {
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
    // 首次进入没有预设选中项：状态里只剩「当前槽位」。
    expect(home).not.toMatch(/let\s+selected\b/);
    expect(home).toContain("let garageSlot: GarageSlot = 'weapon'");
  });

  it('GS-09 三个唯一写入口各自过 `validateSnapshot` 且**只改自己的字段**（互不覆盖）', () => {
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
describe('PRODUCT-LOOP-P0-GARAGE-SLOT-INTERACTION-R2｜C. Preview 朝向与槽位锚点（必改 3）', () => {
  it('GS-10 预览坐标口径 = y 向下、视图层**不翻转**：`previewOffset` 的 dy 不取反', () => {
    /*
      ⚠️ R1 期的写法是 `-(it.cy - by) * scale` ⇒ 整车上下镜像（轮子跑到车身上方、
         武器挂到车底）。修复 = 与正式链路同口径（y 向下），视图层不做任何翻转。
    */
    expect(home).toContain('dy: (cy - by) * layout.scale');
    expect(home).not.toContain('-(it.cy');
    expect(home).not.toContain('-(cy - by)');
    expect(home).not.toContain('-(it.cy - by)');
    // 预览件与**槽位**共用这一个换算函数 ⇒ 两者坐标不可能各自漂移。
    expect(home).toContain(
      'function previewOffset(layout: VehiclePreviewLayout, cx: number, cy: number): { dx: number; dy: number }',
    );
    expect(home).toContain('const { dx, dy } = previewOffset(layout, it.cx, it.cy);');
    expect(home).toContain('previewOffset(layout, anchor.cx, anchor.cy)');
    // 视图层只用 dy 减去自身半高（居中），没有第二次取反。
    expect(home).toContain('node.style.top = `calc(50% + ${dy - h / 2}px)`;');
    // 反向：不得对 UI 层做镜像（Queue 明令：只能修 vehicle preview 自身，不得镜像整个 Garage DOM）。
    for (const mirror of ['scaleX(-1)', 'scaleY(-1)', 'rotate(180deg)', 'rotateX(', 'rotateY(']) {
      expect(home, `页面不得出现 ${mirror}`).not.toContain(mirror);
      expect(html, `样式不得出现 ${mirror}`).not.toContain(mirror);
    }
  });

  it('GS-11 槽位锚点 = 正式 `BodyDef` 挂点，且前/后/武器与预览件同向（纯粹用正式数据复算）', () => {
    isolateMigrations();
    const draft = defaultPlayerDraft();
    const anchors = vehicleSlotAnchors(draft);
    const layout = vehiclePreviewLayout(draft);

    // 车身槽 = 车体原点；武器槽 = `frontMass` 挂点；两个轮子槽 = `movementHardpoints` 挂点。
    expect(anchors.body.from).toBe('body-origin');
    expect(anchors.weapon.from).toBe('hardpoint');
    expect(anchors.front.from).toBe('hardpoint');
    expect(anchors.rear.from).toBe('hardpoint');
    expect(anchors.body.cx).toBe(0);
    expect(anchors.body.cy).toBe(0);

    // ① **前轮在右、后轮在左**：挂点与画出来的轮子同向（不是各算各的）。
    expect(anchors.front.cx).toBeGreaterThan(anchors.rear.cx);
    const wheelFront = layout.items.find((i) => i.key === 'wheel:front');
    const wheelRear = layout.items.find((i) => i.key === 'wheel:rear');
    expect(wheelFront, '预览必须有前轮').toBeTruthy();
    expect(wheelRear, '预览必须有后轮').toBeTruthy();
    expect(wheelFront?.cx).toBeGreaterThan(wheelRear?.cx as number);
    // 槽位锚点与该轮**画出来的位置**逐值相等（同一个真源）。
    expect(anchors.front.cx).toBe(wheelFront?.cx);
    expect(anchors.rear.cx).toBe(wheelRear?.cx);
    expect(anchors.front.cy).toBe(wheelFront?.cy);
    expect(anchors.rear.cy).toBe(wheelRear?.cy);

    // ② **武器在车体上方、轮子在车体下方**：y 向下口径下分别是负 / 正。
    expect(anchors.weapon.cy).toBeLessThan(0);
    expect(anchors.front.cy).toBeGreaterThan(0);
    expect(anchors.rear.cy).toBeGreaterThan(0);

    // ③ 槽位横向 = 挂点 x 经 `previewOffset` 换算后**夹取**到 ±GARAGE_SLOT_MAX_DX。
    expect(GARAGE_SLOT_MAX_DX).toBe(130);
    expect(home).toContain(
      'const dx = Math.max(-GARAGE_SLOT_MAX_DX, Math.min(GARAGE_SLOT_MAX_DX, off.dx));',
    );
    expect(home).toContain('btn.style.left = `calc(50% + ${dx}px)`;');
    expect(home).toContain("btn.dataset['phSlotDx'] = String(Math.round(dx));");
    // 武器挂上方、其余挂下方（纵向跳出车体轮廓，否则标签会盖住它指向的部件）。
    expect(home).toContain("const above = slot === 'weapon';");
    expect(home).toContain("btn.classList.add(above ? 'ph-slotnode-above' : 'ph-slotnode-below');");
  });

  it('GS-12 只修车辆预览层：UI 文字 / 槽位 / 卡片一概不镜像，槽位标签就是普通文本节点', () => {
    // 槽位标签是**文本**（不会被任何对称变换翻过来）——「前轮 / 后轮」永远读得对。
    expect(garageFn).toContain("el('span', 'ph-slotnode-label', GARAGE_SLOT_LABELS[slot])");
    // 页面不含任何镜像 API / 属性。
    for (const banned of ['scale(-1', 'transform-origin: right', 'ph-mirror', 'direction: rtl']) {
      expect(home, `页面不得出现 ${banned}`).not.toContain(banned);
      expect(html, `样式不得出现 ${banned}`).not.toContain(banned);
    }
    // 修正发生在 vehiclePreview 层（几何真源），不是给 Garage 套层反向变换。
    const preview = strip(readProduct('vehiclePreview.ts'));
    expect(preview).toContain("from: 'hardpoint'");
    expect(preview).toContain("from: 'body-origin'");
    expect(preview).toContain('export function vehicleSlotAnchors(');
  });
});

// ============================================================================
describe('PRODUCT-LOOP-P0-GARAGE-SLOT-INTERACTION-R2｜D. 持续可见的合成入口（必改 4）', () => {
  it('GS-13 入口**无条件**画出来（不靠有货才出现）：`.ph-garage-foot` 常驻，`.ph-fuse-entry` 常驻', () => {
    expect(GARAGE_FUSE_ENTRY_LABEL).toBe('合成');
    expect(GARAGE_FUSE_ENTRY_READY_LABEL).toBe('可合成');
    expect(GARAGE_FUSE_ENTRY_NONE_LABEL).toBe('暂无可合成');
    expect(fuseEntryFn).toContain("const foot = el('div', 'ph-garage-foot');");
    expect(fuseEntryFn).toContain("const entry = el('button', 'ph-fuse-entry');");
    // ⚠️ 唯一调用点 = 无条件 append（没有 `if (…) stage.append(garageFuseEntry(r))` 这种写法）。
    expect(home.split('garageFuseEntry(r)').length - 1).toBe(1);
    expect(garageFn).toContain('stage.append(garageFuseEntry(r));');
    expect(fuseEntryFn).toContain('foot.append(entry);');
    expect(fuseEntryFn).toContain('return foot;');
    // 入口的两个状态都用 dataset 如实标注（E2E 靠 `[data-ph-action="fuse-entry"]` 点击）。
    expect(fuseEntryFn).toContain("entry.dataset['phAction'] = 'fuse-entry';");
    expect(fuseEntryFn).toContain("entry.dataset['phFuseReadyCount'] = String(ready);");
    expect(fuseEntryFn).toContain("entry.dataset['phFuseEntryReady'] = String(ready > 0);");
    /*
      ⚠️ 没有可合成组时**仍然画出来**（持续可见），只是禁用 + 如实说「暂无可合成」——
         不是藏起来让玩家找不到入口。
    */
    expect(fuseEntryFn).toContain("if (ready > 0) entry.classList.add('ph-fuse-entry-ready');");
    expect(fuseEntryFn).toContain('else entry.disabled = true;');
    expect(fuseEntryFn).toContain('GARAGE_FUSE_ENTRY_NONE_LABEL');
    expect(fuseEntryFn).toContain('${GARAGE_FUSE_ENTRY_READY_LABEL} ${ready}');
    // 最小可感知状态：红点 + 高亮（Queue 允许「红点 或 数量」二选一，这里给了数量 + 红点）。
    expect(html).toMatch(/\.ph-fuse-entry-ready \.ph-fuse-entry-label::before\s*\{[^}]*background:\s*#ff5a3c/);
    expect(html).toMatch(/\.ph-fuse-entry:disabled\s*\{[^}]*cursor:\s*not-allowed/);
  });

  it('GS-14 入口只**带路**不合成：`fuseStack()` 全页仍只有 1 个调用点（正式武器卡上的按钮）', () => {
    // 合成规则一行都不在页面里（既有的那一次调用是正式卡片的「合成升星」按钮）。
    expect(home.split('fuseStack(').length - 1).toBe(1);
    const handler = sliceFn(fuseEntryFn, "entry.addEventListener('click'", 'foot.append(entry)');
    expect(handler).toContain('if (ready === 0) return;');
    expect(handler).toContain('fuseFocusPending = true;');
    expect(handler).toContain("garageSlot = 'weapon';");
    expect(handler).toContain('render();');
    // ⚠️ 反向：这个入口**不得**自己动库存 / 存档 / 合成规则。
    for (const banned of ['fuseStack', 'saveInventory', 'setItem', 'savePlayerBuild', 'localStorage']) {
      expect(handler, `合成入口不得调用 ${banned}`).not.toContain(banned);
    }
    // 点击后只做**视图动作**：把第一张可合成卡滚入视野 + 聚焦。
    expect(home).toContain("if (fuseFocusPending && w.fusable && !fuseFocusMarked)");
    expect(home).toContain("cell.dataset['phFuseFocus'] = '1'");
    expect(home).toContain('[data-ph-fuse-focus="1"]');
    expect(home).toContain("target.scrollIntoView({ block: 'center' });");
    expect(home).toContain('target.focus();');
    // 一次性：用过就复位，避免下次进 Garage 又跳一次。
    expect(garageFn).toContain('fuseFocusPending = false;');
  });

  it('GS-15 「持续可见」由运行时判定给出（存在 + 真实面积 + 未被样式藏掉），不是源码推断', () => {
    const visibleFn = sliceFn(home, 'function fuseEntryVisibleNow', 'const handle: ProductDebugHandle');
    expect(visibleFn).toContain("stage.querySelector<HTMLElement>('[data-ph-action=\"fuse-entry\"]')");
    expect(visibleFn).toContain('getBoundingClientRect()');
    expect(visibleFn).toContain("cs.display !== 'none'");
    expect(visibleFn).toContain("cs.visibility !== 'hidden'");
    // 探针三条读数：可见性 / 可合成组数 / 是否处于可感知态。
    expect(home).toContain('garageFuseEntryVisible: fuseEntryVisibleNow(),');
    expect(home).toContain('garageFuseReadyCount: r.weapons.filter((w) => w.fusable).length,');
    expect(home).toContain("?.getAttribute('data-ph-fuse-entry-ready') === 'true'");
    expect(probeIface).toContain('readonly garageFuseEntryVisible: boolean;');
    expect(probeIface).toContain('readonly garageFuseReadyCount: number;');
    expect(probeIface).toContain('readonly garageFuseEntryReady: boolean;');
  });
});

// ============================================================================
describe('PRODUCT-LOOP-P0-GARAGE-SLOT-INTERACTION-R2｜E. 状态语义唯一', () => {
  it('GS-16 配置页只有两个状态词（使用中 / 未拥有）；「默认 / 已选择 / 已装备 / 选中」一律不出现', () => {
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
         读数层的 `implicit` 字段（布尔）不在此列，它的语义由 GS-17 单独钉。
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
    // 「我的装备」标题也是**唯一常量**驱动。
    expect(home.split('GARAGE_MY_PARTS_LABEL').length - 1).toBeGreaterThanOrEqual(1);
  });

  it('GS-17 「缺省轮 / 缺省车身」语义**保留在读数层**（只是不再画标签）：implicit 字段照旧可读', () => {
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
describe('PRODUCT-LOOP-P0-GARAGE-SLOT-INTERACTION-R2｜F. 未拥有内容降级', () => {
  it('GS-18 未拥有内容进原生 `<details>` 降级区（`data-ph-locked`），可用内容留在主卡阵', () => {
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

  it('GS-19 降级 ≠ 新入口：页面**没有**商城 / 解锁 / 经济 / 教程 / 推荐 / 属性评分', () => {
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
describe('PRODUCT-LOOP-P0-GARAGE-SLOT-INTERACTION-R2｜G. 边界（禁止清单）', () => {
  it('GS-20 零新增持久化：页面自己不写盘，正式 key 仍是同一个', () => {
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

  it('GS-21 不碰数值 / 不新增部件 / 不新增槽位：页面无部件数值字面量，槽位恰好 4 个', () => {
    // 页面不得给任何部件属性赋值（数值唯一真源在内容层 / 读数层）。
    for (const field of ['radius', 'mass', 'baseMass', 'energyCapacity', 'hp', 'damage']) {
      expect(home, `页面不得给 ${field} 赋字面量`).not.toMatch(new RegExp(`${field}\\s*:\\s*\\d`));
    }
    // 也不自己造一张武器 / 轮组 / 车身清单。
    expect(home).not.toContain('OFFICIAL_MOVEMENTS');
    expect(home).not.toContain('OFFICIAL_BODIES');
    expect(home).not.toContain('NEW_OFFICIAL_BODIES');
    // 槽位恰好四个（不新增维度、不预埋 Gadget 等未来空槽）。
    expect(GARAGE_SLOT_ORDER.length).toBe(4);
    // 卡片读数一律取自读数层（页面不自己拼那三个数）。
    expect(home).not.toContain('轮径');
    expect(home).toContain("el('span', 'ph-card-stats', c.statsText)");
    expect(home).toContain("card.dataset['phBodyStats'] = c.statsText");
    /*
      内容量的真源仍在 core：本队列没有新增任何部件定义 ——
      `registry.movements` 恰好是「三档需库存轮组 + 缺省轮」。
    */
    expect(registry.movements.size).toBe(OFFICIAL_MOVEMENTS.length + 1);
    expect(registry.bodies.size).toBeGreaterThan(0);
  });

  it('GS-22 写入口仍然唯一：`playerLoadout` 里只有一处 `savePlayerBuild(`，且三个 equip 都走它', () => {
    const loadout = strip(readProduct('playerLoadout.ts'));
    expect(loadout.split('savePlayerBuild(').length - 1).toBe(1);
    expect(loadout).toContain('function persistPlayerBuild');
    // 三个写入口都在同一个文件里、都调 `persistPlayerBuild(`。
    expect(loadout.split('persistPlayerBuild(').length - 1).toBeGreaterThanOrEqual(4);
  });

  it('GS-23 探针口径同步：Garage 相关字段是 `garageSlot*` / `garageEquipButtonCount` / `garageDraggableCount` / `garageFuse*`', () => {
    for (const field of [
      'readonly garageSlot: GarageSlot;',
      'readonly garageSlotCount: number;',
      'readonly garageEquipButtonCount: number;',
      'readonly garageDraggableCount: number;',
      'readonly garageFuseEntryVisible: boolean;',
      'readonly garageFuseReadyCount: number;',
      'readonly garageFuseEntryReady: boolean;',
    ]) {
      expect(probeIface, `探针接口必须有 ${field}`).toContain(field);
    }
    // 旧字段在探针接口里也必须消失（不能只删实现留接口）。
    expect(probeIface).not.toContain('selectedWeaponId');
    expect(probeIface).not.toContain('equipEnabled');
    expect(probeIface).not.toContain('garageTab');
    // 实现侧同步：不能再出现旧的分类 Tab 词汇。
    for (const dead of ['garageTab', 'GARAGE_TAB_ORDER', 'GARAGE_TAB_LABELS', 'GarageTab', "phTab"]) {
      expect(home, `${dead} 必须已删除`).not.toContain(dead);
    }
  });

  it('GS-24 首页与 Garage 仍是同一页面的两个视图（零跳转、零第二套页面逻辑）', () => {
    expect(home).toContain("export type ProductView = 'home' | 'garage'");
    expect(home).toContain("if (view === 'home') renderHome(r);");
    expect(home).toContain('else renderGarage(r);');
    expect(home).not.toContain('location.href');
    expect(home).not.toContain('window.open');
    // 返回首页只是切视图 + 重渲染（不写盘 / 不导航）。
    const backHandler = sliceFn(garageFn, 'back.addEventListener', 'header.append(back)');
    expect(backHandler).toContain("view = 'home';");
    expect(backHandler).toContain('render();');
    expect(backHandler).not.toContain('setItem');
  });
});

// ============================================================================
describe('PRODUCT-LOOP-P0-GARAGE-SLOT-INTERACTION-R2｜H. 读数层回归（本 Queue 不改读数）', () => {
  it('GS-25 结构重构**没有**改变任何读数：loadout / movement / body 三份 reading 与装备动作保持一致', () => {
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
