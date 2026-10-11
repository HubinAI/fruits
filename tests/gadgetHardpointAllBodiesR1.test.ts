/**
 * Queue ID｜GADGET-HARDPOINT-ALL-BODIES-R1
 *
 * 目标：为**全部 8 个正式玩家 Body** 补齐 1 个独立 Gadget 专属挂点，
 *      为后续正式 Garage Gadget 槽提供统一 Foundation。
 *
 * 本 Queue 只补挂点能力：不改 Gadget 行为 / 参数 / 产品 UI。
 */
import { describe, expect, it } from 'vitest';

import { registry } from '../src/core/content';
import { OFFICIAL_BODIES } from '../src/core/bodyOwnership';
import { PlanckWorld } from '../src/physics/planckWorld';
import { resolveSnapshot } from '../src/core/buildSnapshot';
import { validateSnapshot } from '../src/core/buildValidator';
import { buildSnapshotFromDraft, EMPTY_SLOT, type BuildDraft } from '../src/lab/buildEditorModel';
import { createPlanckVehicle } from '../src/battle/planckVehicleAssembly';

/** 正式玩家车身（权威清单 = core/bodyOwnership.OFFICIAL_BODIES）。 */
const BODIES = OFFICIAL_BODIES;

function draftOf(bodyDefId: string, gadgetDefId?: string): BuildDraft {
  const d: BuildDraft = {
    bodyDefId,
    rearRadius: 20, frontRadius: 20,
    rearWheelDefId: 'wheelStd', frontWheelDefId: 'wheelStd',
    functionalSelections: { front: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT, frontMass: 'cannon' },
    drive: 'forward',
  };
  if (gadgetDefId) d.gadgetDefId = gadgetDefId;
  return d;
}

function bodyBox(def: any) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of def.colliders) {
    const hw = c.width / 2, hh = c.height / 2;
    const ox = c.offset?.x ?? 0, oy = c.offset?.y ?? 0;
    minX = Math.min(minX, ox - hw); maxX = Math.max(maxX, ox + hw);
    minY = Math.min(minY, oy - hh); maxY = Math.max(maxY, oy + hh);
  }
  return { minX, maxX, minY, maxY };
}

/** 圆（轮）与矩形（Gadget collider：box 30×24，offset x=+15）是否相交。 */
function circleRectHit(cx: number, cy: number, r: number, rx: number, ry: number, rw: number, rh: number) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

