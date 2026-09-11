/**
 * PBL-F1-SHARED-LOADOUT-ENCOUNTER｜A / B 共用的最小测试数据。
 *
 * 核心原则（Queue 硬约束）：
 *   - **优先复用现有正式定义**：本文件只保存「正式 defId 的引用」与正式 `BuildDraft`，
 *     不写任何 HP / 伤害 / CD / 射程 / 质量 / 能量数字；
 *   - **不为 A / B 各写一套**：测试数据与 Arena 无关（本文件完全不感知 arena）；
 *   - 真实数值一律由正式链路解析：`buildSnapshotFromDraft` → `resolveSnapshot`（见 entities.ts）。
 *
 * 对 Queue 点名但正式内容库尚不存在的部件（磁铁 / 护盾），本 Lab **不引入、不造数值**，
 * 只在 `slots` 里显式标注 `unavailable`；模块加载时会动态校验「正式库确实没有同名件」，
 * 一旦将来正式库补上，这里会立刻抛错，强制重新绑定而不是继续悄悄占位。
 */
import { registry } from '../../core/content';
import { EMPTY_SLOT, type BuildDraft } from '../buildEditorModel';
import { OPPONENT_TEMPLATES } from '../../player/opponentPool';
import {
  type LabEncounterId,
  type LabLoadoutId,
} from './constants';

/* ------------------------------------------------------------------ 校验 */

/** 正式内容库中是否存在同名（中文名）件——用于「unavailable」结论的动态校验。 */
function formalPartWithNameExists(name: string): boolean {
  const pools = [
    registry.bodies.values(),
    registry.movements.values(),
    registry.functionals.values(),
  ];
  for (const pool of pools) {
    for (const def of pool) if (def.name === name) return true;
  }
  return false;
}

/**
 * 断言某件在正式内容库中确实不存在（Queue 点名但正式库未提供）。
 * 若将来正式库补上，加载即失败——必须回来重新绑定，不允许静默保留占位。
 */
function assertAbsentFromFormalContent(name: string): void {
  if (formalPartWithNameExists(name)) {
    throw new Error(
      `[PBL-F1] 正式内容库已存在「${name}」——请回到 testData.ts 把它改为 formal 绑定，` +
        '不允许继续以 unavailable 占位。',
    );
  }
}

assertAbsentFromFormalContent('磁铁');
assertAbsentFromFormalContent('护盾');

/** 按正式模板 id 取对手 Draft（缺失即抛错，不静默回退到别的模板）。 */
function formalOpponentDraft(templateId: string): BuildDraft {
  const t = OPPONENT_TEMPLATES.find((x) => x.id === templateId);
  if (!t) throw new Error(`[PBL-F1] 正式对手池不存在模板 "${templateId}"`);
  return t.draft;
}

/* --------------------------------------------------------- Test Loadout */

/** 一个测试 Loadout 槽位的「Queue 口径 → 正式库」解析结果。 */
export interface LabLoadoutSlot {
  /** 槽位职责（Queue 描述的 4 件：车体 / 移动 / 武器 / 辅助）。 */
  readonly role: 'body' | 'movement' | 'weapon' | 'gadget';
  /** Queue 里的原始名称（如「履带」）。 */
  readonly requested: string;
  /**
   * 解析类型：
   *   - formal     = 直接引用正式定义；
   *   - adapted    = 正式库无同名件，以最接近的正式件近似（不新增数值）；
   *   - unavailable= 正式库无任何对应件 → 本 Lab 不引入。
   */
  readonly kind: 'formal' | 'adapted' | 'unavailable';
  /** formal / adapted 时的正式 defId。 */
  readonly defId?: string;
  readonly note: string;
}

export interface LabTestLoadout {
  readonly id: LabLoadoutId;
  readonly label: string;
  readonly note: string;
  readonly slots: readonly LabLoadoutSlot[];
  /** 正式 BuildDraft（只含正式 defId；数值由 registry 解析）。 */
  readonly draft: BuildDraft;
}

/** 全部 4 个功能槽显式置空后叠加选择（与正式对手池 `opp()` 同构）。 */
function draft(
  bodyDefId: string,
  wheels: { rear: number; front: number; rearDefId?: string; frontDefId?: string },
  selections: Record<string, string>,
): BuildDraft {
  return {
    bodyDefId,
    rearRadius: wheels.rear,
    frontRadius: wheels.front,
    ...(wheels.rearDefId ? { rearWheelDefId: wheels.rearDefId } : {}),
    ...(wheels.frontDefId ? { frontWheelDefId: wheels.frontDefId } : {}),
    functionalSelections: {
      front: EMPTY_SLOT,
      frontMass: EMPTY_SLOT,
      top: EMPTY_SLOT,
      rear: EMPTY_SLOT,
      ...selections,
    },
    drive: 'forward',
  };
}

