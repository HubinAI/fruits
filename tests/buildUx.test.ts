/**
 * Queue Q06-UX-R1｜Build 测试交互重构 targeted test（node 层可测部分）
 *
 * 覆盖 Q06-UX-R1 验收（DOM 粘合由 main.ts 承担）：
 * 1. loadCustomPreview → Planck + previewMode（autoDrive:false，不推进战斗）；
 * 2. preview step 不推进（位置不变）；loadCustom 正常推进（对照）；
 * 3. 默认 Draft（A boxBody+cannon / B heavyBox+cannon）→ valid（首屏 Start 可点前提）；
 * 4. 删掉最后 Weapon → invalid + 阻断原因「A：至少需要 1 件 Weapon」；
 * 5. 槽位自然名称（前端/前部/顶部/后端，内部 id 保留）；
 * 6. 修改部件（cannon→hammer）后 preview 立即重建（中央 A 外形变化）；
 * 7. 非法 Build 也创建 preview（裸车显示，仅禁止开始战斗）。
 *
 * Q06-UX-R2-FIX（补充）：装配 Preview 完整入画——默认 W2-SIL 双车
 * （watermelon/banana + pushRod/cannon/hammer + 双轮）在近距专属 spawn 下
 * 经真实 Planck Orchestrator + renderer 'preview' reframe，最终 screen bounds
 * 全部落在 safe viewport 内（body/wheels/parts 无一裁切）；正式 Battle spawn
 * 保持默认 400/1200 不变。
 */
import { describe, it, expect } from 'vitest';
import { PhysicsLab } from '../src/lab/physicsLab';
import { PlanckBattleOrchestrator } from '../src/battle/planckBattleOrchestrator';
import { createRegistry } from '../src/core/content';
import { SfxAudioService } from '../src/presentation/audioService';
import { BattlePresentationController } from '../src/presentation/battlePresentationController';
import { PART_OPTIONS } from '../src/core/partOptions';
import {
  buildSnapshotFromDraft,
  migrateDraftBody,
  slotLabel,
  SLOT_LABELS,
  EMPTY_SLOT,
  EDITABLE_FUNCTIONAL_DEF_IDS,
  type BuildDraft,
} from '../src/lab/buildEditorModel';
import { validateSnapshot, computeEnergy } from '../src/core/buildValidator';
import { Renderer } from '../src/render/renderer';
import { SCENARIOS } from '../src/lab/scenarios';
import type { BattleRenderSnapshot, RenderShape } from '../src/battle/battleContract';

const registry = createRegistry();
const rendererStub = { bind: () => {} } as unknown as Renderer;

function draft(
  bodyDefId: string,
  selections: Record<string, string>,
): BuildDraft {
  return { bodyDefId, rearRadius: 20, frontRadius: 20, functionalSelections: selections };
}

function snap(d: BuildDraft, id: string) {
  return buildSnapshotFromDraft(d, registry, id);
}

function behaviorsOfA(o: PlanckBattleOrchestrator): string[] {
  return o.vehicleA.parts.map((p) => p.def.behavior).sort();
}

describe('Q06-UX-R1 Build 交互', () => {
  it('1. loadCustomPreview → Planck + previewMode（autoDrive:false，不推进战斗）', () => {
    const lab = new PhysicsLab(rendererStub);
    const a = snap(draft('boxBody', { front: 'cannon' }), 'customA');
    const b = snap(draft('heavyBox', { front: 'cannon' }), 'customB');
    lab.loadCustomPreview(a, b);
    expect(lab.orchestrator instanceof PlanckBattleOrchestrator).toBe(true);
    expect(lab.previewMode).toBe(true);
    expect(lab.orchestrator!.config.autoDrive).toBe(false);
    // 预览对象可渲染（getRenderSnapshot 可用，不抛错）
    expect(() => lab.orchestrator!.getRenderSnapshot()).not.toThrow();
  });

  it('2. preview step 不推进（位置不变）；loadCustom 正常推进（对照）', () => {
    // Preview：跑 60 步，车辆位置不变（autoDrive:false + step 跳过）
    const pLab = new PhysicsLab(rendererStub);
    pLab.loadCustomPreview(
      snap(draft('boxBody', { front: 'cannon' }), 'A'),
      snap(draft('heavyBox', { front: 'cannon' }), 'B'),
    );
    const po = pLab.orchestrator as PlanckBattleOrchestrator;
    const px0 = po.world.getPosition(po.vehicleA.body).x;
    for (let i = 0; i < 60; i++) pLab.step(16.6667);
    expect(po.world.getPosition(po.vehicleA.body).x).toBeCloseTo(px0, 6);

    // Battle：loadCustom（autoDrive:true）step 会推进（A 向 B 移动）
    const bLab = new PhysicsLab(rendererStub);
    bLab.loadCustom(
      snap(draft('boxBody', { front: 'cannon' }), 'A'),
      snap(draft('heavyBox', { front: 'cannon' }), 'B'),
      { autoDrive: true, engine: 'planck' },
    );
    const bo = bLab.orchestrator as PlanckBattleOrchestrator;
    const bx0 = bo.world.getPosition(bo.vehicleA.body).x;
    for (let i = 0; i < 60; i++) bLab.step(16.6667);
    expect(bo.world.getPosition(bo.vehicleA.body).x).not.toBeCloseTo(bx0, 3);
  });

  it('3. 默认 Draft（A boxBody+cannon / B heavyBox+cannon）→ 均 valid（首屏 Start 可点）', () => {
    const a = snap(draft('boxBody', { front: 'cannon' }), 'customA');
    const b = snap(draft('heavyBox', { front: 'cannon' }), 'customB');
    expect(validateSnapshot(a, registry).valid).toBe(true);
    expect(validateSnapshot(b, registry).valid).toBe(true);
  });

  it('4. 删掉最后 Weapon → invalid + 阻断原因「A：至少需要 1 件 Weapon」', () => {
    const a = snap(
      draft('boxBody', { front: EMPTY_SLOT, frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT }),
      'customA',
    );
    const r = validateSnapshot(a, registry);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('Weapon'); // UI 在 Start 旁直接显示「A：至少需要 1 件 Weapon」
  });

  it('5. 槽位自然名称：前端挂点/前上挂点/顶部挂点/后部挂点（内部 id 保留）', () => {
    // W2-UX-R2：主标签用「挂点」位置语义（front/frontMass 不再作主视觉文字）
    expect(SLOT_LABELS).toEqual({
      front: '前端挂点',
      frontMass: '前上挂点',
      top: '顶部挂点',
      rear: '后部挂点',
    });
    expect(slotLabel('front')).toBe('前端挂点');
    expect(slotLabel('frontMass')).toBe('前上挂点');
    expect(slotLabel('top')).toBe('顶部挂点');
    expect(slotLabel('rear')).toBe('后部挂点');
    expect(slotLabel('unknown')).toBe('unknown'); // 未知回退原 id
  });

  it('6. 修改部件（cannon→hammer）后 preview 立即重建（中央 A 外形变化，不启动战斗）', () => {
    const lab = new PhysicsLab(rendererStub);
    const dA = draft('boxBody', { front: 'cannon' });
    const dB = draft('heavyBox', { front: 'cannon' });
    lab.loadCustomPreview(snap(dA, 'customA'), snap(dB, 'customB'));
    const o1 = lab.orchestrator as PlanckBattleOrchestrator;
    expect(behaviorsOfA(o1)).toEqual(['cannon']);

    // 编辑：front cannon → hammer（无需任何 Apply）
    dA.functionalSelections = { front: 'hammer', frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT };
    lab.loadCustomPreview(snap(dA, 'customA'), snap(dB, 'customB'));
    const o2 = lab.orchestrator as PlanckBattleOrchestrator;
    expect(o2).not.toBe(o1);
    expect(behaviorsOfA(o2)).toEqual(['hammer']); // 中央 A 立即变成 Hammer 外形
    expect(lab.previewMode).toBe(true); // 仍为预览，未启动战斗
  });

  it('7. 非法 Build（无 Weapon）也创建 preview（裸车显示；仅禁止开始战斗）', () => {
    const lab = new PhysicsLab(rendererStub);
    const invalidA = snap(
      draft('boxBody', { front: EMPTY_SLOT, frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT }),
      'customA',
    );
    expect(validateSnapshot(invalidA, registry).valid).toBe(false);
    // 仍可显示裸车 Preview（校验由 UI/Validator 负责，仅阻止开始战斗）
    expect(() =>
      lab.loadCustomPreview(
        invalidA,
        snap(draft('heavyBox', { front: 'cannon' }), 'customB'),
      ),
    ).not.toThrow();
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    expect(o instanceof PlanckBattleOrchestrator).toBe(true);
    expect(o.vehicleA.parts).toHaveLength(0); // 裸车（无功能部件）
    expect(o.vehicleA.wheels).toHaveLength(2);
  });
});

/* ---------- Q06-UX-R2-FIX：装配 Preview 完整入画（真实 Planck Runtime + renderer reframe） ---------- */

/** W2-SIL 默认装配 Draft（与 main.ts silDraft 一致）：front=pushRod / frontMass=cannon / top=hammer */
function silDraft(bodyDefId: string): BuildDraft {
  const body = registry.bodies.get(bodyDefId)!;
  const selections: Record<string, string> = {};
  for (const hp of body.functionalHardpoints) {
    if (hp.id === 'front') selections[hp.id] = 'pushRod';
    else if (hp.id === 'frontMass') selections[hp.id] = 'cannon';
    else if (hp.id === 'top') selections[hp.id] = 'hammer';
    else selections[hp.id] = EMPTY_SLOT;
  }
  return { bodyDefId, rearRadius: 20, frontRadius: 20, functionalSelections: selections };
}

/** 形状世界包围盒（与 renderer.reframe includeShape 同语义） */
function shapeWorldBounds(shape: RenderShape): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  if (shape.kind === 'polygons') {
    for (const poly of shape.polygons) for (const p of poly.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  } else {
    const c = shape.circle;
    minX = c.center.x - c.radius;
    maxX = c.center.x + c.radius;
    minY = c.center.y - c.radius;
    maxY = c.center.y + c.radius;
  }
  return { minX, minY, maxX, maxY };
}

/** 与 renderer.ts SAFE_INSET_X/Y 保持一致 */
const SAFE_INSET_X = 56;
const SAFE_INSET_Y = 28;

function makeCtxStubCanvas() {
  const ctx = {} as CanvasRenderingContext2D;
  return {
    width: 0,
    height: 0,
    clientWidth: 1000,
    clientHeight: 500,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
}

function expectInSafeViewport(
  renderer: Renderer,
  w: { minX: number; minY: number; maxX: number; maxY: number },
  label: string,
): void {
  const s = renderer.worldRectToScreen(w.minX, w.minY, w.maxX, w.maxY);
  expect(s.minX, `${label} 左缘入画`).toBeGreaterThanOrEqual(SAFE_INSET_X - 1e-6);
  expect(s.minY, `${label} 上缘入画`).toBeGreaterThanOrEqual(SAFE_INSET_Y - 1e-6);
  expect(s.maxX, `${label} 右缘入画`).toBeLessThanOrEqual(1000 - SAFE_INSET_X + 1e-6);
  expect(s.maxY, `${label} 下缘入画`).toBeLessThanOrEqual(500 - SAFE_INSET_Y + 1e-6);
}

/** 遍历车辆所有可视部分（body + wheels + parts），逐一断言完整入画 */
function expectVehicleFullyInView(renderer: Renderer, v: BattleRenderSnapshot['vehicleA'], label: string): void {
  expectInSafeViewport(renderer, shapeWorldBounds(v.body), `${label} body`);
  for (let i = 0; i < v.wheels.length; i++) {
    const w = v.wheels[i];
    expectInSafeViewport(
      renderer,
      { minX: w.center.x - w.radius, minY: w.center.y - w.radius, maxX: w.center.x + w.radius, maxY: w.center.y + w.radius },
      `${label} wheel${i}`,
    );
  }
  for (let i = 0; i < v.parts.length; i++) {
    expectInSafeViewport(renderer, shapeWorldBounds(v.parts[i].shape), `${label} part${i}`);
  }
}

describe('Q06-UX-R2-FIX 装配 Preview 完整入画', () => {
  it('1. 默认 W2-SIL 双车：专属近距 spawn 生效 + A/B body/wheels/parts 全部完整入画', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustomPreview(
      snap(silDraft('watermelonBody'), 'customA'),
      snap(silDraft('bananaBody'), 'customB'),
    );
    const po = lab.orchestrator as PlanckBattleOrchestrator;
    // 专属近距 spawn 生效（620/980，比正式 400/1200 明显靠近）
    expect(po.world.getPosition(po.vehicleA.body).x).toBeCloseTo(620, 6);
    expect(po.world.getPosition(po.vehicleB.body).x).toBeCloseTo(980, 6);
    // preview 不推进
    expect(lab.previewMode).toBe(true);
    expect(po.config.autoDrive).toBe(false);

    const renderer = new Renderer(makeCtxStubCanvas());
    const shot = po.getRenderSnapshot();
    renderer.reframe(shot, 'preview');
    const previewScale = renderer.transformScale;
    expectVehicleFullyInView(renderer, shot.vehicleA, 'A');
    expectVehicleFullyInView(renderer, shot.vehicleB, 'B');

    // 对照：vehicles fit（正式场景构图语义）应明显小于 preview（近距 spawn + 小边距）
    renderer.reframe(shot, 'vehicles');
    expect(previewScale).toBeGreaterThan(renderer.transformScale);
  });

  it('2. 变化 Build（A front pushRod→cannon）重建后重新 reframe 仍完整入画', () => {
    const lab = new PhysicsLab(rendererStub);
    const dA = silDraft('watermelonBody');
    const dB = silDraft('bananaBody');
    lab.loadCustomPreview(snap(dA, 'customA'), snap(dB, 'customB'));
    // 编辑 A：front 挂点 pushRod → cannon（每次选择后 Preview 立即重建）
    dA.functionalSelections = {
      front: 'cannon',
      frontMass: 'cannon',
      top: 'hammer',
      rear: EMPTY_SLOT,
    };
    lab.loadCustomPreview(snap(dA, 'customA'), snap(dB, 'customB'));
    const po = lab.orchestrator as PlanckBattleOrchestrator;
    const renderer = new Renderer(makeCtxStubCanvas());
    renderer.reframe(po.getRenderSnapshot(), 'preview');
    expectVehicleFullyInView(renderer, po.getRenderSnapshot().vehicleA, 'A');
    expectVehicleFullyInView(renderer, po.getRenderSnapshot().vehicleB, 'B');
  });

  it('3. 正式 Battle spawn 不受 Preview 影响（loadCustom planck 默认仍 400/1200）', () => {
    const lab = new PhysicsLab(rendererStub);
    // 显式 planck（引擎中立路径），但不传 spawn → 走 Orchestrator 默认 400/1200
    lab.loadCustom(
      snap(silDraft('watermelonBody'), 'customA'),
      snap(silDraft('bananaBody'), 'customB'),
      { engine: 'planck' },
    );
    const bo = lab.orchestrator as PlanckBattleOrchestrator;
    // 正式路径默认 spawn 未被 Preview 近距 spawn 影响（400/1200 不变）
    expect(bo.world.getPosition(bo.vehicleA.body).x).toBeCloseTo(400, 6);
    expect(bo.world.getPosition(bo.vehicleB.body).x).toBeCloseTo(1200, 6);
    expect(lab.previewMode).toBe(false);
  });
});

