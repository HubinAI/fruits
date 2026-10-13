/**
 * DEMO-HEIGHT-LINE-VISUAL-LAB-R1｜**车高 × 水平弹道** 对照台的纯数据层
 *（无 DOM / 无 Canvas / 无物理 / 无存储）。
 *
 * ── 本页只回答一个问题（Queue 目标）─────────────────────────────────────────
 *
 *   DEMO-DOMINANT-BUILD-ROOT-R1 用可运行矩阵证明：`RangedTurret`（OPP-03）的水平机枪
 *   弹线约在 `y≈641`，而 `mangoBody`+`smallWheel` 的车顶约在 `y≈645`（弹从车顶掠过、
 *   0 命中），换成重轮 / 大轮后车顶降到 `y≈637 / 631`（同一弹线打得到车、41 命中）。
 *
 *   ⚠️ 但「屏幕上只差 ~4px」这件事，**代码无法回答真人能不能看出来**。
 *   因此本 Lab 的目标不是再证明一次矩阵，而是做一个**正常速度、不靠解释**的最小对照：
 *
 *       同一个车身 · 同一门炮 · 同一个对手 · **只换轮径** → 直接看真实弹道与受击。
 *
 * ── 三套配置的「合法性」从哪来（Queue 必改 2）──────────────────────────────
 *
 *   三套配置**等价于**「全新账号走正式装配链能得到的结果」：
 *
 *       openGrowthSession(defaultPlayerDraft())          // 正式初始化 + 一次性种子
 *         → equipBody('mangoBody')                       // 正式 Body 写入口
 *         → equipWeapon('cannon')                        // 正式 Weapon 写入口
 *         → equipMovement('front'|'rear', <wheel>)       // 正式 Movement 写入口
 *
 *   ⚠️ 该链路的三条判据（挂点合法性 / Energy 容量 / **库存拥有**）全部由
 *      `src/product/playerLoadout` 的写入口在真实存档上裁决 —— 本页**不注入任何 Debug 权限**。
 *   ⚠️ `frontWheelDefId` / `rearWheelDefId` 就是那次装配的**真实产出**
 *      （连同 `frontRadius` / `rearRadius` = 该轮组 def 自身的 `radius`），
 *      因此下面这三份 `BuildDraft` 是**实测快照**而不是手写常量。
 *
 *   ⚠️ **为什么本模块在 Lab 目录里、而不是在页面运行时现场调装配链**：
 *      `tests/portraitBattleLab.test.ts` 的 **R22a** 守卫把 Lab 目录的 import 面
 *      冻结成一张**显式白名单**，并且**整目录禁止**触碰 `platform/**`（唯一例外
 *      `playerViewport`）—— 而 `equipMovement` 必须读库存 ⇒ 必须经 `platform.storage`。
 *      即：Lab 页面**结构上无法**（也不应该）读写真人的存档。
 *      ⇒ 合法性的机器证据放在测试侧（`tests/portraitHeightLineLab.test.ts` 用
 *      `MemStorage` 桩跑**同一条正式装配链**，断言它逐字段等于下面这三份快照），
 *      页面只消费快照、零存储访问。这是**登记式的边界遵守**，不是放宽守卫。
 *
 * ── 硬边界（写进代码，避免以后被误用）──────────────────────────────────────
 *   - **不新增敌人**：对手固定为既有 `RangedTurret`（`LAB_ENCOUNTERS` 里的既有条目，
 *     正式模板 OPP-03），本文件不复制它的任何数值；
 *   - **不改任何数值**：车身 / 炮 / 轮径 / 敌人 HP / 伤害 / 速度 / 物理参数一个字节不动；
 *   - **不接入正式 Run**：本页只在独立 Lab 里跑单场对照。
 */

import type { BuildDraft } from '../buildEditorModel';
import { registry } from '../../core/content';
import { RUN_PAGE_H, RUN_PAGE_W } from './runPageLayout';
import { LAB_ENCOUNTERS } from './testData';

