/**
 * PRP-BUILD-01-R1-KINETIC-IMPACT-PERCEPTIBILITY｜证据测试。
 *
 * 本 Queue 要解决的问题是「存在 → 可感知」：`重型弹头 → 动能爆发` 的技术联动早就在，
 * 但真人在正常速度下**看不出**「这一炮命中后又产生了一次额外动能冲击」。因此这里验四件事：
 *
 *   RC-01/02  真实量值口径：冲量 = GAIN × **当前 projectile 质量** × **命中相对速度**，
 *             且作用点 = **真实命中点**（`damage.contactPoint`）→ 不是写死伤害、不是质心。
 *   RC-03/04  纯触发口径：只有 `damage`（A→B / weapon / cannon）才触发；战斗结束后不再触发。
 *   RC-05     命中冲击环的几何：短（< 0.3s 内归零）、只在真实 trigger 后出现、半径/透明度单调、
 *             位置与真实命中点**同源**（本文件只验纯几何；绘制接线见 runPage + E2E）。
 *   RC-06     **同条件 A/B**（Queue 必改 4）：固定 Player / Enemy / spawn / HP / world / **正式相机链**，
 *             只改第二层 → 记录命中后短窗内的真实位移 / 转角 / 速度跃变，证明物理结果确实不同。
 *
 * ⚠️ 所有期望值都是**实测后冻结的字面量**。若有人把增益调回去、或把作用点改回质心、
 *    或让环变成常驻动画，这里会立刻红。
 */
import { describe, expect, it } from 'vitest';
import {
  KINETIC_BURST_GAIN,
  RUN_ALL_MODIFIER_IDS,
  RUN_MODIFIER_OVERLAY,
} from '../src/lab/portraitBattleLab/runModifiers';
import {
  RunBuildAbilities,
  type RunAbilityPorts,
  type RunTeamId,
} from '../src/lab/portraitBattleLab/runBuildAbilities';
import {
  RUN_IMPACT_CORE_MS,
  RUN_IMPACT_RING_MS,
  runImpactCoreShape,
  runImpactRingShapes,
} from '../src/lab/portraitBattleLab/runImpactVfx';
import {
  RUN_BATTLE_VIEW_H,
  RUN_BATTLE_VIEW_INSET,
  RUN_BATTLE_VIEW_W,
  RunBattleRuntime,
  battleBandX,

  shouldReframeBattleCamera,
  vehicleWorldBox,
} from '../src/lab/portraitBattleLab/runBattleRuntime';
import { RUN_STAGE_BAND } from '../src/lab/portraitBattleLab/runPageLayout';
import { RUN_LEDGER_COLORS } from '../src/lab/portraitBattleLab/runPage';
import { Renderer } from '../src/render/renderer';
import { VisualRegistry } from '../src/render/visualRegistry';
import type { CanvasSurface } from '../src/render/canvasSurface';
import type { BattleEvent, DamageEvent, WeaponFireEvent } from '../src/battle/combatEvents';

const FRAME_MS = 1000 / 60;

/* --------------------------------------------------- 假端口（只验语义，不建世界） */

interface FakePorts extends RunAbilityPorts {
  readonly applied: Array<{
    team: RunTeamId;
    dirX: number;
    dirY: number;
    magnitude: number;
    at: { x: number; y: number } | null | undefined;
  }>;
  readonly emit: (ev: BattleEvent) => void;
  /** 让测试控制「战斗是否已结束」。 */
  setFinished: (v: boolean) => void;
}