/* ---------- Q09-A：Body / Wheel 去表单化（卡片选择语义） ---------- */
describe('Q09-A Body/Wheel 卡片选择语义', () => {
  it('任意 Body 卡片点击（migrateDraftBody）后：真实挂点一致 / 无虚假槽 / Validator 不崩', () => {
    const bodies = ['wedgeBody', 'boxBody', 'tallBody', 'heavyBox', 'watermelonBody', 'bananaBody'];
    for (const target of bodies) {
      // 模拟卡片点击：从默认 W2-SIL（watermelon）切到目标 Body
      const d = silDraft('watermelonBody');
      const migrated = migrateDraftBody(d, target, registry);
      d.bodyDefId = migrated.bodyDefId;
      d.functionalSelections = migrated.functionalSelections;
      const body = registry.bodies.get(target)!;
      const hpIds = body.functionalHardpoints.map((hp) => hp.id);
      // 每个真实挂点都有选择（新挂点空；同 ID 保留）
      for (const hp of hpIds) {
        expect(d.functionalSelections, `${target} 挂点 ${hp} 存在`).toHaveProperty(hp);
      }
      // 无虚假槽位（不产生不存在的 hardpoint）
      for (const key of Object.keys(d.functionalSelections)) {
        expect(hpIds, `${target} 无虚假槽 ${key}`).toContain(key);
      }
      // 迁移后可产出 snapshot 且 Validator 不崩（Start/Validator 无回归）
      const s = buildSnapshotFromDraft(d, registry, 'A');
      expect(() => validateSnapshot(s, registry)).not.toThrow();
    }
  });
});

/* ---------- Q09-B：部件选择信息可读性（数据源：名称 + Weapon/Gadget + Energy） ---------- */
describe('Q09-B 部件信息可读性', () => {
  it('Cannon/Hammer 为 Weapon、Push Rod 为 Gadget，Energy 数值与 UI 读取一致', () => {
    const cannon = registry.functionals.get('cannon')!;
    expect(cannon.category).toBe('weapon');
    expect(cannon.energy).toBe(30);
    const hammer = registry.functionals.get('hammer')!;
    expect(hammer.category).toBe('weapon');
    expect(hammer.energy).toBe(25);
    const pushRod = registry.functionals.get('pushRod')!;
    expect(pushRod.category).toBe('gadget');
    expect(pushRod.energy).toBe(20);
    // 空选项无部件数据（UI 显示「空 · 0 能量」）
    expect(registry.functionals.has('')).toBe(false);
  });
});

/* ---------- Q10-A：正式装配内容与测试内容分离 ---------- */
describe('Q10-A 正式/测试内容分离', () => {
  it('测试 Body（wedge/box/tall/heavy）仍完整保留在 registry，不删 Content 定义', () => {
    for (const id of ['wedgeBody', 'boxBody', 'tallBody', 'heavyBox']) {
      expect(registry.bodies.has(id), `${id} 保留`).toBe(true);
    }
    // 正式内容同在
    expect(registry.bodies.has('watermelonBody')).toBe(true);
    expect(registry.bodies.has('bananaBody')).toBe(true);
    // 测试 Body 的迁移/快照链路仍可用（开发测试链不受装配页收敛影响）
    for (const id of ['wedgeBody', 'boxBody', 'tallBody', 'heavyBox']) {
      const d = silDraft(id); // 仍可构造测试 Draft
      const s = buildSnapshotFromDraft(d, registry, 'A');
      expect(() => validateSnapshot(s, registry)).not.toThrow();
    }
  });
});

/* ---------- Q10-B：玩家侧命名（炮/锤/推杆；武器/辅助；defId 不变） ---------- */
describe('Q10-B 玩家侧命名', () => {
  it('部件显示名为中文（炮/锤/推杆），内部 defId 保持英文不变', () => {
    expect(registry.functionals.get('cannon')!.name).toBe('炮');
    expect(registry.functionals.get('hammer')!.name).toBe('锤');
    expect(registry.functionals.get('pushRod')!.name).toBe('推杆');
    // 内部 ID 不变（挂点选择/快照/迁移全部走 defId）
    expect(registry.functionals.get('cannon')!.id).toBe('cannon');
    expect(registry.functionals.get('hammer')!.id).toBe('hammer');
    expect(registry.functionals.get('pushRod')!.id).toBe('pushRod');
    // 类别（UI 映射为 武器/辅助）数据源不变
    expect(registry.functionals.get('cannon')!.category).toBe('weapon');
    expect(registry.functionals.get('pushRod')!.category).toBe('gadget');
  });
});

/* ---------- Q11-A：楔铲 Gadget（低矮楔形 polygon，无 Direct Damage，真实碰撞掀翻） ---------- */
describe('Q11-A 楔铲 Gadget', () => {
  it('1. wedgeShovel 定义：gadget / polygon 楔形 / 无 baseDamage / 无 behavior', () => {
    const def = registry.functionals.get('wedgeShovel');
    expect(def).toBeDefined();
    expect(def!.category).toBe('gadget');
    expect(def!.collider.shape).toBe('polygon'); // 低矮楔形多边形
    expect(def!.behavior).toBe('none'); // 无主动动画
    expect((def!.behaviorParams as Record<string, unknown> | undefined)?.baseDamage).toBeUndefined(); // 无 Direct Weapon Damage
    expect(def!.energy).toBeGreaterThan(0);
    expect(def!.mass).toBeGreaterThan(0);
  });

  it('2. Q11 场景（banana 目标）：楔铲短陡坡 → 碰墙前 B 前轮明显离地 + 明显抬头（grounded 变化）；A 真实反作用', () => {
    const lab = new PhysicsLab(rendererStub);
    const sc = SCENARIOS.find((s) => s.id === 'Q11');
    expect(sc).toBeDefined();
    expect(sc!.buildB.bodyDefId).toBe('bananaBody'); // R2：正式 banana 目标（非 boxBody）
    lab.loadScenario(sc!);
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    const w = o.world;
    const GROUND_Y = 700;
    let phase0 = o.phase;
    // 碰墙/Closing 前的峰值（不依赖墙/Closing 才翻——R2 硬约束）
    let prePitch = 0;
    let preFrontLift = 0;
    let maxAPitch = 0;
    for (let i = 0; i < 1200; i++) {
      lab.step(16.6667);
      if (o.phase !== phase0) {
        if (o.phase !== 'Active') break; // 进入 Warning/Closing 即停止累计（碰墙前）
        phase0 = o.phase;
      }
      const bAng = Math.abs(w.getAngle(o.vehicleB.body));
      // banana 前轮离地：轮心 y < groundY - 半径(20) - 0.5
      const frontLift = Math.max(
        0,
        ...o.vehicleB.wheels.map((wh) => Math.max(0, GROUND_Y - 20 - 0.5 - w.getPosition(wh.body).y)),
      );
      prePitch = Math.max(prePitch, bAng);
      preFrontLift = Math.max(preFrontLift, frontLift);
      maxAPitch = Math.max(maxAPitch, Math.abs(w.getAngle(o.vehicleA.body)));
      if (o.result?.phase === 'End') break;
    }
    // Q11-A-R2（短陡 24.6° 坡 + banana）：第一次接触后 banana 前轮沿坡爬升——
    // 实测前轮离地 21px（轮半径 20 完全离地，明显 grounded 变化）+ 抬头 ~10°，
    // 全部发生在碰墙/Closing 之前（t≈4s vs Closing 10s）。
    expect(preFrontLift).toBeGreaterThan(15); // 前轮明显离地
    expect(prePitch * 57.3).toBeGreaterThan(7); // 明显抬头
    // 自车承担真实碰撞反作用（无隐藏力/无补偿）
    expect(maxAPitch * 57.3).toBeGreaterThan(0.5);
  });

  it('3. Q11 场景：楔铲没钻入对手底部时允许失败（B 在 A 后方，全程无自动翻车）', () => {
    const lab = new PhysicsLab(rendererStub);
    const sc = SCENARIOS.find((s) => s.id === 'Q11');
    expect(sc).toBeDefined();
    // B 放在 A 后方（背向而驰）：楔铲朝 +X 永远够不到 B 底盘
    lab.loadCustom(sc!.buildA, sc!.buildB, {
      engine: 'planck',
      autoDrive: true,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 250, y: 650, facing: -1 },
    });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    const w = o.world;
    let maxBPitch = 0;
    let maxBLift = 0;
    const y0 = w.getPosition(o.vehicleB.body).y;
    for (let i = 0; i < 900; i++) {
      lab.step(16.6667);
      maxBPitch = Math.max(maxBPitch, Math.abs(w.getAngle(o.vehicleB.body)));
      maxBLift = Math.max(maxBLift, y0 - w.getPosition(o.vehicleB.body).y);
      if (o.result?.phase === 'End') break;
    }
    // 接触位置不合适 → B 无姿态改变（无隐藏力 / 无自动翻车）
    expect(maxBPitch * 57.3).toBeLessThan(5);
    expect(maxBLift).toBeLessThan(20);
  });
});

/* ---------- Q11-B：固定刺 Weapon（细长前伸 / 高度决定命中 / 擦空即 Miss） ---------- */
describe('Q11-B 固定刺 Weapon', () => {
  function spearSnapshot(bodyDefId: string, side: 'A' | 'B'): ReturnType<typeof buildSnapshotFromDraft> {
    return buildSnapshotFromDraft(
      {
        bodyDefId,
        rearRadius: 20,
        frontRadius: 20,
        functionalSelections: {
          front: EMPTY_SLOT,
          frontMass: EMPTY_SLOT,
          top: 'spear',
          rear: EMPTY_SLOT,
        },
      },
      registry,
      side,
    );
  }

  it('1. spear 定义：weapon / 细长 polygon（前端刺尖）/ baseDamage / 无追踪行为', () => {
    const def = registry.functionals.get('spear');
    expect(def).toBeDefined();
    expect(def!.category).toBe('weapon');
    expect(def!.collider.shape).toBe('polygon');
    const vs = def!.collider.vertices!;
    // 前端刺尖最远（x 最大），细长（y 范围小）
    const maxX = Math.max(...vs.map((v) => v.x));
    const ySpan = Math.max(...vs.map((v) => v.y)) - Math.min(...vs.map((v) => v.y));
    expect(maxX).toBeGreaterThan(60); // 前向长距离
    expect(ySpan).toBeLessThan(20); // 细长（窄命中区）
    expect((def!.behaviorParams as Record<string, unknown>).baseDamage).toBeGreaterThan(0);
    expect(def!.behavior).toBe('ram'); // 固定接触（ramHead 同链路，无追踪）
  });

  it('2. 高度对上（tallBody 高车）→ 刺尖真实接触命中（weapon damage > 0）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(SCENARIOS.find((s) => s.id === 'Q11-B')!);
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let weaponDmgOnB = 0;
    o.onCombatEvent((ev) => {
      if (ev.type === 'damage' && ev.damageSource === 'weapon' && ev.target === 'B') {
        weaponDmgOnB += ev.damage;
      }
    });
    for (let i = 0; i < 1200; i++) {
      lab.step(16.6667);
      if (o.result?.phase === 'End') break;
    }
    expect(weaponDmgOnB).toBeGreaterThan(0); // 真实碰到才伤害
  });

  it('3. 高度错开（boxBody + 12 小轮矮车）→ 刺从上方自然擦空（weapon damage = 0, Miss）', () => {
    const lab = new PhysicsLab(rendererStub);
    // A 刺车（20 轮）+ B 矮车（boxBody + 12 小轮）——刺尖高度高于 B 顶部 → 擦空
    const bLow = buildSnapshotFromDraft(
      {
        bodyDefId: 'boxBody',
        rearRadius: 12,
        frontRadius: 12,
        functionalSelections: { front: EMPTY_SLOT, frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT },
      },
      registry,
      'B',
    );
    lab.loadCustom(spearSnapshot('watermelonBody', 'A'), bLow, { autoDrive: true, engine: 'planck' });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let weaponDmgOnB = 0;
    o.onCombatEvent((ev) => {
      if (ev.type === 'damage' && ev.damageSource === 'weapon' && ev.target === 'B') {
        weaponDmgOnB += ev.damage;
      }
    });
    for (let i = 0; i < 1200; i++) {
      lab.step(16.6667);
      if (o.result?.phase === 'End') break;
    }
    expect(weaponDmgOnB).toBe(0); // 擦空就是 Miss
  });
});

