/**
 * PRP-R5-RESTORE-LEGACY-BATTLE-CAMERA｜Run Page 的真实战斗运行时适配 + **正式 Battle Camera** 接入。
 *
 * 本文件的**唯一职责**：把**旧正式左右侧视 Planck 战斗**接到 Run Page 中部舞台上，
 * 而**不重新定义任何 gameplay 语义**。因此：
 *
 *   1) 战斗世界 = 正式 `PlanckBattleOrchestrator`（与正式 Battle 同一套类，不是第二套实现）；
 *   2) 构造时**不传任何 config**（空对象）→ 世界尺度 / 出生点 / 地面 / 移动 / 武器 /
 *      弹丸 / 后坐 / 碰撞 / 阶段全部取正式默认值：
 *        - `DEFAULT_ARENA_CONFIG`：width **1600** / height 900 / groundY **700** /
 *          wallThickness 60 / phases Active 10s · Warning 3s · Closing 5s / closingSpeed 3；
 *        - `spawnA {x:400, y:640, facing:1}` / `spawnB {x:1200, y:640, facing:-1}`
 *          → 出生中心距 **800 世界 px**；
 *        - `autoDrive` 默认开（A 朝 +X、B 朝 −X），Cannon 行为按正式 cooldownMs 自动开火；
 *        - gravity `{x:0, y:10}`（真实贴地，禁止 0 重力假悬浮）。
 *      PRP **不**覆盖以上任何一项（Queue 必改 1/3）。
 *
 *   3) 相机 = **正式 `Renderer` 的 battle 相机链**：`reframe(snap,'battle',{phase})`
 *      → `battleCam` → 逐帧 `applyBattleFollow`。PRP **不写第二套镜头**：
 *        - scale 由正式三段动态取景公式给出（远端 0.87 / 接近 0.75 / 碰撞 0.60 × 安全宽，
 *          由**真实世界间距比例** `gapWorld/coreUnionW` 驱动），不是固定常数；
 *        - 位置由正式 `applyBattleFollow` 追踪双方中点 + 分离有限拉远（≤ baseScale）；
 *        - ❌ 无 PRP 专属镜头规则：不按炮弹 zoom / 不按碰撞 zoom / 无震屏 / 无 kill zoom /
 *          无 cinematic。
 *      ⚠️ **为什么逐帧 `reframe`**：正式 `Renderer` 的 battle 分支自述「Active 每帧按 A∪B
 *        真实 bounds 计算目标 scale」，正式相机测试（`tests/battleDynamicFramingR21.test.ts`）
 *        的调用口径同样是每帧；正式运行时只在阶段切换构图（接线缺环），使三段动态取景在横屏里
 *        长期休眠。PRP 舞台带只有 390 逻辑宽，必须让正式动态取景真正生效，物理反馈
 *        （弹丸飞行 / 后坐 / 接敌 / 碰撞）才重新进入可感知尺度。
 *
 *   4) **viewport adapter**（唯一为 band 做的适配，相机算法一行不改）：正式相机在
 *      「安全区」内构图（非 compact battle = insetX **56** / insetTop **28** / insetBottom **28**）。
 *      PRP 舞台带没有 HUD、整条带都是对焦区 → 离屏视口取「带 + inset」（502×358），
 *      使**正式安全区恰好等于舞台带**，合成时只裁安全区那一块贴到带上（见 `RUN_BATTLE_VIEW_*`）。
 *
 * ⚠️ 本文件**不写任何战斗数值**：HP / 伤害 / CD / 射速 / 质量 / 后坐全部由正式链路解析。
 * ⚠️ 「PRP 侧被改过的 gameplay」在本适配里**不存在** —— 因为 PRP 此前根本没有战斗
 *    （旧 `RUN_BATTLE_SCRIPT` 只是 90 步线性 HP 插值 + `sin` 位移动画，已删除）。
 *
 * ── PRP-F2-FIRST-REAL-UPGRADE-LOOP 追加（本 Queue 的唯一新语义）──────────────
 *
 *   5) **Run-local 强化注入**：本场战斗可以带一个「本局临时强化」，注入方式**不是**在
 *      Weapon / Projectile / Orchestrator 里加分支，而是：
 *        a. `createRunRegistry(modifier)` —— 用正式 `createRegistry()` 造一份**独立副本**，
 *           在其中注册一个本局专用部件 id（数值由正式 Cannon 派生）；
 *        b. `applyRunModifierToSnapshot(...)` —— 把本局 BuildSnapshot 里基准武器的 `defId`
 *           重映射到该部件（只动一个字段）；
 *        c. 正式 `resolveSnapshot` 于是把强化后 def 交给 `PlanckPartRuntime`，
 *           武器 Behavior 读到的就已经是强化值 → **零改 Weapon / Contact / Orchestrator**。
 *      ⇒ 正式 `content.ts` / `registry` 单例 / `cannonBehavior` / `ContactRouter` 全部零修改；
 *        强化只活在本局内存副本里，刷新即消失（不落盘 / 不进 Garage / 不改星级）。
 *
 *   6) **跨战斗耐久**：`carriedHp` = 上一场真实剩余 HP，**只写当前 HP、不动 maxHp**
 *      （与正式测试既有写法一致：`tests/battleStatus.test.ts` 亦直接写 `vehicle.hp`）。
 *      因此第二场耐久条如实显示「打剩多少」，不会自动满血。
 *      ⚠️ `carriedHp <= 0`（被打退）不注入 —— 0 HP 的车没有可续用的耐久，正常路径是「存活推进」。
 *
 * ── PRP-BUILD-01-TWO-STEP-CANNON-BUILD 追加 ──────────────────────────────
 *
 *   7) **两层 Build**：注入参数从「单个 `modifier`」扩展为**有序 `build`**。
 *      武器数值侧 = 把改武器的项（第一层 + 第二层的 `tripleLoad`）**按顺序浅合并**成一个 overlay 部件
 *      （`runModifiers.composeRunWeaponDef`），再重映射 `defId`；能力侧（动能爆发）
 *      由 `RunBuildAbilities` 订阅**正式战斗事件**驱动。
 *      `modifier` 仍保留为 `build[0]` 的访问器 → 逐项独立验证的既有断言不受影响。
 *   8) **Run 能力的冲量在固定步边界施加**（`step()` 里先 `abilities.flush()` 再 `orchestrator.step`）：
 *      事件回调只入队 → 不在物理求解过程中改速度；战斗结束后不再施加 → 不破坏「RESULT = 战场冻结」。
 *
 * ── PRP-BUILD-01-R1-KINETIC-IMPACT-PERCEPTIBILITY 追加 ────────────────────
 *
 *   9) **动能爆发的冲量作用点 = 真实命中点**（`damage.contactPoint`，经 `RunAbilityPorts.applyImpulse`
 *      的 `at` 参数直通 `world.applyLinearImpulse`）。作用在质心只产生平动，而平动会被
 *      **相机跟随双方中点**追平（实测：世界位移 +20.7px → 舞台带只动 4px）；
 *      作用在真实命中点额外产生绕质心的**扭矩**，而扭矩（仰俯 / 旋转）无法被相机平移追平。
 *      这既更接近真实撞击，也是「这一炮命中后把对手明显轰开」唯一可感知的物理通道。
 *      同时 `abilitySnapshot().lastKineticHit` 暴露该真实命中点 → 表现层的冲击环画在**同一个位置**。
 */

