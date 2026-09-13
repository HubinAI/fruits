/**
 * PBL-G1-A-B-COMPARISON-GATE｜A/B 对照门禁（纯逻辑：无 DOM / 无 Canvas / 无 fs / 无副作用）。
 *
 * 目的（Queue 必改 1/2/3）：让「A / B 两边除空间模型与必要 Movement / Physics Adapter
 * 之外没有隐藏参数差异」成为**可执行的断言**，而不是口头声明。三件事：
 *
 *   1) 对照审计 `auditSharedCombatData()`：
 *      Body / HP / 质量 / 能量 / Weapon 伤害 / CD / 弹丸基础配置，全部用**正式链路独立重算**
 *      （`buildSnapshotFromDraft` → `validateSnapshot` → `resolveSnapshot` → 正式 def 的
 *      `behaviorParams`）后与 `SpawnPlan` 里的值逐字段比对。计划里任何被就地改写过的
 *      战斗数值都会在这里暴露 —— 这是「不存在 Arena 专属平衡覆盖」的机器可查证据。
 *
 *   2) 允许差异注册表 `PBL_ALLOWED_ARENA_DIFFERENCES`：
 *      A/B 之间的差异**只允许**是 arena-geometry / physics-interpretation / movement-adapter
 *      三类，且每类都登记「落点文件 + 落点符号」。集中、可枚举、可做防腐烂校验
 *      （声明的符号若消失 → 门禁失败，而不是悄悄放宽）。
 *
 *   3) 快速验证顺序 `PBL_GATE_SEQUENCE` + 零残留判据 `gateResidue()`：
 *      6 步顺序逐字取自 Queue；每步的**可用性由「该 Arena 是否已落地运行时」派生**
 *      （`PBL_ARENA_RUNTIMES`），绝不写死布尔、也绝不把占位舞台当真实对照跑。
 *
 * ⚠️ 诚实边界（必须读）：
 *   `PBL_ARENA_RUNTIMES` 目前**只有 A**。Arena B 的运行时不存在 —— PBL-B1 已按其
 *   「停止条件」终止（390 宽竖屏可活动区 366px < 1v1 车体总宽 410–498px）。
 *   因此本门禁对 B 步骤返回 `blocked`，Lab 不会 Start、也不产生任何「B 的真实表现」数据。
 *   门禁的整体结论在这种状态下是 **blocked 而非 pass** —— 这是设计要求，不是缺陷。
 *
 * 删除本文件即移除门禁；本目录可整块删除（清单见 constants.ts 头部）。
 */
import { registry } from '../../core/content';
import { buildSnapshotFromDraft, type BuildDraft } from '../buildEditorModel';
import { resolveSnapshot } from '../../core/buildSnapshot';
import { validateSnapshot } from '../../core/buildValidator';
import {
  buildSpawnPlan,
  combatProfileOf,
  type SpawnPlan,
  type SpawnedEntity,
} from './entities';
import { LAB_ENCOUNTERS, LAB_LOADOUTS } from './testData';
import type { LabArenaId, LabEncounterId, LabLoadoutId } from './constants';

/* ============================================================ 1) 允许差异 */

/** A/B 之间**唯一允许**的差异类别（Queue 必改 1 的三条白名单）。 */
export type ArenaDifferenceKind =
  /** 空间几何：场地尺寸 / 边界 / 出生位。 */
  | 'arena-geometry'
  /** 物理解释：重力方向与大小、边界反弹等场地物理常量（质量/惯量/冲量/弹丸仍共用）。 */
  | 'physics-interpretation'
  /** 移动适配：把同一份共享 Build 映射为该空间下的驱动力（俯视冲量 / 侧视轮地）。 */
  | 'movement-adapter';

export interface AllowedArenaDifference {
  readonly id: string;
  readonly kind: ArenaDifferenceKind;
  /** 该差异作用在哪些 Arena。 */
  readonly arenas: readonly LabArenaId[];
  /** 该差异在 Lab 内的**落点文件**（文件级白名单，防扩散）。 */
  readonly files: readonly string[];
  /** 该差异在代码里的**可枚举符号**；声明即校验（符号消失 → 门禁失败）。 */
  readonly symbols: readonly string[];
  readonly note: string;
}

