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
