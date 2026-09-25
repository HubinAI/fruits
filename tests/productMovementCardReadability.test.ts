/**
 * PRODUCT-LOOP-R3-MOVEMENT-CARD-READABILITY｜**轮组卡片的刻度量行** targeted 测试。
 *
 * 逐条对应 Queue 的验收：
 *   1 四种现有 Movement 卡片均展示真实数据 → MVR-01 / MVR-02 / MVR-03
 *   2 数值与 canonical Def 一致             → MVR-04 / MVR-05 / MVR-06
 *   3 当前装备 / 拥有状态不退化             → MVR-07 / MVR-08
 *   4 rear / front 装备仍正常               → MVR-09
 *   5 targeted tests + tsc                  → 本文件（tsc 在门禁里）
 *
 * 本队列自己立的不变量：
 *   - **数值不是第二套常量**：`statsText` 里的每个数都必须在 `registry.movements`
 *     里找得到出处，且卡片读数与 canonical Def **逐件逐字段相等**（MVR-01 / MVR-04）；
 *   - **没有推导型属性 / 星级 / 品质**：卡片文案里不出现 `%` / `+` / `★` / 品质词，
 *     也不出现 canonical 之外的字段名（抓地 / 转速 / 扭矩）（MVR-10 / MVR-11）；
 *   - **缺省轮走同一套规则**：`wheelStd` 的卡片同样有三项刻度（MVR-03）；
 *   - **纯展示**：加这一行**不改** owned / count / equipped / legal / available
 *     （MVR-07 / MVR-08）。
 *
 * ⚠️ 每个用例开头都会 `isolateMigrations()`（预置三份一次性迁移的标记）：本文件要验的是
 *    **卡片刻度量本身**，不该被 onboarding / reseed / Movement 种子的补件行为干扰。
 *    这是**隔离变量**，不是放宽断言 —— 那三份迁移各自的契约由 `playerGrowthR2A` /
 *    `productReseedR2` / `productMovementChoiceSeed` 分别在测。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { OFFICIAL_MOVEMENTS } from '../src/core/partInventory';
import { markR2Onboarding } from '../src/product/r2Onboarding';
import { markR2Reseed } from '../src/product/r2Reseed';
import { markR3MovementSeed } from '../src/product/r3MovementChoiceSeed';
import {
  MOVEMENT_STAT_LABELS,
  defaultPlayerDraft,
  equipMovement,
  movementReading,
  movementStatsText,
  playerInventory,
} from '../src/product/playerLoadout';
import { canonicalMovements } from '../src/product/runMovementCanonical';
import { movementEntries } from '../src/product/movementInventory';
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

/** 预置三份一次性迁移的标记 ⇒ 本文件只观察卡片刻度量本身（隔离变量，非放宽）。 */
function isolateMigrations(): void {
  markR2Onboarding();
  markR2Reseed();
  markR3MovementSeed();
}

/** 把一件需要库存的轮组**真的发到库存里**（走正式落盘，与真实入库链路同口径）。 */
function grantMovement(defId: string, n = 1): void {
  const inv = JSON.parse(store.getItem(INV_KEY) ?? '{}') as Record<string, { one?: number }>;
  const row = inv[defId] ?? {};
  row.one = (row.one ?? 0) + n;
  inv[defId] = row;
  store.setItem(INV_KEY, JSON.stringify(inv));
}

/** 全部四档轮组都发到手里（本 Queue 的真人前提：种子之后玩家确实拥有四档）。 */
function grantAll(): void {
  for (const m of OFFICIAL_MOVEMENTS) grantMovement(m);
}

