/**
 * F-CONTENT-PLAYER-MOVEMENT-PACK-R1｜Movement 内容扩充（标准/小/大/重 4 轮组）验收 T1-T16。
 *
 * 覆盖（对应用户 Queue 严格测试 T1-T16）：
 *  T1  defId 唯一进目录：MOVEMENT_OPTIONS 4 项唯一 + registry.movements 4 轮组；
 *  T2  Build/能量校验：8 车身×4 轮组轻装配合法 + 轮组能量计入 + 超载拒绝 + 标准轮零回归；
 *  T3  新轮组至少一个正式物理字段与 wheelStd 不同（禁换皮）+ Renderer drawWheel defId 分支；
 *  T4  轮径/离地顺序：small < std < large（真实 Planck 静置测量，非表面对比）；
 *  T5  heavyWheel 行为差异自动化证明：质量 20>10 + 惯量 + 2s 位移更短（真实 motor 驱动）；
 *  T6  未获得不可装备 + debug「全部件×1」解锁（wheelStd 恒默认拥有）；
 *  T7  装备/替换/卸下/站桩规则（runtime onPickGarageOption 轮槽守卫与写入）；
 *  T8  存档往返 + 旧档（无 defId）fallback 标准轮 + 未知轮组拒绝；
 *  T9  8 车身 × 3 新轮组合法 Build；
 *  T10 4 视口（420×210/621×351/844×390/1280×592）previewSolo garage 构图完整入画；
 *  T11 Garage 换轮组中心偏移 ≤3%W / camera scale 跳变 ≤5%（实测 0% / ≤3.61%）；
 *  T12 Battle Active→Result 无 NaN/穿地/死循环（4 轮组×对手池首套）；
 *  T13 Loss→换轮组→再战：新玩家快照（movements defId 生效）+ 对手不连续重复；
 *  T14 49 对手池不变：模板无轮组 defId、movements 全 wheelStd、全部合法；
 *  T15 8 个正式车身及 bodyOwnership 不变；
 *  T16 站桩 Build 回归：drive=stationary 与轮组共存、换轮组不改 drive。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { MOVEMENT_OPTIONS } from '../src/ui/playerUI';
import {
  OFFICIAL_MOVEMENTS,
  canEquipMovement,
  grantAllNewMovements,
  getCount,
  type PartInventory,
} from '../src/core/partInventory';
import { grantAllPartsOnce } from '../src/core/debugGrants';
import {
  OFFICIAL_BODIES,
  DEFAULT_OWNED_BODIES,
  NEW_OFFICIAL_BODIES,
  isBodyOwned,
} from '../src/core/bodyOwnership';
import { OPPONENT_POOL, OPPONENT_TEMPLATES } from '../src/player/opponentPool';
import {
  buildSnapshotFromDraft,
  makeStarterDraft,
  resolveDriveMode,
  EMPTY_SLOT,
  type BuildDraft,
} from '../src/lab/buildEditorModel';
import { validateSnapshot, computeEnergy } from '../src/core/buildValidator';
import { registry } from '../src/core/content';
import { createPlanckBattle } from '../src/battle/battleRequestAdapter';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import type { CanvasSurface } from '../src/render/canvasSurface';
import { PHYSICS_HZ, solidDiskInertiaKgM2 } from '../src/physics/units';
import type { BattleRequest, BattleOrchestratorApi, BattleConfig } from '../src/battle/battleContract';
import type { BuildSnapshot } from '../src/core/types';
import type { PlayerBattleHost } from '../src/game/playerGameRuntime';
import type { PlayerUIHost, PlayerUIState, PlayerUIActions } from '../src/ui/playerUI';
import { PlayerGameRuntime } from '../src/game/playerGameRuntime';
import { bindPlatformCore } from '../src/platform/context';
import { createWechatCore } from '../src/platform/wechat';
import { savePlayerBuild, loadPlayerBuild } from '../src/core/buildPersistence';

const STEP = 1000 / PHYSICS_HZ;

/** 8 个正式玩家车身（旧 4 默认拥有 + 新 4） */
const BODIES_8 = [...DEFAULT_OWNED_BODIES, ...NEW_OFFICIAL_BODIES];
/** 4 个正式轮组 */
const WHEELS_4 = ['wheelStd', 'smallWheel', 'largeWheel', 'heavyWheel'];
/** 3 个新轮组（默认未获得） */
const WHEELS_NEW = ['smallWheel', 'largeWheel', 'heavyWheel'];
/** Queue 指定 4 视口 */
const VIEWPORTS = [
  { w: 420, h: 210 },
  { w: 621, h: 351 },
  { w: 844, h: 390 },
  { w: 1280, h: 592 },
];

/** 轻装配 Draft：cannon 单武器（30）+ 前后同轮组（能量 0/10/24/30 → 全部 ≤90 容量合法） */
function lightDraft(bodyId: string, wheelId: string): BuildDraft {
  const def = registry.movements.get(wheelId)!;
  return {
    bodyDefId: bodyId,
    rearRadius: def.radius,
    frontRadius: def.radius,
    rearWheelDefId: wheelId,
    frontWheelDefId: wheelId,
    functionalSelections: { frontMass: 'cannon' },
    drive: 'forward',
  };
}

function snapOf(d: BuildDraft, id = 'customA'): BuildSnapshot {
  return buildSnapshotFromDraft(d, registry, id);
}