import type { BuildSnapshot, ContentRegistry } from '../../core/types';
import { validateSnapshot } from '../../core/buildValidator';
import type { BattleRenderSnapshot, BattleResult } from '../../battle/battleContract';
import { ENEMY_KEEP_DISTANCE_BANDS } from '../../battle/battleContract';
import { PlanckBattleOrchestrator } from '../../battle/planckBattleOrchestrator';
import type { BuildDraft } from '../buildEditorModel';
import { buildSpawnPlan, buildSpawnPlanFromDraft, type SpawnPlan } from './entities';
import { RUN_STAGE_BAND } from './runPageLayout';
import { RUN_DEMO_ENCOUNTER_ID, RUN_DEMO_LOADOUT_ID } from './runPageScene';
import { RunBuildAbilities, type RunAbilitySnapshot } from './runBuildAbilities';
import {
  applyRunModifiersToSnapshot,
  createRunRegistry,
  normalizeBuild,
  resolveRunBaseWeaponDefId,
  type RunModifierId,
} from './runModifiers';
/*
  PRODUCT-LOOP-R2-C｜两个 **core** 只读口径（本目录白名单已含 `../../core/buildSnapshot`）：
  `weaponMainDamage` = 「这件武器一次命中扣多少血」的唯一读取口径（与 ContactRouter 的两个
  伤害分支一一对应）；`weaponNumericParams` = 该武器全部数值参数（用于逐项证明「只有伤害变了」）。
  ⚠️ 本文件**不自己算星级倍率**：星级在正式 `resolveSnapshot` 里已经作用到 def 上，
     这里只如实回读「装配后的真实数值」——重算就是第二套口径。
*/
import { weaponMainDamage, weaponNumericParams } from '../../core/buildSnapshot';

/** 本局演示组合（与 F1 共享测试数据同源；不改 Debug 选择项）。 */
export const RUN_BATTLE_LOADOUT_ID = RUN_DEMO_LOADOUT_ID;
export const RUN_BATTLE_ENCOUNTER_ID = RUN_DEMO_ENCOUNTER_ID;

/**
 * PRODUCT-LOOP-R2-C｜一场战斗里**玩家**打出的每一次武器伤害（真实 `damage` 事件的只读记录）。
 *
 * ⚠️ 只记事实、不改战斗：这条订阅不产生冲量、不写 HP、不参与判定（与 Run 能力订阅并列，
 *    互不影响）——它的唯一用途是让「星级真的改变了伤害」可以被**实测**，而不是靠读 UI 文案。
 */
interface RunPlayerWeaponHit {
  /** 真实扣血量（`DamageEvent.damage`，由 DamageResolver 落到对方 HP 上的那个数）。 */
  readonly damage: number;
  /** 来源部件 id（= `part.def.id`，如 `cannon`）。 */
  readonly partId: string;
  /** 来源 behavior（如 `cannon` / `hammer` / `ram`）。 */
  readonly behavior: string;
  /** 该次命中的战斗时刻（ms）——取记录时的 `orchestrator.timeMs`（事件自带的时间戳由
   *  ContactRouter 传 0，不能用作时刻）。 */
  readonly atMs: number;
}

/**
 * 本局**真实 projectile 质量**（动能爆发的强度来源）。
 *
 * 口径 = 玩家那门武器 part 的 resolved `behaviorParams.projectileMass`
 * （= 该武器创建的 projectile 的真实质量，不是 PRP 侧自算、也不是写死的「专属伤害」）。
 * 读不到 → `0`（动能爆发会自然失效，绝不计造强度）。
 *
 * ⚠️ 放在本文件而不是能力模块：正式编排器只允许本文件引用（R22a-4 单入口守卫）。
 */
function readRunProjectileMass(orchestrator: PlanckBattleOrchestrator): number {
  for (const part of orchestrator.vehicleA.parts) {
    if (part.def.category !== 'weapon') continue;
    const m = part.def.behaviorParams?.projectileMass;
    if (typeof m === 'number' && Number.isFinite(m)) return m;
  }
  return 0;
}