/* ---------- Q11-C：蓄能镭射 Weapon（长前摇 / 高威胁 / 强后坐；真实 Projectile 链路） ---------- */
describe('Q11-C 蓄能镭射 Weapon', () => {
  function laserSnapshot(side: 'A' | 'B') {
    return buildSnapshotFromDraft(
      {
        bodyDefId: 'watermelonBody',
        rearRadius: 20,
        frontRadius: 20,
        functionalSelections: { front: 'laser', frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT },
      },
      registry,
      side,
    );
  }
  /** Q11-C-R1：Cannon 车开火后 snapshot（断言 Cannon 弹不带 visual 标记） */
  function makeCannonFireSnap() {
    const lab2 = new PhysicsLab(rendererStub);
    lab2.loadCustom(
      buildSnapshotFromDraft(
        { bodyDefId: 'watermelonBody', rearRadius: 20, frontRadius: 20, functionalSelections: { front: 'cannon', frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT } },
        registry,
        'A',
      ),
      plainSnapshot('B'),
      { autoDrive: true, engine: 'planck' },
    );
    const o2 = lab2.orchestrator as PlanckBattleOrchestrator;
    let fired2 = false;
    o2.onCombatEvent((ev) => {
      if (ev.type === 'weaponFire' && ev.behavior === 'cannon') fired2 = true;
    });
    for (let i = 0; i < 500 && !fired2; i++) lab2.step(16.6667);
    for (let i = 0; i < 30; i++) {
      lab2.step(16.6667);
      const s = o2.getRenderSnapshot();
      if ((s.projectiles ?? []).length > 0) return s;
    }
    return o2.getRenderSnapshot();
  }
  function plainSnapshot(side: 'A' | 'B') {
    return buildSnapshotFromDraft(
      {
        bodyDefId: 'boxBody',
        rearRadius: 20,
        frontRadius: 20,
        functionalSelections: { front: EMPTY_SLOT, frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT },
      },
      registry,
      side,
    );
  }

  it('1. laser 定义：weapon / charge 1500ms / speed 56（R2 高速能量束）/ damage 2× / recoil 8×', () => {
    const laser = registry.functionals.get('laser')!;
    const cannon = registry.functionals.get('cannon')!;
    expect(laser.category).toBe('weapon');
    expect(laser.behavior).toBe('laser');
    const lp = laser.behaviorParams as Record<string, number>;
    const cp = cannon.behaviorParams as Record<string, number>;
    expect(lp.chargeMs).toBe(1500);
    // Q11-C-R2：muzzleSpeed 56（Cannon 8 的 7×，R2 方案 48~64）
    expect(lp.muzzleSpeed).toBeGreaterThanOrEqual(48);
    expect(lp.muzzleSpeed).toBeLessThanOrEqual(64);
    expect(lp.projectileDamage).toBeCloseTo(cp.projectileDamage * 2, 6);
    // Q11-C-R1：recoil 60（2×）实测 chassis Δv 仅 0.33px/step 且 150ms 被
    // autoDrive 拉回，肉眼不可感知 → 240（8×，Δv ≈1.3px/step）
    expect(lp.recoilImpulse).toBeGreaterThan(cp.recoilImpulse * 4);
  });

  it('2. 蓄能 ~1.5s 肉眼可见（weaponCharge progress 0→1）：首个 charge 到 fire 时间差 ≈ chargeMs', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(laserSnapshot('A'), plainSnapshot('B'), { autoDrive: true, engine: 'planck' });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let chargeStart: number | null = null;
    let fireAt: number | null = null;
    let lastProgress = -1;
    let chargeCount = 0;
    o.onCombatEvent((ev) => {
      if (ev.type === 'weaponCharge') {
        if (chargeStart === null) chargeStart = ev.timestamp;
        lastProgress = ev.progress;
        chargeCount++;
      }
      if (ev.type === 'weaponFire' && ev.behavior === 'laser') {
        if (fireAt === null) fireAt = ev.timestamp;
      }
    });
    for (let i = 0; i < 500; i++) {
      lab.step(16.6667);
      if (fireAt !== null && lastProgress >= 0.99) break;
    }
    expect(chargeStart).not.toBeNull();
    expect(fireAt).not.toBeNull();
    expect(chargeCount).toBeGreaterThan(20); // 蓄能过程持续多帧（肉眼可见）
    expect(fireAt! - chargeStart!).toBeGreaterThan(1200);
    expect(fireAt! - chargeStart!).toBeLessThan(1800);
    expect(lastProgress).toBeGreaterThan(0.95); // 末帧 progress ≈ 0.989（发射步不再发 charge）
  });

  it('3. 正面命中：projectile 真实 hit（B weapon damage ≈ 160，Cannon 2×）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(SCENARIOS.find((s) => s.id === 'Q11-C')!);
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let fired = false;
    let weaponDmgOnB = 0;
    o.onCombatEvent((ev) => {
      if (ev.type === 'weaponFire' && ev.behavior === 'laser') fired = true;
      if (ev.type === 'damage' && ev.damageSource === 'weapon' && ev.target === 'B') {
        weaponDmgOnB += ev.damage;
      }
    });
    for (let i = 0; i < 1200; i++) {
      lab.step(16.6667);
      if (o.result?.phase === 'End') break;
    }
    expect(fired).toBe(true);
    expect(weaponDmgOnB).toBeGreaterThanOrEqual(150); // 一次真实接触 ≈160
  });

  it('4. 朝向不对 → 真实打空（B 在 A 后方，镭射朝 +X 飞行，weapon damage = 0, Miss）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(laserSnapshot('A'), plainSnapshot('B'), {
      autoDrive: true,
      engine: 'planck',
      spawnA: { x: 600, y: 650, facing: 1 },
      spawnB: { x: 300, y: 650, facing: -1 },
    });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let weaponDmgOnB = 0;
    o.onCombatEvent((ev) => {
      if (ev.type === 'damage' && ev.damageSource === 'weapon' && ev.target === 'B') {
        weaponDmgOnB += ev.damage;
      }
    });
    for (let i = 0; i < 1200; i++) {
      lab.step(16.6667);
      if (o.result?.phase === 'End') break;
    }
    expect(weaponDmgOnB).toBe(0); // 固定方向打空 = Miss
  });

  it('5. 开火瞬间自车明显后坐（chassis vx 骤降：recoil 240，Δv ≈1.3px/step 肉眼可见）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(laserSnapshot('A'), plainSnapshot('B'), { autoDrive: true, engine: 'planck' });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let fired = false;
    o.onCombatEvent((ev) => {
      if (ev.type === 'weaponFire' && ev.behavior === 'laser') fired = true;
    });
    const vxBefore: number[] = [];
    const vxAfter: number[] = [];
    for (let i = 0; i < 600; i++) {
      const vx = o.world.getLinearVelocity(o.vehicleA.body).x;
      if (!fired) vxBefore.push(vx);
      else vxAfter.push(vx);
      lab.step(16.6667);
      if (fired && vxAfter.length >= 20) break;
    }
    expect(fired).toBe(true);
    const avgBefore = vxBefore.slice(-10).reduce((a, b) => a + b, 0) / 10;
    // Q11-C-R1：recoil 240 / chassis mass ≈150 → Δv ≈1.3px/step（≈79px/s）；
    // 旧 60 实测仅骤降 0.32（≈20px/s）肉眼不可感知。
    expect(Math.min(...vxAfter)).toBeLessThan(avgBefore - 0.8);
  });

  it('6. 镭射弹带 visual 标记（渲染区分）；Cannon 弹不带——碰撞/伤害链不变', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(SCENARIOS.find((s) => s.id === 'Q11-C')!);
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let fired = false;
    o.onCombatEvent((ev) => {
      if (ev.type === 'weaponFire' && ev.behavior === 'laser') fired = true;
    });
    let seenLaser = false;
    for (let i = 0; i < 500 && !fired; i++) lab.step(16.6667);
    for (let i = 0; i < 60 && !seenLaser; i++) {
      lab.step(16.6667);
      const snap = o.getRenderSnapshot();
      for (const p of snap.projectiles ?? []) {
        if (p.visual === 'laser') seenLaser = true;
      }
    }
    expect(fired).toBe(true);
    expect(seenLaser).toBe(true); // 镭射弹带 visual 标记 → 渲染层一眼可区分
    // 碰撞/伤害链不变：Cannon 弹不产生 visual 标记（Q02-C3B 原语义）
    const cannonSnap = makeCannonFireSnap();
    for (const p of cannonSnap.projectiles ?? []) {
      expect(p.visual).toBeUndefined();
    }
  });

  it('7. Q11-C-F2：镭射弹无重力直线飞行（gravityScale=0）；Cannon 仍抛物线', () => {
    // 镭射：水平炮口下 projectile center.y 飞行中不变（无可见抛物线）
    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(SCENARIOS.find((s) => s.id === 'Q11-C')!);
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let fired = false;
    o.onCombatEvent((ev) => {
      if (ev.type === 'weaponFire' && ev.behavior === 'laser') fired = true;
    });
    let laserY: number[] = [];
    let laserX: number[] = [];
    for (let i = 0; i < 500 && !fired; i++) lab.step(16.6667);
    for (let i = 0; i < 40; i++) {
      lab.step(16.6667);
      const ps = (o.getRenderSnapshot().projectiles ?? []).filter((p) => p.visual === 'laser');
      if (ps.length > 0) {
        laserY.push(ps[0].center.y);
        laserX.push(ps[0].center.x);
      }
    }
    expect(fired).toBe(true);
    // Q11-C-R2：muzzleSpeed 56 → 命中前仅 ~3 步飞行（弹速极快，能量束一闪而过）
    expect(laserY.length).toBeGreaterThan(2);
    const yRange = Math.max(...laserY) - Math.min(...laserY);
    const xRange = Math.max(...laserX) - Math.min(...laserX);
    expect(xRange).toBeGreaterThan(100); // 确实在飞行
    expect(yRange).toBeLessThan(1); // 无重力：y 恒定（直线飞行）

    // Cannon：仍继承世界重力 → 抛物线（y 明显下降）
    const lab2 = new PhysicsLab(rendererStub);
    lab2.loadCustom(
      buildSnapshotFromDraft(
        { bodyDefId: 'watermelonBody', rearRadius: 20, frontRadius: 20, functionalSelections: { front: 'cannon', frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT } },
        registry,
        'A',
      ),
      plainSnapshot('B'),
      { autoDrive: true, engine: 'planck' },
    );
    const o2 = lab2.orchestrator as PlanckBattleOrchestrator;
    let fired2 = false;
    o2.onCombatEvent((ev) => {
      if (ev.type === 'weaponFire' && ev.behavior === 'cannon') fired2 = true;
    });
    let cannonY: number[] = [];
    for (let i = 0; i < 500 && !fired2; i++) lab2.step(16.6667);
    for (let i = 0; i < 30; i++) {
      lab2.step(16.6667);
      const ps = o2.getRenderSnapshot().projectiles ?? [];
      if (ps.length > 0) cannonY.push(ps[0].center.y);
    }
    expect(fired2).toBe(true);
    expect(cannonY.length).toBeGreaterThan(5);
    // Cannon 弹 y 单调下降（重力作用）→ 与镭射形成对比
    const firstY = cannonY[0];
    const lastY = cannonY[cannonY.length - 1];
    expect(lastY - firstY).toBeGreaterThan(2);
  });

  it('Q11-R1. 三新部件真实装配链路：defId 正确 / Preview 真实部件 / Energy / Validator', () => {
    // 1) 定义契约：楔铲=gadget(15) / 刺=weapon(25) / 镭射=weapon(45)
    expect(registry.functionals.get('wedgeShovel')?.category).toBe('gadget');
    expect(registry.functionals.get('wedgeShovel')?.energy).toBe(15);
    expect(registry.functionals.get('spear')?.category).toBe('weapon');
    expect(registry.functionals.get('spear')?.energy).toBe(25);
    expect(registry.functionals.get('laser')?.category).toBe('weapon');
    expect(registry.functionals.get('laser')?.energy).toBe(45);

    // 2) 三个新部件分别装到 watermelonBody front/top 挂点 → 真实 Planck Preview
    //    立即显示真实部件（orchestrator.parts 含对应 defId，非假 Preview）
    const cases: Array<[string, string, string]> = [
      ['wedgeShovel', 'front', 'gadget'],
      ['spear', 'front', 'weapon'],
      ['laser', 'top', 'weapon'],
    ];
    for (const [defId, hp, _cat] of cases) {
      const lab = new PhysicsLab(rendererStub);
      const d = draft('watermelonBody', { [hp]: defId });
      const a = snap(d, 'q11r1A');
      const b = snap(draft('bananaBody', { front: 'cannon' }), 'q11r1B');
      expect(() => lab.loadCustomPreview(a, b)).not.toThrow();
      const o = lab.orchestrator as PlanckBattleOrchestrator;
      const ids = o.vehicleA.parts.map((p) => p.def.id);
      expect(ids).toContain(defId); // Preview 显示真实部件
      // Energy 正确
      const e = computeEnergy(a, registry);
      expect(e.error).toBeUndefined();
      expect(e.energy).toBe(registry.functionals.get(defId)!.energy);
    }

    // 3) Validator：只装楔铲（gadget 无 weapon）→ 阻断；楔铲+炮 → 通过
    const onlyShovel = snap(draft('watermelonBody', { front: 'wedgeShovel' }), 'q11r1C');
    expect(validateSnapshot(onlyShovel, registry).valid).toBe(false); // 至少 1 件 Weapon
    const shovelPlusCannon = snap(
      draft('watermelonBody', { front: 'wedgeShovel', top: 'cannon' }),
      'q11r1D',
    );
    expect(validateSnapshot(shovelPlusCannon, registry).valid).toBe(true);
    // 刺 / 镭射 本身是 weapon → 单独即可 Start
    expect(validateSnapshot(snap(draft('watermelonBody', { front: 'spear' }), 'q11r1E'), registry).valid).toBe(true);
    expect(validateSnapshot(snap(draft('watermelonBody', { top: 'laser' }), 'q11r1F'), registry).valid).toBe(true);
  });

  it('Q11-A-CLOSE. 楔铲退出正式 Build：registry/Scenario 保留为 archived prototype，可加载', () => {
    // 1) registry 保留 wedgeShovel 定义（archived prototype，不删除）
    const ws = registry.functionals.get('wedgeShovel');
    expect(ws).toBeDefined();
    expect(ws!.category).toBe('gadget');
    expect(ws!.collider.shape).toBe('polygon'); // 底层 polygon/collision 能力保留
    // 2) Q11 专用 Scenario 仍可加载（隔离验证用，不崩）
    const sc = SCENARIOS.find((s) => s.id === 'Q11');
    expect(sc).toBeDefined();
    const lab = new PhysicsLab(rendererStub);
    expect(() => lab.loadScenario(sc!)).not.toThrow();
    expect(lab.orchestrator instanceof PlanckBattleOrchestrator).toBe(true);
    // 3) 其它正式部件不受影响（刺/镭射仍在 registry 且可装配）
    expect(registry.functionals.get('spear')?.category).toBe('weapon');
    expect(registry.functionals.get('laser')?.category).toBe('weapon');
    expect(validateSnapshot(snap(draft('watermelonBody', { front: 'spear' }), 'close1'), registry).valid).toBe(true);
    expect(validateSnapshot(snap(draft('watermelonBody', { top: 'laser' }), 'close2'), registry).valid).toBe(true);
  });

  it('Q11-C-R2. 能量束：镭射弹 snapshot 带真实飞行方向 velocity（渲染层）；音效闭环静默降级', () => {
    // 1) 镭射弹 velocity 字段（能量束沿真实飞行方向绘制）
    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(SCENARIOS.find((s) => s.id === 'Q11-C')!);
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let fired = false;
    o.onCombatEvent((ev) => {
      if (ev.type === 'weaponFire' && ev.behavior === 'laser') fired = true;
    });
    for (let i = 0; i < 500 && !fired; i++) lab.step(16.6667);
    let sawVel = false;
    for (let i = 0; i < 10; i++) {
      lab.step(16.6667);
      for (const p of o.getRenderSnapshot().projectiles ?? []) {
        if (p.visual === 'laser' && p.velocity && Math.hypot(p.velocity.x, p.velocity.y) > 10) {
          sawVel = true; // 真实飞行方向（速度 >> 0，能量束有明确朝向）
        }
      }
    }
    expect(fired).toBe(true);
    expect(sawVel).toBe(true);
    // 2) 音效闭环在无 AudioContext 环境（node 测试）静默降级：不抛错
    const sfx = new SfxAudioService();
    expect(() => {
      sfx.resume();
      sfx.startLaserCharge(0);
      sfx.startLaserCharge(1); // 升调/增强
      sfx.stopLaserCharge(); // fire：结束 charge + 爆鸣/冲击
      sfx.play('fire');
    }).not.toThrow();
    expect(sfx.isMuted()).toBe(false);
    sfx.setMuted(true);
    expect(() => {
      sfx.startLaserCharge(0.5);
      sfx.stopLaserCharge();
    }).not.toThrow(); // muted 同样安全
  });

  /** Q11-C-R3-FINAL：复制 main.ts 的 presentation 接线（laser → 巨炮束 + 白青闪；Cannon → 默认闪） */
  function wireLaserPresentation(renderer: Renderer) {
    return new BattlePresentationController({
      onMuzzleFlash: (ev) => {
        if (ev.behavior === 'laser') {
          renderer.spawnLaserBeam(ev.worldPosition.x, ev.worldPosition.y, ev.worldDirection.x, ev.worldDirection.y);
          renderer.spawnMuzzleFlash(ev.worldPosition.x, ev.worldPosition.y, '#eafdff', 14);
        } else {
          renderer.spawnMuzzleFlash(ev.worldPosition.x, ev.worldPosition.y);
        }
      },
      onWeaponCharge: (ev) => renderer.spawnCharge(ev.partId, ev.worldPosition.x, ev.worldPosition.y, ev.progress),
      onWeaponChargeEnd: (ev) => renderer.clearCharge(ev.partId),
    });
  }

  it('Q11-C-R3-FINAL. 事件→hook→renderer：Q11-C 正常速度开火后「巨大激光炮」束出现且几何达标', () => {
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
    const renderer = new Renderer(makeCtxStubCanvas());
    const controller = wireLaserPresentation(renderer);
    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(SCENARIOS.find((s) => s.id === 'Q11-C')!);
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    controller.bind({ onEvent: (cb) => o.onCombatEvent(cb) }); // 接真实事件源
    let fired = false;
    for (let i = 0; i < 500; i++) {
      lab.step(16.6667);
      if (renderer.activeLaserBeams.length > 0) {
        fired = true;
        break;
      }
      if (o.result?.phase === 'End') break;
    }
    expect(fired).toBe(true);
    const beams = renderer.activeLaserBeams;
    expect(beams.length).toBeGreaterThan(0);
    const b = beams[0]!;
    // 验收 1：巨炮（长 450~600 / 核心 12~18 / glow 30~45）
    expect(b.length).toBeGreaterThanOrEqual(450);
    expect(b.length).toBeLessThanOrEqual(600);
    expect(b.coreWidth).toBeGreaterThanOrEqual(12);
    expect(b.coreWidth).toBeLessThanOrEqual(18);
    expect(b.glowWidth).toBeGreaterThanOrEqual(30);
    expect(b.glowWidth).toBeLessThanOrEqual(45);
    // 沿真实 fire 方向（A facing +X → dirX>0）
    expect(b.dirX).toBeGreaterThan(0.9);
    controller.stop();
  });

  it('Q11-C-R3-FINAL. 开火后自车实际顿退（位置反向位移，非仅 vx 数字变化）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(laserSnapshot('A'), plainSnapshot('B'), { autoDrive: true, engine: 'planck' });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let firedStep = -1;
    let step = 0;
    const xs: number[] = [];
    const vxs: number[] = [];
    o.onCombatEvent((ev) => {
      if (ev.type === 'weaponFire' && ev.behavior === 'laser' && firedStep < 0) firedStep = step;
    });
    for (let i = 0; i < 600; i++) {
      vxs.push(o.world.getLinearVelocity(o.vehicleA.body).x);
      lab.step(16.6667);
      xs.push(o.world.getPosition(o.vehicleA.body).x);
      step++;
      if (firedStep >= 0 && step - firedStep >= 10) break;
    }
    expect(firedStep).toBeGreaterThanOrEqual(0);
    const tail = xs.slice(firedStep);
    // 真人可见反向运动：前 ~8 帧内至少一次 chassis 实际后退（facing+1 → x 减小）
    let maxBack = 0;
    for (let k = 1; k < 8 && k < tail.length; k++) {
      maxBack = Math.max(maxBack, tail[k - 1]! - tail[k]!);
    }
    expect(maxBack).toBeGreaterThan(1.0); // 明显反向位移（px/帧），非仅 vx 数字
    // vx 真正转负（真实 impulse，无屏幕震动伪装）
    expect(Math.min(...vxs.slice(firedStep, firedStep + 8))).toBeLessThan(0);
  });

  it('Q11-C-R3-FINAL. Cannon 完全不受影响：Cannon 开火不生成镭射巨炮束', () => {
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
    const renderer = new Renderer(makeCtxStubCanvas());
    const controller = wireLaserPresentation(renderer);
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(
      buildSnapshotFromDraft(
        { bodyDefId: 'watermelonBody', rearRadius: 20, frontRadius: 20, functionalSelections: { front: 'cannon', frontMass: 'cannon', top: EMPTY_SLOT, rear: EMPTY_SLOT } },
        registry,
        'A',
      ),
      plainSnapshot('B'),
      { autoDrive: true, engine: 'planck' },
    );
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    controller.bind({ onEvent: (cb) => o.onCombatEvent(cb) });
    let cannonFired = false;
    for (let i = 0; i < 500; i++) {
      lab.step(16.6667);
      if ((o.getRenderSnapshot().projectiles ?? []).some((p) => p.team === 'A' && !p.visual)) {
        cannonFired = true;
        break;
      }
      if (o.result?.phase === 'End') break;
    }
    expect(cannonFired).toBe(true);
    expect(renderer.activeLaserBeams.length).toBe(0); // 巨炮束仅 laser 触发
    controller.stop();
  });

  it('F-DEV-1. 玩家部件选项 smoke：不含 wedgeShovel（已退出正式 Build），含 spear/laser', () => {
    const ids = PART_OPTIONS.map((o) => o.v);
    expect(ids).not.toContain('wedgeShovel'); // Q11-A-CLOSE：装配页不得再出现楔铲
    expect(ids).toContain('spear'); // 刺正常
    expect(ids).toContain('laser'); // 镭射正常
    expect(ids).toContain('shotgun'); // 霰弹炮正常（Q13-B）
    expect(ids).toContain('cannon');
    expect(ids).toContain('hammer');
    expect(ids).toContain('pushRod');
    expect(ids).not.toContain('ramHead'); // Q12-A-HOLD：冲撞头已暂退正式装配页
    expect(ids).not.toContain('lifter'); // Q12-B-CLOSE：举升臂已暂退正式装配页
    // 唯一性 + 空槽在首位
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe(EMPTY_SLOT);
  });

  it('Q12-B-CLOSE. 举升臂（prototype/hold）：不在 PART_OPTIONS / registry 保留 / Q12-B Scenario 仍可加载 / Revolute 仍装配', () => {
    // 1) hold 状态：lifter 已退出玩家 PART_OPTIONS（不在装配页），但仍在 registry
    //    （供 Q12-B Scenario / 直构 / 测试与未来重做举升类机制，底层 Revolute Gadget 不修改）
    expect(PART_OPTIONS.map((o) => o.v)).not.toContain('lifter'); // Q12-B-CLOSE：装配页不再出现
    expect(registry.functionals.has('lifter')).toBe(true); // registry 保留 prototype/hold
    // 2) Q12-B Scenario 仍可加载并真实装配 Revolute 举升臂（底层能力未被删）
    const sc = SCENARIOS.find((s) => s.id === 'Q12-B')!;
    expect(sc).toBeDefined();
    expect(sc.name).toContain('prototype/hold'); // Scenario 已标记 hold
    const lab = new PhysicsLab(rendererStub);
    expect(() => lab.loadScenario(sc)).not.toThrow();
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    const lifterPart = o.vehicleA.parts.find((p) => p.def.id === 'lifter');
    expect(lifterPart).toBeDefined(); // Q12-B A 车真实装配举升臂
    expect(lifterPart!.joint).toBeDefined(); // Revolute joint（非 Weld）——底层能力保留
  });

  it('Q12-A-HOLD. 冲撞头（prototype/hold）：registry 保留 / 不在 PART_OPTIONS / 复用 ramHead Runtime / 正面命中 / 擦空失败', () => {
    // 1) 定义契约：weapon / baseDamage 80 / 短粗 box（与刺 96×6 长细一眼不同）
    const rh = registry.functionals.get('ramHead')!;
    const sp = registry.functionals.get('spear')!;
    expect(rh.category).toBe('weapon');
    expect(rh.behavior).toBe('ram'); // 复用既有 ram 直击链路，非新伤害系统
    expect((rh.behaviorParams as Record<string, number>).baseDamage).toBe(80);
    const rc = rh.collider as { shape: string; width: number; height: number };
    const sc = sp.collider as { shape: string; vertices: { x: number; y: number }[] };
    expect(rc.shape).toBe('box');
    // 短粗：宽 44 < 刺长 96（明显更短）；高 26 > 刺高 6（明显更粗）
    const spearLen = Math.max(...sc.vertices.map((v) => v.x)) - Math.min(...sc.vertices.map((v) => v.x));
    const spearH = Math.max(...sc.vertices.map((v) => v.y)) - Math.min(...sc.vertices.map((v) => v.y));
    expect(rc.width).toBeLessThan(spearLen * 0.6);
    expect(rc.height).toBeGreaterThan(spearH * 3);
    // 2) hold 状态：ramHead 已退出玩家 PART_OPTIONS（不在装配页），但仍在 registry
    //    （供 Q12-A Scenario / 直构 / 测试与未来重做冲撞类内容，底层 ram Contact 不修改）
    expect(PART_OPTIONS.map((o) => o.v)).not.toContain('ramHead'); // Q12-A-HOLD：装配页不再出现
    expect(registry.functionals.has('ramHead')).toBe(true); // registry 保留 prototype/hold
    const lab = new PhysicsLab(rendererStub);
    const d = draft('watermelonBody', { front: 'ramHead' });
    const a = snap(d, 'q12aA');
    const b = snap(draft('bananaBody', {}), 'q12aB');
    expect(() => lab.loadCustomPreview(a, b)).not.toThrow();
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    expect(o.vehicleA.parts.map((p) => p.def.id)).toContain('ramHead'); // Preview 真实部件
    const e = computeEnergy(a, registry);
    expect(e.error).toBeUndefined();
    expect(e.energy).toBe(20);
    expect(validateSnapshot(a, registry).valid).toBe(true); // weapon → 单独即可 Start
    // 3) 正面真实碰撞 → B weapon damage ≈80（真实 Contact 直击）
    const lab2 = new PhysicsLab(rendererStub);
    lab2.loadScenario(SCENARIOS.find((s) => s.id === 'Q12')!);
    const o2 = lab2.orchestrator as PlanckBattleOrchestrator;
    let dmg = 0;
    o2.onCombatEvent((ev) => {
      if (ev.type === 'damage') dmg += ev.damage;
    });
    for (let i = 0; i < 900; i++) {
      lab2.step(16.6667);
      if (o2.result?.phase === 'End') break;
    }
    expect(dmg).toBeGreaterThanOrEqual(75); // baseDamage 80 真实触发
    // 4) 擦空/高度错开允许失败：B 在 A 后方（背向而驰）→ 无伤害
    const lab3 = new PhysicsLab(rendererStub);
    lab3.loadCustom(SCENARIOS.find((s) => s.id === 'Q12')!.buildA, SCENARIOS.find((s) => s.id === 'Q12')!.buildB, {
      engine: 'planck',
      autoDrive: true,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 250, y: 650, facing: -1 },
    });
    const o3 = lab3.orchestrator as PlanckBattleOrchestrator;
    let dmg3 = 0;
    o3.onCombatEvent((ev) => {
      if (ev.type === 'damage') dmg3 += ev.damage;
    });
    for (let i = 0; i < 600; i++) {
      lab3.step(16.6667);
      if (o3.result?.phase === 'End') break;
    }
    expect(dmg3).toBe(0); // 没正面撞到 → 自然失败，无隐藏击退/自动伤害
  });

  it('Q12-B (prototype/hold). 举升臂：Revolute 翻动弧 60~80° / banana 真实碰撞抬起 / 无 Direct Weapon Damage / A 反作用', () => {
    // 1) 定义契约：gadget / 无 baseDamage / behavior lifter / Revolute 装配
    const lifter = registry.functionals.get('lifter')!;
    expect(lifter.category).toBe('gadget');
    expect(lifter.behavior).toBe('lifter');
    expect((lifter.behaviorParams as Record<string, unknown> | undefined)?.baseDamage).toBeUndefined();
    const lp = lifter.behaviorParams as Record<string, number>;
    expect(lp.upperRad).toBeGreaterThanOrEqual(1.05); // 60°
    expect(lp.upperRad).toBeLessThanOrEqual(1.4); // 80°
    // 2) 装配链路：Preview 真实部件 + Energy 15；gadget 单独不满足「至少 1 件 Weapon」
    const lab = new PhysicsLab(rendererStub);
    const d = draft('watermelonBody', { front: 'lifter' });
    const a = snap(d, 'q12bA');
    const b = snap(draft('bananaBody', {}), 'q12bB');
    expect(() => lab.loadCustomPreview(a, b)).not.toThrow();
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    const lifterPart = o.vehicleA.parts.find((p) => p.def.id === 'lifter')!;
    expect(lifterPart).toBeDefined();
    expect(lifterPart.joint).toBeDefined(); // Revolute joint（非 Weld）
    expect(computeEnergy(a, registry).energy).toBe(15);
    expect(validateSnapshot(a, registry).valid).toBe(false); // gadget 单独无 weapon
    expect(validateSnapshot(snap(draft('watermelonBody', { front: 'lifter', top: 'cannon' }), 'q12bC'), registry).valid).toBe(true);
    // 3) 场景：翻动弧 + banana 抬起 + 无 weapon damage + A 反作用
    const lab2 = new PhysicsLab(rendererStub);
    lab2.loadScenario(SCENARIOS.find((s) => s.id === 'Q12-B')!);
    const o2 = lab2.orchestrator as PlanckBattleOrchestrator;
    const w = o2.world;
    const lifterPart2 = o2.vehicleA.parts.find((p) => p.def.id === 'lifter')!;
    const GROUND_Y = 700;
    let sources = new Set<string>();
    o2.onCombatEvent((ev) => {
      if (ev.type === 'damage') sources.add(String(ev.damageSource));
    });
    let earlyMaxAngle = 0; // 前 900 步（15s，A 翻车前）的正常翻动峰值
    let maxBLift = 0;
    let maxAPitch = 0;
    for (let i = 0; i < 1200; i++) {
      lab2.step(16.6667);
      const ang = w.getRevoluteAngle(lifterPart2.joint);
      if (i < 900) earlyMaxAngle = Math.max(earlyMaxAngle, Math.abs(ang));
      const frontLift = Math.max(
        0,
        ...o2.vehicleB.wheels.map((wh) => Math.max(0, GROUND_Y - 20 - 0.5 - w.getPosition(wh.body).y)),
      );
      maxBLift = Math.max(maxBLift, frontLift);
      maxAPitch = Math.max(maxAPitch, Math.abs(w.getAngle(o2.vehicleA.body)));
      if (o2.result?.phase === 'End') break;
    }
    expect(Math.abs(earlyMaxAngle) * 57.3).toBeGreaterThan(55); // 正常翻动达到 70°（60~80° 目标）
    expect(Math.abs(earlyMaxAngle) * 57.3).toBeLessThan(85);
    expect(maxBLift).toBeGreaterThan(15); // banana 被真实碰撞明显抬起
    expect(sources.has('weapon')).toBe(false); // 无 Direct Weapon Damage（impact/hazard 是真实物理）
    expect(maxAPitch * 57.3).toBeGreaterThan(0.5); // 自车真实反作用
  });

  it('Q12-B-R1 (prototype/hold). 举升臂向上修正：双 facing 臂尖 worldY 减小（向屏幕上方）/ 绝不扫向地面', () => {
    // 沿真实 Runtime 记录 lifter 远端 tip 的 worldY（禁止用角度绝对值代替方向验证）。
    // 本世界 Y-down：worldY 越小越靠屏幕上方。tip 本地 x = facing·100（far end），
    // tip.worldY = pivot.worldY + facing·100·sin(partAngle)。
    const computeTipY = (o: PlanckBattleOrchestrator, facing: 1 | -1): number => {
      const w = o.world;
      const part = o.vehicleA.parts.find((p) => p.def.id === 'lifter')!;
      const pivot = w.getPosition(part.body);
      const ang = w.getAngle(part.body);
      return pivot.y + facing * 100 * Math.sin(ang);
    };
    const lifterCar = {
      id: 'lifterCar',
      bodyDefId: 'watermelonBody',
      quality: 1,
      movements: [
        { hardpointId: 'rear', defId: 'wheelStd' },
        { hardpointId: 'front', defId: 'wheelStd' },
      ],
      functionals: [{ hardpointId: 'front', defId: 'lifter' }],
    };
    const banana = {
      id: 'bananaBody',
      bodyDefId: 'bananaBody',
      quality: 1,
      movements: [
        { hardpointId: 'rear', defId: 'wheelStd' },
        { hardpointId: 'front', defId: 'wheelStd' },
      ],
      functionals: [],
    };
    for (const facing of [1, -1] as const) {
      const lab = new PhysicsLab(rendererStub);
      lab.loadCustom(lifterCar, banana, {
        engine: 'planck',
        autoDrive: true,
        spawnA: { x: 450, y: 650, facing },
        spawnB: { x: 1150, y: 650, facing: -1 },
      });
      const o = lab.orchestrator as PlanckBattleOrchestrator;
      const w = o.world;
      const lifterPart = o.vehicleA.parts.find((p) => p.def.id === 'lifter')!;
      // 先跑过 rest 待机，记录水平低位 tipY
      for (let i = 0; i < 25; i++) lab.step(16.6667);
      const restTipY = computeTipY(o, facing);
      let peakUpTipY = restTipY;
      // 臂相对 chassis 的 joint angle 极值：结构上限保证臂绝不朝「下」扫向地面。
      // facing=+1：limit [−upperRad, 0]，应恒 ≤~0；facing=−1：limit [0, +upperRad]，应恒 ≥~0。
      let maxJoint = -Infinity;
      let minJoint = Infinity;
      for (let i = 0; i < 300; i++) {
        lab.step(16.6667);
        const t = computeTipY(o, facing);
        peakUpTipY = Math.min(peakUpTipY, t);
        const ja = w.getRevoluteAngle(lifterPart.joint);
        maxJoint = Math.max(maxJoint, ja);
        minJoint = Math.min(minJoint, ja);
        if (o.result?.phase === 'End') break;
      }
      const upReach = restTipY - peakUpTipY; // >0 = 向屏幕上方（worldY 减小）
      // 验收 1&2：臂尖明显向上扬起（世界 tipY 减小）；臂相对 chassis 绝不朝下扫（结构保证）
      expect(upReach).toBeGreaterThan(60); // ≈70° 弧上移 ~95px，明显向上
      if (facing === 1) {
        expect(maxJoint).toBeLessThanOrEqual(0.06); // 绝不朝 +（向地面）扫
      } else {
        expect(minJoint).toBeGreaterThanOrEqual(-0.06); // 绝不朝 −（向地面）扫
      }
    }
  });

  it('Q12-C. 冲锤：Prismatic 伸收循环 / 锤头 Contact 造成 Weapon Damage / 撞空 Miss / 推杆仍 Gadget', () => {
    // 1) 定义契约：weapon / baseDamage / behavior rammer / Prismatic 装配
    const rammer = registry.functionals.get('rammer')!;
    expect(rammer.category).toBe('weapon');
    expect(rammer.behavior).toBe('rammer');
    expect((rammer.behaviorParams as Record<string, number>).baseDamage).toBeGreaterThan(0);
    const rp = rammer.behaviorParams as Record<string, number>;
    // 初版速度/行程明显高于推杆（推杆走默认：speed 2、extendPx 90）
    expect(rp.strikeSpeedPxPerStep).toBeGreaterThan(2 * 3); // 8 vs 2
    expect(rp.extendPx).toBeGreaterThan(90 * 1.5); // 160 vs 90
    // 2) 装配链路：Preview 真实部件 + Energy 25 + Validator（weapon 单独可 Start）
    const lab = new PhysicsLab(rendererStub);
    const a = snap(draft('watermelonBody', { front: 'rammer' }), 'q12cA');
    const b = snap(draft('bananaBody', {}), 'q12cB');
    expect(() => lab.loadCustomPreview(a, b)).not.toThrow();
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    const rammerPart = o.vehicleA.parts.find((p) => p.def.id === 'rammer')!;
    expect(rammerPart.joint).toBeDefined(); // Prismatic joint（非 Weld）
    expect(computeEnergy(a, registry).energy).toBe(25);
    expect(validateSnapshot(a, registry).valid).toBe(true); // weapon → 单独可 Start
    // 3) 场景：伸收循环（行程 ≈160 + 回收）+ 锤头 Contact 造成 weapon damage
    const lab2 = new PhysicsLab(rendererStub);
    lab2.loadScenario(SCENARIOS.find((s) => s.id === 'Q12-C')!);
    const o2 = lab2.orchestrator as PlanckBattleOrchestrator;
    const w = o2.world;
    const rammerPart2 = o2.vehicleA.parts.find((p) => p.def.id === 'rammer')!;
    let weaponDmg = 0;
    o2.onCombatEvent((ev) => {
      if (ev.type === 'damage' && ev.damageSource === 'weapon') weaponDmg += ev.damage;
    });
    let maxT = 0;
    let minT = Infinity;
    for (let i = 0; i < 900; i++) {
      lab2.step(16.6667);
      const t = w.getPrismaticTranslation(rammerPart2.joint);
      maxT = Math.max(maxT, t);
      minT = Math.min(minT, t);
      if (o2.result?.phase === 'End') break;
    }
    expect(maxT).toBeGreaterThan(140); // 伸出到 ~160（行程到位）
    expect(minT).toBeLessThan(10); // 回收回低位
    expect(weaponDmg).toBeGreaterThanOrEqual(60); // 锤头真实 Contact → Weapon Damage（baseDamage 70）
    // 4) 撞空 = Miss：B 在 A 后方（背向而驰）→ 无 weapon damage
    const lab3 = new PhysicsLab(rendererStub);
    lab3.loadCustom(SCENARIOS.find((s) => s.id === 'Q12-C')!.buildA, SCENARIOS.find((s) => s.id === 'Q12-C')!.buildB, {
      engine: 'planck',
      autoDrive: true,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 250, y: 650, facing: -1 },
    });
    const o3 = lab3.orchestrator as PlanckBattleOrchestrator;
    let missWeaponDmg = 0;
    o3.onCombatEvent((ev) => {
      if (ev.type === 'damage' && ev.damageSource === 'weapon') missWeaponDmg += ev.damage;
    });
    for (let i = 0; i < 600; i++) {
      lab3.step(16.6667);
      if (o3.result?.phase === 'End') break;
    }
    expect(missWeaponDmg).toBe(0); // 没撞到 = Miss，无 weapon damage
  });

  it('Q12-C-R1. 冲锤真实机械连接：复用 Prismatic 连接轴 / 轴随真实行程连续 / 快速打出 0.18~0.25s / Miss 仍完整伸出回收', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(SCENARIOS.find((s) => s.id === 'Q12-C')!);
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    const w = o.world;
    const part = o.vehicleA.parts.find((p) => p.def.id === 'rammer')!;
    const rammerIdx = o.vehicleA.parts.indexOf(part);
    const extendPx = (part.def.behaviorParams as Record<string, number>).extendPx;
    const connLen = (idx: number): number => {
      const c = o.getRenderSnapshot().vehicleA.parts[idx].connector;
      return c ? Math.hypot(c.to.x - c.from.x, c.to.y - c.from.y) : -1;
    };
    // 1) 回收位（translation≈0）：连接轴≈0 —— 车身↔轴↔锤头全程连续，无悬空方块 / 无异常长连接
    let restLen = -1;
    let midLen = -1, midT = -1;
    let fullLen = -1, fullT = -1;
    let strikeStart = -1, fullStep = -1;
    for (let i = 0; i < 900; i++) {
      lab.step(16.6667);
      const t = w.getPrismaticTranslation(part.joint);
      if (i === 5) restLen = connLen(rammerIdx); // 早期回收位采样
      if (strikeStart < 0 && t > 2) strikeStart = i; // 离开 home 开始打出
      if (strikeStart >= 0 && fullStep < 0 && t >= 0.9 * extendPx) fullStep = i;
      if (midLen < 0 && t > 60 && t < 100) { midLen = connLen(rammerIdx); midT = t; }
      if (fullLen < 0 && t >= 0.9 * extendPx) { fullLen = connLen(rammerIdx); fullT = t; break; }
      if (o.result?.phase === 'End') break;
    }
    // 验收 1&2：静止时轴≈0（机械连接连续，无漂浮方块）；轴长随真实 translation 连续（=真实 Prismatic，非假动画）
    expect(restLen).toBeLessThan(20);
    expect(midT).toBeGreaterThan(0);
    expect(Math.abs(midLen - midT)).toBeLessThan(15);
    expect(Math.abs(fullLen - fullT)).toBeLessThan(15);
    // 3) 冲击节奏：从开始 strike 到接近满行程 0.18~0.25s
    expect(strikeStart).toBeGreaterThan(0);
    const strikeSteps = fullStep - strikeStart;
    const strikeSec = (strikeSteps * 16.6667) / 1000;
    expect(strikeSec).toBeGreaterThanOrEqual(0.18);
    expect(strikeSec).toBeLessThanOrEqual(0.25);
    // 4) Miss：B 在 A 后方（背向而驰）→ 仍完整伸出并自然回收，无 weapon damage
    const lab3 = new PhysicsLab(rendererStub);
    lab3.loadCustom(SCENARIOS.find((s) => s.id === 'Q12-C')!.buildA, SCENARIOS.find((s) => s.id === 'Q12-C')!.buildB, {
      engine: 'planck',
      autoDrive: true,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 250, y: 650, facing: -1 },
    });
    const o3 = lab3.orchestrator as PlanckBattleOrchestrator;
    let missWeaponDmg = 0;
    let maxMissT = 0;
    let minMissT = Infinity;
    o3.onCombatEvent((ev) => {
      if (ev.type === 'damage' && ev.damageSource === 'weapon') missWeaponDmg += ev.damage;
    });
    for (let i = 0; i < 600; i++) {
      lab3.step(16.6667);
      const t = o3.world.getPrismaticTranslation(o3.vehicleA.parts.find((p) => p.def.id === 'rammer')!.joint);
      maxMissT = Math.max(maxMissT, t);
      minMissT = Math.min(minMissT, t);
      if (o3.result?.phase === 'End') break;
    }
    expect(maxMissT).toBeGreaterThan(140); // Miss 仍完整伸出
    expect(minMissT).toBeLessThan(10); // 并自然回收
    expect(missWeaponDmg).toBe(0); // 没撞到 = Miss，无 weapon damage
  });
});

