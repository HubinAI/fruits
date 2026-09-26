/**
 * PRODUCT-LOOP-P0-GARAGE-FOUR-SLOT-CLARITY-R3｜**Garage 四槽同构页** targeted 测试。
 *
 * 演进路线（本文件按轮次升级，用例前缀换过一次以区分语义）：
 *   R1（`GARAGE-MOBILE-INTERACTION`，分类 Tab 版）
 *     → 解决「四维纵向堆成超长页 / 操作时 Preview 滚出屏幕 / 两步装备不统一 / 未拥有与可用混排」；
 *   R2（`SLOT-INTERACTION`，槽位版 + 挂点定位）
 *     → 解决「不知道拖动还是点击 / Preview 朝向反了 / 找不到合成」，
 *       并让四个槽**贴到该部件的正式挂点坐标**上；
 *   R3（本 Queue，四槽同构版）
 *     → 真人录屏判定 R2 的**挂点定位假设失败**：玩家看到的是
 *       「一个独立的武器悬浮块 + 3 个像页签的按钮」，认知成了「3 个页签 + 1 个武器块」。
 *       本轮的处置只有两条：**删掉挂点定位**、**把四个槽做成完全同构的 2×2**。
 *
 * 对应关系（本 Queue 的必改 → 用例）：
 *   必改 1｜4 个槽完全同构（2×2、删除 Weapon 悬浮块 / 三个页签 / anchor 定位）
 *        → GS-01 · GS-02 · GS-03 · GS-05 · GS-06 · GS-R3-01 · GS-R3-02
 *   必改 2｜明确当前正在改哪个槽（标题 = `选择〈槽位名〉装备`）
 *        → GS-07 · GS-08
 *   必改 3｜唯一装备操作（点槽位 → 点已拥有 → 立即装备；禁拖拽 / 二次确认）
 *        → GS-09 · GS-09b · GS-10 · GS-11
 *   必改 4｜Preview 只负责结果反馈（UI 不再消费挂点坐标）
 *        → GS-12 · GS-R3-02 · GS-13
 *   必改 5｜合成入口**始终可进入**（不因没有 5/5 而 disable）
 *        → GS-14 · GS-15 · GS-16
 *
 * 本队列自己立的不变量（比 R2 更强，因为**版面**变了）：
 *   - **结构保证而非滚动位置巧合**：预览 / 槽位区 / 标题 / 合成入口都是滚动容器的
 *     **兄弟节点** ⇒ 几何上不可能被「滚出去」（GS-01 / GS-02 / GS-05 / GS-14）；
 *   - **只有一个滚动容器**：`.ph-garage-body`（GS-05）；
 *   - **四个槽走同一个构造分支**：`for (const slot of GARAGE_SLOT_ORDER)` 里没有分支、
 *     没有专属 modifier、没有行内定位 ⇒ 「同尺寸 / 同结构 / 同交互 / 同选中态」是版面保证（GS-06 / GS-R3-01）；
 *   - **UI 不再消费挂点几何**：`vehicleSlotAnchors` 从页面移除（反向守卫，GS-R3-02）；
 *   - **不存在「已选择但未装备」中间态**：二次按钮在源码里被删除，探针按 DOM 数它（GS-09）；
 *   - **一个槽位一个写入口**：`equipWeapon` / `equipBody` / `equipMovement` 各自过
 *     `validateSnapshot` 并只写自己的字段 ⇒ 「互不覆盖」是结构性的（GS-11）；
 *   - **合成入口只带路、不合成**：`fuseStack()` 全页仍只有 1 个调用点（GS-15）；
 *   - **状态词只有一个**：`使用中` / `未拥有`，其余一律不画（GS-17）；
 *   - **零新增持久化**：页面自己不写盘、不新增 key（GS-21）。
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
  GARAGE_CURRENT_LABEL,
  GARAGE_FUSE_ENTRY_LABEL,
  GARAGE_IN_USE_LABEL,
  GARAGE_IN_USE_LEAD,
  GARAGE_LOCKED_LABEL,
  GARAGE_MOVEMENT_OFF_LABEL,
  GARAGE_PICK_TITLE_PREFIX,
  GARAGE_PICK_TITLE_SUFFIX,
  GARAGE_SLOT_LABELS,
  GARAGE_SLOT_ORDER,
  GARAGE_TITLE,
  MOVEMENT_HARDPOINT_LABELS,
  PRODUCT_STAGE_H,
  PRODUCT_STAGE_W,
  SAVE_KEY,
  garageSlotTitle,
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
import { vehiclePreviewLayout } from '../src/product/vehiclePreview';
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
const preview = strip(readProduct('vehiclePreview.ts'));
/** ⚠️ 注释**不剥**的那一份：用来验「废弃说明确实写在源码里」（剥注释版查不到中文说明）。 */
const previewRaw = readProduct('vehiclePreview.ts');

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
/** 4 个槽的**构造循环**（R3 的核心：同构的机器证据都在这一段里）。 */
const slotLoop = sliceFn(garageFn, 'for (const slot of GARAGE_SLOT_ORDER)', 'stage.append(current);');

