/**
 * PRP-F2-FIRST-REAL-UPGRADE-LOOP｜PRP-BUILD-01-TWO-STEP-CANNON-BUILD
 * Run-local 强化 overlay（唯一的 Modifier 接缝）。
 *
 * ## 为什么是这个接缝（PRP-F2 必改 1 的「先查」结论，本 Queue 未变）
 *
 * 正式 Runtime 里**已经有**一条干净的「运行期 override」通路，只是此前只有 Movement 用到了：
 *
 *   `BuildSnapshot` ─ resolveSnapshot(snapshot, registry) ─▶ `ResolvedSnapshot`
 *        └─ functionals[i].defId → registry.functionals.get(defId)
 *                                    └─▶ resolved def（含 behaviorParams）
 *                                          └─▶ `PlanckPartRuntime.def`
 *                                                └─▶ `CannonBehavior` 构造时只读提取
 *
 * 关键事实（file:line 证据）：
 *   - `src/core/buildSnapshot.ts:97`  `resolveSnapshot(snapshot, registry)` —— def 全部经 registry 展开；
 *   - `src/core/buildSnapshot.ts:119` Movement 已有 `applyMovementOverrides(baseDef, install.overrides)`
 *     （`src/core/types.ts:150` `overrides?: Partial<WheelDef>`）→ **override 是正式既有范式**；
 *   - `src/core/types.ts:186` `ContentRegistry = { bodies: Map, movements: Map, functionals: Map }`
 *     —— 三个**可变 Map**；
 *   - `src/core/content.ts:1012` `createRegistry()` **已导出** 且每次返回全新实例；
 *   - `src/battle/cannonBehavior.ts:107` `readCannonParams(part)` 只读 `part.def.behaviorParams`
 *     —— **不读 Content 单例、不读全局状态**；
 *   - `src/battle/behaviorRuntime.ts:72` `new CannonBehavior(ctx.part, ...)` —— part 来自 orchestrator
 *     内部按 resolved def 装配，PRP 无法在 weapon 内部插入逻辑（也不需要）。
 *
 * ⇒ **Run-local overlay registry**：本局用 `createRegistry()` 造一份**独立副本**，在其中新增一个
 *   带强化数值的**本局专用部件 id**，然后把本局 BuildSnapshot 里武器的 `defId` 重映射过去。
 *   正式 `content.ts` 的 Cannon 定义、`registry` 单例、`cannonBehavior` / `ContactRouter` /
 *   `PlanckBattleOrchestrator` **全部零修改**；强化只存在于这一份内存副本里，
 *   页面刷新 / 新开 Run 立刻消失（不落盘、不进 Garage、不改星级）。
 *
 * ## 第一层（PRP-F2 / PRP-F2-R1 / PRP-F2-R2，已真人验收通过并冻结）
 *
 *   | 选项 | 自然因果 | overlay 改了什么 |
 *   |---|---|---|
 *   | A 重型弹头 heavyShell | 炮弹更重 → 推得更狠、自己也退得更狠 | `projectileRadius 10→16` / `projectileMass 1→4` / `recoilImpulse 30→90` |
 *   | B 双联炮 twinCannon | 一次攻击极短间隔连续两发 | `burstRounds 1→2` + `burstIntervalMs 0→100` |
 *   | C 快速装填 fastReload | 开炮节奏变快（1.54× 基础） | `cooldownMs 1000→650` |
 *
 * ⚠️ 这三个数值**本 Queue 一个都不许动**（Queue 冻结项）。
 *
 * ## 第二层（PRP-BUILD-01：条件池 —— 第一层选择决定第二层出现什么）
 *
 * 验证的核心假设：**第一次强化会改变第二次强化的价值与期待**，从而形成 Build，
 * 而不是连续拿两个互不相关的 Buff。第一版不做随机权重，直接固定条件池：
 *
 *   | 第一层 | 强联动 synergy | 安全通用项 safe | 轻度转向项 pivot |
 *   |---|---|---|---|
 *   | 重型弹头 | **动能爆发** kineticBurst | 紧急维修 emergencyRepair | 快速装填 fastReload |
 *   | 双联炮   | **三连装填** tripleLoad   | 紧急维修 emergencyRepair | 重型弹头 heavyShell |
 *   | 快速装填 | **反冲蓄能** recoilCharge | 紧急维修 emergencyRepair | 双联炮 twinCannon |
 *
 * 三种强联动的因果与实现：
 *
 *   - **动能爆发**：炮弹越重 / 撞击越强 → 命中追加越明显的冲击。追加冲量
 *     `= KINETIC_BURST_GAIN × 当前 projectile 质量 × 命中相对速度`——
 *     强度**读自当前 Projectile 的真实质量与真实冲击结果**，没有「重型弹头专属伤害」这种写死值。
 *     实现走正式事件总线（`damage` 事件）+ `world.applyLinearImpulse` 公开接口，零改正式模块。
 *   - **三连装填**：继续复用 PRP-F2-R1 给正式 Cannon 补的**可选 burst 能力**，`burstRounds 2→3`；
 *     `burstIntervalMs` 保持 100ms（第一版不重新调间隔）。三发都是真实 projectile。
 *   - **反冲蓄能**：每 N 次**真实开火**（= 真实 recoil 事件，`weaponFire`）蓄一次能，蓄满给玩家车
 *     一次前向冲量（接敌补偿）。只由 Cannon fire / recoil 事件触发，**没有定时器凭空加速**。
 *
 * ⚠️ 安全性（Queue 必改 4 的「接缝若不存在就停止」判定）：接缝**存在且干净** ——
 *     `PlanckBattleOrchestrator.onCombatEvent`（`planckBattleOrchestrator.ts:413`）是公开订阅口，
 *     `WeaponFireEvent`（`combatEvents.ts:41`，含 `team`/`worldDirection`）与
 *     `DamageEvent`（`combatEvents.ts:36`，含 `source`/`target`/`damageSource`/`behavior`/
 *     `relativeVelocity`）都是正式既有事件；`world.applyLinearImpulse` 亦是公开 API。
 *     因此**不需要**给正式 Movement / recoil 加任何 hook，也没有 PRP 特例进正式模块。
 */