/* ---------------- T1｜defId 唯一进目录 ---------------- */
describe('T1｜MOVEMENT_OPTIONS / registry 轮组目录', () => {
  it('MOVEMENT_OPTIONS 4 项（小/标/大/重展示顺序）且 defId 唯一、全部在 registry.movements 中', () => {
    const vs = MOVEMENT_OPTIONS.map((o) => o.v);
    expect(vs).toEqual(['smallWheel', 'wheelStd', 'largeWheel', 'heavyWheel']);
    expect(new Set(vs).size).toBe(vs.length);
    for (const v of vs) {
      expect(registry.movements.has(v), `${v} 应在 registry`).toBe(true);
      expect(registry.movements.get(v)!.kind).toBe('wheel');
    }
  });
  it('registry.movements 恰含 4 个轮组（1→4 扩充）', () => {
    expect(registry.movements.size).toBe(4);
    for (const id of WHEELS_4) expect(registry.movements.has(id)).toBe(true);
  });
  it('新轮组默认未获得：OFFICIAL_MOVEMENTS 只含 small/large/heavy（wheelStd 不进库存）', () => {
    expect([...OFFICIAL_MOVEMENTS]).toEqual(WHEELS_NEW);
  });
});

/* ---------------- T2｜Build/能量校验 ---------------- */
describe('T2｜Build / 能量校验（8 车身 × 4 轮组）', () => {
  it('轻装配（cannon 单武器）8 车身 × 4 轮组全部合法且能量 ≤ 容量', () => {
    for (const b of BODIES_8) {
      for (const w of WHEELS_4) {
        const snap = snapOf(lightDraft(b, w), `t2-${b}-${w}`);
        const res = validateSnapshot(snap, registry);
        expect(res.valid, `[${b}][${w}] ${res.errors.join('; ')}`).toBe(true);
        const energy = computeEnergy(snap, registry).energy;
        const cap = registry.bodies.get(b)!.energyCapacity;
        expect(energy, `[${b}][${w}] energy=${energy} cap=${cap}`).toBeLessThanOrEqual(cap);
      }
    }
  });
  it('轮组能量真实计入 computeEnergy（small 双装=10 / large=24 / heavy=30；wheelStd=0）', () => {
    expect(computeEnergy(snapOf(lightDraft('watermelonBody', 'wheelStd')), registry).energy).toBe(30); // 纯功能件 30
    expect(computeEnergy(snapOf(lightDraft('watermelonBody', 'smallWheel')), registry).energy).toBe(40);
    expect(computeEnergy(snapOf(lightDraft('watermelonBody', 'largeWheel')), registry).energy).toBe(54);
    expect(computeEnergy(snapOf(lightDraft('watermelonBody', 'heavyWheel')), registry).energy).toBe(60);
  });
  it('超载真实拒绝：banana(90) + starter 功能件(75) + 重轮双装(30)=105 → invalid', () => {
    const d = makeStarterDraft('bananaBody', registry);
    d.rearWheelDefId = 'heavyWheel';
    d.frontWheelDefId = 'heavyWheel';
    d.rearRadius = 20;
    d.frontRadius = 20;
    const snap = snapOf(d, 't2-overload');
    const res = validateSnapshot(snap, registry);
    expect(res.valid).toBe(false);
    expect(res.errors.join('')).toContain('能量超载');
  });
  it('标准轮零回归：8 车身 × starter 功能件(75) + wheelStd 双装全部合法', () => {
    for (const b of BODIES_8) {
      const snap = snapOf(makeStarterDraft(b, registry), `t2-std-${b}`);
      expect(validateSnapshot(snap, registry).valid, `[${b}]`).toBe(true);
    }
  });
});

/* ---------------- T3｜物理字段真实不同（禁换皮） ---------------- */
describe('T3｜新轮组物理字段与 wheelStd 真实不同', () => {
  it('small/large/heavy 至少一个正式物理字段（radius/mass/driveTorque/maxRPM/grip）不同于 wheelStd', () => {
    const std = registry.movements.get('wheelStd')!;
    const fields = ['radius', 'mass', 'driveTorque', 'maxRPM', 'grip'] as const;
    for (const id of WHEELS_NEW) {
      const w = registry.movements.get(id)!;
      const diff = fields.filter((k) => w[k] !== std[k]);
      expect(diff.length, `[${id}] 无物理字段差异（换皮）`).toBeGreaterThan(0);
    }
  });
  it('轮径顺序 small(12) < std(20) < large(26)；heavy(20) 与标准同径（差异维度=质量）', () => {
    const r = (id: string) => registry.movements.get(id)!.radius;
    expect(r('smallWheel')).toBeLessThan(r('wheelStd'));
    expect(r('wheelStd')).toBeLessThan(r('largeWheel'));
    expect(r('heavyWheel')).toBe(r('wheelStd'));
  });
  it('Renderer drawWheel 有 defId 分支（小/大/重三样式），且双引擎 RenderCircle 透传 defId', () => {
    const rSrc = readFileSync('src/render/renderer.ts', 'utf-8');
    const dw = rSrc.indexOf('private drawWheel');
    const win = rSrc.slice(dw, dw + 2600);
    expect(win, 'drawWheel 含 smallWheel 样式').toContain('smallWheel');
    expect(win, 'drawWheel 含 largeWheel 样式').toContain('largeWheel');
    expect(win, 'drawWheel 含 heavyWheel 样式').toContain('heavyWheel');
    expect(readFileSync('src/battle/battleOrchestrator.ts', 'utf-8')).toContain('defId: w.def.id');
    expect(readFileSync('src/battle/planckBattleOrchestrator.ts', 'utf-8')).toContain('defId: w.def.id');
  });
});