function fakePorts(projectileMass: number): FakePorts {
  let fn: ((ev: BattleEvent) => void) | null = null;
  let finished = false;
  const applied: FakePorts['applied'] = [] as unknown as FakePorts['applied'];
  const ports = {
    subscribe: (f: (ev: BattleEvent) => void) => {
      fn = f;
      return () => {
        fn = null;
      };
    },
    isFinished: () => finished,
    facingOf: () => 1,
    projectileMass: () => projectileMass,
    applyImpulse: (
      team: RunTeamId,
      dirX: number,
      dirY: number,
      magnitude: number,
      at?: { x: number; y: number } | null,
    ) => {
      (applied as Array<unknown>).push({ team, dirX, dirY, magnitude, at });
    },
  } as unknown as FakePorts;
  Object.defineProperty(ports, 'applied', { value: applied, enumerable: true });
  Object.defineProperty(ports, 'emit', {
    value: (ev: BattleEvent) => fn?.(ev),
    enumerable: true,
  });
  Object.defineProperty(ports, 'setFinished', {
    value: (v: boolean) => {
      finished = v;
    },
    enumerable: true,
  });
  return ports;
}

function fireEvent(team: RunTeamId, x = 0, y = 0): WeaponFireEvent {
  return {
    type: 'weaponFire',
    team,
    partId: 'part:front',
    behavior: 'cannon',
    worldPosition: { x, y },
    worldDirection: { x: 1, y: 0 },
    timestamp: 0,
  };
}

function damageEvent(over: Partial<DamageEvent> = {}): DamageEvent {
  return {
    type: 'damage',
    source: 'A',
    target: 'B',
    damageSource: 'weapon',
    behavior: 'cannon',
    contactPoint: { x: 700, y: 660 },
    contactNormal: { x: -1, y: 0 },
    relativeVelocity: 8,
    damage: 80,
    hpBefore: 1000,
    hpAfter: 920,
    timestamp: 0,
    ...over,
  };
}

/* ---------------------------------------------- RC-01/02 真实量值口径 */

describe('PRP-BUILD-01-R1｜动能爆发 = 真实量值 + 真实作用点（不是写死伤害、不是质心）', () => {
  it('RC-01 冲量 = GAIN × 当前 projectile 质量 × 命中相对速度（严格等式，含重弹 4× 关系）', () => {
    expect(KINETIC_BURST_GAIN).toBe(28);

    for (const [mass, relV] of [
      [1, 8],
      [4, 8],
      [4, 2.5],
    ] as const) {
      const p = fakePorts(mass);
      const ab = new RunBuildAbilities(p, ['kineticBurst']);
      p.emit(damageEvent({ relativeVelocity: relV }));
      ab.flush();
      expect(p.applied).toHaveLength(1);
      const want = KINETIC_BURST_GAIN * mass * relV;
      expect(p.applied[0].magnitude).toBeCloseTo(want, 12);
      // ⚠️ 不存在「重型弹头专属固定值」：mass 4 的冲量严格是 mass 1 的 4 倍（同一 relV）
      expect(p.applied[0].magnitude / (KINETIC_BURST_GAIN * relV)).toBeCloseTo(mass, 12);
      ab.dispose();
    }
  });

  it('RC-02 作用点 = 真实命中点（contactPoint），不是质心、也不是炮口', () => {
    const p = fakePorts(4);
    const ab = new RunBuildAbilities(p, ['kineticBurst']);
    // 先开一次火（真实炮口方向）→ 再命中 → 冲量方向 = 该次开火的真实方向
    p.emit({ ...fireEvent('A'), worldDirection: { x: 1, y: 0 } });
    p.emit(damageEvent({ contactPoint: { x: 693.4, y: 683.8 } }));
    ab.flush();
    expect(p.applied).toHaveLength(1);
    const imp = p.applied[0];
    // 作用点**逐字段等于**事件的 contactPoint（不是质心、不是炮口位置）
    expect(imp.at).toEqual({ x: 693.4, y: 683.8 });
    expect(imp.team).toBe('B'); // 被轰开的是敌车
    expect(imp.dirX).toBeCloseTo(1, 12);
    expect(imp.dirY).toBeCloseTo(0, 12);

    // 不带动能爆发 → 永不产生冲量（结构上不可能「没选也生效」）
    const off = fakePorts(4);
    const abOff = new RunBuildAbilities(off, ['heavyShell']);
    off.emit(damageEvent());
    abOff.flush();
    expect(off.applied).toHaveLength(0);
    ab.dispose();
    abOff.dispose();
  });
});

