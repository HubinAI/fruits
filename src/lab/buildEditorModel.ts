/**
 * Build Editor Pure Model（Q06-F2）。
 *
 * 把 main.ts 写死的 buildFromEdit 抽成可测试的最小 Build Draft 模型：
 * - Draft 只描述「Body + 前后轮半径 + Functional 槽位选择（hardpointId → defId | none）」；
 * - 槽位来自当前 BodyDef.functionalHardpoints（真实硬点，不虚构）；
 * - Body 切换时保留同名槽选择、丢弃不存在的旧槽、新槽默认 none；
 * - buildSnapshotFromDraft 只生成非 none 项，不自动塞 ramHead，不创造不存在的 hardpoint；
 * - 玩家可选部件来自 PART_OPTIONS（ramHead 已在 Q12-A-HOLD 退出装配页，prototype/hold；
 *   registry / Scenario / 测试保留，底层 ram Contact 能力不修改）。
 *
 * 纯模型：不依赖 DOM / PhysicsLab / Validator / Energy 平衡（均为后续独立队列）。
 */
import type {
  BodyDef,
  BuildSnapshot,
  ContentRegistry,
  QualityTierId,
} from '../core/types';

/** 可编辑的正式 Functional 内容（本轮已通过体验验证的 Weapon/Gadget） */
export const EDITABLE_FUNCTIONAL_DEF_IDS = ['cannon', 'hammer', 'pushRod', 'saw', 'shotgun', 'thruster'] as const;
export type EditableFunctionalDefId = (typeof EDITABLE_FUNCTIONAL_DEF_IDS)[number];

/** 空槽哨兵：不进入 BuildSnapshot */
export const EMPTY_SLOT = 'none';

/**
 * F-MOVE-1｜驱动模式（正式 Build 选择，玩家与对手共用的明确配置）：
 * - 'forward'  = 当前正常 wheel motor 行为（自动朝对方驱动）；
 * - 'stationary' = wheel motor 不主动输出，但所有真实 Physics 保留
 *   （仍受碰撞、后坐力、重力等推动；非固定炮塔、不刹停、不锁位置、不 setVelocity）。
 * 不为 true/false 布尔，避免与 BattleConfig.sideDrive 的「已驱动」布尔语义混淆。
 */
export type DriveMode = 'forward' | 'stationary';

/**
 * F-MOVE-1｜驱动模式归一（旧 localStorage / 非法值兼容）：
 * 仅 'stationary' 视为停驻，其余（undefined / 'forward' / 非法串）一律按 'forward'。
 */
export function resolveDriveMode(d?: DriveMode): DriveMode {
  return d === 'stationary' ? 'stationary' : 'forward';
}

/**
 * Functional 槽位自然名称（Q06-UX-R1）：玩家主标签必须是位置语义，
 * 内部 hardpoint id 仅作次级文字（如「前端 (front)」）。
 */
export const SLOT_LABELS: Record<string, string> = {
  front: '前端挂点',
  frontMass: '前上挂点',
  top: '顶部挂点',
  rear: '后部挂点',
};

/** 槽位展示主标签（未知 id 回退为原 id） */
export function slotLabel(hardpointId: string): string {
  return SLOT_LABELS[hardpointId] ?? hardpointId;
}

