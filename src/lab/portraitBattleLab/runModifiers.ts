/**
 * PRP-F2-FIRST-REAL-UPGRADE-LOOP｜Run-local 强化 overlay（唯一的 Modifier 接缝）。
 *
 * ## 为什么是这个接缝（必改 1 的「先查」结论）
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
 *   - `src/battle/cannonBehavior.ts:68` `readCannonParams(part)` 只读 `part.def.behaviorParams`
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
 * ## 本 Queue 只做 Cannon 三选一（必改 2）
 *
 * 三项都必须在下一场战斗**肉眼可辨**，且都通过**官方真实物理**表达，不做视觉假弹：
 *
 *   | 选项 | 自然因果 | overlay 改了什么 | 用哪套正式 Behavior |
 *   |---|---|---|---|
 *   | A 重型弹头 | 炮弹更重 → 推得更狠、自己也退得更狠 | `projectileRadius 10→16` / `projectileMass 1→4` / `recoilImpulse 30→90` | 正式 `cannon` |
 *   | B 双联炮 | 一次攻击极短间隔连续两发 | `burstRounds 1→2` + `burstIntervalMs 0→100` | 正式 `cannon`（PRP-F2-R1 新增的**可选 burst 参数**） |
 *   | C 快速装填 | 开炮节奏明显变快 | `cooldownMs 1000→400` | 正式 `cannon` |
 *
 * ## PRP-F2-R1：B 双联炮从 shotgun workaround 改成真实 burst
 *
 * 第一版曾复用官方 `shotgun` 的 `fanAnglesDeg`（**同时**齐射两发）。真人录像判定**不通过**：
 * 两发弹丸在正常速度下轨迹高度重叠，玩家无法自然理解为「双联炮」。
 *
 * 因此本 Queue 授权做了**一次最小共享 Foundation**（细节见 `src/battle/cannonBehavior.ts` 文件头）：
 * 给正式 Cannon 补两个**可选**参数 —— `burstRounds`（默认 `1`）/ `burstIntervalMs`（默认 `0`）。
 *   - 正式 `content.ts` 的 Cannon 定义**不写**这两个字段 → 走默认值 → 正式武器平衡零变化；
 *   - `behavior` 仍是正式 `cannon` → 渲染标记就是正式炮弹（不再借用 shotgun 的 `'tracer'`）；
 *   - B 只声明 `burstRounds: 2` / `burstIntervalMs: 100` → **弹道同向**，靠**时间差**产生可感知性
 *     （不用大散射把两发强行分开）；
 *   - 两发都走同一条 `fire()` → 真实 projectile / 碰撞 / 伤害 / recoil / 生命周期，无视觉假弹。
 */

import { createRegistry } from '../../core/content';
import type { BuildSnapshot, ContentRegistry, FunctionalPartDef } from '../../core/types';

/** 本 Queue 的三个 Cannon 强化（固定、不随机、无稀有度、无升级树）。 */
export type RunModifierId = 'heavyShell' | 'twinCannon' | 'fastReload';

/** overlay 的**基准部件** = 正式 Cannon。本 Queue 不改动它，只以它为基准派生本局变体。 */
export const RUN_BASE_WEAPON_DEF_ID = 'cannon';

export interface RunModifierDef {
  readonly id: RunModifierId;
  readonly label: string;
  /** 一句结果（玩家可读，不是数值表）。 */
  readonly note: string;
  /** 选择后写入冒险日志的自然语言（必改 3）。 */
  readonly logText: string;
}

export const RUN_MODIFIERS: readonly RunModifierDef[] = [
  {
    id: 'heavyShell',
    label: '重型弹头',
    note: '炮弹更重，撞击和后坐都更明显',
    logText: '你为大炮装上了重型弹头。',
  },
  {
    id: 'twinCannon',
    label: '双联炮',
    note: '一次开火连续打出两发炮弹',
    logText: '你为大炮加装了一门副炮。',
  },
  {
    id: 'fastReload',
    label: '快速装填',
    note: '开炮节奏明显变快',
    logText: '你改进了大炮的装填机构。',
  },
];

export function runModifierById(id: string): RunModifierDef | undefined {
  return RUN_MODIFIERS.find((m) => m.id === id);
}

/* ------------------------------------------------------- overlay 数值表 */