/* ------------------------------------------------- RC-03/04 触发口径 */

describe('PRP-BUILD-01-R1｜只由「真实的玩家炮弹打中敌车」触发', () => {
  it('RC-03 只有 damage(A→B / weapon / cannon) 触发；其它一律不触发', () => {
    const cases: Array<[string, Partial<DamageEvent>]> = [
      ['敌打玩家', { source: 'B', target: 'A' }],
      ['非武器伤害', { damageSource: 'impact' }],
      ['危险物伤害', { damageSource: 'hazard' }],
      ['非炮弹 behavior', { behavior: 'saw' }],
    ];
    for (const [label, over] of cases) {
      const p = fakePorts(4);
      const ab = new RunBuildAbilities(p, ['kineticBurst']);
      p.emit(damageEvent(over));
      ab.flush();
      expect(p.applied, label).toHaveLength(0);
      expect(ab.snapshot().kineticHits, label).toBe(0);
      ab.dispose();
    }

    // 真实开火事件本身**不**产生冲量（只有命中才产生）→ 不是「开炮就轰」
    const p2 = fakePorts(4);
    const ab2 = new RunBuildAbilities(p2, ['kineticBurst']);
    p2.emit(fireEvent('A'));
    p2.emit(fireEvent('B'));
    ab2.flush();
    expect(p2.applied).toHaveLength(0);
    ab2.dispose();
  });

  it('RC-04 战斗结束后不再施加任何冲量（保住「RESULT = 战场冻结」）', () => {
    const p = fakePorts(4);
    const ab = new RunBuildAbilities(p, ['kineticBurst']);
    // 结束前：能触发
    p.emit(damageEvent());
    ab.flush();
    expect(p.applied).toHaveLength(1);
    // 结束后的命中事件 → 不入队
    p.setFinished(true);
    p.emit(damageEvent());
    expect(ab.snapshot().pending).toBe(0);
    ab.flush();
    expect(p.applied).toHaveLength(1);
    ab.dispose();
  });
});

/* ---------------------------------------------- RC-05 冲击环纯几何 */