/**
 * 允许差异清单（中央登记；`auditAllowedDifferences()` 会逐条校验符号确实存在）。
 * 除这三类之外，A/B 的任何差异都应视为「隐藏参数差异」——门禁失败。
 */
export const PBL_ALLOWED_ARENA_DIFFERENCES: readonly AllowedArenaDifference[] = [
  {
    id: 'arena-geometry',
    kind: 'arena-geometry',
    arenas: ['A', 'B'],
    files: ['arenaA.ts', 'layout.ts', 'arenaScene.ts', 'scene.ts'],
    symbols: [
      'ARENA_A_BOUNDS',
      'ARENA_A_WALL_THICKNESS',
      'ARENA_A_HUD_CLEARANCE',
      'arenaAWallRects',
      'arenaAPlayerSpawn',
      'arenaAEnemySpawns',
      'arenaMarkers',
    ],
    note:
      '空间几何：Arena A = 四边实体边界 + 我方下方 / 敌方上方纵向出生位；' +
      'Arena B（未实现）规划为底部平地 + 左右实体边界。共享内容库的车辆尺寸不参与。',
  },
  {
    id: 'physics-interpretation',
    kind: 'physics-interpretation',
    arenas: ['A', 'B'],
    files: ['arenaA.ts'],
    symbols: ['ARENA_A_GRAVITY', 'ARENA_A_WALL_RESTITUTION'],
    note:
      '物理解释：A = 俯视零重力 {0,0} + 低反弹边界；B（未实现）规划为侧视重力 + 轮地接触。' +
      '质量 / 惯量 / 冲量 / 后坐 / 碰撞 / 弹丸一律共用，不在本类差异内。',
  },
  {
    id: 'movement-adapter',
    kind: 'movement-adapter',
    arenas: ['A'],
    files: ['arenaA.ts'],
    symbols: ['driveTopdownVehicle', 'TOPDOWN_DRIVE', 'TOPDOWN_ANTI_WEDGE'],
    note:
      '移动适配：A 需要 Lab-local 俯视驱动（沿真实前向的真实线性冲量 + COM 前后等大反向力偶），' +
      '因为正式 `drivePlanckVehicle` 的电机开关依赖 wheel-ground `grounded`；' +
      'B（若实现）可直接复用正式侧视驱动，**无需**任何适配 —— 故本类只作用于 A。',
  },
];

/** 允许差异里声明的全部落点文件（去重）。 */
export function allowedDifferenceFiles(): string[] {
  const s = new Set<string>();
  for (const d of PBL_ALLOWED_ARENA_DIFFERENCES) for (const f of d.files) s.add(f);
  return [...s].sort();
}

/* ================================================== 2) Arena 运行时可用性 */

export type ArenaRuntimeKind = 'topdown-planck' | 'sideview-planck';

/**
 * 已落地的 Arena 运行时 —— 门禁可用性的**唯一来源**。
 * 若某 Arena 不在此表内，门禁一律判 `blocked`（绝不把占位舞台当真实对照）。
 */
export const PBL_ARENA_RUNTIMES: Partial<
  Record<LabArenaId, { readonly kind: ArenaRuntimeKind; readonly file: string }>
> = {
  A: { kind: 'topdown-planck', file: 'arenaA.ts' },
};

/** 未落地 Arena 的阻塞原因（如实报告，可被 UI / E2E 直接读取）。 */
export const PBL_BLOCKED_ARENAS: Partial<Record<LabArenaId, string>> = {
  B:
    'Arena B 运行时未实现 —— PBL-B1 已按其「停止条件」终止：' +
    '390 宽竖屏可活动区仅 366px，而 1v1 车体真实外接框总宽 410–498px（缺口 44–132px），' +
    '两车几何上放不下，且出路（缩车 / 缩放镜头 / 加地形）均为该 Queue 明文禁止。' +
    '本 Lab 的 Arena B 只是 PBL-F1 占位舞台，不是物理对照。见 交接文档_2026-09-12_PBL-B1-STOP.md。',
};