/* ------------------------------------------------- viewport adapter 几何 */

/**
 * 正式 battle 相机在非 compact 视口使用的 inset（logical px）——与 `src/render/renderer.ts`
 * 的 `SAFE_INSET_X = 56` / `SAFE_INSET_Y = 28` 同值。
 *
 * ⚠️ 这是**只读的几何契约**，不是可调参数：改这里就必须同步核对 renderer 的 inset 常量
 * （`tests/portraitRunBattle.test.ts` 有机器判据把「安全区 == 舞台带」钉住）。
 */
export const RUN_BATTLE_VIEW_INSET = { x: 56, y: 28 } as const;

/**
 * 离屏战斗视口尺寸 = 舞台带 + 正式 inset × 2。
 *
 * `isCompactLandscape(502, 358)` = false（aspect 1.402 < 1.5）→ 正式相机走
 * 「非 compact」分支 → `insetX 56 / insetTop 28 / insetBottom 28` →
 * **安全区 = (56,28,390,302) == 舞台带**。
 */
export const RUN_BATTLE_VIEW_W = RUN_STAGE_BAND.w + RUN_BATTLE_VIEW_INSET.x * 2;
export const RUN_BATTLE_VIEW_H = RUN_STAGE_BAND.h + RUN_BATTLE_VIEW_INSET.y * 2;

/**
 * 相机实时状态（每帧由正式 `reframe` + `applyBattleFollow` 写入）。
 * 全部为**离屏画布坐标**；换算到舞台带需减去 `cropX/cropY`。
 */
export interface RunBattleXform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  /** 离屏画布 → 舞台带的裁剪原点（= 正式 inset）。 */
  readonly cropX: number;
  readonly cropY: number;
}

/** 世界坐标 → 舞台带逻辑坐标（渲染与 probe 同源，不出现第二套换算）。 */
export function battleBandX(x: RunBattleXform, worldX: number): number {
  return x.offsetX + worldX * x.scale - x.cropX;
}
export function battleBandY(x: RunBattleXform, worldY: number): number {
  return x.offsetY + worldY * x.scale - x.cropY;
}

/** 地面线在舞台带内的 y（逻辑 px）。 */
export function battleGroundBandY(x: RunBattleXform, groundY: number): number {
  return battleBandY(x, groundY);
}

/**
 * 是否在本帧调用正式 `reframe` —— 正式口径（**不自创规则**）：
 *
 *   - `Active`：**每帧**（正式 `Renderer` battle 分支自述「Active 每帧」，正式相机测试
 *     `battleDynamicFramingR21.test.ts` 同源调用）→ 三段动态取景真正生效；
 *   - 其它阶段（Warning / Closing / End）：**只在阶段切换那一帧**（正式运行时
 *     `pollArenaPhase` 的语义）→ 之后交给逐帧 `applyBattleFollow` 平滑收敛。
 *
 * ⚠️ 为什么非 Active 不能每帧 reframe：非 Active 分支只做「相对基准 ±10% 钳制」，
 *    每帧重复施加会与逐帧 `applyBattleFollow` 互相拉扯（0.4%/帧 抖动）——
 *    既不是正式行为，也会破坏「RESULT 战场冻结」这一既有不变量。
 */
export function shouldReframeBattleCamera(phase: string, lastPhase: string | null): boolean {
  return phase !== lastPhase || phase === 'Active';
}

/**
 * 舞台带内**实际可见**的世界水平范围。
 *
 * ⚠️ 这是「相机不再是完整世界远摄」的直接证据：PRP-R5 之前固定 `scale = 390/1600`
 * → 可见宽恒为 1600（整世界）；现在由正式动态取景决定，开局约 **1178**（≈ 世界的 74%），
 * 碰撞期进一步收窄到 ≈ 500。
 */
export function battleVisibleWorld(
  x: RunBattleXform,
  bandW: number = RUN_STAGE_BAND.w,
): { minX: number; maxX: number; width: number } {
  const minX = (x.cropX - x.offsetX) / x.scale;
  const maxX = (x.cropX + bandW - x.offsetX) / x.scale;
  return { minX, maxX, width: maxX - minX };
}

/** 世界空间外接框。 */
export interface RunBattleBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/* --------------------------------------------- 快照 → 世界外接框（纯读取） */

function accBox(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  x: number,
  y: number,
): void {
  if (x < box.minX) box.minX = x;
  if (x > box.maxX) box.maxX = x;
  if (y < box.minY) box.minY = y;
  if (y > box.maxY) box.maxY = y;
}

function accShape(box: { minX: number; minY: number; maxX: number; maxY: number }, shape: unknown): void {
  const s = shape as
    | { kind: 'polygons'; polygons: readonly { points: readonly { x: number; y: number }[] }[] }
    | { kind: 'circle'; circle: { center: { x: number; y: number }; radius: number } };
  if (s.kind === 'polygons') {
    for (const poly of s.polygons) for (const p of poly.points) accBox(box, p.x, p.y);
  } else {
    accBox(box, s.circle.center.x - s.circle.radius, s.circle.center.y - s.circle.radius);
    accBox(box, s.circle.center.x + s.circle.radius, s.circle.center.y + s.circle.radius);
  }
}

function accVisual(box: { minX: number; minY: number; maxX: number; maxY: number }, v: unknown): void {
  const x = v as {
    position: { x: number; y: number };
    rotation: number;
    size: { width: number; height: number };
  };
  const hw = x.size.width / 2;
  const hh = x.size.height / 2;
  const cos = Math.cos(x.rotation);
  const sin = Math.sin(x.rotation);
  for (const c of [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ]) {
    accBox(box, c.x * cos - c.y * sin + x.position.x, c.x * sin + c.y * cos + x.position.y);
  }
}

