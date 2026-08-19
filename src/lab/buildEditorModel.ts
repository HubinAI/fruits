/**
 * Build Editor Pure Model（Q06-F2）。
 *
 * 把 main.ts 写死的 buildFromEdit 抽成可测试的最小 Build Draft 模型：
 * - Draft 只描述「Body + 前后轮半径 + Functional 槽位选择（hardpointId → defId | none）」；
 * - 槽位来自当前 BodyDef.functionalHardpoints（真实硬点，不虚构）；
 * - Body 切换时保留同名槽选择、丢弃不存在的旧槽、新槽默认 none；
 * - buildSnapshotFromDraft 只生成非 none 项，不自动塞 ramHead，不创造不存在的 hardpoint；
 * - 首版只暴露 none / cannon / hammer / pushRod（ramHead / testMass 不是本轮已通过内容，不暴露）。
 *
 * 纯模型：不依赖 DOM / PhysicsLab / Validator / Energy 平衡（均为后续独立队列）。
 */
import type {
  BodyDef,
  BuildSnapshot,
  ContentRegistry,
} from '../core/types';

/** 可编辑的正式 Functional 内容（本轮已通过体验验证的 Weapon/Gadget） */
export const EDITABLE_FUNCTIONAL_DEF_IDS = ['cannon', 'hammer', 'pushRod'] as const;
export type EditableFunctionalDefId = (typeof EDITABLE_FUNCTIONAL_DEF_IDS)[number];

/** 空槽哨兵：不进入 BuildSnapshot */
export const EMPTY_SLOT = 'none';

/** Build Draft：编辑器的可序列化中间状态 */
export interface BuildDraft {
  bodyDefId: string;
  /** 后轮半径（px） */
  rearRadius: number;
  /** 前轮半径（px） */
  frontRadius: number;
  /** Functional 槽位选择：hardpointId → defId 或 'none'（空槽） */
  functionalSelections: Record<string, string>;
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
 * - movements 固定生成 rear/front 两个 wheelStd（带 radius overrides）；
 * - functionals 只生成非 none 项，且硬点必须真实存在于当前 Body（不创造不存在槽位）；
 * - 不自动塞 ramHead / 其他部件。
 */
export function buildSnapshotFromDraft(
  draft: BuildDraft,
  registry: ContentRegistry,
  id = 'customDraft',
): BuildSnapshot {
  const body = registry.bodies.get(draft.bodyDefId);
  const movements: BuildSnapshot['movements'] = [
    {
      hardpointId: 'rear',
      defId: 'wheelStd',
      overrides: { radius: draft.rearRadius },
    },
    {
      hardpointId: 'front',
      defId: 'wheelStd',
      overrides: { radius: draft.frontRadius },
    },
  ];
  const validHardpoints = body
    ? new Set(body.functionalHardpoints.map((h) => h.id))
    : new Set<string>(); // 未知 Body：无真实槽位，functionals 全部过滤
  const functionals: BuildSnapshot['functionals'] = Object.entries(
    draft.functionalSelections,
  )
    .filter(([, defId]) => defId && defId !== EMPTY_SLOT)
    .filter(([hardpointId]) => validHardpoints.has(hardpointId))
    .map(([hardpointId, defId]) => ({ hardpointId, defId }));

  return {
    id,
    bodyDefId: draft.bodyDefId,
    quality: 1,
    movements,
    functionals,
  };
}