/**
 * 单个强化的 overlay：只声明**被强化语义覆盖的那几个字段**，其余字段一律沿用正式 Cannon。
 *
 * `behavior` 字段保留（三项当前**都是**正式 `cannon`）—— 留作将来「换武器基座」的扩展点。
 * PRP-F2-R1 之后，「一次攻击打几发」由 Cannon 自己的可选 `burstRounds` 表达，
 * 不再需要为了多弹丸去换 behavior。
 */
export interface RunModifierOverlay {
  readonly behavior: string;
  readonly behaviorParams: Readonly<Record<string, number | number[]>>;
  /** 人类可读的因果说明（进交接文档与测试断言，不参与运行时）。 */
  readonly cause: string;
}

/**
 * 冻结的 overlay 数值表（第一版刻意做大差异，优先验证方向）。
 *
 * ⚠️ 这里**没有** `muzzleSpeed` / 部件 `mass` / `energy` —— 强化不改变弹道速度，
 * 也不改变车辆装配（总质量 / 能量 / 挂点全部不动）→ 「Base vehicle 冻结」。
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
  },
  twinCannon: {
    // PRP-F2-R1：改成正式 Cannon 的**真实连发**（不再借用 shotgun 齐射）。
    // 只声明这两个参数 —— 伤害 / 射速 / 弹速 / 半径 / 质量 / 后坐**全部沿用正式 Cannon**，
    // 因此每发都是完整炮弹；两发弹道同向，靠 100ms 时间差产生「连续两发」的可感知性。
    behavior: 'cannon',
    behaviorParams: { burstRounds: 2, burstIntervalMs: 100 },
    cause: '一次攻击连续打出两发真实炮弹（同向、极短间隔）',
  },
  fastReload: {
    // 只改本局当前 Cannon 的攻击间隔；其它一律不动。
    behavior: 'cannon',
    behaviorParams: { cooldownMs: 400 },
    cause: '开炮节奏明显变快',
  },
};

/** 本局专用部件 id（带前缀 → 不会撞上任何正式 defId）。 */
export function runOverlayDefId(mod: RunModifierId): string {
  return `run.mod.${mod}`;
}

/** 以正式 Cannon 为基准派生本局变体（浅合并 behaviorParams，未声明字段一律保留正式值）。 */
export function applyRunModifierOverlay(base: FunctionalPartDef, mod: RunModifierId): FunctionalPartDef {
  const o = RUN_MODIFIER_OVERLAY[mod];
  return {
    ...base,
    behavior: o.behavior,
    behaviorParams: { ...base.behaviorParams, ...o.behaviorParams },
  };
}

/* --------------------------------------------------- 本局 registry / 快照 */

/**
 * 造一份**本局专用 registry**（正式 `createRegistry()` 的独立副本）。
 *
 * - `mod === null`（未选择强化）→ 直接返回正式副本，行为与现状完全一致；
 * - 有强化 → 额外注册一个 `run.mod.<id>` 部件，**正式 `cannon` 键仍在副本里保持原值**
 *   （因此可以逐字段对拍「正式定义未被改写」）。
 */
export function createRunRegistry(mod: RunModifierId | null): ContentRegistry {
  const reg = createRegistry();
  if (!mod) return reg;
  const base = reg.functionals.get(RUN_BASE_WEAPON_DEF_ID);
  if (!base) {
    throw new Error(`RunModifier: 正式 registry 缺少基准武器 "${RUN_BASE_WEAPON_DEF_ID}"`);
  }
  reg.functionals.set(runOverlayDefId(mod), applyRunModifierOverlay(base, mod));
  return reg;
}

/**
 * 把本局 BuildSnapshot 里**基准武器**的 `defId` 重映射到本局 overlay 部件。
 *
 * 只动 `defId` 一个字段 → 挂点 / 星级 / 装配 / 其它部件全部原样；
 * 找不到基准武器时**显式抛错**（不静默跳过，否则「选了强化但没生效」会变成静默失败）。
 */
export function applyRunModifierToSnapshot(
  snapshot: BuildSnapshot,
  mod: RunModifierId | null,
): BuildSnapshot {
  if (!mod) return snapshot;
  const overlayId = runOverlayDefId(mod);
  let touched = false;
  const functionals = snapshot.functionals.map((install) => {
    if (install.defId !== RUN_BASE_WEAPON_DEF_ID) return install;
    touched = true;
    return { ...install, defId: overlayId };
  });
  if (!touched) {
    throw new Error(
      `RunModifier: 本局装载里没有 "${RUN_BASE_WEAPON_DEF_ID}"，无法注入强化 "${mod}"`,
    );
  }
  return { ...snapshot, functionals };
}