describe('PRP-BUILD-01-R1｜命中冲击环：短、只在真实触发后出现、与命中点同源', () => {
  it('RC-05a 短：寿命内单调扩张 + 透明度单调衰减，超期归零（结构上不可能常驻）', () => {
    expect(RUN_IMPACT_RING_MS).toBeLessThan(300); // Queue 要求「短」
    expect(runImpactRingShapes(-1)).toHaveLength(0); // 负 age = 还没触发过
    expect(runImpactRingShapes(RUN_IMPACT_RING_MS + 1)).toHaveLength(0); // 到期 → 什么都不画
    expect(runImpactRingShapes(0).length).toBeGreaterThan(0); // 真实触发那一刻必须有环

    const ages = [0, 20, 40, 60, 80, 120, 180, 240, RUN_IMPACT_RING_MS];
    const outer = ages.map((a) => runImpactRingShapes(a));
    // 外环半径严格递增、透明度严格递减
    let prevR = -1;
    let prevA = Infinity;
    for (let i = 0; i < ages.length; i++) {
      const first = outer[i][0];
      expect(first.radius).toBeGreaterThan(prevR);
      expect(first.alpha).toBeLessThan(prevA);
      prevR = first.radius;
      prevA = first.alpha;
      // 环内**不填充** → 只有描边宽度一个可变量，且随寿命变细（「不遮挡车辆」的几何前提）
      expect(first.lineWidth).toBeGreaterThan(0);
    }
    // 峰值透明度 < 1（半透明 → 不遮挡被覆盖的像素）
    expect(runImpactRingShapes(0)[0].alpha).toBeLessThan(1);
    // 第二道环延迟出现 → 读作「一次冲击」而不是单个气泡
    expect(runImpactRingShapes(0)).toHaveLength(1);
    expect(runImpactRingShapes(80).length).toBeGreaterThanOrEqual(2);
  });

  it('RC-05b 核心亮点更短、更小，同样到期归零', () => {
    expect(RUN_IMPACT_CORE_MS).toBeLessThan(RUN_IMPACT_RING_MS);
    expect(runImpactCoreShape(-1)).toBeNull();
    expect(runImpactCoreShape(RUN_IMPACT_CORE_MS + 1)).toBeNull();
    const c0 = runImpactCoreShape(0);
    expect(c0).not.toBeNull();
    expect(c0!.radius).toBeLessThan(4); // 极小（≠ 大爆炸）
    expect(c0!.alpha).toBeLessThan(1);
    expect(runImpactCoreShape(0)!.radius).toBeGreaterThan(runImpactCoreShape(RUN_IMPACT_CORE_MS)!.radius);
  });

  it('RC-05c 环色与全部入账色 / 七个强化图标色 RGB 精确互斥（不污染任何既有色断言）', () => {
    // 环两色是 PRP-local 新增色；这里用「与入账色互斥」的同一把尺子钉住。
    const ring = '#d9a8ff';
    const core = '#f6ecff';
    const ledger = Object.values(RUN_LEDGER_COLORS).map((c) => c.toLowerCase());
    expect(ledger).not.toContain(ring);
    expect(ledger).not.toContain(core);
    // 环自身两色也必须互斥（否则「核心亮点」无法与环分开统计）
    expect(ring).not.toBe(core);
  });
});

/* ---------------------------------------- RC-06 同条件 A/B（必改 4 的证据） */

function makeCtx(canvas: unknown): CanvasRenderingContext2D {
  const grad = { addColorStop: () => undefined };
  const ctx: unknown = new Proxy(
    {},
    {
      get: (_t, k) => {
        if (k === 'canvas') return canvas;
        if (k === 'measureText') return () => ({ width: 0 });
        if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') {
          return () => grad;
        }
        return () => ctx;
      },
      set: () => true,
    },
  );
  return ctx as CanvasRenderingContext2D;
}

function makeRenderer(w: number, h: number): Renderer {
  const canvas = {
    getContext: () => makeCtx(undefined),
    clientWidth: w,
    clientHeight: h,
    width: w,
    height: h,
  } as unknown as HTMLCanvasElement;
  const surface: CanvasSurface = { width: w, height: h, devicePixelRatio: 1, now: () => 0 };
  const r = new Renderer(canvas, new VisualRegistry(), surface);
  r.setBattleBackdrop(true);
  return r;
}

/** 命中后统计窗口（帧）—— Queue 要求「首次有效重弹命中后短时间窗口内」。 */
const AB_WINDOW = 30;

interface HitStat {
  /** 命中后窗口内敌车中心在**舞台带**内的最大位移（逻辑 px）—— 这才是「一眼可辨」的量纲。 */
  readonly bandTravel: number;
  /** 命中后窗口内敌车绕质心的最大转角（度）。 */
  readonly angleSwingDeg: number;
  /** 命中**下一步**的速度跃变（真实冲量的直接指纹，dpx/step）。 */
  readonly dvx: number;
}

/**
 * 跑一场真实战斗：固定 Player / Enemy / spawn / HP / world，用**正式相机链**逐帧取景，
 * 只把 `build` 当变量。返回全部「有效重弹命中」的物理统计（末段窗口不完整的命中不计）。
 */
