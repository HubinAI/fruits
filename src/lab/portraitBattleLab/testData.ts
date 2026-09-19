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
  /**
   * PBL-FOUNDATION-RANGED-DISTANCE-CONTROL-R1｜这一套 Encounter 要求对手使用的
   * **Movement 姿态**（缺口径）。
   *
   * - `'keep-distance'` = 「维持作战距离」：远 → 接近 / 合理射程 → 不主动接近 / 近 → 后撤。
   *   由正式 Movement Foundation（`battleContract` → `enemyDrive.ts`）执行，仍然是
   *   wheel motor + 真实 grip，不是位置修正。
   * - 缺省（`undefined`）⇒ **对手驱动与既有完全相同**（恒朝玩家全速），
   *   即 ProtoRusher / Chaser 以及 Run Script 的四场对手**逐帧不变**。
   *
   * ⚠️ 这是**声明**，不是按 id / 计数推断：只有明确声明的 Encounter 才会换档。
   *    「远程身份需要距离维持」是这一套 Encounter 的**验证目标**，
   *    而不是所有「有弹丸武器的敌人」的自动推断 —— 那会把 Run 的第四场
   *    （`BananaRodLaser`，forward）一起卷进来。
   */
  readonly enemyDrive?: 'keep-distance';
}

/**
 * 四套共享 Encounter（A / B 完全共用同一套基础数据）。
 * `LightSwarm3` = 同一套正式轻型 Build 复制 3 份（正式对手池无「同场多敌人」模型，
 * 本 Lab 只做数量复制，不改任何 HP / 伤害 / CD）。
 * `ProtoRusher` = 引用既有正式模板 `R1-RUSH-02` 的单车版本，
 *   PRP-RUN-R1 的 Build Prototype Encounter（选型依据见该条目的注释）。
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
    note: '单个远程敌人（正式模板 OPP-03：西瓜 + 炮 + 机枪）· 声明「维持作战距离」（PBL-FOUNDATION-RANGED-DISTANCE-CONTROL-R1）',
    templateId: 'OPP-03',
    count: 1,
    draft: formalOpponentDraft('OPP-03'),
    /**
     * ⚠️ PBL-FOUNDATION-RANGED-DISTANCE-CONTROL-R1：**唯一**声明距离维持的 Encounter。
     *
     * 真人验收失败原因（Queue 原文）：「远距离阶段远程射击身份非常清楚，数秒后双方迅速
     * 贴脸，后续基本退化成普通近战碰撞」—— 缺口不是射击可见性，而是**远程敌人缺少
     * 「维持合理作战距离」的 Movement 能力**。
     *
     * 实测（本 Queue 必改 1 的证据）：不加此声明时，本套 Encounter 的外廓间距在约 300 步
     * （≈5s）内从 489 掉到 2.6（= 贴脸），且是**敌人主动**从 1200 一路开到 885。
     */
    enemyDrive: 'keep-distance',
  },
  {
    id: 'LightSwarm3',
    label: '3 轻敌人',
    note: '3 个轻型敌人（正式模板 OPP-14 复制 3 份：香蕉 + 圆锯 + 推进器）',
    templateId: 'OPP-14',
    count: 3,
    draft: formalOpponentDraft('OPP-14'),
  },
  {
    /**
     * PRP-RUN-R1-DEATH-AND-DURABILITY-CONTINUITY｜**Build Prototype Encounter**。
     *
     * 背景：Run Page 的单局验证要连打**三场**真实战斗，而耐久是**单一贯穿**的
     * （`HP <= 0` = 本局立即失败，见 `runPageState.ts`）。原先用的 `Chaser`（OPP-16）
     * 第一场就打掉玩家 ~75% 耐久 → 第二场必败，三场验证在结构上跑不完。
     *
     * 选择依据 = **两轮实测普查**（全部走生产同构链路，含 `RunBuildAbilities` 的真实冲量）：
     *
     *   轮 1（49 套正式对手模板各打一场，玩家满耐久）：只有 12 套能存活；
     *   轮 2（存活且低压的 6 套 × 3 个第一层 × 各自条件池 3 项 = **9 种组合** 三场连锁）：
     *     - `OPP-20`  0/9 全部失败 —— 排除；
     *     - `OPP-29`  7/9（重磅→动能爆发 第二场就只剩 34）；
     *     - `OPP-14`  8/9（重磅→动能爆发 第三场阵亡，敌剩 10）—— 排除；
     *     - `OPP-35`  8/9（重磅→紧急维修 第三场阵亡，终局仅剩 48）；
     *     - `OPP-31`  9/9，但终局战斗玩家只掉 2~42 点（近似沙包，**看不出对打**）；
     *     - **`R1-RUSH-02` 9/9 且终局仍是对打**：三条路线终局分别掉 177 / 208 / 272 点，
     *       收在 537 / 470 / 350（上限 1100，余量 32%~49%）→ **选它**。
     *
     * 为什么选「对打」而不是余量更大的 `OPP-31`：本原型要让人**看出这辆车形成了方向**，
     * 终局必须是真实互殴节奏（三条路线终局时长 14.0s / 7.2s / 9.8s，差异可感知），
     * 而不是快速打死一个不还手的沙包。`R1-RUSH-02` 同时满足「明显更低压」（第一场只损
     * 257，旧 `Chaser` 是 830）与「保留真实物理接敌」（会真实冲刺撞击）。
     *
     * ⚠️ 这是**引用既有正式对手模板**（`R1-RUSH-02`，`opponentPool.ts` 里既有的一套），
     *   **没有新增敌人、没有改正式敌人定义、没有改任何 HP / 伤害 / 碰撞 / 质量数值**；
     *   `count: 1` = 单车版本。
     */
    id: 'ProtoRusher',
    label: '菠萝冲刺车',
    note: '单个低压冲刺车（正式模板 R1-RUSH-02：菠萝 + 圆锯 + 刺 + 推进器）· PRP 三场 Build 验证的对比基准',
    templateId: 'R1-RUSH-02',
    count: 1,
    draft: formalOpponentDraft('R1-RUSH-02'),
  },
  /* ====================================================================
   * PRP-RUN-02-FULL-RUN-VERTICAL-SLICE｜四场压力阶梯的三套新 Encounter
   *
   * 全部只是**既有正式对手模板的引用**（`count: 1`）：没有新增敌人，
   * 没有改 HP / speed / damage / enemyCount，没有碰正式对手池。
   *
   * 为什么必须新增（而不是复用已有的四套）：固定 Run Script 要**四场真实战斗**
   * 共享同一条耐久，且每一场都必须「任何一层 Build 选择都能活着走完」。
   * 实测普查（走生产同构链路：正式编排器 + overlay registry + 零 config；
   * 49 套正式模板 × 10 种真实 Build = 490 场，见 `交接文档_2026-09-17_PRP-RUN-02.md`）：
   *   - `Chaser`（OPP-16）基础掉血 830，在 `双联炮+重型弹头` 下会 **1100（必死）** → 不能进阶梯；
   *   - `RangedTurret`（OPP-03）对基础 Build **必死**（掉 1100）→ 不能进阶梯；
   *   - `LightSwarm3` 是 OPP-14 复制 3 份（`count: 3`），而 Run Page 的战斗运行时
   *     只容纳 1 个敌人 → 展示名「3 轻敌人」与画面不符，不作为 Run Script 的一环；
   *   - 因此阶梯只能从「既有正式模板」里另选三套（本文件新增的引用）。
   *
   * 四场阶梯（玩家**基础 Build** 实测掉血；括号内 = 该模板在 10 种 Build 下的掉血范围）：
   *
   *   | 场次 | Encounter | 正式模板 | 定位 | 基础掉血 | 范围 |
   *   |---|---|---|---|---|---|
   *   | ① 低压   | `PineappleFireBrute`  | OPP-29 (rush)    | 菠萝 + 喷火器 + 锤 | 181 | 0~885 |
   *   | ② 中低压 | `PineappleSawRusher`  | OPP-31 (rush)    | 菠萝 + 圆锯 + 推进器 | 221 | 3~231 |
   *   | ③ 中压   | `ProtoRusher`（既有） | R1-RUSH-02 (rush)| 菠萝 + 圆锯 + 刺 + 推进器 | 257 | 60~257 |
   *   | ④ 较高压 | `BananaRodLaser`      | OPP-20 (control) | 香蕉 + 推杆 + 镭射（前进） | 482 | 322~482 |
   *
   * ⚠️ 为什么选这一组而不是「基础掉血最大」的：`OPP-04` / `OPP-33` / `OPP-22` / `R1-CTRL-01`
   *    的基础掉血更高（962 / 1053 / 726 / 573），但它们的掉血**随 Build 剧烈摆动**
   *    （例如 `OPP-22` 在 `三连装填` 下只要 162、在 `重型弹头` 下要 724）——
   *    放进阶梯会让某条 Build 路线在第六天直接阵亡。本组是实测**全部 12 条真实路线
   *    （3 个第一层 × {维修分支, 条件池 3 项}）终局都存活**的唯一四条既有模板组合之一。
   *    实测最差路线余量 = **78/1100（7%）**，出现在 `重型弹头 → 动能爆发`（不回耐久那条）；
   *    其余路线余量 200~530。这是**已记录的平衡事实**（本 Queue 不做数值调整）。
   * ==================================================================== */
  {
    id: 'PineappleFireBrute',
    label: '菠萝喷火车',
    note: '单个近战重锤车（正式模板 OPP-29：菠萝 + 喷火器 + 锤）· 四场阶梯第 ① 场（低压）',
    templateId: 'OPP-29',
    count: 1,
    draft: formalOpponentDraft('OPP-29'),
  },
  {
    id: 'PineappleSawRusher',
    label: '菠萝圆锯车',
    note: '单个前重后轻的圆锯冲刺车（正式模板 OPP-31：菠萝 + 圆锯 + 推进器）· 四场阶梯第 ② 场（中低压）',
    templateId: 'OPP-31',
    count: 1,
    draft: formalOpponentDraft('OPP-31'),
  },
  {
    id: 'BananaRodLaser',
    label: '香蕉推杆镭射车',
    note: '单个推杆 + 镭射的控距重车（正式模板 OPP-20：香蕉 + 推杆 + 镭射）· 四场阶梯第 ④ 场（终局）',
    templateId: 'OPP-20',
    count: 1,
    draft: formalOpponentDraft('OPP-20'),
  },
];

/* ------------------------------------------------------------- 目录查询 */

export function findLoadout(id: string): LabTestLoadout | undefined {
  return LAB_LOADOUTS.find((l) => l.id === id);
}

export function findEncounter(id: string): LabTestEncounter | undefined {
  return LAB_ENCOUNTERS.find((e) => e.id === id);
}