/**
 * 两套共享 Test Loadout（A / B 完全共用）。
 *
 * 明确的「缺口披露」：
 *   - 「履带」正式库不存在（移动只有 标准/小/大/重型 四种轮组）→ 以重型轮组近似；
 *   - 「磁铁」「护盾」正式库不存在 → unavailable，本 Lab 不引入、不造数值。
 */
export const LAB_LOADOUTS: readonly LabTestLoadout[] = [
  {
    id: 'WatermelonHeavyCannon',
    label: '西瓜重炮',
    note: '西瓜重车体 + 重型轮组 + 炮（磁铁：正式库无）',
    slots: [
      { role: 'body', requested: '西瓜重车体', kind: 'formal', defId: 'watermelonBody', note: '正式车身' },
      {
        role: 'movement',
        requested: '履带',
        kind: 'adapted',
        defId: 'heavyWheel',
        note: '正式库无履带（移动仅 标准/小/大/重型轮组）→ 以重型轮组近似，未新增数值',
      },
      { role: 'weapon', requested: '大炮', kind: 'formal', defId: 'cannon', note: '正式武器' },
      {
        role: 'gadget',
        requested: '磁铁',
        kind: 'unavailable',
        note: '正式内容库无对应件 → 本 Lab 不引入（不造数值）',
      },
    ],
    draft: draft(
      'watermelonBody',
      { rear: 20, front: 20, rearDefId: 'heavyWheel', frontDefId: 'heavyWheel' },
      { front: 'cannon' },
    ),
  },
  {
    id: 'BananaChargeHammer',
    label: '香蕉冲锋锤',
    note: '香蕉轻车体 + 标准轮 + 锤 + 推进器（护盾：正式库无）',
    slots: [
      { role: 'body', requested: '香蕉轻车体', kind: 'formal', defId: 'bananaBody', note: '正式车身' },
      {
        role: 'movement',
        requested: '（规格未列出移动件）',
        kind: 'adapted',
        defId: 'wheelStd',
        note: 'Queue 第 2 件「推进器」正式分类为 gadget（非 Movement）→ 按正式 Build 默认轮 wheelStd 补齐，未新增数值',
      },
      { role: 'weapon', requested: '大锤', kind: 'formal', defId: 'hammer', note: '正式武器' },
      { role: 'gadget', requested: '推进器', kind: 'formal', defId: 'thruster', note: '正式 gadget' },
      {
        role: 'gadget',
        requested: '护盾',
        kind: 'unavailable',
        note: '正式内容库无对应件 → 本 Lab 不引入（不造数值）',
      },
    ],
    draft: draft('bananaBody', { rear: 20, front: 20 }, { front: 'hammer', rear: 'thruster' }),
  },
];

/* ----------------------------------------------------------- Encounter */

export interface LabTestEncounter {
  readonly id: LabEncounterId;
  readonly label: string;
  readonly note: string;
  /** 正式对手池模板 id（数据一律来自正式池）。 */
  readonly templateId: string;
  /** 同场敌人数（Chaser / RangedTurret = 1；LightSwarm3 = 3）。 */
  readonly count: number;
  /** 正式对手模板 Draft（同一模板复制 count 份，不新增任何数值）。 */
  readonly draft: BuildDraft;
}

/**
 * 三套共享 Encounter（A / B 完全共用同一套基础数据）。
 * `LightSwarm3` = 同一套正式轻型 Build 复制 3 份（正式对手池无「同场多敌人」模型，
 * 本 Lab 只做数量复制，不改任何 HP / 伤害 / CD）。
 */
export const LAB_ENCOUNTERS: readonly LabTestEncounter[] = [
  {
    id: 'Chaser',
    label: '追猎者',
    note: '单个高速追猎敌人（正式模板 OPP-16：香蕉 + 锤 + 推进器）',
    templateId: 'OPP-16',
    count: 1,
    draft: formalOpponentDraft('OPP-16'),
  },
  {
    id: 'RangedTurret',
    label: '远程炮台',
    note: '单个远程敌人（正式模板 OPP-03：西瓜 + 炮 + 机枪 · 停驻）',
    templateId: 'OPP-03',
    count: 1,
    draft: formalOpponentDraft('OPP-03'),
  },
  {
    id: 'LightSwarm3',
    label: '3 轻敌人',
    note: '3 个轻型敌人（正式模板 OPP-14 复制 3 份：香蕉 + 圆锯 + 推进器）',
    templateId: 'OPP-14',
    count: 3,
    draft: formalOpponentDraft('OPP-14'),
  },
];

/* ------------------------------------------------------------- 目录查询 */

export function findLoadout(id: string): LabTestLoadout | undefined {
  return LAB_LOADOUTS.find((l) => l.id === id);
}

export function findEncounter(id: string): LabTestEncounter | undefined {
  return LAB_ENCOUNTERS.find((e) => e.id === id);
}