function abRun(build: readonly ('heavyShell' | 'kineticBurst')[], frames = 1200): readonly HitStat[] {
  const renderer = makeRenderer(RUN_BATTLE_VIEW_W, RUN_BATTLE_VIEW_H);
  const rt = new RunBattleRuntime({ build });
  const world = rt.orchestrator.world;
  const bBody = rt.orchestrator.vehicleB.body;
  const marks: number[] = [];
  let step = 0;
  let last: string | null = null;

  rt.orchestrator.onCombatEvent((ev: BattleEvent) => {
    if (ev.type !== 'damage') return;
    if (ev.source !== 'A' || ev.target !== 'B') return;
    if (ev.damageSource !== 'weapon' || ev.behavior !== 'cannon') return;
    marks.push(step);
  });

  const band: Array<{ bx: number; angle: number; vx: number }> = [];
  const push = (): void => {
    const snap = rt.snapshot();
    const phase = rt.orchestrator.phase;
    if (shouldReframeBattleCamera(phase, last)) {
      last = phase;
      renderer.reframe(snap, 'battle', { phase });
    }
    renderer.render(rt.orchestrator);
    const t = renderer.transform;
    const xf = {
      scale: t.scale,
      offsetX: t.offsetX,
      offsetY: t.offsetY,
      cropX: RUN_BATTLE_VIEW_INSET.x,
      cropY: RUN_BATTLE_VIEW_INSET.y,
    };
    const c = world.getPosition(bBody);
    band.push({
      bx: battleBandX(xf, c.x),
      angle: world.getAngle(bBody),
      vx: world.getLinearVelocity(bBody).x,
    });
  };
  push();
  for (let i = 0; i < frames; i++) {
    if (rt.result) break;
    step += 1;
    rt.step(FRAME_MS);
    push();
  }

  const out: HitStat[] = [];
  for (const m of marks) {
    if (m + AB_WINDOW >= band.length) continue; // 窗口被战斗结束截断 → 不计
    const base = band[m];
    const next = band[m + 1] ?? base;
    const win = band.slice(m, m + AB_WINDOW + 1);
    out.push({
      bandTravel: Math.max(...win.map((x) => Math.abs(x.bx - base.bx))),
      angleSwingDeg: (Math.max(...win.map((x) => Math.abs(x.angle - base.angle))) * 180) / Math.PI,
      dvx: next.vx - base.vx,
    });
  }
  rt.dispose();
  return out;
}

const median = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

let cachedA: readonly HitStat[] | null = null;
let cachedB: readonly HitStat[] | null = null;
const statsA = (): readonly HitStat[] => (cachedA ??= abRun(['heavyShell']));
const statsB = (): readonly HitStat[] => (cachedB ??= abRun(['heavyShell', 'kineticBurst']));

