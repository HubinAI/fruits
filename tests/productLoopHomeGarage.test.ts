/**
 * PRODUCT-LOOP-R1-A-HOME-GARAGE-INVENTORY｜正式产品主循环第一段（首页 / 调整战车）targeted 测试。
 *
 * 覆盖 Queue 的七条技术验收：
 *   1/2/3/4 行为（装备 → 首页同步 → 返回 / 重载后一致）；
 *   5       没有重复生成 Inventory；
 *   6       当前装备存在唯一数据源（正式 `strongfruit.playerBuild.v1`）；
 *   7       （tsc / build / smoke 在门禁里跑，本文件负责结构与数据契约）
 *
 * 另加源码守卫：本 Queue 的边界（不新建 Runtime、不新增武器定义、
 * Run 强化不得伪装成永久装备、不碰 Run）必须能在源码层面被钉死。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EMPTY_SLOT, makeStarterDraft, type BuildDraft } from '../src/lab/buildEditorModel';
import { registry } from '../src/core/content';
import {
  MVP_MIN_WEAPONS,
  PLAYER_BODY_DEF_ID,
  WEAPON_SLOT,
  defaultPlayerDraft,
  equipWeapon,
  equippedWeaponId,
  isWeaponDefId,
  loadEquippedDraft,
  loadoutReading,
  playerInventory,
  weaponDefs,
  weaponEntries,
} from '../src/product/playerLoadout';
import {
  PREVIEW_FIT_W,
  PREVIEW_MAX_H,
  PREVIEW_SPRITE_IDS,
  vehiclePreviewLayout,
} from '../src/product/vehiclePreview';
import { SAVE_KEY as PAGE_SAVE_KEY } from '../src/product/homePage';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT_DIR = join(REPO_ROOT, 'src', 'product');
const PRODUCT_FILES = readdirSync(PRODUCT_DIR).filter((f) => f.endsWith('.ts'));

function readProduct(f: string): string {
  return readFileSync(join(PRODUCT_DIR, f), 'utf8');
}
/** 源码守卫必须先剥注释（本项目铁律：注释里的自指文字会骗过字符串匹配）。 */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function importSpecifiers(src: string): string[] {
  const out: string[] = [];
  // 同时捕获 `import ... from 'x'` 与裸副作用 import（`import 'x'`）—— 边界守卫不得漏后者
  const re = /from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1] ?? m[2]);
  return out;
}

/** 内存版 localStorage（node 无原生；与既有库存测试同一模式） */
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