/**
 * 一辆车的**真实可见外接框**（body + wheel + part + visual）。
 *
 * ⚠️ 口径与正式 battle 相机 `reframe` 的 `includeVehicle` 完全一致 ——
 * 「完整入画」的标准是玩家真正看到的 Visual 完整入画，不是仅 Collider。
 */
export function vehicleWorldBox(snap: BattleRenderSnapshot, team: 'A' | 'B'): RunBattleBox {
  const v = team === 'A' ? snap.vehicleA : snap.vehicleB;
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  accShape(box, v.body);
  if (v.bodyVisual) accVisual(box, v.bodyVisual);
  for (const w of v.wheels) {
    accBox(box, w.center.x - w.radius, w.center.y - w.radius);
    accBox(box, w.center.x + w.radius, w.center.y + w.radius);
  }
  for (const wv of v.wheelVisuals ?? []) if (wv) accVisual(box, wv);
  for (const p of v.parts) {
    accShape(box, p.shape);
    if (p.visual) accVisual(box, p.visual);
  }
  return box;
}

/* ------------------------------------------------------------ 运行时 */

export interface RunBattleHp {
  readonly a: number;
  readonly aMax: number;
  readonly b: number;
  readonly bMax: number;
}

/**
 * 本场战斗的 Run-local 参数（PRP-F2 / PRP-BUILD-01）。
 *
 * 只允许三种注入，且都**不改变世界 / 装配 / 正式数值**：
 *   1) `build`      —— 本局 Build（两层有序；overlay registry + 武器 defId 重映射，见 `runModifiers.ts`）；
 *   2) `modifier`   —— 单强化口径（= `build: [modifier]`；保留给逐项独立验证的既有调用点）；
 *   3) `carriedHp`  —— 跨战斗耐久（上一场真实剩余 HP；只写当前 HP，不动 maxHp）。
 */
export interface RunBattleOptions {
  readonly soloA?: boolean;
  /** PRP-BUILD-01：本局完整 Build（按选择顺序，最多两层）。 */
  readonly build?: readonly RunModifierId[];
  /** 单强化口径（等价于 `build: [modifier]`）。 */
  readonly modifier?: RunModifierId | null;
  readonly carriedHp?: number | null;
  /**
   * PRP-RUN-02：本场使用的**正式 Encounter**（`testData.LAB_ENCOUNTERS` 的 id；
   * 每一项都只是「既有正式对手模板」的引用）。
   * 省略 → 默认演示遭遇（`RUN_BATTLE_ENCOUNTER_ID`）→ 既有调用点行为逐字节不变。
   *
   * ⚠️ 只换「打谁」，**不改**世界 / 出生 / 玩家装配 / 任何数值 —— 四场压力阶梯
   * 靠**不同既有 Encounter** 形成（Queue 必改 2 明令禁止加 HP / speed / damage / count）。
   */
  readonly encounterId?: string;
  /**
   * PRODUCT-LOOP-R1-C｜本场**玩家装载**（= 产品侧交进来的「当前 Player Profile Equipped」）。
   *
   * 省略 / `null` ⇒ 走既有 Lab 演示装载（`RUN_BATTLE_LOADOUT_ID`）—— 既有调用点
   * （`encounterLab.ts` / 全部 A1 测试）**逐字节不变**。
   *
   * ⚠️ 只替换「玩家那一侧的 `BuildDraft`」这一个输入：世界 / 出生 / 对手 / 装配 /
   *    数值解析 / 校验仍是**同一条**正式链路（`buildSpawnPlanFromDraft` 内部与
   *    `buildSpawnPlan` 共用 `resolveEntity`），不存在第二套战斗。
   */
  readonly playerDraft?: BuildDraft | null;
  /**
   * 该玩家装载的标签（写进 spawn plan 的 `loadoutId`，用于证据链 / 基础数据指纹）。
   * 只在给了 `playerDraft` 时有意义；省略 ⇒ `'profile-equipped'`。
   */
  readonly playerLoadoutTag?: string | null;
  /**
   * PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY｜是否启用**玩家侧基线伤害**
   * （`PRODUCT_RUN_CANNON_BASE_DAMAGE`，见 `runModifiers.ts`）。
   *
   * 这是「产品 Run 玩家那门炮」的基线，**不是** Modifier：它只重映射**玩家装载**里那一件
   * 基准武器，正式 `cannon` 键与敌方快照都不受影响 ⇒ 敌方 `RangedTurret` 的 cannon 恒为 80。
   *
   * ⚠️ 默认 `false`：`encounterLab.ts` / RDC（`pblRangedDistanceControl`）/ 四场掉血压力阶梯 /
   *    全部既有 Lab 调用点的玩家侧仍是正式 80 ⇒ **逐字段不变**。
   */
  readonly playerBaseline?: boolean;
}

/**
 * Run Page 战斗运行时：正式 `PlanckBattleOrchestrator` 的**薄适配**（无反推、无插值）。
 *
 * 生命周期接入 = 本类的全部新增语义；除此之外的一切（世界 / 出生 / 驱动 / 武器 /
 * 弹丸 / 后坐 / 碰撞 / 伤害 / 阶段 / 结果）都是正式的。
 */