import { createRegistry } from '../../core/content';
import type { BuildSnapshot, ContentRegistry, FunctionalPartDef } from '../../core/types';

/* ------------------------------------------------------------- 标识 */

/** 第一层（Queue 已冻结的三项）。 */
export type Layer1ModifierId = 'heavyShell' | 'twinCannon' | 'fastReload';

/**
 * 第二层（条件池里的项）。
 * `emergencyRepair` 是三个池共用的**安全通用项**（不改武器行为，只在选择时修耐久）。
 */
export type Layer2ModifierId = 'kineticBurst' | 'tripleLoad' | 'recoilCharge' | 'emergencyRepair';

export type RunModifierId = Layer1ModifierId | Layer2ModifierId;

/** 每个强化在池子里扮演的角色（用于测试断言「三选一 = 联动 + 通用 + 转向」）。 */
export type RunModifierRole = 'base' | 'synergy' | 'safe' | 'pivot';

/** overlay 的**基准部件** = 正式 Cannon。本 Queue 不改动它，只以它为基准派生本局变体。 */
export const RUN_BASE_WEAPON_DEF_ID = 'cannon';

export interface RunModifierDef {
  readonly id: RunModifierId;
  readonly label: string;
  /** 一句结果（玩家可读，不是数值表）。 */
  readonly note: string;
  /** 选择后写入冒险日志的自然语言（必改 3）。 */
  readonly logText: string;
  readonly role: RunModifierRole;
}

/** 第一层三选一（固定、不随机、无稀有度、无升级树）—— 也是 `RUN_CHOICE_OPTIONS` 的唯一来源。 */
export const RUN_MODIFIERS: readonly RunModifierDef[] = [
  {
    id: 'heavyShell',
    label: '重型弹头',
    note: '炮弹更重，撞击和后坐都更明显',
    logText: '你为大炮装上了重型弹头。',
    role: 'base',
  },
  {
    id: 'twinCannon',
    label: '双联炮',
    note: '一次开火连续打出两发炮弹',
    logText: '你为大炮加装了一门副炮。',
    role: 'base',
  },
  {
    id: 'fastReload',
    label: '快速装填',
    note: '开炮节奏明显变快',
    logText: '你改进了大炮的装填机构。',
    role: 'base',
  },
];

/** 第二层（条件池）四项。 */
export const RUN_BUILD_MODIFIERS: readonly RunModifierDef[] = [
  {
    id: 'kineticBurst',
    label: '动能爆发',
    note: '重弹命中会把对手整个撞开',
    logText: '你给炮弹装上了动能引信。',
    role: 'synergy',
  },
  {
    id: 'tripleLoad',
    label: '三连装填',
    note: '一次开火连续打出三发炮弹',
    logText: '你把副炮接进了主装填链。',
    role: 'synergy',
  },
  {
    id: 'recoilCharge',
    label: '反冲蓄能',
    note: '开炮的后坐会蓄成向前的推力',
    logText: '你在车尾装上了反冲蓄能器。',
    role: 'synergy',
  },
  {
    id: 'emergencyRepair',
    label: '紧急维修',
    note: '立刻修回一部分车体耐久',
    logText: '你让随车工程师紧急修补了车体。',
    role: 'safe',
  },
];