// ============================================================================
describe('PRODUCT-LOOP-R3-MOVEMENT-CARD-READABILITY｜A. 四档卡片都展示真实数据', () => {
  it('MVR-01 每张卡片的 radius/mass/energy 与 registry.movements 逐件逐字段相等', () => {
    isolateMigrations();
    grantAll();
    const draft = defaultPlayerDraft();
    const r = movementReading(draft, playerInventory(draft));

    // 四档（1 缺省 + 3 需库存）一件不少
    expect(r.cards.length).toBe(4);
    expect(r.cards.length).toBe(registry.movements.size);

    for (const card of r.cards) {
      const def = registry.movements.get(card.defId);
      expect(def, `${card.defId} 必须在正式内容库里`).toBeTruthy();
      expect(card.radius, `${card.defId}.radius`).toBe(def?.radius);
      expect(card.mass, `${card.defId}.mass`).toBe(def?.mass);
      expect(card.energy, `${card.defId}.energy`).toBe(def?.energy);
    }
  });

  it('MVR-02 四档的刻度值互不雷同到「看不出来」（至少在两个维度上有区分度）', () => {
    isolateMigrations();
    grantAll();
    const draft = defaultPlayerDraft();
    const r = movementReading(draft, playerInventory(draft));

    // 玩家新增要求的正是「比较依据」⇒ 若四档三项全等，这个功能就没有意义。
    // 这里只断言「轮径」与「质量」两个维度各自出现了 ≥2 种取值（有可比性），
    // **不**断言谁大谁小（那属于数值平衡，不在本 Queue 范围内）。
    const radii = new Set(r.cards.map((c) => c.radius));
    const masses = new Set(r.cards.map((c) => c.mass));
    expect(radii.size).toBeGreaterThanOrEqual(2);
    expect(masses.size).toBeGreaterThanOrEqual(2);
  });

  it('MVR-03 缺省标准轮（implicit）走**同一套**展示规则：同样有三项刻度', () => {
    isolateMigrations();
    const draft = defaultPlayerDraft();
    const r = movementReading(draft, playerInventory(draft));
    const implicitCard = r.cards.find((c) => c.defId === r.defaultDefId);

    expect(implicitCard?.implicit).toBe(true);
    // 关键：缺省轮**不是**「没有刻度」的特例 —— 它的三个数同样来自它的 def。
    const def = registry.movements.get(r.defaultDefId);
    expect(implicitCard?.radius).toBe(def?.radius);
    expect(implicitCard?.mass).toBe(def?.mass);
    expect(implicitCard?.energy).toBe(def?.energy);
    expect(implicitCard?.statsText).toBe(movementStatsText(def as never));
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R3-MOVEMENT-CARD-READABILITY｜B. 数值与 canonical Def 一致（同源）', () => {
  it('MVR-04 statsText 里出现的每个数字都能在 canonical 字段里找到出处', () => {
    isolateMigrations();
    grantAll();
    const draft = defaultPlayerDraft();
    const r = movementReading(draft, playerInventory(draft));

    for (const card of r.cards) {
      const nums = (card.statsText.match(/\d+/g) ?? []).map(Number);
      // 恰好三个数，且顺序 = 轮径 / 质量 / 能耗
      expect(nums, `${card.defId} statsText=${card.statsText}`).toEqual([
        card.radius,
        card.mass,
        card.energy,
      ]);
    }
  });

  it('MVR-05 卡片读数与 canonicalMovements() 是**同一份**（不是页面 / 本模块自己造的表）', () => {
    isolateMigrations();
    grantAll();
    const draft = defaultPlayerDraft();
    const cards = movementReading(draft, playerInventory(draft)).cards;
    const canonical = canonicalMovements();

    // 逐件对账：defId 集合相同 + 三个数值逐个相等。
    expect(cards.map((c) => c.defId).sort()).toEqual(canonical.map((m) => m.defId).sort());
    for (const m of canonical) {
      const card = cards.find((c) => c.defId === m.defId);
      expect(card?.radius).toBe(m.radius);
      expect(card?.mass).toBe(m.mass);
      expect(card?.energy).toBe(m.energy);
      expect(card?.statsText).toBe(movementStatsText(m));
    }
  });

  it('MVR-06 movementEntries() 直接透出三个字段（卡片与库存读数同一份真源）', () => {
    isolateMigrations();
    grantAll();
    const draft = defaultPlayerDraft();
    const inv = playerInventory(draft);

    for (const e of movementEntries(inv, draft)) {
      const def = registry.movements.get(e.defId);
      expect(e.radius).toBe(def?.radius);
      expect(e.mass).toBe(def?.mass);
      expect(e.energy).toBe(def?.energy);
    }
  });

  it('MVR-06b statsText 的标签是三个指定词（轮径 / 质量 / 能耗），不引入第四个字段名', () => {
    isolateMigrations();
    const draft = defaultPlayerDraft();
    const card = movementReading(draft, playerInventory(draft)).cards[0];
    expect(card.statsText).toContain(`轮径 ${card.radius}`);
    expect(card.statsText).toContain(`质量 ${card.mass}`);
    expect(card.statsText).toContain(`能耗 ${card.energy}`);
    expect(Object.keys(MOVEMENT_STAT_LABELS).sort()).toEqual(['energy', 'mass', 'radius']);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R3-MOVEMENT-CARD-READABILITY｜C. 拥有 / 装备状态不退化', () => {
  it('MVR-07 加刻度行**不改变** owned / count / implicit / equipped / legal / available', () => {
    isolateMigrations();
    grantAll();
    const draft = defaultPlayerDraft();
    const inv = playerInventory(draft);
    const r = movementReading(draft, inv);

    // 全部四档都拥有；缺省轮仍是 implicit（不进库存）；两个挂点仍是缺省轮在跑。
    for (const c of r.cards) {
      expect(c.owned).toBe(true);
      const isDefault = c.defId === r.defaultDefId;
      expect(c.implicit).toBe(isDefault);
      expect(c.count).toBe(isDefault ? 0 : 1);
    }
    expect(r.available.length).toBe(4);
    expect(r.legal).toBe(true);
    expect(r.equippedDefIds).toEqual([r.defaultDefId]);
  });

  it('MVR-08 未拥有时卡片**照样有**刻度（如实展示，不是「没拥有就没数据」）', () => {
    isolateMigrations();
    // 刻意一件都不发 ⇒ 三档需库存轮组都未拥有
    const draft = defaultPlayerDraft();
    const r = movementReading(draft, playerInventory(draft));

    for (const m of OFFICIAL_MOVEMENTS) {
      const card = r.cards.find((c) => c.defId === m);
      expect(card?.owned).toBe(false);
      // 关键：未拥有**不影响**数值展示 —— 玩家正是靠它来决定「想不想要」。
      const def = registry.movements.get(m);
      expect(card?.radius).toBe(def?.radius);
      expect(card?.mass).toBe(def?.mass);
      expect(card?.energy).toBe(def?.energy);
    }
  });

  it('MVR-09 加刻度行**不影响** rear / front 独立装备链路', () => {
    isolateMigrations();
    grantAll();
    let draft: BuildDraft = defaultPlayerDraft();
    const inv = playerInventory(draft);

    const target = OFFICIAL_MOVEMENTS[0];
    const rear = equipMovement('rear', target, draft, inv);
    expect(rear.ok, `rear 装备应成功：${rear.detail ?? ''}`).toBe(true);
    draft = rear.draft as BuildDraft;

    // front 一字未动（仍是「存档里没有这个键」= 缺省轮）
    expect(draft.rearWheelDefId).toBe(target);
    expect('frontWheelDefId' in draft).toBe(false);

    // 刻度量在装备后仍然可读、且与 canonical 一致
    const after = movementReading(draft, inv).cards.find((c) => c.defId === target);
    const def = registry.movements.get(target);
    expect(after?.radius).toBe(def?.radius);
    expect(after?.mass).toBe(def?.mass);
    expect(after?.energy).toBe(def?.energy);

    const front = equipMovement('front', target, draft, inv);
    expect(front.ok).toBe(true);
    expect(front.draft?.rearWheelDefId).toBe(target);
    expect(front.draft?.frontWheelDefId).toBe(target);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R3-MOVEMENT-CARD-READABILITY｜D. 表达纪律（源码守卫）', () => {
  const loadout = strip(readProduct('playerLoadout.ts'));
  const home = strip(readProduct('homePage.ts'));

  it('MVR-10 卡片文案里**没有**推导型属性 / 星级 / 品质（无 %、无 +N%、无 ★、无品质词）', () => {
    isolateMigrations();
    const draft = defaultPlayerDraft();
    const r = movementReading(draft, playerInventory(draft));

    for (const c of r.cards) {
      expect(c.statsText).not.toMatch(/%/);
      expect(c.statsText).not.toMatch(/[★☆]/);
      expect(c.statsText).not.toMatch(/[+＋]\s*\d/);
      for (const banned of ['速度', '稳定', '稀有', '史诗', '传说', '品质', '等级']) {
        expect(c.statsText).not.toContain(banned);
      }
    }
    // statsText 的生成函数里也不许有这些词
    const gen = strip(readProduct('playerLoadout.ts'));
    const body = gen.slice(gen.indexOf('export function movementStatsText'));
    const fnBody = body.slice(0, body.indexOf('\n}\n') + 3);
    for (const banned of ['速度', '稳定', '品质', '稀有', '%', '★']) {
      expect(fnBody).not.toContain(banned);
    }
  });

  it('MVR-11 卡片只画 canonical 的三个刻度字段，不引入第四个（抓地 / 转速 / 扭矩）', () => {
    // 只允许这三个标签名出现在刻度相关代码里；抓地/转速/扭矩不得成为卡片文案。
    for (const banned of ['抓地', '转速', '扭矩', 'driveTorque', 'maxRPM', 'grip']) {
      expect(home).not.toContain(banned);
    }
    // `statsText` 由读数提供 ⇒ 页面里不出现「轮径」字样（页面不自己拼串）
    expect(home).not.toContain('轮径');
    const statsLine = loadout.slice(loadout.indexOf('export const MOVEMENT_STAT_LABELS'));
    const block = statsLine.slice(0, statsLine.indexOf('};'));
    expect(block).toContain('轮径');
    expect(block).toContain('质量');
    expect(block).toContain('能耗');
    for (const banned of ['抓地', '转速', '扭矩']) expect(block).not.toContain(banned);
  });

  it('MVR-12 `movementStatsText` 是纯函数：不读 localStorage / 不写任何存档', () => {
    // 传入一份「伪造」读数 ⇒ 输出必须逐字由入参决定（证明它不是从别处读来的）。
    expect(movementStatsText({ radius: 12, mass: 6, energy: 5 })).toBe('轮径 12 · 质量 6 · 能耗 5');
    expect(movementStatsText({ radius: 26, mass: 14, energy: 12 })).toBe(
      '轮径 26 · 质量 14 · 能耗 12',
    );
    const fn = loadout.slice(loadout.indexOf('export function movementStatsText'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
    expect(body).not.toContain('localStorage');
    expect(body).not.toContain('getItem');
    expect(body).not.toContain('setItem');
    expect(body).not.toContain('registry');
  });

  it('MVR-13 本模块不新增 Movement 类型 / 不改数值（MOVEMENT_STAT_LABELS 之外无第二张数值表）', () => {
    // 刻度数值只可能来自 canonical Def ⇒ 本模块源码里不许出现轮组的数字字面量。
    const entriesSrc = strip(readProduct('movementInventory.ts'));
    // 允许出现的是 `MOVEMENT_STAR = 1`（星级档，既有）；不允许出现 radius/mass/energy 赋值。
    expect(entriesSrc).not.toMatch(/radius:\s*\d/);
    expect(entriesSrc).not.toMatch(/mass:\s*\d/);
    expect(entriesSrc).not.toMatch(/energy:\s*\d/);
    // 且必须仍是**透传**（右侧是读数本身，不是新算的值）
    expect(entriesSrc).toContain('radius: m.radius');
    expect(entriesSrc).toContain('mass: m.mass');
    expect(entriesSrc).toContain('energy: m.energy');
  });

  it('MVR-14 Garage 的 Movement 区只走同一个 equip 写入口，且**不再有二次确认**（本 Queue 删除选中态与独立装备按钮）', () => {
    // 直接装备：点已拥有卡即调用 `equipMovement(...)`，不再有 `selectedMovement` 选中态、
    // 也不再有 `data-ph-action="equip-movement"` 这种二次确认按钮。
    expect(home).not.toContain('selectedMovement');
    expect(home).not.toContain("data-ph-action=\"equip-movement\"");
    expect(home).not.toContain("'equip-movement'");
    // 写入口仍然唯一且是同一个 `equipMovement(...)`（卡片点击直接它）。
    expect(home).toContain('equipMovementAndRender');
    expect(home).toContain('equipMovement(');
    // 本页仍然不碰落盘 / 存档。
    expect(home).not.toContain('savePlayerBuild(');
    expect(home).not.toContain("localStorage.setItem");
    // 刻度行是纯展示：没有独立的点击 / 开关。
    expect(home).not.toContain('ph-movement-stats-action');
    expect(BUILD_KEY).toBe('strongfruit.playerBuild.v1');
  });

  it('MVR-15 **接线守卫**：刻度行确实被画进 Movement 卡片（且带 E2E 对照用的 data 属性）', () => {
    /*
      ⚠️ 这条是**负控制实证**补上的：把 `card.append(el('span','ph-card-stats', ...))`
         整行删掉之后，MVR-01..MVR-14 全绿 —— 因为前 14 条测的是**读数层**
         （`movementReading()` 里有 `statsText`），而「读数有没有真的画到卡上」
         只在浏览器/E2E 层被覆盖。读数正确 ≠ 屏幕上看得见。
      ⇒ 因此在单测层也钉一次**接线**：渲染调用必须存在、用的必须是读数提供的文案
         （不是页面自拼），并且必须挂上 `data-ph-movement-stats` 供 E2E 逐字对账。
    */
    expect(home).toContain("card.append(el('span', 'ph-card-stats', c.statsText))");
    expect(home).toContain("card.dataset['phMovementStats'] = c.statsText");
    // 页面不许自己拼三个数字（拼串只允许在读数层）。
    expect(home).not.toMatch(/ph-card-stats[^\n]*c\.radius/);
    // 三个数值也要能从 DOM 上单独取到（E2E 用它们与 canonical 对账）。
    for (const k of ['phMovementRadius', 'phMovementMass', 'phMovementEnergy']) {
      expect(home).toContain(`card.dataset['${k}']`);
    }
    /*
      渲染必须发生在**卡片循环内**（`for (const c of m.cards)`）—— 否则只会画出最后一张
      或者一张都不画。这里用「渲染行的位置落在 loop 起点之后、卸载项之前」来钉。
    */
    const loopStart = home.indexOf('for (const c of m.cards)');
    const appendAt = home.indexOf("card.append(el('span', 'ph-card-stats', c.statsText))");
    const offCellAt = home.indexOf("const offCell = el('div', 'ph-card-cell')");
    expect(loopStart).toBeGreaterThan(-1);
    expect(appendAt).toBeGreaterThan(loopStart);
    expect(appendAt).toBeLessThan(offCellAt);
  });
});