export function arenaRuntimeAvailable(arena: LabArenaId): boolean {
  return PBL_ARENA_RUNTIMES[arena] !== undefined;
}

/** 全部 Arena 的可用性快照（供 UI / E2E 使用）。 */
export function arenaAvailability(): Record<string, boolean> {
  return { A: arenaRuntimeAvailable('A'), B: arenaRuntimeAvailable('B') };
}

/* ==================================================== 3) 快速验证顺序 */

export interface GateSequenceStep {
  /** 1-based 步号（与 Queue 清单一致）。 */
  readonly index: number;
  readonly arena: LabArenaId;
  readonly loadout: LabLoadoutId;
  readonly encounter: LabEncounterId;
  /** 本步中「Queue 原文未写明、由本实现补充假设」的字段（必须显式暴露，不许静默补）。 */
  readonly assumed: readonly string[];
}

/** 顺序说明（在 Lab 面板与报告中原样展示，便于操作者核对）。 */
export const PBL_GATE_SEQUENCE_NOTES: readonly string[] = [
  '步骤顺序逐字取自 Queue「必改 2」的 6 步清单，不增删、不重排。',
  '第 5 / 6 步 Queue 原文只写「A / B + LightSwarm3」，未指定 Loadout → ' +
    '沿用上一行（第 3 / 4 步）的「香蕉冲锋锤」，并在 assumed 字段显式标注为假设。',
  'Arena B 步骤当前一律 blocked（运行时不存在），门禁不会替它伪造数据。',
];

/**
 * 快速验证顺序（Queue 必改 2，6 步，逐字对齐）。
 * 与 Arena 是否已实现无关 —— 可用性由 `gateStepPlan()` 依据运行时表派生。
 */
export const PBL_GATE_SEQUENCE: readonly GateSequenceStep[] = [
  { index: 1, arena: 'A', loadout: 'WatermelonHeavyCannon', encounter: 'Chaser', assumed: [] },
  { index: 2, arena: 'B', loadout: 'WatermelonHeavyCannon', encounter: 'Chaser', assumed: [] },
  { index: 3, arena: 'A', loadout: 'BananaChargeHammer', encounter: 'RangedTurret', assumed: [] },
  { index: 4, arena: 'B', loadout: 'BananaChargeHammer', encounter: 'RangedTurret', assumed: [] },
  { index: 5, arena: 'A', loadout: 'BananaChargeHammer', encounter: 'LightSwarm3', assumed: ['Loadout'] },
  { index: 6, arena: 'B', loadout: 'BananaChargeHammer', encounter: 'LightSwarm3', assumed: ['Loadout'] },
];

export type GatePlannedStatus = 'ready' | 'blocked';

export interface GateStepPlan {
  readonly step: GateSequenceStep;
  readonly status: GatePlannedStatus;
  readonly reason: string;
  /** blocked → null（不伪造一份「可运行的 B 战斗」）。 */
  readonly plan: SpawnPlan | null;
}

/** 某一步在当前实现状态下是否真的能跑（由运行时表派生，不是写死布尔）。 */
export function gateStepPlan(step: GateSequenceStep): GateStepPlan {
  if (!arenaRuntimeAvailable(step.arena)) {
    return {
      step,
      status: 'blocked',
      reason: PBL_BLOCKED_ARENAS[step.arena] ?? `Arena ${step.arena} 无运行时`,
      plan: null,
    };
  }
  return {
    step,
    status: 'ready',
    reason: '',
    plan: buildSpawnPlan(step.loadout, step.encounter),
  };
}

/* ====================================================== 4) 共享配置审计 */

