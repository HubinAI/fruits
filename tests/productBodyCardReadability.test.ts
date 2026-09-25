/**
 * PRODUCT-LOOP-R4-BODY-CARD-READABILITY｜**车身卡片的刻度量行** targeted 测试。
 *
 * 逐条对应 Queue 的验收：
 *   1 全部 OFFICIAL_BODIES 卡片均展示真实数据      → BG-01 / BG-02 / BG-03
 *   2 数值与 canonical Def 一致                    → BG-04 / BG-05 / BG-06
 *   3 当前装备 / 拥有状态不退化                    → BG-07 / BG-08
 *   4 Body 装备不影响 Weapon / rear / front        → BG-09
 *   5 targeted tests + tsc                         → 本文件（tsc 在门禁里）
 *
 * 本队列自己立的不变量：
 *   - **数值不是第二套常量**：`statsText` 里的每个数都必须在 `registry.bodies` 里
 *     找得到出处，且卡片读数与 canonical Def **逐件逐字段相等**（BG-01 / BG-04）；
 *   - **没有推导型属性 / 星级 / 品质**：卡片文案里不出现 `%` / `+` / `★` / 品质词，
 *     也不出现 canonical 之外的字段名（防御 / 续航 / 抓地）（BG-10 / BG-11）；
 *   - **旧 4 台恒默认拥有走同一套规则**：`watermelonBody` 的卡片同样有三项刻度（BG-03）；
 *   - **纯展示**：加这一行**不改** owned / implicit / equipped / legal / available
 *     （BG-07 / BG-08）。
 *
 * ⚠️ 每个用例开头都会 `isolateMigrations()`（预置三份一次性迁移的标记）：本文件要验的是
 *    **卡片刻度量本身**，不该被 onboarding / reseed / Movement / Body 种子的补件行为干扰。
 *    这是**隔离变量**，不是放宽断言 —— 那几份迁移各自的契约由 `playerGrowthR2A` /
 *    `productReseedR2` / `productMovementChoiceSeed` / `productBodyChoiceSeed` 分别在测。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { DEFAULT_OWNED_BODIES, OFFICIAL_BODIES } from '../src/core/bodyOwnership';
import { markR2Onboarding } from '../src/product/r2Onboarding';
import { markR2Reseed } from '../src/product/r2Reseed';
import { markR3MovementSeed } from '../src/product/r3MovementChoiceSeed';
import { markR4BodySeed } from '../src/product/r4BodyChoiceSeed';
import {
  BODY_STAT_LABELS,
  bodyReading,
  bodyStatsText,
  defaultPlayerDraft,
  equipBody,
} from '../src/product/playerLoadout';
import { canonicalBodies } from '../src/product/runBodyCanonical';
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
const BODY_KEY = 'strongfruit.ownedBodies.v1';

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

/** 预置四份一次性迁移的标记 ⇒ 本文件只观察卡片刻度量本身（隔离变量，非放宽）。 */
function isolateMigrations(): void {
  markR2Onboarding();
  markR2Reseed();
  markR3MovementSeed();
  markR4BodySeed();
}

/** 把一台新增正式车身**真的发到拥有状态里**（走正式落盘，与真实解锁链路同口径）。 */
function grantBody(defId: string): void {
  const owned = JSON.parse(store.getItem(BODY_KEY) ?? '[]') as string[];
  if (!owned.includes(defId)) {
    owned.push(defId);
    store.setItem(BODY_KEY, JSON.stringify(owned));
  }
}

/** 全部新增正式车身都发到手里（真人前提：seed 之后玩家确实拥有新 4 台）。 */
function grantAllNew(): void {
  for (const b of OFFICIAL_BODIES) {
    if (!DEFAULT_OWNED_BODIES.includes(b)) grantBody(b);
  }
}

