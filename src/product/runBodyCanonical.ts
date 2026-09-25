/**
 * PRODUCT-LOOP-R4-BODY-CANONICAL-AND-GARAGE-MVP｜**当前正式 Body 的 canonical mapping**。
 *
 * ── 这个模块回答什么 ──────────────────────────────────────────────────────────
 * 「现在**正式存在**、并且 **Product Run 已经真实消费**」的玩家车身到底是哪些，
 * 以及它们从**局外（Garage / Profile）**到 **Run Snapshot**、再到 **Runtime 数值**的
 * 每一步长什么样。它是把 Body 这个局外配置维度**正式打通**之前的**事实清单**。
 *
 * ── 唯一的真源（本模块**不复制**任何一条数据）──────────────────────────────
 *   - Body 内容真源 = `registry.bodies`（`core/content.ts` 的正式内容库）。
 *     本模块遍历 `OFFICIAL_BODIES` 取 id / name / hp / baseMass / energyCapacity ——
 *     **不写第二张表**。
 *   - 「正式玩家车身目录」真源 = `OFFICIAL_BODIES`（`core/bodyOwnership.ts`）。
 *   - Runtime 数值真源 = `resolveSnapshot`（与战斗装配用的是同一个函数）。
 *     `BodyDef` 的 `hp` / `baseMass` / `energyCapacity` / `colliders` / `hardpoints`
 *     经 `planckVehicleAssembly` 真实进入物理与战斗结算
 *     （`game/playerGameRuntime.ts` 直接读 `draft.bodyDefId`、`buildSnapshotFromDraft`
 *      经 `resolveSnapshot` 取 `registry.bodies.get(snapshot.bodyDefId)` 抛错未知）。
 *
 * ── 本轮确认的三件事（写在这里，避免下次再从零翻代码）─────────────────────
 *   ① **正式 Body 内容存在且被真实消费**：12 个 `BodyDef`（8 个 OFFICIAL_BODIES +
 *      4 个 Lab / 对手池车身）经 Snapshot → `planckVehicleAssembly` 真实建出车体
 *      （hp / baseMass / colliders / hardpoints 进物理与战斗），Battle Runtime 直接
 *      消费 `bodyDefId`。所以**不是**「没有可复用的正式 Body 内容」。
 *   ② `BuildDraft.bodyDefId` 是**正式既有的单一字段** ⇒ 本 Queue **不创造新的 Body 槽模型**，
 *      只是给它补一个「玩家能按」的写入口（此前它只能被 Lab / 旧横屏游戏写入）。
 *   ③ 拥有模型已存在：`core/bodyOwnership.ts` 的 `OFFICIAL_BODIES` + `canEquipBody`
 *       + `grantAllNewBodies`，且 debug「全部件×1」已经调过它 ⇒ 可镜像复用。
 *
 * ── 硬边界 ──────────────────────────────────────────────────────────────────
 *   - **纯只读**：本模块不写任何存档、不改任何 draft、不改任何数值；调用它零副作用。
 *   - **不新增 Body 类型 / 不新增数值**：它只把**已存在**的正式内容读出来。
 *   - 它**不是**第二套校验器：合法性判定仍然只有 `validateSnapshot` 一处。
 *     `bodyMapping` 要求输入本身是**正式链路能接受的** draft；引用了未知 Body
 *     时正式 `resolveSnapshot` 会抛错，本模块**原样让它抛**（不 catch、不降级）。
 */

import { registry } from '../core/content';
import { OFFICIAL_BODIES } from '../core/bodyOwnership';
import { resolveSnapshot } from '../core/buildSnapshot';
import { buildSnapshotFromDraft } from '../lab/buildEditorModel';
import type { BuildDraft } from '../lab/buildEditorModel';

/** 一个正式玩家车身的 canonical 读数（全部现读自 `registry.bodies`）。 */
export interface CanonicalBody {
  readonly defId: string;
  readonly name: string;
  /** BodyDef 上的三个核心数值（卡片与 Run 侧同一次读取）。 */
  readonly hp: number;
  readonly baseMass: number;
  readonly energyCapacity: number;
}

/**
 * 正式玩家车身集合（顺序 = `OFFICIAL_BODIES` 的顺序，稳定）。
 *
 * ⚠️ **遍历 OFFICIAL_BODIES**，不是 `registry.bodies` 全集 —— Lab / 对手池用的
 *    `wedgeBody` / `boxBody` / `tallBody` / `heavyBox` 不在此列（它们不在
 *    `OFFICIAL_BODIES` 里，产品侧不可装备）。
 * ⚠️ 取数前先确认 registry 真有这台 ⇒ 内容库若删了一台已知正式车身，这里**如实**
 *    少报而不是抛错（`canonicalBodies` 是「已知正式车身的集合」，缺一台不致命）。
 */
export function canonicalBodies(): readonly CanonicalBody[] {
  const out: CanonicalBody[] = [];
  for (const defId of OFFICIAL_BODIES) {
    const def = registry.bodies.get(defId);
    if (!def) continue;
    out.push({
      defId: def.id,
      name: def.name,
      hp: def.hp,
      baseMass: def.baseMass,
      energyCapacity: def.energyCapacity,
    });
  }
  return out;
}

/** 全部正式玩家车身 defId（= Runtime 解析时必须命中的那个集合的子集）。 */
export function canonicalBodyDefIds(): readonly string[] {
  return canonicalBodies().map((b) => b.defId);
}

/** 该 defId 是不是正式玩家车身（运行时口径：`OFFICIAL_BODIES` 是否认识它）。 */
export function isCanonicalBody(defId: string): boolean {
  return OFFICIAL_BODIES.includes(defId);
}

/**
 * **局外 → Run Snapshot → Runtime** 的 Body 映射（纯读数）。
 *
 * ⚠️ 全程走**正式**函数：`buildSnapshotFromDraft` 产出 Snapshot、
 *    `resolveSnapshot` 产出 Runtime 读数（含 `body` 字段里的 `hp` / `baseMass`）。
 *    因此本读数与 Run 侧看到的**必然**是同一份 —— 这正是 Queue 必改 5 要的那个
 *    「Garage / Profile 与 Run Snapshot / Runtime 一致」的口径。
 *
 * ⚠️ **本函数不制造第二个校验器**：合法性判定仍然只有 `validateSnapshot` 一处。
 *    若 draft 引用了正式内容库里没有的 Body，正式 `resolveSnapshot` 会**抛错**
 *    （`ResolveSnapshot: unknown body "..."`）—— 本函数**原样让它抛**，
 *    不 catch、不降级、不给一个「看起来还能用」的映射。
 */
export interface BodyMappingReading {
  readonly bodyDefId: string;
  readonly bodyName: string;
  /** 与 Run Snapshot / Runtime 读到的 `body.hp` **同一个值**（真源 = `registry.bodies`）。 */
  readonly hp: number;
  readonly baseMass: number;
  readonly energyCapacity: number;
}

export function bodyMapping(draft: BuildDraft): BodyMappingReading {
  // 走与 Run 侧**完全相同**的解析链路（正式 `resolveSnapshot`）：
  const snapshot = buildSnapshotFromDraft(draft, registry, 'body-canonical-mapping');
  const resolved = resolveSnapshot(snapshot, registry);
  const body = resolved.body;
  return {
    bodyDefId: body.id,
    bodyName: body.name,
    hp: body.hp,
    baseMass: body.baseMass,
    energyCapacity: body.energyCapacity,
  };
}
