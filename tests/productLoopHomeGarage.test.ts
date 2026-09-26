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
  vehicleSlotAnchors,
} from '../src/product/vehiclePreview';
// PRODUCT-LOOP-P0-GARAGE-SLOT-INTERACTION-R2｜正式共享纯函数（Battle / Run 双向都走它）
// —— 预览的坐标口径现在**逐件与它交叉核对**，而不是只钉一个字面量。
import { visualWorldTransform } from '../src/battle/battleContract';
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
// PRODUCT-LOOP-R2-A｜**强化**：先剥注释再扫描。
// 原实现直接扫原文 ⇒ 一句形如「这里刻意没有 `import ... from './x'`」的**说明文字**
// 会被当成一条真实 import（本 Queue 就踩到了：playerLoadout.ts 的注释里解释了不成环的理由）。
// 边界守卫要管的是**代码**的依赖，不是散文；剥掉注释后误报消失，而真实 import 一个都跑不掉。
function importSpecifiers(src: string): string[] {
  const out: string[] = [];
  const code = strip(src);
  // 同时捕获 `import ... from 'x'` 与裸副作用 import（`import 'x'`）—— 边界守卫不得漏后者
  const re = /from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) out.push(m[1] ?? m[2]);
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

  it('PL-20 预览件 = 车身 + 两个轮 + 已装件（与 Build 逐槽同源）；主武器槽恰一个（高亮唯一）', () => {
    const draft = defaultPlayerDraft();
    const layout = vehiclePreviewLayout(draft);
    expect(layout.items.filter((i) => i.kind === 'body')).toHaveLength(1);
    expect(layout.items.filter((i) => i.kind === 'wheel')).toHaveLength(2);
    // ⚠️ 已装件数**从 draft 推导**（不是写死一个数字）：默认车改了哪一槽，
    //    这条守卫自动跟着走，不会出现「改了默认车而守卫还在数旧数字」的静默漂移。
    const mounted = Object.entries(draft.functionalSelections).filter(
      ([, id]) => id && id !== EMPTY_SLOT,
    );
    expect(layout.items.filter((i) => i.kind === 'part')).toHaveLength(mounted.length);
    // R1-C 起默认车的前置槽**明确留空**（主循环可行性处置，证据见 playerLoadout.ts）
    expect(draft.functionalSelections['front']).toBe(EMPTY_SLOT);
    expect(mounted).toHaveLength(2);
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

  it('PL-24（R2 修正）预览坐标口径 = **与正式链路同口径（y 向下）**，视图层**不翻转**', () => {
    const draft = defaultPlayerDraft();
    const layout = vehiclePreviewLayout(draft);
    const body = registry.bodies.get(draft.bodyDefId)!;

    /*
      ⚠️ PRODUCT-LOOP-P0-GARAGE-SLOT-INTERACTION-R2｜本守卫在 R1 之前钉的是
         「y 向上、翻转在视图层」—— 那个口径**是错的**，而且正是本次要修的缺陷：
           - Battle 世界 `gravity.y = +10`、`groundY=700`（arena 高 900）⇒ 世界 y **向下**；
           - 正式纯函数 `visualWorldTransform`：`position.y = physPos.y + anchor.y`（不取反）；
           - Run 舞台 `placeSideViewVisuals`：直接拿 `cy` 当屏幕 y（不取反）。
         预览当时多做了一次取反 ⇒ **整车上下镜像**（轮子跑到车身之上、武器挂到车底），
         真人录屏看到的「朝向与正式战斗相反」就是它。
         现在改为**逐件与正式纯函数 / 正式挂点交叉核对**（不再只钉字面量）。
    */
    for (const it of layout.items) {
      if (it.kind === 'body') {
        expect(body.visual, '默认车身必须有正式 visual').toBeTruthy();
        // 正式共享纯函数（Battle / Run 双向都走它）在 physPos=(0,0)、angle=0 的取值
        const v = visualWorldTransform(body.visual!, 1, { x: 0, y: 0 }, 0);
        expect(it.cx).toBe(v.position.x);
        expect(it.cy).toBe(v.position.y);
      }
      if (it.kind === 'part' && it.visualId !== null) {
        const hp = body.functionalHardpoints.find((h) => h.id === it.key.replace(/^part:/, ''))!;
        const v = visualWorldTransform(
          registry.functionals.get(it.defId)!.visual!,
          1,
          { x: hp.localPosition.x, y: hp.localPosition.y },
          0,
        );
        expect(it.cx, `${it.key} 横向 = 正式挂点 + 正式 anchor`).toBe(v.position.x);
        expect(it.cy, `${it.key} 纵向 = 正式挂点 + 正式 anchor（不取反）`).toBe(v.position.y);
      }
    }

    /*
      轮子：预览取 `movementHardpoints[].localPosition`；Run 侧取
      `visualWorldTransform(def.visual, facing, {x: facing*hp.x, y: hp.y}, 0)`。
      ⚠️ 两者**逐字相同**的前提是「正式 Movement 都没有 `visual`」（轮组由程序化圆形绘制）
      —— 下面第 3 段把这个前提也钉住：将来给 Movement 加了带 anchor 的 visual，这里会红。
    */
    for (const hp of body.movementHardpoints) {
      const w = layout.items.find((i) => i.key === `wheel:${hp.id}`);
      expect(w, `${hp.id} 轮必须画出来`).toBeTruthy();
      expect(w!.cx).toBe(hp.localPosition.x);
      expect(w!.cy).toBe(hp.localPosition.y);
    }

    // 西瓜车身：轮子挂点 y = **+25 = 向下**（不是 -25）；武器挂点在车体**上方**（y 为负）
    expect(layout.items.filter((i) => i.kind === 'wheel').map((i) => i.cy)).toEqual([25, 25]);
    const wHp = body.functionalHardpoints.find((h) => h.id === WEAPON_SLOT)!;
    expect(wHp.localPosition.y).toBeLessThan(0);
    expect(layout.items.find((i) => i.onWeaponSlot)!.cy).toBeLessThan(0);

    // 正式 Movement 一律没有 visual（轮组 = 真实半径的程序化圆，不是 sprite）
    for (const m of registry.movements.values()) {
      expect(m.visual, `Movement ${m.id} 不应有 visual（有的话预览与 Run 的挂点口径会分叉）`).toBeUndefined();
    }

    // 视图层**不翻转**（R2 修正后就不该再出现取反）
    const code = strip(readProduct('homePage.ts'));
    expect(code).toContain('dy: (cy - by) * layout.scale');
    expect(code).not.toContain('-(it.cy');
    expect(code).not.toContain('-(cy - by)');
  });

  it('PL-27（R2）front / rear / weapon 语义与**正式 Product Run** 同源同向', () => {
    const draft = defaultPlayerDraft();
    const layout = vehiclePreviewLayout(draft);
    const body = registry.bodies.get(draft.bodyDefId)!;
    const xOf = (key: string): number => layout.items.find((i) => i.key === key)!.cx;

    // ① 车体本地：front 在 +x、rear 在 -x（正式 BodyDef 挂点的真实取值）
    const frontHp = body.movementHardpoints.find((h) => h.id === 'front')!;
    const rearHp = body.movementHardpoints.find((h) => h.id === 'rear')!;
    expect(frontHp.localPosition.x).toBeGreaterThan(rearHp.localPosition.x);
    // ② 预览里 front 轮就在 rear 轮的**右边**（同一侧、同一顺序）
    expect(xOf('wheel:front')).toBeGreaterThan(xOf('wheel:rear'));
    // ③ 武器挂点在车体前半球（frontMass 的 x > 0）⇒ 预览里也在右半边
    expect(body.functionalHardpoints.find((h) => h.id === WEAPON_SLOT)!.localPosition.x).toBeGreaterThan(0);
    expect(layout.items.find((i) => i.onWeaponSlot)!.cx).toBeGreaterThan(0);

    /*
      ④ 官方玩家车的朝向 = **facing 1（朝 +x）** —— 写死在两个正式编排器的默认出生点里
         （Matter 与 Planck 两套实现同值）。Run 舞台摆位用 `facing * hp.x`，facing=1 时
         与预览的 `hp.x` **完全一致** ⇒ 「Garage 的前 / 后 = Run 的前 / 后」结构性成立。
    */
    for (const f of ['battleOrchestrator.ts', 'planckBattleOrchestrator.ts']) {
      const src = readFileSync(join(REPO_ROOT, 'src', 'battle', f), 'utf8');
      expect(src, `${f} 的官方玩家出生朝向必须仍是 facing: 1`).toContain(
        'config.spawnA ?? { x: 400, y: 640, facing: 1 }',
      );
    }
  });

  it('PL-28（R2）装备槽锚点 = 正式挂点（纯函数，与预览同口径）', () => {
    const draft = defaultPlayerDraft();
    const body = registry.bodies.get(draft.bodyDefId)!;
    const anchors = vehicleSlotAnchors(draft);

    expect(anchors.body).toEqual({ cx: 0, cy: 0, from: 'body-origin' });
    for (const id of ['front', 'rear'] as const) {
      const hp = body.movementHardpoints.find((h) => h.id === id)!;
      expect(anchors[id]).toEqual({ cx: hp.localPosition.x, cy: hp.localPosition.y, from: 'hardpoint' });
    }
    const wHp = body.functionalHardpoints.find((h) => h.id === WEAPON_SLOT)!;
    expect(anchors.weapon).toEqual({ cx: wHp.localPosition.x, cy: wHp.localPosition.y, from: 'hardpoint' });

    // 槽位锚点与预览件坐标**同一套口径** ⇒ 页面用同一个 `previewOffset()` 即可对齐
    const layout = vehiclePreviewLayout(draft);
    expect(anchors.front.cx).toBe(layout.items.find((i) => i.key === 'wheel:front')!.cx);
    expect(anchors.rear.cy).toBe(layout.items.find((i) => i.key === 'wheel:rear')!.cy);

    // 未知车身 → 全部如实回退到车体原点（不猜、不伪造位置）
    const bad = vehicleSlotAnchors({ ...draft, bodyDefId: 'noSuchBody' });
    for (const id of ['weapon', 'body', 'front', 'rear'] as const) {
      expect(bad[id]).toEqual({ cx: 0, cy: 0, from: 'body-origin' });
    }
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
        // PRODUCT-LOOP-R2-B：卡片要显示该星级**实际**占用的能量 ⇒ 直接用 core 的星级
        // 倍率函数（与 Build 总能量、与战斗侧是**同一个** `starTierEnergy`）。
        // ⚠️ 这不是新的依赖方向：`../core/buildValidator` 本来就 import 它（原为传递依赖）。
        '../core/buildSnapshot',
        '../core/types',
        '../lab/buildEditorModel',
        /*
          PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP｜Movement 维度的**两个只读真源**
          （本模块到这里只是多了一个**写入口**，读数口径一个字都没变）。

          ⚠️ 为什么必须走它们、而不是就地展开 `BuildDraft.rearWheelDefId`：
             - 「有哪些正式 Movement」+「ownership 判据」= `./movementInventory`
               （上一轮固化；它自己再指向 `./runMovementCanonical` → core `OFFICIAL_MOVEMENTS`）；
             - 「局外存档 → Snapshot → Runtime 的三段映射」= `./runMovementCanonical`
               （与 Run 侧同一个 `buildSnapshotFromDraft` + `resolveSnapshot`）。
             就地重写这两件事就是**第二份真源**：产品侧显示 A、Run 侧装载 B 时会静默分叉。

          ⚠️ 依赖方向是 `playerLoadout → movementInventory → runMovementCanonical`，
             三者都不反向 import 本模块 ⇒ **不成环**（这本是 R3 canonical 轮次刻意留好的方向）。
        */
        './movementInventory',
        './runMovementCanonical',
        /*
          PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP｜Body 维度的**两个只读真源**
          （与 Movement 同一套纪律：本模块只是多了一个 `equipBody` 写入口）。

          ⚠️ 为什么必须走它们、而不是就地展开 `BuildDraft.bodyDefId`：
             - 「有哪些正式 Body」+「owned 判据」= `./bodyInventory`
               （它再指向 `../core/bodyOwnership` 的 `OFFICIAL_BODIES` / `canEquipBody`）；
             - 「局外存档 → Snapshot → Runtime 的三段映射」= `./runBodyCanonical`
               （与 Run 侧同一个 `buildSnapshotFromDraft` + `resolveSnapshot`）。
             就地重写这两件事就是**第二份真源**：产品侧显示 A、Run 侧装载 B 时会静默分叉。

          ⚠️ 依赖方向是 `playerLoadout → bodyInventory → core/bodyOwnership`，
             三者都不反向 import 本模块 ⇒ **不成环**。
        */
        '../core/bodyOwnership',
        './bodyInventory',
      ],
      'vehiclePreview.ts': [
        '../core/content',
        '../core/types',
        '../lab/buildEditorModel',
        './playerLoadout',
        /*
          PRODUCT-LOOP-R3-MOVEMENT-EQUIP-PREVIEW｜显式 +1（**登记，不是放宽**）。

          为什么预览必须读它：轮子画多大只有一个正确出处 —— 该挂点**生效 Movement def
          自身的 `radius`**。此前预览优先信任 `BuildDraft.rearRadius` / `frontRadius`，
          而这两个数值字段会与 defId **各自漂移**（切回缺省轮时 `equipMovement` 只删
          defId 键、保留 radius；陈旧值又经 `overrides.radius` 覆盖 def 半径）
          ⇒ 实测把「标准轮」画成了小轮尺寸（24 而非 40）。基线 `cb3275d` 上同签名复现，
          非本 Queue 引入。

          ⚠️ 依赖方向仍然单向、不成环：
             `vehiclePreview → runMovementCanonical → {core/content, core/partInventory,
              core/buildSnapshot, lab/buildEditorModel, ./playerLoadout}`
             —— `runMovementCanonical` 不反向 import 本模块（它的白名单里没有本文件）。
          ⚠️ 这同时让「验收 4：Preview 与 Product Run 使用同一 Movement 数据源」**结构性成立**：
             两边读的是同一个 `registry.movements`。
        */
        './runMovementCanonical',
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
      // PRODUCT-LOOP-R1-C：追加 `../lab/buildEditorModel` —— **只取 `BuildDraft` 类型**
      //   （type-only import），用于把「局外当前装备」原样编进「开始冒险」的地址；
      //   产品侧不解释这份装备的含义，因此不需要任何内容层之外的依赖。
      'runReward.ts': ['../core/content', '../lab/buildEditorModel'],
      // PRODUCT-LOOP-R2-A：永久成长的**唯一模型与写入口**。
      //   - 只经 core 的 `partInventory`（`addPart` / `loadInventoryRaw` / `saveInventory`）
      //     与 `buildPersistence`（判 fresh）读写，**不新建第二套库存**；
      //   - 只从 `playerLoadout` 借「哪个槽是武器槽 / 这件是不是正式武器」这两个**既有**口径，
      //     不反向要求 `playerLoadout` import 自己（那会成模块环）；
      //   - `../lab/buildEditorModel` **只取 `BuildDraft` 类型**（type-only）。
      // PRODUCT-LOOP-R2-RECOVERY（必改 1）：追加 `./r2Onboarding` —— 一次性 onboarding
      // 迁移的判定与执行都在那个模块里，本模块只按正确顺序调它（判定 → 补件 → 落盘 → 打标记）。
      // PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1：再追加 `./r2Reseed` —— **版本化**一次性
      // reseed（上一轮验证已消费起点 ⇒ 恢复成 ★1 = 4/5 + 装备 ★1）。同样是「判定 → 执行 →
      // 落盘 → 打标记」的四段，顺序仍收在本模块内部；两份迁移各自一个 key。
      // PRODUCT-LOOP-R3-MOVEMENT-CHOICE-SEED：再追加 `./r3MovementChoiceSeed` —— **第三份**
      // 一次性迁移（Movement 可选方案种子，三档各补到 ≥1），同样「判定 → 补件 → 落盘 → 打标记」，
      // 仍然是**自己的 key**；它只增不减、且**不碰 Build**。
      // PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP：再追加 `./r4BodyChoiceSeed` —— **第四份**
      // 一次性迁移（Body 可选方案种子，MVP 2 台各永久解锁），同样「判定 → 补件 → 落盘 → 打标记」，
      // 仍然是**自己的 key**；它只碰 `core/bodyOwnership` 的拥有状态、**不碰 Build**。
      'playerGrowth.ts': [
        '../core/buildPersistence',
        '../core/partInventory',
        '../lab/buildEditorModel',
        './movementInventory',
        './playerLoadout',
        './r2Onboarding',
        './r2Reseed',
        './r3MovementChoiceSeed',
        './r4BodyChoiceSeed',
      ],
      /*
        PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY（必改 1）｜**一次性 onboarding 迁移**。
          - 它需要**自己的持久化 key**（迁移版本标记）⇒ 只依赖 `../platform`
            （与 `playerProfile.ts` 这个 Repository 同一条纪律：只有产品侧的持久化模块碰存储）；
          - 信封复用 `../core/saveVersion`（不新造第二套版本机制，也**不动**全局版本号）；
          - 库存读写仍走 `../core/partInventory`（不新建第二套库存）；
          - 「有没有 ★≥2 的 Weapon 成长」这个判据取自 `./playerLoadout` 的 `weaponEntries()`
            （唯一武器读数），不自己展开库存形状。
      */
      'r2Onboarding.ts': [
        '../core/partInventory',
        '../core/saveVersion',
        '../platform',
        './playerLoadout',
      ],
      /*
        PRODUCT-LOOP-R2-VALIDATION-STATE-RESEED-R1｜**版本化一次性 reseed**（上一轮验证
        已经把起点消费掉：`cannon ★2` 已合成且装备着）。
          - 自己的持久化 key（`strongfruit.r2Reseed.v1`）⇒ 只依赖 `../platform`
            （与 `playerProfile.ts` / `r2Onboarding.ts` 同一条纪律：只有产品侧的持久化模块碰存储）；
          - 信封复用 `../core/saveVersion`（不新造第二套版本机制，也**不动**全局版本号）；
          - 库存读写走 `../core/partInventory`（`addPart` / `consume` / `getCount` / `saveInventory`）
            —— 清星用的是 core 既有的 `consume`，**没有**第二个库存写入口；
          - 换装走 `./playerLoadout` 的 `equipWeapon`（**唯一**写 Build 的入口，过
            `validateSnapshot`）⇒ 产品侧仍然只有那一处 `savePlayerBuild(`；
          - 判别式要用旧标记 ⇒ `./r2Onboarding`；要用「有没有领过奖」⇒ `./playerProfile`
            的 `readClaimLedger()`（账本解析口径只有那一处，本模块不复制）；
          - `../lab/buildEditorModel` **只取 `BuildDraft` 类型**（type-only）。
      */
      'r2Reseed.ts': [
        '../core/partInventory',
        '../core/saveVersion',
        '../lab/buildEditorModel',
        '../platform',
        './playerLoadout',
        './playerProfile',
        './r2Onboarding',
      ],
      /*
        PRODUCT-LOOP-R3-MOVEMENT-CHOICE-SEED｜**一次性 Movement 可选方案种子**。
          - 自己的持久化 key（`strongfruit.r3MovementChoiceSeed.v1`）⇒ 只依赖 `../platform`
            （与 `playerProfile.ts` / `r2Onboarding.ts` / `r2Reseed.ts` 同一条纪律：
            只有产品侧的持久化模块碰存储）；
          - 信封复用 `../core/saveVersion`（不新造第二套版本机制，也**不动**全局版本号）；
          - 库存读写走 `../core/partInventory`（`OFFICIAL_MOVEMENTS` 是「哪些轮组需要库存」
            的**唯一真源**，`addPart` / `getCount` 是**唯一**的写 / 读入口）——
            与 Weapon **共用** `strongfruit.ownedParts.v2`，**不新建**第二套库存；
          - `./movementInventory` **只取 `MOVEMENT_STAR`**（轮组在库存里占的星级档；
            它借 `./runMovementCanonical` 的 canonic 事实，本模块不自己写 `1`）；
          - 刻意**不依赖** `../lab/buildEditorModel`：本种子**一个字节都不写 Build**
            ⇒ 连 `BuildDraft` 类型都不需要（「不自动装备」是结构性成立的）。
      */
      'r3MovementChoiceSeed.ts': [
        '../core/partInventory',
        '../core/saveVersion',
        '../platform',
        './movementInventory',
      ],
      /*
        PRODUCT-LOOP-R3-MOVEMENT-CANONICAL-INVENTORY｜当前正式 Movement / Drive 的 canonical
        mapping（只读事实清单，零副作用；产品侧不新增任何 Movement 内容）。
          - Movement 内容真源 = `../core/content` 的 `registry.movements`（**遍历**它，
            不在这里维护第二张表）；
          - 「哪些轮组需要库存」真源 = `../core/partInventory` 的 `OFFICIAL_MOVEMENTS`
            （不自己判断 wheelStd 是不是特例）；
          - Runtime 数值真源 = `../core/buildSnapshot` 的 `resolveSnapshot`
            （与战斗装配同一个函数，**不自己**合并 overrides）；
          - `../lab/buildEditorModel` 取 `buildSnapshotFromDraft` / `makeStarterDraft` /
            `resolveDriveMode` / `EMPTY_SLOT` + 两个类型 —— 「缺省轮组 / 缺省 Drive」
            一律由**正式函数**回答，模块里不写这两条字面量；
          - `./playerLoadout` **只取** `PLAYER_BODY_DEF_ID`（正式玩家车身这个字符串
            只有那一处真源）。
      */
      'runMovementCanonical.ts': [
        '../core/buildSnapshot',
        '../core/content',
        '../core/partInventory',
        '../lab/buildEditorModel',
        './playerLoadout',
      ],
      /*
        PRODUCT-LOOP-R3-MOVEMENT-PERSISTENT-INVENTORY｜永久成长里的 **Movement 维度**
        （owned / equipped / persisted 的唯一读数 + 唯一保证）。
          - 库存读写只走 `../core/partInventory`（`getCount` / `addPart`）——
            与 Weapon **共用** `strongfruit.ownedParts.v2`，**不新建**第二套库存 /
            第二个拥有记录 / 新的 storage key；
          - Movement 内容 / 缺省轮 / 「哪些需要库存」/ 「装着什么」全部取自
            `./runMovementCanonical`（上一轮固化的 canonical 事实清单）——
            本模块**不复制**任何一条 Movement 数据，也不自己解释 `BuildDraft`；
          - `../lab/buildEditorModel` **只取 `BuildDraft` / `DriveMode` 两个类型**（type-only）。
      */
      'movementInventory.ts': [
        '../core/partInventory',
        '../lab/buildEditorModel',
        './runMovementCanonical',
      ],
      /*
        PRODUCT-LOOP-P0：完整 Run 资格判断（产品层唯一一处）。
          - 判据必须来自**真实 `BuildDraft` + 正式内容库的分类字段**（Queue 必改 1
            明令「不要在 UI 里靠字符串判断」）⇒ 用 `../lab/buildEditorModel` 做纯解析、
            用 `../core/content` 做只读分类；
          - `../core/types` **只取 `FunctionalPartDef` 类型**（展示名要用它）；
          - 刻意**不**依赖 `./playerLoadout`：那是「哪个槽是武器槽」的口径所在，
            而资格判断问的是「装载里有没有受支持的武器」（存在性），两者刻意不同源，
            否则两层判据会在「主武器换人、车上另有基准武器」时分叉。
      */
      'runCompatibility.ts': ['../core/content', '../core/types', '../lab/buildEditorModel'],
      /*
        PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP｜Body 维度的三个新模块。
          - `bodyInventory.ts`：Body 拥有 / 装备的**只读真源**。id / name / hp / baseMass /
            energyCapacity 全部现读 `../core/content` 的 `registry.bodies`（**遍历 OFFICIAL_BODIES**，
            不复制第二张表）；「哪些是正式车身 / 是否拥有」取自 `../core/bodyOwnership`；
            `../lab/buildEditorModel` **只取 `BuildDraft` 类型**（type-only）。
          - `runBodyCanonical.ts`：局外 → Snapshot → Runtime 的 canonical mapping（纯只读）。
            走正式 `../core/buildSnapshot` 的 `resolveSnapshot` + `../lab/buildEditorModel` 的
            `buildSnapshotFromDraft`（与 Run 侧同源）；id 现读 `../core/bodyOwnership` 的
            `OFFICIAL_BODIES`；`../core/content` 取 `registry.bodies`。
          - `r4BodyChoiceSeed.ts`：一次性 Body 可选方案种子。自己的 key ⇒ 只依赖 `../platform`；
            信封复用 `../core/saveVersion`；拥有状态经 `../core/bodyOwnership` 的 `grantBody` /
            `isBodyOwned`（不新建第二套拥有记录、不碰 Build）。
      */
      'bodyInventory.ts': [
        '../core/bodyOwnership',
        '../core/content',
        '../lab/buildEditorModel',
      ],
      'runBodyCanonical.ts': [
        '../core/content',
        '../core/bodyOwnership',
        '../core/buildSnapshot',
        '../lab/buildEditorModel',
        '../lab/buildEditorModel',
      ],
      'r4BodyChoiceSeed.ts': [
        '../core/bodyOwnership',
        '../core/saveVersion',
        '../platform',
      ],
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
          // PRODUCT-LOOP-R2-A：成长的唯一入口（页面只调 `openGrowthSession` 一次）
          './playerGrowth',
          // PRODUCT-LOOP-P0：「开始冒险」的资格判断（页面**不**自己判断武器支持性）
          './runCompatibility',
          // PRODUCT-LOOP-R3-MOVEMENT-GARAGE-EQUIP：Movement 配置区的**唯一读写口径**
          //   —— 页面只调 `movementReading()`（读数）与 `equipMovement()`（写），
          //   自己不赋值 `rearWheelDefId` / `frontWheelDefId`，也不自建第二份 ownership 判据。
          './movementInventory',
          './runMovementCanonical',
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

  /*
    PRODUCT-LOOP-R1-C｜**结构性缺陷守卫（真实事故，不是假想）**。

    `home.html` 头部注释里原先画了一条箭头图，其中包含了 HTML 注释的**终止序列**
    （两个连字符紧跟一个右尖括号）。浏览器在该处**提前闭合注释** ⇒ 其后文本全部按真标签解析：
    注释里那份用反引号包着的 anchor 示例变成**真锚点**且 href 为空（解析为当前 URL）。

    症状具有极强的误导性：页面渲染完全正常、`document.elementFromPoint` 命中正确元素、
    `element.click()` 也工作，但**真实鼠标点击页面上任何位置**都会触发整页重载 ⇒
    「调整战车」视图永远打不开（同时打断 `e2e:product-home` 的 B1 与主循环 E2E）。

    这里用「开始序列 / 终止序列必须一一配平」把它机器钉死：只要有人在注释里再写一次终止
    序列，本断言立刻变红（行为侧由主循环 E2E 的真实鼠标点击兜底）。
  */
  it('PL-33 根 HTML 入口的注释必须完整闭合（注释体内不得出现注释终止序列）', () => {
    const entries = [
      'home.html',
      'run-page.html',
      'next-run.html',
      'portrait-lab.html',
      'encounter-lab.html',
      'content-batch.html',
      'validation-hub.html',
    ];
    for (const f of entries) {
      const html = readFileSync(join(REPO_ROOT, f), 'utf8');
      const opens = html.split('<!--').length - 1;
      const closes = html.split('-->').length - 1;
      expect(opens, `${f} 应当有一个头部注释`).toBeGreaterThan(0);
      expect(closes, `${f} 的注释终止序列数量必须与开始序列一致（多出来的会被浏览器当成真标签）`).toBe(opens);
      const firstOpen = html.indexOf('<!--');
      const firstClose = html.indexOf('-->');
      expect(firstClose, `${f} 第一个注释终止序列必须在注释开始之后`).toBeGreaterThan(firstOpen);
    }
  });
});