// ============================================================================
describe('PRODUCT-LOOP-R4-BODY-CARD-READABILITY｜A. 全部正式车身卡都展示真实数据', () => {
  it('BG-01 每张卡片的 hp/baseMass/energyCapacity 与 registry.bodies 逐件逐字段相等', () => {
    isolateMigrations();
    grantAllNew();
    const draft = defaultPlayerDraft();
    const r = bodyReading(draft);

    // 全部 OFFICIAL_BODIES（旧 4 + 新 4）一件不少
    expect(r.cards.length).toBe(OFFICIAL_BODIES.length);
    expect(r.cards.map((c) => c.defId)).toEqual([...OFFICIAL_BODIES]);

    for (const card of r.cards) {
      const def = registry.bodies.get(card.defId);
      expect(def, `${card.defId} 必须在正式内容库里`).toBeTruthy();
      expect(card.hp, `${card.defId}.hp`).toBe(def?.hp);
      expect(card.baseMass, `${card.defId}.baseMass`).toBe(def?.baseMass);
      expect(card.energyCapacity, `${card.defId}.energyCapacity`).toBe(def?.energyCapacity);
    }
  });

  it('BG-02 八台的刻度值互不雷同到「看不出来」（至少在两个维度上有区分度）', () => {
    isolateMigrations();
    grantAllNew();
    const draft = defaultPlayerDraft();
    const r = bodyReading(draft);

    // 玩家要的正是「比较依据」⇒ 若八台三项全等，这个功能就没有意义。
    // 只断言「耐久」与「质量」两个维度各自出现了 ≥2 种取值（有可比性），
    // 不断言谁大谁小（数值平衡不在本 Queue 范围内）。
    const hps = new Set(r.cards.map((c) => c.hp));
    const masses = new Set(r.cards.map((c) => c.baseMass));
    expect(hps.size).toBeGreaterThanOrEqual(2);
    expect(masses.size).toBeGreaterThanOrEqual(2);
  });

  it('BG-03 旧 4 台默认车身（implicit）走**同一套**展示规则：同样有三项刻度', () => {
    isolateMigrations();
    const draft = defaultPlayerDraft();
    const r = bodyReading(draft);
    const implicitCards = r.cards.filter((c) => c.implicit);

    expect(implicitCards.length).toBe(DEFAULT_OWNED_BODIES.length);
    for (const card of implicitCards) {
      // 关键：旧 4 台**不是**「没有刻度」的特例 —— 它的三个数同样来自它的 def。
      const def = registry.bodies.get(card.defId);
      expect(card.owned).toBe(true);
      expect(card.hp).toBe(def?.hp);
      expect(card.baseMass).toBe(def?.baseMass);
      expect(card.energyCapacity).toBe(def?.energyCapacity);
      expect(card.statsText).toBe(bodyStatsText(def as never));
    }
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R4-BODY-CARD-READABILITY｜B. 数值与 canonical Def 一致（同源）', () => {
  it('BG-04 statsText 里出现的每个数字都能在 canonical 字段里找到出处', () => {
    isolateMigrations();
    grantAllNew();
    const draft = defaultPlayerDraft();
    const r = bodyReading(draft);

    for (const card of r.cards) {
      const nums = (card.statsText.match(/\d+/g) ?? []).map(Number);
      // 恰好三个数，且顺序 = 耐久 / 质量 / 能量容量
      expect(nums, `${card.defId} statsText=${card.statsText}`).toEqual([
        card.hp,
        card.baseMass,
        card.energyCapacity,
      ]);
    }
  });

  it('BG-05 卡片读数与 canonicalBodies() 是**同一份**（不是页面 / 本模块自己造的表）', () => {
    isolateMigrations();
    grantAllNew();
    const draft = defaultPlayerDraft();
    const cards = bodyReading(draft).cards;
    const canonical = canonicalBodies();

    // 逐件对账：defId 集合相同 + 三个数值逐个相等。
    expect(cards.map((c) => c.defId)).toEqual(canonical.map((b) => b.defId));
    for (const b of canonical) {
      const card = cards.find((c) => c.defId === b.defId);
      expect(card?.hp).toBe(b.hp);
      expect(card?.baseMass).toBe(b.baseMass);
      expect(card?.energyCapacity).toBe(b.energyCapacity);
      expect(card?.statsText).toBe(bodyStatsText(b));
    }
  });

  it('BG-06 卡片刻度直接透出三个字段（与 Run 侧进物理的同一份真源）', () => {
    isolateMigrations();
    grantAllNew();
    const draft = defaultPlayerDraft();
    const r = bodyReading(draft);

    for (const card of r.cards) {
      const def = registry.bodies.get(card.defId);
      expect(card.hp).toBe(def?.hp);
      expect(card.baseMass).toBe(def?.baseMass);
      expect(card.energyCapacity).toBe(def?.energyCapacity);
    }
  });

  it('BG-06b statsText 的标签是三个指定词（耐久 / 质量 / 能量容量），不引入第四个字段名', () => {
    isolateMigrations();
    const draft = defaultPlayerDraft();
    const card = bodyReading(draft).cards[0];
    expect(card.statsText).toContain(`耐久 ${card.hp}`);
    expect(card.statsText).toContain(`质量 ${card.baseMass}`);
    expect(card.statsText).toContain(`能量容量 ${card.energyCapacity}`);
    expect(Object.keys(BODY_STAT_LABELS).sort()).toEqual(['baseMass', 'energyCapacity', 'hp']);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R4-BODY-CARD-READABILITY｜C. 拥有 / 装备状态不退化', () => {
  it('BG-07 加刻度行**不改变** owned / implicit / equipped / legal / available', () => {
    isolateMigrations();
    grantAllNew();
    const draft = defaultPlayerDraft();
    const r = bodyReading(draft);

    // 旧 4 恒拥有（implicit），新 4 经 seed 拥有（非 implicit）；当前装的是缺省西瓜。
    for (const c of r.cards) {
      expect(c.owned).toBe(true);
      const isDefault = DEFAULT_OWNED_BODIES.includes(c.defId);
      expect(c.implicit).toBe(isDefault);
    }
    expect(r.available.length).toBe(OFFICIAL_BODIES.length);
    expect(r.legal).toBe(true);
    expect(r.equippedDefIds).toEqual([draft.bodyDefId]);
  });

  it('BG-08 未拥有时卡片**照样有**刻度（如实展示，不是「没拥有就没数据」）', () => {
    isolateMigrations();
    // 刻意一件新增车身都不发 ⇒ 新 4 台都未拥有（旧 4 恒默认拥有不受影响）
    const draft = defaultPlayerDraft();
    const r = bodyReading(draft);

    for (const b of OFFICIAL_BODIES) {
      const card = r.cards.find((c) => c.defId === b);
      expect(card?.owned).toBe(DEFAULT_OWNED_BODIES.includes(b));
      // 关键：未拥有**不影响**数值展示 —— 玩家正是靠它来决定「想不想要」。
      const def = registry.bodies.get(b);
      expect(card?.hp).toBe(def?.hp);
      expect(card?.baseMass).toBe(def?.baseMass);
      expect(card?.energyCapacity).toBe(def?.energyCapacity);
    }
  });

  it('BG-09 换车身**不影响** Weapon / rear / front 独立装备链路（结构分离）', () => {
    isolateMigrations();
    grantAllNew();
    const draft = defaultPlayerDraft();
    const weaponBefore = draft.functionalSelections;
    const rearBefore = draft.rearWheelDefId;
    const frontBefore = draft.frontWheelDefId;

    const target = 'durianBody';
    const out = equipBody(target, draft);
    expect(out.ok, `车身装备应成功：${out.detail ?? ''}`).toBe(true);
    const next = out.draft as BuildDraft;

    // ① 车身真的换了
    expect(next.bodyDefId).toBe(target);
    // ② Weapon 槽一字未动
    expect(next.functionalSelections).toEqual(weaponBefore);
    // ③ rear / front Movement 一字未动
    expect(next.rearWheelDefId).toBe(rearBefore);
    expect(next.frontWheelDefId).toBe(frontBefore);
    // ④ 刻度量在装备后仍然可读、且与 canonical 一致
    const after = bodyReading(next).cards.find((c) => c.defId === target);
    const def = registry.bodies.get(target);
    expect(after?.hp).toBe(def?.hp);
    expect(after?.baseMass).toBe(def?.baseMass);
    expect(after?.energyCapacity).toBe(def?.energyCapacity);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R4-BODY-CARD-READABILITY｜D. 表达纪律（源码守卫）', () => {
  const loadout = strip(readProduct('playerLoadout.ts'));
  const home = strip(readProduct('homePage.ts'));

  it('BG-10 卡片文案里**没有**推导型属性 / 星级 / 品质（无 %、无 +N%、无 ★、无品质词）', () => {
    isolateMigrations();
    grantAllNew();
    const draft = defaultPlayerDraft();
    const r = bodyReading(draft);

    for (const c of r.cards) {
      expect(c.statsText).not.toMatch(/%/);
      expect(c.statsText).not.toMatch(/[★☆]/);
      expect(c.statsText).not.toMatch(/[+＋]\s*\d/);
      for (const banned of ['防御', '续航', '速度', '稳定', '稀有', '史诗', '传说', '品质', '等级']) {
        expect(c.statsText).not.toContain(banned);
      }
    }
    // statsText 的生成函数里也不许有这些词
    const gen = strip(readProduct('playerLoadout.ts'));
    const body = gen.slice(gen.indexOf('export function bodyStatsText'));
    const fnBody = body.slice(0, body.indexOf('\n}\n') + 3);
    for (const banned of ['防御', '续航', '品质', '稀有', '%', '★', '速度', '稳定']) {
      expect(fnBody).not.toContain(banned);
    }
  });

  it('BG-11 卡片只画 canonical 的三个刻度字段，不引入第四个（防御 / 续航 / 抓地）', () => {
    // 只允许这三个标签名出现在刻度相关代码里；防御/续航/抓地不得成为卡片文案。
    for (const banned of ['防御', '续航', '抓地', '护甲', 'drivetorque']) {
      expect(home).not.toContain(banned);
    }
    // `statsText` 由读数提供 ⇒ Body 渲染处不自己拼三个数字（拼串只允许在读数层）。
    // 用 Body 区独有 data 属性 `phBodyStats` 定位：它右侧必须是读数提供的 c.statsText。
    const statsDecl = home.indexOf("card.dataset['phBodyStats'] = c.statsText");
    expect(statsDecl, 'Body 卡片必须挂 phBodyStats（= 读数提供的 statsText）').toBeGreaterThan(-1);
    // 页面不得自己拼 `${c.hp}` 之类的串
    expect(home).not.toMatch(/ph-card-stats[^\n]*c\.hp/);
    expect(home).not.toMatch(/ph-card-stats[^\n]*c\.baseMass/);
    expect(home).not.toMatch(/ph-card-stats[^\n]*c\.energyCapacity/);
    const statsLine = loadout.slice(loadout.indexOf('export const BODY_STAT_LABELS'));
    const block = statsLine.slice(0, statsLine.indexOf('};'));
    expect(block).toContain('耐久');
    expect(block).toContain('质量');
    expect(block).toContain('能量容量');
    for (const banned of ['防御', '续航', '抓地']) expect(block).not.toContain(banned);
  });

  it('BG-12 `bodyStatsText` 是纯函数：不读 localStorage / 不写任何存档', () => {
    // 传入一份「伪造」读数 ⇒ 输出必须逐字由入参决定（证明它不是从别处读来的）。
    expect(bodyStatsText({ hp: 1100, baseMass: 120, energyCapacity: 110 })).toBe(
      '耐久 1100 · 质量 120 · 能量容量 110',
    );
    expect(bodyStatsText({ hp: 900, baseMass: 45, energyCapacity: 90 })).toBe(
      '耐久 900 · 质量 45 · 能量容量 90',
    );
    const fn = loadout.slice(loadout.indexOf('export function bodyStatsText'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
    expect(body).not.toContain('localStorage');
    expect(body).not.toContain('getItem');
    expect(body).not.toContain('setItem');
    expect(body).not.toContain('registry');
  });

  it('BG-13 本模块不新增 Body 类型 / 不改数值（bodyInventory 之外无第二张数值表）', () => {
    // 刻度数值只可能来自 canonical Def ⇒ 本模块源码里不许出现车身的数字字面量。
    const entriesSrc = strip(readProduct('bodyInventory.ts'));
    expect(entriesSrc).not.toMatch(/hp:\s*\d/);
    expect(entriesSrc).not.toMatch(/baseMass:\s*\d/);
    expect(entriesSrc).not.toMatch(/energyCapacity:\s*\d/);
    // 且必须仍是**透传**（右侧是读数本身，不是新算的值）
    expect(entriesSrc).toContain('hp: def.hp');
    expect(entriesSrc).toContain('baseMass: def.baseMass');
    expect(entriesSrc).toContain('energyCapacity: def.energyCapacity');
  });

  it('BG-14 Garage 的 Body 区只走同一个 equip 写入口，且**无二次确认**（直接装备）', () => {
    // 直接装备：点已拥有卡即调用 `equipBody(...)`，没有选中态、没有独立装备按钮。
    expect(home).not.toContain('selectedBody');
    expect(home).not.toContain("data-ph-action=\"equip-body\"");
    expect(home).not.toContain("'equip-body'");
    // 写入口仍然唯一且是同一个 `equipBody(...)`（卡片点击直接它）。
    expect(home).toContain('equipBodyAndRender');
    expect(home).toContain('equipBody(');
    // 本页仍然不碰落盘 / 存档。
    expect(home).not.toContain('savePlayerBuild(');
    expect(home).not.toContain("localStorage.setItem");
    // 刻度行是纯展示：没有独立的点击 / 开关。
    expect(home).not.toContain('ph-body-stats-action');
    expect(BUILD_KEY).toBe('strongfruit.playerBuild.v1');
  });

  it('BG-15 **接线守卫**：刻度行确实被画进 Body 卡片（且带 E2E 对照用的 data 属性）', () => {
    /*
      ⚠️ 这条是**负控制实证**补上的：把 `card.append(el('span','ph-card-stats', ...))`
         整行删掉之后，BG-01..BG-14 全绿 —— 因为前 14 条测的是**读数层**
         （`bodyReading()` 里有 `statsText`），而「读数有没有真的画到卡上」
         只在浏览器/E2E 层被覆盖。读数正确 ≠ 屏幕上看得见。
      ⇒ 因此在单测层也钉一次**接线**：渲染调用必须存在、用的必须是读数提供的文案
         （不是页面自拼），并且必须挂上 `data-ph-body-stats` 供 E2E 逐字对账。
    */
    // 用 Body 区**独有**的 data 属性定位（Movement 区是 phMovementStats，这里是 phBodyStats）
    expect(home).toContain("card.dataset['phBodyStats'] = c.statsText");
    // 三个数值也要能从 DOM 上单独取到（E2E 用它们与 canonical 对账）。
    for (const k of ['phBodyHp', 'phBodyMass', 'phBodyEnergy']) {
      expect(home).toContain(`card.dataset['${k}']`);
    }
    /*
      渲染必须发生在**Body 卡片循环内**（`for (const c of b.cards)`）—— 否则只会画出
      最后一张或者一张都不画。这里用「Body 循环起点 < phBodyStats 赋值 < 刻度 append」
      的相对位置来钉（三者都在 renderBodySection 的卡片循环内）。
      注意：`card.append(el('span','ph-card-stats', ...))` 在 Movement 区也有同款，
      所以必须用 Body 区独有锚点 `phBodyStats` 来定位，不能直接 indexOf append 行。
    */
    const loopStart = home.indexOf('for (const c of b.cards)');
    const statsAt = home.indexOf("card.dataset['phBodyStats'] = c.statsText");
    // 刻度 append 行取「phBodyStats 之后」第一次出现的那一个（Body 区的）
    const appendAt = home.indexOf("card.append(el('span', 'ph-card-stats', c.statsText))", statsAt);
    expect(loopStart).toBeGreaterThan(-1);
    expect(statsAt).toBeGreaterThan(loopStart);
    expect(appendAt, 'Body 区必须有刻度 append').toBeGreaterThan(statsAt);
  });
});