const ALL_MODIFIERS: readonly RunModifierDef[] = [...RUN_MODIFIERS, ...RUN_BUILD_MODIFIERS];

export function runModifierById(id: string): RunModifierDef | undefined {
  return ALL_MODIFIERS.find((m) => m.id === id);
}

/** 全部强化 id（测试用）。 */
export const RUN_ALL_MODIFIER_IDS: readonly RunModifierId[] = ALL_MODIFIERS.map((m) => m.id);

/* --------------------------------------------------------- 条件池 */

/** 第一层池 = 固定三项。 */
export const RUN_LAYER1_POOL: readonly Layer1ModifierId[] = ['heavyShell', 'twinCannon', 'fastReload'];

/**
 * 第二层条件池：**由第一层选择决定**（必改 1）。
 *
 * 每池固定三项，顺序 = 「强联动 / 安全通用 / 轻度转向」（必改 5 的取舍结构）。
 * 这是第一版的条件池，不做正式随机权重、不做稀有度。
 */
export const RUN_LAYER2_POOLS: Readonly<Record<Layer1ModifierId, readonly RunModifierId[]>> = {
  heavyShell: ['kineticBurst', 'emergencyRepair', 'fastReload'],
  twinCannon: ['tripleLoad', 'emergencyRepair', 'heavyShell'],
  fastReload: ['recoilCharge', 'emergencyRepair', 'twinCannon'],
};

/** 第二层的选项定义（按池顺序，供 UI / 状态机使用）。 */
export function runLayer2PoolDefs(layer1: string): readonly RunModifierDef[] {
  const pool = RUN_LAYER2_POOLS[layer1 as Layer1ModifierId];
  if (!pool) return [];
  return pool.map((id) => runModifierById(id)!);
}

/* ------------------------------------------------------- overlay 数值表 */

/**
 * 单个强化的 overlay：只声明**被强化语义覆盖的那几个字段**，其余字段一律沿用正式 Cannon。
 *
 * `behavior` 字段保留（当前全部仍是正式 `cannon`）—— 留作将来「换武器基座」的扩展点。
 * 「一次攻击打几发」由 Cannon 自己的可选 `burstRounds` 表达，不需要为了多弹丸去换 behavior。
 */
export interface RunModifierOverlay {
  readonly behavior: string;
  readonly behaviorParams: Readonly<Record<string, number | number[]>>;
  /** 人类可读的因果说明（进交接文档与测试断言，不参与运行时）。 */
  readonly cause: string;
  /**
   * 是否**改武器数值**。
   * `false` = 这项强化不改武器（只通过 Run 能力作用于战斗）→ 不参与本局武器 def 的组合。
   */
  readonly affectsWeapon: boolean;
}

/** 不改武器数值的项统一用这个空 overlay（`behavior` 仅作占位，永不参与组合）。 */
const NO_WEAPON_OVERLAY = 'cannon';

/**
 * 冻结的 overlay 数值表。
 *
 * ⚠️ 第一层三项**逐字段冻结**（Queue 冻结项）；第二层只新增 `tripleLoad` 一个武器项。
 * ⚠️ 这里**没有** `muzzleSpeed` / 部件 `mass` / `energy` —— 强化不改变弹道速度，
 *    也不改变车辆装配（总质量 / 能量 / 挂点全部不动）→ 「Base vehicle 冻结」。
 */