/* ---------- Q13-A：高速圆锯 Weapon（front Revolute 持续高速旋转 / 真实圆形 Collider / contactTick 持续切割） ---------- */
describe('Q13-A 高速圆锯 Weapon', () => {
  function sawSnapshot(side: 'A' | 'B') {
    return buildSnapshotFromDraft(
      {
        bodyDefId: 'watermelonBody',
        rearRadius: 20,
        frontRadius: 20,
        functionalSelections: { front: 'saw', frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT },
      },
      registry,
      side,
    );
  }

  it('1. saw 定义：weapon / 圆形 Collider（radius>0, offset 0,0 圆心=枢轴）/ behavior saw / hitPolicy contactTick（非直扣 HP）', () => {
    const def = registry.functionals.get('saw')!;
    expect(def.category).toBe('weapon');
    expect(def.behavior).toBe('saw'); // 专用 Revolute 旋转行为，非 ram/hammer
    expect(def.collider.shape).toBe('circle');
    const c = def.collider as { shape: string; radius: number; offset: { x: number; y: number } };
    expect(c.radius).toBe(28); // 清晰可见圆盘（直径 56）；Q13-A-R1 禁止扩大 Collider
    expect(c.offset.x).toBe(0); // 圆心 = 枢轴 → 原地自转（不绕枢轴公转）
    expect(c.offset.y).toBe(0);
    const bp = def.behaviorParams as Record<string, unknown>;
    // Q13-A-R1：转速降到 0.25~0.30 避开 30fps 频闪区（不追求转速越高越好）
    expect((bp.spinSpeedRadPerStep as number)).toBeGreaterThanOrEqual(0.25);
    expect((bp.spinSpeedRadPerStep as number)).toBeLessThanOrEqual(0.3);
    const hp = bp.hitPolicy as { mode: string; intervalMs: number; damage: number };
    expect(hp.mode).toBe('contactTick'); // 复用现有持续接触伤害，不新建系统
    expect(hp.intervalMs).toBeGreaterThan(0);
    expect(hp.damage).toBeGreaterThan(0);
    expect((bp.baseDamage as number | undefined)).toBeUndefined(); // 不直扣 HP（contactTick 负责）
  });

  it('2. 加入正常 Build：PART_OPTIONS 含 saw；Preview 真实部件 + Energy 25 + Validator 通过 + Revolute 装配', () => {
    expect(PART_OPTIONS.map((o) => o.v)).toContain('saw'); // 正常 Build 装配页出现圆锯
    const lab = new PhysicsLab(rendererStub);
    const a = sawSnapshot('A');
    const b = snap(draft('bananaBody', {}), 'q13aB');
    expect(() => lab.loadCustomPreview(a, b)).not.toThrow();
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    const sawPart = o.vehicleA.parts.find((p) => p.def.id === 'saw')!;
    expect(sawPart).toBeDefined();
    expect(sawPart.joint).toBeDefined(); // Revolute joint（非 Weld）——底层能力装配
    expect(computeEnergy(a, registry).energy).toBe(25);
    expect(validateSnapshot(a, registry).valid).toBe(true); // weapon → 单独可 Start
  });

  it('3. 持续单方向高速旋转：Revolute 角度随时间单调增加（正常速度肉眼可见）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(sawSnapshot('A'), snap(draft('bananaBody', {}), 'B'), { autoDrive: false, engine: 'planck' });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    const sawPart = o.vehicleA.parts.find((p) => p.def.id === 'saw')!;
    const w = o.world;
    let prev = w.getRevoluteAngle(sawPart.joint);
    let monotonic = 0;
    const samples: number[] = [prev];
    for (let i = 0; i < 120; i++) {
      lab.step(16.6667);
      const cur = w.getRevoluteAngle(sawPart.joint);
      if (cur >= prev - 1e-6) monotonic++;
      prev = cur;
      samples.push(cur);
    }
    // 120 步（≈2s）角度持续单调增加（单方向旋转），增量明显（Q13-A-R1 转速 0.27）
    expect(monotonic).toBeGreaterThanOrEqual(118); // 几乎全程单调
    const total = samples[samples.length - 1]! - samples[0]!;
    expect(total).toBeGreaterThan(25); // ≈32 rad over 120 步（0.27×120），肉眼连续旋转
  });

  it('4. 接触对手 → 持续切割（weapon damage 持续累计 > 0）；没接触 → 无伤害', () => {
    // 4a. 接触：Q13-A 场景（autoDrive 靠近）→ B weapon damage 持续累计
    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(SCENARIOS.find((s) => s.id === 'Q13-A')!);
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let weaponDmg = 0;
    o.onCombatEvent((ev) => {
      if (ev.type === 'damage' && ev.damageSource === 'weapon') weaponDmg += ev.damage;
    });
    for (let i = 0; i < 1200; i++) {
      lab.step(16.6667);
      if (o.result?.phase === 'End') break;
    }
    expect(weaponDmg).toBeGreaterThan(0); // 持续切割产生伤害
    // 4b. 没接触：B 在 A 后方（背向而驰）→ 无 weapon damage（切割不发生）
    const lab2 = new PhysicsLab(rendererStub);
    lab2.loadCustom(sawSnapshot('A'), snap(draft('bananaBody', {}), 'B'), {
      engine: 'planck',
      autoDrive: true,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 250, y: 650, facing: -1 },
    });
    const o2 = lab2.orchestrator as PlanckBattleOrchestrator;
    let missDmg = 0;
    o2.onCombatEvent((ev) => {
      if (ev.type === 'damage' && ev.damageSource === 'weapon') missDmg += ev.damage;
    });
    for (let i = 0; i < 600; i++) {
      lab2.step(16.6667);
      if (o2.result?.phase === 'End') break;
    }
    expect(missDmg).toBe(0); // 没接触 = 无切割伤害
  });

  it('5. 真实碰撞反作用：自车与对手均承受接触反应（无隐藏力 / 不直扣 HP）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(SCENARIOS.find((s) => s.id === 'Q13-A')!);
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    const w = o.world;
    let maxAPitch = 0;
    const b0x = w.getPosition(o.vehicleB.body).x;
    for (let i = 0; i < 900; i++) {
      lab.step(16.6667);
      maxAPitch = Math.max(maxAPitch, Math.abs(w.getAngle(o.vehicleA.body)));
      if (o.result?.phase === 'End') break;
    }
    // 对手被真实接触推动（位置相对初始明显变化，非原地）
    const bx = w.getPosition(o.vehicleB.body).x;
    expect(Math.abs(bx - b0x)).toBeGreaterThan(5);
    // 自车承受锯片旋转/接触反作用（真实扭矩经 Revolute 传 chassis，姿态有变化）
    expect(maxAPitch * 57.3).toBeGreaterThan(0.5);
  });

  it('F-DEV-1+Q13-A. 圆锯进入玩家部件选项', () => {
    const ids = PART_OPTIONS.map((o) => o.v);
    expect(ids).toContain('saw'); // Q13-A：正常 Build 装配页出现圆锯
    expect(ids).toContain('cannon');
    expect(ids).toContain('hammer');
    expect(ids).toContain('pushRod');
    expect(ids).toContain('rammer');
    expect(ids).toContain('spear');
    expect(ids).toContain('laser');
    expect(ids).toContain('shotgun'); // Q13-B：霰弹炮进入正常 Build
    expect(ids).toContain('thruster'); // Q13-C：推进器进入正常 Build
    expect(ids).not.toContain('lifter'); // Q12-B-CLOSE：举升臂已暂退正式装配页
    expect(ids).not.toContain('ramHead'); // Q12-A-HOLD：冲撞头已暂退正式装配页
    expect(ids).not.toContain('wedgeShovel'); // Q11-A-CLOSE：楔铲已退出正式 Build
    expect(ids[0]).toBe(EMPTY_SLOT);
  });
});