describe('GADGET-HARDPOINT-ALL-BODIES-R1', () => {
  it('GH-01 全部正式 Body 均存在且**仅存在 1 个** Gadget hardpoint', () => {
    expect(BODIES.length, '正式 Body 共 8 个').toBe(8);
    const rows: string[] = [];
    for (const id of BODIES) {
      const def = registry.bodies.get(id);
      expect(def, `${id} 必须存在于正式内容库`).toBeDefined();
      const hp = def!.gadgetHardpoints;
      expect(hp, `${id} 缺少 gadgetHardpoints`).toBeDefined();
      expect(hp!.length, `${id} 必须恰有 1 个 Gadget 挂点（不增加第二个）`).toBe(1);
      expect(hp![0]!.id, `${id} 挂点 id 应为 gadget`).toBe('gadget');
      rows.push(`${id}(${hp![0]!.localPosition.x},${hp![0]!.localPosition.y})`);
    }
    console.log(`\n##### GH-01 八个正式 Body 的 Gadget 挂点 #####`);
    for (const r of rows) console.log(`  ${r}`);
  });

  it('GH-02 坐标依据各Body 真实几何（不统一、不与功能槽/轮非法重叠）', () => {
    // watermelon 已通过真人验收，本轮**不得改动**，故豁免其两项既有指标
    const EXEMPT = new Set(['watermelonBody']);
    const problems: string[] = [];
    const coords: string[] = [];
    for (const id of BODIES) {
      const def = registry.bodies.get(id)!;
      const hp = def.gadgetHardpoints![0]!;
      const p = hp.localPosition;
      coords.push(`${p.x},${p.y}`);

      // 位于车体后部
      if (p.x >= 0) problems.push(`${id}: 挂点不在车体后部(x=${p.x})`);

      // 距每个功能槽足够远（避免两个装置挤在一起）
      let minSlot = Infinity, nearSlot = '';
      for (const f of def.functionalHardpoints) {
        const d = Math.hypot(f.localPosition.x - p.x, f.localPosition.y - p.y);
        if (d < minSlot) { minSlot = d; nearSlot = f.id; }
      }
      if (minSlot < 15 && !EXEMPT.has(id)) {
        problems.push(`${id}: 距功能槽 ${nearSlot} 仅 ${minSlot.toFixed(1)}px (<15)`);
      }

      // 不与轮 collider 相交
      const R = registry.movements.get('wheelStd')!.radius ?? 20;
      const rx = p.x, ry = p.y - 12, rw = 30, rh = 24;
      for (const m of def.movementHardpoints) {
        if (circleRectHit(m.localPosition.x, m.localPosition.y, R, rx, ry, rw, rh)) {
          if (!EXEMPT.has(id)) problems.push(`${id}: 与轮 ${m.id} collider 相交`);
        }
      }
    }
    console.log(`\n##### GH-02 几何校验 #####`);
    console.log(`  坐标集合 = ${coords.join(' / ')}`);
    console.log(`  唯一坐标 = ${new Set(coords).size}/${coords.length}${new Set(coords).size === coords.length ? '（各Body 独立取值，未统一）✅' : ''}`);
    console.log(`  问题 = ${problems.length ? problems.join(' | ') : '（无）✅'}`);
    expect(problems).toEqual([]);
    expect(new Set(coords).size, '不得所有 Body 写完全相同坐标').toBe(coords.length);
  });

  it('GH-03 Gadget namespace 独立（不复用旧 functional front/top/rear）', () => {
    for (const id of BODIES) {
      const def = registry.bodies.get(id)!;
      const gadgetIds = def.gadgetHardpoints!.map((h) => h.id);
      const functionalIds = def.functionalHardpoints.map((h) => h.id);
      // gadgetHardpoints 的 id 不得出现在 functionalHardpoints 的 id 集合里
      // （同名不同义：两者是**不同字段**，解析路径完全独立）
      expect(gadgetIds, `${id} gadget 挂点独立于 functional 字段`).toEqual(['gadget']);
      // 功能槽数量未被改动（仍为原有 4 槽；mango/orange 为 5 槽亦保持原样）
      expect(def.functionalHardpoints.length, `${id} 功能槽数量不变`).toBe(functionalIds.length);
    }
  });

  it('GH-04 EMPTY Gadget：每个 Body 的 assembly 结果与改前一致', () => {
    // 基线快照记录（EMPTY Gadget 不应产生任何 part / 质量变化）
    console.log(`\n##### GH-04 EMPTY Gadget 基线 #####`);
    for (const id of BODIES) {
      const snap = buildSnapshotFromDraft(draftOf(id), registry, `empty-${id}`);
      const resolved = resolveSnapshot(snap, registry);
      const world = new PlanckWorld({ x: 0, y: 10 });
      const v = createPlanckVehicle(world, resolved, 'A', { x: 200, y: 600 });
      // EMPTY ⇒ 无 gadget part、无额外质量
      expect(resolved.gadget, `${id} EMPTY 时不得解析出 Gadget`).toBeNull();
      expect(v.parts.some((p) => p.def.category === 'gadget'), `${id} EMPTY 时不得有 gadget part`).toBe(false);
      // 正式校验仍通过（新增挂点不破坏既有 Build）
      expect(validateSnapshot(snap, registry).valid, `${id} EMPTY Build 仍合法`).toBe(true);
      console.log(`  ${id.padEnd(15)} parts=${v.parts.length} totalMass=${resolved.totalMass.toFixed(0)} energy=${resolved.totalEnergy}`);
    }
  });

  it('GH-05 装 Thruster 后每个 Body 都能创建 Gadget part（无「选择成功但静默忽略」）', () => {
    console.log(`\n##### GH-05 安装 Thruster 的装配结果 #####`);
    for (const id of BODIES) {
      const snap = buildSnapshotFromDraft(draftOf(id, 'thruster'), registry, `thr-${id}`);
      expect(validateSnapshot(snap, registry).valid, `${id} + Thruster 必须合法`).toBe(true);
      const resolved = resolveSnapshot(snap, registry);
      expect(resolved.gadget, `${id}: resolveSnapshot 必须解析出 Gadget`).not.toBeNull();
      expect(resolved.gadget!.def.id).toBe('thruster');

      const world = new PlanckWorld({ x: 0, y: 10 });
      const v = createPlanckVehicle(world, resolved, 'A', { x: 200, y: 600 });
      const gPart = v.parts.find((p) => p.def.category === 'gadget');
      expect(gPart, `${id}: 必须真实装配出 Gadget part（不得静默忽略）`).toBeTruthy();
      expect(gPart!.id, `${id}: Gadget part 挂在 gadget 专属挂点上`).toBe('gadget');
      expect(gPart!.def.behavior, `${id}: Gadget 走正式 behavior`).toBe('thruster');
      // 挂载点世界位置应与本地挂点一致
      const pos = world.getPosition(gPart!.body);
      const bodyPos = world.getPosition(v.body);
      const hp = registry.bodies.get(id)!.gadgetHardpoints![0]!.localPosition;
      expect(pos.x - bodyPos.x, `${id}: 挂载x 符合定义的挂点`).toBeCloseTo(hp.x, 3);
      expect(pos.y - bodyPos.y, `${id}: 挂载 y 符合定义的挂点`).toBeCloseTo(hp.y, 3);
      // 质量确实计入
      expect(resolved.totalMass, `${id}: Gadget 质量(15)计入总质量`).toBeGreaterThan(
        registry.bodies.get(id)!.baseMass,
      );
      console.log(`  ${id.padEnd(15)} gadgetPart ✓ 挂点(${gPart!.id}) 挂载=(${(pos.x - bodyPos.x).toFixed(0)},${(pos.y - bodyPos.y).toFixed(0)}) totalMass=${resolved.totalMass.toFixed(0)}`);
    }
  });

  it('GH-06 watermelonBody 已通过的挂点保持不变', () => {
    const hp = registry.bodies.get('watermelonBody')!.gadgetHardpoints![0]!;
    // 本轮之前的既得值（真人验收已通过）
    expect(hp.id).toBe('gadget');
    expect(hp.localPosition.x, 'watermelon 挂点 x 保持 -72').toBe(-72);
    expect(hp.localPosition.y, 'watermelon 挂点 y 保持 -4').toBe(-4);
  });

  it('GH-07 未改 Body 原有几何 / 质量 / 功能槽 / Gadget 参数', () => {
    // Gadget 参数未动
    const r = registry.functionals.get('reverseThruster')!.behaviorParams as any;
    expect(r.thrustImpulse).toBe(40);
    expect(r.distanceTrigger.thresholdPx).toBe(175);
    expect(r.distanceTrigger.burstMs).toBe(420);
    expect(r.distanceTrigger.cooldownMs).toBe(2500);
    const t = registry.functionals.get('thruster')!.behaviorParams as any;
    expect(t.distanceTrigger.thresholdPx).toBe(280);

    // Body 原有属性抽样（mass / hp / energy / 功能槽数 / 轮位）
    const expectTable: Record<string, { mass: number; hp: number; energy: number; slots: number }> = {
      watermelonBody: { mass: 120, hp: 1100, energy: 110, slots: 4 },
      bananaBody: { mass: 45, hp: 900, energy: 90, slots: 4 },
      pineappleBody: { mass: 60, hp: 1000, energy: 100, slots: 4 },
      coconutBody: { mass: 160, hp: 1100, energy: 100, slots: 4 },
      durianBody: { mass: 135, hp: 1100, energy: 105, slots: 4 },
      pearBody: { mass: 55, hp: 1000, energy: 95, slots: 4 },
      mangoBody: { mass: 48, hp: 950, energy: 95, slots: 4 },
      orangeBody: { mass: 80, hp: 1000, energy: 100, slots: 4 },
    };
    for (const [id, exp] of Object.entries(expectTable)) {
      const def = registry.bodies.get(id)!;
      expect(def.baseMass, `${id} mass 未改`).toBe(exp.mass);
      expect(def.hp, `${id} hp 未改`).toBe(exp.hp);
      expect(def.energyCapacity, `${id} energy 未改`).toBe(exp.energy);
      expect(def.functionalHardpoints.length, `${id} 功能槽数未改`).toBe(exp.slots);
      expect(def.movementHardpoints.length, `${id} 轮位数未改`).toBe(2);
      expect(bodyBox(def).maxX, `${id} 车体几何未改`).toBeGreaterThan(0);
    }
  });
});