export class RunBattleRuntime {
  readonly plan: SpawnPlan;
  readonly orchestrator: PlanckBattleOrchestrator;
  /** 本局**专用** registry（正式副本 + 可选的 Build overlay 部件；不污染正式单例）。 */
  readonly registry: ContentRegistry;
  /** 本场战斗生效的本局 Build（有序；空数组 = 基础状态）。 */
  readonly build: readonly RunModifierId[];
  /**
   * 本场是否启用**玩家侧基线伤害**（见 `RunBattleOptions.playerBaseline`）。
   * 开 ⇒ 玩家那门炮的基线是 `PRODUCT_RUN_CANNON_BASE_DAMAGE`；关 ⇒ 正式 80。
   */
  readonly playerBaseline: boolean;
  /**
   * PRODUCT-LOOP-R6-RUN-WEAPON-SOURCE-OF-TRUTH｜**本局 Run 的基准武器** = 玩家实际装备里
   * 按装配顺序第一件 `category === 'weapon'` 的 defId（不是写死的 cannon）。
   *
   * ⚠️ 它是本场一切「基准」的唯一来源：本局 registry 以**该武器自己的 canonical Def**
   *    派生 overlay 部件，snapshot 重映射的也是**它自己**那一件。
   *    `null` = 车上没有武器（资格层会先拒绝创建 Run，走到这里说明是研发入口的演示装载）。
   */
  readonly runBaseWeaponDefId: string | null;
  /** 本场使用的正式 Encounter id（默认 = 演示遭遇）。 */
  readonly encounterId: string;
  /**
   * 本场战斗的 Run 能力（动能爆发）—— 事件驱动，见 `runBuildAbilities.ts`。
   * 空 Build（或只带不改武器的项）时它只是一个什么都不做的订阅者（零副作用）。
   */
  readonly abilities: RunBuildAbilities;
  /**
   * PRODUCT-LOOP-R2-C｜**真正交给编排器的那一份** BuildSnapshot。
   *
   * = `plan` 里玩家那份 snapshot 经本局 Run-local overlay 重映射 `defId` **之后**的那一份
   * （`applyRunModifiersToSnapshot` 只动 `defId`，挂点 / **星级** / 其它件原样）。
   * 因此它同时是两件事的唯一事实来源：
   *   - 「本场玩家装了什么」（决定 overlay 部件是否生效）；
   *   - 「本场玩家那件是几星」（`functionals[].star`）→ `playerWeapons()` 的 `star` 直接读它。
   * ⚠️ 刻意**不重算**星级：星级已经在正式 `resolveSnapshot` 里作用到 def 上（伤害/能量），
   *    这里只是把「输入的星级」如实回读，供测试与产品侧对齐（两者必须相等）。
   */
  readonly playerSnapshot: BuildSnapshot;
  /** 玩家方（A）武器命中记录（由正式 `damage` 事件驱动；只记事实，零战斗副作用）。 */
  private readonly playerWeaponHits: RunPlayerWeaponHit[] = [];
  private readonly unsubscribeHits: () => void;
  /** 真实出生中心 x（构造后实测，不是写死数字）。 */
  readonly spawnAx: number;
  readonly spawnBx: number;
  /** 累计推进的正式物理步数（由 `timeMs / FIXED_DT` 派生，供证据链）。 */
  private steps = 0;