/** 三套配置的 id（页面 / 测试 / 探针共用，不各写一份）。 */
export type HeightLineConfigId = 'mango-small' | 'mango-heavy' | 'mango-large';

export interface HeightLineConfigDef {
  readonly id: HeightLineConfigId;
  /** 控件文案（只写**事实**：轮径 —— 不写「会赢 / 会输」这类判定提示）。 */
  readonly label: string;
  /** 本配置唯一变动的那个维度（前后轮同款同一 id）。 */
  readonly wheelDefId: string;
  /**
   * 正式装配链的**实测产出**（`BuildDraft`）。
   * ⚠️ 不得手改：`tests/portraitHeightLineLab.test.ts` 会用正式装配链重新生成并逐字段比对。
   */
  readonly draft: BuildDraft;
}

/**
 * 对手：**既有** `RangedTurret`（OPP-03）。
 *
 * ⚠️ 不是新敌人、不是新数值 —— 只是 `LAB_ENCOUNTERS` 里那条既有条目的引用
 *    （加载时校验存在性，缺失即抛错，不静默换别的对手）。
 */
export const HEIGHT_LINE_OPPONENT_ID = 'RangedTurret';

/** 玩家装载标签（写进 spawn plan 的 `loadoutId`，只用于证据链，不参与任何数值）。 */
export const HEIGHT_LINE_LOADOUT_TAG = 'height-line-lab';

/**
 * 三套配置（Queue 必改 2 点名的两组 + 可选增强车高的第三组）。
 *
 * 顺序 = 车顶**由高到低**（small 12 → heavy 20 → large 26），便于对照观察。
 */
export const HEIGHT_LINE_CONFIGS: readonly HeightLineConfigDef[] = [
  {
    id: 'mango-small',
    label: '前后小轮 r12',
    wheelDefId: 'smallWheel',
    draft: {
      bodyDefId: 'mangoBody',
      rearRadius: 12,
      frontRadius: 12,
      functionalSelections: { front: 'none', frontMass: 'cannon', top: 'none', rear: 'none' },
      drive: 'forward',
      frontWheelDefId: 'smallWheel',
      rearWheelDefId: 'smallWheel',
    },
  },
  {
    id: 'mango-heavy',
    label: '前后重轮 r20',
    wheelDefId: 'heavyWheel',
    draft: {
      bodyDefId: 'mangoBody',
      rearRadius: 20,
      frontRadius: 20,
      functionalSelections: { front: 'none', frontMass: 'cannon', top: 'none', rear: 'none' },
      drive: 'forward',
      frontWheelDefId: 'heavyWheel',
      rearWheelDefId: 'heavyWheel',
    },
  },
  {
    id: 'mango-large',
    label: '前后大轮 r26',
    wheelDefId: 'largeWheel',
    draft: {
      bodyDefId: 'mangoBody',
      rearRadius: 26,
      frontRadius: 26,
      functionalSelections: { front: 'none', frontMass: 'cannon', top: 'none', rear: 'none' },
      drive: 'forward',
      frontWheelDefId: 'largeWheel',
      rearWheelDefId: 'largeWheel',
    },
  },
];

/** 按 id 取配置；不在表内 → `null`（不静默回退到别的配置）。 */
export function heightLineConfigOf(id: string): HeightLineConfigDef | null {
  return HEIGHT_LINE_CONFIGS.find((c) => c.id === id) ?? null;
}

/* ---------------------------------------------------------------- 装配事实 */

/** 玩家主武器挂点（三套配置唯一装的那一件）。 */
export const HEIGHT_LINE_WEAPON_SLOT = 'frontMass';