// ============================================================================
describe('PRODUCT-LOOP-P0-GARAGE-FOUR-SLOT-CLARITY-R3｜A. 2×2 同构槽骨架（必改 1）', () => {
  it('GS-01 五段骨架：`.ph-garage-stage` / `.ph-garage-current` / `.ph-my-parts` / `.ph-garage-body` / `.ph-garage-foot`，append 顺序 stage → current → myParts → body → 合成入口', () => {
    for (const cls of [
      'ph-garage-stage',
      'ph-garage-current',
      'ph-garage-slots',
      'ph-my-parts',
      'ph-garage-body',
      'ph-garage-foot',
    ]) {
      expect(garageFn, `Garage 必须创建 .${cls}`).toContain(`'${cls}'`);
    }
    /*
      ⚠️ 顺序断言用**真实的 `stage.append(...)` 调用位置**，不是「类名字面量出现的先后」——
         后者会被源码排版（常量区 / 辅助函数定义位置）污染。
    */
    const order = [
      'stage.append(stageBox)',
      'stage.append(current)',
      'stage.append(myParts)',
      'stage.append(body)',
      'stage.append(garageFuseEntry(r))',
    ];
    let prev = -1;
    for (const call of order) {
      const at = garageFn.indexOf(call);
      expect(at, `Garage 必须 ${call}`).toBeGreaterThan(-1);
      expect(at, `${call} 的 append 顺序必须在上一段之后`).toBeGreaterThan(prev);
      prev = at;
    }
    // 五个兄弟节点 + 唯一滚动容器 ⇒「固定区不会被滚出屏幕」是结构保证。
    expect(garageFn).toContain("stageBox.dataset['phGarageStage'] = '1'");
    expect(garageFn).toContain("current.dataset['phGarageCurrent'] = '1'");
    expect(garageFn).toContain("slots.dataset['phGarageSlots'] = '1'");
    expect(garageFn).toContain("foot.dataset['phGarageFoot'] = '1'");
    expect(garageFn).toContain("body.dataset['phGarageBody'] = garageSlot");
    expect(garageFn).toContain("myParts.dataset['phMyParts'] = garageSlot");
  });

  it('GS-02 Preview 在固定区 stage 内、返回首页在 header 内；**槽位已不在车体里**（R2 的挂点定位删除）', () => {
    // A：战车实时 Preview 是 stage 区唯一的孩子（R3：槽位不再和它挤在一起）。
    expect(garageFn).toContain("const car = el('div', 'ph-car-wrap ph-car-wrap-sm')");
    expect(garageFn).toContain('car.append(renderPreview(vehiclePreviewLayout(draft)));');
    expect(garageFn).toContain('stageBox.append(car);');
    /*
      ⚠️ R3 的关键删减：R2 把槽位节点挂进 `.ph-car`（车体）内部并绝对定位到挂点上，
         于是武器槽成了「独立悬浮块」。现在槽位挂在 `.ph-garage-slots`（grid）里：
           槽位 → slots（grid）→ current（固定区）→ stage。
    */
    expect(garageFn).toContain('slots.append(btn);');
    expect(garageFn).toContain('current.append(slots);');
    expect(garageFn).toContain('stage.append(current);');
    // 反向：槽位**不得**再挂进预览车体（R2 的 `previewBox.append(btn)` 已整体删除）。
    expect(garageFn).not.toContain('previewBox');
    expect(garageFn).not.toMatch(/car\.append\(btn\)/);
    expect(garageFn).not.toContain('stageBox.append(btn)');
    expect(garageFn).not.toContain('stage.append(btn)');
    // B：返回首页挂在 header 上（Queue 结构：顶部 = 标题 / 返回），且带 `back-home`（E2E 用它做真实点击）。
    expect(garageFn).toContain("const back = el('button', 'ph-back', GARAGE_BACK_LABEL)");
    expect(garageFn).toContain("back.dataset['phAction'] = 'back-home'");
    expect(garageFn).toContain('header.append(back);');
    // ⚠️ 反向：Preview / 返回都**不得**出现在 body（滚动容器）的渲染里。
    expect(garageFn).not.toMatch(/body\.append\(car/);
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
    // 「选择〈槽位名〉装备」标题由**同一个**槽位状态驱动 ⇒ 标题与卡阵不可能分叉。
    expect(garageFn).toContain("el('span', 'ph-my-parts-title', garageSlotTitle(garageSlot))");
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

  it('GS-05 home.html：滚动契约不变 + 槽位改成 **2×2 grid**（不再绝对定位）', () => {
    expect(html).toMatch(/\.ph-main-garage\s*\{[^}]*overflow:\s*hidden/);
    expect(html).toMatch(/\.ph-garage-body\s*\{[^}]*overflow-y:\s*auto/);
    expect(html).toMatch(/\.ph-screen\s*\{[^}]*overflow:\s*hidden/);
    // 固定区不吃掉卡片区的空间：stage / current / myParts / foot 都是 `flex: 0 0 auto`，body 是 `flex: 1 1 auto`。
    expect(html).toMatch(/\.ph-garage-stage\s*\{[^}]*flex:\s*0 0 auto/);
    expect(html).toMatch(/\.ph-garage-current\s*\{[^}]*flex:\s*0 0 auto/);
    expect(html).toMatch(/\.ph-my-parts\s*\{[^}]*flex:\s*0 0 auto/);
    expect(html).toMatch(/\.ph-garage-foot\s*\{[^}]*flex:\s*0 0 auto/);
    expect(html).toMatch(/\.ph-garage-body\s*\{[^}]*flex:\s*1 1 auto/);
    expect(html).toMatch(/\.ph-garage-body\s*\{[^}]*min-height:\s*0/);
    /*
      ⚠️ R3 的版面真源 = 一个两列等宽 grid：
         「四槽同尺寸」不是四段 CSS 抄出来的，而是 **同一列宽** 决定的。
    */
    expect(html).toMatch(/\.ph-garage-slots\s*\{[^}]*display:\s*grid/);
    expect(html).toMatch(/\.ph-garage-slots\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
    /*
      ⚠️ 反向守卫（R3 的核心删减）：槽位**不得**再绝对定位、不得再有上下两个 modifier、
         也不得再有「限宽 + 行内 left」那套挂点排版。
    */
    expect(html).not.toMatch(/\.ph-slotnode\s*\{[^}]*position:\s*absolute/);
    expect(html).not.toContain('.ph-slotnode-above');
    expect(html).not.toContain('.ph-slotnode-below');
    expect(html).toMatch(/\.ph-slotnode\s*\{[^}]*width:\s*100%/);
    expect(html).toMatch(/\.ph-slotnode\s*\{[^}]*min-height:\s*54px/);
    /*
      ⚠️ 高亮**只准**用不影响布局的属性 ⇒ 「同规格」不被「选中态」破坏
         （R2 用 border-color + background，R3 追加 box-shadow，都不是尺寸 / 间距）。
    */
    const activeRule = (html.match(/\.ph-slotnode-active\s*\{[^}]*\}/) ?? [''])[0];
    expect(activeRule).toContain('border-color');
    expect(activeRule).not.toMatch(/\b(width|height|padding|margin|font-size)\s*:/);
    // R2 那套「为槽位预留的预览留白」必须已经退回首页同款（删掉无必要的内边距，不是压 gap）。
    expect(html).toMatch(/\.ph-garage-stage \.ph-car-wrap\s*\{[^}]*padding:\s*2px 0 0/);
    expect(html).not.toMatch(/\.ph-garage-stage \.ph-car-wrap\s*\{[^}]*50px/);
    // 逻辑舞台尺寸口径没变（本 Queue 不碰缩放契约）。
    expect(PRODUCT_STAGE_W).toBe(390);
    expect(PRODUCT_STAGE_H).toBe(844);
  });

  it('GS-06 四个槽**同一个构造分支**：无逐槽分支 / 无专属 modifier / 无行内定位（同构的机器证据）', () => {
    // ① 4 个、顺序 = 2×2 版面顺序、默认 weapon。
    expect([...GARAGE_SLOT_ORDER]).toEqual(['weapon', 'body', 'rear', 'front']);
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
    expect(home).toContain("let garageSlot: GarageSlot = 'weapon'");

    // ② 槽位构造**只有一个循环、没有逐槽分支**。
    expect(slotLoop).toContain('for (const slot of GARAGE_SLOT_ORDER)');
    expect(slotLoop).not.toMatch(/if \(slot === '(weapon|body|front|rear)'\)/);
    expect(slotLoop).not.toContain('else if');
    expect(slotLoop).not.toContain('switch');
    // ③ **没有任何**专属 modifier（R2 的 `-above` / `-below` 是「武器块」的成因，已删）。
    expect(slotLoop).not.toMatch(/ph-slotnode-(above|below|weapon|body|front|rear)/);
    expect(slotLoop).toContain("btn.classList.add('ph-slotnode-active')");
    /*
      ⚠️ ④ **零行内定位**：槽位坐标由 CSS grid 决定（R2 的 `style.left = calc(50% + dx)` 已删）。
         这一条是「四个槽同规格」的**最硬**证据 —— 只要有一个槽能自己写坐标，
         它就可能在视觉上脱离另外三个。
    */
    expect(slotLoop).not.toContain('style.left');
    expect(slotLoop).not.toContain('style.top');
    expect(slotLoop).not.toContain('style.transform');
    expect(slotLoop).not.toContain('previewOffset');
    expect(slotLoop).not.toContain('Math.max');
    // ⑤ 同结构：每个槽都是 label + value 两个 span（没有任何槽多 / 少一个）。
    expect(slotLoop).toContain("el('span', 'ph-slotnode-label', GARAGE_SLOT_LABELS[slot])");
    expect(slotLoop).toContain("el('span', 'ph-slotnode-value', garageSlotValue(slot, r, mv))");
    // ⑥ 同交互：同一个 click handler，且是**纯视图切换**（切槽位不可能改配置）。
    expect(slotLoop).toContain('btn.addEventListener(');
    expect(slotLoop).toContain('if (garageSlot === slot) return;');
    expect(slotLoop).toContain('garageSlot = slot;');
    expect(slotLoop).toContain('render();');
    expect(slotLoop).not.toContain('setItem');
    expect(slotLoop).not.toContain('savePlayerBuild');
    // 槽位状态用 dataset（不是硬编码 attribute 字符串）——E2E 靠 `[data-ph-slot]` 点击。
    expect(slotLoop).toContain("btn.dataset['phSlot'] = slot");
    expect(slotLoop).toContain("btn.dataset['phSlotActive'] = String(slot === garageSlot)");
    expect(slotLoop).toContain("btn.dataset['phSlotDef'] = garageSlotDefId(slot, r, mv)");
    // GarageSlot 类型就是这四个字面量（没有别的取值）。
    const slotType: GarageSlot[] = ['weapon', 'body', 'front', 'rear'];
    expect(slotType.length).toBe(GARAGE_SLOT_ORDER.length);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-P0-GARAGE-FOUR-SLOT-CLARITY-R3｜B. 当前槽 → 下方标题（必改 2）', () => {
  it('GS-07 `garageSlotTitle` 逐字产出 Queue 要求的四个标题（前缀 / 后缀 + 槽位名拼装，不留第二份字面量）', () => {
    expect(GARAGE_PICK_TITLE_PREFIX).toBe('选择');
    expect(GARAGE_PICK_TITLE_SUFFIX).toBe('装备');
    /*
      ⚠️ Queue 逐字点名的四个标题 —— 直接钉字面量，而不是「拼出来的东西看起来对」。
    */
    expect(garageSlotTitle('weapon')).toBe('选择武器装备');
    expect(garageSlotTitle('body')).toBe('选择车身装备');
    expect(garageSlotTitle('rear')).toBe('选择后轮装备');
    expect(garageSlotTitle('front')).toBe('选择前轮装备');
    // 与 `GARAGE_SLOT_LABELS` 同源 ⇒ 改标签不可能让标题与槽位名分叉。
    for (const slot of GARAGE_SLOT_ORDER) {
      expect(garageSlotTitle(slot)).toBe(
        `${GARAGE_PICK_TITLE_PREFIX}${GARAGE_SLOT_LABELS[slot]}${GARAGE_PICK_TITLE_SUFFIX}`,
      );
      expect(garageSlotTitle(slot)).toContain(GARAGE_SLOT_LABELS[slot]);
    }
    expect(GARAGE_CURRENT_LABEL).toBe('当前装备');
  });

  it('GS-08 页面用**同一个函数**驱动标题节点；当前槽高亮只有一个 class + 一个 dataset', () => {
    // 标题节点只由 `garageSlotTitle(garageSlot)` 决定（页面不写第二份「选择…装备」）。
    expect(garageFn).toContain("myParts.append(el('span', 'ph-my-parts-title', garageSlotTitle(garageSlot)));");
    expect(garageFn).not.toMatch(/'选择[\u4e00-\u9fa5]*装备'/);
    // 高亮：class 与 dataset 同源，页面里没有任何「第二个高亮机制」。
    expect(slotLoop).toContain("if (slot === garageSlot) btn.classList.add('ph-slotnode-active');");
    expect(html).toMatch(/\.ph-slotnode-active\s*\{/);
    expect(home.split("dataset['phSlotActive']").length - 1).toBe(1);
    expect(slotLoop.split("btn.dataset['phSlotActive'] = String(slot === garageSlot)").length - 1).toBe(1);
    // 装备完成后**保持当前槽**：三个 equip 写入口都不碰 `garageSlot`。
    for (const fn of ['equipWeaponAndRender', 'equipMovementAndRender', 'equipBodyAndRender']) {
      const body = sliceFn(home, `function ${fn}`, '\n  }');
      expect(body, `${fn} 不得重置当前槽位`).not.toContain('garageSlot');
    }
  });
});

// ============================================================================
describe('PRODUCT-LOOP-P0-GARAGE-FOUR-SLOT-CLARITY-R3｜C. 唯一点击即装备 + 零拖拽（必改 3）', () => {
  it('GS-09 二次「装备」按钮**结构性删除**：源码里不存在它的 action，探针按 DOM 数它', () => {
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

  it('GS-09b 零拖拽（必改 3 明令）：源码无任何 drag 事件绑定，且运行时 `[draggable="true"]` 恒 0', () => {
    /*
      ⚠️ 用正则一次盖住全部 HTML5 拖放事件与属性赋值 —— 少列一个就等于给拖拽留后门。
         `draggable` 这个**词**本身允许出现（探针的选择器里就有），禁的是「绑定拖拽行为」。
    */
    expect(home).not.toMatch(/drag(start|end|over|enter|leave)\b/);
    expect(home).not.toMatch(/["']drop["']/);
    expect(home).not.toMatch(/\.drop\s*=/);
    expect(home).not.toMatch(/setAttribute\(\s*['"]draggable/);
    expect(home).not.toMatch(/\.draggable\s*=/);
    // 也禁长按 / 双击这类「猜测式」装备手势（Queue 明令禁）。
    expect(home).not.toMatch(/longpress|contextmenu|dblclick/i);
    // 运行时硬证据（探针现场数 DOM，不是源码推断）。
    expect(home).toContain(
      "garageDraggableCount: stage.querySelectorAll('[draggable=\"true\"]').length",
    );
    expect(probeIface).toContain('readonly garageDraggableCount: number;');
    // 4 个槽也是**运行时**数的（「4 个真实槽 / 没有第 5 个空槽」的机器证据）。
    expect(home).toContain("garageSlotCount: stage.querySelectorAll('[data-ph-slot]').length");
    expect(probeIface).toContain('readonly garageSlotCount: number;');
  });

  it('GS-10 四维**统一**为「点已拥有卡即装备」：三类卡片的 click 都直接调各自的 equip 写入口', () => {
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

  it('GS-11 三个唯一写入口各自过 `validateSnapshot` 且**只改自己的字段**（互不覆盖）', () => {
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
describe('PRODUCT-LOOP-P0-GARAGE-FOUR-SLOT-CLARITY-R3｜D. Preview 只做结果反馈（必改 4）', () => {
  it('GS-12 预览坐标口径 = y 向下、视图层**不翻转**：`previewOffset` 的 dy 不取反', () => {
    /*
      ⚠️ R1 期的写法是 `-(it.cy - by) * scale` ⇒ 整车上下镜像（轮子跑到车身上方、
         武器挂到车底）。R2 修成与正式链路同口径（y 向下），视图层不做任何翻转。
         **R3 保留这个修正**（Queue 明令：Preview 正确朝向是冻结项）。
    */
    expect(home).toContain('dy: (cy - by) * layout.scale');
    expect(home).not.toContain('-(it.cy');
    expect(home).not.toContain('-(cy - by)');
    expect(home).not.toContain('-(it.cy - by)');
    // 预览件的换算只有这一个函数。
    expect(home).toContain(
      'function previewOffset(layout: VehiclePreviewLayout, cx: number, cy: number): { dx: number; dy: number }',
    );
    expect(home).toContain('const { dx, dy } = previewOffset(layout, it.cx, it.cy);');
    // 视图层只用 dy 减去自身半高（居中），没有第二次取反。
    expect(home).toContain('node.style.top = `calc(50% + ${dy - h / 2}px)`;');
    // 反向：不得对 UI 层做镜像（Queue 明令：只能修 vehicle preview 自身，不得镜像整个 Garage DOM）。
    for (const mirror of ['scaleX(-1)', 'scaleY(-1)', 'rotate(180deg)', 'rotateX(', 'rotateY(']) {
      expect(home, `页面不得出现 ${mirror}`).not.toContain(mirror);
      expect(html, `样式不得出现 ${mirror}`).not.toContain(mirror);
    }
  });

  it('GS-R3-02 UI 层**不再消费挂点几何**：`vehicleSlotAnchors` / 夹取 / 行内坐标从页面整体移除', () => {
    /*
      ⚠️ 本 Queue 的删除清单（Queue 逐字）：
         - `vehicleSlotAnchors` 的 **UI 依赖**；
         - `GARAGE_SLOT_MAX_DX`；
         - 「槽位随挂点 x/y 布局」的规则。
    */
    expect(home, 'homePage 不得再 import / 调用 vehicleSlotAnchors').not.toContain('vehicleSlotAnchors');
    expect(home).not.toContain('GARAGE_SLOT_MAX_DX');
    expect(home).not.toContain("dataset['phSlotDx']");
    expect(home).not.toContain('phSlotDx');
    // 槽位构造循环里不许有任何几何计算（上一用例已逐条钉，这里补「整段函数」视角）。
    expect(garageFn).not.toContain('previewOffset(layout, anchor');
    expect(garageFn).not.toMatch(/const\s+anchors\s*=/);
    /*
      ⚠️ 底层纯函数**保留**（Queue：还被其它正式功能用就保留下层；不要为清理扩大重构范围），
         但它的角色只剩「正式挂点语义的唯一只读访问器」—— 供 PL-27 / PL-28 取证用。
    */
    expect(preview).toContain('export function vehicleSlotAnchors(');
    // 废弃说明必须**真的写在源码里**（这条查未剥注释的原文：剥注释版自然查不到中文说明）。
    expect(previewRaw).toContain('Garage UI 已不再消费');
    // 预览件本身仍由 `vehiclePreviewLayout` 驱动（朝向修正没有被这次删减带走）。
    expect(garageFn).toContain('vehiclePreviewLayout(draft)');
  });

  it('GS-13 只修车辆预览层：UI 文字 / 槽位 / 卡片一概不镜像，槽位标签就是普通文本节点', () => {
    // 槽位标签是**文本**（不会被任何对称变换翻过来）——「前轮 / 后轮」永远读得对。
    expect(slotLoop).toContain("el('span', 'ph-slotnode-label', GARAGE_SLOT_LABELS[slot])");
    // 页面不含任何镜像 API / 属性。
    for (const banned of ['scale(-1', 'transform-origin: right', 'ph-mirror', 'direction: rtl']) {
      expect(home, `页面不得出现 ${banned}`).not.toContain(banned);
      expect(html, `样式不得出现 ${banned}`).not.toContain(banned);
    }
    // 修正发生在 vehiclePreview 层（几何真源），不是给 Garage 套层反向变换。
    expect(preview).toContain("from: 'hardpoint'");
    expect(preview).toContain("from: 'body-origin'");
  });
});

// ============================================================================
describe('PRODUCT-LOOP-P0-GARAGE-FOUR-SLOT-CLARITY-R3｜E. 合成入口**恒可进入**（必改 5）', () => {
  it('GS-14 入口**无条件**画出来且**从不 disabled**：`.ph-garage-foot` 常驻、`.ph-fuse-entry` 常驻可点', () => {
    expect(GARAGE_FUSE_ENTRY_LABEL).toBe('合成');
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
      ⚠️ Queue 必改 5 逐字：「不要因为当前没有 5/5 就 disable 整个入口」。
         这里用**源码 + 样式 + 运行时读数**三证：
           ① 源码里 `garageFuseEntry` 完全不出现 `disabled`；
           ② 没有 `:disabled` 样式规则（也就没有「看起来不可点」的态）；
           ③ 探针 `garageFuseEntryDisabled` 现场读 `el.disabled`。
    */
    expect(fuseEntryFn).not.toContain('disabled');
    expect(html).not.toContain('.ph-fuse-entry:disabled');
    expect(home).not.toContain("entry.disabled");
    expect(home).toContain('function fuseEntryDisabledNow');
    expect(home).toContain(
      "stage.querySelector<HTMLButtonElement>('[data-ph-action=\"fuse-entry\"]')",
    );
    expect(probeIface).toContain('readonly garageFuseEntryDisabled: boolean;');
    /*
      ⚠️ 没有可合成组时**仍显示普通「合成」**：不加数量、不写「暂无可合成」这种像禁用的文案。
    */
    expect(fuseEntryFn).toContain('if (ready > 0) entry.append(el(\'span\', \'ph-fuse-entry-state\', String(ready)));');
    expect(home).not.toContain('暂无可合成');
    // 最小可感知状态：红点（Queue 允许「红点 或 数量」二选一，这里两者都有）。
    expect(html).toMatch(/\.ph-fuse-entry-ready \.ph-fuse-entry-label::before\s*\{[^}]*background:\s*#ff5a3c/);
  });

  it('GS-15 入口只**带路**不合成，且**任何状态都带路**：`fuseStack()` 全页仍只有 1 个调用点', () => {
    // 合成规则一行都不在页面里（既有的那一次调用是正式卡片的「合成升星」按钮）。
    expect(home.split('fuseStack(').length - 1).toBe(1);
    const handler = sliceFn(fuseEntryFn, "entry.addEventListener('click'", 'foot.append(entry)');
    /*
      ⚠️ R2 这里有 `if (ready === 0) return;`（没有可合成组就点不动）——
         R3 必改 5 明令删掉它：入口在任何状态下都要真的进入合成流程。
    */
    expect(handler).not.toContain('if (ready === 0) return;');
    expect(handler).not.toMatch(/if \(ready === 0\)/);
    expect(handler).toContain('fuseFocusPending = true;');
    expect(handler).toContain("garageSlot = 'weapon';");
    expect(handler).toContain('render();');
    // ⚠️ 反向：这个入口**不得**自己动库存 / 存档 / 合成规则。
    for (const banned of ['fuseStack', 'saveInventory', 'setItem', 'savePlayerBuild', 'localStorage']) {
      expect(handler, `合成入口不得调用 ${banned}`).not.toContain(banned);
    }
    // 点击后只做**视图动作**：把第一张可合成卡滚入视野 + 聚焦（那里才有 `成长 N/5` 与合成按钮）。
    expect(home).toContain("if (fuseFocusPending && w.fusable && !fuseFocusMarked)");
    expect(home).toContain("cell.dataset['phFuseFocus'] = '1'");
    expect(home).toContain('[data-ph-fuse-focus="1"]');
    expect(home).toContain("target.scrollIntoView({ block: 'center' });");
    expect(home).toContain('target.focus();');
    // 一次性：用过就复位，避免下次进 Garage 又跳一次。
    expect(garageFn).toContain('fuseFocusPending = false;');
    // 卡片上的 `成长 N/5` 就是「进入后能看到真实进度」的数据源（Queue 验收 9）。
    expect(home).toContain("el('span', 'ph-card-growth', `${GARAGE_GROWTH_LABEL} ${w.stackText}`)");
    expect(home).toContain("card.dataset['phStackText'] = w.stackText");
  });

  it('GS-16 「持续可见」与「恒可点」都由运行时判定给出（存在 + 真实面积 + 未被样式藏掉 + `disabled`），不是源码推断', () => {
    const visibleFn = sliceFn(home, 'function fuseEntryVisibleNow', 'const handle: ProductDebugHandle');
    expect(visibleFn).toContain("stage.querySelector<HTMLElement>('[data-ph-action=\"fuse-entry\"]')");
    expect(visibleFn).toContain('getBoundingClientRect()');
    expect(visibleFn).toContain("cs.display !== 'none'");
    expect(visibleFn).toContain("cs.visibility !== 'hidden'");
    expect(visibleFn).toContain('function fuseEntryDisabledNow');
    // ⚠️ 入口缺失时按「不可进入」处理（返回 true）⇒ 入口被删掉不会假绿。
    expect(visibleFn).toContain('return n ? n.disabled === true : true;');
    // 探针四条读数：可见性 / 可合成组数 / 是否处于可感知态 / 是否被禁用。
    expect(home).toContain('garageFuseEntryVisible: fuseEntryVisibleNow(),');
    expect(home).toContain('garageFuseReadyCount: r.weapons.filter((w) => w.fusable).length,');
    expect(home).toContain("?.getAttribute('data-ph-fuse-entry-ready') === 'true'");
    expect(home).toContain('garageFuseEntryDisabled: fuseEntryDisabledNow(),');
    expect(probeIface).toContain('readonly garageFuseEntryVisible: boolean;');
    expect(probeIface).toContain('readonly garageFuseReadyCount: number;');
    expect(probeIface).toContain('readonly garageFuseEntryReady: boolean;');
  });
});

// ============================================================================
describe('PRODUCT-LOOP-P0-GARAGE-FOUR-SLOT-CLARITY-R3｜F. 状态语义唯一', () => {
  it('GS-17 配置页只有两个状态词（使用中 / 未拥有）；「我的装备」「默认 / 已选择 / 已装备 / 选中」一律不出现', () => {
    expect(GARAGE_IN_USE_LABEL).toBe('使用中');
    expect(GARAGE_LOCKED_LABEL).toBe('未拥有');
    expect(GARAGE_IN_USE_LEAD).toBe('当前使用中');
    /*
      ⚠️ R3 必改 2：模糊的「我的装备」这个标题**必须不存在**（被「选择〈槽位名〉装备」取代）。
         这里查的是**剥注释后的代码**，注释里引用 Queue 原文不算。
    */
    expect(home).not.toContain('我的装备');
    // 旧的标签常量必须已经不存在（不是「没被引用」而是「不存在」）。
    for (const dead of [
      'GARAGE_EQUIP_LABEL',
      'GARAGE_MOVEMENT_PICK_LABEL',
      'GARAGE_MOVEMENT_PICKED_LABEL',
      'GARAGE_MOVEMENT_EQUIPPED_LABEL',
      'GARAGE_MOVEMENT_DEFAULT_LABEL',
      'GARAGE_MOVEMENT_LOCKED_LABEL',
      'GARAGE_MY_PARTS_LABEL',
    ]) {
      expect(home, `${dead} 必须已删除`).not.toContain(dead);
    }
    /*
      ⚠️ 卡面上不得再画与「使用中」竞争的第二个状态词。
         `'默认'` 是**字符串字面量**，只在页面的展示文案里出现时才命中 ——
         读数层的 `implicit` 字段（布尔）不在此列，它的语义由 GS-18 单独钉。
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
    // 卡片区标题也是**唯一常量 / 唯一函数**驱动。
    expect(home.split('garageSlotTitle').length - 1).toBeGreaterThanOrEqual(1);
  });

  it('GS-18 「缺省轮 / 缺省车身」语义**保留在读数层**（只是不再画标签）：implicit 字段照旧可读', () => {
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
describe('PRODUCT-LOOP-P0-GARAGE-FOUR-SLOT-CLARITY-R3｜G. 未拥有内容降级', () => {
  it('GS-19 未拥有内容进原生 `<details>` 降级区（`data-ph-locked`），可用内容留在主卡阵', () => {
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

  it('GS-20 降级 ≠ 新入口：页面**没有**商城 / 解锁 / 经济 / 教程 / 推荐 / 属性评分', () => {
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
describe('PRODUCT-LOOP-P0-GARAGE-FOUR-SLOT-CLARITY-R3｜H. 边界（禁止清单）', () => {
  it('GS-21 零新增持久化：页面自己不写盘，正式 key 仍是同一个', () => {
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

  it('GS-22 不碰数值 / 不新增部件 / 不新增槽位：页面无部件数值字面量，槽位恰好 4 个', () => {
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
    expect(GARAGE_SLOT_ORDER).not.toContain('gadget');
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

  it('GS-23 写入口仍然唯一：`playerLoadout` 里只有一处 `savePlayerBuild(`，且三个 equip 都走它', () => {
    const loadout = strip(readProduct('playerLoadout.ts'));
    expect(loadout.split('savePlayerBuild(').length - 1).toBe(1);
    expect(loadout).toContain('function persistPlayerBuild');
    // 三个写入口都在同一个文件里、都调 `persistPlayerBuild(`。
    expect(loadout.split('persistPlayerBuild(').length - 1).toBeGreaterThanOrEqual(4);
  });

  it('GS-24 探针口径同步：`garageSlot*` / `garageEquipButtonCount` / `garageDraggableCount` / `garageFuse*`', () => {
    for (const field of [
      'readonly garageSlot: GarageSlot;',
      'readonly garageSlotTitle: string;',
      'readonly garageSlotCount: number;',
      'readonly garageEquipButtonCount: number;',
      'readonly garageDraggableCount: number;',
      'readonly garageFuseEntryVisible: boolean;',
      'readonly garageFuseReadyCount: number;',
      'readonly garageFuseEntryReady: boolean;',
      'readonly garageFuseEntryDisabled: boolean;',
    ]) {
      expect(probeIface, `探针接口必须有 ${field}`).toContain(field);
    }
    /*
      ⚠️ 标题读数必须**读页面真实画出来的节点**（不是重算一遍函数）⇒
         「槽位高亮」与「下方标题」不可能各说各话。
    */
    expect(home).toContain("stage.querySelector('.ph-my-parts-title')?.textContent ?? ''");
    // 旧字段在探针接口里也必须消失（不能只删实现留接口）。
    expect(probeIface).not.toContain('selectedWeaponId');
    expect(probeIface).not.toContain('equipEnabled');
    expect(probeIface).not.toContain('garageTab');
    // 实现侧同步：不能再出现旧的分类 Tab 词汇 / R2 的挂点槽位词汇。
    for (const dead of [
      'garageTab',
      'GARAGE_TAB_ORDER',
      'GARAGE_TAB_LABELS',
      'GarageTab',
      'phTab',
      'GARAGE_MY_PARTS_LABEL',
      'ph-my-parts-slot',
      'ph-my-parts-label',
      'GARAGE_SLOT_MAX_DX',
      'vehicleSlotAnchors',
    ]) {
      expect(home, `${dead} 必须已删除`).not.toContain(dead);
    }
    // 样式侧同步：旧的槽位排版规则也一个不剩。
    for (const dead of ['.ph-slotnode-above', '.ph-slotnode-below', '.ph-my-parts-slot', '.ph-my-parts-label']) {
      expect(html, `${dead} 必须已删除`).not.toContain(dead);
    }
  });

  it('GS-25 首页与 Garage 仍是同一页面的两个视图（零跳转、零第二套页面逻辑）', () => {
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
describe('PRODUCT-LOOP-P0-GARAGE-FOUR-SLOT-CLARITY-R3｜I. 读数层回归（本 Queue 不改读数）', () => {
  it('GS-26 版面重构**没有**改变任何读数：loadout / movement / body 三份 reading 与装备动作保持一致', () => {
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

  it('GS-R3-03 预览件仍是同一份几何真源（朝向修正没被本轮删减带走）', () => {
    const draft = defaultPlayerDraft();
    const layout = vehiclePreviewLayout(draft);
    // 前轮在右、后轮在左；武器在车体上方（y 向下 ⇒ 负）。
    const wheelF = layout.items.find((i) => i.key === 'wheel:front');
    const wheelR = layout.items.find((i) => i.key === 'wheel:rear');
    expect(wheelF, '预览必须有前轮').toBeTruthy();
    expect(wheelRearGuard(wheelR)).toBeTruthy();
    expect((wheelF as { cx: number }).cx).toBeGreaterThan((wheelR as { cx: number }).cx);
    expect((wheelF as { cy: number }).cy).toBeGreaterThan(0);
    expect(layout.items.find((i) => i.onWeaponSlot)!.cy).toBeLessThan(0);
  });
});

/** 小工具：断言后轮确实被画出来（避免非空断言散落在断言里）。 */
function wheelRearGuard(w: { key: string } | undefined): boolean {
  return !!w && w.key === 'wheel:rear';
}