  constructor(opts: boolean | RunBattleOptions = false) {
    const o: RunBattleOptions = typeof opts === 'boolean' ? { soloA: opts } : opts;
    this.encounterId = o.encounterId ?? RUN_BATTLE_ENCOUNTER_ID;
    // ⚠️ PRODUCT-LOOP-R1-C：玩家装载的来源在这里分岔，之后**共用同一条**装配 / 校验链路。
    //    `playerDraft` 缺省 ⇒ 既有 Lab 演示装载（逐字节不变）。
    this.plan = o.playerDraft
      ? buildSpawnPlanFromDraft(o.playerDraft, o.playerLoadoutTag ?? 'profile-equipped', this.encounterId)
      : buildSpawnPlan(RUN_BATTLE_LOADOUT_ID, this.encounterId);
    this.build = normalizeBuild(o.build ?? o.modifier ?? null);
    // ⚠️ PRODUCT-LOOP-R2-RECOVERY-ONBOARDING-CLARITY：玩家侧基线（默认关；见 RunBattleOptions）。
    this.playerBaseline = o.playerBaseline === true;

    // ① 本局基准武器 = **玩家实际装备的那一件**（PRODUCT-LOOP-R6-RUN-WEAPON-SOURCE-OF-TRUTH）。
    //    它不再是写死的 cannon：装备 hammer ⇒ 基准就是正式 hammer，registry 以 hammer 的
    //    canonical Def 为 base、snapshot 重映射的也是 hammer 那一件。
    //    车上没有武器 ⇒ null（资格层已拒绝创建 Run；这里如实取 null，绝不静默替换成某件武器）。
    this.runBaseWeaponDefId = resolveRunBaseWeaponDefId(this.plan.player.snapshot);

    // ② 本局 registry = 正式副本（+ Build overlay 部件 + 可选的**玩家侧基线**部件）。
    //    正式 content 单例、正式武器键、敌方部件**全部零修改**。
    this.registry = createRunRegistry(this.build, this.playerBaseline, this.runBaseWeaponDefId);
    // ③ 本局 BuildSnapshot：只把**玩家装载**里基准武器的 defId 指向本局 overlay 部件。
    const playerSnapshot = applyRunModifiersToSnapshot(
      this.plan.player.snapshot,
      this.build,
      this.playerBaseline,
      this.runBaseWeaponDefId,
    );
    // PRODUCT-LOOP-R2-C：留住这一份（steering 之后、交给编排器之前）—— 见 `playerSnapshot` 注释。
    this.playerSnapshot = playerSnapshot;
    // ④ overlay 也必须过正式 BuildValidator（overlay 部件确实存在于本局 registry）。
    const validation = validateSnapshot(playerSnapshot, this.registry);
    if (!validation.valid) {
      throw new Error(`[PRP-F2] 强化后的 Build 非法：${validation.errors.join('；')}`);
    }

    // ⚠️ 空 config：世界尺度 / 出生点 / 阶段全部取正式默认值（PRP 零覆盖）。
    //    ⚠️ PBL-FOUNDATION-RANGED-DISTANCE-CONTROL-R1：**唯一**的例外是「对手 Movement 姿态」，
    //    且它只在**数据源明确声明**时才出现（`LAB_ENCOUNTERS[].enemyDrive === 'keep-distance'`）。
    //    未声明的 Encounter（ProtoRusher / Chaser / Run Script 四场）⇒ 这里仍是 `{}`，
    //    对手驱动与改前**逐帧完全相同**。
    this.orchestrator = new PlanckBattleOrchestrator(
      playerSnapshot,
      this.plan.enemies[0].snapshot,
      this.registry,
      this.plan.enemyDrive === 'keep-distance'
        ? { enemyDrive: ENEMY_KEEP_DISTANCE_BANDS }
        : {},
      o.soloA ?? false,
    );

    // ④ 跨战斗耐久（必改 4）：只写当前 HP，**不动 maxHp** → HUD 耐久条如实显示「打剩多少」。
    const carried = o.carriedHp ?? null;
    if (carried != null && carried > 0) {
      const v = this.orchestrator.vehicleA;
      v.hp = Math.min(carried, v.maxHp);
    }
    // ⚠️ 本场**开局**HP 必须在构造时捕获：此后它会随真实战斗持续下降，
    //    实时读当前值无法证明「开局确实是从上一场剩余耐久继续的」。
    this.initialPlayerHp = this.orchestrator.vehicleA.hp;

    // ⑤ Run 能力订阅（必须晚于跨战斗耐久注入：能力不依赖它，但订阅点越晚越少无谓处理）。
    //
    // ⚠️ 这里实现 `RunAbilityPorts`：Lab 守卫要求**正式编排器只允许本文件引用**
    //    （tests/portraitBattleLab.test.ts 的 R22a-4），因此能力模块只拿到这套极窄端口，
    //    而不是编排器实例本身 → 「PRP ↔ 正式战斗栈」在运行期同样只有本文件相连。
    this.abilities = new RunBuildAbilities(
      {
        subscribe: (fn) => this.orchestrator.onCombatEvent(fn),
        isFinished: () => this.orchestrator.result !== null,
        facingOf: (team) =>
          team === 'A' ? this.orchestrator.vehicleA.facing : this.orchestrator.vehicleB.facing,
        projectileMass: () => readRunProjectileMass(this.orchestrator),
        /**
         * 施加一次真实冲量。
         *
         * `at` = **真实作用点**（世界坐标）→ 直接交给正式 `world.applyLinearImpulse`；
         * 省略 / `null` → 作用在该车自身位置（**当前唯一的能力都传真实作用点**：动能爆发
         * 用命中点 `damage.contactPoint` → 这条兜底分支只是端口的通用语义，
         * 本局不会被走到）。
         * ⚠️ 不在这里做任何「方向修正」或「力度补偿」：方向与大小都是 Run 能力层算好的真实量值。
         */
        applyImpulse: (team, dirX, dirY, magnitude, at) => {
          const world = this.orchestrator.world;
          const vehicle = team === 'A' ? this.orchestrator.vehicleA : this.orchestrator.vehicleB;
          const point = at ?? world.getPosition(vehicle.body);
          world.applyLinearImpulse(
            vehicle.body,
            { x: dirX * magnitude, y: dirY * magnitude },
            { x: point.x, y: point.y },
          );
        },
      },
      this.build,
    );

    /*
      PRODUCT-LOOP-R2-C（Queue 必改 5 的「不要只检查 UI 文字」）｜记录**玩家武器真实打出的伤害**。

      ⚠️ 这是**只读订阅**：不改速度、不扣血、不干预判定（能力层用的是另一个订阅）。
      ⚠️ 只记 `damageSource === 'weapon'`：撞击（impact）/ 地形（hazard）不是「武器伤害」，
         混进来会让「★2 打得更重」这条结论被无关伤害稀释。
      ⚠️ 来源判据用 `ev.source`（队伍）而不是 partId：玩家车上可能有**多件**武器
         （starter 就同时带炮与锤），按 partId 过滤会漏掉「另一件也打中了」的事实；
         分组留给读取方（`playerWeaponHitSummary()` 按 partId 归组）。
    */
    const playerTeam = this.orchestrator.vehicleA.team;
    this.unsubscribeHits = this.orchestrator.onCombatEvent((ev) => {
      if (ev.type !== 'damage') return;
      if (ev.source !== playerTeam) return;
      if (ev.damageSource !== 'weapon') return;
      this.playerWeaponHits.push({
        damage: ev.damage,
        partId: ev.partId ?? '',
        behavior: ev.behavior ?? '',
        atMs: this.orchestrator.timeMs,
      });
    });

    const w = this.orchestrator.world;
    this.spawnAx = w.getPosition(this.orchestrator.vehicleA.body).x;
    this.spawnBx = w.getPosition(this.orchestrator.vehicleB.body).x;
  }

  /** 本场**开局真实 HP**（构造时捕获，注入跨战斗耐久后的实际值，供验收断言）。 */
  readonly initialPlayerHp: number;

  /**
   * 第一层强化（= `build[0]`；单强化口径的兼容访问器，供逐项独立验证断言使用）。
   * 完整 Build 请读 `this.build`。
   */
  get modifier(): RunModifierId | null {
    return this.build[0] ?? null;
  }