export interface HeightLineAssemblyFact {
  readonly id: HeightLineConfigId;
  readonly label: string;
  /** 车身展示名 / id（正式内容库读数）。 */
  readonly bodyName: string;
  readonly bodyDefId: string;
  /** 主武器展示名 / id（正式内容库读数）。 */
  readonly weaponName: string;
  readonly weaponDefId: string;
  /** 轮组 showcase 名 + 该 def 自身的真实几何 / 物理读数（不是写死数字）。 */
  readonly wheelName: string;
  readonly wheelDefId: string;
  readonly wheelRadius: number;
  readonly wheelMass: number;
  readonly driveTorque: number;
  /** Energy：本配置**实际占用** vs 车身容量（现读 registry 逐件累加）。 */
  readonly energyUsed: number;
  readonly energyCapacity: number;
}

/**
 * 现读 registry 得出的装配事实（Energy 占用 / 轮组几何）。
 *
 * ⚠️ 全部是**读数**：`energyUsed` 不写死，而是按「本配置真正装了哪些件」逐件累加
 *    （与 `validateSnapshot` 的同一个 energy 口径），因此内容库一旦变化这里会跟着变。
 */
export function heightLineAssemblyFacts(): readonly HeightLineAssemblyFact[] {
  return HEIGHT_LINE_CONFIGS.map((c) => {
    const body = registry.bodies.get(c.draft.bodyDefId);
    const weaponId = c.draft.functionalSelections[HEIGHT_LINE_WEAPON_SLOT]!;
    const weapon = registry.functionals.get(weaponId);
    const wheel = registry.movements.get(c.wheelDefId);
    const energyUsed =
      [...Object.values(c.draft.functionalSelections)]
        .filter((id) => id && id !== 'none' && registry.functionals.has(id))
        .reduce((a, id) => a + (registry.functionals.get(id!)?.energy ?? 0), 0) +
      (wheel?.energy ?? 0) * 2;
    return {
      id: c.id,
      label: c.label,
      bodyName: body?.name ?? c.draft.bodyDefId,
      bodyDefId: c.draft.bodyDefId,
      weaponName: weapon?.name ?? weaponId,
      weaponDefId: weaponId,
      wheelName: wheel?.name ?? c.wheelDefId,
      wheelDefId: c.wheelDefId,
      wheelRadius: wheel?.radius ?? 0,
      wheelMass: wheel?.mass ?? 0,
      driveTorque: wheel?.driveTorque ?? 0,
      energyUsed,
      energyCapacity: body?.energyCapacity ?? 0,
    };
  });
}

/* ------------------------------------------------------ Lab 本地页面布局 */

/**
 * DEMO-HEIGHT-LINE-READABILITY-R2｜**Lab 本地**四带布局。
 *
 * ⚠️ **只影响本页**：不改 `runPageLayout.ts` 的正式 Run 四带（`run-page.html` 零影响）。
 *    与它的唯一差别 = 把**中部战场**从 302 提到 **344**（日志区同比收窄 42），
 *    让近景窗有更多纵向世界（车顶上方更宽的弹道通道 + 车下更多地面）。
 *
 * ⚠️ 布局本身**不能**放大小车 —— 正式 battle 相机是按「两车外廓并集占安全区宽的
 *    82~88%」构图的（见 `renderer.reframe` battle 分支），安全区宽 = 舞台带宽 = 页面宽
 *    = 390 ⇒ 无论战场带多高、多宽都不会改变车辆的屏占比。**放大只能来自近景裁切**
 *    （见下方 `heightLineCloseWindow`）。本处的加高是构图上「少浪费纵向空间」，
 *    不是放大手段。
 *
 * 四条带**由总高反推** ⇒ 结构上不可能漏缝或重叠（`heightLineConfigsProblems` 断言合计 = 页面高）。
 */
export const HEIGHT_LINE_TOP_BAND_H = 80;
export const HEIGHT_LINE_BATTLE_BAND_H = 344;
export const HEIGHT_LINE_ACTION_BAND_H = 84;
export const HEIGHT_LINE_LOG_BAND_H =
  RUN_PAGE_H - HEIGHT_LINE_TOP_BAND_H - HEIGHT_LINE_BATTLE_BAND_H - HEIGHT_LINE_ACTION_BAND_H;

