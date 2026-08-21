/**
 * Fire Jet 纯构建器（Q14-B-R2-FINAL）：喷火器表现层。
 *
 * 真实火焰 projectile 群决定「一整股连续火流」的外形：
 * - 根部 = 真实 muzzle world point（由 Runtime 透出，复用 weaponProjectile 真实炮口纯计算，
 *   本模块不在 Renderer 复制另一套公式）；
 * - 主轴 = 武器真实前向 fireDir（spread 之前的前向，稳定不抖）；
 * - 长度 = 存活 flame projectile 沿前向的最大 forward 距离 + 很小视觉余量；
 * - 半宽 = 存活 flame projectile 最大 |side| + 火焰视觉余量（真实 spread 决定火流宽度）。
 *
 * 视觉不允许跑到真实 projectile 群之外很远：长度/半宽都以真实 projectile 群为硬边界 + 小余量。
 * 单发 projectile 全灭 → 返回 null → 不绘制（喷火停止同步消失）。
 *
 * 纯函数、零 Canvas / 零 Gameplay 依赖，便于单测（与 F-PRESENT-1 DamageNumberAggregator 同思路）。
 */
export interface FireJetInput {
  /** 真实 projectile 世界中心 */
  center: { x: number; y: number };
  /** 真实 muzzle world point（根部） */
  muzzle: { x: number; y: number };
  /** 武器真实前向单位向量（spread 之前） */
  fireDir: { x: number; y: number };
}

export interface FireJet {
  /** 根部 world point */
  muzzleX: number;
  muzzleY: number;
  /** 归一化前向单位向量 */
  dirX: number;
  dirY: number;
  /** 垂直单位向量（前向逆时针 90°） */
  perpX: number;
  perpY: number;
  /** 火流长度（world px）= 最远前向距离 + 视觉余量 */
  length: number;
  /** 火流半宽（world px）= 最大 |side| + 火焰视觉余量 */
  halfWidth: number;
}

/** 朝前向的视觉余量（world px）：让火流自然伸到最远 projectile 前一点点，但不远飘 */
export const FIRE_JET_LENGTH_MARGIN = 8;
/** 火焰横向视觉余量（world px）：让火流包住最外侧 spread projectile 再宽一点点 */
export const FIRE_JET_SIDE_MARGIN = 7;
/** 视觉长度硬上限（world px）：真实配置理论最大射程 ≈ muzzleSpeed(10)×lifetime(20)=200，
 *  此处 210 仅为极保守安全夹，正常由真实 projectile 群决定、不会触发。 */
export const FIRE_JET_MAX_LENGTH = 210;

/**
 * 由一组「同武器」火焰 projectile 构建一整股连续 Fire Jet。
 * @param flames 同一 muzzle 的火焰 projectile（调用方按 muzzle 分组后传入）
 * @returns 单股 Fire Jet；空组 / 全部在 muzzle 后方 → null（不绘制）
 */
export function buildFireJet(flames: readonly FireJetInput[]): FireJet | null {
  if (flames.length === 0) return null;
  const ref = flames[0]!;
  const mx = ref.muzzle.x;
  const my = ref.muzzle.y;
  // 归一化前向
  const dl = Math.hypot(ref.fireDir.x, ref.fireDir.y) || 1;
  const fx = ref.fireDir.x / dl;
  const fy = ref.fireDir.y / dl;
  // 垂直（前向逆时针 90°）
  const px = -fy;
  const py = fx;

  let maxForward = 0;
  let maxSide = 0;
  for (const f of flames) {
    const rx = f.center.x - mx;
    const ry = f.center.y - my;
    const forward = rx * fx + ry * fy;
    const side = rx * px + ry * py;
    if (forward < 0) continue; // 只取 muzzle 前方真实 projectile
    if (forward > maxForward) maxForward = forward;
    const absSide = Math.abs(side);
    if (absSide > maxSide) maxSide = absSide;
  }
  if (maxForward <= 0) return null; // 没有任何前方 projectile → 无火流

  let length = maxForward + FIRE_JET_LENGTH_MARGIN;
  if (length > FIRE_JET_MAX_LENGTH) length = FIRE_JET_MAX_LENGTH;
  const halfWidth = maxSide + FIRE_JET_SIDE_MARGIN;
  return { muzzleX: mx, muzzleY: my, dirX: fx, dirY: fy, perpX: px, perpY: py, length, halfWidth };
}