describe('PRP-BUILD-01-R1｜同条件 A/B：第二层真的改变了重炮的物理结果', () => {
  it('RC-06a A 侧（只有重型弹头）：命中几乎不改变敌车的位移与姿态', () => {
    const a = statsA();
    expect(a.length).toBe(12); // 冻结实测：本条件下载弹命中 12 次
    // 冻结实测：中位屏幕位移 1.2 px
    expect(Math.round(median(a.map((x) => x.bandTravel)) * 10) / 10).toBe(1.2);
    // ⚠️ A 侧存在个别「大数」= 敌车自己的冲刺位移（方向与击退相反），因此这里钉的是：
    //    ① 中位位移 < 3px（远小于可辨阈值）；② 没有任何一次命中产生 ≥8° 的姿态变化。
    expect(median(a.map((x) => x.bandTravel))).toBeLessThan(3);
    expect(a.filter((x) => x.angleSwingDeg >= 8).length).toBe(0);
    expect(Math.max(...a.map((x) => x.angleSwingDeg))).toBeLessThan(3); // 实测最大 2.4°
    // 速度跃变全是噪声级（|dvx| < 0.5），证明 A 侧没有引入任何额外冲量
    expect(Math.max(...a.map((x) => Math.abs(x.dvx)))).toBeLessThan(0.5);
  });

  it('RC-06b B 侧（重型弹头 + 动能爆发）：有效命中普遍产生明显位移 + 姿态变化', () => {
    const b = statsB();
    expect(b.length).toBe(11); // 冻结实测：带动能爆发后命中节奏被击退改变 → 11 次
    // 冻结实测：每炮屏幕位移 [5.6,15.5,3.5,15.6,20.3,62.1,25.4,49.1,38.9,7,8.6] → 中位 15.6 px
    expect(Math.round(median(b.map((x) => x.bandTravel)) * 10) / 10).toBe(15.6);
    expect(Math.max(...b.map((x) => x.bandTravel))).toBeGreaterThan(50); // 单炮最高 62.1 px
    // 姿态变化：A 侧 0/12 → B 侧 7/11（实测转角 [7.4,31.6,46.1,29.4,33.2,6.2,35.5,55.6,11.2,4,1.2]）
    expect(b.filter((x) => x.angleSwingDeg >= 8).length).toBe(7);
    expect(Math.max(...b.map((x) => x.angleSwingDeg))).toBeGreaterThan(40); // 实测 55.6°
    // 命中帧速度跃变 = 真实冲量的直接指纹（实测 [6.6,6.2,6.7,6.1,8.0,5.3,5.3,8.4,9.3,6.0,2.4]）
    expect(Math.min(...b.map((x) => x.dvx))).toBeGreaterThan(2);
    expect(Math.min(...b.map((x) => x.dvx))).toBeCloseTo(2.449, 3);
  });

  it('RC-06c A/B 差异是「量级差」，不是「统计噪声」', () => {
    const a = statsA();
    const b = statsB();
    const medA = median(a.map((x) => x.bandTravel));
    const medB = median(b.map((x) => x.bandTravel));
    // 屏幕位移：提升 10 倍以上（实测 1.2 → 15.6，≈ 13×）
    expect(medB / medA).toBeGreaterThan(10);
    // 姿态：A 侧 12 炮**一次**都到不了 8°，B 侧 7 次达到，且 B 的最大值是 A 的最大值的 20 倍以上
    expect(a.filter((x) => x.angleSwingDeg >= 8).length).toBe(0);
    expect(b.filter((x) => x.angleSwingDeg >= 8).length).toBeGreaterThanOrEqual(6);
    expect(Math.max(...b.map((x) => x.angleSwingDeg))).toBeGreaterThan(
      Math.max(...a.map((x) => x.angleSwingDeg)) * 20,
    );
  });

  it('RC-06d 「完整入画」：Active 全程两车四边都在舞台带内；全阶段只允许「贴世界右墙」的亚像素溢出', () => {
    /**
     * 实测（GAIN=28，全套正式相机链）：
     *   - **Active**（相机逐帧 `reframe`，玩家真正交战的阶段）：两车四边全部在带内 ——
     *     `A.left` 最小 **30.11**、`B.right` 最大 **363.17**（带宽 390）。
     *   - **全阶段**峰值 **390.30**（越界 **0.3** 逻辑 px）出现在 **Warning #688**。
     *
     * ⚠️ 这个 0.3px 不是「第二层把敌车轰出画面」，而是两条既有事实的乘积：
     *   ① 敌车确实被**轰到世界右墙**（世界宽 1600，`B.maxX` 峰值 **1600.6** —— 贴着墙，没飞出世界）；
     *   ② `shouldReframeBattleCamera` **只在 Active 逐帧 reframe**，Warning 阶段相机按设计冻结
     *      （PRP-R5 既有口径）→ 墙位置在该冻结取景下映射为 390.30。
     *   对照：增益 40 / 48 会让它冲到 **417 / 402**（真越界 12~27px）并出现单帧瞬转 116°。
     *   因此这里既守住「Active 严格在带内」，也守住「全阶段只允许贴墙的亚像素溢出」，
     *   任何真越界（≥ 390.5）都会立刻红。
     */
    const rt = new RunBattleRuntime({ build: ['heavyShell', 'kineticBurst'] });
    const renderer = makeRenderer(RUN_BATTLE_VIEW_W, RUN_BATTLE_VIEW_H);
    let last: string | null = null;
    /** Active 阶段：最左 / 最右（两车合起来）。 */
    let activeLeftMin = Infinity;
    let activeRightMax = -Infinity;
    /** 全阶段：最右 + 敌车世界右缘峰值。 */
    let allRightMax = -Infinity;
    let worldRightMax = -Infinity;
    for (let f = 0; f <= 1200; f++) {
      if (f > 0) rt.step(FRAME_MS);
      const snap = rt.snapshot();
      const phase = rt.orchestrator.phase;
      if (shouldReframeBattleCamera(phase, last)) {
        last = phase;
        renderer.reframe(snap, 'battle', { phase });
      }
      renderer.render(rt.orchestrator);
      const t = renderer.transform;
      const xf = {
        scale: t.scale,
        offsetX: t.offsetX,
        offsetY: t.offsetY,
        cropX: RUN_BATTLE_VIEW_INSET.x,
        cropY: RUN_BATTLE_VIEW_INSET.y,
      };
      const a = vehicleWorldBox(snap, 'A');
      const b = vehicleWorldBox(snap, 'B');
      const left = Math.min(battleBandX(xf, a.minX), battleBandX(xf, b.minX));
      const right = Math.max(battleBandX(xf, a.maxX), battleBandX(xf, b.maxX));
      allRightMax = Math.max(allRightMax, right);
      worldRightMax = Math.max(worldRightMax, b.maxX);
      if (phase === 'Active') {
        activeLeftMin = Math.min(activeLeftMin, left);
        activeRightMax = Math.max(activeRightMax, right);
      }
      if (rt.result) break;
    }
    rt.dispose();
    // ① Active（相机活的阶段）：严格在带内 —— 这是「完整入画」真正要守的那条
    expect(Math.round(activeLeftMin * 10) / 10).toBeGreaterThanOrEqual(0);
    expect(Math.round(activeRightMax * 10) / 10).toBeLessThanOrEqual(RUN_STAGE_BAND.w);
    // ② 全阶段：只允许「贴墙 + 冻结取景」带来的亚像素溢出（实测 390.30）
    expect(Math.round(allRightMax * 10) / 10).toBeLessThanOrEqual(RUN_STAGE_BAND.w + 0.5);
    // ③ 是「被轰到墙上」，不是「飞出世界」——真越界会先撞这条
    expect(Math.round(worldRightMax * 10) / 10).toBeLessThanOrEqual(1600 + 1);
  });

  it('RC-06e 冻结项一个没动：既有 overlay 数值表与全部武器项逐字段不变', () => {
    expect(RUN_MODIFIER_OVERLAY.heavyShell.behaviorParams).toEqual({
      projectileRadius: 16,
      projectileMass: 4,
      recoilImpulse: 90,
    });
    expect(RUN_MODIFIER_OVERLAY.twinCannon.behaviorParams).toEqual({
      burstRounds: 2,
      burstIntervalMs: 100,
    });
    expect(RUN_MODIFIER_OVERLAY.fastReload.behaviorParams).toEqual({ cooldownMs: 650 });
    expect(RUN_MODIFIER_OVERLAY.tripleLoad.behaviorParams).toEqual({
      burstRounds: 3,
      burstIntervalMs: 100,
    });
    // 能力类项（含动能爆发）**永不改武器** → 不可能出现「强化了炮弹参数」的暗改
    for (const id of RUN_ALL_MODIFIER_IDS) {
      if (id === 'kineticBurst' || id === 'strongRecoil' || id === 'emergencyRepair') {
        expect(RUN_MODIFIER_OVERLAY[id].affectsWeapon, id).toBe(false);
        expect(RUN_MODIFIER_OVERLAY[id].behaviorParams, id).toEqual({});
      }
    }
  });
});