export const HEIGHT_LINE_TOP_BAND = { x: 0, y: 0, w: RUN_PAGE_W, h: HEIGHT_LINE_TOP_BAND_H } as const;
export const HEIGHT_LINE_BATTLE_BAND = {
  x: 0,
  y: HEIGHT_LINE_TOP_BAND.h,
  w: RUN_PAGE_W,
  h: HEIGHT_LINE_BATTLE_BAND_H,
} as const;
export const HEIGHT_LINE_LOG_BAND = {
  x: 0,
  y: HEIGHT_LINE_BATTLE_BAND.y + HEIGHT_LINE_BATTLE_BAND.h,
  w: RUN_PAGE_W,
  h: HEIGHT_LINE_LOG_BAND_H,
} as const;
export const HEIGHT_LINE_ACTION_BAND = {
  x: 0,
  y: HEIGHT_LINE_LOG_BAND.y + HEIGHT_LINE_LOG_BAND.h,
  w: RUN_PAGE_W,
  h: HEIGHT_LINE_ACTION_BAND_H,
} as const;

/** 自上而下的绘制 / 布局顺序（数组顺序即 y 升序）。 */
export const HEIGHT_LINE_BANDS = [
  HEIGHT_LINE_TOP_BAND,
  HEIGHT_LINE_BATTLE_BAND,
  HEIGHT_LINE_LOG_BAND,
  HEIGHT_LINE_ACTION_BAND,
] as const;

/* -------------------------------------------- 近景取景（Lab 本地，只换取景） */

/**
 * 近景窗覆盖的**世界宽度**（世界 px）。
 *
 * ⚠️ 这是**取景**不是**规则**：它只决定「一个世界像素摊到几个显示像素」，
 *    不参与任何物理 / 数值 / 命中判定。
 *
 * 显示密度 = `HEIGHT_LINE_BATTLE_BAND.w / 本值` = 390 / 170 ≈ **2.294 显示px / 世界px**
 * （与 DPR 无关：页面逻辑像素 × DPR 与画布逻辑像素 × DPR 同比）。
 *
 * 对照基线（`DEMO-DOMINANT-BUILD-ROOT-R1` + 本轮实测）：
 *   官方 battle 相机在远距阶段的 `scale ≈ 0.41` 世界px→画布px（近距最高 ≈ 0.56），
 *   而「`mango+small` 车顶 645 vs 敌弹线 641.3」只差 **3.7 个世界像素**
 *   ⇒ 原取景下只有 **≈1.5 逻辑像素**（正常速度**不可能**看出，这正是上一轮的结论）；
 *   近景下同一差值 = **≈8.5 逻辑像素**，且整辆车从 ≈44 逻辑像素放大到 ≈248。
 */
export const HEIGHT_LINE_CLOSE_WORLD_W = 170;

/**
 * 车顶在近景窗里的纵向位置（0 = 窗顶，0.35 = 车顶距窗顶 35% 处）。
 *
 * 上方余下的 65% 留给**弹道通道**（敌弹从车顶掠过时必须走在窗内），下方留给车体与地面。
 */
export const HEIGHT_LINE_CLOSE_ROOF_FRAC = 0.35;

/**
 * 离屏视口放大倍数**上限**。
 *
 * 为什么需要它：把低清画面吹大不等于看清 —— 官方画面必须以**接近近景显示密度**的
 * 像素密度栅格化，否则「3.7 世界像素」在中间那张低清图上就已经被降采样糊掉，
 * 放大后只剩一团渐变。上限取 4 是「锐度 ↔ 画布面积」的折中（见 `heightLineCloseSupersample`）。
 */
export const HEIGHT_LINE_CLOSE_MAX_SUPERSAMPLE = 4;

