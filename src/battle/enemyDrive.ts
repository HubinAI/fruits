/**
 * Enemy Drive Foundation（Queue PBL-FOUNDATION-RANGED-DISTANCE-CONTROL-R1）。
 *
 * ── 为什么需要这一层（Queue 必改 1 的调查结论）────────────────────────────
 *
 * 正式编排器里，B 侧（对手）的驱动是**写死的常量**：
 *
 *     drivePlanckVehicle(world, vehicleB, {
 *       enabled: true,
 *       worldDirection: -1,                          // ← 恒朝玩家
 *       targetSpeedPxPerStep: 1.5,
 *     });
 *
 * 也就是说：「往哪开」这个**决策**在正式战斗栈里根本不存在 —— 只有「开 / 不开」一个布尔。
 * 于是任何**远程**敌人都必然全速贴脸，远程身份在几秒内退化成近战碰撞。
 * 本模块补上的正是这一层：**由空间距离决定「往哪开、开多快」**。
 *
 * ⚠️ 本模块**只做决策**，不产生任何位移：
 *    它输出 `enabled` / `worldDirection` / `targetSpeedPxPerStep` 三个量，交给既有正式
 *    Movement 接口 `drivePlanckVehicle`（wheel motor + 真实 grip + 真实牵引）执行。
 *    因此**不存在**瞬移 / 无敌 / 碰撞墙 / 强制位置修正 / 接近即弹开 —— 全部移动仍由正常
 *    车辆动力产生；玩家真实物理推进（撞击 / 冲量）照样能把敌人推走、掀翻。
 *
 * ⚠️ 引擎中立：本文件不使用任何 Matter / Planck / adapter 类型或对象，与
 *    `battleContract.resolveDriveEnable` 同一类别（纯决策，可单测）。
 */

/**
 * 三段距离档的参数（**粗档**，Queue 必改 2：只找近 / 中 / 远三个明显区间，不做 10% 级扫描）。
 *
 * 单位一律为**世界 px**（两车外廓间距 gap：>0 = 完全分离，0 = 刚好接触，<0 = 已重叠）。
 */
export interface EnemyDriveBands {
  /** 近档上限：`gap < near` → 主动**后撤**拉开。 */
  readonly near: number;
  /** 远档下限：`gap > far` → 主动**接近**（= 既有 autoDrive 行为）。 */
  readonly far: number;
  /** 后撤时的目标线速度（px/step，>0）。前撤以外的档位不受它影响。 */
  readonly retreatSpeed: number;
}

/** 当前所处的距离档（诊断 / 断言用；不参与决策本身）。 */
export type EnemyDriveBand = 'near' | 'hold' | 'far';

export interface EnemyDriveContext {
  /**
   * 双方**真实外廓间距**（世界 px）= `max(coreA.minX, coreB.minX) - min(coreA.maxX, coreB.maxX)`。
   *
   * ⚠️ 口径与正式相机取景**同源**（`renderer.ts` 的 `gapWorld`，core = Body + Wheels、不含
   *    Functional Parts），于是「换档」与「相机三段取景」由**同一个量**驱动，不会互相打架。
   */
  readonly gap: number;
  /** 对手相对自车在 world x 上的方位：`+1` = 对手在 +x 侧，`-1` = 对手在 -x 侧。 */
  readonly targetSide: 1 | -1;
}

export interface EnemyDriveDecision {
  readonly band: EnemyDriveBand;
  /** `false` = 本步不给油（motor 关闭；沿用 `drivePlanckVehicle` 既有 enabled:false 语义，不刹停）。 */
  readonly enabled: boolean;
  /** `+1` 朝 world +x、`-1` 朝 world -x。 */
  readonly worldDirection: 1 | -1;
  readonly targetSpeedPxPerStep: number;
}

/**
 * **默认三段档**（Queue 必改 2：阈值由「当前 world / weapon 有效距离」取粗档）。
 *
 * 推导（只用两个已存在的公开数值，不新增任何战斗数值）：
 *
 *   | 事实 | 值 | 来源 |
 *   |---|---|---|
 *   | 炮口初速 | **8 px/step** | `content.cannon.behaviorParams.muzzleSpeed` |
 *   | 炮冷却 | **1000ms = 60 步** | `content.cannon.behaviorParams.cooldownMs` |
 *   | ⇒ 一次冷却内弹道行程 | **480 px** | 8 × 60 |
 *
 * 于是取两档（**1× 与 0.5× 这个行程**，即「一轮冷却打不满」与「弹道优势已丧失」）：
 *
 *   - `far  = 480` → 超过一轮冷却的弹道行程 ⇒ 打不到 ⇒ 需要**接近**；
 *   - `near = 240` → 只剩半个行程 ⇒ 远程身份已失效 ⇒ 需要**拉开**；
 *   - 两者之间 = **合理射程**（240–480）⇒ **不主动接近**（减速滑行）。
 *
 * `retreatSpeed = 2.6`：后撤必须**明显快于**对手的正常推进速度（正式 `autoDrive` 目标
 * 1.5 px/step，实测玩家可达 ≈1.5），否则「后撤」与「玩家推进」会互相抵消 —— 相机跟双方
 * 中点，屏幕上净位移 ≈ 0，人眼看到的只是轮子空转（本项目的已知头号可感知性陷阱）。
 * 2.6 使净拉开速率 ≈ 1.1 px/step ≈ 66 px/s：约 3 秒能拉开 200px，属于**肉眼可读**的量。
 * ⚠️ 它仍然只是 wheel motor 的目标速度（受真实 grip / 摩擦 / rpm 上限约束），不是位置修正。
 */
export const ENEMY_KEEP_DISTANCE_BANDS: EnemyDriveBands = Object.freeze({
  near: 240,
  far: 480,
  retreatSpeed: 2.6,
});

/** `far` 档的接近速度 = 调用方的既有 autoDrive 常量（由调用方传入，本模块不复制该数值）。 */
export function decideEnemyDrive(
  ctx: EnemyDriveContext,
  bands: EnemyDriveBands,
  approachSpeedPxPerStep: number,
): EnemyDriveDecision {
  if (!Number.isFinite(ctx.gap)) {
    throw new Error(`EnemyDrive: gap 必须为有限值（收到 ${ctx.gap}）`);
  }
  const towards = ctx.targetSide;
  const away: 1 | -1 = towards === 1 ? -1 : 1;

  // 过远 → 接近（与既有 autoDrive 逐项相同：同方向、同目标速度）
  if (ctx.gap > bands.far) {
    return {
      band: 'far',
      enabled: true,
      worldDirection: towards,
      targetSpeedPxPerStep: approachSpeedPxPerStep,
    };
  }
  // 过近 → 反向拉开
  if (ctx.gap < bands.near) {
    return {
      band: 'near',
      enabled: true,
      worldDirection: away,
      targetSpeedPxPerStep: bands.retreatSpeed,
    };
  }
  // 合理射程 → 不主动接近（motor 关闭；真实物理仍可被推动 / 掀翻）
  return {
    band: 'hold',
    enabled: false,
    worldDirection: towards,
    targetSpeedPxPerStep: approachSpeedPxPerStep,
  };
}
