/**
 * PRODUCT-LOOP-R3-MOVEMENT-CANONICAL-INVENTORY｜**当前正式 Movement / Drive 的 canonical mapping**。
 *
 * ── 这个模块回答什么 ──────────────────────────────────────────────────────────
 * 「现在**正式存在**、并且 **Product Run 已经真实消费**」的 Movement / Drive 到底是哪些，
 * 以及它们从**局外（Garage / Profile）**到 **Run Snapshot**、再到 **Runtime 数值**的
 * 每一步长什么样。它是下一阶段扩展 Movement 这个局外配置维度之前的**事实清单**。
 *
 * ── 唯一的真源（本模块**不复制**任何一条数据）──────────────────────────────
 *   - Movement 内容真源 = `registry.movements`（`core/content.ts` 的正式内容库）。
 *     本模块遍历它取 id / name / kind / radius / mass / energy —— **不写第二张表**。
 *   - 「哪些轮组需要库存」真源 = `OFFICIAL_MOVEMENTS`（`core/partInventory.ts`）。
 *   - 缺省 Movement 真源 = **正式 Snapshot 构造器本身**：`buildSnapshotFromDraft`
 *     对「没有轮组选择」的 draft 会填哪个 defId，本模块就报哪个（见
 *     `defaultMovementDefId`）—— 刻意**不**在这里再写一次 `'wheelStd'` 字面量。
 *   - 缺省 Drive 真源 = `resolveDriveMode`（缺省入参 ⇒ 正式缺省值）。
 *   - Runtime 数值真源 = `resolveSnapshot`（与战斗装配用的是同一个函数，
 *     含 `overrides` 的合并语义）—— 本模块不自己 `{...def, ...overrides}`。
 *
 * ── 本轮**实测**确认的三件事（写在这里，避免下次再从零翻代码）─────────────
 *   ① **正式 Movement 内容存在且被真实消费**：4 个正式轮组 def（1 标准 + 3 需库存），
 *      经 Snapshot → `planckVehicleAssembly` 真实建出轮体（`radius` / `mass` / `grip`
 *      进物理），并经 `arenaA.topdownCapabilityOf` 把 `driveTorque` / `maxRPM` 折算成
 *      推进能力。所以**不是**「没有可复用的正式 Movement 内容」。
 *   ② **Drive 同样被真实消费**：`BuildDraft.drive` ⇒ `SpawnedEntity.drive` ⇒
 *      是否平移（`drive !== 'stationary'`）。
 *   ③ ⚠️ **产品侧目前没有 Movement / Drive 的写入口**：产品 Garage 的唯一写入口
 *      （`playerLoadout.equipWeapon`）只写 `frontMass` 一槽。因此局外到局内的
 *      Movement / Drive 是**原样携带**（carry-through）—— 来源是
 *      `strongfruit.playerBuild.v1` 里已有的字段，产品侧既不新增也不改写。
 *      本模块把这条「携带必须逐项一致」的契约显式化，供 `tests/productRunMovementCanonical.test.ts`
 *      与将来的写入入口共用。
 *
 * ── 硬边界 ──────────────────────────────────────────────────────────────────
 *   - **纯只读**：本模块不写任何存档、不改任何 draft、不改任何数值；调用它零副作用。
 *   - **不新增 Movement 类型 / 不新增数值**：它只把**已存在**的正式内容读出来。
 *   - 它**不是**第二套校验器：合法性判定仍然只有 `validateSnapshot` 一处。
 *     `movementMapping` 要求输入本身是**正式链路能接受的** draft；引用了未知 Movement
 *     时正式 `resolveSnapshot` 会抛错，本模块**原样让它抛**（不 catch、不降级）。
 */

import { registry } from '../core/content';
import { OFFICIAL_MOVEMENTS } from '../core/partInventory';
import { resolveSnapshot } from '../core/buildSnapshot';
import {
  EMPTY_SLOT,
  buildSnapshotFromDraft,
  makeStarterDraft,
  resolveDriveMode,
  type BuildDraft,
  type DriveMode,
} from '../lab/buildEditorModel';
import { PLAYER_BODY_DEF_ID } from './playerLoadout';

/** 一个正式 Movement 的 canonical 读数（全部现读自 `registry.movements`）。 */
export interface CanonicalMovement {
  readonly defId: string;
  readonly name: string;
  /** Movement 种类（V1 阶段正式只支持 `'wheel'`，取自 def 本身而不是本模块的假设）。 */
  readonly kind: string;
  readonly radius: number;
  readonly mass: number;
  readonly energy: number;
  /**
   * 是否需要**库存拥有**才能装备。
   * 真源 = `OFFICIAL_MOVEMENTS`（标准轮不进库存、恒默认拥有；其余三档需 `one ≥ 1`）。
   */
  readonly needsInventory: boolean;
}