export const RUN_MODIFIER_OVERLAY: Readonly<Record<RunModifierId, RunModifierOverlay>> = {
  heavyShell: {
    behavior: 'cannon',
    // 更重的弹头：真实半径（视觉尺寸与碰撞半径同源）+ 真实质量（命中冲量）+ 真实后坐。
    // damage 刻意不动：Queue 要求「不以单纯 Damage +X 作为主要表现」。
    //
    // ⚠️ 这三个数不是随手写的：本场演示遭遇的战**胜负余量极窄**（基础仅多剩 269.78/1100），
    // 实测扫描见 `交接文档_2026-09-12_PRP-F2.md` —— 单独任一项都不翻盘，
    // 但 `r18+m4+rc90` / `r14+m3+rc60` 会把胜负翻成败。这里取「三项都明显且不翻盘」的那组。
    behaviorParams: { projectileRadius: 16, projectileMass: 4, recoilImpulse: 90 },
    cause: '炮弹更重 → 命中推动更明显，同时自身后坐更明显',
    affectsWeapon: true,
  },
  twinCannon: {
    // PRP-F2-R1：正式 Cannon 的**真实连发**（不再借用 shotgun 齐射）。
    // 只声明这两个参数 —— 伤害 / 射速 / 弹速 / 半径 / 质量 / 后坐**全部沿用正式 Cannon**，
    // 因此每发都是完整炮弹；两发弹道同向，靠 100ms 时间差产生「连续两发」的可感知性。
    behavior: 'cannon',
    behaviorParams: { burstRounds: 2, burstIntervalMs: 100 },
    cause: '一次攻击连续打出两发真实炮弹（同向、极短间隔）',
    affectsWeapon: true,
  },
  fastReload: {
    // 只改本局当前 Cannon 的攻击间隔；其它一律不动。
    //
    // PRP-F2-R2 参数回收：`400 → 650`。第一版 400ms（≈2.5× 基础）真人可感知，
    // 但把「远程开火 → 后坐 → 敌方接近 → 碰撞」整段正式物理节奏压缩掉了，
    // 有形成稳定最优解的风险。650ms ≈ **1.54× 基础**，保留可感知的节奏差，
    // 同时让每轮炮击之间重新留出物理运动时间。**只回收这一个数，不做多档扫描。**
    behavior: 'cannon',
    behaviorParams: { cooldownMs: 650 },
    cause: '开炮节奏明显变快',
    affectsWeapon: true,
  },
  tripleLoad: {
    // 必改 3：继续复用现有 Cannon burst Foundation，burstRounds 2 → 3。
    // `burstIntervalMs` 与双联炮**完全相同**（100ms）——「保持当前可读节奏，第一版不重新调间隔」。
    behavior: 'cannon',
    behaviorParams: { burstRounds: 3, burstIntervalMs: 100 },
    cause: '在双联的基础上再连一发：一次攻击连续三发真实炮弹（同间隔）',
    affectsWeapon: true,
  },
  kineticBurst: {
    behavior: NO_WEAPON_OVERLAY,
    behaviorParams: {},
    cause: '命中追加冲量 = GAIN × 当前 projectile 质量 × 命中相对速度（不写死专属伤害）',
    affectsWeapon: false,
  },
  recoilCharge: {
    behavior: NO_WEAPON_OVERLAY,
    behaviorParams: {},
    cause: '每 N 次真实开火（真实 recoil）蓄一次能 → 玩家车前向冲量',
    affectsWeapon: false,
  },
  emergencyRepair: {
    behavior: NO_WEAPON_OVERLAY,
    behaviorParams: {},
    cause: '选择时立刻修回一部分车体耐久（不改武器 / 不改战斗世界）',
    affectsWeapon: false,
  },
};

/* --------------------------------------------------------- Run 能力参数 */

/**
 * **动能爆发**的能量增益：`追加冲量 = KINETIC_BURST_GAIN × projectileMass × relativeVelocity`。
 *
 * ⚠️ 这里只放一个标量增益，**没有任何「重型弹头专属」的写死强度** ——
 *    实际强度里 `projectileMass` 读自本局真实 resolved 武器 def（基础 1 / 重型弹头 4），
 *    `relativeVelocity` 读自正式 `damage` 事件（真实冲击结果）。重弹天然打出更狠的一击。
 */
export const KINETIC_BURST_GAIN = 12;

/** **反冲蓄能**：每 N 次真实开火蓄一次。 */
export const RECOIL_CHARGE_THRESHOLD = 3;

/** **反冲蓄能**：蓄满时给玩家车的前向冲量（世界 px 方向，速度量纲）。 */
export const RECOIL_CHARGE_IMPULSE = 45;

/** **紧急维修**：选择时修回的耐久比例（相对上限；不超过上限）。 */
export const EMERGENCY_REPAIR_FRACTION = 0.25;

/** 本局 Build 是否包含某一项（运行时按能力分派）。 */
export function buildHas(build: readonly RunModifierId[], id: RunModifierId): boolean {
  return build.includes(id);
}

/* --------------------------------------------------- 本局 registry / 快照 */