export interface HeightLineCloseInput {
  /** 玩家（A 方）**车顶**世界 y（= `vehicleBox('A').minY`，与正式相机 includeVehicle 同口径）。 */
  readonly roofWorldY: number;
  /** 水平锚点：玩家车体中心世界 x（`vehicleX('A')`）。 */
  readonly anchorWorldX: number;
  /** 正式相机实时 scale（`viewTransform().scale`，世界 px → 画布逻辑 px）。 */
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  /** 离屏视口逻辑尺寸（`RunBattleView.viewportSize()`）。 */
  readonly viewportW: number;
  readonly viewportH: number;
}

export interface HeightLineCloseWindow {
  /** 窗覆盖的世界尺寸（恒定，与相机 scale 无关 ⇒ 三套配置**同尺度**可直接对照）。 */
  readonly worldW: number;
  readonly worldH: number;
  /** 实际生效的窗左 / 窗顶（世界坐标；被夹取时与目标值不同）。 */
  readonly worldLeft: number;
  readonly worldTop: number;
  /** 离屏画布逻辑坐标下的源矩形。 */
  readonly srcX: number;
  readonly srcY: number;
  readonly srcW: number;
  readonly srcH: number;
  /** 是否触到视口边缘被夹取（夹取 ⇒ 近景窗贴边，锚点不再居中）。 */
  readonly clamped: boolean;
  /** 显示密度（显示 px / 世界 px）—— 恒为 `战场带宽 / 世界宽`。 */
  readonly pxPerWorld: number;
  /** 车顶落在窗内的纵向比例（0.35 = 目标值；被夹取时会偏离）。 */
  readonly roofScreenFrac: number;
}

/**
 * 近景窗（纯函数，无 DOM / 无 Canvas）——**只换算取景，不碰任何相机状态**。
 *
 * 输入全部是**只读读数**（正式相机的 `scale/offsetX/offsetY` + 玩家车的真实世界包围盒），
 * 输出是「离屏画布上的哪个子矩形，应当铺满战场带」。调用方把它交给
 * `RunBattleView.blitRegion()` 做纯合成 —— 官方镜头算法一行未改。
 *
 * ⚠️ 窗宽**恒定**（`HEIGHT_LINE_CLOSE_WORLD_W`）⇒ 三套轮径在同一显示尺度下对照；
 *    纵向锚在**玩家车顶**，所以小轮 / 重轮 / 大轮的车顶始终落在窗内同一相对高度，
 *    「弹线相对车顶高还是低」在画面上是**同一把尺子**量出来的。
 */
export function heightLineCloseWindow(input: HeightLineCloseInput): HeightLineCloseWindow {
  const bandW = HEIGHT_LINE_BATTLE_BAND.w;
  const bandH = HEIGHT_LINE_BATTLE_BAND.h;
  const worldW = HEIGHT_LINE_CLOSE_WORLD_W;
  // 与战场带同宽高比 ⇒ 不做非等比拉伸（车轮不会被拉扁）
  const worldH = (worldW * bandH) / bandW;
  const scale = Number.isFinite(input.scale) && input.scale > 0 ? input.scale : 1e-6;

  const wantSrcX = (input.anchorWorldX - worldW / 2) * scale + input.offsetX;
  const wantSrcY = (input.roofWorldY - HEIGHT_LINE_CLOSE_ROOF_FRAC * worldH) * scale + input.offsetY;
  const srcW = worldW * scale;
  const srcH = worldH * scale;

  // 夹取到视口内（源矩形永远不出画；夹取只影响构图，不影响密度）
  const srcX = Math.min(Math.max(0, input.viewportW - srcW), Math.max(0, wantSrcX));
  const srcY = Math.min(Math.max(0, input.viewportH - srcH), Math.max(0, wantSrcY));

  const worldLeft = (srcX - input.offsetX) / scale;
  const worldTop = (srcY - input.offsetY) / scale;
  return {
    worldW,
    worldH,
    worldLeft,
    worldTop,
    srcX,
    srcY,
    srcW,
    srcH,
    clamped: Math.abs(srcX - wantSrcX) > 0.01 || Math.abs(srcY - wantSrcY) > 0.01,
    pxPerWorld: bandW / worldW,
    roofScreenFrac: (input.roofWorldY - worldTop) / worldH,
  };
}