/* ---------- Q13-A-R1：圆锯旋转与切割感（转速避开频闪 + 非对称辐条/高对比标记 + 接触点切割火花） ---------- */
describe('Q13-A-R1 圆锯旋转与切割感', () => {
  it('1. 转速降到 0.25~0.30 且保留真实 Revolute/Collider/contactTick（不重做伤害）', () => {
    const def = registry.functionals.get('saw')!;
    const bp = def.behaviorParams as Record<string, unknown>;
    expect((bp.spinSpeedRadPerStep as number)).toBeGreaterThanOrEqual(0.25);
    expect((bp.spinSpeedRadPerStep as number)).toBeLessThanOrEqual(0.3); // 避开 30fps 频闪区
    expect(def.category).toBe('weapon');
    expect(def.collider.shape).toBe('circle');
    expect((def.collider as { radius: number }).radius).toBe(28); // Collider 不扩大
    expect((bp.hitPolicy as { mode: string }).mode).toBe('contactTick'); // 伤害仍走现有 contactTick
  });

  it('2. 切割火花：saw 有效接触期间 snapshot.sparks 非空（真实接触点）；接触前为空', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(SCENARIOS.find((s) => s.id === 'Q13-A')!);
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    // 接触前（尚未靠近）→ 无火花
    expect(o.getRenderSnapshot().sparks?.length ?? 0).toBe(0);
    let weaponDmg = 0;
    o.onCombatEvent((ev) => {
      if (ev.type === 'damage' && ev.damageSource === 'weapon') weaponDmg += ev.damage;
    });
    // 推进直到 saw 真正切到 B（weapon damage 累计 → 说明处于活跃 contactTick）
    for (let i = 0; i < 1500 && weaponDmg <= 0; i++) lab.step(16.6667);
    expect(weaponDmg).toBeGreaterThan(0); // 确实在持续切割
    const sparks = o.getRenderSnapshot().sparks ?? [];
    expect(sparks.length).toBeGreaterThanOrEqual(1); // 接触期间出现切割火花
    const s = sparks[0]!;
    expect(Number.isFinite(s.x) && Number.isFinite(s.y)).toBe(true); // 真实接触点
    expect(s.team).toBe('A'); // 火花归属锯片方（attacker）
  });

  it('3. 不改 Hammer（回归：锤行为/Collider 未被动）', () => {
    const hammer = registry.functionals.get('hammer')!;
    expect(hammer.behavior).toBe('hammer'); // 不被锯逻辑影响
    expect(hammer.collider.shape).toBe('box'); // Collider 形态不变
    const hbp = hammer.behaviorParams as Record<string, unknown>;
    expect((hbp.spinSpeedRadPerStep as number | undefined)).toBeUndefined(); // 锯的转速参数不污染锤
  });
});