/**
 * 正式 Movement 集合（顺序 = `registry.movements` 的注册顺序，稳定）。
 *
 * ⚠️ **遍历 registry**，不是本模块维护的常量表 —— registry 加一件，这里自动多一件；
 *    「这里少了一件」在结构上不可能发生（由 `tests/productRunMovementCanonical.test.ts` 的
 *    `MC-01` 用集合相等钉死）。
 */
export function canonicalMovements(): readonly CanonicalMovement[] {
  const out: CanonicalMovement[] = [];
  for (const def of registry.movements.values()) {
    out.push({
      defId: def.id,
      name: def.name,
      kind: def.kind,
      radius: def.radius,
      mass: def.mass,
      energy: def.energy,
      needsInventory: OFFICIAL_MOVEMENTS.includes(def.id),
    });
  }
  return out;
}

/** 全部正式 Movement defId（= Runtime 解析 Movement 时必须命中的那个集合）。 */
export function canonicalMovementDefIds(): readonly string[] {
  return canonicalMovements().map((m) => m.defId);
}

/** 该 defId 是不是正式 Movement（运行时口径：`registry.movements` 是否认识它）。 */
export function isCanonicalMovement(defId: string): boolean {
  return registry.movements.has(defId);
}

/**
 * **缺省 Movement defId** —— 「draft 里没有轮组选择」时，正式 Snapshot 会填哪一个。
 *
 * ⚠️ 刻意**不**返回一个字面量：这里真的去调正式 `buildSnapshotFromDraft`
 *    （喂一份 `makeStarterDraft` —— 它是正式定义里「没有轮组选择」的那份 draft），
 *    把 Snapshot 实际填进去的 defId 读回来。于是「缺省是什么」永远跟着**真实链路**走，
 *    不会出现「本模块说是 A、Snapshot 填的是 B」。
 * ⚠️ 反过来说：若将来正式缺省轮变了（本模块刻意不预设它不会变），本函数的返回值
 *    会跟着变，而 `MC-03` 会要求它仍然落在 canonical 集合里、且无需库存。
 */
export function defaultMovementDefId(): string {
  const probe = makeStarterDraft(PLAYER_BODY_DEF_ID, registry);
  const snap = buildSnapshotFromDraft(probe, registry, 'movement-canonical-default');
  const first = snap.movements[0];
  if (!first) {
    // 正式 Snapshot 对无轮组选择的 draft 必然产出 rear/front 两条；到这里说明内容库坏了。
    throw new Error('movementCanonical: 正式缺省轮组无法从 buildSnapshotFromDraft 读出');
  }
  return first.defId;
}

/** **缺省 Drive** —— 缺省入参经正式归一函数得到的结果（不是本模块写的字面量）。 */
export function defaultDriveMode(): DriveMode {
  return resolveDriveMode(undefined);
}

/** 正式 Movement 挂点 id（现读自真实 `BodyDef.movementHardpoints`，缺省 = 正式玩家车身）。 */
export function movementHardpointIds(bodyDefId: string = PLAYER_BODY_DEF_ID): readonly string[] {
  return (registry.bodies.get(bodyDefId)?.movementHardpoints ?? []).map((h) => h.id);
}

/* ------------------------------------------------------- 映射读数（Profile → Snapshot → Runtime） */

/** Runtime 真正会用到的那几个轮组数值（与 `resolveSnapshot` 的合并语义同源）。 */
export interface RuntimeMovementNumbers {
  readonly radius: number;
  readonly mass: number;
  readonly energy: number;
  readonly maxRPM: number;
  readonly grip: number;
}

/** 一个 Movement 挂点上的三段读数：局外存的 → Snapshot 生效的 → Runtime 用的数值。 */
export interface MovementSlotMapping {
  readonly hardpointId: string;
  /**
   * 局外（Profile draft）里**原样存着**的那个值：
   *   - `null`  = 存档里根本没有这个键（= 缺省，等价于标准轮）；
   *   - `'none'` = 明确卸下（`EMPTY_SLOT`）；
   *   - 其它     = 正式 Movement defId。
   */
  readonly storedDefId: string | null;
  /** 该槽在正式 Snapshot 里**真正生效**的 defId；未装 ⇒ `null`（该槽没有 Movement）。 */
  readonly effectiveDefId: string | null;
  /** 生效时 Runtime 用的数值（含 `overrides.radius`）；未装 ⇒ `null`。 */
  readonly runtimeNumbers: RuntimeMovementNumbers | null;
}