/**
 * 离屏视口放大倍数（按设备 DPR 反比压回）。
 *
 * 推导：近景显示密度 = 2.294 显示px/世界px（见 `HEIGHT_LINE_CLOSE_WORLD_W`）；
 * 官方画布的**逻辑**密度 = `battleScale × viewportScale`；要求逻辑密度 ≥ 显示密度
 * ⇒ `viewportScale ≥ 2.294 / 0.41 ≈ 5.6`。
 * 但画布 backing 面积 = `(502·S·dpr) × (358·S·dpr)` 随 dpr 平方增长 ⇒ 按 dpr 反比压回，
 * 使 backing **恒定 ≈ 4× 视口**（≈ 2008×1600 device px）：
 *   - dpr 1 → S = 4（backing 2008×1600，逻辑密度 ≈ 1.63 px/世界px）
 *   - dpr 2 → S = 2（同一 backing）
 *   - dpr 3 → S ≈ 1.33（同一 backing）
 * 于是密度的**设备**结果与 dpr 无关，显存占用有上界，正常速度不受影响。
 */
export function heightLineCloseSupersample(dpr: number): number {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.min(HEIGHT_LINE_CLOSE_MAX_SUPERSAMPLE, Math.max(1, HEIGHT_LINE_CLOSE_MAX_SUPERSAMPLE / d));
}

/* ------------------------------------------------------------ 出厂自检 */

/**
 * 出厂自检（页面启动即跑；测试也断言它为空数组）。
 *
 * 它**不**回答「哪套更强」——只回答「这三套配置的形状是否仍然成立」：
 * 同车身 / 同炮 / 只换轮径 / 对手存在 / 前后轮同款 / 轮径与 defId 一致 / Energy 不超容量。
 */