/* ---------- Q13-B：霰弹炮 Weapon（一次齐射 5 发固定扇形真实 projectile / 一次爆闪 + 真实后坐；复用正式 Projectile 链） ---------- */
describe('Q13-B 霰弹炮 Weapon', () => {
  /** A 霰弹炮车：watermelon + front shotgun（Weld 短粗枪管，一次齐射 5 发固定扇形） */
  function shotgunSnapshot(side: 'A' | 'B') {
    return buildSnapshotFromDraft(
      {
        bodyDefId: 'watermelonBody',
        rearRadius: 20,
        frontRadius: 20,
        functionalSelections: { front: 'shotgun', frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT },
      },
      registry,
      side,
    );
  }
  /** B 无攻击件目标车（boxBody，与 Q13-B Scenario 一致） */
  function plainSnapshot(side: 'A' | 'B') {
    return buildSnapshotFromDraft(
      {
        bodyDefId: 'boxBody',
        rearRadius: 20,
        frontRadius: 20,
        functionalSelections: { front: EMPTY_SLOT, frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT },
      },
      registry,
      side,
    );
  }

  it('1. shotgun 定义：weapon / box collider / behavior shotgun / 固定扇形 5 发 -12..+12 / muzzleSpeed 高速(12~14) 高于 cannon（不自动瞄准、无 raycast）', () => {
    const def = registry.functionals.get('shotgun')!;
    expect(def.category).toBe('weapon');
    expect(def.behavior).toBe('shotgun');
    const c = def.collider as { shape: string; width: number; height: number; offset: { x: number; y: number } };
    expect(c.shape).toBe('box'); // 短粗枪管（非第二套 projectile 系统）
    const bp = def.behaviorParams as Record<string, unknown>;
    const fan = bp.fanAnglesDeg as number[];
    expect(fan).toEqual([-12, -6, 0, 6, 12]); // 固定扇形、可复现、无随机
    expect(fan.length).toBe(5);
    const cp = registry.functionals.get('cannon')!.behaviorParams as Record<string, number>;
    // Q13-B-R1：霰弹 = 高速喷射（muzzleSpeed 12~14），明显高于 Cannon 8（不再靠慢速+重力制造近程）
    expect((bp.muzzleSpeed as number)).toBeGreaterThanOrEqual(12);
    expect((bp.muzzleSpeed as number)).toBeLessThanOrEqual(14);
    expect(cp.muzzleSpeed).toBe(8); // Cannon 不受影响（仍 8）
    expect((bp.projectileDamage as number)).toBeGreaterThan(0); // 每发走正式 projectileDamage
    expect((bp.baseDamage as number | undefined)).toBeUndefined(); // 无直扣 HP（走 projectile 链）
  });

  it('2. 加入正常 Build：PART_OPTIONS 含 shotgun；Preview 真实部件 + Energy 30 + Validator 通过 + Weld 装配', () => {
    expect(PART_OPTIONS.map((o) => o.v)).toContain('shotgun'); // 正常 Build 装配页出现霰弹炮
    const lab = new PhysicsLab(rendererStub);
    const a = shotgunSnapshot('A');
    const b = snap(draft('bananaBody', {}), 'q13bB');
    expect(() => lab.loadCustomPreview(a, b)).not.toThrow();
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    const sgPart = o.vehicleA.parts.find((p) => p.def.id === 'shotgun')!;
    expect(sgPart).toBeDefined();
    expect(sgPart.joint).toBeDefined(); // Weld joint（非 Revolute/Prismatic）——底层装配能力保留
    expect(computeEnergy(a, registry).energy).toBe(30);
    expect(validateSnapshot(a, registry).valid).toBe(true); // weapon → 单独可 Start
  });

  it('3. 齐射真实 5 发扇形（可复现、无随机）：单发齐射产生 5 个真实 projectile，飞行中明显散开（扇角≈24°）', () => {
    const lab = new PhysicsLab(rendererStub);
    // Q13-B-R1：用远处 B（避免齐射命中即销毁）测量纯扇形散开；隔离于 Scenario 近距离设置
    lab.loadCustom(shotgunSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck',
      autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 2000, y: 650, facing: -1 }, // 远：弹体存活至测量帧
    });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let fired = false;
    let muzzle: { x: number; y: number } | null = null;
    o.onCombatEvent((ev) => {
      if (ev.type === 'weaponFire' && ev.behavior === 'shotgun') {
        fired = true;
        muzzle = ev.worldPosition; // 炮口世界点（与 projectile 生成同源）
      }
    });
    for (let i = 0; i < 60 && !fired; i++) lab.step(16.6667);
    expect(fired).toBe(true);
    // 单发齐射后片刻（B 远未及，弹体存活），5 发应当全部在飞（向下扇弹约 step~12 才触地，故取 step5 测量）
    for (let i = 0; i < 5; i++) lab.step(16.6667);
    const ps = o.getRenderSnapshot().projectiles ?? [];
    expect(ps.length).toBe(5); // 一次齐射 = 5 发（固定，无随机增减）
    const angles = ps.map((p) => Math.atan2(p.center.y - muzzle!.y, p.center.x - muzzle!.x) * 57.3);
    const spread = Math.max(...angles) - Math.min(...angles);
    expect(spread).toBeGreaterThan(12); // 扇形明显展开（标称 24°，重力/车体微倾略减）
    expect(spread).toBeLessThan(32);
    // 可复现：再跑一次仍是 5 发 + 同样扇角区间（无随机散布）
    const lab2 = new PhysicsLab(rendererStub);
    // Q13-B-R1：同 lab，远处 B 隔离测量纯扇形散开（可复现校验）
    lab2.loadCustom(shotgunSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck',
      autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 2000, y: 650, facing: -1 }, // 远：弹体存活至测量帧
    });
    const o2 = lab2.orchestrator as PlanckBattleOrchestrator;
    let fired2 = false;
    let muzzle2: { x: number; y: number } | null = null;
    o2.onCombatEvent((ev) => {
      if (ev.type === 'weaponFire' && ev.behavior === 'shotgun') { fired2 = true; muzzle2 = ev.worldPosition; }
    });
    for (let i = 0; i < 60 && !fired2; i++) lab2.step(16.6667);
    for (let i = 0; i < 5; i++) lab2.step(16.6667);
    const ps2 = o2.getRenderSnapshot().projectiles ?? [];
    expect(ps2.length).toBe(5);
    const a2 = ps2.map((p) => Math.atan2(p.center.y - muzzle2!.y, p.center.x - muzzle2!.x) * 57.3);
    const spread2 = Math.max(...a2) - Math.min(...a2);
    expect(spread2).toBeGreaterThan(16);
    expect(spread2).toBeLessThan(28);
  });

  it('4. 近距离多弹命中（单发齐射）：B 贴近 → 一次齐射 ≥2 弹命中（weapon damage 远超单发 30）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(shotgunSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck',
      autoDrive: false, // 隔离扇形几何，不靠撞击
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 560, y: 650, facing: -1 }, // 贴近：炮口到 B 前脸仅 ~44px
    });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let weaponDmg = 0;
    o.onCombatEvent((ev) => {
      if (ev.type === 'damage' && ev.damageSource === 'weapon' && ev.target === 'B') weaponDmg += ev.damage;
    });
    // 仅统计首发齐射窗口（< 79 步，第二次齐射弹尚未飞抵 B）
    for (let i = 0; i < 79; i++) {
      lab.step(16.6667);
      if (o.result?.phase === 'End') break;
    }
    expect(weaponDmg).toBeGreaterThanOrEqual(60); // ≥2 弹命中（单发仅 30）→ 近距离多弹命中
  });

  it('5. 远处自然散开、部分 Miss（单发齐射）：B 放远 → 同一齐射不能全中（weapon damage < 5×30）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(shotgunSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck',
      autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 900, y: 650, facing: -1 }, // 远处：扇角散开（无慢速重力聚拢）→ 边缘弹 Miss，中央弹仍中（部分 Miss）
    });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let weaponDmg = 0;
    o.onCombatEvent((ev) => {
      if (ev.type === 'damage' && ev.damageSource === 'weapon' && ev.target === 'B') weaponDmg += ev.damage;
    });
    // 单发齐射窗口：远处扇角散开 → 不可能 5 发全中（< 150）；射程自然由 muzzleSpeed 决定（无距离判定消失伤害）
    for (let i = 0; i < 90; i++) {
      lab.step(16.6667);
      if (o.result?.phase === 'End') break;
    }
    expect(weaponDmg).toBeLessThan(150); // 同一齐射不能全中（部分 Miss）
    expect(weaponDmg).toBeGreaterThan(0); // 中央弹仍命中（部分 Miss；非全部 Miss 也有可能）
  });

  it('6. 每发走正式伤害链（ContactRouter projectileDamage）：weapon damage 来源=weapon 且按弹数累积，无隐藏直扣', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(shotgunSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck',
      autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 560, y: 650, facing: -1 },
    });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let weaponDmg = 0;
    let sawOther = false;
    o.onCombatEvent((ev) => {
      if (ev.type === 'damage' && ev.target === 'B') {
        if (ev.damageSource === 'weapon') weaponDmg += ev.damage;
        else sawOther = true; // 不应有非 weapon 来源（无隐藏直扣 HP / 无第二套伤害系统）
      }
    });
    for (let i = 0; i < 90; i++) {
      lab.step(16.6667);
      if (o.result?.phase === 'End') break;
    }
    expect(weaponDmg).toBeGreaterThan(0); // 真实走 ContactRouter 结算
    expect(sawOther).toBe(false); // 无隐藏直扣 HP / 无第二套伤害系统
  });

  it('7. 一次明显炮口爆闪：单发齐射只触发 1 次 weaponFire 事件（非 5 次）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(SCENARIOS.find((s) => s.id === 'Q13-B')!);
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let fireCount = 0;
    o.onCombatEvent((ev) => {
      if (ev.type === 'weaponFire' && ev.behavior === 'shotgun') fireCount++;
    });
    // 一个冷却窗口内（cooldownMs 1300 ≈ 78 步）应只有首发齐射的 1 次事件
    for (let i = 0; i < 78; i++) lab.step(16.6667);
    expect(fireCount).toBe(1); // 5 发齐射只发 1 次 weaponFire → 一次爆闪
  });

  it('8. 真实后坐：齐射瞬间自车 chassis 受真实反向冲量（vx 骤降 + 实际向后位移，非仅数字）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(shotgunSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck',
      autoDrive: false, // 隔离：无前进驱动力，后坐位移清晰可见
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 1150, y: 650, facing: -1 }, // B 远，无碰撞干扰
    });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let firedStep = -1;
    let step = 0;
    const xs: number[] = [];
    const vxs: number[] = [];
    o.onCombatEvent((ev) => {
      if (ev.type === 'weaponFire' && ev.behavior === 'shotgun' && firedStep < 0) firedStep = step;
    });
    for (let i = 0; i < 60; i++) {
      vxs.push(o.world.getLinearVelocity(o.vehicleA.body).x);
      lab.step(16.6667);
      xs.push(o.world.getPosition(o.vehicleA.body).x);
      step++;
      if (firedStep >= 0 && step - firedStep >= 10) break;
    }
    expect(firedStep).toBeGreaterThanOrEqual(0);
    // 真人可见反向运动：前 ~8 帧内至少一次 chassis 实际后退（facing+1 → x 减小）
    let maxBack = 0;
    for (let k = 1; k < 8 && firedStep + k < xs.length; k++) {
      maxBack = Math.max(maxBack, xs[firedStep + k - 1]! - xs[firedStep + k]!);
    }
    expect(maxBack).toBeGreaterThan(0.05); // 明显反向位移（px/帧），真实 impulse 非屏幕震动
    // vx 真正转负（真实冲量，无伪装）
    expect(Math.min(...vxs.slice(firedStep, Math.min(firedStep + 8, vxs.length)))).toBeLessThan(0);
  });

  it('F-DEV-1+Q13-B. 霰弹炮进入玩家部件选项', () => {
    const ids = PART_OPTIONS.map((o) => o.v);
    expect(ids).toContain('shotgun'); // Q13-B：正常 Build 装配页出现霰弹炮
    expect(ids).toContain('cannon');
    expect(ids).toContain('hammer');
    expect(ids).toContain('pushRod');
    expect(ids).toContain('rammer');
    expect(ids).toContain('spear');
    expect(ids).toContain('laser');
    expect(ids).toContain('saw');
    expect(ids).toContain('thruster'); // Q13-C：推进器进入正常 Build
    expect(ids).not.toContain('lifter'); // Q12-B-CLOSE
    expect(ids).not.toContain('ramHead'); // Q12-A-HOLD
    expect(ids).not.toContain('wedgeShovel'); // Q11-A-CLOSE
    expect(ids[0]).toBe(EMPTY_SLOT);
  });
});