/** Build Draft：编辑器的可序列化中间状态 */
export interface BuildDraft {
  bodyDefId: string;
  /** 后轮半径（px） */
  rearRadius: number;
  /** 前轮半径（px） */
  frontRadius: number;
  /**
   * F-CONTENT-PLAYER-MOVEMENT-PACK-R1｜前后轮组 defId（可选）。
   * 缺省 undefined = 标准轮（wheelStd）+ 保留 rearRadius/frontRadius 数值
   * （旧存档 / 对手池兼容：行为完全不变）。选中轮组卡时写入 defId 并把
   * rearRadius/frontRadius 置为该轮组默认 radius（下游数值链路零改动）。
   */
  rearWheelDefId?: string;
  frontWheelDefId?: string;
  /** Functional 槽位选择：hardpointId → defId 或 'none'（空槽） */
  functionalSelections: Record<string, string>;
  /**
   * F-MOVE-1｜驱动模式（前进 / 停驻）。与车身/轮子同为 Build 的明确配置；
   * 缺省 undefined = 前进（旧 localStorage 自动按前进处理）。
   */
  drive?: DriveMode;
  /**
   * Q22｜各 Functional 槽位的星级（V0.5 部件成长）。key = hardpointId；
   * 值 = 1（基础）或 2（由 5×1★ 合成）。缺省 undefined = 全部 1★（旧 Build / 对手兼容）。
   * 不引入实例 UID：星级只描述 Build 装配选择，库存副本数由 partInventory 单独记录。
   */
  functionalStars?: Record<string, number>;
  /**
   * GARAGE-V2-QUALITY-RUN-ADAPTER-R1｜各 Functional 槽位的**显式品质档**（γ 方案）。
   *
   * key = hardpointId；值 = QualityTierId（white..chrome）。缺省 undefined = 无品质
   * （旧 Build / 对手池 / 旧存档完全不受影响）。white 在 snapshot 构造层**不写字段**。
   * ⚠️ 本字段当前只由隔离验证环境（Lab fixture / 测试）写入：
   *    正式 Garage V2 装备链未打通（`equipQualityProduct` 仍 run-not-wired），
   *    正式页面/存档不得写入品质值。
   * ⚠️ 与 quality 并存时 star 的伤害倍率被品质替代（不双乘）；能量仍按 star 口径。
   */
  functionalQualities?: Record<string, QualityTierId>;
  /**
   * GARAGE-V2-QUALITY-WEAPON-EQUIP-R1｜各 Functional 槽位装备的**品质实例绑定**
   * （最小稳定装备实例引用）。
   *
   * key = hardpointId；值 = 账本产物实例 id（`qv2:<defId>:<quality>:<seq>`）。
   * 与 functionalQualities 的关系：functionalQualities[hardpointId] 存颜色档，
   * 本字段存**具体哪一件**（同 defId+quality 的两件独立实例靠 seq 区分）。
   *
   * ⚠️ 加载时真实校验：`loadPlayerBuild` 会用 core 账本读口
   *    （`core/qualityLedger.ledgerOwnsProduct`）核对绑定仍被持有——
   *    已被合成消耗 / 手工删除的绑定 ⇒ **整份存档判非法**（回 null，
   *    绝不静默回落 ★1 冒充成功）。
   * ⚠️ 换装清除：装旧武器（equipWeapon）时清掉本槽两字段；装品质产物时
   *    原子替换两字段（不双乘、不留陈旧）。
   */
  equippedQualityInstances?: Record<string, string>;
  /**
   * QUALITY-MOVEMENT-RUNTIME-EQUIP-R1｜前后轮的**显式品质档**。
   *
   * key = `'rear' | 'front'`（Movement 挂点语义，不是 hardpointId 字符串堆）；
   * 值 = QualityTierId。缺省 undefined = 无品质（旧 Build/对手池/旧存档零影响）。
   * white 不写字段；只抬该槽 driveTorque（真实 Revolute motor 路径），
   * 另一轮位零影响（QM-03/06 钉死）。
   */
  movementQualities?: { rear?: QualityTierId; front?: QualityTierId };
  /**
   * GADGET-SLOT-FOUNDATION-R1｜**独立 Gadget 装配位**（1 × Gadget）。
   *
   * 与 Weapon / Front Movement / Rear Movement **并列**的第 4 个 Build 维度，
   * 用于改变距离 / 位移 / 姿态，**不承担主要伤害**。
   *
   * ⚠️ 它**不是**旧 `front` / `top` / `rear` 功能槽的复用：
   *   - 旧的 `functionalSelections` 键是 **Body 硬点 id**（`front`/`frontMass`/`top`/`rear`），
   *     受 Hidden Top Weapon Removal 契约约束（`top` 强制清空、`front` 默认清空）；
   *   - 本字段是**独立维度**，键空间与 Body 硬点完全无关，
   *     **不触碰、不重开** 任何旧槽位语义。
   *
   * 缺省 `undefined` = 无 Gadget（EMPTY）。
   * 旧存档 / 旧 snapshot 没有本字段 ⇒ 自然解析为 EMPTY，**不允许因此失效**。
   */
  gadgetDefId?: string;
}

/** 当前 Body 的可编辑 Functional 槽位（真实硬点 id，顺序同 BodyDef） */
export function editableSlots(body: BodyDef): string[] {
  return body.functionalHardpoints.map((h) => h.id);
}

/**
 * Body 切换（migrate）：
 * - 保留仍存在的同名 hardpoint 选择（含 'none'）；
 * - 新 Body 不存在的旧 hardpoint 自动丢弃（结果只遍历新 Body 硬点）；
 * - 新 Body 新增的 hardpoint 默认 'none'。
 * 返回的 functionalSelections 键集合 == 新 Body 的真实槽位集合（不产生非法遗留槽）。
 */
export function migrateDraftBody(
  draft: BuildDraft,
  newBodyDefId: string,
  registry: ContentRegistry,
): BuildDraft {
  const body = registry.bodies.get(newBodyDefId);
  if (!body) {
    // 未知 Body：清空槽位（避免携带旧 Body 的非法槽）
    return { ...draft, bodyDefId: newBodyDefId, functionalSelections: {} };
  }
  const selections: Record<string, string> = {};
  for (const hp of body.functionalHardpoints) {
    const prev = draft.functionalSelections[hp.id];
    selections[hp.id] = prev !== undefined ? prev : EMPTY_SLOT;
  }
  return { ...draft, bodyDefId: newBodyDefId, functionalSelections: selections };
}

/**
 * Draft → BuildSnapshot：
 * - movements 固定生成 rear/front 两个 wheel（F-CONTENT-PLAYER-MOVEMENT-PACK-R1：
 *   defId = draft 轮组选择，缺省 wheelStd；radius overrides 保留——旧档数值兼容）；
 * - functionals 只生成非 none 项，且硬点必须真实存在于当前 Body（不创造不存在槽位）；
 * - 不自动塞 ramHead / 其他部件（ramHead 选择由 PART_OPTIONS 控制，Q12-A-HOLD 已移除）。
 */