export function heightLineConfigsProblems(): readonly string[] {
  const problems: string[] = [];
  if (HEIGHT_LINE_CONFIGS.length !== 3) {
    problems.push(`配置必须恰好 3 套，实际 ${HEIGHT_LINE_CONFIGS.length}`);
  }
  if (!LAB_ENCOUNTERS.some((e) => e.id === HEIGHT_LINE_OPPONENT_ID)) {
    problems.push(`对手 "${HEIGHT_LINE_OPPONENT_ID}" 不在正式 Encounter 表内`);
  }
  const bodyIds = new Set(HEIGHT_LINE_CONFIGS.map((c) => c.draft.bodyDefId));
  if (bodyIds.size !== 1) problems.push(`三套配置必须同车身，实际 ${[...bodyIds].join(', ')}`);
  const weaponIds = new Set(
    HEIGHT_LINE_CONFIGS.map((c) => c.draft.functionalSelections[HEIGHT_LINE_WEAPON_SLOT]),
  );
  if (weaponIds.size !== 1) problems.push(`三套配置必须同武器，实际 ${[...weaponIds].join(', ')}`);
  const wheels = new Set<string>();
  for (const c of HEIGHT_LINE_CONFIGS) {
    wheels.add(c.wheelDefId);
    if (c.draft.frontWheelDefId !== c.wheelDefId) {
      problems.push(`${c.id}: 前轮 defId ${c.draft.frontWheelDefId} ≠ 声明的 ${c.wheelDefId}`);
    }
    if (c.draft.rearWheelDefId !== c.wheelDefId) {
      problems.push(`${c.id}: 后轮 defId ${c.draft.rearWheelDefId} ≠ 声明的 ${c.wheelDefId}`);
    }
    const def = registry.movements.get(c.wheelDefId);
    if (!def) {
      problems.push(`${c.id}: 轮组 "${c.wheelDefId}" 不在正式内容库`);
      continue;
    }
    if (c.draft.frontRadius !== def.radius || c.draft.rearRadius !== def.radius) {
      problems.push(
        `${c.id}: 半径 ${c.draft.frontRadius}/${c.draft.rearRadius} 与 ${c.wheelDefId} 的 r${def.radius} 不一致`,
      );
    }
  }
  if (wheels.size !== HEIGHT_LINE_CONFIGS.length) {
    problems.push(`三套配置的轮径必须互不相同，实际 [${[...wheels].join(', ')}]`);
  }
  for (const f of heightLineAssemblyFacts()) {
    if (f.energyUsed > f.energyCapacity) {
      problems.push(`${f.id}: Energy ${f.energyUsed} 超过车身容量 ${f.energyCapacity}`);
    }
  }
  // --- DEMO-HEIGHT-LINE-READABILITY-R2：Lab 本地布局自检（四带无缝 → 不可能漏缝/重叠）---
  let cursor = 0;
  for (const b of HEIGHT_LINE_BANDS) {
    if (b.x !== 0 || b.w !== RUN_PAGE_W) problems.push(`布局带 y=${b.y} 未铺满页面宽`);
    if (b.y !== cursor) problems.push(`布局带 y=${b.y} 与前一带不连续（期望 ${cursor}）`);
    cursor = b.y + b.h;
  }
  if (cursor !== RUN_PAGE_H) problems.push(`四带合计 ${cursor} ≠ 页面高 ${RUN_PAGE_H}`);
  if (HEIGHT_LINE_BATTLE_BAND.h <= 302) {
    problems.push(`战场带高 ${HEIGHT_LINE_BATTLE_BAND.h} 必须大于正式 Run 的 302（布局强化未生效）`);
  }
  // --- 近景取景自检：等比、恒定密度、放大倍数与 DPR 无关 ---
  const closeProbe = heightLineCloseWindow({
    roofWorldY: 0,
    anchorWorldX: 0,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    viewportW: 1e6,
    viewportH: 1e6,
  });
  const aspect = HEIGHT_LINE_BATTLE_BAND.h / HEIGHT_LINE_BATTLE_BAND.w;
  if (Math.abs(closeProbe.worldW * aspect - closeProbe.worldH) > 1e-9) {
    problems.push('近景窗宽高比与战场带不一致（会出现非等比拉伸）');
  }
  if (Math.abs(closeProbe.pxPerWorld - HEIGHT_LINE_BATTLE_BAND.w / HEIGHT_LINE_CLOSE_WORLD_W) > 1e-9) {
    problems.push('近景显示密度 ≠ 战场带宽 / 近景世界宽');
  }
  const s1 = heightLineCloseSupersample(1);
  const s2 = heightLineCloseSupersample(2);
  if (s1 < 1 || s2 < 1 || s1 > HEIGHT_LINE_CLOSE_MAX_SUPERSAMPLE || s2 > HEIGHT_LINE_CLOSE_MAX_SUPERSAMPLE) {
    problems.push('离屏视口放大倍数落在合法区间外');
  }
  if (Math.abs(s1 * 1 - s2 * 2) > 1e-9) {
    problems.push('离屏 backing 密度必须与 DPR 无关（S × dpr 需恒定）');
  }
  return problems;
}

/* ------------------------------------------------------------ 页面文案 */

export const HEIGHT_LINE_LAB_TITLE = '车高 · 水平弹道对照台';

/** 副标题：一句话说明「这里只换轮径」。 */
export const HEIGHT_LINE_LAB_LEAD = '同一车身、同一门炮、同一个对手，只换轮径。';

/** 未选配置时的舞台提示。 */
export const HEIGHT_LINE_LAB_IDLE_HINT = '选一套轮径开始';

/** 清场控件的文案（清掉当前战斗，保留累计对照）。 */
export const HEIGHT_LINE_LAB_CLEAR_LABEL = '清场';

/** Reset 控件文案（清场 + 清空累计对照）。 */
export const HEIGHT_LINE_LAB_RESET_LABEL = 'Reset';