/** 单实体审计结果：把计划里的值 vs 正式链路独立重算的值逐字段比对。 */
export interface SharedEntityAudit {
  readonly entityId: string;
  /** 该实体的来源（Test Loadout / 正式对手模板 id）。 */
  readonly source: string;
  readonly mismatches: readonly string[];
}

export interface SharedComboAudit {
  readonly key: string;
  readonly loadout: LabLoadoutId;
  readonly encounter: LabEncounterId;
  readonly entityCount: number;
  /** 共享基础数据指纹（只由 loadout|encounter 决定；与 arena / team / 序号无关）。 */
  readonly baseKey: string;
  readonly entities: readonly SharedEntityAudit[];
  readonly mismatches: readonly string[];
}

export interface SharedCombatDataAudit {
  readonly ok: boolean;
  readonly combos: readonly SharedComboAudit[];
  readonly problems: readonly string[];
  readonly allowedDifferences: readonly AllowedArenaDifference[];
  readonly arenaAvailable: Record<string, boolean>;
}

function movementSig(m: {
  readonly hardpointId: string;
  readonly defId: string;
  readonly radius: number;
  readonly mass: number;
  readonly energy: number;
}): readonly unknown[] {
  return [m.hardpointId, m.defId, m.radius, m.mass, m.energy];
}

function functionalSig(f: {
  readonly hardpointId: string;
  readonly defId: string;
  readonly mass: number;
  readonly energy: number;
  readonly behavior: string;
}): readonly unknown[] {
  return [f.hardpointId, f.defId, f.mass, f.energy, f.behavior];
}

/**
 * 审计一个实体：**只用** (draft + 正式 registry) 独立重算，再与 SpawnPlan 里的值比对。
 * 任何「解析后被就地覆盖」的战斗数值都会在此暴露。
 */
function auditEntity(
  entity: SpawnedEntity,
  draft: BuildDraft,
  source: string,
  prefix: string,
): SharedEntityAudit {
  const mismatches: string[] = [];
  const eq = (label: string, planned: unknown, derived: unknown): void => {
    if (JSON.stringify(planned) !== JSON.stringify(derived)) {
      mismatches.push(`${label}: 计划=${JSON.stringify(planned)} 正式重算=${JSON.stringify(derived)}`);
    }
  };

  // 用一个**独立 id** 重新走一遍正式链路（不改动计划里的 snapshot）
  const snapshot = buildSnapshotFromDraft(draft, registry, `${prefix}-${entity.entityId}`);
  const validation = validateSnapshot(snapshot, registry);
  if (!validation.valid) {
    mismatches.push(`正式 Build 校验失败：${validation.errors.join('；')}`);
  }
  const resolved = resolveSnapshot(snapshot, registry);

  eq('body', entity.bodyDefId, resolved.body.id);
  eq('hp', entity.hp, resolved.body.hp);
  eq('energyCapacity', entity.energyCapacity, resolved.body.energyCapacity);
  eq('bodyMass', entity.bodyMass, resolved.body.baseMass);
  eq('totalMass', entity.totalMass, resolved.totalMass);
  eq(
    'totalEnergy',
    entity.totalEnergy,
    resolved.totalEnergy + resolved.movements.reduce((s, m) => s + m.def.energy, 0),
  );
  eq('drive', entity.drive, draft.drive === 'stationary' ? 'stationary' : 'forward');
  eq(
    'movements',
    entity.movements.map(movementSig),
    resolved.movements.map((m) =>
      movementSig({
        hardpointId: m.install.hardpointId,
        defId: m.def.id,
        radius: m.def.radius,
        mass: m.def.mass,
        energy: m.def.energy,
      }),
    ),
  );
  eq(
    'functionals',
    entity.functionals.map(functionalSig),
    resolved.functionals.map((f) =>
      functionalSig({
        hardpointId: f.install.hardpointId,
        defId: f.def.id,
        mass: f.def.mass,
        energy: f.def.energy,
        behavior: f.def.behavior,
      }),
    ),
  );

  // 独立于 SpawnPlan：直接从正式 def 重算 Weapon 伤害 / CD / 弹丸基础配置
  for (const f of entity.functionals) {
    const def = registry.functionals.get(f.defId);
    if (!def) {
      mismatches.push(`${f.defId}: 正式内容库无此功能件`);
      continue;
    }
    const formal = combatProfileOf(def);
    eq(`${f.defId}.category`, f.profile.category, formal.category);
    eq(`${f.defId}.behavior`, f.profile.behavior, formal.behavior);
    eq(`${f.defId}.contactDamage`, f.profile.contactDamage, formal.contactDamage);
    eq(`${f.defId}.projectileDamage`, f.profile.projectileDamage, formal.projectileDamage);
    eq(`${f.defId}.cooldownMs`, f.profile.cooldownMs, formal.cooldownMs);
    eq(
      `${f.defId}.projectile`,
      f.profile.projectile,
      formal.projectile,
    );
  }

  return { entityId: entity.entityId, source, mismatches };
}