/* ---------- Q13-B-R1：霰弹炮从「慢珠子」改成瞬间高速喷射 ---------- */
describe('Q13-B-R1 霰弹炮瞬间喷射', () => {
  /** A 霰弹炮车：watermelon + front shotgun（与 Q13-B 块同定义，本 describe 内复用） */
  function shotgunSnapshot(side: 'A' | 'B') {
    return buildSnapshotFromDraft(
      {
        bodyDefId: 'watermelonBody',
        rearRadius: 20,
        frontRadius: 20,
        functionalSelections: { front: 'shotgun', frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT },
      },
      registry,
      side,
    );
  }
  /** B 无攻击件目标车（boxBody） */
  function plainSnapshot(side: 'A' | 'B') {
    return buildSnapshotFromDraft(
      { bodyDefId: 'boxBody', rearRadius: 20, frontRadius: 20, functionalSelections: {} },
      registry,
      side,
    );
  }

  it('1. 高速喷射：muzzleSpeed 12~14（高于 Cannon 8）；一次齐射仍 5 个真实 projectile；Cannon 不受影响', () => {
    const def = registry.functionals.get('shotgun')!;
    const bp = def.behaviorParams as Record<string, number>;
    expect(bp.muzzleSpeed).toBeGreaterThanOrEqual(12);
    expect(bp.muzzleSpeed).toBeLessThanOrEqual(14);
    expect((registry.functionals.get('cannon')!.behaviorParams as Record<string, number>).muzzleSpeed).toBe(8); // 不改 Cannon
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(shotgunSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck', autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 }, spawnB: { x: 2000, y: 650, facing: -1 },
    });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let fired = false;
    o.onCombatEvent((ev) => { if (ev.type === 'weaponFire' && ev.behavior === 'shotgun') fired = true; });
    for (let i = 0; i < 60 && !fired; i++) lab.step(16.6667);
    expect(fired).toBe(true);
    for (let i = 0; i < 3; i++) lab.step(16.6667);
    const ps = o.getRenderSnapshot().projectiles ?? [];
    expect(ps.length).toBe(5); // 5 个真实 projectile（保留正式 CCD/Owner/Damage 链）
  });

  it('2. 弹迹渲染：shotgun projectile 带 tracer 视觉标记 + 真实 velocity（沿飞行方向）；真实 Collider 半径不变（=7，不扩大命中范围）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(shotgunSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck', autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 }, spawnB: { x: 2000, y: 650, facing: -1 },
    });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let fired = false;
    o.onCombatEvent((ev) => { if (ev.type === 'weaponFire' && ev.behavior === 'shotgun') fired = true; });
    for (let i = 0; i < 60 && !fired; i++) lab.step(16.6667);
    for (let i = 0; i < 3; i++) lab.step(16.6667);
    const ps = o.getRenderSnapshot().projectiles ?? [];
    expect(ps.length).toBe(5);
    for (const p of ps) {
      expect(p.visual).toBe('tracer'); // 沿真实 velocity 的短高速弹迹（非普通圆点）
      expect(p.radius).toBeCloseTo(7, 6); // 真实 Collider 半径不变（不扩大命中范围）
      expect(p.velocity).toBeDefined();
      const sp = Math.hypot(p.velocity!.x, p.velocity!.y);
      expect(sp).toBeGreaterThan(8); // 真实高速（≈ muzzleSpeed 13 + 射手速度）
      expect(sp).toBeLessThan(22);
      expect(p.velocity!.x).toBeGreaterThan(0); // A facing +X → 弹迹朝前
    }
  });

  it('3. 炮口扇形爆闪（有方向，非圆形 flash）：spawnShotgunFan 产生 1 个沿真实 fire 方向的扇形 VFX', () => {
    (globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };
    const renderer = new Renderer(makeCtxStubCanvas());
    renderer.spawnShotgunFan(500, 400, 1, 0); // A facing +X → 朝右
    const fans = renderer.activeShotgunFans;
    expect(fans.length).toBe(1);
    expect(fans[0]!.dirX).toBeGreaterThan(0.9); // 沿真实 fire 方向
    expect(fans[0]!.dirY).toBeCloseTo(0, 6);
  });

  it('4. 近距离多发真实命中：B 贴近（560）→ 一次齐射 ≥2 弹命中（weapon damage ≥ 60）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(shotgunSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck', autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 }, spawnB: { x: 560, y: 650, facing: -1 },
    });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let weaponDmg = 0;
    o.onCombatEvent((ev) => {
      if (ev.type === 'damage' && ev.damageSource === 'weapon' && ev.target === 'B') weaponDmg += ev.damage;
    });
    for (let i = 0; i < 79; i++) { lab.step(16.6667); if (o.result?.phase === 'End') break; }
    expect(weaponDmg).toBeGreaterThanOrEqual(60); // ≥2 弹命中 → 近距离多弹真实命中
  });

  it('5. 后坐直接作用于 chassis 且明显：开火瞬间自车 chassis 实际后顿（vx 转负 + 可见反向位移）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(shotgunSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck', autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 }, spawnB: { x: 1150, y: 650, facing: -1 },
    });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let firedStep = -1;
    let step = 0;
    const xs: number[] = [];
    const vxs: number[] = [];
    o.onCombatEvent((ev) => {
      if (ev.type === 'weaponFire' && ev.behavior === 'shotgun' && firedStep < 0) firedStep = step;
    });
    for (let i = 0; i < 60; i++) {
      vxs.push(o.world.getLinearVelocity(o.vehicleA.body).x);
      lab.step(16.6667);
      xs.push(o.world.getPosition(o.vehicleA.body).x);
      step++;
      if (firedStep >= 0 && step - firedStep >= 10) break;
    }
    expect(firedStep).toBeGreaterThanOrEqual(0);
    let maxBack = 0;
    for (let k = 1; k < 8 && firedStep + k < xs.length; k++) {
      maxBack = Math.max(maxBack, xs[firedStep + k - 1]! - xs[firedStep + k]!);
    }
    expect(maxBack).toBeGreaterThan(0.3); // 明显反向位移（px/帧），整车顿一下
    expect(Math.min(...vxs.slice(firedStep, Math.min(firedStep + 8, vxs.length)))).toBeLessThan(0);
  });
});