  /** 本场 HP 上限（= 正式 resolved body.hp，不因跨战斗耐久改变）。 */
  get playerMaxHp(): number {
    return this.orchestrator.vehicleA.maxHp;
  }

  /** 出生中心距（世界 px）——必须等于正式 800。 */
  get spawnSeparation(): number {
    return Math.abs(this.spawnBx - this.spawnAx);
  }

  get arenaWidth(): number {
    return this.orchestrator.arena.config.width;
  }

  get arenaHeight(): number {
    return this.orchestrator.arena.config.height;
  }

  get groundY(): number {
    return this.orchestrator.arena.config.groundY;
  }

  get result(): BattleResult | null {
    return this.orchestrator.result;
  }

  get phase(): string {
    return this.orchestrator.phase;
  }

  get timeMs(): number {
    return this.orchestrator.timeMs;
  }

  get stepCount(): number {
    return this.steps;
  }

  /** 推进一帧（真实时间 → 内部固定步；与正式 Battle 同一条 `world.step` 语义）。 */
  step(realDtMs: number): void {
    if (realDtMs <= 0) return;
    // ⚠️ PRP-BUILD-01：Run 能力产生的冲量在**固定步开始之前**统一施加（见 runBuildAbilities 文件头）。
    this.abilities.flush();
    const before = this.orchestrator.timeMs;
    this.orchestrator.step(realDtMs, 1);
    if (this.orchestrator.timeMs > before) {
      this.steps += 1;
    }
  }

  /** Run 能力的真实运行状态（诊断 / 验收；全部是真实发生过的计数与量值）。 */
  abilitySnapshot(): RunAbilitySnapshot {
    return this.abilities.snapshot();
  }

  snapshot(): BattleRenderSnapshot {
    return this.orchestrator.getRenderSnapshot();
  }

  /** 车辆中心世界坐标。 */
  vehicleX(team: 'A' | 'B'): number {
    const v = team === 'A' ? this.orchestrator.vehicleA : this.orchestrator.vehicleB;
    return this.orchestrator.world.getPosition(v.body).x;
  }

  /** 车辆真实可见外接框（世界 px）。 */
  vehicleBox(team: 'A' | 'B'): RunBattleBox {
    return vehicleWorldBox(this.snapshot(), team);
  }

  /** 两车外廓世界间距（>0 = 完全分离）。 */
  gapWorld(): number {
    const a = this.vehicleBox('A');
    const b = this.vehicleBox('B');
    return b.minX - a.maxX;
  }

  /**
   * PBL-FOUNDATION-RANGED-DISTANCE-CONTROL-R1｜对手「维持作战距离」的**真实运行状态**。
   *
   * - `null` = 本场对手没装距离档（本套 Encounter 未声明 `enemyDrive`）⇒ 驱动与既有完全相同；
   * - 非 null = 上一步实际生效的决策：`band`（`near` / `hold` / `far`）、决策读到的 `gap`
   *   （**core 口径** = Body + Wheels，与相机取景同源）、以及真正下发给 wheel motor 的
   *   `enabled` / `worldDirection` / `targetSpeedPxPerStep`。
   *
   * ⚠️ 这是**只读回读**（从正式编排器读上一步的决策记录），不重算、不另存一份口径。
   * ⚠️ 注意 `gap` 与 `gapWorld()` 口径不同：后者含 Functional Parts（武器伸出），
   *    前者是相机取景用的 core 口径 —— 两者**不能互相代入**。
   */
  enemyDriveState(): Readonly<
    { band: 'near' | 'hold' | 'far'; gap: number; enabled: boolean; worldDirection: 1 | -1; targetSpeedPxPerStep: number } | null
  > {
    return this.orchestrator.enemyDriveState;
  }

  hp(): RunBattleHp {
    const o = this.orchestrator;
    return { a: o.vehicleA.hp, aMax: o.vehicleA.maxHp, b: o.vehicleB.hp, bMax: o.vehicleB.maxHp };
  }

  /** 当前存活弹丸（真实 projectile 渲染快照，非预测）。 */
  projectileCount(): number {
    return this.snapshot().projectiles?.length ?? 0;
  }

  /**
   * **玩家（A 方）**当前存活弹丸数。
   *
   * ⚠️ 与 `projectileCount()` 分开的意义：`projectileCount()` 是**全场**存活弹丸，
   * 对手自己的武器也会贡献（例如 `PineappleFireBrute` 的喷火器火焰颗粒 `visual: 'flame'`）。
   * 但凡要用「在飞弹丸数增量」反推开火节奏（浏览器 E2E 的 `sampleFireCadence`），
   * 就必须只看玩家这一侧 —— 否则对手的火焰颗粒会把间隔量到几十毫秒，测量直接失效。
   */
  playerProjectileCount(): number {
    const side = this.orchestrator.vehicleA.team;
    return (this.snapshot().projectiles ?? []).filter((p) => p.team === side).length;
  }