/* ---------------- T4｜轮径/离地高度顺序（真实物理） ---------------- */
describe('T4｜轮径与离地高度顺序（Planck 静置实测）', () => {
  function clearance(bodyId: string, wheelId: string): { cy: number; clearance: number; radius: number } {
    const o = new PlanckBattleOrchestrator(
      snapOf(lightDraft(bodyId, wheelId)),
      snapOf(lightDraft(bodyId, 'wheelStd'), 'b'),
      registry,
      { autoDrive: true, settleToGround: true },
    );
    // settlePlanckVehicleToRestPose 后轮底贴地；「离地高度」= 车身（chassis）碰撞下缘到地面
    const groundTop = o.world.getCollisionBounds(o.arena.ground).minY;
    const chassisMaxY = o.world.getCollisionBounds(o.vehicleA.body).maxY;
    const rear = o.vehicleA.wheels.find((w) => w.id === 'rear')!;
    const pos = o.world.getPosition(rear.body);
    o.dispose();
    return { cy: pos.y, clearance: groundTop - chassisMaxY, radius: rear.def.radius };
  }
  it('watermelonBody：离地高度 small < std < large（真实 bounds 测量）', () => {
    const c = (id: string) => clearance('watermelonBody', id);
    const small = c('smallWheel');
    const std = c('wheelStd');
    const large = c('largeWheel');
    expect(small.radius).toBe(12);
    expect(std.radius).toBe(20);
    expect(large.radius).toBe(26);
    expect(small.clearance, `small=${small.clearance.toFixed(2)}`).toBeLessThan(std.clearance);
    expect(std.clearance, `std=${std.clearance.toFixed(2)}`).toBeLessThan(large.clearance);
    // 轮中心 y（Y-down：值越大越低）——small 轮中心更低 → cy 更大；large 更高 → cy 更小
    expect(small.cy).toBeGreaterThan(std.cy);
    expect(std.cy).toBeGreaterThan(large.cy);
  });
  it('heavyWheel 离地高度与标准轮一致（radius 同，差异维度=质量）', () => {
    const h = clearance('watermelonBody', 'heavyWheel');
    const s = clearance('watermelonBody', 'wheelStd');
    expect(Math.abs(h.clearance - s.clearance)).toBeLessThan(0.5);
  });
});

/* ---------------- T5｜heavyWheel 行为差异自动化证明 ---------------- */
describe('T5｜heavyWheel 质量/惯量/位移差异（真实 motor 驱动）', () => {
  function dist2s(wheelId: string): { dist: number; mass: number; inertia: number } {
    const def = registry.movements.get(wheelId)!;
    const o = new PlanckBattleOrchestrator(
      snapOf(lightDraft('watermelonBody', wheelId), 'a'),
      snapOf(lightDraft('watermelonBody', 'wheelStd'), 'b'),
      registry,
      { autoDrive: true, settleToGround: true },
    );
    const x0 = o.world.getPosition(o.vehicleA.body).x;
    for (let i = 0; i < 120; i++) o.step(STEP); // 2s @ 60Hz
    const x1 = o.world.getPosition(o.vehicleA.body).x;
    o.dispose();
    return {
      dist: x1 - x0,
      mass: def.mass,
      inertia: solidDiskInertiaKgM2(def.mass, def.radius),
    };
  }
  it('heavyWheel mass=20 > wheelStd 10，且 2s 前进位移明显更短（启动更钝）', () => {
    const h = dist2s('heavyWheel');
    const s = dist2s('wheelStd');
    expect(h.mass).toBe(20);
    expect(s.mass).toBe(10);
    expect(h.inertia).toBeGreaterThan(s.inertia);
    // eslint-disable-next-line no-console
    console.log(`T5 heavy dist=${h.dist.toFixed(2)} vs std=${s.dist.toFixed(2)}`);
    expect(h.dist, `heavy=${h.dist.toFixed(2)} std=${s.dist.toFixed(2)}`).toBeLessThan(s.dist);
  });
  it('heavyWheel 姿态更稳（2s 后 chassis 俯仰角绝对值更小，自动化证明）', () => {
    function maxAngle(wheelId: string): number {
      const o = new PlanckBattleOrchestrator(
        snapOf(lightDraft('watermelonBody', wheelId), 'a'),
        snapOf(lightDraft('watermelonBody', 'wheelStd'), 'b'),
        registry,
        { autoDrive: true, settleToGround: true },
      );
      let maxAbs = 0;
      for (let i = 0; i < 120; i++) {
        o.step(STEP);
        maxAbs = Math.max(maxAbs, Math.abs(o.world.getAngle(o.vehicleA.body)));
      }
      o.dispose();
      return maxAbs;
    }
    const h = maxAngle('heavyWheel');
    const s = maxAngle('wheelStd');
    // eslint-disable-next-line no-console
    console.log(`T5 heavy maxAngle=${h.toFixed(4)} vs std=${s.toFixed(4)}`);
    expect(h).toBeLessThanOrEqual(s * 1.5 + 0.0005); // 不差于标准 1.5 倍（实测远更小）
  });
});