/* ---------- Q13-C：推进器 Gadget（固定周期 windup→thrust→cooldown；沿 chassis facing 施力 + 真实喷焰；不改轮子/不造成伤害） ---------- */
describe('Q13-C 推进器 Gadget', () => {
  /** A 推进器车：watermelon + rear thruster（Q13-C-R1：改装 rear hardpoint，车尾点火向车外喷） */
  function thrusterSnapshot(side: 'A' | 'B') {
    return buildSnapshotFromDraft(
      {
        bodyDefId: 'watermelonBody',
        rearRadius: 20,
        frontRadius: 20,
        functionalSelections: { rear: 'thruster', front: EMPTY_SLOT, frontMass: EMPTY_SLOT, top: EMPTY_SLOT },
      },
      registry,
      side,
    );
  }
  /** B 无攻击件目标车（boxBody，与 Q13-C Scenario 一致） */
  function plainSnapshot(side: 'A' | 'B') {
    return buildSnapshotFromDraft(
      {
        bodyDefId: 'boxBody',
        rearRadius: 20,
        frontRadius: 20,
        functionalSelections: { front: EMPTY_SLOT, frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT },
      },
      registry,
      side,
    );
  }

  it('1. thruster 定义：gadget / box collider / behavior thruster / 固定周期 windup 0.2~0.3s→thrust≈0.3s→cooldown≈1.5s / 从安装位置推导推力方向 / 无 baseDamage', () => {
    const def = registry.functionals.get('thruster')!;
    expect(def.category).toBe('gadget'); // Gadget：改变距离/姿态，不直接伤害
    expect(def.behavior).toBe('thruster');
    const c = def.collider as { shape: string; width: number; height: number; offset: { x: number; y: number } };
    expect(c.shape).toBe('box'); // 短粗喷口（非第二套物理系统）
    const bp = def.behaviorParams as Record<string, number>;
    // Q13-C-R1：更强爆发节奏
    expect(bp.windupMs).toBeGreaterThanOrEqual(200);
    expect(bp.windupMs).toBeLessThanOrEqual(300);
    expect(bp.thrustMs).toBeGreaterThanOrEqual(280);
    expect(bp.thrustMs).toBeLessThanOrEqual(340);
    expect(bp.cooldownMs).toBeCloseTo(1500, 0);
    // Q13-C-R1：明显放大喷焰（不再是小于轮径的小喷焰）
    expect(bp.flameLength).toBeGreaterThanOrEqual(90);
    expect(bp.flameLength).toBeLessThanOrEqual(120);
    expect(bp.flameWidth).toBeGreaterThanOrEqual(30);
    expect(bp.flameWidth).toBeLessThanOrEqual(40);
    // Q13-C-R1：矫枉过正，impulse 远大于初版 8
    expect(bp.thrustImpulse).toBeGreaterThan(20);
    expect(typeof bp.flameColor).toBe('string');
    expect((bp.baseDamage as number | undefined)).toBeUndefined(); // Gadget：无 Direct Weapon Damage
  });

  it('2. 加入正常 Build：PART_OPTIONS 含 thruster；Preview 真实部件 + Weld 装配 + Energy 计入；与武器组成合法 Build', () => {
    expect(PART_OPTIONS.map((o) => o.v)).toContain('thruster');
    expect((EDITABLE_FUNCTIONAL_DEF_IDS as readonly string[])).toContain('thruster');
    // 推进器是 Gadget（无 Direct Damage），单独不构成合法战斗 Build（规则要求至少 1 件 Weapon）；
    // 与一件 Weapon（top=spear）组成合法 Build 验证 Preview / Weld / Energy / Validator。
    const a = buildSnapshotFromDraft(
      {
        bodyDefId: 'watermelonBody',
        rearRadius: 20,
        frontRadius: 20,
        functionalSelections: { front: 'thruster', frontMass: EMPTY_SLOT, top: 'spear', rear: EMPTY_SLOT },
      },
      registry,
      'A',
    );
    const b = plainSnapshot('B');
    const lab = new PhysicsLab(rendererStub);
    expect(() => lab.loadCustomPreview(a, b)).not.toThrow();
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    const thPart = o.vehicleA.parts.find((p) => p.def.id === 'thruster')!;
    expect(thPart).toBeDefined();
    expect(thPart.joint).toBeDefined(); // Weld joint（非 Revolute/Prismatic）
    expect(computeEnergy(a, registry).energy).toBe(45); // 推进器 20 + 刺 25
    expect(validateSnapshot(a, registry).valid).toBe(true); // 含 Weapon → 合法 Build
  });

  it('3. 固定周期可复现（windup→thrust→cooldown）：喷焰仅推进期出现、停推即消失；两次一致', () => {
    const trace = (): number[] => {
      const lab = new PhysicsLab(rendererStub);
      lab.loadScenario(SCENARIOS.find((s) => s.id === 'Q13-C')!);
      const o = lab.orchestrator as PlanckBattleOrchestrator;
      const flameSteps: number[] = [];
      for (let i = 0; i < 200; i++) {
        lab.step(16.6667);
        flameSteps.push((o.getRenderSnapshot().flames ?? []).length);
      }
      return flameSteps;
    };
    const f1 = trace();
    const f2 = trace();
    const first = (arr: number[]): number => arr.findIndex((n) => n > 0);
    const first1 = first(f1);
    const first2 = first(f2);
    // windup 结束（首次喷焰）≈ ceil(250/16.667)=15 步，容忍 ±4（Q13-C-R1 缩短前摇）
    expect(first1).toBeGreaterThanOrEqual(11);
    expect(first1).toBeLessThanOrEqual(19);
    expect(first2).toBe(first1); // 可复现：无随机偏移
    const thrustLen = (arr: number[]): number => {
      const s = first(arr);
      let e = s;
      while (e < arr.length && arr[e]! > 0) e++;
      return e - s;
    };
    expect(thrustLen(f1)).toBeGreaterThanOrEqual(14); // 推进 ≈ 18 步（300ms，Q13-C-R1 缩短）
    expect(thrustLen(f1)).toBeLessThanOrEqual(22);
    // windup 段无喷焰（停推即消失）
    expect(f1.slice(0, first1).every((n) => n === 0)).toBe(true);
  });

  it('4. 仅自己 chassis 加速、推进前后速度/位移明显不同（不 setVelocity）：thrust 段 chassis 沿推力方向 vx 明显增大，windup 段≈0', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(thrusterSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck',
      autoDrive: false, // 隔离：无前进驱动力，推力效果清晰
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 1150, y: 650, facing: -1 },
    });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    const vx = (): number => o.world.getLinearVelocity(o.vehicleA.body).x;
    const x0 = o.world.getPosition(o.vehicleA.body).x;
    // 前摇段（约 14 步，进入 thrust 之前）：无推力，vx≈0
    for (let i = 0; i < 14; i++) lab.step(16.6667);
    const vWindup = vx();
    expect(Math.abs(vWindup)).toBeLessThan(0.2); // 前摇未偷偷加速 / 未瞬移
    // 推进段（约 18 步，Q13-C-R1 0.3s 强爆发）：rear 安装 → 沿 +X 明显加速、明显位移
    for (let i = 0; i < 18; i++) lab.step(16.6667);
    const vThrust = vx();
    expect(vThrust).toBeGreaterThan(1.0); // 明显「突然加速」（Q13-C-R1 矫枉过正）
    expect(vThrust).toBeGreaterThan(vWindup + 0.5); // 推进前后速度明显不同
    const xThrust = o.world.getPosition(o.vehicleA.body).x;
    expect(xThrust - x0).toBeGreaterThan(15); // 实际明显位移（非仅数字）
  });

  it('5. 不给对手力 / 冷却期不偷偷加速：B chassis 不受推力；cooldown 段 A vx 增量≈0（无隐藏施力）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(thrusterSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck',
      autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 1150, y: 650, facing: -1 }, // B 远，无碰撞干扰
    });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    const vxA = (): number => o.world.getLinearVelocity(o.vehicleA.body).x;
    const vxB = (): number => o.world.getLinearVelocity(o.vehicleB.body).x;
    // 推进到进入 thrust 再越过 thrust 进入 cooldown
    let guard = 0;
    while ((o.getRenderSnapshot().flames ?? []).length === 0 && guard < 200) {
      lab.step(16.6667);
      guard++;
    }
    let guard2 = 0;
    while ((o.getRenderSnapshot().flames ?? []).length > 0 && guard2 < 200) {
      lab.step(16.6667);
      guard2++;
    }
    expect(Math.abs(vxB())).toBeLessThan(0.2); // 对手 chassis 不受推进器推力
    // 冷却段（thrust 结束后）采样 vx：推进器不再施力 → 速度不再明显增长（无隐藏加速）
    const samples: number[] = [];
    for (let i = 0; i < 40; i++) {
      lab.step(16.6667);
      samples.push(vxA());
    }
    // 冷却段无隐藏推力：末速度不应超过采样初速度 0.3 以上（允许自然摩擦使其持平/略降）
    expect(samples[samples.length - 1]!).toBeLessThanOrEqual(samples[0]! + 0.3);
  });

  it('6. 喷焰仅推进期、真实安装位置：thrust 段 flames 含 1 个且 team/color 正确；windup/cooldown 段为空', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadScenario(SCENARIOS.find((s) => s.id === 'Q13-C')!);
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let sawThrustFlame = false;
    let sawNonThrustFlame = false;
    for (let i = 0; i < 200; i++) {
      lab.step(16.6667);
      const flames = o.getRenderSnapshot().flames ?? [];
      const part = o.vehicleA.parts.find((p) => p.def.id === 'thruster')!;
      const partPos = o.world.getPosition(part.body);
      if (flames.length > 0) {
        sawThrustFlame = true;
        const f = flames[0]!;
        expect(flames.length).toBe(1);
        expect(f.team).toBe('A');
        expect(typeof f.color).toBe('string');
        // 喷焰根部 ≈ 真实安装位置（part 世界坐标，容差 1px）
        expect(Math.hypot(f.x - partPos.x, f.y - partPos.y)).toBeLessThan(1);
        expect(f.dirX).toBeLessThan(0); // facing=+1 → 喷焰朝后（dirX<0）
      } else {
        sawNonThrustFlame = true; // 非推进期（windup/cooldown）无喷焰
      }
    }
    expect(sawThrustFlame).toBe(true);
    expect(sawNonThrustFlame).toBe(true);
  });

  it('7. 碰撞仍走真实质量/姿态、不造成 Direct Weapon Damage：A 推进撞 B → B 真实位移、全程无 weapon damage', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(thrusterSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck',
      autoDrive: false,
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 520, y: 650, facing: -1 }, // 贴近：推进后直接撞上
    });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    const xB0 = o.world.getPosition(o.vehicleB.body).x;
    let weaponDmg = 0;
    o.onCombatEvent((ev) => {
      if (ev.type === 'damage' && ev.target === 'B' && ev.damageSource === 'weapon') weaponDmg += ev.damage;
    });
    for (let i = 0; i < 200; i++) {
      lab.step(16.6667);
      if (o.result?.phase === 'End') break;
    }
    const xB1 = o.world.getPosition(o.vehicleB.body).x;
    expect(xB1 - xB0).toBeGreaterThan(1); // 撞击后 B 真实产生位移（碰撞物理生效）
    expect(weaponDmg).toBe(0); // 推进器是 Gadget，不造成 Direct Weapon Damage
  });

  it('8. 不改正常轮子 Movement 参数：autoDrive=true 时 A 车仍由轮子正常驱动（终速由 drive 主导，未被推进器破坏）', () => {
    const lab = new PhysicsLab(rendererStub);
    lab.loadCustom(thrusterSnapshot('A'), plainSnapshot('B'), {
      engine: 'planck',
      autoDrive: true, // 轮子正常驱动
      spawnA: { x: 450, y: 650, facing: 1 },
      spawnB: { x: 1150, y: 650, facing: -1 },
    });
    const o = lab.orchestrator as PlanckBattleOrchestrator;
    let positiveSteps = 0;
    for (let i = 0; i < 300; i++) {
      lab.step(16.6667);
      if (o.world.getLinearVelocity(o.vehicleA.body).x > 0) positiveSteps++;
    }
    expect(positiveSteps).toBeGreaterThan(250); // 绝大多数时间向前（轮子 drive 正常）
  });

  it('F-DEV-1+Q13-C. 推进器进入玩家部件选项', () => {
    const ids = PART_OPTIONS.map((o) => o.v);
    expect(ids).toContain('thruster');
    expect(ids).toContain('cannon');
    expect(ids).toContain('hammer');
    expect(ids).toContain('pushRod');
    expect(ids).toContain('rammer');
    expect(ids).toContain('spear');
    expect(ids).toContain('laser');
    expect(ids).toContain('saw');
    expect(ids).toContain('shotgun');
    expect(ids).not.toContain('lifter');
    expect(ids).not.toContain('ramHead');
    expect(ids).not.toContain('wedgeShovel');
    expect(ids[0]).toBe(EMPTY_SLOT);
  });

  /* ---------- Q13-C-R1：推进器安装方向 + 爆发推进（rear 车尾点火向车外喷 / 从安装位置推导推力方向 / 更强爆发） ---------- */
  describe('Q13-C-R1 推进器安装方向 + 爆发推进', () => {
    /** 前置安装车（验证方向自然反转）：watermelon + front thruster */
    function frontThrusterSnapshot(side: 'A' | 'B') {
      return buildSnapshotFromDraft(
        {
          bodyDefId: 'watermelonBody',
          rearRadius: 20,
          frontRadius: 20,
          functionalSelections: { front: 'thruster', frontMass: EMPTY_SLOT, top: EMPTY_SLOT, rear: EMPTY_SLOT },
        },
        registry,
        side,
      );
    }

    it('1. 官方 Q13-C Scenario 喷焰明确位于车尾外（rear 安装）：根部=真实安装点，方向 outward 朝车外、tip 在车身外、绝不穿过车身', () => {
      const lab = new PhysicsLab(rendererStub);
      lab.loadScenario(SCENARIOS.find((s) => s.id === 'Q13-C')!);
      const o = lab.orchestrator as PlanckBattleOrchestrator;
      let saw = false;
      for (let i = 0; i < 200; i++) {
        lab.step(16.6667);
        const flames = o.getRenderSnapshot().flames ?? [];
        if (flames.length > 0) {
          saw = true;
          const f = flames[0]!;
          const part = o.vehicleA.parts.find((p) => p.def.id === 'thruster')!;
          const partPos = o.world.getPosition(part.body);
          const c = o.world.getPosition(o.vehicleA.body);
          // 根部 ≈ 真实安装点（part 世界坐标，容差 1px）
          expect(Math.hypot(f.x - partPos.x, f.y - partPos.y)).toBeLessThan(1);
          // 喷焰方向指向远离车身中心（outward，装在后部 → 朝车尾外）
          const ox = partPos.x - c.x;
          const oy = partPos.y - c.y;
          expect(f.dirX * ox + f.dirY * oy).toBeGreaterThan(0);
          // 喷焰 tip（取 flameLength 量级）落在车身外（watermelon half-width 85）
          const tipx = f.x + f.dirX * 100;
          const tipy = f.y + f.dirY * 100;
          expect(Math.hypot(tipx - c.x, tipy - c.y)).toBeGreaterThan(85);
        }
      }
      expect(saw).toBe(true);
    });

    it('2. 点火与突然加速同步（rear）：进入 thrust 当步即喷焰 + 加速，windup 段 vx≈0', () => {
      const lab = new PhysicsLab(rendererStub);
      lab.loadCustom(thrusterSnapshot('A'), plainSnapshot('B'), {
        engine: 'planck',
        autoDrive: false,
        spawnA: { x: 450, y: 650, facing: 1 },
        spawnB: { x: 1150, y: 650, facing: -1 },
      });
      const o = lab.orchestrator as PlanckBattleOrchestrator;
      const vel = (): number => o.world.getLinearVelocity(o.vehicleA.body).x;
      // 前摇（约 14 步，进入 thrust 之前）：无喷焰、vx≈0
      for (let i = 0; i < 14; i++) lab.step(16.6667);
      expect((o.getRenderSnapshot().flames ?? []).length).toBe(0);
      expect(Math.abs(vel())).toBeLessThan(0.2);
      // 进入 thrust：当步即有喷焰且开始加速
      lab.step(16.6667);
      expect((o.getRenderSnapshot().flames ?? []).length).toBeGreaterThan(0);
      expect(vel()).toBeGreaterThan(0.1); // 点火当步即加速（同步，单步已明显 >0）
    });

    it('3. 0.3s burst 与 cooldown 一眼可区分：thrust 段速度明显增长，等长 cooldown 段不再增长（无隐藏推力）', () => {
      const lab = new PhysicsLab(rendererStub);
      lab.loadCustom(thrusterSnapshot('A'), plainSnapshot('B'), {
        engine: 'planck',
        autoDrive: false,
        spawnA: { x: 450, y: 650, facing: 1 },
        spawnB: { x: 1150, y: 650, facing: -1 },
      });
      const o = lab.orchestrator as PlanckBattleOrchestrator;
      const vel = (): number => o.world.getLinearVelocity(o.vehicleA.body).x;
      const pos = (): number => o.world.getPosition(o.vehicleA.body).x;
      for (let i = 0; i < 14; i++) lab.step(16.6667); // windup
      const v0 = vel();
      const x0 = pos();
      for (let i = 0; i < 18; i++) lab.step(16.6667); // thrust（0.3s）
      const vThrust = vel();
      const dThrust = pos() - x0;
      expect(vThrust - v0).toBeGreaterThan(1.0); // 爆发段明显加速
      expect(dThrust).toBeGreaterThan(15); // 爆发段明显位移（肉眼可辨）
      // cooldown（等长 18 步）：无隐藏推力 → 速度不再明显增长
      for (let i = 0; i < 18; i++) lab.step(16.6667);
      const vCool = vel();
      expect(vCool - vThrust).toBeLessThan(0.4); // 冷却段无偷偷加推力
    });

    it('4. 前置安装时推力方向自然反转：car 被向后推（vx<0）、喷焰朝车头外（dirX>0），不穿过车身', () => {
      const lab = new PhysicsLab(rendererStub);
      lab.loadCustom(frontThrusterSnapshot('A'), plainSnapshot('B'), {
        engine: 'planck',
        autoDrive: false,
        spawnA: { x: 450, y: 650, facing: 1 },
        spawnB: { x: 1150, y: 650, facing: -1 },
      });
      const o = lab.orchestrator as PlanckBattleOrchestrator;
      let sawFlame = false;
      let minVx = Infinity;
      let dirOk = true;
      // 步进到推力段并采样
      let guard = 0;
      while ((o.getRenderSnapshot().flames ?? []).length === 0 && guard < 60) {
        lab.step(16.6667);
        guard++;
      }
      for (let i = 0; i < 18; i++) {
        lab.step(16.6667);
        minVx = Math.min(minVx, o.world.getLinearVelocity(o.vehicleA.body).x);
        const flames = o.getRenderSnapshot().flames ?? [];
        if (flames.length > 0) {
          sawFlame = true;
          if (flames[0]!.dirX <= 0) dirOk = false; // 前置 → 喷焰朝车头外（+x）
        }
      }
      expect(sawFlame).toBe(true);
      expect(dirOk).toBe(true);
      expect(minVx).toBeLessThan(-0.5); // 车被明显向后推（方向反转，非喷火穿车）
    });

    it('5. 仅自己 chassis 加速、不给对手力：B chassis 不受推进器直接推力', () => {
      const lab = new PhysicsLab(rendererStub);
      lab.loadCustom(thrusterSnapshot('A'), plainSnapshot('B'), {
        engine: 'planck',
        autoDrive: false,
        spawnA: { x: 450, y: 650, facing: 1 },
        spawnB: { x: 1150, y: 650, facing: -1 },
      });
      const o = lab.orchestrator as PlanckBattleOrchestrator;
      const vxB = (): number => o.world.getLinearVelocity(o.vehicleB.body).x;
      // 只采样首轮推进（进入 thrust 再越过 thrust 进入 cooldown 后），避免 A 推进撞上 B 的碰撞位移干扰
      let guard = 0;
      while ((o.getRenderSnapshot().flames ?? []).length === 0 && guard < 60) {
        lab.step(16.6667);
        guard++;
      }
      let guard2 = 0;
      while ((o.getRenderSnapshot().flames ?? []).length > 0 && guard2 < 60) {
        lab.step(16.6667);
        guard2++;
      }
      for (let i = 0; i < 40; i++) lab.step(16.6667);
      expect(Math.abs(vxB())).toBeLessThan(0.2); // 对手 chassis 不受推进器直接推力（碰撞位移不在此窗口内）
    });
  });
});