// ============================================================================
describe('PRODUCT-LOOP-R1-A｜A. 唯一数据源（复用正式存档，不新建）', () => {
  it('PL-01 装备真的落在正式玩家 Build 存档 key 上（不是页面自建 key）', () => {
    const draft = defaultPlayerDraft();
    const inv = playerInventory(draft);
    expect(store.getItem(PAGE_SAVE_KEY)).toBeNull(); // 装备前还没有这份存档
    expect(allKeys()).toEqual(['strongfruit.ownedParts.v2']);

    const out = equipWeapon('hammer', draft, inv);
    expect(out.ok).toBe(true);
    expect(store.getItem(PAGE_SAVE_KEY)).not.toBeNull(); // 装配动作写进了正式 key
    expect(allKeys()).toEqual(['strongfruit.ownedParts.v2', 'strongfruit.playerBuild.v1']);
  });

  it('PL-02 自己不起第二套存储：不碰 platform.storage / localStorage / 自建 STORAGE_KEY', () => {
    const code = strip(readProduct('playerLoadout.ts'));
    expect(code.includes('localStorage')).toBe(false);
    expect(code.includes('platform')).toBe(false);
    expect(code.includes('STORAGE_KEY')).toBe(false);
    // 必须走正式持久化模块（而不是自己读写）
    expect(code.includes("from '../core/buildPersistence'")).toBe(true);
    expect(code.includes("from '../core/partInventory'")).toBe(true);
  });

  it('PL-03 写只发生在 savePlayerBuild 一处（本模块没有第二个落盘点）', () => {
    const code = strip(readProduct('playerLoadout.ts'));
    expect(code.split('savePlayerBuild(').length - 1).toBe(1);
    expect(code.includes('writeFile')).toBe(false);
  });

  it('PL-04 装备 → 存档 → 重读：Build 就是装备后的那一份（首页/调整战车同一来源）', () => {
    const draft = defaultPlayerDraft();
    const inv = playerInventory(draft);
    expect(loadEquippedDraft().functionalSelections[WEAPON_SLOT]).toBe('cannon');

    const out = equipWeapon('hammer', draft, inv);
    expect(out.ok).toBe(true);
    expect(loadEquippedDraft().functionalSelections[WEAPON_SLOT]).toBe('hammer');
  });

  it('PL-05 库存只走正式 ensureInventory：反复调用不新增任何 storage key（验收 5）', () => {
    const draft = defaultPlayerDraft();
    playerInventory(draft);
    const keysAfterFirst = allKeys();
    expect(keysAfterFirst).toEqual(['strongfruit.ownedParts.v2']);

    const a = playerInventory(draft);
    const b = playerInventory(draft);
    expect(allKeys()).toEqual(keysAfterFirst); // 不新增 key ⇒ 没有第二套库存
    expect(JSON.stringify(b)).toBe(JSON.stringify(a)); // 内容也不变
  });

  it('PL-06 装备后全库只有两个正式 key，绝无重复库存（验收 5 + 6）', () => {
    const draft = defaultPlayerDraft();
    const inv = playerInventory(draft);
    equipWeapon('hammer', draft, inv);
    expect(allKeys()).toEqual(['strongfruit.ownedParts.v2', 'strongfruit.playerBuild.v1'].sort());
    expect(allKeys().filter((k) => k.startsWith('strongfruit.ownedParts'))).toHaveLength(1);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R1-A｜B. 武器只来自正式定义（不新增、Run 强化不得混入）', () => {
  it('PL-07 武器清单 = registry.functionals 的 category==="weapon"（零自建清单）', () => {
    const expected = [...registry.functionals.values()]
      .filter((d) => d.category === 'weapon')
      .map((d) => d.id)
      .sort();
    expect(weaponDefs().map((d) => d.id).sort()).toEqual(expected);
    expect(weaponDefs().length).toBeGreaterThan(0);
  });

  it('PL-08 ⚠️ Run 强化（heavyShell / twinCannon / fastReload）不是武器 ⇒ 结构上装不上（必改 2）', () => {
    for (const runBuff of ['heavyShell', 'twinCannon', 'fastReload']) {
      expect(registry.functionals.get(runBuff), `${runBuff} 不得存在于正式部件库`).toBeUndefined();
      expect(isWeaponDefId(runBuff)).toBe(false);
      const out = equipWeapon(runBuff, defaultPlayerDraft());
      expect(out.ok).toBe(false);
      expect(out.reason).toBe('not-weapon');
    }
  });

  it('PL-09 源码层也分离：产品页/数据层不出现 Run 强化 id（剥注释后 0 命中）', () => {
    for (const f of ['playerLoadout.ts', 'vehiclePreview.ts', 'homePage.ts']) {
      const code = strip(readProduct(f));
      for (const runBuff of ['heavyShell', 'twinCannon', 'fastReload', 'runModifiers']) {
        expect(code.includes(runBuff), `${f} 不得引用 ${runBuff}`).toBe(false);
      }
    }
  });

  it('PL-10 MVP 初始库存天然满足「至少两个已有 Weapon」：默认存档即可切换（验收 2）', () => {
    const draft = defaultPlayerDraft();
    const inv = playerInventory(draft);
    const weapons = weaponEntries(inv);
    expect(weapons.length).toBeGreaterThanOrEqual(MVP_MIN_WEAPONS);
    // 全部来自正式定义 + 真实库存，没有凭空造件
    for (const w of weapons) {
      expect(isWeaponDefId(w.defId)).toBe(true);
      expect(w.count).toBeGreaterThan(0);
    }
    expect(weapons.map((w) => w.defId)).toContain('cannon');
    expect(weapons.map((w) => w.defId)).toContain('hammer');
  });

  it('PL-11 未拥有的正式武器装不上（not-owned），且零副作用（存档不变）', () => {
    const draft = defaultPlayerDraft();
    const inv = playerInventory(draft);
    const before = JSON.stringify(loadEquippedDraft());
    const out = equipWeapon('machineGun', draft, inv);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('not-owned');
    expect(out.draft).toBeUndefined();
    expect(JSON.stringify(loadEquippedDraft())).toBe(before);
  });

  it('PL-12 空槽 / 非武器 id 被拒（not-weapon），存档不变', () => {
    const draft = defaultPlayerDraft();
    const before = JSON.stringify(loadEquippedDraft());
    for (const bad of [EMPTY_SLOT, 'pushRod', 'noSuchPart']) {
      const out = equipWeapon(bad, draft, playerInventory(draft));
      expect(out.ok, `${bad} 不应被装备`).toBe(false);
      expect(out.reason).toBe('not-weapon');
    }
    expect(JSON.stringify(loadEquippedDraft())).toBe(before);
  });

  it('PL-13 车身没有该挂点 → unknown-slot 拒绝（防 Body 变更后写非法槽）', () => {
    const broken: BuildDraft = { ...defaultPlayerDraft(), bodyDefId: 'noSuchBody' };
    const out = equipWeapon('cannon', broken, playerInventory(defaultPlayerDraft()));
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('unknown-slot');
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R1-A｜C. 装备行为与状态一致（验收 2/3/4）', () => {
  it('PL-14 默认主武器 = starter 在该槽装的东西（西瓜车身 / 炮），不是写死的常量', () => {
    const starter = makeStarterDraft(PLAYER_BODY_DEF_ID, registry);
    expect(equippedWeaponId(starter)).toBe(starter.functionalSelections[WEAPON_SLOT]);
    expect(equippedWeaponId(defaultPlayerDraft())).toBe('cannon');
    expect(PLAYER_BODY_DEF_ID).toBe('watermelonBody');
  });

  it('PL-15 装备另一件武器：只改 Weapon 槽，其它槽位一字不动', () => {
    const draft = defaultPlayerDraft();
    const out = equipWeapon('spear', draft, playerInventory(draft));
    expect(out.ok).toBe(true);
    const next = out.draft!;
    expect(next.functionalSelections[WEAPON_SLOT]).toBe('spear');
    for (const [hp, v] of Object.entries(draft.functionalSelections)) {
      if (hp === WEAPON_SLOT) continue;
      expect(next.functionalSelections[hp], `槽位 ${hp} 不得被动`).toBe(v);
    }
  });

  it('PL-16 装备后的 Build 仍过正式校验（不会写出一个读不回来的存档）', () => {
    const draft = defaultPlayerDraft();
    const out = equipWeapon('hammer', draft, playerInventory(draft));
    expect(out.ok).toBe(true);
    // 生效证据：正式读入口能把它读回来（loadPlayerBuild 内部含 validateSnapshot）
    const back = loadEquippedDraft();
    expect(back.functionalSelections[WEAPON_SLOT]).toBe('hammer');
    const r = loadoutReading(back, playerInventory(back));
    expect(r.equippedWeaponId).toBe('hammer');
    expect(r.equippedWeaponName).toBe('锤');
  });

  it('PL-17 首页读数实时跟随装备状态（显示什么 = 下一局准备用什么）', () => {
    const draft = defaultPlayerDraft();
    const inv = playerInventory(draft);
    expect(loadoutReading(draft, inv).equippedWeaponName).toBe('炮');

    const out = equipWeapon('spear', draft, inv);
    const r = loadoutReading(out.draft!, playerInventory(out.draft!));
    expect(r.equippedWeaponName).toBe('刺');
    expect(r.weaponSlot).toBe(WEAPON_SLOT);
    // 槽位读数里也只有 Weapon 槽标 editable（必改 1：只打通一个槽）
    expect(r.slots.filter((s) => s.editable)).toHaveLength(1);
    expect(r.slots.find((s) => s.editable)?.hardpointId).toBe(WEAPON_SLOT);
  });

  it('PL-18 四次来回切换后，最后一次装备就是最终状态（可重复验证）', () => {
    let draft = defaultPlayerDraft();
    for (const id of ['hammer', 'spear', 'cannon', 'hammer']) {
      const out = equipWeapon(id, draft, playerInventory(draft));
      expect(out.ok).toBe(true);
      draft = out.draft!;
    }
    expect(loadEquippedDraft().functionalSelections[WEAPON_SLOT]).toBe('hammer');
    expect(allKeys()).toEqual(['strongfruit.ownedParts.v2', 'strongfruit.playerBuild.v1'].sort());
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R1-A｜D. 战车预览几何（正式视觉定义，不伪造外形）', () => {
  it('PL-19 sprite 白名单 = assets/visuals 里真实存在的 PNG（防止死配置）', () => {
    const onDisk = readdirSync(join(REPO_ROOT, 'assets', 'visuals'))
      .filter((f) => f.endsWith('.png'))
      .map((f) => f.replace(/\.png$/, ''))
      .sort();
    expect([...PREVIEW_SPRITE_IDS].sort()).toEqual(onDisk);
  });

  it('PL-20 预览件 = 车身 + 两个轮 + 三个已装件；主武器槽恰一个（高亮唯一）', () => {
    const layout = vehiclePreviewLayout(defaultPlayerDraft());
    expect(layout.items.filter((i) => i.kind === 'body')).toHaveLength(1);
    expect(layout.items.filter((i) => i.kind === 'wheel')).toHaveLength(2);
    expect(layout.items.filter((i) => i.kind === 'part')).toHaveLength(3);
    const weaponItems = layout.items.filter((i) => i.onWeaponSlot);
    expect(weaponItems).toHaveLength(1);
    expect(weaponItems[0].defId).toBe('cannon');
    expect(layout.bodyName).toBe('西瓜车身');
  });

  it('PL-21 装备后预览真的换件（同一槽位的 defId 跟着变）', () => {
    const before = vehiclePreviewLayout(defaultPlayerDraft());
    const out = equipWeapon('spear', defaultPlayerDraft(), playerInventory(defaultPlayerDraft()));
    const after = vehiclePreviewLayout(out.draft!);
    expect(before.items.find((i) => i.onWeaponSlot)?.defId).toBe('cannon');
    expect(after.items.find((i) => i.onWeaponSlot)?.defId).toBe('spear');
  });

  it('PL-22 无正式视觉的件如实标 visualId=null（按真实 Collider 外接框，不猜外形）', () => {
    const draft: BuildDraft = {
      ...defaultPlayerDraft(),
      functionalSelections: { ...defaultPlayerDraft().functionalSelections, [WEAPON_SLOT]: 'spear' },
    };
    const layout = vehiclePreviewLayout(draft);
    const spear = layout.items.find((i) => i.onWeaponSlot)!;
    expect(spear.visualId).toBeNull();
    expect(spear.name).toBe('刺');
    // 外接框必须能由正式 Collider 的**真实数据**反推（不是写死常量）
    const def = registry.functionals.get('spear')!;
    const xs = (def.collider.vertices ?? []).map((v) => v.x);
    const ys = (def.collider.vertices ?? []).map((v) => v.y);
    expect(spear.w).toBe(Math.max(...xs) - Math.min(...xs));
    expect(spear.h).toBe(Math.max(...ys) - Math.min(...ys));
    expect(spear.w).toBeGreaterThan(0);
    expect(spear.h).toBeGreaterThan(0);
    // 默认 Build 的两个轮子没有 sprite（正式库无轮组 PNG）⇒ 回退件恰为 2 轮 + 1 刺
    expect(layout.items.filter((i) => i.visualId === null)).toHaveLength(3);
  });

  it('PL-23 缩放不越界：横向 ≤ 目标宽、纵向 ≤ 最大高（放不下也不强撑）', () => {
    for (const w of ['cannon', 'hammer', 'spear'] as const) {
      const draft: BuildDraft = {
        ...defaultPlayerDraft(),
        functionalSelections: { ...defaultPlayerDraft().functionalSelections, [WEAPON_SLOT]: w },
      };
      const l = vehiclePreviewLayout(draft);
      const nativeW = l.maxX - l.minX;
      const nativeH = l.maxY - l.minY;
      expect(l.scale * nativeW).toBeLessThanOrEqual(PREVIEW_FIT_W + 1e-9);
      expect(l.scale * nativeH).toBeLessThanOrEqual(PREVIEW_MAX_H + 1e-9);
      expect(l.scale).toBeGreaterThan(0);
      expect(l.stageW).toBe(390);
    }
  });

  it('PL-24 坐标口径 = 车体本地坐标（y 向上，与物理一致）；翻转只发生在视图层', () => {
    const layout = vehiclePreviewLayout(defaultPlayerDraft());
    // 轮子中心直接用 movementHardpoint.localPosition → 西瓜车身 y = +25（向上为正）
    for (const wheelItem of layout.items.filter((i) => i.kind === 'wheel')) {
      expect(wheelItem.cy).toBe(25);
    }
    // 视图层负责 DOM 的 y 翻转（本模块不做屏幕换算）
    const code = strip(readProduct('homePage.ts'));
    expect(code.includes('-(it.cy - by)')).toBe(true);
    expect(strip(readProduct('vehiclePreview.ts')).includes('innerHeight')).toBe(false);
  });

  it('PL-25 未知车身 → 空布局（不崩、不伪造）', () => {
    const layout = vehiclePreviewLayout({ ...defaultPlayerDraft(), bodyDefId: 'noSuchBody' });
    expect(layout.items).toEqual([]);
  });
});

// ============================================================================
describe('PRODUCT-LOOP-R1-A｜E. 源码守卫（边界与冻结项）', () => {
  it('PL-26 产品层只复用正式数据层：import 白名单是闭集且全部命中', () => {
    const allow: Record<string, string[]> = {
      'playerLoadout.ts': [
        '../core/content',
        '../core/buildValidator',
        '../core/buildPersistence',
        '../core/partInventory',
        '../core/types',
        '../lab/buildEditorModel',
      ],
      'vehiclePreview.ts': [
        '../core/content',
        '../core/types',
        '../lab/buildEditorModel',
        './playerLoadout',
      ],
      // PRODUCT-LOOP-R1-B：Profile Repository（唯一写持久化状态的地方）
      'playerProfile.ts': [
        '../core/buildValidator',
        '../core/content',
        '../core/partInventory',
        '../core/saveVersion',
        '../lab/buildEditorModel',
        '../platform',
        './playerLoadout',
        './runReward',
      ],
      // PRODUCT-LOOP-R1-B：奖励策略 + 产品地址唯一真源（只读内容库取展示名）
      'runReward.ts': ['../core/content'],
    };
    for (const [file, list] of Object.entries(allow)) {
      const specs = importSpecifiers(readProduct(file)).sort();
      expect(specs, `${file} 的 import 必须落在白名单内`).toEqual([...list].sort());
    }
    // homePage.ts：多出平台 bootstrap（产品页需要绑定 PlatformCore）与 5 张正式 PNG
    const pageSpecs = importSpecifiers(readProduct('homePage.ts'));
    for (const s of pageSpecs) {
      if (s.startsWith('../../assets/visuals/')) continue;
      expect(
        [
          '../platform/bootstrap',
          '../lab/buildEditorModel',
          '../core/partInventory',
          './playerLoadout',
          './vehiclePreview',
          './runReward',
          './playerProfile',
        ],
        `homePage.ts 不得 import "${s}"`,
      ).toContain(s);
    }
    expect(pageSpecs.filter((s) => s.startsWith('../../assets/visuals/')).length).toBe(5);
    // 入口壳只允许 import 页面模块本身（不自造第二套页面逻辑）
    expect(importSpecifiers(readProduct('homeMain.ts'))).toEqual(['./homePage']);
  });

  it('PL-27 不新建 Runtime / 不碰 Run：产品层 0 引用战斗 / 渲染 / Run 模块', () => {
    for (const f of PRODUCT_FILES) {
      const code = strip(readProduct(f));
      for (const banned of [
        'planckBattleOrchestrator',
        'runBattleRuntime',
        'runPage',
        'runScript',
        'contactRouter',
        'damageResolver',
        'playerGameRuntime',
        'canvasPlayerUIHost',
        'renderer',
      ]) {
        expect(code.includes(banned), `${f} 不得引用 ${banned}`).toBe(false);
      }
    }
  });

  it('PL-28 产品层不引用 debug lab（反向隔离：可整块删除 lab 不影响产品页）', () => {
    for (const f of PRODUCT_FILES) {
      const src = readProduct(f);
      expect(src.includes('portraitBattleLab'), `${f} 不得引用 portraitBattleLab`).toBe(false);
      expect(src.includes('portrait-lab'), `${f} 不得引用 portrait-lab`).toBe(false);
    }
  });

  it('PL-29 页面零画布、不做整页跳转逻辑（`开始冒险` 只是同产物内的相对链接）', () => {
    const code = strip(readProduct('homePage.ts'));
    // 零画布：不获取 2d context、不创建 canvas；探针只是**统计**页面里有没有 canvas
    expect(code.includes('getContext')).toBe(false);
    expect(code.includes("createElement('canvas')")).toBe(false);
    expect(code.includes("querySelectorAll('canvas')")).toBe(true);
    for (const banned of ['location.href', 'window.open', 'history.pushState', 'location.assign']) {
      expect(code.includes(banned), `不得使用 ${banned}`).toBe(false);
    }
    /*
      PRODUCT-LOOP-R1-B：`开始冒险` 的地址**不再是页面里的字面量** ——
      它由 `runReward.ts` 的 `buildAdventureHref()` 产出（带本局 token / 奖励 / 回程地址），
      产品 URL 只在那一个模块里出现一次。这里是「单一真源」的双向断言：
      页面**不含**地址字面量，且页面**真的**用了那个构造函数。
    */
    expect(code.includes("'./run-page.html'"), '地址真源必须只在 runReward.ts').toBe(false);
    expect(code.includes('buildAdventureHref(')).toBe(true);
    const reward = strip(readProduct('runReward.ts'));
    expect(reward.includes("'./run-page.html'")).toBe(true);
    expect(reward.split("'./run-page.html'").length - 1, '产品地址在真源里只能出现一次').toBe(1);
  });

  it('PL-30 首页 / 调整战车是同一页面的两个视图（零跳转，与既有玩家页面结构一致）', () => {
    const code = strip(readProduct('homePage.ts'));
    expect(code.includes("export type ProductView = 'home' | 'garage'")).toBe(true);
    expect(code.includes('if (view === \'home\') renderHome(r);')).toBe(true);
    expect(code.includes('else renderGarage(r);')).toBe(true);
    // 控件标识走 dataset（不是硬写 attribute 字符串）
    expect(code.includes("dataset['phAction']")).toBe(true);
    expect(code.includes("'open-garage'")).toBe(true);
    expect(code.includes("'back-home'")).toBe(true);
  });

  it('PL-31 构建与脚本接线：home.html 进竖屏产品构建 + dev/e2e script，正式构建 0 引用', () => {
    const cfg = readFileSync(join(REPO_ROOT, 'vite.portrait-lab.config.ts'), 'utf8');
    expect(cfg.includes("'home': 'home.html'")).toBe(true);

    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['dev:home']).toBe('vite --open=/home.html');
    expect(pkg.scripts['e2e:product-home']).toBe('node tests/_e2e_product_home.cjs');
    // PRODUCT-LOOP-R1-B：领奖闭环的浏览器端 E2E（同一份竖屏产物，无新增页面 / 无新增构建配置）
    expect(pkg.scripts['e2e:product-reward']).toBe('node tests/_e2e_product_reward.cjs');

    for (const t of ['index.html', 'vite.config.ts', 'vite.pages.config.ts', 'vite.e2e.config.ts', 'vite.wechat.config.ts']) {
      const src = strip(readFileSync(join(REPO_ROOT, t), 'utf8'));
      expect(src.includes('home.html'), `${t} 不得引用 home.html`).toBe(false);
      expect(src.includes('src/product'), `${t} 不得引用 src/product`).toBe(false);
    }
  });

  it('PL-32 entry HTML 就是产品入口：竖屏舞台 + 唯一容器 + 零 lab 字面量', () => {
    const html = readFileSync(join(REPO_ROOT, 'home.html'), 'utf8');
    expect(html.includes('id="ph-root"')).toBe(true);
    expect(html.includes('/src/product/homeMain.ts')).toBe(true);
    expect(html.includes('390px')).toBe(true);
    expect(html.includes('844px')).toBe(true);
    expect(html.includes('portraitBattleLab')).toBe(false);
    expect(html.includes('portrait-lab')).toBe(false);
  });
});