/**
 * 审计**一份** SpawnPlan：逐实体用正式链路独立重算并比对。
 *
 * 单独导出是为了让门禁自身可被反向验证 —— 测试会喂一份「被就地改写过的计划」
 * 进来，必须报出 mismatch（证明本审计不是空转）。
 */
export function auditSpawnPlan(plan: SpawnPlan): {
  readonly entities: readonly SharedEntityAudit[];
  readonly mismatches: readonly string[];
} {
  const loadout = LAB_LOADOUTS.find((l) => l.id === plan.loadoutId);
  const encounter = LAB_ENCOUNTERS.find((e) => e.id === plan.encounterId);
  if (!loadout || !encounter) {
    return { entities: [], mismatches: [`计划引用了目录外的 Loadout / Encounter：${plan.loadoutId}/${plan.encounterId}`] };
  }

  const entities = plan.entities.map((e) => {
    const isPlayer = e.team === 'player';
    const draft = isPlayer ? loadout.draft : encounter.draft;
    const source = isPlayer ? `Loadout:${loadout.id}` : `Encounter:${encounter.templateId}`;
    return auditEntity(e, draft, source, `gate/${loadout.id}/${encounter.id}`);
  });

  const mismatches: string[] = [];
  for (const e of entities) {
    for (const m of e.mismatches) mismatches.push(`${e.entityId}（${e.source}）${m}`);
  }

  // 同场敌人必须同源同值（LightSwarm3 = 同一正式模板复制 N 份，数值零改动）
  const enemyKeys = new Set(
    plan.enemies.map((e) => JSON.stringify([e.bodyDefId, e.hp, e.totalMass, e.functionals.length])),
  );
  if (enemyKeys.size !== 1) mismatches.push(`同场敌人不同源：${[...enemyKeys].join(' | ')}`);
  if (plan.enemies.length !== encounter.count) {
    mismatches.push(`敌人数 ${plan.enemies.length} ≠ Encounter 声明 ${encounter.count}`);
  }
  return { entities, mismatches };
}

/**
 * 全组合共享配置审计：2 Test Loadout × 4 Encounter = 8 个组合。
 * 判定「共享配置完全共享 + 无 Arena 专属平衡覆盖」。
 */
