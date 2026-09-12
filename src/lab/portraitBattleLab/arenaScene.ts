/**
 * PBL-A1｜Arena A 真实场景组装（纯函数，无 DOM / 无 Canvas / 无副作用）。
 *
 * 与 `scene.ts` 的**占位**舞台同构（同样输出 `LayeredRect[]`，数组顺序 = 绘制顺序），
 * 区别在几何来源：
 *   - `scene.ts`：由 SpawnPlan 里的实体外形在**占位站位**上排布（Arena B 仍走这条）；
 *   - 本文件：直接取 Arena A Runtime 的**真实物理快照** —— 四边边界墙的真实几何 +
 *     每辆车全部 collider 的**真实世界姿态外接框**。因此「看到的就是物理在跑的」，
 *     不存在第二套坐标或第二套站位。
 *
 * 渲染约定（沿用 PBL-F1 的不变约定，保证像素面积可精确断言）：
 *   1) 只画**多边形** collider 的世界外接矩形，整数取整、不做旋转、不做抗锯齿
 *      → 没有半透明边缘，`paintedAreas` 的预测与浏览器真实像素 1px 级一致；
 *   2) 圆盘 collider（轮组）**不参与**像素面积账本（轮组仍真实存在于物理与
 *      `shapes` 判定中，只是不进入像素分类）；
 *   3) 顶部队列 HUD 带内不出现任何分层几何（见 `assertArenaASceneSafe`）。
 *
 * 出生姿态为 ±90°，此时「外接框 == 真实占位」（零膨胀）；运行中车辆姿态任意，
 * 外接框是真实几何的保守外包 —— 这是 Lab 占位渲染的已知取舍，本 Queue 不做视觉 polish。
 */
import type { LabArenaId } from './constants';
import { HUD_BAND_H, type LayeredRect, type Rect } from './layout';
import { ARENA_A_HUD_CLEARANCE, arenaAWallRects, type ArenaAView } from './arenaA';

/** Arena A 场景：边界墙（layer='arena'）+ 玩家 / 敌方的车身与功能件（真实姿态外接框）。 */
export function arenaAScene(view: ArenaAView): LayeredRect[] {
  const shapes: LayeredRect[] = [];

  // 边界墙（真实物理墙体的同一几何来源）
  for (const r of arenaAWallRects()) shapes.push({ layer: 'arena', rect: r });

  for (const e of view.entities) {
    const bodyLayer = e.team === 'A' ? 'playerBody' : 'enemyBody';
    const partLayer = e.team === 'A' ? 'playerPart' : 'enemyPart';
    for (const s of e.shapes) {
      if (s.shape !== 'polygon') continue; // 圆盘（轮组）不进入像素账本
      shapes.push({ layer: s.owner === 'body' ? bodyLayer : partLayer, rect: s.rect });
    }
  }
  return shapes;
}

/**
 * Arena A 场景是否满足像素账本前提（HUD 带内无任何分层几何）。
 * 硬约束 = 所有几何都在 `HUD_BAND_H + ARENA_A_HUD_CLEARANCE` 之下，
 * 与「HUD 带排除区」的判定口径完全一致（E2E 像素统计用同一阈值）。
 */
export function arenaASceneViolations(view: ArenaAView): Rect[] {
  return arenaAScene(view)
    .filter((s) => s.rect.y < HUD_BAND_H + ARENA_A_HUD_CLEARANCE)
    .map((s) => s.rect);
}

/**
 * 当前应绘制的场景：Arena A 走真实运行时快照，其余 Arena 走 F1 占位舞台。
 * 由调用方（lab.ts）传入 Arena A 快照；`null` 表示当前不是 Arena A。
 */
export function sceneForArena(
  arena: LabArenaId,
  arenaAView: ArenaAView | null,
  placeholder: () => LayeredRect[],
): LayeredRect[] {
  if (arena === 'A') {
    if (!arenaAView) throw new Error('[PBL-A1] Arena A 场景需要运行时快照（view 为 null）');
    return arenaAScene(arenaAView);
  }
  return placeholder();
}