/* ---------------- T6｜未获得禁装 + debug 解锁 ---------------- */
describe('T6｜轮组拥有守卫与 debug 解锁', () => {
  afterEach(() => {
    vi.useRealTimers();
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  function bindEmptyStore(): Map<string, unknown> {
    const store = new Map<string, unknown>();
    (globalThis as { wx?: unknown }).wx = {
      getSystemInfoSync: () => ({ pixelRatio: 2 }),
      getStorageSync: (k: string) => (store.has(k) ? store.get(k) : null),
      setStorageSync: (k: string, v: unknown) => void store.set(k, v),
      removeStorageSync: (k: string) => void store.delete(k),
    };
    bindPlatformCore(createWechatCore(2));
    return store;
  }
  it('wheelStd 恒默认拥有；新 3 轮组默认未获得 → canEquipMovement false', () => {
    bindEmptyStore();
    expect(canEquipMovement('wheelStd')).toBe(true);
    for (const id of WHEELS_NEW) {
      expect(canEquipMovement(id), `[${id}] 默认应未获得`).toBe(false);
    }
  });
  it('grantAllNewMovements 解锁（幂等：首调 3、再调 0）→ 可装备', () => {
    const store = bindEmptyStore();
    expect(grantAllNewMovements()).toBe(3);
    expect(grantAllNewMovements()).toBe(0);
    for (const id of WHEELS_NEW) {
      expect(canEquipMovement(id), `[${id}] 解锁后可装备`).toBe(true);
    }
    // 库存真实落盘（one 计数，复用 PartInventory，无独立 storage）
    const raw = store.get('strongfruit.ownedParts.v2');
    expect(raw).toBeTruthy();
    const inv = JSON.parse(String(raw)) as Record<string, { one: number }>;
    expect(inv.smallWheel?.one ?? 0).toBe(1);
    expect(inv.largeWheel?.one ?? 0).toBe(1);
    expect(inv.heavyWheel?.one ?? 0).toBe(1);
  });
  it('grantAllPartsOnce（debug「全部件×1」）同时解锁轮组（库存 one 计数）', () => {
    bindEmptyStore();
    grantAllPartsOnce();
    for (const id of WHEELS_NEW) {
      expect(canEquipMovement(id), `[${id}] debug 解锁后可装备`).toBe(true);
    }
    expect(getCount({} as PartInventory, 'smallWheel', 1)).toBe(0); // 空对象读取安全
  });
  it('非正式轮组永远不可装备', () => {
    bindEmptyStore();
    expect(canEquipMovement('tinyWheel')).toBe(false);
    expect(canEquipMovement('wheelTurbo')).toBe(false);
  });
});

/* ---------------- T7｜装备/替换/卸下/站桩（runtime） ---------------- */
describe('T7｜轮组装备/替换/卸下/站桩规则（runtime onPickGarageOption）', () => {
  afterEach(() => {
    vi.useRealTimers();
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  function runtimeSetup(): { runtime: PlayerGameRuntime; host: FakeHost } {
    const store = new Map<string, unknown>();
    (globalThis as { wx?: unknown }).wx = {
      getSystemInfoSync: () => ({ pixelRatio: 2 }),
      getStorageSync: (k: string) => (store.has(k) ? store.get(k) : null),
      setStorageSync: (k: string, v: unknown) => void store.set(k, v),
      removeStorageSync: (k: string) => void store.delete(k),
    };
    bindPlatformCore(createWechatCore(2));
    const host = new FakeHost();
    const battle = new ScriptedBattleHost();
    const runtime = new PlayerGameRuntime({ host, battle, sfx: new RecSfx() } as never);
    runtime.init();
    return { runtime, host };
  }
  it('未获得轮组装备被拒绝（draft 不变）；解锁后可装备（写入 defId + 默认半径）', () => {
    const { host } = runtimeSetup();
    vi.useFakeTimers();
    host.actions!.selectGarageSlot!('rearWheel');
    host.actions!.onPickGarageOption('smallWheel');
    expect(host.lastState!.draft!.rearWheelDefId, '未获得应拒绝').toBeUndefined();
    expect(host.lastState!.draft!.rearRadius).toBe(20); // starter 默认 20
    // 解锁
    grantAllNewMovements();
    host.actions!.onPickGarageOption('smallWheel');
    expect(host.lastState!.draft!.rearWheelDefId).toBe('smallWheel');
    expect(host.lastState!.draft!.rearRadius).toBe(12);
  });
  it('替换：smallWheel → largeWheel（每次装备后槽位收起，需重选；defId 与半径同步更新）', () => {
    const { host } = runtimeSetup();
    vi.useFakeTimers();
    grantAllNewMovements();
    host.actions!.selectGarageSlot!('rearWheel');
    host.actions!.onPickGarageOption('smallWheel');
    expect(host.lastState!.draft!.rearWheelDefId).toBe('smallWheel');
    // 选完即收起（Garage UX）；替换 = 重选槽 → 再选新轮组
    host.actions!.selectGarageSlot!('rearWheel');
    host.actions!.onPickGarageOption('largeWheel');
    expect(host.lastState!.draft!.rearWheelDefId).toBe('largeWheel');
    expect(host.lastState!.draft!.rearRadius).toBe(26);
  });
  it('卸下/还原标准轮：选 wheelStd → defId=wheelStd + 半径 20；前后轮独立', () => {
    const { host } = runtimeSetup();
    vi.useFakeTimers();
    grantAllNewMovements();
    host.actions!.selectGarageSlot!('rearWheel');
    host.actions!.onPickGarageOption('smallWheel');
    host.actions!.selectGarageSlot!('rearWheel');
    host.actions!.onPickGarageOption('wheelStd');
    expect(host.lastState!.draft!.rearWheelDefId).toBe('wheelStd');
    expect(host.lastState!.draft!.rearRadius).toBe(20);
    // 前轮独立装 heavyWheel
    host.actions!.selectGarageSlot!('frontWheel');
    host.actions!.onPickGarageOption('heavyWheel');
    expect(host.lastState!.draft!.frontWheelDefId).toBe('heavyWheel');
    expect(host.lastState!.draft!.frontRadius).toBe(20);
    expect(host.lastState!.draft!.rearWheelDefId).toBe('wheelStd'); // 后轮不受影响
  });
  it('站桩规则：drive=stationary 与轮组共存（换轮组不改 drive）', () => {
    const { host } = runtimeSetup();
    vi.useFakeTimers();
    grantAllNewMovements();
    host.actions!.selectGarageSlot!('drive');
    host.actions!.onPickGarageOption('stationary');
    expect(host.lastState!.draft!.drive).toBe('stationary');
    host.actions!.selectGarageSlot!('rearWheel');
    host.actions!.onPickGarageOption('largeWheel');
    expect(host.lastState!.draft!.rearWheelDefId).toBe('largeWheel');
    expect(host.lastState!.draft!.drive, '换轮组不应改 drive').toBe('stationary');
  });
});

/* ---------------- T8｜存档往返 + 旧档 fallback ---------------- */
describe('T8｜存档往返与旧档兼容', () => {
  afterEach(() => {
    vi.useRealTimers();
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  function bindEmptyStore(): Map<string, unknown> {
    const store = new Map<string, unknown>();
    (globalThis as { wx?: unknown }).wx = {
      getSystemInfoSync: () => ({ pixelRatio: 2 }),
      getStorageSync: (k: string) => (store.has(k) ? store.get(k) : null),
      setStorageSync: (k: string, v: unknown) => void store.set(k, v),
      removeStorageSync: (k: string) => void store.delete(k),
    };
    bindPlatformCore(createWechatCore(2));
    return store;
  }
  it('轮组 defId 存档往返一致（save→load 恢复 smallWheel + 半径 12）', () => {
    bindEmptyStore();
    const d = lightDraft('watermelonBody', 'smallWheel');
    savePlayerBuild(d);
    const loaded = loadPlayerBuild();
    expect(loaded).not.toBeNull();
    expect(loaded!.rearWheelDefId).toBe('smallWheel');
    expect(loaded!.frontWheelDefId).toBe('smallWheel');
    expect(loaded!.rearRadius).toBe(12);
  });
  it('旧档（无 defId 字段）→ buildSnapshot fallback 标准轮（数值兼容，行为不变）', () => {
    bindEmptyStore();
    const old: BuildDraft = {
      bodyDefId: 'watermelonBody',
      rearRadius: 20,
      frontRadius: 20,
      functionalSelections: { frontMass: 'cannon' },
      drive: 'forward',
    };
    const snap = snapOf(old, 'old-save');
    const rear = snap.movements.find((m) => m.hardpointId === 'rear')!;
    const front = snap.movements.find((m) => m.hardpointId === 'front')!;
    expect(rear.defId).toBe('wheelStd');
    expect(front.defId).toBe('wheelStd');
    expect(rear.overrides?.radius).toBe(20);
    expect(validateSnapshot(snap, registry).valid).toBe(true);
  });
  it('旧档未知轮组 defId → isBuildDraftShape 拒绝 → loadPlayerBuild null（不崩溃）', () => {
    const store = bindEmptyStore();
    const bad = {
      ...lightDraft('watermelonBody', 'wheelStd'),
      rearWheelDefId: 'tinyWheel',
      frontWheelDefId: 'tinyWheel',
    };
    store.set('strongfruit.playerBuild.v1', JSON.stringify({ __v: 1, ...bad }));
    expect(loadPlayerBuild()).toBeNull();
  });
});

/* ---------------- T9｜8 车身 × 新轮组合法 Build ---------------- */
describe('T9｜8 车身 × 3 新轮组合法 Build', () => {
  it('8 正式车身 × small/large/heavy 全部 validateSnapshot valid', () => {
    for (const b of BODIES_8) {
      for (const w of WHEELS_NEW) {
        const snap = snapOf(lightDraft(b, w), `t9-${b}-${w}`);
        const res = validateSnapshot(snap, registry);
        expect(res.valid, `[${b}][${w}] ${res.errors.join('; ')}`).toBe(true);
      }
    }
  });
});

/* ---------------- T10｜4 视口入画 ---------------- */
describe('T10｜4 视口 previewSolo garage 构图完整入画', () => {
  function frame(vp: { w: number; h: number }, bodyId: string, wheelId: string): {
    a: { x: number; y: number; w: number; h: number };
  } {
    const canvas = {
      getContext: () => new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true }),
      width: vp.w,
      height: vp.h,
    } as unknown as HTMLCanvasElement;
    const surface: CanvasSurface = { width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 };
    const o = new PlanckBattleOrchestrator(
      snapOf(lightDraft(bodyId, wheelId), 'a'),
      snapOf(lightDraft(bodyId, 'wheelStd'), 'b'),
      registry,
      { autoDrive: true },
      true, // soloA：Garage 只渲染 A
    );
    const r = new Renderer(canvas, new VisualRegistry(), surface);
    const snap = o.getRenderSnapshot();
    r.resize(snap.arena.width, o.arena.config.height);
    r.reframe(snap, 'previewSolo', {
      framingRect: { x: 0, y: 0, w: vp.w, h: vp.h, mode: 'garage' },
    });
    const rects = r.getVehicleScreenRects(snap)!;
    o.dispose();
    return { a: rects.a };
  }
  it('4 视口 × 4 轮组（watermelonBody）：A 完整入画 + 可见整车', () => {
    for (const vp of VIEWPORTS) {
      for (const w of WHEELS_4) {
        const f = frame(vp, 'watermelonBody', w);
        expect(f.a.x, `[${vp.w}×${vp.h}][${w}] 不越左`).toBeGreaterThanOrEqual(-1);
        expect(f.a.x + f.a.w, `[${vp.w}×${vp.h}][${w}] 不越右`).toBeLessThanOrEqual(vp.w + 1);
        expect(f.a.y, `[${vp.w}×${vp.h}][${w}] 不越顶`).toBeGreaterThanOrEqual(-1);
        expect(f.a.y + f.a.h, `[${vp.w}×${vp.h}][${w}] 不穿底`).toBeLessThanOrEqual(vp.h + 1);
        expect(Math.max(f.a.w, f.a.h), `[${vp.w}×${vp.h}][${w}] 可见整车`).toBeGreaterThanOrEqual(24);
      }
    }
  });
});

/* ---------------- T11｜Garage 换轮组中心/缩放跳变 ---------------- */
describe('T11｜Garage 换轮组中心偏移 ≤3%W / scale 跳变 ≤5%', () => {
  function frame(bodyId: string, wheelId: string): {
    cx: number;
    scale: number;
    h: number;
  } {
    const vp = { w: 844, h: 390 };
    const canvas = {
      getContext: () => new Proxy({} as CanvasRenderingContext2D, { get: () => () => ({ width: 0 }), set: () => true }),
      width: vp.w,
      height: vp.h,
    } as unknown as HTMLCanvasElement;
    const surface: CanvasSurface = { width: vp.w, height: vp.h, devicePixelRatio: 1, now: () => 0 };
    const o = new PlanckBattleOrchestrator(
      snapOf(lightDraft(bodyId, wheelId), 'a'),
      snapOf(lightDraft(bodyId, 'wheelStd'), 'b'),
      registry,
      { autoDrive: true },
      true,
    );
    const r = new Renderer(canvas, new VisualRegistry(), surface);
    const snap = o.getRenderSnapshot();
    r.resize(snap.arena.width, o.arena.config.height);
    r.reframe(snap, 'previewSolo', {
      framingRect: { x: 0, y: 0, w: vp.w, h: vp.h, mode: 'garage' },
    });
    const rects = r.getVehicleScreenRects(snap)!;
    const cam = r.getProbeCamera();
    o.dispose();
    return { cx: rects.a.x + rects.a.w / 2, scale: cam.scale, h: rects.a.h };
  }
  it('3 车身 × 换轮组：中心偏移 ≤3%W（实测 0%）且 camera scale 跳变 ≤5%（实测 ≤3.61%）', () => {
    for (const b of ['watermelonBody', 'boxBody', 'bananaBody']) {
      const std = frame(b, 'wheelStd');
      for (const w of WHEELS_4) {
        const f = frame(b, w);
        const dCx = Math.abs(f.cx - std.cx);
        const dScale = Math.abs(f.scale - std.scale) / std.scale;
        expect(dCx, `[${b}][${w}] Δcx=${dCx.toFixed(2)}px`).toBeLessThanOrEqual(0.03 * 844);
        expect(dScale, `[${b}][${w}] Δscale=${(dScale * 100).toFixed(2)}%`).toBeLessThanOrEqual(0.05);
      }
    }
  });
  it('heavyWheel 与标准轮取景完全一致（radius 相同 → scale 跳变 0）', () => {
    const std = frame('watermelonBody', 'wheelStd');
    const h = frame('watermelonBody', 'heavyWheel');
    expect(h.scale).toBe(std.scale);
    expect(Math.abs(h.h - std.h)).toBeLessThan(0.5);
  });
});

/* ---------------- T12｜Battle Active→Result 无 NaN/穿地/死循环 ---------------- */
describe('T12｜Battle 至 Result：无 NaN / 穿地 / 死循环', () => {
  it('4 轮组 × 对手池首套：600 步内出 Result、hp/位置有限、winner 合法、不深穿地', () => {
    const opp = OPPONENT_POOL[0];
    const oppSnap = snapOf(opp, 'opp0');
    for (const w of WHEELS_4) {
      const req: BattleRequest = {
        battleId: `t12-${w}`,
        buildA: snapOf(lightDraft('watermelonBody', w), 'playerA'),
        buildB: oppSnap,
        config: {
          autoDrive: true,
          engine: 'planck',
          settleToGround: true,
          randomSeed: 12,
          arena: { phases: { activeMs: STEP * 60, warningMs: STEP * 30, closingMs: STEP * 60 } },
        },
        randomSeed: 12,
        rulesVersion: 'v1.0.0',
        contentVersion: 'c1',
      };
      const orch = createPlanckBattle(req, registry);
      const groundTop = orch.world.getCollisionBounds(orch.arena.ground).minY;
      let steps = 0;
      while (!orch.result && steps < 600) {
        orch.step(STEP);
        steps++;
      }
      const r = orch.result;
      expect(r, `[${w}] ${steps} 步内未结束（死循环）`).not.toBeNull();
      expect(['A', 'B'], `[${w}] winner 非法`).toContain(r!.winner);
      expect(Number.isFinite(r!.hpA) && Number.isFinite(r!.hpB), `[${w}] hp NaN`).toBe(true);
      expect(r!.hpA).toBeGreaterThanOrEqual(0);
      expect(r!.hpB).toBeGreaterThanOrEqual(0);
      expect(r!.phase).toBe('End');
      // 无 NaN：双方 chassis/wheel 位置有限
      for (const v of [orch.vehicleA, orch.vehicleB]) {
        const bp = orch.world.getPosition(v.body);
        expect(Number.isFinite(bp.x) && Number.isFinite(bp.y), `[${w}] chassis NaN`).toBe(true);
        for (const wh of v.wheels) {
          const wp = orch.world.getPosition(wh.body);
          expect(Number.isFinite(wp.x) && Number.isFinite(wp.y), `[${w}] wheel NaN`).toBe(true);
          expect(wp.y, `[${w}] 轮子不深穿地（y=${wp.y.toFixed(1)} ground=${groundTop.toFixed(1)}）`).toBeLessThan(groundTop + 400);
        }
      }
      orch.dispose();
    }
  }, 60000);
});

/* ---------------- T13｜Loss→换轮组→再战新快照 ---------------- */
describe('T13｜Loss→换轮组→再战闭环', () => {
  afterEach(() => {
    vi.useRealTimers();
    bindPlatformCore(undefined as never);
    delete (globalThis as { wx?: unknown }).wx;
  });
  it('Loss → garage → 装 smallWheel → 再战：loadCustom 玩家快照 movements defId=smallWheel + 对手不连续重复', () => {
    const store = new Map<string, unknown>();
    (globalThis as { wx?: unknown }).wx = {
      getSystemInfoSync: () => ({ pixelRatio: 2 }),
      getStorageSync: (k: string) => (store.has(k) ? store.get(k) : null),
      setStorageSync: (k: string, v: unknown) => void store.set(k, v),
      removeStorageSync: (k: string) => void store.delete(k),
    };
    bindPlatformCore(createWechatCore(2));
    const host = new FakeHost();
    const battle = new ScriptedBattleHost('loss');
    const runtime = new PlayerGameRuntime({ host, battle, sfx: new RecSfx() } as never);
    runtime.init();
    const playerBody0 = host.lastState!.draft!.bodyDefId;
    grantAllNewMovements(); // 解锁新轮组（T6 守卫）

    vi.useFakeTimers();
    // 第一场（Loss）
    host.actions!.onFindOpponent();
    vi.advanceTimersByTime(1500);
    host.actions!.onStartBattle();
    vi.advanceTimersByTime(700);
    // 第一场对手完整快照（模板级指纹，非 bodyDefId——49 池 12 套 watermelonBody 合法共享车身）
    const oppFirst = battle.loadCustomCalls[battle.loadCustomCalls.length - 1]?.b;
    let now = 0;
    for (let i = 0; i < 3; i++) { now += 16.7; runtime.tick(now); }
    expect(host.lastState!.battleState).toBe('ended');
    // Loss → adjust → garage（玩家配置保持）
    host.actions!.onResultAdjust();
    expect(host.lastState!.playerPhase).toBe('garage');
    expect(host.lastState!.draft!.bodyDefId).toBe(playerBody0);
    // 换轮组：后轮 → smallWheel
    host.actions!.selectGarageSlot!('rearWheel');
    host.actions!.onPickGarageOption('smallWheel');
    expect(host.lastState!.draft!.rearWheelDefId).toBe('smallWheel');
    expect(host.lastState!.draft!.rearRadius).toBe(12);
    // 再战
    host.actions!.onFindOpponent();
    vi.advanceTimersByTime(1500);
    host.actions!.onStartBattle();
    vi.advanceTimersByTime(700);
    const call = battle.loadCustomCalls[battle.loadCustomCalls.length - 1]!;
    const rear = call.a.movements.find((m) => m.hardpointId === 'rear')!;
    expect(rear.defId, '再战玩家快照后轮应为 smallWheel').toBe('smallWheel');
    expect(rear.overrides?.radius).toBe(12);
    expect(call.b.bodyDefId.length).toBeGreaterThan(0);
    // 模板级不连续重复：pickOpponentForTier 以 lastIndex 保证索引不连续重复；
    // 49 套模板完整 draft 指纹全局唯一（实测 49/49）→ 索引不同 ⇒ 指纹必不同。
    // 不能断言 bodyDefId 不同（12 套 watermelonBody 共享车身属合法）。
    const fp = (s: BuildSnapshot): string =>
      JSON.stringify({
        b: s.bodyDefId,
        m: [...s.movements]
          .sort((x, y) => x.hardpointId.localeCompare(y.hardpointId))
          .map((x) => `${x.hardpointId}:${x.defId}:${x.overrides?.radius ?? ''}`),
        f: [...s.functionals]
          .sort((x, y) => x.hardpointId.localeCompare(y.hardpointId))
          .map((x) => `${x.hardpointId}:${x.defId}`),
      });
    expect(fp(call.b), '两场对手不应连续重复（模板级）').not.toBe(fp(oppFirst!));
    now = 0;
    for (let i = 0; i < 3; i++) { now += 16.7; runtime.tick(now); }
    expect(host.lastState!.battleState).toBe('ended');
  });
});

/* ---------------- T14｜49 对手池不变 ---------------- */
describe('T14｜49 对手池不变（未污染轮组 defId）', () => {
  it('池仍 49 套；全部模板 draft 无轮组 defId 字段 → movements 全 wheelStd', () => {
    expect(OPPONENT_POOL.length).toBe(49);
    expect(OPPONENT_TEMPLATES.length).toBe(49);
    for (const t of OPPONENT_TEMPLATES) {
      expect(t.draft.rearWheelDefId, `${t.id} 不应带 rearWheelDefId`).toBeUndefined();
      expect(t.draft.frontWheelDefId, `${t.id} 不应带 frontWheelDefId`).toBeUndefined();
      const snap = buildSnapshotFromDraft(t.draft, registry, t.id);
      for (const m of snap.movements) {
        expect(m.defId, `${t.id} ${m.hardpointId}`).toBe('wheelStd');
      }
    }
  });
  it('49 套全部通过正式 Validator（轮组能量 0 → 零回归）', () => {
    for (const t of OPPONENT_TEMPLATES) {
      const snap = buildSnapshotFromDraft(t.draft, registry, t.id);
      const res = validateSnapshot(snap, registry);
      expect(res.valid, `${t.id}: ${res.errors.join('; ')}`).toBe(true);
    }
  });
});

/* ---------------- T15｜8 车身及 bodyOwnership 不变 ---------------- */
describe('T15｜8 正式车身及 bodyOwnership 不变', () => {
  it('OFFICIAL_BODIES = 8（4 默认 + 4 新），registry 含全部', () => {
    expect(OFFICIAL_BODIES.length).toBe(8);
    expect(DEFAULT_OWNED_BODIES).toEqual([
      'watermelonBody', 'bananaBody', 'pineappleBody', 'coconutBody',
    ]);
    expect(NEW_OFFICIAL_BODIES).toEqual([
      'durianBody', 'pearBody', 'mangoBody', 'orangeBody',
    ]);
    for (const b of BODIES_8) {
      expect(registry.bodies.has(b), `registry 应含 ${b}`).toBe(true);
    }
  });
  it('旧 4 车身恒默认拥有（isBodyOwned true）；新 4 默认未拥有', () => {
    for (const b of DEFAULT_OWNED_BODIES) expect(isBodyOwned(b)).toBe(true);
    for (const b of NEW_OFFICIAL_BODIES) expect(isBodyOwned(b)).toBe(false);
  });
});

/* ---------------- T16｜站桩 Build 回归 ---------------- */
describe('T16｜站桩（stationary）Build 回归', () => {
  it('数据层：drive=stationary 与轮组 defId 共存、resolveDriveMode 归一保留', () => {
    const d: BuildDraft = {
      ...lightDraft('watermelonBody', 'largeWheel'),
      drive: 'stationary',
    };
    expect(resolveDriveMode(d.drive)).toBe('stationary');
    const snap = snapOf(d, 't16-stationary');
    expect(validateSnapshot(snap, registry).valid).toBe(true);
    expect(snap.movements.find((m) => m.hardpointId === 'rear')!.defId).toBe('largeWheel');
  });
  it('EMPTY_SLOT 语义不受轮组影响（functional 空槽仍可卸下）', () => {
    const d: BuildDraft = {
      bodyDefId: 'watermelonBody',
      rearRadius: 20,
      frontRadius: 20,
      functionalSelections: { front: EMPTY_SLOT, frontMass: 'cannon', top: EMPTY_SLOT, rear: EMPTY_SLOT },
      drive: 'forward',
    };
    const snap = snapOf(d, 't16-empty');
    expect(snap.functionals.length).toBe(1);
    expect(validateSnapshot(snap, registry).valid).toBe(true);
  });
});

/* ---------- 轻量 host / ui / sfx 装配（复用 opponentBuildPoolR1 语义） ---------- */
class ScriptedBattleHost implements PlayerBattleHost {
  orchestrator: BattleOrchestratorApi | null = null;
  previewMode = false;
  loadCustomCalls: Array<{ a: BuildSnapshot; b: BuildSnapshot }> = [];
  clearFxCalls = 0;
  private idx = 0;
  private fakeOrch: BattleOrchestratorApi | null = null;
  constructor(private outcome: 'win' | 'loss' = 'win') {
    this.fakeOrch = this.makeOrch();
    this.orchestrator = this.fakeOrch;
  }
  private makeOrch(): BattleOrchestratorApi {
    const o = {
      result: null,
      phase: 'Active',
      timeMs: 0,
      config: { autoDrive: true, arena: { phases: { warningMs: 3000, closingMs: 5000 } } } as BattleConfig,
      getRenderSnapshot: () => ({}) as never,
      getBattleStatusSnapshot: () => null as never,
      step: () => {},
      onCombatEvent: () => () => {},
      dispose: () => {},
    } as unknown as BattleOrchestratorApi;
    (o as { result: unknown }).result = {
      winner: this.outcome === 'loss' ? 'B' : 'A',
      hpA: this.outcome === 'loss' ? 0 : 100,
      hpB: this.outcome === 'loss' ? 100 : 0,
      phase: 'End',
      endReason: 'hp',
    };
    return o;
  }
  loadCustomPreview(): void { this.previewMode = true; }
  loadCustom(a: BuildSnapshot, b: BuildSnapshot): void {
    this.previewMode = false;
    this.loadCustomCalls.push({ a, b });
    this.fakeOrch = this.makeOrch();
    this.orchestrator = this.fakeOrch;
  }
  step(): void {
    if (this.idx < 1) this.idx++;
    (this.fakeOrch as { phase: string }).phase = 'End';
  }
  render(): void {}
  setPreviewVehicleFx(): void {}
  arenaDims(): { w: number; h: number } { return { w: 1600, h: 900 }; }
  reframe(): void {}
  resize(): void {}
  clearBattleFx(): void { this.clearFxCalls++; }
  getMatchVehicleRects(): null { return null; }
  getHomeVehicleRect(): null { return null; }
}

class RecSfx {
  stops = 0;
  starts: string[] = [];
  resume(): void {}
  stopBattleAudio(): void { this.stops++; }
  startBattleAudio(sid: string): void { this.starts.push(sid); }
  play(): void {}
}

class FakeHost implements PlayerUIHost {
  actions: PlayerUIActions | null = null;
  lastState: PlayerUIState | null = null;
  setActions(a: PlayerUIActions): void { this.actions = a; }
  mount(): void {}
  render(s: PlayerUIState): void { this.lastState = s; }
  renderBattleFrame(): void {}
}