export function auditSharedCombatData(): SharedCombatDataAudit {
  const combos: SharedComboAudit[] = [];
  const problems: string[] = [];

  for (const loadout of LAB_LOADOUTS) {
    for (const encounter of LAB_ENCOUNTERS) {
      const key = `${loadout.id}/${encounter.id}`;
      const plan = buildSpawnPlan(loadout.id, encounter.id);
      const { entities, mismatches: perEntity } = auditSpawnPlan(plan);
      const mismatches = [...perEntity];

      // 指纹确定性：同一 (loadout, encounter) 两次构造必须完全一致 —— A/B 共用的依据
      const again = buildSpawnPlan(loadout.id, encounter.id);
      if (again.baseKey !== plan.baseKey) {
        mismatches.push(`baseKey 非确定性：${plan.baseKey} ≠ ${again.baseKey}`);
      }

      if (mismatches.length > 0) problems.push(`${key}：${mismatches.join('；')}`);
      combos.push({
        key,
        loadout: loadout.id,
        encounter: encounter.id,
        entityCount: plan.entities.length,
        baseKey: plan.baseKey,
        entities,
        mismatches,
      });
    }
  }

  // A/B 对照的前提：同一个 Encounter 的敌人基础数据不随 Loadout 变化
  for (const encounter of LAB_ENCOUNTERS) {
    const sigs = new Set(
      combos
        .filter((c) => c.encounter === encounter.id)
        .map((c) => {
          const plan = buildSpawnPlan(c.loadout, encounter.id);
          return JSON.stringify(plan.enemies.map((e) => [e.bodyDefId, e.hp, e.totalMass]));
        }),
    );
    if (sigs.size !== 1) problems.push(`Encounter ${encounter.id} 的敌人基础数据随 Loadout 变化（应完全独立）`);
  }

  return {
    ok: problems.length === 0,
    combos,
    problems,
    allowedDifferences: PBL_ALLOWED_ARENA_DIFFERENCES,
    arenaAvailable: arenaAvailability(),
  };
}

/* ================================================ 5) 切场 / Reset 零残留 */

/**
 * 切场 / Reset 后必须为零的**可观测**运行期状态（Queue 必改 3）。
 * HP / 车身 / 接触状态 / AI / 移动状态 / arena 状态 / 敌人实例全部活在被释放的
 * 运行时对象内，其「已释放」的可观测代理就是这批计数归零 + 运行时不再 live。
 */
export interface GateResidueObservable {
  readonly phase: string;
  readonly liveEntities: number;
  readonly liveProjectiles: number;
  readonly arenaA: {
    readonly live: boolean;
    readonly steps: number;
    readonly shotsFired: number;
    readonly hits: number;
  } | null;
}

/** 返回残留项列表；空数组 = 彻底清理干净。 */
export function gateResidue(o: GateResidueObservable): string[] {
  const out: string[] = [];
  if (o.phase !== 'idle') out.push(`phase=${o.phase}（应为 idle）`);
  if (o.liveEntities !== 0) out.push(`实体残留 ${o.liveEntities}`);
  if (o.liveProjectiles !== 0) out.push(`弹丸残留 ${o.liveProjectiles}`);
  if (o.arenaA) {
    if (o.arenaA.live) out.push('Arena A 真实运行时仍存活（未 dispose）');
    if (o.arenaA.steps !== 0) out.push(`物理步进残留 ${o.arenaA.steps}`);
    if (o.arenaA.shotsFired !== 0) out.push(`开火计数残留 ${o.arenaA.shotsFired}`);
    if (o.arenaA.hits !== 0) out.push(`命中计数残留 ${o.arenaA.hits}`);
  }
  return out;
}

/* ================================================================ 6) 汇总 */

/** 门禁总体结论：只有全部步骤都真的跑通才可能 pass；有 blocked → 整体 blocked。 */
export type GateVerdict = 'pass' | 'blocked' | 'fail';

export interface GateSummary {
  readonly verdict: GateVerdict;
  readonly auditOk: boolean;
  readonly readySteps: number;
  readonly blockedSteps: number;
  readonly problems: readonly string[];
}

export function gateSummary(
  auditOk: boolean,
  stepStatuses: readonly GatePlannedStatus[],
): GateSummary {
  const readySteps = stepStatuses.filter((s) => s === 'ready').length;
  const blockedSteps = stepStatuses.filter((s) => s === 'blocked').length;
  const problems: string[] = [];
  if (!auditOk) problems.push('共享配置审计未通过');
  if (blockedSteps > 0) problems.push(`${blockedSteps} 个步骤因 Arena 运行时未实现而 blocked`);
  const verdict: GateVerdict = !auditOk ? 'fail' : blockedSteps > 0 ? 'blocked' : 'pass';
  return { verdict, auditOk, readySteps, blockedSteps, problems };
}