  /**
   * PRODUCT-LOOP-R1-C｜本场**真实装配结果**里属于玩家（A 方）的全部 Functional 件，
   * 按**挂点 id** 逐件报告（`PlanckPartRuntime.id` 就是 hardpoint id，不是序号）。
   *
   * 这是「本场真实用了哪件武器」的**唯一可信来源**：
   *   - 读的是正式编排器里**已经装出来的车**（`orchestrator.vehicleA.parts`），
   *     不是读输入参数、不是读 spawn plan、不是按固定槽位猜 ——
   *     输入被改坏 / 装备被替换都会在这里如实暴露（否则「首页显示 A、战斗跑 B」
   *     只能靠人眼看画面发现）。
   *   - **按挂点报**（而不是只给一个「武器 id」）是因为一辆车可以有多件武器
   *     （starter 就同时带 `frontMass` 炮与 `top` 锤）：「本局用的是哪件」只有
   *     「哪个挂点上是哪件」才有确定含义。测试锁因此可以直接比
   *     `frontMass` 上的 defId ↔ Profile Equipped Weapon ID。
   *   - `defId` 是**本局实际生效**的 id：带 Run-local 武器侧强化时它是本局 overlay 部件
   *      （与 `abilities.projectileMass` 同源口径），而不是原始武器 id。
   *
   * ⚠️ 放在本文件而不是调用方：正式编排器只允许本文件引用（R22a-4 的单入口守卫）。
   */
  playerFunctionals(): readonly {
    readonly hardpointId: string;
    readonly defId: string;
    readonly name: string;
    readonly category: string;
  }[] {
    return this.orchestrator.vehicleA.parts.map((part) => ({
      hardpointId: part.id,
      defId: part.def.id,
      name: part.def.name,
      category: part.def.category,
    }));
  }

  /**
   * PRODUCT-LOOP-R2-C｜本场**真实装配**里玩家的全部 **weapon** 件，逐件报告：
   *
   *   - `star`   —— **Battle Runtime Weapon Star**：读 `this.playerSnapshot.functionals[].star`
   *                 （= 真正交给编排器的那份 Build 里、这个挂点上的星级；缺省 = 1★）。
   *                 这是「战斗运行时用了几星」的机器口径，不是产品侧读数的复制品。
   *   - `damage` —— **战斗真正会用的伤害值**：`weaponMainDamage(part.def)`，与
   *                 `ContactRouter` 结算时读的是同一个 `behaviorParams` 字段
   *                 （且 def 已过正式 `resolveSnapshot` 的星级倍率层）。
   *   - `params` —— 该武器全部数值参数（只读快照）⇒ 测试可以逐项证明
   *                 「星级只改了伤害、其余参数一字未动」（Queue 必改 1）。
   *
   * ⚠️ 口径与 `playerFunctionals()` 一致（都读正式编排器里已经装出来的车），差别只在
   *    「只报武器 + 多报星级与伤害」。
   */
  playerWeapons(): readonly {
    readonly hardpointId: string;
    readonly defId: string;
    readonly name: string;
    readonly star: number;
    readonly damage: number;
    readonly behavior: string;
    readonly params: Readonly<Record<string, number>>;
  }[] {
    const starAt = (hardpointId: string): number => {
      const install = this.playerSnapshot.functionals.find((f) => f.hardpointId === hardpointId);
      const raw = install?.star;
      return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
    };
    return this.orchestrator.vehicleA.parts
      .filter((part) => part.def.category === 'weapon')
      .map((part) => ({
        hardpointId: part.id,
        defId: part.def.id,
        name: part.def.name,
        star: starAt(part.id),
        damage: weaponMainDamage(part.def),
        behavior: part.def.behavior,
        params: weaponNumericParams(part.def),
      }));
  }

  /**
   * PRODUCT-LOOP-R2-C｜本场**玩家武器命中的真实伤害**记录（按来源部件归组）。
   *
   * 口径 = 正式 `damage` 事件（`DamageResolver` 真的从对方 HP 减掉的那个数），
   * 只收 `source = 玩家队` 且 `damageSource = 'weapon'` 的那些。
   *
   * 为什么必须按 partId 归组：玩家车上**不止一件**武器（starter 就有炮与锤），
   * 「第一发炮命中打了多少」与「锤子蹭了一下打了多少」是两个不同的数。
   * `damages` 按发生顺序原样保留（不去重、不四舍五入）⇒ 「同一门炮每一发都一样重」
   * 这种结论也能被断言，而不是只能比一个平均数。
   */
  playerWeaponHitSummary(): Readonly<
    Record<string, { readonly count: number; readonly firstAtMs: number; readonly damages: readonly number[] }>
  > {
    const out: Record<string, { count: number; firstAtMs: number; damages: number[] }> = {};
    for (const h of this.playerWeaponHits) {
      const key = h.partId === '' ? '(unknown)' : h.partId;
      let e = out[key];
      if (!e) {
        e = { count: 0, firstAtMs: h.atMs, damages: [] };
        out[key] = e;
      }
      e.count += 1;
      e.damages.push(h.damage);
    }
    return out;
  }

  /**
   * PBL-M3-ENCOUNTER-BATCH｜**接触残留诊断**（只读，无副作用）。
   *
   * 口径 = 正式 `ContactRouter` 自己记录的最后一次接触 / 命中 / 伤害事实。
   * 一个**刚建立**的战斗运行时必须三项全 `false` —— 这就是「上一场的接触没有留下来」
   * 的机器判据（接触状态是运行时的私有事实，随 `dispose()` 一起消失）。
   *
   * ⚠️ 放在本文件而不是调用方：正式编排器只允许本文件引用（R22a-4 的单入口守卫），
   *    验收入口因此只拿到这套极窄只读端口，而不是编排器实例。
   */
  contactResidue(): { contact: boolean; impact: boolean; damage: boolean } {
    const d = this.orchestrator.router.debug;
    return {
      contact: d.lastContact !== null,
      impact: d.lastImpact !== null,
      damage: d.lastDamage !== null,
    };
  }

  dispose(): void {
    // PRODUCT-LOOP-R2-C：命中记录订阅必须随运行时一起撤（否则旧场次的记录会跟着新场次活着）
    this.unsubscribeHits();
    this.abilities.dispose();
    this.orchestrator.dispose();
  }
}