/** 该槽在局外是**明确卸下**（`EMPTY_SLOT`）而不是「存档里没有这个键」（= 缺省轮）。 */
export function isStoredUnmounted(slot: MovementSlotMapping): boolean {
  return slot.storedDefId === EMPTY_SLOT;
}

/** 「局外装备 → 本局装载」的完整 Movement / Drive 映射（纯读数）。 */
export interface MovementMappingReading {
  readonly bodyDefId: string;
  /** 经**正式归一**后的驱动模式（`undefined` / 非法 ⇒ 缺省）。 */
  readonly drive: DriveMode;
  /** 正式 Snapshot 的 `movements[].defId` —— Run 侧真正装载的 Movement 序列。 */
  readonly effectiveDefIds: readonly string[];
  readonly slots: readonly MovementSlotMapping[];
}

/**
 * 读出这份 draft 的 Movement / Drive 映射。
 *
 * ⚠️ 全程走**正式**函数：`buildSnapshotFromDraft` 产出 Snapshot、
 *    `resolveSnapshot` 产出 Runtime 数值。因此本读数与 Run 侧看到的**必然**是同一份 ——
 *    这正是 Queue 必改 2 要的那个「Garage / Profile 与 Run Snapshot / Runtime 一致」的口径。
 *
 * ⚠️ **本函数不制造第二个校验器**：合法性判定仍然只有 `validateSnapshot` 一处。
 *    若 draft 引用了正式内容库里没有的 Movement，正式 `resolveSnapshot` 会**抛错**
 *    （`ResolveSnapshot: unknown movement "..."`）—— 本函数**原样让它抛**，
 *    不 catch、不降级、不给一个「看起来还能用」的映射。
 *    真实链路里这个错误**不可达**：局外 `loadPlayerBuild` 与局内 `parseRunPlayerLoadout`
 *    两层都会先把这种 draft 拒掉（见 `tests/productRunMovementCanonical.test.ts` 的 `MC-09`）。
 */
export function movementMapping(draft: BuildDraft): MovementMappingReading {
  const snapshot = buildSnapshotFromDraft(draft, registry, 'movement-canonical-mapping');
  const resolved = resolveSnapshot(snapshot, registry);

  /** 已装载的槽：`effectiveDefId` / `runtimeNumbers` 必然非空（供本函数内部窄化）。 */
  type MountedSlot = MovementSlotMapping & {
    effectiveDefId: string;
    runtimeNumbers: RuntimeMovementNumbers;
  };

  const byHardpoint = new Map<string, MountedSlot>();
  for (const r of resolved.movements) {
    byHardpoint.set(r.install.hardpointId, {
      hardpointId: r.install.hardpointId,
      storedDefId: null, // 下面按 draft 原值回填
      effectiveDefId: r.def.id,
      runtimeNumbers: {
        radius: r.def.radius,
        mass: r.def.mass,
        energy: r.def.energy,
        maxRPM: r.def.maxRPM,
        grip: r.def.grip,
      },
    });
  }

  const slots: MovementSlotMapping[] = movementHardpointIds(draft.bodyDefId).map((hardpointId) => {
    // V1 正式车身的 Movement 挂点恒为 rear / front（`BodyDef.movementHardpoints`）。
    // 未知挂点 id 一律按「存档里没有这个键」处理（`null`），**不**回退去读另一个槽的值 ——
    // 那会把「前轮的选择」当成「某个新挂点的选择」，制造一份不存在的映射。
    const stored =
      hardpointId === 'rear'
        ? draft.rearWheelDefId
        : hardpointId === 'front'
          ? draft.frontWheelDefId
          : undefined;
    const mounted = byHardpoint.get(hardpointId);
    // `undefined` ⇒ 存档里根本没有这个键（= 缺省轮）；`'none'` ⇒ 明确卸下。
    const storedDefId: string | null = stored === undefined ? null : stored;
    if (mounted) return { ...mounted, storedDefId };
    return { hardpointId, storedDefId, effectiveDefId: null, runtimeNumbers: null };
  });

  return {
    bodyDefId: draft.bodyDefId,
    drive: resolveDriveMode(draft.drive),
    effectiveDefIds: resolved.movements.map((r) => r.def.id),
    slots,
  };
}