/** 把「单个 id / id 数组 / null」统一成数组（兼容旧调用点）。 */
export function normalizeBuild(
  build: RunModifierId | readonly RunModifierId[] | null | undefined,
): readonly RunModifierId[] {
  if (build == null) return [];
  return typeof build === 'string' ? [build] : [...build];
}

/** Build 里**真正改武器数值**的那些项（按选择顺序 → 后选的覆盖先选的）。 */
export function weaponOverlayMods(build: readonly RunModifierId[]): readonly RunModifierId[] {
  return build.filter((m) => RUN_MODIFIER_OVERLAY[m]?.affectsWeapon === true);
}

/** 本局专用部件 id（带前缀 → 不会撞上任何正式 defId）。单项时与旧口径 `run.mod.<id>` 一致。 */
export function runOverlayDefId(mod: RunModifierId): string {
  return `run.mod.${mod}`;
}

/**
 * 本局 Build 对应的 overlay 部件 id（**确定性**：由改武器的项按顺序拼接）。
 * 没有任何改武器的项 → `null`（本局武器就是正式 Cannon，无需重映射）。
 */
export function runBuildDefId(build: readonly RunModifierId[]): string | null {
  const mods = weaponOverlayMods(build);
  return mods.length === 0 ? null : `run.mod.${mods.join('+')}`;
}

/**
 * 以正式 Cannon 为基准派生本局变体：把改武器的项按顺序**浅合并** `behaviorParams`
 * （未声明字段一律保留正式值 → 例如三连装填只是把 `burstRounds` 从 2 抬到 3，
 *   伤害 / 半径 / 质量 / 弹速 / 冷却全部沿用）。
 */
export function composeRunWeaponDef(
  base: FunctionalPartDef,
  build: readonly RunModifierId[],
): FunctionalPartDef {
  let behavior = base.behavior;
  let params: Record<string, unknown> = { ...(base.behaviorParams ?? {}) };
  for (const m of weaponOverlayMods(build)) {
    const o = RUN_MODIFIER_OVERLAY[m];
    behavior = o.behavior;
    params = { ...params, ...o.behaviorParams };
  }
  return { ...base, behavior, behaviorParams: params };
}

/**
 * 造一份**本局专用 registry**（正式 `createRegistry()` 的独立副本）。
 *
 * - 没有改武器的项（未选 / 只选了能力类）→ 直接返回正式副本，行为与基础状态完全一致；
 * - 有改武器的项 → 额外注册一个本局合成的 overlay 部件，**正式 `cannon` 键仍在副本里保持原值**
 *   （因此可以逐字段对拍「正式定义未被改写」）。
 */
export function createRunRegistry(
  build: RunModifierId | readonly RunModifierId[] | null | undefined,
): ContentRegistry {
  const mods = normalizeBuild(build);
  const reg = createRegistry();
  const defId = runBuildDefId(mods);
  if (!defId) return reg;
  const base = reg.functionals.get(RUN_BASE_WEAPON_DEF_ID);
  if (!base) {
    throw new Error(`RunModifier: 正式 registry 缺少基准武器 "${RUN_BASE_WEAPON_DEF_ID}"`);
  }
  reg.functionals.set(defId, composeRunWeaponDef(base, mods));
  return reg;
}

/**
 * 把本局 BuildSnapshot 里**基准武器**的 `defId` 重映射到本局 overlay 部件。
 *
 * 只动 `defId` 一个字段 → 挂点 / 星级 / 装配 / 其它部件全部原样；
 * 没有任何改武器的项 → 原样返回（本局武器就是正式 Cannon）；
 * 有改武器的项却找不到基准武器时**显式抛错**（不静默跳过，否则「选了强化但没生效」会变成静默失败）。
 */
export function applyRunModifiersToSnapshot(
  snapshot: BuildSnapshot,
  build: RunModifierId | readonly RunModifierId[] | null | undefined,
): BuildSnapshot {
  const mods = normalizeBuild(build);
  const overlayId = runBuildDefId(mods);
  if (!overlayId) return snapshot;
  let touched = false;
  const functionals = snapshot.functionals.map((install) => {
    if (install.defId !== RUN_BASE_WEAPON_DEF_ID) return install;
    touched = true;
    return { ...install, defId: overlayId };
  });
  if (!touched) {
    throw new Error(
      `RunModifier: 本局装载里没有 "${RUN_BASE_WEAPON_DEF_ID}"，无法注入强化 [${mods.join(', ')}]`,
    );
  }
  return { ...snapshot, functionals };
}
