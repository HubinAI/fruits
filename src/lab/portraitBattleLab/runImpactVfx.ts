/**
 * PRP-BUILD-01-R1-KINETIC-IMPACT-PERCEPTIBILITY｜动能爆发的**极简命中反馈**（冲击环）。
 *
 * ## 这个模块解决什么
 *
 * 真人验收：`重型弹头 + 动能爆发` 与 `只有重型弹头` 的最终战斗区别不明显 —— 玩家感知不到
 * 「这一炮命中后又产生了一次额外动能冲击」。物理量本身已经真实存在（见 `runBuildAbilities.ts`），
 * 缺的是**因果定位**：观众不知道「额外冲击发生在哪一刻、哪一点」。
 *
 * 因此这里只做一件事：在**真实 trigger 的真实命中点**上，画一个**很短**的冲击环，
 * 把「额外冲击就是在这一刻发生的」标出来。
 *
 * ## 纪律（Queue 必改 3 + 禁止项）
 *
 *   - **短**：总寿命 `RUN_IMPACT_RING_MS`（≈0.28s），到期即完全消失；
 *   - **只在真实 trigger 时出现**：形状函数只被「动能爆发真实命中」驱动，不存在待机 / 循环动画；
 *   - **位置来自真实 hit position**：调用方传入的坐标就是 `damage.contactPoint`
 *     （与冲量的真实作用点**同源**），模块自身不推算、不猜测、不偏移；
 *   - **不做大爆炸**：只有细描边圆环 + 一个极小的核心亮点，无粒子、无填充色块、无屏震；
 *   - **不遮挡车辆**：外环从命中点向外扩张，环内**不填充**，描边宽度随寿命递减，
 *     峰值不透明度 < 1 且在 ~0.1s 内就扩到车辆局部轮廓之外。
 *
 * ⚠️ 它**不是**用特效替代物理：本模块只有几何与透明度，不接触任何物理量；
 *    真实位移 / 旋转由 `runBuildAbilities` 的真实冲量产生（两者互不依赖）。
 *
 * 纯函数（无 DOM / 无时间源）→ node 侧可直接冻结断言。
 */

/** 冲击环总寿命（ms）。Queue 要求「短」→ 不到 0.3s。 */
export const RUN_IMPACT_RING_MS = 280;

/** 外环起点 / 终点半径（舞台带逻辑 px）。 */
export const RUN_IMPACT_RING_MIN_R = 4;
export const RUN_IMPACT_RING_MAX_R = 30;

/** 命中点核心亮点寿命（ms）—— 比外环更短，负责「就是这一点」。 */
export const RUN_IMPACT_CORE_MS = 140;

/** 第二道内环的起始延迟（ms）→ 两道错开，读作「一次冲击」，而不是一个气泡。 */
export const RUN_IMPACT_RING_INNER_DELAY_MS = 60;

/** 一道环的绘制几何。 */
export interface RunImpactRingShape {
  readonly radius: number;
  readonly alpha: number;
  readonly lineWidth: number;
}

/** 核心亮点几何。 */
export interface RunImpactCoreShape {
  readonly radius: number;
  readonly alpha: number;
}

/** 加速外扩（快起缓收）→ 第一帧就有明显扩张，避免「慢慢长大」被当成常态动画。 */
function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 冲击环形状：`ageMs` = 距离**真实命中**已经过去的毫秒数（`rt.timeMs - 触发时 rt.timeMs`）。
 *
 * - `ageMs < 0` 或超过寿命 → `[]`（结构上不可能画出一个「没有触发过的环」）；
 * - 返回 1~2 道环（第二道延迟 `RUN_IMPACT_RING_INNER_DELAY_MS` 出现）；
 * - 半径单调递增、透明度单调递减（可冻结断言）。
 */
export function runImpactRingShapes(ageMs: number): readonly RunImpactRingShape[] {
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > RUN_IMPACT_RING_MS) return [];
  const t = clamp01(ageMs / RUN_IMPACT_RING_MS);
  const e = easeOut(t);
  const out: RunImpactRingShape[] = [
    {
      radius: RUN_IMPACT_RING_MIN_R + (RUN_IMPACT_RING_MAX_R - RUN_IMPACT_RING_MIN_R) * e,
      alpha: (1 - t) * 0.8,
      lineWidth: 2.4 - 1.5 * t,
    },
  ];
  const innerAge = ageMs - RUN_IMPACT_RING_INNER_DELAY_MS;
  if (innerAge >= 0 && innerAge <= RUN_IMPACT_RING_MS) {
    const t2 = clamp01(innerAge / RUN_IMPACT_RING_MS);
    const e2 = easeOut(t2);
    const innerMax = RUN_IMPACT_RING_MIN_R + (RUN_IMPACT_RING_MAX_R - RUN_IMPACT_RING_MIN_R) * 0.55;
    out.push({
      radius: RUN_IMPACT_RING_MIN_R + (innerMax - RUN_IMPACT_RING_MIN_R) * e2,
      alpha: (1 - t2) * 0.45,
      lineWidth: 1.6 - 1.0 * t2,
    });
  }
  return out;
}

/**
 * 命中点核心亮点：更短、更小，只负责把「这一刻 / 这一点」钉住。
 * 超过 `RUN_IMPACT_CORE_MS` → `null`。
 */
export function runImpactCoreShape(ageMs: number): RunImpactCoreShape | null {
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > RUN_IMPACT_CORE_MS) return null;
  const t = clamp01(ageMs / RUN_IMPACT_CORE_MS);
  return { radius: 3.2 - 1.9 * t, alpha: (1 - t) * 0.9 };
}