export function buildSnapshotFromDraft(
  draft: BuildDraft,
  registry: ContentRegistry,
  id = 'customDraft',
): BuildSnapshot {
  const body = registry.bodies.get(draft.bodyDefId);
  const rearDefId = draft.rearWheelDefId ?? 'wheelStd';
  const frontDefId = draft.frontWheelDefId ?? 'wheelStd';
  // F-CONTENT-PACK-REAL-UI-R1｜Fix 4：卸下的轮组（EMPTY_SLOT）不进 Battle Snapshot——
  // 否则 validateSnapshot 报「未知 Movement」、resolveSnapshot 抛错，站桩 Build 无法开战。
  // 与下方 functionalSelections 的 EMPTY_SLOT 过滤同源。
  const movementSpecs = [
    { hardpointId: 'rear', defId: rearDefId, radius: draft.rearRadius },
    { hardpointId: 'front', defId: frontDefId, radius: draft.frontRadius },
  ].filter((m) => m.defId !== EMPTY_SLOT);
  const movements: BuildSnapshot['movements'] = movementSpecs.map((m) => ({
    hardpointId: m.hardpointId,
    defId: m.defId,
    overrides: { radius: m.radius },
    // QUALITY-MOVEMENT-RUNTIME-EQUIP-R1：按槽注入显式品质档（white 不写，与 star 同构）；
    // 只影响本槽 driveTorque，另一轮位零影响。
    ...(m.hardpointId === 'rear' && draft.movementQualities?.rear &&
    draft.movementQualities.rear !== 'white'
      ? { quality: draft.movementQualities.rear }
      : {}),
    ...(m.hardpointId === 'front' && draft.movementQualities?.front &&
    draft.movementQualities.front !== 'white'
      ? { quality: draft.movementQualities.front }
      : {}),
  }));
  const validHardpoints = body
    ? new Set(body.functionalHardpoints.map((h) => h.id))
    : new Set<string>(); // 未知 Body：无真实槽位，functionals 全部过滤
  const functionals: BuildSnapshot['functionals'] = Object.entries(
    draft.functionalSelections,
  )
    .filter(([, defId]) => defId && defId !== EMPTY_SLOT)
    .filter(([hardpointId]) => validHardpoints.has(hardpointId))
    .map(([hardpointId, defId]) => ({
      hardpointId,
      defId,
      // Q22：注入该槽位的星级。缺省/1★ 不写字段（保持旧 Build 兼容），倍率层在 resolveSnapshot 用 ?? 1 处理
      ...(draft.functionalStars?.[hardpointId] && draft.functionalStars[hardpointId] > 1
        ? { star: draft.functionalStars[hardpointId] }
        : {}),
      // GARAGE-V2-QUALITY-RUN-ADAPTER-R1：注入该槽位的显式品质档。
      // ⚠️ white 不写字段（与 star>1 才写 star 同构）——旧快照形状逐字节不变；
      //    非 white 写 quality ⇒ resolveSnapshot 走品质倍率（替代 star 伤害倍率，不双乘）。
      ...(draft.functionalQualities?.[hardpointId] &&
      draft.functionalQualities[hardpointId] !== 'white'
        ? { quality: draft.functionalQualities[hardpointId] }
        : {}),
    }));

  return {
    id,
    bodyDefId: draft.bodyDefId,
    quality: 1,
    movements,
    functionals,
    // GADGET-SLOT-FOUNDATION-R1：独立 Gadget 位（EMPTY / 缺省 ⇒ 不写字段，保持旧形状）
    ...(draft.gadgetDefId && draft.gadgetDefId !== EMPTY_SLOT
      ? { gadget: { defId: draft.gadgetDefId } }
      : {}),
  };
}

/**
 * Q26｜空存档首次启动的合法 Starter Build（与 main.ts 旧 silDraft 等价，提取为可测试纯函数）。
 * 保证「玩家无需先修配置即可开战」：
 * - 至少 1 个 Weapon（frontMass = cannon）；
 * - Energy 合法（pushRod20 + cannon30 + hammer25 = 75 ≤ 任意 Body 容量）；
 * - Drive 默认前进；
 * - 其余 hardpoint 默认空槽（不强制装配）。
 * 不引入特殊 Physics / 教程降属性；难度与普通 Build 一致。
 */
export function makeStarterDraft(
  bodyDefId: string,
  registry: ContentRegistry,
): BuildDraft {
  const body = registry.bodies.get(bodyDefId);
  const selections: Record<string, string> = {};
  if (body) {
    for (const hp of body.functionalHardpoints) {
      if (hp.id === 'front') selections[hp.id] = 'pushRod';
      else if (hp.id === 'frontMass') selections[hp.id] = 'cannon';
      else if (hp.id === 'top') selections[hp.id] = 'hammer';
      else selections[hp.id] = EMPTY_SLOT;
    }
  }
  return {
    bodyDefId,
    rearRadius: 20,
    frontRadius: 20,
    functionalSelections: selections,
    drive: 'forward',
  };
}
